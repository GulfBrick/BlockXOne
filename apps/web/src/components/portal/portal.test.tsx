import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_PATHS, productTermsSchema, type PortalApplication, type PortalEntityInvestmentAccount, type PortalInvestmentAccount, type PortalInvestingRepresentativeMandate, type PortalOrganisation, type PortalOrganisationMandate, type PortalPageData, type PortalProduct, type PortalProductEligibility, type PortalSnapshot, type PortalSubscription } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { Bx1Role } from '@/lib/supabase/contracts'
import { PortalScreen, productManagementOrganisations } from './portal-screens'
import { portalNavigation, PortalShell } from './portal-shell'
import { fictionalProductTerms } from './product-form'
import { ApplicationReview, InvestmentAccountPanel, IssuerOfferingReview, OfferingPackageEvidence, ProductActions, ProductEligibilityPanel, ProductReview, SubscriptionForm, activeIndividualAccounts, currentInvestorApplication, currentProductEligibility } from './portal-workflows'
import { postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import { money } from './portal-primitives'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props} data-client-navigation="true">{children}</a> }))

const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const applicationId = '55555555-5555-4555-8555-555555555555'
const requestKey = '66666666-6666-4666-8666-666666666666'
const nativeOrganisation = '77777777-7777-4777-8777-777777777777'
const accountId = '88888888-8888-4888-8888-888888888888'
const otherOrganisation = '99999999-9999-4999-8999-999999999999'
const entityApplicationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const entityAccountId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const entityMandateId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const companyDocumentId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
function snapshot(): PortalSnapshot { return { actor: { id: actor, email: 'synthetic@example.invalid', display_name: 'Synthetic User', can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [], accounts: [], product_eligibility: [], operating_context: APPLICANT_CONTEXT } }
function account(change: Partial<PortalInvestmentAccount> = {}): PortalInvestmentAccount { return { id: accountId, holder_user_id: actor, application_id: applicationId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: '2026-09-20T10:00:00Z', ...change } }
const offeringRevisionId = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c'
function eligibility(change: Partial<PortalProductEligibility> = {}): PortalProductEligibility { return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', investment_account_id: accountId, product_id: productId, organisation_id: organisation, product_revision: 3, offering_revision_id: offeringRevisionId, terms_hash: 'ab'.repeat(32), application_revision: 1, revision: 2, status: 'APPROVED', investor_statement: 'This fictional product fits the synthetic investor objectives and test funds.', submitted_at: '2026-09-20T10:00:00Z', reviewed_at: '2026-09-20T11:00:00Z', reviewer_id: other, review_notes: 'Synthetic offering restrictions and account evidence independently reviewed.', review_checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true }, approved_until: '2099-01-01T00:00:00Z', effective: true, can_decide: false, can_approve: false, can_revoke: false, holder_user_id: actor, product_name: 'Fictional Test Fund', account_kind: 'INDIVIDUAL', investor_application: application(), ...change } }
function operating(role: Bx1Role): PortalOperatingContext { return { mode: 'ROLE', organisationId: nativeOrganisation, role } }
function order(change: Partial<PortalSubscription> = {}): PortalSubscription { return { id: requestKey, product_id: productId, investment_account_id: accountId, investor_id: actor, product_name: 'Fictional Test Fund', organisation_id: organisation, product_revision: 3, offering_revision_id: offeringRevisionId, terms_hash: 'ab'.repeat(32), units: '10', amount_minor: '100000', status: 'AWAITING_FUNDING', created_at: '2026-09-20T10:00:00Z', can_cancel: true, ...change } }
function operatorOrganisation(role: 'OfferingManager' | 'IssuerFundManager' = 'OfferingManager'): PortalOrganisation {
  return { id: organisation, name: 'Fictional Product Organisation', status: 'ACTIVE', roles: [role], native_organisation_id: nativeOrganisation, authority_source: 'NATIVE_BINDING' as const, capabilities: ['create_product', 'save_product', 'submit_product', 'publish_product', 'read_orders'] }
}
function application(change: Partial<PortalApplication> = {}): PortalApplication {
  return { id: applicationId, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 1, details: { full_name: 'Synthetic Investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Entirely fictional test savings for workflow validation.', beneficial_owners: '', experience: 'Fictional investment experience for manual test review.', documents: [], test_data_acknowledged: true }, submitted_at: '2026-09-20T10:00:00Z', reviewed_at: '2026-09-20T11:00:00Z', reviewer_id: other, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z', ...change }
}
function managerApplication(change: Partial<PortalApplication> = {}): PortalApplication {
  return application({ persona: 'WEALTH_MANAGER', user_id: other, organisation_id: organisation, admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION', details: {
    details_version: 2, full_name: 'Synthetic Customer Representative', country: 'ZA', company_name: 'Fictional Manager Client',
    registration_reference: 'SYNTHETIC-REG-001', beneficial_owners: 'Fictional owners and share proportions for test review.',
    business_activities: 'Fictional wealth management and product structuring for the test environment.',
    representative_position: 'Synthetic authorised representative', authority_basis: 'Synthetic appointment by fictional company board for this rehearsal.',
    documents: [], test_data_acknowledged: true,
  }, ...change })
}
function representativeMandate(change: Partial<PortalOrganisationMandate> = {}): PortalOrganisationMandate {
  return { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', application_id: applicationId, product_organisation_id: organisation,
    native_organisation_id: null, reviewer_scope_organisation_id: nativeOrganisation, applicant_user_id: other,
    organisation_name: 'Fictional Manager Client', role: 'OfferingManager', status: 'SUBMITTED', revision: 1,
    requested_until: '2099-01-01T00:00:00Z', evidence_reference: 'SYNTHETIC-APPOINTMENT-001 for test review', review_notes: null,
    reviewer_user_id: null, applied_by_user_id: null, admission_revision: 1, admission_status: 'APPROVED',
    admission_approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION',
    effective: false, next_owner: 'COMPLIANCE', can_request: false, can_review: true,
    can_apply: false, can_revoke: false, ...change }
}
function entityApplication(change: Partial<PortalApplication> = {}): PortalApplication {
  const details = application().details
  if (details.details_version === 2) throw new Error('Expected investor details fixture')
  return application({ id: entityApplicationId, details: { ...details, investor_type: 'ENTITY', company_name: 'Fictional Holding Company', registration_reference: 'SYNTH-ENTITY-001', beneficial_owners: 'Fictional owner and control evidence.', documents: [{ id: companyDocumentId, kind: 'COMPANY', title: 'Synthetic board appointment', storage_path: `${entityApplicationId}/${companyDocumentId}`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }] }, can_create_entity_account: true, ...change })
}
function entityAccount(change: Partial<PortalEntityInvestmentAccount> = {}): PortalEntityInvestmentAccount {
  return { id: entityAccountId, application_id: entityApplicationId, entity_party_id: otherOrganisation, entity_name: 'Fictional Holding Company', registration_reference: 'SYNTH-ENTITY-001', country: 'ZA', kind: 'ENTITY', status: 'ACTIVE', created_at: '2026-09-23T00:00:00Z', admission_revision: 1, admission_approved_until: '2099-01-01T00:00:00Z', can_request_mandate: true, can_view: false, can_request_eligibility: false, ...change }
}
function entityMandate(change: Partial<PortalInvestingRepresentativeMandate> = {}): PortalInvestingRepresentativeMandate {
  return { id: entityMandateId, investment_account_id: entityAccountId, application_id: entityApplicationId, applicant_user_id: other, representative_user_id: other, entity_party_id: otherOrganisation, entity_name: 'Fictional Holding Company', reviewer_scope_organisation_id: nativeOrganisation, admission_revision: 1, admission_current_revision: 1, admission_approved_until: '2099-01-01T00:00:00Z', cycle: 1, revision: 1, status: 'SUBMITTED', scope: ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], transaction_limit_minor: '0', evidence_reference: 'Fictional board appointment in the submitted COMPANY document.', appointment_document_id: companyDocumentId, requested_until: new Date(Date.now() + 14 * 86_400_000).toISOString(), submitted_at: '2026-09-23T00:00:00Z', reviewed_at: null, reviewer_user_id: null, review_notes: null, review_checks: {}, approval_receipt_id: null, applied_at: null, applied_by_user_id: null, revoked_at: null, revoke_reason: null, effective: false, next_owner: 'COMPLIANCE', can_request: false, can_review: true, can_apply: false, can_revoke: false, ...change }
}
function product(change: Partial<PortalProduct> = {}): PortalProduct {
  const status = change.status ?? 'PUBLISHED'
  const submitted = !['DRAFT', 'CHANGES_REQUIRED'].includes(status)
  return { id: productId, organisation_id: organisation, created_by: other, revision: 3, status, terms: fictionalProductTerms(), terms_hash: 'ab'.repeat(32), reserved_units: '0', created_at: '2026-09-20T10:00:00Z', reviewer_id: actor, review_notes: null, reviewed_at: '2026-09-20T11:00:00Z', published_at: '2026-09-20T12:00:00Z', review_checks: {},
    offering_package: submitted ? { id: offeringRevisionId, package_number: 1, origin: 'SUBMITTED', terms_hash: 'ab'.repeat(32), document_hashes: { memorandum: 'cd'.repeat(32), risks: 'de'.repeat(32), subscription_terms: 'ef'.repeat(32) }, submitted_at: '2026-09-20T10:00:00Z', issuer_status: status === 'IN_REVIEW' ? 'PENDING' : 'APPROVED', compliance_status: status === 'IN_REVIEW' ? 'PENDING' : 'APPROVED', technical_readiness_status: status === 'PUBLISHED' ? 'VERIFIED' : 'NOT_VERIFIED', publishable: false, subscribable: status === 'PUBLISHED', can_review_issuer: false } : null,
    offering_history: [], ...change }
}
function data(value = snapshot()): PortalPageData { return { user: { id: actor, email: 'synthetic@example.invalid' }, snapshot: value } }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('portal navigation and source-driven surfaces', () => {
  it('offers dedicated routes according to assigned capabilities without role impersonation', () => {
    const base = portalNavigation({ manageProducts: false, reviewCompliance: false, invest: true })
    expect(base.map(item => item.href)).toEqual(['/portal', '/portal/onboarding', '/portal/opportunities', '/portal/portfolio'])
    const full = portalNavigation({ manageProducts: true, reviewCompliance: true, invest: true })
    expect(full.map(item => item.href)).toContain('/portal/products'); expect(full.map(item => item.href)).toContain('/portal/compliance')
    const html = renderToStaticMarkup(<PortalShell user={data().user} capabilities={{ manageProducts: false, reviewCompliance: false, invest: true }} active="onboarding" title="Onboarding"><p>Saved content</p></PortalShell>)
    expect(html).toContain('Skip to main content'); expect(html).toContain('aria-current="page"'); expect(html).toContain('Testnet environment')
    expect(html).not.toContain('Switch role'); expect(html).not.toContain('Impersonate'); expect(html).not.toContain('href="/portal/compliance"')
  })
  it('keeps account security and the account workspace available inside the mobile navigation', () => {
    const html = renderToStaticMarkup(<PortalShell user={data().user} capabilities={{ manageProducts: false, reviewCompliance: false, invest: true }} active="overview" title="Overview"><p>Saved content</p></PortalShell>)
    const mobileNavigation = html.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0]
    expect(mobileNavigation).toBeDefined()
    expect(mobileNavigation).toContain('Navigate your workspace')
    expect(mobileNavigation).toContain('aria-label="Account navigation"')
    expect(mobileNavigation).toContain('href="/workspace/security"')
    expect(mobileNavigation).toContain('Account security')
    expect(mobileNavigation).toContain('href="/workspace"')
    expect(mobileNavigation).toContain('Account workspace')
    expect(mobileNavigation).not.toContain('href="/portal/compliance"')
  })
  it('enters account security through a full document request on desktop and mobile', () => {
    const html = renderToStaticMarkup(<PortalShell user={data().user} capabilities={{ manageProducts: false, reviewCompliance: true, invest: false }} active="overview" title="Overview"><p>Saved content</p></PortalShell>)
    const securityLinks = html.match(/<a\b[^>]*href="\/workspace\/security"[^>]*>[\s\S]*?<\/a>/g) ?? []
    expect(securityLinks).toHaveLength(2)
    for (const link of securityLinks) {
      expect(link).toContain('Account security')
      expect(link).not.toContain('data-client-navigation')
    }
    // Keep ordinary portal links on the existing client router.
    expect(html).toMatch(/<a\b[^>]*href="\/portal"[^>]*data-client-navigation="true"/)
  })
  it.each(['Investor', 'ComplianceOfficer', 'TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin'])('does not infer product authority from %s', role => {
    const value = snapshot(); value.organisations = [{ id: organisation, name: 'Fictional Org', status: 'ACTIVE', roles: [role] }]
    expect(productManagementOrganisations(value)).toEqual([])
  })
  it.each(['IssuerFundManager', 'OfferingManager'])('admits the exact active %s organisation mandate', role => {
    const value = snapshot(); value.organisations = [{ id: organisation, name: 'Fictional Org', status: 'ACTIVE', roles: [role] }]
    expect(productManagementOrganisations(value)).toHaveLength(1)
    value.organisations[0].status = 'REVOKED'; expect(productManagementOrganisations(value)).toEqual([])
  })
  it.each(PORTAL_PATHS)('renders the dedicated %s route without any automatic API or wallet request', view => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<PortalScreen data={data()} view={view} />)
    expect(html).toContain('<h1'); expect(html).toContain('Fictional data only'); expect(html).not.toContain('NaN')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not expose a draft product in the investor opportunity list or detail', () => {
    const value = snapshot(); value.products = [product({ status: 'DRAFT', terms: { ...fictionalProductTerms(), name: 'Private draft name' } })]
    for (const view of ['/portal/opportunities', '/portal/opportunities/detail'] as const) {
      const html = renderToStaticMarkup(<PortalScreen data={data(value)} view={view} id={productId} />)
      expect(html).not.toContain('Private draft name'); expect(html).not.toContain('Accept terms and reserve units')
    }
  })
  it('shows private case access as unavailable when the account lacks reviewer authority', () => {
    const value = snapshot(); value.applications = [application({ user_id: other, details: { ...application().details, full_name: 'Other Private Applicant' } })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={applicationId} />)
    expect(html).not.toContain('Other Private Applicant'); expect(html).not.toContain('Record review decision')
  })
  it('never turns an unfunded reservation into a holding or performance chart', () => {
    const value = snapshot(); value.applications = [application()]; value.subscriptions = [order()]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" />)
    expect(html).toContain('Awaiting funding'); expect(html).toContain('Reservations are not holdings'); expect(html).toContain('Cancel unfunded reservation')
    expect(html).not.toContain('Portfolio return'); expect(html).not.toContain('Total assets under management')
  })
  it.each(['/portal', '/portal/portfolio'] as const)('describes reservation amounts as requested subscriptions, not financial obligations on %s', view => {
    const value = snapshot(); value.operating_context = operating('Investor'); value.products = [product()]; value.subscriptions = [order()]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view={view} operatingContext={operating('Investor')} />)
    expect(html).toContain('Requested subscription amount'); expect(html).toContain('Awaiting-funding instructions only')
    expect(html).not.toContain('Unfunded test obligations'); expect(html).not.toContain('subscription instructions and funding obligations')
    if (view === '/portal/portfolio') {
      expect(html).toContain('These are subscription instructions with reserved units.')
      expect(html).toContain('A reservation does not confirm funding, token ownership or investment performance.')
    }
  })
})

