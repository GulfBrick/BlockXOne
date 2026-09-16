import { MarketingPage } from '@/components/public/marketing-page'

const assetClasses = [
  {
    index: '01',
    label: 'Fund interests',
    title: 'Carry the fund structure into every investor record.',
    text: 'Define the share class, dealing and NAV cadence, distribution policy, and redemption notice period alongside the common instrument terms. Approved terms stay linked to the offering, subscription, and resulting position.',
    fields: [
      'Share class and NAV currency',
      'NAV and dealing frequency',
      'Distribution policy',
      'Redemption notice days',
    ],
    operatingView: 'Designed for controlled interests in private funds, feeder vehicles, and similar investment structures.',
  },
  {
    index: '02',
    label: 'Private debt notes',
    title: 'Keep the obligation legible from terms through issuance.',
    text: 'Record face value, coupon economics, maturity, day count, seniority, and security status as typed note terms. The terms version and digest provide a stable reference for approval and downstream evidence.',
    fields: [
      'Face value in base units',
      'Annual coupon and frequency',
      'Maturity and day count',
      'Seniority and secured status',
    ],
    operatingView: 'Designed for private notes where the commercial obligation must remain distinct from the token record.',
  },
  {
    index: '03',
    label: 'Real estate SPV interests',
    title: 'Connect the property vehicle to the ownership record.',
    text: 'Capture the SPV, property identifier and jurisdiction, valuation date and value, ownership rights, and distribution policy. Investor qualification and issuance then reference the approved instrument rather than a detached token label.',
    fields: [
      'SPV and property identifier',
      'Property jurisdiction',
      'Valuation amount and date',
      'Ownership and distribution rights',
    ],
    operatingView: 'Designed for interests in property-owning vehicles, with the SPV remaining the legal and commercial anchor.',
  },
]

const sharedTerms = [
  {
    term: 'Economic definition',
    detail: 'Currency, token decimals, authorised units, issue date, and the asset-specific economics form one typed terms record.',
  },
  {
    term: 'Legal context',
    detail: 'The legal entity, governing law, instrument description, and property or obligation context stay attached to the record.',
  },
  {
    term: 'Approval lineage',
    detail: 'Draft and active versions retain their preparer, approver, approval time, version number, and terms digest.',
  },
  {
    term: 'Ownership evidence',
    detail: 'A finalized position can connect the holder wallet and balance to the transaction, block, receipt digest, and register entry digest.',
  },
]

const lifecycle = [
  'Instrument terms prepared',
  'Independent approval recorded',
  'Offering economics activated',
  'Investor eligibility evaluated',
  'Subscription and allocation controlled',
  'Issuance evidence projected',
]

