import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { portalContextMatches, portalOperatingContextSchema, type PortalOperatingContext } from './operating-context'
import { FundLifecycleError, fundLifecycleEnvironment } from './fund-lifecycle-server'
import { callFundWorker } from './fund-lifecycle-worker'
import { fundRecipientIntentSchema, fundRecipientSnapshotSchema, type FundRecipientCommand, type FundRecipientSnapshot } from './fund-recipient-contracts'
import { buildFundRecipientClaimSigningRequest, buildSignedRecipientSafeTransaction, fundRecipientExpectationSchema,
  observeFundRecipientOperation, prepareFundRecipientOperation, verifyFundRecipientClaim, verifyRecipientSafeSignature,
  type FundRecipientExpectation, type FundRecipientIntent } from './fund-recipient-chain'
import { fundSetupHash, observeSetupSafe, readSetupNonce } from './fund-setup-chain'

const id = z.string().uuid(), revision = z.number().int().positive(), digest = z.string().regex(/^[0-9a-f]{64}$/)
const signature = z.string().regex(/^0x[0-9a-f]{130}$/), address = z.string().regex(/^0x[0-9a-f]{40}$/)
const binding = z.object({ operation_id: id, expected_revision: revision, actor_id: id, operating_context: portalOperatingContextSchema,
  case_id: id, expectation: fundRecipientExpectationSchema }).strict()
