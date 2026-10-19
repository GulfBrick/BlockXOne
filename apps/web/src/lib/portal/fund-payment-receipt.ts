import 'server-only'
import { Interface, keccak256 } from 'ethers'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fundPaymentIntentSchema } from './fund-lifecycle-contracts'
import { FundLifecycleError } from './fund-lifecycle-server'
import { createFundingRpc, FUNDING_RPC_URLS, FundingVerificationError } from './funding-verifier'
import { createFundServerRpc } from './fund-rpc-server'
import { fundPaymentReceiptPrefillSchema, type FundPaymentReceiptRequest } from './fund-payment-receipt-contracts'

const savedSchema = z.object({
  intent: fundPaymentIntentSchema,
  token_runtime_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine(value => !/^0x0{64}$/i.test(value)),
  investment_account_id: z.string().uuid(), obligation_created_at: z.string().datetime({ offset: true }),
  route_valid_until: z.string().datetime({ offset: true }),
}).strict()
type SavedPayment = z.infer<typeof savedSchema>
type Rpc = ReturnType<typeof createFundingRpc>
type Dependencies = { rpc?: Rpc; now?: () => number }
const ABI = new Interface(['function transfer(address to,uint256 amount) returns(bool)', 'function decimals() view returns(uint8)', 'event Transfer(address indexed from,address indexed to,uint256 value)'])
const TRANSFER_TOPIC = ABI.getEvent('Transfer')!.topicHash.toLowerCase()
const ZERO_HASH = `0x${'0'.repeat(64)}`
const MAX_UINT = (1n << 256n) - 1n
const lower = (value: string) => value.toLowerCase()
const hex = (value: bigint) => `0x${value.toString(16)}`

function fail(code: string, status = 409): never {
  throw new FundLifecycleError(code, status === 503
    ? 'Independent receipt checks are unavailable or disagree. Keep the original payment reference and retry its check; do not pay again.'
    : 'The original payment is pending, changed or does not match its saved TST instruction. Keep its reference for review; do not pay again.', status)
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('PAYMENT_RECEIPT_MALFORMED', 503)
  return value as Record<string, unknown>
}
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return fail('PAYMENT_RECEIPT_QUANTITY_MALFORMED', 503)
  const n = BigInt(value)
  return n <= MAX_UINT ? n : fail('PAYMENT_RECEIPT_QUANTITY_MALFORMED', 503)
}
function hash(value: unknown): string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && lower(value) !== ZERO_HASH
    ? lower(value) : fail('PAYMENT_RECEIPT_HASH_MALFORMED', 503)
}
function address(value: unknown): string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value)
    ? lower(value) : fail('PAYMENT_RECEIPT_ADDRESS_MALFORMED', 503)
}
function index(value: unknown): number {
  const n = quantity(value)
  return n <= 2147483647n ? Number(n) : fail('PAYMENT_RECEIPT_INDEX_MALFORMED', 503)
}
function block(value: unknown) {
  const b = record(value), timestamp = quantity(b.timestamp)
  if (timestamp > 8640000000000n) return fail('PAYMENT_RECEIPT_TIMESTAMP_MALFORMED', 503)
  return { number: quantity(b.number), hash: hash(b.hash), timestamp: new Date(Number(timestamp) * 1000).toISOString(), transactions: b.transactions }
}
function receiptSnapshot(receipt: Record<string, unknown>): string {
  const normalized = (value: unknown) => typeof value === 'string' ? lower(value) : value
  return JSON.stringify([
    ...['transactionHash', 'blockHash', 'blockNumber', 'transactionIndex', 'from', 'to', 'status'].map(key => normalized(receipt[key])),
    Array.isArray(receipt.logs) ? receipt.logs.map(raw => {
      const log = record(raw)
      return [...['address', 'logIndex', 'transactionHash', 'blockHash', 'blockNumber', 'transactionIndex', 'data', 'removed'].map(key => normalized(log[key])),
        Array.isArray(log.topics) ? log.topics.map(normalized) : log.topics]
    }) : null,
  ])
}
function checked(value: unknown, now: () => number): SavedPayment {
  const parsed = (() => {
    try { return savedSchema.safeParse(value) } catch { return fail('PAYMENT_RECEIPT_RECORD_UNVERIFIED', 503) }
  })()
  if (!parsed.success) return fail('PAYMENT_RECEIPT_RECORD_UNVERIFIED', 503)
  const saved = parsed.data, p = saved.intent
  if (p.state !== 'BROADCAST' || !p.transaction_hash || /^0x0{64}$/i.test(p.transaction_hash)
    || Date.parse(saved.route_valid_until) <= now()) return fail('PAYMENT_RECEIPT_NOT_CURRENT')
  if (BigInt(p.amount_base_units) > MAX_UINT || lower(p.data) !== lower(ABI.encodeFunctionData('transfer', [lower(p.beneficiary_address), p.amount_base_units]))) return fail('PAYMENT_RECEIPT_INSTRUCTION_MISMATCH', 503)
  // A recorded transfer remains inspectable after the original five-minute
  // signing window. This never renews a payment or clears an UNKNOWN lease.
  return saved
}

