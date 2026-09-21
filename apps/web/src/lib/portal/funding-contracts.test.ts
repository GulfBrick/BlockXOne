import { describe, expect, it } from 'vitest'
import { portalCommandSchema } from './contracts'
import { formatFundingUnits, fundingSnapshotSchema, fundingVerificationSchema } from './funding-contracts'

const id = '10000000-0000-4000-8000-000000000001'
const address = `0x${'1'.repeat(40)}`
const hash = `0x${'a'.repeat(64)}`
const route = { product_id: id, expected_revision: 1, token_address: address, token_runtime_hash: hash, token_decimals: 6, receiving_address: `0x${'2'.repeat(40)}`, authority_reference: 'Reviewed fictional beneficiary mandate.', code_review_reference: 'Reviewed immutable standard ERC20 source.', valid_until: '2026-10-21T12:00:00Z', standard_immutable_token_acknowledged: true, synthetic_conversion_acknowledged: true }
const valid = (command: string, payload: unknown) => portalCommandSchema.safeParse({ command, key: id, payload }).success

describe('strict funding command contracts', () => {
  it('accepts explicit reviewed test route parameters without defaults', () => { expect(valid('propose_funding_route', route)).toBe(true) })
  it.each([0, 1, 19, 18.1, -1, '6'])('rejects unsupported token precision %s', token_decimals => { expect(valid('propose_funding_route', { ...route, token_decimals })).toBe(false) })
  it.each(['chain_id', 'environment', 'paid', 'verified', 'actor_id', 'balance'])('does not accept browser-supplied authority %s', field => { expect(valid('propose_funding_route', { ...route, [field]: true })).toBe(false) })
  it.each(['standard_immutable_token_acknowledged', 'synthetic_conversion_acknowledged'])('requires explicit %s', field => { expect(valid('propose_funding_route', { ...route, [field]: false })).toBe(false) })
  it('rejects zero recipient, malformed hashes and absent mandate evidence', () => {
    expect(valid('propose_funding_route', { ...route, receiving_address: `0x${'0'.repeat(40)}` })).toBe(false)
    expect(valid('propose_funding_route', { ...route, token_runtime_hash: '0x00' })).toBe(false)
    expect(valid('propose_funding_route', { ...route, authority_reference: '' })).toBe(false)
  })
  it('obligation accepts identity only, never a client amount', () => {
    expect(valid('open_funding_obligation', { subscription_id: id, route_id: id })).toBe(true)
    expect(valid('open_funding_obligation', { subscription_id: id, route_id: id, amount_minor: '1' })).toBe(false)
  })
  it('receipt reference contains no authoritative amounts or verified flag', () => {
    const payload = { obligation_id: id, expected_revision: 1, expected_route_revision: 2, payer_address: address, transaction_hash: hash, log_index: 0, signature: `0x${'1'.repeat(130)}` }
    expect(valid('submit_funding_reference', payload)).toBe(true)
    expect(valid('submit_funding_reference', { ...payload, amount_base_units: '100' })).toBe(false)
    expect(valid('submit_funding_reference', { ...payload, verified: true })).toBe(false)
    expect(valid('submit_funding_reference', { ...payload, signature: '0x00' })).toBe(false)
    expect(valid('submit_funding_reference', { ...payload, expected_route_revision: undefined })).toBe(false)
  })
  it('reconciliation binds reference and obligation revision plus evidence set', () => {
    const payload = { reference_id: id, expected_revision: 2, expected_obligation_revision: 3, evidence_set_hash: 'a'.repeat(64) }
    expect(valid('reconcile_funding', payload)).toBe(true)
    expect(valid('reconcile_funding', { ...payload, evidence_set_hash: undefined })).toBe(false)
    expect(valid('reconcile_funding', { ...payload, expected_obligation_revision: 0 })).toBe(false)
  })
  it('exception and reversal proposals require reasons, cannot request a refund or allocation restore', () => {
    expect(valid('propose_funding_exception', { reference_id: id, expected_revision: 1, expected_obligation_revision: 1, decision: 'UNAPPLIED', reason: 'Transfer requires independent exception review.' })).toBe(true)
    expect(valid('propose_funding_reversal', { journal_id: id, expected_obligation_revision: 1, reason: 'Approved correction of a test ledger posting.', refund: true })).toBe(false)
  })
  it('server verifier input excludes URLs, signatures and provider results', () => {
    expect(fundingVerificationSchema.safeParse({ kind: 'REFERENCE', id }).success).toBe(true)
    for (const extra of [{ rpc_url: 'https://evil.invalid' }, { observation: {} }, { amount: '1' }, { actor_id: id }, { signature: '0x01' }]) {
      expect(fundingVerificationSchema.safeParse({ kind: 'REFERENCE', id, ...extra }).success).toBe(false)
    }
  })
})

describe('exact token display and saved funding shape', () => {
  it.each([['1', 18, '0.000000000000000001'], ['1000000', 6, '1'], ['1000010', 6, '1.00001'], ['99', 2, '0.99'], ['0', 18, '0']])('formats %s with %s decimals exactly', (value, decimals, result) => { expect(formatFundingUnits(String(value), Number(decimals))).toBe(result) })
  it.each(['1.1', '-1', '01', '1e18', '', '9'.repeat(79)])('rejects noncanonical token amounts %s', value => { expect(formatFundingUnits(value, 6)).toBe('Unavailable') })
  it('supports values larger than Number precision without rounding', () => { expect(formatFundingUnits('9007199254740993000001', 6).replace(/[,\s]/g, '')).toBe('9007199254740993.000001') })
  it('empty is explicit, malformed is never silently empty', () => {
    expect(fundingSnapshotSchema.safeParse({ routes: [], obligations: [], references: [], journals: [], reversals: [] }).success).toBe(true)
    expect(fundingSnapshotSchema.safeParse({}).success).toBe(false)
    expect(fundingSnapshotSchema.safeParse({ routes: [], obligations: [{ state: 'RECONCILED' }], references: [], journals: [], reversals: [] }).success).toBe(false)
  })
})
