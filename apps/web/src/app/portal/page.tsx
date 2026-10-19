import { PortalPage } from '@/components/portal/portal-page'
import type { DashboardQuery } from '@/lib/portal/dashboard'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your dashboard', robots: { index: false, follow: false } }
export default async function Page({ searchParams }: { searchParams: Promise<DashboardQuery> }) {
  return PortalPage({ view: '/portal', query: await searchParams })
}
