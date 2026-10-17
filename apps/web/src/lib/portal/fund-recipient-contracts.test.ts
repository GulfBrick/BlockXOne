import { describe, expect, it } from 'vitest'
import { fundRecipientCommandRequestSchema, fundRecipientFindRequestSchema, fundRecipientPrepareRequestSchema,
  fundRecipientSubmitClaimRequestSchema, fundRecipientRecordSignatureRequestSchema, fundRecipientIntentSchema } from './fund-recipient-contracts'

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
const address = `0x${'a'.repeat(40)}`, context = { mode: 'APPLICANT' }
function recipientIntent(first: string, second: string) {
  const hash = `0x${'ab'.repeat(32)}`, timestamp = '2026-10-17T00:00:00Z'
  return { version: 1, chain_id: 80002, operation_id: id(2), operation_revision: 1, phase: 'CREATE_IDENTITY',
    expectation_hash: 'ab'.repeat(32), catalog_hash: 'cd'.repeat(32), sender_address: address, sender_nonce: '1',
    execution_mode: 'EOA_TRANSACTION', to: null, value: '0', transaction_data: '0x6000', expected_identity_address: address,
    claim_data: '0x01', claim_data_hash: hash, claim_id: hash, safe_transaction: null, safe_transaction_hash: null,
    safe_owners: [address, `0x${'b'.repeat(40)}`], safe_threshold: 2, valid_until: timestamp, claim_valid_until: timestamp,
    expiry_enforced_on_chain: false, snapshot: { block: { number: '100', hash, timestamp }, providers: [first, second].map(url => ({
      url, finalized_block_number: '120', finalized_block_hash: hash })) } }
}
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
  it.each([
    ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.drpc.org'],
    ['https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy.drpc.org'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com'],
  ])('retains the exact legacy or archive snapshot in a saved intent: %s / %s', (first, second) => {
    const intent = recipientIntent(first, second), original = JSON.stringify(intent)
    expect(fundRecipientIntentSchema.parse(intent)).toEqual(intent)
    expect(JSON.stringify(intent)).toBe(original)
  })
  it.each([
    ['https://polygon-amoy.drpc.org', 'https://80002.rpc.thirdweb.com'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.drpc.org'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://80002.rpc.thirdweb.com'],
    ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy-bor-rpc.publicnode.com'],
    ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.gateway.tenderly.co'],
    ['https://polygon-amoy.gateway.tenderly.co', 'https://polygon-amoy-bor-rpc.publicnode.com'],
  ])('rejects unapproved cross-pairs in either order: %s / %s', (first, second) => {
    expect(fundRecipientIntentSchema.safeParse(recipientIntent(first, second)).success).toBe(false)
  })
  it.each(['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com',
    'https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com'])('rejects duplicate copies of %s', url => {
    expect(fundRecipientIntentSchema.safeParse(recipientIntent(url, url)).success).toBe(false)
  })
  it.each(['https://name:secret@80002.rpc.thirdweb.com', 'https://80002.rpc.thirdweb.com?apiKey=secret',
    'https://80002.rpc.thirdweb.com/unapproved', 'https://80002.rpc.thirdweb.com.example'])('rejects nonexact new service labels: %s', url => {
    expect(fundRecipientIntentSchema.safeParse(recipientIntent(url, 'https://polygon-amoy.gateway.tenderly.co')).success).toBe(false)
  })
  it.each(['without dRPC', 'duplicate', 'missing', 'extra', 'null', 'foreign', 'credentials', 'query', 'extra field'] as const)('does not accept another observer quorum in a saved recipient intent: %s', changed => {
    const intent = recipientIntent('https://polygon-amoy.drpc.org', 'https://polygon-amoy.gateway.tenderly.co')
    const sources = intent.snapshot.providers
    let providers: unknown = sources
    if (changed === 'without dRPC') providers = [{ ...sources[0], url: 'https://polygon-amoy-bor-rpc.publicnode.com' }, sources[1]]
    else if (changed === 'duplicate') providers = [sources[0], sources[0]]
    else if (changed === 'missing') providers = [sources[0]]
    else if (changed === 'extra') providers = [...sources, { ...sources[0], url: 'https://polygon-amoy-bor-rpc.publicnode.com' }]
    else if (changed === 'null') providers = [null, sources[1]]
    else if (changed === 'extra field') providers = [{ ...sources[0], credential: 'not-evidence' }, sources[1]]
    else providers = [{ ...sources[0], url: changed === 'credentials' ? 'https://name:secret@polygon-amoy.gateway.tenderly.co'
      : changed === 'query' ? 'https://polygon-amoy.gateway.tenderly.co?apiKey=secret' : 'https://unapproved.example' }, sources[1]]
    expect(fundRecipientIntentSchema.safeParse({ ...intent, snapshot: { ...intent.snapshot, providers } }).success).toBe(false)
  })
})
