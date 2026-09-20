import { PortalPage } from '@/components/portal/portal-page'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Investment opportunities' }
export default async function Page() { return PortalPage({ view: '/portal/opportunities' }) }
