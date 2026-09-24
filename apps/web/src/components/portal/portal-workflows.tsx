'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { isOfferingSubscribable, isWealthManagerDetailsV2, subscriptionQuote, type LegacyApplicationDetails, type PortalApplication, type PortalEntityInvestmentAccount, type PortalInvestmentAccount, type PortalInvestingRepresentativeMandate, type PortalProduct, type PortalProductEligibility, type PortalSnapshot } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand } from './portal-client'
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
  return <Panel title="Your investment account" description="The account identifies who holds the investment. Your sign-in identifies who submits the instruction.">
    <CommandFeedback command={command} />
    {accounts.length ? <DetailList rows={accounts.map((account, index) => ({ label: `Active individual account ${index + 1}`, value: <span className={styles.mono}>{account.id}</span> }))} />
      : !application ? <EmptyState title="Complete investor onboarding" description="A current independent approval is required before an individual investment account can be opened." href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my onboarding" />
        : application.details.investor_type !== 'INDIVIDUAL' ? <Notice title="Entity investment account is separate">An entity relationship cannot be used as a personal investment account.</Notice>
          : !Array.isArray(snapshot.accounts) ? <Notice title="Investment-account records are unavailable">Refresh saved state before opening an account. An unavailable response is not evidence that no account exists.</Notice>
            : ownAccounts.some(account => account.application_id === application.id && account.status === 'SUSPENDED') ? <Notice title="Investment account suspended">Contact your authorised reviewer. Opening another account does not replace the suspended account or restore investment authority.</Notice>
              : <div className={styles.stack}><p className={styles.copy}>Your individual investor application is approved. Open an investment account to link future subscription instructions to that approved relationship.</p><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('create_investment_account', { application_id: application.id })}>Open individual investment account</button></div>}
    <p className={`${styles.muted} ${styles.sectionGap}`}>An account is not a cash balance, token holding or wallet-signing mandate.</p>
  </Panel>
}

function entityMandateNextOwner(mandate: PortalInvestingRepresentativeMandate): string {
  return { APPLICANT: 'Investing representative', COMPLIANCE: 'Independent BlockXOne Compliance Officer', SUPER_ADMIN: 'Authorised BlockXOne Super Admin', NONE: 'No pending mandate action' }[mandate.next_owner]
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
    ? currentApplications.filter(item => item.can_create_entity_account === true && !accounts.some(account => account.application_id === item.id)) : []
  return <div className={styles.stack}>
    <Panel title="Entity investment account" description="The legal entity holds the account. The signed-in person needs a separately reviewed mandate to act for it.">
      <CommandFeedback command={command} />
      {snapshot.entity_account_route_available !== true ? <Notice title="Entity-account route not admitted" tone="warning">This environment has not admitted the guarded entity-account route. No account action is available.</Notice>
        : !Array.isArray(accountRows) || !Array.isArray(mandateRows) ? <Notice title="Entity-account records unavailable" tone="warning">Refresh saved state. An unavailable response does not mean there is no account or mandate.</Notice>
        : accounts.length || canCreate.length ? <div className={styles.stack}>
            {accounts.map(account => <EntityAccountCase key={account.id} account={account} mandates={mandateRows} actorId={snapshot.actor.id} application={currentApplications.find(item => item.id === account.application_id)} onSaved={onSaved} />)}
            {canCreate.map(item => <div key={item.id} className={styles.sectionGap}><p className={styles.copy}>The approved entity admission identifies <strong>{item.details.company_name}</strong>. Opening its account records that legal holder; it does not appoint a representative, grant product eligibility or move funds.</p><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('create_entity_investment_account', { application_id: item.id })}>Open {item.details.company_name} investment account</button></div>)}
          </div>
          : <EmptyState title="Current entity investor admission required" description="Submit or renew an entity investor application and obtain independent approval before opening an entity account. A personal or wealth-manager application is not a substitute." href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my onboarding" />}
    </Panel>
    <Notice title="No entity subscription authority yet">Account opening and a representative appointment do not approve any offering, accept terms, reserve units, authorise payment, move a wallet or create a holding. Entity product eligibility and transaction commands remain separate work.</Notice>
  </div>
}

