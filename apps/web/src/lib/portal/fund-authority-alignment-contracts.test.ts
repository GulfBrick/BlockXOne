import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fundAdmissionInputSchema } from './fund-chain-admission'
import { canonicalAdmissionFixture, testAddress, testHash, testId } from './fund-chain-test-fixtures'
import {
  createFundAuthorityAlignmentReadSchema,
  fundAuthorityAlignmentIntentSchema,
  fundAuthorityAlignmentObservationSchema,
  fundAuthorityAlignmentRequestSchema,
  fundAuthorityAlignmentResponseSchema,
  fundAuthoritySnapshotSchema,
} from './fund-authority-alignment-contracts'

const actor = testId(1), setupId = testId(5), requestId = testId(40), operationId = testId(41), claimKey = testId(42)
const context = { mode: 'ROLE' as const, organisationId: testId(2), role: 'TokenisationAgent' as const }
const digest = 'ab'.repeat(32), otherDigest = 'cd'.repeat(32), reasonHash = testHash(50), txHash = testHash(51)
const future = '2100-01-01T00:00:00Z', observed = '2026-10-19T00:00:00Z'
const owners = [testAddress(1), testAddress(9)].sort()
const snapshot = {
  block: { number: '100', hash: testHash(100), timestamp: observed },
  providers: [
    { url: 'https://80002.rpc.thirdweb.com' as const, finalized_block_number: '101', finalized_block_hash: testHash(101) },
    { url: 'https://polygon-amoy.g.alchemy.com/v2' as const, finalized_block_number: '102', finalized_block_hash: testHash(102) },
  ],
}
const safeTransaction = {
  to: testAddress(70), value: '0' as const, data: '0x1234', operation: 0 as const,
  safeTxGas: '0' as const, baseGas: '0' as const, gasPrice: '0' as const,
  gasToken: testAddress(0), refundReceiver: testAddress(0), nonce: '8',
}
const intent = {
  version: 1 as const, chain_id: 80002 as const, admission_request_id: requestId,
  native_binding_hash: digest, reason_hash: reasonHash, previous_epoch: 1, target_epoch: 2,
  controller_address: safeTransaction.to, controller_runtime_hash: testHash(52), factory_address: testAddress(71),
  safe_address: testAddress(72), safe_owners: owners, safe_threshold: 2,
  executor_address: owners[0], executor_nonce: '12', safe_transaction: safeTransaction,
  safe_transaction_hash: testHash(53), snapshot, valid_until: future,
}
function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: operationId, revision: 3, state: 'UNKNOWN' as const, intent, intent_hash: otherDigest,
    executor_nonce: '12', transaction_hash: null, claimed_at: observed, claim_key: claimKey,
    signing_addresses: owners, ...overrides,
  }
}
function response(operationValue: ReturnType<typeof operation> | null, execution: unknown = null) {
  return {
    actor_id: actor, operating_context: context, setup_id: setupId, setup_revision: 100,
    admission_request_id: requestId, native_binding_hash: digest, reason_hash: reasonHash,
    previous_epoch: 1, target_epoch: 2, already_aligned: false, operation: operationValue, execution,
  }
}
const execution = { chain_id: 80002 as const, from: owners[0], to: intent.safe_address, value: '0' as const, data: '0x5678', nonce: '12' }

