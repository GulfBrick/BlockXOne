import { z } from 'zod'
import { portalContextKey, portalContextMatches, portalOperatingContextSchema, type PortalOperatingContext } from './operating-context'

export const offeringFileBucket = 'bx1-offering-quarantine'
export const offeringFileMaxBytes = 4_194_304
export const offeringCleanFileBucket = 'bx1-offering-documents'
const id = z.string().uuid().regex(/^[0-9a-f-]{36}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const at = z.string().datetime({ offset: true })
const actionText = (minimum: number, maximum: number) => z.string().refine(value => Array.from(value.trim()).length >= minimum && Array.from(value).length <= maximum)

export const offeringFileKindSchema = z.enum(['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'])
export const offeringFileReceiptSchema = z.object({
  id: z.string().uuid(), revision_id: z.string().uuid(), kind: offeringFileKindSchema,
  title: z.string().min(1).max(160), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(1).max(offeringFileMaxBytes),
  validation_state: z.literal('QUARANTINED'), uploaded_at: z.string().datetime({ offset: true }),
  can_download: z.boolean().optional(),
}).strict()
export const offeringFileListItemSchema = offeringFileReceiptSchema.omit({ uploaded_at: true }).extend({
  uploaded_at: at.nullable(), can_download: z.boolean(),
  intent_state: z.enum(['PENDING', 'PROMOTED_CLEAN', 'REJECTED', 'EXCLUDED']),
  processing_state: z.enum(['QUEUED', 'LEASED', 'RETRY_WAIT', 'EXHAUSTED', 'RESULT_RECORDED', 'COMPLETED', 'REJECTED', 'EXCLUDED']).nullable(),
  clean_receipt_id: id.nullable(), selected: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.selected && (value.intent_state !== 'PROMOTED_CLEAN' || value.clean_receipt_id === null)
    || value.intent_state === 'PROMOTED_CLEAN' && value.clean_receipt_id === null
    || value.can_download && value.uploaded_at === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent document evidence.' })
})

export const offeringFileReservationSchema = z.object({
  id, path: z.string().max(200), revision_id: id, sha256: hash,
  size: z.number().int().min(1).max(offeringFileMaxBytes),
}).strict()

export const offeringFileLookupSchema = z.object({
  id: z.string().uuid(), revision_id: z.string().uuid(), storage_path: z.string().max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().min(1).max(offeringFileMaxBytes),
  mime_type: z.literal('application/pdf'), validation_state: z.literal('QUARANTINED'),
  product_id: id, uploader_id: id, bucket: z.enum([offeringFileBucket, offeringCleanFileBucket]),
  intent_state: z.enum(['PENDING', 'PROMOTED_CLEAN', 'REJECTED', 'EXCLUDED']),
  clean_receipt_id: id.nullable(), manifest_id: id.nullable(), manifest_hash: hash.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.storage_path !== offeringFilePath(value.revision_id, value.uploader_id, value.id)
    || value.bucket === offeringCleanFileBucket && (value.intent_state !== 'PROMOTED_CLEAN'
      || !value.clean_receipt_id || !value.manifest_id || !value.manifest_hash)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid private document binding.' })
  }
})

