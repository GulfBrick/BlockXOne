import { z } from 'zod'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { PortalPath, PortalProduct, PortalProductServiceAppointment, PortalSnapshot } from './contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { hasStage2CommandAccess, validatedStage2Access } from './stage2-access'
import { hasOfferingCommandAccess, isTestPasswordWorkflow, validatedOfferingAccess } from './offering-access'
import { validatedEvaluationAccess } from './evaluation-access'

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
/** Presentation of a current guarded TEST package, never command authority. */
function standardTestOfferingProduct(snapshot: PortalSnapshot, context: PortalOperatingContext, environment: PlatformEnvironment | undefined, productId: string) {
  if (environment !== 'TESTNET' || context.mode !== 'ROLE' || !portalContextMatches(snapshot.operating_context, context)
    || validatedOfferingAccess(snapshot, context, environment)?.session_mode !== 'STANDARD') return null
  const matches = snapshot.products.filter(product => product.id === productId)
  const product = matches.length === 1 ? matches[0] : undefined
  return product?.offering_package?.origin === 'SUBMITTED' && z.string().uuid().safeParse(product.offering_package.id).success
    && /^[0-9a-f]{64}$/.test(product.terms_hash) && product.offering_package.terms_hash === product.terms_hash ? product : null
}

export function testOfferingReviewAvailable(snapshot: PortalSnapshot, context: PortalOperatingContext, environment: PlatformEnvironment | undefined,
  product: PortalProduct, action: 'review_product' | 'review_offering_issuer'): boolean {
  const current = standardTestOfferingProduct(snapshot, context, environment, product.id)
  const pkg = current?.offering_package
  const role = action === 'review_product' ? 'ComplianceOfficer' : 'IssuerFundManager'
  if (!current || !pkg || context.mode !== 'ROLE' || context.role !== role || current.created_by !== snapshot.actor.id
    || current.revision !== product.revision || current.offering_package?.id !== product.offering_package?.id
    || current.terms_hash !== product.terms_hash || current.status !== 'IN_REVIEW'
    || !current.allowed_actions?.includes(action)
    || !validatedOfferingAccess(snapshot, context, environment)?.allowed_commands.includes(action)
    || (action === 'review_product' ? !snapshot.actor.can_review || pkg.can_review_compliance !== true
      : pkg.can_review_issuer !== true)) return false
  return snapshot.product_appointments?.some(appointment => appointment.product_id === current.id && appointment.role === role
    && appointment.appointee_user_id === snapshot.actor.id && appointment.reviewer_scope_organisation_id === context.organisationId
    && appointment.status === 'APPLIED' && appointment.effective === true && Boolean(appointment.approval_receipt_id)
    && appointment.terms_hash_at_request === current.terms_hash && Number.isFinite(Date.parse(appointment.requested_until))
    && Date.parse(appointment.requested_until) > Date.now()) === true
}

export function standardTestIssuerProductAvailable(snapshot: PortalSnapshot, context: PortalOperatingContext,
  environment: PlatformEnvironment | undefined, product: PortalProduct): boolean {
  const current = standardTestOfferingProduct(snapshot, context, environment, product.id)
  return Boolean(current && context.mode === 'ROLE' && context.role === 'IssuerFundManager'
    && current.revision === product.revision && current.terms_hash === product.terms_hash
    && current.offering_package?.id === product.offering_package?.id
    && snapshot.product_appointments?.some(appointment => appointment.product_id === current.id
      && appointment.appointee_user_id === snapshot.actor.id && appointment.role === 'IssuerFundManager'
      && appointment.reviewer_scope_organisation_id === context.organisationId && appointment.status === 'APPLIED'
      && appointment.effective === true && Boolean(appointment.approval_receipt_id)
      && appointment.terms_hash_at_request === current.terms_hash && Number.isFinite(Date.parse(appointment.requested_until))
      && Date.parse(appointment.requested_until) > Date.now()))
}

