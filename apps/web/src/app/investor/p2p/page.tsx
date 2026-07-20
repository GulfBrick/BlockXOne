'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDownLeft, ArrowUpRight, Briefcase, Coins, Layers, Repeat, TrendingUp, Wallet } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusVariant } from '@/components/ui/status-badge'
import type { NavItem } from '@/components/ui/sidebar-nav'
import { useAuth } from '@/lib/auth-context-v2'
import { marketplaceApi } from '@/lib/api-client'

/**
 * Raw shape returned by GET /v1/marketplace/listings (cmd/api/routes.go L2495).
 * Server returns only status='OPEN' rows, newest-first, LIMIT 200.
 * `units` and `price` are cast `::text` server-side (arrive as strings);
 * `created_at` is a Go time.Time marshalling to an RFC3339 string.
 */
interface ListingRow {
  id: string
  offering_id: string
  seller_user_id: string
  seller_wallet_id: string
  units: string
  price: string
  currency: string
  status: string
  created_at: string
}

/**
 * Raw shape returned by GET /v1/marketplace/rfq (cmd/api/routes.go L2585).
 * Open buy-side requests; `units`/`max_price` are `::text`-cast strings.
 */
interface RfqRow {
  id: string
  offering_id: string
  buyer_user_id: string
  buyer_wallet_id: string
  units: string
  max_price: string
  currency: string
  status: string
  created_at: string
}

/** Unified row the DataTable consumes (requires an `id`). */
interface MarketEntry {
  id: string
  kind: 'listing' | 'rfq'
  offering_id: string
  counterpartyWallet: string
  units: number
  price: number
  notional: number
  currency: string
  status: string
  createdAtMs: number
  created_at: string
}

const INVESTOR_NAV: NavItem[] = [
  { label: 'Portfolio', href: '/investor/portfolio', icon: <Briefcase className="h-5 w-5" /> },
  { label: 'Market', href: '/investor/market', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Orders', href: '/investor/orders', icon: <Layers className="h-5 w-5" /> },
  { label: 'P2P Transfer', href: '/investor/p2p', icon: <Wallet className="h-5 w-5" /> },
  { label: 'KYC & Verification', href: '/investor/kyc', icon: <Coins className="h-5 w-5" /> }
]

function formatUnits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)
}

