import 'server-only'
import { createHash } from 'node:crypto'
import { AbiCoder, Interface, getCreateAddress, getCreate2Address, keccak256, toUtf8Bytes } from 'ethers'
import { createFundingRpc, FUNDING_RPC_URLS, FundingVerificationError, readFundingRpcDiagnostic } from './funding-verifier'
import { createFundServerRpc } from './fund-rpc-server'
import { canonicalFundCreation, canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, getCanonicalFundArtifact, getOfficialSafeArtifact, type FundSetupArtifactName } from './fund-setup-artifacts'

const ZERO = `0x${'0'.repeat(40)}`, SENTINEL = '0x0000000000000000000000000000000000000001'
const MAX_UINT = (1n << 256n) - 1n
type Rpc = ReturnType<typeof createFundingRpc>
export type FundSetupObservers = { rpc?: Rpc; primary?: Rpc; secondary?: Rpc; intent_hash?: string }
export type FundSetupConfiguration = { safe_address: string; identity_management_key: string; claim_management_key: string;
  token_management_key: string; maximum_holding_base_units: string; tst_initial_holder: string; tst_initial_supply_base_units: string }
const creates = { token_implementation: 'Token', ctr_implementation: 'ClaimTopicsRegistry', irs_implementation: 'IdentityRegistryStorage',
  ir_implementation: 'IdentityRegistry', tir_implementation: 'TrustedIssuersRegistry', mc_implementation: 'ModularCompliance',
  oid_implementation: 'Identity', oid_authority: 'ImplementationAuthority', oid_factory: 'IdFactory', trex_authority: 'TREXImplementationAuthority',
  trex_factory: 'TREXFactory', ia_factory: 'IAFactory', controller: 'Bx1FundController', holding_module: 'Bx1MaximumHoldingModule',
  claim_issuer: 'ClaimIssuer', token_identity: 'IdentityProxy', settlement: 'Bx1TestSettlementToken' } as const
const calls = { trex_version: 'trex_authority', trex_factory_binding: 'trex_authority', ia_factory_binding: 'trex_authority',
  oid_factory_binding: 'oid_factory', factory_handoff: 'trex_factory', trex_authority_handoff: 'trex_authority',
  oid_authority_handoff: 'oid_authority', oid_factory_handoff: 'oid_factory' } as const
export type FundSetupCreateKey = keyof typeof creates
export type FundSetupStepKey = FundSetupCreateKey | keyof typeof calls | 'safe_creation'
export type FundSetupAddresses = Partial<Record<FundSetupCreateKey, string>>
const prerequisites: Partial<Record<FundSetupStepKey, readonly FundSetupStepKey[]>> = {
  oid_authority: ['oid_implementation'], oid_factory: ['oid_authority'], trex_version: ['trex_authority', 'token_implementation', 'ctr_implementation', 'irs_implementation', 'ir_implementation', 'tir_implementation', 'mc_implementation'],
  trex_factory: ['trex_version', 'oid_factory'], ia_factory: ['trex_factory'], trex_factory_binding: ['trex_factory', 'trex_authority'],
  ia_factory_binding: ['ia_factory', 'trex_factory_binding'], oid_factory_binding: ['oid_factory', 'trex_factory'], controller: ['trex_factory'],
  factory_handoff: ['controller', 'trex_factory_binding', 'ia_factory_binding', 'oid_factory_binding'],
  trex_authority_handoff: ['trex_factory_binding', 'ia_factory_binding'], oid_authority_handoff: ['oid_factory'], oid_factory_handoff: ['oid_factory_binding'],
  token_identity: ['oid_authority'],
}
/** One canonical graph. Safe is separately observed; its creation is not invented here. */
export const FUND_SETUP_STEPS = Object.freeze([
  'token_implementation', 'ctr_implementation', 'irs_implementation', 'ir_implementation', 'tir_implementation', 'mc_implementation',
  'oid_implementation', 'oid_authority', 'oid_factory', 'trex_authority', 'trex_version', 'trex_factory', 'ia_factory',
  'trex_factory_binding', 'ia_factory_binding', 'oid_factory_binding', 'controller', 'factory_handoff', 'trex_authority_handoff',
  'oid_authority_handoff', 'oid_factory_handoff', 'holding_module', 'claim_issuer', 'token_identity', 'settlement',
].map(key => ({ key: key as FundSetupStepKey, kind: Object.hasOwn(creates, key) ? 'CREATE' as const : 'CALL' as const,
  artifact: creates[(Object.hasOwn(creates, key) ? key : calls[key as keyof typeof calls]) as FundSetupCreateKey], depends_on: prerequisites[key as FundSetupStepKey] ?? [] })))
export type FundSetupCheck = { address: string; data: string; result: string; storage_slot?: string }
export type FundSetupIntent = { version: 1; chain_id: 80002; step_key: FundSetupStepKey; kind: 'CREATE' | 'CALL'; sender: string; nonce: string;
  value: '0'; to: string | null; data: string; expected_address: string; artifact_name: string; expected_runtime_hash: string;
  checks: FundSetupCheck[]; configuration_hash: string; catalog_hash: string }
