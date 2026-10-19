import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { portalCommandSchema } from './contracts'
import { fundPaymentAllocationBasisSchema, fundStageKeys, validatedFundLifecycle, type FundProductLifecycle } from './fund-lifecycle-contracts'

// Pure contract/source regressions. These are not hosted SQL, role/MFA,
// independent-person, payment or chain acceptance evidence.
const actor = '11111111-1111-4111-8111-111111111111'
const product = '22222222-2222-4222-8222-222222222222'
const subscription = '33333333-3333-4333-8333-333333333333'
const account = '44444444-4444-4444-8444-444444444444'
const basisId = '55555555-5555-4555-8555-555555555555'
const key = '66666666-6666-4666-8666-666666666666'
const digest = 'ab'.repeat(32)
const context = { mode: 'APPLICANT' as const }
const basis = { id: basisId, revision: 2, basis_hash: digest, status: 'APPROVED' as const, current: true,
  approved_at: '2026-10-14T12:00:00Z', approved_until: '2099-01-01T00:00:00Z', units_base: '100', amount_base_units: '1000000000' }
function lifecycle(change: Partial<FundProductLifecycle['orders'][number]> = {}) {
  return { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET', operating_context: context,
    observed_at: '2026-10-14T12:01:00Z', availability: 'AVAILABLE', reason_code: null,
    products: [{ product_id: product, organisation_id: product, native_organisation_id: product, product_revision: 4,
      offering_revision_id: product, class_id: product, product_name: 'Fictional fund', terms_hash: digest, configuration_hash: digest,
      availability: 'AVAILABLE', stages: fundStageKeys.map(name => ({ key: name, state: 'CURRENT', label: name,
        description: 'Synthetic source fixture', owner_role: 'IssuerFundManager', reason_code: null, evidence_ids: [] })),
      next_action: null, actions: [], operations: [], holdings: [], orders: [{ subscription_id: subscription, product_id: product,
        investment_account_id: account, allocation_id: null, allocation_revision: null, units_base: '100', security_unit_decimals: 0,
        delivery_wallet: null, funding: null, payment_allocation_basis: basis, issuance_operation_id: null, actions: [], ...change }] }] }
}

describe('issuer-approved pre-payment allocation contract', () => {
  it('admits only exact reference/version commands, not client-set approval or amounts', () => {
    expect(portalCommandSchema.safeParse({ command: 'request_fund_payment_allocation_basis', key,
      payload: { subscription_id: subscription, expected_basis_hash: digest } }).success).toBe(true)
    expect(portalCommandSchema.safeParse({ command: 'approve_fund_payment_allocation_basis', key,
      payload: { basis_id: basisId, expected_revision: 1 } }).success).toBe(true)
    for (const extra of [{ approved: true }, { amount_base_units: '1' }, { issuer_user_id: actor }, { units_base: '200' }]) {
      expect(portalCommandSchema.safeParse({ command: 'approve_fund_payment_allocation_basis', key,
        payload: { basis_id: basisId, expected_revision: 1, ...extra } }).success).toBe(false)
    }
    expect(portalCommandSchema.safeParse({ command: 'request_fund_payment_allocation_basis', key,
      payload: { subscription_id: subscription, expected_basis_hash: 'not-a-hash' } }).success).toBe(false)
    expect(portalCommandSchema.safeParse({ command: 'approve_fund_payment_allocation_basis', key,
      payload: { basis_id: basisId, expected_revision: 0 } }).success).toBe(false)
  })
  it('requires saved issuer evidence for a current approval', () => {
    expect(fundPaymentAllocationBasisSchema.safeParse(basis).success).toBe(true)
    for (const change of [{ id: null }, { revision: null }, { approved_at: null }, { approved_until: null }, { status: 'REQUESTED' }]) {
      expect(fundPaymentAllocationBasisSchema.safeParse({ ...basis, ...change }).success).toBe(false)
    }
    expect(fundPaymentAllocationBasisSchema.safeParse({ ...basis, current: false, status: 'NO_LONGER_CURRENT' }).success).toBe(true)
    expect(fundPaymentAllocationBasisSchema.safeParse({ ...basis, units_base: '100.0000000000000000' }).success).toBe(false)
    expect(fundPaymentAllocationBasisSchema.safeParse({ ...basis, amount_base_units: '1000000000.0' }).success).toBe(false)
  })
  it('rejects a cross-record quantity or consideration mismatch while preserving legacy absent-field reads', () => {
    expect(validatedFundLifecycle(lifecycle(), actor, context, 'TESTNET')).not.toBeNull()
    expect(validatedFundLifecycle(lifecycle({ payment_allocation_basis: { ...basis, units_base: '101' } }), actor, context, 'TESTNET')).toBeNull()
    const funding = { obligation_id: account, obligation_revision: 1, route_id: account, route_revision: 1,
      currency: 'TST' as const, settlement_decimals: 6 as const, chain_id: 80002 as const,
      settlement_token_address: `0x${'11'.repeat(20)}`, beneficiary_address: `0x${'22'.repeat(20)}`,
      required_base_units: '1000000000', verified_base_units: '0', posted_base_units: '0', evidence_set_hash: digest,
      state: 'AWAITING_FUNDING' as const, can_pay: true }
    expect(validatedFundLifecycle(lifecycle({ funding }), actor, context, 'TESTNET')).not.toBeNull()
    expect(validatedFundLifecycle(lifecycle({ funding, payment_allocation_basis: { ...basis, amount_base_units: '1' } }), actor, context, 'TESTNET')).toBeNull()
    expect(validatedFundLifecycle(lifecycle({ funding, payment_allocation_basis: { ...basis, current: false } }), actor, context, 'TESTNET')).toBeNull()
    expect(validatedFundLifecycle(lifecycle({ payment_allocation_basis: undefined }), actor, context, 'TESTNET')).not.toBeNull()
    expect(validatedFundLifecycle(lifecycle(), actor, context, 'MAINNET')).toBeNull()
  })
})

