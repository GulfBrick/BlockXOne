import { z } from 'zod'

const id = z.string().uuid()
const revision = z.number().int().positive()
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value), 'Use a non-zero EVM address.')
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const units = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
const reason = z.string().trim().min(20).max(2000)
const actions = z.array(z.string().max(80)).max(20)
const observationStatus = z.enum(['UNVERIFIED', 'VERIFIED', 'INVALID', 'PENDING', 'UNAVAILABLE'])

export const fundingCommandOptions = [
  z.object({ command: z.literal('propose_funding_route'), key: id, payload: z.object({
    product_id: id, expected_revision: revision, token_address: address, token_runtime_hash: hash,
    token_decimals: z.number().int().min(2).max(18), receiving_address: address,
    authority_reference: reason, code_review_reference: reason, valid_until: z.string().datetime({ offset: true }),
    standard_immutable_token_acknowledged: z.literal(true), synthetic_conversion_acknowledged: z.literal(true),
  }).strict() }).strict(),
  z.object({ command: z.literal('approve_funding_route'), key: id, payload: z.object({ route_id: id, expected_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('revoke_funding_route'), key: id, payload: z.object({ route_id: id, expected_revision: revision, reason }).strict() }).strict(),
  z.object({ command: z.literal('open_funding_obligation'), key: id, payload: z.object({ subscription_id: id, route_id: id }).strict() }).strict(),
  z.object({ command: z.literal('submit_funding_reference'), key: id, payload: z.object({
    obligation_id: id, expected_revision: revision, expected_route_revision: revision, payer_address: address, transaction_hash: hash,
    log_index: z.number().int().min(0).max(2147483647), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  }).strict() }).strict(),
  z.object({ command: z.literal('propose_funding_acceptance'), key: id, payload: z.object({ reference_id: id, expected_revision: revision, expected_obligation_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('reconcile_funding'), key: id, payload: z.object({ reference_id: id, expected_revision: revision, expected_obligation_revision: revision, evidence_set_hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict() }).strict(),
  z.object({ command: z.literal('propose_funding_exception'), key: id, payload: z.object({ reference_id: id, expected_revision: revision, expected_obligation_revision: revision, decision: z.enum(['REJECTED_UNPAID', 'UNAPPLIED']), reason }).strict() }).strict(),
  z.object({ command: z.literal('resolve_funding_exception'), key: id, payload: z.object({ reference_id: id, expected_revision: revision, expected_obligation_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('propose_funding_reversal'), key: id, payload: z.object({ journal_id: id, expected_obligation_revision: revision, reason }).strict() }).strict(),
  z.object({ command: z.literal('approve_funding_reversal'), key: id, payload: z.object({ reversal_id: id, expected_obligation_revision: revision }).strict() }).strict(),
] as const

export const fundingRouteSchema = z.object({
  id, product_id: id, organisation_id: id, product_revision: revision, terms_hash: z.string(), revision,
  status: z.enum(['PROPOSED', 'APPROVED', 'REVOKED']), chain_id: z.literal(80002), token_address: address,
  token_runtime_hash: hash, token_decimals: z.number().int().min(2).max(18), receiving_address: address,
  authority_reference: z.string(), code_review_reference: z.string(), valid_until: z.string(),
  verification_status: observationStatus, proposed_by: id, approved_by: id.nullable(), allowed_actions: actions,
})
export type FundingRoute = z.infer<typeof fundingRouteSchema>

export const fundingObligationSchema = z.object({
  id, subscription_id: id, investment_account_id: id, investor_id: id, product_id: id, organisation_id: id, route_id: id,
  revision, state: z.enum(['AWAITING_FUNDING', 'EVIDENCE_REVIEW', 'PARTIAL', 'OVERPAID', 'RECONCILED', 'UNAPPLIED', 'REVERSED', 'CANCELLED']),
  amount_minor: units, currency: z.literal('ZAR_TEST'), token_amount_base_units: units, token_decimals: z.number().int().min(2).max(18),
  observed_amount_base_units: units, posted_amount_base_units: units, reservation_status: z.enum(['AWAITING_FUNDING', 'CANCELLED']),
  evidence_set_hash: z.string().regex(/^[0-9a-f]{64}$/), created_at: z.string(), allowed_actions: actions,
})
export type FundingObligation = z.infer<typeof fundingObligationSchema>

export const fundingReferenceSchema = z.object({
  id, obligation_id: id, revision, status: z.enum(['SUBMITTED', 'VERIFIED', 'ACCEPTANCE_PROPOSED', 'POSTED', 'EXCEPTION_PROPOSED', 'REJECTED_UNPAID', 'UNAPPLIED']),
  payer_address: address, transaction_hash: hash, log_index: z.number().int().nonnegative(),
  amount_base_units: units.nullable(), verification_status: observationStatus, last_observed_at: z.string().nullable(),
  block_hash: hash.nullable(), block_number: units.nullable(), observation_reason: z.string().nullable(),
  acceptance_proposed_by: id.nullable(), exception_decision: z.enum(['REJECTED_UNPAID', 'UNAPPLIED']).nullable(),
  exception_reason: z.string().nullable(), allowed_actions: actions,
})
export type FundingReference = z.infer<typeof fundingReferenceSchema>

export const fundingJournalSchema = z.object({
  id, obligation_id: id, reference_id: id, kind: z.enum(['FUNDING', 'REVERSAL']), amount_base_units: units,
  token_address: address, token_decimals: z.number().int().min(2).max(18), created_at: z.string(),
  original_journal_id: id.nullable(), posted_by: id, allowed_actions: actions,
  lines: z.array(z.object({ account: z.enum(['TEST_SETTLEMENT_TOKEN_ASSET', 'TEST_CUSTOMER_FUNDING_LIABILITY']), side: z.enum(['DEBIT', 'CREDIT']), amount_base_units: units })).length(2),
})
export type FundingJournal = z.infer<typeof fundingJournalSchema>
export const fundingReversalSchema = z.object({
  id, obligation_id: id, journal_id: id, status: z.enum(['PROPOSED', 'APPROVED']), reason: z.string(),
  proposed_by: id, approved_by: id.nullable(), allowed_actions: actions,
})
export type FundingReversal = z.infer<typeof fundingReversalSchema>
export const fundingSnapshotSchema = z.object({
  routes: z.array(fundingRouteSchema), obligations: z.array(fundingObligationSchema), references: z.array(fundingReferenceSchema),
  journals: z.array(fundingJournalSchema), reversals: z.array(fundingReversalSchema),
})
export type FundingSnapshot = z.infer<typeof fundingSnapshotSchema>
export const fundingVerificationSchema = z.object({ kind: z.enum(['ROUTE', 'REFERENCE']), id }).strict()

/** Exact display only: never round token units or reinterpret them as bank cash. */
export function formatFundingUnits(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || !Number.isInteger(decimals) || decimals < 2 || decimals > 18) return 'Unavailable'
  const amount = BigInt(value), divisor = 10n ** BigInt(decimals)
  const whole = (amount / divisor).toLocaleString('en-ZA')
  const fraction = (amount % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
