import Link from 'next/link'

import { BrandLockup } from '@/components/brand/brand-mark'
import { isPortalAccessAdvertised } from '@/lib/release-policy'
import { platformRelease } from '@/lib/platform-release'
import { PublicMotion } from './public-motion'
import { PublicNavigation } from './public-navigation'

export function PublicShell({
  children,
  topBar,
}: {
  children: React.ReactNode
  topBar?: React.ReactNode
}) {
  const showPortalAccess = isPortalAccessAdvertised()
  const environment = platformRelease(process.env)?.environment

  return (
    <div className="bxo-public-shell">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 bg-bxo-accent-primary px-4 py-3 font-semibold text-bxo-bg-primary transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <PublicMotion>
        {topBar ? <div className="sticky top-0 z-40">{topBar}</div> : null}
        <header
          className={`${topBar ? 'relative' : 'sticky top-0'} bxo-public-header z-30 border-b border-bxo-border-subtle`}
          data-bxo-public-header
        >
          <div className="mx-auto flex min-h-20 max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link
              href="/"
              aria-label="BlockXOne home"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary"
              data-bxo-nav-brand
            >
              <BrandLockup presentation="navigation" priority />
            </Link>

            <PublicNavigation showPortalAccess={showPortalAccess} environment={environment} />
          </div>
        </header>

        {children}

        <footer className="bxo-public-footer border-t border-bxo-border-subtle" data-bxo-footer>
          <div className="mx-auto max-w-[90rem] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div
              className="grid gap-12 border-b border-bxo-border-subtle pb-12 lg:grid-cols-[1.35fr_0.65fr] lg:items-end lg:pb-16"
              data-bxo-footer-intro
            >
              <div>
                <BrandLockup />
                <p className="mt-5 max-w-3xl font-reading text-2xl leading-9 text-bxo-text-secondary sm:text-3xl sm:leading-10">
                  Digital ownership infrastructure for private markets.
                </p>
              </div>
              <p className="max-w-xl text-sm leading-7 text-bxo-text-tertiary lg:justify-self-end">
                Structure instruments, qualify investors, control settlement, issue tokens and preserve ownership evidence in one accountable platform.
              </p>
            </div>

            <div className="grid gap-10 py-10 sm:grid-cols-2 lg:grid-cols-[1fr_0.7fr_0.7fr_0.7fr]">
              <div className="bxo-editorial-index self-start" data-bxo-footer-column>
                <span>BXO</span>
                <span>Multi-asset tokenisation</span>
              </div>

              <nav className="space-y-3" aria-labelledby="footer-platform-title" data-bxo-footer-column>
                <h2 id="footer-platform-title" className="text-xs font-semibold uppercase tracking-[0.13em] text-bxo-text-tertiary">Platform</h2>
                <div className="grid gap-2 text-sm text-bxo-text-secondary">
                  <Link href="/how-it-works" className="bxo-footer-link">How it works</Link>
                  <Link href="/asset-classes" className="bxo-footer-link">Asset classes</Link>
                  <Link href="/security-and-compliance" className="bxo-footer-link">Security</Link>
                </div>
              </nav>

              <nav className="space-y-3" aria-labelledby="footer-participants-title" data-bxo-footer-column>
                <h2 id="footer-participants-title" className="text-xs font-semibold uppercase tracking-[0.13em] text-bxo-text-tertiary">Participants</h2>
                <div className="grid gap-2 text-sm text-bxo-text-secondary">
                  <Link href="/for-investors" className="bxo-footer-link">For investors</Link>
                  <Link href="/for-operators" className="bxo-footer-link">For institutions</Link>
                </div>
              </nav>

              <nav className="space-y-3" aria-labelledby="footer-access-title" data-bxo-footer-column>
                <h2 id="footer-access-title" className="text-xs font-semibold uppercase tracking-[0.13em] text-bxo-text-tertiary">Access</h2>
                <div className="grid gap-2 text-sm text-bxo-text-secondary">
                  {showPortalAccess ? <Link href="/login" className="bxo-footer-link">Sign in</Link> : null}
                  <Link href="/how-it-works" className="bxo-footer-link">Platform workflow</Link>
                </div>
              </nav>
            </div>

            <div
              className="flex flex-col gap-3 border-t border-bxo-border-subtle pt-6 text-xs text-bxo-text-tertiary sm:flex-row sm:items-center sm:justify-between"
              data-bxo-footer-meta
            >
              <span>BlockXOne</span>
              <span>Private-market infrastructure, built for accountable operation.</span>
            </div>
          </div>
        </footer>
      </PublicMotion>
    </div>
  )
}
