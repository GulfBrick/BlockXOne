'use client'

import { useRef, useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AUTH_ERROR_COPY, type AuthErrorCode } from '@/lib/supabase/contracts'

type Props = { mode: 'login' | 'setup'; error?: AuthErrorCode; initialEmail?: string }
const inputClass = 'mt-2 min-h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-3 text-base text-bxo-text-primary outline-none focus-visible:border-bxo-accent-primary focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'

export function SupabaseAuthForm({ mode, error, initialEmail = '' }: Props) {
  const [pending, setPending] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const setup = mode === 'setup'
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  return (
    <form method="post" action={setup ? '/auth/setup' : '/auth/login'} className="mt-8 space-y-6" onSubmit={() => setPending(true)} aria-busy={pending}>
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-bxo-danger-border bg-bxo-danger-soft p-4 text-base text-bxo-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">{AUTH_ERROR_COPY[error]}</p> : null}
      {!setup ? (
        <div>
          <label htmlFor="bx1-email" className="block text-sm font-semibold text-bxo-text-primary">Email</label>
          <input id="bx1-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} defaultValue={initialEmail} required className={inputClass} />
        </div>
      ) : null}
      <div>
        <label htmlFor="bx1-password" className="block text-sm font-semibold text-bxo-text-primary">{setup ? 'New password' : 'Password'}</label>
        <input id="bx1-password" name="password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : 1} maxLength={1024} required className={inputClass} aria-describedby={setup ? 'bx1-password-help' : undefined} />
        {setup ? <p id="bx1-password-help" className="mt-2 text-sm leading-6 text-bxo-text-secondary">Use at least 12 characters. A unique passphrase is recommended.</p> : null}
      </div>
      {setup ? (
        <div>
          <label htmlFor="bx1-confirm-password" className="block text-sm font-semibold text-bxo-text-primary">Confirm password</label>
          <input id="bx1-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required className={inputClass} />
        </div>
      ) : null}
      <Button type="submit" disabled={pending} className="min-h-11 w-full bg-bxo-accent-primary text-base text-bxo-bg-primary hover:bg-bxo-accent-primary-light focus-visible:ring-bxo-accent-primary">
        {pending ? (setup ? 'Saving…' : 'Signing in…') : (setup ? 'Save password' : 'Sign in')}
      </Button>
      <p aria-live="polite" role="status" className="min-h-6 text-sm text-bxo-text-secondary">{pending ? (setup ? 'Saving your password…' : 'Signing in securely…') : 'Access is limited to approved workspace assignments.'}</p>
    </form>
  )
}
