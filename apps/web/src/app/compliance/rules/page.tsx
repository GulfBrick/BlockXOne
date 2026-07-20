'use client'

import { Card } from '@/components/ui/card'

type Rule = {
  name: string
  description: string
  status: 'On' | 'Off'
  owner: string
  lastUpdated: string
}

const RULES: Rule[] = [
  {
    name: 'PEP screening',
    description: 'Screen applicants against PEP lists and require enhanced due diligence.',
    status: 'On',
    owner: 'Compliance',
    lastUpdated: 'Today'
  },
  {
    name: 'Sanctions (OFAC + UN)',
    description: 'Block sanctioned individuals and entities; auto reject wallet approvals.',
    status: 'On',
    owner: 'Compliance',
    lastUpdated: '2d ago'
  },
  {
    name: 'Jurisdiction blocklist',
    description: 'Disallow onboarding from embargoed or unsupported jurisdictions.',
    status: 'On',
    owner: 'Legal',
    lastUpdated: '5d ago'
  },
  {
    name: 'High-risk occupation review',
    description: 'Manual review for crypto, gambling, adult, and cash-intensive occupations.',
    status: 'Off',
    owner: 'Compliance',
    lastUpdated: '1w ago'
  }
]

export default function ComplianceRules() {
  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Rules and policies
          </div>
          <h1 className="text-3xl font-bold">KYC/AML controls</h1>
          <p className="text-muted-foreground max-w-2xl">Reference of demo rules so the route is not 404. Wire these to your policy engine when ready.</p>
        </div>

        <div className="space-y-3">
          {RULES.map((rule) => (
            <Card key={rule.name} className="p-5 bg-white/5 border-white/10">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-semibold">{rule.name}</div>
                    <span
                      className={`px-2 py-1 rounded-full text-xs ${
                        rule.status === 'On' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                      }`}
                    >
                      {rule.status}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">{rule.description}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Owner: {rule.owner}</div>
                  <div>Updated: {rule.lastUpdated}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}