import 'server-only'
import { createHash } from 'node:crypto'
import { Interface, Signature, TypedDataEncoder, keccak256, recoverAddress, toUtf8Bytes } from 'ethers'
import { z } from 'zod'
import { FUNDING_RPC_URLS, createFundingRpc } from './funding-verifier'
import { fundIntentSchema, type FundTransactionIntent } from './fund-lifecycle-contracts'

/** Source selection is not a deployed release or provider/governance admission. No address defaults. */
export const FUND_CONTRACT_RELEASE = {
  repository: 'https://github.com/ERC-3643/ERC-3643', version: '4.1.3',
  commit: 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4', package: '@erc3643org/erc-3643@4.1.3',
  compiler: '0.8.17', optimizer_runs: 200, controller_version: 'BX1_FUND_CONTROLLER_V1',
} as const
const ZERO = `0x${'0'.repeat(40)}`
const ZERO_HASH = `0x${'0'.repeat(64)}`
const SENTINEL = '0x0000000000000000000000000000000000000001'
const MAX_UINT = (1n << 256n) - 1n
const hex = (value: bigint) => `0x${value.toString(16)}`
const id = z.string().uuid()
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) <= MAX_UINT)
const positive = uint.refine(value => BigInt(value) > 0n)
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => value !== ZERO)
const anyAddress = z.string().regex(/^0x[0-9a-f]{40}$/)
const hash = z.string().regex(/^0x[0-9a-f]{64}$/).refine(value => value !== ZERO_HASH)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const bytes = z.string().regex(/^0x(?:[0-9a-f]{2})*$/).max(131074)
const contract = z.object({ address, runtime_hash: hash }).strict()
const proxy = contract.extend({ implementation_address: address, implementation_runtime_hash: hash }).strict()
const readback = z.object({ data: bytes.refine(value => value.length >= 10), result: bytes.refine(value => value.length >= 66) }).strict()
/** Initially only non-delegating immutable dependencies and the pinned ONCHAINID proxy mechanism are supported. */
const dependency = contract.extend({
  code_kind: z.enum(['IMMUTABLE', 'ONCHAINID_PROXY']), release_evidence_id: id, governance_evidence_id: id,
  governance_readbacks: z.array(readback).min(1).max(30),
  implementation: contract.nullable(),
  implementation_authority: contract.extend({ owner: address }).strict().nullable(),
  implementation_version: z.literal('2.2.1').nullable(),
}).strict()
const complianceModule = dependency.extend({
  /** Exact admitted getter calls/results proving effective module settings, not merely module addresses. */
  settings_readbacks: z.array(readback).min(1).max(30),
}).strict()
const suite = z.object({ token: proxy, identity_registry: proxy, identity_storage: proxy,
  trusted_issuers: proxy, claim_topics: proxy, compliance: proxy }).strict()
const details = z.object({ owner: address, name: z.string().min(1).max(200), symbol: z.string().min(1).max(24),
  decimals: z.number().int().min(0).max(18), irs: z.literal(ZERO), onchain_id: address, onchain_id_runtime_hash: hash,
  onchain_id_binding: dependency,
  identity_agents: z.array(address).min(1).max(5), token_agents: z.array(address).length(1),
  compliance_modules: z.array(complianceModule).min(1).max(30), compliance_settings: z.array(bytes).max(30),
  claim_topics: z.array(positive).min(1).max(5),
  claim_issuers: z.array(dependency.extend({ topics: z.array(positive).min(1).max(5) }).strict()).min(1).max(5),
}).strict()
const common = z.object({
  version: z.literal(1), operation_id: id, operation_revision: z.number().int().positive(),
  product_id: id, offering_revision_id: id, class_id: id, environment: z.literal('TESTNET'), chain_id: z.literal(80002),
  binding_hash: digest, authority_policy_hash: digest, authority_epoch: z.number().int().positive(),
  expires_at: z.string().datetime({ offset: true }), signer_address: address,
  /** Only an owner-admitted immutable server projection may populate this object. Never parse a browser manifest. */
  manifest: z.object({
    id, revision: z.number().int().positive(), hash: digest, product_binding_hash: digest, status: z.literal('ADMITTED'),
    release_commit: z.literal(FUND_CONTRACT_RELEASE.commit), release_version: z.literal(FUND_CONTRACT_RELEASE.version),
    governance_evidence_id: id, conformance_evidence_id: id, network_evidence_id: id,
    required_confirmations: z.number().int().min(1).max(10000),
    safe: contract.extend({ singleton: contract, owners: z.array(address).min(2).max(20),
      threshold: z.number().int().min(2).max(20), nonce: uint, guard: anyAddress, fallback_handler: anyAddress }).strict(),
    controller: contract, factory: contract, implementation_authority: contract.extend({ owner: address,
      version: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]) }).strict(),
    suite, token_details: details, maximum_supply: positive, maximum_operation_units: positive,
    /** Durable role/indexer admission is separate from a single receipt. */
    role_state_evidence_id: id,
  }).strict(),
  safe_transaction: z.object({ nonce: uint, safe_tx_gas: uint }).strict(),
})
export const fundChainExpectationSchema = z.discriminatedUnion('kind', [
  common.extend({ kind: z.literal('DEPLOYMENT'), deployment: z.object({ salt: z.string().min(1).max(160) }).strict() }).strict(),
  common.extend({ kind: z.literal('ISSUANCE'), issuance: z.object({ allocation_id: id, subscription_id: id,
    investment_account_id: id, wallet_proof_id: id, eligibility_evidence_id: id, reconciliation_evidence_id: id,
    recipient: address, units_base: positive, previous_reconciled_supply: uint, previous_reconciled_balance: uint,
    chain_snapshot_block: uint, chain_snapshot_hash: hash }).strict() }).strict(),
])
export type FundChainExpectation = z.infer<typeof fundChainExpectationSchema>
type Rpc = (url: string, method: string, params: unknown[]) => Promise<unknown>
export type FundChainDependencies = { rpc?: Rpc; now?: () => number }
const ACTIONS: Record<string, string> = {
  CANONICAL_FUND_MANIFEST_NOT_ADMITTED: 'The approved fund contract and institutional signing configuration must be connected before deployment.',
  FUND_SIGNING_AUTHORITY_EXPIRED: 'This signing request expired. Return to the saved fund operation for a renewed approval.',
  INSTITUTIONAL_GOVERNANCE_CHANGED: 'The institutional owners, nonce or authority changed. Refresh the saved operation; do not reuse its signatures.',
  CHAIN_REGISTER_RECONCILIATION_REQUIRED: 'The token supply or investor balance changed. Finance and the Transfer Agent must reconcile the existing operation first.',
  FUND_TRANSACTION_PENDING_OR_UNKNOWN: 'The transaction is not confirmed yet. Keep the existing operation and wait; do not send another transaction.',
  FUND_TRANSACTION_CONFIRMING: 'The transaction was found but is still waiting for finality. Keep the existing operation.',
  FUND_RECIPIENT_OR_ISSUANCE_NOT_ADMITTED: 'The delivery wallet, identity, compliance or fund activation requirements have not passed.',
  FUND_OPERATION_ALREADY_EXECUTED: 'This operation has already executed. Refresh its evidence instead of signing it again.',
  FUND_NETWORK_OBSERVATION_UNAVAILABLE: 'The network could not be independently verified. Keep this operation and retry observation, not payment or issuance.',
  INDEPENDENT_PROVIDER_DISAGREEMENT: 'The independent network observations disagree. This operation needs reconciliation before continuing.',
}
export class FundChainError extends Error {
  public readonly action: string
  constructor(public readonly code: string, public readonly status = 409) {
    const action = ACTIONS[code] ?? 'The saved fund instruction and observed contract effects do not match. Keep this operation for review; do not create a replacement transaction.'
    super(action); this.action = action
  }
}
const reject = (code: string, status = 409): never => { throw new FundChainError(code, status) }
function rpcFor(dependencies: FundChainDependencies): Rpc {
  const source = dependencies.rpc ?? createFundingRpc()
  return async (url, method, params) => {
    try { return await source(url, method, params) }
    catch (error) { if (error instanceof FundChainError) throw error; return reject('FUND_NETWORK_OBSERVATION_UNAVAILABLE', 503) }
  }
}

