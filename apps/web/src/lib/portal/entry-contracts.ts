import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import { applicationDetailsSchema, applicationDraftDetailsSchema, applicationStatuses } from './contracts'

const id = z.string().uuid()
export const entryApplicationSchema = z.object({
  id, user_id: id, persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']),
  status: z.enum(applicationStatuses), revision: z.number().int().positive(),
  details: applicationDraftDetailsSchema,
  submitted_at: z.string().nullable(), reviewed_at: z.string().nullable(),
  reviewer_id: id.nullable(), review_notes: z.string().nullable(), organisation_id: id.nullable(),
  review_checks: z.record(z.boolean()), provider_mode: z.enum(['UNASSIGNED', 'MANUAL_TEST_REVIEW']),
  approved_until: z.string().nullable(), context_kind: z.enum(['PERSONAL', 'ORGANISATION']),
  context_organisation_id: id.nullable(), origin: z.enum(['LEGACY', 'SIGNUP', 'SELF_SERVICE']), created_at: z.string().nullable(),
  admission_purpose: z.enum(['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION', 'LEGACY_REHEARSAL']),
  review_route: z.enum(['NOT_ADMITTED', 'REVIEWER_UNAVAILABLE', 'AVAILABLE']),
  can_request_mandate: z.boolean().optional(),
})
export const entryMandateSchema = z.object({
  id, application_id: id, product_organisation_id: id, native_organisation_id: id.nullable(),
  applicant_user_id: id, organisation_name: z.string(), role: z.literal('OfferingManager'),
  status: z.enum(['SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED', 'APPLIED', 'REVOKED']),
  revision: z.number().int().positive(), requested_until: z.string(), evidence_reference: z.string(),
  review_notes: z.string().nullable(), reviewer_user_id: id.nullable(), applied_by_user_id: id.nullable(),
  admission_revision: z.number().int().positive(),
  admission_status: z.enum(applicationStatuses), admission_approved_until: z.string().nullable(),
  admission_purpose: z.enum(['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION', 'LEGACY_REHEARSAL']),
  effective: z.boolean(), next_owner: z.enum(['APPLICANT', 'COMPLIANCE', 'SUPER_ADMIN', 'NONE']), can_request: z.boolean(),
  can_review: z.boolean(), can_apply: z.boolean(), can_revoke: z.boolean(),
  reviewer_scope_organisation_id: id.optional(),
})
export const entrySnapshotSchema = z.object({
  entry_version: z.literal(1), actor: z.object({ id, email: z.string() }),
  applications: z.array(entryApplicationSchema),
  contexts: z.array(z.object({ context_key: id, organisation_id: id, name: z.string(), roles: z.array(z.enum(BX1_ROLES)) })),
  admission: z.object({ manual_test_review: z.boolean() }),
  organisation_mandates: z.array(entryMandateSchema).optional(),
  requests: z.array(z.object({ key: id, command: z.enum(['start_application', 'submit_application', 'request_representative_mandate']), application_id: id })).optional(),
})
export type EntrySnapshot = z.infer<typeof entrySnapshotSchema>
export type EntryApplication = z.infer<typeof entryApplicationSchema>
export type EntryMandate = z.infer<typeof entryMandateSchema>
export const entryCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('start_application'), key: id, payload: z.object({ persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']), context_key: id.optional() }).strict() }).strict(),
  z.object({ command: z.literal('submit_application'), key: id, payload: z.object({ application_id: id, expected_revision: z.number().int().positive(), details: applicationDetailsSchema }).strict() }).strict(),
  z.object({ command: z.literal('request_representative_mandate'), key: id, payload: z.object({ application_id: id, expected_revision: z.number().int().min(0), evidence_reference: z.string().trim().min(20).max(400), requested_until: z.string().datetime({ offset: true }) }).strict() }).strict(),
])
export type EntryCommand = z.infer<typeof entryCommandSchema>

/** An absent selection is safe only when precisely one application exists. */
export function selectEntryApplication(snapshot: EntrySnapshot, applicationId: unknown): EntryApplication | null {
  if (applicationId === undefined) return snapshot.applications.length === 1 ? snapshot.applications[0] : null
  if (typeof applicationId !== 'string') return null
  return snapshot.applications.find(application => application.id === applicationId && application.user_id === snapshot.actor.id) ?? null
}
export function entryApplicationHref(applicationId: string): string {
  return `/portal/onboarding?mode=applicant&application=${encodeURIComponent(applicationId)}`
}
