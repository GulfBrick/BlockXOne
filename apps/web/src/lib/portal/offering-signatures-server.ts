import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Pool, type PoolConfig } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { platformRelease } from '@/lib/platform-release'
import { documentReceiptQuery } from './document-receipts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import type { OfferingFileSession } from './offering-files-server'
import { verifiedOfferingFileSession } from './offering-files-server'
import { downloadCleanOfferingDocument } from './offering-document-processing'
import { documentScannerConfig } from './document-lifecycle'
import { readPortal } from './server'
import { assessOfferingCompletion, buildOfferingEnvelope, createDocusignOfferingProvider,
  docusignOfferingConfig, DocusignOfferingError, DOCUSIGN_OFFERING_SANDBOX,
  offeringEnvelopeExpectationFromFrozenRequest, offeringSignatureSha256,
  type OfferingCoverBinding, type OfferingProviderResource, type OfferingProviderRead } from './docusign-offering-provider'
import { offeringSignatureSnapshotSchema, offeringSignatureCommandSchema,
  type OfferingSignatureSnapshot, type OfferingSignatureCommand } from './offering-signatures'

type Environment = Record<string, string | undefined>
const projects = { TESTNET: 'fegnnnlseuejkrusbbkv', MAINNET: 'oqkevkjbkpugjotihtda' } as const
const uuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const workerIdentity = z.string().regex(/^[a-z][a-z0-9_-]{2,119}$/)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export class OfferingSignatureError extends Error {
  constructor(message = 'The signature operation could not be confirmed. Refresh its saved state before retrying the same request.',
    public readonly status = 503) { super(message); this.name = 'OfferingSignatureError' }
}

export type OfferingSignatureSessionInput = {
  actorId: string; session: OfferingFileSession; context: PortalOperatingContext; revisionId: string
}

function confirmedSnapshot(raw: unknown, input: OfferingSignatureSessionInput): OfferingSignatureSnapshot {
  const snapshot = offeringSignatureSnapshotSchema.safeParse(raw)
  const release = platformRelease(process.env)
  if (!snapshot.success || !release || snapshot.data.actor_id !== input.actorId
    || snapshot.data.session_id !== input.session.id || snapshot.data.revision_id !== input.revisionId
    || snapshot.data.environment !== release.environment || !portalContextMatches(snapshot.data.context, input.context)) {
    throw new OfferingSignatureError('The signature record did not match the active account, application or environment.', 409)
  }
  return snapshot.data
}

export async function readOfferingSignatures(input: OfferingSignatureSessionInput): Promise<OfferingSignatureSnapshot> {
  try {
    const raw = await documentReceiptQuery<unknown>(
      'select bx1_private.read_offering_signatures($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid,$6::jsonb) as result',
      [input.actorId, input.session.id, input.session.aal, JSON.stringify(input.context), input.revisionId,
        JSON.stringify(input.session.attestation)],
    )
    return confirmedSnapshot(raw, input)
  } catch (error) {
    if (error instanceof OfferingSignatureError) throw error
    throw new OfferingSignatureError()
  }
}

export const signatureViewActionSchema = z.object({
  operation_id: uuid, lease_id: uuid, generation, request_id: uuid,
}).strict()
export type SignatureViewAction = z.infer<typeof signatureViewActionSchema>

/** A view lease never crosses the browser boundary; only this server orchestrates it. */
export async function executeOfferingSignatureCommand(input: OfferingSignatureSessionInput,
  command: OfferingSignatureCommand): Promise<{ snapshot: OfferingSignatureSnapshot; viewAction: SignatureViewAction | null }> {
  const instruction = offeringSignatureCommandSchema.parse(command)
  if (instruction.payload.offering_revision_id !== input.revisionId) throw new OfferingSignatureError('Select the current package revision.', 409)
  try {
    const raw = await documentReceiptQuery<unknown>(
      'select bx1_private.execute_offering_signature_command($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::uuid,$7::jsonb,$8::jsonb) as result',
      [input.actorId, input.session.id, input.session.aal, JSON.stringify(input.context), instruction.command,
        instruction.key, JSON.stringify(instruction.payload), JSON.stringify(input.session.attestation)],
    )
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OfferingSignatureError()
    const { action, ...body } = raw as Record<string, unknown>
    const snapshot = confirmedSnapshot(body, input)
    if (snapshot.product_id !== instruction.payload.product_id) throw new OfferingSignatureError()
    const viewAction = action === undefined || action === null ? null : signatureViewActionSchema.parse(action)
    if (instruction.command === 'REQUEST_SIGNING_VIEW') {
      if (viewAction && (viewAction.operation_id !== instruction.payload.operation_id
        || viewAction.request_id !== instruction.key)) throw new OfferingSignatureError()
    } else if (viewAction) throw new OfferingSignatureError()
    return { snapshot, viewAction }
  } catch (error) {
    if (error instanceof OfferingSignatureError) throw error
    throw new OfferingSignatureError()
  }
}

