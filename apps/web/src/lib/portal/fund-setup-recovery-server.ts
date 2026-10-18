import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { FundLifecycleError, fundLifecycleEnvironment } from './fund-lifecycle-server'
import { portalContextMatches } from './operating-context'
import { callFundWorker } from './fund-lifecycle-worker'
import { fundSetupHash, buildSetupIntent, type FundSetupAddresses } from './fund-setup-chain'
import { readFundSetup, verifyFundSetup } from './fund-setup-server'
import { fundSetupSnapshotSchema, type FundSetupSnapshot } from './fund-setup-contracts'
import { checkFundSetupRecovery, FundSetupRecoveryChainError } from './fund-setup-recovery-chain'
import { fundSetupRecoveryProofSchema, fundSetupRetryReadSchema, fundSetupRetryLeaseSchema,
  type FundSetupRecoveryProof, type FundSetupRetryRead, type FundSetupRetryRequest, type FundSetupRetryResponse } from './fund-setup-recovery-contracts'

const recordedSchema = z.object({ lease: fundSetupRetryLeaseSchema.nullable(), snapshot: fundSetupSnapshotSchema }).strict()
function denied(code: string, message = 'Refresh this saved step. Its original transaction and history have been retained.', status = 409): never {
  throw new FundLifecycleError(code, message, status)
}
function boundSnapshot(raw: unknown, actorId: string, request: FundSetupRetryRequest): FundSetupSnapshot {
  const parsed = fundSetupSnapshotSchema.safeParse(raw)
  if (!parsed.success || parsed.data.actor_id !== actorId || parsed.data.product_id !== request.product_id
    || !portalContextMatches(parsed.data.operating_context, request.operating_context) || !parsed.data.setup || parsed.data.setup.id !== request.setup_id
    || parsed.data.setup.actor_id !== actorId || !portalContextMatches(parsed.data.setup.operating_context, request.operating_context)) {
    return denied('SETUP_RETRY_SCOPE_CHANGED', 'The recovery response does not belong to this account and fund.', 503)
  }
  return parsed.data
}
function validateRead(raw: unknown, actorId: string, request: FundSetupRetryRequest, current: FundSetupSnapshot) {
  const parsed = fundSetupRetryReadSchema.safeParse(raw)
  const step = current.setup?.steps.find(item => item.id === request.step_id)
  if (!parsed.success || !step || step.step_key !== 'trex_version' || !step.intent || !step.intent_hash
    || parsed.data.setup_id !== request.setup_id || parsed.data.step_id !== step.id || parsed.data.actor_id !== actorId
    || parsed.data.product_id !== request.product_id || parsed.data.expected_revision !== current.setup?.revision
    || parsed.data.expected_step_revision !== step.revision || parsed.data.intent_hash !== step.intent_hash
    || !portalContextMatches(parsed.data.operating_context, request.operating_context)
    || parsed.data.sender !== step.sender
    || parsed.data.intent.nonce !== step.nonce || fundSetupHash(parsed.data.intent) !== fundSetupHash(step.intent)
    || parsed.data.original_state !== step.state || parsed.data.original_transaction_hash !== step.transaction_hash
    || Date.parse(parsed.data.expires_at) <= Date.now()) return denied('SETUP_RETRY_READ_UNVERIFIED')
  const saved = parsed.data
  if (!saved.configuration || saved.intent.step_key !== 'trex_version' || saved.intent.kind !== 'CALL' || saved.intent.value !== '0'
    || saved.intent.sender !== saved.sender || saved.intent.configuration_hash !== saved.setup_configuration_hash) return denied('SETUP_RETRY_INTENT_UNVERIFIED')
  // Rebuild from the saved configuration and dependencies, not from request fields.
  const canonical = buildSetupIntent('trex_version', saved.configuration, saved.dependencies as FundSetupAddresses,
    saved.sender, saved.intent.nonce, saved.setup_configuration_hash)
  // Native record identity uses PostgreSQL jsonb::text, not the JS canonical
  // serialization. Compare payloads within one domain; retain the native hash.
  if (fundSetupHash(canonical) !== fundSetupHash(saved.intent)) return denied('SETUP_RETRY_INTENT_UNVERIFIED')
  return saved
}
function validateProof(raw: unknown, read: FundSetupRetryRead): FundSetupRecoveryProof {
  const parsed = fundSetupRecoveryProofSchema.safeParse(raw)
  if (!parsed.success || parsed.data.intent_hash !== read.intent_hash || parsed.data.sender !== read.sender
    || parsed.data.nonce !== read.intent.nonce || Date.now() - Date.parse(parsed.data.checked_at) > 30000
    || Date.parse(parsed.data.checked_at) > Date.now() + 5000) return denied('SETUP_RETRY_PROOF_UNVERIFIED', 'The independent chain check expired or could not be verified. Check the saved transaction again.', 503)
  const proof = parsed.data, winner = proof.winner, checks = proof.retry_checks, finalNonce = proof.finalized_nonce
  if (proof.providers.some(item => BigInt(item.pending_nonce) < BigInt(item.latest_nonce)
    || finalNonce && BigInt(item.latest_nonce) < BigInt(finalNonce.nonce))) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  if (finalNonce) {
    const common = proof.providers.reduce((n, item) => BigInt(item.finalized_block_number) < n ? BigInt(item.finalized_block_number) : n,
      BigInt(proof.providers[0].finalized_block_number))
    if (BigInt(finalNonce.block_number) !== common || proof.providers.some(item => item.finalized_block_number === finalNonce.block_number
      && item.finalized_block_hash !== finalNonce.block_hash)) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  }
  if (proof.status === 'RETRY_AVAILABLE' && (proof.providers.some(item => item.latest_nonce !== read.intent.nonce || item.pending_nonce !== read.intent.nonce)
    || !checks || checks.runtime_hash !== read.intent.expected_runtime_hash || checks.owner !== read.sender
    || checks.before_version === '4.1.3' || finalNonce?.nonce !== read.intent.nonce)) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  if ((proof.status === 'WINNER' || proof.status === 'HOLD') && (!finalNonce || BigInt(finalNonce.nonce) <= BigInt(read.intent.nonce)
    || BigInt(finalNonce.block_number) <= BigInt(proof.anchor.block_number))) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  if (winner && (winner.from !== read.sender || winner.nonce !== read.intent.nonce || BigInt(winner.block_number) <= BigInt(proof.anchor.block_number)
    || proof.providers.some(item => BigInt(item.finalized_block_number) < BigInt(winner.block_number)))) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  const exactWinner = winner && winner.chain_id === 80002 && winner.to === read.intent.to && winner.value === '0' && winner.data === read.intent.data
  if (proof.status === 'WINNER' && !exactWinner || proof.status === 'HOLD' && winner && exactWinner) return denied('SETUP_RETRY_PROOF_UNVERIFIED', undefined, 503)
  return proof
}
async function record(read: FundSetupRetryRead, action: 'CLAIM' | 'HASH' | 'OUTCOME' | 'HOLD', key: string,
  details: unknown, actorId: string, request: FundSetupRetryRequest) {
  const payload = action === 'CLAIM' || action === 'HOLD' ? { proof: details } : details
  const parsed = recordedSchema.safeParse(await callFundWorker('record_fund_setup_retry', [read, action, key, payload]))
  if (!parsed.success) return denied('SETUP_RETRY_RESULT_UNVERIFIED', undefined, 503)
  const snapshot = boundSnapshot(parsed.data.snapshot, actorId, request)
  const lease = parsed.data.lease
  if (lease && (lease.setup_id !== read.setup_id || lease.step_id !== read.step_id || lease.actor_id !== actorId
    || lease.sender !== read.sender || lease.nonce !== read.intent.nonce || lease.intent_hash !== read.intent_hash
    || !portalContextMatches(lease.operating_context, request.operating_context))) return denied('SETUP_RETRY_LEASE_UNVERIFIED', undefined, 503)
  return { snapshot, lease }
}

