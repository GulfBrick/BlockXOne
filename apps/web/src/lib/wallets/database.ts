import 'server-only'
import { Pool, type PoolConfig } from 'pg'
import supabaseCa from './supabase-ca.json'
import { WALLET_ORIGIN, type LinkedWallet, type WalletActor, type WalletChallenge, type WalletDatabase, type WalletErrorCode } from './contracts'

type Environment = Record<string, string | undefined>
const PROJECT = 'oqkevkjbkpugjotihtda'
const DIRECT_HOST = `db.${PROJECT}.supabase.co`
// Exact project Connect-panel endpoint verified 2026-09-17. No regional wildcard.
const POOLER_HOSTS: readonly string[] = ['aws-0-eu-central-1.pooler.supabase.com']

export class WalletDatabaseError extends Error {
  constructor(public readonly code: WalletErrorCode) {
    super(code)
    this.name = 'WalletDatabaseError'
  }
}

export function walletDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    const raw = env.BLOCKXONE_WALLET_VERIFIER_DATABASE_URL
    if (!raw) throw new Error()
    const url = new URL(raw)
    const direct = url.hostname === DIRECT_HOST
    const pooled = POOLER_HOSTS.includes(url.hostname)
    const user = decodeURIComponent(url.username)
    const password = decodeURIComponent(url.password)
    const port = Number(url.port || 5432)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)
      || user !== (direct ? 'bx1_wallet_verifier' : `bx1_wallet_verifier.${PROJECT}`)
      || !password || url.pathname !== '/postgres' || url.hash
      || (direct ? port !== 5432 : port !== 6543)) throw new Error()
    for (const [key, value] of url.searchParams) {
      if (key !== 'sslmode' || value !== 'verify-full' || url.searchParams.getAll(key).length !== 1) throw new Error()
    }
    return {
      host: url.hostname, port, user, password, database: 'postgres',
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname },
      max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      application_name: 'bx1-wallet-verifier',
    }
  } catch {
    throw new WalletDatabaseError('unavailable')
  }
}

export function isWalletDatabaseConfigured(): boolean {
  try { walletDatabaseConfig(); return true } catch { return false }
}

function safeError(error: unknown): WalletDatabaseError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
  const errors: Record<string, WalletErrorCode> = {
    BW001: 'unauthorised', BW002: 'invalid_request', BW003: 'expired',
    BW004: 'conflict', BW005: 'rate_limited',
  }
  return new WalletDatabaseError(typeof code === 'string' ? errors[code] ?? 'unavailable' : 'unavailable')
}

const bindings = (actor: WalletActor) => [actor.userId, actor.platformUserId, actor.sessionId, actor.organisationId]

export function createWalletDatabase(env: Environment = process.env): WalletDatabase {
  const pool = new Pool(walletDatabaseConfig(env))
  // An idle socket failure must not crash the process or print a credential-bearing
  // driver error. Request failures are mapped to fixed unavailable responses.
  pool.on('error', () => {})
  async function call<T>(sql: string, params: unknown[]): Promise<T> {
    let client
    let transaction = false
    let discard = false
    try {
      client = await pool.connect()
      await client.query('begin')
      transaction = true
      const { rows } = await client.query<{ result: T }>(sql, params)
      if (rows.length !== 1 || rows[0].result == null) throw new Error()
      await client.query('commit')
      transaction = false
      return rows[0].result
    } catch (error) {
      if (client && transaction) {
        try { await client.query('rollback') } catch { discard = true }
      }
      throw safeError(error)
    } finally {
      client?.release(discard)
    }
  }
  return {
    issueChallenge: (actor, address, chainId, nonce) => call<WalletChallenge>(
      'select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [...bindings(actor), address, chainId, WALLET_ORIGIN, nonce],
    ),
    readChallenge: (actor, challengeId) => call<WalletChallenge>(
      'select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5) as result',
      [...bindings(actor), challengeId],
    ),
    consumeChallenge: (actor, challengeId, message, signature) => call<LinkedWallet>(
      'select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7) as result',
      [...bindings(actor), challengeId, message, signature],
    ),
  }
}

let database: WalletDatabase | undefined
export function getWalletDatabase(): WalletDatabase {
  // No credential read or database connection during module import/static build.
  return database ??= createWalletDatabase()
}
