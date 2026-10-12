import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { StaffInvitationsPanel } from '@/components/workspace/staff-invitations-panel'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { readStaffInvitationDirectory, type StaffInviteDirectory } from '@/lib/administration/staff-invitations'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readWorkspace } from '@/lib/supabase/server'
import { hasCurrentTotp, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = { title:'Staff invitations', robots:{ index:false, follow:false }, referrer:'no-referrer' as const }
type Props = { searchParams:Promise<Record<string,string|string[]|undefined>> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function StaffInvitationsPage({ searchParams }:Props) {
  if (!isSupabaseAuthMode()) notFound()
  const params = await searchParams
  let signedIn = false, unavailable = false, mfaRequired = false
  let org: { id:string; name:string } | null = null
  let directory: StaffInviteDirectory | null = null
  try {
    if (Object.keys(params).some(key=>key!=='organisation') || (params.organisation!==undefined && (typeof params.organisation!=='string' || !uuid.test(params.organisation)))) throw new Error()
    const client = await createPageSupabaseClient()
    const context = await readMfaContext(client)
    signedIn = Boolean(context)
    if (context) {
      mfaRequired = !hasCurrentTotp(context)
      const workspace = await readWorkspace(client)
      org = workspace?.organisations.find(candidate=>candidate.id===params.organisation) ?? workspace?.organisations[0] ?? null
      if (org && !mfaRequired) directory = await readStaffInvitationDirectory(client,org.id)
      if (!await isMfaContextCurrent(client,context)) throw new Error()
    }
  } catch { unavailable=true }
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && !org) redirect('/workspace/access-denied')
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
    <Link href="/workspace/administration" className="inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline">Back to administration</Link>
    <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Controlled access</p>
    <h1 className="mt-4 font-ui text-4xl font-medium tracking-tight text-bxo-text-primary">Staff invitations</h1>
    <p className="mt-3 text-base leading-7 text-bxo-text-secondary">First-time access for one approved organisation and role. This does not create a wallet or grant signing authority.</p>
    {org ? <p className="mt-4 text-sm text-bxo-text-secondary">Organisation: <span className="text-bxo-text-primary">{org.name}</span></p> : null}
    {unavailable ? <p role="alert" className="mt-8 text-bxo-text-secondary">Invitation state is unavailable. Reload before acting.</p>
      : mfaRequired ? <p role="alert" className="mt-8 text-bxo-text-secondary">Verify your authenticator to administer invitations.</p>
        : directory?.ok && org ? <StaffInvitationsPanel directory={directory} organisationId={org.id} />
          : <p role="alert" className="mt-8 text-bxo-text-secondary">Invitation authority is unavailable for this organisation.</p>}
  </main></PublicShell>
}
