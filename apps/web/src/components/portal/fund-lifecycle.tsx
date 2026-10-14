'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { Interface, TypedDataEncoder, verifyTypedData } from 'ethers'
import { CheckCircle2, Clock3, Circle, ShieldCheck } from 'lucide-react'
import { discoverMetaMask, MetaMaskWalletLink, type MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { fundIntentSchema, fundOperationSchema, fundPaymentIntentSchema, fundStageKeys, type FundLifecycleAction, type FundLifecycleOperation, type FundLifecycleSnapshot, type FundPaymentIntent, type FundProductLifecycle, type FundTransactionIntent } from '@/lib/portal/fund-lifecycle-contracts'
import { portalContextKey, portalContextMatches, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { prepareAmoyWalletTransaction, validateRecoveryNonce } from '@/lib/testnet-fund/wallet-transaction'
import { usePortalActorId, usePortalCommand, usePortalOperatingContext } from './portal-client'
import styles from './fund-lifecycle.module.css'

type Refresh = () => void | Promise<void>
type ActionsProps = { actorId: string; operatingContext: PortalOperatingContext; onRefresh: Refresh }
type ProductHandoff = { message: string; label: string; regionId: string; onSelect: () => void }
type Order = FundProductLifecycle['orders'][number]
const stageNames: Record<(typeof fundStageKeys)[number], string> = { PREPARATION: 'Prepare the fund', APPROVAL: 'Independent review', DEPLOYMENT: 'Deploy the contracts', OPENING: 'Open the offering', SUBSCRIPTION: 'Accept subscriptions', PAYMENT: 'Reconcile payment', ISSUANCE: 'Issue approved units', HOLDINGS: 'Record investor holdings' }
const stateNames: Record<string, string> = { COMPLETE: 'Complete', CURRENT: 'Current step', WAITING: 'Waiting on another owner', BLOCKED: 'Action unavailable', NOT_STARTED: 'Not started', REQUESTED: 'Request recorded', APPROVAL_PENDING: 'Independent approval needed', APPROVED: 'Approved; not executed', SIGNING: 'Signatures in progress', BROADCAST: 'Submitted; not final', MINED: 'Included in a block', CONFIRMING: 'Waiting for finality', FINAL: 'Final evidence recorded', REJECTED: 'Rejected', SIGNING_FAILED: 'Signing did not complete', UNKNOWN: 'Submission outcome uncertain', REPLACED: 'Transaction replaced', REVERTED: 'Transaction reverted', REORGED: 'Chain evidence changed', CANCELLED: 'Cancelled', EXPIRED: 'Approval expired', AWAITING_FUNDING: 'Awaiting payment', EVIDENCE_REVIEW: 'Payment evidence under review', PARTIAL: 'Partial payment; review needed', OVERPAID: 'Excess payment; review needed', RECONCILED: 'Reconciled', UNAPPLIED: 'Payment not applied', REVERSED: 'Accounting reversed; not refunded' }
const roleNames: Record<string, string> = { OfferingManager: 'Offering manager', IssuerFundManager: 'Issuer', ComplianceOfficer: 'Compliance', TokenisationAgent: 'Tokenisation agent', TreasuryOperator: 'Treasury', FinancialController: 'Financial controller', Investor: 'Investor', TransferAgent: 'Transfer agent', SuperAdmin: 'Platform administrator' }
const reasonNames: Record<string, string> = {
  DEPENDENCY_NOT_ADMITTED: 'The reviewed contract release and signing policy are not admitted yet.',
  CANONICAL_DEPLOYMENT_NOT_ADMITTED: 'The contract release and institutional signing policy must be admitted for this fund before deployment can be requested.',
  CURRENT_REVIEW_AND_SIGNATURE_REQUIRED: 'The current offering needs its appointed issuer review, Compliance review and document signatures before deployment can proceed.',
  GOVERNED_DEPLOYMENT_REQUIRED: 'The approved fund must be deployed by its appointed institutional signers through MetaMask, then independently verified before it can open.',
  CURRENT_SIGNING_AUTHORITY_REQUIRED: 'This request needs current appointed signing authority. A role label or connected wallet alone is not enough.',
  EXISTING_TRANSACTION_HASH_REQUIRED: 'Use the hash of the existing transaction so its outcome can be checked. Do not submit a replacement transaction.',
  RECONCILED_PAYMENT_AND_WALLET_REQUIRED: 'Payment must be independently reconciled and the investor delivery wallet verified before allocation can be prepared.',
  CURRENT_INDEPENDENT_ALLOCATION_REVIEW_REQUIRED: 'A currently appointed Transfer Agent, independent of the requester, must review this exact allocation.',
  CURRENT_ISSUANCE_AUTHORITY_REQUIRED: 'Current appointed issuance authority and a valid approved allocation are required before an issuance request can be made.',
  REASON_REQUIRED: 'Cancellation requires a recorded reason and an authorised request; no cancellation has been performed.',
  CANCELLED_BEFORE_SIGNING: 'This operation was cancelled before signing. No completed contract action is implied.',
  EXECUTION_CLAIMED_OUTCOME_UNKNOWN: 'Execution was started, but its outcome is not yet verified. Check the original transaction before trying anything else.',
  VERIFIED_TRANSACTION_REVERTED: 'The transaction reverted. No successful deployment or issuance was recorded from it.',
  FINAL_EFFECT_AUTHORITY_CHANGED_RECOVERY_REQUIRED: 'Authority changed while this transaction was being checked. The existing operation needs recovery review before its effects can be accepted.',
  TECHNICAL_READINESS_NOT_VERIFIED: 'Contract readiness must be independently verified before the offering can open.',
  WALLET_PROOF_REQUIRED: 'The account holder must verify a delivery wallet before units can be issued.',
  FUNDING_NOT_RECONCILED: 'Treasury and an independent controller must reconcile payment first.',
  INDEPENDENT_APPROVAL_REQUIRED: 'A different authorised person must review this exact request.',
  PREPARATION_REQUIRED: 'Prepare the exact contract intent for a different authorised person to review. No signature is needed for preparation.',
  SAFE_SIGNATURE_REQUIRED: 'An authorised Safe owner must sign the approved contract operation.',
  UNKNOWN_BROADCAST: 'Check the existing transaction before taking any further action.',
}
function reason(code: string | null) { return code ? reasonNames[code] ?? 'The current record has an unresolved requirement. Refresh saved state or contact its responsible owner.' : null }
function label(state: string) { return stateNames[state] ?? state.replaceAll('_', ' ').toLowerCase() }
function units(value: string, decimals: number) {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return 'Not available'
  const base = BigInt(value), scale = 10n ** BigInt(decimals)
  const whole = (base / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (base % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
function date(value: string) { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeZone: 'Africa/Johannesburg' }).format(new Date(value)) : 'Not recorded' }
function fundHref(id: string, context: PortalOperatingContext) { return portalScopeHref(context.mode === 'APPLICANT' || context.role === 'Investor' ? '/portal/opportunities/detail' : '/portal/products/detail', context, id) }
function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) { return <section className={styles.card}><header className={styles.cardHeader}><h2>{title}</h2>{note ? <p>{note}</p> : null}</header><div className={styles.cardBody}>{children}</div></section> }
function Status({ state }: { state: string }) { return <span className={styles.status} data-state={state}>{label(state)}</span> }
function Fact({ title, value }: { title: string; value: ReactNode }) { return <div className={styles.fact}><dt>{title}</dt><dd>{value}</dd></div> }
function Address({ value }: { value: string }) { return <span className={styles.address}>{value}</span> }
function Unavailable({ children }: { children?: ReactNode }) { return <div className={styles.notice} role="status"><strong>Saved fund records are unavailable</strong><p>{children ?? 'Refresh the hosted workspace. No payment, contract deployment or holdings have been inferred.'}</p></div> }

function ActionButton({ action, actorId, operatingContext, onRefresh, primary = false }: ActionsProps & { action: FundLifecycleAction; primary?: boolean }) {
  const currentActor = usePortalActorId(), currentContext = usePortalOperatingContext()
  const command = usePortalCommand(() => { void onRefresh() })
  const sameContext = currentActor === actorId && portalContextMatches(currentContext, operatingContext)
  if (!action.command || !action.payload || action.command === 'record_fund_transaction' || action.command === 'bind_fund_delivery_wallet') return null
  return <div className={styles.actionBlock}><button type="button" className={primary ? styles.primary : styles.secondary} disabled={!sameContext || !action.can_execute || command.busy || command.unknown} onClick={() => { if (action.command && action.payload) void command.submit(action.command, action.payload) }}>{command.busy ? 'Saving the original request…' : action.label}</button>
    {command.message ? <p className={styles.feedback} role="status" aria-live="polite">{command.message}</p> : null}
    {command.unknown ? <div className={styles.notice}><p>The saved request is unresolved. Do not start a replacement.</p><button type="button" className={styles.secondary} disabled={command.busy} onClick={() => void command.retry()}>Check using the original request key</button></div> : null}
  </div>
}

function NextAction({ lifecycle, handoff, ...props }: ActionsProps & { lifecycle: FundProductLifecycle; handoff?: ProductHandoff }) {
  const action = lifecycle.next_action
  const stage = lifecycle.stages.find(item => item.state === 'CURRENT' || item.state === 'BLOCKED' || item.state === 'WAITING')
  const reasonCode = action?.reason_code ?? stage?.reason_code ?? null
  // Package navigation belongs only to preparation/review. Stale appointments
  // must never replace an execution, payment or recovery instruction.
  const currentHandoff = stage && ['PREPARATION', 'APPROVAL'].includes(stage.key) && !action?.command
    && (reasonCode === null || reasonCode === 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED') ? handoff : undefined
  const explanation = currentHandoff?.message ?? (reasonCode === 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED' && stage?.key === 'PREPARATION'
    ? 'Complete and save the fund details, then submit that saved version for its appointed reviews and document signing.'
    : reason(reasonCode) ?? stage?.description ?? 'Only independently verified evidence moves the fund to its next stage.')
  return <section className={styles.nextAction} aria-label="Next fund action"><div><p className={styles.eyebrow}>{action?.can_execute ? 'Your next action' : 'What happens next'}</p><h2>{action?.label ?? (stage ? stageNames[stage.key] : 'Review the saved fund record')}</h2><p>{explanation}</p><p className={styles.owner}>Responsible owner: {roleNames[action?.owner_role ?? stage?.owner_role ?? ''] ?? action?.owner_role ?? stage?.owner_role ?? 'No current action'}</p></div><div className={styles.actionBlock}>{action?.command ? <ActionButton action={action} {...props} primary /> : currentHandoff ? <button type="button" className={styles.secondary} aria-controls={currentHandoff.regionId} onClick={currentHandoff.onSelect}>{currentHandoff.label}</button> : <button type="button" className={styles.secondary} onClick={() => void props.onRefresh()}>Refresh saved state</button>}</div></section>
}

function StageProgress({ lifecycle }: { lifecycle: FundProductLifecycle }) {
  return <ol className={styles.stages} aria-label="Fund launch progress">{fundStageKeys.map((key, index) => {
    const stage = lifecycle.stages.find(item => item.key === key)
    const Icon = stage?.state === 'COMPLETE' ? CheckCircle2 : stage?.state === 'CURRENT' || stage?.state === 'WAITING' ? Clock3 : Circle
    return <li key={key} aria-current={stage?.state === 'CURRENT' ? 'step' : undefined} data-state={stage?.state ?? 'NOT_STARTED'}><div className={styles.stageTop}><span>{index + 1}</span><Icon size={18} aria-hidden="true" /></div><h3>{stageNames[key]}</h3><p>{label(stage?.state ?? 'NOT_STARTED')}</p></li>
  })}</ol>
}

function OperationCard({ operation, lifecycle, ...props }: ActionsProps & { operation: FundLifecycleOperation; lifecycle: FundProductLifecycle }) {
  return <article className={styles.operation}><div className={styles.rowHeading}><h3>{operation.kind === 'DEPLOYMENT' ? 'Contract deployment' : 'Approved unit issuance'}</h3><Status state={operation.state} /></div><p>{operation.kind === 'DEPLOYMENT' ? 'The approved fund configuration must match the deployed contract and governed signer policy.' : 'Issuance must match reconciled payment, the approved allocation and the current delivery wallet.'}</p>
    <dl className={styles.facts}><Fact title="Network" value={`Chain ${operation.chain_id}`} /><Fact title="Finality" value={operation.confirmations === null ? 'Not observed' : `${operation.confirmations} of ${operation.required_confirmations} required confirmations`} /><Fact title="Contract" value={operation.token_address ? <Address value={operation.token_address} /> : 'Not verified'} /><Fact title="Transaction" value={operation.transaction_hash ? <Address value={operation.transaction_hash} /> : 'No broadcast recorded'} /></dl>
    {reason(operation.reason_code) ? <p className={styles.warning}>{reason(operation.reason_code)}</p> : null}
    <div className={styles.actions}>{operation.actions.filter(action => action.command !== 'record_fund_transaction').map(action => <ActionButton key={action.action_id} action={action} {...props} />)}</div>
    <SafeOperationControl operation={operation} lifecycle={lifecycle} {...props} />
  </article>
}

export function FundLifecycleWorkspace({ lifecycle, actorId, operatingContext, onRefresh, showTitle = true, handoff }: ActionsProps & { lifecycle: FundProductLifecycle | null | undefined; showTitle?: boolean; handoff?: ProductHandoff }) {
  if (!lifecycle) return <div className={styles.workspace}><Unavailable /></div>
  return <div className={styles.workspace}><div className={styles.heading}>{showTitle ? <div><p className={styles.eyebrow}>Fund operating record</p><h2>{lifecycle.product_name}</h2><p>Track this fund from preparation to investor holdings.</p></div> : <span>Fund progress</span>}<button type="button" className={styles.secondary} onClick={() => void onRefresh()}>Refresh status</button></div>
    <NextAction lifecycle={lifecycle} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} handoff={handoff} />
    {lifecycle.availability === 'DEPENDENCY_NOT_ADMITTED' ? <div className={styles.notice}><strong>Contracts are not admitted for execution</strong><p>The canonical release, network manifest and independent signing policy must be approved. A saved package does not enable a new deployment, opening or issuance; any historical evidence remains a separate record.</p></div> : null}
    <StageProgress lifecycle={lifecycle} />
    <Card title="Contract and issuance evidence" note="Requests, approvals and broadcasts remain separate from final chain evidence.">{lifecycle.operations.length ? <div className={styles.stack}>{lifecycle.operations.map(operation => <OperationCard key={`${operation.id}:${operation.revision}`} operation={operation} lifecycle={lifecycle} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} />)}</div> : <p className={styles.muted}>No deployment or issuance operation has been recorded. No contract or token ownership is inferred.</p>}</Card>
    <Card title="Subscription handoffs" note="Open the same saved order for payment, allocation and issuance.">{lifecycle.orders.length ? <ul className={styles.queue}>{lifecycle.orders.map(order => <li key={order.subscription_id}><div><h3>{units(order.units_base, order.security_unit_decimals)} requested units</h3><p>{order.funding ? label(order.funding.state) : 'No approved payment instruction'} · {order.delivery_wallet?.effective ? 'Delivery wallet verified' : 'Delivery wallet still required'}</p></div><Link className={styles.secondary} href={portalScopeHref('/portal/orders/detail', operatingContext, order.subscription_id)}>Open saved order</Link></li>)}</ul> : <p className={styles.muted}>No subscription handoff is recorded for this fund.</p>}</Card>
    <p className={styles.boundary}>Fund launch stops at registered holdings. Servicing, distributions and exit require their own approved records; no investment performance is implied here.</p>
  </div>
}

export function fundAttentionTask(product: FundProductLifecycle, context: PortalOperatingContext) {
  const tasks: { action: FundLifecycleAction; href: string; kind: 'fund' | 'order' }[] = []
  const fundLink = fundHref(product.product_id, context)
  for (const action of product.actions) tasks.push({ action, href: fundLink, kind: 'fund' })
  for (const operation of product.operations) {
    const order = product.orders.find(item => item.subscription_id === operation.subscription_id && item.issuance_operation_id === operation.id)
    for (const action of operation.actions) tasks.push({ action,
      href: order ? portalScopeHref('/portal/orders/detail', context, order.subscription_id) : fundLink,
      kind: order ? 'order' : 'fund' })
  }
  for (const order of product.orders) for (const action of order.actions) {
    tasks.push({ action, href: portalScopeHref('/portal/orders/detail', context, order.subscription_id), kind: 'order' })
  }
  // The backend's current-context permission is authoritative. owner_role is
  // handoff wording, not a second role gate. Resolve only contained records;
  // an allocation or wallet proof ID must never become a guessed order URL.
  const preferred = product.next_action
  return tasks.find(task => task.action.can_execute && preferred !== null && task.action.action_id === preferred.action_id
    && task.action.record_id === preferred.record_id) ?? tasks.find(task => task.action.can_execute) ?? null
}

export function FundLifecycleDashboard({ snapshot, role, actorId, operatingContext, onRefresh }: ActionsProps & { snapshot: FundLifecycleSnapshot | null | undefined; role?: string | null }) {
  if (!snapshot || snapshot.actor_id !== actorId || !portalContextMatches(snapshot.operating_context, operatingContext) || snapshot.availability !== 'AVAILABLE') return <div className={styles.workspace}><Unavailable /></div>
  const tasks = snapshot.products.map(product => ({ product, task: fundAttentionTask(product, operatingContext) }))
  const actionable = tasks.filter(item => item.task !== null)
  const waiting = tasks.filter(item => item.task === null).map(item => item.product)
  const positions = snapshot.products.reduce((count, product) => count + product.holdings.length, 0)
  return <div className={styles.workspace}><div className={styles.heading}><div><p className={styles.eyebrow}>Your fund handoffs</p><h2>{roleNames[role ?? ''] ?? 'Fund workspace'}</h2><p>Current record permissions decide what you can act on. A role label does not grant transaction authority.</p></div><button type="button" className={styles.secondary} onClick={() => void onRefresh()}>Refresh saved state</button></div>
    <dl className={styles.summary}><Fact title="Funds visible in this context" value={snapshot.products.length} /><Fact title="Funds with an available action" value={actionable.length} /><Fact title="Reconciled position records" value={positions} /></dl>
    <Card title="Needs your attention">{actionable.length ? <ul className={styles.queue}>{actionable.map(({ product, task }) => task ? <li key={product.product_id}><div><h3>{product.product_name}</h3><p>{task.action.label}</p></div><Link className={styles.secondary} href={task.href}>{task.kind === 'order' ? 'Open subscription' : 'Open fund record'}</Link></li> : null)}</ul> : <p className={styles.muted}>There is no currently permitted fund action in this context. This does not mean the funds are complete.</p>}</Card>
    {waiting.length ? <Card title="Waiting on the next owner"><ul className={styles.queue}>{waiting.map(product => <li key={product.product_id}><div><h3>{product.product_name}</h3><p>{product.next_action?.label ?? 'Review the current stage'} · {roleNames[product.next_action?.owner_role ?? ''] ?? product.next_action?.owner_role ?? 'No current owner action'}</p></div><Link className={styles.secondary} href={fundHref(product.product_id, operatingContext)}>View fund progress</Link></li>)}</ul></Card> : null}
    <p className={styles.boundary}>Updated from saved evidence on {date(snapshot.observed_at)}. {snapshot.environment === 'TESTNET' ? 'TEST assets have no investment value.' : 'Production execution is not activated by this view.'}</p>
  </div>
}

export function FundLifecyclePortfolio({ snapshot, operatingContext }: { snapshot: FundLifecycleSnapshot | null | undefined; operatingContext: PortalOperatingContext }) {
  if (!snapshot || !portalContextMatches(snapshot.operating_context, operatingContext) || snapshot.availability !== 'AVAILABLE') return <div className={styles.workspace}><Unavailable /></div>
  const holdings = snapshot.products.flatMap(product => product.holdings)
  return <div className={styles.workspace}><Card title="Your reconciled fund holdings" note="Only final issuance with a linked register entry appears here.">{holdings.length ? <div className={styles.holdings}>{holdings.map(holding => <article className={styles.operation} key={holding.id}><div className={styles.rowHeading}><h3>{holding.product_name}</h3><span className={styles.verified}><ShieldCheck size={18} aria-hidden="true" /> Reconciled holding</span></div><dl className={styles.facts}><Fact title={holding.class_name} value={`${units(holding.units_base, holding.security_unit_decimals)} units`} /><Fact title="Recorded" value={date(holding.recorded_at)} /><Fact title="Delivery wallet" value={<Address value={holding.wallet_address} />} /><Fact title="Reviewed valuation" value={holding.valuation ? `${units(holding.valuation.amount_base, holding.valuation.decimals)} ${holding.valuation.currency} · ${date(holding.valuation.as_of)}` : 'No reviewed valuation recorded'} /></dl><Link className={styles.secondary} href={portalScopeHref('/portal/orders/detail', operatingContext, holding.subscription_id)}>View issuance and register evidence</Link></article>)}</div> : <div className={styles.empty}><h3>No reconciled holdings are recorded</h3><p>A reservation, payment or signature is not a holding. Your units appear only after confirmed issuance and register reconciliation.</p><Link href={portalScopeHref('/portal/opportunities', operatingContext)} className={styles.secondary}>Browse approved offerings</Link></div>}</Card><p className={styles.boundary}>No price movements, returns or investment performance are manufactured from token balances.</p></div>
}

export function FundLifecycleOrder({ lifecycle, subscriptionId, actorId, operatingContext, onRefresh }: ActionsProps & { lifecycle: FundProductLifecycle | null | undefined; subscriptionId: string }) {
  const order = lifecycle?.orders.find(item => item.subscription_id === subscriptionId)
  if (!lifecycle || !order) return <div className={styles.workspace}><Unavailable>No verified fund handoff was returned for this saved order. Refresh before sending funds or requesting issuance.</Unavailable></div>
  const operation = lifecycle.operations.find(item => item.id === order.issuance_operation_id)
  const holding = lifecycle.holdings.find(item => item.subscription_id === subscriptionId)
  return <div className={styles.workspace}><div className={styles.heading}><div><p className={styles.eyebrow}>Saved fund order</p><h2>{lifecycle.product_name}</h2><p>This order stays linked to its accepted offering, investment account and final register record.</p></div><Link className={styles.secondary} href={fundHref(lifecycle.product_id, operatingContext)}>View fund progress</Link></div>
    <dl className={styles.summary}><Fact title="Requested units" value={units(order.units_base, order.security_unit_decimals)} /><Fact title="Payment" value={order.funding ? label(order.funding.state) : 'No approved instruction'} /><Fact title="Ownership" value={holding ? 'Reconciled holding recorded' : 'No holding recorded'} /></dl>
    <Card title="Pay the approved TST instruction" note="A test-token transfer, reconciliation and unit issuance are separate steps.">{order.funding ? <><dl className={styles.facts}><Fact title="Required test tokens" value={`${units(order.funding.required_base_units, order.funding.settlement_decimals)} TST`} /><Fact title="Independently posted" value={`${units(order.funding.posted_base_units, order.funding.settlement_decimals)} TST`} /><Fact title="Approved token contract" value={<Address value={order.funding.settlement_token_address} />} /><Fact title="Approved beneficiary" value={<Address value={order.funding.beneficiary_address} />} /></dl><PaymentControl order={order} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} /></> : <p className={styles.muted}>Treasury must prepare an approved route before a payment can be requested. Do not transfer tokens yet.</p>}</Card>
    <Card title="Delivery wallet and allocation"><p>{order.delivery_wallet?.effective ? <>Verified delivery wallet: <Address value={order.delivery_wallet.address} /></> : 'Choose the wallet that will receive your fund units.'}</p>
      {operatingContext.mode === 'APPLICANT' || operatingContext.role === 'Investor' ? <DeliveryWalletControl lifecycle={lifecycle} order={order} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} /> : null}
      <p className={styles.muted}>{order.allocation_id ? 'The saved allocation and its approval are shown below.' : 'The issuer reviews your allocation after payment is reconciled.'}</p><div className={styles.actions}>{order.actions.map(action => <ActionButton key={action.action_id} action={action} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} />)}</div></Card>
    {operation ? <Card title="Issuance handoff"><OperationCard operation={operation} lifecycle={lifecycle} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} /></Card> : <Card title="Issuance handoff"><p className={styles.muted}>No issuance operation is recorded. Reconciled payment is not token ownership.</p></Card>}
    {holding ? <Card title="Register and holdings"><p className={styles.verified}><ShieldCheck aria-hidden="true" size={20} /> {units(holding.units_base, holding.security_unit_decimals)} units reconciled to the saved register entry.</p><p>Recorded on {date(holding.recorded_at)} from chain {holding.chain_id}. The issuance transaction is retained in the evidence above.</p></Card> : null}
  </div>
}

