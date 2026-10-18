import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fundAdmissionInputSchema } from './fund-chain-admission'
import { requireFundRpcResult } from './fund-lifecycle-api'
import { FundLifecycleError, fundLifecycleEnvironment } from './fund-lifecycle-server'
import { callFundWorker } from './fund-lifecycle-worker'
import { fundSetupHash } from './fund-setup-chain'
import { portalContextMatches } from './operating-context'
import { createFundAuthorityAlignmentReadSchema, fundAuthorityAlignmentObservationSchema, fundAuthorityAlignmentResponseSchema,
  type FundAuthorityAlignmentRead, type FundAuthorityAlignmentRequest, type FundAuthorityAlignmentPurpose,
  type FundAuthorityAlignmentExecution, type FundAuthorityAlignmentResponse } from './fund-authority-alignment-contracts'
import { prepareFundAuthorityAlignment, verifyFundAuthorityAlignmentSignature, buildSignedFundAuthorityAlignmentTransaction,
  observeFundAuthorityAlignment, discoverFundAuthorityAlignment, FundAuthorityAlignmentChainError } from './fund-authority-alignment-chain'

const readSchema = createFundAuthorityAlignmentReadSchema(fundAdmissionInputSchema)
function deny(code: string, message = 'The saved fund authority changed. Refresh its original request; do not send another transaction.', status = 409): never {
  throw new FundLifecycleError(code, message, status)
}
type Scope = Pick<FundAuthorityAlignmentRequest, 'setup_id' | 'setup_revision' | 'operating_context'>
function boundRead(raw: unknown, actorId: string, scope: Scope) {
  const parsed = readSchema.safeParse(raw)
  if (!parsed.success) return deny('ALIGNMENT_READ_UNVERIFIED', undefined, 503)
  const read = parsed.data, setup = read.input.setup.setup
  if (read.actor_id !== actorId || read.setup_id !== scope.setup_id || read.setup_revision !== scope.setup_revision
    || !portalContextMatches(read.operating_context, scope.operating_context) || read.input.setup.actor_id !== actorId
    || !portalContextMatches(read.input.setup.operating_context, scope.operating_context)
    || !setup || setup.id !== scope.setup_id || setup.revision !== scope.setup_revision
    || Date.parse(read.authority_expires_at) <= Date.now()) return deny('ALIGNMENT_SCOPE_CHANGED')
  return read
}

/** A receipt contains real authenticated-session evidence in Postgres only, never browser-supplied claims. */
export async function authoriseFundAuthorityPhase(client: SupabaseClient, actorId: string, scope: Scope, purpose: FundAuthorityAlignmentPurpose) {
  const { data, error } = await client.rpc('bx1_portal_fund_alignment_authorise', { setup_id: scope.setup_id,
    expected_setup_revision: scope.setup_revision, operating_context: scope.operating_context, purpose }).abortSignal(AbortSignal.timeout(10000))
  return boundRead(requireFundRpcResult(data, error), actorId, scope)
}
async function readCurrent(client: SupabaseClient, actorId: string, scope: Scope) {
  const authorisation = await authoriseFundAuthorityPhase(client, actorId, scope, 'ALIGNMENT_READ')
  const read = boundRead(await callFundWorker('read_fund_authority_alignment', [authorisation.admission_request_id,
    actorId, scope.operating_context, authorisation.authorisation_receipt_id]), actorId, scope)
  if (read.admission_request_id !== authorisation.admission_request_id || read.native_binding_hash !== authorisation.native_binding_hash
    || read.input_hash !== authorisation.input_hash || fundSetupHash(read.input) !== fundSetupHash(authorisation.input)) return deny('ALIGNMENT_AUTHORISATION_CHANGED')
  return read
}
function samePreparation(before: FundAuthorityAlignmentRead, after: FundAuthorityAlignmentRead) {
  if (before.admission_request_id !== after.admission_request_id || before.native_binding_hash !== after.native_binding_hash
    || before.reason_hash !== after.reason_hash || before.input_hash !== after.input_hash || fundSetupHash(before.input) !== fundSetupHash(after.input)
    || fundSetupHash(before.operation) !== fundSetupHash(after.operation)) return deny('ALIGNMENT_PREPARATION_CHANGED')
}
async function save(client: SupabaseClient, actorId: string, request: FundAuthorityAlignmentRequest,
  before: FundAuthorityAlignmentRead, action: string, evidence: unknown) {
  // This genuine re-read is AFTER provider waits. It is not a replay of the earlier receipt.
  const current = await readCurrent(client, actorId, request)
  samePreparation(before, current)
  const authorisation = await authoriseFundAuthorityPhase(client, actorId, request, 'ALIGNMENT_WRITE')
  if (authorisation.admission_request_id !== current.admission_request_id || authorisation.native_binding_hash !== current.native_binding_hash
    || authorisation.reason_hash !== current.reason_hash || fundSetupHash(authorisation.input) !== fundSetupHash(current.input)) return deny('ALIGNMENT_WRITE_AUTHORITY_CHANGED')
  if (!('request_key' in request)) return deny('ALIGNMENT_REQUEST_KEY_REQUIRED')
  return boundRead(await callFundWorker('record_fund_authority_alignment', [current, action, request.request_key, evidence,
    authorisation.authorisation_receipt_id]), actorId, request)
}
function view(read: FundAuthorityAlignmentRead, alreadyAligned = false, execution: FundAuthorityAlignmentExecution | null = null): FundAuthorityAlignmentResponse {
  const op = read.operation
  const operation = op ? (() => { const { signatures, observation: _observation, ...rest } = op
    return { ...rest, signing_addresses: signatures.map(signature => signature.signer).sort() } })() : null
  return fundAuthorityAlignmentResponseSchema.parse({ actor_id: read.actor_id, operating_context: read.operating_context,
    setup_id: read.setup_id, setup_revision: read.setup_revision, admission_request_id: read.admission_request_id,
    native_binding_hash: read.native_binding_hash, reason_hash: read.reason_hash,
    previous_epoch: read.input.authority_epoch - 1, target_epoch: read.input.authority_epoch,
    already_aligned: alreadyAligned || op?.state === 'FINAL', operation, execution })
}
function checkedOperation(read: FundAuthorityAlignmentRead, request: FundAuthorityAlignmentRequest) {
  const op = read.operation
  if (!('operation_id' in request) || !op || op.id !== request.operation_id
    || (request.action === 'HASH' ? request.expected_revision > op.revision : request.expected_revision !== op.revision)) return deny('ALIGNMENT_OPERATION_CHANGED')
  return op
}

