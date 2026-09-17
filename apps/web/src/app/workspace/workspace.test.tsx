import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
import WorkspacePage, { generateMetadata } from './page'
import AccessDeniedPage from './access-denied/page'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({})
  mocks.user.mockResolvedValue({ id: 'u1', email: 'real@example.test' })
  mocks.workspace.mockResolvedValue({ user: { id: 'u1', email: 'real@example.test', platformUserId: 'legacy1', displayName: 'Real Person' }, organisations: [{ id: 'o1', name: 'BlockXOne Internal', roles: ['SuperAdmin', 'FinancialController'] }] })
})

describe('server-rendered protected workspace', () => {
  it('workspace metadata enables native signout while token-bearing URLs retain no-referrer', async () => {
    expect((await generateMetadata({ searchParams: Promise.resolve({}) })).referrer).toBe('strict-origin')
    expect((await generateMetadata({ searchParams: Promise.resolve({ access_token: 'synthetic' }) })).referrer).toBe('no-referrer')
  })
  it('renders only actual identity/assignments, a POST logout and explicit unavailable operations', async () => {
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(mocks.workspace).toHaveBeenCalledOnce()
    expect(html).toContain('real@example.test')
    expect(html).toContain('Real Person')
    expect(html).toContain('BlockXOne Internal')
    expect(html).toContain('SuperAdmin')
    expect(html).toContain('FinancialController')
    expect(html).toContain('method="post" action="/auth/logout"')
    expect(html).toContain('Financial and token operations are not enabled.')
    expect(html).not.toContain('balance')
    expect(html).not.toContain('/api/')
    expect(html).not.toContain('legacy1')
  })
  it('redirects missing identity to login before workspace lookup', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(WorkspacePage()).rejects.toThrow('REDIRECT:/login')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('redirects absent active assignment to the generic denied page', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(WorkspacePage()).rejects.toThrow('REDIRECT:/workspace/access-denied')
  })
  it('does not render identity or pretend signout on provider/database failure', async () => {
    mocks.workspace.mockRejectedValue(new Error('private-query-detail'))
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain('private-query-detail')
  })
  it('does not render a workspace when paired mode is absent or inconsistent', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    await expect(WorkspacePage()).rejects.toThrow('NOT_FOUND')
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('access denial contains public-safe copy and recovery links only', () => {
    const html = renderToStaticMarkup(<AccessDeniedPage />)
    expect(html).toContain('Workspace access is unavailable.')
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain('/auth/setup')
  })
})