const walletContextSchema = z.object({ organisation: z.object({ id: z.string().uuid(), name: z.string().min(1).max(200) }),
  wallets: z.array(z.object({ id: z.string().uuid(), organisationId: z.string().uuid(), address: z.string().regex(/^0x[0-9a-f]{40}$/i),
    chainId: z.literal(80002), verifiedAt: z.string(), status: z.literal('PENDING') })).max(100), configured: z.boolean() })
function DeliveryWalletControl({ lifecycle, order, actorId, operatingContext, onRefresh }: ActionsProps & { lifecycle: FundProductLifecycle; order: Order }) {
  const [context, setContext] = useState<z.infer<typeof walletContextSchema> | null>(null), [message, setMessage] = useState(''), [loading, setLoading] = useState(false)
  const identity = `${actorId}:${portalContextKey(operatingContext)}:${lifecycle.product_id}:${order.investment_account_id}`
  const current = useRef<string | null>(identity); current.current = identity
  const command = usePortalCommand(() => { void onRefresh() })
  async function load(signal?: AbortSignal) {
    const attempted = identity; setLoading(true); setMessage('')
    try {
      const response = await fetch('/api/wallet/context', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-bx1-expected-actor': actorId },
        body: new URLSearchParams({ organisationId: lifecycle.native_organisation_id }), signal: signal ?? AbortSignal.timeout(10000) })
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null
      if (!response.ok || result?.ok !== true) throw new Error('Wallet verification is unavailable for this account. Refresh or contact support; no wallet action was authorised.')
      const saved = walletContextSchema.parse(result.context)
      if (saved.organisation.id !== lifecycle.native_organisation_id || saved.wallets.some(wallet => wallet.organisationId !== saved.organisation.id)) throw new Error('Wallet records do not match this fund’s issuer scope.')
      if (current.current !== attempted || signal?.aborted) return
      setContext(saved)
    } catch (error) {
      if (current.current !== attempted || signal?.aborted) return
      setContext(null); setMessage(error instanceof Error ? error.message : 'Wallet records could not be loaded.')
    } finally { if (current.current === attempted && !signal?.aborted) setLoading(false) }
  }
  useEffect(() => { const controller = new AbortController(); current.current = identity; void load(controller.signal)
    return () => { controller.abort(); current.current = null } }, [identity])
  return <div className={styles.form}>
    {loading ? <p role="status">Loading your verified wallets…</p> : null}
    {context ? <MetaMaskWalletLink appearance="portal" organisations={[context.organisation]} wallets={context.wallets} configured={context.configured} expectedActorId={actorId}
      onRefresh={() => { void load(); void onRefresh() }} /> : null}
    {context?.wallets.map(wallet => {
      const action = order.actions.find(item => item.command === 'bind_fund_delivery_wallet' && item.can_execute && item.payload?.wallet_proof_id === wallet.id)
      if (!action?.payload) return null
      const payload = action.payload
      return <div key={wallet.id}><p>Receive fund units at <Address value={wallet.address} /></p><button type="button" className={styles.secondary} disabled={command.busy || command.unknown}
        onClick={() => void command.submit('bind_fund_delivery_wallet', payload)}>Use this verified wallet for this fund</button></div>
    })}
    {message ? <p role="status" className={styles.feedback}>{message}</p> : null}
    {command.message ? <p role="status" className={styles.feedback}>{command.message}</p> : null}
    {command.unknown ? <button type="button" className={styles.secondary} disabled={command.busy} onClick={() => void command.retry()}>Check the original wallet-binding request</button> : null}
    <button type="button" className={styles.secondary} disabled={loading} onClick={() => void load()}>Refresh verified wallets</button>
  </div>
}

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const executionSchema = z.object({ from: evmAddress, to: evmAddress, data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/), value: z.literal('0x0'), chain_id: z.number().int().positive(), operation_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict()
type Execution = z.infer<typeof executionSchema>
const safeTypes = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }
const safeInterface = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool success)'])
const transferInterface = new Interface(['function transfer(address to,uint256 value) returns (bool)'])
type BroadcastMarker = { intentId: string; hash: string | null; unknown: boolean }
function pendingKey(actorId: string, context: PortalOperatingContext, kind: string, recordId: string) { return `bx1-fund:${actorId}:${portalContextKey(context)}:${kind}:${recordId}` }
function readBroadcast(key: string): BroadcastMarker | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const parsed = z.object({ intentId: z.string().uuid(), hash: txHash.nullable(), unknown: z.boolean() }).strict().safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error('The saved transaction marker cannot be read. Check the existing transaction with the operator; do not send a replacement.')
  return parsed.data
}
function saveBroadcast(key: string, marker: BroadcastMarker) { localStorage.setItem(key, JSON.stringify(marker)) }
function walletError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 4001) return 'The request was cancelled in MetaMask. Refresh the saved record before continuing.'
  return error instanceof Error ? error.message : 'The request outcome could not be confirmed. Check saved state before continuing.'
}

