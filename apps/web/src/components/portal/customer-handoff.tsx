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
  INTAKE_NOT_ADMITTED: { title: 'Evidence intake not admitted', description: 'The evidence/provider route is not admitted for this environment and application context. Your saved application remains intact; evidence submission and approval are unavailable.' },
  REVIEWER_UNAVAILABLE: { title: 'Independent reviewer not assigned', description: 'The onboarding owner must assign an eligible independent reviewer. Prepared browser fields are not submitted or saved automatically.' },
  PROVIDER_UNSUPPORTED: { title: 'Review provider not supported', description: 'The recorded provider mode cannot be used by this workflow. The provider owner must resolve the route; no clearance or account authority is inferred.' },
  ADMISSION_EXPIRED: { title: 'Customer admission expired', description: 'An authorised reviewer must renew the customer admission. Its historical approval does not permit account, mandate or product actions.' },
  MONITORING_ON_HOLD: { title: 'Customer relationship on hold', description: 'An ongoing monitoring decision prevents new actions. Contact the responsible reviewer; another capacity or account does not remove the hold.' },
  MONITORING_RENEWAL_REQUIRED: { title: 'Monitoring renewal required', description: 'The responsible reviewer must resolve the current renewal requirement before new account or mandate actions can continue.' },
  ACCOUNT_SUSPENDED: { title: 'Investment account suspended', description: 'The existing account requires authorised review. Creating a replacement account cannot restore its authority.' },
  MANDATE_NOT_EFFECTIVE: { title: 'Representative mandate not effective', description: 'The recorded appointment is expired, revoked or otherwise not effective. It grants no operating access; contact the authorised mandate owner.' },
  CONTEXT_UNAVAILABLE: { title: 'Operating context not verified', description: 'The required current organisation and role context could not be verified. A mandate record alone cannot grant workspace access.' },
  CONTEXT_NOT_SUPPORTED: { title: 'Application context not admitted', description: 'The evidence-review route does not support this application context. The onboarding owner must resolve it without merging this application into another capacity.' },
  ADMISSION_NOT_APPROVED: { title: 'Customer admission not current', description: 'The saved customer-admission record does not establish current approval. No account, mandate, product or signing authority is available from this record.' },
}

export function customerHandoffPresentation(handoff: CustomerHandoff): { title: string; description: string; owner: string } {
  const owner = ownerLabels[handoff.next_owner]
  if (handoff.blocker === 'REVIEWER_UNAVAILABLE' && handoff.state === 'REVIEW_PENDING') return { title: blockers.REVIEWER_UNAVAILABLE.title, description: 'Your submitted case is preserved, but an eligible independent reviewer is not currently assigned. The onboarding owner must restore the review handoff; do not submit a duplicate.', owner }
  if (handoff.blocker !== 'NONE') return { ...blockers[handoff.blocker], owner }
  const steps: Record<CustomerHandoff['state'], { title: string; description: string }> = {
    PREPARE_APPLICATION: { title: 'Draft: not submitted', description: 'Prepare the requested facts and private evidence below. Changes stay in this browser until the server confirms submission of this same application.' },
    REVIEW_PENDING: { title: 'Awaiting an independent decision', description: 'The saved application package is in the independent review handoff. Refresh saved status to see feedback or a decision; do not submit a duplicate.' },
    INFORMATION_REQUIRED: { title: 'Your changes are required', description: 'Read the recorded feedback, update the requested facts and evidence, then resubmit this same application. Earlier submitted revisions remain in its history.' },
    REAPPLICATION_REQUIRED: { title: 'Application not approved; reapplication available', description: 'The rejection remains recorded. You may revise and reapply on this same application for a new independent decision. Reapplication does not reverse rejection into approval.' },
    OPEN_ACCOUNT: { title: 'Investor admission approved; account opening next', description: 'The current admission permits the separate investment-account opening workflow. An account is not a cash balance, product eligibility or token holding.' },
    ACCOUNT_AVAILABLE: { title: 'Investment account available', description: 'The linked account is recorded below. Eligibility to buy each product, signed terms, funding and issuance remain separate guarded workflows.' },
    REQUEST_MANDATE: handoff.persona === 'INVESTOR'
      ? { title: 'Entity account recorded; representative appointment next', description: 'The entity is the legal account holder. Continue to the separate investing-representative appointment workflow; account creation does not grant authority to instruct investments.' }
      : { title: 'Customer admission approved; operating assignment pending', description: 'Request the separate representative appointment below. The organisation admission grants no product, financial or signing powers.' },
    MANDATE_REVIEW_PENDING: { title: 'Representative appointment awaiting review', description: 'Compliance must independently review the appointment request. A submitted mandate does not assign an operating role.' },
    MANDATE_INFORMATION_REQUIRED: { title: 'Representative appointment needs your changes', description: 'Read the appointment feedback and resubmit the existing request. The customer admission and appointment retain their separate histories.' },
    MANDATE_APPLY_PENDING: { title: 'Reviewed appointment awaiting application', description: 'An authorised Super Admin must apply the reviewed appointment. Approval is not yet an active organisation-role assignment.' },
    WORKSPACE_AVAILABLE: { title: 'Operating workspace available', description: 'The server verified an effective applied mandate and its matching organisation-role context. Each product action still rechecks current authority.' },
    UNAVAILABLE: { title: 'Customer handoff unavailable', description: 'The current next action could not be admitted. Your saved record is preserved; contact the BlockXOne onboarding owner.' },
  }
  return { ...steps[handoff.state], owner }
}

