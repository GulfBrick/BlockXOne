'use client'

import { Card } from '@/components/ui/card'

type Feature = {
  name: string
  description: string
  status: 'Enabled' | 'Disabled'
  owner: string
}

const FEATURES: Feature[] = [
  {
    name: 'MetaMask required for subscribe',
    description: 'Investors must connect wallet; sends purchase(uint256) on FundSale when contract set.',
    status: 'Enabled',
    owner: 'SuperAdmin'
  },
  {
    name: 'KYC gate on funds',
    description: 'Block subscriptions until KYC case is approved.',
    status: 'Enabled',
    owner: 'Compliance'
  },
  {
    name: 'Off-ramp with redemption',
    description: 'Wire redemptions to bank accounts (mocked).',
    status: 'Disabled',
    owner: 'Product'
  }
]

export default function AdminFeatures() {
  return (
    <div className="min-h-screen bg-[#0D0F14] text-white">
      <div className="max-w-5xl mx-auto px-4 py-12 space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-primary/10 text-primary text-sm font-medium w-fit">
            <span className="w-2 h-2 rounded-full bg-primary" />
            Feature toggles
          </div>
          <h1 className="text-3xl font-bold">Platform features</h1>
          <p className="text-muted-foreground max-w-2xl">Demo toggles so the route is live. Connect to your config store later.</p>
        </div>

        <div className="space-y-3">
          {FEATURES.map((feature) => (
            <Card key={feature.name} className="p-5 bg-white/5 border-white/10 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <div className="text-lg font-semibold">{feature.name}</div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      feature.status === 'Enabled' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                    }`}
                  >
                    {feature.status}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">{feature.description}</div>
              </div>
              <div className="text-xs text-muted-foreground">Owner: {feature.owner}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}