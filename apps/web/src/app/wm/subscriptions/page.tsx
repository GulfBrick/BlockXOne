'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context-v2'
import { formatExactMoney, formatExactUnits } from '@/lib/exact-decimal'
import {
  blockXOneApi,
  type SubscriptionApprovalQueueItem,
} from '@/lib/api-client'

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatUnits(value: string) {
  return formatExactUnits(value)
}

function formatInstruction(value: string, currency: string) {
  return formatExactMoney(value, currency)
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SubscriptionApprovalQueuePage() {
  const { user } = useAuth()
  const [items, setItems] = useState<SubscriptionApprovalQueueItem[]>([])
  const [queueLoaded, setQueueLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState('')
  const [selectedItem, setSelectedItem] = useState<SubscriptionApprovalQueueItem | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setItems([])
    setSelectedItem(null)
    setQueueLoaded(false)
    setError('')
    try {
      if (!user) throw new Error('Sign in as a transfer agent to load this queue.')
      const queue = await blockXOneApi.subscription.approvalQueue(user.token)
      if (!Array.isArray(queue)) throw new Error('Subscription queue returned an invalid response.')
      setItems(queue)
      setQueueLoaded(true)
    } catch (caught) {
      setItems([])
      setQueueLoaded(false)
      setError(errorMessage(caught, 'Unable to load the subscription approval queue.'))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const approve = async (item: SubscriptionApprovalQueueItem) => {
    if (!user || processingId) return

    setProcessingId(item.id)
    setError('')
    setMessage('')
    try {
      await blockXOneApi.subscription.approve(user.token, item.id)
      setMessage(`Subscription ${item.id.slice(0, 8)}… approved.`)
      setSelectedItem(null)
      await loadQueue()
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to approve this subscription.'))
    } finally {
      setProcessingId('')
    }
  }

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/wm">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to operator workspace
            </Link>
          </Button>
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
            <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
            {user?.roles?.includes('SuperAdmin') ? 'Cross-role operator' : 'Transfer Agent'}
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-4xl font-bold">Subscription approval queue</h1>
              <p className="mt-3 leading-7 text-bxo-text-secondary">
                Review authoritative REQUESTED subscriptions before the configured test consideration workflow.
                Local records use independent synthetic evidence with no payment provider, while TEST_PROVIDER records use authenticated Stripe TEST evidence.
                Approval does not collect payment or mint tokens; those remain separate controlled steps.
              </p>
            </div>
            <Button variant="outline" onClick={() => void loadQueue()} disabled={loading || Boolean(processingId)}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-4">
            <p className="text-sm text-bxo-danger-light" role="alert">{error}</p>
          </Card>
        ) : null}

        {message ? (
          <Card className="border-bxo-success/30 bg-bxo-success/10 p-4">
            <p className="text-sm text-bxo-success-light" role="status">{message}</p>
          </Card>
        ) : null}

        {selectedItem ? (
          <Card className="bxo-panel overflow-hidden border-bxo-accent-border">
            <div className="flex flex-col gap-3 border-b border-bxo-border-subtle bg-bxo-accent-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-bxo-accent-border bg-bxo-bg-primary text-bxo-accent-primary">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold">Review approval decision</h2>
                  <p className="mt-1 text-xs text-bxo-text-secondary">
                    This transition is recorded in the audit trail and cannot be completed anonymously.
                  </p>
                </div>
              </div>
              <span className="w-fit rounded-full bg-bxo-warning/10 px-3 py-1 text-xs font-semibold text-bxo-warning-light">
                REQUESTED → APPROVED
              </span>
            </div>

            <dl className="grid gap-px bg-bxo-divider sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Offering', selectedItem.asset_name || 'Unnamed offering'],
                ['Investor', selectedItem.investor_email],
                ['Units', formatUnits(selectedItem.units)],
                ['Instruction', formatInstruction(selectedItem.amount, selectedItem.currency)],
              ].map(([label, value]) => (
                <div key={label} className="bg-bxo-bg-primary/80 px-5 py-4">
                  <dt className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">{label}</dt>
                  <dd className="mt-2 break-words text-sm font-medium text-bxo-text-primary">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
              <p className="max-w-3xl text-sm leading-6 text-bxo-text-secondary">
                Approval creates the exact test consideration instruction. It does not mark consideration evidence received or
                issue tokens. The configured synthetic or Stripe TEST evidence workflow, reconciliation, wallet eligibility,
                whitelist, and issuance remain separate controls.
              </p>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setSelectedItem(null)}
                  disabled={Boolean(processingId)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bxo-primary-cta min-h-11 text-bxo-bg-primary"
                  onClick={() => void approve(selectedItem)}
                  disabled={Boolean(processingId)}
                >
                  {processingId === selectedItem.id ? 'Approving…' : 'Confirm approval'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <Card className="bxo-card space-y-4 p-6" aria-label="Loading subscription queue">
            <div className="skeleton h-5 w-52 rounded" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton h-16 rounded-lg" />
              ))}
            </div>
          </Card>
        ) : !queueLoaded ? (
          <Card className="bxo-card p-10 text-center">
            <h2 className="font-display text-xl font-semibold text-bxo-warning-light">Subscription queue unavailable</h2>
            <p className="mt-2 text-sm text-bxo-text-secondary">
              Refresh the authoritative queue before treating transfer-agent work as clear.
            </p>
          </Card>
        ) : items.length === 0 ? (
          <Card className="bxo-card p-10 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-bxo-success" aria-hidden="true" />
            <h2 className="mt-4 font-display text-xl font-semibold">No subscriptions awaiting approval</h2>
            <p className="mt-2 text-sm text-bxo-text-secondary">
              The transfer-agent queue is clear. Return to the command center to continue another stage.
            </p>
            <Button asChild variant="outline" className="mt-5 min-h-11">
              <Link href="/wm">Return to command center</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4">
            {items.map((item) => (
              <Card key={item.id} className="bxo-card p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Offering</div>
                      <div className="mt-1 font-semibold">{item.asset_name || 'Unnamed offering'}</div>
                      <div className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">{item.offering_id}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Investor</div>
                      <div className="mt-1 break-all text-sm">{item.investor_email}</div>
                      <div className="mt-1 break-all font-mono text-xs text-bxo-text-tertiary">{item.user_id}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Instruction</div>
                      <div className="mt-1 text-sm">{formatUnits(item.units)} units</div>
                      <div className="mt-1 font-mono text-sm">
                        {formatInstruction(item.amount, item.currency)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Status</div>
                      <span className="mt-1 inline-flex rounded-full bg-bxo-warning/10 px-2 py-1 text-xs font-semibold text-bxo-warning-light">
                        {item.status}
                      </span>
                      <div className="mt-2 text-xs text-bxo-text-tertiary">
                        {formatDate(item.created_at)}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => setSelectedItem(item)}
                    disabled={Boolean(processingId)}
                    className="shrink-0"
                  >
                    Review decision
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
