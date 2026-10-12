import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { PLATFORM_VERSION, type PlatformRelease } from '@/lib/platform-release'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { getRoleDashboard } from '@/lib/portal/role-dashboards'
import { ArrowUpRight, BriefcaseBusiness, Building2, ChevronDown, CircleHelp, CircleUserRound, LayoutDashboard, ShieldCheck, WalletCards } from 'lucide-react'
import { applicantSectionHref, type ApplicantSection } from './applicant-presentation'
import styles from './portal.module.css'

export type PortalNavigationCapabilities = { manageProducts: boolean; reviewCompliance: boolean; invest: boolean }
export type PortalNavigationKey = 'overview' | 'onboarding' | 'products' | 'compliance' | 'opportunities' | 'portfolio'
export function portalNavigation(capabilities: PortalNavigationCapabilities, onboardingAvailable = true) {
  return [
    { key: 'overview', label: 'Overview', href: '/portal', icon: LayoutDashboard },
    ...(onboardingAvailable ? [{ key: 'onboarding', label: 'My applications', href: '/portal/onboarding', icon: CircleUserRound }] : []),
    ...(capabilities.manageProducts ? [{ key: 'products', label: 'Products & offerings', href: '/portal/products', icon: Building2 }] : []),
    ...(capabilities.reviewCompliance ? [{ key: 'compliance', label: 'Compliance queue', href: '/portal/compliance', icon: ShieldCheck }] : []),
    ...(capabilities.invest ? [{ key: 'opportunities', label: 'Investment opportunities', href: '/portal/opportunities', icon: BriefcaseBusiness }, { key: 'portfolio', label: 'My portfolio', href: '/portal/portfolio', icon: WalletCards }] : []),
  ]
}

