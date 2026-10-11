'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { applicationDetailsSchema, investingProposalDocumentLookupSchema, isFundTermsV2, isRealEstateTermsV2, isOfferingSubscribable, isWealthManagerDetailsV2, subscriptionQuote, validatedEntityProductEligibility, type LegacyApplicationDetails, type PortalApplication, type PortalEntityInvestmentAccount, type PortalEntityProductEligibility, type PortalInvestmentAccount, type PortalInvestingRepresentativeMandate, type PortalProduct, type PortalProductEligibility, type PortalSnapshot } from '@/lib/portal/contracts'
import { portalContextKey, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { hasStage2CommandAccess, validatedStage2Access } from '@/lib/portal/stage2-access'
import { isTestPasswordWorkflow } from '@/lib/portal/offering-access'
import { CommandFeedback, usePortalCommand, usePortalCommandAllowed } from './portal-client'
import { ApplicationDetailsSummary, ApplicationDocumentHistory, PrivateDocument } from './onboarding-form'
import { ProviderEvidenceReview } from './kyc-verification'
import { DetailList, EmptyState, Field, Notice, Panel, StatusBadge, dateLabel, money } from './portal-primitives'
import styles from './portal.module.css'

export function currentInvestorApplication(snapshot: PortalSnapshot): (PortalApplication & { details: LegacyApplicationDetails }) | undefined {
  return snapshot.applications.find((item): item is PortalApplication & { details: LegacyApplicationDetails } => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details) && item.status === 'APPROVED' && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now())
}

function currentInvestorApplicationOfType(snapshot: PortalSnapshot, type: 'INDIVIDUAL' | 'ENTITY'): (PortalApplication & { details: LegacyApplicationDetails }) | undefined {
  return snapshot.applications.find((item): item is PortalApplication & { details: LegacyApplicationDetails } => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR'
    && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === type && item.status === 'APPROVED'
    && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now())
}

export function activeIndividualAccounts(snapshot: PortalSnapshot): PortalInvestmentAccount[] {
  const application = currentInvestorApplicationOfType(snapshot, 'INDIVIDUAL')
  if (application?.details.investor_type !== 'INDIVIDUAL') return []
  return (snapshot.accounts ?? []).filter(account => account.holder_user_id === snapshot.actor.id
    && account.application_id === application.id && account.kind === 'INDIVIDUAL' && account.status === 'ACTIVE')
}

export function currentProductEligibility(snapshot: PortalSnapshot, product: PortalProduct, account: PortalInvestmentAccount): PortalProductEligibility | undefined {
  if (!Array.isArray(snapshot.product_eligibility) || !isOfferingSubscribable(product)) return undefined
  const application = currentInvestorApplicationOfType(snapshot, 'INDIVIDUAL')
  if (!application || application.id !== account.application_id || account.holder_user_id !== snapshot.actor.id || account.kind !== 'INDIVIDUAL' || account.status !== 'ACTIVE') return undefined
  const matches = snapshot.product_eligibility.filter(item => item.product_id === product.id && item.investment_account_id === account.id)
  if (matches.length !== 1) return undefined
  const item = matches[0]
  return item.status === 'APPROVED' && item.effective === true && item.holder_user_id === snapshot.actor.id && item.organisation_id === product.organisation_id
    && item.application_revision === application.revision && item.offering_revision_id === product.offering_package?.id && item.product_revision === product.revision && item.terms_hash === product.terms_hash
    && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now() ? item : undefined
}

export function InvestmentAccountPanel({ snapshot, onSaved, operatingContext }: { snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const ownInvestorApplications = snapshot.applications.filter(item => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details))
  const hasIndividual = ownInvestorApplications.some(item => item.details.investor_type === 'INDIVIDUAL')
  const entityIds = new Set(ownInvestorApplications.filter(item => item.details.investor_type === 'ENTITY').map(item => item.id))
  const hasEntity = entityIds.size > 0 || (snapshot.entity_investment_accounts ?? []).some(account => account.can_view || entityIds.has(account.application_id))
  return <div className={styles.stack}>
    {hasIndividual || !hasEntity ? <IndividualInvestmentAccountPanel snapshot={snapshot} onSaved={onSaved} operatingContext={operatingContext} /> : null}
    {hasEntity ? <EntityInvestmentAccountPanel snapshot={snapshot} onSaved={onSaved} operatingContext={operatingContext} /> : null}
  </div>
}

function IndividualInvestmentAccountPanel({ snapshot, onSaved, operatingContext }: { snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const application = currentInvestorApplicationOfType(snapshot, 'INDIVIDUAL')
  const accounts = activeIndividualAccounts(snapshot)
  const ownAccounts = (snapshot.accounts ?? []).filter(account => account.holder_user_id === snapshot.actor.id)
  const command = usePortalCommand(onSaved)
  const mayOpen = !isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'create_investment_account', operatingContext)
  return <Panel title="Your investment account" description="The account identifies who holds the investment. Your sign-in identifies who submits the instruction.">
    <CommandFeedback command={command} />
    {accounts.length ? <DetailList rows={accounts.map((account, index) => ({ label: `Active individual account ${index + 1}`, value: <span className={styles.mono}>{account.id}</span> }))} />
      : !application ? <EmptyState title="Complete investor onboarding" description="A current independent approval is required before an individual investment account can be opened." href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my onboarding" />
        : application.details.investor_type !== 'INDIVIDUAL' ? <Notice title="Entity investment account is separate">An entity relationship cannot be used as a personal investment account.</Notice>
          : !Array.isArray(snapshot.accounts) ? <Notice title="Investment-account records are unavailable">Refresh saved state before opening an account. An unavailable response is not evidence that no account exists.</Notice>
            : ownAccounts.some(account => account.application_id === application.id && account.status === 'SUSPENDED') ? <Notice title="Investment account suspended">Contact your authorised reviewer. Opening another account does not replace the suspended account or restore investment authority.</Notice>
              : mayOpen ? <div className={styles.stack}><p className={styles.copy}>Your individual investor application is approved. Open an investment account to link future subscription instructions to that approved relationship.</p><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('create_investment_account', { application_id: application.id })}>Open individual investment account</button></div> : <Notice title="Account opening unavailable">No account-opening action was returned for this capacity. Refresh saved state or contact the BlockXOne onboarding owner with your application reference.</Notice>}
    <p className={`${styles.muted} ${styles.sectionGap}`}>An account is not a cash balance, token holding or wallet-signing mandate.</p>
  </Panel>
}

function entityMandateNextOwner(mandate: PortalInvestingRepresentativeMandate): string {
  return { APPLICANT: 'Entity applicant', REPRESENTATIVE: 'Named representative', COMPLIANCE: 'Independent BlockXOne Compliance Officer', SUPER_ADMIN: 'Authorised BlockXOne Super Admin', NONE: 'No pending mandate action' }[mandate.next_owner]
}

export function investingRepresentativeLabel(mandate: PortalInvestingRepresentativeMandate): string {
  return [mandate.representative_name, mandate.representative_email].filter(Boolean).join(' · ') || mandate.representative_user_id
}

export function representativeAppointmentIdentity(mandate: PortalInvestingRepresentativeMandate, context: PortalOperatingContext): string {
  return JSON.stringify([mandate.id, mandate.revision, mandate.proposal_hash, mandate.applicant_user_id, mandate.representative_user_id,
    mandate.representative_application_id, mandate.representative_application_revision, mandate.appointment_document_id, portalContextKey(context)])
}

/** Read only the exact proposal document; an entity application is not needed or exposed. */
export function RepresentativeAppointmentEvidence({ mandate, operatingContext, onVerified }: {
  mandate: PortalInvestingRepresentativeMandate; operatingContext: PortalOperatingContext; onVerified?: (identity: string | null) => void;
}) {
  const [receipt, setReceipt] = useState<{ document: LegacyApplicationDetails['documents'][number]; validationState: 'SYNTHETIC_UNSCANNED' | 'SCANNED_CLEAN'; url: string; identity: string }>()
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [reload, setReload] = useState(0)
  const href = portalScopeHref(`/api/portal/documents?mandate_id=${mandate.id}&id=${mandate.appointment_document_id}`, operatingContext)
  const downloadHref = portalScopeHref(`/api/portal/documents?mandate_id=${mandate.id}&id=${mandate.appointment_document_id}&download=1`, operatingContext)
  const identity = representativeAppointmentIdentity(mandate, operatingContext)
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    setReceipt(undefined); setState('loading'); onVerified?.(null)
    async function read() {
      try {
        const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) throw new Error()
        const raw = await response.text()
        if (raw.length > 16_384) throw new Error()
        const data: unknown = JSON.parse(raw)
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
        const value = data as Record<string, unknown>
        const { url, ...envelope } = value
        const lookup = investingProposalDocumentLookupSchema.safeParse(envelope)
        if (!lookup.success || lookup.data.mandate_id !== mandate.id || lookup.data.mandate_revision !== mandate.revision || lookup.data.proposal_hash !== mandate.proposal_hash
          || lookup.data.applicant_user_id !== mandate.applicant_user_id || lookup.data.document.id !== mandate.appointment_document_id
          || lookup.data.document.storage_path !== `${mandate.applicant_user_id}/${mandate.appointment_document_id}` || url !== downloadHref) throw new Error()
        if (current) {
          setReceipt({ document: lookup.data.document, validationState: lookup.data.validation_state, url: downloadHref, identity })
          setState('ready'); onVerified?.(identity)
        }
      } catch { if (current) { setState('unavailable'); onVerified?.(null) } }
      finally { clearTimeout(timeout) }
    }
    void read()
    return () => { current = false; clearTimeout(timeout); controller.abort() }
  }, [href, downloadHref, identity, mandate.id, mandate.revision, mandate.proposal_hash, mandate.applicant_user_id, mandate.appointment_document_id, onVerified, reload])
  return <section className={styles.stack} aria-label="Bound appointment document">
    {state === 'loading' || state === 'ready' && receipt?.identity !== identity ? <p className={styles.muted} role="status">Checking the exact appointment document…</p>
      : state === 'ready' && receipt?.identity === identity ? <><DetailList rows={[{ label: 'Appointment document', value: receipt.document.title }, { label: 'Document fingerprint', value: <span className={styles.mono}>{receipt.document.sha256}</span> }, { label: 'Document processing', value: receipt.validationState === 'SCANNED_CLEAN' ? 'Recorded clean scan' : 'Synthetic TEST evidence · not scanned' }]} /><a href={receipt.url} className={styles.textLink}>Download bound appointment document</a>{receipt.validationState === 'SYNTHETIC_UNSCANNED' ? <p className={styles.muted}>This synthetic evidence has no malware-scan acceptance. It is not a live appointment or provider approval.</p> : null}</>
        : <Notice title="Appointment document unavailable" tone="warning">The exact current proposal and document could not be verified. Acceptance is unavailable; you may decline a current proposal. <button type="button" className={styles.buttonSecondary} onClick={() => setReload(value => value + 1)}>Retry appointment document read</button></Notice>}
  </section>
}

