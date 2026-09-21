import { describe, expect, it } from 'vitest'
import { PLATFORM_VERSION, platformRelease } from './platform-release'
const test = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
const main = { ...test, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' }
const brandedTest = { ...test, BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za' }
describe('one product version with isolated deployment identity', () => {
  it('uses one version for both configured environments', () => {
    expect(platformRelease(test)).toEqual({ environment: 'TESTNET', version: PLATFORM_VERSION, source: 'a'.repeat(12) })
    expect(platformRelease(main)?.version).toBe(PLATFORM_VERSION)
    expect(platformRelease(main)?.environment).toBe('MAINNET')
  })
  it('admits the exact branded TEST origin with the same release identity', () => {
    expect(platformRelease(brandedTest)).toEqual({ environment: 'TESTNET', version: '1.1.0-rc.7', source: 'a'.repeat(12) })
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
})
