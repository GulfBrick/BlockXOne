import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'
import { documentProcessingConfig } from './document-processing'
import { documentScannerDatabaseConfig, strictDocumentUtf8 } from './document-lifecycle'

const quarantineBucket = 'bx1-offering-quarantine'
const cleanBucket = 'bx1-offering-documents'
const maxBytes = 4_194_304
const uuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const scanEventId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const identity = z.string().regex(/^[a-z][a-z0-9_-]{2,119}$/)
const kind = z.enum(['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'])
const binding = { file_id: uuid, attempt_id: uuid, authority_epoch: epoch, scanner_authority_epoch: epoch, sha256: hash }
const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('CLAIM'), request_id: uuid }).strict(),
  z.object({ command: z.literal('BYTES'), ...binding }).strict(),
  z.object({ command: z.literal('FAIL'), ...binding,
    code: z.enum(['ENGINE_UNAVAILABLE', 'INVALID_DOCUMENT', 'DELIVERY_FAILED', 'HASH_MISMATCH']) }).strict(),
])
export type OfferingDocumentProcessingCommand = z.infer<typeof commandSchema>

export const offeringProcessingManifestSchema = z.object({
  file_id: uuid, product_id: uuid, offering_revision_id: uuid, uploader_id: uuid,
  attempt_id: uuid, authority_epoch: epoch, scanner_authority_epoch: epoch,
  attempt_number: z.number().int().min(1).max(5), worker_id: identity, scanner_id: identity,
  reference: z.string().regex(/^bx1-offering-scan:[0-9a-f-]{36}$/),
  lease_expires_at: z.string().datetime({ offset: true }), storage_path: z.string().max(110),
  sha256: hash, size: z.number().int().min(1).max(maxBytes), mime_type: z.literal('application/pdf'), kind,
}).strict()
export type OfferingDocumentProcessingManifest = z.infer<typeof offeringProcessingManifestSchema>

const failureSchema = z.object({
  file_id: uuid, attempt_id: uuid, state: z.enum(['RETRY_WAIT', 'EXHAUSTED']),
  attempt_number: z.number().int().min(1).max(5), next_attempt_at: z.string().datetime({ offset: true }).nullable(),
}).strict()
const scanResultSchema = z.object({
  file_id: uuid, attempt_id: uuid, scan_event_id: scanEventId, verdict: z.enum(['CLEAN', 'MALICIOUS']),
  sha256: hash, scanner_id: identity, reference: z.string().regex(/^bx1-offering-scan:[0-9a-f-]{36}$/),
  observed_at: z.string().datetime({ offset: true }), authority_epoch: epoch, scanner_authority_epoch: epoch,
}).strict()
const scanInputSchema = z.object({ manifest: offeringProcessingManifestSchema, result: scanResultSchema.nullable() }).strict()
const recordedSchema = z.object({
  file_id: uuid, scan_event_id: scanEventId, state: z.enum(['RESULT_RECORDED', 'REJECTED']),
  sha256: hash, storage_path: z.string().max(110),
}).strict()
const scannerMessageSchema = z.object({
  file_id: uuid, sha256: hash, verdict: z.enum(['CLEAN', 'MALICIOUS']),
  reference: z.string().regex(/^bx1-offering-scan:[0-9a-f-]{36}$/),
  observed_at: z.string().datetime({ offset: true }), authority_epoch: epoch, scanner_authority_epoch: epoch,
}).strict()
const promotedSchema = z.object({
  file_id: uuid, product_id: uuid, offering_revision_id: uuid, clean_receipt_id: uuid, scan_event_id: scanEventId,
  state: z.literal('PROMOTED_CLEAN'), storage_path: z.string().max(110), sha256: hash,
  size: z.number().int().min(1).max(maxBytes), mime_type: z.literal('application/pdf'),
}).strict()

export class OfferingDocumentProcessingError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); this.name = 'OfferingDocumentProcessingError' }
}

/** Reuse function-only credentials, not admission jobs, paths or HMAC domains. */
export function offeringDocumentProcessingConfig(env: Record<string, string | undefined> = process.env) {
  try {
    const config = documentProcessingConfig(env)
    return { ...config, database: { ...config.database, application_name: 'bx1-offering-document-processing' },
      scannerDatabase: { ...documentScannerDatabaseConfig(env), application_name: 'bx1-offering-document-scan-result' } }
  } catch { throw new OfferingDocumentProcessingError('Private offering document processing is not configured.') }
}
type ProcessingConfig = ReturnType<typeof offeringDocumentProcessingConfig>

