import { z } from 'zod'
import { portalContextMatches, portalOperatingContextSchema, APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import type { EntryApplication, EntrySnapshot } from './entry-contracts'

const id = z.string().uuid()
export const customerHandoffStates = ['PREPARE_APPLICATION', 'REVIEW_PENDING', 'INFORMATION_REQUIRED', 'REAPPLICATION_REQUIRED', 'OPEN_ACCOUNT', 'ACCOUNT_AVAILABLE', 'REQUEST_MANDATE', 'MANDATE_REVIEW_PENDING', 'MANDATE_INFORMATION_REQUIRED', 'MANDATE_APPLY_PENDING', 'WORKSPACE_AVAILABLE', 'UNAVAILABLE'] as const
export const customerHandoffActions = ['PREPARE_APPLICATION', 'SUBMIT_APPLICATION', 'OPEN_INVESTMENT_ACCOUNT', 'VIEW_INVESTMENT_ACCOUNT', 'REQUEST_INVESTING_REPRESENTATIVE_MANDATE', 'REQUEST_REPRESENTATIVE_MANDATE', 'ENTER_OPERATING_WORKSPACE'] as const
export const customerHandoffBlockers = ['NONE', 'INTAKE_NOT_ADMITTED', 'REVIEWER_UNAVAILABLE', 'PROVIDER_UNSUPPORTED', 'ADMISSION_EXPIRED', 'MONITORING_ON_HOLD', 'MONITORING_RENEWAL_REQUIRED', 'ACCOUNT_SUSPENDED', 'MANDATE_NOT_EFFECTIVE', 'CONTEXT_UNAVAILABLE', 'CONTEXT_NOT_SUPPORTED', 'ADMISSION_NOT_APPROVED'] as const
export const customerWorkflowSchema = z.object({
  version: z.literal(1), environment: z.enum(['TESTNET', 'MAINNET']), actor_id: id,
  scoped_read_available: z.boolean(),
}).strict().refine(value => value.environment !== 'MAINNET' || !value.scoped_read_available, 'MAIN business reads are not admitted')
export const customerHandoffSchema = z.object({
  version: z.literal(1), environment: z.enum(['TESTNET', 'MAINNET']), actor_id: id,
  application_id: id, application_revision: z.number().int().positive(), persona: z.enum(['INVESTOR', 'WEALTH_MANAGER']),
  operating_context: portalOperatingContextSchema,
  state: z.enum(customerHandoffStates), next_owner: z.enum(['APPLICANT', 'COMPLIANCE', 'SUPER_ADMIN', 'PROVIDER_OWNER', 'NONE']),
  blocker: z.enum(customerHandoffBlockers), allowed_actions: z.array(z.enum(customerHandoffActions)),
  gates: z.object({ intake_admitted: z.boolean(), reviewer_available: z.boolean(), monitoring_allows_new_actions: z.boolean() }).strict(),
  accounts: z.array(z.object({ id, kind: z.enum(['INDIVIDUAL', 'ENTITY']), status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict()),
  mandate: z.object({ id, status: z.enum(['SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED', 'APPLIED', 'REVOKED']), effective: z.boolean() }).strict().nullable(),
  native_context: z.object({ organisation_id: id, role: z.literal('OfferingManager') }).strict().nullable(),
  destination: z.enum(['NONE', 'INVESTMENT_ACCOUNT', 'OPERATING_WORKSPACE']),
}).strict()
export type CustomerHandoff = z.infer<typeof customerHandoffSchema>
export type CustomerHandoffAction = typeof customerHandoffActions[number]

/** A read projection describes the next queue; it never supplies command authority. */
export function validatedCustomerHandoff(snapshot: EntrySnapshot, application: EntryApplication, environment: 'TESTNET' | 'MAINNET', operatingContext: PortalOperatingContext = APPLICANT_CONTEXT): CustomerHandoff | null {
  const workflow = customerWorkflowSchema.safeParse(snapshot.workflow)
  const parsed = customerHandoffSchema.safeParse(application.handoff)
  if (!workflow.success || !parsed.success || workflow.data.environment !== environment || workflow.data.actor_id !== snapshot.actor.id) return null
  const handoff = parsed.data
  if (handoff.environment !== environment || handoff.actor_id !== snapshot.actor.id || application.user_id !== snapshot.actor.id
    || handoff.application_id !== application.id || handoff.application_revision !== application.revision || handoff.persona !== application.persona
    || !portalContextMatches(handoff.operating_context, operatingContext)) return null
  if (new Set(handoff.allowed_actions).size !== handoff.allowed_actions.length) return null
  // Narrow malformed or stale affordances. The guarded command independently
  // rechecks live admission, expiry, monitoring, scope, revision and audit.
  const preparing = ['PREPARE_APPLICATION', 'INFORMATION_REQUIRED', 'REAPPLICATION_REQUIRED'].includes(handoff.state)
  if (handoff.allowed_actions.includes('PREPARE_APPLICATION') && (!preparing || !['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(application.status))) return null
  if (handoff.allowed_actions.includes('SUBMIT_APPLICATION') && (!preparing || !handoff.gates.intake_admitted || !handoff.gates.reviewer_available || handoff.blocker !== 'NONE')) return null
  if (handoff.allowed_actions.includes('SUBMIT_APPLICATION') && !handoff.allowed_actions.includes('PREPARE_APPLICATION')) return null
  if (handoff.allowed_actions.includes('PREPARE_APPLICATION') && (!handoff.gates.intake_admitted || !['NONE', 'REVIEWER_UNAVAILABLE'].includes(handoff.blocker))) return null
  const approvalActions = handoff.allowed_actions.some(action => !['PREPARE_APPLICATION', 'SUBMIT_APPLICATION'].includes(action))
  if (approvalActions && (!workflow.data.scoped_read_available || application.status !== 'APPROVED' || application.provider_mode !== 'MANUAL_TEST_REVIEW' || !handoff.gates.intake_admitted || !handoff.gates.monitoring_allows_new_actions || handoff.blocker !== 'NONE'
    || !application.approved_until || Date.parse(application.approved_until) <= Date.now() || !Number.isFinite(Date.parse(application.approved_until)))) return null
  if (environment === 'MAINNET' && (handoff.allowed_actions.length > 0 || handoff.gates.intake_admitted)) return null
  const linkedMandate = handoff.mandate
  if (application.persona === 'WEALTH_MANAGER' && linkedMandate && !snapshot.organisation_mandates?.some(mandate => mandate.id === linkedMandate.id
    && mandate.application_id === application.id && mandate.applicant_user_id === snapshot.actor.id
    && mandate.status === linkedMandate.status && mandate.effective === linkedMandate.effective)) return null
  if (handoff.allowed_actions.includes('OPEN_INVESTMENT_ACCOUNT') && (handoff.state !== 'OPEN_ACCOUNT' || application.persona !== 'INVESTOR' || handoff.destination !== 'INVESTMENT_ACCOUNT')) return null
  if (handoff.allowed_actions.includes('VIEW_INVESTMENT_ACCOUNT') && (handoff.state !== 'ACCOUNT_AVAILABLE' || application.persona !== 'INVESTOR' || handoff.destination !== 'INVESTMENT_ACCOUNT')) return null
  if (handoff.allowed_actions.includes('REQUEST_INVESTING_REPRESENTATIVE_MANDATE') && (handoff.state !== 'REQUEST_MANDATE' || application.persona !== 'INVESTOR' || handoff.destination !== 'INVESTMENT_ACCOUNT')) return null
  if (handoff.allowed_actions.includes('REQUEST_REPRESENTATIVE_MANDATE') && (application.persona !== 'WEALTH_MANAGER' || !['REQUEST_MANDATE', 'MANDATE_INFORMATION_REQUIRED'].includes(handoff.state))) return null
  if (handoff.allowed_actions.includes('ENTER_OPERATING_WORKSPACE') && handoff.state !== 'WORKSPACE_AVAILABLE') return null
  if (handoff.destination === 'INVESTMENT_ACCOUNT' && (!handoff.allowed_actions.some(action => ['OPEN_INVESTMENT_ACCOUNT', 'VIEW_INVESTMENT_ACCOUNT', 'REQUEST_INVESTING_REPRESENTATIVE_MANDATE'].includes(action)) || application.persona !== 'INVESTOR')) return null
  if (handoff.allowed_actions.includes('REQUEST_INVESTING_REPRESENTATIVE_MANDATE') && !handoff.accounts.some(account => account.kind === 'ENTITY' && account.status === 'ACTIVE')) return null
  if (handoff.allowed_actions.includes('VIEW_INVESTMENT_ACCOUNT') && !handoff.accounts.some(account => account.status === 'ACTIVE')) return null
  if (handoff.allowed_actions.includes('OPEN_INVESTMENT_ACCOUNT') && handoff.accounts.length > 0) return null
  if (handoff.destination === 'OPERATING_WORKSPACE' && (!handoff.allowed_actions.includes('ENTER_OPERATING_WORKSPACE') || application.persona !== 'WEALTH_MANAGER'
    || handoff.mandate?.status !== 'APPLIED' || !handoff.mandate.effective || !handoff.native_context
    || !snapshot.contexts.some(context => context.organisation_id === handoff.native_context?.organisation_id && context.roles.includes('OfferingManager')))) return null
  if (handoff.allowed_actions.includes('ENTER_OPERATING_WORKSPACE') && handoff.destination !== 'OPERATING_WORKSPACE') return null
  return handoff
}

export function customerHandoffHasAction(handoff: CustomerHandoff | null, action: CustomerHandoffAction): boolean {
  return handoff?.allowed_actions.includes(action) ?? false
}
export function customerHandoffHref(handoff: CustomerHandoff | null): string | null {
  if (handoff?.destination === 'INVESTMENT_ACCOUNT') return '/portal/portfolio?mode=applicant'
  if (handoff?.destination === 'OPERATING_WORKSPACE' && handoff.native_context) return `/portal?organisation=${encodeURIComponent(handoff.native_context.organisation_id)}&role=OfferingManager`
  return null
}
export function customerScopedReadAvailable(snapshot: EntrySnapshot, environment: 'TESTNET' | 'MAINNET'): boolean {
  const result = customerWorkflowSchema.safeParse(snapshot.workflow)
  return result.success && result.data.actor_id === snapshot.actor.id && result.data.environment === environment && result.data.scoped_read_available
}
