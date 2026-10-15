import { createElement, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), workspace: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn(), rpc: vi.fn(), lifecycle: vi.fn(), registration: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { mocks.notFound(); throw new Error('NEXT_NOT_FOUND') },
  redirect: (path: string) => { mocks.redirect(path); throw new Error(`NEXT_REDIRECT:${path}`) },
}))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.create }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))
vi.mock('@/components/portal/registration-form', () => ({ RegistrationForm: (props: { environment: string }) => {
  mocks.registration(props)
  return createElement('p', null, 'server-admitted registration')
} }))
vi.mock('@/components/portal/portal-screens', () => ({ PortalScreen: () => createElement('p', null, 'server-admitted portal') }))
vi.mock('./fund-lifecycle-server', async original => ({ ...await original<object>(), readFundLifecycle: mocks.lifecycle }))

vi.mock('@/components/portal/entry-screen', () => ({ EntryScreen: () => createElement('p', null, 'server-admitted entry') }))

import RegisterPage, { generateMetadata as registrationMetadata } from '@/app/register/page'
import { PortalPage } from '@/components/portal/portal-page'
import { isPortalSnapshot, loadPortalPage, PackageReaderUnavailable, readPortal } from './server'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import { unavailableFundLifecycle } from './fund-lifecycle-server'

const origin = 'https://block-x-one-admission-test.vercel.app'
const user = { id: 'd22789ee-7f73-4acf-a414-3de0b62ea801', email: 'applicant@example.test', email_confirmed_at: '2026-09-21T08:00:00Z', is_anonymous: false }
const organisation = '33333333-3333-4333-8333-333333333333'
const roleContext = { mode: 'ROLE' as const, organisationId: organisation, role: 'Investor' as const }
const snapshot = { actor: { id: user.id, email: user.email, display_name: null, can_review: false }, operating_context: APPLICANT_CONTEXT, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
// This suite isolates admission/entry authority from the separately tested fund
// reader. Its explicit UNAVAILABLE extension cannot invent a ready fund/holding.
function lifecycleFixture(actorId: string, context: PortalOperatingContext) {
  return { ...unavailableFundLifecycle(actorId, context), observed_at: '2026-10-15T12:00:00Z' }
}
const entrySnapshot = {
  entry_version: 1, actor: { id: user.id, email: user.email }, applications: [], contexts: [], admission: { manual_test_review: true },
  workflow: { version: 1, environment: 'TESTNET' as const, actor_id: user.id, scoped_read_available: true },
}
const refusedConfigurations: [string, string][] = [
  ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'development'], ['VERCEL_ENV', ''],
  ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'],
  ['SUPABASE_URL', 'https://another-project.supabase.co'],
  ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'],
  ['BLOCKXONE_APP_ORIGIN', 'https://block-x-one.vercel.app'],
  ['BLOCKXONE_APP_ORIGIN', 'https://preview.example.test'],
  ['BLOCKXONE_AUTH_MODE', ''], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', ''],
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockResolvedValue({ rpc: mocks.rpc })
  mocks.user.mockResolvedValue(user)
  mocks.mfa.mockResolvedValue(null)
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.lifecycle.mockImplementation(async (_client, actorId: string, context: PortalOperatingContext) => lifecycleFixture(actorId, context))
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_entry_read' ? entrySnapshot : snapshot, error: null }) }))
})
afterEach(() => vi.unstubAllEnvs())

