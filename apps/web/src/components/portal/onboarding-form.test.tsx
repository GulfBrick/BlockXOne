// @vitest-environment jsdom

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntryApplication, EntrySnapshot } from '@/lib/portal/entry-contracts'
import { entryApplication, entryActorId, entryFixture, entryHandoff } from '@/lib/portal/entry-test-fixtures'
import { applicationDetailsSchema, type LegacyApplicationDetails, type OwnershipControlRelationship, type PortalApplication, type PortalSnapshot, type WealthManagerApplicationDetailsV2 } from '@/lib/portal/contracts'
import { ApplicationDetailsSummary, ApplicationHistoryFailureNotice, OnboardingForm, applicationFormDetails, applicationHistoryFailure, applicationNextStep, applicationSubmissionDetails, applicationSubmissionReady, applicationSubmitLabel, classifyDocumentUpload, requiredApplicationEvidence, withoutDraftEvidence } from './onboarding-form'
import { ApplicationReview } from './portal-workflows'
import { dateLabel } from './portal-primitives'
import { PortalIdentityProvider } from './portal-client'
import { onboardingHistoryUnavailableMessage, type OnboardingHistoryEntry, type OnboardingNavigation } from '@/lib/portal/onboarding-flow'

// Isolate the presentation at the unchanged command-hook boundary. Existing
// entry-client tests separately exercise server receipts and idempotency.
const boundary = vi.hoisted(() => ({ submit: vi.fn(async () => false), unknown: false, onSaved: undefined as undefined | ((snapshot: EntrySnapshot) => void) }))
vi.mock('./entry-client', () => ({ useEntryCommand: (_actor: string, _environment: string, onSaved: (snapshot: EntrySnapshot) => void) => {
  boundary.onSaved = onSaved
  return { busy: false, unknown: boundary.unknown, message: '', submit: boundary.submit, retry: async () => false }
} }))
// Existing submission/navigation proofs isolate the new save boundary. The
// draft-client suite independently exercises real loading, receipts and retries.
const draftBoundary = vi.hoisted(() => ({ status: 'UNAVAILABLE', loading: false, busy: false, available: false, saved: false, dirty: false, message: '', revision: 0, save: vi.fn(async () => false), recover: vi.fn(async (_confirm: () => boolean) => false), onResume: undefined as undefined | Parameters<typeof import('./application-draft-client').useApplicationDraft>[0]['onResume'] }))
vi.mock('./application-draft-client', async importOriginal => ({ ...await importOriginal<typeof import('./application-draft-client')>(), useApplicationDraft: (options: Parameters<typeof import('./application-draft-client').useApplicationDraft>[0]) => { draftBoundary.onResume = options.onResume; return draftBoundary } }))

