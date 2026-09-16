import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { PublicShell } from '@/components/public/public-shell'

const workspaceDetails = [
  ['Access', 'Assigned to institutional teams'],
  ['Control', 'Permissions matched to each responsibility'],
  ['Separation', 'Investor access remains independently scoped'],
]

export default function OperatorLoginPage() {
  return (
    <PublicShell>
      <main id="main-content" className="mx-auto max-w-[90rem] px-4 pb-24 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-32 lg:pt-24">
        <div className="grid gap-16 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-24">
          <section className="min-w-0 lg:col-span-7">
            <div className="flex items-center justify-between gap-4 border-b border-bxo-border-subtle pb-5" data-bxo-hero-detail>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-bxo-accent-primary">Institutional access</p>
              <p className="text-xs uppercase tracking-[0.14em] text-bxo-text-tertiary">BXO / 02</p>
            </div>

            <h1 className="mt-10 max-w-4xl text-bxo-text-primary">
              <span className="block overflow-hidden pb-1">
                <span className="block font-ui text-[clamp(3.2rem,6.2vw,6.8rem)] font-medium leading-[0.92] tracking-[-0.065em]" data-bxo-hero-line>
                  Enter the
                </span>
              </span>
              <span className="block overflow-hidden pb-2">
                <span className="block font-editorial text-[clamp(3.05rem,15.5vw,7.8rem)] leading-[0.87] tracking-[-0.045em] text-bxo-accent-primary" data-bxo-hero-line>
                  institutional
                </span>
              </span>
              <span className="block overflow-hidden pb-2">
                <span className="block font-ui text-[clamp(3.2rem,6.2vw,6.8rem)] font-medium leading-[0.92] tracking-[-0.065em]" data-bxo-hero-line>
                  workspace.
                </span>
              </span>
            </h1>

            <p className="mt-10 max-w-2xl font-reading text-xl leading-8 text-bxo-text-secondary sm:text-2xl sm:leading-9" data-bxo-hero-detail>
              Manage issuance, compliance, treasury, tokenisation, transfers, and platform administration with access scoped to your organisation and role.
            </p>
          </section>

          <section className="self-end border-y border-bxo-border-subtle py-8 sm:py-10 lg:col-span-4 lg:col-start-9" data-bxo-hero-detail>
            <div>
              <EmailLoginForm
                allowSignup={false}
                title="Institutional sign in"
                description="Use the BlockXOne credentials assigned to your organisation."
                footerNote="Access is limited to authorised users and their assigned roles."
              />
            </div>
          </section>

          <section className="lg:col-span-7" aria-labelledby="institutional-workspace-title" data-bxo-reveal>
            <h2 id="institutional-workspace-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-bxo-text-tertiary">
              Your workspace
            </h2>
            <dl className="mt-5 border-b border-bxo-border-subtle">
              {workspaceDetails.map(([term, description]) => (
                <div key={term} className="grid gap-2 border-t border-bxo-border-subtle py-5 sm:grid-cols-[8rem_1fr] sm:items-baseline">
                  <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-bxo-accent-primary">{term}</dt>
                  <dd className="font-reading text-lg leading-7 text-bxo-text-secondary">{description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <nav className="space-y-3 lg:col-span-4 lg:col-start-9" aria-label="Institutional access links" data-bxo-reveal>
            <Link
              href="/for-operators"
              className="group flex min-h-12 items-center justify-between gap-4 border-b border-bxo-border-default py-3 text-sm font-semibold text-bxo-text-primary transition-colors hover:border-bxo-accent-primary hover:text-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary"
            >
              Explore institutional workflows
              <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/investor/login"
              className="group flex min-h-12 items-center justify-between gap-4 border-b border-bxo-border-subtle py-3 text-sm text-bxo-text-secondary transition-colors hover:border-bxo-accent-border hover:text-bxo-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary"
            >
              Investor sign in
              <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </nav>
        </div>
      </main>
    </PublicShell>
  )
}
