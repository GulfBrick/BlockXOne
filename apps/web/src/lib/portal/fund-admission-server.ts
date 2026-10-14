import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fundAdmissionInputSchema, buildFundAdmissionCandidate, FundAdmissionChainError } from './fund-chain-admission'
import { fundSetupHash, predictFundSuite } from './fund-setup-chain'
import { callFundWorker } from './fund-lifecycle-worker'
import { requireFundRpcResult } from './fund-lifecycle-api'
import { FundLifecycleError } from './fund-lifecycle-server'
import { portalContextMatches, portalOperatingContextSchema } from './operating-context'

export const fundAdmissionRequestSchema = z.object({ setup_id: z.string().uuid(), expected_revision: z.number().int().positive(),
  request_key: z.string().uuid(), operating_context: portalOperatingContextSchema }).strict()
const seedSchema = fundAdmissionInputSchema.innerType().omit({ manifest_id: true, product_binding_hash: true, proof_refs: true })
  .extend({ conformance_receipt_id: z.string().uuid() }).strict()
const reservationSchema = z.object({ request_id: z.string().uuid(), status: z.enum(['RESERVED_NOT_ADMITTED', 'ADMITTED']), input: fundAdmissionInputSchema }).strict()
const resultSchema = z.object({ request_id: z.string().uuid(), status: z.literal('ADMITTED'), manifest_id: z.string().uuid(), signer_policy_id: z.string().uuid() }).strict()

/** No wallet submission. Admission links a completed, observed setup to the native workflow. */
export async function admitFundRelease(client: SupabaseClient, actorId: string, input: z.infer<typeof fundAdmissionRequestSchema>) {
  const { data: raw, error } = await client.rpc('bx1_portal_fund_admission_seed', { setup_id: input.setup_id,
    expected_revision: input.expected_revision, operating_context: input.operating_context }).abortSignal(AbortSignal.timeout(10000))
  const seed = seedSchema.parse(requireFundRpcResult(raw, error))
  const setup = seed.setup.setup
  if (seed.setup.actor_id !== actorId || !portalContextMatches(seed.setup.operating_context, input.operating_context)
    || !setup || setup.id !== input.setup_id || setup.revision !== input.expected_revision || !setup.configuration
    || setup.state !== 'COMPLETE_NOT_ADMITTED') throw new FundLifecycleError('ADMISSION_SCOPE_CHANGED', 'The saved fund setup changed. Refresh it before continuing.', 409)
  const dependencies = setup.dependencies
  const factory = dependencies.trex_factory, authority = dependencies.trex_authority, identity = dependencies.token_identity
  if (!factory || !authority || !identity) throw new FundLifecycleError('ADMISSION_DEPENDENCIES_MISSING', 'The saved contract setup is not complete. No release was admitted.', 409)
  const expected = predictFundSuite(factory, seed.deployment_salt, authority,
    { name: seed.token_name, symbol: seed.token_symbol, decimals: seed.security_unit_decimals, onchain_id: identity })
  const { data: reserved, error: reserveError } = await client.rpc('bx1_portal_fund_admission_reserve', { ...input,
    predicted_token: expected.token }).abortSignal(AbortSignal.timeout(10000))
  const reservation = reservationSchema.parse(requireFundRpcResult(reserved, reserveError))
  if (reservation.input.setup.setup?.id !== setup.id || reservation.input.setup.setup?.revision !== setup.revision
    || reservation.input.setup.actor_id !== actorId || !portalContextMatches(reservation.input.setup.operating_context, input.operating_context)) {
    throw new FundLifecycleError('ADMISSION_RESERVATION_CHANGED', 'The original release reservation could not be verified. No contract was admitted.', 409)
  }
  // Re-read with the saved real session after provider/DB waits. Browser JSON
  // never supplies receipt IDs, runtime hashes or an admission status.
  const current = reservationSchema.parse(await callFundWorker('read_fund_admission', [reservation.request_id]))
  if (current.request_id !== reservation.request_id || fundSetupHash(current.input) !== fundSetupHash(reservation.input)) {
    throw new FundLifecycleError('ADMISSION_BINDING_CHANGED', 'The saved release changed. Continue its original request.', 409)
  }
  if (current.status === 'ADMITTED') {
    return { request_id: current.request_id, status: current.status, manifest_id: current.input.manifest_id }
  }
  let candidate
  try { candidate = await buildFundAdmissionCandidate(current.input) }
  catch (failure) {
    if (failure instanceof FundAdmissionChainError) throw new FundLifecycleError(failure.code,
      'The current contracts or signing configuration did not pass independent observation. No deployment or admission was inferred; refresh this saved setup.', 409)
    throw failure
  }
  if (candidate.manifest.suite.token.address !== expected.token) throw new FundLifecycleError('ADMISSION_ADDRESS_CHANGED', 'The fund contract prediction changed. No release was admitted.', 409)
  const body = Object.fromEntries(Object.entries({ ...candidate.manifest, status: 'ADMITTED' }).filter(([key]) => key !== 'hash'))
  const admittedHash = fundSetupHash(body)
  const result = resultSchema.parse(await callFundWorker('record_fund_admission', [current.request_id, candidate, admittedHash]))
  if (result.request_id !== current.request_id || result.manifest_id !== current.input.manifest_id) throw new FundLifecycleError('ADMISSION_RESULT_UNVERIFIED', 'The saved release result could not be verified. Refresh before retrying.', 503)
  return result
}