export function signatureWorkerDatabaseConfig(env: Environment = process.env): PoolConfig {
  try {
    const release = platformRelease(env)
    if (!release) throw new Error()
    const project = projects[release.environment]
    const url = new URL(env.BLOCKXONE_OFFERING_SIGNATURE_DATABASE_URL ?? '')
    const direct = url.hostname === `db.${project}.supabase.co`
    const pooled = url.hostname === 'aws-0-eu-central-1.pooler.supabase.com'
    const user = decodeURIComponent(url.username)
    const port = Number(url.port || (direct ? 5432 : 6543))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)
      || user !== (direct ? 'bx1_offering_signature_worker' : `bx1_offering_signature_worker.${project}`)
      || !decodeURIComponent(url.password) || url.pathname !== '/postgres' || url.hash
      || port !== (direct ? 5432 : 6543) || url.searchParams.toString() !== 'sslmode=verify-full') throw new Error()
    return { host: url.hostname, port, database: 'postgres', user, password: decodeURIComponent(url.password),
      ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname }, max: 1,
      connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 8000,
      statement_timeout: 7000, lock_timeout: 4000, application_name: 'bx1-offering-signatures' }
  } catch { throw new OfferingSignatureError('The restricted signature worker is not configured for this environment.') }
}

export function signatureWorkerConfig(env: Environment = process.env) {
  const release = platformRelease(env)
  const workerId = workerIdentity.safeParse(env.BLOCKXONE_OFFERING_SIGNATURE_WORKER_ID)
  const encoded = env.BLOCKXONE_OFFERING_SIGNATURE_HMAC_KEY ?? ''
  const key = /^[A-Za-z0-9_-]{43,86}$/.test(encoded) ? Buffer.from(encoded, 'base64url') : Buffer.alloc(0)
  if (!release || !workerId.success || key.length < 32 || key.length > 64 || key.toString('base64url') !== encoded) {
    throw new OfferingSignatureError('The signature processing connection is not configured for this environment.')
  }
  return { database: signatureWorkerDatabaseConfig(env), workerId: workerId.data, key, environment: release.environment }
}

let workerPool: { fingerprint: string; pool: Pool } | undefined
async function workerQuery(sql: string, values: unknown[], env: Environment = process.env): Promise<unknown> {
  const config = signatureWorkerConfig(env)
  const fingerprint = createHash('sha256').update(JSON.stringify(config.database)).digest('hex')
  if (workerPool && workerPool.fingerprint !== fingerprint) throw new OfferingSignatureError()
  if (!workerPool) {
    const pool = new Pool(config.database)
    pool.on('error', () => {})
    workerPool = { fingerprint, pool }
  }
  try {
    const { rows } = await workerPool.pool.query<{ result: unknown }>(sql, values)
    if (rows.length !== 1 || rows[0].result === undefined) throw new Error()
    return rows[0].result
  } catch { throw new OfferingSignatureError() }
}

export const signatureProcessingRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('CLAIM'), request_id: uuid }).strict(),
  z.object({ command: z.literal('PROCESS'), request_id: uuid, operation_id: uuid, lease_id: uuid, generation }).strict(),
])
export type SignatureProcessingRequest = z.infer<typeof signatureProcessingRequestSchema>

export function verifySignatureWorkerMessage(raw: Uint8Array, timestamp: string | null, signature: string | null,
  config: ReturnType<typeof signatureWorkerConfig>, now = Date.now()): SignatureProcessingRequest {
  if (!raw.length || raw.length > 4096 || !timestamp || !/^[1-9][0-9]{9}$/.test(timestamp)
    || Math.abs(now / 1000 - Number(timestamp)) > 300 || !signature || !digest.safeParse(signature).success) {
    throw new OfferingSignatureError('The processing message is not admitted.', 403)
  }
  const expected = createHmac('sha256', config.key).update('bx1-offering-signatures-worker-v1:')
    .update(timestamp).update(':').update(raw).digest()
  const supplied = Buffer.from(signature, 'hex')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new OfferingSignatureError('The processing message is not admitted.', 403)
  try { return signatureProcessingRequestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))) }
  catch { throw new OfferingSignatureError('The processing message is invalid.', 400) }
}

export async function claimSignatureAction(requestId: string, env: Environment = process.env): Promise<unknown> {
  const config = signatureWorkerConfig(env)
  uuid.parse(requestId)
  return workerQuery('select bx1_private.claim_offering_signature_action($1::text,$2::uuid) as result', [config.workerId, requestId], env)
}

export async function readSignatureAction(action: SignatureViewAction, env: Environment = process.env): Promise<unknown> {
  const config = signatureWorkerConfig(env)
  const identity = signatureViewActionSchema.parse(action)
  return workerQuery('select bx1_private.read_offering_signature_action($1::text,$2::uuid,$3::uuid,$4::bigint) as result',
    [config.workerId, identity.operation_id, identity.lease_id, identity.generation], env)
}

