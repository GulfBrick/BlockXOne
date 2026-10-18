import { z } from 'zod'
import { portalOperatingContextSchema } from './operating-context'
import type { FundAdmissionInput } from './fund-chain-admission'

const id = z.string().uuid(), revision = z.number().int().positive()
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value))
const digest = z.string().regex(/^[0-9a-f]{64}$/), hash = z.string().regex(/^0x[0-9a-f]{64}$/)
const amount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < 2n ** 256n)
const instant = z.string().datetime({ offset: true })
const ZERO = '0x0000000000000000000000000000000000000000'

export const fundAuthoritySafeTypes = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }
export const fundAuthoritySnapshotSchema = z.object({
  block: z.object({ number: amount, hash, timestamp: instant }).strict(),
  providers: z.array(z.object({ url: z.enum(['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co']),
    finalized_block_number: amount, finalized_block_hash: hash }).strict()).length(2)
    .refine(values => values[0].url !== values[1].url),
}).strict()
export const fundAuthorityAlignmentIntentSchema = z.object({
  version: z.literal(1), chain_id: z.literal(80002), admission_request_id: id,
  native_binding_hash: digest, reason_hash: hash, previous_epoch: revision, target_epoch: revision,
  controller_address: address, controller_runtime_hash: hash, factory_address: address,
  safe_address: address, safe_owners: z.array(address).min(2).max(20), safe_threshold: z.number().int().min(2).max(20),
  executor_address: address, executor_nonce: amount,
  safe_transaction: z.object({ to: address, value: z.literal('0'), data: z.string().regex(/^0x[0-9a-f]+$/).max(1026),
    operation: z.literal(0), safeTxGas: z.literal('0'), baseGas: z.literal('0'), gasPrice: z.literal('0'),
    gasToken: z.literal(ZERO), refundReceiver: z.literal(ZERO), nonce: amount }).strict(),
  safe_transaction_hash: hash, snapshot: fundAuthoritySnapshotSchema, valid_until: instant,
}).strict().superRefine((value, context) => {
  if (value.target_epoch !== value.previous_epoch + 1 || value.safe_transaction.to !== value.controller_address
    || new Set(value.safe_owners).size !== value.safe_owners.length || value.safe_threshold > value.safe_owners.length
    || value.safe_owners.some((owner, index) => index > 0 && owner <= value.safe_owners[index - 1])
    || !value.safe_owners.includes(value.executor_address) || BigInt(value.executor_nonce) >= 2n ** 64n) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The authority change must bind the current Safe, executor and exact next epoch.' })
  }
})
export type FundAuthorityAlignmentIntent = z.infer<typeof fundAuthorityAlignmentIntentSchema>
export const fundAuthoritySignatureSchema = z.object({ signer: address, signature: z.string().regex(/^0x[0-9a-f]{130}$/) }).strict()
export type FundAuthoritySignature = z.infer<typeof fundAuthoritySignatureSchema>
export const fundAuthorityAlignmentStates = ['NEW', 'PREPARED', 'SIGNING', 'UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'REVERTED', 'RECOVERY_REQUIRED'] as const
export const fundAuthorityAlignmentOperationSchema = z.object({
  id, revision, state: z.enum(fundAuthorityAlignmentStates), intent: fundAuthorityAlignmentIntentSchema.nullable(), intent_hash: digest.nullable(),
  signatures: z.array(fundAuthoritySignatureSchema).max(20), executor_nonce: amount.nullable(), transaction_hash: hash.nullable(),
  claimed_at: instant.nullable(), claim_key: id.nullable(), observation: z.lazy(() => fundAuthorityAlignmentObservationSchema).nullable(),
}).strict()
export type FundAuthorityAlignmentOperation = z.infer<typeof fundAuthorityAlignmentOperationSchema>

/** The internal reader injects the EXISTING canonical server schema; clients never import server-only code. */
const fundAuthorityAlignmentReadBaseSchema = z.object({
  schema_version: z.literal(1), environment: z.literal('TESTNET'), actor_id: id, operating_context: portalOperatingContextSchema,
  admission_request_id: id, setup_id: id, setup_revision: revision, input_hash: digest, native_binding_hash: digest, reason_hash: hash,
  authority_expires_at: instant, authorisation_receipt_id: id,
  operation: fundAuthorityAlignmentOperationSchema.nullable(),
}).strict()
export function createFundAuthorityAlignmentReadSchema(inputSchema: z.ZodType<FundAdmissionInput>) {
  return fundAuthorityAlignmentReadBaseSchema.extend({ input: inputSchema }).strict()
}
export type FundAuthorityAlignmentRead = z.infer<typeof fundAuthorityAlignmentReadBaseSchema> & { input: FundAdmissionInput }
export const fundAuthorityAlignmentPurposes = ['ALIGNMENT_READ', 'ALIGNMENT_WRITE', 'ADMISSION_READ', 'ADMISSION_WRITE'] as const
export type FundAuthorityAlignmentPurpose = typeof fundAuthorityAlignmentPurposes[number]

const scope = { setup_id: id, setup_revision: revision, operating_context: portalOperatingContextSchema }
const write = { ...scope, request_key: id }
const operation = { operation_id: id, expected_revision: revision }
export const fundAuthorityAlignmentRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...scope, action: z.literal('READ') }).strict(),
  z.object({ ...write, action: z.literal('PREPARE') }).strict(),
  z.object({ ...write, ...operation, action: z.literal('SIGN'), signing_address: address, signature: z.string().regex(/^0x[0-9a-f]{130}$/) }).strict(),
  z.object({ ...write, ...operation, action: z.literal('CLAIM') }).strict(),
  z.object({ ...write, ...operation, action: z.literal('HASH'), transaction_hash: hash }).strict(),
  z.object({ ...write, ...operation, action: z.literal('VERIFY') }).strict(),
])
export type FundAuthorityAlignmentRequest = z.infer<typeof fundAuthorityAlignmentRequestSchema>