export function PortalShell({ user, organisationName, capacityName, capabilities, active, title, description, eyebrow, breadcrumbs = [], actions, children, release, onboardingAvailable = true, operatingContext, applicantOnboarding = false, applicantSection }: {
  user: { id: string; email: string }; organisationName?: string; capacityName?: string; capabilities: PortalNavigationCapabilities; active: PortalNavigationKey;
  title: string; description?: string; eyebrow?: string; breadcrumbs?: { label: string; href?: string }[]; actions?: ReactNode; children: ReactNode; release?: PlatformRelease; onboardingAvailable?: boolean; operatingContext?: PortalOperatingContext; applicantOnboarding?: boolean; applicantSection?: ApplicantSection;
}) {
  // Existing business screens are still explicitly TEST-only. Native dashboards
  // pass the verified deployment identity; this does not enable live settlement.
  const environment = release?.environment ?? 'TESTNET'
  const testnet = environment === 'TESTNET'
  const compactApplicant = applicantOnboarding && operatingContext?.mode === 'APPLICANT'
  const navigation = portalNavigation(capabilities, onboardingAvailable).map(item => ({ ...item, href: item.key === 'onboarding' && operatingContext?.mode === 'ROLE' ? '/portal/onboarding?mode=applicant' : portalScopeHref(item.href, operatingContext) }))
  const applicantNavigation = [
    { key: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { key: 'applications' as const, label: 'My applications', icon: CircleUserRound },
    { key: 'workspaces' as const, label: 'Workspaces', icon: Building2 },
    { key: 'help' as const, label: 'Help', icon: CircleHelp },
  ]
  const workspaceLabel = capacityName ?? (operatingContext?.mode === 'ROLE' ? getRoleDashboard(operatingContext.role)?.title.replace(/ dashboard$/, '') ?? operatingContext.role : 'Personal account')
  const links = <nav aria-label="Portal navigation" className={styles.nav}>{compactApplicant ? applicantNavigation.map(item => <Link key={item.key} href={applicantSectionHref(item.key)} className={styles.navLink} aria-current={(applicantSection ?? 'applications') === item.key ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></Link>) : navigation.map(item => <Link key={item.key} href={item.href} className={styles.navLink} aria-current={active === item.key ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></Link>)}</nav>
  const brand = <Link href={compactApplicant ? applicantSectionHref('overview') : portalScopeHref('/portal', operatingContext)} className={styles.brand} aria-label="BlockXOne portal home"><Image src="/brand/blockxone-lockup-horizontal.png" alt="BlockXOne" width={236} height={48} className={styles.brandArtwork} priority /></Link>
  return <div className={`${styles.portal}${compactApplicant ? ` ${styles.applicantOnboarding}` : ''}`} data-applicant-onboarding={compactApplicant ? 'true' : undefined} data-applicant-section={compactApplicant ? applicantSection : undefined}>
    <a href="#portal-content" className={styles.skip}>Skip to main content</a>
    <aside className={styles.sidebar}>
      {brand}
      <p className={styles.sidebarCaption}>Ownership, reimagined</p>
      {links}
      {!compactApplicant ? <details className={styles.mobileNav}><summary>Navigate your workspace</summary>{links}<nav aria-label="Account navigation" className={styles.nav}><a href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security<ArrowUpRight aria-hidden="true" /></a><a href="/workspace" className={styles.navLink}>Account workspace<ArrowUpRight aria-hidden="true" /></a></nav></details> : null}
      <p className={styles.navRestricted}>Workspace tools reflect your assigned access. Signing authority is managed separately.</p>
      {!compactApplicant ? <div className={styles.sidebarFoot}>
        <div className={styles.environmentCard}><strong>{testnet ? 'Testnet · Test environment' : 'Mainnet · Live environment'}</strong><p>{testnet ? 'Fictional products and synthetic settlement. Test tokens have no investment value.' : 'Real-world operations require their own approved mandates, providers and production admission.'}</p><p>Version {release?.version ?? PLATFORM_VERSION}{release ? ` · ${release.source}` : ''}</p></div>
        <a href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security<ArrowUpRight aria-hidden="true" /></a>
        <a href="/workspace" className={styles.navLink}>Account workspace<ArrowUpRight aria-hidden="true" /></a>
      </div> : null}
    </aside>
    <div className={styles.frame}>
      <header className={styles.topbar}>
        {compactApplicant ? <>
          <div className={styles.mobileBrand}>{brand}</div>
          <Link href={applicantSectionHref('applications')} className={styles.applicationSwitchLink} aria-label="Switch application or workspace" title={`${organisationName || 'Personal account'} · ${workspaceLabel}`}><span className={styles.switcherWorkspaceLabel}>Current context: {organisationName || 'Personal account'} · {workspaceLabel}</span><span className={styles.switcherMobileLabel}>Applications</span><ChevronDown aria-hidden="true" /></Link>
          <details className={styles.accountMenu}><summary>Account</summary><div className={styles.accountMenuBody}>
            <p className={styles.accountEmail}>{user.email}</p>
            <nav aria-label="Account navigation" className={styles.nav}><a href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security</a><a href="/workspace" className={styles.navLink}>Account workspace</a><Link href="/register" className={styles.navLink}>Account options</Link></nav>
            <form action="/auth/logout" method="post"><button className={styles.buttonSecondary} type="submit">Sign out</button></form>
          </div></details>
        </> : <>
          <div className={styles.topbarContext}><strong>{organisationName || 'Your BlockXOne account'}</strong><span>Current workspace: {workspaceLabel}</span><Link href="/portal?mode=applicant">Switch application or workspace</Link></div>
          <div className={styles.userArea}><span className={styles.environmentPill}>{testnet ? 'Testnet' : 'Mainnet'} environment</span><span className={styles.userEmail}>{user.email}</span><form action="/auth/logout" method="post"><button className={styles.buttonSecondary} type="submit">Sign out</button></form></div>
        </>}
      </header>
      {compactApplicant ? <nav aria-label="Applicant sections on mobile" className={styles.applicantMobileNav}>{applicantNavigation.map(item => <Link key={item.key} href={applicantSectionHref(item.key)} aria-current={(applicantSection ?? 'applications') === item.key ? 'page' : undefined}>{item.label}</Link>)}</nav> : null}
      <main id="portal-content" tabIndex={-1} className={styles.content}>
        {compactApplicant ? <p className={styles.applicantNotice} role="note"><strong>{testnet ? 'TEST environment' : 'MAIN environment'}</strong><span>{testnet ? 'Fictional data only.' : 'Approved admission is required.'}</span></p> : <nav aria-label="Breadcrumb"><ol className={styles.breadcrumbs}><li><Link href={portalScopeHref('/portal', operatingContext)}>Portal</Link></li>{breadcrumbs.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <Link href={portalScopeHref(item.href, operatingContext)}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>}
        <div className={styles.pageHeading}><div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h1 className={styles.title}>{title}</h1>{description ? <p className={styles.subtitle}>{description}</p> : null}</div>{actions ? <div className={styles.actions}>{actions}</div> : null}</div>
        {children}
        {compactApplicant ? <footer className={styles.boundary}><span>BlockXOne · Multi-asset tokenisation</span><details className={styles.releaseDetails}><summary>Environment and release details</summary><p>{testnet ? 'Testnet · Test environment. Synthetic cash is not a bank balance.' : 'Mainnet · Live environment. Real-world operations require their own approved mandates, providers and production admission.'}</p><p>Version {release?.version ?? PLATFORM_VERSION}{release ? ` · Source ${release.source}` : ''}</p></details></footer> : <footer className={styles.boundary}><span>BlockXOne · Multi-asset tokenisation · {release?.version ?? PLATFORM_VERSION}</span><span>{testnet ? 'Fictional data only · Synthetic cash is not a bank balance' : 'Dashboard access is not approval to move funds or issue tokens'}</span></footer>}
      </main>
    </div>
  </div>
}
