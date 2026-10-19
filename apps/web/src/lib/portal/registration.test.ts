import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isRegistrationError, isRegistrationIntent, REGISTRATION_CHECK_EMAIL, REGISTRATION_TERMS_VERSION, registrationFailureReference, registrationMetadata, registrationProviderDiagnostic, registrationProviderOutcome, validateRegistrationForm } from './registration'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { PLATFORM_VERSION } from '@/lib/platform-release'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn(), read: vi.fn(), finish: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user }))
vi.mock('@/lib/supabase/http', async original => {
  const actual = await original<typeof import('@/lib/supabase/http')>()
  return {
    ...actual,
    readAuthForm: (source: NextRequest) => { mocks.read(); return actual.readAuthForm(source) },
    responseCookieAdapter: (source: NextRequest) => {
      const jar = actual.responseCookieAdapter(source)
      return { ...jar, finish: (response: NextResponse) => { mocks.finish(); return jar.finish(response) } }
    },
  }
})
import { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } from '@/app/auth/register/route'
import { RegistrationForm } from '@/components/portal/registration-form'

const canonical = 'https://block-x-one-registration-test.vercel.app'
const password = 'a-unique-test-passphrase'
const fields = { email: 'person@example.test', password, confirmPassword: password, intent: 'investor', consent: 'accepted' }
const reference = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let auth: { signUp: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> }

function request(changes: Record<string, string> = {}, headers: Record<string, string> = {}, query = '') {
  return new NextRequest(`${canonical}/auth/register${query}`, { method: 'POST', headers: { origin: canonical, host: new URL(canonical).host, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ ...fields, ...changes }) })
}

