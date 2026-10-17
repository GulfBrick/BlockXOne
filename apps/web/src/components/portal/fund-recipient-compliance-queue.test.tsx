import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { fundStageKeys, type FundLifecycleSnapshot, type FundProductLifecycle } from '@/lib/portal/fund-lifecycle-contracts'
import { FundLifecycleDashboard, FundLifecycleOrder } from './fund-lifecycle'

const actor = '11111111-1111-4111-8111-111111111111'
const organisation = '22222222-2222-4222-8222-222222222222'
const subscription = '33333333-3333-4333-8333-333333333333'
const binding = '44444444-4444-4444-8444-444444444444'
const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'ComplianceOfficer' as const }

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// Presentation fixture only: real case/role/MFA authority is SQL-guarded.
vi.mock('./portal-client', () => ({
  usePortalActorId: () => '11111111-1111-4111-8111-111111111111',
  usePortalOperatingContext: () => ({ mode: 'ROLE', organisationId: '22222222-2222-4222-8222-222222222222', role: 'ComplianceOfficer' }),
  usePortalCommand: () => ({ busy: false, unknown: false, message: '', submit: vi.fn(), retry: vi.fn() }),
}))
vi.mock('./fund-recipient', () => ({ FundRecipient: ({ bindingId }: { bindingId: string }) => <p data-binding={bindingId}>Existing same-order recipient workflow</p> }))

function productRecord(): FundProductLifecycle {
  return { product_id: organisation, organisation_id: organisation, native_organisation_id: organisation, product_revision: 4,
    offering_revision_id: organisation, class_id: organisation, product_name: 'Fictional fund', terms_hash: 'ab'.repeat(32), configuration_hash: 'ab'.repeat(32),
    availability: 'AVAILABLE', stages: fundStageKeys.map(key => ({ key, state: 'CURRENT', label: key,
      description: 'Synthetic rendering fixture', owner_role: 'ComplianceOfficer', reason_code: null, evidence_ids: [] })),
    next_action: null, actions: [], operations: [], holdings: [], orders: [{ subscription_id: subscription, product_id: organisation,
      investment_account_id: organisation, allocation_id: null, allocation_revision: null, units_base: '100', security_unit_decimals: 0,
      delivery_wallet: { binding_id: binding, proof_id: binding, address: `0x${'11'.repeat(20)}`, chain_id: 80002, effective: true },
      issuance_operation_id: null, payment_allocation_basis: null, funding: null, actions: [] }] }
}
function snapshot(product = productRecord()): FundLifecycleSnapshot {
  return { schema_version: 1, projection_revision: 1, actor_id: actor, environment: 'TESTNET', operating_context: context,
    observed_at: '2026-10-15T12:00:00Z', availability: 'AVAILABLE', reason_code: null, products: [product], requests: [] }
}
describe('same-order Compliance recipient handoff', () => {
  it('links only server-returned recipient-bearing orders in the current capacity', () => {
    const html = renderToStaticMarkup(<FundLifecycleDashboard snapshot={snapshot()} role="ComplianceOfficer" actorId={actor}
      operatingContext={context} onRefresh={() => {}} />)
    expect(html).toContain('Investor delivery-wallet reviews')
    expect(html).toContain('Open wallet review')
    expect(html).toContain(subscription)
    expect(html).toContain('role=ComplianceOfficer')
    expect(html).not.toContain('Create recipient approval')
  })
  it('keeps the saved order but renders only claim review, not financial or issuance controls', () => {
    const html = renderToStaticMarkup(<FundLifecycleOrder lifecycle={productRecord()} subscriptionId={subscription}
      actorId={actor} operatingContext={context} onRefresh={() => {}} />)
    expect(html).toContain('Saved investor wallet review')
    expect(html).toContain(`data-binding="${binding}"`)
    expect(html).toContain('Existing same-order recipient workflow')
    expect(html).not.toContain('Pay the approved TST instruction')
    expect(html).not.toContain('Issuer allocation approval')
    expect(html).not.toContain('Request unit issuance')
    expect(html).toContain('does not authorise payment, allocation or issuance')
  })
  it('does not fabricate a queue or a wallet bridge from a missing returned order', () => {
    const product = productRecord(); product.orders = []
    const queue = renderToStaticMarkup(<FundLifecycleDashboard snapshot={snapshot(product)} role="ComplianceOfficer" actorId={actor}
      operatingContext={context} onRefresh={() => {}} />)
    const order = renderToStaticMarkup(<FundLifecycleOrder lifecycle={product} subscriptionId={subscription}
      actorId={actor} operatingContext={context} onRefresh={() => {}} />)
    expect(queue).not.toContain('Open wallet review')
    expect(queue).toContain('No current recipient case is available')
    expect(order).not.toContain('Existing same-order recipient workflow')
    expect(order).toContain('No verified fund handoff was returned')
  })
})
