import { ShieldAlert } from 'lucide-react'

import { Card } from '@/components/ui/card'

export default function AdminRoles() {
  return (
    <main className="min-h-screen bg-bxo-bg-primary px-4 py-12 text-bxo-text-primary">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="bxo-kicker">Role administration</div>
        <h1 className="font-display text-3xl font-bold">Access policy</h1>
        <Card className="bxo-panel p-8 text-center">
          <ShieldAlert className="mx-auto h-9 w-9 text-bxo-warning" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-semibold">Role administration is unavailable</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-bxo-text-secondary">
            This surface does not present a static permission matrix as live policy. Current access is enforced from the authenticated organisation, role, and permission context.
          </p>
        </Card>
      </div>
    </main>
  )
}