function RepresentativeProposalCase({ mandate, snapshot, operatingContext, onSaved }: {
  mandate: PortalInvestingRepresentativeMandate; snapshot: PortalSnapshot; operatingContext: PortalOperatingContext; onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const command = usePortalCommand(onSaved)
  const [evidenceIdentity, setEvidenceIdentity] = useState<string | null>(null)
  const current = mandate.representative_user_id === snapshot.actor.id && mandate.applicant_user_id !== snapshot.actor.id
    && typeof mandate.proposal_hash === 'string' && /^[0-9a-f]{64}$/.test(mandate.proposal_hash)
    && Number.isInteger(mandate.revision) && mandate.revision > 0
    && typeof mandate.representative_application_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mandate.representative_application_id)
    && typeof mandate.representative_application_revision === 'number' && Number.isInteger(mandate.representative_application_revision) && mandate.representative_application_revision > 1
    && Boolean(mandate.admission_approved_until) && Date.parse(mandate.admission_approved_until!) > Date.now()
    && Date.parse(mandate.requested_until) > Date.now()
  const canRespond = current && mandate.status === 'PROPOSED' && mandate.can_respond === true
    && !mandate.consent_decision && !mandate.consent_receipt_id
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'respond_investing_representative_proposal', operatingContext))
  const canAccept = canRespond && evidenceIdentity === representativeAppointmentIdentity(mandate, operatingContext)
  function respond(decision: 'ACCEPT' | 'DECLINE') {
    if (!canRespond || decision === 'ACCEPT' && !canAccept || command.busy || command.unknown) return
    void command.submit('respond_investing_representative_proposal', { mandate_id: mandate.id, expected_revision: mandate.revision, proposal_hash: mandate.proposal_hash, decision })
  }
  return <section className={styles.stack} aria-label={`${mandate.entity_name} representative proposal`}>
    <DetailList rows={[{ label: 'Legal holder', value: mandate.entity_name }, { label: 'Proposal reference', value: <span className={styles.mono}>{mandate.id}</span> }, { label: 'Proposal revision', value: mandate.revision }, { label: 'Proposed by', value: <span className={styles.mono}>{mandate.applicant_user_id}</span> }, { label: 'Named representative', value: investingRepresentativeLabel(mandate) }, { label: 'Proposal state', value: <StatusBadge status={mandate.status} /> }, { label: 'Limited scope', value: 'Account view and guarded eligibility requests; zero transaction authority' }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Next responsible owner', value: entityMandateNextOwner(mandate) }, { label: 'Your response', value: mandate.consent_decision ?? 'Not yet recorded' }, ...(mandate.consent_receipt_id ? [{ label: 'Consent receipt', value: <span className={styles.mono}>{mandate.consent_receipt_id}</span> }] : [])]} />
    <p className={styles.copy}>{mandate.evidence_reference}</p>
    {current ? <RepresentativeAppointmentEvidence mandate={mandate} operatingContext={operatingContext} onVerified={setEvidenceIdentity} /> : null}
    <CommandFeedback command={command} />
    {canRespond ? <><p className={styles.copy}>Inspect the bound appointment before accepting. Acceptance sends this exact proposal to Compliance; it does not activate account access, a platform role, funding or signing authority. Decline closes this proposal even if its document read is unavailable.</p>{!canAccept ? <p className={styles.muted} role="status">Acceptance is disabled until the exact appointment document is verified.</p> : null}<div className={styles.actions}><button type="button" className={styles.button} disabled={!canAccept || command.busy || command.unknown} onClick={() => respond('ACCEPT')}>Accept representative proposal</button><button type="button" className={styles.buttonSecondary} disabled={command.busy || command.unknown} onClick={() => respond('DECLINE')}>Decline representative proposal</button></div></>
      : <Notice title={mandate.status === 'PROPOSED' ? 'Proposal response unavailable' : 'Representative response recorded'}>{mandate.status === 'PROPOSED' ? 'Current admissions, exact appointment evidence and returned consent authority are required. Refresh saved state if the proposal has changed.' : mandate.status === 'DECLINED' ? 'This proposal is closed. A revised appointment requires a new proposal and consent.' : mandate.effective ? 'A separately approved limited mandate is effective. Other representatives remain separate.' : `No account access is granted by your response. Next owner: ${entityMandateNextOwner(mandate)}.`}</Notice>}
  </section>
}

export function RepresentativeProposalInbox({ snapshot, onSaved, operatingContext }: {
  snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext;
}) {
  const context = operatingContext ?? snapshot.operating_context
  if (context?.mode !== 'APPLICANT' || !Array.isArray(snapshot.investing_representative_mandates)) return null
  const proposals = snapshot.investing_representative_mandates.filter(item => item.representative_user_id === snapshot.actor.id
    && item.applicant_user_id !== snapshot.actor.id && Boolean(item.proposal_hash))
  if (!proposals.length) return null
  return <Panel title="Your representative proposals" description="An entity applicant has named you. Your own sign-in records consent; no entity application or other representative’s case is exposed.">
    {new Set(proposals.map(item => item.id)).size !== proposals.length ? <Notice title="Representative proposals unavailable" tone="warning">The saved proposal references are inconsistent. Refresh before responding.</Notice>
      : <div className={styles.stack}>{proposals.map(mandate => <RepresentativeProposalCase key={`${mandate.id}:${mandate.revision}`} mandate={mandate} snapshot={snapshot} operatingContext={context} onSaved={onSaved} />)}</div>}
  </Panel>
}

function EntityInvestmentAccountPanel({ snapshot, onSaved, operatingContext }: { snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const ownEntityApplications = snapshot.applications.filter((item): item is PortalApplication & { details: LegacyApplicationDetails } => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR' && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'ENTITY')
  const currentApplications = ownEntityApplications.filter(item => item.status === 'APPROVED' && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now())
  const command = usePortalCommand(onSaved)
  const accountRows = snapshot.entity_investment_accounts
  const mandateRows = snapshot.investing_representative_mandates
  const ownApplicationIds = new Set(ownEntityApplications.map(item => item.id))
  const accounts = (accountRows ?? []).filter(account => account.can_view || ownApplicationIds.has(account.application_id))
  const canCreate = snapshot.entity_account_route_available === true && Array.isArray(accountRows)
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'create_entity_investment_account', operatingContext))
    ? currentApplications.filter(item => item.can_create_entity_account === true && !accounts.some(account => account.application_id === item.id)) : []
  return <div className={styles.stack}>
    <Panel title="Entity investment account" description="The legal entity holds the account. The signed-in person needs a separately reviewed mandate to act for it.">
      <CommandFeedback command={command} />
      {snapshot.entity_account_route_available !== true ? <Notice title="Entity-account route not admitted" tone="warning">This environment has not admitted the guarded entity-account route. No account action is available.</Notice>
        : !Array.isArray(accountRows) || !Array.isArray(mandateRows) ? <Notice title="Entity-account records unavailable" tone="warning">Refresh saved state. An unavailable response does not mean there is no account or mandate.</Notice>
        : accounts.length || canCreate.length ? <div className={styles.stack}>
            {accounts.map(account => <EntityAccountCase key={account.id} snapshot={snapshot} account={account} mandates={mandateRows} actorId={snapshot.actor.id} application={currentApplications.find(item => item.id === account.application_id)} onSaved={onSaved} />)}
            {canCreate.map(item => <div key={item.id} className={styles.sectionGap}><p className={styles.copy}>The approved entity admission identifies <strong>{item.details.company_name}</strong>. Opening its account records that legal holder; it does not appoint a representative, grant product eligibility or move funds.</p><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('create_entity_investment_account', { application_id: item.id })}>Open {item.details.company_name} investment account</button></div>)}
          </div>
          : <EmptyState title="Current entity investor admission required" description="Submit or renew an entity investor application and obtain independent approval before opening an entity account. A personal or wealth-manager application is not a substitute." href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my onboarding" />}
    </Panel>
    <Notice title="No entity subscription authority yet">Account opening and a representative appointment do not approve any offering, accept terms, reserve units, authorise payment, move a wallet or create a holding. Product eligibility requires a separate decision; entity transaction commands remain unavailable.</Notice>
  </div>
}

function EntityAccountCase({ snapshot, account, mandates, actorId, application, onSaved }: {
  snapshot: PortalSnapshot; account: PortalEntityInvestmentAccount; mandates: PortalInvestingRepresentativeMandate[]; actorId: string;
  application?: PortalApplication & { details: LegacyApplicationDetails }; onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const [appointmentDocumentId, setAppointmentDocumentId] = useState('')
  const [evidenceReference, setEvidenceReference] = useState('')
  const [requestedUntil, setRequestedUntil] = useState('')
  const command = usePortalCommand(onSaved)
  const companyDocuments = application?.details.documents.filter(document => document.kind === 'COMPANY') ?? []
  const selectedDocumentId = companyDocuments.some(document => document.id === appointmentDocumentId) ? appointmentDocumentId : companyDocuments[0]?.id ?? ''
  const until = Date.parse(requestedUntil)
  const validUntil = Number.isFinite(until) && until > Date.now() && until <= Date.now() + 30 * 86_400_000
    && Boolean(application?.approved_until) && until <= Date.parse(application!.approved_until!)
  const cases = mandates.filter(item => item.investment_account_id === account.id && item.representative_user_id === actorId)
  const mandate = [...cases].sort((a, b) => b.cycle - a.cycle || b.revision - a.revision)[0]
  const newCycle = !mandate || mandate.status === 'REVOKED' || mandate.status === 'APPLIED' && !mandate.effective
  const mayRequest = account.status === 'ACTIVE' && account.can_request_mandate && Boolean(application) && Boolean(companyDocuments.length)
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'request_investing_representative_mandate', snapshot.operating_context))
    && (newCycle || mandate?.can_request === true)
  return <section className={styles.stack} aria-label={`${account.entity_name} investment account`}>
    <CommandFeedback command={command} />
    <DetailList rows={[{ label: 'Legal holder', value: account.entity_name }, { label: 'Registration reference', value: account.registration_reference }, { label: 'Entity account', value: <span className={styles.mono}>{account.id}</span> }, { label: 'Account state', value: <StatusBadge status={account.status} /> }, { label: 'Investor admission expiry', value: dateLabel(account.admission_approved_until) }, { label: 'Account view authority', value: account.can_view ? 'Active representative mandate' : 'Not yet appointed' }]} />
    {mandate ? <div className={styles.sectionGap}><DetailList rows={[{ label: 'Investing-representative case', value: <span className={styles.mono}>{mandate.id}</span> }, { label: 'Appointment cycle', value: mandate.cycle }, { label: 'Mandate revision', value: mandate.revision }, { label: 'Decision state', value: <StatusBadge status={mandate.status} /> }, { label: 'Next responsible owner', value: entityMandateNextOwner(mandate) }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Current scope', value: 'Account view and guarded product-eligibility requests only' }, { label: 'Transaction limit', value: 'Zero; no subscription, funding or signing authority' }]} />{mandate.review_notes ? <Notice title="Reviewer decision">{mandate.review_notes}</Notice> : null}{mandate.revoke_reason ? <Notice title="Revocation reason" tone="warning">{mandate.revoke_reason}</Notice> : null}</div> : null}
    {account.status === 'SUSPENDED' ? <Notice title="Entity account suspended" tone="warning">A new appointment cannot override this suspension. Contact the appointed reviewer.</Notice>
      : account.can_view && mandate?.effective ? <Notice title="Limited representative access active">You can view this entity account. A guarded eligibility request requires the current mandate and exact published offering; it does not authorise an order, funding or signing action.</Notice>
        : mandate && !mayRequest ? <Notice title={mandate.status === 'SUBMITTED' ? 'Independent mandate review pending' : mandate.status === 'APPROVED' ? 'Authorised application pending' : 'Mandate action unavailable'}>{mandate.status === 'APPROVED' ? 'Compliance approved the case; a distinct Super Admin must apply it before account access is effective.' : 'This case is not active account authority. Follow the next responsible owner above or refresh the saved state.'}</Notice>
          : null}
    {!application && !account.can_view ? <Notice title="Current entity admission required" tone="warning">This account does not have a current approved investor application in your capacity. Renew the admission before requesting an appointment.</Notice> : null}
    {application && !companyDocuments.length ? <Notice title="Company appointment evidence required" tone="warning">The approved submission has no COMPANY document to bind to this request. This appointment path cannot proceed on the present admission evidence; a separately reviewed new or amended admission is required.</Notice> : null}
    {mayRequest ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!selectedDocumentId || !validUntil || evidenceReference.trim().length < 20) return; void command.submit('request_investing_representative_mandate', { investment_account_id: account.id, expected_revision: newCycle ? 0 : mandate?.revision ?? 0, appointment_document_id: selectedDocumentId, evidence_reference: evidenceReference.trim(), requested_until: new Date(requestedUntil).toISOString() }) }}>
      <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>{newCycle ? 'Request investing-representative appointment' : 'Update investing-representative case'}</legend>
        <Notice title="Reviewed authority, not self-approval">Choose COMPANY evidence already in the exact approved investor submission and explain the appointment. For changes required, you may revise this explanation, expiry or select another submitted COMPANY document; you cannot upload fresh evidence to this case. Compliance must decide it, then a different Super Admin must apply it. The mandate cannot authorise transactions.</Notice>
        <Field label="Appointment evidence document" hint="Choose the COMPANY document from the exact approved investor application."><select required value={selectedDocumentId} onChange={event => setAppointmentDocumentId(event.target.value)}>{companyDocuments.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}</select></Field>
        <Field label="Appointment evidence reference" hint="20 to 400 characters. Identify the fictional board or company appointment reflected in the selected evidence."><textarea required minLength={20} maxLength={400} value={evidenceReference} onChange={event => setEvidenceReference(event.target.value)} /></Field>
        <Field label="Requested end date and time" hint="Within 30 days, before the investor admission expires. Your local time is converted to UTC for the review record."><input type="datetime-local" required value={requestedUntil} onChange={event => setRequestedUntil(event.target.value)} /></Field>
        {requestedUntil && !validUntil ? <p className={styles.fieldError} role="alert">Choose a future time within 30 days and before the investor admission expires.</p> : null}
        <button type="submit" className={styles.button} disabled={!selectedDocumentId || evidenceReference.trim().length < 20 || !validUntil}>Submit representative mandate for review</button>
      </fieldset>
    </form> : null}
    {application?.user_id === actorId ? <AdditionalRepresentativeProposal snapshot={snapshot} account={account} application={application} onSaved={onSaved} /> : null}
    {application?.user_id === actorId && mandates.some(item => item.investment_account_id === account.id && item.representative_user_id !== actorId && item.proposal_hash) ? <Panel title="Named representative handoffs" description="Each person has a separate immutable proposal, consent and review cycle. Your own mandate does not appoint them.">
      <div className={styles.stack}>{mandates.filter(item => item.investment_account_id === account.id && item.representative_user_id !== actorId && item.proposal_hash).map(item => <section key={item.id} aria-label={`${investingRepresentativeLabel(item)} appointment handoff`}><DetailList rows={[{ label: 'Named representative', value: investingRepresentativeLabel(item) }, { label: 'Proposal reference', value: <span className={styles.mono}>{item.id}</span> }, { label: 'Cycle / revision', value: `${item.cycle} / ${item.revision}` }, { label: 'Status', value: <StatusBadge status={item.status} /> }, { label: 'Consent', value: item.consent_decision ?? 'Awaiting named representative' }, { label: 'Next responsible owner', value: entityMandateNextOwner(item) }, { label: 'Expiry', value: dateLabel(item.requested_until) }, { label: 'Effective mandate', value: item.effective ? 'Limited mandate active' : 'No account authority from this proposal' }]} />{item.review_notes ? <p className={styles.copy}>{item.review_notes}</p> : null}</section>)}</div>
    </Panel> : null}
  </section>
}

