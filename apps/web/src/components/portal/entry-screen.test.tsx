import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('next/image', () => ({ default: (props: { src: string; alt: string }) => createElement('img', { src: props.src, alt: props.alt }) }))
import { EntryScreen } from './entry-screen'
import type { EntryApplication, EntryMandate } from '@/lib/portal/entry-contracts'
import type { CustomerHandoff } from '@/lib/portal/customer-handoff'
import { entryActorId, entryApplication, entryApplicationId, entryFixture, entryHandoff, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
const release = { version: 'test', environment: 'TESTNET' as const, source: 'fixture' }
const mandateId = '66666666-6666-4666-8666-666666666666'
describe('normal admission command projection at applicant entry', () => {
  it('does not create or submit a capacity when the current server command projection excludes it', () => {
    const initial = entryFixture([])
    initial.stage2_access = { version: 1, environment: 'TESTNET', actor_id: entryActorId, operating_context: { mode: 'APPLICANT' }, session_mode: 'TEST_PASSWORD', allowed_commands: [] }
    const html = renderToStaticMarkup(<EntryScreen initial={initial} release={release} />)
    expect(html).toContain('Capacity application unavailable')
    expect(html).not.toContain('Capacity to apply for')
    expect(html).not.toContain('Application context')
    expect(html).not.toContain('Create or continue this application')
    expect(html).not.toContain('Submit for review')
    const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? []
    expect(forms).toHaveLength(1)
    expect(forms[0]).toContain('action="/auth/logout"')
    expect(forms[0]).toContain('method="post"')
    expect(forms[0]).toMatch(/<button\b[^>]*type="submit"[^>]*>Sign out<\/button>/)
  })
  it('retains the same personal application but does not expose an unavailable submit action', () => {
    const initial = entryFixture([projectedApplication()])
    initial.stage2_access = { version: 1, environment: 'TESTNET', actor_id: entryActorId, operating_context: { mode: 'APPLICANT' }, session_mode: 'TEST_PASSWORD', allowed_commands: ['start_application'] }
    const html = renderToStaticMarkup(<EntryScreen initial={initial} release={release} />)
    expect(html).toContain('Submission action unavailable'); expect(html).toContain(entryApplicationId)
    expect(html).not.toContain('Submit application for review')
  })
  it('does not mount applicant forms for a malformed or MAIN password-admission marker', () => {
    const initial = entryFixture([])
    initial.stage2_access = { version: 1, environment: 'TESTNET', actor_id: '44444444-4444-4444-8444-444444444444', operating_context: { mode: 'APPLICANT' }, session_mode: 'TEST_PASSWORD', allowed_commands: ['start_application'] }
    expect(renderToStaticMarkup(<EntryScreen initial={initial} release={release} />)).toContain('Saved admission state unavailable')
    initial.stage2_access.actor_id = entryActorId
    expect(renderToStaticMarkup(<EntryScreen initial={initial} release={{ ...release, environment: 'MAINNET' }} />)).toContain('Saved admission state unavailable')
  })
})
function mandate(change: Partial<EntryMandate> = {}): EntryMandate {
  return { id: mandateId, application_id: entryApplicationId, product_organisation_id: entryOrganisationId, native_organisation_id: null,
    applicant_user_id: entryActorId, organisation_name: 'Fictional Customer Organisation', role: 'OfferingManager', status: 'SUBMITTED', revision: 1,
    requested_until: '2099-01-01T00:00:00Z', evidence_reference: 'SYNTHETIC-APPOINTMENT-001 for test review', review_notes: null,
    reviewer_user_id: null, applied_by_user_id: null, admission_revision: 1, admission_status: 'APPROVED',
    admission_approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION',
    effective: false, next_owner: 'COMPLIANCE', can_request: false, can_review: false, can_apply: false, can_revoke: false, ...change }
}
function projectedApplication(overrides: Partial<EntryApplication> = {}, handoff: Partial<CustomerHandoff> = {}): EntryApplication {
  const application = entryApplication({ review_route: 'AVAILABLE', ...(overrides.status === 'APPROVED' ? { provider_mode: 'MANUAL_TEST_REVIEW' as const } : {}), ...overrides })
  return { ...application, handoff: entryHandoff(application, handoff) }
}
function projectedMandate(application: EntryApplication, record: EntryMandate): EntryApplication {
  const applied = record.status === 'APPLIED' && record.effective
  const requestable = record.can_request && ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'].includes(record.status)
  return projectedApplication({ ...application, review_route: 'AVAILABLE', provider_mode: 'MANUAL_TEST_REVIEW' }, {
    state: applied ? 'WORKSPACE_AVAILABLE' : requestable ? record.status === 'CHANGES_REQUIRED' ? 'MANDATE_INFORMATION_REQUIRED' : 'REQUEST_MANDATE'
      : record.status === 'SUBMITTED' ? 'MANDATE_REVIEW_PENDING' : record.status === 'APPROVED' ? 'MANDATE_APPLY_PENDING' : 'UNAVAILABLE',
    next_owner: applied ? 'NONE' : requestable ? 'APPLICANT' : record.status === 'APPROVED' ? 'SUPER_ADMIN' : 'COMPLIANCE',
    allowed_actions: applied ? ['ENTER_OPERATING_WORKSPACE'] : requestable ? ['REQUEST_REPRESENTATIVE_MANDATE'] : [],
    mandate: { id: record.id, status: record.status, effective: record.effective },
    native_context: applied && record.native_organisation_id ? { organisation_id: record.native_organisation_id, role: 'OfferingManager' } : null,
    destination: applied ? 'OPERATING_WORKSPACE' : 'NONE',
  })
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
    expect(html).toContain('handoff unavailable')
    expect(html).not.toContain('Submit for review')
  })
  it('does not offer personal manual-review submission for an organisation-scoped draft', () => {
    const application = entryApplication({ context_kind: 'ORGANISATION', context_organisation_id: entryOrganisationId })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), admission: { manual_test_review: true } }, release }))
    expect(html).toContain('handoff unavailable')
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
    const initial = { ...entryFixture([projectedApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', review_route: 'AVAILABLE' })]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).toContain('Customer admission approved; operating assignment pending')
    expect(html).not.toContain('/portal/products?mode=applicant')
    expect(html).not.toContain('Existing customer workflows')
  })
  it('does not derive historical product authority from a legacy approval badge', () => {
    const initial = entryFixture([entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', organisation_id: entryOrganisationId, admission_purpose: 'LEGACY_REHEARSAL' })])
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, operationsAvailable: true }))
    expect(html).not.toContain('/portal/products?mode=applicant')
    expect(html).toContain('handoff unavailable')
  })
  it('keeps multi-capacity application selection exact while showing separate statuses', () => {
    const investor = entryApplication({ status: 'SUBMITTED' })
    const manager = projectedApplication({ id: '55555555-5555-4555-8555-555555555555', persona: 'WEALTH_MANAGER', status: 'DRAFT' })
    const initial = { ...entryFixture([investor, manager]), admission: { manual_test_review: true } }
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release, applicationId: manager.id }))
    expect(html).toContain('Your organisation and representative application.')
    expect(html).toContain('Draft: not submitted')
    expect(html).not.toContain('Refresh application status')
  })
  it('offers a guarded synthetic appointment request only when the backend marks the approved customer admission requestable', () => {
    const application = projectedApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', can_request_mandate: true })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [] }, release }))
    expect(html).toContain('Customer admission is recorded')
    expect(html).toContain('Request Offering Manager appointment review')
    expect(html).toContain('Synthetic appointment evidence reference')
    expect(html).not.toContain('Open Offering Manager workspace')
    expect(html).not.toContain('/portal/products?mode=applicant')
    const unavailableApplication = projectedApplication({ ...application, can_request_mandate: true }, { state: 'UNAVAILABLE', blocker: 'CONTEXT_UNAVAILABLE', next_owner: 'PROVIDER_OWNER', allowed_actions: [] })
    const unavailable = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([unavailableApplication]), organisation_mandates: [] }, release }))
    expect(unavailable).toContain('Appointment request unavailable')
    expect(unavailable).not.toContain('Request Offering Manager appointment review')
  })
  it('keeps a pending appointment in the applicant workspace with its true next owner and no product role', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    const record = mandate()
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([projectedMandate(application, record)]), organisation_mandates: [record] }, release }))
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
      const record = mandate({ status, can_request: true, requested_until: '2020-01-01T00:00:00Z' })
      const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([projectedMandate(application, record)]), organisation_mandates: [record] }, release }))
      expect(html).toContain('Renew appointment request for review')
      expect(html).not.toContain('Open Offering Manager workspace')
    }
  })
  it('shows a changes-required resubmission but opens a role only from a matching server-returned active context', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', organisation_id: entryOrganisationId, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    const changedRecord = mandate({ status: 'CHANGES_REQUIRED', can_request: true, revision: 2, review_notes: 'Clarify this fictional appointment reference.' })
    const changed = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([projectedMandate(application, changedRecord)]), organisation_mandates: [changedRecord] }, release }))
    expect(changed).toContain('Resubmit appointment request')
    expect(changed).toContain('Clarify this fictional appointment reference.')
    const applied = mandate({ status: 'APPLIED', effective: true, native_organisation_id: entryOrganisationId })
    const missingContext = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [applied] }, release }))
    expect(missingContext).toContain('Assignment not verified')
    expect(missingContext).not.toContain('Open Offering Manager workspace')
    const context = { context_key: mandateId, organisation_id: entryOrganisationId, name: 'Fictional Customer Organisation', roles: ['OfferingManager' as const] }
    const active = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([projectedMandate(application, applied)]), organisation_mandates: [applied], contexts: [context] }, release }))
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
  it('uses the validated projection rather than the legacy manual-test flag to offer the saved intake', () => {
    const application = projectedApplication({ review_route: 'AVAILABLE' })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application]), release }))
    expect(html).toContain('Draft: not submitted')
    expect(html).toContain('Submit for review')
    expect(html).toContain('Upload private evidence')
    expect(html).toContain(application.id)
  })
  it('keeps missing, stale, foreign and wrong-environment projections closed even with a legacy review flag', () => {
    const application = projectedApplication()
    for (const handoff of [undefined, { ...application.handoff!, application_revision: 2 }, { ...application.handoff!, actor_id: '88888888-8888-4888-8888-888888888888' }, { ...application.handoff!, environment: 'MAINNET' as const }]) {
      const initial = { ...entryFixture([{ ...application, handoff }]), admission: { manual_test_review: true } }
      const html = renderToStaticMarkup(createElement(EntryScreen, { initial, release }))
      expect(html).toContain('handoff unavailable')
      expect(html).not.toContain('Upload private evidence')
      expect(html).not.toContain('Submit for review')
      expect(html).not.toContain('/portal/portfolio?mode=applicant')
    }
  })
  it('shows MAIN saved progress and exact missing intake owner without a real-document input or business action', () => {
    const application = projectedApplication({}, { environment: 'MAINNET', state: 'UNAVAILABLE', next_owner: 'PROVIDER_OWNER', blocker: 'INTAKE_NOT_ADMITTED', allowed_actions: [], gates: { intake_admitted: false, reviewer_available: false, monitoring_allows_new_actions: false } })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application], 'MAINNET'), release: { ...release, environment: 'MAINNET' } }))
    expect(html).toContain('Evidence intake not admitted')
    expect(html).toContain('BlockXOne onboarding / provider owner')
    expect(html).toContain('MAIN admission remains unavailable')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Submit for review')
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
  })
  it('reopens rejected same-application preparation only for a projected reapplication action', () => {
    const application = projectedApplication({ status: 'REJECTED', revision: 4, submitted_at: '2026-09-22T09:30:00Z', review_notes: 'Clarify the source of these fictional funds.' })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application]), release }))
    expect(html).toContain('Reapply for independent review')
    expect(html).toContain('Reapplication does not reverse rejection into approval')
    expect(html).toContain('Clarify the source of these fictional funds.')
    expect(html).toContain('Saved record: revision 4')
    expect(html).toContain('View submitted versions')
    expect(html).not.toContain('Refresh application status')
    expect(html).not.toContain('/portal/portfolio?mode=applicant')
  })
  it('requires current admission and monitoring for account destinations, not an old approval badge', () => {
    const application = projectedApplication({ status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', provider_mode: 'MANUAL_TEST_REVIEW' })
    const available = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application]), release }))
    expect(available).toContain('Continue to investment-account opening')
    for (const blocker of ['ADMISSION_EXPIRED', 'MONITORING_ON_HOLD', 'MONITORING_RENEWAL_REQUIRED', 'ACCOUNT_SUSPENDED'] as const) {
      const blocked = { ...application, handoff: entryHandoff(application, { state: 'UNAVAILABLE', blocker, next_owner: 'COMPLIANCE', allowed_actions: [], destination: 'NONE', gates: { intake_admitted: true, reviewer_available: true, monitoring_allows_new_actions: false } }) }
      const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([blocked]), release }))
      expect(html).not.toContain('/portal/portfolio?mode=applicant')
      expect(html).not.toContain('type="file"')
      expect(html).not.toContain('Submit for review')
      expect(html).toContain('Independent BlockXOne Compliance Officer')
    }
  })
  it('denies stale mandate flags when the authoritative projection withholds request permission', () => {
    const application = projectedApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', can_request_mandate: true }, { state: 'UNAVAILABLE', blocker: 'MONITORING_ON_HOLD', next_owner: 'COMPLIANCE', allowed_actions: [], gates: { intake_admitted: true, reviewer_available: true, monitoring_allows_new_actions: false } })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [] }, release }))
    expect(html).toContain('Customer relationship on hold')
    expect(html).not.toContain('Request Offering Manager appointment review')
    expect(html).not.toContain('Open Offering Manager workspace')
  })
  it('takes current projected request permission over an old false can-request flag', () => {
    const application = projectedApplication({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2099-01-01T00:00:00Z', can_request_mandate: false })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([application]), organisation_mandates: [] }, release }))
    expect(html).toContain('Request Offering Manager appointment review')
    const record = mandate({ status: 'CHANGES_REQUIRED', can_request: false })
    const resubmittable = projectedMandate(application, { ...record, can_request: true })
    const changed = renderToStaticMarkup(createElement(EntryScreen, { initial: { ...entryFixture([resubmittable]), organisation_mandates: [record] }, release }))
    expect(changed).toContain('Resubmit appointment request')
  })
  it('offers a separate read-only availability refresh while preparing a draft or same-record reapplication', () => {
    for (const status of ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'] as const) {
      const application = projectedApplication({ status, review_route: 'REVIEWER_UNAVAILABLE' })
      const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([application]), release }))
      expect(html).toContain('Refresh review availability')
      expect(html).toContain('without submitting or replacing your unsaved answers')
      expect(html).toContain('check stops instead of overwriting this draft')
      expect(html).not.toContain('Refresh application status')
    }
    const submitted = projectedApplication({ status: 'SUBMITTED' })
    const html = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture([submitted]), release }))
    expect(html).toContain('Refresh application status')
    expect(html).not.toContain('Refresh review availability')
    const missing = renderToStaticMarkup(createElement(EntryScreen, { initial: entryFixture(), release }))
    expect(missing).not.toContain('Refresh review availability')
  })
})
