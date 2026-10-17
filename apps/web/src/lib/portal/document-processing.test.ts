import { createHash, createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const boundary = vi.hoisted(() => ({ query: vi.fn(), pool: vi.fn(), download: vi.fn(), bucket: vi.fn(), client: vi.fn() }))
vi.mock('pg', () => ({ Pool: class {
  constructor(config: unknown) { boundary.pool(config) }
  on() {}
  query = boundary.query
} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.client }))
import { documentProcessingConfig, documentProcessingDatabaseConfig, DocumentProcessingError,
  executeDocumentProcessing, verifyDocumentProcessingMessage } from './document-processing'

const now = Date.parse('2026-10-07T12:00:00Z')
const actor = '11111111-1111-4111-8111-111111111111'
const document = '22222222-2222-4222-8222-222222222222'
const attempt = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const bytes = Buffer.from('%PDF-1.4\nfictional document processing fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const env = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'A'.repeat(32)}`,
  BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic_adapter',
  BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'synthetic_worker',
  BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: 'postgresql://bx1_document_processing_worker.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
}
const manifest = { document_id: document, attempt_id: attempt, authority_epoch: 2, attempt_number: 1,
  worker_id: env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID, scanner_id: env.BLOCKXONE_DOCUMENT_SCANNER_ID,
  reference: `bx1-scan:${attempt}`, lease_expires_at: '2026-10-07T12:02:00Z', actor_id: actor,
  storage_path: `${actor}/${document}`, sha256, size: bytes.length, mime_type: 'application/pdf' }
const byteCommand = { command: 'BYTES' as const, document_id: document, attempt_id: attempt, authority_epoch: 2, sha256 }
function sign(raw: Uint8Array, timestamp = String(now / 1000), domain = 'bx1-document-processing-v1:') {
  return `sha256=${createHmac('sha256', Buffer.from(env.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY, 'base64url'))
    .update(domain).update(timestamp).update('.').update(raw).digest('hex')}`
}
function verified(command: unknown, timestamp = String(now / 1000)) {
  const raw = Buffer.from(JSON.stringify(command))
  return verifyDocumentProcessingMessage(raw, timestamp, sign(raw, timestamp), documentProcessingConfig(), now)
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  boundary.bucket.mockReturnValue({ download: boundary.download })
  boundary.client.mockReturnValue({ storage: { from: boundary.bucket } })
  boundary.download.mockResolvedValue({ data: new Blob([bytes]), error: null })
  boundary.query.mockResolvedValue({ rows: [{ result: manifest }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('document processing configuration and signed commands', () => {
  it('uses a distinct project-bound role with bounded verified TLS connections', () => {
    const config = documentProcessingDatabaseConfig(env)
    expect(config).toMatchObject({ user: 'bx1_document_processing_worker.fegnnnlseuejkrusbbkv',
      host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543, database: 'postgres', max: 1,
      connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 8000,
      statement_timeout: 7000, lock_timeout: 4000, application_name: 'bx1-document-processing',
      ssl: { rejectUnauthorized: true, servername: 'aws-0-eu-central-1.pooler.supabase.com' } })
    expect((config.ssl as { ca: string }).ca).toContain('BEGIN CERTIFICATE')
    expect(documentProcessingDatabaseConfig({ ...env, BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL:
      'postgresql://bx1_document_processing_worker:synthetic-only@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full' }))
      .toMatchObject({ user: 'bx1_document_processing_worker', port: 5432 })
  })
  it.each([
    ['wrong role', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('bx1_document_processing_worker.', 'postgres.')],
    ['scanner role', env.BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL],
    ['wrong project', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('fegnnnlseuejkrusbbkv', 'oqkevkjbkpugjotihtda')],
    ['wrong host', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('aws-0-eu-central-1.pooler.supabase.com', 'attacker.invalid')],
    ['wrong port', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace(':6543/', ':5432/')],
    ['wrong database', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('/postgres?', '/other?')],
    ['no password', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace(':synthetic-only@', '@')],
    ['weak TLS', env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('verify-full', 'require')],
    ['extra TLS option', `${env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL}&sslrootcert=attacker`],
    ['duplicate TLS option', `${env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL}&sslmode=verify-full`],
    ['fragment', `${env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL}#fragment`],
  ])('rejects %s', (_label, url) => {
    expect(() => documentProcessingDatabaseConfig({ ...env, BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: url })).toThrow(DocumentProcessingError)
  })
  it('requires the full current scanner configuration and canonical release, not an activation flag', () => {
    for (const field of ['BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID', 'BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL',
      'BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY', 'BLOCKXONE_DOCUMENT_SCANNER_ID', 'BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY',
      'BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL', 'BLOCKXONE_APP_ORIGIN'] as const) {
      expect(() => documentProcessingConfig({ ...env, [field]: undefined })).toThrow(DocumentProcessingError)
    }
    for (const worker of ['ab', 'Worker', 'x'.repeat(121), 'worker/other', 'worker other']) {
      expect(() => documentProcessingConfig({ ...env, BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: worker })).toThrow(DocumentProcessingError)
    }
    expect(() => documentProcessingConfig({ ...env, BLOCKXONE_ENVIRONMENT: 'MAINNET' })).toThrow(DocumentProcessingError)
    expect(documentProcessingConfig({ ...env, BLOCKXONE_DOCUMENT_PROCESSING_ACTIVATED: 'true' }).workerId).toBe('synthetic_worker')
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('binds MAIN configuration to the MAIN project without treating configuration as admission', () => {
    const main = { ...env, VERCEL_ENV: 'production', BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za',
      SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co',
      BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: env.BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL.replace('fegnnnlseuejkrusbbkv', 'oqkevkjbkpugjotihtda'),
      BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL.replace('fegnnnlseuejkrusbbkv', 'oqkevkjbkpugjotihtda') }
    expect(documentProcessingConfig(main).database.user).toBe('bx1_document_processing_worker.oqkevkjbkpugjotihtda')
    expect(() => documentProcessingConfig({ ...main, BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL }))
      .toThrow(DocumentProcessingError)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('authenticates exact raw bytes and separates the existing result callback domain', () => {
    const raw = Buffer.from(JSON.stringify({ command: 'CLAIM', request_id: requestId }))
    const config = documentProcessingConfig()
    const timestamp = String(now / 1000)
    expect(verifyDocumentProcessingMessage(raw, timestamp, sign(raw), config, now)).toEqual({ command: 'CLAIM', request_id: requestId })
    for (const signature of [sign(raw, timestamp, ''), `sha256=${'0'.repeat(64)}`, null, sign(raw).toUpperCase()]) {
      expect(() => verifyDocumentProcessingMessage(raw, timestamp, signature, config, now)).toThrow(DocumentProcessingError)
    }
    expect(() => verifyDocumentProcessingMessage(Buffer.concat([raw, Buffer.from(' ')]), timestamp, sign(raw), config, now)).toThrow(DocumentProcessingError)
    expect(() => verifyDocumentProcessingMessage(raw, timestamp, sign(raw), config, now + 300_001)).toThrow(DocumentProcessingError)
    expect(() => verifyDocumentProcessingMessage(raw, String(now / 1000 + 301), sign(raw, String(now / 1000 + 301)), config, now)).toThrow(DocumentProcessingError)
    expect(() => verifyDocumentProcessingMessage(raw, `${timestamp}.0`, sign(raw), config, now)).toThrow(DocumentProcessingError)
  })
  it.each([
    { command: 'CLAIM' }, { command: 'CLAIM', request_id: 'not-uuid' },
    { command: 'CLAIM', request_id: requestId, worker_id: 'other_worker' },
    { command: 'CLAIM', request_id: requestId, scanner_id: 'other_scanner' },
    { ...byteCommand, command: 'CLEAN' }, { ...byteCommand, command: 'PROMOTE' },
    { ...byteCommand, authority_epoch: 0 }, { ...byteCommand, authority_epoch: 1.5 },
    { ...byteCommand, authority_epoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...byteCommand, authority_epoch: '2' }, { ...byteCommand, sha256: 'A'.repeat(64) },
    { ...byteCommand, verdict: 'CLEAN' }, { ...byteCommand, command: 'FAIL', code: 'CLEAN' },
    { ...byteCommand, command: 'FAIL' },
  ])('rejects strict-schema violations %#', command => expect(() => verified(command)).toThrow(DocumentProcessingError))
  it('rejects signed malformed UTF-8 and oversized bodies', () => {
    const raw = Buffer.from([0xff])
    expect(() => verifyDocumentProcessingMessage(raw, String(now / 1000), sign(raw), documentProcessingConfig(), now)).toThrow('Malformed')
    const large = Buffer.alloc(4097, 32)
    expect(() => verifyDocumentProcessingMessage(large, String(now / 1000), sign(large), documentProcessingConfig(), now)).toThrow(DocumentProcessingError)
  })
})

describe('actual processing module with database and Storage boundaries mocked', () => {
  it('passes the same immutable request UUID on fresh-timestamp claim retries, including empty receipts', async () => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: manifest }] })
      .mockResolvedValueOnce({ rows: [{ result: null }] })
    const first = verified({ command: 'CLAIM', request_id: requestId })
    const retry = verified({ command: 'CLAIM', request_id: requestId }, String(now / 1000 + 1))
    expect(await executeDocumentProcessing(first, documentProcessingConfig())).toEqual({ command: 'CLAIM', job: manifest })
    expect(await executeDocumentProcessing(retry, documentProcessingConfig())).toEqual({ command: 'CLAIM', job: manifest })
    expect(await executeDocumentProcessing(retry, documentProcessingConfig())).toEqual({ command: 'CLAIM', job: null })
    for (const call of boundary.query.mock.calls) {
      expect(call).toEqual(['select bx1_private.claim_document_processing($1,$2,$3) as result', ['synthetic_worker', 'synthetic_adapter', requestId]])
    }
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it.each([
    { ...manifest, worker_id: 'other_worker' }, { ...manifest, scanner_id: 'other_scanner' },
    { ...manifest, reference: `bx1-scan:${requestId}` }, { ...manifest, storage_path: `other/${document}` },
    { ...manifest, lease_expires_at: '2026-10-07T11:59:59Z' }, { ...manifest, authority_epoch: '2' },
    { ...manifest, attempt_number: 6 }, { ...manifest, size: 4_194_305 },
    { ...manifest, size: 0 }, { ...manifest, sha256: 'A'.repeat(64) },
    { ...manifest, mime_type: 'text/html' }, { ...manifest, url: 'https://attacker.invalid' },
  ])('denies bad manifests %# without Storage access', async value => {
    boundary.query.mockResolvedValue({ rows: [{ result: value }] })
    await expect(executeDocumentProcessing({ command: 'CLAIM', request_id: requestId }, documentProcessingConfig())).rejects.toBeInstanceOf(DocumentProcessingError)
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it('rehashes exact quarantine bytes and reads the same current lease again before release', async () => {
    const result = await executeDocumentProcessing(byteCommand, documentProcessingConfig())
    expect(result).toEqual({ command: 'BYTES', documentId: document, bytes: new Uint8Array(bytes) })
    expect(boundary.query).toHaveBeenCalledTimes(2)
    for (const call of boundary.query.mock.calls) {
      expect(call).toEqual(['select bx1_private.read_document_processing($1,$2,$3,$4,$5) as result',
        [document, attempt, 2, 'synthetic_worker', 'synthetic_adapter']])
    }
    expect(boundary.bucket).toHaveBeenCalledWith('bx1-portal-quarantine')
    expect(boundary.download).toHaveBeenCalledWith(`${actor}/${document}`)
  })
  it('supports exact 4 MiB raw bytes rather than a base64 envelope', async () => {
    const maximum = Buffer.alloc(4_194_304, 19)
    const digest = createHash('sha256').update(maximum).digest('hex')
    boundary.query.mockResolvedValue({ rows: [{ result: { ...manifest, size: maximum.length, sha256: digest } }] })
    boundary.download.mockResolvedValue({ data: new Blob([maximum]), error: null })
    const result = await executeDocumentProcessing({ ...byteCommand, sha256: digest }, documentProcessingConfig())
    expect(result.command).toBe('BYTES')
    if (result.command === 'BYTES') {
      const delivered = Buffer.from(result.bytes)
      expect(delivered.byteLength).toBe(4_194_304)
      expect(createHash('sha256').update(delivered).digest('hex')).toBe(digest)
      expect(delivered.equals(maximum)).toBe(true)
    }
    expect(boundary.query).toHaveBeenCalledTimes(2)
    expect(boundary.download).toHaveBeenCalledOnce()
  })
  it.each([
    { ...byteCommand, document_id: requestId }, { ...byteCommand, attempt_id: requestId },
    { ...byteCommand, authority_epoch: 3 }, { ...byteCommand, sha256: 'a'.repeat(64) },
  ])('binds byte reads to the signed document, attempt, epoch and hash %#', async command => {
    await expect(executeDocumentProcessing(command, documentProcessingConfig())).rejects.toBeInstanceOf(DocumentProcessingError)
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it('does not release bytes after download if admission or lease authority was revoked', async () => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockRejectedValueOnce({ code: '42501', message: 'synthetic private SQL detail' })
    await expect(executeDocumentProcessing(byteCommand, documentProcessingConfig())).rejects.toMatchObject({ status: 403 })
    expect(boundary.download).toHaveBeenCalledOnce()
    expect(boundary.query).toHaveBeenCalledTimes(2)
  })
  it.each([null, { ...manifest, lease_expires_at: '2026-10-07T12:01:59Z' },
    { ...manifest, lease_expires_at: '2026-10-07T11:59:59Z' }, { ...manifest, authority_epoch: 3 }])
    ('rejects stale or changed post-download manifests %#', async value => {
      boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: value }] })
      await expect(executeDocumentProcessing(byteCommand, documentProcessingConfig())).rejects.toBeInstanceOf(DocumentProcessingError)
      expect(boundary.download).toHaveBeenCalledOnce()
    })
  it('never releases size/hash mismatches or raw Storage error details', async () => {
    boundary.download.mockResolvedValueOnce({ data: new Blob([Buffer.alloc(bytes.length, 1)]), error: null })
    await expect(executeDocumentProcessing(byteCommand, documentProcessingConfig())).rejects.toMatchObject({ status: 409 })
    boundary.download.mockResolvedValueOnce({ data: new Blob([bytes.subarray(1)]), error: null })
    await expect(executeDocumentProcessing(byteCommand, documentProcessingConfig())).rejects.toBeInstanceOf(DocumentProcessingError)
    boundary.download.mockRejectedValueOnce(new Error('sb_secret_fixture-secret https://private.example.invalid'))
    await expect(executeDocumentProcessing(byteCommand, documentProcessingConfig())).rejects.toThrow('Private document processing bytes could not be verified.')
    expect(boundary.query).toHaveBeenCalledTimes(3)
  })
  it.each(['ENGINE_UNAVAILABLE', 'INVALID_DOCUMENT', 'DELIVERY_FAILED', 'HASH_MISMATCH'] as const)
    ('reports only explicit %s failures with pinned identities and checked hash', async code => {
      const fatal = code === 'INVALID_DOCUMENT' || code === 'HASH_MISMATCH'
      const receipt = { document_id: document, attempt_id: attempt, state: fatal ? 'EXHAUSTED' : 'RETRY_WAIT', attempt_number: 1,
        next_attempt_at: fatal ? null : '2026-10-07T12:00:30Z' }
      boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: receipt }] })
      expect(await executeDocumentProcessing(verified({ ...byteCommand, command: 'FAIL', code }), documentProcessingConfig()))
        .toEqual({ command: 'FAIL', receipt })
      expect(boundary.query).toHaveBeenLastCalledWith('select bx1_private.fail_document_processing($1,$2,$3,$4,$5,$6) as result',
        [document, attempt, 2, 'synthetic_worker', 'synthetic_adapter', code])
      expect(boundary.client).not.toHaveBeenCalled()
    })
  it.each(['INVALID_DOCUMENT', 'HASH_MISMATCH'] as const)('denies an early fatal %s receipt that claims a retry', async code => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: {
      document_id: document, attempt_id: attempt, state: 'RETRY_WAIT', attempt_number: 1,
      next_attempt_at: '2026-10-07T12:00:30Z',
    } }] })
    await expect(executeDocumentProcessing(verified({ ...byteCommand, command: 'FAIL', code }), documentProcessingConfig()))
      .rejects.toMatchObject({ status: 409 })
  })
  it('rejects inconsistent failure receipts and sanitizes policy denials', async () => {
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: {
      document_id: document, attempt_id: attempt, state: 'EXHAUSTED', attempt_number: 1, next_attempt_at: null,
    } }] })
    await expect(executeDocumentProcessing(verified({ ...byteCommand, command: 'FAIL', code: 'ENGINE_UNAVAILABLE' }), documentProcessingConfig())).rejects.toMatchObject({ status: 409 })
    boundary.query.mockRejectedValueOnce({ code: '42501', message: 'NOLOGIN credential synthetic-only NOT_ADMITTED' })
    await expect(executeDocumentProcessing({ command: 'CLAIM', request_id: requestId }, documentProcessingConfig()))
      .rejects.toThrow('Document processing authority is unavailable or no longer current.')
    expect(boundary.client).not.toHaveBeenCalled()
  })
})
