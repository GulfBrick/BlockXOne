import { describe, expect, it } from 'vitest'
import { parseSyntheticComplianceSnapshot } from './synthetic-compliance-contracts'
import type { PortalOperatingContext } from './operating-context'

export const reviewer = '11111111-1111-4111-8111-111111111111'
export const applicant = '22222222-2222-4222-8222-222222222222'
export const applicationId = '33333333-3333-4333-8333-333333333333'
export const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId: '44444444-4444-4444-8444-444444444444', role: 'ComplianceOfficer' }
export function syntheticSnapshot() {
  return { rehearsal: { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: reviewer, operating_context: reviewContext },
    actor: { id: reviewer, email: 'reviewer@example.invalid', display_name: null, can_review: true }, operating_context: reviewContext,
    applications: [{ id: applicationId, user_id: applicant, persona: 'INVESTOR', status: 'SUBMITTED', revision: 2,
      details: { full_name: 'Fictional Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Synthetic savings for this rehearsal only.', beneficial_owners: '', experience: 'Fictional experienced investor.',
        documents: [{ id: '55555555-5555-4555-8555-555555555555', kind: 'IDENTITY', title: 'Fictional identity manifest', storage_path: `${applicant}/55555555-5555-4555-8555-555555555555`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }], test_data_acknowledged: true },
      submitted_at: '2026-10-10T12:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null, admission_purpose: 'INVESTOR_ADMISSION' }],
    organisations: [], products: [], subscriptions: [], events: [], requests: [] }
}
describe('restricted synthetic Compliance envelope', () => {
  it('admits only exact actor, selected context and typed synthetic facts', () => {
    const value = syntheticSnapshot()
    expect(parseSyntheticComplianceSnapshot(value, reviewer, reviewContext)).toEqual(value)
  })
  it.each(['accounts', 'funding', 'organisation_mandates', 'customer_monitoring', 'provider_evidence'])('rejects added protected %s even when empty', field => {
    expect(parseSyntheticComplianceSnapshot({ ...syntheticSnapshot(), [field]: [] }, reviewer, reviewContext)).toBeNull()
  })
  it.each(['organisations', 'products', 'subscriptions'])('rejects nonempty %s', field => {
    expect(parseSyntheticComplianceSnapshot({ ...syntheticSnapshot(), [field]: [{}] }, reviewer, reviewContext)).toBeNull()
  })
  it('rejects missing, forged or mainnet markers', () => {
    const value = syntheticSnapshot()
    for (const marker of [undefined, { ...value.rehearsal, environment: 'MAINNET' }, { ...value.rehearsal, actor_id: applicant }, { ...value.rehearsal, verified_mfa: true }]) {
      expect(parseSyntheticComplianceSnapshot({ ...value, rehearsal: marker }, reviewer, reviewContext)).toBeNull()
    }
  })
  it('rejects personal, wrong organisation or different role contexts', () => {
    for (const context of [{ mode: 'APPLICANT' }, { ...reviewContext, organisationId: applicant }, { ...reviewContext, role: 'SuperAdmin' }] as PortalOperatingContext[]) expect(parseSyntheticComplianceSnapshot(syntheticSnapshot(), reviewer, context)).toBeNull()
  })
  it('rejects self review, duplicate cases and nonsynthetic details', () => {
    const value = syntheticSnapshot(), app = value.applications[0]
    for (const applications of [[{ ...app, user_id: reviewer }], [app, app], [{ ...app, details: { ...app.details, test_data_acknowledged: false } }]]) expect(parseSyntheticComplianceSnapshot({ ...value, applications }, reviewer, reviewContext)).toBeNull()
  })
  it.each(['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'])('retains the saved %s result', status => {
    const value = syntheticSnapshot()
    expect(parseSyntheticComplianceSnapshot({ ...value, applications: [{ ...value.applications[0], status, reviewed_at: '2026-10-10T12:01:00Z', reviewer_id: reviewer, review_notes: 'Fictional submission reviewed for this rehearsal only.', approved_until: status === 'APPROVED' ? '2026-11-09T12:01:00Z' : null, review_checks: { identity: true, ownership: true, screening: true, suitability: true } }] }, reviewer, reviewContext)).not.toBeNull()
  })
  it('rejects an approval without an actual decision receipt or checks', () => {
    const value = syntheticSnapshot()
    expect(parseSyntheticComplianceSnapshot({ ...value, applications: [{ ...value.applications[0], status: 'APPROVED' }] }, reviewer, reviewContext)).toBeNull()
  })
  it('rejects unrelated audit records and nonreview request keys', () => {
    const value = syntheticSnapshot()
    const event = { id: applicant, subject_id: applicationId, kind: 'review_application', actor_id: reviewer, created_at: '2026-10-10T12:00:00Z', summary: 'Synthetic review only.' }
    expect(parseSyntheticComplianceSnapshot({ ...value, events: [event] }, reviewer, reviewContext)).not.toBeNull()
    expect(parseSyntheticComplianceSnapshot({ ...value, events: [{ ...event, subject_id: applicant }] }, reviewer, reviewContext)).toBeNull()
    expect(parseSyntheticComplianceSnapshot({ ...value, requests: [{ key: applicant, command: 'reconcile_funding' }] }, reviewer, reviewContext)).toBeNull()
  })
})
