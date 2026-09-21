import { Interface, keccak256, Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { buildFundingClaimMessage, type FundingClaim } from './funding-claim'
import { createFundingRpc, FUNDING_RPC_URLS, FundingVerificationError, probeFundingRpcProviders, readBoundedFundingJson, verifyFundingExpectation, type FundingVerificationExpectation } from './funding-verifier'

const signer = new Wallet(`0x${'11'.repeat(32)}`) // Public synthetic key; never used on a network.
const address = '0x1111111111111111111111111111111111111111'
const receiver = '0x2222222222222222222222222222222222222222'
const txHash = `0x${'aa'.repeat(32)}`
const code = '0x60006000'
const abi = new Interface(['function transfer(address to,uint256 value) returns (bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)'])
const seconds = 1_790_000_000n
const now = () => Number(seconds + 100n) * 1000
const hex = (n: bigint) => `0x${n.toString(16)}`
const blockHash = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
const block = (n: bigint) => ({ number: hex(n), hash: blockHash(n), timestamp: hex(seconds + n), transactions: [blockHash(1n), blockHash(2n), txHash] })
type Mutation = (url: string, method: string, params: unknown[], value: unknown) => unknown
async function fixture(decimals = 6, amount = 25_000_000n, mutate?: Mutation) {
  const expectation: FundingVerificationExpectation = {
    id: '11111111-1111-4111-8111-111111111111', kind: 'REFERENCE', actor_id: '22222222-2222-4222-8222-222222222222',
    session_id: '33333333-3333-4333-8333-333333333333', expires_at: new Date(now() + 300_000).toISOString(), version: 1,
    target_id: '44444444-4444-4444-8444-444444444444', expectation_hash: 'ab'.repeat(32), operating_context: { mode: 'APPLICANT' },
    route: { id: '55555555-5555-4555-8555-555555555555', revision: 1, environment: 'TESTNET', chain_id: 80002, token_address: address, token_runtime_hash: keccak256(code), token_decimals: decimals, receiving_address: receiver },
    reference: { id: '44444444-4444-4444-8444-444444444444', obligation_id: '66666666-6666-4666-8666-666666666666', investment_account_id: '77777777-7777-4777-8777-777777777777', actor_id: '22222222-2222-4222-8222-222222222222', payer_address: signer.address.toLowerCase(), transaction_hash: txHash, log_index: 4, claim_signature: '', created_at: new Date(now() - 1000).toISOString(), obligation_created_at: new Date(Number(seconds) * 1000).toISOString() },
  }
  const f = expectation.reference!, r = expectation.route
  const claim: FundingClaim = { actor_id: f.actor_id, investment_account_id: f.investment_account_id, obligation_id: f.obligation_id, route_id: r.id, route_revision: r.revision, token_address: r.token_address, token_runtime_hash: r.token_runtime_hash, token_decimals: r.token_decimals, receiving_address: r.receiving_address, payer_address: f.payer_address, transaction_hash: f.transaction_hash, log_index: f.log_index }
  f.claim_signature = await signer.signMessage(buildFundingClaimMessage(claim))
  const event = abi.encodeEventLog(abi.getEvent('Transfer')!, [signer.address, receiver, amount])
  const log = { address, topics: event.topics, data: event.data, logIndex: '0x4', blockNumber: '0x64', blockHash: blockHash(100n), transactionHash: txHash, transactionIndex: '0x2', removed: false }
  const receipt = { transactionHash: txHash, blockHash: blockHash(100n), blockNumber: '0x64', transactionIndex: '0x2', from: signer.address, to: address, status: '0x1', logs: [log] }
  const transaction = { hash: txHash, blockHash: blockHash(100n), blockNumber: '0x64', transactionIndex: '0x2', from: signer.address, to: address, value: '0x0', chainId: '0x13882', input: abi.encodeFunctionData('transfer', [receiver, amount]) }
  const rpc = vi.fn(async (url: string, method: string, params: unknown[]): Promise<unknown> => {
    let value: unknown
    if (method === 'eth_chainId') value = '0x13882'
    else if (method === 'eth_getBlockByNumber') value = block(params[0] === 'finalized' ? url === FUNDING_RPC_URLS[0] ? 120n : 123n : BigInt(String(params[0])))
    else if (method === 'eth_getTransactionReceipt') value = receipt
    else if (method === 'eth_getTransactionByHash') value = transaction
    else if (method === 'eth_getCode') value = code
    else if (method === 'eth_call') value = `0x${BigInt(decimals).toString(16).padStart(64, '0')}`
    else throw new Error('Unexpected fixture method')
    const cloned = structuredClone(value)
    return mutate ? mutate(url, method, params, cloned) : cloned
  })
  return { expectation, rpc, claim, receipt, transaction, log }
}
const rec = (value: unknown) => value as Record<string, unknown>

describe('two-provider finalized TEST funding receipt verification', () => {
  it('accepts genuine signed direct ERC20 transfer without equating provider finalized heads', async () => {
    const f = await fixture()
    const result = await verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })
    expect(result).toMatchObject({ kind: 'REFERENCE', status: 'VERIFIED', chain_id: 80002, amount_base_units: '25000000', block_number: '100', block_hash: blockHash(100n), transaction_hash: txHash, log_index: 4, payer_address: signer.address.toLowerCase() })
    expect(result.providers.map(p => p.finalized_block_number)).toEqual(['120', '123'])
    expect(new Set(f.rpc.mock.calls.map(([url]) => url))).toEqual(new Set(FUNDING_RPC_URLS))
    expect(f.rpc.mock.calls.every(([, method]) => !/send|sign/i.test(method))).toBe(true)
  })
  it.each([2, 6, 8, 18])('retains exact base units at %i decimals and beyond JS safe integer precision', async decimals => {
    const amount = 9_007_199_254_740_993n * 10n ** BigInt(decimals - 2)
    const f = await fixture(decimals, amount)
    expect(await verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).toMatchObject({ status: 'VERIFIED', token_decimals: decimals, amount_base_units: amount.toString() })
  })
  it('checks a route against a common finalized block and both pinned token observations', async () => {
    const f = await fixture()
    const { reference: _reference, ...base } = f.expectation
    const route: FundingVerificationExpectation = { ...base, kind: 'ROUTE', target_id: base.route.id }
    expect(await verifyFundingExpectation(route, { rpc: f.rpc, now })).toMatchObject({ kind: 'ROUTE', status: 'VERIFIED', block_number: '120', block_hash: blockHash(120n) })
    expect(f.rpc.mock.calls.filter(([, method]) => method === 'eth_getCode').map(([, , params]) => params)).toEqual([[address, '0x78'], [address, '0x78']])
  })
  it('preserves pre-obligation payment facts as UNAPPLIED rather than unpaid or accepted funding', async () => {
    const f = await fixture()
    f.expectation.reference!.obligation_created_at = new Date(Number(seconds + 101n) * 1000).toISOString()
    expect(await verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).toMatchObject({ status: 'VERIFIED', policy_status: 'UNAPPLIED', reason_code: 'PRE_OBLIGATION', amount_base_units: '25000000' })
  })
  it('returns the only conclusive unpaid result for dual-provider finalized reverted execution', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, _params, value) => method === 'eth_getTransactionReceipt' ? { ...rec(value), status: '0x0', logs: [] } : value)
    const result = await verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })
    expect(result).toMatchObject({ status: 'INVALID', reason_code: 'RECEIPT_REVERTED', block_hash: blockHash(100n), transaction_hash: txHash })
    expect(result).not.toHaveProperty('amount_base_units')
  })
  it('does not label a bad signature unpaid or even query a provider for it', async () => {
    const f = await fixture()
    f.expectation.reference!.claim_signature = `0x${'00'.repeat(64)}1b`
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'INVALID_CLAIM_SIGNATURE', status: 403 })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('does not rebind the original investor claim to the finance verifier caller', async () => {
    const f = await fixture()
    f.expectation.actor_id = '88888888-8888-4888-8888-888888888888'
    expect(await verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).toMatchObject({ status: 'VERIFIED' })
  })
  it.each([
    ['WRONG_PROVIDER_CHAIN', 'eth_chainId', () => '0x89'],
    ['FINALITY_UNAVAILABLE', 'eth_getBlockByNumber', (_v: unknown, p: unknown[]) => p[0] === 'finalized' ? null : _v],
    ['TRANSACTION_PENDING_OR_UNKNOWN', 'eth_getTransactionReceipt', () => null],
    ['TRANSACTION_IDENTITY_MISMATCH', 'eth_getTransactionByHash', (v: unknown) => ({ ...rec(v), from: receiver })],
    ['TRANSACTION_IDENTITY_MISMATCH', 'eth_getTransactionByHash', (v: unknown) => ({ ...rec(v), value: '0x1' })],
    ['TRANSFER_CALL_MISMATCH', 'eth_getTransactionByHash', (v: unknown) => ({ ...rec(v), input: abi.encodeFunctionData('transfer', [address, 25_000_000n]) })],
    ['UNSUPPORTED_TRANSFER_CALL', 'eth_getTransactionByHash', (v: unknown) => ({ ...rec(v), input: '0x' })],
    ['TOKEN_RUNTIME_MISMATCH', 'eth_getCode', () => '0x60016001'],
    ['TOKEN_DECIMALS_MISMATCH', 'eth_call', () => `0x${'0'.repeat(63)}8`],
    ['INVALID_RECEIPT_STATUS', 'eth_getTransactionReceipt', (v: unknown) => ({ ...rec(v), status: '0x2' })],
  ] as const)('fails closed on %s without returning unpaid evidence', async (code, changedMethod, change) => {
    const f = await fixture(6, 25_000_000n, (_url, method, params, value) => method === changedMethod ? change(value, params) : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code })
  })
  it('does not replace finalized-tag evidence with a confirmation count', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === 'finalized' ? block(99n) : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FINALIZED', status: 202 })
  })
  it('rejects canonical block-hash divergence even when the receipt is successful', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === '0x64' ? { ...rec(value), hash: blockHash(999n) } : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'CANONICAL_BLOCK_MISMATCH' })
  })
  it('requires the transaction at the exact canonical block index, not just anywhere in that block', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === '0x64' ? { ...rec(value), transactions: [txHash, blockHash(1n), blockHash(2n)] } : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'CANONICAL_BLOCK_MISMATCH' })
  })
  it('requires each finalized-tag block itself to match that provider\'s canonical block', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, params, value) => method === 'eth_getBlockByNumber' && params[0] === 'finalized' ? { ...rec(value), hash: blockHash(999n) } : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'FINALIZED_BLOCK_MISMATCH' })
  })
  it('rejects disagreement between independently otherwise valid receipts', async () => {
    const f = await fixture(6, 25_000_000n, (url, method, _params, value) => url === FUNDING_RPC_URLS[1] && method === 'eth_getTransactionReceipt' ? { ...rec(value), status: '0x0', logs: [] } : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'PROVIDER_DISAGREEMENT' })
  })
  it.each([
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { removed: true }],
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { removed: undefined }],
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { blockHash: blockHash(999n) }],
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { transactionHash: `0x${'bb'.repeat(32)}` }],
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { transactionIndex: '0x3' }],
    ['TRANSFER_LOG_IDENTITY_MISMATCH', { data: '0x01' }],
    ['TRANSFER_AMOUNT_MISMATCH', { data: `0x${'0'.repeat(63)}1` }],
    ['TRANSFER_LOG_NOT_UNIQUELY_FOUND', { logIndex: '0x5' }],
  ] as const)('does not accept malformed/mismatched Transfer evidence: %s %#', async (code, patch) => {
    const f = await fixture(6, 25_000_000n, (_url, method, _params, value) => method === 'eth_getTransactionReceipt' ? { ...rec(value), logs: [(rec(value).logs as Record<string, unknown>[]).map(log => ({ ...log, ...patch }))[0]] } : value)
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code })
  })
  it('rejects mint/burn topics, noncanonical indexed addresses and another recipient', async () => {
    for (const replacement of [`0x${'0'.repeat(64)}`, `0x${'1'.repeat(64)}`, `0x${'0'.repeat(24)}${address.slice(2)}`]) {
      const f = await fixture(6, 25_000_000n, (_url, method, _params, value) => {
        if (method !== 'eth_getTransactionReceipt') return value
        const log = (rec(value).logs as Record<string, unknown>[])[0]
        return { ...rec(value), logs: [{ ...log, topics: [(log.topics as string[])[0], (log.topics as string[])[1], replacement] }] }
      })
      await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toBeInstanceOf(FundingVerificationError)
    }
  })
  it('cannot count a second Transfer event from one direct transfer as a second payment', async () => {
    const f = await fixture(6, 25_000_000n, (_url, method, _params, value) => {
      if (method !== 'eth_getTransactionReceipt') return value
      const log = (rec(value).logs as Record<string, unknown>[])[0]
      return { ...rec(value), logs: [log, { ...log, logIndex: '0x5' }] }
    })
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'AMBIGUOUS_TOKEN_TRANSFERS' })
  })
  it('rechecks expectation expiry after provider waits', async () => {
    const f = await fixture()
    let calls = 0
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now: () => now() + (calls++ ? 400_000 : 0) })).rejects.toMatchObject({ code: 'EXPIRED_VERIFICATION_EXPECTATION' })
  })
  it('rejects the wrong environment before any RPC call', async () => {
    const f = await fixture()
    f.expectation.route.environment = 'MAINNET' as 'TESTNET'
    await expect(verifyFundingExpectation(f.expectation, { rpc: f.rpc, now })).rejects.toMatchObject({ code: 'INVALID_TEST_ROUTE' })
    expect(f.rpc).not.toHaveBeenCalled()
  })
})

