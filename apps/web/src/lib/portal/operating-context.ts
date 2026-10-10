import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { PortalPath, PortalSnapshot } from './contracts'
import { isTestPasswordAdmission, hasStage2CommandAccess, validatedStage2Access } from './stage2-access'

export const portalOperatingContextSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ROLE'), organisationId: z.string().uuid(), role: z.enum(BX1_ROLES) }).strict(),
  z.object({ mode: z.literal('APPLICANT') }).strict(),
])
export type PortalOperatingContext = z.infer<typeof portalOperatingContextSchema>
export const APPLICANT_CONTEXT: PortalOperatingContext = { mode: 'APPLICANT' }

/** Context selects existing authority. Neither a URL nor this value grants it. */
export function portalScopeHref(path: PortalPath | string, context?: PortalOperatingContext, id?: string): string {
  if (path !== '/portal' && !path.startsWith('/portal/') && !path.startsWith('/portal?') && !path.startsWith('/api/portal/documents')) return path
  const [base, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.delete('organisation'); params.delete('role'); params.delete('mode')
  if (context?.mode === 'ROLE') { params.set('organisation', context.organisationId); params.set('role', context.role) }
  if (context?.mode === 'APPLICANT') params.set('mode', 'applicant')
  if (id !== undefined) params.set('id', id)
  return params.size ? `${base}?${params}` : base
}
export function portalContextKey(context: PortalOperatingContext): string {
  return context.mode === 'APPLICANT' ? 'applicant' : `${context.organisationId}:${context.role}`
}
export function portalContextMatches(actual: unknown, expected: PortalOperatingContext): boolean {
  const parsed = portalOperatingContextSchema.safeParse(actual)
  return parsed.success && portalContextKey(parsed.data) === portalContextKey(expected)
}
// These are existing wire fields, including on organisation mandates whose
// compatibility TypeScript shape does not enumerate them. Never invent a receipt.
const appliedHandoffProofSchema = z.object({
  approval_receipt_id: z.string().uuid(), applied_at: z.string().datetime({ offset: true }),
})
/** Open one approved apply handoff or its own applied result, never a review queue. */
function superAdminApplyDetailAllowed(context: PortalOperatingContext, snapshot: PortalSnapshot, id?: string): boolean {
  if (context.mode !== 'ROLE' || context.role !== 'SuperAdmin' || !id
    || !portalContextMatches(snapshot.operating_context, context)) return false
  const matches = [
    ...(Array.isArray(snapshot.organisation_mandates) ? snapshot.organisation_mandates : []),
    ...(Array.isArray(snapshot.investing_representative_mandates) ? snapshot.investing_representative_mandates : []),
    ...(Array.isArray(snapshot.product_appointments) ? snapshot.product_appointments : []),
  ].filter(item => item?.id === id)
  if (matches.length !== 1) return false
  const item = matches[0]
  if (item.reviewer_scope_organisation_id !== context.organisationId || item.can_review !== false
    || !Number.isInteger(item.revision) || item.revision < 1) return false
  const applied = item.status === 'APPLIED'
  if (applied) {
    const proof = appliedHandoffProofSchema.safeParse(item)
    if (item.can_apply !== false || item.applied_by_user_id !== snapshot.actor.id || !proof.success
      || Date.parse(proof.data.applied_at) > Date.now()) return false
  } else if (item.status !== 'APPROVED' || item.can_apply !== true || item.can_revoke !== false
    || item.next_owner !== 'SUPER_ADMIN' || !Number.isFinite(Date.parse(item.requested_until))
    || Date.parse(item.requested_until) <= Date.now()) return false
  const independent = (person: string | null) => typeof person === 'string' && person.length > 0 && person !== snapshot.actor.id
  if ('appointee_user_id' in item) return ['IssuerFundManager', 'ComplianceOfficer'].includes(item.role)
    && independent(item.appointee_user_id) && independent(item.requested_by_user_id) && independent(item.reviewed_by_user_id)
    && Boolean(item.approval_receipt_id)
  const currentAdmission = applied || item.admission_approved_until !== null
    && Number.isFinite(Date.parse(item.admission_approved_until)) && Date.parse(item.admission_approved_until) > Date.now()
  if ('representative_user_id' in item) return snapshot.entity_mandate_queue_available === true
    && !snapshot.entity_mandate_queue_blocked_reason && currentAdmission
    && (applied || item.admission_revision === item.admission_current_revision) && item.transaction_limit_minor === '0'
    && independent(item.applicant_user_id) && independent(item.representative_user_id) && independent(item.reviewer_user_id)
    && Boolean(item.approval_receipt_id)
  return snapshot.mandate_queue_available === true && !snapshot.mandate_queue_blocked_reason && currentAdmission
    && item.role === 'OfferingManager' && (applied || item.admission_status === 'APPROVED')
    && item.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION'
    && (!applied || z.string().uuid().safeParse(item.native_organisation_id).success)
    && independent(item.applicant_user_id) && independent(item.reviewer_user_id)
}
export function portalViewAllowed(view: PortalPath, context: PortalOperatingContext, snapshot: PortalSnapshot, id?: string): boolean {
  if ('rehearsal' in snapshot) {
    return false
  }
  if (snapshot.stage2_access !== undefined && !validatedStage2Access(snapshot, context)) return false
  if (isTestPasswordAdmission(snapshot)) {
    if (view === '/portal' || view === '/portal/onboarding') return true
    if (view === '/portal/portfolio') return context.mode === 'APPLICANT'
    if (view === '/portal/compliance' || view === '/portal/compliance/detail') {
      if (context.mode !== 'ROLE') return false
      return context.role === 'ComplianceOfficer' && snapshot.actor.can_review
        && hasStage2CommandAccess(snapshot, 'review_application', context)
        || view === '/portal/compliance/detail' && superAdminApplyDetailAllowed(context, snapshot, id)
    }
    return false
  }
  if (view === '/portal' || view === '/portal/onboarding') return true
  if (view.startsWith('/portal/compliance')) return context.mode === 'ROLE' && context.role === 'ComplianceOfficer' && snapshot.actor.can_review
    || view === '/portal/compliance/detail' && superAdminApplyDetailAllowed(context, snapshot, id)
  if (view === '/portal/orders/detail') {
    if (context.mode === 'APPLICANT' || context.role === 'Investor') return true
    return ['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role)
      && snapshot.organisations.some(org => org.status === 'ACTIVE' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))
  }
  if (view.startsWith('/portal/products')) {
    if (context.mode === 'ROLE' && !['OfferingManager', 'IssuerFundManager'].includes(context.role)) return false
    return snapshot.organisations.some(org => org.status === 'ACTIVE' && (context.mode === 'APPLICANT'
      ? org.authority_source === 'LEGACY_OWNER'
      : org.native_organisation_id === context.organisationId && org.roles.includes(context.role)))
  }
  return (context.mode === 'APPLICANT' || context.role === 'Investor') && (view.startsWith('/portal/opportunities') || view === '/portal/portfolio')
}