/** Recovery is another attempt of the same immutable operation, never a new setup. */
export async function recoverFundSetup(client: SupabaseClient, actorId: string, request: FundSetupRetryRequest): Promise<FundSetupRetryResponse> {
  if (fundLifecycleEnvironment() !== 'TESTNET') return denied('SETUP_RETRY_NOT_ADMITTED', 'Blockchain recovery is not admitted in MAIN.')
  const current = boundSnapshot(await readFundSetup(client, actorId, request.product_id, request.operating_context), actorId, request)
  if (current.setup!.recovery_hold && request.action === 'CHECK') return { snapshot: current, lease: null, proof: null }
  // Fresh authenticated boundary renews only current claims, never the original step expiry.
  const { data, error } = await client.rpc('bx1_portal_fund_setup_authorise', { setup_id: request.setup_id,
    expected_revision: current.setup!.revision, operating_context: request.operating_context }).abortSignal(AbortSignal.timeout(10000))
  if (error) return denied('SETUP_RETRY_AUTHORITY_REQUIRED', 'Your current session cannot authorise this recovery. Sign in in the original fund capacity.', error.code === '42501' ? 403 : 409)
  const authorised = boundSnapshot(data, actorId, request)
  if (authorised.setup!.revision !== current.setup!.revision) return denied('SETUP_RETRY_REVISION_CHANGED')
  const read = validateRead(await callFundWorker('read_fund_setup_retry', [request.setup_id, request.step_id,
    authorised.setup!.revision, actorId, request.operating_context]), actorId, request, authorised)

  if (request.action === 'HASH' || request.action === 'OUTCOME') {
    const lease = read.leases.find(item => item.id === request.lease_id)
    if (!lease || lease.actor_id !== actorId || lease.intent_hash !== read.intent_hash) return denied('SETUP_RETRY_LEASE_UNVERIFIED')
    // Current authority is checked above. Old revisions and elapsed lease time do not discard a late public hash.
    const result = await record(read, request.action, request.request_key, request.action === 'HASH'
      ? { lease_id: request.lease_id, transaction_hash: request.transaction_hash, discovery_proof: null }
      : { lease_id: request.lease_id, outcome: request.outcome }, actorId, request)
    return { ...result, proof: null }
  }

  if (request.action === 'CLAIM') {
    const replay = read.leases.find(item => item.request_key === request.request_key)
    if (replay) {
      if (replay.expected_revision !== request.expected_revision || replay.expected_step_revision !== request.expected_step_revision
        || replay.intent_hash !== read.intent_hash) return denied('SETUP_RETRY_REQUEST_CONFLICT')
      // Replaying an expired grant returns its expired lease; it never grants another wallet send.
      return { snapshot: authorised, lease: read.original_state === 'UNKNOWN' && !read.original_transaction_hash ? replay : null, proof: null }
    }
  }
  if (read.expected_revision !== request.expected_revision || read.expected_step_revision !== request.expected_step_revision) return denied('SETUP_RETRY_REVISION_CHANGED')
  if (request.action === 'CLAIM' && (read.original_state !== 'UNKNOWN' || read.original_transaction_hash)) return denied('SETUP_RETRY_NOT_HASHLESS', 'A transaction reference is already saved. Check that transaction; do not submit another.')
  if (read.original_state === 'FINAL') return { snapshot: authorised, lease: null, proof: null }
  let proof: FundSetupRecoveryProof
  try { proof = validateProof(await checkFundSetupRecovery(read.intent, read.anchor, { intent_hash: read.intent_hash }), read) }
  catch (error) {
    if (error instanceof FundSetupRecoveryChainError) return denied(error.code, 'Independent recovery checks are not available. The original step remains saved; no new transaction was authorised.', 503)
    throw error
  }
  if (proof.status === 'HOLD') {
    const result = await record(read, 'HOLD', crypto.randomUUID(), proof, actorId, request)
    return { ...result, proof }
  }
  if (proof.status === 'WINNER') {
    if (!proof.transaction_hash) return denied('SETUP_RETRY_WINNER_UNVERIFIED', undefined, 503)
    const result = await record(read, 'HASH', crypto.randomUUID(), { lease_id: null,
      transaction_hash: proof.transaction_hash, discovery_proof: proof }, actorId, request)
    const verified = await verifyFundSetup(client, actorId, { setup_id: read.setup_id, step_id: read.step_id,
      expected_revision: result.snapshot.setup!.revision, operating_context: request.operating_context })
    return { snapshot: boundSnapshot(verified, actorId, request), lease: null, proof }
  }
  if (request.action === 'CHECK' || proof.status !== 'RETRY_AVAILABLE') {
    if (proof.status === 'RETRY_AVAILABLE' && (read.original_state !== 'UNKNOWN' || read.original_transaction_hash)) {
      return { snapshot: authorised, lease: null, proof: { ...proof, status: 'WAITING', retry_checks: null, reason_code: 'SETUP_RETRY_SAVED_CANDIDATE_UNCONFIRMED' } }
    }
    if (proof.status === 'RETRY_AVAILABLE' && (read.active_lease || read.retry_count >= 3 || read.next_retry_at && Date.parse(read.next_retry_at) > Date.now())) {
      return { snapshot: authorised, lease: read.active_lease,
        proof: { ...proof, status: 'WAITING', retry_checks: null, reason_code: read.retry_count >= 3 ? 'SETUP_RETRY_LIMIT_REACHED' : 'SETUP_RETRY_LEASE_ACTIVE' } }
    }
    return { snapshot: authorised, lease: null, proof }
  }
  if (read.active_lease || read.retry_count >= 3 || read.next_retry_at && Date.parse(read.next_retry_at) > Date.now()) {
    return denied('SETUP_RETRY_WAIT', 'A wallet attempt is still reserved or the retry limit was reached. Check the saved transaction before another attempt.')
  }
  const result = await record(read, 'CLAIM', request.request_key, proof, actorId, request)
  const lease = result.lease, saved = result.snapshot.setup?.steps.find(item => item.id === read.step_id)
  if (!lease || lease.request_key !== request.request_key || lease.expected_revision !== read.expected_revision
    || lease.expected_step_revision !== read.expected_step_revision || result.snapshot.setup?.revision !== read.expected_revision + 1
    || saved?.revision !== read.expected_step_revision + 1 || saved.state !== 'UNKNOWN' || saved.transaction_hash
    || Date.parse(lease.expires_at) <= Date.now() || Date.parse(lease.expires_at) > Date.parse(lease.created_at) + 120000) {
    return denied('SETUP_RETRY_LEASE_UNVERIFIED', 'The server did not confirm this exact recovery lease. No wallet transaction was requested.', 503)
  }
  return { ...result, proof }
}
