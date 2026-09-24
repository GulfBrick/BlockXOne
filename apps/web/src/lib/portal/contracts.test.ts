import { describe, expect, it } from 'vitest'
import { PORTAL_PATHS, applicationDetailsSchema, applicationDocumentLookupSchema, applicationDocumentVersionsSchema, applicationDraftDetailsSchema, customerMonitoringSnapshotSchema, isWealthManagerDetailsV2, evidenceSchema, formatTestMoney, portalCommandSchema, productTermsSchema, subscriptionQuote, type PortalProduct, type ProductTerms } from './contracts'
import { isSupabaseWebPathAllowed } from '@/lib/auth-mode'
import { isProductionWebPathBlocked } from '@/lib/release-policy'

const id = 'd22789ee-7f73-4acf-a414-3de0b62ea801'
const key = '113800c3-cf6e-437e-abdf-a3b09a03fcff'
const terms: ProductTerms = { asset_type: 'FUND', name: 'Synthetic Balanced Fund', issuer_name: 'Fictional Fund Issuer', summary: 'A wholly synthetic investment product for testing.', strategy: 'A fictional diversified strategy with no real capital.', share_class: 'Class A', currency: 'ZAR_TEST', unit_price_minor: '12345678901234567890', cap_units: '100000', minimum_units: '10', pricing_basis: 'Fixed price for this test offering.', fees: 'No actual charges in this test environment.', redemption_terms: 'Synthetic redemption requires confirmed cancellation of units.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL'], property_address: '', property_valuation_minor: '0', rental_income_policy: '', documents: { memorandum: 'Fictional test memorandum; this is not an actual investment offer.', risks: 'Test-only disclosure: no real money, asset ownership or returns exist.', subscription_terms: 'Acceptance only reserves synthetic units and never proves funding.' } }
const product: PortalProduct = { id, organisation_id: id, created_by: id, revision: 4, status: 'PUBLISHED', terms, terms_hash: 'a'.repeat(64), reserved_units: '20', created_at: '2026-09-21T00:00:00Z', reviewer_id: null, review_notes: null, reviewed_at: null, published_at: null, review_checks: {}, offering_package: { id: key, package_number: 1, origin: 'SUBMITTED', terms_hash: 'a'.repeat(64), document_hashes: { memorandum: 'b'.repeat(64), risks: 'c'.repeat(64), subscription_terms: 'd'.repeat(64) }, submitted_at: '2026-09-21T00:00:00Z', issuer_status: 'APPROVED', compliance_status: 'APPROVED', technical_readiness_status: 'VERIFIED', publishable: false, subscribable: true, can_review_issuer: false } }

