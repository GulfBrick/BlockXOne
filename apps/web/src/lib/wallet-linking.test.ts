import { describe, expect, it } from 'vitest'

import {
  requireUsableWalletChallenge,
  walletLinkFailureMessage,
} from './wallet-linking'

const validChallenge = {
  challenge_id: 'challenge-1',
  message: 'Sign this exact server message',
  expires_at: '2026-07-26T00:05:00.000Z',
}

describe('server-issued wallet challenge validation', () => {
  it('accepts a complete, unexpired challenge without changing its message', () => {
    expect(
      requireUsableWalletChallenge(validChallenge, Date.parse('2026-07-26T00:04:59.999Z'))
    ).toBe(validChallenge)
    expect(validChallenge.message).toBe('Sign this exact server message')
  })

  it('stops locally when the challenge expires before signing completes', () => {
    expect(() =>
      requireUsableWalletChallenge(validChallenge, Date.parse('2026-07-26T00:05:00.000Z'))
    ).toThrow(
      'The wallet challenge expired before it could be completed. Request a new challenge and try again.'
    )
  })

  it('refuses malformed challenge payloads instead of signing client-generated fallback text', () => {
    expect(() =>
      requireUsableWalletChallenge({
        challenge_id: '',
        message: '',
        expires_at: 'not-a-date',
      })
    ).toThrow('The server returned an invalid wallet challenge. No wallet was linked.')
  })
})

describe('wallet challenge failure messages', () => {
  it('reports server expiry and reuse as fresh-challenge actions', () => {
    expect(walletLinkFailureMessage({
      code: 'API_ERROR',
      status: 410,
      message: 'wallet challenge expired',
    })).toBe(
      'The wallet challenge expired before it could be completed. Request a new challenge and try again.'
    )

    expect(walletLinkFailureMessage({
      code: 'API_ERROR',
      status: 409,
      message: 'wallet challenge already used',
    })).toBe(
      'This wallet challenge has already been used. Request a new challenge and try again.'
    )
  })

  it('distinguishes binding, ownership, and signature failures', () => {
    expect(walletLinkFailureMessage({
      code: 'API_ERROR',
      status: 409,
      message: 'wallet challenge binding mismatch',
    })).toContain('signed wallet details no longer match')

    expect(walletLinkFailureMessage({
      code: 'API_ERROR',
      status: 404,
      message: 'wallet challenge not found',
    })).toContain('no longer available for your session')

    expect(walletLinkFailureMessage({
      code: 'API_ERROR',
      status: 400,
      message: 'signature verification failed',
    })).toBe('The wallet signature could not be verified. No wallet was linked.')
  })

  it('states clearly when the user cancels the wallet signature', () => {
    expect(walletLinkFailureMessage({
      code: 4001,
      message: 'User rejected the request.',
    })).toBe('The signature request was cancelled. No wallet was linked.')
  })
})
