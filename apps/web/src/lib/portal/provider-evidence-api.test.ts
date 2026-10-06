import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), entry: vi.fn(), config: vi.fn(), dbConfig: vi.fn(),
  bind: vi.fn(), token: vi.fn(), webhookConfig: vi.fn(), digest: vi.fn(), parse: vi.fn(), record: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(),
  createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.entry }))
vi.mock('@/lib/portal/provider-evidence', async original => ({ ...await original<object>(), sumsubSessionConfig: mocks.config,
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
const app = { id: applicationId, user_id: actor, revision: 2, status: 'SUBMITTED', persona: 'INVESTOR', submitted_at: '2026-10-07T10:00:00Z',
  context_kind: 'PERSONAL', admission_purpose: 'INVESTOR_ADMISSION', details: {
    full_name: 'Synthetic Applicant', country: 'ZA', investor_type: 'INDIVIDUAL' } }
const entry = { actor: { id: actor, email: 'synthetic@example.invalid' }, applications: [app] }
const jwt = `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sessionId })).toString('base64url')}.signature`
function sessionRequest(headers: Record<string, string> = {}, body: unknown = { application_id: applicationId, expected_revision: 2 }) {
  return new NextRequest(`${origin}/api/portal/kyc/session`, { method: 'POST', headers: {
    host: 'testnet.bx1.co.za', origin, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) })
}
function webhookRequest(headers: Record<string, string> = {}, body: unknown = { synthetic: true }) {
  return new NextRequest(`${origin}/api/portal/kyc/webhook`, { method: 'POST', headers: {
    host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-payload-digest-alg': 'HMAC_SHA256_HEX',
    'x-payload-digest': 'a'.repeat(64), ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', BLOCKXONE_APP_ORIGIN: origin,
    BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    VERCEL_ENV: 'preview', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.create.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: jwt } }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor } }, error: null }) }, rpc: mocks.rpc })
  mocks.entry.mockResolvedValue(entry)
  mocks.config.mockReturnValue({ individualLevel: 'synthetic-individual', companyLevel: 'synthetic-company', clientId: 'synthetic-client' })
  mocks.webhookConfig.mockReturnValue({ secret: 'synthetic-secret', clientId: 'synthetic-client' })
  mocks.bind.mockResolvedValue({ binding_id: sessionId, external_user_id: `bx1:testnet:${applicationId}:r2`,
    expected_applicant_type: 'individual', expected_level_name: 'synthetic-individual', expected_client_id: 'synthetic-client', source_version_revision: 2 })
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
    expect(mocks.bind).toHaveBeenCalledWith(actor, sessionId, applicationId, 2, expect.objectContaining({
      individualLevel: 'synthetic-individual', companyLevel: 'synthetic-company', clientId: 'synthetic-client' }), 'individual')
    expect(mocks.token).toHaveBeenCalledWith(`bx1:testnet:${applicationId}:r2`, 'synthetic-individual', expect.anything())
    expect(mocks.entry).toHaveBeenCalledTimes(3)
  })
  it('requires submit/resubmit first, and refuses incomplete or unsupported submitted subjects', async () => {
    for (const changes of [{ status: 'DRAFT' }, { status: 'CHANGES_REQUIRED' }, { submitted_at: null },
      { details: {} }, { details: { ...app.details, country: 'zz' } },
      { details: { ...app.details, investor_type: 'ENTITY' } },
      { details: { ...app.details, investor_type: 'INDIVIDUAL', details_version: 3 } },
      { persona: 'WEALTH_MANAGER', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', details: { ...app.details } },
      { persona: 'WEALTH_MANAGER', admission_purpose: 'INVESTOR_ADMISSION' }]) {
      mocks.entry.mockResolvedValue({ ...entry, applications: [{ ...app, ...changes }] })
      expect((await startSession(sessionRequest())).status).toBe(409)
    }
    expect(mocks.bind).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('uses persisted company qualification for both entity investor and wealth-manager applications', async () => {
    for (const changes of [{ details: { ...app.details, investor_type: 'ENTITY', company_name: 'Fictional Organisation', registration_reference: 'SYNTHETIC-REG' } },
      { details: { ...app.details, investor_type: 'ENTITY', details_version: 3, company_name: 'Fictional Organisation', registration_reference: 'SYNTHETIC-REG' } },
      { persona: 'WEALTH_MANAGER', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', details: {
        details_version: 2, full_name: 'Synthetic Applicant', country: 'ZA', company_name: 'Fictional Organisation', registration_reference: 'SYNTHETIC-REG' } },
      { persona: 'WEALTH_MANAGER', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', details: {
        details_version: 3, full_name: 'Synthetic Applicant', country: 'ZA', company_name: 'Fictional Organisation', registration_reference: 'SYNTHETIC-REG' } }]) {
      mocks.entry.mockResolvedValue({ ...entry, applications: [{ ...app, ...changes }] })
      mocks.bind.mockResolvedValue({ binding_id: sessionId, external_user_id: `bx1:testnet:${applicationId}:r2`,
        expected_applicant_type: 'company', expected_level_name: 'synthetic-company', expected_client_id: 'synthetic-client', source_version_revision: 2 })
      expect((await startSession(sessionRequest())).status).toBe(200)
      expect(mocks.token).toHaveBeenLastCalledWith(`bx1:testnet:${applicationId}:r2`, 'synthetic-company', expect.anything())
    }
  })
  it('fails closed before the SDK call on persisted type, level, client or source drift', async () => {
    for (const changes of [{ expected_applicant_type: 'company' }, { expected_level_name: 'SYNTHETIC-individual' },
      { expected_client_id: 'wrong-client' }, { source_version_revision: 1 }]) {
      mocks.bind.mockResolvedValue({ binding_id: sessionId, external_user_id: `bx1:testnet:${applicationId}:r2`,
        expected_applicant_type: 'individual', expected_level_name: 'synthetic-individual', expected_client_id: 'synthetic-client', source_version_revision: 2, ...changes })
      expect((await startSession(sessionRequest())).status).toBe(503)
    }
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('does not return a token after an actor, revision, state or submitted-details change during the external call', async () => {
    for (const after of [{ ...entry, actor: { id: sessionId } }, { ...entry, applications: [{ ...app, revision: 3 }] },
      { ...entry, applications: [{ ...app, status: 'CHANGES_REQUIRED' }] },
      { ...entry, applications: [{ ...app, details: { investor_type: 'ENTITY' } }] }]) {
      mocks.entry.mockResolvedValueOnce(entry).mockResolvedValueOnce(entry).mockResolvedValueOnce(after)
      const response = await startSession(sessionRequest())
      expect(response.status).toBe(409)
      expect(await response.text()).not.toContain('synthetic-short-lived-token')
    }
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
  it('authenticates raw bytes before admitting typed review/lifecycle events, including deactivation and deletion', async () => {
    const actual = await vi.importActual<typeof import('./provider-evidence')>('./provider-evidence')
    mocks.parse.mockImplementation(actual.parseSumsubWebhook)
    const valid = { externalUserId: `bx1:testnet:${applicationId}:r2`, applicantId: 'synthetic-applicant',
      applicantType: 'individual', levelName: 'synthetic-individual', clientId: 'synthetic-client', sandboxMode: true,
      type: 'applicantReviewed', createdAtMs: '2026-10-07 10:01:00.000', reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } }
    for (const type of ['applicantReviewed', 'applicantPending', 'applicantReset', 'applicantDeactivated', 'applicantDeleted']) {
      expect((await webhook(webhookRequest({}, { ...valid, type }))).status).toBe(200)
      expect(mocks.record).toHaveBeenLastCalledWith(expect.objectContaining({ event: expect.objectContaining({ type,
        applicantType: 'individual', levelName: 'synthetic-individual' }) }))
    }
    expect(mocks.digest.mock.invocationCallOrder[0]).toBeLessThan(mocks.parse.mock.invocationCallOrder[0])
    mocks.record.mockClear()
    for (const mutation of [{ applicantType: null }, { levelName: null }, { type: 'applicantActionReviewed' },
      { reviewResult: { reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' } }, { reviewResult: { reviewAnswer: 'RED' } }])
      expect((await webhook(webhookRequest({}, { ...valid, ...mutation }))).status).toBe(403)
    expect(mocks.record).not.toHaveBeenCalled()
    mocks.record.mockRejectedValue(new Error('binding context mismatch'))
    for (const mutation of [{ applicantType: 'company' }, { levelName: 'Synthetic-individual' },
      { applicantId: 'wrong-provider-id' }])
      expect((await webhook(webhookRequest({}, { ...valid, ...mutation }))).status).toBe(503)
    // Signed qualification still requires the database binding and pin checks before an acknowledgement.
  })
  it('preserves the normalized SQL projection for effective, conflicting, manual and historical reads', async () => {
    const events = ['EFFECTIVE', 'SUPERSEDED', 'MANUAL_TEST', 'LEGACY_UNQUALIFIED', 'REVISION_STALE', 'CONFLICT']
      .map(projection_state => ({ application_id: applicationId, projection_state,
        applicant_type: projection_state === 'LEGACY_UNQUALIFIED' ? null : 'individual',
        level_name: projection_state === 'LEGACY_UNQUALIFIED' ? null : 'synthetic-individual',
        evidence_kind: projection_state === 'LEGACY_UNQUALIFIED' ? 'LEGACY_UNQUALIFIED' : 'LIFECYCLE' }))
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: events, error: null }) })
    const response = await readEvidence(new NextRequest(`${origin}/api/portal/kyc/evidence?application_id=${applicationId}`))
    expect(await response.json()).toEqual({ application_id: applicationId, events })
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