/** Minimal selectors copied from the exact upstream interfaces, not a substitute for its complete ABI. */
export const TREX_FACTORY_ABI = [
  'function deployTREXSuite(string salt,(address owner,string name,string symbol,uint8 decimals,address irs,address ONCHAINID,address[] irAgents,address[] tokenAgents,address[] complianceModules,bytes[] complianceSettings) tokenDetails,(uint256[] claimTopics,address[] issuers,uint256[][] issuerClaims) claimDetails)',
  'function getToken(string salt) view returns (address)', 'function getImplementationAuthority() view returns (address)',
  'function owner() view returns (address)',
  'event TREXSuiteDeployed(address indexed token,address ir,address irs,address tir,address ctr,address mc,string indexed salt)',
] as const
const tokenTuple = '(address owner,string name,string symbol,uint8 decimals,address irs,address ONCHAINID,address[] irAgents,address[] tokenAgents,address[] complianceModules,bytes[] complianceSettings)'
const claimTuple = '(uint256[] claimTopics,address[] issuers,uint256[][] issuerClaims)'
const FACTORY = new Interface(TREX_FACTORY_ABI)
const CONTROLLER = new Interface([
  `function deployFund(bytes32 operationId,bytes32 bindingHash,bytes32 productBindingHash,uint256 epoch,uint256 expiresAt,string salt,${tokenTuple} tokenDetails,${claimTuple} claimDetails,uint256 maximumSupply,uint256 maximumOperationUnits)`,
  'function issueFund(bytes32 operationId,bytes32 bindingHash,bytes32 productBindingHash,uint256 epoch,uint256 expiresAt,address token,address recipient,uint256 units,uint256 expectedSupply,uint256 expectedBalance)',
  'function institutionalAuthority() view returns(address)', 'function factory() view returns(address)',
  'function releaseConfigurationHash() view returns(bytes32)', 'function authorityEpoch() view returns(uint256)',
  'function paused() view returns(bool)', 'function executedOperations(bytes32) view returns(bool)', 'function revokedOperations(bytes32) view returns(bool)',
  'function fundBindings(address) view returns(bytes32)', 'function maximumSupply(address) view returns(uint256)',
  'function maximumOperationUnits(address) view returns(uint256)',
  'event FundDeployed(bytes32 indexed operationId,bytes32 indexed bindingHash,address indexed token,address identityRegistry,uint256 maximumSupply,uint256 maximumOperationUnits)',
  'event FundIssued(bytes32 indexed operationId,bytes32 indexed bindingHash,address indexed token,address recipient,uint256 units,uint256 supplyAfter,uint256 balanceAfter)',
])
const SAFE = new Interface([
  'function getOwners() view returns(address[])', 'function getThreshold() view returns(uint256)', 'function nonce() view returns(uint256)',
  'function getModulesPaginated(address start,uint256 pageSize) view returns(address[] array,address next)',
  'function getStorageAt(uint256 offset,uint256 length) view returns(bytes)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool success)',
  'event ExecutionSuccess(bytes32 txHash,uint256 payment)', 'event ExecutionFailure(bytes32 txHash,uint256 payment)',
])
const TOKEN = new Interface(['function name() view returns(string)', 'function symbol() view returns(string)',
  'function decimals() view returns(uint8)', 'function totalSupply() view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function owner() view returns(address)', 'function isAgent(address) view returns(bool)', 'function paused() view returns(bool)',
  'function identityRegistry() view returns(address)', 'function compliance() view returns(address)',
  'function onchainID() view returns(address)', 'event Transfer(address indexed from,address indexed to,uint256 value)'])
const REGISTRY = new Interface(['function owner() view returns(address)', 'function isAgent(address) view returns(bool)',
  'function identityStorage() view returns(address)', 'function issuersRegistry() view returns(address)', 'function topicsRegistry() view returns(address)',
  'function isVerified(address) view returns(bool)', 'function linkedIdentityRegistries() view returns(address[])',
  'function getClaimTopics() view returns(uint256[])', 'function getTrustedIssuers() view returns(address[])',
  'function getTrustedIssuerClaimTopics(address) view returns(uint256[])',
  'function getModules() view returns(address[])', 'function getTokenBound() view returns(address)', 'function canTransfer(address,address,uint256) view returns(bool)'])
const PROXY = new Interface(['function getImplementationAuthority() view returns(address)'])
const ONCHAINID = new Interface(['function implementationAuthority() view returns(address)', 'function getImplementation() view returns(address)',
  'function owner() view returns(address)', 'function version() view returns(string)'])
const IA = new Interface(['function owner() view returns(address)', 'function getCurrentVersion() view returns(tuple(uint8 major,uint8 minor,uint8 patch))',
  'function getTokenImplementation() view returns(address)', 'function getIRImplementation() view returns(address)',
  'function getIRSImplementation() view returns(address)', 'function getTIRImplementation() view returns(address)',
  'function getCTRImplementation() view returns(address)', 'function getMCImplementation() view returns(address)'])
