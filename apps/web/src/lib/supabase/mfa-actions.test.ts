import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
import { handleMfaAction } from './mfa-actions'
import { MFA_ENROLL_QR_MAX_CHARACTERS, MFA_ENROLL_RESPONSE_MAX_BYTES } from './mfa-contracts'
import { createMfaFormController, readMfaResponse } from '@/components/auth/mfa-form'

const now = 1_800_000_000
const uid = '10000000-0000-4000-8000-000000000001'
const sid = '20000000-0000-4000-8000-000000000001'
const fid = '30000000-0000-4000-8000-000000000001'
const foreign = '40000000-0000-4000-8000-000000000001'
const qrCode = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'
const secret = 'JBSWY3DPEHPK3PXP'
function fixture(initial: 'none' | 'pending' | 'verified' | 'phone' = 'none') {
  let state = initial
  let upgraded = false
  const accessToken = () => ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify({ sub: uid, session_id: sid, exp: now + 600, aal: upgraded ? 'aal2' : 'aal1', amr: upgraded ? [{ method: 'totp', timestamp: now }] : [] })).toString('base64url'), 'mock-provider-verified'].join('.')
  const auth = {
    getSession: vi.fn().mockImplementation(async () => ({ data: { session: { access_token: accessToken() } }, error: null })),
    getUser: vi.fn().mockImplementation(async () => ({ data: { user: { id: uid, email: 'fixture@example.test', factors: state === 'none' ? [] : [{ id: fid, status: state === 'pending' ? 'unverified' : 'verified', factor_type: state === 'phone' ? 'phone' : 'totp' }] } }, error: null })),
    mfa: {
      enroll: vi.fn().mockImplementation(async () => { state = 'pending'; return { data: { id: fid, type: 'totp', totp: { qr_code: qrCode, secret, uri: 'private-uri' }, providerExtra: 'private-extra' }, error: null } }),
      challengeAndVerify: vi.fn().mockImplementation(async () => { state = 'verified'; upgraded = true; return { data: { access_token: 'private-new-token', refresh_token: 'private-refresh-token' }, error: null } }),
    },
  }
  const rpc = vi.fn().mockImplementation(async () => ({ data: { active: true, requires_mfa: state === 'verified' || state === 'phone', session_aal: upgraded ? 'aal2' : 'aal1', session_is_mfa: upgraded, session_is_totp: upgraded }, error: null }))
  return { auth, rpc, client: { auth, rpc } as unknown as SupabaseClient }
}
const verifyForm = (values: Record<string, string> = {}) => new URLSearchParams({ factorId: fid, code: '012345', continuation: 'workspace', ...values })
async function expectFailure(response: Response, status: number, error: string) {
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ ok: false, error })
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now * 1000) })

