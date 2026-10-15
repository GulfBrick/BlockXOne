import { z } from 'zod'
import type { PortalProductEligibility, PortalSnapshot } from './contracts'
import { portalContextMatches, portalOperatingContextSchema } from './operating-context'

const id = z.string().uuid()
export const fundRoleplayEligibilitySchema = z.object({
  version: z.literal(1), environment: z.literal('TESTNET'), assurance: z.literal('TEST_ROLE_PLAY'),
  independence_proven: z.literal(false), actor_id: id, operating_context: portalOperatingContextSchema,
  operator_user_id: id, policy_id: id, authority_epoch: z.number().int().positive(),
  product_id: id, offering_revision_id: id, case_id: id, case_revision: z.number().int().positive(),
  expires_at: z.string().datetime({ offset: true }), binding_current: z.boolean(),
  review_allowed: z.boolean(), revoke_allowed: z.boolean(),
  label: z.literal('TEST role-play: one operator, not independent human approval'),
}).strict()

/** Presentation only. Canonical SQL commands repeat all admission and authority checks. */
export function validatedFundRoleplayEligibility(eligibility: PortalProductEligibility, snapshot: PortalSnapshot) {
  const parsed = fundRoleplayEligibilitySchema.safeParse(eligibility.roleplay)
  if (!parsed.success || !snapshot.operating_context) return null
  const value = parsed.data
  const environment = snapshot.fund_lifecycle?.environment ?? snapshot.stage2_access?.environment
  if (environment !== 'TESTNET' || value.actor_id !== snapshot.actor.id
    || value.operator_user_id !== eligibility.holder_user_id || value.operator_user_id !== snapshot.actor.id
    || value.operating_context.mode !== 'ROLE' || value.operating_context.role !== 'ComplianceOfficer'
    || !portalContextMatches(value.operating_context, snapshot.operating_context)
    || value.case_id !== eligibility.id || value.case_revision !== eligibility.revision
    || value.product_id !== eligibility.product_id || value.offering_revision_id !== eligibility.offering_revision_id) return null
  const current = value.binding_current && Date.parse(value.expires_at) > Date.now()
  return { ...value, review_allowed: current && value.review_allowed, revoke_allowed: current && value.revoke_allowed }
}
