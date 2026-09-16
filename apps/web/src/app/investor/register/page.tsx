import Link from 'next/link'

import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

export default function InvestorRegisterPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-6">
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Investor registration
            </div>
            <h1 className="font-[family:var(--font-display)] text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Create investor access for the BlockXOne portal.
            </h1>
            <p className="text-base leading-8 text-white/65 sm:text-lg">
              Registration is for investor onboarding only. Operator, issuer, compliance, treasury, and admin users should
              use the operator access path with assigned credentials.
            </p>

            <div className="grid gap-4">
              {[
                'Investor accounts enter the qualification and KYC workflow after sign-up.',
                'Portfolio, documents, and subscriptions sit inside the investor portal once access is established.',
                'Operator and administrative access do not belong on this route.',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4 text-sm leading-7 text-white/65">
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/5 text-white hover:bg-white/10">
                <Link href="/investor/login">Already have investor access?</Link>
              </Button>
              <Button asChild variant="ghost" className="rounded-full text-white/75 hover:bg-white/8 hover:text-white">
                <Link href="/operator/login">Operator access instead</Link>
              </Button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(7,16,29,0.96),rgba(6,11,21,0.9))] p-6 sm:p-8">
            <EmailLoginForm
              allowSignup
              initialMode="signup"
              title="Create investor account"
              description="Set up investor access first. Qualification, documents, and wallet linking happen inside the investor journey."
              footerNote="If you already have investor credentials, switch back to the login flow."
              signupLabel="Use login instead"
            />
          </section>
        </div>
      </main>
    </PublicShell>
  )
}
