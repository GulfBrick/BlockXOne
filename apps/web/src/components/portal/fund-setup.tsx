'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { fundSetupConfigurationSchema, fundSetupSnapshotSchema, type FundSetupSnapshot } from '@/lib/portal/fund-setup-contracts'
import { portalContextKey, portalContextMatches, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { prepareAmoyWalletTransaction, validateRecoveryNonce } from '@/lib/testnet-fund/wallet-transaction'
import { usePortalActorId, usePortalOperatingContext } from './portal-client'
import { useFundWallet, WalletPicker } from './fund-lifecycle'
import { FundReleaseAdmission } from './fund-release-admission'
import { FundSigningKeys } from './fund-signing-keys'
import { setupPost, SetupRequestError } from '@/lib/portal/fund-setup-client'
import { fundSetupRetryResponseSchema, setupRetryErrorMetadata, type FundSetupRetryResponse } from '@/lib/portal/fund-setup-recovery-contracts'
import styles from './fund-lifecycle.module.css'

const names: Record<string, string> = {
  safe_creation: 'Create your institutional signing account',
  token_implementation: 'Token implementation', ctr_implementation: 'Claim-topic registry implementation',
  irs_implementation: 'Identity storage implementation', ir_implementation: 'Identity registry implementation',
  tir_implementation: 'Trusted-issuer registry implementation', mc_implementation: 'Compliance implementation',
  oid_implementation: 'Identity implementation', oid_authority: 'Identity implementation authority',
  oid_factory: 'Identity factory', trex_authority: 'Token implementation authority', trex_version: 'Register the pinned token release',
  trex_factory: 'Token factory', ia_factory: 'Implementation-authority factory', trex_factory_binding: 'Bind the token factory',
  ia_factory_binding: 'Bind the authority factory', oid_factory_binding: 'Authorise identity creation',
  controller: 'Fund controller', factory_handoff: 'Transfer the token factory to the controller',
  trex_authority_handoff: 'Transfer token authority to the signing account', oid_authority_handoff: 'Transfer identity authority to the signing account',
  oid_factory_handoff: 'Transfer the identity factory to the signing account', holding_module: 'Holding-limit control',
  claim_issuer: 'Identity claim issuer', token_identity: 'Product identity', settlement: 'TST settlement token',
}
type PendingRequest = { path: string; body: Record<string, unknown> }
type RetainedRetry = { step_id: string; lease_id: string; transaction_hash: string; request_key: string }
const address = /^0x[0-9a-f]{40}$/i, hash = /^0x[0-9a-f]{64}$/i

/** The existing product workspace, not a second app or a browser-only deployment draft. */
export function FundSetup({ productId, productRevision, actorId, operatingContext, onRefresh }: {
  productId: string; productRevision: number; actorId: string; operatingContext: PortalOperatingContext; onRefresh: () => Promise<void>
}) {
  const actor = usePortalActorId(), context = usePortalOperatingContext(), wallet = useFundWallet(actorId, operatingContext)
  const [snapshot, setSnapshot] = useState<FundSetupSnapshot | null>(null), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false), [safe, setSafe] = useState('')
  const [identityKey, setIdentityKey] = useState(''), [claimKey, setClaimKey] = useState(''), [tokenKey, setTokenKey] = useState('')
  const [holder, setHolder] = useState(''), [supply, setSupply] = useState(''), [holdingLimit, setHoldingLimit] = useState('')
  const [reviewed, setReviewed] = useState(false), [transactionHash, setTransactionHash] = useState(''), [showHistory, setShowHistory] = useState(false)
  const [otherOwner, setOtherOwner] = useState(''), [importExisting, setImportExisting] = useState(false)
  const [recovery, setRecovery] = useState<FundSetupRetryResponse | null>(null), [walletPending, setWalletPending] = useState(false)
  const [retainedRetry, setRetainedRetry] = useState<RetainedRetry | null>(null)
  const [clock, setClock] = useState(Date.now)
  const generation = useRef(0), alive = useRef(false), lock = useRef<symbol | null>(null), pending = useRef<PendingRequest | null>(null)
  const abort = useRef<AbortController | null>(null), lastIdentity = useRef('')
  const identity = `${actorId}:${portalContextKey(operatingContext)}:${productId}`
  const authorised = actor === actorId && portalContextMatches(context, operatingContext)
  if (lastIdentity.current !== identity || !authorised && lastIdentity.current !== '') {
    lastIdentity.current = authorised ? identity : ''; generation.current++; abort.current?.abort()
  }
  const setup = snapshot?.setup, step = setup?.next_step === 'safe_creation' ? setup.safe_creation : setup?.steps.find(item => item.step_key === setup.next_step)
  const intent = step?.intent, sameRecord = snapshot?.actor_id === actorId && snapshot.product_id === productId
    && portalContextMatches(snapshot.operating_context, operatingContext)
  const originalScope = !setup || setup.actor_id === actorId && portalContextMatches(setup.operating_context, operatingContext)
  const preparationExpired = step?.state === 'PREPARED' && (!step.expires_at || Date.parse(step.expires_at) <= clock)

  function checkedSnapshot(raw: unknown) {
    const parsed = fundSetupSnapshotSchema.safeParse(raw)
    if (!parsed.success || parsed.data.actor_id !== actorId || parsed.data.product_id !== productId
      || !portalContextMatches(parsed.data.operating_context, operatingContext)) throw new SetupRequestError('The saved setup response could not be verified. Refresh before taking another action.', true)
    return parsed.data
  }
  function accept(raw: unknown) { const parsed = checkedSnapshot(raw); setSnapshot(parsed); setReviewed(false); return parsed }
  async function post(path: string, body: Record<string, unknown>, signal: AbortSignal) {
    return setupPost(`/api/portal/fund-lifecycle/setup/${path}`, body, actorId, operatingContext, signal)
  }
  async function load(signal: AbortSignal) { return post('read', { product_id: productId }, signal) }
  async function run(task: (signal: AbortSignal, current: () => boolean) => Promise<unknown>) {
    if (lock.current || !authorised) return
    const token = Symbol('setup attempt'), epoch = generation.current, controller = new AbortController()
    lock.current = token; abort.current?.abort(); abort.current = controller; setBusy(true); setMessage('')
    const current = () => alive.current && generation.current === epoch && !controller.signal.aborted
    try { await task(controller.signal, current) }
    catch (error) { if (current()) { setMessage(error instanceof Error ? error.message : 'The setup outcome could not be confirmed. Refresh the saved record.'); setUncertain(pending.current !== null) } }
    finally { if (lock.current === token) { lock.current = null; if (alive.current) setBusy(false) } }
  }
  useEffect(() => {
    alive.current = true
    const controller = new AbortController(), epoch = generation.current
    setSnapshot(null); setMessage(''); setReviewed(false); pending.current = null; setUncertain(false); setRecovery(null); setWalletPending(false); setRetainedRetry(null)
    if (authorised) void load(controller.signal).then(raw => { if (alive.current && generation.current === epoch && !controller.signal.aborted) accept(raw) })
      .catch(error => { if (!controller.signal.aborted && generation.current === epoch) setMessage(error instanceof Error ? error.message : 'Blockchain setup could not be loaded.') })
    return () => { controller.abort(); abort.current?.abort(); generation.current++; alive.current = false }
    // The bound actor, organisation, capacity and product identify this saved workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, authorised])
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!setup || !step || step.state !== 'UNKNOWN' || step.transaction_hash) return
    try {
      const saved = localStorage.getItem(`bx1:fund-setup:v1:${actorId}:${setup.id}:${step.id}`)
      if (saved && hash.test(saved)) setTransactionHash(saved.toLowerCase())
    } catch { /* The original transaction remains discoverable in MetaMask activity. */ }
  }, [actorId, setup?.id, step?.id, step?.state, step?.transaction_hash])
  useEffect(() => {
    const original = setup?.steps.find(item => item.step_key === 'trex_version')
    setRetainedRetry(null)
    if (!setup || !original) return
    try {
      const raw = localStorage.getItem(`bx1:fund-setup:retry:v1:${actorId}:${setup.id}:${original.id}`)
      const value: unknown = raw ? JSON.parse(raw) : null
      if (value && typeof value === 'object' && 'lease_id' in value && typeof value.lease_id === 'string'
        && /^[0-9a-f-]{36}$/i.test(value.lease_id) && 'transaction_hash' in value && typeof value.transaction_hash === 'string' && hash.test(value.transaction_hash)
        && 'request_key' in value && typeof value.request_key === 'string' && /^[0-9a-f-]{36}$/i.test(value.request_key)) {
        setRetainedRetry({ step_id: original.id, lease_id: value.lease_id, transaction_hash: value.transaction_hash.toLowerCase(), request_key: value.request_key })
      }
    } catch { /* Only public metadata is read; malformed local values cannot grant authority. */ }
  }, [actorId, setup?.id, setup?.revision])

  async function command(commandName: string, payload: Record<string, unknown>, signal: AbortSignal, current: () => boolean) {
    const request = { path: 'command', body: { command: commandName, request_key: crypto.randomUUID(), payload } }
    pending.current = request
    try { const raw = await post(request.path, request.body, signal); if (!current()) return null; const saved = accept(raw); pending.current = null; setUncertain(false); return saved }
    catch (error) { if (error instanceof SetupRequestError && !error.uncertain) pending.current = null; throw error }
  }
  async function verify(signal: AbortSignal, current: () => boolean, stepId: string | null) {
    if (!setup) return
    const raw = await post('verify', { setup_id: setup.id, expected_revision: setup.revision, step_id: stepId }, signal)
    if (current()) { accept(raw); await onRefresh() }
  }
  async function retryRequest(body: Record<string, unknown>, signal: AbortSignal, current: () => boolean, retain = true) {
    const request = { path: 'retry', body }
    if (retain) pending.current = request
    try {
      const raw = await post(request.path, request.body, signal), parsed = fundSetupRetryResponseSchema.safeParse(raw)
      if (!parsed.success) throw new SetupRequestError('The saved recovery response could not be verified. Check the original request before continuing.', true)
      checkedSnapshot(parsed.data.snapshot)
      const savedSetup = parsed.data.snapshot.setup, savedStep = savedSetup?.steps.find(item => item.id === body.step_id)
      if (!savedSetup || !savedStep || savedSetup.id !== body.setup_id || savedStep.step_key !== 'trex_version'
        || parsed.data.lease && (parsed.data.lease.setup_id !== savedSetup.id || parsed.data.lease.step_id !== savedStep.id
          || parsed.data.lease.actor_id !== actorId || parsed.data.lease.intent_hash !== savedStep.intent_hash
          || parsed.data.lease.sender !== savedStep.sender || parsed.data.lease.nonce !== savedStep.nonce
          || !portalContextMatches(parsed.data.lease.operating_context, operatingContext))
        || parsed.data.proof && (parsed.data.proof.intent_hash !== savedStep.intent_hash
          || parsed.data.proof.sender !== savedStep.sender || parsed.data.proof.nonce !== savedStep.nonce)) {
        throw new SetupRequestError('The recovery result belongs to a different operation. Refresh this original fund step.', true)
      }
      if (current()) { accept(parsed.data.snapshot); setRecovery(parsed.data); if (retain) pending.current = null; setUncertain(false) }
      return parsed.data
    } catch (error) { if (retain && error instanceof SetupRequestError && !error.uncertain) pending.current = null; throw error }
  }
  function retryScope() {
    if (!setup || !step) throw new Error('Refresh the saved fund setup before recovering it.')
    return { product_id: productId, setup_id: setup.id, step_id: step.id, expected_revision: setup.revision, expected_step_revision: step.revision }
  }
  async function saveTransactionReference(signal: AbortSignal, current: () => boolean) {
    if (!setup || !step) return
    let retained: { lease_id: string; transaction_hash: string; request_key: string } | null = null
    try {
      const raw = localStorage.getItem(`bx1:fund-setup:retry:v1:${actorId}:${setup.id}:${step.id}`)
      if (raw) {
        const value: unknown = JSON.parse(raw)
        if (value && typeof value === 'object' && 'lease_id' in value && typeof value.lease_id === 'string'
          && /^[0-9a-f-]{36}$/i.test(value.lease_id) && 'transaction_hash' in value && value.transaction_hash === transactionHash.toLowerCase()
          && 'request_key' in value && typeof value.request_key === 'string' && /^[0-9a-f-]{36}$/i.test(value.request_key)) {
          retained = { lease_id: value.lease_id, transaction_hash: value.transaction_hash, request_key: value.request_key }
        }
      }
    } catch { /* An independently supplied original reference still uses the original guarded command. */ }
    if (retained && step.step_key === 'trex_version') {
      await retryRequest({ ...retryScope(), action: 'HASH', ...retained }, signal, current)
      return
    }
    await command('RECORD_HASH', { setup_id: setup.id, expected_revision: setup.revision, step_id: step.id,
      expected_step_revision: step.revision, transaction_hash: transactionHash.toLowerCase() }, signal, current)
  }
  async function checkRecovery(signal: AbortSignal, current: () => boolean) {
    const result = await retryRequest({ ...retryScope(), action: 'CHECK' }, signal, current)
    if (current() && result.proof?.status === 'WINNER') { setMessage('The original transaction was found and checked. Its result is saved.'); await onRefresh() }
  }
  async function retainAdditionalCandidate(signal: AbortSignal, current: () => boolean) {
    if (!setup || !retainedRetry) return
    const original = setup.steps.find(item => item.id === retainedRetry.step_id)
    if (!original) return
    await retryRequest({ product_id: productId, setup_id: setup.id, step_id: original.id,
      expected_revision: setup.revision, expected_step_revision: original.revision,
      action: 'HASH', lease_id: retainedRetry.lease_id, transaction_hash: retainedRetry.transaction_hash,
      request_key: retainedRetry.request_key }, signal, current)
    if (current()) {
      try { localStorage.removeItem(`bx1:fund-setup:retry:v1:${actorId}:${setup.id}:${original.id}`) } catch { /* Server has retained the reference. */ }
      setRetainedRetry(null); setMessage('The additional transaction reference is retained. The confirmed result was not replaced.')
    }
  }
  async function retryWithWallet(signal: AbortSignal, current: () => boolean) {
    if (!setup || !step || !intent || step.step_key !== 'trex_version' || step.state !== 'UNKNOWN' || step.transaction_hash
      || recovery?.proof?.status !== 'RETRY_AVAILABLE' || !reviewed) return
    const scope = retryScope(), attempt = wallet.begin(), from = intent.sender
    await wallet.check(attempt.provider, from, 80002, attempt.current)
    const nonce = `0x${BigInt(intent.nonce).toString(16)}`
    const prepared = await prepareAmoyWalletTransaction(attempt.provider, { from, to: intent.to!, data: intent.data, value: '0x0' }, { retryNonce: nonce })
    await validateRecoveryNonce(attempt.provider, from, nonce)
    if (!current() || !attempt.current()) throw new Error('The wallet or account changed. Nothing was sent.')
    const granted = await retryRequest({ ...scope, action: 'CLAIM', request_key: crypto.randomUUID() }, signal, current)
    if (granted.proof?.status === 'WINNER' || granted.proof?.status === 'HOLD' || granted.proof?.status === 'WAITING') {
      if (current()) await onRefresh()
      return
    }
    const lease = granted.lease
    if (granted.proof?.status !== 'RETRY_AVAILABLE' || !lease || lease.expected_revision !== scope.expected_revision || lease.expected_step_revision !== scope.expected_step_revision
      || Date.parse(lease.expires_at) <= Date.now() || !current() || !attempt.current()) throw new Error('The recovery handoff is no longer current. No wallet transaction was requested.')
    await wallet.check(attempt.provider, from, 80002, attempt.current)
    await validateRecoveryNonce(attempt.provider, from, nonce)
    if (!current() || !attempt.current() || Date.parse(lease.expires_at) <= Date.now()) throw new Error('The recovery handoff expired or the wallet changed. Nothing was sent.')
    let candidate: string | null = null
    let outcome: 'REJECTED' | 'PENDING_PROMPT' | 'UNKNOWN' = 'UNKNOWN'
    setWalletPending(true)
    try {
      // One explicit wallet request. There is no automatic resend or fee escalation.
      const result = await attempt.provider.request({ method: 'eth_sendTransaction', params: [prepared.transaction] })
      candidate = typeof result === 'string' && hash.test(result) && !/^0x0{64}$/i.test(result) ? result.toLowerCase() : null
    } catch (error) {
      const metadata = setupRetryErrorMetadata(error); candidate = metadata.hash; outcome = metadata.outcome
    } finally { if (current()) setWalletPending(false) }
    const captureKey = crypto.randomUUID()
    if (candidate) {
      // Only public recovery metadata; preserve it even after a context change or elapsed lease.
      try {
        localStorage.setItem(`bx1:fund-setup:v1:${actorId}:${setup.id}:${step.id}`, candidate)
        localStorage.setItem(`bx1:fund-setup:retry:v1:${actorId}:${setup.id}:${step.id}`, JSON.stringify({ lease_id: lease.id, transaction_hash: candidate, request_key: captureKey }))
      } catch { /* A storage failure must not prevent the authorised server capture below. */ }
      if (!current() || !attempt.current()) throw new Error('The wallet returned a transaction reference after the account changed. It was retained for recovery; no new transaction was requested.')
      setTransactionHash(candidate)
      await retryRequest({ ...scope, action: 'HASH', lease_id: lease.id, transaction_hash: candidate, request_key: captureKey }, signal, current)
      try { localStorage.removeItem(`bx1:fund-setup:retry:v1:${actorId}:${setup.id}:${step.id}`) } catch { /* The server retained the reference. */ }
      setRetainedRetry(null)
      setMessage('Transaction saved. Check confirmation to verify its result before continuing.')
    } else {
      if (!current() || !attempt.current()) return
      await retryRequest({ ...scope, action: 'OUTCOME', lease_id: lease.id, outcome, request_key: captureKey }, signal, current)
      setMessage(outcome === 'REJECTED' ? 'This wallet request was declined. The original step is still saved; check it before another attempt.'
        : outcome === 'PENDING_PROMPT' ? 'MetaMask already has a pending request. Resolve that request first. Nothing was sent again.'
          : 'The wallet did not return a transaction reference. Check the saved transaction here before trying again.')
    }
  }
  async function send(signal: AbortSignal, current: () => boolean) {
    if (!setup || !step || !intent || !step.intent_hash || step.state !== 'PREPARED' || !reviewed) return
    if (!step.expires_at || Date.parse(step.expires_at) <= Date.now()) throw new Error('This unused preparation expired. Refresh the same preparation; nothing was sent.')
    const attempt = wallet.begin(), from = intent.sender
    await wallet.check(attempt.provider, from, 80002, attempt.current)
    const prepared = await prepareAmoyWalletTransaction(attempt.provider, { from, ...(intent.to ? { to: intent.to } : {}), data: intent.data, value: '0x0' })
    if (BigInt(prepared.nonce) !== BigInt(intent.nonce)) throw new Error('The wallet nonce differs from the saved setup. Nothing was sent. Refresh the existing step; do not create another setup.')
    await validateRecoveryNonce(attempt.provider, from, prepared.nonce)
    if (!current() || !attempt.current()) throw new Error('The wallet or operating capacity changed. Nothing was sent.')
    const claimed = await command('CLAIM_STEP', { setup_id: setup.id, expected_revision: setup.revision, step_id: step.id,
      expected_step_revision: step.revision, intent_hash: step.intent_hash }, signal, current)
    const claimedStep = claimed?.setup?.safe_creation?.id === step.id ? claimed.setup.safe_creation : claimed?.setup?.steps.find(item => item.id === step.id)
    if (!claimed?.setup || claimed.setup.id !== setup.id || claimed.setup.revision !== setup.revision + 1
      || !claimedStep || claimedStep.revision !== step.revision + 1 || claimedStep.state !== 'UNKNOWN'
      || claimedStep.intent_hash !== step.intent_hash || claimedStep.actor_id !== actorId
      || claimedStep.sender !== intent.sender || claimedStep.nonce !== intent.nonce
      || JSON.stringify(claimedStep.intent) !== JSON.stringify(intent)) throw new Error('The server did not confirm this exact submission lease. Nothing was sent. Refresh the original step.')
    // The backend saved UNKNOWN before this irreversible handoff. Refresh never resends it.
    if (!current() || !attempt.current()) throw new Error('The handoff stopped after reserving its original transaction. Refresh and recover that step; do not send a replacement.')
    await wallet.check(attempt.provider, from, 80002, attempt.current)
    const result = await attempt.provider.request({ method: 'eth_sendTransaction', params: [prepared.transaction] })
    if (typeof result !== 'string' || !hash.test(result)) throw new Error('MetaMask did not return a usable transaction hash. Check its activity for the original setup transaction; do not send another.')
    // Keep public recovery metadata even if a user changes wallet after submission.
    try { localStorage.setItem(`bx1:fund-setup:v1:${actorId}:${setup.id}:${step.id}`, result.toLowerCase()) } catch { /* Storage failure must not prevent saving the returned hash to the server. */ }
    if (current()) setTransactionHash(result.toLowerCase())
    if (!current() || !attempt.current()) throw new Error('A transaction was submitted, but the wallet context changed. Its hash was retained for recovery. Refresh this saved step.')
    const refreshed = checkedSnapshot(await load(signal)), saved = refreshed.setup?.safe_creation?.id === step.id ? refreshed.setup.safe_creation : refreshed.setup?.steps.find(item => item.id === step.id)
    if (!refreshed.setup || !saved || saved.state !== 'UNKNOWN') throw new Error('The saved step changed after submission. Retain the original hash and refresh; do not resend.')
    await command('RECORD_HASH', { setup_id: setup.id, expected_revision: refreshed.setup.revision, step_id: step.id,
      expected_step_revision: saved.revision, transaction_hash: result.toLowerCase() }, signal, current)
    setMessage('Transaction saved. Check confirmation to verify its contract and effects.')
  }
  const unusableSetup = Boolean(setup && ['REVOKED', 'EXPIRED', 'STALE', 'RECOVERY_REQUIRED'].includes(setup.state))
  const disabled = busy || uncertain || !authorised || !sameRecord || !originalScope || unusableSetup || snapshot?.availability !== 'AVAILABLE'
  const state = step?.state
  const confirmed = setup?.steps.filter(item => item.state === 'FINAL').length ?? 0
  return <div className={styles.workspace}>
    {snapshot?.roleplay_policy ? <FundSigningKeys productId={productId} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} /> : null}
    <div className={styles.heading}><div><h2>Set up the fund’s blockchain</h2><p>Continue the same fund on Polygon Amoy. Each transaction is saved and independently checked before the next step.</p></div>
      <button type="button" className={styles.secondary} disabled={busy || !authorised} onClick={() => void run(async (signal, current) => { const raw = await load(signal); if (current()) accept(raw) })}>Refresh saved progress</button></div>
    {snapshot?.roleplay_policy ? <p className={styles.boundary}>One-person TEST role-play: you are the recorded operator in each capacity. This does not prove independent human approval.</p> : null}
    {message ? <p className={styles.feedback} role="status" aria-live="polite">{message}</p> : null}
    {walletPending ? <p className={styles.feedback} role="status" aria-live="polite">Waiting for your MetaMask decision. Keep this page open; do not submit again.</p> : null}
    {retainedRetry ? <div className={styles.notice}><strong>A wallet transaction reference is retained on this device</strong><p>Save it to this fund’s history without changing any confirmed transaction.</p><p className={styles.address}>{retainedRetry.transaction_hash}</p>
      <button type="button" className={styles.secondary} disabled={busy || !authorised || !sameRecord || !originalScope || unusableSetup} onClick={() => void run(retainAdditionalCandidate)}>Retain additional transaction reference</button></div> : null}
    {uncertain && pending.current ? <div className={styles.notice}><strong>A saved request has an uncertain outcome</strong><p>Check the original request without creating a new one.</p><button type="button" className={styles.secondary} disabled={busy || !authorised} onClick={() => void run(async (signal, current) => {
      const request = pending.current; if (!request) return
      if (request.path === 'retry') { await retryRequest(request.body, signal, current); return }
      const raw = await post(request.path, request.body, signal)
      if (current()) { accept(raw); pending.current = null; setUncertain(false) }
    })}>Check original request</button></div> : null}
    {!snapshot ? <p className={styles.muted}>{message ? 'No verified setup record is available.' : 'Loading saved setup…'}</p>
      : snapshot.availability !== 'AVAILABLE' ? <div className={styles.notice}><strong>Blockchain setup is not available in this capacity</strong><p>Return to the fund’s review and appointments. No contract deployment or payment has been inferred.</p></div>
      : !setup ? <div className={styles.card}><div className={styles.cardBody}><h3>Start a saved setup</h3><p>This binds the contract setup to this fund’s current offering. It does not deploy or open the fund.</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled} onClick={() => void run((signal, current) => command('CREATE', { product_id: productId, expected_revision: productRevision }, signal, current))}>Create saved blockchain setup</button></div></div></div>
        : !originalScope ? <div className={styles.notice}><strong>This fund already has a saved setup</strong><p>Continue the original setup; a change of capacity does not create a second deployment.</p>{setup.actor_id === actorId ? <Link className={styles.primary} href={portalScopeHref('/portal/products/detail', setup.operating_context, productId)}>Resume in the original capacity</Link> : <p>The original operator must resume this setup. Its history is retained.</p>}</div>
        : unusableSetup ? <div className={styles.notice}><strong>{setup.state === 'RECOVERY_REQUIRED' ? 'Setup is paused for recovery' : 'This saved setup is no longer current'}</strong><p>The original transactions and evidence are retained. No replacement transaction is authorised.</p><button type="button" className={styles.secondary} onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Hide retained history' : 'View retained history'}</button>{showHistory ? <ol>{setup.steps.map(item => <li key={item.id}>{names[item.step_key]} · {item.state.toLowerCase()}{item.transaction_hash ? <p className={styles.address}>{item.transaction_hash}</p> : null}</li>)}</ol> : null}</div>
      : <>
        <p className={styles.boundary}>{confirmed} of {setup.steps.length} infrastructure steps confirmed. Fund deployment, investor payment and issued holdings remain separate.</p>
        {setup.safe_state !== 'VERIFIED' && !step ? <section className={styles.card}><div className={styles.cardHeader}><h3>Set up institutional signing through MetaMask</h3></div><div className={styles.cardBody}>
          <p>Use MetaMask to create the signing account here. TEST role-play lets you operate both signing wallets; they must still be different keys.</p>
          {setup.safe_address ? <><p className={styles.address}>{setup.safe_address}</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled} onClick={() => void run((signal, current) => verify(signal, current, null))}>Check signing account</button></div></>
            : importExisting ? <><label className={styles.field}>Existing Safe public address<input value={safe} onChange={event => setSafe(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" disabled={disabled} /></label>
              <div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled || !address.test(safe)} onClick={() => void run(async (signal, current) => { await command('IMPORT_SAFE', { setup_id: setup.id, expected_revision: setup.revision, safe_address: safe.toLowerCase() }, signal, current) })}>Save existing signing account</button></div></>
              : <><WalletPicker wallet={wallet} chainId={80002} busy={busy} /><label className={styles.field}>Second signing wallet’s public address<input value={otherOwner} onChange={event => setOtherOwner(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" disabled={disabled} /></label>
                <p>Both wallets must sign later fund operations. No key or recovery phrase is entered on BlockXOne.</p><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled || !wallet.account || !address.test(otherOwner) || otherOwner.toLowerCase() === wallet.account.toLowerCase()} onClick={() => void run(async (signal, current) => { await command('CONFIGURE_SAFE', { setup_id: setup.id, expected_revision: setup.revision, owners: [wallet.account.toLowerCase(), otherOwner.toLowerCase()], threshold: 2 }, signal, current) })}>Prepare a two-wallet signing account</button></div></>}
          {!setup.safe_address ? <button type="button" className={styles.secondary} disabled={disabled} onClick={() => setImportExisting(value => !value)}>{importExisting ? 'Create an account through MetaMask instead' : 'Use an existing Safe instead'}</button> : null}
        </div></section> : !setup.configuration && setup.safe_state === 'VERIFIED' ? <section className={styles.card}><div className={styles.cardHeader}><h3>Review blockchain settings</h3></div><div className={styles.cardBody}>
          <p>Use public wallet addresses only. TST has six decimal places; these fields use whole base units.</p>
          <div className={styles.form}>
            <label className={styles.field}>Identity-management wallet<input value={identityKey} onChange={event => setIdentityKey(event.target.value)} disabled={disabled} /></label>
            <label className={styles.field}>Claim-management wallet<input value={claimKey} onChange={event => setClaimKey(event.target.value)} disabled={disabled} /></label>
            <label className={styles.field}>Product identity wallet<input value={tokenKey} onChange={event => setTokenKey(event.target.value)} disabled={disabled} /></label>
            <label className={styles.field}>Initial TST holder<input value={holder} onChange={event => setHolder(event.target.value)} disabled={disabled} /></label>
            <label className={styles.field}>Initial TST supply in base units<input value={supply} onChange={event => setSupply(event.target.value)} inputMode="numeric" disabled={disabled} /></label>
            <label className={styles.field}>Maximum holding in fund-unit base units<input value={holdingLimit} onChange={event => setHoldingLimit(event.target.value)} inputMode="numeric" disabled={disabled} /></label>
          </div><div className={styles.actions}><button type="button" className={styles.primary} disabled={disabled} onClick={() => void run(async (signal, current) => {
            const configuration = fundSetupConfigurationSchema.parse({ safe_address: setup.safe_address, identity_management_key: identityKey.toLowerCase(), claim_management_key: claimKey.toLowerCase(), token_management_key: tokenKey.toLowerCase(), maximum_holding_base_units: holdingLimit, tst_initial_holder: holder.toLowerCase(), tst_initial_supply_base_units: supply })
            await command('CONFIGURE', { setup_id: setup.id, expected_revision: setup.revision, configuration }, signal, current)
          })}>Save reviewed settings</button></div>
        </div></section> : step ? <section className={styles.card}><div className={styles.cardHeader}><p className={styles.eyebrow}>{step.step_key === 'safe_creation' ? 'Signing account setup' : `Step ${step.ordinal} of ${setup.steps.length}`}</p><h3>{names[step.step_key]}</h3></div><div className={styles.cardBody}>
          <WalletPicker wallet={wallet} chainId={80002} busy={busy} />
          {state === 'NOT_STARTED' || preparationExpired ? <><p>{preparationExpired ? 'The unused preparation expired. Refreshing preserves the original nonce and contract intent; it does not submit anything.' : null}</p><button type="button" className={styles.primary} disabled={disabled || !wallet.account} onClick={() => void run(async (signal, current) => {
            const raw = await post('prepare', { setup_id: setup.id, expected_revision: setup.revision, step_key: step.step_key, sender: wallet.account }, signal)
            if (current()) accept(raw)
          })}>{preparationExpired ? 'Refresh the same preparation' : 'Prepare this transaction'}</button></> : intent && state === 'PREPARED' ? <div className={styles.review}><dl className={styles.facts}><div className={styles.fact}><dt>Wallet paying network gas</dt><dd className={styles.address}>{intent.sender}</dd></div><div className={styles.fact}><dt>{intent.kind === 'CREATE' || intent.step_key === 'safe_creation' ? 'Expected new contract' : 'Contract being configured'}</dt><dd className={styles.address}>{intent.expected_address}</dd></div></dl>
            <p>Native transfer value is zero. MetaMask shows the separate Amoy gas fee.</p><label className={styles.check}><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} />I checked the wallet, contract and action.</label>
            <button type="button" className={styles.primary} disabled={disabled || !reviewed || wallet.account.toLowerCase() !== intent.sender.toLowerCase()} onClick={() => void run(send)}>Submit this step with MetaMask</button></div>
            : <div className={styles.notice}><strong>{state === 'UNKNOWN' ? step.step_key === 'trex_version' ? 'Check your saved transaction' : 'Submission outcome is uncertain' : state === 'BROADCAST' || state === 'PENDING' ? 'Transaction saved; awaiting confirmation' : 'This transaction needs recovery review'}</strong><p>No transaction is repeated automatically.</p>
              {['UNKNOWN', 'BROADCAST', 'PENDING'].includes(step.state) && step.step_key === 'trex_version' ? <div className={styles.review}>
                <p>{step.transaction_hash ? 'Check which saved attempt was confirmed. This also recovers an earlier attempt if it won instead.' : 'Did MetaMask return without a transaction reference? Check the blockchain here. You do not need to find a reference in the wallet yourself.'}</p>
                <button type="button" className={styles.secondary} disabled={disabled} onClick={() => void run(checkRecovery)}>Check transaction and recover</button>
                {state === 'UNKNOWN' && !step.transaction_hash && recovery?.proof?.status === 'RETRY_AVAILABLE' ? <>
                  <p>The observers allow another attempt of this exact saved action, using transaction number {intent?.nonce}. An earlier request could still compete with it; only one can execute. MetaMask may show a replacement fee.</p>
                  <dl className={styles.facts}><div className={styles.fact}><dt>Contract</dt><dd className={styles.address}>{intent?.to}</dd></div><div className={styles.fact}><dt>Native transfer</dt><dd>0 POL, plus Amoy test-POL gas</dd></div></dl>
                  <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} />I reviewed this same action, wallet and transaction number.</label>
                  <button type="button" className={styles.primary} disabled={disabled || !reviewed || wallet.account.toLowerCase() !== intent?.sender} onClick={() => void run(retryWithWallet)}>Retry this saved step with MetaMask</button>
                </> : recovery?.proof?.status === 'WAITING' ? <p>{recovery.proof.reason_code === 'SETUP_RETRY_LIMIT_REACHED' ? 'The retry limit was reached. The original operation is retained for recovery review; no further wallet request is authorised.'
                  : recovery.lease ? `A wallet attempt is reserved until ${new Date(recovery.lease.expires_at).toLocaleTimeString()}. Check the transaction again after that time.`
                    : 'The transaction is not yet safe to retry. Keep the original record and check again; no new wallet request was authorised.'}</p> : null}
              </div> : null}
              {!step.transaction_hash ? <><label className={styles.field}>Original transaction hash<input value={transactionHash} onChange={event => setTransactionHash(event.target.value)} placeholder="0x…" disabled={disabled} /></label><button type="button" className={styles.secondary} disabled={disabled || !hash.test(transactionHash)} onClick={() => void run(saveTransactionReference)}>Save original transaction hash</button></> : <><button type="button" className={styles.primary} disabled={disabled} onClick={() => void run((signal, current) => verify(signal, current, step.id))}>Check transaction confirmation</button><label className={styles.field}>Correct the original transaction reference, if mistyped<input value={transactionHash} onChange={event => setTransactionHash(event.target.value)} placeholder="0x…" disabled={disabled} /></label><button type="button" className={styles.secondary} disabled={disabled || !hash.test(transactionHash) || transactionHash.toLowerCase() === step.transaction_hash.toLowerCase() || !['UNKNOWN', 'BROADCAST', 'PENDING'].includes(step.state)} onClick={() => void run((signal, current) => command('RECORD_HASH', { setup_id: setup.id, expected_revision: setup.revision, step_id: step.id, expected_step_revision: step.revision, transaction_hash: transactionHash.toLowerCase() }, signal, current))}>Save corrected reference, retaining history</button></>}
            </div>}
        </div></section> : <FundReleaseAdmission setupId={setup.id} revision={setup.revision} actorId={actorId} operatingContext={operatingContext} onRefresh={onRefresh} />}
        <button type="button" className={styles.secondary} aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>{showHistory ? 'Hide setup records' : 'View setup records'}</button>
        {showHistory ? <ol className={styles.stack}>{setup.steps.map(item => <li key={item.id}><strong>{names[item.step_key]}</strong><span> · {item.state.replaceAll('_', ' ').toLowerCase()}</span>{item.transaction_hash ? <p className={styles.address}>{item.transaction_hash}</p> : null}</li>)}</ol> : null}
      </>}
  </div>
}
