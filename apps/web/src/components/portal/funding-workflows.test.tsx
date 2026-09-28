import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPLICANT_CONTEXT, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PortalProduct, PortalSnapshot, PortalSubscription } from '@/lib/portal/contracts'
import type { FundingJournal, FundingObligation, FundingReference, FundingRoute } from '@/lib/portal/funding-contracts'
import type { FundingClaim } from '@/lib/portal/funding-claim'
import type { MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { FundingOrderDetail, FundingWorkspace, fundingReferencePayload, fundingRouteUsable, fundingTokenAmount, signFundingClaim, verifyFundingRecord } from './funding-workflows'
import { PortalCommandProvider } from './portal-client'
import { PortalScreen } from './portal-screens'
import { fictionalProductTerms } from './product-form'

const actor = '11111111-1111-4111-8111-111111111111'
const record = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const organisation = '44444444-4444-4444-8444-444444444444'
const obligationId = '55555555-5555-4555-8555-555555555555'
const accountId = '66666666-6666-4666-8666-666666666666'
const nativeOrganisation = '77777777-7777-4777-8777-777777777777'
const routeId = '88888888-8888-4888-8888-888888888888'
const referenceId = '99999999-9999-4999-8999-999999999999'
const token = `0x${'aa'.repeat(20)}`, receiver = `0x${'bb'.repeat(20)}`, payer = `0x${'cc'.repeat(20)}`, tx = `0x${'dd'.repeat(32)}`
const context = (role: 'Investor' | 'TreasuryOperator' | 'FinancialController' | 'IssuerFundManager'): PortalOperatingContext => ({ mode: 'ROLE', organisationId: nativeOrganisation, role })
function route(change: Partial<FundingRoute> = {}): FundingRoute { return { id: routeId, product_id: productId, organisation_id: organisation, product_revision: 1, terms_hash: 'ab'.repeat(32), revision: 2, status: 'APPROVED', chain_id: 80002, token_address: token, token_runtime_hash: `0x${'ef'.repeat(32)}`, token_decimals: 6, receiving_address: receiver, authority_reference: 'Reviewed fictional receiving mandate reference.', code_review_reference: 'Reviewed immutable standard token code reference.', valid_until: '2099-01-01T00:00:00Z', verification_status: 'VERIFIED', proposed_by: record, approved_by: actor, allowed_actions: [], ...change } }
function obligation(change: Partial<FundingObligation> = {}): FundingObligation { return { id: obligationId, subscription_id: record, investment_account_id: accountId, investor_id: actor, product_id: productId, organisation_id: organisation, route_id: routeId, revision: 2, state: 'AWAITING_FUNDING', amount_minor: '100000', currency: 'ZAR_TEST', token_amount_base_units: '1000000000', token_decimals: 6, observed_amount_base_units: '0', posted_amount_base_units: '0', reservation_status: 'AWAITING_FUNDING', evidence_set_hash: 'ab'.repeat(32), created_at: '2026-09-21T10:00:00Z', allowed_actions: ['submit_funding_reference'], ...change } }
function reference(change: Partial<FundingReference> = {}): FundingReference { return { id: referenceId, obligation_id: obligationId, revision: 2, status: 'ACCEPTANCE_PROPOSED', payer_address: payer, transaction_hash: tx, log_index: 1, amount_base_units: '1000000000', verification_status: 'VERIFIED', last_observed_at: '2026-09-21T10:01:00Z', block_hash: `0x${'01'.repeat(32)}`, block_number: '1234', observation_reason: null, acceptance_proposed_by: record, exception_decision: null, exception_reason: null, allowed_actions: [], ...change } }
function product(kind: 'FUND' | 'REAL_ESTATE' = 'FUND'): PortalProduct { return { id: productId, organisation_id: organisation, created_by: record, revision: 1, status: 'PUBLISHED', terms: fictionalProductTerms(kind), terms_hash: 'ab'.repeat(32), reserved_units: '10', created_at: '2026-09-21T10:00:00Z', reviewer_id: actor, review_notes: null, reviewed_at: '2026-09-21T09:00:00Z', published_at: '2026-09-21T09:01:00Z', review_checks: {}, allowed_actions: [] } }
function subscription(): PortalSubscription { return { id: record, product_id: productId, investor_id: actor, investment_account_id: accountId, product_name: 'Shared funding test product', organisation_id: organisation, product_revision: 1, terms_hash: 'ab'.repeat(32), units: '10', amount_minor: '100000', status: 'AWAITING_FUNDING', created_at: '2026-09-21T10:00:00Z', can_cancel: false, funding_obligation_id: obligationId, allowed_actions: [] } }
function snapshot(role: 'Investor' | 'TreasuryOperator' | 'FinancialController' | 'IssuerFundManager' = 'Investor'): PortalSnapshot {
  return { actor: { id: actor, email: 'synthetic@example.invalid', display_name: null, can_review: false }, operating_context: context(role), applications: [], accounts: [], organisations: [{ id: organisation, name: 'Scoped issuer', status: 'ACTIVE', roles: [role], authority_source: 'NATIVE_BINDING', native_organisation_id: nativeOrganisation, capabilities: ['read_orders'] }], products: [product()], subscriptions: [subscription()], events: [], funding: { routes: [route()], obligations: [obligation()], references: [], journals: [], reversals: [] } }
}
function detail(value = snapshot()) { return renderToStaticMarkup(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context}><FundingOrderDetail subscription={value.subscriptions[0]} snapshot={value} operatingContext={value.operating_context!} onSaved={vi.fn()} /></PortalCommandProvider>) }
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
afterEach(() => { vi.unstubAllGlobals() })

