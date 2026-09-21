import { Wallet } from 'ethers'
import { describe, expect, it } from 'vitest'
import { buildFundingClaimMessage, fundingClaimHash, verifyFundingClaim, type FundingClaim } from './funding-claim'

// Public deterministic test key only; never a deployed signer or funded wallet.
const signer = new Wallet(`0x${'11'.repeat(32)}`)
const other = new Wallet(`0x${'22'.repeat(32)}`)
const claim: FundingClaim = {
  actor_id: '11111111-1111-4111-8111-111111111111', investment_account_id: '22222222-2222-4222-8222-222222222222',
  obligation_id: '33333333-3333-4333-8333-333333333333', route_id: '44444444-4444-4444-8444-444444444444', route_revision: 1,
  token_address: '0x1111111111111111111111111111111111111111', token_runtime_hash: `0x${'ab'.repeat(32)}`, token_decimals: 6,
  receiving_address: '0x2222222222222222222222222222222222222222', payer_address: signer.address.toLowerCase(),
  transaction_hash: `0x${'cd'.repeat(32)}`, log_index: 3,
}

describe('funding claim signature and exact intent', () => {
  it('verifies a genuine personal_sign proof and binds the explicit TEST project/network', async () => {
    const message = buildFundingClaimMessage(claim)
    expect(message).toContain('Project: fegnnnlseuejkrusbbkv\nEnvironment: TESTNET\nChain ID: 80002')
    expect(message).toContain('not a transfer, token approval, KYC approval or issuer authority')
    expect(verifyFundingClaim(claim, await signer.signMessage(message))).toBe(true)
    expect(fundingClaimHash(claim)).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it.each(['actor_id', 'investment_account_id', 'obligation_id', 'route_id'] as const)('rejects reuse for another %s', async field => {
    const signature = await signer.signMessage(buildFundingClaimMessage(claim))
    expect(verifyFundingClaim({ ...claim, [field]: '55555555-5555-4555-8555-555555555555' }, signature)).toBe(false)
  })
  it.each([
    { route_revision: 2 }, { token_address: '0x3333333333333333333333333333333333333333' },
    { token_runtime_hash: `0x${'ef'.repeat(32)}` }, { token_decimals: 18 },
    { receiving_address: '0x3333333333333333333333333333333333333333' },
    { payer_address: other.address.toLowerCase() }, { transaction_hash: `0x${'ef'.repeat(32)}` }, { log_index: 4 },
  ])('rejects a changed route or transfer field %#', async patch => {
    expect(verifyFundingClaim({ ...claim, ...patch }, await signer.signMessage(buildFundingClaimMessage(claim)))).toBe(false)
  })
  it('rejects another signer and an otherwise valid signature over a MAINNET message', async () => {
    expect(verifyFundingClaim(claim, await other.signMessage(buildFundingClaimMessage(claim)))).toBe(false)
    expect(verifyFundingClaim(claim, await signer.signMessage(buildFundingClaimMessage(claim).replaceAll('TESTNET', 'MAINNET')))).toBe(false)
  })
  it('rejects high-s, compact, zero and noncanonical recovery signatures', async () => {
    const signature = await signer.signMessage(buildFundingClaimMessage(claim))
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    const high = (order - BigInt(`0x${signature.slice(66, 130)}`)).toString(16).padStart(64, '0')
    const flipped = `${signature.slice(0, 66)}${high}${signature.endsWith('1b') ? '1c' : '1b'}`
    for (const invalid of [flipped, signature.slice(0, -2), `0x${'00'.repeat(64)}1b`, `${signature.slice(0, -2)}00`]) expect(verifyFundingClaim(claim, invalid)).toBe(false)
  })
  it.each([{ token_decimals: 1 }, { token_decimals: 19 }, { token_decimals: 2.5 }, { route_revision: 0 }, { log_index: -1 }, { log_index: Number.MAX_SAFE_INTEGER }, { actor_id: 'person\nChain ID: 1' }, { receiving_address: `0x${'0'.repeat(40)}` }])('does not create a signable message for invalid fields %#', patch => {
    expect(() => buildFundingClaimMessage({ ...claim, ...patch })).toThrow('Invalid funding claim')
  })
})