function testProductAppointmentApplyAvailable(snapshot: PortalSnapshot, context: PortalOperatingContext,
  environment: PlatformEnvironment | undefined, appointment: PortalProductServiceAppointment): boolean {
  const product = standardTestOfferingProduct(snapshot, context, environment, appointment.product_id)
  // The scoped Super Admin reader intentionally omits customer products and
  // organisations. Reuse its already server-validated lifecycle metadata, never
  // manufacture a Product or import the circular lifecycle/context validator.
  const lifecycle = snapshot.fund_lifecycle
  const matches = environment === 'TESTNET' && lifecycle?.schema_version === 1 && lifecycle.environment === environment
    && lifecycle.actor_id === snapshot.actor.id && lifecycle.availability === 'AVAILABLE'
    && portalContextMatches(lifecycle.operating_context, context) && Array.isArray(lifecycle.products)
    ? lifecycle.products.filter(item => item.product_id === appointment.product_id) : []
  const fund = matches.length === 1 ? matches[0] : undefined
  const lifecycleHandoff = !snapshot.products.length && !snapshot.organisations.length && fund
    && context.mode === 'ROLE' && fund.native_organisation_id === context.organisationId
    && fund.organisation_id === appointment.product_organisation_id
    && z.string().uuid().safeParse(fund.offering_revision_id).success
    && /^[0-9a-f]{64}$/.test(fund.terms_hash) && fund.terms_hash === appointment.terms_hash_at_request
    && Number.isInteger(fund.product_revision) && Number.isInteger(appointment.product_revision_at_request)
    && appointment.product_revision_at_request > 0 && fund.product_revision >= appointment.product_revision_at_request
  return Boolean(environment === 'TESTNET' && context.mode === 'ROLE' && context.role === 'SuperAdmin'
    && portalContextMatches(snapshot.operating_context, context)
    && validatedOfferingAccess(snapshot, context, environment)?.session_mode === 'STANDARD'
    && validatedOfferingAccess(snapshot, context, environment)?.allowed_commands.includes('apply_product_service_appointment')
    && (product && product.created_by === snapshot.actor.id && appointment.terms_hash_at_request === product.terms_hash || lifecycleHandoff)
    && appointment.appointee_user_id === snapshot.actor.id
    && appointment.requested_by_user_id === snapshot.actor.id && appointment.reviewed_by_user_id === snapshot.actor.id
    && appointment.reviewer_scope_organisation_id === context.organisationId
    && z.string().uuid().safeParse(appointment.approval_receipt_id).success
    && (appointment.status === 'APPROVED' && appointment.can_apply === true
      || appointment.status === 'APPLIED' && appointment.can_apply === false && appointment.applied_by_user_id === snapshot.actor.id))
}

