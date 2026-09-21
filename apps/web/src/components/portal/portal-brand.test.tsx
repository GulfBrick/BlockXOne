import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalShell } from './portal-shell'
import { PLATFORM_VERSION } from '@/lib/platform-release'
describe('shared approved brand and release shell', () => {
  it.each(['TESTNET', 'MAINNET'] as const)('uses the exact artwork and version in %s', environment => {
    const html = renderToStaticMarkup(<PortalShell user={{ id: 'actor', email: 'actor@example.invalid' }} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} active="overview" title="Role dashboard" onboardingAvailable={environment === 'TESTNET'} release={{ environment, version: PLATFORM_VERSION, source: 'abcdef123456' }}><p>Assigned work</p></PortalShell>)
    expect(html).toContain('blockxone-lockup-horizontal.png')
    expect(html).not.toContain('>BX</span>')
    expect(html).toContain(PLATFORM_VERSION)
    expect(html).toContain('abcdef123456')
    expect(html).toContain('action="/auth/logout"')
    if (environment === 'MAINNET') { expect(html).not.toContain('href="/portal/onboarding"'); expect(html).not.toContain('Fictional data only') }
  })
  it('uses shared brand tokens and reduced-motion handling instead of an independent palette', () => {
    const css = readFileSync(new URL('./portal.module.css', import.meta.url), 'utf8')
    expect(css).toContain('var(--bxo-carbon)')
    expect(css).toContain('var(--bxo-electric-cyan)')
    expect(css).toContain('var(--font-body)')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).not.toMatch(/#[a-f0-9]{3,8}\b/i)
  })
})
