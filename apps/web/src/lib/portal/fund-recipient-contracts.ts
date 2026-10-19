import { z } from 'zod'
import { portalOperatingContextSchema } from './operating-context'

const id = z.string().uuid(), revision = z.number().int().positive()
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value))
const hash = z.string().regex(/^0x[0-9a-f]{64}$/), digest = z.string().regex(/^[0-9a-f]{64}$/)
const instant = z.string().datetime({ offset: true })
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
const signature = z.string().regex(/^0x[0-9a-f]{130}$/)
export const fundRecipientPhaseSchema = z.enum(['CREATE_IDENTITY', 'ADD_CLAIM', 'REGISTER_IDENTITY', 'REVOKE_CLAIM'])
const observerPairs = [
  ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'],
  ['https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co'],
  ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'],
  ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2'],
] as const
const provider = z.object({ url: z.enum(['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2']),
  finalized_block_number: quantity, finalized_block_hash: hash }).strict()
const observed = z.object({ block: z.object({ number: quantity, hash, timestamp: instant }).strict(),
  providers: z.tuple([provider, provider]) }).strict()
const safeTransaction = z.object({ to: address, value: z.literal('0'), data: z.string().regex(/^0x(?:[0-9a-f]{2})+$/),
  operation: z.literal(0), safeTxGas: z.literal('0'), baseGas: z.literal('0'), gasPrice: z.literal('0'),
  gasToken: z.string().regex(/^0x[0-9a-f]{40}$/), refundReceiver: z.string().regex(/^0x[0-9a-f]{40}$/), nonce: quantity }).strict()
