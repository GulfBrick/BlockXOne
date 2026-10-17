'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import { ADMIN_ENTITY_KINDS, ADMIN_KINDS, parseAdminPayload, type AdminError, type AdminKind, type AdminReadProjection, type AdminSelectedProposalView, type AdminState, type AdminTransition, type ValidatedAdminPayload } from '@/lib/administration/contracts'
import { administrationBinding, createAdministrationController, postAdministration } from './administration-controller'

const control = 'mt-2 min-h-11 w-full min-w-0 rounded-md border border-bxo-border-subtle bg-bxo-bg px-3 py-2 text-base text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'
const link = 'inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary'
const primary = 'min-h-11 bg-bxo-accent-primary text-bxo-bg hover:bg-bxo-accent-primary/90 focus-visible:ring-bxo-accent-primary'
const section = 'min-w-0 rounded-xl border border-bxo-border-subtle bg-bxo-surface p-4 sm:p-6'
const truncated = 'Showing up to 50 records. This is not the complete history.'
export const ADMIN_STATE_LABELS: Record<AdminState, string> = {
  PENDING_REVIEW: 'Pending review', APPROVED: 'Approved: not applied', APPLIED: 'Applied', REJECTED: 'Rejected', CANCELLED: 'Cancelled', EXPIRED: 'Expired', INVALIDATED: 'No longer valid',
}
const names: Record<AdminKind, string> = {
  ENTITY_DRAFT_CREATE: 'Record a draft legal party', MEMBERSHIP_GRANT: 'Grant an organisation role', MEMBERSHIP_REVOKE: 'Restrict an organisation role', GOVERNANCE_GRANT: 'Grant scoped administration', GOVERNANCE_REVOKE: 'Revoke scoped administration', PERSON_SCOPE_REVOKE: 'Restrict a person in this organisation',
}
const errors: Record<AdminError, string> = {
  invalid_request: 'Check the change details and review them again.', unauthorised: 'Your session is no longer active. Sign in again before returning.',
  forbidden: 'Your authority for this action is no longer active. Reload administration to view your current access.',
  unconfigured: 'Administration restricted. Trusted person mapping and scoped administrative authority have not been admitted for this account. You can continue using your existing workspace.',
  mfa_required: 'Administrative changes require a verified authenticator and a recent code. Review account security, then return and review the change again.',
  step_up_required: 'Administrative changes require a verified authenticator and a recent code. Review account security, then return and review the change again.',
  conflict: 'This proposal no longer matches the current record or policy. Reload and review the latest information.', expired: 'This proposal has expired. Review current records before creating a new proposal.',
  governance_hold: 'Administration is on HOLD. You can view permitted records and audit evidence, but cannot submit, review, apply or cancel changes. Grants and recovery are unavailable here.',
  rate_limited: 'Too many requests. Wait before checking the recorded status.', unavailable: 'Administration is temporarily unavailable. Reload before trying again.',
}
export const ORIGINAL_KEY_LOST = 'The original request can no longer be retried from this screen. Its outcome is still unconfirmed. Check permitted proposal history and audit records before creating another request.'
const holdCopy = errors.governance_hold
type ReadyView = Extract<AdminReadProjection, { availability: 'ready' | 'hold' }>
type Props = { view: AdminReadProjection; organisations: { id: string; name: string }[]; selectedOrganisationId?: string; selectedProposalId?: string }

