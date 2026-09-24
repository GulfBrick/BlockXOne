import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PortalApplication, PortalCustomerMonitoring, PortalSnapshot } from '@/lib/portal/contracts'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import { CustomerMonitoringDecision, CustomerMonitoringQueue } from './customer-monitoring'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const actor = '11111111-1111-4111-8111-111111111111'
const applicant = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333'
const applicationId = '44444444-4444-4444-8444-444444444444'
const context: PortalOperatingContext = { mode: 'ROLE', role: 'ComplianceOfficer', organisationId: organisation }
const monitoring: PortalCustomerMonitoring = { application_id: applicationId, application_revision: 2, state: 'ON_HOLD', case_revision: 1, admission_expires_at: '2099-01-01T00:00:00+00:00', renewal_due: false, new_actions_allowed: false }
const application: PortalApplication = {
  id: applicationId, user_id: applicant, persona: 'INVESTOR', status: 'APPROVED', revision: 2,
  details: { full_name: 'Fictional Investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Entirely synthetic money for a test workflow.', beneficial_owners: '', experience: 'Fictional investing experience only.', documents: [], test_data_acknowledged: true },
  submitted_at: '2026-09-24T00:00:00Z', reviewed_at: '2026-09-24T01:00:00Z', reviewer_id: actor,
  review_notes: 'Synthetic admission review.', organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z',
}
function snapshot(changes: Partial<PortalSnapshot> = {}): PortalSnapshot {
  return { actor: { id: actor, email: 'reviewer@example.invalid', display_name: 'Test reviewer', can_review: true }, applications: [application], organisations: [], products: [], subscriptions: [], events: [], operating_context: context, customer_monitoring: [monitoring], ...changes }
}

describe('existing Compliance dashboard monitoring hand-off', () => {
  it('shows only scoped saved monitoring records and keeps restrictions distinct from eligibility', () => {
    const html = renderToStaticMarkup(<CustomerMonitoringQueue snapshot={snapshot()} operatingContext={context} />)
    expect(html).toContain('Customer monitoring and restrictions')
    expect(html).toContain('Fictional Investor')
    expect(html).toContain('New actions on hold')
    expect(html).toContain('Blocked by monitoring or admission expiry')
    expect(html).toContain(`/portal/compliance/detail?organisation=${organisation}&amp;role=ComplianceOfficer&amp;id=${applicationId}`)
    expect(html).toContain('does not erase existing holdings or replace admission and product-specific decisions')
  })
  it('does not turn an absent monitoring response into an empty queue or expose cases in an unverified context', () => {
    const absent = snapshot(); delete absent.customer_monitoring
    const unavailable = renderToStaticMarkup(<CustomerMonitoringQueue snapshot={absent} operatingContext={context} />)
    expect(unavailable).toContain('Monitoring records unavailable')
    expect(unavailable).not.toContain('No approved admissions')
    const mismatch = renderToStaticMarkup(<CustomerMonitoringQueue snapshot={snapshot()} operatingContext={{ mode: 'ROLE', role: 'ComplianceOfficer', organisationId: applicant }} />)
    expect(mismatch).toContain('Monitoring scope unavailable')
    expect(mismatch).not.toContain('Fictional Investor')
    const empty = renderToStaticMarkup(<CustomerMonitoringQueue snapshot={snapshot({ customer_monitoring: [] })} operatingContext={context} />)
    expect(empty).toContain('No approved admissions in this review scope')
  })
  it('renders an evidence-bound guarded command on the approved application detail', () => {
    const html = renderToStaticMarkup(<CustomerMonitoringDecision application={application} snapshot={snapshot()} operatingContext={context} onSaved={vi.fn()} />)
    expect(html).toContain('Ongoing customer monitoring')
    expect(html).toContain('Record monitoring decision')
    expect(html).toContain('Case revision')
    expect(html).toContain('Evidence reference')
    expect(html).toContain('Identity evidence is current')
    expect(html).toContain('Lifting a restriction requires all four')
    expect(html).toContain('not customer admission renewal, product eligibility, wallet authority')
  })
  it('blocks a self-decision, stale source and expired-admission restoration in the UI', () => {
    const self = renderToStaticMarkup(<CustomerMonitoringDecision application={{ ...application, user_id: actor }} snapshot={snapshot()} operatingContext={context} onSaved={vi.fn()} />)
    expect(self).toContain('Different reviewer required')
    expect(self).not.toContain('Record monitoring decision')
    const stale = renderToStaticMarkup(<CustomerMonitoringDecision application={{ ...application, revision: 3 }} snapshot={snapshot()} operatingContext={context} onSaved={vi.fn()} />)
    expect(stale).toContain('Source admission changed')
    expect(stale).not.toContain('Record monitoring decision')
    const expired = renderToStaticMarkup(<CustomerMonitoringDecision application={application} snapshot={snapshot({ customer_monitoring: [{ ...monitoring, admission_expires_at: '2020-01-01T00:00:00+00:00', renewal_due: true }] })} operatingContext={context} onSaved={vi.fn()} />)
    expect(expired).toContain('Admission renewal due')
    expect(expired).toMatch(/<option value="CURRENT" disabled=""/)
  })
})
