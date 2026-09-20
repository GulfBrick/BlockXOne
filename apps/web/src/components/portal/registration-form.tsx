'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, BriefcaseBusiness, ChartNoAxesCombined, Eye, EyeOff } from 'lucide-react'
import { REGISTRATION_ERRORS, validateRegistrationForm, type RegistrationError, type RegistrationIntent } from '@/lib/portal/registration'

const inputClass = 'mt-2 min-h-12 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-4 py-3 text-base text-bxo-text-primary outline-none transition-colors focus-visible:border-bxo-accent-primary focus-visible:ring-2 focus-visible:ring-bxo-accent-primary disabled:opacity-60'
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary'
const errorFields: Partial<Record<RegistrationError, string>> = { email_invalid: 'email', intent_required: 'intent', password_length: 'password', password_mismatch: 'confirmPassword', password_rejected: 'password', consent_required: 'consent' }

export function RegistrationForm({ initialIntent, error }: { initialIntent?: RegistrationIntent; error?: RegistrationError }) {
  const [intent, setIntent] = useState<RegistrationIntent | undefined>(initialIntent)
  const [pending, setPending] = useState(false)
  const [visible, setVisible] = useState(false)
  const [clientError, setClientError] = useState<RegistrationError>()
  const errorRef = useRef<HTMLParagraphElement>(null)
  const displayedError = clientError ?? error
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setPending(false) }
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])
  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) { event.preventDefault(); return }
    const fields = new URLSearchParams()
    new FormData(event.currentTarget).forEach((value, key) => { if (typeof value === 'string') fields.append(key, value) })
    const result = validateRegistrationForm(fields)
    if (!result.ok) {
      event.preventDefault()
      setClientError(result.error)
      const name = errorFields[result.error]
      if (name) event.currentTarget.querySelector<HTMLElement>(`[name="${name}"]`)?.focus()
      else errorRef.current?.focus()
      return
    }
    setClientError(undefined)
    setPending(true)
  }
  const invalid = (name: string) => displayedError !== undefined && errorFields[displayedError] === name
  return <form action="/auth/register" method="post" onSubmit={submit} aria-busy={pending} className="space-y-7">
    {displayedError ? <p id="registration-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm leading-6 text-bxo-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">{REGISTRATION_ERRORS[displayedError]}</p> : null}
    <fieldset aria-describedby={invalid('intent') ? 'registration-error registration-path-help' : 'registration-path-help'} className="min-w-0">
      <legend className="text-sm font-semibold text-bxo-text-primary">How will you use BlockXOne? <span className="text-bxo-text-secondary">Required</span></legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {([{ value: 'investor', title: 'Investor', text: 'Explore opportunities and apply to invest.', Icon: ChartNoAxesCombined }, { value: 'wealth-manager', title: 'Wealth manager', text: 'Apply to structure and manage offerings.', Icon: BriefcaseBusiness }] as const).map(({ value, title, text, Icon }) => <label key={value} className={`relative flex min-h-36 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-bxo-accent-primary ${intent === value ? 'border-bxo-accent-primary bg-bxo-accent-soft' : 'border-bxo-border-default bg-bxo-bg-primary hover:border-bxo-accent-border'}`}>
          <input className="mt-1 h-4 w-4 shrink-0 accent-cyan-400" type="radio" name="intent" value={value} checked={intent === value} onChange={() => setIntent(value)} required aria-describedby={invalid('intent') ? 'registration-error' : undefined} />
          <span><Icon aria-hidden="true" className="mb-3 h-5 w-5 text-bxo-accent-primary" /><span className="block text-base font-semibold text-bxo-text-primary">{title}</span><span className="mt-1 block text-sm leading-6 text-bxo-text-secondary">{text}</span></span>
        </label>)}
      </div>
      <p id="registration-path-help" className="mt-3 text-sm leading-6 text-bxo-text-secondary">This starts your application. It does not grant investment approval, organisation access or signing authority.</p>
    </fieldset>
    <div>
      <label htmlFor="registration-email" className="block text-sm font-semibold text-bxo-text-primary">Email address</label>
      <input id="registration-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} readOnly={pending} required className={inputClass} aria-invalid={invalid('email') || undefined} aria-describedby={invalid('email') ? 'registration-error registration-email-help' : 'registration-email-help'} />
      <p id="registration-email-help" className="mt-2 text-sm leading-6 text-bxo-text-secondary">Use an address you can access. You will need to confirm it before continuing.</p>
    </div>
    <div>
      <label htmlFor="registration-password" className="block text-sm font-semibold text-bxo-text-primary">Create password</label>
      <div className="relative"><input id="registration-password" name="password" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={1024} readOnly={pending} required className={`${inputClass} pr-16`} aria-invalid={invalid('password') || undefined} aria-describedby={invalid('password') ? 'registration-error registration-password-help' : 'registration-password-help'} /><button type="button" disabled={pending} onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide passwords' : 'Show passwords'} aria-pressed={visible} className={`absolute right-1 top-3 flex h-11 w-11 items-center justify-center rounded-md text-bxo-text-secondary hover:text-bxo-accent-primary ${focusClass}`}>{visible ? <EyeOff aria-hidden="true" className="h-5 w-5" /> : <Eye aria-hidden="true" className="h-5 w-5" />}</button></div>
      <p id="registration-password-help" className="mt-2 text-sm leading-6 text-bxo-text-secondary">At least 12 characters. Use a unique passphrase, not your wallet recovery phrase.</p>
    </div>
    <div>
      <label htmlFor="registration-confirm" className="block text-sm font-semibold text-bxo-text-primary">Confirm password</label>
      <input id="registration-confirm" name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={1024} readOnly={pending} required className={inputClass} aria-invalid={invalid('confirmPassword') || undefined} aria-describedby={invalid('confirmPassword') ? 'registration-error' : undefined} />
    </div>
    <div className="rounded-xl border border-bxo-border-subtle bg-bxo-bg-primary p-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-bxo-text-secondary"><input type="checkbox" name="consent" value="accepted" required className="mt-1 h-5 w-5 shrink-0 accent-cyan-400 focus-visible:ring-2 focus-visible:ring-bxo-accent-primary" aria-invalid={invalid('consent') || undefined} aria-describedby={invalid('consent') ? 'registration-error' : undefined} /><span>I have read and accept the <a href="#testnet-terms" className="text-bxo-accent-primary underline underline-offset-4">testnet terms</a> and <a href="#registration-privacy" className="text-bxo-accent-primary underline underline-offset-4">registration privacy notice</a>. I understand this is a test environment.</span></label>
    </div>
    <button type="submit" disabled={pending} className={`flex min-h-12 w-full cursor-pointer items-center justify-between gap-4 rounded-lg bg-bxo-accent-primary px-5 py-3 text-base font-semibold text-bxo-bg-primary transition-colors hover:bg-bxo-accent-primary-light disabled:cursor-wait disabled:opacity-60 ${focusClass}`}>{pending ? 'Creating your account…' : 'Create account'}<ArrowRight aria-hidden="true" className="h-5 w-5" /></button>
    <p role="status" aria-live="polite" className="min-h-6 text-sm leading-6 text-bxo-text-secondary">{pending ? 'Submitting securely. Please wait before making another request.' : <>Already registered? <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-bxo-accent-primary underline-offset-4 hover:underline">Sign in</Link></>}</p>
  </form>
}
