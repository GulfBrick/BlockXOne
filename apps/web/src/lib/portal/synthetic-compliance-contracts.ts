import { z } from 'zod'
import { applicationDetailsSchema, type PortalSnapshot } from './contracts'
import type { PortalOperatingContext } from './operating-context'

const id = z.string().uuid()
const date = z.string().datetime({ offset: true })
const reviewContext = z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.literal('ComplianceOfficer') }).strict()
const application = z.object({
  id, user_id: id, persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']),
  status: z.enum(['SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED']), revision: z.number().int().positive(),
  details: applicationDetailsSchema, submitted_at: date, reviewed_at: date.nullable(),
  reviewer_id: id.nullable(), review_notes: z.string().nullable(), organisation_id: id.nullable(),
  review_checks: z.record(z.string(), z.boolean()), provider_mode: z.literal('MANUAL_TEST_REVIEW'), approved_until: date.nullable(),
  admission_purpose: z.enum(['INVESTOR_ADMISSION', 'CUSTOMER_ORGANISATION_ADMISSION']),
}).strict()
const schema = z.object({
  rehearsal: z.object({ version: z.literal(1), environment: z.literal('TESTNET'), mode: z.literal('SYNTHETIC_COMPLIANCE'), actor_id: id, operating_context: reviewContext }).strict(),
  actor: z.object({ id, email: z.string().email(), display_name: z.string().nullable(), can_review: z.literal(true) }).strict(),
  operating_context: reviewContext,
  applications: z.array(application).max(100), organisations: z.array(z.never()).max(0), products: z.array(z.never()).max(0), subscriptions: z.array(z.never()).max(0),
  events: z.array(z.object({ id, subject_id: id, kind: z.enum(['submit_application', 'review_application']), actor_id: id, created_at: date, summary: z.string() }).strict()).max(1000),
  requests: z.array(z.object({ key: id, command: z.literal('review_application') }).strict()).max(1000),
}).strict()

/** A distinct, restricted envelope, never an enriched ordinary/full portal read. */
export function parseSyntheticComplianceSnapshot(value: unknown, actorId: string, context: PortalOperatingContext): PortalSnapshot | null {
  if (context.mode !== 'ROLE' || context.role !== 'ComplianceOfficer') return null
  const parsed = schema.safeParse(value)
  if (!parsed.success) return null
  const snapshot = parsed.data
  if (snapshot.actor.id !== actorId || snapshot.rehearsal.actor_id !== actorId
    || snapshot.operating_context.organisationId !== context.organisationId || snapshot.rehearsal.operating_context.organisationId !== context.organisationId) return null
  const cases = new Map(snapshot.applications.map(item => [item.id, item]))
  if (cases.size !== snapshot.applications.length || snapshot.applications.some(item => item.user_id === actorId
    || item.admission_purpose !== (item.persona === 'INVESTOR' ? 'INVESTOR_ADMISSION' : 'CUSTOMER_ORGANISATION_ADMISSION')
    || (item.status === 'SUBMITTED' ? item.reviewed_at !== null || item.reviewer_id !== null || item.review_notes !== null || item.approved_until !== null
      : item.reviewed_at === null || item.reviewer_id !== actorId || !item.review_notes || item.review_notes.trim().length < 20)
    || (item.status === 'APPROVED' ? !item.approved_until || Date.parse(item.approved_until) <= Date.parse(item.reviewed_at!)
      || !['identity', 'ownership', 'screening', 'suitability'].every(key => item.review_checks[key] === true)
      || item.persona === 'WEALTH_MANAGER' && item.organisation_id === null : item.approved_until !== null))
    || snapshot.events.some(event => !cases.has(event.subject_id)
      || (event.kind === 'submit_application' ? event.actor_id !== cases.get(event.subject_id)!.user_id : event.actor_id !== actorId))) return null
  return snapshot
}
