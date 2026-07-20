'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const QUEUE_STATS = [
  { label: 'Open cases', value: '12', hint: '6 awaiting documents, 6 in review' },
  { label: 'SLA breaches', value: '1', hint: 'Escalated to lead reviewer' },
  { label: 'Wallet approvals', value: '4', hint: 'Ready for signing' }
]

const QUICK_LINKS = [
  { href: '/compliance/queue', title: 'Case queue', description: 'Review KYC/AML submissions and wallet approvals.' },
  { href: '/compliance/rules', title: 'Rules & policies', description: 'View jurisdiction, PEP, sanctions, and risk scoring rules.' },
  { href: '/compliance/audit', title: 'Audit log', description: 'Track reviewer actions, approvals, and escalations.' }
]

export default function ComplianceLanding() {
  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Compliance workspace
          </div>
          <h1 className="text-4xl font-bold">Review queue</h1>
          <p className="text-muted-foreground max-w-3xl">
            Central hub for Compliance Officers to triage KYC, wallet approvals, and policy checks.
            Use the links below to open the queue, adjust rules, or view audit trails.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {QUEUE_STATS.map((item) => (
            <Card key={item.label} className="p-5 bg-white/5 border-white/10">
              <div className="text-sm text-muted-foreground">{item.label}</div>
              <div className="text-3xl font-bold mt-2">{item.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{item.hint}</div>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Card key={link.href} className="p-5 bg-white/5 border-white/10 space-y-2">
              <div className="text-lg font-semibold">{link.title}</div>
              <div className="text-sm text-muted-foreground">{link.description}</div>
              <Button variant="secondary" asChild className="mt-2">
                <Link href={link.href}>Open</Link>
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}