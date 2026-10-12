import { createHash, createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const boundary = vi.hoisted(() => ({ query: vi.fn(), pool: vi.fn(), client: vi.fn(), bucket: vi.fn(), download: vi.fn(), upload: vi.fn() }))
vi.mock('pg', () => ({ Pool: class {
  constructor(config: unknown) { boundary.pool(config) }
  on() {}
  query(...args: unknown[]) { return boundary.query(...args) }
} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.client }))
import { acceptOfferingScannerMessage, downloadCleanOfferingDocument, executeOfferingDocumentProcessing,
  offeringDocumentProcessingConfig, OfferingDocumentProcessingError, verifyOfferingDocumentProcessingMessage,
  verifyOfferingScannerMessage } from './offering-document-processing'
import { POST } from '@/app/api/portal/offering-documents/processing/route'

// Transport mocks exercise denials and exact bindings, NOT engine/provider/hosted acceptance.
const now = Date.parse('2026-10-12T12:00:00Z')
const file = '11111111-1111-4111-8111-111111111111'
const product = '22222222-2222-4222-8222-222222222222'
const revision = '33333333-3333-4333-8333-333333333333'
const uploader = '44444444-4444-4444-8444-444444444444'
const attempt = '55555555-5555-4555-8555-555555555555'
const event = 1 // PostgreSQL BIGINT identity transported as a safe JSON integer.
const receipt = '77777777-7777-4777-8777-777777777777'
const bytes = Buffer.from('%PDF-1.4\n% Fictional offering service fixture\n%%EOF\n')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const env = {
  NODE_ENV: 'production',
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'A'.repeat(32)}`,
  BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic_adapter', BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'synthetic_worker',
  BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: 'postgresql://bx1_document_processing_worker.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
}
const manifest = { file_id: file, product_id: product, offering_revision_id: revision, uploader_id: uploader,
  attempt_id: attempt, authority_epoch: 2, scanner_authority_epoch: 3, attempt_number: 1,
  worker_id: env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID, scanner_id: env.BLOCKXONE_DOCUMENT_SCANNER_ID,
  reference: `bx1-offering-scan:${attempt}`, lease_expires_at: new Date(now + 120_000).toISOString(),
  storage_path: `${revision}/${uploader}/${file}`, sha256, size: bytes.length, mime_type: 'application/pdf', kind: 'MEMORANDUM' }
const byteCommand = { command: 'BYTES' as const, file_id: file, attempt_id: attempt, authority_epoch: 2, scanner_authority_epoch: 3, sha256 }
const message = { file_id: file, sha256, verdict: 'CLEAN' as const, reference: manifest.reference,
  observed_at: new Date(now).toISOString(), authority_epoch: 2, scanner_authority_epoch: 3 }
const result = { ...message, attempt_id: attempt, scan_event_id: event, scanner_id: env.BLOCKXONE_DOCUMENT_SCANNER_ID }
const promoted = { file_id: file, product_id: product, offering_revision_id: revision, clean_receipt_id: receipt,
  scan_event_id: event, state: 'PROMOTED_CLEAN', storage_path: manifest.storage_path, sha256, size: bytes.length, mime_type: 'application/pdf' }
const cleanReference = { id: file, revision_id: revision, uploader_id: uploader, storage_path: manifest.storage_path,
  sha256, size: bytes.length, mime_type: 'application/pdf' as const }

function signed(value: unknown, domain = 'bx1-offering-document-processing-v1:') {
  const raw = Buffer.from(JSON.stringify(value)), timestamp = String(now / 1000)
  const signature = `sha256=${createHmac('sha256', Buffer.from(env.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY, 'base64url'))
    .update(domain).update(timestamp).update('.').update(raw).digest('hex')}`
  return { raw, timestamp, signature }
}
function callback(value: unknown = message) {
  const request = signed(value, 'bx1-offering-document-scan-v1:')
  return acceptOfferingScannerMessage(request.raw, request.timestamp, request.signature)
}
function scannerReplies(verdict: 'CLEAN' | 'MALICIOUS' = 'CLEAN', committed = false, customManifest = manifest) {
  let reads = 0
  boundary.query.mockImplementation(async (sql: string) => {
    if (sql.includes('read_offering_document_scan_input')) return { rows: [{ result: {
      manifest: customManifest, result: committed || reads++ > 0 ? { ...result, verdict } : null,
    } }] }
    if (sql.includes('record_offering_document_scan')) return { rows: [{ result: {
      file_id: file, scan_event_id: event, state: verdict === 'CLEAN' ? 'RESULT_RECORDED' : 'REJECTED', sha256, storage_path: manifest.storage_path,
    } }] }
    if (sql.includes('promote_scanned_offering_document')) return { rows: [{ result: promoted }] }
    throw new Error('Unexpected fixture query')
  })
}

beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  boundary.bucket.mockReturnValue({ download: boundary.download, upload: boundary.upload })
  boundary.client.mockReturnValue({ storage: { from: boundary.bucket } })
  boundary.download.mockResolvedValue({ data: new Blob([bytes]), error: null })
  boundary.upload.mockResolvedValue({ data: { path: manifest.storage_path }, error: null })
  boundary.query.mockResolvedValue({ rows: [{ result: manifest }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('offering service domains and authority transport', () => {
  it('retains project-bound function-only roles and bounded verified TLS', () => {
    const config = offeringDocumentProcessingConfig(env)
    expect(config.database).toMatchObject({ application_name: 'bx1-offering-document-processing', max: 1,
      user: 'bx1_document_processing_worker.fegnnnlseuejkrusbbkv', query_timeout: 8000, statement_timeout: 7000,
      ssl: { rejectUnauthorized: true, servername: 'aws-0-eu-central-1.pooler.supabase.com' } })
    expect(config.scannerDatabase).toMatchObject({ application_name: 'bx1-offering-document-scan-result',
      user: 'bx1_document_scanner_writer.fegnnnlseuejkrusbbkv', lock_timeout: 4000 })
    expect(() => offeringDocumentProcessingConfig({ ...env, BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL:
      env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('bx1_document_processing_worker.', 'postgres.') }))
      .toThrow(OfferingDocumentProcessingError)
  })
  it('accepts only the offering processing HMAC domain', () => {
    const payload = { command: 'CLAIM', request_id: file }
    for (const domain of ['bx1-offering-document-processing-v1:', 'bx1-document-processing-v1:', 'bx1-offering-document-scan-v1:', '']) {
      const request = signed(payload, domain)
      const check = () => verifyOfferingDocumentProcessingMessage(request.raw, request.timestamp, request.signature, offeringDocumentProcessingConfig(), now)
      if (domain === 'bx1-offering-document-processing-v1:') expect(check()).toEqual(payload)
      else expect(check).toThrow('authentication failed')
    }
  })
  it.each([{ ...byteCommand, command: 'CLEAN' }, { ...byteCommand, bucket: 'public' },
    { ...byteCommand, url: 'https://untrusted.invalid' }, { ...byteCommand, document_id: file },
    { ...byteCommand, scanner_authority_epoch: 0 }])('rejects unsupported or extra processing fields %#', value => {
    const request = signed(value)
    expect(() => verifyOfferingDocumentProcessingMessage(request.raw, request.timestamp, request.signature, offeringDocumentProcessingConfig(), now))
      .toThrow(OfferingDocumentProcessingError)
  })
  it('verifies the separate scanner domain and rejects admission shape', () => {
    const request = signed(message, 'bx1-offering-document-scan-v1:')
    expect(verifyOfferingScannerMessage(request.raw, request.timestamp, request.signature, offeringDocumentProcessingConfig(), now)).toEqual(message)
    const bad = signed({ ...message, document_id: file }, 'bx1-offering-document-scan-v1:')
    expect(() => verifyOfferingScannerMessage(bad.raw, bad.timestamp, bad.signature, offeringDocumentProcessingConfig(), now)).toThrow('Invalid offering scanner result')
  })
  it('does not accept stale authentication or altered signed bytes', () => {
    const request = signed(byteCommand)
    expect(() => verifyOfferingDocumentProcessingMessage(request.raw, request.timestamp, request.signature, offeringDocumentProcessingConfig(), now + 300_001))
      .toThrow('authentication failed')
    expect(() => verifyOfferingDocumentProcessingMessage(Buffer.from('{}'), request.timestamp, request.signature, offeringDocumentProcessingConfig(), now))
      .toThrow('authentication failed')
  })
})

describe('offering lease-bound bytes and failures', () => {
  it('returns an empty durable queue without Storage I/O', async () => {
    boundary.query.mockResolvedValue({ rows: [{ result: null }] })
    expect(await executeOfferingDocumentProcessing({ command: 'CLAIM', request_id: file }, offeringDocumentProcessingConfig()))
      .toEqual({ command: 'CLAIM', job: null })
    expect(boundary.bucket).not.toHaveBeenCalled()
  })
  it('rechecks the exact current lease after independently hashing fixed quarantine bytes', async () => {
    const outcome = await executeOfferingDocumentProcessing(byteCommand, offeringDocumentProcessingConfig())
    expect(outcome).toEqual({ command: 'BYTES', fileId: file, bytes: new Uint8Array(bytes) })
    expect(boundary.bucket).toHaveBeenCalledWith('bx1-offering-quarantine')
    expect(boundary.download).toHaveBeenCalledWith(manifest.storage_path)
    expect(boundary.query).toHaveBeenCalledTimes(2)
  })
  it.each([{ ...manifest, storage_path: `${uploader}/${file}` }, { ...manifest, uploader_id: product },
    { ...manifest, mime_type: 'image/jpeg' }, { ...manifest, scanner_authority_epoch: 4 },
    { ...manifest, lease_expires_at: new Date(now - 1).toISOString() }])('denies incorrect manifest bindings before I/O %#', async value => {
    boundary.query.mockResolvedValue({ rows: [{ result: value }] })
    await expect(executeOfferingDocumentProcessing(byteCommand, offeringDocumentProcessingConfig())).rejects.toThrow(OfferingDocumentProcessingError)
    expect(boundary.bucket).not.toHaveBeenCalled()
  })
  it('never releases bytes after changed authority', async () => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockRejectedValueOnce({ code: '42501' })
    await expect(executeOfferingDocumentProcessing(byteCommand, offeringDocumentProcessingConfig())).rejects.toMatchObject({ status: 403 })
  })
  it('rejects a byte hash mismatch without manufacturing a result', async () => {
    boundary.download.mockResolvedValue({ data: new Blob([Buffer.alloc(bytes.length)]), error: null })
    await expect(executeOfferingDocumentProcessing(byteCommand, offeringDocumentProcessingConfig())).rejects.toThrow('integrity verification failed')
    expect(boundary.query).toHaveBeenCalledTimes(1)
  })
  it('validates fatal failure state and stable attempt identity', async () => {
    const failure = { file_id: file, attempt_id: attempt, state: 'EXHAUSTED', attempt_number: 1, next_attempt_at: null }
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: failure }] })
    expect(await executeOfferingDocumentProcessing({ ...byteCommand, command: 'FAIL', code: 'HASH_MISMATCH' }, offeringDocumentProcessingConfig()))
      .toEqual({ command: 'FAIL', receipt: failure })
  })
})

describe('offering signed result, copy and exact recovery', () => {
  it.each(['66666666-6666-4666-8666-666666666666', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid stored scan-event identity before Storage I/O %#', async scanEvent => {
      boundary.query.mockResolvedValue({ rows: [{ result: { manifest, result: { ...result, scan_event_id: scanEvent } } }] })
      await expect(callback()).rejects.toThrow('scanner input is unavailable')
      expect(boundary.bucket).not.toHaveBeenCalled()
    },
  )
  it.each(['66666666-6666-4666-8666-666666666666', 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid recorded event before clean delivery %#', async scanEvent => {
      boundary.query.mockImplementation(async (sql: string) => ({ rows: [{ result: sql.includes('read_offering_document_scan_input')
        ? { manifest, result: null }
        : { file_id: file, scan_event_id: scanEvent, state: 'RESULT_RECORDED', sha256, storage_path: manifest.storage_path } }] }))
      await expect(callback()).rejects.toThrow('could not be bound')
      expect(boundary.upload).not.toHaveBeenCalled()
    },
  )
  it('rejects a different numeric event at the current committed-evidence recheck', async () => {
    let reads = 0
    boundary.query.mockImplementation(async (sql: string) => ({ rows: [{ result: sql.includes('read_offering_document_scan_input')
      ? { manifest, result: reads++ === 0 ? null : { ...result, scan_event_id: event + 1 } }
      : { file_id: file, scan_event_id: event, state: 'RESULT_RECORDED', sha256, storage_path: manifest.storage_path } }] }))
    await expect(callback()).rejects.toThrow('evidence or authority changed')
    expect(boundary.upload).not.toHaveBeenCalled()
  })
  it.each(['66666666-6666-4666-8666-666666666666', 1.5, Number.MAX_SAFE_INTEGER + 1, event + 1])(
    'never acknowledges an invalid or different promoted event %#', async scanEvent => {
      scannerReplies()
      const normalQuery = boundary.query.getMockImplementation()!
      boundary.query.mockImplementation(async (sql: string) => sql.includes('promote_scanned_offering_document')
        ? { rows: [{ result: { ...promoted, scan_event_id: scanEvent } }] }
        : normalQuery(sql))
      await expect(callback()).rejects.toThrow('clean offering document receipt could not be verified')
    },
  )
  it('confirms current committed evidence, copies exact bytes without upsert and verifies SQL promotion', async () => {
    scannerReplies()
    expect(await callback()).toEqual({ id: file, state: 'PROMOTED_CLEAN' })
    expect(boundary.upload).toHaveBeenCalledWith(manifest.storage_path, new Uint8Array(bytes), {
      contentType: 'application/pdf', cacheControl: '0', upsert: false, metadata: { sha256 },
    })
    expect(boundary.bucket.mock.calls.map(call => call[0])).toEqual(['bx1-offering-quarantine', 'bx1-offering-documents', 'bx1-offering-documents'])
  })
  it('rejects malicious evidence without copying or promoting', async () => {
    scannerReplies('MALICIOUS')
    expect(await callback({ ...message, verdict: 'MALICIOUS' })).toEqual({ id: file, state: 'REJECTED' })
    expect(boundary.upload).not.toHaveBeenCalled()
    expect(boundary.query.mock.calls.some(call => String(call[0]).includes('promote_scanned'))).toBe(false)
  })
  it('can recover exact already-committed evidence after expiry, without accepting an expired new attempt', async () => {
    scannerReplies('CLEAN', true, { ...manifest, lease_expires_at: new Date(now - 1).toISOString() })
    boundary.upload.mockResolvedValue({ data: null, error: { message: 'already exists' } })
    expect(await callback()).toEqual({ id: file, state: 'PROMOTED_CLEAN' })
    scannerReplies('CLEAN', false, { ...manifest, lease_expires_at: new Date(now - 1).toISOString() })
    await expect(callback()).rejects.toThrow('lease does not match')
  })
  it('does not turn failed committed-evidence recheck into clean delivery', async () => {
    let reads = 0
    boundary.query.mockImplementation(async (sql: string) => {
      if (sql.includes('read_offering_document_scan_input')) return { rows: [{ result: {
        manifest, result: reads++ === 0 ? null : { ...result, verdict: 'MALICIOUS' },
      } }] }
      return { rows: [{ result: { file_id: file, scan_event_id: event, state: 'RESULT_RECORDED', sha256, storage_path: manifest.storage_path } }] }
    })
    await expect(callback()).rejects.toThrow('evidence or authority changed')
    expect(boundary.upload).not.toHaveBeenCalled()
  })
  it('keeps unknown result persistence a retry, never sends a failure command', async () => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: { manifest, result: null } }] }).mockRejectedValueOnce({ code: '08006', message: 'private details' })
    await expect(callback()).rejects.toThrow('Retry the same request')
    expect(boundary.query.mock.calls.some(call => String(call[0]).includes('fail_offering'))).toBe(false)
    expect(boundary.upload).not.toHaveBeenCalled()
  })
  it('downloads only a fixed clean reference, not caller-selected source paths', async () => {
    expect(await downloadCleanOfferingDocument(cleanReference)).toEqual(new Uint8Array(bytes))
    expect(boundary.bucket).toHaveBeenCalledWith('bx1-offering-documents')
    boundary.bucket.mockClear()
    await expect(downloadCleanOfferingDocument({ ...cleanReference, storage_path: 'other/../object' })).rejects.toThrow('Invalid clean')
    expect(boundary.bucket).not.toHaveBeenCalled()
  })
})

describe('actual offering processing POST with mocked external boundaries', () => {
  const endpoint = 'https://testnet.bx1.co.za/api/portal/offering-documents/processing'
  const claim = { command: 'CLAIM', request_id: file }
  const request = (value: unknown = claim, headers: Record<string, string> = {}, url = endpoint) => {
    const auth = signed(value)
    return new NextRequest(url, { method: 'POST', headers: { host: 'testnet.bx1.co.za', 'content-type': 'application/json',
      'x-bx1-scanner-timestamp': auth.timestamp, 'x-bx1-scanner-signature': auth.signature, ...headers }, body: auth.raw })
  }
  const privateResult = (response: Response) => {
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  }
  it('returns only a current durable claim, never inferred scan or promotion', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200); privateResult(response)
    expect(await response.json()).toEqual({ job: manifest })
    expect(boundary.query).toHaveBeenCalledWith('select bx1_private.claim_offering_document_processing($1,$2,$3) as result',
      ['synthetic_worker', 'synthetic_adapter', file])
    expect(boundary.bucket).not.toHaveBeenCalled()
  })
  it.each([{ origin: 'https://testnet.bx1.co.za' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' },
    { host: 'untrusted.invalid' }] as Record<string, string>[])('rejects nonservice headers before database access %#', async headers => {
    const response = await POST(request(claim, headers))
    expect(response.status).toBe(403); privateResult(response)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it.each([`${endpoint}?command=CLAIM`, 'https://untrusted.invalid/api/portal/offering-documents/processing'])('rejects noncanonical URL %s', async url => {
    const response = await POST(request(claim, {}, url))
    expect(response.status).toBe(403); privateResult(response)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('denies cookie-only service calls and wrong media before processing', async () => {
    const response = await POST(request(claim, { cookie: 'untrusted-browser-session', 'x-bx1-scanner-signature': '' }))
    expect(response.status).toBe(403); privateResult(response)
    expect(boundary.query).not.toHaveBeenCalled()
    const wrong = await POST(request(claim, { 'content-type': 'text/plain' }))
    expect(wrong.status).toBe(415); privateResult(wrong)
  })
  it('bounds actual request bytes and protects the raw verified byte response', async () => {
    const oversized = await POST(request({ command: 'CLAIM', request_id: file, padding: 'x'.repeat(4096) }))
    expect(oversized.status).toBe(413); privateResult(oversized)
    expect(boundary.query).not.toHaveBeenCalled()
    const response = await POST(request(byteCommand))
    expect(response.status).toBe(200); privateResult(response)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-length')).toBe(String(bytes.length))
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