/** Display only a server-validated projection, never derive authority from a badge. */
export function CustomerHandoffPanel({ application, handoff }: { application: EntryApplication; handoff: CustomerHandoff | null }) {
  if (!handoff) return <Panel title="Application recorded: handoff unavailable">
    <DetailList rows={[{ label: 'Application reference', value: <span className={styles.mono}>{application.id}</span> }, { label: 'Saved revision', value: application.revision }, { label: 'Next responsible owner', value: 'BlockXOne onboarding owner' }]} />
    <div className={styles.sectionGap}><Notice title="Saved progress could not be verified" tone="warning">The current workflow projection is missing, stale or unavailable. Your application is preserved. No evidence submission, account opening or operating assignment is inferred; contact the onboarding owner with this application reference.</Notice></div>
  </Panel>
  const next = customerHandoffPresentation(handoff)
  const href = customerHandoffHref(handoff)
  const linkLabel = customerHandoffHasAction(handoff, 'OPEN_INVESTMENT_ACCOUNT') ? 'Continue to investment-account opening'
    : customerHandoffHasAction(handoff, 'REQUEST_INVESTING_REPRESENTATIVE_MANDATE') ? 'Continue to entity representative appointment'
    : customerHandoffHasAction(handoff, 'VIEW_INVESTMENT_ACCOUNT') ? 'View investment account and orders' : 'Open Offering Manager workspace'
  return <Panel title="Connected customer-admission handoff" description="Saved progress for this exact application and revision. These read-only facts do not replace the guarded authority checks on each action.">
    <div className={styles.applicationState} aria-live="polite"><h3>{next.title}</h3><p>{next.description}</p></div>
    <DetailList rows={[{ label: 'Application reference', value: <span className={styles.mono}>{handoff.application_id}</span> }, { label: 'Saved revision', value: handoff.application_revision }, { label: 'Next responsible owner', value: next.owner }, { label: 'Admission expiry', value: dateLabel(application.approved_until) }, { label: 'Review evidence mode', value: application.provider_mode === 'MANUAL_TEST_REVIEW' ? 'Manual test review (not live KYC clearance)' : 'Not assigned' }]} />
    <ul className={`${styles.applicationChecklist} ${styles.sectionGap}`} aria-label="Current customer workflow gates">
      <li data-ready={handoff.gates.intake_admitted}><strong>Evidence intake</strong><span>{handoff.gates.intake_admitted ? 'Admitted for this application context' : 'Not admitted for this application context'}</span></li>
      <li data-ready={handoff.gates.reviewer_available}><strong>Independent review route</strong><span>{handoff.gates.reviewer_available ? 'Eligible review assignment exists; not proof the reviewer is signed in' : 'Eligible reviewer not available'}</span></li>
      <li data-ready={handoff.gates.monitoring_allows_new_actions}><strong>New actions / admission and monitoring</strong><span>{handoff.gates.monitoring_allows_new_actions ? 'Current admission and monitoring permit the projected next actions' : 'Not yet permitted by current admission/monitoring'}</span></li>
    </ul>
    {handoff.accounts.length ? <section className={styles.sectionGap}><h3>Linked investment accounts</h3>{handoff.accounts.map(account => <DetailList key={account.id} rows={[{ label: 'Account reference', value: <span className={styles.mono}>{account.id}</span> }, { label: 'Legal holder type', value: account.kind === 'ENTITY' ? 'Legal entity' : 'Individual' }, { label: 'Recorded account status', value: <StatusBadge status={account.status} /> }]} />)}<p className={styles.muted}>A linked account is not product eligibility, wallet authority, funding or ownership.</p></section> : null}
    {handoff.mandate ? <section className={styles.sectionGap}><h3>Linked representative appointment</h3><DetailList rows={[{ label: 'Mandate reference', value: <span className={styles.mono}>{handoff.mandate.id}</span> }, { label: 'Recorded mandate status', value: <StatusBadge status={handoff.mandate.status} /> }, { label: 'Current effect', value: handoff.mandate.effective ? 'Effective within the verified scope' : 'Not effective; no operating authority inferred' }, ...(handoff.native_context ? [{ label: 'Verified operating organisation', value: <span className={styles.mono}>{handoff.native_context.organisation_id}</span> }] : [])]} /></section> : null}
    {href ? <div className={styles.sectionGap}><Link href={href} className={styles.buttonSecondary}>{linkLabel}</Link></div> : null}
    {handoff.environment === 'MAINNET' ? <div className={styles.sectionGap}><Notice title="MAIN admission remains unavailable" tone="warning">The same customer workflow is displayed here, but live evidence/provider admission has not passed. Do not submit real documents or transfer money through a substitute process.</Notice></div> : <p className={`${styles.muted} ${styles.sectionGap}`}>TEST rehearsal only. Synthetic evidence or a test decision does not establish production clearance.</p>}
  </Panel>
}
