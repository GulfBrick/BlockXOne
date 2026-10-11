// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalApplication, type PortalEntityInvestmentAccount, type PortalInvestingRepresentativeMandate, type PortalSnapshot } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformRelease } from '@/lib/platform-release'

// Mounted normal panels/commands, with synthetic command and document-lookup
// responses. This does not prove hosted bytes, scanner/provider acceptance,
// customer approval or operation by independent human beings.
const proof = vi.hoisted(() => ({
  submit: vi.fn(), retry: vi.fn(), current: undefined as PortalSnapshot | undefined, result: undefined as PortalSnapshot | undefined,
  busy: false, unknown: false, message: '', lookupChange: {} as Record<string, unknown>, lookupFailure: false,
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./portal-client', async importOriginal => ({
  ...await importOriginal<typeof import('./portal-client')>(),
  usePortalCommand: (onSaved: (snapshot: PortalSnapshot) => void) => ({
    busy: proof.busy, unknown: proof.unknown, message: proof.message, retry: proof.retry,
    submit: async (command: string, payload: Record<string, unknown>) => {
      proof.submit(command, payload)
      if (!proof.result) return false
      proof.current = proof.result; onSaved(proof.result); return true
    },
  }),
}))
import { PortalScreen } from './portal-screens'
import { RepresentativeProposalInbox } from './portal-workflows'

const owner = '11111111-1111-4111-8111-111111111111'
const target = '22222222-2222-4222-8222-222222222222'
const reviewer = '33333333-3333-4333-8333-333333333333'
const admin = '44444444-4444-4444-8444-444444444444'
const entityApplicationId = '55555555-5555-4555-8555-555555555555'
const targetApplicationId = '66666666-6666-4666-8666-666666666666'
const organisationId = '77777777-7777-4777-8777-777777777777'
const accountId = '88888888-8888-4888-8888-888888888888'
const documentId = '99999999-9999-4999-8999-999999999999'
const mandateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const consentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const selfMandateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const requestKey = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const proposalHash = 'e'.repeat(64)
const release: PlatformRelease = { version: 'mounted-representatives-fixture', environment: 'TESTNET', source: 'normal-account-extension-fixture' }
const document = { id: documentId, kind: 'COMPANY' as const, title: 'Fictional named board appointment', storage_path: `${owner}/${documentId}`, sha256: 'f'.repeat(64), size: 200, mime_type: 'application/pdf' as const }
const expiry = () => new Date(Date.now() + 2 * 86_400_000).toISOString()

