import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { platformRelease } from '@/lib/platform-release'
import { PortalError } from './server'

type Environment = Record<string, string | undefined>
const PROJECT = 'fegnnnlseuejkrusbbkv'
const POOLER = 'aws-0-eu-central-1.pooler.supabase.com'
const TOKEN_PATH = '/resources/accessTokens/sdk'

export type ProviderBinding = {
  binding_id: string; application_id: string; application_revision: number;
  actor_id: string; environment: 'TESTNET'; external_user_id: string
}
export type ProviderEvidence = {
  id: string; application_id: string; application_revision: number;
  ordering_state: 'CURRENT' | 'STALE' | 'MANUAL_TEST'; duplicate: boolean
}
export type SumsubWebhook = {
  externalUserId: string; applicantId: string; type: string; createdAtMs: string;
  sandboxMode: true; testMode?: true; clientId: string; correlationId?: string;
  reviewStatus?: string; reviewResult?: { reviewAnswer?: string; reviewRejectType?: string }
}

function required(value: string | undefined, min = 1): string {
  if (!value || value.length < min || value !== value.trim()) throw new PortalError('The identity provider is not configured for this environment.', 503)
  return value
}
function requireTestnet(env: Environment) {
  if (platformRelease(env)?.environment !== 'TESTNET') throw new PortalError('Sandbox identity verification is not admitted in this environment.', 404)
}

export function sumsubWebhookConfig(env: Environment = process.env) {
  requireTestnet(env)
  return {
    secret: required(env.BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET, 20),
    clientId: required(env.BLOCKXONE_SUMSUB_SANDBOX_CLIENT_ID),
  }
}
export function sumsubSessionConfig(env: Environment = process.env) {
  const webhook = sumsubWebhookConfig(env)
  const individualLevel = required(env.BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL)
  const companyLevel = required(env.BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL)
  if (individualLevel.length > 120 || companyLevel.length > 120) throw new PortalError('The identity provider level is invalid.', 503)
  return {
    ...webhook,
    appToken: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN, 16),
    appSecret: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET, 20),
    individualLevel, companyLevel,
  }
}

export function providerEvidenceDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    requireTestnet(env)
    const url = new URL(env.BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL ?? '')
    const direct = url.hostname === `db.${PROJECT}.supabase.co`
    const pooled = url.hostname === POOLER
    const user = decodeURIComponent(url.username)
    const port = Number(url.port || (direct ? 5432 : 6543))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)
      || user !== (direct ? 'bx1_provider_evidence_writer' : `bx1_provider_evidence_writer.${PROJECT}`)
      || !decodeURIComponent(url.password) || url.pathname !== '/postgres' || url.hash
      || port !== (direct ? 5432 : 6543) || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
    return {
      host: url.hostname, port, database: 'postgres', user, password: decodeURIComponent(url.password),
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname },
      max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      application_name: 'bx1-provider-evidence',
    }
  } catch { throw new PortalError('The identity evidence writer is not configured for this environment.', 503) }
}

let pool: Pool | undefined
function database(): Pool {
  if (!pool) {
    pool = new Pool(providerEvidenceDatabaseConfig())
    pool.on('error', () => {})
  }
  return pool
}
export async function bindProviderApplication(actorId: string, sessionId: string, applicationId: string, revision: number): Promise<ProviderBinding> {
  try {
    const { rows } = await database().query<{ result: ProviderBinding }>(
      'select bx1_private.bind_provider_application($1,$2,$3,$4) as result',
      [actorId, sessionId, applicationId, revision],
    )
    const result = rows.length === 1 ? rows[0].result : null
    const expectedExternal = `bx1:testnet:${applicationId}:r${revision}`
    if (!result || result.actor_id !== actorId || result.application_id !== applicationId
      || result.application_revision !== revision || result.environment !== 'TESTNET'
      || result.external_user_id !== expectedExternal || !z.string().uuid().safeParse(result.binding_id).success) throw new Error()
    return result
  } catch { throw new PortalError('The identity evidence binding is unavailable. No provider session was issued.', 503) }
}

