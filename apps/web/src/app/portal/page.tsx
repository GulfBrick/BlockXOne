import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PortalShell } from '@/components/portal/portal-shell'
import { PortalScreen } from '@/components/portal/portal-screens'
import { RoleDashboardContent } from '@/components/portal/role-dashboard'
import { loadRoleDashboard } from '@/lib/portal/dashboard-server'
import { dashboardScopeHref, type DashboardQuery } from '@/lib/portal/dashboard'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { PortalError } from '@/lib/portal/server'
import styles from '@/components/portal/portal.module.css'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your dashboard', robots: { index: false, follow: false } }
export default async function Page({ searchParams }: { searchParams: Promise<DashboardQuery> }) {
  let data: Awaited<ReturnType<typeof loadRoleDashboard>> | undefined
  let status = 503
  try { data = await loadRoleDashboard(await searchParams) } catch (error) { if (error instanceof PortalError) status = error.status }
  if (!data && status === 401) redirect('/login')
  if (!data) return <div className={styles.portal} style={{ display: 'block' }}><main className={styles.content}><h1 className={styles.title}>{status === 403 ? 'Dashboard access needs attention' : 'Dashboard temporarily unavailable'}</h1><p className={styles.subtitle}>{status === 403 ? 'Complete required sign-in security and use an assigned role and organisation. No additional permissions have been granted.' : 'Your saved data has not been changed. Try again when the hosted service is available.'}</p><div className={`${styles.actions} ${styles.sectionGap}`}><Link href={status === 403 ? '/login/mfa' : '/portal'} className={styles.button}>{status === 403 ? 'Check sign-in security' : 'Try again'}</Link><Link href="/workspace" className={styles.buttonSecondary}>Account and wallet settings</Link><Link href="/portal" className={styles.textLink}>Use my assigned dashboard</Link></div></main></div>
  if (data.kind === 'applicant') return <PortalScreen data={data.portal} view="/portal" />
  const dashboard = getRoleDashboard(data.scope.role)!
  return <PortalShell user={data.user} organisationName={data.scope.organisationName} capabilities={{ manageProducts: data.availablePaths.includes('/portal/products'), reviewCompliance: data.availablePaths.includes('/portal/compliance'), invest: data.availablePaths.includes('/portal/opportunities') }} active="overview" title={dashboard.title} description={dashboard.description} eyebrow="Your role workspace" release={data.release} onboardingAvailable={data.availablePaths.includes('/portal/onboarding')}>
    <nav aria-label="Assigned role and organisation" className={`${styles.scopeSelector} ${styles.sectionGap}`}><p>Working as <strong>{dashboard.title}</strong> in <strong>{data.scope.organisationName}</strong></p><div className={styles.actions}>{data.scopes.map(scope => <Link key={`${scope.organisationId}-${scope.role}`} href={dashboardScopeHref(scope)} className={styles.buttonSecondary} aria-current={scope.organisationId === data.scope.organisationId && scope.role === data.scope.role ? 'page' : undefined}>{scope.organisationName} · {getRoleDashboard(scope.role)!.title}</Link>)}</div><p>Only your active assignments are listed. Organisation access and signing authority remain separate.</p></nav>
    <RoleDashboardContent dashboard={dashboard} environment={data.release.environment} organisationName={data.scope.organisationName} availablePaths={data.availablePaths} queue={data.queue} queueMessage={data.queueMessage} destinations={{ '/workspace/administration': `/workspace/administration?organisation=${encodeURIComponent(data.scope.organisationId)}` }} />
  </PortalShell>
}
