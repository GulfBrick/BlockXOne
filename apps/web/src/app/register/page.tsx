import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { PublicShell } from '@/components/public/public-shell'
import { RegistrationForm } from '@/components/portal/registration-form'
import { isDemoEnvironment } from '@/lib/testnet-fund/contracts'
import { isRegistrationError, isRegistrationIntent, REGISTRATION_CHECK_EMAIL, REGISTRATION_TERMS_VERSION } from '@/lib/portal/registration'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return { title: 'Create your account | BlockXOne', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/register', await searchParams) }
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isDemoEnvironment(process.env)) notFound()
  const params = await searchParams
  const checkEmail = params.status === 'check-email'
  return <PublicShell><main id="main-content" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
    <div className="grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
      <section className="lg:sticky lg:top-28">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-bxo-accent-primary">BlockXOne / Get started</p>
        <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-bxo-accent-border bg-bxo-accent-soft px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-bxo-accent-primary"><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />Hosted test environment</p>
        <h1 className="mt-6 font-ui text-[clamp(2.5rem,4.5vw,4.5rem)] font-medium leading-[1.03] tracking-[-0.05em] text-bxo-text-primary">Your next step<br /><span className="text-bxo-accent-primary">in private markets.</span></h1>
        <p className="mt-6 max-w-md text-lg leading-8 text-bxo-text-secondary">One account. A clear path from registration to a reviewed investor or wealth-manager application.</p>
        <ol className="mt-9 space-y-5 border-t border-bxo-border-subtle pt-8">
          {['Create your personal login', 'Confirm your email address', 'Complete your application for review'].map((label, index) => <li key={label} className="flex items-center gap-4 text-sm text-bxo-text-secondary"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-bxo-border-default font-semibold tabular-nums text-bxo-accent-primary">{index + 1}</span>{label}</li>)}
        </ol>
        <div className="mt-9 flex gap-3 border-t border-bxo-border-subtle pt-6 text-sm leading-6 text-bxo-text-secondary"><ShieldCheck aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-bxo-accent-primary" /><p>Your login is personal. Organisation permissions and MetaMask signing authority are assigned separately. No wallet connection is needed to register.</p></div>
      </section>
      <section aria-labelledby="registration-title" className="rounded-2xl border border-bxo-border-default bg-bxo-bg-secondary p-5 shadow-2xl shadow-black/20 sm:p-8 lg:p-10">
        {checkEmail ? <><span className="flex h-12 w-12 items-center justify-center rounded-full bg-bxo-accent-soft text-bxo-accent-primary"><Check aria-hidden="true" className="h-6 w-6" /></span><h2 id="registration-title" className="mt-6 text-3xl font-medium tracking-tight text-bxo-text-primary">Check your email</h2><p role="status" className="mt-4 text-base leading-7 text-bxo-text-secondary">{REGISTRATION_CHECK_EMAIL}</p><p className="mt-4 text-sm leading-6 text-bxo-text-secondary">Check your spam folder too. This message does not confirm account approval or email delivery.</p><Link href="/login" className="mt-8 flex min-h-12 items-center justify-between rounded-lg bg-bxo-accent-primary px-5 py-3 font-semibold text-bxo-bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bxo-bg-primary">Go to sign in<ArrowRight aria-hidden="true" className="h-5 w-5" /></Link><Link href="/register" className="mt-4 inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline underline-offset-4">Return to registration</Link></> : <><h2 id="registration-title" className="text-2xl font-medium tracking-tight text-bxo-text-primary">Create your account</h2><p className="mb-8 mt-3 text-sm leading-6 text-bxo-text-secondary">All fields are required. Use your own login; do not share passwords.</p><RegistrationForm initialIntent={isRegistrationIntent(params.intent) ? params.intent : undefined} error={isRegistrationError(params.error) ? params.error : undefined} /></>}
      </section>
    </div>
    <div className="mt-16 grid gap-8 border-t border-bxo-border-subtle pt-8 text-sm leading-7 text-bxo-text-secondary lg:grid-cols-2">
      <section id="testnet-terms" className="scroll-mt-28"><h2 className="text-base font-semibold text-bxo-text-primary">Testnet terms</h2><p className="mt-3">This environment is for testing BlockXOne workflows with fictional investment information and testnet assets. It is not a live investment offer. Do not send real investment money or upload real identity documents. Registration and email confirmation do not approve an application, grant organisation access or authorise transactions.</p><p className="mt-3">Keep your login personal. Use synthetic data in testing and only interact with wallets you control or are explicitly authorised to use. Never provide a wallet seed phrase or private key.</p></section>
      <section id="registration-privacy" className="scroll-mt-28"><h2 className="text-base font-semibold text-bxo-text-primary">Registration privacy notice</h2><p className="mt-3">Your email address, chosen application path and acknowledgement of these terms are submitted to the hosted Supabase authentication service to create and manage your test login. Your password is handled by Supabase Auth. Confirmation messages use the platform’s configured email service. Account and application access remain subject to separate review.</p><p className="mt-3">This registration does not request marketing permission. Use only the personal information needed for your login, and synthetic information in test applications. For questions about your test account or removal, contact <a href="mailto:daniel@bx1.co.za" className="text-bxo-accent-primary underline underline-offset-4">daniel@bx1.co.za</a>. These disclosures apply to this test registration, not production investment admission.</p></section>
    </div><p className="mt-6 text-xs text-bxo-text-tertiary">Test registration notice version: {REGISTRATION_TERMS_VERSION}</p>
  </main></PublicShell>
}
