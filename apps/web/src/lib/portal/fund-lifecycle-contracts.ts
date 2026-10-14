import { z } from 'zod'
import { portalContextMatches, portalOperatingContextSchema, type PortalOperatingContext } from './operating-context'

/** Shared business vocabulary. Only the scoped database projection supplies actions or completion. */
const id = z.string().uuid()
const revision = z.number().int().positive()
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value))
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
export const fundStageKeys = ['PREPARATION', 'APPROVAL', 'DEPLOYMENT', 'OPENING', 'SUBSCRIPTION', 'PAYMENT', 'ISSUANCE', 'HOLDINGS'] as const
export const fundOperationStates = ['REQUESTED', 'APPROVAL_PENDING', 'APPROVED', 'SIGNING', 'BROADCAST', 'MINED', 'CONFIRMING', 'FINAL', 'REJECTED', 'SIGNING_FAILED', 'UNKNOWN', 'REPLACED', 'REVERTED', 'REORGED', 'CANCELLED', 'EXPIRED'] as const
export const fundCommands = ['request_fund_deployment', 'approve_fund_deployment', 'record_fund_transaction', 'request_fund_payment_allocation_basis', 'approve_fund_payment_allocation_basis', 'request_fund_allocation', 'approve_fund_allocation', 'request_fund_issuance', 'approve_fund_issuance', 'bind_fund_delivery_wallet', 'cancel_fund_operation'] as const
export type FundCommand = (typeof fundCommands)[number]
export function isFundLifecycleCommand(command: string): command is FundCommand { return (fundCommands as readonly string[]).includes(command) }

