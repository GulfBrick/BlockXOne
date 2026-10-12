import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BRANDED_ENTRY } from '@/lib/branded-entry'

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

describe('branded Mainnet and Testnet public navigation', () => {
  it('keeps the Stage 3 Mainnet controls and exposes the branded Testnet login on desktop', () => {
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment="MAINNET" />)
    const desktop = html.match(/<nav aria-label="Primary navigation"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(desktop).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(desktop).toContain('aria-label="Testnet sign in"')
    expect(html).not.toContain('href="https://testnet.bx1.co.za"')
    expect(html).toMatch(/href="\/register"[^>]*>Register<\/a>/)
    expect(html).toMatch(/href="\/login"[^>]*>Mainnet sign in<\/a>/)
    expect(html).toContain('View platform workflow')
    expect(html).not.toContain('.vercel.app')
    expect(html).not.toContain('target="_blank"')
  })

  it('provides the same explicit environment destinations in the open mobile menu', () => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment="MAINNET" />)
    const mobile = html.match(/<nav aria-label="Mobile public navigation"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(html).toContain('aria-expanded="true"')
    expect(mobile).toMatch(/href="https:\/\/testnet\.bx1\.co\.za\/login"[^>]*>Testnet sign in<\/a>/)
    expect(mobile).not.toContain('href="https://testnet.bx1.co.za"')
    expect(mobile).toMatch(/href="\/register"[^>]*>Register<\/a>/)
    expect(mobile).toMatch(/href="\/login"[^>]*>Mainnet sign in<\/a>/)
    expect(mobile).toContain('View platform workflow')
    expect(mobile).not.toContain('.vercel.app')
  })

  it.each([false, true])('keeps Mainnet advertising gated without hiding Testnet (mobile=%s)', mobileOpen => {
    state.mobileOpen = mobileOpen
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={false} environment="MAINNET" />)
    expect(html).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(html).not.toContain('href="/login"')
    expect(html).not.toContain('Mainnet sign in')
  })

  it('does not interpret the current path as an external destination or change existing primary actions', () => {
    state.pathname = '/how-it-works'
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment="MAINNET" />)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Choose workspace')
    expect(html).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
  })

  it.each([false, true])('keeps Testnet sign-in local and labels the Mainnet switch accurately (mobile=%s)', mobileOpen => {
    state.mobileOpen = mobileOpen
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment="TESTNET" />)
    expect(html).not.toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(html).toMatch(/href="\/login"[^>]*>Testnet sign in<\/a>/)
    expect(html).toMatch(/href="https:\/\/bx1\.co\.za"[^>]*>Mainnet · admission required<\/a>/)
    expect(html).toMatch(/href="\/register"[^>]*>Register<\/a>/)
    expect(html).not.toContain('Mainnet sign in')
  })

  it('does not invent an environment switch when release identity is unknown', () => {
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={false} />)
    expect(html).not.toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(html).not.toContain('href="https://bx1.co.za"')
    expect(html).not.toContain('href="/register"')
    expect(html).not.toContain('href="/login"')
  })

  it.each(['MAINNET', 'TESTNET'] as const)('changes only the homepage CTA while retaining %s desktop access gates', environment => {
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess environment={environment} variant="homepage" />)
    expect(html).toMatch(/href="\/request-demo"[^>]*>Book a walkthrough<\/a>/)
    expect(html).not.toContain('View platform workflow')
    expect(html).toMatch(/href="\/register"[^>]*>Register<\/a>/)
    expect(html).toMatch(new RegExp(`href="/login"[^>]*>${environment === 'MAINNET' ? 'Mainnet' : 'Testnet'} sign in</a>`))
    expect(html).toContain('2xl:flex')
    if (environment === 'MAINNET') expect(html).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    else expect(html).toContain('Mainnet · admission required')
  })

  it.each(['MAINNET', 'TESTNET'] as const)('retains every destination in the homepage %s menu and honours sign-in advertising', environment => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={false} environment={environment} variant="homepage" />)
    const mobile = html.match(/<nav aria-label="Mobile public navigation"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('2xl:hidden')
    for (const href of ['/how-it-works', '/asset-classes', '/for-investors', '/for-operators', '/security-and-compliance', '/register', '/request-demo']) expect(mobile).toContain(`href="${href}"`)
    expect(mobile).not.toContain('href="/login"')
    if (environment === 'MAINNET') expect(mobile).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    else expect(mobile).toContain('href="https://bx1.co.za"')
  })
})
