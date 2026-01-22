'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type CaseItem = {
  id: string
  user_id: string
  type: string
  status: string
  submitted_at: string | null
  created_at: string
}

export default function ComplianceQueue() {
  const [filter, setFilter] = useState<'all' | 'kyc' | 'wallet'>('all')
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchQueue()
  }, [])

  const fetchQueue = async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('blockxone_token')
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch('http://localhost:8080/v1/compliance/queue', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch compliance queue')
      }

      const data = await response.json()
      setCases(data || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (caseId: string) => {
    setProcessing(true)
    setMessage('')
    setError('')

    try {
      const token = localStorage.getItem('blockxone_token')
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`http://localhost:8080/v1/compliance/cases/${caseId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Approval failed')
      }

      setMessage(`Case approved successfully`)
      setTimeout(() => {
        setMessage('')
        fetchQueue()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Approval failed')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (caseId: string) => {
    setProcessing(true)
    setMessage('')
    setError('')

    try {
      const token = localStorage.getItem('blockxone_token')
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`http://localhost:8080/v1/compliance/cases/${caseId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Rejection failed')
      }

      setMessage(`Case rejected`)
      setTimeout(() => {
        setMessage('')
        fetchQueue()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Rejection failed')
    } finally {
      setProcessing(false)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'kyc') return cases.filter((c) => c.type === 'KYC')
    if (filter === 'wallet') return cases.filter((c) => c.type === 'Wallet')
    return cases
  }, [filter, cases])

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
        <div className="flex flex-col gap-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Compliance queue
          </div>
          <h1 className="text-3xl font-bold">KYC and wallet approvals</h1>
          <p className="text-muted-foreground">Triage submissions, check risk, and approve or reject.</p>
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

        <Card className="p-4 bg-white/5 border-white/10 flex flex-wrap gap-3 items-center">
          <div className="text-sm text-muted-foreground">Filter</div>
          <div className="flex gap-2">
            <Button variant={filter === 'all' ? 'default' : 'secondary'} onClick={() => setFilter('all')} size="sm">
              All ({cases.length})
            </Button>
            <Button variant={filter === 'kyc' ? 'default' : 'secondary'} onClick={() => setFilter('kyc')} size="sm">
              KYC ({cases.filter(c => c.type === 'KYC').length})
            </Button>
            <Button variant={filter === 'wallet' ? 'default' : 'secondary'} onClick={() => setFilter('wallet')} size="sm">
              Wallet ({cases.filter(c => c.type === 'Wallet').length})
            </Button>
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={fetchQueue} disabled={loading || processing}>
              Refresh
            </Button>
          </div>
        </Card>

        {loading ? (
          <Card className="p-12 bg-white/5 border-white/10 text-center">
            <p className="text-muted-foreground">Loading queue...</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 bg-white/5 border-white/10 text-center">
            <p className="text-muted-foreground mb-2">No pending cases</p>
            <p className="text-sm text-muted-foreground">New submissions will appear here for review</p>
          </Card>
        ) : (
          <Card className="overflow-hidden bg-white/5 border-white/10">
            <div className="grid grid-cols-7 gap-3 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
              <div>Case ID</div>
              <div>User ID</div>
              <div>Type</div>
              <div>Status</div>
              <div>Submitted</div>
              <div>Created</div>
              <div>Actions</div>
            </div>
            <div className="divide-y divide-white/5">
              {filtered.map((item) => (
                <div key={item.id} className="grid grid-cols-7 gap-3 px-4 py-3 text-sm items-center">
                  <div className="font-mono text-xs">{item.id.slice(0, 8)}...</div>
                  <div className="font-mono text-xs">{item.user_id.slice(0, 8)}...</div>
                  <div>
                    <span className="px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 text-xs font-semibold">
                      {item.type}
                    </span>
                  </div>
                  <div>
                    <span className="px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-semibold">
                      {item.status}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : 'N/A'}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {new Date(item.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleApprove(item.id)}
                      disabled={processing}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(item.id)}
                      disabled={processing}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}