import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), workspace: vi.fn(), mfaContext: vi.fn(), sufficient: vi.fn(), current: vi.fn(), portal: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfaContext, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.portal }))
vi.mock('@/lib/supabase/mfa-actions', () => ({ handleMfaAction: vi.fn(), mfaErrorResponse: vi.fn() }))
vi.mock('@/lib/administration/actions', () => ({ handleAdministrationAction: vi.fn(), administrationErrorResponse: vi.fn() }))
import { GET, POST } from './[action]/route'
import { PortalError } from '@/lib/portal/server'
import { PENDING_INVITE_COOKIE } from '@/lib/supabase/http'

const canonical = 'https://block-x-one-portal-auth-test.vercel.app'
const hash = 'a'.repeat(64)
const nativeContext = { fixture: 'native-live-session' }
const nativeWorkspace = { user: { id: 'person-1', email: 'person@example.test' }, organisations: [{ id: 'org-1', name: 'Example', roles: ['Investor'] }] }
let auth: { signInWithPassword: ReturnType<typeof vi.fn>; verifyOtp: ReturnType<typeof vi.fn>; updateUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> }
function context(action: string) { return { params: Promise.resolve({ action }) } }
function staged(type = 'signup', expiresAt = Date.now() + 600_000) { return encodeURIComponent(JSON.stringify({ tokenHash: hash, type, expiresAt })) }
function post(action: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return new NextRequest(`${canonical}/auth/${action}`, { method: 'POST', headers: { origin: canonical, host: new URL(canonical).host, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) })
}
function login() { return post('login', { email: 'person@example.test', password: 'test-password-only' }) }

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', canonical)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  auth = { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }), verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn().mockResolvedValue({ error: null }) }
  mocks.create.mockReturnValue({ auth })
  mocks.user.mockResolvedValue({ id: 'person-1', email: 'person@example.test', email_confirmed_at: '2026-09-21T00:00:00Z' })
  mocks.workspace.mockResolvedValue(nativeWorkspace)
  mocks.mfaContext.mockResolvedValue(nativeContext)
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.portal.mockResolvedValue({ user: { id: 'person-1', email: 'person@example.test' }, snapshot: { actor: { id: 'person-1', email: 'person@example.test', can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [] } })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('TEST signup confirmation without consuming email-scanner GETs', () => {
  it('stages a signup token in a protected cookie, strips it from the URL, and does not verify on GET', async () => {
    const response = await GET(new NextRequest(`${canonical}/auth/confirm?token_hash=${hash}&type=signup`), context('confirm'))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${canonical}/auth/confirm`)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const cookie = response.cookies.get(PENDING_INVITE_COOKIE)!
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
    const clean = await GET(new NextRequest(`${canonical}/auth/confirm`, { headers: { cookie: `${PENDING_INVITE_COOKIE}=${cookie.value}` } }), context('confirm'))
    const html = await clean.text()
    expect(html).toContain('Confirm your email')
    expect(html).toContain('method="post"')
    expect(html).toContain('action="/auth/confirm"')
    expect(html).not.toContain(hash)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('consumes only an explicit same-origin POST and admits new onboarding only after the portal RPC', async () => {
    mocks.mfaContext.mockResolvedValueOnce(null)
    const response = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: hash, type: 'signup' })
    expect(mocks.portal).toHaveBeenCalledWith({ auth })
    expect(auth.verifyOtp.mock.invocationCallOrder[0]).toBeLessThan(mocks.portal.mock.invocationCallOrder[0])
    expect(response.headers.get('location')).toBe(`${canonical}/portal/onboarding`)
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('requires native MFA before signup users can access portal data', async () => {
    mocks.sufficient.mockReturnValueOnce(false)
    const response = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(response.headers.get('location')).toBe(`${canonical}/login/mfa`)
    expect(mocks.portal).not.toHaveBeenCalled()
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
  })
  it('does not authorize signup based on a session when the portal backend denies it', async () => {
    mocks.mfaContext.mockResolvedValueOnce(null)
    mocks.portal.mockRejectedValueOnce(new PortalError('Suspended or recovery restricted', 403))
    const response = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).not.toContain('Suspended or recovery restricted')
    expect(response.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
  })
  it('fails closed on changed MFA context or failed authoritative reads', async () => {
    mocks.current.mockResolvedValueOnce(false)
    const changed = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(changed.status).toBe(503)
    mocks.portal.mockRejectedValueOnce(new PortalError('Database unavailable', 503))
    const unavailable = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(unavailable.status).toBe(503)
    expect(unavailable.cookies.get(PENDING_INVITE_COOKIE)?.maxAge).toBe(0)
  })
  it('rejects forged origin, duplicate signup parameters and expired staged tokens', async () => {
    expect((await POST(post('confirm', {}, { origin: 'https://evil.test', cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))).status).toBe(403)
    expect((await GET(new NextRequest(`${canonical}/auth/confirm?token_hash=${hash}&type=signup&type=invite`), context('confirm'))).status).toBe(400)
    expect((await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged('signup', Date.now() - 1)}` }), context('confirm'))).status).toBe(400)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })
  it('does not read portal state when Supabase rejects the signup verification', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: { code: 'otp_expired', message: 'private-provider-details' } })
    const response = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))
    expect(response.status).toBe(400)
    expect(mocks.portal).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private-provider-details')
  })
  it.each([['VERCEL_ENV', 'production'], ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'legacy']])('rejects signup when the shared identity configuration is inconsistent: %s', async (key, value) => {
    vi.stubEnv(key, value)
    expect((await GET(new NextRequest(`${canonical}/auth/confirm?token_hash=${hash}&type=signup`), context('confirm'))).status).toBe(400)
    expect((await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged()}` }), context('confirm'))).status).toBe(400)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it.each(['invite', 'recovery'])('preserves native %s password setup in TEST', async type => {
    const response = await POST(post('confirm', {}, { cookie: `${PENDING_INVITE_COOKIE}=${staged(type)}` }), context('confirm'))
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: hash, type })
    expect(response.headers.get('location')).toBe(`${canonical}/login?setup=1`)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
})

describe('TEST login destinations retain native authority and suspension checks', () => {
  it('preserves password recovery for a verified applicant with no native staff profile', async () => {
    mocks.mfaContext.mockResolvedValue(null)
    const response = await POST(post('setup', { password: 'a-new-unique-passphrase', confirmPassword: 'a-new-unique-passphrase' }), context('setup'))
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-unique-passphrase' })
    expect(mocks.portal).toHaveBeenCalledTimes(2)
    expect(response.headers.get('location')).toBe(`${canonical}/portal/onboarding`)
  })
  it('never changes an applicant password when authoritative entry denies current access', async () => {
    mocks.mfaContext.mockResolvedValue(null)
    mocks.portal.mockRejectedValueOnce(new PortalError('Recovery denied', 403))
    expect((await POST(post('setup', { password: 'a-new-unique-passphrase', confirmPassword: 'a-new-unique-passphrase' }), context('setup'))).status).toBe(503)
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('routes native active members to /portal only after MFA, workspace, and the authoritative portal read', async () => {
    const response = await POST(login(), context('login'))
    expect(mocks.workspace).toHaveBeenCalledTimes(1)
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(mocks.mfaContext.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0])
    expect(mocks.portal.mock.invocationCallOrder[0]).toBeLessThan(mocks.current.mock.invocationCallOrder[0])
    expect(response.headers.get('location')).toBe(`${canonical}/portal`)
  })
  it('routes new verified users without native profiles to onboarding only after authoritative admission', async () => {
    mocks.mfaContext.mockResolvedValueOnce(null)
    const response = await POST(login(), context('login'))
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(response.headers.get('location')).toBe(`${canonical}/portal/onboarding`)
  })
  it('admits a valid native context without an active workspace only if the portal RPC allows onboarding', async () => {
    mocks.workspace.mockResolvedValueOnce(null)
    const response = await POST(login(), context('login'))
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(response.headers.get('location')).toBe(`${canonical}/portal/onboarding`)
  })
  it.each([401, 403])('does not bypass native suspension or recovery restrictions when portal admission returns %s', async status => {
    mocks.mfaContext.mockResolvedValueOnce(null)
    mocks.portal.mockRejectedValueOnce(new PortalError('Native restrictions', status))
    const response = await POST(login(), context('login'))
    expect(response.headers.get('location')).toBe(`${canonical}/workspace/access-denied`)
  })
  it('does not grant portal access solely because a native workspace exists', async () => {
    mocks.portal.mockRejectedValueOnce(new PortalError('Recovery restriction', 403))
    expect((await POST(login(), context('login'))).headers.get('location')).toBe(`${canonical}/workspace/access-denied`)
  })
  it('keeps required MFA ahead of every workspace and portal data read', async () => {
    mocks.sufficient.mockReturnValueOnce(false)
    const response = await POST(login(), context('login'))
    expect(response.headers.get('location')).toBe(`${canonical}/login/mfa`)
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('fails closed when portal loading refreshes away the earlier native MFA context', async () => {
    mocks.current.mockResolvedValueOnce(false)
    const response = await POST(login(), context('login'))
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
  })
  it('does not mask authoritative portal read errors as successful onboarding', async () => {
    mocks.mfaContext.mockResolvedValueOnce(null)
    mocks.portal.mockRejectedValueOnce(new PortalError('Database unavailable', 503))
    expect((await POST(login(), context('login'))).status).toBe(503)
  })
  it('preserves production login routing without calling the TEST portal', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(login(), context('login'))).headers.get('location')).toBe(`${canonical}/workspace`)
    expect(mocks.portal).not.toHaveBeenCalled()
    mocks.mfaContext.mockResolvedValueOnce(null)
    expect((await POST(login(), context('login'))).headers.get('location')).toBe(`${canonical}/workspace/access-denied`)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('does not read portal state after invalid credentials', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { status: 400, code: 'invalid_credentials' } })
    expect((await POST(login(), context('login'))).headers.get('location')).toBe(`${canonical}/login?error=invalid_credentials`)
    expect(mocks.portal).not.toHaveBeenCalled()
  })
  it('routes a configured MAINNET member through shared identity without TEST business RPCs', async () => {
    const origin = 'https://bx1.co.za'
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin)
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const request = new NextRequest(`${origin}/auth/login`, { method: 'POST', headers: { origin, host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'person@example.test', password: 'test-password-only' }) })
    expect((await POST(request, context('login'))).headers.get('location')).toBe(`${origin}/portal`)
    expect(mocks.portal).toHaveBeenCalledTimes(1)
    expect(mocks.current).toHaveBeenCalled()
  })
})
