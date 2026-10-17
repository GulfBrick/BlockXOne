import Link from 'next/link'
import { PublicShell } from '@/components/public/public-shell'
import { PasswordRecoveryForm } from '@/components/auth/password-recovery-form'
import { identityEnvironmentEnabled } from '@/lib/platform-release'
import { authDocumentReferrerPolicy } from '@/lib/auth-referrer-policy'
import { isPasswordRecoveryError, PASSWORD_RECOVERY_CHECK_EMAIL_COPY } from '@/lib/supabase/password-recovery'

export const dynamic = 'force-dynamic'
export const revalidate = 0
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export async function generateMetadata({ searchParams }: Props) {
  return { title: 'Reset your password', robots: { index: false, follow: false }, referrer: authDocumentReferrerPolicy('/forgot-password', await searchParams) }
}

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const params = await searchParams
  const available = identityEnvironmentEnabled(process.env)
  const requested = available && params.status === 'check-email'
  return <PublicShell>
    <main id="main-content" className="mx-auto w-full max-w-md px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-ui text-3xl font-medium leading-tight tracking-tight text-bxo-text-primary sm:text-4xl">{requested ? 'Check your email' : 'Reset your password'}</h1>
      {!available ? <p role="alert" className="mt-4 text-base leading-6 text-bxo-text-secondary">Password recovery is temporarily unavailable. Please try again later.</p>
        : requested ? <div role="status" className="mt-5 rounded-lg border border-bxo-border-default p-4 text-base leading-7 text-bxo-text-primary"><p>{PASSWORD_RECOVERY_CHECK_EMAIL_COPY}</p><p className="mt-3">Open the link from this environment to choose a new password. Never share the link or your password.</p></div>
          : <><p className="mt-4 text-base leading-7 text-bxo-text-secondary">Enter the email address you use for BlockXOne. We will send a link to choose a new password.</p><PasswordRecoveryForm error={isPasswordRecoveryError(params.error) ? params.error : undefined} /></>}
      <Link href="/login" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-bxo-accent-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bxo-accent-primary">Back to sign in</Link>
    </main>
  </PublicShell>
}
