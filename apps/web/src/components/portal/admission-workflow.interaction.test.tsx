// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isWealthManagerDetailsV2, portalCommandSchema, type PortalApplication, type PortalEntityInvestmentAccount, type PortalInvestingRepresentativeMandate, type PortalOrganisationMandate, type PortalSnapshot } from '@/lib/portal/contracts'
import type { PlatformRelease } from '@/lib/platform-release'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { stage2AccessSchema } from '@/lib/portal/stage2-access'

// Real normal screen, forms, returned revisions and evidence panels. Command
// responses and signed-provider reads are fixtures: no hosted customer decision,
// genuine provider/scanner result or independently operated humans are proved.
const proof = vi.hoisted(() => ({
  submit: vi.fn(), result: undefined as PortalSnapshot | undefined,
  applicationReview: vi.fn(), privateDocument: vi.fn(), documentHistory: vi.fn(),
  providerEvidence: vi.fn(), monitoringDecision: vi.fn(), busy: false, unknown: false,
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./portal-client', async importOriginal => ({
  ...await importOriginal<typeof import('./portal-client')>(),
  usePortalCommand: (onSaved: (snapshot: PortalSnapshot) => void) => ({
    busy: proof.busy, unknown: proof.unknown, message: '', retry: vi.fn(),
    submit: async (command: string, payload: Record<string, unknown>) => {
      proof.submit(command, payload)
      if (!proof.result) return false
      onSaved(proof.result)
      return true
    },
  }),
}))
vi.mock('./portal-workflows', async importOriginal => {
  const original = await importOriginal<typeof import('./portal-workflows')>()
  return { ...original, ApplicationReview: (props: React.ComponentProps<typeof original.ApplicationReview>) => {
    proof.applicationReview(props)
    return React.createElement(original.ApplicationReview, props)
  } }
})
vi.mock('./onboarding-form', async importOriginal => {
  const original = await importOriginal<typeof import('./onboarding-form')>()
  return { ...original,
    PrivateDocument: (props: React.ComponentProps<typeof original.PrivateDocument>) => {
      proof.privateDocument(props)
      return React.createElement(original.PrivateDocument, props)
    },
    ApplicationDocumentHistory: (props: React.ComponentProps<typeof original.ApplicationDocumentHistory>) => {
      proof.documentHistory(props)
      return React.createElement(original.ApplicationDocumentHistory, props)
    },
  }
})
vi.mock('./kyc-verification', async importOriginal => {
  const original = await importOriginal<typeof import('./kyc-verification')>()
  return { ...original, ProviderEvidenceReview: (props: React.ComponentProps<typeof original.ProviderEvidenceReview>) => {
    proof.providerEvidence(props)
    return React.createElement(original.ProviderEvidenceReview, props)
  } }
})
vi.mock('./customer-monitoring', async importOriginal => {
  const original = await importOriginal<typeof import('./customer-monitoring')>()
  return { ...original, CustomerMonitoringDecision: (props: React.ComponentProps<typeof original.CustomerMonitoringDecision>) => {
    proof.monitoringDecision(props)
    return React.createElement(original.CustomerMonitoringDecision, props)
  } }
})
import { PortalScreen } from './portal-screens'

const reviewer = '11111111-1111-4111-8111-111111111111'
const applicant = '22222222-2222-4222-8222-222222222222'
const applicationId = '33333333-3333-4333-8333-333333333333'
const organisationId = '44444444-4444-4444-8444-444444444444'
const documentId = '55555555-5555-4555-8555-555555555555'
const requestKey = '66666666-6666-4666-8666-666666666666'
const eventId = '77777777-7777-4777-8777-777777777777'
const accountId = '88888888-8888-4888-8888-888888888888'
const admin = '99999999-9999-4999-8999-999999999999'
const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }
const release: PlatformRelease = { version: 'mounted-admission-fixture', environment: 'TESTNET', source: 'normal-fixture' }
const decisions = ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'] as const
type Decision = typeof decisions[number]