function formatMoney(value: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(value)
  } catch {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)} ${code}`
  }
}

function statusVariant(status: string): StatusVariant {
  switch ((status || '').toUpperCase()) {
    case 'OPEN':
      return 'success'
    case 'FILLED':
    case 'MATCHED':
      return 'info'
    case 'CANCELLED':
    case 'EXPIRED':
      return 'error'
    case 'PENDING':
      return 'pending'
    default:
      return 'neutral'
  }
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
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

type SideFilter = 'all' | 'listing' | 'rfq'

export default function P2PTransferPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [listings, setListings] = useState<MarketEntry[]>([])
  const [rfqs, setRfqs] = useState<MarketEntry[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [side, setSide] = useState<SideFilter>('all')

  useEffect(() => {
    if (loading) return
    if (!user) {
      setIsFetching(false)
      return
    }

    let cancelled = false
    setIsFetching(true)
    setError(null)

    Promise.all([
      marketplaceApi.listListings(user.id, user.email).catch(() => []),
      marketplaceApi.listRfq(user.id, user.email).catch(() => [])
    ])
      .then(([listingData, rfqData]) => {
        if (cancelled) return

        const mappedListings: MarketEntry[] = (Array.isArray(listingData) ? listingData : [])
          .map((l: ListingRow) => {
            const units = Number.parseFloat(l.units) || 0
            const price = Number.parseFloat(l.price) || 0
            return {
              id: `listing-${l.id}`,
              kind: 'listing' as const,
              offering_id: l.offering_id,
              counterpartyWallet: l.seller_wallet_id,
              units,
              price,
              notional: units * price,
              currency: l.currency,
              status: l.status,
              createdAtMs: Date.parse(l.created_at) || 0,
              created_at: l.created_at
            }
          })

        const mappedRfqs: MarketEntry[] = (Array.isArray(rfqData) ? rfqData : [])
          .map((r: RfqRow) => {
            const units = Number.parseFloat(r.units) || 0
            const price = Number.parseFloat(r.max_price) || 0
            return {
              id: `rfq-${r.id}`,
              kind: 'rfq' as const,
              offering_id: r.offering_id,
              counterpartyWallet: r.buyer_wallet_id,
              units,
              price,
              notional: units * price,
              currency: r.currency,
              status: r.status,
              createdAtMs: Date.parse(r.created_at) || 0,
              created_at: r.created_at
            }
          })

        setListings(mappedListings)
        setRfqs(mappedRfqs)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load the secondary market')
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, loading])

  const combined = useMemo(() => [...listings, ...rfqs], [listings, rfqs])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return combined.filter((r) => {
      const matchesSide = side === 'all' || r.kind === side
      const matchesSearch =
        !q ||
        r.offering_id?.toLowerCase().includes(q) ||
        r.counterpartyWallet?.toLowerCase().includes(q) ||
        r.status?.toLowerCase().includes(q)
      return matchesSide && matchesSearch
    })
  }, [combined, side, searchQuery])

  const sellLiquidity = useMemo(
    () => listings.reduce((sum, r) => sum + r.notional, 0),
    [listings]
  )
  const buyDemand = useMemo(
    () => rfqs.reduce((sum, r) => sum + r.notional, 0),
    [rfqs]
  )

  const columns = useMemo<ColumnDef<MarketEntry>[]>(
    () => [
      {
        accessorKey: 'kind',
        header: 'Side',
        cell: ({ row }) =>
          row.original.kind === 'listing' ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-bxo-success">
              <ArrowUpRight className="h-4 w-4" />
              Sell offer
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-bxo-accent">
              <ArrowDownLeft className="h-4 w-4" />
              Buy request
            </span>
          )
      },
      {
        accessorKey: 'offering_id',
        header: 'Offering',
        cell: ({ row }) => (
          <span className="font-mono text-sm text-bxo-text-primary">
            {shortId(row.original.offering_id)}
          </span>
        )
      },
      {
        accessorKey: 'units',
        header: 'Units',
        cell: ({ row }) => (
          <span className="font-mono text-sm text-bxo-text-primary">
            {formatUnits(row.original.units)}
          </span>
        )
      },
      {
        accessorKey: 'price',
        header: ({ column }) => <span>{column.id === 'price' ? 'Price / Max' : 'Price'}</span>,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-sm font-semibold text-bxo-text-primary">
              {formatMoney(row.original.price, row.original.currency)}
            </span>
            <span className="text-xs text-bxo-text-tertiary">
              {row.original.kind === 'rfq' ? 'max bid' : 'per unit'}
            </span>
          </div>
        )
      },
      {
        accessorKey: 'notional',
        header: 'Notional',
        cell: ({ row }) =>
          row.original.notional > 0 ? (
            <span className="font-mono text-sm text-bxo-text-secondary">
              {formatMoney(row.original.notional, row.original.currency)}
            </span>
          ) : (
            <span className="text-sm text-bxo-text-tertiary">—</span>
          )
      },
      {
        accessorKey: 'counterpartyWallet',
        header: 'Counterparty',
        cell: ({ row }) =>
          row.original.counterpartyWallet ? (
            <span className="font-mono text-sm text-bxo-text-secondary">
              {shortId(row.original.counterpartyWallet)}
            </span>
          ) : (
            <span className="text-sm text-bxo-text-tertiary">—</span>
          )
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge variant={statusVariant(row.original.status)} label={row.original.status || 'Open'} />
        )
      },
      {
        accessorKey: 'createdAtMs',
        header: 'Posted',
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

  const sideFilters: { key: SideFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'listing', label: 'Sell offers' },
    { key: 'rfq', label: 'Buy requests' }
  ]

  return (
    <DashboardLayout
      navItems={INVESTOR_NAV}
      userRole="Investor"
      currentPath="/investor/p2p"
      userName={user?.email}
      onLogout={() => {
        router.push('/login')
      }}
      breadcrumbs={[
        { label: 'Investor', href: '/investor/portfolio' },
        { label: 'P2P Transfer' }
      ]}
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-bxo-text-primary">
            P2P Transfer
          </h1>
          <p className="text-sm text-bxo-text-secondary">
            The BlockXOne secondary market. Browse open sell offers and buy requests across tokenized
            offerings, then negotiate compliant peer-to-peer settlement through the matching engine.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Open Sell Offers"
            value={listings.length}
            icon={<ArrowUpRight className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Open Buy Requests"
            value={rfqs.length}
            icon={<ArrowDownLeft className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Ask Liquidity"
            value={sellLiquidity}
            icon={<Repeat className="h-5 w-5" />}
            isLoading={isFetching}
            formatValue={(v) => formatMoney(Number(v), 'USD')}
          />
          <StatCard
            label="Bid Demand"
            value={buyDemand}
            icon={<Coins className="h-5 w-5" />}
            isLoading={isFetching}
            formatValue={(v) => formatMoney(Number(v), 'USD')}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-bxo-border bg-bxo-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bxo-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by offering, counterparty, or status..."
              className="w-full rounded-lg border border-bxo-border bg-bxo-bg-primary py-2 pl-9 pr-3 text-sm text-bxo-text-primary placeholder:text-bxo-text-tertiary focus:border-bxo-accent focus:outline-none focus:ring-1 focus:ring-bxo-accent"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sideFilters.map((f) => {
              const active = side === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setSide(f.key)}
                  className={
                    active
                      ? 'rounded-lg border border-bxo-accent bg-bxo-accent/10 px-3 py-1.5 text-xs font-medium text-bxo-accent transition-colors'
                      : 'rounded-lg border border-bxo-border bg-bxo-bg-primary px-3 py-1.5 text-xs font-medium text-bxo-text-secondary transition-colors hover:border-bxo-border-strong hover:text-bxo-text-primary'
                  }
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-bxo-danger/30 bg-bxo-danger/10 p-4 text-sm text-bxo-danger">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-bxo-border bg-bxo-surface">
          <div className="flex items-center justify-between border-b border-bxo-border px-5 py-4">
            <h2 className="text-sm font-semibold text-bxo-text-primary">Secondary Market Book</h2>
            <span className="text-xs text-bxo-text-tertiary">
              Showing {filteredRows.length} of {combined.length} open orders
            </span>
          </div>
          <div className="p-2">
            <DataTable<MarketEntry>
              columns={columns}
              data={filteredRows}
              isLoading={isFetching}
              isEmpty={!isFetching && filteredRows.length === 0}
              emptyStateMessage={
                combined.length === 0
                  ? 'No open orders on the secondary market yet. Sell offers and buy requests will appear here as participants post them.'
                  : 'No orders match your filter. Try a different side or search term.'
              }
              onRowClick={(row) => router.push(`/investor/funds/${row.offering_id}`)}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
