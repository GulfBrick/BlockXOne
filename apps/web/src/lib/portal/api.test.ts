import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), rpc: vi.fn(), lifecycle: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
vi.mock('./fund-lifecycle-server', async original => ({ ...await original<object>(), readFundLifecycle: mocks.lifecycle }))
import { POST } from '@/app/api/portal/command/route'
import { readPortalBody } from './http'
import { PortalError } from './server'
import { APPLICANT_CONTEXT } from './operating-context'
import { portalCommandSchema, type PortalCommand } from './contracts'
import type { CookieAdapter } from '@/lib/supabase/server'

const origin = 'https://block-x-one-portal-test.vercel.app'
const actor = 'd22789ee-7f73-4acf-a414-3de0b62ea801'
const organisation = '33333333-3333-4333-8333-333333333333'
const operatingContext = { mode: 'ROLE' as const, organisationId: organisation, role: 'Investor' as const }
const snapshot = { actor: { id: actor, email: 'test@example.test', display_name: null, can_review: false }, operating_context: operatingContext, applications: [], organisations: [], products: [], subscriptions: [], events: [] }
const command = { command: 'cancel_subscription', key: '113800c3-cf6e-437e-abdf-a3b09a03fcff', payload: { subscription_id: actor } }
const instruction = { ...command, operating_context: operatingContext }
const forgedHeaders: Record<string, string>[] = [{ origin: 'https://evil.test' }, { host: 'evil.test' }]
const lifecycle = { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET', operating_context: operatingContext,
  observed_at: '2026-10-15T12:00:00Z', availability: 'UNAVAILABLE', reason_code: 'LIFECYCLE_NOT_INSTALLED', products: [] }