describe('explicit enrollment and safe provider projection', () => {
  it('round-trips a large synthetic provider SVG through the HTTP parser and transient controller', async () => {
    const f = fixture()
    const largeQr = `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M1 1h1v1H1z"/>'.repeat(18000)}</svg>`
    expect(largeQr.length).toBeGreaterThan(131072)
    f.auth.mfa.enroll.mockResolvedValue({ data: { id: fid, type: 'totp', totp: { qr_code: largeQr, secret } }, error: null })
    const controller = createMfaFormController({
      view: { state: 'unenrolled', factors: [], hasPendingTotp: false }, continuation: 'security',
      post: async () => readMfaResponse(await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client), true),
      navigate: vi.fn(), onChange: vi.fn(),
    })
    await controller.enroll()
    expect(controller.getState().setup?.qrCode.length).toBe(largeQr.length)
    expect(controller.getState().reloadRequired).toBe(false)
    controller.clear()
    expect(controller.getState().setup).toBeUndefined()
    await controller.enroll()
    expect(f.auth.mfa.enroll).toHaveBeenCalledOnce()
  })
  it('returns only a strictly validated one-response enrollment projection', async () => {
    const f = fixture()
    const response = await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, factorId: fid, qrCode, secret })
    expect(f.auth.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'BlockXOne authenticator' })
  })
  it.each(['pending', 'verified', 'phone'] as const)('never auto-deletes or adds a factor when state is %s', async (state) => {
    const f = fixture(state)
    await expectFailure(await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client), 409, state === 'pending' ? 'pending_setup_exists' : 'already_enrolled')
    expect(f.auth.mfa.enroll).not.toHaveBeenCalled()
  })
  it('denies inactive/revoked identity before any factor mutation', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ data: { active: false, requires_mfa: false, session_aal: null, session_is_mfa: false, session_is_totp: false }, error: null })
    await expectFailure(await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client), 401, 'unauthorised')
    expect(f.auth.mfa.enroll).not.toHaveBeenCalled()
  })
  it.each([
    { id: foreign, type: 'phone', totp: { qr_code: qrCode, secret } },
    { id: 'invalid', type: 'totp', totp: { qr_code: qrCode, secret } },
    { id: fid, type: 'totp', totp: { qr_code: 'https://evil.test/qr', secret } },
    { id: fid, type: 'totp', totp: { qr_code: qrCode, secret: '<private>' } },
    { id: fid, type: 'totp', totp: { qr_code: qrCode } },
  ])('rejects malformed enrollment output without leaking material', async (data) => {
    const f = fixture()
    f.auth.mfa.enroll.mockResolvedValue({ data, error: null })
    await expectFailure(await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client), 503, 'unavailable')
  })
  it.each([MFA_ENROLL_QR_MAX_CHARACTERS, MFA_ENROLL_QR_MAX_CHARACTERS + 1])('bounds QR characters at the client limit: %s', async (length) => {
    const f = fixture()
    const prefix = 'data:image/svg+xml;utf-8,<svg>'
    const boundedQr = `${prefix}${'x'.repeat(length - prefix.length - 6)}</svg>`
    f.auth.mfa.enroll.mockResolvedValue({ data: { id: fid, type: 'totp', totp: { qr_code: boundedQr, secret } }, error: null })
    const response = await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client)
    if (length > MFA_ENROLL_QR_MAX_CHARACTERS) await expectFailure(response, 503, 'unavailable')
    else expect(await response.json()).toEqual({ ok: true, factorId: fid, qrCode: boundedQr, secret })
  })
  it.each([
    { character: '"', extra: 0 }, { character: '"', extra: 1 },
    { character: '中', extra: 0 }, { character: '中', extra: 1 },
  ])('bounds serialized UTF8 success including escaping: %j', async ({ character, extra }) => {
    const f = fixture()
    const prefix = 'data:image/svg+xml;utf-8,<svg>'
    const emptyBytes = Buffer.byteLength(JSON.stringify({ ok: true, factorId: fid, qrCode: `${prefix}</svg>`, secret }), 'utf8')
    const characterBytes = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2
    const available = MFA_ENROLL_RESPONSE_MAX_BYTES + extra - emptyBytes
    const boundedQr = `${prefix}${character.repeat(Math.floor(available / characterBytes))}${'x'.repeat(available % characterBytes)}</svg>`
    const body = { ok: true, factorId: fid, qrCode: boundedQr, secret }
    expect(boundedQr.length).toBeLessThanOrEqual(MFA_ENROLL_QR_MAX_CHARACTERS)
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBe(MFA_ENROLL_RESPONSE_MAX_BYTES + extra)
    f.auth.mfa.enroll.mockResolvedValue({ data: { id: fid, type: 'totp', totp: { qr_code: boundedQr, secret } }, error: null })
    const response = await handleMfaAction('mfa-enroll', new URLSearchParams(), f.client)
    if (extra) await expectFailure(response, 503, 'unavailable')
    else expect(await response.json()).toEqual(body)
  })
})