function authenticatedMessage(raw: Uint8Array, timestamp: string | null, signature: string | null,
  config: ProcessingConfig, domain: 'bx1-offering-document-processing-v1:' | 'bx1-offering-document-scan-v1:', now: number): unknown {
  if (raw.byteLength > 4096 || !timestamp || !/^[0-9]{10}$/.test(timestamp)
    || Math.abs(now - Number(timestamp) * 1000) > 300_000
    || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    throw new OfferingDocumentProcessingError('Offering document service authentication failed.', 403)
  }
  const expected = createHmac('sha256', config.scanner.signingKey).update(domain).update(timestamp).update('.').update(raw).digest()
  const supplied = Buffer.from(signature.slice(7), 'hex')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new OfferingDocumentProcessingError('Offering document service authentication failed.', 403)
  }
  try { return JSON.parse(strictDocumentUtf8(raw)) }
  catch { throw new OfferingDocumentProcessingError('Malformed offering document service message.', 400) }
}

export function verifyOfferingDocumentProcessingMessage(raw: Uint8Array, timestamp: string | null,
  signature: string | null, config: ProcessingConfig, now = Date.now()): OfferingDocumentProcessingCommand {
  const parsed = commandSchema.safeParse(authenticatedMessage(raw, timestamp, signature, config,
    'bx1-offering-document-processing-v1:', now))
  if (!parsed.success) throw new OfferingDocumentProcessingError('Invalid offering document processing command.', 400)
  return parsed.data
}

export function verifyOfferingScannerMessage(raw: Uint8Array, timestamp: string | null,
  signature: string | null, config: ProcessingConfig, now = Date.now()) {
  const parsed = scannerMessageSchema.safeParse(authenticatedMessage(raw, timestamp, signature, config,
    'bx1-offering-document-scan-v1:', now))
  if (!parsed.success || !uuid.safeParse(parsed.data?.reference.slice('bx1-offering-scan:'.length)).success) {
    throw new OfferingDocumentProcessingError('Invalid offering scanner result.', 400)
  }
  return parsed.data
}

const pools = new Map<'worker' | 'scanner', { pool: Pool; binding: string }>()
async function processingQuery(sql: string, parameters: readonly unknown[], config: ProcessingConfig,
  role: 'worker' | 'scanner' = 'worker'): Promise<unknown> {
  try {
    const database: PoolConfig = role === 'worker' ? config.database : config.scannerDatabase
    const poolBinding = createHash('sha256').update(JSON.stringify(database)).digest('hex')
    let entry = pools.get(role)
    if (entry && entry.binding !== poolBinding) throw new Error()
    if (!entry) {
      const pool = new Pool(database)
      pool.on('error', () => {})
      entry = { pool, binding: poolBinding }; pools.set(role, entry)
    }
    const { rows } = await entry.pool.query<{ result: unknown }>(sql, [...parameters])
    if (rows.length !== 1 || rows[0].result === undefined) throw new Error()
    return rows[0].result
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
      throw new OfferingDocumentProcessingError('Offering document processing authority is unavailable or no longer current.', 403)
    }
    throw new OfferingDocumentProcessingError('Offering document processing could not be confirmed. Retry the same request.')
  }
}

function verifiedManifest(value: unknown, config: ProcessingConfig,
  command?: Omit<Exclude<OfferingDocumentProcessingCommand, { command: 'CLAIM' }>, 'command'>,
  requireLiveLease = true): OfferingDocumentProcessingManifest {
  const parsed = offeringProcessingManifestSchema.safeParse(value)
  if (!parsed.success) throw new OfferingDocumentProcessingError('Offering document manifest is unavailable.', 409)
  const item = parsed.data
  if (item.worker_id !== config.workerId || item.scanner_id !== config.scanner.scannerId
    || item.reference !== `bx1-offering-scan:${item.attempt_id}`
    || item.storage_path !== `${item.offering_revision_id}/${item.uploader_id}/${item.file_id}`
    || (requireLiveLease && (Date.parse(item.lease_expires_at) <= Date.now() || Date.parse(item.lease_expires_at) > Date.now() + 120_000))
    || (command && (item.file_id !== command.file_id || item.attempt_id !== command.attempt_id
      || item.authority_epoch !== command.authority_epoch || item.scanner_authority_epoch !== command.scanner_authority_epoch
      || item.sha256 !== command.sha256))) {
    throw new OfferingDocumentProcessingError('Offering document processing lease does not match this request.', 409)
  }
  return item
}

function storageAdmin(config: ProcessingConfig, signal?: AbortSignal): SupabaseClient {
  return createClient(config.scanner.url, config.scanner.storageKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      if (!signal) return globalThis.fetch(input, { ...init, cache: 'no-store' })
      const combined = init?.signal ? AbortSignal.any([init.signal, signal]) : signal
      combined.throwIfAborted()
      return globalThis.fetch(input, { ...init, cache: 'no-store', signal: combined })
    } },
  })
}

