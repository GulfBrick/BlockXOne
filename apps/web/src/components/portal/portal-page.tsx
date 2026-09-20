import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { loadPortalPage, PortalError } from '@/lib/portal/server'
import type { PortalPath } from '@/lib/portal/contracts'
import { PortalScreen } from './portal-screens'
import styles from './portal.module.css'

export async function PortalPage({ view, id }: { view: PortalPath; id?: string }) {
  let data: Awaited<ReturnType<typeof loadPortalPage>> | null = null
  let status = 503
  try { data = await loadPortalPage() } catch (error) { if (error instanceof PortalError) status = error.status }
  if (!data && status === 404) notFound()
  if (!data && status === 401) redirect('/login')
  if (data) return <PortalScreen data={data} view={view} id={id} />
  return <div className={styles.portal} style={{ display: 'block' }}><main className={styles.content}><p className={styles.eyebrow}>BlockXOne / Client portal</p><h1 className={styles.title}>{status === 403 ? 'Complete your account access.' : 'Saved portal state is unavailable.'}</h1><p className={styles.subtitle}>{status === 403 ? 'Your session does not currently have access. Complete any required multi-factor authentication or contact your reviewer. No new privileges have been assigned.' : 'The hosted platform could not load your saved records. Your existing applications and investments have not been changed.'}</p><div className={`${styles.actions} ${styles.sectionGap}`}><Link href={status === 403 ? '/login/mfa' : '/portal'} className={styles.button}>{status === 403 ? 'Complete sign-in security' : 'Retry loading the portal'}</Link><Link href="/workspace" className={styles.buttonSecondary}>Return to account workspace</Link></div></main></div>
}
