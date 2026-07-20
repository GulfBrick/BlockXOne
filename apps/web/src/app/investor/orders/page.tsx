'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, Briefcase, Clock, Coins, Layers, TrendingUp, Wallet } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusVariant } from '@/components/ui/status-badge'
import type { NavItem } from '@/components/ui/sidebar-nav'
import { useAuth } from '@/lib/auth-context-v2'
import { transactionApi } from '@/lib/api-client'

/**
 * Raw shape returned by GET /v1/transactions (cmd/api/routes.go L2370).
 * This endpoint is an AUDIT-LOG feed over the `audit_log` table — actor +
 * action + entity, ordered newest-first, LIMIT 200. It is NOT a financial
 * buy/sell order ledger, so there is no price/quantity/amount field.
 * `actor_user_id` and `entity_id` are COALESCE'd server-side to '' (never null);
 * `created_at` is a Go time.Time that marshals to an RFC3339 string.
 */
interface TransactionRow {
  id: string
  actor_user_id: string
  action: string
  entity_type: string
  entity_id: string
  created_at: string
}

/** Row shape DataTable consumes (requires an `id`). */
interface ActivityRow extends TransactionRow {
  createdAtMs: number
}

const INVESTOR_NAV: NavItem[] = [
  { label: 'Portfolio', href: '/investor/portfolio', icon: <Briefcase className="h-5 w-5" /> },
  { label: 'Market', href: '/investor/market', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Orders', href: '/investor/orders', icon: <Layers className="h-5 w-5" /> },
  { label: 'P2P Transfer', href: '/investor/p2p', icon: <Wallet className="h-5 w-5" /> },
  { label: 'KYC & Verification', href: '/investor/kyc', icon: <Coins className="h-5 w-5" /> }
]

/** Maps an audit action verb to a status colour, best-effort. */
function actionVariant(action: string): StatusVariant {
  const a = (action || '').toLowerCase()
  if (a.includes('approve') || a.includes('publish') || a.includes('complete') || a.includes('success') || a.includes('mint')) {
    return 'success'
  }
  if (a.includes('reject') || a.includes('cancel') || a.includes('fail') || a.includes('burn') || a.includes('freeze') || a.includes('delete')) {
    return 'error'
  }
  if (a.includes('pending') || a.includes('request') || a.includes('submit') || a.includes('queue')) {
    return 'pending'
  }
  if (a.includes('update') || a.includes('edit') || a.includes('pause')) {
    return 'warning'
  }
  if (a.includes('create') || a.includes('subscribe') || a.includes('login') || a.includes('view')) {
    return 'info'
  }
  return 'neutral'
}

/** Humanizes a snake/kebab token: "offering_published" → "Offering Published". */
function humanize(value: string): string {
  if (!value) return '—'
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function shortId(value: string): string {
  if (!value) return '—'
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function formatTimestamp(value: string): string {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ms))
}

function relativeTime(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function OrdersPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [rows, setRows] = useState<ActivityRow[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      setIsFetching(false)
      return
    }

    let cancelled = false
    setIsFetching(true)
    setError(null)

    transactionApi
      .list(user.id, user.email, user.roles)
      .then((data) => {
        if (cancelled) return
        const list = (Array.isArray(data) ? data : []) as TransactionRow[]
        const mapped: ActivityRow[] = list.map((t) => ({
          ...t,
          createdAtMs: Date.parse(t.created_at) || 0
        }))
        setRows(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load activity feed')
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, loading])

  const distinctActions = useMemo(
    () => new Set(rows.map((r) => r.action).filter(Boolean)).size,
    [rows]
  )
  const distinctEntities = useMemo(
    () => new Set(rows.map((r) => r.entity_type).filter(Boolean)).size,
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.action?.toLowerCase().includes(q) ||
        r.entity_type?.toLowerCase().includes(q) ||
        r.entity_id?.toLowerCase().includes(q) ||
        r.actor_user_id?.toLowerCase().includes(q)
    )
  }, [rows, searchQuery])

  const columns = useMemo<ColumnDef<ActivityRow>[]>(
    () => [
      {
        accessorKey: 'action',
        header: 'Action',
        cell: ({ row }) => (
          <StatusBadge
            variant={actionVariant(row.original.action)}
            label={humanize(row.original.action) || 'Event'}
          />
        )
      },
      {
        id: 'entity',
        header: 'Entity',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-bxo-text-primary">
              {humanize(row.original.entity_type) || 'Record'}
            </span>
            {row.original.entity_id ? (
              <span className="font-mono text-xs text-bxo-text-tertiary">
                {shortId(row.original.entity_id)}
              </span>
            ) : null}
          </div>
        )
      },
      {
        accessorKey: 'actor_user_id',
        header: 'Actor',
        cell: ({ row }) =>
          row.original.actor_user_id ? (
            <span className="font-mono text-sm text-bxo-text-secondary">
              {shortId(row.original.actor_user_id)}
            </span>
          ) : (
            <span className="text-sm text-bxo-text-tertiary">System</span>
          )
      },
      {
        accessorKey: 'createdAtMs',
        header: 'Time',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-sm text-bxo-text-primary">
              {formatTimestamp(row.original.created_at)}
            </span>
            <span className="text-xs text-bxo-text-tertiary">
              {relativeTime(row.original.createdAtMs)}
            </span>
          </div>
        )
      }
    ],
    []
  )

  return (
    <DashboardLayout
      navItems={INVESTOR_NAV}
      userRole="Investor"
      currentPath="/investor/orders"
      userName={user?.email}
      onLogout={() => {
        router.push('/login')
      }}
      breadcrumbs={[
        { label: 'Investor', href: '/investor/portfolio' },
        { label: 'Orders' }
      ]}
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-bxo-text-primary">
            Order Activity
          </h1>
          <p className="text-sm text-bxo-text-secondary">
            A chronological audit trail of every action across your BlockXOne account —
            subscriptions, redemptions, approvals, and settlement events.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total Events"
            value={rows.length}
            icon={<Activity className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Action Types"
            value={distinctActions}
            icon={<Layers className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Entities Touched"
            value={distinctEntities}
            icon={<Clock className="h-5 w-5" />}
            isLoading={isFetching}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-bxo-border bg-bxo-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Activity className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bxo-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by action, entity, or actor..."
              className="w-full rounded-lg border border-bxo-border bg-bxo-bg-primary py-2 pl-9 pr-3 text-sm text-bxo-text-primary placeholder:text-bxo-text-tertiary focus:border-bxo-accent focus:outline-none focus:ring-1 focus:ring-bxo-accent"
            />
          </div>
          <span className="text-xs text-bxo-text-tertiary">
            Showing {filteredRows.length} of {rows.length} events · last 200
          </span>
        </div>

        {error ? (
          <div className="rounded-xl border border-bxo-danger/30 bg-bxo-danger/10 p-4 text-sm text-bxo-danger">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-bxo-border bg-bxo-surface">
          <div className="border-b border-bxo-border px-5 py-4">
            <h2 className="text-sm font-semibold text-bxo-text-primary">Activity Feed</h2>
          </div>
          <div className="p-2">
            <DataTable<ActivityRow>
              columns={columns}
              data={filteredRows}
              isLoading={isFetching}
              isEmpty={!isFetching && filteredRows.length === 0}
              emptyStateMessage={
                rows.length === 0
                  ? 'No activity yet. Your subscriptions, redemptions, and settlement events will appear here.'
                  : 'No events match your filter. Try a different action or entity.'
              }
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
