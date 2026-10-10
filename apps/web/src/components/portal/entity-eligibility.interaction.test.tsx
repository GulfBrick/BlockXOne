// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, validatedEntityProductEligibility, type PortalApplication, type PortalEntityProductEligibility, type PortalProduct, type PortalSnapshot } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT } from '@/lib/portal/operating-context'

// Mounted React forms and current-snapshot gates, with only the command boundary
// mocked. This is not SQL, provider, scanner, hosted or independent-human proof.
const boundary = vi.hoisted(() => ({ submit: vi.fn(), result: undefined as PortalSnapshot | undefined, busy: false, unknown: false }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('./portal-client', async importOriginal => ({
  ...await importOriginal<typeof import('./portal-client')>(),
  usePortalCommand: (onSaved: (snapshot: PortalSnapshot) => void) => ({
    busy: boundary.busy, unknown: boundary.unknown, message: '', retry: vi.fn(),
    submit: async (command: string, payload: Record<string, unknown>) => {
      boundary.submit(command, payload)
      if (boundary.result) onSaved(boundary.result)
      return true
    },
  }),
}))
import { fictionalProductTerms } from './product-form'
import { EntityProductEligibilityPanel, ProductEligibilityReview } from './portal-workflows'

const actor = '11111111-1111-4111-8111-111111111111'
const reviewer = '22222222-2222-4222-8222-222222222222'
const issuer = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const applicationId = '55555555-5555-4555-8555-555555555555'
const entityPartyId = '66666666-6666-4666-8666-666666666666'
const accountId = '77777777-7777-4777-8777-777777777777'
const mandateId = '88888888-8888-4888-8888-888888888888'
const offeringId = '99999999-9999-4999-8999-999999999999'
const caseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const appointmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const sourceDocumentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const termsHash = 'ab'.repeat(32)
const statement = 'The fictional entity seeks a synthetic long-term allocation using fictional retained earnings.'
const application: PortalApplication = {
  id: applicationId, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 1,
  approved_until: '2099-01-01T00:00:00Z', submitted_at: '2026-10-09T10:00:00Z', reviewed_at: '2026-10-09T11:00:00Z',
  reviewer_id: reviewer, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW',
  details: { full_name: 'Synthetic Entity Representative', country: 'ZA', investor_type: 'ENTITY', company_name: 'Synthetic Legal Holder',
    registration_reference: 'SYNTH-ENTITY-001', source_of_funds: 'Fictional retained earnings for the synthetic entity.',
    beneficial_owners: 'Fictional disclosed owner and control evidence.', experience: 'Synthetic long-term entity investment objectives.',
    documents: [{ id: sourceDocumentId, kind: 'COMPANY', title: 'Synthetic entity evidence', storage_path: `${actor}/synthetic-company.pdf`,
      sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }], test_data_acknowledged: true },
}
const nestedSource = { id: application.id, revision: application.revision, status: application.status, approved_until: application.approved_until, details: application.details }
function product(): PortalProduct {
  return { id: productId, organisation_id: issuer, created_by: issuer, revision: 3, status: 'PUBLISHED', terms: fictionalProductTerms(),
    terms_hash: termsHash, reserved_units: '0', created_at: '2026-10-09T10:00:00Z', reviewer_id: reviewer, review_notes: null,
    reviewed_at: '2026-10-09T11:00:00Z', published_at: '2026-10-09T12:00:00Z', review_checks: {}, offering_history: [],
    offering_package: { id: offeringId, package_number: 1, origin: 'SUBMITTED', terms_hash: termsHash,
      document_hashes: { memorandum: 'cd'.repeat(32), risks: 'de'.repeat(32), subscription_terms: 'ef'.repeat(32) },
      submitted_at: '2026-10-09T10:00:00Z', issuer_status: 'APPROVED', compliance_status: 'APPROVED', technical_readiness_status: 'VERIFIED',
      publishable: false, subscribable: true, can_review_issuer: false } }
}
function entityCase(change: Partial<PortalEntityProductEligibility> = {}): PortalEntityProductEligibility {
  return { id: caseId, investment_account_id: accountId, product_id: productId, organisation_id: issuer, account_kind: 'ENTITY',
    entity_party_id: entityPartyId, entity_name: 'Synthetic Legal Holder', representative_user_id: actor, representative_mandate_id: mandateId,
    mandate_cycle: 1, mandate_revision: 3, application_revision: 1, product_revision: 3, offering_revision_id: offeringId, terms_hash: termsHash,
    revision: 1, status: 'SUBMITTED', investor_statement: statement, submitted_at: '2026-10-09T10:00:00Z', reviewed_at: null, reviewer_id: null,
    review_notes: null, review_checks: {}, approved_until: null, effective: false, can_decide: false, can_approve: false, can_revoke: false,
    decision_appointment_id: null, decision_appointment_revision: null, provider_mode: 'MANUAL_TEST_REVIEW', next_owner: 'COMPLIANCE',
    can_request: false, blocked_reason: null, investor_application: null, ...change }
}
function snapshot(item?: PortalEntityProductEligibility, staff = false): PortalSnapshot {
  return { actor: { id: staff ? reviewer : actor, email: 'synthetic@example.invalid', display_name: staff ? 'Synthetic reviewer' : 'Synthetic representative', can_review: staff },
    applications: [application], organisations: [], products: [product()], subscriptions: [], events: [], accounts: [], product_eligibility: [],
    entity_product_eligibility: item ? [item] : [], operating_context: staff ? { mode: 'ROLE', organisationId: issuer, role: 'ComplianceOfficer' } : APPLICANT_CONTEXT,
    entity_investment_accounts: [{ id: accountId, application_id: applicationId, entity_party_id: entityPartyId, entity_name: 'Synthetic Legal Holder',
      registration_reference: 'SYNTH-ENTITY-001', country: 'ZA', kind: 'ENTITY', status: 'ACTIVE', created_at: '2026-10-09T10:00:00Z',
      admission_revision: 1, admission_approved_until: application.approved_until, can_view: true, can_request_mandate: false, can_request_eligibility: !staff }],
    investing_representative_mandates: [{ id: mandateId, investment_account_id: accountId, application_id: applicationId, applicant_user_id: actor,
      representative_user_id: actor, entity_party_id: entityPartyId, entity_name: 'Synthetic Legal Holder', reviewer_scope_organisation_id: issuer,
      admission_revision: 1, admission_current_revision: 1, admission_approved_until: application.approved_until, cycle: 1, revision: 3,
      status: 'APPLIED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], transaction_limit_minor: '0', evidence_reference: 'Fictional exact entity appointment evidence.',
      appointment_document_id: sourceDocumentId, requested_until: '2098-12-31T00:00:00Z', submitted_at: '2026-10-09T10:00:00Z',
      reviewed_at: '2026-10-09T11:00:00Z', reviewer_user_id: reviewer, review_notes: null, review_checks: {}, approval_receipt_id: appointmentId,
      applied_at: '2026-10-09T12:00:00Z', applied_by_user_id: issuer, revoked_at: null, revoke_reason: null, effective: true, next_owner: 'NONE',
      can_request: false, can_review: false, can_apply: false, can_revoke: false }] }
}
function applicant(value: PortalSnapshot, onSaved: (snapshot: PortalSnapshot) => void) {
  return <EntityProductEligibilityPanel key={`applicant:${value.entity_product_eligibility?.[0]?.revision ?? 0}`} product={value.products[0]} snapshot={value} onSaved={onSaved} />
}
function staff(value: PortalSnapshot, onSaved: (snapshot: PortalSnapshot) => void) {
  return <ProductEligibilityReview key={`staff:${value.entity_product_eligibility![0].revision}`} eligibility={value.entity_product_eligibility![0]} product={value.products[0]} snapshot={value} onSaved={onSaved} />
}
function expectCommand(index: number, command: string, payload: Record<string, unknown>) {
  expect(boundary.submit.mock.calls[index]).toEqual([command, payload])
  expect(portalCommandSchema.safeParse({ command, key: appointmentId, payload }).success).toBe(true)
}
beforeEach(() => { boundary.submit.mockReset(); boundary.result = undefined; boundary.busy = false; boundary.unknown = false; vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network is authorised by this mounted command-boundary proof.') })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('mounted entity eligibility command-boundary proof', () => {
  it('requests, receives information request, resubmits the same case, reviews and protectively revokes without a transaction', async () => {
    const onSaved = vi.fn()
    const submitted = snapshot(entityCase())
    boundary.result = submitted
    const mounted = render(applicant(snapshot(), onSaved))
    fireEvent.change(screen.getByLabelText(/^Entity investment statement/), { target: { value: statement } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit entity for product eligibility review' }))
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(submitted))
    const requestPayload = { product_id: productId, investment_account_id: accountId, expected_revision: 0, investor_statement: statement,
      representative_mandate_id: mandateId, expected_mandate_revision: 3, expected_mandate_cycle: 1, expected_product_revision: 3,
      offering_revision_id: offeringId, terms_hash: termsHash }
    expectCommand(0, 'request_product_eligibility', requestPayload)
    mounted.rerender(applicant(submitted, onSaved))
    expect(screen.getByText('Independent entity review pending')).toBeTruthy()

    const requestNotes = 'Clarify the fictional entity retained-earnings source for this exact offering.'
    const changes = snapshot(entityCase({ revision: 2, status: 'CHANGES_REQUIRED', can_request: true, next_owner: 'APPLICANT', review_notes: requestNotes,
      reviewed_at: '2026-10-09T12:30:00Z', reviewer_id: reviewer, decision_appointment_id: appointmentId, decision_appointment_revision: 2 }))
    boundary.result = changes
    mounted.rerender(staff(snapshot(entityCase({ can_decide: true, can_approve: true, investor_application: nestedSource }), true), onSaved))
    fireEvent.change(screen.getByLabelText(/^Entity review rationale/), { target: { value: requestNotes } })
    fireEvent.click(screen.getByRole('button', { name: 'Record entity eligibility decision' }))
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(changes))
    expectCommand(1, 'review_product_eligibility', { eligibility_case_id: caseId, expected_revision: 1, decision: 'CHANGES_REQUIRED', notes: requestNotes,
      checks: { identity: false, product_fit: false, restrictions: false, source_of_funds: false } })

    const updatedStatement = `${statement} The synthetic accounts contain no customer money.`
    const resubmitted = snapshot(entityCase({ revision: 3, investor_statement: updatedStatement }))
    boundary.result = resubmitted
    mounted.rerender(applicant(changes, onSaved))
    expect(screen.getByText(requestNotes)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Entity investment statement/), { target: { value: updatedStatement } })
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit same entity eligibility case' }))
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(resubmitted))
    expectCommand(2, 'request_product_eligibility', { ...requestPayload, expected_revision: 2, investor_statement: updatedStatement })
    expect(resubmitted.entity_product_eligibility![0].id).toBe(changes.entity_product_eligibility![0].id)

    const approveNotes = 'Synthetic entity admission, mandate and exact published offering independently reviewed.'
    const approvedCase = entityCase({ revision: 4, status: 'APPROVED', reviewed_at: '2026-10-09T13:00:00Z', reviewer_id: reviewer,
      review_notes: approveNotes, approved_until: '2098-01-01T00:00:00Z', effective: true, next_owner: 'NONE',
      decision_appointment_id: appointmentId, decision_appointment_revision: 2,
      review_checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true } })
    const approved = snapshot(approvedCase)
    expect(validatedEntityProductEligibility(approved)).toHaveLength(1)
    boundary.result = approved
    mounted.rerender(staff(snapshot(entityCase({ revision: 3, can_decide: true, can_approve: true, investor_application: nestedSource }), true), onSaved))
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    fireEvent.change(screen.getByLabelText('Entity eligibility decision'), { target: { value: 'APPROVED' } })
    fireEvent.change(screen.getByLabelText(/^Entity review rationale/), { target: { value: approveNotes } })
    fireEvent.click(screen.getByRole('button', { name: 'Record entity eligibility decision' }))
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(approved))
    expectCommand(3, 'review_product_eligibility', { eligibility_case_id: caseId, expected_revision: 3, decision: 'APPROVED', notes: approveNotes,
      checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true } })
    mounted.rerender(applicant(approved, onSaved))
    expect(screen.getByText('Entity eligibility decision current')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /subscribe|reserve units|fund|issue tokens/i })).toBeNull()

    const revokeReason = 'Protective synthetic revocation after the entity mandate and source evidence expired.'
    const revoked = snapshot(entityCase({ ...approvedCase, revision: 5, status: 'REVOKED', effective: false, can_revoke: false }))
    boundary.result = revoked
    const protective = snapshot({ ...approvedCase, effective: false, can_revoke: true, investor_application: null }, true)
    protective.investing_representative_mandates![0].effective = false
    protective.applications = []
    mounted.rerender(staff(protective, onSaved))
    fireEvent.change(screen.getByLabelText(/^Entity revocation reason/), { target: { value: revokeReason } })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke entity product eligibility' }))
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(revoked))
    expectCommand(4, 'revoke_product_eligibility', { eligibility_case_id: caseId, expected_revision: 4, reason: revokeReason })
    mounted.rerender(applicant(revoked, onSaved))
    expect(screen.getByText('Entity eligibility revoked')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Resubmit|Submit entity/ })).toBeNull()
    expect(boundary.submit.mock.calls.map(([command]) => command)).toEqual(['request_product_eligibility', 'review_product_eligibility', 'request_product_eligibility', 'review_product_eligibility', 'revoke_product_eligibility'])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('cannot submit typed answers after the authoritative account gate closes, or with ambiguous mandate state', () => {
    const value = snapshot()
    const mounted = render(applicant(value, vi.fn()))
    fireEvent.change(screen.getByLabelText(/^Entity investment statement/), { target: { value: statement } })
    const blocked = { ...value, entity_investment_accounts: [{ ...value.entity_investment_accounts![0], can_request_eligibility: false }] }
    mounted.rerender(applicant(blocked, vi.fn()))
    expect(screen.getByText('Entity eligibility request denied')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit entity for product eligibility review' })).toBeNull()
    const ambiguous = { ...value, investing_representative_mandates: [...value.investing_representative_mandates!, { ...value.investing_representative_mandates![0], id: appointmentId }] }
    mounted.rerender(applicant(ambiguous, vi.fn()))
    expect(screen.queryByRole('button', { name: 'Submit entity for product eligibility review' })).toBeNull()
    expect(boundary.submit).not.toHaveBeenCalled()
  })

  it('does not silently move typed answers to another legal-holder account after a saved refresh', () => {
    const value = snapshot()
    const mounted = render(applicant(value, vi.fn()))
    fireEvent.change(screen.getByLabelText(/^Entity investment statement/), { target: { value: statement } })
    const replacement = { ...value, entity_investment_accounts: [{ ...value.entity_investment_accounts![0], id: appointmentId, entity_name: 'Second Synthetic Legal Holder' }],
      investing_representative_mandates: [{ ...value.investing_representative_mandates![0], investment_account_id: appointmentId }] }
    mounted.rerender(applicant(replacement, vi.fn()))
    expect((screen.getByLabelText('Entity legal-holder account') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Submit entity for product eligibility review' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Entity legal-holder account'), { target: { value: appointmentId } })
    expect((screen.getByLabelText(/^Entity investment statement/) as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Submit entity for product eligibility review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(boundary.submit).not.toHaveBeenCalled()
  })

  it('blocks a pending or uncertain command from dispatching another entity request', () => {
    const value = snapshot()
    const mounted = render(applicant(value, vi.fn()))
    fireEvent.change(screen.getByLabelText(/^Entity investment statement/), { target: { value: statement } })
    boundary.busy = true
    mounted.rerender(applicant(value, vi.fn()))
    fireEvent.submit(screen.getByRole('button', { name: 'Submit entity for product eligibility review' }).closest('form')!)
    boundary.busy = false; boundary.unknown = true
    mounted.rerender(applicant(value, vi.fn()))
    fireEvent.submit(screen.getByRole('button', { name: 'Submit entity for product eligibility review' }).closest('form')!)
    expect(boundary.submit).not.toHaveBeenCalled()
  })

  it('does not approve from a missing nested source, another capacity or same-human reviewer', () => {
    const item = entityCase({ can_decide: true, can_approve: true })
    const value = snapshot(item, true)
    const mounted = render(staff(value, vi.fn()))
    expect(screen.getByText('Entity admission evidence unavailable')).toBeTruthy()
    expect((screen.getByRole('option', { name: 'Approve entity eligibility decision only' }) as HTMLOptionElement).disabled).toBe(true)
    value.actor.id = actor
    mounted.rerender(staff({ ...value }, vi.fn()))
    expect(screen.queryByRole('button', { name: 'Record entity eligibility decision' })).toBeNull()
    const wrongCapacity = snapshot({ ...item, investor_application: { ...nestedSource, details: { ...application.details, investor_type: 'INDIVIDUAL' } as PortalApplication['details'] } }, true)
    mounted.rerender(staff(wrongCapacity, vi.fn()))
    expect(screen.getByText('Entity eligibility records unavailable')).toBeTruthy()
    expect(boundary.submit).not.toHaveBeenCalled()
  })
})
