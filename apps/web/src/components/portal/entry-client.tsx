'use client'

import { useEffect, useRef, useState } from 'react'
import { entryCommandSchema, entrySnapshotSchema, type EntryCommand, type EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'

/** Persist only the idempotency reference and digest, never applicant evidence. */
export function useEntryCommand(actorId: string, environment: PlatformEnvironment, onSaved: (snapshot: EntrySnapshot) => void) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [unknown, setUnknown] = useState(false)
  const lock = useRef(false), original = useRef<EntryCommand | null>(null)
  const identity = `${environment}:${actorId}`
  const active = useRef<string | null>(identity)
  active.current = identity
  useEffect(() => { active.current = identity; return () => { active.current = null } }, [identity])
  async function dispatch(request: EntryCommand) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setMessage('')
    const storageKey = `bx1-entry:${identity}:pending-request`
    let sent = false, hadPending = false
    try {
      const raw = sessionStorage.getItem(storageKey)
      const existing = raw ? JSON.parse(raw) as { key?: unknown; command?: unknown; hash?: unknown } : null
      hadPending = Boolean(existing)
      if (existing && (typeof existing.key !== 'string' || !/^[0-9a-f-]{36}$/i.test(existing.key) || typeof existing.hash !== 'string' || !/^[0-9a-f]{64}$/.test(existing.hash))) throw new Error('Your previous request reference needs operator reconciliation. No replacement request was sent.')
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
