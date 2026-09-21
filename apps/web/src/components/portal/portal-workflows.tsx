'use client'

import { useState } from 'react'
import Link from 'next/link'
import { subscriptionQuote, type PortalApplication, type PortalInvestmentAccount, type PortalProduct, type PortalSnapshot } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { CommandFeedback, usePortalCommand } from './portal-client'
import { PrivateDocument } from './onboarding-form'
import { DetailList, EmptyState, Field, Notice, Panel, StatusBadge, dateLabel, money } from './portal-primitives'
import styles from './portal.module.css'

export function currentInvestorApplication(snapshot: PortalSnapshot): PortalApplication | undefined {
  return snapshot.applications.find(item => item.user_id === snapshot.actor.id && item.persona === 'INVESTOR' && item.status === 'APPROVED' && Boolean(item.approved_until) && Date.parse(item.approved_until!) > Date.now())
}

export function activeIndividualAccounts(snapshot: PortalSnapshot): PortalInvestmentAccount[] {
  const application = currentInvestorApplication(snapshot)
  if (application?.details.investor_type !== 'INDIVIDUAL') return []
  return (snapshot.accounts ?? []).filter(account => account.holder_user_id === snapshot.actor.id
    && account.application_id === application.id && account.kind === 'INDIVIDUAL' && account.status === 'ACTIVE')
}

export function InvestmentAccountPanel({ snapshot, onSaved, operatingContext }: { snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const application = currentInvestorApplication(snapshot)
  const accounts = activeIndividualAccounts(snapshot)
  const ownAccounts = (snapshot.accounts ?? []).filter(account => account.holder_user_id === snapshot.actor.id)
  const command = usePortalCommand(onSaved)
  return <Panel title="Your investment account" description="The account identifies who holds the investment. Your sign-in identifies who submits the instruction.">
    <CommandFeedback command={command} />
    {accounts.length ? <DetailList rows={accounts.map((account, index) => ({ label: `Active individual account ${index + 1}`, value: <span className={styles.mono}>{account.id}</span> }))} />
      : !application ? <EmptyState title="Complete investor onboarding" description="A current independent approval is required before an individual investment account can be opened." href={portalScopeHref('/portal/onboarding', operatingContext)} action="Open my onboarding" />
        : application.details.investor_type !== 'INDIVIDUAL' ? <Notice title="Entity representation requires a mandate">An entity relationship cannot be used as a personal investment account. Entity investment accounts require an explicitly authorised representative mandate.</Notice>
          : !Array.isArray(snapshot.accounts) ? <Notice title="Investment-account records are unavailable">Refresh saved state before opening an account. An unavailable response is not evidence that no account exists.</Notice>
            : ownAccounts.some(account => account.application_id === application.id && account.status === 'SUSPENDED') ? <Notice title="Investment account suspended">Contact your authorised reviewer. Opening another account does not replace the suspended account or restore investment authority.</Notice>
              : <div className={styles.stack}><p className={styles.copy}>Your individual investor application is approved. Open an investment account to link future subscription instructions to that approved relationship.</p><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('create_investment_account', { application_id: application.id })}>Open individual investment account</button></div>}
    <p className={`${styles.muted} ${styles.sectionGap}`}>An account is not a cash balance, token holding or wallet-signing mandate.</p>
  </Panel>
}

export function OfferingDocuments({ product }: { product: PortalProduct }) {
  return <Panel title="Offering documents" description={`Private, versioned disclosures · revision ${product.revision}`}><div className={styles.stack}>{([{ key: 'memorandum', label: 'Offering memorandum' }, { key: 'risks', label: 'Risk disclosures' }, { key: 'subscription_terms', label: 'Subscription agreement' }] as const).map(document => <details key={document.key}><summary className={styles.textLink}>{document.label}</summary><p className={styles.copy}>{product.terms.documents[document.key]}</p></details>)}</div><div className={styles.sectionGap}><p className={styles.muted}>Offering terms fingerprint</p><p className={styles.mono}>{product.terms_hash}</p></div></Panel>
}