export class FundSetupChainError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(status === 503
    ? 'Independent setup checks are unavailable or disagree. Keep the original transaction; do not submit another.'
    : 'The recorded setup transaction or its current configuration does not match. Keep its reference for review; do not submit another.') }
}
function fail(code: string, status = 409): never { throw new FundSetupChainError(code, status) }
const lower = (value: unknown) => String(value).toLowerCase()
function address(value: unknown, zero = false): string { const v = lower(value); return /^0x[0-9a-f]{40}$/.test(v) && (zero || v !== ZERO) ? v : fail('SETUP_ADDRESS_INVALID') }
function uint(value: unknown, positive = false): string { return typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)
  && BigInt(value) <= MAX_UINT && (!positive || BigInt(value) > 0n) ? value : fail('SETUP_QUANTITY_INVALID') }
function quantity(value: unknown): bigint { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return fail('SETUP_RPC_QUANTITY_INVALID', 503); const n = BigInt(value); return n <= MAX_UINT ? n : fail('SETUP_RPC_QUANTITY_INVALID', 503) }
function hash(value: unknown): string { const v = lower(value); return /^0x[0-9a-f]{64}$/.test(v) && !/^0x0{64}$/.test(v) ? v : fail('SETUP_RPC_HASH_INVALID', 503) }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('SETUP_RPC_RECORD_INVALID', 503) }
const hex = (value: bigint) => `0x${value.toString(16)}`
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])); return value }
export function fundSetupHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }
function config(value: FundSetupConfiguration): FundSetupConfiguration {
  const names = ['safe_address', 'identity_management_key', 'claim_management_key', 'token_management_key', 'maximum_holding_base_units', 'tst_initial_holder', 'tst_initial_supply_base_units']
  if (!value || Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) return fail('SETUP_CONFIGURATION_INVALID')
  return { safe_address: address(value.safe_address), identity_management_key: address(value.identity_management_key), claim_management_key: address(value.claim_management_key),
    token_management_key: address(value.token_management_key), maximum_holding_base_units: uint(value.maximum_holding_base_units, true),
    tst_initial_holder: address(value.tst_initial_holder), tst_initial_supply_base_units: uint(value.tst_initial_supply_base_units, true) }
}
function required(deps: FundSetupAddresses, key: FundSetupCreateKey) { return deps[key] ? address(deps[key]) : fail('SETUP_DEPENDENCY_NOT_OBSERVED') }
function constructorArgs(key: FundSetupCreateKey, c: FundSetupConfiguration, d: FundSetupAddresses): unknown[] {
  switch (key) {
    case 'oid_implementation': return [c.identity_management_key, true]
    case 'oid_authority': return [required(d, 'oid_implementation')]
    case 'oid_factory': return [required(d, 'oid_authority')]
    case 'trex_authority': return [true, ZERO, ZERO]
    case 'trex_factory': return [required(d, 'trex_authority'), required(d, 'oid_factory')]
    case 'ia_factory': return [required(d, 'trex_factory')]
    case 'controller': return [c.safe_address, required(d, 'trex_factory')]
    case 'holding_module': return [c.maximum_holding_base_units]
    case 'claim_issuer': return [c.claim_management_key]
    case 'token_identity': return [required(d, 'oid_authority'), c.token_management_key]
    case 'settlement': return [c.tst_initial_holder, c.tst_initial_supply_base_units]
    default: return []
  }
}
function runtime(key: FundSetupCreateKey, c: FundSetupConfiguration, d: FundSetupAddresses) {
  let bindings: Record<string, string> = {}
  if (key === 'oid_factory') bindings = { _implementationAuthority: required(d, 'oid_authority') }
  if (key === 'controller') bindings = { institutionalAuthority: c.safe_address, factory: required(d, 'trex_factory') }
  if (key === 'holding_module') bindings = { maximumHolding: c.maximum_holding_base_units }
  return canonicalFundRuntime(creates[key], bindings)
}
function check(artifact: FundSetupArtifactName, at: string, method: string, args: unknown[], result: unknown[]): FundSetupCheck {
  const abi = new Interface(getCanonicalFundArtifact(artifact).abi)
  return { address: at, data: abi.encodeFunctionData(method, args).toLowerCase(), result: abi.encodeFunctionResult(method, result).toLowerCase() }
}
/** Called only with server-loaded configuration/dependencies and a durable nonce reservation. */
export function buildSetupIntent(step_key: FundSetupStepKey, configuration: FundSetupConfiguration, dependencies: FundSetupAddresses, sender: string, nonce: string, expectedConfigurationHash?: string): FundSetupIntent {
  if (!FUND_SETUP_STEPS.some(step => step.key === step_key) || !dependencies || Object.keys(dependencies).some(key => !Object.hasOwn(creates, key))) return fail('SETUP_STEP_INVALID')
  const c = config(configuration), from = address(sender), n = uint(nonce)
  if (BigInt(n) >= 2n ** 64n) return fail('SETUP_NONCE_INVALID')
  const kind = Object.hasOwn(creates, step_key) ? 'CREATE' as const : 'CALL' as const
  const key = kind === 'CREATE' ? step_key as FundSetupCreateKey : calls[step_key as keyof typeof calls]
  const artifact = creates[key], expected = kind === 'CREATE' ? getCreateAddress({ from, nonce: n }).toLowerCase() : required(dependencies, key)
  let data: string
  const checks: FundSetupCheck[] = []
  const add = (method: string, args: unknown[], result: unknown[], a = artifact) => checks.push(check(a, expected, method, args, result))
  if (kind === 'CREATE') {
    data = canonicalFundCreation(artifact, constructorArgs(key, c, dependencies))
    if (['token_implementation', 'ctr_implementation', 'irs_implementation', 'ir_implementation', 'tir_implementation', 'mc_implementation'].includes(key)) add('owner', [], [ZERO])
    if (['oid_authority', 'oid_factory', 'trex_authority', 'trex_factory', 'ia_factory'].includes(key) && new Interface(getCanonicalFundArtifact(artifact).abi).getFunction('owner')) add('owner', [], [from])
    if (key === 'oid_authority') add('getImplementation', [], [required(dependencies, 'oid_implementation')])
    if (key === 'oid_factory') add('implementationAuthority', [], [required(dependencies, 'oid_authority')])
    if (key === 'ia_factory') checks.push({ address: expected, data: '0x', result: AbiCoder.defaultAbiCoder().encode(['address'], [required(dependencies, 'trex_factory')]), storage_slot: '0' })
    if (key === 'trex_authority') add('isReferenceContract', [], [true])
    if (key === 'trex_factory') { add('getImplementationAuthority', [], [required(dependencies, 'trex_authority')]); add('getIdFactory', [], [required(dependencies, 'oid_factory')]) }
    if (key === 'controller') { add('institutionalAuthority', [], [c.safe_address]); add('factory', [], [required(dependencies, 'trex_factory')]); add('authorityEpoch', [], [1]); add('paused', [], [false])
      add('releaseConfigurationHash', [], [keccak256(toUtf8Bytes('b6c5fabf86e733ede017fef754d59eeb8f80e3f4:BX1_FUND_CONTROLLER_V1'))]) }
    if (key === 'holding_module') add('maximumHolding', [], [c.maximum_holding_base_units])
    if (key === 'oid_implementation' || key === 'claim_issuer' || key === 'token_identity') add('version', [], ['2.2.1'], key === 'token_identity' ? 'Identity' : artifact)
    if (key === 'claim_issuer' || key === 'token_identity') add('keyHasPurpose', [keccak256(AbiCoder.defaultAbiCoder().encode(['address'], [key === 'claim_issuer' ? c.claim_management_key : c.token_management_key])), 1], [true], key === 'token_identity' ? 'Identity' : artifact)
    if (key === 'token_identity') add('implementationAuthority', [], [required(dependencies, 'oid_authority')])
    if (key === 'settlement') { add('name', [], ['BlockXOne Test Settlement Token']); add('symbol', [], ['TST']); add('decimals', [], [6]); add('totalSupply', [], [c.tst_initial_supply_base_units]); add('balanceOf', [c.tst_initial_holder], [c.tst_initial_supply_base_units]) }
  } else {
    const abi = new Interface(getCanonicalFundArtifact(artifact).abi)
    let method: string, args: unknown[]
    if (step_key === 'trex_version') {
      method = 'addAndUseTREXVersion'; args = [{ major: 4, minor: 1, patch: 3 }, {
        tokenImplementation: required(dependencies, 'token_implementation'), ctrImplementation: required(dependencies, 'ctr_implementation'),
        irImplementation: required(dependencies, 'ir_implementation'), irsImplementation: required(dependencies, 'irs_implementation'),
        tirImplementation: required(dependencies, 'tir_implementation'), mcImplementation: required(dependencies, 'mc_implementation') }]
      add('getCurrentVersion', [], [[4, 1, 3]])
      for (const [getter, dep] of [['getTokenImplementation', 'token_implementation'], ['getCTRImplementation', 'ctr_implementation'], ['getIRImplementation', 'ir_implementation'], ['getIRSImplementation', 'irs_implementation'], ['getTIRImplementation', 'tir_implementation'], ['getMCImplementation', 'mc_implementation']] as const) add(getter, [], [required(dependencies, dep)])
    } else if (step_key === 'trex_factory_binding') { method = 'setTREXFactory'; args = [required(dependencies, 'trex_factory')]; add('getTREXFactory', [], args) }
    else if (step_key === 'ia_factory_binding') { method = 'setIAFactory'; args = [required(dependencies, 'ia_factory')]
      // Exact pinned storage layout: _iaFactory, slot 4, offset 0. There is no getter.
      checks.push({ address: expected, data: '0x', result: AbiCoder.defaultAbiCoder().encode(['address'], args).toLowerCase(), storage_slot: '4' }) }
    else if (step_key === 'oid_factory_binding') { method = 'addTokenFactory'; args = [required(dependencies, 'trex_factory')]; add('isTokenFactory', args, [true]) }
    else { method = 'transferOwnership'; args = [step_key === 'factory_handoff' ? required(dependencies, 'controller') : c.safe_address]; add('owner', [], args) }
    data = abi.encodeFunctionData(method, args)
  }
  const body = { version: 1 as const, chain_id: 80002 as const, step_key, kind, sender: from, nonce: n, value: '0' as const,
    to: kind === 'CREATE' ? null : expected, data: data.toLowerCase(), expected_address: expected, artifact_name: artifact,
    expected_runtime_hash: keccak256(runtime(key, c, dependencies)), checks, configuration_hash: expectedConfigurationHash ?? fundSetupHash(c), catalog_hash: FUND_SETUP_CATALOG_HASH }
  if (!/^[0-9a-f]{64}$/.test(body.configuration_hash)) return fail('SETUP_CONFIGURATION_HASH_INVALID')
  return body
}
function logSetupRpcFailure(error: unknown, observerIndex: number, method: string): void {
  try {
    if (!(error instanceof FundingVerificationError) || (observerIndex !== 0 && observerIndex !== 1)
      || !['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_getStorageAt', 'eth_getCode', 'eth_call'].includes(method)) return
    const diagnostic = readFundingRpcDiagnostic(error.diagnostic)
    if (!diagnostic) return
    console.warn('BX1_SETUP_RPC_FAILURE', { observerIndex, method, stage: diagnostic.stage,
      httpStatus: diagnostic.httpStatus, rpcCode: diagnostic.rpcCode, requestId: diagnostic.requestId })
  } catch { /* Best-effort diagnostics must never replace the original failure. */ }
}
function rpcFor(options: FundSetupObservers, index: number): Rpc { const raw = (index === 0 ? options.primary : options.secondary) ?? options.rpc ?? createFundServerRpc()
  return async (url, method, params) => { if (url !== FUNDING_RPC_URLS[index]) return fail('SETUP_OBSERVER_INVALID', 503)
    try { return await raw(url, method, params) } catch (error) { if (error instanceof FundSetupChainError) throw error; logSetupRpcFailure(error, index, method); return fail('SETUP_OBSERVATION_UNAVAILABLE', 503) } } }