function normalSnapshot(): PortalSnapshot {
  return {
    stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', actor_id: reviewer, operating_context: reviewContext,
      allowed_commands: ['review_application', 'review_representative_mandate', 'review_investing_representative_mandate'] },
    actor: { id: reviewer, email: 'reviewer@example.invalid', display_name: null, can_review: true },
    operating_context: reviewContext,
    applications: [{
      id: applicationId, user_id: applicant, persona: 'INVESTOR', status: 'SUBMITTED', revision: 2,
      details: { full_name: 'Fictional Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Synthetic savings for normal TEST admission.', beneficial_owners: '', experience: 'Fictional experienced investor.',
        documents: [{ id: documentId, kind: 'IDENTITY', title: 'Fictional identity evidence', storage_path: `${applicant}/${documentId}`,
          sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }], test_data_acknowledged: true },
      submitted_at: '2026-10-10T12:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null,
      organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null, admission_purpose: 'INVESTOR_ADMISSION',
    }],
    organisations: [], products: [], subscriptions: [], events: [], requests: [], accounts: [],
    product_eligibility: [], entity_product_eligibility: [], product_appointments: [],
    mandate_queue_available: true, organisation_mandates: [], entity_mandate_queue_available: true, investing_representative_mandates: [],
  }
}
function savedSnapshot(decision: Decision, rationale: string): PortalSnapshot {
  const initial = normalSnapshot()
  return { ...initial,
    applications: [{ ...initial.applications[0], revision: 3, status: decision, reviewer_id: reviewer,
      review_notes: rationale, reviewed_at: '2026-10-10T12:30:00Z', approved_until: decision === 'APPROVED' ? '2099-01-01T00:00:00Z' : null,
      review_checks: { identity: decision === 'APPROVED', ownership: decision === 'APPROVED', screening: decision === 'APPROVED', suitability: decision === 'APPROVED' } }],
    events: [{ id: eventId, subject_id: applicationId, kind: 'review_application', actor_id: reviewer,
      created_at: '2026-10-10T12:30:00Z', summary: `TEST ${decision} admission decision recorded for revision 2.` }],
    requests: [{ key: requestKey, command: 'review_application' }],
  }
}
function reviewScreen(value: PortalSnapshot, change: Partial<React.ComponentProps<typeof PortalScreen>> = {}) {
  return <PortalScreen data={{ user: { id: reviewer, email: 'reviewer@example.invalid' }, snapshot: value }}
    view="/portal/compliance/detail" id={applicationId} operatingContext={reviewContext} release={release} {...change} />
}
function applicantSnapshot(): PortalSnapshot {
  const value = savedSnapshot('APPROVED', 'Fictional investor admission approved against submitted evidence.')
  return { ...value, actor: { ...value.actor, id: applicant, email: 'applicant@example.invalid', can_review: false }, operating_context: APPLICANT_CONTEXT,
    stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', actor_id: applicant, operating_context: APPLICANT_CONTEXT,
      allowed_commands: ['start_application', 'submit_application', 'create_investment_account', 'create_entity_investment_account', 'request_representative_mandate', 'request_investing_representative_mandate'] } }
}
function entityApplicantSnapshot(): PortalSnapshot {
  const value = applicantSnapshot()
  const application = value.applications[0]
  if (isWealthManagerDetailsV2(application.details)) throw new Error('Expected investor fixture details.')
  value.applications = [{ ...application, can_create_entity_account: true,
    details: { ...application.details, investor_type: 'ENTITY', company_name: 'Fictional Holding Company', registration_reference: 'SYNTH-ENTITY-001',
      beneficial_owners: 'Fictional entity ownership and appointment evidence.',
      documents: [{ ...application.details.documents[0], kind: 'COMPANY', title: 'Fictional board appointment' }] } }]
  value.entity_account_route_available = true
  value.entity_investment_accounts = []
  value.investing_representative_mandates = []
  return value
}

