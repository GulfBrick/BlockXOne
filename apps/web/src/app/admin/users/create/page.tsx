'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ROLE_OPTIONS = [
  { value: 'Investor', label: 'Investor', description: 'Browse and invest in tokenized funds' },
  { value: 'TokenisationAgent', label: 'Tokenisation Agent', description: 'Mint, burn, and manage token operations' },
  { value: 'IssuerFundManager', label: 'Issuer Fund Manager', description: 'Create offerings and manage fund details' },
  { value: 'ComplianceOfficer', label: 'Compliance Officer', description: 'Review KYC and approve wallets' },
  { value: 'TransferAgent', label: 'Transfer Agent', description: 'Manage cap table and transfers' },
  { value: 'SuperAdmin', label: 'Super Admin', description: 'Full platform access' },
]

export default function CreateUserPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['Investor'])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email || !password) {
      setError('Email and password are required')
      return
    }

    if (selectedRoles.length === 0) {
      setError('At least one role must be selected')
      return
    }

    setCreating(true)

    try {
      const token = localStorage.getItem('blockxone_token')
      if (!token) {
        setError('Not authenticated')
        return
      }

      const response = await fetch('http://localhost:8080/v1/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          password,
          roles: selectedRoles,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create user')
      }

      const data = await response.json()
      console.log('User created:', data)

      // Redirect back to users list
      router.push('/admin/users')
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/users">← Back to Users</Link>
          </Button>
          <h1 className="text-4xl font-bold">Create New User</h1>
          <p className="text-muted-foreground">
            Add a new user to the platform with specific roles and permissions.
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

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="p-6 bg-white/5 border-white/10 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                disabled={creating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Temporary Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                disabled={creating}
              />
              <p className="text-xs text-muted-foreground">
                User can change this on first login
              </p>
            </div>
          </Card>

          <Card className="p-6 bg-white/5 border-white/10 space-y-4">
            <div>
              <Label>Roles</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Select one or more roles for this user
              </p>
            </div>

            <div className="grid gap-3">
              {ROLE_OPTIONS.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => toggleRole(role.value)}
                  disabled={creating}
                  className={`
                    text-left p-4 rounded-lg border transition-all
                    ${selectedRoles.includes(role.value)
                      ? 'bg-primary/10 border-primary/30'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className={`
                      w-5 h-5 rounded border mt-0.5 flex items-center justify-center
                      ${selectedRoles.includes(role.value)
                        ? 'bg-primary border-primary'
                        : 'border-white/20'
                      }
                    `}>
                      {selectedRoles.includes(role.value) && (
                        <svg className="w-3 h-3 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{role.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{role.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {error && (
            <Card className="p-4 bg-red-900/20 border-red-500/30">
              <p className="text-sm text-red-400">{error}</p>
            </Card>
          )}

          <div className="flex gap-3">
            <Button
              type="submit"
              className="flex-1"
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create User'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/users')}
              disabled={creating}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
