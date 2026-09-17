'use client'

import Link from 'next/link'
import { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { useAuth } from '@/lib/auth-context-v2'
import { isLegacyClientAuthDisabled } from '@/lib/auth-mode'
import {
  getDefaultRouteForRoles,
  hasAnyRole,
  OFFERING_WORKFLOW_ROLES,
  SETTLEMENT_WORKFLOW_ROLES,
  SUBSCRIPTION_WORKFLOW_ROLES,
} from '@/lib/role-routing'
import { Button } from './ui/button'
import { Navbar } from './ui/navbar'

const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/register',
  '/how-it-works',
  '/asset-classes',
  '/for-investors',
  '/for-operators',
  '/security-and-compliance',
  '/guided-demo',
  '/request-demo',
  '/investor/login',
  '/investor/register',
  '/operator/login',
])

const SURFACE_RULES = [
  {
    prefix: '/wm/settlements',
    allowedRoles: [...SETTLEMENT_WORKFLOW_ROLES],
    loginPath: '/operator/login',
    label: 'Settlement and reconciliation workspace',
  },
  {
    prefix: '/wm/subscriptions',
    allowedRoles: [...SUBSCRIPTION_WORKFLOW_ROLES],
    loginPath: '/operator/login',
    label: 'Subscription approval queue',
  },
  {
    prefix: '/wm/funds/new',
    allowedRoles: ['OfferingManager', 'IssuerFundManager', 'SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Instrument and offering creation workspace',
  },
  {
    prefix: '/wm/funds',
    allowedRoles: [...OFFERING_WORKFLOW_ROLES],
    loginPath: '/operator/login',
    label: 'Offering management workspace',
  },
  {
    prefix: '/investor',
    allowedRoles: ['Investor', 'SuperAdmin'],
    loginPath: '/investor/login',
    label: 'Investor portal',
  },
  {
    prefix: '/wm',
    allowedRoles: ['OfferingManager', 'IssuerFundManager', 'TransferAgent', 'SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Operator workspace',
  },
  {
    prefix: '/compliance',
    allowedRoles: ['ComplianceOfficer', 'SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Compliance workspace',
  },
  {
    prefix: '/issuer',
    allowedRoles: ['IssuerFundManager', 'SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Issuer workspace',
  },
  {
    prefix: '/admin',
    allowedRoles: ['SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Admin workspace',
  },
  {
    prefix: '/tokenisation-agent',
    allowedRoles: ['TokenisationAgent', 'IssuerFundManager', 'SuperAdmin'],
    loginPath: '/operator/login',
    label: 'Token operations workspace',
  },
]

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  if (isLegacyClientAuthDisabled()) return <>{children}</>
  return <LegacyLayoutWrapper>{children}</LegacyLayoutWrapper>
}

function LegacyLayoutWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useAuth()

  const isPublicSurface = PUBLIC_ROUTES.has(pathname)
  const activeSurface = useMemo(
    () =>
      SURFACE_RULES.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) || null,
    [pathname]
  )

  useEffect(() => {
    if (isPublicSurface || !activeSurface || loading || user) {
      return
    }

    router.replace(activeSurface.loginPath)
  }, [activeSurface, isPublicSurface, loading, router, user])

  if (isPublicSurface) {
    return <>{children}</>
  }

  if (activeSurface) {
    if (loading) {
      return (
        <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
          <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 inline-flex rounded-md border border-bxo-accent-border bg-bxo-accent-soft px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-bxo-accent-primary">
              Verifying access
            </div>
            <h1 className="font-display text-4xl font-bold">
              Opening the right BlockXOne workspace.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-bxo-text-secondary">
              We are validating your session and role assignments before loading this protected surface.
            </p>
          </div>
        </div>
      )
    }

    if (!user) {
      return null
    }

    if (!hasAnyRole(user.roles, activeSurface.allowedRoles)) {
      const homeHref = getDefaultRouteForRoles(user.roles)

      return (
        <div className="min-h-screen bg-bxo-bg-primary text-bxo-text-primary">
          <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 inline-flex rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
              Restricted surface
            </div>
            <h1 className="font-display text-4xl font-bold">
              This route belongs to the {activeSurface.label.toLowerCase()}.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-bxo-text-secondary">
              You are signed in as <span className="font-medium text-bxo-text-primary">{user.email}</span>, but your role does
              not match the access policy for this workspace.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild className="rounded-md">
                <Link href={homeHref}>Go to my workspace</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="bxo-secondary-cta rounded-md"
              >
                <Link href={activeSurface.loginPath}>Switch account</Link>
              </Button>
            </div>
          </div>
        </div>
      )
    }
  }

  if (pathname.startsWith('/investor')) return <>{children}</>

  return (
    <>
      <Navbar />
      {children}
    </>
  )
}
