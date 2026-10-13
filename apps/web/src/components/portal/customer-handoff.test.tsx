import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CustomerHandoff } from '@/lib/portal/customer-handoff'
import { entryApplication, entryHandoff, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
import { CustomerHandoffPanel, customerHandoffPresentation } from './customer-handoff'

const application = entryApplication({ review_route: 'AVAILABLE' })
const accountId = '77777777-7777-4777-8777-777777777777'
const mandateId = '66666666-6666-4666-8666-666666666666'
function render(overrides: Partial<CustomerHandoff> = {}, presentation: 'summary' | 'history' = 'summary') {
  return renderToStaticMarkup(createElement(CustomerHandoffPanel, { application, handoff: entryHandoff(application, overrides), presentation }))
}

describe('authoritative customer handoff presentation', () => {
  it('keeps draft saving and independent submission distinct without an obsolete no-autosave claim', () => {
    const draft = customerHandoffPresentation(entryHandoff(application, { state: 'PREPARE_APPLICATION' }))
    expect(draft.description).toContain('save indicator')
    expect(draft.description).toContain('saving a draft does not')
    const missingReviewer = customerHandoffPresentation(entryHandoff(application, { blocker: 'REVIEWER_UNAVAILABLE' }))
    expect(missingReviewer.description).toContain('A saved draft is not a submitted application')
    for (const message of [draft.description, missingReviewer.description]) expect(message).not.toContain('not submitted or saved automatically')
  })
  it.each([
    ['PREPARE_APPLICATION', 'APPLICANT', 'Draft: not submitted'],
    ['REVIEW_PENDING', 'COMPLIANCE', 'Awaiting an independent decision'],
    ['INFORMATION_REQUIRED', 'APPLICANT', 'Your changes are required'],
    ['REAPPLICATION_REQUIRED', 'APPLICANT', 'Not approved; you can reapply'],
    ['OPEN_ACCOUNT', 'APPLICANT', 'Investor admission approved; account opening next'],
    ['ACCOUNT_AVAILABLE', 'NONE', 'Investment account available'],
    ['REQUEST_MANDATE', 'APPLICANT', 'Entity account recorded; representative appointment next'],
    ['MANDATE_REVIEW_PENDING', 'COMPLIANCE', 'Representative appointment awaiting review'],
    ['MANDATE_INFORMATION_REQUIRED', 'APPLICANT', 'Representative appointment needs your changes'],
    ['MANDATE_APPLY_PENDING', 'SUPER_ADMIN', 'Reviewed appointment awaiting application'],
    ['WORKSPACE_AVAILABLE', 'NONE', 'Operating workspace available'],
    ['UNAVAILABLE', 'PROVIDER_OWNER', 'Your next step is unavailable'],
  ] as const)('describes %s with its exact next owner', (state, next_owner, title) => {
    const presentation = customerHandoffPresentation(entryHandoff(application, { state, next_owner }))
    expect(presentation.title).toBe(title)
    expect(presentation.owner).toBe({ APPLICANT: 'You, the applicant', COMPLIANCE: 'Independent BlockXOne Compliance Officer', SUPER_ADMIN: 'Authorised BlockXOne Super Admin', PROVIDER_OWNER: 'BlockXOne onboarding / provider owner', NONE: 'No pending admission handoff' }[next_owner])
  })
  it.each([
    ['INTAKE_NOT_ADMITTED', 'Evidence submission is unavailable'],
    ['REVIEWER_UNAVAILABLE', 'Independent reviewer not assigned'],
    ['PROVIDER_UNSUPPORTED', 'The review route needs attention'],
    ['ADMISSION_EXPIRED', 'Customer admission expired'],
    ['MONITORING_ON_HOLD', 'Customer relationship on hold'],
    ['MONITORING_RENEWAL_REQUIRED', 'Monitoring renewal required'],
    ['ACCOUNT_SUSPENDED', 'Investment account suspended'],
    ['MANDATE_NOT_EFFECTIVE', 'Representative mandate not effective'],
    ['CONTEXT_UNAVAILABLE', 'Workspace access could not be verified'],
    ['CONTEXT_NOT_SUPPORTED', 'This application needs a supported review route'],
    ['ADMISSION_NOT_APPROVED', 'Customer admission not current'],
  ] as const)('gives blocker %s precedence over an active-looking state', (blocker, title) => {
    const html = render({ state: 'WORKSPACE_AVAILABLE', blocker, allowed_actions: [], destination: 'NONE' })
    expect(html).toContain(title)
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(['mailto:daniel@bx1.co.za'])
  })
  it('renders a missing projection as unavailable without status-derived actions', () => {
    const approved = entryApplication({ status: 'APPROVED' })
    const html = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application: approved, handoff: null }))
    expect(html).toContain('Saved progress could not be verified')
    expect(html).not.toContain(approved.id)
    const history = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application: approved, handoff: null, presentation: 'history' }))
    expect(history).toContain(approved.id)
    expect(history).toContain('Current access checks could not be verified')
    expect(history).not.toContain('href=')
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(['mailto:daniel@bx1.co.za'])
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('type="file"')
  })
  it('displays saved gate facts and references without using colour as the only indicator', () => {
    const gates = { intake_admitted: true, reviewer_available: false, monitoring_allows_new_actions: false }
    expect(render({ gates })).toContain('aria-live="polite"')
    const html = render({ gates }, 'history')
    expect(html).toContain('Current customer workflow gates')
    expect(html).toContain('Eligible reviewer not available')
    expect(html).toContain('Not yet permitted by current admission/monitoring')
    expect(html).toContain(application.id)
    expect(html).toContain('Saved revision')
  })
  it('keeps every reference, gate and linked record in the explicit history view, not the next-step summary', () => {
    const overrides: Partial<CustomerHandoff> = { state: 'WORKSPACE_AVAILABLE', persona: 'WEALTH_MANAGER', next_owner: 'NONE', allowed_actions: ['ENTER_OPERATING_WORKSPACE'], destination: 'OPERATING_WORKSPACE', accounts: [{ id: accountId, kind: 'ENTITY', status: 'ACTIVE' }], mandate: { id: mandateId, status: 'APPLIED', effective: true }, native_context: { organisation_id: entryOrganisationId, role: 'OfferingManager' } }
    const primary = render(overrides)
    const history = render(overrides, 'history')
    expect(history).toContain('Application records')
    expect(primary).toContain('Operating workspace available')
    expect(primary).toContain('Next responsible owner')
    expect(primary).toContain('Open Offering Manager workspace')
    for (const value of [application.id, accountId, mandateId, 'Saved revision', 'Current customer workflow gates', 'Linked investment accounts', 'Linked representative appointment']) {
      expect(primary).not.toContain(value)
      expect(history).toContain(value)
    }
    expect(history).toContain('Verified operating organisation')
    expect(history).toContain('Not assigned')
    for (const html of [primary, history]) expect(html).not.toMatch(/<(?:details|summary)\b/)
    expect(history).not.toContain('href=')
    expect(history).not.toContain('<button')
  })
  it('keeps the manual test-review boundary in application details', () => {
    const reviewed = entryApplication({ provider_mode: 'MANUAL_TEST_REVIEW' })
    const html = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application: reviewed, handoff: entryHandoff(reviewed), presentation: 'history' }))
    expect(html).toContain('Manual test review (not live KYC clearance)')
  })
  it('keeps unavailable projection records in history while making recovery contact visible in the summary', () => {
    const html = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application, handoff: null }))
    const history = renderToStaticMarkup(createElement(CustomerHandoffPanel, { application, handoff: null, presentation: 'history' }))
    expect(html).toContain('Contact BlockXOne onboarding')
    expect(html).toContain('Next responsible owner')
    expect(html).not.toContain(application.id)
    expect(history).toContain(application.id)
    for (const view of [html, history]) expect(view).not.toMatch(/<(?:details|summary)\b/)
  })
  it.each(['REVIEWER_UNAVAILABLE', 'PROVIDER_UNSUPPORTED', 'INTAKE_NOT_ADMITTED', 'CONTEXT_UNAVAILABLE', 'CONTEXT_NOT_SUPPORTED'] as const)('offers a recovery contact for %s without transmitting private references', blocker => {
    const html = render({ state: 'UNAVAILABLE', blocker, next_owner: 'PROVIDER_OWNER', allowed_actions: [], destination: 'NONE', mandate: { id: mandateId, status: 'APPROVED', effective: false } })
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])
    expect(hrefs).toEqual(['mailto:daniel@bx1.co.za'])
    expect(html).toContain('Contact BlockXOne onboarding')
    expect(html).toContain('No application details are included automatically')
    for (const value of [application.id, mandateId, entryOrganisationId, '?subject=', '?body=']) expect(hrefs.join(' ')).not.toContain(value)
  })
  it('preserves submitted-case recovery when an independent reviewer becomes unavailable', () => {
    const html = render({ state: 'REVIEW_PENDING', blocker: 'REVIEWER_UNAVAILABLE', next_owner: 'PROVIDER_OWNER', allowed_actions: [], destination: 'NONE' })
    expect(html).toContain('Your submitted case is preserved')
    expect(html).toContain('do not submit a duplicate')
    expect(html).toContain('Independent reviewer not assigned')
    expect(html).toContain('mailto:daniel@bx1.co.za')
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it.each(['WORKSPACE_AVAILABLE', 'OPEN_ACCOUNT', 'ACCOUNT_AVAILABLE'] as const)('does not derive a link from the active-looking %s state without an allowed action', state => {
    const html = render({ state, allowed_actions: [], destination: 'INVESTMENT_ACCOUNT' })
    expect(html).not.toContain('href=')
    expect(html).not.toContain('Continue to investment-account opening')
    expect(html).not.toContain('View investment account and orders')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it.each(['REVIEWER_UNAVAILABLE', 'PROVIDER_UNSUPPORTED', 'INTAKE_NOT_ADMITTED', 'ADMISSION_EXPIRED', 'MONITORING_ON_HOLD', 'MONITORING_RENEWAL_REQUIRED', 'ACCOUNT_SUSPENDED', 'MANDATE_NOT_EFFECTIVE', 'CONTEXT_UNAVAILABLE', 'CONTEXT_NOT_SUPPORTED', 'ADMISSION_NOT_APPROVED'] as const)('never renders an operating link for blocker %s even if a stale action is supplied', blocker => {
    const html = render({ state: 'WORKSPACE_AVAILABLE', persona: 'WEALTH_MANAGER', blocker, allowed_actions: ['ENTER_OPERATING_WORKSPACE'], destination: 'OPERATING_WORKSPACE', mandate: { id: mandateId, status: 'APPLIED', effective: true }, native_context: { organisation_id: entryOrganisationId, role: 'OfferingManager' } })
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(['mailto:daniel@bx1.co.za'])
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain(`/portal?organisation=${entryOrganisationId}`)
  })
  it('does not render an unavailable-state destination even if a stale action is supplied', () => {
    const html = render({ state: 'UNAVAILABLE', allowed_actions: ['OPEN_INVESTMENT_ACCOUNT'], destination: 'INVESTMENT_ACCOUNT' })
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(['mailto:daniel@bx1.co.za'])
    expect(html).not.toContain('Continue to investment-account opening')
  })
  it('keeps wealth-manager admission separate from its representative appointment', () => {
    const html = render({ persona: 'WEALTH_MANAGER', state: 'REQUEST_MANDATE', next_owner: 'APPLICANT', allowed_actions: ['REQUEST_REPRESENTATIVE_MANDATE'], destination: 'NONE' })
    expect(html).toContain('Admission approved; representative appointment next')
    expect(html).toContain('grants no product, financial or signing powers')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it('separates account references from product eligibility, wallet authority and holdings', () => {
    const overrides: Partial<CustomerHandoff> = { state: 'ACCOUNT_AVAILABLE', allowed_actions: ['VIEW_INVESTMENT_ACCOUNT'], destination: 'INVESTMENT_ACCOUNT', accounts: [{ id: accountId, kind: 'INDIVIDUAL', status: 'ACTIVE' }] }
    const html = render(overrides)
    const history = render(overrides, 'history')
    expect(html).not.toContain(accountId)
    expect(history).toContain(accountId)
    expect(html).toContain('View investment account and orders')
    expect(html).toContain('/portal/portfolio?mode=applicant')
    expect(history).toContain('not product eligibility, wallet authority, funding or ownership')
  })
  it('retains the permitted account-opening handoff before application details', () => {
    const html = render({ state: 'OPEN_ACCOUNT', allowed_actions: ['OPEN_INVESTMENT_ACCOUNT'], destination: 'INVESTMENT_ACCOUNT' })
    const primary = html
    expect(primary).toContain('Continue to investment-account opening')
    expect(primary).toContain('/portal/portfolio?mode=applicant')
    expect(primary).toContain('An account is not a cash balance, product eligibility or token holding')
    expect(primary).not.toContain(application.id)
  })
  it('takes entity representatives to the existing mandate workflow without claiming account-instruction authority', () => {
    const html = render({ state: 'REQUEST_MANDATE', allowed_actions: ['REQUEST_INVESTING_REPRESENTATIVE_MANDATE'], destination: 'INVESTMENT_ACCOUNT', accounts: [{ id: accountId, kind: 'ENTITY', status: 'ACTIVE' }] })
    expect(html).toContain('Entity account recorded; representative appointment next')
    expect(html).toContain('Continue to entity representative appointment')
    expect(html).toContain('/portal/portfolio?mode=applicant')
    expect(html).not.toContain('View investment account and orders')
    expect(html).toContain('does not grant authority to instruct investments')
  })
  it('keeps manager admission distinct from its reviewed but unapplied appointment', () => {
    const overrides: Partial<CustomerHandoff> = { persona: 'WEALTH_MANAGER', state: 'MANDATE_APPLY_PENDING', next_owner: 'SUPER_ADMIN', allowed_actions: [], destination: 'NONE', mandate: { id: mandateId, status: 'APPROVED', effective: false } }
    const html = render(overrides)
    expect(html).not.toContain(mandateId)
    expect(render(overrides, 'history')).toContain(mandateId)
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
    expect([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1])).toEqual(['mailto:daniel@bx1.co.za'])
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('type="file"')
  })
  it('keeps the MAIN boundary visible and suppresses even stale action links', () => {
    const html = render({ environment: 'MAINNET', state: 'OPEN_ACCOUNT', allowed_actions: ['OPEN_INVESTMENT_ACCOUNT'], destination: 'INVESTMENT_ACCOUNT' })
    const primary = html
    expect(primary).toContain('MAIN admission remains unavailable')
    expect(primary).toContain('Do not submit real documents or transfer money')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('Continue to investment-account opening')
    expect(html).not.toContain('type="file"')
  })
})
