import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
import ForgotPasswordPage, { generateMetadata } from './page'

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://testnet.bx1.co.za')
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_ENVIRONMENT', 'TESTNET')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE', 'TESTNET')
})
afterEach(() => vi.unstubAllEnvs())

describe('self-service password recovery page', () => {
  it('offers one email field and the existing server recovery action, not password entry', async () => {
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Reset your password')
    expect(html).toContain('action="/auth/recover"')
    expect(html).toContain('type="email"')
    expect(html).toContain('name="email"')
    expect(html).not.toContain('type="password"')
    expect(html).toContain('Send password-reset email')
    expect(html).toContain('href="/login"')
  })
  it('uses generic check-email copy without asserting that an address has an account', async () => {
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ status: 'check-email' }) }))
    expect(html).toContain('Check your email')
    expect(html).toContain('If an account exists for that address')
    expect(html).not.toContain('action="/auth/recover"')
    expect(html).not.toContain('type="password"')
    expect(html).toContain('Never share the link or your password')
  })
  it.each(['email-invalid', 'invalid-request', 'unavailable', 'rate-limited'])('keeps %s actionable without displaying provider text', async error => {
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ error }) }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('action="/auth/recover"')
    expect(html).not.toContain('private-provider-message')
  })
  it.each([{ error: '<script>private-provider-message</script>' }, { error: ['unavailable', 'email-invalid'] }, { status: ['check-email', 'check-email'] }])('does not trust malformed presentation state %j', async params => {
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve(params) }))
    expect(html).not.toContain('private-provider-message')
    expect(html).toContain('action="/auth/recover"')
  })
  it('keeps recovery unavailable when the paired auth configuration is broken', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ status: 'check-email' }) }))
    expect(html).toContain('Password recovery is temporarily unavailable')
    expect(html).not.toContain('action="/auth/recover"')
    expect(html).not.toContain('If an account exists')
  })
  it('does not offer a form for a mismatched environment and project', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    const html = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Password recovery is temporarily unavailable')
    expect(html).not.toContain('action="/auth/recover"')
  })
  it('preserves native same-origin form submissions while keeping secret-bearing query state private', async () => {
    for (const params of [{}, { error: 'unavailable' }, { status: 'check-email' }]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve(params) })
      expect(metadata.referrer).toBe('strict-origin')
      expect(metadata.robots).toEqual({ index: false, follow: false })
    }
    expect((await generateMetadata({ searchParams: Promise.resolve({ token_hash: 'private-token' }) })).referrer).toBe('no-referrer')
  })
})
