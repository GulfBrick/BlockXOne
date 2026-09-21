import { describe, expect, it } from 'vitest'
import { PLATFORM_VERSION, platformRelease } from './platform-release'
const test = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-test.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) }
const main = { ...test, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za' }
describe('one product version with isolated deployment identity', () => {
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
