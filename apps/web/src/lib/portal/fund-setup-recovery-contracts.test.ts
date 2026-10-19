import { describe, expect, it } from 'vitest'
import { fundSetupRecoveryProofSchema, fundSetupRetryRequestSchema, setupRetryErrorMetadata } from './fund-setup-recovery-contracts'
const id = '00000000-0000-4000-8000-000000000001'
const scope = { product_id: id, setup_id: id, step_id: id, expected_revision: 1, expected_step_revision: 1,
  operating_context: { mode: 'ROLE', organisationId: id, role: 'TokenisationAgent' } }
describe('strict TEST setup recovery transport', () => {
  it('retains historical proof views and only the explicit new observer composition', () => {
    const d = 'https://polygon-amoy.drpc.org', p = 'https://polygon-amoy-bor-rpc.publicnode.com', t = 'https://polygon-amoy.gateway.tenderly.co'
    const w = 'https://80002.rpc.thirdweb.com', a = 'https://polygon-amoy.g.alchemy.com/v2', hash = `0x${'a'.repeat(64)}`
    const proof = { version: 1, chain_id: 80002, checked_at: '2026-10-19T00:00:00Z', status: 'WAITING', reason_code: 'PENDING',
      sender: `0x${'1'.repeat(40)}`, nonce: '12', intent_hash: 'a'.repeat(64), anchor: { block_number: '100', block_hash: hash },
      finalized_nonce: null, transaction_hash: null, retry_checks: null, winner: null }
    const withUrls = (urls: string[]) => ({ ...proof, providers: urls.map(url => ({ url, finalized_block_number: '100', finalized_block_hash: hash, latest_nonce: '12', pending_nonce: '12' })) })
    for (const pair of [[d, p], [d, t], [w, t], [w, a]]) for (const urls of [pair, [...pair].reverse()]) {
      const original = withUrls(urls)
      expect(fundSetupRecoveryProofSchema.parse(original)).toEqual(original)
    }
    for (const urls of [[w, p], [w, d], [a, d], [a, p], [a, t], [w, w], [a, a], [w, `${a}/private`], [w, `${a}?key=private`]]) {
      expect(fundSetupRecoveryProofSchema.safeParse(withUrls(urls)).success).toBe(false)
    }
  })
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
