import { PortalPage } from '@/components/portal/portal-page'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Products and offerings' }
export default async function Page() { return PortalPage({ view: '/portal/products' }) }
