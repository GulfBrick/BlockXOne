'use client'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function ComplianceLanding() {
  return (
    <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-8">
        <div className="space-y-2">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1 text-sm font-medium text-bxo-accent-primary">
            <span className="h-2 w-2 rounded-full bg-bxo-accent-primary" />
            Compliance workspace
          </div>
          <h1 className="font-display text-4xl font-bold">Review queue</h1>
          <p className="max-w-3xl text-bxo-text-secondary">
            Review assigned test identity cases and wallet controls. External screening and sensitive
            identity-document handling are not connected in this environment.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="bxo-card space-y-4 p-6">
            <div className="font-display text-xl font-semibold">Test identity reviews</div>
            <p className="text-sm leading-7 text-bxo-text-secondary">
              Decide assigned test identity cases before an investor can enter the issuance workflow.
            </p>
            <Button variant="secondary" asChild className="mt-2">
              <Link href="/compliance/queue">Open KYC queue</Link>
            </Button>
          </Card>

          <Card className="bxo-card space-y-4 p-6">
            <div className="font-display text-xl font-semibold">Wallet approvals</div>
            <p className="text-sm leading-7 text-bxo-text-secondary">
              Match an eligible investor to the exact assigned address and test network before whitelisting.
            </p>
            <Button variant="secondary" asChild className="mt-2">
              <Link href="/compliance/wallets">Open wallet queue</Link>
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}
