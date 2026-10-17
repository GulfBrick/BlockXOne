import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ query: vi.fn(), user: vi.fn(), session: vi.fn(), rpc: vi.fn(), scoped: vi.fn(), lifecycle: vi.fn(),
  client: vi.fn(), storage: vi.fn(), download: vi.fn(), fetch: vi.fn(), after: vi.fn() }))
vi.mock('next/server', async original => ({ ...await original<object>(), after: mocks.after }))
vi.mock('pg', async original => ({ ...await original<object>(), Pool: class {
  on() { return this }
  query(...args: unknown[]) { return mocks.query(...args) }
} }))
vi.mock('@supabase/ssr', async original => ({ ...await original<object>(), createServerClient: mocks.client }))
vi.mock('@supabase/supabase-js', async original => ({ ...await original<object>(), createClient: mocks.storage }))
import { GET, POST } from '@/app/api/portal/offering-signatures/route'
import type { OfferingSignatureSnapshot } from './offering-signatures'

const origin = 'https://testnet.bx1.co.za', base = `${origin}/api/portal/offering-signatures`
const actor = '11111111-1111-4111-8111-111111111111', sessionId = '22222222-2222-4222-8222-222222222222'
const revision = '33333333-3333-4333-8333-333333333333', product = '44444444-4444-4444-8444-444444444444'
const operation = '55555555-5555-4555-8555-555555555555', key = '66666666-6666-4666-8666-666666666666'
const context = { mode: 'ROLE' as const, organisationId: product, role: 'IssuerFundManager' as const }
const pdf = new TextEncoder().encode('%PDF-1.7\nSynthetic private signature evidence\n%%EOF\n')
const hash = createHash('sha256').update(pdf).digest('hex')
const env = { NODE_ENV: 'production', VERCEL_ENV: 'preview', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled',
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin,
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: 'postgresql://bx1_document_receipt_writer:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'synthetic'.repeat(4)}`, BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic-scanner',
  BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 17).toString('base64url'),
  BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL: 'postgresql://bx1_offering_signature_worker:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_OFFERING_SIGNATURE_WORKER_ID: 'synthetic-signature-worker',
  BLOCKXONE_OFFERING_SIGNATURE_HMAC_KEY: Buffer.alloc(32, 19).toString('base64url') }
