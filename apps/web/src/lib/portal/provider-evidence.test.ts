import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { issueSumsubSandboxToken, parseSumsubWebhook, providerEvidenceDatabaseConfig,
  sumsubRequestSignature, sumsubSessionConfig, verifySumsubWebhookDigest } from './provider-evidence'

const applicationId = '44444444-4444-4444-8444-444444444444'
const externalUserId = `bx1:testnet:${applicationId}:r2`
const base = { externalUserId, applicantId: 'sandbox-applicant-123', type: 'applicantReviewed',
  createdAtMs: '2026-09-24 11:30:00.123', sandboxMode: true, clientId: 'synthetic-client',
  reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } }
const config = { appToken: 'synthetic-app-token', appSecret: 'synthetic-app-secret-long-enough',
  secret: 'synthetic-webhook-secret-long-enough', clientId: 'synthetic-client',
  individualLevel: 'individual-sandbox', companyLevel: 'company-sandbox' }

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za')
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN', config.appToken)
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET', config.appSecret)
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET', config.secret)
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_CLIENT_ID', config.clientId)
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL', config.individualLevel)
  vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL', config.companyLevel)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Sumsub sandbox evidence boundary', () => {
  it('verifies exact raw bytes in constant time and refuses SHA1, changed bytes and malformed digests', () => {
    const raw = Buffer.from(JSON.stringify(base))
    const digest = createHmac('sha256', config.secret).update(raw).digest('hex')
    const sha512 = createHmac('sha512', config.secret).update(raw).digest('hex')
    expect(verifySumsubWebhookDigest(raw, 'HMAC_SHA256_HEX', digest, config.secret)).toBe(true)
    expect(verifySumsubWebhookDigest(raw, 'HMAC_SHA512_HEX', sha512, config.secret)).toBe(true)
    expect(verifySumsubWebhookDigest(Buffer.from(JSON.stringify({ ...base, sandboxMode: false })), 'HMAC_SHA256_HEX', digest, config.secret)).toBe(false)
    expect(verifySumsubWebhookDigest(raw, 'HMAC_SHA1_HEX', createHmac('sha1', config.secret).update(raw).digest('hex'), config.secret)).toBe(false)
    expect(verifySumsubWebhookDigest(raw, 'HMAC_SHA256_HEX', 'a'.repeat(64), config.secret)).toBe(false)
    expect(verifySumsubWebhookDigest(raw, 'HMAC_SHA256_HEX', 'bad,digest', config.secret)).toBe(false)
  })
  it('normalizes provider evidence without saving sensitive raw payload and dedupes reordered JSON semantics', () => {
    const first = parseSumsubWebhook(Buffer.from(JSON.stringify({ ...base, extraPrivate: { name: 'Synthetic Applicant' } })), config.clientId)
    const reordered = parseSumsubWebhook(Buffer.from(JSON.stringify({ extraPrivate: { name: 'Synthetic Applicant' }, ...base })), config.clientId)
    expect(first.payloadHash).not.toBe(reordered.payloadHash)
    expect(first.semanticHash).toBe(reordered.semanticHash)
    expect(first.eventAt).toBe('2026-09-24T11:30:00.123Z')
    expect(first.event.externalUserId).toBe(externalUserId)
    expect(first.event.reviewResult?.reviewAnswer).toBe('GREEN')
  })
  it('rejects wrong environment, unrelated client, malformed identity and invalid provider time', () => {
    for (const mutation of [
      { sandboxMode: false }, { externalUserId: `bx1:mainnet:${applicationId}:r2` },
      { externalUserId: `bx1:testnet:${applicationId}:r0` }, { clientId: 'different-client' },
      { createdAtMs: '2026-02-30 11:30:00.123' }, { testMode: false },
    ]) expect(() => parseSumsubWebhook(Buffer.from(JSON.stringify({ ...base, ...mutation })), config.clientId)).toThrow()
  })
  it('signs token request exactly as documented and returns only a token bound to the server user ID', async () => {
    const timestamp = '1607551635'
    const path = '/resources/accessTokens/sdk'
    const body = JSON.stringify({ userId: externalUserId, levelName: config.individualLevel, ttlInSecs: 600 })
    expect(sumsubRequestSignature(timestamp, path, body, config.appSecret)).toBe(
      createHmac('sha256', config.appSecret).update(`${timestamp}POST${path}${body}`).digest('hex'))
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'synthetic-short-lived-token', userId: externalUserId }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await issueSumsubSandboxToken(externalUserId, config.individualLevel, config)).toBe('synthetic-short-lived-token')
    const [, request] = fetcher.mock.calls[0]
    expect(request.headers['X-App-Access-Sig']).toBe(sumsubRequestSignature(request.headers['X-App-Access-Ts'], path, request.body, config.appSecret))
    expect(request.redirect).toBe('error')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ token: 'wrong-person-token', userId: 'other' }), { status: 200 }))
    await expect(issueSumsubSandboxToken(externalUserId, config.individualLevel, config)).rejects.toThrow('could not be verified')
  })
  it('fails closed with absent credentials, MAIN environment or wrong database writer identity', () => {
    expect(sumsubSessionConfig().companyLevel).toBe(config.companyLevel)
    vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET', '')
    expect(() => sumsubSessionConfig()).toThrow('not configured')
    vi.stubEnv('BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET', config.appSecret)
    vi.stubEnv('BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL', 'postgresql://postgres:synthetic@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full')
    expect(() => providerEvidenceDatabaseConfig()).toThrow('writer is not configured')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    expect(() => sumsubSessionConfig()).toThrow('not admitted')
  })
})
