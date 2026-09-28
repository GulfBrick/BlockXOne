import { NextRequest, NextResponse } from 'next/server'
import { identityEnvironmentEnabled, platformRelease } from '@/lib/platform-release'
import { registrationMetadata, registrationProviderOutcome, validateRegistrationForm, type RegistrationError } from '@/lib/portal/registration'
import { canonicalAppOrigin, createRequestSupabaseClient, readVerifiedUser } from '@/lib/supabase/server'
import { hasCanonicalOrigin, InvalidAuthRequest, privateResponse, readAuthForm, responseCookieAdapter } from '@/lib/supabase/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function resultRedirect(outcome: 'check-email' | RegistrationError) {
  const query = outcome === 'check-email' ? 'status=check-email' : `error=${outcome}`
  return privateResponse(NextResponse.redirect(new URL(`/register?${query}`, canonicalAppOrigin()), 303))
}

function reject(status: number) {
  return privateResponse(NextResponse.json({ ok: false, error: 'Registration request unavailable.' }, { status }))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Registration creates a pending identity, never live investment admission.
  if (!identityEnvironmentEnabled(process.env)) return reject(404)
  const jar = responseCookieAdapter(request)
  try {
    if (request.nextUrl.pathname !== '/auth/register' || request.nextUrl.search) return reject(400)
    if (!hasCanonicalOrigin(request) || (request.headers.has('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) return reject(403)
    // Native form parsing rejects duplicate fields, invalid UTF-8 and bodies above 8 KiB.
    let form: URLSearchParams
    try { form = await readAuthForm(request) } catch (error) {
      if (error instanceof InvalidAuthRequest || error instanceof TypeError) return reject(400)
      throw error
    }
    const validated = validateRegistrationForm(form)
    if (!validated.ok) return resultRedirect(validated.error)
    const client = createRequestSupabaseClient(jar.adapter)
    // A registration attempt must not replace or sign out an existing signed-in account.
    if (await readVerifiedUser(client)) return jar.finish(privateResponse(NextResponse.redirect(new URL('/register', canonicalAppOrigin()), 303)))
    const { email, password, intent } = validated.value
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: new URL('/auth/confirm', canonicalAppOrigin()).toString(), data: registrationMetadata(intent, platformRelease(process.env)!.environment) },
    })
    if (data.session) {
      // Email confirmation is required. Never emit an auto-confirmed session cookie
      // if hosted Auth configuration unexpectedly changes; do not expose SDK details.
      try { await client.auth.signOut({ scope: 'local' }) } catch { /* Discard all staged cookie writes below. */ }
      return resultRedirect('unavailable')
    }
    // Supabase enforces hosted Auth rate limits; no process-local counter pretends to be a distributed guard.
    // Duplicate addresses and a new unconfirmed registration have the same public response.
    return jar.finish(resultRedirect(registrationProviderOutcome(error)))
  } catch {
    // No request body, password, email, token or provider text is logged or placed in a URL.
    // Unknown SDK outcomes do not emit possibly partial authentication cookies.
    return resultRedirect('unavailable')
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
