import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ portal: vi.fn(), session: vi.fn(), signatures: vi.fn(), status: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/portal/server', () => ({
  PortalError: class PortalError extends Error { constructor(message: string, public readonly status = 409) { super(message) } },
  readPortal: mocks.portal, requirePortalEnvironment: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ canonicalAppOrigin: () => process.env.BLOCKXONE_APP_ORIGIN,
  createRequestSupabaseClient: mocks.client, secureCookieOptions: (options: unknown) => options }))
vi.mock('@/lib/portal/offering-files-server', () => ({ verifiedOfferingFileSession: mocks.session }))
vi.mock('@/lib/portal/offering-signatures-server', () => ({ readOfferingSignatures: mocks.signatures }))
vi.mock('@/lib/portal/offering-provider-status', () => ({ readOfferingProviderStatus: mocks.status }))
import { PortalError } from '@/lib/portal/server'
import { GET } from './route'

// Synthetic current-scope boundaries, not a real user/session/factor or provider receipt.
const actor = '11111111-1111-4111-8111-111111111111', session = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333', revision = '44444444-4444-4444-8444-444444444444'
const organisation = '55555555-5555-4555-8555-555555555555', other = '66666666-6666-4666-8666-666666666666'
const origin = 'https://testnet.bx1.co.za', pathname = '/api/portal/offering-signatures/provider-status'
const context = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
const query = new URLSearchParams({ product_id: product, revision_id: revision, organisation, role: 'OfferingManager', expected_actor: actor })
const status = { status: 'AVAILABLE', classifier: 'AUTHENTICATED', checkedAt: '2026-10-15T12:00:00.000Z' }
function portal() { return { user: { id: actor, email: 'synthetic@example.invalid' },
  snapshot: { actor: { id: actor }, operating_context: context,
    products: [{ id: product, revision: 7, offering_package: { id: revision, origin: 'SUBMITTED' } }] } } }
function signatures() { return { actor_id: actor, session_id: session, environment: 'TESTNET', product_id: product,
  revision_id: revision, expected_revision: 7, context, admitted: false, allowed_commands: [], authorisations: [], operations: [] } }
