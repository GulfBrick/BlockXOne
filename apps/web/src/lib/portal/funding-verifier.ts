import { Interface, keccak256 } from 'ethers'
import { FUNDING_CHAIN_ID, fundingClaimHash, verifyFundingClaim, type FundingClaim } from './funding-claim'

/** Fixed operator-owned endpoints; no RPC URL is accepted from a request or route. */
export const FUNDING_RPC_URLS = ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'] as const
export type FundingVerificationKind = 'ROUTE' | 'REFERENCE'
export type FundingRouteExpectation = {
  id: string; revision: number; environment: 'TESTNET'; chain_id: 80002;
  token_address: string; token_runtime_hash: string; token_decimals: number; receiving_address: string;
}
export type FundingReferenceExpectation = {
  id: string; obligation_id: string; investment_account_id: string; actor_id: string;
  payer_address: string; transaction_hash: string; log_index: number; claim_signature: string;
  created_at: string; obligation_created_at: string;
}
export type FundingVerificationExpectation = {
  id: string; kind: FundingVerificationKind; actor_id: string; session_id: string;
  expires_at: string; version: number; target_id: string; expectation_hash: string;
  operating_context: { mode: 'APPLICANT' } | { mode: 'ROLE'; organisationId: string; role: string };
  route: FundingRouteExpectation; reference?: FundingReferenceExpectation;
}
export type FundingProviderEvidence = { url: string; finalized_block_number: string; finalized_block_hash: string }
type ObservationBase = {
  version: 1; kind: FundingVerificationKind; chain_id: 80002;
  token_address: string; token_runtime_hash: string; token_decimals: number; receiving_address: string;
  block_number: string; block_hash: string; block_timestamp: string; providers: FundingProviderEvidence[];
}
export type FundingObservation = ObservationBase & (
  { kind: 'ROUTE'; status: 'VERIFIED' }
  | { kind: 'REFERENCE'; status: 'VERIFIED'; transaction_hash: string; transaction_index: number; log_index: number; payer_address: string; amount_base_units: string; claim_hash: string; policy_status?: 'UNAPPLIED'; reason_code?: 'PRE_OBLIGATION' }
  | { kind: 'REFERENCE'; status: 'INVALID'; reason_code: 'RECEIPT_REVERTED'; transaction_hash: string; transaction_index: number; log_index: number; payer_address: string; claim_hash: string }
)
export class FundingVerificationError extends Error {
  constructor(public readonly code: string, public readonly status = 503) { super(code) }
}
type Rpc = (url: string, method: string, params: unknown[]) => Promise<unknown>
type Dependencies = { rpc: Rpc; now?: () => number }
const ABI = new Interface(['function decimals() view returns (uint8)', 'function transfer(address to,uint256 value) returns (bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)'])
const TRANSFER_TOPIC = ABI.getEvent('Transfer')!.topicHash.toLowerCase()
const HASH = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ZERO = `0x${'0'.repeat(40)}`
const MAX_UINT = (1n << 256n) - 1n
const reject = (code: string, status = 503): never => { throw new FundingVerificationError(code, status) }
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : reject('MALFORMED_PROVIDER_RESULT') }
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return reject('MALFORMED_PROVIDER_QUANTITY')
  const result = BigInt(value)
  return result <= MAX_UINT ? result : reject('PROVIDER_QUANTITY_OVERFLOW')
}
const hex = (value: bigint) => `0x${value.toString(16)}`
function hash(value: unknown): string { return typeof value === 'string' && HASH.test(value.toLowerCase()) && value !== `0x${'0'.repeat(64)}` ? value.toLowerCase() : reject('MALFORMED_PROVIDER_HASH') }
function address(value: unknown): string { return typeof value === 'string' && ADDRESS.test(value.toLowerCase()) ? value.toLowerCase() : reject('MALFORMED_PROVIDER_ADDRESS') }
function index(value: unknown): number { const n = quantity(value); return n <= 2_147_483_647n ? Number(n) : reject('INVALID_LOG_INDEX') }
function isoTimestamp(value: unknown): string {
  const n = quantity(value)
  if (n > 8_640_000_000_000n) return reject('INVALID_BLOCK_TIMESTAMP')
  return new Date(Number(n) * 1000).toISOString()
}
function parsedBlock(value: unknown) {
  const b = record(value)
  return { number: quantity(b.number), hash: hash(b.hash), timestamp: isoTimestamp(b.timestamp), transactions: b.transactions }
}
function liveExpectation(e: FundingVerificationExpectation, now: () => number) {
  if (!e || !UUID.test(e.id) || !UUID.test(e.actor_id) || !UUID.test(e.session_id) || !UUID.test(e.target_id)
    || !Number.isSafeInteger(e.version) || e.version < 1 || !/^(?:0x)?[0-9a-f]{64}$/.test(e.expectation_hash)
    || !Number.isFinite(Date.parse(e.expires_at)) || Date.parse(e.expires_at) <= now()) reject('EXPIRED_VERIFICATION_EXPECTATION', 409)
  const r = e.route
  if (!r || r.environment !== 'TESTNET' || r.chain_id !== FUNDING_CHAIN_ID || !UUID.test(r.id)
    || !Number.isSafeInteger(r.revision) || r.revision < 1 || !Number.isInteger(r.token_decimals) || r.token_decimals < 2 || r.token_decimals > 18
    || !ADDRESS.test(r.token_address) || r.token_address === ZERO || !ADDRESS.test(r.receiving_address) || r.receiving_address === ZERO
    || !HASH.test(r.token_runtime_hash) || r.token_runtime_hash === `0x${'0'.repeat(64)}`) reject('INVALID_TEST_ROUTE', 409)
  if (e.kind === 'ROUTE' && (e.target_id !== r.id || e.reference !== undefined)) reject('INVALID_VERIFICATION_TARGET', 409)
  if (e.kind !== 'ROUTE' && e.kind !== 'REFERENCE') reject('INVALID_VERIFICATION_KIND', 409)
  if (e.kind === 'REFERENCE' && (!e.reference || e.reference.id !== e.target_id || !Number.isFinite(Date.parse(e.reference.obligation_created_at)))) reject('INVALID_VERIFICATION_REFERENCE', 409)
}
function claimFor(e: FundingVerificationExpectation): FundingClaim {
  const r = e.route, f = e.reference!
  return { actor_id: f.actor_id, investment_account_id: f.investment_account_id, obligation_id: f.obligation_id, route_id: r.id, route_revision: r.revision,
    token_address: r.token_address, token_runtime_hash: r.token_runtime_hash, token_decimals: r.token_decimals, receiving_address: r.receiving_address,
    payer_address: f.payer_address, transaction_hash: f.transaction_hash, log_index: f.log_index }
}
async function heads(rpc: Rpc) {
  return Promise.all(FUNDING_RPC_URLS.map(async url => {
    const [chain, finalized] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
    if (quantity(chain) !== BigInt(FUNDING_CHAIN_ID)) reject('WRONG_PROVIDER_CHAIN')
    if (finalized === null) reject('FINALITY_UNAVAILABLE')
    const block = parsedBlock(finalized)
    const canonical = parsedBlock(await rpc(url, 'eth_getBlockByNumber', [hex(block.number), false]))
    if (canonical.number !== block.number || canonical.hash !== block.hash || canonical.timestamp !== block.timestamp) reject('FINALIZED_BLOCK_MISMATCH')
    return { url, block }
  }))
}
async function tokenAt(rpc: Rpc, url: string, route: FundingRouteExpectation, block: bigint) {
  const [rawCode, rawDecimals] = await Promise.all([
    rpc(url, 'eth_getCode', [route.token_address, hex(block)]),
    rpc(url, 'eth_call', [{ to: route.token_address, data: ABI.encodeFunctionData('decimals') }, hex(block)]),
  ])
  if (typeof rawCode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(rawCode) || rawCode.length > 131_074) reject('TOKEN_CODE_UNAVAILABLE')
  const runtime = keccak256(rawCode)
  if (runtime !== route.token_runtime_hash) reject('TOKEN_RUNTIME_MISMATCH', 409)
  if (typeof rawDecimals !== 'string' || !/^0x[0-9a-f]{64}$/i.test(rawDecimals) || BigInt(rawDecimals) !== BigInt(route.token_decimals)) reject('TOKEN_DECIMALS_MISMATCH', 409)
}
function agree<T>(values: T[]): T {
  if (values.length !== 2 || JSON.stringify(values[0]) !== JSON.stringify(values[1])) reject('PROVIDER_DISAGREEMENT')
  return values[0]
}

