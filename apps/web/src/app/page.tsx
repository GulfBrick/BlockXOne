import Link from 'next/link'

import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

const assetClasses = [
  {
    title: 'Private funds',
    text: 'Launch and service controlled fund vehicles with investor onboarding, subscription workflows, and lifecycle reporting.',
  },
  {
    title: 'Private credit',
    text: 'Structure debt programs with controlled issuance, eligibility rules, payout events, and transparent servicing.',
  },
  {
    title: 'Real-estate vehicles',
    text: 'Manage investor access, issuance, documents, and redemption workflows for property-backed structures.',
  },
  {
    title: 'Structured products',
    text: 'Support cash-equivalent and structured debt programs with clear controls around issuance and settlement.',
  },
]

const lifecycle = [
  'Structure the asset and define operating controls.',
  'Onboard and qualify investors and counterparties.',
  'Approve subscriptions and settlement instructions.',
  'Issue controlled on-chain positions under policy.',
  'Service reporting, distributions, and lifecycle events.',
  'Redeem or transfer under eligibility and audit controls.',
]

const pillars = [
  'Investor onboarding and qualification',
  'Eligibility and transfer controls',
  'Token lifecycle operations',
  'Treasury and servicing workflows',
  'Audit-ready reporting and operator traceability',
  'Separate investor and operator access boundaries',
]

