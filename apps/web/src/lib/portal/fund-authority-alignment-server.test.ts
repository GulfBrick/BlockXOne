import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  environment: 'TESTNET', worker: vi.fn(), prepare: vi.fn(), verifySignature: vi.fn(), build: vi.fn(), observe: vi.fn(), discover: vi.fn(),
}))
vi.mock('./fund-lifecycle-server', async importOriginal => ({
  ...await importOriginal<typeof import('./fund-lifecycle-server')>(), fundLifecycleEnvironment: () => mocks.environment,
}))
vi.mock('./fund-lifecycle-worker', () => ({ callFundWorker: mocks.worker }))
vi.mock('./fund-authority-alignment-chain', async importOriginal => ({
  ...await importOriginal<typeof import('./fund-authority-alignment-chain')>(),
  prepareFundAuthorityAlignment: mocks.prepare,
  verifyFundAuthorityAlignmentSignature: mocks.verifySignature,
  buildSignedFundAuthorityAlignmentTransaction: mocks.build,
  observeFundAuthorityAlignment: mocks.observe,
  discoverFundAuthorityAlignment: mocks.discover,
}))

import { handleFundAuthorityAlignment } from './fund-authority-alignment-server'
import { FundAuthorityAlignmentChainError } from './fund-authority-alignment-chain'
import { canonicalAdmissionFixture, testAddress, testHash, testId } from './fund-chain-test-fixtures'
import type { FundAuthorityAlignmentRead, FundAuthorityAlignmentRequest } from './fund-authority-alignment-contracts'

const actor = testId(1), setupId = testId(5), requestId = testId(40), operationId = testId(41)
const context = { mode: 'ROLE' as const, organisationId: testId(2), role: 'TokenisationAgent' as const }
const requestKey = testId(42), digest = 'ab'.repeat(32), intentDigest = 'cd'.repeat(32), reasonHash = testHash(50)
const owners = [testAddress(1), testAddress(9)].sort(), future = '2100-01-01T00:00:00Z', now = '2026-10-19T00:00:00Z'
const zero = '0x0000000000000000000000000000000000000000' as const
const snapshot = { block: { number: '100', hash: testHash(100), timestamp: now }, providers: [
  { url: 'https://80002.rpc.thirdweb.com' as const, finalized_block_number: '101', finalized_block_hash: testHash(101) },
  { url: 'https://polygon-amoy.gateway.tenderly.co' as const, finalized_block_number: '102', finalized_block_hash: testHash(102) },
] }
const intent = {
  version: 1 as const, chain_id: 80002 as const, admission_request_id: requestId,
  native_binding_hash: digest, reason_hash: reasonHash, previous_epoch: 1, target_epoch: 2,
  controller_address: testAddress(70), controller_runtime_hash: testHash(52), factory_address: testAddress(71),
  safe_address: testAddress(72), safe_owners: owners, safe_threshold: 2, executor_address: owners[0], executor_nonce: '12',
  safe_transaction: { to: testAddress(70), value: '0' as const, data: '0x1234', operation: 0 as const,
    safeTxGas: '0' as const, baseGas: '0' as const, gasPrice: '0' as const,
    gasToken: zero, refundReceiver: zero, nonce: '8' },
  safe_transaction_hash: testHash(53), snapshot, valid_until: future,
}
const execution = { chain_id: 80002 as const, from: owners[0], to: intent.safe_address, value: '0' as const, data: '0x5678', nonce: '12' }

function baseRead(operation: FundAuthorityAlignmentRead['operation'] = null, receipt = testId(800)): FundAuthorityAlignmentRead {
  const input = canonicalAdmissionFixture().input
  input.authority_epoch = 2
  input.setup.roleplay_policy = { policy_id: testId(45), epoch: 2, expires_at: future,
    label: 'TEST ROLE PLAY - one operator; not independent human approval' }
  return { schema_version: 1, environment: 'TESTNET', actor_id: actor, operating_context: context,
    admission_request_id: requestId, setup_id: setupId, setup_revision: 100,
    input_hash: digest, native_binding_hash: digest, reason_hash: reasonHash, authority_expires_at: future,
    authorisation_receipt_id: receipt, input, operation }
}
function preparedOperation(state: 'PREPARED' | 'SIGNING' | 'UNKNOWN' | 'BROADCAST' | 'PENDING' = 'PREPARED', revision = 1,
  transactionHash: string | null = null) {
  return { id: operationId, revision, state, intent, intent_hash: intentDigest,
    signatures: state === 'PREPARED' ? [] : owners.map((signer, index) => ({ signer, signature: `0x${String(index + 1).repeat(130)}` })),
    executor_nonce: '12', transaction_hash: transactionHash,
    claimed_at: ['UNKNOWN', 'BROADCAST', 'PENDING'].includes(state) ? now : null,
    claim_key: ['UNKNOWN', 'BROADCAST', 'PENDING'].includes(state) ? requestKey : null, observation: null }
}
function request(action: FundAuthorityAlignmentRequest['action'], extra: Record<string, unknown> = {}) {
  return { setup_id: setupId, setup_revision: 100, operating_context: context, action, ...extra } as FundAuthorityAlignmentRequest
}
function database(read: () => FundAuthorityAlignmentRead, events: string[]) {
  let receipt = 900
  const rpc = vi.fn((_name: string, args: Record<string, unknown>) => {
    const purpose = String(args.purpose); events.push(`authorise:${purpose}`)
    const value = { ...read(), operation: null, authorisation_receipt_id: testId(receipt++) }
    return { abortSignal: () => Promise.resolve({ data: value, error: null }) }
  })
  return { rpc } as unknown as Parameters<typeof handleFundAuthorityAlignment>[0]
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.environment = 'TESTNET'; mocks.prepare.mockResolvedValue({ already_aligned: false, intent })
  mocks.verifySignature.mockImplementation((_intent, signer, signature) => ({ signer, signature }))
  mocks.build.mockReturnValue(execution); mocks.discover.mockResolvedValue(null)
})

