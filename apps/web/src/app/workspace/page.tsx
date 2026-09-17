import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser, readWorkspace } from '@/lib/supabase/server'
import type { Bx1Workspace } from '@/lib/supabase/contracts'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return { title: 'Your workspace', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/workspace', await searchParams) }
}

export default async function WorkspacePage() {
  if (!isSupabaseAuthMode()) notFound()
  let workspace: Bx1Workspace | null = null
  let signedIn = false
  let unavailable = false
  try {
    const client = await createPageSupabaseClient()
    signedIn = Boolean(await readVerifiedUser(client))
    if (signedIn) workspace = await readWorkspace(client)
  } catch { unavailable = true }
  // Framework redirects throw; keep them outside the provider error catch.
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && !workspace) redirect('/workspace/access-denied')
  return (
    <PublicShell>
      <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-bxo-border-subtle pb-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">BlockXOne access</p>
            <h1 className="mt-4 font-ui text-3xl font-medium tracking-tight text-bxo-text-primary sm:text-4xl">Your workspace</h1>
          </div>
          <form method="post" action="/auth/logout"><Button type="submit" variant="outline" className="min-h-11 focus-visible:ring-bxo-accent-primary">Sign out</Button></form>
        </div>
        {unavailable || !workspace ? <p role="alert" className="mt-8 text-base text-bxo-text-secondary">Access is temporarily unavailable. Please try again.</p> : (
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <section aria-labelledby="workspace-identity" className="min-w-0 rounded-xl border border-bxo-border-subtle bg-bxo-surface p-6">
              <h2 id="workspace-identity" className="text-xl font-semibold text-bxo-text-primary">Your identity</h2>
              {workspace.user.displayName ? <p className="mt-4 break-words text-lg text-bxo-text-primary">{workspace.user.displayName}</p> : null}
              <p className="mt-2 break-words text-base text-bxo-text-secondary">{workspace.user.email}</p>
            </section>
            <section aria-labelledby="workspace-assignments" className="min-w-0 rounded-xl border border-bxo-border-subtle bg-bxo-surface p-6">
              <h2 id="workspace-assignments" className="text-xl font-semibold text-bxo-text-primary">Active assignments</h2>
              <ul className="mt-4 space-y-6">
                {workspace.organisations.map((org) => <li key={org.id} className="min-w-0"><h3 className="break-words text-lg font-semibold text-bxo-text-primary">{org.name}</h3><ul className="mt-2 flex flex-wrap gap-2" aria-label={`Roles in ${org.name}`}>{org.roles.map((role) => <li key={role} className="max-w-full break-words rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-3 py-2 text-sm text-bxo-text-primary">{role}</li>)}</ul></li>)}
              </ul>
            </section>
          </div>
        )}
        <p className="mt-8 border-l-2 border-bxo-accent-primary pl-4 text-base leading-7 text-bxo-text-secondary">Financial and token operations are not enabled.</p>
      </main>
    </PublicShell>
  )
}