export default function HomePage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8 lg:py-20">
        <section className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex rounded-md border border-[#3B82F6]/25 bg-[#3B82F6]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#60A5FA]">
              Multi-asset tokenization platform
            </div>
            <div className="space-y-5">
              <h1 className="font-[family:var(--font-display)] max-w-4xl text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
                Tokenize and operate private-market assets with institutional control.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-white/65 sm:text-lg">
                BlockXOne combines investor onboarding, compliance controls, issuance, servicing, and reporting into one
                operating system for tokenized funds, private credit, real-estate vehicles, and structured products.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-md bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA] px-7 text-white shadow-lg shadow-[#3B82F6]/15">
                <Link href="/request-demo">Request demo</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-md border-white/12 bg-white/5 px-7 text-white hover:bg-white/10">
                <Link href="/investor/login">Investor login</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="rounded-md px-7 text-white/80 hover:bg-white/8 hover:text-white">
                <Link href="/operator/login">Operator login</Link>
              </Button>
            </div>

            <div className="grid gap-3 text-sm text-white/55 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">Built for regulated private-market assets</div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">Designed for investor and operator separation</div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">Centered on auditable servicing and controls</div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[#3B82F6]/15 bg-[linear-gradient(180deg,rgba(9,14,24,0.96),rgba(9,16,29,0.88))] p-6 shadow-[0_30px_120px_rgba(59,130,246,0.14)]">
            <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-6">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">Operating model</div>
              <h2 className="font-[family:var(--font-display)] mt-4 text-2xl font-semibold text-white">A token is only one layer.</h2>
              <p className="mt-3 text-sm leading-7 text-white/60">
                BlockXOne is designed around the full lifecycle: onboarding, eligibility, issuance, settlement,
                servicing, transfers, reporting, and redemption.
              </p>

              <div className="mt-8 grid gap-4">
                {pillars.map((pillar, index) => (
                  <div key={pillar} className="flex gap-4 rounded-2xl border border-white/8 bg-[#111827] px-4 py-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3B82F6]/12 text-sm font-semibold text-[#60A5FA]">
                      {index + 1}
                    </div>
                    <div className="text-sm leading-6 text-white/68">{pillar}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-20 space-y-8">
          <div className="max-w-3xl space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">What tokenization means</div>
            <h2 className="font-[family:var(--font-display)] text-3xl font-semibold text-white sm:text-4xl">BlockXOne treats tokenization as an operating system, not a wallet demo.</h2>
            <p className="text-base leading-8 text-white/62">
              The platform is designed to coordinate legal structure, investor identity, eligibility, issuance, settlement,
              servicing, and audit around the token. That is the difference between a product that can survive institutional
              scrutiny and one that cannot.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-4">
            {assetClasses.map((item) => (
              <div key={item.title} className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-6">
                <div className="text-sm font-semibold uppercase tracking-[0.14em] text-[#60A5FA]/80">{item.title}</div>
                <p className="mt-4 text-sm leading-7 text-white/62">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">How BlockXOne works</div>
            <h2 className="font-[family:var(--font-display)] text-3xl font-semibold text-white sm:text-4xl">From asset setup to redemption, one controlled lifecycle.</h2>
            <p className="text-base leading-8 text-white/62">
              The public experience should make the process legible: issuers and operators configure the asset, investors
              qualify and subscribe, and the platform coordinates issuance and servicing with clear controls and reporting.
            </p>
          </div>

          <div className="grid gap-4">
            {lifecycle.map((step, index) => (
              <div key={step} className="rounded-[1.5rem] border border-white/8 bg-[#111827]/85 px-5 py-5">
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#60A5FA]/20 bg-[#3B82F6]/10 text-sm font-semibold text-[#93C5FD]">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-7 text-white/68">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-7">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">Investor experience</div>
            <h3 className="font-[family:var(--font-display)] mt-4 text-2xl font-semibold text-white">Calm onboarding, qualification, and reporting.</h3>
            <p className="mt-3 text-sm leading-7 text-white/62">
              Investor access should start with clear onboarding, qualification status, asset discovery, portfolio visibility,
              documents, and redemption workflows. Wallet linking is additive, not the whole product.
            </p>
            <div className="mt-6">
              <Button asChild variant="outline" className="rounded-md border-white/12 bg-white/5 text-white hover:bg-white/10">
                <Link href="/for-investors">See investor model</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-7">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">Operator experience</div>
            <h3 className="font-[family:var(--font-display)] mt-4 text-2xl font-semibold text-white">Issuance, compliance, treasury, and token ops in one control plane.</h3>
            <p className="mt-3 text-sm leading-7 text-white/62">
              Operators need structured queues, role-based controls, audit trails, and servicing visibility. That experience
              should be separate from investor access from the first screen onward.
            </p>
            <div className="mt-6">
              <Button asChild variant="outline" className="rounded-md border-white/12 bg-white/5 text-white hover:bg-white/10">
                <Link href="/for-operators">See operator model</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-20 rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(8,15,28,0.98),rgba(4,9,18,0.92))] p-8 sm:p-10">
          <div className="max-w-3xl space-y-5">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">Controls and trust</div>
            <h2 className="font-[family:var(--font-display)] text-3xl font-semibold text-white sm:text-4xl">Built to make controlled asset operations legible.</h2>
            <p className="text-base leading-8 text-white/62">
              Public messaging should describe the intended control posture without claiming certifications the platform has
              not yet earned. The important story is operational clarity: eligibility, auditability, role-based access, and
              lifecycle traceability.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              'Role-based access and operator separation',
              'Eligibility and transfer-control workflows',
              'Auditable servicing and operational history',
              'Clear investor and operator route boundaries',
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-5 text-sm leading-7 text-white/65">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 rounded-[2rem] border border-[#3B82F6]/12 bg-[#3B82F6]/[0.06] p-8 text-center sm:p-10">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#60A5FA]/80">Next step</div>
            <h2 className="font-[family:var(--font-display)] text-3xl font-semibold text-white sm:text-4xl">Choose the right BlockXOne entry point.</h2>
            <p className="text-base leading-8 text-white/62">
              Existing investors and platform operators should no longer share one generic login. Start with the surface that
              matches your role.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="rounded-md bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA] px-7 text-white">
              <Link href="/investor/login">Investor login</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-md border-white/12 bg-white/5 px-7 text-white hover:bg-white/10">
              <Link href="/operator/login">Operator login</Link>
            </Button>
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
