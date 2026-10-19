import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: async () => ({}) }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: async () => ({}), hasRequiredMfa: () => true, toMfaView: () => ({ state: 'verified', factors: [], hasPendingTotp: false }) }))
import MfaPage from './page'
afterEach(() => vi.unstubAllEnvs())
describe('already verified MFA uses the shared role dashboard', () => {
  it.each(['TESTNET', 'MAINNET'])('keeps setup separate and sends the %s workspace continuation to /portal', async environment => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
    vi.stubEnv('VERCEL_ENV', environment === 'TESTNET' ? 'preview' : 'production')
    vi.stubEnv('SUPABASE_URL', environment === 'TESTNET' ? 'https://fegnnnlseuejkrusbbkv.supabase.co' : 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', environment === 'TESTNET' ? 'https://block-x-one-test.vercel.app' : 'https://bx1.co.za')
    await expect(MfaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/portal')
    await expect(MfaPage({ searchParams: Promise.resolve({ continue: 'setup' }) })).rejects.toThrow('REDIRECT:/login?setup=1')
  })
})