/** Fixed existing provider transport only. Discovery does not replace the
 * subsequent signed funding-reference verification, Treasury or Controller. */
export async function inspectRecordedFundPayment(value: unknown, dependencies: Dependencies = {}) {
  const now = dependencies.now ?? Date.now, saved = checked(value, now), p = saved.intent
  const rpc = dependencies.rpc ?? createFundServerRpc()
  const txHash = lower(p.transaction_hash!), payer = lower(p.payer_address), token = lower(p.token_address), beneficiary = lower(p.beneficiary_address)
  try {
    const heads = await Promise.all(FUNDING_RPC_URLS.map(async url => {
      const [chain, rawHead] = await Promise.all([rpc(url, 'eth_chainId', []), rpc(url, 'eth_getBlockByNumber', ['finalized', false])])
      if (quantity(chain) !== 80002n || rawHead === null) return fail('PAYMENT_FINALITY_UNAVAILABLE', 503)
      const head = block(rawHead), canonical = block(await rpc(url, 'eth_getBlockByNumber', [hex(head.number), false]))
      if (canonical.number !== head.number || canonical.hash !== head.hash || canonical.timestamp !== head.timestamp) return fail('PAYMENT_FINALIZED_HEAD_CHANGED', 503)
      return { url, head }
    }))
    const receiptSnapshots: string[] = []
    const observations = await Promise.all(heads.map(async (provider, providerIndex) => {
      const [rawReceipt, rawTx] = await Promise.all([rpc(provider.url, 'eth_getTransactionReceipt', [txHash]), rpc(provider.url, 'eth_getTransactionByHash', [txHash])])
      if (rawReceipt === null || rawTx === null) return fail('PAYMENT_TRANSACTION_PENDING_OR_UNKNOWN')
      const receipt = record(rawReceipt), tx = record(rawTx), height = quantity(receipt.blockNumber), blockHash = hash(receipt.blockHash), txIndex = index(receipt.transactionIndex)
      if (height > provider.head.number) return fail('PAYMENT_TRANSACTION_NOT_FINALIZED')
      if (hash(receipt.transactionHash) !== txHash || hash(tx.hash) !== txHash || hash(tx.blockHash) !== blockHash
        || quantity(tx.blockNumber) !== height || index(tx.transactionIndex) !== txIndex
        || address(tx.from) !== payer || address(receipt.from) !== payer || address(tx.to) !== token || address(receipt.to) !== token
        || quantity(tx.value) !== 0n || (tx.chainId !== undefined && quantity(tx.chainId) !== 80002n)
        || typeof tx.input !== 'string' || lower(tx.input) !== lower(p.data)) return fail('PAYMENT_TRANSACTION_INSTRUCTION_MISMATCH')
      const canonical = block(await rpc(provider.url, 'eth_getBlockByNumber', [hex(height), false]))
      if (canonical.number !== height || canonical.hash !== blockHash || !Array.isArray(canonical.transactions)
        || typeof canonical.transactions[txIndex] !== 'string' || lower(canonical.transactions[txIndex]) !== txHash) return fail('PAYMENT_RECEIPT_REORGED', 503)
      if (Date.parse(canonical.timestamp) <= Date.parse(saved.obligation_created_at)) return fail('PAYMENT_PRE_OBLIGATION_REVIEW_REQUIRED')
      if (quantity(receipt.status) !== 1n) return fail('PAYMENT_RECEIPT_NOT_SUCCESSFUL')
      if (!Array.isArray(receipt.logs) || receipt.logs.length > 4096) return fail('PAYMENT_RECEIPT_LOGS_MALFORMED', 503)
      const transfers = receipt.logs.map(record).filter(log => typeof log.address === 'string' && lower(log.address) === token
        && Array.isArray(log.topics) && typeof log.topics[0] === 'string' && lower(log.topics[0]) === TRANSFER_TOPIC)
      if (transfers.length !== 1) return fail('PAYMENT_TRANSFER_AMBIGUOUS')
      const log = transfers[0], logIndex = index(log.logIndex)
      if (receipt.logs.map(record).filter(item => index(item.logIndex) === logIndex).length !== 1
        || log.removed !== false || hash(log.transactionHash) !== txHash || hash(log.blockHash) !== blockHash
        || quantity(log.blockNumber) !== height || index(log.transactionIndex) !== txIndex
        || !Array.isArray(log.topics) || log.topics.length !== 3 || typeof log.data !== 'string' || !/^0x[0-9a-f]{64}$/i.test(log.data)
        || typeof log.topics[1] !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[1])
        || typeof log.topics[2] !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[2])
        || lower(`0x${log.topics[1].slice(-40)}`) !== payer || lower(`0x${log.topics[2].slice(-40)}`) !== beneficiary
        || BigInt(log.data) !== BigInt(p.amount_base_units)) return fail('PAYMENT_TRANSFER_INSTRUCTION_MISMATCH')
      for (const checkHeight of [height, provider.head.number]) {
        const [code, decimals] = await Promise.all([
          rpc(provider.url, 'eth_getCode', [token, hex(checkHeight)]),
          rpc(provider.url, 'eth_call', [{ to: token, data: ABI.encodeFunctionData('decimals') }, hex(checkHeight)]),
        ])
        if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || code.length > 131074
          || keccak256(code) !== lower(saved.token_runtime_hash) || typeof decimals !== 'string'
          || !/^0x[0-9a-f]{64}$/i.test(decimals) || BigInt(decimals) !== 6n) return fail('PAYMENT_TOKEN_CONFIGURATION_CHANGED')
      }
      receiptSnapshots[providerIndex] = receiptSnapshot(receipt)
      return { transaction_hash: txHash, payer_address: payer, log_index: logIndex,
        amount_base_units: p.amount_base_units, block_number: height.toString(), block_hash: blockHash, block_timestamp: canonical.timestamp }
    }))
    if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) return fail('PAYMENT_PROVIDERS_DISAGREE', 503)
    const observed = observations[0]
    // Re-read the canonical location after all provider waits. A changed log or
    // receipt is not delivered as an actionable claim prefill.
    await Promise.all(heads.map(async (provider, providerIndex) => {
      const [rawBlock, rawReceipt] = await Promise.all([rpc(provider.url, 'eth_getBlockByNumber', [hex(BigInt(observed.block_number)), false]), rpc(provider.url, 'eth_getTransactionReceipt', [txHash])])
      const canonical = block(rawBlock), receipt = record(rawReceipt)
      const original = observations[providerIndex], location = index(receipt.transactionIndex)
      if (canonical.hash !== observed.block_hash || canonical.number.toString() !== observed.block_number
        || canonical.timestamp !== observed.block_timestamp || !Array.isArray(receipt.logs)
        || !Array.isArray(canonical.transactions) || typeof canonical.transactions[location] !== 'string' || lower(canonical.transactions[location]) !== txHash
        || hash(receipt.blockHash) !== original.block_hash || quantity(receipt.blockNumber).toString() !== original.block_number
        || hash(receipt.transactionHash) !== txHash || quantity(receipt.status) !== 1n
        || receiptSnapshot(receipt) !== receiptSnapshots[providerIndex]) return fail('PAYMENT_RECEIPT_CHANGED_AFTER_WAIT', 503)
    }))
    checked(saved, now)
    return fundPaymentReceiptPrefillSchema.parse({ version: 1, status: 'READY_FOR_PAYER_CLAIM',
      payment_id: p.payment_id, subscription_id: p.subscription_id, obligation_id: p.obligation_id, obligation_revision: p.obligation_revision,
      route_id: p.route_id, route_revision: p.route_revision, investment_account_id: saved.investment_account_id, actor_id: p.actor_id,
      chain_id: 80002, currency: 'TST', token_decimals: 6, token_address: token, token_runtime_hash: lower(saved.token_runtime_hash), beneficiary_address: beneficiary,
      ...observed, providers: heads.map(provider => ({ url: provider.url, finalized_block_number: provider.head.number.toString(), finalized_block_hash: provider.head.hash })) })
  } catch (error) {
    if (error instanceof FundLifecycleError) throw error
    if (error instanceof FundingVerificationError) return fail(error.code, error.status === 409 ? 409 : 503)
    return fail('PAYMENT_RECEIPT_CHECK_UNAVAILABLE', 503)
  }
}