const SAFE_TYPES = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
  { name: 'operation', type: 'uint8' }, { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' },
  { name: 'gasPrice', type: 'uint256' }, { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }

const lower = (value: unknown) => String(value).toLowerCase()
function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : reject('MALFORMED_CHAIN_RESPONSE', 503) }
function quantity(value: unknown): bigint { return typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && BigInt(value) <= MAX_UINT ? BigInt(value) : reject('MALFORMED_CHAIN_QUANTITY', 503) }
function checkedHash(value: unknown): string { return hash.safeParse(lower(value)).success ? lower(value) : reject('MALFORMED_CHAIN_HASH', 503) }
function block(value: unknown) {
  const b = object(value), timestamp = quantity(b.timestamp)
  if (timestamp > 8_640_000_000_000n) reject('MALFORMED_CHAIN_TIMESTAMP', 503)
  return { number: quantity(b.number), hash: checkedHash(b.hash), timestamp, transactions: b.transactions }
}
function agree<T>(observations: T[]): T { return observations.length === 2 && JSON.stringify(observations[0]) === JSON.stringify(observations[1]) ? observations[0] : reject('INDEPENDENT_PROVIDER_DISAGREEMENT', 503) }
function operationKey(e: FundChainExpectation) { return keccak256(toUtf8Bytes(e.operation_id)) }
function binding(e: FundChainExpectation) { return `0x${e.binding_hash}` }
function releaseHash() { return keccak256(toUtf8Bytes(`${FUND_CONTRACT_RELEASE.commit}:${FUND_CONTRACT_RELEASE.controller_version}`)) }
export function fundExpectationHash(e: FundChainExpectation): string { return createHash('sha256').update(JSON.stringify(fundChainExpectationSchema.parse(e))).digest('hex') }

function validated(value: unknown, now: () => number, signing: boolean): FundChainExpectation {
  const parsed = fundChainExpectationSchema.safeParse(value)
  if (!parsed.success) return reject('CANONICAL_FUND_MANIFEST_NOT_ADMITTED')
  const e = parsed.data, m = e.manifest, d = m.token_details
  if (signing && Date.parse(e.expires_at) <= now()) reject('FUND_SIGNING_AUTHORITY_EXPIRED')
  if (m.safe.threshold > m.safe.owners.length || new Set(m.safe.owners).size !== m.safe.owners.length
    || !m.safe.owners.includes(e.signer_address) || e.safe_transaction.nonce !== m.safe.nonce
    || d.owner !== m.safe.address || d.token_agents[0] !== m.controller.address
    || d.identity_agents.includes(m.controller.address) || new Set(d.identity_agents).size !== d.identity_agents.length
    || d.onchain_id_binding.address !== d.onchain_id || d.onchain_id_binding.runtime_hash !== d.onchain_id_runtime_hash
    || d.compliance_modules.some(module => module.code_kind !== 'IMMUTABLE')
    || d.compliance_settings.length > d.compliance_modules.length
    || new Set(d.claim_topics).size !== d.claim_topics.length || new Set(d.claim_issuers.map(x => x.address)).size !== d.claim_issuers.length
    || d.claim_issuers.some(x => x.topics.some(topic => !d.claim_topics.includes(topic)))
    || d.claim_topics.some(topic => !d.claim_issuers.some(x => x.topics.includes(topic)))
    || BigInt(m.maximum_operation_units) > BigInt(m.maximum_supply)) reject('FUND_GOVERNANCE_BINDING_INVALID')
  const all = [m.safe.address, m.controller.address, m.factory.address, m.implementation_authority.address, ...Object.values(m.suite).map(x => x.address)]
  if (new Set(all).size !== all.length) reject('FUND_CONTRACT_ADDRESSES_OVERLAP')
  for (const item of [...d.compliance_modules, ...d.claim_issuers, d.onchain_id_binding]) {
    if (item.code_kind === 'IMMUTABLE' && (item.implementation !== null || item.implementation_authority !== null || item.implementation_version !== null)) reject('DEPENDENCY_IMPLEMENTATION_BINDING_INVALID')
    if (item.code_kind === 'ONCHAINID_PROXY' && (!item.implementation || !item.implementation_authority || !item.implementation_version
      || item.address === item.implementation.address || item.address === item.implementation_authority.address
      || item.implementation.address === item.implementation_authority.address)) reject('DEPENDENCY_IMPLEMENTATION_BINDING_INVALID')
  }
  if (e.kind === 'ISSUANCE' && (BigInt(e.issuance.units_base) > BigInt(m.maximum_operation_units)
    || BigInt(e.issuance.previous_reconciled_supply) + BigInt(e.issuance.units_base) > BigInt(m.maximum_supply))) reject('FUND_ISSUANCE_LIMIT_EXCEEDED')
  return e
}
function targetData(e: FundChainExpectation): string {
  const m = e.manifest, d = m.token_details, expiry = Math.floor(Date.parse(e.expires_at) / 1000)
  const productBinding = `0x${m.product_binding_hash}`
  if (e.kind === 'ISSUANCE') return CONTROLLER.encodeFunctionData('issueFund', [operationKey(e), binding(e), productBinding, e.authority_epoch, expiry,
    m.suite.token.address, e.issuance.recipient, e.issuance.units_base, e.issuance.previous_reconciled_supply, e.issuance.previous_reconciled_balance])
  return CONTROLLER.encodeFunctionData('deployFund', [operationKey(e), binding(e), productBinding, e.authority_epoch, expiry, e.deployment.salt,
    [d.owner, d.name, d.symbol, d.decimals, d.irs, d.onchain_id, d.identity_agents, d.token_agents, d.compliance_modules.map(x => x.address), d.compliance_settings],
    [d.claim_topics, d.claim_issuers.map(x => x.address), d.claim_issuers.map(x => x.topics)], m.maximum_supply, m.maximum_operation_units])
}
function safePayload(e: FundChainExpectation) { return { to: e.manifest.controller.address, value: '0' as const, data: targetData(e), operation: 0 as const,
  safeTxGas: e.safe_transaction.safe_tx_gas, baseGas: '0', gasPrice: '0', gasToken: ZERO, refundReceiver: ZERO, nonce: e.safe_transaction.nonce } }
