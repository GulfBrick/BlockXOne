import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ sdk: vi.fn(), cookies: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.sdk }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
import { updateSupabaseSession } from './middleware'
import { createPageSupabaseClient } from './page'
import { readVerifiedUser } from './server'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test-only')
  vi.stubEnv('NODE_ENV', 'production')
})

describe('cookie-writable session refresh boundary', () => {
  it('persists every SDK cookie batch to the downstream request AND exact returned response', async () => {
    mocks.sdk.mockImplementation((_url, _key, options) => ({ auth: { getUser: async () => {
      await options.cookies.setAll([{ name: 'sb-test.0', value: 'new-0', options: { httpOnly: false, domain: '.bx1.co.za' } }, { name: 'sb-test.2', value: '', options: { maxAge: 0 } }], { 'Cache-Control': 'private, no-store', 'X-Refresh-Test': 'one' })
      await options.cookies.setAll([{ name: 'sb-test.1', value: 'new-1', options: {} }], {})
      return { data: { user: { id: 'u1', email: 'test@example.test' } }, error: null }
    } } }))
    const request = new NextRequest('https://bx1.co.za/workspace', { headers: { cookie: 'sb-test.0=old' } })
    const response = await updateSupabaseSession(request)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(request.cookies.get('sb-test.0')?.value).toBe('new-0')
    expect(request.cookies.get('sb-test.1')?.value).toBe('new-1')
    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-test.0=new-0')
    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-test.1=new-1')
    expect(response.cookies.get('sb-test.0')).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(response.cookies.get('sb-test.0')).not.toHaveProperty('domain')
    expect(response.cookies.get('sb-test.1')?.value).toBe('new-1')
    expect(response.cookies.get('sb-test.2')?.maxAge).toBe(0)
    expect(response.headers.get('x-refresh-test')).toBe('one')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it('provider failure returns unavailable rather than dispatching protected content', async () => {
    mocks.sdk.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null }, error: { status: 503, message: 'private-detail' } }) } })
    const response = await updateSupabaseSession(new NextRequest('https://bx1.co.za/workspace'))
    expect(response.status).toBe(503)
    expect(response.headers.get('x-middleware-next')).toBeNull()
    expect(await response.text()).not.toContain('private-detail')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('missing/invalid identity may reach the authoritative page, not become authenticated', async () => {
    mocks.sdk.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null }, error: { status: 401 } }) } })
    const response = await updateSupabaseSession(new NextRequest('https://bx1.co.za/login'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.cookies.getAll()).toHaveLength(0)
  })
  it('read-only Server Component adapters fail closed if another cookie write is needed', async () => {
    mocks.cookies.mockResolvedValue({ getAll: () => [{ name: 'sb-test', value: 'synthetic' }] })
    mocks.sdk.mockImplementation((_url, _key, options) => ({ auth: { getUser: async () => {
      await options.cookies.setAll([{ name: 'sb-test', value: 'replacement', options: {} }], {})
      return { data: { user: { id: 'u1', email: 'test@example.test' } }, error: null }
    } } }))
    await expect(readVerifiedUser(await createPageSupabaseClient())).rejects.toThrow('Access is temporarily unavailable.')
  })
})
