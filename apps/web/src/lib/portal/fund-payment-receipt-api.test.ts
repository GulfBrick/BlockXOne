import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), lifecycle: vi.fn(), resolve: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user }))
vi.mock('./fund-lifecycle-server', async original => ({ ...await original<object>(), readFundLifecycle: mocks.lifecycle }))
vi.mock('./fund-payment-receipt', () => ({ resolveFundPaymentReceipt: mocks.resolve }))
import { POST } from '@/app/api/portal/fund-lifecycle/payment/receipt/route'
import { FundLifecycleError } from './fund-lifecycle-server'

const origin = 'https://testnet.bx1.co.za', actor = '00000000-0000-4000-8000-000000000005'
const instruction = { subscription_id: '00000000-0000-4000-8000-000000000002', operating_context: { mode: 'APPLICANT' } }
const client = { rpc: vi.fn() }, result = { prefill: { payment_id: '00000000-0000-4000-8000-000000000001', status: 'READY_FOR_PAYER_CLAIM' } }
function request(body: unknown = instruction, headers: Record<string, string> = {}, search = '') {
  return new NextRequest(`${origin}/api/portal/fund-lifecycle/payment/receipt${search}`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'TESTNET'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'TESTNET')
  mocks.create.mockReturnValue(client)
  mocks.user.mockResolvedValue({ id: actor, email_confirmed_at: '2026-10-14T10:00:00Z', is_anonymous: false })
  mocks.lifecycle.mockResolvedValue({ availability: 'AVAILABLE' })
  mocks.resolve.mockResolvedValue(result)
})
afterEach(() => vi.unstubAllEnvs())

describe('saved-order receipt discovery through the existing authenticated fund API', () => {
  it('passes only the saved order/context and server-verified actor to read-only discovery', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(mocks.lifecycle).toHaveBeenCalledWith(client, actor, instruction.operating_context)
    expect(mocks.resolve).toHaveBeenCalledWith(client, actor, instruction)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it.each<Record<string, string>>([{ origin: 'https://evil.invalid' }, { host: 'evil.invalid' },
    { 'x-bx1-expected-actor': '' }, { 'x-bx1-expected-actor': 'not-an-actor' }])('rejects unauthenticated request boundaries before discovery %#', async headers => {
    expect((await POST(request(instruction, headers))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('rejects query parameters, non-JSON and oversized requests before Supabase', async () => {
    expect((await POST(request(instruction, {}, '?transaction_hash=0x00'))).status).toBe(403)
    expect((await POST(request(instruction, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ ...instruction, padding: 'x'.repeat(65537) }))).status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([{ transaction_hash: `0x${'aa'.repeat(32)}` }, { log_index: 4 }, { amount_base_units: '1000000000' },
    { rpc_url: 'https://evil.invalid' }, { payment_id: actor }, { verified: true }, { payer_address: `0x${'11'.repeat(20)}` }])('cannot inject client payment/receipt facts %#', async extra => {
    expect((await POST(request({ ...instruction, ...extra }))).status).toBe(400)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it.each([null, { mode: 'APPLICANT', role: 'Investor' }, { mode: 'ROLE', organisationId: actor, role: 'WealthManager' }])('requires explicit valid context %#', async context => {
    expect((await POST(request({ ...instruction, operating_context: context }))).status).toBe(400)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it.each([null, { id: actor, email_confirmed_at: null }, { id: actor, email_confirmed_at: 'confirmed', is_anonymous: true },
    { id: '00000000-0000-4000-8000-000000000099', email_confirmed_at: 'confirmed' }])('denies missing confirmation, anonymous or changed actors %#', async user => {
    mocks.user.mockResolvedValueOnce(user)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('requires the existing current lifecycle/context and propagates revocation without observing a receipt', async () => {
    mocks.lifecycle.mockResolvedValueOnce({ availability: 'UNAVAILABLE' })
    expect((await POST(request())).status).toBe(409)
    mocks.lifecycle.mockRejectedValueOnce(new FundLifecycleError('AUTHORITY_CHANGED', 'Refresh your current workspace.', 403))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('cannot use TEST receipt discovery in valid MAIN or a mismatched release', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'MAINNET'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'MAINNET')
    expect((await POST(request())).status).toBe(409)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('retains uncertain failures as a bounded error, never a funded or claim-signed result', async () => {
    mocks.resolve.mockRejectedValueOnce(new FundLifecycleError('PAYMENT_PROVIDERS_DISAGREE', 'Independent receipt checks are unavailable. Do not pay again.', 503))
    const response = await POST(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).not.toHaveProperty('prefill')
    expect(body).not.toHaveProperty('funded')
    expect(body).not.toHaveProperty('signature')
    expect(body.error).toContain('Do not pay again')
  })
})
