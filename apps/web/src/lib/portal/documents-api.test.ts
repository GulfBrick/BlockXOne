import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), verified: vi.fn() }))
const receipts = vi.hoisted(() => ({ config: vi.fn(), id: vi.fn(), register: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create, readVerifiedUser: mocks.verified }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
vi.mock('./document-receipts', async original => ({ ...await original<object>(), documentReceiptDatabaseConfig: receipts.config, documentReceiptId: receipts.id, registerDocumentReceipt: receipts.register }))
import { GET, POST } from '@/app/api/portal/documents/route'
const origin = 'https://block-x-one-documents-test.vercel.app'
const id = '55555555-5555-4555-8555-555555555555'
const actor = '11111111-1111-4111-8111-111111111111'
const organisationId = '33333333-3333-4333-8333-333333333333'
const applicationId = '44444444-4444-4444-8444-444444444444'
const document = { id, kind: 'IDENTITY', title: 'Fictional identity', storage_path: `${actor}/${id}`, sha256: 'a'.repeat(64), size: 10, mime_type: 'application/pdf' }
const snapshot = { actor: { id: actor, email: 'synthetic@example.invalid', can_review: false }, applications: [{ details: { documents: [document] } }], organisations: [], products: [], subscriptions: [], events: [] }
beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', VERCEL_ENV: 'preview', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin, SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.create.mockReturnValue({})
  mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
  mocks.verified.mockResolvedValue({ id: actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-22T09:00:00Z', is_anonymous: false })
  receipts.id.mockReturnValue(id)
})
afterEach(() => vi.unstubAllEnvs())
describe('named representative appointment evidence', () => {
  const mandateId = '88888888-8888-4888-8888-888888888888'
  const proposer = '99999999-9999-4999-8999-999999999999'
  const proposalHash = 'b'.repeat(64)
  const bytes = Buffer.from('%PDF-1.4\nfictional named appointment')
  const appointment = { ...document, kind: 'COMPANY', title: 'Fictional board appointment', storage_path: `${proposer}/${id}`,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  const mandate = { id: mandateId, revision: 1, representative_user_id: actor, applicant_user_id: proposer,
    appointment_document_id: id, proposal_hash: proposalHash }
  const envelope = { mandate_id: mandateId, mandate_revision: 1, proposal_hash: proposalHash, applicant_user_id: proposer,
    document: appointment, validation_state: 'SYNTHETIC_UNSCANNED' }
  const target = `${origin}/api/portal/documents?mandate_id=${mandateId}&id=${id}&mode=applicant`
  function install(data: unknown = envelope, error: unknown = null) {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error }) })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes], { type: 'application/pdf' }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [], investing_representative_mandates: [mandate] } })
    return { rpc, download }
  }
  it('shows only the bound appointment and continues within the same authenticated proposal scope', async () => {
    const { rpc, download } = install()
    const response = await GET(new NextRequest(target))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject(envelope)
    expect(body.url).toContain(`mandate_id=${mandateId}`)
    expect(body.url).toContain('mode=applicant')
    expect(body.url).toContain('download=1')
    expect(body.applications).toBeUndefined()
    expect(download).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('bx1_investing_proposal_document_lookup', { document_id: id, mandate_id: mandateId, operating_context: { mode: 'APPLICANT' } })
    expect(response.headers.get('cache-control')).toContain('no-store')
    const result = await GET(new NextRequest(new URL(body.url, origin)))
    expect(result.status).toBe(200)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes)
    expect(download).toHaveBeenCalledWith(`${proposer}/${id}`)
    expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('rejects mixing proposal, current-history and duplicate parameters before reading authority', async () => {
    const { rpc, download } = install()
    for (const query of [`&application_id=${applicationId}`, '&revision=1', '&history=1', `&mandate_id=${mandateId}`]) {
      expect((await GET(new NextRequest(target + query))).status).toBe(400)
    }
    expect(mocks.read).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })
  it('denies absent, foreign, self and role-selected proposals without calling the lookup', async () => {
    const { rpc, download } = install()
    for (const item of [undefined, { ...mandate, representative_user_id: proposer }, { ...mandate, applicant_user_id: actor }, { ...mandate, appointment_document_id: applicationId }, { ...mandate, proposal_hash: null }]) {
      mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [], investing_representative_mandates: item ? [item] : [] } })
      expect((await GET(new NextRequest(target))).status).toBe(404)
    }
    const roleAttempt = install()
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?mandate_id=${mandateId}&id=${id}&organisation=${organisationId}&role=ComplianceOfficer`))).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(roleAttempt.rpc).not.toHaveBeenCalled()
    expect(roleAttempt.download).not.toHaveBeenCalled()
  })
  it('fails closed on backend denial and exact binding or manifest substitutions', async () => {
    let installed = install(null, { code: '42501' })
    expect((await GET(new NextRequest(target + '&download=1'))).status).toBe(404)
    expect(installed.download).not.toHaveBeenCalled()
    for (const change of [{ mandate_id: applicationId }, { mandate_revision: 2 }, { proposal_hash: 'c'.repeat(64) }, { applicant_user_id: actor },
      { document: { ...appointment, id: applicationId } }, { document: { ...appointment, storage_path: `${actor}/${id}` } },
      { document: { ...appointment, kind: 'IDENTITY' } }, { validation_state: 'APPROVED' }, { provider_history: [] }]) {
      installed = install({ ...envelope, ...change })
      expect((await GET(new NextRequest(target + '&download=1'))).status).toBe(503)
      expect(installed.download).not.toHaveBeenCalled()
    }
  })
  it('rechecks current proposal state at download and denies changed or mismatched bytes', async () => {
    const { rpc, download } = install()
    expect((await GET(new NextRequest(target))).status).toBe(200)
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    expect((await GET(new NextRequest(target + '&download=1'))).status).toBe(404)
    expect(download).not.toHaveBeenCalled()
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: envelope, error: null }) })
    download.mockResolvedValue({ error: null, data: new Blob([Buffer.from('%PDF-1.4\naltered named appointment')], { type: 'application/pdf' }) })
    expect((await GET(new NextRequest(target + '&download=1'))).status).toBe(409)
  })
})
describe('private evidence context continuity', () => {
  it('preserves historical document access alongside a new empty capacity draft', async () => {
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ details: {} }, ...snapshot.applications] } })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&mode=applicant`))
    expect(response.status).toBe(200)
    expect((await response.json()).url).toContain('mode=applicant')
  })
  it('keeps applicant scope in the authenticated download continuation', async () => {
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&mode=applicant`))
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'APPLICANT' })
    const result = await response.json()
    expect(result.url).toContain('mode=applicant'); expect(result.url).toContain('download=1')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('passes exact reviewer organisation and role to the guarded read', async () => {
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&organisation=${organisationId}&role=ComplianceOfficer`))
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' })
    expect((await response.json()).url).toContain(`organisation=${organisationId}`)
  })
  it.each(['', '&mode=applicant&role=Investor', '&mode=applicant&mode=applicant', `&organisation=${organisationId}&role=WealthManager`])('rejects missing or ambiguous context %s', async query => {
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}${query}`))).status).toBeGreaterThanOrEqual(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not leak a document excluded from the selected scope', async () => {
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [] } })
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&mode=applicant`))).status).toBe(404)
  })
  it('returns only scoped immutable version metadata without a storage path', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, versions: [{ revision: 2, submitted_at: '2026-09-22T09:00:00Z', capture_kind: 'SUBMISSION', documents: [{ id, kind: 'IDENTITY', title: 'Fictional earlier evidence', claimed_sha256: 'a'.repeat(64), size: 10, mime_type: 'application/pdf' }] }] }, error: null }) })
    mocks.create.mockReturnValue({ rpc })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: actor, details: { documents: [] } }] } })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?application_id=${applicationId}&history=1&mode=applicant`))
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('bx1_application_document_versions', { application_id: applicationId, operating_context: { mode: 'APPLICANT' } })
    const body = await response.json()
    expect(body.versions[0].documents[0].title).toBe('Fictional earlier evidence')
    expect(JSON.stringify(body)).not.toContain('storage_path')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('delegates foreign history to its guarded native lookup and rejects ambiguous history parameters first', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    mocks.create.mockReturnValue({ rpc })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [] } })
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?application_id=${applicationId}&history=1&mode=applicant`))).status).toBe(404)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('bx1_application_document_versions', { application_id: applicationId, operating_context: { mode: 'APPLICANT' } })
    expect(mocks.read).not.toHaveBeenCalled()
    for (const query of [`application_id=${applicationId}&history=1&id=${id}`, `application_id=${applicationId}&revision=2&id=${id}&history=1`, `application_id=${applicationId}&history=1&download=1`, `application_id=${applicationId}&revision=2&id=${id}&id=${id}`]) {
      expect((await GET(new NextRequest(`${origin}/api/portal/documents?${query}&mode=applicant`))).status).toBe(400)
    }
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('resolves exact historic bytes only through a caller-bound lookup and same-origin download', async () => {
    const bytes = Buffer.from('%PDF-1.4\nfictional earlier evidence')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, revision: 2, id, kind: 'IDENTITY', title: 'Earlier evidence', storage_path: `${actor}/${id}`, claimed_sha256: digest, size: bytes.length, mime_type: 'application/pdf' }, error: null }) })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes], { type: 'application/pdf' }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: actor, details: { documents: [] } }] } })
    const target = `${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&mode=applicant`
    const prepared = await GET(new NextRequest(target))
    expect(prepared.status).toBe(200)
    const link = (await prepared.json()).url as string
    expect(link).toContain('download=1')
    expect(link).not.toContain(`${actor}/${id}`)
    expect(download).not.toHaveBeenCalled()
    const result = await GET(new NextRequest(new URL(link, origin)))
    expect(result.status).toBe(200)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes)
    expect(rpc).toHaveBeenCalledWith('bx1_application_document_lookup', { application_id: applicationId, revision: 2, document_id: id, operating_context: { mode: 'APPLICANT' } })
    expect(download).toHaveBeenCalledWith(`${actor}/${id}`)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(3)
    expect(mocks.verified).toHaveBeenCalledTimes(3)
    expect(result.headers.get('content-type')).toBe('application/octet-stream')
    expect(result.headers.get('content-disposition')).toContain('attachment;')
    expect(result.headers.get('content-security-policy')).toContain('sandbox')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('cache-control')).toContain('no-store')
  })
  it.each([null, { id: actor, email: 'synthetic@example.invalid', is_anonymous: false },
    { id: actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-22T09:00:00Z', is_anonymous: true }])('requires verified non-anonymous identity before versioned access: %j', async user => {
    const rpc = vi.fn(), download = vi.fn()
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.verified.mockResolvedValue(user)
    for (const query of [`application_id=${applicationId}&history=1`, `application_id=${applicationId}&revision=2&id=${id}&download=1`]) {
      expect((await GET(new NextRequest(`${origin}/api/portal/documents?${query}&mode=applicant`))).status).toBe(401)
    }
    expect(mocks.read).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })
  it('reads exact historical evidence without a full dashboard and rechecks authority after Storage', async () => {
    const bytes = Buffer.from('%PDF-1.4\nfictional scoped evidence')
    const manifest = { application_id: applicationId, revision: 2, id, kind: 'IDENTITY', title: 'Earlier evidence',
      storage_path: `${actor}/${id}`, claimed_sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime_type: 'application/pdf' }
    const rpc = vi.fn().mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: manifest, error: null }) })
      .mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes]) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockRejectedValue(new Error('Dashboard unavailable'))
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&organisation=${organisationId}&role=ComplianceOfficer&download=1`))
    expect(response.status).toBe(404)
    expect(download).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(2, 'bx1_application_document_lookup', { application_id: applicationId, revision: 2, document_id: id,
      operating_context: { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' } })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('fictional scoped evidence')
  })
  it.each(['actor', 'manifest'])('withholds historical bytes if the %s changes during download', async changed => {
    const bytes = Buffer.from('%PDF-1.4\nfictional unchanged bytes')
    const manifest = { application_id: applicationId, revision: 2, id, kind: 'IDENTITY', title: 'Earlier evidence',
      storage_path: `${actor}/${id}`, claimed_sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime_type: 'application/pdf' }
    const rpc = vi.fn().mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: manifest, error: null }) })
      .mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: changed === 'manifest' ? { ...manifest, storage_path: `${organisationId}/${id}` } : manifest, error: null }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download: vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes]) }) }) } })
    mocks.verified.mockResolvedValueOnce({ id: actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-22T09:00:00Z', is_anonymous: false })
      .mockResolvedValueOnce({ id: changed === 'actor' ? organisationId : actor, email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-22T09:00:00Z', is_anonymous: false })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&mode=applicant&download=1`))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('fictional unchanged bytes')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not read Storage after a historic authority denial or mismatched lookup', async () => {
    const download = vi.fn()
    const rpc = vi.fn().mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
      .mockReturnValueOnce({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, revision: 3, id, kind: 'IDENTITY', title: 'Wrong version', storage_path: `${actor}/${id}`, claimed_sha256: 'a'.repeat(64), size: 10, mime_type: 'application/pdf' }, error: null }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: actor, details: { documents: [] } }] } })
    const target = `${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&mode=applicant&download=1`
    expect((await GET(new NextRequest(target))).status).toBe(404)
    expect((await GET(new NextRequest(target))).status).toBe(503)
    expect(download).not.toHaveBeenCalled()
  })
  it('keeps historical lookup distinct from a current document with the same id', async () => {
    const earlier = Buffer.from('%PDF-1.4\nearlier fictional version')
    const earlierHash = createHash('sha256').update(earlier).digest('hex')
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([earlier], { type: 'application/pdf' }) })
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, revision: 1, id, kind: 'IDENTITY', title: 'Earlier evidence', storage_path: `${actor}/${id}`, claimed_sha256: earlierHash, size: earlier.length, mime_type: 'application/pdf' }, error: null }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: actor, details: { documents: [{ ...document, sha256: 'f'.repeat(64), size: earlier.length }] } }] } })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?application_id=${applicationId}&revision=1&id=${id}&mode=applicant&download=1`))
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(earlier)
    expect(rpc).toHaveBeenCalledWith('bx1_application_document_lookup', { application_id: applicationId, revision: 1, document_id: id, operating_context: { mode: 'APPLICANT' } })
  })
  it('does not return bytes when historical size or claimed hash differs from Storage', async () => {
    const bytes = Buffer.from('%PDF-1.4\nfictional evidence')
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes], { type: 'application/pdf' }) })
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, revision: 2, id, kind: 'IDENTITY', title: 'Earlier evidence', storage_path: `${actor}/${id}`, claimed_sha256: 'a'.repeat(64), size: bytes.length, mime_type: 'application/pdf' }, error: null }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: actor, details: { documents: [] } }] } })
    const target = `${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&mode=applicant&download=1`
    expect((await GET(new NextRequest(target))).status).toBe(409)
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { application_id: applicationId, revision: 2, id, kind: 'IDENTITY', title: 'Earlier evidence', storage_path: `${actor}/${id}`, claimed_sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length + 1, mime_type: 'application/pdf' }, error: null }) })
    expect((await GET(new NextRequest(target))).status).toBe(409)
  })
  it('denies a reviewer outside the exact organisation scope without reading Storage', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) })
    const download = vi.fn()
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [{ id: applicationId, user_id: '99999999-9999-4999-8999-999999999999', details: { documents: [] } }] } })
    const target = `${origin}/api/portal/documents?application_id=${applicationId}&revision=2&id=${id}&organisation=${organisationId}&role=ComplianceOfficer&download=1`
    expect((await GET(new NextRequest(target))).status).toBe(404)
    expect(rpc).toHaveBeenCalledWith('bx1_application_document_lookup', { application_id: applicationId, revision: 2, document_id: id, operating_context: { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' } })
    expect(download).not.toHaveBeenCalled()
  })
  it('recovers only the signed-in applicant\'s pending scan queue after reload', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: [
      { id, kind: 'IDENTITY', title: 'Fictional identity', state: 'QUARANTINED', created_at: '2026-09-24T11:00:00Z' },
    ], error: null }) })
    mocks.create.mockReturnValue({ rpc })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?queue=1`))
    expect(response.status).toBe(200)
    expect((await response.json()).documents[0].state).toBe('QUARANTINED')
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), { mode: 'APPLICANT' })
    expect(rpc).toHaveBeenCalledWith('bx1_document_scan_queue')
  })
  it('returns a usable manifest only after guarded scanned promotion', async () => {
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({
      data: { id, state: 'SCANNED_CLEAN', document }, error: null,
    }) })
    mocks.create.mockReturnValue({ rpc })
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?status=${id}`))
    expect(response.status).toBe(200)
    expect((await response.json()).document).toEqual(document)
    expect(rpc).toHaveBeenCalledWith('bx1_document_scan_status', { document_id: id })
    rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { id, state: 'SCANNED_CLEAN' }, error: null }) })
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?status=${id}`))).status).toBe(503)
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?status=${id}&role=Investor`))).status).toBe(400)
  })
  it('refuses unscoped uploads before any private backend call', async () => {
    const response = await POST(new NextRequest(`${origin}/api/portal/documents`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'multipart/form-data; boundary=synthetic' }, body: '' }))
    expect(response.status).toBe(403); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('stops an upload when the signed-in account changed after the form loaded', async () => {
    const response = await POST(new NextRequest(`${origin}/api/portal/documents`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'multipart/form-data; boundary=synthetic', 'x-bx1-operating-context': JSON.stringify({ mode: 'APPLICANT' }), 'x-bx1-expected-actor': organisationId }, body: '' }))
    expect(response.status).toBe(403)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'APPLICANT' })
  })
  function uploadRequest() {
    const body = new FormData()
    body.set('file', new File([Buffer.from('%PDF-1.4\nfictional evidence')], 'fictional.pdf', { type: 'application/pdf' }))
    body.set('kind', 'IDENTITY'); body.set('title', 'Fictional identity')
    return new NextRequest(`${origin}/api/portal/documents`, { method: 'POST', headers: {
      origin, host: new URL(origin).host, 'x-bx1-operating-context': JSON.stringify({ mode: 'APPLICANT' }),
      'x-bx1-expected-actor': actor,
    }, body })
  }
  it('preserves the legacy synthetic upload until a verified receipt policy cutover', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    mocks.create.mockReturnValue({ rpc: vi.fn((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_document_lifecycle_mode' ? 'SYNTHETIC_TEST_ONLY' : false, error: null }) })), storage: { from: () => ({ upload }) } })
    const response = await POST(uploadRequest())
    expect(response.status).toBe(201)
    expect((await response.json()).validation_state).toBe('LEGACY_UNVERIFIED')
    expect(receipts.config).not.toHaveBeenCalled()
    expect(receipts.register).not.toHaveBeenCalled()
  })
  it('fails before Storage upload when strict receipts lack the server-only writer', async () => {
    const upload = vi.fn()
    mocks.create.mockReturnValue({ rpc: vi.fn((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_document_lifecycle_mode' ? 'SYNTHETIC_TEST_ONLY' : true, error: null }) })), storage: { from: () => ({ upload }) } })
    receipts.config.mockImplementation(() => { throw new Error('unavailable') })
    const response = await POST(uploadRequest())
    expect(response.status).toBe(503)
    expect(upload).not.toHaveBeenCalled()
  })
  it('registers only re-downloaded, byte-identical strict evidence under the verified actor/session', async () => {
    const bytes = Buffer.from('%PDF-1.4\nfictional evidence')
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes], { type: 'application/pdf' }) })
    const sessionId = '77777777-7777-4777-8777-777777777777'
    const token = `synthetic.${Buffer.from(JSON.stringify({ sub: actor, session_id: sessionId })).toString('base64url')}.signature`
    mocks.create.mockReturnValue({
      rpc: vi.fn((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_document_lifecycle_mode' ? 'SYNTHETIC_TEST_ONLY' : true, error: null }) })),
      storage: { from: () => ({ upload, download }) },
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: token } }, error: null }),
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor } }, error: null }) },
    })
    receipts.config.mockReturnValue({})
    const response = await POST(uploadRequest())
    expect(response.status).toBe(201)
    expect((await response.json()).validation_state).toBe('SYNTHETIC_UNSCANNED')
    expect(receipts.register).toHaveBeenCalledWith(actor, sessionId, expect.objectContaining({ id, storage_path: `${actor}/${id}`, kind: 'IDENTITY' }), null)
    expect(download).toHaveBeenCalledWith(`${actor}/${id}`)
  })
  function attestedUpload(change: Record<string, unknown> = {}) {
    const sessionId = '77777777-7777-4777-8777-777777777777'
    const facts = { iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor, session_id: sessionId,
      role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false,
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 5 }], ...change }
    const token = `fixture.${Buffer.from(JSON.stringify({ ...facts, email: 'not-transported@example.invalid', user_metadata: { aal: 'aal2' } })).toString('base64url')}.not-a-real-signature`
    const bytes = Buffer.from('%PDF-1.4\nfictional evidence')
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([bytes], { type: 'application/pdf' }) })
    const auth = { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: token } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor, user_metadata: { session_id: organisationId } } }, error: null }) }
    mocks.create.mockReturnValue({
      rpc: vi.fn((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_document_lifecycle_mode' ? 'SYNTHETIC_TEST_ONLY' : true, error: null }) })),
      storage: { from: () => ({ upload, download }) }, auth,
    })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, operating_context: { mode: 'APPLICANT' },
      stage2_access: { version: 1, environment: 'TESTNET', actor_id: actor, operating_context: { mode: 'APPLICANT' },
        session_mode: 'TEST_PASSWORD', allowed_commands: ['submit_application'] } } })
    receipts.config.mockReturnValue({})
    return { facts, token, sessionId, upload, download, auth }
  }
  it('preserves no-factor STANDARD TEST AAL1 uploads when the password pause is off or the marker is absent', async () => {
    for (const stage2_access of [undefined, { version: 1, environment: 'TESTNET', actor_id: actor,
      operating_context: { mode: 'APPLICANT' }, session_mode: 'STANDARD', allowed_commands: ['submit_application'] }]) {
      vi.clearAllMocks()
      const installed = attestedUpload({ amr: [{ method: 'native-existing-method', timestamp: 1 }] })
      mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot,
        operating_context: { mode: 'APPLICANT' }, ...(stage2_access ? { stage2_access } : {}) } })
      expect((await POST(uploadRequest())).status).toBe(201)
      expect(installed.auth.getUser).toHaveBeenLastCalledWith(installed.token)
      expect(receipts.register).toHaveBeenCalledExactlyOnceWith(actor, installed.sessionId, expect.objectContaining({ id }), null)
    }
  })
  it('passes only getUser-verified current-token facts, not upload headers or user metadata', async () => {
    const installed = attestedUpload()
    const request = uploadRequest()
    request.headers.set('x-bx1-receipt-attestation', JSON.stringify({ sub: organisationId, aal: 'aal2' }))
    const response = await POST(request)
    expect(response.status).toBe(201)
    expect((await response.json()).validation_state).toBe('SYNTHETIC_UNSCANNED')
    expect(installed.auth.getUser).toHaveBeenNthCalledWith(1, installed.token)
    expect(installed.auth.getUser).toHaveBeenNthCalledWith(2, installed.token)
    expect(receipts.register).toHaveBeenCalledExactlyOnceWith(actor, installed.sessionId,
      expect.objectContaining({ sha256: createHash('sha256').update(Buffer.from('%PDF-1.4\nfictional evidence')).digest('hex') }), installed.facts)
    expect(installed.upload).toHaveBeenCalledWith(`${actor}/${id}`, expect.any(Uint8Array),
      expect.objectContaining({ upsert: false, metadata: { sha256: expect.any(String) } }))
  })
  it('does not mint a receipt after a token/session change during byte storage', async () => {
    const installed = attestedUpload()
    const changed = `fixture.${Buffer.from(JSON.stringify({ ...installed.facts, session_id: organisationId })).toString('base64url')}.not-a-real-signature`
    installed.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: installed.token } }, error: null })
      .mockResolvedValueOnce({ data: { session: { access_token: changed } }, error: null })
    expect((await POST(uploadRequest())).status).toBe(403)
    expect(installed.auth.getUser).toHaveBeenLastCalledWith(changed)
    expect(receipts.register).not.toHaveBeenCalled()
  })
  it('revalidates the exact token at receipt time and rejects revoked or substituted accounts', async () => {
    const installed = attestedUpload()
    installed.auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: { code: 'revoked' } })
    expect((await POST(uploadRequest())).status).toBeGreaterThanOrEqual(400)
    expect(receipts.register).not.toHaveBeenCalled()
    const changed = attestedUpload()
    changed.auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: organisationId } }, error: null })
    expect((await POST(uploadRequest())).status).toBeGreaterThanOrEqual(400)
    expect(receipts.register).not.toHaveBeenCalled()
  })
  it.each([{ amr: [{ method: 'recovery', timestamp: 1 }] }, { amr: [{ method: 'oauth', timestamp: 1 }] },
    { exp: 1 }, { is_anonymous: true }])('does not use TEST admission on non-current password evidence %j', async change => {
    attestedUpload(change)
    expect((await POST(uploadRequest())).status).toBeGreaterThanOrEqual(400)
    expect(receipts.register).not.toHaveBeenCalled()
  })
  it('does not register a strict receipt for a different stored object', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([Buffer.from('%PDF-1.4\nfictional evidence altered')], { type: 'application/pdf' }) })
    mocks.create.mockReturnValue({ rpc: vi.fn((name: string) => ({ abortSignal: vi.fn().mockResolvedValue({ data: name === 'bx1_document_lifecycle_mode' ? 'SYNTHETIC_TEST_ONLY' : true, error: null }) })), storage: { from: () => ({ upload, download }) } })
    receipts.config.mockReturnValue({})
    const response = await POST(uploadRequest())
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(receipts.register).not.toHaveBeenCalled()
  })
})
