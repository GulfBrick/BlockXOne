'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function StaffInvitationAccept({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function accept() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      const response = await fetch('/auth/staff-invite', { method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded', Accept:'application/json' },
        body:new URLSearchParams({ intent:'accept', invitationId }) })
      if (!response.headers.get('content-type')?.startsWith('application/json')) throw new Error()
      const body: unknown = await response.json()
      if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true || !response.ok) throw new Error()
      window.location.replace('/portal')
    } catch {
      setError('Acceptance could not be confirmed. Reload to see the current invitation state before trying again.')
      setPending(false)
    }
  }
  return <div className="mt-8 space-y-4">
    <Button type="button" disabled={pending} onClick={() => void accept()} className="min-h-11 w-full">{pending ? 'Confirming access...' : 'Accept assigned staff capacity'}</Button>
    {error ? <p role="alert" className="text-sm text-bxo-text-secondary">{error}</p> : null}
  </div>
}
