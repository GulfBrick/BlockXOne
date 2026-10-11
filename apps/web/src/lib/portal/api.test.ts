import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
import { POST } from '@/app/api/portal/command/route'
import { readPortalBody } from './http'
import { PortalError } from './server'
import { APPLICANT_CONTEXT } from './operating-context'

const origin = 'https://block-x-one-portal-test.vercel.app'
const actor = 'd22789ee-7f73-4acf-a414-3de0b62ea801'
const organisation = '33333333-3333-4333-8333-333333333333'
const operatingContext = { mode: 'ROLE' as const, organisationId: organisation, role: 'Investor' as const }
const snapshot = { actor: { id: actor, email: 'test@example.test', display_name: null, can_review: false }, operating_context: operatingContext, applications: [], organisations: [], products: [], subscriptions: [], events: [] }
const command = { command: 'cancel_subscription', key: '113800c3-cf6e-437e-abdf-a3b09a03fcff', payload: { subscription_id: actor } }
const instruction = { ...command, operating_context: operatingContext }
const forgedHeaders: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }]
function request(body: unknown = instruction, headers: Record<string, string> = {}) { return new NextRequest(`${origin}/api/portal/command`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled'); vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockReturnValue({ rpc: mocks.rpc })
  mocks.read.mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot, error: null }) })
})
afterEach(() => vi.unstubAllEnvs())

