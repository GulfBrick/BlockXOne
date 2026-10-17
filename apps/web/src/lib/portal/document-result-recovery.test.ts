import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const boundary = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn(), upload: vi.fn(), bucket: vi.fn(), client: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { on() {}; query = boundary.query } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.client }))
import { recoverRecordedDocumentResult } from './document-lifecycle'
import { documentProcessingConfig, executeDocumentProcessing, verifyDocumentProcessingMessage } from './document-processing'

const now = Date.parse('2026-10-15T19:00:00Z')
const document = '22222222-2222-4222-8222-222222222222'
const attempt = '33333333-3333-4333-8333-333333333333'
const actor = '11111111-1111-4111-8111-111111111111'
const bytes = Buffer.from('%PDF-1.4\nrecorded-result transport fixture\n%%EOF\n')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const env = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'A'.repeat(32)}`,
  BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic_adapter', BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'synthetic_worker',
  BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: 'postgresql://bx1_document_processing_worker.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full' }
const binding = { document_id: document, attempt_id: attempt, authority_epoch: 2 }
const saved = { ...binding, worker_id: 'synthetic_worker', scanner_id: 'synthetic_adapter', scan_event_id: 17,
  sha256, verdict: 'CLEAN', reference: `bx1-scan:${attempt}`, observed_at: '2026-10-01T12:00:00+00:00' }
const item = { id: document, actor_id: actor, storage_path: `${actor}/${document}`, sha256, size: bytes.length,
  mime_type: 'application/pdf', state: 'SCANNED_CLEAN' }
const command = { command: 'RECOVER_RESULT' as const, ...binding }
function signed(value: unknown, domain = 'bx1-document-processing-v1:', timestamp = String(now / 1000)) {
  const raw = Buffer.from(JSON.stringify(value))
  return { raw, timestamp, signature: `sha256=${createHmac('sha256', Buffer.from(env.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY, 'base64url'))
    .update(domain).update(timestamp).update('.').update(raw).digest('hex')}` }
}
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  boundary.client.mockReturnValue({ storage: { from: boundary.bucket } })
  boundary.bucket.mockReturnValue({ download: boundary.download, upload: boundary.upload })
  boundary.download.mockResolvedValue({ data: new Blob([bytes]), error: null })
  boundary.upload.mockResolvedValue({ error: null })
  boundary.query.mockImplementation(async (sql: string) => ({ rows: [{ result:
    sql.includes('read_document_processing_recorded_result') ? saved
      : sql.includes('read_quarantined_document') || sql.includes('record_document_scan') ? item
        : sql.includes('promote_scanned_document') ? { ...item, validation_state: 'SCANNED_CLEAN' } : null }] }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('recorded document result continuation, external boundaries mocked', () => {
  it('resumes the exact accepted event after a long wait and rehashes both objects without a claim or scan', async () => {
    expect(await executeDocumentProcessing(command, documentProcessingConfig())).toEqual({ command: 'RECOVER_RESULT',
      receipt: { id: document, state: 'SCANNED_CLEAN' } })
    expect(boundary.download).toHaveBeenCalledTimes(2)
    expect(boundary.upload).toHaveBeenCalledExactlyOnceWith(item.storage_path, new Uint8Array(bytes), {
      contentType: 'application/pdf', cacheControl: '0', upsert: false, metadata: { sha256 } })
    const reads = boundary.query.mock.calls.filter(([sql]) => sql.includes('read_document_processing_recorded_result'))
    expect(reads).toHaveLength(3)
    for (const call of reads) expect(call[1]).toEqual([document, attempt, 2, 'synthetic_worker', 'synthetic_adapter'])
    expect(boundary.query).toHaveBeenCalledWith('select bx1_private.record_document_scan($1,$2,$3,$4,$5,$6) as result',
      [document, sha256, 'synthetic_adapter', saved.reference, 'CLEAN', saved.observed_at])
    expect(boundary.query.mock.calls.some(([sql]) => /claim_|fail_|insert |update /i.test(sql))).toBe(false)
  })
  it('repeats recovery idempotently and tolerates an already-delivered matching object', async () => {
    boundary.upload.mockResolvedValue({ error: { message: 'The resource already exists' } })
    for (let index = 0; index < 2; index++) expect(await recoverRecordedDocumentResult(binding, 'synthetic_worker'))
      .toEqual({ id: document, state: 'SCANNED_CLEAN' })
    expect(boundary.download).toHaveBeenCalledTimes(4)
    expect(boundary.query.mock.calls.filter(([sql]) => sql.includes('promote_scanned_document'))).toHaveLength(2)
  })
  it.each(['document_scan_required', 'arbitrary resolved upload failure'])(
    'uses exact existing final bytes and canonical promotion rather than the upload error text: %s', async message => {
      boundary.upload.mockResolvedValue({ error: { statusCode: '400', message } })
      expect(await recoverRecordedDocumentResult(binding, 'synthetic_worker')).toEqual({ id: document, state: 'SCANNED_CLEAN' })
      expect(boundary.download).toHaveBeenCalledTimes(2)
      expect(boundary.query.mock.calls.filter(([sql]) => sql.includes('read_document_processing_recorded_result'))).toHaveLength(3)
      expect(boundary.query).toHaveBeenLastCalledWith('select bx1_private.promote_scanned_document($1) as result', [document])
    })
  it.each(['missing', 'wrong-size', 'wrong-hash'])(
    'cannot promote after an upload error when the final object is %s', async failure => {
      boundary.upload.mockResolvedValue({ error: { message: 'document_scan_required' } })
      boundary.download.mockResolvedValueOnce({ data: new Blob([bytes]), error: null })
        .mockResolvedValueOnce(failure === 'missing' ? { data: null, error: { message: 'not found' } }
          : { data: new Blob([failure === 'wrong-size' ? bytes.subarray(1) : Buffer.alloc(bytes.length, 1)]), error: null })
      await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow()
      expect(boundary.query.mock.calls.some(([sql]) => sql.includes('promote_scanned_document'))).toBe(false)
    })
  it('still fails when native promotion rejects the original event or object authority', async () => {
    boundary.upload.mockResolvedValue({ error: { message: 'document_scan_required' } })
    boundary.query.mockImplementation(async (sql: string) => {
      if (sql.includes('promote_scanned_document')) throw { code: '42501', message: 'private native authority detail' }
      return { rows: [{ result: sql.includes('read_document_processing_recorded_result') ? saved : item }] }
    })
    await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow('Independent scanner result could not be recorded.')
    expect(boundary.query.mock.calls.filter(([sql]) => sql.includes('promote_scanned_document'))).toHaveLength(1)
  })
  it.each([null, { ...saved, document_id: actor }, { ...saved, attempt_id: actor }, { ...saved, authority_epoch: 3 },
    { ...saved, scanner_id: 'other_scanner' }, { ...saved, worker_id: 'other_worker' }, { ...saved, reference: `bx1-scan:${actor}` },
    { ...saved, scan_event_id: 0 }, { ...saved, scan_event_id: Number.MAX_SAFE_INTEGER + 1 }, { ...saved, verdict: 'UNKNOWN' },
    { ...saved, invented: true }])('denies missing or inconsistent durable evidence before Storage %#', async value => {
      boundary.query.mockResolvedValue({ rows: [{ result: value }] })
      await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow()
      expect(boundary.client).not.toHaveBeenCalled()
    })
  it('stops if the accepted result or policy changes during the quarantine download', async () => {
    let reads = 0
    boundary.query.mockImplementation(async (sql: string) => ({ rows: [{ result: sql.includes('read_document_processing_recorded_result')
      ? reads++ === 0 ? saved : { ...saved, scan_event_id: 18 } : item }] }))
    await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow('no longer current')
    expect(boundary.upload).not.toHaveBeenCalled()
    expect(boundary.query.mock.calls.some(([sql]) => sql.includes('record_document_scan'))).toBe(false)
  })
  it('cannot promote if authority is revoked after delivery or final bytes differ', async () => {
    let reads = 0
    boundary.query.mockImplementation(async (sql: string) => {
      if (sql.includes('read_document_processing_recorded_result') && ++reads === 3) throw { code: '42501' }
      return { rows: [{ result: sql.includes('read_document_processing_recorded_result') ? saved : item }] }
    })
    await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow()
    expect(boundary.query.mock.calls.some(([sql]) => sql.includes('promote_scanned_document'))).toBe(false)
    boundary.query.mockClear(); boundary.download.mockResolvedValueOnce({ data: new Blob([Buffer.alloc(bytes.length, 1)]), error: null })
    await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toThrow()
    expect(boundary.query.mock.calls.some(([sql]) => sql.includes('record_document_scan'))).toBe(false)
  })
  it('preserves an accepted malicious result without copying or promoting it', async () => {
    boundary.query.mockImplementation(async (sql: string) => ({ rows: [{ result: sql.includes('read_document_processing_recorded_result')
      ? { ...saved, verdict: 'MALICIOUS' } : { ...item, state: 'REJECTED' } }] }))
    expect(await recoverRecordedDocumentResult(binding, 'synthetic_worker')).toEqual({ id: document, state: 'REJECTED' })
    expect(boundary.upload).not.toHaveBeenCalled()
    expect(boundary.query.mock.calls.some(([sql]) => sql.includes('promote_scanned_document'))).toBe(false)
  })
  it('forbids MAIN before opening a database or Storage connection', async () => {
    vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    await expect(recoverRecordedDocumentResult(binding, 'synthetic_worker')).rejects.toMatchObject({ status: 403 })
    expect(boundary.query).not.toHaveBeenCalled(); expect(boundary.client).not.toHaveBeenCalled()
  })
})

describe('strict signed recovery command and SQL boundary', () => {
  it('uses a fresh processing-domain HMAC and accepts no verdict or evidence override', () => {
    const valid = signed(command)
    expect(verifyDocumentProcessingMessage(valid.raw, valid.timestamp, valid.signature, documentProcessingConfig(), now)).toEqual(command)
    for (const value of [{ ...command, verdict: 'CLEAN' }, { ...command, observed_at: saved.observed_at },
      { ...command, reference: saved.reference }, { ...command, scan_event_id: saved.scan_event_id },
      { ...command, worker_id: 'other_worker' }, { ...command, authority_epoch: 0 }]) {
      const request = signed(value)
      expect(() => verifyDocumentProcessingMessage(request.raw, request.timestamp, request.signature, documentProcessingConfig(), now)).toThrow()
    }
    for (const request of [signed(command, ''), signed(command, 'bx1-document-processing-v1:', String(now / 1000 - 301))]) {
      expect(() => verifyDocumentProcessingMessage(request.raw, request.timestamp, request.signature, documentProcessingConfig(), now)).toThrow()
    }
  })
  it('keeps the new reader closed and bound to an existing exact current event, not a live lease', () => {
    const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_document_result_recovery.sql'), 'utf8')
    expect(sql).toContain("environment='TESTNET'")
    expect(sql).toContain('policy:=bx1_private.document_processing_authority(p_worker,p_scanner)')
    expect(sql).toContain('job.current_attempt_id is distinct from attempt.id')
    expect(sql).toContain('attempt.authority_epoch is distinct from policy.authority_epoch')
    expect(sql).toContain('scan.scanner_reference is distinct from attempt.reference')
    expect(sql).toContain('item.scanned_at is distinct from scan.observed_at')
    expect(sql).toContain('attempt.outcome is distinct from scan.verdict')
    expect(sql).not.toMatch(/lease_expires_at\s*[<>]|insert into|update bx1_|delete from/i)
    expect(sql).toContain('to bx1_document_scanner_writer;')
    expect(sql).toContain('pg_catalog.aclexplode')
    expect(sql).toContain('and a.grantee<>p.proowner')
    expect(sql).toContain("c.conrelid='bx1_private.document_scan_events'::regclass and c.contype='u'")
  })
})
