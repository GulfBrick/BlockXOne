import { describe, expect, it } from 'vitest'
import { entryActorId, entryApplication, entryFixture } from './entry-test-fixtures'
import { onboardingHasUnsavedAnswers, onboardingLinkDiscardsAnswers, onboardingRemainingItems, onboardingSteps, onboardingSubmissionConfirmed, type OnboardingAnswers } from './onboarding-flow'

const documents = (['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] as const).map((kind, index) => ({ id: `${index + 4}4444444-4444-4444-8444-444444444444`, kind, title: `Fictional ${kind} evidence`, storage_path: `${entryActorId}/test-${index}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' as const }))
const answers: OnboardingAnswers = {
  full_name: 'Alex Fictional', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: 'Synthetic Example Organisation', registration_reference: 'SYNTHETIC-001',
  source_of_funds: 'Fictional savings from employment income.', experience: 'Fictional long-term investment objectives.', beneficial_owners: 'Fictional sole owner has all economic ownership.',
  business_activities: 'Fictional wealth advisory requesting fund-structuring services.', representative_position: 'Appointed representative', authority_basis: 'Fictional board mandate for organisation admission only.', documents, test_data_acknowledged: true,
  ownership_control: [{ id: 'f1111111-1111-4111-8111-111111111111', party_type: 'PERSON', legal_name: 'Alex Fictional Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10_000, control_basis: 'Fictional direct ownership in synthetic register.', effective_on: '2026-09-01', change_reason: 'Initial fictional ownership relationship disclosure.', evidence_document_id: documents[2].id }],
  ownership_change_reason: 'Initial fictional ownership disclosure revision.',
}
const submittedDetails = { full_name: answers.full_name, country: answers.country, investor_type: 'INDIVIDUAL' as const, company_name: '', registration_reference: '', source_of_funds: answers.source_of_funds, experience: answers.experience, beneficial_owners: '', documents: [documents[0]], test_data_acknowledged: true as const }

describe('guided onboarding requirements', () => {
  it.each(['WEALTH_MANAGER', 'INVESTOR'] as const)('orders uploaded evidence before %s ownership linkage', persona => {
    const steps = onboardingSteps(persona, 'ENTITY').map(step => step.id)
    expect(steps).toEqual(['identity', 'organisation', 'purpose', 'evidence', 'ownership', 'review'])
    expect(steps.indexOf('evidence')).toBeLessThan(steps.indexOf('ownership'))
  })
  it('keeps an individual investor flow focused and does not require organisation authority', () => {
    expect(onboardingSteps('INVESTOR', 'INDIVIDUAL').map(step => step.id)).toEqual(['identity', 'purpose', 'evidence', 'review'])
    expect(onboardingRemainingItems('INVESTOR', { ...answers, company_name: '', registration_reference: '', beneficial_owners: '', authority_basis: '', documents: [documents[0]], ownership_control: [] }, true)).toEqual([])
  })
  it('lists every missing field, evidence kind and acknowledgement rather than a silent disabled action', () => {
    const remaining = onboardingRemainingItems('WEALTH_MANAGER', { ...answers, full_name: '', country: 'Z', company_name: '', registration_reference: '', beneficial_owners: '', business_activities: '', representative_position: '', authority_basis: '', documents: [], ownership_control: [], ownership_change_reason: '' }, false)
    expect(remaining.map(item => item.key)).toEqual(['full_name', 'country', 'company_name', 'registration_reference', 'beneficial_owners', 'business_activities', 'representative_position', 'authority_basis', 'evidence.IDENTITY', 'evidence.COMPANY', 'evidence.BENEFICIAL_OWNERS', 'ownership_control', 'ownership_change_reason', 'acknowledged'])
    expect(remaining.every(item => item.message.length > 20)).toBe(true)
  })
  it('keeps pending/rejected receipts out and detects excluded linked evidence', () => {
    expect(onboardingRemainingItems('WEALTH_MANAGER', answers, true, 1).some(item => item.key === 'pending_documents')).toBe(true)
    const excluded = { ...answers, documents: documents.filter(document => document.kind !== 'BENEFICIAL_OWNERS') }
    expect(onboardingRemainingItems('WEALTH_MANAGER', excluded, true).map(item => item.key)).toContain('evidence.BENEFICIAL_OWNERS')
    expect(onboardingRemainingItems('WEALTH_MANAGER', excluded, true).map(item => item.key)).toContain('ownership_control.0.evidence_document_id')
    const invalidReceipt = { ...answers, documents: documents.map(document => ({ ...document, sha256: 'invalid' })) }
    expect(onboardingRemainingItems('WEALTH_MANAGER', invalidReceipt, true).map(item => item.key)).toContain('documents')
    expect(onboardingRemainingItems('WEALTH_MANAGER', invalidReceipt, true).map(item => item.key)).toContain('evidence.IDENTITY')
  })
  it('reports ownership dates, percentages, duplicates and totals using existing schema boundaries', () => {
    const duplicate = { ...answers, ownership_control: [answers.ownership_control[0], { ...answers.ownership_control[0], effective_on: '2099-02-30', ownership_basis_points: 50 }] }
    const keys = onboardingRemainingItems('WEALTH_MANAGER', duplicate, true).map(item => item.key)
    expect(keys).toContain('ownership_control.1.effective_on')
    expect(keys).toContain('ownership_control.1.id')
    expect(keys).toContain('ownership_control')
    expect(onboardingRemainingItems('WEALTH_MANAGER', answers, true)).toEqual([])
  })
})

describe('unsaved answers and confirmed outcomes', () => {
  it('tracks answer, acknowledgement, upload and pending-file changes without persisting them', () => {
    expect(onboardingHasUnsavedAnswers(answers, answers, false, '', false, 0)).toBe(false)
    for (const changed of [onboardingHasUnsavedAnswers(answers, { ...answers, full_name: 'Changed fictional name' }, false, '', false, 0), onboardingHasUnsavedAnswers(answers, answers, true, '', false, 0), onboardingHasUnsavedAnswers(answers, answers, false, 'Fictional title', false, 0), onboardingHasUnsavedAnswers(answers, answers, false, '', true, 0), onboardingHasUnsavedAnswers(answers, answers, false, '', false, 1)]) expect(changed).toBe(true)
  })
  it('confirms only the exact current actor/application submitted at a later saved revision', () => {
    const application = entryApplication()
    const submitted = { ...application, details: submittedDetails, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    expect(onboardingSubmissionConfirmed(entryFixture([submitted]), application, entryActorId, submittedDetails)).toBe(true)
    for (const candidate of [{ ...submitted, status: 'DRAFT' as const }, { ...submitted, id: '88888888-8888-4888-8888-888888888888' }, { ...submitted, revision: application.revision }, { ...submitted, submitted_at: null }, { ...submitted, user_id: '88888888-8888-4888-8888-888888888888' }]) expect(onboardingSubmissionConfirmed(entryFixture([candidate]), application, entryActorId, submittedDetails)).toBe(false)
    expect(onboardingSubmissionConfirmed({ ...entryFixture([submitted]), actor: { id: '88888888-8888-4888-8888-888888888888', email: 'other@example.invalid' } }, application, entryActorId, submittedDetails)).toBe(false)
  })
  it('requires every submitted answer and evidence receipt and the original context, origin and purpose', () => {
    const application = entryApplication()
    const submitted = { ...application, details: submittedDetails, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    for (const candidate of [
      { ...submitted, details: {} },
      { ...submitted, submitted_at: 'not-a-timestamp' },
      { ...submitted, details: { ...submittedDetails, full_name: 'Another Fictional Applicant' } },
      { ...submitted, details: { ...submittedDetails, documents: [{ ...documents[0], sha256: 'b'.repeat(64) }] } },
      { ...submitted, context_kind: 'ORGANISATION' as const },
      { ...submitted, context_organisation_id: '88888888-8888-4888-8888-888888888888' },
      { ...submitted, origin: 'LEGACY' as const },
      { ...submitted, admission_purpose: 'LEGACY_REHEARSAL' as const },
    ]) expect(onboardingSubmissionConfirmed(entryFixture([candidate]), application, entryActorId, submittedDetails)).toBe(false)
    expect(onboardingSubmissionConfirmed(entryFixture([submitted]), { ...application, submitted_at: submitted.submitted_at }, entryActorId, submittedDetails)).toBe(false)
  })
  it('accepts schema text normalization and JSONB key reordering without accepting different facts', () => {
    const application = entryApplication()
    const reordered = Object.fromEntries(Object.entries({ ...submittedDetails, full_name: `  ${submittedDetails.full_name}  ` }).reverse()) as typeof submittedDetails
    reordered.documents = [Object.fromEntries(Object.entries({ ...documents[0], title: `  ${documents[0].title}  ` }).reverse()) as typeof documents[0]]
    const submitted = { ...application, details: reordered, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    expect(onboardingSubmissionConfirmed(entryFixture([submitted]), application, entryActorId, { ...submittedDetails, source_of_funds: `  ${submittedDetails.source_of_funds}  ` })).toBe(true)
  })
  it('does not block same-page anchors but warns for application, workspace and external navigation', () => {
    const current = 'https://example.invalid/portal/onboarding?application=one'
    expect(onboardingLinkDiscardsAnswers('#evidence', current)).toBe(false)
    expect(onboardingLinkDiscardsAnswers(current, current)).toBe(false)
    expect(onboardingLinkDiscardsAnswers('mailto:onboarding@example.invalid', current)).toBe(false)
    for (const href of ['/portal/onboarding?application=two', '/portal?mode=applicant', '/register', 'https://other.invalid/']) expect(onboardingLinkDiscardsAnswers(href, current)).toBe(true)
  })
})
