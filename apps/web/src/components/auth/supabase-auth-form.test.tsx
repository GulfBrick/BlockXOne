import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SupabaseAuthForm } from './supabase-auth-form'

describe('Supabase Auth form', () => {
  it('uses a real POST with accessible labels and password-manager hints', () => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="login" initialEmail="person@example.test" />)
    expect(html).toContain('method="post"')
    expect(html).toContain('action="/auth/login"')
    expect(html).toContain('for="bx1-email"')
    expect(html).toContain('id="bx1-email"')
    expect(html).toContain('autoComplete="email"')
    expect(html).toContain('autoComplete="current-password"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('min-h-11')
    expect(html).toContain('value="person@example.test"')
    expect(html).not.toContain('/register')
    expect(html).not.toContain('Investor sign in')
    expect(html).not.toContain('token')
  })
  it('setup has matching-password fields without email or prefilled passwords', () => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="setup" />)
    expect(html).toContain('action="/auth/setup"')
    expect(html).toContain('New password')
    expect(html).toContain('Confirm password')
    expect(html).toContain('name="confirmPassword"')
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2)
    expect(html).not.toContain('name="email"')
    expect(html).not.toContain('value=')
  })
  it('renders fixed generic error copy in a focusable alert', () => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="login" error="invalid_credentials" />)
    expect(html).toContain('Unable to sign in. Check your details and try again.')
    expect(html).toContain('role="alert"')
    expect(html).toContain('tabindex="-1"')
  })
})
