import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const signing = vi.hoisted(() => ({ sign: vi.fn(() => 'synthetic-assertion-not-a-real-token') }))
vi.mock('jsonwebtoken', () => ({ default: { sign: signing.sign } }))
import { readOfferingProviderStatus } from './offering-provider-status'
import { DOCUSIGN_OFFERING_SANDBOX } from './docusign-offering-provider'

// Synthetic provider transport only: no actual credentials, user or authentication receipt.
const fetcher = vi.fn()
const env = { BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_DOCUSIGN_CLIENT_ID: DOCUSIGN_OFFERING_SANDBOX.clientId,
  BLOCKXONE_DOCUSIGN_USER_ID: DOCUSIGN_OFFERING_SANDBOX.userId,
  BLOCKXONE_DOCUSIGN_ACCOUNT_ID: DOCUSIGN_OFFERING_SANDBOX.accountId,
  BLOCKXONE_DOCUSIGN_BASE_URI: DOCUSIGN_OFFERING_SANDBOX.baseUri, BLOCKXONE_DOCUSIGN_MODE: 'sandbox',
  BLOCKXONE_DOCUSIGN_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_NOT_A_KEY\n-----END PRIVATE KEY-----' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const token = () => json({ access_token: 'synthetic-private-access-token', token_type: 'Bearer', expires_in: 3600 })
const userinfo = (): { sub: string; accounts: { account_id: string; base_uri: string }[] } => ({ sub: DOCUSIGN_OFFERING_SANDBOX.userId,
  accounts: [{ account_id: DOCUSIGN_OFFERING_SANDBOX.accountId, base_uri: DOCUSIGN_OFFERING_SANDBOX.baseUri }] })
beforeEach(() => { fetcher.mockReset(); signing.sign.mockReset().mockReturnValue('synthetic-assertion-not-a-real-token'); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.unstubAllGlobals() })

describe('private DocuSign authentication-only readiness adapter', () => {
  it('uses the existing JWT/userinfo checks and returns no credential or provider response', async () => {
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(userinfo()))
    const result = await readOfferingProviderStatus(env)
    expect(result).toEqual({ status: 'AVAILABLE', classifier: 'AUTHENTICATED', checkedAt: expect.any(String) })
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true)
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://account-d.docusign.com/oauth/token', 'POST'],
      ['https://account-d.docusign.com/oauth/userinfo', 'GET'],
    ])
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer synthetic-private-access-token')
    expect(JSON.stringify(result)).not.toMatch(/synthetic-private|SYNTHETIC_NOT_A_KEY|assertion|access_token|account_id|base_uri/)
  })

  it.each(['sender', 'account', 'base-uri'] as const)('fails closed for the wrong sandbox %s', async fault => {
    const value = userinfo()
    if (fault === 'sender') value.sub = '00000000-0000-4000-8000-000000000001'
    if (fault === 'account') value.accounts[0].account_id = '00000000-0000-4000-8000-000000000001'
    if (fault === 'base-uri') value.accounts[0].base_uri = 'https://na4.docusign.net'
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(value))
    expect(await readOfferingProviderStatus(env)).toEqual({ status: 'UNAVAILABLE', classifier: 'ACCOUNT_MISMATCH', checkedAt: expect.any(String) })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['missing-key', 'main'] as const)('never contacts a provider for %s configuration', async fault => {
    const candidate = fault === 'missing-key' ? { ...env, BLOCKXONE_DOCUSIGN_PRIVATE_KEY: undefined }
      : { ...env, BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za', VERCEL_ENV: 'production', SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co' }
    expect(await readOfferingProviderStatus(candidate)).toEqual({ status: 'UNAVAILABLE', classifier: 'NOT_CONFIGURED', checkedAt: expect.any(String) })
    expect(signing.sign).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not leak a private key failure or raw provider rejection body', async () => {
    signing.sign.mockImplementationOnce(() => { throw new Error('SYNTHETIC_PRIVATE_KEY_ERROR') })
    expect(await readOfferingProviderStatus(env)).toMatchObject({ status: 'UNAVAILABLE', classifier: 'AUTHENTICATION_UNAVAILABLE' })
    fetcher.mockResolvedValueOnce(json({ error: 'raw-provider-detail-and-private-identity' }, 400))
    const result = await readOfferingProviderStatus(env)
    expect(result.classifier).toBe('PROVIDER_UNAVAILABLE')
    expect(JSON.stringify(result)).not.toMatch(/raw-provider|PRIVATE_KEY|identity|error/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves throttling and malformed response classifiers without returning provider data', async () => {
    fetcher.mockResolvedValueOnce(json({ private: 'provider-body' }, 429))
    expect(await readOfferingProviderStatus(env)).toMatchObject({ status: 'UNAVAILABLE', classifier: 'THROTTLED' })
    fetcher.mockResolvedValueOnce(new Response('private non-JSON body', { headers: { 'content-type': 'text/plain' } }))
    expect(await readOfferingProviderStatus(env)).toMatchObject({ status: 'UNAVAILABLE', classifier: 'PROVIDER_RESPONSE_INVALID' })
  })
})