function AdditionalRepresentativeProposal({ snapshot, account, application, onSaved }: {
  snapshot: PortalSnapshot; account: PortalEntityInvestmentAccount; application: PortalApplication & { details: LegacyApplicationDetails }; onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const [email, setEmail] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [reference, setReference] = useState('')
  const [until, setUntil] = useState('')
  const command = usePortalCommand(onSaved)
  const documents = application.details.documents.filter(item => item.kind === 'COMPANY')
  const selectedId = documents.some(item => item.id === documentId) ? documentId : documents[0]?.id ?? ''
  const expiresAt = Date.parse(until)
  const validUntil = Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + 30 * 86_400_000
    && Boolean(application.approved_until) && expiresAt <= Date.parse(application.approved_until!)
  const validEmail = email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const mayPropose = account.can_propose_representative === true && account.status === 'ACTIVE'
    && application.user_id === snapshot.actor.id && application.status === 'APPROVED' && application.revision === account.admission_revision
    && Boolean(application.approved_until) && Date.parse(application.approved_until!) > Date.now() && documents.length > 0
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'request_investing_representative_mandate', snapshot.operating_context))
  if (!mayPropose) return null
  return <Panel title="Propose another representative" description="Only the original entity applicant can propose a named person. That person must consent, Compliance must review, and a different Super Admin must apply the limited mandate.">
    <CommandFeedback command={command} />
    <form className={styles.form} onSubmit={event => {
      event.preventDefault()
      if (command.busy || command.unknown || !validEmail || !selectedId || !validUntil || reference.trim().length < 20) return
      void command.submit('request_investing_representative_mandate', { investment_account_id: account.id, expected_revision: 0, representative_email: email.trim(), appointment_document_id: selectedId, evidence_reference: reference.trim(), requested_until: new Date(until).toISOString() })
    }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Named representative proposal</legend>
      <Field label="Representative email" hint="Use their own registered, email-confirmed login with a current individual investor admission. There is no applicant directory."><input type="email" required maxLength={254} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Field label="Proposal appointment document" hint="Only COMPANY evidence in the exact approved entity submission is available."><select required value={selectedId} onChange={event => setDocumentId(event.target.value)}>{documents.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      <Field label="Proposal evidence reference" hint="20 to 400 characters identifying the named appointment reflected in this document."><textarea required minLength={20} maxLength={400} value={reference} onChange={event => setReference(event.target.value)} /></Field>
      <Field label="Proposal end date and time" hint="Within 30 days and both admissions’ expiries. The server checks the named person's current admission without exposing it."><input type="datetime-local" required value={until} onChange={event => setUntil(event.target.value)} /></Field>
      {until && !validUntil ? <p role="alert" className={styles.fieldError}>Choose a future time within 30 days and before the entity admission expires.</p> : null}
      <p className={styles.muted}>A new or amended appointment document needs a separately reviewed admission rebind; it cannot replace already-approved evidence here. Existing account-view representatives cannot delegate. A declined or changed proposal requires a new cycle and new consent.</p>
      <button type="submit" className={styles.button} disabled={!validEmail || !selectedId || !validUntil || reference.trim().length < 20}>Send representative proposal</button>
    </fieldset></form>
  </Panel>
}

export function entityEligibilityNextOwner(item: PortalEntityProductEligibility): string {
  return { APPLICANT: 'Investing representative', COMPLIANCE: 'Appointed product Compliance reviewer', NONE: 'No pending eligibility action' }[item.next_owner]
}

function entityEligibilityRequestContext(snapshot: PortalSnapshot, account?: PortalEntityInvestmentAccount) {
  if (!account || account.kind !== 'ENTITY' || account.status !== 'ACTIVE' || account.can_request_eligibility !== true
    || !Array.isArray(snapshot.investing_representative_mandates) || !Array.isArray(snapshot.entity_investment_accounts)
    || snapshot.entity_investment_accounts.filter(item => item.id === account.id).length !== 1
    || ![account.id, account.entity_party_id, account.application_id, snapshot.actor.id].every(value => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) return undefined
  const applications = snapshot.applications.filter(item => item.id === account.application_id && item.persona === 'INVESTOR'
    && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'ENTITY')
  if (applications.length !== 1) return undefined
  const application = applications[0]
  if (!applicationDetailsSchema.safeParse(application.details).success || application.status !== 'APPROVED'
    || !Number.isInteger(application.revision) || application.revision < 1 || application.revision !== account.admission_revision
    || !application.approved_until || Date.parse(application.approved_until) <= Date.now()
    || !account.admission_approved_until || Date.parse(account.admission_approved_until) !== Date.parse(application.approved_until)) return undefined
  const mandates = snapshot.investing_representative_mandates.filter(item => item.investment_account_id === account.id
    && item.representative_user_id === snapshot.actor.id)
  if (new Set(mandates.map(item => item.id)).size !== mandates.length
    || new Set(mandates.map(item => item.cycle)).size !== mandates.length) return undefined
  const effective = mandates.filter(item => item.effective === true)
  if (effective.length !== 1) return undefined
  const mandate = effective[0]
  if (typeof mandate.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mandate.id)
    || mandate.status !== 'APPLIED' || mandate.entity_party_id !== account.entity_party_id || mandate.application_id !== application.id
    || mandate.admission_revision !== application.revision || mandate.admission_current_revision !== application.revision
    || !Number.isInteger(mandate.revision) || mandate.revision < 1 || !Number.isInteger(mandate.cycle) || mandate.cycle < 1
    || !Array.isArray(mandate.scope) || !mandate.scope.includes('REQUEST_ELIGIBILITY') || mandate.transaction_limit_minor !== '0'
    || !mandate.admission_approved_until || Date.parse(mandate.admission_approved_until) !== Date.parse(application.approved_until)
    || !Number.isFinite(Date.parse(mandate.requested_until)) || Date.parse(mandate.requested_until) <= Date.now()) return undefined
  return { application, mandate }
}

export function EntityProductEligibilityPanel({ product, snapshot, onSaved, operatingContext }: {
  product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext;
}) {
  const [accountId, setAccountId] = useState(() => Array.isArray(snapshot.entity_investment_accounts)
    ? snapshot.entity_investment_accounts.find(item => item?.kind === 'ENTITY' && (item.can_view === true || item.can_request_eligibility === true
      || snapshot.applications.some(application => application.id === item.application_id && application.user_id === snapshot.actor.id
        && application.persona === 'INVESTOR' && !isWealthManagerDetailsV2(application.details) && application.details.investor_type === 'ENTITY')))?.id ?? '' : '')
  const [statement, setStatement] = useState('')
  const command = usePortalCommand(onSaved)
  const records = validatedEntityProductEligibility(snapshot)
  const ownApplicationIds = new Set(snapshot.applications.filter(item => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR'
    && !isWealthManagerDetailsV2(item.details) && item.details.investor_type === 'ENTITY').map(item => item.id))
  const accountRecordsAvailable = Array.isArray(snapshot.entity_investment_accounts) && snapshot.entity_investment_accounts.every(item => item
    && item.kind === 'ENTITY' && typeof item.id === 'string' && typeof item.application_id === 'string' && typeof item.entity_party_id === 'string'
    && typeof item.entity_name === 'string' && typeof item.can_view === 'boolean' && typeof item.can_request_eligibility === 'boolean')
    && new Set(snapshot.entity_investment_accounts.map(item => item.id)).size === snapshot.entity_investment_accounts.length
  const mandateRecordsAvailable = Array.isArray(snapshot.investing_representative_mandates) && snapshot.investing_representative_mandates.every(item => item
    && typeof item.id === 'string' && typeof item.investment_account_id === 'string' && typeof item.representative_user_id === 'string'
    && typeof item.effective === 'boolean' && Array.isArray(item.scope))
  const accounts = accountRecordsAvailable ? snapshot.entity_investment_accounts!.filter(item => item.kind === 'ENTITY'
    && (item.can_view === true || item.can_request_eligibility === true || ownApplicationIds.has(item.application_id))) : []
  const selectedAccount = accounts.find(item => item.id === accountId)
  const context = accountRecordsAvailable && mandateRecordsAvailable ? entityEligibilityRequestContext(snapshot, selectedAccount) : undefined
  const eligibility = records?.find(item => item.product_id === product.id && item.investment_account_id === selectedAccount?.id)
  const boundCase = !eligibility || eligibility.entity_party_id === selectedAccount?.entity_party_id
    && eligibility.representative_user_id === snapshot.actor.id && eligibility.organisation_id === product.organisation_id
  const currentContext = Boolean(context && eligibility && boundCase && eligibility.application_revision === context.application.revision
    && eligibility.representative_mandate_id === context.mandate.id && eligibility.mandate_cycle === context.mandate.cycle
    && eligibility.mandate_revision === context.mandate.revision && eligibility.product_revision === product.revision
    && eligibility.offering_revision_id === product.offering_package?.id && eligibility.terms_hash === product.terms_hash)
  const effective = Boolean(currentContext && eligibility?.status === 'APPROVED' && eligibility.effective
    && eligibility.approved_until && Date.parse(eligibility.approved_until) > Date.now())
  const stale = Boolean(eligibility && (!currentContext || eligibility.status === 'APPROVED' && !effective))
  const canRequest = records !== undefined && Boolean(context) && boundCase && isOfferingSubscribable(product)
    && product.terms.eligible_investor_types.includes('ENTITY')
    && (!eligibility || eligibility.can_request === true && eligibility.status !== 'REVOKED')
  return <Panel title="Entity product eligibility" description="The entity is the legal holder. Its representative requests an independent decision for one exact published offering.">
    <CommandFeedback command={command} />
    <Notice title="Decision only; no entity transaction authority">An entity eligibility approval does not authorise a subscription, payment, wallet instruction or token issuance. No entity subscription form is enabled.</Notice>
    {records !== undefined && accountRecordsAvailable && mandateRecordsAvailable && (accounts.length > 1 || accounts.length && !selectedAccount)
      ? <Field label="Entity legal-holder account"><select value={selectedAccount?.id ?? ''} onChange={event => { setAccountId(event.target.value); setStatement('') }}><option value="">Choose entity legal-holder account</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.entity_name} · {item.id}</option>)}</select></Field> : null}
    {records === undefined || !accountRecordsAvailable || !mandateRecordsAvailable
      ? <Notice title="Entity eligibility records unavailable" tone="warning">Refresh saved state. Missing, invalid or ambiguous records cannot be treated as permission or as absence of a case.</Notice>
      : !selectedAccount ? <EmptyState title="Entity account and applied mandate required" description="Complete entity investor admission, account opening and independent representative appointment before requesting eligibility. Individual or manager capacity is not a substitute." href={portalScopeHref('/portal', operatingContext)} action="Open entity account records" />
        : <div className={styles.stack}>
          <DetailList rows={[{ label: 'Legal holder', value: selectedAccount.entity_name }, { label: 'Entity party', value: <span className={styles.mono}>{selectedAccount.entity_party_id}</span> }, { label: 'Entity investment account', value: <span className={styles.mono}>{selectedAccount.id}</span> }, { label: 'Acting representative', value: <span className={styles.mono}>{snapshot.actor.id}</span> }, { label: 'Current mandate', value: <span className={styles.mono}>{context?.mandate.id ?? 'No exact effective eligibility mandate'}</span> }, { label: 'Mandate cycle / revision', value: context ? `${context.mandate.cycle} / ${context.mandate.revision}` : 'Unavailable' }, { label: 'Published offering reference', value: <span className={styles.mono}>{product.offering_package?.id ?? 'Unavailable'}</span> }, { label: 'Product workflow revision', value: product.revision }, { label: 'Published terms fingerprint', value: <span className={styles.mono}>{product.terms_hash}</span> }]} />
          {eligibility ? <div className={styles.stack}><DetailList rows={[{ label: 'Case reference', value: <span className={styles.mono}>{eligibility.id}</span> }, { label: 'Case revision', value: eligibility.revision }, { label: 'Review state', value: <StatusBadge status={eligibility.status} /> }, { label: 'Next responsible owner', value: entityEligibilityNextOwner(eligibility) }, { label: 'Submitted mandate / cycle / revision', value: <span className={styles.mono}>{eligibility.representative_mandate_id} · {eligibility.mandate_cycle} / {eligibility.mandate_revision}</span> }, { label: 'Submitted offering reference', value: <span className={styles.mono}>{eligibility.offering_revision_id}</span> }, { label: 'Submitted terms fingerprint', value: <span className={styles.mono}>{eligibility.terms_hash}</span> }, { label: 'Review valid until', value: dateLabel(eligibility.approved_until) }]} />{eligibility.review_notes ? <Notice title="Reviewer notes">{eligibility.review_notes}</Notice> : null}{eligibility.blocked_reason ? <Notice title="Saved eligibility gate" tone="warning">{eligibility.blocked_reason}</Notice> : null}</div> : null}
          {!boundCase ? <Notice title="Entity eligibility binding unavailable" tone="warning">The saved case does not match this legal holder, representative and issuer. No request is available.</Notice>
            : eligibility?.status === 'REVOKED' ? <Notice title="Entity eligibility revoked" tone="warning">This case is closed. Mandate renewal or resubmission cannot revive it. Next owner: the appointed product Compliance reviewer for guidance; no transaction is enabled.</Notice>
              : effective ? <Notice title="Entity eligibility decision current">The independent decision is current for this entity, representative mandate and exact offering. It is not transaction authority.</Notice>
                : !context ? <Notice title={stale ? 'Entity eligibility context stale' : 'Entity eligibility request denied'} tone="warning">A current approved entity admission, active account and one effective applied REQUEST_ELIGIBILITY mandate with zero transaction limit are required. Account visibility or raw mandate approval is insufficient. The investing representative must resolve the admission or mandate gate before another request can be authorised.</Notice>
                  : !isOfferingSubscribable(product) || !product.terms.eligible_investor_types.includes('ENTITY') ? <Notice title="Offering unavailable for entity review" tone="warning">The exact published package must be current and admit entity investors. No fallback to personal capacity is available.</Notice>
                    : canRequest ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!context || !selectedAccount || !product.offering_package || !canRequest || command.busy || command.unknown || statement.trim().length < 20) return; void command.submit('request_product_eligibility', { product_id: product.id, investment_account_id: selectedAccount.id, expected_revision: eligibility?.revision ?? 0, investor_statement: statement.trim(), representative_mandate_id: context.mandate.id, expected_mandate_revision: context.mandate.revision, expected_mandate_cycle: context.mandate.cycle, expected_product_revision: product.revision, offering_revision_id: product.offering_package.id, terms_hash: product.terms_hash }) }}>
                      {stale ? <Notice title="Entity eligibility context stale" tone="warning">The saved decision or request no longer matches current admission, mandate or offering. Update the same case; a separate reviewer must decide again.</Notice> : <Notice title={eligibility?.status === 'CHANGES_REQUIRED' ? 'Further information required' : 'Independent entity review required'}>{eligibility ? 'Respond to the reviewer in this same case. Resubmission does not create a new approval.' : 'Explain the entity’s objectives and source of funds for this exact fictional test offering. Next owner after submission: the appointed product Compliance reviewer.'}</Notice>}
                      <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Entity eligibility request</legend><Field label="Entity investment statement" hint="20 to 2,000 characters. Describe the legal entity’s objectives, product fit and fictional source of funds."><textarea required minLength={20} maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={statement.trim().length < 20}>{eligibility ? 'Resubmit same entity eligibility case' : 'Submit entity for product eligibility review'}</button></fieldset>
                    </form> : <Notice title={eligibility?.status === 'SUBMITTED' && !stale ? 'Independent entity review pending' : stale ? 'Entity eligibility context stale' : 'Entity request unavailable'} tone={stale ? 'warning' : undefined}>{eligibility?.status === 'SUBMITTED' && !stale ? 'The appointed product Compliance reviewer owns the next decision. Submission does not reserve units or grant transaction authority.' : 'No request is authorised by the current saved projection. Refresh saved state or contact the next responsible owner; no authority is inferred.'}</Notice>}
        </div>}
  </Panel>
}

