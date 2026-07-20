'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { API_BASE, getStoredToken } from '@/lib/api-client'

interface WhitelistRequest {
  id: string
  offering_id: string
  wallet_id: string
  address: string
  status: string
}

export default function WhitelistManagementPage() {
  const [requests, setRequests] = useState<WhitelistRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchRequests()
  }, [])

  const fetchRequests = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = getStoredToken()
      if (!token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${API_BASE}/v1/debug/whitelist-requests`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch whitelist requests')
      }

      const data = await response.json()
      setRequests(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load whitelist requests')
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async (request: WhitelistRequest) => {
    if (processing) return

    setProcessing(request.id)
    setError(null)
    setMessage(null)

    try {
      const token = getStoredToken()
      if (!token) {
        throw new Error('Not authenticated')
      }

      const response = await fetch(`${API_BASE}/v1/whitelist-requests/${request.id}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to execute whitelist')
      }

      const data = await response.json()
      setMessage(`Whitelist executed! TX: ${data.tx_hash?.substring(0, 10)}...`)
      
      // Refresh the list
      setTimeout(() => {
        fetchRequests()
        setMessage(null)
      }, 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute whitelist')
    } finally {
      setProcessing(null)
    }
  }

  const pendingRequests = requests.filter(r => r.status === 'PENDING' || r.status === 'APPROVED')
  const confirmedRequests = requests.filter(r => r.status === 'CONFIRMED')

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-7xl mx-auto px-4 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Whitelist Queue
            </div>
            <h1 className="text-4xl font-bold">Whitelist Management</h1>
            <p className="text-muted-foreground">
              Approve wallet addresses for token transfers and holdings.
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Pending Approval</div>
            <div className="text-3xl font-bold mt-2">{pendingRequests.length}</div>
          </Card>
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Confirmed On-Chain</div>
            <div className="text-3xl font-bold mt-2">{confirmedRequests.length}</div>
          </Card>
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Total Requests</div>
            <div className="text-3xl font-bold mt-2">{requests.length}</div>
          </Card>
        </div>

        <Card className="p-6 bg-white/5 border-white/10">
          <h2 className="text-xl font-semibold mb-4">Pending Whitelist Requests</h2>
          
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading requests...</div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No pending whitelist requests. Wallets are automatically requested during subscription.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Wallet Address</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Offering ID</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((request) => (
                    <tr key={request.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.address}</div>
                        <div className="text-xs text-muted-foreground">
                          Wallet ID: {request.wallet_id.substring(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.offering_id.substring(0, 8)}...</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          request.status === 'APPROVED' ? 'bg-green-900/20 text-green-400' : 'bg-yellow-900/20 text-yellow-400'
                        }`}>
                          {request.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          onClick={() => handleExecute(request)}
                          disabled={processing !== null}
                        >
                          {processing === request.id ? 'Executing...' : 'Execute On-Chain'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {confirmedRequests.length > 0 && (
          <Card className="p-6 bg-white/5 border-white/10">
            <h2 className="text-xl font-semibold mb-4">Confirmed Whitelists</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Wallet Address</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Offering ID</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedRequests.slice(0, 10).map((request) => (
                    <tr key={request.id} className="border-b border-white/5">
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.address}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-sm font-mono">{request.offering_id.substring(0, 8)}...</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/20 text-green-400">
                          {request.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Whitelist Process</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>Whitelist requests are created automatically when investors subscribe</li>
            <li>Execute on-chain to call smart contract whitelist function</li>
            <li>Only whitelisted addresses can receive and hold security tokens</li>
            <li>Whitelist status is verified before minting tokens</li>
            <li>All operations are logged in audit trail</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
