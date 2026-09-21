import { describe, expect, it } from 'vitest'
import { BX1_ROLES, type Bx1Workspace } from '../supabase/contracts'
import type { PortalSnapshot, PortalSubscription } from './contracts'
import { dashboardProjection, dashboardScopes, dashboardScopeHref, selectDashboardScope } from './dashboard'
const workspace: Bx1Workspace = { user: { id: 'actor', email: 'actor@example.invalid', platformUserId: 'person', displayName: null }, organisations: [{ id: 'org-a', name: 'Fund manager', roles: [...BX1_ROLES] }, { id: 'org-b', name: 'Property issuer', roles: ['Investor'] }] }
const snapshot: PortalSnapshot = { actor: { id: 'actor', email: 'actor@example.invalid', display_name: null, can_review: false }, organisations: [], applications: [], products: [], subscriptions: [], events: [] }
describe('role and organisation dashboard selection', () => {
  it.each(BX1_ROLES)('accepts only the actual %s assignment', role => {
    const scope = selectDashboardScope(workspace, { organisation: 'org-a', role })!
    expect(scope.role).toBe(role)
    expect(dashboardScopeHref(scope)).toContain(`role=${role}`)
  })
  it.each([{ organisation: 'org-b', role: 'SuperAdmin' }, { organisation: 'org-c', role: 'Investor' }, { organisation: ['org-a'], role: 'Investor' }, { organisation: 'org-a', role: ['Investor', 'SuperAdmin'] }, { role: 'SuperAdmin' }, { organisation: 'org-a', role: 'WealthManager' }])('denies invented or ambiguous scope %j', query => expect(selectDashboardScope(workspace, query)).toBeNull())
  it('does not combine roles across organisations', () => expect(dashboardScopes(workspace).filter(scope => scope.organisationId === 'org-b').map(scope => scope.role)).toEqual(['Investor']))
  it('offers no fallback for an unassigned user', () => expect(selectDashboardScope({ ...workspace, organisations: [] }, {})).toBeNull())
  it.each(BX1_ROLES)('never exposes TEST business routes on MAINNET for %s', role => {
    const projection = dashboardProjection({ organisationId: 'org-a', organisationName: 'A', role }, 'MAINNET', snapshot)
    expect(projection.availablePaths.every(path => path.startsWith('/workspace/'))).toBe(true)
    expect(projection.queue).toEqual([])
  })
  it('distinguishes failed reads from actual empty records', () => {
    const scope = dashboardScopes(workspace)[0]
    expect(dashboardProjection(scope, 'TESTNET').queue).toEqual([])
    expect(dashboardProjection(scope, 'TESTNET').queueMessage).toContain('not a zero balance')
    expect(dashboardProjection(scope, 'TESTNET', snapshot).queue[0].value).toBe(0)
  })
  it('does not mistake a native role for a connection to a separate product organisation', () => {
    const scope = selectDashboardScope(workspace, { organisation: 'org-a', role: 'OfferingManager' })!
    expect(dashboardProjection(scope, 'TESTNET', snapshot).availablePaths).not.toContain('/portal/products')
    expect(dashboardProjection(scope, 'TESTNET', { ...snapshot, organisations: [{ id: 'separate-product-organisation', name: 'A', status: 'ACTIVE', roles: ['OfferingManager'] }] }).availablePaths).toContain('/portal/products')
  })
  it('counts own subscriptions across issuers without equating issuer IDs to native access scope', () => {
    const own = { id: 'sub', investor_id: 'actor', organisation_id: 'separate-product-issuer', status: 'AWAITING_FUNDING' } as PortalSubscription
    const data = { ...snapshot, subscriptions: [own, { ...own, id: 'other', investor_id: 'another-person' }] }
    for (const organisation of ['org-a', 'org-b']) {
      const scope = selectDashboardScope(workspace, { organisation, role: 'Investor' })!
      const projection = dashboardProjection(scope, 'TESTNET', data)
      expect(projection.queue[0].value).toBe(1)
      expect(projection.queue[0].description).toContain('not this access organisation')
    }
  })
  it('permits the exact existing reviewer scope without manufacturing reviewer product organisations', () => {
    const reviewer = { organisationId: '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', organisationName: 'Review scope', role: 'ComplianceOfficer' as const }
    const data = { ...snapshot, actor: { ...snapshot.actor, can_review: true } }
    expect(dashboardProjection(reviewer, 'TESTNET', data).availablePaths).toContain('/portal/compliance')
    expect(dashboardProjection({ ...reviewer, organisationId: 'org-b' }, 'TESTNET', data).availablePaths).not.toContain('/portal/compliance')
    expect(dashboardProjection(reviewer, 'TESTNET', snapshot).availablePaths).not.toContain('/portal/compliance')
  })
})
