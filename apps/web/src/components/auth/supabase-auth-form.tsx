'use client'

import { useRef, useState, useEffect, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { AUTH_ERROR_COPY, type AuthErrorCode } from '@/lib/supabase/contracts'
import { validateSetupPassword } from '@/lib/supabase/password-setup'

type Props = { mode: 'login' | 'setup'; error?: AuthErrorCode; initialEmail?: string }
const inputClass = 'mt-2 min-h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-3 text-base text-bxo-text-primary outline-none focus-visible:border-bxo-accent-primary focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'

type SubmitOptions = {
  setup: boolean
  pending: boolean
  setPending: (pending: boolean) => void
  setError: (error: AuthErrorCode | undefined) => void
}

export function handleAuthFormSubmit(
  event: Pick<FormEvent<HTMLFormElement>, 'currentTarget' | 'preventDefault'>,
  { setup, pending, setPending, setError }: SubmitOptions,
) {
  if (pending) {
    event.preventDefault()
    return
  }
  if (setup) {
    const password = event.currentTarget.elements.namedItem('password') as HTMLInputElement | null
    const confirmation = event.currentTarget.elements.namedItem('confirmPassword') as HTMLInputElement | null
    const validationError = validateSetupPassword(password?.value ?? '', confirmation?.value ?? '')
    if (validationError) {
      event.preventDefault()
      setPending(false)
      setError(validationError)
      if (validationError === 'password_mismatch') confirmation?.focus()
      else password?.focus()
      return
    }
  }
  setError(undefined)
  setPending(true)
}

export function SupabaseAuthForm({ mode, error, initialEmail = '' }: Props) {
  const [pending, setPending] = useState(false)
  const [clientError, setClientError] = useState<AuthErrorCode>()
  const errorRef = useRef<HTMLParagraphElement>(null)
  const setup = mode === 'setup'
  const displayedError = clientError ?? error
  const passwordInvalid = setup && (displayedError === 'password_length' || displayedError === 'password_rejected' || displayedError === 'password_same')
  const confirmationInvalid = setup && displayedError === 'password_mismatch'
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    const restoreForm = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false)
    }
    window.addEventListener('pageshow', restoreForm)
    return () => window.removeEventListener('pageshow', restoreForm)
  }, [])
  return (
    <form method="post" action={setup ? '/auth/setup' : '/auth/login'} className="mt-8 space-y-6" onSubmit={(event) => handleAuthFormSubmit(event, { setup, pending, setPending, setError: setClientError })} aria-busy={pending}>
      {displayedError ? <p id="bx1-auth-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-bxo-danger-border bg-bxo-danger-soft p-4 text-base text-bxo-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">{AUTH_ERROR_COPY[displayedError]}</p> : null}
      {!setup ? (
        <div>
          <label htmlFor="bx1-email" className="block text-sm font-semibold text-bxo-text-primary">Email</label>
          <input id="bx1-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} defaultValue={initialEmail} required className={inputClass} />
        </div>
      ) : null}
      <div>
        <label htmlFor="bx1-password" className="block text-sm font-semibold text-bxo-text-primary">{setup ? 'New password' : 'Password'}</label>
        <input id="bx1-password" name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : 1} maxLength={1024} required className={inputClass} aria-invalid={passwordInvalid || undefined} aria-describedby={setup ? `bx1-password-help${passwordInvalid ? ' bx1-auth-error' : ''}` : undefined} />
        {setup ? <p id="bx1-password-help" className="mt-2 text-sm leading-6 text-bxo-text-secondary">Use at least 12 characters. A unique passphrase is recommended.</p> : null}
      </div>
      {setup ? (
        <div>
          <label htmlFor="bx1-confirm-password" className="block text-sm font-semibold text-bxo-text-primary">Confirm password</label>
          <input id="bx1-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required className={inputClass} aria-invalid={confirmationInvalid || undefined} aria-describedby={`bx1-confirm-password-help${confirmationInvalid ? ' bx1-auth-error' : ''}`} />
          <p id="bx1-confirm-password-help" className="mt-2 text-sm leading-6 text-bxo-text-secondary">Enter exactly the same password again, including any spaces.</p>
        </div>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11 w-full bg-bxo-accent-primary text-base text-bxo-bg-primary hover:bg-bxo-accent-primary-light focus-visible:ring-bxo-accent-primary">
        {pending ? (setup ? 'Saving…' : 'Signing in…') : (setup ? 'Save password' : 'Sign in')}
      </Button>
      <p aria-live="polite" role="status" className="min-h-6 text-sm text-bxo-text-secondary">{pending ? (setup ? 'Saving your password…' : 'Signing in securely…') : 'Access is limited to approved workspace assignments.'}</p>
    </form>
  )
}
