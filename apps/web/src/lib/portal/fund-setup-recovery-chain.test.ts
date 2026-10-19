import { Interface } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('./fund-rpc-server', () => ({ createFundServerRpc: vi.fn(() => { throw new Error('No environment fallback permitted in injected source fixtures') }) }))
vi.mock('./fund-setup-chain', async original => {
  const actual = await original<typeof import('./fund-setup-chain')>()
  return { ...actual, observeSetupStep: vi.fn(actual.observeSetupStep) }
})
import { buildSetupIntent, fundSetupHash, observeSetupStep, type FundSetupAddresses, type FundSetupConfiguration } from './fund-setup-chain'
import { canonicalFundRuntime, getCanonicalFundArtifact } from './fund-setup-artifacts'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { fundSetupRecoveryProofSchema } from './fund-setup-recovery-contracts'
import { checkFundSetupRecovery, FundSetupRecoveryChainError } from './fund-setup-recovery-chain'
import { createFundServerRpc } from './fund-rpc-server'
import golden from './fixtures/fund-setup-native-hash-golden.json'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const bh = (n: bigint) => `0x${(n + 1n).toString(16).padStart(64, '0')}`
const hex = (n: bigint) => `0x${n.toString(16)}`
const sender = golden.intent.sender, hash = `0x${'ab'.repeat(32)}`, alternateHash = `0x${'cd'.repeat(32)}`
const configuration: FundSetupConfiguration = golden.configuration
const dependencies: FundSetupAddresses = golden.dependencies
const intent = buildSetupIntent('trex_version', configuration, dependencies, sender, golden.intent.nonce, golden.intent.configuration_hash)
const nativeIntentHash = golden.native_intent_hash
const anchor = { block_number: '10', block_hash: bh(10n) }
const abi = new Interface(getCanonicalFundArtifact('TREXImplementationAuthority').abi)
const implementationKeys = ['token_implementation', 'ctr_implementation', 'ir_implementation', 'irs_implementation', 'tir_implementation', 'mc_implementation'] as const
const artifactNames = ['Token', 'ClaimTopicsRegistry', 'IdentityRegistry', 'IdentityRegistryStorage', 'TrustedIssuersRegistry', 'ModularCompliance'] as const
type Mutate = (url: string, method: string, params: unknown[], result: unknown, count: number) => unknown
type Settings = { consumed?: boolean; landing?: bigint; head?: bigint; latest?: bigint; pending?: bigint; failed?: boolean; transactionHash?: string; mutate?: Mutate }

