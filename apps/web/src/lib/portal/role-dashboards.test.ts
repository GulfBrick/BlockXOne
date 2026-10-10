import { describe, expect, it } from 'vitest'
import { BX1_ROLES } from '../supabase/contracts'
import { getRoleDashboard, isRoleDashboardRole, ROLE_DASHBOARDS, ROLE_DASHBOARD_LIST } from './role-dashboards'

const connectedPaths = [
  '/portal/onboarding', '/portal/products', '/portal/products/new', '/portal/compliance',
  '/portal/opportunities', '/portal/portfolio', '/workspace/administration', '/workspace/security',
]

describe('shared nine-role dashboard catalog', () => {
  it('contains exactly the canonical nine roles in their canonical order', () => {
    expect(Object.keys(ROLE_DASHBOARDS)).toEqual([...BX1_ROLES])
    expect(ROLE_DASHBOARD_LIST.map(dashboard => dashboard.role)).toEqual([...BX1_ROLES])
    expect(new Set(ROLE_DASHBOARD_LIST.map(dashboard => dashboard.role)).size).toBe(9)
    expect(ROLE_DASHBOARDS).not.toHaveProperty('WealthManager')
    expect(ROLE_DASHBOARDS).not.toHaveProperty('SupportAgent')
  })

  it.each(BX1_ROLES)('provides the same %s definition through both accessors', role => {
    expect(isRoleDashboardRole(role)).toBe(true)
    expect(getRoleDashboard(role)).toBe(ROLE_DASHBOARDS[role])
    expect(ROLE_DASHBOARD_LIST.find(dashboard => dashboard.role === role)).toBe(ROLE_DASHBOARDS[role])
  })

  it.each([
    '', 'Investor ', ' Investor', 'investor', 'INVESTOR', 'WealthManager', 'SupportAgent',
    'Admin', 'Super Admin', '__proto__', 'constructor', 'toString', null, undefined,
    false, 0, {}, [], { role: 'SuperAdmin' }, ['Investor'],
  ].map(value => ({ value })))('rejects unknown, coerced and prototype-like role values: $value', ({ value }) => {
    expect(isRoleDashboardRole(value)).toBe(false)
    expect(getRoleDashboard(value)).toBeUndefined()
  })

  it.each(BX1_ROLES)('gives %s explicit responsibilities, hand-offs and authority boundaries', role => {
    const dashboard = ROLE_DASHBOARDS[role]
    expect(dashboard.role).toBe(role)
    expect(dashboard.title.length).toBeGreaterThan(10)
    expect(dashboard.description.length).toBeGreaterThan(50)
    expect(dashboard.responsibilities.length).toBeGreaterThanOrEqual(3)
    expect(dashboard.handoffs.length).toBeGreaterThanOrEqual(3)
    expect(dashboard.responsibilities.every(item => item.trim().length > 20)).toBe(true)
    expect(dashboard.handoffs.every(item => item.trim().length > 20)).toBe(true)
    expect(dashboard.walletGuidance).toContain('MetaMask')
    expect(dashboard.authorityBoundary).toContain('cannot')
    expect(dashboard.workflow.length).toBeGreaterThanOrEqual(4)
  })

  it.each(BX1_ROLES)('gives %s unique steps and only supported navigation links', role => {
    const steps = ROLE_DASHBOARDS[role].workflow
    expect(new Set(steps.map(step => step.id)).size).toBe(steps.length)
    for (const step of steps) {
      expect(step.id).toMatch(/^[a-z][a-z-]+$/)
      expect(step.label.trim().length).toBeGreaterThan(5)
      expect(step.description.trim().length).toBeGreaterThan(30)
      expect(['available', 'needs_setup', 'not_connected']).toContain(step.status)
      if (step.status === 'available') {
        expect(connectedPaths).toContain(step.href)
      } else {
        expect(step).not.toHaveProperty('href')
      }
    }
  })

  it('contains no presenter-demo replacements, role-switching URLs or environment-specific catalogs', () => {
    const catalog = JSON.stringify(ROLE_DASHBOARDS)
    expect(catalog).not.toContain('/workspace/testnet-fund')
    expect(catalog).not.toContain('https://')
    expect(catalog).not.toContain('http://')
    for (const dashboard of ROLE_DASHBOARD_LIST) {
      expect(dashboard).not.toHaveProperty('environment')
      expect(dashboard).not.toHaveProperty('permissions')
      expect(dashboard).not.toHaveProperty('assigned')
      expect(dashboard).not.toHaveProperty('balance')
      expect(dashboard).not.toHaveProperty('progress')
      expect(dashboard).not.toHaveProperty('metrics')
      for (const step of dashboard.workflow) {
        expect(step.href ?? '').not.toMatch(/[?#]/)
        expect(step).not.toHaveProperty('completed')
        expect(step).not.toHaveProperty('count')
        expect(step).not.toHaveProperty('allowed')
      }
    }
  })

  it('does not represent subscription instructions as funded holdings', () => {
    const instructions = ROLE_DASHBOARDS.Investor.workflow.find(step => step.id === 'instructions')
    expect(instructions).toMatchObject({ status: 'available', href: '/portal/portfolio' })
    expect(instructions?.description).toContain('does not represent funded or issued holdings')
    expect(ROLE_DASHBOARDS.Investor.workflow.filter(step => ['funding', 'ownership', 'servicing-exit'].includes(step.id)).every(step => step.status === 'not_connected')).toBe(true)
  })

  it('does not present the current manual review as live provider-backed KYC', () => {
    const review = ROLE_DASHBOARDS.ComplianceOfficer.workflow.find(step => step.id === 'review')
    expect(review).toMatchObject({ status: 'available', href: '/portal/compliance' })
    expect(review?.description).toContain('not a live KYC-provider result')
    expect(ROLE_DASHBOARDS.ComplianceOfficer.workflow.find(step => step.id === 'provider-screening')?.status).toBe('not_connected')
    expect(ROLE_DASHBOARDS.ComplianceOfficer.workflow.find(step => step.id === 'ongoing-monitoring')).toMatchObject({ status: 'available', href: '/portal/compliance' })
    expect(ROLE_DASHBOARDS.ComplianceOfficer.workflow.find(step => step.id === 'ongoing-monitoring')?.description).toContain('not automatic provider monitoring')
  })

  it('keeps financial, register and chain integration visibly unconnected', () => {
    for (const role of ['TreasuryOperator', 'FinancialController', 'TransferAgent', 'TokenisationAgent'] as const) {
      const steps = ROLE_DASHBOARDS[role].workflow
      expect(steps.filter(step => step.status === 'available').map(step => step.href)).toEqual(['/workspace/security'])
      expect(steps.filter(step => step.status === 'not_connected').length).toBeGreaterThanOrEqual(3)
    }
  })

  it('preserves separate institutional signing authority for every operational role', () => {
    for (const role of BX1_ROLES.filter(role => role !== 'Investor')) {
      expect(ROLE_DASHBOARDS[role].walletGuidance).toMatch(/institutional|organisation wallets/)
    }
    expect(ROLE_DASHBOARDS.SuperAdmin.walletGuidance).toContain('does not include wallet custody')
    expect(ROLE_DASHBOARDS.SuperAdmin.authorityBoundary).toContain('mint tokens or rewrite balances')
    expect(ROLE_DASHBOARDS.OfferingManager.authorityBoundary).toContain('cannot approve their own offering review')
    expect(ROLE_DASHBOARDS.ComplianceOfficer.authorityBoundary).toContain('cannot approve their own application or offering')
  })

  it('covers both fund and real-estate products without inventing a blanket wealth-manager role', () => {
    expect(ROLE_DASHBOARDS.OfferingManager.workflow.find(step => step.id === 'draft')?.description).toContain('fund or real-estate')
    expect(ROLE_DASHBOARDS.IssuerFundManager.description).toContain('funds or real-estate')
    expect(ROLE_DASHBOARDS.Investor.workflow.find(step => step.id === 'opportunities')?.description).toContain('fund or real-estate')
    expect(getRoleDashboard('WealthManager')).toBeUndefined()
  })
})
