import { z } from 'zod'
import { evidenceSchema } from './contracts'

const id = z.string().uuid()
const revision = z.number().int().min(0).max(999_999_999)
const unfinished = (maximum: number) => z.string().max(maximum)
export const applicationDraftSteps = ['identity', 'organisation', 'purpose', 'evidence', 'ownership', 'review'] as const
const draftEvidence = evidenceSchema.extend({ title: z.string().min(1).max(160), storage_path: z.string().min(1).max(400) }).strict()

// This is an unfinished-answer shape, not application admission validation.
// No trimming, defaults, fictional-data acknowledgement or browser persistence.
const unfinishedOwnership = z.object({
  id, party_type: z.enum(['PERSON', 'ENTITY']), legal_name: unfinished(160), registration_reference: unfinished(100),
  country: unfinished(2), relationship: z.enum(['DIRECT_OWNER', 'INDIRECT_OWNER', 'CONTROLLER']),
  ownership_basis_points: z.number().int().min(0).max(10_000), control_basis: unfinished(1000),
  effective_on: unfinished(10), change_reason: unfinished(500), evidence_document_id: z.union([z.literal(''), id]),
}).strict()
export const applicationDraftAnswersSchema = z.object({
  full_name: unfinished(120), country: unfinished(2), investor_type: z.enum(['INDIVIDUAL', 'ENTITY']),
  company_name: unfinished(160), registration_reference: unfinished(100), beneficial_owners: unfinished(2000),
  source_of_funds: unfinished(2000), experience: unfinished(2000), business_activities: unfinished(2000),
  representative_position: unfinished(160), authority_basis: unfinished(2000),
  documents: z.array(draftEvidence).max(8), ownership_control: z.array(unfinishedOwnership).max(20),
  ownership_change_reason: unfinished(500),
}).strict()
export const applicationDraftPayloadSchema = z.object({
  application_id: id, expected_application_revision: revision.refine(value => value > 0),
  expected_draft_revision: revision, answers: applicationDraftAnswersSchema, step: z.enum(applicationDraftSteps),
}).strict()
export const applicationDraftRequestSchema = applicationDraftPayloadSchema.extend({ key: id }).strict()

/** Compare JSON facts independent of JSONB key order, never normalize away edits. */
export function applicationDraftContentMatches(left: unknown, right: unknown): boolean {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
    return value
  }
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))
}

const savedDraftSchema = z.object({ answers: applicationDraftAnswersSchema, step: z.enum(applicationDraftSteps), saved_at: z.string().datetime({ offset: true }) }).strict()
export const applicationDraftEnvelopeSchema = z.object({
  version: z.literal(1), environment: z.enum(['TESTNET', 'MAINNET']), actor_id: id,
  application: z.object({
    id, persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']), status: z.enum(['DRAFT', 'CHANGES_REQUIRED', 'REJECTED']),
    context_kind: z.enum(['PERSONAL', 'ORGANISATION']), context_organisation_id: id.nullable(),
    origin: z.enum(['LEGACY', 'SIGNUP', 'SELF_SERVICE']),
    admission_purpose: z.enum(['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION', 'LEGACY_REHEARSAL']),
  }).strict(),
  base_application_revision: revision.refine(value => value > 0), draft_revision: revision,
  draft: savedDraftSchema.nullable(),
  receipt: z.object({ key: id, payload: applicationDraftPayloadSchema, draft_revision: revision.refine(value => value > 0), saved_at: z.string().datetime({ offset: true }) }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.draft === null) !== (value.draft_revision === 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Draft revision does not match saved content.' })
  if ((value.application.context_kind === 'PERSONAL') !== (value.application.context_organisation_id === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Application context does not match.' })
  if (value.receipt && (!value.draft || value.receipt.payload.application_id !== value.application.id
    || value.receipt.payload.expected_application_revision !== value.base_application_revision
    || value.receipt.payload.expected_draft_revision + 1 !== value.receipt.draft_revision
    || value.receipt.draft_revision !== value.draft_revision || value.receipt.saved_at !== value.draft.saved_at
    || value.receipt.payload.step !== value.draft.step || !applicationDraftContentMatches(value.receipt.payload.answers, value.draft.answers))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Receipt does not confirm the exact current draft.' })
  }
})
export type ApplicationDraftAnswers = z.infer<typeof applicationDraftAnswersSchema>
export type ApplicationDraftRequest = z.infer<typeof applicationDraftRequestSchema>
export type ApplicationDraftEnvelope = z.infer<typeof applicationDraftEnvelopeSchema>
