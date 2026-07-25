import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  FileCheck2,
  Fingerprint,
  Landmark,
  Layers3,
  Network,
  ShieldCheck,
  Workflow,
} from 'lucide-react'

import { BrandMark } from '@/components/brand/brand-mark'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

const operatingLayers = [
  {
    title: 'Identity',
    text: 'Investor onboarding, qualification, and organization context.',
    icon: Fingerprint,
  },
  {
    title: 'Eligibility',
    text: 'Policy-driven access and transfer-control workflows.',
    icon: ShieldCheck,
  },
  {
    title: 'Issuance',
    text: 'Controlled token lifecycle instructions with operator separation.',
    icon: Layers3,
  },
  {
    title: 'Servicing',
    text: 'Reporting, distributions, transfers, and redemption operations.',
    icon: Workflow,
  },
]

const assetClasses = [
  {
    title: 'Private funds',
    text: 'Controlled fund vehicles with investor onboarding, subscriptions, servicing, and lifecycle reporting.',
    icon: Landmark,
  },
  {
    title: 'Private credit',
    text: 'Debt programs with governed issuance, eligibility, payout events, and transparent servicing.',
    icon: FileCheck2,
  },
  {
    title: 'Real-estate vehicles',
    text: 'Investor access, documents, issuance, and redemption workflows for property-backed structures.',
    icon: Building2,
  },
  {
    title: 'Structured products',
    text: 'Clear controls around issuance, settlement, cash-equivalent instruments, and structured debt.',
    icon: Network,
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

const trustSignals = [
  'Role-separated access',
  'Eligibility workflows',
  'Lifecycle traceability',
]

export default function HomePage() {
  return (
    <PublicShell>
      <main id="main-content">
        <section className="mx-auto grid min-h-[calc(100dvh-5rem)] max-w-7xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:py-24">
          <div className="bxo-hero-enter space-y-8">
            <div className="bxo-kicker">Multi-asset tokenization platform</div>

            <div className="space-y-6">
              <h1 className="max-w-4xl font-display text-4xl font-semibold leading-[1.12] tracking-[-0.025em] text-bxo-text-primary sm:text-5xl lg:text-[3.65rem]">
                Institutional control for tokenized private markets.
              </h1>
              <p className="max-w-3xl text-base leading-8 text-bxo-text-secondary sm:text-lg">
                BlockXOne brings investor onboarding, compliance controls, issuance, servicing, and reporting into one
                governed operating system for tokenized assets.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="bxo-primary-cta h-12 rounded-xl px-7 font-semibold">
                <Link href="/request-demo">
                  Request a demonstration
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bxo-secondary-cta h-12 rounded-xl px-7">
                <Link href="/investor/login">Investor login</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 rounded-xl px-7 text-bxo-text-secondary hover:bg-bxo-accent-soft hover:text-bxo-text-primary">
                <Link href="/operator/login">Operator login</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {trustSignals.map((signal) => (
                <div
                  key={signal}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-bxo-border-subtle bg-bxo-surface px-4 py-3 text-sm text-bxo-text-secondary"
                >
                  <BadgeCheck className="h-4 w-4 shrink-0 text-bxo-accent-primary" aria-hidden="true" />
                  {signal}
                </div>
              ))}
            </div>
          </div>

          <div className="bxo-hero-enter bxo-panel relative overflow-hidden p-5 [animation-delay:80ms] sm:p-7">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,var(--bxo-accent-muted),transparent_42%)]"
              aria-hidden="true"
            />
            <div className="relative flex min-h-[34rem] flex-col">
              <div className="flex items-center justify-between gap-4 border-b border-bxo-border-subtle pb-4">
                <div>
                  <div className="font-display text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">
                    Control plane
                  </div>
                  <div className="mt-1 text-sm text-bxo-text-tertiary">One governed lifecycle</div>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-bxo-text-secondary">
                  <span className="h-2 w-2 rounded-full bg-bxo-success" aria-hidden="true" />
                  Local demonstration
                </div>
              </div>

              <div className="flex flex-1 items-center justify-center py-5">
                <BrandMark size="hero" priority alt="BlockXOne BX1 emblem" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {operatingLayers.map(({ title, icon: Icon }) => (
                  <div
                    key={title}
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-bxo-border-subtle bg-bxo-bg-primary px-4 py-3"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bxo-accent-soft text-bxo-accent-primary">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="font-display text-xs font-semibold uppercase tracking-[0.1em] text-bxo-text-primary">
                      {title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-bxo-border-subtle bg-bxo-bg-secondary">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div className="space-y-4">
                <div className="bxo-kicker">Operating model</div>
                <h2 className="font-display text-3xl font-semibold leading-tight text-bxo-text-primary sm:text-4xl">
                  A token is only one layer.
                </h2>
              </div>
              <p className="max-w-3xl text-base leading-8 text-bxo-text-secondary">
                BlockXOne is designed around the full private-market lifecycle. Identity, eligibility, settlement,
                issuance, servicing, reporting, and redemption stay connected to the same controlled operating record.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {operatingLayers.map(({ title, text, icon: Icon }) => (
                <article key={title} className="bxo-card p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-bxo-accent-soft text-bxo-accent-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 font-display text-base font-semibold uppercase tracking-[0.08em] text-bxo-text-primary">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-bxo-text-secondary">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr]">
            <div className="space-y-5 lg:sticky lg:top-28 lg:self-start">
              <div className="bxo-kicker">Controlled lifecycle</div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-bxo-text-primary sm:text-4xl">
                From asset setup to redemption, one traceable path.
              </h2>
              <p className="text-base leading-8 text-bxo-text-secondary">
                The public experience makes the operating model legible without overstating certifications or release
                readiness that the platform has not yet earned.
              </p>
            </div>

            <ol className="grid gap-4">
              {lifecycle.map((step, index) => (
                <li key={step} className="bxo-card flex items-start gap-5 p-5 sm:p-6">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-bxo-accent-border bg-bxo-accent-soft font-mono text-sm font-semibold text-bxo-accent-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <div className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary">
                      Lifecycle stage
                    </div>
                    <p className="mt-2 text-base leading-7 text-bxo-text-secondary">{step}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y border-bxo-border-subtle bg-bxo-bg-secondary">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-3xl space-y-5">
              <div className="bxo-kicker">Multi-asset by design</div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-bxo-text-primary sm:text-4xl">
                One operating foundation across private-market structures.
              </h2>
              <p className="text-base leading-8 text-bxo-text-secondary">
                Different assets require different rules. The operating foundation remains consistent: identity,
                approvals, controlled issuance, servicing, and auditability.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {assetClasses.map(({ title, text, icon: Icon }) => (
                <article key={title} className="bxo-card p-6">
                  <Icon className="h-6 w-6 text-bxo-accent-primary" aria-hidden="true" />
                  <h3 className="mt-6 font-display text-base font-semibold uppercase tracking-[0.07em] text-bxo-text-primary">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-bxo-text-secondary">{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-5 lg:grid-cols-2">
            <article className="bxo-panel p-7 sm:p-8">
              <div className="bxo-kicker">Investor experience</div>
              <h2 className="mt-6 font-display text-2xl font-semibold leading-tight text-bxo-text-primary">
                Calm onboarding, qualification, and portfolio visibility.
              </h2>
              <p className="mt-4 text-sm leading-7 text-bxo-text-secondary">
                Investor access starts with understandable status, relevant opportunities, documents, orders, and
                lifecycle reporting. Wallet linking is additive, not the whole product.
              </p>
              <Button asChild variant="outline" className="bxo-secondary-cta mt-7 h-11 rounded-xl">
                <Link href="/for-investors">
                  Explore the investor model
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </article>

            <article className="bxo-panel p-7 sm:p-8">
              <div className="bxo-kicker">Operator experience</div>
              <h2 className="mt-6 font-display text-2xl font-semibold leading-tight text-bxo-text-primary">
                Issuance, compliance, treasury, and token operations.
              </h2>
              <p className="mt-4 text-sm leading-7 text-bxo-text-secondary">
                Operators work from structured queues, role-based controls, audit context, and servicing visibility,
                separate from investor access from the first screen onward.
              </p>
              <Button asChild variant="outline" className="bxo-secondary-cta mt-7 h-11 rounded-xl">
                <Link href="/for-operators">
                  Explore the operator model
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="bxo-panel overflow-hidden p-8 text-center sm:p-12">
            <div className="mx-auto max-w-3xl space-y-5">
              <div className="bxo-kicker justify-center">Choose the right entry point</div>
              <h2 className="font-display text-3xl font-semibold leading-tight text-bxo-text-primary sm:text-4xl">
                See BlockXOne through the role you operate.
              </h2>
              <p className="text-base leading-8 text-bxo-text-secondary">
                Existing investors and platform operators use separate access boundaries. New partners can request a
                guided demonstration of the current functional platform.
              </p>
            </div>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="bxo-primary-cta h-12 rounded-xl px-7 font-semibold">
                <Link href="/request-demo">Request a demonstration</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bxo-secondary-cta h-12 rounded-xl px-7">
                <Link href="/login">Choose a portal</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
