import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFixture, setupFixtureActor as actor, setupFixtureContext as context, setupFixtureProduct as product,
  setupFixtureSetup as setupId, setupFixtureAddress as address, setupFixtureId as id } from './fund-setup-fixtures.test-support'
import { buildSetupIntent, fundSetupHash, type FundSetupAddresses } from './fund-setup-chain'
import nativeGolden from './fixtures/fund-setup-native-hash-golden.json'
import type { FundSetupSnapshot } from './fund-setup-contracts'
import type { FundSetupRecoveryProof, FundSetupRetryLease, FundSetupRetryRead, FundSetupRetryRequest } from './fund-setup-recovery-contracts'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ environment: 'TESTNET', worker: vi.fn(), check: vi.fn(), read: vi.fn(), verify: vi.fn() }))
vi.mock('./fund-lifecycle-server', async original => ({ ...await original<typeof import('./fund-lifecycle-server')>(), fundLifecycleEnvironment: () => mocks.environment }))
vi.mock('./fund-lifecycle-worker', () => ({ callFundWorker: mocks.worker }))
vi.mock('./fund-setup-server', () => ({ readFundSetup: mocks.read, verifyFundSetup: mocks.verify }))
vi.mock('./fund-setup-recovery-chain', async original => ({ ...await original<typeof import('./fund-setup-recovery-chain')>(), checkFundSetupRecovery: mocks.check }))
import { recoverFundSetup } from './fund-setup-recovery-server'
import { FundSetupRecoveryChainError } from './fund-setup-recovery-chain'

