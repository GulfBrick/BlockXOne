'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { entryApplicationHref, selectEntryApplication, type EntryApplication, type EntrySnapshot } from '@/lib/portal/entry-contracts'
import { customerHandoffHasAction, customerHandoffHref, customerScopedReadAvailable, validatedCustomerHandoff, type CustomerHandoff } from '@/lib/portal/customer-handoff'
import type { PlatformRelease } from '@/lib/platform-release'
import { representativeMandateNextOwnerLabel, type Persona } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT, portalContextMatches } from '@/lib/portal/operating-context'
import { hasStage2CommandAccess, isTestPasswordAdmission, validatedStage2Access } from '@/lib/portal/stage2-access'
import { validatedEvaluationAccess } from '@/lib/portal/evaluation-access'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { PortalShell } from './portal-shell'
import { CommandFeedback, PortalIdentityProvider } from './portal-client'
import { useEntryAvailabilityRefresh, useEntryCommand, useEntryStatusRefresh } from './entry-client'
import { ApplicationDocumentHistory, OnboardingForm } from './onboarding-form'
import { CustomerHandoffPanel, customerHandoffPresentation } from './customer-handoff'
import { applicantSectionHref, type ApplicantSection } from './applicant-presentation'
import { DetailList, Field, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

function RepresentativeMandatePanel({ application, snapshot, command, handoff }: {
  application: EntryApplication; snapshot: EntrySnapshot; command: ReturnType<typeof useEntryCommand>; handoff: CustomerHandoff | null;
}) {
  const [evidenceReference, setEvidenceReference] = useState('')
  const [requestedUntil, setRequestedUntil] = useState('')
  const [inputError, setInputError] = useState('')
  const mandates = snapshot.organisation_mandates
  const mandate = mandates?.find(item => item.application_id === application.id && item.applicant_user_id === snapshot.actor.id)
  const admissionCurrent = application.status === 'APPROVED' && application.approved_until !== null && Date.parse(application.approved_until) > Date.now()
  const canRequest = customerHandoffHasAction(handoff, 'REQUEST_REPRESENTATIVE_MANDATE') && admissionCurrent && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION'
    && (!isTestPasswordAdmission(snapshot) || hasStage2CommandAccess(snapshot, 'request_representative_mandate', APPLICANT_CONTEXT))
    && mandates !== undefined && (mandate ? handoff?.mandate?.id === mandate.id && handoff?.mandate?.status === mandate.status
      && Number.isInteger(mandate.revision) && mandate.revision > 0 && ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'].includes(mandate.status) : handoff?.mandate === null)
  const assignedContext = customerHandoffHasAction(handoff, 'ENTER_OPERATING_WORKSPACE') && handoff?.mandate?.id === mandate?.id && mandate?.status === 'APPLIED' && mandate.effective && Date.parse(mandate.requested_until) > Date.now() && mandate.native_organisation_id
    ? snapshot.contexts.find(item => item.organisation_id === mandate.native_organisation_id && item.roles.includes('OfferingManager')) : undefined

  return <Panel title="Your representative appointment" description="Request your organisation's first representative appointment. Approval of the organisation, the appointment and the operating role are separate decisions. Additional representatives follow a separate process.">
    {mandates === undefined ? <Notice title="Mandate records unavailable" tone="warning">Refresh saved state before requesting or assuming operating access. No role is inferred from customer admission.</Notice> : mandate ? <>
      <DetailList rows={[{ label: 'Mandate reference', value: mandate.id }, { label: 'Customer organisation', value: mandate.organisation_name }, { label: 'Requested role', value: 'Offering Manager' }, { label: 'Submitted synthetic evidence reference', value: mandate.evidence_reference }, { label: 'Status', value: <StatusBadge status={mandate.status} /> }, { label: 'Revision', value: mandate.revision }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Next responsible owner', value: representativeMandateNextOwnerLabel(mandate.next_owner) }]} />
      {mandate.review_notes ? <p className={styles.sectionGap}>Decision notes: {mandate.review_notes}</p> : null}
      {assignedContext ? <div className={styles.sectionGap}><Notice title="Operating assignment active">The server returned a current Offering Manager context for this organisation. Product actions will recheck the mandate and role.</Notice><Link className={styles.button} href={`/portal?organisation=${encodeURIComponent(assignedContext.organisation_id)}&role=OfferingManager`}>Open Offering Manager workspace</Link></div> : mandate.status === 'APPLIED' ? <Notice title="Assignment not verified" tone="warning">The mandate record says applied, but no matching active operating context was returned. Do not start product work; refresh or contact BlockXOne operations.</Notice> : null}
    </> : application.status === 'APPROVED' ? <p>Customer admission is recorded. A separate appointment request must be reviewed by Compliance and applied by an authorised Super Admin before any Offering Manager role appears.</p> : <p>Complete customer-organisation admission first. An application alone cannot create products or assign a representative role.</p>}
    {canRequest ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => {
      event.preventDefault()
      const expiry = new Date(requestedUntil)
      if (Number.isNaN(expiry.getTime())) { setInputError('Enter a valid requested expiry.'); return }
      setInputError('')
      void command.submit('request_representative_mandate', { application_id: application.id, expected_revision: mandate?.revision ?? 0, evidence_reference: evidenceReference, requested_until: expiry.toISOString() })
    }}>
      <Notice title="Fictional test appointment only">Use a synthetic appointment reference, not a real identity document or confidential customer record. This reference is not verified KYC or authority by itself.</Notice>
      <Field label="Synthetic appointment evidence reference" hint="20 to 400 characters. Identify the fictional appointment evidence for independent review."><textarea required minLength={20} maxLength={400} value={evidenceReference} disabled={command.busy || command.unknown} onChange={event => setEvidenceReference(event.target.value)} /></Field>
      <Field label="Requested mandate expiry" hint="The appointment is limited to 30 days and cannot extend beyond your current approval."><input type="datetime-local" required value={requestedUntil} disabled={command.busy || command.unknown} onChange={event => setRequestedUntil(event.target.value)} /></Field>
      <button className={styles.button} type="submit" disabled={command.busy || command.unknown}>{mandate ? mandate.status === 'CHANGES_REQUIRED' ? 'Resubmit appointment request' : 'Renew appointment request for review' : 'Request Offering Manager appointment review'}</button>
      {inputError ? <p role="alert">{inputError}</p> : null}
      <CommandFeedback command={command} />
    </form> : null}
    {mandates !== undefined && application.status === 'APPROVED' && !mandate && !canRequest ? <Notice title="Appointment request unavailable" tone="warning">No guarded appointment request is available for this admission. BlockXOne operations must resolve the review route; customer approval alone does not grant a role.</Notice> : null}
  </Panel>
}

function ApplicantApplicationCard({ application, snapshot, release }: { application: EntryApplication; snapshot: EntrySnapshot; release: PlatformRelease }) {
  const handoff = validatedCustomerHandoff(snapshot, application, release.environment)
  const next = handoff ? customerHandoffPresentation(handoff) : null
  const nextDescription = handoff?.state === 'PREPARE_APPLICATION' && handoff.blocker === 'NONE'
    ? 'Complete the requested answers and evidence. Open the application to check its draft-save indicator; a saved draft is separate from submission for independent review.' : next?.description
  const expired = application.status === 'APPROVED' && application.approved_until !== null && Date.parse(application.approved_until) <= Date.now()
  const currentAdmission = handoff?.blocker === 'NONE' && handoff.gates.intake_admitted && handoff.gates.monitoring_allows_new_actions
    && application.provider_mode === 'MANUAL_TEST_REVIEW' && application.approved_until !== null && Date.parse(application.approved_until) > Date.now()
  const status = application.status === 'DRAFT' ? 'Draft · Not submitted'
    : application.status === 'SUBMITTED' ? 'Submitted for independent review'
    : application.status === 'CHANGES_REQUIRED' ? 'Changes required'
    : application.status === 'REJECTED' ? 'Not approved'
    : expired ? 'Admission expired'
    : release.environment === 'MAINNET' ? 'Recorded approval · MAIN admission unavailable'
    : currentAdmission ? 'Admission approved for test scope' : 'Recorded approval · Current access unverified'
  const context = application.context_organisation_id ? snapshot.contexts.find(item => item.organisation_id === application.context_organisation_id)?.name : null
  const applicantOrganisation = application.details.company_name?.trim()
  const directHref = handoff?.environment === 'TESTNET' && handoff.blocker === 'NONE' && handoff.state !== 'UNAVAILABLE' ? customerHandoffHref(handoff) : null
  const action = directHref ? customerHandoffHasAction(handoff, 'ENTER_OPERATING_WORKSPACE') ? 'Open assigned workspace'
    : customerHandoffHasAction(handoff, 'OPEN_INVESTMENT_ACCOUNT') ? 'Continue to account opening'
    : customerHandoffHasAction(handoff, 'REQUEST_INVESTING_REPRESENTATIVE_MANDATE') ? 'Continue to representative appointment' : 'View investment account'
    : customerHandoffHasAction(handoff, 'PREPARE_APPLICATION') ? application.status === 'CHANGES_REQUIRED' ? 'Review and make changes' : application.status === 'REJECTED' ? 'Review and reapply' : 'Continue application'
    : customerHandoffHasAction(handoff, 'REQUEST_REPRESENTATIVE_MANDATE') ? 'Continue to representative appointment' : 'View saved application'
  return <article className={styles.applicantCard}>
    <div className={styles.applicantCardHeading}><h3>{application.persona === 'INVESTOR' ? 'Investor application' : 'Organisation application'}</h3><span className={styles.badge} data-tone={application.status === 'REJECTED' ? 'danger' : application.status === 'DRAFT' ? 'neutral' : 'info'}>{status}</span></div>
    <p className={styles.muted}>{context ? `Assigned context: ${context}` : application.context_kind === 'ORGANISATION' ? 'Organisation context unavailable' : 'Personal / new organisation application'}{applicantOrganisation ? ` · Applicant organisation: ${applicantOrganisation}` : ''}</p>
    <p className={styles.applicantNextAction}><strong>{next?.title ?? 'Current next step could not be verified'}</strong></p>
    <p className={styles.muted}>{nextDescription ?? 'Your saved record remains available. Open it to inspect its status and contact the onboarding owner; no submission or operating access is inferred.'}</p>
    <p className={styles.muted}>Next owner: {next?.owner ?? 'BlockXOne onboarding owner'}</p>
    <Link href={directHref ?? entryApplicationHref(application.id)} className={styles.button}>{action}</Link>
    {directHref ? <Link href={entryApplicationHref(application.id)} className={styles.textLink}>Application record</Link> : null}
  </article>
}

export function EntryScreen({ initial, release, applicationId, addCapacity = false, chooseContext = false, section, representativeProposalCount = 0 }: { initial: EntrySnapshot; release: PlatformRelease; applicationId?: string; addCapacity?: boolean; chooseContext?: boolean; section?: ApplicantSection; operationsAvailable?: boolean; representativeProposalCount?: number }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [adding, setAdding] = useState(addCapacity || initial.applications.length === 0)
  const [persona, setPersona] = useState<Persona | ''>('')
  const [contextKey, setContextKey] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [applicationActivity, setApplicationActivity] = useState(false)
  const [applicationDirty, setApplicationDirty] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const historyControl = useRef<HTMLButtonElement>(null)
  const historyHeading = useRef<HTMLHeadingElement>(null)
  const historyWasOpened = useRef(false)
  const command = useEntryCommand(snapshot.actor.id, release.environment, setSnapshot, snapshot.requests)
  const application = !section && !chooseContext && !addCapacity ? selectEntryApplication(snapshot, applicationId) : null
  const directorySection = section ?? (chooseContext ? 'overview' : !application ? 'applications' : undefined)
  const handoff = application ? validatedCustomerHandoff(snapshot, application, release.environment) : null
  const preparingApplication = customerHandoffHasAction(handoff, 'PREPARE_APPLICATION')
  useEffect(() => { setApplicationDirty(false) }, [application?.id, application?.revision])
  useEffect(() => { historyWasOpened.current = false; setShowHistory(false) }, [application?.id, application?.revision, snapshot.actor.id, release.environment])
  useEffect(() => {
    if (showHistory) historyHeading.current?.focus()
    else if (historyWasOpened.current) { historyControl.current?.focus(); historyWasOpened.current = false }
  }, [showHistory])
  const admissionReadAvailable = customerScopedReadAvailable(snapshot, release.environment)
  const mayStart = !isTestPasswordAdmission(snapshot) || hasStage2CommandAccess(snapshot, 'start_application', APPLICANT_CONTEXT)
  const maySubmit = !isTestPasswordAdmission(snapshot) || hasStage2CommandAccess(snapshot, 'submit_application', APPLICANT_CONTEXT)
  const refresh = useEntryStatusRefresh(snapshot.actor.id, release.environment, customerHandoffHasAction(handoff, 'PREPARE_APPLICATION') ? null : application, next => { setSavedMessage(''); setSnapshot(next) })
  const availability = useEntryAvailabilityRefresh(snapshot.actor.id, release.environment, customerHandoffHasAction(handoff, 'PREPARE_APPLICATION') ? application : null, next => { setSavedMessage(''); setSnapshot(next) })
  function applicationSaved(next: EntrySnapshot) {
    const saved = next.applications.find(item => item.id === application?.id)
    if (saved && saved.revision > (application?.revision ?? 0)) setSavedMessage(`Hosted record confirmed: application ${saved.id}, revision ${saved.revision}. ${saved.status === 'SUBMITTED' ? 'Submitted for independent review.' : 'Read the recorded status below.'}`)
    setSnapshot(next)
  }
  const organisation = application?.context_organisation_id ? snapshot.contexts.find(context => context.organisation_id === application.context_organisation_id)?.name : undefined
  const capacity = application ? application.persona === 'INVESTOR' ? 'Investor application' : 'Wealth-manager application' : 'Personal account'
  const sectionTitles: Record<ApplicantSection, string> = { overview: 'Your BlockXOne overview.', applications: 'My applications.', workspaces: 'Your assigned workspaces.', help: 'Help with your next step.' }
  const sectionDescriptions: Record<ApplicantSection, string> = { overview: 'See your saved applications and the next responsible owner. Operating assignments remain separate.', applications: 'Continue an exact saved application or start another. Each capacity keeps its own review and history.', workspaces: 'Open only an organisation and role returned for this account. Approval of an application is not an operating assignment.', help: 'Understand saving, independent review and the separate handoff to an account or assigned workspace.' }
  const title = directorySection ? sectionTitles[directorySection] : application?.persona === 'INVESTOR' ? preparingApplication ? 'Apply as an investor.' : 'Your investor application.' : application?.persona === 'WEALTH_MANAGER' ? preparingApplication ? 'Apply for an organisation workspace.' : 'Your organisation application.' : 'Your applications and workspaces.'
  const description = directorySection ? sectionDescriptions[directorySection] : application ? preparingApplication ? application.persona === 'INVESTOR' ? 'Tell us who you are, then complete each short section.' : 'Tell us about the organisation you represent.' : 'Track saved progress, read reviewer feedback and follow your next step below.' : 'Continue an application, open an assigned workspace or start another application.'
  const initialAccess = validatedStage2Access(initial, APPLICANT_CONTEXT, release.environment)
  const currentAccess = validatedStage2Access(snapshot, APPLICANT_CONTEXT, release.environment)
  const lostAccess = initial.stage2_access !== undefined && (!initialAccess || !currentAccess
    || currentAccess.actor_id !== initialAccess.actor_id || currentAccess.environment !== initialAccess.environment
    || currentAccess.session_mode !== initialAccess.session_mode || !portalContextMatches(currentAccess.operating_context, initialAccess.operating_context))
  if ('rehearsal' in initial || 'rehearsal' in snapshot || lostAccess || snapshot.stage2_access !== undefined && !currentAccess) return <Notice title="Saved admission state unavailable" tone="warning">Refresh your personal application workspace before continuing. Your saved applications and capacities have not changed.</Notice>
  const intakeVisible = admissionReadAvailable && handoff?.gates.intake_admitted && handoff.blocker !== 'CONTEXT_NOT_SUPPORTED' && handoff.blocker !== 'PROVIDER_UNSUPPORTED'
  const formVisible = intakeVisible && (!preparingApplication || maySubmit)
  const evaluationWorkspaces = (snapshot.evaluation_access ?? []).filter(item => validatedEvaluationAccess({ actor: snapshot.actor, evaluation_access: item }, item.operating_context, release.environment))
  const workspaceLinks = snapshot.contexts.flatMap(context => context.roles.map(role => {
    const evaluation = evaluationWorkspaces.find(item => item.operating_context.organisationId === context.organisation_id && item.operating_context.role === role)
    return <Link key={`${context.context_key}:${role}`} className={styles.buttonSecondary} href={`/portal?organisation=${encodeURIComponent(context.organisation_id)}&role=${encodeURIComponent(role)}`}>{evaluation ? role === 'OfferingManager' ? 'Open TEST product workspace' : 'Open TEST investor workspace' : `${context.name} · ${getRoleDashboard(role)?.title.replace(/ dashboard$/, '') ?? role}`}</Link>
  }))
  const applications = snapshot.applications.filter(item => item.user_id === snapshot.actor.id)
  const applicationCards = applications.length ? <div className={styles.applicantCardGrid}>{applications.map(item => <ApplicantApplicationCard key={item.id} application={item} snapshot={snapshot} release={release} />)}</div> : <Notice title="No saved application">No application type has been chosen for this login. Choose explicitly; no investor or organisation authority has been assumed.</Notice>
  const workspaces = <Panel title={evaluationWorkspaces.length ? 'Your workspaces' : 'Assigned workspaces'} description={evaluationWorkspaces.length ? 'Your TEST workspace is available while your application remains separate. Use fictional information; no real identity documents are needed to explore it.' : 'These are current server-returned organisation and role assignments, not approval badges.'}>{workspaceLinks.length ? <div className={styles.actions}>{workspaceLinks}</div> : <Notice title="No assigned operating workspace">Your account has no organisation-role workspace in the returned context. Continue the application or appointment handoff; an approved application alone does not create one.</Notice>}</Panel>
  const applicationOptions = <div className={styles.stack}>
      <Panel title="My applications" action={<button type="button" className={styles.buttonSecondary} onClick={() => setAdding(value => !value)} aria-expanded={adding}>{adding ? 'Close new application' : 'Start another application'}</button>} description="Your investor and wealth-manager applications are reviewed separately.">
        {applicationCards}
        {adding && mayStart ? <form className={`${styles.form} ${styles.sectionGap}`} data-onboarding-discard={applicationDirty ? 'true' : undefined} onSubmit={event => { event.preventDefault(); if (persona) void command.submit('start_application', { persona, ...(contextKey ? { context_key: contextKey } : {}) }) }}>
          <Field label="Application type"><select required value={persona} disabled={command.busy || command.unknown} onChange={event => setPersona(event.target.value as Persona | '')}><option value="">Choose an application type</option><option value="INVESTOR">Investor</option><option value="WEALTH_MANAGER">Wealth manager</option></select></Field>
          {snapshot.contexts.length > 0 ? <Field label="Organisation for this application" hint="Choose an assigned organisation, or apply personally / for a new organisation."><select value={contextKey} disabled={command.busy || command.unknown} onChange={event => setContextKey(event.target.value)}><option value="">Personal / new organisation application</option>{snapshot.contexts.map(context => <option key={context.context_key} value={context.context_key}>{context.name}</option>)}</select></Field> : null}
          <button className={styles.button} disabled={!persona || command.busy || command.unknown} type="submit">Create or continue this application</button><CommandFeedback command={command} />
        </form> : null}
        {adding && !mayStart ? <Notice title="Capacity application unavailable" tone="warning">No new-application action was returned for this login. Refresh saved state or contact the BlockXOne onboarding owner.</Notice> : null}
      </Panel>
    </div>
  return <PortalIdentityProvider actorId={snapshot.actor.id} environment={release.environment}><PortalShell user={snapshot.actor} release={release} operatingContext={APPLICANT_CONTEXT} organisationName={organisation || application?.details.company_name?.trim() || 'Personal account'} capacityName={capacity} active={directorySection === 'overview' ? 'overview' : 'onboarding'} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} title={title} description={description} applicantOnboarding applicantSection={directorySection}>
    <div className={styles.stack}>
      {directorySection ? <p className={styles.applicantIdentity}>Signed in as {snapshot.actor.email} · Personal applicant account</p> : null}
      {evaluationWorkspaces.length && directorySection !== 'overview' && directorySection !== 'workspaces' ? workspaces : null}
      {Number.isInteger(representativeProposalCount) && representativeProposalCount > 0 ? <Panel title="Representative proposals awaiting your response" description="An entity applicant has named you. Open the existing proposal inbox to inspect the exact appointment and accept or decline it."><p>{representativeProposalCount} pending proposal{representativeProposalCount === 1 ? '' : 's'}. Your response does not activate account access or grant a platform role, eligibility, funding or signing authority.</p><Link className={styles.button} href="/portal/portfolio?mode=applicant">Open my representative proposals</Link></Panel> : null}
      {directorySection === 'overview' ? <><Panel title="Your next steps" action={<Link href={`${applicantSectionHref('applications')}&add=capacity`} className={styles.buttonSecondary}>Start another application</Link>}>{applicationCards}{!applications.length ? <div className={styles.sectionGap}><Link href={`${applicantSectionHref('applications')}&add=capacity`} className={styles.button}>Choose an application type</Link></div> : null}</Panel>{workspaces}</> : null}
      {directorySection === 'applications' ? applicationOptions : null}
      {directorySection === 'workspaces' ? workspaces : null}
      {directorySection === 'help' ? <div className={styles.stack}>
        <Panel title="Saving your application"><p>Open your application from My applications and check the save indicator. A browser answer or a pending upload is not a confirmed saved record. Resolve any unknown save or conflict before leaving.</p><p>Use Save and exit when it is available. If draft saving is unavailable, keep the application open: prepare-only answers are not saved. Include each clean uploaded file deliberately; selecting a file in your browser does not include it in the application.</p></Panel>
        <Panel title="After you submit"><p>Saving a draft does not submit it. After submission, the independent reviewer handles the next step. Refresh status for a decision or requested changes; do not create a duplicate application.</p><p>Approval of your application is separate from opening an account or receiving a representative appointment and operating workspace. Product eligibility, funding and signing require their own checks.</p></Panel>
        <Panel title="Need help?"><p>Open the application and read its next step. History & support contains your application reference and saved records. Contact BlockXOne onboarding if you cannot continue; do not send real documents through a substitute route.</p><a href="mailto:daniel@bx1.co.za" className={styles.buttonSecondary}>Contact BlockXOne onboarding</a><p className={styles.muted}>Opens your email app. Application details are not included automatically.</p><Link href="/workspace/security" className={styles.textLink}>Account security</Link></Panel>
      </div> : null}
      {application ? <>
        <div role="status" aria-live="polite" className={styles.statusRegion}>{savedMessage}</div>
        {refresh.available ? <div className={styles.applicationRefresh}><button type="button" className={styles.buttonSecondary} disabled={refresh.busy || command.busy || command.unknown} onClick={() => void refresh.refresh()}>{refresh.busy ? 'Refreshing saved status…' : 'Refresh application status'}</button><p className={styles.muted}>Refresh this saved application to see the review handoff or decision. Editing requires a current preparation or reapplication action from the saved workflow.</p><div role="status" aria-live="polite">{refresh.message}</div></div> : null}
        {!formVisible ? <div className={styles.stack}>
          <div className={styles.actions}><button ref={historyControl} type="button" className={styles.buttonSecondary} hidden={showHistory} onClick={() => { historyWasOpened.current = true; setShowHistory(true) }}>History &amp; support</button>{showHistory ? <button type="button" className={styles.buttonSecondary} onClick={() => setShowHistory(false)}>Back to application</button> : null}</div>
          {showHistory ? <section aria-labelledby="entry-history-heading" className={styles.stack}><h2 id="entry-history-heading" ref={historyHeading} tabIndex={-1}>History &amp; support</h2><CustomerHandoffPanel application={application} handoff={handoff} presentation="history" />{application.status !== 'DRAFT' || application.submitted_at ? <ApplicationDocumentHistory key={application.id} applicationId={application.id} /> : null}</section> : <CustomerHandoffPanel application={application} handoff={handoff} />}
        </div> : null}
        {intakeVisible ? preparingApplication && !maySubmit ? <Notice title="Submission action unavailable" tone="warning">The saved application can be viewed, but no submission action was returned for this capacity. Contact the BlockXOne onboarding owner with the application reference.</Notice> : <OnboardingForm key={`${application.id}:${application.revision}`} application={application} environment={release.environment} onSaved={applicationSaved} receipts={snapshot.requests} handoff={handoff} onActivityChange={setApplicationActivity} onDirtyChange={setApplicationDirty} handoffPanel={<CustomerHandoffPanel application={application} handoff={handoff} />} /> : null}
        {availability.available ? <div className={styles.applicationRefresh}><button type="button" className={styles.buttonSecondary} disabled={availability.busy || command.busy || command.unknown || applicationActivity} onClick={() => void availability.refresh()}>{availability.busy ? 'Refreshing review availability…' : 'Refresh review availability'}</button><p className={styles.muted}>Check whether an independent reviewer is available, without submitting or replacing your unsaved answers. If the saved application changes, the check stops instead of overwriting this draft.</p><div role="status" aria-live="polite">{availability.message}</div></div> : null}
        {application.persona === 'WEALTH_MANAGER' && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION' && (application.status === 'APPROVED' || snapshot.organisation_mandates?.some(item => item.application_id === application.id && item.applicant_user_id === snapshot.actor.id)) ? <RepresentativeMandatePanel key={application.id} application={application} snapshot={snapshot} command={command} handoff={handoff} /> : null}
      </> : directorySection === 'applications' && !adding && !chooseContext ? <Notice title="Select the application you want to continue">Each application stays separate. No first application or investor capacity has been selected automatically.</Notice> : null}
    </div>
  </PortalShell></PortalIdentityProvider>
}
