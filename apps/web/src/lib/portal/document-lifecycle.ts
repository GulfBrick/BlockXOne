import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'
import { platformRelease } from '@/lib/platform-release'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import type { EvidenceDocument } from './contracts'
import { documentReceiptQuery } from './document-receipts'

const quarantineBucket = 'bx1-portal-quarantine'
const finalBucket = 'bx1-portal-documents'
type Environment = Record<string, string | undefined>
type QuarantineRecord = {
  id: string; actor_id: string; storage_path: string; sha256: string
  size: number; mime_type: string; state: 'QUARANTINED' | 'SCANNED_CLEAN' | 'REJECTED' | 'PROMOTED'
}

export class DocumentLifecycleError extends Error {
  constructor(message: string, public readonly status = 503) { super(message); this.name = 'DocumentLifecycleError' }
}

export function documentScannerConfig(env: Environment = process.env): {
  url: string; storageKey: string; scannerId: string; signingKey: Buffer
} {
  const release = platformRelease(env)
  const url = env.SUPABASE_URL ?? ''
  const storageKey = env.BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY ?? ''
  const scannerId = env.BLOCKXONE_DOCUMENT_SCANNER_ID ?? ''
  const encoded = env.BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY ?? ''
  const signingKey = /^[A-Za-z0-9_-]{43,86}$/.test(encoded) ? Buffer.from(encoded, 'base64url') : Buffer.alloc(0)
  if (!release || url !== `https://${release.environment === 'TESTNET' ? 'fegnnnlseuejkrusbbkv' : 'oqkevkjbkpugjotihtda'}.supabase.co`
    || !/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(storageKey)
    || !/^[a-z][a-z0-9_-]{2,119}$/.test(scannerId)
    || signingKey.length < 32 || signingKey.length > 64 || signingKey.toString('base64url') !== encoded) {
    throw new DocumentLifecycleError('Private document scanner is not configured. No document has been released.')
  }
  documentScannerDatabaseConfig(env)
  return { url, storageKey, scannerId, signingKey }
}

function storageAdmin(config: ReturnType<typeof documentScannerConfig>): SupabaseClient {
  return createClient(config.url, config.storageKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => globalThis.fetch(input, { ...init, cache: 'no-store' }) },
  })
}

export function documentScannerDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    const release = platformRelease(env)
    if (!release) throw new Error()
    const project = release.environment === 'TESTNET' ? 'fegnnnlseuejkrusbbkv' : 'oqkevkjbkpugjotihtda'
    const url = new URL(env.BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL ?? '')
    const pooler = url.hostname === 'aws-0-eu-central-1.pooler.supabase.com'
    const direct = url.hostname === `db.${project}.supabase.co`
    const user = decodeURIComponent(url.username)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!pooler && !direct)
      || user !== (pooler ? `bx1_document_scanner_writer.${project}` : 'bx1_document_scanner_writer')
      || !decodeURIComponent(url.password) || url.pathname !== '/postgres' || url.hash
      || Number(url.port || (pooler ? 6543 : 5432)) !== (pooler ? 6543 : 5432)
      || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
    return { host: url.hostname, port: pooler ? 6543 : 5432, database: 'postgres', user,
      password: decodeURIComponent(url.password),
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname },
      max: 1, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      application_name: 'bx1-document-scanner-result' }
  } catch { throw new DocumentLifecycleError('Independent scanner result writer is not configured.') }
}

let scannerPool: Pool | undefined
async function scannerQuery<T>(sql: string, parameters: readonly unknown[]): Promise<T> {
  try {
    if (!scannerPool) {
      scannerPool = new Pool(documentScannerDatabaseConfig())
      scannerPool.on('error', () => {})
    }
    const { rows } = await scannerPool.query<{ result: T }>(sql, [...parameters])
    if (rows.length !== 1 || rows[0].result === null || rows[0].result === undefined) throw new Error()
    return rows[0].result
  } catch { throw new DocumentLifecycleError('Independent scanner result could not be recorded.') }
}

function matchesBytes(bytes: Uint8Array, expected: { sha256: string; size: number }): boolean {
  return bytes.byteLength === expected.size && createHash('sha256').update(bytes).digest('hex') === expected.sha256
}

async function verifiedDownload(client: SupabaseClient, bucket: string, path: string,
  expected: { sha256: string; size: number }): Promise<Uint8Array> {
  const downloaded = await client.storage.from(bucket).download(path)
  if (downloaded.error || !downloaded.data || downloaded.data.size !== expected.size) {
    throw new DocumentLifecycleError('Saved document bytes could not be verified.')
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer())
  if (!matchesBytes(bytes, expected)) throw new DocumentLifecycleError('Saved document hash differs from the recorded evidence.', 409)
  return bytes
}