const operationPayload = z.object({ operation_id: id, expected_revision: revision }).strict()
export const fundCommandOptions = [
  z.object({ command: z.literal('request_fund_deployment'), key: id, payload: z.object({ product_id: id, expected_revision: revision, manifest_id: id, signer_policy_id: id }).strict() }).strict(),
  z.object({ command: z.literal('approve_fund_deployment'), key: id, payload: operationPayload }).strict(),
  z.object({ command: z.literal('record_fund_transaction'), key: id, payload: operationPayload.extend({ transaction_hash: hash }).strict() }).strict(),
  z.object({ command: z.literal('request_fund_payment_allocation_basis'), key: id, payload: z.object({ subscription_id: id, expected_basis_hash: digest }).strict() }).strict(),
  z.object({ command: z.literal('approve_fund_payment_allocation_basis'), key: id, payload: z.object({ basis_id: id, expected_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('request_fund_allocation'), key: id, payload: z.object({ subscription_id: id, expected_obligation_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('approve_fund_allocation'), key: id, payload: z.object({ allocation_id: id, expected_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('request_fund_issuance'), key: id, payload: z.object({ allocation_id: id, expected_revision: revision }).strict() }).strict(),
  z.object({ command: z.literal('approve_fund_issuance'), key: id, payload: operationPayload }).strict(),
  z.object({ command: z.literal('bind_fund_delivery_wallet'), key: id, payload: z.object({ investment_account_id: id, product_id: id, wallet_proof_id: id }).strict() }).strict(),
  z.object({ command: z.literal('cancel_fund_operation'), key: id, payload: operationPayload.extend({ reason: z.string().trim().min(20).max(2000) }).strict() }).strict(),
] as const

export const fundActionSchema = z.object({
  action_id: z.string().min(1).max(160), command: z.enum(fundCommands).nullable(), record_id: id,
  expected_revision: revision, label: z.string().min(1).max(120), reason_code: z.string().max(120).nullable(),
  owner_role: z.string().min(1).max(80), can_execute: z.boolean(),
  /** Data for this strict command only; never an arbitrary URL or transaction supplied by the client. */
  payload: z.record(z.unknown()).nullable(),
})
export const fundStageSchema = z.object({
  key: z.enum(fundStageKeys), state: z.enum(['COMPLETE', 'CURRENT', 'WAITING', 'BLOCKED', 'NOT_STARTED']),
  label: z.string().max(100), description: z.string().max(600), reason_code: z.string().max(120).nullable(),
  owner_role: z.string().max(80), evidence_ids: z.array(id).max(50),
})
export const fundIntentSchema = z.object({
  operation_id: id, operation_revision: revision, kind: z.enum(['DEPLOYMENT', 'ISSUANCE']),
  intent_hash: digest, binding_hash: digest, authority_policy_hash: digest, authority_epoch: revision,
  expires_at: z.string().datetime({ offset: true }), chain_id: z.number().int().positive(),
  signer_address: address, execution_account: address, target_address: address,
  transaction_data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(131074), value_base_units: z.literal('0'),
  /** A prepared request must declare its actual execution mechanism; EOA is not an institutional fallback. */
  execution_mode: z.literal('SAFE_TRANSACTION'),
  safe_transaction: z.object({
    to: address, value: z.literal('0'), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(131074),
    operation: z.literal(0), safeTxGas: amount, baseGas: amount, gasPrice: amount,
    gasToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/), refundReceiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/), nonce: amount,
  }).strict(),
})
export const fundOperationSchema = z.object({
  id, product_id: id, offering_revision_id: id, subscription_id: id.nullable(), allocation_id: id.nullable(),
  revision, kind: z.enum(['DEPLOYMENT', 'ISSUANCE']), state: z.enum(fundOperationStates),
  chain_id: z.number().int().positive(), transaction_hash: hash.nullable(),
  token_address: address.nullable(), controller_address: address.nullable(),
  manifest_id: id, manifest_hash: digest, intent_hash: digest, expires_at: z.string(),
  confirmations: z.number().int().nonnegative().nullable(), required_confirmations: z.number().int().positive(),
  reason_code: z.string().max(120).nullable(), intent: fundIntentSchema.nullable(), actions: z.array(fundActionSchema).max(20),
  signing_owner_address: address.nullable().optional(), signer_threshold: z.number().int().min(2).max(20).nullable().optional(),
  signature_count: z.number().int().min(0).max(20).optional(),
})
export const fundHoldingSchema = z.object({
  id, product_id: id, investment_account_id: id, subscription_id: id, register_entry_id: id,
  issuance_operation_id: id, product_name: z.string().max(200), class_name: z.string().max(200),
  units_base: amount, security_unit_decimals: z.number().int().min(0).max(18),
  token_address: address, wallet_address: address, chain_id: z.number().int().positive(),
  transaction_hash: hash, recorded_at: z.string(), state: z.literal('RECONCILED'),
  /** No invented performance. Valuation is absent until a reviewed valuation exists. */
  valuation: z.object({ amount_base: amount, currency: z.string().max(16), decimals: z.number().int().min(0).max(18), as_of: z.string(), evidence_id: id }).nullable(),
})
export const fundPaymentAllocationBasisSchema = z.object({
  id: id.nullable(), revision: revision.nullable(), basis_hash: digest,
  status: z.enum(['NOT_REQUESTED', 'REQUESTED', 'APPROVED', 'NO_LONGER_CURRENT']), current: z.boolean(),
  approved_at: z.string().datetime({ offset: true }).nullable(), approved_until: z.string().datetime({ offset: true }).nullable(),
  units_base: amount.refine(value => /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) > 0n),
  amount_base_units: amount.refine(value => /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) > 0n),
}).strict().superRefine((basis, context) => {
  if (basis.current && (basis.status !== 'APPROVED' || !basis.id || !basis.revision || !basis.approved_at || !basis.approved_until)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Current issuer allocation approval must have its saved evidence.' })
  }
  if (basis.status === 'NOT_REQUESTED' && (basis.id !== null || basis.revision !== null || basis.current)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'An unrequested basis cannot claim an approval record.' })
  }
})
export const fundOrderSchema = z.object({
  subscription_id: id, product_id: id, investment_account_id: id, allocation_id: id.nullable(), allocation_revision: revision.nullable(),
  units_base: amount, security_unit_decimals: z.number().int().min(0).max(18),
  funding: z.object({
    obligation_id: id, obligation_revision: revision, route_id: id, route_revision: revision,
    currency: z.literal('TST'), settlement_decimals: z.literal(6), chain_id: z.literal(80002),
    settlement_token_address: address, beneficiary_address: address, required_base_units: amount,
    verified_base_units: amount, posted_base_units: amount, evidence_set_hash: digest,
    state: z.enum(['AWAITING_FUNDING', 'EVIDENCE_REVIEW', 'PARTIAL', 'OVERPAID', 'RECONCILED', 'UNAPPLIED', 'REVERSED', 'CANCELLED']),
    can_pay: z.boolean(),
  }).nullable(),
  delivery_wallet: z.object({ proof_id: id, address, chain_id: z.number().int().positive(), effective: z.boolean() }).nullable(),
  payment_allocation_basis: fundPaymentAllocationBasisSchema.nullable().optional(),
  issuance_operation_id: id.nullable(), actions: z.array(fundActionSchema).max(20),
})
export const fundProductLifecycleSchema = z.object({
  product_id: id, organisation_id: id, native_organisation_id: id, product_revision: revision,
  offering_revision_id: id.nullable(), class_id: id.nullable(), product_name: z.string().max(200),
  terms_hash: digest, configuration_hash: digest.nullable(),
  availability: z.enum(['AVAILABLE', 'DEPENDENCY_NOT_ADMITTED']),
  stages: z.array(fundStageSchema).length(8), next_action: fundActionSchema.nullable(),
  operations: z.array(fundOperationSchema).max(500), orders: z.array(fundOrderSchema).max(500),
  holdings: z.array(fundHoldingSchema).max(500), actions: z.array(fundActionSchema).max(20),
})
export const fundLifecycleSnapshotSchema = z.object({
  schema_version: z.literal(1), projection_revision: revision, actor_id: id,
  environment: z.enum(['TESTNET', 'MAINNET']), operating_context: portalOperatingContextSchema,
  observed_at: z.string().datetime({ offset: true }), availability: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  reason_code: z.string().max(120).nullable(), products: z.array(fundProductLifecycleSchema).max(500),
  requests: z.array(z.object({ key: id, command: z.enum(fundCommands) })).max(500).optional(),
})
export type FundLifecycleSnapshot = z.infer<typeof fundLifecycleSnapshotSchema>
export type FundProductLifecycle = z.infer<typeof fundProductLifecycleSchema>
export type FundLifecycleOperation = z.infer<typeof fundOperationSchema>
export type FundLifecycleAction = z.infer<typeof fundActionSchema>
export type FundTransactionIntent = z.infer<typeof fundIntentSchema>
export type FundLifecycleHolding = z.infer<typeof fundHoldingSchema>

