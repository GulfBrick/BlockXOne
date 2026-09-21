import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), invoke: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
import { POST } from '@/app/api/portal/funding/verify/route'
import { PortalError } from './server'

const origin = 'https://block-x-one-portal-test.vercel.app'
const actor = 'd22789ee-7f73-4acf-a414-3de0b62ea801'
const context = { mode: 'ROLE', organisationId: '33333333-3333-4333-8333-333333333333', role: 'Investor' }
const snapshot = { actor: { id: actor, email: 'test@example.invalid', display_name: null, can_review: false }, operating_context: context, applications: [], organisations: [], products: [], subscriptions: [], events: [] }
const instruction = { kind: 'REFERENCE', id: actor, operating_context: context }
function request(body: unknown = instruction, headers: Record<string, string> = {}, search = '') { return new NextRequest(`${origin}/api/portal/funding/verify${search}`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled'); vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockReturnValue({ functions: { invoke: mocks.invoke } })
  mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
  mocks.invoke.mockResolvedValue({ data: { ok: true, kind: 'REFERENCE', id: actor, status: 'VERIFIED' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('funding verification proxy', () => {
  it('forwards only target identity/context and caller expected identity, then rereads saved state', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.invoke).toHaveBeenCalledWith('bx1-funding-verifier', expect.objectContaining({ body: instruction, method: 'POST', headers: { 'x-bx1-expected-actor': actor }, signal: expect.any(AbortSignal) }))
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(await response.json()).toEqual({ snapshot })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it.each([{ origin: 'https://evil.invalid' }, { host: 'evil.invalid' }, { 'x-bx1-expected-actor': '' }])('rejects unauthentic request boundaries %#', async headers => {
    expect((await POST(request(instruction, headers))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects query strings, malformed content and oversized bodies before backend', async () => {
    expect((await POST(request(instruction, {}, '?kind=ROUTE'))).status).toBe(403)
    expect((await POST(request(instruction, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ padding: 'a'.repeat(9000) }))).status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([{ observation: { verified: true } }, { payer_address: '0x123' }, { rpc_url: 'https://evil.invalid' }, { amount: '1' }])('rejects browser verification facts %#', async extra => {
    expect((await POST(request({ ...instruction, ...extra }))).status).toBe(400)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it.each([undefined, null, { ...context, role: 'WealthManager' }, { ...context, actor_id: actor }])('rejects missing or invalid operating context %#', async operating_context => {
    expect((await POST(request({ ...instruction, operating_context }))).status).toBe(403)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('rejects MAINNET deployment and wrong project', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(request())).status).toBe(404)
    vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    expect((await POST(request())).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not invoke verifier after a session change or access failure', async () => {
    mocks.read.mockResolvedValueOnce({ user: { id: 'another' }, snapshot })
    expect((await POST(request())).status).toBe(403)
    mocks.read.mockRejectedValueOnce(new PortalError('Revoked', 403))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it.each([[401, 403], [403, 403], [409, 409], [422, 409], [500, 503], [429, 503]])('sanitizes Edge HTTP %s to %s', async (upstream, expected) => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'sensitive provider details', context: new Response('private response', { status: upstream }) } })
    const response = await POST(request())
    expect(response.status).toBe(expected)
    expect(await response.text()).not.toMatch(/sensitive|private response/)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('treats network failure as uncertain and never invents paid state', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('upstream secret') })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('upstream secret')
  })
  it('ignores provider-returned snapshots and reads only caller-scoped database state', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, kind: 'REFERENCE', id: actor, status: 'VERIFIED', snapshot: { actor: { id: 'other' }, paid: true } }, error: null })
    expect(await (await POST(request())).json()).toEqual({ snapshot })
  })
  it.each([null, {}, { error: 'TRANSACTION_NOT_FINALIZED' }, { ok: true, kind: 'ROUTE', id: actor, status: 'VERIFIED' }, { ok: true, kind: 'REFERENCE', id: actor, status: 'PENDING' }])('does not confuse pending HTTP success with verified evidence %#', async data => {
    mocks.invoke.mockResolvedValue({ data, error: null })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('does not deliver an after-verification result to a changed actor/context', async () => {
    mocks.read.mockResolvedValueOnce({ user: { id: actor }, snapshot }).mockResolvedValueOnce({ user: { id: actor }, snapshot: { ...snapshot, operating_context: { ...context, role: 'SuperAdmin' } } })
    expect((await POST(request())).status).toBe(403)
  })
})
