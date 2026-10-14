import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { FundLifecycleError, fundLifecycleEnvironment } from './fund-lifecycle-server'
import { callFundWorker } from './fund-lifecycle-worker'
import { fundSetupIntentSchema, fundSetupPreparationSchema, fundSetupSnapshotSchema, type FundSetupCommandRequest, type FundSetupSnapshot } from './fund-setup-contracts'
import { buildSafeCreationIntent, buildSetupIntent, FundSetupChainError, observeSetupSafe, observeSetupStep, readSetupNonce, type FundSetupAddresses } from './fund-setup-chain'

const id = z.string().uuid(), digest = z.string().regex(/^[0-9a-f]{64}$/), instant = z.string().datetime({ offset: true })
const observationRequestSchema = z.object({
  setup_id: id, expected_revision: z.number().int().positive(), actor_id: id,
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.enum(['OfferingManager', 'TokenisationAgent']) }).strict(),
  environment: z.literal('TESTNET'), product_id: id, offering_revision_id: id, terms_hash: digest,
  configuration_hash: digest, setup_configuration_hash: digest.nullable(), expires_at: instant,
  kind: z.enum(['SAFE', 'STEP']), safe_address: z.string().regex(/^0x[0-9a-f]{40}$/).nullable(),
  step_id: id.nullable(), expected_step_revision: z.number().int().positive().nullable(),
  intent: fundSetupIntentSchema.nullable(), intent_hash: digest.nullable(),
  transaction_hash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
}).strict()

