'use client'

import { useEffect, useRef, useState } from 'react'
import { entryCommandSchema, entrySnapshotSchema, type EntryApplication, type EntryCommand, type EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'

type EntryMarker = { key: string; command: EntryCommand['command']; hash: string }
type MarkerStorage = Pick<Storage, 'getItem' | 'removeItem'>
const markerKey = (actorId: string, environment: PlatformEnvironment) => `bx1-entry:${environment}:${actorId}:pending-request`
function readMarker(raw: string | null): EntryMarker | null {
  if (!raw) return null
  const value = JSON.parse(raw) as Partial<EntryMarker> | null
  if (!value || typeof value.key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.key) || !['start_application', 'submit_application'].includes(value.command ?? '') || typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) throw new Error('Your previous request reference needs operator reconciliation. No replacement request was sent.')
  return value as EntryMarker
}
export function reconcileEntryMarker(storage: MarkerStorage, actorId: string, environment: PlatformEnvironment, receipts: NonNullable<EntrySnapshot['requests']>): EntryMarker | null {
  const storageKey = markerKey(actorId, environment)
  const marker = readMarker(storage.getItem(storageKey))
  // Only the server's receipt for this exact actor/environment/key/command can
  // close an uncertain request after navigation. A similar application cannot.
  if (marker && receipts.some(receipt => receipt.key === marker.key && receipt.command === marker.command)) { storage.removeItem(storageKey); return null }
  return marker
}

export function canRefreshEntryApplication(application: EntryApplication | null): boolean {
  return Boolean(application && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(application.status))
}

/** A read never replaces unsaved editable fields or clears an uncertain command marker. */
export async function readEntryApplicationStatus(actorId: string, application: EntryApplication): Promise<EntrySnapshot> {
  if (!canRefreshEntryApplication(application)) throw new Error('Finish your edits before refreshing. No application fields were replaced.')
  const response = await fetch('/api/portal/entry', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': actorId }, signal: AbortSignal.timeout(15000) })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Status could not be verified. Your saved application is unchanged.')
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Status could not be refreshed. Sign in again if your session has expired.')
  const snapshot = entrySnapshotSchema.parse(result.snapshot)
  const updated = snapshot.applications.find(item => item.id === application.id)
  if (snapshot.actor.id !== actorId || snapshot.applications.some(item => item.user_id !== actorId) || !updated || updated.revision < application.revision) throw new Error('The returned account or application revision could not be verified. No displayed record was replaced.')
  return snapshot
}

export function useEntryStatusRefresh(actorId: string, environment: PlatformEnvironment, application: EntryApplication | null, onRefreshed: (snapshot: EntrySnapshot) => void) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const lock = useRef(false)
  const identity = `${environment}:${actorId}:${application?.id ?? ''}:${application?.revision ?? ''}:${application?.status ?? ''}`
  const active = useRef<string | null>(identity)
  active.current = identity
  useEffect(() => { active.current = identity; return () => { active.current = null } }, [identity])
  async function refresh() {
    if (!application || !canRefreshEntryApplication(application) || lock.current) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      const snapshot = await readEntryApplicationStatus(actorId, application)
      if (active.current !== identity) return
      setMessage('Saved application status refreshed.'); onRefreshed(snapshot)
    } catch (error) { if (active.current === identity) setMessage(error instanceof Error ? error.message : 'Status could not be refreshed.') }
    finally { lock.current = false; if (active.current === identity) setBusy(false) }
  }
  return { busy, message, refresh, available: canRefreshEntryApplication(application) }
}

/** Persist only the idempotency reference and digest, never applicant evidence. */
export function useEntryCommand(actorId: string, environment: PlatformEnvironment, onSaved: (snapshot: EntrySnapshot) => void, receipts: NonNullable<EntrySnapshot['requests']> = []) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [unknown, setUnknown] = useState(false)
  const lock = useRef(false), original = useRef<EntryCommand | null>(null)
  const identity = `${environment}:${actorId}`
  const active = useRef<string | null>(identity)
  active.current = identity
  useEffect(() => { active.current = identity; return () => { active.current = null } }, [identity])
  useEffect(() => {
    try {
      const marker = reconcileEntryMarker(sessionStorage, actorId, environment, receipts)
      if (marker) setMessage('A previous application request is unresolved. Re-enter its original values to retry the saved reference, or refresh to load its committed receipt.')
      else if (original.current && receipts.some(receipt => receipt.key === original.current?.key && receipt.command === original.current?.command)) { original.current = null; setUnknown(false); setMessage('The hosted receipt confirms your previous request saved.') }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request reconciliation is unavailable.') }
  }, [actorId, environment, receipts])
  async function dispatch(request: EntryCommand) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setMessage('')
    const storageKey = markerKey(actorId, environment)
    let sent = false, hadPending = false
    try {
      const existing = reconcileEntryMarker(sessionStorage, actorId, environment, receipts)
      const raw = sessionStorage.getItem(storageKey)
      hadPending = Boolean(existing)
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ command: request.command, payload: request.payload, identity })))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (existing && (existing.command !== request.command || existing.hash !== hash)) throw new Error('A previous request needs reconciliation. Re-enter its original values to retry the same reference; do not create a replacement application.')
      if (sessionStorage.getItem(storageKey) !== raw) throw new Error('Another action is preparing. Refresh before continuing.')
      const prepared = entryCommandSchema.parse({ ...request, key: existing?.key ?? request.key })
      sessionStorage.setItem(storageKey, JSON.stringify({ key: prepared.key, command: prepared.command, hash }))
      if (active.current !== identity) return false
      original.current = prepared; sent = true
      const response = await fetch('/api/portal/entry', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId }, body: JSON.stringify(prepared), signal: AbortSignal.timeout(45000) })
      const result = await response.json()
      if (!response.ok) {
        const error = new Error(typeof result.error === 'string' ? result.error : 'The result could not be confirmed.') as Error & { definitive?: boolean }
        error.definitive = response.status >= 400 && response.status < 500
        throw error
      }
      const snapshot = entrySnapshotSchema.parse(result.snapshot)
      if (snapshot.actor.id !== actorId || snapshot.applications.some(application => application.user_id !== actorId)) throw new Error('The returned account could not be verified.')
      sessionStorage.removeItem(storageKey)
      if (active.current !== identity) return false
      original.current = null; setUnknown(false); setMessage('Saved to your hosted application workspace.'); onSaved(snapshot); return true
    } catch (error) {
      if (active.current !== identity) return false
      const definitive = error instanceof Error && 'definitive' in error && error.definitive === true
      if (definitive && !hadPending) { sessionStorage.removeItem(storageKey); original.current = null }
      setUnknown(Boolean(original.current) && (hadPending || sent && !definitive))
      setMessage(error instanceof Error ? error.message : 'The result is uncertain. Keep the original request reference.')
      return false
    } finally { if (active.current === identity) { lock.current = false; setBusy(false) } }
  }
  async function submit(command: EntryCommand['command'], payload: Record<string, unknown>) {
    const result = entryCommandSchema.safeParse({ command, payload, key: crypto.randomUUID() })
    if (!result.success) { setMessage(result.error.issues[0]?.message ?? 'Check the application fields.'); return false }
    return dispatch(result.data)
  }
  return { busy, unknown, message, submit, retry: () => original.current ? dispatch(original.current) : Promise.resolve(false) }
}
