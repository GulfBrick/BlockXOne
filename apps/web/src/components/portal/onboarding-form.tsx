'use client'

import { useState } from 'react'
import { FileCheck2, Upload } from 'lucide-react'
import type { ApplicationDetails, EvidenceDocument } from '@/lib/portal/contracts'
import type { EntryApplication, EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, usePortalActorId, usePortalOperatingContext } from './portal-client'
import { useEntryCommand } from './entry-client'
import { portalScopeHref } from '@/lib/portal/operating-context'
import { DetailList, Field, FormProgress, Notice, Panel, StatusBadge } from './portal-primitives'
import styles from './portal.module.css'

const emptyDetails = (): ApplicationDetails => ({ full_name: '', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', source_of_funds: '', beneficial_owners: '', experience: '', documents: [], test_data_acknowledged: true })

export function PrivateDocument({ document }: { document: EvidenceDocument }) {
  const operatingContext = usePortalOperatingContext()
  const [url, setUrl] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  async function prepare() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(portalScopeHref(`/api/portal/documents?id=${encodeURIComponent(document.id)}`, operatingContext), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
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

export function OnboardingForm({ application, environment, onSaved, receipts }: { application: EntryApplication; environment: PlatformEnvironment; onSaved: (snapshot: EntrySnapshot) => void; receipts?: EntrySnapshot['requests'] }) {
  const operatingContext = usePortalOperatingContext()
  const expectedActor = usePortalActorId()
  const persona = application.persona
  const [details, setDetails] = useState<ApplicationDetails>(() => ({ ...emptyDetails(), ...application.details }))
  const [acknowledged, setAcknowledged] = useState(false)
  const [uploadKind, setUploadKind] = useState('IDENTITY')
  const [uploadTitle, setUploadTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const command = useEntryCommand(expectedActor, environment, onSaved, receipts)
  const editable = !application || ['DRAFT', 'CHANGES_REQUIRED'].includes(application.status)
  const locked = !editable || command.busy || command.unknown || uploadBusy
  function change<K extends keyof ApplicationDetails>(key: K, value: ApplicationDetails[K]) { setDetails(current => ({ ...current, [key]: value })) }
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
      change('documents', [...details.documents, result.document]); setFile(null); setUploadTitle(''); setUploadMessage('Private evidence uploaded and attached to this application draft.')
    } catch (error) { setUploadMessage(error instanceof Error ? error.message : 'The upload was not confirmed.'); }
    finally { setUploadBusy(false) }
  }
  return <div className={styles.wideGrid}>
    <div className={styles.stack}>
      <Notice title="Use fictional test evidence only">This is the same customer onboarding workflow with a manual test-review provider. Do not upload a real identity document or treat a test approval as regulated KYC clearance.</Notice>
      <Panel title={persona === 'INVESTOR' ? 'Investor application' : 'Organisation / representative application'} description="This saved capacity is fixed. Use Add a capacity for a different relationship; this application never changes your assigned roles.">
        <p className={styles.muted}>Application reference: <span className={styles.mono}>{application.id}</span></p>
        <div className={styles.sectionGap}><FormProgress stages={['Your details', 'Private evidence', 'Independent review']} current={application?.status === 'SUBMITTED' || application?.status === 'APPROVED' ? 2 : details.documents.length ? 1 : 0} /></div>
        {application?.review_notes ? <Notice title="Reviewer feedback" tone="warning">{application.review_notes}</Notice> : null}
        <CommandFeedback command={command} />
        <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); if (acknowledged) void command.submit('submit_application', { application_id: application.id, expected_revision: application.revision, details: { ...details, test_data_acknowledged: true } }) }}>
          <fieldset className={styles.fieldset} disabled={locked}><legend>01 · Applicant details</legend>
            <div className={styles.formRow}><Field label="Full name" hint="Use a fictional identity for this environment."><input value={details.full_name} onChange={event => change('full_name', event.target.value)} required minLength={2} maxLength={120} autoComplete="off" placeholder="e.g. Alex Example (test)" /></Field><Field label="Country of residence" hint="Two-letter country code, for example ZA."><input value={details.country} onChange={event => change('country', event.target.value.toUpperCase())} required pattern="[A-Z]{2}" maxLength={2} /></Field></div>
            <Field label="Investor classification"><select value={details.investor_type} onChange={event => change('investor_type', event.target.value as ApplicationDetails['investor_type'])}><option value="INDIVIDUAL">Individual</option><option value="ENTITY">Legal entity</option></select></Field>
            {details.investor_type === 'ENTITY' || persona === 'WEALTH_MANAGER' ? <><div className={styles.formRow}><Field label="Company / issuing entity name"><input value={details.company_name} onChange={event => change('company_name', event.target.value)} required maxLength={160} placeholder="Fictional example company" /></Field><Field label="Registration reference"><input value={details.registration_reference} onChange={event => change('registration_reference', event.target.value)} required maxLength={100} placeholder="SYNTHETIC-REG-001" /></Field></div><Field label="Beneficial owners and representatives" hint="Describe fictional ownership percentages and who is authorised to act."><textarea value={details.beneficial_owners} onChange={event => change('beneficial_owners', event.target.value)} required maxLength={2000} /></Field></> : null}
            <Field label="Source of funds" hint="Explain where investment capital comes from. Minimum 20 characters."><textarea value={details.source_of_funds} onChange={event => change('source_of_funds', event.target.value)} required minLength={20} maxLength={2000} placeholder="Describe the fictional source and supporting evidence…" /></Field>
            <Field label="Investment experience and objectives" hint="This is submitted to the reviewer; it is not an automated suitability result."><textarea value={details.experience} onChange={event => change('experience', event.target.value)} required minLength={10} maxLength={2000} /></Field>
          </fieldset>
          <hr className={styles.divider} />
          <fieldset className={styles.fieldset} disabled={locked}><legend>02 · Supporting evidence</legend><p className={styles.muted}>PDF, PNG or JPEG · up to 4 MiB each · at least one file · access-controlled storage.</p>
            <div className={styles.formRow}><Field label="Evidence type"><select value={uploadKind} onChange={event => setUploadKind(event.target.value)}><option value="IDENTITY">Identity evidence</option><option value="ADDRESS">Address evidence</option><option value="COMPANY">Company evidence</option><option value="BENEFICIAL_OWNERS">Beneficial ownership</option></select></Field><Field label="Document title"><input value={uploadTitle} onChange={event => setUploadTitle(event.target.value)} maxLength={160} placeholder="Fictional proof of identity" /></Field></div>
            <Field label="Choose fictional evidence"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>
            <div><button type="button" className={styles.buttonSecondary} disabled={!file || uploadBusy} onClick={() => void upload()}><Upload size={16} aria-hidden="true" />{uploadBusy ? 'Uploading…' : 'Upload private evidence'}</button></div>
          </fieldset>
          <div role="status" aria-live="polite" className={styles.muted}>{uploadMessage}</div>
          {details.documents.map(document => <PrivateDocument key={document.id} document={document} />)}
          {editable ? <><label className={styles.check}><input type="checkbox" required checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} /><span>I confirm this application and all evidence are fictional test data. I understand a manual test approval does not establish legal identity, investment eligibility or production authority.</span></label><div className={styles.formFoot}><p>Your application is submitted at revision {application?.revision ?? 0}. A reviewer cannot approve their own application.</p><button type="submit" className={styles.button} disabled={locked || !acknowledged || !details.documents.length}>Submit for review</button></div></> : <Notice title="Application submitted">Your submitted information is read-only while its review is in progress or concluded. Changes requested by the reviewer will reopen editing.</Notice>}
        </form>
      </Panel>
    </div>
    <div className={styles.stack}><Panel title="Application status"><DetailList rows={[{ label: 'Relationship', value: persona === 'INVESTOR' ? 'Investor' : 'Wealth manager' }, { label: 'Status', value: <StatusBadge status={application?.status ?? 'NOT_STARTED'} /> }, { label: 'Version', value: application ? `Revision ${application.revision}` : 'Not submitted' }, { label: 'Review provider', value: 'Manual test review' }, { label: 'Evidence files', value: details.documents.length }]} /></Panel><Panel title="What happens next"><ol className={styles.timeline}><li><strong>Complete your application</strong><p>Provide applicant details and private supporting evidence.</p></li><li><strong>Independent review</strong><p>A permitted reviewer checks identity, ownership, screening and suitability evidence in test mode.</p></li><li><strong>Access for the approved relationship</strong><p>Investor subscription access or scoped product-management access is based on the recorded decision.</p></li></ol></Panel></div>
  </div>
}
