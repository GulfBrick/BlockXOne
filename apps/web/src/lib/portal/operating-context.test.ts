import { describe, expect, it } from 'vitest'
import { BX1_ROLES } from '../supabase/contracts'
import type { PortalInvestingRepresentativeMandate, PortalOrganisationMandate, PortalProductServiceAppointment, PortalSnapshot } from './contracts'
import { APPLICANT_CONTEXT, portalContextKey, portalContextMatches, portalOperatingContextSchema, portalScopeHref, portalViewAllowed, type PortalOperatingContext } from './operating-context'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const investor: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'Investor' }
const snapshot: PortalSnapshot = { actor: { id: 'actor', email: 'actor@example.invalid', display_name: null, can_review: false }, organisations: [], applications: [], products: [], subscriptions: [], events: [] }
const syntheticReviewer = '11111111-1111-4111-8111-111111111111'
const syntheticApplicant = '22222222-2222-4222-8222-222222222222'
const syntheticCaseId = '55555555-5555-4555-8555-555555555555'
const compliance: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'ComplianceOfficer' }
function syntheticSnapshot(): PortalSnapshot {
  return { actor: { id: syntheticReviewer, email: 'reviewer@example.invalid', display_name: null, can_review: true }, operating_context: compliance,
    rehearsal: { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: syntheticReviewer, operating_context: { mode: 'ROLE', organisationId: organisation, role: 'ComplianceOfficer' } },
    applications: [{ id: syntheticCaseId, user_id: syntheticApplicant, persona: 'INVESTOR', status: 'SUBMITTED', revision: 2,
      details: { full_name: 'Fictional Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Synthetic savings for this rehearsal only.', beneficial_owners: '', experience: 'Fictional experienced investor.', documents: [{ id: syntheticCaseId, kind: 'IDENTITY', title: 'Fictional identity manifest', storage_path: `${syntheticApplicant}/${syntheticCaseId}`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }], test_data_acknowledged: true },
      submitted_at: '2026-10-10T12:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null, admission_purpose: 'INVESTOR_ADMISSION' }],
    organisations: [], products: [], subscriptions: [], events: [], requests: [] }
}
const admin: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'SuperAdmin' }
const caseId = '55555555-5555-4555-8555-555555555555'
const future = '2099-10-20T00:00:00Z'
function organisationMandate(change: Partial<PortalOrganisationMandate> = {}): PortalOrganisationMandate {
  return { id: caseId, application_id: 'application', product_organisation_id: 'product-org', native_organisation_id: null,
    reviewer_scope_organisation_id: organisation, applicant_user_id: 'applicant', organisation_name: 'Fictional customer',
    role: 'OfferingManager', status: 'APPROVED', revision: 2, requested_until: future, evidence_reference: 'Synthetic appointment evidence',
    review_notes: 'Independent appointment review', reviewer_user_id: 'reviewer', applied_by_user_id: null,
    admission_revision: 3, admission_status: 'APPROVED', admission_approved_until: future,
    admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', effective: false, next_owner: 'SUPER_ADMIN',
    can_request: false, can_review: false, can_apply: true, can_revoke: false, ...change }
}
function entityMandate(change: Partial<PortalInvestingRepresentativeMandate> = {}): PortalInvestingRepresentativeMandate {
  return { id: caseId, investment_account_id: 'account', application_id: 'application', applicant_user_id: 'applicant',
    representative_user_id: 'representative', entity_party_id: 'entity', entity_name: 'Fictional entity',
    reviewer_scope_organisation_id: organisation, admission_revision: 3, admission_current_revision: 3,
    admission_approved_until: future, cycle: 1, revision: 2, status: 'APPROVED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'],
    transaction_limit_minor: '0', evidence_reference: 'Synthetic appointment evidence', appointment_document_id: 'document',
    requested_until: future, submitted_at: '2026-10-01T00:00:00Z', reviewed_at: '2026-10-02T00:00:00Z',
    reviewer_user_id: 'reviewer', review_notes: 'Independent appointment review', review_checks: {}, approval_receipt_id: 'receipt',
    applied_at: null, applied_by_user_id: null, revoked_at: null, revoke_reason: null, effective: false,
    next_owner: 'SUPER_ADMIN', can_request: false, can_review: false, can_apply: true, can_revoke: false, ...change }
}
function appointment(change: Partial<PortalProductServiceAppointment> = {}): PortalProductServiceAppointment {
  return { id: caseId, product_id: 'product', product_organisation_id: 'product-org', reviewer_scope_organisation_id: organisation,
    role: 'ComplianceOfficer', appointee_user_id: 'appointee', native_membership_id: 'membership', requested_by_user_id: 'requester',
    product_revision_at_request: 2, terms_hash_at_request: 'a'.repeat(64), evidence_reference: 'Synthetic appointment evidence',
    requested_until: future, status: 'APPROVED', revision: 2, requested_at: '2026-10-01T00:00:00Z',
    reviewed_at: '2026-10-02T00:00:00Z', reviewed_by_user_id: 'reviewer', review_notes: 'Independent appointment review',
    approval_receipt_id: 'receipt', applied_at: null, applied_by_user_id: null, revoked_at: null, revoke_reason: null,
    effective: false, next_owner: 'SUPER_ADMIN', can_review: false, can_apply: true, can_revoke: false, ...change }
}
type ApplyCaseKind = 'organisation' | 'entity' | 'appointment'
function applySnapshot(kind: ApplyCaseKind): PortalSnapshot {
  return { ...snapshot, operating_context: admin,
    ...(kind === 'organisation' ? { mandate_queue_available: true, organisation_mandates: [organisationMandate()] }
      : kind === 'entity' ? { entity_mandate_queue_available: true, investing_representative_mandates: [entityMandate()] }
        : { product_appointments: [appointment()] }) }
}
function applyCase(value: PortalSnapshot) {
  return (value.organisation_mandates ?? value.investing_representative_mandates ?? value.product_appointments ?? [])[0]
}
function appliedSnapshot(kind: ApplyCaseKind, proof: { approval_receipt_id?: string | null; applied_at?: string | null } = {
  approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: '2026-10-02T00:00:00Z',
}): PortalSnapshot {
  const value = applySnapshot(kind)
  const item = applyCase(value)
  item.status = 'APPLIED'; item.revision = 3; item.can_apply = false; item.can_revoke = true
  item.applied_by_user_id = value.actor.id; item.next_owner = 'NONE'
  if ('native_organisation_id' in item) item.native_organisation_id = otherOrganisation
  Object.assign(item, proof)
  return value
}