/** Stages exact bytes only. Neither this response nor its receipt is a clean verdict. */
export async function quarantineDocument(actorId: string, sessionId: string, document: EvidenceDocument,
  bytes: Uint8Array): Promise<void> {
  if (!matchesBytes(bytes, { sha256: document.sha256, size: document.size })
    || document.storage_path !== `${actorId}/${document.id}`) {
    throw new DocumentLifecycleError('The private document upload changed before quarantine.', 409)
  }
  const client = storageAdmin(documentScannerConfig())
  const uploaded = await client.storage.from(quarantineBucket).upload(document.storage_path, bytes, {
    contentType: document.mime_type, cacheControl: '0', upsert: false, metadata: { sha256: document.sha256 },
  })
  // Immutable path: an exact retry is permitted only after byte-for-byte check.
  await verifiedDownload(client, quarantineBucket, document.storage_path, document)
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
    throw new DocumentLifecycleError('The quarantine upload did not complete.')
  }
  const receipt = await documentReceiptQuery<QuarantineRecord>(
    'select bx1_private.register_quarantined_document($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [actorId, sessionId, document.id, document.kind, document.title, document.sha256, document.size, document.mime_type],
  )
  if (receipt.id !== document.id || receipt.actor_id !== actorId || receipt.storage_path !== document.storage_path
    || receipt.sha256 !== document.sha256 || receipt.size !== document.size || receipt.state === 'REJECTED') {
    throw new DocumentLifecycleError('The quarantine receipt could not be verified.', 409)
  }
}

const scannerMessage = z.object({
  document_id: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  verdict: z.enum(['CLEAN', 'MALICIOUS']),
  reference: z.string().min(8).max(200),
  observed_at: z.string().datetime({ offset: true }),
}).strict()

export function verifyScannerMessage(rawBody: Uint8Array, timestamp: string | null,
  signature: string | null, config: ReturnType<typeof documentScannerConfig>, now = Date.now()) {
  if (rawBody.length > 4096 || !timestamp || !/^[0-9]{10}$/.test(timestamp)
    || Math.abs(now - Number(timestamp) * 1000) > 300_000
    || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
    throw new DocumentLifecycleError('Scanner message authentication failed.', 403)
  }
  const digest = createHmac('sha256', config.signingKey).update(timestamp).update('.').update(rawBody).digest()
  const supplied = Buffer.from(signature.slice(7), 'hex')
  if (supplied.length !== digest.length || !timingSafeEqual(supplied, digest)) {
    throw new DocumentLifecycleError('Scanner message authentication failed.', 403)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(rawBody).toString('utf8')) } catch {
    throw new DocumentLifecycleError('Malformed scanner message.', 400)
  }
  const result = scannerMessage.safeParse(parsed)
  if (!result.success) throw new DocumentLifecycleError('Invalid scanner message.', 400)
  return result.data
}

/** Provider adapter callback. Only a signed CLEAN result for independently rehashed bytes can promote. */
export async function acceptScannerMessage(rawBody: Uint8Array, timestamp: string | null,
  signature: string | null): Promise<{ id: string; state: string }> {
  const config = documentScannerConfig()
  const message = verifyScannerMessage(rawBody, timestamp, signature, config)
  const item = await scannerQuery<QuarantineRecord>(
    'select bx1_private.read_quarantined_document($1) as result', [message.document_id],
  )
  if (item.id !== message.document_id || item.sha256 !== message.sha256
    || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(item.storage_path)
    || item.storage_path !== `${item.actor_id}/${item.id}`) {
    throw new DocumentLifecycleError('Scanner result does not match the quarantined item.', 409)
  }
  const client = storageAdmin(config)
  // A signed payload is evidence from the configured adapter, not proof that
  // its referenced object was unchanged. Rehash the stored bytes ourselves.
  const bytes = await verifiedDownload(client, quarantineBucket, item.storage_path, item)
  const recorded = await scannerQuery<QuarantineRecord>(
    'select bx1_private.record_document_scan($1,$2,$3,$4,$5,$6) as result',
    [item.id, item.sha256, config.scannerId, message.reference, message.verdict, message.observed_at],
  )
  if (recorded.id !== item.id || recorded.sha256 !== item.sha256 || recorded.storage_path !== item.storage_path) {
    throw new DocumentLifecycleError('The scanner result could not be bound to this document.', 409)
  }
  if (message.verdict === 'MALICIOUS') return { id: item.id, state: 'REJECTED' }
  if (!['SCANNED_CLEAN', 'PROMOTED'].includes(recorded.state)) {
    throw new DocumentLifecycleError('A clean scanner verdict has not been recorded.', 409)
  }
  const uploaded = await client.storage.from(finalBucket).upload(item.storage_path, bytes, {
    contentType: item.mime_type, cacheControl: '0', upsert: false, metadata: { sha256: item.sha256 },
  })
  await verifiedDownload(client, finalBucket, item.storage_path, item)
  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
    throw new DocumentLifecycleError('The scanned document could not be promoted.')
  }
  const promoted = await scannerQuery<{ id: string; actor_id: string; storage_path: string;
    sha256: string; validation_state: string }>(
      'select bx1_private.promote_scanned_document($1) as result', [item.id],
    )
  if (promoted.id !== item.id || promoted.actor_id !== item.actor_id || promoted.storage_path !== item.storage_path
    || promoted.sha256 !== item.sha256 || promoted.validation_state !== 'SCANNED_CLEAN') {
    throw new DocumentLifecycleError('The promoted document receipt could not be verified.', 409)
  }
  return { id: item.id, state: 'SCANNED_CLEAN' }
}
