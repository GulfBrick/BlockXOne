import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), workspace: vi.fn() }))
vi.mock('@/lib/supabase/server', async (importOriginal) => ({
  ...await importOriginal<object>(), createRequestSupabaseClient: mocks.create,
  readVerifiedUser: mocks.user, readWorkspace: mocks.workspace,
}))
import { GET, POST, PUT } from './[action]/route'
import { PENDING_INVITE_COOKIE } from '@/lib/supabase/http'

const canonical = 'https://bx1.co.za'
const workspace = { user: { id: 'u1', email: 'person@example.test', platformUserId: 'p1', displayName: null }, organisations: [{ id: 'o1', name: 'Internal', roles: ['SuperAdmin'] }] }
let auth: Record<string, ReturnType<typeof vi.fn>>
function context(action: string) { return { params: Promise.resolve({ action }) } }
function request(action: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return new NextRequest(`${canonical}/auth/${action}`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) })
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', canonical)
  auth = { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }), verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn().mockResolvedValue({ error: null }) }
  mocks.create.mockReturnValue({ auth })
  mocks.user.mockResolvedValue({ id: 'u1', email: 'person@example.test' })
  mocks.workspace.mockResolvedValue(workspace)
})

describe('method, mode, origin and body admission', () => {
  it.each(['login', 'setup', 'logout', 'confirm'])('rejects forged Origin for %s before Auth', async (action) => {
    const response = await POST(request(action, {}, { origin: 'https://evil.test' }), context(action))
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it.each(['', 'null', 'https://bx1.co.za.evil.test'])('rejects missing or misleading Origin %s', async (origin) => {
    expect((await POST(request('login', {}, { origin }), context('login'))).status).toBe(403)
  })
  it('rejects forged Host even with a canonical Origin and URL', async () => {
    expect((await POST(request('login', {}, { host: 'evil.test' }), context('login'))).status).toBe(403)
  })
  it('rejects forged request origin regardless of forwarded host', async () => {
    const req = new NextRequest('https://evil.test/auth/login', { method: 'POST', headers: { origin: canonical, 'x-forwarded-host': 'bx1.co.za' } })
    expect((await POST(req, context('login'))).status).toBe(403)
  })
  it('rejects non-form, oversized and duplicate fields', async () => {
    expect((await POST(request('login', {}, { 'content-type': 'application/json' }), context('login'))).status).toBe(400)
    expect((await POST(request('login', { password: 'x'.repeat(9000) }), context('login'))).status).toBe(400)
    const req = new NextRequest(`${canonical}/auth/login`, { method: 'POST', headers: { origin: canonical, 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&email=b' })
    expect((await POST(req, context('login'))).status).toBe(400)
  })
  it('denies unknown actions, wrong methods and invalid paired flags', async () => {
    expect((await POST(request('register'), context('register'))).status).toBe(404)
    expect((await GET(new NextRequest(`${canonical}/auth/logout`), context('logout'))).status).toBe(405)
    expect((await PUT(new NextRequest(`${canonical}/auth/login`, { method: 'PUT' }), context('login'))).status).toBe(405)
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    expect((await POST(request('login'), context('login'))).status).toBe(503)
    vi.stubEnv('BLOCKXONE_AUTH_MODE', '')
    expect((await POST(request('login'), context('login'))).status).toBe(404)
  })
})

describe('scanner-safe invite', () => {
  const hash = 'a'.repeat(64)
  it('GET stores a protected pending token, removes it from URL, and never verifies', async () => {
    const response = await GET(new NextRequest(`${canonical}/auth/confirm?token_hash=${hash}&type=invite`), context('confirm'))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${canonical}/auth/confirm`)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    const pending = response.cookies.get(PENDING_INVITE_COOKIE)!
    expect(pending).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    expect(pending).not.toHaveProperty('domain')
    const clean = await GET(new NextRequest(`${canonical}/auth/confirm`, { headers: { cookie: `${PENDING_INVITE_COOKIE}=${pending.value}` } }), context('confirm'))
    const html = await clean.text()
    expect(html).toContain('method="post"')
    expect(html).not.toContain(hash)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
  it('only same-origin POST consumes the pending invite, clears it, and redirects to setup', async () => {
    const pending = encodeURIComponent(JSON.stringify({ tokenHash: hash, type: 'invite', expiresAt: Date.now() + 600000 }))
    const response = await POST(request('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${pending}` }), context('confirm'))
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: hash, type: 'invite' })
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1`)
  })
  it('denies unsupported types, missing/expired pending links and provider failures', async () => {
    expect((await GET(new NextRequest(`${canonical}/auth/confirm?token_hash=${hash}&type=signup`), context('confirm'))).status).toBe(400)
    expect((await POST(request('confirm'), context('confirm'))).status).toBe(400)
    const pending = encodeURIComponent(JSON.stringify({ tokenHash: hash, type: 'invite', expiresAt: Date.now() - 1 }))
    expect((await POST(request('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${pending}` }), context('confirm'))).status).toBe(400)
    auth.verifyOtp.mockResolvedValue({ error: { message: 'must-not-leak', status: 403 } })
    const valid = encodeURIComponent(JSON.stringify({ tokenHash: hash, type: 'recovery', expiresAt: Date.now() + 600000 }))
    const response = await POST(request('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${valid}` }), context('confirm'))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('must-not-leak')
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
  })
})

