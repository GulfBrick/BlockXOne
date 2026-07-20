import Link from 'next/link'

import { EmailLoginForm } from '@/components/auth/EmailLoginForm'
import { PublicShell } from '@/components/public/public-shell'
import { Button } from '@/components/ui/button'

export default function OperatorLoginPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-6">
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              Operator access
            </div>
            <h1 className="font-[family:var(--font-display)] text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Access the operator control plane.
            </h1>
            <p className="text-base leading-8 text-white/65 sm:text-lg">
              Operator access is for issuer, compliance, treasury, tokenisation, transfer, and platform administration
              workflows. This surface is role-based and intentionally separate from investor access.
            </p>

            <div className="grid gap-4">
              {[
                'Use assigned credentials for staff and institutional operator accounts.',
                'Role-based routing sends you to the correct operating surface after authentication.',
                'Investor registration and onboarding are handled separately to reduce role confusion and risk.',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] px-5 py-4 text-sm leading-7 text-white/65">
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="rounded-full border-white/12 bg-white/5 text-white hover:bg-white/10">
                <Link href="/for-operators">See the operator model</Link>
              </Button>
              <Button asChild variant="ghost" className="rounded-full text-white/75 hover:bg-white/8 hover:text-white">
                <Link href="/investor/login">Investor access instead</Link>
              </Button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/8 bg-[linear-gradient(180deg,rgba(7,16,29,0.96),rgba(6,11,21,0.9))] p-6 sm:p-8">
            <EmailLoginForm
              allowSignup={false}
              title="Operator login"
              description="Use your assigned BlockXOne credentials. Operator access is controlled by role and organization context."
              footerNote="Investor onboarding does not happen on this route."
            />
          </section>
        </div>
      </main>
    </PublicShell>
  )
}
