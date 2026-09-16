import Link from 'next/link'
import { BookOpenCheck, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function LedgerPage() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary sm:px-6">
      <section className="mx-auto max-w-3xl space-y-6 rounded-xl border border-bxo-warning-border bg-bxo-surface p-6 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-bxo-warning-border bg-bxo-warning/10 text-bxo-warning-light">
          <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <div className="bxo-kicker">Authoritative ledger boundary</div>
          <h1 className="mt-3 font-display text-4xl font-bold">Ledger explorer unavailable</h1>
          <p className="mt-4 leading-7 text-bxo-text-secondary">
            This workspace does not expose a complete journal explorer yet. Browser-local transaction records are not ledger evidence and are not shown here.
          </p>
        </div>
        <div className="flex gap-3 rounded-xl border border-bxo-warning-border bg-bxo-warning/10 p-4 text-sm leading-6 text-bxo-warning-light">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>Use the controlled settlement queue, investor portfolio, and offering evidence pages for records backed by the current API, database, and chain.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/wm/settlements">Open settlement evidence</Link></Button>
          <Button asChild variant="outline"><Link href="/wm">Back to workspace</Link></Button>
        </div>
      </section>
    </main>
  )
}