describe('package-only TEST password command boundary', () => {
  const manager = { mode: 'ROLE' as const, organisationId: organisation, role: 'OfferingManager' as const }
  const access = { version: 1, environment: 'TESTNET', actor_id: actor, operating_context: manager, session_mode: 'TEST_PASSWORD', allowed_commands: ['submit_product'] }
  const marked = { ...snapshot, operating_context: manager, offering_access: access }
  const submit = { command: 'submit_product', key: command.key, payload: { product_id: actor, expected_revision: 1 }, operating_context: manager }
  function before(value: unknown = marked) { mocks.read.mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: value }) }
  function saved(value: unknown = marked, error: unknown = null) { mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: value, error }) }) }
  it('forwards the exact allowed package request without admitting other command families', async () => {
    before(); saved()
    const response = await POST(request(submit))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_command_scoped', { command: 'submit_product', request_key: command.key, payload: submit.payload, operating_context: manager })
    expect(await response.json()).toEqual({ snapshot: marked })
  })
  it.each([
    { command: 'publish_product', payload: { product_id: actor, expected_revision: 1 } },
    { command: 'cancel_subscription', payload: { subscription_id: actor } },
    { command: 'revoke_product_service_appointment', payload: { appointment_id: actor, expected_revision: 1, reason: 'Fictional guarded revocation remains outside package password mode.' } },
    { command: 'review_application', payload: { application_id: actor, expected_revision: 1, decision: 'APPROVED', notes: 'Fictional review is not manager authority.', checks: { identity: true, ownership: true, screening: true, suitability: true } } },
  ])('denies excluded %s before the canonical command', async instruction => {
    before(); saved()
    expect((await POST(request({ ...instruction, key: command.key, operating_context: manager }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ actor_id: organisation }, { environment: 'MAINNET' }, { operating_context: { ...manager, organisationId: actor } },
    { session_mode: 'STANDARD' }, { allowed_commands: ['review_product'] }])('rejects invalid package read projections before mutation %#', async change => {
    before({ ...marked, offering_access: { ...access, ...change } }); saved()
    expect((await POST(request(submit))).status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([undefined, { ...access, actor_id: organisation }, { ...access, environment: 'MAINNET' }, { ...access, session_mode: 'STANDARD' },
    { ...access, operating_context: { ...manager, organisationId: actor } }])('preserves unknown-result classification when saved package continuity fails %#', async value => {
    before(); saved({ ...marked, offering_access: value })
    expect((await POST(request(submit))).status).toBe(503)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('keeps the same operation key for a genuinely uncertain result and exact retry', async () => {
    before(); saved(null, { code: '57014' })
    expect((await POST(request(submit))).status).toBe(503)
    saved(); expect((await POST(request(submit))).status).toBe(200)
    for (const call of mocks.rpc.mock.calls) expect(call[1].request_key).toBe(command.key)
  })
})

describe('scoped portal command endpoint', () => {
  it('forwards the exact key, payload and operating context to scoped read and command only', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot })
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ rpc: mocks.rpc }), operatingContext)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_command_scoped', { command: command.command, request_key: command.key, payload: command.payload, operating_context: operatingContext })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it.each(forgedHeaders)('rejects forged headers before backend %#', async headers => {
    expect((await POST(request(instruction, headers))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('blocks production and wrong backend before access', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await POST(request())).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([undefined, null, {}, { mode: 'applicant' }, { mode: 'ROLE', organisationId: 'invalid', role: 'Investor' }, { mode: 'ROLE', organisationId: organisation, role: 'WealthManager' }, { mode: 'APPLICANT', role: 'SuperAdmin' }, { mode: 'APPLICANT', organisationId: organisation }, { ...operatingContext, actor_id: actor }])('rejects missing, malformed or extra context fields before backend %#', async context => {
    expect((await POST(request({ ...command, operating_context: context }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects client-supplied identity and malformed body without weakening the command schema', async () => {
    expect((await POST(request({ ...instruction, actor_id: actor }))).status).toBe(400)
    expect((await POST(request({ ...instruction, payload: { ...command.payload, actor_id: actor } }))).status).toBe(400)
    expect((await POST(request(instruction, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ padding: 'x'.repeat(66000) }))).status).toBe(413)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ ...operatingContext, role: 'SuperAdmin' }, { ...operatingContext, organisationId: '44444444-4444-4444-8444-444444444444' }])('does not fall back when the scoped backend rejects selected authority %#', async context => {
    mocks.read.mockRejectedValue(new PortalError('Membership or binding revoked', 403))
    expect((await POST(request({ ...command, operating_context: context }))).status).toBe(403)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), context)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not reinterpret an applicant command as the user\'s native reviewer role', async () => {
    const review = { command: 'review_application', key: command.key, payload: { application_id: actor, expected_revision: 1, decision: 'APPROVED', notes: 'Synthetic complete review evidence only.', checks: { identity: true, ownership: true, screening: true, suitability: true } } }
    mocks.read.mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: { ...snapshot, operating_context: APPLICANT_CONTEXT } })
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    expect((await POST(request({ ...review, operating_context: APPLICANT_CONTEXT }))).status).toBe(403)
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), APPLICANT_CONTEXT)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_command_scoped', expect.objectContaining({ operating_context: APPLICANT_CONTEXT }))
  })
  it('stops before command execution if the authenticated scoped read fails', async () => {
    mocks.read.mockRejectedValue(new PortalError('Sign in', 401))
    expect((await POST(request())).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['', 'not-a-uuid', 'actor@example.test'])('rejects an invalid expected-actor header before backend access: %s', async expectedActor => {
    expect((await POST(request(instruction, { 'x-bx1-expected-actor': expectedActor }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires the expected-actor header rather than treating its absence as unrestricted', async () => {
    const missing = request()
    missing.headers.delete('x-bx1-expected-actor')
    expect((await POST(missing)).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not execute a stale page command after the browser session switches to another valid actor', async () => {
    const nextActor = '55555555-5555-4555-8555-555555555555'
    mocks.read.mockResolvedValue({ user: { id: nextActor, email: 'other@example.test' }, snapshot: { ...snapshot, actor: { ...snapshot.actor, id: nextActor } } })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), operatingContext)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([['42501', 403], ['23514', 409], ['40001', 409], ['57014', 503]])('classifies %s without exposing database details', async (code, status) => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ error: { code, message: 'private internal data' }, data: null }) })
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('private internal data')
  })
  it('does not accept a snapshot for a different actor', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot, actor: { ...snapshot.actor, id: 'other' } }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it.each([undefined, APPLICANT_CONTEXT, { ...operatingContext, organisationId: '44444444-4444-4444-8444-444444444444' }, { ...operatingContext, role: 'OfferingManager' }, { ...operatingContext, extra: true }])('does not accept the same actor\'s result in a missing or different context %#', async context => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...snapshot, operating_context: context }, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it('does not return success when the result snapshot is absent', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: null }) })
    expect((await POST(request())).status).toBe(503)
  })
  it('limits actual bytes despite a small claimed length', async () => {
    await expect(readPortalBody(request({ padding: 'x'.repeat(100) }, { 'content-length': '1' }), 20)).rejects.toMatchObject({ status: 413 })
  })
})
