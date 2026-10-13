import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('./public-motion', () => ({ PublicMotion: ({ children }: { children: ReactNode }) => <>{children}</> }))

import { PublicShell } from './public-shell'

afterEach(() => vi.unstubAllEnvs())

describe('opt-in Homepage V4 public shell', () => {
  it.each(['default', 'homepage'] as const)('keeps FAQ reachable in the %s footer', variant => {
    const html = renderToStaticMarkup(<PublicShell variant={variant}><main id="main-content">Content</main></PublicShell>)
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? ''
    expect(footer).toMatch(/href="\/faq"[^>]*>FAQ<\/a>/)
  })
  it('preserves the default secondary-page shell and primary workflow destination', () => {
    const html = renderToStaticMarkup(<PublicShell><main id="main-content">Secondary page</main></PublicShell>)
    const explicitDefault = renderToStaticMarkup(<PublicShell variant="default"><main id="main-content">Secondary page</main></PublicShell>)
    expect(html).toBe(explicitDefault)
    expect(html).toContain('Digital ownership infrastructure for private markets.')
    expect(html).toContain('View platform workflow')
    expect(html).not.toContain('TESTNET PREVIEW')
    expect(html).not.toContain('home-footer-platform')
    expect(html).not.toContain('Book a walkthrough')
  })

  it('keeps the actual brand and real footer destinations in the homepage variant without inventing legal pages', () => {
    const html = renderToStaticMarkup(<PublicShell variant="homepage"><main id="main-content">Homepage</main></PublicShell>)
    expect(html).toContain('blockxone-lockup-horizontal.png')
    expect(html).toContain('Private-market infrastructure.')
    expect(html).toContain('home-footer-platform')
    expect(html).toContain('href="/request-demo"')
    expect(html).toContain('Book a walkthrough')
    expect(html).not.toContain('href="/privacy"')
    expect(html).not.toContain('href="/terms"')
  })
})
