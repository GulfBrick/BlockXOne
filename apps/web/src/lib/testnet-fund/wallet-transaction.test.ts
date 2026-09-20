import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRecoverLegacyDeployment, classifyWalletSubmissionError, prepareAmoyWalletTransaction, validateRecoveryNonce, walletErrorMessage, type AmoyWalletProvider } from './wallet-transaction'

const wallet = `0x${'ab'.repeat(20)}`
const otherWallet = `0x${'cd'.repeat(20)}`
const input = { from: wallet, data: '0x60806040', value: '0x0' }
const hex = (value: bigint) => `0x${value.toString(16)}`
const minimumTip = 'transaction gas price below minimum: gas tip cap 15000000000, minimum needed 25000000000'
type ResponseOverride = unknown | ((params?: unknown[]) => unknown)

function fakeProvider(overrides: Record<string, ResponseOverride> = {}) {
  const defaults: Record<string, unknown> = {
    eth_chainId: '0x13882',
    eth_getBlockByNumber: { baseFeePerGas: hex(2_000_000_000n) },
    eth_maxPriorityFeePerGas: hex(15_000_000_000n),
    eth_estimateGas: hex(428_996n),
    eth_getBalance: hex(100_000_000_000_000_000n),
    eth_getTransactionCount: '0x0',
  }
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
    const value = Object.hasOwn(overrides, method) ? overrides[method] : defaults[method]
    if (value instanceof Error) throw value
    if (typeof value === 'function') return value(params)
    if (value === undefined) throw new Error(`Unexpected request: ${method}`)
    return value
  })
  return { request } satisfies AmoyWalletProvider
}

afterEach(() => { vi.useRealTimers() })