function get(suffix = '', headers: Record<string, string> = {}, requestOrigin = origin, path = pathname) {
  return new NextRequest(requestOrigin + path + '?' + query + suffix, { headers: { host: new URL(requestOrigin).host, ...headers } })
}
beforeEach(() => {
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    BLOCKXONE_APP_ORIGIN: origin, VERCEL_ENV: 'preview', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  for (const key of ['BLOCKXONE_ENVIRONMENT', 'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'NEXT_PUBLIC_SUPABASE_URL']) vi.stubEnv(key, undefined)
  mocks.client.mockReturnValue({})
  mocks.portal.mockImplementation(async () => portal())
  mocks.session.mockResolvedValue({ id: session, aal: 'aal2' })
  mocks.signatures.mockImplementation(async () => signatures())
  mocks.status.mockResolvedValue(status)
})
afterEach(() => { vi.unstubAllEnvs() })

describe('browser-navigable protected TEST provider status', () => {
  it('authenticates privately while NOT_ADMITTED and rechecks actual scope after provider I/O', async () => {
    const response = await GET(get())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ environment: 'TESTNET', provider: 'DOCUSIGN', check: 'SANDBOX_AUTHENTICATION_ONLY', ...status })
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(mocks.portal).toHaveBeenCalledTimes(2)
    expect(mocks.session).toHaveBeenCalledTimes(2)
    expect(mocks.signatures).toHaveBeenCalledTimes(2)
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.signatures.mock.calls[0][0]).toMatchObject({ actorId: actor, revisionId: revision, context })
    expect(signatures().admitted).toBe(false)
  })

  it.each(['cross-site', 'wrong-origin', 'wrong-host', 'wrong-path', 'preview-origin', 'main', 'prefetch'] as const)('denies %s before private reads or authentication', async fault => {
    let request = get()
    if (fault === 'cross-site') request = get('', { 'sec-fetch-site': 'cross-site' })
    if (fault === 'wrong-origin') request = get('', { origin: 'https://untrusted.invalid' })
    if (fault === 'wrong-host') request = get('', { host: 'untrusted.invalid' })
    if (fault === 'wrong-path') request = get('', {}, origin, '/api/portal/anything')
    if (fault === 'prefetch') request = get('', { 'sec-purpose': 'prefetch' })
    if (fault === 'preview-origin') {
      vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://test-candidate.vercel.app')
      request = get('', {}, 'https://test-candidate.vercel.app')
    }
    if (fault === 'main') {
      vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za'); vi.stubEnv('VERCEL_ENV', 'production')
      vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
      request = get('', {}, 'https://bx1.co.za')
    }
    expect((await GET(request)).status).toBeGreaterThanOrEqual(400)
    expect(mocks.portal).not.toHaveBeenCalled()
    expect(mocks.signatures).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it.each(['&revision_id=duplicate', '&activation=true', '&role=TokenisationAgent', '&mode=applicant'])('rejects ambiguous or unsupported query %s', async suffix => {
    expect((await GET(get(suffix))).status).toBe(400)
    expect(mocks.portal).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it.each(['other-actor', 'other-context', 'missing-product', 'other-package', 'draft-package', 'aal1',
    'other-signature-product', 'other-signature-session', 'other-signature-revision'] as const)('requires current scoped AAL2 authority for %s', async fault => {
    const value = portal(), signed = signatures()
    if (fault === 'other-actor') value.user.id = other
    if (fault === 'other-context') value.snapshot.operating_context = { ...context, organisationId: other }
    if (fault === 'missing-product') value.snapshot.products = []
    if (fault === 'other-package') value.snapshot.products[0].offering_package.id = other
    if (fault === 'draft-package') value.snapshot.products[0].offering_package.origin = 'DRAFT'
    if (fault === 'aal1') mocks.session.mockResolvedValue({ id: session, aal: 'aal1' })
    if (fault === 'other-signature-product') signed.product_id = other
    if (fault === 'other-signature-session') signed.session_id = other
    if (fault === 'other-signature-revision') signed.expected_revision = 8
    mocks.portal.mockResolvedValue(value); mocks.signatures.mockResolvedValue(signed)
    expect((await GET(get())).status).toBe(403)
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it.each(['session-changed', 'factor-lost', 'revision-changed', 'revoked'] as const)('does not retain readiness authority after %s during provider I/O', async fault => {
    if (fault === 'session-changed') {
      mocks.session.mockResolvedValueOnce({ id: session, aal: 'aal2' }).mockResolvedValueOnce({ id: other, aal: 'aal2' })
      mocks.signatures.mockResolvedValueOnce(signatures()).mockResolvedValueOnce({ ...signatures(), session_id: other })
    }
    if (fault === 'factor-lost') mocks.session.mockResolvedValueOnce({ id: session, aal: 'aal2' }).mockResolvedValueOnce({ id: session, aal: 'aal1' })
    if (fault === 'revision-changed') {
      const changed = portal(); changed.snapshot.products[0].revision = 8
      mocks.portal.mockResolvedValueOnce(portal()).mockResolvedValueOnce(changed)
    }
    if (fault === 'revoked') mocks.portal.mockResolvedValueOnce(portal()).mockRejectedValueOnce(new PortalError('Current scope revoked.', 403))
    expect((await GET(get())).status).toBe(403)
    expect(mocks.status).toHaveBeenCalledTimes(1)
  })

  it('returns only the safe failure classifier and never an unrecognised exception message', async () => {
    mocks.status.mockResolvedValueOnce({ status: 'UNAVAILABLE', classifier: 'NOT_CONFIGURED', checkedAt: status.checkedAt })
    const unavailable = await GET(get())
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ environment: 'TESTNET', provider: 'DOCUSIGN', check: 'SANDBOX_AUTHENTICATION_ONLY',
      status: 'UNAVAILABLE', classifier: 'NOT_CONFIGURED', checkedAt: status.checkedAt })
    mocks.session.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_TOKEN_AND_RAW_BODY'))
    const unknown = await GET(get())
    expect(unknown.status).toBe(503)
    expect(JSON.stringify(await unknown.json())).not.toContain('PRIVATE_PROVIDER')
  })
})
