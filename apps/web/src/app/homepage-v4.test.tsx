import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/components/public/public-motion', () => ({ PublicMotion: ({ children }: { children: ReactNode }) => <>{children}</> }))

import HomePage from './page'

function configureEnvironment(environment: 'TESTNET' | 'MAINNET') {
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
}

beforeEach(() => configureEnvironment('TESTNET'))
afterEach(() => vi.unstubAllEnvs())

describe('Homepage V4 within the existing BlockXOne application', () => {
  it('keeps the exact brand artwork, one heading and the customer-coordination proposition', () => {
    const html = renderToStaticMarkup(<HomePage />)
    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toContain('Bring private assets')
    expect(html).toContain('one working system.')
    expect(html).toContain('Coordinate your teams, investor instructions and asset records')
    expect(html).toContain('blockxone-lockup-horizontal.png')
    expect(html).toContain('blockxone-mark.png')
    expect(html).toContain('Skip to main content')
    expect(html).toContain('id="main-content"')
    expect(html).toContain('homepage-sculpture-v4.png')
    expect(html).toContain('width="1536"')
    expect(html).toContain('height="1024"')
    expect(html).not.toContain('hero-operable-assets.webp')
    expect(html).not.toContain('Three validated instrument structures')
  })

  it('uses maintained walkthrough, platform, asset and participant destinations rather than fake controls', () => {
    const html = renderToStaticMarkup(<HomePage />)
    for (const href of ['/request-demo', '/how-it-works', '/asset-classes', '/for-operators', '/for-investors', '/security-and-compliance']) expect(html).toContain(`href="${href}"`)
    expect(html).toMatch(/href="\/request-demo"[^>]*>Book a walkthrough/)
    expect(html).toMatch(/href="\/how-it-works"[^>]*>See the platform/)
    expect(html).toMatch(/href="#example-records"[^>]*>Explore the worked example/)
    expect(html).toContain('id="example-records"')
    expect(html).not.toMatch(/href="(?:#|\/privacy|\/terms|\/guided-demo)"/)
    expect(html).not.toContain('.vercel.app')
    expect(html).not.toContain('target="_blank"')
  })

  it('retains the six distinct responsibility groups and all seven workflow gates in order', () => {
    const html = renderToStaticMarkup(<HomePage />)
    for (const role of ['Offering teams', 'Compliance', 'Finance', 'Transfer agents', 'Tokenisation agents', 'Investors']) expect(html).toMatch(new RegExp(`<h3>${role}<\\/h3>`))
    expect(html).toContain('A shared record is not a shared wallet or universal permission.')
    expect(html).toContain('Product operating models, not available investment offers.')
    const sequence = html.match(/<ol\b[^>]*aria-label="The seven business workflow stages"[\s\S]*?<\/ol>/)?.[0]
    expect(sequence).toBeDefined()
    expect(sequence?.match(/<li\b/g)).toHaveLength(7)
    expect(sequence?.match(/<h3>([^<]+)<\/h3>/g)).toEqual(['Model', 'Approve', 'Qualify', 'Subscribe', 'Reconcile', 'Issue', 'Prove'].map(title => `<h3>${title}</h3>`))
    expect(html).toContain('Each stage retains its own checks and accountable decisions.')
    expect(html).toContain('Fictional examples, not investment offers.')
  })

  it('provides a four-entry native evidence index without inventing payments, network receipts or issued positions', () => {
    const html = renderToStaticMarkup(<HomePage />)
    const allDetails = html.match(/<details\b[\s\S]*?<\/details>/g) ?? []
    expect(allDetails).toHaveLength(7)
    for (const detail of allDetails) expect(detail).not.toMatch(/^<details\b[^>]*\bopen(?:=|\s|>)/)
    expect(html).toContain('There is no transaction or finalised network receipt in this example.')
    expect(html).toContain('no real payment is displayed here')
    expect(html).toContain('No interests have been issued in this example.')
  })

  it.each(['TESTNET', 'MAINNET'] as const)('uses validated %s identity while keeping signup and sign-in destinations local', environment => {
    configureEnvironment(environment)
    const html = renderToStaticMarkup(<HomePage />)
    expect(html).toContain('href="/register"')
    expect(html).toContain('href="/login"')
    if (environment === 'TESTNET') {
      expect(html.match(/TESTNET PREVIEW/g)).toHaveLength(1)
      expect(html).toMatch(/href="\/register"[^>]*>Explore testnet/)
      expect(html).toContain('Mainnet · admission required')
    } else {
      expect(html).not.toContain('TESTNET PREVIEW')
      expect(html).toMatch(/href="https:\/\/testnet\.bx1\.co\.za\/register"[^>]*>Explore testnet/)
      expect(html).toContain('href="https://testnet.bx1.co.za/login"')
    }
  })

  it('does not manufacture a TESTNET badge, registration invitation or environment switch for invalid configuration', () => {
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za.evil.test')
    const html = renderToStaticMarkup(<HomePage />)
    expect(html).not.toContain('TESTNET PREVIEW')
    expect(html).not.toContain('href="/register"')
    expect(html).not.toContain('Explore testnet')
    expect(html).not.toContain('href="https://bx1.co.za"')
    expect(html).not.toContain('href="https://testnet.bx1.co.za/login"')
  })

  it('keeps V4 styling scoped, readable and static without changing global font or motion infrastructure', () => {
    const css = readFileSync(new URL('./homepage-v4.module.css', import.meta.url), 'utf8')
    expect(css).toContain('var(--bxo-font-ui)')
    expect(css).toContain('var(--bxo-font-reading)')
    expect(css).toContain('var(--bxo-electric-cyan)')
    expect(css).toContain('font-size: 1rem')
    expect(css).toContain('min-height: 2.75rem')
    expect(css).toContain('@media (max-width: 767px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('outline: 2px solid')
    expect(css).toMatch(/\.exampleRecords \{[^}]*scroll-margin-top: 7rem;/)
    expect(css).toMatch(/\.homeHeader :global\(\[data-bxo-nav-actions\] > a\) \{[^}]*min-height: 2\.75rem;[^}]*font-size: 1rem;/)
    expect(css).not.toContain(':root')
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/['"]use client['"]|fetch\s*\(|useEffect\s*\(|onClick=|\/api\/|\.rpc\s*\(/)
    expect(source.indexOf('heroCopy')).toBeLessThan(source.indexOf('heroArt'))
  })
})