/** Pure orchestration: only its injected RPC transport reads the network; no writes. */
export async function verifyFundingExpectation(expectation: FundingVerificationExpectation, dependencies: Dependencies): Promise<FundingObservation> {
  const { rpc } = dependencies, now = dependencies.now ?? Date.now
  liveExpectation(expectation, now)
  const route = expectation.route
  const claim = expectation.kind === 'REFERENCE' ? claimFor(expectation) : undefined
  if (claim && !verifyFundingClaim(claim, expectation.reference!.claim_signature)) reject('INVALID_CLAIM_SIGNATURE', 403)
  const providers = await heads(rpc)
  const providerEvidence = providers.map(p => ({ url: p.url, finalized_block_number: p.block.number.toString(), finalized_block_hash: p.block.hash }))
  const common = { version: 1 as const, chain_id: FUNDING_CHAIN_ID, token_address: route.token_address, token_runtime_hash: route.token_runtime_hash,
    token_decimals: route.token_decimals, receiving_address: route.receiving_address, providers: providerEvidence }
  if (expectation.kind === 'ROUTE') {
    const height = providers.reduce((min, p) => p.block.number < min ? p.block.number : min, providers[0].block.number)
    const observations = await Promise.all(providers.map(async p => {
      const block = parsedBlock(await rpc(p.url, 'eth_getBlockByNumber', [hex(height), false]))
      if (block.number !== height) reject('CANONICAL_BLOCK_MISMATCH')
      await tokenAt(rpc, p.url, route, height)
      return { block_number: block.number.toString(), block_hash: block.hash, block_timestamp: block.timestamp }
    }))
    const facts = agree(observations)
    liveExpectation(expectation, now)
    return { ...common, ...facts, kind: 'ROUTE', status: 'VERIFIED' }
  }
  const reference = expectation.reference!
  const observations = await Promise.all(providers.map(async p => {
    const [rawReceipt, rawTransaction] = await Promise.all([
      rpc(p.url, 'eth_getTransactionReceipt', [reference.transaction_hash]), rpc(p.url, 'eth_getTransactionByHash', [reference.transaction_hash]),
    ])
    if (rawReceipt === null || rawTransaction === null) reject('TRANSACTION_PENDING_OR_UNKNOWN', 202)
    const receipt = record(rawReceipt), tx = record(rawTransaction)
    const blockNumber = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), txIndex = index(receipt.transactionIndex)
    if (blockNumber > p.block.number) reject('TRANSACTION_NOT_FINALIZED', 202)
    if (hash(receipt.transactionHash) !== reference.transaction_hash || hash(tx.hash) !== reference.transaction_hash
      || hash(tx.blockHash) !== blockHash || quantity(tx.blockNumber) !== blockNumber || index(tx.transactionIndex) !== txIndex
      || address(receipt.from) !== address(tx.from) || address(receipt.to) !== address(tx.to)
      || address(tx.from) !== reference.payer_address || address(tx.to) !== route.token_address || quantity(tx.value) !== 0n
      || (tx.chainId !== undefined && quantity(tx.chainId) !== BigInt(FUNDING_CHAIN_ID))) reject('TRANSACTION_IDENTITY_MISMATCH', 409)
    const block = parsedBlock(await rpc(p.url, 'eth_getBlockByNumber', [hex(blockNumber), false]))
    if (block.number !== blockNumber || block.hash !== blockHash || !Array.isArray(block.transactions)
      || typeof block.transactions[txIndex] !== 'string' || block.transactions[txIndex].toLowerCase() !== reference.transaction_hash) reject('CANONICAL_BLOCK_MISMATCH')
    if (typeof tx.input !== 'string' || !/^0x[0-9a-f]{136}$/i.test(tx.input)) reject('UNSUPPORTED_TRANSFER_CALL', 409)
    let call: ReturnType<Interface['decodeFunctionData']>
    try { call = ABI.decodeFunctionData('transfer', tx.input) } catch { return reject('UNSUPPORTED_TRANSFER_CALL', 409) }
    const callAmount = BigInt(call[1])
    if (String(call[0]).toLowerCase() !== route.receiving_address || callAmount <= 0n || callAmount > MAX_UINT) reject('TRANSFER_CALL_MISMATCH', 409)
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 4096) reject('MALFORMED_RECEIPT_LOGS')
    const status = quantity(receipt.status)
    if (status !== 0n && status !== 1n) reject('INVALID_RECEIPT_STATUS')
    const base = { block_number: blockNumber.toString(), block_hash: blockHash, block_timestamp: block.timestamp,
      transaction_hash: reference.transaction_hash, transaction_index: txIndex, log_index: reference.log_index,
      payer_address: reference.payer_address, claim_hash: fundingClaimHash(claim!) }
    await Promise.all([tokenAt(rpc, p.url, route, blockNumber), tokenAt(rpc, p.url, route, p.block.number)])
    if (status === 0n) {
      // Reverted finalized execution, not absent evidence or a bad signature, proves no transfer occurred.
      if (receipt.logs.length !== 0) reject('INCONSISTENT_REVERTED_RECEIPT')
      return { ...base, status: 'INVALID' as const, reason_code: 'RECEIPT_REVERTED' as const }
    }
    const logs = receipt.logs.map(record).filter(log => index(log.logIndex) === reference.log_index)
    if (logs.length !== 1) reject('TRANSFER_LOG_NOT_UNIQUELY_FOUND', 409)
    const log = logs[0]
    const tokenTransfers = receipt.logs.map(record).filter(item => typeof item.address === 'string' && item.address.toLowerCase() === route.token_address && Array.isArray(item.topics) && typeof item.topics[0] === 'string' && item.topics[0].toLowerCase() === TRANSFER_TOPIC)
    if (tokenTransfers.length !== 1) reject('AMBIGUOUS_TOKEN_TRANSFERS', 409)
    if (address(log.address) !== route.token_address || log.removed !== false || hash(log.transactionHash) !== reference.transaction_hash
      || hash(log.blockHash) !== blockHash || quantity(log.blockNumber) !== blockNumber || index(log.transactionIndex) !== txIndex
      || !Array.isArray(log.topics) || log.topics.length !== 3 || hash(log.topics[0]) !== TRANSFER_TOPIC
      || typeof log.data !== 'string' || !/^0x[0-9a-f]{64}$/i.test(log.data)) reject('TRANSFER_LOG_IDENTITY_MISMATCH', 409)
    const fromTopic = hash(log.topics[1]), toTopic = hash(log.topics[2])
    if (!/^0x0{24}[0-9a-f]{40}$/.test(fromTopic) || !/^0x0{24}[0-9a-f]{40}$/.test(toTopic)
      || `0x${fromTopic.slice(-40)}` !== reference.payer_address || `0x${toTopic.slice(-40)}` !== route.receiving_address
      || reference.payer_address === ZERO || route.receiving_address === ZERO) reject('TRANSFER_PARTIES_MISMATCH', 409)
    const amount = BigInt(log.data)
    if (amount <= 0n || amount !== callAmount) reject('TRANSFER_AMOUNT_MISMATCH', 409)
    const preObligation = Date.parse(block.timestamp) <= Date.parse(reference.obligation_created_at)
    // Preserve actual chain facts. SQL independently records out-of-policy payment as UNAPPLIED.
    return { ...base, status: 'VERIFIED' as const, amount_base_units: amount.toString(), ...(preObligation ? { policy_status: 'UNAPPLIED' as const, reason_code: 'PRE_OBLIGATION' as const } : {}) }
  }))
  const facts = agree(observations)
  liveExpectation(expectation, now)
  return { ...common, ...facts, kind: 'REFERENCE' }
}

