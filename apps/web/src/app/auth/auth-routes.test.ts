import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), workspace: vi.fn(), mfaContext: vi.fn(), sufficient: vi.fn(), current: vi.fn(), mfaAction: vi.fn(), adminAction: vi.fn(), recoveryAction: vi.fn() }))
vi.mock('@/lib/supabase/server', async (importOriginal) => ({
  ...await importOriginal<object>(), createRequestSupabaseClient: mocks.create,
  readVerifiedUser: mocks.user, readWorkspace: mocks.workspace,
}))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfaContext, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('@/lib/supabase/mfa-actions', async (original) => ({ ...await original<object>(), handleMfaAction: mocks.mfaAction }))
vi.mock('@/lib/administration/actions', async (original) => ({ ...await original<object>(), handleAdministrationAction: mocks.adminAction }))
import { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } from './[action]/route'
vi.mock('@/lib/recovery/actions', async original => ({ ...await original<object>(), handleRecoveryAction: mocks.recoveryAction }))
import { POST as recoveryPost, GET as recoveryGet, PUT as recoveryPut, OPTIONS as recoveryOptions } from './recovery-command/route'
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
  mocks.mfaContext.mockResolvedValue({ fixture: 'trusted-context' })
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
})

describe('dedicated recovery endpoint admission', () => {
  const fields = { intent: 'request', requestKey: '40000000-0000-4000-8000-000000000001', reason: 'LOST_AUTHENTICATOR' }
  it('has no state-changing GET and admits only POST', async () => {
    for (const handler of [recoveryGet, recoveryPut, recoveryOptions]) {
      const response = handler()
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect(response.headers.get('cache-control')).toContain('no-store')
    }
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([{ origin: 'null' }, { origin: 'https://evil.test' }, { host: 'evil.test' }, { 'sec-fetch-site': 'cross-site' }])('denies unsafe headers before identity or body work %#', async headers => {
    expect((await recoveryPost(request('recovery-command', fields, headers as Record<string, string>))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.recoveryAction).not.toHaveBeenCalled()
  })
  it('rejects query, duplicate, oversized and non-form input before dispatch', async () => {
    expect((await recoveryPost(request('recovery-command?target=forged', fields))).status).toBe(400)
    expect((await recoveryPost(request('recovery-command', fields, { 'content-type': 'application/json' }))).status).toBe(400)
    expect((await recoveryPost(request('recovery-command', { ...fields, padding: 'x'.repeat(9000) }))).status).toBe(400)
    const req = request('recovery-command', fields)
    const duplicate = new NextRequest(req.url, { method: 'POST', headers: req.headers, body: 'intent=request&intent=apply' })
    expect((await recoveryPost(duplicate)).status).toBe(400)
    expect(mocks.recoveryAction).not.toHaveBeenCalled()
  })
  it('passes one operation deadline and carries refresh cookies to the final result', async () => {
    mocks.create.mockImplementationOnce(adapter => {
      adapter.setAll([{ name: 'sb-test.0', value: 'refreshed', options: {} }], {})
      return { auth }
    })
    mocks.recoveryAction.mockResolvedValueOnce(NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 }))
    const response = await recoveryPost(request('recovery-command', fields))
    expect(response.status).toBe(403)
    expect(mocks.recoveryAction.mock.calls[0][0].toString()).toBe(new URLSearchParams(fields).toString())
    expect(mocks.recoveryAction.mock.calls[0][2]).toHaveProperty('signal')
    expect(response.cookies.get('sb-test.0')?.value).toBe('refreshed')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
  it('bounds an unfinished input stream and cannot dispatch after cancellation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    try {
      const cancel = vi.fn()
      const stream = new ReadableStream<Uint8Array>({ cancel })
      const req = new NextRequest(`${canonical}/auth/recovery-command`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: stream, duplex: 'half' } as RequestInit)
      const pending = recoveryPost(req)
      await vi.advanceTimersByTimeAsync(12001)
      expect((await pending).status).toBe(503)
      expect(cancel).toHaveBeenCalledOnce()
      expect(mocks.create).not.toHaveBeenCalled()
      expect(mocks.recoveryAction).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('rejects an already-cancelled request and mismatched modes without an Auth client', async () => {
    const abort = new AbortController(); abort.abort()
    const base = request('recovery-command', fields)
    expect((await recoveryPost(new NextRequest(base.url, { method: 'POST', headers: base.headers, body: new URLSearchParams(fields), signal: abort.signal }))).status).toBe(503)
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    expect((await recoveryPost(request('recovery-command', fields))).status).toBe(503)
    vi.stubEnv('BLOCKXONE_AUTH_MODE', '')
    expect((await recoveryPost(request('recovery-command', fields))).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
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
  it.each(['login', 'setup', 'logout', 'confirm'])('does not accept absent/null Origin or absent/null/foreign Host on %s', async (action) => {
    for (const [header, value] of [['origin', undefined], ['origin', 'null'], ['host', undefined], ['host', 'null'], ['host', 'foreign.example']] as const) {
      const req = request(action)
      if (value === undefined) req.headers.delete(header)
      else req.headers.set(header, value)
      const response = await POST(req, context(action))
      expect(response.status).toBe(403)
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    }
    expect(mocks.create).not.toHaveBeenCalled()
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
    const req = new NextRequest(`${canonical}/auth/login`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&email=b' })
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
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    const pending = response.cookies.get(PENDING_INVITE_COOKIE)!
    expect(pending).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    expect(pending).not.toHaveProperty('domain')
    const clean = await GET(new NextRequest(`${canonical}/auth/confirm`, { headers: { cookie: `${PENDING_INVITE_COOKIE}=${pending.value}` } }), context('confirm'))
    const html = await clean.text()
    expect(clean.headers.get('referrer-policy')).toBe('strict-origin')
    expect(html).toContain('<meta name="referrer" content="strict-origin">')
    expect(html).not.toContain('<meta name="referrer" content="no-referrer">')
    expect(html).toContain('method="post"')
    expect(html).not.toContain(hash)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
  it('does not promote a confirmation document with unexpected query state to a form', async () => {
    const pending = encodeURIComponent(JSON.stringify({ tokenHash: hash, type: 'invite', expiresAt: Date.now() + 600000 }))
    const response = await GET(new NextRequest(`${canonical}/auth/confirm?code=synthetic`, { headers: { cookie: `${PENDING_INVITE_COOKIE}=${pending}` } }), context('confirm'))
    expect(response.status).toBe(400)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.text()).not.toContain('<form')
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
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
  })
})

describe('login, setup, logout', () => {
  it('checks MFA before any workspace reads and preserves AAL1 challenge cookies', async () => {
    mocks.sufficient.mockReturnValue(false)
    mocks.create.mockImplementation((adapter) => {
      auth.signInWithPassword.mockImplementation(async () => {
        adapter.setAll([{ name: 'sb-test.0', value: 'aal1-cookie', options: {} }], {})
        return { error: null }
      })
      return { auth }
    })
    const response = await POST(request('login', { email: 'person@example.test', password: 'private-input' }), context('login'))
    expect(response.headers.get('location')).toBe(`${canonical}/login/mfa`)
    expect(response.cookies.get('sb-test.0')?.value).toBe('aal1-cookie')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('takes an inactive login directly to access denial without workspace reads', async () => {
    mocks.mfaContext.mockResolvedValue(null)
    const response = await POST(request('login', { email: 'person@example.test', password: 'private-input' }), context('login'))
    expect(response.headers.get('location')).toBe(`${canonical}/workspace/access-denied`)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('retains setup continuation before password mutation and workspace RLS', async () => {
    mocks.sufficient.mockReturnValue(false)
    const response = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(response.headers.get('location')).toBe(`${canonical}/login/mfa?continue=setup`)
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('refuses password mutation when token continuity changed during workspace reads', async () => {
    mocks.current.mockResolvedValue(false)
    const response = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(response.status).toBe(503)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it.each(['invite', 'recovery'])('requires enrolled MFA after %s confirmation without losing setup', async (type) => {
    mocks.sufficient.mockReturnValue(false)
    const pending = encodeURIComponent(JSON.stringify({ tokenHash: 'a'.repeat(64), type, expiresAt: Date.now() + 600000 }))
    const response = await POST(request('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${pending}` }), context('confirm'))
    expect(response.headers.get('location')).toBe(`${canonical}/login/mfa?continue=setup`)
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('leaves AAL1 signout independent of workspace/MFA bootstrap', async () => {
    mocks.mfaContext.mockResolvedValue(null)
    expect((await POST(request('logout'), context('logout'))).headers.get('location')).toBe(`${canonical}/login`)
    expect(mocks.mfaContext).not.toHaveBeenCalled()
  })
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
    const mismatch = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'other' }), context('setup'))
    expect(mismatch.status).toBe(303)
    expect(mismatch.headers.get('location')).toBe(`${canonical}/login?setup=1&error=password_mismatch`)
    expect(auth.updateUser).not.toHaveBeenCalled()
    auth.updateUser.mockResolvedValueOnce({ error: { status: 422 } })
    expect((await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))).headers.get('location')).toBe(`${canonical}/login?setup=1&error=password_rejected`)
  })
  it.each([0, 11, 1025])('keeps rejected setup length %i in setup with no credential reflection', async (length) => {
    const password = 'x'.repeat(length)
    const response = await POST(request('setup', { password, confirmPassword: password }), context('setup'))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1&error=password_length`)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.text()).toBe('')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('rejects malformed setup fields without losing the setup destination', async () => {
    const req = new NextRequest(`${canonical}/auth/setup`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=private-one&password=private-two' })
    const response = await POST(req, context('setup'))
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1&error=setup_request_invalid`)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private-')
  })
  it.each([
    [{ 'content-type': 'application/json' }, '{}'],
    [{ 'content-length': '8193' }, 'password=synthetic'],
    [{ 'content-length': 'invalid' }, 'password=synthetic'],
    [{}, `password=${'x'.repeat(8193)}`],
  ])('keeps malformed setup body rejected before Auth', async (extraHeaders, body) => {
    const req = new NextRequest(`${canonical}/auth/setup`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders }, body })
    const response = await POST(req, context('setup'))
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1&error=setup_request_invalid`)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('logs only a fixed outcome code, never credentials or provider text', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await POST(request('setup', { password: 'private-secret-password', confirmPassword: 'not-the-same' }), context('setup'))
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'auth_setup_result', code: 'password_mismatch' }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-secret-password')
    log.mockClear()
    await POST(request('setup', { password: 'private-secret-password', confirmPassword: 'private-secret-password' }), context('setup'))
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'auth_setup_result', code: 'password_saved' }))
  })
  it.each([
    ['same_password', 422, 'password_same'],
    ['weak_password', 422, 'password_rejected'],
    ['reauthentication_needed', 400, 'password_reauthentication'],
    ['session_not_found', 401, 'password_reauthentication'],
  ])('maps provider %s to fixed actionable copy without raw details', async (code, status, expected) => {
    auth.updateUser.mockResolvedValueOnce({ error: { code, status, message: 'private-provider-detail' } })
    const response = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1&error=${expected}`)
    expect(await response.text()).not.toContain('private-provider-detail')
  })
  it('carries session-refresh cookies through a setup rejection', async () => {
    mocks.create.mockImplementation((adapter) => {
      auth.updateUser.mockImplementation(async () => {
        adapter.setAll([{ name: 'sb-test.0', value: 'refresh-chunk', options: {} }], {})
        return { error: { status: 422, code: 'weak_password' } }
      })
      return { auth }
    })
    const response = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(response.cookies.get('sb-test.0')).toMatchObject({ value: 'refresh-chunk', httpOnly: true, secure: true })
    expect(response.headers.get('location')).toContain('setup=1')
  })
  it('leaves a setup retry link on origin and provider-availability errors', async () => {
    const forged = await POST(request('setup', {}, { origin: 'https://evil.test' }), context('setup'))
    expect(forged.status).toBe(403)
    expect(await forged.text()).toContain('href="/login?setup=1"')
    auth.updateUser.mockResolvedValueOnce({ error: { status: 503, message: 'private-provider-detail' } })
    const unavailable = await POST(request('setup', { password: 'long-private-password', confirmPassword: 'long-private-password' }), context('setup'))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).toContain('Return to password setup')
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

describe('MFA route admission and shared cookie response', () => {
  it.each(['mfa-enroll', 'mfa-verify'])('dispatches only same-origin bounded POST %s with the same client and cookie adapter', async (action) => {
    mocks.create.mockImplementation((adapter) => {
      mocks.mfaAction.mockImplementation(async () => {
        adapter.setAll([{ name: 'sb-test.0', value: 'upgraded', options: {} }, { name: 'sb-test.1', value: '', options: { maxAge: 0 } }], { 'X-Test-Refresh': 'mfa' })
        return NextResponse.json({ ok: false, error: 'invalid_code' }, { status: 400 })
      })
      return { auth }
    })
    const response = await POST(request(action), context(action))
    expect(mocks.mfaAction).toHaveBeenCalledWith(action, expect.any(URLSearchParams), { auth })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.cookies.get('sb-test.0')).toMatchObject({ value: 'upgraded', httpOnly: true, secure: true })
    expect(response.cookies.get('sb-test.1')?.maxAge).toBe(0)
    expect(response.headers.get('x-test-refresh')).toBe('mfa')
  })
  it.each(['mfa-enroll', 'mfa-verify'])('rejects non-POST %s, null origin and forged Host before Auth', async (action) => {
    for (const [handler, method] of [[GET, 'GET'], [PUT, 'PUT'], [PATCH, 'PATCH'], [DELETE, 'DELETE'], [OPTIONS, 'OPTIONS'], [HEAD, 'HEAD']] as const) {
      const response = await handler(new NextRequest(`${canonical}/auth/${action}`, { method }), context(action))
      expect(response.status).toBe(405)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    }
    const invalidHeaders: Record<string, string>[] = [{ origin: 'null' }, { origin: '' }, { host: 'evil.test' }]
    for (const headers of invalidHeaders) {
      const response = await POST(request(action, {}, headers), context(action))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.mfaAction).not.toHaveBeenCalled()
  })
  it.each(['mfa-enroll', 'mfa-verify'])('keeps malformed %s requests private and JSON without raw details', async (action) => {
    const req = new NextRequest(`${canonical}/auth/${action}`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=123456&code=123456' })
    const response = await POST(req, context(action))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('exact administration route and shared parsed form', () => {
  it('dispatches once with the consumed form and preserves refresh/deletion cookies on safe denials', async () => {
    mocks.create.mockImplementation(adapter => {
      mocks.adminAction.mockImplementation(async (form) => {
        expect(form).toBeInstanceOf(URLSearchParams)
        expect(form.get('intent')).toBe('apply')
        adapter.setAll([{ name: 'sb-test.0', value: 'refreshed', options: {} }, { name: 'sb-test.1', value: '', options: { maxAge: 0 } }], { 'X-Test-Refresh': 'administration' })
        return NextResponse.json({ ok: false, error: 'conflict' }, { status: 409 })
      })
      return { auth }
    })
    const response = await POST(request('admin-command', { intent: 'apply' }), context('admin-command'))
    expect(response.status).toBe(409)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.adminAction).toHaveBeenCalledExactlyOnceWith(expect.any(URLSearchParams), { auth })
    expect(response.cookies.get('sb-test.0')).toMatchObject({ value: 'refreshed', httpOnly: true, secure: true })
    expect(response.cookies.get('sb-test.1')?.maxAge).toBe(0)
    expect(response.headers.get('x-test-refresh')).toBe('administration')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await response.json()).toEqual({ ok: false, error: 'conflict' })
  })
  it.each(['origin', 'host'])('denies missing/null/foreign %s before client creation', async header => {
    for (const value of [undefined, 'null', 'https://foreign.test']) {
      const req = request('admin-command')
      if (value === undefined) req.headers.delete(header)
      else req.headers.set(header, value)
      const response = await POST(req, context('admin-command'))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.adminAction).not.toHaveBeenCalled()
  })
  it.each([[GET, 'GET'], [PUT, 'PUT'], [PATCH, 'PATCH'], [DELETE, 'DELETE'], [OPTIONS, 'OPTIONS'], [HEAD, 'HEAD']] as const)('denies non-POST method %# with private JSON', async (handler, method) => {
    const response = await handler(new NextRequest(`${canonical}/auth/admin-command`, { method }), context('admin-command'))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each(['/auth/admin-command/', '/auth/%61dmin-command', '/auth/admin-command/nested', '/auth/Admin-command', '/auth/admin-command?actor=x'])('denies alternate path/query %s even with a forged matching route parameter', async path => {
    const req = new NextRequest(`${canonical}${path}`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: '' })
    expect((await POST(req, context('admin-command'))).status).toBe(path.includes('?') ? 400 : 404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each(['intent=apply&intent=apply', 'x='.concat('a'.repeat(8193))])('rejects duplicate or oversized body before any client %#', async body => {
    const req = new NextRequest(`${canonical}/auth/admin-command`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body })
    expect((await POST(req, context('admin-command'))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('classifies fatal UTF-8 decoding as invalid only before client creation', async () => {
    const req = new NextRequest(`${canonical}/auth/admin-command`, { method: 'POST', headers: { origin: canonical, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: new Uint8Array([255]) })
    const response = await POST(req, context('admin-command'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.adminAction).not.toHaveBeenCalled()
  })
  it.each([Error, TypeError])('keeps post-dispatch exception %# unavailable while retaining refreshed cookies', async ErrorType => {
    mocks.create.mockImplementation(adapter => {
      mocks.adminAction.mockImplementation(async () => {
        adapter.setAll([{ name: 'sb-test.0', value: 'refreshed', options: {} }], {})
        throw new ErrorType('private-database-error')
      })
      return { auth }
    })
    const response = await POST(request('admin-command'), context('admin-command'))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(response.cookies.get('sb-test.0')?.value).toBe('refreshed')
  })
  it('fails paired-mode mismatches closed without a server client', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    expect((await POST(request('admin-command'), context('admin-command'))).status).toBe(503)
    vi.stubEnv('BLOCKXONE_AUTH_MODE', '')
    expect((await POST(request('admin-command'), context('admin-command'))).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
