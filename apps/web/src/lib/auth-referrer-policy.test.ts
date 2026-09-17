import { describe, expect, it } from 'vitest'
import { authDocumentReferrerPolicy } from './auth-referrer-policy'
import { AUTH_ERROR_COPY } from './supabase/contracts'

describe('Auth document referrer policy', () => {
  // Native navigation POST + no-referrer yields Origin:null in Fetch. Only
  // clean form documents opt into strict-origin; origin admission stays strict.
  it.each(['/login', '/workspace', '/auth/confirm'])('retains the origin for clean %s form submission', (path) => {
    expect(authDocumentReferrerPolicy(path, new URLSearchParams())).toBe('strict-origin')
  })
  it.each([{ setup: '1' }, { error: 'invalid_credentials' }, { setup: '1', error: 'invalid_request' }])('allows fixed login presentation state %j', (query) => {
    expect(authDocumentReferrerPolicy('/login', query)).toBe('strict-origin')
  })
  it.each(Object.keys(AUTH_ERROR_COPY))('keeps setup retry %s submit-capable without exposing query strings', (error) => {
    expect(authDocumentReferrerPolicy('/login', { setup: '1', error })).toBe('strict-origin')
    expect(authDocumentReferrerPolicy('/login', new URLSearchParams({ setup: '1', error }))).toBe('strict-origin')
  })
  it.each(['/login', '/workspace', '/auth/confirm'])('does not expose referrers from token-bearing %s', (path) => {
    for (const key of ['token_hash', 'token', 'access_token', 'refresh_token', 'code']) {
      expect(authDocumentReferrerPolicy(path, new URLSearchParams({ [key]: 'synthetic-sensitive-value' }))).toBe('no-referrer')
    }
  })
  it.each([
    ['/login', { setup: 'other' }], ['/login', { error: 'raw-provider-detail' }],
    ['/login', { next: '//foreign.example' }], ['/login', { setup: ['1', '1'] }],
    ['/workspace', { error: 'unavailable' }], ['/auth/confirm', { type: 'invite' }],
    ['/workspace/access-denied', {}], ['/auth/login', {}], ['/auth/logout', {}],
  ] as const)('defaults to no-referrer for %s with untrusted/non-form state', (path, query) => {
    expect(authDocumentReferrerPolicy(path, query as Record<string, string | string[]>)).toBe('no-referrer')
  })
})