async function verifiedDownload(client: SupabaseClient, bucket: typeof quarantineBucket | typeof cleanBucket,
  item: { storage_path: string; sha256: string; size: number }): Promise<Uint8Array> {
  const saved = await client.storage.from(bucket).download(item.storage_path)
  if (saved.error || !saved.data || saved.data.size !== item.size) {
    throw new OfferingDocumentProcessingError('Saved offering document bytes could not be verified.', 409)
  }
  const bytes = new Uint8Array(await saved.data.arrayBuffer())
  if (bytes.byteLength !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw new OfferingDocumentProcessingError('Saved offering document integrity verification failed.', 409)
  }
  return bytes
}

async function readLease(command: Exclude<OfferingDocumentProcessingCommand, { command: 'CLAIM' }>, config: ProcessingConfig) {
  return verifiedManifest(await processingQuery('select bx1_private.read_offering_document_processing($1,$2,$3,$4,$5) as result',
    [command.file_id, command.attempt_id, command.authority_epoch, config.workerId, config.scanner.scannerId], config), config, command)
}

export type OfferingDocumentProcessingOutcome =
  | { command: 'CLAIM'; job: OfferingDocumentProcessingManifest | null }
  | { command: 'BYTES'; fileId: string; bytes: Uint8Array }
  | { command: 'FAIL'; receipt: z.infer<typeof failureSchema> }

/** No clean verdict, promotion, policy or arbitrary-source command exists here. */
export async function executeOfferingDocumentProcessing(command: OfferingDocumentProcessingCommand,
  config: ProcessingConfig): Promise<OfferingDocumentProcessingOutcome> {
  if (command.command === 'CLAIM') {
    const value = await processingQuery('select bx1_private.claim_offering_document_processing($1,$2,$3) as result',
      [config.workerId, config.scanner.scannerId, command.request_id], config)
    return { command: 'CLAIM', job: value === null ? null : verifiedManifest(value, config) }
  }
  const item = await readLease(command, config)
  if (command.command === 'FAIL') {
    const value = await processingQuery('select bx1_private.fail_offering_document_processing($1,$2,$3,$4,$5,$6) as result',
      [item.file_id, item.attempt_id, item.authority_epoch, config.workerId, config.scanner.scannerId, command.code], config)
    const parsed = failureSchema.safeParse(value)
    const fatal = command.code === 'INVALID_DOCUMENT' || command.code === 'HASH_MISMATCH'
    if (!parsed.success || parsed.data.file_id !== item.file_id || parsed.data.attempt_id !== item.attempt_id
      || parsed.data.attempt_number !== item.attempt_number
      || (parsed.data.state === 'EXHAUSTED' && ((!fatal && item.attempt_number !== 5) || parsed.data.next_attempt_at !== null))
      || (parsed.data.state === 'RETRY_WAIT' && (fatal || item.attempt_number >= 5 || parsed.data.next_attempt_at === null))) {
      throw new OfferingDocumentProcessingError('Offering document failure receipt could not be verified.', 409)
    }
    return { command: 'FAIL', receipt: parsed.data }
  }
  const bytes = await verifiedDownload(storageAdmin(config), quarantineBucket, item)
  const current = await readLease(command, config)
  if (JSON.stringify(current) !== JSON.stringify(item)) {
    throw new OfferingDocumentProcessingError('Offering document processing authority changed before byte release.', 409)
  }
  return { command: 'BYTES', fileId: item.file_id, bytes }
}

function matchesResult(result: z.infer<typeof scanResultSchema>, item: OfferingDocumentProcessingManifest,
  message: z.infer<typeof scannerMessageSchema>): boolean {
  return result.file_id === item.file_id && result.attempt_id === item.attempt_id && result.sha256 === item.sha256
    && result.scanner_id === item.scanner_id && result.reference === item.reference
    && result.authority_epoch === item.authority_epoch && result.scanner_authority_epoch === item.scanner_authority_epoch
    && result.verdict === message.verdict && Date.parse(result.observed_at) === Date.parse(message.observed_at)
}

