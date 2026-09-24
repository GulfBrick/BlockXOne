'use client'

import { useState } from 'react'
import Link from 'next/link'
import { portalContextMatches, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PortalApplication, PortalCustomerMonitoring, PortalSnapshot } from '@/lib/portal/contracts'
import { CommandFeedback, usePortalCommand } from './portal-client'
import { DetailList, EmptyState, Field, Notice, Panel, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

function scopedCompliance(snapshot: PortalSnapshot, context?: PortalOperatingContext): boolean {
  return context?.mode === 'ROLE' && context.role === 'ComplianceOfficer' && snapshot.actor.can_review === true
    && portalContextMatches(snapshot.operating_context, context)
}

function monitoringLabel(item: PortalCustomerMonitoring): string {
  return item.case_revision === 0 ? 'No additional restriction recorded' : item.state === 'CURRENT'
    ? 'Restriction lifted by reviewed decision' : item.state === 'ON_HOLD' ? 'New actions on hold' : 'Renewal required before new actions'
}

/** The queue is populated only by the guarded scoped read; absence is not a zero-case claim. */
export function CustomerMonitoringQueue({ snapshot, operatingContext }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  const authorisedView = scopedCompliance(snapshot, operatingContext)
  const monitoring = authorisedView && Array.isArray(snapshot.customer_monitoring) ? snapshot.customer_monitoring : undefined
  const applications = new Map(snapshot.applications.map(application => [application.id, application]))
  const restricted = monitoring?.filter(item => item.state !== 'CURRENT').length
  return <Panel title="Customer monitoring and restrictions" description="Review current admission and record holds or renewal requirements with a reviewer-cited evidence reference. This gate prevents new business actions; it does not erase existing holdings or replace admission and product-specific decisions." flush>
    {!authorisedView ? <Notice title="Monitoring scope unavailable" tone="warning">A verified Compliance Officer operating context is required. No customer details or case totals are shown.</Notice>
      : !monitoring ? <Notice title="Monitoring records unavailable" tone="warning">The guarded monitoring read is not connected for this environment or session. Refresh saved state; do not interpret this as zero restrictions.</Notice>
        : monitoring.length === 0 ? <EmptyState title="No approved admissions in this review scope" description="Only applications returned by the guarded reviewer scope appear here. No customer-monitoring decision has been inferred." />
          : <><p className={styles.copy}>{restricted} of {monitoring.length} visible admission{monitoring.length === 1 ? '' : 's'} {restricted === 1 ? 'has' : 'have'} an additional restriction. Admission expiry and product eligibility remain separate checks.</p>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Customer</th><th scope="col">Admission expiry</th><th scope="col">Monitoring state</th><th scope="col">New actions</th><th scope="col">Review</th></tr></thead><tbody>
              {monitoring.map(item => {
                const application = applications.get(item.application_id)
                const sourceCurrent = application?.status === 'APPROVED' && application.revision === item.application_revision
                return <tr key={item.application_id}>
                  <td><strong>{application ? application.persona === 'WEALTH_MANAGER' ? application.details.company_name || 'Customer organisation' : application.details.full_name : 'Application details unavailable'}</strong><small>{application?.persona === 'WEALTH_MANAGER' ? 'Customer organisation admission' : application?.persona === 'INVESTOR' ? 'Investor admission' : 'Source outside this saved view'}</small><small className={styles.mono}>{item.application_id}</small></td>
                  <td>{dateLabel(item.admission_expires_at)}{item.renewal_due ? <small>Renewal is due or admission has expired</small> : null}</td>
                  <td>{monitoringLabel(item)}<small>Case revision {item.case_revision}</small></td>
                  <td>{item.new_actions_allowed ? 'No monitoring block; all other gates still apply' : 'Blocked by monitoring or admission expiry'}</td>
                  <td>{sourceCurrent ? <Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.application_id)}>Inspect evidence and decide</Link> : <span className={styles.muted}>Source revision unavailable; refresh before deciding</span>}</td>
                </tr>
              })}
            </tbody></table></div></>}
  </Panel>
}

const CHECKS = [
  { key: 'identity', label: 'Identity evidence is current' },
  { key: 'ownership', label: 'Ownership and representative authority are current' },
  { key: 'screening', label: 'Screening evidence is current' },
  { key: 'suitability', label: 'Suitability or customer-service scope is current' },
] as const
type MonitoringState = PortalCustomerMonitoring['state']

