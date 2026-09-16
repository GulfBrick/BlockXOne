import Link from 'next/link'
import { FileClock, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function WMReportsPage() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6 rounded-xl border border-bxo-warning-border bg-bxo-surface p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light">
          <FileClock className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <div className="bxo-kicker">Controlled reporting</div>
          <h1 className="mt-3 font-display text-4xl font-bold">Report generation unavailable</h1>
          <p className="mt-4 leading-7 text-bxo-text-secondary">
            No generated report repository is configured in this workspace. Static sample reports and inactive download controls have been removed.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm leading-6 text-bxo-warning-light">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>A report will only be offered when its source records, generation time, content digest, and downloadable artifact are durably recorded.</p>
        </div>
        <Button asChild variant="outline"><Link href="/wm">Back to workspace</Link></Button>
      </section>
    </main>
  )
}
