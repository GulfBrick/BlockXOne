import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DemoFund, DemoSnapshot } from '@/lib/testnet-fund/contracts'
import { prepareAmoyWalletTransaction } from '@/lib/testnet-fund/wallet-transaction'
import { canRecoverRejectedDemoDeployment, readPendingDemoTransaction, recoverRejectedDemoDeployment, submitRecordedDemoTransaction, TestnetFundDemo } from './testnet-fund-demo'

const wallet = '0x1111111111111111111111111111111111111111'
const otherWallet = '0x2222222222222222222222222222222222222222'
const hash = `0x${'ab'.repeat(32)}`
const key = 'bx1-demo:test:user:chain:fund:deployment'
const fund: DemoFund = {
  id: 'fund', organisation_id: 'org', name: 'Synthetic fund', status: 'DRAFT', chain_id: 80002, currency: 'ZAR_TEST', cash_decimals: 2, unit_decimals: 0,
  unit_price_minor: '10000', cap_units: '10000', contract_address: null, contract_owner: null, deployment_transaction_hash: null,
  issued_units: '0', reserved_subscription_units: '0', reserved_redemption_units: '0', synthetic_cash_minor: '0', subscriptions: [], redemptions: [], operations: [], holdings: [], distributions: [], journal: [],
}
const transaction = { from: wallet, data: '0x60016001', value: '0x0', chainId: '0x13882', nonce: '0x0', gas: '0x7daee', maxFeePerGas: '0xdf8475800', maxPriorityFeePerGas: '0x6fc23ac00' }
const feeError = { code: -32603, message: 'Internal JSON-RPC error.', data: { code: -32000, message: 'transaction gas price below minimum: gas tip cap 15000000000, minimum needed 25000000000' } }

function fixture(saved?: unknown) {
  const values = new Map<string, string>()
  if (saved !== undefined) values.set(key, JSON.stringify(saved))
  const storage = { getItem: vi.fn((name: string) => values.get(name) ?? null), setItem: vi.fn((name: string, value: string) => { values.set(name, value) }) }
  const chain = { id: '0x13882', accounts: [wallet], latest: '0x0', pending: '0x0' }
  const send = vi.fn(async (): Promise<unknown> => hash)
  const provider = { request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
    if (method === 'eth_chainId') return chain.id
    if (method === 'eth_accounts') return chain.accounts
    if (method === 'eth_getTransactionCount') return params?.[1] === 'latest' ? chain.latest : chain.pending
    if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x3b9aca00' }
    if (method === 'eth_maxPriorityFeePerGas') return '0x37e11d600'
    if (method === 'eth_estimateGas') return '0x68bc4'
    if (method === 'eth_getBalance') return '0x16345785d8a0000'
    if (method === 'eth_sendTransaction') return send()
    throw new Error(`Unexpected mock RPC method: ${method}`)
  }) }
  const refresh = vi.fn(async (): Promise<DemoSnapshot> => ({ funds: [{ ...fund }] }))
  const confirm = vi.fn((_message: string) => true)
  const recover = () => recoverRejectedDemoDeployment({ provider, storage, key, fundId: fund.id, currentWallet: wallet, refresh, confirm })
  const stored = () => readPendingDemoTransaction(storage, key)
  return { storage, values, provider, send, chain, refresh, confirm, recover, stored }
}