export function ProductEligibilityPanel({ product, snapshot, onSaved, operatingContext }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const [accountId, setAccountId] = useState('')
  const [statement, setStatement] = useState('')
  const command = usePortalCommand(onSaved)
  const approval = currentInvestorApplicationOfType(snapshot, 'INDIVIDUAL')
  const accounts = activeIndividualAccounts(snapshot)
  const selectedAccount = accounts.find(account => account.id === accountId) ?? accounts[0]
  const matches = selectedAccount && Array.isArray(snapshot.product_eligibility)
    ? snapshot.product_eligibility.filter(item => item.product_id === product.id && item.investment_account_id === selectedAccount.id) : []
  const eligibility = matches.length === 1 ? matches[0] : undefined
  const effective = selectedAccount && currentProductEligibility(snapshot, product, selectedAccount)
  const staleSubmission = eligibility?.status === 'SUBMITTED' && (eligibility.application_revision !== approval?.revision || eligibility.offering_revision_id !== product.offering_package?.id || eligibility.product_revision !== product.revision || eligibility.terms_hash !== product.terms_hash)
  const canRequest = !eligibility || eligibility.status === 'CHANGES_REQUIRED' || eligibility.status === 'REJECTED' || staleSubmission || eligibility.status === 'APPROVED' && !effective
  const productFit = Boolean(approval && product.terms.eligible_countries.includes(approval.details.country) && product.terms.eligible_investor_types.includes(approval.details.investor_type))
  return <Panel title="Product eligibility" description="A separate, independently reviewed decision for this account and the exact published offering package.">
    <CommandFeedback command={command} />
    {!approval ? <Notice title="Investor admission required" tone="warning">Complete your investor application and obtain current independent approval before requesting product eligibility.</Notice>
      : !productFit ? <Notice title="Product restrictions do not match" tone="warning">Your approved country or investor classification does not meet this offering’s published rules.</Notice>
        : !Array.isArray(snapshot.accounts) ? <Notice title="Investment-account records are unavailable">Refresh saved state before requesting product eligibility.</Notice>
          : !selectedAccount ? <Notice title="Investment account required">Open an approved individual investment account from <Link href={portalScopeHref('/portal/portfolio', operatingContext)} className={styles.textLink}>your investment workspace</Link> first.</Notice>
            : !Array.isArray(snapshot.product_eligibility) || matches.length > 1 ? <Notice title="Product eligibility records are unavailable">Refresh saved state before making an eligibility request or subscribing. No absence of a case is inferred.</Notice>
              : <div className={styles.stack}>
                {accounts.length > 1 ? <Field label="Investment account"><select value={selectedAccount.id} onChange={event => setAccountId(event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>{account.id}</option>)}</select></Field> : <p className={styles.muted}>Investment account: <span className={styles.mono}>{selectedAccount.id}</span></p>}
                {eligibility ? <div><DetailList rows={[{ label: 'Case reference', value: <span className={styles.mono}>{eligibility.id}</span> }, { label: 'Review state', value: <StatusBadge status={eligibility.status} /> }, { label: 'Submitted package reference', value: <span className={styles.mono}>{eligibility.offering_revision_id ?? 'Legacy case; no package binding'}</span> }, { label: 'Product workflow revision', value: eligibility.product_revision }, { label: 'Review valid until', value: dateLabel(eligibility.approved_until) }]} />{eligibility.review_notes ? <Notice title="Reviewer notes">{eligibility.review_notes}</Notice> : null}</div> : null}
                {effective ? <Notice title="Product eligibility approved">This account is eligible for the current published package. Read and accept its exact terms separately before placing a subscription instruction.</Notice>
                  : eligibility?.status === 'REVOKED' ? <Notice title="Product eligibility revoked" tone="warning">This account can no longer subscribe to this offering. Revocation closes this case; a new request cannot reopen it. Contact the appointed compliance team about any new admission path.</Notice>
                  : eligibility?.status === 'SUBMITTED' && !staleSubmission ? <Notice title="Independent review pending">An appointed compliance reviewer must decide this case. Submitting a statement does not approve this account or reserve units.</Notice>
                    : canRequest ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (selectedAccount && statement.trim().length >= 20) void command.submit('request_product_eligibility', { product_id: product.id, investment_account_id: selectedAccount.id, expected_revision: eligibility?.revision ?? 0, investor_statement: statement.trim() }) }}>
                      {eligibility ? <Notice title={staleSubmission ? 'Case context changed' : eligibility.status === 'APPROVED' ? 'Previous approval is no longer current' : 'Update your eligibility request'}>Submit a new statement for the current investor admission and published offering package. A separate reviewer must make a new decision.</Notice> : <Notice title="Product review required">Describe why this specific fictional test offering fits your investment objectives and source of funds. A reviewer must assess the evidence before you can subscribe.</Notice>}
                      <Field label="Investor statement" hint="20 to 2,000 characters describing product fit and source of funds for this account."><textarea required minLength={20} maxLength={2000} value={statement} onChange={event => setStatement(event.target.value)} /></Field>
                      <button type="submit" className={styles.button} disabled={command.busy || command.unknown || statement.trim().length < 20}>Submit for product eligibility review</button>
                    </form> : <Notice title="Eligibility action unavailable">Refresh saved state or contact the appointed reviewer about this case.</Notice>}
              </div>}
  </Panel>
}

export function OfferingDocuments({ product }: { product: PortalProduct }) {
  const pkg = product.offering_package
  const current = pkg?.origin === 'SUBMITTED' && pkg.terms_hash === product.terms_hash
  return <Panel title="Offering documents" description={current ? `In-form text disclosures · immutable package ${pkg.package_number}` : 'In-form text disclosures · not a current submitted package'}>
    <div className={styles.stack}>{([{ key: 'memorandum', label: 'Offering memorandum' }, { key: 'risks', label: 'Risk disclosures' }, { key: 'subscription_terms', label: 'Subscription agreement' }] as const).map(document => <details key={document.key}><summary className={styles.textLink}>{document.label}</summary><p className={styles.copy}>{product.terms.documents[document.key]}</p></details>)}</div>
    <p className={`${styles.muted} ${styles.sectionGap}`}>These disclosures are saved text, not signed documents or evidence of an e-signature. Their digests bind submitted text to the package. Separately staged PDFs remain quarantined and unscanned; signature evidence is not connected.</p>
  </Panel>
}

