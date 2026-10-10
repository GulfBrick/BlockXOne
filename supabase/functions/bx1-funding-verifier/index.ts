import { createClient } from '@supabase/supabase-js'
import { FUNDING_TEST_PROJECT } from './funding-claim.ts'
import { createFundingRpc, FundingVerificationError, readBoundedFundingJson, verifyFundingExpectation, type FundingVerificationExpectation } from './funding-verifier.ts'

// funding-claim.ts and funding-verifier.ts are copied byte-for-byte from apps/web/src/lib/portal
// during the cloud package step. There is only one authored verifier/claim implementation.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const roles = ['Investor', 'OfferingManager', 'ComplianceOfficer', 'IssuerFundManager', 'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin']
type Context = { mode: 'APPLICANT' } | { mode: 'ROLE'; organisationId: string; role: string }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function contextKey(value: unknown): string | null {
  if (!object(value)) return null
  if (value.mode === 'APPLICANT' && Object.keys(value).length === 1) return 'APPLICANT'
  if (value.mode === 'ROLE' && Object.keys(value).length === 3 && typeof value.organisationId === 'string' && uuid.test(value.organisationId) && typeof value.role === 'string' && roles.includes(value.role)) return `${value.organisationId}:${value.role}`
  return null
}
function fail(code: string, status = 503): never { throw new FundingVerificationError(code, status) }
function json(value: unknown, status: number) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) }

Deno.serve(async (request: Request) => {
  try {
    const base = `https://${FUNDING_TEST_PROJECT}.supabase.co`
    const anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (Deno.env.get('SUPABASE_URL') !== base || !anon || !service) fail('TEST_VERIFIER_NOT_CONFIGURED')
    if (request.method !== 'POST') return json({ error: 'POST_REQUIRED' }, 405)
    if (new URL(request.url).search || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) fail('INVALID_REQUEST', 400)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    const authorization = request.headers.get('authorization') ?? ''
    if (!uuid.test(expectedActor) || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 16_384) fail('AUTHENTICATION_REQUIRED', 401)
    const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)])
    const payload = await readBoundedFundingJson(request, 4096, deadline)
    if (!object(payload) || Object.keys(payload).length !== 3 || !['kind', 'id', 'operating_context'].every(k => Object.hasOwn(payload, k))
      || !['ROUTE', 'REFERENCE'].includes(String(payload.kind)) || typeof payload.id !== 'string' || !uuid.test(payload.id) || !contextKey(payload.operating_context)) fail('INVALID_VERIFICATION_REQUEST', 400)
    const authFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline })
    const caller = createClient(base, anon, { global: { headers: { Authorization: authorization }, fetch: authFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const token = authorization.slice(7)
    const verified = await caller.auth.getUser(token)
    if (verified.error || !verified.data.user || verified.data.user.is_anonymous || !verified.data.user.email_confirmed_at || verified.data.user.id !== expectedActor) fail('SESSION_NOT_AUTHORISED', 403)
    // Exact token was verified above. Its session identity is comparison-only, never an authority source.
    let claims: Record<string, unknown>
    try {
      const part = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')
      const parsed: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')))
      if (!object(parsed)) throw new Error()
      claims = parsed
    } catch { return json({ error: 'SESSION_NOT_AUTHORISED' }, 403) }
    if (claims.sub !== expectedActor || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)
      || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) fail('SESSION_NOT_AUTHORISED', 403)
    const result = await caller.rpc('bx1_portal_funding_verification_context', { kind: payload.kind, id: payload.id, operating_context: payload.operating_context as Context }).abortSignal(deadline)
    if (result.error) fail(result.error.code === '42501' ? 'VERIFICATION_NOT_AUTHORISED' : 'VERIFICATION_CONTEXT_UNAVAILABLE', result.error.code === '42501' ? 403 : 503)
    if (!object(result.data)) fail('VERIFICATION_CONTEXT_UNAVAILABLE')
    const expectation = result.data as unknown as FundingVerificationExpectation
    if (expectation.actor_id !== expectedActor || expectation.session_id !== claims.session_id || expectation.kind !== payload.kind || expectation.target_id !== payload.id
      || contextKey(expectation.operating_context) !== contextKey(payload.operating_context)) fail('VERIFICATION_CONTEXT_MISMATCH', 403)
    const observation = await verifyFundingExpectation(expectation, { rpc: createFundingRpc(fetch, deadline) })
    if (deadline.aborted || claims.exp * 1000 <= Date.now() || Date.parse(expectation.expires_at) <= Date.now()) fail('VERIFICATION_EXPIRED', 409)
    const writer = createClient(base, service, { global: { fetch: authFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const saved = await writer.rpc('bx1_portal_record_funding_observation', { expectation_id: expectation.id, observation }).abortSignal(deadline)
    if (saved.error || !saved.data) fail(saved.error?.code === '42501' ? 'OBSERVATION_NOT_AUTHORISED' : 'OBSERVATION_OUTCOME_UNCERTAIN', saved.error?.code === '42501' ? 403 : 503)
    if (!object(saved.data) || Object.keys(saved.data).length !== 2 || typeof saved.data.observation_id !== 'string' || !uuid.test(saved.data.observation_id)
      || saved.data.status !== observation.status) fail('OBSERVATION_OUTCOME_UNCERTAIN')
    return json({ ok: true, kind: expectation.kind, id: expectation.target_id, status: observation.status, ...(observation.status === 'INVALID' ? { reason_code: observation.reason_code } : {}) }, 200)
  } catch (error) {
    // Never log or serialize provider exceptions, headers, JWTs or client options.
    return json({ error: error instanceof FundingVerificationError ? error.code : 'VERIFICATION_UNAVAILABLE' }, error instanceof FundingVerificationError ? error.status : 503)
  }
})