describe('strict case-specific TEST role-play application projection', () => {
  const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'ComplianceOfficer' as const }
  function ownCase() {
    return { ...snapshot, actor: { ...snapshot.actor, can_review: true }, operating_context: context,
      stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'STANDARD', actor_id: user.id, operating_context: context,
        allowed_commands: ['review_application'] }, applications: [{ id: organisation, user_id: user.id, persona: 'INVESTOR',
        status: 'SUBMITTED', revision: 2, details: { investor_type: 'INDIVIDUAL', test_data_acknowledged: true },
        provider_mode: 'MANUAL_TEST_REVIEW', admission_purpose: 'INVESTOR_ADMISSION',
        test_roleplay_review: { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
          actor_id: user.id, operating_context: context, policy_id: organisation, authority_epoch: 2, product_id: organisation,
          offering_revision_id: organisation, application_id: organisation, application_revision: 2,
          command: 'review_application', can_review: true, valid_until: '2099-01-01T00:00:00Z' } }] }
  }
  it('accepts the exact case-bound native TEST projection without generating provider or person facts', () => {
    const value = ownCase()
    expect(isPortalSnapshot(value, user.id)).toBe(true)
    expect(value.applications[0]).not.toHaveProperty('provider_result')
    expect(value.applications[0].test_roleplay_review.independence_proven).toBe(false)
  })
  it.each(['actor', 'context', 'revision', 'independence', 'role', 'extra', 'password'] as const)(
    'denies malformed role-play %s before it becomes a saved portal snapshot', failure => {
      const value = ownCase(), marker = value.applications[0].test_roleplay_review
      if (failure === 'actor') marker.actor_id = organisation
      if (failure === 'context') marker.operating_context = { ...context, organisationId: user.id }
      if (failure === 'revision') marker.application_revision = 1
      if (failure === 'independence') marker.independence_proven = true
      if (failure === 'role') Object.assign(marker.operating_context, { role: 'SuperAdmin' })
      if (failure === 'extra') Object.assign(marker, { trusted_person: true })
      if (failure === 'password') value.stage2_access.session_mode = 'TEST_PASSWORD'
      expect(isPortalSnapshot(value, user.id)).toBe(false)
    })
})

