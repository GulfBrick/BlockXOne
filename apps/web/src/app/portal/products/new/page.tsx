import { PortalPage } from '@/components/portal/portal-page'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'New product' }
export default async function Page() { return PortalPage({ view: '/portal/products/new' }) }
