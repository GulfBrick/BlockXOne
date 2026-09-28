import Link from 'next/link'
import { ArrowRight, BriefcaseBusiness, CircleHelp, Layers3, LockKeyhole, ShieldCheck, WalletCards } from 'lucide-react'
import type { RoleDashboard } from '@/lib/portal/role-dashboards'
import styles from './role-dashboard.module.css'

export type RoleDashboardContentProps = {
  dashboard: RoleDashboard
  environment: 'TESTNET' | 'MAINNET'
  organisationName: string
  availablePaths: readonly string[]
  destinations?: Readonly<Record<string, string>>
  queue?: readonly { label: string; value: number; description: string }[]
  queueMessage?: string
}

const countFormatter = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

function queueCount(value: number): string {
  return Number.isSafeInteger(value) && value >= 0 ? countFormatter.format(value) : 'Unavailable'
}

export function RoleDashboardContent({ dashboard, environment, organisationName, availablePaths, destinations, queue, queueMessage }: RoleDashboardContentProps) {
  const sectionId = `role-dashboard-${dashboard.role.toLowerCase()}`

  return <div className={styles.dashboard} data-environment={environment} data-role={dashboard.role}>
    <section className={styles.remit} aria-labelledby={`${sectionId}-responsibilities`}>
      <div className={styles.remitHeading}>
        <span className={styles.sectionIcon}><BriefcaseBusiness aria-hidden="true" /></span>
        <div>
          <p className={styles.eyebrow}>Your operating scope</p>
          <h2 id={`${sectionId}-responsibilities`}>Your responsibilities</h2>
          <p className={styles.description}>{dashboard.description}</p>
        </div>
      </div>
      <ul className={styles.responsibilities}>
        {dashboard.responsibilities.map(responsibility => <li key={responsibility}>{responsibility}</li>)}
      </ul>
      <dl className={styles.context}>
        <div><dt>Organisation context</dt><dd>{organisationName || 'No organisation selected'}</dd></div>
        <div><dt>Environment</dt><dd><span className={styles.environment}>{environment}</span><span className={styles.contextHint}>{environment === 'TESTNET' ? 'Test records and test value only' : 'Real operations require approved authority'}</span></dd></div>
      </dl>
    </section>

    <div className={styles.workGrid}>
      <section className={styles.panel} aria-labelledby={`${sectionId}-workflow`}>
        <header className={styles.panelHeading}>
          <span className={styles.sectionIcon}><Layers3 aria-hidden="true" /></span>
          <div><h2 id={`${sectionId}-workflow`}>Your workflow</h2><p>Follow the hand-offs for this role. Workspace availability does not mean a business step is complete.</p></div>
        </header>
        <ol className={styles.workflow}>
          {dashboard.workflow.map((step, index) => {
            const reachable = step.status !== 'not_connected' && !!step.href && availablePaths.includes(step.href)
            const reasonId = `${sectionId}-${step.id}-availability`
            const statusLabel = reachable
              ? step.status === 'needs_setup' ? 'Setup required' : 'Workspace available'
              : step.status === 'not_connected' ? 'Not connected' : `Unavailable in ${environment}`
            const reason = step.status === 'not_connected'
              ? 'This workflow is not connected in this release. It cannot be completed from this dashboard.'
              : `This workspace is not available for your current organisation and access in ${environment}.`

            return <li key={step.id} className={styles.workflowStep} data-available={reachable}>
              <span className={styles.stepNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className={styles.stepContent}>
                <div className={styles.stepHeading}><h3>{step.label}</h3><span className={styles.status} data-available={reachable} data-status={step.status}>{statusLabel}</span></div>
                <p className={styles.stepDescription}>{step.description}</p>
                <div className={styles.stepAction}>
                  {reachable && step.href
                    ? <Link href={destinations?.[step.href] ?? step.href} prefetch={false} className={styles.action} aria-label={`${step.status === 'needs_setup' ? 'Review setup for' : 'Open'} ${step.label}`}>{step.status === 'needs_setup' ? 'Review setup' : 'Open workspace'}<ArrowRight aria-hidden="true" /></Link>
                    : <><button type="button" className={styles.action} disabled aria-describedby={reasonId}><LockKeyhole aria-hidden="true" />Not available</button><p id={reasonId} className={styles.unavailableReason}>{reason}</p></>}
                </div>
              </div>
            </li>
          })}
        </ol>
      </section>

      <div className={styles.sideStack}>
        <section className={styles.panel} aria-labelledby={`${sectionId}-queue`}>
          <header className={styles.panelHeading}><div><p className={styles.eyebrow}>Current records</p><h2 id={`${sectionId}-queue`}>Your work queue</h2><p>Totals supplied for your current access and environment.</p></div></header>
          {queue && queue.length > 0
            ? <dl className={styles.queue}>{queue.map((item, index) => <div key={`${item.label}-${index}`} className={styles.queueItem}><dt>{item.label}</dt><dd><span className={styles.queueValue}>{queueCount(item.value)}</span><span className={styles.queueDescription}>{item.description}</span></dd></div>)}</dl>
            : <div className={styles.queueEmpty}><CircleHelp aria-hidden="true" /><p>{queueMessage || 'Queue totals are not available in this view. Open an available workflow to review your records.'}</p></div>}
          {queue && queue.length > 0 && queueMessage ? <p className={styles.queueMessage}>{queueMessage}</p> : null}
        </section>

        <section className={styles.panel} aria-labelledby={`${sectionId}-handoffs`}>
          <header className={styles.panelHeading}><div><h2 id={`${sectionId}-handoffs`}>Working with other roles</h2><p>Responsibilities continue across separate, authorised participants.</p></div></header>
          <ul className={styles.handoffs}>{dashboard.handoffs.map(handoff => <li key={handoff}><ArrowRight aria-hidden="true" /><span>{handoff}</span></li>)}</ul>
        </section>
      </div>
    </div>

    <div className={styles.guidanceGrid}>
      <section className={styles.guidance} aria-labelledby={`${sectionId}-wallet`}>
        <WalletCards aria-hidden="true" />
        <div><h2 id={`${sectionId}-wallet`}>Wallet and signing</h2><p>{dashboard.walletGuidance}</p></div>
      </section>
      <section className={styles.guidance} aria-labelledby={`${sectionId}-authority`}>
        <ShieldCheck aria-hidden="true" />
        <div><h2 id={`${sectionId}-authority`}>Authority boundary</h2><p>{dashboard.authorityBoundary}</p></div>
      </section>
    </div>
  </div>
}
