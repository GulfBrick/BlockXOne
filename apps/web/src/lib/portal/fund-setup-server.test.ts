import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupFixture, setupFixtureActor as actor, setupFixtureContext as context, setupFixtureProduct as product,
  setupFixtureSetup as setupId, setupFixtureAddress as address, setupFixtureId as id } from './fund-setup-fixtures.test-support'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ environment: 'TESTNET', worker: vi.fn(), nonce: vi.fn(), build: vi.fn(), step: vi.fn(), safe: vi.fn() }))
vi.mock('./fund-lifecycle-server', async importOriginal => ({ ...await importOriginal<typeof import('./fund-lifecycle-server')>(), fundLifecycleEnvironment: () => mocks.environment }))
vi.mock('./fund-lifecycle-worker', () => ({ callFundWorker: mocks.worker }))
vi.mock('./fund-setup-chain', async importOriginal => ({ ...await importOriginal<typeof import('./fund-setup-chain')>(),
  buildSetupIntent: mocks.build, buildSafeCreationIntent: mocks.build, readSetupNonce: mocks.nonce, observeSetupStep: mocks.step, observeSetupSafe: mocks.safe }))
import { prepareFundSetup, readFundSetup, verifyFundSetup } from './fund-setup-server'
import { FundSetupChainError } from './fund-setup-chain'

const hash = '0x' + 'd'.repeat(64)
const intent = { version: 1 as const, chain_id: 80002 as const, step_key: 'token_implementation' as const, kind: 'CREATE' as const,
  sender: address(1), nonce: '7', value: '0' as const, to: null, data: '0x6000', expected_address: address(9), artifact_name: 'Token',
  expected_runtime_hash: '0x' + 'e'.repeat(64), checks: [], configuration_hash: 'c'.repeat(64), catalog_hash: 'f'.repeat(64) }
function preparation() {
  const fixture = setupFixture()
  return { setup_id: setupId, expected_revision: 1, actor_id: actor, operating_context: context, environment: 'TESTNET', product_id: product,
    offering_revision_id: id(5), terms_hash: 'a'.repeat(64), configuration_hash: 'b'.repeat(64), setup_configuration_hash: 'c'.repeat(64),
    source_pin: fixture.source_pin, expires_at: fixture.setup!.expires_at, step_id: id(10), step_key: 'token_implementation', expected_step_revision: 1,
    sender: address(1), configuration: fixture.setup!.configuration, safe_configuration: null, dependencies: {}, roleplay_policy: null }
}
function client(value = setupFixture(), error: { code: string } | null = null) {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: value, error }) }))
  return { rpc } as unknown as Parameters<typeof readFundSetup>[0]
}
beforeEach(() => {
  mocks.environment = 'TESTNET'; vi.clearAllMocks()
  mocks.nonce.mockResolvedValue('7'); mocks.build.mockReturnValue(intent)
  mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_setup_preparation' ? preparation() : null)
})
describe('fund setup authenticated server adapter - synthetic source proof only', () => {
  it('does not call a database or worker in MAIN', async () => {
    mocks.environment = 'MAINNET'
    await expect(readFundSetup(client(), actor, product, context)).rejects.toMatchObject({ code: 'SETUP_NOT_ADMITTED' })
    expect(mocks.worker).not.toHaveBeenCalled()
  })
  it('rejects a returned account/context/product mismatch', async () => {
    const fixture = setupFixture(); fixture.actor_id = id(99)
    await expect(readFundSetup(client(fixture), actor, product, context)).rejects.toMatchObject({ code: 'SETUP_RESULT_UNVERIFIED' })
  })
  it('requires the current authenticated authorisation before restricted preparation', async () => {
    await expect(prepareFundSetup(client(setupFixture(), { code: '42501' }), actor,
      { setup_id: setupId, expected_revision: 1, step_key: 'token_implementation', sender: address(1), operating_context: context })).rejects.toMatchObject({ status: 403 })
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.nonce).not.toHaveBeenCalled()
  })
  it('rejects a worker actor mismatch before looking at the chain', async () => {
    mocks.worker.mockResolvedValue({ ...preparation(), actor_id: id(99) })
    await expect(prepareFundSetup(client(), actor, { setup_id: setupId, expected_revision: 1, step_key: 'token_implementation', sender: address(1), operating_context: context })).rejects.toMatchObject({ code: 'SETUP_PREPARATION_UNVERIFIED' })
    expect(mocks.nonce).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled()
  })
  it('builds only from saved configuration and independent nonce, then rereads as the actual user', async () => {
    const db = client()
    await prepareFundSetup(db, actor, { setup_id: setupId, expected_revision: 1, step_key: 'token_implementation', sender: address(1), operating_context: context })
    expect(mocks.build).toHaveBeenCalledWith('token_implementation', preparation().configuration, {}, address(1), '7', 'c'.repeat(64))
    expect(mocks.worker).toHaveBeenCalledWith('prepare_fund_setup_step', [preparation(), intent])
    expect(db.rpc).toHaveBeenLastCalledWith('bx1_portal_fund_setup_read', { product_id: product, operating_context: context })
    expect(mocks.step).not.toHaveBeenCalled()
  })
  it('persists a detected finality break as recovery, not replacement success', async () => {
    const fixture = setupFixture(), step = fixture.setup!.steps[0]
    Object.assign(step, { state: 'FINAL', intent, intent_hash: '9'.repeat(64), transaction_hash: hash })
    const request = { setup_id: setupId, expected_revision: 1, actor_id: actor, operating_context: context, environment: 'TESTNET', product_id: product,
      offering_revision_id: id(5), terms_hash: 'a'.repeat(64), configuration_hash: 'b'.repeat(64), setup_configuration_hash: 'c'.repeat(64),
      expires_at: '2099-01-01T00:00:00Z', kind: 'STEP', safe_address: address(2), step_id: id(10), expected_step_revision: 1,
      intent, intent_hash: '9'.repeat(64), transaction_hash: hash }
    mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_setup_observation' ? request : null)
    mocks.step.mockRejectedValue(new FundSetupChainError('SETUP_REORG_AFTER_WAIT', 503))
    await verifyFundSetup(client(fixture), actor, { setup_id: setupId, step_id: id(10), expected_revision: 1, operating_context: context })
    expect(mocks.worker).toHaveBeenCalledWith('record_fund_setup_observation', [request, expect.objectContaining({ status: 'RECOVERY_REQUIRED', reason_code: 'SETUP_REORG_AFTER_WAIT' })])
  })
})