function safeHash(e: FundChainExpectation) { return TypedDataEncoder.hash({ chainId: e.chain_id, verifyingContract: e.manifest.safe.address }, SAFE_TYPES, safePayload(e)) }
/** Cryptographic evidence only. The signature worker must separately recheck the current person/mandate/epoch. */
export function verifyFundOwnerSignature(value: unknown, rawSignature: string, expectedSigner: string, now: () => number = Date.now) {
  const e = validated(value, now, true), raw = rawSignature.toLowerCase(), owner = expectedSigner.toLowerCase()
  if (!e.manifest.safe.owners.includes(owner) || !/^0x[0-9a-f]{130}$/.test(raw) || !['1b', '1c'].includes(raw.slice(-2))) reject('SAFE_TYPED_SIGNATURE_REQUIRED')
  let recovered: string
  try { recovered = lower(recoverAddress(safeHash(e), Signature.from(raw))) } catch { return reject('SAFE_OWNER_SIGNATURE_INVALID') }
  if (recovered !== owner) reject('SAFE_OWNER_SIGNATURE_INVALID')
  return { version: 1 as const, operation_id: e.operation_id, operation_revision: e.operation_revision,
    expectation_hash: fundExpectationHash(e), intent_hash: safeHash(e).slice(2), binding_hash: e.binding_hash,
    authority_epoch: e.authority_epoch, recovered_address: recovered, signature: raw }
}
async function read(rpc: Rpc, url: string, target: string, iface: Interface, method: string, args: unknown[], height: bigint) {
  const result = await rpc(url, 'eth_call', [{ to: target, data: iface.encodeFunctionData(method, args) }, hex(height)])
  if (typeof result !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(result) || result.length > 131074) reject('CONTRACT_READ_UNAVAILABLE', 503)
  try { return iface.decodeFunctionResult(method, result) } catch { return reject('CONTRACT_READ_MALFORMED', 503) }
}
async function code(rpc: Rpc, url: string, item: { address: string; runtime_hash: string }, height: bigint) {
  const result = await rpc(url, 'eth_getCode', [item.address, hex(height)])
  if (typeof result !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(result) || result.length > 131074 || keccak256(result) !== item.runtime_hash) reject('MANIFEST_RUNTIME_MISMATCH')
  return result
}
function requireImmutableRuntime(runtime: string) {
  // Skip PUSH data and recognised trailing Solidity CBOR metadata, not arbitrary
  // bytes. An undeclared delegate/callcode/metamorphic mechanism fails closed.
  const raw = runtime.slice(2), fullLength = raw.length / 2
  const metadataLength = fullLength >= 2 ? Number.parseInt(raw.slice(-4), 16) : 0
  let length = fullLength
  if (metadataLength > 0 && metadataLength + 2 < fullLength) {
    const first = Number.parseInt(raw.slice((fullLength - metadataLength - 2) * 2, (fullLength - metadataLength - 1) * 2), 16)
    if (first >= 0xa0 && first <= 0xbf) length -= metadataLength + 2
  }
  for (let offset = 0; offset < length; offset++) {
    const opcode = Number.parseInt(raw.slice(offset * 2, offset * 2 + 2), 16)
    if ([0xf2, 0xf4, 0xff].includes(opcode)) reject('DEPENDENCY_UPGRADEABLE_RUNTIME_NOT_ADMITTED')
    if (opcode >= 0x60 && opcode <= 0x7f) offset += opcode - 0x5f
  }
}
async function dependencyAt(rpc: Rpc, url: string, item: z.infer<typeof dependency>, height: bigint) {
  const runtime = await code(rpc, url, item, height)
  if (item.code_kind === 'IMMUTABLE') requireImmutableRuntime(runtime)
  else {
    const implementation = item.implementation!, authority = item.implementation_authority!
    const [implementationRuntime, authorityRuntime, proxyAuthority, authorityImplementation, owner, version] = await Promise.all([
      code(rpc, url, implementation, height), code(rpc, url, authority, height),
      read(rpc, url, item.address, ONCHAINID, 'implementationAuthority', [], height),
      read(rpc, url, authority.address, ONCHAINID, 'getImplementation', [], height),
      read(rpc, url, authority.address, ONCHAINID, 'owner', [], height), read(rpc, url, item.address, ONCHAINID, 'version', [], height),
    ])
    requireImmutableRuntime(implementationRuntime); requireImmutableRuntime(authorityRuntime)
    if (lower(proxyAuthority[0]) !== authority.address || lower(authorityImplementation[0]) !== implementation.address
      || lower(owner[0]) !== authority.owner || version[0] !== item.implementation_version) reject('DEPENDENCY_IMPLEMENTATION_OR_GOVERNANCE_CHANGED')
  }
  for (const check of item.governance_readbacks) {
    if (lower(await rpc(url, 'eth_call', [{ to: item.address, data: check.data }, hex(height)])) !== check.result) reject('DEPENDENCY_GOVERNANCE_STATE_CHANGED')
  }
}
async function finalizedHeads(rpc: Rpc) {
  return Promise.all(FUNDING_RPC_URLS.map(async url => {
    const [chain, result] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
    if (quantity(chain) !== 80002n) reject('WRONG_FUND_NETWORK', 503)
    if (result === null) reject('FUND_FINALITY_UNAVAILABLE', 503)
    const b = block(result), confirmed = block(await rpc(url, 'eth_getBlockByNumber', [hex(b.number), false]))
    if (confirmed.hash !== b.hash || confirmed.number !== b.number) reject('FINALIZED_HEAD_MISMATCH', 503)
    return { url, block: b }
  }))
}
async function governanceAt(rpc: Rpc, url: string, e: FundChainExpectation, height: bigint, signing: boolean) {
  const m = e.manifest
  await Promise.all([m.safe, m.safe.singleton, m.controller, m.factory, m.implementation_authority].map(x => code(rpc, url, x, height)))
  const values = await Promise.all([
    read(rpc, url, m.safe.address, SAFE, 'getOwners', [], height), read(rpc, url, m.safe.address, SAFE, 'getThreshold', [], height),
    read(rpc, url, m.safe.address, SAFE, 'nonce', [], height), read(rpc, url, m.safe.address, SAFE, 'getModulesPaginated', [SENTINEL, 100], height),
    read(rpc, url, m.safe.address, SAFE, 'getStorageAt', [0, 1], height),
    read(rpc, url, m.safe.address, SAFE, 'getStorageAt', [keccak256(toUtf8Bytes('guard_manager.guard.address')), 1], height),
    read(rpc, url, m.safe.address, SAFE, 'getStorageAt', [keccak256(toUtf8Bytes('fallback_manager.handler.address')), 1], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'institutionalAuthority', [], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'factory', [], height), read(rpc, url, m.controller.address, CONTROLLER, 'releaseConfigurationHash', [], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'authorityEpoch', [], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'revokedOperations', [operationKey(e)], height),
    read(rpc, url, m.factory.address, FACTORY, 'owner', [], height), read(rpc, url, m.factory.address, FACTORY, 'getImplementationAuthority', [], height),
    read(rpc, url, m.implementation_authority.address, IA, 'owner', [], height), read(rpc, url, m.implementation_authority.address, IA, 'getCurrentVersion', [], height),
  ])
  const storedAddress = (value: unknown) => { const raw = lower(value); return /^0x[0-9a-f]{64}$/.test(raw) && raw.slice(2, 26) === '0'.repeat(24) ? `0x${raw.slice(-40)}` : reject('SAFE_STORAGE_MALFORMED') }
  const nonce = BigInt(values[2][0])
  if (JSON.stringify([...values[0][0]].map(lower).sort()) !== JSON.stringify([...m.safe.owners].sort()) || Number(values[1][0]) !== m.safe.threshold
    || (signing ? nonce !== BigInt(e.safe_transaction.nonce) : nonce < BigInt(e.safe_transaction.nonce) + 1n)
    || values[3][0].length !== 0 || lower(values[3][1]) !== SENTINEL || storedAddress(values[4][0]) !== m.safe.singleton.address
    || storedAddress(values[5][0]) !== m.safe.guard || storedAddress(values[6][0]) !== m.safe.fallback_handler
    || lower(values[7][0]) !== m.safe.address || lower(values[8][0]) !== m.factory.address || lower(values[9][0]) !== releaseHash()
    || Number(values[10][0]) !== e.authority_epoch || values[11][0] !== false || lower(values[12][0]) !== m.controller.address
    || lower(values[13][0]) !== m.implementation_authority.address || lower(values[14][0]) !== m.implementation_authority.owner
    || JSON.stringify([...values[15][0]].map(Number)) !== JSON.stringify(m.implementation_authority.version)) reject('INSTITUTIONAL_GOVERNANCE_CHANGED')
  if (signing && (await read(rpc, url, m.controller.address, CONTROLLER, 'executedOperations', [operationKey(e)], height))[0]) reject('FUND_OPERATION_ALREADY_EXECUTED')
}
async function implementationsAt(rpc: Rpc, url: string, e: FundChainExpectation, height: bigint) {
  const m = e.manifest, s = m.suite
  const selectors = ['getTokenImplementation', 'getIRImplementation', 'getIRSImplementation', 'getTIRImplementation', 'getCTRImplementation', 'getMCImplementation']
  const pieces = [s.token, s.identity_registry, s.identity_storage, s.trusted_issuers, s.claim_topics, s.compliance]
  await Promise.all(pieces.map(async (item, i) => {
    await code(rpc, url, { address: item.implementation_address, runtime_hash: item.implementation_runtime_hash }, height)
    if (lower((await read(rpc, url, m.implementation_authority.address, IA, selectors[i], [], height))[0]) !== item.implementation_address) reject('SUITE_IMPLEMENTATION_MISMATCH')
  }))
  await Promise.all([...m.token_details.compliance_modules, ...m.token_details.claim_issuers,
    m.token_details.onchain_id_binding].map(x => dependencyAt(rpc, url, x, height)))
}
async function suiteAt(rpc: Rpc, url: string, e: FundChainExpectation, height: bigint) {
  const m = e.manifest, s = m.suite, d = m.token_details
  const selectors = ['getTokenImplementation', 'getIRImplementation', 'getIRSImplementation', 'getTIRImplementation', 'getCTRImplementation', 'getMCImplementation']
  const pieces = [s.token, s.identity_registry, s.identity_storage, s.trusted_issuers, s.claim_topics, s.compliance]
  await Promise.all(pieces.map(async (item, i) => {
    await Promise.all([code(rpc, url, item, height), code(rpc, url, { address: item.implementation_address, runtime_hash: item.implementation_runtime_hash }, height)])
    const [authority, implementation, owner] = await Promise.all([
      read(rpc, url, item.address, PROXY, 'getImplementationAuthority', [], height),
      read(rpc, url, m.implementation_authority.address, IA, selectors[i], [], height), read(rpc, url, item.address, REGISTRY, 'owner', [], height),
    ])
    if (lower(authority[0]) !== m.implementation_authority.address || lower(implementation[0]) !== item.implementation_address || lower(owner[0]) !== m.safe.address) reject('SUITE_IMPLEMENTATION_OR_OWNER_MISMATCH')
  }))
  await Promise.all([...d.compliance_modules, ...d.claim_issuers,
    d.onchain_id_binding].map(x => dependencyAt(rpc, url, x, height)))
  const values = await Promise.all([
    read(rpc, url, s.token.address, TOKEN, 'name', [], height), read(rpc, url, s.token.address, TOKEN, 'symbol', [], height),
    read(rpc, url, s.token.address, TOKEN, 'decimals', [], height), read(rpc, url, s.token.address, TOKEN, 'onchainID', [], height),
    read(rpc, url, s.token.address, TOKEN, 'identityRegistry', [], height), read(rpc, url, s.token.address, TOKEN, 'compliance', [], height),
    read(rpc, url, s.identity_registry.address, REGISTRY, 'identityStorage', [], height), read(rpc, url, s.identity_registry.address, REGISTRY, 'issuersRegistry', [], height),
    read(rpc, url, s.identity_registry.address, REGISTRY, 'topicsRegistry', [], height), read(rpc, url, s.identity_storage.address, REGISTRY, 'linkedIdentityRegistries', [], height),
    read(rpc, url, s.claim_topics.address, REGISTRY, 'getClaimTopics', [], height), read(rpc, url, s.trusted_issuers.address, REGISTRY, 'getTrustedIssuers', [], height),
    read(rpc, url, s.compliance.address, REGISTRY, 'getModules', [], height), read(rpc, url, s.compliance.address, REGISTRY, 'getTokenBound', [], height),
    read(rpc, url, s.token.address, TOKEN, 'isAgent', [m.controller.address], height),
  ])
  const equalSet = (actual: Iterable<unknown>, expected: string[]) => JSON.stringify([...actual].map(lower).sort()) === JSON.stringify([...expected].sort())
  if (values[0][0] !== d.name || values[1][0] !== d.symbol || Number(values[2][0]) !== d.decimals || lower(values[3][0]) !== d.onchain_id
    || lower(values[4][0]) !== s.identity_registry.address || lower(values[5][0]) !== s.compliance.address
    || lower(values[6][0]) !== s.identity_storage.address || lower(values[7][0]) !== s.trusted_issuers.address || lower(values[8][0]) !== s.claim_topics.address
    || !equalSet(values[9][0], [s.identity_registry.address]) || !equalSet(values[10][0], d.claim_topics)
    || !equalSet(values[11][0], d.claim_issuers.map(x => x.address)) || !equalSet(values[12][0], d.compliance_modules.map(x => x.address))
    || lower(values[13][0]) !== s.token.address || values[14][0] !== true) reject('FUND_TOKEN_CONFIGURATION_MISMATCH')
  for (const issuer of d.claim_issuers) if (!equalSet((await read(rpc, url, s.trusted_issuers.address, REGISTRY, 'getTrustedIssuerClaimTopics', [issuer.address], height))[0], issuer.topics)) reject('CLAIM_ISSUER_TOPICS_MISMATCH')
  for (const module of d.compliance_modules) for (const check of module.settings_readbacks) {
    if (lower(await rpc(url, 'eth_call', [{ to: module.address, data: check.data }, hex(height)])) !== check.result) reject('COMPLIANCE_MODULE_SETTINGS_MISMATCH')
  }
  const limits = await Promise.all([
    read(rpc, url, m.controller.address, CONTROLLER, 'fundBindings', [s.token.address], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'maximumSupply', [s.token.address], height),
    read(rpc, url, m.controller.address, CONTROLLER, 'maximumOperationUnits', [s.token.address], height),
  ])
  if (lower(limits[0][0]) !== `0x${m.product_binding_hash}` || limits[1][0].toString() !== m.maximum_supply
    || limits[2][0].toString() !== m.maximum_operation_units) reject('CONTROLLER_PRODUCT_LIMITS_MISMATCH')
  // AgentRole is not enumerable. Exclusive-agent history must also remain reconciled by the admitted indexer.
  for (const human of [...m.safe.owners, m.safe.address, m.factory.address]) if ((await read(rpc, url, s.token.address, TOKEN, 'isAgent', [human], height))[0]) reject('HUMAN_OR_FACTORY_HAS_ROUTINE_MINT_AUTHORITY')
  for (const agent of d.identity_agents) if (!(await read(rpc, url, s.identity_registry.address, REGISTRY, 'isAgent', [agent], height))[0]) reject('IDENTITY_AGENT_MISMATCH')
}

