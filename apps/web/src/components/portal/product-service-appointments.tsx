'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PortalProduct, PortalProductServiceAppointment, PortalSnapshot } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand } from './portal-client'
import { DetailList, EmptyState, Field, Notice, Panel, StatusBadge, dateLabel } from './portal-primitives'
import styles from './portal.module.css'

const roleLabel = (role: PortalProductServiceAppointment['role']) => role === 'IssuerFundManager' ? 'Issuer Fund Manager' : 'Compliance Officer'

export function ProductAppointmentRequest({ product, snapshot, operatingContext, onSaved }: {
  product: PortalProduct; snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext;
  onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const command = usePortalCommand(onSaved)
  const [role, setRole] = useState<PortalProductServiceAppointment['role']>('IssuerFundManager')
  const [membershipId, setMembershipId] = useState('')
  const [evidence, setEvidence] = useState('')
  const [expiryDay, setExpiryDay] = useState('')
  const appointments = snapshot.product_appointments?.filter(item => item.product_id === product.id) ?? []
  const candidates = snapshot.product_appointment_candidates?.filter(item => item.product_id === product.id && item.role === role) ?? []
  const candidate = candidates.find(item => item.membership_id === membershipId)
  const isManager = operatingContext?.mode === 'ROLE' && operatingContext.role === 'OfferingManager'
    && snapshot.organisations.some(org => org.id === product.organisation_id && org.status === 'ACTIVE'
      && org.authority_source === 'NATIVE_BINDING' && org.native_organisation_id === operatingContext.organisationId
      && org.roles.includes('OfferingManager'))
  const expiredPending = appointments.some(item => item.role === role && ['SUBMITTED', 'APPROVED'].includes(item.status)
    && Date.parse(item.requested_until) <= Date.now())
  const hasOpenRole = appointments.some(item => item.role === role && (item.status === 'APPLIED'
    || (['SUBMITTED', 'APPROVED'].includes(item.status) && Date.parse(item.requested_until) > Date.now())))
  const canRequest = isManager && Boolean(candidate) && !hasOpenRole && evidence.trim().length >= 20 && Boolean(expiryDay)

  return <Panel title="Product service appointments" description="Appoint separate people for this exact product. An issuer name or manager relationship does not grant review or signing authority.">
    {!Array.isArray(snapshot.product_appointments) || !Array.isArray(snapshot.product_appointment_candidates)
      ? <Notice title="Appointment service unavailable" tone="warning">Refresh saved state. Do not infer that no appointments exist while this service is unavailable.</Notice>
      : <>{appointments.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Appointment</th><th scope="col">State</th><th scope="col">Validity</th><th scope="col">Next owner</th></tr></thead><tbody>{appointments.map(item => <tr key={item.id}><td><strong>{roleLabel(item.role)}</strong><small className={styles.mono}>{item.id}</small></td><td><StatusBadge status={item.status} />{item.status === 'APPLIED' && !item.effective ? <small>Not currently effective</small> : null}</td><td>{dateLabel(item.requested_until)}</td><td>{item.status === 'APPLIED' && !item.effective ? 'Super Admin: revoke inactive appointment before replacement' : item.next_owner === 'COMPLIANCE' ? 'Independent Compliance' : item.next_owner === 'SUPER_ADMIN' ? 'Super Admin' : item.next_owner === 'OFFERING_MANAGER' ? 'Offering Manager' : 'No pending hand-off'}</td></tr>)}</tbody></table></div> : <p className={styles.muted}>No product-specific appointment is recorded in this scope.</p>}
        {isManager ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => {
          event.preventDefault()
          if (!canRequest || !candidate) return
          const requestedUntil = new Date(`${expiryDay}T23:59:59Z`).toISOString()
          void command.submit('request_product_service_appointment', {
            product_id: product.id, role, appointee_user_id: candidate.user_id,
            native_membership_id: candidate.membership_id, expected_product_revision: product.revision,
            evidence_reference: evidence.trim(), requested_until: requestedUntil,
          })
        }}><h3>Request an independent service appointment</h3><p className={styles.muted}>Candidates already hold a native role in the review organisation. This request does not activate it for this product; Compliance reviews and a separate Super Admin applies it.</p>
          <Field label="Service role"><select value={role} onChange={event => { setRole(event.target.value as typeof role); setMembershipId('') }}><option value="IssuerFundManager">Issuer Fund Manager</option><option value="ComplianceOfficer">Compliance Officer</option></select></Field>
          <Field label="Existing role member"><select required value={membershipId} onChange={event => setMembershipId(event.target.value)}><option value="">Select a different person</option>{candidates.map(item => <option key={item.membership_id} value={item.membership_id}>{item.display_name || item.email} · {item.email}</option>)}</select></Field>
          {!candidates.length ? <Notice title="No eligible role member">A role member must be assigned and visible in the review organisation before an appointment can be requested. This form cannot create that person or role.</Notice> : null}
          <Field label="Appointment evidence reference" hint="20 to 400 characters identifying the synthetic appointment evidence. This is not an uploaded or verified document."><textarea required minLength={20} maxLength={400} value={evidence} onChange={event => setEvidence(event.target.value)} /></Field>
          <Field label="Appointment end date" hint="Choose a date more than one hour and no more than 90 days ahead; the server enforces the limit."><input required type="date" value={expiryDay} onChange={event => setExpiryDay(event.target.value)} /></Field>
          {hasOpenRole ? <Notice title="Current appointment already exists">Review or revoke the existing {roleLabel(role)} case before requesting another appointment for this product.</Notice> : null}
          {expiredPending && !hasOpenRole ? <Notice title="Earlier request expired">You can submit a new request. The server will close the expired case with an audit receipt before opening its replacement.</Notice> : null}
          <CommandFeedback command={command} /><button className={styles.button} type="submit" disabled={!canRequest || command.busy || command.unknown}>Request appointment review</button>
        </form> : null}</>}
  </Panel>
}

