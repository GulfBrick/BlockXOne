import { describe, expect, it } from 'vitest'
import { fundSetupRetryRequestSchema, setupRetryErrorMetadata } from './fund-setup-recovery-contracts'
const id = '00000000-0000-4000-8000-000000000001'
const scope = { product_id: id, setup_id: id, step_id: id, expected_revision: 1, expected_step_revision: 1,
  operating_context: { mode: 'ROLE', organisationId: id, role: 'TokenisationAgent' } }
describe('strict TEST setup recovery transport', () => {
  it('rejects client supplied authority, proof, nonce and arbitrary actions', () => {
    expect(fundSetupRetryRequestSchema.safeParse({ ...scope, action: 'CHECK' }).success).toBe(true)
    for (const extra of [{ proof: {} }, { nonce: '13' }, { intent: {} }, { actor_id: id }, { environment: 'TESTNET' }]) {
      expect(fundSetupRetryRequestSchema.safeParse({ ...scope, action: 'CHECK', ...extra }).success).toBe(false)
    }
    expect(fundSetupRetryRequestSchema.safeParse({ ...scope, action: 'RESET' }).success).toBe(false)
    expect(fundSetupRetryRequestSchema.safeParse({ ...scope, action: 'HASH', request_key: id, transaction_hash: `0x${'a'.repeat(64)}` }).success).toBe(false)
  })
  it('retains only a single explicit bounded hash, not a hash mentioned in a message', () => {
    const hash = `0x${'a'.repeat(64)}`
    expect(setupRetryErrorMetadata({ code: 4001, data: { originalError: { transactionHash: hash } } })).toEqual({ hash, outcome: 'UNKNOWN' })
    expect(setupRetryErrorMetadata({ message: hash })).toEqual({ hash: null, outcome: 'UNKNOWN' })
    expect(setupRetryErrorMetadata({ hash, error: { hash: `0x${'b'.repeat(64)}` } })).toEqual({ hash: null, outcome: 'UNKNOWN' })
  })
  it.each([[4001, 'REJECTED'], [-32002, 'PENDING_PROMPT'], [429, 'UNKNOWN'], [-32603, 'UNKNOWN']] as const)('classifies %i without claiming non-broadcast', (code, outcome) => {
    expect(setupRetryErrorMetadata({ data: { originalError: { code } } })).toEqual({ hash: null, outcome })
  })
  it('bounds cycles and wrapper depth', () => {
    const cycle: Record<string, unknown> = {}; cycle.error = cycle
    expect(setupRetryErrorMetadata(cycle)).toEqual({ hash: null, outcome: 'UNKNOWN' })
  })
  it('keeps throwing accessors and proxies unknown without exposing their errors', () => {
    const getter = Object.defineProperty({}, 'code', { get() { throw new Error('private provider data') } })
    const proxy = new Proxy({}, { get() { throw new Error('private provider data') } })
    const revoked = Proxy.revocable({}, {}); revoked.revoke()
    expect(setupRetryErrorMetadata(getter)).toEqual({ hash: null, outcome: 'UNKNOWN' })
    expect(setupRetryErrorMetadata(proxy)).toEqual({ hash: null, outcome: 'UNKNOWN' })
    expect(setupRetryErrorMetadata(revoked.proxy)).toEqual({ hash: null, outcome: 'UNKNOWN' })
  })
})
