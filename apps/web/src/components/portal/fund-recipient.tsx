'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TypedDataEncoder, verifyMessage, verifyTypedData } from 'ethers'
import { z } from 'zod'
import type { MetaMaskProvider } from '@/components/workspace/metamask-wallet-link'
import { fundRecipientSnapshotSchema, fundRecipientIntentSchema, fundRecipientSigningRequestSchema, type FundRecipientSnapshot } from '@/lib/portal/fund-recipient-contracts'
import { portalContextKey, portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { setupPost } from '@/lib/portal/fund-setup-client'
import { prepareAmoyWalletTransaction, validateRecoveryNonce } from '@/lib/testnet-fund/wallet-transaction'
import styles from './fund-lifecycle.module.css'

export type RecipientWallet = {
  account: string; provider: MetaMaskProvider | null; authorizedContext: boolean;
  begin: () => { provider: MetaMaskProvider; signal: AbortSignal; current: () => boolean };
  check: (provider: MetaMaskProvider, account: string, chain: number, current: () => boolean) => Promise<void>;
}
const safeTypes = { SafeTx: [
  { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' },
  { name: 'safeTxGas', type: 'uint256' }, { name: 'baseGas', type: 'uint256' }, { name: 'gasPrice', type: 'uint256' },
  { name: 'gasToken', type: 'address' }, { name: 'refundReceiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
] }
const txHash = z.string().regex(/^0x[0-9a-f]{64}$/)
const signature = z.string().regex(/^0x[0-9a-f]{130}$/)
const signedTransactionSchema = z.object({ to: z.string().regex(/^0x[0-9a-f]{40}$/), value: z.literal('0'),
  data: z.string().regex(/^0x(?:[0-9a-f]{2})+$/), nonce: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict()
type Pending = { path: string; body: Record<string, unknown> }
const paths = new Set(['command', 'claim-signature', 'signature', 'claim'])
const phaseNames = { CREATE_IDENTITY: 'Create delivery-wallet identity', ADD_CLAIM: 'Install the reviewed identity claim', REGISTER_IDENTITY: 'Register the eligible investor wallet', REVOKE_CLAIM: 'Revoke the existing claim' }

/** The order's guarded wallet/eligibility handoff, not a second onboarding app. */
export function FundRecipient({ bindingId, productId, accountId, actorId, operatingContext, wallet, renderWalletPicker, onRefresh }: {
  bindingId: string; productId: string; accountId: string; actorId: string; operatingContext: PortalOperatingContext;
  wallet: RecipientWallet; renderWalletPicker: (busy: boolean) => ReactNode; onRefresh: () => void | Promise<void>
}) {
  const [snapshot, setSnapshot] = useState<FundRecipientSnapshot | null>(null), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(''), [reviewed, setReviewed] = useState(false), [hash, setHash] = useState(''), [uncertain, setUncertain] = useState(false)
  const [claimPreview, setClaimPreview] = useState<{ case_id: string; expected_revision: number; signing_request: z.infer<typeof fundRecipientSigningRequestSchema> } | null>(null)
  const generation = useRef(0), lock = useRef(false), abort = useRef<AbortController | null>(null), pending = useRef<Pending | null>(null)
  const saved = useRef<FundRecipientSnapshot | null>(null); saved.current = snapshot
  const scope = `${actorId}:${portalContextKey(operatingContext)}:${bindingId}`
  const key = `bx1:recipient-request:v1:${scope}`
  const role = operatingContext.mode === 'APPLICANT' ? 'Investor' : operatingContext.role
  const investor = role === 'Investor', compliance = role === 'ComplianceOfficer', tokenAgent = role === 'TokenisationAgent'
  const caseRecord = snapshot?.case
  const operation = snapshot?.operations.find(item => !['FINAL', 'FAILED'].includes(item.state)) ?? null
  const intent = operation?.intent ?? null
  const nextPhase = caseRecord?.state === 'IDENTITY_REQUIRED' ? 'CREATE_IDENTITY' : caseRecord?.state === 'CLAIM_INSTALL_REQUIRED' ? 'ADD_CLAIM'
    : caseRecord?.state === 'REGISTRATION_REQUIRED' ? 'REGISTER_IDENTITY' : null
  const canRequest = nextPhase === 'REGISTER_IDENTITY' ? tokenAgent : Boolean(nextPhase && investor)

  function accept(raw: unknown) {
    const parsed = fundRecipientSnapshotSchema.parse(raw)
    if (parsed.actor_id !== actorId || !portalContextMatches(parsed.operating_context, operatingContext)
      || parsed.case.delivery_binding_id !== bindingId || parsed.case.product_id !== productId || parsed.case.investment_account_id !== accountId) {
      throw new Error('This wallet registration does not belong to the current fund order. Refresh before continuing.')
    }
    setSnapshot(parsed); saved.current = parsed; setClaimPreview(null); setReviewed(false)
    return parsed
  }
  async function post(path: string, body: Record<string, unknown>, signal: AbortSignal) {
    return setupPost(`/api/portal/fund-lifecycle/recipient/${path}`, body, actorId, operatingContext, signal)
  }
  async function load(signal: AbortSignal, current: () => boolean) {
    const result = z.object({ delivery_binding_id: z.string().uuid(), case_id: z.string().uuid().nullable(), snapshot: fundRecipientSnapshotSchema.nullable() }).parse(
      await post('find', { delivery_binding_id: bindingId }, signal))
    if (!current()) return
    if (result.delivery_binding_id !== bindingId || result.case_id !== (result.snapshot?.case.id ?? null)) throw new Error('The wallet lookup was not confirmed for this order.')
    if (result.snapshot) accept(result.snapshot); else { setSnapshot(null); saved.current = null }
    setLoaded(true)
  }
  async function run(action: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (lock.current || !wallet.authorizedContext) return
    const attempt = generation.current, controller = new AbortController(); abort.current = controller
    const current = () => attempt === generation.current && !controller.signal.aborted
    lock.current = true; setBusy(true); setMessage('')
    try { await action(controller.signal, current) }
    catch (error) { if (current()) setMessage(error instanceof Error ? error.message : 'The existing wallet handoff could not be confirmed.') }
    finally { if (current()) { lock.current = false; setBusy(false) } }
  }
  async function mutate(path: string, body: Record<string, unknown>, signal: AbortSignal, current: () => boolean) {
    if (!paths.has(path)) throw new Error('This wallet command is not supported.')
    if (pending.current && JSON.stringify(pending.current) !== JSON.stringify({ path, body })) throw new Error('Check the original saved request before starting a different action.')
    const original = { path, body }; sessionStorage.setItem(key, JSON.stringify(original)); pending.current = original; setUncertain(true)
    const raw = await post(path, body, signal)
    if (!current()) return null
    const result = raw as { snapshot?: unknown }
    if (result.snapshot !== undefined) accept(result.snapshot)
    sessionStorage.removeItem(key); pending.current = null; setUncertain(false)
    return raw
  }
  useEffect(() => {
    generation.current++; lock.current = false; setBusy(false); setLoaded(false); setSnapshot(null); saved.current = null; setReviewed(false); setClaimPreview(null); setMessage(''); setHash('')
    pending.current = null; setUncertain(false)
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        if (raw.length > 65536) throw new Error('The original wallet request is unreadable. Ask the operator to recover it; do not resend.')
        const marker = z.object({ path: z.string(), body: z.record(z.unknown()) }).strict().parse(JSON.parse(raw))
        if (!paths.has(marker.path)) throw new Error('The original wallet request needs recovery.')
        pending.current = marker; setUncertain(true)
      }
      void run(load)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Request recovery is unavailable.'); setUncertain(true) }
    return () => { generation.current++; abort.current?.abort(); lock.current = false }
  }, [scope, wallet.authorizedContext])
  useEffect(() => { setReviewed(false); setClaimPreview(null) }, [wallet.account, wallet.provider, caseRecord?.revision, operation?.revision])
  useEffect(() => {
    if (!operation) return
    try {
      const original = operation.transaction_hash ?? localStorage.getItem(`bx1:recipient-hash:v1:${scope}:${operation.id}`)
      if (original && txHash.safeParse(original).success) setHash(original)
    } catch { /* The server UNKNOWN state still prevents a second submission. */ }
  }, [scope, operation?.id, operation?.transaction_hash])

  async function requestOperation(signal: AbortSignal, current: () => boolean) {
    if (!caseRecord || !nextPhase || !canRequest || !wallet.account) return
    const attempt = wallet.begin(); await wallet.check(attempt.provider, wallet.account, 80002, attempt.current)
    if (!current() || !attempt.current()) return
    await mutate('command', { command: 'REQUEST_OPERATION', request_key: crypto.randomUUID(), payload: { case_id: caseRecord.id,
      expected_revision: caseRecord.revision, phase: nextPhase, sender_address: wallet.account } }, signal, () => current() && attempt.current())
  }
  async function previewClaim(signal: AbortSignal, current: () => boolean) {
    if (!caseRecord || !compliance) return
    const result = z.object({ case_id: z.string().uuid(), expected_revision: z.number().int().positive(), signing_request: fundRecipientSigningRequestSchema }).strict().parse(
      await post('claim-preview', { case_id: caseRecord.id }, signal))
    if (result.case_id !== caseRecord.id || result.expected_revision !== caseRecord.revision || result.signing_request.signer_address !== caseRecord.claim_signer_address
      || result.signing_request.identity_address !== caseRecord.identity_address || result.signing_request.claim_topic !== caseRecord.claim_topic) throw new Error('The reviewed claim does not match this investor wallet.')
    if (current()) { setClaimPreview(result); setReviewed(false) }
  }
  async function signClaim(signal: AbortSignal, current: () => boolean) {
    if (!claimPreview || !reviewed || !compliance) return
    const attempt = wallet.begin(), request = claimPreview.signing_request
    await wallet.check(attempt.provider, request.signer_address, 80002, attempt.current)
    if (!current() || saved.current?.case.revision !== claimPreview.expected_revision) throw new Error('The eligibility review changed. Nothing was signed.')
    const result = signature.parse(await attempt.provider.request({ method: 'personal_sign', params: [request.message, request.signer_address] }))
    if (!current() || !attempt.current()) return
    if (verifyMessage(new Uint8Array(request.message.slice(2).match(/.{2}/g)!.map(byte => parseInt(byte, 16))), result).toLowerCase() !== request.signer_address) throw new Error('The approved claim-signing wallet did not sign this claim.')
    await wallet.check(attempt.provider, request.signer_address, 80002, attempt.current)
    await mutate('claim-signature', { case_id: claimPreview.case_id, expected_revision: claimPreview.expected_revision,
      request_key: crypto.randomUUID(), signature: result }, signal, () => current() && attempt.current())
  }
  async function signRegistration(signal: AbortSignal, current: () => boolean) {
    if (!intent?.safe_transaction || !operation || !tokenAgent || !reviewed || !intent.safe_owners.includes(wallet.account)) return
    const attempt = wallet.begin(), domain = { chainId: 80002, verifyingContract: intent.to! }
    const digest = TypedDataEncoder.hash(domain, safeTypes, intent.safe_transaction).toLowerCase()
    if (digest !== intent.safe_transaction_hash || Date.parse(intent.valid_until) <= Date.now()) throw new Error('The registry signature is no longer current.')
    await wallet.check(attempt.provider, wallet.account, 80002, attempt.current)
    const typedData = { domain, types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...safeTypes }, primaryType: 'SafeTx', message: intent.safe_transaction }
    const result = signature.parse(await attempt.provider.request({ method: 'eth_signTypedData_v4', params: [wallet.account, JSON.stringify(typedData)] }))
    if (!current() || !attempt.current()) return
    if (verifyTypedData(domain, safeTypes, intent.safe_transaction, result).toLowerCase() !== wallet.account) throw new Error('The appointed registry owner did not return this signature.')
    await wallet.check(attempt.provider, wallet.account, 80002, attempt.current)
    await mutate('signature', { operation_id: operation.id, expected_revision: operation.revision, request_key: crypto.randomUUID(),
      signing_address: wallet.account, signature: result }, signal, () => current() && attempt.current())
  }
  async function send(signal: AbortSignal, current: () => boolean) {
    if (!intent || !operation || !reviewed || operation.state !== 'PREPARED') return
    const attempt = wallet.begin()
    const original = fundRecipientIntentSchema.parse(intent)
    await wallet.check(attempt.provider, original.sender_address, 80002, attempt.current)
    if (Date.parse(original.valid_until) <= Date.now()) throw new Error('The original wallet instruction expired. Nothing was sent.')
    // Read-only fee/balance checks happen before a one-time UNKNOWN lease.
    const fee = original.safe_transaction ? null : await prepareAmoyWalletTransaction(attempt.provider, { from: original.sender_address,
      ...(original.to ? { to: original.to } : {}), data: original.transaction_data, value: '0x0' })
    if (fee && BigInt(fee.nonce) !== BigInt(original.sender_nonce)) throw new Error('The sender nonce changed. Refresh this original operation; no transaction was sent.')
    const claimed = await mutate('claim', { operation_id: operation.id, expected_revision: operation.revision, request_key: crypto.randomUUID() }, signal,
      () => current() && attempt.current()) as { snapshot: unknown; signed_transaction: unknown } | null
    if (!claimed || !current() || !attempt.current()) return
    const next = fundRecipientSnapshotSchema.parse(claimed.snapshot), leased = next.operations.find(item => item.id === operation.id)
    if (!leased?.intent || leased.state !== 'UNKNOWN' || leased.intent.expectation_hash !== original.expectation_hash || leased.intent.transaction_data !== original.transaction_data
      || leased.intent.to !== original.to || leased.intent.sender_nonce !== original.sender_nonce || leased.intent.sender_address !== original.sender_address) throw new Error('The exact submission lease was not confirmed. Check the existing operation; do not resend.')
    const safe = original.safe_transaction ? signedTransactionSchema.parse(claimed.signed_transaction) : null
    if (safe && (safe.to !== original.to || safe.nonce !== original.safe_transaction!.nonce)) throw new Error('The approved registry execution differs from this request. Nothing was sent; the original lease needs review.')
    if (!safe && claimed.signed_transaction !== null) throw new Error('An EOA wallet instruction cannot contain a substitute signing request.')
    const prepared = safe ? await prepareAmoyWalletTransaction(attempt.provider, { from: original.sender_address, to: safe.to, data: safe.data, value: '0x0' }) : fee
    if (!prepared) throw new Error('The exact transaction could not be prepared. The original submission lease needs review; do not resend.')
    if (BigInt(prepared.nonce) !== BigInt(original.sender_nonce) || prepared.transaction.from.toLowerCase() !== original.sender_address
      || prepared.transaction.data.toLowerCase() !== (safe?.data ?? original.transaction_data) || prepared.transaction.value !== '0x0'
      || prepared.transaction.chainId !== '0x13882' || (prepared.transaction.to?.toLowerCase() ?? null) !== original.to) throw new Error('Network-fee preparation changed the approved transaction. Nothing was sent; review the original lease.')
    await validateRecoveryNonce(attempt.provider, original.sender_address, prepared.nonce)
    await wallet.check(attempt.provider, original.sender_address, 80002, attempt.current)
    if (!current() || Date.parse(original.valid_until) <= Date.now() || saved.current?.operations.find(item => item.id === operation.id)?.state !== 'UNKNOWN') throw new Error('The leased wallet operation changed. Nothing was sent; review its original record.')
    const sent = txHash.parse(await attempt.provider.request({ method: 'eth_sendTransaction', params: [prepared.transaction] }))
    try { localStorage.setItem(`bx1:recipient-hash:v1:${scope}:${operation.id}`, sent) } catch { /* Retain the hash in MetaMask Activity if storage is unavailable. */ }
    if (!current() || !attempt.current()) return
    setHash(sent)
    await mutate('command', { command: 'RECORD_HASH', request_key: crypto.randomUUID(), payload: { operation_id: operation.id,
      expected_revision: leased.revision, transaction_hash: sent } }, signal, () => current() && attempt.current())
    if (current()) { setMessage('The original transaction hash is recorded. Check finality below; registration is not a holding.'); await onRefresh() }
  }
  async function retry(signal: AbortSignal, current: () => boolean) {
    const original = pending.current
    if (!original) return
    await mutate(original.path, original.body, signal, current)
    if (current()) { await load(signal, current); await onRefresh() }
  }
  const owner = nextPhase === 'REGISTER_IDENTITY' ? 'Tokenisation agent' : caseRecord?.state === 'CLAIM_SIGNATURE_REQUIRED' ? 'Compliance reviewer' : 'Investor'
  return <div className={styles.form}>
    <h3>Make this wallet eligible to receive fund units</h3>
    {!loaded ? <p className={styles.muted}>Loading this order’s wallet registration…</p> : !caseRecord ? <>
      <p>The verified delivery wallet must be linked to the approved investor eligibility before issuance.</p>
      {investor ? <button type="button" className={styles.secondary} disabled={busy || uncertain || !wallet.authorizedContext} onClick={() => void run(async (signal, current) => {
        await mutate('command', { command: 'CREATE_CASE', request_key: crypto.randomUUID(), payload: { delivery_binding_id: bindingId } }, signal, current)
      })}>Start this wallet’s registration</button> : <p className={styles.muted}>The investor starts this step in the same saved order.</p>}</>
      : caseRecord.state === 'READY' ? <p className={styles.verified}>The identity and registration have verified chain evidence. Eligibility and delivery authority are rechecked before issuance; no units were issued by this step.</p>
        : <><p>Next owner: {owner}. {caseRecord.state === 'CLAIM_SIGNATURE_REQUIRED' ? 'Review the approved eligibility and sign its exact identity claim.' : nextPhase ? phaseNames[nextPhase] : 'This saved registration needs recovery review; no replacement is authorised.'}</p>
          {renderWalletPicker(busy)}
          {canRequest && !operation ? <button type="button" className={styles.secondary} disabled={busy || uncertain || !wallet.account} onClick={() => void run(requestOperation)}>Prepare the next wallet step</button> : null}
          {compliance && caseRecord.state === 'CLAIM_SIGNATURE_REQUIRED' && !claimPreview ? <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={() => void run(previewClaim)}>Review the exact eligibility claim</button> : null}
          {claimPreview ? <div className={styles.review}><p>Claim signer: <span className={styles.address}>{claimPreview.signing_request.signer_address}</span></p>
            <p>This claim is bound to the fund, investment account, reviewed eligibility and delivery wallet. It is not a payment or token allowance.</p>
            <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy || uncertain} onChange={event => setReviewed(event.target.checked)} />I reviewed this exact investor claim.</label>
            <button type="button" className={styles.primary} disabled={busy || uncertain || !reviewed || wallet.account !== claimPreview.signing_request.signer_address} onClick={() => void run(signClaim)}>Sign the reviewed claim in MetaMask</button></div> : null}
          {operation ? <div className={styles.review}><h4>{phaseNames[operation.phase]}</h4><p>{operation.state.replaceAll('_', ' ').toLowerCase()}</p>
            {operation.state === 'REQUESTED' ? <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={() => void run(async (signal, current) => {
              const result = await post('prepare', { operation_id: operation.id, expected_revision: operation.revision }, signal) as { snapshot: unknown }
              if (current()) accept(result.snapshot)
            })}>Review this prepared wallet transaction</button> : null}
            {intent && operation.state === 'PREPARED' ? <><p>Signing wallet: <span className={styles.address}>{intent.sender_address}</span></p>
              <p>Identity: <span className={styles.address}>{intent.expected_identity_address}</span></p>
              <p>Only the Amoy network fee is payable. Units and holdings remain separate.</p>
              <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy || uncertain} onChange={event => setReviewed(event.target.checked)} />I checked the wallet, identity and action.</label>
              {intent.safe_transaction ? <><p>{operation.signatures.filter(value => value.status === 'VERIFIED').length} of {intent.safe_threshold} signing keys recorded. Switch the appointed account in MetaMask to add its signature.</p>
                <button type="button" className={styles.secondary} disabled={busy || uncertain || !reviewed || !tokenAgent || !intent.safe_owners.includes(wallet.account)} onClick={() => void run(signRegistration)}>Sign the registry request in MetaMask</button></> : null}
              <button type="button" className={styles.primary} disabled={busy || uncertain || !reviewed || wallet.account !== intent.sender_address
                || Boolean(intent.safe_transaction && operation.signatures.filter(value => value.status === 'VERIFIED').length < intent.safe_threshold)} onClick={() => void run(send)}>Submit this exact wallet step in MetaMask</button></> : null}
            {['UNKNOWN', 'BROADCAST', 'PENDING', 'RECOVERY_REQUIRED'].includes(operation.state) ? <div className={styles.notice}><strong>Check the original transaction; do not send it again</strong>
              {!operation.transaction_hash ? <><label className={styles.field}>Original wallet-step transaction hash<input value={hash} onChange={event => setHash(event.target.value.toLowerCase())} disabled={busy || uncertain} autoComplete="off" /></label>
                <button type="button" className={styles.secondary} disabled={busy || uncertain || !txHash.safeParse(hash).success} onClick={() => void run(async (signal, current) => {
                  await mutate('command', { command: 'RECORD_HASH', request_key: crypto.randomUUID(), payload: { operation_id: operation.id, expected_revision: operation.revision, transaction_hash: hash } }, signal, current)
                })}>Record the existing hash</button></> : <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={() => void run(async (signal, current) => {
                  const result = await post('verify', { operation_id: operation.id, expected_revision: operation.revision }, signal) as { snapshot: unknown }
                  if (current()) { accept(result.snapshot); await onRefresh() }
                })}>Check final chain evidence</button>}</div> : null}
          </div> : null}</>}
    {uncertain ? <div className={styles.notice}><p>The original request needs confirmation. Do not start a replacement.</p><button type="button" className={styles.secondary} disabled={busy || !pending.current} onClick={() => void run(retry)}>Check original wallet request</button></div> : null}
    {message ? <p className={styles.feedback} role="status" aria-live="polite">{message}</p> : null}
    <button type="button" className={styles.secondary} disabled={busy} onClick={() => void run(load)}>Refresh wallet registration</button>
  </div>
}
