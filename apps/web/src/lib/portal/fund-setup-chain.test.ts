import { AbiCoder, Interface, getCreateAddress, keccak256 } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import safeArtifact from './fund-setup-artifacts/Safe-1.4.1.json'
import safeL2Artifact from './fund-setup-artifacts/SafeL2-1.4.1.json'
import factoryArtifact from './fund-setup-artifacts/SafeProxyFactory-1.4.1.json'
import proxyArtifact from './fund-setup-artifacts/SafeProxy-1.4.1.json'
import { canonicalFundCreation, canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, fundSetupArtifactNames, getCanonicalFundArtifact, verifyCanonicalFundCatalog } from './fund-setup-artifacts'
import { buildSetupIntent, FUND_SETUP_STEPS, FUND_SETUP_SAFE_PROXY_RUNTIME, FUND_SETUP_SAFE_PROXY_HASH, FUND_SETUP_SAFE_SINGLETONS,
  buildSafeCreationIntent, FUND_SETUP_SAFE_FACTORY, FUND_SETUP_SAFE_L2, FundSetupChainError, fundSetupHash, observeSetupSafe, observeSetupStep, predictFundSuite, readSetupNonce, type FundSetupAddresses, type FundSetupConfiguration, type FundSetupIntent } from './fund-setup-chain'
