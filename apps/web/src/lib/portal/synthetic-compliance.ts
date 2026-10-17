import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readVerifiedUser } from '@/lib/supabase/server'
import { isMfaContextCurrent, type VerifiedMfaContext } from '@/lib/supabase/mfa'
import { isTestOrdinaryEntryAllowed } from '@/lib/supabase/test-ordinary-entry'
import type { PortalPageData } from './contracts'
import type { PortalOperatingContext } from './operating-context'
import { parseSyntheticComplianceSnapshot } from './synthetic-compliance-contracts'
import { PortalError } from './server'

export async function readSyntheticCompliance(client: SupabaseClient, context: PortalOperatingContext, mfa: VerifiedMfaContext): Promise<PortalPageData> {
  if (context.mode !== 'ROLE' || context.role !== 'ComplianceOfficer' || !isTestOrdinaryEntryAllowed(mfa)) throw new PortalError('Synthetic admission review is not available in this context.', 403)
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous || !await isMfaContextCurrent(client, mfa)) throw new PortalError('Complete sign-in again.', 403)
  const { data, error } = await client.rpc('bx1_portal_synthetic_compliance_read', { operating_context: context }).abortSignal(AbortSignal.timeout(12000))
  if (error) throw new PortalError(error.code === '42501' ? 'This account has no current synthetic admission-review assignment.' : 'The synthetic review queue is unavailable.', error.code === '42501' ? 403 : 503)
  const snapshot = parseSyntheticComplianceSnapshot(data, user.id, context)
  if (!snapshot || snapshot.actor.email !== user.email) throw new PortalError('The synthetic review context could not be verified.', 503)
  if (!await isMfaContextCurrent(client, mfa)) throw new PortalError('Complete sign-in again.', 403)
  return { user: { id: user.id, email: user.email }, snapshot }
}
