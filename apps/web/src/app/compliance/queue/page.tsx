'use client'

import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { API_BASE, getStoredToken } from '@/lib/api-client'

type CaseItem = {
  id: string
  user_id: string
  investor_email: string
  type: string
  status: string
  submitted_at: string | null
  created_at: string
}

export default function ComplianceQueue() {
  const [filter, setFilter] = useState<'all' | 'kyc'>('all')
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
      const token = getStoredToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`${API_BASE}/v1/compliance/queue`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch compliance queue')
      }

      const data = await response.json()
      setCases(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (caseId: string) => {
    setProcessing(true)
    setMessage('')
    setError('')

    try {
      const token = getStoredToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`${API_BASE}/v1/compliance/cases/${caseId}/approve`, {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async (caseId: string) => {
    setProcessing(true)
    setMessage('')
    setError('')

    try {
      const token = getStoredToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch(`${API_BASE}/v1/compliance/cases/${caseId}/reject`, {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed')
    } finally {
      setProcessing(false)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'kyc') return cases.filter((c) => c.type === 'KYC')
    return cases
  }, [filter, cases])

  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-6">
        <div className="flex flex-col gap-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
            <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
            Compliance queue
          </div>
          <h1 className="font-display text-3xl font-bold">Test identity review queue</h1>
          <p className="text-bxo-text-secondary">
            Review assigned test identity cases only. Do not submit or process sensitive identity documents.
          </p>
        </div>

        {error && (
          <Card className="border-bxo-danger-border bg-bxo-danger-soft p-4">
            <p className="text-sm text-bxo-danger-light">{error}</p>
          </Card>
        )}

        {message && (
          <Card className="border-bxo-success/30 bg-bxo-success/10 p-4">
            <p className="text-sm text-bxo-success-light">{message}</p>
          </Card>
        )}

        <Card className="bxo-card flex flex-wrap items-center gap-3 p-4">
          <div className="text-sm text-bxo-text-tertiary">Filter</div>
          <div className="flex gap-2">
            <Button variant={filter === 'all' ? 'default' : 'secondary'} onClick={() => setFilter('all')} size="sm">
              All ({cases.length})
            </Button>
            <Button variant={filter === 'kyc' ? 'default' : 'secondary'} onClick={() => setFilter('kyc')} size="sm">
              KYC ({cases.filter(c => c.type === 'KYC').length})
            </Button>
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" onClick={fetchQueue} disabled={loading || processing}>
              Refresh
            </Button>
          </div>
        </Card>

        {loading ? (
          <Card className="bxo-card p-12 text-center">
            <p className="text-bxo-text-secondary">Loading queue...</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="bxo-card p-12 text-center">
            <p className="mb-2 text-bxo-text-secondary">No pending cases</p>
            <p className="text-sm text-bxo-text-tertiary">New test identity submissions will appear here for review</p>
          </Card>
        ) : (
          <Card className="bxo-card overflow-x-auto">
            <div className="grid min-w-[900px] grid-cols-7 gap-3 px-4 py-3 text-xs uppercase tracking-wide text-bxo-text-tertiary">
              <div>Case ID</div>
              <div>Investor</div>
              <div>Type</div>
              <div>Status</div>
              <div>Submitted</div>
              <div>Created</div>
              <div>Actions</div>
            </div>
            <div className="min-w-[900px] divide-y divide-bxo-border-subtle">
              {filtered.map((item) => (
                <div key={item.id} className="grid grid-cols-7 gap-3 px-4 py-3 text-sm items-center">
                  <div className="font-mono text-xs">{item.id.slice(0, 8)}...</div>
                  <div className="min-w-0">
                    <div className="truncate text-xs text-bxo-text-primary">{item.investor_email}</div>
                    <div className="mt-1 font-mono text-[11px] text-bxo-text-tertiary">
                      {item.user_id.slice(0, 8)}...
                    </div>
                  </div>
                  <div>
                    <span className="rounded-full bg-bxo-accent-soft px-2 py-1 text-xs font-semibold text-bxo-accent-primary">
                      {item.type}
                    </span>
                  </div>
                  <div>
                    <span className="rounded-full bg-bxo-warning/10 px-2 py-1 text-xs font-semibold text-bxo-warning-light">
                      {item.status}
                    </span>
                  </div>
                  <div className="text-xs text-bxo-text-tertiary">
                    {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : 'N/A'}
                  </div>
                  <div className="text-xs text-bxo-text-tertiary">
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
