import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, FileStack } from 'lucide-react'
import styles from './portal.module.css'

const LABELS: Record<string, { label: string; tone: 'positive' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' }, NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted for review', tone: 'warning' }, PENDING_REVIEW: { label: 'Awaiting review', tone: 'warning' }, IN_REVIEW: { label: 'Under review', tone: 'warning' },
  APPROVED: { label: 'Approved for this test scope', tone: 'positive' }, REJECTED: { label: 'Not approved', tone: 'danger' }, CHANGES_REQUESTED: { label: 'Changes requested', tone: 'warning' },
  CHANGES_REQUIRED: { label: 'Changes required', tone: 'warning' }, AWAITING_FUNDING: { label: 'Awaiting funding', tone: 'warning' }, CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  PUBLISHED: { label: 'Open for subscriptions', tone: 'positive' }, OPEN: { label: 'Open for subscriptions', tone: 'positive' }, CLOSED: { label: 'Closed', tone: 'neutral' },
  SUBSCRIBED: { label: 'Subscription received', tone: 'info' }, PENDING: { label: 'Pending', tone: 'warning' }, FUNDED: { label: 'Synthetic funding recorded', tone: 'info' },
  ISSUED: { label: 'Issued', tone: 'positive' }, ACTIVE: { label: 'Active', tone: 'positive' }, VERIFIED: { label: 'Verified', tone: 'positive' },
  UNVERIFIED: { label: 'Not verified', tone: 'warning' }, REQUIRED: { label: 'Action required', tone: 'warning' }, BLOCKED: { label: 'Not available', tone: 'warning' },
  PROPOSED: { label: 'Proposed for independent approval', tone: 'warning' }, REVOKED: { label: 'Revoked', tone: 'danger' },
  INVALID: { label: 'Invalid evidence', tone: 'danger' }, UNAVAILABLE: { label: 'Verification unavailable', tone: 'warning' },
  EVIDENCE_REVIEW: { label: 'Funding evidence under review', tone: 'warning' }, PARTIAL: { label: 'Partial test-token funding', tone: 'warning' },
  OVERPAID: { label: 'Excess test-token funding · review required', tone: 'warning' }, RECONCILED: { label: 'Test-token funding reconciled', tone: 'info' },
  UNAPPLIED: { label: 'Unapplied evidence · reconciliation break', tone: 'danger' }, REVERSED: { label: 'Accounting reversed · not refunded', tone: 'warning' },
  ACCEPTANCE_PROPOSED: { label: 'Evidence acceptance proposed', tone: 'warning' }, POSTED: { label: 'Test-token journal posted', tone: 'info' },
  EXCEPTION_PROPOSED: { label: 'Exception awaiting independent decision', tone: 'warning' }, REJECTED_UNPAID: { label: 'Conclusively rejected as unpaid', tone: 'neutral' },
  RESERVED: { label: 'Units reserved', tone: 'info' },
}
export function StatusBadge({ status }: { status: string }) {
  const item = LABELS[status] ?? { label: status.replaceAll('_', ' ').toLowerCase(), tone: 'neutral' }
  return <span className={styles.badge} data-tone={item.tone}>{item.label}</span>
}
export function Panel({ title, description, action, children, flush = false }: { title: string; description?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return <section className={styles.panel}><div className={styles.panelHeader}><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</div><div className={flush ? undefined : styles.panelBody}>{children}</div></section>
}
export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <div className={styles.empty}><div className={styles.emptyIcon}><FileStack aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p>{href && action ? <Link href={href} className={styles.buttonSecondary}>{action}<ArrowRight aria-hidden="true" /></Link> : null}</div>
}
export function Notice({ title, children, tone = 'info' }: { title: string; children: ReactNode; tone?: 'info' | 'warning' | 'danger' }) {
  return <div className={styles.notice} data-tone={tone}><strong>{title}</strong>{children}</div>
}
export function Statistic({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return <div className={styles.stat}><p className={styles.statLabel}>{label}</p><p className={styles.statValue}>{value}</p><p className={styles.statHint}>{hint}</p></div>
}
export function DetailList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return <dl className={styles.detailList}>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
}
export function FormProgress({ stages, current }: { stages: string[]; current: number }) {
  return <ol className={styles.progress} aria-label="Progress">{stages.map((stage, index) => <li key={stage} aria-current={index === current ? 'step' : undefined} data-complete={index < current}><span>{index < current ? 'Completed' : `Step ${index + 1}`}</span>{stage}</li>)}</ol>
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={styles.field}>{label}{children}{hint ? <span className={styles.fieldHint}>{hint}</span> : null}</label>
}
export function money(minor: string, currency = 'ZAR_TEST'): string {
  if (!/^\d+$/.test(minor)) return 'Not available'
  const value = BigInt(minor)
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${currency === 'ZAR_TEST' ? 'R' : `${currency} `}${whole}.${(value % 100n).toString().padStart(2, '0')}${currency === 'ZAR_TEST' ? ' test' : ''}`
}
export function dateLabel(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Africa/Johannesburg' }).format(new Date(value))
}
