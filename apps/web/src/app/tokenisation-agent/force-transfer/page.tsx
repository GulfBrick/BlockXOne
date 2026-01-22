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

export default function ForceTransferPage() {
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [selectedOffering, setSelectedOffering] = useState('')
  const [fromWallet, setFromWallet] = useState('')
  const [toWallet, setToWallet] = useState('')
  const [amount, setAmount] = useState('')
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

  const handleForceTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedOffering || !fromWallet || !toWallet || !amount) {
      setError('Please fill all required fields')
      return
    }

    if (fromWallet === toWallet) {
      setError('From and To wallet addresses must be different')
      return
    }

    setProcessing(true)
    setError(null)
    setMessage(null)

    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/token-batches/force-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          offering_id: selectedOffering,
          from_wallet: fromWallet,
          to_wallet: toWallet,
          amount: amount
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to execute force transfer')
      }

      const data = await response.json()
      setMessage(`Force transfer successful! TX: ${data.tx_hash?.substring(0, 10)}...`)
      
      // Reset form
      setTimeout(() => {
        setFromWallet('')
        setToWallet('')
        setAmount('')
        setMessage(null)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute force transfer')
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
              Force Transfer
            </div>
            <h1 className="text-4xl font-bold">Force Transfer</h1>
            <p className="text-muted-foreground">
              Execute admin-level token movements for recovery or compliance.
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
          <h2 className="text-xl font-semibold mb-6">Execute Force Transfer</h2>
          
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading offerings...</div>
          ) : (
            <form onSubmit={handleForceTransfer} className="space-y-6">
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
                <label htmlFor="fromWallet" className="text-sm font-medium">
                  From Wallet Address
                </label>
                <input
                  id="fromWallet"
                  type="text"
                  value={fromWallet}
                  onChange={(e) => setFromWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Source wallet address (tokens will be deducted)
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="toWallet" className="text-sm font-medium">
                  To Wallet Address
                </label>
                <input
                  id="toWallet"
                  type="text"
                  value={toWallet}
                  onChange={(e) => setToWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Destination wallet address (tokens will be added)
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="amount" className="text-sm font-medium">
                  Amount (Tokens)
                </label>
                <input
                  id="amount"
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-md text-white font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Number of tokens to transfer
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                variant="destructive"
                disabled={processing}
              >
                {processing ? 'Processing...' : 'Execute Force Transfer'}
              </Button>
            </form>
          )}
        </Card>

        <Card className="p-6 bg-red-900/20 border-red-500/30">
          <h3 className="text-lg font-semibold mb-3 text-red-400">Critical Warning</h3>
          <ul className="text-sm text-red-200/80 space-y-2 list-disc list-inside">
            <li>Force transfer bypasses normal transfer restrictions and user consent</li>
            <li>Use ONLY for compliance enforcement, legal court orders, or emergency recovery</li>
            <li>Requires SuperAdmin or TokenisationAgent role with force_transfer permission</li>
            <li>All force transfers are permanently logged and auditable</li>
            <li>Misuse may result in legal liability and regulatory penalties</li>
            <li>Always document justification and obtain proper authorization</li>
          </ul>
        </Card>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Valid Use Cases</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li><strong>Lost Key Recovery:</strong> Transfer tokens from inaccessible wallet to new wallet for verified owner</li>
            <li><strong>Court Orders:</strong> Execute transfers mandated by legal judgments or regulatory directives</li>
            <li><strong>Estate Settlement:</strong> Transfer deceased investor tokens to beneficiaries</li>
            <li><strong>Compliance Seizure:</strong> Move tokens from sanctioned or blocked wallets</li>
            <li><strong>Smart Contract Bug:</strong> Recover tokens from malfunctioning contracts</li>
          </ul>
        </Card>

        <Card className="p-6 bg-white/5 border-white/10">
          <h3 className="text-lg font-semibold mb-3">Technical Details</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>Operation calls smart contract forceTransfer function</li>
            <li>Both wallets must be whitelisted for the offering</li>
            <li>Transfer cannot be reverted after execution</li>
            <li>Holdings ledger is updated automatically</li>
            <li>Transaction hash and details recorded in transfers table</li>
            <li>Audit log captures full context including actor and timestamp</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
