import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { MarketingPage } from '@/components/public/marketing-page'
import { Button } from '@/components/ui/button'
import { isPortalAccessAdvertised } from '@/lib/release-policy'

const workstreams = [
  {
    index: '01',
    title: 'Structure and approve',
    owner: 'Offering Manager and Issuer Fund Manager',
    text: 'Create the instrument, prepare typed terms, record a separate approval, define offering economics, and activate the financial profile before subscriptions open.',
    records: ['Instrument terms version', 'Terms digest and approval', 'Financial profile and readiness'],
  },
  {
    index: '02',
    title: 'Qualify and admit',
    owner: 'Compliance Officer',
    text: 'Review submitted KYC cases and pending wallets. Wallet approval remains separate from same-chain whitelist execution, preserving a visible control boundary.',
    records: ['KYC decision', 'Wallet address and chain', 'Wallet approval state'],
  },
  {
    index: '03',
    title: 'Allocate and reconcile',
    owner: 'Transfer Agent, Treasury Operator, and Financial Controller',
    text: 'Approve subscriptions, reserve exact units, issue payment instructions, run evidence reconciliation, and record an independent reconciliation approval.',
    records: ['Allocation range', 'Payment instruction', 'Provider, statement, and ledger digests'],
  },
  {
    index: '04',
    title: 'Whitelist and issue',
    owner: 'Tokenisation Agent and authorised checker',
    text: 'Execute whitelist work, prepare controlled chain operations, obtain required approvals, coordinate signing, and project finalized receipt evidence into the ownership record.',
    records: ['Operation payload digest', 'Approval policy and signer', 'Receipt, finality, event, and register evidence'],
  },
]

const roles = [
  {
    role: 'Offering Manager',
    remit: 'Instrument preparation, offering creation, financial profile preparation, and offering publication.',
  },
  {
    role: 'Issuer Fund Manager',
    remit: 'Issuer-side offering control, subscription approval, cap-table visibility, and issuer actions.',
  },
  {
    role: 'Compliance Officer',
    remit: 'KYC case decisions, wallet approvals, compliance review, and compliance-module authority.',
  },
  {
    role: 'Transfer Agent',
    remit: 'Subscription approval, cap-table visibility, identity operations, and controlled transfer functions.',
  },
  {
    role: 'Treasury Operator',
    remit: 'Runs provider, statement, and ledger reconciliation work for configured consideration rails.',
  },
  {
    role: 'Financial Controller',
    remit: 'Approves financial profiles and independently reviews reconciliation results.',
  },
  {
    role: 'Tokenisation Agent',
    remit: 'Deployment, whitelist, mint, burn, identity registration, and token compliance operations.',
  },
]

const controlPoints = [
  {
    title: 'Separate preparation and approval',
    text: 'Instrument terms, financial profiles, subscriptions, reconciliations, and governed chain actions carry explicit maker and checker evidence where required.',
  },
  {
    title: 'Permission-backed queues',
    text: 'Operator work is discovered through permission-aware queues for offerings, KYC, wallets, subscriptions, settlement, whitelist, mint, and chain approvals.',
  },
  {
    title: 'Exact-value economics',
    text: 'Asset units, consideration amounts, price inputs, allocation capacity, and balances use canonical decimal or base-unit representations.',
  },
  {
    title: 'Retry-safe operations',
    text: 'Controlled subscriptions and chain writes bind retries to idempotency keys so a repeated request can be recognized rather than silently duplicated.',
  },
]

const operatingStates = [
  'Draft instrument',
  'Active approved terms',
  'Offering ready',
  'Subscription requested',
  'Funding pending',
  'Reconciled',
  'Chain operation finalized',
  'Position registered',
]

