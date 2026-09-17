// Safe shared values only. No server credentials or signing material belongs here.
export const WALLET_CHAIN_ID = 80002 as const
export const WALLET_ORIGIN = 'https://bx1.co.za' as const
export const WALLET_CHAIN_NAME = 'Polygon Amoy testnet' as const

export type WalletActor = {
  userId: string
  platformUserId: string
  sessionId: string
  organisationId: string
}

export type WalletChallenge = {
  challengeId: string
  address: string
  chainId: typeof WALLET_CHAIN_ID
  domain: string
  message: string
  issuedAt: string
  expiresAt: string
}

export type LinkedWallet = {
  id: string
  organisationId: string
  address: string
  chainId: typeof WALLET_CHAIN_ID
  verifiedAt: string
  status: 'PENDING'
}

export type WalletErrorCode =
  | 'invalid_request' | 'unauthorised' | 'unavailable' | 'expired'
  | 'conflict' | 'invalid_signature' | 'rate_limited'

export type WalletChallengeResponse = { ok: true; challenge: WalletChallenge } | { ok: false; error: WalletErrorCode }
export type WalletVerifyResponse = { ok: true; wallet: LinkedWallet } | { ok: false; error: WalletErrorCode }

export interface WalletDatabase {
  issueChallenge(actor: WalletActor, address: string, chainId: typeof WALLET_CHAIN_ID, nonce: string): Promise<WalletChallenge>
  readChallenge(actor: WalletActor, challengeId: string): Promise<WalletChallenge>
  consumeChallenge(actor: WalletActor, challengeId: string, message: string, signature: string): Promise<LinkedWallet>
}