export function ProductAppointmentQueue({ snapshot, operatingContext }: { snapshot: PortalSnapshot; operatingContext?: PortalOperatingContext }) {
  if (operatingContext?.mode !== 'ROLE' || !['ComplianceOfficer', 'SuperAdmin'].includes(operatingContext.role)) return null
  const appointments = snapshot.product_appointments?.filter(item => item.can_review || item.can_apply || item.can_revoke) ?? []
  return <Panel title="Product service appointments" description="Review and apply product-specific issuer and Compliance appointments separately from customer admission." flush>
    {!Array.isArray(snapshot.product_appointments) ? <Notice title="Appointment queue unavailable" tone="warning">Refresh saved state before concluding no cases need action.</Notice>
      : appointments.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Role</th><th scope="col">State</th><th scope="col">Action</th></tr></thead><tbody>{appointments.map(item => <tr key={item.id}><td><strong>{snapshot.products.find(product => product.id === item.product_id)?.terms.name ?? 'Scoped product'}</strong><small className={styles.mono}>{item.product_id}</small></td><td>{roleLabel(item.role)}</td><td><StatusBadge status={item.status} /></td><td><Link href={portalScopeHref('/portal/compliance/detail', operatingContext, item.id)}>{item.can_review ? 'Review appointment' : item.can_apply ? 'Apply approved appointment' : 'Inspect revocation'}</Link></td></tr>)}</tbody></table></div>
        : <EmptyState title="No product appointments need action" description="The connected queue will show cases available to this current role and organisation." />}
  </Panel>
}

