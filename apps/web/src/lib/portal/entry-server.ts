import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { identityEnvironmentEnabled } from '@/lib/platform-release'
import { readVerifiedUser } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { entrySnapshotSchema, type EntrySnapshot } from './entry-contracts'
import { PortalError } from './server'

export function requireEntryEnvironment() {
  if (!identityEnvironmentEnabled(process.env)) throw new PortalError('The identity environment is not configured.', 503)
}
export async function readEntry(client: SupabaseClient): Promise<EntrySnapshot> {
  requireEntryEnvironment()
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in with your verified email to continue.', 401)
  const mfa = await readMfaContext(client)
  if (mfa && !hasRequiredMfa(mfa)) throw new PortalError('Complete multi-factor authentication.', 403)
  // The database independently verifies live session, recovery and suspension.
  // No user metadata or selected URL value supplies authority.
  const { data, error } = await client.rpc('bx1_entry_read').abortSignal(AbortSignal.timeout(12000))
  if (error) throw new PortalError(error.code === '42501' ? 'Your current session cannot access this workspace.' : 'Your saved identity context is temporarily unavailable.', error.code === '42501' ? 403 : 503)
  const snapshot = entrySnapshotSchema.safeParse(data)
  if (!snapshot.success || snapshot.data.actor.id !== user.id || snapshot.data.applications.some(application => application.user_id !== user.id)) throw new PortalError('The saved identity context could not be verified.', 503)
  if (mfa && !await isMfaContextCurrent(client, mfa)) throw new PortalError('Complete sign-in again.', 403)
  return snapshot.data
}
