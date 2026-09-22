import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), context: vi.fn(), sufficient: vi.fn(), view: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.context, hasRequiredMfa: mocks.sufficient, toMfaView: mocks.view }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`) }, notFound: () => { throw Error('NOT_FOUND') } }))
import MfaPage from './page'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({})
  mocks.context.mockResolvedValue({ token: 'NEVER-SERIALIZE' })
  mocks.sufficient.mockReturnValue(false)
  mocks.view.mockReturnValue({ state: 'challenge_required', factors: [{ id: '11111111-1111-4111-8111-111111111111', status: 'verified', factorType: 'totp' }], hasPendingTotp: false })
})
describe('MFA bootstrap page', () => {
  it('renders safe challenge and POST logout without workspace reads', async () => {
    const html = renderToStaticMarkup(await MfaPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Verify your sign-in')
    expect(html).toContain('action="/auth/logout"')
    expect(html).toContain('href="/workspace/recovery"')
    expect(html).toContain('Lost your authenticator? View recovery containment')
    expect(html).not.toContain('NEVER-SERIALIZE')
  })
  it('fixed setup continuation survives challenge render', async () => {
    const html = renderToStaticMarkup(await MfaPage({ searchParams: Promise.resolve({ continue: 'setup' }) }))
    expect(html).toContain('Verify code')
    mocks.sufficient.mockReturnValue(true)
    await expect(MfaPage({ searchParams: Promise.resolve({ continue: 'setup' }) })).rejects.toThrow('REDIRECT:/login?setup=1')
  })
  it('sufficient context redirects to workspace', async () => {
    mocks.sufficient.mockReturnValue(true)
    await expect(MfaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/workspace')
  })
  it('missing active identity requires sign-in', async () => {
    mocks.context.mockResolvedValue(null)
    await expect(MfaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login')
  })
  it.each([{ next: 'https://evil.test' }, { continue: ['setup', 'setup'] }, { continue: 'security' }, { access_token: 'private' }])('rejects unknown or duplicate queries %j', async params => {
    const html = renderToStaticMarkup(await MfaPage({ searchParams: Promise.resolve(params) }))
    expect(html).toContain('Verification is temporarily unavailable.')
    expect(html).not.toContain('Authentication code')
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('provider failure shows generic unavailable not enrollment', async () => {
    mocks.context.mockRejectedValue(Error('private-provider-detail'))
    const html = renderToStaticMarkup(await MfaPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Verification is temporarily unavailable.')
    expect(html).not.toContain('private-provider-detail')
    expect(html).not.toContain('Set up authenticator')
  })
  it('legacy or mismatched mode has no alternate MFA path', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    await expect(MfaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
  })
})
