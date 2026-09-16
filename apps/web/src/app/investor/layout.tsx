'use client'

import type { ReactNode } from 'react'
import { Briefcase, ShieldCheck, TrendingUp } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import type { NavItem } from '@/components/ui/sidebar-nav'
import { useAuth } from '@/lib/auth-context-v2'

const INVESTOR_NAVIGATION: NavItem[] = [
  { label: 'Portfolio', href: '/investor/portfolio', icon: <Briefcase className="h-5 w-5" /> },
  { label: 'Opportunities', href: '/investor/market', icon: <TrendingUp className="h-5 w-5" /> },
  { label: 'Eligibility', href: '/investor/kyc', icon: <ShieldCheck className="h-5 w-5" /> },
]

const UNSHELLED_PATHS = new Set(['/investor/login', '/investor/register'])

export default function InvestorLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  if (UNSHELLED_PATHS.has(pathname)) return children

  return (
    <DashboardLayout
      navItems={INVESTOR_NAVIGATION}
      userRole="Investor"
      currentPath={pathname}
      userName={user?.email}
      onLogout={() => {
        logout()
        router.push('/investor/login')
      }}
      showSearch={false}
    >
      {children}
    </DashboardLayout>
  )
}
