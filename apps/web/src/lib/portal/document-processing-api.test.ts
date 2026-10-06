import { createHash, createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const boundary = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn(), bucket: vi.fn(), client: vi.fn() }))
vi.mock('pg', () => ({ Pool: class {
  on() {}
  query = boundary.query
} }))
vi.mock('@supabase/supabase-js', () => ({ createClient: boundary.client }))
import { POST } from '@/app/api/portal/documents/processing/route'

const origin = 'https://testnet.bx1.co.za'
const endpoint = `${origin}/api/portal/documents/processing`
const now = Date.parse('2026-10-07T12:00:00Z')
const actor = '11111111-1111-4111-8111-111111111111'
const document = '22222222-2222-4222-8222-222222222222'
const attempt = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const signingKey = Buffer.alloc(32, 7)
const bytes = Buffer.from('%PDF-1.4\nfictional private processing fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const env = { NODE_ENV: 'production', BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', BLOCKXONE_APP_ORIGIN: origin, VERCEL_ENV: 'preview',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'A'.repeat(32)}`,
  BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic_adapter', BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: signingKey.toString('base64url'),
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
  BLOCKXONE_DOCUMENT_PROCESSING_WORKER_ID: 'synthetic_worker',
  BLOCKXONE_DOCUMENT_PROCESSING_DATABASE_URL: 'postgresql://bx1_document_processing_worker.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
}
const manifest = { document_id: document, attempt_id: attempt, authority_epoch: 2, attempt_number: 1,
  worker_id: 'synthetic_worker', scanner_id: 'synthetic_adapter', reference: `bx1-scan:${attempt}`,
  lease_expires_at: '2026-10-07T12:02:00Z', actor_id: actor, storage_path: `${actor}/${document}`,
  sha256, size: bytes.length, mime_type: 'application/pdf' }
const claim = { command: 'CLAIM', request_id: requestId }
const byteCommand = { command: 'BYTES', document_id: document, attempt_id: attempt, authority_epoch: 2, sha256 }
function serviceRequest(input: unknown = claim, headers: Record<string, string> = {}, url = endpoint) {
  const raw = input instanceof Uint8Array ? Buffer.from(input) : Buffer.from(JSON.stringify(input))
  const timestamp = String(now / 1000)
  const signature = `sha256=${createHmac('sha256', signingKey).update('bx1-document-processing-v1:')
    .update(timestamp).update('.').update(raw).digest('hex')}`
  return new NextRequest(url, { method: 'POST', headers: { host: new URL(origin).host, 'content-type': 'application/json',
    'x-bx1-scanner-timestamp': timestamp, 'x-bx1-scanner-signature': signature, ...headers }, body: raw })
}
function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toContain('private')
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('access-control-allow-origin')).toBeNull()
  expect(response.headers.get('set-cookie')).toBeNull()
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  boundary.bucket.mockReturnValue({ download: boundary.download })
  boundary.client.mockReturnValue({ storage: { from: boundary.bucket } })
  boundary.download.mockResolvedValue({ data: new Blob([bytes]), error: null })
  boundary.query.mockResolvedValue({ rows: [{ result: manifest }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('processing POST using the actual command module and mocked external boundaries', () => {
  it('returns only a durable claim manifest or an empty receipt, never a scan/promotion success', async () => {
    const response = await POST(serviceRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ job: manifest })
    expectPrivate(response)
    expect(boundary.query).toHaveBeenCalledWith('select bx1_private.claim_document_processing($1,$2,$3) as result',
      ['synthetic_worker', 'synthetic_adapter', requestId])
    boundary.query.mockResolvedValueOnce({ rows: [{ result: null }] })
    const empty = await POST(serviceRequest())
    expect(await empty.json()).toEqual({ job: null })
    expectPrivate(empty)
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it.each([
    { origin }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' },
    { host: 'attacker.invalid' }, { host: `${new URL(origin).host}:443` },
  ] as Record<string, string>[])('denies browser or noncanonical request headers %# before backend access', async headers => {
    const response = await POST(serviceRequest(claim, headers))
    expect(response.status).toBe(403)
    expectPrivate(response)
    expect(boundary.query).not.toHaveBeenCalled()
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it.each([`${endpoint}?command=CLAIM`, 'https://attacker.invalid/api/portal/documents/processing',
    'http://testnet.bx1.co.za/api/portal/documents/processing'])('denies noncanonical URL %s', async url => {
    const response = await POST(serviceRequest(claim, {}, url))
    expect(response.status).toBe(403)
    expectPrivate(response)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it.each(['text/plain', 'application/json; charset=iso-8859-1', 'multipart/form-data'])('denies unsupported %s media', async type => {
    const response = await POST(serviceRequest(claim, { 'content-type': type }))
    expect(response.status).toBe(415)
    expectPrivate(response)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('bounds claimed and actual body sizes independently', async () => {
    for (const request of [serviceRequest(claim, { 'content-length': '4097' }),
      serviceRequest(claim, { 'content-length': 'not-a-number' }), serviceRequest(Buffer.alloc(4097, 32)),
      serviceRequest(Buffer.alloc(4097, 32), { 'content-length': '1' })]) {
      const response = await POST(request)
      expect(response.status).toBe(413)
      expectPrivate(response)
    }
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('denies missing, forged, callback-domain and stale HMACs without opening a database connection', async () => {
    const raw = Buffer.from(JSON.stringify(claim))
    const timestamp = String(now / 1000)
    const callbackSignature = `sha256=${createHmac('sha256', signingKey).update(timestamp).update('.').update(raw).digest('hex')}`
    const variants: Record<string, string>[] = [
      { 'x-bx1-scanner-signature': '' }, { 'x-bx1-scanner-signature': `sha256=${'0'.repeat(64)}` },
      { 'x-bx1-scanner-signature': callbackSignature }, { 'x-bx1-scanner-timestamp': String(now / 1000 - 301) },
    ]
    for (const headers of variants) {
      const response = await POST(serviceRequest(claim, headers))
      expect(response.status).toBe(403)
      expectPrivate(response)
    }
    expect(boundary.query).not.toHaveBeenCalled()
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it.each([{ ...claim, worker_id: 'other_worker' }, { ...claim, scanner_id: 'other_scanner' },
    { ...byteCommand, verdict: 'CLEAN' }, { command: 'REQUEUE', document_id: document },
    { ...byteCommand, command: 'FAIL', code: 'CLEAN' }, { ...byteCommand, authority_epoch: '2' },
    Buffer.from([0xff])])('rejects signed invalid schemas and UTF-8 %#', async input => {
    const response = await POST(serviceRequest(input))
    expect(response.status).toBe(400)
    expectPrivate(response)
    expect(boundary.query).not.toHaveBeenCalled()
  })
  it('returns private raw bytes as an inert attachment only after two lease guards', async () => {
    const response = await POST(serviceRequest(byteCommand))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-length')).toBe(String(bytes.length))
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${document}.bin"`)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expectPrivate(response)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(boundary.query).toHaveBeenCalledTimes(2)
    expect(boundary.download).toHaveBeenCalledWith(`${actor}/${document}`)
  })
  it('does not inflate a maximum 4 MiB document into base64', async () => {
    const maximum = Buffer.alloc(4_194_304, 19)
    const digest = createHash('sha256').update(maximum).digest('hex')
    boundary.query.mockResolvedValue({ rows: [{ result: { ...manifest, sha256: digest, size: maximum.length } }] })
    boundary.download.mockResolvedValue({ data: new Blob([maximum]), error: null })
    const response = await POST(serviceRequest({ ...byteCommand, sha256: digest }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('4194304')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(maximum)
    expectPrivate(response)
  })
  it('fails closed when authority changes during actual Storage I/O', async () => {
    boundary.download.mockImplementationOnce(async () => {
      boundary.query.mockRejectedValueOnce({ code: '42501', message: 'synthetic revoked policy detail' })
      return { data: new Blob([bytes]), error: null }
    })
    const response = await POST(serviceRequest(byteCommand))
    expect(response.status).toBe(403)
    expectPrivate(response)
    const body = await response.json()
    expect(body.error).toContain('no longer current')
    expect(JSON.stringify(body)).not.toContain('revoked policy detail')
    expect(boundary.query).toHaveBeenCalledTimes(2)
    expect(boundary.download).toHaveBeenCalledOnce()
  })
  it('does not release bytes if the post-Storage manifest changes even while still live', async () => {
    boundary.download.mockImplementationOnce(async () => {
      boundary.query.mockResolvedValueOnce({ rows: [{ result: { ...manifest, lease_expires_at: '2026-10-07T12:01:59Z' } }] })
      return { data: new Blob([bytes]), error: null }
    })
    const response = await POST(serviceRequest(byteCommand))
    expect(response.status).toBe(409)
    expectPrivate(response)
    expect((await response.json()).error).toContain('changed before byte release')
    expect(boundary.query).toHaveBeenCalledTimes(2)
  })
  it('denies wrong leases and exact-byte mismatches before release', async () => {
    const wrong = await POST(serviceRequest({ ...byteCommand, attempt_id: requestId }))
    expect(wrong.status).toBe(409)
    expect(boundary.download).not.toHaveBeenCalled()
    boundary.download.mockResolvedValueOnce({ data: new Blob([Buffer.alloc(bytes.length, 1)]), error: null })
    const changed = await POST(serviceRequest(byteCommand))
    expect(changed.status).toBe(409)
    expectPrivate(changed)
    expect((await changed.json()).error).toContain('could not be verified')
  })
  it('returns an early fatal failure receipt without claiming clean or promoted status', async () => {
    const receipt = { document_id: document, attempt_id: attempt, state: 'EXHAUSTED', attempt_number: 1, next_attempt_at: null }
    boundary.query.mockResolvedValueOnce({ rows: [{ result: manifest }] }).mockResolvedValueOnce({ rows: [{ result: receipt }] })
    const response = await POST(serviceRequest({ ...byteCommand, command: 'FAIL', code: 'HASH_MISMATCH' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expectPrivate(response)
    expect(boundary.client).not.toHaveBeenCalled()
  })
  it('does not admit work through a pretend activation flag or disclose failures containing secrets/URLs', async () => {
    vi.stubEnv('BLOCKXONE_DOCUMENT_PROCESSING_ACTIVATED', 'true')
    boundary.query.mockRejectedValueOnce({ code: '42501', message: 'NOT_ADMITTED synthetic SQL authority' })
    const denied = await POST(serviceRequest())
    expect(denied.status).toBe(403)
    expectPrivate(denied)
    boundary.query.mockRejectedValueOnce(new Error('sb_secret_fixture-secret postgresql://password@private.invalid'))
    const failed = await POST(serviceRequest())
    expect(failed.status).toBe(503)
    const body = JSON.stringify(await failed.json())
    expect(body).not.toContain('sb_secret_')
    expect(body).not.toContain('postgresql:')
    expect(body).not.toContain('private.invalid')
    expectPrivate(failed)
  })
  it('fails configuration before any database or Storage call', async () => {
    vi.stubEnv('BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY', '')
    const response = await POST(serviceRequest())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Private document processing is not configured.' })
    expectPrivate(response)
    expect(boundary.query).not.toHaveBeenCalled()
    expect(boundary.client).not.toHaveBeenCalled()
  })
})