function EntityAccountCase({ account, mandates, actorId, application, onSaved }: {
  account: PortalEntityInvestmentAccount; mandates: PortalInvestingRepresentativeMandate[]; actorId: string;
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
    && (newCycle || mandate?.can_request === true)
  return <section className={styles.stack} aria-label={`${account.entity_name} investment account`}>
    <CommandFeedback command={command} />
    <DetailList rows={[{ label: 'Legal holder', value: account.entity_name }, { label: 'Registration reference', value: account.registration_reference }, { label: 'Entity account', value: <span className={styles.mono}>{account.id}</span> }, { label: 'Account state', value: <StatusBadge status={account.status} /> }, { label: 'Investor admission expiry', value: dateLabel(account.admission_approved_until) }, { label: 'Account view authority', value: account.can_view ? 'Active representative mandate' : 'Not yet appointed' }]} />
    {mandate ? <div className={styles.sectionGap}><DetailList rows={[{ label: 'Investing-representative case', value: <span className={styles.mono}>{mandate.id}</span> }, { label: 'Appointment cycle', value: mandate.cycle }, { label: 'Decision state', value: <StatusBadge status={mandate.status} /> }, { label: 'Next responsible owner', value: entityMandateNextOwner(mandate) }, { label: 'Requested expiry', value: dateLabel(mandate.requested_until) }, { label: 'Current scope', value: 'Account view only; eligibility-request scope is reserved for a later workflow' }, { label: 'Transaction limit', value: 'Zero; no subscription, funding or signing authority' }]} />{mandate.review_notes ? <Notice title="Reviewer decision">{mandate.review_notes}</Notice> : null}{mandate.revoke_reason ? <Notice title="Revocation reason" tone="warning">{mandate.revoke_reason}</Notice> : null}</div> : null}
    {account.status === 'SUSPENDED' ? <Notice title="Entity account suspended" tone="warning">A new appointment cannot override this suspension. Contact the appointed reviewer.</Notice>
      : account.can_view && mandate?.effective ? <Notice title="Limited representative access active">You can view this entity account. Eligibility-request scope is reserved for a later guarded workflow; no eligibility, order, funding or signing action is enabled here.</Notice>
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
  </section>
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
    <p className={`${styles.muted} ${styles.sectionGap}`}>These disclosures are saved text, not signed documents or evidence of an e-signature. Their digests bind submitted text to the package; private uploaded document and signature evidence remain separate work.</p>
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
  return <Panel title="Offering terms" description={product.offering_package ? `Current submitted package ${product.offering_package.package_number}` : 'Current draft or historical product terms.'}><DetailList rows={[{ label: 'Asset type', value: terms.asset_type === 'FUND' ? 'Investment fund' : 'Real-estate investment' }, { label: 'Issuer name (unverified)', value: terms.issuer_name }, { label: 'Share class', value: terms.share_class }, { label: 'Price per whole unit', value: money(terms.unit_price_minor) }, { label: 'Minimum subscription', value: `${terms.minimum_units} units` }, { label: 'Offering capacity', value: `${terms.cap_units} units` }, { label: 'Reserved subscriptions', value: `${product.reserved_units} units` }, { label: 'Eligible countries', value: terms.eligible_countries.join(', ') }, { label: 'Investor types', value: terms.eligible_investor_types.map(value => value === 'ENTITY' ? 'Entity' : 'Individual').join(', ') }, { label: 'Workflow status', value: product.status === 'PUBLISHED' && !isOfferingSubscribable(product) ? 'Historical PUBLISHED state; not open for new subscriptions' : <StatusBadge status={product.status} /> }, { label: 'Workflow revision', value: product.revision }]} /></Panel>
}

export function ProductNarrative({ product }: { product: PortalProduct }) {
  return <Panel title="Investment mandate"><h3>Strategy</h3><p className={styles.copy}>{product.terms.strategy}</p><hr className={styles.divider} /><h3 className={styles.sectionGap}>Pricing basis</h3><p className={styles.copy}>{product.terms.pricing_basis}</p><h3 className={styles.sectionGap}>Fees and expenses</h3><p className={styles.copy}>{product.terms.fees}</p><h3 className={styles.sectionGap}>Liquidity and exit</h3><p className={styles.copy}>{product.terms.redemption_terms}</p>{product.terms.asset_type === 'REAL_ESTATE' ? <><h3 className={styles.sectionGap}>Property and rental income</h3><p className={styles.copy}>{product.terms.property_address}</p><p className={styles.muted}>Fictional valuation: {money(product.terms.property_valuation_minor)}</p><p className={styles.copy}>{product.terms.rental_income_policy}</p></> : null}</Panel>
}

export function ProductActions({ product, onSaved, availableCommands }: { product: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; availableCommands?: readonly string[] }) {
  const command = usePortalCommand(onSaved)
  const canSubmit = ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status) && (availableCommands === undefined || availableCommands.includes('submit_product'))
  const pkg = product.offering_package
  const canPublish = product.status === 'APPROVED' && pkg?.origin === 'SUBMITTED' && pkg.terms_hash === product.terms_hash && pkg.issuer_status === 'APPROVED' && pkg.compliance_status === 'APPROVED' && pkg.technical_readiness_status === 'VERIFIED' && pkg.publishable === true && product.allowed_actions?.includes('publish_product') === true && (availableCommands === undefined || availableCommands.includes('publish_product'))
  return <Panel title="Offering hand-offs" description="Each action uses a server-checked organisation, actor and immutable package."><CommandFeedback command={command} />{product.review_notes ? <Notice title="Compliance notes" tone="warning">{product.review_notes}</Notice> : null}
    <ol className={`${styles.timeline} ${styles.sectionGap}`}>
      <li><strong>Manager submits the package</strong><p>Submission fixes the terms and in-form document digests under one package reference.</p></li>
      <li><strong>Appointed issuer decides</strong><p>The Issuer Fund Manager reviews rights and authority for that exact package.</p></li>
      <li><strong>Compliance decides separately</strong><p>An independent Compliance Officer records checks against the same reference.</p></li>
      <li><strong>Technical readiness and opening</strong><p>Publication needs verified deployment evidence. Orders remain unavailable until the backend opens this exact package.</p></li>
    </ol>
    <div className={styles.sectionGap}>{canSubmit ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('submit_product', { product_id: product.id, expected_revision: product.revision })}>Submit immutable offering package</button> : canPublish ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('publish_product', { product_id: product.id, expected_revision: product.revision })}>Open approved offering</button> : product.status === 'PUBLISHED' && !isOfferingSubscribable(product) ? <Notice title="Historical opening is not current" tone="warning">This row retains its recorded PUBLISHED status, but the backend has not verified its present package and readiness for new subscriptions.</Notice> : <StatusBadge status={product.status} />}</div>
    {product.status === 'APPROVED' && !canPublish ? <div className={styles.sectionGap}><Notice title="Opening is not available" tone="warning">The backend has not confirmed a current issuer decision, independent Compliance decision and technical-readiness evidence for this package. An APPROVED workflow status alone is not permission to publish.</Notice></div> : null}
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
  const allChecked = Object.values(checks).every(Boolean)
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Independent test review only">Record your own decision against fictional evidence. A sandbox provider result is visible below only if received through the guarded evidence path; no production KYC or automated sanctions decision is represented as connected.</Notice>
    <Panel title={manager ? 'Customer organisation and representative' : 'Investor applicant information'} action={<StatusBadge status={application.status} />}><DetailList rows={[{ label: 'Application reference', value: application.id }, { label: 'Review purpose', value: manager ? application.admission_purpose === 'LEGACY_REHEARSAL' ? 'Historical rehearsal relationship' : 'Customer organisation admission' : 'Investor admission' }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Version', value: `Revision ${application.revision}` }]} /><div className={styles.sectionGap}><ApplicationDetailsSummary persona={application.persona} details={application.details} /></div></Panel>
    <Panel title="Private supporting evidence" description="Each download rechecks the current caller’s access.">{application.details.documents?.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence attached.</p>}</Panel>
    <ProviderEvidenceReview key={`${environment ?? 'UNAVAILABLE'}:${application.id}:${application.revision}`} applicationId={application.id} revision={application.revision} environment={environment} />
    <ApplicationDocumentHistory key={application.id} applicationId={application.id} />
  </div><div className={styles.stack}>
    {manager ? <Notice title="Customer admission is not operating authority">This decision does not appoint an Offering Manager, create a mandate or grant product, financial or signing powers. Those require separate approved assignments.</Notice> : <Notice title="Investor admission is not product eligibility">Each offering and investment account has separate eligibility and authority checks. Admission alone does not create a holding.</Notice>}
    {requiresOrganisationFacts ? <Notice title="Organisation facts required before approval" tone="warning">This saved case contains legacy investor-shaped answers. Request the organisation's business activities, representative position and authority evidence through changes required. The applicant must explicitly resubmit those facts before customer admission can be approved.</Notice> : null}
    {requiresStructuredOwnership ? <Notice title="Structured ownership disclosure required" tone="warning">This saved entity or customer case predates the per-person/entity disclosure. Request changes so the applicant can add each owner or controller, effective date, percentage, change reason and linked private evidence. A historical free-text answer is preserved, not treated as a reviewed relationship or an operating mandate.</Notice> : null}
    <Panel title="Review decision" description="The backend checks authority, revision and reviewer independence."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); if (decision !== 'APPROVED' || allChecked && !approvalBlocked) void command.submit('review_application', { application_id: application.id, expected_revision: application.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Evidence checks</legend>{([
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
  const pkg = product.offering_package
  const permitted = snapshot.actor.can_review && product.created_by !== snapshot.actor.id && product.status === 'IN_REVIEW' && pkg?.origin === 'SUBMITTED' && pkg.can_review_compliance === true && product.allowed_actions?.includes('review_product') === true && pkg.compliance_status === 'PENDING' && pkg.terms_hash === product.terms_hash
  return <div className={styles.wideGrid}><div className={styles.stack}><ProductFacts product={product} /><OfferingPackageEvidence product={product} /><ProductNarrative product={product} /><OfferingDocuments product={product} /></div><Panel title="Independent Compliance decision" description="Record the decision against the immutable package reference and terms fingerprint."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('review_product', { product_id: product.id, offering_revision_id: pkg.id, expected_revision: product.revision, terms_hash: pkg.terms_hash, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Compliance checks</legend>{([{ key: 'issuer', label: 'Fictional issuer and asset mandate evidence reviewed (not issuer approval)' }, { key: 'terms', label: 'Economic and exit terms reviewed' }, { key: 'disclosures', label: 'In-form disclosures reviewed' }, { key: 'eligibility', label: 'Investor eligibility rules reviewed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">Approve Compliance review of this package</option><option value="CHANGES_REQUIRED">Request changes</option></select></Field><Field label="Review rationale"><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record Compliance decision</button></fieldset></form> : <Notice title="Independent decision required">{product.created_by === snapshot.actor.id ? 'You created this product and cannot approve it. A separate authorised reviewer must act.' : !pkg ? 'No current immutable package is awaiting Compliance review.' : 'This package is not awaiting your review, or its current terms do not match.'}</Notice>}</Panel></div>
}

export function IssuerOfferingReview({ product, snapshot, onSaved }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ issuer_authority: false, terms: false, rights: false })
  const [decision, setDecision] = useState('APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const pkg = product.offering_package
  const permitted = pkg?.origin === 'SUBMITTED' && pkg.can_review_issuer === true && product.allowed_actions?.includes('review_offering_issuer') === true
    && product.status === 'IN_REVIEW' && pkg.issuer_status === 'PENDING' && pkg.terms_hash === product.terms_hash && product.created_by !== snapshot.actor.id
  return <Panel title="Appointed issuer decision" description="Issuer authority is separate from the manager who prepared this package and from Compliance review.">
    <CommandFeedback command={command} />
    <Notice title="Preliminary TEST terms only">The present fund and property fields are not a complete legal rights schedule or e-signature package. A manual test issuer decision records review of this draft evidence; it is not legal sign-off, verified deployment or permission to open subscriptions.</Notice>
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

export function ProductEligibilityReview({ eligibility, product, snapshot, onSaved }: { eligibility: PortalProductEligibility; product?: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
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
              <Field label="Whole units" hint={`Minimum ${product.terms.minimum_units} units · ${money(product.terms.unit_price_minor)} per unit`}><input inputMode="numeric" required pattern="[1-9][0-9]*" value={units} onChange={event => setUnits(event.target.value)} /></Field>
              <DetailList rows={[{ label: 'Subscription value', value: 'amount_minor' in quote ? money(quote.amount_minor) : 'Enter a valid quantity' }, { label: 'Settlement', value: 'Synthetic ZAR_TEST only' }, { label: 'Accepted package', value: `Package ${pkg.package_number}` }, { label: 'Immutable package reference', value: <span className={styles.mono}>{pkg.id}</span> }]} />
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
