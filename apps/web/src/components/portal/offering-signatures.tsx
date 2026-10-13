'use client'

import { useEffect, useRef, useState } from 'react'
import type { PortalProduct, PortalProductServiceAppointment } from '@/lib/portal/contracts'
import { portalContextKey, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { offeringSignatureSnapshotSchema, offeringSignatureScopeMatches, offeringSignatureUrl, offeringSignatureCommandSchema,
  offeringSignatureResponseSchema, readOfferingSignatureRetry, saveOfferingSignatureRetry, clearOfferingSignatureRetry,
  type OfferingSignatureCommand, type OfferingSignatureSnapshot } from '@/lib/portal/offering-signatures'
import { Field, Notice, Panel } from './portal-primitives'
import styles from './portal.module.css'

const nextOwner: Record<OfferingSignatureSnapshot['operations'][number]['state'], string> = {
  PREPARED: 'The restricted processing worker prepares the same durable operation.',
  CREATE_INFLIGHT: 'The processing worker must confirm the outbound create outcome. Do not start another envelope.',
  SENT: 'The named appointed issuer signs; the provider then confirms completion.',
  UNKNOWN_RECONCILIATION: 'The processing worker must reconcile the original transaction identity. No replacement envelope is permitted.',
  COMPLETION_OBSERVED: 'The processing worker must retain and verify all required artifacts before review can rely on them.',
  EVIDENCE_RETAINED: 'Refresh saved package state. The appointed issuer then makes the separate offering review; independent Compliance follows.',
  DECLINED: 'The manager and appointed reviewer must resolve the decline before any fresh-authority decision.',
  VOIDED: 'The manager and appointed reviewer must resolve the voided operation. History remains unchanged.',
  SUPERSEDED: 'This operation is historical. The manager must use the current package and authority.',
  RECOVERY_REQUIRED: 'The authorised recovery owner must resolve the recorded uncertainty; recovery does not permit a blind resend.',
}

export function OfferingSignatures({ product, context, actorId, appointments = [] }: {
  product: PortalProduct; context?: PortalOperatingContext; actorId: string; appointments?: PortalProductServiceAppointment[];
}) {
  const revisionId = product.terms.terms_version === 3 && product.offering_package?.origin === 'SUBMITTED' ? product.offering_package.id : null
  const identity = JSON.stringify([actorId, product.id, revisionId, product.revision, context && portalContextKey(context)])
  const identityRef = useRef(identity); identityRef.current = identity
  const generation = useRef(0)
  const [snapshot, setSnapshot] = useState<OfferingSignatureSnapshot | null>(null)
  const [loadedIdentity, setLoadedIdentity] = useState('')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false)
  const [pending, setPending] = useState<OfferingSignatureCommand | null>(null), [journalBlocked, setJournalBlocked] = useState(false)
  const [appointmentId, setAppointmentId] = useState(''), [validFrom, setValidFrom] = useState(''), [validUntil, setValidUntil] = useState('')
  const [source, setSource] = useState(''), [sourceHash, setSourceHash] = useState(''), [reason, setReason] = useState('')
  const [view, setView] = useState<{ url: string; identity: string; expires: number } | null>(null)
  const [retryViewOperation, setRetryViewOperation] = useState<string | null>(null)
  const scope = context && revisionId ? { actorId, productId: product.id, revisionId, context } : null
  const current = snapshot && scope && loadedIdentity === identity && offeringSignatureScopeMatches(snapshot, scope, product.revision) ? snapshot : null
  const eligibleAppointments = appointments.filter(item => item.product_id === product.id && item.role === 'IssuerFundManager'
    && item.status === 'APPLIED' && item.effective && item.approval_receipt_id && Date.parse(item.requested_until) > Date.now())
  const target = { product_id: product.id, offering_revision_id: revisionId ?? '', expected_revision: product.revision }
  const allowed = (command: OfferingSignatureCommand['command']) => Boolean(current?.admitted && current.environment === 'TESTNET'
    && current.allowed_commands.includes(command) && !busy && !pending && !journalBlocked)

  async function refresh(signal?: AbortSignal) {
    if (!scope) return
    setView(null)
    const expectedIdentity = identity, expectedGeneration = generation.current
    const response = await fetch(offeringSignatureUrl(scope.revisionId, scope.context), { headers: { 'x-bx1-expected-actor': actorId }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: signal ?? AbortSignal.timeout(20000) })
    const body: unknown = await response.json().catch(() => null)
    const parsed = offeringSignatureSnapshotSchema.safeParse(body)
    if (!response.ok || !parsed.success || !offeringSignatureScopeMatches(parsed.data, scope, product.revision)) throw new Error('The current actor, package and signature authority could not be verified. Refresh saved package state.')
    if (identityRef.current !== expectedIdentity || generation.current !== expectedGeneration || signal?.aborted) return
    setSnapshot(parsed.data); setLoadedIdentity(expectedIdentity); setUnavailable(false)
  }

  useEffect(() => {
    const controller = new AbortController(), expectedGeneration = ++generation.current
    setSnapshot(null); setLoadedIdentity(''); setMessage(''); setUnavailable(false); setPending(null); setJournalBlocked(false); setBusy(false); setView(null); setRetryViewOperation(null)
    setAppointmentId(''); setValidFrom(''); setValidUntil(''); setSource(''); setSourceHash(''); setReason('')
    if (scope) {
      try { setPending(readOfferingSignatureRetry(sessionStorage, scope)) }
      catch { setJournalBlocked(true); setMessage('The saved signature request cannot be verified. No new action is available.') }
      void refresh(controller.signal).catch(() => { if (!controller.signal.aborted && generation.current === expectedGeneration) setUnavailable(true) })
    }
    return () => { controller.abort(); ++generation.current }
  }, [identity])

  useEffect(() => {
    if (!view) return
    const timeout = setTimeout(() => setView(null), Math.max(0, view.expires - Date.now()))
    return () => clearTimeout(timeout)
  }, [view])

  async function act(request: OfferingSignatureCommand) {
    if (!scope || !current || busy || journalBlocked || !current.allowed_commands.includes(request.command)) return
    const parsed = offeringSignatureCommandSchema.safeParse(request)
    if (!parsed.success) { setMessage('Check the required references, validity dates and evidence before submitting.'); return }
    const expectedIdentity = identity, expectedGeneration = generation.current
    try { saveOfferingSignatureRetry(sessionStorage, scope, parsed.data) }
    catch { setJournalBlocked(true); setMessage('The original signature request could not be saved or verified. No request was sent.'); return }
    setPending(parsed.data); setBusy(true); setView(null); setMessage('')
    try {
      const response = await fetch('/api/portal/offering-signatures', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId },
        body: JSON.stringify({ expected_actor: actorId, operating_context: scope.context, request: parsed.data }), signal: AbortSignal.timeout(60000) })
      const result = offeringSignatureResponseSchema.safeParse(await response.json().catch(() => null))
      if (!response.ok || !result.success || result.data.command !== request.command || result.data.key !== request.key
        || !offeringSignatureScopeMatches(result.data.snapshot, scope, product.revision)
        || request.command !== 'REQUEST_SIGNING_VIEW' && result.data.signing_url !== undefined) throw new Error('The exact signature request outcome is not confirmed.')
      if (identityRef.current !== expectedIdentity || generation.current !== expectedGeneration) return
      clearOfferingSignatureRetry(sessionStorage, scope, request)
      setSnapshot(result.data.snapshot); setLoadedIdentity(expectedIdentity); setPending(null)
      if (result.data.signing_url && request.command === 'REQUEST_SIGNING_VIEW') {
        setRetryViewOperation(null)
        setView({ url: result.data.signing_url, identity: expectedIdentity, expires: Date.now() + 240000 })
        setMessage('Your short-lived signing link is ready. Returning from DocuSign does not confirm completion.')
      } else if (request.command === 'REQUEST_SIGNING_VIEW' && result.data.view_status === 'RETRY_SAME_ENVELOPE') {
        setRetryViewOperation(request.payload.operation_id)
        setMessage('The original view request is acknowledged but its short-lived URL is not retained. Open a new signing link for this same envelope; no replacement envelope is created.')
      } else setMessage('The exact request was acknowledged. Refresh saved package state for review hand-offs; provider work may still be pending.')
    } catch {
      if (identityRef.current === expectedIdentity && generation.current === expectedGeneration) setMessage('The outcome is unknown or access changed. No replacement request is created. Refresh and reconcile only the saved request identity.')
    } finally { if (identityRef.current === expectedIdentity && generation.current === expectedGeneration) setBusy(false) }
  }
  const send = (command: OfferingSignatureCommand) => void act(command)

  return <Panel title="Issuer package execution" description="Synthetic TEST signing purpose, genuine provider evidence and separate independent review.">
    {!scope ? <Notice title="No submitted signature scope">A current submitted v3 package and authorised workspace are required. Historical text-only packages are not upgraded or treated as signed.</Notice> : <div className={styles.stack}>
      {!current ? <Notice title={unavailable ? 'Signature authority unavailable' : 'Checking signature authority'}>No signer, capability or completed evidence is inferred from missing data.</Notice> : <>
        {!current.admitted ? <Notice title="Signature processing not admitted" tone="warning">The processing owner must verify this environment and scope before execution. No new signature action is available.</Notice> : null}
        {current.blocker ? <Notice title="Current signature blocker" tone="warning">{current.blocker}</Notice> : null}
        <p className={styles.muted}>An issuer review appointment is not execution authority. The manager requests a specific purpose, independent Compliance reviews it, then the named issuer signs. Provider completion cannot approve or publish this product.</p>
        {current.authorisations.map(authorisation => <section key={authorisation.id} className={styles.stack} aria-label={`Signing purpose ${authorisation.id}`}>
          <h3>Purpose · {authorisation.state.replaceAll('_', ' ').toLowerCase()}</h3>
          <p>Named signer <span className={styles.mono}>{authorisation.signer_id}</span> · valid {authorisation.valid_from} to {authorisation.valid_until}</p>
          <p className={styles.copy}>{authorisation.source_reference}</p>
          {authorisation.state === 'REQUESTED' ? <p>Next owner: independent appointed Compliance reviewer.</p> : null}
          {allowed('REVIEW_PURPOSE') && authorisation.state === 'REQUESTED' ? <div className={styles.actions}>
            <button type="button" className={styles.buttonSecondary} disabled={reason.trim().length < 20} onClick={() => send({ command: 'REVIEW_PURPOSE', key: crypto.randomUUID(), payload: { ...target, authorisation_id: authorisation.id, decision: 'APPROVED', reason: reason.trim() } })}>Approve synthetic signing purpose</button>
            <button type="button" className={styles.buttonSecondary} disabled={reason.trim().length < 20} onClick={() => send({ command: 'REVIEW_PURPOSE', key: crypto.randomUUID(), payload: { ...target, authorisation_id: authorisation.id, decision: 'REJECTED', reason: reason.trim() } })}>Reject signing purpose</button>
          </div> : null}
          {allowed('REVOKE_PURPOSE') && authorisation.state === 'APPROVED' ? <button type="button" className={styles.buttonSecondary} disabled={reason.trim().length < 20} onClick={() => send({ command: 'REVOKE_PURPOSE', key: crypto.randomUUID(), payload: { ...target, authorisation_id: authorisation.id, reason: reason.trim() } })}>Revoke signing purpose</button> : null}
          {allowed('PREPARE_EXECUTION') && authorisation.state === 'APPROVED' && !current.operations.some(item => item.authorisation_id === authorisation.id) ? <button type="button" className={styles.buttonSecondary} onClick={() => send({ command: 'PREPARE_EXECUTION', key: crypto.randomUUID(), payload: { ...target, authorisation_id: authorisation.id } })}>Prepare exact issuer execution</button> : null}
        </section>)}
        {current.operations.map(operation => <section key={operation.id} className={styles.stack} aria-label={`Signature operation ${operation.id}`}>
          <h3>{operation.state.replaceAll('_', ' ')}</h3><p>{nextOwner[operation.state]}</p>
          {operation.noncurrent_reason !== null || operation.state === 'SUPERSEDED' ? <Notice title="Historical / non-current evidence" tone="warning">{operation.noncurrent_reason ?? 'This operation cannot support current approval. Historical artifacts remain preserved.'}</Notice> : null}
          {operation.next_check_at ? <p>Next provider check no earlier than {operation.next_check_at}. Refresh reads saved evidence and does not bypass this schedule.</p> : null}
          {allowed('REQUEST_SIGNING_VIEW') && operation.noncurrent_reason === null && operation.state === 'SENT' && current.authorisations.some(item => item.id === operation.authorisation_id && item.signer_id === actorId && item.state === 'APPROVED' && Date.parse(item.valid_from) <= Date.now() && Date.parse(item.valid_until) > Date.now()) ? <button type="button" className={styles.button} onClick={() => send({ command: 'REQUEST_SIGNING_VIEW', key: crypto.randomUUID(), payload: { ...target, operation_id: operation.id } })}>{retryViewOperation === operation.id ? 'Open a new signing link for this same envelope' : 'Get my DocuSign signing link'}</button> : null}
          {allowed('REQUEST_RECONCILIATION') && !['EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED'].includes(operation.state) ? <button type="button" className={styles.buttonSecondary} onClick={() => send({ command: 'REQUEST_RECONCILIATION', key: crypto.randomUUID(), payload: { ...target, operation_id: operation.id } })}>Request scheduled reconciliation</button> : null}
          {allowed('REQUEST_RECOVERY') && operation.state === 'RECOVERY_REQUIRED' ? <button type="button" className={styles.buttonSecondary} disabled={reason.trim().length < 20} onClick={() => send({ command: 'REQUEST_RECOVERY', key: crypto.randomUUID(), payload: { ...target, operation_id: operation.id, reason: reason.trim() } })}>Request recovery of this operation</button> : null}
          {operation.artifacts.length ? <ul>{operation.artifacts.map(artifact => <li key={artifact.id}><a className={styles.textLink} href={`${offeringSignatureUrl(scope.revisionId, scope.context, artifact.id)}&expected_actor=${encodeURIComponent(actorId)}`}>{artifact.kind.replaceAll('_', ' ')} PDF</a> · <span className={styles.mono}>{artifact.sha256}</span></li>)}</ul> : <p className={styles.muted}>No retained artifacts are available in this record.</p>}
        </section>)}
        {allowed('REQUEST_PURPOSE') ? <form className={styles.form} onSubmit={event => {
          event.preventDefault()
          if (!eligibleAppointments.some(item => item.id === appointmentId)) return
          const from = Date.parse(validFrom), until = Date.parse(validUntil)
          if (!Number.isFinite(from) || !Number.isFinite(until)) return
          send({ command: 'REQUEST_PURPOSE', key: crypto.randomUUID(), payload: { ...target, appointment_id: appointmentId, valid_from: new Date(from).toISOString(), valid_until: new Date(until).toISOString(), source_reference: source.trim(), source_sha256: sourceHash } })
        }}><fieldset className={styles.fieldset}><legend>Request a synthetic issuer signing purpose</legend>
          {eligibleAppointments.length ? eligibleAppointments.map(item => <label key={item.id} className={styles.check}><input type="radio" name="signature-appointment" required checked={appointmentId === item.id} onChange={() => setAppointmentId(item.id)} />Appointed issuer {item.appointee_user_id} · {item.id}</label>) : <p>No current applied issuer appointment is available. The appointment owner must resolve this first.</p>}
          <Field label="Purpose valid from"><input type="datetime-local" required value={validFrom} onChange={event => setValidFrom(event.target.value)} /></Field>
          <Field label="Purpose valid until"><input type="datetime-local" required value={validUntil} onChange={event => setValidUntil(event.target.value)} /></Field>
          <Field label="Purpose source evidence reference"><input required minLength={20} maxLength={1000} value={source} onChange={event => setSource(event.target.value)} /></Field>
          <Field label="Source evidence SHA-256" hint="Reference existing purpose evidence; this input cannot grant authority."><input required pattern="[0-9a-f]{64}" maxLength={64} value={sourceHash} onChange={event => setSourceHash(event.target.value)} /></Field>
          <button className={styles.buttonSecondary} type="submit" disabled={!appointmentId}>Request independent purpose review</button>
        </fieldset></form> : null}
        {['REVIEW_PURPOSE', 'REVOKE_PURPOSE', 'REQUEST_RECOVERY'].some(command => current.allowed_commands.includes(command as OfferingSignatureCommand['command'])) ? <Field label="Signature decision or recovery reason" hint="20 to 1,000 characters."><textarea minLength={20} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field> : null}
      </>}
      <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => { const expectedIdentity = identity; void refresh().catch(() => { if (identityRef.current === expectedIdentity) { setSnapshot(null); setUnavailable(true); setView(null) } }) }}>Refresh saved signature state</button>
      {view && view.identity === identity && view.expires > Date.now() ? <a className={styles.textLink} href={view.url} target="_blank" rel="noopener noreferrer" onClick={() => setView(null)}>Open my short-lived DocuSign signing session</a> : null}
      {pending ? <Notice title="Original signature request awaiting confirmation" tone="warning">No new request may replace this identity. <button type="button" className={styles.buttonSecondary} disabled={busy || journalBlocked || !current?.allowed_commands.includes(pending.command)} onClick={() => void act(pending)}>Retry the same signature request</button></Notice> : null}
      {journalBlocked ? <Notice title="Signature journal unavailable" tone="warning">Return to the original account and context to reconcile its saved request. No replacement action is sent.</Notice> : null}
      {message ? <p role="status" className={styles.copy}>{message}</p> : null}
    </div>}
  </Panel>
}
