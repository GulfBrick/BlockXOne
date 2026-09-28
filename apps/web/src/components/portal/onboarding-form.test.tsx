import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import { entryApplication, entryActorId } from '@/lib/portal/entry-test-fixtures'
import { applicationDetailsSchema, type LegacyApplicationDetails, type OwnershipControlRelationship, type PortalApplication, type PortalSnapshot, type WealthManagerApplicationDetailsV2 } from '@/lib/portal/contracts'
import { ApplicationDetailsSummary, ApplicationHistoryFailureNotice, OnboardingForm, applicationFormDetails, applicationHistoryFailure, applicationNextStep, applicationSubmissionDetails, applicationSubmissionReady, applicationSubmitLabel, classifyDocumentUpload, requiredApplicationEvidence, withoutDraftEvidence } from './onboarding-form'
import { ApplicationReview } from './portal-workflows'
import { dateLabel } from './portal-primitives'

const documents = (['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] as const).map((kind, index) => ({ id: `${index + 4}4444444-4444-4444-8444-444444444444`, kind, title: `Fictional ${kind} evidence`, storage_path: `${entryActorId}/test-${index}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' as const })) satisfies NonNullable<EntryApplication['details']['documents']>
const investor = { full_name: 'Alex Example', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Fictional savings from employment income.', beneficial_owners: '', experience: 'Fictional long-term investment objectives.', documents: [documents[0]], test_data_acknowledged: true } satisfies LegacyApplicationDetails
const manager = { details_version: 2, full_name: 'Alex Representative', country: 'ZA', company_name: 'Example Advisory Test', registration_reference: 'SYNTHETIC-001', beneficial_owners: 'Fictional sole owner Alex Example has 100 percent.', business_activities: 'Fictional wealth advisory requesting fund-structuring services.', representative_position: 'Appointed representative', authority_basis: 'Fictional board mandate authorises an organisation application only.', documents, test_data_acknowledged: true } satisfies WealthManagerApplicationDetailsV2
const relationship = { id: 'f1111111-1111-4111-8111-111111111111', party_type: 'PERSON', legal_name: 'Alex Fictional Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10_000, control_basis: 'Fictional direct shareholding recorded in the synthetic register.', effective_on: '2026-09-01', change_reason: 'Initial fictional disclosure of the direct owner.', evidence_document_id: documents[2].id } satisfies OwnershipControlRelationship
const withOwnership = <T extends ReturnType<typeof applicationFormDetails>>(prepared: T): T => ({ ...prepared, ownership_control: [relationship], ownership_change_reason: 'Initial fictional beneficial-ownership disclosure.' })
const save = () => undefined
function form(overrides: Partial<EntryApplication> = {}) {
  return renderToStaticMarkup(createElement(OnboardingForm, { application: entryApplication({ review_route: 'AVAILABLE', ...overrides }), environment: 'TESTNET', onSaved: save }))
}
function reviewer(persona: PortalApplication['persona'], details: PortalApplication['details'], admissionPurpose: PortalApplication['admission_purpose'] = 'CUSTOMER_ORGANISATION_ADMISSION') {
  const application: PortalApplication = { ...entryApplication({ persona, status: 'SUBMITTED' }), details, provider_mode: 'MANUAL_TEST_REVIEW', admission_purpose: admissionPurpose }
  const snapshot: PortalSnapshot = { actor: { id: '99999999-9999-4999-8999-999999999999', email: 'reviewer@example.invalid', display_name: null, can_review: true }, applications: [application], organisations: [], products: [], subscriptions: [], events: [] }
  return renderToStaticMarkup(createElement(ApplicationReview, { application, snapshot, onSaved: save }))
}

describe('persona-specific application preparation', () => {
  it('never counts a quarantined upload as an attachable document', () => {
    expect(classifyDocumentUpload(202, { document: documents[0], validation_state: 'QUARANTINED' })).toEqual({ kind: 'QUARANTINED', document: documents[0] })
    expect(classifyDocumentUpload(201, { document: documents[0], validation_state: 'SYNTHETIC_UNSCANNED' })).toEqual({ kind: 'ATTACHABLE', document: documents[0] })
    expect(classifyDocumentUpload(202, { document: documents[0], validation_state: 'SCANNED_CLEAN' })).toBeNull()
    expect(classifyDocumentUpload(201, { document: documents[0], validation_state: 'QUARANTINED' })).toBeNull()
    expect(classifyDocumentUpload(201, { document: { ...documents[0], sha256: 'bad' }, validation_state: 'SYNTHETIC_UNSCANNED' })).toBeNull()
    const html = form({ details: investor })
    expect(html).toContain('View private scan queue')
    expect(html).toContain('Quarantined and rejected files never count as evidence')
  })
  it('retains investor questions without organisation-service questions', () => {
    const html = form()
    expect(html).toContain('Investor classification')
    expect(html).toContain('Source of funds')
    expect(html).toContain('Investment experience and objectives')
    expect(html).not.toContain('Business activities and requested services')
  })
  it('collects customer organisation and representative facts without investor questions', () => {
    const html = form({ persona: 'WEALTH_MANAGER' })
    for (const label of ['Customer organisation legal name', 'Business activities and requested services', 'Your position in the organisation', 'Basis of your representative authority']) expect(html).toContain(label)
    for (const label of ['Investor classification', 'Source of funds', 'Investment experience and objectives', 'Company / issuing entity name']) expect(html).not.toContain(label)
    expect(html).toContain('Representative identity evidence')
    expect(html).toContain('Organisation registration evidence')
    expect(html).toContain('Beneficial ownership evidence')
  })
  it('never copies old investment answers into new organisation facts', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', details: { ...investor, company_name: 'Original company' } })
    const prepared = applicationFormDetails(application)
    expect(prepared.company_name).toBe('Original company')
    expect(prepared.business_activities).toBe('')
    expect(prepared.representative_position).toBe('')
    expect(prepared.authority_basis).toBe('')
    const html = form(application)
    expect(html).toContain('Original legacy answers')
    expect(html).toContain('Legacy source-of-funds answer')
    expect(html).toContain(investor.source_of_funds)
  })
  it('upgrades a manager draft to v3 structured evidence without investor fields', () => {
    const prepared = applicationFormDetails(entryApplication({ persona: 'WEALTH_MANAGER', details: manager }))
    expect(applicationDetailsSchema.safeParse(applicationSubmissionDetails('WEALTH_MANAGER', prepared)).success).toBe(false)
    const submitted = applicationSubmissionDetails('WEALTH_MANAGER', withOwnership(prepared))
    expect(submitted).toMatchObject({ ...manager, details_version: 3, ownership_control: [relationship], ownership_change_reason: 'Initial fictional beneficial-ownership disclosure.' })
    expect(applicationDetailsSchema.safeParse(submitted).success).toBe(true)
    for (const field of ['investor_type', 'source_of_funds', 'experience']) expect(submitted).not.toHaveProperty(field)
    const investorSubmitted = applicationSubmissionDetails('INVESTOR', applicationFormDetails(entryApplication({ details: investor })))
    expect(investorSubmitted).toEqual(investor)
    expect(investorSubmitted).not.toHaveProperty('details_version')
  })
  it('requires each organisation evidence kind while preserving individual identity requirements', () => {
    expect(requiredApplicationEvidence('WEALTH_MANAGER', 'INDIVIDUAL').map(item => item.kind)).toEqual(['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'])
    expect(requiredApplicationEvidence('INVESTOR', 'ENTITY').map(item => item.kind)).toEqual(['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'])
    expect(requiredApplicationEvidence('INVESTOR', 'INDIVIDUAL').map(item => item.kind)).toEqual(['IDENTITY'])
    const prepared = applicationFormDetails(entryApplication({ persona: 'WEALTH_MANAGER', details: manager }))
    expect(applicationSubmissionReady('WEALTH_MANAGER', { ...prepared, documents: [documents[0]] }, true, false)).toBe(false)
    expect(applicationSubmissionReady('WEALTH_MANAGER', prepared, true, false)).toBe(false)
    expect(applicationSubmissionReady('WEALTH_MANAGER', withOwnership(prepared), true, false)).toBe(true)
    expect(applicationSubmissionReady('WEALTH_MANAGER', withOwnership(prepared), true, true)).toBe(false)
    expect(applicationSubmissionReady('WEALTH_MANAGER', withOwnership(prepared), false, false)).toBe(false)
  })
  it('excludes corrected draft evidence without altering submitted records or weakening the required-kind check', () => {
    const original = structuredClone(documents)
    const selected = withoutDraftEvidence(original, documents[1].id)
    expect(selected.map(document => document.kind)).toEqual(['IDENTITY', 'BENEFICIAL_OWNERS'])
    expect(original).toEqual(documents)
    const prepared = applicationFormDetails(entryApplication({ persona: 'WEALTH_MANAGER', details: manager }))
    expect(applicationSubmissionReady('WEALTH_MANAGER', { ...prepared, documents: selected }, true, false)).toBe(false)
    const html = form({ persona: 'WEALTH_MANAGER', details: manager, status: 'CHANGES_REQUIRED' })
    expect(html).toContain('Exclude from this submission')
    expect(html).toContain('Earlier versions and stored objects are not deleted; the separate upload quota still applies')
    expect(html).toContain('Submitted evidence history')
    expect(html).toContain('View submitted versions')
  })
  it('rechecks a newly staffed review route without resetting prepared draft values', () => {
    const application = entryApplication({ persona: 'WEALTH_MANAGER', review_route: 'REVIEWER_UNAVAILABLE', details: manager })
    const prepared = { ...withOwnership(applicationFormDetails(application)), business_activities: 'Unsaved fictional services clarified for the organisation.' }
    const original = structuredClone(prepared)
    expect(applicationSubmitLabel(application)).toBe('Check review route and submit')
    expect(applicationSubmissionReady('WEALTH_MANAGER', prepared, true, false)).toBe(true)
    expect(applicationSubmissionDetails('WEALTH_MANAGER', prepared)).toMatchObject({ business_activities: original.business_activities })
    expect(prepared).toEqual(original)
    expect(applicationSubmitLabel({ ...application, review_route: 'AVAILABLE' })).toBe('Submit for review')
  })
})

describe('truthful application state and handoff', () => {
  it('does not claim a draft or uploaded file is submitted', () => {
    const html = form({ details: investor })
    expect(html).toContain('Draft: not submitted')
    expect(html).toContain('There is no automatic draft save.')
    expect(html).toContain('Selected for this submission')
    expect(html).not.toContain('Submitted evidence history')
    expect(html).not.toContain('View submitted versions')
    expect(html).not.toContain('Your application is submitted at revision')
    expect(html).not.toContain('Refresh application status')
  })
  it('offers history after a submission, including when changes are requested', () => {
    for (const status of ['SUBMITTED', 'CHANGES_REQUIRED', 'APPROVED', 'REJECTED'] as const) {
      const html = form({ status, submitted_at: '2026-09-22T09:30:00Z' })
      expect(html).toContain('Submitted evidence history')
      expect(html).toContain('View submitted versions')
    }
    expect(form({ status: 'DRAFT', submitted_at: '2026-09-22T09:30:00Z' })).toContain('View submitted versions')
  })
  it('gives actionable but non-diagnostic guidance for private-history failures', () => {
    expect(applicationHistoryFailure(401)).toBe('SESSION')
    expect(applicationHistoryFailure(403)).toBe('ACCESS')
    expect(applicationHistoryFailure(404)).toBe('ACCESS')
    expect(applicationHistoryFailure(503)).toBe('UNAVAILABLE')
    for (const reason of ['SESSION', 'ACCESS', 'UNAVAILABLE'] as const) {
      const html = renderToStaticMarkup(createElement(ApplicationHistoryFailureNotice, { reason }))
      expect(html).toContain('href="/workspace/security"')
      expect(html).toContain('if authenticator verification is needed')
      expect(html).not.toContain('MFA is required')
      expect(html).not.toContain('No submitted evidence versions are recorded')
    }
    expect(renderToStaticMarkup(createElement(ApplicationHistoryFailureNotice, { reason: 'SESSION' }))).toContain('href="/login"')
    expect(renderToStaticMarkup(createElement(ApplicationHistoryFailureNotice, { reason: 'UNAVAILABLE' }))).toContain('temporary service problem')
  })
  it('describes the missing-reviewer blocker without claiming a staffed queue', () => {
    const html = form({ review_route: 'REVIEWER_UNAVAILABLE' })
    expect(html).toContain('Independent reviewer not assigned')
    expect(html).toContain('submission is unavailable until')
    expect(html).toContain('BlockXOne onboarding owner')
    expect(html).not.toContain('Awaiting an independent decision')
  })
  it('renders a submitted revision read-only with its saved evidence and next owner', () => {
    const html = form({ persona: 'WEALTH_MANAGER', details: manager, status: 'SUBMITTED', revision: 2, submitted_at: '2026-09-22T09:30:00Z', provider_mode: 'MANUAL_TEST_REVIEW' })
    expect(html).toContain('Read-only saved application, revision 2')
    expect(html).toContain('BlockXOne independent compliance review')
    expect(html).toContain(dateLabel('2026-09-22T09:30:00Z'))
    expect(html).toContain(manager.authority_basis)
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Upload private evidence')
  })
  it('reopens requested changes with the recorded rationale and explicit resubmission', () => {
    const html = form({ persona: 'WEALTH_MANAGER', status: 'CHANGES_REQUIRED', details: manager, review_notes: 'Please clarify the fictional board appointment.' })
    expect(html).toContain('Changes requested by your reviewer')
    expect(html).toContain('Please clarify the fictional board appointment.')
    expect(html).toContain('Resubmit for review')
    expect(html).toContain('<textarea')
    expect(html).not.toContain('Application submitted</strong>')
  })
  it('separates approved customer admission from operating assignment', () => {
    const html = form({ persona: 'WEALTH_MANAGER', status: 'APPROVED', details: manager, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION' })
    expect(html).toContain('Customer admission approved; operating assignment pending')
    expect(html).toContain('No product, financial or signing powers were granted')
    expect(html).not.toContain('<form')
  })
  it('keeps rejected cases read-only with decision-specific next action', () => {
    const html = form({ status: 'REJECTED', details: investor, review_notes: 'The fictional evidence does not support this request.' })
    expect(html).toContain('Application not approved')
    expect(html).toContain('A new capacity does not reverse it.')
    expect(html).toContain('The fictional evidence does not support this request.')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('Awaiting an independent decision')
  })
  it('does not infer approved or submitted state from route availability', () => {
    expect(applicationNextStep(entryApplication({ review_route: 'AVAILABLE' })).title).toBe('Draft: not submitted')
    expect(applicationNextStep(entryApplication({ status: 'SUBMITTED', review_route: 'REVIEWER_UNAVAILABLE' })).description).toContain('submitted case is preserved')
  })
})

describe('reviewer sees the same evidence and purpose as the applicant', () => {
  it('reviews WM v2 service scope and representative authority, not investor suitability', () => {
    const html = reviewer('WEALTH_MANAGER', manager)
    expect(html).toContain('Customer organisation admission')
    expect(html).toContain(manager.business_activities)
    expect(html).toContain(manager.authority_basis)
    expect(html).toContain('Submitted evidence history')
    expect(html).toContain('View submitted versions')
    expect(html).toContain('Customer business activities and requested service scope reviewed')
    expect(html).not.toContain('Investor suitability reviewed')
    expect(html).not.toContain('Source of funds')
    expect(html).toContain('Structured ownership disclosure required')
    expect(html).toContain('value="APPROVED" disabled=""')
  })
  it('allows an independent reviewer to choose approval only after exact v3 ownership evidence is submitted', () => {
    const structured = applicationSubmissionDetails('WEALTH_MANAGER', withOwnership(applicationFormDetails(entryApplication({ persona: 'WEALTH_MANAGER', details: manager }))))
    const html = reviewer('WEALTH_MANAGER', structured)
    expect(html).toContain('Disclosed ownership and control relationships')
    expect(html).toContain('100.00%')
    expect(html).not.toContain('Structured ownership disclosure required')
    expect(html).toContain('value="APPROVED"')
    expect(html).not.toContain('value="APPROVED" disabled=""')
  })
  it('sends historical entity-investor disclosure back for structured resubmission', () => {
    const html = reviewer('INVESTOR', { ...investor, investor_type: 'ENTITY', company_name: 'Synthetic Investor Entity', registration_reference: 'SYNTHETIC-ENTITY-01', beneficial_owners: 'Historical unstructured owner description.', documents }, 'INVESTOR_ADMISSION')
    expect(html).toContain('Structured ownership disclosure required')
    expect(html).toContain('value="APPROVED" disabled=""')
  })
  it('preserves investor review labels', () => {
    const html = reviewer('INVESTOR', investor, 'INVESTOR_ADMISSION')
    expect(html).toContain('Investor suitability reviewed')
    expect(html).toContain('Source of funds')
    expect(html).not.toContain('Customer business activities and requested service scope reviewed')
  })
  it('requires explicit v2 facts before approving an old pending WM case', () => {
    const html = reviewer('WEALTH_MANAGER', investor)
    expect(html).toContain('Original legacy answers')
    expect(html).toContain('Organisation facts required before approval')
    expect(html).toContain('value="APPROVED" disabled=""')
    expect(html).toContain('value="CHANGES_REQUIRED" selected=""')
  })
  it('does not silently reinterpret historical manager evidence', () => {
    const html = renderToStaticMarkup(createElement(ApplicationDetailsSummary, { persona: 'WEALTH_MANAGER', details: investor }))
    expect(html).toContain('Legacy source-of-funds answer')
    expect(html).toContain(investor.source_of_funds)
    expect(html).not.toContain('<h3>Business activities and requested services</h3>')
  })
})