describe('strict personal and operational context', () => {
  it.each(BX1_ROLES)('accepts the exact %s context shape without granting authority', role => {
    expect(portalOperatingContextSchema.parse({ mode: 'ROLE', organisationId: organisation, role })).toEqual({ mode: 'ROLE', organisationId: organisation, role })
  })
  it.each([undefined, null, [], {}, { mode: 'applicant' }, { mode: 'ROLE' }, { mode: 'ROLE', organisationId: 'invalid', role: 'Investor' }, { mode: 'ROLE', organisationId: organisation, role: 'WealthManager' }, { ...investor, actor_id: 'another' }, { mode: 'APPLICANT', role: 'SuperAdmin' }, { mode: 'APPLICANT', organisationId: organisation }])('denies malformed or extra context authority %#', context => {
    expect(portalOperatingContextSchema.safeParse(context).success).toBe(false)
  })
  it('separates personal, organisation and role context identities', () => {
    expect(portalContextKey(APPLICANT_CONTEXT)).toBe('applicant')
    expect(portalContextKey(investor)).not.toBe(portalContextKey(APPLICANT_CONTEXT))
    expect(portalContextMatches(investor, investor)).toBe(true)
    expect(portalContextMatches({ ...investor, organisationId: otherOrganisation }, investor)).toBe(false)
    expect(portalContextMatches({ ...investor, role: 'SuperAdmin' }, investor)).toBe(false)
    expect(portalContextMatches(APPLICANT_CONTEXT, investor)).toBe(false)
    expect(portalContextMatches({ ...investor, extra: true }, investor)).toBe(false)
    expect(portalContextMatches(undefined, investor)).toBe(false)
  })
  it('preserves context and canonical subscription identity in funding links', () => {
    const url = new URL(portalScopeHref('/portal/orders/detail', investor, 'subscription'), 'https://example.invalid')
    expect(url.pathname).toBe('/portal/orders/detail')
    expect(url.searchParams.get('id')).toBe('subscription')
    expect(url.searchParams.get('role')).toBe('Investor')
    expect(url.searchParams.get('organisation')).toBe(organisation)
  })
})

