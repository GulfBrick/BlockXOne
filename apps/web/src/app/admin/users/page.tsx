'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const USER_ROLES = [
  { name: 'Investor', users: 1, description: 'Browse and invest in tokenized funds', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  { name: 'TokenisationAgent', users: 1, description: 'Mint, burn, and manage token operations', color: 'bg-green-500/10 text-green-500 border-green-500/20' },
  { name: 'IssuerFundManager', users: 1, description: 'Create offerings and manage fund details', color: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  { name: 'ComplianceOfficer', users: 1, description: 'Review KYC and approve wallets', color: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  { name: 'TransferAgent', users: 1, description: 'Manage cap table and transfers', color: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20' },
  { name: 'SuperAdmin', users: 1, description: 'Full platform access', color: 'bg-primary/10 text-primary border-primary/20' },
]

export default function AdminUsersPage() {
  const { user } = useAuth()
  const [newUserEmail, setNewUserEmail] = useState('')
  const [selectedRole, setSelectedRole] = useState('Investor')
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')

  const handleCreateUser = async () => {
    if (!newUserEmail) {
      setMessage('Email is required')
      return
    }

    setCreating(true)
    setMessage('')

    try {
      // In a real implementation, this would call the API
      // For now, just show a message
      setMessage(`User creation via API would happen here. Use signup form for now.`)
      setTimeout(() => setMessage(''), 3000)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin">← Back to Admin</Link>
          </Button>
          <h1 className="text-4xl font-bold">User Management</h1>
          <p className="text-muted-foreground max-w-3xl">
            Manage user accounts across all roles. Create new users, assign permissions, and monitor activity.
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Total Users</div>
            <div className="text-3xl font-bold mt-2">7</div>
            <div className="text-xs text-muted-foreground mt-1">Across all roles</div>
          </Card>
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Active Sessions</div>
            <div className="text-3xl font-bold mt-2">1</div>
            <div className="text-xs text-muted-foreground mt-1">Currently logged in</div>
          </Card>
          <Card className="p-5 bg-white/5 border-white/10">
            <div className="text-sm text-muted-foreground">Pending Approvals</div>
            <div className="text-3xl font-bold mt-2">0</div>
            <div className="text-xs text-muted-foreground mt-1">KYC in review</div>
          </Card>
        </div>

        <Card className="p-6 bg-white/5 border-white/10 space-y-4">
          <h2 className="text-xl font-semibold">Create New User</h2>
          <p className="text-sm text-muted-foreground">
            Use the email signup form at the login page to create investor accounts, or use wallet-based login for role assignment.
          </p>
          <div className="flex gap-4">
            <Button asChild>
              <Link href="/admin/users/create">Create New User</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/login">Go to Signup Form</Link>
            </Button>
          </div>
        </Card>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">User Roles</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {USER_ROLES.map((role) => (
              <Card key={role.name} className="p-5 bg-white/5 border-white/10">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold">{role.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{role.description}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-semibold border ${role.color}`}>
                    {role.users} user{role.users !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Email pattern: {role.name.toLowerCase().replace('fundmanager', '.fund.manager')}@*
                </div>
              </Card>
            ))}
          </div>
        </div>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Authentication Methods</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div>
              <span className="font-semibold text-white">Email/Password:</span> New users can self-register via the signup form. 
              They receive the Investor role automatically.
            </div>
            <div>
              <span className="font-semibold text-white">Wallet-Based:</span> Connect MetaMask with role-specific email addresses. 
              The system assigns roles based on email prefix (investor@, token.agent@, issuer@, etc).
            </div>
            <div>
              <span className="font-semibold text-white">Pre-seeded Accounts:</span> Test users exist for all roles. 
              Run <code className="px-1 py-0.5 bg-black/30 rounded">go run ./cmd/seed</code> to reset test data.
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