function request(body: unknown = instruction, headers: Record<string, string> = {}) { return new NextRequest(`${origin}/api/portal/command`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-expected-actor': actor, ...headers }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled'); vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  mocks.create.mockReturnValue({ rpc: mocks.rpc })
  mocks.read.mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot })
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: snapshot, error: null }) })
  // This suite isolates command authority from the separate display reader.
  // Its explicit UNAVAILABLE result never invents fund readiness or holdings.
  mocks.lifecycle.mockImplementation(async (_client, userId, context) => ({ ...lifecycle, actor_id: userId, operating_context: context }))
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
    expect(await response.json()).toEqual({ snapshot: { ...marked, fund_lifecycle: { ...lifecycle, operating_context: manager }, requests: [] } })
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
    // STANDARD is an existing valid native mode, not a malformed projection.
    { session_mode: 'UNVERIFIED' }, { allowed_commands: ['review_product'] }])('rejects invalid package read projections before mutation %#', async change => {
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
    expect(await response.json()).toEqual({ snapshot: { ...snapshot, fund_lifecycle: lifecycle, requests: [] } })
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

describe.each(['review', 'applicant account', 'investor account'] as const)('committed TEST %s result uses a separate confirmed read', mode => {
  const context = mode === 'applicant account' ? APPLICANT_CONTEXT
    : { mode: 'ROLE' as const, organisationId: organisation, role: mode === 'review' ? 'ComplianceOfficer' as const : 'Investor' as const }
  const application = '77777777-7777-4777-8777-777777777777', other = '99999999-9999-4999-8999-999999999999'
  const save = portalCommandSchema.parse(mode === 'review'
    ? { command: 'review_application', key: command.key, payload: { application_id: application, expected_revision: 2,
      decision: 'APPROVED', notes: 'Fictional manual TEST investor evidence reviewed.',
      checks: { identity: true, ownership: true, screening: true, suitability: true } } }
    : { command: 'create_investment_account', key: command.key, payload: { application_id: application } })
  const scoped = { ...snapshot, operating_context: context }
  const common = { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
    actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
    product_id: other, offering_revision_id: other, application_id: application, event_id: other,
    request: save, recorded_at: '2026-10-16T13:30:00Z' }
  const committed = mode === 'review'
    ? { ...common, kind: 'TEST_FUND_ADMISSION_COMMIT', decision_id: other, submitted_revision: 2, decision_revision: 3, decision: 'APPROVED' }
    : { ...common, kind: 'TEST_FUND_ACCOUNT_COMMIT', account_id: other, application_revision: 3, admission_decision_id: other }
  const reviewedAt = mode === 'review' ? common.recorded_at : '2026-10-16T13:00:00Z'
  const refreshed = { ...scoped, requests: [{ key: save.key, command: save.command }],
    applications: [{ id: application, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 3,
      details: { full_name: 'Fictional investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Fictional TEST funds only.', beneficial_owners: '', experience: 'Synthetic experience.', documents: [], test_data_acknowledged: true },
      submitted_at: '2026-10-16T12:00:00Z', reviewed_at: reviewedAt, reviewer_id: actor,
      review_notes: save.command === 'review_application' ? save.payload.notes : 'Fictional prior manual review rationale.',
      organisation_id: null, review_checks: { identity: true, ownership: true, screening: true, suitability: true },
      provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'INVESTOR_ADMISSION',
      test_roleplay_admission: { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
        policy_id: other, authority_epoch: 2, product_id: other, offering_revision_id: other, application_id: application,
        submitted_revision: 2, decision_revision: 3, decision: 'APPROVED', reviewer_id: actor, reviewed_at: reviewedAt, valid_until: '2099-01-01T00:00:00Z' } }],
    accounts: mode === 'review' ? [] : [{ id: other, holder_user_id: actor, application_id: application,
      kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: '2026-10-16T13:30:01Z' }],
    events: [{ id: other, subject_id: mode === 'review' ? application : other, kind: save.command, actor_id: actor,
      created_at: mode === 'review' ? '2026-10-16T13:29:59Z' : common.recorded_at, summary: 'Synthetic original event.' }] }
  function prepare(data: unknown = committed) {
    mocks.read.mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: refreshed })
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
  }
  function send() { return POST(request({ ...save, operating_context: context })) }
  it('uses the unchanged canonical writer then separately reads its original receipt', async () => {
    prepare()
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: refreshed, committed })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_command_scoped', {
      command: save.command, request_key: save.key, payload: save.payload, operating_context: context,
    })
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[1])
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })
  it.each([401, 403, 503])('returns private ACK-only202 if the separate read fails with %s', async status => {
    prepare()
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new PortalError('Private saved-read diagnostics.', status))
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it.each(['actor', 'context', 'missing', 'missing receipt', 'wrong key', 'wrong command', 'admission continuity'] as const)(
    'does not report a %s readback as complete saved state', async failure => {
      prepare()
      const before = { ...scoped, ...(failure === 'admission continuity' ? { stage2_access: { version: 1, environment: 'TESTNET',
        actor_id: actor, operating_context: context, session_mode: 'STANDARD', allowed_commands: [] } } : {}) }
      const next = failure === 'missing' ? null : failure === 'actor' ? { ...refreshed, actor: { ...snapshot.actor, id: other } }
        : failure === 'context' ? { ...refreshed, operating_context: { mode: 'ROLE', organisationId: other, role: 'Investor' } }
          : failure === 'missing receipt' ? { ...refreshed, requests: [] }
            : failure === 'wrong key' ? { ...refreshed, requests: [{ key: other, command: save.command }] }
              : failure === 'wrong command' ? { ...refreshed, requests: [{ key: save.key, command: 'cancel_subscription' }] } : refreshed
      mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: before })
        .mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: next })
      const response = await send()
      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ committed, refresh_required: true })
    })
  it.each((['missing application', 'duplicate application', 'foreign application', 'later revision', 'wrong policy', 'wrong decision',
    'missing event', 'foreign event', 'duplicate event', 'missing account', 'foreign account', 'duplicate account'] as const)
    .filter(failure => mode !== 'review' || !['missing account', 'foreign account', 'duplicate account'].includes(failure)))(
    'returns known-commit202 rather than a complete %s result', async failure => {
      prepare()
      const next = structuredClone(refreshed)
      if (failure === 'missing application') next.applications = []
      if (failure === 'duplicate application') next.applications.push({ ...next.applications[0] })
      if (failure === 'foreign application') next.applications[0].user_id = other
      if (failure === 'later revision') next.applications[0].revision = 4
      if (failure === 'wrong policy') next.applications[0].test_roleplay_admission.policy_id = actor
      if (failure === 'wrong decision') next.applications[0].status = 'REJECTED'
      if (failure === 'missing event') next.events = []
      if (failure === 'foreign event') next.events[0].actor_id = other
      if (failure === 'duplicate event') next.events.push({ ...next.events[0] })
      if (failure === 'missing account') next.accounts = []
      if (failure === 'foreign account') next.accounts[0].holder_user_id = other
      if (failure === 'duplicate account') next.accounts.push({ ...next.accounts[0] })
      mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
        .mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: next })
      const response = await send()
      expect(response.status).toBe(202)
      expect(await response.json()).toEqual({ committed, refresh_required: true })
    })
  it.each([
    { actor_id: other }, { event_id: null }, { session_id: null }, { environment: 'MAINNET' }, { application_id: other },
    { operating_context: { mode: 'ROLE', organisationId: organisation, role: 'SuperAdmin' } },
    { independence_proven: true }, { snapshot: {} }, { extra: true },
    { request: { ...save, key: other } }, { request: { ...save, payload: { ...save.payload, application_id: other } } },
  ])('rejects mismatched or broadened native ACK %# without claiming commit', async change => {
    prepare({ ...committed, ...change })
    const response = await send()
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result).not.toHaveProperty('committed'); expect(result).not.toHaveProperty('snapshot')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('preserves refreshed HttpOnly cookies without exposing post-commit failure details', async () => {
    prepare()
    mocks.create.mockImplementation((adapter: CookieAdapter) => {
      mocks.rpc.mockReturnValue({ abortSignal: vi.fn(async () => {
        adapter.setAll([{ name: 'fixture-admission-session', value: 'nonsecret', options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } }], {})
        return { data: committed, error: null }
      }) })
      return { rpc: mocks.rpc }
    })
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new Error('Private database detail.'))
    const response = await send()
    expect(response.status).toBe(202)
    expect(response.cookies.get('fixture-admission-session')?.value).toBe('nonsecret')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(await response.json()).toEqual({ committed, refresh_required: true })
  })
  it('retains the mandatory pre-write read and refuses a MAIN or mismatched runtime', async () => {
    prepare()
    mocks.read.mockReset().mockRejectedValue(new PortalError('Current access denied.', 403))
    expect((await send()).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.read.mockReset(); prepare()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const response = await send()
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('committed')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
})

describe.each([
  { action: 'review_offering_issuer', role: 'IssuerFundManager', kind: 'ISSUER', checks: { issuer_authority: true, terms: true, rights: true } },
  { action: 'review_product', role: 'ComplianceOfficer', kind: 'COMPLIANCE', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } },
] as const)('committed TEST $kind decision is separate from its fresh read', item => {
  const context = { mode: 'ROLE' as const, organisationId: organisation, role: item.role }
  const product = '77777777-7777-4777-8777-777777777777', other = '99999999-9999-4999-8999-999999999999'
  const offering = '88888888-8888-4888-8888-888888888888', hash = 'a'.repeat(64)
  const save = { command: item.action, key: command.key, payload: { product_id: product, offering_revision_id: offering,
    expected_revision: 3, terms_hash: hash, common_envelope_hash: hash, deployment_configuration_hash: hash,
    decision: 'APPROVED', notes: 'Fictional reviewed offering package rationale.', checks: item.checks } }
  const scoped = { ...snapshot, operating_context: context }
  const refreshed = { ...scoped, requests: [{ key: save.key, command: save.command }] }
  const committed = { kind: 'TEST_FUND_OFFERING_DECISION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
    product_id: product, offering_revision_id: offering, decision_id: other, decision_kind: item.kind, request: save,
    recorded_at: '2026-10-15T22:00:00Z' }
  function prepare(data: unknown = committed) {
    mocks.read.mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: refreshed })
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
  }
  function send() { return POST(request({ ...save, operating_context: context })) }
  it('performs one canonical write then returns only its separately validated saved snapshot', async () => {
    prepare()
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: refreshed, committed })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_command_scoped', {
      command: save.command, request_key: save.key, payload: save.payload, operating_context: context,
    })
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[1])
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })
  it.each([401, 403, 503])('returns private ACK-only202 when post-commit read fails with %s', async status => {
    prepare()
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new PortalError('Private decision read failure.', status))
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it.each(['actor', 'context', 'missing', 'package continuity'] as const)('does not substitute a %s saved projection', async failure => {
    prepare()
    const before = { ...scoped, ...(failure === 'package continuity' ? { offering_access: { version: 1, environment: 'TESTNET',
      actor_id: actor, operating_context: context, session_mode: 'STANDARD', allowed_commands: [save.command] } } : {}) }
    const next = failure === 'missing' ? null : failure === 'actor' ? { ...refreshed, actor: { ...snapshot.actor, id: other } }
      : failure === 'context' ? { ...refreshed, operating_context: APPLICANT_CONTEXT } : refreshed
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: before })
      .mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: next })
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
  })
  it.each([
    { actor_id: other }, { operating_context: { ...context, organisationId: other } },
    { operating_context: { ...context, role: 'SuperAdmin' } }, { environment: 'MAINNET' }, { session_id: null },
    { product_id: other }, { offering_revision_id: other }, { decision_id: null }, { independence_proven: true },
    { decision_kind: item.kind === 'ISSUER' ? 'COMPLIANCE' : 'ISSUER' }, { product_revision: 4 }, { extra: true },
    { request: { ...save, key: other } }, { request: { ...save, payload: { ...save.payload, expected_revision: 4 } } },
    { request: { ...save, payload: { ...save.payload, terms_hash: 'b'.repeat(64) } } },
  ])('does not claim a saved decision for a mismatched native ACK %#', async change => {
    prepare({ ...committed, ...change })
    const response = await send()
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result).not.toHaveProperty('committed'); expect(result).not.toHaveProperty('snapshot')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('rejects a decision ACK for another command or invalid runtime binding', async () => {
    prepare()
    expect((await POST(request({ ...command, operating_context: context }))).status).toBe(503)
    expect(mocks.read).toHaveBeenCalledOnce()
    mocks.read.mockReset(); prepare()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const response = await send()
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('committed')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('keeps the pre-write scoped authority read mandatory', async () => {
    prepare()
    mocks.read.mockReset().mockRejectedValue(new PortalError('Authority changed.', 403))
    expect((await send()).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('committed TEST publication response is separate from its fresh read', () => {
  const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'OfferingManager' as const }
  const product = '77777777-7777-4777-8777-777777777777', other = '99999999-9999-4999-8999-999999999999'
  const publish: PortalCommand = { command: 'publish_product', key: command.key, payload: { product_id: product, expected_revision: 3 } }
  const scoped = { ...snapshot, operating_context: context }
  const refreshed = { ...scoped, requests: [{ key: publish.key, command: publish.command }] }
  const committed = { kind: 'TEST_FUND_PUBLICATION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
    product_id: product, offering_revision_id: other, product_revision: 4, request: publish, recorded_at: '2026-10-15T12:00:00Z' }
  function prepare(data: unknown = committed) {
    mocks.read.mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: refreshed })
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
  }
  function send() { return POST(request({ ...publish, operating_context: context })) }
  it('returns a matched publication receipt with only the separately read snapshot, without another write', async () => {
    prepare()
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: refreshed, committed })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_command_scoped', {
      command: publish.command, request_key: publish.key, payload: publish.payload, operating_context: context,
    })
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[1])
    expect(mocks.lifecycle).not.toHaveBeenCalled()
  })
  it.each([401, 403, 503])('keeps the durable publication receipt private when its post-commit read fails with %s', async status => {
    prepare()
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new PortalError('Private saved-read details.', status))
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it.each(['actor', 'context', 'missing', 'package continuity'] as const)('does not return a %s readback as the saved publication snapshot', async failure => {
    prepare()
    const before = { ...scoped, ...(failure === 'package continuity' ? { offering_access: { version: 1, environment: 'TESTNET', actor_id: actor,
      operating_context: context, session_mode: 'STANDARD', allowed_commands: ['request_product_service_appointment'] } } : {}) }
    const next = failure === 'missing' ? null : failure === 'actor' ? { ...refreshed, actor: { ...snapshot.actor, id: other } }
      : failure === 'context' ? { ...refreshed, operating_context: APPLICANT_CONTEXT } : refreshed
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: before })
      .mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: next })
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
  })
  it.each([
    { actor_id: other }, { operating_context: { ...context, organisationId: other } }, { operating_context: { ...context, role: 'SuperAdmin' } },
    { environment: 'MAINNET' }, { product_id: other }, { product_revision: 0 }, { independence_proven: true }, { extra: true },
    { request: { ...publish, key: other } }, { request: { ...publish, payload: { ...publish.payload, expected_revision: 4 } } },
  ])('preserves unknown outcome for a mismatched native publication ACK %#', async change => {
    prepare({ ...committed, ...change })
    const response = await send()
    expect(response.status).toBe(503)
    const result = await response.json()
    expect(result).not.toHaveProperty('committed'); expect(result).not.toHaveProperty('snapshot')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('does not accept a publication ACK for another valid command or a MAIN runtime binding', async () => {
    prepare()
    expect((await POST(request({ ...command, operating_context: context }))).status).toBe(503)
    expect(mocks.read).toHaveBeenCalledOnce()
    mocks.read.mockReset(); prepare()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const response = await send()
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('committed')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
})

describe('committed TEST appointment response is separate from its fresh read', () => {
  const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'OfferingManager' as const }
  const product = '77777777-7777-4777-8777-777777777777'
  const appointment = '88888888-8888-4888-8888-888888888888'
  const other = '99999999-9999-4999-8999-999999999999'
  const save: PortalCommand = { command: 'request_product_service_appointment', key: command.key, payload: {
    product_id: product, role: 'IssuerFundManager', appointee_user_id: actor, native_membership_id: other,
    expected_product_revision: 2, evidence_reference: 'Synthetic guarded appointment authority evidence.', requested_until: '2026-12-01T12:00:00Z',
  } }
  const scoped = { ...snapshot, operating_context: context }
  const refreshed = { ...scoped, requests: [{ key: save.key, command: save.command }] }
  const committed = { kind: 'TEST_FUND_APPOINTMENT_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
    product_id: product, offering_revision_id: other, appointment_id: appointment, appointment_revision: 1,
    request: save, recorded_at: '2026-10-15T12:00:00Z' }
  function prepare(data: unknown = committed) {
    mocks.read.mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockResolvedValue({ user: { id: actor, email: snapshot.actor.email }, snapshot: refreshed })
    mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error: null }) })
  }
  function send() { return POST(request({ ...save, operating_context: context })) }

  it('returns the matched receipt and only the separate validated current read after the writer has committed', async () => {
    prepare()
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: refreshed, committed })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('bx1_portal_command_scoped', {
      command: save.command, request_key: save.key, payload: save.payload, operating_context: context,
    })
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[1])
    expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it.each([401, 403, 503])('returns ACK-only private202, not a rollback error, when the separate read fails with %s', async status => {
    prepare()
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new PortalError('Private saved-read failure details.', status))
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it.each([
    { user: { id: other, email: 'other@example.test' }, snapshot: { ...refreshed, actor: { ...snapshot.actor, id: other } } },
    { user: { id: actor, email: snapshot.actor.email }, snapshot: { ...refreshed, operating_context: APPLICANT_CONTEXT } },
    { user: { id: actor, email: snapshot.actor.email }, snapshot: null },
  ])('never returns a foreign, absent or different-context snapshot after known commit %#', async next => {
    prepare()
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped }).mockResolvedValueOnce(next)
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('preserves existing package continuity checks and reports their failure as refresh-required after commit', async () => {
    prepare()
    const before = { ...scoped, offering_access: { version: 1, environment: 'TESTNET', actor_id: actor,
      operating_context: context, session_mode: 'STANDARD', allowed_commands: [save.command] } }
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: before })
      .mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: refreshed })
    const response = await send()
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ committed, refresh_required: true })
  })

  it('preserves refreshed HttpOnly cookies on an ACK-only202 without leaking the read failure', async () => {
    prepare()
    mocks.create.mockImplementation((adapter: CookieAdapter) => {
      mocks.rpc.mockReturnValue({ abortSignal: vi.fn(async () => {
        adapter.setAll([{ name: 'fixture-appointment-session', value: 'nonsecret', options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } }], {})
        return { data: committed, error: null }
      }) })
      return { rpc: mocks.rpc }
    })
    mocks.read.mockReset().mockResolvedValueOnce({ user: { id: actor, email: snapshot.actor.email }, snapshot: scoped })
      .mockRejectedValueOnce(new Error('Private database and session detail.'))
    const response = await send()
    expect(response.status).toBe(202)
    expect(response.cookies.get('fixture-appointment-session')?.value).toBe('nonsecret')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(await response.json()).toEqual({ committed, refresh_required: true })
  })

  it.each([
    { kind: 'OTHER_COMMIT' }, { version: 2 }, { extra: true }, { actor_id: other },
    { operating_context: { ...context, organisationId: other } }, { environment: 'MAINNET' }, { product_id: other },
    { request: { ...save, key: other } }, { request: { ...save, payload: { ...save.payload, native_membership_id: product } } },
    { request: { ...save, payload: { ...save.payload, extra: true } } },
  ])('never claims commitment or performs a fresh read for a mismatched native ACK %#', async change => {
    prepare({ ...committed, ...change })
    const response = await send()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).not.toHaveProperty('committed')
    expect(body).not.toHaveProperty('snapshot')
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('does not accept the ACK for a different but valid portal command', async () => {
    prepare()
    const response = await POST(request({ ...command, operating_context: context }))
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('committed')
    expect(mocks.read).toHaveBeenCalledOnce()
  })

  it('does not claim a TEST commit when the shared runtime binding cannot be validated', async () => {
    prepare()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const response = await send()
    expect(response.status).toBe(503)
    expect(await response.json()).not.toHaveProperty('committed')
    expect(mocks.read).toHaveBeenCalledOnce()
  })
})