export function OfferingPackageEvidence({ product, showIssuerRationale = false }: { product: PortalProduct; showIssuerRationale?: boolean }) {
  const pkg = product.offering_package
  const history = (product.offering_history ?? []).filter(item => item.id !== pkg?.id)
  return <Panel title="Offering package and decision trail" description="One immutable submission reference follows the manager, issuer, Compliance and investor hand-offs.">
    {!pkg ? <Notice title="No current submitted package" tone="warning">This product is a draft or a preserved historical record. A workflow revision or old review cannot stand in for an approved offering package.</Notice>
      : <div className={styles.stack}>
        <DetailList rows={[
          { label: 'Package', value: `Package ${pkg.package_number}` },
          { label: 'Immutable package reference', value: <span className={styles.mono}>{pkg.id}</span> },
          { label: 'Submitted', value: dateLabel(pkg.submitted_at) },
          ...(pkg.status ? [{ label: 'Package state', value: <StatusBadge status={pkg.status} /> }] : []),
          { label: 'Terms fingerprint', value: <span className={styles.mono}>{pkg.terms_hash}</span> },
          { label: 'Memorandum text digest', value: <span className={styles.mono}>{pkg.document_hashes.memorandum}</span> },
          { label: 'Risk text digest', value: <span className={styles.mono}>{pkg.document_hashes.risks}</span> },
          { label: 'Subscription text digest', value: <span className={styles.mono}>{pkg.document_hashes.subscription_terms}</span> },
          { label: 'Appointed issuer decision', value: <StatusBadge status={pkg.issuer_status} /> },
          { label: 'Independent Compliance decision', value: <StatusBadge status={pkg.compliance_status} /> },
          { label: 'Technical readiness', value: <StatusBadge status={pkg.technical_readiness_status} /> },
        ]} />
        {showIssuerRationale && pkg.issuer_review_notes ? <Notice title="Issuer decision rationale" tone={pkg.issuer_status === 'CHANGES_REQUIRED' ? 'warning' : 'info'}>{pkg.issuer_review_notes}</Notice> : null}
        {pkg.terms_hash !== product.terms_hash ? <Notice title="Current terms do not match this package" tone="warning">Refresh the saved record. No decision, publication or subscription should rely on a mismatched product snapshot.</Notice> : null}
        {pkg.issuer_status !== 'APPROVED' ? <Notice title="Issuer decision outstanding">A separately appointed Issuer Fund Manager must review this exact package. A wealth-manager application does not grant issuer authority, and new customer organisations do not receive that appointment automatically.</Notice> : null}
        {pkg.technical_readiness_status !== 'VERIFIED' ? <Notice title="Awaiting technical readiness" tone="warning">Independently verified deployment and its governing authority are not connected to this package. It cannot be opened for subscriptions; no manager checkbox can attest this gate.</Notice> : null}
      </div>}
    {history.length ? <details className={styles.sectionGap}><summary className={styles.textLink}>Earlier preserved packages ({history.length})</summary><ul>{history.map(item => <li key={item.id}><strong>Package {item.package_number}</strong> · {item.origin !== 'SUBMITTED' ? 'Historical snapshot, approvals unverified' : 'Superseded submission'} · <span className={styles.mono}>{item.id}</span><br /><span className={styles.mono}>{item.terms_hash}</span></li>)}</ul></details> : null}
  </Panel>
}

export function ProductFacts({ product }: { product: PortalProduct }) {
  const terms = product.terms
  const legacySnapshot = product.offering_package?.origin === 'LEGACY_PRODUCT_SNAPSHOT' || product.offering_package?.origin === 'LEGACY_ORDER_SNAPSHOT'
  const versionLabel = isFundTermsV2(terms) ? 'Fund policy v2' : isRealEstateTermsV2(terms) ? 'Real-estate policy v2' : terms.asset_type === 'FUND' ? 'Historical fund terms v1' : legacySnapshot ? 'Historical property snapshot v1' : 'Preliminary property terms v1'
  const denominationLabel = isFundTermsV2(terms) || isRealEstateTermsV2(terms) ? 'Valueless TST · 6 decimal places' : terms.asset_type === 'FUND' ? 'Historical ZAR_TEST · 2 decimal places' : 'Historical ZAR_TEST · 2 decimal places'
  const description = legacySnapshot ? 'Preserved historical package snapshot' : product.offering_package?.origin === 'SUBMITTED' ? `Current submitted package ${product.offering_package.package_number}` : product.status === 'DRAFT' ? 'Current editable draft; not submitted' : 'Saved terms without a current submitted package'
  return <Panel title="Offering terms" description={description}><DetailList rows={[{ label: 'Asset type', value: terms.asset_type === 'FUND' ? 'Investment fund' : 'Real-estate investment' }, { label: 'Terms version', value: versionLabel }, { label: 'Issuer name (unverified)', value: terms.issuer_name }, { label: 'Share class', value: terms.share_class }, { label: 'Settlement denomination', value: denominationLabel }, { label: 'Price per whole unit', value: money(terms.unit_price_minor, terms.currency) }, { label: 'Minimum subscription', value: `${terms.minimum_units} units` }, { label: 'Offering capacity', value: `${terms.cap_units} units` }, ...(terms.asset_type === 'REAL_ESTATE' ? [{ label: 'Illustrative property valuation (separate from offering cap)', value: money(terms.property_valuation_minor, terms.currency) }] : []), { label: 'Reserved subscriptions', value: `${product.reserved_units} units` }, { label: 'Eligible countries', value: terms.eligible_countries.join(', ') }, { label: 'Investor types', value: terms.eligible_investor_types.map(value => value === 'ENTITY' ? 'Entity' : 'Individual').join(', ') }, { label: 'Workflow status', value: product.status === 'PUBLISHED' && !isOfferingSubscribable(product) ? 'Historical PUBLISHED state; not open for new subscriptions' : <StatusBadge status={product.status} /> }, { label: 'Workflow revision', value: product.revision }]} /></Panel>
}

export function ProductNarrative({ product }: { product: PortalProduct }) {
  const terms = product.terms
  const fund = isFundTermsV2(terms) ? terms.fund : null
  const property = isRealEstateTermsV2(terms) ? terms.real_estate : null
  return <Panel title={fund ? 'Fund mandate and operating terms' : property ? 'Property interest and operating terms' : 'Investment mandate'}>
    {fund ? <Notice title="Disclosed policy, not completed servicing">These terms describe the fictional fund package submitted for review. They do not prove a calculated NAV, available liquidity, a completed distribution or an executable redemption.</Notice> : null}
    {property ? <Notice title="Disclosed property policy, not title or cash evidence">The references and terms below are proposed for review. They do not prove legal title, property control, an independent valuation, rent received, consent, payment or an executable exit.</Notice> : null}
    {!fund && !property ? <><h3>Strategy</h3><p className={styles.copy}>{terms.strategy}</p>
      <hr className={styles.divider} /><h3 className={styles.sectionGap}>Pricing basis</h3><p className={styles.copy}>{terms.pricing_basis}</p>
      <h3 className={styles.sectionGap}>Fees and expenses</h3><p className={styles.copy}>{terms.fees}</p>
      <h3 className={styles.sectionGap}>Liquidity and exit</h3><p className={styles.copy}>{terms.redemption_terms}</p></> : null}
    {fund ? <div className={styles.stack}>
      <div><h3 className={styles.sectionGap}>Mandate and class rights</h3><p className={styles.copy}>{fund.mandate}</p><p className={styles.copy}>{fund.class_rights}</p></div>
      <div><h3>NAV and dealing</h3><DetailList rows={[
        { label: 'Valuation method', value: fund.nav.valuation_method }, { label: 'NAV frequency', value: fund.nav.frequency.toLowerCase() },
        { label: 'Pricing cutoff', value: fund.nav.pricing_cutoff }, { label: 'NAV correction', value: fund.nav.correction_policy },
        { label: 'Subscription dealing', value: fund.dealing.subscription_frequency.toLowerCase() }, { label: 'Redemption dealing', value: fund.dealing.redemption_frequency.toLowerCase() },
        { label: 'Redemption notice', value: `${fund.dealing.notice_days} calendar days` }, { label: 'Target settlement', value: `${fund.dealing.settlement_days} days` },
      ]} /></div>
      <div><h3>Fees, liquidity and distributions</h3><DetailList rows={[
        { label: 'Management fee', value: `${fund.fees.management_bps} bps` }, { label: 'Performance fee', value: `${fund.fees.performance_bps} bps` },
        { label: 'Other fees', value: fund.fees.other_fees }, { label: 'Lock-up', value: `${fund.liquidity.lockup_days} calendar days` },
        { label: 'Redemption gate', value: `${fund.liquidity.gate_bps} bps` }, { label: 'Suspension policy', value: fund.liquidity.suspension_policy },
        { label: 'Distribution schedule', value: fund.distributions.frequency.toLowerCase() }, { label: 'Distribution policy', value: fund.distributions.policy },
        { label: 'Redemption price basis', value: fund.redemption.price_basis }, { label: 'Redemption conditions', value: fund.redemption.conditions },
      ]} /></div>
    </div> : terms.asset_type === 'FUND' ? <div className={styles.sectionGap}><Notice title="Historical fund terms" tone="warning">This preserved ZAR_TEST package predates the structured fund policy. Its earlier amount and document hashes are not reinterpreted as TST.</Notice></div> : null}
    {property ? <div className={styles.stack}>
      <div><h3 className={styles.sectionGap}>SPV, property and legal interest</h3><DetailList rows={[
        { label: 'Fictional SPV', value: property.spv.legal_name }, { label: 'Registration reference', value: property.spv.registration_reference }, { label: 'Jurisdiction', value: property.spv.jurisdiction },
        { label: 'Interest rights', value: property.spv.interest_rights }, { label: 'Property', value: terms.property_address },
        { label: 'Title evidence reference (unverified)', value: property.property.title_evidence_reference }, { label: 'Control evidence reference (unverified)', value: property.property.control_evidence_reference },
      ]} /></div>
      <div><h3>Valuation and financing</h3><DetailList rows={[
        { label: 'Illustrative property valuation; not offering cap', value: money(terms.property_valuation_minor, terms.currency) },
        { label: 'Valuation method', value: property.property.valuation_method }, { label: 'Valuation frequency', value: property.property.valuation_frequency.toLowerCase() },
        { label: 'Correction policy', value: property.property.correction_policy }, { label: 'Debt policy', value: property.financing.debt_policy },
        { label: 'Lender consents', value: property.financing.lender_consent_policy },
      ]} /></div>
      <div><h3>Rent, expenses, reserves and distributions</h3><DetailList rows={[
        { label: 'Rent', value: property.cashflow.rent_policy }, { label: 'Expenses and taxes', value: property.cashflow.expense_policy },
        { label: 'Reserves', value: property.cashflow.reserve_policy }, { label: 'Distribution', value: property.cashflow.distribution_policy },
      ]} /></div>
      <div><h3>Consents and exits</h3><DetailList rows={[
        { label: 'Consent rights', value: property.governance.consent_rights }, { label: 'Voting', value: property.governance.voting_policy },
        { label: 'Eligible interest transfer; product continues', value: property.exits.eligible_transfer_policy },
        { label: 'Property disposal and liquidation; product closes', value: property.exits.disposal_liquidation_policy },
      ]} /></div>
    </div> : terms.asset_type === 'REAL_ESTATE' ? <><div className={styles.sectionGap}><Notice title="Historical property terms" tone="warning">This preserved ZAR_TEST package predates the structured SPV, property and exit policy. Its old price and valuation are not reinterpreted as TST.</Notice></div><h3 className={styles.sectionGap}>Property and rental income</h3><p className={styles.copy}>{terms.property_address}</p><p className={styles.muted}>Historical fictional valuation: {money(terms.property_valuation_minor, terms.currency)}</p><p className={styles.copy}>{terms.rental_income_policy}</p></> : null}
  </Panel>
}