describe('customer portal contracts', () => {
  it('separates a guarded monitoring restriction from admission and rejects malformed scoped reads', () => {
    const item = { application_id: id, application_revision: 3, state: 'ON_HOLD', case_revision: 1, admission_expires_at: '2026-10-01T00:00:00+00:00', renewal_due: false, new_actions_allowed: false }
    expect(customerMonitoringSnapshotSchema.safeParse([item]).success).toBe(true)
    expect(customerMonitoringSnapshotSchema.safeParse([{ ...item, admission_expires_at: null, renewal_due: null }]).success).toBe(true)
    expect(customerMonitoringSnapshotSchema.safeParse([]).success).toBe(true)
    for (const malformed of [[item, item], [{ ...item, state: 'APPROVED' }], [{ ...item, case_revision: -1 }], [{ ...item, new_actions_allowed: 'yes' }], [{ ...item, reviewer_role: 'ComplianceOfficer' }]]) {
      expect(customerMonitoringSnapshotSchema.safeParse(malformed).success).toBe(false)
    }
  })
  it('binds monitoring decisions to one saved case revision and cited evidence, without accepting client authority', () => {
    const checks = { identity: true, ownership: true, screening: true, suitability: true }
    const payload = { application_id: id, expected_revision: 1, state: 'CURRENT', evidence_reference: 'SYNTHETIC-REVIEW-2026-09-24-001', reason: 'All four synthetic review checks are current against the saved case.', checks }
    expect(portalCommandSchema.safeParse({ command: 'set_customer_monitoring', key, payload }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'set_customer_monitoring', key, payload: { ...payload, expected_revision: 0, state: 'ON_HOLD', checks: { ...checks, screening: false } } }).success).toBe(true)
    for (const change of [{ expected_revision: -1 }, { evidence_reference: 'short' }, { reason: 'short' }, { reviewer_id: id }, { checks: { ...checks, screening: false } }, { checks: { ...checks, provider_approved: true } }]) {
      expect(portalCommandSchema.safeParse({ command: 'set_customer_monitoring', key, payload: { ...payload, ...change } }).success).toBe(false)
    }
  })
  const evidence = { id, kind: 'IDENTITY', title: 'Synthetic identity', storage_path: `${id}/${key}`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }
  it('keeps historical document paths off browser metadata and requires exact lookup facts', () => {
    const historical = { id, kind: 'IDENTITY', title: 'Earlier synthetic evidence', claimed_sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }
    const versions = { application_id: id, versions: [{ revision: 2, submitted_at: '2026-09-22T09:00:00Z', capture_kind: 'SUBMISSION', documents: [historical] }] }
    expect(applicationDocumentVersionsSchema.safeParse(versions).success).toBe(true)
    expect(applicationDocumentVersionsSchema.safeParse({ ...versions, versions: [{ ...versions.versions[0], documents: [{ ...historical, storage_path: `${id}/${key}` }] }] }).success).toBe(false)
    expect(applicationDocumentLookupSchema.safeParse({ ...historical, application_id: id, revision: 2, storage_path: `${id}/${key}` }).success).toBe(true)
    expect(applicationDocumentLookupSchema.safeParse({ ...historical, application_id: id, revision: 0, storage_path: `${id}/${key}` }).success).toBe(false)
  })
  const wm = { details_version: 2, full_name: 'Synthetic Representative', country: 'ZA', company_name: 'Synthetic Manager', registration_reference: 'TEST-001', beneficial_owners: 'Fictional owner of the whole organisation.', business_activities: 'Fictional fund management for synthetic testing.', representative_position: 'Director', authority_basis: 'Fictional board authorisation to submit this application.', documents: [evidence], test_data_acknowledged: true }
  it('accepts WM organisation facts without manufacturing investor facts', () => {
    expect(applicationDetailsSchema.parse(wm)).toEqual(wm)
    expect(isWealthManagerDetailsV2(wm)).toBe(true)
    for (const extra of [{ investor_type: 'ENTITY' }, { source_of_funds: 'Old investment capital source facts.' }, { experience: 'Old investment objectives.' }, { details_version: 3 }, { approved: true }]) expect(applicationDetailsSchema.safeParse({ ...wm, ...extra }).success).toBe(false)
    for (const field of ['business_activities', 'representative_position', 'authority_basis']) expect(applicationDetailsSchema.safeParse({ ...wm, [field]: '' }).success).toBe(false)
  })
  it('requires versioned ownership/control parties and linked evidence for new legal-entity disclosures', () => {
    const boEvidence = { ...evidence, id: key, kind: 'BENEFICIAL_OWNERS', title: 'Synthetic ownership register' }
    const relationship = { id, party_type: 'PERSON', legal_name: 'Synthetic Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 7500, control_basis: 'Fictional direct shareholding in the customer organisation.', effective_on: '2026-09-01', change_reason: 'Initial fictional disclosure for independent review.', evidence_document_id: key }
    const managerV3 = { ...wm, details_version: 3, documents: [evidence, boEvidence], ownership_control: [relationship], ownership_change_reason: 'Initial fictional ownership disclosure.' }
    expect(applicationDetailsSchema.safeParse(managerV3).success).toBe(true)
    expect(isWealthManagerDetailsV2(managerV3)).toBe(true)
    const investorV3 = { ...managerV3, investor_type: 'ENTITY', source_of_funds: 'Fictional company capital from retained earnings.', experience: 'Fictional long-term property investment strategy.' }
    delete (investorV3 as Partial<typeof investorV3>).business_activities
    delete (investorV3 as Partial<typeof investorV3>).representative_position
    delete (investorV3 as Partial<typeof investorV3>).authority_basis
    expect(applicationDetailsSchema.safeParse(investorV3).success).toBe(true)
    expect(isWealthManagerDetailsV2(investorV3)).toBe(false)
    for (const malformed of [
      { ownership_control: [] },
      { ownership_control: [{ ...relationship, evidence_document_id: id }] },
      { ownership_control: [{ ...relationship, ownership_basis_points: 10001 }] },
      { ownership_control: [{ ...relationship, relationship: 'DIRECT_OWNER', ownership_basis_points: 0 }] },
      { ownership_control: [{ ...relationship, party_type: 'ENTITY', registration_reference: '' }] },
      { ownership_control: [relationship, relationship] },
      { ownership_control: [{ ...relationship, ownership_basis_points: 6000 }, { ...relationship, id: key, ownership_basis_points: 6000 }] },
      { ownership_change_reason: 'short' },
      { role: 'SuperAdmin' },
    ]) expect(applicationDetailsSchema.safeParse({ ...managerV3, ...malformed }).success).toBe(false)
    expect(applicationDetailsSchema.safeParse({ ...managerV3, investor_type: 'ENTITY' }).success).toBe(false)
    expect(applicationDetailsSchema.safeParse({ ...investorV3, investor_type: 'INDIVIDUAL' }).success).toBe(false)
  })
  it('keeps legacy evidence meanings and partial drafts without converting their fields', () => {
    const old = { full_name: 'Historical Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: 'Original investment capital source.', beneficial_owners: '', experience: 'Original investment objectives.', documents: [evidence], test_data_acknowledged: true }
    expect(applicationDetailsSchema.parse(old)).toEqual(old)
    expect(isWealthManagerDetailsV2(old)).toBe(false)
    expect(applicationDraftDetailsSchema.parse({})).toEqual({})
    expect(applicationDraftDetailsSchema.parse({ details_version: 2, business_activities: wm.business_activities })).toEqual({ details_version: 2, business_activities: wm.business_activities })
    expect(applicationDetailsSchema.safeParse({ ...old, authority_basis: wm.authority_basis }).success).toBe(false)
  })
  it('accepts complete typed fund terms', () => expect(productTermsSchema.safeParse(terms).success).toBe(true))
  it('requires real-estate-specific terms', () => {
    expect(productTermsSchema.safeParse({ ...terms, asset_type: 'REAL_ESTATE' }).success).toBe(false)
    expect(productTermsSchema.safeParse({ ...terms, asset_type: 'REAL_ESTATE', property_address: 'Fictional Street 10, Test City', property_valuation_minor: '500000000', rental_income_policy: 'Fictional net rent after disclosed operating costs.' }).success).toBe(true)
  })
  it.each(['0', '-1', '1.1', '1e3', '+1', '01', ' 1', '999999999999999999999'])('rejects noncanonical financial quantity %s', unit_price_minor => expect(productTermsSchema.safeParse({ ...terms, unit_price_minor }).success).toBe(false))
  it('rejects live currency and arbitrary metadata', () => {
    expect(productTermsSchema.safeParse({ ...terms, currency: 'ZAR' }).success).toBe(false)
    expect(productTermsSchema.safeParse({ ...terms, metadata: { approved: true } }).success).toBe(false)
  })
  it('requires minimum to fit total offering capacity', () => expect(productTermsSchema.safeParse({ ...terms, minimum_units: '100001' }).success).toBe(false))
  it.each(['minimum_units', 'cap_units', 'property_valuation_minor'])('returns validation errors instead of throwing for malformed %s', field => {
    expect(productTermsSchema.safeParse({ ...terms, asset_type: 'REAL_ESTATE', [field]: '1.5' }).success).toBe(false)
    expect(productTermsSchema.safeParse({ ...terms, [field]: 'garbage' }).success).toBe(false)
  })
  it('quotes with exact integers above JS safe range', () => expect(subscriptionQuote(product, '10')).toEqual({ amount_minor: '123456789012345678900' }))
  it.each(['0', '1.5', '-10', '1e2', '01'])('rejects malformed subscription quantity %s', units => expect(subscriptionQuote(product, units)).toHaveProperty('error'))
  it('enforces state, minimum and outstanding reservation capacity', () => {
    expect(subscriptionQuote({ ...product, status: 'APPROVED' }, '10')).toHaveProperty('error')
    expect(subscriptionQuote(product, '9')).toHaveProperty('error')
    expect(subscriptionQuote(product, '99981')).toHaveProperty('error')
    expect(subscriptionQuote(product, '99980')).toHaveProperty('amount_minor')
  })
  it('never treats historical status or an unverified package as subscription readiness', () => {
    expect(subscriptionQuote({ ...product, offering_package: null }, '10')).toHaveProperty('error')
    expect(subscriptionQuote({ ...product, offering_package: { ...product.offering_package!, technical_readiness_status: 'NOT_VERIFIED', subscribable: false } }, '10')).toHaveProperty('error')
    expect(subscriptionQuote({ ...product, offering_package: { ...product.offering_package!, terms_hash: 'f'.repeat(64) } }, '10')).toHaveProperty('error')
  })
  it('binds subscription commands to approved version/hash and explicit acceptance', () => {
    const payload = { product_id: id, offering_revision_id: key, expected_revision: 4, terms_hash: 'a'.repeat(64), units: '10', accepted_documents: true, accepted_risks: true }
    expect(portalCommandSchema.safeParse({ command: 'subscribe', key, payload }).success).toBe(true)
    for (const change of [{ offering_revision_id: '' }, { expected_revision: 0 }, { terms_hash: '' }, { accepted_documents: false }, { accepted_risks: false }, { investor_id: id }]) expect(portalCommandSchema.safeParse({ command: 'subscribe', key, payload: { ...payload, ...change } }).success).toBe(false)
  })
  it('requires exact immutable package identity for distinct issuer and Compliance decisions', () => {
    const common = { product_id: id, offering_revision_id: key, expected_revision: 4, terms_hash: 'a'.repeat(64), decision: 'APPROVED', notes: 'Synthetic issuer authority and investor rights have been separately reviewed.' }
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...common, checks: { issuer: true, terms: true, disclosures: true, eligibility: true } } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'review_offering_issuer', key, payload: { ...common, checks: { issuer_authority: true, terms: true, rights: true } } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'review_offering_issuer', key, payload: { ...common, offering_revision_id: '', checks: { issuer_authority: true, terms: true, rights: true } } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'review_product', key, payload: { ...common, terms_hash: '', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } } }).success).toBe(false)
  })
  it('bounds product eligibility requests to one account, product and case revision', () => {
    const payload = { product_id: id, investment_account_id: key, expected_revision: 0, investor_statement: 'Synthetic investor objectives and product fit for this offering.' }
    expect(portalCommandSchema.safeParse({ command: 'request_product_eligibility', key, payload }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'request_product_eligibility', key, payload: { ...payload, expected_revision: 3 } }).success).toBe(true)
    for (const change of [{ expected_revision: -1 }, { investor_statement: 'Too short' }, { investment_account_id: 'another investor' }, { effective: true }]) {
      expect(portalCommandSchema.safeParse({ command: 'request_product_eligibility', key, payload: { ...payload, ...change } }).success).toBe(false)
    }
  })
  it('requires a reason and exact manual checks for an independent product eligibility decision', () => {
    const payload = { eligibility_case_id: id, expected_revision: 2, decision: 'APPROVED', notes: 'Synthetic evidence and offering restrictions independently reviewed.', checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true } }
    expect(portalCommandSchema.safeParse({ command: 'review_product_eligibility', key, payload }).success).toBe(true)
    for (const change of [{ expected_revision: 0 }, { notes: 'Too short' }, { reviewer_id: id }, { checks: { ...payload.checks, screening: true } }]) {
      expect(portalCommandSchema.safeParse({ command: 'review_product_eligibility', key, payload: { ...payload, ...change } }).success).toBe(false)
    }
  })
  it('requires the exact case revision and a recorded reason for eligibility revocation', () => {
    const payload = { eligibility_case_id: id, expected_revision: 3, reason: 'Synthetic independent reviewer found the account is no longer eligible.' }
    expect(portalCommandSchema.safeParse({ command: 'revoke_product_eligibility', key, payload }).success).toBe(true)
    for (const change of [{ expected_revision: 0 }, { reason: 'Too short' }, { product_id: id }, { status: 'REVOKED' }]) {
      expect(portalCommandSchema.safeParse({ command: 'revoke_product_eligibility', key, payload: { ...payload, ...change } }).success).toBe(false)
    }
  })
  it('keeps appointment review, role application and protective revocation as separate guarded commands', () => {
    const review = { mandate_id: id, expected_revision: 1, decision: 'APPROVED', notes: 'Fictional appointment, customer source and scope independently reviewed.', checks: { appointment: true, evidence: true, scope: true } }
    expect(portalCommandSchema.safeParse({ command: 'review_representative_mandate', key, payload: review }).success).toBe(true)
    for (const change of [{ expected_revision: 0 }, { notes: 'too short' }, { role: 'SuperAdmin' }, { checks: { ...review.checks, ownership: true } }]) {
      expect(portalCommandSchema.safeParse({ command: 'review_representative_mandate', key, payload: { ...review, ...change } }).success).toBe(false)
    }
    expect(portalCommandSchema.safeParse({ command: 'apply_representative_mandate', key, payload: { mandate_id: id, expected_revision: 2 } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'apply_representative_mandate', key, payload: { mandate_id: id, expected_revision: 2, role: 'SuperAdmin' } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'revoke_representative_mandate', key, payload: { mandate_id: id, expected_revision: 3, reason: 'Fictional appointment revoked for controlled authority testing.' } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'revoke_representative_mandate', key, payload: { mandate_id: id, expected_revision: 3, reason: 'short' } }).success).toBe(false)
  })
  it('keeps entity account creation and limited investing representation as distinct guarded commands', () => {
    expect(portalCommandSchema.safeParse({ command: 'create_entity_investment_account', key, payload: { application_id: id } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'create_entity_investment_account', key, payload: { application_id: id, holder_user_id: id } }).success).toBe(false)
    const request = { investment_account_id: id, expected_revision: 0, evidence_reference: 'Fictional board appointment recorded in submitted COMPANY evidence.', appointment_document_id: key, requested_until: '2026-10-01T12:00:00Z' }
    expect(portalCommandSchema.safeParse({ command: 'request_investing_representative_mandate', key, payload: request }).success).toBe(true)
    for (const change of [{ expected_revision: -1 }, { appointment_document_id: 'not-an-id' }, { requested_until: '2026-10-01' }, { evidence_reference: 'too short' }, { transaction_limit_minor: '1' }]) {
      expect(portalCommandSchema.safeParse({ command: 'request_investing_representative_mandate', key, payload: { ...request, ...change } }).success).toBe(false)
    }
    const review = { mandate_id: id, expected_revision: 1, decision: 'APPROVED', notes: 'Fictional entity appointment and legal holder independently reviewed.', checks: { appointment: true, legal_entity: true, scope: true } }
    expect(portalCommandSchema.safeParse({ command: 'review_investing_representative_mandate', key, payload: review }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'review_investing_representative_mandate', key, payload: { ...review, reviewer_user_id: id } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'review_investing_representative_mandate', key, payload: { ...review, checks: { ...review.checks, cash: true } } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'apply_investing_representative_mandate', key, payload: { mandate_id: id, expected_revision: 2 } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'apply_investing_representative_mandate', key, payload: { mandate_id: id, expected_revision: 2, role: 'Investor' } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'revoke_investing_representative_mandate', key, payload: { mandate_id: id, expected_revision: 3, reason: 'Fictional company appointment is no longer valid for account viewing.' } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'revoke_investing_representative_mandate', key, payload: { mandate_id: id, expected_revision: 3, reason: 'short' } }).success).toBe(false)
  })
  it('never accepts financial completion or reviewer identity from the browser', () => {
    expect(portalCommandSchema.safeParse({ command: 'settle', key, payload: { subscription_id: id, paid: true } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'review_application', key, payload: { application_id: id, expected_revision: 1, decision: 'APPROVED', notes: 'Synthetic documents independently reviewed.', checks: { identity: true, ownership: true, screening: true, suitability: true }, reviewer_id: id } }).success).toBe(false)
  })
  it('formats minor units without number coercion', () => {
    expect(formatTestMoney('1')).toBe('0.01 ZAR_TEST')
    expect(formatTestMoney('123456789012345678901')).toContain('.01 ZAR_TEST')
    expect(formatTestMoney('NaN')).toBe('Unavailable')
  })
  it('bounds and types private document manifests', () => {
    const document = { id, kind: 'IDENTITY', title: 'Synthetic identity', storage_path: `${id}/${key}`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }
    expect(evidenceSchema.safeParse(document).success).toBe(true)
    for (const change of [{ size: 4194305 }, { mime_type: 'text/html' }, { sha256: 'forged' }, { public_url: 'https://example.test' }]) expect(evidenceSchema.safeParse({ ...document, ...change }).success).toBe(false)
  })
})
describe('portal route boundaries', () => {
  it.each(PORTAL_PATHS)('explicitly admits %s only in native mode', path => {
    expect(isSupabaseWebPathAllowed(path)).toBe(true)
    expect(isSupabaseWebPathAllowed(`${path}/extra`)).toBe(false)
    expect(isProductionWebPathBlocked(path, 'production', '', '', 'supabase', 'supabase')).toBe(false)
    expect(isProductionWebPathBlocked(path, 'production', '', '', '', '')).toBe(true)
  })
  it.each(['/Portal', '/portal/unknown', '/portal%2fproducts', '/portal//products', '/portal/products/'])('denies route alias %s', path => expect(isProductionWebPathBlocked(path, 'production', '', '', 'supabase', 'supabase')).toBe(true))
})