/** Performs reads only. The guarded DB must persist this exact intent/hash BEFORE the browser prompts a signer. */
export async function prepareFundTransaction(value: unknown, dependencies: FundChainDependencies = {}): Promise<FundTransactionIntent> {
  const now = dependencies.now ?? Date.now, e = validated(value, now, true), rpc = rpcFor(dependencies)
  const heads = await finalizedHeads(rpc), height = heads.reduce((min, p) => p.block.number < min ? p.block.number : min, heads[0].block.number)
  const facts = await Promise.all(heads.map(async p => {
    const b = block(await rpc(p.url, 'eth_getBlockByNumber', [hex(height), false]))
    await governanceAt(rpc, p.url, e, height, true)
    if (e.kind === 'DEPLOYMENT') {
      await implementationsAt(rpc, p.url, e, height)
      if ((await read(rpc, p.url, e.manifest.controller.address, CONTROLLER, 'paused', [], height))[0]) reject('FUND_CONTROLLER_PAUSED')
      if (lower((await read(rpc, p.url, e.manifest.factory.address, FACTORY, 'getToken', [e.deployment.salt], height))[0]) !== ZERO) reject('FUND_DEPLOYMENT_SALT_ALREADY_USED')
      for (const item of Object.values(e.manifest.suite)) if (await rpc(p.url, 'eth_getCode', [item.address, hex(height)]) !== '0x') reject('EXPECTED_FUND_ADDRESS_ALREADY_OCCUPIED')
    } else {
      await suiteAt(rpc, p.url, e, height)
      const i = e.issuance, s = e.manifest.suite, snapshot = block(await rpc(p.url, 'eth_getBlockByNumber', [hex(BigInt(i.chain_snapshot_block)), false]))
      if (snapshot.hash !== i.chain_snapshot_hash || snapshot.number > height) reject('RECONCILED_CHAIN_SNAPSHOT_CHANGED')
      const [supply, balance, eligible, compliance, paused, controllerPaused, currentBinding] = await Promise.all([
        read(rpc, p.url, s.token.address, TOKEN, 'totalSupply', [], height), read(rpc, p.url, s.token.address, TOKEN, 'balanceOf', [i.recipient], height),
        read(rpc, p.url, s.identity_registry.address, REGISTRY, 'isVerified', [i.recipient], height),
        read(rpc, p.url, s.compliance.address, REGISTRY, 'canTransfer', [ZERO, i.recipient, i.units_base], height),
        read(rpc, p.url, s.token.address, TOKEN, 'paused', [], height), read(rpc, p.url, e.manifest.controller.address, CONTROLLER, 'paused', [], height),
        read(rpc, p.url, e.manifest.controller.address, CONTROLLER, 'fundBindings', [s.token.address], height),
      ])
      if (supply[0].toString() !== i.previous_reconciled_supply || balance[0].toString() !== i.previous_reconciled_balance) reject('CHAIN_REGISTER_RECONCILIATION_REQUIRED')
      if (!eligible[0] || !compliance[0] || paused[0] || controllerPaused[0] || lower(currentBinding[0]) !== `0x${e.manifest.product_binding_hash}`) reject('FUND_RECIPIENT_OR_ISSUANCE_NOT_ADMITTED')
    }
    return { height: height.toString(), hash: b.hash }
  }))
  agree(facts); validated(e, now, true)
  const tx = safePayload(e)
  return fundIntentSchema.parse({ operation_id: e.operation_id, operation_revision: e.operation_revision, kind: e.kind,
    intent_hash: safeHash(e).slice(2), binding_hash: e.binding_hash, authority_policy_hash: e.authority_policy_hash,
    authority_epoch: e.authority_epoch, expires_at: e.expires_at, chain_id: e.chain_id, signer_address: e.signer_address,
    execution_account: e.manifest.safe.address, target_address: e.manifest.controller.address, transaction_data: tx.data,
    value_base_units: '0', execution_mode: 'SAFE_TRANSACTION', safe_transaction: tx })
}

