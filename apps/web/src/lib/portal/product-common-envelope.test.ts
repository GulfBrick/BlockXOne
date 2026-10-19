import { describe, expect, it } from 'vitest'
import { FUND_V2_CANONICAL_REFERENCES, REAL_ESTATE_V2_CANONICAL_REFERENCES, portalCommandSchema, productTermsSchema, type FundTermsV2, type RealEstateTermsV2, type PortalOfferingPackage, type PortalProduct } from './contracts'
import { issuerDeclarationForEdit, prepareCommonEnvelopeUpgrade, productCommonEnvelopeSchema, productDeploymentConfigurationSchema, readCommonEnvelopeProjection, reviewCommonEnvelopeBindings, sameJson, strictProductText, syncCommonEnvelopeReferences, type CommonEnvelopeTerms, type ProductCommonEnvelope } from './product-common-envelope'

const manager = '11111111-1111-4111-8111-111111111111', reference = '22222222-2222-4222-8222-222222222222', classId = '33333333-3333-4333-8333-333333333333', productId = '44444444-4444-4444-8444-444444444444'
const key = '55555555-5555-4555-8555-555555555555'
const narrative = 'Fictional independently reviewed policy for this synthetic package; no actual legal, financial, provider or chain operation is admitted.'
function economic(kind: 'FUND' | 'REAL_ESTATE'): FundTermsV2 | RealEstateTermsV2 {
  const common = { name: 'Synthetic test package', issuer_name: 'Synthetic Test Issuer', summary: narrative, share_class: 'Primary test class', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'] as ('INDIVIDUAL' | 'ENTITY')[], documents: { memorandum: narrative, risks: narrative, subscription_terms: narrative }, minimum_units: '1', currency: 'TST' as const, settlement_decimals: 6 as const, terms_version: 2 as const }
  if (kind === 'FUND') return { ...common, ...FUND_V2_CANONICAL_REFERENCES, asset_type: 'FUND', unit_price_minor: '10000000', cap_units: '100', property_address: '', property_valuation_minor: '0', rental_income_policy: '', fund: {
    mandate: narrative, class_rights: narrative, nav: { valuation_method: narrative, frequency: 'MONTHLY', pricing_cutoff: 'Last business day, 16:00 Africa/Johannesburg', correction_policy: narrative }, dealing: { subscription_frequency: 'MONTHLY', redemption_frequency: 'MONTHLY', notice_days: 5, settlement_days: 5 }, fees: { management_bps: 0, performance_bps: 0, other_fees: narrative }, liquidity: { lockup_days: 0, gate_bps: 10000, suspension_policy: narrative }, distributions: { frequency: 'QUARTERLY', policy: narrative }, redemption: { price_basis: 'NAV', conditions: narrative },
  } }
  return { ...common, ...REAL_ESTATE_V2_CANONICAL_REFERENCES, asset_type: 'REAL_ESTATE', unit_price_minor: '100000000', cap_units: '20', property_address: 'Fictional property description', property_valuation_minor: '3000000000', real_estate: {
    spv: { legal_name: 'Different Fictional SPV', registration_reference: 'FICTIONAL-SPV-001', jurisdiction: 'ZA', interest_rights: narrative }, property: { title_evidence_reference: 'FICTIONAL-TITLE-001', control_evidence_reference: 'FICTIONAL-CONTROL-001', valuation_method: narrative, valuation_frequency: 'ANNUALLY', correction_policy: narrative }, financing: { debt_policy: narrative, lender_consent_policy: narrative }, cashflow: { rent_policy: narrative, expense_policy: narrative, reserve_policy: narrative, distribution_policy: narrative }, governance: { consent_rights: narrative, voting_policy: narrative }, exits: { eligible_transfer_policy: `Interest transfer: ${narrative}`, disposal_liquidation_policy: `Disposal and liquidation: ${narrative}` },
  } }
}
function terms(kind: 'FUND' | 'REAL_ESTATE' = 'FUND'): CommonEnvelopeTerms {
  const upgraded = prepareCommonEnvelopeUpgrade(economic(kind), manager, reference, classId)
  if (upgraded.asset_type === 'REAL_ESTATE') { upgraded.issuer_name = upgraded.real_estate.spv.legal_name; upgraded.common_envelope.issuer.legal_name = upgraded.real_estate.spv.legal_name }
  return upgraded
}
function record(value: CommonEnvelopeTerms): PortalProduct {
  const pkg: PortalOfferingPackage = { id: key, package_number: 1, origin: 'SUBMITTED', terms_hash: 'a'.repeat(64), document_hashes: { memorandum: 'd'.repeat(64), risks: 'e'.repeat(64), subscription_terms: 'f'.repeat(64) }, submitted_at: '2026-10-12T00:00:00Z', issuer_status: 'PENDING', compliance_status: 'PENDING', technical_readiness_status: 'NOT_VERIFIED', common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64), common_envelope: structuredClone(value.common_envelope), deployment_configuration: structuredClone(value.deployment_configuration) }
  return { id: productId, organisation_id: manager, created_by: reference, revision: 2, status: 'IN_REVIEW', terms: value, terms_hash: pkg.terms_hash, reserved_units: '0', created_at: pkg.submitted_at, reviewer_id: null, review_notes: null, reviewed_at: null, published_at: null, review_checks: {}, offering_package: pkg }
}

