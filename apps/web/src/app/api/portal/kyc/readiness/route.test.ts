import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), entry: vi.fn(), readiness: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.client }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.entry }))
vi.mock('@/lib/portal/provider-evidence', () => ({ readSumsubSandboxReadiness: mocks.readiness }))
import { PortalError } from '@/lib/portal/server'
import { GET } from './route'

const origin = 'https://testnet.bx1.co.za', actor = '11111111-1111-4111-8111-111111111111'
const organisation = '22222222-2222-4222-8222-222222222222'
const entry = { actor: { id: actor, email: 'synthetic-staff@example.invalid' }, applications: [],
  contexts: [{ context_key: '33333333-3333-4333-8333-333333333333', organisation_id: organisation, name: 'Synthetic staff scope', roles: ['OfferingManager'] }] }
const result = { provider: 'SUMSUB', environment: 'TESTNET', status: 'NOT_CONFIGURED', classifier: 'CREDENTIALS_NOT_CONFIGURED',
  sandbox_enabled: false, individual: { configured: false, enabled: false, level_present: null, provider_subject_type: null, classifier: 'LEVEL_NOT_CONFIGURED' },
  company: { configured: false, enabled: false, level_present: null, provider_subject_type: null, classifier: 'LEVEL_NOT_CONFIGURED' },
  available_levels: [], webhook: { configured: false, delivery_proved: false }, evidence_writer: { configured: false, connection_proved: false },
  verification_proved: false, admission_granted: false }
function request(headers: Record<string, string> = {}, query = '', urlOrigin = origin) {
  return new NextRequest(`${urlOrigin}/api/portal/kyc/readiness${query}`, { headers: { host: new URL(urlOrigin).host, ...headers } })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    BLOCKXONE_APP_ORIGIN: origin, SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
    NEXT_PUBLIC_SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview',
    BLOCKXONE_ENVIRONMENT: 'TESTNET', NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE: 'TESTNET' })) vi.stubEnv(key, value)
  mocks.client.mockReturnValue({ synthetic: true })
  mocks.entry.mockResolvedValue(entry)
  mocks.readiness.mockResolvedValue(result)
})
afterEach(() => vi.unstubAllEnvs())

describe('authenticated TEST Sumsub readiness GET', () => {
  it('works as normal browser navigation with no expected-actor or Origin header and no application/admission prerequisite', async () => {
    const response = await GET(request({ 'sec-fetch-site': 'none' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ actor_id: actor, ...result })
    expect(mocks.entry).toHaveBeenCalledTimes(2)
    expect(mocks.readiness).toHaveBeenCalledTimes(1)
    expect(mocks.readiness).toHaveBeenCalledWith()
    for (const header of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) expect(response.headers.get(header)).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })

  it('accepts an optional matching expected actor and canonical same-origin request', async () => {
    expect((await GET(request({ origin, 'sec-fetch-site': 'same-origin', 'x-bx1-expected-actor': actor }))).status).toBe(200)
  })

  it.each(['SuperAdmin', 'ComplianceOfficer', 'OfferingManager', 'IssuerFundManager'])('uses the existing server-derived %s context, never a client-selected role', async role => {
    mocks.entry.mockResolvedValue({ ...entry, contexts: [{ ...entry.contexts[0], roles: [role] }] })
    expect((await GET(request())).status).toBe(200)
    expect(mocks.readiness).toHaveBeenCalledTimes(1)
  })

  it('denies anonymous callers before any provider request', async () => {
    mocks.entry.mockRejectedValue(new PortalError('Sign in with your verified email to continue.', 401))
    expect((await GET(request())).status).toBe(401)
    expect(mocks.readiness).not.toHaveBeenCalled()
  })

  it('denies an applicant-only or investor-only account and ignores forged role headers', async () => {
    for (const contexts of [[], [{ ...entry.contexts[0], roles: ['Investor'] }]]) {
      mocks.entry.mockResolvedValue({ ...entry, contexts })
      expect((await GET(request({ 'x-bx1-role': 'SuperAdmin' }))).status).toBe(403)
    }
    expect(mocks.readiness).not.toHaveBeenCalled()
  })

  it('rejects mismatched or malformed optional expected actors before provider access', async () => {
    expect((await GET(request({ 'x-bx1-expected-actor': organisation }))).status).toBe(403)
    expect((await GET(request({ 'x-bx1-expected-actor': 'invalid' }))).status).toBe(400)
    expect(mocks.readiness).not.toHaveBeenCalled()
  })

  it('rejects cross-site, wrong-host, wrong-origin and caller-selected parameters', async () => {
    for (const [headers, query, urlOrigin] of [
      [{ 'sec-fetch-site': 'cross-site' }, '', origin], [{ 'sec-fetch-site': 'same-site' }, '', origin],
      [{ origin: 'https://other.example.invalid' }, '', origin], [{ host: 'other.example.invalid' }, '', origin],
      [{}, '', 'https://other.example.invalid'], [{}, '?role=SuperAdmin', origin], [{}, '?level=arbitrary', origin],
    ] as Array<[Record<string, string>, string, string]>) expect((await GET(request(headers, query, urlOrigin))).status).toBeGreaterThanOrEqual(400)
    expect(mocks.entry).not.toHaveBeenCalled()
    expect(mocks.readiness).not.toHaveBeenCalled()
  })

  it('does not release a result after the actor or original staff authority changes during provider I/O', async () => {
    for (const after of [
      { ...entry, actor: { ...entry.actor, id: organisation } }, { ...entry, contexts: [] },
      { ...entry, contexts: [{ ...entry.contexts[0], organisation_id: '44444444-4444-4444-8444-444444444444' }] },
      { ...entry, contexts: [{ ...entry.contexts[0], roles: ['Investor'] }] },
    ]) {
      mocks.entry.mockReset().mockResolvedValueOnce(entry).mockResolvedValueOnce(after)
      const response = await GET(request())
      expect(response.status).toBe(403)
      expect(await response.json()).not.toHaveProperty('available_levels')
    }
  })

  it('does not turn failed provider reads or expired follow-up auth into a readiness result', async () => {
    mocks.readiness.mockRejectedValueOnce(Error('private provider detail'))
    const failed = await GET(request())
    expect(failed.status).toBe(503)
    expect(JSON.stringify(await failed.json())).not.toContain('private provider detail')
    mocks.entry.mockReset().mockResolvedValueOnce(entry).mockRejectedValueOnce(new PortalError('Sign in again.', 401))
    mocks.readiness.mockResolvedValueOnce(result)
    expect((await GET(request())).status).toBe(401)
  })

  it('is unavailable on MAIN before Supabase or provider access', async () => {
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'); vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'MAINNET'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'MAINNET')
    expect((await GET(request({}, '', 'https://bx1.co.za'))).status).toBe(404)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.readiness).not.toHaveBeenCalled()
  })
})
