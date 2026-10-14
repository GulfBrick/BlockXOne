// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FundRecipient, type RecipientWallet } from './fund-recipient'
import type { FundRecipientSnapshot, FundRecipientIntent } from '@/lib/portal/fund-recipient-contracts'

// Mounted UI with synthetic transport and wallet responses only, not Amoy acceptance.
const mocks = vi.hoisted(() => ({ post: vi.fn(), prepare: vi.fn(), validateNonce: vi.fn(), request: vi.fn() }))
vi.mock('@/lib/portal/fund-setup-client', () => ({ setupPost: mocks.post }))
vi.mock('@/lib/testnet-fund/wallet-transaction', () => ({ prepareAmoyWalletTransaction: mocks.prepare, validateRecoveryNonce: mocks.validateNonce }))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const hash = `0x${'ab'.repeat(32)}`, digest = 'ab'.repeat(32), future = '2099-01-01T00:00:00Z'
const actor = id(1), product = id(2), account = id(3), binding = id(4), operation = id(5)
const context = { mode: 'ROLE' as const, organisationId: id(6), role: 'TokenisationAgent' as const }
let walletCurrent = true
function fixture(isSafe: boolean): FundRecipientSnapshot {
  const intent: FundRecipientIntent = { version: 1, chain_id: 80002, operation_id: operation, operation_revision: 1,
    phase: isSafe ? 'REGISTER_IDENTITY' : 'CREATE_IDENTITY', expectation_hash: digest, catalog_hash: digest,
    sender_address: address(1), sender_nonce: '7', execution_mode: isSafe ? 'SAFE_TRANSACTION' : 'EOA_TRANSACTION',
    to: isSafe ? address(9) : null, value: '0', transaction_data: '0x1234', expected_identity_address: address(8),
    claim_data: '0xab', claim_data_hash: hash, claim_id: hash, safe_transaction: isSafe ? { to: address(10), value: '0', data: '0x1234',
      operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: address(0), refundReceiver: address(0), nonce: '12' } : null,
    safe_transaction_hash: isSafe ? hash : null, safe_owners: [address(1), address(2)], safe_threshold: 2,
    valid_until: future, claim_valid_until: future, expiry_enforced_on_chain: false,
    snapshot: { block: { number: '100', hash, timestamp: '2026-10-15T00:00:00Z' }, providers: [
      { url: 'https://polygon-amoy.drpc.org', finalized_block_number: '100', finalized_block_hash: hash },
      { url: 'https://polygon-amoy-bor-rpc.publicnode.com', finalized_block_number: '100', finalized_block_hash: hash }] } }
  return { schema_version: 1, environment: 'TESTNET', actor_id: actor, operating_context: context, expiry_enforced_on_chain: false,
    case: { id: id(7), revision: 1, product_id: product, offering_revision_id: id(8), manifest_id: id(9), investment_account_id: account,
      delivery_binding_id: binding, holder_user_id: actor, wallet_proof_id: id(10), wallet_address: address(1), eligibility_case_id: id(11),
      eligibility_revision: 1, claim_topic: '1', claim_signer_address: address(2), country_alpha2: 'ZA', country_code: 710,
      product_binding_hash: digest, account_binding_hash: digest, eligibility_binding_hash: digest, claim_valid_until: future,
      identity_address: isSafe ? address(8) : null, state: isSafe ? 'REGISTRATION_REQUIRED' : 'IDENTITY_REQUIRED', pending_signature_id: null,
      claim_signature_id: null, registration_observation_id: null, roleplay_policy_id: null, roleplay_epoch: null,
      created_by: actor, created_context: context, created_at: '2026-10-15T00:00:00Z' },
    operations: [{ id: operation, revision: 1, phase: intent.phase, state: 'PREPARED', actor_id: actor, operating_context: context,
      sender_address: address(1), expires_at: future, transaction_hash: null, intent,
      signatures: isSafe ? [1, 2].map(n => ({ id: id(20 + n), actor_id: actor, signing_address: address(n), status: 'VERIFIED' as const })) : [] }] }
}
function renderCase(snapshot: FundRecipientSnapshot) {
  const provider = { request: mocks.request, on: vi.fn(), removeListener: vi.fn() }
  const wallet: RecipientWallet = { account: address(1), provider, authorizedContext: true,
    begin: () => ({ provider, signal: new AbortController().signal, current: () => walletCurrent }), check: vi.fn().mockResolvedValue(undefined) }
  mocks.post.mockImplementation(async (path: string) => {
    if (path.endsWith('/find')) return { delivery_binding_id: binding, case_id: snapshot.case.id, snapshot }
    const leased = { ...snapshot, operations: [{ ...snapshot.operations[0], revision: 2, state: 'UNKNOWN' }] }
    if (path.endsWith('/claim')) return { snapshot: leased, signed_transaction: { to: address(9), value: '0', data: '0x5678', nonce: '7' } }
    return { snapshot: leased }
  })
  render(<FundRecipient bindingId={binding} productId={product} accountId={account} actorId={actor} operatingContext={context}
    wallet={wallet} renderWalletPicker={() => null} onRefresh={vi.fn()} />)
}
beforeEach(() => { vi.resetAllMocks(); walletCurrent = true; sessionStorage.clear(); localStorage.clear(); mocks.request.mockResolvedValue(hash) })
afterEach(cleanup)
describe('recipient submission boundaries', () => {
  it('does not reserve UNKNOWN after the wallet changes during fee preparation', async () => {
    let finish!: (value: unknown) => void
    mocks.prepare.mockReturnValue(new Promise(resolve => { finish = resolve }))
    renderCase(fixture(false))
    fireEvent.click(await screen.findByLabelText('I checked the wallet, identity and action.'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit this exact wallet step in MetaMask' }))
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
    await act(async () => { walletCurrent = false; finish({ nonce: '0x7' }) })
    await screen.findByText(/No submission lease was requested/)
    expect(mocks.post.mock.calls.some(([path]) => path.endsWith('/claim'))).toBe(false)
    expect(mocks.request).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })
  it('uses the gas payer nonce, not the different Safe nonce, for exact registry submission', async () => {
    mocks.prepare.mockResolvedValue({ nonce: '0x7', transaction: { from: address(1), to: address(9), data: '0x5678', value: '0x0', chainId: '0x13882' } })
    renderCase(fixture(true))
    fireEvent.click(await screen.findByLabelText('I checked the wallet, identity and action.'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit this exact wallet step in MetaMask' }))
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith({ method: 'eth_sendTransaction', params: [expect.objectContaining({ data: '0x5678' })] }))
    expect(mocks.validateNonce).toHaveBeenCalledWith(expect.anything(), address(1), '0x7')
    await screen.findByText(/original transaction hash is recorded/)
  })
})