/** Exact TEST TST row actions already emitted by the guarded finance reader. */
export function testFundFinanceActionAvailable(snapshot: PortalSnapshot | undefined, context: PortalOperatingContext,
  environment: PlatformEnvironment | undefined, kind: 'ROUTE' | 'REFERENCE' | 'REVERSAL', recordId: string,
  action: 'approve_funding_route' | 'reconcile_funding' | 'approve_funding_reversal'): boolean {
  if (!snapshot || environment !== 'TESTNET' || context.mode !== 'ROLE' || context.role !== 'FinancialController'
    || !portalContextMatches(snapshot.operating_context, context) || !hasFundOperatingProducts(snapshot, context, environment)
    || !snapshot.funding || action !== ({ ROUTE: 'approve_funding_route', REFERENCE: 'reconcile_funding', REVERSAL: 'approve_funding_reversal' } as const)[kind]) return false
  const funding = snapshot.funding
  const records = kind === 'ROUTE' ? funding.routes.filter(row => row.id === recordId)
    : kind === 'REFERENCE' ? funding.references.filter(row => row.id === recordId) : funding.reversals.filter(row => row.id === recordId)
  if (records.length !== 1 || !records[0].allowed_actions.includes(action)) return false
  const record = records[0]
  const obligation = 'obligation_id' in record ? funding.obligations.find(row => row.id === record.obligation_id) : undefined
  const routeId = obligation?.route_id ?? recordId
  const routes = funding.routes.filter(row => row.id === routeId)
  if (routes.length !== 1 || kind !== 'ROUTE' && (!obligation || obligation.currency !== 'TST' || obligation.token_decimals !== 6)) return false
  const route = routes[0], products = snapshot.products.filter(product => product.id === route.product_id)
  const product = products.length === 1 ? products[0] : undefined
  const fund = snapshot.fund_lifecycle?.products.find(item => item.product_id === route.product_id)
  return Boolean(route.currency === 'TST' && route.conversion_policy === 'TST_BASE_UNITS_V1' && route.chain_id === 80002 && route.token_decimals === 6
    && product?.terms.asset_type === 'FUND' && product.terms.currency === 'TST'
    && product.revision === route.product_revision && product.terms_hash === route.terms_hash
    && product.offering_package?.origin === 'SUBMITTED' && product.offering_package.terms_hash === product.terms_hash
    && fund?.availability === 'AVAILABLE' && fund.product_revision === product.revision && fund.terms_hash === product.terms_hash
    && fund.offering_revision_id === product.offering_package.id && fund.organisation_id === product.organisation_id
    && snapshot.organisations.some(org => org.id === product.organisation_id && org.id === route.organisation_id && org.status === 'ACTIVE'
      && org.authority_source === 'TEST_ROLE_PLAY' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role)))
}
/** Open one approved apply handoff or its own applied result, never a review queue. */
function superAdminApplyDetailAllowed(context: PortalOperatingContext, snapshot: PortalSnapshot, id?: string, environment?: PlatformEnvironment): boolean {
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
    && (independent(item.appointee_user_id) && independent(item.requested_by_user_id) && independent(item.reviewed_by_user_id)
      || testProductAppointmentApplyAvailable(snapshot, context, environment, item))
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
/** Backend-scoped appointments, not a manufactured customer/native ID binding. */
export function appointedIssuerProducts(snapshot: PortalSnapshot, context: PortalOperatingContext) {
  if (context.mode !== 'ROLE' || context.role !== 'IssuerFundManager'
    || !validatedOfferingAccess(snapshot, context)) return []
  return snapshot.products.filter(product => snapshot.product_appointments?.some(appointment =>
    appointment.product_id === product.id && appointment.appointee_user_id === snapshot.actor.id
    && appointment.role === 'IssuerFundManager' && appointment.status === 'APPLIED' && appointment.effective === true
    && Number.isFinite(Date.parse(appointment.requested_until)) && Date.parse(appointment.requested_until) > Date.now()))
}
/** A scoped operating queue is not product-creation or financial authority.
 * The server reader validates the complete lifecycle against its configured
 * environment; client callers additionally pass their validated release.
 * Keep this binding check here to avoid importing the lifecycle validator,
 * which depends on the operating-context schema itself.
 */
const fundOperatingRoles: readonly string[] = ['TokenisationAgent', 'TransferAgent', 'TreasuryOperator', 'FinancialController']
export function isFundOperatingContext(context: PortalOperatingContext): boolean {
  return context.mode === 'ROLE' && fundOperatingRoles.includes(context.role)
}
export function hasFundOperatingProducts(snapshot: PortalSnapshot, context: PortalOperatingContext, environment?: 'TESTNET' | 'MAINNET'): boolean {
  if (!isFundOperatingContext(context)
    || 'rehearsal' in snapshot || snapshot.evaluation_access !== undefined || isTestPasswordWorkflow(snapshot)
    || !portalContextMatches(snapshot.operating_context, context)) return false
  if (snapshot.stage2_access !== undefined && !validatedStage2Access(snapshot, context, environment)) return false
  if (snapshot.offering_access !== undefined && !validatedOfferingAccess(snapshot, context, environment)) return false
  const fund = snapshot.fund_lifecycle
  return fund?.schema_version === 1 && fund.actor_id === snapshot.actor.id
    && ['TESTNET', 'MAINNET'].includes(fund.environment) && (environment === undefined || fund.environment === environment)
    && portalContextMatches(fund.operating_context, context) && fund.availability === 'AVAILABLE' && Array.isArray(fund.products)
}
export function portalViewAllowed(view: PortalPath, context: PortalOperatingContext, snapshot: PortalSnapshot, id?: string, environment?: PlatformEnvironment): boolean {
  if ('rehearsal' in snapshot) {
    return false
  }
  if (snapshot.stage2_access !== undefined && !validatedStage2Access(snapshot, context)) return false
  if (snapshot.offering_access !== undefined && !validatedOfferingAccess(snapshot, context)) return false
  const fund = snapshot.fund_lifecycle
  if (fund?.schema_version === 1 && fund.actor_id === snapshot.actor.id && portalContextMatches(fund.operating_context, context)
    && fund.availability === 'AVAILABLE' && Array.isArray(fund.products)) {
    if (view === '/portal/products/detail' && context.mode === 'ROLE' && fund.products.some(product => product.product_id === id)) return true
    if (view === '/portal/orders/detail' && fund.products.some(product => Array.isArray(product.orders) && product.orders.some(order => order.subscription_id === id))) return true
    if (snapshot.base_records_available === false) {
      // Preserve the established customer detail/order paths above. A limited
      // base reader must not widen these four operational roles beyond their
      // scoped lifecycle queue or bypass evaluation/password restrictions.
      if (view === '/portal/products' && isFundOperatingContext(context)) return hasFundOperatingProducts(snapshot, context)
      return view === '/portal' || view === '/portal/products' && context.mode === 'ROLE'
        || view === '/portal/portfolio' && (context.mode === 'APPLICANT' || context.role === 'Investor')
    }
  }
  if (snapshot.evaluation_access !== undefined) {
    const evaluation = validatedEvaluationAccess(snapshot, context)
    if (!evaluation || !evaluation.allowed_views.some(path => path === view)) return false
    if (view === '/portal/products/detail') return snapshot.products.some(product => product.id === id && product.organisation_id === evaluation.product_organisation_id)
    if (view === '/portal/opportunities/detail') return snapshot.products.some(product => product.id === id && product.status === 'PUBLISHED')
    return true
  }
  if (view === '/portal/products' && hasFundOperatingProducts(snapshot, context)) return true
  if (environment === 'TESTNET' && context.mode === 'ROLE' && context.role === 'IssuerFundManager'
    && validatedOfferingAccess(snapshot, context, environment)?.session_mode === 'STANDARD'
    && portalContextMatches(snapshot.operating_context, context) && view.startsWith('/portal/products')) {
    const products = snapshot.products.filter(product => standardTestIssuerProductAvailable(snapshot, context, environment, product))
    return view === '/portal/products' ? products.length > 0 : view === '/portal/products/detail' && products.some(product => product.id === id)
  }
  if (isTestPasswordWorkflow(snapshot)) {
    if (view === '/portal' || view === '/portal/onboarding') return true
    if (view === '/portal/portfolio') return context.mode === 'APPLICANT'
    if (view === '/portal/compliance' || view === '/portal/compliance/detail') {
      if (context.mode !== 'ROLE') return false
      return context.role === 'ComplianceOfficer' && snapshot.actor.can_review
        && (hasStage2CommandAccess(snapshot, 'review_application', context)
          || hasOfferingCommandAccess(snapshot, 'review_product', context)
          || hasOfferingCommandAccess(snapshot, 'review_product_service_appointment', context))
        || view === '/portal/compliance/detail' && superAdminApplyDetailAllowed(context, snapshot, id, environment)
    }
    if (view.startsWith('/portal/products')) {
      if (context.mode !== 'ROLE' || !validatedOfferingAccess(snapshot, context)) return false
      if (context.role === 'IssuerFundManager') {
        const appointed = appointedIssuerProducts(snapshot, context)
        return view === '/portal/products' ? appointed.length === snapshot.products.length
          : view === '/portal/products/detail' && appointed.some(product => product.id === id)
      }
      if (context.role !== 'OfferingManager') return false
      const organisations = snapshot.organisations.filter(org => org.status === 'ACTIVE'
        && org.native_organisation_id === context.organisationId && org.authority_source === 'NATIVE_BINDING' && org.roles.includes('OfferingManager'))
      if (view === '/portal/products/new') return organisations.length > 0 && hasOfferingCommandAccess(snapshot, 'create_product', context)
      if (view === '/portal/products/detail') return snapshot.products.some(product => product.id === id && organisations.some(org => org.id === product.organisation_id))
      return view === '/portal/products' && organisations.length > 0
    }
    return false
  }
  if (view === '/portal' || view === '/portal/onboarding') return true
  if (view.startsWith('/portal/compliance')) return context.mode === 'ROLE' && context.role === 'ComplianceOfficer' && snapshot.actor.can_review
    || view === '/portal/compliance/detail' && superAdminApplyDetailAllowed(context, snapshot, id, environment)
  if (view === '/portal/orders/detail') {
    if (context.mode === 'APPLICANT' || context.role === 'Investor') return true
    return ['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'].includes(context.role)
      && snapshot.organisations.some(org => org.status === 'ACTIVE' && org.native_organisation_id === context.organisationId && org.roles.includes(context.role))
  }
  if (view.startsWith('/portal/products')) {
    if (view === '/portal/products/new' && context.mode === 'ROLE' && context.role !== 'OfferingManager') return false
    if (context.mode === 'ROLE' && !['OfferingManager', 'IssuerFundManager'].includes(context.role)) return false
    return snapshot.organisations.some(org => org.status === 'ACTIVE' && (context.mode === 'APPLICANT'
      ? org.authority_source === 'LEGACY_OWNER'
      : org.native_organisation_id === context.organisationId && org.roles.includes(context.role)))
  }
  return (context.mode === 'APPLICANT' || context.role === 'Investor') && (view.startsWith('/portal/opportunities') || view === '/portal/portfolio')
}
