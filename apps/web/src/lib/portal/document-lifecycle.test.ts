import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { DocumentLifecycleError, documentScannerConfig, documentScannerDatabaseConfig,
  verifyScannerMessage } from './document-lifecycle'

const env = {
  BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
  SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co',
  BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', VERCEL_ENV: 'preview',
  BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: `sb_secret_${'A'.repeat(32)}`,
  BLOCKXONE_DOCUMENT_SCANNER_ID: 'synthetic_adapter',
  BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL: 'postgresql://bx1_document_scanner_writer.fegnnnlseuejkrusbbkv:synthetic-only@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',
}

describe('independent document scanner boundary', () => {
  it('requires scanner key, Storage secret and a distinct project-bound scanner result role', () => {
    const config = documentScannerConfig(env)
    expect(config.scannerId).toBe('synthetic_adapter')
    expect(documentScannerDatabaseConfig(env).user).toBe('bx1_document_scanner_writer.fegnnnlseuejkrusbbkv')
    expect(() => documentScannerConfig({ ...env, BLOCKXONE_DOCUMENT_SCANNER_HMAC_KEY: undefined })).toThrow(DocumentLifecycleError)
    expect(() => documentScannerConfig({ ...env, BLOCKXONE_DOCUMENT_STORAGE_SECRET_KEY: undefined })).toThrow(DocumentLifecycleError)
    expect(() => documentScannerConfig({ ...env, BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL:
      env.BLOCKXONE_DOCUMENT_SCANNER_DATABASE_URL.replace('bx1_document_scanner_writer.', 'bx1_document_receipt_writer.') })).toThrow(DocumentLifecycleError)
    expect(() => documentScannerConfig({ ...env, SUPABASE_URL: 'https://oqkevkjbkpugjotihtda.supabase.co' })).toThrow(DocumentLifecycleError)
  })
  it('accepts only a fresh raw-body HMAC and rejects forged, expired and malformed clean claims', () => {
    const config = documentScannerConfig(env)
    const now = 1_800_000_000_000
    const timestamp = String(Math.floor(now / 1000))
    const body = Buffer.from(JSON.stringify({ document_id: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64), verdict: 'CLEAN', reference: 'synthetic-ref-1',
      observed_at: '2026-09-24T11:00:00Z' }))
    const signature = `sha256=${createHmac('sha256', config.signingKey).update(timestamp).update('.').update(body).digest('hex')}`
    expect(verifyScannerMessage(body, timestamp, signature, config, now).verdict).toBe('CLEAN')
    expect(() => verifyScannerMessage(body, timestamp, `sha256=${'0'.repeat(64)}`, config, now)).toThrow(DocumentLifecycleError)
    expect(() => verifyScannerMessage(body, timestamp, signature, config, now + 300_001)).toThrow(DocumentLifecycleError)
    expect(() => verifyScannerMessage(Buffer.from('{}'), timestamp, signature, config, now)).toThrow(DocumentLifecycleError)
    const extra = Buffer.from(body.toString().replace('"CLEAN"', '"UNKNOWN"'))
    const extraSignature = `sha256=${createHmac('sha256', config.signingKey).update(timestamp).update('.').update(extra).digest('hex')}`
    expect(() => verifyScannerMessage(extra, timestamp, extraSignature, config, now)).toThrow(DocumentLifecycleError)
  })
})