describe('read-only Amoy wallet transaction preparation', () => {
  it('raises the rejected 15 Gwei tip to 30 Gwei and provides capped cost before signing', async () => {
    const provider = fakeProvider()
    const result = await prepareAmoyWalletTransaction(provider, input)
    expect(result.transaction).toEqual({ ...input, chainId: '0x13882', nonce: '0x0', gas: hex(514_796n), maxPriorityFeePerGas: hex(30_000_000_000n), maxFeePerGas: hex(60_000_000_000n) })
    expect(result.summary).toEqual({ estimatedGas: '428996', gasLimit: '514796', priorityFeeGwei: '30', maxFeePerGasGwei: '60', maximumCostPol: '0.03088776', balancePol: '0.1' })
    expect(result.nonce).toBe('0x0')
    expect(provider.request.mock.calls.some(([args]) => args.method.startsWith('eth_send') || args.method.includes('sign'))).toBe(false)
  })

  it('keeps an above-floor provider tip and doubles a high base fee', async () => {
    const result = await prepareAmoyWalletTransaction(fakeProvider({ eth_getBlockByNumber: { baseFeePerGas: hex(50_000_000_000n) }, eth_maxPriorityFeePerGas: hex(40_000_000_000n) }), input)
    expect(result.transaction.maxPriorityFeePerGas).toBe(hex(40_000_000_000n))
    expect(result.transaction.maxFeePerGas).toBe(hex(140_000_000_000n))
  })

  it('estimates the exact zero-value creation payload with no destination', async () => {
    const provider = fakeProvider()
    await prepareAmoyWalletTransaction(provider, input)
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_estimateGas', params: [input] })
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_getBalance', params: [wallet, 'pending'] })
  })

  it('estimates the exact existing-token call and ignores extraneous caller fee and nonce fields', async () => {
    const provider = fakeProvider()
    const exact = { ...input, to: otherWallet }
    const result = await prepareAmoyWalletTransaction(provider, { ...exact, gasPrice: '0x1', nonce: '0x99', gas: '0x1' } as typeof exact)
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_estimateGas', params: [exact] })
    expect(result.transaction).not.toHaveProperty('gasPrice')
    expect(result.nonce).toBe('0x0')
  })

  it('keeps gas, fee, cost and nonce arithmetic exact beyond Number.MAX_SAFE_INTEGER', async () => {
    const estimate = 9_007_199_254_740_993n
    const base = 9_007_199_254_740_999n
    const nonce = 9_007_199_254_741_111n
    const result = await prepareAmoyWalletTransaction(fakeProvider({ eth_estimateGas: hex(estimate), eth_getBlockByNumber: { baseFeePerGas: hex(base) }, eth_getBalance: hex(1n << 220n), eth_getTransactionCount: hex(nonce) }), input)
    expect(result.transaction.gas).toBe(hex((estimate * 120n + 99n) / 100n))
    expect(result.transaction.maxFeePerGas).toBe(hex(base * 2n + 30_000_000_000n))
    expect(result.transaction.nonce).toBe(hex(nonce))
    expect(result.summary.estimatedGas).toBe('9007199254740993')
  })

  it('does not mutate the authoritative input', async () => {
    const frozen = Object.freeze({ ...input })
    await prepareAmoyWalletTransaction(fakeProvider(), frozen)
    expect(frozen).toEqual(input)
  })

  it('uses the 30 Gwei floor when the optional priority-fee method is unsupported', async () => {
    const result = await prepareAmoyWalletTransaction(fakeProvider({ eth_maxPriorityFeePerGas: new Error('Method not supported') }), input)
    expect(result.summary.priorityFeeGwei).toBe('30')
  })

  it('bounds the optional priority-fee wait and falls back without sending', async () => {
    vi.useFakeTimers()
    const provider = fakeProvider({ eth_maxPriorityFeePerGas: () => new Promise(() => {}) })
    const prepared = prepareAmoyWalletTransaction(provider, input)
    await vi.advanceTimersByTimeAsync(4_000)
    expect((await prepared).summary.priorityFeeGwei).toBe('30')
    expect(provider.request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false)
  })

  it('does not send or continue when contract simulation fails', async () => {
    const provider = fakeProvider({ eth_estimateGas: new Error('execution reverted: AmoyOnly') })
    await expect(prepareAmoyWalletTransaction(provider, input)).rejects.toThrow('execution reverted')
    expect(provider.request.mock.calls.some(([args]) => args.method === 'eth_sendTransaction')).toBe(false)
  })

  it('rejects a balance that covers expected gas but not the maximum fee cap', async () => {
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getBalance: hex(20_000_000_000_000_000n) }), input)).rejects.toThrow('0.03088776 POL required; wallet has 0.02 POL')
  })

  it('accepts the exact maximum-cost balance without floating-point rounding', async () => {
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getBalance: hex(514_796n * 60_000_000_000n) }), input)).resolves.toHaveProperty('nonce', '0x0')
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getBalance: hex(514_796n * 60_000_000_000n - 1n) }), input)).rejects.toThrow('Insufficient Amoy test POL')
  })

  it.each(['0x1', '0x89'])('rejects chain %s before reading fees or estimating', async chain => {
    const provider = fakeProvider({ eth_chainId: chain })
    await expect(prepareAmoyWalletTransaction(provider, input)).rejects.toThrow('Select Polygon Amoy')
    expect(provider.request).toHaveBeenCalledTimes(1)
  })

  it.each([
    { eth_getBlockByNumber: {} },
    { eth_getBlockByNumber: { baseFeePerGas: '-1' } },
    { eth_estimateGas: '0x0' },
    { eth_estimateGas: '0x0001' },
    { eth_getBalance: '1000000000000000000' },
  ])('fails closed on malformed required RPC data %j', async override => {
    await expect(prepareAmoyWalletTransaction(fakeProvider(override), input)).rejects.toThrow()
  })

  it('rejects a fee or gas quantity that overflows the supported EVM quantity range', async () => {
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getBlockByNumber: { baseFeePerGas: hex((1n << 256n) - 1n) } }), input)).rejects.toThrow('unsupported gas or fee')
  })

  it.each([
    { from: '0xnot-an-address' }, { to: '0xnot-an-address' }, { data: '0x123' }, { data: '0x' }, { value: '0x1' },
  ])('rejects invalid or value-transferring input %j without provider calls', async changed => {
    const provider = fakeProvider()
    await expect(prepareAmoyWalletTransaction(provider, { ...input, ...changed })).rejects.toThrow()
    expect(provider.request).not.toHaveBeenCalled()
  })

  it.each([['0x0', '0x1'], ['0x3', '0x2']])('refuses confirmed/pending nonce mismatch %s/%s instead of choosing another nonce', async (latest, pending) => {
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getTransactionCount: (params?: unknown[]) => params?.[1] === 'latest' ? latest : pending }), input)).rejects.toThrow('pending transaction or nonce gap')
  })

  it('uses the saved nonce for a retry and refuses it once the chain has advanced', async () => {
    const result = await prepareAmoyWalletTransaction(fakeProvider({ eth_getTransactionCount: '0x2' }), input, { retryNonce: '0x2' })
    expect(result.transaction.nonce).toBe('0x2')
    await expect(prepareAmoyWalletTransaction(fakeProvider({ eth_getTransactionCount: '0x3' }), input, { retryNonce: '0x2' })).rejects.toThrow('saved transaction nonce has already changed')
  })
})

