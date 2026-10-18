// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Interface, TypedDataEncoder, Wallet } from 'ethers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn(), prepare: vi.fn(), validate: vi.fn(), check: vi.fn(), request: vi.fn(), error: vi.fn(), wallet: {} as Record<string, unknown> }))
vi.mock('@/lib/portal/fund-setup-client', () => ({ setupPost: mocks.post }))
vi.mock('@/lib/testnet-fund/wallet-transaction', () => ({
  prepareAmoyWalletTransaction: mocks.prepare, validateRecoveryNonce: mocks.validate, walletErrorMessage: mocks.error,
}))
vi.mock('./fund-lifecycle', () => ({
  useFundWallet: () => mocks.wallet,
  WalletPicker: () => <div aria-label="Synthetic MetaMask account picker" />,
}))

import { FundAuthorityAlignment } from './fund-authority-alignment'
import { fundAuthoritySafeTypes, type FundAuthorityAlignmentResponse } from '@/lib/portal/fund-authority-alignment-contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const actor = id(1), setupId = id(5), requestId = id(40), operationId = id(41), claimKey = id(42)
const context = { mode: 'ROLE' as const, organisationId: id(2), role: 'TokenisationAgent' as const }
const walletA = new Wallet(`0x${'11'.repeat(32)}`), walletB = new Wallet(`0x${'22'.repeat(32)}`)
const ownerA = walletA.address.toLowerCase(), ownerB = walletB.address.toLowerCase(), owners = [ownerA, ownerB].sort()
const controller = `0x${'70'.repeat(20)}`, safe = `0x${'72'.repeat(20)}`, factory = `0x${'71'.repeat(20)}`
const reasonHash = hash(50), txHash = hash(51), digest = 'ab'.repeat(32), intentDigest = 'cd'.repeat(32)
const future = '2100-01-01T00:00:00Z', observed = '2026-10-19T00:00:00Z'
const controllerInterface = new Interface(['function advanceAuthorityEpoch(uint256 nextEpoch,bytes32 reasonHash)'])
const safeInterface = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)'])
const safeTransaction = { to: controller, value: '0' as const, data: controllerInterface.encodeFunctionData('advanceAuthorityEpoch', [2, reasonHash]).toLowerCase(), operation: 0 as const,
  safeTxGas: '0' as const, baseGas: '0' as const, gasPrice: '0' as const,
  gasToken: `0x${'00'.repeat(20)}`, refundReceiver: `0x${'00'.repeat(20)}`, nonce: '8' }
const intent = { version: 1 as const, chain_id: 80002 as const, admission_request_id: requestId, native_binding_hash: digest,
  reason_hash: reasonHash, previous_epoch: 1, target_epoch: 2, controller_address: controller,
  controller_runtime_hash: hash(52), factory_address: factory, safe_address: safe, safe_owners: owners,
  safe_threshold: 2, executor_address: ownerA, executor_nonce: '12', safe_transaction: safeTransaction,
  safe_transaction_hash: TypedDataEncoder.hash({ chainId: 80002, verifyingContract: safe }, fundAuthoritySafeTypes, safeTransaction).toLowerCase(),
  snapshot: { block: { number: '100', hash: hash(100), timestamp: observed }, providers: [
    { url: 'https://80002.rpc.thirdweb.com' as const, finalized_block_number: '101', finalized_block_hash: hash(101) },
    { url: 'https://polygon-amoy.gateway.tenderly.co' as const, finalized_block_number: '102', finalized_block_hash: hash(102) },
  ] }, valid_until: future }
const execution = { chain_id: 80002 as const, from: ownerA, to: safe, value: '0' as const,
  data: safeInterface.encodeFunctionData('execTransaction', [safeTransaction.to, 0, safeTransaction.data, 0, 0, 0, 0,
    safeTransaction.gasToken, safeTransaction.refundReceiver, `0x${'11'.repeat(130)}`]).toLowerCase(), nonce: '12' }