describe('onboarding and subscription boundaries', () => {
  it.each([{ status: 'SUBMITTED' as const }, { status: 'REJECTED' as const }, { approved_until: null }, { approved_until: '2020-01-01T00:00:00Z' }, { user_id: other }, { persona: 'WEALTH_MANAGER' as const }])('does not infer current investor eligibility from %j', change => {
    const value = snapshot(); value.applications = [application(change)]
    expect(currentInvestorApplication(value)).toBeUndefined()
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Approved investor onboarding required'); expect(html).not.toContain('Accept terms and reserve units')
  })
  it('blocks a country/classification mismatch while preserving access to offering disclosures', () => {
    const value = snapshot(); value.applications = [application({ details: { ...application().details, country: 'GB' } })]
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Eligibility does not match'); expect(html).not.toContain('Accept terms and reserve units')
  })
  it('binds eligible subscription review to the displayed revision and explicit document/risk acceptance', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility()]
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Package 1'); expect(html).toContain(offeringRevisionId); expect(html).toContain('displayed terms fingerprint'); expect(html).toContain('risk disclosures')
    expect(html).toContain('Accept terms and reserve units'); expect(html).toContain('disabled=""'); expect(html).toContain('It does not move cash or issue tokens')
  })
  it('does not allow an authorised reviewer to approve their own application', () => {
    const value = snapshot(); value.actor.can_review = true
    const html = renderToStaticMarkup(<ApplicationReview application={application({ status: 'SUBMITTED' })} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('You cannot review your own application'); expect(html).not.toContain('Record review decision')
  })
  it('does not allow an authorised reviewer to approve their own offering', () => {
    const value = snapshot(); value.actor.can_review = true
    const html = renderToStaticMarkup(<ProductReview product={product({ created_by: actor, status: 'IN_REVIEW' })} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('You created this product and cannot approve it'); expect(html).not.toContain('Record offering decision')
  })
  it('shows package text digests and separate decisions without implying signed documents', () => {
    const item = product({ status: 'IN_REVIEW', offering_history: [{ id: other, package_number: 0, origin: 'LEGACY_PRODUCT_SNAPSHOT', terms_hash: 'fa'.repeat(32), document_hashes: { memorandum: 'fb'.repeat(32), risks: 'fc'.repeat(32), subscription_terms: 'fd'.repeat(32) }, submitted_at: '2026-09-19T00:00:00Z', issuer_status: 'UNVERIFIED_LEGACY', compliance_status: 'UNVERIFIED_LEGACY', technical_readiness_status: 'NOT_VERIFIED' }] })
    const html = renderToStaticMarkup(<OfferingPackageEvidence product={item} />)
    expect(html).toContain(offeringRevisionId)
    expect(html).toContain('cd'.repeat(32)); expect(html).toContain('de'.repeat(32)); expect(html).toContain('ef'.repeat(32))
    expect(html).toContain('Appointed issuer decision'); expect(html).toContain('Independent Compliance decision')
    expect(html).toContain('Awaiting technical readiness'); expect(html).toContain('Historical snapshot, approvals unverified')
    expect(html).not.toContain('Signed memorandum')
  })
  it('shows exact-package issuer change rationale to a manager, but not in investor evidence', () => {
    const original = product({ status: 'IN_REVIEW' })
    const item = product({ status: 'IN_REVIEW', offering_package: { ...original.offering_package!, issuer_status: 'CHANGES_REQUIRED', issuer_review_notes: 'Correct the synthetic class rights before resubmission.' } })
    const manager = snapshot(); manager.operating_context = operating('OfferingManager'); manager.organisations = [operatorOrganisation()]; manager.products = [item]
    const managerHtml = renderToStaticMarkup(<PortalScreen data={data(manager)} view="/portal/products/detail" id={productId} operatingContext={operating('OfferingManager')} />)
    expect(managerHtml).toContain('Issuer decision rationale')
    expect(managerHtml).toContain('Correct the synthetic class rights')
    expect(managerHtml).toContain('Issuer name (unverified)')
    const investorHtml = renderToStaticMarkup(<OfferingPackageEvidence product={item} />)
    expect(investorHtml).not.toContain('Correct the synthetic class rights')
  })
  it('never offers publication or subscription from workflow status alone', () => {
    const approved = product({ status: 'APPROVED' })
    const actions = renderToStaticMarkup(<ProductActions product={approved} onSaved={vi.fn()} availableCommands={['publish_product']} />)
    expect(actions).toContain('Opening is not available')
    expect(actions).not.toContain('Open approved offering</button>')
    const subscription = renderToStaticMarkup(<SubscriptionForm product={product({ offering_package: null })} snapshot={snapshot()} onSaved={vi.fn()} />)
    expect(subscription).toContain('Offering is not open')
    expect(subscription).not.toContain('Accept terms and reserve units</button>')
  })
  it('shows an issuer decision only when the backend grants exact package review authority', () => {
    const submitted = product({ status: 'IN_REVIEW' })
    const noGrant = renderToStaticMarkup(<IssuerOfferingReview product={submitted} snapshot={snapshot()} onSaved={vi.fn()} />)
    expect(noGrant).toContain('Issuer action unavailable'); expect(noGrant).not.toContain('Record issuer decision</button>')
    const granted = product({ status: 'IN_REVIEW', offering_package: { ...submitted.offering_package!, can_review_issuer: true }, allowed_actions: ['review_offering_issuer'] })
    const decision = renderToStaticMarkup(<IssuerOfferingReview product={granted} snapshot={snapshot()} onSaved={vi.fn()} />)
    expect(decision).toContain('Record issuer decision</button>')
    expect(decision).toContain('Appointed issuer authority and product mandate verified for this test')
    expect(decision).toContain('not a complete legal rights schedule or e-signature package')
  })
  it('requires a server-granted Compliance action and shows the same package reference', () => {
    const value = snapshot(); value.actor.can_review = true
    const submitted = product({ status: 'IN_REVIEW' })
    const withoutGrant = renderToStaticMarkup(<ProductReview product={submitted} snapshot={value} onSaved={vi.fn()} />)
    expect(withoutGrant).not.toContain('Record Compliance decision</button>')
    const granted = product({ status: 'IN_REVIEW', offering_package: { ...submitted.offering_package!, can_review_compliance: true }, allowed_actions: ['review_product'] })
    const decision = renderToStaticMarkup(<ProductReview product={granted} snapshot={value} onSaved={vi.fn()} />)
    expect(decision).toContain(offeringRevisionId)
    expect(decision).toContain('Record Compliance decision</button>')
    expect(decision).toContain('not issuer approval')
  })
  it('shows scoped issuer changes to the manager but never in the investor opportunity', () => {
    const submitted = product({ status: 'IN_REVIEW' })
    const item = product({ status: 'CHANGES_REQUIRED', offering_package: { ...submitted.offering_package!, issuer_status: 'CHANGES_REQUIRED', issuer_review_notes: 'Issuer requests a corrected fictional class-rights explanation before another submission.' } })
    const manager = snapshot(); manager.operating_context = operating('OfferingManager'); manager.organisations = [operatorOrganisation()]; manager.products = [item]
    const managerHtml = renderToStaticMarkup(<PortalScreen data={data(manager)} view="/portal/products/detail" id={productId} operatingContext={operating('OfferingManager')} />)
    expect(managerHtml).toContain('Issuer decision rationale'); expect(managerHtml).toContain('corrected fictional class-rights explanation')
    const investor = snapshot(); investor.applications = [application()]; investor.products = [product({ offering_package: { ...product().offering_package!, issuer_review_notes: 'Private reviewer rationale must not render in investor discovery.' } })]
    const investorHtml = renderToStaticMarkup(<PortalScreen data={data(investor)} view="/portal/opportunities/detail" id={productId} operatingContext={APPLICANT_CONTEXT} />)
    expect(investorHtml).not.toContain('Private reviewer rationale')
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('starts %s from a valid, explicitly fictional editable product template', kind => {
    const terms = fictionalProductTerms(kind)
    expect(productTermsSchema.safeParse(terms).success).toBe(true)
    expect(terms.issuer_name).toContain('fictional')
    expect(terms.documents.memorandum).toContain('FICTIONAL TEST')
    expect(terms.documents.risks.length).toBeGreaterThan(50); expect(terms.documents.subscription_terms.length).toBeGreaterThan(50)
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('does not claim a financial obligation is created by the new %s subscription template', kind => {
    const terms = fictionalProductTerms(kind).documents.subscription_terms
    expect(terms).toContain('reserves whole units and records the requested subscription amount in synthetic currency only')
    expect(terms).not.toMatch(/creates? an obligation/i)
    expect(terms).toContain('Acceptance does not constitute funding, token issuance, legal ownership or a bank payment.')
  })
  it('formats exact-precision synthetic amounts without floating-point rounding', () => {
    expect(money('900719925474099301')).toBe('R9,007,199,254,740,993.01 test')
    expect(money('-1')).toBe('Not available')
  })
})

describe('operational landings and one subscription hand-off', () => {
  it('lands investors on account records, actual orders and opportunities before collapsed role help', () => {
    const value = snapshot(); value.operating_context = operating('Investor'); value.applications = [application()]; value.accounts = [account()]; value.products = [product()]; value.subscriptions = [order()]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('Investor')} release={{ environment: 'TESTNET', version: 'source-version', source: 'abc123' }} />)
    expect(html).toContain('Your investments and orders.')
    expect(html).toContain('Your investment account'); expect(html).toContain('Your subscription orders'); expect(html).toContain('Investment opportunities')
    expect(html).toContain(requestKey); expect(html).toContain(accountId)
    expect(html.indexOf('Your subscription orders')).toBeLessThan(html.indexOf('Role, hand-offs and signing guidance'))
    expect(html).not.toContain('>Your workflow<'); expect(html).not.toContain('>Record payment<'); expect(html).not.toContain('>Mint tokens<')
    expect(html).toContain('source-version'); expect(html).toContain('abc123')
  })
  it.each(['OfferingManager', 'IssuerFundManager'] as const)('lands %s on products and the same incoming order without investor cancellation controls', role => {
    const value = snapshot(); value.operating_context = operating(role); value.organisations = [operatorOrganisation(role)]; value.products = [product()]; value.subscriptions = [order({ investor_id: other })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating(role)} />)
    expect(html).toContain('Your products and incoming orders.'); expect(html).toContain('Product register'); expect(html).toContain('Incoming subscription orders')
    expect(html).toContain(requestKey); expect(html).toContain(accountId); expect(html).toContain('ab'.repeat(32)); expect(html).toContain('Recorded product workflow revision 3')
    expect(html).toContain('Funding records unavailable'); expect(html).not.toContain('Cancel unfunded reservation')
    expect(html.indexOf('Product register')).toBeLessThan(html.indexOf('Role, hand-offs and signing guidance'))
  })
  it('routes an appointed issuer on a customer organisation to its exact package without manager powers', () => {
    const original = product({ status: 'IN_REVIEW' })
    const item = product({ status: 'IN_REVIEW', offering_package: { ...original.offering_package!, can_review_issuer: true }, allowed_actions: ['review_offering_issuer'] })
    const value = snapshot(); value.operating_context = operating('IssuerFundManager')
    value.organisations = [{ ...operatorOrganisation('IssuerFundManager'), capabilities: [] }]
    value.products = [item]
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('IssuerFundManager')} />)
    expect(queue).toContain('Packages awaiting your issuer decision')
    expect(queue).toContain(item.terms.name)
    expect(queue).not.toContain('Create a product</a>')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/products/detail" id={productId} operatingContext={operating('IssuerFundManager')} />)
    expect(detail).toContain('Record issuer decision')
    expect(detail).toContain(offeringRevisionId)
    expect(detail).toContain('Order access unavailable')
    expect(detail).not.toContain('Open approved offering</button>')
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('preserves the %s product and same order across investor and issuer views', kind => {
    const item = product({ terms: { ...fictionalProductTerms(kind), name: `Shared ${kind} offering` } })
    const instruction = order({ product_name: item.terms.name, amount_minor: '900719925474099301' })
    const investor = snapshot(); investor.operating_context = operating('Investor'); investor.products = [item]; investor.subscriptions = [instruction]
    const issuer = snapshot(); issuer.operating_context = operating('IssuerFundManager'); issuer.organisations = [operatorOrganisation('IssuerFundManager')]; issuer.products = [item]; issuer.subscriptions = [{ ...instruction, investor_id: other }]
    const investorHtml = renderToStaticMarkup(<PortalScreen data={data(investor)} view="/portal/portfolio" operatingContext={operating('Investor')} />)
    const issuerHtml = renderToStaticMarkup(<PortalScreen data={data(issuer)} view="/portal/products/detail" id={productId} operatingContext={operating('IssuerFundManager')} />)
    for (const html of [investorHtml, issuerHtml]) {
      expect(html).toContain(item.terms.name); expect(html).toContain(instruction.id); expect(html).toContain(instruction.investment_account_id)
      expect(html).toContain(instruction.terms_hash); expect(html).toContain('R9,007,199,254,740,993.01 test')
      expect(html).toContain('Awaiting funding')
    }
  })
  it('excludes another native organisation even when the actor has the same role there', () => {
    const value = snapshot(); value.operating_context = operating('OfferingManager')
    value.organisations = [operatorOrganisation(), { ...operatorOrganisation(), id: otherOrganisation, native_organisation_id: otherOrganisation }]
    value.products = [product(), product({ id: other, organisation_id: otherOrganisation, terms: { ...fictionalProductTerms(), name: 'Other Organisation Secret Product' } })]
    value.subscriptions = [order({ investor_id: other }), order({ id: other, product_id: other, organisation_id: otherOrganisation, product_name: 'Other Organisation Secret Order' })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('OfferingManager')} />)
    expect(html).toContain(requestKey); expect(html).not.toContain('Other Organisation Secret Product'); expect(html).not.toContain('Other Organisation Secret Order')
  })
  it('does not infer a native mandate from an unbound owner or a matching display name', () => {
    const value = snapshot(); value.organisations = [{ ...operatorOrganisation(), authority_source: 'LEGACY_OWNER', native_organisation_id: null }]
    expect(productManagementOrganisations(value, operating('OfferingManager'))).toEqual([])
    expect(productManagementOrganisations(value, APPLICANT_CONTEXT)).toHaveLength(1)
    value.organisations = [operatorOrganisation()]
    expect(productManagementOrganisations(value, APPLICANT_CONTEXT)).toEqual([])
  })
  it('does not expose creation, publication or order access without the exact command capability', () => {
    const value = snapshot(); value.operating_context = operating('OfferingManager'); value.organisations = [{ ...operatorOrganisation(), capabilities: ['save_product'] }]; value.products = [product({ status: 'APPROVED' })]; value.subscriptions = [order({ investor_id: other })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/products/detail" id={productId} operatingContext={operating('OfferingManager')} />)
    expect(html).toContain('Order access unavailable'); expect(html).not.toContain(requestKey); expect(html).not.toContain('Publish approved offering</button>')
    const landing = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('OfferingManager')} />)
    expect(landing).toContain('Unavailable'); expect(landing).not.toContain('Create a product</a>'); expect(landing).not.toContain('No incoming orders in this scope')
    const actions = renderToStaticMarkup(<ProductActions product={product({ status: 'DRAFT' })} onSaved={vi.fn()} availableCommands={[]} />)
    expect(actions).not.toContain('Submit product for review</button>')
  })
  it('shows the compliance queue as work and does not combine reviewer authority into an issuer context', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product({ status: 'IN_REVIEW' })]; value.applications = [application({ user_id: other, status: 'SUBMITTED', details: { ...application().details, full_name: 'Scoped Review Applicant' } })]
    const reviewer = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('ComplianceOfficer')} />)
    expect(reviewer).toContain('Compliance work queue'); expect(reviewer).toContain('Scoped Review Applicant'); expect(reviewer).toContain('Review case'); expect(reviewer).toContain('Review offering')
    value.operating_context = operating('OfferingManager'); value.organisations = [operatorOrganisation()]
    const issuer = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('OfferingManager')} />)
    expect(issuer).not.toContain('Scoped Review Applicant'); expect(issuer).not.toContain('Review case</a>')
    expect(issuer).not.toContain('href="/portal/compliance?')
  })
  it('retains selected context in product, order, detail, breadcrumb and refresh links', () => {
    const context = operating('OfferingManager'); const value = snapshot(); value.operating_context = context; value.organisations = [operatorOrganisation()]; value.products = [product()]; value.subscriptions = [order({ investor_id: other })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/products/detail" id={productId} operatingContext={context} />)
    expect(html).toContain(portalScopeHref('/portal/products', context).replaceAll('&', '&amp;'))
    expect(html).toContain(portalScopeHref('/portal/products/detail', context, productId).replaceAll('&', '&amp;'))
    expect(html).not.toContain(`href="/portal/products/detail?id=${productId}"`)
    expect(html).not.toContain('href="/portal/products"')
  })
  it('allows explicit navigation between personal/applicant relationships and assigned organisation roles', () => {
    const scopes = [{ organisationId: nativeOrganisation, organisationName: 'Native Organisation', role: 'Investor' as const }]
    const value = snapshot()
    const applicant = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={APPLICANT_CONTEXT} scopes={scopes} />)
    expect(applicant).toContain('My personal / applicant relationships'); expect(applicant).toContain('does not grant a native organisation role')
    expect(applicant).toContain(portalScopeHref('/portal', operating('Investor')).replaceAll('&', '&amp;'))
    value.operating_context = operating('Investor')
    const native = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('Investor')} scope={scopes[0]} scopes={scopes} />)
    expect(native).toContain('href="/portal?mode=applicant"'); expect(native).toContain('Native Organisation')
  })
  it('retains the guarded Super Admin workflow and account security without creating investor access', () => {
    const value = snapshot(); value.operating_context = operating('SuperAdmin')
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('SuperAdmin')} />)
    expect(html).toContain(`href="/workspace/administration?organisation=${nativeOrganisation}"`)
    expect(html).toContain('href="/workspace/security"'); expect(html).not.toContain('Your subscription orders'); expect(html).not.toContain('href="/portal/opportunities?')
    const securityLinks = html.match(/<a\b[^>]*href="\/workspace\/security"[^>]*>[\s\S]*?<\/a>/g) ?? []
    expect(securityLinks).toHaveLength(3)
    for (const link of securityLinks) expect(link).not.toContain('data-client-navigation')
  })
  it('does not render another context’s events as a generic recent-activity feed', () => {
    const value = snapshot(); value.operating_context = operating('Investor'); value.events = [{ id: requestKey, subject_id: productId, kind: 'PRIVATE_CASE', actor_id: other, created_at: '2026-09-20T10:00:00Z', summary: 'Other reviewer private event' }]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('Investor')} />)
    expect(html).not.toContain('Other reviewer private event')
  })
})

