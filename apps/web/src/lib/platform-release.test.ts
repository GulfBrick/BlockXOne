import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PLATFORM_VERSION, platformRelease, identityEnvironmentEnabled } from './platform-release'
const test = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
const main = { ...test, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' }
const brandedTest = { ...test, BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za' }
describe('one product version with isolated deployment identity', () => {
  it('keeps the integrated release manifest and visible platform version identical', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../PLATFORM_RELEASE.json', import.meta.url), 'utf8'))
    expect(manifest.product).toBe('BlockXOne')
    expect(manifest.version).toBe(PLATFORM_VERSION)
    expect(manifest.baseSource).toBe('713d1bf45f1c0c0ad71e25a9f8d15b0037341d6a')
    expect(manifest.environments).toEqual(['TESTNET', 'MAINNET'])
    expect(manifest.sharedEntry).toBe('/login')
    expect(manifest.sharedDashboard).toBe('/portal')
    expect(manifest.productionFinancialAdmission).toBe(false)
    expect(manifest.schemaChanges).toEqual(['20260923134152_stage2_product_eligibility', '20260923143713_stage2_customer_mandates', '20260923144216_stage2_document_receipts', '20260923161500_stage2_application_document_history', '20260923171126_stage2_entity_investment_accounts'])
    expect(manifest.mainnetMissingPrerequisites).toEqual(['Live identity-provider evidence, controlled document validation, required MFA for every admission reviewer, trusted distinct-person mappings, and real customer admission are not approved'])
    expect(manifest.contractChanges).toEqual([])
  })
  it('uses one version for both configured environments', () => {
    expect(platformRelease(test)).toEqual({ environment: 'TESTNET', version: PLATFORM_VERSION, source: 'a'.repeat(12) })
    expect(platformRelease(main)?.version).toBe(PLATFORM_VERSION)
    expect(platformRelease(main)?.environment).toBe('MAINNET')
  })
  it('admits the exact branded TEST origin with the same release identity', () => {
    expect(platformRelease(brandedTest)).toEqual({ environment: 'TESTNET', version: PLATFORM_VERSION, source: 'a'.repeat(12) })
  })
  it.each([
    'http://testnet.bx1.co.za', 'https://testnet.bx1.co.za:444',
    'https://testnet.bx1.co.za/', 'https://testnet.bx1.co.za/path',
    'https://testnet.bx1.co.za?next=1', 'https://testnet.bx1.co.za#fragment',
    'https://testnet.bx1.co.za.evil.test', 'https://evil.testnet.bx1.co.za',
    'https://testnet.bx1.co.za.', 'https://testnet.bx1.co.za@evil.test',
    'https://user@testnet.bx1.co.za', 'https://TESTNET.bx1.co.za',
  ])('rejects a branded-origin lookalike or noncanonical value %s', BLOCKXONE_APP_ORIGIN => {
    expect(platformRelease({ ...brandedTest, BLOCKXONE_APP_ORIGIN })).toBeNull()
  })
  it.each([
    { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' },
    { SUPABASE_URL: main.SUPABASE_URL }, { SUPABASE_URL: 'https://other.supabase.co' },
    { BLOCKXONE_AUTH_MODE: 'legacy' }, { NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'legacy' },
  ])('retains the branded TEST environment/backend/auth gates %j', change => {
    expect(platformRelease({ ...brandedTest, ...change })).toBeNull()
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
  it.each([test, main])('admits identity independently from legacy demo activation', env => {
    expect(identityEnvironmentEnabled({ ...env, BLOCKXONE_TESTNET_FUND_DEMO: 'disabled' })).toBe(true)
    expect(identityEnvironmentEnabled({ ...env, BLOCKXONE_TESTNET_FUND_DEMO: undefined })).toBe(true)
  })
  it.each([
    { ...main, BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za:444' },
    { ...test, BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app:444' },
    { ...test, NEXT_PUBLIC_SUPABASE_URL: main.SUPABASE_URL },
    { ...main, NEXT_PUBLIC_SUPABASE_URL: test.SUPABASE_URL },
    { ...test, BLOCKXONE_ENVIRONMENT: 'MAINNET' },
    { ...main, BLOCKXONE_ENVIRONMENT: 'TESTNET' },
    { ...test, NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: 'LOCAL_PILOT' },
    { ...main, NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: 'TESTNET' },
    { ...test, NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: '' },
  ])('rejects conflicting environment bindings %j', env => expect(identityEnvironmentEnabled(env)).toBe(false))
  it.each([[test, 'TESTNET'], [main, 'MAINNET']] as const)('accepts matching explicit bindings', (env, scope) => {
    expect(identityEnvironmentEnabled({ ...env, NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL, BLOCKXONE_ENVIRONMENT: scope, NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: scope })).toBe(true)
  })
})

