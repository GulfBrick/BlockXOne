import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: {}, user: vi.fn(), workspace: vi.fn(), context: vi.fn(), sufficient: vi.fn(), current: vi.fn(), portal: vi.fn(), entry: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: async () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.context, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.portal }))
vi.mock('./entry-server', () => ({ readEntry: mocks.entry }))
import { loadRoleDashboard } from './dashboard-server'
import { PortalError } from './server'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'actor@example.invalid', email_confirmed_at: '2026-09-21', is_anonymous: false }
const roleContext: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'Investor' }
function portalFor(context: PortalOperatingContext) {
  return { user: actor, snapshot: { actor: { ...actor, can_review: false }, operating_context: context, organisations: [], applications: [], products: [], subscriptions: [], events: [] } }
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app' })) vi.stubEnv(key, value)
  mocks.user.mockResolvedValue(actor); mocks.context.mockResolvedValue({}); mocks.sufficient.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'A', roles: ['Investor'] }] })
  mocks.portal.mockImplementation(async (_client, context) => portalFor(context))
  mocks.entry.mockResolvedValue({ entry_version: 1, actor, applications: [], contexts: [], admission: { manual_test_review: true } })
})
afterEach(() => vi.unstubAllEnvs())

describe('fresh dashboard authority and environment admission', () => {
  it('shows a context chooser rather than automatically exercising the first staff role', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'A', roles: ['Investor', 'SuperAdmin'] }] })
    const result = await loadRoleDashboard({})
    expect(result.kind).toBe('applicant')
    if (result.kind === 'applicant') expect(result.chooseContext).toBe(true)
    expect(result.operatingContext).toEqual(APPLICANT_CONTEXT)
  })
  it('rejects an unknown application id without falling back to a different capacity', async () => {
    await expect(loadRoleDashboard({ mode: 'applicant', application: otherOrganisation })).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('loads the exact assigned native scope through the scoped business read', async () => {
    const result = await loadRoleDashboard({ organisation, role: 'Investor' })
    expect(result.kind).toBe('role')
    expect(result.operatingContext).toEqual(roleContext)
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, roleContext)
    expect(mocks.workspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.portal.mock.invocationCallOrder[0])
    expect(mocks.portal.mock.invocationCallOrder[0]).toBeLessThan(mocks.current.mock.invocationCallOrder[0])
    if (result.kind === 'role') expect(result.portal?.snapshot.operating_context).toEqual(roleContext)
  })
  it('retains applicant onboarding without manufacturing native assignments', async () => {
    mocks.context.mockResolvedValue(null)
    const result = await loadRoleDashboard({})
    expect(result.kind).toBe('applicant')
    expect(result.operatingContext).toEqual(APPLICANT_CONTEXT)
    expect(result.scopes).toEqual([])
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, APPLICANT_CONTEXT)
  })
  it('lets a native operator explicitly open personal applicant onboarding without using the role context', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'Review organisation', roles: ['ComplianceOfficer'] }] })
    const result = await loadRoleDashboard({ mode: 'applicant' })
    expect(result.kind).toBe('applicant')
    expect(result.operatingContext).toEqual(APPLICANT_CONTEXT)
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, APPLICANT_CONTEXT)
    if (result.kind === 'applicant') {
      expect(result.portal!.snapshot.actor.can_review).toBe(false)
      expect(result.portal!.snapshot.organisations).toEqual([])
      expect(result.scopes).toEqual([{ organisationId: organisation, organisationName: 'Review organisation', role: 'ComplianceOfficer' }])
    }
  })
  it.each([
    { mode: 'applicant', organisation, role: 'Investor' },
    { mode: 'applicant', role: 'SuperAdmin' },
    { mode: 'ROLE' }, { mode: ['applicant'] }, { mode: '' },
    { organisation: otherOrganisation, role: 'Investor' },
    { organisation, role: 'SuperAdmin' }, { organisation: [organisation], role: 'Investor' },
    { organisation, role: ['Investor'] }, { role: 'Investor' },
  ])('rejects ambiguous or unassigned context before reading business data: %j', async query => {
    await expect(loadRoleDashboard(query)).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not allow an applicant to select an operator dashboard', async () => {
    mocks.context.mockResolvedValue(null)
    await expect(loadRoleDashboard({ organisation, role: 'SuperAdmin' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not fall back after the selected membership disappears', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [] })
    await expect(loadRoleDashboard({ organisation, role: 'Investor' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it.each([401, 403])('does not bypass a scoped business denial returning %s', async status => {
    mocks.portal.mockRejectedValue(new PortalError('Denied', status))
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status })
    expect(mocks.portal).toHaveBeenCalledTimes(1)
  })
  it('keeps native role selection but not a fabricated snapshot on operational read failure', async () => {
    mocks.portal.mockRejectedValue(new PortalError('Unavailable', 503))
    const result = await loadRoleDashboard({})
    expect(result.kind).toBe('role')
    if (result.kind === 'role') {
      expect(result.portal).toBeUndefined()
      expect(result.queue).toEqual([])
      expect(result.queueMessage).toContain('not a zero balance')
    }
  })
  it('keeps verified identity entry available without inventing unavailable business records', async () => {
    mocks.portal.mockRejectedValue(new PortalError('Unavailable', 503))
    const result = await loadRoleDashboard({ mode: 'applicant' })
    expect(result.kind).toBe('applicant')
    expect(result.portal).toBeUndefined()
    expect(mocks.entry).toHaveBeenCalledTimes(1)
  })
  it('rejects incomplete MFA even for explicit personal applicant mode', async () => {
    mocks.sufficient.mockReturnValue(false)
    await expect(loadRoleDashboard({ mode: 'applicant' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('rejects session changes during the scoped reads', async () => {
    mocks.current.mockResolvedValue(false)
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
  })
  it('does not call a TEST business RPC from the real MAINNET configuration', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    const result = await loadRoleDashboard({})
    expect(result.release.environment).toBe('MAINNET'); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('rejects a refreshed different native identity before reading business data', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, id: 'other' }, organisations: [] })
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('rejects an operational read for a different signed-in person', async () => {
    mocks.portal.mockResolvedValue({ ...portalFor(roleContext), user: { ...actor, id: 'other' } })
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
  })
})
