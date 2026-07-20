import Link from 'next/link'

import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

const portals = [
  {
    title: 'Investor access',
    text: 'For onboarding, qualification, portfolio visibility, documents, subscriptions, and redemption workflows.',
    href: '/investor/login',
    cta: 'Go to investor login',
  },
  {
    title: 'Operator access',
    text: 'For issuer, compliance, treasury, tokenisation, and platform administration workflows.',
    href: '/operator/login',
    cta: 'Go to operator login',
  },
]

export default function LoginChooserPage() {
  return (
    <PublicShell>
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <section className="max-w-3xl space-y-5">
          <div className="inline-flex rounded-md border border-[#3B82F6]/25 bg-[#3B82F6]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#60A5FA]">
            Access selection
          </div>
          <h1 className="text-4xl font-semibold text-white sm:text-5xl">Choose the BlockXOne portal that matches your role.</h1>
          <p className="text-base leading-8 text-white/65 sm:text-lg">
            The platform no longer treats investors and operators as the same audience. Select the entry point that matches
            the work you need to do.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {portals.map((portal) => (
            <div key={portal.title} className="rounded-[1.75rem] border border-white/8 bg-white/[0.04] p-8">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#60A5FA]/80">{portal.title}</div>
              <p className="mt-4 text-sm leading-7 text-white/62">{portal.text}</p>
              <div className="mt-8">
                <Button asChild size="lg" className="rounded-md bg-[#3B82F6] px-7 text-white hover:bg-[#2563EB]">
                  <Link href={portal.href}>{portal.cta}</Link>
                </Button>
              </div>
            </div>
          ))}
        </section>
      </main>
    </PublicShell>
  )
}
