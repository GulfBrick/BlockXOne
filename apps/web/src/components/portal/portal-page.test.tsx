import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/portal/server', () => ({ loadPortalPage: fixture.load, PortalError: class extends Error { constructor(message: string, public readonly status: number) { super(message) } } }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
import { PortalError } from '@/lib/portal/server'
import { PortalPage } from './portal-page'

describe('portal server page access states', () => {
  it('redirects an anonymous session to the existing sign-in route', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Sign in', 401))
    await expect(PortalPage({ view: '/portal' })).rejects.toThrow('REDIRECT:/login')
  })
  it('returns not-found in an environment where the portal is disabled', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Not enabled', 404))
    await expect(PortalPage({ view: '/portal' })).rejects.toThrow('NOT_FOUND')
  })
  it('offers sign-in security without granting roles when the session lacks access', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('MFA needed', 403))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).toContain('Complete your account access'); expect(html).toContain('href="/login/mfa"'); expect(html).toContain('No new privileges')
  })
  it('shows a truthful retry state without leaking backend errors', async () => {
    fixture.load.mockRejectedValueOnce(new Error('private database diagnostic'))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).toContain('Saved portal state is unavailable'); expect(html).not.toContain('private database diagnostic')
  })
})
