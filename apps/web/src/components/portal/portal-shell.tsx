import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { PLATFORM_VERSION, type PlatformRelease } from '@/lib/platform-release'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { ArrowUpRight, BriefcaseBusiness, Building2, CircleUserRound, LayoutDashboard, ShieldCheck, WalletCards } from 'lucide-react'
import styles from './portal.module.css'

export type PortalNavigationCapabilities = { manageProducts: boolean; reviewCompliance: boolean; invest: boolean }
export type PortalNavigationKey = 'overview' | 'onboarding' | 'products' | 'compliance' | 'opportunities' | 'portfolio'
export function portalNavigation(capabilities: PortalNavigationCapabilities, onboardingAvailable = true) {
  return [
    { key: 'overview', label: 'Overview', href: '/portal', icon: LayoutDashboard },
    ...(onboardingAvailable ? [{ key: 'onboarding', label: 'My onboarding', href: '/portal/onboarding', icon: CircleUserRound }] : []),
    ...(capabilities.manageProducts ? [{ key: 'products', label: 'Products & offerings', href: '/portal/products', icon: Building2 }] : []),
    ...(capabilities.reviewCompliance ? [{ key: 'compliance', label: 'Compliance queue', href: '/portal/compliance', icon: ShieldCheck }] : []),
    ...(capabilities.invest ? [{ key: 'opportunities', label: 'Investment opportunities', href: '/portal/opportunities', icon: BriefcaseBusiness }, { key: 'portfolio', label: 'My portfolio', href: '/portal/portfolio', icon: WalletCards }] : []),
  ]
}

export function PortalShell({ user, organisationName, capacityName, capabilities, active, title, description, eyebrow, breadcrumbs = [], actions, children, release, onboardingAvailable = true, operatingContext }: {
  user: { id: string; email: string }; organisationName?: string; capacityName?: string; capabilities: PortalNavigationCapabilities; active: PortalNavigationKey;
  title: string; description?: string; eyebrow?: string; breadcrumbs?: { label: string; href?: string }[]; actions?: ReactNode; children: ReactNode; release?: PlatformRelease; onboardingAvailable?: boolean; operatingContext?: PortalOperatingContext;
}) {
  // Existing business screens are still explicitly TEST-only. Native dashboards
  // pass the verified deployment identity; this does not enable live settlement.
  const environment = release?.environment ?? 'TESTNET'
  const testnet = environment === 'TESTNET'
  const navigation = portalNavigation(capabilities, onboardingAvailable).map(item => ({ ...item, href: portalScopeHref(item.href, operatingContext) }))
  const links = <nav aria-label="Portal navigation" className={styles.nav}>{navigation.map(item => <Link key={item.key} href={item.href} className={styles.navLink} aria-current={active === item.key ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></Link>)}</nav>
  return <div className={styles.portal}>
    <a href="#portal-content" className={styles.skip}>Skip to main content</a>
    <aside className={styles.sidebar}>
      <Link href={portalScopeHref('/portal', operatingContext)} className={styles.brand} aria-label="BlockXOne portal home"><Image src="/brand/blockxone-lockup-horizontal.png" alt="BlockXOne" width={236} height={48} className={styles.brandArtwork} priority /></Link>
      <p className={styles.sidebarCaption}>Ownership, reimagined</p>
      {links}
      <details className={styles.mobileNav}><summary>Navigate your workspace</summary>{links}<nav aria-label="Account navigation" className={styles.nav}><Link href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security<ArrowUpRight aria-hidden="true" /></Link><Link href="/workspace" className={styles.navLink}>Account workspace<ArrowUpRight aria-hidden="true" /></Link></nav></details>
      <p className={styles.navRestricted}>Workspace tools reflect your assigned access. Signing authority is managed separately.</p>
      <div className={styles.sidebarFoot}>
        <div className={styles.environmentCard}><strong>{testnet ? 'Testnet · Rehearsal environment' : 'Mainnet · Live environment'}</strong><p>{testnet ? 'Fictional products and synthetic settlement. Test tokens have no investment value.' : 'Real-world operations require their own approved mandates, providers and production admission.'}</p><p>Version {release?.version ?? PLATFORM_VERSION}{release ? ` · ${release.source}` : ''}</p></div>
        <Link href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security<ArrowUpRight aria-hidden="true" /></Link>
        <Link href="/workspace" className={styles.navLink}>Account workspace<ArrowUpRight aria-hidden="true" /></Link>
      </div>
    </aside>
    <div className={styles.frame}>
      <header className={styles.topbar}>
        <div className={styles.topbarContext}><strong>{organisationName || 'Your BlockXOne account'}</strong><span>Active capacity: {capacityName ?? (operatingContext?.mode === 'ROLE' ? operatingContext.role : 'Personal / applicant')}</span><Link href="/portal?mode=applicant">Change capacity</Link></div>
        <div className={styles.userArea}><span className={styles.environmentPill}>{testnet ? 'Testnet' : 'Mainnet'} environment</span><span className={styles.userEmail}>{user.email}</span><form action="/auth/logout" method="post"><button className={styles.buttonSecondary} type="submit">Sign out</button></form></div>
      </header>
      <main id="portal-content" tabIndex={-1} className={styles.content}>
        <nav aria-label="Breadcrumb"><ol className={styles.breadcrumbs}><li><Link href={portalScopeHref('/portal', operatingContext)}>Portal</Link></li>{breadcrumbs.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <Link href={portalScopeHref(item.href, operatingContext)}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>
        <div className={styles.pageHeading}><div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h1 className={styles.title}>{title}</h1>{description ? <p className={styles.subtitle}>{description}</p> : null}</div>{actions ? <div className={styles.actions}>{actions}</div> : null}</div>
        {children}
        <footer className={styles.boundary}><span>BlockXOne · Multi-asset tokenisation · {release?.version ?? PLATFORM_VERSION}</span><span>{testnet ? 'Fictional data only · Synthetic cash is not a bank balance' : 'Dashboard access is not approval to move funds or issue tokens'}</span></footer>
      </main>
    </div>
  </div>
}
