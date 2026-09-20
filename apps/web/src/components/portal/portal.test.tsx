import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PORTAL_PATHS, productTermsSchema, type PortalApplication, type PortalPageData, type PortalProduct, type PortalSnapshot } from '@/lib/portal/contracts'
import { PortalScreen, productManagementOrganisations } from './portal-screens'
import { portalNavigation, PortalShell } from './portal-shell'
import { fictionalProductTerms } from './product-form'
import { ApplicationReview, ProductReview, SubscriptionForm, currentInvestorApplication } from './portal-workflows'
import { postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import { money } from './portal-primitives'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const applicationId = '55555555-5555-4555-8555-555555555555'
const requestKey = '66666666-6666-4666-8666-666666666666'
function snapshot(): PortalSnapshot { return { actor: { id: actor, email: 'synthetic@example.invalid', display_name: 'Synthetic User', can_review: false }, applications: [], organisations: [], products: [], subscriptions: [], events: [] } }
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
    const value = snapshot(); value.applications = [application()]
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

describe('portal command transport', () => {
  it('uses the fixed authenticated same-origin endpoint and the exact caller request key', async () => {
    const value = snapshot(); const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot: value }), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch)
    const command = { command: 'publish_product' as const, key: requestKey, payload: { product_id: productId, expected_revision: 3 } }
    expect(await postPortalCommand(command)).toEqual(value)
    expect(fetch).toHaveBeenCalledWith('/api/portal/command', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', body: JSON.stringify(command) }))
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
