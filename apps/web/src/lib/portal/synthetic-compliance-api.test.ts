import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), normal: vi.fn(), narrow: vi.fn(), mfa: vi.fn(), current: vi.fn(), rpc: vi.fn(), paused: vi.fn(), allowed: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, isMfaContextCurrent: mocks.current }))
vi.mock('@/lib/supabase/test-ordinary-entry', () => ({ testOrdinaryEntryMfaPaused: mocks.paused, isTestOrdinaryEntryAllowed: mocks.allowed }))
vi.mock('./synthetic-compliance', () => ({ readSyntheticCompliance: mocks.narrow }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.normal }))
import { POST } from '@/app/api/portal/command/route'
const actor = '11111111-1111-4111-8111-111111111111', applicant = '22222222-2222-4222-8222-222222222222', caseId = '33333333-3333-4333-8333-333333333333'
const operatingContext = { mode: 'ROLE' as const, role: 'ComplianceOfficer' as const, organisationId: '44444444-4444-4444-8444-444444444444' }
function snapshot() {
  return { rehearsal: { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: actor, operating_context: operatingContext }, actor: { id: actor, email: 'reviewer@example.invalid', display_name: null, can_review: true }, operating_context: operatingContext,
    applications: [{ id: caseId, user_id: applicant, persona: 'INVESTOR', status: 'CHANGES_REQUIRED', revision: 3,
      details: { full_name: 'Fictional Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Fictional savings for synthetic review.', beneficial_owners: '', experience: 'Fictional experienced investor.', test_data_acknowledged: true,
        documents: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'IDENTITY', title: 'Fictional identity manifest', storage_path: `${applicant}/55555555-5555-4555-8555-555555555555`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }] },
      submitted_at: '2026-10-10T12:00:00Z', reviewed_at: '2026-10-10T12:01:00Z', reviewer_id: actor, review_notes: 'Please expand the fictional source-of-funds description.', organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null, admission_purpose: 'INVESTOR_ADMISSION' }], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
}
const instruction = () => ({ command: 'review_application', key: '66666666-6666-4666-8666-666666666666', payload: { application_id: caseId, expected_revision: 2, decision: 'CHANGES_REQUIRED', notes: 'Please expand the fictional source-of-funds description.', checks: { identity: false, ownership: false, screening: false, suitability: false } }, operating_context: operatingContext })
function request(value: unknown = instruction(), origin = 'https://testnet.bx1.co.za') { return new NextRequest('https://testnet.bx1.co.za/api/portal/command', { method: 'POST', headers: { origin, host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-bx1-expected-actor': actor }, body: JSON.stringify(value) }) }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za' })) vi.stubEnv(key, value)
  mocks.paused.mockReturnValue(true); mocks.allowed.mockReturnValue(true); mocks.mfa.mockResolvedValue({}); mocks.current.mockResolvedValue(true)
  mocks.create.mockReturnValue({ rpc: mocks.rpc }); mocks.narrow.mockResolvedValue({ user: { id: actor, email: 'reviewer@example.invalid' }, snapshot: snapshot() })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot(), error: null }) })
})
describe('existing API narrow synthetic review selection', () => {
  it('uses only the designated read/review RPC and returns the same-case revision', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).snapshot.applications[0].revision).toBe(3)
    expect(mocks.normal).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_synthetic_compliance_command', expect.objectContaining({ command: 'review_application', operating_context: operatingContext }))
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects unrelated commands before any review read or mutation', async () => {
    expect((await POST(request({ ...instruction(), command: 'create_investment_account', payload: { application_id: caseId } }))).status).toBe(403)
    expect(mocks.narrow).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a case absent from the authoritative pre-read', async () => {
    mocks.narrow.mockResolvedValue({ user: { id: actor, email: 'reviewer@example.invalid' }, snapshot: { ...snapshot(), applications: [] } })
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not fallback after a narrow reader denial', async () => {
    const { PortalError } = await import('./server')
    mocks.narrow.mockRejectedValue(new PortalError('Denied', 403))
    expect((await POST(request())).status).toBe(403); expect(mocks.normal).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ accounts: [] }, { applications: [] }, { rehearsal: undefined }])('refuses a changed or broadened result %j', async delta => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot(), ...delta }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it('refuses a changed session after saving with uncertain-outcome guidance', async () => {
    mocks.current.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(503)
  })
  it('rejects forged origin before authentication', async () => {
    expect((await POST(request(instruction(), 'https://evil.invalid'))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
afterEach(() => vi.unstubAllEnvs())
