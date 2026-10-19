import { NextRequest, NextResponse } from 'next/server'
import { identityEnvironmentEnabled } from '@/lib/platform-release'
import type { PasswordRecoveryError } from '@/lib/supabase/password-recovery'
import { canonicalAppOrigin, createRequestSupabaseClient } from '@/lib/supabase/server'
import { hasCanonicalOrigin, InvalidAuthRequest, privateResponse, readAuthForm, responseCookieAdapter } from '@/lib/supabase/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type RecoveryOutcome = 'check-email' | PasswordRecoveryError

function resultRedirect(outcome: RecoveryOutcome) {
  const query = outcome === 'check-email' ? 'status=check-email' : 'error=' + outcome
  return privateResponse(NextResponse.redirect(new URL('/forgot-password?' + query, canonicalAppOrigin()), 303))
}

function reject(status: number) {
  return privateResponse(NextResponse.json({
    ok: false,
    error: status === 503
      ? 'Password reset is temporarily unavailable. Please try again later.'
      : 'Use the password-reset form on this site to request a recovery email.',
  }, { status }))
}

function providerOutcome(error: unknown): 'check-email' | 'rate-limited' | 'unavailable' {
  if (error === null) return 'check-email'
  try {
    if (typeof error === 'object' && !Array.isArray(error)) {
      const provider = error as { status?: unknown; code?: unknown }
      if (provider.status === 429 || provider.code === 'over_email_send_rate_limit'
        || provider.code === 'over_request_rate_limit') return 'rate-limited'
    }
  } catch { /* Never inspect or log raw provider messages or hostile accessors. */ }
  return 'unavailable'
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.method !== 'POST') return methodNotAllowed()
  // Same configured identity family as registration; no separate auth backend.
  if (!identityEnvironmentEnabled(process.env)) return reject(503)
  try {
    if (request.nextUrl.pathname !== '/auth/recover' || request.nextUrl.search) return resultRedirect('invalid-request')
    if (!hasCanonicalOrigin(request)
      || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) return reject(403)

    let form: URLSearchParams
    try { form = await readAuthForm(request) } catch (error) {
      if (error instanceof InvalidAuthRequest || error instanceof TypeError) return resultRedirect('invalid-request')
      throw error
    }
    // Only the address is accepted. Redirects, account identifiers, passwords
    // and role/context data never enter this request or provider options.
    for (const key of form.keys()) {
      if (key !== 'email' || form.getAll(key).length !== 1) return resultRedirect('invalid-request')
    }
    const email = form.get('email')?.trim() ?? ''
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return resultRedirect('email-invalid')

    const jar = responseCookieAdapter(request)
    const client = createRequestSupabaseClient(jar.adapter)
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('/auth/confirm', canonicalAppOrigin()).toString(),
    })
    // Supabase supplies the same success for an unknown address. Ignore its
    // data entirely; do not look up users or expose whether an account exists.
    // Its hosted Auth limits remain authoritative, with no per-process proxy.
    return jar.finish(resultRedirect(providerOutcome(error)))
  } catch (error) {
    // Unknown partial SDK outcomes do not emit staged cookie writes. A retry
    // may follow an already sent email; the public copy stays generic.
    const outcome = providerOutcome(error)
    try { return resultRedirect(outcome === 'check-email' ? 'unavailable' : outcome) } catch { return reject(503) }
  }
}

function methodNotAllowed() {
  const response = reject(405)
  response.headers.set('Allow', 'POST')
  return response
}

export const GET = methodNotAllowed
export const HEAD = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const OPTIONS = methodNotAllowed