export function ProductFacts({ product }: { product: PortalProduct }) {
  const terms = product.terms
  return <Panel title="Offering terms" description="Source: the saved product revision."><DetailList rows={[{ label: 'Asset type', value: terms.asset_type === 'FUND' ? 'Investment fund' : 'Real-estate investment' }, { label: 'Issuer', value: terms.issuer_name }, { label: 'Share class', value: terms.share_class }, { label: 'Price per whole unit', value: money(terms.unit_price_minor) }, { label: 'Minimum subscription', value: `${terms.minimum_units} units` }, { label: 'Offering capacity', value: `${terms.cap_units} units` }, { label: 'Reserved subscriptions', value: `${product.reserved_units} units` }, { label: 'Eligible countries', value: terms.eligible_countries.join(', ') }, { label: 'Investor types', value: terms.eligible_investor_types.map(value => value === 'ENTITY' ? 'Entity' : 'Individual').join(', ') }, { label: 'Status', value: <StatusBadge status={product.status} /> }, { label: 'Terms version', value: `Revision ${product.revision}` }]} /></Panel>
}

export function ProductNarrative({ product }: { product: PortalProduct }) {
  return <Panel title="Investment mandate"><h3>Strategy</h3><p className={styles.copy}>{product.terms.strategy}</p><hr className={styles.divider} /><h3 className={styles.sectionGap}>Pricing basis</h3><p className={styles.copy}>{product.terms.pricing_basis}</p><h3 className={styles.sectionGap}>Fees and expenses</h3><p className={styles.copy}>{product.terms.fees}</p><h3 className={styles.sectionGap}>Liquidity and exit</h3><p className={styles.copy}>{product.terms.redemption_terms}</p>{product.terms.asset_type === 'REAL_ESTATE' ? <><h3 className={styles.sectionGap}>Property and rental income</h3><p className={styles.copy}>{product.terms.property_address}</p><p className={styles.muted}>Fictional valuation: {money(product.terms.property_valuation_minor)}</p><p className={styles.copy}>{product.terms.rental_income_policy}</p></> : null}</Panel>
}

export function ProductActions({ product, onSaved, availableCommands }: { product: PortalProduct; onSaved: (snapshot: PortalSnapshot) => void; availableCommands?: readonly string[] }) {
  const command = usePortalCommand(onSaved)
  const canSubmit = ['DRAFT', 'CHANGES_REQUIRED'].includes(product.status) && (availableCommands === undefined || availableCommands.includes('submit_product'))
  const canPublish = product.status === 'APPROVED' && (availableCommands === undefined || availableCommands.includes('publish_product'))
  return <Panel title="Publication controls" description="Drafting, independent review and publication remain separate decisions."><CommandFeedback command={command} />{product.review_notes ? <Notice title="Review notes" tone="warning">{product.review_notes}</Notice> : null}<ol className={`${styles.timeline} ${styles.sectionGap}`}><li><strong>Product draft</strong><p>Asset terms, investor eligibility and documents are versioned together.</p></li><li><strong>Independent review</strong><p>A separate authorised reviewer checks the issuer, terms, disclosures and eligibility.</p></li><li><strong>Publish the approved version</strong><p>The published revision becomes available for eligible test subscriptions.</p></li></ol><div className={styles.sectionGap}>{canSubmit ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('submit_product', { product_id: product.id, expected_revision: product.revision })}>Submit product for review</button> : canPublish ? <button className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit('publish_product', { product_id: product.id, expected_revision: product.revision })}>Publish approved offering</button> : <StatusBadge status={product.status} />}</div></Panel>
}

