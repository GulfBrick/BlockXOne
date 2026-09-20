import { PortalPage } from '@/components/portal/portal-page'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'My portfolio' }
export default async function Page() { return PortalPage({ view: '/portal/portfolio' }) }
