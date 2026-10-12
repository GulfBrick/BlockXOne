import 'server-only'
import { createHash } from 'node:crypto'
import { DatabaseError, Pool } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { documentReceiptDatabaseConfig, documentReceiptQuery } from './document-receipts'
import { platformRelease } from '@/lib/platform-release'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { offeringDocumentSnapshotSchema, offeringDocumentPayloadText, type OfferingDocumentCommand,
  type OfferingDocumentSnapshot, type OfferingDocumentRollback } from './offering-files'

export class OfferingFileReceiptError extends Error {
  constructor() { super('The private file reservation or receipt could not be confirmed. Refresh before retrying the same file.'); this.name = 'OfferingFileReceiptError' }
}
export class OfferingDocumentCommandRollback extends Error {
  constructor(public readonly rollback: OfferingDocumentRollback) {
    super('This fresh document action was rolled back because its product revision is stale. Refresh saved state before a new action.')
    this.name = 'OfferingDocumentCommandRollback'
  }
}

// Single file-command query only: protected Stage2 receipt helpers keep their
// generic unknown-outcome behavior. Reuse the same restricted role and bounds;
// this is not another writer, table grant or SQL error passthrough.
let documentCommandPool: { fingerprint: string; pool: Pool } | undefined
function commandDatabase(): Pool {
  const config = { ...documentReceiptDatabaseConfig(), max: 1 }
  const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex')
  if (documentCommandPool && documentCommandPool.fingerprint !== fingerprint) throw new OfferingFileReceiptError()
  if (!documentCommandPool) {
    const pool = new Pool(config)
    pool.on('error', () => {})
    documentCommandPool = { fingerprint, pool }
  }
  return documentCommandPool.pool
}

export function requireOfferingFileReceiptWriter(): void {
  try { documentReceiptDatabaseConfig() }
  catch { throw new OfferingFileReceiptError() }
}

/** Verified against Supabase Auth before any JWT claims are used for the restricted writer. */
export type OfferingFileAttestation = {
  iss: string; sub: string; session_id: string; role: 'authenticated'; aal: 'aal1' | 'aal2';
  exp: number; is_anonymous: false; amr: { method: string; timestamp: number }[];
}
export type OfferingFileSession = { id: string; aal: 'aal1' | 'aal2'; attestation: OfferingFileAttestation }
export async function verifiedOfferingFileSession(client: SupabaseClient, actorId: string): Promise<OfferingFileSession> {
  const { data, error } = await client.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) throw new OfferingFileReceiptError()
  const verified = await client.auth.getUser(token)
  if (verified.error || verified.data.user?.id !== actorId) throw new OfferingFileReceiptError()
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (claims.sub !== actorId || typeof claims.session_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)
      || (claims.aal !== 'aal1' && claims.aal !== 'aal2')) throw new Error()
    const release = platformRelease(process.env)
    const project = release?.environment === 'TESTNET' ? 'fegnnnlseuejkrusbbkv'
      : release?.environment === 'MAINNET' ? 'oqkevkjbkpugjotihtda' : null
    const now = Math.floor(Date.now() / 1000)
    if (!project || typeof claims.iss !== 'string' || claims.iss !== `https://${project}.supabase.co/auth/v1`
      || claims.role !== 'authenticated' || claims.is_anonymous !== false
      || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now || claims.exp >= 1e12
      || !Array.isArray(claims.amr) || claims.amr.length < 1 || claims.amr.length > 10) throw new Error()
    const amr = claims.amr.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error()
      const value = entry as Record<string, unknown>
      if (Object.keys(value).some(key => !['method', 'timestamp'].includes(key))
        || typeof value.method !== 'string' || value.method.length < 1 || value.method.length > 30
        || typeof value.timestamp !== 'number' || !Number.isSafeInteger(value.timestamp)
        || value.timestamp <= 0 || value.timestamp > now) throw new Error()
      return { method: value.method, timestamp: value.timestamp }
    })
    return { id: claims.session_id, aal: claims.aal, attestation: {
      iss: claims.iss, sub: actorId, session_id: claims.session_id, role: 'authenticated', aal: claims.aal,
      exp: claims.exp, is_anonymous: false, amr,
    } }
  } catch { throw new OfferingFileReceiptError() }
}

/** The restricted role has no browser-exposed register RPC or raw table grants. */
type OfferingFileWriterInput = {
  actorId: string; sessionId: string; aal: 'aal1' | 'aal2'; context: object;
  productId: string; revisionId: string; fileId: string; kind: string; title: string;
  sha256: string; size: number;
  attestation: OfferingFileAttestation;
}

