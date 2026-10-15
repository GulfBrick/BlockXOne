import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readSumsubSandboxReadiness, sumsubRequestSignature } from './provider-evidence'

// Synthetic transport/configuration only. These tests do not authenticate with
// Sumsub or establish a provider outcome, webhook delivery or hosted acceptance.
const token = 'sbx:synthetic-readiness-token'
const secret = 'synthetic-readiness-secret-not-a-live-credential'
const env = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  NEXT_PUBLIC_SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_ENVIRONMENT: 'TESTNET', NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: 'TESTNET',
  BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN: token, BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET: secret,
  BLOCKXONE_SUMSUB_SANDBOX_CLIENT_ID: 'synthetic-client',
  BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET: 'synthetic-webhook-secret-not-live',
  BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_LEVEL: 'individual-sandbox',
  NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED: 'true',
  NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_INDIVIDUAL_ENABLED: 'true',
  BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL: 'postgresql://bx1_provider_evidence_writer:synthetic@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full',
}
const levels = [{ name: 'individual-sandbox', applicantType: 'individual', privateProviderField: 'not-returned' },
  { name: 'company-sandbox', applicantType: 'company' }]
const response = (items: unknown[] = levels) => Response.json({ list: { items, totalItems: items.length }, privateProviderField: 'not-returned' })
const transport = () => vi.fn<typeof fetch>().mockResolvedValue(response())
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('private Sumsub Sandbox readiness read', () => {
  it('signs GET with no body and preserves the existing four-argument POST signature', () => {
    const timestamp = '1792051200', path = '/resources/applicants/-/levels'
    expect(sumsubRequestSignature(timestamp, path, '', secret, 'GET'))
      .toBe(createHmac('sha256', secret).update(timestamp + 'GET' + path).digest('hex'))
    expect(sumsubRequestSignature(timestamp, '/resources/accessTokens/sdk', '{"synthetic":true}', secret))
      .toBe(createHmac('sha256', secret).update(timestamp + 'POST/resources/accessTokens/sdk{"synthetic":true}').digest('hex'))
    expect(() => sumsubRequestSignature(timestamp, path, 'body', secret, 'GET')).toThrow('Invalid identity provider request')
  })

  it('uses only the fixed official level GET and returns limited status instead of credentials or raw provider data', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const fetch = transport(), result = await readSumsubSandboxReadiness(env, fetch)
    const timestamp = Math.floor(Date.now() / 1000).toString()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://api.sumsub.com/resources/applicants/-/levels', {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal), headers: {
        Accept: 'application/json', 'X-App-Token': token, 'X-App-Access-Ts': timestamp,
        'X-App-Access-Sig': createHmac('sha256', secret).update(timestamp + 'GET/resources/applicants/-/levels').digest('hex'),
      },
    })
    expect(result).toMatchObject({ provider: 'SUMSUB', environment: 'TESTNET', status: 'CONNECTED',
      classifier: 'AUTHENTICATED_LEVELS_READ', individual: { configured: true, enabled: true, level_present: true, classifier: 'LEVEL_PRESENT' },
      company: { configured: false, enabled: false, level_present: null, classifier: 'LEVEL_NOT_CONFIGURED' },
      webhook: { configured: true, delivery_proved: false }, evidence_writer: { configured: true, connection_proved: false },
      verification_proved: false, admission_granted: false })
    expect(result.available_levels).toEqual([{ name: 'individual-sandbox', applicant_type: 'individual' }, { name: 'company-sandbox', applicant_type: 'company' }])
    const wire = JSON.stringify(result)
    for (const value of [token, secret, env.BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET,
      env.BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL, 'not-returned', 'synthetic-client']) expect(wire).not.toContain(value)
  })

  it('can probe while public capabilities are disabled without activating them', async () => {
    const result = await readSumsubSandboxReadiness({ ...env, NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_ENABLED: 'false' }, transport())
    expect(result.status).toBe('CONNECTED')
    expect(result.sandbox_enabled).toBe(false)
    expect(result.individual).toMatchObject({ configured: true, enabled: false, level_present: true, classifier: 'SUBJECT_DISABLED' })
    expect(result.company.enabled).toBe(false)
    expect(result.admission_granted).toBe(false)
  })

  it('does not infer the company subject from its name or an undocumented provider field', async () => {
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(response([{ name: 'company-sandbox', type: 'company', rawSecret: token }]))
    const result = await readSumsubSandboxReadiness({ ...env, BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL: 'company-sandbox',
      NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_COMPANY_ENABLED: 'true' }, fetch)
    expect(result.company).toMatchObject({ configured: true, enabled: true, level_present: true,
      provider_subject_type: 'UNKNOWN', classifier: 'LEVEL_SUBJECT_UNCONFIRMED' })
    expect(result.available_levels).toEqual([{ name: 'company-sandbox', applicant_type: 'UNKNOWN' }])
    expect(JSON.stringify(result)).not.toContain(token)
  })

  it('distinguishes an exact missing level, wrong subject and ambiguous name without a fallback', async () => {
    const companyEnv = { ...env, BLOCKXONE_SUMSUB_SANDBOX_COMPANY_LEVEL: 'company-sandbox',
      NEXT_PUBLIC_BLOCKXONE_SUMSUB_SANDBOX_COMPANY_ENABLED: 'true' }
    for (const [items, classifier] of [
      [[], 'LEVEL_NOT_FOUND'],
      [[{ name: 'Company-sandbox', applicantType: 'company' }], 'LEVEL_NOT_FOUND'],
      [[{ name: 'company-sandbox', applicantType: 'individual' }], 'LEVEL_SUBJECT_MISMATCH'],
      [[{ name: 'company-sandbox', applicantType: 'company' }, { name: 'company-sandbox', applicantType: 'company' }], 'LEVEL_AMBIGUOUS'],
    ] as const) {
      const fetch = vi.fn<typeof fetch>().mockResolvedValue(response([...items]))
      expect((await readSumsubSandboxReadiness(companyEnv, fetch)).company.classifier).toBe(classifier)
    }
  })

  it('reports incomplete webhook/writer configuration honestly without blocking the independent provider auth read', async () => {
    const result = await readSumsubSandboxReadiness({ ...env, BLOCKXONE_SUMSUB_SANDBOX_WEBHOOK_SECRET: '',
      BLOCKXONE_PROVIDER_EVIDENCE_DATABASE_URL: '' }, transport())
    expect(result.status).toBe('CONNECTED')
    expect(result.webhook).toEqual({ configured: false, delivery_proved: false })
    expect(result.evidence_writer).toEqual({ configured: false, connection_proved: false })
  })

  it.each(['BLOCKXONE_SUMSUB_SANDBOX_APP_TOKEN', 'BLOCKXONE_SUMSUB_SANDBOX_APP_SECRET'] as const)('makes no provider request without valid %s', async key => {
    const fetch = transport()
    const result = await readSumsubSandboxReadiness({ ...env, [key]: '' }, fetch)
    expect(fetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'NOT_CONFIGURED', classifier: 'CREDENTIALS_NOT_CONFIGURED', available_levels: [] })
    expect(result.individual).toMatchObject({ level_present: null, classifier: 'CONNECTION_NOT_VERIFIED' })
  })

  it.each([
    [401, 'CREDENTIALS_REJECTED'], [403, 'PROVIDER_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE'],
  ] as const)('classifies provider HTTP %s without leaking its error body or retrying', async (status, classifier) => {
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-provider-error', { status }))
    const result = await readSumsubSandboxReadiness(env, fetch)
    expect(result).toMatchObject({ status: 'UNAVAILABLE', classifier, available_levels: [] })
    expect(result.individual.level_present).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('private-provider-error')
  })

  it('bounds response bytes and refuses partial, malformed, redirected or non-JSON catalogs', async () => {
    const redirected = response(); Object.defineProperty(redirected, 'redirected', { value: true })
    for (const reply of [redirected, new Response('private-html', { headers: { 'content-type': 'text/html' } }),
      new Response('broken-json', { headers: { 'content-type': 'application/json' } }),
      new Response(new Uint8Array(262_145), { headers: { 'content-type': 'application/json' } }),
      new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '262145' } }),
      new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
      Response.json({ list: { items: levels, totalItems: 3 } }), response([{ name: ' level-with-space' }]),
    ]) {
      const result = await readSumsubSandboxReadiness(env, vi.fn<typeof fetch>().mockResolvedValue(reply))
      expect(result).toMatchObject({ status: 'UNAVAILABLE', classifier: 'PROVIDER_RESPONSE_INVALID', available_levels: [] })
      expect(result.individual.level_present).toBeNull()
    }
  })

  it('returns a fixed unavailable classifier on network failure', async () => {
    const fetch = vi.fn<typeof fetch>().mockRejectedValue(Error('private transport details'))
    const result = await readSumsubSandboxReadiness(env, fetch)
    expect(result).toMatchObject({ status: 'UNAVAILABLE', classifier: 'PROVIDER_UNAVAILABLE' })
    expect(JSON.stringify(result)).not.toContain('private transport details')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not probe MAIN or a mismatched release binding', async () => {
    const fetch = transport()
    await expect(readSumsubSandboxReadiness({ ...env, BLOCKXONE_ENVIRONMENT: 'MAINNET' }, fetch)).rejects.toThrow()
    await expect(readSumsubSandboxReadiness({ ...env, BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za', VERCEL_ENV: 'production',
      SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co', NEXT_PUBLIC_SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co',
      BLOCKXONE_ENVIRONMENT: 'MAINNET', NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: 'MAINNET' }, fetch)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
