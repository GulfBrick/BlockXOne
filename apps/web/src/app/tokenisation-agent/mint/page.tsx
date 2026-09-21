'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, CircleDashed, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'

import {
  GovernedOperationReview,
  type ChainOperationDecision,
} from '@/components/chain-operation-review'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context-v2'
import {
  blockXOneApi,
  type ChainOperationApprovalQueueItem,
  type ChainOperationRecord,
  type MintQueueItem,
} from '@/lib/api-client'
import { baseUnitsToExactDecimal, formatExactUnits } from '@/lib/exact-decimal'
import { type ControlledIssuanceResponse } from '@/lib/pilot-finance'
import { isManagedTestnetRuntime } from '@/lib/runtime-scope'
import {
  isMintQueueItemReady,
  isMintQueueItemForRuntime,
  mintIdempotencyKey,
  mintOperationIDForSubscription,
} from '@/lib/token-operations'

const governedMintKind = 'MINT_SUBSCRIPTION_UNITS'

function evidence(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? 'Not recorded' : String(value)
}

export default function MintTokensPage() {
  const { user } = useAuth()
  const managedTestnet = isManagedTestnetRuntime()
  const [subscriptionId, setSubscriptionId] = useState('')
  const [result, setResult] = useState<ControlledIssuanceResponse | null>(null)
  const [operation, setOperation] = useState<ChainOperationRecord | null>(null)
  const [approvalItems, setApprovalItems] = useState<ChainOperationApprovalQueueItem[]>([])
  const [reviewOperations, setReviewOperations] = useState<Record<string, ChainOperationRecord>>({})
  const [approvalQueueLoaded, setApprovalQueueLoaded] = useState(false)
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [mintQueueItems, setMintQueueItems] = useState<MintQueueItem[]>([])
  const [mintQueueLoaded, setMintQueueLoaded] = useState(false)
  const [mintQueueLoading, setMintQueueLoading] = useState(false)
  const [mintQueueError, setMintQueueError] = useState('')
  const [loading, setLoading] = useState(false)
  const [minting, setMinting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageFinal, setMessageFinal] = useState(false)
  const [error, setError] = useState('')
  const canMint = managedTestnet && user?.permissions?.['tokenops:mint'] === true

  const loadMintQueue = useCallback(async () => {
    if (!user || !canMint) {
      setMintQueueItems([])
      setMintQueueLoaded(false)
      return
    }
    setMintQueueLoading(true)
    setMintQueueItems([])
    setMintQueueLoaded(false)
    setMintQueueError('')
    try {
      const queue = await blockXOneApi.token.mintQueue(user.token, 'PAID')
      setMintQueueItems(queue.filter((item) => isMintQueueItemForRuntime(item, managedTestnet)))
      setMintQueueLoaded(true)
    } catch (caught) {
      setMintQueueError(
        caught instanceof Error ? caught.message : 'The authorised issuance queue is unavailable.'
      )
    } finally {
      setMintQueueLoading(false)
    }
  }, [canMint, managedTestnet, user])

  const loadApprovalQueue = useCallback(async () => {
    if (!managedTestnet || !user) {
      setApprovalItems([])
      setReviewOperations({})
      setApprovalQueueLoaded(false)
      return
    }
    setApprovalLoading(true)
    setApprovalItems([])
    setReviewOperations({})
    setApprovalQueueLoaded(false)
    try {
      const queue = (await blockXOneApi.chainOperation.approvalQueue(user.token))
        .filter((item) => item.operation_kind === governedMintKind)
      const results = await Promise.allSettled(
        queue.map((item) => blockXOneApi.chainOperation.get(user.token, item.id))
      )
      const records: Record<string, ChainOperationRecord> = {}
      const failures: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          records[result.value.id] = result.value
        } else {
          failures.push(
            `Operation ${queue[index].id}: ${result.reason instanceof Error ? result.reason.message : 'status unavailable'}`
          )
        }
      })
      setApprovalItems(queue)
      setReviewOperations(records)
      setApprovalQueueLoaded(true)
      if (failures.length > 0) setError(failures.join(' '))
    } catch (caught) {
      setApprovalItems([])
      setReviewOperations({})
      setApprovalQueueLoaded(false)
      setError(caught instanceof Error ? caught.message : 'Unable to load policy-role mint approvals.')
    } finally {
      setApprovalLoading(false)
    }
  }, [managedTestnet, user])

  useEffect(() => {
    void loadApprovalQueue()
  }, [loadApprovalQueue])

  useEffect(() => {
    void loadMintQueue()
  }, [loadMintQueue])

  async function loadIssuance() {
    if (!user || !subscriptionId.trim() || loading) return
    setLoading(true)
    setResult(null)
    setOperation(null)
    setError('')
    setMessage('')
    setMessageFinal(false)
    try {
      if (managedTestnet) {
        const [paidQueue, mintedQueue] = await Promise.all([
          blockXOneApi.token.mintQueue(user.token, 'PAID'),
          blockXOneApi.token.mintQueue(user.token, 'MINTED'),
        ])
        const operationID = mintOperationIDForSubscription(
          [...paidQueue, ...mintedQueue].filter((item) => isMintQueueItemForRuntime(item, managedTestnet)),
          subscriptionId
        )
        if (!operationID) {
          setOperation(null)
          setError('No mint operation exists for this subscription yet.')
          return
        }
        setOperation(
          await blockXOneApi.chainOperation.get(
            user.token,
            operationID
          )
        )
        return
      }
      setResult(
        await blockXOneApi.token.controlledIssuance(user.token, subscriptionId.trim())
      )
    } catch (caught) {
      setResult(null)
      setOperation(null)
      setError(
        caught instanceof Error
          ? caught.message
          : 'No controlled issuance record is available for this subscription.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function submitMint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !canMint || !subscriptionId.trim() || minting) return
    const requestKey = mintIdempotencyKey(subscriptionId, managedTestnet)
    setMinting(true)
    setError('')
    setMessage('')
    setMessageFinal(false)
    try {
      if (managedTestnet) {
        const created = await blockXOneApi.chainOperation.requestMint(
          user.token,
          subscriptionId.trim(),
          {
            case_reference: `BXO-TESTNET-MINT-${subscriptionId.trim()}`,
            gas_limit: '1000000',
            max_fee_per_gas: '120000000000',
            max_priority_fee_per_gas: '80000000000',
          },
          requestKey
        )
        const refreshed = await blockXOneApi.chainOperation.get(user.token, created.id)
        setOperation(refreshed)
        const complete = Boolean(
          refreshed.state === 'FINAL' &&
          refreshed.proof?.available &&
          refreshed.proof.projection?.controlled_position_id &&
          refreshed.proof.projection?.legal_register_entry_id
        )
        setMessageFinal(complete)
        if (complete) {
          setMessage('The existing mint operation is FINAL with controlled-position and legal-register proof.')
        } else if (refreshed.state === 'APPROVAL_PENDING') {
          setMessage(`${created.idempotent_replay ? 'Existing' : 'New'} mint operation is awaiting an independent checker decision on the exact payload and policy hashes.`)
        } else {
          setMessage(`Mint operation ${created.idempotent_replay ? 'recovered' : 'created'} in ${refreshed.state}. No new checker action is claimed unless the authoritative state returns to APPROVAL_PENDING.`)
        }
        await loadMintQueue()
        return
      }
      const response = await blockXOneApi.token.controlledMint(
        user.token,
        subscriptionId.trim(),
        requestKey
      )
      setResult(response)
      const complete = response.issuance.state === 'FINAL'
      setMessageFinal(complete)
      setMessage(complete
        ? 'Local EVM receipt verified; controlled position and legal-register entry created atomically.'
        : `Issuance state is ${response.issuance.state}. No final position is claimed.`)
      await loadMintQueue()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Controlled issuance failed.')
    } finally {
      setMinting(false)
    }
  }

  async function decideOperation(
    current: ChainOperationRecord,
    decision: ChainOperationDecision
  ) {
    if (!user || !managedTestnet) throw new Error('A verified session in the admitted testnet environment is required.')
    setError('')
    setMessage('')
    setMessageFinal(false)
    await blockXOneApi.chainOperation.decide(user.token, current.id, decision)
    const refreshed = await blockXOneApi.chainOperation.get(user.token, current.id)
    setReviewOperations((operations) => ({
      ...operations,
      [refreshed.id]: refreshed,
    }))
    setMessageFinal(refreshed.state === 'FINAL')
    setMessage(
      `${decision.decision === 'APPROVED' ? 'Approval' : 'Rejection'} recorded against the exact payload and policy hashes. Operation state is ${refreshed.state}.`
    )
    await loadApprovalQueue()
  }

  const issuance = result?.issuance
  const position = issuance?.position
  const finalized = Boolean(
    issuance?.state === 'FINAL' &&
      issuance.transaction_hash &&
      issuance.block_hash &&
      issuance.receipt_evidence_sha256 &&
      issuance.finalized_at &&
      position
  )
  const managedFinalized = Boolean(
    operation?.state === 'FINAL' &&
      operation.transaction_hash &&
      operation.proof?.available &&
      operation.proof.projection?.controlled_position_id &&
      operation.proof.projection?.legal_register_entry_id
  )

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="space-y-4">
          <Button variant="ghost" size="sm" asChild><Link href="/tokenisation-agent">← Back to token operations</Link></Button>
          <div className="bxo-kicker">{managedTestnet ? 'Public testnet issuance' : 'Private validation network issuance'}</div>
          <h1 className="font-display text-4xl font-bold">Mint exact reconciled units</h1>
          <p className="max-w-3xl leading-7 text-bxo-text-secondary">
            {managedTestnet
              ? 'Resolve a reconciled test-payment subscription from durable records, create a mint operation, broadcast through the managed signer, and prove the exact position and legal-register entry from the finalized indexed event.'
              : 'Resolve a reconciled subscription backed by independent synthetic evidence, mint its exact base units on the private validation EVM, verify the receipt, then create one controlled position and legal-register entry.'}
          </p>
        </header>

        <Card className="border-bxo-accent-border bg-bxo-accent-soft p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-accent-primary" />
            <div>
              <p className="font-semibold">{managedTestnet ? 'Network: public testnet' : 'Network: private validation, chain 1337 or 31337'}</p>
              <p className="mt-2 text-sm leading-6 text-bxo-text-secondary">
                {managedTestnet
                  ? 'A mint request is not a holding. This screen claims only the canonical receipt, rail finality, indexed event, controlled position, and legal-register evidence actually returned by the control plane; missing proof remains visibly unrecorded.'
                  : 'This operation stays on the private validation network and uses independent synthetic evidence. It has no payment provider, does not broadcast to a public testnet, and does not accept or settle real funds.'}
              </p>
            </div>
          </div>
        </Card>

        {error ? <Card role="alert" className="border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{error}</Card> : null}
        {message ? <Card role="status" className={messageFinal ? 'border-bxo-success/30 bg-bxo-success/10 p-4 text-sm text-bxo-success-light' : 'border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm text-bxo-warning-light'}>{message}</Card> : null}
        {user && !canMint ? (
          <Card className="border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm text-bxo-warning-light">
            The verified JWT does not grant tokenops:mint, so maker issuance is disabled. Policy-role checker work remains discoverable independently below.
          </Card>
        ) : null}

        <section className="bxo-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bxo-border-subtle px-5 py-4">
            <div>
              <h2 className="font-display text-xl font-bold">Authorised issuance queue</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">Exact reconciled subscriptions assigned to this tokenisation-agent organisation.</p>
            </div>
            <Button type="button" variant="outline" disabled={mintQueueLoading || !canMint} onClick={() => void loadMintQueue()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${mintQueueLoading ? 'animate-spin' : ''}`} />Refresh queue
            </Button>
          </div>
          {mintQueueError ? (
            <div className="p-5 text-sm text-bxo-warning-light">{mintQueueError}</div>
          ) : mintQueueLoading ? (
            <div className="p-5 text-sm text-bxo-text-secondary">Loading authorised issuance work...</div>
          ) : !mintQueueLoaded ? (
            <div className="p-5 text-sm text-bxo-warning-light">The authoritative issuance queue is unavailable.</div>
          ) : mintQueueItems.length === 0 ? (
            <div className="p-5 text-sm text-bxo-text-secondary">No reconciled subscription is waiting for issuance.</div>
          ) : (
            <div className="divide-y divide-bxo-divider">
              {mintQueueItems.map((item) => {
                const ready = isMintQueueItemReady(item)
                return (
                  <article key={item.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div>
                      <div className="font-semibold">{item.asset_name}</div>
                      <div className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">Subscription {item.id}</div>
                      <div className="mt-2 text-sm text-bxo-text-secondary">{item.units} units · {item.amount} {item.currency} · chain {item.chain_id} · wallet {item.wallet_status || 'unavailable'} · identity {item.whitelist_status || 'unavailable'}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!ready}
                      onClick={() => {
                        setSubscriptionId(item.id)
                        setResult(null)
                        setOperation(null)
                        setError('')
                        setMessage('')
                        setMessageFinal(false)
                      }}
                    >
                      {ready ? 'Select subscription' : 'Waiting for controls'}
                    </Button>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <form className="bxo-panel p-6" onSubmit={submitMint}>
          <label htmlFor="controlled-subscription-id" className="text-sm font-semibold text-bxo-text-secondary">
            Controlled subscription ID
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="controlled-subscription-id"
              className="h-12 min-w-0 flex-1 rounded-xl border border-bxo-border-default bg-bxo-bg-primary px-4 font-mono text-sm outline-none focus:border-bxo-accent-primary focus:ring-2 focus:ring-bxo-accent-muted"
              value={subscriptionId}
              onChange={(event) => {
                setSubscriptionId(event.target.value)
                setResult(null)
                setOperation(null)
                setError('')
              }}
              placeholder="UUID from the controlled subscription evidence"
              required
            />
            <Button type="button" variant="outline" disabled={!subscriptionId.trim() || loading || minting} onClick={() => void loadIssuance()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Check status
            </Button>
            <Button type="submit" disabled={!canMint || !subscriptionId.trim() || minting || finalized || managedFinalized || Boolean(operation)}>
              {minting ? 'Submitting…' : finalized || managedFinalized ? 'Position finalized' : operation ? 'Operation created' : managedTestnet ? 'Request mint approval' : 'Execute local issuance'}
            </Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-bxo-text-tertiary">
            The server, not this form, resolves wallet, identity admission, contract, exact amount, approved terms, allocation, configured test consideration, reconciliation, and whitelist evidence.
          </p>
        </form>

        {managedTestnet && operation ? (
          <section className="space-y-3">
            <div>
              <h2 className="font-display text-2xl font-bold">Maker operation status</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">
                The requesting account can inspect this immutable intent but cannot approve it.
              </p>
            </div>
            <GovernedOperationReview
              operation={operation}
              currentUserId={user?.id}
            />
          </section>
        ) : null}

        {managedTestnet ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold">Policy-role checker queue and history</h2>
                <p className="mt-1 text-sm text-bxo-text-secondary">
                  Operations appear only when your live TENANT or LEGAL_ENTITY membership matches a role in their immutable approval policy. No tokenops:mint maker grant is implied.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadApprovalQueue()}
                disabled={approvalLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${approvalLoading ? 'animate-spin' : ''}`} />
                Refresh checker queue
              </Button>
            </div>

            {!approvalLoading && !approvalQueueLoaded ? (
              <Card className="border-bxo-warning-border bg-bxo-warning/10 p-6 text-sm text-bxo-warning-light">
                The authoritative checker queue is unavailable. Refresh before treating approval work as empty.
              </Card>
            ) : null}

            {!approvalLoading && approvalQueueLoaded && approvalItems.length === 0 ? (
              <Card className="bxo-card p-6 text-sm text-bxo-text-secondary">
                No mint operation is visible to your current approval-policy roles.
              </Card>
            ) : null}

            {approvalItems.map((item) => {
              const reviewOperation = reviewOperations[item.id]
              return reviewOperation ? (
                <GovernedOperationReview
                  key={item.id}
                  operation={reviewOperation}
                  currentUserId={user?.id}
                  approverRoles={item.approver_roles}
                  decisionRecorded={item.decision_recorded}
                  actionable={item.actionable}
                  onDecide={(decision) => decideOperation(reviewOperation, decision)}
                />
              ) : (
                <Card key={item.id} className="border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">
                  Operation {item.id} is policy-visible, but its immutable detail response is unavailable.
                </Card>
              )
            })}
          </section>
        ) : null}

        {!managedTestnet && issuance ? (
          <section className="grid gap-5 lg:grid-cols-[1fr_23rem]">
            <Card className="bxo-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-bold">Issuance evidence</h2>
                  <p className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">{issuance.id}</p>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  finalized
                    ? 'border-bxo-success/30 bg-bxo-success/10 text-bxo-success-light'
                    : issuance.state === 'RECOVERY_REQUIRED'
                      ? 'border-bxo-danger-border bg-bxo-danger-soft text-bxo-danger-light'
                      : 'border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light'
                }`}>
                  {finalized ? <BadgeCheck className="h-4 w-4" /> : issuance.state === 'RECOVERY_REQUIRED' ? <TriangleAlert className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                  {issuance.state}
                </span>
              </div>

              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                {[
                  ['Subscription', issuance.subscription_id],
                  ['Asset class', issuance.asset_class],
                  ['Network / chain', `Private validation · ${issuance.chain_id}`],
                  ['Exact base units', issuance.amount_base_units],
                  ['Wallet', issuance.wallet_address],
                  ['Token contract', issuance.token_contract],
                  ['Payload SHA-256', issuance.payload_hash],
                  ['Transaction hash', issuance.transaction_hash],
                  ['Block number', issuance.block_number],
                  ['Block hash', issuance.block_hash],
                  ['Receipt evidence SHA-256', issuance.receipt_evidence_sha256],
                  ['Finalized at', issuance.finalized_at],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">{label}</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{evidence(value)}</dd>
                  </div>
                ))}
              </dl>

              {issuance.state === 'RECOVERY_REQUIRED' ? (
                <div className="mt-6 rounded-xl border border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">
                  Automatic resubmission is blocked. Recovery code: {evidence(issuance.recovery_error_code)}. Reconcile the known chain outcome against issuance ID {issuance.id}.
                </div>
              ) : null}
            </Card>

            <Card className="h-fit bxo-card p-5">
              <h2 className="font-display text-lg font-bold">Truth flags</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div><dt className="text-bxo-text-tertiary">Evidence class</dt><dd className="mt-1 break-all font-mono text-xs">{result?.chain_evidence_class}</dd></div>
                <div><dt className="text-bxo-text-tertiary">Testnet broadcast</dt><dd className="mt-1 font-mono">false</dd></div>
                <div><dt className="text-bxo-text-tertiary">Consideration evidence</dt><dd className="mt-1">{result?.consideration_source === 'TEST_PROVIDER' ? 'Stripe TEST provider evidence' : result?.consideration_source === 'SYNTHETIC_TEST' ? 'Independent synthetic evidence, no payment provider' : 'Configured test evidence'}</dd></div>
                <div><dt className="text-bxo-text-tertiary">Real cash</dt><dd className="mt-1 font-mono">false</dd></div>
                <div><dt className="text-bxo-text-tertiary">Cash settled</dt><dd className="mt-1 font-mono">false</dd></div>
              </dl>
            </Card>
          </section>
        ) : null}

        {!managedTestnet && position ? (
          <Card className="border-bxo-success/30 bg-bxo-success/10 p-6">
            <h2 className="font-display text-2xl font-bold">Controlled position and legal register</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div><div className="text-xs text-bxo-text-tertiary">Position</div><div className="mt-1 break-all font-mono text-xs">{position.id}</div></div>
              <div><div className="text-xs text-bxo-text-tertiary">Exact balance</div><div className="mt-1 font-mono">{formatExactUnits(baseUnitsToExactDecimal(position.balance_base_units, position.token_decimals))}</div></div>
              <div><div className="text-xs text-bxo-text-tertiary">Register sequence</div><div className="mt-1 font-mono">{position.register_sequence}</div></div>
              <div className="sm:col-span-3"><div className="text-xs text-bxo-text-tertiary">Register entry SHA-256</div><div className="mt-1 break-all font-mono text-xs">{position.register_entry_sha256}</div></div>
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  )
}
