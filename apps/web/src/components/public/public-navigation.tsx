'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { animate, createScope, stagger } from 'animejs'

import { Button } from '@/components/ui/button'
import { BRANDED_ENTRY } from '@/lib/branded-entry'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { href: '/how-it-works', label: 'Platform' },
  { href: '/asset-classes', label: 'Asset classes' },
  { href: '/for-investors', label: 'Investors' },
  { href: '/for-operators', label: 'Institutions' },
  { href: '/security-and-compliance', label: 'Security' },
]

export function PublicNavigation({ showPortalAccess }: { showPortalAccess: boolean }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileOpen])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!mobileOpen || !menu) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let scope: ReturnType<typeof createScope> | undefined

    const restoreStaticMenu = () => {
      menu.style.opacity = '1'
      menu.style.transform = 'none'
      menu.querySelectorAll<HTMLElement>('[data-bxo-menu-item]').forEach((item) => {
        item.style.opacity = '1'
        item.style.transform = 'none'
      })
    }

    const applyMotionPreference = () => {
      scope?.revert()
      scope = undefined

      if (reducedMotion.matches) {
        restoreStaticMenu()
        return
      }

      scope = createScope({ root: menu }).add(() => {
        animate(menu, {
          opacity: [0, 1],
          y: [-10, 0],
          scale: [0.985, 1],
          duration: 260,
          ease: 'out(4)',
        })

        animate(menu.querySelectorAll<HTMLElement>('[data-bxo-menu-item]'), {
          opacity: [0, 1],
          x: [10, 0],
          duration: 300,
          delay: stagger(28),
          ease: 'out(4)',
        })
      })
    }

    applyMotionPreference()
    reducedMotion.addEventListener('change', applyMotionPreference)

    return () => {
      reducedMotion.removeEventListener('change', applyMotionPreference)
      scope?.revert()
    }
  }, [mobileOpen])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const workflowIsActive = isActive('/how-it-works') || pathname === '/guided-demo'
  const primaryAction = workflowIsActive
    ? showPortalAccess
      ? { href: '/login', label: 'Choose workspace' }
      : { href: '/security-and-compliance', label: 'Review security' }
    : { href: '/how-it-works', label: 'View platform workflow' }

  return (
    <>
      <nav aria-label="Primary navigation" className="hidden items-center gap-1 xl:flex" data-bxo-nav>
        {NAV_LINKS.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative px-3 py-3 text-sm transition-colors duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary',
                active
                  ? 'text-bxo-text-primary'
                  : 'text-bxo-text-secondary hover:text-bxo-text-primary'
              )}
              data-bxo-nav-item
            >
              {item.label}
              {active ? (
                <span
                  className="absolute inset-x-3 bottom-0 h-px bg-bxo-accent-primary"
                  data-bxo-nav-indicator
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          )
        })}
        <a
          href={BRANDED_ENTRY.testnetLogin}
          aria-label="Testnet sign in"
          className="relative px-3 py-3 text-sm text-bxo-text-secondary transition-colors duration-base hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
          data-bxo-nav-item
        >
          Testnet
        </a>
      </nav>

      <div className="hidden items-center justify-end gap-2 xl:flex" data-bxo-nav-actions>
        {showPortalAccess ? (
          <Button asChild variant="outline" className="bxo-secondary-cta h-11 rounded-sm">
            <Link href={BRANDED_ENTRY.mainnetLogin}>Mainnet sign in</Link>
          </Button>
        ) : null}
        <Button asChild className="bxo-primary-cta h-11 rounded-sm font-semibold">
          <Link href={primaryAction.href}>{primaryAction.label}</Link>
        </Button>
      </div>

      <div className="relative xl:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="public-mobile-navigation"
          onClick={() => setMobileOpen((open) => !open)}
          className="bxo-secondary-cta flex min-h-11 min-w-11 items-center justify-center px-3 text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
          data-bxo-menu-trigger
        >
          {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          <span className="ml-2 text-sm font-semibold">Menu</span>
        </button>

        {mobileOpen ? (
          <div
            ref={menuRef}
            id="public-mobile-navigation"
            className="bxo-public-menu absolute right-0 top-[calc(100%+0.65rem)] w-[min(20rem,calc(100vw-2rem))] p-2"
            data-bxo-menu
          >
            <nav aria-label="Mobile public navigation" className="grid gap-1">
              {NAV_LINKS.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center border-b border-bxo-border-subtle px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary',
                      active
                        ? 'font-semibold text-bxo-text-primary'
                        : 'text-bxo-text-secondary hover:text-bxo-text-primary'
                      )}
                      data-bxo-menu-item
                    >
                    {item.label}
                  </Link>
                )
              })}
              <a
                href={BRANDED_ENTRY.testnetLogin}
                className="flex min-h-11 items-center border-b border-bxo-border-subtle px-3 text-sm font-semibold text-bxo-text-primary transition-colors hover:text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                data-bxo-menu-item
              >
                Testnet sign in
              </a>
              <div className="my-1 border-t border-bxo-border-subtle" />
              {showPortalAccess ? (
                <Link
                  href={BRANDED_ENTRY.mainnetLogin}
                  className="flex min-h-11 items-center px-3 text-sm font-semibold text-bxo-text-primary transition-colors hover:text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                  data-bxo-menu-item
                >
                  Mainnet sign in
                </Link>
              ) : null}
              <Link
                href={primaryAction.href}
                className="flex min-h-11 items-center bg-bxo-accent-primary px-3 text-sm font-semibold text-bxo-bg-primary transition-colors hover:bg-bxo-accent-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary"
                data-bxo-menu-item
              >
                {primaryAction.label}
              </Link>
            </nav>
          </div>
        ) : null}
      </div>
    </>
  )
}
