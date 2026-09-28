import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
import { hasCurrentTotp, hasRequiredMfa, isMfaContextCurrent, readMfaContext, requireRecentTotp, toMfaView } from './mfa'

const now = 1_800_000_000
const uid = '10000000-0000-4000-8000-000000000001'
const sid = '20000000-0000-4000-8000-000000000001'
const fid = '30000000-0000-4000-8000-000000000001'
const factor = (status = 'verified', factor_type = 'totp') => ({ id: fid, status, factor_type })
const status = (values = {}) => ({ active: true, requires_mfa: false, session_aal: 'aal1', session_is_mfa: false, session_is_totp: false, ...values })
function token(claims: Record<string, unknown> = {}) {
  return [Buffer.from('{"alg":"ES256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, session_id: sid, exp: now + 600, aal: 'aal1', ...claims })).toString('base64url'), 'verified-by-mocked-provider'].join('.')
}
function fixture(claims: Record<string, unknown> = {}, factors: unknown = [], database = status()) {
  const accessToken = token(claims)
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: accessToken, user: { factors: [factor()], aal: 'aal2' } } }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: uid, email: 'fixture@example.test', factors, user_metadata: { aal: 'aal2' }, app_metadata: { aal: 'aal2' } } }, error: null }),
  }
  const rpc = vi.fn().mockResolvedValue({ data: database, error: null })
  return { auth, rpc, accessToken, client: { auth, rpc } as unknown as SupabaseClient }
}
const enrolled = (claims: Record<string, unknown> = {}, database = {}) => fixture({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now }], ...claims }, [factor()], status({ requires_mfa: true, session_aal: 'aal2', session_is_mfa: true, session_is_totp: true, ...database }))

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now * 1000) })

describe('exact-token live MFA context', () => {
  it('preserves unenrolled ordinary access without trusting cached user, metadata or AAL', async () => {
    const f = fixture()
    const context = (await readMfaContext(f.client))!
    expect(hasRequiredMfa(context)).toBe(true)
    expect(toMfaView(context)).toEqual({ state: 'unenrolled', factors: [], hasPendingTotp: false })
    expect(requireRecentTotp(context, now)).toEqual({ allowed: false, reason: 'mfa_required' })
    expect(f.auth.getUser).toHaveBeenCalledWith(f.accessToken)
    expect(f.rpc).toHaveBeenCalledWith('bx1_mfa_status')
    expect(f.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[0])
    expect(JSON.stringify(context)).toBe('{}')
  })
  it('retains a pending TOTP without making ordinary login require MFA', async () => {
    const context = (await readMfaContext(fixture({}, [factor('unverified')]).client))!
    expect(toMfaView(context)).toEqual({ state: 'unenrolled', factors: [{ id: fid, status: 'unverified', factorType: 'totp' }], hasPendingTotp: true })
    expect(hasRequiredMfa(context)).toBe(true)
  })
  it('requires challenge for enrolled AAL1, including after the live session upgrades', async () => {
    const context = (await readMfaContext(enrolled({ aal: 'aal1' }).client))!
    expect(hasRequiredMfa(context)).toBe(false)
    expect(toMfaView(context).state).toBe('challenge_required')
  })
  it('accepts verified AAL2 only with a current live verified factor', async () => {
    const context = (await readMfaContext(enrolled().client))!
    expect(hasRequiredMfa(context)).toBe(true)
    expect(toMfaView(context).state).toBe('verified')
    const removedUsedFactor = (await readMfaContext(enrolled({}, { session_is_mfa: false, session_is_totp: false }).client))!
    expect(hasRequiredMfa(removedUsedFactor)).toBe(false)
  })
  it('does not downgrade unsupported verified factors to unenrolled', async () => {
    const f = fixture({}, [factor('verified', 'phone')], status({ requires_mfa: true }))
    const context = (await readMfaContext(f.client))!
    expect(toMfaView(context).state).toBe('unsupported_factor')
    expect(hasRequiredMfa(context)).toBe(false)
  })
  it('allows ordinary access after last verified factor removal but never recent assurance', async () => {
    const context = (await readMfaContext(fixture({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now }] }, [], status({ session_aal: 'aal2' })).client))!
    expect(hasRequiredMfa(context)).toBe(true)
    expect(requireRecentTotp(context, now).allowed).toBe(false)
  })
  it('returns null for missing identity, invalid provider identity and inactive bootstrap', async () => {
    const missing = fixture()
    missing.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await readMfaContext(missing.client)).toBeNull()
    expect(missing.auth.getUser).not.toHaveBeenCalled()
    const invalid = fixture()
    invalid.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    expect(await readMfaContext(invalid.client)).toBeNull()
    expect(invalid.rpc).not.toHaveBeenCalled()
    expect(await readMfaContext(fixture({}, [], status({ active: false, session_aal: null })).client)).toBeNull()
  })
  it.each([
    { sub: 'other' }, { session_id: undefined }, { session_id: 'not-uuid' },
    { session_id: '00000000-0000-0000-0000-000000000000' }, { exp: now }, { exp: now + 0.5 },
    { aal: undefined }, { aal: 'aal3' }, { amr: 'totp' }, { amr: Array(33).fill('totp') },
  ])('denies malformed/expired claims %j', async (claims) => {
    const f = fixture(claims)
    expect(await readMfaContext(f.client)).toBeNull()
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('never parses unverified token claims after provider failure', async () => {
    const f = fixture()
    f.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'bad.provider.token' } }, error: null })
    f.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    expect(await readMfaContext(f.client)).toBeNull()
    expect(f.auth.getUser).toHaveBeenCalledWith('bad.provider.token')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('fails closed if the token changes during provider/RPC reads', async () => {
    const f = fixture()
    f.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: f.accessToken } }, error: null })
      .mockResolvedValueOnce({ data: { session: { access_token: token({ exp: now + 601 }) } }, error: null })
    await expect(readMfaContext(f.client)).rejects.toThrow('Access is temporarily unavailable.')
  })
  it.each([
    null, [], {}, status({ extra: true }), status({ active: 'yes' }), status({ session_aal: 'aal3' }),
    status({ session_is_mfa: true }), status({ session_is_totp: true }),
    status({ active: false, requires_mfa: true, session_aal: null }),
  ])('rejects malformed or contradictory database status %j', async (data) => {
    await expect(readMfaContext(fixture({}, [], data as never).client)).rejects.toThrow('Access is temporarily unavailable.')
  })
  it('rejects provider/database factor contradictions in either direction', async () => {
    await expect(readMfaContext(fixture({}, [factor()]).client)).rejects.toThrow('Access is temporarily unavailable.')
    await expect(readMfaContext(fixture({}, [], status({ requires_mfa: true })).client)).rejects.toThrow('Access is temporarily unavailable.')
  })
  it('maps provider/RPC failures to generic unavailable without raw detail', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ data: null, error: { message: 'private sql detail' } })
    await expect(readMfaContext(f.client)).rejects.toThrow('Access is temporarily unavailable.')
    f.auth.getUser.mockRejectedValue(new Error('private provider detail'))
    await expect(readMfaContext(f.client)).rejects.toThrow('Access is temporarily unavailable.')
  })
  it('does not permit manufactured contexts or client view mutation', async () => {
    expect(hasRequiredMfa({} as never)).toBe(false)
    expect(requireRecentTotp({} as never, now)).toEqual({ allowed: false, reason: 'mfa_required' })
    const context = (await readMfaContext(enrolled().client))!
    toMfaView(context).factors.length = 0
    expect(toMfaView(context).factors).toHaveLength(1)
  })
  it('binds later resource reads to the same exact token and expiry without exposing it', async () => {
    const f = fixture()
    const context = (await readMfaContext(f.client))!
    expect(await isMfaContextCurrent(f.client, context)).toBe(true)
    f.auth.getSession.mockResolvedValue({ data: { session: { access_token: token({ exp: now + 601 }) } }, error: null })
    expect(await isMfaContextCurrent(f.client, context)).toBe(false)
    expect(await isMfaContextCurrent(f.client, {} as never)).toBe(false)
    f.auth.getSession.mockResolvedValue({ data: { session: { access_token: f.accessToken } }, error: null })
    vi.spyOn(Date, 'now').mockReturnValue((now + 600) * 1000)
    expect(await isMfaContextCurrent(f.client, context)).toBe(false)
  })
})

