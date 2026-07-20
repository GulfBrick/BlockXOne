'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { API_BASE, getStoredToken } from '@/lib/api-client'

type Subscription = {
  id: string
  offering_id: string
  user_id: string
  units: string
  amount: string
  status: string
  created_at: string
}

export default function MintTokensPage() {
  const { user } = useAuth()
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [minting, setMinting] = useState(false)
  const [selectedSubId, setSelectedSubId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetchSubscriptions()
  }, [])

  const fetchSubscriptions = async () => {
    setLoading(true)
    try {
      const token = getStoredToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`${API_BASE}/v1/debug/subscriptions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch subscriptions')
      }

      const data = await response.json()
      // Filter for PAID or APPROVED status
      const eligible = data.filter((sub: Subscription) =>
        sub.status === 'PAID' || sub.status === 'APPROVED'
      )
      setSubscriptions(eligible)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  const handleMint = async () => {
    if (!selectedSubId) {
      setError('Please select a subscription')
      return
    }

    setMinting(true)
    setMessage('')
    setError('')

    try {
      const token = getStoredToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`${API_BASE}/v1/token-batches/mint`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          subscription_id: selectedSubId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Mint failed')
      }

      const data = await response.json()
      setMessage(`Tokens minted successfully! Batch ID: ${data.batch_id}, TX: ${data.tx_hash}`)
      setSelectedSubId('')
      
      // Refresh subscriptions list
      setTimeout(() => fetchSubscriptions(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint operation failed')
    } finally {
      setMinting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tokenisation-agent">← Back to Token Operations</Link>
          </Button>
          <h1 className="text-4xl font-bold">Mint Tokens</h1>
          <p className="text-muted-foreground">
            Issue tokens to investors after payment confirmation and wallet approval.
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

        {error && (
          <Card className="p-4 bg-red-900/20 border-red-500/30">
            <p className="text-sm text-red-400">{error}</p>
          </Card>
        )}

        {message && (
          <Card className="p-4 bg-green-900/20 border-green-500/30">
            <p className="text-sm text-green-400">{message}</p>
          </Card>
        )}

        <Card className="p-6 bg-white/5 border-white/10 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Eligible Subscriptions</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Select a paid subscription to mint tokens for the investor
            </p>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading subscriptions...
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No eligible subscriptions found. Subscriptions must be PAID or APPROVED status.
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubId(sub.id)}
                  className={`
                    w-full text-left p-4 rounded-lg border transition-all
                    ${selectedSubId === sub.id
                      ? 'bg-primary/10 border-primary/30'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                    }
                  `}
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="font-mono text-sm text-muted-foreground">
                        {sub.id.slice(0, 8)}...
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Units:</span> {sub.units}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Amount:</span> ${sub.amount}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">User:</span> {sub.user_id.slice(0, 8)}...
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded bg-green-500/20 text-green-400 text-xs font-semibold">
                      {sub.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="flex gap-3">
          <Button
            onClick={handleMint}
            disabled={minting || !selectedSubId || loading}
            className="flex-1"
          >
            {minting ? 'Minting Tokens...' : 'Mint Tokens'}
          </Button>
          <Button
            variant="outline"
            onClick={fetchSubscriptions}
            disabled={loading || minting}
          >
            Refresh List
          </Button>
        </div>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Mint Process</h3>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
            <li>Subscription must be in PAID or APPROVED status</li>
            <li>Investor must have approved wallet on correct chain</li>
            <li>Wallet must be whitelisted for the offering</li>
            <li>System mints tokens on-chain to investor wallet</li>
            <li>Holdings balance updated automatically</li>
            <li>Subscription marked as MINTED</li>
          </ol>
        </Card>
      </div>
    </div>
  )
}