let fixture: FundSetupSnapshot, read: FundSetupRetryRead, proof: FundSetupRecoveryProof
const txHash = `0x${'d'.repeat(64)}`
function base(action: 'CHECK' | 'CLAIM' = 'CHECK'): FundSetupRetryRequest {
  const scope = { product_id: product, setup_id: setupId, step_id: id(20), expected_revision: 1, expected_step_revision: 1, operating_context: context }
  return action === 'CHECK' ? { ...scope, action } : { ...scope, action, request_key: id(70) }
}
function client(denied = false) {
  return { rpc: vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: fixture, error: denied ? { code: '42501' } : null }) })) } as unknown as Parameters<typeof recoverFundSetup>[0]
}
function lease(): FundSetupRetryLease {
  const now = Date.now()
  return { id: id(80), setup_id: setupId, step_id: id(20), actor_id: actor, operating_context: context,
    intent_hash: read.intent_hash, sender: read.sender, nonce: '12', request_key: id(70),
    expected_revision: 1, expected_step_revision: 1, created_at: new Date(now).toISOString(), expires_at: new Date(now + 120000).toISOString() }
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.environment = 'TESTNET'
  fixture = setupFixture(); const setup = fixture.setup!, step = setup.steps[10]
  const dependencies = Object.fromEntries(setup.steps.slice(0, 10).map((item, i) => [item.step_key, address(i + 20)])) as FundSetupAddresses
  const intent = buildSetupIntent('trex_version', setup.configuration!, dependencies, address(3), '12', setup.setup_configuration_hash!)
  Object.assign(step, { state: 'UNKNOWN', actor_id: actor, sender: address(3), nonce: '12', intent, intent_hash: nativeGolden.native_intent_hash,
    expires_at: '2000-01-01T00:00:00Z', claimed_at: '2000-01-01T00:00:00Z' })
  setup.next_step = 'trex_version'; setup.dependencies = dependencies; setup.saved_intent = intent
  read = { setup_id: setupId, expected_revision: 1, actor_id: actor, operating_context: context, environment: 'TESTNET',
    product_id: product, offering_revision_id: fixture.offering_revision_id!, terms_hash: fixture.terms_hash,
    configuration_hash: fixture.configuration_hash!, setup_configuration_hash: setup.setup_configuration_hash!, source_pin: fixture.source_pin,
    expires_at: setup.expires_at, step_id: step.id, step_key: 'trex_version', expected_step_revision: 1,
    sender: address(3), configuration: setup.configuration, safe_configuration: null, dependencies, roleplay_policy: null,
    intent: structuredClone(intent), intent_hash: step.intent_hash!, original_state: 'UNKNOWN', original_transaction_hash: null,
    original_claimed_at: step.claimed_at!, original_expires_at: step.expires_at!,
    anchor: { block_number: '100', block_hash: `0x${'a'.repeat(64)}` }, retry_count: 0, next_retry_at: null, active_lease: null, leases: [] }
  proof = { version: 1, chain_id: 80002, checked_at: new Date().toISOString(), status: 'RETRY_AVAILABLE', reason_code: null,
    sender: read.sender, nonce: '12', intent_hash: read.intent_hash, anchor: read.anchor,
    finalized_nonce: { ...read.anchor, nonce: '12' },
    providers: ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'].map(url => ({ url: url as FundSetupRecoveryProof['providers'][number]['url'],
      finalized_block_number: '100', finalized_block_hash: read.anchor.block_hash, latest_nonce: '12', pending_nonce: '12' })),
    transaction_hash: null, retry_checks: { runtime_hash: intent.expected_runtime_hash, owner: read.sender, before_version: '0.0.0', simulation_succeeded: true }, winner: null }
  mocks.read.mockImplementation(async () => fixture)
  mocks.check.mockImplementation(async () => proof)
  mocks.verify.mockImplementation(async () => fixture)
  mocks.worker.mockImplementation(async (name: string, args: unknown[]) => {
    if (name === 'read_fund_setup_retry') return read
    if (name !== 'record_fund_setup_retry') throw new Error('Unexpected synthetic worker call')
    if (args[1] === 'CLAIM') {
      fixture = structuredClone(fixture); fixture.setup!.revision++; fixture.setup!.steps[10].revision++
      return { snapshot: fixture, lease: lease() }
    }
    if (args[1] === 'HASH') {
      fixture = structuredClone(fixture); fixture.setup!.revision++; fixture.setup!.steps[10].revision++
      fixture.setup!.steps[10].state = 'BROADCAST'; fixture.setup!.steps[10].transaction_hash = txHash
    }
    return { snapshot: fixture, lease: null }
  })
})
describe('hashless setup recovery server boundary - synthetic source proof only', () => {
  it('denies MAIN before reading any account, worker or provider', async () => {
    mocks.environment = 'MAINNET'
    await expect(recoverFundSetup(client(), actor, base())).rejects.toMatchObject({ code: 'SETUP_RETRY_NOT_ADMITTED' })
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled()
  })
  it('requires the protected authenticated boundary before worker or provider checks', async () => {
    await expect(recoverFundSetup(client(true), actor, base())).rejects.toMatchObject({ status: 403 })
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled()
  })
  it('checks without a wallet lease; historical original preparation expiry is not current authority', async () => {
    const result = await recoverFundSetup(client(), actor, base())
    expect(result.proof?.status).toBe('RETRY_AVAILABLE'); expect(result.lease).toBeNull()
    expect(mocks.worker).toHaveBeenCalledTimes(1)
    expect(mocks.check).toHaveBeenCalledWith(read.intent, read.anchor, { intent_hash: nativeGolden.native_intent_hash })
    expect(result.snapshot.setup!.steps[10].expires_at).toBe('2000-01-01T00:00:00Z')
  })
  it('preserves the PostgreSQL golden identity without equating it to the JS payload digest', async () => {
    expect(read.configuration).toEqual(nativeGolden.configuration)
    expect(read.dependencies).toEqual(nativeGolden.dependencies)
    expect(read.intent).toEqual(nativeGolden.intent)
    expect(fundSetupHash(read.intent)).not.toBe(nativeGolden.native_intent_hash)
    const result = await recoverFundSetup(client(), actor, base())
    expect(result.proof?.intent_hash).toBe(nativeGolden.native_intent_hash)
    expect(result.snapshot.setup!.steps[10].intent_hash).toBe(nativeGolden.native_intent_hash)
    expect(mocks.check).toHaveBeenCalledWith(read.intent, read.anchor, { intent_hash: nativeGolden.native_intent_hash })
  })
  it('rejects a jointly altered payload even when both reads retain the same native record identity', async () => {
    read.intent.data += '00'
    fixture.setup!.steps[10].intent = structuredClone(read.intent)
    await expect(recoverFundSetup(client(), actor, base())).rejects.toMatchObject({ code: 'SETUP_RETRY_INTENT_UNVERIFIED' })
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_setup_retry')).toHaveLength(0)
  })
  it.each(['actor', 'context', 'intent', 'nonce', 'state', 'product'] as const)('rejects a worker %s mismatch before provider work', async fault => {
    if (fault === 'actor') read.actor_id = id(99)
    if (fault === 'context') read.operating_context = { ...context, role: 'TokenisationAgent' }
    if (fault === 'intent') read.intent_hash = 'e'.repeat(64)
    if (fault === 'nonce') read.intent.nonce = '13'
    if (fault === 'state') read.original_state = 'FINAL'
    if (fault === 'product') read.product_id = id(99)
    await expect(recoverFundSetup(client(), actor, base())).rejects.toMatchObject({ code: 'SETUP_RETRY_READ_UNVERIFIED' })
    expect(mocks.check).not.toHaveBeenCalled()
  })
  it.each(['expired', 'different-intent', 'different-sender'] as const)('does not lease with %s proof', async fault => {
    if (fault === 'expired') proof.checked_at = new Date(Date.now() - 31000).toISOString()
    if (fault === 'different-intent') proof.intent_hash = 'e'.repeat(64)
    if (fault === 'different-sender') proof.sender = address(99)
    await expect(recoverFundSetup(client(), actor, base('CLAIM'))).rejects.toMatchObject({ code: 'SETUP_RETRY_PROOF_UNVERIFIED' })
    expect(mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_setup_retry')).toHaveLength(0)
  })
  it.each(['no-observers', 'no-checks', 'wrong-nonce', 'wrong-runtime', 'selected-version'] as const)('rejects impossible RETRY_AVAILABLE proof: %s', async fault => {
    if (fault === 'no-observers') proof.providers = []
    if (fault === 'no-checks') proof.retry_checks = null
    if (fault === 'wrong-nonce') proof.providers[0].pending_nonce = '13'
    if (fault === 'wrong-runtime') proof.retry_checks!.runtime_hash = `0x${'f'.repeat(64)}`
    if (fault === 'selected-version') proof.retry_checks!.before_version = '4.1.3'
    await expect(recoverFundSetup(client(), actor, base('CLAIM'))).rejects.toMatchObject({ code: 'SETUP_RETRY_PROOF_UNVERIFIED' })
    expect(mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_setup_retry')).toHaveLength(0)
  })
  it('returns UNKNOWN waiting without leasing or holding on provider unavailability', async () => {
    mocks.check.mockRejectedValue(new FundSetupRecoveryChainError('SETUP_RETRY_PROVIDER_UNAVAILABLE'))
    await expect(recoverFundSetup(client(), actor, base('CLAIM'))).rejects.toMatchObject({ status: 503 })
    expect(mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_setup_retry')).toHaveLength(0)
  })
  it('CAS-grants a lease without modifying the immutable original intent or expiry', async () => {
    const original = structuredClone(fixture.setup!.steps[10])
    const result = await recoverFundSetup(client(), actor, base('CLAIM'))
    expect(result.lease?.nonce).toBe('12'); expect(result.snapshot.setup?.revision).toBe(2)
    const step = result.snapshot.setup!.steps[10]
    expect(step).toEqual({ ...original, revision: 2 })
    expect(mocks.worker).toHaveBeenLastCalledWith('record_fund_setup_retry', [read, 'CLAIM', id(70), { proof }])
  })
  it('replays an expired lease without fresh RPC checks or a second grant', async () => {
    const existing = lease(); existing.created_at = '1999-12-31T23:58:00Z'; existing.expires_at = '2000-01-01T00:00:00Z'; read.leases = [existing]
    fixture.setup!.revision = 2; fixture.setup!.steps[10].revision = 2; read.expected_revision = 2; read.expected_step_revision = 2
    const result = await recoverFundSetup(client(), actor, base('CLAIM'))
    expect(result.lease).toEqual(existing); expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.worker).toHaveBeenCalledTimes(1)
  })
  it('does not turn a changed request-key payload into an idempotent success', async () => {
    read.leases = [{ ...lease(), expected_step_revision: 20 }]
    await expect(recoverFundSetup(client(), actor, base('CLAIM'))).rejects.toMatchObject({ code: 'SETUP_RETRY_REQUEST_CONFLICT' })
    expect(mocks.check).not.toHaveBeenCalled()
  })
  it('does not return a send-capable replay after another candidate is BROADCAST', async () => {
    read.leases = [lease()]; read.original_state = 'BROADCAST'; read.original_transaction_hash = txHash
    fixture.setup!.steps[10].state = 'BROADCAST'; fixture.setup!.steps[10].transaction_hash = txHash
    const result = await recoverFundSetup(client(), actor, base('CLAIM'))
    expect(result.lease).toBeNull(); expect(result.proof).toBeNull(); expect(mocks.check).not.toHaveBeenCalled()
  })
  it('waits at the attempt cap instead of presenting another wallet action', async () => {
    read.retry_count = 3
    const result = await recoverFundSetup(client(), actor, base())
    expect(result.proof).toMatchObject({ status: 'WAITING', reason_code: 'SETUP_RETRY_LIMIT_REACHED', retry_checks: null })
  })
  it('does not create irreversible hold from latest/pending consumption without finalized nonce consumption', async () => {
    proof.providers.forEach(item => { item.latest_nonce = '13'; item.pending_nonce = '13'; item.finalized_block_number = '102' })
    Object.assign(proof, { status: 'HOLD', reason_code: 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION', retry_checks: null,
      finalized_nonce: { block_number: '102', block_hash: read.anchor.block_hash, nonce: '12' } })
    await expect(recoverFundSetup(client(), actor, base())).rejects.toMatchObject({ code: 'SETUP_RETRY_PROOF_UNVERIFIED' })
    expect(mocks.worker.mock.calls.filter(([name]) => name === 'record_fund_setup_retry')).toHaveLength(0)
  })
  it('captures a legitimate late lease hash after a different winner is FINAL, using current authority rather than old CAS', async () => {
    read.leases = [lease()]; read.leases[0].created_at = '1999-12-31T23:58:00Z'; read.leases[0].expires_at = '2000-01-01T00:00:00Z'
    fixture.setup!.revision = 4; fixture.setup!.steps[10].revision = 5
    fixture.setup!.steps[10].state = 'FINAL'; fixture.setup!.steps[10].transaction_hash = `0x${'e'.repeat(64)}`
    Object.assign(read, { expected_revision: 4, expected_step_revision: 5, original_state: 'FINAL', original_transaction_hash: fixture.setup!.steps[10].transaction_hash })
    mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_setup_retry' ? read : { lease: null, snapshot: fixture })
    const result = await recoverFundSetup(client(), actor, { ...base(), action: 'HASH', lease_id: id(80), request_key: id(81), transaction_hash: txHash })
    expect(result.snapshot.setup!.steps[10].transaction_hash).toBe(`0x${'e'.repeat(64)}`)
    expect(mocks.check).not.toHaveBeenCalled()
    expect(mocks.worker).toHaveBeenLastCalledWith('record_fund_setup_retry', [read, 'HASH', id(81), { lease_id: id(80), transaction_hash: txHash, discovery_proof: null }])
  })
  it('records a discovered canonical winner then invokes the unchanged full verifier', async () => {
    proof.providers.forEach(item => { item.finalized_block_number = '102'; item.latest_nonce = '13'; item.pending_nonce = '13' })
    proof.finalized_nonce = { block_number: '102', block_hash: read.anchor.block_hash, nonce: '13' }
    Object.assign(proof, { status: 'WINNER', transaction_hash: txHash, retry_checks: null,
      winner: { block_number: '101', block_hash: `0x${'b'.repeat(64)}`, transaction_hash: txHash,
        from: read.sender, to: read.intent.to, value: '0', data: read.intent.data, nonce: '12', chain_id: 80002 } })
    await recoverFundSetup(client(), actor, base())
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), actor, { setup_id: setupId, step_id: read.step_id, expected_revision: 2, operating_context: context })
  })
  it('discovers the original winner even after a different retry candidate has been saved', async () => {
    fixture.setup!.steps[10].state = 'BROADCAST'; fixture.setup!.steps[10].transaction_hash = `0x${'c'.repeat(64)}`
    read.original_state = 'BROADCAST'; read.original_transaction_hash = fixture.setup!.steps[10].transaction_hash
    proof.providers.forEach(item => { item.finalized_block_number = '102'; item.latest_nonce = '13'; item.pending_nonce = '13' })
    proof.finalized_nonce = { block_number: '102', block_hash: read.anchor.block_hash, nonce: '13' }
    Object.assign(proof, { status: 'WINNER', transaction_hash: txHash, retry_checks: null,
      winner: { block_number: '101', block_hash: `0x${'b'.repeat(64)}`, transaction_hash: txHash,
        from: read.sender, to: read.intent.to, value: '0', data: read.intent.data, nonce: '12', chain_id: 80002 } })
    const result = await recoverFundSetup(client(), actor, base())
    expect(result.snapshot.setup!.steps[10].transaction_hash).toBe(txHash)
    expect(mocks.verify).toHaveBeenCalledTimes(1)
  })
})
