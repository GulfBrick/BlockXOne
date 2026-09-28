import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/image', () => ({ default: (props: { src: string; alt: string }) => createElement('img', { src: props.src, alt: props.alt }) }))
import { EntryScreen } from './entry-screen'
import type { EntryMandate } from '@/lib/portal/entry-contracts'
import { entryActorId, entryApplication, entryApplicationId, entryFixture, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
const release = { version: 'test', environment: 'TESTNET' as const, source: 'fixture' }
const mandateId = '66666666-6666-4666-8666-666666666666'
function mandate(change: Partial<EntryMandate> = {}): EntryMandate {
  return { id: mandateId, application_id: entryApplicationId, product_organisation_id: entryOrganisationId, native_organisation_id: null,
    applicant_user_id: entryActorId, organisation_name: 'Fictional Customer Organisation', role: 'OfferingManager', status: 'SUBMITTED', revision: 1,
    requested_until: '2099-01-01T00:00:00Z', evidence_reference: 'SYNTHETIC-APPOINTMENT-001 for test review', review_notes: null,
    reviewer_user_id: null, applied_by_user_id: null, admission_revision: 1, admission_status: 'APPROVED',
    admission_approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION',
    effective: false, next_owner: 'COMPLIANCE', can_request: false, can_review: false, can_apply: false, can_revoke: false, ...change }
}
describe('connected pending application workspaces', () => {
  it('renders the wealth-manager workspace from its saved persona, not an investor default', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([entryApplication({ persona: 'WEALTH_MANAGER' })]), release }))
    expect(html).toContain('Your organisation and representative application.')
    expect(html).toContain('Wealth managers are platform clients')
    expect(html).not.toContain('Your investor application.')
    expect(html).toContain('Active capacity:')
  })
  it('requires older users with no recorded choice to choose a capacity explicitly', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([]), release }))
    expect(html).toContain('No application type has been chosen')
    expect(html).toContain('Choose a capacity')
    expect(html).not.toContain('Your investor application.')
  })
  it('does not render test review forms on MAINNET even with misleading admission data', () => {
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture(), admission: { manual_test_review: true } }, release: { ...release, environment: 'MAINNET' } }))
    expect(html).toContain('admission pending')
    expect(html).not.toContain('Submit for review')
  })
  it('does not offer personal manual-review submission for an organisation-scoped draft', () => {
    const application = entryApplication({ context_kind: 'ORGANISATION', context_organisation_id: entryOrganisationId })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), admission: { manual_test_review: true } }, release }))
    expect(html).toContain('admission pending')
    expect(html).not.toContain('Submit for review')
  })
  it('retains role links only for the exact server-returned scope', () => {
    const initial = { ...entryFixture([]), contexts: [{ context_key: entryOrganisationId, organisation_id: entryOrganisationId, name: 'Fictional appointed organisation', roles: ['ComplianceOfficer' as const] }] }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, chooseContext: true }))
    expect(html).toContain(`organisation=${entryOrganisationId}&amp;role=ComplianceOfficer`)
    expect(html).not.toContain('role=SuperAdmin')
  })
  it('offers refresh for submitted and decided records, never while application fields are editable', () => {
    for (const status of ['SUBMITTED', 'APPROVED', 'REJECTED'] as const) {
      const initial = { ...entryFixture([entryApplication({ status, review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
      expect(renderToStaticMarkup(createElement(EntryScreen, { initial, release }))).toContain('Refresh application status')
    }
    for (const status of ['DRAFT', 'CHANGES_REQUIRED'] as const) {
      const initial = { ...entryFixture([entryApplication({ status, review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
      expect(renderToStaticMarkup(createElement(EntryScreen, { initial, release }))).not.toContain('Refresh application status')
    }
  })
  it('does not expose product-owner links after new WM customer admission even with an organisation identifier', () => {
    const initial = { ...entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).toContain('Customer admission approved; operating assignment pending')
    expect(html).not.toContain('/portal/products?mode=applicant')
    expect(html).not.toContain('Existing customer workflows')
  })
  it('preserves explicitly identified historical rehearsal links', () => {
    const initial = entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', organisation_id: entryOrganisationId, admission_purpose: 'LEGACY_REHEARSAL' })])
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).toContain('/portal/products?mode=applicant')
    expect(html).toContain('Historical rehearsal products and offerings')
  })
  it('keeps multi-capacity application selection exact while showing separate statuses', () => {
    const investor = entryApplication({ status: 'SUBMITTED' })
    const manager = entryApplication({ id: '55555555-5555-4555-8555-555555555555', persona: 'WEALTH_MANAGER', status: 'DRAFT' })
    const initial = { ...entryFixture([investor, manager]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, applicationId: manager.id }))
    expect(html).toContain('Your organisation and representative application.')
    expect(html).toContain('Draft: not submitted')
    expect(html).not.toContain('Refresh application status')
  })
  it('offers a guarded synthetic appointment request only when the backend marks the approved customer admission requestable', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', can_request_mandate: true })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [] }, release }))
    expect(html).toContain('Customer admission is recorded')
    expect(html).toContain('Request Offering Manager appointment review')
    expect(html).toContain('Synthetic appointment evidence reference')
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('/portal/products?mode=applicant')
    const unavailable = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([{ ...application, can_request_mandate: false }]), organisation_mandates: [] }, release }))
    expect(unavailable).toContain('Appointment request unavailable')
    expect(unavailable).not.toContain('Request Offering Manager appointment review')
  })
  it('keeps a pending appointment in the applicant workspace with its true next owner and no product role', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [mandate()] }, release }))
    expect(html).toContain('Independent BlockXOne Compliance Officer')
    expect(html).toContain('SYNTHETIC-APPOINTMENT-001')
    expect(html).not.toContain('Resubmit appointment request')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it('fails closed when mandate projection is absent, customer approval expired or the backend did not permit reapplication', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', can_request_mandate: true })
    const missing = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application]), release }))
    expect(missing).toContain('Mandate records unavailable')
    expect(missing).not.toContain('Request Offering Manager appointment review')
    const expired = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([{ ...application, approved_until: '2020-01-01T00:00:00Z' }]), organisation_mandates: [] }, release }))
    expect(expired).not.toContain('Request Offering Manager appointment review')
    const rejected = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [mandate({ status: 'REJECTED', can_request: false })] }, release }))
    expect(rejected).not.toContain('Renew appointment request for review')
  })
  it('offers a backend-authorised reapplication after rejection or expiry without treating old approval as a role', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    for (const status of ['REJECTED', 'APPROVED'] as const) {
      const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [mandate({ status, can_request: true, requested_until: '2020-01-01T00:00:00Z' })] }, release }))
      expect(html).toContain('Renew appointment request for review')
      expect(html).not.toContain('Open Offering Manager workspace')
    }
  })
  it('shows a changes-required resubmission but opens a role only from a matching server-returned active context', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    const changed = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [mandate({ status: 'CHANGES_REQUIRED', can_request: true, revision: 2, review_notes: 'Clarify this fictional appointment reference.' })] }, release }))
    expect(changed).toContain('Resubmit appointment request')
    expect(changed).toContain('Clarify this fictional appointment reference.')
    const applied = mandate({ status: 'APPLIED', effective: true, native_organisation_id: entryOrganisationId })
    const missingContext = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [applied] }, release }))
    expect(missingContext).toContain('Assignment not verified')
    expect(missingContext).not.toContain('Open Offering Manager workspace')
    const context = { context_key: mandateId, organisation_id: entryOrganisationId, name: 'Fictional Customer Organisation', roles: ['OfferingManager' as const] }
    const active = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [applied], contexts: [context] }, release }))
    expect(active).toContain('Open Offering Manager workspace')
    expect(active).toContain(`organisation=${entryOrganisationId}&amp;role=OfferingManager`)
  })
  it('does not expose a foreign appointment case or infer an investor relationship for a wealth-manager-only login', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    const foreign = mandate({ applicant_user_id: '88888888-8888-4888-8888-888888888888', organisation_name: 'Other organisation confidential name' })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [foreign] }, release }))
    expect(html).not.toContain('Other organisation confidential name')
    expect(html).not.toContain('Investment accounts and orders')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
})
