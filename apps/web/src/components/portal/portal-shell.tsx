import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, BriefcaseBusiness, Building2, CircleUserRound, LayoutDashboard, ShieldCheck, WalletCards } from 'lucide-react'
import styles from './portal.module.css'

export type PortalNavigationCapabilities = { manageProducts: boolean; reviewCompliance: boolean; invest: boolean }
export type PortalNavigationKey = 'overview' | 'onboarding' | 'products' | 'compliance' | 'opportunities' | 'portfolio'
export function portalNavigation(capabilities: PortalNavigationCapabilities) {
  return [
    { key: 'overview', label: 'Overview', href: '/portal', icon: LayoutDashboard },
    { key: 'onboarding', label: 'My onboarding', href: '/portal/onboarding', icon: CircleUserRound },
    ...(capabilities.manageProducts ? [{ key: 'products', label: 'Products & offerings', href: '/portal/products', icon: Building2 }] : []),
    ...(capabilities.reviewCompliance ? [{ key: 'compliance', label: 'Compliance queue', href: '/portal/compliance', icon: ShieldCheck }] : []),
    ...(capabilities.invest ? [{ key: 'opportunities', label: 'Investment opportunities', href: '/portal/opportunities', icon: BriefcaseBusiness }, { key: 'portfolio', label: 'My portfolio', href: '/portal/portfolio', icon: WalletCards }] : []),
  ]
}

export function PortalShell({ user, organisationName, capabilities, active, title, description, eyebrow, breadcrumbs = [], actions, children }: {
  user: { id: string; email: string }; organisationName?: string; capabilities: PortalNavigationCapabilities; active: PortalNavigationKey;
  title: string; description?: string; eyebrow?: string; breadcrumbs?: { label: string; href?: string }[]; actions?: ReactNode; children: ReactNode;
}) {
  const navigation = portalNavigation(capabilities)
  const links = <nav aria-label="Portal navigation" className={styles.nav}>{navigation.map(item => <Link key={item.key} href={item.href} className={styles.navLink} aria-current={active === item.key ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></Link>)}</nav>
  return <div className={styles.portal}>
    <a href="#portal-content" className={styles.skip}>Skip to main content</a>
    <aside className={styles.sidebar}>
      <Link href="/portal" className={styles.brand} aria-label="BlockXOne portal home"><span className={styles.brandMark} aria-hidden="true">BX</span><span>Block<span>X</span>One</span></Link>
      <p className={styles.sidebarCaption}>Ownership, reimagined</p>
      {links}
      <details className={styles.mobileNav}><summary>Navigate your workspace</summary>{links}</details>
      <p className={styles.navRestricted}>Workspace tools reflect your assigned access. Signing authority is managed separately.</p>
      <div className={styles.sidebarFoot}>
        <div className={styles.environmentCard}><strong>Customer journey · Test environment</strong><p>Fictional products and synthetic settlement. No real investment or cash payment is available.</p></div>
        <Link href="/workspace/security" className={styles.navLink}><ShieldCheck aria-hidden="true" />Account security<ArrowUpRight aria-hidden="true" /></Link>
        <Link href="/workspace" className={styles.navLink}>Account workspace<ArrowUpRight aria-hidden="true" /></Link>
      </div>
    </aside>
    <div className={styles.frame}>
      <header className={styles.topbar}>
        <div className={styles.topbarContext}><strong>{organisationName || 'Your BlockXOne account'}</strong>Multi-asset investment infrastructure</div>
        <div className={styles.userArea}><span className={styles.environmentPill}>Testnet environment</span><span className={styles.userEmail}>{user.email}</span><span className={styles.userAvatar} aria-hidden="true">{user.email.slice(0, 2).toUpperCase()}</span></div>
      </header>
      <main id="portal-content" tabIndex={-1} className={styles.content}>
        <nav aria-label="Breadcrumb"><ol className={styles.breadcrumbs}><li><Link href="/portal">Portal</Link></li>{breadcrumbs.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>
        <div className={styles.pageHeading}><div>{eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}<h1 className={styles.title}>{title}</h1>{description ? <p className={styles.subtitle}>{description}</p> : null}</div>{actions ? <div className={styles.actions}>{actions}</div> : null}</div>
        {children}
        <footer className={styles.boundary}><span>BlockXOne · Multi-asset tokenisation</span><span>Fictional data only · Synthetic cash is not a bank balance · No production admission</span></footer>
      </main>
    </div>
  </div>
}
