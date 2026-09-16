import Link from 'next/link'
import { ShieldAlert, Snowflake } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function FreezeControlsPage() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6 rounded-xl border border-bxo-warning-border bg-bxo-surface p-6 sm:p-8">
        <Snowflake className="h-10 w-10 text-bxo-warning-light" aria-hidden="true" />
        <div>
          <div className="bxo-kicker">Governed token operation</div>
          <h1 className="mt-3 font-display text-4xl font-bold">Freeze execution unavailable</h1>
          <p className="mt-4 leading-7 text-bxo-text-secondary">
            The direct mutation route is disabled. Freeze and unfreeze require an approved managed operation with exact wallet, token, reason, signer, receipt, finality, and indexed state evidence.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm leading-6 text-bxo-warning-light">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>This page does not expose a control that is guaranteed to fail against the disabled backend.</p>
        </div>
        <Button asChild variant="outline"><Link href="/tokenisation-agent">Back to token operations</Link></Button>
      </section>
    </main>
  )
}