describe('fund authority alignment authenticated server adapter', () => {
  it('keeps MAIN read-only before authorisation, workers or provider work', async () => {
    mocks.environment = 'MAINNET'; const events: string[] = [], db = database(() => baseRead(), events)
    await expect(handleFundAuthorityAlignment(db, actor, request('READ'))).rejects.toMatchObject({ code: 'ALIGNMENT_MAIN_NOT_ADMITTED' })
    expect(events).toEqual([]); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('reauthorises after the provider wait and forwards each exact single-use receipt to its restricted phase', async () => {
    const events: string[] = []; let current = baseRead(), finish!: (value: unknown) => void
    mocks.prepare.mockImplementationOnce(() => { events.push('provider:prepare'); return new Promise(resolve => { finish = resolve }) })
    mocks.worker.mockImplementation(async (name: string, args: unknown[]) => {
      events.push(`worker:${name}`)
      if (name === 'read_fund_authority_alignment') return structuredClone(current)
      if (name === 'record_fund_authority_alignment') { current = baseRead(preparedOperation()); return structuredClone(current) }
      throw new Error(`Unexpected worker ${name}:${JSON.stringify(args)}`)
    })
    const db = database(() => current, events)
    const pending = handleFundAuthorityAlignment(db, actor, request('PREPARE', { request_key: requestKey }))
    await vi.waitFor(() => expect(events).toContain('provider:prepare'))
    expect(events).toEqual(['authorise:ALIGNMENT_READ', 'worker:read_fund_authority_alignment', 'provider:prepare'])
    expect(mocks.worker).not.toHaveBeenCalledWith('record_fund_authority_alignment', expect.anything())
    finish({ already_aligned: false, intent })
    const result = await pending
    expect(result.operation?.state).toBe('PREPARED')
    expect(events).toEqual([
      'authorise:ALIGNMENT_READ', 'worker:read_fund_authority_alignment', 'provider:prepare',
      'authorise:ALIGNMENT_READ', 'worker:read_fund_authority_alignment',
      'authorise:ALIGNMENT_WRITE', 'worker:record_fund_authority_alignment',
    ])
    const reads = mocks.worker.mock.calls.filter(([name]) => name === 'read_fund_authority_alignment')
    expect(reads).toHaveLength(2)
    expect(reads[0][1][3]).toBe(testId(900)); expect(reads[1][1][3]).toBe(testId(901))
    const record = mocks.worker.mock.calls.find(([name]) => name === 'record_fund_authority_alignment')!
    expect(record[1][1]).toBe('PREPARE'); expect(record[1][2]).toBe(requestKey); expect(record[1][4]).toBe(testId(902))
  })

  it('denies a changed preparation after the provider wait before issuing write authority', async () => {
    const events: string[] = []; let current = baseRead(), finish!: (value: unknown) => void
    mocks.prepare.mockImplementationOnce(() => { events.push('provider:prepare'); return new Promise(resolve => { finish = resolve }) })
    mocks.worker.mockImplementation(async (name: string) => {
      events.push(`worker:${name}`)
      if (name === 'read_fund_authority_alignment') return structuredClone(current)
      throw new Error('A stale preparation must not reach the writer.')
    })
    const pending = handleFundAuthorityAlignment(database(() => current, events), actor,
      request('PREPARE', { request_key: requestKey }))
    await vi.waitFor(() => expect(events).toContain('provider:prepare'))
    current = { ...current, reason_hash: testHash(999) }
    finish({ already_aligned: false, intent })
    await expect(pending).rejects.toMatchObject({ code: 'ALIGNMENT_PREPARATION_CHANGED' })
    expect(events).not.toContain('authorise:ALIGNMENT_WRITE')
    expect(mocks.worker).not.toHaveBeenCalledWith('record_fund_authority_alignment', expect.anything())
  })

  it('selects the nonce-bound replacement winner before observing a saved BROADCAST candidate', async () => {
    const events: string[] = [], oldHash = testHash(700), winner = testHash(701)
    let current = baseRead(preparedOperation('BROADCAST', 4, oldHash))
    const observation = {
      schema_version: 1 as const, chain_id: 80002 as const, status: 'PENDING' as const,
      admission_request_id: requestId, native_binding_hash: digest, safe_transaction_hash: intent.safe_transaction_hash,
      reason_hash: reasonHash, transaction_hash: winner, executor_address: intent.executor_address, executor_nonce: intent.executor_nonce,
      safe_address: intent.safe_address, safe_nonce: intent.safe_transaction.nonce, controller_address: intent.controller_address,
      previous_epoch: 1, target_epoch: 2, block_number: null, block_hash: null, confirmations: null, required_confirmations: 64,
      snapshot, receipt_hashes: [], reason_code: 'ALIGNMENT_TRANSACTION_PENDING', inner_execution_success: false,
      epoch_verified: false, observed_epoch: null, epoch_event: null,
    }
    mocks.discover.mockResolvedValueOnce(winner)
    mocks.observe.mockImplementationOnce(async (_read, _intent, _signatures, transactionHash) => {
      events.push(`observe:${transactionHash}`)
      return observation
    })
    mocks.worker.mockImplementation(async (name: string, args: unknown[]) => {
      events.push(`worker:${name}${name === 'record_fund_authority_alignment' ? `:${String(args[1])}` : ''}`)
      if (name === 'read_fund_authority_alignment') return structuredClone(current)
      if (name === 'record_fund_authority_alignment' && args[1] === 'HASH') return structuredClone(current)
      if (name === 'record_fund_authority_alignment' && args[1] === 'OBSERVE') {
        current = baseRead({ ...preparedOperation('PENDING', 5, winner), observation })
        return structuredClone(current)
      }
      throw new Error(`Unexpected worker ${name}:${JSON.stringify(args)}`)
    })
    const result = await handleFundAuthorityAlignment(database(() => current, events), actor,
      request('VERIFY', { request_key: requestKey, operation_id: operationId, expected_revision: 4 }))
    expect(result.operation).toMatchObject({ state: 'PENDING', transaction_hash: winner })
    expect(mocks.discover).toHaveBeenCalledWith(expect.anything(), intent, expect.anything(), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(mocks.observe).toHaveBeenCalledWith(expect.anything(), intent, expect.anything(), winner,
      expect.objectContaining({ signal: expect.any(AbortSignal) }))
    const writes = mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_authority_alignment')
    expect(writes.map(([, args]) => [args[1], (args[3] as { transaction_hash?: string }).transaction_hash]))
      .toEqual([['HASH', winner], ['OBSERVE', winner]])
    expect(events.indexOf(`observe:${winner}`)).toBeGreaterThan(events.indexOf('worker:record_fund_authority_alignment:HASH'))
  })

  it.each([['ALIGNMENT_OBSERVERS_DISAGREE', 409], ['ALIGNMENT_OBSERVATION_UNAVAILABLE', 503]] as const)(
    'maps %s to a redacted bounded domain error without a worker write', async (code, status) => {
      const current = baseRead(); mocks.prepare.mockRejectedValueOnce(new FundAuthorityAlignmentChainError(code, status))
      mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_authority_alignment' ? structuredClone(current) : null)
      const failure = await handleFundAuthorityAlignment(database(() => current, []), actor,
        request('PREPARE', { request_key: requestKey })).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code, status })
      expect(String((failure as Error).message)).not.toContain('http')
      expect(mocks.worker).not.toHaveBeenCalledWith('record_fund_authority_alignment', expect.anything())
    })

  it('returns actionable execution only when the writer confirms this exact claim key and operation', async () => {
    const events: string[] = []; let current = baseRead(preparedOperation('SIGNING', 3))
    mocks.worker.mockImplementation(async (name: string, args: unknown[]) => {
      events.push(`worker:${name}`)
      if (name === 'read_fund_authority_alignment') return structuredClone(current)
      if (name === 'record_fund_authority_alignment') { current = baseRead(preparedOperation('UNKNOWN', 4)); return structuredClone(current) }
      throw new Error(`Unexpected worker ${name}:${JSON.stringify(args)}`)
    })
    const result = await handleFundAuthorityAlignment(database(() => current, events), actor,
      request('CLAIM', { request_key: requestKey, operation_id: operationId, expected_revision: 3 }))
    expect(result.execution).toEqual(execution); expect(result.operation).toMatchObject({ state: 'UNKNOWN', claim_key: requestKey })
    const record = mocks.worker.mock.calls.find(([name]) => name === 'record_fund_authority_alignment')!
    expect(record[1][1]).toBe('CLAIM'); expect(record[1][2]).toBe(requestKey); expect(record[1][4]).toMatch(/^00000000-/)

    current = baseRead(preparedOperation('SIGNING', 3)); mocks.worker.mockClear()
    mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_authority_alignment'
      ? structuredClone(current) : baseRead({ ...preparedOperation('UNKNOWN', 4), claim_key: testId(999) }))
    await expect(handleFundAuthorityAlignment(database(() => current, []), actor,
      request('CLAIM', { request_key: requestKey, operation_id: operationId, expected_revision: 3 }))).rejects.toMatchObject({ code: 'ALIGNMENT_CLAIM_UNVERIFIED' })
  })
})
