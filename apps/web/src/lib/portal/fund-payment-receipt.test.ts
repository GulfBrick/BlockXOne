import { Interface, keccak256 } from 'ethers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { FUNDING_RPC_URLS, FundingVerificationError } from './funding-verifier'
import { fundPaymentReceiptPrefillSchema, fundPaymentReceiptRequestSchema } from './fund-payment-receipt-contracts'
import { inspectRecordedFundPayment, resolveFundPaymentReceipt } from './fund-payment-receipt'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const payer = `0x${'11'.repeat(20)}`, token = `0x${'22'.repeat(20)}`, beneficiary = `0x${'33'.repeat(20)}`
const txHash = `0x${'aa'.repeat(32)}`, code = '0x60006000'
const abi = new Interface(['function transfer(address to,uint256 amount) returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)'])
const seconds = 1_790_000_000n, now = () => Number(seconds + 200n) * 1000
const hex = (n: bigint) => `0x${n.toString(16)}`
const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
const block = (n: bigint) => ({ number: hex(n), hash: blockHash(n), timestamp: hex(seconds + n), transactions: [blockHash(1n), blockHash(2n), txHash] })
const rec = (value: unknown) => value as Record<string, unknown>
type Mutation = (url: string, method: string, params: unknown[], value: unknown, attempt: number) => unknown
function fixture(mutate?: Mutation) {
  const amount = '1000000000'
  const saved = {
    intent: { payment_id: id(1), subscription_id: id(2), obligation_id: id(3), obligation_revision: 2,
      route_id: id(4), route_revision: 3, actor_id: id(5), payer_address: payer, chain_id: 80002,
      token_address: token, beneficiary_address: beneficiary, amount_base_units: amount, decimals: 6, currency: 'TST',
      data: abi.encodeFunctionData('transfer', [beneficiary, amount]), expires_at: new Date(now() - 1).toISOString(),
      state: 'BROADCAST', transaction_hash: txHash },
    token_runtime_hash: keccak256(code), investment_account_id: id(6),
    obligation_created_at: new Date(Number(seconds) * 1000).toISOString(), route_valid_until: new Date(now() + 600_000).toISOString(),
  }
  const event = abi.encodeEventLog(abi.getEvent('Transfer')!, [payer, beneficiary, amount])
  const log = { address: token, topics: event.topics, data: event.data, logIndex: '0x4', blockNumber: '0x64', blockHash: blockHash(100n), transactionHash: txHash, transactionIndex: '0x2', removed: false }
  const receipt = { transactionHash: txHash, blockHash: blockHash(100n), blockNumber: '0x64', transactionIndex: '0x2', from: payer, to: token, status: '0x1', logs: [log] }
  const transaction = { hash: txHash, blockHash: blockHash(100n), blockNumber: '0x64', transactionIndex: '0x2', from: payer, to: token, value: '0x0', chainId: '0x13882', input: saved.intent.data }
  const attempts = new Map<string, number>()
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_chainId') value = '0x13882'
    else if (method === 'eth_getBlockByNumber') value = block(params[0] === 'finalized' ? url === FUNDING_RPC_URLS[0] ? 120n : 123n : BigInt(String(params[0])))
    else if (method === 'eth_getTransactionReceipt') value = receipt
    else if (method === 'eth_getTransactionByHash') value = transaction
    else if (method === 'eth_getCode') value = code
    else if (method === 'eth_call') value = `0x${6n.toString(16).padStart(64, '0')}`
    else throw new Error('Unexpected fixture method')
    const key = `${url}:${method}:${JSON.stringify(params)}`, attempt = (attempts.get(key) ?? 0) + 1
    attempts.set(key, attempt)
    const clone = structuredClone(value)
    return mutate ? mutate(url, method, params, clone, attempt) : clone
  })
  return { saved, rpc, receipt, transaction, log }
}
function logPatch(patch: Record<string, unknown>): Mutation {
  return (_url, method, _params, value) => method === 'eth_getTransactionReceipt'
    ? { ...rec(value), logs: [(rec(value).logs as Record<string, unknown>[]).map(log => ({ ...log, ...patch }))[0]] } : value
}
function savedClient(results: { data: unknown; error: { code: string; message?: string } | null }[]) {
  let calls = 0
  const abort = vi.fn(), rpc = vi.fn(() => ({ abortSignal: (signal: AbortSignal) => {
    abort(signal)
    return Promise.resolve(results[Math.min(calls++, results.length - 1)])
  } }))
  return { client: { rpc } as unknown as SupabaseClient, rpc, abort }
}

