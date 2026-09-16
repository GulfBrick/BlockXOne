import { describe, expect, it } from 'vitest'

import {
  getDefaultRouteForRoles,
  hasAnyPermission,
  hasAnyRole,
  OFFERING_WORKFLOW_ROLES,
  SETTLEMENT_WORKFLOW_PERMISSIONS,
  SETTLEMENT_WORKFLOW_ROLES,
  SUBSCRIPTION_WORKFLOW_ROLES,
} from './role-routing'

describe('role routing', () => {
  it('keeps super administrators inside the controlled pilot perimeter', () => {
    expect(getDefaultRouteForRoles(['SuperAdmin'], 'pilot')).toBe('/wm')
    expect(getDefaultRouteForRoles(['SuperAdmin'], 'pilot-share')).toBe('/wm')
    expect(getDefaultRouteForRoles(['SuperAdmin'], 'production')).toBe('/admin')
  })

  it('selects the highest-priority known role and rejects unknown roles', () => {
    expect(getDefaultRouteForRoles(['Investor', 'ComplianceOfficer'], 'pilot')).toBe('/compliance')
    expect(getDefaultRouteForRoles(['UnknownRole'], 'pilot')).toBe('/')
  })

  it('routes finance operators directly to their least-privilege workflow', () => {
    expect(getDefaultRouteForRoles(['TreasuryOperator'], 'pilot')).toBe('/wm/settlements')
    expect(getDefaultRouteForRoles(['FinancialController'], 'pilot')).toBe('/wm/settlements')
    expect(getDefaultRouteForRoles(['Investor', 'TreasuryOperator'], 'pilot')).toBe('/wm/settlements')
  })

  it('matches access when any assigned role is explicitly allowed', () => {
    expect(hasAnyRole(['TransferAgent'], ['TransferAgent', 'SuperAdmin'])).toBe(true)
    expect(hasAnyRole(['OfferingManager'], ['TransferAgent', 'SuperAdmin'])).toBe(false)
  })

  it('limits the settlement surface to its finance roles', () => {
    expect(hasAnyRole(['TreasuryOperator'], [...SETTLEMENT_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['FinancialController'], [...SETTLEMENT_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['OfferingManager'], [...SETTLEMENT_WORKFLOW_ROLES])).toBe(false)
    expect(hasAnyRole(['TransferAgent'], [...SETTLEMENT_WORKFLOW_ROLES])).toBe(false)
  })

  it('limits the subscription approval surface to assigned transfer agents', () => {
    expect(hasAnyRole(['TransferAgent'], [...SUBSCRIPTION_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['SuperAdmin'], [...SUBSCRIPTION_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['IssuerFundManager'], [...SUBSCRIPTION_WORKFLOW_ROLES])).toBe(false)
  })

  it('admits every required maker-checker role to offering evidence', () => {
    expect(hasAnyRole(['OfferingManager'], [...OFFERING_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['IssuerFundManager'], [...OFFERING_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['FinancialController'], [...OFFERING_WORKFLOW_ROLES])).toBe(true)
    expect(hasAnyRole(['TokenisationAgent'], [...OFFERING_WORKFLOW_ROLES])).toBe(false)
    expect(hasAnyRole(['TransferAgent'], [...OFFERING_WORKFLOW_ROLES])).toBe(false)
  })

  it('shows the settlement workflow for any authoritative workflow permission', () => {
    expect(hasAnyPermission({ 'reconciliation:run': true }, SETTLEMENT_WORKFLOW_PERMISSIONS)).toBe(true)
    expect(hasAnyPermission({ 'reconciliation:approve': true }, SETTLEMENT_WORKFLOW_PERMISSIONS)).toBe(true)
    expect(hasAnyPermission({ 'payment:notify': true }, SETTLEMENT_WORKFLOW_PERMISSIONS)).toBe(true)
    expect(hasAnyPermission({ 'offering:edit': true }, SETTLEMENT_WORKFLOW_PERMISSIONS)).toBe(false)
    expect(hasAnyPermission(undefined, SETTLEMENT_WORKFLOW_PERMISSIONS)).toBe(false)
  })
})