describe('mutation-time token continuity', () => {
  it.each(['mfa-enroll', 'mfa-verify'])('rejects changed tokens immediately before %s', async (action) => {
    const f = fixture(action === 'mfa-enroll' ? 'none' : 'verified')
    const original = f.auth.getSession.getMockImplementation()!
    let reads = 0
    f.auth.getSession.mockImplementation(async () => {
      const session = await original()
      if (++reads > 2) session.data.session.access_token += '.changed'
      return session
    })
    const response = await handleMfaAction(action, action === 'mfa-enroll' ? new URLSearchParams() : verifyForm(), f.client)
    await expectFailure(response, 401, 'unauthorised')
    expect(f.auth.mfa.enroll).not.toHaveBeenCalled()
    expect(f.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
  })
})

describe('own-factor verification and fixed continuations', () => {
  it.each([['workspace', '/workspace'], ['setup', '/login?setup=1'], ['security', '/workspace/security']])('returns only %s continuation after verified live TOTP upgrade', async (continuation, next) => {
    const f = fixture('verified')
    const response = await handleMfaAction('mfa-verify', verifyForm({ continuation }), f.client)
    expect(await response.json()).toEqual({ ok: true, next })
    expect(f.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: fid, code: '012345' })
    expect(f.auth.getUser).toHaveBeenCalledTimes(2)
    expect(f.auth.getUser.mock.calls[0][0]).not.toBe(f.auth.getUser.mock.calls[1][0])
  })
  it('verifies a pending factor only through explicit security continuation', async () => {
    const f = fixture('pending')
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm(), f.client), 403, 'unauthorised')
    expect(f.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
    const response = await handleMfaAction('mfa-verify', verifyForm({ continuation: 'security' }), f.client)
    expect(await response.json()).toEqual({ ok: true, next: '/workspace/security' })
  })
  it('never trusts foreign factorId or unsupported-factor login', async () => {
    const f = fixture('verified')
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm({ factorId: foreign }), f.client), 403, 'unauthorised')
    expect(f.auth.mfa.challengeAndVerify).not.toHaveBeenCalled()
    const phone = fixture('phone')
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm(), phone.client), 403, 'unsupported_factor')
  })
  it('does not claim success from provider result alone without upgraded live session', async () => {
    const f = fixture('verified')
    f.auth.mfa.challengeAndVerify.mockResolvedValue({ data: { access_token: 'private-token' }, error: null })
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm(), f.client), 503, 'unavailable')
  })
  it.each([
    [400, 'mfa_verification_failed', 400, 'invalid_code'], [400, 'mfa_challenge_expired', 400, 'invalid_code'],
    [403, 'mfa_verification_rejected', 400, 'invalid_code'], [429, 'over_request_rate_limit', 429, 'rate_limited'],
    [503, 'private', 503, 'unavailable'], [401, 'session_not_found', 401, 'unauthorised'],
  ])('redacts provider %s/%s into %s/%s', async (status, code, expectedStatus, expectedError) => {
    const f = fixture('verified')
    f.auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status, code, message: 'secret provider detail' } })
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm(), f.client), Number(expectedStatus), String(expectedError))
  })
})

describe('strict action forms and zero secret logging', () => {
  it.each(['1', '12345', '1234567', '１２３４５６', '123 45', ' 123456'])('rejects malformed code %s before context or mutation', async (code) => {
    const f = fixture('verified')
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm({ code }), f.client), 400, 'invalid_request')
    expect(f.auth.getSession).not.toHaveBeenCalled()
  })
  it.each(['userId', 'aal', 'role', 'next', 'challengeId'])('rejects browser authority field %s', async (field) => {
    const f = fixture('verified')
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm({ [field]: 'forged' }), f.client), 400, 'invalid_request')
  })
  it('rejects unknown/duplicate fields, invalid factor ID and arbitrary continuation', async () => {
    const f = fixture('verified')
    for (const form of [new URLSearchParams(), verifyForm({ factorId: 'invalid' }), verifyForm({ continuation: '//evil.test' })]) {
      await expectFailure(await handleMfaAction('mfa-verify', form, f.client), 400, 'invalid_request')
    }
    const duplicate = verifyForm(); duplicate.append('code', '012345')
    await expectFailure(await handleMfaAction('mfa-verify', duplicate, f.client), 400, 'invalid_request')
    await expectFailure(await handleMfaAction('mfa-enroll', new URLSearchParams({ factorType: 'phone' }), f.client), 400, 'invalid_request')
    await expectFailure(await handleMfaAction('mfa-delete', new URLSearchParams(), f.client), 404, 'invalid_request')
  })
  it('never logs seeds, codes, tokens or caught provider exceptions', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    const f = fixture('verified')
    f.auth.mfa.challengeAndVerify.mockRejectedValue(new Error('private-provider-credential'))
    await expectFailure(await handleMfaAction('mfa-verify', verifyForm(), f.client), 503, 'unavailable')
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })
})
