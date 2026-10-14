import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ environment: 'TESTNET', worker: vi.fn(), nonce: vi.fn(), safe: vi.fn(), build: vi.fn(),
  observe: vi.fn(), claim: vi.fn(), signature: vi.fn() }))
vi.mock('./fund-lifecycle-server', async importOriginal => ({ ...await importOriginal<typeof import('./fund-lifecycle-server')>(), fundLifecycleEnvironment: () => mocks.environment }))
vi.mock('./fund-lifecycle-worker', () => ({ callFundWorker: mocks.worker }))
vi.mock('./fund-setup-chain', async importOriginal => ({ ...await importOriginal<typeof import('./fund-setup-chain')>(), readSetupNonce: mocks.nonce, observeSetupSafe: mocks.safe }))
vi.mock('./fund-recipient-chain', async importOriginal => ({ ...await importOriginal<typeof import('./fund-recipient-chain')>(),
  prepareFundRecipientOperation: mocks.build, observeFundRecipientOperation: mocks.observe, verifyFundRecipientClaim: mocks.claim, verifyRecipientSafeSignature: mocks.signature }))
import { buildFundAdmissionCandidate } from './fund-chain-admission'
import { canonicalAdmissionFixture, testAddress, testId } from './fund-chain-test-fixtures'
import type { FundRecipientExpectation, FundRecipientIntent } from './fund-recipient-chain'
import type { FundRecipientSnapshot } from './fund-recipient-contracts'
import { commandFundRecipient, findFundRecipient, prepareFundRecipient, readFundRecipient, readFundRecipientClaimSigningRequest, verifyFundRecipient } from './fund-recipient-server'

const actor = testId(701), caseId = testId(702), operationId = testId(703), context = { mode: 'APPLICANT' as const }, bindingId = testId(704)
let expectation: FundRecipientExpectation, intent: FundRecipientIntent
function current(): FundRecipientSnapshot {
  return { schema_version: 1, environment: 'TESTNET', actor_id: actor, operating_context: context, expiry_enforced_on_chain: false,
    case: { id: caseId, revision: 1, product_id: expectation.product_id, offering_revision_id: expectation.offering_revision_id,
      manifest_id: testId(705), investment_account_id: expectation.investment_account_id, delivery_binding_id: bindingId, holder_user_id: actor,
      wallet_proof_id: expectation.wallet_proof_id, wallet_address: expectation.recipient_address, eligibility_case_id: expectation.eligibility_case_id,
      eligibility_revision: 1, claim_topic: '1', claim_signer_address: expectation.claim_signer_address, country_alpha2: 'ZA', country_code: 710,
      product_binding_hash: expectation.product_binding_hash, account_binding_hash: expectation.account_binding_hash, eligibility_binding_hash: expectation.eligibility_binding_hash,
      claim_valid_until: expectation.valid_until, identity_address: null, state: 'IDENTITY_REQUIRED', pending_signature_id: null, claim_signature_id: null,
      registration_observation_id: null, roleplay_policy_id: null, roleplay_epoch: null, created_by: actor, created_context: context, created_at: '2026-10-15T00:00:00Z' },
    operations: [{ id: operationId, revision: 1, phase: 'CREATE_IDENTITY', state: 'REQUESTED', actor_id: actor,
      operating_context: context, sender_address: expectation.sender_address, expires_at: expectation.action_valid_until,
      transaction_hash: null, intent: null, signatures: [] }] }
}
function client(value: unknown = current(), error: { code: string } | null = null) {
  const rpc = vi.fn(() => ({ abortSignal: () => Promise.resolve({ data: value, error }) }))
  return { rpc } as unknown as Parameters<typeof readFundRecipient>[0]
}
function preparation() { return { operation_id: operationId, expected_revision: 1, actor_id: actor, operating_context: context,
  case_id: caseId, expectation, saved_intent: null } }