export type FundChainObservation = {
  version: 1; status: 'FINAL' | 'REVERTED'; kind: 'DEPLOYMENT' | 'ISSUANCE'; operation_id: string;
  operation_revision: number; expectation_hash: string; intent_hash: string; binding_hash: string; product_binding_hash: string; manifest_hash: string;
  chain_id: 80002; transaction_hash: string; block_number: string; block_hash: string; block_timestamp: string;
  transaction_index: number; confirmations: number; execution_account: string; token_address: string; controller_address: string;
  inner_execution_success: boolean; controller_log_index: number | null; token_log_index: number | null;
  supply_after: string | null; balance_after: string | null; recipient: string | null; units_base: string | null;
  providers: { url: string; finalized_block_number: string; finalized_block_hash: string }[];
}
function logsAt(receipt: Record<string, unknown>, txHash: string, blockNumber: bigint, blockHash: string) {
  if (!Array.isArray(receipt.logs) || receipt.logs.length > 4096) reject('MALFORMED_FUND_LOGS', 503)
  return receipt.logs.map(value => {
    const log = object(value)
    if (log.removed !== false || checkedHash(log.transactionHash) !== txHash || checkedHash(log.blockHash) !== blockHash || quantity(log.blockNumber) !== blockNumber
      || !Array.isArray(log.topics) || log.topics.length > 4 || typeof log.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)) reject('FUND_LOG_CANONICAL_IDENTITY_MISMATCH')
    const topics = log.topics.map(value => { const result = lower(value); return /^0x[0-9a-f]{64}$/.test(result) ? result : reject('FUND_LOG_TOPIC_MALFORMED') })
    const index = quantity(log.logIndex)
    if (index > 2_147_483_647n) reject('FUND_LOG_INDEX_MALFORMED')
    return { address: lower(log.address), topics, data: log.data, index: Number(index) }
  })
}
function exactEvent(logs: ReturnType<typeof logsAt>, target: string, iface: Interface, name: string) {
  const found = logs.filter(log => log.address === target && log.topics[0] === lower(iface.getEvent(name)!.topicHash))
  if (found.length !== 1) return reject('EXPECTED_FUND_EVENT_NOT_UNIQUE')
  try { return { args: iface.decodeEventLog(name, found[0].data, found[0].topics), index: found[0].index } } catch { return reject('FUND_EVENT_MALFORMED') }
}
function verifiedSafeCall(e: FundChainExpectation, input: unknown) {
  if (typeof input !== 'string' || input.length > 131074) reject('SAFE_TRANSACTION_CALL_MISMATCH')
  let call: ReturnType<Interface['decodeFunctionData']>
  try { call = SAFE.decodeFunctionData('execTransaction', input) } catch { return reject('SAFE_TRANSACTION_CALL_MISMATCH') }
  const tx = safePayload(e), expected = [tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver]
  if (expected.some((value, i) => lower(call[i]) !== lower(value))) reject('SAFE_TRANSACTION_CALL_MISMATCH')
  const raw = lower(call[9]), count = e.manifest.safe.threshold
  if (!/^0x[0-9a-f]+$/.test(raw) || raw.length !== 2 + count * 130) reject('SAFE_HUMAN_SIGNATURE_THRESHOLD_MISMATCH')
  const signers: string[] = []
  for (let i = 0; i < count; i++) {
    try {
      const encoded = raw.slice(2 + i * 130, 2 + (i + 1) * 130)
      if (!['1b', '1c'].includes(encoded.slice(-2))) reject('SAFE_TYPED_SIGNATURE_REQUIRED')
      const signature = Signature.from(`0x${encoded}`)
      if (signature.v !== 27 && signature.v !== 28) reject('SAFE_TYPED_SIGNATURE_REQUIRED')
      const signer = lower(recoverAddress(safeHash(e), signature))
      if (!e.manifest.safe.owners.includes(signer) || (signers.length && signer <= signers[signers.length - 1])) reject('SAFE_OWNER_SIGNATURE_INVALID')
      signers.push(signer)
    } catch (error) { if (error instanceof FundChainError) throw error; return reject('SAFE_OWNER_SIGNATURE_INVALID') }
  }
  // Reject ABI tails and alternate encodings rather than hashing a partial decoded call.
  if (SAFE.encodeFunctionData('execTransaction', [...expected, raw]).toLowerCase() !== input.toLowerCase()) reject('SAFE_TRANSACTION_NONCANONICAL_CALL')
}

