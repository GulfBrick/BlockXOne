import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { RecoveryPanel } from '@/components/auth/recovery-panel'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { gatedRecovery, parseRecoveryQuery } from '@/lib/recovery/contracts'
import { readRecovery } from '@/lib/recovery/server'
import { createPageSupabaseClient } from '@/lib/supabase/page'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: Props) {
  return { title: 'Recovery containment', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/workspace/recovery', await searchParams) }
}
export default async function RecoveryPage({ searchParams }: Props) {
  if (!isSupabaseAuthMode()) notFound()
  const query = parseRecoveryQuery(await searchParams)
  let projection = gatedRecovery('unavailable')
  if (query) {
    try {
      // This adapter verifies its exact caller token and safe own-status RPC.
      // Ordinary workspace/MFA admission would incorrectly hide held status.
      projection = await readRecovery(await createPageSupabaseClient(), query.caseId)
    } catch { projection = gatedRecovery('unavailable') }
  }
  if (projection.availability === 'unauthorised') redirect('/login')
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-6 border-b border-bxo-border-subtle pb-8">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">BlockXOne access</p><h1 className="mt-4 font-ui text-3xl font-medium tracking-tight text-bxo-text-primary sm:text-4xl">Recovery containment</h1><p className="mt-4 max-w-2xl text-base leading-7 text-bxo-text-secondary">Report a lost authenticator and view the recorded recovery case. A request does not reset your authenticator or restrict access by itself.</p></div>
      <nav aria-label="Recovery navigation" className="flex flex-wrap items-center gap-4"><Link href="/workspace" className="inline-flex min-h-11 items-center text-sm text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Back to workspace</Link><form method="post" action="/auth/logout"><Button type="submit" variant="outline" className="min-h-11">Sign out</Button></form></nav>
    </div>
    <RecoveryPanel projection={projection} />
    <p className="mt-8 border-l-2 border-bxo-accent-primary pl-4 text-base leading-7 text-bxo-text-secondary">Authenticator replacement and release from containment are not available here. Financial and token operations remain disabled.</p>
  </main></PublicShell>
}
