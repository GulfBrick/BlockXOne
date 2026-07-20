'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const ISSUER_STATS = [
  { label: 'Active Offerings', value: '2', hint: 'Published on testnet' },
  { label: 'Pending Subs', value: '0', hint: 'Awaiting approval' },
  { label: 'Total AUM', value: 'R0', hint: 'Across all funds' },
  { label: 'Token Holders', value: '0', hint: 'Unique investors' }
]

const ISSUER_SECTIONS = [
  {
    href: '#',
    title: 'Create Offering',
    description: 'Launch a new tokenized fund with customizable terms and tokenomics.',
    action: 'New Offering',
    disabled: true
  },
  {
    href: '#',
    title: 'NAV Management',
    description: 'Update net asset values and calculate token prices for your funds.',
    action: 'Update NAV',
    disabled: true
  },
  {
    href: '#',
    title: 'Subscription Queue',
    description: 'Review and approve investor subscription requests for your offerings.',
    action: 'View Queue',
    disabled: true
  },
  {
    href: '#',
    title: 'Distributions',
    description: 'Process dividend payments and income distributions to token holders.',
    action: 'Create Distribution',
    disabled: true
  },
  {
    href: '#',
    title: 'Cap Table',
    description: 'View detailed ownership breakdown and token holder information.',
    action: 'View Cap Table',
    disabled: true
  },
  {
    href: '#',
    title: 'Investor Reports',
    description: 'Generate statements, tax documents, and compliance reports.',
    action: 'Run Reports',
    disabled: true
  }
]

export default function IssuerPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Issuer Fund Manager
          </div>
          <h1 className="text-4xl font-bold">Fund Management</h1>
          <p className="text-muted-foreground max-w-3xl">
            Create and manage tokenized fund offerings, update NAV, process subscriptions, and handle distributions.
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

        <div className="grid gap-4 sm:grid-cols-4">
          {ISSUER_STATS.map((stat) => (
            <Card key={stat.label} className="p-5 bg-white/5 border-white/10">
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              <div className="text-3xl font-bold mt-2">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.hint}</div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUER_SECTIONS.map((section) => (
            <Card key={section.title} className="p-5 bg-white/5 border-white/10 space-y-2">
              <div className="text-lg font-semibold">{section.title}</div>
              <div className="text-sm text-muted-foreground">{section.description}</div>
              <Button 
                variant="secondary" 
                asChild={!section.disabled} 
                disabled={section.disabled}
                className="mt-2"
              >
                {section.disabled ? (
                  <span>{section.action}</span>
                ) : (
                  <Link href={section.href}>{section.action}</Link>
                )}
              </Button>
            </Card>
          ))}
        </div>

        <Card className="p-6 bg-blue-900/20 border-blue-500/30">
          <h3 className="text-lg font-semibold mb-3">Development Status</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Full issuer portal with offering creation, subscription management, NAV updates, 
            and distribution processing is under development. Core API endpoints are functional.
          </p>
          <div className="flex gap-4">
            <Button variant="outline" asChild>
              <Link href="/admin">Back to Admin</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/investor/market">Preview Investor View</Link>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
