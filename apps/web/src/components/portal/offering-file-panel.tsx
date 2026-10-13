'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PortalProduct } from '@/lib/portal/contracts'
import { portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { offeringDocumentSnapshotSchema, offeringFileKindSchema, offeringFileReceiptSchema, offeringFileMaxBytes,
  readOfferingDocumentRetry, saveOfferingDocumentRetry, clearOfferingDocumentRetry,
  offeringDocumentPayloadText, offeringDocumentRollbackMatches,
  type OfferingDocumentCommand, type OfferingDocumentSnapshot } from '@/lib/portal/offering-files'
import { Field, Notice, Panel } from './portal-primitives'
import styles from './portal.module.css'

function fileUrl(revisionId: string, context: PortalOperatingContext, id?: string): string {
  const query = new URLSearchParams({ revision_id: revisionId })
  if (context.mode === 'APPLICANT') query.set('mode', 'applicant')
  else { query.set('organisation', context.organisationId); query.set('role', context.role) }
  if (id) { query.set('id', id); query.set('download', '1') }
  return `/api/portal/offering-documents?${query}`
}

const nextStep: Record<OfferingDocumentSnapshot['state'], string> = {
  LEGACY_TEXT_ONLY: 'Historical text-only evidence remains unchanged. No PDF profile or signature is inferred.',
  NOT_ADMITTED: 'The document-processing owner must explicitly admit this offering scope. Uploads and scanners are closed.',
  PENDING_SCAN: 'The scanner must finish the exact queued bytes. The manager can refresh or resolve an eligible abandoned intent; an active lease cannot be excluded.',
  REJECTED_OR_EXCLUDED: 'The manager must resolve remaining intents, then use Refresh saved state and the permitted same-terms correction in Offering hand-offs to create a fresh revision. An immutable category cannot be overwritten; rejected and excluded evidence stays in history.',
  READY_TO_SEAL: 'The manager must select one independently clean PDF per category and declare correspondence with these exact submitted terms.',
  SEALED_SIGNATURE_REQUIRED: 'The exact three-PDF manifest is sealed. Genuine signature integration is the next owner; approval, publication and subscription remain unavailable.',
}

export function OfferingFilePanel({ product, context, actorId }: {
  product: PortalProduct; context?: PortalOperatingContext; actorId: string
}) {
  const revision = product.offering_package?.origin === 'SUBMITTED' ? product.offering_package.id : null
  const [documents, setDocuments] = useState<OfferingDocumentSnapshot | null | undefined>(null)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'MEMORANDUM' | 'RISKS' | 'SUBSCRIPTION_TERMS'>('MEMORANDUM')
  const [title, setTitle] = useState(''), [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState(''), [statement, setStatement] = useState('')
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<OfferingDocumentCommand | null>(null)
  const [pendingUpload, setPendingUpload] = useState<{ file: File; kind: typeof kind; title: string } | null>(null)
  const [retryBlocked, setRetryBlocked] = useState(false)
  const [resumeIntent, setResumeIntent] = useState<string | null>(null)
  const [staleRevision, setStaleRevision] = useState<number | null>(null)
  const needsFreshRevision = staleRevision !== null && product.revision <= staleRevision
  const generation = useRef(0)
  const current = documents && context && documents.revision_id === revision && documents.product_id === product.id
    && documents.document_access.actor_id === actorId && portalContextMatches(documents.document_access.context, context) ? documents : null
  const canStage = Boolean(current?.document_access.can_upload && current.profile === 'PDF_SIGNATURE_REQUIRED_V1'
    && product.status === 'IN_REVIEW' && !pending && !pendingUpload && !retryBlocked && !needsFreshRevision)
  const files = current?.files

  function checkedSnapshot(body: unknown): OfferingDocumentSnapshot {
    const parsed = offeringDocumentSnapshotSchema.safeParse(body)
    if (!parsed.success || !context || parsed.data.revision_id !== revision || parsed.data.product_id !== product.id
      || parsed.data.document_access.actor_id !== actorId || !portalContextMatches(parsed.data.document_access.context, context)) {
      throw new Error('The exact actor, context and document register could not be verified. Reload your saved package.')
    }
    return parsed.data
  }

  async function refresh(signal?: AbortSignal, expectedGeneration = generation.current) {
    if (!revision || !context) return
    const response = await fetch(fileUrl(revision, context), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The private document register is unavailable.')
    const value = checkedSnapshot(body)
    if (generation.current === expectedGeneration && !signal?.aborted) setDocuments(value)
  }

  useEffect(() => {
    const expectedGeneration = ++generation.current
    const controller = new AbortController()
    setDocuments(null); setMessage(''); setPending(null); setPendingUpload(null); setRetryBlocked(false); setResumeIntent(null); setStaleRevision(null); setBusy(false); setSelection({}); setFile(null); setTitle(''); setReason(''); setStatement('')
    if (revision && context) {
      try { setPending(readOfferingDocumentRetry(sessionStorage, { actorId, productId: product.id, revisionId: revision, context })) }
      catch { setRetryBlocked(true); setMessage('The saved document request journal is unavailable or invalid. No new action is sent; reconcile the original actor/context/revision first.') }
    }
    if (revision && context) void refresh(controller.signal, expectedGeneration).catch(error => {
      if (!controller.signal.aborted && generation.current === expectedGeneration) {
        setDocuments(undefined); setMessage(error instanceof Error ? error.message : 'The document register is unavailable.')
      }
    })
    return () => { controller.abort(); ++generation.current }
  }, [revision, product.id, actorId, context?.mode, context?.mode === 'ROLE' ? context.organisationId : '', context?.mode === 'ROLE' ? context.role : ''])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget, expectedGeneration = generation.current
    if (!canStage || !context || !revision || !file || busy || !offeringFileKindSchema.safeParse(kind).success
      || files?.some(item => item.kind === kind && item.id !== resumeIntent)) return
    if (file.size < 1 || file.size > offeringFileMaxBytes || file.type !== 'application/pdf') {
      setMessage('Select a PDF up to 4 MiB. No bytes are uploaded.'); return
    }
    if (resumeIntent) {
      const expected = files?.find(item => item.id === resumeIntent && item.intent_state === 'PENDING')
      try {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
        const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
        if (!expected || expected.sha256 !== actual || expected.size !== file.size || expected.kind !== kind || expected.title !== title) throw new Error()
      } catch { setMessage('Resume requires the exact reserved PDF bytes, size, category and title. No replacement is uploaded.'); return }
    }
    if (generation.current !== expectedGeneration) return
    await stage({ file, kind, title: resumeIntent ? title : title.trim() }, formElement)
  }

  async function stage(attempt: { file: File; kind: typeof kind; title: string }, formElement?: HTMLFormElement) {
    if (!context || !revision || busy || !current?.document_access.can_upload) return
    const expectedGeneration = generation.current
    let receiptConfirmed = false
    setPendingUpload(attempt)
    setBusy(true); setMessage('')
    const body = new FormData()
    body.set('file', attempt.file); body.set('kind', attempt.kind); body.set('title', attempt.title)
    body.set('product_id', product.id); body.set('revision_id', revision)
    try {
      const response = await fetch('/api/portal/offering-documents', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'x-bx1-operating-context': JSON.stringify(context), 'x-bx1-expected-actor': actorId }, body,
        signal: AbortSignal.timeout(45000),
      })
      const result = await response.json().catch(() => null)
      const receipt = offeringFileReceiptSchema.safeParse(result?.document)
      if (!response.ok || !receipt.success || receipt.data.revision_id !== revision || receipt.data.kind !== attempt.kind
        || receipt.data.size !== attempt.file.size || receipt.data.title !== attempt.title) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'The upload outcome is unknown. Refresh, then retry these same bytes, category and title; do not replace the object.')
      }
      receiptConfirmed = true
      if (generation.current === expectedGeneration) setPendingUpload(null)
      await refresh(undefined, expectedGeneration)
      if (generation.current !== expectedGeneration) return
      setMessage('Exact PDF bytes registered in quarantine. Await independent scanning; no approval or signature is implied.')
      setFile(null); setTitle(''); setResumeIntent(null); formElement?.reset()
    } catch (error) {
      if (generation.current === expectedGeneration) setMessage(receiptConfirmed ? 'The exact quarantine receipt was confirmed, but current processing state is unavailable. Refresh; no second upload is needed.'
        : error instanceof Error ? error.message : 'The upload outcome is unknown. Refresh before retrying the same file.')
    } finally { if (generation.current === expectedGeneration) setBusy(false) }
  }

  async function act(command: OfferingDocumentCommand) {
    if (!context || !revision || !current || busy || pendingUpload || retryBlocked || needsFreshRevision) return
    const expectedGeneration = generation.current
    const scope = { actorId, productId: product.id, revisionId: revision, context }
    let definiteRollback = false
    try { saveOfferingDocumentRetry(sessionStorage, scope, command) }
    catch { setRetryBlocked(true); setMessage('The original document request could not be saved or verified. No request was sent; no replacement action is available.'); return }
    setPending(command); setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/portal/offering-documents', {
        method: 'PUT', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_actor: actorId, operating_context: context, request: command }),
        signal: AbortSignal.timeout(20000),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        const payloadBytes = new TextEncoder().encode(offeringDocumentPayloadText(command))
        const digest = await crypto.subtle.digest('SHA-256', payloadBytes)
        const payloadHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
        if (offeringDocumentRollbackMatches(body?.rollback, scope, command, payloadHash)) {
          if (generation.current !== expectedGeneration) return
          clearOfferingDocumentRetry(sessionStorage, scope, command)
          definiteRollback = true
          setPending(null); setStaleRevision(command.payload.expected_revision)
          setMessage('The exact fresh request was definitely rolled back with no effects. Use Refresh saved state to obtain the current product revision before creating a new request.')
          await refresh(undefined, expectedGeneration)
          return
        }
      }
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The document action outcome is unknown.')
      const value = checkedSnapshot(body)
      if (command.command === 'seal_offering_document_manifest') {
        if (!value.manifest || JSON.stringify(value.manifest.file_ids) !== JSON.stringify(command.payload.file_ids)
          || value.manifest.correspondence_statement !== command.payload.correspondence_statement) throw new Error('The exact sealed result could not be confirmed.')
      } else {
        const intentId = command.payload.intent_id
        const intent = value.files.find(item => item.id === intentId)
        if (!intent || !['REJECTED', 'EXCLUDED'].includes(intent.intent_state)) throw new Error('The exact terminal intent resolution could not be confirmed.')
      }
      if (generation.current !== expectedGeneration) return
      clearOfferingDocumentRetry(sessionStorage, scope, command)
      setDocuments(value); setPending(null)
      setMessage(command.command === 'seal_offering_document_manifest' ? value.document_access.version === 2 ? 'Exact clean manifest sealed. Continue with the separate issuer signing purpose; sealing is not approval.' : 'Exact clean manifest sealed. Signatures are not connected; approval remains blocked.' : 'Intent resolution recorded without deleting or relabelling historical evidence.')
    } catch (error) {
      if (generation.current === expectedGeneration) {
        if (definiteRollback) {
          setDocuments(undefined)
          setMessage('The exact request was definitely rolled back with no effects, but current document state is unavailable. Use Refresh saved state before a new action.')
        } else setMessage(`${error instanceof Error ? error.message : 'The outcome is unknown.'} Refresh saved state and retry only this unchanged request identity.`)
      }
    } finally { if (generation.current === expectedGeneration) setBusy(false) }
  }

  return <Panel title="Private offering documents" description="Exact PDF bytes and immutable evidence; distinct from text hashes, legal approval and signatures.">
    {!revision || !context ? <Notice title="No current document register">Submit a new offering package in an authorised context before staging a file.</Notice> : <div className={styles.stack}>
      <Notice title="Independent bytes, not legal sign-off">A quarantined PDF is not an approved offering disclosure, a verified title document, or e-signature evidence. CLEAN means the scanner accepted exact bytes; correspondence with the submitted text is separately declared.</Notice>
      {documents === null ? <p className={styles.muted}>Checking current document authority…</p> : !current ? <Notice title="Document authority unavailable" tone="warning">Refresh the saved package. No missing file or permission is inferred from an unavailable register.</Notice> : <>
        <Notice title={current.state.replaceAll('_', ' ')} tone={current.state === 'NOT_ADMITTED' || current.state === 'SEALED_SIGNATURE_REQUIRED' ? 'warning' : 'info'}>{current.document_access.version === 2 && current.state === 'SEALED_SIGNATURE_REQUIRED' ? current.document_access.approval_allowed ? 'Current signature evidence is retained. The appointed issuer and independent Compliance must still make their separate offering decisions. Publication remains a separate gate.' : 'The exact manifest is sealed. Use Issuer package execution for the current purpose, provider state and next responsible owner. Approval remains blocked until current signature evidence is retained.' : nextStep[current.state]}</Notice>
        {current.manifest ? <><p>Sealed manifest <span className={styles.mono}>{current.manifest.hash}</span></p><p className={styles.copy}>{current.manifest.correspondence_statement}</p></> : null}
        {files?.length ? <ul>{files.map(item => <li key={item.id}><strong>{item.kind.replaceAll('_', ' ')}</strong> · {item.title} · {item.intent_state.replaceAll('_', ' ').toLowerCase()}{item.processing_state ? ` · ${item.processing_state.replaceAll('_', ' ').toLowerCase()}` : ''}{item.selected ? ' · selected in sealed manifest' : ''}<br /><span className={styles.mono}>{item.sha256}</span>{item.can_download ? <> · <a className={styles.textLink} href={fileUrl(revision, context, item.id)}>{item.selected ? 'Download selected clean PDF' : 'Download my quarantined PDF'}</a></> : null}
          {!pending && !pendingUpload && !retryBlocked && !needsFreshRevision && current.document_access.allowed_commands.includes('resolve_offering_file_intent') && !item.selected && ['PENDING', 'REJECTED'].includes(item.intent_state) ? <button type="button" className={styles.buttonSecondary} disabled={busy || reason.trim().length < 20 || item.processing_state === 'LEASED'} onClick={() => void act({ command: 'resolve_offering_file_intent', key: crypto.randomUUID(), payload: { product_id: product.id, offering_revision_id: revision, expected_revision: product.revision, intent_id: item.id, reason: reason.trim() } })}>{item.intent_state === 'REJECTED' ? 'Confirm rejected intent resolution' : 'Exclude this intent with reason'}</button> : null}
        </li>)}</ul> : <p className={styles.muted}>No immutable PDF intents are recorded for this revision.</p>}
        {!pending && current.document_access.allowed_commands.includes('resolve_offering_file_intent') ? <Field label="Intent resolution reason" hint="20 to 1,000 characters. No active lease or sealed evidence can be excluded."><textarea minLength={20} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></Field> : null}
      </>}
      <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void refresh().catch(error => setMessage(error instanceof Error ? error.message : 'The current register is unavailable.'))}>Refresh processing state</button>
      {message ? <p className={styles.fieldError} role="status">{message}</p> : null}
      {retryBlocked ? <Notice title="Document request journal unavailable" tone="warning">No new action can replace an unverified saved request. Reload the original account/context and reconcile its exact request before continuing.</Notice> : null}
      {needsFreshRevision ? <Notice title="Fresh request rolled back; revision refresh required" tone="warning">No effect was recorded for the matching request. Use Refresh saved state above; a new action needs the latest product revision, not another attempt with the stale input.</Notice> : null}
      {pending ? <Notice title="Document action requires reconciliation" tone="warning">No new document action is available while this request is unresolved. <button type="button" className={styles.buttonSecondary} disabled={busy || !current?.document_access.allowed_commands.includes(pending.command)} onClick={() => void act(pending)}>Retry the same document request</button></Notice> : null}
      {pendingUpload ? <Notice title="Upload requires reconciliation" tone="warning">The same file, category and title are retained. No replacement upload or manifest action is available. <button type="button" className={styles.buttonSecondary} disabled={busy || !current?.document_access.can_upload} onClick={() => void stage(pendingUpload)}>Retry the same PDF bytes</button></Notice> : null}
      {canStage ? <form className={styles.form} onSubmit={event => void submit(event)}><fieldset className={styles.fieldset} disabled={busy}>
        <Field label="Document category"><select disabled={resumeIntent !== null} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="MEMORANDUM">Offering memorandum</option><option value="RISKS">Risk disclosures</option><option value="SUBSCRIPTION_TERMS">Subscription agreement</option></select></Field>
        <Field label="File title"><input disabled={resumeIntent !== null} required minLength={1} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></Field>
        <Field label="Private PDF, maximum 4 MiB"><input type="file" required accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>
        {files?.some(item => item.kind === kind) ? <p className={styles.muted}>This category already has an immutable intent. Resume only the exact original bytes, or resolve it and use a permitted fresh same-terms revision; never overwrite its bytes.</p> : null}
        <button type="submit" className={styles.buttonSecondary} disabled={!file || !title.trim() || files?.some(item => item.kind === kind && item.id !== resumeIntent)}>{busy ? 'Staging exact private bytes…' : resumeIntent ? 'Resume exact reserved PDF' : 'Stage in quarantine'}</button>
        {files?.filter(item => item.intent_state === 'PENDING').map(item => <button type="button" key={item.id} className={styles.buttonSecondary} onClick={() => { setResumeIntent(item.id); setKind(item.kind); setTitle(item.title); setFile(null); setMessage('Select the exact original PDF. Its size and byte hash must match this immutable reservation before any request is sent.') }}>Select {item.kind.replaceAll('_', ' ').toLowerCase()} reservation to resume</button>)}
      </fieldset></form> : <p className={styles.muted}>PDF staging is closed for this current authority/state. Use the responsible owner's next step above.</p>}
      {!pending && !pendingUpload && !retryBlocked && !needsFreshRevision && current?.state === 'READY_TO_SEAL' && current.document_access.allowed_commands.includes('seal_offering_document_manifest') ? <form className={styles.form} onSubmit={event => {
        event.preventDefault()
        const ids = offeringFileKindSchema.options.map(category => selection[category])
        if (busy || ids.some(value => !value) || new Set(ids).size !== 3 || statement.trim().length < 20) return
        void act({ command: 'seal_offering_document_manifest', key: crypto.randomUUID(), payload: { product_id: product.id, offering_revision_id: revision, expected_revision: product.revision, file_ids: ids as [string, string, string], correspondence_statement: statement.trim() } })
      }}><fieldset className={styles.fieldset} disabled={busy}>
        {offeringFileKindSchema.options.map(category => <Field key={category} label={`Clean ${category.replaceAll('_', ' ').toLowerCase()}`}><select required value={selection[category] ?? ''} onChange={event => setSelection(value => ({ ...value, [category]: event.target.value }))}><option value="">Select exact clean bytes</option>{files?.filter(item => item.kind === category && item.intent_state === 'PROMOTED_CLEAN').map(item => <option key={item.id} value={item.id}>{item.title} · {item.sha256}</option>)}</select></Field>)}
        <Field label="PDF/text correspondence declaration" hint="20 to 3,000 characters; a declaration, not independently verified legal equivalence."><textarea required minLength={20} maxLength={3000} value={statement} onChange={event => setStatement(event.target.value)} /></Field>
        <button type="submit" className={styles.buttonSecondary} disabled={statement.trim().length < 20 || offeringFileKindSchema.options.some(category => !selection[category])}>Seal exact three-PDF manifest</button>
      </fieldset></form> : null}
    </div>}
  </Panel>
}