describe('fund authority alignment public contracts', () => {
  it('preserves historical pair orders but accepts only the exact ordered new pair', () => {
    const d = 'https://polygon-amoy.drpc.org', p = 'https://polygon-amoy-bor-rpc.publicnode.com', t = 'https://polygon-amoy.gateway.tenderly.co'
    const w = 'https://80002.rpc.thirdweb.com', a = 'https://polygon-amoy.g.alchemy.com/v2'
    const pairs = [[d, p], [d, t], [w, t]]
    for (const pair of pairs) for (const urls of [pair, [...pair].reverse()]) {
      const saved = { ...snapshot, providers: urls.map((url, index) => ({ ...snapshot.providers[index], url })) }
      expect(fundAuthoritySnapshotSchema.parse(saved)).toEqual(saved)
    }
    expect(fundAuthoritySnapshotSchema.parse(snapshot)).toEqual(snapshot)
    for (const urls of [[a, w], [w, p], [w, d], [a, d], [a, p], [a, t], [w, w], [a, a], [w, `${a}/private`], [w, `${a}?key=private`]]) {
      expect(fundAuthoritySnapshotSchema.safeParse({ ...snapshot, providers: urls.map((url, index) => ({ ...snapshot.providers[index], url })) }).success).toBe(false)
    }
  })
  it('accepts only the six exact closed actions and rejects aliases or browser evidence', () => {
    const scope = { setup_id: setupId, setup_revision: 100, operating_context: context }
    expect(fundAuthorityAlignmentRequestSchema.parse({ ...scope, action: 'READ' })).toEqual({ ...scope, action: 'READ' })
    expect(fundAuthorityAlignmentRequestSchema.parse({ ...scope, action: 'PREPARE', request_key: claimKey }).action).toBe('PREPARE')
    for (const value of [
      { ...scope, action: 'read' },
      { ...scope, action: 'RETRY', request_key: claimKey },
      { ...scope, action: 'READ', receipt_id: claimKey },
      { ...scope, action: 'VERIFY', request_key: claimKey, operation_id: operationId, expected_revision: 3, observation: { final: true } },
    ]) expect(fundAuthorityAlignmentRequestSchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
  })

  it('requires deterministic distinct ascending Safe owners and the exact next authority epoch', () => {
    expect(fundAuthorityAlignmentIntentSchema.parse(intent).safe_owners).toEqual(owners)
    expect(fundAuthorityAlignmentIntentSchema.safeParse({ ...intent, safe_owners: [...owners].reverse() }).success).toBe(false)
    expect(fundAuthorityAlignmentIntentSchema.safeParse({ ...intent, safe_owners: [owners[0], owners[0]] }).success).toBe(false)
    expect(fundAuthorityAlignmentIntentSchema.safeParse({ ...intent, target_epoch: 3 }).success).toBe(false)
    expect(fundAuthorityAlignmentIntentSchema.safeParse({ ...intent, executor_address: testAddress(99) }).success).toBe(false)
  })

  it('exposes execution only for the exact claimed UNKNOWN operation with distinct current-owner quorum', () => {
    expect(fundAuthorityAlignmentResponseSchema.parse(response(operation(), execution)).execution).toEqual(execution)
    for (const op of [
      operation({ state: 'SIGNING' }),
      operation({ claimed_at: null }),
      operation({ claim_key: null }),
      operation({ signing_addresses: [owners[0], owners[0]] }),
      operation({ signing_addresses: [owners[0], testAddress(99)] }),
    ]) expect(fundAuthorityAlignmentResponseSchema.safeParse(response(op, execution)).success).toBe(false)
    expect(fundAuthorityAlignmentResponseSchema.safeParse(response(operation(), { ...execution, nonce: '13' })).success).toBe(false)
    expect(fundAuthorityAlignmentResponseSchema.safeParse(response({ ...operation(), signatures: [] } as never, execution)).success).toBe(false)
  })

  it('requires complete matching two-observer finality and rejects diagnostic or provider-shaped extras', () => {
    const final = {
      schema_version: 1 as const, chain_id: 80002 as const, status: 'FINAL' as const,
      admission_request_id: requestId, native_binding_hash: digest, safe_transaction_hash: intent.safe_transaction_hash,
      reason_hash: reasonHash, transaction_hash: txHash, executor_address: owners[0], executor_nonce: '12',
      safe_address: intent.safe_address, safe_nonce: '8', controller_address: intent.controller_address,
      previous_epoch: 1, target_epoch: 2, block_number: '99', block_hash: testHash(99), confirmations: '2',
      required_confirmations: 2, snapshot, receipt_hashes: [digest, digest], reason_code: null,
      inner_execution_success: true, epoch_verified: true, observed_epoch: 2,
      epoch_event: { previous_epoch: 1, target_epoch: 2, reason_hash: reasonHash },
    }
    expect(fundAuthorityAlignmentObservationSchema.parse(final).status).toBe('FINAL')
    expect(fundAuthorityAlignmentObservationSchema.safeParse({ ...final, receipt_hashes: [digest, otherDigest] }).success).toBe(false)
    expect(fundAuthorityAlignmentObservationSchema.safeParse({ ...final, inner_execution_success: false }).success).toBe(false)
    expect(fundAuthorityAlignmentObservationSchema.safeParse({ ...final, provider_message: 'private upstream detail' }).success).toBe(false)
  })

  it('binds the real canonical admission input and keeps MAIN or an extra browser claim outside the read DTO', () => {
    const input = canonicalAdmissionFixture().input
    input.authority_epoch = 2
    input.setup.roleplay_policy = { policy_id: testId(45), epoch: 2, expires_at: future,
      label: 'TEST ROLE PLAY - one operator; not independent human approval' }
    const schema = createFundAuthorityAlignmentReadSchema(fundAdmissionInputSchema)
    const read = {
      schema_version: 1 as const, environment: 'TESTNET' as const, actor_id: actor, operating_context: context,
      admission_request_id: requestId, setup_id: setupId, setup_revision: 100, input_hash: digest,
      native_binding_hash: digest, reason_hash: reasonHash, authority_expires_at: future,
      authorisation_receipt_id: claimKey, input, operation: null,
    }
    expect(schema.parse(read).input.manifest_id).toBe(input.manifest_id)
    expect(schema.safeParse({ ...read, environment: 'MAINNET' }).success).toBe(false)
    expect(schema.safeParse({ ...read, jwt: 'browser-supplied' }).success).toBe(false)
  })
})
