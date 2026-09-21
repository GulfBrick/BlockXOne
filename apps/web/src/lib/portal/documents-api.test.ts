import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
import { GET, POST } from '@/app/api/portal/documents/route'
const origin = 'https://block-x-one-documents-test.vercel.app'
const id = '55555555-5555-4555-8555-555555555555'
const actor = '11111111-1111-4111-8111-111111111111'
const organisationId = '33333333-3333-4333-8333-333333333333'
const document = { id, kind: 'IDENTITY', title: 'Fictional identity', storage_path: `${actor}/${id}`, sha256: 'a'.repeat(64), size: 10, mime_type: 'application/pdf' }
const snapshot = { actor: { id: actor, email: 'synthetic@example.invalid', can_review: false }, applications: [{ details: { documents: [document] } }], organisations: [], products: [], subscriptions: [], events: [] }
beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', VERCEL_ENV: 'preview', BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin, SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.create.mockReturnValue({})
  mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
})
afterEach(() => vi.unstubAllEnvs())
describe('private evidence context continuity', () => {
  it('keeps applicant scope in the authenticated download continuation', async () => {
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&mode=applicant`))
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'APPLICANT' })
    const result = await response.json()
    expect(result.url).toContain('mode=applicant'); expect(result.url).toContain('download=1')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('passes exact reviewer organisation and role to the guarded read', async () => {
    const response = await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&organisation=${organisationId}&role=ComplianceOfficer`))
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' })
    expect((await response.json()).url).toContain(`organisation=${organisationId}`)
  })
  it.each(['', '&mode=applicant&role=Investor', '&mode=applicant&mode=applicant', `&organisation=${organisationId}&role=WealthManager`])('rejects missing or ambiguous context %s', async query => {
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}${query}`))).status).toBeGreaterThanOrEqual(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not leak a document excluded from the selected scope', async () => {
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, applications: [] } })
    expect((await GET(new NextRequest(`${origin}/api/portal/documents?id=${id}&mode=applicant`))).status).toBe(404)
  })
  it('refuses unscoped uploads before any private backend call', async () => {
    const response = await POST(new NextRequest(`${origin}/api/portal/documents`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'multipart/form-data; boundary=synthetic' }, body: '' }))
    expect(response.status).toBe(403); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('stops an upload when the signed-in account changed after the form loaded', async () => {
    const response = await POST(new NextRequest(`${origin}/api/portal/documents`, { method: 'POST', headers: { origin, host: new URL(origin).host, 'content-type': 'multipart/form-data; boundary=synthetic', 'x-bx1-operating-context': JSON.stringify({ mode: 'APPLICANT' }), 'x-bx1-expected-actor': organisationId }, body: '' }))
    expect(response.status).toBe(403)
    expect(mocks.read).toHaveBeenCalledWith({}, { mode: 'APPLICANT' })
  })
})
