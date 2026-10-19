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

function retryFixture() {
  const value = saved('UNKNOWN'), setup = value.setup!, template = structuredClone(setup.steps[0]), target = setup.steps[10]
  setup.steps.slice(0, 10).forEach(item => { item.state = 'FINAL' })
  Object.assign(target, template, { id: id(110), step_key: 'trex_version', ordinal: 11, kind: 'CALL', nonce: '12',
    intent: { ...template.intent!, step_key: 'trex_version', kind: 'CALL', nonce: '12', to: second } })
  setup.next_step = 'trex_version'; setup.saved_intent = target.intent
  return value
}
function recoveryReply(value: FundSetupSnapshot, withLease = false, withProof = true) {
  const now = Date.now()
  const target = value.setup!.steps[10]
  return { snapshot: value, lease: withLease ? { id: id(900), setup_id: setupId, step_id: target.id, actor_id: actor,
    operating_context: context, intent_hash: binding, sender, nonce: '12', request_key: id(901), expected_revision: 4,
    expected_step_revision: 3, created_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString() } : null,
  proof: withProof ? { version: 1, chain_id: 80002, checked_at: new Date().toISOString(), status: 'RETRY_AVAILABLE', reason_code: null,
    sender, nonce: '12', intent_hash: binding, anchor: { block_number: '100', block_hash: `0x${binding}` },
    finalized_nonce: { block_number: '100', block_hash: `0x${binding}`, nonce: '12' },
    providers: ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'].map(url => ({ url,
      finalized_block_number: '100', finalized_block_hash: `0x${binding}`, latest_nonce: '12', pending_nonce: '12' })),
    transaction_hash: null, retry_checks: { runtime_hash: target.intent!.expected_runtime_hash, owner: sender, before_version: '0.0.0', simulation_succeeded: true }, winner: null } : null }
}
describe('mounted original Step11 recovery - synthetic responses, no live chain proof', () => {
  it('checks a hashless original without a wallet request or automatic retry', async () => {
    const fixture = retryFixture(), fetcher = vi.fn().mockResolvedValueOnce(response(fixture))
      .mockResolvedValueOnce(Response.json(recoveryReply(fixture)))
    vi.stubGlobal('fetch', fetcher); render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Check transaction and recover' }))
    const retry = await screen.findByRole('button', { name: 'Retry this saved step with MetaMask' })
    expect((retry as HTMLButtonElement).disabled).toBe(true)
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({ action: 'CHECK', setup_id: setupId, step_id: id(110) })
    expect(sent()).toEqual([]); expect(preparation.prepare).not.toHaveBeenCalled()
  })
  it('never sends from a replay response containing a lease but no RETRY_AVAILABLE proof', async () => {
    const fixture = retryFixture(), granted = structuredClone(fixture)
    granted.setup!.revision++; granted.setup!.steps[10].revision++
    const fetcher = vi.fn().mockResolvedValueOnce(response(fixture)).mockResolvedValueOnce(Response.json(recoveryReply(fixture)))
      .mockResolvedValueOnce(Response.json(recoveryReply(granted, true, false)))
    vi.stubGlobal('fetch', fetcher); preparation.prepare.mockResolvedValue({ nonce: '0xc', transaction: { from: sender, to: second, data: fixture.setup!.steps[10].intent!.data, value: '0x0', nonce: '0xc', chainId: '0x13882' } })
    render(tree()); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Check transaction and recover' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I reviewed this same action, wallet and transaction number.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry this saved step with MetaMask' }))
    await screen.findByText(/recovery handoff is no longer current/)
    expect(sent()).toEqual([])
    expect(preparation.prepare).toHaveBeenCalledWith(wallet, expect.objectContaining({ from: sender, to: second }), { retryNonce: '0xc' })
  })
  it.each([4001, 429, -32002])('records wallet outcome %i without resetting the original or automatically resending', async code => {
    const fixture = retryFixture(), granted = structuredClone(fixture)
    granted.setup!.revision++; granted.setup!.steps[10].revision++
    const fetcher = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body))
      if (!body.action) return response(fixture)
      if (body.action === 'CHECK') return Response.json(recoveryReply(fixture))
      if (body.action === 'CLAIM') { const reply = recoveryReply(granted, true); reply.lease!.request_key = body.request_key; return Response.json(reply) }
      if (body.action === 'OUTCOME') return Response.json(recoveryReply(granted, false, false))
      throw new Error('Unlisted fixture request')
    })
    const connectedRequest = wallet.request.getMockImplementation()!
    wallet.request.mockImplementation(async request => request.method === 'eth_sendTransaction' ? Promise.reject({ code }) : connectedRequest(request))
    preparation.prepare.mockResolvedValue({ nonce: '0xc', transaction: { from: sender, to: second, data: fixture.setup!.steps[10].intent!.data, value: '0x0', nonce: '0xc', chainId: '0x13882' } })
    vi.stubGlobal('fetch', fetcher); render(tree()); await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Check transaction and recover' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I reviewed this same action, wallet and transaction number.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry this saved step with MetaMask' }))
    await waitFor(() => expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options.body))).some(body => body.action === 'OUTCOME')).toBe(true))
    const outcome = fetcher.mock.calls.map(([, options]) => JSON.parse(String(options.body))).find(body => body.action === 'OUTCOME')
    expect(outcome.outcome).toBe(code === 4001 ? 'REJECTED' : code === -32002 ? 'PENDING_PROMPT' : 'UNKNOWN')
    expect(sent()).toHaveLength(1)
    expect(granted.setup!.steps[10].state).toBe('UNKNOWN')
  })
  it('retains a late lease-linked candidate after another winner is FINAL without replacing that winner', async () => {
    const fixture = retryFixture(), winner = `0x${'de'.repeat(32)}`, late = `0x${'fa'.repeat(32)}`
    fixture.setup!.steps[10].state = 'FINAL'; fixture.setup!.steps[10].transaction_hash = winner; fixture.setup!.next_step = 'trex_factory'
    localStorage.setItem(`bx1:fund-setup:retry:v1:${actor}:${setupId}:${id(110)}`, JSON.stringify({ lease_id: id(900), transaction_hash: late, request_key: id(902) }))
    const fetcher = vi.fn().mockResolvedValueOnce(response(fixture)).mockResolvedValueOnce(Response.json(recoveryReply(fixture, false, false)))
    vi.stubGlobal('fetch', fetcher); render(tree())
    fireEvent.click(await screen.findByRole('button', { name: 'Retain additional transaction reference' }))
    await screen.findByText('The additional transaction reference is retained. The confirmed result was not replaced.')
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string)).toMatchObject({ action: 'HASH', lease_id: id(900), transaction_hash: late, step_id: id(110) })
    expect(fixture.setup!.steps[10].transaction_hash).toBe(winner); expect(sent()).toEqual([])
  })
})
