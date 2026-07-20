'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Briefcase, Coins, Layers, TrendingUp, Wallet } from 'lucide-react'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import type { NavItem } from '@/components/ui/sidebar-nav'
import { WalletWidget } from '@/components/wallet/WalletWidget'
import { useAuth } from '@/lib/auth-context-v2'
import { portfolioApi } from '@/lib/api-client'

/**
 * Raw shape returned by GET /v1/portfolio (cmd/api/routes.go).
 * `balance` is cast `::text` server-side, so it arrives as a string.
 */
interface PortfolioRow {
  offering_id: string
  wallet_id: string
  balance: string
  offering_name: string
}

/** Row shape DataTable consumes (requires an `id`). */
interface HoldingRow extends PortfolioRow {
  id: string
  balanceNum: number
}

const INVESTOR_NAV: NavItem[] = [
  { label: 'Portfolio', href: '/investor/portfolio', icon: <Briefcase className="h-5 w-5" /> },
  { label: 'Market', href: '/investor/market', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Orders', href: '/investor/orders', icon: <Layers className="h-5 w-5" /> },
  { label: 'P2P Transfer', href: '/investor/p2p', icon: <Wallet className="h-5 w-5" /> },
  { label: 'KYC & Verification', href: '/investor/kyc', icon: <Coins className="h-5 w-5" /> }
]

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  }).format(value)
}

function shortWallet(wallet: string): string {
  if (!wallet) return '—'
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

export default function PortfolioPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  const [rows, setRows] = useState<HoldingRow[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const walletAllowed = Boolean(user?.roles?.some((r) => r === 'Investor'))

  useEffect(() => {
    if (loading) return
    if (!user) {
      setIsFetching(false)
      return
    }

    let cancelled = false
    setIsFetching(true)
    setError(null)

    portfolioApi
      .get(user.id, user.email)
      .then((data) => {
        if (cancelled) return
        const list = (Array.isArray(data) ? data : []) as PortfolioRow[]
        const mapped: HoldingRow[] = list.map((r, i) => ({
          ...r,
          id: r.offering_id || `${r.wallet_id}-${i}`,
          balanceNum: Number.parseFloat(r.balance) || 0
        }))
        setRows(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load portfolio')
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [user, loading])

  const totalUnits = useMemo(
    () => rows.reduce((sum, r) => sum + r.balanceNum, 0),
    [rows]
  )
  const fundedPositions = useMemo(
    () => rows.filter((r) => r.balanceNum > 0).length,
    [rows]
  )

  const columns = useMemo<ColumnDef<HoldingRow>[]>(
    () => [
      {
        accessorKey: 'offering_name',
        header: 'Offering',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-bxo-text-primary">
              {row.original.offering_name || 'Unnamed Offering'}
            </span>
            <span className="font-mono text-xs text-bxo-text-tertiary">
              {row.original.offering_id}
            </span>
          </div>
        )
      },
      {
        accessorKey: 'wallet_id',
        header: 'Wallet',
        cell: ({ row }) => (
          <span className="font-mono text-sm text-bxo-text-secondary">
            {shortWallet(row.original.wallet_id)}
          </span>
        )
      },
      {
        accessorKey: 'balanceNum',
        header: 'Balance (units)',
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold text-bxo-text-primary">
            {formatTokens(row.original.balanceNum)}
          </span>
        )
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.balanceNum > 0 ? (
            <StatusBadge variant="success" label="Held" />
          ) : (
            <StatusBadge variant="neutral" label="Empty" />
          )
      }
    ],
    []
  )

  return (
    <DashboardLayout
      navItems={INVESTOR_NAV}
      userRole="Investor"
      currentPath="/investor/portfolio"
      userName={user?.email}
      onLogout={() => {
        router.push('/login')
      }}
      breadcrumbs={[
        { label: 'Investor', href: '/investor/portfolio' },
        { label: 'Portfolio' }
      ]}
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold text-bxo-text-primary">
            Portfolio
          </h1>
          <p className="text-sm text-bxo-text-secondary">
            Your tokenized holdings across BlockXOne offerings.
          </p>
        </div>

        {walletAllowed ? (
          <div className="flex flex-col gap-3 rounded-xl border border-bxo-border bg-bxo-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-bxo-text-tertiary">
                Onchain readiness
              </div>
              <div className="text-sm font-medium text-bxo-text-primary">
                Link your wallet to enable secondary trading and redemptions.
              </div>
            </div>
            <WalletWidget />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total Units Held"
            value={totalUnits}
            icon={<Coins className="h-5 w-5" />}
            isLoading={isFetching}
            formatValue={(v) => formatTokens(Number(v))}
          />
          <StatCard
            label="Active Positions"
            value={fundedPositions}
            icon={<Layers className="h-5 w-5" />}
            isLoading={isFetching}
          />
          <StatCard
            label="Distinct Offerings"
            value={rows.length}
            icon={<Briefcase className="h-5 w-5" />}
            isLoading={isFetching}
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-bxo-danger/30 bg-bxo-danger/10 p-4 text-sm text-bxo-danger">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-bxo-border bg-bxo-surface">
          <div className="border-b border-bxo-border px-5 py-4">
            <h2 className="text-sm font-semibold text-bxo-text-primary">Holdings</h2>
          </div>
          <div className="p-2">
            <DataTable<HoldingRow>
              columns={columns}
              data={rows}
              isLoading={isFetching}
              isEmpty={!isFetching && rows.length === 0}
              emptyStateMessage="No holdings yet. Subscribe to an offering to start building your portfolio."
              onRowClick={(row) => router.push(`/investor/funds/${row.offering_id}`)}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