export const fundTransactionRequestSchema = z.object({ operation_id: id, expected_revision: revision, operating_context: portalOperatingContextSchema }).strict()
export const fundSafeSignatureRequestSchema = fundTransactionRequestSchema.extend({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict()
export const fundPaymentRequestSchema = z.object({ subscription_id: id, expected_obligation_revision: revision, payer_address: address, operating_context: portalOperatingContextSchema }).strict()
export const fundPaymentSubmitSchema = z.object({ payment_id: id, operating_context: portalOperatingContextSchema }).strict()
export const fundPaymentReferenceSchema = fundPaymentSubmitSchema.extend({ transaction_hash: hash }).strict()
export const fundPaymentIntentSchema = z.object({
  payment_id: id, subscription_id: id, obligation_id: id, obligation_revision: revision, route_id: id, route_revision: revision,
  actor_id: id, payer_address: address, chain_id: z.literal(80002), token_address: address, beneficiary_address: address,
  amount_base_units: amount.refine(value => BigInt(value) > 0n), decimals: z.literal(6), currency: z.literal('TST'),
  data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/), expires_at: z.string().datetime({ offset: true }),
  state: z.enum(['PREPARED', 'BROADCAST', 'UNKNOWN']), transaction_hash: hash.nullable(),
}).strict()
export type FundPaymentIntent = z.infer<typeof fundPaymentIntentSchema>

export function validatedFundLifecycle(value: unknown, actorId: string, context: PortalOperatingContext, environment: 'TESTNET' | 'MAINNET'): FundLifecycleSnapshot | null {
  const parsed = fundLifecycleSnapshotSchema.safeParse(value)
  if (!parsed.success || parsed.data.actor_id !== actorId || parsed.data.environment !== environment
    || !portalContextMatches(parsed.data.operating_context, context)) return null
  for (const product of parsed.data.products) {
    if (new Set(product.stages.map(stage => stage.key)).size !== fundStageKeys.length) return null
    if (product.operations.some(operation => operation.product_id !== product.product_id)) return null
    if (product.orders.some(order => order.product_id !== product.product_id)) return null
    if (product.orders.some(order => order.payment_allocation_basis && (order.payment_allocation_basis.units_base !== order.units_base
      || order.funding && order.payment_allocation_basis.amount_base_units !== order.funding.required_base_units
      || order.funding?.can_pay && !order.payment_allocation_basis.current))) return null
    if (product.holdings.some(holding => holding.product_id !== product.product_id)) return null
    for (const action of [...product.actions, ...product.operations.flatMap(operation => operation.actions), ...product.orders.flatMap(order => order.actions)]) {
      // A transaction-reference action describes the current operation only.
      // The user supplies its already-existing hash in the dedicated recovery
      // control; the submitted command still requires the full strict schema.
      if (action.command === 'record_fund_transaction' && action.can_execute) {
        const template = operationPayload.safeParse(action.payload)
        if (!template.success || template.data.operation_id !== action.record_id || template.data.expected_revision !== action.expected_revision) return null
      } else if (action.command && action.can_execute && !fundCommandOptions.some(option => option.safeParse({ command: action.command, key: '00000000-0000-4000-8000-000000000001', payload: action.payload }).success)) return null
    }
  }
  return parsed.data
}

export function hasFundLifecycleCommand(snapshot: FundLifecycleSnapshot, command: string): boolean {
  return snapshot.availability === 'AVAILABLE' && snapshot.products.some(product => [
    ...product.actions, ...(product.next_action ? [product.next_action] : []),
    ...product.operations.flatMap(operation => operation.actions), ...product.orders.flatMap(order => order.actions),
  ].some(action => action.can_execute && action.command === command))
}
