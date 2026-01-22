'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface Offering {
  id: string
  name: string
  symbol: string
}

export default function FreezeControlsPage() {
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [selectedOffering, setSelectedOffering] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [freezeAction, setFreezeAction] = useState<'freeze' | 'unfreeze'>('freeze')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchOfferings()
  }, [])

  const fetchOfferings = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/offerings', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch offerings')
      }

      const data = await response.json()
      setOfferings(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load offerings')
    } finally {
      setLoading(false)
    }
  }

  const handleFreeze = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedOffering || !walletAddress) {
      setError('Please select offering and enter wallet address')
      return
    }

    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/token-batches/freeze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          offering_id: selectedOffering,
          wallet_address: walletAddress,
          freeze: freezeAction === 'freeze'
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to execute freeze operation')
      }

      const data = await response.json()
      setMessage(`${freezeAction === 'freeze' ? 'Freeze' : 'Unfreeze'} successful! TX: ${data.tx_hash?.substring(0, 10)}...`)
      
      // Reset form
      setTimeout(() => {
        setWalletAddress('')
        setMessage(null)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute freeze operation')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Freeze Controls
            </div>
            <h1 className="text-4xl font-bold">Freeze Controls</h1>
            <p className="text-muted-foreground">
              Temporarily restrict token transfers for compliance or security.
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
          <h2 className="text-xl font-semibold mb-6">Execute Freeze Operation</h2>
          
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading offerings...</div>
          ) : (
            <form onSubmit={handleFreeze} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Action Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="freezeAction"
                      value="freeze"
                      checked={freezeAction === 'freeze'}
                      onChange={(e) => setFreezeAction(e.target.value as 'freeze')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Freeze (Restrict Transfers)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="freezeAction"
                      value="unfreeze"
                      checked={freezeAction === 'unfreeze'}
                      onChange={(e) => setFreezeAction(e.target.value as 'unfreeze')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Unfreeze (Restore Transfers)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="offering" className="text-sm font-medium">
                  Security Token
                </label>
                <select
                  id="offering"
                  value={selectedOffering}
                  onChange={(e) => setSelectedOffering(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white"
                  required
                >
                  <option value="">Select offering...</option>
                  {offerings.map((offering) => (
                    <option key={offering.id} value={offering.id}>
                      {offering.name} ({offering.symbol})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="wallet" className="text-sm font-medium">
                  Wallet Address
                </label>
                <input
                  id="wallet"
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Enter the wallet address to {freezeAction}
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                variant={freezeAction === 'freeze' ? 'destructive' : 'default'}
                disabled={processing}
              >
                {processing ? 'Processing...' : `Execute ${freezeAction === 'freeze' ? 'Freeze' : 'Unfreeze'}`}
              </Button>
            </form>
          )}
        </Card>

        <Card className="p-6 bg-yellow-900/20 border-yellow-500/30">
          <h3 className="text-lg font-semibold mb-3 text-yellow-400">Security Warning</h3>
          <ul className="text-sm text-yellow-200/80 space-y-2 list-disc list-inside">
            <li>Freezing prevents ALL token transfers from/to the specified wallet</li>
            <li>Use freeze for compliance violations, security incidents, or pending investigations</li>
            <li>Frozen wallets cannot send, receive, or trade tokens</li>
            <li>Always document reason for freeze in compliance system</li>
            <li>Unfreeze only after compliance clearance</li>
          </ul>
        </Card>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Freeze Process</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>Freeze operation calls smart contract to update wallet status</li>
            <li>Changes take effect immediately after transaction confirmation</li>
            <li>All freeze/unfreeze actions are logged in audit trail</li>
            <li>Smart contract enforces transfer restrictions automatically</li>
            <li>Multiple wallets can be frozen for same offering</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