async function lifecyclePost(path: string, payload: Record<string, unknown>, actorId: string, context: PortalOperatingContext, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId }, body: JSON.stringify({ ...payload, operating_context: context }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) })
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new Error('The hosted handoff did not confirm its outcome. Refresh saved state; no replacement transaction is authorised.')
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The hosted handoff returned an invalid record. Refresh saved state.')
  const body = result as Record<string, unknown>
  if (!response.ok || body.error) throw new Error(typeof body.error === 'string' ? body.error : 'This handoff is not currently admitted. Refresh saved state or contact its responsible owner.')
  return body
}

function useFundWallet(actorId: string, context: PortalOperatingContext) {
  const actor = usePortalActorId(), activeContext = usePortalOperatingContext()
  const [choices, setChoices] = useState<{ id: string; provider: MetaMaskProvider }[]>([])
  const [selectedId, setSelectedId] = useState(''), [account, setAccount] = useState(''), [message, setMessage] = useState(''), [monitored, setMonitored] = useState(false), [connecting, setConnecting] = useState(false)
  const generation = useRef(0), alive = useRef(false), abort = useRef<AbortController | null>(null), connectLock = useRef(false)
  const identity = `${actorId}:${portalContextKey(context)}`
  const provider = choices.find(choice => choice.id === (selectedId || (choices.length === 1 ? choices[0].id : '')))?.provider ?? null
  const authorizedContext = actorId === actor && portalContextMatches(activeContext, context)
  useEffect(() => { alive.current = true; const stop = discoverMetaMask(window, choice => setChoices(current => current.some(item => item.id === choice.id) ? current : [...current, choice])); return () => { alive.current = false; generation.current++; abort.current?.abort(); stop() } }, [])
  useEffect(() => {
    generation.current++; abort.current?.abort(); setAccount(''); setMonitored(false)
    if (!provider) return
    const changed = () => { generation.current++; abort.current?.abort(); setAccount(''); setMessage('The wallet account, network or connection changed. This page stopped the pending handoff. Dismiss any open MetaMask request before reconnecting. If already submitted, check its original transaction; do not send another.') }
    const events = ['accountsChanged', 'chainChanged', 'disconnect']
    try { events.forEach(event => provider.on(event, changed)); setMonitored(true) } catch { events.forEach(event => { try { provider.removeListener(event, changed) } catch { /* Failed monitoring remains unavailable. */ } }); setMessage('MetaMask account and network changes could not be monitored safely. Reload the workspace.'); return }
    return () => { events.forEach(event => { try { provider.removeListener(event, changed) } catch { /* Generation guards remain authoritative for this UI attempt. */ } }) }
  }, [provider, identity, authorizedContext])
  const begin = () => { if (!provider || !authorizedContext || !monitored) throw new Error('Reconnect a safely monitored MetaMask provider in your current signed-in capacity.'); abort.current?.abort(); const controller = new AbortController(); abort.current = controller; const attempt = generation.current; return { provider, signal: controller.signal, current: () => alive.current && generation.current === attempt && !controller.signal.aborted } }
  async function check(selected: MetaMaskProvider, expectedAccount: string, chain: number, current: () => boolean) {
    const accounts = await selected.request({ method: 'eth_accounts' }), network = await selected.request({ method: 'eth_chainId' })
    if (!current()) throw new Error('This handoff was cancelled because its wallet or account context changed.')
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== expectedAccount.toLowerCase()) throw new Error('Select the exact authorised wallet shown in this request, then reconnect.')
    if (typeof network !== 'string' || !/^0x[0-9a-f]+$/i.test(network) || BigInt(network) !== BigInt(chain)) throw new Error(`Select chain ${chain} in MetaMask, then reconnect. The platform does not change networks automatically.`)
  }
  async function connect(chain: number) {
    if (connectLock.current) return
    connectLock.current = true; setConnecting(true)
    try {
      const attempt = begin()
      const accounts = await attempt.provider.request({ method: 'eth_requestAccounts' })
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !evmAddress.safeParse(accounts[0]).success || /^0x0{40}$/i.test(accounts[0])) throw new Error('Select a valid account in MetaMask.')
      await check(attempt.provider, accounts[0], chain, attempt.current)
      if (attempt.current()) { setAccount(accounts[0].toLowerCase()); setMessage('MetaMask is connected. No signature or transaction has been requested.') }
    } finally { connectLock.current = false; if (alive.current) setConnecting(false) }
  }
  return { choices, selectedId, setSelectedId, account, message, setMessage, provider, authorizedContext, monitored, connecting, begin, check, connect }
}
function WalletPicker({ wallet, chainId, busy }: { wallet: ReturnType<typeof useFundWallet>; chainId: number; busy: boolean }) {
  return <div className={styles.form}>{wallet.choices.length > 1 ? <label className={styles.field}>MetaMask provider<select value={wallet.selectedId} disabled={busy || wallet.connecting} onChange={event => wallet.setSelectedId(event.target.value)}><option value="">Select MetaMask</option>{wallet.choices.map((choice, index) => <option key={choice.id} value={choice.id}>MetaMask {index + 1}</option>)}</select></label> : null}
    {!wallet.choices.length ? <p className={styles.muted}>Open this fund record in a MetaMask-enabled browser. Never share a private key or recovery phrase.</p> : null}
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || wallet.connecting || !wallet.provider || !wallet.authorizedContext || !wallet.monitored} onClick={() => void wallet.connect(chainId).catch(error => wallet.setMessage(walletError(error)))}>{wallet.connecting ? 'Waiting for MetaMask connection…' : `Connect MetaMask on chain ${chainId}`}</button>{wallet.account ? <p>Connected wallet: <Address value={wallet.account} /></p> : null}</div>
    {wallet.message ? <p className={styles.feedback} role="status" aria-live="polite">{wallet.message}</p> : null}
  </div>
}
function checkedIntent(raw: unknown, operation: FundLifecycleOperation, leasedRevision?: number): FundTransactionIntent {
  const intent = fundIntentSchema.parse(raw)
  // The immutable intent version does not change when resource approvals increment revision.
  const permittedState = ['APPROVED', 'SIGNING'].includes(operation.state) || operation.state === 'UNKNOWN' && operation.revision === leasedRevision
  if (!permittedState || intent.operation_id !== operation.id || intent.kind !== operation.kind || intent.chain_id !== operation.chain_id || intent.intent_hash !== operation.intent_hash || intent.safe_transaction.to.toLowerCase() !== intent.target_address.toLowerCase() || intent.safe_transaction.data.toLowerCase() !== intent.transaction_data.toLowerCase() || Date.parse(intent.expires_at) <= Date.now()) throw new Error('The prepared intent no longer matches this approved operation. Refresh; nothing was signed.')
  const actualHash = TypedDataEncoder.hash({ chainId: intent.chain_id, verifyingContract: intent.execution_account }, safeTypes, intent.safe_transaction).slice(2)
  if (actualHash !== intent.intent_hash) throw new Error('The Safe typed-data hash does not match the approved intent. Signing is unavailable.')
  return intent
}
function checkExecution(execution: Execution, intent: FundTransactionIntent, expectedRevision: number) {
  if (execution.operation_id !== intent.operation_id || execution.expected_revision !== expectedRevision || execution.chain_id !== intent.chain_id || execution.from.toLowerCase() !== intent.signer_address.toLowerCase() || execution.to.toLowerCase() !== intent.execution_account.toLowerCase()) throw new Error('The prepared Safe execution does not match this authorised signer and operation.')
  const decoded = safeInterface.decodeFunctionData('execTransaction', execution.data), tx = intent.safe_transaction
  if (String(decoded.to).toLowerCase() !== tx.to.toLowerCase() || BigInt(decoded.value) !== 0n || String(decoded.data).toLowerCase() !== tx.data.toLowerCase() || BigInt(decoded.operation) !== 0n || BigInt(decoded.safeTxGas) !== BigInt(tx.safeTxGas) || BigInt(decoded.baseGas) !== BigInt(tx.baseGas) || BigInt(decoded.gasPrice) !== BigInt(tx.gasPrice) || String(decoded.gasToken).toLowerCase() !== tx.gasToken.toLowerCase() || String(decoded.refundReceiver).toLowerCase() !== tx.refundReceiver.toLowerCase() || !/^0x(?:[0-9a-f]{130})+$/i.test(String(decoded.signatures))) throw new Error('The Safe execution payload differs from the reviewed intent. Nothing was sent.')
}

