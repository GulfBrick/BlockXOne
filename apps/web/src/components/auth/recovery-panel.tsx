'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { gatedRecovery, parseRecoveryIntent, parseRecoveryResult, type RecoveryAction, type RecoveryCaseView, type RecoveryError, type RecoveryIntent, type RecoveryReadProjection, type RecoveryResult, type RecoveryState } from '@/lib/recovery/contracts'

export const RECOVERY_STATE_LABELS: Record<RecoveryState, string> = {
  REQUESTED: 'Request recorded', PENDING_REVIEW: 'Awaiting independent review', APPROVED: 'Approved: not applied', QUARANTINED: 'Contained: business access held', REJECTED: 'Rejected', EXPIRED: 'Expired', INVALIDATED: 'No longer valid',
}
export const RECOVERY_UNKNOWN = 'The outcome is unconfirmed. Do not create a replacement request. Check the recorded case and audit history; a missing record or an unchanged screen does not prove no effect.'
export const RECOVERY_MEMORY_NOTICE = 'Refreshing status here keeps the original request in memory. Leaving or reloading this page loses that request key; reconcile the recorded case and audit history before starting another action.'
const section = 'min-w-0 rounded-xl border border-bxo-border-subtle bg-bxo-surface p-4 sm:p-6'
const primary = 'min-h-11 bg-bxo-accent-primary text-bxo-bg hover:bg-bxo-accent-primary/90 focus-visible:ring-bxo-accent-primary'
const link = 'inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'
const errors: Record<RecoveryError, string> = {
  invalid_request: 'The request was not accepted. Check the current case before preparing another action.',
  unauthorised: 'Your session is no longer active. Sign in again to read your recorded status.',
  forbidden: 'You do not currently have authority for this action. Check recorded status.',
  step_up_required: 'A fresh authenticator code is required for this operator action. Verify your sign-in, then return to this case.',
  conflict: 'The case, target or authority has changed. Check the recorded case and audit history.',
  expired: 'The recovery request has expired. Check its recorded status before continuing.',
  unavailable: RECOVERY_UNKNOWN,
}
export function recoveryBinding(view: RecoveryReadProjection): string | null {
  return view.availability === 'ready' && view.caller ? `${view.caller.principalId}:${view.caller.personId}` : null
}
export function permittedRecoveryActions(item: RecoveryCaseView, view: RecoveryReadProjection): RecoveryAction[] {
  if (!view.caller || view.availability !== 'ready' || view.held || item.isOwn || item.targetPersonId === view.caller.personId || item.requiresStepUp) return []
  const person = view.caller.personId
  return item.allowedActions.filter(action => {
    if (action === 'propose') return item.state === 'REQUESTED'
    if (action === 'approve' || action === 'reject') return item.state === 'PENDING_REVIEW' && item.proposedByPersonId !== null && item.proposedByPersonId !== person
    return item.state === 'APPROVED' && item.reviewedByPersonId !== null && item.reviewedByPersonId !== item.proposedByPersonId && (person === item.proposedByPersonId || person === item.reviewedByPersonId)
  })
}
function permittedIntent(intent: RecoveryIntent, view: RecoveryReadProjection): boolean {
  if (!recoveryBinding(view) || view.held) return false
  if (intent.intent === 'request') return view.canRequest
  const item = view.selectedCase?.caseId === intent.caseId ? view.selectedCase : view.cases.find(candidate => candidate.caseId === intent.caseId)
  const action = intent.intent === 'review' ? intent.decision : intent.intent
  return Boolean(item && item.revision === intent.expectedRevision && permittedRecoveryActions(item, view).includes(action))
}
type CommandState = { phase: 'idle' | 'pending' | 'unknown' | 'confirmed' | 'denied' | 'stale'; result: RecoveryResult | null; refreshing: boolean }
type Dependencies = { post: (body: URLSearchParams, signal: AbortSignal) => Promise<unknown>; refresh: () => void; onChange: (state: CommandState) => void }
const initialState = (): CommandState => ({ phase: 'idle', result: null, refreshing: false })

