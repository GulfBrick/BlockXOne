import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthMode } from '@/lib/auth-mode'
import { authDocumentReferrerPolicy, type AuthReferrerPolicy } from '@/lib/auth-referrer-policy'
import { AUTH_ERROR_COPY, type AuthErrorCode } from '@/lib/supabase/contracts'
import { validateSetupPassword } from '@/lib/supabase/password-setup'
import { canonicalAppOrigin, createRequestSupabaseClient, readVerifiedUser, readWorkspace, secureCookieOptions } from '@/lib/supabase/server'
import { hasCanonicalOrigin, InvalidAuthRequest, LOGIN_EMAIL_COOKIE, PENDING_INVITE_COOKIE, privateResponse, readAuthForm, responseCookieAdapter } from '@/lib/supabase/http'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext } from '@/lib/supabase/mfa'
import { handleMfaAction, mfaErrorResponse } from '@/lib/supabase/mfa-actions'

export const dynamic = 'force-dynamic'
export const revalidate = 0
type Context = { params: Promise<{ action: string }> }
type PendingInvite = { tokenHash: string; type: 'invite' | 'recovery'; expiresAt: number }
const actions = new Set(['confirm', 'login', 'setup', 'logout', 'mfa-enroll', 'mfa-verify'])
const tokenPattern = /^[A-Za-z0-9_-]{32,512}$/