function SafeOperationControl({ operation, lifecycle, actorId, operatingContext, onRefresh }: ActionsProps & { operation: FundLifecycleOperation; lifecycle: FundProductLifecycle }) {
  const wallet = useFundWallet(actorId, operatingContext)
  const [busy, setBusy] = useState(false), [intent, setIntent] = useState<FundTransactionIntent | null>(null), [execution, setExecution] = useState<Execution | null>(null), [signingOwner, setSigningOwner] = useState('')
  const [executionOperation, setExecutionOperation] = useState<FundLifecycleOperation | null>(null)
  const [reviewed, setReviewed] = useState(false), [hash, setHash] = useState(operation.transaction_hash ?? ''), [pending, setPending] = useState(false), [ready, setReady] = useState(false)
  const lock = useRef(false), operationRef = useRef(operation); operationRef.current = operation
  const command = usePortalCommand(() => { void onRefresh() })
  const key = pendingKey(actorId, operatingContext, 'operation', operation.id)
  useEffect(() => { try { const marker = readBroadcast(key); setPending(Boolean(marker)); if (marker?.hash) setHash(marker.hash); setReady(true) } catch (error) { setPending(true); wallet.setMessage(walletError(error)) } }, [key])
  useEffect(() => { setIntent(null); setExecution(null); setExecutionOperation(null); setSigningOwner(''); setReviewed(false) }, [wallet.account, wallet.provider, operation.revision, operation.state])
  // This delivery enables the selected TEST rail only; displaying a MAIN record never activates signing.
  const canPrepareReview = lifecycle.availability === 'AVAILABLE' && operation.chain_id === 80002 && operation.state === 'REQUESTED' && operation.actions.some(action => action.can_execute && action.command === null && action.reason_code === 'PREPARATION_REQUIRED')
  const signable = lifecycle.availability === 'AVAILABLE' && operation.chain_id === 80002 && ['APPROVED', 'SIGNING'].includes(operation.state) && operation.actions.some(action => action.can_execute && action.command === null && action.reason_code === 'SAFE_SIGNATURE_REQUIRED') && !pending && ready
  const canExecute = signable && Boolean(operation.intent && operation.signing_owner_address && operation.signer_threshold
    && (operation.signature_count ?? 0) >= operation.signer_threshold && operation.signing_owner_address.toLowerCase() === operation.intent.signer_address.toLowerCase())
  async function run(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); wallet.setMessage(''); try { await action() } catch (error) { wallet.setMessage(walletError(error)) } finally { lock.current = false; setBusy(false) } }
  async function prepare() {
    if (canPrepareReview) {
      if (!wallet.authorizedContext) throw new Error('Refresh your signed-in capacity before preparing an intent.')
      const result = await lifecyclePost('/api/portal/fund-lifecycle/transaction', { operation_id: operation.id, expected_revision: operation.revision }, actorId, operatingContext)
      const saved = fundOperationSchema.parse(result.operation)
      if (saved.id !== operation.id || saved.product_id !== lifecycle.product_id || saved.revision <= operation.revision || saved.state !== 'APPROVAL_PENDING') throw new Error('An independently reviewable intent was not recorded. Refresh the original operation; no wallet action is authorised.')
      setIntent(null); setExecution(null); setSigningOwner(''); setReviewed(false); await onRefresh()
      wallet.setMessage('The exact contract intent is recorded for independent review. No signature or broadcast was requested.')
      return
    }
    const attempt = wallet.begin()
    const result = await lifecyclePost('/api/portal/fund-lifecycle/transaction', { operation_id: operation.id, expected_revision: operation.revision }, actorId, operatingContext, attempt.signal)
    if (!attempt.current()) return
    const saved = fundOperationSchema.parse(result.operation)
    if (saved.id !== operation.id || saved.revision !== operation.revision || saved.product_id !== lifecycle.product_id || !['APPROVED', 'SIGNING'].includes(saved.state)) throw new Error('The saved operation changed. Refresh before signing.')
    const prepared = checkedIntent(result.intent, saved)
    const owner = evmAddress.parse(result.signing_owner_address)
    if (/^0x0{40}$/i.test(owner) || saved.signing_owner_address && saved.signing_owner_address.toLowerCase() !== owner.toLowerCase() || operation.signing_owner_address && operation.signing_owner_address.toLowerCase() !== owner.toLowerCase()) throw new Error('The signing-owner mandate was not verified for this current actor. No executor-wallet fallback is authorised.')
    await wallet.check(attempt.provider, owner, prepared.chain_id, attempt.current)
    setIntent(prepared); setSigningOwner(owner.toLowerCase()); setReviewed(false)
  }
  async function sign() {
    if (!intent || !signingOwner || !reviewed || !signable) return
    const attempt = wallet.begin()
    await wallet.check(attempt.provider, signingOwner, intent.chain_id, attempt.current)
    checkedIntent(intent, operationRef.current)
    const typedData = { domain: { chainId: intent.chain_id, verifyingContract: intent.execution_account }, types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...safeTypes }, primaryType: 'SafeTx', message: intent.safe_transaction }
    const signature = await attempt.provider.request({ method: 'eth_signTypedData_v4', params: [signingOwner, JSON.stringify(typedData)] })
    if (!attempt.current()) return
    if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature) || verifyTypedData(typedData.domain, safeTypes, intent.safe_transaction, signature).toLowerCase() !== signingOwner.toLowerCase()) throw new Error('MetaMask did not return the signature of this actor’s approved Safe owner.')
    await wallet.check(attempt.provider, signingOwner, intent.chain_id, attempt.current)
    checkedIntent(intent, operationRef.current)
    const result = await lifecyclePost('/api/portal/fund-lifecycle/signature', { operation_id: intent.operation_id, expected_revision: operationRef.current.revision, signature }, actorId, operatingContext, attempt.signal)
    if (!attempt.current()) return
    const saved = fundOperationSchema.parse(result.operation)
    const count = z.number().int().min(0).max(20).parse(result.signature_count), threshold = z.number().int().min(2).max(20).parse(result.threshold)
    if (saved.signer_threshold != null && saved.signer_threshold !== threshold) throw new Error('The signature threshold differs from this admitted operation policy. Refresh saved state.')
    if (saved.id !== operation.id || saved.product_id !== lifecycle.product_id || saved.intent_hash !== intent.intent_hash || saved.revision < operation.revision) throw new Error('The signature handoff did not return this exact operation. Refresh saved state.')
    if (result.execution_transaction !== null && result.execution_transaction !== undefined) {
      if (count < threshold || !['APPROVED', 'SIGNING'].includes(saved.state)) throw new Error('Independent signatures have not authorised execution.')
      const next = executionSchema.parse(result.execution_transaction); checkExecution(next, intent, saved.revision); setExecution(next)
      wallet.setMessage(`${count} of ${threshold} Safe signatures are recorded. Review the separately prepared Safe execution; nothing has been broadcast.`)
    } else { setExecution(null); setIntent(null); wallet.setMessage(`${count} of ${threshold} Safe signatures are recorded. No executable transaction was returned. Refresh for the next authorised handoff.`); await onRefresh() }
  }
  async function prepareExecution() {
    if (!canExecute || !wallet.account || !operation.intent) return
    const attempt = wallet.begin()
    await wallet.check(attempt.provider, operation.intent.signer_address, operation.chain_id, attempt.current)
    const result = await lifecyclePost('/api/portal/fund-lifecycle/execute', { operation_id: operation.id, expected_revision: operation.revision }, actorId, operatingContext, attempt.signal)
    if (!attempt.current()) return
    const saved = fundOperationSchema.parse(result.operation), next = executionSchema.parse(result.execution_transaction)
    if (saved.id !== operation.id || saved.product_id !== lifecycle.product_id || saved.state !== 'UNKNOWN' || saved.revision <= operation.revision) throw new Error('The execution lease was not confirmed. Refresh the original operation; do not execute another transaction.')
    const prepared = checkedIntent(result.intent, saved, next.expected_revision)
    checkExecution(next, prepared, saved.revision)
    saveBroadcast(key, { intentId: operation.id, hash: null, unknown: true })
    setExecutionOperation(saved); setIntent(prepared); setExecution(next); setSigningOwner(prepared.signer_address.toLowerCase()); setReviewed(false)
    wallet.setMessage('The approved signatures are ready for one execution. Review and confirm in MetaMask. If you leave or reject it, this operation needs recovery, not a second submission.')
  }
  async function broadcast() {
    if (!execution || !executionOperation || !intent || !reviewed || pending) throw new Error('Check the existing transaction; a replacement broadcast is not authorised.')
    const attempt = wallet.begin()
    checkedIntent(intent, executionOperation, execution.expected_revision)
    if (Date.parse(intent.expires_at) <= Date.now()) throw new Error('The approved intent expired. Nothing was sent.')
    checkExecution(execution, intent, execution.expected_revision)
    await wallet.check(attempt.provider, execution.from, execution.chain_id, attempt.current)
    const prepared = await prepareAmoyWalletTransaction(attempt.provider, { from: execution.from, to: execution.to, data: execution.data, value: execution.value })
    await validateRecoveryNonce(attempt.provider, execution.from, prepared.nonce)
    await wallet.check(attempt.provider, execution.from, execution.chain_id, attempt.current)
    if (operationRef.current.id !== operation.id || operationRef.current.revision !== operation.revision || operationRef.current.state !== operation.state || operationRef.current.intent_hash !== operation.intent_hash) throw new Error('The saved operation changed while preparing its network fee. Nothing was sent; check the existing execution lease.')
    checkedIntent(intent, executionOperation, execution.expected_revision)
    checkExecution(execution, intent, execution.expected_revision)
    if (prepared.transaction.from.toLowerCase() !== execution.from.toLowerCase() || prepared.transaction.to?.toLowerCase() !== execution.to.toLowerCase() || prepared.transaction.data.toLowerCase() !== execution.data.toLowerCase() || prepared.transaction.value !== execution.value || prepared.transaction.chainId !== `0x${execution.chain_id.toString(16)}`) throw new Error('Network-fee preparation changed the approved execution payload. Nothing was sent; check the existing execution lease.')
    saveBroadcast(key, { intentId: operation.id, hash: null, unknown: true }); setPending(true)
    const sent = await attempt.provider.request({ method: 'eth_sendTransaction', params: [prepared.transaction] })
    const transactionHash = txHash.parse(sent)
    saveBroadcast(key, { intentId: operation.id, hash: transactionHash, unknown: false }); setHash(transactionHash); setExecution(null)
    if (!attempt.current()) return
    wallet.setMessage('Safe execution was submitted. Record its existing hash and check finality; submission is not completion.')
    await command.recordFundTransaction({ operation_id: operation.id, expected_revision: execution.expected_revision, transaction_hash: transactionHash }, executionOperation)
  }
  async function verify() { await lifecyclePost('/api/portal/fund-lifecycle/verify', { operation_id: operation.id, expected_revision: operation.revision }, actorId, operatingContext); await onRefresh(); wallet.setMessage('The server observation was requested. Only refreshed saved evidence can establish finality.') }
  return <div className={styles.form}>
    {canPrepareReview ? <button type="button" className={styles.secondary} disabled={busy || !wallet.authorizedContext} onClick={() => void run(prepare)}>Prepare the exact contract intent for review</button> : null}
    {signable ? <><WalletPicker wallet={wallet} chainId={operation.chain_id} busy={busy} /><button type="button" className={styles.secondary} disabled={busy || !wallet.account} onClick={() => void run(prepare)}>Review the approved Safe request</button></> : null}
    {canExecute && !execution ? <button type="button" className={styles.primary} disabled={busy || !wallet.account || wallet.account.toLowerCase() !== operation.intent!.signer_address.toLowerCase()} onClick={() => void run(prepareExecution)}>Review approved contract execution</button> : null}
    {intent ? <div className={styles.review}><h3>{execution ? 'Review Safe contract execution' : 'Review the Safe owner signature'}</h3><dl className={styles.facts}><Fact title="Your signing owner" value={<Address value={signingOwner} />} />{signingOwner !== intent.signer_address.toLowerCase() ? <Fact title="Designated execution wallet" value={<Address value={intent.signer_address} />} /> : null}<Fact title="Safe execution account" value={<Address value={intent.execution_account} />} /><Fact title="Target controller" value={<Address value={intent.target_address} />} /><Fact title="Network and Safe nonce" value={`Chain ${intent.chain_id} · nonce ${intent.safe_transaction.nonce}`} /></dl><p>{execution ? 'The admitted Safe executes only the approved contract operation. Only the designated execution wallet may pay its network gas fee. Native transfer value is zero.' : 'This EIP-712 signature authorises the exact approved Safe operation. Your signing-owner mandate does not make you the execution wallet, and does not authorise an EOA mint, deployment or token allowance.'}</p><label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I checked the operation, signing owner, Safe account and chain.</label><button type="button" className={styles.secondary} disabled={busy || !reviewed || !wallet.account || Boolean(execution && wallet.account.toLowerCase() !== execution.from.toLowerCase())} onClick={() => void run(execution ? broadcast : sign)}>{busy ? 'Waiting for the current handoff…' : execution ? 'Execute the approved Safe transaction in MetaMask' : 'Sign the Safe request in MetaMask'}</button></div> : null}
    {pending || ['UNKNOWN', 'BROADCAST', 'MINED', 'CONFIRMING', 'REORGED', 'REPLACED'].includes(operation.state) ? <div className={styles.notice}><strong>Check the existing operation; do not execute it again</strong><p>A pending or uncertain broadcast remains locked. Use its original transaction from MetaMask Activity.</p>{!operation.transaction_hash ? <><label className={styles.field}>Existing transaction hash<input value={hash} onChange={event => setHash(event.target.value)} disabled={busy || command.busy} autoComplete="off" /></label><button type="button" className={styles.secondary} disabled={busy || command.busy || command.unknown || !txHash.safeParse(hash).success} onClick={() => void command.submit('record_fund_transaction', { operation_id: operation.id, expected_revision: operation.revision, transaction_hash: hash })}>Record the existing execution hash</button></> : null}<button type="button" className={styles.secondary} disabled={busy || command.busy} onClick={() => void run(verify)}>Check recorded chain evidence</button></div> : null}
    {command.message ? <p role="status" className={styles.feedback}>{command.message}</p> : null}{command.unknown ? <button type="button" className={styles.secondary} disabled={command.busy} onClick={() => void command.retry()}>Retry the original hash-recording request</button> : null}
    {!signable && !pending && !intent && operation.state !== 'FINAL' ? <p className={styles.muted}>Safe signing is unavailable until this exact operation is approved and its institutional dependencies are admitted.</p> : null}
    {!signable && wallet.message ? <p className={styles.feedback} role="status" aria-live="polite">{wallet.message}</p> : null}
  </div>
}

