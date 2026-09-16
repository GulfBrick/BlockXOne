import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowRight } from 'lucide-react'

import { PlatformPreview } from '@/components/public/platform-preview'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'
import { isPortalAccessAdvertised } from '@/lib/release-policy'

const assetStructures = [
  {
    index: '01',
    title: 'Private debt notes',
    text: 'Model face value, coupon, day count, maturity, seniority, security and the exact units authorised for issue.',
    fields: ['Economic terms', 'Approved supply', 'Governing law'],
  },
  {
    index: '02',
    title: 'Fund interests',
    text: 'Preserve the share class, NAV currency, dealing frequency, distribution policy and redemption terms of the fund.',
    fields: ['Share class', 'Dealing terms', 'Distribution policy'],
  },
  {
    index: '03',
    title: 'Real estate SPVs',
    text: 'Connect the property, SPV, valuation, jurisdiction, ownership rights and distribution policy to each position.',
    fields: ['SPV identity', 'Property evidence', 'Ownership rights'],
  },
]

const lifecycle = [
  ['01', 'Model', 'Capture the instrument, legal vehicle, economic terms, currency, authorised units and target network.'],
  ['02', 'Approve', 'Version the terms, create their SHA-256 fingerprint and keep preparation separate from approval.'],
  ['03', 'Qualify', 'Record investor eligibility, bind the holder to a signed wallet challenge and approve the wallet independently.'],
  ['04', 'Subscribe', 'Preserve exact units, amount, currency, eligibility outcome and request identity for each instruction.'],
  ['05', 'Reconcile', 'Match provider evidence, statement data and ledger postings, with unresolved breaks kept visible.'],
  ['06', 'Issue', 'Release only after readiness, wallet admission, reconciliation and the required chain authority are present.'],
  ['07', 'Prove', 'Connect the position to its contract, transaction, block, confirmations, receipt and legal-register record.'],
]

const responsibilities = [
  ['Offering teams', 'Prepare instruments, terms and offering readiness without holding final execution authority.'],
  ['Compliance teams', 'Review eligibility, organisation context, wallet ownership and policy exceptions.'],
  ['Finance teams', 'Control settlement evidence, ledger journals, reconciliation and release readiness.'],
  ['Transfer agents', 'Maintain holder admission, legal-register continuity and position evidence.'],
  ['Tokenisation agents', 'Deploy and issue only from an approved, exact instruction with an attributable operation record.'],
  ['Investors', 'Review eligible opportunities, submit exact subscriptions and inspect finalized position evidence.'],
]

const evidenceFields = [
  'Approved terms hash',
  'Holder wallet',
  'Token contract',
  'Exact base-unit balance',
  'Transaction and block',
  'Receipt hash',
  'Confirmation state',
  'Legal-register sequence and hash',
]

