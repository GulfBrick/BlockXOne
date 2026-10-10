import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), normal: vi.fn(), legacy: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./synthetic-compliance', () => ({ readSyntheticCompliance: mocks.legacy }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.normal }))
import { POST } from '@/app/api/portal/command/route'
import { PortalError } from './server'
const actor = '11111111-1111-4111-8111-111111111111'
const application = '33333333-3333-4333-8333-333333333333'
const context = { mode: 'ROLE' as const, role: 'ComplianceOfficer' as const, organisationId: '44444444-4444-4444-8444-444444444444' }
function snapshot() {
  return { stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', actor_id: actor, operating_context: context, allowed_commands: ['review_application'] },
    actor: { id: actor, email: 'reviewer@example.invalid', display_name: null, can_review: true }, operating_context: context,
    applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
}
const instruction = () => ({ command: 'review_application', key: '66666666-6666-4666-8666-666666666666', payload: { application_id: application, expected_revision: 2, decision: 'CHANGES_REQUIRED', notes: 'Please provide the missing source-of-funds information.', checks: { identity: false, ownership: false, screening: false, suitability: false } }, operating_context: context })
function request(value: unknown = instruction(), origin = 'https://testnet.bx1.co.za') { return new NextRequest('https://testnet.bx1.co.za/api/portal/command', { method: 'POST', headers: { origin, host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-bx1-expected-actor': actor }, body: JSON.stringify(value) }) }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za' })) vi.stubEnv(key, value)
  mocks.create.mockReturnValue({ rpc: mocks.rpc }); mocks.normal.mockResolvedValue({ user: { id: actor, email: 'reviewer@example.invalid' }, snapshot: snapshot() })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot(), error: null }) })
})
afterEach(() => vi.unstubAllEnvs())
describe('normal admission command replaces the legacy rehearsal route', () => {
  it('uses the existing normal scoped writer without a frontend case whitelist', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.normal).toHaveBeenCalledExactlyOnceWith(expect.anything(), context)
    expect(mocks.legacy).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_command_scoped', expect.objectContaining({ command: 'review_application', operating_context: context }))
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('rejects another action family before writing even if its schema is valid', async () => {
    expect((await POST(request({ ...instruction(), command: 'create_investment_account', payload: { application_id: application } }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserves backend case denial rather than using a legacy policy fallback', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.legacy).not.toHaveBeenCalled()
  })
  it('preserves current reader denial with no mutation', async () => {
    mocks.normal.mockRejectedValue(new PortalError('Denied', 403))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ stage2_access: undefined }, { rehearsal: undefined }, { stage2_access: { ...snapshot().stage2_access, actor_id: application } }, { stage2_access: { ...snapshot().stage2_access, session_mode: 'STANDARD' } }])('refuses a missing, legacy or changed saved capability %j', async delta => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot(), ...delta }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it('rejects a legacy pre-read without calling its old writer', async () => {
    mocks.normal.mockResolvedValue({ user: { id: actor, email: 'reviewer@example.invalid' }, snapshot: { ...snapshot(), rehearsal: {} } })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects forged origin before authentication', async () => {
    expect((await POST(request(instruction(), 'https://evil.invalid'))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
