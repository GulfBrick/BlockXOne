import Link from 'next/link'
import { PublicShell } from '@/components/public/public-shell'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = { title: 'Workspace access', robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

export default function AccessDeniedPage() {
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-md px-4 py-16 sm:px-6 sm:py-24"><h1 className="font-ui text-3xl font-medium leading-tight text-bxo-text-primary">Workspace access is unavailable.</h1><p className="mt-6 text-base leading-7 text-bxo-text-secondary">An active workspace assignment is required. Contact your workspace administrator if you expected access.</p><nav aria-label="Access options" className="mt-8 flex flex-wrap gap-6"><Link href="/" className="inline-flex min-h-11 items-center text-bxo-accent-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Home</Link><Link href="/login" className="inline-flex min-h-11 items-center text-bxo-accent-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Sign in</Link></nav></main></PublicShell>
}