describe('owned individual investment-account controls', () => {
  it('connects an approved applicant to account creation from the actual portfolio route', () => {
    const value = snapshot(); value.applications = [application()]
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Your investment account and instructions.')
    expect(html).toContain('<h2>Your investment account</h2>')
    expect(html).toContain('Open individual investment account</button>')
    expect(html.indexOf('<h2>Your investment account</h2>')).toBeLessThan(html.indexOf('<h2>Your subscription orders</h2>'))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not market a historical published row without a current package and verified opening', () => {
    const value = snapshot(); value.applications = [application()]; value.products = [product({ offering_package: null, terms: { ...fictionalProductTerms(), name: 'Historical unverified offer' } })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/opportunities" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).not.toContain('Historical unverified offer')
    expect(html).not.toContain('Accept terms and reserve units')
  })
  it.each([
    { status: 'SUBMITTED' as const }, { approved_until: '2020-01-01T00:00:00Z' },
  ])('sends an owned investor with pending or expired approval back to onboarding: %j', change => {
    const value = snapshot(); value.applications = [application(change)]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Complete investor onboarding')
    expect(html).toContain('href="/portal/onboarding?mode=applicant"')
    expect(html).not.toContain('Open individual investment account</button>')
  })
  it.each([
    { user_id: other }, { persona: 'WEALTH_MANAGER' as const },
  ])('denies investor portfolio to a foreign or wealth-manager-only applicant: %j', change => {
    const value = snapshot(); value.applications = [application(change)]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Record unavailable')
    expect(html).not.toContain('Complete investor onboarding')
    expect(html).not.toContain('<h2>Your investment account</h2>')
    expect(html).not.toContain('<h2>Your subscription orders</h2>')
    expect(html).not.toContain('Open individual investment account</button>')
  })
  it('keeps account creation unavailable when approved applicant account records did not load', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = undefined
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Investment-account records are unavailable')
    expect(html).not.toContain('Open individual investment account</button>')
  })
  it('offers explicit creation only after current individual investor approval', () => {
    const value = snapshot(); value.applications = [application()]
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<InvestmentAccountPanel snapshot={value} onSaved={vi.fn()} operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Open individual investment account</button>'); expect(fetch).not.toHaveBeenCalled()
  })
  it('requires an existing active account before offering a subscription submit control', () => {
    const value = snapshot(); value.applications = [application()]
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('An active individual investment account is required'); expect(html).not.toContain('Accept terms and reserve units</button>')
    value.accounts = [account()]; value.product_eligibility = [eligibility()]
    const ready = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(ready).toContain('Investing account'); expect(ready).toContain(accountId); expect(ready).toContain('Accept terms and reserve units</button>')
  })
  it.each([
    { holder_user_id: other }, { application_id: other }, { status: 'SUSPENDED' as const },
  ])('does not offer an unrelated or suspended account for investment: %j', change => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account(change)]
    expect(activeIndividualAccounts(value)).toEqual([])
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).not.toContain('Accept terms and reserve units</button>')
  })
  it('does not turn entity qualification into a personal account', () => {
    const investorDetails = application().details
    if (investorDetails.details_version === 2) throw new Error('This fixture must remain an investor application')
    const value = snapshot(); value.applications = [application({ details: { ...investorDetails, investor_type: 'ENTITY', company_name: 'Entity Applicant' } })]; value.accounts = [account()]
    expect(activeIndividualAccounts(value)).toEqual([])
    const html = renderToStaticMarkup(<InvestmentAccountPanel snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Entity-account route not admitted'); expect(html).not.toContain('Open individual investment account</button>')
  })
  it('does not suggest replacing a suspended account or treat unavailable account data as an empty list', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account({ status: 'SUSPENDED' })]
    const suspended = renderToStaticMarkup(<InvestmentAccountPanel snapshot={value} onSaved={vi.fn()} />)
    expect(suspended).toContain('Investment account suspended'); expect(suspended).not.toContain('Open individual investment account</button>')
    value.accounts = undefined
    const unavailable = renderToStaticMarkup(<InvestmentAccountPanel snapshot={value} onSaved={vi.fn()} />)
    expect(unavailable).toContain('Investment-account records are unavailable'); expect(unavailable).not.toContain('Open individual investment account</button>')
  })
  it('rechecks the current approval instead of trusting an active account label', () => {
    const value = snapshot(); value.accounts = [account()]; value.applications = [application({ approved_until: '2020-01-01T00:00:00Z' })]
    expect(activeIndividualAccounts(value)).toEqual([])
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Approved investor onboarding required'); expect(html).not.toContain('Accept terms and reserve units</button>')
  })
})

