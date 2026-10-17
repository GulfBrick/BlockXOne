'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { portalContextKey, portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { setupPost } from '@/lib/portal/fund-setup-client'
import { usePortalActorId, usePortalOperatingContext } from './portal-client'
import styles from './fund-lifecycle.module.css'

const markerSchema = z.object({ setup_id: z.string().uuid(), expected_revision: z.number().int().positive(), request_key: z.string().uuid() }).strict()
const resultSchema = z.object({ request_id: z.string().uuid(), status: z.literal('ADMITTED'), manifest_id: z.string().uuid(), signer_policy_id: z.string().uuid().optional() }).strict()

/** Continues the SAME saved fund. Receipt references are never entered by a customer. */
export function FundReleaseAdmission({ setupId, revision, actorId, operatingContext, onRefresh }: {
  setupId: string; revision: number; actorId: string; operatingContext: PortalOperatingContext; onRefresh: () => Promise<void>
}) {
  const currentActor = usePortalActorId(), currentContext = usePortalOperatingContext()
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [ready, setReady] = useState(false), [admitted, setAdmitted] = useState(false)
  const lock = useRef(false), active = useRef(true), generation = useRef(0), controller = useRef<AbortController | null>(null)
  const scope = `${actorId}:${portalContextKey(operatingContext)}:${setupId}:${revision}`
  const key = `bx1:fund-admission:v1:${scope}`
  const authorised = actorId === currentActor && portalContextMatches(currentContext, operatingContext)
  useEffect(() => { generation.current++; active.current = true; setBusy(false); setMessage(''); setReady(false); setAdmitted(false)
    try {
      const raw = sessionStorage.getItem(key)
      if (raw && (raw.length > 1024 || !markerSchema.safeParse(JSON.parse(raw)).success)) throw new Error('The original release request needs recovery. Refresh this saved fund; do not replace it.')
      setReady(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request recovery is unavailable.') }
    return () => { generation.current++; active.current = false; controller.current?.abort(); lock.current = false }
  }, [key, authorised, currentActor, portalContextKey(currentContext)])
  async function verify() {
    if (lock.current || !authorised || !ready || admitted) return
    lock.current = true; setBusy(true); setMessage('Checking the saved contracts, signing keys and current fund approvals. No transaction is being sent.')
    const abort = new AbortController(); controller.current = abort
    const attempt = generation.current
    const current = () => active.current && generation.current === attempt
    const timeout = setTimeout(() => abort.abort(), 115000)
    try {
      const raw = sessionStorage.getItem(key)
      const request = raw ? markerSchema.parse(JSON.parse(raw)) : markerSchema.parse({ setup_id: setupId, expected_revision: revision, request_key: crypto.randomUUID() })
      if (request.setup_id !== setupId || request.expected_revision !== revision) throw new Error('This request belongs to another saved setup.')
      sessionStorage.setItem(key, JSON.stringify(request))
      const result = resultSchema.parse(await setupPost('/api/portal/fund-lifecycle/admission', request, actorId, operatingContext, abort.signal))
      if (!current() || abort.signal.aborted) return
      sessionStorage.removeItem(key); setAdmitted(true)
      setMessage(`The verified release is connected to this fund. Continue to its deployment request. Reference ${result.request_id}.`)
      await onRefresh()
    } catch (error) {
      if (current()) setMessage(abort.signal.aborted ? 'Verification did not finish in time. The original release request is retained; check it again without starting another setup.'
        : error instanceof Error ? error.message : 'Release verification was not confirmed. Retry the original saved request.')
    } finally { clearTimeout(timeout); if (current()) { lock.current = false; setBusy(false) } }
  }
  return <section className={styles.card}><div className={styles.cardBody}>
    <h3>{admitted ? 'Ready for the fund deployment request' : 'Connect the verified contracts to this fund'}</h3>
    <p>Check the current offering approvals, proved signing keys and observed contract configuration. This enables the deployment hand-off; it does not open funding or issue units.</p>
    <button type="button" className={styles.primary} disabled={!authorised || !ready || busy || admitted} onClick={() => void verify()}>{busy ? 'Verifying the current release…' : admitted ? 'Release connected' : 'Verify release and continue'}</button>
    {message ? <p className={styles.feedback} role="status" aria-live="polite">{message}</p> : null}
  </div></section>
}
