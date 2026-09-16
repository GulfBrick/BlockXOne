'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { blockXOneApi } from '@/lib/api-client'
import { isManagedTestnetRuntime } from '@/lib/runtime-scope'

interface TokenStats {
  whitelist_queue: number | null
  approval_queue: number | null
}

type WhitelistRequestSummary = {
  status: string
}

const OPERATION_SECTIONS = [
  {
    href: '/tokenisation-agent/deploy',
    title: 'Token Deployment',
    description: 'Deploy approved typed offerings at zero initial supply using the configured identity and compliance contracts.',
    action: 'Open Deployment Queue',
    disabled: false
  },
  {
    href: '/tokenisation-agent/mint',
    title: 'Controlled Issuance',
    description: 'Issue an exact reconciled obligation by subscription ID and retain transaction, position, and register evidence.',
    action: 'Open Controlled Issuance',
    disabled: false
  },
  {
    href: '/tokenisation-agent/burn',
    title: 'Burn Tokens',
    description: 'Unavailable until redemption approval and supply-control evidence are configured.',
    action: 'Not enabled',
    disabled: true
  },
  {
    href: '/tokenisation-agent/whitelist',
    title: 'Whitelist Management',
    description: 'Verify wallet eligibility against the configured runtime and retain the exact returned evidence.',
    action: 'Manage Whitelist',
    disabled: false
  },
  {
    href: '/tokenisation-agent/freeze',
    title: 'Freeze Controls',
    description: 'Unavailable until the emergency-control approval and recovery runbook is configured.',
    action: 'Not enabled',
    disabled: true
  },
  {
    href: '/tokenisation-agent/force-transfer',
    title: 'Force Transfer',
    description: 'Unavailable until dual approval and recovery evidence are configured.',
    action: 'Not enabled',
    disabled: true
  },
  {
    href: '#',
    title: 'Transaction Log',
    description: 'The consolidated chain-operations log is not available on this surface.',
    action: 'View Logs',
    disabled: true
  }
]