/** A restriction decision references evidence; it never generates a provider result or an approval. */
export function CustomerMonitoringDecision({ application, snapshot, operatingContext, onSaved }: {
  application: PortalApplication; snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext;
  onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const monitoring = snapshot.customer_monitoring?.find(item => item.application_id === application.id)
  const [state, setState] = useState<MonitoringState>(monitoring?.state === 'ON_HOLD' ? 'RENEWAL_REQUIRED' : 'ON_HOLD')
  const [evidenceReference, setEvidenceReference] = useState('')
  const [reason, setReason] = useState('')
  const [checks, setChecks] = useState({ identity: false, ownership: false, screening: false, suitability: false })
  const command = usePortalCommand(onSaved)
  const sourceCurrent = application.status === 'APPROVED' && monitoring?.application_revision === application.revision
  const independentActor = application.user_id !== snapshot.actor.id
  const canAct = scopedCompliance(snapshot, operatingContext) && sourceCurrent && independentActor
  const expiry = monitoring?.admission_expires_at ? Date.parse(monitoring.admission_expires_at) : NaN
  const currentAdmission = Number.isFinite(expiry) && expiry > Date.now()
  const mayRestore = monitoring?.case_revision !== 0 && currentAdmission
  const allChecks = Object.values(checks).every(Boolean)
  const reference = evidenceReference.trim(), rationale = reason.trim()
  const validForm = reference.length >= 20 && reference.length <= 400 && rationale.length >= 20 && rationale.length <= 2000
    && state !== monitoring?.state && (state !== 'CURRENT' || mayRestore && allChecks)

  return <Panel title="Ongoing customer monitoring" description="Record a separate review of this approved admission. The backend rechecks the live session, reviewer appointment, different person and case revisions, and requires a cited evidence reference; it does not verify a provider result.">
    {!scopedCompliance(snapshot, operatingContext) || !Array.isArray(snapshot.customer_monitoring) ? <Notice title="Monitoring decision unavailable" tone="warning">A guarded, matching Compliance review snapshot is required. No monitoring status can be inferred from this page.</Notice>
      : !monitoring ? <Notice title="Monitoring case unavailable" tone="warning">The saved monitoring read did not include this application. Refresh before drawing any conclusion or recording a decision.</Notice>
        : <><DetailList rows={[{ label: 'Monitoring', value: monitoringLabel(monitoring) }, { label: 'Case revision', value: monitoring.case_revision }, { label: 'Underlying admission expiry', value: dateLabel(monitoring.admission_expires_at) }, { label: 'New-action gate', value: monitoring.new_actions_allowed ? 'No monitoring block; other permissions still apply' : 'Blocked by monitoring or admission expiry' }]} />
          {monitoring.renewal_due ? <Notice title="Admission renewal due" tone="warning">A CURRENT monitoring decision cannot extend an expired admission. A separate admission renewal must be reviewed first.</Notice> : null}
          {!independentActor ? <Notice title="Different reviewer required" tone="warning">You cannot decide monitoring for your own application. The backend also checks person-level independence across accounts.</Notice> : null}
          {application.status !== 'APPROVED' || !sourceCurrent ? <Notice title="Source admission changed" tone="warning">This application is no longer an approved match for the saved monitoring revision. Refresh and inspect the current source before deciding.</Notice> : null}
          {canAct ? <><CommandFeedback command={command} /><form className={styles.form} onSubmit={event => { event.preventDefault(); if (validForm) void command.submit('set_customer_monitoring', { application_id: application.id, expected_revision: monitoring.case_revision, state, evidence_reference: reference, reason: rationale, checks }) }}>
            <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Independent monitoring decision</legend>
              <Field label="Decision"><select value={state} onChange={event => setState(event.target.value as MonitoringState)}>
                <option value="ON_HOLD" disabled={monitoring.state === 'ON_HOLD'}>Place new actions on hold</option>
                <option value="RENEWAL_REQUIRED" disabled={monitoring.state === 'RENEWAL_REQUIRED'}>Require customer renewal</option>
                <option value="CURRENT" disabled={!mayRestore || monitoring.state === 'CURRENT'}>Lift additional restriction after current evidence review</option>
              </select></Field>
              <Field label="Evidence reference" hint="20–400 characters. Cite a saved, authorised evidence or case reference; this field does not validate a provider result."><input required minLength={20} maxLength={400} value={evidenceReference} onChange={event => setEvidenceReference(event.target.value)} /></Field>
              <Field label="Decision reason" hint="20–2,000 characters. Explain the specific restriction or why it can be lifted."><textarea required minLength={20} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></Field>
              <div><p className={styles.copy}>Mark only checks supported by current evidence. Lifting a restriction requires all four; a hold does not certify missing evidence.</p>{CHECKS.map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}</div>
              <button type="submit" className={styles.button} disabled={!validForm}>Record monitoring decision</button>
            </fieldset>
          </form></> : null}
          <Notice title="Distinct controls remain">A monitoring CURRENT state is not customer admission renewal, product eligibility, wallet authority, or permission to move existing assets.</Notice>
        </>}
  </Panel>
}