export function ProductAppointmentDecision({ appointment, snapshot, onSaved }: {
  appointment: PortalProductServiceAppointment; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const command = usePortalCommand(onSaved)
  const [decision, setDecision] = useState<'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED'>('CHANGES_REQUIRED')
  const [notes, setNotes] = useState('')
  const [checks, setChecks] = useState({ appointment: false, evidence: false, scope: false })
  const [revokeReason, setRevokeReason] = useState('')
  const product = snapshot.products.find(item => item.id === appointment.product_id)
  const checked = Object.values(checks).every(Boolean)
  return <div className={styles.stack}>
    <Notice title="Product appointment, not transaction authority">This synthetic TEST appointment permits only the stated product-review function while it remains effective. It grants no settlement, token issuance, wallet signature or production authority.</Notice>
    <Panel title={product?.terms.name ?? 'Product service appointment'} action={<StatusBadge status={appointment.status} />}><DetailList rows={[
      { label: 'Appointment reference', value: <span className={styles.mono}>{appointment.id}</span> },
      { label: 'Product reference', value: <span className={styles.mono}>{appointment.product_id}</span> },
      { label: 'Service role', value: roleLabel(appointment.role) },
      { label: 'Appointee', value: appointment.appointee_user_id },
      { label: 'Package terms fingerprint', value: <span className={styles.mono}>{appointment.terms_hash_at_request}</span> },
      { label: 'Case revision', value: appointment.revision },
      { label: 'Requested until', value: dateLabel(appointment.requested_until) },
      { label: 'Effective now', value: appointment.effective ? 'Yes' : 'No' },
    ]} /><h3>Appointment evidence reference</h3><p className={styles.copy}>{appointment.evidence_reference}</p>{appointment.review_notes ? <><h3>Review rationale</h3><p className={styles.copy}>{appointment.review_notes}</p></> : null}</Panel>
    {appointment.can_review ? <Panel title="Independent Compliance review" description="Assess the appointment, evidence and exact product before deciding."><form className={styles.form} onSubmit={event => {
      event.preventDefault()
      if (decision === 'APPROVED' && !checked) return
      void command.submit('review_product_service_appointment', { appointment_id: appointment.id, expected_revision: appointment.revision, decision, notes: notes.trim(), checks })
    }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Appointment checks</legend>{([
      ['appointment', 'The proposed person and role are appointed for this product'],
      ['evidence', 'The referenced appointment evidence was examined'],
      ['scope', 'The product, organisation and expiry scope are correct'],
    ] as const).map(([key, label]) => <label key={key} className={styles.check}><input type="checkbox" checked={checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
      <Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="CHANGES_REQUIRED">Request changes</option><option value="APPROVED">Approve for separate application</option><option value="REJECTED">Reject</option></select></Field>
      <Field label="Reasoned decision" hint="20 to 3,000 characters."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      <CommandFeedback command={command} /><button className={styles.button} type="submit" disabled={decision === 'APPROVED' && !checked}>Record review</button></fieldset></form></Panel> : null}
    {appointment.can_apply ? <Panel title="Super Admin application" description="Apply only this independently reviewed product appointment."><CommandFeedback command={command} /><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('apply_product_service_appointment', { appointment_id: appointment.id, expected_revision: appointment.revision })}>Apply product appointment</button></Panel> : null}
    {appointment.can_revoke ? <Panel title="Revoke product appointment" description="Ends this product-specific review authority, including prepared but unused actions."><form className={styles.form} onSubmit={event => {
      event.preventDefault()
      if (revokeReason.trim().length < 20) return
      void command.submit('revoke_product_service_appointment', { appointment_id: appointment.id, expected_revision: appointment.revision, reason: revokeReason.trim() })
    }}><Field label="Revocation reason" hint="20 to 1,000 characters."><textarea required minLength={20} maxLength={1000} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></Field><CommandFeedback command={command} /><button className={styles.button} type="submit" disabled={command.busy || command.unknown || revokeReason.trim().length < 20}>Revoke appointment</button></form></Panel> : null}
    {!appointment.can_review && !appointment.can_apply && !appointment.can_revoke ? <Notice title="No action in this scope">This case is visible for context, but your current role has no outstanding action.</Notice> : null}
  </div>
}
