'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Button } from './button'
import { BrandLockup } from '@/components/brand/brand-mark'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context-v2'
import { getDefaultRouteForRoles } from '@/lib/role-routing'
import { WalletWidget } from '@/components/wallet/WalletWidget'

const INVESTOR_ROUTES = [
  { path: '/investor/market', label: 'Marketplace' },
  { path: '/investor/portfolio', label: 'Portfolio' },
  { path: '/investor/p2p', label: 'P2P Trading' },
  { path: '/investor/orders', label: 'Orders' },
  { path: '/investor/kyc', label: 'KYC' },
]

const WM_ROUTES = [
  { path: '/wm', label: 'Dashboard' },
  { path: '/wm/funds', label: 'Funds' },
  { path: '/wm/ledger', label: 'Ledger' },
  { path: '/wm/investors', label: 'Investors' },
  { path: '/wm/reports', label: 'Reports' },
]

const COMPLIANCE_ROUTES = [
  { path: '/compliance', label: 'KYC Queue' },
  { path: '/compliance/rules', label: 'Rules' },
  { path: '/compliance/audit', label: 'Audit Logs' },
]

const ISSUER_ROUTES = [
  { path: '/issuer', label: 'Issuer Desk' },
  { path: '/wm/funds', label: 'Fund Setup' },
  { path: '/wm/reports', label: 'Reports' },
]

const ADMIN_ROUTES = [
  { path: '/admin', label: 'Overview' },
  { path: '/admin/roles', label: 'Roles' },
  { path: '/admin/features', label: 'Features' },
]

const TOKEN_AGENT_ROUTES = [
  { path: '/tokenisation-agent', label: 'Overview' },
  { path: '/tokenisation-agent/whitelist', label: 'Whitelist' },
  { path: '/tokenisation-agent/mint', label: 'Mint' },
  { path: '/tokenisation-agent/burn', label: 'Burn' },
]

export function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)

  const walletAllowed = useMemo(() => {
    if (!user) return false
    const roles = user.roles || []
    const allowed = ['Investor', 'OfferingManager', 'IssuerFundManager', 'TokenisationAgent', 'SuperAdmin']
    return roles.some((r) => allowed.includes(r))
  }, [user])

  const getRoutes = () => {
    if (pathname.startsWith('/investor')) return INVESTOR_ROUTES
    if (pathname.startsWith('/wm')) return WM_ROUTES
    if (pathname.startsWith('/compliance')) return COMPLIANCE_ROUTES
    if (pathname.startsWith('/issuer')) return ISSUER_ROUTES
    if (pathname.startsWith('/admin')) return ADMIN_ROUTES
    if (pathname.startsWith('/tokenisation-agent')) return TOKEN_AGENT_ROUTES
    return []
  }

  const routes = getRoutes()
  const isInvestorSurface = pathname.startsWith('/investor')
  const switchPortalHref = isInvestorSurface ? '/operator/login' : '/investor/login'
  const switchPortalLabel = isInvestorSurface ? 'Operator portal' : 'Investor portal'
  const settingsHref = isInvestorSurface ? '/investor/portfolio' : pathname.startsWith('/admin') ? '/admin' : '/'
  const logoutHref = isInvestorSurface ? '/investor/login' : '/operator/login'
  const isAuthPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/investor/login' ||
    pathname === '/investor/register' ||
    pathname === '/operator/login'

  if (isAuthPage) return null

  const handleLogout = () => {
    logout()
    setAccountMenuOpen(false)
    router.push(logoutHref)
  }

  return (
    <nav className="sticky top-0 z-50 glass-surface border-b border-bxo-border-subtle">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link
            href="/"
            aria-label="BlockXOne home"
            className="flex min-h-11 items-center rounded-lg transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bxo-bg-primary"
          >
            <BrandLockup
              compact
              markSize="sm"
              priority
              className="max-w-[11rem] sm:max-w-none"
            />
          </Link>

          {routes.length > 0 && (
            <div className="hidden md:flex items-center gap-1">
              {routes.map((route) => {
                const isActive = pathname === route.path
                return (
                  <Link key={route.path} href={route.path} className="relative">
                    <button
                      className={cn(
                        'px-4 py-2 text-sm font-medium transition-colors rounded-lg',
                        isActive
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {route.label}
                      {isActive && (
                        <motion.div
                          layoutId="navbar-active"
                          className="absolute inset-0 bg-primary/10 rounded-lg -z-10"
                          transition={{ duration: 0.2 }}
                        />
                      )}
                    </button>
                  </Link>
                )
              })}
            </div>
          )}

          <div className="flex items-center gap-3">
            {walletAllowed ? <WalletWidget /> : (
              <div className="text-xs text-muted-foreground hidden lg:block">
                Login with Investor/Fund/Token agent/SuperAdmin to link MetaMask
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="Notifications"
              className="hover-elevate press-compress"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </Button>

            <div className="relative">
              <Button 
                variant="ghost" 
                size="sm" 
                className="hover-elevate press-compress flex items-center gap-2"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                aria-controls="account-navigation"
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <span className="hidden lg:inline text-sm">Account</span>
              </Button>

              {accountMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  id="account-navigation"
                  role="menu"
                  className="absolute right-0 mt-2 w-48 glass-surface rounded-xl p-2 shadow-xl border border-bxo-border-default"
                >
                  <Link 
                    href={switchPortalHref}
                    role="menuitem"
                    className="block rounded-lg px-4 py-2 text-sm transition-colors hover:bg-bxo-accent-soft"
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    {switchPortalLabel}
                  </Link>
                  <Link 
                    href={user ? getDefaultRouteForRoles(user.roles) : settingsHref}
                    role="menuitem"
                    className="block rounded-lg px-4 py-2 text-sm transition-colors hover:bg-bxo-accent-soft"
                    onClick={() => setAccountMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <div className="my-2 border-t border-bxo-border-subtle"></div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    role="menuitem"
                    className="block w-full rounded-lg px-4 py-2 text-left text-sm text-bxo-danger transition-colors hover:bg-bxo-danger/10"
                  >
                    Logout
                  </button>
                </motion.div>
              )}
            </div>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-bxo-text-secondary transition-[color,background-color,transform] duration-200 hover:bg-bxo-surface-elevated hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary md:hidden"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {mobileMenuOpen && routes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            id="mobile-navigation"
            className="border-t border-bxo-border-subtle py-4 md:hidden"
          >
            {routes.map((route) => (
              <Link
                key={route.path}
                href={route.path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'block px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                  pathname === route.path
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:bg-bxo-surface-elevated hover:text-foreground'
                )}
              >
                {route.label}
              </Link>
            ))}
          </motion.div>
        )}
      </div>
    </nav>
  )
}
