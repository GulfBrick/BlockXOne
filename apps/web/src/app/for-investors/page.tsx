import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { MarketingPage } from '@/components/public/marketing-page'
import { Button } from '@/components/ui/button'
import { isPortalAccessAdvertised } from '@/lib/release-policy'

const journey = [
  {
    index: '01',
    stage: 'Qualification',
    title: 'Know your participation status before you commit.',
    text: 'Your investor context brings together the current KYC case, its submission or approval state, and the eligibility decision recorded for a subscription.',
    evidence: ['KYC case state', 'Eligibility decision', 'Authenticated investor identity'],
  },
  {
    index: '02',
    stage: 'Wallet',
    title: 'Connect a wallet through a signed challenge.',
    text: 'Wallet ownership begins with a time-bound challenge containing the address, chain, and domain. Approval and same-chain whitelist status are then tracked as distinct controls.',
    evidence: ['Wallet address and chain ID', 'Signed challenge', 'Approval and whitelist state'],
  },
  {
    index: '03',
    stage: 'Opportunity',
    title: 'Review the instrument behind the token.',
    text: 'The opportunity record carries the asset class, issuer context, approved terms version, terms digest, currency, price, network, and contract information available for that offering.',
    evidence: ['Asset-specific terms', 'Terms version and digest', 'Network and contract context'],
  },
  {
    index: '04',
    stage: 'Subscription',
    title: 'Submit exact units against approved economics.',
    text: 'Requested units and consideration are preserved as exact decimal values. The subscription remains connected to the approved terms and receives a clear operating state as it progresses.',
    evidence: ['Requested asset units', 'Consideration amount and currency', 'Subscription state'],
  },
  {
    index: '05',
    stage: 'Funding and reconciliation',
    title: 'See when consideration evidence is complete.',
    text: 'Configured funding evidence can include a payment instruction, provider receipt, statement snapshot, ledger snapshot, and reconciliation run. The interface distinguishes received evidence from reconciled evidence.',
    evidence: ['Payment reference', 'Provider and statement evidence', 'Reconciliation status'],
  },
  {
    index: '06',
    stage: 'Ownership',
    title: 'Read the position back to its finalized event.',
    text: 'A finalized position can show the wallet, base-unit balance, token decimals, transaction and block references, receipt digest, confirmation count, and legal-register entry digest.',
    evidence: ['Transaction and block', 'Balance and token decimals', 'Receipt and register digests'],
  },
]

const subscriptionStates = [
  {
    state: 'Submitted',
    meaning: 'The request and its exact economics have been recorded for review.',
  },
  {
    state: 'Funding pending',
    meaning: 'Approval and allocation are recorded, with consideration evidence still outstanding.',
  },
  {
    state: 'Funds received',
    meaning: 'Configured provider evidence has been received, but reconciliation is not yet complete.',
  },
  {
    state: 'Reconciled',
    meaning: 'Provider, statement, and ledger evidence have passed the configured reconciliation step.',
  },
]

const positionFields = [
  'Instrument name and asset class',
  'Approved terms digest',
  'Holder wallet and chain ID',
  'Token contract and base-unit balance',
  'Transaction hash and block reference',
  'Receipt evidence digest',
  'Finality time and confirmation count',
  'Register sequence and entry digest',
]

