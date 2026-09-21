import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { MfaForm } from '@/components/auth/mfa-form'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { platformRelease } from '@/lib/platform-release'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { hasRequiredMfa, readMfaContext, toMfaView } from '@/lib/supabase/mfa'
import type { MfaView } from '@/lib/supabase/mfa-contracts'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: Props) {
  return { title: 'Verify your sign-in', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/login/mfa', await searchParams) }
}
export default async function MfaPage({ searchParams }: Props) {
  if (!isSupabaseAuthMode()) notFound()
  const params = await searchParams
  const safeQuery = Object.entries(params).every(([key, value]) => value === undefined || (key === 'continue' && value === 'setup'))
  const continuation = params.continue === 'setup' ? 'setup' : 'workspace'
  let unavailable = !safeQuery
  let signedIn = false
  let sufficient = false
  let view: MfaView | null = null
  if (safeQuery) {
    try {
      const context = await readMfaContext(await createPageSupabaseClient())
      signedIn = Boolean(context)
      if (context) { sufficient = hasRequiredMfa(context); view = toMfaView(context) }
    } catch { unavailable = true }
  }
  // Next navigation exceptions must never be swallowed by a provider catch.
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && sufficient) redirect(continuation === 'setup' ? '/login?setup=1' : platformRelease(process.env) ? '/portal' : '/workspace')
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-md px-4 py-16 sm:px-6 sm:py-24">
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Secure access</p>
    <h1 className="mt-4 font-ui text-3xl font-medium tracking-tight text-bxo-text-primary sm:text-4xl">Verify your sign-in</h1>
    {unavailable || !view ? <p role="alert" className="mt-6 text-base text-bxo-text-secondary">Verification is temporarily unavailable. Reload before trying again.</p> : <><p className="mt-6 text-base text-bxo-text-secondary">Enter the six-digit code from your authenticator app.</p><MfaForm view={view} continuation={continuation} /></>}
    <form method="post" action="/auth/logout" className="mt-8"><Button type="submit" variant="outline" className="min-h-11">Sign out</Button></form>
  </main></PublicShell>
}
