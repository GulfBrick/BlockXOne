import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { offeringFileId, sha256Hex, OfferingFileReceiptError, OfferingDocumentCommandRollback } from './offering-files-server'
import { offeringDocumentPayloadText } from './offering-files'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), writer: vi.fn(),
  session: vi.fn(), reserve: vi.fn(), register: vi.fn(), documents: vi.fn(), command: vi.fn(), clean: vi.fn(), scanner: vi.fn() }))
vi.mock('./offering-document-processing', () => ({ downloadCleanOfferingDocument: mocks.clean, acceptOfferingScannerMessage: mocks.scanner,
  OfferingDocumentProcessingError: class extends Error { constructor(message: string, public status: number) { super(message) } } }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
vi.mock('./offering-files-server', async original => ({ ...await original<object>(),
  requireOfferingFileReceiptWriter: mocks.writer,
  verifiedOfferingFileSession: mocks.session,
  readOfferingDocuments: mocks.documents, executeOfferingDocumentCommand: mocks.command,
  reserveOfferingFile: mocks.reserve,
  registerOfferingFile: mocks.register }))
import { GET, POST, PUT, PATCH } from '@/app/api/portal/offering-documents/route'

const origin = 'https://block-x-one-offering-file-test.vercel.app'
const actor = '11111111-1111-4111-8111-111111111111'
const organisationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const revisionId = '44444444-4444-4444-8444-444444444444'
const context = { mode: 'ROLE' as const, organisationId, role: 'OfferingManager' as const }
const pdf = Buffer.from('%PDF-1.7\nfictional supplemental document')
const snapshot = { actor: { id: actor, email: 'synthetic@example.invalid', can_review: false },
  applications: [], organisations: [], products: [{ id: productId, revision: 3, status: 'IN_REVIEW',
    offering_package: { id: revisionId, origin: 'SUBMITTED' } }], subscriptions: [], events: [] }
const session = { id: '55555555-5555-4555-8555-555555555555', aal: 'aal1', attestation: {
  iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor, session_id: '55555555-5555-4555-8555-555555555555',
  role: 'authenticated', aal: 'aal1', exp: 4102444800, is_anonymous: false, amr: [{ method: 'password', timestamp: 1700000000 }],
} }
function documentSnapshot() {
  return { revision_id: revisionId, product_id: productId, profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'PENDING_SCAN', manifest: null, files: [],
    document_access: { version: 1, actor_id: actor, environment: 'TESTNET', context, session_id: session.id,
      revision_id: revisionId, product_id: productId, allowed_commands: ['resolve_offering_file_intent', 'seal_offering_document_manifest'],
      can_upload: true, can_read_clean: false, approval_allowed: false, approval_blocker: 'signature-not-connected' } }
}

function request(bytes = pdf) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'synthetic.pdf', { type: 'application/pdf' }))
  form.set('kind', 'MEMORANDUM'); form.set('title', 'Fictional memorandum')
  form.set('product_id', productId); form.set('revision_id', revisionId)
  return new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'x-bx1-operating-context': JSON.stringify(context),
      'x-bx1-expected-actor': actor }, body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', VERCEL_ENV: 'preview',
    BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase',
    NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin,
    SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
  mocks.session.mockResolvedValue(session)
  mocks.documents.mockResolvedValue(documentSnapshot())
  mocks.command.mockResolvedValue(documentSnapshot())
  mocks.reserve.mockImplementation(async input => ({ id: input.fileId,
    path: `${input.revisionId}/${input.actorId}/${input.fileId}`,
    revision_id: input.revisionId, sha256: input.sha256, size: input.size }))
})
afterEach(() => vi.unstubAllEnvs())

