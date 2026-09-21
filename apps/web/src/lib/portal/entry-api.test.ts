import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), guard: vi.fn(), create: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.read, requireEntryEnvironment: mocks.guard }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
import { GET, POST } from '@/app/api/portal/entry/route'
import { PortalError } from './server'
import { entryActorId, entryFixture } from './entry-test-fixtures'
const origin = 'https://testnet.bx1.co.za'
const instruction = { command: 'start_application', key: '44444444-4444-4444-8444-444444444444', payload: { persona: 'WEALTH_MANAGER' } }
const unsafeHeaders: Record<string, string>[] = [{ origin: 'null' }, { origin: 'https://evil.invalid' }, { 'x-bx1-expected-actor': '' }, { 'x-bx1-expected-actor': '55555555-5555-4555-8555-555555555555' }]
function request(body: unknown = instruction, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/portal/entry`, { method: 'POST', headers: { origin, host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-bx1-expected-actor': entryActorId, ...headers }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('NODE_ENV', 'production')
  mocks.read.mockResolvedValue(entryFixture()); mocks.create.mockReturnValue({ rpc: mocks.rpc })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: entryFixture(), error: null }) })
})
afterEach(() => vi.unstubAllEnvs())
describe('canonical entry command boundary', () => {
  it('reads current caller state with private caching', async () => {
    const response = await GET(new NextRequest(`${origin}/api/portal/entry`))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('dispatches only the guarded exact command then revalidates identity', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_entry_command', { command: 'start_application', request_key: instruction.key, payload: instruction.payload })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it.each(unsafeHeaders)('rejects unsafe origin or changed actor %#', async headers => {
    expect((await POST(request(instruction, headers))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects role grants or caller-supplied user ids', async () => {
    for (const payload of [{ ...instruction.payload, role: 'SuperAdmin' }, { ...instruction.payload, user_id: entryActorId }]) expect((await POST(request({ ...instruction, payload }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('reports unadmitted review routes as a definite actionable rejection', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '55000' } }) })
    const response = await POST(request())
    expect(response.status).toBe(409); expect((await response.json()).error).toContain('draft is preserved')
  })
  it('preserves uncertain outcome after a post-command MFA or session failure', async () => {
    mocks.read.mockResolvedValueOnce(entryFixture()).mockRejectedValueOnce(new PortalError('MFA changed', 403))
    const response = await POST(request())
    expect(response.status).toBe(503); expect((await response.json()).error).toContain('original request reference')
  })
  it('does not report another actor result as saved', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...entryFixture(), actor: { id: '55555555-5555-4555-8555-555555555555', email: 'other@example.invalid' } }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
})
