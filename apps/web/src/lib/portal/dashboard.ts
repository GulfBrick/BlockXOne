import { BX1_ROLES, type Bx1Role, type Bx1Workspace } from '../supabase/contracts'
import type { PlatformEnvironment } from '../platform-release'
import type { PortalSnapshot } from './contracts'

export type DashboardScope = { organisationId: string; organisationName: string; role: Bx1Role }
export type DashboardQuery = Record<string, string | string[] | undefined>
export function dashboardScopes(workspace: Bx1Workspace): DashboardScope[] {
  return workspace.organisations.flatMap(org => BX1_ROLES.filter(role => org.roles.includes(role))
    .map(role => ({ organisationId: org.id, organisationName: org.name, role })))
}
/** Query parameters select an existing assignment; they never create one. */
export function selectDashboardScope(workspace: Bx1Workspace, query: DashboardQuery): DashboardScope | null {
  const scopes = dashboardScopes(workspace)
  if (query.organisation === undefined && query.role === undefined) return scopes[0] ?? null
  if (typeof query.organisation !== 'string' || typeof query.role !== 'string') return null
  return scopes.find(scope => scope.organisationId === query.organisation && scope.role === query.role) ?? null
}
export function dashboardScopeHref(scope: DashboardScope): string {
  return `/portal?organisation=${encodeURIComponent(scope.organisationId)}&role=${encodeURIComponent(scope.role)}`
}

export function dashboardProjection(scope: DashboardScope, environment: PlatformEnvironment, snapshot?: PortalSnapshot) {
  const paths = ['/workspace/security']
  if (scope.role === 'SuperAdmin') paths.push('/workspace/administration')
  const queue: { label: string; value: number; description: string }[] = []
  if (environment !== 'TESTNET') return { availablePaths: paths, queue, queueMessage: 'Live business services are not connected in this release. No balances or completed activity are inferred.' }
  if (!snapshot) return { availablePaths: paths, queue, queueMessage: 'Saved test-environment records could not be loaded. This is not a zero balance or an empty work queue.' }
  paths.push('/portal/onboarding')
  // The existing customer feature has product organisations distinct from
  // native access organisations. Never manufacture an ID mapping between them.
  const productOrganisations = snapshot.organisations.filter(org => org.status === 'ACTIVE' && org.native_organisation_id === scope.organisationId && org.authority_source === 'NATIVE_BINDING' && org.roles.includes(scope.role))
  if (scope.role === 'Investor') {
    paths.push('/portal/opportunities', '/portal/portfolio')
    const own = snapshot.subscriptions.filter(item => item.investor_id === snapshot.actor.id)
    queue.push({ label: 'My subscriptions awaiting funding reconciliation', value: own.filter(item => item.status === 'AWAITING_FUNDING' && !snapshot.funding?.obligations.some(obligation => obligation.subscription_id === item.id && obligation.state === 'RECONCILED')).length, description: 'Your personal customer account across product issuers, not this access organisation. Requests and reconciled token payments are not issued holdings.' })
  }
  if (productOrganisations.length && ['TreasuryOperator', 'FinancialController'].includes(scope.role)) {
    if (!snapshot.funding) return { availablePaths: paths, queue, queueMessage: 'Funding records could not be loaded. No payment totals or empty queues are inferred.' }
    const funding = snapshot.funding.obligations.filter(item => productOrganisations.some(org => org.id === item.organisation_id))
    queue.push({ label: 'Funding instructions to review', value: funding.filter(item => item.state !== 'RECONCILED' && item.state !== 'CANCELLED').length, description: 'Scoped test-token funding and reconciliation. Not bank cash, issued units or token holdings.' })
  }
  if (productOrganisations.length && ['OfferingManager', 'IssuerFundManager'].includes(scope.role)) {
    paths.push('/portal/products', '/portal/products/new')
    const products = snapshot.products.filter(item => productOrganisations.some(org => org.id === item.organisation_id))
    queue.push({ label: 'Draft products', value: products.filter(item => item.status === 'DRAFT' || item.status === 'CHANGES_REQUIRED').length, description: 'Products explicitly bound to this organisation and acting role.' },
      { label: 'Products in review', value: products.filter(item => item.status === 'IN_REVIEW').length, description: 'Submitted versions awaiting independent review.' })
  }
  // Exact existing TEST adapter scope used by bx1_portal_read; not a new grant.
  if (scope.role === 'ComplianceOfficer' && snapshot.operating_context?.mode === 'ROLE' && snapshot.operating_context.organisationId === scope.organisationId && snapshot.operating_context.role === scope.role && snapshot.actor.can_review) {
    paths.push('/portal/compliance')
    queue.push({ label: 'Visible products awaiting review', value: snapshot.products.filter(item => item.status === 'IN_REVIEW').length, description: 'Your backend-authorised test review queue. Current evidence review is manual, not provider-backed KYC.' })
  }
  return { availablePaths: paths, queue, queueMessage: queue.length ? undefined : 'No connected operational queue exists for this role yet. Responsibilities below describe the intended workflow, not completed transactions.' }
}
