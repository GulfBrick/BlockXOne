import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RoleDashboard } from '@/lib/portal/role-dashboards'
import { RoleDashboardContent, type RoleDashboardContentProps } from './role-dashboard'

const dashboard: RoleDashboard = {
  role: 'Investor',
  title: 'Investor dashboard',
  description: 'Review eligible opportunities and follow your investment through settlement.',
  responsibilities: ['Complete account onboarding.', 'Review the terms before subscribing.'],
  handoffs: ['Compliance Officer reviews eligibility.', 'Transfer Agent maintains the ownership register.'],
  walletGuidance: 'MetaMask proves control of your wallet; it does not grant institutional authority.',
  authorityBoundary: 'You cannot approve your own compliance review or funding reconciliation.',
  workflow: [
    { id: 'onboarding', label: 'Account onboarding', description: 'Provide account details for review.', status: 'needs_setup', href: '/portal/onboarding' },
    { id: 'opportunities', label: 'Investment opportunities', description: 'Review the available offering documents.', status: 'available', href: '/portal/opportunities' },
    { id: 'funding', label: 'Investment funding', description: 'Follow confirmed funding evidence.', status: 'not_connected', href: '/portal/funding' },
  ],
}

function render(change: Partial<RoleDashboardContentProps> = {}) {
  return renderToStaticMarkup(<RoleDashboardContent dashboard={dashboard} environment="TESTNET" organisationName="Fictional investor account" availablePaths={['/portal/onboarding', '/portal/opportunities']} {...change} />)
}

describe('source-driven role dashboard content', () => {
  it('renders responsibilities, hand-offs, wallet guidance and authority without inventing activity', () => {
    const html = render()
    for (const text of [...dashboard.responsibilities, ...dashboard.handoffs, dashboard.walletGuidance, dashboard.authorityBoundary]) expect(html).toContain(text)
    expect(html).toContain('Fictional investor account')
    expect(html).toContain('Test records and test value only')
    expect(html).toContain('Queue totals are not available in this view.')
    expect(html).not.toContain('Total assets under management')
    expect(html).not.toContain('No pending items')
    expect(html).not.toContain('>0</span>')
  })

  it('links only reachable available or needs-setup workflow paths', () => {
    const html = render()
    expect(html).toContain('href="/portal/onboarding"')
    expect(html).toContain('aria-label="Review setup for Account onboarding"')
    expect(html).toContain('href="/portal/opportunities"')
    expect(html).toContain('aria-label="Open Investment opportunities"')
    expect(html).not.toContain('href="/portal/funding"')
    expect(html).toContain('Workspace availability does not mean a business step is complete.')
  })

  it('keeps not-connected actions disabled even if their path is supplied', () => {
    const html = render({ availablePaths: ['/portal/onboarding', '/portal/opportunities', '/portal/funding'] })
    expect(html).not.toContain('href="/portal/funding"')
    expect(html).toContain('disabled="" aria-describedby="role-dashboard-investor-funding-availability"')
    expect(html).toContain('id="role-dashboard-investor-funding-availability"')
    expect(html).toContain('This workflow is not connected in this release.')
  })

  it('preserves the selected organisation in an already-permitted administration destination', () => {
    const administrationPath = '/workspace/administration'
    const destination = `${administrationPath}?organisation=33333333-3333-4333-8333-333333333333`
    const html = render({
      dashboard: { ...dashboard, role: 'SuperAdmin', workflow: [{ id: 'administration', label: 'Organisation administration', description: 'Manage this organisation within your authority.', status: 'available', href: administrationPath }] },
      availablePaths: [administrationPath],
      destinations: { [administrationPath]: destination },
    })
    expect(html).toContain(`href="${destination}"`)
    expect(html).not.toContain(`href="${administrationPath}"`)
  })

  it.each(['available', 'not_connected'] as const)('cannot use a destination mapping to bypass the %s step gate', status => {
    const administrationPath = '/workspace/administration'
    const destination = `${administrationPath}?organisation=33333333-3333-4333-8333-333333333333`
    const html = render({
      dashboard: { ...dashboard, role: 'SuperAdmin', workflow: [{ id: 'administration', label: 'Organisation administration', description: 'Manage this organisation within your authority.', status, href: administrationPath }] },
      availablePaths: status === 'available' ? [] : [administrationPath],
      destinations: { [administrationPath]: destination },
    })
    expect(html).not.toContain(`href="${destination}"`)
    expect(html).not.toContain(`href="${administrationPath}"`)
    expect(html).toContain('disabled="" aria-describedby="role-dashboard-superadmin-administration-availability"')
  })

  it('makes unavailable mainnet actions explicit without using testnet labels', () => {
    const html = render({ environment: 'MAINNET', availablePaths: [] })
    expect(html).not.toContain('href="/portal/onboarding"')
    expect(html).not.toContain('href="/portal/opportunities"')
    expect(html).toContain('Unavailable in MAINNET')
    expect(html).toContain('This workspace is not available for your current organisation and access in MAINNET.')
    expect(html).toContain('Real operations require approved authority')
    expect(html).not.toContain('Test records and test value only')
  })

  it('shows only supplied queue counts, including a genuine supplied zero', () => {
    const html = render({ queue: [{ label: 'Submitted applications', value: 4, description: 'Applications returned for this account.' }, { label: 'Pending invitations', value: 0, description: 'Invitations returned for this account.' }], queueMessage: 'Counts cover this account only.' })
    expect(html).toContain('Submitted applications')
    expect(html).toContain('>4</span>')
    expect(html).toContain('>0</span>')
    expect(html).toContain('Counts cover this account only.')
    expect(html).not.toContain('Queue totals are not available')
  })

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not present invalid queue count %s as a real total', value => {
    const html = render({ queue: [{ label: 'Pending work', value, description: 'Count could not be verified.' }] })
    expect(html).toContain('>Unavailable</span>')
    expect(html).not.toContain('>NaN</span>')
    expect(html).not.toContain('>0</span>')
  })

  it('uses the supplied reason for missing queue data and preserves a missing organisation state', () => {
    const html = render({ organisationName: '', queue: [], queueMessage: 'Select an approved organisation to load its work queue.' })
    expect(html).toContain('Select an approved organisation to load its work queue.')
    expect(html).toContain('No organisation selected')
    expect(html).not.toContain('>0</span>')
  })
})
