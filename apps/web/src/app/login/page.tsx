import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { PublicShell } from '@/components/public/public-shell'
import { SupabaseAuthForm } from '@/components/auth/supabase-auth-form'
import { resolveAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { isAuthErrorCode } from '@/lib/supabase/contracts'
import { LOGIN_EMAIL_COOKIE } from '@/lib/supabase/http'
import { createPageSupabaseClient } from '@/lib/supabase/page'
import { readWorkspace } from '@/lib/supabase/server'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { isDemoEnvironment } from '@/lib/testnet-fund/contracts'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return { title: 'Sign in', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/login', await searchParams) }
}

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

function LoginChooserPage() {
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

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = resolveAuthMode()
  if (mode === 'legacy') return <LoginChooserPage />
  const params = await searchParams
  const setup = params.setup === '1'
  let unavailable = mode !== 'supabase'
  let validSetup = !setup
  let mfaRequired = false
  if (setup && !unavailable) {
    try {
      const client = await createPageSupabaseClient()
      const context = await readMfaContext(client)
      if (context) {
        mfaRequired = !hasRequiredMfa(context)
        if (!mfaRequired) {
          validSetup = Boolean(await readWorkspace(client))
          if (!await isMfaContextCurrent(client, context)) throw new Error('Access unavailable')
        }
      }
    }
    catch { unavailable = true }
  }
  if (!unavailable && mfaRequired) redirect('/login/mfa?continue=setup')
  let initialEmail = ''
  if (!setup) {
    try {
      const saved = (await cookies()).get(LOGIN_EMAIL_COOKIE)?.value
      const decoded = saved ? decodeURIComponent(saved) : ''
      if (decoded.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded)) initialEmail = decoded
    } catch { /* Email-only convenience is not an authorization input. */ }
  }
  return (
    <PublicShell>
      <main id="main-content" className="mx-auto w-full max-w-md px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-bxo-accent-primary">Secure access</p>
        <h1 className="mt-4 font-ui text-3xl font-medium leading-tight tracking-tight text-bxo-text-primary sm:text-4xl">{setup ? 'Set your password' : 'Sign in to BlockXOne'}</h1>
        {unavailable ? <p role="alert" className="mt-6 text-base text-bxo-text-secondary">Access is temporarily unavailable. Please try again.</p>
          : !validSetup ? <p role="alert" className="mt-6 text-base text-bxo-text-secondary">This invitation link is invalid or has expired.</p>
          : <SupabaseAuthForm mode={setup ? 'setup' : 'login'} initialEmail={initialEmail} error={isAuthErrorCode(params.error) ? params.error : undefined} />}
        {!setup && !unavailable && isDemoEnvironment(process.env) ? <section aria-labelledby="test-account-title" className="mt-8 border-t border-bxo-border-subtle pt-6"><h2 id="test-account-title" className="text-base font-medium text-bxo-text-primary">New to BlockXOne?</h2><p className="mt-2 text-sm leading-6 text-bxo-text-secondary">Create a personal test login, then apply as an investor or wealth manager. Registration does not grant approval or signing authority.</p><Link href="/register" className="mt-4 inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-bxo-accent-border bg-bxo-accent-soft px-4 py-3 text-sm font-semibold text-bxo-accent-primary hover:border-bxo-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Create your test account<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link></section> : null}
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center text-sm text-bxo-accent-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Back to home</Link>
      </main>
    </PublicShell>
  )
}
