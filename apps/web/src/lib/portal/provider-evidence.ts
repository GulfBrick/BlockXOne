import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import { z } from 'zod'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { platformRelease } from '@/lib/platform-release'
import { PortalError } from './server'
import type { EntryApplication } from './entry-contracts'

type Environment = Record<string, string | undefined>
const PROJECT = 'fegnnnlseuejkrusbbkv'
const POOLER = 'aws-0-eu-central-1.pooler.supabase.com'
const TOKEN_PATH = '/resources/accessTokens/sdk'

export type ProviderBinding = {
  binding_id: string; application_id: string; application_revision: number;
  actor_id: string; environment: 'TESTNET'; external_user_id: string;
  expected_applicant_type: 'individual' | 'company'; expected_level_name: string;
  expected_client_id: string; source_version_revision: number
}
export type ProviderEvidence = {
  id: string; application_id: string; application_revision: number;
  ordering_state: 'CURRENT' | 'STALE' | 'MANUAL_TEST'; duplicate: boolean
}
export type SumsubWebhook = {
  externalUserId: string; applicantId: string; applicantType: 'individual' | 'company'; levelName: string; type: string; createdAtMs: string;
  sandboxMode: true; testMode?: true; clientId: string; correlationId?: string;
  reviewStatus?: string; reviewResult?: { reviewAnswer?: string; reviewRejectType?: string }
}

