import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { PortalError, requirePortalEnvironment } from '@/lib/portal/server'
import { loadRoleDashboard } from '@/lib/portal/dashboard-server'
import { dashboardScopeHref, type DashboardQuery } from '@/lib/portal/dashboard'
import { portalContextKey, portalOperatingContextSchema, portalScopeHref, portalViewAllowed } from '@/lib/portal/operating-context'
import { parseSyntheticComplianceSnapshot } from '@/lib/portal/synthetic-compliance-contracts'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import type { PortalPath } from '@/lib/portal/contracts'
import { PortalScreen } from './portal-screens'
import { PortalShell } from './portal-shell'
import { RoleDashboardContent } from './role-dashboard'
import { EntryScreen } from './entry-screen'
import styles from './portal.module.css'

export async function PortalPage({ view, id, query = {} }: { view: PortalPath; id?: string; query?: DashboardQuery }) {
  let data: Awaited<ReturnType<typeof loadRoleDashboard>> | null = null
  let status = 503
  let ordinaryStepUpRequired = false
  try {
    // Business providers are admitted explicitly; both releases share this shell.
    if (view !== '/portal' && view !== '/portal/onboarding') requirePortalEnvironment()
    // Onboarding is always the caller's application workspace, not the selected
    // staff role's client queue. Existing scoped staff dashboards stay separate.
    data = await loadRoleDashboard(view === '/portal/onboarding' ? { ...query, mode: 'applicant', organisation: undefined, role: undefined } : query)
    if (data.kind === 'synthetic-compliance' && (!data.portal || data.release.environment !== 'TESTNET' || data.portal.user.id !== data.user.id
      || !parseSyntheticComplianceSnapshot(data.portal.snapshot, data.user.id, data.operatingContext))) throw new PortalError('The synthetic review context could not be verified.', 503)
    if (data.kind === 'ordinary-entry' && view !== '/portal' && view !== '/portal/onboarding') {
      ordinaryStepUpRequired = true
      throw new PortalError('Complete authenticator verification before opening protected operations.', 403)
    }
    if (data.portal && !portalViewAllowed(view, data.operatingContext, data.portal.snapshot, id)) throw new PortalError('This action is not available in your selected context.', 403)
    if (!data.portal && view !== '/portal' && view !== '/portal/onboarding') throw new PortalError('Saved portal state is unavailable.', 503)
  } catch (error) { data = null; if (error instanceof PortalError) status = error.status }
  if (!data && status === 404) notFound()
  if (!data && status === 401) redirect('/login')
  if (data?.kind === 'ordinary-entry') return <PortalShell user={data.user} organisationName={data.scope?.organisationName} capacityName={data.scope ? getRoleDashboard(data.scope.role)!.title : 'Personal / applicant'} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} active="overview" title={data.scope ? getRoleDashboard(data.scope.role)!.title : 'Your BlockXOne capacities.'} description="Temporary read-only Testnet entry. Your saved identity and assigned capacity labels are available; protected operations remain locked." release={data.release} operatingContext={data.operatingContext} onboardingAvailable={false}>
    <section className={`${styles.panel} ${styles.sectionGap}`} aria-labelledby="test-entry-pause"><div className={styles.panelHeader}><h2 id="test-entry-pause">Authenticator paused for ordinary Testnet entry</h2></div><div className={styles.panelBody}><p role="status">Your existing authenticator has not been removed. Compliance evidence, approvals, account changes, wallet actions and financial operations still require the original security checks.</p></div></section>
    <nav aria-label="Your assigned capacities" className={`${styles.scopeSelector} ${styles.sectionGap}`}><p>Choose one of your existing capacities. Selecting a label does not grant authority.</p><div className={styles.actions}><Link href="/portal?mode=applicant" className={styles.buttonSecondary}>Personal applications</Link>{data.scopes.map(scope => <Link key={`${scope.organisationId}-${scope.role}`} href={dashboardScopeHref(scope)} className={styles.buttonSecondary}>{scope.organisationName} · {getRoleDashboard(scope.role)!.title}</Link>)}</div></nav>
    <section className={`${styles.panel} ${styles.sectionGap}`} aria-labelledby="test-entry-applications"><div className={styles.panelHeader}><h2 id="test-entry-applications">My application status</h2></div><div className={styles.panelBody}>{data.entry.applications.length ? <ul>{data.entry.applications.map(application => <li key={application.id}><strong>{application.persona === 'INVESTOR' ? 'Investor' : 'Wealth manager'}</strong> · {application.status.replaceAll('_', ' ').toLowerCase()} · Revision {application.revision}<p>Reference {application.id}</p></li>)}</ul> : <p>No application is recorded for this login. Read-only entry does not create or approve one.</p>}</div></section>
  </PortalShell>
  if (data?.kind === 'applicant' && (view === '/portal' || view === '/portal/onboarding')) return <EntryScreen key={`${data.entry.actor.id}:${data.release.environment}:${String(query.application ?? '')}:${String(query.add ?? '')}`} initial={data.entry} release={data.release} applicationId={typeof query.application === 'string' ? query.application : undefined} addCapacity={query.add === 'capacity'} chooseContext={data.chooseContext} operationsAvailable={Boolean(data.portal)} />
  if (data?.portal) return <PortalScreen key={`${data.portal.user.id}:${data.release.environment}:${portalContextKey(data.operatingContext)}:${view}:${id ?? ''}`} data={data.portal} view={view} id={id} operatingContext={data.operatingContext} release={data.release} scope={data.kind === 'role' || data.kind === 'synthetic-compliance' ? data.scope : undefined} scopes={data.scopes} />
  if (data?.kind === 'role') {
    const dashboard = getRoleDashboard(data.scope.role)!
    return <PortalShell user={data.user} organisationName={data.scope.organisationName} capabilities={{ manageProducts: false, reviewCompliance: false, invest: false }} active="overview" title={dashboard.title} description={data.queueMessage} release={data.release} operatingContext={data.operatingContext} onboardingAvailable={false}>
      <nav aria-label="Assigned role and organisation" className={`${styles.scopeSelector} ${styles.sectionGap}`}><p>Working as <strong>{dashboard.title}</strong> in <strong>{data.scope.organisationName}</strong></p><div className={styles.actions}>{data.scopes.map(scope => <Link key={`${scope.organisationId}-${scope.role}`} href={dashboardScopeHref(scope)} className={styles.buttonSecondary}>{scope.organisationName} · {getRoleDashboard(scope.role)!.title}</Link>)}</div></nav>
      <p role="status">Operational records are unavailable in this context. No balances or completed investments have been inferred.</p>
      <details className={styles.sectionGap}><summary>Role responsibilities and access guidance</summary><RoleDashboardContent dashboard={dashboard} environment={data.release.environment} organisationName={data.scope.organisationName} availablePaths={data.availablePaths} queue={data.queue} queueMessage={data.queueMessage} destinations={{ '/workspace/administration': `/workspace/administration?organisation=${encodeURIComponent(data.scope.organisationId)}` }} /></details>
    </PortalShell>
  }
  const retryContext = portalOperatingContextSchema.safeParse(query.mode === 'applicant' && query.organisation === undefined && query.role === undefined ? { mode: 'APPLICANT' } : query.mode === undefined ? { mode: 'ROLE', organisationId: query.organisation, role: query.role } : null)
  const retry = retryContext.success ? portalScopeHref(view, retryContext.data, id) : '/portal'
  return <div className={styles.portal} style={{ display: 'block' }}><main className={styles.content}><p className={styles.eyebrow}>BlockXOne / Client portal</p><h1 className={styles.title}>{ordinaryStepUpRequired ? 'Authenticator required for protected operations.' : status === 403 ? 'Complete your account access.' : 'Saved portal state is unavailable.'}</h1><p className={styles.subtitle}>{ordinaryStepUpRequired ? 'The temporary Testnet pause permits read-only entry only. Your existing authenticator has not been removed. Complete authenticator verification before opening Compliance evidence, approvals, account changes or financial operations; your assigned role and organisation are still checked separately.' : status === 403 ? 'Your selected role or organisation does not currently have access. Complete any required multi-factor authentication or use your assigned context. No new privileges have been assigned.' : 'The hosted platform could not load your saved records. Your existing applications and investments have not been changed.'}</p><div className={`${styles.actions} ${styles.sectionGap}`}><Link href={status === 403 ? '/login/mfa' : retry} className={styles.button}>{status === 403 ? 'Complete sign-in security' : 'Retry loading the portal'}</Link><Link href="/portal" className={styles.buttonSecondary}>Use my assigned dashboard</Link><Link href="/workspace" className={styles.buttonSecondary}>Return to account workspace</Link></div></main></div>
}
