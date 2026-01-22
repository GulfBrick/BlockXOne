'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface TokenStats {
  mint_requests: number
  burn_requests: number
  whitelist_queue: number
  active_tokens: number
}

const OPERATION_SECTIONS = [
  {
    href: '/tokenisation-agent/mint',
    title: 'Mint Tokens',
    description: 'Create new security tokens for approved subscriptions and allocations.',
    action: 'View Mint Queue',
    disabled: false
  },
  {
    href: '/tokenisation-agent/burn',
    title: 'Burn Tokens',
    description: 'Process token redemptions and remove tokens from circulation.',
    action: 'View Burn Queue',
    disabled: false
  },
  {
    href: '/tokenisation-agent/whitelist',
    title: 'Whitelist Management',
    description: 'Approve wallet addresses for token transfers and holdings.',
    action: 'Manage Whitelist',
    disabled: false
  },
  {
    href: '/tokenisation-agent/freeze',
    title: 'Freeze Controls',
    description: 'Temporarily restrict token transfers for compliance or security.',
    action: 'Freeze Manager',
    disabled: false
  },
  {
    href: '/tokenisation-agent/force-transfer',
    title: 'Force Transfer',
    description: 'Execute admin-level token movements for recovery or compliance.',
    action: 'Force Transfer',
    disabled: false
  },
  {
    href: '#',
    title: 'Transaction Log',
    description: 'Monitor all blockchain events and token operations in real-time.',
    action: 'View Logs',
    disabled: true
  }
]

export default function TokenisationAgentPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<TokenStats>({
    mint_requests: 0,
    burn_requests: 0,
    whitelist_queue: 0,
    active_tokens: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token')
      
      // Fetch multiple endpoints in parallel
      const [subsResp, redemptionsResp, whitelistResp, batchesResp] = await Promise.all([
        fetch('/api/v1/debug/subscriptions', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/v1/redemptions?status=APPROVED', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/v1/debug/whitelist-requests', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/v1/token-batches', { headers: { 'Authorization': `Bearer ${token}` } })
      ])

      const [subs, redemptions, whitelist, batches] = await Promise.all([
        subsResp.json(),
        redemptionsResp.json(),
        whitelistResp.json(),
        batchesResp.json()
      ])

      // Count pending mint requests (PAID subscriptions)
      const mintRequests = (subs || []).filter((s: any) => 
        s.status === 'PAID' || s.status === 'APPROVED'
      ).length

      // Count burn requests (APPROVED redemptions)
      const burnRequests = (redemptions || []).length

      // Count whitelist queue (PENDING/APPROVED requests)
      const whitelistQueue = (whitelist || []).filter((w: any) => 
        w.status === 'PENDING' || w.status === 'APPROVED'
      ).length

      // Count active token batches (unique offerings with confirmed batches)
      const uniqueOfferings = new Set(
        (batches || [])
          .filter((b: any) => b.status === 'CONFIRMED')
          .map((b: any) => b.offering_id)
      )

      setStats({
        mint_requests: mintRequests,
        burn_requests: burnRequests,
        whitelist_queue: whitelistQueue,
        active_tokens: uniqueOfferings.size
      })
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  const TOKEN_OPERATIONS = [
    { label: 'Mint Requests', value: loading ? '...' : String(stats.mint_requests), hint: 'Pending approval' },
    { label: 'Burn Requests', value: loading ? '...' : String(stats.burn_requests), hint: 'Awaiting execution' },
    { label: 'Whitelist Queue', value: loading ? '...' : String(stats.whitelist_queue), hint: 'Addresses to approve' },
    { label: 'Active Tokens', value: loading ? '...' : String(stats.active_tokens), hint: 'Deployed on testnet' }
  ]

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Tokenisation Agent
          </div>
          <h1 className="text-4xl font-bold">Token Operations</h1>
          <p className="text-muted-foreground max-w-3xl">
            Manage token minting, burning, whitelisting, and blockchain operations for security tokens.
          </p>
          {user && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
              <span className="font-mono">{user.email}</span>
              <span className="px-2 py-1 rounded bg-primary/20 text-primary text-xs font-semibold">
                {user.roles?.join(', ')}
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          {TOKEN_OPERATIONS.map((stat) => (
            <Card key={stat.label} className="p-5 bg-white/5 border-white/10">
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              <div className="text-3xl font-bold mt-2">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.hint}</div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {OPERATION_SECTIONS.map((section) => (
            <Card key={section.title} className="p-5 bg-white/5 border-white/10 space-y-2">
              <div className="text-lg font-semibold">{section.title}</div>
              <div className="text-sm text-muted-foreground">{section.description}</div>
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

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Token Operations Status</h3>
          <p className="text-sm text-muted-foreground mb-4">
            All core tokenisation agent features are now functional. You can mint tokens, burn tokens, 
            manage whitelists, freeze wallets, and execute force transfers. All operations are connected 
            to the blockchain API and audit logging system.
          </p>
          <div className="flex gap-4">
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/investor/market">Preview Investor View</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