function required(value: string | undefined, min = 1): string {
  if (!value || value.length < min || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new PortalError('The identity provider is not configured for this environment.', 503)
  return value
}
function requireTestnet(env: Environment) {
  if (platformRelease(env)?.environment !== 'TESTNET') throw new PortalError('Sandbox identity verification is not admitted in this environment.', 404)
}

export function sumsubWebhookConfig(env: Environment = process.env) {
  requireTestnet(env)
  const clientId = required(env.BLOCKXONE_SUMSUB_SANDBOX_CLIENT_ID)
  if (clientId.length > 150) throw new PortalError('The identity provider client is invalid.', 503)
  return {
    secret: required(env.BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET, 20),
    clientId,
  }
}
export function sumsubSessionConfig(applicantType: 'individual' | 'company', env: Environment = process.env) {
  const webhook = sumsubWebhookConfig(env)
  if (!['individual', 'company'].includes(applicantType)) throw new PortalError('The identity provider subject is unavailable.', 503)
  // The submitted subject selects its own exact configured level. An unrelated
  // missing level must not disable it; no fallback level is ever supplied.
  const levelName = required(applicantType === 'individual'
    ? env.BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL : env.BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL)
  if (levelName.length > 120) throw new PortalError('The identity provider level is invalid.', 503)
  return {
    ...webhook,
    appToken: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN, 16),
    appSecret: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET, 20),
    levelName,
    individualLevel: applicantType === 'individual' ? levelName : null,
    companyLevel: applicantType === 'company' ? levelName : null,
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
/** Read-only server expectation; the database independently proves its immutable SUBMISSION source. */
export function expectedProviderApplicantType(application: EntryApplication): 'individual' | 'company' {
  if (application.status !== 'SUBMITTED' || application.context_kind !== 'PERSONAL' || !application.submitted_at)
    throw new PortalError('Submit or resubmit this application before starting identity verification.', 409)
  const details = application.details
  const person = z.object({ full_name: z.string().trim().min(2).max(120), country: z.string().regex(/^[A-Z]{2}$/) }).safeParse(details)
  if (!person.success) throw new PortalError('The submitted applicant subject is incomplete.', 409)
  const unversioned = !Object.prototype.hasOwnProperty.call(details, 'details_version')
  const company = z.object({ company_name: z.string().trim().min(3).max(160),
    registration_reference: z.string().trim().min(3).max(100) }).safeParse(details).success
  if (application.persona === 'INVESTOR' && application.admission_purpose === 'INVESTOR_ADMISSION') {
    if (details.investor_type === 'INDIVIDUAL' && unversioned) return 'individual'
    if (details.investor_type === 'ENTITY' && company && (unversioned || details.details_version === 3)) return 'company'
  }
  if (application.persona === 'WEALTH_MANAGER' && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION'
    && company && (details.details_version === 2 || details.details_version === 3)) return 'company'
  throw new PortalError('The submitted applicant subject is not available for identity verification.', 409)
}

export async function bindProviderApplication(actorId: string, sessionId: string, applicationId: string, revision: number,
  config: Pick<ReturnType<typeof sumsubSessionConfig>, 'individualLevel' | 'companyLevel' | 'clientId'>,
  expectedApplicantType: 'individual' | 'company'): Promise<ProviderBinding> {
  try {
    const expectedLevel = expectedApplicantType === 'individual' ? config.individualLevel : config.companyLevel
    if (!expectedLevel) throw new Error()
    const { rows } = await database().query<{ result: ProviderBinding }>(
      'select bx1_private.bind_provider_application($1,$2,$3,$4,$5,$6,$7) as result',
      [actorId, sessionId, applicationId, revision, config.individualLevel, config.companyLevel, config.clientId],
    )
    const result = rows.length === 1 ? rows[0].result : null
    const expectedExternal = `bx1:testnet:${applicationId}:r${revision}`
    if (!result || result.actor_id !== actorId || result.application_id !== applicationId
      || result.application_revision !== revision || result.environment !== 'TESTNET'
      || result.source_version_revision !== revision || result.expected_applicant_type !== expectedApplicantType
      || result.expected_level_name !== expectedLevel
      || result.expected_client_id !== config.clientId
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

const eventTypes = ['applicantReviewed', 'applicantCreated', 'applicantPending', 'applicantOnHold',
  'applicantPersonalInfoChanged', 'applicantReset', 'applicantLevelChanged', 'applicantActivated',
  'applicantPrechecked', 'applicantAwaitingUser', 'applicantDeactivated', 'applicantDeleted'] as const
const boundedText = (max: number, min = 1) => z.string().min(min).max(max)
  .refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value))
const webhookSchema = z.object({
  externalUserId: z.string().regex(/^bx1:testnet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:r[1-9][0-9]*$/i).max(100),
  applicantId: boundedText(100, 8), applicantType: z.enum(['individual', 'company']), levelName: boundedText(120),
  type: z.enum(eventTypes),
  createdAtMs: z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/),
  sandboxMode: z.literal(true), testMode: z.literal(true).optional(),
  clientId: boundedText(150), correlationId: boundedText(150).optional(),
  reviewStatus: boundedText(60).optional(),
  reviewResult: z.object({ reviewAnswer: boundedText(60).optional(), reviewRejectType: boundedText(60).optional() }).passthrough().optional(),
}).passthrough().superRefine((event, context) => {
  if (event.type !== 'applicantReviewed' || event.reviewStatus !== 'completed') return
  const answer = event.reviewResult?.reviewAnswer, reject = event.reviewResult?.reviewRejectType
  if (!((answer === 'GREEN' && reject === undefined) || (answer === 'RED' && (reject === 'RETRY' || reject === 'FINAL'))))
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A completed review requires an admitted provider outcome.' })
})

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) throw new PortalError('The provider event is invalid.', 400)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key], depth + 1)}`).join(',')}}`
}
export function parseSumsubWebhook(raw: Uint8Array, expectedClientId: string) {
  if (!raw.length || raw.length > 65536) throw new PortalError('The provider event is invalid.', 400)
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

export function sumsubRequestSignature(timestamp: string, path: string, body: string, secret: string, method: 'POST' | 'GET' = 'POST'): string {
  if (!['POST', 'GET'].includes(method) || (method === 'GET' && body !== '')) throw new PortalError('Invalid identity provider request.', 400)
  return createHmac('sha256', secret).update(timestamp).update(method).update(path).update(body).digest('hex')
}

type SumsubSubject = 'individual' | 'company'
type SumsubLevel = { name: string; applicant_type: SumsubSubject | 'UNKNOWN' }
export type SumsubSubjectReadiness = {
  configured: boolean; enabled: boolean; level_present: boolean | null;
  provider_subject_type: SumsubSubject | 'UNKNOWN' | null;
  classifier: 'LEVEL_NOT_CONFIGURED' | 'SUBJECT_DISABLED' | 'CONNECTION_NOT_VERIFIED' | 'LEVEL_NOT_FOUND'
    | 'LEVEL_AMBIGUOUS' | 'LEVEL_SUBJECT_MISMATCH' | 'LEVEL_SUBJECT_UNCONFIRMED' | 'LEVEL_PRESENT';
}
export type SumsubSandboxReadiness = {
  provider: 'SUMSUB'; environment: 'TESTNET'; status: 'CONNECTED' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  classifier: 'AUTHENTICATED_LEVELS_READ' | 'CREDENTIALS_NOT_CONFIGURED' | 'CREDENTIALS_REJECTED'
    | 'PROVIDER_ACCESS_DENIED' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID';
  sandbox_enabled: boolean; individual: SumsubSubjectReadiness; company: SumsubSubjectReadiness;
  available_levels: SumsubLevel[];
  webhook: { configured: boolean; delivery_proved: false };
  evidence_writer: { configured: boolean; connection_proved: false };
  verification_proved: false; admission_granted: false;
}
const SUMSUB_LEVELS_PATH = '/resources/applicants/-/levels'
const SUMSUB_LEVELS_LIMIT = 262_144
const sumsubLevelCatalog = z.object({ list: z.object({
  items: z.array(z.object({ name: boundedText(120) }).passthrough()).max(200),
  totalItems: z.number().int().min(0).max(200).optional(),
}).passthrough() }).passthrough()

function configuredSumsubLevel(value: string | undefined): string | null {
  return typeof value === 'string' && boundedText(120).safeParse(value).success ? value : null
}

async function readSumsubLevelCatalog(response: Response): Promise<SumsubLevel[]> {
  if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error()
  const length = response.headers.get('content-length')
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > SUMSUB_LEVELS_LIMIT)) throw new Error()
  const reader = response.body?.getReader()
  if (!reader) throw new Error()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > SUMSUB_LEVELS_LIMIT) throw new Error()
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const catalog = sumsubLevelCatalog.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  if (catalog.list.totalItems !== undefined && catalog.list.totalItems !== catalog.list.items.length) throw new Error()
  return catalog.list.items.map((level): SumsubLevel => ({ name: level.name,
    // An absent/unknown provider subject is not inferred from a level's name.
    applicant_type: level.applicantType === 'individual' || level.applicantType === 'company' ? level.applicantType : 'UNKNOWN' }))
}

