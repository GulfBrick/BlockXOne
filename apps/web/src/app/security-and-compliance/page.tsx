import { MarketingPage } from '@/components/public/marketing-page'

const controls = [
  {
    index: '01',
    title: 'Authenticated authority',
    text: 'Protected browser requests use the verified session token. The resulting principal carries user, organisation, role, and permission context into each protected operation.',
  },
  {
    index: '02',
    title: 'Organisation scope',
    text: 'Instrument, offering, investor, and chain operations retain tenant and legal-entity identifiers so authority can be evaluated in the relevant operating context.',
  },
  {
    index: '03',
    title: 'Maker and checker separation',
    text: 'Instrument terms and financial profiles reject self-approval. Subscription and reconciliation workflows also preserve separate requester, runner, and approver identities where required.',
  },
  {
    index: '04',
    title: 'Permission-backed execution',
    text: 'Sensitive work is exposed through permission-aware queues, including KYC decisions, wallet approvals, subscription approvals, reconciliation, whitelist, mint, and chain-operation approval.',
  },
  {
    index: '05',
    title: 'Exact values and retry safety',
    text: 'Commercial amounts are carried as canonical decimal or base-unit values. Controlled submissions and chain writes use idempotency keys to make repeated requests recognizable.',
  },
  {
    index: '06',
    title: 'Bound chain intent',
    text: 'A governed chain request can bind the network manifest, deployment manifest, contract, operation kind, payload digest, case reference, approval policy, and signer context before broadcast.',
  },
  {
    index: '07',
    title: 'Finality before projection',
    text: 'Transaction receipt, canonical block, finality checkpoint, indexed event, and confirmation evidence are distinct records. A position is projected from finalized evidence, not from intent alone.',
  },
  {
    index: '08',
    title: 'Connected decision history',
    text: 'Audit activity and domain records retain actor attribution, state transitions, hashes, timestamps, and record identifiers across the operating lifecycle.',
  },
]

const chainProof = [
  {
    layer: 'Operation',
    evidence: 'Operation ID, kind, target contract, selector, payload digest, idempotency scope, and case reference.',
  },
  {
    layer: 'Approval',
    evidence: 'Policy ID and digest, required approvals, valid approvals, rejection state, and recorded decisions.',
  },
  {
    layer: 'Execution',
    evidence: 'Signer address, nonce, transaction hash, receipt status, and terminal reason when execution does not complete.',
  },
  {
    layer: 'Finality',
    evidence: 'Receipt evidence digest, canonical block, confirmation count, finality target, provider quorum, and finality evidence digest.',
  },
  {
    layer: 'Projection',
    evidence: 'Indexed event, controlled position ID, legal-register entry ID, and legal-register entry digest.',
  },
]

const assuranceBoundaries = [
  {
    boundary: 'Identity verification',
    platform: 'The platform records KYC or KYB case state, eligibility decisions, wallet proof, and approvals.',
    deployment: 'Provider selection, source documents, review policy, sanctions screening, and jurisdictional acceptance remain deployment decisions.',
  },
  {
    boundary: 'Wallets and custody',
    platform: 'The platform records a signed wallet challenge, chain-specific address, approval status, and whitelist state.',
    deployment: 'Custody model, key ownership, recovery, transaction authority, and provider assurance depend on the chosen custody arrangement.',
  },
  {
    boundary: 'Consideration and settlement',
    platform: 'The platform can connect instructions, provider events, statements, ledger snapshots, and reconciliation records.',
    deployment: 'Actual funds movement, safeguarding, banking partners, payment-provider terms, and settlement finality remain external controls.',
  },
  {
    boundary: 'Network execution',
    platform: 'The platform distinguishes a configured network, a broadcast transaction, a receipt, and a finalized projected position.',
    deployment: 'Testnet evidence is not mainnet evidence. Network selection, gas funding, signer operations, monitoring, and incident response must match the release environment.',
  },
  {
    boundary: 'Legal and regulatory status',
    platform: 'The platform preserves instrument terms, approvals, investor decisions, and ownership evidence for the operating record.',
    deployment: 'Offering authorization, disclosure, investor classification, transfer restrictions, tax treatment, and regulatory approval require independent professional determination.',
  },
]

const states = [
  'Requested',
  'Approved',
  'Prepared',
  'Broadcast',
  'Confirmed',
  'Finalized',
  'Projected',
]