beforeEach(() => {
  vi.clearAllMocks(); proof.result = undefined; proof.busy = false; proof.unknown = false; sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.startsWith('/api/portal/kyc/evidence?')) return new Response(JSON.stringify({ application_id: new URL(input, 'https://example.invalid').searchParams.get('application_id'), events: [] }), { headers: { 'content-type': 'application/json' } })
    throw new Error('Only the normal provider evidence read is configured in this mounted proof.')
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('mounted normal customer-admission workflow', () => {
  it.each(decisions)('records %s through the existing command and preserves normal evidence/history on refresh', async decision => {
    const rationale = `Fictional admission evidence reviewed; ${decision} is the recorded TEST decision.`
    const result = savedSnapshot(decision, rationale); proof.result = result
    const mounted = render(reviewScreen(normalSnapshot()))
    expect(proof.applicationReview).toHaveBeenCalled()
    expect(screen.queryByText('Synthetic Compliance rehearsal')).toBeNull()
    expect(screen.queryByText('Synthetic evidence manifests')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Private supporting evidence' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Submitted evidence history' })).toBeTruthy()
    expect(screen.getByText('Fictional identity evidence')).toBeTruthy()
    expect(screen.getByText('Revision 2')).toBeTruthy()
    expect(proof.privateDocument).toHaveBeenCalled(); expect(proof.documentHistory).toHaveBeenCalled(); expect(proof.providerEvidence).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('No provider evidence received yet')).toBeTruthy())
    expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true)

    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: decision } })
    fireEvent.change(screen.getByLabelText(/^Review rationale/), { target: { value: rationale } })
    if (decision === 'APPROVED') for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Record review decision' }))
    await waitFor(() => expect(screen.getByText('Revision 3')).toBeTruthy())
    const payload = { application_id: applicationId, expected_revision: 2, decision, notes: rationale,
      checks: { identity: decision === 'APPROVED', ownership: decision === 'APPROVED', screening: decision === 'APPROVED', suitability: decision === 'APPROVED' } }
    expect(proof.submit.mock.calls).toEqual([['review_application', payload]])
    expect(portalCommandSchema.safeParse({ command: 'review_application', key: requestKey, payload }).success).toBe(true)
    expect(screen.getByText(rationale)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record review decision' })).toBeNull()
    expect(screen.queryByLabelText('Decision')).toBeNull()
    expect(proof.monitoringDecision).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'View submitted versions' })).toBeTruthy()

    mounted.unmount(); render(reviewScreen(result))
    expect(screen.getByText('Revision 3')).toBeTruthy(); expect(screen.getByText(rationale)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record review decision' })).toBeNull()
    expect(proof.submit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('No provider evidence received yet')).toBeTruthy())
  })

  it.each(['/portal', '/portal/compliance'] as const)('keeps normal pending work and saved case decisions connected in %s', view => {
    const value = normalSnapshot(); const statuses = ['SUBMITTED', ...decisions] as const
    value.applications = statuses.map((status, index): PortalApplication => ({ ...value.applications[0],
      id: `${(index + 8).toString(16)}8888888-8888-4888-8888-888888888888`, status,
      details: { ...value.applications[0].details, full_name: `Fictional ${status} applicant` },
      reviewed_at: status === 'SUBMITTED' ? null : '2026-10-10T12:30:00Z', reviewer_id: status === 'SUBMITTED' ? null : reviewer,
      review_notes: status === 'SUBMITTED' ? null : 'Fictional case decision retained.', approved_until: status === 'APPROVED' ? '2099-01-01T00:00:00Z' : null,
    }))
    render(reviewScreen(value, { view, id: undefined }))
    expect(screen.getByRole('heading', { name: 'Saved application decisions' })).toBeTruthy()
    for (const status of statuses) expect(screen.getByText(`Fictional ${status} applicant`)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Review case' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Inspect saved decision' })).toHaveLength(3)
    expect(proof.applicationReview).not.toHaveBeenCalled(); expect(proof.submit).not.toHaveBeenCalled()
    expect(screen.queryByText('Synthetic Compliance rehearsal')).toBeNull()
  })

  it('does not expand client authority when a returned record loses the admission marker', async () => {
    proof.result = { ...savedSnapshot('CHANGES_REQUIRED', 'Clarify the fictional source-of-funds evidence.'), stage2_access: undefined }
    render(reviewScreen(normalSnapshot()))
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'CHANGES_REQUIRED' } })
    fireEvent.change(screen.getByLabelText(/^Review rationale/), { target: { value: 'Clarify the fictional source-of-funds evidence.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record review decision' }))
    await waitFor(() => expect(screen.getByText('Saved admission state unavailable')).toBeTruthy())
    expect(screen.queryByText('Fictional Applicant')).toBeNull()
    expect(proof.monitoringDecision).not.toHaveBeenCalled()
  })

  it.each(['busy', 'unknown'] as const)('does not dispatch another admission decision while %s', state => {
    proof[state] = true; render(reviewScreen(normalSnapshot()))
    fireEvent.submit(screen.getByRole('button', { name: 'Record review decision' }).closest('form')!)
    expect(proof.submit).not.toHaveBeenCalled()
  })

  it.each(['actor', 'marker actor', 'organisation', 'MAINNET', 'missing release', 'malformed marker', 'legacy projection'] as const)(
    'mounts no customer/evidence mutation surface for invalid %s', failure => {
      const value = normalSnapshot(); const change: Partial<React.ComponentProps<typeof PortalScreen>> = {}
      if (failure === 'actor') change.data = { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }
      if (failure === 'marker actor') value.stage2_access = { ...value.stage2_access!, actor_id: applicant }
      if (failure === 'organisation') change.operatingContext = { ...reviewContext, organisationId: applicant }
      if (failure === 'MAINNET') change.release = { ...release, environment: 'MAINNET' }
      if (failure === 'missing release') change.release = undefined
      if (failure === 'malformed marker') value.stage2_access = { ...value.stage2_access!, version: 2 } as unknown as PortalSnapshot['stage2_access']
      if (failure === 'legacy projection') value.rehearsal = { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: reviewer, operating_context: reviewContext }
      render(reviewScreen(value, change))
      expect(screen.getByText('Saved admission state unavailable')).toBeTruthy()
      for (const spy of [proof.applicationReview, proof.privateDocument, proof.providerEvidence, proof.documentHistory, proof.submit]) expect(spy).not.toHaveBeenCalled()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it('does not mount product actions from password-only admission access', () => {
    render(reviewScreen(normalSnapshot(), { view: '/portal/products' }))
    expect(screen.getByText('Action unavailable in this capacity')).toBeTruthy()
    expect(proof.applicationReview).not.toHaveBeenCalled(); expect(proof.submit).not.toHaveBeenCalled()
  })
  it('does not manufacture a returned case from an unknown detail reference', () => {
    render(reviewScreen(normalSnapshot(), { id: documentId }))
    expect(screen.getByText('This record is not available in your current operating scope')).toBeTruthy()
    expect(proof.applicationReview).not.toHaveBeenCalled(); expect(proof.submit).not.toHaveBeenCalled()
  })

  it('opens the approved investor account through the normal command and shows the linked result without funding controls', async () => {
    const value = applicantSnapshot()
    proof.result = { ...value, accounts: [{ id: accountId, holder_user_id: applicant, application_id: applicationId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: '2026-10-11T12:00:00Z' }] }
    render(reviewScreen(value, { data: { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }, operatingContext: APPLICANT_CONTEXT, view: '/portal/portfolio', id: undefined }))
    fireEvent.click(screen.getByRole('button', { name: 'Open individual investment account' }))
    await waitFor(() => expect(screen.getByText(accountId)).toBeTruthy())
    expect(proof.submit.mock.calls).toEqual([['create_investment_account', { application_id: applicationId }]])
    expect(screen.queryByRole('button', { name: /Reserve|Accept terms|Send settlement|Open funding/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Opportunities' })).toBeNull()
  })

  it('does not render account opening when the returned admission command set excludes it', () => {
    const value = applicantSnapshot(); value.stage2_access!.allowed_commands = ['start_application', 'submit_application']
    render(reviewScreen(value, { data: { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }, operatingContext: APPLICANT_CONTEXT, view: '/portal/portfolio', id: undefined }))
    expect(screen.getByText('Account opening unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open individual investment account' })).toBeNull()
  })

  it('opens the legal-holder account then requests its separate document-bound investing mandate through normal commands', async () => {
    const value = entityApplicantSnapshot()
    const account: PortalEntityInvestmentAccount = { id: accountId, application_id: applicationId, entity_party_id: organisationId,
      entity_name: 'Fictional Holding Company', registration_reference: 'SYNTH-ENTITY-001', country: 'ZA', kind: 'ENTITY', status: 'ACTIVE',
      created_at: '2026-10-11T12:00:00Z', admission_revision: 3, admission_approved_until: '2099-01-01T00:00:00Z',
      can_request_mandate: true, can_view: false, can_request_eligibility: false }
    const created = { ...value, entity_investment_accounts: [account] }
    proof.result = created
    render(reviewScreen(value, { data: { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }, operatingContext: APPLICANT_CONTEXT, view: '/portal/portfolio', id: undefined }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Fictional Holding Company investment account' }))
    await waitFor(() => expect(screen.getByText(accountId)).toBeTruthy())
    expect(proof.submit.mock.calls).toEqual([['create_entity_investment_account', { application_id: applicationId }]])

    const future = new Date(Date.now() + 86_400_000)
    const localExpiry = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    const requestedUntil = new Date(localExpiry).toISOString()
    const evidenceReference = 'Fictional board appointment in the approved COMPANY document.'
    const mandate: PortalInvestingRepresentativeMandate = { id: requestKey, investment_account_id: accountId, application_id: applicationId,
      applicant_user_id: applicant, representative_user_id: applicant, entity_party_id: organisationId, entity_name: account.entity_name,
      reviewer_scope_organisation_id: organisationId, admission_revision: 3, admission_current_revision: 3, admission_approved_until: account.admission_approved_until,
      cycle: 1, revision: 1, status: 'SUBMITTED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], transaction_limit_minor: '0',
      evidence_reference: evidenceReference, appointment_document_id: documentId, requested_until: requestedUntil, submitted_at: '2026-10-11T12:30:00Z',
      reviewed_at: null, reviewer_user_id: null, review_notes: null, review_checks: {}, approval_receipt_id: null, applied_at: null,
      applied_by_user_id: null, revoked_at: null, revoke_reason: null, effective: false, next_owner: 'COMPLIANCE',
      can_request: false, can_review: false, can_apply: false, can_revoke: false }
    proof.result = { ...created, investing_representative_mandates: [mandate] }
    expect((screen.getByLabelText(/^Appointment evidence document/) as HTMLSelectElement).value).toBe(documentId)
    fireEvent.change(screen.getByLabelText(/^Appointment evidence reference/), { target: { value: evidenceReference } })
    fireEvent.change(screen.getByLabelText(/^Requested end date and time/), { target: { value: localExpiry } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit representative mandate for review' }))
    await waitFor(() => expect(screen.getByText('Independent mandate review pending')).toBeTruthy())
    const payload = { investment_account_id: accountId, expected_revision: 0, appointment_document_id: documentId,
      evidence_reference: evidenceReference, requested_until: requestedUntil }
    expect(proof.submit.mock.calls).toEqual([
      ['create_entity_investment_account', { application_id: applicationId }],
      ['request_investing_representative_mandate', payload],
    ])
    expect(portalCommandSchema.safeParse({ command: 'request_investing_representative_mandate', key: requestKey, payload }).success).toBe(true)
    expect(screen.getByText(requestKey)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit representative mandate for review' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Accept terms|Send settlement|Open funding/ })).toBeNull()
  })

  it('keeps the entity account readable without offering an excluded investing-mandate request', () => {
    const value = entityApplicantSnapshot()
    value.stage2_access!.allowed_commands = ['create_entity_investment_account']
    value.entity_investment_accounts = [{ id: accountId, application_id: applicationId, entity_party_id: organisationId,
      entity_name: 'Fictional Holding Company', registration_reference: 'SYNTH-ENTITY-001', country: 'ZA', kind: 'ENTITY', status: 'ACTIVE',
      created_at: '2026-10-11T12:00:00Z', admission_revision: 3, admission_approved_until: '2099-01-01T00:00:00Z',
      can_request_mandate: true, can_view: false, can_request_eligibility: false }]
    render(reviewScreen(value, { data: { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }, operatingContext: APPLICANT_CONTEXT, view: '/portal/portfolio', id: undefined }))
    expect(screen.getByText(accountId)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit representative mandate for review' })).toBeNull()
    expect(proof.submit).not.toHaveBeenCalled()
  })

  it('applies only the separately reviewed manager mandate in the normal Super Admin detail', async () => {
    const context: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'SuperAdmin' }
    const mandate: PortalOrganisationMandate = { id: requestKey, application_id: applicationId, product_organisation_id: eventId, native_organisation_id: null,
      reviewer_scope_organisation_id: organisationId, applicant_user_id: applicant, organisation_name: 'Fictional Manager', role: 'OfferingManager', status: 'APPROVED', revision: 2,
      requested_until: '2099-01-01T00:00:00Z', evidence_reference: 'Fictional board appointment bound to reviewed customer admission.', review_notes: 'Review scope and appointment evidence confirmed.',
      reviewer_user_id: reviewer, applied_by_user_id: null, admission_revision: 3, admission_status: 'APPROVED', admission_approved_until: '2099-01-01T00:00:00Z',
      admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', effective: false, next_owner: 'SUPER_ADMIN', can_request: false, can_review: false, can_apply: true, can_revoke: false }
    const value = normalSnapshot(); value.actor = { ...value.actor, id: admin, email: 'admin@example.invalid', can_review: false }; value.operating_context = context
    value.stage2_access = { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', actor_id: admin, operating_context: context, allowed_commands: ['apply_representative_mandate'] }
    value.applications = []; value.organisation_mandates = [mandate]
    const applied = { ...mandate, revision: 3, status: 'APPLIED' as const, native_organisation_id: eventId, applied_by_user_id: admin, can_apply: false, effective: true,
      next_owner: 'NONE' as const, approval_receipt_id: documentId, applied_at: '2026-10-10T12:00:00Z' }
    proof.result = { ...value, organisation_mandates: [applied] }
    render(reviewScreen(value, { data: { user: { id: admin, email: 'admin@example.invalid' }, snapshot: value }, operatingContext: context, id: requestKey }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed Offering Manager mandate' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply reviewed Offering Manager mandate' })).toBeNull())
    expect(proof.submit.mock.calls).toEqual([['apply_representative_mandate', { mandate_id: requestKey, expected_revision: 2 }]])
    expect(screen.getByText(admin)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record review decision' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke this appointment' })).toBeNull()
    expect(stage2AccessSchema.safeParse(value.stage2_access).success).toBe(true)
  })
})
