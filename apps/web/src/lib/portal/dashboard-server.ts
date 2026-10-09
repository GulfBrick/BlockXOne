import 'server-only'
import { platformRelease } from '@/lib/platform-release'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser, readWorkspace } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { readTestOrdinaryEntry, isTestOrdinaryEntryAllowed } from '@/lib/supabase/test-ordinary-entry'
import { dashboardProjection, dashboardScopes, selectDashboardScope, type DashboardQuery } from './dashboard'
import { PortalError, readPortal } from './server'
import type { PortalPageData } from './contracts'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import { readEntry } from './entry-server'
import { selectEntryApplication } from './entry-contracts'
import { customerScopedReadAvailable } from './customer-handoff'

export async function loadRoleDashboard(query: DashboardQuery) {
  const release = platformRelease(process.env)
  if (!release) throw new PortalError('The platform environment is not configured.', 503)
  const client = await createPageSupabaseClient()
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in to continue.', 401)
  const context = await readMfaContext(client)
  if (context && isTestOrdinaryEntryAllowed(context)) {
    const ordinary = await readTestOrdinaryEntry(client, context)
    const scopes = ordinary.workspace ? dashboardScopes(ordinary.workspace) : []
    const chooseContext = query.mode === undefined && query.organisation === undefined && query.role === undefined && scopes.length > 1
    const applicant = query.mode === 'applicant' || !ordinary.workspace || chooseContext || (scopes.length === 0 && query.organisation === undefined && query.role === undefined)
    if (query.mode !== undefined && query.mode !== 'applicant') throw new PortalError('Invalid operating context.', 403)
    if (applicant && (query.organisation !== undefined || query.role !== undefined)) throw new PortalError('No active role assignment is available.', 403)
    const scope = !applicant && ordinary.workspace ? selectDashboardScope(ordinary.workspace, query) : null
    if (!applicant && !scope) throw new PortalError('This role or organisation is not assigned to you.', 403)
    if (query.application !== undefined && (!applicant || !selectEntryApplication(ordinary.entry, query.application))) throw new PortalError('This application is not available to your signed-in account.', 403)
    return { kind: 'ordinary-entry' as const, entry: ordinary.entry, user: ordinary.entry.actor, release, scopes, scope, chooseContext,
      operatingContext: scope ? { mode: 'ROLE' as const, organisationId: scope.organisationId, role: scope.role } : APPLICANT_CONTEXT,
      portal: undefined }
  }
  if (context && !hasRequiredMfa(context)) throw new PortalError('Complete multi-factor authentication.', 403)
  const workspace = context ? await readWorkspace(client) : null
  if (workspace && workspace.user.id !== user.id) throw new PortalError('The signed-in account changed.', 403)
  const scopes = workspace ? dashboardScopes(workspace) : []
  const chooseContext = query.mode === undefined && query.organisation === undefined && query.role === undefined && scopes.length > 1
  const applicant = query.mode === 'applicant' || !workspace || chooseContext || (scopes.length === 0 && query.organisation === undefined && query.role === undefined)
  if (query.mode !== undefined && query.mode !== 'applicant') throw new PortalError('Invalid operating context.', 403)
  if (applicant && (query.organisation !== undefined || query.role !== undefined)) throw new PortalError('No active role assignment is available.', 403)
  const scope = !applicant && workspace ? selectDashboardScope(workspace, query) : null
  if (!applicant && !scope) throw new PortalError('This role or organisation is not assigned to you.', 403)
  const operatingContext: PortalOperatingContext = scope ? { mode: 'ROLE', organisationId: scope.organisationId, role: scope.role } : APPLICANT_CONTEXT
  // The guarded shared entry reader supplies environment capability. A selected
  // staff role does not bypass live suspension/recovery or the MAIN admission seal.
  const entry = await readEntry(client)
  if (query.application !== undefined && (!applicant || !selectEntryApplication(entry, query.application))) throw new PortalError('This application is not available to your signed-in account.', 403)
  let portal: PortalPageData | undefined
  if (customerScopedReadAvailable(entry, release.environment)) {
    try {
      portal = await readPortal(client, operatingContext)
      if (portal.user.id !== user.id) throw new PortalError('The signed-in account changed.', 403)
    } catch (error) {
      // Never turn a revoked/held applicant or native session into dashboard access.
      if (!(error instanceof PortalError) || error.status !== 503 || (!workspace && !entry)) throw error
    }
  }
  if (context && !await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
  if (applicant) {
    if (!entry) throw new PortalError('Your application context is unavailable.', 503)
    return { kind: 'applicant' as const, entry, chooseContext, portal, release, operatingContext, scopes }
  }
  if (!workspace || !scope) throw new PortalError('No active role assignment is available.', 403)
  return { kind: 'role' as const, user: workspace.user, release, scope, operatingContext, portal, scopes: dashboardScopes(workspace), ...dashboardProjection(scope, release.environment, portal?.snapshot) }
}
