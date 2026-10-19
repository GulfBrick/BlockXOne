import { z } from 'zod'
import { portalOperatingContextSchema } from './operating-context'

const id = z.string().uuid()
const revision = z.number().int().positive()
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value))
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const decimalPattern = /^(0|[1-9][0-9]{0,77})$/
const amount = z.string().regex(decimalPattern).refine(value => decimalPattern.test(value) && BigInt(value) < 2n ** 256n)
const positiveAmount = amount.refine(value => decimalPattern.test(value) && BigInt(value) > 0n)
const instant = z.string().datetime({ offset: true })

/** Ordered bootstrap infrastructure only. Completion is not release admission. */
export const fundSetupStepKeys = [
  'token_implementation', 'ctr_implementation', 'irs_implementation', 'ir_implementation',
  'tir_implementation', 'mc_implementation', 'oid_implementation', 'oid_authority',
  'oid_factory', 'trex_authority', 'trex_version', 'trex_factory', 'ia_factory',
  'trex_factory_binding', 'ia_factory_binding', 'oid_factory_binding', 'controller',
  'factory_handoff', 'trex_authority_handoff', 'oid_authority_handoff', 'oid_factory_handoff',
  'holding_module', 'claim_issuer', 'token_identity', 'settlement',
] as const
export const fundSetupStepKeySchema = z.enum(fundSetupStepKeys)
export type FundSetupStepKey = z.infer<typeof fundSetupStepKeySchema>
export const fundSetupExecutionStepKeySchema = z.union([fundSetupStepKeySchema, z.literal('safe_creation')])
export const fundSetupStepStates = ['NOT_STARTED', 'PREPARED', 'UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'REVERTED', 'REPLACED', 'REORGED'] as const

export const fundSetupConfigurationSchema = z.object({
  safe_address: address, identity_management_key: address, claim_management_key: address,
  token_management_key: address, maximum_holding_base_units: positiveAmount,
  tst_initial_holder: address, tst_initial_supply_base_units: positiveAmount,
}).strict()
export const fundSetupSafeConfigurationSchema = z.object({
  owners: z.array(address).min(2).max(20), threshold: z.number().int().min(2).max(20), salt_nonce: amount,
}).strict().superRefine((value, context) => {
  if (new Set(value.owners.map(owner => owner.toLowerCase())).size !== value.owners.length || value.threshold > value.owners.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Safe signing requires distinct owner keys and a valid threshold.' })
  }
})
export const fundSetupIntentSchema = z.object({
  version: z.literal(1), chain_id: z.literal(80002), step_key: fundSetupExecutionStepKeySchema,
  kind: z.enum(['CREATE', 'CALL']), sender: address, nonce: amount, value: z.literal('0'),
  to: address.nullable(), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(262146),
  expected_address: address, artifact_name: z.string().min(1).max(160), expected_runtime_hash: hash,
  checks: z.array(z.object({ address, data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(16386), result: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(16386), storage_slot: amount.optional() }).strict()).max(64),
  configuration_hash: digest, catalog_hash: digest,
}).strict().superRefine((value, context) => {
  if ((value.kind === 'CREATE') !== (value.to === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Creation has no target; configuration calls have a pinned target.' })
  if (value.step_key === 'safe_creation' && (value.kind !== 'CALL' || value.to?.toLowerCase() !== '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67' || value.artifact_name !== 'SafeProxy')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Safe creation must use the canonical pinned factory.' })
  }
})
export type FundSetupIntent = z.infer<typeof fundSetupIntentSchema>

export const fundSetupStepSchema = z.object({
  id, step_key: fundSetupExecutionStepKeySchema, ordinal: z.number().int().min(0).max(25),
  kind: z.enum(['CREATE', 'CALL']), revision, state: z.enum(fundSetupStepStates),
  actor_id: id.nullable(), sender: address.nullable(), nonce: amount.nullable(),
  intent_hash: digest.nullable(), intent: fundSetupIntentSchema.nullable(),
  expires_at: instant.nullable(), claimed_at: instant.nullable(), transaction_hash: hash.nullable(),
  deployed_address: address.nullable(), observation_id: id.nullable(), reason_code: z.string().max(160).nullable(),
}).strict()
export const fundSetupRoleplayPolicySchema = z.object({
  policy_id: id, epoch: revision, expires_at: instant,
  label: z.literal('TEST ROLE PLAY - one operator; not independent human approval'),
}).strict()
export const fundSetupRecordSchema = z.object({
  id, revision, actor_id: id, operating_context: portalOperatingContextSchema,
  state: z.enum(['AWAITING_SAFE', 'READY', 'IN_PROGRESS', 'COMPLETE_NOT_ADMITTED', 'REVOKED', 'EXPIRED', 'STALE', 'RECOVERY_REQUIRED']),
  recovery_hold: z.boolean(), recovery_reason: z.string().max(160).nullable(), recovery_observation_id: id.nullable(),
  expires_at: instant, safe_address: address.nullable(), safe_state: z.enum(['NOT_IMPORTED', 'REQUESTED', 'OBSERVED_NOT_ADMITTED', 'VERIFIED']),
  safe_owners: z.array(address).max(20), safe_threshold: z.number().int().min(2).max(20).nullable(),
  configuration: fundSetupConfigurationSchema.nullable(), setup_configuration_hash: digest.nullable(), dependencies: z.record(fundSetupStepKeySchema, address),
  safe_configuration: fundSetupSafeConfigurationSchema.nullable(), safe_creation: fundSetupStepSchema.nullable(),
  steps: z.array(fundSetupStepSchema).length(25), next_step: fundSetupExecutionStepKeySchema.nullable(),
  saved_intent: fundSetupIntentSchema.nullable(), admission_reason: z.literal('RELEASE_CONFORMANCE_AND_GOVERNANCE_RECEIPTS_REQUIRED'),
}).strict().superRefine((record, context) => {
  if (record.steps.some((step, index) => step.step_key !== fundSetupStepKeys[index] || step.ordinal !== index + 1)
    || record.safe_creation && (record.safe_creation.step_key !== 'safe_creation' || record.safe_creation.ordinal !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'The saved setup graph must match the canonical ordered steps.' })
  }
})
export const fundSetupSnapshotSchema = z.object({
  schema_version: z.literal(1), actor_id: id, environment: z.literal('TESTNET'),
  operating_context: portalOperatingContextSchema, observed_at: instant,
  product_id: id, product_revision: revision, offering_revision_id: id.nullable(),
  terms_hash: digest, configuration_hash: digest.nullable(),
  source_pin: z.literal('b6c5fabf86e733ede017fef754d59eeb8f80e3f4'),
  roleplay_policy: fundSetupRoleplayPolicySchema.nullable(),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE']), reason_code: z.string().max(160).nullable(),
  setup: fundSetupRecordSchema.nullable(),
}).strict()
export type FundSetupSnapshot = z.infer<typeof fundSetupSnapshotSchema>

export const fundSetupReadRequestSchema = z.object({ product_id: id, operating_context: portalOperatingContextSchema }).strict()
const setupRevision = z.object({ setup_id: id, expected_revision: revision }).strict()
export const fundSetupCommandRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('CREATE'), request_key: id, payload: z.object({ product_id: id, expected_revision: revision }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('IMPORT_SAFE'), request_key: id, payload: setupRevision.extend({ safe_address: address }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('CONFIGURE'), request_key: id, payload: setupRevision.extend({ configuration: fundSetupConfigurationSchema }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('CONFIGURE_SAFE'), request_key: id, payload: setupRevision.extend({ owners: z.array(address).min(2).max(20), threshold: z.number().int().min(2).max(20) }).strict().superRefine((value, context) => {
    if (new Set(value.owners.map(owner => owner.toLowerCase())).size !== value.owners.length || value.threshold > value.owners.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Safe signing requires distinct owner keys and a valid threshold.' })
  }), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('CLAIM_STEP'), request_key: id, payload: setupRevision.extend({ step_id: id, expected_step_revision: revision, intent_hash: digest }).strict(), operating_context: portalOperatingContextSchema }).strict(),
  z.object({ command: z.literal('RECORD_HASH'), request_key: id, payload: setupRevision.extend({ step_id: id, expected_step_revision: revision, transaction_hash: hash }).strict(), operating_context: portalOperatingContextSchema }).strict(),
])
export type FundSetupCommandRequest = z.infer<typeof fundSetupCommandRequestSchema>
/** PREPARE_STEP and OBSERVE are server adapter requests, not arbitrary SQL/client writers. */
export const fundSetupPrepareRequestSchema = setupRevision.extend({ step_key: fundSetupExecutionStepKeySchema, sender: address, operating_context: portalOperatingContextSchema }).strict()
export const fundSetupVerifyRequestSchema = setupRevision.extend({ step_id: id.nullable(), operating_context: portalOperatingContextSchema }).strict()

export const fundSetupPreparationSchema = z.object({
  setup_id: id, expected_revision: revision, actor_id: id, operating_context: portalOperatingContextSchema,
  environment: z.literal('TESTNET'), product_id: id, offering_revision_id: id, terms_hash: digest,
  configuration_hash: digest, setup_configuration_hash: digest, source_pin: z.literal('b6c5fabf86e733ede017fef754d59eeb8f80e3f4'),
  expires_at: instant, step_id: id, step_key: fundSetupExecutionStepKeySchema, expected_step_revision: revision,
  sender: address, configuration: fundSetupConfigurationSchema.nullable(), safe_configuration: fundSetupSafeConfigurationSchema.nullable(), dependencies: z.record(fundSetupStepKeySchema, address),
  roleplay_policy: fundSetupRoleplayPolicySchema.nullable(),
}).strict()
export type FundSetupPreparation = z.infer<typeof fundSetupPreparationSchema>