const preparationSchema = binding.extend({ saved_intent: fundRecipientIntentSchema.nullable() }).strict()
const observationSchema = binding.extend({ intent: fundRecipientIntentSchema, transaction_hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  state: z.enum(['UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'FAILED']) }).strict()
const claimSchema = z.object({ case_id: id, expected_revision: revision, actor_id: id, operating_context: portalOperatingContextSchema,
  signature_id: id, expectation: fundRecipientExpectationSchema }).strict()
const signingSchema = z.object({ case_id: id, expected_revision: revision, actor_id: id, operating_context: portalOperatingContextSchema,
  expectation: fundRecipientExpectationSchema }).strict()
const signatureSchema = z.object({ signature_id: id, operation_id: id, actor_id: id, operating_context: portalOperatingContextSchema,
  signing_address: address, signature, intent: fundRecipientIntentSchema, intent_hash: digest }).strict()
const executionSchema = binding.extend({ intent: fundRecipientIntentSchema,
  signatures: z.array(z.object({ signer_address: address, signature }).strict()).max(20) }).strict()
const findSchema = z.object({ delivery_binding_id: id, case_id: id.nullable(), snapshot: fundRecipientSnapshotSchema.nullable() }).strict()
type OperationRequest = { operation_id: string; expected_revision: number; operating_context: PortalOperatingContext }
type KeyedOperationRequest = OperationRequest & { request_key: string }

function onlyTest() {
  if (fundLifecycleEnvironment() !== 'TESTNET') throw new FundLifecycleError('RECIPIENT_NOT_ADMITTED', 'Recipient chain operations are not admitted in MAIN.', 409)
}
function checkError(error: { code?: string } | null) {
  if (!error) return
  if (['42883', 'PGRST202'].includes(error.code ?? '')) throw new FundLifecycleError('RECIPIENT_NOT_INSTALLED', 'Investor wallet registration is not connected in this environment yet.', 503)
  throw new FundLifecycleError('RECIPIENT_ACTION_NOT_CONFIRMED', error.code === '42501'
    ? 'Your current session, account or product authority does not permit this action.'
    : 'The saved investor wallet or operation changed. Refresh its original record before retrying.', error.code === '42501' ? 403 : 409)
}
function reject(): never { throw new FundLifecycleError('RECIPIENT_BINDING_UNVERIFIED', 'The original recipient record could not be bound to this account and capacity. No transaction was prepared.', 409) }
function snapshot(raw: unknown, actorId: string, context: PortalOperatingContext, caseId?: string): FundRecipientSnapshot {
  const result = fundRecipientSnapshotSchema.safeParse(raw)
  if (!result.success || result.data.actor_id !== actorId || !portalContextMatches(result.data.operating_context, context)
    || caseId && result.data.case.id !== caseId || result.success && result.data.operations.some(operation => operation.intent
      && (operation.intent.operation_id !== operation.id || operation.intent.sender_address !== operation.sender_address
        || operation.intent.phase !== operation.phase))) return reject()
  return result.data
}
async function command(client: SupabaseClient, actorId: string, name: string, key: string, payload: unknown, context: PortalOperatingContext) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_recipient_command', { command: name, request_key: key, payload,
    operating_context: context }).abortSignal(AbortSignal.timeout(15000))
  checkError(error); return snapshot(data, actorId, context)
}
export async function readFundRecipient(client: SupabaseClient, actorId: string, caseId: string, context: PortalOperatingContext) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_recipient_read', { case_id: caseId, operating_context: context }).abortSignal(AbortSignal.timeout(10000))
  checkError(error); return snapshot(data, actorId, context, caseId)
}
export async function findFundRecipient(client: SupabaseClient, actorId: string, bindingId: string, context: PortalOperatingContext) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_recipient_find', { delivery_binding_id: bindingId,
    operating_context: context }).abortSignal(AbortSignal.timeout(10000))
  checkError(error)
  const found = findSchema.parse(data)
  if (found.delivery_binding_id !== bindingId || (found.case_id === null) !== (found.snapshot === null)) return reject()
  if (found.snapshot) {
    const current = snapshot(found.snapshot, actorId, context, found.case_id!)
    if (current.case.delivery_binding_id !== bindingId) return reject()
  }
  return found
}
export async function commandFundRecipient(client: SupabaseClient, actorId: string, request: FundRecipientCommand) {
  return command(client, actorId, request.command, request.request_key, request.payload, request.operating_context)
}
async function authorise(client: SupabaseClient, actorId: string, request: OperationRequest) {
  const current = await command(client, actorId, 'AUTHORISE', randomUUID(), {
    operation_id: request.operation_id, expected_revision: request.expected_revision }, request.operating_context)
  if (!current.operations.some(operation => operation.id === request.operation_id && operation.revision === request.expected_revision
    && operation.actor_id === actorId && portalContextMatches(operation.operating_context, request.operating_context))) return reject()
  return current
}
function ticketMatches(ticket: z.infer<typeof binding>, actorId: string, request: OperationRequest) {
  if (ticket.operation_id !== request.operation_id || ticket.expected_revision !== request.expected_revision || ticket.actor_id !== actorId
    || !portalContextMatches(ticket.operating_context, request.operating_context) || ticket.expectation.operation_id !== ticket.operation_id) return reject()
}
export async function prepareFundRecipient(client: SupabaseClient, actorId: string, request: OperationRequest) {
  onlyTest(); await authorise(client, actorId, request)
  const ticket = preparationSchema.parse(await callFundWorker('read_fund_recipient_preparation', [request.operation_id,
    request.expected_revision, actorId, request.operating_context]))
  ticketMatches(ticket, actorId, request)
  if (Date.parse(ticket.expectation.action_valid_until) <= Date.now()) return reject()
  if (ticket.saved_intent) return readFundRecipient(client, actorId, ticket.case_id, request.operating_context)
  const senderNonce = await readSetupNonce(ticket.expectation.sender_address)
  let safeNonce: string | null = null
  if (ticket.expectation.phase === 'REGISTER_IDENTITY') {
    const safe = await observeSetupSafe(ticket.expectation.manifest.safe.address)
    if (JSON.stringify([...safe.owners].sort()) !== JSON.stringify([...ticket.expectation.manifest.safe.owners].sort())
      || safe.threshold !== ticket.expectation.manifest.safe.threshold || safe.runtime_hash !== ticket.expectation.manifest.safe.runtime_hash) return reject()
    safeNonce = safe.nonce
  }
  const expectation: FundRecipientExpectation = { ...ticket.expectation, sender_nonce: senderNonce, safe_nonce: safeNonce }
  const built = await prepareFundRecipientOperation(expectation)
  if (Date.parse(ticket.expectation.action_valid_until) <= Date.now()) return reject()
  await callFundWorker('prepare_fund_recipient_operation', [ticket, built])
  return readFundRecipient(client, actorId, ticket.case_id, request.operating_context)
}
export async function verifyFundRecipient(client: SupabaseClient, actorId: string, request: OperationRequest) {
  onlyTest(); await authorise(client, actorId, request)
  const ticket = observationSchema.parse(await callFundWorker('read_fund_recipient_observation', [request.operation_id,
    request.expected_revision, actorId, request.operating_context]))
  ticketMatches(ticket, actorId, request)
  const result = await observeFundRecipientOperation(ticket.expectation, ticket.intent, ticket.transaction_hash)
  await callFundWorker('record_fund_recipient_observation', [ticket, result])
  return readFundRecipient(client, actorId, ticket.case_id, request.operating_context)
}
export async function readFundRecipientClaimSigningRequest(client: SupabaseClient, actorId: string, caseId: string, context: PortalOperatingContext) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_recipient_claim_signing_request', {
    case_id: caseId, operating_context: context }).abortSignal(AbortSignal.timeout(10000))
  checkError(error)
  const ticket = signingSchema.parse(data)
  if (ticket.actor_id !== actorId || ticket.case_id !== caseId || !portalContextMatches(ticket.operating_context, context)
    || ticket.expectation.phase !== 'ADD_CLAIM' || ticket.expectation.claim_signature !== null) return reject()
  return { case_id: caseId, expected_revision: ticket.expected_revision, signing_request: buildFundRecipientClaimSigningRequest(ticket.expectation) }
}
export async function submitFundRecipientClaim(client: SupabaseClient, actorId: string, request: {
  case_id: string; expected_revision: number; request_key: string; signature: string; operating_context: PortalOperatingContext
}) {
  onlyTest()
  const current = await command(client, actorId, 'SUBMIT_CLAIM_SIGNATURE', request.request_key,
    { case_id: request.case_id, expected_revision: request.expected_revision, signature: request.signature }, request.operating_context)
  // An identical request already cryptographically verified by the worker may
  // resume without submitting a second signature or manufacturing new evidence.
  if (current.case.id === request.case_id && current.case.claim_signature_id !== null && current.case.pending_signature_id === null) return current
  const ticket = claimSchema.parse(await callFundWorker('read_fund_recipient_claim', [request.case_id,
    current.case.revision, actorId, request.operating_context]))
  if (ticket.case_id !== request.case_id || ticket.actor_id !== actorId || !portalContextMatches(ticket.operating_context, request.operating_context)
    || ticket.signature_id !== current.case.pending_signature_id || ticket.expectation.operation_id !== ticket.signature_id
    || ticket.expectation.claim_signature !== request.signature) return reject()
  const proof = await verifyFundRecipientClaim(ticket.expectation)
  await callFundWorker('record_fund_recipient_claim', [ticket, proof])
  return readFundRecipient(client, actorId, ticket.case_id, request.operating_context)
}
export async function recordFundRecipientSafeSignature(client: SupabaseClient, actorId: string, request: KeyedOperationRequest & { signing_address: string; signature: string }) {
  onlyTest()
  const current = await command(client, actorId, 'RECORD_SAFE_SIGNATURE', request.request_key,
    { operation_id: request.operation_id, expected_revision: request.expected_revision, signing_address: request.signing_address, signature: request.signature }, request.operating_context)
  const operation = current.operations.find(item => item.id === request.operation_id)
  const saved = operation?.signatures.find(item => item.actor_id === actorId && item.signing_address === request.signing_address)
  if (!saved) return reject()
  const ticket = signatureSchema.parse(await callFundWorker('read_fund_recipient_signature', [saved.id]))
  if (ticket.signature_id !== saved.id || ticket.operation_id !== request.operation_id || ticket.actor_id !== actorId
    || !portalContextMatches(ticket.operating_context, request.operating_context) || ticket.signature !== request.signature
    || ticket.signing_address !== request.signing_address) return reject()
  verifyRecipientSafeSignature(ticket.intent, ticket.signing_address, ticket.signature)
  await callFundWorker('record_fund_recipient_signature', [ticket.signature_id, { version: 1, status: 'VERIFIED',
    signature_id: ticket.signature_id, signing_address: ticket.signing_address, signature: ticket.signature,
    intent_hash: ticket.intent_hash, safe_transaction_hash: ticket.intent.safe_transaction_hash }])
  return readFundRecipient(client, actorId, current.case.id, request.operating_context)
}
export async function claimFundRecipient(client: SupabaseClient, actorId: string, request: KeyedOperationRequest) {
  onlyTest()
  const current = await command(client, actorId, 'CLAIM_EXECUTION', request.request_key,
    { operation_id: request.operation_id, expected_revision: request.expected_revision }, request.operating_context)
  const operation = current.operations.find(item => item.id === request.operation_id)
  if (!operation || operation.state !== 'UNKNOWN' || !operation.intent || operation.actor_id !== actorId) return reject()
  const ticket = executionSchema.parse(await callFundWorker('read_fund_recipient_execution', [operation.id, operation.revision, actorId, request.operating_context]))
  ticketMatches(ticket, actorId, { ...request, expected_revision: operation.revision })
  if (ticket.intent.operation_id !== operation.id || Date.parse(ticket.intent.valid_until) <= Date.now()
    || await readSetupNonce(ticket.intent.sender_address) !== ticket.intent.sender_nonce) return reject()
  const intent: FundRecipientIntent = ticket.intent
  // Reobserve the exact dependencies before handing anything to MetaMask. This
  // cannot cancel a signature outside the UI; admission retains that limitation.
  const checked = await prepareFundRecipientOperation(ticket.expectation)
  if (checked.transaction_data !== intent.transaction_data || checked.to !== intent.to || checked.expected_identity_address !== intent.expected_identity_address
    || checked.expectation_hash !== intent.expectation_hash || checked.safe_transaction_hash !== intent.safe_transaction_hash) return reject()
  const final = executionSchema.parse(await callFundWorker('read_fund_recipient_execution', [operation.id, operation.revision, actorId, request.operating_context]))
  ticketMatches(final, actorId, { ...request, expected_revision: operation.revision })
  if (fundSetupHash(final) !== fundSetupHash(ticket) || Date.parse(intent.valid_until) <= Date.now()) return reject()
  const signed = intent.safe_transaction ? buildSignedRecipientSafeTransaction(intent,
    final.signatures.slice(0, intent.safe_threshold)) : null
  // Current authenticated read repeats the saved context after provider waits.
  const refreshed = await readFundRecipient(client, actorId, ticket.case_id, request.operating_context)
  return { snapshot: refreshed, signed_transaction: signed }
}
