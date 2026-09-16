import Image from 'next/image'

import { MarketingPage } from '@/components/public/marketing-page'

const stages = [
  {
    title: 'Model the instrument',
    summary:
      'Translate the legal and economic structure into the operating record that every later action references.',
    input: 'Legal entity, asset structure, rights, economics, supply controls, target network, and role policy.',
    decision: 'The preparation team confirms that the instrument record is complete enough to enter approval.',
    evidence: 'A versioned instrument record with a defined owner, terms, controls, and requested network.',
  },
  {
    title: 'Approve terms and hash',
    summary:
      'Fix the approved terms to a specific document version so an altered file cannot silently continue through the workflow.',
    input: 'The prepared instrument record, supporting terms, document version, and approval request.',
    decision: 'An authorised approver accepts or rejects the exact terms presented for review.',
    evidence: 'Approval history tied to the approved document hash and the people responsible for the decision.',
  },
  {
    title: 'Establish the financial profile',
    summary:
      'Record the commercial model that explains how the offering is expected to operate before investors are admitted.',
    input: 'Capital objective, price, denomination, subscription parameters, fees, and relevant financial assumptions.',
    decision: 'The operator confirms that the commercial profile agrees with the approved instrument terms.',
    evidence: 'A financial profile linked to the instrument and available to the following control checks.',
  },
  {
    title: 'Confirm issuance readiness',
    summary:
      'Bring the legal, financial, operational, and network requirements into one review before distribution begins.',
    input: 'Approved terms, financial profile, responsible roles, network configuration, and outstanding requirements.',
    decision: 'The assigned reviewer records whether the instrument is ready to accept subscriptions.',
    evidence: 'A readiness decision with the checks completed, open conditions, actor, and time of review.',
  },
  {
    title: 'Qualify the investor and wallet',
    summary:
      'Connect the eligible investor, their organisation context, and the wallet intended to receive the position.',
    input: 'Investor identity, eligibility record, organisation, wallet address, and wallet ownership evidence.',
    decision: 'The responsible role approves or rejects investor access and the linked destination wallet.',
    evidence: 'An attributed qualification decision and an approved investor to wallet relationship.',
  },
  {
    title: 'Approve the subscription',
    summary:
      'Capture the requested commitment as an exact obligation and review the allocation before it can progress.',
    input: 'Qualified investor, approved wallet, instrument, quantity, price, amount, and subscription request.',
    decision: 'The offering team accepts, adjusts, or rejects the requested allocation within the approved terms.',
    evidence: 'A subscription record with exact values, status history, allocation, and accountable decision maker.',
  },
  {
    title: 'Reconcile settlement evidence',
    summary:
      'Match the approved obligation to the evidence received before any issuance instruction is authorised.',
    input: 'Approved subscription, expected amount, settlement reference, received amount, and supporting evidence.',
    decision: 'The financial control role determines whether the obligation and settlement evidence reconcile.',
    evidence: 'A reconciliation result connected to the subscription, evidence reference, and approval history.',
  },
  {
    title: 'Issue, verify, and finalise',
    summary:
      'Execute the authorised instruction, observe the network result, and connect it back to the ownership records.',
    input: 'Reconciled subscription, approved wallet, authorised quantity, network, contract, and issuance instruction.',
    decision: 'The platform finalises only after the execution result can be matched to the authorised instruction.',
    evidence: 'Transaction receipt, contract reference, finality state, token supply, investor position, and legal register record.',
  },
]

const stopConditions = [
  {
    title: 'The terms no longer match',
    text: 'A missing approval, changed document, or hash mismatch sends the instrument back for review before later actions continue.',
  },
  {
    title: 'Readiness is incomplete',
    text: 'Open legal, financial, operational, or network conditions remain visible and prevent the workflow from being treated as ready.',
  },
  {
    title: 'Investor access is unresolved',
    text: 'An unqualified investor, rejected eligibility decision, or unapproved wallet cannot receive an allocation or issuance.',
  },
  {
    title: 'The obligation does not reconcile',
    text: 'A subscription, expected amount, received amount, or settlement reference that does not agree remains outside issuance.',
  },
  {
    title: 'Execution cannot be proven',
    text: 'A failed transaction or unmatched network result cannot be promoted into a final investor position or legal register record.',
  },
]