describe('login, setup, logout', () => {
  it('signs in and returns only the fixed workspace redirect, propagating ALL cookies and headers', async () => {
    mocks.create.mockImplementation((adapter) => {
      auth.signInWithPassword.mockImplementation(async () => {
        await adapter.setAll([{ name: 'sb-test.0', value: 'chunk0', options: {} }, { name: 'sb-test.1', value: 'chunk1', options: {} }], { 'X-Test-Refresh': 'yes' })
        return { error: null }
      })
      return { auth }
    })
    const response = await POST(request('login', { email: 'person@example.test', password: 'private-input', next: '//evil.test' }), context('login'))
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'person@example.test', password: 'private-input' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${canonical}/workspace`)
    expect(response.cookies.get('sb-test.0')?.httpOnly).toBe(true)
    expect(response.cookies.get('sb-test.1')?.value).toBe('chunk1')
    expect(response.headers.get('x-test-refresh')).toBe('yes')
    expect(await response.text()).not.toContain('private-input')
  })
  it('preserves only the email on invalid credentials and denies an unmapped user', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { status: 400 } })
    const failure = await POST(request('login', { email: 'person@example.test', password: 'must-not-persist' }), context('login'))
    expect(failure.headers.get('location')).toBe(`${canonical}/login?error=invalid_credentials`)
    expect(failure.headers.get('set-cookie')).toContain('bx1-login-email')
    expect(failure.headers.get('set-cookie')).not.toContain('must-not-persist')
    mocks.workspace.mockResolvedValueOnce(null)
    const denied = await POST(request('login', { email: 'person@example.test', password: 'private-input' }), context('login'))
    expect(denied.headers.get('location')).toBe(`${canonical}/workspace/access-denied`)
  })
  it('rejects bad login fields before provider calls', async () => {
    const response = await POST(request('login', { email: 'invalid', password: 'x' }), context('login'))
    expect(response.status).toBe(400)
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })
  it('requires active workspace both before and after password update', async () => {
    const response = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'long-private-password' })
    expect(mocks.workspace).toHaveBeenCalledTimes(2)
    expect(response.headers.get('location')).toBe(`${canonical}/workspace`)
  })
  it('does not permit setup merely because setup=1 was supplied', async () => {
    mocks.workspace.mockResolvedValue(null)
    expect((await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))).status).toBe(403)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('denies mismatched passwords and provider password errors', async () => {
    expect((await POST(request('setup', { password: 'long-private-password', confirmPassword: 'other' }), context('setup'))).status).toBe(400)
    auth.updateUser.mockResolvedValueOnce({ error: { status: 422 } })
    expect((await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))).headers.get('location')).toBe(`${canonical}/login?setup=1&error=invalid_request`)
  })
  it('server-revokes only this session and does not fake success on provider failure', async () => {
    expect((await POST(request('logout'), context('logout'))).headers.get('location')).toBe(`${canonical}/login`)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    auth.signOut.mockResolvedValueOnce({ error: { status: 503, message: 'private-provider-error' } })
    const failure = await POST(request('logout'), context('logout'))
    expect(failure.status).toBe(503)
    expect(failure.headers.get('location')).toBeNull()
    expect(await failure.text()).not.toContain('private-provider-error')
  })
  it('does not claim logout without a verified session', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await POST(request('logout'), context('logout'))).status).toBe(401)
    expect(auth.signOut).not.toHaveBeenCalled()
  })
  it('redacts unexpected provider/SQL errors and keeps no-store headers', async () => {
    mocks.workspace.mockRejectedValueOnce(new Error('secret-sql-error'))
    const response = await POST(request('login', { email: 'person@example.test', password: 'private-input' }), context('login'))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret-sql-error')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})