/** Bounded JSON transport shared by the Edge entrypoint and the explicit cloud probe. */
export function createFundingRpc(fetcher: typeof fetch = fetch, signal?: AbortSignal): Rpc {
  let requestId = 0
  return async (url, method, params) => {
    if (!(FUNDING_RPC_URLS as readonly string[]).includes(url)) reject('RPC_ENDPOINT_NOT_ALLOWED')
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getCode', 'eth_call'].includes(method)) reject('RPC_METHOD_NOT_ALLOWED')
    const id = ++requestId
    const timeout = AbortSignal.timeout(8_000)
    const bound = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetcher(url, { method: 'POST', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: bound })
      if (!response.ok || response.redirected || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) reject('RPC_RESPONSE_UNAVAILABLE')
      const data = record(await readBoundedFundingJson(response, 1_048_576, bound))
      if (data.jsonrpc !== '2.0' || data.id !== id || 'error' in data || !Object.hasOwn(data, 'result')) reject('RPC_RESULT_UNAVAILABLE')
      return data.result
    } catch (error) { if (error instanceof FundingVerificationError) throw error; return reject('RPC_RESPONSE_UNAVAILABLE') }
  }
}
export async function readBoundedFundingJson(source: Pick<Response, 'body' | 'headers'>, maximum: number, signal: AbortSignal): Promise<unknown> {
  const claimed = source.headers.get('content-length')
  if (claimed !== null && (!/^[0-9]+$/.test(claimed) || BigInt(claimed) > BigInt(maximum))) reject('BODY_TOO_LARGE', 413)
  const reader = source.body?.getReader()
  if (!reader) return reject('EMPTY_BODY', 400)
  const chunks: Uint8Array[] = []; let length = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) { await reader.cancel(); reject('REQUEST_TIMED_OUT') }
    for (;;) {
      const part = await reader.read()
      if (signal.aborted) reject('REQUEST_TIMED_OUT')
      if (part.done) break
      length += part.value.byteLength
      if (length > maximum) { await reader.cancel(); reject('BODY_TOO_LARGE', 413) }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return reject('INVALID_JSON', 400) }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
}

/** Cloud acceptance only: no mocks, no mutation and no automatic pass on network failure. */
export async function probeFundingRpcProviders(fetcher: typeof fetch = fetch) {
  const rpc = createFundingRpc(fetcher, AbortSignal.timeout(20_000))
  const providers = await heads(rpc)
  const height = providers.reduce((min, p) => p.block.number < min ? p.block.number : min, providers[0].block.number)
  const blocks = await Promise.all(providers.map(async p => {
    const b = parsedBlock(await rpc(p.url, 'eth_getBlockByNumber', [hex(height), false]))
    return { block_number: b.number.toString(), block_hash: b.hash, block_timestamp: b.timestamp }
  }))
  return { status: 'RPC_FINALITY_PROBE_PASSED', chain_id: FUNDING_CHAIN_ID, ...agree(blocks), providers: providers.map(p => ({ url: p.url, finalized_block_number: p.block.number.toString(), finalized_block_hash: p.block.hash })) }
}
