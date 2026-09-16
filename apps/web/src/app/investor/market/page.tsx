'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Coins, Layers, Search, TrendingUp } from 'lucide-react'

import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import type { StatusVariant } from '@/components/ui/status-badge'
import { useAuth } from '@/lib/auth-context-v2'
import { investorCatalogApi } from '@/lib/api-client'
import {
  compareExactDecimals,
  formatExactMoney,
  isPositiveExactDecimal,
  parseExactDecimal,
} from '@/lib/exact-decimal'
import type { InvestorCatalogListItem } from '@/lib/pilot-finance'
import { countDistinctNetworkTargets } from '@/lib/pilot-record-presentation'

/** Row shape DataTable consumes (requires an `id`). */
type MarketRow = InvestorCatalogListItem

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
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAssetType, setSelectedAssetType] = useState('All')

  useEffect(() => {
    if (loading) return
    if (!user) {
      setRows([])
      setCatalogLoaded(false)
      setIsFetching(false)
      return
    }

    let cancelled = false
    setIsFetching(true)
    setRows([])
    setCatalogLoaded(false)
    setError(null)

    investorCatalogApi
      .list(user.token)
      .then((data) => {
        if (cancelled) return
        if (!Array.isArray(data)) throw new Error('Marketplace returned an invalid catalog response.')
        setRows(data)
        setCatalogLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        setRows([])
        setCatalogLoaded(false)
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
    () => ['All', ...Array.from(new Set(rows.map((r) => r.asset_class).filter(Boolean)))],
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((r) => {
      const matchesSearch =
        !q ||
        r.name?.toLowerCase().includes(q) ||
        r.asset_class?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
      const matchesType = selectedAssetType === 'All' || r.asset_class === selectedAssetType
      return matchesSearch && matchesType
    })
  }, [rows, searchQuery, selectedAssetType])

  const distinctAssetTypes = useMemo(
    () => new Set(rows.map((r) => r.asset_class).filter(Boolean)).size,
    [rows]
  )
  const networkTargetCount = useMemo(
    () => countDistinctNetworkTargets(rows),
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
        accessorKey: 'asset_class',
        header: 'Asset Type',
        cell: ({ row }) => (
          <span className="text-sm text-bxo-text-secondary">
            {prettyAssetType(row.original.asset_class)}
          </span>
        )
      },
      {
        accessorKey: 'price',
        header: 'Price',
        sortingFn: (left, right) =>
          compareExactDecimals(left.original.price, right.original.price),
        cell: ({ row }) =>
          isPositiveExactDecimal(parseExactDecimal(row.original.price ?? '')) ? (
            <span className="font-mono text-sm font-semibold text-bxo-text-primary">
              {formatExactMoney(row.original.price, row.original.currency)}
            </span>
          ) : (
            <span className="text-sm text-bxo-text-tertiary">Not available</span>
          )
      },
      {
        id: 'settlement',
        header: 'Environment',
        cell: ({ row }) =>
          row.original.chain_id != null ? (
            <span className="font-mono text-xs text-bxo-text-secondary">
              {row.original.runtime_scope === 'TESTNET'
                ? 'Public testnet'
                : row.original.runtime_scope === 'LOCAL_PILOT'
                  ? 'Private validation network'
                  : 'Network not recorded'} · chain {row.original.chain_id}
            </span>
          ) : (
            <span className="text-xs text-bxo-text-tertiary">Not configured</span>
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
    <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-bxo-text-primary">
            Market
          </h1>
          <p className="text-sm text-bxo-text-secondary">
            Approved offerings within your organisation&apos;s authorised launch perimeter.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Live Offerings"
            value={catalogLoaded ? rows.length : 'Unavailable'}
            icon={<TrendingUp className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Asset Classes"
            value={catalogLoaded ? distinctAssetTypes : 'Unavailable'}
            icon={<Layers className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Network Targets"
            value={catalogLoaded ? networkTargetCount : 'Unavailable'}
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
            {!isFetching && !catalogLoaded ? (
              <div className="p-8 text-center text-sm text-bxo-warning-light">
                The authoritative opportunity catalog is unavailable. Refresh or sign in again before relying on availability.
              </div>
            ) : (
              <DataTable<MarketRow>
                columns={columns}
                data={filteredRows}
                isLoading={isFetching}
                isEmpty={!isFetching && catalogLoaded && filteredRows.length === 0}
                emptyStateMessage={
                  rows.length === 0
                    ? 'No live offerings are currently available.'
                    : 'No offerings match your search. Try a different term or asset type.'
                }
                onRowClick={(row) => router.push(`/investor/funds/${row.id}`)}
              />
            )}
          </div>
        </div>
    </div>
  )
}
