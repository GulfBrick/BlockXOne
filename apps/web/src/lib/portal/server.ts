import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser } from '@/lib/supabase/server'
import { isDemoEnvironment } from '@/lib/testnet-fund/contracts'
import { customerMonitoringSnapshotSchema, type PortalPageData, type PortalSnapshot } from './contracts'
import { portalContextMatches, type PortalOperatingContext } from './operating-context'
import { fundingSnapshotSchema } from './funding-contracts'
import { validatedStage2Access } from './stage2-access'
import { validatedOfferingAccess } from './offering-access'
import { platformRelease } from '@/lib/platform-release'
import { testOrdinaryEntryMfaPaused } from '@/lib/supabase/test-ordinary-entry'

export class PortalError extends Error {
  constructor(message: string, public readonly status = 409) { super(message) }
}
/** Server-only compatibility signal. It grants no read or command authority. */
export class PackageReaderUnavailable extends PortalError {
  constructor() { super('The package reader is not available for this context.', 503) }
}
export function requirePortalEnvironment() {
  if (!isDemoEnvironment(process.env)) throw new PortalError('Customer operations are not admitted in this environment.', 404)
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
  if (error?.code === '42501' && error.message === 'admission_read_scope_denied'
    && testOrdinaryEntryMfaPaused(process.env) && platformRelease(process.env)?.environment === 'TESTNET'
    && operatingContext?.mode === 'ROLE' && ['OfferingManager', 'IssuerFundManager'].includes(operatingContext.role)) throw new PackageReaderUnavailable()
  if (error) throw new PortalError(error.code === '42501' ? 'This session does not have access. Complete any required MFA or contact your reviewer.' : 'The saved portal state is temporarily unavailable.', error.code === '42501' ? 403 : 503)
  if (!isPortalSnapshot(data, user.id)) throw new PortalError('The saved portal state is unavailable.', 503)
  if (operatingContext && !portalContextMatches(data.operating_context, operatingContext)) throw new PortalError('The operating context could not be verified.', 503)
  if (data.stage2_access !== undefined && !validatedStage2Access(data, operatingContext, platformRelease(process.env)?.environment)) throw new PortalError('The admission context could not be verified.', 503)
  if (data.offering_access !== undefined && !validatedOfferingAccess(data, operatingContext, platformRelease(process.env)?.environment)) throw new PortalError('The package context could not be verified.', 503)
  return { user: { id: user.id, email: user.email }, snapshot: data }
}
export function isPortalSnapshot(value: unknown, userId: string): value is PortalSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PortalSnapshot>
  return !('rehearsal' in v) && v.actor?.id === userId && typeof v.actor.email === 'string' && typeof v.actor.can_review === 'boolean'
    && ['applications', 'organisations', 'products', 'subscriptions', 'events'].every(key => Array.isArray((v as Record<string, unknown>)[key]))
    && (v.customer_monitoring === undefined || customerMonitoringSnapshotSchema.safeParse(v.customer_monitoring).success)
    && (v.funding === undefined || fundingSnapshotSchema.safeParse(v.funding).success)
    && (v.stage2_access === undefined || validatedStage2Access(v as PortalSnapshot) !== null)
    && (v.offering_access === undefined || validatedOfferingAccess(v as PortalSnapshot) !== null)
}
export async function loadPortalPage(): Promise<PortalPageData> {
  requirePortalEnvironment()
  return readPortal(await createPageSupabaseClient())
}