function fixture(settings: Settings = {}) {
  const landing = settings.landing ?? 40n, head = settings.head ?? 100n
  const latest = settings.latest ?? (settings.consumed ? 13n : 12n), pending = settings.pending ?? latest
  const transactionHash = settings.transactionHash ?? hash
  const transaction = { hash: transactionHash, from: sender, to: intent.to, value: '0x0', input: intent.data, nonce: '0xc', chainId: '0x13882',
    blockNumber: hex(landing), blockHash: bh(landing), transactionIndex: '0x0' }
  const receipt = { transactionHash, from: sender, to: intent.to, blockNumber: hex(landing), blockHash: bh(landing),
    transactionIndex: '0x0', status: settings.failed ? '0x0' : '0x1', contractAddress: null, logs: [] }
  const counters = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let result: unknown
    if (method === 'eth_chainId') result = '0x13882'
    else if (method === 'eth_getBlockByNumber') {
      const n = params[0] === 'finalized' ? head : BigInt(String(params[0]))
      result = { number: hex(n), hash: bh(n), timestamp: hex(1790000000n + n),
        transactions: settings.consumed && n === landing ? params[1] === true ? [transaction] : [transactionHash] : [] }
    } else if (method === 'eth_getTransactionCount') {
      result = params[1] === 'latest' ? hex(latest) : params[1] === 'pending' ? hex(pending)
        : hex(settings.consumed && BigInt(String(params[1])) >= landing ? 13n : 12n)
    } else if (method === 'eth_getCode') {
      const index = implementationKeys.findIndex(key => dependencies[key] === params[0])
      result = index < 0 ? canonicalFundRuntime('TREXImplementationAuthority') : canonicalFundRuntime(artifactNames[index])
    } else if (method === 'eth_call') {
      const request = params[0] as { data: string; from?: string }
      if (request.data === intent.data) result = '0x'
      else {
        const decoded = abi.parseTransaction({ data: request.data })!
        if (decoded.name === 'owner') result = abi.encodeFunctionResult('owner', [sender])
        else if (decoded.name === 'getCurrentVersion') result = abi.encodeFunctionResult('getCurrentVersion', [settings.consumed ? [4, 1, 3] : [0, 0, 0]])
        else if (decoded.name === 'getContracts') result = abi.encodeFunctionResult('getContracts', [Array(6).fill(`0x${'0'.repeat(40)}`)])
        else if (decoded.name === 'isReferenceContract') result = abi.encodeFunctionResult('isReferenceContract', [true])
        else result = intent.checks.find(check => check.data === request.data)?.result ?? '0x'
      }
    } else if (method === 'eth_getTransactionByHash') result = transaction
    else if (method === 'eth_getTransactionReceipt') result = receipt
    else throw new Error('Unlisted source-fixture RPC')
    const key = `${url}:${method}:${JSON.stringify(params)}`, count = (counters.get(key) ?? 0) + 1
    counters.set(key, count)
    return settings.mutate ? settings.mutate(url, method, params, structuredClone(result), count) : structuredClone(result)
  })
  return { rpc, transaction, receipt }
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('bounded original Step11 UNKNOWN recovery observation - source fixtures only', () => {
  it('rebuilds the shared native-hash golden payload without confusing its two fingerprint domains', () => {
    expect(intent).toEqual(golden.intent)
    expect(nativeIntentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(nativeIntentHash).not.toBe(fundSetupHash(intent))
  })
  it.each([undefined, '', `0x${nativeIntentHash}`, nativeIntentHash.toUpperCase(), 'f'.repeat(63), 'g'.repeat(64)])('rejects missing or malformed native identity before observer work: %s', async intent_hash => {
    const f = fixture()
    await expect(checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash })).rejects.toMatchObject({ code: 'RECOVERY_INTENT_HASH_INVALID' })
    expect(f.rpc).not.toHaveBeenCalled()
    expect(createFundServerRpc).not.toHaveBeenCalled()
    expect(observeSetupStep).not.toHaveBeenCalled()
  })
  it('returns a fresh proved same-nonce retry anchor without environment reads or wallet writes', async () => {
    const f = fixture(), result = await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })
    expect(result.status).toBe('RETRY_AVAILABLE')
    expect(result.anchor).toEqual({ block_number: '100', block_hash: bh(100n) })
    expect(result.finalized_nonce).toEqual({ block_number: '100', block_hash: bh(100n), nonce: '12' })
    expect(result.intent_hash).toBe(nativeIntentHash)
    expect(result.retry_checks).toMatchObject({ owner: sender, before_version: '0.0.0', simulation_succeeded: true, runtime_hash: intent.expected_runtime_hash })
    expect(result.providers.map(item => item.url)).toEqual(FUNDING_RPC_URLS)
    expect(fundSetupRecoveryProofSchema.safeParse(result).success).toBe(true)
    expect(createFundServerRpc).not.toHaveBeenCalled()
    expect(f.rpc.mock.calls.some(([, method]) => method.startsWith('eth_send') || method.includes('sign'))).toBe(false)
    const simulations = f.rpc.mock.calls.filter(([, method, params]) => method === 'eth_call' && (params[0] as { data: string }).data === intent.data)
    expect(simulations).toHaveLength(2)
    expect(simulations.every(([, , params]) => (params[0] as Record<string, unknown>).from === sender
      && (params[0] as Record<string, unknown>).value === '0x0' && params[1] === 'latest')).toBe(true)
  })
  it.each([hash, alternateHash])('finds whichever exact original-nonce candidate won (%s), then uses full receipt/effect verification', async transactionHash => {
    const f = fixture({ consumed: true, transactionHash }), result = await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })
    expect(result.status).toBe('WINNER')
    expect(result.transaction_hash).toBe(transactionHash)
    expect(result.intent_hash).toBe(nativeIntentHash)
    expect(observeSetupStep).toHaveBeenCalledWith(intent, transactionHash, { rpc: expect.any(Function), intent_hash: nativeIntentHash })
    expect(result.finalized_nonce).toEqual({ block_number: '100', block_hash: bh(100n), nonce: '13' })
    expect(result.winner).toMatchObject({ block_number: '40', block_hash: bh(40n), nonce: '12', chain_id: 80002, from: sender, data: intent.data })
    expect(f.rpc.mock.calls.filter(([, method]) => method === 'eth_getTransactionReceipt').length).toBeGreaterThanOrEqual(4)
    expect(fundSetupRecoveryProofSchema.safeParse(result).success).toBe(true)
    expect(f.rpc.mock.calls.length).toBeLessThanOrEqual(128)
  })
  it('discovers a matching reverted winner without relabelling it successful or offering another nonce', async () => {
    const f = fixture({ consumed: true, failed: true }), result = await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })
    expect(result).toMatchObject({ status: 'WINNER', reason_code: 'RECOVERY_WINNER_REVERTED', nonce: '12', transaction_hash: hash, intent_hash: nativeIntentHash })
    expect(observeSetupStep).toHaveBeenCalledWith(intent, hash, { rpc: expect.any(Function), intent_hash: nativeIntentHash })
  })
  it('holds only both-provider canonical payload mismatch, preserving the incompatible winner evidence', async () => {
    const f = fixture({ consumed: true, mutate: (_url, method, params, value) => {
      if (method === 'eth_getBlockByNumber' && params[1] === true) return { ...(value as Record<string, unknown>), transactions: [{ ...fixtureTransaction(), input: '0x1234' }] }
      return value
    } })
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'HOLD', reason_code: 'SETUP_RETRY_NONCE_WINNER_MISMATCH', winner: { data: '0x1234' }, intent_hash: nativeIntentHash })
  })
  it('holds agreed finalized external nonce consumption, not absence inferred from a receipt lookup', async () => {
    const f = fixture({ consumed: true, mutate: (_url, method, params, value) => method === 'eth_getBlockByNumber' && params[1] === true
      ? { ...(value as Record<string, unknown>), transactions: [] } : value })
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'HOLD', reason_code: 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION', transaction_hash: null, intent_hash: nativeIntentHash,
      finalized_nonce: { block_number: '100', block_hash: bh(100n), nonce: '13' } })
  })
  it.each([{ latest: 12n, pending: 13n, reason: 'RECOVERY_NONCE_PENDING' }, { latest: 11n, pending: 11n, reason: 'RECOVERY_NONCE_STATE_UNAVAILABLE' }])('never offers a retry from unsafe nonce state %o', async settings => {
    const f = fixture(settings)
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'WAITING', reason_code: settings.reason, intent_hash: nativeIntentHash })
    expect(f.rpc.mock.calls.some(([, method]) => method === 'eth_call')).toBe(false)
  })
  it('waits for finalized consumption instead of retrying a mined but unfinalized original', async () => {
    const f = fixture({ consumed: true, landing: 120n, head: 100n })
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'WAITING', reason_code: 'RECOVERY_NONCE_NOT_FINAL', intent_hash: nativeIntentHash,
      finalized_nonce: { block_number: '100', block_hash: bh(100n), nonce: '12' } })
  })
  it('rejects an anchor after nonce consumption without manufacturing a mismatch hold', async () => {
    const f = fixture({ consumed: true })
    expect(await checkFundSetupRecovery(intent, { block_number: '50', block_hash: bh(50n) }, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'WAITING', reason_code: 'RECOVERY_ANCHOR_NOT_BRACKETED' })
  })
  it('bounds historical span without scanning or requesting an explorer', async () => {
    const f = fixture({ consumed: true, head: 262155n })
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'WAITING', reason_code: 'RECOVERY_SEARCH_BOUND_EXCEEDED' })
    expect(f.rpc.mock.calls.length).toBeLessThan(20)
  })
  it('finds a boundary across the maximum accepted span within the fixed RPC budget', async () => {
    const f = fixture({ consumed: true, head: 262154n, landing: 200000n })
    expect((await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).status).toBe('WINNER')
    expect(f.rpc.mock.calls.length).toBeLessThanOrEqual(128)
  })
  it.each(['nonce', 'block', 'transaction'])('provider %s disagreement cannot produce a retry or recovery hold', async kind => {
    const f = fixture({ consumed: true, mutate: (url, method, params, value) => {
      if (url !== FUNDING_RPC_URLS[1]) return value
      if (kind === 'nonce' && method === 'eth_getTransactionCount') return '0xe'
      if (kind === 'block' && method === 'eth_getBlockByNumber') return { ...(value as Record<string, unknown>), hash: alternateHash }
      if (kind === 'transaction' && method === 'eth_getBlockByNumber' && params[1] === true) return { ...(value as Record<string, unknown>), transactions: [{ ...fixtureTransaction(), input: '0x1234' }] }
      return value
    } })
    await expect(checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).rejects.toMatchObject({ code: expect.stringMatching(/^RECOVERY_/) })
  })
  it('rejects a boundary reorganisation before recording a hold or candidate', async () => {
    const f = fixture({ consumed: true, mutate: (_url, method, params, value, count) => method === 'eth_getBlockByNumber' && params[0] === '0x28' && params[1] === false && count > 0
      ? { ...(value as Record<string, unknown>), hash: alternateHash } : value })
    await expect(checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).rejects.toMatchObject({ code: 'RECOVERY_CANONICAL_BLOCK_CHANGED' })
  })
  it.each(['owner', 'runtime', 'installed', 'simulation', 'dependency'])('rejects changed %s without a lease proof', async kind => {
    const f = fixture({ mutate: (_url, method, params, value) => {
      const data = method === 'eth_call' ? (params[0] as { data: string }).data : ''
      if (kind === 'owner' && data === abi.encodeFunctionData('owner')) return abi.encodeFunctionResult('owner', [address(99)])
      if (kind === 'installed' && data === abi.encodeFunctionData('getContracts', [[4, 1, 3]])) return abi.encodeFunctionResult('getContracts', [implementationKeys.map(key => dependencies[key])])
      if (kind === 'simulation' && data === intent.data) throw new Error('RPC simulation unavailable - raw text must not escape')
      if (kind === 'runtime' && method === 'eth_getCode' && params[0] === intent.to || kind === 'dependency' && method === 'eth_getCode' && params[0] === dependencies.token_implementation) return '0x00'
      return value
    } })
    await expect(checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).rejects.toBeInstanceOf(FundSetupRecoveryChainError)
  })
  it('does not infer FINAL from matching effects when a receipt is missing', async () => {
    const f = fixture({ consumed: true, mutate: (_url, method, _params, value) => method === 'eth_getTransactionReceipt' ? null : value })
    expect(await checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).toMatchObject({ status: 'WAITING', reason_code: 'RECOVERY_WINNER_NOT_FINAL', transaction_hash: null })
  })
  it('rejects another step, modified calldata/checks or incorrect runtime before RPC work', async () => {
    const f = fixture()
    for (const changed of [{ ...intent, step_key: 'trex_factory' as const }, { ...intent, data: `${intent.data}00` },
      { ...intent, checks: [] }, { ...intent, expected_runtime_hash: alternateHash }, { ...intent, chain_id: 1 as 80002 }]) {
      await expect(checkFundSetupRecovery(changed, anchor, { rpc: f.rpc, intent_hash: nativeIntentHash })).rejects.toMatchObject({ code: 'RECOVERY_INTENT_INVALID' })
    }
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('enforces the total deadline even for an injected observer that never responds', async () => {
    vi.useFakeTimers()
    const task = checkFundSetupRecovery(intent, anchor, { rpc: vi.fn(() => new Promise<never>(() => {})), intent_hash: nativeIntentHash })
    const rejected = expect(task).rejects.toMatchObject({ code: 'RECOVERY_DEADLINE_EXCEEDED' })
    await vi.advanceTimersByTimeAsync(90000)
    await rejected
  })
  it('cannot issue a retry proof when current reads consume more than the freshness window', async () => {
    let now = 1790000000000
    const f = fixture({ mutate: (_url, method, _params, value) => { if (method === 'eth_call') now += 2000; return value } })
    await expect(checkFundSetupRecovery(intent, anchor, { rpc: f.rpc, now: () => now, intent_hash: nativeIntentHash })).rejects.toMatchObject({ code: 'RECOVERY_PREFLIGHT_STALE' })
  })
})

function fixtureTransaction() {
  return { hash, from: sender, to: intent.to, value: '0x0', input: intent.data, nonce: '0xc', chainId: '0x13882',
    blockNumber: '0x28', blockHash: bh(40n), transactionIndex: '0x0' }
}
