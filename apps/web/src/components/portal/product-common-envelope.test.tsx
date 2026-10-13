// @vitest-environment jsdom
import React from 'react'
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type FundTermsV2, type RealEstateTermsV2, type PortalOfferingPackage, type PortalProduct, type PortalSnapshot } from '@/lib/portal/contracts'
import { prepareCommonEnvelopeUpgrade, type CommonEnvelopeTerms } from '@/lib/portal/product-common-envelope'
import { type PortalOperatingContext } from '@/lib/portal/operating-context'
import { PortalCommandProvider } from './portal-client'
import { ProductForm, fictionalProductTerms } from './product-form'
import { OfferingPackageEvidence, ProductFacts, ProductNarrative, ProductReview, IssuerOfferingReview } from './portal-workflows'

// Actual mounted editor/reviewer and durable transport; controlled synthetic
// responses. These tests do not attest hosted SQL, humans, documents or providers.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
const managerActor = '11111111-1111-4111-8111-111111111111', reviewerActor = '22222222-2222-4222-8222-222222222222'
const portalOrganisation = '33333333-3333-4333-8333-333333333333', nativeOrganisation = '44444444-4444-4444-8444-444444444444'
const productId = '55555555-5555-4555-8555-555555555555', packageId = '66666666-6666-4666-8666-666666666666'
const issuerRef = '77777777-7777-4777-8777-777777777777', classRef = '88888888-8888-4888-8888-888888888888'
type Role = 'OfferingManager' | 'IssuerFundManager' | 'ComplianceOfficer'
const context = (role: Role): PortalOperatingContext => ({ mode: 'ROLE', role, organisationId: nativeOrganisation })
function draft(kind: 'FUND' | 'REAL_ESTATE'): PortalProduct {
  return { id: productId, organisation_id: portalOrganisation, created_by: managerActor, revision: 1, status: 'DRAFT', terms: fictionalProductTerms(kind), terms_hash: 'a'.repeat(64), reserved_units: '0', created_at: '2026-10-12T00:00:00Z', reviewer_id: null, review_notes: null, reviewed_at: null, published_at: null, review_checks: {}, allowed_actions: ['save_product', 'submit_product'], offering_package: null, offering_history: [] }
}
function reviewedProduct(kind: 'FUND' | 'REAL_ESTATE'): PortalProduct {
  const product = draft(kind)
  const value = prepareCommonEnvelopeUpgrade(product.terms as FundTermsV2 | RealEstateTermsV2, portalOrganisation, issuerRef, classRef)
  if (value.asset_type === 'REAL_ESTATE') { value.issuer_name = value.real_estate.spv.legal_name; value.common_envelope.issuer.legal_name = value.real_estate.spv.legal_name }
  const pkg: PortalOfferingPackage = { id: packageId, package_number: 1, origin: 'SUBMITTED', terms_hash: product.terms_hash, document_hashes: { memorandum: 'd'.repeat(64), risks: 'e'.repeat(64), subscription_terms: 'f'.repeat(64) }, submitted_at: product.created_at, issuer_status: 'PENDING', compliance_status: 'PENDING', technical_readiness_status: 'NOT_VERIFIED', can_review_issuer: true, can_review_compliance: true, common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64), common_envelope: structuredClone(value.common_envelope), deployment_configuration: structuredClone(value.deployment_configuration) }
  return { ...product, terms: value, status: 'IN_REVIEW', revision: 2, offering_package: pkg, offering_history: [pkg], allowed_actions: ['review_product', 'review_offering_issuer'] }
}
function snapshot(role: Role, product: PortalProduct): PortalSnapshot {
  return { actor: { id: role === 'OfferingManager' ? managerActor : reviewerActor, email: 'fictional-participant@example.invalid', display_name: 'Synthetic participant', can_review: role === 'ComplianceOfficer' }, operating_context: context(role), applications: [], organisations: [{ id: portalOrganisation, name: 'Fictional manager organisation', status: 'ACTIVE', roles: ['OfferingManager'], capabilities: ['create_product', 'save_product', 'submit_product'], native_organisation_id: nativeOrganisation, authority_source: 'NATIVE_BINDING' }], products: [product], subscriptions: [], events: [], requests: [] }
}
let active: PortalSnapshot, lastBody: { command: string; key: string; payload: Record<string, unknown> }, failFirst = false
const saved = vi.fn()
const fetchCommand = vi.fn(async (_url: unknown, init?: RequestInit) => {
  lastBody = JSON.parse(String(init?.body))
  expect(portalCommandSchema.safeParse({ command: lastBody.command, key: lastBody.key, payload: lastBody.payload }).success).toBe(true)
  if (failFirst) { failFirst = false; throw new Error('Synthetic interrupted outcome; no committed result observed.') }
  const result = { ...active, requests: [{ key: lastBody.key, command: lastBody.command }] }
  return new Response(JSON.stringify({ snapshot: result }), { headers: { 'content-type': 'application/json' } })
})
function mountEditor(product: PortalProduct) {
  active = snapshot('OfferingManager', product)
  return render(<PortalCommandProvider snapshot={active} operatingContext={context('OfferingManager')} environment="TESTNET"><ProductForm organisations={active.organisations} product={product} onSaved={saved} operatingContext={context('OfferingManager')} /></PortalCommandProvider>)
}
function mountReviewer(role: 'IssuerFundManager' | 'ComplianceOfficer', product: PortalProduct) {
  active = snapshot(role, product)
  return render(<PortalCommandProvider snapshot={active} operatingContext={context(role)} environment="TESTNET">{role === 'IssuerFundManager' ? <IssuerOfferingReview product={product} snapshot={active} onSaved={saved} /> : <ProductReview product={product} snapshot={active} onSaved={saved} />}</PortalCommandProvider>)
}
function upgrade(kind: 'FUND' | 'REAL_ESTATE') {
  fireEvent.click(screen.getByRole('button', { name: 'Add a v3 common-envelope proposal to this draft' }))
  if (kind === 'REAL_ESTATE') fireEvent.click(screen.getByRole('button', { name: 'Use the reviewed SPV identity for this declaration' }))
}
function acknowledge() { fireEvent.click(screen.getByRole('checkbox', { name: /I have reviewed this explicitly fictional product/ })) }
beforeEach(() => { saved.mockReset(); fetchCommand.mockClear(); failFirst = false; sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetchCommand) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('connected normal v3 editor and immutable review panes', () => {
  it.each(['FUND', 'REAL_ESTATE'] as const)('explicitly upgrades and saves a complete %s proposal without changing its TST economics or history', async kind => {
    const product = draft(kind), original = structuredClone(product)
    mountEditor(product)
    expect(screen.queryByLabelText('Product-local issuer reference')).toBeNull()
    upgrade(kind)
    expect(screen.getByLabelText('Managing organisation reference (product scope)')).toHaveProperty('value', portalOrganisation)
    expect(screen.getByLabelText('Product-local issuer reference')).toHaveProperty('readOnly', true)
    fireEvent.change(screen.getByLabelText('Register correction proposal'), { target: { value: 'Deliberately edited synthetic correction policy, subject to independent package review.' } })
    acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(lastBody.command).toBe('save_product'); expect(lastBody.payload.product_id).toBe(productId)
    const value = lastBody.payload.terms as CommonEnvelopeTerms
    expect(value.terms_version).toBe(3); expect(value.unit_price_minor).toBe(original.terms.unit_price_minor); expect(value.cap_units).toBe(original.terms.cap_units); expect(value.property_valuation_minor).toBe(original.terms.property_valuation_minor); expect(value.documents).toEqual(original.terms.documents)
    expect(value.common_envelope.manager_organisation_id).toBe(portalOrganisation); expect(value.common_envelope.manager_organisation_id).not.toBe(nativeOrganisation)
    expect(value.common_envelope.issuer.declaration_revision).toBe(1)
    if (value.asset_type === 'REAL_ESTATE') expect(value.common_envelope.issuer.legal_name).toBe(value.real_estate.spv.legal_name)
    expect(product).toEqual(original); expect(sessionStorage.length).toBe(0)
  })
  it('blocks a property upgrade until the issuer/SPV mismatch is explicitly resolved', async () => {
    const product = draft('REAL_ESTATE'); mountEditor(product)
    fireEvent.click(screen.getByRole('button', { name: 'Add a v3 common-envelope proposal to this draft' }))
    expect(screen.getByText('Resolve the issuer/SPV identity mismatch')).toBeTruthy()
    acknowledge(); fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(fetchCommand).not.toHaveBeenCalled(); expect(product.terms.issuer_name).not.toBe((product.terms as RealEstateTermsV2).real_estate.spv.legal_name)
  })
  it('retains stable class references and prevents an incomplete secondary declaration from saving', async () => {
    mountEditor(draft('FUND')); upgrade('FUND')
    const originalReference = (screen.getByLabelText('Primary class reference') as HTMLInputElement).value
    fireEvent.change(screen.getByLabelText('Offering capacity (whole units)'), { target: { value: '90' } })
    expect(screen.getByLabelText('Primary class reference')).toHaveProperty('value', originalReference)
    fireEvent.click(screen.getByRole('button', { name: 'Add a declaration-only class' }))
    acknowledge(); fireEvent.submit(screen.getByRole('button', { name: 'Save revised draft' }).closest('form')!)
    expect(fetchCommand).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Secondary class 1 name'), { target: { value: 'Fictional Class B' } }); fireEvent.change(screen.getByLabelText('Secondary class 1 declared rights'), { target: { value: 'A declared secondary interest only; no issuance, subscription or accounting is represented.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' })); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    const value = lastBody.payload.terms as CommonEnvelopeTerms
    expect(value.common_envelope.classes[0].class_id).toBe(originalReference); expect(value.common_envelope.classes[0].cap_units).toBe('90')
    expect(value.common_envelope.classes[1]).toMatchObject({ primary: false, operational_scope: 'DECLARATION_ONLY', unit_price_minor: null, cap_units: null, minimum_units: null })
  })
  it('preserves original-key retry and the full v3 payload after an unknown outcome', async () => {
    mountEditor(draft('FUND')); upgrade('FUND'); acknowledge(); failFirst = true
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry the original saved request' })).toBeTruthy())
    const first = structuredClone(lastBody)
    expect(screen.getByLabelText('Register correction proposal').closest('fieldset')).toHaveProperty('disabled', true)
    expect(sessionStorage.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the original saved request' })); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(lastBody).toEqual(first); expect(fetchCommand).toHaveBeenCalledTimes(2); expect(sessionStorage.length).toBe(0)
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('uses immutable projected hashes for both %s reviewers and never advertises deployment', async kind => {
    const product = reviewedProduct(kind)
    for (const role of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const mounted = mountReviewer(role, product)
      expect(screen.getByText('b'.repeat(64))).toBeTruthy(); expect(screen.getByText('c'.repeat(64))).toBeTruthy()
      expect(screen.getByText(/configuration NOT DEPLOYED/)).toBeTruthy()
      fireEvent.change(screen.getByLabelText(role === 'IssuerFundManager' ? 'Issuer decision' : 'Decision'), { target: { value: 'CHANGES_REQUIRED' } })
      fireEvent.change(screen.getByLabelText(role === 'IssuerFundManager' ? /Issuer rationale/ : /Review rationale/), { target: { value: 'Independent synthetic review requests one specific package correction.' } })
      fireEvent.click(screen.getByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' }))
      await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
      expect(lastBody.payload).toMatchObject({ offering_revision_id: packageId, terms_hash: 'a'.repeat(64), common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64) })
      mounted.unmount(); saved.mockReset(); fetchCommand.mockClear()
    }
  })
  it.each(['missing', 'partial', 'malformed', 'mismatched'] as const)('fails closed for %s current v3 bindings in both reviewers', failure => {
    for (const role of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const product = reviewedProduct('FUND'), pkg = product.offering_package!
      if (failure === 'missing') { delete pkg.common_envelope_hash; delete pkg.deployment_configuration_hash; delete pkg.common_envelope; delete pkg.deployment_configuration }
      if (failure === 'partial') pkg.deployment_configuration = null
      if (failure === 'malformed') Object.assign(pkg.common_envelope!, { client_approved: true })
      if (failure === 'mismatched') pkg.common_envelope!.register.correction_policy = 'Another immutable proposal does not match the currently displayed product.'
      const mounted = mountReviewer(role, product)
      expect(screen.queryByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' })).toBeNull()
      expect(fetchCommand).not.toHaveBeenCalled(); mounted.unmount()
    }
  })
  it('displays each historical immutable proposal rather than borrowing the current draft', () => {
    const product = reviewedProduct('FUND'), historic = structuredClone(product.offering_package!)
    historic.id = issuerRef; historic.package_number = 1; historic.common_envelope!.register.correction_policy = 'HISTORICAL IMMUTABLE CORRECTION POLICY: retain this exact reviewed former package.'
    product.offering_package!.package_number = 2
    if (product.terms.terms_version === 3) product.terms.common_envelope.register.correction_policy = 'CURRENT EDITABLE CORRECTION POLICY: this must never replace historical evidence.'
    product.offering_history = [historic, { ...historic, id: classRef, origin: 'LEGACY_PRODUCT_SNAPSHOT', common_envelope_hash: null, deployment_configuration_hash: null, common_envelope: null, deployment_configuration: null }]
    render(<><ProductFacts product={product} /><ProductNarrative product={product} /><OfferingPackageEvidence product={product} /></>)
    expect(screen.getByText('Fund policy v3 · declared common package')).toBeTruthy()
    expect(screen.getByText(historic.common_envelope!.register.correction_policy)).toBeTruthy()
    expect(screen.queryByText('CURRENT EDITABLE CORRECTION POLICY: this must never replace historical evidence.')).toBeNull()
    expect(screen.getByText(/no v3 common-envelope or deployment-configuration bindings were recorded/)).toBeTruthy()
    expect(screen.queryByText('Historical fund terms')).toBeNull()
  })
})
