'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  blockXOneApi,
  type WalletApprovalQueueItem,
} from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context-v2'

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
}

function networkLabel(chainId: number) {
  if (chainId === 84532) return 'Base Sepolia · 84532'
  if (chainId === 11155111) return 'Sepolia · 11155111'
  return `Chain ${chainId}`
}

export default function WalletApprovalQueuePage() {
  const { user } = useAuth()
  const [items, setItems] = useState<WalletApprovalQueueItem[]>([])
  const [selected, setSelected] = useState<WalletApprovalQueueItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadQueue = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const queue = await blockXOneApi.wallet.approvalQueue(user.token)
      setItems(Array.isArray(queue) ? queue : [])
    } catch (caught) {
      setItems([])
      setError(caught instanceof Error ? caught.message : 'Unable to load the wallet review queue.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  async function decide(decision: 'approve' | 'reject') {
    if (!user || !selected || processing) return

    setProcessing(true)
    setError('')
    setMessage('')
    try {
      if (decision === 'approve') {
        await blockXOneApi.wallet.approve(user.token, selected.id)
      } else {
        await blockXOneApi.wallet.reject(user.token, selected.id)
      }
      setMessage(
        `${selected.investor_email} wallet ${decision === 'approve' ? 'approved' : 'rejected'}.`
      )
      setSelected(null)
      await loadQueue()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${decision} this wallet.`)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-10 text-bxo-text-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="space-y-5">
          <Button asChild variant="ghost" size="sm">
            <Link href="/compliance">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to compliance
            </Link>
          </Button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="bxo-kicker">Compliance · wallet control</div>
              <h1 className="mt-3 font-display text-4xl font-bold">Wallet approval queue</h1>
              <p className="mt-3 leading-7 text-bxo-text-secondary">
                Review identity eligibility, chain ownership context, and the assigned testnet address
                before allowing the wallet into the issuance journey.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="bxo-secondary-cta min-h-11"
              onClick={() => void loadQueue()}
              disabled={loading || processing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </header>

        {error ? (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-4" role="alert">
            <p className="text-sm text-bxo-danger-light">{error}</p>
          </Card>
        ) : null}

        {message ? (
          <Card className="border-bxo-success/30 bg-bxo-success/10 p-4" role="status">
            <p className="text-sm text-bxo-success-light">{message}</p>
          </Card>
        ) : null}

        {selected ? (
          <Card className="bxo-panel overflow-hidden border-bxo-accent-border">
            <div className="flex flex-col gap-3 border-b border-bxo-border-subtle bg-bxo-accent-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-bxo-accent-border bg-bxo-bg-primary text-bxo-accent-primary">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold">Review wallet decision</h2>
                  <p className="mt-1 text-xs text-bxo-text-secondary">
                    Approval remains separate from offering whitelist registration.
                  </p>
                </div>
              </div>
              <span className="w-fit rounded-full bg-bxo-warning/10 px-3 py-1 text-xs font-semibold text-bxo-warning-light">
                PENDING
              </span>
            </div>

            <dl className="grid gap-px bg-bxo-divider sm:grid-cols-2">
              <div className="bg-bxo-bg-primary/80 px-5 py-4">
                <dt className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Investor</dt>
                <dd className="mt-2 text-sm font-medium">{selected.investor_email}</dd>
              </div>
              <div className="bg-bxo-bg-primary/80 px-5 py-4">
                <dt className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Identity control</dt>
                <dd className="mt-2 text-sm font-medium text-bxo-success-light">{selected.kyc_status}</dd>
              </div>
              <div className="bg-bxo-bg-primary/80 px-5 py-4">
                <dt className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Network</dt>
                <dd className="mt-2 text-sm font-medium">{networkLabel(selected.chain_id)}</dd>
              </div>
              <div className="bg-bxo-bg-primary/80 px-5 py-4">
                <dt className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Wallet address</dt>
                <dd className="mt-2 break-all font-mono text-xs">{selected.address}</dd>
              </div>
            </dl>

            <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
              <p className="max-w-2xl text-sm leading-6 text-bxo-text-secondary">
                Approve only when the identity record is eligible and this exact address and test
                network match the assigned wallet.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setSelected(null)}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 border-bxo-danger-border text-bxo-danger-light"
                  onClick={() => void decide('reject')}
                  disabled={processing}
                >
                  Reject wallet
                </Button>
                <Button
                  type="button"
                  className="bxo-primary-cta min-h-11 text-bxo-bg-primary"
                  onClick={() => void decide('approve')}
                  disabled={processing || selected.kyc_status !== 'APPROVED'}
                >
                  {processing ? 'Recording…' : 'Confirm approval'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        <Card className="bxo-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-bxo-border-subtle px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Pending wallets</h2>
              <p className="mt-1 text-xs text-bxo-text-tertiary">
                {items.length} {items.length === 1 ? 'wallet' : 'wallets'} awaiting a decision
              </p>
            </div>
            <span className="rounded-full border border-bxo-warning-border bg-bxo-warning/10 px-3 py-1 font-mono text-sm text-bxo-warning-light">
              {items.length}
            </span>
          </div>

          {loading ? (
            <div className="space-y-4 p-5" aria-label="Loading wallet queue">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="skeleton h-28 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
              <CheckCircle2 className="h-9 w-9 text-bxo-success" aria-hidden="true" />
              <h3 className="mt-4 font-display text-xl font-semibold">Wallet queue clear</h3>
              <p className="mt-2 max-w-md text-sm text-bxo-text-secondary">
                Newly connected testnet wallets will appear here after identity review.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-bxo-divider">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="grid gap-5 px-5 py-5 lg:grid-cols-[1fr_auto] lg:items-center"
                >
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Investor</div>
                      <div className="mt-2 break-all text-sm font-medium">{item.investor_email}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Identity</div>
                      <div className="mt-2 text-sm font-medium text-bxo-success-light">{item.kyc_status}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Network</div>
                      <div className="mt-2 text-sm">{networkLabel(item.chain_id)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">Connected</div>
                      <div className="mt-2 text-sm text-bxo-text-secondary">{formatDate(item.created_at)}</div>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <div className="break-all font-mono text-xs text-bxo-text-tertiary">{item.address}</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 shrink-0"
                    onClick={() => setSelected(item)}
                  >
                    <WalletCards className="mr-2 h-4 w-4" aria-hidden="true" />
                    Review wallet
                  </Button>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  )
}
