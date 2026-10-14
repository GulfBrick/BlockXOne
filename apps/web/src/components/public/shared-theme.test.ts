import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tailwind from '../../../tailwind.config'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('shared BlockXOne theme contract', () => {
  it('uses semantic opacity tokens without recolouring the original brand palette', () => {
    const colors = tailwind.theme?.extend?.colors as unknown as Record<string, Record<string, string>>
    expect(colors.bxo['text-primary']).toContain('--bxo-color-text-primary-rgb')
    expect(colors.bxo['bg-primary']).toContain('--bxo-color-bg-primary-rgb')
    expect(colors.bxo.surface).toContain('--bxo-color-surface-rgb')
    expect(colors.bxo['on-accent']).toContain('--bxo-carbon-rgb')
    const tokens = source('../../styles/design-tokens.css')
    expect(tokens).toContain('--bxo-midnight: #031a28')
    expect(tokens).toContain('--bxo-frost: #eefbfc')
    expect(tokens).toContain('--bxo-electric-cyan: #2eeffa')
    expect(tokens).toContain('--bxo-color-text-primary-rgb: var(--bxo-frost-rgb)')
  })

  it('scopes the light content surface separately from the navy navigation and homepage hero', () => {
    const shell = source('./public-shell.tsx')
    expect(shell).toContain("variant === 'default' ? 'bxo-content-light'")
    expect(shell).toContain('data-bxo-page-content')
    expect(shell).not.toContain('TESTNET PREVIEW')
    const css = source('../../app/globals.css')
    expect(css).toContain('.bxo-content-light')
    expect(css).toContain('color-scheme: light')
    expect(css).toContain('--bxo-color-text-primary-rgb:')
    expect(css).toContain('--bxo-color-bg-primary-rgb:')
    expect(css).toContain('--bxo-color-info-rgb:')
  })

  it('keeps portal wallet utilities and public account utilities on the same semantic system', () => {
    const portal = source('../portal/portal.module.css')
    const light = portal.slice(portal.indexOf('.frame, .accountMenuBody'), portal.indexOf('.topbar, .hero {'))
    expect(light).toContain('--bxo-color-text-primary-rgb: var(--bxo-midnight-rgb)')
    expect(light).toContain('--bxo-color-surface-rgb:')
    const wallet = source('../workspace/metamask-wallet-link.tsx')
    expect(wallet).toContain('text-bxo-on-accent')
    expect(wallet).not.toContain('#102238')
    expect(wallet).not.toContain('#495b6d')
    const lifecycle = source('../portal/fund-lifecycle.module.css')
    expect(lifecycle).not.toContain('--fund-ink: #102238')
  })

  it('removes old dark utility styling from the historic Amoy workspace without disguising synthetic cash', () => {
    const legacy = source('../testnet-fund/testnet-fund-demo.tsx')
    expect(legacy).not.toMatch(/(?:bg|text|border)-(?:slate|cyan)-\d/)
    expect(legacy).toContain('text-bxo-text-primary')
    expect(legacy).toContain('SYNTHETIC TEST CASH')
    expect(legacy).toContain('Record synthetic funding')
    expect(legacy).toContain('Deploy fund token with MetaMask')
  })

  it('keeps constrained confirmation and expired-link documents on theme without relaxing their resource policy', () => {
    const auth = source('../../app/auth/[action]/route.ts')
    expect(auth).toContain('html{color-scheme:light}')
    expect(auth).toContain('background:#e8f7f9;color:#031a28')
    expect(auth).toContain('<header><a href="/" aria-label="BlockXOne home">')
    expect(auth).toContain("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    expect(auth).not.toContain('<script')
  })
})
