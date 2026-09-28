import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { offeringFileId, sha256Hex } from './offering-files-server'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
vi.mock('./server', async original => ({ ...await original<object>(), readPortal: mocks.read }))
import { GET, POST } from '@/app/api/portal/offering-documents/route'

const origin = 'https://block-x-one-offering-file-test.vercel.app'
const actor = '11111111-1111-4111-8111-111111111111'
const organisationId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const revisionId = '44444444-4444-4444-8444-444444444444'
const context = { mode: 'ROLE', organisationId, role: 'OfferingManager' }
const pdf = Buffer.from('%PDF-1.7\nfictional supplemental document')
const snapshot = { actor: { id: actor, email: 'synthetic@example.invalid', can_review: false },
  applications: [], organisations: [], products: [{ id: productId, status: 'IN_REVIEW',
    offering_package: { id: revisionId, origin: 'SUBMITTED' } }], subscriptions: [], events: [] }

function request(bytes = pdf) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'synthetic.pdf', { type: 'application/pdf' }))
  form.set('kind', 'MEMORANDUM'); form.set('title', 'Fictional memorandum')
  form.set('product_id', productId); form.set('revision_id', revisionId)
  return new NextRequest(`${origin}/api/portal/offering-documents`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'x-bx1-operating-context': JSON.stringify(context),
      'x-bx1-expected-actor': actor }, body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', VERCEL_ENV: 'preview',
    BLOCKXONE_TESTNET_FUND_DEMO: 'enabled', BLOCKXONE_AUTH_MODE: 'supabase',
    NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase', BLOCKXONE_APP_ORIGIN: origin,
    SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co' })) vi.stubEnv(key, value)
  mocks.read.mockResolvedValue({ user: { id: actor }, snapshot })
})
afterEach(() => vi.unstubAllEnvs())

describe('offering-file API quarantine', () => {
  it('rehashes downloaded Storage bytes before making a database receipt', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null,
      data: new Blob([Buffer.from('%PDF-1.7\ndifferent private bytes')], { type: 'application/pdf' }) })
    const rpc = vi.fn()
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc })
    const result = await POST(request())
    expect(result.status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
    expect(download).toHaveBeenCalledOnce()
  })

  it('records only an exact quarantined receipt after same-origin bytes and scope checks', async () => {
    const sha256 = sha256Hex(pdf)
    const id = offeringFileId(revisionId, actor, 'MEMORANDUM', sha256)
    const upload = vi.fn().mockResolvedValue({ error: null })
    const download = vi.fn().mockResolvedValue({ error: null, data: new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }) })
    const receipt = { id, revision_id: revisionId, kind: 'MEMORANDUM', title: 'Fictional memorandum',
      sha256, size: pdf.length, validation_state: 'QUARANTINED', uploaded_at: '2026-09-28T00:00:00Z' }
    const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: receipt, error: null }) })
    mocks.create.mockReturnValue({ storage: { from: () => ({ upload, download }) }, rpc })
    const result = await POST(request())
    expect(result.status).toBe(202)
    expect((await result.json()).document.validation_state).toBe('QUARANTINED')
    expect(rpc).toHaveBeenCalledWith('bx1_offering_file_register', expect.objectContaining({
      operating_context: context, target_product: productId, target_revision: revisionId,
      file_id: id, file_sha256: sha256, file_size: pdf.length,
    }))
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('does not look up or release files absent from the caller snapshot', async () => {
    const rpc = vi.fn(), download = vi.fn()
    mocks.create.mockReturnValue({ rpc, storage: { from: () => ({ download }) } })
    mocks.read.mockResolvedValue({ user: { id: actor }, snapshot: { ...snapshot, products: [] } })
    const url = `${origin}/api/portal/offering-documents?revision_id=${revisionId}&id=${actor}&download=1&organisation=${organisationId}&role=OfferingManager`
    expect((await GET(new NextRequest(url))).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })
})
