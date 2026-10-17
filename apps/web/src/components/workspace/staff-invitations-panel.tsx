'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import type { StaffInviteDirectory, StaffInviteView } from '@/lib/administration/staff-invitations'

type Ready = Extract<StaffInviteDirectory,{ ok:true }>
const input = 'min-h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 py-2 text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'

export function StaffInvitationsPanel({ directory, organisationId }: { directory: Ready; organisationId:string }) {
  const [email,setEmail] = useState('')
  const [role,setRole] = useState<string>('Investor')
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  async function command(intent: string, invite?: StaffInviteView) {
    if (busy) return
    setBusy(true); setMessage('')
    const body = new URLSearchParams({ intent, organisationId, ...(['dispatch','reconcile'].includes(intent) ? {} : { requestKey:crypto.randomUUID() }) })
    if (intent === 'propose') {
      body.set('email',email.trim().toLowerCase()); body.set('role',role); body.set('expectedScopeRevision',directory.scopeRevision)
    } else if (invite) {
      body.set('invitationId',invite.id)
      if (!['dispatch','reconcile'].includes(intent)) body.set('expectedRevision',invite.revision)
    }
    try {
      const response = await fetch('/auth/staff-invite',{ method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json' },body })
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error()
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object' || !('ok' in value)) throw new Error()
      if (value.ok !== true || !response.ok) {
        setMessage('The action was not confirmed. Reload to check the current invitation and authority before another action; do not blindly resend.')
        return
      }
      setMessage(intent === 'dispatch' ? 'Supabase Auth accepted the invitation send. Email delivery and acceptance remain separate.' : intent === 'reconcile' ? 'Provider invitation evidence was matched without resending. Reload for the current state.' : invite?.state === 'EXPIRED' && intent === 'cancel' ? 'The expired invitation was closed with an audit record. A previous Auth send may still require provider review; this action did not resend or grant access.' : 'Recorded. Reload for the current reviewed state.')
      if (intent !== 'dispatch') setEmail('')
    } catch { setMessage('Outcome unknown. Reload and inspect the current invitation before acting again; do not blindly resend.') }
    finally { setBusy(false) }
  }
  return <div className="mt-8 space-y-8">
    <section aria-labelledby="new-staff-invitation" className="rounded-xl border border-bxo-border-default bg-bxo-bg-secondary p-5 sm:p-7">
      <h2 id="new-staff-invitation" className="font-ui text-2xl font-medium text-bxo-text-primary">Propose a first-time invitation</h2>
      <p className="mt-2 text-sm leading-6 text-bxo-text-secondary">A different authorised person must approve. Applying queues the invitation; sending is an explicit subsequent action. The invited person receives no role until verified email, password and authenticator acceptance.</p>
      <p className="mt-2 text-sm leading-6 text-bxo-text-secondary">Expired proposals and unsent invitations can be closed and proposed again. An unknown Auth send or an already-created Auth account is never resent through this first-time flow.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-bxo-text-primary">New user email<input type="email" autoComplete="off" value={email} onChange={event=>setEmail(event.target.value)} maxLength={254} className={`${input} mt-2`} /></label>
        <label className="block text-sm font-semibold text-bxo-text-primary">Scoped capacity<select value={role} onChange={event=>setRole(event.target.value)} className={`${input} mt-2`}>{BX1_ROLES.map(value=><option key={value} value={value}>{value}</option>)}</select></label></div>
      <Button type="button" disabled={busy || !email} onClick={()=>void command('propose')} className="mt-5 min-h-11">Propose invitation</Button>
    </section>
    <section aria-labelledby="staff-invitation-history"><h2 id="staff-invitation-history" className="font-ui text-2xl font-medium text-bxo-text-primary">Review and delivery</h2>
      {directory.invitations.length ? <ul className="mt-5 space-y-4">{directory.invitations.map(invite=><li key={invite.id} className="rounded-xl border border-bxo-border-default p-5">
        <p className="break-all text-base font-semibold text-bxo-text-primary">{invite.email}</p><p className="mt-1 text-sm text-bxo-text-secondary">{invite.role} · {invite.state} · revision {invite.revision}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {invite.state==='PENDING_REVIEW' && invite.requesterPersonId!==directory.actorPersonId ? <><Button type="button" disabled={busy} onClick={()=>void command('approve',invite)}>Approve</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>void command('reject',invite)}>Reject</Button></> : null}
          {invite.state==='APPROVED' && [invite.requesterPersonId,invite.reviewerPersonId].includes(directory.actorPersonId) ? <Button type="button" disabled={busy} onClick={()=>void command('apply',invite)}>Apply approved invitation</Button> : null}
          {invite.state==='QUEUED' ? <Button type="button" disabled={busy} onClick={()=>void command('dispatch',invite)}>Send via Supabase Auth</Button> : null}
          {invite.state==='DISPATCHING' ? <Button type="button" variant="outline" disabled={busy} onClick={()=>void command('reconcile',invite)}>Reconcile unknown send</Button> : null}
          {invite.state==='EXPIRED' ? <Button type="button" variant="outline" disabled={busy} onClick={()=>void command('cancel',invite)}>Close expired invitation</Button> : null}
          {['PENDING_REVIEW','APPROVED','QUEUED','DISPATCHING','INVITED','MFA_PENDING'].includes(invite.state)
            && [invite.requesterPersonId,invite.reviewerPersonId].includes(directory.actorPersonId) ? <Button type="button" variant="outline" disabled={busy} onClick={()=>void command('cancel',invite)}>Revoke invitation</Button> : null}
        </div>
      </li>)}</ul> : <p className="mt-4 text-sm text-bxo-text-secondary">No reviewed invitations in this organisation.</p>}
    </section>
    {message ? <p role="status" className="border-l-2 border-bxo-accent-primary pl-4 text-sm leading-6 text-bxo-text-secondary">{message}</p> : null}
  </div>
}
