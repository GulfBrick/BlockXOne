'use client'

import { useEffect, useRef, useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import { applicationDocumentVersionsSchema, isWealthManagerDetailsV2, type ApplicationDetails, type ApplicationDocumentVersions, type EvidenceDocument, type LegacyApplicationDetails, type Persona, type WealthManagerApplicationDetailsV2 } from '@/lib/portal/contracts'
import type { EntryApplication, EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, usePortalActorId, usePortalOperatingContext } from './portal-client'
import { useEntryCommand } from './entry-client'
import { portalScopeHref } from '@/lib/portal/operating-context'
import { DetailList, Field, FormProgress, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

type FormDetails = Omit<LegacyApplicationDetails, 'details_version' | 'business_activities' | 'representative_position' | 'authority_basis'> & Pick<WealthManagerApplicationDetailsV2, 'business_activities' | 'representative_position' | 'authority_basis'>

/** Carry shared historical facts forward, never reinterpret investor answers as organisation facts. */
export function applicationFormDetails(application: EntryApplication): FormDetails {
  const details = application.details
  const manager = isWealthManagerDetailsV2(details) ? details : null
  return {
    full_name: details.full_name ?? '', country: details.country ?? 'ZA',
    company_name: details.company_name ?? '', registration_reference: details.registration_reference ?? '',
    beneficial_owners: details.beneficial_owners ?? '', documents: details.documents ?? [], test_data_acknowledged: true,
    investor_type: 'investor_type' in details && details.investor_type === 'ENTITY' ? 'ENTITY' : 'INDIVIDUAL',
    source_of_funds: 'source_of_funds' in details ? details.source_of_funds ?? '' : '',
    experience: 'experience' in details ? details.experience ?? '' : '',
    business_activities: manager?.business_activities ?? '', representative_position: manager?.representative_position ?? '',
    authority_basis: manager?.authority_basis ?? '',
  }
}

export function applicationSubmissionDetails(persona: Persona, details: FormDetails): ApplicationDetails {
  const shared = { full_name: details.full_name, country: details.country, company_name: details.company_name, registration_reference: details.registration_reference, beneficial_owners: details.beneficial_owners, documents: details.documents, test_data_acknowledged: true as const }
  return persona === 'WEALTH_MANAGER'
    ? { ...shared, details_version: 2, business_activities: details.business_activities, representative_position: details.representative_position, authority_basis: details.authority_basis }
    : { ...shared, investor_type: details.investor_type, source_of_funds: details.source_of_funds, experience: details.experience }
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
  return !locked && acknowledged && requiredApplicationEvidence(persona, details.investor_type).every(item => details.documents.some(document => document.kind === item.kind))
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
  const command = useEntryCommand(expectedActor, environment, onSaved, receipts)
  const editable = ['DRAFT', 'CHANGES_REQUIRED'].includes(application.status)
  const locked = !editable || command.busy || command.unknown || uploadBusy
  const reviewAvailable = application.review_route === 'AVAILABLE'
  const requiredEvidence = requiredApplicationEvidence(persona, details.investor_type)
  const submitReady = applicationSubmissionReady(persona, details, acknowledged, locked)
  const next = applicationNextStep(application)
  const legacyManager = persona === 'WEALTH_MANAGER' && !isWealthManagerDetailsV2(application.details) && Object.keys(application.details).length > 0
  function change<K extends keyof FormDetails>(key: K, value: FormDetails[K]) { setDetails(current => ({ ...current, [key]: value })) }
  async function upload() {
    if (!file || !uploadTitle.trim()) { setUploadMessage('Choose a file and give the evidence a descriptive title.'); return }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 4_194_304 || file.size === 0) { setUploadMessage('Use a PDF, PNG or JPEG between 1 byte and 4 MiB.'); return }
    if (details.documents.length >= 8) { setUploadMessage('A maximum of eight evidence files can be attached.'); return }
    setUploadBusy(true); setUploadMessage('')
    try {
      const body = new FormData(); body.set('file', file); body.set('kind', uploadKind); body.set('title', uploadTitle.trim())
      const response = await fetch('/api/portal/documents', { method: 'POST', body, headers: { 'x-bx1-operating-context': JSON.stringify(operatingContext), 'x-bx1-expected-actor': expectedActor }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45000) })
      const result = await response.json()
      if (!response.ok || !result.document) throw new Error(result.error ?? 'The upload was not confirmed.')
      change('documents', [...details.documents, result.document]); setFile(null); setUploadTitle(''); setUploadMessage('File uploaded privately. Its application attachment and these fields are not saved until submission is confirmed.')
    } catch (error) { setUploadMessage(error instanceof Error ? error.message : 'The upload was not confirmed.'); }
    finally { setUploadBusy(false) }
  }
  return <div className={styles.wideGrid}>
    <div className={styles.stack}>
      <Notice title="Use fictional test evidence only">This is the same customer onboarding workflow with a manual test-review provider. Do not upload a real identity document or treat a test approval as regulated KYC clearance.</Notice>
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
            {details.investor_type === 'ENTITY' || persona === 'WEALTH_MANAGER' ? <><div className={styles.formRow}><Field label={persona === 'WEALTH_MANAGER' ? 'Customer organisation legal name' : 'Investing entity name'}><input value={details.company_name} onChange={event => change('company_name', event.target.value)} required minLength={3} maxLength={160} placeholder="Fictional example company" /></Field><Field label="Registration reference"><input value={details.registration_reference} onChange={event => change('registration_reference', event.target.value)} required minLength={3} maxLength={100} placeholder="SYNTHETIC-REG-001" /></Field></div><Field label="Beneficial owners and representatives" hint="Describe fictional ownership percentages and who is authorised to act."><textarea value={details.beneficial_owners} onChange={event => change('beneficial_owners', event.target.value)} required minLength={20} maxLength={2000} /></Field></> : null}
            {persona === 'WEALTH_MANAGER' ? <><Field label="Business activities and requested services" hint="Describe the organisation's business and the platform services it seeks. Minimum 20 characters."><textarea value={details.business_activities} onChange={event => change('business_activities', event.target.value)} required minLength={20} maxLength={2000} /></Field><Field label="Your position in the organisation"><input value={details.representative_position} onChange={event => change('representative_position', event.target.value)} required minLength={2} maxLength={160} placeholder="e.g. Appointed representative (fictional)" /></Field><Field label="Basis of your representative authority" hint="Explain who appointed you and what the supporting mandate authorises. This statement alone grants no operating powers."><textarea value={details.authority_basis} onChange={event => change('authority_basis', event.target.value)} required minLength={20} maxLength={2000} /></Field></>
              : <><Field label="Source of funds" hint="Explain where investment capital comes from. Minimum 20 characters."><textarea value={details.source_of_funds} onChange={event => change('source_of_funds', event.target.value)} required minLength={20} maxLength={2000} placeholder="Describe the fictional source and supporting evidence…" /></Field><Field label="Investment experience and objectives" hint="This is submitted to the reviewer; it is not an automated suitability result."><textarea value={details.experience} onChange={event => change('experience', event.target.value)} required minLength={10} maxLength={2000} /></Field></>}
          </fieldset>
          <hr className={styles.divider} />
          <fieldset className={styles.fieldset} disabled={locked}><legend>02 · Supporting evidence</legend><p className={styles.muted}>PDF, PNG or JPEG · up to 4 MiB each · up to eight files · access-controlled storage. Attach each required evidence type below.</p>
            <ul className={styles.applicationChecklist} aria-label="Required evidence checklist">{requiredEvidence.map(item => { const ready = details.documents.some(document => document.kind === item.kind); return <li key={item.kind} data-ready={ready}><strong>{item.label}</strong><span>{ready ? 'Selected for this submission' : 'Required: upload this evidence type'}</span></li> })}</ul>
            <div className={styles.formRow}><Field label="Evidence type"><select value={uploadKind} onChange={event => setUploadKind(event.target.value)}><option value="IDENTITY">Identity evidence</option><option value="ADDRESS">Address evidence</option><option value="COMPANY">Company evidence</option><option value="BENEFICIAL_OWNERS">Beneficial ownership</option></select></Field><Field label="Document title"><input value={uploadTitle} onChange={event => setUploadTitle(event.target.value)} maxLength={160} placeholder="Fictional proof of identity" /></Field></div>
            <Field label="Choose fictional evidence"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>
            <div><button type="button" className={styles.buttonSecondary} disabled={!file || uploadBusy} onClick={() => void upload()}><Upload size={16} aria-hidden="true" />{uploadBusy ? 'Uploading…' : 'Upload private evidence'}</button></div>
          </fieldset>
          <div role="status" aria-live="polite" className={styles.muted}>{uploadMessage}</div>
          {details.documents.map(document => <div key={document.id}><PrivateDocument document={document} /><button type="button" className={styles.textLink} disabled={locked} onClick={() => change('documents', withoutDraftEvidence(details.documents, document.id))}>Exclude from this submission</button></div>)}
          <p className={styles.muted}>Excluding a file removes it from this unsaved submission only. Earlier versions and stored objects are not deleted; the separate upload quota still applies.</p>
          <label className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I confirm this application and all evidence are fictional test data. I understand a manual test approval does not establish legal identity, investment eligibility or production authority.</span></label><div className={styles.formFoot}><p>Saved record: revision {application.revision}. The fields above are submitted only after a confirmed response. An independent reviewer must make the decision.</p><button type="submit" className={styles.button} disabled={!submitReady}>{command.busy ? 'Submitting…' : applicationSubmitLabel(application)}</button></div>
        </form>
        </> : <div className={`${styles.stack} ${styles.sectionGap}`}><p className={styles.muted}>Read-only saved application, revision {application.revision}. {application.status === 'SUBMITTED' ? 'A request for changes will reopen editing.' : 'The recorded decision does not alter these submitted answers.'}</p><ApplicationDetailsSummary persona={persona} details={application.details} /><section><h3>Submitted private evidence</h3>{application.details.documents?.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence is recorded.</p>}</section></div>}
      </Panel>
      {application.status !== 'DRAFT' || application.submitted_at ? <ApplicationDocumentHistory key={application.id} applicationId={application.id} /> : null}
    </div>
    <aside className={styles.stack} aria-label="Application progress and responsibility"><Panel title="Application status"><DetailList rows={[{ label: 'Relationship', value: persona === 'INVESTOR' ? 'Investor' : 'Wealth manager / representative' }, { label: 'Status', value: <StatusBadge status={application.status} /> }, { label: 'Saved revision', value: application.revision }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Decision recorded', value: dateLabel(application.reviewed_at) }, { label: 'Review provider', value: application.provider_mode === 'MANUAL_TEST_REVIEW' ? 'Manual test review' : 'Not assigned to this application yet' }, { label: editable ? 'Evidence selected in this browser' : 'Saved evidence files', value: details.documents.length }]} /></Panel><Panel title="Next responsible owner"><p className={styles.applicationOwner}>{next.owner}</p><h3>{next.title}</h3><p className={styles.copy}>{next.description}</p><p className={styles.muted}>Review availability is checked again when you submit. It does not prove a reviewer is currently signed in.</p></Panel><Panel title={editable ? 'Submission checklist' : 'Connected handoff'}><ol className={styles.timeline}><li><strong>{persona === 'INVESTOR' ? 'Investor facts and supporting evidence' : 'Organisation facts and representative evidence'}</strong><p>{editable ? 'Complete each required field and attach fictional evidence. Unsaved browser edits are not in the review queue.' : 'The saved package is displayed read-only at its recorded revision.'}</p></li><li><strong>Independent BlockXOne review</strong><p>{persona === 'INVESTOR' ? 'A permitted reviewer assesses the submitted investor evidence. A product still has its own eligibility rules.' : 'A permitted reviewer assesses the customer organisation, representative and requested services. The customer cannot self-approve.'}</p></li><li><strong>{persona === 'INVESTOR' ? 'Account and product eligibility' : 'Separate operating assignment'}</strong><p>{persona === 'INVESTOR' ? 'An admission decision is not a funded investment or token holding.' : 'Organisation, role, mandate and signing permissions require their own authority. Customer admission does not create them.'}</p></li></ol></Panel></aside>
  </div>
}
