import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), workspace: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn(), rpc: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: () => { mocks.notFound(); throw new Error('NEXT_NOT_FOUND') },
  redirect: (path: string) => { mocks.redirect(path); throw new Error(`NEXT_REDIRECT:${path}`) },
}))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.create }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))
vi.mock('@/components/portal/registration-form', () => ({ RegistrationForm: () => createElement('p', null, 'server-admitted registration') }))
vi.mock('@/components/portal/portal-screens', () => ({ PortalScreen: () => createElement('p', null, 'server-admitted portal') }))

vi.mock('@/components/portal/entry-screen', () => ({ EntryScreen: () => createElement('p', null, 'server-admitted entry') }))

import RegisterPage, { generateMetadata as registrationMetadata } from '@/app/register/page'
import { PortalPage } from '@/components/portal/portal-page'
import { isPortalSnapshot, loadPortalPage, readPortal } from './server'
import { APPLICANT_CONTEXT } from './operating-context'

const origin = 'https://block-x-one-admission-test.vercel.app'
const user = { id: 'd22789ee-7f73-4acf-a414-3de0b62ea801', email: 'applicant@example.test', email_confirmed_at: '2026-09-21T08:00:00Z', is_anonymous: false }
const organisation = '33333333-3333-4333-8333-333333333333'
const roleContext = { mode: 'ROLE' as const, organisationId: organisation, role: 'Investor' as const }
const snapshot = { actor: { id: user.id, email: user.email, display_name: null, can_review: false }, operating_context: APPLICANT_CONTEXT, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
const entrySnapshot = { entry_version: 1, actor: { id: user.id, email: user.email }, applications: [], contexts: [], admission: { manual_test_review: true } }
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
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_entry_read' ? entrySnapshot : snapshot, error: null }) }))
})
afterEach(() => vi.unstubAllEnvs())

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
    expect(html).toContain('Mainnet environment')
    expect(html).toContain('Account access terms')
    expect(html).not.toContain('Hosted test environment')
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
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_entry_read')
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_read_scoped', { operating_context: APPLICANT_CONTEXT })
    expect(mocks.workspace).not.toHaveBeenCalled()
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
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot, operating_context: roleContext }, error: null }) })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/portfolio', query: { organisation, role: 'Investor' } }))
    expect(html).toContain('server-admitted portal')
    expect(mocks.workspace).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_read_scoped', { operating_context: roleContext })
    expect(mocks.current).toHaveBeenCalledTimes(1)
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