describe('bounded fixed-origin RPC transport', () => {
  it('never accepts arbitrary provider URLs or sends transaction/signing RPCs', async () => {
    const fetcher = vi.fn()
    await expect(createFundingRpc(fetcher)('https://untrusted.example', 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_ENDPOINT_NOT_ALLOWED' })
    await expect(createFundingRpc(fetcher)(FUNDING_RPC_URLS[0], 'eth_sendRawTransaction', ['0x00'])).rejects.toMatchObject({ code: 'RPC_METHOD_NOT_ALLOWED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('validates the JSON-RPC response identity and uses bounded no-redirect POST', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body))
      return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x13882' })
    })
    expect(await createFundingRpc(fetcher)(FUNDING_RPC_URLS[0], 'eth_chainId', [])).toBe('0x13882')
    expect(fetcher).toHaveBeenCalledWith(FUNDING_RPC_URLS[0], expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) }))
  })
  it.each([
    () => Response.json({ jsonrpc: '2.0', id: 999, result: '0x13882' }),
    () => Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'secret upstream diagnostic' } }),
    () => new Response('<html>failure</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ result: '0x13882' }, { status: 429 }),
  ])('does not turn missing or failed provider output into success %#', async response => {
    await expect(createFundingRpc(vi.fn(async () => response()))(FUNDING_RPC_URLS[0], 'eth_chainId', [])).rejects.toBeInstanceOf(FundingVerificationError)
  })
  it('enforces actual bytes and already-aborted deadlines', async () => {
    await expect(readBoundedFundingJson(new Response(JSON.stringify({ large: 'x'.repeat(200) }), { headers: { 'Content-Length': '1' } }), 64, new AbortController().signal)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' })
    const abort = new AbortController(); abort.abort()
    await expect(readBoundedFundingJson(Response.json({ ok: true }), 64, abort.signal)).rejects.toMatchObject({ code: 'REQUEST_TIMED_OUT' })
  })
  it('redacts network errors instead of exposing credential-bearing diagnostics', async () => {
    await expect(createFundingRpc(vi.fn(async () => { throw new Error('upstream password=private') }))(FUNDING_RPC_URLS[0], 'eth_chainId', [])).rejects.toMatchObject({ code: 'RPC_RESPONSE_UNAVAILABLE', message: 'RPC_RESPONSE_UNAVAILABLE' })
  })
  it('does not let the explicit availability probe pass when either provider is unavailable', async () => {
    await expect(probeFundingRpcProviders(vi.fn(async () => { throw new Error('network unavailable') }))).rejects.toMatchObject({ code: 'RPC_RESPONSE_UNAVAILABLE' })
  })
})