export default function ForInvestorsPage() {
  const showPortalAccess = isPortalAccessAdvertised()

  return (
    <MarketingPage
      eyebrow="Investors"
      title="See the asset, the decision, and the evidence in one place."
      description="The BlockXOne investor portal connects qualification, approved opportunities, wallet controls, subscription progress, and finalized ownership records without hiding the states between them."
      heroAside={(
        <dl className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-3" data-bxo-reveal-group>
          {[
            ['Before participation', 'Eligibility and wallet status'],
            ['During subscription', 'Exact units and operating state'],
            ['After issuance', 'Transaction and register evidence'],
          ].map(([term, detail]) => (
            <div key={term} className="bg-bxo-surface-elevated px-5 py-6 sm:px-6" data-bxo-reveal-item>
              <dt className="font-ui text-xs uppercase tracking-[0.14em] text-bxo-accent-primary">{term}</dt>
              <dd className="mt-3 font-reading text-lg leading-7 text-bxo-text-primary">{detail}</dd>
            </div>
          ))}
        </dl>
      )}
    >
      <section aria-labelledby="investor-experience-heading" data-bxo-flow-section data-bxo-flow-sequence data-bxo-reveal-group>
        <div className="grid gap-6 border-b border-bxo-border-subtle pb-9 lg:grid-cols-[0.46fr_1.54fr] lg:items-end">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Investor journey</p>
          <h2 id="investor-experience-heading" className="max-w-4xl font-editorial text-4xl leading-[0.98] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
            Clarity from qualification to ownership.
          </h2>
        </div>

        {journey.map(({ index, stage, title, text, evidence }) => (
          <article
            key={stage}
            className="grid gap-7 border-b border-bxo-border-subtle py-10 lg:grid-cols-[0.16fr_0.72fr_1.12fr] lg:gap-12 lg:py-14"
            data-bxo-reveal-item
            data-bxo-flow-step
          >
            <div>
              <span className="font-ui text-sm tabular-nums text-bxo-accent-primary">{index}</span>
              <p className="mt-3 font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-text-tertiary">{stage}</p>
            </div>
            <div>
              <h3 className="font-editorial text-3xl leading-[1.04] text-bxo-text-primary sm:text-4xl">{title}</h3>
              <p className="mt-5 max-w-2xl font-reading text-lg leading-8 text-bxo-text-secondary">{text}</p>
            </div>
            <ul className="border-t border-bxo-border-subtle lg:ml-8" aria-label={`${stage} record details`}>
              {evidence.map((item) => (
                <li key={item} className="border-b border-bxo-border-subtle py-4 font-ui text-sm text-bxo-text-secondary">
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="subscription-state-heading" data-bxo-flow-section>
        <div className="grid gap-9 lg:grid-cols-[0.62fr_1.38fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">State, not guesswork</p>
            <h2 id="subscription-state-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              Every subscription tells you what has happened and what has not.
            </h2>
            <p className="mt-6 max-w-xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              Consideration source, cash indicators, and evidence references remain visible in the record so a test environment cannot be mistaken for settled real-world cash.
            </p>
          </div>
          <ol className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {subscriptionStates.map(({ state, meaning }, index) => (
              <li key={state} className="grid gap-3 border-b border-bxo-border-subtle py-7 sm:grid-cols-[4rem_0.58fr_1.42fr] sm:gap-7" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <strong className="font-ui text-sm font-medium text-bxo-text-primary">{state}</strong>
                <span className="font-reading text-base leading-7 text-bxo-text-secondary">{meaning}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mt-20 border-y border-bxo-border-subtle py-10 lg:mt-28 lg:py-14" aria-labelledby="position-record-heading" data-bxo-flow-section>
        <div className="grid gap-10 lg:grid-cols-[0.64fr_1.36fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Position record</p>
            <h2 id="position-record-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              Ownership with a readable evidence trail.
            </h2>
            <p className="mt-6 max-w-xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              The portfolio view is designed to present the position and the evidence that created it, not only a headline balance.
            </p>
          </div>
          <ul className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-2" aria-label="Finalized position fields" data-bxo-reveal-group data-bxo-flow-sequence>
            {positionFields.map((field, index) => (
              <li key={field} className="min-h-28 bg-bxo-surface-elevated p-5" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <p className="mt-4 font-ui text-sm leading-6 text-bxo-text-primary">{field}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-20 grid gap-10 border-b border-bxo-border-subtle pb-10 lg:mt-28 lg:grid-cols-[0.48fr_1.12fr_0.4fr] lg:items-end lg:pb-14" aria-labelledby="investor-portal-heading" data-bxo-flow-section>
        <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Investor portal</p>
        <div>
          <h2 id="investor-portal-heading" className="font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>Your view stays focused on your participation.</h2>
          <p className="mt-5 max-w-3xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
            Authenticated access keeps investor navigation separate from operator work queues. Available records are loaded through the signed-in investor context.
          </p>
        </div>
        {showPortalAccess ? (
          <Button asChild className="bxo-primary-cta h-12 rounded-sm px-6 lg:justify-self-end" data-bxo-flow-actions>
            <Link href="/investor/login">
              Investor login
              <ArrowRight className="ml-2 h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </section>
    </MarketingPage>
  )
}
