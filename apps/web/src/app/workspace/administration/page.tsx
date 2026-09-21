import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { AdministrationPanel } from '@/components/workspace/administration-panel'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { parseAdministrationQuery } from '@/lib/administration/query'
import { readAdministration } from '@/lib/administration/server'
import type { AdminAvailability, AdminReadProjection } from '@/lib/administration/contracts'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readWorkspace } from '@/lib/supabase/server'
import { hasCurrentTotp, hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: Props) {
  return { title: 'Administration', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/workspace/administration', await searchParams) }
}
function gate(availability: Exclude<AdminAvailability, 'ready' | 'hold'>): AdminReadProjection {
  return { availability, scopeRevision: null, policyVersion: 1, caller: null, scope: null, people: [], entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
}
export default async function AdministrationPage({ searchParams }: Props) {
  if (!isSupabaseAuthMode()) notFound()
  const query = parseAdministrationQuery(await searchParams)
  let view = gate('unavailable')
  let organisations: { id: string; name: string }[] = []
  let signedIn = false
  let sufficient = false
  let assigned = false
  let unavailable = query === null
  if (query) {
    try {
      const client = await createPageSupabaseClient()
      const context = await readMfaContext(client)
      signedIn = Boolean(context)
      if (context) {
        sufficient = hasRequiredMfa(context)
        if (sufficient) {
          const workspace = await readWorkspace(client)
          assigned = Boolean(workspace)
          if (workspace) {
            const selected = query.organisationId ? workspace.organisations.find(org => org.id === query.organisationId) : workspace.organisations[0]
            if (!selected) view = gate('forbidden')
            else if (!hasCurrentTotp(context)) view = gate('mfa_required')
            else {
              view = await readAdministration(client, selected.id, query.proposalId)
              if (view.availability === 'ready' || view.availability === 'hold') organisations = workspace.organisations.map(({ id, name }) => ({ id, name }))
            }
          }
          if (!await isMfaContextCurrent(client, context)) throw new Error('Unavailable')
        }
      }
    } catch { unavailable = true; view = gate('unavailable'); organisations = [] }
  }
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && !sufficient) redirect('/login/mfa')
  if (!unavailable && !assigned) redirect('/workspace/access-denied')
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-6 border-b border-bxo-border-subtle pb-8"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">BlockXOne access</p><h1 className="mt-4 font-ui text-4xl font-semibold tracking-tight text-bxo-text-primary">Administration</h1><p className="mt-4 text-base text-bxo-text-secondary">People, legal-party records and controlled access changes.</p></div><nav aria-label="Workspace navigation" className="flex flex-wrap items-center gap-4"><Link href="/workspace" className="inline-flex min-h-11 items-center text-sm text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Back to workspace</Link><Link href="/workspace/security" className="inline-flex min-h-11 items-center text-sm text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Account security</Link><form method="post" action="/auth/logout"><Button type="submit" variant="outline" className="min-h-11">Sign out</Button></form></nav></div>
    <AdministrationPanel view={view} organisations={organisations} selectedOrganisationId={query?.organisationId} selectedProposalId={query?.proposalId} />
    <p className="mt-8 border-l-2 border-bxo-accent-primary pl-4 text-base leading-7 text-bxo-text-secondary">Financial and token operations are not enabled.</p>
  </main></PublicShell>
}
