import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { documentReceiptDatabaseConfig, documentReceiptId, DocumentReceiptError } from './document-receipts'

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
