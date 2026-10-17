import { PortalPage } from '@/components/portal/portal-page'
import type { DashboardQuery } from '@/lib/portal/dashboard'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Review case' }
export default async function Page({ searchParams }: { searchParams: Promise<DashboardQuery> }) {
  const query = await searchParams
  return PortalPage({ view: '/portal/compliance/detail', query, id: typeof query.id === 'string' ? query.id : undefined })
}