// Volatile intent is not a durable receipt. Unknown outcomes never auto-retry.
export function createRecoveryController(initial: RecoveryReadProjection, dependencies: Dependencies) {
  let view = initial, binding = recoveryBinding(initial), state = initialState()
  let original: RecoveryIntent | null = null, abort: AbortController | null = null
  let generation = 0, disposed = false
  const emit = (next: CommandState) => { state = next; dependencies.onChange({ ...next }) }
  const invalidate = () => {
    generation += 1; abort?.abort(); abort = null; original = null; binding = null; view = gatedRecovery('unavailable')
    emit({ ...initialState(), phase: 'stale' })
  }
  return {
    getState: () => ({ ...state }),
    matches: (candidate: RecoveryReadProjection) => binding !== null && binding === recoveryBinding(candidate),
    update(candidate: RecoveryReadProjection) {
      if (disposed) return
      const nextBinding = recoveryBinding(candidate)
      const changed = nextBinding !== binding
      // A gated read does not prove that the caller changed, or that an
      // in-flight/unknown command had no effect. Hide the projection while
      // retaining the original binding, key/body and uncertainty latch.
      if (!nextBinding && (state.phase === 'unknown' || state.phase === 'pending')) {
        view = candidate
        emit({ ...state, refreshing: false })
        return
      }
      if (!nextBinding || (binding && changed)) invalidate()
      view = candidate; binding = nextBinding
      if (state.phase === 'stale' && nextBinding) emit(initialState())
      else if (state.refreshing) emit({ ...state, refreshing: false })
      else if (changed) emit({ ...state })
    },
    async submit(candidate: RecoveryIntent) {
      if (disposed || state.phase === 'pending' || state.phase === 'unknown' || state.refreshing) return
      const parsed = parseRecoveryIntent(candidate)
      if (!parsed || !permittedIntent(parsed, view)) return
      original = Object.freeze({ ...parsed })
      const frozen = original, ticket = ++generation, controller = new AbortController()
      abort = controller
      emit({ ...initialState(), phase: 'pending' })
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      try {
        const deadline = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error('Unavailable'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => controller.abort(), 15_000)
        })
        const body = new URLSearchParams()
        for (const [key, value] of Object.entries(frozen)) body.set(key, value)
        const raw = await Promise.race([dependencies.post(body, controller.signal), deadline])
        if (disposed || generation !== ticket || controller.signal.aborted) return
        const result = parseRecoveryResult(raw)
        const expectedState = frozen.intent === 'request' ? 'REQUESTED' : frozen.intent === 'propose' ? 'PENDING_REVIEW' : frozen.intent === 'review' ? (frozen.decision === 'approve' ? 'APPROVED' : 'REJECTED') : 'QUARANTINED'
        const expectedRevision = frozen.intent === 'request' ? '1' : String(BigInt(frozen.expectedRevision) + 1n)
        if (!result || (!result.ok && result.error === 'unavailable') || (result.ok && (result.state !== expectedState || result.revision !== expectedRevision || (frozen.intent !== 'request' && result.caseId !== frozen.caseId)))) {
          emit({ ...initialState(), phase: 'unknown' }); return
        }
        original = null
        emit({ phase: result.ok ? 'confirmed' : 'denied', result, refreshing: true })
        dependencies.refresh()
      } catch {
        if (!disposed && generation === ticket) emit({ ...initialState(), phase: 'unknown' })
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        if (onAbort) controller.signal.removeEventListener('abort', onAbort)
        if (generation === ticket) abort = null
      }
    },
    checkRecordedStatus() {
      if (disposed || state.phase === 'pending' || state.refreshing) return
      emit({ ...state, refreshing: true }); dependencies.refresh()
    },
    invalidate,
    dispose() { invalidate(); disposed = true },
  }
}

export async function postRecovery(body: URLSearchParams, signal: AbortSignal): Promise<RecoveryResult> {
  const response = await fetch('/auth/recovery-command', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' }, body, signal })
  if (signal.aborted || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) throw new Error('Unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const chunk = await reader.read()
      if (signal.aborted) throw new Error('Unavailable')
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 16_384) throw new Error('Unavailable')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const result = parseRecoveryResult(JSON.parse(text))
    if (!result || (result.ok && !response.ok)) throw new Error('Unavailable')
    return result
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => undefined); reader.releaseLock() }
}

export function registerRecoveryPageLifecycle(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, clear: () => void, restore: () => void) {
  const hide = () => flushSync(clear)
  const show = (event: Event) => { if ((event as PageTransitionEvent).persisted) { hide(); restore() } }
  target.addEventListener('pagehide', hide); target.addEventListener('pageshow', show)
  return () => { target.removeEventListener('pagehide', hide); target.removeEventListener('pageshow', show) }
}

