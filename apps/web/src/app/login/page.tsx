import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { PublicShell } from '@/components/public/public-shell'

const portals = [
  {
    index: '01',
    label: 'For investors',
    title: 'Investor workspace',
    text: 'Review opportunities, complete qualification steps, manage documents, follow subscriptions, and monitor your portfolio.',
    href: '/investor/login',
    cta: 'Investor sign in',
  },
  {
    index: '02',
    label: 'For institutions',
    title: 'Institutional workspace',
    text: 'Manage issuance, compliance, treasury, tokenisation, transfers, and platform administration.',
    href: '/operator/login',
    cta: 'Institutional sign in',
  },
]

export default function LoginChooserPage() {
  return (
    <PublicShell>
      <main id="main-content" className="mx-auto max-w-[90rem] px-4 pb-24 pt-14 sm:px-6 sm:pt-20 lg:px-8 lg:pb-32 lg:pt-24">
        <section className="grid gap-10 border-b border-bxo-border-subtle pb-14 sm:pb-20 lg:grid-cols-12 lg:gap-8 lg:pb-24">
          <div className="lg:col-span-2" data-bxo-hero-detail>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-bxo-accent-primary">Secure access</p>
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-bxo-text-tertiary">BXO / Access</p>
          </div>

          <div className="lg:col-span-7">
            <h1 className="max-w-5xl text-bxo-text-primary">
              <span className="block overflow-hidden pb-1">
                <span className="block font-ui text-[clamp(3.3rem,7vw,7.4rem)] font-medium leading-[0.9] tracking-[-0.065em]" data-bxo-hero-line>
                  Choose your
                </span>
              </span>
              <span className="block overflow-hidden pb-2">
                <span className="block font-editorial text-[clamp(4rem,8vw,8.6rem)] leading-[0.86] tracking-[-0.045em] text-bxo-accent-primary" data-bxo-hero-line>
                  workspace.
                </span>
              </span>
            </h1>
          </div>

          <div className="self-end lg:col-span-3" data-bxo-hero-detail>
            <p className="max-w-md font-reading text-xl leading-8 text-bxo-text-secondary sm:text-2xl sm:leading-9">
              One platform, with access shaped around the work each participant is authorised to perform.
            </p>
          </div>
        </section>

        <section className="grid gap-10 pt-10 lg:grid-cols-12 lg:gap-8 lg:pt-14" aria-labelledby="workspace-routes-title">
          <div className="lg:col-span-2" data-bxo-reveal>
            <h2 id="workspace-routes-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-bxo-text-tertiary">
              Workspace routes
            </h2>
          </div>

          <div className="lg:col-span-10">
            {portals.map((portal) => (
              <Link
                key={portal.title}
                href={portal.href}
                className="group grid min-h-44 gap-6 border-t border-bxo-border-subtle py-8 transition-colors duration-300 hover:border-bxo-accent-border hover:bg-bxo-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-inset last:border-b sm:grid-cols-[4rem_minmax(0,1fr)_3rem] sm:items-center sm:px-4 lg:grid-cols-[6rem_minmax(14rem,0.72fr)_minmax(18rem,1fr)_3rem] lg:px-6"
                data-bxo-reveal
              >
                <span className="font-reading text-xl italic text-bxo-text-tertiary transition-colors group-hover:text-bxo-accent-primary">
                  {portal.index}
                </span>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">{portal.label}</span>
                  <h3 className="mt-3 font-ui text-3xl font-medium leading-tight tracking-[-0.04em] text-bxo-text-primary sm:text-4xl">
                    {portal.title}
                  </h3>
                </div>

                <div className="sm:col-start-2 lg:col-start-auto">
                  <p className="max-w-xl font-reading text-lg leading-7 text-bxo-text-secondary sm:text-xl sm:leading-8">{portal.text}</p>
                  <span className="mt-5 inline-block text-sm font-semibold text-bxo-text-primary lg:hidden">{portal.cta}</span>
                </div>

                <span className="flex h-12 w-12 items-center justify-center border border-bxo-border-default text-bxo-text-primary transition-[border-color,background-color,color,transform] duration-300 group-hover:translate-x-1 group-hover:border-bxo-accent-primary group-hover:bg-bxo-accent-primary group-hover:text-bxo-bg-primary" aria-hidden="true">
                  <ArrowRight className="h-5 w-5" />
                </span>
                <span className="sr-only">{portal.cta}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </PublicShell>
  )
}
