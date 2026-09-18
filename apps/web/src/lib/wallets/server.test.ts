import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Wallet } from 'ethers'
import type { CookieAdapter } from '@/lib/supabase/server'
import type { WalletActor, WalletChallenge, WalletErrorCode } from './contracts'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), workspace: vi.fn(), configured: vi.fn(), database: vi.fn() }))
vi.mock('@/lib/supabase/server', async (original) => ({
  ...await original<typeof import('@/lib/supabase/server')>(),
  createRequestSupabaseClient: mocks.createClient,
  readWorkspace: mocks.workspace,
}))
vi.mock('./database', () => ({
  getWalletDatabase: mocks.database,
  isWalletDatabaseConfigured: mocks.configured,
  WalletDatabaseError: class extends Error {
    constructor(public code: WalletErrorCode) { super('Private database detail must never escape') }
  },
}))
import { handleWalletRequest } from './server'
import { WalletDatabaseError } from './database'
import * as policy from '@/lib/authorization/policy'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import * as route from '@/app/api/wallet/[action]/route'

const actor: WalletActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  platformUserId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  organisationId: '44444444-4444-4444-8444-444444444444',
}
const challengeId = '55555555-5555-4555-8555-555555555555'
const otherId = '66666666-6666-4666-8666-666666666666'
const signer = Wallet.createRandom() // Ephemeral fixture; no real account or stored key.
const stranger = Wallet.createRandom()
function accessToken(claims: Record<string, unknown> = {}) {
  return ['eyJhbGciOiJFUzI1NiJ9', Buffer.from(JSON.stringify({ sub: actor.userId, session_id: actor.sessionId, exp: Math.floor(Date.now() / 1000) + 300, ...claims })).toString('base64url'), 'fixture'].join('.')
}
let token: string
let challenge: WalletChallenge
let client: { auth: { getSession: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn> } }
let db: { issueChallenge: ReturnType<typeof vi.fn>; readChallenge: ReturnType<typeof vi.fn>; consumeChallenge: ReturnType<typeof vi.fn> }
let cookieAdapter: CookieAdapter

function request(action = 'challenge', fields: Record<string, string> = {}, overrides: { method?: string; origin?: string | null; host?: string | null; contentType?: string; raw?: string; url?: string } = {}) {
  const method = overrides.method ?? 'POST'
  const headers = new Headers({ 'content-type': overrides.contentType ?? 'application/x-www-form-urlencoded' })
  if (overrides.origin !== null) headers.set('origin', overrides.origin ?? 'https://bx1.co.za')
  if (overrides.host !== null) headers.set('host', overrides.host ?? 'bx1.co.za')
  const defaults: Record<string, string> = action === 'challenge'
    ? { organisationId: actor.organisationId, address: signer.address.toLowerCase(), chainId: '80002' }
    : { organisationId: actor.organisationId, challengeId, signature: 'invalid' }
  const body = method === 'GET' || method === 'HEAD' ? undefined : overrides.raw ?? new URLSearchParams({ ...defaults, ...fields }).toString()
  return new NextRequest(overrides.url ?? `https://bx1.co.za/api/wallet/${action}`, { method, headers, body })
}
async function dispatch(action = 'challenge', fields: Record<string, string> = {}, overrides: Parameters<typeof request>[2] = {}) {
  return handleWalletRequest(request(action, fields, overrides), { params: Promise.resolve({ action }) })
}
function assertPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toContain('private')
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}
async function assertError(response: Response, status: number, error: WalletErrorCode) {
  expect(response.status).toBe(status)
  assertPrivate(response)
  expect(await response.json()).toEqual({ ok: false, error })
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  token = accessToken()
  const issued = Date.now()
  challenge = { challengeId, address: signer.address.toLowerCase(), chainId: 80002, domain: 'https://bx1.co.za', message: 'Link this wallet to BlockXOne. This is not a transaction or financial approval.\nFixture bound to actor, tenant, session, domain and nonce.', issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 300000).toISOString() }
  client = { auth: {
    getSession: vi.fn(async () => ({ data: { session: { access_token: token } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: actor.userId, email: 'fixture@example.test', user_metadata: { platformUserId: otherId, role: 'SuperAdmin' } } }, error: null })),
  } }
  db = {
    issueChallenge: vi.fn(async () => challenge),
    readChallenge: vi.fn(async () => challenge),
    consumeChallenge: vi.fn(async () => ({ id: otherId, organisationId: actor.organisationId, address: challenge.address, chainId: 80002, verifiedAt: new Date().toISOString(), status: 'PENDING' })),
  }
  mocks.configured.mockReturnValue(true)
  mocks.database.mockReturnValue(db)
  mocks.createClient.mockImplementation((adapter: CookieAdapter) => { cookieAdapter = adapter; return client })
  mocks.workspace.mockResolvedValue({ user: { id: actor.userId, platformUserId: actor.platformUserId, email: 'fixture@example.test', displayName: null }, organisations: [{ id: actor.organisationId, name: 'Fixture', roles: ['Investor'] }] })
})

