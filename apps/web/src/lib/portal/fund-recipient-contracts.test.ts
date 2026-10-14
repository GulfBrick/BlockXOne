import { describe, expect, it } from 'vitest'
import { fundRecipientCommandRequestSchema, fundRecipientFindRequestSchema, fundRecipientPrepareRequestSchema,
  fundRecipientSubmitClaimRequestSchema, fundRecipientRecordSignatureRequestSchema } from './fund-recipient-contracts'

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
const address = `0x${'a'.repeat(40)}`, context = { mode: 'APPLICANT' }
describe('canonical recipient public inputs - source boundary only', () => {
  it('accepts only a saved bound wallet case creation, not eligibility or receipt claims', () => {
    const request = { command: 'CREATE_CASE', request_key: id(1), payload: { delivery_binding_id: id(2) }, operating_context: context }
    expect(fundRecipientCommandRequestSchema.safeParse(request).success).toBe(true)
    for (const key of ['manifest', 'eligibility', 'approved', 'identity_address', 'country_code']) {
      expect(fundRecipientCommandRequestSchema.safeParse({ ...request, payload: { ...request.payload, [key]: 'invented' } }).success).toBe(false)
    }
  })
  it('requires an original saved phase, revision and connected human wallet', () => {
    const request = { command: 'REQUEST_OPERATION', request_key: id(1), payload: { case_id: id(2), expected_revision: 1,
      phase: 'CREATE_IDENTITY', sender_address: address }, operating_context: context }
    expect(fundRecipientCommandRequestSchema.safeParse(request).success).toBe(true)
    expect(fundRecipientCommandRequestSchema.safeParse({ ...request, payload: { ...request.payload, phase: 'MINT' } }).success).toBe(false)
    expect(fundRecipientCommandRequestSchema.safeParse({ ...request, payload: { ...request.payload, expected_revision: 0 } }).success).toBe(false)
  })
  it('rejects browser-controlled calldata, nonce, hashes and manifests at preparation', () => {
    const request = { operation_id: id(2), expected_revision: 1, operating_context: context }
    expect(fundRecipientPrepareRequestSchema.safeParse(request).success).toBe(true)
    for (const key of ['transaction_data', 'sender_nonce', 'safe_nonce', 'manifest', 'expectation_hash', 'runtime_hash']) {
      expect(fundRecipientPrepareRequestSchema.safeParse({ ...request, [key]: 'invented' }).success).toBe(false)
    }
  })
  it('does not expose private raw command names as public generic commands', () => {
    for (const command of ['AUTHORISE', 'CLAIM_EXECUTION', 'SUBMIT_CLAIM_SIGNATURE', 'RECORD_SAFE_SIGNATURE']) {
      expect(fundRecipientCommandRequestSchema.safeParse({ command, request_key: id(1), payload: {}, operating_context: context }).success).toBe(false)
    }
  })
  it('accepts real-length signatures only in the specific claim/signature interfaces', () => {
    const request = { case_id: id(2), expected_revision: 1, request_key: id(1), signature: `0x${'a'.repeat(130)}`, operating_context: context }
    expect(fundRecipientSubmitClaimRequestSchema.safeParse(request).success).toBe(true)
    expect(fundRecipientSubmitClaimRequestSchema.safeParse({ ...request, signature: '0x1234' }).success).toBe(false)
    expect(fundRecipientRecordSignatureRequestSchema.safeParse({ operation_id: id(2), expected_revision: 1,
      request_key: id(1), signing_address: address, signature: request.signature, operating_context: context }).success).toBe(true)
  })
  it('discovers only by a bound wallet record, not address or arbitrary applicant', () => {
    const request = { delivery_binding_id: id(2), operating_context: context }
    expect(fundRecipientFindRequestSchema.safeParse(request).success).toBe(true)
    expect(fundRecipientFindRequestSchema.safeParse({ ...request, address }).success).toBe(false)
    expect(fundRecipientFindRequestSchema.safeParse({ ...request, actor_id: id(1) }).success).toBe(false)
  })
})
