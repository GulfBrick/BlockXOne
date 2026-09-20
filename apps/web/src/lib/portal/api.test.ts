import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
import { POST } from '@/app/api/portal/command/route'
import { readPortalBody } from './http'
const origin = 'https://block-x-one-portal-test.vercel.app'
const actor = 'd22789ee-7f73-4acf-a414-3de0b62ea801'
const snapshot = { actor: { id: actor, email: 'test@example.test', display_name: null, can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [] }
const command = { command: 'cancel_subscription', key: '113800c3-cf6e-437e-abdf-a3b09a03fcff', payload: { subscription_id: actor } }
const forgedHeaders: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }]
function request(body: unknown = command, headers: Record<string, string> = {}) { return new NextRequest(`${origin}/api/portal/command`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled'); vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockReturnValue({ rpc: mocks.rpc })
  mocks.read.mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot, error: null }) })
})
afterEach(() => vi.unstubAllEnvs())
describe('portal command endpoint', () => {
  it('forwards exact validated request key and private saved snapshot', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot })
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_command', { command: command.command, request_key: command.key, payload: command.payload })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it.each(forgedHeaders)('rejects forged headers before backend %#', async headers => {
    expect((await POST(request(command, headers))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('blocks production and wrong backend before access', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(request())).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects client-supplied identity and malformed body', async () => {
    expect((await POST(request({ ...command, payload: { ...command.payload, actor_id: actor } }))).status).toBe(400)
    expect((await POST(request(command, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ padding: 'x'.repeat(66000) }))).status).toBe(413)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([['42501', 403], ['23514', 409], ['40001', 409], ['57014', 503]])('classifies %s without exposing database details', async (code, status) => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ error: { code, message: 'private internal data' }, data: null }) })
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('private internal data')
  })
  it('does not accept a snapshot for a different actor', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot, actor: { ...snapshot.actor, id: 'other' } }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it('limits actual bytes despite a small claimed length', async () => {
    await expect(readPortalBody(request({ padding: 'x'.repeat(100) }, { 'content-length': '1' }), 20)).rejects.toMatchObject({ status: 413 })
  })
})