function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return <div className="min-w-0"><label htmlFor={name} className="text-sm font-semibold text-bxo-text-primary">{label}</label>{children}</div>
}
function Facts({ values }: { values: [string, ReactNode][] }) {
  return <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm font-semibold text-bxo-text-secondary">{label}</dt><dd className="mt-1 break-words text-base text-bxo-text-primary [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
}
function personLabel(view: ReadyView, id: string | null): string {
  if (!id) return 'Not recorded'
  return view.people.find(person => person.id === id)?.label || `Person reference ${id}`
}
export function proposalFacts(payload: ValidatedAdminPayload, view: ReadyView): [string, ReactNode][] {
  switch (payload.kind) {
    case 'ENTITY_DRAFT_CREATE': return [['Display name', payload.payload.displayName], ['Legal-party kind', payload.payload.kind], ['Jurisdiction', payload.payload.jurisdictionCode || 'Not recorded'], ['Registration reference', payload.payload.registrationReference || 'Not recorded'], ['Proposed result', 'DRAFT record with a RECORDED_ONLY workspace relationship. No issuer approval.']]
    case 'MEMBERSHIP_GRANT': return [['Principal reference', payload.payload.principalId], ['Organisation role', payload.payload.role], ['Proposed result', 'An active organisation role. This does not grant administration or financial authority.']]
    case 'MEMBERSHIP_REVOKE': return [['Membership reference', payload.payload.membershipId], ['Reason', payload.payload.reason], ['Proposed result', 'This organisation membership becomes suspended. Other memberships and external signing authority are unchanged.']]
    case 'GOVERNANCE_GRANT': return [['Person', personLabel(view, payload.payload.personId)], ['Valid until (UTC)', payload.payload.validUntil], ['Proposed result', 'Time-bounded ADMINISTRATION_V1 authority in this organisation only.']]
    case 'GOVERNANCE_REVOKE': return [['Grant reference', payload.payload.grantId], ['Reason', payload.payload.reason], ['Proposed result', 'Scoped administration authority becomes revoked. Ordinary memberships and wallet history remain.']]
    case 'PERSON_SCOPE_REVOKE': return [['Person', personLabel(view, payload.payload.personId)], ['Reason', payload.payload.reason], ['Proposed result', 'Suspend mapped memberships and revoke governance in this organisation. Auth accounts and external signing authority are unchanged.']]
  }
}
export function permittedTransitions(proposal: AdminSelectedProposalView, view: ReadyView): AdminTransition[] {
  if (view.availability !== 'ready') return []
  const person = view.caller.personId
  return proposal.allowedTransitions.filter(transition => {
    if (transition === 'approve' || transition === 'reject') return proposal.state === 'PENDING_REVIEW' && person !== proposal.requesterPersonId && person !== proposal.beneficiaryPersonId
    if (transition === 'apply') return proposal.state === 'APPROVED' && person !== proposal.beneficiaryPersonId && (person === proposal.requesterPersonId || person === proposal.reviewerPersonId)
    return (proposal.state === 'PENDING_REVIEW' || proposal.state === 'APPROVED') && person === proposal.requesterPersonId
  })
}
export function buildProposalFromForm(form: FormData, view: ReadyView): ValidatedAdminPayload | null {
  const kind = form.get('changeKind')
  const value = (name: string) => typeof form.get(name) === 'string' ? String(form.get(name)).trim() : ''
  let payload: unknown
  switch (kind) {
    case 'ENTITY_DRAFT_CREATE': payload = { displayName: value('displayName'), kind: value('entityKind'), jurisdictionCode: value('jurisdictionCode') || null, registrationReference: value('registrationReference') || null }; break
    case 'MEMBERSHIP_GRANT': {
      const principalId = value('principalId')
      if (!view.people.some(person => person.id !== view.caller.personId && person.principals.some(principal => principal.id === principalId))) return null
      payload = { principalId, role: value('role') }; break
    }
    case 'MEMBERSHIP_REVOKE': {
      const membershipId = value('membershipId')
      if (!view.people.some(person => person.principals.some(principal => principal.memberships.some(member => member.id === membershipId && member.status === 'ACTIVE')))) return null
      payload = { membershipId, reason: value('reason') }; break
    }
    case 'GOVERNANCE_GRANT': case 'PERSON_SCOPE_REVOKE': {
      const personId = value('personId')
      if (!view.people.some(person => person.id === personId && (kind !== 'GOVERNANCE_GRANT' || person.id !== view.caller.personId))) return null
      payload = kind === 'GOVERNANCE_GRANT' ? { personId, validUntil: value('validUntil') } : { personId, reason: value('reason') }; break
    }
    case 'GOVERNANCE_REVOKE': {
      const grantId = value('grantId')
      if (!view.governanceGrants.some(grant => grant.id === grantId && grant.status === 'ACTIVE')) return null
      payload = { grantId, reason: value('reason') }; break
    }
    default: return null
  }
  return parseAdminPayload(kind, payload)
}

export function registerAdministrationPageLifecycle(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, clear: () => void, restore: () => void) {
  // Commit removal of scoped data and unsaved inputs before BFcache can freeze
  // the page, and repeat that removal before a restored page revalidates.
  const hide = () => flushSync(clear)
  const show = (event: Event) => { if ((event as PageTransitionEvent).persisted) { hide(); restore() } }
  target.addEventListener('pagehide', hide)
  target.addEventListener('pageshow', show)
  return () => { target.removeEventListener('pagehide', hide); target.removeEventListener('pageshow', show) }
}

export function AdministrationPanel({ view, organisations, selectedOrganisationId, selectedProposalId }: Props) {
  const router = useRouter()
  const [command, setCommand] = useState({ phase: 'idle' as ReturnType<ReturnType<typeof createAdministrationController>['getState']>['phase'], result: null as ReturnType<ReturnType<typeof createAdministrationController>['getState']>['result'], retryReady: false, refreshing: false })
  const controller = useRef<ReturnType<typeof createAdministrationController> | null>(null)
  if (!controller.current) controller.current = createAdministrationController(view, { post: postAdministration, refresh: () => router.refresh(), onChange: setCommand })
  const [composer, setComposer] = useState(false)
  const [kind, setKind] = useState<AdminKind>('ENTITY_DRAFT_CREATE')
  const [draft, setDraft] = useState<ValidatedAdminPayload | null>(null)
  const [formError, setFormError] = useState(false)
  const [confirmation, setConfirmation] = useState<AdminTransition | null>(null)
  const [privateHidden, setPrivateHidden] = useState(false)
  const previousBinding = useRef(administrationBinding(view))
  const heading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const dirty = useRef(false)
  const clearInput = () => { setComposer(false); setDraft(null); setConfirmation(null); setFormError(false); formRef.current?.reset(); dirty.current = false }
  useEffect(() => {
    const next = administrationBinding(view)
    if (previousBinding.current !== next) clearInput()
    previousBinding.current = next
    controller.current!.update(view)
    setPrivateHidden(false)
  }, [view])
  useEffect(() => {
    const clear = () => { controller.current!.invalidate(); clearInput(); setPrivateHidden(true) }
    const pagehide = () => flushSync(clear)
    const signout = (event: Event) => { if (event.target instanceof HTMLFormElement && event.target.getAttribute('action') === '/auth/logout') pagehide() }
    const leaving = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      const href = anchor?.getAttribute('href')
      if (!href || href.startsWith('#')) return
      const phase = controller.current!.getState().phase
      if (!dirty.current && phase !== 'pending' && phase !== 'unknown') return
      if (!window.confirm(`Leave this screen? Unsaved input and the original request key will be lost. ${ORIGINAL_KEY_LOST}`)) { event.preventDefault(); event.stopPropagation() }
      else pagehide()
    }
    const beforeunload = (event: BeforeUnloadEvent) => { if (dirty.current || controller.current!.getState().phase === 'unknown' || controller.current!.getState().phase === 'pending') { event.preventDefault(); event.returnValue = '' } }
    const removeLifecycle = registerAdministrationPageLifecycle(window, clear, () => router.refresh())
    window.addEventListener('beforeunload', beforeunload)
    document.addEventListener('submit', signout, true)
    document.addEventListener('click', leaving, true)
    return () => { removeLifecycle(); window.removeEventListener('beforeunload', beforeunload); document.removeEventListener('submit', signout, true); document.removeEventListener('click', leaving, true); controller.current!.invalidate() }
  }, [router])
  useEffect(() => { if (command.phase !== 'idle') resultHeading.current?.focus() }, [command.phase])
  useEffect(() => { if (composer || formError || draft || confirmation) heading.current?.focus() }, [composer, formError, draft, confirmation])
  const bound = controller.current.matches(view)
  if (privateHidden || ((view.availability === 'ready' || view.availability === 'hold') && !bound)) return <p role="status" className="mt-8 text-base text-bxo-text-secondary">Revalidating administration access. No changes will be submitted automatically.</p>
  if (view.availability !== 'ready' && view.availability !== 'hold') {
    const copy = view.availability === 'mfa_required' ? 'Administration requires a currently verified authenticator sign-in. Review account security before returning.' : errors[view.availability]
    return <section className={`${section} mt-8`} aria-labelledby="administration-gate"><h2 id="administration-gate" className="text-xl font-semibold">{view.availability === 'unconfigured' || view.availability === 'forbidden' ? 'Administration restricted' : 'Administration access'}</h2><p role="status" className="mt-4 text-base text-bxo-text-secondary">{copy}</p>{view.availability === 'mfa_required' || view.availability === 'step_up_required' ? <Link href="/workspace/security" className={`${link} mt-4`}>Review account security</Link> : <Link href="/workspace" className={`${link} mt-4`}>Back to workspace</Link>}</section>
  }
  const organisation = organisations.find(item => item.id === view.scope.organisationId)
  const busy = command.phase === 'pending' || command.phase === 'unknown' || command.refreshing
  const canCompose = view.availability === 'ready' && !busy
  const selected = view.selectedProposal
  const transitions = selected ? permittedTransitions(selected, view) : []
  const href = (id?: string) => `/workspace/administration?organisation=${encodeURIComponent(view.scope.organisationId)}${id ? `&proposal=${encodeURIComponent(id)}` : ''}`
  const reviewDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = buildProposalFromForm(new FormData(event.currentTarget), view)
    setFormError(!parsed)
    if (parsed) setDraft(parsed)
  }
  const submitDraft = async () => {
    if (!draft || !canCompose) return
    await controller.current!.submit({ intent: 'propose', organisationId: view.scope.organisationId, requestKey: crypto.randomUUID(), kind: draft.kind, payload: JSON.stringify(draft.payload), expectedScopeRevision: view.scopeRevision })
    if (controller.current!.getState().phase === 'confirmed') clearInput()
  }
  const submitTransition = async () => {
    if (!selected || !confirmation || !transitions.includes(confirmation) || busy) return
    const shared = { organisationId: view.scope.organisationId, requestKey: crypto.randomUUID(), proposalId: selected.id, expectedRevision: selected.revision }
    await controller.current!.submit(confirmation === 'approve' || confirmation === 'reject' ? { ...shared, intent: 'review', decision: confirmation } : { ...shared, intent: confirmation })
    setConfirmation(null)
  }
  const restriction = selected && ['MEMBERSHIP_REVOKE', 'GOVERNANCE_REVOKE', 'PERSON_SCOPE_REVOKE'].includes(selected.kind)
  const result = command.result
  return <div className="mt-8 space-y-8">
    <section className={section} aria-labelledby="admin-scope">
      <h2 id="admin-scope" className="text-xl font-semibold">Organisation</h2>
      <p className="mt-4 break-words text-base">{organisation?.name || 'Selected organisation'}</p>
      <p className="mt-2 text-sm text-bxo-text-secondary">Policy ADMINISTRATION_V1 · Scope revision {view.scopeRevision} · Trust revision {view.scope.trustRevision}</p>
      {organisations.length > 1 ? <form method="get" action="/workspace/administration" className="mt-4 flex flex-wrap items-end gap-4" onSubmit={event => { if (busy || dirty.current) event.preventDefault() }}><Field name="organisation" label="View an authorised organisation"><select id="organisation" name="organisation" defaultValue={selectedOrganisationId || view.scope.organisationId} className={control} disabled={busy || dirty.current}>{organisations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Button type="submit" variant="outline" className="min-h-11" disabled={busy || dirty.current}>View organisation</Button></form> : null}
      {view.availability === 'hold' ? <p role="status" className="mt-4 border-l-2 border-bxo-accent-primary pl-4 text-base">{holdCopy}</p> : <p className="mt-4 text-base text-bxo-text-secondary">Changes require a recent authenticator code and independent review. Role labels do not establish this authority.</p>}
      <p className="mt-4 text-sm text-bxo-text-secondary">If you reloaded or returned after an interrupted command: {ORIGINAL_KEY_LOST}</p>
    </section>
    <section aria-label="Command result" className={command.phase === 'idle' ? 'sr-only' : section}>
      <h2 ref={resultHeading} tabIndex={-1} className="text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Recorded command outcome</h2>
      <div aria-live="polite" className="mt-4 text-base text-bxo-text-secondary">
        {command.phase === 'pending' ? <p>Submitting the reviewed command...</p> : null}
        {command.phase === 'unknown' ? <><p role="alert">The outcome could not be confirmed. Check the recorded status before trying again.</p><p className="mt-2">A refresh or an empty list does not prove that nothing happened. The original intent and request key remain in this screen only.</p><div className="mt-4 flex flex-wrap gap-4"><Button type="button" variant="outline" className="min-h-11" disabled={command.refreshing} onClick={() => controller.current!.checkRecordedStatus()}>Check recorded status</Button>{command.retryReady ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void controller.current!.retryOriginal()}>Retry original request</Button> : null}</div>{command.retryReady ? <p className="mt-2">Current permitted records have been refreshed. The original outcome is still unconfirmed; an explicit retry uses the same immutable request and lets the server resolve it.</p> : null}</> : null}
        {result?.ok ? <><p>{result.state === 'APPLIED' && result.scopeState === 'HOLD' ? 'Security restriction applied. Administration is on HOLD because fewer than two eligible independent governors remain. The restriction and audit record were saved together.' : result.state === 'APPLIED' ? 'Change applied. The audit record is available below.' : result.state === 'APPROVED' ? 'Proposal approved. The change has not been applied.' : result.state === 'PENDING_REVIEW' ? 'Proposal submitted for independent review. No access change has been applied.' : `Recorded status: ${ADMIN_STATE_LABELS[result.state]}.`}</p><p className="mt-2 break-all text-sm">Proposal reference: {result.proposalId}. Revision {result.revision}. {result.replayed ? 'The original receipt was returned; this is not a second effect.' : ''}</p><Link href={href(result.proposalId)} className={`${link} mt-2`}>View recorded proposal and audit</Link></> : result ? <p role="alert">{errors[result.error]}</p> : null}
        {command.refreshing ? <p className="mt-2">Refreshing permitted records...</p> : null}
      </div>
    </section>
    {selected ? <section className={section} aria-labelledby="proposal-detail"><Link href={href()} className={link} onClick={event => { if (busy) event.preventDefault() }}>Back to proposals</Link><h2 id="proposal-detail" tabIndex={-1} className="mt-4 text-xl font-semibold">{names[selected.kind]}</h2><p className="mt-4 inline-block rounded-md border border-bxo-border-subtle px-3 py-2 text-sm">{ADMIN_STATE_LABELS[selected.state]}</p><Facts values={proposalFacts(selected, view)} /><Facts values={[
      ['Proposal reference', selected.id], ['Requester', personLabel(view, selected.requesterPersonId)], ['Beneficiary', personLabel(view, selected.beneficiaryPersonId)], ['Independent reviewer', personLabel(view, selected.reviewerPersonId)], ['Expires at (UTC)', selected.expiresAt], ['Immutable payload SHA-256', selected.payloadHash], ['Expected scope / trust revisions', `${selected.expectedScopeRevision} / ${selected.expectedTrustRevision}`], ['Policy / proposal revision', `${selected.policyVersion} / ${selected.revision}`],
    ]} /><p className="mt-4 text-base text-bxo-text-secondary">The submitted intent is immutable. Approval is not application. Changes to these details require a separate, deliberately reviewed proposal after any uncertain outcome is resolved.</p>
      {selected.requesterPersonId === view.caller.personId || selected.beneficiaryPersonId === view.caller.personId ? <p className="mt-4 text-sm text-bxo-text-secondary">You cannot review this proposal because you are the requester or beneficiary. A different authorised person must review it.</p> : null}
      {selected.beneficiaryPersonId === view.caller.personId ? <p className="mt-2 text-sm text-bxo-text-secondary">You cannot request your own elevation or apply a proposal where you are the beneficiary. A different authorised person must perform this action.</p> : null}
      {transitions.length && !confirmation ? <div className="mt-6 flex flex-wrap gap-4">{transitions.map((transition, index) => <Button key={transition} type="button" variant={index === 0 ? 'default' : 'outline'} className={index === 0 ? primary : 'min-h-11'} disabled={busy} onClick={() => { clearInput(); setConfirmation(transition) }}>{transition === 'approve' ? 'Approve proposal' : transition === 'reject' ? 'Reject proposal' : transition === 'apply' ? 'Apply approved change' : 'Cancel proposal'}</Button>)}</div> : null}
      {confirmation ? <div className="mt-6 border-t border-bxo-border-subtle pt-6"><h3 ref={heading} tabIndex={-1} className="text-xl font-semibold">Confirm {confirmation}</h3><p className="mt-4 text-base text-bxo-text-secondary">{confirmation === 'cancel' ? 'Cancel this proposal? It will no longer be available for review or application. Its history will remain.' : confirmation === 'apply' && restriction ? `Apply this access restriction to ${personLabel(view, selected.beneficiaryPersonId)} in ${organisation?.name || 'this organisation'}? It affects future application access within the displayed scope. It does not revoke external provider or on-chain signing authority. The audit history will remain.` : confirmation === 'approve' ? 'Approve this immutable proposal for separate application? No access changes are applied by this approval.' : confirmation === 'apply' ? 'Apply the independently approved change exactly as displayed?' : 'Reject this proposal? The decision and history will remain.'}</p>{restriction && selected.payload && 'reason' in selected.payload && selected.payload.reason === 'security' ? <p className="mt-4 text-sm text-bxo-text-secondary">The server will enforce independent-governor coverage. A security restriction can place administration on HOLD; this screen does not estimate that result from visible counts.</p> : null}<div className="mt-4 flex flex-wrap gap-4"><Button type="button" className={confirmation === 'apply' && restriction ? 'min-h-11 bg-bxo-danger text-bxo-bg hover:bg-bxo-danger/90' : primary} disabled={busy} onClick={() => void submitTransition()}>{confirmation === 'apply' && restriction ? 'Apply access restriction' : confirmation === 'approve' ? 'Approve proposal' : confirmation === 'reject' ? 'Reject proposal' : confirmation === 'apply' ? 'Apply approved change' : 'Cancel proposal'}</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmation(null)}>Keep reviewing</Button></div></div> : null}
      <h3 className="mt-8 text-xl font-semibold">Audit history</h3>{selected.historyTruncated ? <p className="mt-4 text-sm text-bxo-text-secondary">Showing up to 100 audit events. This is not the complete history.</p> : null}<ol className="mt-4 space-y-4">{selected.events.map(event => <li key={event.id} className="min-w-0 rounded-md border border-bxo-border-subtle p-4"><p className="text-sm font-semibold">{event.type} · {event.createdAt} (UTC)</p><Facts values={[["Actor", personLabel(view, event.actorPersonId)], ['Before', event.beforeState ? `${ADMIN_STATE_LABELS[event.beforeState]} / revision ${event.beforeRevision}` : 'No prior proposal state'], ['After', `${ADMIN_STATE_LABELS[event.afterState]} / revision ${event.afterRevision}`], ['Audit reference', event.id], ['Reason', event.reason || 'Not recorded']]} /></li>)}</ol>{selected.events.length === 0 ? <p className="mt-4 text-base text-bxo-text-secondary">No audit events in this permitted view. This is not proof of no effect.</p> : null}
    </section> : selectedProposalId ? <p role="status" className="text-base text-bxo-text-secondary">The selected proposal is not available in this permitted view. This is not proof of no effect.</p> : null}
    <section className={section} aria-labelledby="admin-proposals"><h2 id="admin-proposals" className="text-xl font-semibold">Access proposals</h2>{view.truncated.proposals ? <p className="mt-4 text-sm text-bxo-text-secondary">{truncated}</p> : null}{view.proposals.length ? <ul className="mt-4 space-y-4">{view.proposals.map(proposal => <li key={proposal.id} className="min-w-0 border-b border-bxo-border-subtle pb-4"><Link href={href(proposal.id)} className={`${link} break-words`} onClick={event => { if (busy || dirty.current) event.preventDefault() }}>{names[proposal.kind]}</Link><p className="text-sm text-bxo-text-secondary">{ADMIN_STATE_LABELS[proposal.state]} · Revision {proposal.revision}</p><p className="mt-1 break-all text-sm text-bxo-text-secondary">{proposal.id}</p></li>)}</ul> : <p className="mt-4 text-base text-bxo-text-secondary">No access proposals. If your authority permits, propose a change for independent review.</p>}
      {!composer && !selected && canCompose ? <Button type="button" className={`${primary} mt-6`} onClick={() => { clearInput(); setComposer(true) }}>Propose access change</Button> : null}
      {composer && view.availability === 'ready' ? <div className="mt-6 max-w-2xl border-t border-bxo-border-subtle pt-6">
        <h3 ref={heading} tabIndex={-1} className="text-xl font-semibold">{draft ? 'Review the unsaved change' : 'Unsaved change'}</h3>
        {formError ? <p id="admin-form-error" role="alert" className="mt-4 text-base text-bxo-text-secondary"><a href="#changeKind" className={link}>Check the change fields and permitted recipient, then review again.</a></p> : null}
        {draft ? <><Facts values={proposalFacts(draft, view)} /><p className="mt-4 text-base text-bxo-text-secondary">This change has not been stored. Submit it for independent review; submission does not apply access changes.</p><div className="mt-4 flex flex-wrap gap-4"><Button type="button" className={primary} disabled={busy} onClick={() => void submitDraft()}>Submit proposal</Button><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setDraft(null)}>Edit unsaved change</Button></div></> : <form ref={formRef} onSubmit={reviewDraft} onChange={() => { dirty.current = true }} className="mt-4 space-y-4" aria-describedby={formError ? 'admin-form-error' : undefined}>
        <fieldset disabled={busy} className="min-w-0 space-y-4" aria-invalid={formError || undefined} aria-describedby={formError ? 'admin-form-error' : undefined}>
        <legend className="sr-only">Proposed change fields</legend>
        <Field name="changeKind" label="Change type"><select id="changeKind" name="changeKind" className={control} value={kind} disabled={busy} onChange={event => setKind(event.target.value as AdminKind)}>{ADMIN_KINDS.map(item => <option key={item} value={item}>{names[item]}</option>)}</select></Field>
        {kind === 'ENTITY_DRAFT_CREATE' ? <><Field name="displayName" label="Display name"><input id="displayName" name="displayName" required maxLength={200} className={control} /></Field><Field name="entityKind" label="Legal-party kind"><select id="entityKind" name="entityKind" required defaultValue="" className={control}><option value="" disabled>Select a kind</option>{ADMIN_ENTITY_KINDS.map(item => <option key={item}>{item}</option>)}</select></Field><Field name="jurisdictionCode" label="Jurisdiction code (optional, two uppercase letters)"><input id="jurisdictionCode" name="jurisdictionCode" pattern="[A-Z]{2}" maxLength={2} className={control} /></Field><Field name="registrationReference" label="Registration reference (optional)"><input id="registrationReference" name="registrationReference" maxLength={100} className={control} /></Field><p className="text-base text-bxo-text-secondary">Draft: unverified. Recorded facts only. Legal identity, issuer status and representative authority have not been approved.</p></> : null}
        {kind === 'MEMBERSHIP_GRANT' ? <><Field name="principalId" label="Permitted principal"><select id="principalId" name="principalId" required defaultValue="" className={control}><option value="" disabled>Select a principal</option>{view.people.filter(person => person.id !== view.caller.personId).flatMap(person => person.principals.map(principal => <option key={principal.id} value={principal.id}>{person.label} · {principal.id}</option>))}</select></Field><Field name="role" label="Organisation role"><select id="role" name="role" required defaultValue="" className={control}><option value="" disabled>Select a role</option>{BX1_ROLES.map(role => <option key={role}>{role}</option>)}</select></Field></> : null}
        {kind === 'MEMBERSHIP_REVOKE' ? <Field name="membershipId" label="Permitted active membership"><select id="membershipId" name="membershipId" required defaultValue="" className={control}><option value="" disabled>Select a membership</option>{view.people.flatMap(person => person.principals.flatMap(principal => principal.memberships.filter(member => member.status === 'ACTIVE').map(member => <option key={member.id} value={member.id}>{person.label} · {member.role} · {member.id}</option>)))}</select></Field> : null}
        {kind === 'GOVERNANCE_GRANT' || kind === 'PERSON_SCOPE_REVOKE' ? <Field name="personId" label="Permitted person"><select id="personId" name="personId" required defaultValue="" className={control}><option value="" disabled>Select a person</option>{view.people.filter(person => kind !== 'GOVERNANCE_GRANT' || person.id !== view.caller.personId).map(person => <option key={person.id} value={person.id}>{person.label}</option>)}</select></Field> : null}
        {kind === 'GOVERNANCE_GRANT' ? <Field name="validUntil" label="Valid until (UTC, YYYY-MM-DDTHH:mm:ssZ; within 90 days)"><input id="validUntil" name="validUntil" required maxLength={27} placeholder="YYYY-MM-DDTHH:mm:ssZ" className={control} /></Field> : null}
        {kind === 'GOVERNANCE_REVOKE' ? <Field name="grantId" label="Permitted active governance grant"><select id="grantId" name="grantId" required defaultValue="" className={control}><option value="" disabled>Select a grant</option>{view.governanceGrants.filter(grant => grant.status === 'ACTIVE').map(grant => <option key={grant.id} value={grant.id}>{personLabel(view, grant.personId)} · {grant.id}</option>)}</select></Field> : null}
        {['MEMBERSHIP_REVOKE', 'GOVERNANCE_REVOKE', 'PERSON_SCOPE_REVOKE'].includes(kind) ? <Field name="reason" label="Restriction reason"><select id="reason" name="reason" required defaultValue="" className={control}><option value="" disabled>Select a reason</option><option value="routine">Routine</option><option value="security">Security</option></select></Field> : null}
        {view.truncated.people || view.grantsTruncated || view.people.some(person => person.principalsTruncated) ? <p className="text-sm text-bxo-text-secondary">Recipient choices are limited to this permitted, bounded view. Missing choices do not establish missing access.</p> : null}
        <Button type="submit" className={primary} disabled={busy}>Review change</Button>
        </fieldset>
      </form>}<Button type="button" variant="outline" className="mt-4 min-h-11" disabled={busy} onClick={clearInput}>Discard unsaved change</Button></div> : null}
    </section>
    <section className={section} aria-labelledby="admin-people"><h2 id="admin-people" className="text-xl font-semibold">People</h2>{view.truncated.people ? <p className="mt-4 text-sm text-bxo-text-secondary">{truncated}</p> : null}{view.people.length ? <ul className="mt-4 grid gap-4 md:grid-cols-2">{view.people.map(person => <li key={person.id} className="min-w-0 rounded-md border border-bxo-border-subtle p-4"><h3 className="break-words text-base font-semibold">{person.label}</h3><p className="mt-2 break-all text-sm text-bxo-text-secondary">{person.id}</p>{person.principalsTruncated ? <p className="mt-2 text-sm text-bxo-text-secondary">Showing up to 10 principals. This is not the complete principal history.</p> : null}<ul className="mt-4 space-y-4">{person.principals.map(principal => <li key={principal.id} className="min-w-0"><p className="break-all text-sm">Principal {principal.id}</p><ul className="mt-2 space-y-2">{principal.memberships.map(member => <li key={member.id} className="break-words text-sm text-bxo-text-secondary">{member.role}: {member.status}</li>)}</ul></li>)}</ul></li>)}</ul> : <p className="mt-4 text-base text-bxo-text-secondary">No people in this view. No person records are available within your permitted organisation scope.</p>}</section>
    <section className={section} aria-labelledby="admin-parties"><h2 id="admin-parties" className="text-xl font-semibold">Legal parties</h2><p className="mt-4 text-base text-bxo-text-secondary">Draft: unverified. Recorded facts only. Legal identity, issuer status and representative authority have not been approved.</p>{view.truncated.entities ? <p className="mt-4 text-sm text-bxo-text-secondary">{truncated}</p> : null}{view.entities.length ? <ul className="mt-4 grid gap-4 md:grid-cols-2">{view.entities.map(entity => <li key={entity.id} className="min-w-0 rounded-md border border-bxo-border-subtle p-4"><h3 className="break-words text-base font-semibold">{entity.displayName}</h3><Facts values={[["Kind", entity.kind], ['Jurisdiction', entity.jurisdictionCode || 'Not recorded'], ['Registration reference', entity.registrationReference || 'Not recorded'], ['Status / relationship', 'DRAFT / RECORDED_ONLY'], ['Revision', entity.revision], ['Party reference', entity.id]]} /></li>)}</ul> : <p className="mt-4 text-base text-bxo-text-secondary">No legal parties recorded. Recording an entity does not approve it as an issuer.</p>}</section>
  </div>
}
