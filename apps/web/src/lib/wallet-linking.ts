import type { WalletChallengeResponse } from './api-client'

const EXPIRED_CHALLENGE_MESSAGE =
  'The wallet challenge expired before it could be completed. Request a new challenge and try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function errorCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.code === 'number' ? error.code : undefined
}

function errorMessage(error: unknown): string {
  if (!isRecord(error)) return ''
  return typeof error.message === 'string' ? error.message.toLowerCase() : ''
}

export function requireUsableWalletChallenge(
  challenge: WalletChallengeResponse,
  nowMs = Date.now()
): WalletChallengeResponse {
  if (
    !challenge ||
    typeof challenge.challenge_id !== 'string' ||
    challenge.challenge_id.trim().length === 0 ||
    typeof challenge.message !== 'string' ||
    challenge.message.length === 0 ||
    typeof challenge.expires_at !== 'string'
  ) {
    throw new Error('The server returned an invalid wallet challenge. No wallet was linked.')
  }

  const expiresAtMs = Date.parse(challenge.expires_at)
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error('The server returned an invalid wallet challenge expiry. No wallet was linked.')
  }
  if (expiresAtMs <= nowMs) {
    throw new Error(EXPIRED_CHALLENGE_MESSAGE)
  }

  return challenge
}

export function walletLinkFailureMessage(error: unknown): string {
  const status = errorStatus(error)
  const message = errorMessage(error)

  if (errorCode(error) === 4001) {
    return 'The signature request was cancelled. No wallet was linked.'
  }
  if (status === 401 || status === 403) {
    return 'Your sign-in session is no longer authorised. Sign in again before linking a wallet.'
  }
  if (status === 410 || message.includes('challenge expired')) {
    return EXPIRED_CHALLENGE_MESSAGE
  }
  if (status === 409 && message.includes('already used')) {
    return 'This wallet challenge has already been used. Request a new challenge and try again.'
  }
  if (status === 409 && message.includes('binding mismatch')) {
    return 'The signed wallet details no longer match the challenge. Reconnect the intended account and chain, then try again.'
  }
  if (status === 404 && message.includes('challenge')) {
    return 'This wallet challenge is no longer available for your session. Request a new challenge and try again.'
  }
  if (status === 400 && message.includes('signature verification failed')) {
    return 'The wallet signature could not be verified. No wallet was linked.'
  }
  if (
    status === 400 &&
    (message.includes('invalid wallet challenge request') || message.includes('domain is not allowed'))
  ) {
    return 'The wallet challenge request was rejected for this address, chain, or application domain. No wallet was linked.'
  }
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message) {
    return error.message
  }

  return 'Wallet linking failed. No wallet was linked.'
}