describe('v3 common envelope contracts (synthetic structure, not SQL/provider acceptance)', () => {
  it.each(['FUND', 'REAL_ESTATE'] as const)('preserves %s economics and full raw terms while adding a strict proposal', kind => {
    const original = economic(kind), value = terms(kind)
    const parsed = productTermsSchema.safeParse(value)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual(value)
    expect(value.unit_price_minor).toBe(original.unit_price_minor); expect(value.cap_units).toBe(original.cap_units); expect(value.property_valuation_minor).toBe(original.property_valuation_minor)
    expect(value.documents).toEqual(original.documents)
    expect(portalCommandSchema.safeParse({ command: 'create_product', key, payload: { organisation_id: manager, terms: value } }).success).toBe(true)
    expect(productTermsSchema.safeParse(original).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'save_product', key, payload: { product_id: productId, expected_revision: 1, terms: original } }).success).toBe(true)
  })
  it('does not silently resolve the old property issuer/SPV mismatch or modify its source', () => {
    const old = economic('REAL_ESTATE'), preserved = structuredClone(old)
    const upgraded = prepareCommonEnvelopeUpgrade(old, manager, reference, classId)
    expect(productTermsSchema.safeParse(upgraded).success).toBe(false)
    expect(upgraded.issuer_name).toBe(old.issuer_name); expect(old).toEqual(preserved)
  })
  it('counts Unicode code points and never trims a v3 string or transformed economics', () => {
    expect(strictProductText(3, 3).safeParse('😀😀😀').success).toBe(true)
    expect(strictProductText(3, 3).safeParse('😀😀😀😀').success).toBe(false)
    const value = terms(); value.name = '😀'.repeat(120)
    const parsed = productTermsSchema.safeParse(value)
    expect(parsed.success).toBe(true); if (parsed.success) expect(parsed.data.name).toBe(value.name)
    for (const invalid of [' '+narrative, narrative+' ', '\t'+narrative, narrative+'\n']) { const changed = structuredClone(value); changed.summary = invalid; expect(productTermsSchema.safeParse(changed).success).toBe(false) }
  })
  it('requires ten property-address Unicode code points for v3 without changing the old v2 parser', () => {
    const value = terms('REAL_ESTATE')
    value.property_address = '😀'.repeat(5)
    expect(productTermsSchema.safeParse(value).success).toBe(false)
    value.property_address = '😀'.repeat(10)
    const parsed = productTermsSchema.safeParse(value)
    expect(parsed.success).toBe(true); if (parsed.success) expect(parsed.data.property_address).toBe(value.property_address)
    const old = economic('REAL_ESTATE'); old.property_address = '😀'.repeat(5)
    expect(productTermsSchema.safeParse(old).success).toBe(true)
  })
  it('uses a twenty-codepoint rental minimum without relaxing the mandatory property pointer', () => {
    const minimumIssue = 'Provide property, valuation and rental-income terms.'
    for (const length of [19, 20]) {
      const value = terms('REAL_ESTATE'); value.rental_income_policy = '😀'.repeat(length)
      const parsed = productTermsSchema.safeParse(value)
      expect(parsed.success).toBe(false) // Both arbitrary strings still violate the canonical pointer.
      if (!parsed.success) {
        expect(parsed.error.issues.some(issue => issue.message === minimumIssue)).toBe(length === 19)
        expect(parsed.error.issues.some(issue => issue.path.join('.') === 'rental_income_policy')).toBe(true)
      }
    }
    const raw = strictProductText(20, 2000).safeParse('😀'.repeat(20))
    expect(raw.success).toBe(true); if (raw.success) expect(raw.data).toBe('😀'.repeat(20))
    const old = economic('REAL_ESTATE'); old.rental_income_policy = '😀'.repeat(19)
    const retained = productTermsSchema.safeParse(old)
    expect(retained.success).toBe(false) // The old canonical pointer still applies.
    if (!retained.success) expect(retained.error.issues.some(issue => issue.message === minimumIssue)).toBe(false)
  })
  it.each([
    { property_address: 'Fictional property address is not a fund field' },
    { property_valuation_minor: '1' },
    { rental_income_policy: narrative },
  ])('rejects nonempty property economics on v3 FUND: %j', change => {
    expect(productTermsSchema.safeParse({ ...terms('FUND'), ...change }).success).toBe(false)
  })
  it('retains the old v2 fund parser semantics for its property compatibility fields', () => {
    const value = economic('FUND')
    expect(productTermsSchema.safeParse({ ...value, property_address: 'Fictional property compatibility text', property_valuation_minor: '1', rental_income_policy: narrative }).success).toBe(true)
  })
  it.each([
    ['missing legal form', (value: CommonEnvelopeTerms) => { delete (value.common_envelope.issuer as Partial<typeof value.common_envelope.issuer>).legal_form }],
    ['unknown envelope key', (value: CommonEnvelopeTerms) => { Object.assign(value.common_envelope, { approved: true }) }],
    ['uppercase UUID', (value: CommonEnvelopeTerms) => { value.common_envelope.issuer.issuer_reference = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
    ['zero UUID', (value: CommonEnvelopeTerms) => { value.common_envelope.issuer.issuer_reference = '00000000-0000-0000-0000-000000000000' }],
    ['numeric-string revision', (value: CommonEnvelopeTerms) => { Object.assign(value.common_envelope.issuer, { declaration_revision: '1' }) }],
    ['issuer disagreement', (value: CommonEnvelopeTerms) => { value.common_envelope.issuer.legal_name = 'Different declared issuer' }],
    ['primary rights disagreement', (value: CommonEnvelopeTerms) => { value.common_envelope.classes[0].rights = 'A different proposed class-rights schedule.' }],
    ['primary cap disagreement', (value: CommonEnvelopeTerms) => { value.common_envelope.classes[0].cap_units = '101' }],
    ['no primary', (value: CommonEnvelopeTerms) => { value.common_envelope.classes[0].primary = false }],
    ['duplicate primary', (value: CommonEnvelopeTerms) => { value.common_envelope.classes.push({ ...value.common_envelope.classes[0], class_id: productId }) }],
    ['duplicate class ID', (value: CommonEnvelopeTerms) => { value.common_envelope.classes.push({ ...value.common_envelope.classes[0] }) }],
    ['custodian missing', (value: CommonEnvelopeTerms) => { value.common_envelope.custody_title.asset_control_model = 'CUSTODIAN_CONTROL_DECLARED' }],
    ['issuer has custodian', (value: CommonEnvelopeTerms) => { value.common_envelope.custody_title.custodian_legal_name = 'Invented custodian' }],
    ['eligibility duplicates', (value: CommonEnvelopeTerms) => { value.eligible_countries = ['ZA', 'ZA'] }],
    ['default duplicates', (value: CommonEnvelopeTerms) => { value.common_envelope.servicing.default_events = ['REPORTING_FAILURE', 'REPORTING_FAILURE'] }],
    ['wrong configuration class', (value: CommonEnvelopeTerms) => { value.deployment_configuration.class_ids = [key] }],
    ['threshold exceeds slots', (value: CommonEnvelopeTerms) => { value.deployment_configuration.signing.threshold = 4 }],
    ['wrong policy order', (value: CommonEnvelopeTerms) => { value.deployment_configuration.signing.policy_slots.reverse() }],
    ['hidden actual signer', (value: CommonEnvelopeTerms) => { Object.assign(value.deployment_configuration.signing, { signer_address: '0x1234' }) }],
    ['deployed claim', (value: CommonEnvelopeTerms) => { Object.assign(value.deployment_configuration, { state: 'DEPLOYED' }) }],
    ['catch-all powers', (value: CommonEnvelopeTerms) => { const governance = value.deployment_configuration.governance; governance.controller_replacement_policy = narrative; for (const power of Object.keys(governance.powers) as (keyof typeof governance.powers)[]) governance.powers[power] = narrative }],
    ['wrong policy path', (value: CommonEnvelopeTerms) => { Object.assign(value.deployment_configuration.policy_refs, { transfer: 'client.custom.path' }) }],
    ['legacy text', (value: CommonEnvelopeTerms) => { value.common_envelope.fees.tax_policy = `ZAR_TEST ${narrative}` }],
  ] as const)('rejects %s without coercion or dropped keys', (_name, mutate) => { const value = terms(); mutate(value); expect(productTermsSchema.safeParse(value).success).toBe(false) })
  it('enforces secondary declaration-only economics and canonical order without sorting input', () => {
    const value = terms(), secondary: ProductCommonEnvelope['classes'][number] = { ...value.common_envelope.classes[0], class_id: productId, primary: false, operational_scope: 'DECLARATION_ONLY', unit_price_minor: null, cap_units: null, minimum_units: null }
    value.common_envelope.classes.push(secondary); value.deployment_configuration.class_ids.push(productId)
    expect(productTermsSchema.safeParse(value).success).toBe(true)
    secondary.unit_price_minor = '1'; expect(productTermsSchema.safeParse(value).success).toBe(false)
    secondary.unit_price_minor = null; value.common_envelope.classes.push({ ...secondary, class_id: key }); value.deployment_configuration.class_ids.push(key)
    value.common_envelope.classes = [value.common_envelope.classes[0], ...value.common_envelope.classes.slice(1).reverse()]
    expect(productTermsSchema.safeParse(value).success).toBe(false)
  })
  it('rejects the native manager reference and aggregate command overflow', () => {
    const value = terms()
    expect(portalCommandSchema.safeParse({ command: 'create_product', key, payload: { organisation_id: reference, terms: value } }).success).toBe(false)
    value.documents = { memorandum: '😀'.repeat(12000), risks: '😀'.repeat(12000), subscription_terms: '😀'.repeat(12000) }
    expect(productTermsSchema.safeParse(value).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'create_product', key, payload: { organisation_id: manager, terms: value } }).success).toBe(false)
  })
  it('binds both review hashes together, keeping strict old seven-field payloads intact', () => {
    const payload = { product_id: productId, offering_revision_id: key, expected_revision: 2, terms_hash: 'a'.repeat(64), decision: 'CHANGES_REQUIRED', notes: narrative, checks: { issuer: true, terms: true, disclosures: true, eligibility: true } }
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...payload, common_envelope_hash: 'b'.repeat(64) } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...payload, common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64) } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...payload, common_envelope_hash: null, deployment_configuration_hash: null } }).success).toBe(false)
    for (const change of [{ product_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { offering_revision_id: '00000000-0000-0000-0000-000000000000' }, { expected_revision: 1000000000 }]) expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...payload, ...change, common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64) } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...payload, expected_revision: 1000000000 } }).success).toBe(true)
  })
  it('does not invent pairwise-distinct prose constraints for specific governance powers', () => {
    const value = terms()
    value.deployment_configuration.governance.powers.upgrade = value.deployment_configuration.governance.powers.recovery
    expect(productTermsSchema.safeParse(value).success).toBe(true)
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('checks immutable %s package projections without computing client hashes', kind => {
    const value = terms(kind), product = record(value), pkg = product.offering_package!
    expect(reviewCommonEnvelopeBindings(product)).toEqual({ common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64) })
    for (const changed of [{ common_envelope_hash: undefined }, { deployment_configuration_hash: null }, { common_envelope_hash: 'BAD' }, { common_envelope: { ...value.common_envelope, approved: true } }]) expect(reviewCommonEnvelopeBindings({ ...product, offering_package: { ...pkg, ...changed } as PortalOfferingPackage })).toBe(null)
    const edited = structuredClone(product); if (edited.terms.terms_version === 3) edited.terms.common_envelope.register.correction_policy = `Edited after submission: ${narrative}`
    expect(reviewCommonEnvelopeBindings(edited)).toBe(null)
    expect(readCommonEnvelopeProjection(pkg)?.kind).toBe('V3')
    expect(readCommonEnvelopeProjection({ ...pkg, common_envelope_hash: null, deployment_configuration_hash: null, common_envelope: null, deployment_configuration: null })).toEqual({ kind: 'LEGACY' })
    expect(readCommonEnvelopeProjection({ ...pkg, common_envelope_hash: undefined, deployment_configuration_hash: undefined, common_envelope: undefined, deployment_configuration: undefined })).toEqual({ kind: 'LEGACY' })
  })
  it('keeps product-local references and increments only a deliberately changed issuer identity', () => {
    const value = terms(), saved = value.common_envelope.issuer
    expect(issuerDeclarationForEdit({ ...saved }, saved)).toEqual(saved)
    const changed = issuerDeclarationForEdit({ ...saved, legal_form: 'Different fictional legal form', issuer_reference: key }, saved)
    expect(changed.issuer_reference).toBe(saved.issuer_reference); expect(changed.declaration_revision).toBe(2)
    value.cap_units = '90'; const updated = syncCommonEnvelopeReferences(value)
    expect(updated.common_envelope.classes[0].class_id).toBe(classId); expect(updated.common_envelope.classes[0].cap_units).toBe('90'); expect(value.common_envelope.classes[0].cap_units).toBe('100')
    expect(sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true); expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(productCommonEnvelopeSchema.safeParse(updated.common_envelope).success).toBe(true); expect(productDeploymentConfigurationSchema.safeParse(updated.deployment_configuration).success).toBe(true)
  })
})