function checkedPayment(raw: unknown, order: Order, actorId: string): FundPaymentIntent {
  const intent = fundPaymentIntentSchema.parse(raw), funding = order.funding
  if (!funding || intent.actor_id !== actorId || intent.subscription_id !== order.subscription_id || intent.obligation_id !== funding.obligation_id || intent.obligation_revision !== funding.obligation_revision || intent.route_id !== funding.route_id || intent.route_revision !== funding.route_revision || intent.chain_id !== funding.chain_id || intent.token_address.toLowerCase() !== funding.settlement_token_address.toLowerCase() || intent.beneficiary_address.toLowerCase() !== funding.beneficiary_address.toLowerCase() || intent.amount_base_units !== funding.required_base_units) throw new Error('The prepared payment differs from this exact approved instruction. Do not send tokens.')
  const expectedData = transferInterface.encodeFunctionData('transfer', [intent.beneficiary_address, BigInt(intent.amount_base_units)])
  if (intent.data.toLowerCase() !== expectedData.toLowerCase()) throw new Error('The payment is not the exact approved TST transfer. No spending approval or substitute transfer is authorised.')
  return intent
}
function PaymentControl({ order, actorId, operatingContext, onRefresh }: ActionsProps & { order: Order }) {
  const wallet = useFundWallet(actorId, operatingContext)
  const [intent, setIntent] = useState<FundPaymentIntent | null>(null), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [pending, setPending] = useState(false), [ready, setReady] = useState(false), [hash, setHash] = useState('')
  const lock = useRef(false), orderRef = useRef(order); orderRef.current = order
  const key = pendingKey(actorId, operatingContext, 'payment', order.subscription_id)
  useEffect(() => { try { const marker = readBroadcast(key); setPending(Boolean(marker)); if (marker?.hash) setHash(marker.hash); setReady(true) } catch (error) { setPending(true); wallet.setMessage(walletError(error)) } }, [key])
  useEffect(() => { setReviewed(false); if (!pending) setIntent(null) }, [wallet.account, wallet.provider, order.funding?.obligation_revision, order.funding?.route_revision])
  const canPrepare = Boolean(order.funding?.can_pay && order.funding.state === 'AWAITING_FUNDING' && ready && !pending)
  async function run(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); wallet.setMessage(''); try { await action() } catch (error) { wallet.setMessage(walletError(error)) } finally { lock.current = false; setBusy(false) } }
  async function prepare() {
    if (!order.funding || !wallet.account) return
    const attempt = wallet.begin()
    await wallet.check(attempt.provider, wallet.account, order.funding.chain_id, attempt.current)
    const result = await lifecyclePost('/api/portal/fund-lifecycle/payment', { subscription_id: order.subscription_id, expected_obligation_revision: order.funding.obligation_revision, payer_address: wallet.account }, actorId, operatingContext, attempt.signal)
    if (!attempt.current()) return
    const prepared = checkedPayment(result.intent, orderRef.current, actorId)
    if (prepared.payer_address.toLowerCase() !== wallet.account.toLowerCase()) throw new Error('The server-prepared payer is not your connected wallet.')
    setIntent(prepared); setReviewed(false)
    if (prepared.state !== 'PREPARED' || prepared.transaction_hash) { setPending(true); if (prepared.transaction_hash) setHash(prepared.transaction_hash); wallet.setMessage('An existing payment submission is already recorded. Check it; no further transfer is authorised.'); return }
    if (Date.parse(prepared.expires_at) <= Date.now()) throw new Error('The payment instruction expired. Refresh; do not transfer tokens.')
  }
  async function pay() {
    if (!intent || !reviewed || !canPrepare || intent.state !== 'PREPARED' || readBroadcast(key)) throw new Error('A replacement transfer is not authorised. Check the original payment.')
    const attempt = wallet.begin(), funding = orderRef.current.funding
    if (!funding?.can_pay || funding.state !== 'AWAITING_FUNDING') throw new Error('The saved funding state changed. Do not send additional tokens.')
    checkedPayment(intent, orderRef.current, actorId)
    if (Date.parse(intent.expires_at) <= Date.now()) throw new Error('The payment instruction expired. Nothing was sent.')
    await wallet.check(attempt.provider, intent.payer_address, intent.chain_id, attempt.current)
    // Read-only gas, balance and nonce checks happen before acquiring an uncertain submission lease.
    const prepared = await prepareAmoyWalletTransaction(attempt.provider, { from: intent.payer_address, to: intent.token_address, data: intent.data, value: '0x0' })
    await wallet.check(attempt.provider, intent.payer_address, intent.chain_id, attempt.current)
    if (!orderRef.current.funding?.can_pay || orderRef.current.funding.state !== 'AWAITING_FUNDING' || readBroadcast(key)) throw new Error('The saved funding state changed while preparing its network fee. Nothing was sent; check the original payment.')
    checkedPayment(intent, orderRef.current, actorId)
    if (Date.parse(intent.expires_at) <= Date.now()) throw new Error('The payment instruction expired while preparing its network fee. Nothing was sent.')
    if (prepared.transaction.from.toLowerCase() !== intent.payer_address.toLowerCase() || prepared.transaction.to?.toLowerCase() !== intent.token_address.toLowerCase() || prepared.transaction.data.toLowerCase() !== intent.data.toLowerCase() || prepared.transaction.value !== '0x0' || prepared.transaction.chainId !== `0x${intent.chain_id.toString(16)}`) throw new Error('Network-fee preparation changed the approved payment payload. Nothing was sent.')
    // A server-side UNKNOWN submission lease prevents a reload or another browser from paying twice.
    saveBroadcast(key, { intentId: intent.payment_id, hash: null, unknown: true }); setPending(true)
    const result = await lifecyclePost('/api/portal/fund-lifecycle/payment/submit', { payment_id: intent.payment_id }, actorId, operatingContext, attempt.signal)
    const leased = checkedPayment(result.intent, orderRef.current, actorId)
    if (leased.payment_id !== intent.payment_id || leased.payer_address.toLowerCase() !== intent.payer_address.toLowerCase() || leased.state !== 'UNKNOWN' || leased.transaction_hash) throw new Error('The server did not grant this exact payment submission lease. Nothing was sent. Refresh the existing record.')
    if (!attempt.current()) return
    await validateRecoveryNonce(attempt.provider, intent.payer_address, prepared.nonce)
    await wallet.check(attempt.provider, intent.payer_address, intent.chain_id, attempt.current)
    checkedPayment(intent, orderRef.current, actorId)
    checkedPayment(leased, orderRef.current, actorId)
    if (Date.parse(intent.expires_at) <= Date.now() || Date.parse(leased.expires_at) <= Date.now()) throw new Error('The leased instruction expired. Nothing was sent; review its saved submission state.')
    const sent = await attempt.provider.request({ method: 'eth_sendTransaction', params: [prepared.transaction] })
    const transactionHash = txHash.parse(sent)
    saveBroadcast(key, { intentId: intent.payment_id, hash: transactionHash, unknown: false }); setHash(transactionHash)
    if (!attempt.current()) return
    const recorded = await lifecyclePost('/api/portal/fund-lifecycle/payment/reference', { payment_id: intent.payment_id, transaction_hash: transactionHash }, actorId, operatingContext, attempt.signal)
    const saved = checkedPayment(recorded.intent, orderRef.current, actorId)
    if (saved.payment_id !== intent.payment_id || saved.transaction_hash?.toLowerCase() !== transactionHash.toLowerCase() || saved.state !== 'BROADCAST') throw new Error('The reference was not confirmed. Keep the existing hash and refresh; do not transfer again.')
    setIntent(saved); wallet.setMessage('The transfer hash is recorded, not reconciled. Confirm this existing payment reference in the funding evidence section below; that separate claim does not send more tokens.'); await onRefresh()
  }
  async function recover() {
    const marker = readBroadcast(key), paymentId = intent?.payment_id ?? marker?.intentId
    if (!paymentId || !txHash.safeParse(hash).success) throw new Error('An original prepared payment and its existing transaction hash are required. Ask the operator to recover the saved instruction; do not pay again.')
    const result = await lifecyclePost('/api/portal/fund-lifecycle/payment/reference', { payment_id: paymentId, transaction_hash: hash }, actorId, operatingContext)
    const saved = checkedPayment(result.intent, orderRef.current, actorId)
    if (saved.payment_id !== paymentId || saved.transaction_hash?.toLowerCase() !== hash.toLowerCase() || saved.state !== 'BROADCAST') throw new Error('The existing transfer reference was not confirmed. Refresh; do not pay again.')
    saveBroadcast(key, { intentId: paymentId, hash, unknown: false }); setIntent(saved); setPending(true); await onRefresh(); wallet.setMessage('Existing transfer recorded. Use the funding evidence section below to confirm its payer claim and exact Transfer log; no second transfer is needed.')
  }
  return <div className={styles.form}>
    {canPrepare ? <><WalletPicker wallet={wallet} chainId={order.funding!.chain_id} busy={busy} /><button type="button" className={styles.secondary} disabled={busy || !wallet.account} onClick={() => void run(prepare)}>Review the exact TST payment</button></> : null}
    {intent?.state === 'PREPARED' && !pending ? <div className={styles.review}><h3>Review this test-token transfer</h3><dl className={styles.facts}><Fact title="Amount" value={`${units(intent.amount_base_units, intent.decimals)} TST`} /><Fact title="Payer" value={<Address value={intent.payer_address} />} /><Fact title="Token contract" value={<Address value={intent.token_address} />} /><Fact title="Beneficiary" value={<Address value={intent.beneficiary_address} />} /></dl><p>Chain {intent.chain_id}. This transfers only the approved TST amount. There is no token allowance request. MetaMask will show the separate test-network gas fee.</p><label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={busy} />I checked the exact token, beneficiary, amount and payer. I have not already sent this payment.</label><button type="button" className={styles.primary} disabled={busy || !reviewed || !canPrepare || !wallet.account} onClick={() => void run(pay)}>{busy ? 'Waiting for the original payment handoff…' : 'Transfer the approved TST amount in MetaMask'}</button></div> : null}
    {pending || intent?.state === 'BROADCAST' || intent?.state === 'UNKNOWN' ? <div className={styles.notice}><strong>Use the existing payment; do not pay again</strong><p>Check MetaMask Activity for the original transfer. Recording a hash does not establish receipt, reconciliation or ownership.</p><label className={styles.field}>Existing payment transaction hash<input value={hash} onChange={event => setHash(event.target.value)} disabled={busy} autoComplete="off" /></label><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || !txHash.safeParse(hash).success} onClick={() => void run(recover)}>Record the original transfer hash</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => void onRefresh()}>Refresh payment evidence</button></div>{hash ? <p>Confirm this existing reference in the funding evidence section below. Its payer-claim signature records which payment belongs to this order; it is not another transfer.</p> : null}</div> : null}
    {!canPrepare && !pending ? <p className={styles.muted}>No new transfer is currently permitted. Treasury must resolve any outstanding, partial, excess or reversed funding evidence first.</p> : null}
    {!canPrepare && wallet.message ? <p className={styles.feedback} role="status" aria-live="polite">{wallet.message}</p> : null}
  </div>
}