export const fundAuthorityAlignmentExecutionSchema = z.object({
  chain_id: z.literal(80002), from: address, to: address, value: z.literal('0'),
  data: z.string().regex(/^0x[0-9a-f]+$/).max(16386), nonce: amount,
}).strict()
export type FundAuthorityAlignmentExecution = z.infer<typeof fundAuthorityAlignmentExecutionSchema>
export const fundAuthorityAlignmentObservationSchema = z.object({
  schema_version: z.literal(1), chain_id: z.literal(80002), status: z.enum(['PENDING', 'FINAL', 'REVERTED']),
  admission_request_id: id, native_binding_hash: digest, safe_transaction_hash: hash, reason_hash: hash, transaction_hash: hash,
  executor_address: address, executor_nonce: amount, safe_address: address, safe_nonce: amount, controller_address: address,
  previous_epoch: revision, target_epoch: revision, block_number: amount.nullable(), block_hash: hash.nullable(), confirmations: amount.nullable(),
  required_confirmations: z.number().int().min(1).max(10000), snapshot: fundAuthoritySnapshotSchema,
  receipt_hashes: z.array(digest).max(2), reason_code: z.string().max(160).nullable(),
  inner_execution_success: z.boolean(), epoch_verified: z.boolean(), observed_epoch: revision.nullable(),
  epoch_event: z.object({ previous_epoch: revision, target_epoch: revision, reason_hash: hash }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'FINAL' && (!value.inner_execution_success || !value.epoch_verified || value.observed_epoch !== value.target_epoch
    || !value.epoch_event || value.epoch_event.previous_epoch !== value.previous_epoch || value.epoch_event.target_epoch !== value.target_epoch
    || value.epoch_event.reason_hash !== value.reason_hash || value.block_number === null || value.block_hash === null
    || value.confirmations === null || BigInt(value.confirmations) < BigInt(value.required_confirmations) || value.reason_code !== null
    || value.receipt_hashes.length !== 2 || value.receipt_hashes[0] !== value.receipt_hashes[1])) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Final authority alignment requires matching finalized transaction, inner success, epoch event and current getter evidence.' })
  }
})
export type FundAuthorityAlignmentObservation = z.infer<typeof fundAuthorityAlignmentObservationSchema>
const publicOperation = fundAuthorityAlignmentOperationSchema.omit({ signatures: true, observation: true }).extend({ signing_addresses: z.array(address).max(20) })
export const fundAuthorityAlignmentResponseSchema = z.object({
  actor_id: id, operating_context: portalOperatingContextSchema, setup_id: id, setup_revision: revision,
  admission_request_id: id, native_binding_hash: digest, reason_hash: hash,
  previous_epoch: revision, target_epoch: revision, already_aligned: z.boolean(),
  operation: publicOperation.nullable(), execution: fundAuthorityAlignmentExecutionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (!value.execution) return
  const op = value.operation, intent = op?.intent
  if (!op || op.state !== 'UNKNOWN' || !op.claimed_at || !op.claim_key || !intent
    || new Set(op.signing_addresses).size < intent.safe_threshold || op.signing_addresses.some(owner => !intent.safe_owners.includes(owner))
    || value.execution.from !== intent.executor_address || value.execution.to !== intent.safe_address
    || value.execution.nonce !== intent.executor_nonce || value.execution.chain_id !== intent.chain_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'An actionable Safe execution requires the exact single-flight claim and current signer quorum.' })
  }
})
export type FundAuthorityAlignmentResponse = z.infer<typeof fundAuthorityAlignmentResponseSchema>
