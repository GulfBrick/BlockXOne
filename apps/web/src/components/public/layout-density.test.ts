import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('compact shared layout without a separate testnet interface', () => {
  it('does not reserve a viewport for the marketing introduction', () => {
    const css = source('../../app/globals.css')
    const hero = css.match(/\.bxo-marketing-hero__layout \{([^}]+)\}/)?.[1]
    const visual = css.match(/\.bxo-marketing-hero__layout--visual \{([^}]+)\}/)?.[1]
    expect(hero).toContain('min-height: 0')
    expect(visual).toContain('min-height: 0')
    expect(hero).toContain('clamp(2rem, 4vw, 3rem)')
    expect(css).not.toContain('min-height: min(78dvh, 52rem)')
  })

  it('keeps public entry content near the top without removing personal-login guards', () => {
    const register = source('../../app/register/page.tsx')
    expect(register).toContain('py-8 sm:px-6 sm:py-10')
    expect(register).toContain('className="order-2 lg:order-1 lg:sticky lg:top-28"')
    expect(register).toContain('aria-labelledby="registration-title" className="order-1')
    expect(register).toContain('lg:order-2 lg:p-6')
    expect(register).not.toContain('Hosted test environment')
    expect(register).not.toContain('Mainnet environment · admission required')
    expect(register).not.toContain('{release.environment} · Personal account')
    expect(register).toContain('if (signedIn)')
    expect(register).toContain('Accounts are never merged.')
    expect(register).toContain('Do not send real investment money or upload real identity documents.')
    expect(source('../../app/login/page.tsx')).not.toContain('separate demo environment')
  })

  it('uses compact portal cards with retained readable inputs and action targets', () => {
    const css = source('../portal/portal.module.css')
    expect(css).toMatch(/\.topbar \{[^}]*min-height: 64px;[^}]*padding: 10px 24px/)
    expect(css).toContain('padding: 20px 24px 32px')
    expect(css).toMatch(/\.panelBody \{[^}]*padding: 20px/)
    expect(css).toMatch(/\.button, \.buttonSecondary, \.buttonDanger \{[^}]*min-height: 44px/)
    expect(source('../portal/onboarding-flow.module.css')).toContain('font-size: 16px')
    expect(source('../portal/onboarding-flow.module.css')).toContain('min-height: 48px')
    const dashboard = source('../portal/role-dashboard.tsx')
    expect(dashboard).not.toContain('<dt>Environment</dt>')
    expect(dashboard).toContain('data-environment={environment}')
    expect(dashboard).toContain('availablePaths.includes(step.href)')
  })
})