/** One actual Safe bootstrap, in the original product workspace. Never signs or broadcasts on a server. */
async function runFundAuthorityAlignment(client: SupabaseClient, actorId: string, request: FundAuthorityAlignmentRequest) {
  if (fundLifecycleEnvironment() !== 'TESTNET') return deny('ALIGNMENT_MAIN_NOT_ADMITTED', 'This authority setup is available only on the approved TEST rail.')
  let read = await readCurrent(client, actorId, request)
  if (read.input.authority_epoch < 2) return deny('ALIGNMENT_ONE_STEP_NOT_REQUIRED')
  if (request.action === 'READ') return view(read)
  if (request.action === 'PREPARE') {
    const prepared = await prepareFundAuthorityAlignment(read)
    if (prepared.already_aligned) {
      const after = await readCurrent(client, actorId, request); samePreparation(read, after)
      if (after.operation?.claimed_at) return deny('ALIGNMENT_ORIGINAL_ATTEMPT_REQUIRED')
      return view(after, true)
    }
    if (!prepared.intent) return deny('ALIGNMENT_INTENT_REQUIRED')
    if (read.operation?.intent) return view(read)
    return view(await save(client, actorId, request, read, 'PREPARE', prepared))
  }
  const op = checkedOperation(read, request)
  if (!op.intent) return deny('ALIGNMENT_NOT_PREPARED')
  if (request.action === 'SIGN' || request.action === 'CLAIM') {
    if (!['PREPARED', 'SIGNING'].includes(op.state) || op.claimed_at) return deny('ALIGNMENT_ALREADY_CLAIMED')
    const checked = await prepareFundAuthorityAlignment(read)
    if (checked.already_aligned || !checked.intent || fundSetupHash(checked.intent) !== fundSetupHash(op.intent)) return deny('ALIGNMENT_SIGNING_STATE_CHANGED')
    if (request.action === 'SIGN') {
      const signature = verifyFundAuthorityAlignmentSignature(op.intent, request.signing_address, request.signature)
      return view(await save(client, actorId, request, read, 'SIGNATURE', signature))
    }
    const execution = buildSignedFundAuthorityAlignmentTransaction(op.intent, op.signatures)
    const result = await save(client, actorId, request, read, 'CLAIM', { intent: op.intent, execution })
    if (!result.operation || result.operation.state !== 'UNKNOWN' || result.operation.claim_key !== request.request_key
      || !result.operation.claimed_at || fundSetupHash(result.operation.intent) !== fundSetupHash(op.intent)) return deny('ALIGNMENT_CLAIM_UNVERIFIED', undefined, 503)
    return view(result, false, execution)
  }
  if (!op.claimed_at || !op.claim_key || !['UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'REVERTED', 'RECOVERY_REQUIRED'].includes(op.state)) return deny('ALIGNMENT_ORIGINAL_CLAIM_REQUIRED')
  if (request.action === 'HASH') return view(await save(client, actorId, request, read, 'HASH', { transaction_hash: request.transaction_hash }))
  if (op.state === 'FINAL' || op.state === 'REVERTED') return view(read)
  const recoverySignal = AbortSignal.timeout(90000)
  let transactionHash = op.transaction_hash
  // A saved candidate is not necessarily the canonical winner. Discover the
  // original executor+nonce even after a broadcast/replacement, never a new send.
  const winner = await discoverFundAuthorityAlignment(read, op.intent, op.signatures, { signal: recoverySignal })
  if (winner && winner !== transactionHash) {
    transactionHash = winner
    read = await save(client, actorId, request, read, 'HASH', { transaction_hash: transactionHash })
  }
  if (!transactionHash) {
    const after = await readCurrent(client, actorId, request); samePreparation(read, after)
    return view(after)
  }
  const currentOp = read.operation
  if (!currentOp?.intent || currentOp.id !== op.id) return deny('ALIGNMENT_ORIGINAL_OPERATION_CHANGED')
  const observation = fundAuthorityAlignmentObservationSchema.parse(await observeFundAuthorityAlignment(read, currentOp.intent, currentOp.signatures, transactionHash, { signal: recoverySignal }))
  return view(await save(client, actorId, request, read, 'OBSERVE', observation))
}

export async function handleFundAuthorityAlignment(client: SupabaseClient, actorId: string, request: FundAuthorityAlignmentRequest) {
  try { return await runFundAuthorityAlignment(client, actorId, request) }
  catch (failure) {
    if (failure instanceof FundAuthorityAlignmentChainError) return deny(failure.code,
      failure.status === 503 ? 'Independent chain checks are temporarily unavailable. Keep the saved request and check it again; do not submit another transaction.'
        : 'The current Safe, wallet nonce or controller does not match the saved authority change. Refresh the original signing progress; do not send again.', failure.status)
    throw failure
  }
}
