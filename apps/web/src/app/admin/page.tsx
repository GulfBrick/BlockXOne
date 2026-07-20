'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const PLATFORM_STATS = [
  { label: 'Active Users', value: '7', hint: 'Across all roles' },
  { label: 'Pending KYC', value: '0', hint: 'Compliance queue' },
  { label: 'Active Chains', value: '4', hint: 'Base, Polygon, Arbitrum, Ethereum' },
  { label: 'Auth Mode', value: 'JWT', hint: 'Email + Wallet' }
]

const ADMIN_SECTIONS = [
  { 
    href: '/admin/users', 
    title: 'User Management', 
    description: 'Create and manage users across all roles. Assign permissions and control access.',
    action: 'Manage Users'
  },
  { 
    href: '/admin/roles', 
    title: 'Roles & Permissions', 
    description: 'Configure role-based access control and permission matrices.',
    action: 'Configure Roles'
  },
  { 
    href: '/compliance', 
    title: 'Compliance & KYC', 
    description: 'Review KYC submissions, wallet approvals, and audit compliance activities.',
    action: 'View Queue'
  },
  { 
    href: '/tokenisation-agent', 
    title: 'Token Operations', 
    description: 'Oversee minting, burning, whitelisting, and blockchain transaction management.',
    action: 'Token Portal'
  },
  { 
    href: '/issuer', 
    title: 'Issuer Management', 
    description: 'Manage fund offerings, NAV updates, subscriptions, and distributions.',
    action: 'Issuer Portal'
  },
  { 
    href: '/investor/market', 
    title: 'Investor Preview', 
    description: 'View the platform from an investor perspective. Test user flows.',
    action: 'Preview Market'
  }
]

export default function AdminPage() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Super Admin
            </div>
            <h1 className="text-4xl font-bold">Platform Administration</h1>
            <p className="text-muted-foreground max-w-3xl">
              Central control panel for managing users, compliance, tokenization operations, and platform configuration.
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
          <Button variant="outline" onClick={logout}>
            Logout
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          {PLATFORM_STATS.map((stat) => (
            <Card key={stat.label} className="p-5 bg-white/5 border-white/10">
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              <div className="text-3xl font-bold mt-2">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.hint}</div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_SECTIONS.map((section) => (
            <Card key={section.href} className="p-5 bg-white/5 border-white/10 space-y-2">
              <div className="text-lg font-semibold">{section.title}</div>
              <div className="text-sm text-muted-foreground">{section.description}</div>
              <Button variant="secondary" asChild className="mt-2">
                <Link href={section.href}>{section.action}</Link>
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