describe('entity investment account and limited investing-representative handoff', () => {
  it('opens an entity account only from a current approved entity application and admitted server route', () => {
    const value = snapshot(); value.applications = [entityApplication()]; value.entity_account_route_available = true; value.entity_investment_accounts = []; value.investing_representative_mandates = []
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Open Fictional Holding Company investment account</button>')
    expect(html).not.toContain('Open individual investment account</button>')
    expect(html).not.toContain('Your subscription orders')
    value.applications = [entityApplication({ can_create_entity_account: false })]
    const denied = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(denied).not.toContain('Open Fictional Holding Company investment account</button>')
    value.applications = [entityApplication()]; value.entity_account_route_available = false
    const sealed = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(sealed).toContain('Entity-account route not admitted')
    expect(sealed).not.toContain('Open Fictional Holding Company investment account</button>')
  })
  it('shows both personal and entity accounts for one login without merging the pending entity record', () => {
    const value = snapshot(); value.applications = [application(), entityApplication()]; value.accounts = [account()]
    value.entity_account_route_available = true; value.entity_investment_accounts = [entityAccount()]; value.investing_representative_mandates = []
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('<h2>Your investment account</h2>')
    expect(html).toContain('<h2>Entity investment account</h2>')
    expect(html).toContain(accountId)
    expect(html).toContain(entityAccountId)
    expect(html).toContain('Submit representative mandate for review</button>')
    expect(html).toContain('No entity subscription authority yet')
  })
  it('keeps each entity application and account visible before an effective mandate exists', () => {
    const secondApplicationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const secondAccountId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    const value = snapshot(); value.applications = [entityApplication(), entityApplication({ id: secondApplicationId, details: { ...entityApplication().details, company_name: 'Second Fictional Entity' } })]
    value.entity_account_route_available = true; value.entity_investment_accounts = [entityAccount(), entityAccount({ id: secondAccountId, application_id: secondApplicationId, entity_name: 'Second Fictional Entity' })]; value.investing_representative_mandates = []
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain(entityAccountId)
    expect(html).toContain(secondAccountId)
    expect(html).toContain('Second Fictional Entity')
    expect(html.match(/Submit representative mandate for review/g)?.length).toBe(2)
  })
  it('shows pending review and never converts the entity mandate into an order or holding', () => {
    const value = snapshot(); value.applications = [entityApplication()]; value.entity_account_route_available = true
    value.entity_investment_accounts = [entityAccount()]; value.investing_representative_mandates = [entityMandate({ applicant_user_id: actor, representative_user_id: actor })]
    const portfolio = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(portfolio).toContain('Independent mandate review pending')
    expect(portfolio).toContain('Independent BlockXOne Compliance Officer')
    expect(portfolio).not.toContain('Submit representative mandate for review</button>')
    expect(portfolio).not.toContain('Your subscription orders')
    const offering = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/opportunities" operatingContext={APPLICANT_CONTEXT} />)
    expect(offering).toContain('Entity product flow not enabled')
  })
  it('keeps old cycles terminal and displays the newest pending cycle without using the old revision', () => {
    const value = snapshot(); value.applications = [entityApplication()]; value.entity_account_route_available = true
    value.entity_investment_accounts = [entityAccount({ can_request_mandate: false })]
    value.investing_representative_mandates = [
      entityMandate({ applicant_user_id: actor, representative_user_id: actor, cycle: 1, revision: 4, status: 'REVOKED', effective: false, revoke_reason: 'Synthetic company appointment ended after review.', next_owner: 'NONE' }),
      entityMandate({ id: '12121212-1212-4121-8121-121212121212', applicant_user_id: actor, representative_user_id: actor, cycle: 2, revision: 1, status: 'SUBMITTED', effective: false, next_owner: 'COMPLIANCE' }),
    ]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Appointment cycle</dt><dd>2')
    expect(html).toContain('Independent mandate review pending')
    expect(html).not.toContain('Synthetic company appointment ended after review.')
  })
  it('allows a changes-required explanation to be updated only against the approved COMPANY document set', () => {
    const value = snapshot(); value.applications = [entityApplication()]; value.entity_account_route_available = true
    value.entity_investment_accounts = [entityAccount()]
    value.investing_representative_mandates = [entityMandate({ applicant_user_id: actor, representative_user_id: actor, status: 'CHANGES_REQUIRED', revision: 2, can_request: true, can_review: false, next_owner: 'APPLICANT', review_notes: 'Clarify the fictional board appointment.' })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Update investing-representative case')
    expect(html).toContain('Clarify the fictional board appointment.')
    expect(html).toContain('you cannot upload fresh evidence to this case')
  })
  it('lets an applied representative inspect only the returned account-view relationship, without trading controls', () => {
    const value = snapshot(); value.entity_account_route_available = true
    value.entity_investment_accounts = [entityAccount({ can_view: true, can_request_mandate: false })]
    value.investing_representative_mandates = [entityMandate({ representative_user_id: actor, status: 'APPLIED', revision: 3, effective: true, next_owner: 'NONE', can_review: false, can_request: false, applied_by_user_id: other, applied_at: '2026-09-23T10:00:00Z' })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Limited representative access active')
    expect(html).toContain('eligibility-request scope is reserved')
    expect(html).not.toContain('Your subscription orders')
    expect(html).not.toContain('Accept terms and reserve units')
  })
  it('binds the Compliance queue and review to exact scope, source admission and COMPANY evidence', () => {
    const value = snapshot(); value.actor.can_review = true; value.entity_mandate_queue_available = true
    value.applications = [entityApplication({ user_id: other, can_create_entity_account: false })]
    value.investing_representative_mandates = [entityMandate()]
    const reviewer = operating('ComplianceOfficer')
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={reviewer} />)
    expect(queue).toContain('Entity investing-representative review')
    expect(queue).toContain('Fictional Holding Company')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={entityMandateId} operatingContext={reviewer} />)
    expect(detail).toContain('Synthetic board appointment')
    expect(detail).toContain('Record entity mandate decision</button>')
    expect(detail).not.toContain('Apply account-view mandate</button>')
    value.investing_representative_mandates = [entityMandate({ reviewer_scope_organisation_id: otherOrganisation, entity_name: 'Foreign entity private mandate' })]
    const foreign = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={entityMandateId} operatingContext={reviewer} />)
    expect(foreign).toContain('Record unavailable')
    expect(foreign).not.toContain('Foreign entity private mandate')
  })
  it('hides entity mandate cases until staff MFA and route admission are proven', () => {
    const value = snapshot(); value.actor.can_review = true; value.entity_mandate_queue_available = false; value.entity_mandate_queue_blocked_reason = 'MFA_REQUIRED'
    value.investing_representative_mandates = [entityMandate({ entity_name: 'Hidden confidential entity' })]
    const reviewer = operating('ComplianceOfficer')
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={reviewer} />)
    expect(queue).toContain('Authenticator required')
    expect(queue).not.toContain('Hidden confidential entity')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={entityMandateId} operatingContext={reviewer} />)
    expect(detail).toContain('Record unavailable')
  })
  it('reserves application for a separately scoped Super Admin, never the applicant or reviewer', () => {
    const value = snapshot(); value.entity_mandate_queue_available = true
    value.investing_representative_mandates = [entityMandate({ status: 'APPROVED', revision: 2, can_review: false, can_apply: true, next_owner: 'SUPER_ADMIN', reviewer_user_id: other })]
    const admin = operating('SuperAdmin')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={entityMandateId} operatingContext={admin} />)
    expect(detail).toContain('Apply account-view mandate</button>')
    value.investing_representative_mandates = [entityMandate({ status: 'APPROVED', revision: 2, can_review: false, can_apply: true, next_owner: 'SUPER_ADMIN', reviewer_user_id: actor })]
    const sameReviewer = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={entityMandateId} operatingContext={admin} />)
    expect(sameReviewer).not.toContain('Apply account-view mandate</button>')
  })
})