export async function recordSignatureAction(action: SignatureViewAction, resultAction: string, result: unknown, resultId: string,
  env: Environment = process.env): Promise<unknown> {
  const config = signatureWorkerConfig(env)
  const identity = signatureViewActionSchema.parse(action)
  if (!['CREATE_RESULT','RECONCILE_RESULT','SIGNING_VIEW_RESULT','VOID_RESULT','ARTIFACT_RESERVED','ARTIFACT_RETAINED',
    'EVIDENCE_FINALIZED','RECOVERY_REQUIRED'].includes(resultAction)) throw new OfferingSignatureError()
  return workerQuery('select bx1_private.record_offering_signature_action($1::text,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::text,$7::jsonb) as result',
    [config.workerId, identity.operation_id, identity.lease_id, identity.generation, uuid.parse(resultId), resultAction, JSON.stringify(result)], env)
}

const moment = z.string().datetime({ offset: true })
const kindSchema = z.enum(['COVER_ORIGINAL','MEMORANDUM_SIGNED','RISKS_SIGNED','SUBSCRIPTION_TERMS_SIGNED','COVER_SIGNED','CERTIFICATE'])
export const signatureWorkerActionSchema = z.object({
  operation_id: uuid, authorisation_id: uuid, action: z.enum(['PREPARE','CREATE','RECONCILE','RETAIN','VIEW','VOID']),
  lease_id: uuid, lease_expires_at: moment, generation, authority_epoch: generation, worker_id: workerIdentity,
  environment: z.literal('TESTNET'), revision_id: uuid, manifest_id: uuid, manifest_hash: digest,
  provider_account_id: z.literal(DOCUSIGN_OFFERING_SANDBOX.accountId), envelope_id: uuid.nullable(), current: z.boolean(),
  create_request: z.string().max(18_000_000).nullable(), create_request_sha256: digest.nullable(), first_attempt_at: moment,
  completion_evidence: z.string().max(6_291_456).nullable(), completion_evidence_sha256: digest.nullable(),
  signer: z.object({ actor_id: uuid, person_id: uuid, email: z.string().email().max(100).nullable(),
    name: z.string().min(1).max(100).nullable(), client_user_id: uuid }).strict(),
  originals: z.object({ file_id: uuid, kind: z.enum(['MEMORANDUM','RISKS','SUBSCRIPTION_TERMS']), uploader_id: uuid,
    size: z.number().int().min(1).max(4_194_304), sha256: digest, scan_event_id: z.number().int().positive(),
    clean_receipt_id: uuid, storage_path: z.string().max(110) }).strict().array().length(3),
  binding: z.object({ product_id: uuid, issuer_reference: uuid, declaration_revision: generation, declaration_hash: digest,
    purpose: z.literal('ISSUER_PACKAGE_EXECUTION'), terms_hash: digest, document_hashes: z.record(z.string(), digest),
    common_envelope_hash: digest, deployment_configuration_hash: digest, text_sha256: digest,
    appointment_id: uuid, appointment_receipt_id: uuid, acting_organisation_id: uuid, manager_organisation_id: uuid,
    valid_from: moment, valid_until: moment, source_reference: z.string().min(20).max(1000), source_sha256: digest }).strict(),
  artifacts: z.object({ id: uuid, kind: kindSchema, provider_document_id: z.enum(['1','2','3','4','certificate']),
    path: z.string().max(160), sha256: digest, size: z.number().int().min(1).max(4_194_304),
    state: z.enum(['RESERVED','RETAINED']) }).strict().array().max(6),
  request_id: uuid, originating_actor_id: uuid.nullable(), originating_session_id: uuid.nullable(),
}).strict().superRefine((item, ctx) => {
  if ((item.create_request === null) !== (item.create_request_sha256 === null)
    || (item.completion_evidence === null) !== (item.completion_evidence_sha256 === null)
    || item.signer.actor_id !== item.signer.client_user_id
    || new Set(item.originals.map(file => file.kind)).size !== 3
    || new Set(item.originals.map(file => file.file_id)).size !== 3
    || new Set(item.artifacts.map(file => file.kind)).size !== item.artifacts.length
    || item.originals.some(file => file.storage_path !== `${item.revision_id}/${file.uploader_id}/${file.file_id}`)
    || item.artifacts.some(file => file.path !== signatureArtifactPath(item.environment, item.revision_id, item.operation_id, file.id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid persisted signature action.' })
  }
})
export type SignatureWorkerAction = z.infer<typeof signatureWorkerActionSchema>
const recordSchema = z.object({ operation_id: uuid,
  state: z.enum(['PREPARED','CREATE_INFLIGHT','SENT','UNKNOWN_RECONCILIATION','COMPLETION_OBSERVED','EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED','RECOVERY_REQUIRED']),
  next_action: z.enum(['NONE','PREPARE','CREATE','RECONCILE','RETAIN','VIEW','VOID']), next_check_at: moment.nullable(),
  artifact_id: uuid.nullable(), current: z.boolean(), can_perform: z.boolean() }).strict()

/** Stable per-attempt checkpoints differ from the claim ID; replays cannot authorize HTTP twice. */
export function signatureResultId(action: SignatureViewAction, step: string): string {
  signatureViewActionSchema.parse(action)
  if (!/^[A-Z0-9_:]{1,120}$/.test(step)) throw new OfferingSignatureError()
  const bytes = createHash('sha256').update(`bx1-signature-result-v1:${action.operation_id}:${action.lease_id}:${action.generation}:${action.request_id}:${step}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = bytes.toString('hex')
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`
}

function verifiedWorkerAction(raw: unknown, action?: SignatureViewAction): SignatureWorkerAction {
  const item = signatureWorkerActionSchema.parse(raw)
  const config = signatureWorkerConfig()
  if (config.environment !== item.environment || config.workerId !== item.worker_id
    || action && (item.operation_id !== action.operation_id || item.lease_id !== action.lease_id
      || item.generation !== action.generation || item.request_id !== action.request_id)) throw new OfferingSignatureError()
  return item
}
async function freshAction(action: SignatureViewAction): Promise<SignatureWorkerAction> {
  return verifiedWorkerAction(await readSignatureAction(action), action)
}
async function record(action: SignatureViewAction, name: string, result: unknown, step: string) {
  const value = recordSchema.parse(await recordSignatureAction(action, name, result, signatureResultId(action, step)))
  if (value.operation_id !== action.operation_id) throw new OfferingSignatureError()
  return value
}
function purposeBinding(item: SignatureWorkerAction): Omit<OfferingCoverBinding, 'signer'> {
  const b = item.binding
  return { operationId: item.operation_id, productId: b.product_id, revisionId: item.revision_id,
    manifestId: item.manifest_id, manifestSha256: item.manifest_hash, authorisationId: item.authorisation_id,
    issuerReference: b.issuer_reference, termsSha256: b.terms_hash, textSha256: b.text_sha256,
    commonSha256: b.common_envelope_hash, configurationSha256: b.deployment_configuration_hash,
    declarationRevision: b.declaration_revision, declarationSha256: b.declaration_hash, appointmentId: b.appointment_id,
    appointmentReceiptId: b.appointment_receipt_id, actingOrganisationId: b.acting_organisation_id,
    managerOrganisationId: b.manager_organisation_id, validFrom: b.valid_from, validUntil: b.valid_until,
    sourceReference: b.source_reference, sourceSha256: b.source_sha256 }
}
function originals(item: SignatureWorkerAction) {
  const kinds = ['MEMORANDUM','RISKS','SUBSCRIPTION_TERMS'] as const
  return kinds.map((kind, index) => ({ file: item.originals.find(file => file.kind === kind)!,
    documentId: String(index + 1) as '1' | '2' | '3' }))
}
function frozenExpectation(item: SignatureWorkerAction) {
  if (!item.create_request || !item.create_request_sha256) throw new OfferingSignatureError('The immutable envelope request is missing.', 409)
  return offeringEnvelopeExpectationFromFrozenRequest(item.create_request, item.create_request_sha256,
    { ...purposeBinding(item), signer: { accountId: item.signer.actor_id, personId: item.signer.person_id,
      clientUserId: item.signer.client_user_id }, documents: originals(item).map(file => ({ documentId: file.documentId, sha256: file.file.sha256 })) })
}
function boundedProvider(item: SignatureWorkerAction) {
  const milliseconds = Math.min(50_000, Date.parse(item.lease_expires_at) - Date.now() - 8000)
  if (milliseconds <= 0) throw new OfferingSignatureError('The processing lease has expired; resume its saved operation.', 409)
  const signal = AbortSignal.timeout(milliseconds)
  const provider = createDocusignOfferingProvider(docusignOfferingConfig(), {
    fetch: (input, init) => globalThis.fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
  })
  return { provider, signal }
}
const resources: OfferingProviderResource[] = ['envelope','recipients','documents','custom_fields','audit_events','tabs']
const resourceEvidenceSchema = z.object({ value: z.record(z.string(), z.unknown()), sha256: digest,
  observedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()
const completionSchema = z.object({ envelope: resourceEvidenceSchema, recipients: resourceEvidenceSchema,
  documents: resourceEvidenceSchema, custom_fields: resourceEvidenceSchema, audit_events: resourceEvidenceSchema,
  tabs: resourceEvidenceSchema }).strict()
function completedEvidence(item: SignatureWorkerAction) {
  if (!item.completion_evidence || !item.completion_evidence_sha256
    || offeringSignatureSha256(item.completion_evidence) !== item.completion_evidence_sha256
    || Buffer.byteLength(item.completion_evidence) > 6_291_456) throw new OfferingSignatureError()
  return completionSchema.parse(JSON.parse(item.completion_evidence))
}

/** Background processing never requests a signing view or returns provider URLs/credentials. */
export async function executeSignatureProcessing(instruction: SignatureProcessingRequest) {
  if (instruction.command === 'CLAIM') {
    const raw = await claimSignatureAction(instruction.request_id)
    if (raw === null) return { action: null }
    const item = verifiedWorkerAction(raw)
    if (item.request_id !== instruction.request_id || item.action === 'VIEW') throw new OfferingSignatureError()
    return { action: { operation_id: item.operation_id, lease_id: item.lease_id,
      generation: item.generation, request_id: item.request_id } }
  }
  const action = signatureViewActionSchema.parse({ operation_id: instruction.operation_id,
    lease_id: instruction.lease_id, generation: instruction.generation, request_id: instruction.request_id })
  return processSignatureAction(action)
}

async function processSignatureAction(action: SignatureViewAction) {
  let item = await freshAction(action)
  if (item.action === 'VIEW') throw new OfferingSignatureError('A background worker cannot generate a signing view.', 403)
  const { provider, signal } = boundedProvider(item)
  const live = async () => { signal.throwIfAborted(); item = await freshAction(action); return item }
  const recovery = async (reason: string, evidence: string | null = null, retryAt?: number) => record(action, 'RECOVERY_REQUIRED',
    { reason, evidence_sha256: evidence, ...(retryAt !== undefined ? { next_check_at: new Date(Math.max(Date.now() + 900_000, retryAt)).toISOString() } : {}) }, `RECOVERY:${reason}`)
  try {
    if (item.action === 'PREPARE' || item.action === 'CREATE') {
      // Already persisted CREATE_INFLIGHT can only be reconciled, never sent again.
      if (item.create_request) return { operation_id: item.operation_id, outcome: 'RECONCILE_SAME_OPERATION' }
      if (!item.current || !item.signer.email || !item.signer.name) throw new OfferingSignatureError()
      const documents = await Promise.all(originals(item).map(async ({ file, documentId }) => ({ documentId,
        sha256: file.sha256, bytes: await downloadCleanOfferingDocument({ id: file.file_id, revision_id: item.revision_id,
          uploader_id: file.uploader_id, storage_path: file.storage_path, sha256: file.sha256,
          size: file.size, mime_type: 'application/pdf' }) })))
      await live()
      const prepared = buildOfferingEnvelope({ ...purposeBinding(item), signer: { accountId: item.signer.actor_id,
        personId: item.signer.person_id, clientUserId: item.signer.client_user_id, name: item.signer.name!, email: item.signer.email! }, documents })
      const reserved = await record(action, 'ARTIFACT_RESERVED', { kind: 'COVER_ORIGINAL',
        sha256: offeringSignatureSha256(prepared.cover), size: prepared.cover.length }, 'RESERVE:COVER_ORIGINAL')
      if (!reserved.artifact_id) throw new OfferingSignatureError()
      await live()
      await retainSignatureArtifact({ environment: item.environment, revisionId: item.revision_id, operationId: item.operation_id,
        artifactId: reserved.artifact_id, sha256: offeringSignatureSha256(prepared.cover), size: prepared.cover.length, bytes: prepared.cover, signal })
      await live()
      await record(action, 'ARTIFACT_RETAINED', { artifact_id: reserved.artifact_id,
        sha256: offeringSignatureSha256(prepared.cover), size: prepared.cover.length }, 'RETAIN:COVER_ORIGINAL')
      await provider.authenticate(); await live()
      const checkpoint = await record(action, 'CREATE_RESULT', { phase: 'INFLIGHT', create_request: prepared.body,
        create_request_sha256: prepared.sha256 }, 'CREATE:INFLIGHT')
      if (!checkpoint.can_perform) return { operation_id: item.operation_id, outcome: 'ALREADY_CONSUMED' }
      await live()
      try {
        const sent = await provider.createEnvelope(prepared)
        return await record(action, 'CREATE_RESULT', { phase: 'SENT', envelope_id: sent.envelopeId,
          evidence_sha256: sent.responseSha256 }, 'CREATE:RESULT')
      } catch (error) {
        // Creation remains the original operation even if the response is absent or invalid.
        return await record(action, 'CREATE_RESULT', { phase: 'UNKNOWN', envelope_id: null,
          evidence_sha256: offeringSignatureSha256(JSON.stringify({ result: 'UNKNOWN', code: error instanceof DocusignOfferingError ? error.code : 'IO_UNCERTAIN' })),
          ...(error instanceof DocusignOfferingError && error.retryAt !== null ? { next_check_at: new Date(Math.max(Date.now() + 900_000, error.retryAt)).toISOString() } : {}) }, 'CREATE:UNKNOWN')
      }
    }
    if (item.action === 'RECONCILE' || item.action === 'VOID') {
      const resultName = item.action === 'VOID' ? 'VOID_RESULT' : 'RECONCILE_RESULT'
      const checkpoint = await record(action, resultName, { phase: 'INFLIGHT' }, `${item.action}:INFLIGHT`)
      if (!checkpoint.can_perform) return { operation_id: item.operation_id, outcome: 'ALREADY_CONSUMED' }
      const expected = frozenExpectation(item)
      await provider.authenticate(); await live()
      let envelopeId = item.envelope_id
      if (!envelopeId) {
        const found = await provider.lookupEnvelope(item.operation_id, Date.parse(item.first_attempt_at), 0)
        if (!found.envelope) return await record(action, resultName, { status: 'UNKNOWN', envelope_id: null,
          integrity_verified: false, evidence_sha256: found.responseSha256,
          next_check_at: new Date(Math.max(Date.now() + 900_000, found.nextAllowedAt)).toISOString() }, 'RECONCILE:ABSENT')
        envelopeId = found.envelope.envelopeId
      }
      const binding = { envelopeId, operationId: item.operation_id }
      if (item.action === 'VOID') {
        await live()
        // A completed envelope can reject a void request. Still observe it and archive the late result.
        try { await provider.voidEnvelope(binding) } catch (error) {
          if (error instanceof DocusignOfferingError && error.code === 'THROTTLED') throw error
        }
        await live()
        const observation = await provider.readEnvelopeResource(binding, 'envelope', 0)
        const status = observation.value.status === 'voided' ? 'VOIDED' : observation.value.status === 'completed' ? 'COMPLETED' : 'UNKNOWN'
        if (status === 'COMPLETED') {
          const other = await Promise.all(resources.filter(resource => resource !== 'envelope')
            .map(async resource => [resource, await provider.readEnvelopeResource(binding, resource, 0)] as const))
          await live()
          const evidenceValues: [OfferingProviderResource, OfferingProviderRead][] = [['envelope', observation], ...other]
          const evidence = completionSchema.parse(Object.fromEntries(evidenceValues
            .map(([resource, observed]) => [resource, { value: observed.value, sha256: observed.sha256, observedAt: observed.observedAt }])))
          const assessed = assessOfferingCompletion(expected, binding, { envelope: evidence.envelope.value, recipients: evidence.recipients.value,
            documents: evidence.documents.value, custom_fields: evidence.custom_fields.value, audit_events: evidence.audit_events.value, tabs: evidence.tabs.value })
          const evidenceJson = JSON.stringify(evidence)
          if (Buffer.byteLength(evidenceJson) > 6_291_456) throw new DocusignOfferingError('EVIDENCE_TOO_LARGE')
          return await record(action, 'VOID_RESULT', { status, integrity_verified: assessed.integrity === 'CURRENT_CANDIDATE',
            evidence_json: evidenceJson, evidence_sha256: offeringSignatureSha256(evidenceJson), next_check_at: new Date(Date.now() + 900_000).toISOString() }, 'VOID:COMPLETED')
        }
        return await record(action, 'VOID_RESULT', { status, evidence_sha256: observation.sha256,
          next_check_at: new Date(Math.max(Date.now() + 900_000, observation.nextAllowedAt)).toISOString() }, 'VOID:RESULT')
      }
      // Different resources run together; each request is bounded and the whole lease has a shared deadline.
      const values = await Promise.all(resources.map(async resource => [resource, await provider.readEnvelopeResource(binding, resource, 0)] as const))
      await live()
      const evidence = Object.fromEntries(values.map(([key, value]) => [key, { value: value.value, sha256: value.sha256, observedAt: value.observedAt }]))
      const parsed = completionSchema.parse(evidence)
      const providerState = parsed.envelope.value.status
      const status = providerState === 'completed' ? 'COMPLETED' : providerState === 'declined' ? 'DECLINED'
        : providerState === 'voided' ? 'VOIDED' : ['sent','delivered','signed'].includes(String(providerState)) ? 'SENT' : 'UNKNOWN'
      const assessment = assessOfferingCompletion(expected, binding, { envelope: parsed.envelope.value, recipients: parsed.recipients.value,
        documents: parsed.documents.value, custom_fields: parsed.custom_fields.value, audit_events: parsed.audit_events.value, tabs: parsed.tabs.value })
      const evidenceJson = JSON.stringify(parsed)
      if (Buffer.byteLength(evidenceJson) > 6_291_456) throw new DocusignOfferingError('EVIDENCE_TOO_LARGE')
      return await record(action, 'RECONCILE_RESULT', { status, envelope_id: envelopeId,
        integrity_verified: status === 'COMPLETED' && assessment.integrity === 'CURRENT_CANDIDATE',
        evidence_sha256: offeringSignatureSha256(evidenceJson), next_check_at: new Date(Date.now() + 900_000).toISOString(),
        ...(status === 'COMPLETED' ? { evidence_json: evidenceJson } : {}) }, 'RECONCILE:RESULT')
    }
    if (item.action === 'RETAIN') {
      if (!item.envelope_id) throw new OfferingSignatureError()
      const expected = frozenExpectation(item)
      const evidence = completedEvidence(item)
      const binding = { envelopeId: item.envelope_id, operationId: item.operation_id }
      const assessment = assessOfferingCompletion(expected, binding, { envelope: evidence.envelope.value, recipients: evidence.recipients.value,
        documents: evidence.documents.value, custom_fields: evidence.custom_fields.value, audit_events: evidence.audit_events.value, tabs: evidence.tabs.value })
      await provider.authenticate(); await live()
      const targets = [['MEMORANDUM_SIGNED','1'],['RISKS_SIGNED','2'],['SUBSCRIPTION_TERMS_SIGNED','3'],['COVER_SIGNED','4'],['CERTIFICATE','certificate']] as const
      // Bound each durable artifact attempt; completed copies are reused after an interrupted worker.
      for (const [kind, documentId] of targets) {
        if (item.artifacts.some(file => file.kind === kind && file.state === 'RETAINED')) continue
        const checkpoint = await record(action, 'ARTIFACT_RESERVED', { phase: 'INFLIGHT', kind }, `DOWNLOAD:${kind}`)
        if (!checkpoint.can_perform) return { operation_id: item.operation_id, outcome: 'ALREADY_CONSUMED' }
        await live()
        const artifact = await provider.downloadArtifact(binding, documentId, 0)
        await live()
        const reserved = await record(action, 'ARTIFACT_RESERVED', { kind, sha256: artifact.sha256, size: artifact.size }, `RESERVE:${kind}`)
        if (!reserved.artifact_id) throw new OfferingSignatureError()
        await retainSignatureArtifact({ environment: item.environment, revisionId: item.revision_id, operationId: item.operation_id,
          artifactId: reserved.artifact_id, sha256: artifact.sha256, size: artifact.size, bytes: artifact.bytes, signal })
        await live()
        await record(action, 'ARTIFACT_RETAINED', { artifact_id: reserved.artifact_id, sha256: artifact.sha256, size: artifact.size }, `RETAIN:${kind}`)
        await live()
      }
      if (assessment.integrity !== 'CURRENT_CANDIDATE') return await recovery('PROVIDER_INTEGRITY_UNPROVED', item.completion_evidence_sha256)
      return await record(action, 'EVIDENCE_FINALIZED', { integrity_verified: true, evidence_sha256: item.completion_evidence_sha256 }, 'EVIDENCE:FINALIZED')
    }
    throw new OfferingSignatureError()
  } catch (error) {
    if (error instanceof DocusignOfferingError && error.code === 'THROTTLED' && error.retryAt !== null) {
      return await recovery('PROVIDER_THROTTLED', null, error.retryAt)
    }
    if (error instanceof DocusignOfferingError && ['LOOKUP_EXPIRED','LOOKUP_AMBIGUOUS','EVIDENCE_TOO_LARGE'].includes(error.code)) {
      return await recovery(error.code)
    }
    // A crashed/unknown group is not retried inside this attempt; its persisted deadline governs recovery.
    throw new OfferingSignatureError('Signature processing was interrupted. Its saved operation will reconcile without creating a second envelope.')
  }
}

/** Only a synchronous originating actor response may receive the one-use URL. */
export async function createOfferingSigningView(client: SupabaseClient, input: OfferingSignatureSessionInput,
  action: SignatureViewAction): Promise<{ view_status: 'AVAILABLE' | 'RETRY_SAME_ENVELOPE'; signing_url?: string }> {
  const item = await freshAction(action)
  if (item.action !== 'VIEW' || !item.current || item.originating_actor_id !== input.actorId
    || item.originating_session_id !== input.session.id || item.signer.actor_id !== input.actorId
    || item.revision_id !== input.revisionId || !item.envelope_id) throw new OfferingSignatureError('This signing view does not belong to the current signer and session.', 403)
  const expected = frozenExpectation(item)
  const checkpoint = await record(action, 'SIGNING_VIEW_RESULT', { phase: 'INFLIGHT' }, 'VIEW:INFLIGHT')
  if (!checkpoint.can_perform) return { view_status: 'RETRY_SAME_ENVELOPE' }
  const { provider } = boundedProvider(item)
  let view: Awaited<ReturnType<typeof provider.createSigningView>>
  try {
    view = await provider.createSigningView({ envelopeId: item.envelope_id, operationId: item.operation_id }, expected.signer)
  } catch (error) {
    await record(action, 'SIGNING_VIEW_RESULT', { outcome: 'UNKNOWN', url_sha256: null, expires_at: null,
      ...(error instanceof DocusignOfferingError && error.retryAt !== null ? { next_check_at: new Date(error.retryAt).toISOString() } : {}) }, 'VIEW:UNKNOWN')
    return { view_status: 'RETRY_SAME_ENVELOPE' }
  }
  const current = await freshAction(action)
  const portal = await readPortal(client, input.context)
  const session = await verifiedOfferingFileSession(client, input.actorId)
  if (!current.current || current.envelope_id !== item.envelope_id || current.signer.actor_id !== input.actorId
    || portal.user.id !== input.actorId || session.id !== input.session.id || session.aal !== input.session.aal) throw new OfferingSignatureError('Signing authority or the session changed while the view was prepared.', 403)
  await readOfferingSignatures({ ...input, session })
  await record(action, 'SIGNING_VIEW_RESULT', { outcome: 'CREATED', url_sha256: view.urlSha256,
    expires_at: new Date(view.expiresAt).toISOString() }, 'VIEW:RESULT')
  // The API performs one last current actor/record read before exposing this ephemeral URL.
  return { view_status: 'AVAILABLE', signing_url: view.url }
}

const signatureBucket = 'bx1-offering-signatures'
function signatureStorageClient(signal?: AbortSignal) {
  const config = documentScannerConfig()
  return createClient(config.url, config.storageKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const address = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (address.origin !== new URL(config.url).origin || address.username || address.password || address.hash
        || !address.pathname.startsWith(`/storage/v1/object/${signatureBucket}/`)) throw new OfferingSignatureError()
      const deadline = AbortSignal.timeout(15000)
      const combined = signal ? AbortSignal.any([deadline, signal]) : deadline
      const response = await globalThis.fetch(input, { ...init, redirect: 'error', cache: 'no-store', signal: combined })
      // Do not let the SDK buffer an unbounded object before applying our media/size check.
      if ((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET' || !response.ok) return response
      const claimed = response.headers.get('content-length')
      if (claimed && (!/^[0-9]+$/.test(claimed) || Number(claimed) > 4_194_304)) throw new OfferingSignatureError()
      const reader = response.body?.getReader()
      if (!reader) throw new OfferingSignatureError()
      const chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) {
          combined.throwIfAborted()
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > 4_194_304) throw new OfferingSignatureError()
          chunks.push(next.value)
        }
        if (claimed && Number(claimed) !== size) throw new OfferingSignatureError()
      } finally { await reader.cancel().catch(() => {}) }
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
    } } })
}

export function signatureArtifactPath(environment: 'TESTNET' | 'MAINNET', revisionId: string, operationId: string, artifactId: string): string {
  for (const value of [revisionId, operationId, artifactId]) uuid.parse(value)
  if (!['TESTNET', 'MAINNET'].includes(environment)) throw new OfferingSignatureError()
  return `${environment.toLowerCase()}/${revisionId}/${operationId}/${artifactId}.pdf`
}

function confirmedPdf(bytes: Uint8Array, sha256: string, size: number): void {
  if (bytes.byteLength !== size || size < 8 || size > 4_194_304
    || !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'))
    || !/%%EOF\s*$/.test(Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 1024))).toString('ascii'))
    || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new OfferingSignatureError('The retained signature document failed its integrity check.', 409)
}

