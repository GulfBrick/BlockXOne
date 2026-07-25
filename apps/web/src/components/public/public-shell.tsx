import Link from 'next/link'

import { BrandLockup } from '@/components/brand/brand-mark'
import { Button } from '@/components/ui/button'

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/asset-classes', label: 'Asset classes' },
  { href: '/for-investors', label: 'For investors' },
  { href: '/for-operators', label: 'For operators' },
  { href: '/security-and-compliance', label: 'Security' },
]

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bxo-public-shell">
      <div className="bxo-grid-field" aria-hidden="true" />

      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-bxo-accent-primary px-4 py-3 font-semibold text-bxo-bg-primary transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-30 border-b border-bxo-border-subtle bg-bxo-bg-primary shadow-sm">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="BlockXOne home"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bxo-bg-primary"
          >
            <BrandLockup
              priority
              tagline="Multi-asset tokenization platform"
            />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-3 text-sm text-bxo-text-secondary transition-colors duration-base hover:bg-bxo-accent-soft hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center justify-end gap-2 sm:flex">
            <Button asChild variant="ghost" className="h-11 rounded-lg text-bxo-text-secondary hover:bg-bxo-accent-soft hover:text-bxo-text-primary">
              <Link href="/investor/login">Investor login</Link>
            </Button>
            <Button asChild variant="outline" className="bxo-secondary-cta h-11 rounded-lg">
              <Link href="/operator/login">Operator login</Link>
            </Button>
          </div>

          <details className="group relative sm:hidden">
            <summary className="bxo-secondary-cta flex min-h-11 cursor-pointer list-none items-center rounded-lg px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="bxo-panel absolute right-0 top-[calc(100%+0.5rem)] w-64 p-2">
              <nav aria-label="Mobile public navigation" className="grid gap-1">
                {NAV_LINKS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex min-h-11 items-center rounded-lg px-3 text-sm text-bxo-text-secondary transition-colors hover:bg-bxo-accent-soft hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="my-1 border-t border-bxo-border-subtle" />
                <Link
                  href="/investor/login"
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm text-bxo-text-secondary transition-colors hover:bg-bxo-accent-soft hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                >
                  Investor login
                </Link>
                <Link
                  href="/operator/login"
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-bxo-accent-primary transition-colors hover:bg-bxo-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                >
                  Operator login
                </Link>
              </nav>
            </div>
          </details>
        </div>
      </header>

      {children}

      <footer className="border-t border-bxo-border-subtle bg-bxo-bg-secondary">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_0.8fr_0.8fr] lg:px-8">
          <div className="space-y-4">
            <BrandLockup compact markSize="sm" priority />
            <p className="max-w-xl text-sm leading-6 text-bxo-text-tertiary">
              BlockXOne is being rebuilt as a multi-asset tokenization platform for regulated private-market assets,
              with separate public, investor, and operator experiences.
            </p>
          </div>

          <div className="space-y-3">
            <div className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Platform</div>
            <div className="grid gap-2 text-sm text-bxo-text-secondary">
              <Link href="/how-it-works" className="transition-colors hover:text-bxo-text-primary">How it works</Link>
              <Link href="/asset-classes" className="transition-colors hover:text-bxo-text-primary">Asset classes</Link>
              <Link href="/security-and-compliance" className="transition-colors hover:text-bxo-text-primary">Security</Link>
            </div>
          </div>

          <div className="space-y-3">
            <div className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Access</div>
            <div className="grid gap-2 text-sm text-bxo-text-secondary">
              <Link href="/investor/login" className="transition-colors hover:text-bxo-text-primary">Investor login</Link>
              <Link href="/operator/login" className="transition-colors hover:text-bxo-text-primary">Operator login</Link>
              <Link href="/request-demo" className="transition-colors hover:text-bxo-text-primary">Request demo</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
