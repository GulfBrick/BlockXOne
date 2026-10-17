import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('./public-motion', () => ({ PublicMotion: ({ children }: { children: ReactNode }) => <>{children}</> }))

import { PublicShell } from './public-shell'

afterEach(() => vi.unstubAllEnvs())

describe('shared BlockXOne public shell', () => {
  it.each(['default', 'homepage'] as const)('keeps FAQ reachable in the %s footer', variant => {
    const html = renderToStaticMarkup(<PublicShell variant={variant}><main id="main-content">Content</main></PublicShell>)
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? ''
    expect(footer).toMatch(/href="\/faq"[^>]*>FAQ<\/a>/)
  })
  it.each(['TESTNET', 'MAINNET'] as const)('keeps only the actual logo in the header under valid %s configuration', environment => {
    const testnet = environment === 'TESTNET'
    const supabaseUrl = `https://${testnet ? 'fegnnnlseuejkrusbbkv' : 'oqkevkjbkpugjotihtda'}.supabase.co`
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('SUPABASE_URL', supabaseUrl)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
    vi.stubEnv('VERCEL_ENV', testnet ? 'preview' : 'production')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', testnet ? 'https://testnet.bx1.co.za' : 'https://bx1.co.za')
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', environment)
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', environment)
    const headers: string[] = []
    for (const variant of ['default', 'homepage'] as const) {
      const html = renderToStaticMarkup(<PublicShell variant={variant}><main id="main-content">Content</main></PublicShell>)
      const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ''
      headers.push(header)
      expect(header).toContain('blockxone-lockup-horizontal.png')
      expect(header).not.toContain('TESTNET PREVIEW')
      expect(header).not.toContain('TESTNET ENVIRONMENT')
      expect(header).not.toContain('MAINNET ENVIRONMENT')
      expect(header).not.toContain('data-bxo-environment')
      expect(header).toContain('href="/register"')
      expect(header).toContain('href="/login"')
      expect(header).toMatch(/href="\/register"[^>]*>Create account<\/a>/)
      expect(header).toMatch(/href="\/login"[^>]*>Sign in<\/a>/)
      expect(header).not.toContain('href="https://')
    }
    expect(headers[0]).toBe(headers[1])
  })
  it('uses the light secondary-page workspace while preserving its primary workflow destination', () => {
    const html = renderToStaticMarkup(<PublicShell><main id="main-content">Secondary page</main></PublicShell>)
    const explicitDefault = renderToStaticMarkup(<PublicShell variant="default"><main id="main-content">Secondary page</main></PublicShell>)
    expect(html).toBe(explicitDefault)
    expect(html).toContain('class="bxo-content-light" data-bxo-page-content')
    expect(html).toContain('Private-market infrastructure.')
    expect(html).toMatch(/href="\/how-it-works"[^>]*>Platform<\/a>/)
    expect(html).not.toContain('TESTNET PREVIEW')
    expect(html).toContain('footer-platform-title')
    expect(html).not.toContain('Book a walkthrough')
  })

  it('keeps the actual brand and real footer destinations in the homepage variant without inventing legal pages', () => {
    const html = renderToStaticMarkup(<PublicShell variant="homepage"><main id="main-content">Homepage</main></PublicShell>)
    expect(html).toContain('blockxone-lockup-horizontal.png')
    expect(html).toContain('Private-market infrastructure.')
    expect(html).toContain('footer-platform-title')
    expect(html).toContain('href="/request-demo"')
    expect(html).not.toContain('Book a walkthrough')
    expect(html).not.toContain('href="/privacy"')
    expect(html).not.toContain('href="/terms"')
  })

  it('shares the same compact footer and actual brand across public page variants', () => {
    const footers = (['default', 'homepage'] as const).map(variant => renderToStaticMarkup(<PublicShell variant={variant}><main id="main-content">Content</main></PublicShell>).match(/<footer[\s\S]*?<\/footer>/)?.[0])
    expect(footers[0]).toBeDefined()
    expect(footers[0]).toBe(footers[1])
    expect(footers[0]).toContain('blockxone-lockup-horizontal.png')
    expect(footers[0]).toContain('href="/request-demo"')
  })
})