/** Client-safe wire shape only: no artifact bytecode, credentials or private worker imports. */
export const fundRecipientIntentSchema = z.object({
  version: z.literal(1), chain_id: z.literal(80002), operation_id: id, operation_revision: revision,
  phase: fundRecipientPhaseSchema, expectation_hash: digest, catalog_hash: digest,
  sender_address: address, sender_nonce: quantity, execution_mode: z.enum(['EOA_TRANSACTION', 'SAFE_TRANSACTION']),
  to: address.nullable(), value: z.literal('0'), transaction_data: z.string().regex(/^0x(?:[0-9a-f]{2})+$/).max(262146),
  expected_identity_address: address, claim_data: z.string().regex(/^0x(?:[0-9a-f]{2})+$/), claim_data_hash: hash, claim_id: hash,
  safe_transaction: safeTransaction.nullable(), safe_transaction_hash: hash.nullable(), safe_owners: z.array(address).min(2).max(20),
  safe_threshold: z.number().int().min(2).max(20), valid_until: instant, claim_valid_until: instant,
  expiry_enforced_on_chain: z.literal(false), snapshot: observed,
}).strict().superRefine((value, context) => {
  const isSafe = value.phase === 'REGISTER_IDENTITY'
  if (isSafe !== (value.execution_mode === 'SAFE_TRANSACTION') || isSafe !== (value.safe_transaction !== null)
    || isSafe !== (value.safe_transaction_hash !== null) || (value.phase === 'CREATE_IDENTITY') !== (value.to === null)
    || value.safe_threshold > value.safe_owners.length || new Set(value.safe_owners).size !== value.safe_owners.length
    || !observerPairs.some(([first, second]) => (value.snapshot.providers[0].url === first && value.snapshot.providers[1].url === second)
      || (value.snapshot.providers[0].url === second && value.snapshot.providers[1].url === first))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The saved recipient instruction is inconsistent.' })
  }
})
export type FundRecipientIntentWire = z.infer<typeof fundRecipientIntentSchema>
export type FundRecipientIntent = FundRecipientIntentWire
export const fundRecipientCaseSchema = z.object({
  id, revision, product_id: id, offering_revision_id: id, manifest_id: id, investment_account_id: id, delivery_binding_id: id,
  holder_user_id: id, wallet_proof_id: id, wallet_address: address, eligibility_case_id: id, eligibility_revision: revision,
  claim_topic: quantity, claim_signer_address: address, country_alpha2: z.string().regex(/^[A-Z]{2}$/), country_code: z.number().int().min(1).max(999),
  product_binding_hash: digest, account_binding_hash: digest, eligibility_binding_hash: digest, claim_valid_until: instant,
  identity_address: address.nullable(), state: z.enum(['IDENTITY_REQUIRED', 'CLAIM_SIGNATURE_REQUIRED', 'CLAIM_INSTALL_REQUIRED', 'REGISTRATION_REQUIRED', 'READY', 'REVOKED', 'RECOVERY_REQUIRED']),
  pending_signature_id: id.nullable(), claim_signature_id: id.nullable(), registration_observation_id: id.nullable(),
  roleplay_policy_id: id.nullable(), roleplay_epoch: revision.nullable(), created_by: id, created_context: portalOperatingContextSchema, created_at: instant,
}).strict()
export type FundRecipientCase = z.infer<typeof fundRecipientCaseSchema>
export const fundRecipientOperationSchema = z.object({
  id, revision, phase: fundRecipientPhaseSchema, state: z.enum(['REQUESTED', 'PREPARED', 'UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'FAILED', 'RECOVERY_REQUIRED']),
  actor_id: id, operating_context: portalOperatingContextSchema, sender_address: address, expires_at: instant,
  transaction_hash: hash.nullable(), intent: fundRecipientIntentSchema.nullable(),
  signatures: z.array(z.object({ id, actor_id: id, signing_address: address, status: z.enum(['UNVERIFIED', 'VERIFIED']) }).strict()).max(20),
}).strict()
export type FundRecipientOperation = z.infer<typeof fundRecipientOperationSchema>
export const fundRecipientSnapshotSchema = z.object({ schema_version: z.literal(1), environment: z.literal('TESTNET'), actor_id: id,
  operating_context: portalOperatingContextSchema, case: fundRecipientCaseSchema, operations: z.array(fundRecipientOperationSchema).max(100),
  expiry_enforced_on_chain: z.literal(false) }).strict()
export type FundRecipientSnapshot = z.infer<typeof fundRecipientSnapshotSchema>
export const fundRecipientReadRequestSchema = z.object({ case_id: id, operating_context: portalOperatingContextSchema }).strict()
export const fundRecipientFindRequestSchema = z.object({ delivery_binding_id: id, operating_context: portalOperatingContextSchema }).strict()
export const fundRecipientClaimSigningRequestSchema = fundRecipientReadRequestSchema
const operationRequest = z.object({ operation_id: id, expected_revision: revision, operating_context: portalOperatingContextSchema }).strict()
export const fundRecipientPrepareRequestSchema = operationRequest
export const fundRecipientVerifyRequestSchema = operationRequest
export const fundRecipientClaimRequestSchema = operationRequest.extend({ request_key: id }).strict()
export const fundRecipientSubmitClaimRequestSchema = z.object({ case_id: id, expected_revision: revision, request_key: id,
  signature, operating_context: portalOperatingContextSchema }).strict()
export const fundRecipientRecordSignatureRequestSchema = fundRecipientClaimRequestSchema.extend({ signing_address: address, signature }).strict()
export const fundRecipientCommandRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('CREATE_CASE'), request_key: id, payload: z.object({ delivery_binding_id: id }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('REQUEST_OPERATION'), request_key: id, payload: z.object({ case_id: id, expected_revision: revision,
    phase: fundRecipientPhaseSchema, sender_address: address }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('RECORD_HASH'), request_key: id, payload: z.object({ operation_id: id, expected_revision: revision,
    transaction_hash: hash }).strict(), operating_context: portalOperatingContextSchema }).strict(),
])
export type FundRecipientCommand = z.infer<typeof fundRecipientCommandRequestSchema>
export const fundRecipientSigningRequestSchema = z.object({ method: z.literal('personal_sign'), message: hash, signer_address: address,
  identity_address: address, claim_topic: quantity, claim_data: z.string().regex(/^0x(?:[0-9a-f]{2})+$/), claim_data_hash: hash,
  expiry_enforced_on_chain: z.literal(false) }).strict()
export type FundRecipientClaimSigningRequest = z.infer<typeof fundRecipientSigningRequestSchema>
