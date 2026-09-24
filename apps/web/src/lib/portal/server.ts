import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser } from '@/lib/supabase/server'
import { isDemoEnvironment } from '@/lib/testnet-fund/contracts'
import { customerMonitoringSnapshotSchema, type PortalPageData, type PortalSnapshot } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { fundingSnapshotSchema } from './funding-contracts'

export class PortalError extends Error {
  constructor(message: string, public readonly status = 409) { super(message) }
}
export function requirePortalEnvironment() {
  if (!isDemoEnvironment(process.env)) throw new PortalError('This customer rehearsal is not enabled here.', 404)
}
export async function readPortal(client: SupabaseClient, operatingContext?: PortalOperatingContext): Promise<PortalPageData> {
  requirePortalEnvironment()
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in with your verified email to continue.', 401)
  // The RPC enforces live auth.sessions, native suspension/recovery/MFA, and
  // caller-owned onboarding. User-editable signup intent never grants a role.
  const result = operatingContext
    ? client.rpc('bx1_portal_read_scoped', { operating_context: operatingContext })
    : client.rpc('bx1_portal_read')
  const { data, error } = await result.abortSignal(AbortSignal.timeout(12000))
  if (error) throw new PortalError(error.code === '42501' ? 'This session does not have access. Complete any required MFA or contact your reviewer.' : 'The saved portal state is temporarily unavailable.', error.code === '42501' ? 403 : 503)
  if (!isPortalSnapshot(data, user.id)) throw new PortalError('The saved portal state is unavailable.', 503)
  if (operatingContext && !portalContextMatches(data.operating_context, operatingContext)) throw new PortalError('The operating context could not be verified.', 503)
  return { user: { id: user.id, email: user.email }, snapshot: data }
}
export function isPortalSnapshot(value: unknown, userId: string): value is PortalSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PortalSnapshot>
  return v.actor?.id === userId && typeof v.actor.email === 'string' && typeof v.actor.can_review === 'boolean'
    && ['applications', 'organisations', 'products', 'subscriptions', 'events'].every(key => Array.isArray((v as Record<string, unknown>)[key]))
    && (v.customer_monitoring === undefined || customerMonitoringSnapshotSchema.safeParse(v.customer_monitoring).success)
    && (v.funding === undefined || fundingSnapshotSchema.safeParse(v.funding).success)
}
export async function loadPortalPage(): Promise<PortalPageData> {
  requirePortalEnvironment()
  return readPortal(await createPageSupabaseClient())
}