export const offeringDocumentStateSchema = z.enum(['LEGACY_TEXT_ONLY', 'NOT_ADMITTED', 'PENDING_SCAN', 'REJECTED_OR_EXCLUDED', 'READY_TO_SEAL', 'SEALED_SIGNATURE_REQUIRED'])
const legacyOfferingDocumentEvidenceSchema = z.object({
  profile: z.literal('PDF_SIGNATURE_REQUIRED_V1'),
  state: offeringDocumentStateSchema.exclude(['LEGACY_TEXT_ONLY']),
  manifest_id: id.nullable(), manifest_hash: hash.nullable(),
  signature_status: z.literal('NOT_CONNECTED'), approval_allowed: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if ((value.state === 'SEALED_SIGNATURE_REQUIRED') !== Boolean(value.manifest_id && value.manifest_hash)
    || (value.manifest_id === null) !== (value.manifest_hash === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid manifest readiness.' })
})
export const offeringSignatureStatusSchema = z.enum(['NOT_ADMITTED', 'PURPOSE_REQUIRED', 'SIGNATURE_REQUIRED', 'PENDING', 'EVIDENCE_RETAINED', 'NON_CURRENT', 'RECOVERY_REQUIRED'])
const currentOfferingDocumentEvidenceSchema = z.object({
  version: z.literal(2), profile: z.literal('PDF_SIGNATURE_REQUIRED_V1'),
  state: offeringDocumentStateSchema.exclude(['LEGACY_TEXT_ONLY']),
  manifest_id: id.nullable(), manifest_hash: hash.nullable(),
  signature_status: offeringSignatureStatusSchema, approval_allowed: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if ((value.state === 'SEALED_SIGNATURE_REQUIRED') !== Boolean(value.manifest_id && value.manifest_hash)
    || (value.manifest_id === null) !== (value.manifest_hash === null)
    || value.approval_allowed !== (value.signature_status === 'EVIDENCE_RETAINED')
    || value.approval_allowed && value.state !== 'SEALED_SIGNATURE_REQUIRED') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid current signature readiness.' })
})
export const offeringDocumentEvidenceSchema = z.union([legacyOfferingDocumentEvidenceSchema, currentOfferingDocumentEvidenceSchema])
export type OfferingDocumentEvidence = z.infer<typeof offeringDocumentEvidenceSchema>

const documentAction = z.enum(['resolve_offering_file_intent', 'seal_offering_document_manifest'])
const documentAccessFields = {
  actor_id: id, environment: z.enum(['TESTNET', 'MAINNET']), context: portalOperatingContextSchema, session_id: id, revision_id: id, product_id: id,
  allowed_commands: documentAction.array().max(2), can_upload: z.boolean(), can_read_clean: z.boolean(),
}
export const offeringDocumentAccessSchema = z.discriminatedUnion('version', [
  z.object({ ...documentAccessFields, version: z.literal(1), approval_allowed: z.literal(false), approval_blocker: z.literal('signature-not-connected').nullable() }).strict(),
  z.object({ ...documentAccessFields, version: z.literal(2), signature_status: offeringSignatureStatusSchema,
    approval_allowed: z.boolean(), approval_blocker: z.enum(['signature-not-admitted', 'signature-required', 'signature-noncurrent']).nullable() }).strict(),
])
export const offeringDocumentSnapshotSchema = z.object({
  revision_id: id, product_id: id, profile: z.literal('PDF_SIGNATURE_REQUIRED_V1').nullable(),
  state: offeringDocumentStateSchema,
  manifest: z.object({ id, hash, sealed_at: at, file_ids: z.tuple([id, id, id]), correspondence_statement: actionText(20, 3000) }).strict().nullable(),
  files: offeringFileListItemSchema.array().max(100),
  document_access: offeringDocumentAccessSchema,
}).strict().superRefine((value, ctx) => {
  const access = value.document_access
  const uniqueFiles = new Set(value.files.map(file => file.id))
  if (access.product_id !== value.product_id || access.revision_id !== value.revision_id
    || uniqueFiles.size !== value.files.length || value.files.some(file => file.revision_id !== value.revision_id)
    || new Set(access.allowed_commands).size !== access.allowed_commands.length
    || (value.profile === null) !== (value.state === 'LEGACY_TEXT_ONLY')
    || access.version === 1 && access.approval_blocker !== (value.profile ? 'signature-not-connected' : null)
    || access.version === 2 && (access.approval_allowed !== (access.signature_status === 'EVIDENCE_RETAINED')
      || access.approval_allowed && (value.state !== 'SEALED_SIGNATURE_REQUIRED' || !value.manifest || access.approval_blocker !== null)
      || value.profile !== null && !access.approval_allowed && access.approval_blocker === null)
    || (value.state === 'SEALED_SIGNATURE_REQUIRED') !== (value.manifest !== null)
    || (['NOT_ADMITTED', 'LEGACY_TEXT_ONLY', 'SEALED_SIGNATURE_REQUIRED'].includes(value.state) && access.can_upload)
    || access.can_read_clean && value.state !== 'SEALED_SIGNATURE_REQUIRED'
    || ['NOT_ADMITTED', 'LEGACY_TEXT_ONLY'].includes(value.state) && access.allowed_commands.length !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent scoped document readiness.' })
  }
  if (value.manifest) {
    const kinds = offeringFileKindSchema.options
    if (new Set(value.manifest.file_ids).size !== 3 || value.manifest.file_ids.some((fileId, index) => {
      const file = value.files.find(item => item.id === fileId)
      return !file || file.kind !== kinds[index] || !file.selected || file.intent_state !== 'PROMOTED_CLEAN'
    })) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The manifest is not the exact canonical clean selection.' })
  }
})
export type OfferingDocumentSnapshot = z.infer<typeof offeringDocumentSnapshotSchema>

// Preserve the complete input identity. Never trim/strip an action body before
// the database compares an exact prior request; UI may explicitly trim drafts.
const target = { product_id: id, offering_revision_id: id, expected_revision: z.number().int().positive().max(999_999_999) }
export const offeringDocumentCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('resolve_offering_file_intent'), key: id,
    payload: z.object({ ...target, intent_id: id, reason: actionText(20, 1000) }).strict() }).strict(),
  z.object({ command: z.literal('seal_offering_document_manifest'), key: id,
    payload: z.object({ ...target, file_ids: z.tuple([id, id, id]).refine(ids => new Set(ids).size === 3),
      correspondence_statement: actionText(20, 3000) }).strict() }).strict(),
])
export type OfferingDocumentCommand = z.infer<typeof offeringDocumentCommandSchema>