function operation(state: 'PREPARED' | 'SIGNING' | 'UNKNOWN' | 'BROADCAST', revision: number, signing: string[], transactionHash: string | null = null) {
  const claimed = state === 'UNKNOWN' || state === 'BROADCAST'
  return { id: operationId, revision, state, intent, intent_hash: intentDigest, executor_nonce: '12', transaction_hash: transactionHash,
    claimed_at: claimed ? observed : null, claim_key: claimed ? claimKey : null, signing_addresses: signing }
}
function response(op: ReturnType<typeof operation> | null, executionValue: typeof execution | null = null): FundAuthorityAlignmentResponse {
  return { actor_id: actor, operating_context: context, setup_id: setupId, setup_revision: 100,
    admission_request_id: requestId, native_binding_hash: digest, reason_hash: reasonHash,
    previous_epoch: 1, target_epoch: 2, already_aligned: false, operation: op, execution: executionValue }
}
const onAligned = vi.fn()
function view() {
  return <FundAuthorityAlignment setupId={setupId} revision={100} actorId={actor} operatingContext={context} onAligned={onAligned} />
}
async function reviewAndClick(name: string) {
  const checkbox = await screen.findByRole('checkbox', { name: 'I reviewed the controller, authority change and signing wallets.' }) as HTMLInputElement
  await waitFor(() => expect(checkbox.disabled).toBe(false))
  fireEvent.click(checkbox)
  const button = screen.getByRole('button', { name }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); onAligned.mockReset()
  const provider = { request: mocks.request }
  Object.assign(mocks.wallet, {
    account: ownerA, provider, authorizedContext: true,
    begin: () => { const account = mocks.wallet.account; return { provider, current: () => mocks.wallet.account === account } },
    check: mocks.check,
  })
  mocks.check.mockResolvedValue(undefined); mocks.validate.mockResolvedValue('0xc')
  mocks.prepare.mockResolvedValue({ nonce: '0xc', transaction: { from: ownerA, to: safe, data: execution.data, value: '0x0', chainId: '0x13882', nonce: '0xc' } })
  mocks.error.mockImplementation((error: unknown) => error instanceof Error ? error.message : 'The wallet request was unavailable.')
  mocks.request.mockImplementation(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_signTypedData_v4') {
      const signer = String(params?.[0]).toLowerCase(), value = JSON.parse(String(params?.[1]))
      const wallet = signer === ownerA ? walletA : signer === ownerB ? walletB : null
      if (!wallet) throw new Error('Unknown synthetic signing owner.')
      return wallet.signTypedData(value.domain, { SafeTx: value.types.SafeTx }, value.message)
    }
    if (method === 'eth_sendTransaction') return txHash
    throw new Error(`Unexpected wallet method ${method}`)
  })
})
afterEach(() => { cleanup(); sessionStorage.clear() })