/** Staff diagnostic only: fixed read-only provider resource, never a token or applicant outcome. */
export async function readSumsubSandboxReadiness(env: Environment = process.env,
  fetchImpl: typeof fetch = fetch): Promise<SumsubSandboxReadiness> {
  requireTestnet(env)
  const sandboxEnabled = env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED === 'true'
  let webhookConfigured = false; let writerConfigured = false
  try { sumsubWebhookConfig(env); webhookConfigured = true } catch { /* Status only; never expose configuration data. */ }
  try { providerEvidenceDatabaseConfig(env); writerConfigured = true } catch { /* Parsing is not a database connection proof. */ }
  let status: SumsubSandboxReadiness['status'] = 'NOT_CONFIGURED'
  let classifier: SumsubSandboxReadiness['classifier'] = 'CREDENTIALS_NOT_CONFIGURED'
  let levels: SumsubLevel[] = []
  let credentials: { appToken: string; appSecret: string } | null = null
  try { credentials = { appToken: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN, 16),
    appSecret: required(env.BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET, 20) } } catch { /* No provider request without complete credentials. */ }
  if (credentials) {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    try {
      const response = await fetchImpl(`https://api.sumsub.com${SUMSUB_LEVELS_PATH}`, {
        method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json', 'X-App-Token': credentials.appToken, 'X-App-Access-Ts': timestamp,
          'X-App-Access-Sig': sumsubRequestSignature(timestamp, SUMSUB_LEVELS_PATH, '', credentials.appSecret, 'GET') },
      })
      status = 'UNAVAILABLE'
      if (!response.ok) {
        classifier = response.status === 401 ? 'CREDENTIALS_REJECTED' : response.status === 403 ? 'PROVIDER_ACCESS_DENIED'
          : response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE'
        await response.body?.cancel().catch(() => {})
      } else {
        try { levels = await readSumsubLevelCatalog(response); status = 'CONNECTED'; classifier = 'AUTHENTICATED_LEVELS_READ' }
        catch { await response.body?.cancel().catch(() => {}); classifier = 'PROVIDER_RESPONSE_INVALID' }
      }
    } catch { status = 'UNAVAILABLE'; classifier = 'PROVIDER_UNAVAILABLE' }
  }
  function subjectReadiness(subject: SumsubSubject): SumsubSubjectReadiness {
    const levelName = configuredSumsubLevel(subject === 'individual'
      ? env.BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL : env.BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL)
    const enabled = sandboxEnabled && (subject === 'individual'
      ? env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_ENABLED : env.NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_COMPANY_ENABLED) === 'true'
    const matches = status === 'CONNECTED' && levelName ? levels.filter(level => level.name === levelName) : []
    const levelPresent = status === 'CONNECTED' && levelName ? matches.length > 0 : null
    const providerSubject = matches.length === 1 ? matches[0].applicant_type : null
    return { configured: levelName !== null, enabled, level_present: levelPresent, provider_subject_type: providerSubject,
      classifier: !levelName ? 'LEVEL_NOT_CONFIGURED' : !enabled ? 'SUBJECT_DISABLED' : status !== 'CONNECTED' ? 'CONNECTION_NOT_VERIFIED'
        : matches.length === 0 ? 'LEVEL_NOT_FOUND' : matches.length > 1 ? 'LEVEL_AMBIGUOUS'
          : providerSubject === 'UNKNOWN' ? 'LEVEL_SUBJECT_UNCONFIRMED' : providerSubject !== subject ? 'LEVEL_SUBJECT_MISMATCH' : 'LEVEL_PRESENT' }
  }
  return { provider: 'SUMSUB', environment: 'TESTNET', status, classifier, sandbox_enabled: sandboxEnabled,
    individual: subjectReadiness('individual'), company: subjectReadiness('company'), available_levels: levels,
    webhook: { configured: webhookConfigured, delivery_proved: false },
    evidence_writer: { configured: writerConfigured, connection_proved: false }, verification_proved: false, admission_granted: false }
}

export async function issueSumsubSandboxToken(externalUserId: string, levelName: string,
  config: Pick<ReturnType<typeof sumsubSessionConfig>, 'appToken' | 'appSecret'>): Promise<string> {
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
      'select bx1_private.record_provider_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as result',
      [event.externalUserId,event.applicantId,event.type,event.correlationId ?? null,event.clientId,
        eventAt,payloadHash,semanticHash,event.reviewStatus ?? null,event.reviewResult?.reviewAnswer ?? null,
        event.reviewResult?.reviewRejectType ?? null,event.testMode === true,true,event.applicantType,event.levelName],
    )
    const result = rows.length === 1 ? rows[0].result : null
    if (!result || !z.string().uuid().safeParse(result.id).success
      || !z.string().uuid().safeParse(result.application_id).success
      || !Number.isInteger(result.application_revision) || result.application_revision < 1
      || event.externalUserId !== `bx1:testnet:${result.application_id}:r${result.application_revision}`
      || !['CURRENT','STALE','MANUAL_TEST'].includes(result.ordering_state)
      || typeof result.duplicate !== 'boolean') throw new Error()
    return result
  } catch { throw new PortalError('The provider evidence could not be durably recorded. The provider should retry delivery.', 503) }
}
