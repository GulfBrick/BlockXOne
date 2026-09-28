'use client'

import Link from 'next/link'
import { useState } from 'react'
import { entryApplicationHref, selectEntryApplication, type EntryApplication, type EntrySnapshot } from '@/lib/portal/entry-contracts'
import type { PlatformRelease } from '@/lib/platform-release'
import { representativeMandateNextOwnerLabel, type Persona } from '@/lib/portal/contracts'
import { APPLICANT_CONTEXT } from '@/lib/portal/operating-context'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { PortalShell } from './portal-shell'
import { CommandFeedback, PortalIdentityProvider } from './portal-client'
import { useEntryCommand, useEntryStatusRefresh } from './entry-client'
import { OnboardingForm } from './onboarding-form'
import { DetailList, Field, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

function RepresentativeMandatePanel({ application, snapshot, command }: {
  application: EntryApplication; snapshot: EntrySnapshot; command: ReturnType<typeof useEntryCommand>;
}) {
  const [evidenceReference, setEvidenceReference] = useState('')
  const [requestedUntil, setRequestedUntil] = useState('')
  const [inputError, setInputError] = useState('')
  const mandates = snapshot.organisation_mandates
  const mandate = mandates?.find(item => item.application_id === application.id && item.applicant_user_id === snapshot.actor.id)
  const admissionCurrent = application.status === 'APPROVED' && application.approved_until !== null && Date.parse(application.approved_until) > Date.now()
  const canRequest = admissionCurrent && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION'
    && mandates !== undefined && (mandate ? ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'].includes(mandate.status) && mandate.can_request : application.can_request_mandate === true)
  const assignedContext = mandate?.status === 'APPLIED' && mandate.effective && Date.parse(mandate.requested_until) > Date.now() && mandate.native_organisation_id
    ? snapshot.contexts.find(item => item.organisation_id === mandate.native_organisation_id && item.roles.includes('OfferingManager')) : undefined

  return <Panel title="Initial representative mandate and operating access" description="This workflow appoints only the applying customer organisation's first representative. Customer admission, representative authority and a platform role are separate decisions; additional representatives require a later controlled workflow.">
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
      <Field label="Requested mandate expiry" hint="The backend limits this to your current admission approval and at most 30 days."><input type="datetime-local" required value={requestedUntil} disabled={command.busy || command.unknown} onChange={event => setRequestedUntil(event.target.value)} /></Field>
      <button className={styles.button} type="submit" disabled={command.busy || command.unknown}>{mandate ? mandate.status === 'CHANGES_REQUIRED' ? 'Resubmit appointment request' : 'Renew appointment request for review' : 'Request Offering Manager appointment review'}</button>
      {inputError ? <p role="alert">{inputError}</p> : null}
      <CommandFeedback command={command} />
    </form> : null}
    {mandates !== undefined && application.status === 'APPROVED' && !mandate && !canRequest ? <Notice title="Appointment request unavailable" tone="warning">No guarded appointment request is available for this admission. BlockXOne operations must resolve the review route; customer approval alone does not grant a role.</Notice> : null}
  </Panel>
}

export function EntryScreen({ initial, release, applicationId, addCapacity = false, chooseContext = false, operationsAvailable = false }: { initial: EntrySnapshot; release: PlatformRelease; applicationId?: string; addCapacity?: boolean; chooseContext?: boolean; operationsAvailable?: boolean }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [adding, setAdding] = useState(addCapacity || initial.applications.length === 0)
  const [persona, setPersona] = useState<Persona | ''>('')
  const [contextKey, setContextKey] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const command = useEntryCommand(snapshot.actor.id, release.environment, setSnapshot, snapshot.requests)
  const application = !chooseContext && !addCapacity ? selectEntryApplication(snapshot, applicationId) : null
  const refresh = useEntryStatusRefresh(snapshot.actor.id, release.environment, application, next => { setSavedMessage(''); setSnapshot(next) })
  const hasInvestorWorkflow = operationsAvailable && snapshot.applications.some(item => item.persona === 'INVESTOR' && item.status === 'APPROVED')
  const hasLegacyManagerWorkflow = operationsAvailable && snapshot.applications.some(item => item.persona === 'WEALTH_MANAGER' && item.status === 'APPROVED' && item.organisation_id && item.admission_purpose === 'LEGACY_REHEARSAL')
  function applicationSaved(next: EntrySnapshot) {
    const saved = next.applications.find(item => item.id === application?.id)
    if (saved && saved.revision > (application?.revision ?? 0)) setSavedMessage(`Hosted record confirmed: application ${saved.id}, revision ${saved.revision}. ${saved.status === 'SUBMITTED' ? 'Submitted for independent review.' : 'Read the recorded status below.'}`)
    setSnapshot(next)
  }
  const organisation = application?.context_organisation_id ? snapshot.contexts.find(context => context.organisation_id === application.context_organisation_id)?.name : undefined
  const capacity = application ? application.persona === 'INVESTOR' ? 'Investor applicant' : 'Wealth-manager / representative applicant' : 'Choose a capacity'
  const title = chooseContext ? 'Choose your operating context.' : application?.persona === 'INVESTOR' ? 'Your investor application.' : application?.persona === 'WEALTH_MANAGER' ? 'Your organisation and representative application.' : 'Your BlockXOne capacities.'
  return <PortalIdentityProvider actorId={snapshot.actor.id} environment={release.environment}><PortalShell user={snapshot.actor} release={release} operatingContext={APPLICANT_CONTEXT} organisationName={organisation ?? 'Personal account'} capacityName={capacity} active="onboarding" capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} title={title} description="One personal login; separately recorded applications and approved operating assignments. Applying never grants a role or signing authority.">
    <div className={styles.stack}>
      {snapshot.contexts.length > 0 ? <Panel title="Approved operating assignments" description="Only current server-authorised organisation and role assignments appear here."><div className={styles.actions}>{snapshot.contexts.flatMap(context => context.roles.map(role => <Link key={`${context.context_key}:${role}`} className={styles.buttonSecondary} href={`/portal?organisation=${encodeURIComponent(context.organisation_id)}&role=${encodeURIComponent(role)}`}>{context.name} · {getRoleDashboard(role)?.title ?? role}</Link>))}</div></Panel> : null}
      {hasInvestorWorkflow || hasLegacyManagerWorkflow ? <Panel title="Existing customer workflows" description="Your existing records remain available. Each operation rechecks its own current authority and product eligibility."><div className={styles.actions}>{hasInvestorWorkflow ? <Link href="/portal/portfolio?mode=applicant" className={styles.buttonSecondary}>Investment accounts and orders</Link> : null}{hasLegacyManagerWorkflow ? <Link href="/portal/products?mode=applicant" className={styles.buttonSecondary}>Historical rehearsal products and offerings</Link> : null}</div></Panel> : null}
      <Panel title="My application capacities" action={<button type="button" className={styles.buttonSecondary} onClick={() => setAdding(value => !value)} aria-expanded={adding}>Add a capacity</button>} description="An investor application and a wealth-manager application have separate references, evidence and review states.">
        {snapshot.applications.length ? <div className={styles.stack}>{snapshot.applications.map(item => <div key={item.id} className={styles.actions}><Link className={styles.buttonSecondary} aria-current={application?.id === item.id ? 'page' : undefined} href={entryApplicationHref(item.id)}>{item.persona === 'INVESTOR' ? 'Investor' : 'Wealth manager'} · {item.context_kind === 'PERSONAL' ? 'Personal' : snapshot.contexts.find(context => context.organisation_id === item.context_organisation_id)?.name ?? 'Organisation context'} · {item.id.slice(0, 8)}</Link><StatusBadge status={item.status} /></div>)}</div> : <p>No application type has been chosen for this login. Choose explicitly below; no investor or organisation authority has been assumed.</p>}
        {adding ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); if (persona) void command.submit('start_application', { persona, ...(contextKey ? { context_key: contextKey } : {}) }) }}>
          <Field label="Capacity to apply for"><select required value={persona} disabled={command.busy || command.unknown} onChange={event => setPersona(event.target.value as Persona | '')}><option value="">Choose a capacity</option><option value="INVESTOR">Investor</option><option value="WEALTH_MANAGER">Wealth manager / organisation representative</option></select></Field>
          <Field label="Application context" hint="An organisation context is available only through an existing approved assignment. A new organisation is described in your personal representative application."><select value={contextKey} disabled={command.busy || command.unknown} onChange={event => setContextKey(event.target.value)}><option value="">Personal capacity / new organisation application</option>{snapshot.contexts.map(context => <option key={context.context_key} value={context.context_key}>{context.name}</option>)}</select></Field>
          <button className={styles.button} disabled={!persona || command.busy || command.unknown} type="submit">Create or continue this application</button><CommandFeedback command={command} />
        </form> : null}
      </Panel>
      {application ? <><Notice title={application.persona === 'INVESTOR' ? 'Investor application workspace' : 'Customer organisation / representative workspace'}>{application.persona === 'INVESTOR' ? 'Complete your investor application here. Workspace access is not eligibility to buy a particular product.' : 'Describe the customer organisation and your representative relationship. Wealth managers are platform clients; they do not perform the platform’s independent compliance review.'}</Notice>
        <div role="status" aria-live="polite" className={styles.statusRegion}>{savedMessage}</div>
        {refresh.available ? <div className={styles.applicationRefresh}><button type="button" className={styles.buttonSecondary} disabled={refresh.busy || command.busy || command.unknown} onClick={() => void refresh.refresh()}>{refresh.busy ? 'Refreshing saved status…' : 'Refresh application status'}</button><p className={styles.muted}>Refresh this saved application to see the review handoff or decision. Editing reopens only when changes are requested.</p><div role="status" aria-live="polite">{refresh.message}</div></div> : null}
        {snapshot.admission.manual_test_review && release.environment === 'TESTNET' && application.context_kind === 'PERSONAL' && application.context_organisation_id === null ? <OnboardingForm key={`${application.id}:${application.revision}`} application={application} environment={release.environment} onSaved={applicationSaved} receipts={snapshot.requests} /> : <Panel title="Application recorded: admission pending"><DetailList rows={[{ label: 'Application reference', value: application.id }, { label: 'Capacity', value: capacity }, { label: 'Status', value: <StatusBadge status={application.status} /> }, { label: 'Next responsible owner', value: 'BlockXOne onboarding / compliance owner' }]} /><p className={styles.sectionGap}>This environment has not admitted an evidence-review provider for this application context. Your recorded application is preserved. Evidence submission and approval are unavailable; no synthetic review is presented as live clearance.</p></Panel>}
        {application.persona === 'WEALTH_MANAGER' && application.admission_purpose === 'CUSTOMER_ORGANISATION_ADMISSION' ? <RepresentativeMandatePanel key={application.id} application={application} snapshot={snapshot} command={command} /> : null}
      </> : !adding && !chooseContext ? <Notice title="Select the application you want to continue">Each application stays separate. No first application or investor capacity has been selected automatically.</Notice> : null}
      <div className={styles.actions}><Link href="/register" className={styles.buttonSecondary}>Account options</Link><Link href="/portal?mode=applicant" className={styles.buttonSecondary}>All my capacities</Link></div>
    </div>
  </PortalShell></PortalIdentityProvider>
}
