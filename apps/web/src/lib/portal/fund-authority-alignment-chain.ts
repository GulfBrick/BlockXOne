import 'server-only'
import { Interface, Signature, TypedDataEncoder, keccak256, recoverAddress, toUtf8Bytes } from 'ethers'
import { fundAdmissionInputSchema, fundAdmissionRpc, readFundAdmissionSnapshot, recheckFundAdmissionSnapshot, type FundAdmissionSnapshot } from './fund-chain-admission'
import { canonicalFundRuntime, FUND_SETUP_CATALOG_HASH, getOfficialSafeArtifact } from './fund-setup-artifacts'
import { FUND_SETUP_SAFE_PROXY_RUNTIME, FUND_SETUP_SAFE_SINGLETONS, fundSetupHash, observeSetupSafe, type FundSetupObservers } from './fund-setup-chain'
import { createFundAuthorityAlignmentReadSchema, fundAuthorityAlignmentIntentSchema, fundAuthorityAlignmentObservationSchema,
  fundAuthoritySignatureSchema, fundAuthoritySafeTypes, type FundAuthorityAlignmentIntent, type FundAuthorityAlignmentRead,
  type FundAuthorityAlignmentObservation, type FundAuthoritySignature } from './fund-authority-alignment-contracts'
import { portalContextMatches } from './operating-context'
import { FUNDING_RPC_URLS } from './funding-verifier'

