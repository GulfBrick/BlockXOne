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
  it('uses the branded Testnet login and preserves the existing Mainnet login on desktop', () => {
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess />)
    const desktop = html.match(/<nav aria-label="Primary navigation"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(desktop).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(desktop).toContain('aria-label="Testnet sign in"')
    expect(html).toMatch(/href="\/login"[^>]*>Mainnet sign in<\/a>/)
    expect(html).toContain('View platform workflow')
    expect(html).not.toContain('.vercel.app')
    expect(html).not.toContain('target="_blank"')
  })

  it('provides the same explicit environment destinations in the open mobile menu', () => {
    state.mobileOpen = true
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess />)
    const mobile = html.match(/<nav aria-label="Mobile public navigation"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(html).toContain('aria-expanded="true"')
    expect(mobile).toMatch(/href="https:\/\/testnet\.bx1\.co\.za\/login"[^>]*>Testnet sign in<\/a>/)
    expect(mobile).toMatch(/href="\/login"[^>]*>Mainnet sign in<\/a>/)
    expect(mobile).toContain('View platform workflow')
    expect(mobile).not.toContain('.vercel.app')
  })

  it.each([false, true])('keeps Mainnet advertising gated without hiding Testnet (mobile=%s)', mobileOpen => {
    state.mobileOpen = mobileOpen
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess={false} />)
    expect(html).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
    expect(html).not.toContain('href="/login"')
    expect(html).not.toContain('Mainnet sign in')
  })

  it('does not interpret the current path as an external destination or change existing primary actions', () => {
    state.pathname = '/how-it-works'
    const html = renderToStaticMarkup(<PublicNavigation showPortalAccess />)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Choose workspace')
    expect(html).toContain(`href="${BRANDED_ENTRY.testnetLogin}"`)
  })
})
