import Link from 'next/link'
import { ShieldAlert, UsersRound } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6 rounded-xl border border-bxo-warning-border bg-bxo-surface p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light">
          <UsersRound className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <div className="bxo-kicker">Investor records</div>
          <h1 className="mt-3 font-display text-4xl font-bold">Investor directory unavailable</h1>
          <p className="mt-4 leading-7 text-bxo-text-secondary">
            This workspace does not expose an authorised investor-directory API. Fabricated people, KYC states, and holdings are not displayed.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm leading-6 text-bxo-warning-light">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Use the role-controlled KYC, subscription, settlement, and portfolio surfaces for authoritative records already implemented.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/wm/subscriptions">Open subscriptions</Link></Button>
          <Button asChild variant="outline"><Link href="/wm">Back to workspace</Link></Button>
        </div>
      </section>
    </main>
  )
}
