import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CustomerHandoff } from '@/lib/portal/customer-handoff'
import { entryApplication, entryHandoff, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
import { CustomerHandoffPanel, customerHandoffPresentation } from './customer-handoff'

const application = entryApplication({ review_route: 'AVAILABLE' })
const accountId = '77777777-7777-4777-8777-777777777777'
const mandateId = '66666666-6666-4666-8666-666666666666'
function render(overrides: Partial<CustomerHandoff> = {}) {
  return renderToStaticMarkup(createElement(CustomerHandoffPanel, { application, handoff: entryHandoff(application, overrides) }))
}

describe('authoritative customer handoff presentation', () => {
  it.each([
    ['PREPARE_APPLICATION', 'APPLICANT', 'Draft: not submitted'],
    ['REVIEW_PENDING', 'COMPLIANCE', 'Awaiting an independent decision'],
    ['INFORMATION_REQUIRED', 'APPLICANT', 'Your changes are required'],
    ['REAPPLICATION_REQUIRED', 'APPLICANT', 'Application not approved; reapplication available'],
    ['OPEN_ACCOUNT', 'APPLICANT', 'Investor admission approved; account opening next'],
    ['ACCOUNT_AVAILABLE', 'NONE', 'Investment account available'],
    ['REQUEST_MANDATE', 'APPLICANT', 'Entity account recorded; representative appointment next'],
    ['MANDATE_REVIEW_PENDING', 'COMPLIANCE', 'Representative appointment awaiting review'],
    ['MANDATE_INFORMATION_REQUIRED', 'APPLICANT', 'Representative appointment needs your changes'],
    ['MANDATE_APPLY_PENDING', 'SUPER_ADMIN', 'Reviewed appointment awaiting application'],
    ['WORKSPACE_AVAILABLE', 'NONE', 'Operating workspace available'],
    ['UNAVAILABLE', 'PROVIDER_OWNER', 'Customer handoff unavailable'],
  ] as const)('describes %s with its exact next owner', (state, next_owner, title) => {
    const presentation = customerHandoffPresentation(entryHandoff(application, { state, next_owner }))
    expect(presentation.title).toBe(title)
    expect(presentation.owner).toBe({ APPLICANT: 'You, the applicant', COMPLIANCE: 'Independent BlockXOne Compliance Officer', SUPER_ADMIN: 'Authorised BlockXOne Super Admin', PROVIDER_OWNER: 'BlockXOne onboarding / provider owner', NONE: 'No pending admission handoff' }[next_owner])
  })
  it.each([
    ['INTAKE_NOT_ADMITTED', 'Evidence intake not admitted'],
    ['REVIEWER_UNAVAILABLE', 'Independent reviewer not assigned'],
    ['PROVIDER_UNSUPPORTED', 'Review provider not supported'],
    ['ADMISSION_EXPIRED', 'Customer admission expired'],
    ['MONITORING_ON_HOLD', 'Customer relationship on hold'],
    ['MONITORING_RENEWAL_REQUIRED', 'Monitoring renewal required'],
    ['ACCOUNT_SUSPENDED', 'Investment account suspended'],
    ['MANDATE_NOT_EFFECTIVE', 'Representative mandate not effective'],
    ['CONTEXT_UNAVAILABLE', 'Operating context not verified'],
    ['CONTEXT_NOT_SUPPORTED', 'Application context not admitted'],
    ['ADMISSION_NOT_APPROVED', 'Customer admission not current'],
  ] as const)('gives blocker %s precedence over an active-looking state', (blocker, title) => {
    const html = render({ state: 'WORKSPACE_AVAILABLE', blocker, allowed_actions: [], destination: 'NONE' })
    expect(html).toContain(title)
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
  })
  it('renders a missing projection as unavailable without status-derived actions', () => {
    const approved = entryApplication({ status: 'APPROVED' })
    const html = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application: approved, handoff: null }))
    expect(html).toContain('Saved progress could not be verified')
    expect(html).toContain(approved.id)
    expect(html).not.toContain('href=')
    expect(html).not.toContain('type="file"')
  })
  it('displays saved gate facts and references without using colour as the only indicator', () => {
    const html = render({ gates: { intake_admitted: true, reviewer_available: false, monitoring_allows_new_actions: false } })
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Current customer workflow gates')
    expect(html).toContain('Eligible reviewer not available')
    expect(html).toContain('Not yet permitted by current admission/monitoring')
    expect(html).toContain(application.id)
    expect(html).toContain('Saved revision')
  })
  it('separates account references from product eligibility, wallet authority and holdings', () => {
    const html = render({ state: 'ACCOUNT_AVAILABLE', allowed_actions: ['VIEW_INVESTMENT_ACCOUNT'], destination: 'INVESTMENT_ACCOUNT', accounts: [{ id: accountId, kind: 'INDIVIDUAL', status: 'ACTIVE' }] })
    expect(html).toContain(accountId)
    expect(html).toContain('View investment account and orders')
    expect(html).toContain('/portal/portfolio?mode=applicant')
    expect(html).toContain('not product eligibility, wallet authority, funding or ownership')
  })
  it('takes entity representatives to the existing mandate workflow without claiming account-instruction authority', () => {
    const html = render({ state: 'REQUEST_MANDATE', allowed_actions: ['REQUEST_INVESTING_REPRESENTATIVE_MANDATE'], destination: 'INVESTMENT_ACCOUNT', accounts: [{ id: accountId, kind: 'ENTITY', status: 'ACTIVE' }] })
    expect(html).toContain('Entity account recorded; representative appointment next')
    expect(html).toContain('Continue to entity representative appointment')
    expect(html).not.toContain('View investment account and orders')
    expect(html).toContain('does not grant authority to instruct investments')
  })
  it('keeps manager admission distinct from its reviewed but unapplied appointment', () => {
    const html = render({ persona: 'WEALTH_MANAGER', state: 'MANDATE_APPLY_PENDING', next_owner: 'SUPER_ADMIN', allowed_actions: [], destination: 'NONE', mandate: { id: mandateId, status: 'APPROVED', effective: false } })
    expect(html).toContain(mandateId)
    expect(html).toContain('Authorised BlockXOne Super Admin')
    expect(html).toContain('not yet an active organisation-role assignment')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it('uses only the already-supported operating destination for effective assignments', () => {
    const html = render({ persona: 'WEALTH_MANAGER', state: 'WORKSPACE_AVAILABLE', allowed_actions: ['ENTER_OPERATING_WORKSPACE'], destination: 'OPERATING_WORKSPACE', mandate: { id: mandateId, status: 'APPLIED', effective: true }, native_context: { organisation_id: entryOrganisationId, role: 'OfferingManager' } })
    expect(html).toContain(`/portal?organisation=${entryOrganisationId}&amp;role=OfferingManager`)
    expect(html).toContain('Open Offering Manager workspace')
    expect(html).not.toContain('role=SuperAdmin')
  })
  it('labels MAIN prerequisites and TEST rehearsal without presenting synthetic clearance as live admission', () => {
    expect(render()).toContain('Synthetic evidence or a test decision does not establish production clearance')
    const html = render({ environment: 'MAINNET', state: 'UNAVAILABLE', next_owner: 'PROVIDER_OWNER', blocker: 'INTAKE_NOT_ADMITTED', allowed_actions: [], destination: 'NONE', gates: { intake_admitted: false, reviewer_available: false, monitoring_allows_new_actions: false } })
    expect(html).toContain('MAIN admission remains unavailable')
    expect(html).toContain('Do not submit real documents or transfer money')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('type="file"')
  })
})
