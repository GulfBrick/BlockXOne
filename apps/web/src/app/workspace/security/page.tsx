import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { MfaForm } from '@/components/auth/mfa-form'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readWorkspace } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext, toMfaView } from '@/lib/supabase/mfa'
import type { MfaView } from '@/lib/supabase/mfa-contracts'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: Props) {
  return { title: 'Account security', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/workspace/security', await searchParams) }
}
export default async function SecurityPage({ searchParams }: Props) {
  if (!isSupabaseAuthMode()) notFound()
  const params = await searchParams
  let unavailable = Object.values(params).some(value => value !== undefined)
  let signedIn = false
  let sufficient = false
  let assigned = false
  let view: MfaView | null = null
  if (!unavailable) {
    try {
      const client = await createPageSupabaseClient()
      const context = await readMfaContext(client)
      signedIn = Boolean(context)
      if (context) {
        sufficient = hasRequiredMfa(context)
        if (sufficient) {
          assigned = Boolean(await readWorkspace(client))
          if (!await isMfaContextCurrent(client, context)) throw new Error('Access unavailable')
          if (assigned) view = toMfaView(context)
        }
      }
    } catch { unavailable = true }
  }
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && !sufficient) redirect('/login/mfa')
  if (!unavailable && !assigned) redirect('/workspace/access-denied')
  const authenticatorVerified = !unavailable && view?.state === 'verified'
    && view.factors.some(factor => factor.factorType === 'totp' && factor.status === 'verified')
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-md px-4 py-8 sm:px-6 sm:py-10">
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">BlockXOne access</p>
    <h1 className="mt-4 font-ui text-3xl font-medium tracking-tight text-bxo-text-primary sm:text-4xl">Account security</h1>
    {unavailable || !view ? <p role="alert" className="mt-4 text-base text-bxo-text-secondary">Verification is temporarily unavailable. Reload before trying again.</p> : <>
      {authenticatorVerified ? <section className="mt-6 rounded-lg border border-bxo-accent-border bg-bxo-accent-soft p-5" aria-labelledby="authenticator-verified-title">
        <h2 id="authenticator-verified-title" className="text-xl font-semibold text-bxo-text-primary">Verification complete</h2>
        <p role="status" className="mt-3 text-base leading-7 text-bxo-text-secondary">Your sign-in is verified. You can continue now; you do not need to enter another code here. Protected actions may request a fresh code later.</p>
        <Button asChild className="mt-5 min-h-11 w-full"><Link href="/portal">Continue to BlockXOne</Link></Button>
      </section> : null}
      <MfaForm view={view} continuation="security" />
    </>}
    <p className="mt-5 text-base leading-7 text-bxo-text-secondary">Authenticator verification does not grant roles or wallet-signing authority.</p>
    <div className="mt-5 flex flex-wrap items-center gap-4">{!authenticatorVerified ? <Link href="/portal" className="inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Return to BlockXOne</Link> : null}<form method="post" action="/auth/logout"><Button type="submit" variant="outline" className="min-h-11">Sign out</Button></form></div>
  </main></PublicShell>
}
