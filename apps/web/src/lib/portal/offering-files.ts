import { z } from 'zod'

export const offeringFileBucket = 'bx1-offering-quarantine'
export const offeringFileMaxBytes = 4_194_304
// A quarantined upload currently has no independent scan, promotion or
// disposition workflow. Keep the user write path closed until that workflow
// can resolve an intent without stranding the offering revision.
export const offeringFileIntakeEnabled = false

export const offeringFileKindSchema = z.enum(['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'])
export const offeringFileReceiptSchema = z.object({
  id: z.string().uuid(), revision_id: z.string().uuid(), kind: offeringFileKindSchema,
  title: z.string().min(1).max(160), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(1).max(offeringFileMaxBytes),
  validation_state: z.literal('QUARANTINED'), uploaded_at: z.string().datetime({ offset: true }),
  can_download: z.boolean().optional(),
}).strict()
export const offeringFileListItemSchema = offeringFileReceiptSchema.extend({ can_download: z.boolean() })

export const offeringFileLookupSchema = z.object({
  id: z.string().uuid(), revision_id: z.string().uuid(), storage_path: z.string().max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().min(1).max(offeringFileMaxBytes),
  mime_type: z.literal('application/pdf'), validation_state: z.literal('QUARANTINED'),
}).strict()

export function offeringFilePath(revisionId: string, actorId: string, fileId: string): string {
  return `${revisionId}/${actorId}/${fileId}`
}