const user = { id: actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false }
function authSession(id = sessionId, aal: 'aal1' | 'aal2' = 'aal1') {
  const claims = { iss: `${env.SUPABASE_URL}/auth/v1`, sub: actor, session_id: id, role: 'authenticated', aal,
    exp: 4102444800, is_anonymous: false, amr: [{ method: 'password', timestamp: 1700000000 },
      ...(aal === 'aal2' ? [{ method: 'totp', timestamp: 1700000001 }] : [])] }
  return { data: { session: { access_token: `synthetic.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic` } }, error: null }
}
function snapshot(): OfferingSignatureSnapshot {
  return { version: 1, actor_id: actor, session_id: sessionId, context, environment: 'TESTNET', product_id: product,
    revision_id: revision, expected_revision: 3, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: true,
    authorisations: [], operations: [], allowed_commands: [], blocker: null }
}
function fundLifecycle() {
  // A separate, scoped reader response: no fund, transaction or ownership proof is invented.
  return { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET',
    operating_context: context, observed_at: '2026-10-15T12:00:00Z', availability: 'UNAVAILABLE',
    reason_code: 'FUND_AUTHORITY_NOT_CURRENT', products: [] }
}
function evidence(): OfferingSignatureSnapshot {
  return { ...snapshot(), authorisations: [{ id: product, signer_id: actor, signer_person_id: actor, appointment_id: product,
    state: 'REVOKED', valid_from: '2026-01-01T00:00:00Z', valid_until: '2027-01-01T00:00:00Z', source_reference: 'Synthetic historical purpose evidence.' }],
  operations: [{ id: operation, authorisation_id: product, state: 'SUPERSEDED', current: false, noncurrent_reason: 'Historical evidence only',
    envelope_id: operation, next_check_at: null, artifacts: [{ id: key, kind: 'CERTIFICATE', sha256: hash, size: pdf.length, mime_type: 'application/pdf' }] }] }
}
const query = `revision_id=${revision}&organisation=${product}&role=IssuerFundManager`
function get(extra = '', expectedActor = actor) {
  return new NextRequest(`${base}?${query}${extra}`, { headers: { 'x-bx1-expected-actor': expectedActor } })
}
function body(command = 'REQUEST_SIGNING_VIEW') {
  const target = { product_id: product, offering_revision_id: revision, expected_revision: 3 }
  return { expected_actor: actor, operating_context: context, request: { command, key,
    payload: command === 'PREPARE_EXECUTION' ? { ...target, authorisation_id: product }
      : { ...target, operation_id: operation, ...(command === 'REQUEST_RECOVERY'
        ? { reason: 'Resume this existing sandbox operation.' } : {}) } } }
}
function post(value: unknown = body(), headers: Record<string, string> = {}, suffix = '') {
  return new NextRequest(`${base}${suffix}`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'BLOCKXONE_ENVIRONMENT', 'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE']) vi.stubEnv(name, undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.user.mockResolvedValue({ data: { user }, error: null })
  mocks.session.mockResolvedValue(authSession())
  mocks.scoped.mockResolvedValue({ data: { actor: { id: actor, email: user.email, can_review: false },
    operating_context: context, applications: [], organisations: [], products: [], subscriptions: [], events: [] }, error: null })
  mocks.lifecycle.mockResolvedValue({ data: fundLifecycle(), error: null })
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'bx1_portal_read_scoped') return { abortSignal: mocks.scoped }
    if (name === 'bx1_portal_fund_lifecycle_read_scoped') return { abortSignal: mocks.lifecycle }
    throw new Error('Unexpected synthetic RPC boundary')
  })
  mocks.client.mockReturnValue({ auth: { getUser: mocks.user, getSession: mocks.session }, rpc: mocks.rpc })
  mocks.storage.mockReturnValue({ storage: { from: () => ({ download: mocks.download }) } })
  mocks.download.mockResolvedValue({ data: new Blob([pdf], { type: 'application/pdf' }), error: null })
  mocks.query.mockResolvedValue({ rows: [{ result: snapshot() }] })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('signature actor API using real application guards and synthetic external clients', () => {
  it('reads only the exact expected actor, session and operating context with private headers', async () => {
    const response = await GET(get())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(snapshot())
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][1].slice(0, 5)).toEqual([actor, sessionId, 'aal1', JSON.stringify(context), revision])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it.each([{ actor_id: product }, { environment: 'MAINNET' }, { context: { ...context, role: 'ComplianceOfficer' } },
    { session_id: product }, { revision_id: product }])(
    'retains native signature snapshot binding without relying on a full dashboard (%j)', async mismatch => {
      mocks.query.mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), ...mismatch } }] })
      const response = await GET(get())
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'The signature record did not match the active account, application or environment.' })
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('bx1_private.read_offering_signatures'), expect.any(Array))
      expect(mocks.after).not.toHaveBeenCalled()
    })
  it.each(['GET', 'POST'] as const)('does not make a %s signature operation depend on a timed-out dashboard projection', async method => {
    mocks.scoped.mockRejectedValue(new Error('Synthetic dashboard57014'))
    mocks.lifecycle.mockRejectedValue(new Error('Synthetic fund projection unavailable'))
    const response = method === 'GET' ? await GET(get()) : await POST(post(body('REQUEST_RECONCILIATION')))
    expect(response.status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.scoped).not.toHaveBeenCalled(); expect(mocks.lifecycle).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][0]).toContain(method === 'GET' ? 'read_offering_signatures' : 'execute_offering_signature_command')
  })
  const identityFailures = ['missing', 'email', 'unconfirmed', 'anonymous', 'foreign actor'] as const
  it.each(identityFailures.flatMap(failure => (['GET', 'POST'] as const).map(method => ({ failure, method }))))(
    'rejects $failure identity before $method native signature access', async ({ failure, method }) => {
      const value = failure === 'missing' ? null : { ...user,
        ...(failure === 'email' ? { email: undefined } : {}),
        ...(failure === 'unconfirmed' ? { email_confirmed_at: null } : {}),
        ...(failure === 'anonymous' ? { is_anonymous: true } : {}),
        ...(failure === 'foreign actor' ? { id: product } : {}) }
      mocks.user.mockResolvedValueOnce({ data: { user: value }, error: null })
      const response = method === 'GET' ? await GET(get()) : await POST(post(body('REQUEST_RECONCILIATION')))
      expect(response.status).toBe(failure === 'foreign actor' ? 403 : 401)
      expect(mocks.session).not.toHaveBeenCalled()
      expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.after).not.toHaveBeenCalled()
    })
  it.each(['GET', 'POST'] as const)('keeps restricted native scope/MFA denial authoritative for %s without exposing details', async method => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('Private native authority details'), { code: '42501' }))
    const response = method === 'GET' ? await GET(get()) : await POST(post(body('REQUEST_RECONCILIATION')))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Private native authority details')
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('keeps MAIN unavailable before any signature identity, session or native access', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    expect((await GET(get())).status).toBe(404)
    expect((await POST(post(body('REQUEST_RECONCILIATION')))).status).toBe(404)
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it.each(['&revision_id=duplicate', '&mode=applicant', '&path=arbitrary', `&expected_actor=${actor}`, `&id=${key}`, '&download=0'])(
    'rejects ambiguous or unsolicited query data %s before database access', async extra => {
      expect((await GET(get(extra))).status).toBe(400)
      expect(mocks.query).not.toHaveBeenCalled()
    })
  it('does not treat an expected-actor header or decoded session as authority', async () => {
    expect((await GET(get('', product))).status).toBe(403)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.user.mockResolvedValueOnce({ data: { user }, error: null }).mockResolvedValueOnce({ data: { user: { ...user, id: product } }, error: null })
    expect((await GET(get())).status).not.toBe(200)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it.each<{ headers: Record<string, string>; suffix: string; status: number }>([{ headers: { origin: 'https://untrusted.invalid' }, suffix: '', status: 403 },
    { headers: { host: 'untrusted.invalid' }, suffix: '', status: 403 },
    { headers: {}, suffix: '?command=CLAIM', status: 403 },
    { headers: { 'content-type': 'text/plain' }, suffix: '', status: 415 }])('rejects a noncanonical POST before a command', async ({ headers, suffix, status }) => {
      expect((await POST(post(body(), headers, suffix))).status).toBe(status)
      expect(mocks.query).not.toHaveBeenCalled()
    })
  it('rejects browser-selected provider authority and mismatched expected actors', async () => {
    expect((await POST(post({ ...body(), signer_email: 'attacker@example.invalid' }))).status).toBe(400)
    expect((await POST(post({ ...body(), expected_actor: product }))).status).toBe(403)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('acknowledges a lost VIEW replay with the same command key and envelope operation, never a replacement or retained URL', async () => {
    const response = await POST(post())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: snapshot(), command: 'REQUEST_SIGNING_VIEW', key, view_status: 'RETRY_SAME_ENVELOPE' })
    const writes = mocks.query.mock.calls.filter(call => String(call[0]).includes('execute_offering_signature_command'))
    expect(writes).toHaveLength(1)
    expect(JSON.stringify(writes[0][1])).toContain(operation)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('withholds POST acknowledgement when session changes after the committed command', async () => {
    mocks.session.mockResolvedValueOnce(authSession()).mockResolvedValueOnce(authSession(product))
    const response = await POST(post())
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty('snapshot')
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('keeps ordinary command acknowledgements free of signing-view fields', async () => {
    const response = await POST(post(body('REQUEST_RECONCILIATION')))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: snapshot(), command: 'REQUEST_RECONCILIATION', key })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it.each(['PREPARE_EXECUTION', 'REQUEST_RECONCILIATION', 'REQUEST_RECOVERY'])(
    'wakes the real existing lease boundary only after confirmed AAL2 %s returns', async command => {
      mocks.session.mockResolvedValue(authSession(sessionId, 'aal2'))
      const response = await POST(post(body(command)))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ snapshot: snapshot(), command, key })
      expect(mocks.after).toHaveBeenCalledTimes(1)
      expect(mocks.query).toHaveBeenCalledTimes(2)
      // Synthetic DB IDLE proves the callback invokes the canonical lease, not a provider directly.
      mocks.query.mockResolvedValueOnce({ rows: [{ result: null }] })
      await mocks.after.mock.calls[0][0]()
      expect(mocks.query).toHaveBeenCalledTimes(3)
      expect(mocks.query.mock.calls[2][0]).toContain('bx1_private.claim_offering_signature_action')
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  it('does not wake after failed commands, invalid confirmed DTOs or changed protected sessions', async () => {
    mocks.session.mockResolvedValue(authSession(sessionId, 'aal2'))
    mocks.query.mockRejectedValueOnce(new Error('Synthetic command failure'))
    expect((await POST(post(body('REQUEST_RECONCILIATION')))).status).not.toBe(200)
    expect(mocks.after).not.toHaveBeenCalled()
    mocks.query.mockResolvedValueOnce({ rows: [{ result: snapshot() }] })
      .mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), product_id: 'invalid' } }] })
    expect((await POST(post(body('REQUEST_RECONCILIATION')))).status).not.toBe(200)
    expect(mocks.after).not.toHaveBeenCalled()
    mocks.query.mockResolvedValue({ rows: [{ result: snapshot() }] })
    mocks.session.mockResolvedValueOnce(authSession(sessionId, 'aal2')).mockResolvedValueOnce(authSession(product, 'aal2'))
    expect((await POST(post(body('REQUEST_RECONCILIATION')))).status).toBe(403)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('keeps the saved command response successful when post-response scheduling is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.session.mockResolvedValue(authSession(sessionId, 'aal2'))
    mocks.after.mockImplementationOnce(() => { throw new Error('Synthetic scheduler unavailable') })
    const response = await POST(post(body('REQUEST_RECONCILIATION')))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ snapshot: snapshot(), command: 'REQUEST_RECONCILIATION', key })
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalledExactlyOnceWith('bx1_offering_signature_wake_schedule_failed')
  })
  it('withholds acknowledgement when the post-command restricted snapshot changes scope', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ result: snapshot() }] })
      .mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), context: { ...context, role: 'ComplianceOfficer' } } }] })
    const response = await POST(post())
    expect(response.status).not.toBe(200)
    expect(await response.json()).not.toHaveProperty('view_status')
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })
  it('serves only rehashed, actor-bound evidence with attachment and private headers', async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: evidence() }] })
    const response = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(mocks.download).toHaveBeenCalledWith(`testnet/${revision}/${operation}/${key}.pdf`)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    // Initial authority is native/purpose-local; the full AFTER download fence
    // still checks the independently refreshed portal and lifecycle context.
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_read_scoped', { operating_context: context })
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_fund_lifecycle_read_scoped', { operating_context: context })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.scoped).toHaveBeenCalledOnce(); expect(mocks.lifecycle).toHaveBeenCalledOnce()
  })
  it('withholds downloaded bytes when the unchanged AFTER dashboard fence times out or loses the actor', async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: evidence() }] })
    mocks.scoped.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'Private dashboard timeout' } })
    const timedOut = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
    expect(timedOut.status).toBe(503)
    expect(timedOut.headers.get('content-type')).toContain('application/json')
    expect(await timedOut.text()).not.toContain('Private dashboard timeout')
    expect(mocks.download).toHaveBeenCalledOnce(); expect(mocks.query).toHaveBeenCalledOnce()
    mocks.user.mockResolvedValueOnce({ data: { user }, error: null })
      .mockResolvedValueOnce({ data: { user }, error: null })
      .mockResolvedValueOnce({ data: { user: { ...user, id: product } }, error: null })
    const changedActor = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
    expect(changedActor.status).not.toBe(200)
    expect(changedActor.headers.get('content-type')).toContain('application/json')
    expect(mocks.download).toHaveBeenCalledTimes(2)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it.each(['actor', 'environment', 'context', 'read failure'] as const)(
    'withholds downloaded evidence when the AFTER lifecycle check has %s mismatch or failure', async failure => {
      mocks.query.mockResolvedValue({ rows: [{ result: evidence() }] })
      mocks.lifecycle.mockResolvedValueOnce(failure === 'read failure' ? { data: null, error: { code: '57014', message: 'Private lifecycle detail' } }
        : { data: { ...fundLifecycle(), ...(failure === 'actor' ? { actor_id: product } : failure === 'environment'
          ? { environment: 'MAINNET' } : { operating_context: { ...context, role: 'ComplianceOfficer' } }) }, error: null })
      const response = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
      expect(response.status).toBe(503)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.text()).not.toContain('Private lifecycle detail')
      expect(mocks.download).toHaveBeenCalledOnce(); expect(mocks.query).toHaveBeenCalledOnce()
      expect(mocks.rpc).toHaveBeenCalledWith('bx1_portal_fund_lifecycle_read_scoped', { operating_context: context })
      expect(mocks.after).not.toHaveBeenCalled()
    })
  it('does not release downloaded bytes when retained evidence disappears after I/O', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ result: evidence() }] }).mockResolvedValueOnce({ rows: [{ result: snapshot() }] })
    const response = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })
  it('does not release bytes after session drift or a storage hash mismatch', async () => {
    mocks.query.mockResolvedValue({ rows: [{ result: evidence() }] })
    mocks.session.mockResolvedValueOnce(authSession()).mockResolvedValueOnce(authSession(product))
    expect((await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))).status).toBe(403)
    mocks.download.mockResolvedValueOnce({ data: new Blob([new Uint8Array(pdf.length)], { type: 'application/pdf' }), error: null })
    const response = await GET(get(`&download=1&id=${key}&expected_actor=${actor}`))
    expect(response.status).not.toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
