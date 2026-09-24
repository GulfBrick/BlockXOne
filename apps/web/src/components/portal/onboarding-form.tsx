'use client'

import { useEffect, useRef, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { z } from 'zod'
import { applicationDocumentVersionsSchema, evidenceSchema, isWealthManagerDetailsV2, ownershipControlRelationshipSchema, type ApplicationDetails, type ApplicationDocumentVersions, type EvidenceDocument, type LegacyApplicationDetails, type OwnershipControlRelationship, type Persona, type WealthManagerApplicationDetailsV2 } from '@/lib/portal/contracts'
import type { EntryApplication, EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, usePortalActorId, usePortalOperatingContext } from './portal-client'
import { useEntryCommand } from './entry-client'
import { portalScopeHref } from '@/lib/portal/operating-context'
import { DetailList, Field, FormProgress, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import { KycVerification } from './kyc-verification'
import styles from './portal.module.css'

type FormDetails = Omit<LegacyApplicationDetails, 'details_version' | 'business_activities' | 'representative_position' | 'authority_basis'> & Pick<WealthManagerApplicationDetailsV2, 'business_activities' | 'representative_position' | 'authority_basis'> & {
  ownership_control: OwnershipControlRelationship[]; ownership_change_reason: string;
}
const scanQueueItemSchema = z.object({
  id: z.string().uuid(), kind: evidenceSchema.shape.kind, title: z.string(),
  state: z.enum(['QUARANTINED', 'SCANNED_CLEAN', 'REJECTED']), created_at: z.string(),
}).strict()
const scanQueueSchema = z.object({ documents: z.array(scanQueueItemSchema) }).strict()
type ScanQueueItem = z.infer<typeof scanQueueItemSchema>

export function classifyDocumentUpload(status: number, value: unknown): { kind: 'QUARANTINED' | 'ATTACHABLE'; document: z.infer<typeof evidenceSchema> } | null {
  const result = z.object({ document: evidenceSchema, validation_state: z.string() }).passthrough().safeParse(value)
  if (!result.success) return null
  if (status === 202 && result.data.validation_state === 'QUARANTINED') return { kind: 'QUARANTINED', document: result.data.document }
  if ([200, 201].includes(status) && ['SYNTHETIC_UNSCANNED', 'LEGACY_UNVERIFIED'].includes(result.data.validation_state))
    return { kind: 'ATTACHABLE', document: result.data.document }
  return null
}

export function requiresOwnershipDisclosure(persona: Persona, investorType: LegacyApplicationDetails['investor_type']) {
  return persona === 'WEALTH_MANAGER' || investorType === 'ENTITY'
}

export function newOwnershipRelationship(): OwnershipControlRelationship {
  return { id: crypto.randomUUID(), party_type: 'PERSON', legal_name: '', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 0, control_basis: '', effective_on: '', change_reason: '', evidence_document_id: '' }
}

/** Carry shared historical facts forward, never reinterpret investor answers as organisation facts. */
export function applicationFormDetails(application: EntryApplication): FormDetails {
  const details = application.details
  const manager = isWealthManagerDetailsV2(details) ? details : null
  const structured = 'ownership_control' in details && Array.isArray(details.ownership_control) ? details : null
  return {
    full_name: details.full_name ?? '', country: details.country ?? 'ZA',
    company_name: details.company_name ?? '', registration_reference: details.registration_reference ?? '',
    beneficial_owners: details.beneficial_owners ?? '', documents: details.documents ?? [], test_data_acknowledged: true,
    investor_type: 'investor_type' in details && details.investor_type === 'ENTITY' ? 'ENTITY' : 'INDIVIDUAL',
    source_of_funds: 'source_of_funds' in details ? details.source_of_funds ?? '' : '',
    experience: 'experience' in details ? details.experience ?? '' : '',
    business_activities: manager?.business_activities ?? '', representative_position: manager?.representative_position ?? '',
    authority_basis: manager?.authority_basis ?? '',
    ownership_control: structured?.ownership_control ?? [], ownership_change_reason: structured?.ownership_change_reason ?? '',
  }
}

export function applicationSubmissionDetails(persona: Persona, details: FormDetails): ApplicationDetails {
  const shared = { full_name: details.full_name, country: details.country, company_name: details.company_name, registration_reference: details.registration_reference, beneficial_owners: details.beneficial_owners, documents: details.documents, test_data_acknowledged: true as const }
  return persona === 'WEALTH_MANAGER'
    ? { ...shared, details_version: 3, business_activities: details.business_activities, representative_position: details.representative_position, authority_basis: details.authority_basis, ownership_control: details.ownership_control, ownership_change_reason: details.ownership_change_reason }
    : details.investor_type === 'ENTITY'
      ? { ...shared, details_version: 3, investor_type: 'ENTITY', source_of_funds: details.source_of_funds, experience: details.experience, ownership_control: details.ownership_control, ownership_change_reason: details.ownership_change_reason }
      : { ...shared, investor_type: 'INDIVIDUAL', source_of_funds: details.source_of_funds, experience: details.experience }
}

export function requiredApplicationEvidence(persona: Persona, investorType: LegacyApplicationDetails['investor_type']) {
  return persona === 'WEALTH_MANAGER' || investorType === 'ENTITY'
    ? [{ kind: 'IDENTITY', label: 'Representative identity evidence' }, { kind: 'COMPANY', label: 'Organisation registration evidence' }, { kind: 'BENEFICIAL_OWNERS', label: 'Beneficial ownership evidence' }]
    : [{ kind: 'IDENTITY', label: 'Identity evidence' }]
}

export function applicationSubmitLabel(application: EntryApplication): string {
  return application.review_route !== 'AVAILABLE' ? 'Check review route and submit' : application.status === 'CHANGES_REQUIRED' ? 'Resubmit for review' : 'Submit for review'
}

export function applicationSubmissionReady(persona: Persona, details: FormDetails, acknowledged: boolean, locked: boolean): boolean {
  const evidenceReady = requiredApplicationEvidence(persona, details.investor_type).every(item => details.documents.some(document => document.kind === item.kind))
  const ownershipReady = !requiresOwnershipDisclosure(persona, details.investor_type) || (details.ownership_change_reason.trim().length >= 20
    && details.ownership_control.length > 0 && details.ownership_control.every(relationship => {
      return ownershipControlRelationshipSchema.safeParse(relationship).success
        && details.documents.some(document => document.id === relationship.evidence_document_id && document.kind === 'BENEFICIAL_OWNERS')
    }))
  return !locked && acknowledged && evidenceReady && ownershipReady
}

export function withoutDraftEvidence(documents: EvidenceDocument[], documentId: string): EvidenceDocument[] {
  return documents.filter(document => document.id !== documentId)
}

export function ApplicationDetailsSummary({ persona, details }: { persona: Persona; details: Partial<ApplicationDetails> }) {
  const manager = isWealthManagerDetailsV2(details) ? details : null
  const legacyManager = persona === 'WEALTH_MANAGER' && !manager
  return <div className={styles.stack}>
    {legacyManager ? <Notice title="Original legacy answers">These are the answers recorded on the earlier investor-shaped form. They are not evidence of business activities, representative position or authority basis. New organisation facts must be supplied explicitly.</Notice> : null}
    <DetailList rows={[
      { label: persona === 'WEALTH_MANAGER' ? 'Representative name' : 'Applicant name', value: details.full_name || 'Not provided' },
      { label: 'Country of residence', value: details.country || 'Not provided' },
      ...(manager ? [{ label: 'Customer organisation', value: manager.company_name }, { label: 'Registration reference', value: manager.registration_reference }, { label: 'Representative position', value: manager.representative_position }]
        : [{ label: legacyManager ? 'Legacy investor classification' : 'Investor classification', value: 'investor_type' in details ? details.investor_type || 'Not provided' : 'Not provided' }, { label: legacyManager ? 'Legacy company / issuing entity' : 'Entity name', value: details.company_name || 'Not applicable' }, { label: 'Registration reference', value: details.registration_reference || 'Not applicable' }]),
    ]} />
    {manager ? <><section><h3>Business activities and requested services</h3><p className={styles.copy}>{manager.business_activities}</p></section><section><h3>Basis of representative authority</h3><p className={styles.copy}>{manager.authority_basis}</p></section></>
      : <><section><h3>{legacyManager ? 'Legacy source-of-funds answer' : 'Source of funds'}</h3><p className={styles.copy}>{'source_of_funds' in details ? details.source_of_funds || 'Not provided' : 'Not provided'}</p></section><section><h3>{legacyManager ? 'Legacy investment experience and objectives' : 'Investment experience and objectives'}</h3><p className={styles.copy}>{'experience' in details ? details.experience || 'Not provided' : 'Not provided'}</p></section></>}
    {details.beneficial_owners ? <section><h3>Ownership and representation</h3><p className={styles.copy}>{details.beneficial_owners}</p></section> : null}
    {'ownership_control' in details && Array.isArray(details.ownership_control) ? <section><h3>Disclosed ownership and control relationships</h3><p className={styles.muted}>These are submitted facts for independent review, not BlockXOne roles, mandates or wallet authority.</p><p className={styles.copy}>{'ownership_change_reason' in details ? details.ownership_change_reason : ''}</p>{details.ownership_control.map(relationship => <div key={relationship.id} className={styles.sectionGap}><DetailList rows={[{ label: 'Party', value: `${relationship.legal_name} (${relationship.party_type})` }, { label: 'Relationship', value: relationship.relationship.replaceAll('_', ' ') }, { label: 'Disclosed economic ownership', value: `${(relationship.ownership_basis_points / 100).toFixed(2)}%` }, { label: 'Effective from', value: relationship.effective_on }, { label: 'Control basis', value: relationship.control_basis }, { label: 'Change reason', value: relationship.change_reason }, { label: 'Linked evidence', value: relationship.evidence_document_id }]} /></div>)}</section> : null}
  </div>
}

export function applicationNextStep(application: EntryApplication): { title: string; description: string; owner: string } {
  if (application.status === 'APPROVED') return application.persona === 'WEALTH_MANAGER' && application.admission_purpose !== 'LEGACY_REHEARSAL'
    ? { title: 'Customer admission approved; operating assignment pending', description: 'The test customer-admission decision is recorded. BlockXOne must separately approve the organisation, role and mandate you may operate under. No product, financial or signing powers were granted by this application.', owner: 'BlockXOne authorised assignment owner' }
    : { title: 'Review decision recorded', description: application.persona === 'INVESTOR' ? 'Continue to the available investor workflow. Product-specific eligibility, a current approval and an authorised investment account are checked separately.' : 'Your historical rehearsal relationship remains separate from native organisation roles. Existing product actions still recheck their current authority.', owner: 'You, within your approved scope' }
  if (application.status === 'REJECTED') return { title: 'Application not approved', description: 'Read the recorded rationale. Contact the BlockXOne onboarding owner with this application reference to discuss the decision. A new capacity does not reverse it.', owner: 'You and the BlockXOne onboarding owner' }
  if (application.status === 'CHANGES_REQUIRED') return { title: 'Your changes are required', description: 'Read the reviewer feedback, update the requested facts and evidence, then resubmit this same application. Previous submitted revisions remain in its history.', owner: 'You, the applicant' }
  if (application.review_route === 'REVIEWER_UNAVAILABLE') return { title: 'Independent reviewer not assigned', description: application.status === 'SUBMITTED' ? 'Your submitted case is preserved, but no eligible independent reviewer is currently assigned. The BlockXOne onboarding owner must restore the review handoff.' : 'You can prepare these fields, but submission is unavailable until the BlockXOne onboarding owner assigns an eligible independent reviewer. Your browser edits have not been saved.', owner: 'BlockXOne onboarding owner' }
  if (application.review_route !== 'AVAILABLE') return { title: 'Review route not admitted', description: 'The BlockXOne onboarding owner must admit the review route for this context before evidence can be submitted. No approval is implied.', owner: 'BlockXOne onboarding owner' }
  return application.status === 'SUBMITTED'
    ? { title: 'Awaiting an independent decision', description: 'Your saved evidence package is awaiting the assigned BlockXOne compliance review function. Refresh status to see a decision or a request for information; do not submit a duplicate.', owner: 'BlockXOne independent compliance review' }
    : { title: 'Draft: not submitted', description: 'Complete your details and private evidence, then select Submit for review. Changes remain in this browser until the server confirms submission.', owner: 'You, the applicant' }
}

export function PrivateDocument({ document, history }: { document: Pick<EvidenceDocument, 'id' | 'kind' | 'title' | 'size'>; history?: { applicationId: string; revision: number } }) {
  const operatingContext = usePortalOperatingContext()
  const [url, setUrl] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const contextKey = JSON.stringify(operatingContext)
  useEffect(() => { setUrl(''); setMessage('') }, [contextKey, document.id, history?.applicationId, history?.revision])
  async function prepare() {
    setBusy(true); setMessage('')
    try {
      const target = history ? `/api/portal/documents?application_id=${encodeURIComponent(history.applicationId)}&revision=${history.revision}&id=${encodeURIComponent(document.id)}` : `/api/portal/documents?id=${encodeURIComponent(document.id)}`
      const response = await fetch(portalScopeHref(target, operatingContext), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      if (!response.ok || typeof result.url !== 'string') throw new Error('The private document could not be opened. Your access may have changed.')
      const download = new URL(result.url, window.location.origin)
      if (download.origin !== window.location.origin || download.protocol !== 'https:') throw new Error('The platform returned an invalid document link.')
      setUrl(`${download.pathname}${download.search}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to open the document.') }
    finally { setBusy(false) }
  }
  return <div className={styles.sectionGap}><div className={styles.actions}><FileCheck2 size={18} aria-hidden="true" /><span>{document.title}</span>{url ? <a href={url} target="_blank" rel="noreferrer noopener" className={styles.textLink}>Open private document</a> : <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void prepare()}>{busy ? 'Checking access…' : 'View document'}</button>}</div><p className={styles.muted}>{document.kind.replaceAll('_', ' ')} · {Math.ceil(document.size / 1024)} KB · Private evidence</p>{message ? <p role="status" className={styles.fieldError}>{message}</p> : null}</div>
}

export type ApplicationHistoryFailure = 'SESSION' | 'ACCESS' | 'UNAVAILABLE'

export function applicationHistoryFailure(status: number): ApplicationHistoryFailure {
  if (status === 401) return 'SESSION'
  if (status === 403 || status === 404) return 'ACCESS'
  return 'UNAVAILABLE'
}

export function ApplicationHistoryFailureNotice({ reason }: { reason: ApplicationHistoryFailure }) {
  return <div role="status" className={styles.fieldError}>
    <p>{reason === 'SESSION' ? 'Your sign-in session could not be confirmed. Sign in again, then retry.' : reason === 'ACCESS' ? 'Access to submitted history was not confirmed for this session.' : 'Submitted history could not be loaded. This may be a temporary service problem; retry shortly.'}</p>
    <p>Check your active capacity and, if authenticator verification is needed, complete it in <a href="/workspace/security" className={styles.textLink}>Account security</a>. If access remains unavailable, ask the onboarding owner to check this application.</p>
    {reason === 'SESSION' ? <a href="/login" className={styles.textLink}>Sign in again</a> : null}
  </div>
}

export function ApplicationDocumentHistory({ applicationId }: { applicationId: string }) {
  const operatingContext = usePortalOperatingContext()
  const scopeKey = `${applicationId}:${JSON.stringify(operatingContext)}`
  const requestGeneration = useRef(0)
  const [loaded, setLoaded] = useState<{ scopeKey: string; value: ApplicationDocumentVersions } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ApplicationHistoryFailure | null>(null)
  useEffect(() => {
    requestGeneration.current += 1
    setLoaded(null); setBusy(false); setFailure(null)
    return () => { requestGeneration.current += 1 }
  }, [scopeKey])
  async function loadHistory() {
    const request = ++requestGeneration.current
    // Revoke the previous client view before rechecking current authority.
    setLoaded(null); setBusy(true); setFailure(null)
    try {
      const url = portalScopeHref(`/api/portal/documents?application_id=${encodeURIComponent(applicationId)}&history=1`, operatingContext)
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!response.ok) { if (request === requestGeneration.current) setFailure(applicationHistoryFailure(response.status)); return }
      const parsed = applicationDocumentVersionsSchema.safeParse(await response.json())
      if (!parsed.success || parsed.data.application_id !== applicationId) throw new Error()
      if (request === requestGeneration.current) setLoaded({ scopeKey, value: parsed.data })
    } catch { if (request === requestGeneration.current) setFailure('UNAVAILABLE') }
    finally { if (request === requestGeneration.current) setBusy(false) }
  }
  const history = loaded?.scopeKey === scopeKey ? loaded.value : null
  return <Panel title="Submitted evidence history" description="Immutable submission versions remain separate from your unsaved draft. Each private download rechecks current authority and the file bytes.">
    <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void loadHistory()}>{busy ? 'Loading submitted versions...' : history ? 'Refresh submitted versions' : 'View submitted versions'}</button>
    {failure ? <ApplicationHistoryFailureNotice reason={failure} /> : null}
    {history ? history.versions.length ? <div className={`${styles.stack} ${styles.sectionGap}`}>{[...history.versions].sort((a, b) => b.revision - a.revision).map(version => <section key={version.revision} className={styles.panelBody}><h3>Submission revision {version.revision}</h3><p className={styles.muted}>Submitted {dateLabel(version.submitted_at)} · {version.capture_kind === 'MIGRATION_SNAPSHOT' ? 'Preserved historical submission' : 'Recorded submission'}</p>{version.documents.length ? version.documents.map(document => <PrivateDocument key={`${version.revision}:${document.id}`} document={document} history={{ applicationId, revision: version.revision }} />) : <p className={styles.muted}>No evidence files were recorded in this version.</p>}</section>)}</div> : <p className={styles.muted}>No submitted evidence versions are recorded for this application.</p> : null}
  </Panel>
}

export function OnboardingForm({ application, environment, onSaved, receipts }: { application: EntryApplication; environment: PlatformEnvironment; onSaved: (snapshot: EntrySnapshot) => void; receipts?: EntrySnapshot['requests'] }) {
  const operatingContext = usePortalOperatingContext()
  const expectedActor = usePortalActorId()
  const persona = application.persona
  const [details, setDetails] = useState<FormDetails>(() => applicationFormDetails(application))
  const [acknowledged, setAcknowledged] = useState(false)
  const [uploadKind, setUploadKind] = useState('IDENTITY')
  const [uploadTitle, setUploadTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [scanQueue, setScanQueue] = useState<ScanQueueItem[] | null>(null)
  const [scanMessage, setScanMessage] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const [attachingScan, setAttachingScan] = useState('')
  const [pendingForApplication, setPendingForApplication] = useState<string[]>([])
  const scanScope = `${environment}:${expectedActor}:${application.id}:${application.revision}`
  const activeScanScope = useRef(scanScope)
  activeScanScope.current = scanScope
  useEffect(() => {
    setScanQueue(null); setScanMessage(''); setScanBusy(false); setAttachingScan(''); setPendingForApplication([])
  }, [scanScope])
  const command = useEntryCommand(expectedActor, environment, onSaved, receipts)
  const editable = ['DRAFT', 'CHANGES_REQUIRED'].includes(application.status)
  const locked = !editable || command.busy || command.unknown || uploadBusy || Boolean(attachingScan)
  const reviewAvailable = application.review_route === 'AVAILABLE'
  const requiredEvidence = requiredApplicationEvidence(persona, details.investor_type)
  const submitReady = applicationSubmissionReady(persona, details, acknowledged, locked) && pendingForApplication.length === 0
  const next = applicationNextStep(application)
  const legacyManager = persona === 'WEALTH_MANAGER' && !isWealthManagerDetailsV2(application.details) && Object.keys(application.details).length > 0
  function change<K extends keyof FormDetails>(key: K, value: FormDetails[K]) { setDetails(current => ({ ...current, [key]: value })) }
  function changeRelationship(id: string, patch: Partial<OwnershipControlRelationship>) {
    setDetails(current => ({ ...current, ownership_control: current.ownership_control.map(item => item.id === id ? { ...item, ...patch } : item) }))
  }
  async function upload() {
    if (!file || !uploadTitle.trim()) { setUploadMessage('Choose a file and give the evidence a descriptive title.'); return }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 4_194_304 || file.size === 0) { setUploadMessage('Use a PDF, PNG or JPEG between 1 byte and 4 MiB.'); return }
    if (details.documents.length + pendingForApplication.length >= 8) { setUploadMessage('A maximum of eight evidence files can be attached or awaiting a scan.'); return }
    const scope = scanScope
    setUploadBusy(true); setUploadMessage('')
    try {
      const body = new FormData(); body.set('file', file); body.set('kind', uploadKind); body.set('title', uploadTitle.trim())
      const response = await fetch('/api/portal/documents', { method: 'POST', body, headers: { 'x-bx1-operating-context': JSON.stringify(operatingContext), 'x-bx1-expected-actor': expectedActor }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000) })
      const result = await response.json()
      if (activeScanScope.current !== scope) return
      const upload = classifyDocumentUpload(response.status, result)
      if (!response.ok || !upload) throw new Error(typeof result.error === 'string' ? result.error : 'The upload state was not confirmed. Do not submit this file.')
      setFile(null); setUploadTitle('')
      if (upload.kind === 'QUARANTINED') {
        setPendingForApplication(current => current.includes(upload.document.id) ? current : [...current, upload.document.id])
        setScanQueue(current => current ? [
          { id: upload.document.id, kind: upload.document.kind, title: upload.document.title, state: 'QUARANTINED', created_at: new Date().toISOString() },
          ...current.filter(item => item.id !== upload.document.id),
        ] : [{ id: upload.document.id, kind: upload.document.kind, title: upload.document.title, state: 'QUARANTINED', created_at: new Date().toISOString() }])
        setUploadMessage('File quarantined for an independent scan. It is not attached to this application and cannot satisfy a submission requirement. Check the scan queue before submitting.')
      } else {
        change('documents', [...details.documents, upload.document]); setUploadMessage('File uploaded privately. Its application attachment and these fields are not saved until submission is confirmed.')
      }
    } catch (error) { if (activeScanScope.current === scope) setUploadMessage(error instanceof Error ? error.message : 'The upload was not confirmed.'); }
    finally { if (activeScanScope.current === scope) setUploadBusy(false) }
  }
  async function refreshScanQueue() {
    if (scanBusy) return
    const scope = scanScope
    setScanBusy(true); setScanMessage('')
    try {
      const response = await fetch('/api/portal/documents?queue=1', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('The private scan queue is unavailable. Retry later; no pending file is counted as evidence.')
      const parsed = scanQueueSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('The private scan queue response could not be verified.')
      if (activeScanScope.current !== scope) return
      setScanQueue(parsed.data.documents)
      const rejected = new Set(parsed.data.documents.filter(item => item.state === 'REJECTED').map(item => item.id))
      setPendingForApplication(current => current.filter(id => !rejected.has(id)))
    } catch (error) { if (activeScanScope.current === scope) setScanMessage(error instanceof Error ? error.message : 'The scan queue is unavailable.') }
    finally { if (activeScanScope.current === scope) setScanBusy(false) }
  }
  async function attachScannedDocument(item: ScanQueueItem) {
    if (attachingScan || item.state !== 'SCANNED_CLEAN' || details.documents.length >= 8) return
    const scope = scanScope
    setAttachingScan(item.id); setScanMessage('')
    try {
      const response = await fetch(`/api/portal/documents?status=${encodeURIComponent(item.id)}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('This scanned file could not be checked for your current session.')
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('state' in result) || result.state !== 'SCANNED_CLEAN' || !('id' in result) || result.id !== item.id || !('document' in result))
        throw new Error('The file does not have a verified clean receipt. It cannot be attached.')
      const manifest = evidenceSchema.safeParse(result.document)
      if (!manifest.success || manifest.data.id !== item.id || manifest.data.kind !== item.kind || manifest.data.title !== item.title)
        throw new Error('The scanned file receipt does not match the selected document.')
      if (activeScanScope.current !== scope) return
      setDetails(current => current.documents.some(document => document.id === item.id) ? current
        : current.documents.length >= 8 ? current : { ...current, documents: [...current.documents, manifest.data] })
      setPendingForApplication(current => current.filter(id => id !== item.id))
      setScanMessage('The clean-scan receipt was rechecked and the file was selected for this application. Submit the application to save that selection.')
    } catch (error) { if (activeScanScope.current === scope) setScanMessage(error instanceof Error ? error.message : 'The clean-scan receipt is unavailable.') }
    finally { if (activeScanScope.current === scope) setAttachingScan('') }
  }
  return <div className={styles.wideGrid}>
    <div className={styles.stack}>
      <Notice title="Use fictional test evidence only">Customer admission remains an independent BlockXOne decision. TEST uses fictional documents and can collect sandbox provider evidence; neither a provider event nor a test approval establishes production KYC clearance.</Notice>
      <Panel title={persona === 'INVESTOR' ? 'Investor application' : 'Organisation / representative application'} description="This application never changes your assigned roles. Your status and next responsible owner are shown alongside its evidence." action={<StatusBadge status={application.status} />}>
        <p className={styles.muted}>Application reference: <span className={styles.mono}>{application.id}</span></p>
        <div className={styles.sectionGap}><FormProgress stages={['Prepare application', 'Submit evidence', 'Independent review', 'Recorded decision']} current={editable ? 0 : application.status === 'SUBMITTED' ? 2 : 3} /></div>
        <div className={styles.applicationState} aria-live="polite"><h3>{application.status === 'DRAFT' ? 'Draft: not submitted' : next.title}</h3><p>{application.status === 'DRAFT' ? 'Your application reference is saved. These fields and evidence links are not yet submitted. There is no automatic draft save.' : next.description}</p></div>
        {application.review_notes ? <Notice title={application.status === 'CHANGES_REQUIRED' ? 'Changes requested by your reviewer' : 'Recorded review rationale'} tone="warning">{application.review_notes}</Notice> : null}
        <CommandFeedback command={command} />
        {editable ? <>
        {legacyManager ? <details className={`${styles.applicationHistory} ${styles.sectionGap}`}><summary>View original legacy answers</summary><div className={styles.sectionGap}><ApplicationDetailsSummary persona={persona} details={application.details} /></div></details> : null}
        {!reviewAvailable ? <div className={styles.sectionGap}><Notice title={next.title} tone="warning">{next.description}<p>After the review route is ready, select Check review route and submit. The server rechecks its current assignment without reloading or discarding these fields.</p></Notice></div> : null}
        <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); if (submitReady) void command.submit('submit_application', { application_id: application.id, expected_revision: application.revision, details: applicationSubmissionDetails(persona, details) }) }}>
          <fieldset className={styles.fieldset} disabled={locked}><legend>01 · {persona === 'INVESTOR' ? 'Investor details' : 'Organisation and representative'}</legend>
            <div className={styles.formRow}><Field label={persona === 'INVESTOR' ? 'Full name' : 'Representative full name'} hint="Use a fictional identity for this environment."><input value={details.full_name} onChange={event => change('full_name', event.target.value)} required minLength={2} maxLength={120} autoComplete="off" placeholder="e.g. Alex Example (test)" /></Field><Field label="Country of residence" hint="Two-letter country code, for example ZA."><input value={details.country} onChange={event => change('country', event.target.value.toUpperCase())} required pattern="[A-Z]{2}" maxLength={2} /></Field></div>
            {persona === 'INVESTOR' ? <Field label="Investor classification"><select value={details.investor_type} onChange={event => change('investor_type', event.target.value as LegacyApplicationDetails['investor_type'])}><option value="INDIVIDUAL">Individual</option><option value="ENTITY">Legal entity</option></select></Field> : null}
            {details.investor_type === 'ENTITY' || persona === 'WEALTH_MANAGER' ? <><div className={styles.formRow}><Field label={persona === 'WEALTH_MANAGER' ? 'Customer organisation legal name' : 'Investing entity name'}><input value={details.company_name} onChange={event => change('company_name', event.target.value)} required minLength={3} maxLength={160} placeholder="Fictional example company" /></Field><Field label="Registration reference"><input value={details.registration_reference} onChange={event => change('registration_reference', event.target.value)} required minLength={3} maxLength={100} placeholder="SYNTHETIC-REG-001" /></Field></div><Field label="Ownership context" hint="Explain the disclosed structure. Each person or entity must also have a separate linked record below."><textarea value={details.beneficial_owners} onChange={event => change('beneficial_owners', event.target.value)} required minLength={20} maxLength={2000} /></Field></> : null}
            {persona === 'WEALTH_MANAGER' ? <><Field label="Business activities and requested services" hint="Describe the organisation's business and the platform services it seeks. Minimum 20 characters."><textarea value={details.business_activities} onChange={event => change('business_activities', event.target.value)} required minLength={20} maxLength={2000} /></Field><Field label="Your position in the organisation"><input value={details.representative_position} onChange={event => change('representative_position', event.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Appointed representative (fictional)" /></Field><Field label="Basis of your representative authority" hint="Explain who appointed you and what the supporting mandate authorises. This statement alone grants no operating powers."><textarea value={details.authority_basis} onChange={event => change('authority_basis', event.target.value)} required minLength={20} maxLength={2000} /></Field></>
              : <><Field label="Source of funds" hint="Explain where investment capital comes from. Minimum 20 characters."><textarea value={details.source_of_funds} onChange={event => change('source_of_funds', event.target.value)} required minLength={20} maxLength={2000} placeholder="Describe the fictional source and supporting evidence…" /></Field><Field label="Investment experience and objectives" hint="This is submitted to the reviewer; it is not an automated suitability result."><textarea value={details.experience} onChange={event => change('experience', event.target.value)} required minLength={10} maxLength={2000} /></Field></>}
          </fieldset>
          {requiresOwnershipDisclosure(persona, details.investor_type) ? <><hr className={styles.divider} /><fieldset className={styles.fieldset} disabled={locked}><legend>02 · Beneficial ownership and control</legend><p className={styles.muted}>Disclose each fictional person or legal entity separately. An ownership record is reviewed as evidence; it never grants a BlockXOne role, account mandate or signing authority.</p>
            {details.ownership_control.map((relationship, index) => <section key={relationship.id} className={styles.panelBody}><div className={styles.actions}><h3>Relationship {index + 1}</h3><button type="button" className={styles.textLink} onClick={() => change('ownership_control', details.ownership_control.filter(item => item.id !== relationship.id))}>Remove</button></div>
              <div className={styles.formRow}><Field label="Party type"><select value={relationship.party_type} onChange={event => changeRelationship(relationship.id, { party_type: event.target.value as OwnershipControlRelationship['party_type'] })}><option value="PERSON">Person</option><option value="ENTITY">Legal entity</option></select></Field><Field label="Legal name"><input value={relationship.legal_name} onChange={event => changeRelationship(relationship.id, { legal_name: event.target.value })} required minLength={2} maxLength={160} /></Field></div>
              <div className={styles.formRow}><Field label="Country"><input value={relationship.country} onChange={event => changeRelationship(relationship.id, { country: event.target.value.toUpperCase() })} required pattern="[A-Z]{2}" maxLength={2} /></Field><Field label="Registration reference" hint={relationship.party_type === 'ENTITY' ? 'Required for a legal entity.' : 'Optional for a person.'}><input value={relationship.registration_reference} onChange={event => changeRelationship(relationship.id, { registration_reference: event.target.value })} required={relationship.party_type === 'ENTITY'} maxLength={100} /></Field></div>
              <div className={styles.formRow}><Field label="Relationship"><select value={relationship.relationship} onChange={event => changeRelationship(relationship.id, { relationship: event.target.value as OwnershipControlRelationship['relationship'] })}><option value="DIRECT_OWNER">Direct owner</option><option value="INDIRECT_OWNER">Indirect owner</option><option value="CONTROLLER">Controller without declared economic ownership</option></select></Field><Field label="Economic ownership (%)" hint="Use 0 only for a controller without declared economic ownership."><input type="number" min={relationship.relationship === 'CONTROLLER' ? 0 : 0.01} max="100" step="0.01" value={relationship.ownership_basis_points / 100} onChange={event => changeRelationship(relationship.id, { ownership_basis_points: Math.round(Number(event.target.value) * 100) })} required /></Field></div>
              <div className={styles.formRow}><Field label="Effective date"><input type="date" value={relationship.effective_on} max={new Date().toISOString().slice(0, 10)} onChange={event => changeRelationship(relationship.id, { effective_on: event.target.value })} required /></Field><Field label="Linked ownership evidence"><select value={relationship.evidence_document_id} onChange={event => changeRelationship(relationship.id, { evidence_document_id: event.target.value })} required><option value="">Choose an uploaded beneficial-ownership file</option>{details.documents.filter(document => document.kind === 'BENEFICIAL_OWNERS').map(document => <option key={document.id} value={document.id}>{document.title}</option>)}</select></Field></div>
              <Field label="Basis of ownership or control" hint="Explain the underlying shareholding, chain of ownership or controlling influence."><textarea value={relationship.control_basis} onChange={event => changeRelationship(relationship.id, { control_basis: event.target.value })} required minLength={20} maxLength={1000} /></Field><Field label="Reason for this relationship record"><textarea value={relationship.change_reason} onChange={event => changeRelationship(relationship.id, { change_reason: event.target.value })} required minLength={20} maxLength={500} placeholder="Initial fictional disclosure or reason this relationship changed" /></Field>
            </section>)}
            <button type="button" className={styles.buttonSecondary} disabled={details.ownership_control.length >= 20} onClick={() => change('ownership_control', [...details.ownership_control, newOwnershipRelationship()])}>Add a person or entity</button>
            <Field label="Reason for this ownership disclosure revision" hint="On resubmission, explain any addition, removal or change to the disclosed structure."><textarea value={details.ownership_change_reason} onChange={event => change('ownership_change_reason', event.target.value)} required minLength={20} maxLength={500} /></Field>
          </fieldset></> : null}
          <hr className={styles.divider} />
          <fieldset className={styles.fieldset} disabled={locked}><legend>{requiresOwnershipDisclosure(persona, details.investor_type) ? '03' : '02'} · Supporting evidence</legend><p className={styles.muted}>PDF, PNG or JPEG · up to 4 MiB each · up to eight files · access-controlled storage. Attach each required evidence type below.</p>
            <ul className={styles.applicationChecklist} aria-label="Required evidence checklist">{requiredEvidence.map(item => { const ready = details.documents.some(document => document.kind === item.kind); return <li key={item.kind} data-ready={ready}><strong>{item.label}</strong><span>{ready ? 'Selected for this submission' : 'Required: upload this evidence type'}</span></li> })}</ul>
            <div className={styles.formRow}><Field label="Evidence type"><select value={uploadKind} onChange={event => setUploadKind(event.target.value)}><option value="IDENTITY">Identity evidence</option><option value="ADDRESS">Address evidence</option><option value="COMPANY">Company evidence</option><option value="BENEFICIAL_OWNERS">Beneficial ownership</option></select></Field><Field label="Document title"><input value={uploadTitle} onChange={event => setUploadTitle(event.target.value)} maxLength={160} placeholder="Fictional proof of identity" /></Field></div>
            <Field label="Choose fictional evidence"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>
            <div><button type="button" className={styles.buttonSecondary} disabled={!file || uploadBusy} onClick={() => void upload()}><Upload size={16} aria-hidden="true" />{uploadBusy ? 'Uploading…' : 'Upload private evidence'}</button></div>
          </fieldset>
          <div role="status" aria-live="polite" className={styles.muted}>{uploadMessage}</div>
          {details.documents.map(document => <div key={document.id}><PrivateDocument document={document} /><button type="button" className={styles.textLink} disabled={locked} onClick={() => change('documents', withoutDraftEvidence(details.documents, document.id))}>Exclude from this submission</button></div>)}
          <div className={styles.sectionGap}>
            <button type="button" className={styles.buttonSecondary} disabled={scanBusy} onClick={() => void refreshScanQueue()}>{scanBusy ? 'Checking private scan queue...' : 'View private scan queue'}</button>
            <p className={styles.muted}>Scanned files belong to your signed-in account, not automatically to this investor or organisation application. Select each clean file deliberately. Quarantined and rejected files never count as evidence.</p>
            {pendingForApplication.length ? <p className={styles.fieldError} role="status">{pendingForApplication.length} file{pendingForApplication.length === 1 ? '' : 's'} uploaded for this application still await{pendingForApplication.length === 1 ? 's' : ''} a clean receipt or exclusion. Submission is disabled.</p> : null}
            {scanMessage ? <p className={styles.muted} role="status">{scanMessage}</p> : null}
            {scanQueue ? scanQueue.length ? <ul className={styles.applicationChecklist} aria-label="Private scan queue">{scanQueue.map(item => <li key={item.id} data-ready={item.state === 'SCANNED_CLEAN'}><strong>{item.title}</strong><span>{item.state === 'QUARANTINED' ? 'Awaiting independent scan' : item.state === 'REJECTED' ? 'Rejected by scan; upload a different file' : 'Clean receipt available; select for this application if relevant'}</span>{item.state === 'SCANNED_CLEAN' ? <button type="button" className={styles.buttonSecondary} disabled={Boolean(attachingScan) || details.documents.some(document => document.id === item.id) || details.documents.length >= 8} onClick={() => void attachScannedDocument(item)}>{details.documents.some(document => document.id === item.id) ? 'Selected in this draft' : attachingScan === item.id ? 'Checking receipt...' : 'Include clean file'}</button> : null}{pendingForApplication.includes(item.id) ? <button type="button" className={styles.textLink} onClick={() => setPendingForApplication(current => current.filter(id => id !== item.id))}>Exclude pending file from this application</button> : null}</li>)}</ul> : <p className={styles.muted}>No scanned or pending files are available for this account.</p> : null}
          </div>
          <p className={styles.muted}>Excluding a file removes it from this unsaved submission only. Earlier versions and stored objects are not deleted; the separate upload quota still applies.</p>
          <label className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I confirm this application and all evidence are fictional test data. I understand a manual test approval does not establish legal identity, investment eligibility or production authority.</span></label><div className={styles.formFoot}><p>Saved record: revision {application.revision}. The fields above are submitted only after a confirmed response. An independent reviewer must make the decision.</p><button type="submit" className={styles.button} disabled={!submitReady}>{command.busy ? 'Submitting…' : applicationSubmitLabel(application)}</button></div>
        </form>
        </> : <div className={`${styles.stack} ${styles.sectionGap}`}><p className={styles.muted}>Read-only saved application, revision {application.revision}. {application.status === 'SUBMITTED' ? 'A request for changes will reopen editing.' : 'The recorded decision does not alter these submitted answers.'}</p><ApplicationDetailsSummary persona={persona} details={application.details} /><section><h3>Submitted private evidence</h3>{application.details.documents?.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence is recorded.</p>}</section></div>}
      </Panel>
      <KycVerification key={`${environment}:${expectedActor}:${application.id}:${application.revision}`} application={application} environment={environment} actorId={expectedActor} />
      {application.status !== 'DRAFT' || application.submitted_at ? <ApplicationDocumentHistory key={application.id} applicationId={application.id} /> : null}
    </div>
    <aside className={styles.stack} aria-label="Application progress and responsibility"><Panel title="Application status"><DetailList rows={[{ label: 'Relationship', value: persona === 'INVESTOR' ? 'Investor' : 'Wealth manager / representative' }, { label: 'Status', value: <StatusBadge status={application.status} /> }, { label: 'Saved revision', value: application.revision }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Decision recorded', value: dateLabel(application.reviewed_at) }, { label: 'Review provider', value: application.provider_mode === 'MANUAL_TEST_REVIEW' ? 'Manual test review' : 'Not assigned to this application yet' }, { label: editable ? 'Evidence selected in this browser' : 'Saved evidence files', value: details.documents.length }]} /></Panel><Panel title="Next responsible owner"><p className={styles.applicationOwner}>{next.owner}</p><h3>{next.title}</h3><p className={styles.copy}>{next.description}</p><p className={styles.muted}>Review availability is checked again when you submit. It does not prove a reviewer is currently signed in.</p></Panel><Panel title={editable ? 'Submission checklist' : 'Connected handoff'}><ol className={styles.timeline}><li><strong>{persona === 'INVESTOR' ? 'Investor facts and supporting evidence' : 'Organisation facts and representative evidence'}</strong><p>{editable ? 'Complete each required field and attach fictional evidence. Unsaved browser edits are not in the review queue.' : 'The saved package is displayed read-only at its recorded revision.'}</p></li><li><strong>Independent BlockXOne review</strong><p>{persona === 'INVESTOR' ? 'A permitted reviewer assesses the submitted investor evidence. A product still has its own eligibility rules.' : 'A permitted reviewer assesses the customer organisation, representative and requested services. The customer cannot self-approve.'}</p></li><li><strong>{persona === 'INVESTOR' ? 'Account and product eligibility' : 'Separate operating assignment'}</strong><p>{persona === 'INVESTOR' ? 'An admission decision is not a funded investment or token holding.' : 'Organisation, role, mandate and signing permissions require their own authority. Customer admission does not create them.'}</p></li></ol></Panel></aside>
  </div>
}
