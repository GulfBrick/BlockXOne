import { describe, expect, it } from 'vitest'
import { DEMO_PROJECT, TESTNET_APP_ORIGIN, demoMoney, isDemoEnvironment } from './contracts'

const enabled = { BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: `https://${DEMO_PROJECT}.supabase.co`, VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://block-x-one-fund-demo.vercel.app' }
const branded = { ...enabled, BLOCKXONE_APP_ORIGIN: TESTNET_APP_ORIGIN }
describe('isolated fund demo admission', () => {
  it('admits only explicitly enabled isolated TEST preview', () => expect(isDemoEnvironment(enabled)).toBe(true))
  for (const key of Object.keys(enabled)) it(`fails closed without ${key}`, () => expect(isDemoEnvironment({ ...enabled, [key]: undefined })).toBe(false))
  it.each(['production', 'development', ''])('rejects deployment environment %s', value => expect(isDemoEnvironment({ ...enabled, VERCEL_ENV: value })).toBe(false))
  it.each(['https://bx1.co.za', 'https://block-x-one.vercel.app', 'http://localhost:3000', 'https://block-x-one-fund-demo.vercel.app/path', 'https://block-x-one-fund-demo.vercel.app.evil.test'])('rejects origin %s', value => expect(isDemoEnvironment({ ...enabled, BLOCKXONE_APP_ORIGIN: value })).toBe(false))
  it('rejects production Supabase even with flags enabled', () => expect(isDemoEnvironment({ ...enabled, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co' })).toBe(false))
  it('admits the exact branded TEST origin without weakening the existing gates', () => expect(isDemoEnvironment(branded)).toBe(true))
  for (const key of Object.keys(branded)) it(`fails closed on branded TEST without ${key}`, () => expect(isDemoEnvironment({ ...branded, [key]: undefined })).toBe(false))
  it.each([
    'http://testnet.bx1.co.za', 'https://testnet.bx1.co.za:444',
    'https://testnet.bx1.co.za/', 'https://testnet.bx1.co.za/path',
    'https://testnet.bx1.co.za?next=1', 'https://testnet.bx1.co.za#fragment',
    'https://testnet.bx1.co.za.evil.test', 'https://evil.testnet.bx1.co.za',
    'https://testnet.bx1.co.za.', 'https://testnet.bx1.co.za@evil.test',
    'https://user@testnet.bx1.co.za', 'https://TESTNET.bx1.co.za',
  ])('rejects noncanonical branded origin %s', BLOCKXONE_APP_ORIGIN => expect(isDemoEnvironment({ ...branded, BLOCKXONE_APP_ORIGIN })).toBe(false))
  it.each([
    { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' },
    { SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co' },
    { SUPABASE_URL: 'https://other.supabase.co' }, { BLOCKXONE_TESTNET_FUND_DEMO: 'disabled' },
    { BLOCKXONE_AUTH_MODE: 'legacy' }, { NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'legacy' },
  ])('retains every branded TEST deployment/enablement gate %j', change => expect(isDemoEnvironment({ ...branded, ...change })).toBe(false))
})
describe('synthetic cash formatting', () => {
  it('never converts financial amounts to floating point', () => expect(demoMoney('900719925474099199')).toBe('9007199254740991.99 ZAR_TEST'))
  it('includes cents and the synthetic unit', () => expect(demoMoney('1')).toBe('0.01 ZAR_TEST'))
  it.each(['1.2', '-1', 'NaN', ''])('rejects %s', value => expect(demoMoney(value)).toBe('Unavailable'))
})
