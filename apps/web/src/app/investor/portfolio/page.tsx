'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Briefcase, FileCheck2, Layers3 } from 'lucide-react'

import { StatCard } from '@/components/ui/stat-card'
import { DataTable } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status-badge'
import { WalletWidget } from '@/components/wallet/WalletWidget'
import { useAuth } from '@/lib/auth-context-v2'
import { portfolioApi } from '@/lib/api-client'
import {
  baseUnitsToExactDecimal,
  compareExactDecimals,
  formatExactUnits,
} from '@/lib/exact-decimal'
import type { ControlledPosition } from '@/lib/pilot-finance'
import { presentPilotRecordName } from '@/lib/pilot-record-presentation'

type PositionRow = ControlledPosition & { balance: string }

function short(value: string, start = 8, end = 6) {
  if (!value) return 'Not available'
  return value.length <= start + end + 1
    ? value
    : `${value.slice(0, start)}…${value.slice(-end)}`
}

export default function PortfolioPage() {
  const { user, loading } = useAuth()
  const [rows, setRows] = useState<PositionRow[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) {
      setRows([])
      setPortfolioLoaded(false)
      setIsFetching(false)
      return
    }
    let cancelled = false
    setIsFetching(true)
    setRows([])
    setPortfolioLoaded(false)
    setError(null)
    void portfolioApi
      .controlledPositions(user.token)
      .then((response) => {
        if (cancelled) return
        setRows(
          response.positions.map((position) => ({
            ...position,
            balance:
              baseUnitsToExactDecimal(
                position.balance_base_units,
                position.token_decimals
              ) || '',
          }))
        )
        setPortfolioLoaded(true)
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Failed to load controlled positions.')
          setRows([])
          setPortfolioLoaded(false)
        }
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false)
      })
    return () => {
      cancelled = true
    }
  }, [loading, user])

  const distinctAssetClasses = useMemo(
    () => new Set(rows.map((row) => row.asset_class)).size,
    [rows]
  )
  const distinctOfferings = useMemo(
    () => new Set(rows.map((row) => row.offering_id)).size,
    [rows]
  )
  const hasManagedTestnetPositions = useMemo(
    () => rows.some((row) => row.runtime_scope === 'TESTNET'),
    [rows]
  )
  const hasLocalPositions = useMemo(
    () => rows.some((row) => row.runtime_scope === 'LOCAL_PILOT'),
    [rows]
  )
  const portfolioDisclosure = !portfolioLoaded
    ? 'Authoritative position evidence is unavailable. Refresh before relying on portfolio totals.'
    : rows.length === 0
      ? 'No finalized position evidence is recorded yet.'
    : hasManagedTestnetPositions
      ? `Public testnet positions use authenticated Stripe TEST provider evidence and public testnet transactions. No real funds are accepted or settled.${hasLocalPositions ? ' Private validation positions use independent synthetic evidence and are labelled per row.' : ''}`
      : 'Private validation positions use independent synthetic evidence with no payment provider and private EVM receipts. No real funds are accepted or settled, and no public testnet broadcast occurs.'

  const columns = useMemo<ColumnDef<PositionRow>[]>(() => [
    {
      accessorKey: 'instrument_name',
      header: 'Controlled position',
      cell: ({ row }) => {
        const presentation = presentPilotRecordName(row.original.instrument_name)
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium text-bxo-text-primary">{presentation.displayName}</span>
            <span className="text-xs text-bxo-text-tertiary">{row.original.asset_class.replaceAll('_', ' ')}</span>
            <span className="break-all font-mono text-xs text-bxo-text-tertiary">
              Position record: {row.original.id}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'balance',
      header: 'Exact balance',
      sortingFn: (left, right) => compareExactDecimals(left.original.balance, right.original.balance),
      cell: ({ row }) => <span className="font-mono text-sm font-semibold">{formatExactUnits(row.original.balance)}</span>,
    },
    {
      accessorKey: 'wallet_address',
      header: 'Wallet / network',
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-xs">{short(row.original.wallet_address)}</div>
          <div className="mt-1 text-xs text-bxo-text-tertiary">
            {row.original.runtime_scope === 'TESTNET' ? 'Public testnet' : 'Private validation network'} · chain {row.original.chain_id}
          </div>
        </div>
      ),
    },
    {
      id: 'chain_evidence',
      header: 'Finality evidence',
      cell: ({ row }) => (
        <div>
          <StatusBadge variant="success" label={row.original.status} />
          <div className="mt-2 font-mono text-xs text-bxo-text-tertiary">tx {short(row.original.transaction_hash)}</div>
          <div className="mt-1 font-mono text-xs text-bxo-text-tertiary">block {row.original.block_number}</div>
          <div className="mt-1 text-xs text-bxo-text-tertiary">
            {row.original.confirmations} confirmation{row.original.confirmations === 1 ? '' : 's'} · {row.original.chain_evidence_class.replaceAll('_', ' ')}
          </div>
        </div>
      ),
    },
    {
      id: 'register',
      header: 'Legal register',
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-xs">Sequence {row.original.register_sequence}</div>
          <div className="mt-1 font-mono text-xs text-bxo-text-tertiary">{short(row.original.register_entry_sha256, 10, 8)}</div>
        </div>
      ),
    },
  ], [])

  return (
    <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Portfolio</h1>
          <p className="mt-1 text-sm text-bxo-text-secondary">
            Final positions backed by receipt, finality, balance and controlled legal-register evidence.
          </p>
        </div>

        <div className="rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm leading-6 text-bxo-text-secondary">
          {portfolioDisclosure}
        </div>

        {user?.roles?.includes('Investor') ? (
          <div className="flex flex-col gap-3 rounded-xl border border-bxo-border bg-bxo-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-bxo-text-tertiary">Wallet eligibility</div>
              <div className="text-sm font-medium">Link only the beneficiary wallet used by the controlled issuance record.</div>
            </div>
            <WalletWidget />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Asset Classes" value={portfolioLoaded ? distinctAssetClasses : 'Unavailable'} icon={<Layers3 className="h-5 w-5" />} isLoading={isFetching} />
          <StatCard label="Final Positions" value={portfolioLoaded ? rows.length : 'Unavailable'} icon={<FileCheck2 className="h-5 w-5" />} isLoading={isFetching} />
          <StatCard label="Distinct Offerings" value={portfolioLoaded ? distinctOfferings : 'Unavailable'} icon={<Briefcase className="h-5 w-5" />} isLoading={isFetching} />
        </div>

        {error ? <div role="alert" className="rounded-xl border border-bxo-danger/30 bg-bxo-danger/10 p-4 text-sm text-bxo-danger">{error}</div> : null}

        <div className="rounded-xl border border-bxo-border bg-bxo-surface">
          <div className="border-b border-bxo-border px-5 py-4">
            <h2 className="text-sm font-semibold">Final positions and evidence</h2>
          </div>
          <div className="p-2">
            {!isFetching && !portfolioLoaded ? (
              <div className="p-8 text-center text-sm text-bxo-warning-light">
                Final position evidence is unavailable. Refresh before relying on balances, supply, or legal-register records.
              </div>
            ) : (
              <DataTable<PositionRow>
                columns={columns}
                data={rows}
                isLoading={isFetching}
                isEmpty={!isFetching && portfolioLoaded && rows.length === 0}
                emptyStateMessage="No finalized positions yet. A subscription must be reconciled, wallet-approved, whitelisted, and issued through the configured chain flow."
              />
            )}
          </div>
        </div>
    </div>
  )
}