describe('wallet identity boundary', () => {
  describe.each(BX1_ROLES)('%s scoped personal ownership', (role) => {
    it.each(['challenge', 'verify'])('allows real-policy %s only for the verified actor and assigned organisation', async (action) => {
      mocks.workspace.mockResolvedValue({ user: { id: actor.userId, platformUserId: actor.platformUserId, email: 'fixture@example.test', displayName: null }, organisations: [{ id: actor.organisationId, name: 'Fixture', roles: [role] }] })
      const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
      const response = await dispatch(action, fields)
      expect(response.status).toBe(action === 'challenge' ? 201 : 200)
      assertPrivate(response)
      if (action === 'challenge') expect(db.issueChallenge).toHaveBeenCalledWith(actor, challenge.address, 80002, expect.any(String))
      else {
        expect(db.consumeChallenge).toHaveBeenCalledWith(actor, challengeId, challenge.message, fields.signature)
        expect((await response.json()).wallet.status).toBe('PENDING')
      }
    })
    it.each(['challenge', 'verify'])('denies a same-organisation foreign actor for %s before adapter acquisition', async (action) => {
      mocks.workspace.mockResolvedValue({ user: { id: otherId, platformUserId: actor.platformUserId, email: 'other@example.test', displayName: null }, organisations: [{ id: actor.organisationId, name: 'Fixture', roles: [role] }] })
      const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
      await assertError(await dispatch(action, fields), 403, 'unauthorised')
      expect(mocks.database).not.toHaveBeenCalled()
      expect(db.issueChallenge).not.toHaveBeenCalled()
      expect(db.readChallenge).not.toHaveBeenCalled()
      expect(db.consumeChallenge).not.toHaveBeenCalled()
    })
    it.each(['challenge', 'verify'])('cannot borrow the role from another organisation for %s', async (action) => {
      mocks.workspace.mockResolvedValue({ user: { id: actor.userId, platformUserId: actor.platformUserId, email: 'fixture@example.test', displayName: null }, organisations: [{ id: otherId, name: 'Other organisation', roles: [role] }] })
      const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
      await assertError(await dispatch(action, fields), 403, 'unauthorised')
      expect(mocks.database).not.toHaveBeenCalled()
    })
  })
  describe.each(['challenge', 'verify'])('%s real-policy malformed role denial', (action) => {
    it.each([{ roles: [] }, { roles: ['Root'] }, { roles: ['Investor', 'Root'] }])('denies roles $roles despite forged metadata before any adapter work', async ({ roles }) => {
      mocks.workspace.mockResolvedValue({ user: { id: actor.userId, platformUserId: actor.platformUserId, email: 'fixture@example.test', displayName: null }, organisations: [{ id: actor.organisationId, name: 'Fixture', roles }] })
      client.auth.getUser.mockResolvedValue({ data: { user: { id: actor.userId, user_metadata: { roles: [...BX1_ROLES] }, app_metadata: { roles: [...BX1_ROLES] } } }, error: null })
      const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
      await assertError(await dispatch(action, fields), 403, 'unauthorised')
      expect(mocks.database).not.toHaveBeenCalled()
      expect(db.issueChallenge).not.toHaveBeenCalled()
      expect(db.readChallenge).not.toHaveBeenCalled()
      expect(db.consumeChallenge).not.toHaveBeenCalled()
    })
  })
  it.each(['challenge', 'verify'])('checks the real %s policy after verified identity and before adapter acquisition', async (action) => {
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission')
    const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
    const response = await dispatch(action, fields)
    expect(response.status).toBe(action === 'challenge' ? 201 : 200)
    assertPrivate(response)
    expect(evaluate).toHaveBeenCalledWith(await mocks.workspace.mock.results[0].value, `wallet.ownership.${action}`, { userId: actor.userId, organisationId: actor.organisationId })
    expect(client.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(evaluate.mock.invocationCallOrder[0])
    expect(mocks.workspace.mock.invocationCallOrder[0]).toBeLessThan(evaluate.mock.invocationCallOrder[0])
    expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(mocks.database.mock.invocationCallOrder[0])
  })
  it.each(['challenge', 'verify'])('denied %s policy acquires no adapter and performs no issue/read/consume', async (action) => {
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission').mockReturnValue({ allowed: false, reason: 'invalid_scope' })
    const fields: Record<string, string> = action === 'verify' ? { signature: await signer.signMessage(challenge.message) } : {}
    const response = await dispatch(action, fields)
    await assertError(response, 403, 'unauthorised')
    expect(evaluate).toHaveBeenCalledWith(expect.any(Object), `wallet.ownership.${action}`, { userId: actor.userId, organisationId: actor.organisationId })
    expect(mocks.database).not.toHaveBeenCalled()
    expect(db.issueChallenge).not.toHaveBeenCalled()
    expect(db.readChallenge).not.toHaveBeenCalled()
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it('uses exactly the server retrieved token with getUser before deriving claims and immutable actor', async () => {
    const response = await dispatch()
    expect(response.status).toBe(201)
    assertPrivate(response)
    expect(client.auth.getUser).toHaveBeenCalledWith(token)
    expect(client.auth.getSession.mock.invocationCallOrder[0]).toBeLessThan(client.auth.getUser.mock.invocationCallOrder[0])
    expect(client.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.workspace.mock.invocationCallOrder[0])
    expect(db.issueChallenge).toHaveBeenCalledWith(actor, signer.address.toLowerCase(), 80002, expect.stringMatching(/^[a-f0-9]{64}$/))
    expect(await response.json()).toEqual({ ok: true, challenge })
  })
  it('generates a fresh cryptographic nonce for each issue', async () => {
    await dispatch(); await dispatch()
    expect(db.issueChallenge.mock.calls[0][3]).not.toBe(db.issueChallenge.mock.calls[1][3])
  })
  it.each([
    ['missing subject', { sub: null }], ['different subject', { sub: otherId }],
    ['missing session', { session_id: null }], ['invalid session', { session_id: 'forged' }],
    ['expired', { exp: 1 }], ['invalid expiry', { exp: '99999999999' }],
    ['fractional expiry', { exp: 9999999999.5 }],
  ])('denies %s even if getUser returns a user', async (_name, claims) => {
    token = accessToken(claims)
    await assertError(await dispatch(), 401, 'unauthorised')
    expect(db.issueChallenge).not.toHaveBeenCalled()
  })
  it.each(['malformed', 'a.%%%%.c', 'a.W10.c'])('denies malformed verified-token shape %s', async (value) => {
    token = value
    await assertError(await dispatch(), 401, 'unauthorised')
    expect(client.auth.getUser).toHaveBeenCalledWith(value)
    expect(db.issueChallenge).not.toHaveBeenCalled()
  })
  it('does not parse or authorize a rejected exact token', async () => {
    token = 'not-even-a-jwt'
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    await assertError(await dispatch(), 401, 'unauthorised')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('denies missing session before verifier invocation', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await assertError(await dispatch(), 401, 'unauthorised')
    expect(client.auth.getUser).not.toHaveBeenCalled()
  })
  it.each([null, { user: { id: otherId, platformUserId: actor.platformUserId }, organisations: [{ id: actor.organisationId }] }, { user: { id: actor.userId, platformUserId: otherId }, organisations: [{ id: otherId }] }])('denies missing or cross-identity/tenant workspace', async (workspace) => {
    mocks.workspace.mockResolvedValue(workspace)
    await assertError(await dispatch(), 403, 'unauthorised')
    expect(db.issueChallenge).not.toHaveBeenCalled()
  })
  it('denies changed session token during workspace verification', async () => {
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: token } }, error: null }).mockResolvedValue({ data: { session: { access_token: accessToken({ session_id: otherId }) } }, error: null })
    await assertError(await dispatch(), 401, 'unauthorised')
    expect(db.issueChallenge).not.toHaveBeenCalled()
  })
  it.each([429, 500, 503])('maps provider failure %i to generic unavailability', async (status) => {
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status, message: 'secret token or provider internals' } })
    await assertError(await dispatch(), 503, 'unavailable')
  })
})

