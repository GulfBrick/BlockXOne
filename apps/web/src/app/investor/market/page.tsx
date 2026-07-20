'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Briefcase, Coins, Layers, Search, TrendingUp, Wallet } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusVariant } from '@/components/ui/status-badge'
import type { NavItem } from '@/components/ui/sidebar-nav'
import { useAuth } from '@/lib/auth-context-v2'
import { offeringApi } from '@/lib/api-client'

/**
 * Raw shape returned by GET /v1/offerings (cmd/api/routes.go L1280).
 * Only status='LIVE' rows, LIMIT 200. `price` is cast `*string` server-side
 * (arrives as a string or null); `chain_id` is `*int64` (nullable number).
 */
interface OfferingRow {
  id: string
  status: string
  chain_id: number | null
  price: string | null
  currency: string
  token_contract: string
  compliance_registry: string
  asset_type: string
  name: string
  description: string
}

/** Row shape DataTable consumes (requires an `id`). */
interface MarketRow extends OfferingRow {
  priceNum: number
}

const INVESTOR_NAV: NavItem[] = [
  { label: 'Portfolio', href: '/investor/portfolio', icon: <Briefcase className="h-5 w-5" /> },
  { label: 'Market', href: '/investor/market', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Orders', href: '/investor/orders', icon: <Layers className="h-5 w-5" /> },
  { label: 'P2P Transfer', href: '/investor/p2p', icon: <Wallet className="h-5 w-5" /> },
  { label: 'KYC & Verification', href: '/investor/kyc', icon: <Coins className="h-5 w-5" /> }
]

function formatPrice(value: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(value)
  } catch {
    // Unknown / non-ISO currency code — render as a plain number with the code.
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)} ${code}`
  }
}

function statusVariant(status: string): StatusVariant {
  switch (status.toUpperCase()) {
    case 'LIVE':
      return 'success'
    case 'PAUSED':
      return 'warning'
    case 'CLOSED':
    case 'CANCELLED':
      return 'error'
    case 'DRAFT':
    case 'PENDING':
      return 'pending'
    default:
      return 'neutral'
  }
}

function prettyAssetType(value: string): string {
  if (!value) return 'Asset'
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function MarketplacePage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [rows, setRows] = useState<MarketRow[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAssetType, setSelectedAssetType] = useState('All')

  useEffect(() => {
    if (loading) return
    if (!user) {
      setIsFetching(false)
      return
    }

    let cancelled = false
    setIsFetching(true)
    setError(null)

    offeringApi
      .list(user.id, user.email)
      .then((data) => {
        if (cancelled) return
        const list = (Array.isArray(data) ? data : []) as OfferingRow[]
        const mapped: MarketRow[] = list.map((o) => ({
          ...o,
          priceNum: Number.parseFloat(o.price ?? '') || 0
        }))
        setRows(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load marketplace')
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, loading])

  const assetTypes = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.asset_type).filter(Boolean)))],
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((r) => {
      const matchesSearch =
        !q ||
        r.name?.toLowerCase().includes(q) ||
        r.asset_type?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
      const matchesType = selectedAssetType === 'All' || r.asset_type === selectedAssetType
      return matchesSearch && matchesType
    })
  }, [rows, searchQuery, selectedAssetType])

  const distinctAssetTypes = useMemo(
    () => new Set(rows.map((r) => r.asset_type).filter(Boolean)).size,
    [rows]
  )
  const onchainCount = useMemo(
    () => rows.filter((r) => r.chain_id != null).length,
    [rows]
  )

  const columns = useMemo<ColumnDef<MarketRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Offering',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-bxo-text-primary">
              {row.original.name || 'Unnamed Offering'}
            </span>
            <span className="font-mono text-xs text-bxo-text-tertiary">
              {row.original.id}
            </span>
          </div>
        )
      },
      {
        accessorKey: 'asset_type',
        header: 'Asset Type',
        cell: ({ row }) => (
          <span className="text-sm text-bxo-text-secondary">
            {prettyAssetType(row.original.asset_type)}
          </span>
        )
      },
      {
        accessorKey: 'priceNum',
        header: 'Price',
        cell: ({ row }) =>
          row.original.priceNum > 0 ? (
            <span className="font-mono text-sm font-semibold text-bxo-text-primary">
              {formatPrice(row.original.priceNum, row.original.currency)}
            </span>
          ) : (
            <span className="text-sm text-bxo-text-tertiary">—</span>
          )
      },
      {
        id: 'settlement',
        header: 'Settlement',
        cell: ({ row }) =>
          row.original.chain_id != null ? (
            <span className="font-mono text-xs text-bxo-text-secondary">
              Chain #{row.original.chain_id}
            </span>
          ) : (
            <span className="text-xs text-bxo-text-tertiary">Off-chain</span>
          )
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge
            variant={statusVariant(row.original.status)}
            label={prettyAssetType(row.original.status || 'Live')}
          />
        )
      }
    ],
    []
  )

  return (
    <DashboardLayout
      navItems={INVESTOR_NAV}
      userRole="Investor"
      currentPath="/investor/market"
      userName={user?.email}
      onLogout={() => {
        router.push('/login')
      }}
      breadcrumbs={[
        { label: 'Investor', href: '/investor/portfolio' },
        { label: 'Market' }
      ]}
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-bxo-text-primary">
            Market
          </h1>
          <p className="text-sm text-bxo-text-secondary">
            Live tokenized offerings open for subscription across the BlockXOne platform.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Live Offerings"
            value={rows.length}
            icon={<TrendingUp className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Asset Classes"
            value={distinctAssetTypes}
            icon={<Layers className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="On-chain Settled"
            value={onchainCount}
            icon={<Coins className="h-5 w-5" />}
            isLoading={isFetching}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-bxo-border bg-bxo-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bxo-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search offerings by name or asset type..."
              className="w-full rounded-lg border border-bxo-border bg-bxo-bg-primary py-2 pl-9 pr-3 text-sm text-bxo-text-primary placeholder:text-bxo-text-tertiary focus:border-bxo-accent focus:outline-none focus:ring-1 focus:ring-bxo-accent"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {assetTypes.map((type) => {
              const active = selectedAssetType === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelectedAssetType(type)}
                  className={
                    active
                      ? 'rounded-lg border border-bxo-accent bg-bxo-accent/10 px-3 py-1.5 text-xs font-medium text-bxo-accent transition-colors'
                      : 'rounded-lg border border-bxo-border bg-bxo-bg-primary px-3 py-1.5 text-xs font-medium text-bxo-text-secondary transition-colors hover:border-bxo-border-strong hover:text-bxo-text-primary'
                  }
                >
                  {type === 'All' ? 'All' : prettyAssetType(type)}
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
          <div className="border-b border-bxo-border px-5 py-4">
            <h2 className="text-sm font-semibold text-bxo-text-primary">Available Offerings</h2>
          </div>
          <div className="p-2">
            <DataTable<MarketRow>
              columns={columns}
              data={filteredRows}
              isLoading={isFetching}
              isEmpty={!isFetching && filteredRows.length === 0}
              emptyStateMessage={
                rows.length === 0
                  ? 'No live offerings yet. Check back soon as issuers publish new tokenized assets.'
                  : 'No offerings match your search. Try a different term or asset type.'
              }
              onRowClick={(row) => router.push(`/investor/funds/${row.id}`)}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