describe('additive SQL ordering overlay source boundaries', () => {
  const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_payment_allocation_basis.sql'), 'utf8')
  const base = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_lifecycle.sql'), 'utf8')
  it('pins the five unchanged canonical definitions without trimming prosrc', () => {
    for (const [name, pin] of Object.entries({ fund_command: '033a4aceeddb51d3427deeb4ecf1c7f86913dbe0282744e414681dcbfc51dd9e',
      fund_order_projection: '67d98df70e665222630404b850280ae7fb4515cfd867d6085a147f8ebbba1b8e',
      fund_prepare_payment: 'e2cc0959b5b9347fdd27d9e5e151f352697caa776bdd84a38e09982324fd6d70',
      fund_submit_payment: '237196cc9a66d1cdcf1511bc0e5ed53df24762d113fe2456b0455007e83f8982',
      fund_allocation_current: '2edeb187a3c4ea277f2c68ea9f0f15b0c1420354da082cdfff9fcc96cef66ecb' })) {
      const matched = base.match(new RegExp(`create function bx1_portal\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))
      expect(matched?.[1]).toBeDefined()
      expect(createHash('sha256').update(matched![1].replaceAll('\r\n', '\n')).digest('hex')).toBe(pin)
      expect(feature).toContain(pin)
    }
  })
  it('guards instruction opening, payment preparation/claim and final allocation without seeding authority', () => {
    expect(feature).toContain('fund_issuer_allocation_basis_required_before_instruction')
    expect(feature).toContain('fund_issuer_allocation_basis_required_before_payment')
    expect(feature).toContain('fund_issuer_allocation_basis_changed_before_submission')
    expect(feature).toContain('fund_payment_basis_final_allocation_cutpoint_drift')
    expect(feature).toContain('fund_payment_basis_authority_expired_at_commit')
    expect(feature).toContain('fund_payment_basis_idempotency_conflict')
    expect(feature).toContain("environment='TESTNET'")
    expect(feature).toContain('enable row level security')
    expect(feature).toContain('revoke all on table bx1_portal.fund_payment_allocation_bases')
    expect(feature).not.toMatch(/insert into (?:auth\.|public\.bx1_memberships|bx1_portal\.fund_(?:authorities|release_manifests|signer_policies|holdings|register_entries))/i)
    expect(feature).not.toMatch(/grant\s+(?:all|execute|select|update|insert)/i)
  })
  it('limits the funding-instruction cutover to FUND/TST and preserves the real-estate writer branch', () => {
    const canonicalOnly = String.raw`if s.accepted_terms->>\'asset_type\'=\'FUND\' and s.accepted_terms->>\'currency\'=\'TST\' and bx1_portal.fund_payment_basis_current(s.id) is not true then`
    expect(feature).toContain(canonicalOnly)
    expect(feature).not.toContain(String.raw`if s.accepted_terms->>\'currency\'=\'TST\' and bx1_portal.fund_payment_basis_current(s.id) is not true then`)
    // The overlay adds an exact conditional gate, not a replacement property
    // writer or an assertion that REAL_ESTATE is admitted for chain execution.
    expect(feature).not.toContain("asset_type'='REAL_ESTATE'")
  })
  it('normalises proposed and approved integer-base-unit text at the SQL boundary', () => {
    expect(feature).toContain("and m.status='ADMITTED'))::numeric(78,0)::text")
    expect(feature).toContain("'amount_base_units',coalesce(basis.amount_base_units,s.amount_minor)::numeric(78,0)::text")
  })
})
