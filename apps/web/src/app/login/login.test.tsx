import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), workspace: vi.fn(), cookies: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn() }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`) } }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', async (importOriginal) => ({ ...await importOriginal<object>(), readWorkspace: mocks.workspace }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
import LoginPage, { generateMetadata } from './page'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', '')
  mocks.client.mockResolvedValue({})
  mocks.mfa.mockResolvedValue({})
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.workspace.mockResolvedValue({ user: { id: 'u1' }, organisations: [{ id: 'o1' }] })
  mocks.cookies.mockResolvedValue({ get: () => undefined })
})
describe('server login/setup admission', () => {
  it('does not render password setup after the token changes during workspace lookup', async () => {
    mocks.current.mockResolvedValue(false)
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('action="/auth/setup"')
  })
  it('routes enrolled recovery/setup to fixed MFA continuation before workspace', async () => {
    mocks.sufficient.mockReturnValue(false)
    await expect(LoginPage({ searchParams: Promise.resolve({ setup: '1' }) })).rejects.toThrow('REDIRECT:/login/mfa?continue=setup')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('requires active bootstrap and does not treat failed assurance as nofactor', async () => {
    mocks.mfa.mockResolvedValue(null)
    const absent = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(absent).toContain('This invitation link is invalid or has expired.')
    expect(mocks.workspace).not.toHaveBeenCalled()
    mocks.mfa.mockRejectedValue(Error('private-provider-error'))
    const unavailable = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(unavailable).toContain('Access is temporarily unavailable.')
    expect(unavailable).not.toContain('private-provider-error')
  })
  it('login/setup metadata preserves browser POST origins without exposing URL paths or query strings', async () => {
    for (const searchParams of [{}, { setup: '1' }, { error: 'invalid_credentials' }]) {
      expect((await generateMetadata({ searchParams: Promise.resolve(searchParams) })).referrer).toBe('strict-origin')
    }
    expect((await generateMetadata({ searchParams: Promise.resolve({ token_hash: 'synthetic' }) })).referrer).toBe('no-referrer')
  })
  it('shows the real login without legacy portals or public registration', async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Sign in to BlockXOne')
    expect(html).toContain('action="/auth/login"')
    expect(html).not.toContain('Investor sign in')
    expect(html).not.toContain('/register')
  })
  it('links new test customers to registration only in the exact hosted test environment', async () => {
    vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
    vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1-customer-preview.vercel.app')
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('href="/register"')
    expect(html).toContain('Create your test account')
    expect(html).toContain('investor or wealth manager')
    expect(html).toContain('Registration does not grant approval or signing authority')
    expect(html).toContain('action="/auth/login"')
    const setup = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(setup).not.toContain('href="/register"')
    expect(setup).toContain('action="/auth/setup"')
  })
  it.each([
    ['VERCEL_ENV', 'production'],
    ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'],
    ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'],
    ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', ''],
  ])('does not advertise registration when the exact test guard is broken: %s', async (name, value) => {
    vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
    vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1-customer-preview.vercel.app')
    vi.stubEnv(name, value)
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('href="/register"')
    expect(html).not.toContain('Create your test account')
  })
  it('query setup=1 alone never authorizes password setup', async () => {
    mocks.workspace.mockResolvedValue(null)
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(html).toContain('This invitation link is invalid or has expired.')
    expect(html).not.toContain('action="/auth/setup"')
  })
  it('renders password setup only after a fresh verified workspace', async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1' }) }))
    expect(mocks.workspace).toHaveBeenCalledOnce()
    expect(html).toContain('action="/auth/setup"')
    expect(html).not.toContain('name="email"')
  })
  it('renders actionable setup errors only after checking the active workspace', async () => {
    const params = { setup: '1', error: 'password_mismatch' }
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }))
    expect(html).toContain('The two passwords do not match.')
    expect(html).toContain('action="/auth/setup"')
    expect((await generateMetadata({ searchParams: Promise.resolve(params) })).referrer).toBe('strict-origin')
    mocks.workspace.mockResolvedValue(null)
    const denied = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }))
    expect(denied).not.toContain('action="/auth/setup"')
  })
  it('turns errors into fixed copy, not provider details or user query text', async () => {
    mocks.workspace.mockRejectedValueOnce(new Error('private-provider-detail'))
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ setup: '1', error: '<script>bad</script>' }) }))
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('private-provider-detail')
    expect(html).not.toContain('<script>')
  })
  it('never falls back to legacy UI for mismatched flags', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('Institutional sign in')
    expect(html).not.toContain('<form')
  })
  it('preserves old chooser only when BOTH mode flags are absent', async () => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', '')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Investor sign in')
    expect(html).not.toContain('action="/auth/login"')
  })
})