describe('offering-file API quarantine', () => {
  it('does not create an unreceipted Storage object when the restricted writer is unavailable', async () => {
    mocks.writer.mockImplementationOnce(() => { throw new OfferingFileReceiptError() })
    const upload = vi.fn(), download = vi.fn(), rpc = vi.fn()
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc })
    const result = await POST(request())
    expect(result.status).toBe(503)
    expect(upload).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('does not call Storage if the trusted upload reservation is not confirmed', async () => {
    mocks.reserve.mockResolvedValueOnce(null)
    const upload = vi.fn(), download = vi.fn()
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc: vi.fn() })
    const result = await POST(request())
    expect(result.status).toBe(503)
    expect(upload).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('rehashes downloaded Storage bytes before making a database receipt', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const tampered = Buffer.from(pdf)
    tampered[tampered.length - 1] = tampered[tampered.length - 1] === 88 ? 89 : 88
    const download = vi.fn().mockResolvedValue({ error: null,
      data: new Blob([new Uint8Array(tampered)], { type: 'application/pdf' }) })
    const rpc = vi.fn()
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc })
    const result = await POST(request())
    expect(result.status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledOnce()
  })

  it('records only an exact quarantined receipt after same-origin bytes and scope checks', async () => {
    const sha256 = sha256Hex(pdf)
    const id = offeringFileId(revisionId, actor, 'MEMORANDUM', sha256)
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) })
    const receipt = { id, revision_id: revisionId, kind: 'MEMORANDUM', title: 'Fictional memorandum',
      sha256, size: pdf.length, validation_state: 'QUARANTINED', uploaded_at: '2026-09-28T00:00:00Z' }
    const rpc = vi.fn()
    mocks.register.mockResolvedValue(receipt)
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc })
    const result = await POST(request())
    expect(result.status).toBe(202)
    expect((await result.json()).document.validation_state).toBe('QUARANTINED')
    expect(rpc).not.toHaveBeenCalled()
    expect(mocks.reserve).toHaveBeenCalledOnce()
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      context, productId, revisionId, fileId: id, sha256, size: pdf.length,
      attestation: session.attestation,
    }))
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.session).toHaveBeenCalledTimes(2)
    expect(upload).toHaveBeenCalledWith(expect.stringContaining(`${revisionId}/${actor}/`), expect.any(Uint8Array),
      expect.objectContaining({ upsert: false, contentType: 'application/pdf' }))
  })

  it('keeps a staged object unreceipted if the Auth session changes during upload', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null,
      data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) })
    mocks.session.mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, id: '66666666-6666-4666-8666-666666666666' })
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc: vi.fn() })
    const result = await POST(request())
    expect(result.status).toBe(403)
    expect(upload).toHaveBeenCalledOnce()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('never confirms a receipt whose exact title/byte identity differs from the reserved file', async () => {
    const sha256 = sha256Hex(pdf), id = offeringFileId(revisionId, actor, 'MEMORANDUM', sha256)
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) })
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc: vi.fn() })
    mocks.register.mockResolvedValue({ id, revision_id: revisionId, kind: 'MEMORANDUM', title: 'A different immutable title',
      sha256, size: pdf.length, validation_state: 'QUARANTINED', uploaded_at: '2026-10-12T00:00:00Z' })
    expect((await POST(request())).status).toBe(503)
  })

  it('does not look up or release files absent from the caller snapshot', async () => {
    const rpc = vi.fn(), download = vi.fn()
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, products: [] } })
    const url = `${origin}/api/portal/offering-documents?revision_id=${revisionId}&id=${actor}&download=1&organisation=${organisationId}&role=OfferingManager`
    expect((await GET(new NextRequest(url))).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('never returns downloaded bytes after authority disappears during the read', async () => {
    const id = offeringFileId(revisionId, actor, 'MEMORANDUM', sha256Hex(pdf))
    const lookup = { id, revision_id: revisionId, storage_path: `${revisionId}/${actor}/${id}`,
      sha256: sha256Hex(pdf), size: pdf.length, mime_type: 'application/pdf', validation_state: 'QUARANTINED',
      product_id: productId, uploader_id: actor, bucket: 'bx1-offering-quarantine', intent_state: 'PENDING',
      clean_receipt_id: null, manifest_id: null, manifest_hash: null }
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: lookup, error: null }) })
    const download = vi.fn().mockResolvedValue({ error: null,
      data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValueOnce({ user: { id: actor }, snapshot })
      .mockResolvedValueOnce({ user: { id: actor }, snapshot: { ...snapshot, products: [] } })
    const url = `${origin}/api/portal/offering-documents?revision_id=${revisionId}&id=${id}&download=1&organisation=${organisationId}&role=OfferingManager`
    const result = await GET(new NextRequest(url))
    expect(result.status).toBe(403)
    expect(download).toHaveBeenCalledOnce()
    expect(await result.text()).not.toContain('%PDF')
  })

  function cleanFixture() {
    const id = offeringFileId(revisionId, actor, 'MEMORANDUM', sha256Hex(pdf))
    const uploader = '77777777-7777-4777-8777-777777777777'
    const manifestId = '88888888-8888-4888-8888-888888888888'
    const otherIds = ['99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
    const current = documentSnapshot()
    const files = ['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'].map((kind, index) => ({
      id: [id, ...otherIds][index], revision_id: revisionId, kind, title: 'Exact selected fictional clean PDF', sha256: sha256Hex(pdf), size: pdf.length,
      validation_state: 'QUARANTINED', uploaded_at: '2026-10-12T00:00:00Z', can_download: true,
      intent_state: 'PROMOTED_CLEAN', processing_state: 'COMPLETED', clean_receipt_id: manifestId, selected: true,
    }))
    const documents = { ...current, state: 'SEALED_SIGNATURE_REQUIRED', files,
      manifest: { id: manifestId, hash: 'b'.repeat(64), sealed_at: '2026-10-12T00:00:00Z', file_ids: [id, ...otherIds],
        correspondence_statement: 'Exact fictional clean PDF bytes declared to correspond to this immutable package text.' },
      document_access: { ...current.document_access, can_upload: false, can_read_clean: true } }
    const lookup = { id, revision_id: revisionId, product_id: productId, uploader_id: uploader, storage_path: `${revisionId}/${uploader}/${id}`,
      sha256: sha256Hex(pdf), size: pdf.length, mime_type: 'application/pdf', validation_state: 'QUARANTINED',
      bucket: 'bx1-offering-documents', intent_state: 'PROMOTED_CLEAN', clean_receipt_id: manifestId, manifest_id: manifestId, manifest_hash: 'b'.repeat(64) }
    const url = `${origin}/api/portal/offering-documents?revision_id=${revisionId}&id=${id}&download=1&organisation=${organisationId}&role=OfferingManager`
    return { documents, lookup, url }
  }

  it('proxies only selected clean bytes and repeats exact authenticated lookup and authority after rehash', async () => {
    const { documents, lookup, url } = cleanFixture()
    mocks.documents.mockResolvedValue(documents)
    mocks.clean.mockResolvedValue(new Uint8Array(pdf))
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: lookup, error: null }) })
    const storage = vi.fn()
    mocks.create.mockReturnValue({ rpc, storage: { from: storage } })
    const response = await GET(new NextRequest(url))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(pdf.toString())
    expect(response.headers.get('content-disposition')).toContain('bx1-clean-')
    expect(mocks.clean).toHaveBeenCalledWith({ id: lookup.id, revision_id: revisionId, uploader_id: lookup.uploader_id,
      storage_path: lookup.storage_path, sha256: lookup.sha256, size: lookup.size, mime_type: 'application/pdf' })
    expect(storage).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.documents).toHaveBeenCalledTimes(2)
  })

  it('releases no clean bytes after reviewer/policy revocation, revision change or integrity failure', async () => {
    const { documents, lookup, url } = cleanFixture()
    mocks.clean.mockResolvedValue(new Uint8Array(pdf))
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: lookup, error: null }) })
    mocks.create.mockReturnValue({ rpc })
    mocks.documents.mockResolvedValueOnce(documents).mockResolvedValueOnce({ ...documents,
      document_access: { ...documents.document_access, can_read_clean: false } })
    const revoked = await GET(new NextRequest(url))
    expect(revoked.status).toBe(403)
    expect(await revoked.text()).not.toContain('%PDF')
    mocks.documents.mockResolvedValue(documents)
    mocks.read.mockResolvedValueOnce({ user: { id: actor }, snapshot }).mockResolvedValueOnce({ user: { id: actor },
      snapshot: { ...snapshot, products: [{ ...snapshot.products[0], offering_package: { ...snapshot.products[0].offering_package, id: actor } }] } })
    const stale = await GET(new NextRequest(url))
    expect(stale.status).toBe(403)
    expect(await stale.text()).not.toContain('%PDF')
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
    mocks.clean.mockResolvedValue(new Uint8Array(Buffer.from('%PDF-1.7\nincorrect bytes')))
    const changed = await GET(new NextRequest(url))
    expect(changed.status).toBe(409)
    expect(await changed.text()).not.toContain('%PDF')
  })

  it('never uses the privileged clean helper for another owner quarantine path', async () => {
    const { lookup, url } = cleanFixture()
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: { ...lookup,
      bucket: 'bx1-offering-quarantine', intent_state: 'PENDING', clean_receipt_id: null, manifest_id: null, manifest_hash: null }, error: null }) })
    mocks.create.mockReturnValue({ rpc, storage: { from: vi.fn() } })
    const response = await GET(new NextRequest(url))
    expect(response.status).toBe(404)
    expect(mocks.clean).not.toHaveBeenCalled()
  })

  it('uses current NOT_ADMITTED readiness, not a compile-time switch, before reservation or Storage', async () => {
    const current = documentSnapshot()
    mocks.documents.mockResolvedValue({ ...current, state: 'NOT_ADMITTED', document_access: { ...current.document_access, can_upload: false } })
    const upload = vi.fn(), download = vi.fn()
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) } })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('not admitted')
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('transports only authenticated resolve/seal commands with the same complete retry identity', async () => {
    mocks.create.mockReturnValue({})
    const command = { command: 'resolve_offering_file_intent', key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'Abandoned reservation deliberately excluded without inventing scan evidence.' } }
    const make = () => new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'PUT',
      headers: { origin, host: new URL(origin).host, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_actor: actor, operating_context: context, request: command }) })
    expect((await PUT(make())).status).toBe(200)
    expect((await PUT(make())).status).toBe(200)
    expect(mocks.command).toHaveBeenNthCalledWith(1, { actorId: actor, session, context, revisionId }, command)
    expect(mocks.command.mock.calls[0]).toEqual(mocks.command.mock.calls[1])
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, products: [{ ...snapshot.products[0], revision: 4 }] } })
    // A later review revision must not prevent the canonical writer from
    // recognizing this exact already-committed identity. Fresh stale input is
    // still rejected by the writer, never bypassed or inferred here.
    expect((await PUT(make())).status).toBe(200)
    expect(mocks.command.mock.calls[2]).toEqual(mocks.command.mock.calls[0])
  })

  it('rejects caller status/path/bucket setters and a reviewer manager action before the writer', async () => {
    mocks.create.mockReturnValue({})
    const command = { command: 'resolve_offering_file_intent', key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'Abandoned reservation deliberately excluded.', bucket: 'public', status: 'CLEAN' } }
    const make = (body: unknown) => new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'PUT',
      headers: { origin, host: new URL(origin).host, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await PUT(make({ expected_actor: actor, operating_context: context, request: command }))).status).toBe(400)
    const { bucket: _bucket, status: _status, ...payload } = command.payload
    const current = documentSnapshot()
    mocks.documents.mockResolvedValue({ ...current, document_access: { ...current.document_access, allowed_commands: [] } })
    expect((await PUT(make({ expected_actor: actor, operating_context: context, request: { ...command, payload } }))).status).toBe(403)
    expect(mocks.command).not.toHaveBeenCalled()
  })

  it('returns only the exact trusted definite-stale rollback as private409; uncertain command failure remains503', async () => {
    mocks.create.mockReturnValue({})
    const command = { command: 'resolve_offering_file_intent' as const, key: actor, payload: { product_id: productId,
      offering_revision_id: revisionId, expected_revision: 3, intent_id: actor, reason: 'A fresh immutable intent resolution under a now-stale product revision.' } }
    const rollback = { outcome: 'DEFINITE_ROLLBACK' as const, reason: 'STALE_PRODUCT_REVISION' as const, effects: 'NONE' as const,
      code: '23514' as const, command: command.command, key: command.key, actor_id: actor, product_id: productId, revision_id: revisionId,
      expected_revision: 3, context, payload_sha256: sha256Hex(new TextEncoder().encode(offeringDocumentPayloadText(command))) }
    const make = () => new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'PUT',
      headers: { origin, host: new URL(origin).host, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_actor: actor, operating_context: context, request: command }) })
    mocks.command.mockRejectedValueOnce(new OfferingDocumentCommandRollback(rollback))
    const known = await PUT(make())
    expect(known.status).toBe(409)
    expect(known.headers.get('cache-control')).toContain('no-store')
    expect((await known.json()).rollback).toEqual(rollback)
    mocks.command.mockRejectedValueOnce(new OfferingFileReceiptError())
    const unknown = await PUT(make())
    expect(unknown.status).toBe(503)
    expect(await unknown.json()).not.toHaveProperty('rollback')
  })

  it('accepts scanner PATCH only at the fixed host without browser Origin, never using cookies as authority', async () => {
    mocks.scanner.mockResolvedValue({ id: actor, state: 'REJECTED' })
    const make = (extra = {}) => new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'PATCH',
      headers: { host: new URL(origin).host, 'content-type': 'application/json', 'x-bx1-scanner-timestamp': '1700000000',
        'x-bx1-scanner-signature': 'signed-by-offering-domain', ...extra }, body: '{}' })
    expect((await PATCH(make({ origin }))).status).toBe(400)
    expect(mocks.scanner).not.toHaveBeenCalled()
    const response = await PATCH(make())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.scanner).toHaveBeenCalledWith(new TextEncoder().encode('{}'), '1700000000', 'signed-by-offering-domain')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