function application(): PortalApplication {
  return { id: entityApplicationId, user_id: owner, persona: 'INVESTOR', status: 'APPROVED', revision: 3,
    details: { full_name: 'Fictional Entity Applicant', country: 'ZA', investor_type: 'ENTITY', company_name: 'Fictional Representative Holdings', registration_reference: 'SYNTH-REPS-001', source_of_funds: 'Synthetic entity subscription funds.', beneficial_owners: 'Fictional disclosed owners, not actual customers.', experience: 'Fictional entity investment experience.', documents: [document], test_data_acknowledged: true },
    submitted_at: '2026-10-11T00:00:00Z', reviewed_at: '2026-10-11T00:30:00Z', reviewer_id: reviewer,
    review_notes: 'Fictional current entity admission against exact submitted documents.', organisation_id: null,
    review_checks: { identity: true, ownership: true, screening: true, suitability: true }, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'INVESTOR_ADMISSION' }
}
function account(change: Partial<PortalEntityInvestmentAccount> = {}): PortalEntityInvestmentAccount {
  return { id: accountId, application_id: entityApplicationId, entity_party_id: organisationId, entity_name: 'Fictional Representative Holdings', registration_reference: 'SYNTH-REPS-001', country: 'ZA', kind: 'ENTITY', status: 'ACTIVE', created_at: '2026-10-11T00:40:00Z', admission_revision: 3, admission_approved_until: '2099-01-01T00:00:00Z', can_request_mandate: false, can_view: true, can_request_eligibility: false, can_propose_representative: true, ...change }
}
function mandate(change: Partial<PortalInvestingRepresentativeMandate> = {}): PortalInvestingRepresentativeMandate {
  return { id: mandateId, investment_account_id: accountId, application_id: entityApplicationId, applicant_user_id: owner, representative_user_id: target, entity_party_id: organisationId, entity_name: 'Fictional Representative Holdings', reviewer_scope_organisation_id: organisationId, admission_revision: 3, admission_current_revision: 3, admission_approved_until: '2099-01-01T00:00:00Z', cycle: 1, revision: 1, status: 'PROPOSED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], transaction_limit_minor: '0', evidence_reference: 'Fictional named appointment in the exact reviewed COMPANY document.', appointment_document_id: documentId, requested_until: expiry(), submitted_at: '2026-10-11T01:00:00Z', reviewed_at: null, reviewer_user_id: null, review_notes: null, review_checks: {}, approval_receipt_id: null, applied_at: null, applied_by_user_id: null, revoked_at: null, revoke_reason: null, effective: false, next_owner: 'REPRESENTATIVE', can_request: false, can_review: false, can_apply: false, can_revoke: false, representative_email: 'representative@example.invalid', representative_name: 'Fictional Named Representative', representative_application_id: targetApplicationId, representative_application_revision: 4, proposal_hash: proposalHash, consent_decision: null, consent_receipt_id: null, responded_at: null, can_respond: true, ...change }
}
function snapshot(actorId = target, context: PortalOperatingContext = APPLICANT_CONTEXT): PortalSnapshot {
  const commands = context.mode === 'APPLICANT'
    ? ['start_application', 'submit_application', 'create_investment_account', 'create_entity_investment_account', 'request_representative_mandate', 'request_investing_representative_mandate', 'respond_investing_representative_proposal'] as const
    : context.role === 'ComplianceOfficer' ? ['review_application', 'review_representative_mandate', 'review_investing_representative_mandate'] as const
      : ['apply_representative_mandate', 'apply_investing_representative_mandate'] as const
  return { actor: { id: actorId, email: `${actorId === owner ? 'proposer' : actorId === target ? 'representative' : actorId === reviewer ? 'reviewer' : 'admin'}@example.invalid`, display_name: null, can_review: actorId === reviewer }, operating_context: context,
    stage2_access: { version: 1, environment: 'TESTNET', session_mode: 'TEST_PASSWORD', actor_id: actorId, operating_context: context, allowed_commands: [...commands] },
    applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [], accounts: [],
    product_eligibility: [], entity_product_eligibility: [], product_appointments: [], mandate_queue_available: true, organisation_mandates: [],
    entity_account_route_available: true, entity_investment_accounts: [], entity_mandate_queue_available: true, investing_representative_mandates: [mandate()] }
}
function mount(value: PortalSnapshot, view: '/portal' | '/portal/portfolio' | '/portal/compliance/detail' = '/portal/portfolio', id?: string) {
  proof.current = value
  return render(<PortalScreen data={{ user: { id: value.actor.id, email: value.actor.email }, snapshot: value }} view={view} id={id} operatingContext={value.operating_context} release={release} />)
}
function ownerSnapshot(): PortalSnapshot {
  const value = snapshot(owner)
  value.applications = [application()]; value.entity_investment_accounts = [account()]
  value.investing_representative_mandates = [mandate({ id: selfMandateId, representative_user_id: owner, status: 'APPLIED', revision: 4,
    reviewer_user_id: reviewer, applied_by_user_id: admin, effective: true, next_owner: 'NONE',
    representative_email: null, representative_name: null, representative_application_id: null, representative_application_revision: null, proposal_hash: null, can_respond: false })]
  return value
}

beforeEach(() => {
  vi.clearAllMocks(); proof.current = undefined; proof.result = undefined; proof.busy = false; proof.unknown = false; proof.message = ''; proof.lookupChange = {}; proof.lookupFailure = false; sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'https://testnet.bx1.co.za')
    if (url.pathname !== '/api/portal/documents' || !url.searchParams.has('mandate_id')) throw new Error('Only exact proposal metadata is configured in this mounted fixture.')
    if (proof.lookupFailure) return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 404, headers: { 'content-type': 'application/json' } })
    const current = proof.current!.investing_representative_mandates!.find(item => item.id === url.searchParams.get('mandate_id'))!
    const data = { mandate_id: current.id, mandate_revision: current.revision, proposal_hash: current.proposal_hash, applicant_user_id: current.applicant_user_id,
      document, validation_state: 'SYNTHETIC_UNSCANNED', url: portalScopeHref(`/api/portal/documents?mandate_id=${current.id}&id=${documentId}&download=1`, proof.current!.operating_context), ...proof.lookupChange }
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('normal mounted account-representative handoffs', () => {
  it('lets the original entity applicant propose while its separate self mandate is applied', async () => {
    const value = ownerSnapshot()
    proof.result = { ...value, investing_representative_mandates: [...value.investing_representative_mandates!, mandate({ can_respond: false })] }
    mount(value)
    expect(screen.getByRole('heading', { name: 'Propose another representative' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit representative mandate for review' })).toBeNull()
    const future = new Date(Date.now() + 86_400_000)
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    fireEvent.change(screen.getByLabelText(/^Representative email/), { target: { value: 'representative@example.invalid' } })
    fireEvent.change(screen.getByLabelText(/^Proposal evidence reference/), { target: { value: 'Fictional named appointment in the exact reviewed COMPANY document.' } })
    fireEvent.change(screen.getByLabelText(/^Proposal end date and time/), { target: { value: local } })
    fireEvent.click(screen.getByRole('button', { name: 'Send representative proposal' }))
    const payload = { investment_account_id: accountId, expected_revision: 0, representative_email: 'representative@example.invalid', appointment_document_id: documentId,
      evidence_reference: 'Fictional named appointment in the exact reviewed COMPANY document.', requested_until: new Date(local).toISOString() }
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Named representative handoffs' })).toBeTruthy())
    expect(proof.submit.mock.calls).toEqual([['request_investing_representative_mandate', payload]])
    expect(portalCommandSchema.safeParse({ command: 'request_investing_representative_mandate', key: requestKey, payload }).success).toBe(true)
    expect(screen.getByText('Awaiting named representative')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept representative proposal' })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it.each(['ACCEPT', 'DECLINE'] as const)('records exact %s in the target inbox without the entity account or full owner application', async decision => {
    const value = snapshot()
    proof.result = { ...value, investing_representative_mandates: [mandate({ revision: 2, status: decision === 'ACCEPT' ? 'SUBMITTED' : 'DECLINED', can_respond: false,
      consent_decision: decision, consent_receipt_id: consentId, responded_at: '2026-10-11T01:05:00Z', next_owner: decision === 'ACCEPT' ? 'COMPLIANCE' : 'NONE' })] }
    mount(value)
    expect(screen.getByRole('heading', { name: 'Your representative proposals' })).toBeTruthy()
    expect(screen.queryByText(accountId)).toBeNull(); expect(screen.queryByText(entityApplicationId)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Entity investment account' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Submitted evidence history' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Provider evidence' })).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText('Synthetic TEST evidence · not scanned')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download bound appointment document' }).getAttribute('href')).toBe(portalScopeHref(`/api/portal/documents?mandate_id=${mandateId}&id=${documentId}&download=1`, APPLICANT_CONTEXT))
    fireEvent.click(screen.getByRole('button', { name: decision === 'ACCEPT' ? 'Accept representative proposal' : 'Decline representative proposal' }))
    const payload = { mandate_id: mandateId, expected_revision: 1, proposal_hash: proposalHash, decision }
    await waitFor(() => expect(screen.getByText(consentId)).toBeTruthy())
    expect(proof.submit.mock.calls).toEqual([['respond_investing_representative_proposal', payload]])
    expect(portalCommandSchema.safeParse({ command: 'respond_investing_representative_proposal', key: requestKey, payload }).success).toBe(true)
    expect(screen.queryByRole('button', { name: 'Accept representative proposal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline representative proposal' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Open.*investment account|Accept terms|Send settlement|Apply account-view/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Opportunities|submitted versions/ })).toBeNull()
  })

  it('mounts the same target inbox on the ordinary applicant home', async () => {
    mount(snapshot(), '/portal')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('heading', { name: 'Entity investment account' })).toBeNull()
  })

  it.each(['revision', 'proposal', 'proposer', 'document', 'kind', 'url', 'processing', 'unavailable'] as const)('withholds acceptance for mismatched %s lookup evidence', async failure => {
    if (failure === 'revision') proof.lookupChange = { mandate_revision: 2 }
    if (failure === 'proposal') proof.lookupChange = { proposal_hash: 'a'.repeat(64) }
    if (failure === 'proposer') proof.lookupChange = { applicant_user_id: target }
    if (failure === 'document') proof.lookupChange = { document: { ...document, id: targetApplicationId } }
    if (failure === 'kind') proof.lookupChange = { document: { ...document, kind: 'IDENTITY' } }
    if (failure === 'url') proof.lookupChange = { url: 'https://external.invalid/private.pdf' }
    if (failure === 'processing') proof.lookupChange = { validation_state: 'LEGACY_UNVERIFIED' }
    if (failure === 'unavailable') proof.lookupFailure = true
    mount(snapshot())
    await waitFor(() => expect(screen.getByText('Appointment document unavailable')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Decline representative proposal' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('link', { name: 'Download bound appointment document' })).toBeNull()
    expect(proof.submit).not.toHaveBeenCalled()
  })

  it.each(['proposal', 'document', 'representative-admission', 'proposer'] as const)('does not reuse a verified receipt after the same mounted proposal changes %s', async field => {
    const initial = snapshot(); proof.current = initial
    const onSaved = vi.fn()
    const mounted = render(<RepresentativeProposalInbox snapshot={initial} operatingContext={APPLICANT_CONTEXT} onSaved={onSaved} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('link', { name: 'Download bound appointment document' })).toBeTruthy()
    const changed = snapshot()
    const replacement = { ...changed.investing_representative_mandates![0] }
    if (field === 'proposal') replacement.proposal_hash = 'a'.repeat(64)
    if (field === 'document') replacement.appointment_document_id = targetApplicationId
    if (field === 'representative-admission') replacement.representative_application_revision = 5
    if (field === 'proposer') replacement.applicant_user_id = admin
    changed.investing_representative_mandates = [replacement]
    proof.current = changed; proof.lookupFailure = true
    mounted.rerender(<RepresentativeProposalInbox snapshot={changed} operatingContext={APPLICANT_CONTEXT} onSaved={onSaved} />)
    expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('link', { name: 'Download bound appointment document' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept representative proposal' }))
    expect(proof.submit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Appointment document unavailable')).toBeTruthy())
  })

  it.each(['expired', 'duplicate'] as const)('does not expose response controls for %s proposal records', async failure => {
    const value = snapshot()
    value.investing_representative_mandates = failure === 'expired'
      ? [mandate({ requested_until: '2020-01-01T00:00:00Z' })]
      : [mandate(), mandate()]
    mount(value)
    expect(screen.queryByRole('button', { name: 'Accept representative proposal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline representative proposal' })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(proof.submit).not.toHaveBeenCalled()
  })

  it.each(['busy', 'unknown'] as const)('retains bounded original-request feedback and suppresses consent while %s', async state => {
    proof[state] = true; mount(snapshot())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept representative proposal' })).toBeTruthy())
    const accept = screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true); fireEvent.click(accept); expect(proof.submit).not.toHaveBeenCalled()
    if (state === 'unknown') { fireEvent.click(screen.getByRole('button', { name: 'Retry the original saved request' })); expect(proof.retry).toHaveBeenCalledTimes(1) }
  })

  it('does not show another person’s proposal or permit an excluded response command', async () => {
    const foreign = snapshot(admin); mount(foreign)
    expect(screen.queryByRole('heading', { name: 'Your representative proposals' })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled(); cleanup()
    const value = snapshot(); value.stage2_access!.allowed_commands = ['start_application', 'submit_application']
    mount(value)
    await waitFor(() => expect(screen.getByRole('link', { name: 'Download bound appointment document' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Accept representative proposal' })).toBeNull(); expect(proof.submit).not.toHaveBeenCalled()
  })

  it('does not let an account-view representative delegate even if a malformed account flag is true', () => {
    const value = snapshot(); value.entity_investment_accounts = [account({ can_propose_representative: true })]
    value.investing_representative_mandates = [mandate({ status: 'APPLIED', effective: true, can_respond: false, consent_decision: 'ACCEPT', consent_receipt_id: consentId, next_owner: 'NONE' })]
    mount(value)
    expect(screen.getByRole('heading', { name: 'Entity investment account' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Propose another representative' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send representative proposal' })).toBeNull()
  })

  it('hands accepted consent to Compliance and the reviewed case to a different Super Admin', async () => {
    const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }
    const value = snapshot(reviewer, reviewContext); value.applications = [application()]
    value.investing_representative_mandates = [mandate({ status: 'SUBMITTED', revision: 2, can_respond: false, can_review: true,
      consent_decision: 'ACCEPT', consent_receipt_id: consentId, responded_at: '2026-10-11T01:05:00Z', next_owner: 'COMPLIANCE' })]
    const reviewed = { ...value, investing_representative_mandates: [mandate({ ...value.investing_representative_mandates![0], status: 'APPROVED', revision: 3, can_review: false, reviewer_user_id: reviewer, approval_receipt_id: requestKey, next_owner: 'SUPER_ADMIN', review_notes: 'Fictional appointment, exact consent, legal entity and scope reviewed.' })] }
    proof.result = reviewed; mount(value, '/portal/compliance/detail', mandateId)
    expect(screen.getByText('Fictional Named Representative · representative@example.invalid')).toBeTruthy()
    expect(screen.getByText('Entity applicant / proposer')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record entity mandate decision' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'APPROVED' } })
    fireEvent.change(screen.getByLabelText(/^Decision rationale/), { target: { value: 'Fictional appointment, exact consent, legal entity and scope reviewed.' } })
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Record entity mandate decision' }))
    const reviewPayload = { mandate_id: mandateId, expected_revision: 2, decision: 'APPROVED', notes: 'Fictional appointment, exact consent, legal entity and scope reviewed.', checks: { appointment: true, legal_entity: true, scope: true } }
    expect(proof.submit.mock.calls).toEqual([['review_investing_representative_mandate', reviewPayload]])
    cleanup()
    const adminContext: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'SuperAdmin' }
    const applying = snapshot(admin, adminContext); applying.applications = [application()]
    applying.investing_representative_mandates = [{ ...reviewed.investing_representative_mandates[0], can_apply: true }]
    proof.result = { ...applying, investing_representative_mandates: [{ ...applying.investing_representative_mandates![0], status: 'APPLIED', revision: 4, can_apply: false, applied_at: '2026-10-11T01:20:00Z', applied_by_user_id: admin, effective: true, next_owner: 'NONE' }] }
    mount(applying, '/portal/compliance/detail', mandateId)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply account-view mandate' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Apply account-view mandate' }))
    expect(proof.submit.mock.calls).toEqual([['review_investing_representative_mandate', reviewPayload], ['apply_investing_representative_mandate', { mandate_id: mandateId, expected_revision: 3 }]])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply account-view mandate' })).toBeNull())
    expect(screen.getByRole('heading', { name: 'Entity representative case' })).toBeTruthy()
    expect(screen.getByText('applied')).toBeTruthy()
  })

  it('does not offer staff review before the named representative consents', async () => {
    const context: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }
    const value = snapshot(reviewer, context); value.applications = [application()]
    value.investing_representative_mandates = [mandate({ can_review: true })]
    mount(value, '/portal/compliance/detail', mandateId)
    expect(screen.getByRole('button', { name: 'View document' })).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(screen.getByText('Named representative consent pending')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record entity mandate decision' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept representative proposal' })).toBeNull(); expect(proof.submit).not.toHaveBeenCalled()
  })

  it.each(['receipt', 'proposal', 'decision'] as const)('does not treat an incomplete %s on a named case as a self appointment', failure => {
    const context: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }
    const value = snapshot(reviewer, context); value.applications = [application()]
    const current = mandate({ status: 'SUBMITTED', revision: 2, can_review: true, can_respond: false,
      consent_decision: 'ACCEPT', consent_receipt_id: consentId, responded_at: '2026-10-11T01:05:00Z', next_owner: 'COMPLIANCE' })
    if (failure === 'receipt') current.consent_receipt_id = null
    if (failure === 'proposal') current.proposal_hash = null
    if (failure === 'decision') current.consent_decision = 'DECLINE'
    value.investing_representative_mandates = [current]
    mount(value, '/portal/compliance/detail', mandateId)
    expect(screen.getByText('Decision unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record entity mandate decision' })).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(proof.submit).not.toHaveBeenCalled()
  })

  it('lets the named target decline its exact current proposal when the document read is unavailable', async () => {
    proof.lookupFailure = true
    const value = snapshot()
    proof.result = { ...value, investing_representative_mandates: [mandate({ revision: 2, status: 'DECLINED', can_respond: false,
      consent_decision: 'DECLINE', consent_receipt_id: consentId, responded_at: '2026-10-11T01:05:00Z', next_owner: 'NONE' })] }
    mount(value)
    await waitFor(() => expect(screen.getByText('Appointment document unavailable')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Accept representative proposal' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Decline representative proposal' }))
    await waitFor(() => expect(screen.getByText(consentId)).toBeTruthy())
    expect(proof.submit.mock.calls).toEqual([['respond_investing_representative_proposal', { mandate_id: mandateId, expected_revision: 1, proposal_hash: proposalHash, decision: 'DECLINE' }]])
  })
})