/** Sumsub signs the exact raw webhook bytes, not re-serialized JSON. SHA1 is intentionally refused. */
export function verifySumsubWebhookDigest(raw: Uint8Array, algorithm: string | null, digest: string | null, secret: string): boolean {
  const hashAlgorithm = algorithm === 'HMAC_SHA256_HEX' ? 'sha256' : algorithm === 'HMAC_SHA512_HEX' ? 'sha512' : null
  if (!hashAlgorithm || !digest || !/^[0-9a-f]+$/i.test(digest) || digest.length !== (hashAlgorithm === 'sha256' ? 64 : 128)) return false
  const supplied = Buffer.from(digest, 'hex')
  const expected = createHmac(hashAlgorithm, secret).update(raw).digest()
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const webhookSchema = z.object({
  externalUserId: z.string().regex(/^bx1:testnet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:r[1-9][0-9]*$/i).max(100),
  applicantId: z.string().min(8).max(100),
  type: z.string().regex(/^applicant[A-Za-z]{3,60}$/),
  createdAtMs: z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/),
  sandboxMode: z.literal(true), testMode: z.literal(true).optional(),
  clientId: z.string().min(1).max(150), correlationId: z.string().min(1).max(150).optional(),
  reviewStatus: z.string().min(1).max(60).optional(),
  reviewResult: z.object({ reviewAnswer: z.string().min(1).max(60).optional(), reviewRejectType: z.string().min(1).max(60).optional() }).passthrough().optional(),
}).passthrough()

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new PortalError('The provider event is invalid.', 400)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key], depth + 1)}`).join(',')}}`
}
export function parseSumsubWebhook(raw: Uint8Array, expectedClientId: string) {
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { throw new PortalError('The provider event is invalid.', 400) }
  const event = webhookSchema.safeParse(parsed)
  if (!event.success || event.data.clientId !== expectedClientId) throw new PortalError('The provider event is not admitted.', 403)
  const timestamp = Date.parse(event.data.createdAtMs.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().replace('T', ' ').replace('Z', '') !== event.data.createdAtMs)
    throw new PortalError('The provider event time is invalid.', 400)
  return {
    event: event.data as SumsubWebhook,
    eventAt: new Date(timestamp).toISOString(),
    payloadHash: createHash('sha256').update(raw).digest('hex'),
    semanticHash: createHash('sha256').update(canonicalJson(parsed)).digest('hex'),
  }
}

export function sumsubRequestSignature(timestamp: string, path: string, body: string, secret: string): string {
  return createHmac('sha256', secret).update(timestamp).update('POST').update(path).update(body).digest('hex')
}
export async function issueSumsubSandboxToken(externalUserId: string, levelName: string, config = sumsubSessionConfig()): Promise<string> {
  const body = JSON.stringify({ userId: externalUserId, levelName, ttlInSecs: 600 })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  let response: Response
  try {
    response = await fetch(`https://api.sumsub.com${TOKEN_PATH}`, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', 'X-App-Token': config.appToken,
        'X-App-Access-Ts': timestamp, 'X-App-Access-Sig': sumsubRequestSignature(timestamp, TOKEN_PATH, body, config.appSecret) },
      body,
    })
  } catch { throw new PortalError('The identity provider is temporarily unavailable. Retry this application later.', 503) }
  if (!response.ok) throw new PortalError('The identity provider could not start verification. Retry this application later.', 503)
  let parsed: unknown
  try { parsed = await response.json() } catch { throw new PortalError('The identity provider response could not be verified.', 503) }
  const token = z.object({ token: z.string().min(1).max(1024), userId: z.literal(externalUserId) }).safeParse(parsed)
  if (!token.success) throw new PortalError('The identity provider response could not be verified.', 503)
  return token.data.token
}

export async function recordProviderEvidence(input: ReturnType<typeof parseSumsubWebhook>): Promise<ProviderEvidence> {
  const { event, eventAt, payloadHash, semanticHash } = input
  try {
    const { rows } = await database().query<{ result: ProviderEvidence }>(
      'select bx1_private.record_provider_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as result',
      [event.externalUserId,event.applicantId,event.type,event.correlationId ?? null,event.clientId,
        eventAt,payloadHash,semanticHash,event.reviewStatus ?? null,event.reviewResult?.reviewAnswer ?? null,
        event.reviewResult?.reviewRejectType ?? null,event.testMode === true,true],
    )
    const result = rows.length === 1 ? rows[0].result : null
    if (!result || !z.string().uuid().safeParse(result.id).success
      || !z.string().uuid().safeParse(result.application_id).success
      || !Number.isInteger(result.application_revision) || result.application_revision < 1
      || !['CURRENT','STALE','MANUAL_TEST'].includes(result.ordering_state)
      || typeof result.duplicate !== 'boolean') throw new Error()
    return result
  } catch { throw new PortalError('The provider evidence could not be durably recorded. The provider should retry delivery.', 503) }
}
