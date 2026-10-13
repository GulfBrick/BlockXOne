import 'server-only'
import { platformRelease } from '@/lib/platform-release'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readVerifiedUser, readWorkspace } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { testOrdinaryEntryMfaPaused } from '@/lib/supabase/test-ordinary-entry'
import { dashboardProjection, dashboardScopes, selectDashboardScope, type DashboardQuery } from './dashboard'
import { PackageReaderUnavailable, PortalError, readPortal } from './server'
import type { PortalPageData } from './contracts'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import { readEntry } from './entry-server'
import { selectEntryApplication } from './entry-contracts'
import { customerScopedReadAvailable } from './customer-handoff'
import { validatedStage2Access } from './stage2-access'
import { validatedOfferingAccess } from './offering-access'

export async function loadRoleDashboard(query: DashboardQuery) {
  const release = platformRelease(process.env)
  if (!release) throw new PortalError('The platform environment is not configured.', 503)
  const client = await createPageSupabaseClient()
  const user = await readVerifiedUser(client)
  if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in to continue.', 401)
  const context = await readMfaContext(client)
  if (context && testOrdinaryEntryMfaPaused(process.env)) {
    const entry = await readEntry(client)
    if (entry.actor.id !== user.id) throw new PortalError('The signed-in account changed.', 403)
    const scopes = entry.contexts.flatMap(item => item.roles.map(role => ({ organisationId: item.organisation_id, organisationName: item.name, role })))
    const chooseContext = query.mode === undefined && query.organisation === undefined && query.role === undefined && scopes.length > 1
    const applicant = query.mode === 'applicant' || chooseContext || (scopes.length === 0 && query.organisation === undefined && query.role === undefined)
    if (query.mode !== undefined && query.mode !== 'applicant') throw new PortalError('Invalid operating context.', 403)
    if (applicant && (query.organisation !== undefined || query.role !== undefined)) throw new PortalError('No active role assignment is available.', 403)
    const scope = applicant ? null : query.organisation === undefined && query.role === undefined
      ? scopes.length === 1 ? scopes[0] : null
      : typeof query.organisation === 'string' && typeof query.role === 'string'
        ? scopes.find(item => item.organisationId === query.organisation && item.role === query.role) ?? null : null
    if (!applicant && !scope) throw new PortalError('This role or organisation is not assigned to you.', 403)
    if (query.application !== undefined && (!applicant || !selectEntryApplication(entry, query.application))) throw new PortalError('This application is not available to your signed-in account.', 403)
    const operatingContext: PortalOperatingContext = scope ? { mode: 'ROLE', organisationId: scope.organisationId, role: scope.role } : APPLICANT_CONTEXT
    const packageScope = scope && ['OfferingManager', 'IssuerFundManager'].includes(scope.role)
      && (entry.stage2_access?.session_mode === 'TEST_PASSWORD' || !hasRequiredMfa(context))
    const ordinaryPackageEntry = async () => {
      if (!packageScope || !scope) throw new PortalError('This package context is unavailable.', 403)
      const refreshed = await readEntry(client)
      const refreshedScopes = refreshed.contexts.flatMap(item => item.roles.map(role => ({ organisationId: item.organisation_id, organisationName: item.name, role })))
      const refreshedScope = refreshedScopes.find(item => item.organisationId === scope.organisationId && item.role === scope.role)
      if (refreshed.actor.id !== user.id || !refreshedScope || !await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
      return { kind: 'ordinary-entry' as const, entry: refreshed, user: refreshed.actor, release, scopes: refreshedScopes, scope: refreshedScope, chooseContext: false, operatingContext, portal: undefined }
    }
    if (scope && !['ComplianceOfficer', 'SuperAdmin'].includes(scope.role) && !packageScope && (entry.stage2_access?.session_mode === 'TEST_PASSWORD' || !hasRequiredMfa(context))) {
      if (!await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
      return { kind: 'ordinary-entry' as const, entry, user: entry.actor, release, scopes, scope, chooseContext, operatingContext, portal: undefined }
    }
    let portal: PortalPageData
    try { portal = await readPortal(client, operatingContext) }
    catch (error) {
      if (!(error instanceof PackageReaderUnavailable) || !packageScope || !scope) throw error
      // An old reader shares this error with invalid context/session. Refresh
      // current guarded entry instead of assuming it is a deployment version.
      return ordinaryPackageEntry()
    }
    const offering = validatedOfferingAccess(portal.snapshot, operatingContext, release.environment)
    if (packageScope && portal.snapshot.offering_access === undefined) {
      if (portal.user.id !== user.id || portal.snapshot.stage2_access !== undefined
        && !validatedStage2Access(portal.snapshot, operatingContext, release.environment)) throw new PortalError('Complete sign-in again.', 403)
      return ordinaryPackageEntry()
    }
    const access = validatedStage2Access(portal.snapshot, operatingContext, release.environment)
    if (portal.user.id !== user.id || (packageScope ? !offering : !access)
      || portal.snapshot.stage2_access !== undefined && !access || !await isMfaContextCurrent(client, context)) throw new PortalError('Complete sign-in again.', 403)
    if (applicant) return { kind: 'applicant' as const, entry, chooseContext, portal, release, operatingContext, scopes }
    if (!scope) throw new PortalError('No active role assignment is available.', 403)
    return { kind: 'role' as const, user: entry.actor, release, scope, operatingContext, portal, scopes, ...dashboardProjection(scope, release.environment, portal.snapshot) }
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
