'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, CircleDollarSign, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, blockXOneApi, type SettlementQueueItem } from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context-v2'
import { formatExactMoney, formatExactUnits } from '@/lib/exact-decimal'
import {
  newIdempotencyKey,
  type ControlledSubscription,
  type ReconciliationRecord,
  type SyntheticFundingRecord,
  type SyntheticStatementRecord,
} from '@/lib/pilot-finance'

function pretty(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function localDateTimeNow() {
  const date = new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function isoDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error('Evidence time must be a valid date and time.')
  return parsed.toISOString()
}

export default function SettlementReviewPage() {
  const { user, loading: authLoading } = useAuth()
  const [items, setItems] = useState<SettlementQueueItem[]>([])
  const [queueLoaded, setQueueLoaded] = useState(false)
  const [selected, setSelected] = useState<SettlementQueueItem | null>(null)
  const [controlled, setControlled] = useState<ControlledSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [funding, setFunding] = useState<SyntheticFundingRecord | null>(null)
  const [statement, setStatement] = useState<SyntheticStatementRecord | null>(null)
  const [reconciliation, setReconciliation] = useState<ReconciliationRecord | null>(null)
  const [providerEventId, setProviderEventId] = useState('')
  const [providerObjectId, setProviderObjectId] = useState('')
  const [occurredAt, setOccurredAt] = useState(localDateTimeNow)
  const [statementEntryId, setStatementEntryId] = useState('')
  const [statementValueAt, setStatementValueAt] = useState(localDateTimeNow)
  const fundingKey = useRef('')
  const statementKey = useRef('')
  const reconciliationKey = useRef('')
  const canNotify = user?.permissions?.['payment:notify'] === true
  const canRunReconciliation = user?.permissions?.['reconciliation:run'] === true
  const canApproveReconciliation = user?.permissions?.['reconciliation:approve'] === true
  const canAccessWorkflow =
    canNotify || canRunReconciliation || canApproveReconciliation
  const backHref = user?.roles?.includes('SuperAdmin') ? '/wm' : '/'
  const backLabel = user?.roles?.includes('SuperAdmin')
    ? 'Back to command center'
    : 'Back to BlockXOne'

  const loadQueue = useCallback(async () => {
    setSelected(null)
    setControlled(null)
    setFunding(null)
    setStatement(null)
    setReconciliation(null)
    setProviderEventId('')
    setProviderObjectId('')
    setStatementEntryId('')
    fundingKey.current = ''
    statementKey.current = ''
    reconciliationKey.current = ''
    if (!user) {
      setItems([])
      setQueueLoaded(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setItems([])
    setQueueLoaded(false)
    setError('')
    try {
      const canAccess =
        user.permissions?.['payment:notify'] === true ||
        user.permissions?.['reconciliation:run'] === true ||
        user.permissions?.['reconciliation:approve'] === true
      if (!canAccess) {
        setItems([])
        return
      }
      const queue = await blockXOneApi.payment.settlementQueue(user.token)
      if (!Array.isArray(queue)) throw new Error('Settlement queue returned an invalid response.')
      setItems(queue)
      setQueueLoaded(true)
    } catch (caught) {
      setItems([])
      setQueueLoaded(false)
      setError(caught instanceof Error ? caught.message : 'Unable to load settlement instructions.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (authLoading) return
    void loadQueue()
  }, [authLoading, loadQueue])

  async function selectInstruction(item: SettlementQueueItem) {
    if (!user || !canAccessWorkflow) return
    setSelected(item)
    setControlled(null)
    setFunding(null)
    setStatement(null)
    setReconciliation(null)
    setProviderEventId('')
    setProviderObjectId(item.bank_ref || '')
    setStatementEntryId('')
    setError('')
    setMessage('')
    setProcessing('load')
    try {
      const controlledRecord = await blockXOneApi.subscription.getControlled(
        user.token,
        item.id
      )
      setControlled(controlledRecord)
      try {
        setReconciliation(
          await blockXOneApi.subscription.latestReconciliation(user.token, item.id)
        )
      } catch (caught) {
        // A 404 is the expected state before the runner creates a durable run.
        if (caught instanceof ApiError && caught.status === 404) {
          setReconciliation(null)
        } else {
          throw caught
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load authoritative subscription evidence.')
    } finally {
      setProcessing('')
    }
  }

  async function refreshControlled() {
    if (!user || !selected) return
    try {
      setControlled(await blockXOneApi.subscription.getControlled(user.token, selected.id))
    } catch (caught) {
      setError(
        `${
          caught instanceof Error
            ? caught.message
            : 'The authoritative subscription could not be refreshed.'
        } The preceding mutation may already be durable; do not resubmit it until evidence is reloaded.`
      )
    }
  }

  async function applyFunding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || !selected || !controlled || !canNotify || processing) return
    if (!providerEventId.trim() || !providerObjectId.trim()) {
      setError('Funding evidence ID and source reference are required.')
      return
    }
    if (!fundingKey.current) fundingKey.current = newIdempotencyKey(`synthetic-funding:${selected.id}`)
    setProcessing('funding')
    setError('')
    setMessage('')
    try {
      const record = await blockXOneApi.payment.applySyntheticFunding(
        user.token,
        selected.id,
        {
          provider_event_id: providerEventId.trim(),
          provider_object_id: providerObjectId.trim(),
          amount_base_units: controlled.currency_base_units,
          currency: controlled.currency,
          occurred_at: isoDateTime(occurredAt),
        },
        fundingKey.current
      )
      setFunding(record)
      setMessage('Independent synthetic funding evidence was applied atomically to the ledger. No payment provider or real funds were involved.')
      fundingKey.current = ''
      await refreshControlled()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to apply test funding evidence.')
    } finally {
      setProcessing('')
    }
  }

  async function recordStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !user ||
      !canRunReconciliation ||
      !selected ||
      !controlled ||
      !statementEntryId.trim() ||
      processing
    ) return
    if (!statementKey.current) statementKey.current = newIdempotencyKey(`synthetic-statement:${selected.id}`)
    setProcessing('statement')
    setError('')
    try {
      const record = await blockXOneApi.payment.recordSyntheticStatement(
        user.token,
        selected.id,
        {
          statement_entry_id: statementEntryId.trim(),
          amount_base_units: controlled.currency_base_units,
          currency: controlled.currency,
          value_at: isoDateTime(statementValueAt),
        },
        statementKey.current
      )
      setStatement(record)
      setMessage('Independent test statement evidence recorded. This is not a bank statement or proof of real funds.')
      statementKey.current = ''
      await refreshControlled()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to record statement evidence.')
    } finally {
      setProcessing('')
    }
  }

  async function startReconciliation() {
    if (!user || !canRunReconciliation || !selected || processing) return
    if (!reconciliationKey.current) reconciliationKey.current = newIdempotencyKey(`reconciliation:${selected.id}`)
    setProcessing('reconciliation')
    setError('')
    try {
      const record = await blockXOneApi.subscription.startReconciliation(
        user.token,
        selected.id,
        reconciliationKey.current
      )
      setReconciliation(record)
      setMessage(
        controlled?.consideration_source === 'TEST_PROVIDER'
          ? 'Authenticated provider evidence and the posted processor-receivable ledger entry were compared. A separate checker must approve the reconciliation.'
          : 'Independent synthetic funding, statement and ledger snapshots were compared. A separate checker must approve the reconciliation.'
      )
      reconciliationKey.current = ''
      await refreshControlled()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to run reconciliation.')
    } finally {
      setProcessing('')
    }
  }

  async function approveReconciliation() {
    if (
      !user ||
      !canApproveReconciliation ||
      !selected ||
      !reconciliation ||
      processing
    ) return
    setProcessing('approval')
    setError('')
    try {
      const record = await blockXOneApi.subscription.approveReconciliation(
        user.token,
        selected.id,
        reconciliation.id
      )
      setReconciliation(record)
      setMessage(
        controlled?.consideration_source === 'TEST_PROVIDER'
          ? 'Reconciliation checker approval recorded. This Stripe TEST provider evidence is non-cash and does not claim bank settlement.'
          : 'Reconciliation checker approval recorded. This independent synthetic evidence uses no payment provider and does not claim real funds.'
      )
      await refreshControlled()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to approve reconciliation.')
    } finally {
      setProcessing('')
    }
  }

  const evidence = controlled?.evidence

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="space-y-5">
          <Button asChild variant="ghost" size="sm"><Link href={backHref}><ArrowLeft className="mr-2 h-4 w-4" />{backLabel}</Link></Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="bxo-kicker">Test consideration reconciliation</div>
              <h1 className="mt-3 font-display text-4xl font-bold">Funding evidence and reconciliation</h1>
              <p className="mt-3 leading-7 text-bxo-text-secondary">
                Monitor the configured test consideration evidence, exact ledger postings, and maker-checker reconciliation before issuance.
                Local records use independent synthetic evidence with no payment provider. TEST_PROVIDER records use authenticated Stripe TEST evidence.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadQueue()} disabled={loading || Boolean(processing)}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>
        </header>

        <Card className="border-bxo-warning-border bg-bxo-warning/10 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-warning" />
            <div>
              <p className="font-semibold">Test consideration boundary: no real funds accepted or settled</p>
              <p className="mt-2 text-sm leading-6 text-bxo-text-secondary">Local validation records use independent synthetic evidence and no payment provider. TEST_PROVIDER records use signed Stripe TEST webhooks, authoritative refetch, and exact processor-receivable ledger postings. Neither mode represents withdrawable or bank-settled cash.</p>
            </div>
          </div>
        </Card>

        {!canAccessWorkflow && !loading ? (
          <Card className="border-bxo-border-default p-6">
            <div className="flex items-center gap-3"><LockKeyhole className="h-5 w-5 text-bxo-warning" /><h2 className="font-display text-xl font-bold">Evidence workflow unavailable</h2></div>
            <p className="mt-3 text-sm text-bxo-text-secondary">The verified JWT does not grant funding, reconciliation-run, or reconciliation-approval access. The queue and mutation controls remain hidden.</p>
          </Card>
        ) : null}
        {error ? <Card role="alert" className="border-bxo-danger-border bg-bxo-danger-soft p-4 text-sm text-bxo-danger-light">{error}</Card> : null}
        {message ? <Card role="status" className="border-bxo-success/30 bg-bxo-success/10 p-4 text-sm text-bxo-success-light">{message}</Card> : null}

        {selected && queueLoaded && !loading ? (
          <section className="grid gap-5 xl:grid-cols-[1fr_24rem]">
            <Card className="bxo-panel overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-bxo-border-subtle px-5 py-4">
                <div className="flex items-center gap-3"><CircleDollarSign className="h-5 w-5 text-bxo-accent-primary" /><div><h2 className="font-display text-lg font-bold">{selected.asset_name}</h2><p className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">{selected.id}</p></div></div>
                <Button variant="outline" size="sm" onClick={() => { setSelected(null); setControlled(null) }}>Close</Button>
              </div>
              <dl className="grid gap-px bg-bxo-divider sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Investor', selected.investor_email],
                  ['Units', formatExactUnits(selected.units)],
                  ['Instruction', formatExactMoney(selected.amount, selected.currency)],
                  ['Reference', selected.bank_ref],
                ].map(([label, value]) => <div key={label} className="bg-bxo-bg-primary px-5 py-4"><dt className="text-xs text-bxo-text-tertiary">{label}</dt><dd className="mt-2 break-all font-mono text-sm">{value}</dd></div>)}
              </dl>
              {controlled ? (
                <div className="space-y-6 p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-4"><div className="text-xs text-bxo-text-tertiary">Controlled state</div><div className="mt-2 font-mono text-sm">{controlled.status}</div></div>
                    <div className="rounded-xl border border-bxo-border-default p-4"><div className="text-xs text-bxo-text-tertiary">Exact base units</div><div className="mt-2 break-all font-mono text-sm">{controlled.currency_base_units}</div></div>
                    <div className="rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4"><div className="text-xs text-bxo-text-tertiary">Consideration evidence</div><div className="mt-2 text-sm font-medium">{controlled.consideration_source === 'TEST_PROVIDER' ? 'Stripe TEST provider evidence' : controlled.consideration_source === 'SYNTHETIC_TEST' ? 'Independent synthetic evidence' : 'Configured test evidence'}</div></div>
                  </div>

                  {controlled.consideration_source === 'SYNTHETIC_TEST' ? <>
                  <form className="rounded-xl border border-bxo-border-default p-5" onSubmit={applyFunding}>
                    <h3 className="font-display text-lg font-bold">1. Record independent synthetic funding evidence</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm text-bxo-text-secondary">Funding evidence ID<input className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 font-mono text-sm" value={providerEventId} onChange={(event) => setProviderEventId(event.target.value)} required /></label>
                      <label className="text-sm text-bxo-text-secondary">Source reference<input className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 font-mono text-sm" value={providerObjectId} onChange={(event) => setProviderObjectId(event.target.value)} required /></label>
                      <label className="text-sm text-bxo-text-secondary">Observed at<input type="datetime-local" className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 font-mono text-sm" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
                      <div className="text-sm text-bxo-text-secondary">Immutable amount<div className="mt-2 flex h-11 items-center rounded-lg border border-bxo-border-subtle px-3 font-mono text-sm">{controlled.currency_base_units} {controlled.currency} base units</div></div>
                    </div>
                    <Button className="mt-4" type="submit" disabled={!canNotify || processing === 'funding' || Boolean(evidence?.funding_journal_entry_id) || Boolean(funding)}>{evidence?.funding_journal_entry_id || funding ? 'Synthetic evidence applied' : processing === 'funding' ? 'Applying atomically…' : canNotify ? 'Record synthetic funding evidence' : 'Funding permission required'}</Button>
                  </form>

                  <form className="rounded-xl border border-bxo-border-default p-5" onSubmit={recordStatement}>
                    <h3 className="font-display text-lg font-bold">2. Record independent statement evidence</h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm text-bxo-text-secondary">Statement entry ID<input className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 font-mono text-sm" value={statementEntryId} onChange={(event) => setStatementEntryId(event.target.value)} required /></label>
                      <label className="text-sm text-bxo-text-secondary">Value at<input type="datetime-local" className="mt-2 h-11 w-full rounded-lg border border-bxo-border-default bg-bxo-bg-primary px-3 font-mono text-sm" value={statementValueAt} onChange={(event) => setStatementValueAt(event.target.value)} required /></label>
                    </div>
                    <Button className="mt-4" type="submit" disabled={!canRunReconciliation || !evidence?.funding_journal_entry_id || processing === 'statement' || Boolean(evidence?.statement_evidence_id) || Boolean(statement)}>{evidence?.statement_evidence_id || statement ? 'Statement evidence recorded' : processing === 'statement' ? 'Recording…' : 'Record test statement'}</Button>
                  </form>
                  </> : (
                    <div className="rounded-xl border border-bxo-accent-border bg-bxo-accent-soft p-5">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-bxo-accent-primary" />
                        <div>
                          <h3 className="font-display text-lg font-bold">1. Authenticated provider intake</h3>
                          <p className="mt-2 text-sm leading-6 text-bxo-text-secondary">
                            Manual funding entry is disabled. Stripe TEST Checkout, signed webhook verification, authoritative Stripe refetch, and the exact ledger posting run through the provider worker.
                          </p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-bxo-border-subtle bg-bxo-bg-primary p-3">
                              <div className="text-xs text-bxo-text-tertiary">Provider event</div>
                              <div className="mt-2 break-all font-mono text-xs">{evidence?.provider_event_id || 'Awaiting verified Stripe event'}</div>
                            </div>
                            <div className="rounded-lg border border-bxo-border-subtle bg-bxo-bg-primary p-3">
                              <div className="text-xs text-bxo-text-tertiary">Ledger journal</div>
                              <div className="mt-2 break-all font-mono text-xs">{evidence?.funding_journal_entry_id || 'Awaiting exact provider posting'}</div>
                            </div>
                          </div>
                          <Button className="mt-4" variant="outline" onClick={() => void refreshControlled()} disabled={Boolean(processing)}>
                            <RefreshCw className="mr-2 h-4 w-4" />Refresh provider evidence
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-bxo-border-default p-5">
                    <h3 className="font-display text-lg font-bold">{controlled.consideration_source === 'TEST_PROVIDER' ? '2. Reconcile and check' : '3. Reconcile and check'}</h3>
                    <p className="mt-2 text-sm text-bxo-text-secondary">
                      {controlled.consideration_source === 'TEST_PROVIDER'
                        ? 'The run compares authenticated Stripe evidence with the immutable processor-receivable ledger posting. The runner cannot approve their own reconciliation.'
                        : 'The run compares independent synthetic funding, statement and ledger snapshots. The runner cannot approve their own reconciliation.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button disabled={!canRunReconciliation || !(controlled.consideration_source === 'TEST_PROVIDER' ? evidence?.funding_journal_entry_id : evidence?.statement_evidence_id) || processing === 'reconciliation' || Boolean(reconciliation)} onClick={() => void startReconciliation()}>{processing === 'reconciliation' ? 'Comparing…' : reconciliation ? 'Reconciliation recorded' : 'Run reconciliation'}</Button>
                      <Button variant="outline" disabled={!canApproveReconciliation || !reconciliation || reconciliation.status === 'COMPLETED' || processing === 'approval'} onClick={() => void approveReconciliation()}>{processing === 'approval' ? 'Approving…' : reconciliation?.status === 'COMPLETED' ? 'Checker approval recorded' : 'Checker approve'}</Button>
                    </div>
                  </div>
                </div>
              ) : <div className="p-6 text-bxo-text-secondary">{processing === 'load' ? 'Loading authoritative subscription…' : 'Subscription evidence unavailable.'}</div>}
            </Card>

            <Card className="h-fit bxo-card p-5">
              <h2 className="font-display text-lg font-bold">Evidence IDs</h2>
              <dl className="mt-4 space-y-4">
                {Object.entries(evidence || {}).map(([key, value]) => (
                  <div key={key}><dt className="text-xs uppercase tracking-[0.08em] text-bxo-text-tertiary">{pretty(key)}</dt><dd className="mt-1 break-all font-mono text-xs">{value || 'Not recorded'}</dd></div>
                ))}
                {funding ? <div><dt className="text-xs text-bxo-text-tertiary">Intake ID</dt><dd className="mt-1 break-all font-mono text-xs">{funding.intake_id}</dd></div> : null}
                {statement ? <div><dt className="text-xs text-bxo-text-tertiary">Statement SHA-256</dt><dd className="mt-1 break-all font-mono text-xs">{statement.statement_sha256}</dd></div> : null}
                {reconciliation ? <>
                  <div><dt className="text-xs text-bxo-text-tertiary">Reconciliation run</dt><dd className="mt-1 break-all font-mono text-xs">{reconciliation.id}</dd></div>
                  <div><dt className="text-xs text-bxo-text-tertiary">{controlled?.consideration_source === 'TEST_PROVIDER' ? 'Provider snapshot' : 'Synthetic funding snapshot'}</dt><dd className="mt-1 break-all font-mono text-xs">{reconciliation.provider_snapshot_sha256}</dd></div>
                  <div><dt className="text-xs text-bxo-text-tertiary">Statement snapshot</dt><dd className="mt-1 break-all font-mono text-xs">{reconciliation.statement_snapshot_sha256}</dd></div>
                  <div><dt className="text-xs text-bxo-text-tertiary">Ledger snapshot</dt><dd className="mt-1 break-all font-mono text-xs">{reconciliation.ledger_snapshot_sha256}</dd></div>
                </> : null}
              </dl>
            </Card>
          </section>
        ) : null}

        {canAccessWorkflow ? (
          <Card className="bxo-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-bxo-border-subtle px-5 py-4">
              <div><h2 className="font-display text-lg font-bold">Approved controlled subscriptions</h2><p className="mt-1 text-xs text-bxo-text-tertiary">{queueLoaded ? `${items.length} awaiting test consideration evidence or reconciliation` : 'Authoritative queue count unavailable'}</p></div>
              <span className="rounded-full border border-bxo-warning-border bg-bxo-warning/10 px-3 py-1 font-mono text-sm text-bxo-warning-light">{queueLoaded ? items.length : '?'}</span>
            </div>
            {loading ? <div className="p-8 text-bxo-text-secondary">Loading capability-gated queue…</div> : !queueLoaded ? (
              <div className="min-h-48 p-8 text-center text-bxo-warning-light">Settlement queue unavailable. Refresh before treating this workflow as clear.</div>
            ) : items.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center"><CheckCircle2 className="h-8 w-8 text-bxo-success" /><h3 className="mt-4 font-display text-xl font-bold">Queue clear</h3></div>
            ) : (
              <div className="divide-y divide-bxo-divider">
                {items.map((item) => (
                  <article key={item.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div><div className="text-xs text-bxo-text-tertiary">Offering</div><div className="mt-2 text-sm">{item.asset_name}</div></div>
                      <div><div className="text-xs text-bxo-text-tertiary">Investor</div><div className="mt-2 break-all text-sm">{item.investor_email}</div></div>
                      <div><div className="text-xs text-bxo-text-tertiary">Exact instruction</div><div className="mt-2 font-mono text-sm">{formatExactMoney(item.amount, item.currency)}</div></div>
                      <div><div className="text-xs text-bxo-text-tertiary">Reference</div><div className="mt-2 break-all font-mono text-sm">{item.bank_ref}</div></div>
                    </div>
                    <Button onClick={() => void selectInstruction(item)} disabled={Boolean(processing)}>Open evidence workflow</Button>
                  </article>
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </main>
  )
}
