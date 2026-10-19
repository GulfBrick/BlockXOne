import { z } from 'zod'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from './contracts'
import { validatedFundRoleplayAdmission } from './fund-roleplay-admission'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'

const id = z.string().uuid().refine(value => value !== '00000000-0000-0000-0000-000000000000')
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const common = z.object({
  version: z.literal(1), environment: z.literal('TESTNET'), execution_mode: z.literal('TEST_ROLE_PLAY'),
  independence_proven: z.literal(false), actor_id: id, session_id: id,
  policy_id: id, authority_epoch: revision, product_id: id, offering_revision_id: id,
  application_id: id, event_id: id, request: portalCommandSchema,
  recorded_at: z.string().datetime({ offset: true }),
}).strict()
const compliance = z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.literal('ComplianceOfficer') }).strict()
const holder = z.union([z.object({ mode: z.literal('APPLICANT') }).strict(),
  z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.literal('Investor') }).strict()])

/** Historical canonical results only. The session is the current protected
 * caller's session; recorded_at is immutable original decision/event time.
 * Neither result is current authority, provider clearance or a PortalSnapshot. */
export const admissionCommitSchema = common.extend({
  kind: z.literal('TEST_FUND_ADMISSION_COMMIT'), operating_context: compliance,
  decision_id: id, submitted_revision: revision, decision_revision: revision,
  decision: z.enum(['APPROVED', 'CHANGES_REQUIRED', 'REJECTED']),
}).strict().superRefine((value, context) => {
  if (value.request.command !== 'review_application') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['request', 'command'], message: 'An application review command is required.' }); return
  }
  if (!id.safeParse(value.request.key).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'key'], message: 'A nonzero request key is required.' })
  if (value.request.payload.application_id !== value.application_id) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['application_id'], message: 'The application does not match the original request.' })
  if (value.submitted_revision !== value.request.payload.expected_revision || value.submitted_revision >= Number.MAX_SAFE_INTEGER
    || value.decision_revision !== value.submitted_revision + 1) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['decision_revision'], message: 'The decision must follow the original submitted revision.' })
  if (value.decision !== value.request.payload.decision) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['decision'], message: 'The decision does not match the original request.' })
})

export const accountCommitSchema = common.extend({
  kind: z.literal('TEST_FUND_ACCOUNT_COMMIT'), operating_context: holder,
  account_id: id, application_revision: revision, admission_decision_id: id,
}).strict().superRefine((value, context) => {
  if (value.request.command !== 'create_investment_account') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['request', 'command'], message: 'An account creation command is required.' }); return
  }
  if (!id.safeParse(value.request.key).success) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['request', 'key'], message: 'A nonzero request key is required.' })
  if (value.request.payload.application_id !== value.application_id) context.addIssue({ code: z.ZodIssueCode.custom,
    path: ['application_id'], message: 'The account application does not match the original request.' })
})

export const admissionOrAccountCommitSchema = z.union([admissionCommitSchema, accountCommitSchema])
export type AdmissionOrAccountCommit = z.infer<typeof admissionOrAccountCommitSchema>

/** Authority remains native. Only the exact schema-normalised original request
 * in the current TEST actor/context may acknowledge a recorded result. */
export function matchesAdmissionCommit(value: unknown, expected: {
  actorId: string; context: PortalOperatingContext; request: PortalCommand; environment: PlatformEnvironment | undefined;
}): value is AdmissionOrAccountCommit {
  if (expected.environment !== 'TESTNET') return false
  const committed = admissionOrAccountCommitSchema.safeParse(value)
  const instruction = portalCommandSchema.safeParse(expected.request)
  return committed.success && instruction.success && committed.data.actor_id === expected.actorId
    && portalContextMatches(committed.data.operating_context, expected.context)
    && JSON.stringify(committed.data.request) === JSON.stringify(instruction.data)
}

/** A known commit is not a refreshed result. Require its visible canonical
 * application/admission tuple, original event and (for creation) actual account.
 * Decision IDs remain native references: the current application DTO does not
 * expose a decision-ID resolver. Missing/later history requires another read. */
export function admissionCommitSnapshotMatches(value: unknown, committed: unknown): boolean {
  const parsed = admissionOrAccountCommitSchema.safeParse(committed)
  if (!parsed.success || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const ack = parsed.data, snapshot = value as Partial<PortalSnapshot>
  if (snapshot.actor?.id !== ack.actor_id || !portalContextMatches(snapshot.operating_context, ack.operating_context)
    || snapshot.base_records_available === false || !Array.isArray(snapshot.applications) || !Array.isArray(snapshot.events)
    || !Array.isArray(snapshot.requests) || !snapshot.requests.some(receipt => receipt?.key === ack.request.key && receipt.command === ack.request.command)) return false
  const applications = snapshot.applications.filter(application => application?.id === ack.application_id)
  if (applications.length !== 1 || applications[0].user_id !== ack.actor_id) return false
  const application = applications[0], admission = validatedFundRoleplayAdmission(application, 'TESTNET')
  if (!admission || admission.policy_id !== ack.policy_id || admission.authority_epoch !== ack.authority_epoch
    || admission.product_id !== ack.product_id || admission.offering_revision_id !== ack.offering_revision_id) return false
  const events = snapshot.events.filter(event => event?.id === ack.event_id)
  if (events.length !== 1 || events[0].actor_id !== ack.actor_id || events[0].kind !== ack.request.command
    || !z.string().datetime({ offset: true }).safeParse(events[0].created_at).success) return false
  if (ack.kind === 'TEST_FUND_ADMISSION_COMMIT') {
    if (ack.request.command !== 'review_application') return false
    const checks = ack.request.payload.checks
    return events[0].subject_id === ack.application_id && admission.submitted_revision === ack.submitted_revision
      && admission.decision_revision === ack.decision_revision && admission.decision === ack.decision
      && admission.reviewer_id === ack.actor_id && admission.reviewed_at === ack.recorded_at
      && application.review_notes === ack.request.payload.notes && application.review_checks !== null
      && typeof application.review_checks === 'object' && !Array.isArray(application.review_checks)
      && Object.keys(application.review_checks).length === Object.keys(checks).length
      && Object.entries(checks).every(([name, checked]) => application.review_checks[name] === checked)
  }
  if (admission.decision !== 'APPROVED' || admission.decision_revision !== ack.application_revision || !Array.isArray(snapshot.accounts)) return false
  const accounts = snapshot.accounts.filter(account => account?.id === ack.account_id)
  return accounts.length === 1 && accounts[0].holder_user_id === ack.actor_id && accounts[0].application_id === ack.application_id
    && accounts[0].kind === 'INDIVIDUAL' && ['ACTIVE', 'SUSPENDED'].includes(accounts[0].status)
    && z.string().datetime({ offset: true }).safeParse(accounts[0].created_at).success
    && events[0].subject_id === ack.account_id && events[0].created_at === ack.recorded_at
}
