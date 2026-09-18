import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), context: vi.fn(), sufficient: vi.fn(), view: vi.fn(), workspace: vi.fn(), current: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.context, hasRequiredMfa: mocks.sufficient, toMfaView: mocks.view, isMfaContextCurrent: mocks.current }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw Error(`REDIRECT:${path}`) }, notFound: () => { throw Error('NOT_FOUND') } }))
import SecurityPage from './page'
beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({})
  mocks.context.mockResolvedValue({ token: 'private' })
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.view.mockReturnValue({ state: 'unenrolled', factors: [], hasPendingTotp: false })
  mocks.workspace.mockResolvedValue({ user: { id: 'u1' } })
})
describe('account security page', () => {
  it('does not expose enrollment if the token changes during workspace lookup', async () => {
    mocks.current.mockResolvedValue(false)
    const html = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Verification is temporarily unavailable.')
    expect(html).not.toContain('Set up authenticator')
    expect(mocks.view).not.toHaveBeenCalled()
  })
  it('offers explicit opt-in only after fresh context and active workspace', async () => {
    const html = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Account security')
    expect(html).toContain('Set up authenticator')
    expect(html).toContain('action="/auth/logout"')
    expect(html).toContain('Financial and token operations are not enabled.')
    expect(html).not.toContain('private')
    expect(mocks.context.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0])
  })
  it('routes enrolled insufficient session to challenge before workspace', async () => {
    mocks.sufficient.mockReturnValue(false)
    await expect(SecurityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login/mfa')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('does not treat missing identity as unenrolled', async () => {
    mocks.context.mockResolvedValue(null)
    await expect(SecurityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('no active workspace redirects to access denied', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(SecurityPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/workspace/access-denied')
  })
  it('provider failure and unknown query never expose a setup control', async () => {
    mocks.context.mockRejectedValue(Error('private failure'))
    const html = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Verification is temporarily unavailable.')
    expect(html).not.toContain('Set up authenticator')
    const query = renderToStaticMarkup(await SecurityPage({ searchParams: Promise.resolve({ token: 'private' }) }))
    expect(query).not.toContain('Set up authenticator')
  })
})
