'use client'

import Link from 'next/link'
import { customerHandoffHasAction, customerHandoffHref, type CustomerHandoff } from '@/lib/portal/customer-handoff'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import { DetailList, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

const ownerLabels: Record<CustomerHandoff['next_owner'], string> = {
  APPLICANT: 'You, the applicant', COMPLIANCE: 'Independent BlockXOne Compliance Officer',
  SUPER_ADMIN: 'Authorised BlockXOne Super Admin', PROVIDER_OWNER: 'BlockXOne onboarding / provider owner',
  NONE: 'No pending admission handoff',
}
const blockers: Record<CustomerHandoff['blocker'], { title: string; description: string }> = {
  NONE: { title: '', description: '' },
  INTAKE_NOT_ADMITTED: { title: 'Evidence submission is unavailable', description: 'You cannot submit evidence or receive approval through this review route yet. Contact the BlockXOne onboarding owner. Your saved application is unchanged.' },
  REVIEWER_UNAVAILABLE: { title: 'Independent reviewer not assigned', description: 'The BlockXOne onboarding owner must assign an independent reviewer. You can prepare your answers; check the save indicator before leaving. A saved draft is not a submitted application.' },
  PROVIDER_UNSUPPORTED: { title: 'The review route needs attention', description: 'BlockXOne must restore the review service before you can continue. Contact onboarding; no clearance or account access is confirmed.' },
  ADMISSION_EXPIRED: { title: 'Customer admission expired', description: 'An authorised reviewer must renew the customer admission. Its historical approval does not permit account, mandate or product actions.' },
  MONITORING_ON_HOLD: { title: 'Customer relationship on hold', description: 'An ongoing monitoring decision prevents new actions. Contact the responsible reviewer; another capacity or account does not remove the hold.' },
  MONITORING_RENEWAL_REQUIRED: { title: 'Monitoring renewal required', description: 'The responsible reviewer must resolve the current renewal requirement before new account or mandate actions can continue.' },
  ACCOUNT_SUSPENDED: { title: 'Investment account suspended', description: 'The existing account requires authorised review. Creating a replacement account cannot restore its authority.' },
  MANDATE_NOT_EFFECTIVE: { title: 'Representative mandate not effective', description: 'The recorded appointment is expired, revoked or otherwise not effective. It grants no operating access; contact the authorised mandate owner.' },
  CONTEXT_UNAVAILABLE: { title: 'Workspace access could not be verified', description: 'The required current organisation and role context could not be verified. A mandate record alone cannot grant workspace access.' },
  CONTEXT_NOT_SUPPORTED: { title: 'This application needs a supported review route', description: 'Contact the BlockXOne onboarding owner to arrange a review for this application. Your applications stay separate; another capacity does not resolve this blocker.' },
  ADMISSION_NOT_APPROVED: { title: 'Customer admission not current', description: 'Your saved application does not confirm current approval. Account, appointment, product and signing actions remain unavailable from this record.' },
}

export function customerHandoffPresentation(handoff: CustomerHandoff): { title: string; description: string; owner: string } {
  const owner = ownerLabels[handoff.next_owner]
  if (handoff.blocker === 'REVIEWER_UNAVAILABLE' && handoff.state === 'REVIEW_PENDING') return { title: blockers.REVIEWER_UNAVAILABLE.title, description: 'Your submitted case is preserved, but an eligible independent reviewer is not currently assigned. The onboarding owner must restore the review handoff; do not submit a duplicate.', owner }
  if (handoff.blocker !== 'NONE') return { ...blockers[handoff.blocker], owner }
  const steps: Record<CustomerHandoff['state'], { title: string; description: string }> = {
    PREPARE_APPLICATION: { title: 'Draft: not submitted', description: 'Complete your answers and add the requested evidence. Check the save indicator for confirmed draft saving. Submit for review sends the completed application to the reviewer; saving a draft does not.' },
    REVIEW_PENDING: { title: 'Awaiting an independent decision', description: 'Your application has been submitted for independent review. Refresh status for feedback or a decision; do not submit a duplicate.' },
    INFORMATION_REQUIRED: { title: 'Your changes are required', description: 'Read the recorded feedback, update the requested facts and evidence, then resubmit this same application. Earlier submitted revisions remain in its history.' },
    REAPPLICATION_REQUIRED: { title: 'Not approved; you can reapply', description: 'The rejection remains recorded. You may revise and reapply on this same application for a new independent decision. Reapplication does not reverse rejection into approval.' },
    OPEN_ACCOUNT: { title: 'Investor admission approved; account opening next', description: 'The current admission permits the separate investment-account opening workflow. An account is not a cash balance, product eligibility or token holding.' },
    ACCOUNT_AVAILABLE: { title: 'Investment account available', description: 'Open your account to continue. Eligibility to buy each product, signed terms, funding and token issuance remain separate checks. Account records are available in History & support.' },
    REQUEST_MANDATE: handoff.persona === 'INVESTOR'
      ? { title: 'Entity account recorded; representative appointment next', description: 'The entity is the legal account holder. Continue to the separate investing-representative appointment workflow; account creation does not grant authority to instruct investments.' }
      : { title: 'Admission approved; representative appointment next', description: 'Request the separate representative appointment. The organisation admission grants no product, financial or signing powers.' },
    MANDATE_REVIEW_PENDING: { title: 'Representative appointment awaiting review', description: 'Compliance must independently review the appointment request. A submitted mandate does not assign an operating role.' },
    MANDATE_INFORMATION_REQUIRED: { title: 'Representative appointment needs your changes', description: 'Read the appointment feedback and resubmit the existing request. The customer admission and appointment retain their separate histories.' },
    MANDATE_APPLY_PENDING: { title: 'Reviewed appointment awaiting application', description: 'An authorised Super Admin must apply the reviewed appointment. Approval is not yet an active organisation-role assignment.' },
    WORKSPACE_AVAILABLE: { title: 'Operating workspace available', description: 'The server verified an effective applied mandate and its matching organisation-role context. Each product action still rechecks current authority.' },
    UNAVAILABLE: { title: 'Your next step is unavailable', description: 'Contact the BlockXOne onboarding owner to check what is needed next. Your saved application is preserved; no new access is confirmed.' },
  }
  return { ...steps[handoff.state], owner }
}

function OnboardingContact() {
  return <div className={styles.sectionGap}>
    <a href="mailto:daniel@bx1.co.za" className={styles.buttonSecondary}>Contact BlockXOne onboarding</a>
    <p className={styles.muted}>Opens your email app. No application details are included automatically.</p>
  </div>
}

/** Display only a server-validated projection, never derive authority from a badge. */
export function CustomerHandoffPanel({ application, handoff, presentation = 'summary' }: { application: EntryApplication; handoff: CustomerHandoff | null; presentation?: 'summary' | 'history' }) {
  if (presentation === 'history') return <Panel title="Application records">
    <p className={styles.muted}>Current saved facts for this application. These records do not grant permission to continue or replace the submitted-document history.</p>
    <DetailList rows={[{ label: 'Application reference', value: <span className={styles.mono}>{handoff?.application_id ?? application.id}</span> }, { label: 'Saved revision', value: handoff?.application_revision ?? application.revision }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Decision recorded', value: dateLabel(application.reviewed_at) }, { label: 'Admission expiry', value: dateLabel(application.approved_until) }, { label: 'Review evidence mode', value: application.provider_mode === 'MANUAL_TEST_REVIEW' ? 'Manual test review (not live KYC clearance)' : 'Not assigned' }]} />
    {!handoff ? <p className={`${styles.muted} ${styles.sectionGap}`}>Current access checks could not be verified. A saved status is not permission to continue.</p> : <>
      <DetailList rows={[{ label: 'Current next step', value: customerHandoffPresentation(handoff).title }, { label: 'Next responsible owner', value: ownerLabels[handoff.next_owner] }]} />
      <ul className={`${styles.applicationChecklist} ${styles.sectionGap}`} aria-label="Current customer workflow gates">
        <li data-ready={handoff.gates.intake_admitted}><strong>Evidence intake</strong><span>{handoff.gates.intake_admitted ? 'Admitted for this application context' : 'Not admitted for this application context'}</span></li>
        <li data-ready={handoff.gates.reviewer_available}><strong>Independent review route</strong><span>{handoff.gates.reviewer_available ? 'Eligible review assignment exists; not proof the reviewer is signed in' : 'Eligible reviewer not available'}</span></li>
        <li data-ready={handoff.gates.monitoring_allows_new_actions}><strong>New actions / admission and monitoring</strong><span>{handoff.gates.monitoring_allows_new_actions ? 'Current admission and monitoring permit the projected next actions' : 'Not yet permitted by current admission/monitoring'}</span></li>
      </ul>
      {handoff.accounts.length ? <section className={styles.sectionGap}><h3>Linked investment accounts</h3>{handoff.accounts.map(account => <DetailList key={account.id} rows={[{ label: 'Account reference', value: <span className={styles.mono}>{account.id}</span> }, { label: 'Legal holder type', value: account.kind === 'ENTITY' ? 'Legal entity' : 'Individual' }, { label: 'Recorded account status', value: <StatusBadge status={account.status} /> }]} />)}<p className={styles.muted}>A linked account is not product eligibility, wallet authority, funding or ownership.</p></section> : null}
      {handoff.mandate ? <section className={styles.sectionGap}><h3>Linked representative appointment</h3><DetailList rows={[{ label: 'Mandate reference', value: <span className={styles.mono}>{handoff.mandate.id}</span> }, { label: 'Recorded mandate status', value: <StatusBadge status={handoff.mandate.status} /> }, { label: 'Current effect', value: handoff.mandate.effective ? 'Effective within the verified scope' : 'Not effective; no operating authority inferred' }, ...(handoff.native_context ? [{ label: 'Verified operating organisation', value: <span className={styles.mono}>{handoff.native_context.organisation_id}</span> }] : [])]} /></section> : null}
    </>}
  </Panel>
  if (!handoff) return <Panel title="Your next step">
    <div className={styles.applicationState} aria-live="polite"><h3>Saved progress could not be verified</h3><p>Contact the BlockXOne onboarding owner to confirm your next step. Your saved application is unchanged. No submission, account opening or operating assignment is confirmed.</p></div>
    <DetailList rows={[{ label: 'Next responsible owner', value: 'BlockXOne onboarding owner' }]} />
    <OnboardingContact />
  </Panel>
  const next = customerHandoffPresentation(handoff)
  const linkLabel = customerHandoffHasAction(handoff, 'OPEN_INVESTMENT_ACCOUNT') ? 'Continue to investment-account opening'
    : customerHandoffHasAction(handoff, 'REQUEST_INVESTING_REPRESENTATIVE_MANDATE') ? 'Continue to entity representative appointment'
    : customerHandoffHasAction(handoff, 'VIEW_INVESTMENT_ACCOUNT') ? 'View investment account and orders'
    : customerHandoffHasAction(handoff, 'ENTER_OPERATING_WORKSPACE') ? 'Open Offering Manager workspace' : null
  const href = handoff.blocker === 'NONE' && handoff.state !== 'UNAVAILABLE' && handoff.environment === 'TESTNET' && linkLabel ? customerHandoffHref(handoff) : null
  const needsContact = handoff.blocker !== 'NONE' || handoff.state === 'UNAVAILABLE'
  return <Panel title="Your next step">
    <div className={styles.applicationState} aria-live="polite"><h3>{next.title}</h3><p>{next.description}</p></div>
    <DetailList rows={[{ label: 'Next responsible owner', value: next.owner }]} />
    {href ? <div className={styles.sectionGap}><Link href={href} className={styles.buttonSecondary}>{linkLabel}</Link></div> : null}
    {needsContact ? <OnboardingContact /> : null}
    {handoff.environment === 'MAINNET' ? <div className={styles.sectionGap}><Notice title="MAIN admission remains unavailable" tone="warning">Live onboarding is not yet available. Do not submit real documents or transfer money through a substitute process.</Notice></div> : <p className={`${styles.muted} ${styles.sectionGap}`}>TEST only. Synthetic evidence or a test decision does not establish production clearance.</p>}
  </Panel>
}
