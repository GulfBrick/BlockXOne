'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { PortalCommand, PortalProduct, PortalSnapshot, PortalSubscription } from '@/lib/portal/contracts'
import { formatFundingUnits, type FundingRoute, type FundingObligation, type FundingReference, type FundingJournal, type FundingReversal } from '@/lib/portal/funding-contracts'
import { buildFundingClaimMessage, type FundingClaim } from '@/lib/portal/funding-claim'
import { portalContextKey, portalContextMatches, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { discoverMetaMask, type MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { CommandFeedback, usePortalActorId, usePortalCommand, usePortalOperatingContext } from './portal-client'
import { DetailList, EmptyState, Field, Notice, Panel, StatusBadge, money } from './portal-primitives'
import styles from './portal.module.css'

/** Token precision is supplied by the pinned route, never inferred from fiat money formatting. */
export const fundingTokenAmount = formatFundingUnits

type Saved = { onSaved: (snapshot: PortalSnapshot) => void }
const permitted = (record: { allowed_actions: string[] }, action: string) => record.allowed_actions.includes(action)
const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : 'Not recorded'
export function fundingRouteUsable(route: FundingRoute, now = Date.now()): boolean {
  return route.status === 'APPROVED' && route.verification_status === 'VERIFIED' && Number.isFinite(Date.parse(route.valid_until)) && Date.parse(route.valid_until) > now
}

export function fundingReferencePayload(obligation: FundingObligation, route: FundingRoute, payer: string, transactionHash: string, logIndex: number, signature: string) {
  return { obligation_id: obligation.id, expected_revision: obligation.revision, expected_route_revision: route.revision, payer_address: payer.toLowerCase(), transaction_hash: transactionHash.toLowerCase(), log_index: logIndex, signature }
}

/** Explicit ownership-only signing. This helper never requests a transaction or token approval. */
export async function signFundingClaim(provider: MetaMaskProvider, claim: FundingClaim, current: () => boolean = () => true): Promise<string> {
  let changed = false
  const invalidate = () => { changed = true }
  const events = ['accountsChanged', 'chainChanged', 'disconnect']
  const stable = async () => {
    const accounts = await provider.request({ method: 'eth_accounts' })
    const chain = await provider.request({ method: 'eth_chainId' })
    if (changed || !current() || !Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== claim.payer_address.toLowerCase() || typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 80002n) throw new Error('The wallet, network or selected order changed. Reconnect the original payer on Polygon Amoy before signing.')
  }
  try {
    events.forEach(event => provider.on(event, invalidate))
    await stable()
    const bytes = new TextEncoder().encode(buildFundingClaimMessage(claim))
    const encoded = `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
    const signature = await provider.request({ method: 'personal_sign', params: [encoded, claim.payer_address] })
    await stable()
    if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('MetaMask did not return a valid claim signature.')
    return signature
  } finally { events.forEach(event => { try { provider.removeListener(event, invalidate) } catch { /* Do not replace the signed-attempt result with a provider cleanup error. */ } }) }
}

export async function verifyFundingRecord(kind: 'ROUTE' | 'REFERENCE', id: string, operatingContext: PortalOperatingContext, actorId: string): Promise<PortalSnapshot> {
  const response = await fetch('/api/portal/funding/verify', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': actorId },
    body: JSON.stringify({ kind, id, operating_context: operatingContext }), signal: AbortSignal.timeout(45000),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Verification was not confirmed. Refresh saved state before trying again.')
  const result = await response.json()
  if (!response.ok || result?.error || !result?.snapshot) throw new Error(typeof result?.error === 'string' ? result.error : 'Verification was not confirmed. Refresh saved state before trying again.')
  if (result.snapshot.actor?.id !== actorId || !portalContextMatches(result.snapshot.operating_context, operatingContext)) throw new Error('The verification result does not match your signed-in operating context. Refresh saved state.')
  return result.snapshot as PortalSnapshot
}

function VerifyFundingButton({ kind, id, onSaved }: { kind: 'ROUTE' | 'REFERENCE'; id: string; onSaved: (snapshot: PortalSnapshot) => void }) {
  const operatingContext = usePortalOperatingContext(), actorId = usePortalActorId()
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [needsRefresh, setNeedsRefresh] = useState(false)
  const identity = `${actorId}:${portalContextKey(operatingContext)}:${kind}:${id}`
  const current = useRef<string | null>(identity), lock = useRef(false)
  current.current = identity
  useEffect(() => { current.current = identity; return () => { current.current = null } }, [identity])
  async function verify() {
    if (lock.current || needsRefresh) return
    lock.current = true; setBusy(true); setMessage('')
    const attempted = identity
    try {
      const snapshot = await verifyFundingRecord(kind, id, operatingContext, actorId)
      if (current.current !== attempted) return
      onSaved(snapshot); setMessage('Server verification result refreshed. Verification alone is not funding reconciliation.')
    } catch (error) {
      if (current.current !== attempted) return
      setNeedsRefresh(true); setMessage(`${error instanceof Error ? error.message : 'Verification was not confirmed.'} Refresh saved state to inspect the recorded outcome.`)
    } finally { if (current.current === attempted) { lock.current = false; setBusy(false) } }
  }
  return <div className={styles.stack}><button type="button" className={styles.buttonSecondary} disabled={busy || needsRefresh} onClick={() => void verify()}>{busy ? 'Checking independent RPC evidence…' : kind === 'ROUTE' ? 'Verify configured token route' : 'Verify transaction evidence'}</button>{message ? <p role="status" className={styles.muted}>{message}</p> : null}</div>
}

function FundingAction({ label, commandName, payload, onSaved }: Saved & { label: string; commandName: PortalCommand['command']; payload: Record<string, unknown> }) {
  const command = usePortalCommand(onSaved)
  return <div className={styles.stack}><CommandFeedback command={command} /><button type="button" className={styles.button} disabled={command.busy || command.unknown} onClick={() => void command.submit(commandName, payload)}>{label}</button></div>
}

function ReasonedFundingAction({ label, commandName, payload, onSaved, exception = false }: Saved & { label: string; commandName: PortalCommand['command']; payload: Record<string, unknown>; exception?: boolean }) {
  const [reason, setReason] = useState(''), [decision, setDecision] = useState<'REJECTED_UNPAID' | 'UNAPPLIED'>('UNAPPLIED')
  const command = usePortalCommand(onSaved)
  return <details className={styles.sectionGap}><summary className={styles.textLink}>{label}</summary><CommandFeedback command={command} /><form className={`${styles.form} ${styles.sectionGap}`} onSubmit={event => { event.preventDefault(); void command.submit(commandName, { ...payload, reason, ...(exception ? { decision } : {}) }) }}><fieldset className={styles.fieldset} disabled={command.busy || command.unknown}>
    {exception ? <Field label="Proposed exception outcome"><select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="UNAPPLIED">Unapplied payment / reconciliation break</option><option value="REJECTED_UNPAID">Conclusively invalid and never paid</option></select></Field> : null}
    <Field label="Evidence and reason" hint="At least 20 characters. Record the evidence supporting this decision."><textarea required minLength={20} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></Field>
    {exception ? <p className={styles.muted}>Unknown, pending, previously valid or reversed-paid evidence cannot be cleared as unpaid. An independent Controller must review this proposal.</p> : null}
    <button type="submit" className={styles.buttonSecondary}>{label}</button></fieldset></form></details>
}

function FundingRouteForm({ products, onSaved }: Saved & { products: PortalProduct[] }) {
  const eligible = products.filter(product => product.allowed_actions?.includes('propose_funding_route'))
  const [productId, setProductId] = useState(eligible[0]?.id ?? '')
  const [token, setToken] = useState(''), [hash, setHash] = useState(''), [decimals, setDecimals] = useState(''), [recipient, setRecipient] = useState('')
  const [authority, setAuthority] = useState(''), [review, setReview] = useState(''), [expiry, setExpiry] = useState('')
  const [standard, setStandard] = useState(false), [conversion, setConversion] = useState(false)
  const command = usePortalCommand(onSaved)
  const selectedProductId = productId || eligible[0]?.id || ''
  const product = eligible.find(item => item.id === selectedProductId)
  if (!eligible.length) return <Notice title="No route-proposal authority">A current, explicitly scoped Treasury appointment and eligible saved product are required. A role label does not provide receiving authority.</Notice>
  return <Panel title="Propose a reviewed test funding route" description="No token, receiver or mandate is supplied automatically. A different trusted Controller must approve this exact version.">
    <CommandFeedback command={command} />
    <form className={styles.form} onSubmit={event => { event.preventDefault(); if (!product) return; void command.submit('propose_funding_route', { product_id: product.id, expected_revision: product.revision, token_address: token.toLowerCase(), token_runtime_hash: hash.toLowerCase(), token_decimals: Number(decimals), receiving_address: recipient.toLowerCase(), authority_reference: authority, code_review_reference: review, valid_until: expiry, standard_immutable_token_acknowledged: standard, synthetic_conversion_acknowledged: conversion }) }}>
      <fieldset className={styles.fieldset} disabled={command.busy || command.unknown}><legend>Exact product and settlement route</legend>
        <Field label="Product and accepted revision"><select required value={selectedProductId} onChange={event => setProductId(event.target.value)}>{eligible.map(item => <option key={item.id} value={item.id}>{item.terms.name} · revision {item.revision}</option>)}</select></Field>
        <p className={styles.muted}>Network: Polygon Amoy · chain 80002 · TESTNET only.</p>
        <Field label="Reviewed ERC20 token address"><input required pattern="0x[0-9a-fA-F]{40}" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></Field>
        <Field label="Reviewed runtime-code hash"><input required pattern="0x[0-9a-fA-F]{64}" value={hash} onChange={event => setHash(event.target.value)} autoComplete="off" /></Field>
        <Field label="Pinned token decimals"><input required type="number" min={2} max={18} step={1} value={decimals} onChange={event => setDecimals(event.target.value)} /></Field>
        <Field label="Authorised receiving address"><input required pattern="0x[0-9a-fA-F]{40}" value={recipient} onChange={event => setRecipient(event.target.value)} autoComplete="off" /></Field>
        <Field label="Issuer receiving-authority evidence"><textarea required minLength={20} maxLength={2000} value={authority} onChange={event => setAuthority(event.target.value)} /></Field>
        <Field label="Independent reviewed-code evidence"><textarea required minLength={20} maxLength={2000} value={review} onChange={event => setReview(event.target.value)} /></Field>
        <Field label="Route expiry" hint="Exact ISO timestamp including timezone, for example 2026-10-01T12:00:00Z."><input required value={expiry} onChange={event => setExpiry(event.target.value)} /></Field>
        <label className={styles.check}><input required type="checkbox" checked={standard} onChange={event => setStandard(event.target.checked)} /><span>The reviewed token is immutable, standard, non-rebasing and non-fee-on-transfer. Proxy, mutable and custom-event tokens are excluded.</span></label>
        <label className={styles.check}><input required type="checkbox" checked={conversion} onChange={event => setConversion(event.target.checked)} /><span>One token unit per ZAR_TEST unit is a fictional rehearsal convention, not FX, real ZAR or a production settlement asset.</span></label>
        <button type="submit" className={styles.button} disabled={!product || !standard || !conversion}>Propose funding route for independent approval</button>
      </fieldset>
    </form>
  </Panel>
}

function FundingRouteCard({ route, onSaved }: Saved & { route: FundingRoute }) {
  const context = usePortalOperatingContext(), actor = usePortalActorId()
  const role = context.mode === 'ROLE' ? context.role : undefined
  return <Panel title="Pinned funding route" description={`Route ${route.id} · revision ${route.revision}`} action={<StatusBadge status={route.status} />}>
    {!fundingRouteUsable(route) ? <Notice title="Do not send funds">This route is not currently approved, verified and unexpired. Historical receiving details below are evidence, not an instruction to pay.</Notice> : null}
    <DetailList rows={[{ label: 'Product reference', value: <span className={styles.mono}>{route.product_id}</span> }, { label: 'Network', value: 'Polygon Amoy · 80002 · TESTNET' }, { label: 'Token contract', value: <span className={styles.mono}>{route.token_address}</span> }, { label: 'Runtime-code hash', value: <span className={styles.mono}>{route.token_runtime_hash}</span> }, { label: 'Token decimals', value: route.token_decimals }, { label: 'Receiving address', value: <span className={styles.mono}>{route.receiving_address}</span> }, { label: 'Offering revision', value: route.product_revision }, { label: 'Accepted terms fingerprint', value: <span className={styles.mono}>{route.terms_hash}</span> }, { label: 'Expires at', value: timestamp(route.valid_until) }, { label: 'Route verification', value: <StatusBadge status={route.verification_status} /> }]} />
    <details className={styles.sectionGap}><summary className={styles.textLink}>Authority and reviewed-code evidence</summary><p className={styles.copy}>{route.authority_reference}</p><p className={styles.copy}>{route.code_review_reference}</p><p className={styles.muted}>Proposer: {route.proposed_by} · Approver: {route.approved_by ?? 'Not approved'}</p></details>
    <div className={`${styles.stack} ${styles.sectionGap}`}>
      {permitted(route, 'verify_funding_route') ? <VerifyFundingButton kind="ROUTE" id={route.id} onSaved={onSaved} /> : null}
      {role === 'FinancialController' && route.proposed_by !== actor && permitted(route, 'approve_funding_route') ? <FundingAction label="Approve this reviewed route" commandName="approve_funding_route" payload={{ route_id: route.id, expected_revision: route.revision }} onSaved={onSaved} /> : null}
      {['TreasuryOperator', 'FinancialController'].includes(role ?? '') && permitted(route, 'revoke_funding_route') ? <ReasonedFundingAction label="Revoke route with reason" commandName="revoke_funding_route" payload={{ route_id: route.id, expected_revision: route.revision }} onSaved={onSaved} /> : null}
    </div>
  </Panel>
}

function FundingClaimForm({ obligation, route, onSaved }: Saved & { obligation: FundingObligation; route: FundingRoute }) {
  const actorId = usePortalActorId()
  const [choices, setChoices] = useState<{ id: string; provider: MetaMaskProvider }[]>([]), [selectedId, setSelectedId] = useState('')
  const [payer, setPayer] = useState(''), [hash, setHash] = useState(''), [logIndex, setLogIndex] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const command = usePortalCommand(onSaved), alive = useRef(true), walletGeneration = useRef(0), lock = useRef(false)
  const provider = choices.find(item => item.id === selectedId)?.provider ?? null
  useEffect(() => { alive.current = true; const stop = discoverMetaMask(window, choice => setChoices(current => current.some(item => item.id === choice.id) ? current : [...current, choice])); return () => { alive.current = false; walletGeneration.current++; stop() } }, [])
  useEffect(() => {
    setPayer(''); walletGeneration.current++
    if (!provider) return
    const changed = () => { walletGeneration.current++; setPayer(''); setMessage('Wallet account or network changed. Reconnect the original payer.') }
    const events = ['accountsChanged', 'chainChanged', 'disconnect']
    const detach = () => { events.forEach(event => { try { provider.removeListener(event, changed) } catch { /* Provider cleanup cannot grant authority. */ } }) }
    try { events.forEach(event => provider.on(event, changed)) }
    catch { detach(); setSelectedId(''); setMessage('MetaMask could not be monitored safely. Reload the wallet before continuing.') }
    return detach
  }, [provider])
  async function connect() {
    if (!provider || lock.current) return
    lock.current = true; setBusy(true); setMessage('')
    const generation = walletGeneration.current
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      const chain = await provider.request({ method: 'eth_chainId' })
      if (!alive.current || generation !== walletGeneration.current) return
      if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 80002n) throw new Error('Select Polygon Amoy (80002) in MetaMask, then reconnect. No network change is performed automatically.')
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[0-9a-f]{40}$/i.test(accounts[0]) || /^0x0{40}$/i.test(accounts[0])) throw new Error('Select the wallet that made the transfer.')
      setPayer(accounts[0].toLowerCase()); setMessage('Payer selected. Signing a claim will not send tokens or approve spending.')
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'MetaMask connection was not confirmed.') }
    finally { if (alive.current) { lock.current = false; setBusy(false) } }
  }
  async function sign() {
    if (!provider || !payer || lock.current || command.busy || command.unknown) return
    if (!/^0x[0-9a-f]{64}$/i.test(hash) || !/^(0|[1-9][0-9]*)$/.test(logIndex) || !Number.isSafeInteger(Number(logIndex)) || Number(logIndex) > 2147483647) { setMessage('Enter the existing transaction hash and the exact Transfer log index.'); return }
    lock.current = true; setBusy(true); setMessage('Review the ownership-only receipt claim in MetaMask.')
    const generation = walletGeneration.current
    try {
      const claim: FundingClaim = { actor_id: actorId, investment_account_id: obligation.investment_account_id, obligation_id: obligation.id, route_id: route.id, route_revision: route.revision, token_address: route.token_address.toLowerCase(), token_runtime_hash: route.token_runtime_hash.toLowerCase(), token_decimals: route.token_decimals, receiving_address: route.receiving_address.toLowerCase(), payer_address: payer, transaction_hash: hash.toLowerCase(), log_index: Number(logIndex) }
      const signature = await signFundingClaim(provider, claim, () => alive.current && generation === walletGeneration.current)
      if (!alive.current || generation !== walletGeneration.current) return
      await command.submit('submit_funding_reference', fundingReferencePayload(obligation, route, payer, hash, Number(logIndex), signature))
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'The claim signature was not confirmed. No transaction was sent.') }
    finally { if (alive.current) { lock.current = false; setBusy(false) } }
  }
  const disabled = busy || command.busy || command.unknown
  return <Panel title="Submit your existing transfer for verification" description="If you already made a transfer, submit its existing reference for review. This form only signs a claim and records that reference; it does not instruct you to send any funds.">
    <Notice title="A signature is not payment confirmation">Claim signing proves control of the payer key for this record only. The server must verify the transfer and an independent Controller must reconcile it.</Notice>
    <CommandFeedback command={command} />
    <div className={`${styles.form} ${styles.sectionGap}`}><Field label="MetaMask provider"><select value={selectedId} disabled={disabled} onChange={event => setSelectedId(event.target.value)}><option value="">Select MetaMask</option>{choices.map((choice, index) => <option key={choice.id} value={choice.id}>MetaMask {index + 1} · {choice.id.slice(0, 8)}</option>)}</select></Field>
      {!choices.length ? <p className={styles.muted}>Open this portal in your MetaMask-enabled browser. Never share a recovery phrase or private key.</p> : null}
      <button type="button" className={styles.buttonSecondary} disabled={!provider || disabled} onClick={() => void connect()}>Connect payer MetaMask on Amoy</button>
      {payer ? <p className={styles.mono}>Payer: {payer}</p> : null}
      <Field label="Existing transaction hash"><input disabled={disabled} value={hash} onChange={event => setHash(event.target.value)} autoComplete="off" /></Field>
      <Field label="Transfer event log index" hint="The log index from the transaction receipt, not the transaction index."><input disabled={disabled} inputMode="numeric" value={logIndex} onChange={event => setLogIndex(event.target.value)} /></Field>
      <button type="button" className={styles.button} disabled={!payer || disabled} onClick={() => void sign()}>Sign receipt claim and submit reference</button>
      {message ? <p role="status" className={styles.muted}>{message}</p> : null}
    </div>
  </Panel>
}

function FundingReferenceCard({ reference, obligation, onSaved }: Saved & { reference: FundingReference; obligation: FundingObligation }) {
  const context = usePortalOperatingContext(), actor = usePortalActorId()
  const role = context.mode === 'ROLE' ? context.role : undefined
  const payload = { reference_id: reference.id, expected_revision: reference.revision, expected_obligation_revision: obligation.revision }
  return <Panel title="Transfer evidence" description={`Reference ${reference.id} · revision ${reference.revision}`} action={<StatusBadge status={reference.status} />}>
    <DetailList rows={[{ label: 'Transaction', value: <span className={styles.mono}>{reference.transaction_hash}</span> }, { label: 'Transfer log index', value: reference.log_index }, { label: 'Payer', value: <span className={styles.mono}>{reference.payer_address}</span> }, { label: 'Observed token amount', value: reference.amount_base_units === null ? 'Not verified' : fundingTokenAmount(reference.amount_base_units, obligation.token_decimals) }, { label: 'Server verification', value: <StatusBadge status={reference.verification_status} /> }, { label: 'Observation time', value: timestamp(reference.last_observed_at) }, { label: 'Observed block', value: reference.block_number ?? 'Not recorded' }, { label: 'Block hash', value: reference.block_hash ? <span className={styles.mono}>{reference.block_hash}</span> : 'Not recorded' }]} />
    {reference.observation_reason ? <p className={styles.copy}>{reference.observation_reason}</p> : null}
    {reference.exception_decision ? <Notice title="Recorded exception proposal">{reference.exception_decision}: {reference.exception_reason}</Notice> : null}
    <div className={`${styles.stack} ${styles.sectionGap}`}>
      {permitted(reference, 'verify_funding_reference') ? <VerifyFundingButton kind="REFERENCE" id={reference.id} onSaved={onSaved} /> : null}
      {role === 'TreasuryOperator' && permitted(reference, 'propose_funding_acceptance') ? <FundingAction label="Propose acceptance of verified evidence" commandName="propose_funding_acceptance" payload={payload} onSaved={onSaved} /> : null}
      {role === 'FinancialController' && reference.acceptance_proposed_by !== actor && permitted(reference, 'reconcile_funding') ? <FundingAction label="Reconcile evidence and post balanced journal" commandName="reconcile_funding" payload={{ ...payload, evidence_set_hash: obligation.evidence_set_hash }} onSaved={onSaved} /> : null}
      {role === 'TreasuryOperator' && permitted(reference, 'propose_funding_exception') ? <ReasonedFundingAction label="Propose evidence exception" commandName="propose_funding_exception" payload={payload} onSaved={onSaved} exception /> : null}
      {role === 'FinancialController' && permitted(reference, 'resolve_funding_exception') ? <FundingAction label="Independently resolve proposed exception" commandName="resolve_funding_exception" payload={payload} onSaved={onSaved} /> : null}
    </div>
  </Panel>
}

function FundingJournalCard({ journal, obligation, reversals, onSaved }: Saved & { journal: FundingJournal; obligation: FundingObligation; reversals: FundingReversal[] }) {
  const context = usePortalOperatingContext(), actor = usePortalActorId()
  const role = context.mode === 'ROLE' ? context.role : undefined
  return <Panel title={journal.kind === 'REVERSAL' ? 'Posted accounting reversal' : 'Posted test funding journal'} description={`Journal ${journal.id} · ${timestamp(journal.created_at)}`}>
    <p className={styles.muted}>Exact token units for {journal.token_address}. Accounting is not token issuance, bank cash or legal ownership.</p>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Account</th><th scope="col">Side</th><th scope="col">Token amount</th></tr></thead><tbody>{journal.lines.map((line, index) => <tr key={index}><td>{line.account === 'TEST_SETTLEMENT_TOKEN_ASSET' ? 'Test settlement-token asset' : 'Test customer-funding liability'}</td><td>{line.side}</td><td>{fundingTokenAmount(line.amount_base_units, journal.token_decimals)}</td></tr>)}</tbody></table></div>
    {journal.original_journal_id ? <p className={styles.muted}>Original journal: {journal.original_journal_id}. This reversal does not send an on-chain refund.</p> : null}
    {role === 'TreasuryOperator' && permitted(journal, 'propose_funding_reversal') ? <ReasonedFundingAction label="Propose accounting reversal" commandName="propose_funding_reversal" payload={{ journal_id: journal.id, expected_obligation_revision: obligation.revision }} onSaved={onSaved} /> : null}
    {reversals.map(reversal => <div key={reversal.id} className={styles.sectionGap}><StatusBadge status={reversal.status} /><p className={styles.copy}>{reversal.reason}</p><p className={styles.muted}>Reversal {reversal.id} · proposer {reversal.proposed_by}. Accounting reversal is not a refund.</p>{role === 'FinancialController' && reversal.proposed_by !== actor && permitted(reversal, 'approve_funding_reversal') ? <FundingAction label="Approve opposite-line accounting reversal" commandName="approve_funding_reversal" payload={{ reversal_id: reversal.id, expected_obligation_revision: obligation.revision }} onSaved={onSaved} /> : null}</div>)}
  </Panel>
}

export function FundingOrderDetail({ subscription, snapshot, onSaved, operatingContext }: Saved & { subscription: PortalSubscription; snapshot: PortalSnapshot; operatingContext: PortalOperatingContext }) {
  const funding = snapshot.funding
  const obligation = funding?.obligations.find(item => item.subscription_id === subscription.id)
  const route = obligation ? funding?.routes.find(item => item.id === obligation.route_id) : undefined
  const candidateRoutes = funding?.routes.filter(item => item.product_id === subscription.product_id && item.product_revision === subscription.product_revision && item.terms_hash === subscription.terms_hash && fundingRouteUsable(item)) ?? []
  const hasUnresolvedReference = Boolean(obligation && funding?.references.some(item => item.obligation_id === obligation.id && item.status !== 'REJECTED_UNPAID'))
  const isOwner = subscription.investor_id === snapshot.actor.id && (operatingContext.mode === 'APPLICANT' || operatingContext.role === 'Investor')
  return <div className={styles.stack}>
    <Panel title={subscription.product_name} description="One subscription record connects its accepted terms, funding evidence and independent reconciliation."><DetailList rows={[{ label: 'Subscription', value: <span className={styles.mono}>{subscription.id}</span> }, { label: 'Investment account', value: subscription.investment_account_id ?? 'Legacy instruction · account not linked' }, { label: 'Accepted offering', value: `Revision ${subscription.product_revision}` }, { label: 'Terms fingerprint', value: <span className={styles.mono}>{subscription.terms_hash}</span> }, { label: 'Reserved units', value: subscription.units }, { label: 'Requested synthetic amount', value: money(subscription.amount_minor, subscription.currency ?? 'ZAR_TEST') }, { label: 'Reservation status', value: <StatusBadge status={subscription.status === 'AWAITING_FUNDING' ? 'RESERVED' : subscription.status} /> }]} /></Panel>
    {!funding ? <Notice title="Funding records unavailable">Do not send funds. The hosted financial projection could not be loaded; this is not a zero balance or proof that no payment exists.</Notice>
      : !obligation ? <Panel title="Funding instructions"><Notice title="Do not send funds yet">An existing subscription reservation is not a funding instruction. Open the obligation against a current approved route before transferring any test tokens.</Notice>{isOwner && subscription.allowed_actions?.includes('open_funding_obligation') && candidateRoutes.length ? candidateRoutes.map(item => <div className={styles.sectionGap} key={item.id}><FundingRouteCard route={item} onSaved={onSaved} /><FundingAction label="Open funding obligation for this route" commandName="open_funding_obligation" payload={{ subscription_id: subscription.id, route_id: item.id }} onSaved={onSaved} /></div>) : <p className={styles.muted}>No currently permitted funding instruction is available. Treasury must propose the product-revision route and a different authorised Controller must approve it. Your saved order has not been funded.</p>}</Panel>
        : <>
          <Panel title="Funding and reconciliation" description={`Obligation ${obligation.id} · revision ${obligation.revision}`} action={<StatusBadge status={obligation.state} />}>
            <DetailList rows={[{ label: 'Requested synthetic amount', value: money(obligation.amount_minor, obligation.currency) }, { label: 'Required settlement-token amount', value: fundingTokenAmount(obligation.token_amount_base_units, obligation.token_decimals) }, { label: 'Required token base units', value: <span className={styles.mono}>{obligation.token_amount_base_units}</span> }, { label: 'Observed token amount', value: fundingTokenAmount(obligation.observed_amount_base_units, obligation.token_decimals) }, { label: 'Net posted token amount', value: fundingTokenAmount(obligation.posted_amount_base_units, obligation.token_decimals) }, { label: 'Evidence set fingerprint', value: <span className={styles.mono}>{obligation.evidence_set_hash}</span> }]} />
            <p className={styles.muted}>One token unit per ZAR_TEST unit is a fictional test convention, not FX or real ZAR. Observations, accounting and reservation status are separate records. Reconciled funding is not issued ownership.</p>
          </Panel>
          {route ? <FundingRouteCard route={route} onSaved={onSaved} /> : <Notice title="Funding route unavailable">Do not send funds. The pinned route cannot be displayed in this context; the obligation is not evidence of a safe current receiving destination.</Notice>}
          {route && fundingRouteUsable(route) && obligation.reservation_status === 'AWAITING_FUNDING' && obligation.state === 'AWAITING_FUNDING' && !hasUnresolvedReference ? <Notice title="User-controlled MetaMask transfer">Review the pinned token contract, receiving address, chain 80002 and exact required amount. Make any test transfer yourself in MetaMask, then submit its transaction hash and Transfer log index below. This page does not send tokens or request spending approval. If you have already sent a transaction that is not recorded here, submit its reference instead of paying again.</Notice> : <Notice title="Do not send additional funds">Review the recorded funding state and any outstanding evidence with Treasury. For partial funding, Treasury must confirm the remaining requirement before you send more. The full required amount displayed above is not a request to pay again. Pending, unapplied, excess or reversed evidence must not be treated as a request for a replacement payment.</Notice>}
          {isOwner && route && permitted(obligation, 'submit_funding_reference') ? <FundingClaimForm key={`${obligation.id}:${obligation.revision}:${route.revision}`} obligation={obligation} route={route} onSaved={onSaved} /> : null}
          <Panel title="Recorded transfer references" description="Only server observations establish receipt facts; a submitted transaction hash is not funding confirmation.">{funding.references.filter(item => item.obligation_id === obligation.id).length ? <div className={styles.stack}>{funding.references.filter(item => item.obligation_id === obligation.id).map(reference => <FundingReferenceCard key={`${reference.id}:${reference.revision}:${obligation.revision}`} reference={reference} obligation={obligation} onSaved={onSaved} />)}</div> : <p className={styles.muted}>No transfer reference is recorded. No payment is inferred.</p>}</Panel>
          <Panel title="Immutable accounting history" description="Balanced test-token postings and approved reversals remain visible; history is not overwritten.">{funding.journals.filter(item => item.obligation_id === obligation.id).length ? <div className={styles.stack}>{funding.journals.filter(item => item.obligation_id === obligation.id).map(journal => <FundingJournalCard key={journal.id} journal={journal} obligation={obligation} reversals={funding.reversals.filter(item => item.journal_id === journal.id)} onSaved={onSaved} />)}</div> : <p className={styles.muted}>No funding journal is posted. This is not a bank-cash balance.</p>}</Panel>
        </>}
  </div>
}

export function FundingWorkspace({ snapshot, operatingContext, onSaved }: Saved & { snapshot: PortalSnapshot; operatingContext: PortalOperatingContext }) {
  if (operatingContext.mode !== 'ROLE' || (operatingContext.role !== 'TreasuryOperator' && operatingContext.role !== 'FinancialController')) return <Notice title="Funding workspace unavailable">Select an assigned Treasury or Financial Controller context. A shared URL does not grant financial authority.</Notice>
  const role = operatingContext.role
  if (!snapshot.funding) return <Notice title="Funding records unavailable">The financial adapter has not returned a verified projection. This is not an empty queue, a zero balance or permission to send funds.</Notice>
  const organisations = snapshot.organisations.filter(item => item.status === 'ACTIVE' && item.authority_source === 'NATIVE_BINDING' && item.native_organisation_id === operatingContext.organisationId && item.roles.includes(role))
  const productIds = new Set(snapshot.products.filter(product => organisations.some(item => item.id === product.organisation_id)).map(item => item.id))
  const products = snapshot.products.filter(item => productIds.has(item.id))
  const subscriptions = snapshot.subscriptions.filter(item => productIds.has(item.product_id) && organisations.some(org => org.id === item.organisation_id))
  const routes = snapshot.funding.routes.filter(item => productIds.has(item.product_id) && organisations.some(org => org.id === item.organisation_id))
  if (!organisations.length) return <Notice title="No appointed financial scope">A current explicit organisation binding is required. No product access, receiving mandate or posting authority is inferred from your role label.</Notice>
  return <div className={styles.stack}>
    <Notice title={role === 'TreasuryOperator' ? 'Prepare evidence for independent reconciliation' : 'Independently reconcile exact funding evidence'}>Treasury proposals and Controller decisions remain separate. These queues concern Amoy test tokens, not safeguarded bank cash, issued units or legal ownership.</Notice>
    <Panel title={role === 'TreasuryOperator' ? 'Funding operations queue' : 'Independent reconciliation queue'} description="Open the same subscription and evidence records used by the investor and issuer." flush>
      {subscriptions.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Subscription / account</th><th scope="col">Requested amount</th><th scope="col">Funding state</th><th scope="col">Next action</th></tr></thead><tbody>{subscriptions.map(subscription => {
        const obligation = snapshot.funding!.obligations.find(item => item.subscription_id === subscription.id)
        return <tr key={subscription.id}><td>{subscription.product_name}</td><td><span className={styles.mono}>{subscription.id}</span><small>{subscription.investment_account_id ?? 'Account not linked'}</small></td><td>{money(subscription.amount_minor, subscription.currency ?? 'ZAR_TEST')}</td><td>{obligation ? <StatusBadge status={obligation.state} /> : 'No funding obligation'}</td><td><Link href={portalScopeHref('/portal/orders/detail', operatingContext, subscription.id)}>Open funding record</Link></td></tr>
      })}</tbody></table></div> : <EmptyState title="No subscriptions in this financial scope" description="Saved subscriptions appear here under the exact product organisation and current financial appointment. No payments or completed investments are inferred." />}
    </Panel>
    {role === 'TreasuryOperator' ? <FundingRouteForm products={products} onSaved={onSaved} /> : null}
    <Panel title="Product funding routes" description="Review proposed routes and existing approval, code evidence, expiry and receiving authority.">{routes.length ? <div className={styles.stack}>{routes.map(route => <FundingRouteCard key={`${route.id}:${route.revision}`} route={route} onSaved={onSaved} />)}</div> : <Notice title="No configured funding routes">Do not send funds. Treasury must propose a reviewed token and authorised receiver before an independent Controller can approve a route.</Notice>}</Panel>
  </div>
}