describe('customer organisation admission to governed representative mandate', () => {
  it('never gives a wealth-manager-only applicant the investor account, orders or opportunities surfaces', () => {
    const value = snapshot(); value.applications = [managerApplication({ user_id: actor })]; value.products = [product()]
    const overview = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={APPLICANT_CONTEXT} />)
    expect(overview).toContain('Continue your customer organisation application.')
    expect(overview).toContain('Customer organisation relationship')
    expect(overview).not.toContain('Your subscription orders')
    expect(overview).not.toContain('Your investment account')
    expect(overview).not.toContain('Investment opportunities')
    expect(overview).not.toContain('href="/portal/portfolio?mode=applicant"')
    for (const view of ['/portal/portfolio', '/portal/opportunities', '/portal/opportunities/detail'] as const) {
      const html = renderToStaticMarkup(<PortalScreen data={data(value)} view={view} id={productId} operatingContext={APPLICANT_CONTEXT} />)
      expect(html).toContain('Record unavailable')
      expect(html).not.toContain('Fictional Test Fund')
    }
  })
  it('shows a separate Compliance appointment queue and source-admission review, not an instant product role', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = true; value.applications = [managerApplication()]; value.organisation_mandates = [representativeMandate()]
    const reviewer = operating('ComplianceOfficer')
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={reviewer} />)
    expect(queue).toContain('Representative mandate review')
    expect(queue).toContain('Fictional Manager Client')
    expect(queue).toContain('Independent BlockXOne Compliance Officer')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={reviewer} />)
    expect(detail).toContain('Approved customer admission source')
    expect(detail).toContain('Inspect original admission and private evidence')
    expect(detail).toContain('Record appointment decision')
    expect(detail).not.toContain('Apply reviewed Offering Manager mandate')
    expect(detail).not.toContain('Create a product')
  })
  it('denies reviewer action when source evidence is unavailable or the case belongs to another scope', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = true; value.organisation_mandates = [representativeMandate()]
    const reviewer = operating('ComplianceOfficer')
    const noSource = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={reviewer} />)
    expect(noSource).toContain('Source admission unavailable')
    expect(noSource).not.toContain('Record appointment decision')
    value.organisation_mandates = [representativeMandate({ reviewer_scope_organisation_id: otherOrganisation, organisation_name: 'Other organisation confidential appointment' })]
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={reviewer} />)
    expect(queue).not.toContain('Other organisation confidential appointment')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={reviewer} />)
    expect(detail).toContain('Record unavailable')
    expect(detail).not.toContain('Other organisation confidential appointment')
  })
  it('does not treat a case flag as reviewer authority when the active actor lacks the Compliance role projection', () => {
    const value = snapshot(); value.mandate_queue_available = true; value.organisation_mandates = [representativeMandate()]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={operating('ComplianceOfficer')} />)
    expect(html).toContain('Record unavailable')
    expect(html).not.toContain('SYNTHETIC-APPOINTMENT-001')
    expect(html).not.toContain('Record appointment decision')
  })
  it('blocks a mandate decision against a superseded customer admission revision', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = true
    value.applications = [managerApplication({ revision: 2 })]
    value.organisation_mandates = [representativeMandate({ admission_revision: 1 })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={operating('ComplianceOfficer')} />)
    expect(html).toContain('Source admission unavailable')
    expect(html).not.toContain('Record appointment decision')
  })
  it('does not let an applicant with a separate Compliance role decide their own mandate', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = true
    value.applications = [managerApplication({ user_id: actor })]
    value.organisation_mandates = [representativeMandate({ applicant_user_id: actor })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={operating('ComplianceOfficer')} />)
    expect(html).toContain('You cannot decide or apply your own appointment')
    expect(html).not.toContain('Record appointment decision')
  })
  it('does not equate an unavailable mandate queue with zero saved cases', () => {
    const value = snapshot(); value.actor.can_review = true
    const compliance = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(compliance).toContain('Mandate queue unavailable')
    const admin = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('SuperAdmin')} />)
    expect(admin).toContain('Mandate queue unavailable')
  })
  it('requires authenticator assurance before displaying any mandate case or case count', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = false; value.mandate_queue_blocked_reason = 'MFA_REQUIRED'
    value.organisation_mandates = [representativeMandate({ organisation_name: 'Hidden until authenticator verification' })]
    for (const role of ['ComplianceOfficer', 'SuperAdmin'] as const) {
      const context = operating(role)
      const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view={role === 'SuperAdmin' ? '/portal' : '/portal/compliance'} operatingContext={context} />)
      expect(queue).toContain('Authenticator required')
      expect(queue).toContain('href="/workspace/security"')
      expect(queue).not.toContain('Hidden until authenticator verification')
      const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={context} />)
      expect(detail).toContain('Record unavailable')
      expect(detail).not.toContain('Hidden until authenticator verification')
    }
  })
  it('shows a sealed staff mandate route as unavailable rather than an empty reviewed queue', () => {
    const value = snapshot(); value.actor.can_review = true; value.mandate_queue_available = false; value.mandate_queue_blocked_reason = 'NOT_ADMITTED'
    value.organisation_mandates = [representativeMandate({ organisation_name: 'Hidden until route admission' })]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(html).toContain('Mandate review route not admitted')
    expect(html).not.toContain('Hidden until route admission')
    expect(html).not.toContain('No representative mandate cases in this scope')
  })
  it('reserves role application for a distinct, scoped Super Admin and no applicant self-application', () => {
    const value = snapshot(); value.mandate_queue_available = true; const reviewed = representativeMandate({ status: 'APPROVED', revision: 2, can_review: false, can_apply: true, reviewer_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', next_owner: 'SUPER_ADMIN' })
    value.organisation_mandates = [reviewed]
    const admin = operating('SuperAdmin')
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={admin} />)
    expect(queue).toContain('Approved representative mandates to apply')
    expect(queue).toContain('Authorised BlockXOne Super Admin')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={reviewed.id} operatingContext={admin} />)
    expect(detail).toContain('Apply reviewed Offering Manager mandate')
    expect(detail).not.toContain('Record appointment decision')
    value.organisation_mandates = [{ ...reviewed, applicant_user_id: actor }]
    const self = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={reviewed.id} operatingContext={admin} />)
    expect(self).not.toContain('Apply reviewed Offering Manager mandate')
    expect(self).toContain('You cannot decide or apply your own appointment')
    value.organisation_mandates = [{ ...reviewed, reviewer_user_id: actor }]
    const sameReviewer = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={reviewed.id} operatingContext={admin} />)
    expect(sameReviewer).not.toContain('Apply reviewed Offering Manager mandate')
  })
  it('shows revocation only for an applied case under a server-authorised exact scope', () => {
    const value = snapshot(); value.mandate_queue_available = true; value.organisation_mandates = [representativeMandate({ status: 'APPLIED', revision: 3, can_review: false, can_revoke: true, effective: true, native_organisation_id: otherOrganisation })]
    const admin = operating('SuperAdmin')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={admin} />)
    expect(detail).toContain('Revoke this appointment')
    expect(detail).not.toContain('Apply reviewed Offering Manager mandate')
    value.organisation_mandates = [{ ...value.organisation_mandates[0], can_revoke: false }]
    const denied = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={representativeMandate().id} operatingContext={admin} />)
    expect(denied).not.toContain('Revoke this appointment')
  })
})

