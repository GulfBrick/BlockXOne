'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FilePlus2,
  Fingerprint,
  Landmark,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  WorkspaceFrame,
  WorkspaceHeader,
} from '@/components/workspace/workspace-shell'
import {
  blockXOneApi,
  type OperatorActionItem,
  type OperatorOverview,
} from '@/lib/api-client'
import { useAuth } from '@/lib/auth-context-v2'
import { blockXOneRuntimeScope } from '@/lib/runtime-scope'
import { hasAnyRole, SUBSCRIPTION_WORKFLOW_ROLES } from '@/lib/role-routing'

type PipelineStage = {
  label: string
  detail: string
  count: number
  href?: string
  icon: LucideIcon
  attention?: boolean
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  draft_offerings: ListChecks,
  submitted_kyc: Fingerprint,
  pending_wallets: WalletCards,
  requested_subscriptions: ClipboardCheck,
  approved_settlements: CircleDollarSign,
  actionable_whitelist: ShieldCheck,
}

const LEGACY_ISSUANCE_ACTIONS = new Set(['ready_mints', 'blocked_mints'])

function readableAction(value: string) {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function safeDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Just now'
    : date.toLocaleString('en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
}

function MetricSkeleton() {
  return (
    <Card className="bxo-card space-y-4 p-5" aria-hidden="true">
      <div className="skeleton h-4 w-28 rounded" />
      <div className="skeleton h-9 w-20 rounded" />
      <div className="skeleton h-3 w-40 max-w-full rounded" />
    </Card>
  )
}

function ActionCard({ item }: { item: OperatorActionItem }) {
  const Icon = ACTION_ICONS[item.key] || Activity
  const priorityClass =
    item.priority === 'high'
      ? 'border-bxo-warning-border bg-bxo-warning/5'
      : 'border-bxo-border-subtle bg-bxo-surface'

  return (
    <Link
      href={item.href}
      className={`group flex min-h-28 items-center gap-4 rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:border-bxo-accent-border hover:bg-bxo-accent-soft ${priorityClass}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-bxo-accent-border bg-bxo-accent-soft text-bxo-accent-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="font-display text-base font-semibold text-bxo-text-primary">
            {item.label}
          </span>
          <span className="font-mono text-xl font-semibold text-bxo-accent-primary">
            {item.count}
          </span>
        </span>
        <span className="mt-1 block text-sm leading-6 text-bxo-text-secondary">
          {item.description}
        </span>
        <span className="mt-2 block text-xs uppercase tracking-[0.12em] text-bxo-text-tertiary">
          Owner · {item.owner}
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-bxo-text-tertiary transition group-hover:translate-x-0.5 group-hover:text-bxo-accent-primary"
        aria-hidden="true"
      />
    </Link>
  )
}

export default function WealthManagerDashboard() {
  const { user } = useAuth()
  const [overview, setOverview] = useState<OperatorOverview | null>(null)
  const [overviewLoaded, setOverviewLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canAccessSubscriptionQueue = hasAnyRole(
    user?.roles,
    [...SUBSCRIPTION_WORKFLOW_ROLES]
  )

  const canManageOfferings = Boolean(
    user?.permissions?.['offering:edit'] ||
      user?.roles?.some(
        (role) =>
          role === 'OfferingManager' ||
          role === 'IssuerFundManager' ||
          role === 'SuperAdmin'
      )
  )

  const loadOverview = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setOverview(null)
    setOverviewLoaded(false)
    setError('')
    try {
      const nextOverview = await blockXOneApi.operator.overview(user.token)
      setOverview(nextOverview)
      setOverviewLoaded(true)
    } catch (caught) {
      setOverview(null)
      setError(
        caught instanceof Error
          ? caught.message
          : 'The operator overview could not be loaded.'
      )
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const pipeline = useMemo<PipelineStage[]>(() => {
    if (!overview) return []
    const { queues, capabilities } = overview

    return [
      ...(capabilities.view_offerings
        ? [{
            label: 'Offerings',
            detail: `${queues.offerings.draft} draft · ${queues.offerings.live} live`,
            count: queues.offerings.total,
            href: '/wm/funds',
            icon: Landmark,
            attention: queues.offerings.draft > 0,
          }]
        : []),
      ...(capabilities.review_compliance
        ? [{
            label: 'KYC',
            detail: 'Submitted for review',
            count: queues.kyc.submitted,
            href: '/compliance/queue',
            icon: Fingerprint,
            attention: queues.kyc.submitted > 0,
          }]
        : []),
      ...(capabilities.approve_wallets
        ? [{
            label: 'Wallets',
            detail: 'Pending approval',
            count: queues.wallets.pending,
            href: '/compliance/wallets',
            icon: WalletCards,
            attention: queues.wallets.pending > 0,
          }]
        : []),
      ...(capabilities.approve_subscriptions && canAccessSubscriptionQueue
        ? [{
            label: 'Subscriptions',
            detail: 'Awaiting approval',
            count: queues.subscriptions.requested,
            href: '/wm/subscriptions',
            icon: ClipboardCheck,
            attention: queues.subscriptions.requested > 0,
          }]
        : []),
      ...(capabilities.notify_payments
        ? [{
            label: 'Settlement',
            detail: 'Test consideration evidence and ledger reconciliation',
            count: queues.subscriptions.approved,
            href: '/wm/settlements',
            icon: CircleDollarSign,
            attention: queues.subscriptions.approved > 0,
          }]
        : []),
      ...(capabilities.execute_whitelist
        ? [{
            label: 'Whitelist',
            detail: `${queues.whitelist.confirmed} confirmed`,
            count: queues.whitelist.actionable,
            href: '/tokenisation-agent/whitelist',
            icon: ShieldCheck,
            attention: queues.whitelist.actionable > 0,
          }]
        : []),
    ]
  }, [canAccessSubscriptionQueue, overview])
  const nextPipelineStage =
    pipeline.find((stage) => stage.attention && stage.href) ||
    pipeline.find((stage) => stage.href)

  const metrics = useMemo(() => {
    if (!overview) return []
    const { queues } = overview
    const openWork =
      queues.kyc.submitted +
      queues.wallets.pending +
      queues.subscriptions.requested +
      queues.subscriptions.approved +
      queues.whitelist.actionable
    const subscriptionTotal =
      queues.subscriptions.requested +
      queues.subscriptions.approved

    return [
      {
        label: 'Live offerings',
        value: String(queues.offerings.live),
        detail: `${queues.offerings.total} total · ${queues.offerings.draft} in draft`,
        icon: Boxes,
      },
      {
        label: 'Open work',
        value: String(openWork),
        detail: 'Role-controlled actions across the issuance journey',
        icon: ListChecks,
      },
      {
        label: 'Investor instructions',
        value: String(subscriptionTotal),
        detail: `${queues.subscriptions.requested} requested · ${queues.subscriptions.approved} approved`,
        icon: UsersRound,
      },
    ]
  }, [overview])

  const managedTestnet = blockXOneRuntimeScope() === 'TESTNET'
  const attentionItems =
    overview?.action_items?.filter(
      (item) =>
        item.count > 0 &&
        !LEGACY_ISSUANCE_ACTIONS.has(item.key) &&
        (item.key !== 'requested_subscriptions' || canAccessSubscriptionQueue)
    ) || []

  return (
    <WorkspaceFrame>
      <div className="space-y-7">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bxo-accent-border bg-bxo-accent-soft px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold text-bxo-accent-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {managedTestnet ? 'Public testnet operations' : 'Private validation network'}
            </span>
            <span className="text-bxo-text-secondary">
              {managedTestnet
                ? 'Configured public testnet rails · Stripe TEST provider consideration · no live money claim · chain evidence shown by finality state'
                : 'Private chain records · independent synthetic consideration · no payment provider, public network, or real funds'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-bxo-text-tertiary">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            {overviewLoaded && overview
              ? `Data refreshed ${safeDate(overview.generated_at)}`
              : loading
                ? 'Loading live data'
                : 'Live data unavailable'}
          </div>
        </div>

        <WorkspaceHeader
          eyebrow="Operator workspace"
          title="Operator command center"
          description="Follow the full issuance journey, move work between authorised teams, and see exactly what needs attention next."
          primaryAction={
            canManageOfferings
              ? { href: '/wm/funds/new', label: 'Create offering' }
              : undefined
          }
          secondaryAction={{ href: '/wm/funds', label: 'View offerings' }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-bxo-border-subtle py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className={`inline-flex items-center gap-2 ${overviewLoaded ? 'text-bxo-success-light' : 'text-bxo-warning-light'}`}>
              <span className={`h-2 w-2 rounded-full ${overviewLoaded ? 'bg-bxo-success' : 'bg-bxo-warning'}`} />
              {overviewLoaded ? 'Platform data confirmed' : 'Platform data not confirmed'}
            </span>
            <span className="text-bxo-text-secondary">
              Signed in as <span className="font-medium text-bxo-text-primary">{user?.email}</span>
            </span>
            <span className="font-mono text-xs text-bxo-text-tertiary">
              {user?.roles?.join(' · ')}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bxo-secondary-cta min-h-11"
            onClick={() => void loadOverview()}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh data
          </Button>
        </div>

        {error ? (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-5" role="alert">
            <div className="font-semibold text-bxo-danger-light">Overview unavailable</div>
            <p className="mt-1 text-sm text-bxo-text-secondary">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 min-h-11"
              onClick={() => void loadOverview()}
            >
              Try again
            </Button>
          </Card>
        ) : null}

        <section aria-labelledby="overview-metrics">
          <h2 id="overview-metrics" className="sr-only">Operational metrics</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading && !overview
              ? Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index} />)
              : !overviewLoaded
                ? (
                    <Card className="bxo-card p-5 sm:col-span-2 xl:col-span-4">
                      <div className="text-sm font-semibold text-bxo-warning-light">Operational metrics unavailable</div>
                      <p className="mt-2 text-sm text-bxo-text-secondary">Refresh the authoritative operator overview before relying on queue totals.</p>
                    </Card>
                  )
              : metrics.map(({ label, value, detail, icon: Icon }) => (
                  <Card key={label} className="bxo-card relative overflow-hidden p-5">
                    <div className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl bg-bxo-accent-soft text-bxo-accent-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="text-sm text-bxo-text-tertiary">{label}</div>
                    <div className="mt-3 font-display text-4xl font-semibold tracking-tight text-bxo-text-primary">
                      {value}
                    </div>
                    <div className="mt-2 max-w-[15rem] text-xs leading-5 text-bxo-text-secondary">
                      {detail}
                    </div>
                  </Card>
                ))}
          </div>
        </section>

        <Card className="bxo-panel overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-bxo-border-subtle px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="bxo-kicker">Issuance journey</div>
              <h2 className="mt-2 font-display text-xl font-semibold">One controlled flow, clear handoffs</h2>
            </div>
            <p className="text-xs text-bxo-text-tertiary">
              Counts are loaded from persisted platform records
            </p>
          </div>

          {loading && !overview ? (
            <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton h-28 rounded-xl" />
              ))}
            </div>
          ) : !overviewLoaded ? (
            <div className="p-6 text-sm text-bxo-warning-light">
              The persisted issuance pipeline is unavailable. Refresh before relying on stage counts.
            </div>
          ) : (
            <div className="grid gap-px bg-bxo-divider sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {pipeline.map((stage, index) => {
                const Icon = stage.icon
                const content = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-bxo-border-subtle bg-bxo-surface text-bxo-accent-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          stage.attention ? 'bg-bxo-warning' : 'bg-bxo-success'
                        }`}
                        title={stage.attention ? 'Work waiting' : 'Stage clear'}
                      />
                    </div>
                    <div className="mt-5">
                      <div className="text-xs uppercase tracking-[0.13em] text-bxo-text-tertiary">
                        {String(index + 1).padStart(2, '0')} · {stage.label}
                      </div>
                      <div className="mt-2 font-display text-3xl font-semibold text-bxo-text-primary">
                        {stage.count}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-bxo-text-secondary">
                        {stage.detail}
                      </div>
                    </div>
                  </>
                )

                return stage.href ? (
                  <Link
                    key={stage.label}
                    href={stage.href}
                    className="min-h-40 bg-bxo-bg-primary/70 p-4 transition hover:bg-bxo-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bxo-accent-primary"
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={stage.label} className="min-h-40 bg-bxo-bg-primary/70 p-4">
                    {content}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="bxo-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-bxo-border-subtle px-5 py-4">
              <div>
                <h2 className="font-display text-xl font-semibold">Needs attention</h2>
                <p className="mt-1 text-sm text-bxo-text-secondary">
                  Work is routed to the team authorised to complete it.
                </p>
              </div>
              <span className="rounded-full border border-bxo-warning-border bg-bxo-warning/10 px-3 py-1 font-mono text-sm text-bxo-warning-light">
                {overviewLoaded
                  ? attentionItems.reduce((total, item) => total + item.count, 0)
                  : '?'}
              </span>
            </div>
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {loading && !overview ? (
                Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="skeleton h-28 rounded-xl" />
                ))
              ) : !overviewLoaded ? (
                <div className="col-span-full min-h-40 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-6 text-sm text-bxo-warning-light">
                  Attention queues are unavailable. Refresh the authoritative overview before treating any queue as clear.
                </div>
              ) : attentionItems.length ? (
                attentionItems.map((item) => (
                  <ActionCard key={item.key} item={item} />
                ))
              ) : (
                <div className="col-span-full flex min-h-40 flex-col items-center justify-center rounded-xl border border-bxo-border-subtle bg-bxo-surface p-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-bxo-success" aria-hidden="true" />
                  <h3 className="mt-3 font-display text-lg font-semibold">No work is waiting in your authorised queues</h3>
                  <p className="mt-1 text-sm text-bxo-text-secondary">
                    New work that matches your verified capabilities will appear here with an owner and next action.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="bxo-card overflow-hidden">
            <div className="border-b border-bxo-border-subtle px-5 py-4">
              <h2 className="font-display text-xl font-semibold">Recent activity</h2>
              <p className="mt-1 text-sm text-bxo-text-secondary">
                Latest authorised workflow events.
              </p>
            </div>
            <div className="divide-y divide-bxo-divider">
              {loading && !overview ? (
                <div className="space-y-4 p-5">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="skeleton h-12 rounded-lg" />
                  ))}
                </div>
              ) : !overviewLoaded ? (
                <div className="p-6 text-sm text-bxo-warning-light">
                  Recent activity is unavailable until the authoritative overview loads successfully.
                </div>
              ) : overview?.recent_activity?.length ? (
                overview.recent_activity.slice(0, 6).map((activity) => (
                  <div key={activity.id} className="flex gap-3 px-5 py-4">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-bxo-accent-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-bxo-text-primary">
                        {readableAction(activity.action)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-bxo-text-tertiary">
                        <span>{activity.actor_email || 'System'}</span>
                        <span>·</span>
                        <span>{safeDate(activity.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-sm text-bxo-text-secondary">
                  Activity is available to audit-authorised operators.
                </div>
              )}
            </div>
          </Card>
        </section>

        <Card className="bxo-panel grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-bxo-accent-border bg-bxo-accent-soft text-bxo-accent-primary">
              <FilePlus2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">
                Issuance workflow handoffs
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-bxo-text-secondary">
                {overviewLoaded
                  ? 'Use the authoritative queue facts above to choose the next offering, subscription, compliance, whitelist, issuance, or ledger handoff.'
                  : 'Refresh the authoritative overview before relying on queue status or beginning a new handoff.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {overviewLoaded &&
            overview?.capabilities.view_offerings &&
            nextPipelineStage?.href !== '/wm/funds' ? (
              <Button asChild variant="outline" className="bxo-secondary-cta min-h-11">
                <Link href="/wm/funds">Open offering</Link>
              </Button>
            ) : null}
            {overviewLoaded && nextPipelineStage?.href ? (
              <Button asChild className="bxo-primary-cta min-h-11 text-bxo-bg-primary">
                <Link href={nextPipelineStage.href}>
                  Open {nextPipelineStage.label.toLowerCase()} handoff
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <Button disabled className="min-h-11">
                Handoff unavailable
              </Button>
            )}
          </div>
        </Card>
      </div>
    </WorkspaceFrame>
  )
}