describe('funding exact units and verification transport', () => {
  it('keeps token precision separate from two-decimal synthetic amounts', () => {
    expect(fundingTokenAmount('900719925474099301', 2).replace(/[,\s]/g, '')).toBe('9007199254740993.01')
    expect(fundingTokenAmount('1000000000000000001', 18)).toBe('1.000000000000000001')
    expect(fundingTokenAmount('1', 6)).toBe('0.000001')
    expect(fundingTokenAmount('0', 18)).toBe('0')
  })
  it.each([['1', 0], ['1', 19], ['1', 2.5], ['-1', 2], ['1.1', 2], ['01', 2]] as const)('rejects unsupported units or precision %s / %s', (amount, decimals) => {
    expect(fundingTokenAmount(amount, decimals)).toBe('Unavailable')
  })
  it('passes only the target, selected context and expected actor to the fixed verification endpoint', async () => {
    const snapshot = { actor: { id: actor }, operating_context: APPLICANT_CONTEXT }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    expect(await verifyFundingRecord('REFERENCE', record, APPLICANT_CONTEXT, actor)).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledWith('/api/portal/funding/verify', expect.objectContaining({ method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actor }, body: JSON.stringify({ kind: 'REFERENCE', id: record, operating_context: APPLICANT_CONTEXT }) }))
  })
  it.each([{ actor: { id: record }, operating_context: APPLICANT_CONTEXT }, { actor: { id: actor }, operating_context: { mode: 'ROLE', organisationId: record, role: 'Investor' } }])('rejects cross-actor or cross-context verification results', async snapshot => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshot }), { headers: { 'content-type': 'application/json' } })))
    await expect(verifyFundingRecord('REFERENCE', record, APPLICANT_CONTEXT, actor)).rejects.toThrow('operating context')
  })
  it('does not convert a failed verification into a financial success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Providers disagree.' }), { status: 503, headers: { 'content-type': 'application/json' } })))
    await expect(verifyFundingRecord('ROUTE', record, APPLICANT_CONTEXT, actor)).rejects.toThrow('Providers disagree')
  })
})

