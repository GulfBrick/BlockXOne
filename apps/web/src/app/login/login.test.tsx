import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), workspace: vi.fn(), cookies: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', async (importOriginal) => ({ ...await importOriginal<object>(), readWorkspace: mocks.workspace }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
import LoginPage from './page'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({})
  mocks.workspace.mockResolvedValue({ user: { id: 'u1' }, organisations: [{ id: 'o1' }] })
  mocks.cookies.mockResolvedValue({ get: () => undefined })
})
describe('server login/setup admission', () => {
  it('shows the real login without legacy portals or public registration', async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Sign in to BlockXOne')
    expect(html).toContain('action="/auth/login"')
    expect(html).not.toContain('Investor sign in')
    expect(html).not.toContain('/register')
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