export function ProductActions({ product, onSaved, availableCommands }: { product: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; availableCommands?: readonly string[] }) {
  const command = usePortalCommand(onSaved)
  const submitAvailable = usePortalCommandAllowed('submit_product')
  const saveAvailable = usePortalCommandAllowed('save_product')
  const publishAvailable = usePortalCommandAllowed('publish_product')
  const reopenAvailable = usePortalCommandAllowed('reopen_offering_review')
  const amendAvailable = usePortalCommandAllowed('begin_offering_amendment')
  const [reopenReason, setReopenReason] = useState('')
  const [amendReason, setAmendReason] = useState('')
  const legacyFundDraft = product.terms.asset_type === 'FUND' && !isFundTermsV2(product.terms) && ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status)
  const legacyPropertyDraft = product.terms.asset_type === 'REAL_ESTATE' && !isRealEstateTermsV2(product.terms) && ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status)
  const canSubmit = submitAvailable && !legacyFundDraft && !legacyPropertyDraft && ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status)
    && availableCommands?.includes('submit_product') === true
    && product.allowed_actions?.includes('submit_product') === true
  const canEditLegacyFund = saveAvailable && availableCommands?.includes('save_product') === true
    && product.allowed_actions?.includes('save_product') === true
  const pkg = product.offering_package
  const canPublish = publishAvailable && product.status === 'APPROVED' && pkg?.origin === 'SUBMITTED' && pkg.terms_hash === product.terms_hash && pkg.issuer_status === 'APPROVED' && pkg.compliance_status === 'APPROVED' && pkg.technical_readiness_status === 'VERIFIED' && pkg.publishable === true && product.allowed_actions?.includes('publish_product') === true && (availableCommands === undefined || availableCommands.includes('publish_product'))
  const canReopen = reopenAvailable && product.status === 'APPROVED'
    && availableCommands?.includes('reopen_offering_review') === true
    && product.allowed_actions?.includes('reopen_offering_review') === true
  const canAmend = amendAvailable && product.status === 'APPROVED'
    && availableCommands?.includes('begin_offering_amendment') === true
    && product.allowed_actions?.includes('begin_offering_amendment') === true
  return <Panel title="Offering hand-offs" description="Each action uses a server-checked organisation, actor and immutable package."><CommandFeedback command={command} />{product.review_notes ? <Notice title="Compliance notes" tone="warning">{product.review_notes}</Notice> : null}
    <ol className={`${styles.timeline} ${styles.sectionGap}`}>
      <li><strong>Manager submits the package</strong><p>Submission fixes the terms and in-form document digests under one package reference.</p></li>
      <li><strong>Appointed issuer decides</strong><p>The Issuer Fund Manager reviews rights and authority for that exact package.</p></li>
      <li><strong>Compliance decides separately</strong><p>An independent Compliance Officer records checks against the same reference.</p></li>
      <li><strong>Technical readiness and opening</strong><p>Publication needs verified deployment evidence. Orders remain unavailable until the backend opens this exact package.</p></li>
    </ol>
    <div className={styles.sectionGap}>{legacyFundDraft || legacyPropertyDraft ? <Notice title={legacyFundDraft ? 'Fund terms upgrade required' : 'Property terms upgrade required'} tone="warning">The historical ZAR_TEST draft cannot be submitted as a new package. {canEditLegacyFund ? <a href={legacyFundDraft ? '#fund-draft-editor' : '#property-draft-editor'} className={styles.textLink}>Open the draft editor and upgrade to the v2 TST {legacyFundDraft ? 'fund' : 'property'} policy.</a> : 'An authorised Offering Manager must upgrade and save the draft before submission.'}</Notice> : canSubmit ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('submit_product', { product_id: product.id, expected_revision: product.revision })}>Submit immutable offering package</button> : canPublish ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('publish_product', { product_id: product.id, expected_revision: product.revision })}>Open approved offering</button> : product.status === 'PUBLISHED' && !isOfferingSubscribable(product) ? <Notice title="Historical opening is not current" tone="warning">This row retains its recorded PUBLISHED status, but the backend has not verified its present package and readiness for new subscriptions.</Notice> : <StatusBadge status={product.status} />}</div>
    {product.status === 'APPROVED' && !canPublish ? <div className={styles.sectionGap}><Notice title="Opening is not available" tone="warning">The backend has not confirmed a current issuer decision, independent Compliance decision and technical-readiness evidence for this package. An APPROVED workflow status alone is not permission to publish.</Notice></div> : null}
    {canReopen ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => {
      event.preventDefault()
      if (reopenReason.trim().length < 20) return
      void command.submit('reopen_offering_review', { product_id: product.id, expected_revision: product.revision, reason: reopenReason.trim() })
    }}><h3>Reopen this package for independent review</h3><p className={styles.muted}>Creates a new immutable package revision with the same terms. Earlier decisions remain historical evidence and cannot approve the new revision. Use this when an appointment has ended or the package requires fresh issuer and Compliance decisions; it does not reopen funding.</p><Field label="Reason for re-review" hint="20 to 1,000 characters recorded with the new revision."><textarea required minLength={20} maxLength={1000} value={reopenReason} onChange={event => setReopenReason(event.target.value)} /></Field><button type="submit" className={styles.buttonSecondary} disabled={command.busy || command.unknown || reopenReason.trim().length < 20}>Create new review revision</button></form> : null}
    {canAmend ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => {
      event.preventDefault()
      if (amendReason.trim().length < 20) return
      void command.submit('begin_offering_amendment', { product_id: product.id, expected_revision: product.revision, reason: amendReason.trim() })
    }}><h3>Amend approved package terms</h3><p className={styles.muted}>Returns this unopened product to the draft editor. You must save genuinely changed terms and submit a new immutable package; old decisions never approve the amendment. Existing history is retained.</p><Field label="Reason for terms amendment" hint="20 to 1,000 characters recorded in the audit history."><textarea required minLength={20} maxLength={1000} value={amendReason} onChange={event => setAmendReason(event.target.value)} /></Field><button type="submit" className={styles.buttonSecondary} disabled={command.busy || command.unknown || amendReason.trim().length < 20}>Begin terms amendment</button></form> : null}
  </Panel>
}