const ZERO = `0x${'0'.repeat(40)}`, SENTINEL = `0x${'0'.repeat(39)}1`
const HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n
const SAFE = new Interface(getOfficialSafeArtifact('Safe').abi)
const CONTROLLER = new Interface([
  'function advanceAuthorityEpoch(uint256 nextEpoch,bytes32 reasonHash)', 'function authorityEpoch() view returns(uint256)',
  'function institutionalAuthority() view returns(address)', 'function factory() view returns(address)', 'function paused() view returns(bool)',
  'event AuthorityEpochAdvanced(uint256 previousEpoch,uint256 currentEpoch,bytes32 reasonHash)',
])
const readSchema = createFundAuthorityAlignmentReadSchema(fundAdmissionInputSchema)
const hex = (value: bigint | string) => `0x${BigInt(value).toString(16)}`
type Rpc = ReturnType<typeof fundAdmissionRpc>
type Row = Record<string, unknown>
export type FundAuthorityAlignmentOptions = FundSetupObservers & { signal?: AbortSignal; now?: () => number }
export class FundAuthorityAlignmentChainError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super('The saved authority transition could not be independently verified. Keep its original request and transaction history.')
  }
}
function fail(code: string, status = 409): never { throw new FundAuthorityAlignmentChainError(code, status) }
function row(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : fail('ALIGNMENT_RPC_RECORD_INVALID', 503) }
function address(value: unknown): string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && value.toLowerCase() !== ZERO
    ? value.toLowerCase() : fail('ALIGNMENT_ADDRESS_INVALID', 503)
}
function hash(value: unknown): string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value)
    ? value.toLowerCase() : fail('ALIGNMENT_HASH_INVALID', 503)
}
function quantity(value: unknown): bigint {
  return typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)
    ? BigInt(value) : fail('ALIGNMENT_RPC_QUANTITY_INVALID', 503)
}
function comparable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(comparable)
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item)])) : value
}
function same<T>(values: T[]): T {
  if (values.length !== 2 || fundSetupHash(comparable(values[0])) !== fundSetupHash(comparable(values[1]))) return fail('ALIGNMENT_OBSERVERS_DISAGREE', 503)
  return values[0]
}
function header(value: unknown, expected?: bigint) {
  const data = row(value), number = quantity(data.number), seconds = quantity(data.timestamp)
  if (expected !== undefined && number !== expected || seconds > 8640000000000n) return fail('ALIGNMENT_BLOCK_INVALID', 503)
  return { number: number.toString(), hash: hash(data.hash), timestamp: new Date(Number(seconds) * 1000).toISOString() }
}
/** One bounded read phase; even injected transports cannot add endpoints or writes. */
async function bounded<T>(options: FundAuthorityAlignmentOptions, task: (rpc: Rpc, now: () => number) => Promise<T>): Promise<T> {
  const now = options.now ?? Date.now, started = now(), abort = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
  const timer = setTimeout(() => abort.abort(), 90_000), source = fundAdmissionRpc(options)
  let calls = 0
  const rpc: Rpc = async (url, method, params) => {
    if (!FUNDING_RPC_URLS.includes(url as typeof FUNDING_RPC_URLS[number])
      || !['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount', 'eth_getCode', 'eth_call', 'eth_getStorageAt', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'].includes(method)) return fail('ALIGNMENT_RPC_NOT_ALLOWED', 503)
    if (signal.aborted || now() - started >= 90_000) return fail('ALIGNMENT_DEADLINE_EXCEEDED', 503)
    if (++calls > 128) return fail('ALIGNMENT_CALL_BUDGET_EXCEEDED', 503)
    let stop: (() => void) | undefined
    try {
      return await Promise.race([source(url, method, params), new Promise<never>((_, reject) => {
        stop = () => reject(new FundAuthorityAlignmentChainError('ALIGNMENT_DEADLINE_EXCEEDED', 503))
        signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
      })])
    } catch (error) {
      if (error instanceof FundAuthorityAlignmentChainError) throw error
      return fail('ALIGNMENT_OBSERVATION_UNAVAILABLE', 503)
    } finally { if (stop) signal.removeEventListener('abort', stop) }
  }
  try { return await task(rpc, now) }
  catch (error) {
    if (signal.aborted || now() - started >= 90_000) return fail('ALIGNMENT_DEADLINE_EXCEEDED', 503)
    if (error instanceof FundAuthorityAlignmentChainError) throw error
    return fail('ALIGNMENT_OBSERVATION_UNAVAILABLE', 503)
  }
  finally { clearTimeout(timer); abort.abort() }
}
function binding(raw: unknown, now: () => number) {
  const parsed = readSchema.safeParse(raw)
  if (!parsed.success) return fail('ALIGNMENT_READ_INVALID')
  const read = parsed.data, input = read.input, saved = input.setup.setup, policy = input.setup.roleplay_policy, c = saved?.configuration
  if (!saved || !c || !policy || input.setup.environment !== 'TESTNET' || input.setup.actor_id !== read.actor_id
    || !portalContextMatches(input.setup.operating_context, read.operating_context) || saved.actor_id !== read.actor_id
    || !portalContextMatches(saved.operating_context, read.operating_context) || saved.id !== read.setup_id || saved.revision !== read.setup_revision
    || saved.state !== 'COMPLETE_NOT_ADMITTED' || saved.recovery_hold || saved.safe_state !== 'VERIFIED' || saved.safe_address !== c.safe_address
    || policy.epoch !== input.authority_epoch
    || Date.parse(read.authority_expires_at) <= now() || Date.parse(saved.expires_at) <= now() || Date.parse(policy.expires_at) <= now()
    || !saved.steps.every(step => step.state === 'FINAL' && step.intent && step.transaction_hash && step.observation_id && step.intent.catalog_hash === FUND_SETUP_CATALOG_HASH)
    || !saved.safe_owners.includes(input.signer_address) || saved.safe_threshold === null || /^0x0{64}$/.test(read.reason_hash)) return fail('ALIGNMENT_AUTHORITY_CHANGED')
  const controller = saved.dependencies.controller, factory = saved.dependencies.trex_factory
  if (!controller || !factory || controller === c.safe_address || controller === factory) return fail('ALIGNMENT_DEPENDENCY_MISSING')
  const runtime = canonicalFundRuntime('Bx1FundController', { institutionalAuthority: c.safe_address, factory })
  const controllerStep = saved.steps.find(step => step.step_key === 'controller')
  if (controllerStep?.intent?.expected_address !== controller || controllerStep.intent.expected_runtime_hash !== keccak256(runtime)) return fail('ALIGNMENT_CONTROLLER_BINDING_CHANGED')
  const validUntil = Date.parse(saved.expires_at) <= Date.parse(policy.expires_at) ? saved.expires_at : policy.expires_at
  return { read, input, saved, c, controller, factory, runtimeHash: keccak256(runtime), validUntil, target: input.authority_epoch }
}
type Binding = ReturnType<typeof binding>
async function call(rpc: Rpc, url: string, target: string, abi: Interface, method: string, args: unknown[], at: string) {
  const raw = await rpc(url, 'eth_call', [{ to: target, data: abi.encodeFunctionData(method, args).toLowerCase() }, at])
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(raw)) return fail('ALIGNMENT_GETTER_INVALID', 503)
  try { return abi.decodeFunctionResult(method, raw) } catch { return fail('ALIGNMENT_GETTER_INVALID', 503) }
}
async function controllerAt(rpc: Rpc, url: string, b: Binding, at: string) {
  const [code, institution, factory, epoch, paused] = await Promise.all([
    rpc(url, 'eth_getCode', [b.controller, at]), call(rpc, url, b.controller, CONTROLLER, 'institutionalAuthority', [], at),
    call(rpc, url, b.controller, CONTROLLER, 'factory', [], at), call(rpc, url, b.controller, CONTROLLER, 'authorityEpoch', [], at),
    call(rpc, url, b.controller, CONTROLLER, 'paused', [], at),
  ])
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code) !== b.runtimeHash
    || address(institution[0]) !== b.c.safe_address || address(factory[0]) !== b.factory || paused[0] !== false
    || BigInt(epoch[0]) < 1n || BigInt(epoch[0]) > BigInt(Number.MAX_SAFE_INTEGER)) return fail('ALIGNMENT_CONTROLLER_GOVERNANCE_CHANGED')
  return Number(epoch[0])
}
function safeFacts(safe: Awaited<ReturnType<typeof observeSetupSafe>>) {
  return { address: safe.address, owners: safe.owners, threshold: safe.threshold, nonce: safe.nonce,
    singleton: safe.singleton.address, guard: safe.guard, fallback: safe.fallback_handler }
}
async function safeAt(rpc: Rpc, url: string, safeAddress: string, at: string) {
  const [runtime, owners, threshold, nonce, modules, singleton, guard, fallback] = await Promise.all([
    rpc(url, 'eth_getCode', [safeAddress, at]), call(rpc, url, safeAddress, SAFE, 'getOwners', [], at),
    call(rpc, url, safeAddress, SAFE, 'getThreshold', [], at), call(rpc, url, safeAddress, SAFE, 'nonce', [], at),
    call(rpc, url, safeAddress, SAFE, 'getModulesPaginated', [SENTINEL, 100], at), call(rpc, url, safeAddress, SAFE, 'getStorageAt', [0, 1], at),
    call(rpc, url, safeAddress, SAFE, 'getStorageAt', [keccak256(toUtf8Bytes('guard_manager.guard.address')), 1], at),
    call(rpc, url, safeAddress, SAFE, 'getStorageAt', [keccak256(toUtf8Bytes('fallback_manager.handler.address')), 1], at),
  ])
  const stored = (value: unknown) => {
    if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(value)) return fail('ALIGNMENT_SAFE_STORAGE_INVALID', 503)
    return `0x${value.slice(-40)}`.toLowerCase()
  }
  const implementation = stored(singleton[0]), pinned = FUND_SETUP_SAFE_SINGLETONS[implementation as keyof typeof FUND_SETUP_SAFE_SINGLETONS]
  const code = await rpc(url, 'eth_getCode', [implementation, at]), list = [...owners[0]].map(address).sort(), t = BigInt(threshold[0])
  if (typeof runtime !== 'string' || runtime.toLowerCase() !== FUND_SETUP_SAFE_PROXY_RUNTIME || !pinned || typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code) !== pinned
    || list.length < 2 || new Set(list).size !== list.length || t < 2n || t > BigInt(list.length) || t > 20n
    || modules[0].length !== 0 || String(modules[1]).toLowerCase() !== SENTINEL || stored(guard[0]) !== ZERO || stored(fallback[0]) !== ZERO) return fail('ALIGNMENT_SAFE_GOVERNANCE_CHANGED')
  return { address: safeAddress, owners: list, threshold: Number(t), nonce: String(nonce[0]), singleton: implementation, guard: ZERO, fallback: ZERO }
}
function checkedIntent(raw: unknown): FundAuthorityAlignmentIntent {
  const parsed = fundAuthorityAlignmentIntentSchema.safeParse(raw)
  if (!parsed.success) return fail('ALIGNMENT_INTENT_INVALID')
  const intent = parsed.data
  if (/^0x0{64}$/.test(intent.reason_hash) || intent.safe_address === intent.controller_address
    || intent.controller_runtime_hash !== keccak256(canonicalFundRuntime('Bx1FundController', { institutionalAuthority: intent.safe_address, factory: intent.factory_address }))
    || intent.safe_transaction.data !== CONTROLLER.encodeFunctionData('advanceAuthorityEpoch', [intent.target_epoch, intent.reason_hash]).toLowerCase()
    || TypedDataEncoder.hash({ chainId: 80002, verifyingContract: intent.safe_address }, fundAuthoritySafeTypes, intent.safe_transaction).toLowerCase() !== intent.safe_transaction_hash) return fail('ALIGNMENT_INTENT_INVALID')
  return intent
}
function boundIntent(raw: unknown, b: Binding) {
  const intent = checkedIntent(raw)
  if (intent.admission_request_id !== b.read.admission_request_id || intent.native_binding_hash !== b.read.native_binding_hash
    || intent.reason_hash !== b.read.reason_hash || intent.target_epoch !== b.target || intent.previous_epoch !== b.target - 1
    || intent.controller_address !== b.controller || intent.controller_runtime_hash !== b.runtimeHash || intent.factory_address !== b.factory
    || intent.safe_address !== b.c.safe_address || fundSetupHash(intent.safe_owners) !== fundSetupHash([...b.saved.safe_owners].sort())
    || intent.safe_threshold !== b.saved.safe_threshold || intent.executor_address !== b.input.signer_address
    || Date.parse(intent.valid_until) !== Date.parse(b.validUntil)
    || b.read.operation?.intent && fundSetupHash(b.read.operation.intent) !== fundSetupHash(intent)) return fail('ALIGNMENT_INTENT_BINDING_CHANGED')
  return intent
}
/** Preparation is read-only and never replaces an existing immutable intent. */
export async function prepareFundAuthorityAlignment(raw: FundAuthorityAlignmentRead, options: FundAuthorityAlignmentOptions = {}) {
  return bounded(options, async (rpc, now) => {
    const b = binding(raw, now), op = b.read.operation
    if (op && !['NEW', 'PREPARED', 'SIGNING'].includes(op.state) || op?.claimed_at || op?.transaction_hash) return fail('ALIGNMENT_ORIGINAL_EXECUTION_REQUIRED')
    const safe = await observeSetupSafe(b.c.safe_address, { rpc })
    if (safe.address !== b.saved.safe_address || safe.threshold !== b.saved.safe_threshold || safe.guard !== ZERO || safe.fallback_handler !== ZERO
      || fundSetupHash(safe.owners) !== fundSetupHash([...b.saved.safe_owners].sort())) return fail('ALIGNMENT_SAFE_GOVERNANCE_CHANGED')
    const headers = await Promise.all(FUNDING_RPC_URLS.map(url => rpc(url, 'eth_getBlockByNumber', [hex(safe.block_number), false]).then(value => header(value, BigInt(safe.block_number)))))
    const common = same(headers)
    if (common.hash !== safe.block_hash) return fail('ALIGNMENT_CANONICAL_BLOCK_CHANGED', 503)
    const snapshot: FundAdmissionSnapshot = { block: common, providers: safe.providers }
    const current = same(await Promise.all(FUNDING_RPC_URLS.map(async url => {
      const atEpoch = await controllerAt(rpc, url, b, hex(common.number)), currentEpoch = await controllerAt(rpc, url, b, 'latest')
      const latestSafe = await safeAt(rpc, url, b.c.safe_address, 'latest')
      if (atEpoch !== currentEpoch || fundSetupHash(latestSafe) !== fundSetupHash(safeFacts(safe))) return fail('ALIGNMENT_GOVERNANCE_CHANGED_DURING_CHECKS')
      const [latest, pending, anchorNonce] = await Promise.all([rpc(url, 'eth_getTransactionCount', [b.input.signer_address, 'latest']),
        rpc(url, 'eth_getTransactionCount', [b.input.signer_address, 'pending']), rpc(url, 'eth_getTransactionCount', [b.input.signer_address, hex(common.number)])])
      const nonce = quantity(latest)
      if (quantity(pending) !== nonce || quantity(anchorNonce) > nonce || nonce >= 2n ** 64n) return fail('ALIGNMENT_EXECUTOR_NONCE_UNAVAILABLE')
      return { epoch: currentEpoch, nonce: nonce.toString() }
    })))
    await recheckFundAdmissionSnapshot(rpc, snapshot)
    if (current.epoch === b.target) {
      if (op && (op.state !== 'NEW' || op.intent || op.signatures.length || op.claimed_at)) return fail('ALIGNMENT_ORIGINAL_EXECUTION_REQUIRED')
      return { already_aligned: true, intent: null }
    }
    if (current.epoch !== b.target - 1 || b.target <= 1) return fail('ALIGNMENT_EPOCH_GAP_NOT_SUPPORTED')
    if (op?.intent) {
      const intent = boundIntent(op.intent, b)
      if (intent.executor_nonce !== current.nonce || intent.safe_transaction.nonce !== safe.nonce || Date.parse(intent.valid_until) <= now()) return fail('ALIGNMENT_SAVED_NONCE_CHANGED')
      return { already_aligned: false, intent }
    }
    if (op && (op.state !== 'NEW' || op.intent_hash || op.signatures.length)) return fail('ALIGNMENT_SAVED_INTENT_REQUIRED')
    const transaction = { to: b.controller, value: '0' as const, data: CONTROLLER.encodeFunctionData('advanceAuthorityEpoch', [b.target, b.read.reason_hash]).toLowerCase(),
      operation: 0 as const, safeTxGas: '0' as const, baseGas: '0' as const, gasPrice: '0' as const, gasToken: ZERO, refundReceiver: ZERO, nonce: safe.nonce }
    const intent = fundAuthorityAlignmentIntentSchema.parse({ version: 1, chain_id: 80002, admission_request_id: b.read.admission_request_id,
      native_binding_hash: b.read.native_binding_hash, reason_hash: b.read.reason_hash, previous_epoch: current.epoch, target_epoch: b.target,
      controller_address: b.controller, controller_runtime_hash: b.runtimeHash, factory_address: b.factory,
      safe_address: safe.address, safe_owners: safe.owners, safe_threshold: safe.threshold, executor_address: b.input.signer_address, executor_nonce: current.nonce,
      safe_transaction: transaction, safe_transaction_hash: TypedDataEncoder.hash({ chainId: 80002, verifyingContract: safe.address }, fundAuthoritySafeTypes, transaction).toLowerCase(),
      snapshot, valid_until: b.validUntil })
    if (Date.parse(intent.valid_until) <= now()) return fail('ALIGNMENT_AUTHORITY_EXPIRED')
    return { already_aligned: false, intent }
  })
}
/** ECDSA evidence is not current native authority; the caller reauthorises separately. */
export function verifyFundAuthorityAlignmentSignature(raw: FundAuthorityAlignmentIntent, signerAddress: string, rawSignature: string): FundAuthoritySignature {
  const intent = checkedIntent(raw), candidate = fundAuthoritySignatureSchema.safeParse({ signer: signerAddress, signature: rawSignature })
  if (!candidate.success || !intent.safe_owners.includes(signerAddress) || Date.parse(intent.valid_until) <= Date.now()) return fail('ALIGNMENT_SAFE_SIGNATURE_INVALID')
  const signature = candidate.data.signature
  try {
    const s = BigInt(`0x${signature.slice(66, 130)}`), parsed = Signature.from(signature)
    if (s < 1n || s > HALF_ORDER || ![27, 28].includes(parsed.v) || parsed.serialized.toLowerCase() !== signature
      || recoverAddress(intent.safe_transaction_hash, parsed).toLowerCase() !== signerAddress) return fail('ALIGNMENT_SAFE_SIGNATURE_INVALID')
  } catch { return fail('ALIGNMENT_SAFE_SIGNATURE_INVALID') }
  return candidate.data
}
export function buildSignedFundAuthorityAlignmentTransaction(raw: FundAuthorityAlignmentIntent, signatures: FundAuthoritySignature[]) {
  const intent = checkedIntent(raw)
  if (signatures.length !== intent.safe_threshold || new Set(signatures.map(item => item.signer)).size !== signatures.length) return fail('ALIGNMENT_SAFE_THRESHOLD_NOT_MET')
  const verified = signatures.map(item => verifyFundAuthorityAlignmentSignature(intent, item.signer, item.signature)).sort((a, b) => a.signer.localeCompare(b.signer))
  const s = intent.safe_transaction, packed = `0x${verified.map(item => item.signature.slice(2)).join('')}`
  return { chain_id: 80002 as const, from: intent.executor_address, to: intent.safe_address, value: '0' as const,
    data: SAFE.encodeFunctionData('execTransaction', [s.to, s.value, s.data, s.operation, s.safeTxGas, s.baseGas, s.gasPrice, s.gasToken, s.refundReceiver, packed]).toLowerCase(), nonce: intent.executor_nonce }
}
function transaction(raw: unknown) {
  const tx = row(raw)
  if (typeof tx.input !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(tx.input) || tx.input.length > 262146) return fail('ALIGNMENT_TRANSACTION_INVALID', 503)
  const chain = quantity(tx.chainId)
  if (chain > BigInt(Number.MAX_SAFE_INTEGER)) return fail('ALIGNMENT_TRANSACTION_INVALID', 503)
  return { hash: hash(tx.hash), from: address(tx.from), to: tx.to === null ? null : address(tx.to), input: tx.input.toLowerCase(),
    nonce: quantity(tx.nonce).toString(), value: quantity(tx.value).toString(), chain_id: Number(chain),
    block_number: quantity(tx.blockNumber).toString(), block_hash: hash(tx.blockHash), index: quantity(tx.transactionIndex).toString() }
}
function checkTransaction(tx: ReturnType<typeof transaction>, intent: FundAuthorityAlignmentIntent, execution: ReturnType<typeof buildSignedFundAuthorityAlignmentTransaction>, expectedHash: string) {
  if (tx.hash !== expectedHash || tx.chain_id !== 80002 || tx.from !== intent.executor_address || tx.to !== intent.safe_address
    || tx.nonce !== intent.executor_nonce || tx.value !== '0' || tx.input !== execution.data) return fail('ALIGNMENT_TRANSACTION_MISMATCH')
}
function normalizedReceipt(raw: unknown) {
  const receipt = row(raw), status = quantity(receipt.status), index = quantity(receipt.transactionIndex)
  if ((status !== 0n && status !== 1n) || index > 2147483647n || receipt.contractAddress !== null || !Array.isArray(receipt.logs) || receipt.logs.length > 8192) return fail('ALIGNMENT_RECEIPT_INVALID', 503)
  const result = { hash: hash(receipt.transactionHash), from: address(receipt.from), to: address(receipt.to), status: status.toString(),
    block_number: quantity(receipt.blockNumber).toString(), block_hash: hash(receipt.blockHash), index: index.toString() }
  const logs = receipt.logs.map(value => {
    const log = row(value)
    if (log.removed !== false || !Array.isArray(log.topics) || log.topics.length > 4 || typeof log.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(log.data)
      || log.data.length > 262146 || hash(log.transactionHash) !== result.hash || hash(log.blockHash) !== result.block_hash
      || quantity(log.blockNumber).toString() !== result.block_number || quantity(log.transactionIndex).toString() !== result.index) return fail('ALIGNMENT_EVENT_BINDING_INVALID', 503)
    const topics = log.topics.map(value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : fail('ALIGNMENT_EVENT_BINDING_INVALID', 503))
    return { address: address(log.address), topics, data: log.data.toLowerCase(), log_index: quantity(log.logIndex).toString() }
  })
  if (new Set(logs.map(log => log.log_index)).size !== logs.length) return fail('ALIGNMENT_EVENT_BINDING_INVALID', 503)
  return { ...result, logs }
}
function exactEvent(receipt: ReturnType<typeof normalizedReceipt>, at: string, abi: Interface, name: string) {
  const topic = abi.getEvent(name)!.topicHash.toLowerCase(), logs = receipt.logs.filter(log => log.address === at && log.topics[0] === topic)
  if (logs.length !== 1) return fail('ALIGNMENT_EVENT_MISSING_OR_AMBIGUOUS')
  try { return abi.decodeEventLog(name, logs[0].data, logs[0].topics) } catch { return fail('ALIGNMENT_EVENT_INVALID') }
}
export async function observeFundAuthorityAlignment(raw: FundAuthorityAlignmentRead, savedIntent: FundAuthorityAlignmentIntent,
  signatures: FundAuthoritySignature[], transactionHash: string, options: FundAuthorityAlignmentOptions = {}): Promise<FundAuthorityAlignmentObservation> {
  return bounded(options, async (rpc, now) => {
    const b = binding(raw, now), intent = boundIntent(savedIntent, b), expectedHash = hash(transactionHash)
    if (!b.read.operation?.claimed_at || !b.read.operation.intent || b.read.operation.executor_nonce !== intent.executor_nonce
      || !['UNKNOWN', 'BROADCAST', 'PENDING', 'FINAL', 'REVERTED', 'RECOVERY_REQUIRED'].includes(b.read.operation.state)) return fail('ALIGNMENT_OBSERVATION_NOT_CLAIMED')
    const execution = buildSignedFundAuthorityAlignmentTransaction(intent, signatures), snapshot = await readFundAdmissionSnapshot(rpc)
    const base = { schema_version: 1 as const, chain_id: 80002 as const, admission_request_id: b.read.admission_request_id,
      native_binding_hash: b.read.native_binding_hash, safe_transaction_hash: intent.safe_transaction_hash, reason_hash: intent.reason_hash,
      transaction_hash: expectedHash, executor_address: intent.executor_address, executor_nonce: intent.executor_nonce, safe_address: intent.safe_address,
      safe_nonce: intent.safe_transaction.nonce, controller_address: intent.controller_address, previous_epoch: intent.previous_epoch, target_epoch: intent.target_epoch,
      required_confirmations: b.input.required_confirmations, snapshot, block_number: null, block_hash: null, confirmations: null,
      receipt_hashes: [] as string[], inner_execution_success: false, epoch_verified: false, observed_epoch: null, epoch_event: null }
    const pending = (reason: string) => fundAuthorityAlignmentObservationSchema.parse({ ...base, status: 'PENDING', reason_code: reason })
    const facts = await Promise.all(FUNDING_RPC_URLS.map(async url => ({ url,
      tx: await rpc(url, 'eth_getTransactionByHash', [expectedHash]), receipt: await rpc(url, 'eth_getTransactionReceipt', [expectedHash]) })))
    for (const fact of facts) if (fact.tx !== null && row(fact.tx).blockNumber !== null) checkTransaction(transaction(fact.tx), intent, execution, expectedHash)
    if (facts.some(fact => fact.tx === null || fact.receipt === null)) return pending('ALIGNMENT_TRANSACTION_PENDING')
    const receipts = facts.map(fact => normalizedReceipt(fact.receipt)), agreedReceipt = same(receipts)
    const confirmations = BigInt(snapshot.block.number) >= BigInt(agreedReceipt.block_number) ? BigInt(snapshot.block.number) - BigInt(agreedReceipt.block_number) + 1n : 0n
    if (confirmations < BigInt(b.input.required_confirmations)) return pending('ALIGNMENT_FINALITY_PENDING')
    const outputs = await Promise.all(facts.map(async (fact, index) => {
      const receipt = receipts[index], tx = transaction(fact.tx), at = hex(receipt.block_number)
      checkTransaction(tx, intent, execution, expectedHash)
      if (receipt.hash !== expectedHash || receipt.from !== intent.executor_address || receipt.to !== intent.safe_address
        || tx.block_number !== receipt.block_number || tx.block_hash !== receipt.block_hash || tx.index !== receipt.index) return fail('ALIGNMENT_RECEIPT_MISMATCH')
      const canonical = row(await rpc(fact.url, 'eth_getBlockByNumber', [at, false])), block = header(canonical, BigInt(receipt.block_number))
      if (block.hash !== receipt.block_hash || !Array.isArray(canonical.transactions) || String(canonical.transactions[Number(receipt.index)]).toLowerCase() !== expectedHash) return fail('ALIGNMENT_CANONICAL_BLOCK_CHANGED', 503)
      if (Date.parse(block.timestamp) > Date.parse(intent.valid_until)) return fail('ALIGNMENT_EXECUTED_AFTER_AUTHORITY_EXPIRED')
      const before = receipt.status === '0', failures = receipt.logs.filter(log => log.address === intent.safe_address && log.topics[0] === SAFE.getEvent('ExecutionFailure')!.topicHash.toLowerCase())
      const successes = receipt.logs.filter(log => log.address === intent.safe_address && log.topics[0] === SAFE.getEvent('ExecutionSuccess')!.topicHash.toLowerCase())
      if (before && (failures.length || successes.length) || !before && failures.length && successes.length) return fail('ALIGNMENT_SAFE_INNER_EVENT_MISMATCH')
      let inner = false
      if (!before) {
        const event = exactEvent(receipt, intent.safe_address, SAFE, failures.length ? 'ExecutionFailure' : 'ExecutionSuccess')
        if (String(event[0]).toLowerCase() !== intent.safe_transaction_hash || BigInt(event[1]) !== 0n) return fail('ALIGNMENT_SAFE_INNER_EVENT_MISMATCH')
        inner = failures.length === 0
      }
      const atSafe = await safeAt(rpc, fact.url, intent.safe_address, at), currentSafe = await safeAt(rpc, fact.url, intent.safe_address, hex(snapshot.block.number))
      const expectedSafe = { ...atSafe, owners: intent.safe_owners, threshold: intent.safe_threshold,
        nonce: (BigInt(intent.safe_transaction.nonce) + (before ? 0n : 1n)).toString() }
      if (fundSetupHash(atSafe) !== fundSetupHash(expectedSafe) || fundSetupHash(atSafe) !== fundSetupHash(currentSafe)) return fail('ALIGNMENT_SAFE_POSTSTATE_MISMATCH')
      const epoch = await controllerAt(rpc, fact.url, b, at), currentEpoch = await controllerAt(rpc, fact.url, b, hex(snapshot.block.number))
      let epochEvent: FundAuthorityAlignmentObservation['epoch_event'] = null
      if (inner) {
        const event = exactEvent(receipt, b.controller, CONTROLLER, 'AuthorityEpochAdvanced')
        if (BigInt(event[0]) !== BigInt(intent.previous_epoch) || BigInt(event[1]) !== BigInt(intent.target_epoch) || String(event[2]).toLowerCase() !== intent.reason_hash
          || epoch !== intent.target_epoch || currentEpoch !== intent.target_epoch) return fail('ALIGNMENT_EPOCH_EFFECT_MISMATCH')
        epochEvent = { previous_epoch: intent.previous_epoch, target_epoch: intent.target_epoch, reason_hash: intent.reason_hash }
      } else if (receipt.logs.some(log => log.address === b.controller && log.topics[0] === CONTROLLER.getEvent('AuthorityEpochAdvanced')!.topicHash.toLowerCase())) return fail('ALIGNMENT_FAILED_EXECUTION_HAS_EPOCH_EVENT')
      const reread = await rpc(fact.url, 'eth_getTransactionReceipt', [expectedHash])
      if (fundSetupHash(reread) !== fundSetupHash(fact.receipt)) return fail('ALIGNMENT_RECEIPT_CHANGED_AFTER_WAIT', 503)
      const reblock = row(await rpc(fact.url, 'eth_getBlockByNumber', [at, false]))
      if (header(reblock, BigInt(receipt.block_number)).hash !== receipt.block_hash || !Array.isArray(reblock.transactions)
        || String(reblock.transactions[Number(receipt.index)]).toLowerCase() !== expectedHash) return fail('ALIGNMENT_CANONICAL_BLOCK_CHANGED', 503)
      return { status: inner ? 'FINAL' as const : 'REVERTED' as const, block_number: receipt.block_number, block_hash: receipt.block_hash,
        confirmations: confirmations.toString(), inner_execution_success: inner, epoch_verified: inner, observed_epoch: epoch, epoch_event: epochEvent,
        reason_code: inner ? null : before ? 'ALIGNMENT_OUTER_REVERTED' : 'ALIGNMENT_SAFE_INNER_FAILED' }
    }))
    const result = same(outputs)
    await recheckFundAdmissionSnapshot(rpc, snapshot)
    return fundAuthorityAlignmentObservationSchema.parse({ ...base, ...result, receipt_hashes: receipts.map(item => fundSetupHash(item)) })
  })
}
/** Finds a public candidate only. It never finalises an operation or permits another send. */
export async function discoverFundAuthorityAlignment(raw: FundAuthorityAlignmentRead, savedIntent: FundAuthorityAlignmentIntent,
  signatures: FundAuthoritySignature[], options: FundAuthorityAlignmentOptions = {}): Promise<string | null> {
  return bounded(options, async (rpc, now) => {
    const b = binding(raw, now), intent = boundIntent(savedIntent, b), execution = buildSignedFundAuthorityAlignmentTransaction(intent, signatures)
    if (!b.read.operation?.claimed_at || !['UNKNOWN', 'BROADCAST', 'PENDING'].includes(b.read.operation.state)
      || b.read.operation.executor_nonce !== intent.executor_nonce) return fail('ALIGNMENT_DISCOVERY_NOT_CLAIMED')
    const snapshot = await readFundAdmissionSnapshot(rpc), lowNumber = BigInt(intent.snapshot.block.number), highNumber = BigInt(snapshot.block.number), nonce = BigInt(intent.executor_nonce)
    if (highNumber <= lowNumber || highNumber - lowNumber > 262144n) return fail('ALIGNMENT_RECOVERY_BOUNDS_EXCEEDED')
    const pair = <T>(task: (url: string) => Promise<T>) => Promise.all(FUNDING_RPC_URLS.map(task))
    const nonceAt = async (height: bigint) => same(await pair(async url => quantity(await rpc(url, 'eth_getTransactionCount', [intent.executor_address, hex(height)]))))
    const lower = same(await pair(async url => header(await rpc(url, 'eth_getBlockByNumber', [hex(lowNumber), false]), lowNumber)))
    if (lower.hash !== intent.snapshot.block.hash || await nonceAt(lowNumber) > nonce) return fail('ALIGNMENT_RECOVERY_ANCHOR_CHANGED')
    const latest = same(await pair(async url => ({ latest: quantity(await rpc(url, 'eth_getTransactionCount', [intent.executor_address, 'latest'])),
      pending: quantity(await rpc(url, 'eth_getTransactionCount', [intent.executor_address, 'pending'])) })))
    if (latest.pending < latest.latest) return fail('ALIGNMENT_EXECUTOR_NONCE_UNAVAILABLE')
    if (latest.latest <= nonce || await nonceAt(highNumber) <= nonce) return null
    let low = lowNumber, high = highNumber, rounds = 0
    while (high - low > 1n) {
      if (++rounds > 20) return fail('ALIGNMENT_RECOVERY_BOUNDS_EXCEEDED')
      const mid = (high + low) / 2n
      if (await nonceAt(mid) > nonce) high = mid; else low = mid
    }
    if (await nonceAt(high - 1n) > nonce || await nonceAt(high) <= nonce) return fail('ALIGNMENT_RECOVERY_BOUNDARY_CHANGED')
    const predecessor = same(await pair(async url => header(await rpc(url, 'eth_getBlockByNumber', [hex(high - 1n), false]), high - 1n)))
    const blocks = await pair(async url => {
      const block = row(await rpc(url, 'eth_getBlockByNumber', [hex(high), true])), head = header(block, high)
      if (!Array.isArray(block.transactions) || block.transactions.length > 8192 || Buffer.byteLength(JSON.stringify(block), 'utf8') > 1048576) return fail('ALIGNMENT_RECOVERY_BLOCK_UNAVAILABLE', 503)
      const transactions = block.transactions.map(transaction)
      if (transactions.some((tx, index) => tx.block_number !== head.number || tx.block_hash !== head.hash || tx.index !== String(index))
        || new Set(transactions.map(tx => tx.hash)).size !== transactions.length) return fail('ALIGNMENT_RECOVERY_BLOCK_UNAVAILABLE', 503)
      return { head, transactions }
    })
    const found = same(blocks), matches = found.transactions.filter(tx => tx.from === intent.executor_address && tx.nonce === intent.executor_nonce)
    if (matches.length !== 1) return fail('ALIGNMENT_RECOVERY_NONCE_CONSUMED')
    checkTransaction(matches[0], intent, execution, matches[0].hash)
    for (const point of [lower, snapshot.block, predecessor, found.head]) {
      const rechecked = same(await pair(async url => header(await rpc(url, 'eth_getBlockByNumber', [hex(point.number), false]), BigInt(point.number))))
      if (rechecked.hash !== point.hash) return fail('ALIGNMENT_CANONICAL_BLOCK_CHANGED', 503)
    }
    await recheckFundAdmissionSnapshot(rpc, snapshot)
    return matches[0].hash
  })
}
