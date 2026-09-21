import 'server-only'
import { platformRelease } from '@/lib/platform-release'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser, readWorkspace } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { isDemoEnvironment } from '@/lib/testnet-fund/contracts'
import { dashboardProjection, dashboardScopes, selectDashboardScope, type DashboardQuery } from './dashboard'
import { PortalError, readPortal } from './server'
import type { PortalPageData } from './contracts'

export async function loadRoleDashboard(query: DashboardQuery) {
  const release = platformRelease(process.env)
  if (!release) throw new PortalError('The platform environment is not configured.', 503)
  const client = await createPageSupabaseClient()
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in to continue.', 401)
  const context = await readMfaContext(client)
  if (context && !hasRequiredMfa(context)) throw new PortalError('Complete multi-factor authentication.', 403)
  const workspace = context ? await readWorkspace(client) : null
  let portal: PortalPageData | undefined
  if (release.environment === 'TESTNET' && isDemoEnvironment(process.env)) {
    try {
      portal = await readPortal(client)
      if (portal.user.id !== user.id) throw new PortalError('The signed-in account changed.', 403)
    } catch (error) {
      // Never turn a revoked/held applicant or native session into dashboard access.
      if (!(error instanceof PortalError) || error.status !== 503 || !workspace) throw error
    }
  }
  if (context && !await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
  if (!workspace) {
    if (portal && query.organisation === undefined && query.role === undefined) return { kind: 'applicant' as const, portal, release }
    throw new PortalError('No active role assignment is available.', 403)
  }
  if (workspace.user.id !== user.id) throw new PortalError('The signed-in account changed.', 403)
  const scope = selectDashboardScope(workspace, query)
  if (!scope) throw new PortalError('This role or organisation is not assigned to you.', 403)
  return { kind: 'role' as const, user: workspace.user, release, scope, scopes: dashboardScopes(workspace), ...dashboardProjection(scope, release.environment, portal?.snapshot) }
}
