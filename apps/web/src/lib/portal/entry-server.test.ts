import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ user: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
import { readEntry } from './entry-server'
import { entryActorId, entryApplication, entryFixture } from './entry-test-fixtures'
const client = { rpc: mocks.rpc } as unknown as SupabaseClient
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za' })) vi.stubEnv(key, value)
  mocks.user.mockResolvedValue({ id: entryActorId, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-21', is_anonymous: false })
  mocks.mfa.mockResolvedValue({}); mocks.sufficient.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: entryFixture(), error: null }) })
})
afterEach(() => vi.unstubAllEnvs())
describe('verified shared identity entry', () => {
  it('calls only the guarded entry projection and preserves pending state', async () => {
    const snapshot = await readEntry(client)
    expect(snapshot.applications[0].status).toBe('DRAFT')
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_entry_read')
    expect(mocks.current.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.rpc.mock.invocationCallOrder[0])
  })
  it('uses the same entry contract on MAINNET without a test provider gate', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    expect((await readEntry(client)).admission.manual_test_review).toBe(false)
  })
  it.each([null, { id: entryActorId, email: 'x@example.invalid' }, { id: entryActorId, email: 'x@example.invalid', email_confirmed_at: 'yes', is_anonymous: true }])('does not substitute configuration for verified identity %#', async user => {
    mocks.user.mockResolvedValue(user)
    await expect(readEntry(client)).rejects.toMatchObject({ status: 401 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('blocks missing MFA before reading data', async () => {
    mocks.sufficient.mockReturnValue(false)
    await expect(readEntry(client)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rechecks MFA after the backend wait', async () => {
    mocks.current.mockResolvedValue(false)
    await expect(readEntry(client)).rejects.toMatchObject({ status: 403 })
  })
  it('rejects a different-account application projection', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: entryFixture([entryApplication({ user_id: '55555555-5555-4555-8555-555555555555' })]), error: null }) })
    await expect(readEntry(client)).rejects.toMatchObject({ status: 503 })
  })
  it('preserves backend live-session denial when no native MFA profile exists', async () => {
    mocks.mfa.mockResolvedValue(null)
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    await expect(readEntry(client)).rejects.toMatchObject({ status: 403 })
  })
})