describe('mounted fund authority alignment handoff', () => {
  it('collects two exact owner signatures and obtains the claim before the sole explicit wallet send', async () => {
    const events: string[] = []
    mocks.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      events.push(`post:${body.action}`)
      if (body.action === 'READ') return response(null)
      if (body.action === 'PREPARE') return response(operation('PREPARED', 1, []))
      if (body.action === 'SIGN') {
        const signed = String(body.signing_address)
        return response(operation('SIGNING', signed === ownerA ? 2 : 3, signed === ownerA ? [ownerA] : owners))
      }
      if (body.action === 'CLAIM') return response({ ...operation('UNKNOWN', 4, owners), claim_key: String(body.request_key) }, execution)
      if (body.action === 'HASH') return response(operation('BROADCAST', 5, owners, txHash))
      throw new Error(`Unexpected action ${body.action}`)
    })
    mocks.request.mockImplementation(async request => {
      if (request.method === 'eth_sendTransaction') events.push('wallet:send')
      const signer = String(request.params?.[0]).toLowerCase()
      if (request.method === 'eth_signTypedData_v4') {
        const value = JSON.parse(String(request.params?.[1])), wallet = signer === ownerA ? walletA : walletB
        return wallet.signTypedData(value.domain, { SafeTx: value.types.SafeTx }, value.message)
      }
      if (request.method === 'eth_sendTransaction') return txHash
      throw new Error(`Unexpected wallet method ${request.method}`)
    })
    const mounted = render(view())
    fireEvent.click(screen.getByRole('button', { name: 'Check signing setup' }))
    await screen.findByText(/record both wallet signatures/)
    expect(mocks.request).not.toHaveBeenCalled()

    await reviewAndClick('Sign this authority change in MetaMask')
    await screen.findByText(/Wallet signature saved/)
    expect(events.filter(value => value === 'wallet:send')).toEqual([])

    mocks.wallet.account = ownerB; mounted.rerender(view())
    await reviewAndClick('Sign this authority change in MetaMask')
    await screen.findByText(/Switch to/)
    expect(events.filter(value => value === 'wallet:send')).toEqual([])

    mocks.wallet.account = ownerA; mounted.rerender(view())
    await reviewAndClick('Submit this authority change with MetaMask')
    await screen.findByText(/Transaction reference saved/)
    expect(events.filter(value => value === 'wallet:send')).toHaveLength(1)
    expect(events.indexOf('post:CLAIM')).toBeGreaterThan(events.indexOf('post:SIGN'))
    expect(events.indexOf('post:CLAIM')).toBeLessThan(events.indexOf('wallet:send'))
    expect(events).toEqual(['post:READ', 'post:PREPARE', 'post:SIGN', 'post:SIGN', 'post:CLAIM', 'wallet:send', 'post:HASH'])
    expect(mocks.validate).toHaveBeenCalledWith(expect.anything(), ownerA, '0xc')
    expect(onAligned).not.toHaveBeenCalled()
  })

  it('stops after a wallet change while the claim is pending and never sends', async () => {
    let finish!: (value: unknown) => void
    mocks.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.action === 'READ') return response(operation('SIGNING', 3, owners))
      if (body.action === 'CLAIM') return new Promise(resolve => { finish = resolve })
      throw new Error(`Unexpected action ${body.action}`)
    })
    const mounted = render(view())
    fireEvent.click(screen.getByRole('button', { name: 'Check signing setup' }))
    await screen.findByText(/Switch to/)
    await reviewAndClick('Submit this authority change with MetaMask')
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CLAIM' }), expect.anything(), expect.anything(), expect.anything()))
    mocks.wallet.account = ownerB; mounted.rerender(view())
    await act(async () => { finish(response(operation('UNKNOWN', 4, owners), execution)); await Promise.resolve() })
    expect(await screen.findByText('The original submission must be checked. Do not submit it again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check saved submission state' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit this authority change with MetaMask' })).toBeNull()
    expect(mocks.request.mock.calls.filter(([value]) => value.method === 'eth_sendTransaction')).toEqual([])
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('invalidates a deferred claim on the render that changes operating context, before effects or any send/hash write', async () => {
    let finish!: (value: unknown) => void
    mocks.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.action === 'READ') return response(operation('SIGNING', 3, owners))
      if (body.action === 'CLAIM') return new Promise(resolve => { finish = resolve })
      throw new Error(`Unexpected action ${body.action}`)
    })
    const mounted = render(view())
    fireEvent.click(screen.getByRole('button', { name: 'Check signing setup' }))
    await screen.findByText(/Switch to/)
    await reviewAndClick('Submit this authority change with MetaMask')
    await waitFor(() => expect(mocks.post.mock.calls.some(([, body]) => body.action === 'CLAIM')).toBe(true))
    const changedContext = { ...context, role: 'OfferingManager' as const }
    mounted.rerender(<FundAuthorityAlignment setupId={setupId} revision={100} actorId={actor}
      operatingContext={changedContext} onAligned={onAligned} />)
    await act(async () => { finish(response(operation('UNKNOWN', 4, owners), execution)); await Promise.resolve() })
    expect(mocks.request.mock.calls.filter(([value]) => value.method === 'eth_sendTransaction')).toEqual([])
    expect(mocks.post.mock.calls.map(([, body]) => body.action)).toEqual(['READ', 'CLAIM'])
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('restores an UNKNOWN original on remount as recovery-only and never prepares, claims or sends again', async () => {
    mocks.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      if (body.action === 'READ') return response(operation('UNKNOWN', 4, owners))
      if (body.action === 'VERIFY') return response(operation('UNKNOWN', 4, owners))
      throw new Error(`Unexpected action ${body.action}`)
    })
    render(view()); fireEvent.click(screen.getByRole('button', { name: 'Check signing setup' }))
    await screen.findByText('The original submission must be checked. Do not submit it again.')
    expect(screen.queryByRole('button', { name: 'Submit this authority change with MetaMask' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check original confirmation' }))
    await screen.findByText(/not yet final/)
    expect(mocks.post.mock.calls.map(([, body]) => body.action)).toEqual(['READ', 'VERIFY'])
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('rejects a response for another actor without exposing a signing or send action', async () => {
    mocks.post.mockResolvedValue({ ...response(operation('PREPARED', 1, [])), actor_id: id(999) })
    render(view()); fireEvent.click(screen.getByRole('button', { name: 'Check signing setup' }))
    await screen.findByText(/another account or fund/)
    expect(screen.queryByRole('button', { name: 'Sign this authority change in MetaMask' })).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
