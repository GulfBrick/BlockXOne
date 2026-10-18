'use client'

import { useEffect, useRef, useState } from 'react'
import { Interface, TypedDataEncoder, verifyTypedData } from 'ethers'
import { z } from 'zod'
import { portalContextKey, portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { fundAuthorityAlignmentResponseSchema, fundAuthoritySafeTypes, type FundAuthorityAlignmentResponse } from '@/lib/portal/fund-authority-alignment-contracts'
import { setupPost } from '@/lib/portal/fund-setup-client'
import { prepareAmoyWalletTransaction, validateRecoveryNonce, walletErrorMessage } from '@/lib/testnet-fund/wallet-transaction'
import { useFundWallet, WalletPicker } from './fund-lifecycle'
import styles from './fund-lifecycle.module.css'

const txHash = z.string().regex(/^0x[0-9a-f]{64}$/)
const signature = z.string().regex(/^0x[0-9a-f]{130}$/)
const SAFE = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)'])
const CONTROLLER = new Interface(['function advanceAuthorityEpoch(uint256 nextEpoch,bytes32 reasonHash)'])
const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/** The same fund, same MetaMask connector and same shell. No browser-created authority or second send. */
export function FundAuthorityAlignment({ setupId, revision, actorId, operatingContext, onAligned }: {
  setupId: string; revision: number; actorId: string; operatingContext: PortalOperatingContext; onAligned: () => Promise<void>
}) {
  const wallet = useFundWallet(actorId, operatingContext)
  const [record, setRecord] = useState<FundAuthorityAlignmentResponse | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [reviewed, setReviewed] = useState(false), [hash, setHash] = useState('')
  const [claimUncertain, setClaimUncertain] = useState(false)
  const currentRecord = useRef(record); currentRecord.current = record
  const lock = useRef(false), generation = useRef(0), alive = useRef(false), controller = useRef<AbortController | null>(null)
  const scope = `${actorId}:${portalContextKey(operatingContext)}:${setupId}:${revision}`
  const scopeKey = portalContextKey(operatingContext)
  const renderedIdentity = useRef({ scope, authorised: wallet.authorizedContext, account: wallet.account, provider: wallet.provider })
  renderedIdentity.current = { scope, authorised: wallet.authorizedContext, account: wallet.account, provider: wallet.provider }
  useEffect(() => {
    alive.current = true; generation.current++; lock.current = false; setRecord(null); setHash(''); setMessage(''); setBusy(false); setClaimUncertain(false)
    return () => { alive.current = false; generation.current++; controller.current?.abort(); lock.current = false }
  }, [scope, wallet.authorizedContext])
  useEffect(() => setReviewed(false), [wallet.account, wallet.provider, record?.operation?.revision])
  function accept(raw: unknown) {
    const result = fundAuthorityAlignmentResponseSchema.parse(raw)
    if (result.actor_id !== actorId || result.setup_id !== setupId || result.setup_revision !== revision
      || !portalContextMatches(result.operating_context, operatingContext)) throw new Error('This result belongs to another account or fund. Refresh your current workspace.')
    setRecord(result); currentRecord.current = result
    setClaimUncertain(Boolean(result.operation?.claimed_at))
    if (result.operation?.transaction_hash) setHash(result.operation.transaction_hash)
    else if (result.operation) {
      try { const saved = sessionStorage.getItem(`bx1:authority-hash:v1:${scope}:${result.operation.id}`)
        if (saved && txHash.safeParse(saved).success) setHash(saved)
      } catch { /* Original public hash also remains in wallet Activity. */ }
    }
    return result
  }
  async function post(body: Record<string, unknown>, signal: AbortSignal) {
    return setupPost('/api/portal/fund-lifecycle/authority-alignment', { ...body, setup_id: setupId, setup_revision: revision }, actorId, operatingContext, signal)
  }
  async function run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (lock.current || !wallet.authorizedContext) return
    lock.current = true; setBusy(true); setMessage('Checking the saved fund authority…')
    const attempt = generation.current, abort = new AbortController(); controller.current = abort
    const identity = renderedIdentity.current
    const current = () => alive.current && generation.current === attempt && !abort.signal.aborted
      && renderedIdentity.current.scope === identity.scope && renderedIdentity.current.authorised
      && renderedIdentity.current.account === identity.account && renderedIdentity.current.provider === identity.provider
    const timer = setTimeout(() => abort.abort(), 115000)
    try { await work(abort.signal, current) }
    catch (error) { if (current()) setMessage(walletErrorMessage(error)); else if (alive.current && generation.current === attempt) setMessage('The check timed out. Refresh this original signing setup; do not send again.') }
    finally { clearTimeout(timer); if (alive.current && generation.current === attempt) { lock.current = false; setBusy(false) } }
  }
  async function refresh(signal: AbortSignal, current: () => boolean) {
    const result = await post({ action: 'READ' }, signal)
    if (current()) { accept(result); setMessage('Saved signing progress refreshed. Nothing was signed or sent.') }
  }
  async function prepare(signal: AbortSignal, current: () => boolean) {
    // A remount may be resuming an uncertain original transaction, never a new preparation.
    const existing = await post({ action: 'READ' }, signal)
    if (!current()) return
    const original = accept(existing)
    if (original.already_aligned || original.operation?.state === 'FINAL') {
      setMessage('The verified signing policy is restored. Continuing the original fund release.'); await onAligned(); return
    }
    if (original.operation?.claimed_at || original.operation?.intent) {
      setMessage(original.operation.claimed_at ? 'The original submission is saved. Check its confirmation; do not submit again.' : 'The original signing request is restored. Continue with its remaining wallet signatures.')
      return
    }
    const result = await post({ action: 'PREPARE', request_key: crypto.randomUUID() }, signal)
    if (!current()) return
    const saved = accept(result)
    if (saved.already_aligned) { setMessage('The signing policy is aligned. Continuing the original fund release check.'); await onAligned() }
    else setMessage('Review this authority change, then record both wallet signatures. Signing does not send a transaction.')
  }
  async function sign(signal: AbortSignal, current: () => boolean) {
    const op = currentRecord.current?.operation, intent = op?.intent, signer = wallet.account
    if (!op || !intent || !reviewed || !intent.safe_owners.includes(signer) || op.signing_addresses.includes(signer) || op.claimed_at) return
    const attempt = wallet.begin(), domain = { chainId: 80002, verifyingContract: intent.safe_address }
    if (Date.parse(intent.valid_until) <= Date.now() || TypedDataEncoder.hash(domain, fundAuthoritySafeTypes, intent.safe_transaction).toLowerCase() !== intent.safe_transaction_hash) throw new Error('This signing request is no longer current. Refresh its saved state.')
    await wallet.check(attempt.provider, signer, 80002, attempt.current)
    if (!current() || !attempt.current()) return
    const data = { domain, types: { EIP712Domain: [{ name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }], ...fundAuthoritySafeTypes }, primaryType: 'SafeTx', message: intent.safe_transaction }
    const signed = signature.parse(await attempt.provider.request({ method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(data)] }))
    if (!current() || !attempt.current()) return
    await wallet.check(attempt.provider, signer, 80002, attempt.current)
    if (!current() || !attempt.current() || verifyTypedData(domain, fundAuthoritySafeTypes, intent.safe_transaction, signed).toLowerCase() !== signer) return
    const result = await post({ action: 'SIGN', request_key: crypto.randomUUID(), operation_id: op.id,
      expected_revision: op.revision, signing_address: signer, signature: signed }, signal)
    if (current() && attempt.current()) { accept(result); setMessage('Wallet signature saved. Use the other appointed account in MetaMask for the next signature. No transaction was sent.') }
  }
  async function send(signal: AbortSignal, current: () => boolean) {
    const op = currentRecord.current?.operation, intent = op?.intent
    if (!op || !intent || !reviewed || op.claimed_at || wallet.account !== intent.executor_address || op.signing_addresses.length < intent.safe_threshold) return
    const attempt = wallet.begin()
    await wallet.check(attempt.provider, intent.executor_address, 80002, attempt.current)
    if (!current() || !attempt.current()) return
    setClaimUncertain(true)
    const result = await post({ action: 'CLAIM', request_key: crypto.randomUUID(), operation_id: op.id, expected_revision: op.revision }, signal)
    if (!current() || !attempt.current()) return
    const leased = accept(result), execution = leased.execution, saved = leased.operation
    if (!execution || !saved?.intent || saved.id !== op.id || saved.intent.safe_transaction_hash !== intent.safe_transaction_hash
      || execution.from !== intent.executor_address || execution.to !== intent.safe_address || execution.nonce !== intent.executor_nonce) throw new Error('The execution claim could not be verified. Check its original state; do not send.')
    const inner = CONTROLLER.decodeFunctionData('advanceAuthorityEpoch', intent.safe_transaction.data)
    const outer = SAFE.decodeFunctionData('execTransaction', execution.data), s = intent.safe_transaction
    if (String(inner[0]) !== String(intent.target_epoch) || String(inner[1]).toLowerCase() !== intent.reason_hash
      || String(outer[0]).toLowerCase() !== s.to || String(outer[1]) !== '0' || String(outer[2]).toLowerCase() !== s.data
      || Number(outer[3]) !== 0 || ['4', '5', '6'].some(index => String(outer[Number(index)]) !== '0')
      || String(outer[7]).toLowerCase() !== s.gasToken || String(outer[8]).toLowerCase() !== s.refundReceiver) throw new Error('The wallet payload differs from the reviewed authority change. Check its saved claim; nothing was sent.')
    const fee = await prepareAmoyWalletTransaction(attempt.provider, { from: execution.from, to: execution.to, data: execution.data, value: '0x0' })
    if (!current() || !attempt.current()) return
    if (BigInt(fee.nonce) !== BigInt(intent.executor_nonce) || fee.transaction.chainId !== '0x13882') throw new Error('The executor nonce or network changed. Check the original claim; nothing was sent.')
    await validateRecoveryNonce(attempt.provider, execution.from, fee.nonce)
    await wallet.check(attempt.provider, execution.from, 80002, attempt.current)
    if (!current() || !attempt.current() || Date.parse(intent.valid_until) <= Date.now()) return
    const sent = txHash.parse(await attempt.provider.request({ method: 'eth_sendTransaction', params: [fee.transaction] }))
    try { sessionStorage.setItem(`bx1:authority-hash:v1:${scope}:${op.id}`, sent) } catch { /* Human can recover the public reference from wallet Activity. */ }
    if (!current() || !attempt.current()) return
    setHash(sent)
    const recorded = await post({ action: 'HASH', request_key: crypto.randomUUID(), operation_id: saved.id, expected_revision: saved.revision, transaction_hash: sent }, signal)
    if (current() && attempt.current()) { accept(recorded); setMessage('Transaction reference saved. Check confirmation below; a wallet notification alone is not finality.') }
  }
  async function verify(signal: AbortSignal, current: () => boolean) {
    const op = currentRecord.current?.operation
    if (!op) return
    let latest = op
    if (!op.transaction_hash && txHash.safeParse(hash).success) {
      const recorded = await post({ action: 'HASH', request_key: crypto.randomUUID(), operation_id: op.id, expected_revision: op.revision, transaction_hash: hash }, signal)
      if (!current()) return
      const saved = accept(recorded).operation
      if (!saved) return
      latest = saved
    }
    const result = await post({ action: 'VERIFY', request_key: crypto.randomUUID(), operation_id: latest.id, expected_revision: latest.revision }, signal)
    if (!current()) return
    const saved = accept(result)
    if (saved.operation?.state === 'FINAL') { setMessage('Both observers confirmed the Safe execution and authority change. Continuing the original fund release.'); await onAligned() }
    else setMessage(saved.operation?.state === 'REVERTED' ? 'The original transaction failed. Its history is retained for recovery; do not send another.'
      : 'The original transaction is not yet final. Its claim remains saved; check confirmation again without resending.')
  }
  const op = record?.operation, intent = op?.intent
  const claimed = Boolean(op?.claimed_at) || claimUncertain, signatures = op?.signing_addresses ?? []
  const canSign = Boolean(intent && !claimed && intent.safe_owners.includes(wallet.account) && !signatures.includes(wallet.account))
  const quorum = Boolean(intent && new Set(signatures).size >= intent.safe_threshold)
  return <div className={styles.form} aria-label="Fund signing policy handoff" data-context={scopeKey}>
    <h4>Confirm the fund signing policy</h4>
    {!record ? <><p>Link the deployed controller to the fund’s approved signing policy. This keeps your completed setup and does not issue units or move TST.</p>
      <button type="button" className={styles.primary} disabled={busy || !wallet.authorizedContext} onClick={() => void run(prepare)}>{busy ? 'Checking signing setup…' : 'Check signing setup'}</button></>
      : record.already_aligned || op?.state === 'FINAL' ? <p className={styles.verified}>The signing policy is aligned. Continue with the original fund release.</p>
        : intent ? <>
          <p>Update signing authority from version {intent.previous_epoch} to {intent.target_epoch}. Your existing {intent.safe_threshold}-wallet Safe remains in control.</p>
          <p>Controller: <span className={styles.address}>{shorten(intent.controller_address)}</span> · Safe: <span className={styles.address}>{shorten(intent.safe_address)}</span></p>
          {!claimed ? <><p>{signatures.length} of {intent.safe_threshold} wallet signatures saved. {quorum ? `Switch to ${shorten(intent.executor_address)} to submit once.` : 'Select each appointed account in MetaMask and save its signature.'}</p>
            <WalletPicker wallet={wallet} chainId={80002} busy={busy} />
            <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I reviewed the controller, authority change and signing wallets.</label>
            {!quorum ? <button type="button" className={styles.primary} disabled={busy || !reviewed || !canSign} onClick={() => void run(sign)}>Sign this authority change in MetaMask</button>
              : <><p>Submitting uses Amoy test POL for gas only. No native transfer, token allowance or TST payment is requested.</p>
                <button type="button" className={styles.primary} disabled={busy || !reviewed || wallet.account !== intent.executor_address} onClick={() => void run(send)}>Submit this authority change with MetaMask</button></>}
          </> : <><p>The original submission must be checked. Do not submit it again.</p>
            {op?.transaction_hash ? <p>Transaction: <span className={styles.address}>{op.transaction_hash}</span></p> : <label className={styles.field}>Original transaction hash (optional)<input value={hash} onChange={event => setHash(event.target.value.toLowerCase())} disabled={busy} autoComplete="off" /><small>Leave blank to look for the original transaction automatically.</small></label>}
            <button type="button" className={styles.primary} disabled={busy || op?.state === 'REVERTED'} onClick={() => void run(op?.claimed_at ? verify : refresh)}>{busy ? 'Checking original transaction…' : op?.claimed_at ? 'Check original confirmation' : 'Check saved submission state'}</button>
          </>}
        </> : <button type="button" className={styles.primary} disabled={busy} onClick={() => void run(prepare)}>Prepare the authority change</button>}
    {record ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void run(refresh)}>Refresh saved signing progress</button> : null}
    {message ? <p className={styles.feedback} role="status" aria-live="polite">{message}</p> : null}
  </div>
}
