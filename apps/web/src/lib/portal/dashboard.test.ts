import { describe, expect, it } from 'vitest'
import { BX1_ROLES, type Bx1Workspace } from '../supabase/contracts'
import type { PortalProduct, PortalProductServiceAppointment, PortalSnapshot, PortalSubscription } from './contracts'
import type { OfferingAccess } from './offering-access'
import { dashboardProjection, dashboardScopes, dashboardScopeHref, selectDashboardScope } from './dashboard'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const productOrganisation = '55555555-5555-4555-8555-555555555555'
const workspace: Bx1Workspace = { user: { id: 'actor', email: 'actor@example.invalid', platformUserId: 'person', displayName: null }, organisations: [{ id: organisation, name: 'Fund manager', roles: [...BX1_ROLES] }, { id: otherOrganisation, name: 'Property issuer', roles: ['Investor'] }] }
const snapshot: PortalSnapshot = { actor: { id: 'actor', email: 'actor@example.invalid', display_name: null, can_review: false }, organisations: [], applications: [], products: [], subscriptions: [], events: [] }

describe('normal sandbox package dashboard projection', () => {
  const packageActor = '11111111-1111-4111-8111-111111111111'
  const productId = '66666666-6666-4666-8666-666666666666'
  function packageData(role: OfferingAccess['operating_context']['role']): PortalSnapshot {
    const context = { mode: 'ROLE' as const, organisationId: organisation, role }
    const commands: Record<typeof role, OfferingAccess['allowed_commands']> = { OfferingManager: ['create_product', 'save_product'], IssuerFundManager: ['review_offering_issuer'],
      ComplianceOfficer: ['review_product'], SuperAdmin: ['apply_product_service_appointment'] }
    return { ...snapshot, actor: { ...snapshot.actor, id: packageActor, can_review: role === 'ComplianceOfficer' }, operating_context: context,
      offering_access: { version: 1, environment: 'TESTNET', actor_id: packageActor, operating_context: context, session_mode: 'TEST_PASSWORD', allowed_commands: commands[role] },
      organisations: [{ id: productOrganisation, name: 'Synthetic manager', status: 'ACTIVE', roles: [role], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
  }
  it('uses the manager queue and create action only in the exact returned context', () => {
    const data = packageData('OfferingManager'); const scope = { organisationId: organisation, organisationName: 'A', role: 'OfferingManager' as const }
    const result = dashboardProjection(scope, 'TESTNET', data)
    expect(result.availablePaths).toContain('/portal/products'); expect(result.availablePaths).toContain('/portal/products/new')
    expect(result.queue.map(item => item.label)).toEqual(['Draft products', 'Products in review'])
    expect(dashboardProjection({ ...scope, organisationId: otherOrganisation }, 'TESTNET', data).queue).toEqual([])
    expect(dashboardProjection(scope, 'TESTNET', { ...data, offering_access: { ...data.offering_access!, allowed_commands: ['save_product'] } }).availablePaths).not.toContain('/portal/products/new')
    expect(dashboardProjection(scope, 'MAINNET', data).queue).toEqual([])
  })
  it('retains issuer readback after review without an editor or fabricated organisation binding', () => {
    const data = packageData('IssuerFundManager'); data.organisations = []
    // Projection-only fixture; full typed terms and package UI are proved separately.
    data.products = [{ id: productId, organisation_id: productOrganisation, status: 'IN_REVIEW', allowed_actions: ['review_offering_issuer'],
      offering_package: { can_review_issuer: true } } as PortalProduct]
    data.product_appointments = [{ product_id: productId, appointee_user_id: packageActor, role: 'IssuerFundManager', status: 'APPLIED',
      effective: true, requested_until: '2099-01-01T00:00:00Z', reviewer_scope_organisation_id: otherOrganisation } as PortalProductServiceAppointment]
    const scope = { organisationId: organisation, organisationName: 'A', role: 'IssuerFundManager' as const }
    const result = dashboardProjection(scope, 'TESTNET', data)
    expect(result.availablePaths).toContain('/portal/products'); expect(result.availablePaths).not.toContain('/portal/products/new')
    expect(result.queue).toHaveLength(1); expect(result.queue[0].value).toBe(1)
    data.products[0].allowed_actions = []; data.products[0].offering_package!.can_review_issuer = false
    const terminal = dashboardProjection(scope, 'TESTNET', data)
    expect(terminal.availablePaths).toContain('/portal/products'); expect(terminal.queue[0].value).toBe(0)
    data.product_appointments[0].effective = false
    expect(dashboardProjection(scope, 'TESTNET', data).queue[0].value).toBe(0)
  })
  it('denies package queues for malformed actor/command/context markers', () => {
    const data = packageData('OfferingManager'); const scope = { organisationId: organisation, organisationName: 'A', role: 'OfferingManager' as const }
    for (const marker of [{ ...data.offering_access!, actor_id: otherOrganisation }, { ...data.offering_access!, allowed_commands: ['publish_product'] },
      { ...data.offering_access!, operating_context: { ...data.offering_access!.operating_context, organisationId: otherOrganisation } }]) {
      const result = dashboardProjection(scope, 'TESTNET', { ...data, offering_access: marker } as PortalSnapshot)
      expect(result.queue).toEqual([]); expect(result.availablePaths).not.toContain('/portal/products'); expect(result.availablePaths).not.toContain('/portal/products/new')
    }
  })
  it('opens Compliance review but never gives Super Admin a blanket package/review queue', () => {
    const reviewer = dashboardProjection({ organisationId: organisation, organisationName: 'A', role: 'ComplianceOfficer' }, 'TESTNET', packageData('ComplianceOfficer'))
    expect(reviewer.availablePaths).toContain('/portal/compliance'); expect(reviewer.availablePaths).not.toContain('/portal/products/new')
    const apply = dashboardProjection({ organisationId: organisation, organisationName: 'A', role: 'SuperAdmin' }, 'TESTNET', packageData('SuperAdmin'))
    expect(apply.availablePaths).not.toContain('/portal/compliance'); expect(apply.availablePaths).not.toContain('/portal/products'); expect(apply.queue).toEqual([])
  })
})

describe('role and organisation dashboard selection', () => {
  it.each(BX1_ROLES)('accepts only the actual %s assignment', role => {
    const scope = selectDashboardScope(workspace, { organisation, role })!
    expect(scope.role).toBe(role)
    const target = new URL(dashboardScopeHref(scope), 'https://example.invalid')
    expect(target.pathname).toBe('/portal')
    expect(target.searchParams.get('organisation')).toBe(organisation)
    expect(target.searchParams.get('role')).toBe(role)
  })
  it.each([{ organisation: otherOrganisation, role: 'SuperAdmin' }, { organisation: 'unknown', role: 'Investor' }, { organisation: [organisation], role: 'Investor' }, { organisation, role: ['Investor', 'SuperAdmin'] }, { role: 'SuperAdmin' }, { organisation, role: 'WealthManager' }])('denies invented or ambiguous scope %j', query => expect(selectDashboardScope(workspace, query)).toBeNull())
  it('does not combine roles across organisations', () => expect(dashboardScopes(workspace).filter(scope => scope.organisationId === otherOrganisation).map(scope => scope.role)).toEqual(['Investor']))
  it('offers no fallback for an unassigned user', () => expect(selectDashboardScope({ ...workspace, organisations: [] }, {})).toBeNull())
  it('requires a deliberate choice when multiple approved roles exist', () => expect(selectDashboardScope(workspace, {})).toBeNull())
  it('can continue the sole approved role without manufacturing another context', () => expect(selectDashboardScope({ ...workspace, organisations: [{ id: organisation, name: 'A', roles: ['OfferingManager'] }] }, {})?.role).toBe('OfferingManager'))
  it.each(BX1_ROLES)('does not infer connected MAINNET business services for %s', role => {
    const projection = dashboardProjection({ organisationId: organisation, organisationName: 'A', role }, 'MAINNET', snapshot)
    expect(projection.availablePaths.every(path => path.startsWith('/workspace/'))).toBe(true)
    expect(projection.queue).toEqual([])
  })
  it('distinguishes failed reads from actual empty records', () => {
    const scope = dashboardScopes(workspace)[0]
    expect(dashboardProjection(scope, 'TESTNET').queue).toEqual([])
    expect(dashboardProjection(scope, 'TESTNET').queueMessage).toContain('not a zero balance')
    expect(dashboardProjection(scope, 'TESTNET', snapshot).queue[0].value).toBe(0)
  })
  it('requires an explicit active native binding for product tools in ROLE context', () => {
    const scope = selectDashboardScope(workspace, { organisation, role: 'OfferingManager' })!
    const bound = { id: productOrganisation, name: 'A', status: 'ACTIVE', roles: ['OfferingManager'], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' as const }
    expect(dashboardProjection(scope, 'TESTNET', { ...snapshot, organisations: [bound] }).availablePaths).toContain('/portal/products')
    for (const denied of [
      { ...bound, native_organisation_id: otherOrganisation },
      { ...bound, authority_source: 'LEGACY_OWNER' as const },
      { ...bound, status: 'REVOKED' },
      { ...bound, status: 'SUSPENDED' },
      { ...bound, roles: ['Investor'] },
      { id: productOrganisation, name: 'A', status: 'ACTIVE', roles: ['OfferingManager'] },
    ]) expect(dashboardProjection(scope, 'TESTNET', { ...snapshot, organisations: [denied] }).availablePaths).not.toContain('/portal/products')
  })
  it('counts own subscriptions across issuers without equating issuer IDs to native access scope', () => {
    const own = { id: 'sub', investor_id: 'actor', organisation_id: productOrganisation, status: 'AWAITING_FUNDING' } as PortalSubscription
    const data = { ...snapshot, subscriptions: [own, { ...own, id: 'other', investor_id: 'another-person' }] }
    for (const selected of [organisation, otherOrganisation]) {
      const scope = selectDashboardScope(workspace, { organisation: selected, role: 'Investor' })!
      const projection = dashboardProjection(scope, 'TESTNET', data)
      expect(projection.queue[0].value).toBe(1)
      expect(projection.queue[0].description).toContain('not this access organisation')
    }
  })
  it('requires the exact returned ROLE context for a compliance queue', () => {
    const reviewer = { organisationId: organisation, organisationName: 'Review scope', role: 'ComplianceOfficer' as const }
    const data: PortalSnapshot = { ...snapshot, actor: { ...snapshot.actor, can_review: true }, operating_context: { mode: 'ROLE', organisationId: organisation, role: 'ComplianceOfficer' } }
    expect(dashboardProjection(reviewer, 'TESTNET', data).availablePaths).toContain('/portal/compliance')
    expect(dashboardProjection({ ...reviewer, organisationId: otherOrganisation }, 'TESTNET', data).availablePaths).not.toContain('/portal/compliance')
    expect(dashboardProjection(reviewer, 'TESTNET', { ...data, operating_context: { mode: 'APPLICANT' } }).availablePaths).not.toContain('/portal/compliance')
    expect(dashboardProjection(reviewer, 'TESTNET', { ...data, operating_context: { mode: 'ROLE', organisationId: organisation, role: 'Investor' } }).availablePaths).not.toContain('/portal/compliance')
    expect(dashboardProjection(reviewer, 'TESTNET', snapshot).availablePaths).not.toContain('/portal/compliance')
  })
  it.each(['TreasuryOperator', 'FinancialController'] as const)('shows %s funding queues only from connected scoped records', role => {
    const scope = { organisationId: organisation, organisationName: 'A', role }
    const bound = { id: productOrganisation, name: 'A', status: 'ACTIVE', roles: [role], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' as const }
    expect(dashboardProjection(scope, 'TESTNET', { ...snapshot, organisations: [bound] }).queue).toEqual([])
    expect(dashboardProjection(scope, 'TESTNET', { ...snapshot, organisations: [bound] }).queueMessage).toContain('could not be loaded')
    const data = { ...snapshot, organisations: [bound], funding: { routes: [], obligations: [], references: [], journals: [], reversals: [] } }
    expect(dashboardProjection(scope, 'TESTNET', data).queue[0].value).toBe(0)
    expect(dashboardProjection({ ...scope, organisationId: otherOrganisation }, 'TESTNET', data).queue).toEqual([])
    expect(dashboardProjection(scope, 'MAINNET', data).queue).toEqual([])
  })
})
