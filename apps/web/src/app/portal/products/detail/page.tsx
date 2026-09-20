import { PortalPage } from '@/components/portal/portal-page'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Product workspace' }
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams
  return PortalPage({ view: '/portal/products/detail', id: typeof id === 'string' ? id : undefined })
}
