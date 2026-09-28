import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PortalProduct, PortalProductServiceAppointment, PortalSnapshot } from '@/lib/portal/contracts'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import { fictionalProductTerms } from './product-form'
import { ProductAppointmentDecision, ProductAppointmentQueue, ProductAppointmentRequest } from './product-service-appointments'

vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const person = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const productOrganisation = '33333333-3333-4333-8333-333333333333'
const reviewOrganisation = '44444444-4444-4444-8444-444444444444'
const membership = '55555555-5555-4555-8555-555555555555'
const appointee = '66666666-6666-4666-8666-666666666666'
const appointmentId = '77777777-7777-4777-8777-777777777777'
const termsHash = 'ab'.repeat(32)
const managerContext: PortalOperatingContext = { mode: 'ROLE', role: 'OfferingManager', organisationId: reviewOrganisation }
const complianceContext: PortalOperatingContext = { mode: 'ROLE', role: 'ComplianceOfficer', organisationId: reviewOrganisation }

function product(change: Partial<PortalProduct> = {}): PortalProduct {
  return { id: productId, organisation_id: productOrganisation, created_by: person, revision: 2,
    status: 'IN_REVIEW', terms: fictionalProductTerms(), terms_hash: termsHash, reserved_units: '0',
    created_at: '2026-09-20T10:00:00Z', reviewer_id: null, review_notes: null,
    reviewed_at: null, published_at: null, review_checks: {}, offering_history: [],
    offering_package: { id: '88888888-8888-4888-8888-888888888888', package_number: 1,
      origin: 'SUBMITTED', terms_hash: termsHash, document_hashes: { memorandum: 'cd'.repeat(32), risks: 'de'.repeat(32), subscription_terms: 'ef'.repeat(32) },
      submitted_at: '2026-09-20T10:00:00Z', issuer_status: 'PENDING', compliance_status: 'PENDING',
      technical_readiness_status: 'NOT_VERIFIED', publishable: false, subscribable: false, can_review_issuer: false }, ...change }
}
function appointment(change: Partial<PortalProductServiceAppointment> = {}): PortalProductServiceAppointment {
  return { id: appointmentId, product_id: productId, product_organisation_id: productOrganisation,
    reviewer_scope_organisation_id: reviewOrganisation, role: 'IssuerFundManager',
    appointee_user_id: appointee, native_membership_id: membership, requested_by_user_id: person,
    product_revision_at_request: 2, terms_hash_at_request: termsHash, evidence_reference: 'Synthetic board mandate REF-001',
    requested_until: '2026-10-20T00:00:00Z', status: 'SUBMITTED', revision: 1,
    requested_at: '2026-09-20T10:00:00Z', reviewed_at: null, reviewed_by_user_id: null,
    review_notes: null, approval_receipt_id: null, applied_at: null, applied_by_user_id: null,
    revoked_at: null, revoke_reason: null, effective: false, next_owner: 'COMPLIANCE',
    can_review: true, can_apply: false, can_revoke: false, ...change }
}
function snapshot(change: Partial<PortalSnapshot> = {}): PortalSnapshot {
  return { actor: { id: person, email: 'manager@example.invalid', display_name: 'Manager', can_review: false },
    applications: [], products: [product()], subscriptions: [], events: [],
    organisations: [{ id: productOrganisation, name: 'Fictional Product Organisation', status: 'ACTIVE',
      roles: ['OfferingManager'], native_organisation_id: reviewOrganisation,
      authority_source: 'NATIVE_BINDING', capabilities: ['save_product', 'submit_product'] }],
    product_appointments: [], product_appointment_candidates: [{ product_id: productId, role: 'IssuerFundManager',
      user_id: appointee, membership_id: membership, display_name: 'Separate Issuer', email: 'issuer@example.invalid' }], ...change }
}

describe('connected product service appointment surfaces', () => {
  it('shows product-level manager requests with an existing role candidate', () => {
    const html = renderToStaticMarkup(<ProductAppointmentRequest product={product()} snapshot={snapshot()} operatingContext={managerContext} onSaved={() => {}} />)
    expect(html).toContain('Request an independent service appointment')
    expect(html).toContain('Separate Issuer')
    expect(html).toContain('Request appointment review')
    const applicant = renderToStaticMarkup(<ProductAppointmentRequest product={product()} snapshot={snapshot()} operatingContext={{ mode: 'APPLICANT' }} onSaved={() => {}} />)
    expect(applicant).not.toContain('Request an independent service appointment')
    const draft = renderToStaticMarkup(<ProductAppointmentRequest product={product({ status: 'DRAFT', offering_package: null })} snapshot={snapshot()} operatingContext={managerContext} onSaved={() => {}} />)
    expect(draft).toContain('Request an independent service appointment')
  })
  it('treats an unavailable appointment snapshot as unavailable, not an empty queue', () => {
    const unavailable = snapshot({ product_appointments: undefined })
    expect(renderToStaticMarkup(<ProductAppointmentRequest product={product()} snapshot={unavailable} operatingContext={managerContext} onSaved={() => {}} />)).toContain('Appointment service unavailable')
    expect(renderToStaticMarkup(<ProductAppointmentQueue snapshot={unavailable} operatingContext={complianceContext} />)).toContain('Appointment queue unavailable')
  })
  it('lists only server-marked role actions and keeps independent decision controls scoped', () => {
    const item = appointment()
    const queue = renderToStaticMarkup(<ProductAppointmentQueue snapshot={snapshot({ product_appointments: [item] })} operatingContext={complianceContext} />)
    expect(queue).toContain('Review appointment')
    expect(queue).toContain(item.id)
    const denied = renderToStaticMarkup(<ProductAppointmentDecision appointment={appointment({ can_review: false })} snapshot={snapshot()} onSaved={() => {}} />)
    expect(denied).toContain('No action in this scope')
    expect(denied).not.toContain('Record review')
    const reviewer = renderToStaticMarkup(<ProductAppointmentDecision appointment={item} snapshot={snapshot()} onSaved={() => {}} />)
    expect(reviewer).toContain('Record review')
    expect(reviewer).not.toContain('Apply product appointment')
  })
})