describe('product-specific investor eligibility and independent review', () => {
  it('connects the published offering to an account-specific request before subscription', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.products = [product()]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/opportunities/detail" id={productId} operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('<h2>Product eligibility</h2>')
    expect(html).toContain('Submit for product eligibility review</button>')
    expect(html).toContain('Product eligibility review required')
    expect(html).not.toContain('Accept terms and reserve units</button>')
  })
  it('does not offer an eligibility request without an approved individual investment account', () => {
    const value = snapshot(); value.applications = [application()]
    const html = renderToStaticMarkup(<ProductEligibilityPanel product={product()} snapshot={value} onSaved={vi.fn()} operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Investment account required')
    expect(html).toContain('href="/portal/portfolio?mode=applicant"')
    expect(html).not.toContain('Submit for product eligibility review</button>')
  })
  it('fails closed when product eligibility data is unavailable', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.products = [product()]; value.product_eligibility = undefined
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/opportunities/detail" id={productId} operatingContext={APPLICANT_CONTEXT} />)
    expect(html).toContain('Product eligibility records are unavailable')
    expect(html).not.toContain('Submit for product eligibility review</button>')
    expect(html).not.toContain('Accept terms and reserve units</button>')
  })
  it('does not call an unavailable reviewer case list empty', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.product_eligibility = undefined
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(queue).toContain('Product eligibility records are unavailable')
    expect(queue).not.toContain('No cases are waiting for review')
  })
  it.each([
    { product_revision: 2 }, { terms_hash: 'cd'.repeat(32) }, { application_revision: 2 }, { approved_until: '2020-01-01T00:00:00Z' },
    { effective: false }, { investment_account_id: other }, { holder_user_id: other }, { status: 'CHANGES_REQUIRED' as const },
  ])('does not turn an outdated or unrelated case into subscription authority: %j', change => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility(change)]
    expect(currentProductEligibility(value, product(), account())).toBeUndefined()
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Product eligibility review required')
    expect(html).not.toContain('Accept terms and reserve units</button>')
  })
  it('reopens the investor request when approved terms changed, without treating prior approval as current', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility({ product_revision: 2 })]
    const html = renderToStaticMarkup(<ProductEligibilityPanel product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Previous approval is no longer current')
    expect(html).toContain('Submit for product eligibility review</button>')
    expect(html).not.toContain('Product eligibility approved')
  })
  it('lets the investor replace a submitted case when its recorded context became stale', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility({ status: 'SUBMITTED', product_revision: 2, effective: false })]
    const html = renderToStaticMarkup(<ProductEligibilityPanel product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Case context changed')
    expect(html).toContain('Submit for product eligibility review</button>')
    expect(html).not.toContain('Independent review pending')
  })
  it('offers subscription only for the approved case matching this account and published terms', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility()]
    expect(currentProductEligibility(value, product(), account())?.id).toBe(eligibility().id)
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Investing account')
    expect(html).toContain('Accept terms and reserve units</button>')
  })
  it('treats revoked product eligibility as terminal for the investor', () => {
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]; value.product_eligibility = [eligibility({ status: 'REVOKED', effective: false, can_revoke: false })]
    expect(currentProductEligibility(value, product(), account())).toBeUndefined()
    const request = renderToStaticMarkup(<ProductEligibilityPanel product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(request).toContain('Product eligibility revoked')
    expect(request).toContain('a new request cannot reopen it')
    expect(request).not.toContain('Submit for product eligibility review</button>')
    const subscribe = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(subscribe).not.toContain('Accept terms and reserve units</button>')
  })
  it('denies a reviewer decision on their own eligibility case', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const own = eligibility({ status: 'SUBMITTED', effective: false, holder_user_id: actor, investor_application: application(), can_decide: true, can_approve: true })
    value.product_eligibility = [own]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={own.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(html).toContain('You cannot review your own product eligibility case')
    expect(html).not.toContain('Record eligibility decision</button>')
  })
  it('denies a product creator acting as reviewer on an investor eligibility case', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product({ created_by: actor })]
    const submitted = eligibility({ status: 'SUBMITTED', effective: false, holder_user_id: other, investor_application: application({ user_id: other }), can_decide: true, can_approve: true })
    value.product_eligibility = [submitted]
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={submitted.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('You created this offering and cannot review its investor eligibility')
    expect(detail).not.toContain('Record eligibility decision</button>')
  })
  it('connects a separate compliance reviewer to the scoped case and source investor evidence', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const submitted = eligibility({ status: 'SUBMITTED', effective: false, holder_user_id: other, investor_application: application({ user_id: other }), can_decide: true, can_approve: true })
    value.product_eligibility = [submitted]
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(queue).toContain('Product eligibility')
    expect(queue).toContain('Review eligibility')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={submitted.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('Approved investor admission evidence')
    expect(detail).toContain('Investor statement')
    expect(detail).toContain('Record eligibility decision</button>')
  })
  it('offers a reasoned revocation only when the backend grants that exact reviewer action', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const approved = eligibility({ holder_user_id: other, investor_application: application({ user_id: other }), can_decide: false, can_approve: false, can_revoke: true })
    value.product_eligibility = [approved]
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(queue).toContain('Inspect approval')
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={approved.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('Revocation reason')
    expect(detail).toContain('Revoke product eligibility</button>')
    value.product_eligibility = [{ ...approved, can_revoke: false }]
    const denied = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={approved.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(denied).not.toContain('Revoke product eligibility</button>')
  })
  it('cannot approve when the reviewer lacks access to source investor evidence', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const submitted = eligibility({ status: 'SUBMITTED', effective: false, holder_user_id: other, investor_application: null, can_decide: true, can_approve: false })
    value.product_eligibility = [submitted]
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={submitted.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('Source documents are outside this review scope')
    expect(detail).toContain('Approval unavailable for this case')
    expect(detail).toContain('value="APPROVED" disabled=""')
    expect(detail).toContain('Request further information')
    expect(detail).not.toContain('Approved investor admission evidence')
  })
  it('hides decision controls when the server-derived reviewer permission is false', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const submitted = eligibility({ status: 'SUBMITTED', effective: false, holder_user_id: other, investor_application: application({ user_id: other }), can_decide: false, can_approve: false })
    value.product_eligibility = [submitted]
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={submitted.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('Current independent review authority is required')
    expect(detail).not.toContain('Record eligibility decision</button>')
  })
  it('does not surface another organisation’s eligibility case in the reviewer queue or detail', () => {
    const value = snapshot(); value.actor.can_review = true; value.operating_context = operating('ComplianceOfficer'); value.products = [product()]
    const foreign = eligibility({ organisation_id: otherOrganisation, holder_user_id: other })
    value.product_eligibility = [foreign]
    const queue = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance" operatingContext={operating('ComplianceOfficer')} />)
    expect(queue).not.toContain(foreign.id)
    const detail = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/compliance/detail" id={foreign.id} operatingContext={operating('ComplianceOfficer')} />)
    expect(detail).toContain('This record is not available in your current operating scope')
  })
})

