import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalApplication, PortalProduct, PortalProductEligibility, PortalSnapshot } from './contracts'
import { validatedFundRoleplayEligibility } from './fund-roleplay-eligibility'
import { ProductEligibilityReview } from '@/components/portal/portal-workflows'
import { fictionalProductTerms } from '@/components/portal/product-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

// Synthetic unit/source fixtures only; no customer/provider/account/chain proof.
const actor = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const offeringId = '33333333-3333-4333-8333-333333333333'
const caseId = '44444444-4444-4444-8444-444444444444'
const organisation = '55555555-5555-4555-8555-555555555555'
const applicationId = '66666666-6666-4666-8666-666666666666'
const accountId = '77777777-7777-4777-8777-777777777777'
const policyId = '88888888-8888-4888-8888-888888888888'
const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'ComplianceOfficer' as const }
const now = Date.UTC(2026, 9, 15, 12)
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_roleplay_eligibility.sql'), 'utf8')
const recipes = JSON.parse(sql.match(/\$recipes\$([\s\S]*?)\$recipes\$::jsonb/)![1]) as {
  signature: string; hash: string; changes: { from: string; to: string; count: number }[];
}[]

function application(): PortalApplication {
  return { id: applicationId, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 3,
    details: { full_name: 'Synthetic admitted investor', country: 'ZA', investor_type: 'INDIVIDUAL',
      company_name: '', registration_reference: '', source_of_funds: 'Synthetic source-of-funds evidence.',
      beneficial_owners: '', experience: 'Synthetic investment experience.', documents: [], test_data_acknowledged: true },
    approved_until: '2026-11-15T12:00:00Z', submitted_at: '2026-10-15T10:00:00Z', reviewed_at: '2026-10-15T11:00:00Z',
    reviewer_id: actor, review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW' }
}
function provenance() {
  return { version: 1, environment: 'TESTNET', assurance: 'TEST_ROLE_PLAY', independence_proven: false,
    actor_id: actor, operating_context: context, operator_user_id: actor, policy_id: policyId, authority_epoch: 1,
    product_id: productId, offering_revision_id: offeringId, case_id: caseId, case_revision: 1,
    expires_at: '2026-10-21T12:00:00Z', binding_current: true, review_allowed: true, revoke_allowed: true,
    label: 'TEST role-play: one operator, not independent human approval' }
}
function eligibility(): PortalProductEligibility {
  return { id: caseId, investment_account_id: accountId, holder_user_id: actor, product_id: productId,
    organisation_id: organisation, product_revision: 4, offering_revision_id: offeringId, terms_hash: 'a'.repeat(64),
    application_revision: 3, revision: 1, status: 'SUBMITTED', investor_statement: 'Synthetic product fit and source-of-funds statement.',
    submitted_at: '2026-10-15T11:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null,
    review_checks: {}, approved_until: null, effective: false, can_decide: true, can_approve: true,
    can_revoke: false, account_kind: 'INDIVIDUAL', investor_application: application(), roleplay: provenance() }
}
function product(): PortalProduct {
  return { id: productId, organisation_id: organisation, created_by: actor, revision: 4, status: 'PUBLISHED',
    terms: fictionalProductTerms(), terms_hash: 'a'.repeat(64), reserved_units: '0', created_at: '2026-10-15T09:00:00Z',
    reviewer_id: actor, reviewed_at: '2026-10-15T10:00:00Z', review_notes: null, review_checks: {},
    published_at: '2026-10-15T11:00:00Z', offering_package: { id: offeringId, package_number: 1, origin: 'SUBMITTED',
      terms_hash: 'a'.repeat(64), document_hashes: { memorandum: 'b'.repeat(64), risks: 'c'.repeat(64), subscription_terms: 'd'.repeat(64) },
      submitted_at: '2026-10-15T09:00:00Z', issuer_status: 'APPROVED', compliance_status: 'APPROVED',
      technical_readiness_status: 'VERIFIED', subscribable: true } }
}
function snapshot(): PortalSnapshot {
  return { actor: { id: actor, email: 'synthetic@example.invalid', display_name: null, can_review: true },
    operating_context: context, applications: [], organisations: [], products: [product()], subscriptions: [], events: [],
    fund_lifecycle: { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET',
      operating_context: context, observed_at: '2026-10-15T12:00:00Z', availability: 'UNAVAILABLE',
      reason_code: 'SYNTHETIC_UNIT_TEST_ONLY', products: [] } }
}
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(now))
afterEach(() => vi.restoreAllMocks())

