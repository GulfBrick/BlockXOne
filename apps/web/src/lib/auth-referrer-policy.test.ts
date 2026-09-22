import { describe, expect, it } from 'vitest'
import { authDocumentReferrerPolicy } from './auth-referrer-policy'
import { AUTH_ERROR_COPY } from './supabase/contracts'

describe('Auth document referrer policy', () => {
  it('permits only a clean recovery document or exact case selector', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(authDocumentReferrerPolicy('/workspace/recovery', {})).toBe('strict-origin')
    expect(authDocumentReferrerPolicy('/workspace/recovery', { case: id })).toBe('strict-origin')
    for (const query of [{ case: [id] }, { token: 'private' }, { case: id, role: 'SuperAdmin' }, { case: '' }]) expect(authDocumentReferrerPolicy('/workspace/recovery', query)).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/workspace/recovery', new URLSearchParams(`case=${id}&case=${id}`))).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/auth/recovery-command', {})).toBe('no-referrer')
  })
  it('permits only clean canonical administration selectors for native signout', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    for (const query of [{}, { organisation: id }, { proposal: id }, { organisation: id, proposal: id }]) {
      expect(authDocumentReferrerPolicy('/workspace/administration', query)).toBe('strict-origin')
      expect(authDocumentReferrerPolicy('/workspace/administration', new URLSearchParams(query as Record<string, string>))).toBe('strict-origin')
    }
    for (const query of [{ organisation: [id, id] }, { proposal: [id] }, { token: 'private' }, { organisation: id, role: 'SuperAdmin' }, { organisation: '' }, { proposal: 'invalid' }]) expect(authDocumentReferrerPolicy('/workspace/administration', query)).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/workspace/administration', new URLSearchParams(`organisation=${id}&organisation=${id}`))).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/auth/admin-command', {})).toBe('no-referrer')
  })
  it.each(['/login/mfa', '/workspace/security'])('supports clean MFA native signout document %s', path => {
    expect(authDocumentReferrerPolicy(path, {})).toBe('strict-origin')
    for (const key of ['token', 'code', 'next', 'error']) expect(authDocumentReferrerPolicy(path, { [key]: 'private' })).toBe('no-referrer')
  })
  it('only permits the fixed MFA setup continuation once', () => {
    expect(authDocumentReferrerPolicy('/login/mfa', { continue: 'setup' })).toBe('strict-origin')
    expect(authDocumentReferrerPolicy('/login/mfa', new URLSearchParams('continue=setup'))).toBe('strict-origin')
    expect(authDocumentReferrerPolicy('/login/mfa', new URLSearchParams('continue=setup&continue=setup'))).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/login/mfa', { continue: ['setup', 'setup'] })).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/login/mfa', { continue: 'https://evil.test' })).toBe('no-referrer')
    expect(authDocumentReferrerPolicy('/workspace/security', { continue: 'setup' })).toBe('no-referrer')
  })
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
