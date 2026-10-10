import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'
import { platformRelease } from '@/lib/platform-release'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { DocumentLifecycleError, documentScannerConfig, downloadQuarantinedDocument, strictDocumentUtf8 } from './document-lifecycle'

type Environment = Record<string, string | undefined>
const identity = /^[a-z][a-z0-9_-]{2,119}$/
const uuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const epoch = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const leaseBinding = { document_id: uuid, attempt_id: uuid, authority_epoch: epoch, sha256: hash }
const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('CLAIM'), request_id: uuid }).strict(),
  z.object({ command: z.literal('BYTES'), ...leaseBinding }).strict(),
  z.object({ command: z.literal('FAIL'), ...leaseBinding,
    code: z.enum(['ENGINE_UNAVAILABLE', 'INVALID_DOCUMENT', 'DELIVERY_FAILED', 'HASH_MISMATCH']) }).strict(),
])
export type DocumentProcessingCommand = z.infer<typeof commandSchema>

const manifestSchema = z.object({
  document_id: uuid, attempt_id: uuid, authority_epoch: epoch,
  attempt_number: z.number().int().min(1).max(5),
  worker_id: z.string().regex(identity), scanner_id: z.string().regex(identity),
  reference: z.string().regex(/^bx1-scan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  lease_expires_at: z.string().datetime({ offset: true }), actor_id: uuid,
  storage_path: z.string().max(73), sha256: hash,
  size: z.number().int().min(1).max(4_194_304),
  mime_type: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
}).strict()
export type DocumentProcessingManifest = z.infer<typeof manifestSchema>
const failureSchema = z.object({
  document_id: uuid, attempt_id: uuid, state: z.enum(['RETRY_WAIT', 'EXHAUSTED']),
  attempt_number: z.number().int().min(1).max(5), next_attempt_at: z.string().datetime({ offset: true }).nullable(),
}).strict()

export class DocumentProcessingError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); this.name = 'DocumentProcessingError' }
}

/** Separate function-only role, exact release project, CA and hostname verification. */
export function documentProcessingDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    const release = platformRelease(env)
    if (!release) throw new Error()
    const project = release.environment === 'TESTNET' ? 'fegnnnlseuejkrusbbkv' : 'oqkevkjbkpugjotihtda'
    const url = new URL(env.BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL ?? '')
    const pooled = url.hostname === 'aws-0-eu-central-1.pooler.supabase.com'
    const direct = url.hostname === `db.${project}.supabase.co`
    const user = decodeURIComponent(url.username)
    const port = Number(url.port || (pooled ? 6543 : 5432))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!pooled && !direct)
      || user !== (pooled ? `bx1_document_processing_worker.${project}` : 'bx1_document_processing_worker')
      || !decodeURIComponent(url.password) || url.pathname !== '/postgres' || url.hash
      || port !== (pooled ? 6543 : 5432) || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
    return { host: url.hostname, port, database: 'postgres', user, password: decodeURIComponent(url.password),
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname },
      max: 1, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      application_name: 'bx1-document-processing' }
  } catch { throw new DocumentProcessingError('Private document processing is not configured.') }
}

export function documentProcessingConfig(env: Environment = process.env) {
  const workerId = env.BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID ?? ''
  if (!identity.test(workerId)) throw new DocumentProcessingError('Private document processing is not configured.')
  try {
    const scanner = documentScannerConfig(env)
    const database = documentProcessingDatabaseConfig(env)
    // Configuration is not admission. All commands still pass current database policy.
    return { workerId, scanner, database }
  } catch { throw new DocumentProcessingError('Private document processing is not configured.') }
}
type ProcessingConfig = ReturnType<typeof documentProcessingConfig>

export function verifyDocumentProcessingMessage(raw: Uint8Array, timestamp: string | null,
  signature: string | null, config: ProcessingConfig, now = Date.now()): DocumentProcessingCommand {
  if (raw.byteLength > 4096 || !timestamp || !/^[0-9]{10}$/.test(timestamp)
    || Math.abs(now - Number(timestamp) * 1000) > 300_000
    || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    throw new DocumentProcessingError('Document processing authentication failed.', 403)
  }
  const digest = createHmac('sha256', config.scanner.signingKey)
    .update('bx1-document-processing-v1:').update(timestamp).update('.').update(raw).digest()
  const supplied = Buffer.from(signature.slice(7), 'hex')
  if (supplied.length !== digest.length || !timingSafeEqual(supplied, digest)) {
    throw new DocumentProcessingError('Document processing authentication failed.', 403)
  }
  let parsed: unknown
  try { parsed = JSON.parse(strictDocumentUtf8(raw)) }
  catch { throw new DocumentProcessingError('Malformed document processing command.', 400) }
  const result = commandSchema.safeParse(parsed)
  if (!result.success) throw new DocumentProcessingError('Invalid document processing command.', 400)
  return result.data
}