describe('bounded package read boundary and pre-cutover compatibility', () => {
  const manager = { mode: 'ROLE' as const, organisationId: organisation, role: 'OfferingManager' as const }
  const access = { version: 1, environment: 'TESTNET', actor_id: user.id, operating_context: manager, session_mode: 'TEST_PASSWORD', allowed_commands: ['submit_product'] }
  const marked = { ...snapshot, operating_context: manager, offering_access: access }
  // Source-bound contract ends, not a claim of a live Supabase/BFF journey.
  // The SQL proof independently calls both actual public role readers.
  const packageOnlySnapshot = (role: 'OfferingManager' | 'IssuerFundManager') => {
    const sql = readFileSync(new URL('../../../../../supabase/features/bx1_offering_workflow.sql', import.meta.url), 'utf8')
    const bodies = [...sql.matchAll(/create function bx1_portal\.offering_workflow_read_scoped\(c jsonb\) returns jsonb[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)]
    expect(bodies).toHaveLength(1)
    const projections = [...bodies[0][1].matchAll(/else\s+select pg_catalog\.jsonb_build_object\(([\s\S]*?)\)\s+into result from auth\.users u where u\.id=auth\.uid\(\);/g)]
    expect(projections).toHaveLength(1)
    const arrayKeys = [...projections[0][1].matchAll(/'([a-z_]+)'\s*,\s*'\[\]'::jsonb/g)].map(match => match[1])
    expect(arrayKeys).toEqual(['applications', 'organisations', 'accounts', 'entity_investment_accounts',
      'organisation_mandates', 'investing_representative_mandates', 'subscriptions', 'products',
      'product_eligibility', 'entity_product_eligibility', 'customer_monitoring', 'events', 'requests',
      'product_appointments', 'product_appointment_candidates'])
    expect(projections[0][1]).not.toMatch(/'funding'\s*,/)
    const context = { ...manager, role }
    return { ...Object.fromEntries(arrayKeys.map(key => [key, []])), actor: snapshot.actor,
      operating_context: context,
      stage2_access: { version: 1, environment: 'TESTNET', actor_id: user.id, operating_context: context,
        session_mode: 'TEST_PASSWORD', allowed_commands: [] },
      offering_access: { ...access, operating_context: context, allowed_commands: [] } }
  }
  it.each(['OfferingManager', 'IssuerFundManager'] as const)('accepts the SQL-shaped %s package payload without invented funding data', async role => {
    const data = packageOnlySnapshot(role), context = { ...manager, role }
    expect(Object.hasOwn(data, 'funding')).toBe(false)
    expect(isPortalSnapshot(data, user.id)).toBe(true)
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
    expect((await readPortal({ rpc: mocks.rpc } as never, context)).snapshot).toEqual({ ...data, fund_lifecycle: lifecycleFixture(user.id, context) })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_read_scoped', { operating_context: context })
    expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rpc: mocks.rpc }), user.id, context)
  })
  it.each(['OfferingManager', 'IssuerFundManager'] as const)('still rejects the old invalid funding array in a %s payload', async role => {
    const data = { ...packageOnlySnapshot(role), funding: [] }, context = { ...manager, role }
    expect(isPortalSnapshot(data, user.id)).toBe(false)
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
    await expect(readPortal({ rpc: mocks.rpc } as never, context)).rejects.toMatchObject({ status: 503 })
  })
  it('keeps valid financial object validation distinct from package-only data', async () => {
    const funding = { routes: [], obligations: [], references: [], reversals: [], journals: [{
      id: '10000000-0000-4000-8000-000000000001', obligation_id: '10000000-0000-4000-8000-000000000002',
      reference_id: '10000000-0000-4000-8000-000000000003', kind: 'FUNDING', amount_base_units: '1000000',
      token_address: `0x${'31'.repeat(20)}`, token_decimals: 6, created_at: '2026-10-13T00:00:00Z',
      original_journal_id: null, posted_by: user.id, allowed_actions: [], lines: [
        { account: 'TEST_SETTLEMENT_TOKEN_ASSET', side: 'DEBIT', amount_base_units: '1000000' },
        { account: 'TEST_CUSTOMER_FUNDING_LIABILITY', side: 'CREDIT', amount_base_units: '1000000' },
      ],
    }] }
    // Fictional DTO validation only: this does not invent a posted journal.
    const data = { ...snapshot, operating_context: roleContext, funding }
    expect(isPortalSnapshot(data, user.id)).toBe(true)
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
    expect((await readPortal({ rpc: mocks.rpc } as never, roleContext)).snapshot).toEqual({ ...data, fund_lifecycle: lifecycleFixture(user.id, roleContext) })
    expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rpc: mocks.rpc }), user.id, roleContext)
    for (const invalid of [null, {}, { ...funding, journals: 'paid' },
      { ...funding, journals: [{ ...funding.journals[0], amount_base_units: 1000000 }] }]) {
      const malformed = { ...data, funding: invalid }
      expect(isPortalSnapshot(malformed, user.id)).toBe(false)
      mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: malformed, error: null }) })
      await expect(readPortal({ rpc: mocks.rpc } as never, roleContext)).rejects.toMatchObject({ status: 503 })
    }
  })
  it('validates a package marker against the authenticated reader and selected context', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: marked, error: null }) })
    expect((await readPortal({ rpc: mocks.rpc } as never, manager)).snapshot).toEqual({ ...marked, fund_lifecycle: lifecycleFixture(user.id, manager) })
    expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rpc: mocks.rpc }), user.id, manager)
    for (const change of [{ actor_id: organisation }, { environment: 'MAINNET' }, { session_mode: 'STANDARD' },
      { operating_context: { ...manager, organisationId: user.id } }, { allowed_commands: ['publish_product'] }]) {
      expect(isPortalSnapshot({ ...marked, offering_access: { ...access, ...change } }, user.id)).toBe(false)
    }
    expect(isPortalSnapshot({ ...marked, stage2_access: { version: 1, environment: 'TESTNET', actor_id: user.id, operating_context: manager, session_mode: 'STANDARD', allowed_commands: [] } }, user.id)).toBe(false)
  })
  it.each(['OfferingManager', 'IssuerFundManager'] as const)('signals only the exact old-reader %s failure under trusted TEST pause configuration', async role => {
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za')
    vi.stubEnv('BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED', 'enabled')
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'admission_read_scope_denied' } }) })
    await expect(readPortal({ rpc: mocks.rpc } as never, { ...manager, role })).rejects.toBeInstanceOf(PackageReaderUnavailable)
    vi.stubEnv('BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED', 'disabled')
    await expect(readPortal({ rpc: mocks.rpc } as never, { ...manager, role })).rejects.toMatchObject({ status: 403 })
  })
  it.each([{ code: '42501', message: 'native_membership_revoked' }, { code: '57014', message: 'admission_read_scope_denied' },
    { code: '42501', message: 'admission_read_scope_denied\nextra' }])('never turns other backend failures into pre-cutover availability %#', async error => {
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za')
    vi.stubEnv('BLOCKXONE_TESTNET_ORDINARY_ENTRY_MFA_PAUSED', 'enabled')
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error }) })
    await expect(readPortal({ rpc: mocks.rpc } as never, manager)).rejects.not.toBeInstanceOf(PackageReaderUnavailable)
  })
})