describe('wallet HTTP containment', () => {
  it.each([null, 'null', 'https://evil.test', 'https://bx1.co.za.evil.test'])('rejects missing or bad Origin %s before client creation', async (origin) => {
    await assertError(await dispatch('challenge', {}, { origin }), 403, 'invalid_request')
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each([null, 'evil.test', 'bx1.co.za:443'])('rejects unexpected Host %s', async (host) => {
    await assertError(await dispatch('challenge', {}, { host }), 403, 'invalid_request')
  })
  it('rejects a foreign request URL despite forged canonical headers', async () => {
    await assertError(await dispatch('challenge', {}, { url: 'https://evil.test/api/wallet/challenge' }), 403, 'invalid_request')
  })
  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('returns private 405 for %s', async (method) => {
    const response = await dispatch('challenge', {}, { method })
    expect(response.headers.get('allow')).toBe('POST')
    await assertError(response, 405, 'invalid_request')
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it('has no public finalize/read endpoint', async () => {
    for (const action of ['finalize', 'read', 'approve']) await assertError(await dispatch(action), 404, 'invalid_request')
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each(['verified', 'status', 'actor', 'sessionId', 'userId', 'domain', 'message', 'role', 'roles', 'user_metadata', 'app_metadata', 'mandate', 'approved'])('rejects browser-selected %s', async (key) => {
    await assertError(await dispatch('challenge', { [key]: 'forged' }), 400, 'invalid_request')
    expect(db.issueChallenge).not.toHaveBeenCalled()
  })
  it('rejects duplicate fields and non-form bodies', async () => {
    await assertError(await dispatch('challenge', {}, { raw: `organisationId=${actor.organisationId}&organisationId=${otherId}` }), 400, 'invalid_request')
    await assertError(await dispatch('challenge', {}, { contentType: 'application/json', raw: '{}' }), 400, 'invalid_request')
  })
  it('rejects streamed bodies above 8 KiB without Content-Length', async () => {
    const chunks = [new TextEncoder().encode('x='.padEnd(4096, 'x')), new TextEncoder().encode('x'.repeat(4097))]
    const stream = new ReadableStream({ pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close() } })
    const req = new NextRequest('https://bx1.co.za/api/wallet/challenge', { method: 'POST', headers: { origin: 'https://bx1.co.za', host: 'bx1.co.za', 'content-type': 'application/x-www-form-urlencoded' }, body: stream, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1])
    await assertError(await handleWalletRequest(req, { params: Promise.resolve({ action: 'challenge' }) }), 400, 'invalid_request')
    expect(mocks.createClient).not.toHaveBeenCalled()
  })
  it.each(['0', '1', '137', '0x13882', '80002.0'])('rejects unconfigured/noncanonical chain %s', async (chainId) => {
    await assertError(await dispatch('challenge', { chainId }), 400, 'invalid_request')
  })
  it.each(['', 'alice.eth', '0x0000000000000000000000000000000000000000', '0x1234'])('rejects non-EOA address input %s', async (address) => {
    await assertError(await dispatch('challenge', { address }), 400, 'invalid_request')
  })
  it('fails closed without writer config while leaving secrets out of the response', async () => {
    mocks.configured.mockReturnValue(false)
    await assertError(await dispatch(), 503, 'unavailable')
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each(['', 'legacy'])('does not bypass the selected Auth mode %s', async (mode) => {
    vi.stubEnv('BLOCKXONE_AUTH_MODE', mode)
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', mode)
    const response = await dispatch()
    expect([404, 503]).toContain(response.status)
    assertPrivate(response)
    expect(mocks.database).not.toHaveBeenCalled()
  })
  it.each(['success', 'database', 'identity'])('preserves all refreshed HttpOnly cookies and private headers on %s', async (path) => {
    client.auth.getSession.mockImplementation(async () => {
      cookieAdapter.setAll([{ name: 'session.0', value: 'fixture-a', options: { domain: 'evil.test', httpOnly: false } }, { name: 'session.1', value: '', options: { maxAge: 0 } }], { 'Cache-Control': 'public', 'X-Fixture-Refresh': 'done' })
      return { data: { session: { access_token: token } }, error: null }
    })
    if (path === 'database') db.issueChallenge.mockRejectedValue(new Error('private connection string'))
    if (path === 'identity') client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    const response = await dispatch()
    expect(response.status).toBe(path === 'success' ? 201 : path === 'identity' ? 401 : 503)
    assertPrivate(response)
    expect(response.headers.get('x-fixture-refresh')).toBe('done')
    expect(response.cookies.getAll().map((cookie) => cookie.name)).toEqual(['session.0', 'session.1'])
    const cookies = response.headers.get('set-cookie')!
    expect(cookies).toContain('HttpOnly')
    expect(cookies).toContain('Secure')
    expect(cookies).toContain('SameSite=lax')
    expect(cookies).not.toContain('Domain=')
    expect(await response.text()).not.toContain('private connection string')
  })
})

describe('exact stored EIP-191 proof', () => {
  it('recovers a real ephemeral signature and consumes only the persisted message with verified actor', async () => {
    const signature = await signer.signMessage(challenge.message)
    const response = await dispatch('verify', { signature })
    expect(response.status).toBe(200)
    assertPrivate(response)
    expect(db.readChallenge).toHaveBeenCalledWith(actor, challengeId)
    expect(db.consumeChallenge).toHaveBeenCalledWith(actor, challengeId, challenge.message, signature)
    expect((await response.json()).wallet.status).toBe('PENDING')
  })
  it('rejects a valid signature by another wallet', async () => {
    await assertError(await dispatch('verify', { signature: await stranger.signMessage(challenge.message) }), 400, 'invalid_signature')
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it('rejects altered message and replacement-message request fields', async () => {
    const signature = await signer.signMessage(challenge.message + '\nApprove everything')
    await assertError(await dispatch('verify', { signature }), 400, 'invalid_signature')
    await assertError(await dispatch('verify', { signature, message: challenge.message + '\nApprove everything' }), 400, 'invalid_request')
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it.each(['', '0x', '0x' + '11'.repeat(64), '0x' + '00'.repeat(65), '0x' + '11'.repeat(65), '0x' + '11'.repeat(64) + '00'])('rejects malformed or noncanonical signature encoding', async (signature) => {
    await assertError(await dispatch('verify', { signature }), 400, 'invalid_signature')
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it('rejects high-s ECDSA malleability even with flipped recovery', async () => {
    const signature = await signer.signMessage(challenge.message)
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    const highS = (n - BigInt('0x' + signature.slice(66, 130))).toString(16).padStart(64, '0')
    const recovery = signature.slice(130) === '1b' ? '1c' : '1b'
    await assertError(await dispatch('verify', { signature: signature.slice(0, 66) + highS + recovery }), 400, 'invalid_signature')
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it.each([
    ['domain', 'https://evil.test'], ['chainId', 137], ['challengeId', otherId],
    ['address', stranger.address], ['expiresAt', new Date(0).toISOString()],
  ])('rejects altered challenge %s', async (key, value) => {
    const signature = await signer.signMessage(challenge.message)
    challenge = { ...challenge, [key]: value }
    const response = await dispatch('verify', { signature })
    expect(response.status).toBe(key === 'expiresAt' ? 410 : 400)
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it.each([
    ['unauthorised', 403], ['expired', 410], ['conflict', 409], ['rate_limited', 429], ['unavailable', 503], ['invalid_request', 400],
  ] as const)('preserves final SQL %s denial after HTTP verification', async (code, status) => {
    db.consumeChallenge.mockRejectedValue(new WalletDatabaseError(code))
    await assertError(await dispatch('verify', { signature: await signer.signMessage(challenge.message) }), status, code)
    expect(db.consumeChallenge).toHaveBeenCalledOnce()
  })
  it('passes the new server-verified session to read, never an old challenge-selected session', async () => {
    token = accessToken({ session_id: otherId })
    db.readChallenge.mockRejectedValue(new WalletDatabaseError('unauthorised'))
    await assertError(await dispatch('verify', { signature: await signer.signMessage(challenge.message) }), 403, 'unauthorised')
    expect(db.readChallenge).toHaveBeenCalledWith({ ...actor, sessionId: otherId }, challengeId)
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it('does not log signature, token, SQL or provider exceptions', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    db.consumeChallenge.mockRejectedValue(new Error('credential and signature detail'))
    await assertError(await dispatch('verify', { signature: await signer.signMessage(challenge.message) }), 503, 'unavailable')
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })
  it('rejects access-token expiry crossed while reading the persisted challenge', async () => {
    const started = Date.now()
    token = accessToken({ exp: Math.floor(started / 1000) + 1 })
    db.readChallenge.mockImplementation(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(started + 2000)
      return challenge
    })
    await assertError(await dispatch('verify', { signature: await signer.signMessage(challenge.message) }), 401, 'unauthorised')
    expect(db.consumeChallenge).not.toHaveBeenCalled()
  })
  it('projects only safe challenge/wallet fields if a future adapter returns additional evidence', async () => {
    db.issueChallenge.mockResolvedValue({ ...challenge, signature: 'private-proof', sessionId: actor.sessionId })
    const issued = await dispatch()
    expect(await issued.json()).toEqual({ ok: true, challenge })
    db.consumeChallenge.mockResolvedValue({ id: otherId, organisationId: actor.organisationId, address: challenge.address, chainId: 80002, verifiedAt: challenge.issuedAt, status: 'PENDING', signature: 'private-proof', secret: 'private-evidence' })
    const verified = await dispatch('verify', { signature: await signer.signMessage(challenge.message) })
    const result = await verified.json()
    expect(Object.keys(result.wallet).sort()).toEqual(['address', 'chainId', 'id', 'organisationId', 'status', 'verifiedAt'])
  })
})

describe('minimal Node route boundary', () => {
  it('exports only a Node dynamic wrapper for every supported HTTP method', async () => {
    expect(route.runtime).toBe('nodejs')
    expect(route.dynamic).toBe('force-dynamic')
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) expect(route[method]).toBe(handleWalletRequest)
    expect((await route.POST(request(), { params: Promise.resolve({ action: 'challenge' }) })).status).toBe(201)
  })
  it('has no privileged key, legacy API, transaction or public finalization path', () => {
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/SUPABASE_SERVICE|service_role|signInWithWeb3|signInWithPassword|api-client|eth_sendTransaction|eth_sign|\.rpc\(/)
    expect(source).toContain('verifyMessage(')
    expect(source).toContain('getUser(accessToken)')
    const sourceRoute = readFileSync(new URL('../../app/api/wallet/[action]/route.ts', import.meta.url), 'utf8')
    expect(sourceRoute).not.toMatch(/\bfetch\(|\.rpc\(/)
  })
})
