import { Settings2 } from 'lucide-react'

import { Card } from '@/components/ui/card'

export default function AdminFeatures() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="bxo-kicker">Platform configuration</div>
        <h1 className="font-display text-3xl font-bold">Feature controls</h1>
        <Card className="bxo-panel p-8 text-center">
          <Settings2 className="mx-auto h-9 w-9 text-bxo-accent-primary" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-semibold">Feature configuration is unavailable</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-bxo-text-secondary">
            This surface does not present local toggles as authoritative platform state. Configuration will appear only when the protected configuration service is connected.
          </p>
        </Card>
      </div>
    </main>
  )
}