describe('connected funding records without fabricated settlement', () => {
  it('distinguishes an unavailable projection from an empty queue', () => {
    const value = snapshot(); delete value.funding
    expect(detail(value)).toContain('Funding records unavailable')
    expect(detail(value)).toContain('this is not a zero balance')
    expect(detail(value)).not.toContain('Open funding obligation for this route')
  })
  it('keeps the saved subscription reachable before any funding route or obligation exists', () => {
    const value = snapshot(); value.funding = { routes: [], obligations: [], references: [], journals: [], reversals: [] }
    const html = detail(value)
    expect(html).toContain(record); expect(html).toContain(accountId); expect(html).toContain('Do not send funds yet')
    expect(html).not.toContain('Sign receipt claim'); expect(html).not.toContain('Open funding obligation for this route')
  })
  it.each([{ status: 'PROPOSED' as const }, { status: 'REVOKED' as const }, { verification_status: 'PENDING' as const }, { verification_status: 'UNAVAILABLE' as const }, { valid_until: '2020-01-01T00:00:00Z' }])('blocks new instructions for unusable route %j', change => {
    const value = snapshot(); value.funding!.routes = [route(change)]; value.funding!.obligations = []; value.subscriptions[0].allowed_actions = ['open_funding_obligation']
    expect(fundingRouteUsable(value.funding!.routes[0])).toBe(false)
    expect(detail(value)).not.toContain('Open funding obligation for this route')
    expect(detail(value)).toContain('Do not send funds')
  })
  it('requires the server action even when the current actor owns a subscription and the route is approved', () => {
    const value = snapshot(); value.funding!.obligations = []
    expect(detail(value)).not.toContain('Open funding obligation for this route')
    value.subscriptions[0].allowed_actions = ['open_funding_obligation']
    expect(detail(value)).toContain('Open funding obligation for this route')
  })
  it('does not open MetaMask or call a financial API while rendering', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = detail()
    expect(html).toContain('Connect payer MetaMask on Amoy'); expect(html).toContain('Sign receipt claim and submit reference')
    expect(html).toContain('This page does not send tokens'); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['FUND', 'REAL_ESTATE'] as const)('preserves the same %s subscription, account and obligation across investor, issuer and finance views', kind => {
    for (const role of ['Investor', 'IssuerFundManager', 'TreasuryOperator', 'FinancialController'] as const) {
      const value = snapshot(role); value.products = [product(kind)]
      const html = renderToStaticMarkup(<PortalScreen data={{ user: { id: actor, email: value.actor.email }, snapshot: value }} view="/portal/orders/detail" id={record} operatingContext={context(role)} />)
      expect(html).toContain(record); expect(html).toContain(accountId); expect(html).toContain(obligationId); expect(html).toContain('ab'.repeat(32))
      expect(html).toContain('Requested synthetic amount'); expect(html).toContain('Required settlement-token amount'); expect(html).toContain('Required token base units')
      expect(html).not.toContain('Mark paid'); expect(html).not.toContain('Mint tokens')
    }
  })
  it('shows Treasury a scoped operational queue and route proposal only with the exact product action', () => {
    const value = snapshot('TreasuryOperator')
    const render = () => renderToStaticMarkup(<PortalCommandProvider snapshot={value} operatingContext={context('TreasuryOperator')}><FundingWorkspace snapshot={value} operatingContext={context('TreasuryOperator')} onSaved={vi.fn()} /></PortalCommandProvider>)
    expect(render()).toContain('Funding operations queue'); expect(render()).toContain('No route-proposal authority')
    value.products[0].allowed_actions = ['propose_funding_route']
    expect(render()).toContain('Propose a reviewed test funding route')
    expect(render()).toContain(portalScopeHref('/portal/orders/detail', context('TreasuryOperator'), record).replaceAll('&', '&amp;'))
    expect(render()).not.toContain('Create a product'); expect(render()).not.toContain('Reconcile evidence and post balanced journal')
  })
  it('does not infer a finance scope from a matching organisation label or another native organisation', () => {
    const value = snapshot('TreasuryOperator'); value.organisations[0].native_organisation_id = record
    const html = renderToStaticMarkup(<FundingWorkspace snapshot={value} operatingContext={context('TreasuryOperator')} onSaved={vi.fn()} />)
    expect(html).toContain('No appointed financial scope'); expect(html).not.toContain('Shared funding test product')
  })
  it('separates Treasury acceptance from Controller reconciliation and refuses self-checking in the UI', () => {
    const treasury = snapshot('TreasuryOperator'); treasury.funding!.references = [reference({ allowed_actions: ['propose_funding_acceptance', 'reconcile_funding'] })]
    expect(detail(treasury)).toContain('Propose acceptance of verified evidence'); expect(detail(treasury)).not.toContain('Reconcile evidence and post balanced journal')
    const controller = snapshot('FinancialController'); controller.funding!.references = treasury.funding!.references
    expect(detail(controller)).toContain('Reconcile evidence and post balanced journal'); expect(detail(controller)).not.toContain('Propose acceptance of verified evidence')
    controller.funding!.references[0].acceptance_proposed_by = actor
    expect(detail(controller)).not.toContain('Reconcile evidence and post balanced journal')
  })
  it.each(['PARTIAL', 'OVERPAID', 'RECONCILED', 'UNAPPLIED', 'REVERSED'] as const)('displays the %s funding state without changing the reservation to cancelled or claiming ownership', state => {
    const value = snapshot(); value.funding!.obligations = [obligation({ state })]
    const html = detail(value)
    expect(html).toContain('Reservation status'); expect(html).toContain('Units reserved')
    expect(html).not.toContain('Reservation cancelled'); expect(html).toContain('Reconciled funding is not issued ownership')
    expect(html).toContain('Do not send additional funds'); expect(html).not.toContain('User-controlled MetaMask transfer')
  })
  it('does not offer another transfer while an existing reference remains unresolved', () => {
    const value = snapshot(); value.funding!.references = [reference({ status: 'SUBMITTED', verification_status: 'PENDING', amount_base_units: null })]
    const html = detail(value)
    expect(html).toContain('Do not send additional funds'); expect(html).not.toContain('User-controlled MetaMask transfer')
    expect(html).toContain('The full required amount displayed above is not a request to pay again.')
  })
  it.each(['REVOKED', 'CANCELLED'] as const)('allows reporting an existing transfer after %s without directing another payment', state => {
    const value = snapshot()
    if (state === 'REVOKED') value.funding!.routes = [route({ status: 'REVOKED' })]
    else {
      value.subscriptions[0].status = 'CANCELLED'
      value.funding!.obligations = [obligation({ state: 'CANCELLED', reservation_status: 'CANCELLED', allowed_actions: ['submit_funding_reference'] })]
    }
    const html = detail(value)
    expect(html).toContain('Do not send additional funds')
    expect(html).toContain('If you already made a transfer, submit its existing reference for review.')
    expect(html).toContain('Sign receipt claim and submit reference')
    expect(html).not.toContain('User-controlled MetaMask transfer')
    expect(html).not.toContain('Make any transfer yourself')
  })
  it('shows immutable opposite-line reversals as accounting, never an on-chain refund', () => {
    const value = snapshot('FinancialController')
    const journal: FundingJournal = { id: actor, obligation_id: obligationId, reference_id: referenceId, kind: 'REVERSAL', amount_base_units: '1000000000', token_address: token, token_decimals: 6, created_at: '2026-09-21T12:00:00Z', original_journal_id: record, posted_by: actor, allowed_actions: [], lines: [{ account: 'TEST_SETTLEMENT_TOKEN_ASSET', side: 'CREDIT', amount_base_units: '1000000000' }, { account: 'TEST_CUSTOMER_FUNDING_LIABILITY', side: 'DEBIT', amount_base_units: '1000000000' }] }
    value.funding!.journals = [journal]
    const html = detail(value)
    expect(html).toContain('Posted accounting reversal'); expect(html).toContain('CREDIT'); expect(html).toContain('DEBIT')
    expect(html).toContain('This reversal does not send an on-chain refund')
  })
  it.each([false, undefined])('does not expose cancellation without a canonical true can_cancel flag (%s)', canCancel => {
    const value = snapshot(); value.subscriptions[0].can_cancel = canCancel
    const html = renderToStaticMarkup(<PortalScreen data={{ user: { id: actor, email: value.actor.email }, snapshot: value }} view="/portal/portfolio" operatingContext={context('Investor')} />)
    expect(html).not.toContain('Cancel unfunded reservation'); expect(html).toContain('Cancellation is not currently authorised')
  })
})

