import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const state = vi.hoisted(() => ({ mobileOpen: false, pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [state.mobileOpen, vi.fn()],
  useLayoutEffect: vi.fn(),
}))
vi.mock('animejs', () => ({ animate: vi.fn(), createScope: vi.fn(), stagger: vi.fn() }))
import { PublicNavigation } from './public-navigation'

beforeEach(() => { state.mobileOpen = false; state.pathname = '/' })

const destinations = ['/how-it-works', '/asset-classes', '/for-investors', '/for-operators', '/security-and-compliance', '/faq']
const navigation = (html: string, label: string) => html.match(new RegExp(`<nav aria-label="${label}"[\\s\\S]*?</nav>`))?.[0] ?? ''
const actions = (html: string) => html.match(/<div[^>]*data-bxo-nav-actions[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ''

describe('one public navigation across Mainnet and Testnet', () => {
  it.each(['MAINNET', 'TESTNET'] as const)('keeps all six destinations and the active FAQ in both sizes and variants on %s', environment => {
    state.pathname = '/faq'
    state.mobileOpen = true
    for (const variant of ['default', 'homepage'] as const) {
      const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment={environment} variant={variant} />)
      for (const label of ['Primary navigation', 'Mobile public navigation']) {
        const nav = navigation(html, label)
        for (const href of destinations) expect(nav).toContain(`href="${href}"`)
        const faqLinks = nav.match(/<a\b(?=[^>]*\bhref="\/faq")[^>]*>[\s\S]*?<\/a>/g) ?? []
        expect(faqLinks).toHaveLength(1)
        expect(faqLinks[0]).toMatch(/^<a\b[^>]*\baria-current="page"/)
        expect(faqLinks[0]).toContain('FAQ')
      }
    }
  })

  it.each(['MAINNET', 'TESTNET'] as const)('shows only Sign in and Create account as the desktop actions on %s', environment => {
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment={environment} />)
    const desktopActions = actions(html)
    expect(desktopActions.match(/<a\b/g)).toHaveLength(2)
    expect(desktopActions).toMatch(/href="\/login"[^>]*>Sign in<\/a>/)
    expect(desktopActions).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
    expect(navigation(html, 'Primary navigation').match(/<a\b/g)).toHaveLength(6)
    expect(html).toContain('xl:flex')
    expect(html).toContain('xl:hidden')
    expect(html).not.toContain('2xl:')
    expect(html).not.toContain('href="https://')
    expect(html).not.toMatch(/Mainnet|Testnet|View platform workflow|Book a walkthrough|Choose workspace/)
    expect(html).not.toContain('.vercel.app')
    expect(html).not.toContain('target="_blank"')
  })

  it.each(['MAINNET', 'TESTNET'] as const)('provides one uniform local action pair in the open %s mobile menu', environment => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment={environment} variant="homepage" />)
    const mobile = navigation(html, 'Mobile public navigation')
    expect(html).toContain('aria-expanded="true"')
    expect(mobile.match(/href="\/register"/g)).toHaveLength(1)
    expect(mobile.match(/href="\/login"/g)).toHaveLength(1)
    expect(mobile).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
    expect(mobile).toMatch(/href="\/login"[^>]*>Sign in<\/a>/)
    expect(mobile).not.toContain('href="https://')
    expect(mobile).not.toContain('/request-demo')
  })

  it.each([false, true])('renders identical valid MAIN/TEST and homepage/secondary navigation (mobile=%s)', mobileOpen => {
    state.mobileOpen = mobileOpen
    const renders = (['MAINNET', 'TESTNET'] as const).flatMap(environment => (['default', 'homepage'] as const).map(variant => renderToStaticMarkup(<PublicNavigation showPortalAccess environment={environment} variant={variant} />)))
    for (const html of renders) expect(html).toBe(renders[0])
  })

  it.each(['MAINNET', 'TESTNET'] as const)('keeps sign-in advertising gated on %s while retaining validated registration', environment => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={false} environment={environment} />)
    expect(html).not.toContain('href="/login"')
    expect(html).not.toContain('>Sign in</a>')
    expect(actions(html)).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
    expect(navigation(html, 'Mobile public navigation')).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
  })

  it.each([false, true])('does not manufacture account entry from an unknown environment (advertised=%s)', showPortalAccess => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={showPortalAccess} />)
    expect(html).not.toContain('href="/register"')
    expect(html).not.toContain('href="/login"')
    expect(html).not.toContain('href="https://')
    expect(actions(html)).toMatch(/href="\/how-it-works"[^>]*>Platform<\/a>/)
    for (const href of destinations) expect(navigation(html, 'Primary navigation')).toContain(`href="${href}"`)
  })

  it('uses the current path only for active navigation, not for different account actions', () => {
    state.pathname = '/how-it-works/details'
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment="MAINNET" />)
    expect(navigation(html, 'Primary navigation')).toMatch(/<a\b(?=[^>]*\bhref="\/how-it-works")(?=[^>]*\baria-current="page")[^>]*>/)
    expect(actions(html)).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
    expect(actions(html)).toMatch(/href="\/login"[^>]*>Sign in<\/a>/)
    expect(html).not.toContain('Choose workspace')
  })
})
