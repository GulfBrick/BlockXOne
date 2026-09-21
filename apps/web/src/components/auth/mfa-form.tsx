'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { MFA_ENROLL_QR_MAX_CHARACTERS, MFA_ENROLL_RESPONSE_MAX_BYTES, MFA_RESPONSE_MAX_BYTES, type MfaContinuation, type MfaErrorCode, type MfaView } from '@/lib/supabase/mfa-contracts'

type SetupMaterial = { factorId: string; qrCode: string; secret: string }
export type MfaFormState = {
  pending: boolean
  reloadRequired: boolean
  error?: MfaErrorCode
  setup?: SetupMaterial
}
type ControllerOptions = {
  view: MfaView
  continuation: MfaContinuation
  post: (path: string, body: URLSearchParams, signal: AbortSignal) => Promise<unknown>
  navigate: (path: string) => void
  onChange: (state: MfaFormState) => void
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const initialState = (): MfaFormState => ({ pending: false, reloadRequired: false })
const nextPaths = new Set(['/portal', '/workspace', '/login?setup=1', '/workspace/security'])
const errors: Record<MfaErrorCode, string> = {
  invalid_request: 'Unable to verify that code. Check your authenticator and try again.',
  unauthorised: 'Sign in again to continue.',
  invalid_code: 'Unable to verify that code. Check your authenticator and try again.',
  rate_limited: 'Too many attempts. Wait before trying again.',
  unavailable: 'Verification is temporarily unavailable. Reload before trying again.',
  pending_setup_exists: 'Authenticator setup is already in progress.',
  already_enrolled: 'An authenticator is already enabled. Reload to continue.',
  unsupported_factor: 'This account requires a verification method not supported on this screen. Contact support.',
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Only ephemeral UI state. Server handlers independently authenticate every
// request and never trust this controller's view, selectors or progress.
export function createMfaFormController(options: ControllerOptions) {
  let state = initialState()
  let generation = 0
  let active = true
  let abort: AbortController | undefined
  const emit = (next: MfaFormState) => { state = next; if (active) options.onChange(next) }
  const failUnknown = () => emit({ pending: false, reloadRequired: true, error: 'unavailable' })
  const allowedFactor = (id: string) => {
    if (options.continuation === 'security' && state.setup?.factorId === id) return true
    return options.view.factors.some(factor => factor.id === id && factor.factorType === 'totp'
      && (factor.status === 'verified' || (options.continuation === 'security' && options.view.state === 'unenrolled' && factor.status === 'unverified')))
  }
  async function submit(path: string, body: URLSearchParams, enrollment: boolean) {
    if (!active || state.pending || state.reloadRequired) return
    const attempt = ++generation
    abort = new AbortController()
    emit({ ...state, pending: true, error: undefined })
    try {
      const result = await options.post(path, body, abort.signal)
      if (!active || attempt !== generation) return
      if (!record(result)) { failUnknown(); return }
      if (result.ok === false) {
        const error = typeof result.error === 'string' && Object.hasOwn(errors, result.error) ? result.error as MfaErrorCode : 'unavailable'
        const retryable = error === 'invalid_code' || error === 'rate_limited'
        emit({ ...(retryable ? state : {}), pending: false, reloadRequired: !retryable, error })
        return
      }
      if (result.ok !== true) { failUnknown(); return }
      if (enrollment) {
        if (typeof result.factorId !== 'string' || !uuid.test(result.factorId)
          || typeof result.secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(result.secret)
          || typeof result.qrCode !== 'string' || result.qrCode.length > MFA_ENROLL_QR_MAX_CHARACTERS
          || !result.qrCode.startsWith('data:image/svg+xml;utf-8,')) { failUnknown(); return }
        emit({ pending: false, reloadRequired: false, setup: { factorId: result.factorId, secret: result.secret, qrCode: result.qrCode } })
      } else {
        if (typeof result.next !== 'string' || !nextPaths.has(result.next)) { failUnknown(); return }
        emit({ pending: false, reloadRequired: true })
        options.navigate(result.next)
      }
    } catch {
      if (active && attempt === generation) failUnknown()
    }
  }
  return {
    getState: () => state,
    enroll: async () => {
      if (options.continuation !== 'security' || options.view.state !== 'unenrolled' || options.view.hasPendingTotp || options.view.factors.length || state.setup) return
      await submit('/auth/mfa-enroll', new URLSearchParams(), true)
    },
    verify: async (factorId: string, code: string) => {
      if (!active || state.pending || state.reloadRequired) return
      if (!uuid.test(factorId) || !allowedFactor(factorId)) { emit({ ...state, error: 'invalid_request' }); return }
      if (!/^[0-9]{6}$/.test(code)) { emit({ ...state, error: 'invalid_code' }); return }
      await submit('/auth/mfa-verify', new URLSearchParams({ factorId, code, continuation: options.continuation }), false)
    },
    clear: () => {
      ++generation; abort?.abort()
      emit({ pending: false, reloadRequired: true })
    },
    dispose: () => {
      active = false; ++generation; abort?.abort(); state = initialState()
    },
  }
}

async function post(path: string, body: URLSearchParams, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal })
  return readMfaResponse(response, path === '/auth/mfa-enroll')
}