export const offeringDocumentRollbackSchema = z.object({
  outcome: z.literal('DEFINITE_ROLLBACK'), reason: z.literal('STALE_PRODUCT_REVISION'), effects: z.literal('NONE'),
  code: z.literal('23514'), command: documentAction, key: id, actor_id: id, product_id: id, revision_id: id,
  expected_revision: z.number().int().positive().max(999_999_999), context: portalOperatingContextSchema, payload_sha256: hash,
}).strict()
export type OfferingDocumentRollback = z.infer<typeof offeringDocumentRollbackSchema>
export function offeringDocumentPayloadText(request: OfferingDocumentCommand): string {
  return JSON.stringify(offeringDocumentCommandSchema.parse(request).payload)
}
export function offeringDocumentRollbackMatches(value: unknown, scope: DocumentRetryScope,
  request: OfferingDocumentCommand, payloadSha256: string): boolean {
  const parsed = offeringDocumentRollbackSchema.safeParse(value)
  return parsed.success && parsed.data.actor_id === scope.actorId && parsed.data.product_id === scope.productId
    && parsed.data.revision_id === scope.revisionId && portalContextMatches(parsed.data.context, scope.context)
    && parsed.data.key === request.key && parsed.data.command === request.command
    && parsed.data.expected_revision === request.payload.expected_revision && parsed.data.payload_sha256 === payloadSha256
}

type DocumentRetryScope = { actorId: string; productId: string; revisionId: string; context: PortalOperatingContext }
const retryMarkerSchema = z.object({ version: z.literal(1), actor_id: id, product_id: id, revision_id: id,
  context: portalOperatingContextSchema, request: offeringDocumentCommandSchema }).strict()
function retryKey(scope: DocumentRetryScope): string {
  return `bx1-offering-document-request-v1:${scope.actorId}:${portalContextKey(scope.context)}:${scope.productId}:${scope.revisionId}`
}
/** Separate file-domain journal. Never add these actions to offering_access v1. */
export function readOfferingDocumentRetry(storage: Pick<Storage, 'getItem'>, scope: DocumentRetryScope): OfferingDocumentCommand | null {
  const stored = storage.getItem(retryKey(scope))
  if (stored === null) return null
  let value: unknown
  try { value = JSON.parse(stored) } catch { throw new Error('The saved document request cannot be verified. No new request is available.') }
  const marker = retryMarkerSchema.safeParse(value)
  if (!marker.success || marker.data.actor_id !== scope.actorId || marker.data.product_id !== scope.productId
    || marker.data.revision_id !== scope.revisionId || !portalContextMatches(marker.data.context, scope.context)
    || marker.data.request.payload.product_id !== scope.productId || marker.data.request.payload.offering_revision_id !== scope.revisionId) {
    throw new Error('The saved document request does not match this actor, context and revision. No new request is available.')
  }
  return marker.data.request
}
export function saveOfferingDocumentRetry(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: DocumentRetryScope, request: OfferingDocumentCommand): void {
  const checked = offeringDocumentCommandSchema.parse(request)
  if (checked.payload.product_id !== scope.productId || checked.payload.offering_revision_id !== scope.revisionId) throw new Error('The document request does not match this revision.')
  const prior = readOfferingDocumentRetry(storage, scope)
  if (prior && JSON.stringify(prior) !== JSON.stringify(checked)) throw new Error('An earlier document request must be reconciled before another action.')
  const marker = retryMarkerSchema.parse({ version: 1, actor_id: scope.actorId, product_id: scope.productId,
    revision_id: scope.revisionId, context: scope.context, request: checked })
  storage.setItem(retryKey(scope), JSON.stringify(marker))
}
export function clearOfferingDocumentRetry(storage: Pick<Storage, 'getItem' | 'removeItem'>, scope: DocumentRetryScope, request: OfferingDocumentCommand): void {
  const prior = readOfferingDocumentRetry(storage, scope)
  if (!prior || JSON.stringify(prior) !== JSON.stringify(offeringDocumentCommandSchema.parse(request))) throw new Error('The saved request changed during reconciliation. Refresh before another action.')
  storage.removeItem(retryKey(scope))
}

export function offeringFilePath(revisionId: string, actorId: string, fileId: string): string {
  return `${revisionId}/${actorId}/${fileId}`
}