/** Returns evidence only. No readiness, journal, register or holding is written by this adapter. */
export async function verifyFundTransaction(value: unknown, transactionHash: string, dependencies: FundChainDependencies = {}): Promise<FundChainObservation> {
  const now = dependencies.now ?? Date.now, e = validated(value, now, false), txHash = checkedHash(transactionHash), rpc = rpcFor(dependencies)
  const providers = await finalizedHeads(rpc)
  const observations = await Promise.all(providers.map(async p => {
    const [rawReceipt, rawTx] = await Promise.all([rpc(p.url, 'eth_getTransactionReceipt', [txHash]), rpc(p.url, 'eth_getTransactionByHash', [txHash])])
    if (rawReceipt === null || rawTx === null) reject('FUND_TRANSACTION_PENDING_OR_UNKNOWN', 202)
    const receipt = object(rawReceipt), tx = object(rawTx), height = quantity(receipt.blockNumber), blockHash = checkedHash(receipt.blockHash)
    const rawIndex = quantity(receipt.transactionIndex)
    if (rawIndex > 2_147_483_647n) reject('FUND_TRANSACTION_INDEX_MALFORMED')
    const index = Number(rawIndex), confirmed = p.block.number - height + 1n
    if (height > p.block.number || confirmed < BigInt(e.manifest.required_confirmations)) reject('FUND_TRANSACTION_CONFIRMING', 202)
    const b = block(await rpc(p.url, 'eth_getBlockByNumber', [hex(height), false]))
    if (b.number !== height || b.hash !== blockHash || !Array.isArray(b.transactions) || lower(b.transactions[index]) !== txHash
      || checkedHash(receipt.transactionHash) !== txHash || checkedHash(tx.hash) !== txHash || checkedHash(tx.blockHash) !== blockHash
      || quantity(tx.blockNumber) !== height || quantity(tx.transactionIndex) !== BigInt(index) || lower(tx.to) !== e.manifest.safe.address
      || lower(receipt.to) !== e.manifest.safe.address || lower(tx.from) !== e.signer_address || lower(receipt.from) !== e.signer_address
      || quantity(tx.value) !== 0n || (tx.chainId !== undefined && quantity(tx.chainId) !== 80002n)) reject('FUND_TRANSACTION_IDENTITY_MISMATCH')
    verifiedSafeCall(e, tx.input)
    const logs = logsAt(receipt, txHash, height, blockHash), status = quantity(receipt.status)
    const base = { block_number: height.toString(), block_hash: blockHash, block_timestamp: new Date(Number(b.timestamp) * 1000).toISOString(),
      transaction_index: index, token_address: e.manifest.suite.token.address, controller_address: e.manifest.controller.address,
      controller_log_index: null as number | null, token_log_index: null as number | null, supply_after: null as string | null,
      balance_after: null as string | null, recipient: null as string | null, units_base: null as string | null }
    if (status === 0n) {
      if (logs.length) reject('REVERTED_TRANSACTION_HAS_EFFECTS')
      return { ...base, status: 'REVERTED' as const, inner_execution_success: false }
    }
    if (status !== 1n) reject('INVALID_FUND_RECEIPT_STATUS')
    const safeFailures = logs.filter(log => log.address === e.manifest.safe.address && log.topics[0] === lower(SAFE.getEvent('ExecutionFailure')!.topicHash))
    if (safeFailures.length) {
      const failure = exactEvent(logs, e.manifest.safe.address, SAFE, 'ExecutionFailure')
      if (lower(failure.args[0]) !== safeHash(e) || BigInt(failure.args[1]) !== 0n || logs.some(log => log.address === e.manifest.controller.address || log.address === e.manifest.suite.token.address)) reject('INCONSISTENT_SAFE_INNER_FAILURE')
      return { ...base, status: 'REVERTED' as const, inner_execution_success: false }
    }
    const success = exactEvent(logs, e.manifest.safe.address, SAFE, 'ExecutionSuccess')
    if (lower(success.args[0]) !== safeHash(e) || BigInt(success.args[1]) !== 0n) reject('SAFE_INNER_SUCCESS_MISMATCH')
    if (b.timestamp > BigInt(Math.floor(Date.parse(e.expires_at) / 1000))) reject('FUND_EXECUTED_AFTER_EXPIRY')
    await Promise.all([governanceAt(rpc, p.url, e, height, false), suiteAt(rpc, p.url, e, height)])
    if (!(await read(rpc, p.url, e.manifest.controller.address, CONTROLLER, 'executedOperations', [operationKey(e)], height))[0]) reject('CONTROLLER_OPERATION_NOT_EXECUTED')
    const event = exactEvent(logs, e.manifest.controller.address, CONTROLLER, e.kind === 'DEPLOYMENT' ? 'FundDeployed' : 'FundIssued')
    if (lower(event.args[0]) !== operationKey(e) || lower(event.args[1]) !== binding(e) || lower(event.args[2]) !== e.manifest.suite.token.address) reject('CONTROLLER_OPERATION_BINDING_MISMATCH')
    const supply = (await read(rpc, p.url, e.manifest.suite.token.address, TOKEN, 'totalSupply', [], height))[0].toString()
    if (e.kind === 'DEPLOYMENT') {
      const deployed = exactEvent(logs, e.manifest.factory.address, FACTORY, 'TREXSuiteDeployed')
      const addresses = [e.manifest.suite.token.address, e.manifest.suite.identity_registry.address, e.manifest.suite.identity_storage.address,
        e.manifest.suite.trusted_issuers.address, e.manifest.suite.claim_topics.address, e.manifest.suite.compliance.address]
      if (addresses.some((target, i) => lower(deployed.args[i]) !== target) || lower(deployed.args[6].hash) !== keccak256(toUtf8Bytes(e.deployment.salt))
        || lower(event.args[3]) !== e.manifest.suite.identity_registry.address || event.args[4].toString() !== e.manifest.maximum_supply
        || event.args[5].toString() !== e.manifest.maximum_operation_units || supply !== '0'
        || logs.some(log => log.address === e.manifest.suite.token.address && log.topics[0] === lower(TOKEN.getEvent('Transfer')!.topicHash))) reject('FUND_DEPLOYMENT_EFFECTS_MISMATCH')
      if (lower((await read(rpc, p.url, e.manifest.factory.address, FACTORY, 'getToken', [e.deployment.salt], height))[0]) !== addresses[0]) reject('FACTORY_TOKEN_BINDING_MISMATCH')
      return { ...base, status: 'FINAL' as const, inner_execution_success: true, controller_log_index: event.index, supply_after: supply }
    }
    const i = e.issuance, mint = exactEvent(logs, e.manifest.suite.token.address, TOKEN, 'Transfer')
    const balance = (await read(rpc, p.url, e.manifest.suite.token.address, TOKEN, 'balanceOf', [i.recipient], height))[0].toString()
    if (lower(mint.args[0]) !== ZERO || lower(mint.args[1]) !== i.recipient || mint.args[2].toString() !== i.units_base
      || lower(event.args[3]) !== i.recipient || event.args[4].toString() !== i.units_base
      || event.args[5].toString() !== supply || event.args[6].toString() !== balance
      || BigInt(supply) !== BigInt(i.previous_reconciled_supply) + BigInt(i.units_base)
      || BigInt(balance) !== BigInt(i.previous_reconciled_balance) + BigInt(i.units_base)) reject('FUND_ISSUANCE_EFFECTS_MISMATCH')
    return { ...base, status: 'FINAL' as const, inner_execution_success: true, controller_log_index: event.index, token_log_index: mint.index,
      supply_after: supply, balance_after: balance, recipient: i.recipient, units_base: i.units_base }
  }))
  const facts = agree(observations)
  // Recheck admitted code/authority at the lowest current finalised head too; receipt-block correctness alone is insufficient.
  if (facts.status === 'FINAL') {
    const height = providers.reduce((min, p) => p.block.number < min ? p.block.number : min, providers[0].block.number)
    await Promise.all(providers.map(async p => { await governanceAt(rpc, p.url, e, height, false); await suiteAt(rpc, p.url, e, height) }))
  }
  return { version: 1, ...facts, kind: e.kind, operation_id: e.operation_id, operation_revision: e.operation_revision,
    expectation_hash: fundExpectationHash(e), intent_hash: safeHash(e).slice(2), binding_hash: e.binding_hash,
    product_binding_hash: e.manifest.product_binding_hash, manifest_hash: e.manifest.hash,
    chain_id: 80002, transaction_hash: txHash, execution_account: e.manifest.safe.address,
    confirmations: Number(providers.reduce((min, p) => p.block.number < min ? p.block.number : min, providers[0].block.number) - BigInt(facts.block_number) + 1n),
    providers: providers.map(p => ({ url: p.url, finalized_block_number: p.block.number.toString(), finalized_block_hash: p.block.hash })) }
}
