'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalContextKey, portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformEnvironment } from '@/lib/platform-release'
import styles from './portal.module.css'

type Marker = { key: string; command: string; payloadHash: string }
type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type MarkerScope = { operatingContext: PortalOperatingContext; environment: PlatformEnvironment }
const markerKey = (actorId: string, scope?: MarkerScope) => scope
  ? `bx1-portal:${scope.environment}:${actorId}:${portalContextKey(scope.operatingContext)}:pending-request`
  : `bx1-portal:fegnnnlseuejkrusbbkv:${actorId}:pending-request`
const PortalCommandContext = createContext<{ actorId: string; requests: { key: string; command: string }[] } & MarkerScope>({ actorId: '', requests: [], operatingContext: APPLICANT_CONTEXT, environment: 'TESTNET' })
export function PortalCommandProvider({ snapshot, children, operatingContext = APPLICANT_CONTEXT, environment = 'TESTNET' }: { snapshot: PortalSnapshot; children: ReactNode; operatingContext?: PortalOperatingContext; environment?: PlatformEnvironment }) {
  return <PortalCommandContext.Provider value={{ actorId: snapshot.actor.id, requests: snapshot.requests ?? [], operatingContext, environment }}>{children}</PortalCommandContext.Provider>
}
export function usePortalOperatingContext() { return useContext(PortalCommandContext).operatingContext }
export function usePortalActorId() { return useContext(PortalCommandContext).actorId }
function readMarker(raw: string | null): Marker | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('The saved request marker cannot be read. Do not start a replacement request; contact the platform operator.') }
  const value = parsed as Partial<Marker> | null
  if (!value || typeof value.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.key) || typeof value.command !== 'string' || typeof value.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.payloadHash)) throw new Error('The saved request marker is invalid. Do not start a replacement request.')
  return value as Marker
}
export function reconcilePortalMarker(storage: MarkerStorage, actorId: string, requests: { key: string; command: string }[], scope?: MarkerScope): Marker | null {
  if (scope && storage.getItem(markerKey(actorId))) throw new Error('A request from the previous platform version needs reconciliation. Contact the operator with its request reference before starting another action.')
  const marker = readMarker(storage.getItem(markerKey(actorId, scope)))
  if (marker && requests.some(request => request.key === marker.key && request.command === marker.command)) { storage.removeItem(markerKey(actorId, scope)); return null }
  return marker
}
export async function prepareDurablePortalCommand(storage: MarkerStorage, actorId: string, request: PortalCommand, requests: { key: string; command: string }[], scope?: MarkerScope): Promise<PortalCommand> {
  if (!actorId) throw new Error('Your authenticated account is unavailable. Reload before continuing.')
  const marker = reconcilePortalMarker(storage, actorId, requests, scope)
  const original = storage.getItem(markerKey(actorId, scope))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ command: request.command, payload: request.payload, ...(scope ? { environment: scope.environment, operating_context: scope.operatingContext } : {}) })))
  const payloadHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
  if (marker && (marker.command !== request.command || marker.payloadHash !== payloadHash)) throw new Error(`A previous ${marker.command.replaceAll('_', ' ')} request is unresolved. Re-enter the original values to retry its saved key, or refresh to reconcile a committed result. No new request was sent.`)
  if (storage.getItem(markerKey(actorId, scope)) !== original) throw new Error('Another request was recorded while this action was preparing. Refresh before continuing.')
  const prepared = { ...request, key: marker?.key ?? request.key }
  // Only identifiers and a digest are persisted: never applicant details, evidence or document text.
  storage.setItem(markerKey(actorId, scope), JSON.stringify({ key: prepared.key, command: prepared.command, payloadHash }))
  return prepared
}
export function clearPortalMarker(storage: MarkerStorage, actorId: string, request: PortalCommand, scope?: MarkerScope) {
  const marker = readMarker(storage.getItem(markerKey(actorId, scope)))
  if (marker?.key === request.key && marker.command === request.command) storage.removeItem(markerKey(actorId, scope))
}
/** A denial of a retry cannot prove that its earlier uncertain attempt failed. */
export function mayDiscardDeniedPortalRequest(definitive: boolean, hadPendingAttempt: boolean): boolean {
  return definitive && !hadPendingAttempt
}