export function ApplicationReview({ application, snapshot, onSaved }: { application: PortalApplication; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ identity: false, ownership: false, screening: false, suitability: false })
  const [decision, setDecision] = useState('APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const permitted = snapshot.actor.can_review && application.user_id !== snapshot.actor.id && application.status === 'SUBMITTED'
  const allChecked = Object.values(checks).every(Boolean)
  return <div className={styles.wideGrid}><div className={styles.stack}>
    <Notice title="Manual test review only">Record a real review decision against fictional evidence. No automated sanctions service or production KYC provider is represented as connected.</Notice>
    <Panel title="Applicant information" action={<StatusBadge status={application.status} />}><DetailList rows={[{ label: 'Name', value: application.details.full_name }, { label: 'Application', value: application.persona === 'INVESTOR' ? 'Investor' : 'Wealth manager' }, { label: 'Country', value: application.details.country }, { label: 'Classification', value: application.details.investor_type }, { label: 'Entity', value: application.details.company_name || 'Not applicable' }, { label: 'Registration', value: application.details.registration_reference || 'Not applicable' }, { label: 'Submitted', value: dateLabel(application.submitted_at) }, { label: 'Version', value: `Revision ${application.revision}` }]} /><h3 className={styles.sectionGap}>Source of funds</h3><p className={styles.copy}>{application.details.source_of_funds}</p><h3>Investment experience</h3><p className={styles.copy}>{application.details.experience}</p>{application.details.beneficial_owners ? <><h3>Ownership and representation</h3><p className={styles.copy}>{application.details.beneficial_owners}</p></> : null}</Panel>
    <Panel title="Private supporting evidence" description="Each download rechecks the current caller’s access.">{application.details.documents.length ? application.details.documents.map(document => <PrivateDocument key={document.id} document={document} />) : <p className={styles.muted}>No evidence attached.</p>}</Panel>
  </div><div className={styles.stack}><Panel title="Review decision" description="The backend checks authority, revision and reviewer independence."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('review_application', { application_id: application.id, expected_revision: application.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Evidence checks</legend>{([{ key: 'identity', label: 'Identity evidence reviewed' }, { key: 'ownership', label: 'Ownership / authority reviewed' }, { key: 'screening', label: 'Manual test screening recorded' }, { key: 'suitability', label: 'Investor suitability reviewed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">Approve test application</option><option value="CHANGES_REQUIRED">Request changes</option><option value="REJECTED">Reject application</option></select></Field><Field label="Review rationale" hint="Record the evidence considered and reason. At least 20 characters."><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !allChecked}>Record review decision</button></fieldset></form> : <Notice title="Decision unavailable">{application.user_id === snapshot.actor.id ? 'You cannot review your own application. A separate authorised reviewer must act.' : 'This case is not awaiting a decision, or this account does not have review authority.'}</Notice>}{application.review_notes ? <div className={styles.sectionGap}><h3>Recorded rationale</h3><p className={styles.copy}>{application.review_notes}</p></div> : null}</Panel></div></div>
}

export function ProductReview({ product, snapshot, onSaved }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void }) {
  const [checks, setChecks] = useState({ issuer: false, terms: false, disclosures: false, eligibility: false })
  const [decision, setDecision] = useState('APPROVED'), [notes, setNotes] = useState('')
  const command = usePortalCommand(onSaved)
  const permitted = snapshot.actor.can_review && product.created_by !== snapshot.actor.id && product.status === 'IN_REVIEW'
  return <div className={styles.wideGrid}><div className={styles.stack}><ProductFacts product={product} /><ProductNarrative product={product} /><OfferingDocuments product={product} /></div><Panel title="Offering review" description="Review the exact revision and document fingerprint."><CommandFeedback command={command} />{permitted ? <form className={styles.form} onSubmit={event => { event.preventDefault(); void command.submit('review_product', { product_id: product.id, expected_revision: product.revision, decision, notes, checks }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Review checks</legend>{([{ key: 'issuer', label: 'Fictional issuer and asset mandate reviewed' }, { key: 'terms', label: 'Economic and exit terms reviewed' }, { key: 'disclosures', label: 'All disclosures reviewed' }, { key: 'eligibility', label: 'Investor eligibility rules reviewed' }] as const).map(item => <label key={item.key} className={styles.check}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}<Field label="Decision"><select value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">Approve test offering</option><option value="CHANGES_REQUIRED">Request changes</option></select></Field><Field label="Review rationale"><textarea required minLength={20} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></Field><button type="submit" className={styles.button} disabled={decision === 'APPROVED' && !Object.values(checks).every(Boolean)}>Record offering decision</button></fieldset></form> : <Notice title="Independent decision required">{product.created_by === snapshot.actor.id ? 'You created this product and cannot approve it. A separate authorised reviewer must act.' : 'This product is not awaiting your review.'}</Notice>}</Panel></div>
}

export function SubscriptionForm({ product, snapshot, onSaved, operatingContext }: { product: PortalProduct; snapshot: PortalSnapshot; onSaved: (snapshot: PortalSnapshot) => void; operatingContext?: PortalOperatingContext }) {
  const [units, setUnits] = useState(product.terms.minimum_units)
  const [accountId, setAccountId] = useState('')
  const [acceptedDocuments, setAcceptedDocuments] = useState(false), [acceptedRisks, setAcceptedRisks] = useState(false)
  const command = usePortalCommand(onSaved)
  const approval = currentInvestorApplication(snapshot)
  const accounts = activeIndividualAccounts(snapshot)
  const selectedAccountId = accountId || accounts[0]?.id || ''
  const selectedAccount = accounts.find(account => account.id === selectedAccountId)
  const eligible = Boolean(approval && product.terms.eligible_countries.includes(approval.details.country) && product.terms.eligible_investor_types.includes(approval.details.investor_type))
  const quote = subscriptionQuote(product, units)
  return <Panel title="Subscribe to this offering" description="Acceptance reserves units. It does not move cash or issue tokens.">
    <CommandFeedback command={command} />
    {!approval ? <Notice title="Approved investor onboarding required" tone="warning">Complete your investor application and obtain a current independent test approval before subscribing.<p><Link href={portalScopeHref('/portal/onboarding', operatingContext)} className={styles.textLink}>Go to my onboarding</Link></p></Notice>
      : !eligible ? <Notice title="Eligibility does not match this offering" tone="warning">Your approved country or investor classification is outside this product’s published rules. No subscription can be submitted.</Notice>
        : !selectedAccount ? <div className={styles.stack}><Notice title="An active individual investment account is required">The subscription must identify the approved account that will hold the investment. Another person’s account or an entity relationship cannot be substituted.</Notice><InvestmentAccountPanel snapshot={snapshot} onSaved={onSaved} operatingContext={operatingContext} /></div>
          : <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!selectedAccount) return; void command.submit('subscribe', { product_id: product.id, investment_account_id: selectedAccount.id, expected_revision: product.revision, terms_hash: product.terms_hash, units, accepted_documents: acceptedDocuments, accepted_risks: acceptedRisks }) }}>
            <fieldset className={styles.fieldset} disabled={command.busy || command.unknown || product.status !== 'PUBLISHED'}>
              <legend>Subscription instruction</legend>
              <Field label="Investing account" hint="An approved individual account belonging to you."><select required value={selectedAccountId} onChange={event => setAccountId(event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>Individual · {account.id}</option>)}</select></Field>
              <Field label="Whole units" hint={`Minimum ${product.terms.minimum_units} units · ${money(product.terms.unit_price_minor)} per unit`}><input inputMode="numeric" required pattern="[1-9][0-9]*" value={units} onChange={event => setUnits(event.target.value)} /></Field>
              <DetailList rows={[{ label: 'Subscription value', value: 'amount_minor' in quote ? money(quote.amount_minor) : 'Enter a valid quantity' }, { label: 'Settlement', value: 'Synthetic ZAR_TEST only' }, { label: 'Accepted version', value: `Revision ${product.revision}` }]} />
              {'error' in quote ? <p className={styles.fieldError}>{quote.error}</p> : null}
              <label className={styles.check}><input type="checkbox" checked={acceptedDocuments} onChange={event => setAcceptedDocuments(event.target.checked)} required /><span>I have read and accept the offering memorandum and subscription agreement for revision {product.revision} and the displayed terms fingerprint.</span></label>
              <label className={styles.check}><input type="checkbox" checked={acceptedRisks} onChange={event => setAcceptedRisks(event.target.checked)} required /><span>I have read the risk disclosures. I understand this fictional test subscription is not funded, issued ownership or a real investment.</span></label>
              <button type="submit" className={styles.button} disabled={!acceptedDocuments || !acceptedRisks || 'error' in quote}>Accept terms and reserve units</button>
            </fieldset>
          </form>}
    <div className={styles.sectionGap}><Notice title="Funding comes next">The same saved instruction appears in your orders and the authorised issuer’s incoming orders as awaiting funding. Only verified settlement and confirmed issuance can create a holding.</Notice></div>
  </Panel>
}

export function SubscriptionCancel({ id, onSaved }: { id: string; onSaved: (snapshot: PortalSnapshot) => void }) {
  const command = usePortalCommand(onSaved)
  return <><CommandFeedback command={command} /><button type="button" className={styles.buttonSecondary} disabled={command.busy || command.unknown} onClick={() => { if (window.confirm('Cancel this unfunded test subscription and release its reserved units?')) void command.submit('cancel_subscription', { subscription_id: id }) }}>Cancel unfunded reservation</button></>
}
