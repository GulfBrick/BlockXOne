import 'server-only'
import { createHash } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { platformRelease } from '@/lib/platform-release'
import type { EvidenceDocument } from './contracts'

type Environment = Record<string, string | undefined>
const POOLER = 'aws-0-eu-central-1.pooler.supabase.com'
const PROJECTS = { TESTNET: 'fegnnnlseuejkrusbbkv', MAINNET: 'oqkevkjbkpugjotihtda' } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEST_ISSUER = `https://${PROJECTS.TESTNET}.supabase.co/auth/v1`

export type DocumentReceiptAttestation = {
  iss: string; sub: string; session_id: string; role: 'authenticated'; aal: 'aal1';
  exp: number; is_anonymous: false; amr: [{ method: 'password'; timestamp: number }]
}
type ReceiptAuthClient = { auth: {
  getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
} }

/** getUser verifies this actual token before any claims are transported. Never
 * accept an attestation from form fields, headers or user metadata. */
export async function verifiedDocumentReceiptSession(client: ReceiptAuthClient, actorId: string): Promise<{
  sessionId: string; attestation: DocumentReceiptAttestation
}> {
  try {
    const session = await client.auth.getSession()
    const token = session.data.session?.access_token
    if (session.error || !token) throw new Error()
    const verified = await client.auth.getUser(token)
    if (verified.error || verified.data.user?.id !== actorId) throw new Error()
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (claims.sub !== actorId || typeof claims.session_id !== 'string' || !UUID.test(claims.session_id)) throw new Error()
    // Invoke this only for the validated TEST_PASSWORD applicant snapshot.
    // Native callers use the existing session lookup and eight-argument path.
    if (claims.iss !== TEST_ISSUER || claims.aal !== 'aal1') throw new Error()
    const now = Math.floor(Date.now() / 1000)
    const amr = claims.amr
    if (claims.role !== 'authenticated' || claims.is_anonymous !== false
      || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp >= 1e12
      || !Array.isArray(amr) || amr.length !== 1 || !amr[0] || typeof amr[0] !== 'object'
      || amr[0].method !== 'password' || typeof amr[0].timestamp !== 'number'
      || !Number.isSafeInteger(amr[0].timestamp) || amr[0].timestamp <= 0 || amr[0].timestamp > now) throw new Error()
    return { sessionId: claims.session_id, attestation: {
      iss: claims.iss, sub: actorId, session_id: claims.session_id, role: 'authenticated', aal: 'aal1',
      exp: claims.exp, is_anonymous: false, amr: [{ method: 'password', timestamp: amr[0].timestamp }],
    } }
  } catch { throw new DocumentReceiptError() }
}

export class DocumentReceiptError extends Error {
  constructor() { super('The private evidence receipt is unavailable. Do not submit this document until it is confirmed.'); this.name = 'DocumentReceiptError' }
}

/** A retry with the same actor, exact bytes, kind and title gets the same path. */
export function documentReceiptId(actorId: string, kind: string, title: string, sha256: string): string {
  const hex = createHash('sha256').update(['bx1-document-v1', actorId, kind, title, sha256].join('\u0000')).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

export function documentReceiptDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    const release = platformRelease(env)
    if (!release) throw new Error()
    const project = PROJECTS[release.environment]
    const url = new URL(env.BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL ?? '')
    const direct = url.hostname === `db.${project}.supabase.co`
    const pooled = url.hostname === POOLER
    const user = decodeURIComponent(url.username)
    const port = Number(url.port || (direct ? 5432 : 6543))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)
      || user !== (direct ? 'bx1_document_receipt_writer' : `bx1_document_receipt_writer.${project}`)
      || !decodeURIComponent(url.password) || url.pathname !== '/postgres' || url.hash
      || port !== (direct ? 5432 : 6543) || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
    return {
      host: url.hostname, port, database: 'postgres', user, password: decodeURIComponent(url.password),
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname },
      max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      application_name: 'bx1-document-receipt',
    }
  } catch { throw new DocumentReceiptError() }
}

let pool: Pool | undefined
function database(): Pool {
  if (!pool) {
    pool = new Pool(documentReceiptDatabaseConfig())
    pool.on('error', () => {})
  }
  return pool
}

/** Restricted server-only writer; callers must use fixed, parameterised SQL. */
export async function documentReceiptQuery<T>(sql: string, parameters: readonly unknown[]): Promise<T> {
  try {
    const { rows } = await database().query<{ result: T }>(sql, [...parameters])
    if (rows.length !== 1 || rows[0].result === null || rows[0].result === undefined) throw new Error()
    return rows[0].result
  } catch { throw new DocumentReceiptError() }
}

export async function registerDocumentReceipt(actorId: string, sessionId: string, document: EvidenceDocument,
  attestation: DocumentReceiptAttestation | null = null): Promise<void> {
  try {
    const { rows } = await database().query<{ result: Record<string, unknown> }>(
      attestation
        ? 'select bx1_private.register_document_receipt($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::integer,$8::text,$9::jsonb) as result'
        : 'select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [actorId, sessionId, document.id, document.kind, document.title, document.sha256, document.size, document.mime_type,
        ...(attestation ? [JSON.stringify(attestation)] : [])],
    )
    const receipt = rows.length === 1 ? rows[0].result : null
    if (!receipt || receipt.id !== document.id || receipt.actor_id !== actorId
      || receipt.storage_path !== document.storage_path || receipt.kind !== document.kind
      || receipt.title !== document.title || receipt.sha256 !== document.sha256
      || receipt.size !== document.size || receipt.mime_type !== document.mime_type
      || receipt.validation_state !== 'SYNTHETIC_UNSCANNED') throw new Error()
  } catch { throw new DocumentReceiptError() }
}
