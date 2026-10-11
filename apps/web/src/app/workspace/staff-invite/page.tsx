import { notFound, redirect } from 'next/navigation'
import { PublicShell } from '@/components/public/public-shell'
import { MfaForm } from '@/components/auth/mfa-form'
import { StaffInvitationAccept } from '@/components/auth/staff-invitation-accept'
import { Button } from '@/components/ui/button'
import { isSupabaseAuthMode } from '@/lib/auth-mode'
import { pendingStaffInvitations } from '@/lib/administration/staff-invitations'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { hasCurrentTotp, readMfaContext, requireRecentTotp, toMfaView } from '@/lib/supabase/mfa'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = { title:'Accept staff invitation', robots:{ index:false, follow:false }, referrer:'no-referrer' as const }

export default async function StaffInvitationPage() {
  if (!isSupabaseAuthMode()) notFound()
  let signedIn = false
  let invitation: { id:string; organisationId:string; role:string; expiresAt:string } | null = null
  let mfa: Awaited<ReturnType<typeof readMfaContext>> = null
  let unavailable = false
  try {
    const client = await createPageSupabaseClient()
    mfa = await readMfaContext(client)
    signedIn = Boolean(mfa)
    if (mfa) invitation = (await pendingStaffInvitations(client))[0] ?? null
  } catch { unavailable = true }
  if (!unavailable && !signedIn) redirect('/login')
  if (!unavailable && !invitation) redirect('/portal')
  const ready = Boolean(mfa && hasCurrentTotp(mfa) && requireRecentTotp(mfa,Math.floor(Date.now()/1000)).allowed)
  return <PublicShell><main id="main-content" className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6 sm:py-24">
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Controlled access</p>
    <h1 className="mt-4 font-ui text-3xl font-medium tracking-tight text-bxo-text-primary sm:text-4xl">Staff invitation</h1>
    {unavailable || !mfa || !invitation ? <p role="alert" className="mt-6 text-bxo-text-secondary">Invitation status is temporarily unavailable. Reload before continuing.</p>
      : <><p className="mt-6 text-base leading-7 text-bxo-text-secondary">Your email is verified, but no organisation role is active yet. Complete your authenticator check, then accept the reviewed assignment.</p>
        <dl className="mt-6 grid gap-3 rounded-lg border border-bxo-border-default p-5 text-sm text-bxo-text-primary"><div><dt className="text-bxo-text-tertiary">Assigned capacity</dt><dd>{invitation.role}</dd></div><div><dt className="text-bxo-text-tertiary">Organisation reference</dt><dd className="break-all font-mono">{invitation.organisationId}</dd></div><div><dt className="text-bxo-text-tertiary">Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleString('en-ZA',{ timeZone:'Africa/Johannesburg', dateStyle:'medium', timeStyle:'short' })} SAST</dd></div></dl>
        {ready ? <StaffInvitationAccept invitationId={invitation.id} /> : <><p className="mt-8 text-sm text-bxo-text-secondary">A current authenticator code is required before this assignment can take effect.</p><MfaForm view={toMfaView(mfa)} continuation="staff" /></>}
      </>}
    <form method="post" action="/auth/logout" className="mt-8"><Button type="submit" variant="outline" className="min-h-11">Sign out</Button></form>
  </main></PublicShell>
}
