// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSnapshot, PortalSubscription } from '@/lib/portal/contracts'
import type { FundingObligation, FundingRoute } from '@/lib/portal/funding-contracts'
import type { FundPaymentReceiptPrefill } from '@/lib/portal/fund-payment-receipt-contracts'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import type { MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { FundingOrderDetail } from './funding-workflows'
import { PortalCommandProvider } from './portal-client'

// Real mounted form and read transport with synthetic responses only. These
// cases do not prove hosted SQL, provider finality, a signature or settlement.
const wallet = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(), removeListener: vi.fn(), stop: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/components/workspace/metamask-wallet-link', () => ({
  discoverMetaMask: (_target: Window, receive: (choice: { id: string; provider: MetaMaskProvider }) => void) => {
    receive({ id: 'synthetic-claim-wallet', provider: wallet })
    return wallet.stop
  },
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(1), subscriptionId = id(2), productId = id(3), routeId = id(4), obligationId = id(5), accountId = id(6)
const payer = `0x${'cc'.repeat(20)}`, token = `0x${'aa'.repeat(20)}`, beneficiary = `0x${'bb'.repeat(20)}`
const olderHash = `0x${'dd'.repeat(32)}`, newerHash = `0x${'ee'.repeat(32)}`
const contextA: PortalOperatingContext = { mode: 'ROLE', organisationId: id(7), role: 'Investor' }
const contextB: PortalOperatingContext = { mode: 'ROLE', organisationId: id(8), role: 'Investor' }

function route(): FundingRoute {
  return { id: routeId, product_id: productId, organisation_id: id(7), product_revision: 1,
    terms_hash: 'ab'.repeat(32), revision: 2, status: 'APPROVED', chain_id: 80002, token_address: token,
    token_runtime_hash: `0x${'ef'.repeat(32)}`, token_decimals: 6, receiving_address: beneficiary,
    authority_reference: 'Synthetic reviewed receiving mandate.', code_review_reference: 'Synthetic pinned token code.',
    valid_until: '2099-01-01T00:00:00Z', verification_status: 'VERIFIED', proposed_by: id(10), approved_by: id(11), allowed_actions: [] }
}
function obligation(): FundingObligation {
  return { id: obligationId, subscription_id: subscriptionId, investment_account_id: accountId, investor_id: actor,
    product_id: productId, organisation_id: id(7), route_id: routeId, revision: 2, state: 'AWAITING_FUNDING',
    amount_minor: '1000000000', currency: 'TST', token_amount_base_units: '1000000000', token_decimals: 6,
    observed_amount_base_units: '0', posted_amount_base_units: '0', reservation_status: 'AWAITING_FUNDING',
    evidence_set_hash: 'ab'.repeat(32), created_at: '2026-09-21T10:00:00Z', allowed_actions: ['submit_funding_reference'] }
}
function subscription(): PortalSubscription {
  return { id: subscriptionId, product_id: productId, investor_id: actor, investment_account_id: accountId,
    product_name: 'Synthetic fund claim fixture', organisation_id: id(7), product_revision: 1,
    terms_hash: 'ab'.repeat(32), units: '100', amount_minor: '1000000000', currency: 'TST', status: 'AWAITING_FUNDING',
    created_at: '2026-09-21T10:00:00Z', can_cancel: false, funding_obligation_id: obligationId, allowed_actions: [] }
}
function snapshot(operatingContext: PortalOperatingContext): PortalSnapshot {
  return { actor: { id: actor, email: 'claim.fixture@example.invalid', display_name: null, can_review: false },
    operating_context: operatingContext, applications: [], accounts: [], organisations: [], products: [],
    subscriptions: [subscription()], events: [], requests: [],
    funding: { routes: [route()], obligations: [obligation()], references: [], journals: [], reversals: [] } }
}
function prefill(transactionHash = newerHash): FundPaymentReceiptPrefill {
  return { version: 1, status: 'READY_FOR_PAYER_CLAIM', payment_id: id(9), subscription_id: subscriptionId,
    obligation_id: obligationId, obligation_revision: 2, route_id: routeId, route_revision: 2,
    investment_account_id: accountId, actor_id: actor, chain_id: 80002, currency: 'TST', token_decimals: 6,
    token_address: token, token_runtime_hash: route().token_runtime_hash, beneficiary_address: beneficiary,
    payer_address: payer, transaction_hash: transactionHash, log_index: 1, amount_base_units: '1000000000',
    block_number: '1234', block_hash: `0x${'01'.repeat(32)}`, block_timestamp: '2026-09-21T10:01:00Z',
    providers: [{ url: 'https://polygon-amoy.drpc.org', finalized_block_number: '1235', finalized_block_hash: `0x${'02'.repeat(32)}` },
      { url: 'https://polygon-amoy-bor-rpc.publicnode.com', finalized_block_number: '1236', finalized_block_hash: `0x${'03'.repeat(32)}` }] }
}
const response = (value: FundPaymentReceiptPrefill) => new Response(JSON.stringify({ prefill: value }), { headers: { 'content-type': 'application/json' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}
const onSaved = vi.fn()
function tree(operatingContext: PortalOperatingContext) {
  const value = snapshot(operatingContext)
  return <PortalCommandProvider snapshot={value} operatingContext={operatingContext} environment="TESTNET">
    <FundingOrderDetail subscription={value.subscriptions[0]} snapshot={value} operatingContext={operatingContext}
      onSaved={onSaved} fundFlow={{ allocationBasisCurrent: true }} />
  </PortalCommandProvider>
}
const findButton = () => screen.getByRole('button', { name: /Find my saved transfer|Checking the existing transfer/ }) as HTMLButtonElement

beforeEach(() => {
  sessionStorage.clear()
  onSaved.mockClear()
  wallet.request.mockReset()
  wallet.on.mockClear(); wallet.removeListener.mockClear(); wallet.stop.mockClear()
  wallet.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [payer]
    if (method === 'eth_chainId') return '0x13882'
    throw new Error('Synthetic fixture does not authorise signing or transactions.')
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('mounted saved-payment claim scope and deferred responses', () => {
  it('does not let an older A response unlock or replace a newer A request after A to B to A', async () => {
    const first = deferred<Response>(), second = deferred<Response>()
    // Deliberately ignore cancellation to model a response already queued while
    // scope changed. The component must reject it independently of transport.
    const fetcher = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    vi.stubGlobal('fetch', fetcher)
    const view = render(tree(contextA))
    await waitFor(() => expect(screen.getByText('MetaMask detected. Connect the wallet that sent this payment.')).toBeTruthy())
    fireEvent.click(findButton())
    expect(fetcher).toHaveBeenCalledTimes(1)
    const firstSignal = fetcher.mock.calls[0][1].signal as AbortSignal
    view.rerender(tree(contextB))
    await waitFor(() => expect(findButton().disabled).toBe(false))
    expect(firstSignal.aborted).toBe(true)
    view.rerender(tree(contextA))
    await waitFor(() => expect(findButton().disabled).toBe(false))
    fireEvent.click(findButton())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(findButton().disabled).toBe(true)

    await act(async () => { first.resolve(response(prefill(olderHash))) })
    expect(findButton().disabled).toBe(true)
    expect(screen.queryByText(/Saved transfer:/)).toBeNull()
    expect(screen.getByText('Finding the transfer already recorded for this order...')).toBeTruthy()
    fireEvent.click(findButton())
    expect(fetcher).toHaveBeenCalledTimes(2)

    await act(async () => { second.resolve(response(prefill(newerHash))) })
    await waitFor(() => expect(screen.getByText(/Saved transfer:/).textContent).toContain(newerHash))
    expect(screen.queryByText(new RegExp(olderHash))).toBeNull()
    expect(findButton().disabled).toBe(false)
    expect(wallet.request).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('clears a discovered transfer on scope change without reusing it or signing automatically', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(prefill()))
    vi.stubGlobal('fetch', fetcher)
    const view = render(tree(contextA))
    fireEvent.click(findButton())
    await waitFor(() => expect(screen.getByText(/Saved transfer:/).textContent).toContain(newerHash))
    view.rerender(tree(contextB))
    await waitFor(() => expect(screen.queryByText(/Saved transfer:/)).toBeNull())
    expect((screen.getByRole('button', { name: 'Confirm payer and submit for review' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(wallet.request).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('reads the saved order identity and connects its original payer without requesting a signature or token transfer', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(prefill()))
    vi.stubGlobal('fetch', fetcher)
    render(tree(contextA))
    await waitFor(() => expect(screen.getByText('MetaMask detected. Connect the wallet that sent this payment.')).toBeTruthy())
    fireEvent.click(findButton())
    await waitFor(() => expect(screen.getByText(/Saved transfer:/).textContent).toContain(newerHash))
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('/api/portal/fund-lifecycle/payment/receipt')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json', 'x-bx1-expected-actor': actor })
    expect(JSON.parse(options.body)).toEqual({ subscription_id: subscriptionId, operating_context: contextA })
    expect(wallet.request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Connect payer MetaMask on Amoy' }))
    await waitFor(() => expect(screen.getByText(`Payer: ${payer}`)).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Confirm payer and submit for review' }) as HTMLButtonElement).disabled).toBe(false)
    expect(wallet.request.mock.calls.map(([call]) => call.method)).toEqual(['eth_requestAccounts', 'eth_chainId'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })
})