describe('context-preserving navigation', () => {
  it.each(['/portal', '/portal/products', '/portal/products/detail', '/portal/compliance/detail', '/api/portal/documents'])('preserves the acting scope and selected record for %s', path => {
    const target = new URL(portalScopeHref(path, investor, 'record & 1'), 'https://example.invalid')
    expect(target.pathname).toBe(path)
    expect(target.searchParams.get('organisation')).toBe(organisation)
    expect(target.searchParams.get('role')).toBe('Investor')
    expect(target.searchParams.get('id')).toBe('record & 1')
    expect(target.searchParams.get('mode')).toBeNull()
  })
  it('replaces old role selection when entering personal onboarding', () => {
    const target = new URL(portalScopeHref(`/portal/onboarding?organisation=${organisation}&role=SuperAdmin&mode=invalid&status=draft`, APPLICANT_CONTEXT), 'https://example.invalid')
    expect(target.searchParams.get('mode')).toBe('applicant')
    expect(target.searchParams.get('organisation')).toBeNull()
    expect(target.searchParams.get('role')).toBeNull()
    expect(target.searchParams.get('status')).toBe('draft')
  })
  it('does not attach portal scope to account-security or unrelated destinations', () => {
    expect(portalScopeHref('/workspace/security', investor)).toBe('/workspace/security')
    expect(portalScopeHref('/login', investor)).toBe('/login')
  })
})

