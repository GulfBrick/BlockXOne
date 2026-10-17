import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const database = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { on() {} query(...args: unknown[]) { return database.query(...args) } } }))
import { documentReceiptDatabaseConfig, documentReceiptId, DocumentReceiptError, registerDocumentReceipt, verifiedDocumentReceiptSession } from './document-receipts'

const testEnvironment = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
}
const mainEnvironment = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co',
  BLOCKXONE_APP_ORIGIN: 'https://bx1.co.za', VERCEL_ENV: 'production',
}
const testDsn = 'postgresql://bx1_document_receipt_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full'
const mainDsn = 'postgresql://bx1_document_receipt_writer.oqkevkjbkpugjotihtda:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full'
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('server-only private document receipt configuration', () => {
  it('uses a stable UUID for an exact retry but never merges different document meanings', () => {
    const args = ['11111111-1111-4111-8111-111111111111', 'IDENTITY', 'Synthetic identity', 'a'.repeat(64)] as const
    const id = documentReceiptId(...args)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(documentReceiptId(...args)).toBe(id)
    expect(documentReceiptId(args[0], 'COMPANY', args[2], args[3])).not.toBe(id)
    expect(documentReceiptId(args[0], args[1], 'Other capacity', args[3])).not.toBe(id)
  })
  it('accepts only the dedicated role on the matching TEST project over verified TLS', () => {
    const config = documentReceiptDatabaseConfig({ ...testEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: testDsn })
    expect(config.user).toBe('bx1_document_receipt_writer.fegnnnlseuejkrusbbkv')
    expect(config.port).toBe(6543)
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true, servername: 'aws-0-eu-central-1.pooler.supabase.com' })
  })
  it('does not accept a missing writer, wrong project, broad role or disabled TLS', () => {
    expect(() => documentReceiptDatabaseConfig(testEnvironment)).toThrow(DocumentReceiptError)
    expect(() => documentReceiptDatabaseConfig({ ...testEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: mainDsn })).toThrow(DocumentReceiptError)
    expect(() => documentReceiptDatabaseConfig({ ...testEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: testDsn.replace('bx1_document_receipt_writer.', 'postgres.') })).toThrow(DocumentReceiptError)
    expect(() => documentReceiptDatabaseConfig({ ...testEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: testDsn.replace('verify-full', 'disable') })).toThrow(DocumentReceiptError)
  })
  it('requires a separately scoped MAIN writer when the main release is admitted', () => {
    expect(() => documentReceiptDatabaseConfig({ ...mainEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: testDsn })).toThrow(DocumentReceiptError)
    expect(documentReceiptDatabaseConfig({ ...mainEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: mainDsn }).user)
      .toBe('bx1_document_receipt_writer.oqkevkjbkpugjotihtda')
  })
})

describe('verified current-token receipt transport', () => {
  const actor = '11111111-1111-4111-8111-111111111111'
  const sessionId = '77777777-7777-4777-8777-777777777777'
  const claims = () => ({ iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor, session_id: sessionId,
    role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600,
    is_anonymous: false, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 10 }] })
  const tokenFor = (value: unknown) => `fixture.${Buffer.from(JSON.stringify(value)).toString('base64url')}.not-a-signature`
  const clientFor = (token: string) => ({ auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: token } }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: actor, user_metadata: { aal: 'aal2' } } }, error: null }),
  } })
  it('verifies the actual token first and transports only its minimal allowlist', async () => {
    const current = claims()
    const token = tokenFor({ ...current, email: 'private@example.invalid', user_metadata: { forged: true },
      amr: [{ ...current.amr[0], unrelated: 'not transported' }] })
    const client = clientFor(token)
    expect(await verifiedDocumentReceiptSession(client, actor)).toEqual({ sessionId, attestation: current })
    expect(client.auth.getUser).toHaveBeenCalledExactlyOnceWith(token)
    expect(client.auth.getSession.mock.invocationCallOrder[0]).toBeLessThan(client.auth.getUser.mock.invocationCallOrder[0])
  })
  it('rejects network validation failure or another verified account before transporting claims', async () => {
    const client = clientFor(tokenFor(claims()))
    client.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'expired' } })
    await expect(verifiedDocumentReceiptSession(client, actor)).rejects.toThrow(DocumentReceiptError)
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id: sessionId } }, error: null })
    await expect(verifiedDocumentReceiptSession(client, actor)).rejects.toThrow(DocumentReceiptError)
    client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(verifiedDocumentReceiptSession(client, actor)).rejects.toThrow(DocumentReceiptError)
  })
  it.each([
    { sub: sessionId }, { session_id: 'not-a-session' }, { role: 'service_role' }, { is_anonymous: true },
    { exp: 1 }, { exp: '99999999999' }, { exp: 1e12 }, { amr: [] }, { amr: [{ method: 'recovery', timestamp: 1 }] },
    { amr: [{ method: 'oauth', timestamp: 1 }] }, { amr: [{ method: 'password', timestamp: '1' }] },
    { amr: [{ method: 'password', timestamp: 999999999999 }] },
    { amr: [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 1 }] },
  ])('does not confer password admission for malformed or non-password facts %j', async change => {
    await expect(verifiedDocumentReceiptSession(clientFor(tokenFor({ ...claims(), ...change })), actor)).rejects.toThrow(DocumentReceiptError)
  })
  it('does not reinterpret native AAL2, MAIN or missing claims as password admission', async () => {
    for (const value of [{ ...claims(), aal: 'aal2' }, { ...claims(), iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' },
      { sub: actor, session_id: sessionId }]) {
      await expect(verifiedDocumentReceiptSession(clientFor(tokenFor(value)), actor)).rejects.toThrow(DocumentReceiptError)
    }
  })
  it('uses fixed parameterised overloads and rejects a substituted receipt result', async () => {
    for (const [name, value] of Object.entries({ ...testEnvironment, BLOCKXONE_DOCUMENT_RECEIPT_DATABASE_URL: testDsn })) vi.stubEnv(name, value)
    const document = { id: '55555555-5555-4555-8555-555555555555', kind: 'IDENTITY' as const, title: 'Fictional identity',
      storage_path: `${actor}/55555555-5555-4555-8555-555555555555`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' as const }
    const result = { ...document, actor_id: actor, validation_state: 'SYNTHETIC_UNSCANNED' }
    database.query.mockResolvedValue({ rows: [{ result }] })
    await registerDocumentReceipt(actor, sessionId, document)
    expect(database.query).toHaveBeenLastCalledWith('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [actor, sessionId, document.id, document.kind, document.title, document.sha256, document.size, document.mime_type])
    const verified = await verifiedDocumentReceiptSession(clientFor(tokenFor(claims())), actor)
    await registerDocumentReceipt(actor, sessionId, document, verified.attestation)
    expect(database.query).toHaveBeenLastCalledWith(
      'select bx1_private.register_document_receipt($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::integer,$8::text,$9::jsonb) as result',
      [actor, sessionId, document.id, document.kind, document.title, document.sha256, document.size, document.mime_type, JSON.stringify(verified.attestation)])
    database.query.mockResolvedValue({ rows: [{ result: { ...result, actor_id: sessionId } }] })
    await expect(registerDocumentReceipt(actor, sessionId, document, verified.attestation)).rejects.toThrow(DocumentReceiptError)
  })
})
