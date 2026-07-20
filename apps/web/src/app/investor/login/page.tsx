import Link from 'next/link'

import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

export default function InvestorLoginPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-6">
            <div className="inline-flex rounded-md border border-[#3B82F6]/25 bg-[#3B82F6]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#60A5FA]">
              Investor access
            </div>
            <h1 className="font-[family:var(--font-display)] text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Access tokenized opportunities through the investor portal.
            </h1>
            <p className="text-base leading-8 text-white/65 sm:text-lg">
              Investor access is designed for onboarding, qualification status, asset discovery, portfolio visibility,
              documents, and redemption workflows. Wallet linking should happen after identity is established.
            </p>

            <div className="grid gap-4">
              {[
                'Create an investor account or log in with your assigned credentials.',
                'Complete qualification and KYC steps inside the investor journey.',
                'Review opportunities, documents, and portfolio activity in one place.',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4 text-sm leading-7 text-white/65">
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="rounded-md border-white/12 bg-white/5 text-white hover:bg-white/10">
                <Link href="/for-investors">Why investors use BlockXOne</Link>
              </Button>
              <Button asChild variant="ghost" className="rounded-md text-white/75 hover:bg-white/8 hover:text-white">
                <Link href="/operator/login">Operator access instead</Link>
              </Button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(7,16,29,0.96),rgba(6,11,21,0.9))] p-6 sm:p-8">
            <EmailLoginForm
              allowSignup
              title="Investor login"
              description="Use your email and password to access the investor journey. New investors can create an account here."
              footerNote="Wallet linking belongs inside the investor experience after your identity is established."
              signupLabel="Create investor account"
            />
            <div className="mt-4 text-sm text-white/55">
              New here?{' '}
              <Link href="/investor/register" className="font-medium text-[#60A5FA] transition hover:text-[#93BBFC]">
                Create an investor account
              </Link>
            </div>
          </section>
        </div>
      </main>
    </PublicShell>
  )
}