function block(value: unknown) { const b = object(value), timestamp = quantity(b.timestamp); if (timestamp > 8640000000000n) return fail('SETUP_BLOCK_INVALID', 503)
  return { number: quantity(b.number), hash: hash(b.hash), timestamp: new Date(Number(timestamp) * 1000).toISOString(), transactions: b.transactions } }
async function observers(options: FundSetupObservers) {
  const bound = options.rpc || options.primary && options.secondary ? options : { ...options, rpc: createFundServerRpc() }
  return Promise.all(FUNDING_RPC_URLS.map(async (url, i) => {
  const rpc = rpcFor(bound, i), [chain, raw] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
  if (quantity(chain) !== 80002n || raw === null) return fail('SETUP_FINALITY_UNAVAILABLE', 503)
  const head = block(raw), current = block(await rpc(url, 'eth_getBlockByNumber', [hex(head.number), false]))
  if (head.hash !== current.hash || head.number !== current.number || head.timestamp !== current.timestamp) return fail('SETUP_FINALITY_CHANGED', 503)
  return { url, rpc, head }
})) }
function verifyIntent(intent: FundSetupIntent) {
  const safeCreation = intent.step_key === 'safe_creation'
  if (intent.chain_id !== 80002 || intent.version !== 1 || intent.catalog_hash !== FUND_SETUP_CATALOG_HASH || intent.value !== '0'
    || !/^[0-9a-f]{64}$/.test(intent.configuration_hash) || (!safeCreation && !FUND_SETUP_STEPS.some(step => step.key === intent.step_key && step.kind === intent.kind && step.artifact === intent.artifact_name))
    || address(intent.sender) !== intent.sender || uint(intent.nonce) !== intent.nonce || BigInt(intent.nonce) >= 2n ** 64n
    || !/^0x(?:[0-9a-f]{2})+$/.test(intent.data) || intent.data.length > 262146 || intent.checks.length > 64
    || (intent.kind === 'CREATE' ? intent.to !== null || getCreateAddress({ from: intent.sender, nonce: intent.nonce }).toLowerCase() !== intent.expected_address : !safeCreation && intent.to !== intent.expected_address)) return fail('SETUP_INTENT_INVALID')
  if (safeCreation) {
    if (intent.kind !== 'CALL' || intent.artifact_name !== 'SafeProxy' || intent.to !== FUND_SETUP_SAFE_FACTORY.address || intent.expected_runtime_hash !== FUND_SETUP_SAFE_PROXY_HASH) return fail('SETUP_SAFE_INTENT_INVALID')
    const decoded = new Interface(getOfficialSafeArtifact('SafeProxyFactory').abi).decodeFunctionData('createProxyWithNonce', intent.data)
    if (lower(decoded[0]) !== FUND_SETUP_SAFE_L2 || safeProxyAddress(String(decoded[1]), String(decoded[2])) !== intent.expected_address) return fail('SETUP_SAFE_INTENT_INVALID')
  } else getCanonicalFundArtifact(intent.artifact_name as FundSetupArtifactName)
}
export type FundSetupStepObservation = { version: 1; chain_id: 80002; step_key: FundSetupStepKey; intent_hash: string; transaction_hash: string;
  status: 'UNKNOWN' | 'PENDING' | 'FAILED' | 'FINAL'; reason_code: string | null; block_number: string | null; block_hash: string | null;
  block_timestamp: string | null; contract_address: string | null; runtime_hash: string | null; checks: FundSetupCheck[];
  providers: { url: string; finalized_block_number: string; finalized_block_hash: string }[] }
