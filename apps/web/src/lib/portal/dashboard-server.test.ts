import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: {}, user: vi.fn(), workspace: vi.fn(), context: vi.fn(), sufficient: vi.fn(), current: vi.fn(), portal: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: async () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.context, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.portal }))
import { loadRoleDashboard } from './dashboard-server'
import { PortalError } from './server'
const actor = { id: 'actor', email: 'actor@example.invalid', email_confirmed_at: '2026-09-21', is_anonymous: false }
const portal = { user: actor, snapshot: { actor: { ...actor, can_review: false }, organisations: [], applications: [], products: [], subscriptions: [], events: [] } }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app' })) vi.stubEnv(key, value)
  mocks.user.mockResolvedValue(actor); mocks.context.mockResolvedValue({}); mocks.sufficient.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: 'org-a', name: 'A', roles: ['Investor'] }] })
  mocks.portal.mockResolvedValue(portal)
})
afterEach(() => vi.unstubAllEnvs())
describe('fresh dashboard authority and environment admission', () => {
  it('loads assigned native scope after current MFA and authoritative TEST read', async () => {
    expect((await loadRoleDashboard({})).kind).toBe('role')
    expect(mocks.portal.mock.invocationCallOrder[0]).toBeLessThan(mocks.current.mock.invocationCallOrder[0])
  })
  it('retains separately guarded applicant onboarding without inventing roles', async () => {
    mocks.context.mockResolvedValue(null)
    expect((await loadRoleDashboard({})).kind).toBe('applicant')
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.portal).toHaveBeenCalledOnce()
  })
  it('does not allow an applicant to select an operator dashboard', async () => {
    mocks.context.mockResolvedValue(null)
    await expect(loadRoleDashboard({ organisation: 'org-a', role: 'SuperAdmin' })).rejects.toMatchObject({ status: 403 })
  })
  it.each([401, 403])('does not bypass portal restrictions returning %s', async status => {
    mocks.portal.mockRejectedValue(new PortalError('Denied', status))
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status })
  })
  it('keeps native dashboard with an explicit unavailable queue on operational read failure', async () => {
    mocks.portal.mockRejectedValue(new PortalError('Unavailable', 503))
    const result = await loadRoleDashboard({})
    expect(result.kind).toBe('role')
    if (result.kind === 'role') expect(result.queueMessage).toContain('not a zero balance')
  })
  it('rejects incomplete MFA before reading any workspace or business data', async () => {
    mocks.sufficient.mockReturnValue(false)
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('rejects token changes during reads', async () => {
    mocks.current.mockResolvedValue(false)
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
  })
  it('does not call the TEST RPC from the real MAINNET configuration', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    const result = await loadRoleDashboard({})
    expect(result.release.environment).toBe('MAINNET'); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('rejects a refreshed different native identity', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, id: 'other' }, organisations: [] })
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
  })
})
