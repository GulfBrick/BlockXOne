import { z } from 'zod'
import { fundSetupIntentSchema, fundSetupPreparationSchema, fundSetupSnapshotSchema } from './fund-setup-contracts'
import { portalOperatingContextSchema } from './operating-context'

const id = z.string().uuid(), revision = z.number().int().positive()
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const hash = z.string().regex(/^0x[0-9a-f]{64}$/)
const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const instant = z.string().datetime({ offset: true })
export const fundSetupRetryAnchorSchema = z.object({ block_number: amount, block_hash: hash }).strict()
export const fundSetupRetryLeaseSchema = z.object({
  id, setup_id: id, step_id: id, actor_id: id, operating_context: portalOperatingContextSchema,
  intent_hash: digest, sender: address, nonce: amount, request_key: id, created_at: instant, expires_at: instant,
  expected_revision: revision, expected_step_revision: revision,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expires_at) - Date.parse(value.created_at) !== 120000) context.addIssue({ code: z.ZodIssueCode.custom, message: 'A recovery lease has a fixed 120-second handoff window.' })
})
export const fundSetupRetryReadSchema = fundSetupPreparationSchema.extend({
  step_key: z.literal('trex_version'), intent: fundSetupIntentSchema, intent_hash: digest,
  original_state: z.enum(['UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL']), original_transaction_hash: hash.nullable(),
  original_claimed_at: instant, original_expires_at: instant,
  anchor: fundSetupRetryAnchorSchema, retry_count: z.number().int().min(0).max(3),
  next_retry_at: instant.nullable(), active_lease: fundSetupRetryLeaseSchema.nullable(),
  leases: z.array(fundSetupRetryLeaseSchema).max(3),
}).strict()
export type FundSetupRetryRead = z.infer<typeof fundSetupRetryReadSchema>
export type FundSetupRetryLease = z.infer<typeof fundSetupRetryLeaseSchema>

const recoveryObserverPairs = [
  ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'],
  ['https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co'],
  ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'],
  ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2'],
] as const
const provider = z.object({
  url: z.enum(['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy.g.alchemy.com/v2']),
  finalized_block_number: amount, finalized_block_hash: hash, latest_nonce: amount, pending_nonce: amount,
}).strict()
export const fundSetupRecoveryProofSchema = z.object({
  version: z.literal(1), chain_id: z.literal(80002), checked_at: instant,
  status: z.enum(['RETRY_AVAILABLE', 'WAITING', 'WINNER', 'HOLD']), reason_code: z.string().max(160).nullable(),
  sender: address, nonce: amount, intent_hash: digest, anchor: fundSetupRetryAnchorSchema,
  finalized_nonce: fundSetupRetryAnchorSchema.extend({ nonce: amount }).strict().nullable(),
  // Historical views remain readable. The native writer separately gates fresh proofs to the ordered active pair.
  providers: z.array(provider).length(2).refine(value => recoveryObserverPairs.some(([first, second]) =>
    value[0]?.url === first && value[1]?.url === second || value[0]?.url === second && value[1]?.url === first)),
  transaction_hash: hash.nullable(),
  retry_checks: z.object({ runtime_hash: hash, owner: address, before_version: z.string().min(1).max(32), simulation_succeeded: z.literal(true) }).strict().nullable(),
  winner: z.object({ block_number: amount, block_hash: hash, transaction_hash: hash,
    from: address, to: address.nullable(), value: amount, data: z.string().regex(/^0x(?:[0-9a-f]{2})*$/).max(262146),
    nonce: amount, chain_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recovery evidence does not match its declared outcome.' })
  if (value.status === 'RETRY_AVAILABLE') {
    if (!value.retry_checks || !value.finalized_nonce || value.winner || value.transaction_hash || value.reason_code !== null) invalid()
  } else if (value.status === 'WINNER') {
    if (!value.winner || !value.finalized_nonce || !value.transaction_hash || value.winner.transaction_hash !== value.transaction_hash || value.retry_checks
      || value.reason_code !== null && value.reason_code !== 'RECOVERY_WINNER_REVERTED') invalid()
  } else if (value.status === 'HOLD') {
    if (value.retry_checks || !value.finalized_nonce) invalid()
    if (value.reason_code === 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION') { if (value.winner || value.transaction_hash) invalid() }
    else if (value.reason_code !== 'SETUP_RETRY_NONCE_WINNER_MISMATCH' || !value.winner || !value.transaction_hash || value.winner.transaction_hash !== value.transaction_hash) invalid()
  } else if (!value.reason_code || value.retry_checks || value.winner || value.transaction_hash) invalid()
})
export type FundSetupRecoveryProof = z.infer<typeof fundSetupRecoveryProofSchema>

const scope = { product_id: id, setup_id: id, step_id: id, expected_revision: revision,
  expected_step_revision: revision, operating_context: portalOperatingContextSchema }
export const fundSetupRetryRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...scope, action: z.literal('CHECK') }).strict(),
  z.object({ ...scope, action: z.literal('CLAIM'), request_key: id }).strict(),
  z.object({ ...scope, action: z.literal('HASH'), request_key: id, lease_id: id, transaction_hash: hash }).strict(),
  z.object({ ...scope, action: z.literal('OUTCOME'), request_key: id, lease_id: id,
    outcome: z.enum(['REJECTED', 'PENDING_PROMPT', 'UNKNOWN']) }).strict(),
])
export type FundSetupRetryRequest = z.infer<typeof fundSetupRetryRequestSchema>
export const fundSetupRetryResponseSchema = z.object({
  snapshot: fundSetupSnapshotSchema, lease: fundSetupRetryLeaseSchema.nullable(),
  proof: fundSetupRecoveryProofSchema.nullable(),
}).strict()
export type FundSetupRetryResponse = z.infer<typeof fundSetupRetryResponseSchema>

/** Only explicit hash fields in bounded provider-error wrappers; never parse messages or signatures. */
export function setupRetryErrorMetadata(error: unknown): { hash: string | null; outcome: 'REJECTED' | 'PENDING_PROMPT' | 'UNKNOWN' } {
  const seen = new Set<object>(), hashes = new Set<string>(), codes = new Set<number>()
  let unreadable = false
  const field = (record: Record<string, unknown>, key: string): unknown => {
    try { return record[key] } catch { unreadable = true; return undefined }
  }
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5 || seen.has(value) || seen.size >= 20) return
    seen.add(value)
    const record = value as Record<string, unknown>
    const code = field(record, 'code')
    if (typeof code === 'number') codes.add(code)
    for (const key of ['transactionHash', 'hash']) {
      const value = field(record, key)
      if (typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value)) hashes.add(value.toLowerCase())
    }
    for (const key of ['error', 'data', 'originalError', 'cause']) visit(field(record, key), depth + 1)
  }
  try { visit(error, 0) } catch { unreadable = true }
  return { hash: !unreadable && hashes.size === 1 ? [...hashes][0] : null,
    outcome: unreadable || hashes.size ? 'UNKNOWN' : codes.has(4001) ? 'REJECTED' : codes.has(-32002) ? 'PENDING_PROMPT' : 'UNKNOWN' }
}