/** Observe the original recorded transaction only; no signing, mutation or admission. */
export async function observeSetupStep(expected: FundSetupIntent, transactionHash: string, options: FundSetupObservers = {}): Promise<FundSetupStepObservation> {
  verifyIntent(expected); const txHash = hash(transactionHash), sources = await observers(options)
  if (options.intent_hash !== undefined && !/^[0-9a-f]{64}$/.test(options.intent_hash)) return fail('SETUP_INTENT_HASH_INVALID')
  const base = { version: 1 as const, chain_id: 80002 as const, step_key: expected.step_key, intent_hash: options.intent_hash ?? fundSetupHash(expected), transaction_hash: txHash,
    block_number: null, block_hash: null, block_timestamp: null, contract_address: null, runtime_hash: null, checks: [],
    providers: sources.map(s => ({ url: s.url, finalized_block_number: s.head.number.toString(), finalized_block_hash: s.head.hash })) }
  const raw = await Promise.all(sources.map(async s => { const [receipt, transaction] = await Promise.all([s.rpc(s.url, 'eth_getTransactionReceipt', [txHash]), s.rpc(s.url, 'eth_getTransactionByHash', [txHash])]); return { receipt, transaction } }))
  for (const item of raw) if (item.transaction !== null) {
    const tx = object(item.transaction)
    if (hash(tx.hash) !== txHash || address(tx.from) !== expected.sender || quantity(tx.nonce).toString() !== expected.nonce
      || quantity(tx.value) !== 0n || (tx.chainId !== undefined && quantity(tx.chainId) !== 80002n)
      || lower(tx.input) !== expected.data || (expected.kind === 'CREATE' ? tx.to !== null : address(tx.to) !== expected.to)) return fail('SETUP_TRANSACTION_MISMATCH')
  }
  if (raw.some(item => item.transaction === null)) return { ...base, status: 'UNKNOWN', reason_code: 'SETUP_TRANSACTION_UNKNOWN' }
  if (raw.some(item => item.receipt === null)) return { ...base, status: 'PENDING', reason_code: 'SETUP_RECEIPT_PENDING' }
  if (raw.some((item, i) => quantity(object(item.receipt).blockNumber) > sources[i].head.number)) return { ...base, status: 'PENDING', reason_code: 'SETUP_FINALITY_PENDING' }
  const snapshots: string[] = []
  const facts = await Promise.all(sources.map(async (s, i) => {
    const receipt = object(raw[i].receipt), tx = object(raw[i].transaction), height = quantity(receipt.blockNumber), bh = hash(receipt.blockHash), ti = quantity(receipt.transactionIndex)
    if (ti > 2147483647n || hash(receipt.transactionHash) !== txHash || hash(tx.blockHash) !== bh || quantity(tx.blockNumber) !== height
      || quantity(tx.transactionIndex) !== ti || address(receipt.from) !== expected.sender
      || (expected.kind === 'CREATE' ? receipt.to !== null : address(receipt.to) !== expected.to)) return fail('SETUP_RECEIPT_MISMATCH')
    const canonical = block(await s.rpc(s.url, 'eth_getBlockByNumber', [hex(height), false]))
    if (canonical.number !== height || canonical.hash !== bh || !Array.isArray(canonical.transactions) || lower(canonical.transactions[Number(ti)]) !== txHash) return fail('SETUP_CANONICAL_BLOCK_CHANGED', 503)
    const status = quantity(receipt.status)
    if (status !== 0n && status !== 1n) return fail('SETUP_RECEIPT_STATUS_INVALID', 503)
    const contractAddress = status === 1n ? expected.kind === 'CREATE' ? address(receipt.contractAddress)
      : expected.step_key === 'safe_creation' ? expected.expected_address : null : null
    if (expected.kind === 'CREATE' && status === 1n && contractAddress !== expected.expected_address) return fail('SETUP_CREATED_ADDRESS_MISMATCH')
    snapshots[i] = fundSetupHash(receipt)
    if (status === 0n) return { status: 'FAILED' as const, block_number: height.toString(), block_hash: bh, block_timestamp: canonical.timestamp,
      contract_address: null, runtime_hash: null, checks: [] as FundSetupCheck[] }
    for (const at of [height, s.head.number]) {
      const runtime = await s.rpc(s.url, 'eth_getCode', [expected.expected_address, hex(at)])
      if (typeof runtime !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(runtime) || runtime.length > 131074 || keccak256(runtime) !== expected.expected_runtime_hash) return fail('SETUP_RUNTIME_MISMATCH')
    }
    if (expected.step_key === 'safe_creation') {
      for (const at of [height, s.head.number]) {
        const [factoryCode, singletonCode] = await Promise.all([s.rpc(s.url, 'eth_getCode', [FUND_SETUP_SAFE_FACTORY.address, hex(at)]), s.rpc(s.url, 'eth_getCode', [FUND_SETUP_SAFE_L2, hex(at)])])
        if (typeof factoryCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(factoryCode) || keccak256(factoryCode) !== FUND_SETUP_SAFE_FACTORY.runtime_hash
          || typeof singletonCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(singletonCode) || keccak256(singletonCode) !== FUND_SETUP_SAFE_SINGLETONS[FUND_SETUP_SAFE_L2]) return fail('SETUP_SAFE_FACTORY_OR_SINGLETON_CHANGED')
      }
      const abi = new Interface(getOfficialSafeArtifact('SafeProxyFactory').abi), topic = abi.getEvent('ProxyCreation')!.topicHash.toLowerCase()
      if (!Array.isArray(receipt.logs)) return fail('SETUP_SAFE_CREATION_EVENT_MISSING')
      const logs = receipt.logs.map(object).filter(log => lower(log.address) === FUND_SETUP_SAFE_FACTORY.address && Array.isArray(log.topics) && lower(log.topics[0]) === topic)
      if (logs.length !== 1) return fail('SETUP_SAFE_CREATION_EVENT_AMBIGUOUS')
      const log = logs[0]
      if (log.removed !== false || hash(log.transactionHash) !== txHash || hash(log.blockHash) !== bh || quantity(log.blockNumber) !== height || quantity(log.transactionIndex) !== ti) return fail('SETUP_SAFE_CREATION_EVENT_MISMATCH')
      if (!Array.isArray(log.topics) || log.topics.length !== 2 || typeof log.data !== 'string' || !/^0x[0-9a-f]{64}$/i.test(log.data)
        || quantity(log.logIndex) > 2147483647n || receipt.logs.map(object).filter(item => quantity(item.logIndex) === quantity(log.logIndex)).length !== 1) return fail('SETUP_SAFE_CREATION_EVENT_MISMATCH')
      const decoded = abi.decodeEventLog('ProxyCreation', String(log.data), log.topics as string[])
      if (lower(decoded.proxy) !== expected.expected_address || lower(decoded.singleton) !== FUND_SETUP_SAFE_L2) return fail('SETUP_SAFE_CREATION_EVENT_MISMATCH')
    }
    for (const check of expected.checks) {
      const result = check.storage_slot === undefined ? await s.rpc(s.url, 'eth_call', [{ to: check.address, data: check.data }, hex(height)])
        : await s.rpc(s.url, 'eth_getStorageAt', [check.address, hex(BigInt(uint(check.storage_slot))), hex(height)])
      if (lower(result) !== check.result) return fail('SETUP_EFFECT_MISMATCH')
    }
    return { status: 'FINAL' as const, block_number: height.toString(), block_hash: bh, block_timestamp: canonical.timestamp,
      contract_address: contractAddress, runtime_hash: expected.expected_runtime_hash, checks: expected.checks }
  }))
  if (fundSetupHash(facts[0]) !== fundSetupHash(facts[1])) return fail('SETUP_OBSERVERS_DISAGREE', 503)
  await Promise.all(sources.map(async (s, i) => {
    const fact = facts[i], [rb, rr] = await Promise.all([s.rpc(s.url, 'eth_getBlockByNumber', [hex(BigInt(fact.block_number)), false]), s.rpc(s.url, 'eth_getTransactionReceipt', [txHash])])
    const b = block(rb), receipt = object(rr), index = quantity(receipt.transactionIndex)
    if (b.number.toString() !== fact.block_number || b.hash !== fact.block_hash || b.timestamp !== fact.block_timestamp
      || index > 2147483647n || !Array.isArray(b.transactions) || lower(b.transactions[Number(index)]) !== txHash || fundSetupHash(receipt) !== snapshots[i]) return fail('SETUP_REORG_AFTER_WAIT', 503)
  }))
  return { ...base, ...facts[0], reason_code: facts[0].status === 'FAILED' ? 'SETUP_TRANSACTION_REVERTED' : null }
}
export const FUND_SETUP_SAFE_PROXY_RUNTIME = '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033'
export const FUND_SETUP_SAFE_PROXY_HASH = keccak256(FUND_SETUP_SAFE_PROXY_RUNTIME)
export const FUND_SETUP_SAFE_SINGLETONS = {
  '0x41675c099f32341bf84bfc5382af534df5c7461a': '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4',
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762': '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff',
} as const
export const FUND_SETUP_SAFE_L2 = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
export const FUND_SETUP_SAFE_FACTORY = { address: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67', runtime_hash: '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317' } as const
const SAFE = new Interface(['function VERSION() view returns(string)', 'function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)', 'function nonce() view returns(uint256)',
  'function getModulesPaginated(address,uint256) view returns(address[] array,address next)', 'function getStorageAt(uint256,uint256) view returns(bytes)'])
/** Official 1.4.1 code/state proof, not whole-fund conformance or legal admission. */
export async function observeSetupSafe(safeAddress: string, options: FundSetupObservers = {}) {
  const safe = address(safeAddress), sources = await observers(options), height = sources.reduce((n, s) => s.head.number < n ? s.head.number : n, sources[0].head.number)
  const facts = await Promise.all(sources.map(async s => {
    const at = hex(height), b = block(await s.rpc(s.url, 'eth_getBlockByNumber', [at, false])), runtime = await s.rpc(s.url, 'eth_getCode', [safe, at])
    if (typeof runtime !== 'string' || runtime.toLowerCase() !== FUND_SETUP_SAFE_PROXY_RUNTIME) return fail('SETUP_SAFE_NOT_AVAILABLE')
    const read = async (method: string, args: unknown[]) => { try { return SAFE.decodeFunctionResult(method, String(await s.rpc(s.url, 'eth_call', [{ to: safe, data: SAFE.encodeFunctionData(method, args) }, at]))) } catch { return fail('SETUP_SAFE_READ_UNAVAILABLE', 503) } }
    const [owners, threshold, nonce, modules, singleton, guard, fallback, version] = await Promise.all([read('getOwners', []), read('getThreshold', []), read('nonce', []), read('getModulesPaginated', [SENTINEL, 100]),
      read('getStorageAt', [0, 1]), read('getStorageAt', [keccak256(toUtf8Bytes('guard_manager.guard.address')), 1]), read('getStorageAt', [keccak256(toUtf8Bytes('fallback_manager.handler.address')), 1]), read('VERSION', [])])
    const stored = (value: unknown) => { const v = lower(value); if (!/^0x0{24}[0-9a-f]{40}$/.test(v)) return fail('SETUP_SAFE_STORAGE_INVALID'); return address(`0x${v.slice(-40)}`, true) }
    const list = [...owners[0]].map(value => address(value)).sort(), t = BigInt(threshold[0])
    if (list.length < 2 || list.length > 20 || new Set(list).size !== list.length || t < 2n || t > BigInt(list.length)
      || modules[0].length !== 0 || lower(modules[1]) !== SENTINEL || version[0] !== '1.4.1') return fail('SETUP_SAFE_POLICY_INVALID')
    const singletonAddress = address(stored(singleton[0])), singletonCode = await s.rpc(s.url, 'eth_getCode', [singletonAddress, at])
    const pinned = FUND_SETUP_SAFE_SINGLETONS[singletonAddress as keyof typeof FUND_SETUP_SAFE_SINGLETONS]
    if (!pinned || typeof singletonCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(singletonCode) || keccak256(singletonCode) !== pinned) return fail('SETUP_SAFE_SINGLETON_NOT_AVAILABLE')
    return { address: safe, runtime_hash: keccak256(runtime), singleton: { address: singletonAddress, runtime_hash: keccak256(singletonCode) },
      owners: list, threshold: Number(t), nonce: uint(String(nonce[0])), modules: [] as string[], guard: stored(guard[0]), fallback_handler: stored(fallback[0]), block_number: height.toString(), block_hash: b.hash }
  }))
  if (fundSetupHash(facts[0]) !== fundSetupHash(facts[1])) return fail('SETUP_SAFE_OBSERVERS_DISAGREE', 503)
  await Promise.all(sources.map(async s => { const b = block(await s.rpc(s.url, 'eth_getBlockByNumber', [hex(height), false])); if (b.hash !== facts[0].block_hash || b.number !== height) return fail('SETUP_SAFE_REORG_AFTER_WAIT', 503) }))
  return { version: 1 as const, chain_id: 80002 as const, status: 'VERIFIED_CODE_AND_STATE' as const, release_version: '1.4.1' as const,
    release_source_commit: '382117f5d97745f611e05f827603aadb493dc620', ...facts[0], catalog_hash: FUND_SETUP_CATALOG_HASH,
    providers: sources.map(s => ({ url: s.url, finalized_block_number: s.head.number.toString(), finalized_block_hash: s.head.hash })) }
}
export type FundSetupSafeSettings = { owners: string[]; threshold: number; salt_nonce: string }
function safeProxyAddress(initializer: string, saltNonce: string): string {
  const artifact = getOfficialSafeArtifact('SafeProxy')
  if (artifact.deployedBytecode.toLowerCase() !== FUND_SETUP_SAFE_PROXY_RUNTIME) return fail('SETUP_SAFE_ARTIFACT_INVALID')
  const salt = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [keccak256(initializer), uint(saltNonce)]))
  const initcode = artifact.bytecode + AbiCoder.defaultAbiCoder().encode(['uint256'], [BigInt(FUND_SETUP_SAFE_L2)]).slice(2)
  return getCreate2Address(FUND_SETUP_SAFE_FACTORY.address, salt, keccak256(initcode)).toLowerCase()
}
/** Exact official factory/setup path through the human MetaMask sender. No owner key is manufactured. */
export async function buildSafeCreationIntent(settings: FundSetupSafeSettings, sender: string, nonce: string, expectedConfigurationHash?: string, options: FundSetupObservers = {}): Promise<FundSetupIntent> {
  if (!settings || Object.keys(settings).length !== 3 || !Array.isArray(settings.owners) || settings.owners.length < 2 || settings.owners.length > 20
    || !Number.isInteger(settings.threshold) || settings.threshold < 2 || settings.threshold > settings.owners.length) return fail('SETUP_SAFE_SETTINGS_INVALID')
  const owners = settings.owners.map(owner => address(owner)).sort(), from = address(sender), n = uint(nonce)
  if (new Set(owners).size !== owners.length || !owners.includes(from) || BigInt(n) >= 2n ** 64n) return fail('SETUP_SAFE_SETTINGS_INVALID')
  const safe = new Interface(getOfficialSafeArtifact('Safe').abi), factory = new Interface(getOfficialSafeArtifact('SafeProxyFactory').abi)
  const initializer = safe.encodeFunctionData('setup', [owners, settings.threshold, ZERO, '0x', ZERO, ZERO, 0, ZERO])
  const expected = safeProxyAddress(initializer, settings.salt_nonce), sources = await observers(options)
  const facts = await Promise.all(sources.map(async s => {
    const at = hex(s.head.number), [factoryCode, singletonCode, empty, creation] = await Promise.all([
      s.rpc(s.url, 'eth_getCode', [FUND_SETUP_SAFE_FACTORY.address, at]), s.rpc(s.url, 'eth_getCode', [FUND_SETUP_SAFE_L2, at]),
      s.rpc(s.url, 'eth_getCode', [expected, at]), s.rpc(s.url, 'eth_call', [{ to: FUND_SETUP_SAFE_FACTORY.address, data: factory.encodeFunctionData('proxyCreationCode') }, at]),
    ])
    if (typeof factoryCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(factoryCode) || keccak256(factoryCode) !== FUND_SETUP_SAFE_FACTORY.runtime_hash
      || typeof singletonCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(singletonCode) || keccak256(singletonCode) !== FUND_SETUP_SAFE_SINGLETONS[FUND_SETUP_SAFE_L2]
      || empty !== '0x' || factory.decodeFunctionResult('proxyCreationCode', String(creation))[0].toLowerCase() !== getOfficialSafeArtifact('SafeProxy').bytecode.toLowerCase()) return fail('SETUP_SAFE_FACTORY_OR_ADDRESS_INVALID')
    return { factory: keccak256(factoryCode), singleton: keccak256(singletonCode) }
  }))
  if (fundSetupHash(facts[0]) !== fundSetupHash(facts[1])) return fail('SETUP_SAFE_FACTORY_OBSERVERS_DISAGREE', 503)
  const checks: FundSetupCheck[] = []
  const add = (method: string, args: unknown[], result: unknown[]) => checks.push({ address: expected, data: SAFE.encodeFunctionData(method, args), result: SAFE.encodeFunctionResult(method, result) })
  add('VERSION', [], ['1.4.1']); add('getOwners', [], [owners]); add('getThreshold', [], [settings.threshold]); add('nonce', [], [0]); add('getModulesPaginated', [SENTINEL, 100], [[], SENTINEL])
  for (const [slot, value] of [[0n, FUND_SETUP_SAFE_L2], [keccak256(toUtf8Bytes('guard_manager.guard.address')), ZERO], [keccak256(toUtf8Bytes('fallback_manager.handler.address')), ZERO]] as const) add('getStorageAt', [slot, 1], [`0x${value.slice(2).padStart(64, '0')}`])
  const configurationHash = expectedConfigurationHash ?? fundSetupHash({ ...settings, owners })
  if (!/^[0-9a-f]{64}$/.test(configurationHash)) return fail('SETUP_CONFIGURATION_HASH_INVALID')
  return { version: 1, chain_id: 80002, step_key: 'safe_creation', kind: 'CALL', sender: from, nonce: n, value: '0', to: FUND_SETUP_SAFE_FACTORY.address,
    data: factory.encodeFunctionData('createProxyWithNonce', [FUND_SETUP_SAFE_L2, initializer, uint(settings.salt_nonce)]), expected_address: expected,
    artifact_name: 'SafeProxy', expected_runtime_hash: FUND_SETUP_SAFE_PROXY_HASH, checks, configuration_hash: configurationHash, catalog_hash: FUND_SETUP_CATALOG_HASH }
}
/** Requires root-owned narrow eth_getTransactionCount transport support. */
export async function readSetupNonce(sender: string, options: FundSetupObservers = {}): Promise<string> {
  const from = address(sender), sources = await observers(options), pairs = await Promise.all(sources.map(s => Promise.all([
    s.rpc(s.url, 'eth_getTransactionCount', [from, 'latest']).then(quantity), s.rpc(s.url, 'eth_getTransactionCount', [from, 'pending']).then(quantity),
  ])))
  const nonces = pairs.flat()
  if (nonces.some(n => n !== nonces[0]) || nonces[0] >= 2n ** 64n) return fail('SETUP_NONCE_OBSERVERS_DISAGREE', 503)
  return nonces[0].toString()
}
/** Exact pinned proxy initcode, one shared salt, no guessed addresses. */
export function predictFundSuite(factory: string, salt: string, authority: string, token: { name: string; symbol: string; decimals: number; onchain_id: string }) {
  if (!salt || salt.length > 160 || !token.name || token.name.length > 200 || !token.symbol || token.symbol.length > 24 || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) return fail('SETUP_PRODUCT_SALT_OR_TERMS_INVALID')
  const from = address(factory), ia = address(authority), salted = keccak256(toUtf8Bytes(salt))
  const make = (artifact: FundSetupArtifactName, args: unknown[]) => getCreate2Address(from, salted, keccak256(canonicalFundCreation(artifact, args))).toLowerCase()
  const trusted_issuers = make('TrustedIssuersRegistryProxy', [ia]), claim_topics = make('ClaimTopicsRegistryProxy', [ia]), compliance = make('ModularComplianceProxy', [ia]), identity_storage = make('IdentityRegistryStorageProxy', [ia])
  const identity_registry = make('IdentityRegistryProxy', [ia, trusted_issuers, claim_topics, identity_storage])
  return { trusted_issuers, claim_topics, compliance, identity_storage, identity_registry, token: make('TokenProxy', [ia, identity_registry, compliance, token.name, token.symbol, token.decimals, address(token.onchain_id)]) }
}
