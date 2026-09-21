import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PLATFORM_VERSION, platformRelease } from './platform-release'
const test = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
const main = { ...test, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' }
describe('one product version with isolated deployment identity', () => {
  it('keeps the checked-in release manifest and visible platform version identical', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../PLATFORM_RELEASE.json', import.meta.url), 'utf8'))
    expect(manifest.product).toBe('BlockXOne')
    expect(manifest.version).toBe(PLATFORM_VERSION)
    expect(manifest.baseSource).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.environments).toEqual(['TESTNET', 'MAINNET'])
    expect(manifest.sharedEntry).toBe('/login')
    expect(manifest.sharedDashboard).toBe('/portal')
    expect(manifest.productionFinancialAdmission).toBe(false)
    expect(manifest.schemaChanges).toContain('supabase/features/bx1_portal_funding.sql')
    expect(manifest.contractChanges).toEqual([])
  })
  it('uses one version for both configured environments', () => {
    expect(platformRelease(test)).toEqual({ environment: 'TESTNET', version: PLATFORM_VERSION, source: 'a'.repeat(12) })
    expect(platformRelease(main)?.version).toBe(PLATFORM_VERSION)
    expect(platformRelease(main)?.environment).toBe('MAINNET')
  })
  it.each([
    {}, { ...test, VERCEL_ENV: 'production' }, { ...main, VERCEL_ENV: 'preview' },
    { ...test, SUPABASE_URL: main.SUPABASE_URL }, { ...main, SUPABASE_URL: test.SUPABASE_URL },
    { ...main, BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za.evil.test' },
    { ...test, BLOCKXONE_APP_ORIGIN: 'http://block-x-one-test.vercel.app' },
    { ...test, BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app/path' },
    { ...test, NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'legacy' },
  ])('does not invent a local or production fallback for configuration %j', env => expect(platformRelease(env)).toBeNull())
  it('never renders arbitrary source metadata', () => expect(platformRelease({ ...main, VERCEL_GIT_COMMIT_SHA: 'secret-or-html' })?.source).toBe('source unavailable'))
})
