import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: {}, user: vi.fn(), workspace: vi.fn(), context: vi.fn(), sufficient: vi.fn(), current: vi.fn(), portal: vi.fn(), entry: vi.fn(), paused: vi.fn(), ordinary: vi.fn(), synthetic: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: async () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.context, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.portal }))
vi.mock('./entry-server', () => ({ readEntry: mocks.entry }))
vi.mock('@/lib/supabase/test-ordinary-entry', () => ({ testOrdinaryEntryMfaPaused: mocks.paused }))
vi.mock('./synthetic-compliance', () => ({ readSyntheticCompliance: mocks.synthetic }))
import { loadRoleDashboard } from './dashboard-server'
import { PortalError } from './server'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'actor@example.invalid', email_confirmed_at: '2026-09-21', is_anonymous: false }
const roleContext: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'Investor' }
const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'ComplianceOfficer' }
function ordinaryFor(role = 'Investor') {
  return { version: 1, entry: { entry_version: 1, actor, applications: [], contexts: [], admission: { manual_test_review: false }, workflow: { version: 1, environment: 'TESTNET', actor_id: actor.id, scoped_read_available: false } }, workspace: { user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'Own organisation', roles: [role] }] } }
}
function admissionPortal() {
  return { user: actor, snapshot: { actor: { id: actor.id, email: actor.email, display_name: null, can_review: true }, operating_context: reviewContext,
    stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', allowed_commands: ['review_application'], actor_id: actor.id, operating_context: reviewContext },
    organisations: [], applications: [], products: [], subscriptions: [], events: [], requests: [] } }
}
function portalFor(context: PortalOperatingContext) {
  return { user: actor, snapshot: { actor: { ...actor, can_review: false }, operating_context: context, organisations: [], applications: [], products: [], subscriptions: [], events: [] } }
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app' })) vi.stubEnv(key, value)
  mocks.user.mockResolvedValue(actor); mocks.context.mockResolvedValue({}); mocks.sufficient.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'A', roles: ['Investor'] }] })
  mocks.portal.mockImplementation(async (_client, context) => portalFor(context))
  mocks.entry.mockResolvedValue({ entry_version: 1, actor, applications: [], contexts: [], admission: { manual_test_review: true }, workflow: { version: 1, environment: 'TESTNET', actor_id: actor.id, scoped_read_available: true } })
  mocks.paused.mockReturnValue(false)
})
afterEach(() => vi.unstubAllEnvs())