let originalNavigation: PropertyDescriptor | undefined
let originalHistory: { state: unknown; href: string }
let removeHistoryModel: (() => void) | null = null
beforeEach(() => { boundary.submit.mockReset(); boundary.submit.mockResolvedValue(false); boundary.unknown = false; boundary.onSaved = undefined; Object.assign(draftBoundary, { status: 'UNAVAILABLE', loading: false, busy: false, available: false, saved: false, dirty: false, message: '', revision: 0, onResume: undefined }); draftBoundary.save.mockReset(); draftBoundary.save.mockResolvedValue(false); draftBoundary.recover.mockReset(); draftBoundary.recover.mockResolvedValue(false); sessionStorage.clear(); localStorage.clear(); originalNavigation = Object.getOwnPropertyDescriptor(window, 'navigation'); originalHistory = { state: window.history.state, href: window.location.href } })
afterEach(() => { cleanup(); removeHistoryModel?.(); removeHistoryModel = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); if (originalNavigation) Object.defineProperty(window, 'navigation', originalNavigation); else Reflect.deleteProperty(window, 'navigation'); History.prototype.replaceState.call(window.history, originalHistory.state, '', originalHistory.href) })

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
  it.each(['INVESTOR', 'WEALTH_MANAGER'] as const)('connects the admitted %s draft to manual sandbox KYC without changing submission authority', persona => {
    const application = entryApplication({ persona, review_route: 'AVAILABLE' })
    const html = renderToStaticMarkup(createElement(OnboardingForm, {
      application, environment: 'TESTNET', onSaved: save, handoff: entryHandoff(application),
    }))
    expect(html).toContain('KYC placeholder · manual sandbox review')
    expect(html).toContain('View recorded provider evidence')
    expect(html).not.toContain('Start sandbox identity check')
    expect(html).toContain('fictional test data')
    expect(html).toContain('An independent reviewer must make the decision')
    expect(html).toContain('disabled=""')
  })

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
    expect(html).toContain('Draft · Not submitted')
    expect(html).toContain('New changes are not saved')
    expect(html).not.toContain('Save and exit')
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
  it('uses projected rejected reapplication while preserving the decision and same saved reference', () => {
    const application = entryApplication({ status: 'REJECTED', review_route: 'AVAILABLE', details: investor, revision: 4, submitted_at: '2026-09-22T09:30:00Z', review_notes: 'Clarify the source of these fictional funds.' })
    const handoff = entryHandoff(application)
    const html = renderToStaticMarkup(createElement(OnboardingForm, { application, handoff, environment: 'TESTNET', onSaved: save }))
    expect(html).toContain('Reapply for independent review')
    expect(html).toContain('Reapplication does not reverse rejection into approval')
    expect(html).toContain('Clarify the source of these fictional funds.')
    expect(html).toContain(application.id)
    expect(html).toContain('Saved record: revision 4')
    expect(html).toContain('View submitted versions')
    expect(html).toContain('<textarea')
  })
  it('keeps projected missing-reviewer preparation unsaved and submission disabled', () => {
    const application = entryApplication({ review_route: 'REVIEWER_UNAVAILABLE', details: investor })
    const handoff = entryHandoff(application)
    const html = renderToStaticMarkup(createElement(OnboardingForm, { application, handoff, environment: 'TESTNET', onSaved: save }))
    expect(html).toContain('Independent reviewer not assigned')
    expect(html).toContain('Submission remains disabled')
    expect(html).toContain('Submission unavailable; review route required')
    expect(html).toContain('<textarea')
    expect(html).not.toContain('Check review route and submit')
  })
  it('does not allow editing or provider-start actions for a projected monitoring hold', () => {
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const handoff = entryHandoff(application, { state: 'UNAVAILABLE', blocker: 'MONITORING_ON_HOLD', next_owner: 'COMPLIANCE', allowed_actions: [], gates: { intake_admitted: true, reviewer_available: true, monitoring_allows_new_actions: false } })
    const html = renderToStaticMarkup(createElement(OnboardingForm, { application, handoff, environment: 'TESTNET', onSaved: save }))
    expect(html).toContain('Customer relationship on hold')
    expect(html).toContain('Read-only saved application')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Sumsub sandbox')
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

function mountedForm(application: EntryApplication, onSaved = vi.fn(), onDirtyChange = vi.fn()) {
  const view = render(
    <PortalIdentityProvider actorId={entryActorId} environment="TESTNET">
      <div>
        <a href="/portal/onboarding?application=other" onClick={event => event.preventDefault()}>Switch application</a>
        <a href="#same-page">Same-page section</a>
        <form action="/auth/logout" method="post" onSubmit={event => event.preventDefault()}><button type="submit">Sign out</button></form>
        <form data-onboarding-discard="true" onSubmit={event => { event.preventDefault(); boundary.submit() }}><button type="submit">Create another application</button></form>
        <OnboardingForm application={application} environment="TESTNET" onSaved={onSaved} onDirtyChange={onDirtyChange} handoff={entryHandoff(application)} />
      </div>
    </PortalIdentityProvider>,
  )
  return { ...view, onSaved, onDirtyChange }
}
function next() { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) }
function back() { fireEvent.click(screen.getByRole('button', { name: 'Back' })) }
function reviewAndAcknowledge() {
  fireEvent.click(screen.getByRole('button', { name: 'View remaining items' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this application and all evidence are fictional test data/ }))
}
function unloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('draft reliability in the applicant form', () => {
  it('locks inputs while the initial saved draft loads, without claiming Saved', () => {
    Object.assign(draftBoundary, { status: 'LOADING', loading: true })
    mountedForm(entryApplication({ review_route: 'AVAILABLE' }))
    expect(screen.getByLabelText(/^Full name/).matches(':disabled')).toBe(true)
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('Saved', { exact: true })).toBeNull()
  })
  it('retains answers and navigation warnings when Save and exit fails', async () => {
    Object.assign(draftBoundary, { status: 'READY', available: true, dirty: true })
    mountedForm(entryApplication({ review_route: 'AVAILABLE' }))
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Keep this applicant answer' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save and exit' })) })
    expect(draftBoundary.save).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe('Keep this applicant answer')
    expect(unloadPrevented()).toBe(true); expect(screen.queryByText('Saved', { exact: true })).toBeNull()
  })
  it('does not advance Continue when an admitted draft save fails', async () => {
    Object.assign(draftBoundary, { status: 'READY', available: true, dirty: true })
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    expect(draftBoundary.save).toHaveBeenCalledTimes(1); expect(screen.getByRole('heading', { name: 'Investor details' })).toBeTruthy()
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('advances a valid section after its current draft save confirms, without submitting it', async () => {
    Object.assign(draftBoundary, { status: 'READY', available: true, saved: true })
    draftBoundary.save.mockResolvedValue(true)
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
    expect(screen.getByRole('heading', { name: 'Funds and objectives' })).toBeTruthy(); expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('protects an unfinished country search even when other answers are saved', () => {
    Object.assign(draftBoundary, { status: 'READY', available: true, saved: true })
    mountedForm(entryApplication({ review_route: 'AVAILABLE' }))
    const input = screen.getByRole('combobox', { name: 'Country of residence *' })
    fireEvent.change(input, { target: { value: 'Zimb' } })
    expect(screen.getByRole('combobox', { name: 'Country of residence *' })).toBe(input)
    expect(screen.queryByRole('button', { name: 'Save and exit' })).toBeNull(); expect(screen.queryByText('Saved', { exact: true })).toBeNull()
    expect(unloadPrevented()).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' }); expect((input as HTMLInputElement).value).toBe('Zimbabwe')
    expect(screen.getByRole('button', { name: 'Save and exit' })).toBeTruthy()
  })
  it('freezes manual Continue edits and Back until the exact save resolves, without submitting', async () => {
    Object.assign(draftBoundary, { status: 'READY', available: true })
    draftBoundary.save.mockResolvedValueOnce(true)
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    await act(async () => { next() })
    let resolve!: (saved: boolean) => void
    draftBoundary.save.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const input = screen.getByRole('textbox', { name: /^Source of funds/ }) as HTMLTextAreaElement
    expect(input.matches(':disabled')).toBe(true)
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '' } }); back()
    expect(input.value).toBe(investor.source_of_funds); expect(screen.getByRole('heading', { name: 'Funds and objectives' })).toBeTruthy()
    await act(async () => { resolve(true) })
    expect(screen.getByRole('heading', { name: 'Supporting evidence' })).toBeTruthy(); expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('keeps conflict and recovery navigation warnings even when the retained answers match an old record', () => {
    Object.assign(draftBoundary, { status: 'CONFLICT', available: true, dirty: true })
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const view = mountedForm(application)
    expect(unloadPrevented()).toBe(true)
    Object.assign(draftBoundary, { status: 'LOADING', available: false, loading: true })
    view.rerender(<PortalIdentityProvider actorId={entryActorId} environment="TESTNET"><OnboardingForm application={application} environment="TESTNET" onSaved={save} handoff={entryHandoff(application)} /></PortalIdentityProvider>)
    expect(unloadPrevented()).toBe(true)
  })
  it('asks before recovery and resets unfinished search only on exact resume', async () => {
    Object.assign(draftBoundary, { status: 'CONFLICT', available: true, dirty: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    draftBoundary.recover.mockImplementation(async decision => decision())
    mountedForm(entryApplication({ review_route: 'AVAILABLE' }))
    const input = screen.getByRole('combobox', { name: 'Country of residence *' })
    fireEvent.change(input, { target: { value: 'Zimb' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load saved draft' })) })
    expect(confirm).toHaveBeenCalledTimes(1); expect((input as HTMLInputElement).value).toBe('Zimb')
    const { test_data_acknowledged: _acknowledgement, ...restored } = applicationFormDetails(entryApplication({ details: { ...investor, country: '' } }))
    act(() => { draftBoundary.onResume!(restored, 'identity') })
    expect((screen.getByRole('combobox', { name: 'Country of residence *' }) as HTMLInputElement).value).toBe('')
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('keeps the final submission in the same shared primary-action row as Back', () => {
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    reviewAndAcknowledge()
    const submit = screen.getByRole('button', { name: 'Submit for review' })
    expect(submit.parentElement).toBe(screen.getByRole('button', { name: 'Back' }).parentElement)
    expect(submit.getAttribute('type')).toBe('submit')
  })
})

describe('guided onboarding interaction at the existing command boundary', () => {
  it('validates the current step, focuses the missing answer and never submits from Next', () => {
    mountedForm(entryApplication({ review_route: 'AVAILABLE' }))
    next()
    const fullName = screen.getByRole('textbox', { name: /^Full name/ })
    expect(screen.getByRole('alert').textContent).toContain('Full name: enter 2-120 characters.')
    expect(fullName.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(fullName)
    expect(screen.getByRole('heading', { name: 'Investor details' })).toBeTruthy()
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('retains investor answers on actual Back/Next and keeps inactive steps out of keyboard and accessible-role navigation', () => {
    const { onDirtyChange } = mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    const fullName = screen.getByRole('textbox', { name: /^Full name/ }) as HTMLInputElement
    expect(screen.queryByRole('textbox', { name: /^Source of funds/ })).toBeNull()
    fireEvent.change(fullName, { target: { value: 'Alex Changed Fictional Name' } })
    next()
    const funds = screen.getByRole('textbox', { name: /^Source of funds/ }) as HTMLTextAreaElement
    fireEvent.change(funds, { target: { value: 'Fictional savings clarified during this browser session.' } })
    back()
    expect(screen.getByRole('textbox', { name: /^Full name/ })).toBe(fullName)
    expect(fullName.value).toBe('Alex Changed Fictional Name')
    next()
    expect((screen.getByRole('textbox', { name: /^Source of funds/ }) as HTMLTextAreaElement).value).toBe('Fictional savings clarified during this browser session.')
    next()
    expect(screen.getByRole('heading', { name: 'Supporting evidence' })).toBeTruthy()
    next()
    expect(screen.getByRole('heading', { name: 'Check and submit' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm this application and all evidence are fictional test data/ }))
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(false)
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it.each(['WEALTH_MANAGER', 'INVESTOR'] as const)('guides the %s entity through evidence before relationship linkage, preserving Back/Next edits', persona => {
    const prepared = persona === 'WEALTH_MANAGER' ? applicationFormDetails(entryApplication({ persona, details: manager })) : applicationFormDetails(entryApplication({ details: { ...investor, investor_type: 'ENTITY', company_name: manager.company_name, registration_reference: manager.registration_reference, beneficial_owners: manager.beneficial_owners, documents } }))
    mountedForm(entryApplication({ persona, review_route: 'AVAILABLE', details: applicationDetailsSchema.parse(applicationSubmissionDetails(persona, withOwnership(prepared))) }))
    next(); next(); next()
    expect(screen.getByRole('heading', { name: 'Supporting evidence' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Evidence type' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Linked ownership evidence' })).toBeNull()
    next()
    expect(screen.getByRole('heading', { name: 'Ownership and control' })).toBeTruthy()
    const link = screen.getByRole('combobox', { name: 'Linked ownership evidence' }) as HTMLSelectElement
    expect(link.value).toBe(documents[2].id)
    const name = screen.getByRole('textbox', { name: 'Legal name' }) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Alex Revised Fictional Owner' } })
    back(); next()
    expect(screen.getByRole('textbox', { name: 'Legal name' })).toBe(name)
    expect(name.value).toBe('Alex Revised Fictional Owner')
    expect((screen.getByRole('combobox', { name: 'Linked ownership evidence' }) as HTMLSelectElement).value).toBe(documents[2].id)
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('offers a complete remaining-items list and a direct correction path before final submission', () => {
    mountedForm(entryApplication({ persona: 'WEALTH_MANAGER', review_route: 'AVAILABLE' }))
    fireEvent.click(screen.getByRole('button', { name: 'View remaining items' }))
    expect(screen.getByRole('heading', { name: /remaining items before submission/ })).toBeTruthy()
    for (const label of ['Representative full name', 'Customer organisation legal name', 'Business activities and requested services', 'Representative identity evidence', 'Organisation registration evidence', 'Beneficial ownership evidence']) expect(screen.getByRole('button', { name: new RegExp(`^${label}:`) })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^Business activities and requested services:/ }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /^Business activities and requested services/ }))
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it('keeps quarantined and then rejected uploads out of evidence requirements and submission', async () => {
    const pending = { ...documents[0], id: '77777777-7777-4777-8777-777777777777', title: 'Fictional pending identity' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/portal/documents' && init?.method === 'POST') return new Response(JSON.stringify({ document: pending, validation_state: 'QUARANTINED' }), { status: 202 })
      if (input === '/api/portal/documents?queue=1') return new Response(JSON.stringify({ documents: [{ id: pending.id, kind: pending.kind, title: pending.title, state: 'REJECTED', created_at: '2026-10-12T10:00:00Z' }] }), { status: 200 })
      throw new Error('Unexpected network request in isolated fictional scan test.')
    })
    vi.stubGlobal('fetch', fetchMock)
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    next(); next()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from this submission' }))
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: pending.title } })
    fireEvent.change(screen.getByLabelText('Choose fictional evidence'), { target: { files: [new File(['fictional test evidence'], 'synthetic.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload private evidence' }))
    await waitFor(() => expect(screen.getByText(/File quarantined for an independent scan/)).toBeTruthy())
    next()
    expect(screen.getByRole('alert').textContent).toContain('still awaits a clean receipt or exclusion')
    expect(screen.getByRole('heading', { name: 'Supporting evidence' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View private scan queue' }))
    await waitFor(() => expect(screen.getByText('Rejected by scan; upload a different file')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Include clean file' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View remaining items' }))
    expect(screen.getByRole('button', { name: /^Identity evidence: upload and select/ })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(boundary.submit).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not attach a supposedly clean scan whose checked receipt mismatches the selected file', async () => {
    const selected = { ...documents[0], id: '77777777-7777-4777-8777-777777777777', title: 'Fictional clean identity' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/portal/documents?queue=1') return new Response(JSON.stringify({ documents: [{ id: selected.id, kind: selected.kind, title: selected.title, state: 'SCANNED_CLEAN', created_at: '2026-10-12T10:00:00Z' }] }), { status: 200 })
      if (input === `/api/portal/documents?status=${selected.id}`) return new Response(JSON.stringify({ id: selected.id, state: 'SCANNED_CLEAN', document: { ...selected, title: 'Mismatched fictional title' } }), { status: 200 })
      throw new Error('Unexpected network request in isolated receipt-match test.')
    })
    vi.stubGlobal('fetch', fetchMock)
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    next(); next()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from this submission' }))
    fireEvent.click(screen.getByRole('button', { name: 'View private scan queue' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Include clean file' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Include clean file' }))
    await waitFor(() => expect(screen.getByText('The scanned file receipt does not match the selected document.')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'View remaining items' }))
    expect(screen.getByRole('button', { name: /^Identity evidence: upload and select/ })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(boundary.submit).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('cancels same-tab application navigation, sign-out and new-application submission without discarding or posting', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    const name = screen.getByRole('textbox', { name: /^Full name/ }) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Alex Unsaved Fictional Name' } })
    expect(unloadPrevented()).toBe(true)
    expect(fireEvent.click(screen.getByRole('link', { name: 'Switch application' }))).toBe(false)
    fireEvent.submit(screen.getByRole('button', { name: 'Sign out' }).closest('form')!)
    fireEvent.submit(screen.getByRole('button', { name: 'Create another application' }).closest('form')!)
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(name.value).toBe('Alex Unsaved Fictional Name')
    expect(boundary.submit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Same-page section' }))
    expect(confirm).toHaveBeenCalledTimes(3)
  })
  it.each(['failure', 'unknown'] as const)('retains unsaved warning after %s command completion', async outcome => {
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    reviewAndAcknowledge()
    boundary.unknown = outcome === 'unknown'
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(boundary.submit).toHaveBeenCalledOnce())
    expect(unloadPrevented()).toBe(true)
  })
  it.each(['wrong status', 'wrong application', 'same revision', 'empty answers', 'different answer', 'different evidence', 'context kind', 'context organisation', 'origin', 'admission purpose', 'invalid timestamp'] as const)('does not propagate or clear dirty answers for a truthy command with %s in its returned snapshot', async mismatch => {
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const saved = { ...application, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    const returned: EntryApplication = { ...saved }
    if (mismatch === 'wrong status') returned.status = 'DRAFT'
    if (mismatch === 'wrong application') returned.id = '88888888-8888-4888-8888-888888888888'
    if (mismatch === 'same revision') returned.revision = application.revision
    if (mismatch === 'empty answers') returned.details = {}
    if (mismatch === 'different answer') returned.details = { ...investor, full_name: 'Different Fictional Applicant' }
    if (mismatch === 'different evidence') returned.details = { ...investor, documents: [{ ...documents[0], sha256: 'b'.repeat(64) }] }
    if (mismatch === 'context kind') returned.context_kind = 'ORGANISATION'
    if (mismatch === 'context organisation') returned.context_organisation_id = '88888888-8888-4888-8888-888888888888'
    if (mismatch === 'origin') returned.origin = 'LEGACY'
    if (mismatch === 'admission purpose') returned.admission_purpose = 'LEGACY_REHEARSAL'
    if (mismatch === 'invalid timestamp') returned.submitted_at = 'not-a-timestamp'
    boundary.submit.mockImplementation(async () => { boundary.onSaved?.(entryFixture([returned])); return true })
    const { onSaved } = mountedForm(application)
    reviewAndAcknowledge()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(screen.getByText('Application submission not confirmed')).toBeTruthy())
    expect(onSaved).not.toHaveBeenCalled()
    expect(unloadPrevented()).toBe(true)
    expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe(investor.full_name)
  })
  it('releases the warning only after the exact submitted application is confirmed and preserves the original command/payload', async () => {
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const submitted = { ...application, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    boundary.submit.mockImplementation(async () => { boundary.onSaved?.(entryFixture([submitted])); return true })
    const { onSaved, onDirtyChange } = mountedForm(application)
    reviewAndAcknowledge()
    expect(unloadPrevented()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(entryFixture([submitted])))
    expect(boundary.submit).toHaveBeenCalledWith('submit_application', { application_id: application.id, expected_revision: application.revision, details: investor })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(unloadPrevented()).toBe(false)
  })
  it('binds confirmation to edited answers actually sent, not the old saved application details', async () => {
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const staleContent = { ...application, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    boundary.submit.mockImplementation(async () => { boundary.onSaved?.(entryFixture([staleContent])); return true })
    const { onSaved } = mountedForm(application)
    fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: 'Alex Edited Current Request' } })
    reviewAndAcknowledge()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(screen.getByText('Application submission not confirmed')).toBeTruthy())
    expect(boundary.submit).toHaveBeenCalledWith('submit_application', { application_id: application.id, expected_revision: application.revision, details: { ...investor, full_name: 'Alex Edited Current Request' } })
    expect(onSaved).not.toHaveBeenCalled()
    expect((screen.getByLabelText(/^Full name/) as HTMLInputElement).value).toBe('Alex Edited Current Request')
    expect(unloadPrevented()).toBe(true)
  })
  it('accepts the normalized edited payload returned by the existing schema-aware command hook', async () => {
    const application = entryApplication({ review_route: 'AVAILABLE', details: investor })
    const submitted = { ...application, details: { ...investor, full_name: 'Alex Edited Current Request' }, status: 'SUBMITTED' as const, revision: application.revision + 1, submitted_at: '2026-10-12T10:00:00Z' }
    boundary.submit.mockImplementation(async () => { boundary.onSaved?.(entryFixture([submitted])); return true })
    const { onSaved } = mountedForm(application)
    fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: '  Alex Edited Current Request  ' } })
    reviewAndAcknowledge()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(entryFixture([submitted])))
    expect(boundary.submit).toHaveBeenCalledWith('submit_application', { application_id: application.id, expected_revision: application.revision, details: { ...investor, full_name: '  Alex Edited Current Request  ' } })
    expect(unloadPrevented()).toBe(false)
  })
})

type ModeledEntry = OnboardingHistoryEntry & { url: string; state: { __NA: boolean; __PRIVATE_NEXTJS_INTERNALS_TREE: string[] } }
/**
 * Isolated browser event model, not hosted-browser proof: commits are modeled
 * with the native prototype solely so spies can detect any writes by the guard.
 * Existing entry objects and their forward trail are never recreated by it.
 */
class NavigationModel extends EventTarget implements OnboardingNavigation {
  currentEntry: ModeledEntry
  readonly entries: ModeledEntry[]
  traverseTo = vi.fn((key: string): { committed: Promise<unknown>; finished: Promise<unknown> } => {
    this.attempt(key, true)
    return { committed: Promise.resolve(), finished: Promise.resolve() }
  })
  constructor() {
    super()
    const url = (path: string) => new URL(path, window.location.origin).href
    this.entries = [
      { key: 'previous-entry', index: 0, url: url('/portal/portfolio'), state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['previous'] } },
      { key: 'original-entry', index: 1, url: url('/portal/onboarding?application=one'), state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['original'] } },
      { key: 'forward-entry', index: 2, url: url('/portal/onboarding?application=other'), state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['forward'] } },
      { key: 'hash-entry', index: 3, url: url('/portal/onboarding?application=one#evidence'), state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['original'] } },
    ]
    this.currentEntry = this.entries[1]
    this.commit(this.currentEntry)
  }
  private commit(entry: ModeledEntry) {
    this.currentEntry = entry
    History.prototype.replaceState.call(window.history, entry.state, '', entry.url)
  }
  attempt(key: string, cancelable: boolean, sameDocument = true): Event {
    const destination = this.entries.find(entry => entry.key === key)!
    const event = new Event('navigate', { cancelable })
    Object.defineProperties(event, { navigationType: { value: 'traverse' }, destination: { value: { key: destination.key, index: destination.index, url: destination.url, sameDocument } } })
    this.dispatchEvent(event)
    if (!event.defaultPrevented) { this.commit(destination); window.dispatchEvent(new PopStateEvent('popstate', { state: destination.state })) }
    return event
  }
}
function historyModel() {
  const navigation = new NavigationModel()
  Object.defineProperty(window, 'navigation', { value: navigation, configurable: true })
  const nextRoute = vi.fn()
  // Model the exact Next 15 registration phase: a noncapture window listener
  // registered before the mounted applicant component.
  window.addEventListener('popstate', nextRoute)
  removeHistoryModel = () => window.removeEventListener('popstate', nextRoute)
  return { navigation, nextRoute }
}
function changedHistoryForm() {
  const view = mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
  fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: 'Alex Unsaved History Answers' } })
  return view
}

function deferredRestoration(navigation: NavigationModel) {
  const requests: { key: string; commit: () => void; finish: () => void; rejectBoth: () => void }[] = []
  navigation.traverseTo.mockImplementation(key => {
    let commit!: (value: unknown) => void, finish!: (value: unknown) => void, rejectCommit!: (reason: unknown) => void, rejectFinish!: (reason: unknown) => void
    const committed = new Promise<unknown>((resolve, reject) => { commit = resolve; rejectCommit = reject })
    const finished = new Promise<unknown>((resolve, reject) => { finish = resolve; rejectFinish = reject })
    requests.push({ key, commit: () => { navigation.attempt(key, true); commit(undefined) }, finish: () => finish(undefined), rejectBoth: () => { const error = new DOMException('Modeled traversal was superseded.', 'AbortError'); rejectCommit(error); rejectFinish(error) } })
    return { committed, finished }
  })
  return requests
}

describe('feature-detected browser traversal guard', () => {
  it.each(['previous-entry', 'forward-entry'] as const)('cancels a cancelable traversal to %s before location or Next changes', destination => {
    const { navigation, nextRoute } = historyModel()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    changedHistoryForm()
    let traversal!: Event
    act(() => { traversal = navigation.attempt(destination, true) })
    expect(traversal.defaultPrevented).toBe(true)
    expect(navigation.currentEntry).toBe(navigation.entries[1])
    expect(window.location.href).toBe(navigation.entries[1].url)
    expect(window.history.state).toEqual(navigation.entries[1].state)
    expect(nextRoute).not.toHaveBeenCalled()
    expect(navigation.traverseTo).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
    expect((screen.getByRole('textbox', { name: /^Full name/ }) as HTMLInputElement).value).toBe('Alex Unsaved History Answers')
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it.each(['previous-entry', 'forward-entry'] as const)('restores a canceled noncancelable traversal to %s by exact key/index without changing Next state or the forward trail', destination => {
    const { navigation, nextRoute } = historyModel()
    const entries = [...navigation.entries]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const push = vi.spyOn(window.history, 'pushState'), replace = vi.spyOn(window.history, 'replaceState'), go = vi.spyOn(window.history, 'go')
    changedHistoryForm()
    let traversal!: Event
    act(() => { traversal = navigation.attempt(destination, false) })
    expect(traversal.defaultPrevented).toBe(false)
    expect(navigation.traverseTo).toHaveBeenCalledTimes(1)
    expect(navigation.traverseTo).toHaveBeenCalledWith('original-entry')
    expect(navigation.currentEntry.key).toBe('original-entry')
    expect(navigation.currentEntry.index).toBe(1)
    expect(window.location.href).toBe(entries[1].url)
    expect(window.history.state).toEqual(entries[1].state)
    expect(navigation.entries).toEqual(entries)
    entries.forEach((entry, index) => expect(navigation.entries[index]).toBe(entry))
    expect(nextRoute).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
    expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(go).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: /^Full name/ }) as HTMLInputElement).value).toBe('Alex Unsaved History Answers')
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it.each([
    { first: 'previous-entry', second: 'forward-entry' },
    { first: 'forward-entry', second: 'previous-entry' },
  ])('keeps the original pinned when a second noncancelable traversal to $second supersedes queued restoration from $first', async ({ first, second }) => {
    const { navigation, nextRoute } = historyModel()
    const entries = [...navigation.entries]
    const requests = deferredRestoration(navigation)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    changedHistoryForm()
    act(() => { navigation.attempt(first, false) })
    expect(navigation.currentEntry.key).toBe(first)
    expect(requests.map(request => request.key)).toEqual(['original-entry'])
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { navigation.attempt(second, false) })
    expect(navigation.currentEntry.key).toBe(second)
    expect(requests.map(request => request.key)).toEqual(['original-entry', 'original-entry'])
    await act(async () => { requests[0].rejectBoth(); await Promise.resolve() })
    expect(screen.queryByText('Browser history restoration not confirmed')).toBeNull()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { requests[1].commit(); requests[1].finish(); await Promise.resolve() })
    expect(navigation.currentEntry).toBe(entries[1])
    expect(navigation.currentEntry.index).toBe(1)
    expect(window.location.href).toBe(entries[1].url)
    expect(window.history.state).toEqual(entries[1].state)
    entries.forEach((entry, index) => expect(navigation.entries[index]).toBe(entry))
    expect(nextRoute).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('textbox', { name: /^Full name/ }) as HTMLInputElement).value).toBe('Alex Unsaved History Answers')
    expect(boundary.submit).not.toHaveBeenCalled()
  })
  it.each(['previous-entry', 'forward-entry'] as const)('cancels a superseding cancelable traversal to %s while exact restoration is still queued', async second => {
    const { navigation, nextRoute } = historyModel()
    const first = second === 'previous-entry' ? 'forward-entry' : 'previous-entry'
    const requests = deferredRestoration(navigation)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    changedHistoryForm()
    act(() => { navigation.attempt(first, false) })
    let superseding!: Event
    act(() => { superseding = navigation.attempt(second, true) })
    expect(superseding.defaultPrevented).toBe(true)
    expect(navigation.currentEntry.key).toBe(first)
    expect(requests.map(request => request.key)).toEqual(['original-entry'])
    await act(async () => { requests[0].commit(); requests[0].finish(); await Promise.resolve() })
    expect(navigation.currentEntry.key).toBe('original-entry')
    expect(nextRoute).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps navigation locked after the restored popstate and committed promise until finished also confirms', async () => {
    const { navigation, nextRoute } = historyModel()
    const requests = deferredRestoration(navigation)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    changedHistoryForm()
    act(() => { navigation.attempt('previous-entry', false) })
    await act(async () => { requests[0].commit(); await Promise.resolve() })
    expect(navigation.currentEntry.key).toBe('original-entry')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { requests[0].finish(); await Promise.resolve() })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)
    expect(nextRoute).not.toHaveBeenCalled()
  })
  it.each(['previous-entry', 'forward-entry'] as const)('preserves normal Next traversal to %s when departure is accepted', destination => {
    const { navigation, nextRoute } = historyModel()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    changedHistoryForm()
    act(() => { navigation.attempt(destination, true) })
    expect(navigation.currentEntry.key).toBe(destination)
    expect(nextRoute).toHaveBeenCalledOnce()
    expect(navigation.traverseTo).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
  })
  it('does not prompt for hash-only traversal or an unchanged application', () => {
    const { navigation, nextRoute } = historyModel()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    changedHistoryForm()
    act(() => { navigation.attempt('hash-entry', true) })
    expect(navigation.currentEntry.key).toBe('hash-entry')
    expect(nextRoute).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: investor.full_name } })
    act(() => { navigation.attempt('previous-entry', true) })
    expect(navigation.currentEntry.key).toBe('previous-entry')
    expect(nextRoute).toHaveBeenCalledTimes(2)
    expect(confirm).not.toHaveBeenCalled()
  })
  it('consumes confirmed link consent once and expires unused consent without permanently suppressing future warnings', () => {
    vi.useFakeTimers()
    try {
      const { navigation, nextRoute } = historyModel()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValue(false)
      changedHistoryForm()
      fireEvent.click(screen.getByRole('link', { name: 'Switch application' }))
      act(() => { navigation.attempt('forward-entry', true) })
      expect(confirm).toHaveBeenCalledOnce()
      expect(nextRoute).toHaveBeenCalledOnce()
      // Model returning to the retained original component without new consent.
      History.prototype.replaceState.call(window.history, navigation.entries[1].state, '', navigation.entries[1].url)
      navigation.currentEntry = navigation.entries[1]
      confirm.mockReturnValueOnce(true)
      fireEvent.click(screen.getByRole('link', { name: 'Switch application' }))
      expect(confirm).toHaveBeenCalledTimes(2)
      // This accepted link does not leave the modeled page. Its unused consent
      // must expire, not suppress a later Back/Forward or unload warning.
      act(() => { vi.advanceTimersByTime(1001); navigation.attempt('forward-entry', true) })
      expect(confirm).toHaveBeenCalledTimes(3)
      expect(navigation.currentEntry.key).toBe('original-entry')
      expect(unloadPrevented()).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('cleans up native and capture listeners when the form unmounts', () => {
    const { navigation, nextRoute } = historyModel()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const removeNative = vi.spyOn(navigation, 'removeEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener')
    const view = changedHistoryForm()
    view.unmount()
    act(() => { navigation.attempt('previous-entry', true) })
    expect(nextRoute).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    expect(navigation.traverseTo).not.toHaveBeenCalled()
    expect(unloadPrevented()).toBe(false)
    expect(removeNative).toHaveBeenCalledWith('navigate', expect.any(Function))
    expect(removeWindow).toHaveBeenCalledWith('popstate', expect.any(Function), true)
  })
  it('shows an explicit compatibility warning only while unsupported-browser answers are dirty', () => {
    Object.defineProperty(window, 'navigation', { value: undefined, configurable: true })
    mountedForm(entryApplication({ review_route: 'AVAILABLE', details: investor }))
    expect(screen.queryByText(onboardingHistoryUnavailableMessage)).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: 'Alex Unsaved History Answers' } })
    expect(screen.getByText(onboardingHistoryUnavailableMessage)).toBeTruthy()
    expect(unloadPrevented()).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: /^Full name/ }), { target: { value: investor.full_name } })
    expect(screen.queryByText(onboardingHistoryUnavailableMessage)).toBeNull()
  })
  it.each(['throws', 'committed rejects', 'finished rejects', 'both reject'] as const)('reports exact-entry restoration that %s rather than claiming cancellation succeeded or sending another submission', async failure => {
    const { navigation, nextRoute } = historyModel()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    navigation.traverseTo.mockImplementation(() => {
      if (failure === 'throws') throw new Error('Modeled exact entry is unavailable.')
      const error = new DOMException('Modeled exact entry is unavailable.', 'InvalidStateError')
      return { committed: failure === 'finished rejects' ? Promise.resolve() : Promise.reject(error), finished: failure === 'committed rejects' ? Promise.resolve() : Promise.reject(error) }
    })
    changedHistoryForm()
    act(() => { navigation.attempt('previous-entry', false) })
    await waitFor(() => expect(screen.getByText('Browser history restoration not confirmed')).toBeTruthy())
    expect(nextRoute).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    expect(boundary.submit).not.toHaveBeenCalled()
    expect(unloadPrevented()).toBe(true)
  })
})
