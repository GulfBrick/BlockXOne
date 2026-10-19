import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { CookieAdapter } from '@/lib/supabase/server'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), reset: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({
  ...await original<object>(),
  createRequestSupabaseClient: mocks.create,
}))
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route'

const canonical = 'https://testnet.bx1.co.za'
const email = 'person@example.test'

function request(body: BodyInit = new URLSearchParams({ email }), headers: Record<string, string> = {}, path = '/auth/recover') {
  return new NextRequest(canonical + path, {
    method: 'POST',
    headers: { origin: canonical, host: 'testnet.bx1.co.za', 'sec-fetch-site': 'same-origin',
      'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  })
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', canonical)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'TESTNET')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'TESTNET')
  mocks.create.mockReset()
  mocks.reset.mockReset().mockResolvedValue({ data: {}, error: null })
  mocks.create.mockReturnValue({ auth: { resetPasswordForEmail: mocks.reset } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

function expectRedirect(response: Response, query: string, origin = canonical) {
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(origin + '/forgot-password?' + query)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
}

describe('self-service password reset request', () => {
  it('uses only the ordinary SDK reset request and canonical confirmation consumer', async () => {
    const response = await POST(request(new URLSearchParams({ email: '  ' + email + '  ' })))
    expectRedirect(response, 'status=check-email')
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(email, { redirectTo: canonical + '/auth/confirm' })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.results[0].value).toEqual({ auth: { resetPasswordForEmail: mocks.reset } })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).not.toContain(email)
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('has the same public success for existing and nonexistent addresses without reading provider data', async () => {
    const first = await POST(request(new URLSearchParams({ email: 'existing@example.test' })))
    const dataGetter = vi.fn(() => { throw new Error('provider-data-must-not-be-read') })
    mocks.reset.mockResolvedValueOnce(Object.defineProperty({ error: null }, 'data', { get: dataGetter }))
    const second = await POST(request(new URLSearchParams({ email: 'missing@example.test' })))
    expectRedirect(first, 'status=check-email')
    expectRedirect(second, 'status=check-email')
    expect(await first.text()).toBe(await second.text())
    expect(dataGetter).not.toHaveBeenCalled()
  })

  it('uses the matching configured MAIN identity family without changing provider options or scope', async () => {
    const origin = 'https://bx1.co.za'
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin)
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'MAINNET')
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'MAINNET')
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = await POST(new NextRequest(origin + '/auth/recover', {
      method: 'POST', headers: { origin, host: 'bx1.co.za', 'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email }),
    }))
    expectRedirect(response, 'status=check-email', origin)
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith(email, { redirectTo: origin + '/auth/confirm' })
  })

  const invalidHeaders: Record<string, string>[] = [
    { origin: 'null' }, { origin: 'https://external.example' }, { host: 'external.example' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'none' },
  ]
  it.each(invalidHeaders)('rejects origin, host and FetchSite mismatch before contacting the SDK: %j', async headers => {
    const response = await POST(request(undefined, headers))
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).not.toContain(email)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  })

  it('rejects a missing Origin while retaining support for clients without FetchSite metadata', async () => {
    const noOrigin = request()
    noOrigin.headers.delete('origin')
    expect((await POST(noOrigin)).status).toBe(403)
    const noFetchSite = request()
    noFetchSite.headers.delete('sec-fetch-site')
    expectRedirect(await POST(noFetchSite), 'status=check-email')
  })

  it.each(['/auth/recover?next=https://external.example', '/auth/recover/', '/auth/recover/nested', '/auth/%72ecover'])(
    'rejects query/path aliases without a provider call: %s', async path => {
      expectRedirect(await POST(request(undefined, {}, path)), 'error=invalid-request')
      expect(mocks.create).not.toHaveBeenCalled()
    })

  it.each(['', 'not-an-email', 'person @example.test', 'person@example', 'person@example.test\r\nBcc:other@example.test'])(
    'returns actionable email validation without account lookup: %s', async value => {
      expectRedirect(await POST(request(new URLSearchParams({ email: value }))), 'error=email-invalid')
      expect(mocks.create).not.toHaveBeenCalled()
    })

  it('accepts a 254-character email and rejects one exceeding that boundary', async () => {
    const valid = 'x'.repeat(64) + '@' + 'd'.repeat(63) + '.' + 'e'.repeat(63) + '.' + 'f'.repeat(56) + '.test'
    expect(valid).toHaveLength(254)
    expectRedirect(await POST(request(new URLSearchParams({ email: valid }))), 'status=check-email')
    expect(mocks.reset).toHaveBeenCalledWith(valid, { redirectTo: canonical + '/auth/confirm' })
    mocks.create.mockClear()
    expectRedirect(await POST(request(new URLSearchParams({ email: valid + 'x' }))), 'error=email-invalid')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each(['redirectTo', 'next', 'password', 'user_id', 'role', 'operating_context', 'token_hash'])(
    'rejects extra input %s rather than passing it to Auth', async key => {
      expectRedirect(await POST(request(new URLSearchParams({ email, [key]: 'forged' }))), 'error=invalid-request')
      expect(mocks.create).not.toHaveBeenCalled()
    })

  it('rejects duplicate fields, unsupported bodies, invalid UTF-8 and oversized forms', async () => {
    const duplicate = new URLSearchParams({ email })
    duplicate.append('email', email)
    const requests = [
      request(duplicate), request(JSON.stringify({ email }), { 'content-type': 'application/json' }),
      request(new Uint8Array([255])), request('email=' + 'x'.repeat(8193)),
      request(new URLSearchParams({ email }), { 'content-length': '8193' }),
    ]
    for (const source of requests) expectRedirect(await POST(source), 'error=invalid-request')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([{ status: 429 }, { code: 'over_email_send_rate_limit' }, { code: 'over_request_rate_limit' }])(
    'preserves hosted Auth rate limiting with fixed public copy: %j', async error => {
      mocks.reset.mockResolvedValueOnce({ error })
      const response = await POST(request())
      expectRedirect(response, 'error=rate-limited')
      expect(await response.text()).not.toContain(email)
    })

  it('does not inspect or log provider messages, data or raw exception details', async () => {
    const messageGetter = vi.fn(() => { throw new Error('message-must-not-be-read') })
    const provider = Object.defineProperty({ status: 503 }, 'message', { get: messageGetter })
    mocks.reset.mockResolvedValueOnce({ error: provider })
    const response = await POST(request())
    expectRedirect(response, 'error=unavailable')
    expect(messageGetter).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain(email)
  })

  it('passes only normal SDK cookie writes through the existing secure response adapter', async () => {
    mocks.reset.mockImplementationOnce(async () => {
      const adapter = mocks.create.mock.calls[0][0] as CookieAdapter
      await adapter.setAll([{ name: 'sb-test-code-verifier', value: 'synthetic-sdk-pkce', options: { domain: 'external.example' } }], {})
      return { error: null }
    })
    const response = await POST(request())
    expectRedirect(response, 'status=check-email')
    const cookie = response.headers.get('set-cookie')
    expect(cookie).toContain('sb-test-code-verifier=synthetic-sdk-pkce')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).not.toContain('Domain')
  })

  it.each([new Error('private-sdk-exception'), undefined, { status: 429 }])(
    'handles thrown SDK outcomes without leaking staged partial cookies: %#', async error => {
      mocks.reset.mockImplementationOnce(async () => {
        const adapter = mocks.create.mock.calls[0][0] as CookieAdapter
        await adapter.setAll([{ name: 'sb-partial-verifier', value: 'synthetic-partial', options: {} }], {})
        throw error
      })
      const response = await POST(request())
      expectRedirect(response, error && 'status' in error && error.status === 429 ? 'error=rate-limited' : 'error=unavailable')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(console.error).not.toHaveBeenCalled()
    })

  it('fails closed on client initialization or mismatched/missing configuration', async () => {
    mocks.create.mockImplementationOnce(() => { throw new Error('private-client-failure') })
    expectRedirect(await POST(request()), 'error=unavailable')
    mocks.create.mockClear()
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'MAINNET')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled()
    vi.stubEnv('BLOCKXONE_AUTH_MODE', undefined)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([GET, HEAD, PUT, PATCH, DELETE, OPTIONS])('allows only POST without contacting Auth', async handler => {
    const response = handler()
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('also rejects a non-POST request passed directly to the POST handler', async () => {
    const response = await POST(new NextRequest(canonical + '/auth/recover', { method: 'GET' }))
    expect(response.status).toBe(405)
    expect(mocks.reset).not.toHaveBeenCalled()
  })
})