async function readSavedPayment(client: SupabaseClient, actorId: string, input: FundPaymentReceiptRequest, now: () => number) {
  const { data, error } = await client.rpc('bx1_portal_read_fund_payment', input).abortSignal(AbortSignal.timeout(10000))
  if (error) throw new FundLifecycleError(error.code === '42501' ? 'PAYMENT_RECEIPT_SCOPE_DENIED' : 'PAYMENT_RECEIPT_READ_UNAVAILABLE',
    'The saved payment is unavailable for this account or its requirements changed. Keep the original reference and refresh the order.', error.code === '42501' ? 403 : 409)
  const saved = checked(data, now)
  if (saved.intent.actor_id !== actorId || saved.intent.subscription_id !== input.subscription_id) return fail('PAYMENT_RECEIPT_ACTOR_OR_ORDER_CHANGED', 403)
  return saved
}

export async function resolveFundPaymentReceipt(client: SupabaseClient, actorId: string, input: FundPaymentReceiptRequest, dependencies: Dependencies = {}) {
  const now = dependencies.now ?? Date.now
  const before = await readSavedPayment(client, actorId, input, now)
  const prefill = await inspectRecordedFundPayment(before, dependencies)
  const after = await readSavedPayment(client, actorId, input, now)
  if (JSON.stringify(before) !== JSON.stringify(after)) return fail('PAYMENT_RECEIPT_BINDING_CHANGED')
  return { prefill }
}
