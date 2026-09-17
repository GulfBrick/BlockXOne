import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AUTH_ERROR_COPY } from '@/lib/supabase/contracts'
import { handleAuthFormSubmit, SupabaseAuthForm } from './supabase-auth-form'

function setupSubmission(passwordValue: string, confirmationValue: string) {
  const password = { value: passwordValue, focus: vi.fn() }
  const confirmation = { value: confirmationValue, focus: vi.fn() }
  const event = {
    preventDefault: vi.fn(),
    currentTarget: {
      elements: { namedItem: (name: string) => name === 'password' ? password : name === 'confirmPassword' ? confirmation : null },
    } as unknown as HTMLFormElement,
  }
  const options = { setup: true, pending: false, setPending: vi.fn(), setError: vi.fn() }
  return { password, confirmation, event, options }
}

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
    expect(html).toContain('Enter exactly the same password again, including any spaces.')
    expect(html).toContain('aria-describedby="bx1-confirm-password-help"')
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
  it.each(['password_length', 'password_mismatch', 'password_rejected', 'password_same', 'password_reauthentication', 'setup_request_invalid'] as const)('keeps the setup form editable with fixed %s feedback', (error) => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="setup" error={error} />)
    expect(html).toContain(AUTH_ERROR_COPY[error])
    expect(html).toContain('id="bx1-auth-error"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('action="/auth/setup"')
    expect(html).toContain('Save password')
    expect(html).not.toContain('disabled=')
    expect(html).not.toContain('value=')
    expect(html).not.toContain('Return to sign in')
  })
  it('links mismatch feedback to the confirmation field', () => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="setup" error="password_mismatch" />)
    expect(html).toContain('aria-invalid="true" aria-describedby="bx1-confirm-password-help bx1-auth-error"')
  })
  it('links length feedback to the password field', () => {
    const html = renderToStaticMarkup(<SupabaseAuthForm mode="setup" error="password_length" />)
    expect(html).toContain('aria-invalid="true" aria-describedby="bx1-password-help bx1-auth-error"')
  })
  it('blocks mismatched passwords without disabling the form and focuses confirmation', () => {
    const { event, options, password, confirmation } = setupSubmission('test-only-passphrase', 'different-passphrase')
    handleAuthFormSubmit(event, options)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(options.setError).toHaveBeenCalledWith('password_mismatch')
    expect(options.setPending).toHaveBeenCalledExactlyOnceWith(false)
    expect(confirmation.focus).toHaveBeenCalledOnce()
    expect(password.focus).not.toHaveBeenCalled()
  })
  it.each(['too-short', 'x'.repeat(1025)])('blocks invalid password length without entering pending', (value) => {
    const { event, options, password, confirmation } = setupSubmission(value, value)
    handleAuthFormSubmit(event, options)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(options.setError).toHaveBeenCalledWith('password_length')
    expect(options.setPending).toHaveBeenCalledExactlyOnceWith(false)
    expect(password.focus).toHaveBeenCalledOnce()
    expect(confirmation.focus).not.toHaveBeenCalled()
  })
  it('allows correction and native POST without trimming or retaining password values', () => {
    const { event, options, password, confirmation } = setupSubmission(' test-only-passphrase ', 'test-only-passphrase')
    handleAuthFormSubmit(event, options)
    expect(options.setError).toHaveBeenLastCalledWith('password_mismatch')
    confirmation.value = password.value
    event.preventDefault.mockClear()
    handleAuthFormSubmit(event, options)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(options.setError).toHaveBeenLastCalledWith(undefined)
    expect(options.setPending).toHaveBeenLastCalledWith(true)
    expect(password.value).toBe(' test-only-passphrase ')
    expect(confirmation.value).toBe(password.value)
  })
  it('does not apply setup password requirements to ordinary sign-in', () => {
    const { event, options } = setupSubmission('existing', '')
    handleAuthFormSubmit(event, { ...options, setup: false })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(options.setError).toHaveBeenCalledWith(undefined)
    expect(options.setPending).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('blocks duplicate submission while already pending', () => {
    const { event, options } = setupSubmission('test-only-passphrase', 'test-only-passphrase')
    handleAuthFormSubmit(event, { ...options, pending: true })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(options.setError).not.toHaveBeenCalled()
    expect(options.setPending).not.toHaveBeenCalled()
  })
})