export function RecoveryCaseHistoryLink({ caseId, unknown }: { caseId: string; unknown: boolean }) {
  const href = `/workspace/recovery?case=${caseId}`
  // The explicit full-document read cannot promise to retain the volatile key.
  // It never submits a command or infers that the original command failed.
  return unknown ? <a href={href} className={`${link} break-all`}>Open recorded case {caseId} (leaves this screen and discards the original key; reconcile its audit before another action)</a>
    : <Link href={href} className={`${link} break-all`}>Open case {caseId}</Link>
}

export function RecoveryPanel({ projection }: { projection: RecoveryReadProjection }) {
  const router = useRouter()
  const [state, setState] = useState<CommandState>(initialState)
  const controller = useRef<ReturnType<typeof createRecoveryController> | null>(null)
  if (!controller.current) controller.current = createRecoveryController(projection, { post: postRecovery, refresh: () => router.refresh(), onChange: setState })
  const [confirmation, setConfirmation] = useState<RecoveryIntent | null>(null)
  const [formError, setFormError] = useState(false)
  const [privateHidden, setPrivateHidden] = useState(false)
  const formRef = useRef<HTMLFormElement>(null), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const changed = !controller.current?.matches(projection)
    controller.current?.update(projection)
    if (changed) { setConfirmation(null); setFormError(false); formRef.current?.reset() }
    else setConfirmation(current => current && permittedIntent(current, projection) ? current : null)
    setPrivateHidden(false)
  }, [projection])
  useEffect(() => registerRecoveryPageLifecycle(window, () => {
    controller.current?.invalidate(); setConfirmation(null); setFormError(false); formRef.current?.reset(); setPrivateHidden(true)
  }, () => router.refresh()), [router])
  useEffect(() => () => controller.current?.invalidate(), [])
  useEffect(() => { if (state.phase !== 'idle') heading.current?.focus() }, [state.phase])
  const bound = controller.current.matches(projection)
  const blocked = state.phase === 'pending' || state.phase === 'unknown' || state.refreshing || !bound
  const prepare = (candidate: RecoveryIntent) => {
    if (blocked || !permittedIntent(candidate, projection)) return
    const parsed = parseRecoveryIntent(candidate)
    if (!parsed) { setFormError(true); return }
    setFormError(false); setConfirmation(Object.freeze(parsed))
  }
  const key = () => globalThis.crypto.randomUUID()
  const operatorAction = (item: RecoveryCaseView, action: RecoveryAction, evidenceReference = '') => {
    try {
      const base = { requestKey: key(), caseId: item.caseId, expectedRevision: item.revision }
      prepare(action === 'propose' ? { intent: 'propose', ...base, evidenceReference } : action === 'apply' ? { intent: 'apply', ...base } : { intent: 'review', ...base, decision: action })
    } catch { setFormError(true) }
  }
  const submitEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('evidenceReference')
    if (typeof value !== 'string' || !projection.selectedCase) { setFormError(true); return }
    operatorAction(projection.selectedCase, 'propose', value.trim())
  }
  if (privateHidden || (projection.availability === 'ready' && !bound)) return <section className={`${section} mt-8`} role="status">Revalidating private recovery status. No action is available until it has been checked.</section>
  if (projection.availability !== 'ready' || !projection.caller) return <section className={`${section} mt-8`}><p role="status">Recovery status is temporarily unavailable. No change has been confirmed.</p><Button type="button" variant="outline" className="mt-4 min-h-11" onClick={() => router.refresh()}>Check recorded status</Button></section>
  const selected = projection.selectedCase
  const actions = selected ? permittedRecoveryActions(selected, projection) : []
  return <div className="mt-8 space-y-6">
    <section className={section} aria-labelledby="recovery-status">
      <h2 id="recovery-status" className="text-xl font-semibold text-bxo-text-primary">{projection.held ? 'Your business access is held' : 'Your recovery status'}</h2>
      <p className="mt-3 text-base leading-7 text-bxo-text-secondary">{projection.held ? 'This containment covers your mapped accounts and organisations. You can read your recovery status and sign out. A new authenticator or a fresh sign-in does not remove this hold.' : 'Requests are reviewed by separately authorised operators. A workspace role does not grant recovery authority.'}</p>
      {projection.canRequest && !projection.held ? <Button type="button" className={`${primary} mt-4`} disabled={blocked || confirmation !== null} onClick={() => { try { prepare({ intent: 'request', requestKey: key(), reason: 'LOST_AUTHENTICATOR' }) } catch { setFormError(true) } }}>Report a lost authenticator</Button> : null}
      <p className="mt-4 text-sm leading-6 text-bxo-text-secondary">{RECOVERY_MEMORY_NOTICE}</p>
    </section>
    <section className={section} aria-labelledby="recovery-command-status" aria-live="polite">
      <h2 ref={heading} tabIndex={-1} id="recovery-command-status" className="text-lg font-semibold text-bxo-text-primary">{state.phase === 'pending' ? 'Submitting request' : state.phase === 'unknown' ? 'Outcome unconfirmed' : state.phase === 'confirmed' ? 'Transition recorded' : state.phase === 'denied' ? 'Action not accepted' : 'Recorded information'}</h2>
      <p className="mt-3 text-base leading-7 text-bxo-text-secondary">{state.phase === 'unknown' ? RECOVERY_UNKNOWN : state.phase === 'pending' ? 'Wait while the request is checked. Do not submit it again.' : state.result ? state.result.ok ? `${RECOVERY_STATE_LABELS[state.result.state]}. Case revision ${state.result.revision}.${state.result.replayed ? ' This is the original recorded receipt, not a new transition.' : ''}` : errors[state.result.error] : 'Check status to read fresh server records. This does not submit or retry a change.'}</p>
      {state.result && !state.result.ok && state.result.error === 'step_up_required' ? <Link href="/workspace/security" className={`${link} mt-2`}>Verify a fresh authenticator code</Link> : null}
      <Button type="button" variant="outline" className="mt-4 min-h-11" disabled={state.phase === 'pending' || state.refreshing} onClick={() => controller.current?.checkRecordedStatus()}>{state.refreshing ? 'Checking recorded status…' : 'Check recorded status'}</Button>
      {formError ? <p role="alert" className="mt-3 text-base text-bxo-text-primary">Check the evidence reference and current action. No request was sent.</p> : null}
    </section>
    {confirmation && permittedIntent(confirmation, projection) ? <section className={section} aria-labelledby="recovery-confirmation"><h2 id="recovery-confirmation" className="text-xl font-semibold text-bxo-text-primary">Review before submitting</h2><p className="mt-3 text-base leading-7 text-bxo-text-secondary">{confirmation.intent === 'request' ? 'Record your lost-authenticator request. This alone does not restrict access or change any factor.' : confirmation.intent === 'apply' ? 'Apply person-wide containment: deny business access for every mapped account, retire active governance grants and place affected governed scopes on HOLD. This does not remove factors or recover the account.' : confirmation.intent === 'propose' ? 'Propose containment for independent review using the evidence reference below. No containment is applied yet.' : confirmation.decision === 'approve' ? 'Approve this containment proposal. Applying it remains a separate deliberate action.' : 'Reject this containment proposal without applying containment.'}</p>{confirmation.intent !== 'request' ? <p className="mt-3 break-words text-sm text-bxo-text-secondary [overflow-wrap:anywhere]">Case {confirmation.caseId} · expected revision {confirmation.expectedRevision}</p> : null}{confirmation.intent === 'propose' ? <p className="mt-2 break-words text-base text-bxo-text-primary [overflow-wrap:anywhere]">Evidence reference: {confirmation.evidenceReference}</p> : null}<div className="mt-4 flex flex-wrap gap-3"><Button type="button" className={primary} disabled={blocked} onClick={() => { const intent = confirmation; setConfirmation(null); formRef.current?.reset(); void controller.current?.submit(intent) }}>Confirm {confirmation.intent === 'apply' ? 'containment' : confirmation.intent === 'review' ? confirmation.decision : confirmation.intent}</Button><Button type="button" variant="outline" disabled={state.phase === 'pending'} onClick={() => setConfirmation(null)}>Back without submitting</Button></div></section> : null}
    <section className={section} aria-labelledby="recovery-cases"><h2 id="recovery-cases" className="text-xl font-semibold text-bxo-text-primary">Permitted recovery cases</h2>{projection.cases.length ? <ul className="mt-4 space-y-4">{projection.cases.map(item => <li key={item.caseId} className="min-w-0"><p className="text-base font-semibold text-bxo-text-primary">{item.isOwn ? 'Your recovery case' : 'Authorised target case'} · {RECOVERY_STATE_LABELS[item.state]}</p>{state.phase === 'pending' || state.refreshing || confirmation ? <span className="mt-1 block break-words text-sm text-bxo-text-secondary [overflow-wrap:anywhere]">Case {item.caseId} · revision {item.revision}</span> : <RecoveryCaseHistoryLink caseId={item.caseId} unknown={state.phase === 'unknown'} />}</li>)}</ul> : <p className="mt-3 text-base text-bxo-text-secondary">No case is visible in this permitted view. This is not proof that a previously submitted request had no effect.</p>}{projection.casesTruncated ? <p className="mt-4 text-sm text-bxo-text-secondary">Showing up to 50 cases. This is not the complete history.</p> : null}</section>
    {selected ? <section className={section} aria-labelledby="selected-recovery-case"><h2 id="selected-recovery-case" className="text-xl font-semibold text-bxo-text-primary">{RECOVERY_STATE_LABELS[selected.state]}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2">{[['Case reference', selected.caseId], ['Revision', selected.revision], ['Reason', 'Lost authenticator'], ['Created (UTC)', selected.createdAt], ['Request expires (UTC)', selected.expiresAt], ['Evidence reference', selected.evidenceReference ?? 'Not available in this view']].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm font-semibold text-bxo-text-secondary">{label}</dt><dd className="mt-1 break-words text-base text-bxo-text-primary [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>{selected.requiresStepUp && !selected.isOwn ? <p className="mt-4 text-base text-bxo-text-secondary">Operator changes need a fresh authenticator code. <Link href="/workspace/security" className={link}>Verify a fresh authenticator code</Link></p> : null}
      {actions.includes('propose') ? <form ref={formRef} onSubmit={submitEvidence} className="mt-6"><label htmlFor="recovery-evidence" className="text-sm font-semibold text-bxo-text-primary">Restricted evidence reference</label><input id="recovery-evidence" name="evidenceReference" required maxLength={200} autoComplete="off" disabled={blocked || confirmation !== null} aria-describedby="recovery-evidence-help" className="mt-2 min-h-11 w-full rounded-md border border-bxo-border-subtle bg-bxo-bg px-3 py-2 text-base text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"/><p id="recovery-evidence-help" className="mt-2 text-sm text-bxo-text-secondary">Use an approved opaque reference. Do not enter identity documents, passwords, codes or tokens.</p><Button type="submit" className={`${primary} mt-4`} disabled={blocked || confirmation !== null}>Propose containment</Button></form> : null}
      <div className="mt-4 flex flex-wrap gap-3">{actions.filter(action => action !== 'propose').map(action => <Button key={action} type="button" variant={action === 'reject' ? 'outline' : 'default'} className={action === 'reject' ? 'min-h-11' : primary} disabled={blocked || confirmation !== null} onClick={() => operatorAction(selected, action)}>{action === 'apply' ? 'Apply approved containment' : action === 'approve' ? 'Approve containment' : 'Reject containment'}</Button>)}</div>
      {!actions.length && !selected.requiresStepUp ? <p className="mt-4 text-sm text-bxo-text-secondary">No operator action is available to your current identity for this case.</p> : null}
      <h3 className="mt-8 text-lg font-semibold text-bxo-text-primary">Audit history</h3>{selected.events.length ? <ol className="mt-4 space-y-4">{selected.events.map(event => <li key={event.sequence} className="border-l-2 border-bxo-border-subtle pl-4"><p className="text-base text-bxo-text-primary">{event.eventType} · revision {event.afterRevision}</p><p className="mt-1 text-sm text-bxo-text-secondary">{event.at} · event {event.sequence}</p></li>)}</ol> : <p className="mt-3 text-base text-bxo-text-secondary">No audit event is visible in this permitted view. This is not proof of no effect.</p>}{selected.historyTruncated ? <p className="mt-4 text-sm text-bxo-text-secondary">Showing up to 100 audit events. This is not the complete history.</p> : null}</section> : null}
  </div>
}