async function savedSignatureBytes(path: string, sha256: string, size: number, signal?: AbortSignal): Promise<Uint8Array> {
  const saved = await signatureStorageClient(signal).storage.from(signatureBucket).download(path)
  if (saved.error || !saved.data || saved.data.size !== size || saved.data.type.split(';')[0] !== 'application/pdf') throw new OfferingSignatureError('The private signature evidence could not be read back.', 503)
  const bytes = new Uint8Array(await saved.data.arrayBuffer())
  confirmedPdf(bytes, sha256, size)
  return bytes
}

/** Paths are derived from an authorised snapshot, never from a download URL. */
export async function downloadOfferingSignatureArtifact(input: OfferingSignatureSessionInput,
  snapshot: OfferingSignatureSnapshot, artifactId: string): Promise<Uint8Array> {
  confirmedSnapshot(snapshot, input)
  uuid.parse(artifactId)
  const matches = snapshot.operations.flatMap(operation => operation.artifacts.filter(artifact => artifact.id === artifactId)
    .map(artifact => ({ operation, artifact })))
  if (matches.length !== 1) throw new OfferingSignatureError('This signature artifact is not available in the selected workspace.', 403)
  const { operation, artifact } = matches[0]
  return savedSignatureBytes(signatureArtifactPath(snapshot.environment, snapshot.revision_id, operation.id, artifact.id), artifact.sha256, artifact.size)
}

/** Immutable upload followed by an independent exact read; conflict is not success by itself. */
export async function retainSignatureArtifact(input: { environment: 'TESTNET' | 'MAINNET'; revisionId: string;
  operationId: string; artifactId: string; sha256: string; size: number; bytes: Uint8Array; signal?: AbortSignal }): Promise<void> {
  const path = signatureArtifactPath(input.environment, input.revisionId, input.operationId, input.artifactId)
  confirmedPdf(input.bytes, input.sha256, input.size)
  try {
    await signatureStorageClient(input.signal).storage.from(signatureBucket).upload(path, input.bytes,
      { contentType: 'application/pdf', cacheControl: '0', upsert: false, metadata: { sha256: input.sha256 } })
  } catch { /* Unknown upload outcome: reconcile exactly this immutable path, never overwrite. */ }
  await savedSignatureBytes(path, input.sha256, input.size, input.signal)
}