describe('view permissions do not substitute for backend authority', () => {
  it('restricts a validated synthetic projection to its root, queue and exact returned admission detail', () => {
    const value = syntheticSnapshot()
    expect(portalViewAllowed('/portal', compliance, value)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', compliance, value)).toBe(true)
    expect(portalViewAllowed('/portal/compliance/detail', compliance, value, syntheticCaseId)).toBe(true)
    expect(portalViewAllowed('/portal/compliance/detail', compliance, value)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', compliance, value, otherOrganisation)).toBe(false)
    for (const view of ['/portal/onboarding', '/portal/products', '/portal/products/new', '/portal/products/detail', '/portal/opportunities', '/portal/opportunities/detail', '/portal/portfolio', '/portal/orders/detail'] as const) expect(portalViewAllowed(view, compliance, value, syntheticCaseId)).toBe(false)
  })
  it.each(['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'] as const)('keeps exact saved synthetic %s decision visible without enabling a new type of record', status => {
    const value = syntheticSnapshot(); Object.assign(value.applications[0], { status, reviewed_at: '2026-10-10T12:30:00Z', reviewer_id: syntheticReviewer,
      review_notes: 'Fictional admission facts reviewed for this synthetic decision.', approved_until: status === 'APPROVED' ? '2099-01-01T00:00:00Z' : null,
      review_checks: { identity: true, ownership: true, screening: true, suitability: true } })
    expect(portalViewAllowed('/portal/compliance/detail', compliance, value, syntheticCaseId)).toBe(true)
    expect(portalViewAllowed('/portal/compliance/detail', compliance, value, 'mandate')).toBe(false)
  })
  it('denies malformed synthetic state, shared actor, wrong context and protected-array additions', () => {
    const values = [
      { ...syntheticSnapshot(), rehearsal: undefined },
      { ...syntheticSnapshot(), actor: { ...syntheticSnapshot().actor, id: syntheticApplicant } },
      { ...syntheticSnapshot(), organisation_mandates: [] },
      { ...syntheticSnapshot(), applications: [{ ...syntheticSnapshot().applications[0], status: 'DRAFT' as const }] },
      { ...syntheticSnapshot(), applications: [{ ...syntheticSnapshot().applications[0], user_id: syntheticReviewer }] },
    ]
    for (const value of values) expect(portalViewAllowed('/portal', compliance, value)).toBe(false)
    for (const context of [APPLICANT_CONTEXT, investor, admin, { ...compliance, organisationId: otherOrganisation }]) expect(portalViewAllowed('/portal/compliance', context, syntheticSnapshot())).toBe(false)
  })
  it.each(['organisation', 'entity', 'appointment'] as const)('opens only the exact approved server-scoped %s apply detail for Super Admin', kind => {
    const value = applySnapshot(kind)
    expect(portalViewAllowed('/portal/compliance/detail', admin, value, caseId)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', admin, value, caseId)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', admin, value)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', admin, value, 'unreturned-record')).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', { ...admin, organisationId: otherOrganisation }, value, caseId)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', APPLICANT_CONTEXT, value, caseId)).toBe(false)
    expect(value.actor.can_review).toBe(false)
  })
  it.each(['organisation', 'entity', 'appointment'] as const)('preserves the same %s detail after application with real own-actor proof', kind => {
    expect(portalViewAllowed('/portal/compliance/detail', admin, applySnapshot(kind), caseId)).toBe(true)
    const saved = appliedSnapshot(kind)
    expect(portalViewAllowed('/portal/compliance/detail', admin, saved, caseId)).toBe(true)
    expect(applyCase(saved).can_apply).toBe(false)
    expect(applyCase(saved).can_revoke).toBe(true)
    expect(saved.actor.can_review).toBe(false)
    // Historical receipt visibility is not renewed admission or mandate authority.
    applyCase(saved).requested_until = '2000-01-01T00:00:00Z'
    expect(portalViewAllowed('/portal/compliance/detail', admin, saved, caseId)).toBe(true)
  })
  it.each(['organisation', 'entity', 'appointment'] as const)('denies %s applied refresh for another applier or missing/unverifiable proof', kind => {
    const otherApplier = appliedSnapshot(kind); applyCase(otherApplier).applied_by_user_id = 'other-admin'
    expect(portalViewAllowed('/portal/compliance/detail', admin, otherApplier, caseId)).toBe(false)
    for (const proof of [{ approval_receipt_id: null, applied_at: '2026-10-02T00:00:00Z' },
      { approval_receipt_id: 'not-a-receipt', applied_at: '2026-10-02T00:00:00Z' },
      { approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: null },
      { approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: 'invalid-date' },
      { approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: future }]) {
      expect(portalViewAllowed('/portal/compliance/detail', admin, appliedSnapshot(kind, proof), caseId)).toBe(false)
    }
    const wrongScope = appliedSnapshot(kind); applyCase(wrongScope).reviewer_scope_organisation_id = otherOrganisation
    expect(portalViewAllowed('/portal/compliance/detail', admin, wrongScope, caseId)).toBe(false)
    expect(portalViewAllowed('/portal/compliance', admin, appliedSnapshot(kind), caseId)).toBe(false)
  })
  it.each(['organisation', 'entity', 'appointment'] as const)('denies changed %s state, scope, action, assurance projection and expiry', kind => {
    const denied: ((value: PortalSnapshot) => void)[] = [
      value => { applyCase(value).status = 'SUBMITTED' },
      value => { applyCase(value).status = 'APPLIED' },
      value => { applyCase(value).can_apply = false },
      value => { applyCase(value).can_review = true },
      value => { applyCase(value).can_revoke = true },
      value => { applyCase(value).next_owner = 'COMPLIANCE' },
      value => { applyCase(value).revision = 0 },
      value => { applyCase(value).reviewer_scope_organisation_id = otherOrganisation },
      value => { applyCase(value).requested_until = '2000-01-01T00:00:00Z' },
      value => { applyCase(value).requested_until = 'invalid-date' },
      value => { value.operating_context = undefined },
      value => { value.operating_context = { ...admin, organisationId: otherOrganisation } },
      value => { value.operating_context = { ...admin, role: 'ComplianceOfficer' } },
    ]
    for (const deny of denied) {
      const value = applySnapshot(kind); deny(value)
      expect(portalViewAllowed('/portal/compliance/detail', admin, value, caseId)).toBe(false)
    }
  })
  it('refuses applicant/product IDs, duplicate case types and account-wide reviewer flags for Super Admin', () => {
    const value = applySnapshot('organisation')
    value.actor = { ...value.actor, can_review: true }
    expect(portalViewAllowed('/portal/compliance', admin, value)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', admin, value, 'application')).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', admin, value, 'product-org')).toBe(false)
    value.product_appointments = [appointment()]
    expect(portalViewAllowed('/portal/compliance/detail', admin, value, caseId)).toBe(false)
  })
  it('requires current admitted mandate projections and independent applicant, representative and reviewer', () => {
    const customer = applySnapshot('organisation')
    customer.organisation_mandates = [organisationMandate({ applicant_user_id: snapshot.actor.id })]
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    customer.organisation_mandates = [organisationMandate({ reviewer_user_id: snapshot.actor.id })]
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    customer.organisation_mandates = [organisationMandate({ admission_status: 'REJECTED' })]
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    customer.organisation_mandates = [organisationMandate({ admission_approved_until: '2000-01-01T00:00:00Z' })]
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    customer.organisation_mandates = [organisationMandate()]; customer.mandate_queue_available = false
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    customer.mandate_queue_available = true; customer.mandate_queue_blocked_reason = 'MFA_REQUIRED'
    expect(portalViewAllowed('/portal/compliance/detail', admin, customer, caseId)).toBe(false)
    const entity = applySnapshot('entity')
    for (const change of [{ applicant_user_id: snapshot.actor.id }, { representative_user_id: snapshot.actor.id },
      { reviewer_user_id: snapshot.actor.id }, { reviewer_user_id: null }, { approval_receipt_id: null },
      { admission_current_revision: 4 }, { admission_approved_until: null }]) {
      entity.investing_representative_mandates = [entityMandate(change)]
      expect(portalViewAllowed('/portal/compliance/detail', admin, entity, caseId)).toBe(false)
    }
    entity.investing_representative_mandates = [entityMandate()]; entity.entity_mandate_queue_blocked_reason = 'NOT_ADMITTED'
    expect(portalViewAllowed('/portal/compliance/detail', admin, entity, caseId)).toBe(false)
  })
  it('requires a product appointment approval receipt and independent appointee, requester and reviewer', () => {
    const value = applySnapshot('appointment')
    for (const change of [{ appointee_user_id: snapshot.actor.id }, { requested_by_user_id: snapshot.actor.id },
      { reviewed_by_user_id: snapshot.actor.id }, { reviewed_by_user_id: null }, { approval_receipt_id: null }]) {
      value.product_appointments = [appointment(change)]
      expect(portalViewAllowed('/portal/compliance/detail', admin, value, caseId)).toBe(false)
    }
  })
  it.each(['OfferingManager', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'] as const)('requires native bound %s authority for operational funding detail', role => {
    const context = { ...investor, role }
    const data: PortalSnapshot = { ...snapshot, organisations: [{ id: 'product-org', name: 'A', status: 'ACTIVE', roles: [role], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
    expect(portalViewAllowed('/portal/orders/detail', context, data)).toBe(true)
    expect(portalViewAllowed('/portal/orders/detail', { ...context, organisationId: otherOrganisation }, data)).toBe(false)
    expect(portalViewAllowed('/portal/orders/detail', context, snapshot)).toBe(false)
  })
  it.each(['SuperAdmin', 'TransferAgent', 'TokenisationAgent', 'ComplianceOfficer'] as const)('does not promote %s into the funding workflow', role => {
    expect(portalViewAllowed('/portal/orders/detail', { ...investor, role }, snapshot)).toBe(false)
  })
  it('admits own investor detail without granting access to an arbitrary order', () => {
    expect(portalViewAllowed('/portal/orders/detail', investor, snapshot)).toBe(true)
    expect(portalViewAllowed('/portal/orders/detail', APPLICANT_CONTEXT, snapshot)).toBe(true)
    // The detail component still resolves only subscription IDs in the scoped snapshot.
  })
  it('keeps personal onboarding available but prevents applicant access to reviewer or mapped staff screens', () => {
    const data: PortalSnapshot = { ...snapshot, actor: { ...snapshot.actor, can_review: true }, organisations: [{ id: 'portal-org', name: 'A', status: 'ACTIVE', roles: ['OfferingManager'], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
    expect(portalViewAllowed('/portal/onboarding', APPLICANT_CONTEXT, data)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', APPLICANT_CONTEXT, data)).toBe(false)
    expect(portalViewAllowed('/portal/compliance/detail', APPLICANT_CONTEXT, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, data)).toBe(false)
  })
  it('permits only the explicitly unbound legacy-owner product path in applicant context', () => {
    const data: PortalSnapshot = { ...snapshot, organisations: [{ id: 'legacy-org', name: 'Legacy A', status: 'ACTIVE', roles: ['OfferingManager'], authority_source: 'LEGACY_OWNER' }] }
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, data)).toBe(true)
    expect(portalViewAllowed('/portal/products', APPLICANT_CONTEXT, { ...data, organisations: [{ ...data.organisations[0], status: 'SUSPENDED' }] })).toBe(false)
  })
  it('requires matching native organisation and role for a product workspace', () => {
    const manager: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
    const data: PortalSnapshot = { ...snapshot, organisations: [{ id: 'bound-org', name: 'A', status: 'ACTIVE', roles: ['OfferingManager'], native_organisation_id: organisation, authority_source: 'NATIVE_BINDING' }] }
    expect(portalViewAllowed('/portal/products/new', manager, data)).toBe(true)
    expect(portalViewAllowed('/portal/products/new', { ...manager, organisationId: otherOrganisation }, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', investor, data)).toBe(false)
    expect(portalViewAllowed('/portal/products', manager, { ...data, organisations: [{ ...data.organisations[0], status: 'REVOKED' }] })).toBe(false)
  })
  it('does not make an account-wide reviewer flag sufficient outside the selected compliance role', () => {
    const data = { ...snapshot, actor: { ...snapshot.actor, can_review: true } }
    expect(portalViewAllowed('/portal/compliance', investor, data)).toBe(false)
    expect(portalViewAllowed('/portal/compliance', { ...investor, role: 'ComplianceOfficer' }, data)).toBe(true)
    expect(portalViewAllowed('/portal/compliance', { ...investor, role: 'ComplianceOfficer' }, snapshot)).toBe(false)
  })
  it.each(['OfferingManager', 'IssuerFundManager', 'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin'] as const)('does not use %s as an investor instruction role', role => {
    expect(portalViewAllowed('/portal/portfolio', { ...investor, role }, snapshot)).toBe(false)
    expect(portalViewAllowed('/portal/opportunities/detail', { ...investor, role }, snapshot)).toBe(false)
  })
})