export async function postPortalCommand(command: PortalCommand, operatingContext: PortalOperatingContext = APPLICANT_CONTEXT, expectedActor?: string): Promise<PortalSnapshot> {
  const response = await fetch('/api/portal/command', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(expectedActor ? { 'x-bx1-expected-actor': expectedActor } : {}) }, body: JSON.stringify({ ...command, operating_context: operatingContext }), signal: AbortSignal.timeout(45000) })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) throw new Error('The platform did not confirm the outcome. Retry the saved request, not a new application.')
  const result = await response.json()
  if (!response.ok || result.error || !result.snapshot) {
    const error = new Error(typeof result.error === 'string' ? result.error : 'The platform could not confirm this request.') as Error & { definitive?: boolean }
    error.definitive = response.status >= 400 && response.status < 500
    throw error
  }
  if (!portalContextMatches(result.snapshot.operating_context, operatingContext) || (expectedActor && result.snapshot.actor?.id !== expectedActor)) throw new Error('The saved result belongs to an unverified operating context. Refresh to reconcile the original request.')
  return result.snapshot as PortalSnapshot
}

export function usePortalCommand(onSaved: (snapshot: PortalSnapshot) => void) {
  const context = useContext(PortalCommandContext)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unknown, setUnknown] = useState(false)
  const lock = useRef(false)
  const savedRequest = useRef<PortalCommand | null>(null)
  const identity = `${context.environment}:${context.actorId}:${portalContextKey(context.operatingContext)}`
  const activeIdentity = useRef<string | null>(identity)
  activeIdentity.current = identity
  useEffect(() => { activeIdentity.current = identity; return () => { activeIdentity.current = null } }, [identity])
  useEffect(() => {
    if (!context.actorId) return
    try {
      const marker = reconcilePortalMarker(sessionStorage, context.actorId, context.requests, context)
      if (marker && !savedRequest.current) setMessage(`A previous ${marker.command.replaceAll('_', ' ')} request needs reconciliation. Re-enter its original values to retry the same saved key, or refresh saved state.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request recovery is unavailable.') }
  }, [context.actorId, context.requests, identity])
  async function dispatch(request: PortalCommand) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setMessage('')
    let sent = false
    let hadPendingAttempt = Boolean(savedRequest.current)
    const attemptIdentity = identity
    const isCurrent = () => activeIdentity.current === attemptIdentity
    try {
      hadPendingAttempt ||= Boolean(reconcilePortalMarker(sessionStorage, context.actorId, context.requests, context))
      const prepared = await prepareDurablePortalCommand(sessionStorage, context.actorId, request, context.requests, context)
      if (!isCurrent()) return false
      savedRequest.current = prepared
      sent = true
      const snapshot = await postPortalCommand(prepared, context.operatingContext, context.actorId)
      clearPortalMarker(sessionStorage, context.actorId, prepared, context)
      if (!isCurrent()) return false
      savedRequest.current = null; setUnknown(false); onSaved(snapshot); setMessage('Saved to your hosted workspace.'); return true
    } catch (error) {
      const definitive = typeof error === 'object' && error !== null && 'definitive' in error && error.definitive === true
      if (!isCurrent()) return false
      if (mayDiscardDeniedPortalRequest(definitive, hadPendingAttempt) && savedRequest.current) { clearPortalMarker(sessionStorage, context.actorId, savedRequest.current, context); savedRequest.current = null }
      setUnknown(Boolean(savedRequest.current) && (hadPendingAttempt || (sent && !definitive)))
      setMessage(error instanceof Error ? error.message : 'The platform did not confirm the outcome. Retry the original saved request.')
      return false
    } finally { if (isCurrent()) { lock.current = false; setBusy(false) } }
  }
  async function submit(command: PortalCommand['command'], payload: Record<string, unknown>) {
    if (savedRequest.current) { setMessage('Resolve the original saved request before starting a new action.'); return false }
    const parsed = portalCommandSchema.safeParse({ command, key: crypto.randomUUID(), payload })
    if (!parsed.success) { setMessage(parsed.error.issues.map(issue => `${issue.path.filter(part => part !== 'payload').join(' ')}: ${issue.message}`).slice(0, 4).join(' · ')); return false }
    return dispatch(parsed.data)
  }
  return { busy, message, unknown, submit, retry: () => savedRequest.current ? dispatch(savedRequest.current) : Promise.resolve(false) }
}

export function CommandFeedback({ command }: { command: ReturnType<typeof usePortalCommand> }) {
  return <div className={styles.statusRegion} role="status" aria-live="polite">{command.busy ? 'Saving securely to the hosted platform…' : command.message}{command.unknown ? <div className={styles.sectionGap}><p className={styles.muted}>The result is uncertain. Keep this page open; the original request key is retained so the action is not duplicated.</p><button className={styles.buttonSecondary} disabled={command.busy} type="button" onClick={() => void command.retry()}>Retry the original saved request</button></div> : null}</div>
}
