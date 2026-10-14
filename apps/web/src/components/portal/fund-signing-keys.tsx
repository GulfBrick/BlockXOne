'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { MetaMaskWalletLink } from '@/components/workspace/metamask-wallet-link'
import { portalContextKey, portalContextMatches, portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { setupPost } from '@/lib/portal/fund-setup-client'
import { usePortalActorId, usePortalOperatingContext } from './portal-client'
import styles from './fund-lifecycle.module.css'

const address = z.string().regex(/^0x[0-9a-f]{40}$/i), id = z.string().uuid()
const policySchema = z.object({ policy_id: id, authority_epoch: z.number().int().positive(), expires_at: z.string(),
  wallet_slots: z.array(z.object({ slot: z.string(), wallet_address: address, control_proof_current: z.boolean(), wallet_id: id.nullable().optional() })).max(20) })
const walletSchema = z.object({ organisation: z.object({ id, name: z.string() }), configured: z.boolean(),
  wallets: z.array(z.object({ id, organisationId: id, address, chainId: z.literal(80002), verifiedAt: z.string(), status: z.literal('PENDING') })).max(100) })

/** Real wallet control is distinct from the investor's delivery-wallet binding. */
export function FundSigningKeys({ productId, actorId, operatingContext, onRefresh }: {
  productId: string; actorId: string; operatingContext: PortalOperatingContext; onRefresh: () => Promise<void>
}) {
  const currentActor = usePortalActorId(), currentContext = usePortalOperatingContext()
  const [policy, setPolicy] = useState<z.infer<typeof policySchema> | null>(null), [wallets, setWallets] = useState<z.infer<typeof walletSchema> | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const generation = useRef(0), lock = useRef(false), abort = useRef<AbortController | null>(null)
  const authorised = actorId === currentActor && portalContextMatches(currentContext, operatingContext)
  const identity = `${actorId}:${portalContextKey(operatingContext)}:${productId}`
  async function refresh() {
    if (!authorised || lock.current) return
    const attempt = generation.current, controller = new AbortController(); abort.current = controller
    lock.current = true; setBusy(true); setMessage('')
    try {
      const raw = await setupPost('/api/portal/fund-lifecycle/keys/read', { product_id: productId }, actorId, operatingContext, controller.signal)
      const data = z.object({ policy: policySchema.nullable() }).parse(raw)
      if (attempt !== generation.current || controller.signal.aborted) return
      setPolicy(data.policy)
      if (!data.policy || operatingContext.mode !== 'ROLE' || operatingContext.role !== 'TokenisationAgent') return
      const response = await fetch('/api/wallet/context', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'x-bx1-expected-actor': actorId },
        body: new URLSearchParams({ organisationId: operatingContext.organisationId }), signal: controller.signal })
      const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null
      if (!response.ok || result?.ok !== true) throw new Error('Wallet proof records could not be loaded. No signing key was enabled.')
      const saved = walletSchema.parse(result.context)
      if (saved.organisation.id !== operatingContext.organisationId || saved.wallets.some(wallet => wallet.organisationId !== saved.organisation.id)) throw new Error('Wallet records do not match this organisation.')
      if (attempt === generation.current && !controller.signal.aborted) setWallets(saved)
    } catch (error) { if (attempt === generation.current) setMessage(error instanceof Error ? error.message : 'Signing keys could not be loaded.') }
    finally { if (attempt === generation.current) { lock.current = false; setBusy(false) } }
  }
  useEffect(() => { generation.current++; setPolicy(null); setWallets(null); lock.current = false; setBusy(false); void refresh()
    return () => { generation.current++; abort.current?.abort(); lock.current = false }
  }, [identity, authorised, currentActor, portalContextKey(currentContext)])
  async function bind(slot: z.infer<typeof policySchema>['wallet_slots'][number], walletId: string) {
    if (!policy || !authorised || lock.current) return
    const attempt = generation.current, controller = new AbortController(); abort.current = controller; lock.current = true; setBusy(true); setMessage('')
    try {
      const result = z.object({ policy_id: id, authority_epoch: z.number().int(), wallet_slot: z.string(), signing_address: address }).parse(
        await setupPost('/api/portal/fund-lifecycle/keys/bind', { policy_id: policy.policy_id, authority_epoch: policy.authority_epoch,
          wallet_slot: slot.slot, wallet_id: walletId }, actorId, operatingContext, controller.signal))
      if (result.policy_id !== policy.policy_id || result.authority_epoch !== policy.authority_epoch || result.wallet_slot !== slot.slot
        || result.signing_address.toLowerCase() !== slot.wallet_address.toLowerCase()) throw new Error('The saved signing-key binding did not match this slot.')
      if (attempt !== generation.current || controller.signal.aborted) return
      lock.current = false; await refresh(); await onRefresh()
    } catch (error) { if (attempt === generation.current) setMessage(error instanceof Error ? error.message : 'The signing-key proof was not confirmed.') }
    finally { if (attempt === generation.current) { lock.current = false; setBusy(false) } }
  }
  if (!policy) return message ? <p className={styles.feedback} role="status">{message}</p> : null
  if (operatingContext.mode !== 'ROLE') return null
  return <section className={styles.card}><div className={styles.cardBody}>
    <h3>Prove the appointed signing wallets</h3>
    {operatingContext.role !== 'TokenisationAgent' ? <><p>Wallet-control proofs are completed in the tokenisation capacity for this same fund.</p>
      <Link className={styles.secondary} href={portalScopeHref('/portal/products/detail', { ...operatingContext, role: 'TokenisationAgent' }, productId)}>Open this fund as tokenisation agent</Link></>
      : <><p>Connect and verify each appointed key through MetaMask, then bind its proof below. This does not transfer tokens, issue units or change your investor delivery wallet.</p>
        {wallets ? <MetaMaskWalletLink appearance="portal" organisations={[wallets.organisation]} wallets={wallets.wallets} configured={wallets.configured} expectedActorId={actorId} onRefresh={() => { void refresh() }} /> : null}
        <ul className={styles.stack}>{policy.wallet_slots.map(slot => {
          const wallet = wallets?.wallets.find(item => item.address.toLowerCase() === slot.wallet_address.toLowerCase())
          return <li key={slot.slot}><strong>{slot.control_proof_current ? 'Proof current' : 'Proof required'}</strong><p className={styles.address}>{slot.wallet_address}</p>
            {!slot.control_proof_current && wallet ? <button type="button" className={styles.secondary} disabled={busy || !authorised} onClick={() => void bind(slot, wallet.id)}>Bind this verified key to its signing slot</button> : null}</li>
        })}</ul>
        <button type="button" className={styles.secondary} disabled={busy || !authorised} onClick={() => void refresh()}>Refresh signing proofs</button></>}
    {message ? <p className={styles.feedback} role="status" aria-live="polite">{message}</p> : null}
  </div></section>
}
