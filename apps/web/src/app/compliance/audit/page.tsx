import { History } from 'lucide-react'

import { Card } from '@/components/ui/card'

export default function ComplianceAudit() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="bxo-kicker">Audit history</div>
        <h1 className="font-display text-3xl font-bold">Reviewer actions</h1>
        <Card className="bxo-panel p-8 text-center">
          <History className="mx-auto h-9 w-9 text-bxo-accent-primary" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-semibold">Audit history is unavailable</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-bxo-text-secondary">
            This surface does not present placeholder events. Audit history will appear only when the connected audit feed is configured and authorised.
          </p>
        </Card>
      </div>
    </main>
  )
}