function htmlPage(title: string, content: string, status = 200, referrerPolicy: AuthReferrerPolicy = 'no-referrer'): NextResponse {
  // All interpolated arguments here are fixed application copy, never request
  // input, provider text, tokens or claims. No scripts or remote resources.
  return privateResponse(new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="${referrerPolicy}"><title>${title} | BlockXOne</title><style>html{color-scheme:dark}body{margin:0;background:#01070d;color:#eefbfc;font:16px/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:32rem;margin:8vh auto;padding:2rem 1rem}h1{font-size:2rem;line-height:1.2}p{color:#9cb8c4}a{color:#2eeffa;display:inline-block;padding:.75rem 0}button{min-height:44px;padding:.75rem 1.5rem;background:#2eeffa;color:#01070d;border:0;font:inherit;font-weight:600;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #2eeffa;outline-offset:4px}form{margin:1.5rem 0}</style></head><body><main id="main-content"><a href="/">BlockXOne</a><h1>${title}</h1>${content}</main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } }), referrerPolicy)
}

function errorResponse(code: AuthErrorCode, status: number, setup = false) {
  return htmlPage('Access unavailable', `<p role="alert">${AUTH_ERROR_COPY[code]}</p>${setup ? '<a href="/login?setup=1">Return to password setup</a>' : '<a href="/login">Return to sign in</a>'}`, status)
}
function redirect(path: string) { return privateResponse(NextResponse.redirect(new URL(path, canonicalAppOrigin()), 303)) }
function setupRetry(code: AuthErrorCode) {
  // Only fixed application result codes: no password, email, token, body or
  // provider message. Request correlation is supplied by the hosting platform.
  console.info(JSON.stringify({ event: 'auth_setup_result', code }))
  return redirect(`/login?setup=1&error=${code}`)
}
function clearPending(response: NextResponse) {
  response.cookies.set(PENDING_INVITE_COOKIE, '', secureCookieOptions({ maxAge: 0 }))
  return response
}
function invalidInvite(status = 400) {
  return clearPending(htmlPage('Invitation unavailable', '<p role="alert">This invitation link is invalid or has expired.</p><a href="/login">Return to sign in</a>', status))
}
function readPending(value: string | undefined): PendingInvite | null {
  try {
    if (!value || value.length > 1800) return null
    const parsed = JSON.parse(decodeURIComponent(value))
    if (!tokenPattern.test(parsed.tokenHash) || !['invite', 'recovery'].includes(parsed.type) || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now() || parsed.expiresAt > Date.now() + 600000) return null
    return parsed
  } catch { return null }
}

async function dispatch(request: NextRequest, context: Context): Promise<NextResponse> {
  const { action } = await context.params
  const mfaAction = action === 'mfa-enroll' || action === 'mfa-verify'
  const mode = resolveAuthMode()
  if (mode !== 'supabase') return mfaAction
    ? mfaErrorResponse(mode === 'invalid' ? 'unavailable' : 'unauthorised', mode === 'invalid' ? 503 : 404)
    : errorResponse(mode === 'invalid' ? 'unavailable' : 'access_denied', mode === 'invalid' ? 503 : 404)
  if (!actions.has(action)) return errorResponse('invalid_request', 404)
  const allowedMethod = action === 'confirm' ? ['GET', 'POST'] : ['POST']
  if (!allowedMethod.includes(request.method)) {
    const response = mfaAction ? mfaErrorResponse('invalid_request', 405) : errorResponse('invalid_request', 405)
    response.headers.set('Allow', allowedMethod.join(', '))
    return response
  }
  const jar = responseCookieAdapter(request)
  try {
    if (request.method === 'GET') {
      // GET only stages a token. Mail scanners cannot consume an invitation.
      const tokenHash = request.nextUrl.searchParams.get('token_hash')
      if (tokenHash !== null || request.nextUrl.searchParams.has('type')) {
        const type = request.nextUrl.searchParams.get('type')
        if (!tokenHash || !tokenPattern.test(tokenHash) || (type !== 'invite' && type !== 'recovery') || request.nextUrl.searchParams.getAll('token_hash').length !== 1 || request.nextUrl.searchParams.getAll('type').length !== 1) return invalidInvite()
        const pending: PendingInvite = { tokenHash, type, expiresAt: Date.now() + 600000 }
        const response = redirect('/auth/confirm')
        response.cookies.set(PENDING_INVITE_COOKIE, encodeURIComponent(JSON.stringify(pending)), secureCookieOptions({ maxAge: 600 }))
        return response
      }
      if (request.nextUrl.search || !readPending(request.cookies.get(PENDING_INVITE_COOKIE)?.value)) return invalidInvite()
      return htmlPage('Confirm your access', '<p>Continue to verify your invitation and set your password.</p><form method="post" action="/auth/confirm"><button type="submit">Continue securely</button></form><a href="/">Back to home</a>', 200, authDocumentReferrerPolicy('/auth/confirm', request.nextUrl.searchParams))
    }
    if (!hasCanonicalOrigin(request)) return mfaAction ? mfaErrorResponse('invalid_request', 403) : errorResponse('invalid_request', 403, action === 'setup')
    const form = await readAuthForm(request)
    const client = createRequestSupabaseClient(jar.adapter)
    if (mfaAction) return jar.finish(await handleMfaAction(action, form, client))
    if (action === 'confirm') {
      const pending = readPending(request.cookies.get(PENDING_INVITE_COOKIE)?.value)
      if (!pending) return invalidInvite()
      const { error } = await client.auth.verifyOtp({ token_hash: pending.tokenHash, type: pending.type })
      if (error) return jar.finish(clearPending(invalidInvite()))
      const mfa = await readMfaContext(client)
      return jar.finish(clearPending(redirect(mfa && !hasRequiredMfa(mfa) ? '/login/mfa?continue=setup' : '/login?setup=1')))
    }
    if (action === 'login') {
      const email = form.get('email')?.trim() ?? ''
      const password = form.get('password') ?? ''
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 1024) return errorResponse('invalid_request', 400)
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) {
        if (error.status === 429 || !error.status || error.status >= 500) return jar.finish(errorResponse('unavailable', 503))
        const response = redirect('/login?error=invalid_credentials')
        response.cookies.set(LOGIN_EMAIL_COOKIE, encodeURIComponent(email), secureCookieOptions({ maxAge: 300 }))
        return jar.finish(response)
      }
      const mfa = await readMfaContext(client)
      let destination = !mfa ? '/workspace/access-denied' : '/login/mfa'
      if (mfa && hasRequiredMfa(mfa)) {
        const workspace = await readWorkspace(client)
        if (!await isMfaContextCurrent(client, mfa)) return jar.finish(errorResponse('unavailable', 503))
        destination = workspace ? '/workspace' : '/workspace/access-denied'
      }
      const response = redirect(destination)
      response.cookies.set(LOGIN_EMAIL_COOKIE, '', secureCookieOptions({ maxAge: 0 }))
      return jar.finish(response)
    }
    if (action === 'setup') {
      const password = form.get('password') ?? ''
      const validationError = validateSetupPassword(password, form.get('confirmPassword') ?? '')
      if (validationError) return jar.finish(setupRetry(validationError))
      const mfa = await readMfaContext(client)
      if (!mfa) return jar.finish(errorResponse('access_denied', 403, true))
      if (!hasRequiredMfa(mfa)) return jar.finish(redirect('/login/mfa?continue=setup'))
      if (!await readWorkspace(client)) return jar.finish(errorResponse('access_denied', 403, true))
      if (!await isMfaContextCurrent(client, mfa)) return jar.finish(errorResponse('unavailable', 503, true))
      const { error } = await client.auth.updateUser({ password })
      if (error) {
        if (!error.status || error.status >= 500 || error.status === 429) return jar.finish(errorResponse('unavailable', 503, true))
        const code = error.code === 'same_password' ? 'password_same'
          : error.status === 401 || ['reauthentication_needed', 'reauthentication_not_valid', 'session_not_found', 'session_expired'].includes(error.code ?? '') ? 'password_reauthentication'
          : 'password_rejected'
        return jar.finish(setupRetry(code))
      }
      console.info(JSON.stringify({ event: 'auth_setup_result', code: 'password_saved' }))
      const updated = await readMfaContext(client)
      if (!updated) return jar.finish(redirect('/workspace/access-denied'))
      if (!hasRequiredMfa(updated)) return jar.finish(redirect('/login/mfa?continue=setup'))
      const workspace = await readWorkspace(client)
      if (!await isMfaContextCurrent(client, updated)) return jar.finish(errorResponse('unavailable', 503, true))
      return jar.finish(redirect(workspace ? '/workspace' : '/workspace/access-denied'))
    }
    if (!await readVerifiedUser(client)) return jar.finish(errorResponse('access_denied', 401))
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) return jar.finish(errorResponse('unavailable', 503))
    return jar.finish(clearPending(redirect('/login')))
  } catch (error) {
    if (mfaAction) return jar.finish(mfaErrorResponse(error instanceof InvalidAuthRequest ? 'invalid_request' : 'unavailable'))
    const response = error instanceof InvalidAuthRequest
      ? action === 'setup' ? setupRetry('setup_request_invalid') : errorResponse('invalid_request', 400)
      : errorResponse('unavailable', 503, action === 'setup')
    return jar.finish(action === 'confirm' ? clearPending(response) : response)
  }
}

export const GET = dispatch
export const POST = dispatch
export const PUT = dispatch
export const PATCH = dispatch
export const DELETE = dispatch
export const OPTIONS = dispatch
export const HEAD = dispatch
