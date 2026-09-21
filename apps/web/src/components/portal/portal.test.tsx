import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_PATHS, productTermsSchema, type PortalApplication, type PortalInvestmentAccount, type PortalOrganisation, type PortalPageData, type PortalProduct, type PortalSnapshot, type PortalSubscription } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { Bx1Role } from '@/lib/supabase/contracts'
import { PortalScreen, productManagementOrganisations } from './portal-screens'
import { portalNavigation, PortalShell } from './portal-shell'
import { fictionalProductTerms } from './product-form'
import { ApplicationReview, InvestmentAccountPanel, ProductActions, ProductReview, SubscriptionForm, activeIndividualAccounts, currentInvestorApplication } from './portal-workflows'
import { postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import { money } from './portal-primitives'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const applicationId = '55555555-5555-4555-8555-555555555555'
const requestKey = '66666666-6666-4666-8666-666666666666'
const nativeOrganisation = '77777777-7777-4777-8777-777777777777'
const accountId = '88888888-8888-4888-8888-888888888888'
const otherOrganisation = '99999999-9999-4999-8999-999999999999'
function snapshot(): PortalSnapshot { return { actor: { id: actor, email: 'synthetic@example.invalid', display_name: 'Synthetic User', can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [], accounts: [], operating_context: APPLICANT_CONTEXT } }
function account(change: Partial<PortalInvestmentAccount> = {}): PortalInvestmentAccount { return { id: accountId, holder_user_id: actor, application_id: applicationId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: '2026-09-20T10:00:00Z', ...change } }
function operating(role: Bx1Role): PortalOperatingContext { return { mode: 'ROLE', organisationId: nativeOrganisation, role } }
function order(change: Partial<PortalSubscription> = {}): PortalSubscription { return { id: requestKey, product_id: productId, investment_account_id: accountId, investor_id: actor, product_name: 'Fictional Test Fund', organisation_id: organisation, product_revision: 3, terms_hash: 'ab'.repeat(32), units: '10', amount_minor: '100000', status: 'AWAITING_FUNDING', created_at: '2026-09-20T10:00:00Z', ...change } }
function operatorOrganisation(role: 'OfferingManager' | 'IssuerFundManager' = 'OfferingManager'): PortalOrganisation {
  return { id: organisation, name: 'Fictional Product Organisation', status: 'ACTIVE', roles: [role], native_organisation_id: nativeOrganisation, authority_source: 'NATIVE_BINDING' as const, capabilities: ['create_product', 'save_product', 'submit_product', 'publish_product', 'read_orders'] }
}
function application(change: Partial<PortalApplication> = {}): PortalApplication {
  return { id: applicationId, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 1, details: { full_name: 'Synthetic Investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Entirely fictional test savings for workflow validation.', beneficial_owners: '', experience: 'Fictional investment experience for manual test review.', documents: [], test_data_acknowledged: true }, submitted_at: '2026-09-20T10:00:00Z', reviewed_at: '2026-09-20T11:00:00Z', reviewer_id: other, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z', ...change }
}
function product(change: Partial<PortalProduct> = {}): PortalProduct {
  return { id: productId, organisation_id: organisation, created_by: other, revision: 3, status: 'PUBLISHED', terms: fictionalProductTerms(), terms_hash: 'ab'.repeat(32), reserved_units: '0', created_at: '2026-09-20T10:00:00Z', reviewer_id: actor, review_notes: null, reviewed_at: '2026-09-20T11:00:00Z', published_at: '2026-09-20T12:00:00Z', review_checks: {}, ...change }
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
    const value = snapshot(); value.subscriptions = [{ id: requestKey, product_id: productId, investor_id: actor, product_name: 'Fictional Test Fund', organisation_id: organisation, product_revision: 3, terms_hash: 'ab'.repeat(32), units: '10', amount_minor: '100000', status: 'AWAITING_FUNDING', created_at: '2026-09-20T10:00:00Z' }]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal/portfolio" />)
    expect(html).toContain('Awaiting funding'); expect(html).toContain('Reservations are not holdings'); expect(html).toContain('Cancel unfunded reservation')
    expect(html).not.toContain('Portfolio return'); expect(html).not.toContain('Total assets under management')
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
    const value = snapshot(); value.applications = [application()]; value.accounts = [account()]
    const html = renderToStaticMarkup(<SubscriptionForm product={product()} snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Revision 3'); expect(html).toContain('displayed terms fingerprint'); expect(html).toContain('risk disclosures')
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
  it.each(['FUND', 'REAL_ESTATE'] as const)('starts %s from a valid, explicitly fictional editable product template', kind => {
    const terms = fictionalProductTerms(kind)
    expect(productTermsSchema.safeParse(terms).success).toBe(true)
    expect(terms.issuer_name).toContain('fictional')
    expect(terms.documents.memorandum).toContain('FICTIONAL TEST')
    expect(terms.documents.risks.length).toBeGreaterThan(50); expect(terms.documents.subscription_terms.length).toBeGreaterThan(50)
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
    expect(html).toContain(requestKey); expect(html).toContain(accountId); expect(html).toContain('ab'.repeat(32)); expect(html).toContain('Terms revision 3')
    expect(html).toContain('Funding verification is not connected'); expect(html).not.toContain('Cancel unfunded reservation')
    expect(html.indexOf('Product register')).toBeLessThan(html.indexOf('Role, hand-offs and signing guidance'))
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
  })
  it('does not render another context’s events as a generic recent-activity feed', () => {
    const value = snapshot(); value.operating_context = operating('Investor'); value.events = [{ id: requestKey, subject_id: productId, kind: 'PRIVATE_CASE', actor_id: other, created_at: '2026-09-20T10:00:00Z', summary: 'Other reviewer private event' }]
    const html = renderToStaticMarkup(<PortalScreen data={data(value)} view="/portal" operatingContext={operating('Investor')} />)
    expect(html).not.toContain('Other reviewer private event')
  })
})

describe('owned individual investment-account controls', () => {
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
    value.accounts = [account()]
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
    const value = snapshot(); value.applications = [application({ details: { ...application().details, investor_type: 'ENTITY', company_name: 'Entity Applicant' } })]; value.accounts = [account()]
    expect(activeIndividualAccounts(value)).toEqual([])
    const html = renderToStaticMarkup(<InvestmentAccountPanel snapshot={value} onSaved={vi.fn()} />)
    expect(html).toContain('Entity representation requires a mandate'); expect(html).not.toContain('Open individual investment account</button>')
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