describe('persisted demo wallet submission', () => {
  it('persists nonce, exact intent and ambiguity before dispatch and retains the returned hash', async () => {
    const f = fixture()
    f.send.mockImplementation(async () => {
      expect(f.stored()).toMatchObject({ nonce: '0x0', wallet, unknown: true, intent: { data: transaction.data } })
      return hash
    })
    expect(await submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).toBe(hash)
    expect(f.stored()).toMatchObject({ nonce: '0x0', wallet, hash, unknown: false })
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, f.storage.getItem(key))).rejects.toThrow('Verify it')
    expect(f.send).toHaveBeenCalledOnce()
  })

  it.each([feeError, { code: 4001, message: 'User rejected the request.' }, { message: 'insufficient funds for gas * price + value' }])('retains the original nonce after a definitive rejection: %j', async error => {
    const f = fixture(); f.send.mockRejectedValueOnce(error)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('No new nonce will be used')
    expect(f.stored()).toMatchObject({ wallet, nonce: '0x0', unknown: false, retryable: true })
    expect(f.stored()?.hash).toBeUndefined()
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, { ...transaction, nonce: '0x1' }, f.storage.getItem(key))).rejects.toThrow('Verify it')
    expect(f.send).toHaveBeenCalledOnce()
  })

  it('exposes the nested minimum-fee failure instead of replacing it with a generic unknown message', async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(feeError)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('gas tip cap 15000000000, minimum needed 25000000000')
  })

  it.each([new Error('RPC timeout'), { code: -32000, message: 'already known' }, { code: 4001, transactionHash: hash, message: 'Rejected after returning a hash' }])('keeps unknown outcomes locked and never retries them: %j', async error => {
    const f = fixture(); f.send.mockRejectedValueOnce(error)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('Submission remains locked')
    const retained = f.storage.getItem(key)
    expect(f.stored()).toMatchObject({ nonce: '0x0', unknown: true })
    expect(f.stored()?.retryable).not.toBe(true)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, retained)).rejects.toThrow('Verify it')
    expect(f.storage.getItem(key)).toBe(retained)
    expect(f.send).toHaveBeenCalledOnce()
  })

  it('locks a send that returns no transaction hash', async () => {
    const f = fixture(); f.send.mockResolvedValueOnce(undefined)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('did not return a transaction hash')
    expect(f.stored()).toMatchObject({ nonce: '0x0', unknown: true })
  })

  it('does not dispatch if the nonce record cannot be written', async () => {
    const f = fixture(); f.storage.setItem.mockImplementationOnce(() => { throw new Error('Storage unavailable') })
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('Storage unavailable')
    expect(f.send).not.toHaveBeenCalled()
  })

  it('retains the lock and gives the hash if storage fails after broadcast', async () => {
    const f = fixture()
    f.storage.setItem.mockImplementationOnce((name, value) => { f.values.set(name, value) }).mockImplementationOnce(() => { throw new Error('Storage full') })
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow(`Transaction submitted: ${hash}`)
    expect(f.stored()).toMatchObject({ nonce: '0x0', unknown: true })
    expect(f.send).toHaveBeenCalledOnce()
  })

  it('does not overwrite an attempt recorded during fee preparation', async () => {
    const f = fixture({ wallet, hash, nonce: '0x0' })
    const retained = f.storage.getItem(key)
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, null)).rejects.toThrow('saved submission changed')
    expect(f.storage.getItem(key)).toBe(retained); expect(f.send).not.toHaveBeenCalled()
  })

  it('locks a changed payload even when the original rejected nonce is reused', async () => {
    const f = fixture({ wallet, nonce: '0x0', retryable: true, intent: { data: '0x60026002' } })
    await expect(submitRecordedDemoTransaction(f.provider, f.storage, key, transaction, f.storage.getItem(key))).rejects.toThrow('payload changed')
    expect(f.send).not.toHaveBeenCalled()
  })
})