import { createFundingRpc, FUNDING_RPC_URLS, FundingVerificationError } from './funding-verifier'
import { fundSetupIntentSchema } from './fund-setup-contracts'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const sender = address(1), txHash = `0x${'ab'.repeat(32)}`, seconds = 1790000000n
const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`, hex = (n: bigint) => `0x${n.toString(16)}`
const block = (n: bigint) => ({ number: hex(n), hash: blockHash(n), timestamp: hex(seconds + n), transactions: [txHash] })
const configuration: FundSetupConfiguration = { safe_address: address(2), identity_management_key: address(3), claim_management_key: address(4),
  token_management_key: address(5), maximum_holding_base_units: '100000', tst_initial_holder: address(6), tst_initial_supply_base_units: '3000000000' }
const dependencies: FundSetupAddresses = Object.fromEntries(FUND_SETUP_STEPS.filter(step => step.kind === 'CREATE').map((step, i) => [step.key, address(100 + i)]))
type Mutation = (url: string, method: string, params: unknown[], value: unknown, count: number) => unknown
const rec = (value: unknown) => value as Record<string, unknown>
function fixture(intent = buildSetupIntent('settlement', configuration, dependencies, sender, '7'), mutate?: Mutation) {
  const receipt = { transactionHash: txHash, blockNumber: '0x64', blockHash: blockHash(100n), transactionIndex: '0x0',
    from: sender, to: intent.to, contractAddress: intent.kind === 'CREATE' ? intent.expected_address : null, status: '0x1', logs: [] }
  const transaction = { hash: txHash, from: sender, to: intent.to, nonce: '0x7', value: '0x0', chainId: '0x13882', input: intent.data,
    blockNumber: '0x64', blockHash: blockHash(100n), transactionIndex: '0x0' }
  const runtime = intent.artifact_name === 'IdFactory' ? canonicalFundRuntime('IdFactory', { _implementationAuthority: dependencies.oid_authority! })
    : intent.artifact_name === 'Bx1FundController' ? canonicalFundRuntime('Bx1FundController', { institutionalAuthority: configuration.safe_address, factory: dependencies.trex_factory! })
      : intent.artifact_name === 'Bx1MaximumHoldingModule' ? canonicalFundRuntime('Bx1MaximumHoldingModule', { maximumHolding: configuration.maximum_holding_base_units }) : canonicalFundRuntime(intent.artifact_name as Parameters<typeof canonicalFundRuntime>[0])
  const counters = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_chainId') value = '0x13882'
    else if (method === 'eth_getBlockByNumber') value = block(params[0] === 'finalized' ? url === FUNDING_RPC_URLS[0] ? 120n : 123n : BigInt(String(params[0])))
    else if (method === 'eth_getTransactionReceipt') value = receipt
    else if (method === 'eth_getTransactionByHash') value = transaction
    else if (method === 'eth_getCode') value = runtime
    else if (method === 'eth_getTransactionCount') value = '0x7'
    else if (method === 'eth_call') value = intent.checks.find(check => check.data === rec(params[0]).data)?.result ?? '0x'
    else if (method === 'eth_getStorageAt') value = intent.checks.find(check => check.storage_slot === BigInt(String(params[1])).toString())?.result ?? '0x'
    else throw new Error('Unexpected read-only fixture method')
    const key = `${url}:${method}:${JSON.stringify(params)}`, count = (counters.get(key) ?? 0) + 1; counters.set(key, count)
    const cloned = structuredClone(value)
    return mutate ? mutate(url, method, params, cloned, count) : cloned
  })
  return { intent, rpc, receipt, transaction, runtime }
}

describe('pinned canonical setup preparation', () => {
  it('verifies exactly 23 original compiler artifacts and all immutable declarations', () => {
    expect(() => verifyCanonicalFundCatalog()).not.toThrow()
    expect(fundSetupArtifactNames).toHaveLength(23)
    expect(FUND_SETUP_CATALOG_HASH).toBe('2b406075473916a22917c3993f9c030ed1365034b482d21afc4c0f0d2ffcc4c2')
    for (const name of fundSetupArtifactNames) expect(Object.isFrozen(getCanonicalFundArtifact(name))).toBe(true)
  })
  it('has 17 creates and 8 configuration calls in actual topological order, without Safe deployment', () => {
    expect(FUND_SETUP_STEPS.filter(step => step.kind === 'CREATE')).toHaveLength(17)
    expect(FUND_SETUP_STEPS.filter(step => step.kind === 'CALL')).toHaveLength(8)
    for (const step of FUND_SETUP_STEPS) for (const dependency of step.depends_on) expect(FUND_SETUP_STEPS.findIndex(item => item.key === dependency)).toBeLessThan(FUND_SETUP_STEPS.indexOf(step))
    expect(FUND_SETUP_STEPS.findIndex(step => step.key === 'trex_version')).toBeLessThan(FUND_SETUP_STEPS.findIndex(step => step.key === 'trex_factory'))
    expect(FUND_SETUP_STEPS.some(step => String(step.key).includes('safe'))).toBe(false)
  })
  it.each(FUND_SETUP_STEPS.map(step => step.key))('prepares canonical ABI-derived %s and fits the shared strict intent contract', key => {
    const intent = buildSetupIntent(key, configuration, dependencies, sender, '7', 'cd'.repeat(32))
    expect(fundSetupIntentSchema.safeParse(intent).success).toBe(true)
    expect(intent.configuration_hash).toBe('cd'.repeat(32))
    expect(intent).not.toHaveProperty('signature')
    if (intent.kind === 'CREATE') {
      expect(intent.to).toBeNull(); expect(intent.expected_address).toBe(getCreateAddress({ from: sender, nonce: 7 }).toLowerCase())
      expect(intent.data.startsWith(getCanonicalFundArtifact(intent.artifact_name as Parameters<typeof getCanonicalFundArtifact>[0]).creation.code)).toBe(true)
    }
  })
  it('patches each exact named immutable word rather than trusting zero-filled templates', () => {
    for (const [name, values] of [['IdFactory', { _implementationAuthority: dependencies.oid_authority! }],
      ['Bx1FundController', { institutionalAuthority: configuration.safe_address, factory: dependencies.trex_factory! }],
      ['Bx1MaximumHoldingModule', { maximumHolding: configuration.maximum_holding_base_units }]] as const) {
      const artifact = getCanonicalFundArtifact(name), patched = canonicalFundRuntime(name, values)
      expect(keccak256(patched)).not.toBe(artifact.runtime_template.keccak256)
      for (const binding of Object.values(artifact.immutable_bindings)) for (const offset of binding.references) {
        const value = values[binding.name as keyof typeof values] as string
        const word = value.startsWith('0x') ? value.slice(2).padStart(64, '0') : BigInt(value).toString(16).padStart(64, '0')
        expect(patched.slice(2 + offset.start * 2, 2 + (offset.start + 32) * 2)).toBe(word)
      }
    }
    expect(() => canonicalFundRuntime('Bx1FundController')).toThrow()
    expect(() => canonicalFundRuntime('Token', { fake: '1' })).toThrow()
  })
  it('never substitutes missing addresses or invalid constructor/policy inputs', () => {
    expect(() => buildSetupIntent('controller', configuration, {}, sender, '7')).toThrow()
    expect(() => buildSetupIntent('settlement', { ...configuration, tst_initial_supply_base_units: '0' }, dependencies, sender, '7')).toThrow()
    expect(() => buildSetupIntent('settlement', configuration, dependencies, sender, (2n ** 64n).toString())).toThrow()
    expect(() => canonicalFundCreation('Bx1TestSettlementToken', [])).toThrow()
    expect(() => buildSetupIntent('fake' as 'settlement', configuration, dependencies, sender, '7')).toThrow()
  })
  it('derives six distinct official CREATE2 suite proxies from exact constructors and salt', () => {
    const terms = { name: 'Synthetic Fund', symbol: 'FUND', decimals: 6, onchain_id: dependencies.token_identity! }
    const predicted = predictFundSuite(dependencies.trex_factory!, 'product-1-revision-1', dependencies.trex_authority!, terms)
    expect(new Set(Object.values(predicted)).size).toBe(6)
    expect(predicted).toEqual(predictFundSuite(dependencies.trex_factory!, 'product-1-revision-1', dependencies.trex_authority!, terms))
    expect(predicted.token).not.toBe(predictFundSuite(dependencies.trex_factory!, 'product-1-revision-2', dependencies.trex_authority!, terms).token)
  })
})

describe('official Safe creation through the same MetaMask chain path', () => {
  const factory = new Interface(factoryArtifact.abi), safe = new Interface(safeArtifact.abi)
  const settings = { owners: [sender, address(9)], threshold: 2, salt_nonce: '42' }
  function preparation(mutate?: Mutation) {
    const base = fixture(), rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
      let value: unknown
      if (method === 'eth_getCode') value = params[0] === FUND_SETUP_SAFE_FACTORY.address ? factoryArtifact.deployedBytecode
        : params[0] === FUND_SETUP_SAFE_L2 ? safeL2Artifact.deployedBytecode : '0x'
      else if (method === 'eth_call') value = factory.encodeFunctionResult('proxyCreationCode', [proxyArtifact.bytecode])
      else value = await base.rpc(url, method, params)
      return mutate ? mutate(url, method, params, value, 1) : value
    })
    return rpc
  }
  it('pins real official factory and SafeL2 bytecode and creates an exact minimal initializer', async () => {
    expect(keccak256(factoryArtifact.deployedBytecode)).toBe(FUND_SETUP_SAFE_FACTORY.runtime_hash)
    expect(keccak256(safeL2Artifact.deployedBytecode)).toBe(FUND_SETUP_SAFE_SINGLETONS[FUND_SETUP_SAFE_L2])
    const rpc = preparation(), intent = await buildSafeCreationIntent(settings, sender, '7', 'ab'.repeat(32), { rpc })
    expect(fundSetupIntentSchema.safeParse(intent).success).toBe(true)
    expect(intent).toMatchObject({ step_key: 'safe_creation', kind: 'CALL', to: FUND_SETUP_SAFE_FACTORY.address, expected_runtime_hash: FUND_SETUP_SAFE_PROXY_HASH })
    const outer = factory.decodeFunctionData('createProxyWithNonce', intent.data), inner = safe.decodeFunctionData('setup', String(outer[1]))
    expect(String(outer[0]).toLowerCase()).toBe(FUND_SETUP_SAFE_L2)
    expect(outer[2]).toBe(42n)
    expect([...inner[0]].map(value => String(value).toLowerCase())).toEqual(settings.owners)
    expect(inner[1]).toBe(2n)
    expect(String(inner[2])).toMatch(/^0x0{40}$/); expect(inner[3]).toBe('0x')
    expect(String(inner[4])).toMatch(/^0x0{40}$/); expect(inner[6]).toBe(0n)
    expect(rpc.mock.calls.every(([, method]) => !/sign|send|broadcast/i.test(method))).toBe(true)
  })
  it.each([{ owners: [sender] }, { owners: [sender, sender] }, { threshold: 1 }, { salt_nonce: '-1' }])('rejects unsafe or fabricated Safe configuration %#', async patch => {
    await expect(buildSafeCreationIntent({ ...settings, ...patch }, sender, '7', undefined, { rpc: preparation() })).rejects.toMatchObject({ status: expect.any(Number) })
  })
  it('does not prepare an occupied address or unverifiable factory', async () => {
    const rpc = preparation((_url, method, params, value) => method === 'eth_getCode' && params[0] !== FUND_SETUP_SAFE_FACTORY.address && params[0] !== FUND_SETUP_SAFE_L2 ? '0x6000' : value)
    await expect(buildSafeCreationIntent(settings, sender, '7', undefined, { rpc })).rejects.toMatchObject({ code: 'SETUP_SAFE_FACTORY_OR_ADDRESS_INVALID' })
  })
  it('proves the exact factory creation event and resulting Safe, not outer receipt success alone', async () => {
    const intent = await buildSafeCreationIntent(settings, sender, '7', undefined, { rpc: preparation() })
    const base = fixture(), event = factory.encodeEventLog(factory.getEvent('ProxyCreation')!, [intent.expected_address, FUND_SETUP_SAFE_L2])
    const receipt = { ...base.receipt, to: intent.to, contractAddress: null, logs: [{ address: intent.to, topics: event.topics, data: event.data, logIndex: '0x4',
      blockNumber: '0x64', blockHash: blockHash(100n), transactionHash: txHash, transactionIndex: '0x0', removed: false }] }
    const transaction = { ...base.transaction, to: intent.to, input: intent.data }
    const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => method === 'eth_getTransactionReceipt' ? structuredClone(receipt)
      : method === 'eth_getTransactionByHash' ? transaction : method === 'eth_getCode' ? params[0] === FUND_SETUP_SAFE_FACTORY.address ? factoryArtifact.deployedBytecode
        : params[0] === FUND_SETUP_SAFE_L2 ? safeL2Artifact.deployedBytecode : FUND_SETUP_SAFE_PROXY_RUNTIME
        : method === 'eth_call' ? intent.checks.find(check => check.data === rec(params[0]).data)!.result : base.rpc(url, method, params))
    expect((await observeSetupStep(intent, txHash, { rpc })).contract_address).toBe(intent.expected_address)
    const missing = vi.fn(async (url: string, method: string, params: unknown[]) => method === 'eth_getTransactionReceipt' ? { ...receipt, logs: [] } : rpc(url, method, params))
    await expect(observeSetupStep(intent, txHash, { rpc: missing })).rejects.toMatchObject({ code: 'SETUP_SAFE_CREATION_EVENT_AMBIGUOUS' })
  })
})

describe('dual-observer original setup transaction', () => {
  it('proves creator, nonce, input, runtime and constructor effects with independent finality', async () => {
    const f = fixture(), result = await observeSetupStep(f.intent, txHash, { rpc: f.rpc, intent_hash: 'ef'.repeat(32) })
    expect(result).toMatchObject({ status: 'FINAL', intent_hash: 'ef'.repeat(32), contract_address: f.intent.expected_address, runtime_hash: f.intent.expected_runtime_hash, block_number: '100' })
    expect(result.providers.map(source => source.finalized_block_number)).toEqual(['120', '123'])
    expect(f.rpc.mock.calls.every(([url, method]) => FUNDING_RPC_URLS.includes(url as typeof FUNDING_RPC_URLS[number]) && !/send|sign|broadcast/i.test(method))).toBe(true)
  })
  it('observes the private IAFactory effect using pinned storage slot 4, not outer success alone', async () => {
    const intent = buildSetupIntent('ia_factory_binding', configuration, dependencies, sender, '7'), f = fixture(intent)
    expect(intent.checks).toContainEqual({ address: dependencies.trex_authority, data: '0x', storage_slot: '4', result: AbiCoder.defaultAbiCoder().encode(['address'], [dependencies.ia_factory]) })
    expect((await observeSetupStep(intent, txHash, { rpc: f.rpc })).status).toBe('FINAL')
    expect(f.rpc).toHaveBeenCalledWith(FUNDING_RPC_URLS[0], 'eth_getStorageAt', [dependencies.trex_authority, '0x4', '0x64'])
  })
  it('keeps original CTR receipt-block and finalized-head checks on both archive observers', async () => {
    const intent = buildSetupIntent('ctr_implementation', configuration, dependencies, sender, '7'), f = fixture(intent)
    const result = await observeSetupStep(intent, txHash, { rpc: f.rpc })
    expect(result.status).toBe('FINAL')
    expect(result.transaction_hash).toBe(txHash)
    expect(result.providers.map(source => source.url)).toEqual(['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2'])
    expect(intent.checks.length).toBeGreaterThan(0)
    for (const [index, url] of FUNDING_RPC_URLS.entries()) {
      expect(f.rpc).toHaveBeenCalledWith(url, 'eth_getCode', [intent.expected_address, '0x64'])
      expect(f.rpc).toHaveBeenCalledWith(url, 'eth_getCode', [intent.expected_address, index === 0 ? '0x78' : '0x7b'])
      for (const check of intent.checks) expect(f.rpc).toHaveBeenCalledWith(url, 'eth_call', [{ to: check.address, data: check.data }, '0x64'])
      expect(f.rpc.mock.calls.filter(([source, method]) => source === url && method === 'eth_getTransactionReceipt')).toHaveLength(2)
    }
    expect(f.rpc.mock.calls.some(([url]) => url === 'https://polygon-amoy-bor-rpc.publicnode.com')).toBe(false)
  })
  it('checks the original IdFactory historical owner and authority on both fixed services without modifying its intent', async () => {
    // Public original identifiers in a synthetic RPC fixture, not hosted proof.
    const owner = '0x27d1b26be9c04f4fd81c5cfd3975dae8b0f806fb', authority = '0xb1753d770545e853f0495734632e516717c25887'
    const originalHash = '0xd1b768d76b45f32df08d1553f5311854bc82a471dac7963ce583b4be4d989c95', height = 50451212n
    const originalBlockHash = '0x4cd32c8f60510e31f20dc92514eadb1f86d53a1b8073f24468c7285b4f93ff49'
    const intent = buildSetupIntent('oid_factory', configuration, { ...dependencies, oid_authority: authority }, owner, '10')
    const saved = structuredClone(intent), runtime = canonicalFundRuntime('IdFactory', { _implementationAuthority: authority })
    const receipt = { transactionHash: originalHash, blockNumber: hex(height), blockHash: originalBlockHash, transactionIndex: '0x0',
      from: owner, to: null, contractAddress: intent.expected_address, status: '0x1', logs: [] }
    const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
      if (method === 'eth_chainId') return '0x13882'
      if (method === 'eth_getBlockByNumber') {
        const number = params[0] === 'finalized' ? height + (url === FUNDING_RPC_URLS[0] ? 20n : 23n) : BigInt(String(params[0]))
        return { number: hex(number), hash: number === height ? originalBlockHash : blockHash(number),
          timestamp: hex(seconds + number - height), transactions: [originalHash] }
      }
      if (method === 'eth_getTransactionReceipt') return structuredClone(receipt)
      if (method === 'eth_getTransactionByHash') return { ...receipt, hash: originalHash, nonce: '0xa', value: '0x0', chainId: '0x13882', input: intent.data }
      if (method === 'eth_getCode') return runtime
      if (method === 'eth_call') return intent.checks.find(check => check.data === rec(params[0]).data)?.result ?? '0x'
      throw new Error('Unexpected synthetic original-factory method')
    })
    expect(hex(height)).toBe('0x301d30c')
    expect(intent.expected_address).toBe('0x11b091c80b8ba5253a32c7c54ef2b1e37a45186e')
    expect(intent.expected_runtime_hash).toBe('0x86d3b73ec9b8a03f0ef25c72aba7e0b65665e20c3e5ea4c67383d0c9a87e42fb')
    expect(intent.checks.map(check => check.data)).toEqual(['0x8da5cb5b', '0x2307f882'])
    expect(intent.checks.map(check => check.result)).toEqual([owner, authority].map(value => AbiCoder.defaultAbiCoder().encode(['address'], [value])))
    expect((await observeSetupStep(intent, originalHash, { rpc })).status).toBe('FINAL')
    for (const [index, url] of FUNDING_RPC_URLS.entries()) {
      expect(rpc).toHaveBeenCalledWith(url, 'eth_getCode', [intent.expected_address, hex(height)])
      expect(rpc).toHaveBeenCalledWith(url, 'eth_getCode', [intent.expected_address, hex(height + (index === 0 ? 20n : 23n))])
      for (const check of intent.checks) expect(rpc).toHaveBeenCalledWith(url, 'eth_call', [{ to: intent.expected_address, data: check.data }, hex(height)])
      expect(rpc.mock.calls.filter(([source, method]) => source === url && method === 'eth_getTransactionReceipt')).toHaveLength(2)
    }
    expect(intent).toEqual(saved)
    expect(rpc.mock.calls.every(([_url, method]) => !/send|sign|broadcast/i.test(method))).toBe(true)
    for (const unavailable of FUNDING_RPC_URLS) {
      const failedRpc = vi.fn(async (url: string, method: string, params: unknown[]) => {
        if (url === unavailable && method === 'eth_call' && rec(params[0]).data === '0x2307f882'
          && params[1] === hex(height)) throw new Error('Historical state unavailable')
        return rpc(url, method, params)
      })
      await expect(observeSetupStep(intent, originalHash, { rpc: failedRpc })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
    }
  })
  it.each(['eth_getCode', 'eth_call'])('does not fall back to one observer or latest state when archive %s is unavailable', async method => {
    const intent = buildSetupIntent('ctr_implementation', configuration, dependencies, sender, '7')
    const f = fixture(intent, (url, requested, params, value) => {
      if (url === 'https://polygon-amoy.g.alchemy.com/v2' && requested === method && params[params.length - 1] === '0x64') throw new Error('Historical state unavailable')
      return value
    })
    await expect(observeSetupStep(intent, txHash, { rpc: f.rpc })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
  })
  it.each(['eth_getTransactionByHash', 'eth_getTransactionReceipt'])('keeps missing %s unknown/pending without a replacement', async methodToRemove => {
    const f = fixture(undefined, (_url, method, _params, value) => method === methodToRemove ? null : value)
    expect((await observeSetupStep(f.intent, txHash, { rpc: f.rpc })).status).toBe(methodToRemove === 'eth_getTransactionByHash' ? 'UNKNOWN' : 'PENDING')
  })
  it('waits when either observer has not finalised the original block', async () => {
    const f = fixture(undefined, (url, method, params, value) => url === FUNDING_RPC_URLS[1] && method === 'eth_getBlockByNumber' && params[0] === 'finalized' ? block(99n) : value)
    expect((await observeSetupStep(f.intent, txHash, { rpc: f.rpc })).status).toBe('PENDING')
  })
  it('records a finalised revert as FAILED, without probing nonexistent deployment effects', async () => {
    const f = fixture(undefined, (_url, method, _params, value) => method === 'eth_getTransactionReceipt' ? { ...rec(value), status: '0x0', contractAddress: null } : value)
    expect((await observeSetupStep(f.intent, txHash, { rpc: f.rpc })).status).toBe('FAILED')
    expect(f.rpc.mock.calls.some(([, method]) => method === 'eth_getCode')).toBe(false)
  })
  it.each([{ from: address(99) }, { nonce: '0x8' }, { input: '0x00' }, { value: '0x1' }, { to: address(99) }, { chainId: '0x1' }])('rejects wrong submitted transaction bindings %#', async patch => {
    const f = fixture(undefined, (_url, method, _params, value) => method === 'eth_getTransactionByHash' ? { ...rec(value), ...patch } : value)
    await expect(observeSetupStep(f.intent, txHash, { rpc: f.rpc })).rejects.toMatchObject({ code: 'SETUP_TRANSACTION_MISMATCH' })
  })
  it.each(['runtime', 'getter', 'created_address', 'provider'])('rejects a different %s rather than fabricating completion', async changed => {
    const f = fixture(undefined, (url, method, _params, value) => changed === 'runtime' && method === 'eth_getCode' ? '0x6000'
      : changed === 'getter' && method === 'eth_call' ? '0x00' : changed === 'created_address' && method === 'eth_getTransactionReceipt' ? { ...rec(value), contractAddress: address(99) }
        : changed === 'provider' && url === FUNDING_RPC_URLS[1] && method === 'eth_getTransactionReceipt' ? { ...rec(value), status: '0x0', contractAddress: null } : value)
    await expect(observeSetupStep(f.intent, txHash, { rpc: f.rpc })).rejects.toMatchObject({ status: expect.any(Number) })
  })
  it('detects changed canonical receipt/block after provider waits', async () => {
    const f = fixture(undefined, (_url, method, params, value, count) => method === 'eth_getBlockByNumber' && params[0] === '0x64' && count === 2 ? { ...rec(value), hash: blockHash(999n) } : value)
    await expect(observeSetupStep(f.intent, txHash, { rpc: f.rpc })).rejects.toMatchObject({ code: 'SETUP_REORG_AFTER_WAIT' })
  })
  it('reads agreeing pending EOA nonces from the two fixed observers without reserving or sending', async () => {
    const f = fixture(); expect(await readSetupNonce(sender, { rpc: f.rpc })).toBe('7')
    expect(f.rpc.mock.calls.filter(([, method]) => method === 'eth_getTransactionCount')).toHaveLength(4)
    const changed = fixture(undefined, (url, method, _params, value) => url === FUNDING_RPC_URLS[1] && method === 'eth_getTransactionCount' ? '0x8' : value)
    await expect(readSetupNonce(sender, { rpc: changed.rpc })).rejects.toMatchObject({ code: 'SETUP_NONCE_OBSERVERS_DISAGREE' })
    const gap = fixture(undefined, (_url, method, params, value) => method === 'eth_getTransactionCount' && params[1] === 'pending' ? '0x8' : value)
    await expect(readSetupNonce(sender, { rpc: gap.rpc })).rejects.toMatchObject({ code: 'SETUP_NONCE_OBSERVERS_DISAGREE' })
  })
})

const safeAbi = new Interface(['function VERSION() view returns(string)', 'function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)', 'function nonce() view returns(uint256)',
  'function getModulesPaginated(address,uint256) view returns(address[] array,address next)', 'function getStorageAt(uint256,uint256) view returns(bytes)'])
function safeFixture(mutate?: Mutation) {
  const singleton = '0x41675c099f32341bf84bfc5382af534df5c7461a', code = safeArtifact.deployedBytecode
  const base = fixture(), rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_getCode') value = params[0] === configuration.safe_address ? FUND_SETUP_SAFE_PROXY_RUNTIME : code
    else if (method === 'eth_call') {
      const call = safeAbi.parseTransaction({ data: String(rec(params[0]).data) })!
      const values = call.name === 'VERSION' ? ['1.4.1'] : call.name === 'getOwners' ? [[sender, address(9)]] : call.name === 'getThreshold' ? [2]
        : call.name === 'nonce' ? [7] : call.name === 'getModulesPaginated' ? [[], '0x0000000000000000000000000000000000000001']
          : [`0x${(BigInt(call.args[0]) === 0n ? singleton.slice(2) : '0'.repeat(40)).padStart(64, '0')}`]
      value = safeAbi.encodeFunctionResult(call.name, values)
    } else value = await base.rpc(url, method, params)
    return mutate ? mutate(url, method, params, value, 1) : value
  })
  return { rpc, singleton, code }
}
describe('actual official Safe 1.4.1 code and structural policy', () => {
  it('uses original official singleton bytecode, no fake runtime/hash fixture', async () => {
    const f = safeFixture()
    expect(keccak256(f.code)).toBe(FUND_SETUP_SAFE_SINGLETONS[f.singleton as keyof typeof FUND_SETUP_SAFE_SINGLETONS])
    expect(keccak256(FUND_SETUP_SAFE_PROXY_RUNTIME)).toBe(FUND_SETUP_SAFE_PROXY_HASH)
    expect(FUND_SETUP_SAFE_PROXY_HASH).toBe('0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c')
    const result = await observeSetupSafe(configuration.safe_address, { rpc: f.rpc })
    expect(result).toMatchObject({ status: 'VERIFIED_CODE_AND_STATE', release_version: '1.4.1', address: configuration.safe_address,
      singleton: { address: f.singleton }, threshold: 2, nonce: '7', modules: [] })
    expect(result).not.toHaveProperty('admitted')
  })
  it.each(['proxy', 'singleton', 'version', 'threshold', 'modules'])('refuses incompatible Safe %s before setup can start', async changed => {
    const f = safeFixture((_url, method, params, value) => {
      if (method === 'eth_getCode' && (changed === 'proxy' && params[0] === configuration.safe_address || changed === 'singleton' && params[0] !== configuration.safe_address)) return '0x6000'
      if (method === 'eth_call') {
        const call = safeAbi.parseTransaction({ data: String(rec(params[0]).data) })!
        if (changed === 'version' && call.name === 'VERSION') return safeAbi.encodeFunctionResult(call.name, ['1.3.0'])
        if (changed === 'threshold' && call.name === 'getThreshold') return safeAbi.encodeFunctionResult(call.name, [1])
        if (changed === 'modules' && call.name === 'getModulesPaginated') return safeAbi.encodeFunctionResult(call.name, [[address(99)], '0x0000000000000000000000000000000000000001'])
      }
      return value
    })
    await expect(observeSetupSafe(configuration.safe_address, { rpc: f.rpc })).rejects.toMatchObject({ status: expect.any(Number) })
  })
  it('sanitizes observer/network failures', async () => {
    const error = await observeSetupSafe(configuration.safe_address, { rpc: async () => { throw new Error('apikey=private') } }).catch(error => error)
    expect(error).toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
    expect(error.message).not.toContain('apikey')
  })
})

describe('closed setup transport diagnostics', () => {
  it.each([
    ['HTTP', 429, null, () => Response.json({ error: 'secret upstream message' }, { status: 429 })],
    ['RPC_ERROR', 200, -32000, () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'secret upstream message' } })],
    ['BODY', 200, null, () => new Response('{secret', { headers: { 'Content-Type': 'application/json' } })],
  ] as const)('logs only closed %s transport fields and keeps the original unavailable mapping', async (stage, httpStatus, rpcCode, response) => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const f = fixture(), transport = createFundingRpc(vi.fn(async () => response()))
      const primary = async (url: string, method: string, params: unknown[]) => method === 'eth_chainId' ? transport(url, method, params) : f.rpc(url, method, params)
      await expect(readSetupNonce(sender, { primary, secondary: f.rpc })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
      expect(logger).toHaveBeenCalledExactlyOnceWith('BX1_SETUP_RPC_FAILURE', { observerIndex: 0, method: 'eth_chainId', stage, httpStatus, rpcCode, requestId: 1 })
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|https|private|params|headers/)
      expect(JSON.stringify(logger.mock.calls)).not.toContain(sender)
    } finally { logger.mockRestore() }
  })
  it('logs a thrown fetch only as FETCH with no raw cause or claimed HTTP/RPC detail', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const f = fixture(), transport = createFundingRpc(vi.fn(async () => { throw new Error('https://private.example/?token=secret') }))
      const secondary = async (url: string, method: string, params: unknown[]) => method === 'eth_chainId' ? transport(url, method, params) : f.rpc(url, method, params)
      const error = await readSetupNonce(sender, { primary: f.rpc, secondary }).catch(error => error)
      expect(error).toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
      expect(logger).toHaveBeenCalledExactlyOnceWith('BX1_SETUP_RPC_FAILURE', { observerIndex: 1, method: 'eth_chainId', stage: 'FETCH', httpStatus: null, rpcCode: null, requestId: 1 })
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(/secret|private|https|token/)
      expect(error).not.toHaveProperty('cause')
    } finally { logger.mockRestore() }
  })
  it.each([
    { stage: 'HTTP', httpStatus: 429, rpcCode: null, requestId: 1, raw: 'secret' },
    { stage: 'UNKNOWN', httpStatus: 429, rpcCode: null, requestId: 1 },
    { stage: 'FETCH', httpStatus: 429, rpcCode: null, requestId: 1 },
    { stage: 'HTTP', httpStatus: 200, rpcCode: -32000, requestId: 1 },
    { stage: 'RPC_ERROR', httpStatus: 200, rpcCode: -31999, requestId: 1 },
    { stage: 'HTTP', httpStatus: 600, rpcCode: null, requestId: 1 },
    { stage: 'HTTP', httpStatus: '429', rpcCode: null, requestId: 1 },
    { stage: 'HTTP', httpStatus: 429, rpcCode: null, requestId: 0 },
  ])('rejects malformed diagnostics at the logging boundary %# without changing the error', async diagnostic => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const error = new FundingVerificationError('RPC_RESPONSE_UNAVAILABLE')
      Object.defineProperty(error, 'diagnostic', { value: diagnostic })
      await expect(readSetupNonce(sender, { rpc: async () => { throw error } })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
      expect(logger).not.toHaveBeenCalled()
    } finally { logger.mockRestore() }
  })
  it('ignores throwing diagnostic access and logging failures', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error('private logger failure') })
    try {
      const malformed = new FundingVerificationError('RPC_RESPONSE_UNAVAILABLE')
      Object.defineProperty(malformed, 'diagnostic', { get: () => { throw new Error('secret diagnostic getter') } })
      await expect(readSetupNonce(sender, { rpc: async () => { throw malformed } })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
      expect(logger).not.toHaveBeenCalled()
      const genuine = new FundingVerificationError('RPC_RESPONSE_UNAVAILABLE', 503, { stage: 'HTTP', httpStatus: 429, rpcCode: null, requestId: 1 })
      await expect(readSetupNonce(sender, { rpc: async () => { throw genuine } })).rejects.toMatchObject({ code: 'SETUP_OBSERVATION_UNAVAILABLE', status: 503 })
      expect(logger).toHaveBeenCalled()
    } finally { logger.mockRestore() }
  })
  it('preserves existing setup errors before inspecting diagnostics and adds nothing on success', async () => {
    const logger = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const original = new FundSetupChainError('SETUP_FINALITY_UNAVAILABLE', 503)
      Object.defineProperty(original, 'diagnostic', { get: () => { throw new Error('must not inspect') } })
      await expect(readSetupNonce(sender, { rpc: async () => { throw original } })).rejects.toBe(original)
      const f = fixture()
      expect(await readSetupNonce(sender, { rpc: f.rpc })).toBe('7')
      expect(logger).not.toHaveBeenCalled()
    } finally { logger.mockRestore() }
  })
})
