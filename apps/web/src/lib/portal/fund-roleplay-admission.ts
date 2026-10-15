import { z } from 'zod'
import type { PlatformEnvironment } from '@/lib/platform-release'
import type { PortalApplication, PortalSnapshot } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { validatedStage2Access } from './stage2-access'

const id = z.string().uuid().refine(value => value !== '00000000-0000-0000-0000-000000000000')
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const provenance = {
  version: z.literal(1), environment: z.literal('TESTNET'), execution_mode: z.literal('TEST_ROLE_PLAY'), independence_proven: z.literal(false),
  policy_id: id, authority_epoch: revision, product_id: id, offering_revision_id: id, application_id: id,
  valid_until: z.string().datetime({ offset: true }),
}
export const fundRoleplayApplicationReviewSchema = z.object({
  ...provenance, actor_id: id,
  operating_context: z.object({ mode: z.literal('ROLE'), organisationId: id, role: z.literal('ComplianceOfficer') }).strict(),
  application_revision: revision, command: z.literal('review_application'), can_review: z.literal(true),
}).strict()
export type FundRoleplayApplicationReview = z.infer<typeof fundRoleplayApplicationReviewSchema>

/** Historical evidence only: it cannot authorise another decision or product. */
export const fundRoleplayAdmissionSchema = z.object({
  ...provenance, submitted_revision: revision, decision_revision: revision,
  decision: z.enum(['APPROVED', 'CHANGES_REQUIRED', 'REJECTED']), reviewer_id: id,
  reviewed_at: z.string().datetime({ offset: true }),
}).strict().refine(value => value.decision_revision === value.submitted_revision + 1, 'The decision must follow its submitted revision.')
export type FundRoleplayAdmission = z.infer<typeof fundRoleplayAdmissionSchema>

function testIndividual(application: PortalApplication) {
  return application.persona === 'INVESTOR' && application.provider_mode === 'MANUAL_TEST_REVIEW'
    && application.admission_purpose === 'INVESTOR_ADMISSION' && application.details?.test_data_acknowledged === true
    && 'investor_type' in application.details && application.details.investor_type === 'INDIVIDUAL'
}
function boundReview(snapshot: PortalSnapshot, application: PortalApplication, context: PortalOperatingContext | undefined,
  environment: PlatformEnvironment | undefined): FundRoleplayApplicationReview | null {
  const rows = snapshot.applications.filter(item => item?.id === application.id)
  if (rows.length !== 1 || rows[0].revision !== application.revision || rows[0].user_id !== application.user_id
    || rows[0].persona !== application.persona || rows[0].status !== application.status) return null
  const saved = rows[0]
  const parsed = fundRoleplayApplicationReviewSchema.safeParse(saved.test_roleplay_review)
  const access = validatedStage2Access(snapshot, context, environment)
  if (!parsed.success || environment !== 'TESTNET' || !context || context.mode !== 'ROLE' || context.role !== 'ComplianceOfficer'
    || access?.session_mode !== 'STANDARD' || !access.allowed_commands.includes('review_application')
    || !portalContextMatches(snapshot.operating_context, context) || !portalContextMatches(parsed.data.operating_context, context)
    || parsed.data.actor_id !== snapshot.actor.id || saved.user_id !== snapshot.actor.id || !testIndividual(saved)
    || saved.status !== 'SUBMITTED' || parsed.data.application_id !== saved.id
    || parsed.data.application_revision !== saved.revision) return null
  return parsed.data
}
/** Presentation only. Current native policy, session/MFA, evidence and transition
 * checks remain in the existing review_application writer. */
export function validatedFundRoleplayApplicationReview(snapshot: PortalSnapshot, application: PortalApplication,
  context: PortalOperatingContext | undefined, environment: PlatformEnvironment | undefined): FundRoleplayApplicationReview | null {
  const value = boundReview(snapshot, application, context, environment)
  return value && snapshot.actor.can_review && Date.parse(value.valid_until) > Date.now() ? value : null
}
export function validatedFundRoleplayAdmission(application: PortalApplication, environment: PlatformEnvironment | undefined): FundRoleplayAdmission | null {
  const parsed = fundRoleplayAdmissionSchema.safeParse(application.test_roleplay_admission)
  if (!parsed.success || environment !== 'TESTNET' || !testIndividual(application) || parsed.data.application_id !== application.id
    || parsed.data.decision_revision !== application.revision || parsed.data.decision !== application.status
    || parsed.data.reviewer_id !== application.reviewer_id || parsed.data.reviewer_id !== application.user_id
    || parsed.data.reviewed_at !== application.reviewed_at) return null
  // Expiry does not erase historical provenance. It is not current authority.
  return parsed.data
}
/** Optional markers are additive; ordinary rows retain the existing contract.
 * An expired, correctly bound capability may be read but never acted upon. */
export function fundRoleplayAdmissionProjectionValid(snapshot: PortalSnapshot, environment: PlatformEnvironment | undefined): boolean {
  if (!Array.isArray(snapshot.applications)) return false
  return snapshot.applications.every(application => {
    if (!application || typeof application !== 'object') return false
    if (application.test_roleplay_review === undefined && application.test_roleplay_admission === undefined) return true
    if (snapshot.applications.filter(item => item?.id === application.id).length !== 1) return false
    return (application.test_roleplay_review === undefined || boundReview(snapshot, application, snapshot.operating_context, environment) !== null)
      && (application.test_roleplay_admission === undefined || validatedFundRoleplayAdmission(application, environment) !== null)
  })
}