describe('saved product-specific TEST eligibility provenance', () => {
  it('requires actor, capacity, environment and exact case/product/offering bindings', () => {
    expect(validatedFundRoleplayEligibility(eligibility(), snapshot())?.review_allowed).toBe(true)
    for (const change of [{ actor_id: productId }, { operator_user_id: productId }, { product_id: caseId },
      { offering_revision_id: caseId }, { case_id: productId }, { case_revision: 2 }, { environment: 'MAINNET' },
      { independence_proven: true }, { operating_context: { ...context, role: 'SuperAdmin' } }]) {
      expect(validatedFundRoleplayEligibility({ ...eligibility(), roleplay: { ...provenance(), ...change } }, snapshot())).toBeNull()
    }
    const main = snapshot(); main.fund_lifecycle = { ...main.fund_lifecycle!, environment: 'MAINNET' }
    expect(validatedFundRoleplayEligibility(eligibility(), main)).toBeNull()
    expect(validatedFundRoleplayEligibility({ ...eligibility(), roleplay: undefined }, snapshot())).toBeNull()
  })
  it('retains honest historical labels while revocation and expiry disable actions', () => {
    for (const change of [{ binding_current: false }, { expires_at: '2026-10-15T12:00:00Z' }]) {
      const value = validatedFundRoleplayEligibility({ ...eligibility(), roleplay: { ...provenance(), ...change } }, snapshot())
      expect(value?.assurance).toBe('TEST_ROLE_PLAY')
      expect(value?.review_allowed).toBe(false); expect(value?.revoke_allowed).toBe(false)
    }
  })
  it('allows only the server-authorised same-operator review while retaining native customer evidence gates', () => {
    const render = (value = eligibility()) => renderToStaticMarkup(<ProductEligibilityReview eligibility={value} product={product()} snapshot={snapshot()} onSaved={vi.fn()} />)
    const accepted = render()
    expect(accepted).toContain('TEST role-play: same operator')
    expect(accepted).toContain('Independent human review is not proved')
    expect(accepted).toContain('Record eligibility decision</button>')
    expect(accepted).not.toContain('You cannot review your own product eligibility case.')
    for (const roleplay of [undefined, { ...provenance(), binding_current: false }, { ...provenance(), review_allowed: false },
      { ...provenance(), expires_at: '2020-01-01T00:00:00Z' }]) {
      expect(render({ ...eligibility(), roleplay })).not.toContain('Record eligibility decision</button>')
    }
    const draft = eligibility(); draft.investor_application = { ...draft.investor_application!, status: 'DRAFT' }
    expect(render(draft)).toContain('value="APPROVED" disabled=""')
    expect(render(draft)).toContain('Approval unavailable for this case')
  })
  it('pins four canonical bodies and leaves account/customer/MFA/provider writers untouched', () => {
    expect(recipes).toHaveLength(4)
    expect(new Set(recipes.map(item => item.signature)).size).toBe(4)
    for (const recipe of recipes) expect(recipe.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sql).toContain("after_row-'prosrc' is distinct from before_row-'prosrc'")
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres'")
    expect(sql).toContain('fund_roleplay_eligibility_no_legacy_backfill')
    expect(sql).toContain('fund_roleplay_eligibility_current_lane_required')
    expect(sql).toContain("a.persona='INVESTOR' and a.status='APPROVED'")
    expect(sql).toContain('bx1_portal.monitoring_new_action_allowed(a.id)')
    expect(sql).toContain('bx1_portal.offering_operational(p.id)')
    expect(sql).toContain('e.product_revision=p.revision')
    expect(sql).toContain('e.offering_revision_id=p.current_offering_revision_id')
    expect(sql).toContain('e.approved_until<=rp.valid_until')
    expect(sql).toContain('rp.version=(select max(later.version)')
    expect(sql).toContain('test_offering_source_current(o.id,preparation.id,preparation.revision)')
    expect(sql).not.toMatch(/(?:insert into|update)\s+(?:auth\.|bx1_portal\.(?:applications|investment_accounts)|bx1_private\.(?:roleplay_policies|provider_evidence_events))/i)
    expect(sql).not.toMatch(/grant\s+execute/i)
  })
})
