import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), entry: vi.fn(), config: vi.fn(), dbConfig: vi.fn(),
  bind: vi.fn(), token: vi.fn(), webhookConfig: vi.fn(), digest: vi.fn(), parse: vi.fn(), record: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(),
  createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.entry }))
vi.mock('@/lib/portal/provider-evidence', () => ({ sumsubSessionConfig: mocks.config,
  providerEvidenceDatabaseConfig: mocks.dbConfig, bindProviderApplication: mocks.bind,
  issueSumsubSandboxToken: mocks.token, sumsubWebhookConfig: mocks.webhookConfig,
  verifySumsubWebhookDigest: mocks.digest, parseSumsubWebhook: mocks.parse,
  recordProviderEvidence: mocks.record }))
import { POST as startSession } from '@/app/api/portal/kyc/session/route'
import { POST as webhook } from '@/app/api/portal/kyc/webhook/route'
import { GET as readEvidence } from '@/app/api/portal/kyc/evidence/route'

const origin = 'https://testnet.bx1.co.za'
const actor = '11111111-1111-4111-8111-111111111111'
const applicationId = '44444444-4444-4444-8444-444444444444'
const sessionId = '22222222-2222-4222-8222-222222222222'
const app = { id: applicationId, user_id: actor, revision: 2, status: 'CHANGES_REQUIRED', persona: 'INVESTOR',
  context_kind: 'PERSONAL', admission_purpose: 'INVESTOR_ADMISSION', details: { investor_type: 'INDIVIDUAL' } }
const entry = { actor: { id: actor, email: 'synthetic@example.invalid' }, applications: [app] }
const jwt = `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sessionId })).toString('base64url')}.signature`
function sessionRequest(headers: Record<string, string> = {}, body: unknown = { application_id: applicationId, expected_revision: 2 }) {
  return new NextRequest(`${origin}/api/portal/kyc/session`, { method: 'POST', headers: {
    host: 'testnet.bx1.co.za', origin, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) })
}
function webhookRequest(headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/portal/kyc/webhook`, { method: 'POST', headers: {
    host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-payload-digest-alg': 'HMAC_SHA256_HEX',
    'x-payload-digest': 'a'.repeat(64), ...headers }, body: JSON.stringify({ synthetic: true }) })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', BLOCKXONE_APP_ORIGIN: origin,
    BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    VERCEL_ENV: 'preview', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.create.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: jwt } }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor } }, error: null }) }, rpc: mocks.rpc })
  mocks.entry.mockResolvedValue(entry)
  mocks.config.mockReturnValue({ individualLevel: 'synthetic-individual', companyLevel: 'synthetic-company' })
  mocks.webhookConfig.mockReturnValue({ secret: 'synthetic-secret', clientId: 'synthetic-client' })
  mocks.bind.mockResolvedValue({ binding_id: sessionId, external_user_id: `bx1:testnet:${applicationId}:r2` })
  mocks.token.mockResolvedValue('synthetic-short-lived-token')
  mocks.digest.mockReturnValue(true)
  mocks.parse.mockReturnValue({ event: { externalUserId: `bx1:testnet:${applicationId}:r2` } })
  mocks.record.mockResolvedValue({ id: sessionId, duplicate: false, ordering_state: 'CURRENT' })
  mocks.user.mockResolvedValue({ id: actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-24T00:00:00Z', is_anonymous: false })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: [], error: null }) })
})
afterEach(() => vi.unstubAllEnvs())

describe('hosted KYC backend boundaries', () => {
  it('binds only the signed-in exact application revision, and returns a short-lived sandbox token', async () => {
    const response = await startSession(sessionRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toMatchObject({ token: 'synthetic-short-lived-token', application_id: applicationId,
      application_revision: 2, environment: 'TESTNET' })
    expect(mocks.bind).toHaveBeenCalledWith(actor, sessionId, applicationId, 2)
    expect(mocks.token).toHaveBeenCalledWith(`bx1:testnet:${applicationId}:r2`, 'synthetic-individual', expect.anything())
    expect(mocks.entry).toHaveBeenCalledTimes(3)
  })
  it('refuses changed actor, stale revision and caller-selected role before binding', async () => {
    expect((await startSession(sessionRequest({ 'x-bx1-expected-actor': '55555555-5555-4555-8555-555555555555' }))).status).toBe(403)
    expect((await startSession(sessionRequest({}, { application_id: applicationId, expected_revision: 1 }))).status).toBe(409)
    expect((await startSession(sessionRequest({}, { application_id: applicationId, expected_revision: 2, role: 'SuperAdmin' }))).status).toBe(400)
    expect(mocks.bind).not.toHaveBeenCalled()
  })
  it('does not issue a token when the application changes during provider preparation', async () => {
    mocks.entry.mockResolvedValueOnce(entry).mockResolvedValueOnce({ ...entry, applications: [{ ...app, revision: 3 }] })
    const response = await startSession(sessionRequest())
    expect(response.status).toBe(409)
    expect(mocks.bind).toHaveBeenCalledTimes(1)
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('rejects unsigned/tampered and wrong-destination webhooks before persistence', async () => {
    mocks.digest.mockReturnValue(false)
    expect((await webhook(webhookRequest())).status).toBe(401)
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
    mocks.digest.mockReturnValue(true)
    expect((await webhook(webhookRequest({ host: 'other.example.invalid' }))).status).toBe(403)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('acknowledges only a durable provider evidence receipt, never an admission decision', async () => {
    const response = await webhook(webhookRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ received: true, duplicate: false, ordering_state: 'CURRENT' })
    expect(mocks.record).toHaveBeenCalledTimes(1)
    mocks.record.mockRejectedValueOnce(new Error('database unavailable'))
    const failed = await webhook(webhookRequest())
    expect(failed.status).toBe(503)
  })
  it('returns only a database-scoped evidence view to a verified user', async () => {
    const response = await readEvidence(new NextRequest(`${origin}/api/portal/kyc/evidence?application_id=${applicationId}`))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_provider_evidence_read', { p_application: applicationId })
    expect(await response.json()).toEqual({ application_id: applicationId, events: [] })
    mocks.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    expect((await readEvidence(new NextRequest(`${origin}/api/portal/kyc/evidence?application_id=${applicationId}`))).status).toBe(403)
  })
})