export async function readMfaResponse(response: Response, enrollment = false): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('unavailable')
  // Bound even error responses; never put provider HTML/messages into the UI.
  const maximumBytes = enrollment && response.ok ? MFA_ENROLL_RESPONSE_MAX_BYTES : MFA_RESPONSE_MAX_BYTES
  const reader = response.body?.getReader()
  if (!reader) throw new Error('unavailable')
  let text = ''
  let size = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maximumBytes) { await reader.cancel(); throw new Error('unavailable') }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const result: unknown = JSON.parse(text)
    if (!record(result) || (result.ok === true && !response.ok)) throw new Error('unavailable')
    return result
  } finally { reader.releaseLock() }
}

const inputClass = 'mt-2 min-h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-3 text-base text-bxo-text-primary outline-none focus-visible:border-bxo-accent-primary focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'

export function registerMfaPageLifecycle(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, clear: () => void, restore: () => void) {
  const show = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) { clear(); restore() }
  }
  target.addEventListener('pagehide', clear)
  target.addEventListener('pageshow', show)
  return () => { target.removeEventListener('pagehide', clear); target.removeEventListener('pageshow', show) }
}

// React calls the stable callback on attachment, replacement and detachment,
// including when enrollment creates the input after the effect first ran.
export function createMfaCodeInputRef() {
  let current: Pick<HTMLInputElement, 'value'> | null = null
  return {
    attach: (node: Pick<HTMLInputElement, 'value'> | null) => {
      if (current && current !== node) current.value = ''
      current = node
    },
    clear: () => { if (current) current.value = '' },
  }
}