export default function AssetClassesPage() {
  return (
    <MarketingPage
      eyebrow="Asset classes"
      title="Different assets. One controlled route to digital ownership."
      description="BlockXOne models fund interests, private debt notes, and real estate SPV interests as distinct instruments, then carries their approved terms through eligibility, subscription, issuance, and ownership evidence."
      heroAside={(
        <div className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-3" data-bxo-reveal-group>
          {['Typed instrument terms', 'Versioned approval record', 'Position-level evidence'].map((item, index) => (
            <div key={item} className="bg-bxo-surface-elevated px-5 py-6 sm:px-6" data-bxo-reveal-item>
              <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">0{index + 1}</span>
              <p className="mt-3 font-ui text-sm font-medium leading-6 text-bxo-text-primary">{item}</p>
            </div>
          ))}
        </div>
      )}
    >
      <section className="grid gap-10 border-y border-bxo-border-subtle py-10 lg:grid-cols-[0.68fr_1.32fr] lg:py-16" aria-labelledby="asset-foundation-heading" data-bxo-flow-section>
        <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Shared foundation</p>
        <div>
          <h2 id="asset-foundation-heading" className="max-w-4xl font-editorial text-4xl leading-[0.98] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
            The token does not replace the instrument.
          </h2>
          <p className="mt-7 max-w-3xl font-reading text-lg leading-8 text-bxo-text-secondary sm:text-xl" data-bxo-flow-copy>
            Each structure keeps its own economic and legal meaning. The platform uses a common operating model to connect those approved terms to the people, decisions, wallets, transactions, and register records that follow.
          </p>
        </div>
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="supported-structures-heading" data-bxo-flow-section data-bxo-flow-sequence data-bxo-reveal-group>
        <div className="grid gap-5 border-b border-bxo-border-subtle pb-8 lg:grid-cols-[0.68fr_1.32fr] lg:items-end">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Supported structures</p>
          <h2 id="supported-structures-heading" className="font-ui text-3xl font-medium tracking-[-0.04em] text-bxo-text-primary sm:text-4xl" data-bxo-flow-heading>
            The fields change with the asset. The control standard stays consistent.
          </h2>
        </div>

        {assetClasses.map(({ index, label, title, text, fields, operatingView }) => (
          <article
            key={label}
            className="grid gap-8 border-b border-bxo-border-subtle py-12 lg:grid-cols-[0.18fr_0.72fr_1.1fr] lg:gap-12 lg:py-16"
            data-bxo-reveal-item
            data-bxo-flow-step
          >
            <div>
              <span className="font-ui text-sm tabular-nums text-bxo-accent-primary">{index}</span>
              <p className="mt-3 font-ui text-xs font-semibold uppercase tracking-[0.16em] text-bxo-text-tertiary">{label}</p>
            </div>
            <div>
              <h3 className="font-editorial text-3xl leading-[1.04] text-bxo-text-primary sm:text-4xl">{title}</h3>
              <p className="mt-5 font-reading text-lg leading-8 text-bxo-text-secondary">{text}</p>
              <p className="mt-6 border-l border-bxo-accent-primary pl-5 font-ui text-sm leading-7 text-bxo-text-tertiary">{operatingView}</p>
            </div>
            <div className="lg:pl-10">
              <p className="font-ui text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Instrument fields</p>
              <ul className="mt-4" aria-label={`${label} instrument fields`}>
                {fields.map((field) => (
                  <li key={field} className="border-t border-bxo-border-subtle py-4 font-ui text-sm text-bxo-text-secondary last:border-b">
                    {field}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="record-model-heading" data-bxo-flow-section>
        <div className="grid gap-7 lg:grid-cols-[0.62fr_1.38fr] lg:gap-16">
          <div data-bxo-flow-heading>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">What stays connected</p>
            <h2 id="record-model-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl">
              One record line from commercial intent to ownership.
            </h2>
          </div>
          <dl className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {sharedTerms.map(({ term, detail }) => (
              <div key={term} className="grid gap-3 border-b border-bxo-border-subtle py-7 sm:grid-cols-[0.62fr_1.38fr] sm:gap-8" data-bxo-reveal-item data-bxo-flow-step>
                <dt className="font-ui text-sm font-medium text-bxo-text-primary">{term}</dt>
                <dd className="font-reading text-base leading-7 text-bxo-text-secondary">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-20 border-y border-bxo-border-subtle py-10 lg:mt-28 lg:py-14" aria-labelledby="asset-lifecycle-heading" data-bxo-flow-section>
        <div className="grid gap-8 lg:grid-cols-[0.5fr_1.5fr]">
          <div data-bxo-flow-heading>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Control path</p>
            <h2 id="asset-lifecycle-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl">A repeatable lifecycle, grounded in the asset.</h2>
          </div>
          <ol className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-2 xl:grid-cols-3" data-bxo-reveal-group data-bxo-flow-sequence>
            {lifecycle.map((step, index) => (
              <li key={step} className="min-h-32 bg-bxo-surface-elevated p-5" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <p className="mt-4 font-ui text-sm font-medium leading-6 text-bxo-text-primary">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </MarketingPage>
  )
}