describe('explicit MetaMask funding claim signing', () => {
  const claim = (): FundingClaim => ({ actor_id: actor, investment_account_id: accountId, obligation_id: obligationId, route_id: routeId, route_revision: 2, token_address: token, token_runtime_hash: `0x${'ef'.repeat(32)}`, receiving_address: receiver, token_decimals: 6, payer_address: payer, transaction_hash: tx, log_index: 1 })
  function wallet(chain = '0x13882') {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }): Promise<unknown> => method === 'eth_accounts' ? [payer] : method === 'eth_chainId' ? chain : `0x${'01'.repeat(64)}1b`)
    const provider: MetaMaskProvider = { request, on: (event, listener) => { listeners.set(event, listener) }, removeListener: (event) => { listeners.delete(event) } }
    return { request, provider, listeners }
  }
  it('submits the exact route revision used for the claim instead of allowing a later route to be substituted', () => {
    const signature = `0x${'01'.repeat(64)}1b`
    expect(fundingReferencePayload(obligation({ revision: 4 }), route({ revision: 2 }), payer, tx, 1, signature)).toEqual({ obligation_id: obligationId, expected_revision: 4, expected_route_revision: 2, payer_address: payer, transaction_hash: tx, log_index: 1, signature })
  })
  it('checks Amoy and payer before and after personal_sign and never sends a transaction', async () => {
    const value = wallet()
    expect(await signFundingClaim(value.provider, claim())).toMatch(/^0x/)
    expect(value.request.mock.calls.map(([call]) => call.method)).toEqual(['eth_accounts', 'eth_chainId', 'personal_sign', 'eth_accounts', 'eth_chainId'])
    const signed = value.request.mock.calls.find(([call]) => call.method === 'personal_sign')![0]
    expect(signed.params?.[1]).toBe(payer)
    expect(new TextDecoder().decode(Uint8Array.from((signed.params![0] as string).slice(2).match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16))))).toContain(obligationId)
    expect(value.listeners.size).toBe(0)
  })
  it('does not sign on mainnet', async () => {
    const value = wallet('0x1')
    await expect(signFundingClaim(value.provider, claim())).rejects.toThrow('Polygon Amoy')
    expect(value.request.mock.calls.some(([call]) => call.method === 'personal_sign')).toBe(false)
  })
  it('discards a signature if an account-change event occurs during the wallet prompt', async () => {
    const value = wallet()
    value.request.mockImplementation(async ({ method }) => {
      if (method === 'personal_sign') { value.listeners.get('accountsChanged')?.(); return `0x${'01'.repeat(64)}1b` }
      return method === 'eth_accounts' ? [payer] : '0x13882'
    })
    await expect(signFundingClaim(value.provider, claim())).rejects.toThrow('changed')
    expect(value.listeners.size).toBe(0)
  })
  it('does not sign for a no-longer-current portal context', async () => {
    const value = wallet()
    await expect(signFundingClaim(value.provider, claim(), () => false)).rejects.toThrow('changed')
    expect(value.request.mock.calls.some(([call]) => call.method === 'personal_sign')).toBe(false)
  })
})
