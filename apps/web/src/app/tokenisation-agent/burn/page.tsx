'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface Redemption {
  id: string
  offering_id: string
  user_id: string
  email: string
  amount_tokens: string
  amount_cash: string
  status: string
  created_at: string
}

export default function BurnTokensPage() {
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchRedemptions()
  }, [])

  const fetchRedemptions = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/redemptions?status=APPROVED', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch redemptions')
      }

      const data = await response.json()
      setRedemptions(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load redemptions')
    } finally {
      setLoading(false)
    }
  }

  const handleBurn = async (redemption: Redemption) => {
    if (processing) return

    setProcessing(redemption.id)
    setError(null)
    setMessage(null)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/token-batches/burn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          redemption_id: redemption.id
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to burn tokens')
      }

      const data = await response.json()
      setMessage(`Burn successful! Batch ID: ${data.batch_id}, TX: ${data.tx_hash?.substring(0, 10)}...`)
      
      // Refresh the list
      setTimeout(() => {
        fetchRedemptions()
        setMessage(null)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to burn tokens')
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-7xl mx-auto px-4 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Burn Queue
            </div>
            <h1 className="text-4xl font-bold">Burn Tokens</h1>
            <p className="text-muted-foreground">
              Execute token burns for approved redemptions.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/tokenisation-agent">Back to Operations</Link>
          </Button>
        </div>

        {message && (
          <Card className="p-4 bg-green-900/20 border-green-500/30">
            <p className="text-sm text-green-400">{message}</p>
          </Card>
        )}

        {error && (
          <Card className="p-4 bg-red-900/20 border-red-500/30">
            <p className="text-sm text-red-400">{error}</p>
          </Card>
        )}

        <Card className="p-6 bg-white/5 border-white/10">
          <h2 className="text-xl font-semibold mb-4">Approved Redemptions</h2>
          
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading redemptions...</div>
          ) : redemptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No approved redemptions found. Investors must request redemptions first.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Investor</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Amount (Tokens)</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Cash Value</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Requested</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map((redemption) => (
                    <tr key={redemption.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4">
                        <div className="text-sm">{redemption.email}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {redemption.user_id.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{redemption.amount_tokens}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm">
                          {redemption.amount_cash ? `$${parseFloat(redemption.amount_cash).toLocaleString()}` : 'N/A'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm text-muted-foreground">
                          {new Date(redemption.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleBurn(redemption)}
                          disabled={processing !== null}
                        >
                          {processing === redemption.id ? 'Burning...' : 'Execute Burn'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Burn Process</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>Only APPROVED redemptions can be burned</li>
            <li>Burn operation calls smart contract to remove tokens from circulation</li>
            <li>Holdings balance is automatically reduced</li>
            <li>Payout record is created for investor cash distribution</li>
            <li>Transaction is recorded on-chain and in audit log</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
