'use client'

import { useEffect, useState, type FormEvent } from 'react'
import type { PortalProduct } from '@/lib/portal/contracts'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import { offeringFileIntakeEnabled, offeringFileKindSchema, offeringFileListItemSchema } from '@/lib/portal/offering-files'
import { Field, Notice, Panel } from './portal-primitives'
import styles from './portal.module.css'

type FileItem = ReturnType<typeof offeringFileListItemSchema.parse>

function fileUrl(revisionId: string, context: PortalOperatingContext, id?: string): string {
  const query = new URLSearchParams({ revision_id: revisionId })
  if (context.mode === 'APPLICANT') query.set('mode', 'applicant')
  else { query.set('organisation', context.organisationId); query.set('role', context.role) }
  if (id) { query.set('id', id); query.set('download', '1') }
  return `/api/portal/offering-documents?${query}`
}

export function OfferingFilePanel({ product, context, actorId }: {
  product: PortalProduct; context?: PortalOperatingContext; actorId: string
}) {
  const revision = product.offering_package?.origin === 'SUBMITTED' ? product.offering_package.id : null
  const [files, setFiles] = useState<FileItem[] | null | undefined>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'MEMORANDUM' | 'RISKS' | 'SUBSCRIPTION_TERMS'>('MEMORANDUM')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const canStage = Boolean(offeringFileIntakeEnabled && context && revision && product.status === 'IN_REVIEW'
    && (context.mode === 'APPLICANT' || context.role === 'OfferingManager')
    && product.offering_package?.issuer_status === 'PENDING'
    && product.offering_package?.compliance_status === 'PENDING')

  async function refresh(signal?: AbortSignal) {
    if (!revision || !context) return
    const response = await fetch(fileUrl(revision, context), {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || !Array.isArray(body.documents)) {
      throw new Error(typeof body?.error === 'string' ? body.error : 'The private file register is unavailable.')
    }
    const parsed = offeringFileListItemSchema.array().safeParse(body.documents)
    if (!parsed.success || parsed.data.some(item => item.revision_id !== revision)) {
      throw new Error('The private file register could not be verified.')
    }
    setFiles(parsed.data)
  }

  useEffect(() => {
    if (!revision || !context) return
    const controller = new AbortController()
    setFiles(null); setMessage('')
    void refresh(controller.signal).catch(error => {
      if (!controller.signal.aborted) {
        setFiles(undefined)
        setMessage(error instanceof Error ? error.message : 'The file register is unavailable.')
      }
    })
    return () => controller.abort()
  }, [revision, context?.mode, context?.mode === 'ROLE' ? context.organisationId : '', context?.mode === 'ROLE' ? context.role : ''])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canStage || !context || !revision || !file || busy || !offeringFileKindSchema.safeParse(kind).success) return
    const formElement = event.currentTarget
    setBusy(true); setMessage('')
    const body = new FormData()
    body.set('file', file); body.set('kind', kind); body.set('title', title.trim())
    body.set('product_id', product.id); body.set('revision_id', revision)
    try {
      const response = await fetch('/api/portal/offering-documents', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'x-bx1-operating-context': JSON.stringify(context), 'x-bx1-expected-actor': actorId }, body,
        signal: AbortSignal.timeout(45000),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.document?.validation_state !== 'QUARANTINED') {
        throw new Error(typeof result?.error === 'string' ? result.error : 'The upload outcome is unknown. Refresh the register before retrying the same file.')
      }
      await refresh()
      setMessage('PDF staged in private quarantine. It has not been scanned, reviewed, approved or e-signed.')
      setFile(null); setTitle('')
      formElement.reset()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The upload outcome is unknown. Refresh before retrying.')
    } finally { setBusy(false) }
  }

  return <Panel title="Private offering-file intake" description="Supplemental PDFs linked to a submitted package; separate from its approved disclosure text.">
    {!revision || !context ? <Notice title="No current file register">Submit a new offering package in an authorised context before staging a file.</Notice> : <div className={styles.stack}>
      <Notice title="PDF intake unavailable" tone="warning">Offering PDF uploads are disabled until independent file verification and a safe resolution path are connected. A quarantined PDF is not an approved offering disclosure, a verified title document, or e-signature evidence. Existing unverified file intents would block approval of their exact revision; no new upload is accepted here.</Notice>
      {files === null ? <p className={styles.muted}>Checking the private file register…</p>
        : files === undefined ? <Notice title="Private file register unavailable" tone="warning">Refresh the saved package before making another upload. No absence of a file is inferred.</Notice>
        : files.length ? <ul>{files.map(item => <li key={item.id}><strong>{item.kind.replaceAll('_', ' ')}</strong> · {item.title} · quarantined, unscanned<br /><span className={styles.mono}>{item.sha256}</span>{item.can_download ? <> · <a className={styles.textLink} href={fileUrl(revision, context, item.id)}>Download my unscanned PDF</a></> : null}</li>)}</ul>
          : <p className={styles.muted}>No supplemental PDFs are recorded for this revision.</p>}
      {message ? <p className={styles.fieldError} role="status">{message}</p> : null}
      {canStage ? <form className={styles.form} onSubmit={event => void submit(event)}>
        <Field label="Document category"><select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="MEMORANDUM">Offering memorandum</option><option value="RISKS">Risk disclosures</option><option value="SUBSCRIPTION_TERMS">Subscription agreement</option></select></Field>
        <Field label="File title"><input required minLength={1} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></Field>
        <Field label="Private PDF, maximum 4 MiB"><input type="file" required accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>
        {files?.some(item => item.kind === kind) ? <p className={styles.muted}>This category already has an immutable quarantined file in this revision. A correction requires a new revision.</p> : null}
        <button type="submit" className={styles.buttonSecondary} disabled={busy || files === null || files === undefined || files?.some(item => item.kind === kind) || !file || !title.trim()}>{busy ? 'Staging private PDF…' : 'Stage in quarantine'}</button>
      </form> : <p className={styles.muted}>The PDF action is closed. Submitted text disclosures remain a separate package workflow; do not treat them as signed files.</p>}
    </div>}
  </Panel>
}
