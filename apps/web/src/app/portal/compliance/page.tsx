import { PortalPage } from '@/components/portal/portal-page'
import type { DashboardQuery } from '@/lib/portal/dashboard'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Compliance work queue' }
export default async function Page({ searchParams }: { searchParams: Promise<DashboardQuery> }) {
  const query = await searchParams
  return PortalPage({ view: '/portal/compliance', query })
}