function installed(error: { code?: string } | null) {
  if (!error) return
  if (['42883', 'PGRST202'].includes(error.code ?? '')) throw new FundLifecycleError('SETUP_NOT_INSTALLED', 'Saved blockchain setup is not connected to this environment yet.', 503)
  throw new FundLifecycleError('SETUP_ACTION_NOT_CONFIRMED', error.code === '42501'
    ? 'Your session or product authority cannot perform this action. Protected setup needs a verified authenticator session in the authorised capacity.'
    : 'The saved product or setup version changed. Refresh the original record before retrying.', error.code === '42501' ? 403 : 409)
}
function onlyTest() { if (fundLifecycleEnvironment() !== 'TESTNET') throw new FundLifecycleError('SETUP_NOT_ADMITTED', 'Blockchain setup is not admitted in MAIN.', 409) }
function snapshot(raw: unknown, actorId: string, context: PortalOperatingContext, productId?: string): FundSetupSnapshot {
  const parsed = fundSetupSnapshotSchema.safeParse(raw)
  if (!parsed.success || parsed.data.actor_id !== actorId || !portalContextMatches(parsed.data.operating_context, context)
    || productId && parsed.data.product_id !== productId) throw new FundLifecycleError('SETUP_RESULT_UNVERIFIED', 'The saved setup response could not be verified for this person, capacity and fund.', 503)
  return parsed.data
}
export async function readFundSetup(client: SupabaseClient, actorId: string, productId: string, context: PortalOperatingContext) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_setup_read', { product_id: productId, operating_context: context }).abortSignal(AbortSignal.timeout(10000))
  installed(error); return snapshot(data, actorId, context, productId)
}
export async function commandFundSetup(client: SupabaseClient, actorId: string, request: FundSetupCommandRequest) {
  onlyTest()
  const { data, error } = await client.rpc('bx1_portal_fund_setup_command', { command: request.command,
    request_key: request.request_key, payload: request.payload, operating_context: request.operating_context }).abortSignal(AbortSignal.timeout(15000))
  installed(error)
  const result = snapshot(data, actorId, request.operating_context, request.command === 'CREATE' ? request.payload.product_id : undefined)
  if (request.command !== 'CREATE' && result.setup?.id !== request.payload.setup_id) throw new FundLifecycleError('SETUP_RESULT_UNVERIFIED', 'The saved setup response belongs to a different setup. Refresh before retrying.', 503)
  return result
}
async function authorise(client: SupabaseClient, actorId: string, setupId: string, expectedRevision: number, context: PortalOperatingContext) {
  const { data, error } = await client.rpc('bx1_portal_fund_setup_authorise', {
    setup_id: setupId, expected_revision: expectedRevision, operating_context: context,
  }).abortSignal(AbortSignal.timeout(10000))
  installed(error)
  const current = snapshot(data, actorId, context)
  if (current.setup?.id !== setupId || current.setup.revision !== expectedRevision) throw new FundLifecycleError('SETUP_SESSION_BINDING_CHANGED', 'The current setup changed. Refresh it before continuing.', 409)
  return current
}
export async function prepareFundSetup(client: SupabaseClient, actorId: string, request: {
  setup_id: string; expected_revision: number; step_key: string; sender: string; operating_context: PortalOperatingContext
}) {
  onlyTest()
  await authorise(client, actorId, request.setup_id, request.expected_revision, request.operating_context)
  const read = fundSetupPreparationSchema.safeParse(await callFundWorker('read_fund_setup_preparation', [request.setup_id,
    request.step_key, request.expected_revision, request.sender.toLowerCase(), actorId, request.operating_context]))
  if (!read.success || read.data.setup_id !== request.setup_id || read.data.expected_revision !== request.expected_revision
    || read.data.actor_id !== actorId || read.data.step_key !== request.step_key || read.data.sender !== request.sender.toLowerCase()
    || !portalContextMatches(read.data.operating_context, request.operating_context) || Date.parse(read.data.expires_at) <= Date.now()) {
    throw new FundLifecycleError('SETUP_PREPARATION_UNVERIFIED', 'The current saved setup could not be bound to this person, capacity and wallet.', 409)
  }
  const preparation = read.data
  // The creator nonce is independently read, never copied from a browser value.
  const nonce = await readSetupNonce(preparation.sender)
  const built = preparation.step_key === 'safe_creation'
    ? preparation.safe_configuration ? await buildSafeCreationIntent(preparation.safe_configuration, preparation.sender, nonce, preparation.setup_configuration_hash)
      : null
    : preparation.configuration ? buildSetupIntent(preparation.step_key, preparation.configuration,
      preparation.dependencies as FundSetupAddresses, preparation.sender, nonce, preparation.setup_configuration_hash) : null
  const intent = fundSetupIntentSchema.parse(built)
  if (Date.parse(preparation.expires_at) <= Date.now()) throw new FundLifecycleError('SETUP_EXPIRED', 'Setup authority expired during chain checks. Nothing was sent.', 409)
  await callFundWorker('prepare_fund_setup_step', [preparation, intent])
  // Re-read through the actual authenticated boundary after the restricted write.
  return readFundSetup(client, actorId, preparation.product_id, request.operating_context)
}
export async function verifyFundSetup(client: SupabaseClient, actorId: string, request: {
  setup_id: string; step_id: string | null; expected_revision: number; operating_context: PortalOperatingContext
}) {
  onlyTest()
  const authorised = await authorise(client, actorId, request.setup_id, request.expected_revision, request.operating_context)
  const savedStep = authorised.setup?.safe_creation?.id === request.step_id ? authorised.setup.safe_creation
    : authorised.setup?.steps.find(step => step.id === request.step_id)
  const read = observationRequestSchema.safeParse(await callFundWorker('read_fund_setup_observation', [request.setup_id,
    request.step_id, request.expected_revision, actorId, request.operating_context]))
  if (!read.success || read.data.setup_id !== request.setup_id || read.data.expected_revision !== request.expected_revision
    || read.data.actor_id !== actorId || read.data.step_id !== request.step_id
    || !portalContextMatches(read.data.operating_context, request.operating_context) || Date.parse(read.data.expires_at) <= Date.now()
    || (read.data.kind === 'SAFE') !== (request.step_id === null)) throw new FundLifecycleError('SETUP_OBSERVATION_UNVERIFIED', 'The original setup observation could not be bound to the saved record.', 409)
  const observation = read.data
  if (observation.kind === 'STEP' && (!observation.intent || !observation.intent_hash || !observation.transaction_hash)
    || observation.kind === 'SAFE' && !observation.safe_address) {
    throw new FundLifecycleError('SETUP_ORIGINAL_HASH_REQUIRED', 'Retain and save the original transaction hash before checking its confirmation. Do not submit another.', 409)
  }
  let result: unknown
  try {
    result = observation.kind === 'SAFE' ? await observeSetupSafe(observation.safe_address!)
      : await observeSetupStep(observation.intent!, observation.transaction_hash!, { intent_hash: observation.intent_hash! })
  } catch (error) {
    const holdReasons = ['SETUP_REORG_AFTER_WAIT', 'SETUP_CANONICAL_BLOCK_CHANGED', 'SETUP_RUNTIME_MISMATCH', 'SETUP_EFFECT_MISMATCH',
      'SETUP_CREATED_ADDRESS_MISMATCH', 'SETUP_RECEIPT_MISMATCH', 'SETUP_OBSERVERS_DISAGREE']
    if (observation.kind === 'STEP' && savedStep?.state === 'FINAL' && error instanceof FundSetupChainError && holdReasons.includes(error.code)) {
      await callFundWorker('record_fund_setup_observation', [observation, { version: 1, chain_id: 80002, status: 'RECOVERY_REQUIRED',
        step_key: observation.intent!.step_key, intent_hash: observation.intent_hash, transaction_hash: observation.transaction_hash, reason_code: error.code }])
      return readFundSetup(client, actorId, observation.product_id, request.operating_context)
    }
    throw error
  }
  if (Date.parse(observation.expires_at) <= Date.now()) throw new FundLifecycleError('SETUP_EXPIRED', 'Setup authority expired while waiting for independent chain checks. Retain the original transaction.', 409)
  await callFundWorker('record_fund_setup_observation', [observation, result])
  return readFundSetup(client, actorId, observation.product_id, request.operating_context)
}
