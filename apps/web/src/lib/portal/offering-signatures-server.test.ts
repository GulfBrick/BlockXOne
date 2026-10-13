import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ query: vi.fn(), upload: vi.fn(), download: vi.fn(), from: vi.fn(), create: vi.fn(), fetch: vi.fn() }))
vi.mock('pg', async original => ({ ...await original<object>(), Pool: class {
  on() { return this }
  query(...args: unknown[]) { return mocks.query(...args) }
} }))
vi.mock('@supabase/supabase-js', async original => ({ ...await original<object>(), createClient: mocks.create }))
import { signatureWorkerDatabaseConfig, signatureWorkerConfig, verifySignatureWorkerMessage, signatureWorkerActionSchema,
  signatureResultId, executeSignatureProcessing, signatureArtifactPath, retainSignatureArtifact,
  readOfferingSignatures, executeOfferingSignatureCommand, downloadOfferingSignatureArtifact, type SignatureWorkerAction } from './offering-signatures-server'
import { DOCUSIGN_OFFERING_SANDBOX } from './docusign-offering-provider'
import type { OfferingSignatureSnapshot } from './offering-signatures'

const actor = '11111111-1111-4111-8111-111111111111', sessionId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333', productId = '44444444-4444-4444-8444-444444444444'
const operationId = '55555555-5555-4555-8555-555555555555', leaseId = '66666666-6666-4666-8666-666666666666', requestId = '77777777-7777-4777-8777-777777777777'
const context = { mode: 'ROLE' as const, organisationId: productId, role: 'IssuerFundManager' as const }
const pdf = Buffer.from('%PDF-1.7\nSynthetic retained evidence only\n%%EOF\n'), hash = createHash('sha256').update(pdf).digest('hex')
const key = Buffer.alloc(32, 17)
const env = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', VERCEL_ENV: 'preview',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL: 'postgresql://bx1_offering_signature_worker:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_OFFERING_SIGNATURE_WORKER_ID: 'synthetic-signatures', BLOCKXONE_OFFERING_SIGNATURE_HMAC_KEY: key.toString('base64url'),
  BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: 'postgresql://bx1_document_receipt_writer:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'synthetic'.repeat(4)}`, BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic-scanner', BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: key.toString('base64url'),
  BLOCKXONE_DOCUSIGN_CLIENT_ID: DOCUSIGN_OFFERING_SANDBOX.clientId, BLOCKXONE_DOCUSIGN_USER_ID: DOCUSIGN_OFFERING_SANDBOX.userId,
  BLOCKXONE_DOCUSIGN_ACCOUNT_ID: DOCUSIGN_OFFERING_SANDBOX.accountId, BLOCKXONE_DOCUSIGN_BASE_URI: DOCUSIGN_OFFERING_SANDBOX.baseUri,
  BLOCKXONE_DOCUSIGN_MODE: 'sandbox', BLOCKXONE_DOCUSIGN_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-NOT-A-KEY\n-----END PRIVATE KEY-----',
}
const session = { id: sessionId, aal: 'aal1' as const, attestation: { iss: `${env.SUPABASE_URL}/auth/v1`, sub: actor, session_id: sessionId, role: 'authenticated' as const, aal: 'aal1' as const, exp: 4102444800, is_anonymous: false as const, amr: [{ method: 'password', timestamp: 1700000000 }] } }
const input = { actorId: actor, session, context, revisionId }
const action = { operation_id: operationId, lease_id: leaseId, generation: 1, request_id: requestId }
function snapshot(): OfferingSignatureSnapshot {
  return { version: 1, actor_id: actor, session_id: sessionId, context, environment: 'TESTNET', product_id: productId, revision_id: revisionId,
    expected_revision: 3, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: true, authorisations: [], operations: [], allowed_commands: [], blocker: null }
}
function worker(actionName: SignatureWorkerAction['action'] = 'RECONCILE'): SignatureWorkerAction {
  return { ...action, action: actionName, authorisation_id: productId, lease_expires_at: new Date(Date.now() + 60000).toISOString(), authority_epoch: 1,
    worker_id: env.BLOCKXONE_OFFERING_SIGNATURE_WORKER_ID, environment: 'TESTNET', revision_id: revisionId, manifest_id: productId, manifest_hash: hash,
    provider_account_id: DOCUSIGN_OFFERING_SANDBOX.accountId, envelope_id: operationId, current: true, create_request: null, create_request_sha256: null,
    first_attempt_at: new Date().toISOString(), completion_evidence: null, completion_evidence_sha256: null,
    signer: { actor_id: actor, person_id: actor, email: 'synthetic@example.invalid', name: 'Synthetic Signer', client_user_id: actor },
    originals: (['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'] as const).map((kind, index) => {
      const fileId = `00000000-0000-4000-8000-00000000000${index + 1}`
      return { file_id: fileId, kind, uploader_id: actor, size: pdf.length, sha256: hash, scan_event_id: index + 1, clean_receipt_id: fileId, storage_path: `${revisionId}/${actor}/${fileId}` }
    }),
    binding: { product_id: productId, issuer_reference: productId, declaration_revision: 1, declaration_hash: hash,
      purpose: 'ISSUER_PACKAGE_EXECUTION', terms_hash: hash, document_hashes: { memorandum: hash, risks: hash, subscription_terms: hash },
      common_envelope_hash: hash, deployment_configuration_hash: hash, text_sha256: hash, appointment_id: productId, appointment_receipt_id: productId,
      acting_organisation_id: productId, manager_organisation_id: productId, valid_from: '2026-01-01T00:00:00Z', valid_until: '2027-01-01T00:00:00Z', source_reference: 'Synthetic purpose evidence for transport checks.', source_sha256: hash },
    artifacts: [], originating_actor_id: null, originating_session_id: null }
}
const record = { operation_id: operationId, state: 'SENT', next_action: 'RECONCILE', next_check_at: null, artifact_id: null, current: true, can_perform: false }
beforeEach(() => {
  vi.resetAllMocks()
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined); vi.stubEnv('BLOCKXONE_ENVIRONMENT', undefined); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', undefined)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.from.mockReturnValue({ upload: mocks.upload, download: mocks.download })
  mocks.create.mockReturnValue({ storage: { from: mocks.from } })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), error: null })
  mocks.query.mockResolvedValue({ rows: [{ result: snapshot() }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('restricted signature server boundary — synthetic external dependencies only', () => {
  it('pins worker identity, project, TLS and database role with no owner/service-role fallback', () => {
    expect(signatureWorkerDatabaseConfig(env)).toMatchObject({ user: 'bx1_offering_signature_worker', max: 1, ssl: { rejectUnauthorized: true, servername: 'db.fegnnnlseuejkrusbbkv.supabase.co' } })
    for (const url of [env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL.replace('bx1_offering_signature_worker', 'postgres'), env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL.replace('bx1_offering_signature_worker', 'service_role'),
      env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL.replace('verify-full', 'require'), env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL.replace('fegnnnlseuejkrusbbkv', 'oqkevkjbkpugjotihtda'),
      `${env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL}&options=unsafe`]) expect(() => signatureWorkerDatabaseConfig({ ...env, BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL: url })).toThrow()
  })
  it('authenticates the exact domain-separated bounded raw body and rejects stale/malformed HMAC or VIEW commands', () => {
    const now = 1791849600000, timestamp = String(now / 1000), raw = Buffer.from(JSON.stringify({ command: 'CLAIM', request_id: requestId }))
    const sign = (bytes: Uint8Array, time = timestamp, domain = 'bx1-offering-signatures-worker-v1:') => createHmac('sha256', key).update(domain).update(time).update(':').update(bytes).digest('hex')
    expect(verifySignatureWorkerMessage(raw, timestamp, sign(raw), signatureWorkerConfig(env), now)).toEqual({ command: 'CLAIM', request_id: requestId })
    for (const [body, time, digest] of [[raw, timestamp, '0'.repeat(64)], [Buffer.concat([raw, Buffer.from(' ')]), timestamp, sign(raw)], [raw, timestamp, sign(raw, timestamp, 'other-domain:')], [raw, String(now / 1000 - 301), sign(raw)], [Buffer.alloc(4097), timestamp, sign(Buffer.alloc(4097))]] as const) expect(() => verifySignatureWorkerMessage(body, time, digest, signatureWorkerConfig(env), now)).toThrow()
    const view = Buffer.from(JSON.stringify({ command: 'VIEW', request_id: requestId }))
    expect(() => verifySignatureWorkerMessage(view, timestamp, sign(view), signatureWorkerConfig(env), now)).toThrow()
  })
  it('rejects malformed persisted worker inventories and cross-operation artifact paths', () => {
    const value = worker()
    expect(signatureWorkerActionSchema.safeParse(value).success).toBe(true)
    for (const broken of [{ ...value, arbitrary_url: 'https://example.invalid' }, { ...value, provider_account_id: actor },
      { ...value, originals: [value.originals[0], value.originals[0], value.originals[2]] },
      { ...value, originals: [{ ...value.originals[0], storage_path: 'another/path' }, ...value.originals.slice(1)] },
      { ...value, artifacts: [{ id: requestId, kind: 'CERTIFICATE', provider_document_id: 'certificate', path: 'other/path', sha256: hash, size: pdf.length, state: 'RESERVED' }] }]) expect(signatureWorkerActionSchema.safeParse(broken).success).toBe(false)
  })
  it('returns only claim identity and rejects background VIEW instead of leaking signer or provider fields', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ result: worker() }] })
    const result = await executeSignatureProcessing({ command: 'CLAIM', request_id: requestId })
    expect(result).toEqual({ action })
    expect(JSON.stringify(result)).not.toMatch(/email|token|signing_url|create_request|source_reference/)
    mocks.query.mockResolvedValueOnce({ rows: [{ result: worker('VIEW') }] })
    await expect(executeSignatureProcessing({ command: 'PROCESS', ...action })).rejects.toThrow('background worker')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not make provider HTTP calls when an already consumed checkpoint denies can_perform', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: [{ result: sql.includes('read_offering_signature_action') ? worker() : record }] }))
    expect(await executeSignatureProcessing({ command: 'PROCESS', ...action })).toEqual({ operation_id: operationId, outcome: 'ALREADY_CONSUMED' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    const checkpoint = mocks.query.mock.calls.find(call => String(call[0]).includes('record_offering_signature_action'))
    expect(checkpoint?.[1][4]).toBe(signatureResultId(action, 'RECONCILE:INFLIGHT'))
    expect(signatureResultId(action, 'RECONCILE:INFLIGHT')).not.toBe(signatureResultId({ ...action, generation: 2 }, 'RECONCILE:INFLIGHT'))
  })
  it('binds actor reads and command results to session, environment, revision and stripped view lease', async () => {
    expect(await readOfferingSignatures(input)).toEqual(snapshot())
    for (const changed of [{ actor_id: productId }, { session_id: actor }, { revision_id: productId }, { context: { ...context, role: 'ComplianceOfficer' } }, { environment: 'MAINNET' }]) {
      mocks.query.mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), ...changed } }] })
      await expect(readOfferingSignatures(input)).rejects.toThrow()
    }
    const command = { command: 'REQUEST_SIGNING_VIEW' as const, key: requestId, payload: { product_id: productId, offering_revision_id: revisionId, expected_revision: 3, operation_id: operationId } }
    mocks.query.mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), action } }] })
    expect(await executeOfferingSignatureCommand(input, command)).toEqual({ snapshot: snapshot(), viewAction: action })
    mocks.query.mockResolvedValueOnce({ rows: [{ result: { ...snapshot(), action: { ...action, request_id: actor } } }] })
    await expect(executeOfferingSignatureCommand(input, command)).rejects.toThrow()
  })
  it.each(['unknown', 'conflict'] as const)('reconciles %s storage upload at the same immutable path with independent hash read-back', async outcome => {
    if (outcome === 'unknown') mocks.upload.mockRejectedValueOnce(new Error('Synthetic interrupted upload'))
    else mocks.upload.mockResolvedValueOnce({ error: { message: 'Already exists' } })
    await retainSignatureArtifact({ environment: 'TESTNET', revisionId, operationId, artifactId: requestId, sha256: hash, size: pdf.length, bytes: pdf })
    const path = signatureArtifactPath('TESTNET', revisionId, operationId, requestId)
    expect(mocks.from).toHaveBeenCalledWith('bx1-offering-signatures')
    expect(mocks.upload).toHaveBeenCalledWith(path, pdf, expect.objectContaining({ upsert: false, contentType: 'application/pdf' }))
    expect(mocks.download).toHaveBeenCalledWith(path)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })
  it('rejects storage hash/media/size mismatches and oversized or invalid-path writes', async () => {
    const retained = { environment: 'TESTNET' as const, revisionId, operationId, artifactId: requestId, sha256: hash, size: pdf.length, bytes: pdf }
    mocks.download.mockResolvedValueOnce({ data: new Blob([new Uint8Array(Buffer.from(pdf.toString().replace('Synthetic', 'Tampered!')))], { type: 'application/pdf' }), error: null })
    await expect(retainSignatureArtifact(retained)).rejects.toThrow()
    mocks.download.mockResolvedValueOnce({ data: new Blob([new Uint8Array(pdf)], { type: 'text/plain' }), error: null })
    await expect(retainSignatureArtifact(retained)).rejects.toThrow()
    const before = mocks.upload.mock.calls.length
    await expect(retainSignatureArtifact({ ...retained, bytes: Buffer.alloc(4194305), size: 4194305 })).rejects.toThrow()
    await expect(retainSignatureArtifact({ ...retained, artifactId: '../outside' })).rejects.toThrow()
    expect(mocks.upload).toHaveBeenCalledTimes(before)
  })
  it('bounds actual storage streams and pins storage host/path even before SDK buffering', async () => {
    await retainSignatureArtifact({ environment: 'TESTNET', revisionId, operationId, artifactId: requestId, sha256: hash, size: pdf.length, bytes: pdf })
    const transport = mocks.create.mock.calls[0][2].global.fetch as typeof fetch
    await expect(transport('https://example.invalid/storage/v1/object/bx1-offering-signatures/file')).rejects.toThrow()
    await expect(transport(`${env.SUPABASE_URL}/storage/v1/object/other-bucket/file`)).rejects.toThrow()
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(4194305)))
    await expect(transport(`${env.SUPABASE_URL}/storage/v1/object/bx1-offering-signatures/file`)).rejects.toThrow()
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(pdf), { headers: { 'content-length': String(pdf.length + 1) } }))
    await expect(transport(`${env.SUPABASE_URL}/storage/v1/object/bx1-offering-signatures/file`)).rejects.toThrow()
  })
  it('downloads only the unique retained artifact in the exact authorised actor snapshot', async () => {
    const value = snapshot()
    value.authorisations = [{ id: productId, signer_id: actor, signer_person_id: actor, appointment_id: productId, state: 'REVOKED', valid_from: '2026-01-01T00:00:00Z', valid_until: '2027-01-01T00:00:00Z', source_reference: 'Synthetic historical purpose evidence.' }]
    value.operations = [{ id: operationId, authorisation_id: productId, state: 'SUPERSEDED', current: false, noncurrent_reason: 'Historical evidence only', envelope_id: operationId, next_check_at: null,
      artifacts: [{ id: requestId, kind: 'CERTIFICATE', sha256: hash, size: pdf.length, mime_type: 'application/pdf' }] }]
    expect(await downloadOfferingSignatureArtifact(input, value, requestId)).toEqual(new Uint8Array(pdf))
    await expect(downloadOfferingSignatureArtifact(input, value, actor)).rejects.toThrow()
    await expect(downloadOfferingSignatureArtifact({ ...input, actorId: productId }, value, requestId)).rejects.toThrow()
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })
})