describe('same-nonce deployment recovery', () => {
  const legacy = { kind: 'deployment', walletAddress: wallet, currentWalletAddress: wallet, latestNonce: '0x0', pendingNonce: '0x0' }

  it('allows only an original-wallet no-hash nonce-zero legacy deployment', () => {
    expect(canRecoverLegacyDeployment(legacy)).toBe(true)
    expect(canRecoverLegacyDeployment({ ...legacy, currentWalletAddress: `0x${'AB'.repeat(20)}` })).toBe(true)
  })

  it.each([
    { kind: 'MINT' }, { kind: 'BURN' }, { txHash: `0x${'11'.repeat(32)}` }, { txHash: '' },
    { currentWalletAddress: otherWallet }, { walletAddress: '' }, { latestNonce: '0x1' }, { pendingNonce: '0x1' }, { pendingNonce: 'unknown' },
  ])('never authorizes legacy recovery with %j', changed => expect(canRecoverLegacyDeployment({ ...legacy, ...changed })).toBe(false))

  it('returns explicit nonce zero for a legacy check and never sends or clears storage', async () => {
    const provider = fakeProvider()
    expect(await validateRecoveryNonce(provider, wallet)).toBe('0x0')
    expect(provider.request.mock.calls.map(([args]) => args.method)).toEqual(['eth_chainId', 'eth_getTransactionCount', 'eth_getTransactionCount'])
  })

  it('validates a known saved nonce but rejects either changed count', async () => {
    expect(await validateRecoveryNonce(fakeProvider({ eth_getTransactionCount: '0x7' }), wallet, '0x7')).toBe('0x7')
    await expect(validateRecoveryNonce(fakeProvider({ eth_getTransactionCount: '0x7' }), wallet)).rejects.toThrow('recovery remains locked')
    await expect(validateRecoveryNonce(fakeProvider({ eth_getTransactionCount: (params?: unknown[]) => params?.[1] === 'latest' ? '0x0' : '0x1' }), wallet)).rejects.toThrow('recovery remains locked')
  })

  it('does not consider absent receipts evidence of a safe retry', async () => {
    const provider = fakeProvider({ eth_getTransactionReceipt: null, eth_getTransactionCount: '0x1' })
    await expect(validateRecoveryNonce(provider, wallet)).rejects.toThrow('recovery remains locked')
    expect(provider.request.mock.calls.some(([args]) => args.method === 'eth_getTransactionReceipt')).toBe(false)
  })

  it('rejects recovery on a different chain or malformed saved nonce', async () => {
    await expect(validateRecoveryNonce(fakeProvider({ eth_chainId: '0x1' }), wallet)).rejects.toThrow('Select Polygon Amoy')
    await expect(validateRecoveryNonce(fakeProvider(), wallet, '0')).rejects.toThrow('Invalid saved nonce')
  })
})

describe('narrow submission-error classification', () => {
  it.each([
    { code: 4001, message: 'User rejected the request.' },
    { code: -32603, data: { originalError: { code: 4001 } } },
  ])('recognizes explicit user cancellation %j', error => expect(classifyWalletSubmissionError(error)).toBe('rejected'))

  it.each([
    { message: minimumTip },
    { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { code: -32000, message: minimumTip } } },
    { error: { message: `eth_sendRawTransaction: ${minimumTip}` } },
    { message: 'insufficient funds for gas * price + value' },
    { data: { message: 'insufficient funds for gas * price + value: balance 1, tx cost 2, overshot 1' } },
  ])('recognizes a specific pre-broadcast RPC rejection %j', error => expect(classifyWalletSubmissionError(error)).toBe('not_broadcast'))

  it.each([
    { code: -32000, message: 'transaction underpriced' },
    { message: 'execution reverted' }, { message: 'Failed to fetch' }, { message: 'timeout' },
    { message: `Timed out after an earlier failure: ${minimumTip}` },
    { message: 'insufficient funds' }, { code: '4001' }, {}, null, 'Interaction failed',
  ])('keeps an ambiguous error unknown: %j', error => expect(classifyWalletSubmissionError(error)).toBe('unknown'))

  it('requires verification whenever a response includes a transaction hash', () => {
    expect(classifyWalletSubmissionError({ message: minimumTip, data: { transactionHash: `0x${'22'.repeat(32)}` } })).toBe('unknown')
    expect(classifyWalletSubmissionError({ code: 4001, hash: `0x${'22'.repeat(32)}` })).toBe('unknown')
  })

  it('handles circular error wrappers without losing the nested concrete rejection', () => {
    const error: { data?: unknown; message: string } = { message: minimumTip }
    error.data = error
    expect(classifyWalletSubmissionError(error)).toBe('not_broadcast')
  })

  it('extracts a readable nested message without serializing data', () => {
    expect(walletErrorMessage({ message: 'Internal JSON-RPC error.', data: { originalError: { message: minimumTip }, privateData: 'never print' } })).toBe(minimumTip)
    expect(walletErrorMessage(new Error('A normal error with 0123456789 and u follows\nnext line'))).toBe('A normal error with 0123456789 and u follows next line')
    expect(walletErrorMessage({ message: 'x'.repeat(1_000) })).toHaveLength(400)
    expect(walletErrorMessage({})).toContain('do not send again')
  })
})
