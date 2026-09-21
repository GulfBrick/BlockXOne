import { getAddress, hashMessage, verifyMessage, ZeroAddress } from 'ethers'

export const FUNDING_TEST_PROJECT = 'fegnnnlseuejkrusbbkv' as const
export const FUNDING_CHAIN_ID = 80002 as const
export type FundingClaim = {
  actor_id: string; investment_account_id: string; obligation_id: string;
  route_id: string; route_revision: number; token_address: string;
  token_runtime_hash: string; token_decimals: number; receiving_address: string;
  payer_address: string; transaction_hash: string; log_index: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const hash = /^0x[0-9a-f]{64}$/
const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

function address(value: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(value) || value === ZeroAddress) throw new Error('Invalid funding claim address.')
  return getAddress(value).toLowerCase()
}

/** Sign only saved account/obligation/route facts plus this exact payer and transfer. */
export function buildFundingClaimMessage(claim: FundingClaim): string {
  if (!claim || [claim.actor_id, claim.investment_account_id, claim.obligation_id, claim.route_id].some(value => !uuid.test(value) || value === '00000000-0000-0000-0000-000000000000')
    || !Number.isSafeInteger(claim.route_revision) || claim.route_revision < 1
    || !Number.isInteger(claim.token_decimals) || claim.token_decimals < 2 || claim.token_decimals > 18
    || !Number.isSafeInteger(claim.log_index) || claim.log_index < 0 || claim.log_index > 2_147_483_647
    || !hash.test(claim.token_runtime_hash) || !hash.test(claim.transaction_hash)
    || claim.token_runtime_hash === `0x${'0'.repeat(64)}` || claim.transaction_hash === `0x${'0'.repeat(64)}`) throw new Error('Invalid funding claim fields.')
  return [
    'BlockXOne TESTNET funding claim v1',
    'Ownership of this payer key only. This is not a transfer, token approval, KYC approval or issuer authority.',
    `Project: ${FUNDING_TEST_PROJECT}`,
    'Environment: TESTNET',
    `Chain ID: ${FUNDING_CHAIN_ID}`,
    `Actor: ${claim.actor_id}`,
    `Investment account: ${claim.investment_account_id}`,
    `Obligation: ${claim.obligation_id}`,
    `Funding route: ${claim.route_id}`,
    `Route revision: ${claim.route_revision}`,
    `Token: ${address(claim.token_address)}`,
    `Token runtime hash: ${claim.token_runtime_hash}`,
    `Token decimals: ${claim.token_decimals}`,
    `Receiving address: ${address(claim.receiving_address)}`,
    `Payer address: ${address(claim.payer_address)}`,
    `Transaction hash: ${claim.transaction_hash}`,
    `Log index: ${claim.log_index}`,
    'Fictional conversion: one token unit per ZAR_TEST unit. No real ZAR value is asserted.',
  ].join('\n')
}

export function fundingClaimHash(claim: FundingClaim): string { return hashMessage(buildFundingClaimMessage(claim)) }

/** EOA personal_sign only. Contract-wallet/EIP-1271 authority is not inferred. */
export function verifyFundingClaim(claim: FundingClaim, signature: string): boolean {
  try {
    if (!/^0x[0-9a-fA-F]{128}(1b|1c)$/i.test(signature)) return false
    const r = BigInt(`0x${signature.slice(2, 66)}`)
    const s = BigInt(`0x${signature.slice(66, 130)}`)
    if (r === 0n || r >= curveOrder || s === 0n || s > curveOrder / 2n) return false
    return verifyMessage(buildFundingClaimMessage(claim), signature).toLowerCase() === claim.payer_address
  } catch { return false }
}