describe('legacy minimum-fee deployment recovery', () => {
  it('refreshes the unbound draft, checks nonce zero and records a reviewed retry without sending', async () => {
    const f = fixture({ wallet, unknown: true })
    expect(await f.recover()).toBe(true)
    expect(f.refresh).toHaveBeenCalledOnce(); expect(f.confirm).toHaveBeenCalledOnce()
    expect(f.confirm.mock.calls[0]?.[0]).toContain('15 Gwei sent; 25 Gwei minimum')
    expect(f.stored()).toEqual({ schemaVersion: 2, wallet, nonce: '0x0', unknown: false, retryable: true })
    expect(f.send).not.toHaveBeenCalled()
    expect(f.provider.request.mock.calls.filter(([request]) => request.method === 'eth_getTransactionCount')).toHaveLength(4)
  })

  it('integrates recovered nonce zero with fresh 30-Gwei preparation and explicit submission', async () => {
    const f = fixture({ wallet, unknown: true }); await f.recover()
    const prepared = await prepareAmoyWalletTransaction(f.provider, transaction, { retryNonce: f.stored()?.nonce })
    expect(prepared.transaction.nonce).toBe('0x0')
    expect(BigInt(prepared.transaction.maxPriorityFeePerGas)).toBeGreaterThanOrEqual(30_000_000_000n)
    expect(prepared.summary.maximumCostPol).not.toBe('0')
    expect(f.send).not.toHaveBeenCalled()
    await submitRecordedDemoTransaction(f.provider, f.storage, key, prepared.transaction, f.storage.getItem(key))
    expect(f.send).toHaveBeenCalledOnce(); expect(f.stored()?.hash).toBe(hash)
  })

  it('leaves the original lock untouched when the user does not confirm the exact Activity failure', async () => {
    const f = fixture({ wallet, unknown: true }); f.confirm.mockReturnValue(false)
    const retained = f.storage.getItem(key)
    expect(await f.recover()).toBe(false)
    expect(f.storage.getItem(key)).toBe(retained); expect(f.send).not.toHaveBeenCalled()
  })

  it.each([{ contract_address: otherWallet }, { deployment_transaction_hash: hash }, { status: 'OPEN' as const }])('does not unlock a saved fund whose backend state changed: %j', async change => {
    const f = fixture({ wallet, unknown: true }); f.refresh.mockResolvedValue({ funds: [{ ...fund, ...change }] })
    const retained = f.storage.getItem(key)
    await expect(f.recover()).rejects.toThrow('no longer an unbound draft')
    expect(f.storage.getItem(key)).toBe(retained); expect(f.confirm).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })

  it.each(['account', 'chain', 'latest', 'pending'] as const)('fails closed before confirmation on mismatched %s', async changed => {
    const f = fixture({ wallet, unknown: true })
    if (changed === 'account') f.chain.accounts = [otherWallet]
    else if (changed === 'chain') f.chain.id = '0x1'
    else f.chain[changed] = '0x1'
    const retained = f.storage.getItem(key)
    await expect(f.recover()).rejects.toThrow()
    expect(f.storage.getItem(key)).toBe(retained); expect(f.confirm).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })

  it.each(['account', 'chain', 'latest', 'pending'] as const)('rechecks %s after the human recovery review', async changed => {
    const f = fixture({ wallet, unknown: true })
    f.confirm.mockImplementation(() => {
      if (changed === 'account') f.chain.accounts = [otherWallet]
      else if (changed === 'chain') f.chain.id = '0x1'
      else f.chain[changed] = '0x1'
      return true
    })
    const retained = f.storage.getItem(key)
    await expect(f.recover()).rejects.toThrow()
    expect(f.storage.getItem(key)).toBe(retained); expect(f.send).not.toHaveBeenCalled()
  })

  it.each([{ wallet, hash, unknown: true }, { wallet, nonce: '0x0', unknown: true }, { wallet: otherWallet, unknown: true }, { wallet, retryable: true, nonce: '0x0' }])('does not repurpose the legacy recovery path for other submission states: %j', async saved => {
    const f = fixture(saved); const retained = f.storage.getItem(key)
    await expect(f.recover()).rejects.toThrow('Only the original presenter')
    expect(f.storage.getItem(key)).toBe(retained); expect(f.refresh).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })

  it('does not overwrite a hash saved by another tab during the recovery review', async () => {
    const f = fixture({ wallet, unknown: true })
    f.confirm.mockImplementation(() => { f.storage.setItem(key, JSON.stringify({ wallet, hash })); return true })
    await expect(f.recover()).rejects.toThrow('saved submission changed')
    expect(f.stored()?.hash).toBe(hash); expect(f.send).not.toHaveBeenCalled()
  })

  it('fails closed on malformed saved storage instead of treating it as a fresh transaction', () => {
    const f = fixture(); f.values.set(key, '{broken')
    expect(f.stored()).toEqual({ wallet: '', unknown: true })
    expect(canRecoverRejectedDemoDeployment(f.stored())).toBe(false)
  })

  it('renders the demo without automatically connecting, recovering or sending', () => {
    const html = renderToStaticMarkup(<TestnetFundDemo initial={{ funds: [fund] }} workspace={{ user: { id: 'user', email: 'synthetic@example.invalid', platformUserId: 'user', displayName: null }, organisations: [{ id: 'org', name: 'Synthetic org', roles: ['Investor'] }] }} artifactAvailable chainReady />)
    expect(html).toContain('Deploy fund token with MetaMask')
    expect(html).toContain('Verify existing transaction')
    expect(html).not.toContain('Recover rejected deployment')
    expect(html).not.toContain('Transaction submitted')
  })
})