describe('saved canonical payment to explicit payer-claim handoff', () => {
  it('discovers the exact log from both existing observers without signing or accepting payment', async () => {
    const f = fixture(), original = structuredClone(f.saved)
    const prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    expect(prefill).toMatchObject({ version: 1, status: 'READY_FOR_PAYER_CLAIM', payment_id: id(1), subscription_id: id(2),
      obligation_id: id(3), obligation_revision: 2, route_id: id(4), route_revision: 3, actor_id: id(5), investment_account_id: id(6),
      token_address: token, token_runtime_hash: keccak256(code), token_decimals: 6, beneficiary_address: beneficiary,
      payer_address: payer, transaction_hash: txHash, log_index: 4, amount_base_units: '1000000000', block_number: '100' })
    expect(prefill.providers.map(provider => provider.url)).toEqual([...FUNDING_RPC_URLS])
    expect(prefill.providers.map(provider => provider.finalized_block_number)).toEqual(['120', '123'])
    expect(f.saved).toEqual(original)
    for (const field of ['signature', 'funded', 'posted', 'holding']) expect(prefill).not.toHaveProperty(field)
    expect(f.rpc.mock.calls.every(([_url, method]) => !/send|sign|broadcast|estimate/i.test(method))).toBe(true)
    // Expired preparation is not a new payment or an UNKNOWN retry: the saved
    // BROADCAST transfer remains discoverable without any browser marker.
    expect(Date.parse(f.saved.intent.expires_at)).toBeLessThan(now())
  })

  it.each(['UNKNOWN', 'PREPARED'])('does not clear or retry a saved %s outcome', async state => {
    const f = fixture(); f.saved.intent.state = state
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_NOT_CURRENT' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('requires a saved transaction, a live route and the exact immutable instruction', async () => {
    for (const patch of [
      { intent: { transaction_hash: null } }, { intent: { data: abi.encodeFunctionData('transfer', [beneficiary, 1]) } },
      { route_valid_until: new Date(now()).toISOString() }, { intent: { amount_base_units: (2n ** 256n).toString() } },
    ]) {
      const f = fixture(), saved = { ...f.saved, ...patch, intent: { ...f.saved.intent, ...patch.intent } }
      await expect(inspectRecordedFundPayment(saved, { rpc: f.rpc, now })).rejects.toMatchObject({ status: expect.any(Number) })
      expect(f.rpc).not.toHaveBeenCalled()
    }
  })
  it.each(['eth_getTransactionReceipt', 'eth_getTransactionByHash'])('does not turn absent %s into a claim', async missing => {
    const f = fixture((_url, method, _params, value) => method === missing ? null : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSACTION_PENDING_OR_UNKNOWN', status: 409 })
  })
  it.each([
    { from: beneficiary }, { to: beneficiary }, { value: '0x1' }, { chainId: '0x1' },
    { input: abi.encodeFunctionData('transfer', [payer, '1000000000']) },
    { input: abi.encodeFunctionData('transfer', [beneficiary, 1]) }, { hash: blockHash(999n) },
    { blockHash: blockHash(999n) }, { blockNumber: '0x65' }, { transactionIndex: '0x3' },
  ])('requires the saved payer, token, value, calldata and canonical transaction identity %#', async patch => {
    const f = fixture((_url, method, _params, value) => method === 'eth_getTransactionByHash' ? { ...rec(value), ...patch } : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSACTION_INSTRUCTION_MISMATCH' })
  })
  it('does not treat reverted outer execution as payment', async () => {
    const f = fixture((_url, method, _params, value) => method === 'eth_getTransactionReceipt' ? { ...rec(value), status: '0x0', logs: [] } : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_NOT_SUCCESSFUL' })
  })
  it.each([
    { removed: true }, { removed: undefined }, { blockHash: blockHash(999n) }, { blockNumber: '0x65' },
    { transactionHash: blockHash(999n) }, { transactionIndex: '0x3' }, { data: '0x01' },
    { data: `0x${1n.toString(16).padStart(64, '0')}` },
  ])('rejects removed or mismatched Transfer facts %#', async patch => {
    const f = fixture(logPatch(patch))
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSFER_INSTRUCTION_MISMATCH' })
  })
  it.each([`0x${'0'.repeat(64)}`, `0x${'f'.repeat(64)}`, `0x${'0'.repeat(24)}${payer.slice(2)}`])('requires canonical indexed beneficiary evidence %s', async topic => {
    const f = fixture(), topics = [...f.log.topics]; topics[2] = topic
    const changed = fixture(logPatch({ topics }))
    await expect(inspectRecordedFundPayment(changed.saved, { rpc: changed.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSFER_INSTRUCTION_MISMATCH' })
  })
  it.each([{ variants: [] }, { variants: [1] }, { variants: [1, 2] }])('requires exactly one TST Transfer, not a missing or ambiguous payment %#', async ({ variants }) => {
    const f = fixture((_url, method, _params, value) => {
      if (method !== 'eth_getTransactionReceipt') return value
      const log = (rec(value).logs as Record<string, unknown>[])[0]
      return { ...rec(value), logs: variants.map(n => ({ ...log, logIndex: hex(BigInt(n)) })) }
    })
    if (variants.length === 1) {
      expect((await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).log_index).toBe(1)
    } else await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSFER_AMBIGUOUS' })
  })
  it('rejects duplicate receipt log indexes even when only one log is a TST Transfer', async () => {
    const f = fixture((_url, method, _params, value) => {
      if (method !== 'eth_getTransactionReceipt') return value
      const log = (rec(value).logs as Record<string, unknown>[])[0]
      return { ...rec(value), logs: [log, { ...log, address: beneficiary, topics: [blockHash(999n)] }] }
    })
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSFER_INSTRUCTION_MISMATCH' })
  })
  it('rejects independently plausible but different log locations', async () => {
    const f = fixture((url, method, params, value, attempt) => url === FUNDING_RPC_URLS[1] ? logPatch({ logIndex: '0x5' })(url, method, params, value, attempt) : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDERS_DISAGREE', status: 503 })
  })
  it.each(['eth_getCode', 'eth_call'])('checks token runtime and precision at receipt and finalized blocks: %s', async methodToChange => {
    for (const height of ['0x64', '0x78', '0x7b']) {
      const f = fixture((_url, method, params, value) => method === methodToChange && params[params.length - 1] === height
        ? method === 'eth_getCode' ? '0x60016000' : `0x${18n.toString(16).padStart(64, '0')}` : value)
      await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TOKEN_CONFIGURATION_CHANGED' })
    }
  })
  it('rejects the wrong chain or an inconsistent finalized head', async () => {
    for (const mutate of [
      ((_url, method, _params, value) => method === 'eth_chainId' ? '0x1' : value) as Mutation,
      ((_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === 'finalized' ? { ...rec(value), hash: blockHash(999n) } : value) as Mutation,
    ]) {
      const f = fixture(mutate)
      await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ status: 503 })
    }
  })
  it('requires finality on both observers', async () => {
    const f = fixture((url, method, params, value) => url === FUNDING_RPC_URLS[1] && method === 'eth_getBlockByNumber' && params[0] === 'finalized' ? block(99n) : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_TRANSACTION_NOT_FINALIZED' })
  })
  it.each([{ hash: blockHash(999n) }, { transactions: [txHash, blockHash(1n), blockHash(2n)] }])('requires the exact canonical block and transaction position %#', async patch => {
    const f = fixture((_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === '0x64' ? { ...rec(value), ...patch } : value)
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_REORGED', status: 503 })
  })
  it.each([100, 101])('does not guide a pre-obligation transfer into an ordinary signed claim %#', async offset => {
    const f = fixture(); f.saved.obligation_created_at = new Date(Number(seconds + BigInt(offset)) * 1000).toISOString()
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_PRE_OBLIGATION_REVIEW_REQUIRED' })
  })
  it.each(['receipt', 'block', 'position'])('rechecks %s after provider waits', async changed => {
    const f = fixture((_url, method, params, value, attempt) => {
      if (attempt !== 2) return value
      if (changed === 'receipt' && method === 'eth_getTransactionReceipt') return { ...rec(value), logs: [] }
      if (method === 'eth_getBlockByNumber' && params[0] === '0x64') return changed === 'block'
        ? { ...rec(value), hash: blockHash(999n) } : changed === 'position' ? { ...rec(value), transactions: [] } : value
      return value
    })
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_CHANGED_AFTER_WAIT', status: 503 })
  })
  it('rechecks route expiry after all network waits', async () => {
    const f = fixture(); let checks = 0
    await expect(inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now: () => now() + (checks++ ? 700_000 : 0) })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_NOT_CURRENT' })
  })
  it.each(['upstream credentials=secret', new FundingVerificationError('RPC_RESPONSE_UNAVAILABLE', 503)])('sanitizes provider failures instead of disclosing raw diagnostics %#', async failure => {
    const f = fixture(), rpc = vi.fn(async () => { throw typeof failure === 'string' ? new Error(failure) : failure })
    const error = await inspectRecordedFundPayment(f.saved, { rpc, now }).catch(error => error)
    expect(error.status).toBe(503)
    expect(error.message).not.toMatch(/credentials|secret|RPC_RESPONSE_UNAVAILABLE/)
    expect(error.message).toContain('do not pay again')
  })
})

describe('authenticated saved-order lookup without local-browser markers', () => {
  const input = { subscription_id: id(2), operating_context: { mode: 'APPLICANT' as const } }
  it('reads and rechecks the same current database binding around receipt discovery, with no write RPC', async () => {
    const f = fixture(), db = savedClient([{ data: f.saved, error: null }])
    const result = await resolveFundPaymentReceipt(db.client, id(5), input, { rpc: f.rpc, now })
    expect(result.prefill.payment_id).toBe(id(1))
    expect(db.rpc).toHaveBeenCalledTimes(2)
    expect(db.rpc.mock.calls).toEqual([['bx1_portal_read_fund_payment', input], ['bx1_portal_read_fund_payment', input]])
    expect(db.abort.mock.calls.every(([signal]) => signal instanceof AbortSignal)).toBe(true)
  })
  it.each([id(99), id(2)])('cannot disclose another actor or a different saved order %#', async changed => {
    const f = fixture(), db = savedClient([{ data: f.saved, error: null }])
    await expect(resolveFundPaymentReceipt(db.client, changed, input, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_ACTOR_OR_ORDER_CHANGED', status: 403 })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('cannot change a requested subscription to the one returned by a faulty projection', async () => {
    const f = fixture(), db = savedClient([{ data: f.saved, error: null }])
    await expect(resolveFundPaymentReceipt(db.client, id(5), { ...input, subscription_id: id(99) }, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_ACTOR_OR_ORDER_CHANGED', status: 403 })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('rechecks revocation after provider waits before returning prefill', async () => {
    const f = fixture(), db = savedClient([{ data: f.saved, error: null }, { data: null, error: { code: '42501', message: 'private backend details' } }])
    const error = await resolveFundPaymentReceipt(db.client, id(5), input, { rpc: f.rpc, now }).catch(error => error)
    expect(error).toMatchObject({ code: 'PAYMENT_RECEIPT_SCOPE_DENIED', status: 403 })
    expect(error.message).not.toContain('private backend')
  })
  it.each(['investment_account_id', 'obligation_created_at', 'route_valid_until'])('refuses a changed saved %s after observation', async field => {
    const f = fixture(), after = { ...f.saved, [field]: field === 'investment_account_id' ? id(99) : new Date(now() + 900_000).toISOString() }
    // A different earlier obligation remains a valid observation but is still
    // not the same saved binding read before the network waits.
    if (field === 'obligation_created_at') after.obligation_created_at = new Date(Number(seconds - 1n) * 1000).toISOString()
    const db = savedClient([{ data: f.saved, error: null }, { data: after, error: null }])
    await expect(resolveFundPaymentReceipt(db.client, id(5), input, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PAYMENT_RECEIPT_BINDING_CHANGED' })
  })
})

describe('strict client-safe discovery contract', () => {
  it.each([
    ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.drpc.org'],
    ['https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy.drpc.org'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2'],
    ['https://polygon-amoy.g.alchemy.com/v2', 'https://80002.rpc.thirdweb.com'],
  ])('retains the exact historical or active evidence pair without relabeling %s / %s', async (first, second) => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    const providers = [{ ...prefill.providers[0], url: first }, { ...prefill.providers[1], url: second }]
    const parsed = fundPaymentReceiptPrefillSchema.parse({ ...prefill, providers })
    expect(parsed.providers).toEqual(providers)
    expect(JSON.stringify(parsed.providers)).toBe(JSON.stringify(providers))
  })
  it.each([
    ['https://polygon-amoy.drpc.org', 'https://80002.rpc.thirdweb.com'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.drpc.org'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://80002.rpc.thirdweb.com'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy.g.alchemy.com/v2', 'https://polygon-amoy.drpc.org'],
    ['https://polygon-amoy.drpc.org', 'https://polygon-amoy.g.alchemy.com/v2'],
    ['https://polygon-amoy.g.alchemy.com/v2', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy.g.alchemy.com/v2'],
    ['https://polygon-amoy.g.alchemy.com/v2', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.g.alchemy.com/v2'],
  ])('rejects every unapproved cross-pair without relabeling %s / %s', async (first, second) => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    const providers = [{ ...prefill.providers[0], url: first }, { ...prefill.providers[1], url: second }]
    expect(fundPaymentReceiptPrefillSchema.safeParse({ ...prefill, providers }).success).toBe(false)
  })
  it.each(['without dRPC', 'extra observer', 'missing observer', 'null observer', 'extra provider field'] as const)('rejects an unapproved evidence group: %s', async changed => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    let providers: unknown = prefill.providers
    if (changed === 'without dRPC') providers = [{ ...prefill.providers[0], url: 'https://polygon-amoy-bor-rpc.publicnode.com' }, prefill.providers[1]]
    else if (changed === 'extra observer') providers = [...prefill.providers, { ...prefill.providers[0], url: 'https://polygon-amoy-bor-rpc.publicnode.com' }]
    else if (changed === 'missing observer') providers = [prefill.providers[0]]
    else if (changed === 'null observer') providers = [null, prefill.providers[1]]
    else providers = [{ ...prefill.providers[0], apiKey: 'not-evidence' }, prefill.providers[1]]
    expect(fundPaymentReceiptPrefillSchema.safeParse({ ...prefill, providers }).success).toBe(false)
  })
  it.each([{ transaction_hash: txHash }, { log_index: 4 }, { amount_base_units: '1' }, { payer_address: payer },
    { payment_id: id(1) }, { rpc_url: FUNDING_RPC_URLS[0] }, { verified: true }])('accepts only order identity and context, never caller evidence %#', extra => {
    expect(fundPaymentReceiptRequestSchema.safeParse({ subscription_id: id(2), operating_context: { mode: 'APPLICANT' }, ...extra }).success).toBe(false)
  })
  it.each(['https://name:secret@polygon-amoy.drpc.org', 'https://polygon-amoy.drpc.org?apiKey=secret',
    'https://polygon-amoy.drpc.org/secret', 'https://unapproved.example', 'https://name:secret@polygon-amoy.gateway.tenderly.co',
    'https://polygon-amoy.gateway.tenderly.co?apiKey=secret', 'https://name:secret@80002.rpc.thirdweb.com',
    'https://80002.rpc.thirdweb.com?apiKey=secret', 'https://80002.rpc.thirdweb.com/unapproved',
    'https://80002.rpc.thirdweb.com.example', 'https://polygon-amoy.g.alchemy.com/v2/private', 'https://polygon-amoy.g.alchemy.com/v2?key=private',
    'https://name:private@polygon-amoy.g.alchemy.com/v2'])('never serializes credential-bearing or nonapproved observer endpoint %s', async url => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    expect(fundPaymentReceiptPrefillSchema.safeParse({ ...prefill, providers: [{ ...prefill.providers[0], url }, prefill.providers[1]] }).success).toBe(false)
  })
  it.each(['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com',
    'https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com', 'https://polygon-amoy.g.alchemy.com/v2'])('does not present two copies of %s as distinct service evidence', async url => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    const provider = { ...prefill.providers[0], url }
    expect(fundPaymentReceiptPrefillSchema.safeParse({ ...prefill, providers: [provider, provider] }).success).toBe(false)
  })
  it.each(['not-a-number', '-1', '1.5', (2n ** 256n).toString()])('fails malformed or out-of-range exact quantities without throwing from schema parsing: %s', async amount_base_units => {
    const f = fixture(), prefill = await inspectRecordedFundPayment(f.saved, { rpc: f.rpc, now })
    expect(fundPaymentReceiptPrefillSchema.safeParse({ ...prefill, amount_base_units }).success).toBe(false)
  })
})