export default function SecurityAndCompliancePage() {
  return (
    <MarketingPage
      eyebrow="Trust and control"
      title="Clear authority. Exact intent. Verifiable evidence."
      description="BlockXOne is designed to keep identity, approval, economics, network execution, and ownership records connected while making the boundary between platform evidence and external assurance explicit."
      heroAside={(
        <ol className="grid gap-px border border-bxo-border-subtle bg-bxo-border-subtle sm:grid-cols-4 lg:grid-cols-7" aria-label="Governed operation states" data-bxo-reveal-group>
          {states.map((state, index) => (
            <li key={state} className="min-h-24 bg-bxo-surface-elevated p-4" data-bxo-reveal-item>
              <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
              <p className="mt-3 font-ui text-xs font-medium leading-5 text-bxo-text-primary">{state}</p>
            </li>
          ))}
        </ol>
      )}
    >
      <section aria-labelledby="control-system-heading" data-bxo-flow-section data-bxo-flow-sequence data-bxo-reveal-group>
        <div className="grid gap-6 border-b border-bxo-border-subtle pb-9 lg:grid-cols-[0.4fr_1.6fr] lg:items-end">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Control system</p>
          <h2 id="control-system-heading" className="max-w-4xl font-editorial text-4xl leading-[0.98] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
            Authority is explicit. Evidence stays connected.
          </h2>
        </div>

        {controls.map(({ index, title, text }) => (
          <article
            key={title}
            className="grid gap-5 border-b border-bxo-border-subtle py-8 sm:grid-cols-[4rem_minmax(0,0.7fr)_minmax(0,1.3fr)] sm:gap-8 lg:py-11"
            data-bxo-reveal-item
            data-bxo-flow-step
          >
            <span className="font-ui text-sm tabular-nums text-bxo-accent-primary">{index}</span>
            <h3 className="font-editorial text-3xl leading-none text-bxo-text-primary sm:text-4xl">{title}</h3>
            <p className="max-w-2xl font-reading text-lg leading-8 text-bxo-text-secondary">{text}</p>
          </article>
        ))}
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="chain-proof-heading" data-bxo-flow-section>
        <div className="grid gap-9 lg:grid-cols-[0.58fr_1.42fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Chain proof model</p>
            <h2 id="chain-proof-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              A transaction hash is the start of the evidence, not the end.
            </h2>
            <p className="mt-6 max-w-xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              The operation record is designed to show what was requested, who approved it, what was signed, what the network finalized, and what ownership record was projected.
            </p>
          </div>
          <dl className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {chainProof.map(({ layer, evidence }, index) => (
              <div key={layer} className="grid gap-3 border-b border-bxo-border-subtle py-7 sm:grid-cols-[4rem_0.42fr_1.58fr] sm:gap-7" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <dt className="font-ui text-sm font-medium text-bxo-text-primary">{layer}</dt>
                <dd className="font-reading text-base leading-7 text-bxo-text-secondary">{evidence}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-20 border-y border-bxo-border-subtle py-10 lg:mt-28 lg:py-14" aria-labelledby="assurance-boundary-heading" data-bxo-flow-section>
        <div className="max-w-5xl">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Assurance boundaries</p>
          <h2 id="assurance-boundary-heading" className="mt-5 font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
            The platform proves its records. The deployment must prove its environment.
          </h2>
          <p className="mt-7 max-w-3xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
            Security and compliance depend on the complete operating system around the software. These boundaries keep a platform control from being presented as external certification.
          </p>
        </div>

        <div className="mt-12">
          <div className="hidden grid-cols-[0.42fr_0.79fr_0.79fr] gap-8 border-y border-bxo-border-subtle py-4 lg:grid" aria-hidden="true">
            <span className="font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary">Area</span>
            <span className="font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary">Platform record</span>
            <span className="font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary">Deployment assurance</span>
          </div>
          <dl className="border-t border-bxo-border-subtle lg:border-t-0" data-bxo-reveal-group data-bxo-flow-sequence>
            {assuranceBoundaries.map(({ boundary, platform, deployment }) => (
              <div key={boundary} className="grid gap-5 border-b border-bxo-border-subtle py-7 lg:grid-cols-[0.42fr_0.79fr_0.79fr] lg:gap-8" data-bxo-reveal-item data-bxo-flow-step>
                <dt className="font-ui text-sm font-medium text-bxo-text-primary">{boundary}</dt>
                <dd>
                  <span className="mb-2 block font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary lg:hidden">Platform record</span>
                  <span className="font-reading text-base leading-7 text-bxo-text-secondary">{platform}</span>
                </dd>
                <dd>
                  <span className="mb-2 block font-ui text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary lg:hidden">Deployment assurance</span>
                  <span className="font-reading text-base leading-7 text-bxo-text-secondary">{deployment}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-20 grid gap-8 lg:mt-28 lg:grid-cols-[0.72fr_1.28fr]" aria-labelledby="deployment-assurance-heading" data-bxo-flow-section>
        <h2 id="deployment-assurance-heading" className="font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>Assurance follows the release environment.</h2>
        <div>
          <p className="max-w-4xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
            Network, custody, identity, payment, monitoring, backup, recovery, and regulatory controls vary by deployment and jurisdiction. BlockXOne presents the configured environment and available evidence inside the relevant operational record.
          </p>
          <p className="mt-5 max-w-4xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
            Production use therefore requires a deployment-specific security review, provider validation, operational procedures, legal analysis, and launch approval. Testnet completion alone is not production authorization.
          </p>
        </div>
      </section>
    </MarketingPage>
  )
}
