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
    expect(html).toContain(environment === 'TESTNET' ? 'Testnet · Test environment' : 'Mainnet · Live environment')
    expect(html).not.toContain('Rehearsal environment')
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
  it('keeps V3 light aliases inside the editable applicant frame and navy around the real artwork', () => {
    const css = readFileSync(new URL('./portal.module.css', import.meta.url), 'utf8')
    const lightFrame = css.match(/\.applicantOnboarding \.frame \{([\s\S]*?)\n\}/)?.[1]
    expect(lightFrame).toContain('--bxo-surface: var(--bxo-frost)')
    expect(lightFrame).toContain('--bxo-text-primary: var(--bxo-midnight)')
    expect(lightFrame).toContain('--bxo-text-secondary: var(--bxo-deep-teal)')
    expect(lightFrame).toContain('--bxo-border-default: color-mix(in srgb, var(--bxo-steel) 75%, var(--bxo-midnight))')
    expect(lightFrame).toContain('--portal-link: var(--bxo-structural-blue)')
    expect(lightFrame).toContain('color-scheme: light')
    expect(css).not.toContain('--bxo-electric-cyan:')
    expect(css.replace(/\.applicantOnboarding \.frame \{[\s\S]*?\n\}/, '')).not.toContain('--bxo-surface:')
    expect(css).toMatch(/\.applicantOnboarding \.topbar \{[^}]*background: var\(--bxo-midnight\)/)
    expect(css).toMatch(/\.applicantOnboarding \.frame :is\([^}]*outline: 3px solid var\(--portal-link\)/)
    expect(css).toContain('.applicantOnboarding .frame .button { border-color: var(--portal-link); }')
  })
  it('labels personal applications explicitly without carrying staff authority into that destination', () => {
    const organisationId = '11111111-1111-4111-8111-111111111111'
    const html = renderToStaticMarkup(<PortalShell user={{ id: 'actor', email: 'actor@example.invalid' }} organisationName="Assigned organisation" operatingContext={{ mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }} capabilities={{ manageProducts: false, reviewCompliance: true, invest: false }} active="overview" title="Assigned review queue"><p>Assigned work</p></PortalShell>)
    expect(html).toContain('My applications')
    expect(html).toContain('href="/portal/onboarding?mode=applicant"')
    expect(html).not.toContain(`/portal/onboarding?organisation=${organisationId}`)
    expect(html).toContain(`/portal/compliance?organisation=${organisationId}&amp;role=ComplianceOfficer`)
    expect(html).toContain('Current workspace: Compliance Officer')
    expect(html).toContain('Switch application or workspace')
    expect(html).not.toContain('role=SuperAdmin')
  })
  it.each(['TESTNET', 'MAINNET'] as const)('uses one compact applicant header with the approved brand in %s', environment => {
    const html = renderToStaticMarkup(<PortalShell user={{ id: 'actor', email: 'actor@example.invalid' }} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} active="onboarding" title="Apply for an organisation workspace." capacityName="Wealth-manager application" operatingContext={{ mode: 'APPLICANT' }} applicantOnboarding release={{ environment, version: PLATFORM_VERSION, source: 'abcdef123456' }}><p>Application fields</p></PortalShell>)
    expect(html).toContain('data-applicant-onboarding="true"')
    expect(html).toContain('blockxone-lockup-horizontal.png')
    expect(html).not.toContain('>BX</span>')
    expect(html.match(/aria-label="Switch application or workspace"/g)).toHaveLength(1)
    const switcher = (html.match(/<a\b[^>]*>/g) ?? []).find(anchor => anchor.includes('aria-label="Switch application or workspace"'))
    expect(switcher).toContain('href="/portal?mode=applicant"')
    expect(html).toContain('Current workspace: Wealth-manager application')
    expect(html).not.toContain('Navigate your workspace')
    const account = html.match(/<details\b[^>]*><summary>Account<\/summary>[\s\S]*?<\/details>/g) ?? []
    expect(account).toHaveLength(1)
    expect(account[0]).not.toMatch(/^<details\b[^>]*\bopen(?:=|\s|>)/)
    expect(account[0]).toContain('actor@example.invalid')
    expect(account[0]).toContain('href="/workspace/security"')
    expect(account[0]).toContain('href="/workspace"')
    expect(account[0]).toContain('href="/register"')
    expect(account[0]).toMatch(/<form action="\/auth\/logout" method="post">/)
    expect(account[0]).toMatch(/<button\b[^>]*type="submit"[^>]*>Sign out<\/button>/)
    const releaseDetails = html.match(/<details\b[^>]*><summary>Environment and release details<\/summary>[\s\S]*?<\/details>/g) ?? []
    expect(releaseDetails).toHaveLength(1)
    expect(releaseDetails[0]).not.toMatch(/^<details\b[^>]*\bopen(?:=|\s|>)/)
    expect(releaseDetails[0]).toContain(PLATFORM_VERSION)
    expect(releaseDetails[0]).toContain('abcdef123456')
    const releaseDetail = releaseDetails[0]
    if (!releaseDetail) throw new Error('Expected one closed environment and release details panel.')
    const normalFlow = html.replace(releaseDetail, '')
    expect(normalFlow).not.toContain(PLATFORM_VERSION)
    expect(normalFlow).not.toContain('abcdef123456')
    expect(normalFlow.match(/role="note"/g)).toHaveLength(1)
    expect(normalFlow).toContain(environment === 'TESTNET' ? 'TEST environment' : 'MAIN environment')
    expect(normalFlow).toContain(environment === 'TESTNET' ? 'Fictional data only.' : 'Approved admission is required.')
    if (environment === 'MAINNET') expect(html).not.toContain('Fictional data only')
    expect(html).not.toContain('href="/portal/products')
    expect(html).not.toContain('href="/portal/compliance')
  })
  it('does not apply applicant presentation to a role workspace or a non-onboarding screen', () => {
    const organisationId = '11111111-1111-4111-8111-111111111111'
    const role = renderToStaticMarkup(<PortalShell user={{ id: 'actor', email: 'actor@example.invalid' }} capabilities={{ manageProducts: false, reviewCompliance: true, invest: false }} active="onboarding" title="Assigned review queue" operatingContext={{ mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }} applicantOnboarding><p>Assigned work</p></PortalShell>)
    const overview = renderToStaticMarkup(<PortalShell user={{ id: 'actor', email: 'actor@example.invalid' }} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} active="overview" title="Applications" operatingContext={{ mode: 'APPLICANT' }} applicantOnboarding><p>Choose a workspace</p></PortalShell>)
    for (const html of [role, overview]) {
      expect(html).not.toContain('data-applicant-onboarding="true"')
      expect(html).not.toContain('<summary>Account</summary>')
      expect(html).toContain('Navigate your workspace')
      expect(html).toContain('aria-label="Breadcrumb"')
    }
    expect(role).toContain(`/portal/compliance?organisation=${organisationId}&amp;role=ComplianceOfficer`)
    expect(role).not.toContain('role=SuperAdmin')
  })
})
