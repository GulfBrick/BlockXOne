// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSnapshot } from '@/lib/portal/contracts'
import { fundSetupStepKeys, type FundSetupSnapshot } from '@/lib/portal/fund-setup-contracts'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import type { MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { PortalCommandProvider } from './portal-client'
import { FundSetup } from './fund-setup'

// Mounted real workspace/transport/context and wallet monitoring, synthetic
// responses only. No authenticated cloud SQL or Amoy outcome is asserted.
const wallet = vi.hoisted(() => ({ request: vi.fn(), on: vi.fn(), removeListener: vi.fn(), stop: vi.fn() }))
const preparation = vi.hoisted(() => ({ prepare: vi.fn(), validateNonce: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('@/components/workspace/metamask-wallet-link', () => ({
  discoverMetaMask: (_target: Window, receive: (choice: { id: string; provider: MetaMaskProvider }) => void) => {
    receive({ id: 'synthetic-setup-wallet', provider: wallet }); return wallet.stop
  },
}))
vi.mock('@/lib/testnet-fund/wallet-transaction', () => ({
  prepareAmoyWalletTransaction: preparation.prepare, validateRecoveryNonce: preparation.validateNonce,
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(1), product = id(2), organisation = id(3), setupId = id(4)
const sender = `0x${'aa'.repeat(20)}`, second = `0x${'bb'.repeat(20)}`, safe = `0x${'cc'.repeat(20)}`
const binding = 'ab'.repeat(32), context: PortalOperatingContext = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
const calls = new Set(['trex_version', 'trex_factory_binding', 'ia_factory_binding', 'oid_factory_binding', 'factory_handoff', 'trex_authority_handoff', 'oid_authority_handoff', 'oid_factory_handoff'])
function saved(state: 'PREPARED' | 'UNKNOWN' = 'PREPARED'): FundSetupSnapshot {
  const intent = { version: 1 as const, chain_id: 80002 as const, step_key: fundSetupStepKeys[0], kind: 'CREATE' as const,
    sender, nonce: '0', value: '0' as const, to: null, data: '0x1234', expected_address: second,
    artifact_name: 'Token', expected_runtime_hash: `0x${'ef'.repeat(32)}`, checks: [], configuration_hash: binding, catalog_hash: binding }
  const steps = fundSetupStepKeys.map((step_key, index) => ({ id: id(100 + index), step_key, ordinal: index + 1,
    kind: calls.has(step_key) ? 'CALL' as const : 'CREATE' as const, revision: index === 0 ? state === 'PREPARED' ? 2 : 3 : 1,
    state: index === 0 ? state : 'NOT_STARTED' as const, actor_id: index === 0 ? actor : null,
    sender: index === 0 ? sender : null, nonce: index === 0 ? '0' : null, intent_hash: index === 0 ? binding : null,
    intent: index === 0 ? intent : null, expires_at: index === 0 ? '2099-01-01T00:00:00Z' : null,
    claimed_at: index === 0 && state === 'UNKNOWN' ? '2026-10-14T10:00:00Z' : null,
    transaction_hash: null, deployed_address: null, observation_id: null, reason_code: null }))
  return { schema_version: 1, actor_id: actor, environment: 'TESTNET', operating_context: context,
    observed_at: '2026-10-14T10:00:00Z', product_id: product, product_revision: 9, offering_revision_id: id(5),
    terms_hash: binding, configuration_hash: binding, source_pin: 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4',
    roleplay_policy: null, availability: 'AVAILABLE', reason_code: null,
    setup: { id: setupId, revision: state === 'PREPARED' ? 3 : 4, actor_id: actor, operating_context: context,
      state: 'IN_PROGRESS', recovery_hold: false, recovery_reason: null, recovery_observation_id: null,
      expires_at: '2099-01-01T00:00:00Z', safe_address: safe, safe_state: 'VERIFIED', safe_owners: [sender, second], safe_threshold: 2,
      configuration: { safe_address: safe, identity_management_key: sender, claim_management_key: sender, token_management_key: sender,
        maximum_holding_base_units: '1000000000', tst_initial_holder: sender, tst_initial_supply_base_units: '1000000000' },
      setup_configuration_hash: binding, safe_configuration: null, safe_creation: null, dependencies: {},
      steps, next_step: fundSetupStepKeys[0], saved_intent: intent,
      admission_reason: 'RELEASE_CONFORMANCE_AND_GOVERNANCE_RECEIPTS_REQUIRED' } }
}
const onRefresh = vi.fn()
function tree(operatingContext = context) {
  const portal: PortalSnapshot = { actor: { id: actor, email: 'setup.fixture@example.invalid', display_name: null, can_review: false },
    operating_context: operatingContext, applications: [], accounts: [], organisations: [], products: [], subscriptions: [], events: [], requests: [] }
  return <PortalCommandProvider snapshot={portal} operatingContext={operatingContext} environment="TESTNET">
    <FundSetup productId={product} productRevision={9} actorId={actor} operatingContext={operatingContext} onRefresh={onRefresh} />
  </PortalCommandProvider>
}
const response = (value: FundSetupSnapshot) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const sent = () => wallet.request.mock.calls.filter(([request]) => request.method === 'eth_sendTransaction')
async function connect() {
  const button = await screen.findByRole('button', { name: 'Connect MetaMask on chain 80002' })
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
  await screen.findByText('MetaMask is connected. No signature or transaction has been requested.')
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); onRefresh.mockClear()
  wallet.request.mockReset(); wallet.on.mockClear(); wallet.removeListener.mockClear(); wallet.stop.mockClear()
  wallet.request.mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [sender]
    if (method === 'eth_chainId') return '0x13882'
    throw new Error('Synthetic fixture does not authorise a signature or transaction.')
  })
  preparation.prepare.mockReset(); preparation.validateNonce.mockReset()
  preparation.prepare.mockImplementation(async (_provider: unknown, input: Record<string, unknown>) => ({ nonce: '0x0', transaction: { ...input, chainId: '0x13882', nonce: '0x0' } }))
  preparation.validateNonce.mockResolvedValue('0x0')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })

describe('mounted persistent fund setup handoff', () => {
  it('creates only a saved record, without connecting or submitting MetaMask automatically', async () => {
    const initial = saved(); initial.setup = null
    const fetcher = vi.fn().mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(saved()))
    vi.stubGlobal('fetch', fetcher); render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Create saved blockchain setup' }))
    await screen.findByRole('button', { name: 'Submit this step with MetaMask' })
    const body = JSON.parse(fetcher.mock.calls[1][1].body as string)
    expect(body.command).toBe('CREATE'); expect(body.payload).toEqual({ product_id: product, expected_revision: 9 })
    expect(body.operating_context).toEqual(context)
    expect(fetcher.mock.calls[1][1].headers['x-bx1-expected-actor']).toBe(actor)
    expect(wallet.request).not.toHaveBeenCalled(); expect(preparation.prepare).not.toHaveBeenCalled(); expect(sent()).toEqual([])
  })

  it.each(['actor', 'capacity'] as const)('does not accept a saved record for another %s', async fault => {
    const wrong = saved()
    if (fault === 'actor') wrong.actor_id = id(90)
    else wrong.operating_context = { mode: 'ROLE', organisationId: organisation, role: 'TokenisationAgent' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(wrong))); render(tree())
    await screen.findByText(/saved setup response could not be verified/)
    expect(screen.queryByRole('button', { name: 'Submit this step with MetaMask' })).toBeNull()
    expect(wallet.request).not.toHaveBeenCalled(); expect(sent()).toEqual([])
  })

  it.each(['state', 'hash', 'actor', 'revision'] as const)('never sends after a claim response with the wrong %s', async fault => {
    const claimed = saved('UNKNOWN')
    const step = claimed.setup!.steps[0]
    if (fault === 'state') step.state = 'PREPARED'
    if (fault === 'hash') step.intent_hash = 'cd'.repeat(32)
    if (fault === 'actor') step.actor_id = id(90)
    if (fault === 'revision') step.revision++
    const fetcher = vi.fn().mockResolvedValueOnce(response(saved())).mockResolvedValueOnce(response(claimed)).mockResolvedValueOnce(response(saved('UNKNOWN')))
    vi.stubGlobal('fetch', fetcher); render(tree()); await connect()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I checked the wallet, contract and action.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit this step with MetaMask' }))
    await screen.findByText(/server did not confirm this exact submission lease/)
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).command).toBe('CLAIM_STEP')
    expect(preparation.prepare).toHaveBeenCalledTimes(1); expect(sent()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved progress' }))
    await screen.findByText('Submission outcome is uncertain')
    expect(screen.queryByRole('button', { name: 'Submit this step with MetaMask' })).toBeNull()
    expect(sent()).toEqual([]); expect(onRefresh).not.toHaveBeenCalled()
  })

  it('restores an original UNKNOWN hash for recovery without resending', async () => {
    const originalHash = `0x${'de'.repeat(32)}`
    localStorage.setItem(`bx1:fund-setup:v1:${actor}:${setupId}:${id(100)}`, originalHash)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(saved('UNKNOWN')))); render(tree())
    const input = await screen.findByRole('textbox', { name: 'Original transaction hash' }) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe(originalHash))
    expect(screen.queryByRole('button', { name: 'Submit this step with MetaMask' })).toBeNull()
    expect(wallet.request).not.toHaveBeenCalled(); expect(preparation.prepare).not.toHaveBeenCalled(); expect(sent()).toEqual([])
  })

  it('offers refresh of the same expired unused preparation, never an automatic resend', async () => {
    const expired = saved(); expired.setup!.steps[0].expires_at = '2000-01-01T00:00:00Z'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(expired))); render(tree())
    await screen.findByRole('button', { name: 'Refresh the same preparation' })
    expect(screen.queryByRole('button', { name: 'Submit this step with MetaMask' })).toBeNull()
    expect(wallet.request).not.toHaveBeenCalled(); expect(preparation.prepare).not.toHaveBeenCalled(); expect(sent()).toEqual([])
  })
})
