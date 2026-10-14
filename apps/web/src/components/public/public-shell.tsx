import Link from 'next/link'

import { BrandLockup } from '@/components/brand/brand-mark'
import { isPortalAccessAdvertised } from '@/lib/release-policy'
import { platformRelease } from '@/lib/platform-release'
import homepageStyles from '@/app/homepage-v4.module.css'
import { PublicMotion } from './public-motion'
import { PublicNavigation } from './public-navigation'

export function PublicShell({
  children,
  topBar,
  variant = 'default',
}: {
  children: React.ReactNode
  topBar?: React.ReactNode
  variant?: 'default' | 'homepage'
}) {
  const showPortalAccess = isPortalAccessAdvertised()
  const environment = platformRelease(process.env)?.environment
  const brandLink = (
    <Link
      href="/"
      aria-label="BlockXOne home"
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary"
      data-bxo-nav-brand
    >
      <BrandLockup presentation="navigation" priority />
    </Link>
  )

  return (
    <div className={variant === 'homepage' ? `bxo-public-shell ${homepageStyles.homeShell}` : 'bxo-public-shell'}>
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 bg-bxo-accent-primary px-4 py-3 font-semibold text-bxo-on-accent transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <PublicMotion>
        {topBar ? <div className="sticky top-0 z-40">{topBar}</div> : null}
        <header
          className={`${topBar ? 'relative' : 'sticky top-0'} bxo-public-header ${homepageStyles.homeHeader} z-30 border-b border-bxo-border-subtle`}
          data-bxo-public-header
        >
          <div className="mx-auto flex min-h-16 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className={homepageStyles.homeBrand}>
              {brandLink}
            </div>

            <PublicNavigation showPortalAccess={showPortalAccess} environment={environment} variant={variant} />
          </div>
        </header>

        <div className={variant === 'default' ? 'bxo-content-light' : undefined} data-bxo-page-content>
          {children}
        </div>

          <footer className={`bxo-public-footer ${homepageStyles.homeFooter} border-t border-bxo-border-subtle`} data-bxo-footer>
            <div className={homepageStyles.container}>
              <div className={homepageStyles.footerGrid}>
                <div className={homepageStyles.footerBrand} data-bxo-footer-column><BrandLockup presentation="navigation" /><p>Private-market infrastructure.</p></div>
                <nav className={homepageStyles.footerNav} aria-labelledby="footer-platform-title" data-bxo-footer-column><h2 id="footer-platform-title">Platform</h2><Link href="/how-it-works">Workflow</Link><Link href="/asset-classes">Asset classes</Link><Link href="/security-and-compliance">Security</Link></nav>
                <nav className={homepageStyles.footerNav} aria-labelledby="footer-participants-title" data-bxo-footer-column><h2 id="footer-participants-title">Participants</h2><Link href="/for-operators">Institutions</Link><Link href="/for-investors">Investors</Link></nav>
                <nav className={homepageStyles.footerNav} aria-labelledby="footer-access-title" data-bxo-footer-column><h2 id="footer-access-title">Access</h2><Link href="/faq">FAQ</Link><Link href="/request-demo">Contact</Link>{showPortalAccess ? <Link href="/login">Sign in</Link> : null}{environment ? <Link href="/register">Register</Link> : null}</nav>
              </div>
              <div className={homepageStyles.footerMeta} data-bxo-footer-meta><span>BlockXOne</span><span>Fictional examples, not investment offers.</span></div>
            </div>
          </footer>
      </PublicMotion>
    </div>
  )
}