export default function HomePage() {
  const showPortalAccess = isPortalAccessAdvertised()

  return (
    <PublicShell>
      <main id="main-content">
        <div className="bxo-scroll-progress" aria-hidden="true">
          <span data-bxo-scroll-progress />
        </div>

        <section className="bxo-cinematic-hero">
          <div className="bxo-cinematic-hero__media" data-bxo-hero-media data-bxo-parallax-frame>
            <div className="bxo-cinematic-hero__image" data-bxo-parallax="hero">
              <Image
                src="/editorial/hero-operable-assets.webp"
                alt="Architectural model, legal records and steel instruments arranged as one connected private-asset system"
                fill
                priority
                sizes="(max-width: 767px) 100vw, (max-width: 1023px) 82vw, (max-width: 1768px) 67vw, 1184px"
                quality={90}
              />
            </div>
            <div className="bxo-cinematic-hero__scrim" aria-hidden="true" />
            <p className="bxo-cinematic-hero__caption" data-bxo-hero-detail data-bxo-hero-caption>
              Structure. Authority. Evidence.
            </p>
          </div>

          <div className="bxo-cinematic-hero__layout">
            <div className="bxo-cinematic-hero__copy" data-bxo-hero-track>
              <div className="bxo-editorial-index" data-bxo-hero-detail data-bxo-hero-kicker>
                <span>01</span>
                <span>Multi-asset tokenisation</span>
              </div>

              <h1 className="mt-7 text-bxo-text-primary">
                <span className="bxo-type-mask">
                  <span className="block font-ui text-[clamp(3.4rem,7.4vw,7.8rem)] font-medium leading-[0.86] tracking-[-0.075em]" data-bxo-hero-line>
                    Private assets,
                  </span>
                </span>
                <span className="bxo-type-mask mt-2 sm:mt-3">
                  <span className="block font-editorial text-[clamp(2.95rem,14.5vw,3.8rem)] leading-[0.9] tracking-[-0.05em] text-bxo-accent-primary sm:text-[clamp(3.8rem,8.1vw,8.7rem)] sm:leading-[0.86]" data-bxo-hero-line>
                    made operable.
                  </span>
                </span>
              </h1>

              <p className="mt-8 max-w-[42rem] font-reading text-xl leading-8 text-bxo-text-secondary sm:text-2xl sm:leading-9" data-bxo-hero-detail data-bxo-hero-copy>
                Move from structured instrument terms to qualified investors, reconciled subscriptions, governed issuance and position evidence in one controlled workflow.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-bxo-hero-detail data-bxo-hero-actions>
                <Button asChild size="lg" className="bxo-primary-cta h-12 rounded-sm px-7 font-semibold">
                  <Link href="/how-it-works">
                    Explore the workflow
                    <ArrowRight className="ml-2 h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
                  </Link>
                </Button>
                {showPortalAccess ? (
                  <Button asChild size="lg" variant="outline" className="bxo-secondary-cta h-12 rounded-sm px-7 font-semibold">
                    <Link href="/login">Enter your workspace</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="bxo-cinematic-hero__foot" data-bxo-hero-detail data-bxo-hero-foot>
              <div className="bxo-cinematic-hero__facts">
                <span>Private debt</span>
                <span>Fund interests</span>
                <span>Real estate SPVs</span>
              </div>
              <a href="#operating-model" className="bxo-scroll-cue" data-bxo-interactive>
                Enter the system
                <ArrowDown className="h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section id="operating-model" className="bxo-editorial-section border-b border-bxo-border-subtle" data-bxo-flow-section>
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
            <div className="bxo-statement-grid">
              <div data-bxo-reveal data-bxo-flow-heading>
                <div className="bxo-editorial-index">
                  <span>02</span>
                  <span>Operating model</span>
                </div>
                <h2 className="mt-7 max-w-4xl font-editorial text-5xl leading-[0.94] tracking-[-0.045em] text-bxo-text-primary sm:text-6xl lg:text-7xl">
                  A private asset is more than a token.
                </h2>
              </div>
              <div data-bxo-reveal data-bxo-flow-copy>
                <p className="max-w-3xl font-reading text-xl leading-9 text-bxo-text-secondary sm:text-2xl">
                  It is a set of rights, terms, approvals, people, obligations and evidence. BlockXOne keeps those parts connected before and after a network transaction.
                </p>
                <dl className="bxo-definition-list mt-10">
                  <div>
                    <dt>Before issuance</dt>
                    <dd>Terms, readiness, eligibility, wallet control, subscription and reconciliation.</dd>
                  </div>
                  <div>
                    <dt>At issuance</dt>
                    <dd>Exact authority, operation identity, signer policy, transaction and finality state.</dd>
                  </div>
                  <div>
                    <dt>After issuance</dt>
                    <dd>Holder balance, position evidence and an append-only legal-register sequence.</dd>
                  </div>
                </dl>
              </div>
            </div>

            <figure className="bxo-image-stage mt-16 lg:mt-24" data-bxo-image-reveal data-bxo-flow-media data-bxo-parallax-frame>
              <div className="bxo-image-stage__media bxo-image-stage__media--wide" data-bxo-parallax="section">
                <Image
                  src="/editorial/multi-asset-structures.webp"
                  alt="Three material studies representing private debt, fund interests and real estate structures"
                  fill
                  sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 3rem), (max-width: 1439px) calc(100vw - 4rem), 1376px"
                  quality={86}
                />
              </div>
              <figcaption className="bxo-image-stage__caption">
                <span data-bxo-media-caption-item>Three validated instrument structures</span>
                <span data-bxo-media-caption-item>One shared control foundation</span>
              </figcaption>
            </figure>

            <div className="mt-14 border-t border-bxo-border-subtle" data-bxo-reveal-group data-bxo-flow-sequence>
              {assetStructures.map(({ index, title, text, fields }) => (
                <article key={title} className="bxo-structure-row" data-bxo-reveal-item data-bxo-flow-step>
                  <span className="bxo-structure-row__index" data-bxo-flow-index>{index}</span>
                  <h3 data-bxo-flow-content>{title}</h3>
                  <p data-bxo-flow-content>{text}</p>
                  <ul aria-label={`${title} record areas`} data-bxo-flow-content>
                    {fields.map((field) => <li key={field}>{field}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bxo-light-section" aria-labelledby="lifecycle-heading" data-bxo-flow-section>
          <div className="mx-auto grid max-w-[90rem] gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:px-8 lg:py-32">
            <div className="lg:sticky lg:top-32 lg:self-start" data-bxo-reveal>
              <div data-bxo-flow-heading>
                <div className="bxo-editorial-index bxo-editorial-index--dark">
                  <span>03</span>
                  <span>Evidence chain</span>
                </div>
                <h2 id="lifecycle-heading" className="mt-7 max-w-xl font-ui text-4xl font-medium leading-[1.01] tracking-[-0.055em] text-[#071923] sm:text-5xl lg:text-6xl">
                  One lifecycle. <span className="font-reading font-normal italic text-[#087f96]">No missing middle.</span>
                </h2>
              </div>
              <p className="mt-7 max-w-lg font-reading text-lg leading-8 text-[#35515c]" data-bxo-flow-copy>
                Each stage has an input, an accountable decision and an evidence output. A blocked condition remains visible instead of being bypassed.
              </p>
            </div>

            <ol className="bxo-light-sequence" data-bxo-reveal-group data-bxo-flow-sequence>
              <span className="bxo-light-sequence__rail" data-bxo-flow-rail aria-hidden="true" />
              {lifecycle.map(([index, title, text]) => (
                <li key={title} className="bxo-light-sequence__row" data-bxo-reveal-item data-bxo-flow-step>
                  <span data-bxo-flow-index>{index}</span>
                  <div data-bxo-flow-content>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bxo-editorial-section border-b border-bxo-border-subtle" data-bxo-flow-section>
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
              <div data-bxo-reveal data-bxo-flow-heading>
                <div className="bxo-editorial-index">
                  <span>04</span>
                  <span>Product proof</span>
                </div>
                <h2 className="mt-7 max-w-3xl font-editorial text-5xl leading-[0.95] tracking-[-0.04em] text-bxo-text-primary sm:text-6xl lg:text-7xl">
                  The business record and the chain record, together.
                </h2>
              </div>
              <p className="max-w-3xl font-reading text-xl leading-8 text-bxo-text-secondary sm:text-2xl sm:leading-9" data-bxo-reveal data-bxo-flow-copy>
                Operators can follow the instrument, approval, investor, subscription, settlement, transaction and final position without stitching together an unexplained result.
              </p>
            </div>

            <div className="mt-14 lg:mt-20" data-bxo-product-story>
              <PlatformPreview />
            </div>
          </div>
        </section>

        <section className="bxo-editorial-section border-b border-bxo-border-subtle" data-bxo-flow-section>
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
            <div className="bxo-statement-grid">
              <div data-bxo-reveal data-bxo-flow-heading>
                <div className="bxo-editorial-index">
                  <span>05</span>
                  <span>Authority</span>
                </div>
                <h2 className="mt-7 max-w-3xl font-editorial text-5xl leading-[0.95] tracking-[-0.04em] text-bxo-text-primary sm:text-6xl lg:text-7xl">
                  Authority follows responsibility.
                </h2>
              </div>
              <p className="max-w-3xl font-reading text-xl leading-9 text-bxo-text-secondary sm:text-2xl" data-bxo-reveal data-bxo-flow-copy>
                Separate workspaces and permissions let each participant act on the same operating truth without inheriting someone else&apos;s authority.
              </p>
            </div>

            <figure className="bxo-image-stage mt-16 lg:mt-24" data-bxo-image-reveal data-bxo-flow-media data-bxo-parallax-frame>
              <div className="bxo-image-stage__media" data-bxo-parallax="section">
                <Image
                  src="/editorial/stewardship.webp"
                  alt="Private-market professionals reviewing legal records and an architectural model in a controlled workspace"
                  fill
                  sizes="(max-width: 639px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 3rem), (max-width: 1439px) calc(100vw - 4rem), 1376px"
                  quality={86}
                />
              </div>
              <figcaption className="bxo-image-stage__caption">
                <span data-bxo-media-caption-item>Shared operating truth</span>
                <span data-bxo-media-caption-item>Role-specific authority</span>
              </figcaption>
            </figure>

            <div className="bxo-responsibility-list mt-14" data-bxo-reveal-group data-bxo-flow-sequence>
              {responsibilities.map(([title, text], index) => (
                <article key={title} data-bxo-reveal-item data-bxo-flow-step>
                  <span data-bxo-flow-index>{String(index + 1).padStart(2, '0')}</span>
                  <h3 data-bxo-flow-content>{title}</h3>
                  <p data-bxo-flow-content>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bxo-evidence-statement" data-bxo-flow-section>
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
            <div className="bxo-editorial-index" data-bxo-reveal data-bxo-flow-heading>
              <span>06</span>
              <span>Position evidence</span>
            </div>
            <div className="mt-7 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
              <h2 className="max-w-5xl font-reading text-4xl leading-[1.03] tracking-[-0.04em] text-bxo-text-primary sm:text-6xl lg:text-7xl" data-bxo-reveal data-bxo-flow-heading>
                A completed position should be explainable down to its exact unit.
              </h2>
              <p className="max-w-2xl font-reading text-lg leading-8 text-bxo-text-secondary" data-bxo-reveal data-bxo-flow-copy>
                Finalization connects business authorization to network execution and appends the next hash-linked legal-register record.
              </p>
            </div>

            <div className="bxo-evidence-field-list mt-14 lg:mt-20" data-bxo-reveal-group data-bxo-flow-sequence>
              {evidenceFields.map((field, index) => (
                <div key={field} data-bxo-reveal-item data-bxo-flow-step>
                  <span data-bxo-flow-index>{String(index + 1).padStart(2, '0')}</span>
                  <strong data-bxo-flow-content>{field}</strong>
                </div>
              ))}
            </div>

            <div
              className="mt-20 grid gap-8 border-t border-bxo-border-subtle pt-10 lg:grid-cols-[1fr_auto] lg:items-end"
              data-bxo-reveal
              data-bxo-flow-actions
            >
              <div>
                <p className="font-editorial text-4xl leading-none text-bxo-text-primary sm:text-5xl">See the complete operating sequence.</p>
                <p className="mt-5 max-w-2xl font-reading text-base leading-8 text-bxo-text-secondary">
                  Explore every gate, decision and evidence output, or enter the workspace built for your role.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="bxo-primary-cta h-12 rounded-sm px-7 font-semibold">
                  <Link href="/how-it-works">
                    See how it works
                    <ArrowRight className="ml-2 h-4 w-4" data-bxo-motion-arrow aria-hidden="true" />
                  </Link>
                </Button>
                {showPortalAccess ? (
                  <Button asChild size="lg" variant="outline" className="bxo-secondary-cta h-12 rounded-sm px-7 font-semibold">
                    <Link href="/login">Choose a workspace</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