beforeEach(() => {
  mocks.read.mockReset()
  mocks.finish.mockReset()
  mocks.log.mockReset()
  vi.spyOn(console, 'error').mockImplementation(mocks.log)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', canonical)
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  auth = { signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user' }, session: null }, error: null }), signOut: vi.fn().mockResolvedValue({ error: null }) }
  mocks.create.mockReturnValue({ auth })
  mocks.user.mockResolvedValue(null)
})
afterEach(() => { vi.unstubAllEnvs() })

function failureDiagnostic(response: NextResponse) {
  const url = new URL(response.headers.get('location')!)
  const ref = url.searchParams.get('ref')
  expect(response.status).toBe(303)
  expect(url.origin).toBe(new URL(process.env.BLOCKXONE_APP_ORIGIN!).origin)
  expect(url.pathname).toBe('/register')
  expect(url.searchParams.get('error')).toBe('unavailable')
  expect(registrationFailureReference('unavailable', ref)).toBe(ref)
  expect(ref).not.toBeNull()
  expect([...url.searchParams.keys()]).toEqual(['error', 'ref'])
  expect(mocks.log).toHaveBeenCalledTimes(1)
  expect(mocks.log.mock.calls[0]).toHaveLength(1)
  const diagnostic = JSON.parse(mocks.log.mock.calls[0][0])
  expect(Object.keys(diagnostic).sort()).toEqual(['category', 'environment', 'event', 'phase', 'reference', 'release', 'upstream_status'])
  expect(diagnostic).toMatchObject({ event: 'bx1.registration_unavailable', reference: ref, release: PLATFORM_VERSION })
  return diagnostic
}

describe('registration validation and non-authorizing metadata', () => {
  it.each(['investor', 'wealth-manager'])('accepts an explicit %s application choice', intent => {
    expect(validateRegistrationForm(new URLSearchParams({ ...fields, intent }))).toEqual({ ok: true, value: { email: fields.email, password, intent } })
  })
  it('trims an email but never trims or normalizes a password', () => {
    const exact = '  a unique password  '
    expect(validateRegistrationForm(new URLSearchParams({ ...fields, email: ' person@example.test ', password: exact, confirmPassword: exact }))).toEqual({ ok: true, value: { email: fields.email, password: exact, intent: 'investor' } })
  })
  it.each([
    [{ email: '' }, 'email_invalid'], [{ email: 'not-an-email' }, 'email_invalid'], [{ email: `${'x'.repeat(255)}@example.test` }, 'email_invalid'],
    [{ intent: '' }, 'intent_required'], [{ intent: 'SuperAdmin' }, 'intent_required'], [{ intent: 'INVESTOR' }, 'intent_required'],
    [{ password: 'short' }, 'password_length'], [{ password: 'x'.repeat(1025) }, 'password_length'], [{ confirmPassword: 'different-passphrase' }, 'password_mismatch'],
    [{ consent: '' }, 'consent_required'], [{ consent: 'on' }, 'consent_required'],
  ] as const)('rejects malformed fields %#', (changes, error) => {
    expect(validateRegistrationForm(new URLSearchParams({ ...fields, ...changes }))).toEqual({ ok: false, error })
  })
  it('accepts exactly 12 and 1,024 password characters', () => {
    for (const size of [12, 1024]) expect(validateRegistrationForm(new URLSearchParams({ ...fields, password: 'x'.repeat(size), confirmPassword: 'x'.repeat(size) })).ok).toBe(true)
  })
  it.each(['role', 'organisation_id', 'user_id', 'redirectTo', 'app_metadata', 'extra'])('rejects forged extra field %s', key => {
    expect(validateRegistrationForm(new URLSearchParams({ ...fields, [key]: 'forged' }))).toEqual({ ok: false, error: 'invalid_request' })
  })
  it('rejects duplicate fields even when their values match', () => {
    const form = new URLSearchParams(fields)
    form.append('intent', 'investor')
    expect(validateRegistrationForm(form)).toEqual({ ok: false, error: 'invalid_request' })
  })
  it('records application preference and notice version only; never grants a role', () => {
    expect(registrationMetadata('wealth-manager')).toEqual({ portal_intent: 'wealth-manager', registration_terms_version: REGISTRATION_TERMS_VERSION })
    expect(registrationMetadata('investor')).not.toHaveProperty('role')
    expect(registrationMetadata('investor')).not.toHaveProperty('app_metadata')
  })
  it('allows only fixed error and intent values', () => {
    expect(isRegistrationIntent('investor')).toBe(true)
    expect(isRegistrationIntent(['investor'])).toBe(false)
    expect(isRegistrationError('password_mismatch')).toBe(true)
    expect(isRegistrationError('constructor')).toBe(false)
    expect(isRegistrationError('<script>')).toBe(false)
  })
  it.each([null, { code: 'user_already_exists', status: 422 }, { code: 'email_exists', status: 400 }])('gives an indistinguishable check-email outcome for new or existing users', error => {
    expect(registrationProviderOutcome(error)).toBe('check-email')
    expect(REGISTRATION_CHECK_EMAIL).toContain('If this address can be registered')
  })
  it('maps rate limiting and unknown provider failures to fixed copy', () => {
    expect(registrationProviderOutcome({ status: 429 })).toBe('rate_limited')
    expect(registrationProviderOutcome({ code: 'weak_password', status: 422 })).toBe('password_rejected')
    expect(registrationProviderOutcome({ status: 500 })).toBe('unavailable')
    expect(registrationProviderOutcome({ code: 'unexpected' })).toBe('unavailable')
  })
  it('accepts only a canonical UUIDv4 reference paired with the generic error', () => {
    expect(registrationFailureReference('unavailable', reference)).toBe(reference)
    for (const value of [undefined, '', [reference], reference.toUpperCase(), ` ${reference}`, `${reference}\n`, '<script>', 'person@example.test', '11111111-1111-1111-8111-111111111111']) {
      expect(registrationFailureReference('unavailable', value)).toBeUndefined()
    }
    for (const error of [undefined, 'password_rejected', 'rate_limited', ['unavailable'], 'check-email']) expect(registrationFailureReference(error, reference)).toBeUndefined()
  })
  it.each([
    ['signup_disabled', 'signup_disabled'], ['email_provider_disabled', 'email_provider_disabled'],
    ['email_address_not_authorized', 'email_delivery_restricted'], ['email_address_invalid', 'email_address_invalid'],
    ['captcha_failed', 'captcha_failed'], ['unexpected_failure', 'provider_unexpected_failure'],
    ['request_timeout', 'provider_request_timeout'], ['hook_timeout', 'provider_hook_failure'],
    ['hook_timeout_after_retry', 'provider_hook_failure'], ['hook_payload_over_size_limit', 'provider_hook_failure'],
    ['hook_payload_invalid_content_type', 'provider_hook_failure'],
  ])('reduces provider code %s to the fixed diagnostic category %s', (code, category) => {
    expect(registrationProviderDiagnostic({ code, status: 500, message: 'must-not-log', access_token: 'must-not-log' })).toEqual({ category, status: 500 })
  })
  it.each([
    [{ status: 401, code: 'raw-secret-code' }, { status: 401, category: 'provider_auth_rejected' }],
    [{ status: 403 }, { status: 403, category: 'provider_auth_rejected' }],
    [{ status: 503 }, { status: 503, category: 'provider_unavailable' }],
    [{ status: 422, code: 'raw-secret-code' }, { status: 422, category: 'unknown_provider_failure' }],
  ])('keeps unknown provider status diagnostic bounded %#', (error, expected) => {
    expect(registrationProviderDiagnostic(error)).toEqual(expected)
  })
  it.each(['401', '<script>', -1, 0, 99, 600, 500.1, Infinity, NaN, {}, null])('rejects nonnumeric or invalid upstream status %#', status => {
    expect(registrationProviderDiagnostic({ status, code: 'secret-unknown-code' })).toEqual({ status: null, category: 'unknown_provider_failure' })
  })
  it('does not evaluate raw messages or serialize hostile provider accessors', () => {
    const message = vi.fn(() => { throw new Error('must-not-log') })
    const error = Object.defineProperty({ status: 500, code: 'unexpected_failure' }, 'message', { get: message })
    expect(registrationProviderDiagnostic(error)).toEqual({ status: 500, category: 'provider_unexpected_failure' })
    expect(message).not.toHaveBeenCalled()
    const inaccessible = Object.defineProperty({}, 'status', { get: () => { throw new Error('must-not-log') } })
    expect(registrationProviderDiagnostic(inaccessible)).toEqual({ status: null, category: 'unknown_provider_failure' })
  })
})

describe('hosted TEST registration endpoint', () => {
  it('accepts a branded native form origin for safe validation but still rejects Origin:null before any provider call', async () => {
    const branded = 'https://testnet.bx1.co.za'
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', branded)
    const nativeRequest = (origin: string) => new NextRequest(`${branded}/auth/register`, {
      method: 'POST', headers: { origin, host: 'testnet.bx1.co.za', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, email: '' }),
    })
    const validOrigin = await POST(nativeRequest(branded))
    expect(validOrigin.status).toBe(303)
    expect(validOrigin.headers.get('location')).toBe(`${branded}/register?error=email_invalid`)
    const nullOrigin = await POST(nativeRequest('null'))
    expect(nullOrigin.status).toBe(403)
    expect(await nullOrigin.json()).toEqual({ ok: false, error: 'Registration request unavailable.' })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(auth.signUp).not.toHaveBeenCalled()
  })
  it('submits to Supabase with canonical confirmation callback and descriptive metadata only', async () => {
    const response = await POST(request({ intent: 'wealth-manager' }))
    expect(auth.signUp).toHaveBeenCalledWith({ email: fields.email, password, options: { emailRedirectTo: `${canonical}/auth/confirm`, data: { portal_intent: 'wealth-manager', registration_terms_version: REGISTRATION_TERMS_VERSION } } })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${canonical}/register?status=check-email`)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(auth.signOut).not.toHaveBeenCalled()
  })
  it('never assigns roles, provisions organisations, or reports an authenticated session', async () => {
    const response = await POST(request())
    expect(mocks.create.mock.results[0].value).not.toHaveProperty('from')
    expect(response.headers.get('location')).not.toContain('/portal')
    expect(await response.text()).not.toContain('new-user')
    expect(auth.signUp).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['VERCEL_ENV', 'production'], ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'], ['NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'MAINNET'],
    ['BLOCKXONE_AUTH_MODE', 'legacy'], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'legacy'], ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'],
  ])('refuses inconsistent identity configuration %s=%s before creating a client', async (name, value) => {
    vi.stubEnv(name, value)
    expect((await POST(request())).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  const unsafeOriginHeaders: Record<string, string>[] = [{ origin: 'null' }, { origin: 'https://evil.test' }, { host: 'evil.test' }, { 'sec-fetch-site': 'cross-site' }]
  it.each(unsafeOriginHeaders)('rejects unsafe origin headers %#', async headers => {
    expect((await POST(request({}, headers))).status).toBe(403)
    expect(auth.signUp).not.toHaveBeenCalled()
  })
  it('rejects query strings, non-form input, duplicate fields and oversized body', async () => {
    expect((await POST(request({}, {}, '?redirectTo=https://evil.test'))).status).toBe(400)
    expect((await POST(request({}, { 'content-type': 'application/json' }))).status).toBe(400)
    expect((await POST(request({}, { 'content-length': '9000' }))).status).toBe(400)
    expect((await POST(request({ password: 'x'.repeat(9000) }))).status).toBe(400)
    const source = request()
    const duplicate = new NextRequest(source.url, { method: 'POST', headers: source.headers, body: `${new URLSearchParams(fields)}&email=attacker%40example.test` })
    expect((await POST(duplicate)).status).toBe(400)
    expect(auth.signUp).not.toHaveBeenCalled()
  })
  it('returns fixed field error codes without sending or putting passwords in redirects', async () => {
    const response = await POST(request({ confirmPassword: 'not-the-password' }))
    expect(response.headers.get('location')).toBe(`${canonical}/register?error=password_mismatch`)
    expect(response.headers.get('location')).not.toContain(password)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('keeps duplicate-address responses indistinguishable from successful signup', async () => {
    const created = await POST(request())
    auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'user_already_exists', status: 422, message: 'must-not-leak' } })
    const duplicate = await POST(request())
    expect(duplicate.status).toBe(created.status)
    expect(duplicate.headers.get('location')).toBe(created.headers.get('location'))
    expect(await duplicate.text()).toBe(await created.text())
    expect(mocks.log).not.toHaveBeenCalled()
  })
  it('preserves native cookie-adapter writes needed by the confirmation flow', async () => {
    mocks.create.mockImplementationOnce(adapter => {
      adapter.setAll([{ name: 'sb-test-code-verifier', value: 'opaque-pkce-value', options: {} }], {})
      return { auth }
    })
    const response = await POST(request())
    expect(response.cookies.get('sb-test-code-verifier')?.value).toBe('opaque-pkce-value')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })
  it('does not replace or sign out an already authenticated account', async () => {
    mocks.user.mockResolvedValueOnce({ id: 'existing-user', email: 'existing@example.test' })
    const response = await POST(request())
    expect(response.headers.get('location')).toBe(`${canonical}/register`)
    expect(auth.signUp).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })
  it('discards unexpected auto-confirmed session cookies even if local signout fails', async () => {
    mocks.create.mockImplementationOnce(adapter => {
      adapter.setAll([{ name: 'sb-unexpected-session', value: 'must-not-send', options: {} }], {})
      return { auth }
    })
    auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'new-user' }, session: { access_token: 'must-not-send' } }, error: null })
    auth.signOut.mockRejectedValueOnce(new Error('must-not-leak'))
    const response = await POST(request())
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(failureDiagnostic(response)).toMatchObject({ environment: 'TESTNET', phase: 'unexpected_auto_confirm', category: 'unexpected_auto_confirm', upstream_status: null })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('must-not-send')
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('must-not-leak')
  })
  it('does not emit partial cookies or provider details on unknown signup failure', async () => {
    mocks.create.mockImplementationOnce(adapter => {
      adapter.setAll([{ name: 'sb-partial-session', value: 'must-not-send', options: {} }], {})
      return { auth }
    })
    auth.signUp.mockRejectedValueOnce(new Error(`must-not-log ${password}`))
    const response = await POST(request())
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(failureDiagnostic(response)).toMatchObject({ phase: 'provider_signup', category: 'unknown_provider_failure', upstream_status: null })
    expect(await response.text()).not.toContain(password)
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(password)
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('must-not-log')
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('must-not-send')
  })
  it.each([
    ['signup_disabled', 422, 'signup_disabled'], ['email_provider_disabled', 422, 'email_provider_disabled'],
    ['unexpected_failure', 500, 'provider_unexpected_failure'], ['raw-credential-code', 401, 'provider_auth_rejected'],
  ])('logs a provider failure category, not raw signup fields, for %s', async (code, status, category) => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { code, status, message: `${fields.email} ${password} raw-token`, access_token: 'raw-token' } })
    const response = await POST(request())
    expect(failureDiagnostic(response)).toMatchObject({ environment: 'TESTNET', phase: 'provider_signup', category, upstream_status: status })
    const serialized = JSON.stringify(mocks.log.mock.calls)
    for (const secret of [fields.email, password, 'raw-token', 'raw-credential-code']) expect(serialized).not.toContain(secret)
    expect(response.headers.get('location')).not.toContain(category)
  })
  it.each([
    ['request_read', 'request_read_failure', 'read'],
    ['client_init', 'client_initialization_failure', 'create'],
    ['session_lookup', 'session_lookup_failure', 'user'],
    ['response_finalization', 'response_cookie_failure', 'finish'],
  ] as const)('identifies thrown %s failures without logging the exception', async (phase, category, source) => {
    const error = new Error(`private failure ${fields.email} ${password} raw-token`)
    if (source === 'user') mocks.user.mockRejectedValueOnce(error)
    else mocks[source].mockImplementationOnce(() => { throw error })
    const response = await POST(request())
    expect(failureDiagnostic(response)).toMatchObject({ phase, category, upstream_status: null })
    expect(response.headers.get('set-cookie')).toBeNull()
    const serialized = JSON.stringify(mocks.log.mock.calls)
    for (const secret of [fields.email, password, 'raw-token', 'private failure']) expect(serialized).not.toContain(secret)
    if (source !== 'finish') expect(auth.signUp).not.toHaveBeenCalled()
  })
  it('reports a cookie failure once even after an unavailable provider result', async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { code: 'signup_disabled', status: 422 } })
    mocks.finish.mockImplementationOnce(() => { throw new Error('private cookie error') })
    expect(failureDiagnostic(await POST(request()))).toMatchObject({ phase: 'response_finalization', category: 'response_cookie_failure', upstream_status: null })
  })
  it('keeps failed logging from changing the redirect, cookies or generic outcome', async () => {
    mocks.log.mockImplementationOnce(() => { throw new Error('diagnostic sink unavailable') })
    auth.signUp.mockRejectedValueOnce(new Error('private provider error'))
    const response = await POST(request())
    expect(failureDiagnostic(response)).toMatchObject({ phase: 'provider_signup' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
  it('generates independent opaque references rather than using request data', async () => {
    auth.signUp.mockRejectedValue(new Error('private provider error'))
    const first = new URL((await POST(request())).headers.get('location')!).searchParams.get('ref')
    const second = new URL((await POST(request())).headers.get('location')!).searchParams.get('ref')
    expect(registrationFailureReference('unavailable', first)).toBe(first)
    expect(registrationFailureReference('unavailable', second)).toBe(second)
    expect(first).not.toBe(second)
    expect(mocks.log).toHaveBeenCalledTimes(2)
    expect(mocks.log.mock.calls.map(([entry]) => JSON.parse(entry).reference)).toEqual([first, second])
  })
  it('does not log successful, duplicate, field-validation, throttle or weak-password outcomes', async () => {
    await POST(request())
    await POST(request({ email: '' }))
    for (const error of [{ code: 'email_exists', status: 422 }, { code: 'weak_password', status: 422 }, { code: 'over_email_send_rate_limit', status: 429 }]) {
      auth.signUp.mockResolvedValueOnce({ data: { session: null }, error })
      const response = await POST(request())
      expect(response.headers.get('location')).not.toContain('ref=')
    }
    expect(mocks.log).not.toHaveBeenCalled()
  })
  it('keeps a referenced generic error document submit-capable for the next native retry', async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { status: 500, code: 'unexpected_failure' } })
    const failed = await POST(request())
    const params = new URL(failed.headers.get('location')!).searchParams
    expect(authDocumentReferrerPolicy('/register', params)).toBe('strict-origin')
    expect(authDocumentReferrerPolicy('/register', Object.fromEntries(params))).toBe('strict-origin')
    mocks.log.mockClear()
    const retry = await POST(request({}, { 'sec-fetch-site': 'same-origin' }))
    expect(retry.headers.get('location')).toBe(`${canonical}/register?status=check-email`)
    expect(mocks.log).not.toHaveBeenCalled()
  })
  it('logs only a validated MAINNET release on a correctly paired MAIN environment', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    auth.signUp.mockRejectedValueOnce(new Error('private provider error'))
    const mainRequest = new NextRequest('https://bx1.co.za/auth/register', { method: 'POST', headers: { origin: 'https://bx1.co.za', host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
    expect(failureDiagnostic(await POST(mainRequest))).toMatchObject({ environment: 'MAINNET', release: PLATFORM_VERSION, phase: 'provider_signup' })
  })
  it('uses hosted throttling outcomes without an in-memory security counter', async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { status: 429, code: 'over_request_rate_limit' } })
    expect((await POST(request())).headers.get('location')).toBe(`${canonical}/register?error=rate_limited`)
    expect(auth.signUp).toHaveBeenCalledTimes(1)
  })
  it('rejects every non-POST method without creating a Supabase client', () => {
    for (const handler of [GET, HEAD, PUT, PATCH, DELETE, OPTIONS]) {
      const response = handler()
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    }
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('registration form semantics', () => {
  it('shows the validated support reference only alongside the generic error', () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { error: 'unavailable', errorReference: reference }))
    expect(html).toContain(`Support reference: ${reference}`)
    expect(html).toContain('role="alert"')
    for (const error of ['password_mismatch', 'rate_limited', undefined] as const) {
      const stale = renderToStaticMarkup(createElement(RegistrationForm, { error, errorReference: reference }))
      expect(stale).not.toContain(reference)
      expect(stale).not.toContain('Support reference:')
    }
  })
  it.each(['<script>', 'person@example.test', 'raw-token', 'reference-with-newline\n', reference.toUpperCase()])('does not reflect an arbitrary reference %s into the form', errorReference => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { error: 'unavailable', errorReference }))
    expect(html).not.toContain('Support reference:')
    expect(html).not.toContain(errorReference)
  })
  it('renders explicit choices, native POST, accessible required controls and notice links', () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, {}))
    expect(html).toContain('action="/auth/register"')
    expect(html).toContain('method="post"')
    expect(html).toContain('value="investor"')
    expect(html).toContain('value="wealth-manager"')
    expect(html).toContain('name="confirmPassword"')
    expect(html).toMatch(/minlength="12"/i)
    expect(html).toMatch(/autocomplete="new-password"/i)
    expect(html).toContain('href="#testnet-terms"')
    expect(html).toContain('href="#registration-privacy"')
    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('name="role"')
    expect(html).not.toContain('localStorage')
  })
  it('selects only a supplied validated intent and shows fixed accessible error copy', () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { initialIntent: 'wealth-manager', error: 'password_mismatch' }))
    expect(html).toContain('value="wealth-manager"')
    expect(html).toContain('checked=""')
    expect(html).toContain('role="alert"')
    expect(html).toContain('passwords do not match')
    expect(html).toContain('aria-invalid="true"')
  })
  it('associates a missing-intent error with required radios without unsupported aria-invalid', () => {
    const html = renderToStaticMarkup(createElement(RegistrationForm, { error: 'intent_required' }))
    expect(html).toContain('aria-describedby="registration-error registration-path-help"')
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(2)
    for (const radio of radios) {
      expect(radio).toContain('required=""')
      expect(radio).toContain('aria-describedby="registration-error"')
      expect(radio).not.toContain('aria-invalid')
    }
  })
})