describe('actual customer page admission', () => {
  it('rejects malformed guarded monitoring data instead of treating it as an empty Compliance queue', () => {
    const item = { application_id: organisation, application_revision: 1, state: 'ON_HOLD', case_revision: 1, admission_expires_at: null, renewal_due: null, new_actions_allowed: false }
    expect(isPortalSnapshot({ ...snapshot, customer_monitoring: [item] }, user.id)).toBe(true)
    expect(isPortalSnapshot({ ...snapshot, customer_monitoring: [{ ...item, new_actions_allowed: 'true' }] }, user.id)).toBe(false)
    expect(isPortalSnapshot({ ...snapshot, customer_monitoring: [item, item] }, user.id)).toBe(false)
  })
  it('shows explicit Continue, Switch account and Add a capacity for a signed-in person', async () => {
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({ intent: 'wealth-manager' }) }))
    expect(html).toContain('You are already signed in.')
    expect(html).toContain('Continue')
    expect(html).toContain('Switch account')
    expect(html).toContain('Add a capacity')
    expect(html).toContain('/auth/logout')
    expect(html).not.toContain('server-admitted registration')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('keeps shared registration available while the legacy business demo is disabled', async () => {
    vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'disabled')
    mocks.user.mockResolvedValueOnce(null)
    expect(renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({}) }))).toContain('server-admitted registration')
    await expect(loadPortalPage()).rejects.toMatchObject({ status: 404 })
  })
  it('renders shared MAINNET registration without test-evidence claims', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    mocks.user.mockResolvedValueOnce(null)
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({}) }))
    expect(mocks.registration).toHaveBeenCalledWith(expect.objectContaining({ environment: 'MAINNET' }))
    expect(html).toContain('Account access terms')
    expect(html).not.toContain('Hosted test environment')
    expect(html).not.toContain('Testnet terms')
  })
  it('uses submit-capable HTML metadata for clean registration and fixed retry/intent state', async () => {
    const queries: Record<string, string | string[] | undefined>[] = [
      {}, { intent: 'investor' }, { intent: 'wealth-manager' }, { error: 'email_invalid' },
      { intent: 'investor', error: 'password_mismatch' },
    ]
    for (const query of queries) {
      const metadata = await registrationMetadata({ searchParams: Promise.resolve(query) })
      expect(metadata.referrer).toBe('strict-origin')
      expect(metadata.robots).toEqual({ index: false, follow: false })
    }
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('keeps token-bearing, unknown, duplicate and non-form registration metadata private', async () => {
    const queries: Record<string, string | string[] | undefined>[] = [
      { token_hash: 'synthetic' }, { next: '//evil.test' }, { intent: 'SuperAdmin' },
      { error: 'raw-provider-detail' }, { intent: ['investor', 'investor'] },
      { error: ['email_invalid', 'email_invalid'] }, { status: 'check-email' },
    ]
    for (const query of queries) expect((await registrationMetadata({ searchParams: Promise.resolve(query) })).referrer).toBe('no-referrer')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each(refusedConfigurations)('rejects registration and portal before backend access when %s=%s', async (name, value) => {
    vi.stubEnv(name, value)
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))).toContain('Saved portal state is unavailable')
    await expect(loadPortalPage()).rejects.toMatchObject({ status: 404 })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
  it('does not let development or legacy pilot flags bypass the production server gate', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BLOCKXONE_RELEASE_MODE', 'pilot')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RELEASE_MODE', 'pilot')
    await expect(RegisterPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding' }))).toContain('Saved portal state is unavailable')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('renders registration only with the complete hosted TEST configuration', async () => {
    mocks.user.mockResolvedValueOnce(null)
    const html = renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('server-admitted registration')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('requires verified identity entry and scoped reads without inferring application type', async () => {
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))
    expect(html).toContain('server-admitted entry')
    expect(mocks.user).toHaveBeenCalledTimes(3)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'bx1_entry_read')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'bx1_portal_read_scoped', { operating_context: APPLICANT_CONTEXT })
    expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rpc: mocks.rpc }), user.id, APPLICANT_CONTEXT)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it.each([
    undefined,
    { ...entrySnapshot.workflow, actor_id: '55555555-5555-4555-8555-555555555555' },
    { ...entrySnapshot.workflow, environment: 'MAINNET', scoped_read_available: false },
  ])('rejects absent, other-actor or other-environment workflow before a scoped business read %#', async workflow => {
    mocks.rpc.mockImplementation((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_entry_read' ? { ...entrySnapshot, workflow } : snapshot, error: null }) }))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))
    expect(html).toContain('Saved portal state is unavailable')
    expect(html).not.toContain('server-admitted entry')
    expect(html).not.toContain('server-admitted portal')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_entry_read')
    expect(mocks.rpc).not.toHaveBeenCalledWith('bx1_portal_read_scoped', expect.anything())
  })
  it('does not let TEST configuration replace authentication', async () => {
    mocks.user.mockResolvedValueOnce(null)
    await expect(PortalPage({ view: '/portal/onboarding' })).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not render portal content when the live backend denies authority', async () => {
    mocks.rpc.mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))
    expect(html).not.toContain('server-admitted portal')
    expect(html).toContain('Complete your account access.')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_entry_read')
  })
  it('admits native business access only through the selected assignment and exact scoped response', async () => {
    mocks.mfa.mockResolvedValue({ userId: user.id })
    mocks.workspace.mockResolvedValue({ user: { id: user.id, email: user.email, platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'Synthetic issuer', roles: ['Investor'] }] })
    mocks.rpc.mockImplementation((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({
      data: name === 'bx1_entry_read'
        ? { ...entrySnapshot, contexts: [{ context_key: organisation, organisation_id: organisation, name: 'Synthetic issuer', roles: ['Investor'] }] }
        : { ...snapshot, operating_context: roleContext },
      error: null,
    }) }))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/portfolio', query: { organisation, role: 'Investor' } }))
    expect(html).toContain('server-admitted portal')
    expect(mocks.workspace).toHaveBeenCalledTimes(1)
    expect(mocks.user).toHaveBeenCalledTimes(3)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'bx1_entry_read')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'bx1_portal_read_scoped', { operating_context: roleContext })
    expect(mocks.lifecycle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rpc: mocks.rpc }), user.id, roleContext)
    expect(mocks.current).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, APPLICANT_CONTEXT, { ...roleContext, organisationId: '44444444-4444-4444-8444-444444444444' }, { ...roleContext, role: 'OfferingManager' }, { ...roleContext, extra: true }])('rejects a same-actor snapshot with missing, different or extra operating context %#', async actualContext => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot, operating_context: actualContext }, error: null }) })
    await expect(readPortal(await mocks.create(), roleContext)).rejects.toMatchObject({ status: 503 })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_read_scoped', { operating_context: roleContext })
  })
  it.each([null, {}, { ...snapshot, actor: { ...snapshot.actor, id: '55555555-5555-4555-8555-555555555555' } }, { ...snapshot, products: null }])('rejects absent, malformed or other-actor state rather than returning fake empty records %#', async data => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
    await expect(readPortal(await mocks.create(), APPLICANT_CONTEXT)).rejects.toMatchObject({ status: 503 })
  })
  it('reports an unavailable saved state without rendering an empty operational workspace', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '57014', message: 'private connection diagnostic' } }) })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))
    expect(html).toContain('Saved portal state is unavailable')
    expect(html).not.toContain('server-admitted portal')
    expect(html).not.toContain('private connection diagnostic')
  })
})
