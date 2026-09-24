import 'server-only'
import { createHash } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { platformRelease } from '@/lib/platform-release'
import type { EvidenceDocument } from './contracts'

type Environment = Record<string, string | undefined>
const POOLER = 'aws-0-eu-central-1.pooler.supabase.com'
const PROJECTS = { TESTNET: 'fegnnnlseuejkrusbbkv', MAINNET: 'oqkevkjbkpugjotihtda' } as const

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

export async function registerDocumentReceipt(actorId: string, sessionId: string, document: EvidenceDocument): Promise<void> {
  try {
    const { rows } = await database().query<{ result: Record<string, unknown> }>(
      'select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [actorId, sessionId, document.id, document.kind, document.title, document.sha256, document.size, document.mime_type],
    )
    const receipt = rows.length === 1 ? rows[0].result : null
    if (!receipt || receipt.id !== document.id || receipt.actor_id !== actorId
      || receipt.storage_path !== document.storage_path || receipt.kind !== document.kind
      || receipt.title !== document.title || receipt.sha256 !== document.sha256
      || receipt.size !== document.size || receipt.mime_type !== document.mime_type
      || receipt.validation_state !== 'SYNTHETIC_UNSCANNED') throw new Error()
  } catch { throw new DocumentReceiptError() }
}