async function writeOfferingFile(operation: 'reserve' | 'register', input: OfferingFileWriterInput): Promise<unknown> {
  try {
    return await documentReceiptQuery<unknown>(
      `select bx1_private.${operation}_offering_file($1::uuid,$2::uuid,$3::text,$4::jsonb,
        $5::uuid,$6::uuid,$7::uuid,$8::text,$9::text,$10::text,$11::integer,$12::jsonb) as result`,
      [input.actorId, input.sessionId, input.aal, JSON.stringify(input.context),
        input.productId, input.revisionId, input.fileId, input.kind, input.title, input.sha256, input.size,
        JSON.stringify(input.attestation)],
    )
  } catch { throw new OfferingFileReceiptError() }
}

export async function reserveOfferingFile(input: OfferingFileWriterInput): Promise<unknown> {
  return writeOfferingFile('reserve', input)
}

export async function registerOfferingFile(input: OfferingFileWriterInput): Promise<unknown> {
  return writeOfferingFile('register', input)
}

export type OfferingDocumentSessionInput = {
  actorId: string; session: OfferingFileSession; context: PortalOperatingContext; revisionId: string;
}

function confirmedDocumentSnapshot(data: unknown, input: OfferingDocumentSessionInput): OfferingDocumentSnapshot {
  const parsed = offeringDocumentSnapshotSchema.safeParse(data)
  const environment = platformRelease(process.env)?.environment
  if (!parsed.success || parsed.data.revision_id !== input.revisionId
    || parsed.data.document_access.actor_id !== input.actorId
    || parsed.data.document_access.session_id !== input.session.id
    || parsed.data.document_access.environment !== environment
    || !portalContextMatches(parsed.data.document_access.context, input.context)) throw new OfferingFileReceiptError()
  return parsed.data
}

export async function readOfferingDocuments(input: OfferingDocumentSessionInput): Promise<OfferingDocumentSnapshot> {
  try {
    const data = await documentReceiptQuery<unknown>(
      'select bx1_private.read_offering_documents($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid,$6::jsonb) as result',
      [input.actorId, input.session.id, input.session.aal, JSON.stringify(input.context), input.revisionId,
        JSON.stringify(input.session.attestation)],
    )
    return confirmedDocumentSnapshot(data, input)
  } catch { throw new OfferingFileReceiptError() }
}

export async function executeOfferingDocumentCommand(input: OfferingDocumentSessionInput,
  command: OfferingDocumentCommand): Promise<OfferingDocumentSnapshot> {
  try {
    const { rows } = await commandDatabase().query<{ result: unknown }>(
      'select bx1_private.execute_offering_document_command($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text,$6::uuid,$7::jsonb,$8::jsonb) as result',
      [input.actorId, input.session.id, input.session.aal, JSON.stringify(input.context), command.command,
        command.key, JSON.stringify(command.payload), JSON.stringify(input.session.attestation)],
    )
    if (rows.length !== 1 || rows[0].result === null || rows[0].result === undefined) throw new Error()
    const snapshot = confirmedDocumentSnapshot(rows[0].result, input)
    if (snapshot.product_id !== command.payload.product_id) throw new Error()
    if (command.command === 'seal_offering_document_manifest') {
      if (!snapshot.manifest || snapshot.state !== 'SEALED_SIGNATURE_REQUIRED'
        || JSON.stringify(snapshot.manifest.file_ids) !== JSON.stringify(command.payload.file_ids)
        || snapshot.manifest.correspondence_statement !== command.payload.correspondence_statement) throw new Error()
    } else {
      const intentId = command.payload.intent_id
      const intent = snapshot.files.find(file => file.id === intentId)
      if (!intent || !['REJECTED', 'EXCLUDED'].includes(intent.intent_state)) throw new Error()
    }
    return snapshot
  } catch (error) {
    // The canonical function checks an exact committed prior key first. This
    // one error is raised before fresh receipt/DML; a trusted PostgreSQL error
    // proves that invocation rolled back. Timeouts/transport/other23514 stay
    // unknown and must never clear the original request identity.
    if (error instanceof DatabaseError && error.code === '23514' && error.message === 'offering_document_stale') {
      throw new OfferingDocumentCommandRollback({ outcome: 'DEFINITE_ROLLBACK', reason: 'STALE_PRODUCT_REVISION', effects: 'NONE', code: '23514',
        key: command.key, command: command.command, actor_id: input.actorId, product_id: command.payload.product_id,
        revision_id: input.revisionId, expected_revision: command.payload.expected_revision, context: input.context,
        payload_sha256: createHash('sha256').update(offeringDocumentPayloadText(command)).digest('hex') })
    }
    throw new OfferingFileReceiptError()
  }
}

export function offeringFileId(revisionId: string, actorId: string, kind: string, sha256: string): string {
  const digest = createHash('sha256').update(['bx1-offering-file-v1', revisionId, actorId, kind, sha256].join('\u0000')).digest('hex').slice(0, 32)
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`
}

/** A signature check only. Quarantine is never a malware verdict. */
export function isPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-'
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