export function ApplicationReview({ application, snapshot, onSaved, environment }: { application: PortalApplication; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; environment?: PlatformEnvironment }) {
  const manager = application.persona === 'WEALTH_MANAGER'
  const managerV2 = manager && isWealthManagerDetailsV2(application.details)
  const requiresOrganisationFacts = manager && application.admission_purpose !== 'LEGACY_REHEARSAL' && !managerV2
  const requiresStructuredOwnership = (manager || ('investor_type' in application.details && application.details.investor_type === 'ENTITY'))
    && (!('ownership_control' in application.details) || !Array.isArray(application.details.ownership_control)
      || application.details.ownership_control.length === 0 || application.details.details_version !== 3)
  const approvalBlocked = requiresOrganisationFacts || requiresStructuredOwnership
  const [checks, setChecks] = useState({ identity: false, ownership: false, screening: false, suitability: false })
  const [decision, setDecision] = useState(approvalBlocked ? 'CHANGES_REQUIRED' : 'APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const permitted = snapshot.actor.can_review && application.user_id !== snapshot.actor.id && application.status === 'SUBMITTED'
    && (!isTestPasswordWorkflow(snapshot) || hasStage2CommandAccess(snapshot, 'review_application', snapshot.operating_context))
  const allChecked = Object.values(checks).every(Boolean)
  if ('rehearsal' in snapshot || snapshot.stage2_access !== undefined && !validatedStage2Access(snapshot, snapshot.operating_context, environment)) return <Notice title="Saved admission state unavailable" tone="warning">Refresh this case through the normal application workspace before continuing. Its saved history has not changed.</Notice>
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Panel title={manager ? 'Customer organisation and representative' : 'Investor applicant information'} action={<StatusBadge status={application.status} />}><DetailList rows={[{ label: 'Application reference', value: application.id }, { label: 'Review purpose', value: manager ? application.admission_purpose === 'LEGACY_REHEARSAL' ? 'Historical rehearsal relationship' : 'Customer organisation admission' : 'Investor admission' }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Version', value: `Revision ${application.revision}` }, { label: 'Decision policy', value: application.provider_mode === 'MANUAL_TEST_REVIEW' ? 'Manual TEST admission decision' : 'Review policy not assigned' }]} /><div className={styles.sectionGap}><ApplicationDetailsSummary persona={application.persona} details={application.details} /></div></Panel>
    <Panel title="Private supporting evidence" description="Each download rechecks the current caller’s access. Uploaded evidence and its processing result remain separate.">{application.details.documents?.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence attached.</p>}</Panel>
    <ProviderEvidenceReview key={`${environment ?? 'UNAVAILABLE'}:${application.id}:${application.revision}`} applicationId={application.id} revision={application.revision} environment={environment} />
    <ApplicationDocumentHistory key={application.id} applicationId={application.id} />
  </div><div className={styles.stack}>
    {manager ? <Notice title="Customer admission is not operating authority">This decision does not appoint an Offering Manager, create a mandate or grant product, financial or signing powers. Those require separate approved assignments.</Notice> : <Notice title="Investor admission is not product eligibility">Each offering and investment account has separate eligibility and authority checks. Admission alone does not create a holding.</Notice>}
    {requiresOrganisationFacts ? <Notice title="Organisation facts required before approval" tone="warning">This saved case contains legacy investor-shaped answers. Request the organisation's business activities, representative position and authority evidence through changes required. The applicant must explicitly resubmit those facts before customer admission can be approved.</Notice> : null}
    {requiresStructuredOwnership ? <Notice title="Structured ownership disclosure required" tone="warning">This saved entity or customer case predates the per-person/entity disclosure. Request changes so the applicant can add each owner or controller, effective date, percentage, change reason and linked private evidence. A historical free-text answer is preserved, not treated as a reviewed relationship or an operating mandate.</Notice> : null}
    <Panel title="Review decision" description="The backend checks authority, revision and reviewer independence."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (command.busy || command.unknown) return; if (decision !== 'APPROVED' || allChecked && !approvalBlocked) void command.submit('review_application', { application_id: application.id, expected_revision: application.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Evidence checks</legend>{([
      { key: 'identity', label: managerV2 ? 'Representative identity evidence reviewed' : 'Identity evidence reviewed' },
      { key: 'ownership', label: managerV2 ? 'Organisation ownership and representative authority reviewed' : 'Ownership / authority reviewed' },
      { key: 'screening', label: 'Manual test screening recorded' },
      { key: 'suitability', label: managerV2 ? 'Customer business activities and requested service scope reviewed' : manager ? 'Legacy investment evidence reviewed (not customer service scope)' : 'Investor suitability reviewed' },
    ] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED" disabled={approvalBlocked}>{manager ? 'Approve test customer admission' : 'Approve test investor application'}</option><option value="CHANGES_REQUIRED">Request changes</option><option value="REJECTED">Reject application</option></select></Field><Field label="Review rationale" hint="Record the evidence considered and reason. At least 20 characters."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && (!allChecked || approvalBlocked)}>Record review decision</button></fieldset></form> : <Notice title="Decision unavailable">{application.user_id === snapshot.actor.id ? 'You cannot review your own application. A separate authorised reviewer must act.' : 'This case is not awaiting a decision, or this account does not have review authority.'}</Notice>}{application.review_notes ? <div className={styles.sectionGap}><h3>Recorded rationale</h3><p className={styles.copy}>{application.review_notes}</p></div> : null}</Panel>
  </div></div>
}

export function ProductReview({ product, snapshot, onSaved }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ issuer: false, terms: false, disclosures: false, eligibility: false })
  const [decision, setDecision] = useState('APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const reviewAvailable = usePortalCommandAllowed('review_product')
  const pkg = product.offering_package
  const permitted = reviewAvailable && snapshot.actor.can_review && product.created_by !== snapshot.actor.id && product.status === 'IN_REVIEW' && pkg?.origin === 'SUBMITTED' && pkg.can_review_compliance === true && product.allowed_actions?.includes('review_product') === true && pkg.compliance_status === 'PENDING' && pkg.terms_hash === product.terms_hash
  return <div className={styles.wideGrid}><div className={styles.stack}><ProductFacts product={product} /><OfferingPackageEvidence product={product} /><ProductNarrative product={product} /><OfferingDocuments product={product} /></div><Panel title="Independent Compliance decision" description="Record the decision against the immutable package reference and terms fingerprint."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('review_product', { product_id: product.id, offering_revision_id: pkg.id, expected_revision: product.revision, terms_hash: pkg.terms_hash, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Compliance checks</legend>{([{ key: 'issuer', label: 'Fictional issuer and asset mandate evidence reviewed (not issuer approval)' }, { key: 'terms', label: 'Economic and exit terms reviewed' }, { key: 'disclosures', label: 'In-form disclosures reviewed' }, { key: 'eligibility', label: 'Investor eligibility rules reviewed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">Approve Compliance review of this package</option><option value="CHANGES_REQUIRED">Request changes</option></select></Field><Field label="Review rationale"><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record Compliance decision</button></fieldset></form> : <Notice title="Independent decision required">{product.created_by === snapshot.actor.id ? 'You created this product and cannot approve it. A separate authorised reviewer must act.' : !pkg ? 'No current immutable package is awaiting Compliance review.' : 'This package is not awaiting your review, or its current terms do not match.'}</Notice>}</Panel></div>
}

export function IssuerOfferingReview({ product, snapshot, onSaved }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ issuer_authority: false, terms: false, rights: false })
  const [decision, setDecision] = useState('APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const reviewAvailable = usePortalCommandAllowed('review_offering_issuer')
  const pkg = product.offering_package
  const permitted = reviewAvailable && pkg?.origin === 'SUBMITTED' && pkg.can_review_issuer === true && product.allowed_actions?.includes('review_offering_issuer') === true
    && product.status === 'IN_REVIEW' && pkg.issuer_status === 'PENDING' && pkg.terms_hash === product.terms_hash && product.created_by !== snapshot.actor.id
  return <Panel title="Appointed issuer decision" description="Issuer authority is separate from the manager who prepared this package and from Compliance review.">
    <CommandFeedback command={command} />
    <Notice title="TEST package review only">The typed fund or property policies are proposed package disclosures, not a complete legal rights schedule or e-signature package. Property title and control evidence are not independently checked here. A manual test issuer decision is not legal sign-off, verified deployment or permission to open subscriptions.</Notice>
    {permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('review_offering_issuer', { product_id: product.id, offering_revision_id: pkg.id, expected_revision: product.revision, terms_hash: pkg.terms_hash, decision, notes, checks }) }}>
      <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Issuer evidence checks</legend>
        {([{ key: 'issuer_authority', label: 'Appointed issuer authority and product mandate verified for this test' }, { key: 'terms', label: 'Exact preliminary package economics and exit terms reviewed' }, { key: 'rights', label: 'Rights and obligations represented in these preliminary terms reviewed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}
        <Field label="Issuer decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">Approve this exact package</option><option value="CHANGES_REQUIRED">Request changes</option></select></Field>
        <Field label="Issuer rationale" hint="Record the authority and evidence considered; at least 20 characters."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
        <button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record issuer decision</button>
      </fieldset>
    </form> : <Notice title="Issuer action unavailable">{product.created_by === snapshot.actor.id ? 'A package creator cannot independently approve their own submission.' : 'A current, separately appointed Issuer Fund Manager must receive backend review authority for this exact package. An issuer name in a form is not an appointment.'}</Notice>}
  </Panel>
}

export function ProductEligibilityReview(props: { eligibility: PortalProductEligibility | PortalEntityProductEligibility; product?: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  if (props.eligibility.account_kind === 'ENTITY') {
    const records = validatedEntityProductEligibility(props.snapshot)
    const item = records?.find(record => record.id === props.eligibility.id && record.revision === props.eligibility.revision)
    return item ? <EntityProductEligibilityReview {...props} eligibility={item} />
      : <Notice title="Entity eligibility records unavailable" tone="warning">The exact saved entity case is missing, invalid or ambiguous. Refresh the scoped review queue; no decision is available.</Notice>
  }
  return <IndividualProductEligibilityReview {...props} eligibility={props.eligibility as PortalProductEligibility} />
}

function EntityProductEligibilityReview({ eligibility, product, snapshot, onSaved }: {
  eligibility: PortalEntityProductEligibility; product?: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void;
}) {
  const [checks, setChecks] = useState({ identity: false, product_fit: false, restrictions: false, source_of_funds: false })
  const [decision, setDecision] = useState('CHANGES_REQUIRED')
  const [notes, setNotes] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const command = usePortalCommand(onSaved)
  // Only the separately authorised nested source is used. A general application
  // list, account visibility or a provider badge cannot expand this evidence scope.
  const application = eligibility.investor_application
  const entitySource = application && !isWealthManagerDetailsV2(application.details) && application.details.investor_type === 'ENTITY' ? application : undefined
  const currentAdmission = Boolean(entitySource && entitySource.status === 'APPROVED' && entitySource.revision === eligibility.application_revision
    && entitySource.approved_until && Date.parse(entitySource.approved_until) > Date.now())
  const scopedOffering = Boolean(product && product.id === eligibility.product_id && product.organisation_id === eligibility.organisation_id)
  const currentOffering = Boolean(scopedOffering && product && isOfferingSubscribable(product)
    && product.offering_package?.id === eligibility.offering_revision_id && product.revision === eligibility.product_revision
    && product.terms_hash === eligibility.terms_hash && product.terms.eligible_investor_types.includes('ENTITY'))
  const ownCase = eligibility.representative_user_id === snapshot.actor.id
  const creatorConflict = product?.created_by === snapshot.actor.id
  const permitted = eligibility.can_decide === true && snapshot.actor.can_review && eligibility.status === 'SUBMITTED'
    && !ownCase && !creatorConflict && scopedOffering
  const canApprove = permitted && eligibility.can_approve === true && currentAdmission && currentOffering
  const canRevoke = eligibility.can_revoke === true && eligibility.status === 'APPROVED' && snapshot.actor.can_review
    && !ownCase && !creatorConflict && scopedOffering
  const allChecked = Object.values(checks).every(Boolean)
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Synthetic TEST entity review only">This labelled manual decision is not genuine provider or document-scanner clearance. Approval is eligibility display only; it never authorises a subscription, payment or token issuance.</Notice>
    <Panel title="Entity product eligibility case" action={<StatusBadge status={eligibility.status} />}><DetailList rows={[
      { label: 'Case reference', value: <span className={styles.mono}>{eligibility.id}</span> }, { label: 'Case revision', value: eligibility.revision },
      { label: 'Legal holder', value: eligibility.entity_name }, { label: 'Entity party', value: <span className={styles.mono}>{eligibility.entity_party_id}</span> },
      { label: 'Entity investment account', value: <span className={styles.mono}>{eligibility.investment_account_id}</span> },
      { label: 'Acting representative', value: <span className={styles.mono}>{eligibility.representative_user_id}</span> },
      { label: 'Representative mandate', value: <span className={styles.mono}>{eligibility.representative_mandate_id}</span> },
      { label: 'Mandate cycle / revision', value: `${eligibility.mandate_cycle} / ${eligibility.mandate_revision}` },
      { label: 'Investor admission revision', value: eligibility.application_revision }, { label: 'Offering package reference', value: <span className={styles.mono}>{eligibility.offering_revision_id}</span> },
      { label: 'Product workflow revision', value: eligibility.product_revision }, { label: 'Offering terms fingerprint', value: <span className={styles.mono}>{eligibility.terms_hash}</span> },
      { label: 'Next responsible owner', value: entityEligibilityNextOwner(eligibility) },
      { label: 'Decision Compliance appointment', value: <span className={styles.mono}>{eligibility.decision_appointment_id ?? 'Not decided'}</span> },
      { label: 'Decision appointment revision', value: eligibility.decision_appointment_revision ?? 'Not decided' },
      { label: 'Decision currency', value: eligibility.status === 'APPROVED' ? eligibility.effective ? 'Current eligibility decision only' : 'Stale; no authority' : 'Not approved' },
    ]} /><h3 className={styles.sectionGap}>Entity investment statement</h3><p className={styles.copy}>{eligibility.investor_statement}</p>{eligibility.blocked_reason ? <Notice title="Saved eligibility gate" tone="warning">{eligibility.blocked_reason}</Notice> : null}</Panel>
    {entitySource && !isWealthManagerDetailsV2(entitySource.details) ? <><Panel title="Authorised entity admission source"><DetailList rows={[{ label: 'Application reference', value: entitySource.id }, { label: 'Admission revision', value: entitySource.revision }, { label: 'Status', value: <StatusBadge status={entitySource.status} /> }, { label: 'Approval expiry', value: dateLabel(entitySource.approved_until) }]} /><ApplicationDetailsSummary persona="INVESTOR" details={entitySource.details} /></Panel><Panel title="Private supporting evidence" description="Only evidence already authorised in this nested source is shown. Each download rechecks separate current authority.">{entitySource.details.documents.length ? entitySource.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence attached.</p>}</Panel></>
      : <Notice title="Entity admission evidence unavailable" tone="warning">The source is outside this evidence scope. Approval is disabled; another visible application is not a substitute. An authorised reviewer may request information or reject with a reason.</Notice>}
    {product ? <><ProductFacts product={product} /><OfferingDocuments product={product} /></> : <Notice title="Offering record unavailable" tone="warning">Refresh the scoped queue. No decision is available without the exact issuer offering record.</Notice>}
  </div><Panel title="Independent entity eligibility decision" description="The backend rechecks the exact case, legal holder, representative mandate, current product Compliance appointment and published terms.">
    <CommandFeedback command={command} />
    {permitted && !canApprove ? <Notice title="Entity approval unavailable" tone="warning">Source admission, mandate, offering or separately authorised evidence is not current. Only an authorised information request or rejection is available.</Notice> : null}
    {permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (command.busy || command.unknown || notes.trim().length < 20 || decision === 'APPROVED' && (!canApprove || !allChecked)) return; void command.submit('review_product_eligibility', { eligibility_case_id: eligibility.id, expected_revision: eligibility.revision, decision, notes: notes.trim(), checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Synthetic entity evidence checks</legend>{([
      { key: 'identity', label: 'Current entity admission and representative mandate reviewed' },
      { key: 'product_fit', label: 'Entity statement and product fit reviewed' },
      { key: 'restrictions', label: 'Exact published country, entity classification and restrictions reviewed' },
      { key: 'source_of_funds', label: 'Authorised source-of-funds evidence reviewed' },
    ] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Entity eligibility decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="CHANGES_REQUIRED">Request further information</option><option value="APPROVED" disabled={!canApprove}>Approve entity eligibility decision only</option><option value="REJECTED">Reject entity product eligibility</option></select></Field><Field label="Entity review rationale" hint="20 to 3,000 characters. Record evidence, limitations and your decision reason."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={notes.trim().length < 20 || decision === 'APPROVED' && (!canApprove || !allChecked)}>Record entity eligibility decision</button></fieldset></form>
      : <Notice title={eligibility.status === 'APPROVED' ? 'Entity decision recorded' : 'Entity decision unavailable'} tone="warning">{ownCase ? 'You cannot review your own entity eligibility case, even in another role.' : creatorConflict ? 'You created this offering and cannot review its entity eligibility.' : !scopedOffering ? 'The exact scoped issuer offering is unavailable.' : eligibility.status !== 'SUBMITTED' ? 'This case is not awaiting a new decision. Follow its next responsible owner.' : 'Current independent product Compliance authority is required.'}</Notice>}
    {canRevoke ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); if (command.busy || command.unknown || revokeReason.trim().length < 20) return; void command.submit('revoke_product_eligibility', { eligibility_case_id: eligibility.id, expected_revision: eligibility.revision, reason: revokeReason.trim() }) }}><Notice title="Terminal entity revocation" tone="warning">Protective revocation ends this decision even if applicant evidence or mandate has expired. It cannot grant authority or be reversed by mandate renewal.</Notice><Field label="Entity revocation reason" hint="20 to 2,000 characters. Record the evidence and protective reason."><textarea required minLength={20} maxLength={2000} disabled={command.busy || command.unknown} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></Field><button type="submit" className={styles.buttonSecondary} disabled={command.busy || command.unknown || revokeReason.trim().length < 20}>Revoke entity product eligibility</button></form> : null}
    {eligibility.review_notes ? <div className={styles.sectionGap}><h3>Recorded reviewer rationale</h3><p className={styles.copy}>{eligibility.review_notes}</p></div> : null}
  </Panel></div>
}

function IndividualProductEligibilityReview({ eligibility, product, snapshot, onSaved }: { eligibility: PortalProductEligibility; product?: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ identity: false, product_fit: false, restrictions: false, source_of_funds: false })
  const application = eligibility.investor_application
  const currentAdmission = Boolean(application && application.status === 'APPROVED' && application.revision === eligibility.application_revision && application.approved_until && Date.parse(application.approved_until) > Date.now() && !isWealthManagerDetailsV2(application.details))
  const scopedOffering = Boolean(product && product.id === eligibility.product_id && product.organisation_id === eligibility.organisation_id)
  const currentOffering = Boolean(product && product.id === eligibility.product_id && product.organisation_id === eligibility.organisation_id && isOfferingSubscribable(product) && product.offering_package?.id === eligibility.offering_revision_id && product.revision === eligibility.product_revision && product.terms_hash === eligibility.terms_hash)
  const ownCase = !eligibility.holder_user_id || eligibility.holder_user_id === snapshot.actor.id
  const creatorConflict = product?.created_by === snapshot.actor.id
  const permitted = eligibility.can_decide === true && snapshot.actor.can_review && eligibility.status === 'SUBMITTED' && !ownCase && !creatorConflict && scopedOffering
  const canApprove = eligibility.can_approve === true && permitted && currentAdmission && currentOffering
  const [decision, setDecision] = useState(canApprove ? 'APPROVED' : 'CHANGES_REQUIRED')
  const [notes, setNotes] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const command = usePortalCommand(onSaved)
  const allChecked = Object.values(checks).every(Boolean)
  const canRevoke = eligibility.can_revoke === true && eligibility.status === 'APPROVED' && snapshot.actor.can_review && !ownCase && !creatorConflict && scopedOffering
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Manual test review only">This is a product-specific decision for a fictional test offering. Provider results do not grant investor eligibility or an operating role.</Notice>
    <Panel title="Product eligibility case" action={<StatusBadge status={eligibility.status} />}><DetailList rows={[{ label: 'Case reference', value: <span className={styles.mono}>{eligibility.id}</span> }, { label: 'Investment account', value: <span className={styles.mono}>{eligibility.investment_account_id}</span> }, { label: 'Case revision', value: eligibility.revision }, { label: 'Investor admission revision', value: eligibility.application_revision }, { label: 'Offering package reference', value: <span className={styles.mono}>{eligibility.offering_revision_id ?? 'Legacy case; no package binding'}</span> }, { label: 'Product workflow revision', value: eligibility.product_revision }, { label: 'Offering terms fingerprint', value: <span className={styles.mono}>{eligibility.terms_hash}</span> }, { label: 'Submitted', value: dateLabel(eligibility.submitted_at) }]} /><h3 className={styles.sectionGap}>Investor statement</h3><p className={styles.copy}>{eligibility.investor_statement}</p></Panel>
    {application && !isWealthManagerDetailsV2(application.details) ? <><Panel title="Approved investor admission evidence"><DetailList rows={[{ label: 'Application reference', value: application.id }, { label: 'Status', value: <StatusBadge status={application.status} /> }, { label: 'Approval expiry', value: dateLabel(application.approved_until) }]} /><div className={styles.sectionGap}><ApplicationDetailsSummary persona="INVESTOR" details={application.details} /></div></Panel><Panel title="Private supporting evidence" description="Each download rechecks your current review authority.">{application.details.documents?.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence attached.</p>}</Panel></> : <Notice title="Investor admission evidence unavailable" tone="warning">Source documents are outside this review scope. Approval is unavailable; request information or reject with a recorded reason.</Notice>}
    {product ? <><ProductFacts product={product} /><OfferingDocuments product={product} /></> : <Notice title="Offering record unavailable" tone="warning">Refresh the review queue before making a decision.</Notice>}
  </div><Panel title="Independent eligibility decision" description="The backend rechecks case revision, account holder, appointed scope and published terms.">
    <CommandFeedback command={command} />
    {permitted && !canApprove ? <Notice title="Approval unavailable for this case" tone="warning">The source admission evidence or published terms are not current in this review scope. Request updated information or reject with a reason.</Notice> : null}
    {permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (decision !== 'APPROVED' || canApprove && allChecked) void command.submit('review_product_eligibility', { eligibility_case_id: eligibility.id, expected_revision: eligibility.revision, decision, notes, checks }) }}>
      <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Manual evidence checks</legend>{([
        { key: 'identity', label: 'Current investor identity admission reviewed' },
        { key: 'product_fit', label: 'Investor statement and product fit reviewed' },
        { key: 'restrictions', label: 'Published country, classification and restrictions reviewed' },
        { key: 'source_of_funds', label: 'Source-of-funds evidence reviewed' },
      ] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}
      <Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED" disabled={!canApprove}>Approve product eligibility</option><option value="CHANGES_REQUIRED">Request further information</option><option value="REJECTED">Reject product eligibility</option></select></Field>
      <Field label="Review rationale" hint="Record the evidence and decision reason in 20 to 3,000 characters."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      <button type="submit" className={styles.button} disabled={decision === 'APPROVED' && (!allChecked || !canApprove)}>Record eligibility decision</button></fieldset>
    </form> : eligibility.status === 'APPROVED' ? <Notice title="Approved decision recorded">This case is not awaiting another approval. An appointed, independent reviewer may revoke it with a reason.</Notice> : <Notice title="Decision unavailable" tone="warning">{eligibility.holder_user_id === snapshot.actor.id ? 'You cannot review your own product eligibility case.' : creatorConflict ? 'You created this offering and cannot review its investor eligibility.' : eligibility.status !== 'SUBMITTED' ? 'This case is not awaiting a decision.' : !scopedOffering ? 'The scoped offering record is unavailable.' : 'Current independent review authority is required.'}</Notice>}
    {canRevoke ? <form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); if (revokeReason.trim().length >= 20) void command.submit('revoke_product_eligibility', { eligibility_case_id: eligibility.id, expected_revision: eligibility.revision, reason: revokeReason.trim() }) }}><h3>Revoke product eligibility</h3><Notice title="Terminal revocation" tone="warning">This ends the account’s approval for this offering. The investor cannot reopen this case by resubmitting.</Notice><Field label="Revocation reason" hint="Record the evidence and reason in 20 to 2,000 characters."><textarea required minLength={20} maxLength={2000} value={revokeReason} onChange={event => setRevokeReason(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={command.busy || command.unknown || revokeReason.trim().length < 20}>Revoke product eligibility</button></form> : null}
    {eligibility.review_notes ? <div className={styles.sectionGap}><h3>Recorded reviewer rationale</h3><p className={styles.copy}>{eligibility.review_notes}</p></div> : null}
  </Panel></div>
}

export function SubscriptionForm({ product, snapshot, onSaved, operatingContext }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const [units, setUnits] = useState(product.terms.minimum_units)
  const [accountId, setAccountId] = useState('')
  const [acceptedDocuments, setAcceptedDocuments] = useState(false), [acceptedRisks, setAcceptedRisks] = useState(false)
  const command = usePortalCommand(onSaved)
  const approval = currentInvestorApplicationOfType(snapshot, 'INDIVIDUAL')
  const accounts = activeIndividualAccounts(snapshot)
  const approvedAccounts = accounts.filter(account => currentProductEligibility(snapshot, product, account))
  const selectedAccountId = accountId || approvedAccounts[0]?.id || ''
  const selectedAccount = approvedAccounts.find(account => account.id === selectedAccountId)
  const eligible = Boolean(approval && product.terms.eligible_countries.includes(approval.details.country) && product.terms.eligible_investor_types.includes(approval.details.investor_type))
  const pkg = isOfferingSubscribable(product) ? product.offering_package : null
  const quote = subscriptionQuote(product, units)
  return <Panel title="Subscribe to this offering" description="Acceptance reserves units. It does not move cash or issue tokens.">
    <CommandFeedback command={command} />
    {!pkg ? <Notice title="Offering is not open" tone="warning">A current immutable package, separate issuer and Compliance decisions, and independently verified technical readiness are required before a subscription instruction can be accepted.</Notice>
      : !approval ? <Notice title="Approved investor onboarding required" tone="warning">Complete your investor application and obtain a current independent test approval before subscribing.<p><Link href={portalScopeHref('/portal/onboarding', operatingContext)} className={styles.textLink}>Go to my onboarding</Link></p></Notice>
      : !eligible ? <Notice title="Eligibility does not match this offering" tone="warning">Your approved country or investor classification is outside this product’s published rules. No subscription can be submitted.</Notice>
        : !accounts.length ? <div className={styles.stack}><Notice title="An active individual investment account is required">The subscription must identify the approved account that will hold the investment. Another person’s account or an entity relationship cannot be substituted.</Notice><InvestmentAccountPanel snapshot={snapshot} onSaved={onSaved} operatingContext={operatingContext} /></div>
          : !Array.isArray(snapshot.product_eligibility) ? <Notice title="Product eligibility records are unavailable" tone="warning">Refresh saved state before subscribing. An unavailable case list cannot be treated as approval.</Notice>
            : !selectedAccount ? <Notice title="Product eligibility review required" tone="warning">An appointed reviewer must approve this account for the current published offering revision. Use the product eligibility section above to submit or update your request.</Notice>
              : <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!selectedAccount || !currentProductEligibility(snapshot, product, selectedAccount) || !pkg) return; void command.submit('subscribe', { product_id: product.id, offering_revision_id: pkg.id, investment_account_id: selectedAccount.id, expected_revision: product.revision, terms_hash: pkg.terms_hash, units, accepted_documents: acceptedDocuments, accepted_risks: acceptedRisks }) }}>
            <fieldset className={styles.fieldset} disabled={command.busy || command.unknown || !pkg}>
              <legend>Subscription instruction</legend>
              <Field label="Investing account" hint="An individual account with current approval for this offering."><select required value={selectedAccountId} onChange={event => setAccountId(event.target.value)}>{approvedAccounts.map(account => <option key={account.id} value={account.id}>Individual · {account.id}</option>)}</select></Field>
              <Field label="Whole units" hint={`Minimum ${product.terms.minimum_units} units · ${money(product.terms.unit_price_minor, product.terms.currency)} per unit`}><input inputMode="numeric" required pattern="[1-9][0-9]*" value={units} onChange={event => setUnits(event.target.value)} /></Field>
              <DetailList rows={[{ label: 'Subscription value', value: 'amount_minor' in quote ? money(quote.amount_minor, product.terms.currency) : 'Enter a valid quantity' }, { label: 'Settlement', value: product.terms.currency === 'TST' ? 'Valueless synthetic TST only' : 'Synthetic ZAR_TEST only' }, { label: 'Accepted package', value: `Package ${pkg.package_number}` }, { label: 'Immutable package reference', value: <span className={styles.mono}>{pkg.id}</span> }]} />
              {'error' in quote ? <p className={styles.fieldError}>{quote.error}</p> : null}
              <label className={styles.check}><input type="checkbox" checked={acceptedDocuments} onChange={event => setAcceptedDocuments(event.target.checked)} required /><span>I have read and accept the memorandum and subscription text in package {pkg.package_number} with the displayed terms fingerprint. This is not an e-signature.</span></label>
              <label className={styles.check}><input type="checkbox" checked={acceptedRisks} onChange={event => setAcceptedRisks(event.target.checked)} required /><span>I have read the risk disclosures. I understand this fictional test subscription is not funded, issued ownership or a real investment.</span></label>
              <button type="submit" className={styles.button} disabled={!acceptedDocuments || !acceptedRisks || 'error' in quote}>Accept terms and reserve units</button>
            </fieldset>
          </form>}
    <div className={styles.sectionGap}><Notice title="Funding comes next">The same saved instruction appears in your orders and the authorised issuer’s incoming orders as awaiting funding. Only verified settlement and confirmed issuance can create a holding.</Notice></div>
  </Panel>
}

export function SubscriptionCancel({ id, onSaved, canCancel }: { id: string; onSaved: (snapshot: PortalSnapshot) => void; canCancel: boolean }) {
  const command = usePortalCommand(onSaved)
  if (!canCancel) return <p className={styles.muted}>Cancellation is not currently authorised. Funding evidence and unresolved outcomes require finance review before reserved units can be released.</p>
  return <><CommandFeedback command={command} /><button type="button" className={styles.buttonSecondary} disabled={command.busy || command.unknown} onClick={() => { if (window.confirm('Cancel this unfunded test subscription and release its reserved units?')) void command.submit('cancel_subscription', { subscription_id: id }) }}>Cancel unfunded reservation</button></>
}