export default function ForOperatorsPage() {
  const showPortalAccess = isPortalAccessAdvertised()

  return (
    <MarketingPage
      eyebrow="Operators"
      title="Coordinate every accountable role without losing the record."
      description="BlockXOne gives issuer, compliance, finance, transfer, and tokenisation teams focused work queues connected to the same instrument, investor, subscription, and chain lifecycle."
      heroAside={(
        <div className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-2 lg:grid-cols-4" data-bxo-reveal-group>
          {['Structure', 'Qualify', 'Reconcile', 'Issue'].map((item, index) => (
            <div key={item} className="bg-bxo-surface-elevated p-5 sm:p-6" data-bxo-reveal-item>
              <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">0{index + 1}</span>
              <p className="mt-5 font-editorial text-2xl text-bxo-text-primary">{item}</p>
            </div>
          ))}
        </div>
      )}
    >
      <section aria-labelledby="operator-workflows-heading" data-bxo-flow-section data-bxo-flow-sequence data-bxo-reveal-group>
        <div className="grid gap-6 border-b border-bxo-border-subtle pb-9 lg:grid-cols-[0.46fr_1.54fr] lg:items-end">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Operating model</p>
          <h2 id="operator-workflows-heading" className="max-w-4xl font-editorial text-4xl leading-[0.98] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
            Specialist work, coordinated as one lifecycle.
          </h2>
        </div>

        {workstreams.map(({ index, title, owner, text, records }) => (
          <article
            key={title}
            className="grid gap-8 border-b border-bxo-border-subtle py-11 lg:grid-cols-[0.18fr_0.74fr_1.08fr] lg:gap-12 lg:py-14"
            data-bxo-reveal-item
            data-bxo-flow-step
          >
            <div>
              <span className="font-ui text-sm tabular-nums text-bxo-accent-primary">{index}</span>
              <p className="mt-3 font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-text-tertiary">{owner}</p>
            </div>
            <div>
              <h3 className="font-editorial text-3xl leading-none text-bxo-text-primary sm:text-4xl">{title}</h3>
              <p className="mt-5 max-w-2xl font-reading text-lg leading-8 text-bxo-text-secondary">{text}</p>
            </div>
            <ul className="border-t border-bxo-border-subtle lg:ml-8" aria-label={`${title} records`}>
              {records.map((record) => (
                <li key={record} className="border-b border-bxo-border-subtle py-4 font-ui text-sm text-bxo-text-secondary">
                  {record}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="role-directory-heading" data-bxo-flow-section>
        <div className="grid gap-9 lg:grid-cols-[0.58fr_1.42fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Role directory</p>
            <h2 id="role-directory-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              Clear ownership for each control point.
            </h2>
            <p className="mt-6 max-w-xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              A role defines the available work, while organisation membership keeps that authority in the relevant issuer or platform context.
            </p>
          </div>
          <dl className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {roles.map(({ role, remit }) => (
              <div key={role} className="grid gap-3 border-b border-bxo-border-subtle py-6 sm:grid-cols-[0.58fr_1.42fr] sm:gap-8" data-bxo-reveal-item data-bxo-flow-step>
                <dt className="font-ui text-sm font-medium text-bxo-text-primary">{role}</dt>
                <dd className="font-reading text-base leading-7 text-bxo-text-secondary">{remit}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-20 border-y border-bxo-border-subtle py-10 lg:mt-28 lg:py-14" aria-labelledby="operator-controls-heading" data-bxo-flow-section>
        <div className="grid gap-9 lg:grid-cols-[0.58fr_1.42fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Operational controls</p>
            <h2 id="operator-controls-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              Controls are part of the workflow, not a report added later.
            </h2>
          </div>
          <div className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-2" data-bxo-reveal-group data-bxo-flow-sequence>
            {controlPoints.map(({ title, text }, index) => (
              <article key={title} className="min-h-56 bg-bxo-surface-elevated p-6" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="mt-5 font-editorial text-2xl leading-tight text-bxo-text-primary">{title}</h3>
                <p className="mt-4 font-reading text-base leading-7 text-bxo-text-secondary">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="state-model-heading" data-bxo-flow-section>
        <div className="grid gap-8 lg:grid-cols-[0.48fr_1.52fr] lg:items-end">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">State model</p>
            <h2 id="state-model-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>A shared language for progress.</h2>
          </div>
          <ol className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-2 xl:grid-cols-4" data-bxo-reveal-group data-bxo-flow-sequence>
            {operatingStates.map((state, index) => (
              <li key={state} className="min-h-28 bg-bxo-surface-elevated p-5" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <p className="mt-4 font-ui text-sm font-medium leading-6 text-bxo-text-primary">{state}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mt-20 grid gap-10 border-y border-bxo-border-subtle py-10 lg:mt-28 lg:grid-cols-[0.48fr_1.12fr_0.4fr] lg:items-end lg:py-14" aria-labelledby="role-control-heading" data-bxo-flow-section>
        <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Role-separated access</p>
        <div>
          <h2 id="role-control-heading" className="font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>Each team sees the work it is authorised to perform.</h2>
          <p className="mt-5 max-w-3xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
            Authenticated organisation context, permission-aware navigation, and scoped queues keep preparation, approval, compliance, reconciliation, and execution responsibilities distinct.
          </p>
        </div>
        {showPortalAccess ? (
          <Button asChild className="bxo-primary-cta h-12 rounded-sm px-6 lg:justify-self-end" data-bxo-flow-actions>
            <Link href="/operator/login">
              Operator login
              <ArrowRight className="ml-2 h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </section>
    </MarketingPage>
  )
}
