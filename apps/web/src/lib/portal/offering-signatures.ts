import { z } from 'zod'
import { portalContextKey, portalContextMatches, portalOperatingContextSchema, type PortalOperatingContext } from './operating-context'

const id = z.string().uuid().regex(/^[0-9a-f-]{36}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const at = z.string().datetime({ offset: true })
const bounded = (min: number, max: number) => z.string().refine(value => Array.from(value.trim()).length >= min && Array.from(value).length <= max)
export const offeringSignatureCommands = ['REQUEST_PURPOSE', 'REVIEW_PURPOSE', 'REVOKE_PURPOSE', 'PREPARE_EXECUTION', 'REQUEST_RECONCILIATION', 'REQUEST_RECOVERY', 'REQUEST_SIGNING_VIEW'] as const
export const offeringSignatureCommandNameSchema = z.enum(offeringSignatureCommands)
const target = { product_id: id, offering_revision_id: id, expected_revision: z.number().int().positive().max(999_999_999) }
export const offeringSignatureCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('REQUEST_PURPOSE'), key: id, payload: z.object({ ...target, appointment_id: id, valid_from: at, valid_until: at, source_reference: bounded(20, 1000), source_sha256: hash }).strict().refine(value => Date.parse(value.valid_until) > Date.parse(value.valid_from)) }).strict(),
  z.object({ command: z.literal('REVIEW_PURPOSE'), key: id, payload: z.object({ ...target, authorisation_id: id, decision: z.enum(['APPROVED', 'REJECTED']), reason: bounded(20, 1000) }).strict() }).strict(),
  z.object({ command: z.literal('REVOKE_PURPOSE'), key: id, payload: z.object({ ...target, authorisation_id: id, reason: bounded(20, 1000) }).strict() }).strict(),
  z.object({ command: z.literal('PREPARE_EXECUTION'), key: id, payload: z.object({ ...target, authorisation_id: id }).strict() }).strict(),
  z.object({ command: z.literal('REQUEST_RECONCILIATION'), key: id, payload: z.object({ ...target, operation_id: id }).strict() }).strict(),
  z.object({ command: z.literal('REQUEST_RECOVERY'), key: id, payload: z.object({ ...target, operation_id: id, reason: bounded(20, 1000) }).strict() }).strict(),
  z.object({ command: z.literal('REQUEST_SIGNING_VIEW'), key: id, payload: z.object({ ...target, operation_id: id }).strict() }).strict(),
])
export type OfferingSignatureCommand = z.infer<typeof offeringSignatureCommandSchema>
export const offeringSignatureRequestSchema = z.object({ expected_actor: id, operating_context: portalOperatingContextSchema, request: offeringSignatureCommandSchema }).strict()
export const offeringSignatureStateSchema = z.enum(['PREPARED', 'CREATE_INFLIGHT', 'SENT', 'UNKNOWN_RECONCILIATION', 'COMPLETION_OBSERVED', 'EVIDENCE_RETAINED', 'DECLINED', 'VOIDED', 'SUPERSEDED', 'RECOVERY_REQUIRED'])
export const offeringSignatureArtifactSchema = z.object({ id, kind: z.enum(['COVER_ORIGINAL', 'MEMORANDUM_SIGNED', 'RISKS_SIGNED', 'SUBSCRIPTION_TERMS_SIGNED', 'COVER_SIGNED', 'CERTIFICATE']), sha256: hash, size: z.number().int().positive().max(4_194_304), mime_type: z.literal('application/pdf') }).strict()
const snapshotShape = {
  version: z.literal(1), actor_id: id, session_id: id, context: portalOperatingContextSchema, environment: z.enum(['TESTNET', 'MAINNET']),
  product_id: id, revision_id: id, expected_revision: z.number().int().positive().max(999_999_999), purpose: z.literal('ISSUER_PACKAGE_EXECUTION'), admitted: z.boolean(),
  authorisations: z.object({ id, signer_id: id, signer_person_id: id, appointment_id: id, state: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'SUPERSEDED']), valid_from: at, valid_until: at, source_reference: bounded(20, 1000) }).strict().array().max(100),
  operations: z.object({ id, authorisation_id: id, state: offeringSignatureStateSchema, current: z.boolean(), noncurrent_reason: bounded(1, 1000).nullable(), envelope_id: id.nullable(), next_check_at: at.nullable(), artifacts: offeringSignatureArtifactSchema.array().max(6) }).strict().array().max(100),
  allowed_commands: offeringSignatureCommandNameSchema.array().max(offeringSignatureCommands.length), blocker: bounded(1, 1000).nullable(),
}
function validateSnapshot(value: z.infer<typeof signatureSnapshotObject>, ctx: z.RefinementCtx) {
  const authorisations = new Set(value.authorisations.map(item => item.id))
  if (authorisations.size !== value.authorisations.length || new Set(value.operations.map(item => item.id)).size !== value.operations.length
    || new Set(value.allowed_commands).size !== value.allowed_commands.length
    || (!value.admitted || value.environment !== 'TESTNET') && value.allowed_commands.length > 0
    || value.operations.some(item => !authorisations.has(item.authorisation_id) || new Set(item.artifacts.map(artifact => artifact.id)).size !== item.artifacts.length
      || new Set(item.artifacts.map(artifact => artifact.kind)).size !== item.artifacts.length
      || item.current && (!value.admitted || value.environment !== 'TESTNET' || item.noncurrent_reason !== null || item.state !== 'EVIDENCE_RETAINED'
        || !['MEMORANDUM_SIGNED', 'RISKS_SIGNED', 'SUBSCRIPTION_TERMS_SIGNED', 'COVER_SIGNED', 'CERTIFICATE'].every(kind => item.artifacts.some(artifact => artifact.kind === kind))))
    || value.authorisations.some(item => Date.parse(item.valid_until) <= Date.parse(item.valid_from))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid scoped signature evidence.' })
}
const signatureSnapshotObject = z.object(snapshotShape).strict()
export const offeringSignatureSnapshotSchema = signatureSnapshotObject.superRefine(validateSnapshot)
export type OfferingSignatureSnapshot = z.infer<typeof offeringSignatureSnapshotSchema>
export const offeringSignatureActionSchema = z.object({ operation_id: id, lease_id: id, generation: z.number().int().positive(), request_id: id }).strict()
/** Restricted SQL response only; never pass its action lease to a browser. */
export const offeringSignatureCommandResultSchema = signatureSnapshotObject.extend({ action: offeringSignatureActionSchema.optional() }).strict().superRefine(validateSnapshot)
export const offeringSigningUrlSchema = z.string().max(4096).url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.hostname === 'demo.docusign.net' && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/Signing/')
})
/** Ephemeral response only. Never journal or persist the URL. */
export const offeringSignatureViewResponseSchema = z.object({ snapshot: offeringSignatureSnapshotSchema, signing_url: offeringSigningUrlSchema }).strict()
export const offeringSignatureResponseSchema = z.object({ snapshot: offeringSignatureSnapshotSchema, command: offeringSignatureCommandNameSchema, key: id,
  view_status: z.enum(['AVAILABLE', 'RETRY_SAME_ENVELOPE']).optional(), signing_url: offeringSigningUrlSchema.optional(),
}).strict().refine(value => value.command === 'REQUEST_SIGNING_VIEW'
  ? value.view_status === 'AVAILABLE' ? value.signing_url !== undefined : value.view_status === 'RETRY_SAME_ENVELOPE' && value.signing_url === undefined
  : value.view_status === undefined && value.signing_url === undefined)
