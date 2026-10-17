import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { fundStageKeys, type FundProductLifecycle } from '@/lib/portal/fund-lifecycle-contracts'
import { FundLifecycleOrder } from './fund-lifecycle'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// Rendering only: these hooks model the already selected actor/capacity. The
// guarded SQL proof, not this component fixture, establishes authority.
vi.mock('./portal-client', () => ({
  usePortalActorId: () => '11111111-1111-4111-8111-111111111111',
  usePortalOperatingContext: () => ({ mode: 'ROLE', organisationId: '22222222-2222-4222-8222-222222222222', role: 'IssuerFundManager' }),
  usePortalCommand: () => ({ busy: false, unknown: false, message: '', submit: vi.fn(), retry: vi.fn() }),
}))
const actor = '11111111-1111-4111-8111-111111111111'
const product = '22222222-2222-4222-8222-222222222222'
const subscription = '33333333-3333-4333-8333-333333333333'
const basisId = '44444444-4444-4444-8444-444444444444'
const digest = 'ab'.repeat(32)
const context = { mode: 'ROLE' as const, organisationId: product, role: 'IssuerFundManager' as const }
function productRecord(approved = false): FundProductLifecycle {
  return { product_id: product, organisation_id: product, native_organisation_id: product, product_revision: 4,
    offering_revision_id: product, class_id: product, product_name: 'Fictional fund', terms_hash: digest, configuration_hash: digest,
    availability: 'AVAILABLE', stages: fundStageKeys.map(key => ({ key, state: 'CURRENT', label: key,
      description: 'Synthetic rendering fixture', owner_role: 'IssuerFundManager', reason_code: null, evidence_ids: [] })),
    next_action: null, actions: [], operations: [], holdings: [], orders: [{ subscription_id: subscription, product_id: product,
      investment_account_id: product, allocation_id: null, allocation_revision: null, units_base: '100', security_unit_decimals: 0,
      delivery_wallet: null, issuance_operation_id: null,
      payment_allocation_basis: { id: basisId, revision: approved ? 2 : 1, basis_hash: digest, status: approved ? 'APPROVED' : 'REQUESTED',
        current: approved, approved_at: approved ? '2026-10-14T12:00:00Z' : null, approved_until: approved ? '2099-01-01T00:00:00Z' : null,
        units_base: '100', amount_base_units: '1000000000' },
      funding: { obligation_id: product, obligation_revision: 1, route_id: product, route_revision: 1,
        currency: 'TST', settlement_decimals: 6, chain_id: 80002, settlement_token_address: `0x${'11'.repeat(20)}`,
        beneficiary_address: `0x${'22'.repeat(20)}`, required_base_units: '1000000000', verified_base_units: '0', posted_base_units: '0',
        evidence_set_hash: digest, state: 'AWAITING_FUNDING', can_pay: approved }, actions: [
        ...(!approved ? [{ action_id: `approve-basis:${basisId}:1`, command: 'approve_fund_payment_allocation_basis' as const,
          record_id: basisId, expected_revision: 1, label: 'Approve the allocation basis before payment',
          reason_code: null, owner_role: 'IssuerFundManager', can_execute: true,
          payload: { basis_id: basisId, expected_revision: 1 } }] : []),
        { action_id: `request-final-allocation:${subscription}:1`, command: 'request_fund_allocation' as const,
          record_id: subscription, expected_revision: 1, label: 'Prepare final allocation after reconciliation',
          reason_code: 'RECONCILED_PAYMENT_AND_WALLET_REQUIRED', owner_role: 'IssuerFundManager', can_execute: false,
          payload: { subscription_id: subscription, expected_obligation_revision: 1 } },
      ] }] }
}
function render(approved = false) {
  return renderToStaticMarkup(<FundLifecycleOrder lifecycle={productRecord(approved)} subscriptionId={subscription}
    actorId={actor} operatingContext={context} onRefresh={() => {}} />)
}
describe('same-order pre-payment issuer handoff', () => {
  it('explains issuer waiting first and hides receiving instructions while approval is absent', () => {
    const html = render()
    expect(html.indexOf('Issuer allocation approval')).toBeLessThan(html.indexOf('Pay the approved TST instruction'))
    expect(html).toContain('Your reserved units are awaiting the appointed issuer. Do not send tokens yet.')
    expect(html).toContain('Payment instructions remain unavailable')
    expect(html).not.toContain(`0x${'22'.repeat(20)}`)
    expect(html).not.toContain('Transfer the approved TST amount in MetaMask')
    expect(html).toContain('After payment is reconciled, the issuer and transfer agent recheck')
    expect(html.indexOf('Approve the allocation basis before payment')).toBeLessThan(html.indexOf('Pay the approved TST instruction'))
    expect(html).toContain('disabled="">Prepare final allocation after reconciliation')
  })
  it('reveals the exact TST instruction only with current saved issuer approval, without claiming ownership', () => {
    const html = render(true)
    expect(html).toContain('The issuer-approved allocation basis is current')
    expect(html).toContain(`0x${'22'.repeat(20)}`)
    expect(html).toContain('1,000 TST')
    expect(html).toContain('No holding recorded')
    expect(html).toContain('Reconciled payment is not token ownership')
    expect(html).not.toContain('Reconciled holding recorded')
    expect(html).not.toContain('Approve the allocation basis before payment')
    expect(html).toContain('disabled="">Prepare final allocation after reconciliation')
  })
})