export default function TokenisationAgentPage() {
  const { user } = useAuth()
  const managedTestnet = isManagedTestnetRuntime()
  const canExecuteWhitelist = user?.permissions?.['tokenops:whitelist'] === true
  const [stats, setStats] = useState<TokenStats>({
    whitelist_queue: null,
    approval_queue: null,
  })
  const [loading, setLoading] = useState(true)
  const [statsError, setStatsError] = useState('')

  const fetchStats = useCallback(async () => {
    setStatsError('')
    try {
      if (!user?.token) {
        setStatsError('Sign in again to load the authoritative token-operations status.')
        return
      }
      
      const [whitelistResult, approvalResult] = await Promise.allSettled([
        canExecuteWhitelist
          ? blockXOneApi.token.whitelistQueue(user.token)
          : Promise.resolve([]),
        managedTestnet
          ? blockXOneApi.chainOperation.approvalQueue(user.token)
          : Promise.resolve([]),
      ])

      const failures: string[] = []
      if (whitelistResult.status === 'rejected') {
        failures.push(
          whitelistResult.reason instanceof Error
            ? whitelistResult.reason.message
            : 'Whitelist execution work is unavailable.'
        )
      }
      if (approvalResult.status === 'rejected') {
        failures.push(
          approvalResult.reason instanceof Error
            ? approvalResult.reason.message
            : 'Managed checker work is unavailable.'
        )
      }

      // The execution endpoint accepts REQUESTED and FAILED.
      const whitelistQueue = whitelistResult.status === 'fulfilled'
        ? (whitelistResult.value as WhitelistRequestSummary[]).filter((item) =>
            item.status === 'REQUESTED' || item.status === 'FAILED'
          ).length
        : null

      setStats({
        whitelist_queue: canExecuteWhitelist ? whitelistQueue : null,
        approval_queue:
          managedTestnet && approvalResult.status === 'fulfilled'
            ? approvalResult.value.length
            : null,
      })
      if (failures.length > 0) setStatsError(failures.join(' '))
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Token operations status is unavailable.')
    } finally {
      setLoading(false)
    }
  }, [canExecuteWhitelist, managedTestnet, user])

  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  const TOKEN_OPERATIONS = [
    { label: 'Controlled Issuance', value: 'Lookup', hint: managedTestnet ? 'Governed chain operation' : 'By reconciled subscription ID' },
    managedTestnet
      ? {
          label: 'Checker Queue',
          value: loading ? '...' : stats.approval_queue === null ? 'Not available' : String(stats.approval_queue),
          hint: 'Policy-authorized managed approvals',
        }
      : { label: 'Burn Requests', value: 'Not available', hint: 'Not enabled' },
    {
      label: 'Whitelist Queue',
      value: loading
        ? '...'
        : canExecuteWhitelist
          ? stats.whitelist_queue === null ? 'Not available' : String(stats.whitelist_queue)
          : 'Maker-only',
      hint: canExecuteWhitelist ? 'Requested or retryable' : 'Execution permission required',
    },
    { label: 'Finality Standard', value: 'FINAL', hint: 'Receipt and register evidence' }
  ]
  const operationSections = OPERATION_SECTIONS.map((section) => {
    if (!managedTestnet) return section
    if (section.href === '/tokenisation-agent/deploy') {
      return {
        ...section,
        title: 'Governed Testnet Deployment',
        description: 'Create and approve a zero-supply deployment operation on the admitted public testnet, then follow it through receipt, finality, indexed event, and bytecode verification.',
      }
    }
    if (section.href === '/tokenisation-agent/mint') {
      return {
        ...section,
        title: 'Managed Testnet Issuance',
        description: 'Mint the exact reconciled test-payment obligation through the durable coordinator and prove supply, holding, position, and legal register from the finalized event.',
      }
    }
    return section
  })

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
            <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
            Tokenisation Agent
          </div>
          <h1 className="font-display text-4xl font-bold">Token Operations</h1>
          <p className="max-w-3xl text-bxo-text-secondary">
            {managedTestnet
              ? 'Run identity admission, whitelist execution, zero-supply deployment, and exact RECONCILED-subscription issuance through the governed public-testnet coordinator.'
              : 'Execute the whitelist workflow and exact RECONCILED-subscription issuance on the private validation network. Local consideration uses independent synthetic evidence with no payment provider or real funds.'}
          </p>
          {user && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-sm text-bxo-text-tertiary">
              <span className="min-w-0 max-w-full break-all font-mono">{user.email}</span>
              <span className="max-w-full whitespace-normal break-words rounded bg-bxo-accent-soft px-2 py-1 text-xs font-semibold text-bxo-accent-primary">
                {user.roles?.join(', ')}
              </span>
            </div>
          )}
        </div>

        {statsError ? (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-4">
            <p className="text-sm text-bxo-danger-light" role="alert">{statsError}</p>
          </Card>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-4">
          {TOKEN_OPERATIONS.map((stat) => (
            <Card key={stat.label} className="bxo-card p-5">
              <div className="text-sm text-bxo-text-tertiary">{stat.label}</div>
              <div className="mt-2 font-display text-3xl font-bold text-bxo-text-primary">{stat.value}</div>
              <div className="mt-1 text-xs text-bxo-text-secondary">{stat.hint}</div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {operationSections.map((section) => (
            <Card key={section.title} className="bxo-card space-y-2 p-5">
              <div className="font-display text-lg font-semibold text-bxo-text-primary">{section.title}</div>
              <div className="text-sm leading-6 text-bxo-text-secondary">{section.description}</div>
              <Button 
                variant="secondary" 
                asChild={!section.disabled} 
                disabled={section.disabled}
                className="mt-2"
              >
                {section.disabled ? (
                  <span>{section.action}</span>
                ) : (
                  <Link href={section.href}>{section.action}</Link>
                )}
              </Button>
            </Card>
          ))}
        </div>

        <Card className="bxo-panel p-6">
          <h3 className="mb-3 font-display text-lg font-semibold text-bxo-text-primary">{managedTestnet ? 'Public testnet controls' : 'Available token controls'}</h3>
          <p className="mb-4 text-sm leading-6 text-bxo-text-secondary">
            {managedTestnet
              ? 'Public-testnet operations use managed signing, durable approval evidence, receipt-first recovery, independent finality checks, and indexed projections. Burn, freeze, force-transfer, production custody, and real-value settlement remain unavailable until their approval and recovery controls are independently verified.'
              : 'This private validation network supports whitelist execution and exact reconciled-subscription issuance using independent synthetic consideration evidence. No payment provider or real funds are involved. Burn, freeze, force-transfer, and real-value settlement remain unavailable until their approval, recovery, and audit controls are configured.'}
          </p>
          <p className="text-sm leading-6 text-bxo-text-secondary">
            Polygon Amoy (80002), Base Sepolia (84532), and Ethereum Sepolia (11155111) are the only
            approved public testnet rails. A rail is executable only while its exact active manifest is
            admitted. A provider reference is not presented as a completed transaction unless the
            durable chain operation reaches FINAL with receipt and rail-specific finality evidence.
          </p>
        </Card>
      </div>
    </div>
  )
}
