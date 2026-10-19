import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({ environment: 'TESTNET', create: vi.fn(), user: vi.fn(), lifecycle: vi.fn(), handle: vi.fn() }))
vi.mock('@/lib/supabase/server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/server')>(),
  createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user,
}))
vi.mock('@/lib/portal/fund-lifecycle-server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/portal/fund-lifecycle-server')>(),
  fundLifecycleEnvironment: () => mocks.environment, readFundLifecycle: mocks.lifecycle,
}))
vi.mock('@/lib/portal/fund-authority-alignment-server', () => ({ handleFundAuthorityAlignment: mocks.handle }))

import { POST } from './route'

const origin = 'https://block-x-one-portal-test.vercel.app'
const actor = '00000000-0000-4000-8000-000000000001', setupId = '00000000-0000-4000-8000-000000000005'
const context = { mode: 'ROLE' as const, organisationId: '00000000-0000-4000-8000-000000000002', role: 'TokenisationAgent' as const }
const read = { action: 'READ', setup_id: setupId, setup_revision: 100, operating_context: context }
function request(body: unknown = read, suffix = '', headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/portal/fund-lifecycle/authority-alignment${suffix}`, {
    method: 'POST', body: JSON.stringify(body), headers: {
      origin, host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers,
    },
  })
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.environment = 'TESTNET'
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled'); vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  const client = { rpc: vi.fn() }; mocks.create.mockReturnValue(client)
  mocks.user.mockResolvedValue({ id: actor, email_confirmed_at: '2026-10-19T00:00:00Z', is_anonymous: false })
  mocks.lifecycle.mockResolvedValue({ availability: 'AVAILABLE' })
  mocks.handle.mockResolvedValue({ exact: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('exact fund authority alignment API route', () => {
  it('admits the exact read-only action through the authenticated no-store boundary', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({ exact: true })
    expect(mocks.handle).toHaveBeenCalledWith(expect.anything(), actor, read)
    expect(mocks.lifecycle).toHaveBeenCalledWith(expect.anything(), actor, context)
  })

  it('keeps MAIN closed before client creation or authority handling', async () => {
    mocks.environment = 'MAINNET'
    const response = await POST(request())
    expect(response.status).toBe(409); expect(await response.text()).toContain('not admitted in MAIN')
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.handle).not.toHaveBeenCalled()
  })

  it.each([
    [{ ...read, action: 'read' }, ''],
    [{ ...read, action: 'RETRY', request_key: '00000000-0000-4000-8000-000000000099' }, ''],
    [{ ...read, admission_request_id: '00000000-0000-4000-8000-000000000040' }, ''],
    [read, '?action=READ'],
  ] as const)('rejects an action, body or query alias without invoking the alignment handler', async (body, suffix) => {
    const response = await POST(request(body, suffix))
    expect([400, 403]).toContain(response.status)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('rejects a foreign origin and changed authenticated actor before authority handling', async () => {
    expect((await POST(request(read, '', { origin: 'https://evil.invalid' }))).status).toBe(403)
    mocks.user.mockResolvedValueOnce({ id: '00000000-0000-4000-8000-000000000099', email_confirmed_at: '2026-10-19T00:00:00Z', is_anonymous: false })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.handle).not.toHaveBeenCalled()
  })
})