export default function HowItWorksPage() {
  return (
    <MarketingPage
      eyebrow="How it works"
      title="One controlled path from legal terms to recorded ownership."
      description="BlockXOne coordinates the primary issuance lifecycle as a sequence of accountable decisions. The platform keeps the instrument, approvals, investor access, settlement evidence, network execution, and ownership record connected throughout the process."
      heroAside={
        <figure className="overflow-hidden rounded-lg border border-bxo-border-subtle bg-bxo-surface-primary" data-bxo-image-reveal data-bxo-parallax-frame>
          <div className="relative aspect-[16/10] overflow-hidden bg-bxo-bg-secondary" data-bxo-parallax="section">
            <Image
              src="/editorial/issuance-sequence.webp"
              alt="An editorial still life of documents, approval materials, structured glass forms, and a bound register representing the controlled issuance sequence"
              fill
              priority
              sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 3rem), (max-width: 1439px) calc(100vw - 4rem), 1376px"
              quality={90}
              className="object-cover"
            />
          </div>
          <figcaption className="grid gap-2 border-t border-bxo-border-subtle px-5 py-4 sm:grid-cols-[auto_1fr] sm:gap-5" data-bxo-media-caption>
            <span className="font-ui text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">
              The control path
            </span>
            <span className="font-reading text-sm leading-6 text-bxo-text-secondary">
              Each material decision leaves evidence for the next role. Issuance is the final result of the sequence, not the starting point.
            </span>
          </figcaption>
        </figure>
      }
    >
      <section className="border-y border-bxo-border-subtle" aria-labelledby="operating-integrity-heading" data-bxo-flow-section>
        <div className="grid gap-10 py-10 lg:grid-cols-[0.72fr_1.28fr] lg:py-14">
          <div data-bxo-flow-heading>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Operating integrity</p>
            <h2 id="operating-integrity-heading" className="mt-5 max-w-lg font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl">
              Control is part of the sequence.
            </h2>
          </div>
          <ul className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {[
              'Every material action is attributed to an authenticated role.',
              'Preparation, approval, financial control, and execution remain distinct decisions.',
              'Business records and network evidence stay connected to the same issuance journey.',
            ].map((item, index) => (
              <li key={item} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-bxo-border-subtle py-5 font-reading text-lg leading-7 text-bxo-text-secondary" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">0{index + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-20 lg:mt-28" aria-labelledby="issuance-sequence-heading" data-bxo-flow-section>
        <div className="grid gap-6 border-b border-bxo-border-subtle pb-9 lg:grid-cols-[0.42fr_1.58fr] lg:items-end">
          <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary" data-bxo-flow-heading>Issuance sequence</p>
          <div>
            <h2 id="issuance-sequence-heading" className="max-w-4xl font-editorial text-4xl leading-[0.98] text-bxo-text-primary sm:text-5xl lg:text-6xl" data-bxo-flow-heading>
              Eight stages. One accountable record.
            </h2>
            <p className="mt-5 max-w-3xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              Each stage answers three practical questions: what enters the control, who decides whether it can continue, and what evidence remains when that decision is complete.
            </p>
          </div>
        </div>

        <ol data-bxo-reveal-group data-bxo-flow-sequence>
          {stages.map((stage, index) => (
            <li
              key={stage.title}
              className="grid gap-6 border-b border-bxo-border-subtle py-10 lg:grid-cols-[5rem_minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-10 lg:py-14"
              data-bxo-reveal-item
              data-bxo-flow-step
            >
              <span className="font-ui text-sm tabular-nums text-bxo-accent-primary">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <p className="font-ui text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-bxo-text-muted">
                  Stage {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-3 max-w-md font-editorial text-3xl leading-none text-bxo-text-primary sm:text-4xl">{stage.title}</h3>
                <p className="mt-5 max-w-xl font-reading text-base leading-7 text-bxo-text-secondary">{stage.summary}</p>
              </div>
              <dl className="border-t border-bxo-border-subtle">
                {[
                  ['Input', stage.input],
                  ['Decision', stage.decision],
                  ['Evidence output', stage.evidence],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-2 border-b border-bxo-border-subtle py-4 sm:grid-cols-[8.5rem_1fr] sm:gap-5 sm:py-5">
                    <dt className="font-ui text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">{label}</dt>
                    <dd className="font-reading text-base leading-7 text-bxo-text-secondary">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 border-y border-bxo-border-subtle py-12 lg:mt-28 lg:py-16" aria-labelledby="workflow-stops-heading" data-bxo-flow-section>
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            <p className="font-ui text-xs font-semibold uppercase tracking-[0.18em] text-bxo-accent-primary">Exception control</p>
            <h2 id="workflow-stops-heading" className="mt-5 max-w-lg font-editorial text-4xl leading-[1.02] text-bxo-text-primary sm:text-5xl" data-bxo-flow-heading>
              What stops the workflow.
            </h2>
            <p className="mt-5 max-w-xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-flow-copy>
              Progress is not the same as completion. A control remains open until its required decision and evidence agree.
            </p>
          </div>
          <ol className="border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
            {stopConditions.map((condition, index) => (
              <li key={condition.title} className="grid gap-3 border-b border-bxo-border-subtle py-5 sm:grid-cols-[3rem_0.7fr_1.3fr] sm:gap-5" data-bxo-reveal-item data-bxo-flow-step>
                <span className="font-ui text-xs tabular-nums text-bxo-accent-primary">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="font-editorial text-2xl leading-tight text-bxo-text-primary">{condition.title}</h3>
                <p className="font-reading text-base leading-7 text-bxo-text-secondary">{condition.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </MarketingPage>
  )
}