describe('portal command transport', () => {
  it('uses the fixed authenticated same-origin endpoint and the exact caller request key', async () => {
    const value = snapshot(); const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot: value }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch)
    const command = { command: 'publish_product' as const, key: requestKey, payload: { product_id: productId, expected_revision: 3 } }
    expect(await postPortalCommand(command)).toEqual(value)
    expect(fetch).toHaveBeenCalledWith('/api/portal/command', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', body: JSON.stringify({ ...command, operating_context: APPLICANT_CONTEXT }) }))
  })
  it('classifies a stale version response as a correctable denial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'The product revision changed. Refresh before editing.' }), { status: 409, headers: { 'content-type': 'application/json' } })))
    await expect(postPortalCommand({ command: 'publish_product', key: requestKey, payload: { product_id: productId, expected_revision: 3 } })).rejects.toMatchObject({ definitive: true })
  })
  it('does not turn a server failure or HTML login response into a successful command', async () => {
    const command = { command: 'publish_product' as const, key: requestKey, payload: { product_id: productId, expected_revision: 3 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } })))
    await expect(postPortalCommand(command)).rejects.toMatchObject({ definitive: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })))
    await expect(postPortalCommand(command)).rejects.toThrow('did not confirm the outcome')
  })
})

describe('durable portal request identity without personal-data retention', () => {
  function storage() {
    const values = new Map<string, string>()
    return { values, getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value) }), removeItem: vi.fn((key: string) => { values.delete(key) }) }
  }
  const command = () => ({ command: 'create_product' as const, key: requestKey, payload: { organisation_id: organisation, terms: fictionalProductTerms() } })
  it('persists only key, command and SHA256 digest, never document contents or applicant data', async () => {
    const saved = storage(); await prepareDurablePortalCommand(saved, actor, command(), [])
    const marker = JSON.parse([...saved.values.values()][0])
    expect(Object.keys(marker).sort()).toEqual(['command', 'key', 'payloadHash'])
    expect(marker.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(marker)).not.toContain('FICTIONAL TEST MEMORANDUM'); expect(JSON.stringify(marker)).not.toContain('issuer_name')
  })
  it('reuses the original key after reload when the exact original payload is re-entered', async () => {
    const saved = storage(); await prepareDurablePortalCommand(saved, actor, command(), [])
    const resumed = await prepareDurablePortalCommand(saved, actor, { ...command(), key: other }, [])
    expect(resumed.key).toBe(requestKey)
  })
  it('blocks a changed payload after reload rather than issuing a duplicate request key', async () => {
    const saved = storage(); await prepareDurablePortalCommand(saved, actor, command(), [])
    const retained = [...saved.values.values()][0]
    await expect(prepareDurablePortalCommand(saved, actor, { ...command(), key: other, payload: { ...command().payload, terms: { ...fictionalProductTerms(), name: 'Changed product' } } }, [])).rejects.toThrow('Re-enter the original values')
    expect([...saved.values.values()][0]).toBe(retained)
  })
  it('clears only an exact key and command proven committed by the caller-scoped snapshot', async () => {
    const saved = storage(); await prepareDurablePortalCommand(saved, actor, command(), [])
    expect(reconcilePortalMarker(saved, actor, [{ key: other, command: 'create_product' }])).not.toBeNull()
    expect(reconcilePortalMarker(saved, actor, [{ key: requestKey, command: 'subscribe' }])).not.toBeNull()
    expect(reconcilePortalMarker(saved, actor, [{ key: requestKey, command: 'create_product' }])).toBeNull()
    expect(saved.values.size).toBe(0)
  })
  it('does not erase another caller’s unresolved marker', async () => {
    const saved = storage(); await prepareDurablePortalCommand(saved, actor, command(), [])
    expect(reconcilePortalMarker(saved, other, [{ key: requestKey, command: 'create_product' }])).toBeNull()
    expect(saved.values.size).toBe(1)
  })
  it('fails before dispatch when session storage is unavailable', async () => {
    const saved = storage(); saved.setItem.mockImplementationOnce(() => { throw new Error('Storage unavailable') })
    await expect(prepareDurablePortalCommand(saved, actor, command(), [])).rejects.toThrow('Storage unavailable')
  })
  it('admits only one competing same-tab request while both payload digests are in flight', async () => {
    const saved = storage()
    const outcomes = await Promise.allSettled([prepareDurablePortalCommand(saved, actor, command(), []), prepareDurablePortalCommand(saved, actor, { ...command(), key: other }, [])])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(saved.values.size).toBe(1)
  })
})