describe('fresh dashboard authority and environment admission', () => {
  it('retains read-only non-admission roles during the temporary TEST password pause', async () => {
    mocks.paused.mockReturnValue(true); mocks.sufficient.mockReturnValue(false)
    mocks.entry.mockResolvedValue({ ...ordinaryFor().entry, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Own organisation', roles: ['Investor'] }] })
    const result = await loadRoleDashboard({ organisation, role: 'Investor' })
    expect(result.kind).toBe('ordinary-entry')
    expect(result.operatingContext).toEqual(roleContext)
    expect(result.portal).toBeUndefined()
    expect(mocks.entry).toHaveBeenCalledOnce()
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.portal).not.toHaveBeenCalled()
    expect(mocks.synthetic).not.toHaveBeenCalled()
  })
  it('uses normal entry and scoped reader for the assigned TEST Compliance context', async () => {
    mocks.paused.mockReturnValue(true); mocks.sufficient.mockReturnValue(false)
    mocks.entry.mockResolvedValue({ ...ordinaryFor().entry, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Own organisation', roles: ['ComplianceOfficer'] }] })
    mocks.portal.mockResolvedValue(admissionPortal())
    const result = await loadRoleDashboard({ organisation, role: 'ComplianceOfficer' })
    expect(result.kind).toBe('role')
    expect(result.operatingContext).toEqual(reviewContext)
    expect(result.portal).toEqual(admissionPortal())
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, reviewContext)
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.synthetic).not.toHaveBeenCalled()
  })
  it.each([401, 403, 503])('does not fall back to legacy rehearsal after normal admission denial %s', async status => {
    mocks.paused.mockReturnValue(true); mocks.sufficient.mockReturnValue(false)
    mocks.entry.mockResolvedValue({ ...ordinaryFor().entry, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Own organisation', roles: ['ComplianceOfficer'] }] })
    mocks.portal.mockRejectedValue(new PortalError('Admission read denied', status))
    await expect(loadRoleDashboard({ organisation, role: 'ComplianceOfficer' })).rejects.toMatchObject({ status })
    expect(mocks.portal).toHaveBeenCalledOnce()
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.synthetic).not.toHaveBeenCalled()
  })
  it('rejects a changed identity or session after the normal admission read', async () => {
    mocks.paused.mockReturnValue(true)
    mocks.entry.mockResolvedValue({ ...ordinaryFor().entry, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Own organisation', roles: ['ComplianceOfficer'] }] })
    mocks.portal.mockResolvedValue({ ...admissionPortal(), user: { ...actor, id: otherOrganisation } })
    await expect(loadRoleDashboard({ organisation, role: 'ComplianceOfficer' })).rejects.toMatchObject({ status: 403 })
    mocks.portal.mockResolvedValue(admissionPortal()); mocks.current.mockResolvedValue(false)
    await expect(loadRoleDashboard({ organisation, role: 'ComplianceOfficer' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.synthetic).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('uses applicant context without exercising the same login staff authority', async () => {
    mocks.paused.mockReturnValue(true)
    mocks.portal.mockResolvedValue({ ...portalFor(APPLICANT_CONTEXT), snapshot: { ...portalFor(APPLICANT_CONTEXT).snapshot, stage2_access: { version: 1, environment: 'TESTNET', actor_id: actor.id, operating_context: APPLICANT_CONTEXT, session_mode: 'TEST_PASSWORD', allowed_commands: ['start_application'] } } })
    const result = await loadRoleDashboard({ mode: 'applicant' })
    expect(result.kind).toBe('applicant'); expect(mocks.synthetic).not.toHaveBeenCalled()
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, APPLICANT_CONTEXT)
  })
  it('keeps normal assured Compliance reads on the unchanged full reader', async () => {
    mocks.workspace.mockResolvedValue(ordinaryFor('ComplianceOfficer').workspace)
    const result = await loadRoleDashboard({ organisation, role: 'ComplianceOfficer' })
    expect(result.kind).toBe('role')
    expect(mocks.portal).toHaveBeenCalledWith(mocks.client, reviewContext)
    expect(mocks.synthetic).not.toHaveBeenCalled()
  })
  it.each([{ organisation: otherOrganisation, role: 'Investor' }, { organisation, role: 'SuperAdmin' }, { mode: 'applicant', organisation, role: 'Investor' }, { mode: 'ROLE' }, { mode: 'applicant', application: otherOrganisation }])('does not let the pause authorise forged context %j', async query => {
    mocks.paused.mockReturnValue(true); mocks.sufficient.mockReturnValue(false)
    mocks.entry.mockResolvedValue({ ...ordinaryFor().entry, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Own organisation', roles: ['Investor'] }] })
    await expect(loadRoleDashboard(query)).rejects.toMatchObject({ status: 403 })
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not fall back to business reads when the paused own-only backend denies access', async () => {
    mocks.paused.mockReturnValue(true); mocks.entry.mockRejectedValue(new PortalError('Denied', 403))
    await expect(loadRoleDashboard({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.portal).not.toHaveBeenCalled()
  })
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
  it('offers personal capacity selection when a native profile has no current operating assignment', async () => {
    mocks.workspace.mockResolvedValue({ user: { ...actor, platformUserId: 'person', displayName: null }, organisations: [] })
    const result = await loadRoleDashboard({})
    expect(result.kind).toBe('applicant')
    expect(result.operatingContext).toEqual(APPLICANT_CONTEXT)
    expect(result.scopes).toEqual([])
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
    mocks.entry.mockResolvedValue({ entry_version: 1, actor, applications: [], contexts: [], admission: { manual_test_review: false }, workflow: { version: 1, environment: 'MAINNET', actor_id: actor.id, scoped_read_available: false } })
    const result = await loadRoleDashboard({})
    expect(result.release.environment).toBe('MAINNET'); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('uses a configured unavailable scoped route without calling the business reader', async () => {
    mocks.entry.mockResolvedValue({ entry_version: 1, actor, applications: [], contexts: [], admission: { manual_test_review: true }, workflow: { version: 1, environment: 'TESTNET', actor_id: actor.id, scoped_read_available: false } })
    const result = await loadRoleDashboard({ organisation, role: 'Investor' })
    expect(result.kind).toBe('role'); expect(result.portal).toBeUndefined(); expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not downgrade a denied entry session into role dashboard access', async () => {
    mocks.entry.mockRejectedValue(new PortalError('Denied current session', 403))
    await expect(loadRoleDashboard({ organisation, role: 'Investor' })).rejects.toMatchObject({ status: 403 })
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not read staff queues when the shared workflow reader fails', async () => {
    mocks.entry.mockRejectedValue(new PortalError('Unavailable projection', 503))
    await expect(loadRoleDashboard({ organisation, role: 'Investor' })).rejects.toMatchObject({ status: 503 })
    expect(mocks.portal).not.toHaveBeenCalled()
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