/** Exact result recovery rehashes source bytes; a return/outer HTTP status is not promotion. */
export async function acceptOfferingScannerMessage(raw: Uint8Array, timestamp: string | null,
  signature: string | null): Promise<{ id: string; state: 'PROMOTED_CLEAN' | 'REJECTED' }> {
  const config = offeringDocumentProcessingConfig()
  const message = verifyOfferingScannerMessage(raw, timestamp, signature, config)
  const attemptId = message.reference.slice('bx1-offering-scan:'.length)
  const input = scanInputSchema.safeParse(await processingQuery(
    'select bx1_private.read_offering_document_scan_input($1,$2,$3,$4,$5) as result',
    [message.file_id, attemptId, message.authority_epoch, config.workerId, config.scanner.scannerId], config, 'scanner'))
  if (!input.success) throw new OfferingDocumentProcessingError('Offering scanner input is unavailable.', 409)
  const item = verifiedManifest(input.data.manifest, config, { file_id: message.file_id, attempt_id: attemptId,
    authority_epoch: message.authority_epoch, scanner_authority_epoch: message.scanner_authority_epoch, sha256: message.sha256 },
  input.data.result === null)
  if (input.data.result && !matchesResult(input.data.result, item, message)) {
    throw new OfferingDocumentProcessingError('The earlier scanner result differs from this retry.', 409)
  }
  const client = storageAdmin(config)
  const bytes = await verifiedDownload(client, quarantineBucket, item)
  const recorded = recordedSchema.safeParse(await processingQuery(
    'select bx1_private.record_offering_document_scan($1,$2,$3,$4,$5,$6) as result',
    [item.file_id, item.sha256, config.scanner.scannerId, message.reference, message.verdict, message.observed_at], config, 'scanner'))
  if (!recorded.success || recorded.data.file_id !== item.file_id || recorded.data.sha256 !== item.sha256
    || recorded.data.storage_path !== item.storage_path
    || recorded.data.state !== (message.verdict === 'CLEAN' ? 'RESULT_RECORDED' : 'REJECTED')) {
    throw new OfferingDocumentProcessingError('The scanner result could not be bound to this offering document.', 409)
  }
  const confirmed = scanInputSchema.safeParse(await processingQuery(
    'select bx1_private.read_offering_document_scan_input($1,$2,$3,$4,$5) as result',
    [message.file_id, attemptId, message.authority_epoch, config.workerId, config.scanner.scannerId], config, 'scanner'))
  if (!confirmed.success || !confirmed.data.result || confirmed.data.result.scan_event_id !== recorded.data.scan_event_id
    || !matchesResult(confirmed.data.result, item, message)
    || JSON.stringify(verifiedManifest(confirmed.data.manifest, config, undefined, false)) !== JSON.stringify(item)) {
    throw new OfferingDocumentProcessingError('Offering scanner evidence or authority changed before delivery.', 409)
  }
  if (message.verdict === 'MALICIOUS') return { id: item.file_id, state: 'REJECTED' }
  const uploaded = await client.storage.from(cleanBucket).upload(item.storage_path, bytes, {
    contentType: 'application/pdf', cacheControl: '0', upsert: false, metadata: { sha256: item.sha256 },
  })
  await verifiedDownload(client, cleanBucket, item)
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
    throw new OfferingDocumentProcessingError('Clean offering document delivery could not be confirmed. Retry the same result.')
  }
  const promoted = promotedSchema.safeParse(await processingQuery(
    'select bx1_private.promote_scanned_offering_document($1) as result', [item.file_id], config, 'scanner'))
  if (!promoted.success || promoted.data.file_id !== item.file_id || promoted.data.product_id !== item.product_id
    || promoted.data.offering_revision_id !== item.offering_revision_id || promoted.data.scan_event_id !== recorded.data.scan_event_id
    || promoted.data.storage_path !== item.storage_path || promoted.data.sha256 !== item.sha256 || promoted.data.size !== item.size) {
    throw new OfferingDocumentProcessingError('The clean offering document receipt could not be verified.', 409)
  }
  return { id: item.file_id, state: 'PROMOTED_CLEAN' }
}

export type CleanOfferingDocumentReference = {
  id: string; revision_id: string; uploader_id: string; storage_path: string; sha256: string;
  size: number; mime_type: 'application/pdf';
}

/** Only a DB-authorised clean reference may be passed; route rechecks it after this I/O. */
export async function downloadCleanOfferingDocument(reference: CleanOfferingDocumentReference, signal?: AbortSignal): Promise<Uint8Array> {
  if (![reference.id, reference.revision_id, reference.uploader_id].every(value => uuid.safeParse(value).success)
    || reference.storage_path !== `${reference.revision_id}/${reference.uploader_id}/${reference.id}`
    || !hash.safeParse(reference.sha256).success || !Number.isSafeInteger(reference.size)
    || reference.size < 1 || reference.size > maxBytes || reference.mime_type !== 'application/pdf') {
    throw new OfferingDocumentProcessingError('Invalid clean offering document reference.', 409)
  }
  return verifiedDownload(storageAdmin(offeringDocumentProcessingConfig(), signal), cleanBucket, reference)
}
