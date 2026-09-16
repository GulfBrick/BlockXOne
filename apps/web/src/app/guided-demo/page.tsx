import Link from 'next/link'

import { PublicShell } from '@/components/public/public-shell'
import { LegacyPlatformRedirect } from './legacy-platform-redirect'

export default function LegacyPlatformWorkflowPage() {
  return (
    <PublicShell>
      <main id="main-content" className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:px-8">
        <LegacyPlatformRedirect />
        <div className="bxo-kicker">Platform</div>
        <h1 className="mt-6 font-display text-4xl font-semibold text-bxo-text-primary">Opening the platform workflow.</h1>
        <p className="mt-5 text-base leading-8 text-bxo-text-secondary">
          Continue to the BlockXOne platform overview and connected issuance lifecycle.
        </p>
        <Link href="/how-it-works" className="mt-8 font-semibold text-bxo-accent-primary hover:text-bxo-accent-primary-light">
          Continue to Platform
        </Link>
      </main>
    </PublicShell>
  )
}
