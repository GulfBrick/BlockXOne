import { Interface, Wallet } from 'ethers'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('./fund-rpc-server', () => ({ createFundServerRpc: vi.fn(() => { throw new Error('Injected alignment fixtures must not read provider credentials') }) }))
import { canonicalAdmissionFixture, testAddress, testBlock, testHash, testId, type FundFixtureMutation } from './fund-chain-test-fixtures'
import { FUNDING_RPC_URLS } from './funding-verifier'
import { fundSetupHash } from './fund-setup-chain'
import { getCanonicalFundArtifact, getOfficialSafeArtifact } from './fund-setup-artifacts'
import { fundAuthorityAlignmentObservationSchema, fundAuthoritySafeTypes, type FundAuthorityAlignmentIntent,
  type FundAuthorityAlignmentRead, type FundAuthoritySignature } from './fund-authority-alignment-contracts'
import { buildSignedFundAuthorityAlignmentTransaction, discoverFundAuthorityAlignment, FundAuthorityAlignmentChainError,
  observeFundAuthorityAlignment, prepareFundAuthorityAlignment, verifyFundAuthorityAlignmentSignature } from './fund-authority-alignment-chain'
import { createFundServerRpc } from './fund-rpc-server'

// Ephemeral fixture-only owners. These are not platform accounts, provider evidence or EVM execution.
const owners = [Wallet.createRandom(), Wallet.createRandom()]
const SAFE = new Interface(getOfficialSafeArtifact('Safe').abi), CONTROLLER = new Interface(getCanonicalFundArtifact('Bx1FundController').abi)
const transactionHash = testHash(800), hex = (n: bigint) => `0x${n.toString(16)}`
type Settings = { mutate?: FundFixtureMutation; epoch?: number; head?: bigint }
function fixture(settings: Settings = {}) {
  const source = canonicalAdmissionFixture({ owners: owners.map(owner => owner.address.toLowerCase()) })
  const policy = { policy_id: testId(900), epoch: 2, expires_at: '2100-01-01T00:00:00Z', label: 'TEST ROLE PLAY - one operator; not independent human approval' as const }
  source.input.authority_epoch = 2
  source.input.setup.roleplay_policy = policy
  const read: FundAuthorityAlignmentRead = { schema_version: 1, environment: 'TESTNET', actor_id: source.input.setup.actor_id,
    operating_context: source.input.setup.operating_context, admission_request_id: testId(901), setup_id: source.input.setup.setup!.id,
    setup_revision: source.input.setup.setup!.revision, input_hash: 'ef'.repeat(32), native_binding_hash: 'de'.repeat(32), reason_hash: testHash(902),
    authority_expires_at: new Date(Date.now() + 60000).toISOString(), authorisation_receipt_id: testId(903), input: source.input,
    operation: { id: testId(904), revision: 1, state: 'NEW', intent: null, intent_hash: null, signatures: [], executor_nonce: null,
      transaction_hash: null, claimed_at: null, claim_key: null, observation: null } }
  let completed = false, outerReverted = false, innerFailed = false, receipt: Record<string, unknown> | null = null, tx: Record<string, unknown> | null = null
  let head = settings.head ?? 120n
  const landing = 150n, counters = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'finalized' ? head + (url === FUNDING_RPC_URLS[1] ? 3n : 0n) : BigInt(String(params[0]))
      value = { ...testBlock(number), transactions: completed && number === landing ? params[1] === true ? [tx] : [transactionHash] : [] }
    } else if (method === 'eth_getTransactionCount') {
      value = params[1] === 'latest' || params[1] === 'pending' ? completed ? '0x1b' : '0x1a'
        : completed && BigInt(String(params[1])) >= landing ? '0x1b' : '0x1a'
    } else if (method === 'eth_getTransactionByHash') value = tx
    else if (method === 'eth_getTransactionReceipt') value = receipt
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: string }, abi = call.to === source.config.safe_address ? SAFE
        : call.to === source.dependencies.controller ? CONTROLLER : null
      const parsed = abi?.parseTransaction({ data: call.data })
      if (parsed?.name === 'authorityEpoch') value = CONTROLLER.encodeFunctionResult('authorityEpoch', [settings.epoch ?? (completed && !outerReverted && !innerFailed ? 2 : 1)])
      else if (parsed?.name === 'nonce') value = SAFE.encodeFunctionResult('nonce', [completed && !outerReverted ? 1 : 0])
      else value = await source.rpc(url, method, params)
    } else value = await source.rpc(url, method, params)
    const key = `${url}:${method}:${JSON.stringify(params)}`, count = (counters.get(key) ?? 0) + 1
    counters.set(key, count)
    return settings.mutate ? settings.mutate(url, method, params, structuredClone(value), count) : structuredClone(value)
  })
  function saved(intent: FundAuthorityAlignmentIntent, state: 'PREPARED' | 'SIGNING' | 'UNKNOWN' = 'PREPARED', signatures: FundAuthoritySignature[] = []) {
    read.operation = { ...read.operation!, revision: 2, state, intent, intent_hash: 'fa'.repeat(32), signatures, executor_nonce: intent.executor_nonce,
      claimed_at: state === 'UNKNOWN' ? new Date().toISOString() : null, claim_key: state === 'UNKNOWN' ? testId(905) : null }
  }
  function event(abi: Interface, name: string, address: string, args: unknown[], index: number) {
    const encoded = abi.encodeEventLog(abi.getEvent(name)!, args)
    return { address, topics: encoded.topics, data: encoded.data, removed: false, transactionHash,
      blockNumber: hex(landing), blockHash: testHash(Number(landing)), transactionIndex: '0x0', logIndex: hex(BigInt(index)) }
  }
  async function signatures(intent: FundAuthorityAlignmentIntent) {
    return Promise.all(owners.map(async owner => ({ signer: owner.address.toLowerCase(), signature: (await owner.signTypedData(
      { chainId: 80002, verifyingContract: intent.safe_address }, fundAuthoritySafeTypes, intent.safe_transaction)).toLowerCase() })))
  }
  function execute(intent: FundAuthorityAlignmentIntent, signed: FundAuthoritySignature[], options: { reverted?: boolean; innerFailed?: boolean } = {}) {
    completed = true; head = 220n; outerReverted = options.reverted === true; innerFailed = options.innerFailed === true
    const execution = buildSignedFundAuthorityAlignmentTransaction(intent, signed)
    tx = { hash: transactionHash, from: execution.from, to: execution.to, value: '0x0', input: execution.data,
      nonce: hex(BigInt(execution.nonce)), chainId: '0x13882', blockNumber: hex(landing), blockHash: testHash(Number(landing)), transactionIndex: '0x0' }
    receipt = { transactionHash, from: execution.from, to: execution.to, blockNumber: hex(landing), blockHash: testHash(Number(landing)),
      transactionIndex: '0x0', status: outerReverted ? '0x0' : '0x1', contractAddress: null, logs: outerReverted ? [] : [
        event(SAFE, innerFailed ? 'ExecutionFailure' : 'ExecutionSuccess', intent.safe_address, [intent.safe_transaction_hash, 0], 0),
        ...(innerFailed ? [] : [event(CONTROLLER, 'AuthorityEpochAdvanced', intent.controller_address, [intent.previous_epoch, intent.target_epoch, intent.reason_hash], 1)]),
      ] }
    return { tx, receipt }
  }
  return { read, rpc, source, saved, signatures, execute, setHead: (value: bigint) => { head = value } }
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('one preadmission Safe authority alignment - synthetic RPC/signature fixtures only', () => {
  it('binds the original native identity to the exact one-step Safe intent and both independent nonces', async () => {
    const f = fixture(), history = structuredClone(f.read.input.setup.setup!.steps)
    const result = await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc }), intent = result.intent!
    expect(result.already_aligned).toBe(false)
    expect(intent).toMatchObject({ native_binding_hash: f.read.native_binding_hash, reason_hash: f.read.reason_hash,
      previous_epoch: 1, target_epoch: 2, executor_nonce: '26', safe_transaction: { nonce: '0', value: '0', operation: 0 } })
    const call = CONTROLLER.decodeFunctionData('advanceAuthorityEpoch', intent.safe_transaction.data)
    expect(String(call[0])).toBe('2'); expect(call[1]).toBe(f.read.reason_hash)
    expect(intent.native_binding_hash).not.toBe(fundSetupHash(intent))
    expect(f.read.input.setup.setup!.steps).toEqual(history)
    expect(createFundServerRpc).not.toHaveBeenCalled()
    expect(f.rpc.mock.calls.every(([url, method]) => FUNDING_RPC_URLS.includes(url as typeof FUNDING_RPC_URLS[number]) && !method.startsWith('eth_send'))).toBe(true)
  })
  it('freshly rechecks but preserves an existing prepared intent and its original snapshot', async () => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!
    f.saved(intent, 'SIGNING'); f.setHead(130n); f.rpc.mockClear()
    expect((await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent).toEqual(intent)
    expect(f.rpc.mock.calls.some(([, method]) => method === 'eth_getTransactionCount')).toBe(true)
  })
  it('reports already aligned without manufacturing a FINAL operation', async () => {
    const f = fixture({ epoch: 2 })
    expect(await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).toEqual({ already_aligned: true, intent: null })
    expect(f.read.operation?.state).toBe('NEW')
  })
  it('never replaces an uncertain attempt with a getter-only no-op or another preparation', async () => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!
    f.saved(intent, 'UNKNOWN'); f.rpc.mockClear()
    await expect(prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).rejects.toMatchObject({ code: 'ALIGNMENT_ORIGINAL_EXECUTION_REQUIRED' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each([0, 3])('rejects unsupported observed epoch %i', async epoch => {
    const f = fixture({ epoch })
    await expect(prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).rejects.toBeInstanceOf(FundAuthorityAlignmentChainError)
  })
  it.each(['expired', 'actor', 'context', 'input', 'incomplete'] as const)('rejects %s native context before provider work', async kind => {
    const f = fixture()
    if (kind === 'expired') f.read.authority_expires_at = '2000-01-01T00:00:00Z'
    if (kind === 'actor') f.read.actor_id = testId(999)
    if (kind === 'context') f.read.operating_context = { mode: 'APPLICANT' }
    if (kind === 'input') (f.read.input as unknown as Record<string, unknown>).extra = true
    if (kind === 'incomplete') f.read.input.setup.setup!.steps[0].state = 'UNKNOWN'
    await expect(prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).rejects.toBeInstanceOf(FundAuthorityAlignmentChainError)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each(['runtime', 'institution', 'factory', 'paused', 'safe-owner', 'safe-module', 'provider'] as const)('rejects changed %s governance', async kind => {
    const f = fixture({ mutate: (url, method, params, value) => {
      const call = method === 'eth_call' ? params[0] as { to: string; data: string } : null
      if (kind === 'runtime' && method === 'eth_getCode' && params[0] === f.source.dependencies.controller) return '0x00'
      if (call?.to === f.source.dependencies.controller) {
        const name = CONTROLLER.parseTransaction({ data: call.data })?.name
        if (kind === 'institution' && name === 'institutionalAuthority') return CONTROLLER.encodeFunctionResult(name, [testAddress(99)])
        if (kind === 'factory' && name === 'factory') return CONTROLLER.encodeFunctionResult(name, [testAddress(99)])
        if (kind === 'paused' && name === 'paused') return CONTROLLER.encodeFunctionResult(name, [true])
        if (kind === 'provider' && name === 'authorityEpoch' && url === FUNDING_RPC_URLS[1]) return CONTROLLER.encodeFunctionResult(name, [2])
      }
      if (call?.to === f.source.config.safe_address) {
        const name = SAFE.parseTransaction({ data: call.data })?.name
        if (kind === 'safe-owner' && name === 'getOwners') return SAFE.encodeFunctionResult(name, [[testAddress(98), testAddress(99)]])
        if (kind === 'safe-module' && name === 'getModulesPaginated') return SAFE.encodeFunctionResult(name, [[testAddress(99)], testAddress(1)])
      }
      return value
    } })
    await expect(prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).rejects.toBeInstanceOf(FundAuthorityAlignmentChainError)
  })
  it('denies changed executor nonce rather than refreshing a signed operation into a new intent', async () => {
    let changed = false
    const f = fixture({ mutate: (_url, method, params, value) => changed && method === 'eth_getTransactionCount' && ['latest', 'pending'].includes(String(params[1])) ? '0x1b' : value })
    const intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!
    f.saved(intent); changed = true
    await expect(prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).rejects.toMatchObject({ code: 'ALIGNMENT_SAVED_NONCE_CHANGED' })
    expect(f.read.operation?.intent).toEqual(intent)
  })
  it('recovers two distinct owners and deterministically packs only the exact Safe request', async () => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    const execution = buildSignedFundAuthorityAlignmentTransaction(intent, [...signatures].reverse())
    expect(execution).toMatchObject({ chain_id: 80002, from: intent.executor_address, to: intent.safe_address, value: '0', nonce: '26' })
    const decoded = SAFE.decodeFunctionData('execTransaction', execution.data)
    expect(decoded[0].toLowerCase()).toBe(intent.controller_address); expect(decoded[2]).toBe(intent.safe_transaction.data)
    expect(decoded[9]).toBe(`0x${signatures.sort((a, b) => a.signer.localeCompare(b.signer)).map(item => item.signature.slice(2)).join('')}`)
    expect(() => buildSignedFundAuthorityAlignmentTransaction(intent, signatures.slice(0, 1))).toThrow()
    expect(() => buildSignedFundAuthorityAlignmentTransaction(intent, [signatures[0], signatures[0]])).toThrow()
    expect(() => verifyFundAuthorityAlignmentSignature(intent, testAddress(99), signatures[0].signature)).toThrow()
    const high = `0x${signatures[0].signature.slice(2, 66)}${'f'.repeat(64)}1b`
    expect(() => verifyFundAuthorityAlignmentSignature(intent, signatures[0].signer, high)).toThrow()
    expect(() => verifyFundAuthorityAlignmentSignature({ ...intent, safe_transaction_hash: testHash(999) }, signatures[0].signer, signatures[0].signature)).toThrow()
  })
  it('requires actual inner success, exact epoch event/getter, canonical finality and matching normalized receipt evidence', async () => {
    const f = fixture({ mutate: (url, method, _params, value) => method === 'eth_getTransactionReceipt' && value
      ? { ...(value as Record<string, unknown>), provider_metadata: url === FUNDING_RPC_URLS[0] ? 'one' : 'two' } : value })
    const intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures)
    const observed = await observeFundAuthorityAlignment(f.read, intent, signatures, transactionHash, { rpc: f.rpc })
    expect(observed).toMatchObject({ status: 'FINAL', inner_execution_success: true, epoch_verified: true, observed_epoch: 2,
      epoch_event: { previous_epoch: 1, target_epoch: 2, reason_hash: f.read.reason_hash }, executor_nonce: '26', safe_nonce: '0' })
    expect(observed.receipt_hashes).toHaveLength(2); expect(observed.receipt_hashes[0]).toBe(observed.receipt_hashes[1])
    expect(fundAuthorityAlignmentObservationSchema.safeParse(observed).success).toBe(true)
  })
  it.each(['outer', 'inner'] as const)('retains final %s failure without recording successful alignment', async failure => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures, { reverted: failure === 'outer', innerFailed: failure === 'inner' })
    expect(await observeFundAuthorityAlignment(f.read, intent, signatures, transactionHash, { rpc: f.rpc })).toMatchObject({ status: 'REVERTED',
      inner_execution_success: false, epoch_verified: false, epoch_event: null, observed_epoch: 1 })
  })
  it.each(['missing-receipt', 'not-final'] as const)('keeps %s pending rather than inferring completion from a target getter', async fault => {
    const f = fixture({ mutate: (_url, method, _params, value) => fault === 'missing-receipt' && method === 'eth_getTransactionReceipt' ? null : value })
    const intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures)
    if (fault === 'not-final') f.setHead(150n)
    // Require more than one confirmation for the finality-negative case.
    f.read.input.required_confirmations = 2
    expect(await observeFundAuthorityAlignment(f.read, intent, signatures, transactionHash, { rpc: f.rpc })).toMatchObject({ status: 'PENDING', inner_execution_success: false, epoch_verified: false })
  })
  it.each(['missing-event', 'wrong-event', 'wrong-getter', 'outer-payload', 'removed-log', 'provider-receipt'] as const)('rejects %s evidence, never FINAL', async fault => {
    let completed = false
    const f = fixture({ mutate: (url, method, params, value) => {
      if (!completed) return value
      if (method === 'eth_getTransactionReceipt' && value) {
        const receipt = value as Record<string, unknown>, logs = receipt.logs as Record<string, unknown>[]
        if (fault === 'missing-event') return { ...receipt, logs: logs.slice(0, 1) }
        if (fault === 'wrong-event') { const event = CONTROLLER.encodeEventLog(CONTROLLER.getEvent('AuthorityEpochAdvanced')!, [1, 2, testHash(999)]); return { ...receipt, logs: [logs[0], { ...logs[1], topics: event.topics, data: event.data }] } }
        if (fault === 'removed-log') return { ...receipt, logs: logs.map(log => ({ ...log, removed: true })) }
        if (fault === 'provider-receipt' && url === FUNDING_RPC_URLS[1]) return { ...receipt, status: '0x0' }
      }
      if (fault === 'outer-payload' && method === 'eth_getTransactionByHash') return { ...(value as Record<string, unknown>), input: '0x1234' }
      if (fault === 'wrong-getter' && method === 'eth_call' && (params[0] as { to: string }).to === f.source.dependencies.controller) {
        const decoded = CONTROLLER.parseTransaction({ data: (params[0] as { data: string }).data })
        if (decoded?.name === 'authorityEpoch') return CONTROLLER.encodeFunctionResult('authorityEpoch', [1])
      }
      return value
    } })
    const intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures); completed = true
    await expect(observeFundAuthorityAlignment(f.read, intent, signatures, transactionHash, { rpc: f.rpc })).rejects.toBeInstanceOf(FundAuthorityAlignmentChainError)
  })
  it('discovers only the exact original executor+nonce winner, then separately proves its real effects', async () => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures); f.rpc.mockClear()
    expect(await discoverFundAuthorityAlignment(f.read, intent, signatures, { rpc: f.rpc })).toBe(transactionHash)
    expect(f.rpc.mock.calls.length).toBeLessThanOrEqual(128)
    expect((await observeFundAuthorityAlignment(f.read, intent, signatures, transactionHash, { rpc: f.rpc })).status).toBe('FINAL')
  })
  it('returns no candidate or send permission while the saved executor nonce is unconsumed', async () => {
    const f = fixture(), intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.setHead(130n)
    expect(await discoverFundAuthorityAlignment(f.read, intent, signatures, { rpc: f.rpc })).toBeNull()
    expect(f.rpc.mock.calls.some(([, method]) => method.startsWith('eth_send'))).toBe(false)
  })
  it.each(['mismatch', 'disagreement', 'reorg', 'span'] as const)('never recovers %s into another send or a fabricated winner', async fault => {
    let completed = false
    const f = fixture({ mutate: (url, method, params, value) => {
      if (!completed) return value
      if (fault === 'mismatch' && method === 'eth_getBlockByNumber' && params[1] === true) return { ...(value as Record<string, unknown>), transactions: [{ ...((value as { transactions: Record<string, unknown>[] }).transactions[0]), input: '0x1234' }] }
      if (fault === 'disagreement' && method === 'eth_getTransactionCount' && url === FUNDING_RPC_URLS[1]) return '0x1c'
      if (fault === 'reorg' && method === 'eth_getBlockByNumber' && params[0] === '0x96' && params[1] === false) return { ...(value as Record<string, unknown>), hash: testHash(999) }
      return value
    } })
    const intent = (await prepareFundAuthorityAlignment(f.read, { rpc: f.rpc })).intent!, signatures = await f.signatures(intent)
    f.saved(intent, 'UNKNOWN', signatures); f.execute(intent, signatures); completed = true
    if (fault === 'span') f.setHead(262265n)
    await expect(discoverFundAuthorityAlignment(f.read, intent, signatures, { rpc: f.rpc })).rejects.toBeInstanceOf(FundAuthorityAlignmentChainError)
  })
  it('bounds an unresponsive observer and redacts transport details', async () => {
    const f = fixture()
    vi.useFakeTimers()
    const task = prepareFundAuthorityAlignment(f.read, { rpc: vi.fn(() => new Promise<never>(() => {})) })
    const rejected = expect(task).rejects.toMatchObject({ code: 'ALIGNMENT_DEADLINE_EXCEEDED', status: 503 })
    await vi.advanceTimersByTimeAsync(90000); await rejected
  })
})