export type SignatureRetryScope = { actorId: string; productId: string; revisionId: string; context: PortalOperatingContext }
export function offeringSignatureScopeMatches(value: OfferingSignatureSnapshot, scope: SignatureRetryScope, expectedRevision?: number): boolean {
  return value.actor_id === scope.actorId && value.product_id === scope.productId && value.revision_id === scope.revisionId
    && portalContextMatches(value.context, scope.context) && (expectedRevision === undefined || value.expected_revision === expectedRevision)
}
export function offeringSignatureUrl(revisionId: string, context: PortalOperatingContext, artifactId?: string): string {
  const query = new URLSearchParams({ revision_id: revisionId })
  if (context.mode === 'APPLICANT') query.set('mode', 'applicant')
  else { query.set('organisation', context.organisationId); query.set('role', context.role) }
  if (artifactId) { query.set('id', artifactId); query.set('download', '1') }
  return `/api/portal/offering-signatures?${query}`
}
const markerSchema = z.object({ version: z.literal(1), actor_id: id, product_id: id, revision_id: id, context: portalOperatingContextSchema, request: offeringSignatureCommandSchema }).strict()
const retryKey = (scope: SignatureRetryScope) => `bx1-offering-signature-request-v1:${scope.actorId}:${portalContextKey(scope.context)}:${scope.productId}:${scope.revisionId}`
export function readOfferingSignatureRetry(storage: Pick<Storage, 'getItem'>, scope: SignatureRetryScope): OfferingSignatureCommand | null {
  const raw = storage.getItem(retryKey(scope))
  if (raw === null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('The signature request journal cannot be verified.') }
  const parsed = markerSchema.safeParse(value)
  if (!parsed.success || parsed.data.actor_id !== scope.actorId || parsed.data.product_id !== scope.productId || parsed.data.revision_id !== scope.revisionId
    || !portalContextMatches(parsed.data.context, scope.context) || parsed.data.request.payload.product_id !== scope.productId || parsed.data.request.payload.offering_revision_id !== scope.revisionId) throw new Error('The saved signature request does not match this actor, context and revision.')
  return parsed.data.request
}
export function saveOfferingSignatureRetry(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: SignatureRetryScope, request: OfferingSignatureCommand): void {
  const checked = offeringSignatureCommandSchema.parse(request)
  if (checked.payload.product_id !== scope.productId || checked.payload.offering_revision_id !== scope.revisionId) throw new Error('The signature request does not match this revision.')
  const prior = readOfferingSignatureRetry(storage, scope)
  if (prior && JSON.stringify(prior) !== JSON.stringify(checked)) throw new Error('Reconcile the original signature request before another action.')
  storage.setItem(retryKey(scope), JSON.stringify(markerSchema.parse({ version: 1, actor_id: scope.actorId, product_id: scope.productId, revision_id: scope.revisionId, context: scope.context, request: checked })))
}
export function clearOfferingSignatureRetry(storage: Pick<Storage, 'getItem' | 'removeItem'>, scope: SignatureRetryScope, request: OfferingSignatureCommand): void {
  const prior = readOfferingSignatureRetry(storage, scope)
  if (!prior || JSON.stringify(prior) !== JSON.stringify(offeringSignatureCommandSchema.parse(request))) throw new Error('The original signature request changed; no journal entry was cleared.')
  storage.removeItem(retryKey(scope))
}
