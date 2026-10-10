import type { EntryApplication, EntryMandate, EntrySnapshot } from './entry-contracts'
import type { CustomerHandoff } from './customer-handoff'
export const entryActorId = '11111111-1111-4111-8111-111111111111'
export const entryApplicationId = '22222222-2222-4222-8222-222222222222'
export const entryOrganisationId = '33333333-3333-4333-8333-333333333333'
export function entryMandate(overrides: Partial<EntryMandate> = {}): EntryMandate {
  return { id: '66666666-6666-4666-8666-666666666666', application_id: entryApplicationId, product_organisation_id: entryOrganisationId,
    native_organisation_id: null, applicant_user_id: entryActorId, organisation_name: 'Fictional Customer Organisation', role: 'OfferingManager', status: 'SUBMITTED', revision: 1,
    requested_until: '2027-01-01T00:00:00Z', evidence_reference: 'SYNTHETIC-APPOINTMENT-001 for test review', review_notes: null,
    reviewer_user_id: null, applied_by_user_id: null, admission_revision: 1, admission_status: 'APPROVED', admission_approved_until: '2027-01-01T00:00:00Z',
    admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', effective: false, next_owner: 'COMPLIANCE', can_request: false, can_review: false, can_apply: false, can_revoke: false, ...overrides }
}
export function entryApplication(overrides: Partial<EntryApplication> = {}): EntryApplication {
  return { id: entryApplicationId, user_id: entryActorId, persona: 'INVESTOR', status: 'DRAFT', revision: 1, details: {}, submitted_at: null, reviewed_at: null, reviewer_id: null, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'UNASSIGNED', approved_until: null, context_kind: 'PERSONAL', context_organisation_id: null, origin: 'SIGNUP', created_at: '2026-09-21T10:00:00Z', admission_purpose: overrides.persona === 'WEALTH_MANAGER' ? 'CUSTOMER_ORGANISATION_ADMISSION' : 'INVESTOR_ADMISSION', review_route: 'NOT_ADMITTED', ...overrides }
}
/** Test-only projection; never used to derive production authority. */
export function entryHandoff(application: EntryApplication, overrides: Partial<CustomerHandoff> = {}): CustomerHandoff {
  const intake = application.context_kind === 'PERSONAL' && application.review_route !== 'NOT_ADMITTED'
  const reviewer = application.review_route === 'AVAILABLE'
  const preparing = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(application.status)
  const approved = application.status === 'APPROVED' && !!application.approved_until && Date.parse(application.approved_until) > Date.now()
  const state: CustomerHandoff['state'] = !intake ? 'UNAVAILABLE' : preparing
    ? application.status === 'REJECTED' ? 'REAPPLICATION_REQUIRED' : application.status === 'CHANGES_REQUIRED' ? 'INFORMATION_REQUIRED' : 'PREPARE_APPLICATION'
    : application.status === 'SUBMITTED' ? 'REVIEW_PENDING' : approved ? application.persona === 'INVESTOR' ? 'OPEN_ACCOUNT' : 'REQUEST_MANDATE' : 'UNAVAILABLE'
  return { version: 1, environment: 'TESTNET', actor_id: application.user_id, application_id: application.id, application_revision: application.revision, persona: application.persona,
    operating_context: { mode: 'APPLICANT' }, state, next_owner: !intake ? 'PROVIDER_OWNER' : preparing || approved ? 'APPLICANT' : 'COMPLIANCE',
    blocker: !intake ? 'INTAKE_NOT_ADMITTED' : preparing && !reviewer ? 'REVIEWER_UNAVAILABLE' : application.status === 'APPROVED' && !approved ? 'ADMISSION_EXPIRED' : 'NONE',
    allowed_actions: !intake ? [] : preparing ? reviewer ? ['PREPARE_APPLICATION', 'SUBMIT_APPLICATION'] : ['PREPARE_APPLICATION']
      : approved ? application.persona === 'INVESTOR' ? ['OPEN_INVESTMENT_ACCOUNT'] : ['REQUEST_REPRESENTATIVE_MANDATE'] : [],
    gates: { intake_admitted: intake, reviewer_available: reviewer, monitoring_allows_new_actions: approved }, accounts: [], mandate: null, native_context: null,
    destination: intake && approved && application.persona === 'INVESTOR' ? 'INVESTMENT_ACCOUNT' : 'NONE', ...overrides }
}
export function entryFixture(applications: EntryApplication[] = [entryApplication()], environment: 'TESTNET' | 'MAINNET' = 'TESTNET'): EntrySnapshot {
  return { entry_version: 1, actor: { id: entryActorId, email: 'synthetic@example.invalid' }, applications, contexts: [], admission: { manual_test_review: false },
    workflow: { version: 1, environment, actor_id: entryActorId, scoped_read_available: environment === 'TESTNET' } }
}
