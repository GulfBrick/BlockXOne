import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn() }))
vi.mock('pg', async original => ({ ...await original<object>(), Pool: class {
  on() { return this }
  query(...args: unknown[]) { return mocks.query(...args) }
} }))
import { POST } from './route'

const origin = 'https://testnet.bx1.co.za', endpoint = `${origin}/api/portal/offering-signatures/processing`
const requestId = '11111111-1111-4111-8111-111111111111', key = Buffer.alloc(32, 17)
const claim = { command: 'CLAIM', request_id: requestId }
const env = { NODE_ENV: 'production', VERCEL_ENV: 'preview', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled',
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin,
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL: 'postgresql://bx1_offering_signature_worker:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_OFFERING_SIGNATURE_WORKER_ID: 'synthetic-signatures', BLOCKXONE_OFFERING_SIGNATURE_HMAC_KEY: key.toString('base64url') }
function request(value: unknown = claim, options: { timestamp?: string; hmac?: string; suffix?: string; type?: string; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(value), timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000))
  const hmac = options.hmac ?? createHmac('sha256', key).update(`bx1-offering-signatures-worker-v1:${timestamp}:`).update(raw).digest('hex')
  return new NextRequest(`${endpoint}${options.suffix ?? ''}`, { method: 'POST', body: raw,
    headers: { 'content-type': options.type ?? 'application/json', 'x-bx1-signature-timestamp': timestamp, 'x-bx1-signature-hmac': hmac } })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'BLOCKXONE_ENVIRONMENT', 'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE']) vi.stubEnv(name, undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.query.mockResolvedValue({ rows: [{ result: null }] })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('signature processing route with real HMAC, DTO and restricted worker transport', () => {
  it('accepts a signed bounded CLAIM and returns no provider credentials or signing URL', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ action: null })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0][0]).toContain('bx1_private.claim_offering_signature_action')
    expect(mocks.query.mock.calls[0][1]).toEqual(['synthetic-signatures', requestId])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it.each([{ hmac: '0'.repeat(64) }, { timestamp: '1' }, { timestamp: String(Math.floor(Date.now() / 1000) - 301) }])(
    'rejects invalid or expired message authentication before database access', async options => {
      expect((await POST(request(claim, options))).status).toBe(403)
      expect(mocks.query).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  it.each([{ suffix: '?action=VIEW' }, { type: 'text/plain' }, { raw: '{invalid-json' }])(
    'rejects request routing, media or syntax ambiguity before database access', async options => {
      expect((await POST(request(claim, options))).status).toBe(400)
      expect(mocks.query).not.toHaveBeenCalled()
    })
  it.each([{ command: 'VIEW', request_id: requestId }, { ...claim, signing_url: 'https://demo.docusign.net/Signing/test' },
    { command: 'PROCESS', request_id: requestId, operation_id: requestId, lease_id: requestId, generation: 0 }])(
    'rejects unsupported or authority-bearing worker input', async value => {
      expect((await POST(request(value))).status).toBe(400)
      expect(mocks.query).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  it('rejects oversized raw bodies without SQL or provider HTTP even when signed', async () => {
    expect((await POST(request(claim, { raw: ' '.repeat(4097) }))).status).toBe(413)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('fails closed on malformed claimed database DTOs without echoing private fields', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ result: { operation_id: requestId, signer_email: 'private@example.invalid', access_token: 'synthetic-private' } }] })
    const response = await POST(request())
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toMatch(/private@example|synthetic-private|signing_url|access_token/)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not fall back to an owner connection or provider call when worker identity is invalid', async () => {
    vi.stubEnv('BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL', env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL.replace('bx1_offering_signature_worker', 'postgres'))
    expect((await POST(request())).status).toBe(503)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
