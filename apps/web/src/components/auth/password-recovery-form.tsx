'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PASSWORD_RECOVERY_ERROR_COPY, type PasswordRecoveryError } from '@/lib/supabase/password-recovery'

export function PasswordRecoveryForm({ error }: { error?: PasswordRecoveryError }) {
  const [pending, setPending] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    const restoreForm = (event: PageTransitionEvent) => { if (event.persisted) setPending(false) }
    window.addEventListener('pageshow', restoreForm)
    return () => window.removeEventListener('pageshow', restoreForm)
  }, [])
  return <form method="post" action="/auth/recover" className="mt-5 space-y-5" aria-busy={pending} onSubmit={event => {
    if (pending) { event.preventDefault(); return }
    setPending(true)
  }}>
    {error ? <p id="bx1-recovery-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-bxo-danger-border bg-bxo-danger-soft p-4 text-base text-bxo-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">{PASSWORD_RECOVERY_ERROR_COPY[error]}</p> : null}
    <div>
      <label htmlFor="bx1-recovery-email" className="block text-sm font-semibold text-bxo-text-primary">Email address</label>
      <input id="bx1-recovery-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required aria-invalid={error === 'email-invalid' || undefined} aria-describedby={error ? 'bx1-recovery-error' : undefined} className="mt-2 min-h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-3 text-base text-bxo-text-primary outline-none focus-visible:border-bxo-accent-primary focus-visible:ring-2 focus-visible:ring-bxo-accent-primary" />
    </div>
    <Button type="submit" disabled={pending} className="min-h-11 w-full bg-bxo-accent-primary text-base text-bxo-bg-primary hover:bg-bxo-accent-primary-light focus-visible:ring-bxo-accent-primary">{pending ? 'Requesting reset email…' : 'Send password-reset email'}</Button>
    <p role="status" aria-live="polite" className="min-h-6 text-sm text-bxo-text-secondary">{pending ? 'Requesting your reset email…' : 'This request does not change your password or workspace access.'}</p>
  </form>
}