const request = { operation_id: operationId, expected_revision: 1, operating_context: context }
beforeAll(async () => {
  const source = canonicalAdmissionFixture(), candidate = await buildFundAdmissionCandidate(source.input, { rpc: source.rpc })
  expectation = { operation_id: operationId, revision: 1, phase: 'CREATE_IDENTITY', product_id: source.input.setup.product_id,
    offering_revision_id: source.input.setup.offering_revision_id!, investment_account_id: testId(707), wallet_proof_id: testId(708),
    eligibility_case_id: testId(709), eligibility_revision: 1, product_binding_hash: source.input.product_binding_hash,
    account_binding_hash: 'ed'.repeat(32), eligibility_binding_hash: 'ef'.repeat(32), valid_until: '2100-01-01T00:00:00Z',
    action_valid_until: '2100-01-01T00:00:00Z', recipient_address: testAddress(710), identity_address: null, claim_topic: '1',
    claim_signer_address: testAddress(711), claim_signature: null, country_code: 710, sender_address: testAddress(710), sender_nonce: '0', safe_nonce: null,
    manifest: { ...candidate.manifest, status: 'ADMITTED' } }
  intent = { version: 1, chain_id: 80002, operation_id: operationId, operation_revision: 1, phase: 'CREATE_IDENTITY',
    expectation_hash: 'a'.repeat(64), catalog_hash: candidate.catalog_hash, sender_address: expectation.sender_address, sender_nonce: '7',
    execution_mode: 'EOA_TRANSACTION', to: null, value: '0', transaction_data: '0x6000', expected_identity_address: testAddress(712),
    claim_data: '0xabcd', claim_data_hash: `0x${'b'.repeat(64)}`, claim_id: `0x${'c'.repeat(64)}`, safe_transaction: null,
    safe_transaction_hash: null, safe_owners: candidate.manifest.safe.owners, safe_threshold: candidate.manifest.safe.threshold,
    valid_until: expectation.action_valid_until, claim_valid_until: expectation.valid_until, expiry_enforced_on_chain: false, snapshot: candidate.observed }
})
beforeEach(() => {
  vi.clearAllMocks(); mocks.environment = 'TESTNET'; mocks.nonce.mockResolvedValue('7'); mocks.build.mockResolvedValue(intent)
  mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_recipient_preparation' ? preparation() : null)
})
describe('recipient authenticated server adapter - mocked source proof only', () => {
  it('does not call any database or worker in MAIN', async () => {
    mocks.environment = 'MAINNET'; const db = client()
    await expect(readFundRecipient(db, actor, caseId, context)).rejects.toMatchObject({ code: 'RECIPIENT_NOT_ADMITTED' })
    await expect(prepareFundRecipient(db, actor, request)).rejects.toMatchObject({ code: 'RECIPIENT_NOT_ADMITTED' })
    expect(db.rpc).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled()
  })
  it('binds saved projections to actual actor, context and original case', async () => {
    await expect(readFundRecipient(client({ ...current(), actor_id: testId(999) }), actor, caseId, context)).rejects.toMatchObject({ code: 'RECIPIENT_BINDING_UNVERIFIED' })
    await expect(readFundRecipient(client(), actor, testId(999), context)).rejects.toMatchObject({ code: 'RECIPIENT_BINDING_UNVERIFIED' })
  })
  it('preserves authorisation errors before chain or worker calls', async () => {
    await expect(prepareFundRecipient(client(null, { code: '42501' }), actor, request)).rejects.toMatchObject({ status: 403 })
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.nonce).not.toHaveBeenCalled()
  })
  it('rejects a worker actor mismatch before preparation', async () => {
    mocks.worker.mockResolvedValue({ ...preparation(), actor_id: testId(999) })
    await expect(prepareFundRecipient(client(), actor, request)).rejects.toMatchObject({ code: 'RECIPIENT_BINDING_UNVERIFIED' })
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.nonce).not.toHaveBeenCalled()
  })
  it('prepares only a DB expectation plus independently read nonce, then authenticated reread', async () => {
    const db = client(); await prepareFundRecipient(db, actor, request)
    expect(mocks.build).toHaveBeenCalledWith({ ...expectation, sender_nonce: '7', safe_nonce: null })
    expect(mocks.worker).toHaveBeenCalledWith('prepare_fund_recipient_operation', [preparation(), intent])
    expect(db.rpc).toHaveBeenLastCalledWith('bx1_portal_fund_recipient_read', { case_id: caseId, operating_context: context })
    expect(mocks.observe).not.toHaveBeenCalled()
  })
  it('resumes an existing immutable prepared instruction without creating another', async () => {
    mocks.worker.mockResolvedValue({ ...preparation(), saved_intent: intent })
    await prepareFundRecipient(client(), actor, request)
    expect(mocks.nonce).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled()
  })
  it('keeps unknown receipt evidence unknown, not a completed registration', async () => {
    const original = { operation_id: operationId, expected_revision: 1, actor_id: actor, operating_context: context,
      case_id: caseId, expectation: { ...expectation, sender_nonce: '7' }, intent, transaction_hash: `0x${'d'.repeat(64)}`, state: 'UNKNOWN' }
    mocks.worker.mockImplementation(async (name: string) => name === 'read_fund_recipient_observation' ? original : null)
    mocks.observe.mockResolvedValue({ status: 'UNKNOWN', reason_code: 'RECIPIENT_TRANSACTION_UNKNOWN' })
    await verifyFundRecipient(client(), actor, request)
    expect(mocks.worker).toHaveBeenCalledWith('record_fund_recipient_observation', [original, { status: 'UNKNOWN', reason_code: 'RECIPIENT_TRANSACTION_UNKNOWN' }])
  })
  it('finds only the saved binding and denies substituted case binding', async () => {
    await expect(findFundRecipient(client({ delivery_binding_id: bindingId, case_id: null, snapshot: null }), actor, bindingId, context)).resolves.toEqual({ delivery_binding_id: bindingId, case_id: null, snapshot: null })
    await expect(findFundRecipient(client({ delivery_binding_id: testId(999), case_id: null, snapshot: null }), actor, bindingId, context)).rejects.toMatchObject({ code: 'RECIPIENT_BINDING_UNVERIFIED' })
  })
  it('signing preview derives the exact personal_sign digest without creating a signature or operation', async () => {
    const e = { ...expectation, phase: 'ADD_CLAIM', identity_address: testAddress(712) }
    const result = await readFundRecipientClaimSigningRequest(client({ case_id: caseId, expected_revision: 1, actor_id: actor,
      operating_context: context, expectation: e }), actor, caseId, context)
    expect(result.signing_request).toMatchObject({ method: 'personal_sign', signer_address: expectation.claim_signer_address,
      identity_address: testAddress(712), expiry_enforced_on_chain: false })
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled()
  })
  it('generic case commands contain no browser manifests, topics or approval facts', async () => {
    const db = client(); await commandFundRecipient(db, actor, { command: 'CREATE_CASE', request_key: testId(999),
      payload: { delivery_binding_id: bindingId }, operating_context: context })
    expect(db.rpc).toHaveBeenCalledWith('bx1_portal_fund_recipient_command', { command: 'CREATE_CASE', request_key: testId(999),
      payload: { delivery_binding_id: bindingId }, operating_context: context })
  })
})