let processingPool: Pool | undefined
let processingPoolBinding: string | undefined
async function processingQuery(sql: string, parameters: readonly unknown[], config: ProcessingConfig): Promise<unknown> {
  try {
    const binding = createHash('sha256').update(JSON.stringify(config.database)).digest('hex')
    if (processingPool && processingPoolBinding !== binding) throw new Error()
    if (!processingPool) {
      processingPool = new Pool(config.database)
      processingPoolBinding = binding
      processingPool.on('error', () => {})
    }
    const { rows } = await processingPool.query<{ result: unknown }>(sql, [...parameters])
    if (rows.length !== 1 || rows[0].result === undefined) throw new Error()
    return rows[0].result
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
      throw new DocumentProcessingError('Document processing authority is unavailable or no longer current.', 403)
    }
    throw new DocumentProcessingError('Private document processing could not be completed. Retry the same request.')
  }
}

function verifiedManifest(value: unknown, config: ProcessingConfig,
  command?: Exclude<DocumentProcessingCommand, { command: 'CLAIM' }>): DocumentProcessingManifest {
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) throw new DocumentProcessingError('Private document processing manifest is unavailable.', 409)
  const item = parsed.data
  if (item.worker_id !== config.workerId || item.scanner_id !== config.scanner.scannerId
    || item.reference !== `bx1-scan:${item.attempt_id}`
    || item.storage_path !== `${item.actor_id}/${item.document_id}`
    || !Number.isFinite(Date.parse(item.lease_expires_at)) || Date.parse(item.lease_expires_at) <= Date.now()
    || (command && (item.document_id !== command.document_id || item.attempt_id !== command.attempt_id
      || item.authority_epoch !== command.authority_epoch || item.sha256 !== command.sha256))) {
    throw new DocumentProcessingError('Private document processing lease does not match this request.', 409)
  }
  return item
}

async function readLease(command: Exclude<DocumentProcessingCommand, { command: 'CLAIM' }>,
  config: ProcessingConfig): Promise<DocumentProcessingManifest> {
  return verifiedManifest(await processingQuery(
    'select bx1_private.read_document_processing($1,$2,$3,$4,$5) as result',
    [command.document_id, command.attempt_id, command.authority_epoch, config.workerId, config.scanner.scannerId], config,
  ), config, command)
}

export type DocumentProcessingOutcome =
  | { command: 'CLAIM'; job: DocumentProcessingManifest | null }
  | { command: 'BYTES'; documentId: string; bytes: Uint8Array }
  | { command: 'FAIL'; receipt: z.infer<typeof failureSchema> }

/** No clean, promotion, requeue or policy command exists on this worker boundary. */
export async function executeDocumentProcessing(command: DocumentProcessingCommand,
  config: ProcessingConfig): Promise<DocumentProcessingOutcome> {
  if (command.command === 'CLAIM') {
    const value = await processingQuery('select bx1_private.claim_document_processing($1,$2,$3) as result',
      [config.workerId, config.scanner.scannerId, command.request_id], config)
    return { command: 'CLAIM', job: value === null ? null : verifiedManifest(value, config) }
  }
  const item = await readLease(command, config)
  if (command.command === 'FAIL') {
    const value = await processingQuery('select bx1_private.fail_document_processing($1,$2,$3,$4,$5,$6) as result',
      [command.document_id, command.attempt_id, command.authority_epoch, config.workerId, config.scanner.scannerId, command.code], config)
    const parsed = failureSchema.safeParse(value)
    const fatal = command.code === 'INVALID_DOCUMENT' || command.code === 'HASH_MISMATCH'
    if (!parsed.success || parsed.data.document_id !== item.document_id || parsed.data.attempt_id !== item.attempt_id
      || parsed.data.attempt_number !== item.attempt_number
      || (parsed.data.state === 'EXHAUSTED' && ((!fatal && parsed.data.attempt_number !== 5) || parsed.data.next_attempt_at !== null))
      || (parsed.data.state === 'RETRY_WAIT' && (fatal || parsed.data.attempt_number >= 5 || parsed.data.next_attempt_at === null))) {
      throw new DocumentProcessingError('Private document processing failure receipt is unavailable.', 409)
    }
    return { command: 'FAIL', receipt: parsed.data }
  }
  let bytes: Uint8Array
  try { bytes = await downloadQuarantinedDocument(config.scanner, item) }
  catch (error) {
    throw new DocumentProcessingError('Private document processing bytes could not be verified.',
      error instanceof DocumentLifecycleError ? error.status : 503)
  }
  if (bytes.byteLength !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw new DocumentProcessingError('Private document processing bytes do not match the manifest.', 409)
  }
  // Storage I/O can outlive a lease or an admission epoch. Recheck immediately
  // before returning exact bytes; a prior read is never authority for this release.
  const current = await readLease(command, config)
  if (JSON.stringify(current) !== JSON.stringify(item)) {
    throw new DocumentProcessingError('Private document processing lease changed before byte release.', 409)
  }
  return { command: 'BYTES', documentId: item.document_id, bytes }
}