export function MfaForm({ view, continuation }: { view: MfaView; continuation: MfaContinuation }) {
  const [state, setState] = useState<MfaFormState>(initialState)
  const controller = useRef<ReturnType<typeof createMfaFormController> | null>(null)
  const [codeInput] = useState(createMfaCodeInputRef)
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    setState(initialState())
    const value = createMfaFormController({ view, continuation, post, navigate: path => { window.location.replace(path) }, onChange: setState })
    controller.current = value
    // Remove setup material from the DOM before the browser can retain a BFcache
    // snapshot; asynchronous responses are invalidated by the same clear call.
    const clear = () => { codeInput.clear(); flushSync(() => value.clear()) }
    const removeLifecycle = registerMfaPageLifecycle(window, clear, () => window.location.reload())
    return () => {
      codeInput.clear()
      value.dispose(); controller.current = null
      removeLifecycle()
    }
  }, [view, continuation, codeInput])
  useEffect(() => { if (state.error) alert.current?.focus() }, [state.error])

  const factors = state.setup ? [{ id: state.setup.factorId, status: 'unverified' as const, factorType: 'totp' as const }]
    : view.factors.filter(factor => factor.status === 'verified' || (continuation === 'security' && view.state === 'unenrolled'))
  const canEnroll = continuation === 'security' && view.state === 'unenrolled' && !view.hasPendingTotp && !view.factors.length && !state.setup
  const unsupported = view.state === 'unsupported_factor' || (view.state === 'verified' && !factors.length)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const code = values.get('code')
    const id = values.get('factorId')
    codeInput.clear()
    if (typeof code === 'string' && typeof id === 'string') void controller.current?.verify(id, code)
  }
  return <section className="mt-8 space-y-6" aria-label="Authenticator verification">
    {view.state === 'verified' ? <p className="text-base text-bxo-text-primary">Authenticator enabled. Additional verification may be required for sensitive actions.</p> : null}
    {unsupported ? <p role="alert" className="text-base text-bxo-text-secondary">{errors.unsupported_factor}</p> : null}
    {view.hasPendingTotp && !state.setup && view.state === 'unenrolled' ? <div className="text-base leading-7 text-bxo-text-secondary"><p>Authenticator setup is unfinished.</p><p className="mt-2">If you no longer have this setup in your authenticator, contact support before starting again.</p></div> : null}
    {state.error ? <p ref={alert} tabIndex={-1} role="alert" className="rounded-lg border border-bxo-danger-border bg-bxo-danger-soft p-4 text-base text-bxo-text-primary outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">{errors[state.error]}</p> : null}
    {canEnroll && !unsupported ? <div className="space-y-4"><p className="text-base leading-7 text-bxo-text-secondary">Add an authenticator app to protect your sign-in.</p><p className="text-sm leading-6 text-bxo-text-secondary">After setup is verified, future sign-ins require your authenticator code. This does not enable financial or token operations.</p><Button type="button" disabled={state.pending || state.reloadRequired} onClick={() => void controller.current?.enroll()} className="min-h-11">{state.pending ? 'Setting up...' : 'Set up authenticator'}</Button></div> : null}
    {state.setup ? <div className="space-y-4 rounded-lg border border-bxo-border-default p-4">
      <Image src={state.setup.qrCode} alt="Authenticator setup QR code" width={240} height={240} unoptimized className="h-auto max-w-full bg-white" />
      <p className="text-sm font-semibold text-bxo-text-primary">Setup key</p><p className="break-all font-mono text-base text-bxo-text-primary">{state.setup.secret}</p>
      <p className="text-sm leading-6 text-bxo-text-secondary">Keep this setup key private. It is shown only during this setup.</p>
    </div> : null}
    {!unsupported && factors.length ? <form method="post" action="/auth/mfa-verify" onSubmit={submit} aria-busy={state.pending} className="space-y-6">
      <input type="hidden" name="continuation" value={continuation} />
      {factors.length > 1 ? <div><label htmlFor="bx1-mfa-factor" className="block text-sm font-semibold text-bxo-text-primary">Authenticator</label><select id="bx1-mfa-factor" name="factorId" className={inputClass} disabled={state.pending || state.reloadRequired}>{factors.map((factor, index) => <option key={factor.id} value={factor.id}>Authenticator {index + 1}</option>)}</select></div> : <input type="hidden" name="factorId" value={factors[0].id} />}
      <div><label htmlFor="bx1-mfa-code" className="block text-sm font-semibold text-bxo-text-primary">Authentication code</label><input ref={codeInput.attach} id="bx1-mfa-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} minLength={6} required spellCheck={false} disabled={state.pending || state.reloadRequired} className={inputClass} /></div>
      <Button type="submit" disabled={state.pending || state.reloadRequired} className="min-h-11 w-full">{state.pending ? 'Verifying...' : state.setup ? 'Verify setup' : view.hasPendingTotp && view.state === 'unenrolled' ? 'Verify existing setup' : view.state === 'verified' ? 'Verify a new code' : 'Verify code'}</Button>
    </form> : null}
    <p role="status" aria-live="polite" className="min-h-6 text-sm text-bxo-text-secondary">{state.pending ? 'Verification in progress...' : state.reloadRequired ? 'Reload before continuing.' : 'Your authenticator code is never a wallet signature.'}</p>
    {state.reloadRequired ? <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>Reload</Button> : null}
  </section>
}