describe('recent TOTP session assurance, never a business capability', () => {
  it('separates current TOTP reads from command recency without weakening ordinary login', async () => {
    const current = (await readMfaContext(enrolled({ amr: [{ method: 'totp', timestamp: now - 301 }] }).client))!
    expect(hasCurrentTotp(current)).toBe(true)
    expect(requireRecentTotp(current, now)).toEqual({ allowed: false, reason: 'step_up_required' })
    const ordinary = (await readMfaContext(fixture().client))!
    expect(hasRequiredMfa(ordinary)).toBe(true)
    expect(hasCurrentTotp(ordinary)).toBe(false)
    const phone = (await readMfaContext(fixture({ aal: 'aal2' }, [factor('verified', 'phone')], status({ requires_mfa: true, session_aal: 'aal2', session_is_mfa: true })).client))!
    expect(hasRequiredMfa(phone)).toBe(true)
    expect(hasCurrentTotp(phone)).toBe(false)
    expect(hasCurrentTotp({} as never)).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue((now + 600) * 1000)
    expect(hasCurrentTotp(current)).toBe(false)
  })
  it.each([0, 300])('accepts trusted current TOTP age %s seconds', async (age) => {
    const context = (await readMfaContext(enrolled({ amr: [{ method: 'totp', timestamp: now - age }] }).client))!
    expect(requireRecentTotp(context, now)).toEqual({ allowed: true })
  })
  it.each([
    { amr: [{ method: 'totp', timestamp: now - 301 }] }, { amr: [{ method: 'totp', timestamp: now + 1 }] },
    { amr: [{ method: 'totp', timestamp: now + 0.5 }] }, { amr: [{ method: 'totp' }] },
    { amr: [{ method: 'password', timestamp: now }] }, { amr: [{ method: 'recovery', timestamp: now }] }, { amr: ['totp'] }, { amr: [] },
  ])('denies missing/nonTOTP/stale/future/malformed recency %j', async ({ amr }) => {
    const context = await readMfaContext(enrolled({ amr, iat: now }).client)
    expect(context === null || !requireRecentTotp(context, now).allowed).toBe(true)
  })
  it('rejects expired contexts and noninteger now after context resolution', async () => {
    const context = (await readMfaContext(enrolled().client))!
    expect(requireRecentTotp(context, now + 600).allowed).toBe(false)
    expect(requireRecentTotp(context, now + 0.5).allowed).toBe(false)
  })
})
