import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isRegistrationError, isRegistrationIntent, REGISTRATION_CHECK_EMAIL, REGISTRATION_TERMS_VERSION, registrationMetadata, registrationProviderOutcome, validateRegistrationForm } from './registration'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.user }))
import { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } from '@/app/auth/register/route'
import { RegistrationForm } from '@/components/portal/registration-form'

const canonical = 'https://block-x-one-registration-test.vercel.app'
const password = 'a-unique-test-passphrase'
const fields = { email: 'person@example.test', password, confirmPassword: password, intent: 'investor', consent: 'accepted' }
let auth: { signUp: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> }

function request(changes: Record<string, string> = {}, headers: Record<string, string> = {}, query = '') {
  return new NextRequest(`${canonical}/auth/register${query}`, { method: 'POST', headers: { origin: canonical, host: new URL(canonical).host, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ ...fields, ...changes }) })
}

beforeEach(() => {
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
})

describe('hosted TEST registration endpoint', () => {
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
    ['VERCEL_ENV', 'production'], ['SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'], ['BLOCKXONE_TESTNET_FUND_DEMO', 'disabled'],
    ['BLOCKXONE_AUTH_MODE', 'legacy'], ['NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'legacy'], ['BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'],
  ])('refuses non-test configuration %s=%s before creating a client', async (name, value) => {
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
    expect(response.headers.get('location')).toBe(`${canonical}/portal/onboarding`)
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
    expect(response.headers.get('location')).toBe(`${canonical}/register?error=unavailable`)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
  it('does not emit partial cookies or provider details on unknown signup failure', async () => {
    mocks.create.mockImplementationOnce(adapter => {
      adapter.setAll([{ name: 'sb-partial-session', value: 'must-not-send', options: {} }], {})
      return { auth }
    })
    auth.signUp.mockRejectedValueOnce(new Error(`must-not-log ${password}`))
    const log = vi.spyOn(console, 'info')
    const response = await POST(request())
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('location')).toBe(`${canonical}/register?error=unavailable`)
    expect(await response.text()).not.toContain(password)
    expect(log).not.toHaveBeenCalled()
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
