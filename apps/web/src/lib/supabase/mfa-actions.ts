import 'server-only'

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { privateResponse } from './http'
import { MFA_CONTINUATIONS, type MfaContinuation, type MfaErrorCode } from './mfa-contracts'
import { hasRequiredMfa, isMfaContextCurrent, readMfaContext, requireRecentTotp, toMfaView } from './mfa'

const statuses: Record<MfaErrorCode, number> = {
  invalid_request: 400, unauthorised: 401, invalid_code: 400, rate_limited: 429,
  unavailable: 503, pending_setup_exists: 409, already_enrolled: 409, unsupported_factor: 403,
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function uuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) && value !== '00000000-0000-0000-0000-000000000000'
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function continuation(value: unknown): value is MfaContinuation { return value === 'workspace' || value === 'setup' || value === 'security' }

export function mfaErrorResponse(error: MfaErrorCode, status = statuses[error]): NextResponse {
  return privateResponse(NextResponse.json({ ok: false, error }, { status }))
}
function providerFailure(error: { status?: number; code?: string }, verify: boolean): NextResponse {
  if (error.status === 429) return mfaErrorResponse('rate_limited')
  if (error.status === 401 || ['session_not_found', 'session_expired'].includes(error.code ?? '')) return mfaErrorResponse('unauthorised')
  if (verify && ['mfa_verification_failed', 'mfa_verification_rejected', 'mfa_challenge_expired'].includes(error.code ?? '')) return mfaErrorResponse('invalid_code')
  // Unknown outcomes/provider limits/configuration failures require a fresh
  // page load, never an automatic enrollment or verification retry.
  return mfaErrorResponse('unavailable')
}
function enrollmentProjection(value: unknown): { factorId: string; qrCode: string; secret: string } | null {
  if (!record(value) || !uuid(value.id) || value.type !== 'totp' || !record(value.totp)) return null
  const qrCode = value.totp.qr_code
  const secret = value.totp.secret
  if (typeof qrCode !== 'string' || qrCode.length > 65536
    || !/^data:image\/svg\+xml;utf-8,<svg\b[\s\S]*<\/svg>\s*$/.test(qrCode)
    || typeof secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(secret)) return null
  return { factorId: value.id, qrCode, secret }
}

// The HTTP route performs canonical Origin/Host, method and bounded-body
// admission and must apply its SAME cookie adapter's finish() to this result.
// This helper never logs any input, provider object or caught exception.
export async function handleMfaAction(action: string, form: URLSearchParams, client: SupabaseClient): Promise<NextResponse> {
  try {
    if (action !== 'mfa-enroll' && action !== 'mfa-verify') return mfaErrorResponse('invalid_request', 404)
    const fields = action === 'mfa-enroll' ? [] : ['factorId', 'code', 'continuation']
    if ([...form.keys()].some((key) => !fields.includes(key) || form.getAll(key).length !== 1)
      || fields.some((key) => !form.has(key))) return mfaErrorResponse('invalid_request')
    const factorId = form.get('factorId')
    const code = form.get('code')
    const destination = form.get('continuation')
    if (action === 'mfa-verify' && (!uuid(factorId) || typeof code !== 'string' || !/^[0-9]{6}$/.test(code) || !continuation(destination))) return mfaErrorResponse('invalid_request')
    const context = await readMfaContext(client)
    // Deliberately use the same response for invalid and inactive bootstrap;
    // callers cannot use this API to distinguish assignments/factor existence.
    if (!context) return mfaErrorResponse('unauthorised')
    const view = toMfaView(context)
    if (action === 'mfa-enroll') {
      if (view.state !== 'unenrolled') return mfaErrorResponse('already_enrolled')
      if (view.hasPendingTotp) return mfaErrorResponse('pending_setup_exists')
      if (!await isMfaContextCurrent(client, context)) return mfaErrorResponse('unauthorised')
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BlockXOne authenticator' })
      if (error) return providerFailure(error, false)
      const enrollment = enrollmentProjection(data)
      if (!enrollment) return mfaErrorResponse('unavailable')
      const body = { ok: true, ...enrollment }
      // Keep the entire serialized UTF-8 response within the client's bounded
      // parser, including JSON escaping and multi-byte QR characters.
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 131072) return mfaErrorResponse('unavailable')
      return privateResponse(NextResponse.json(body))
    }
    if (view.state === 'unsupported_factor') return mfaErrorResponse('unsupported_factor')
    const factor = view.factors.find((candidate) => candidate.id === factorId)
    if (!factor || (factor.status === 'unverified' && (destination !== 'security' || view.state !== 'unenrolled'))) return mfaErrorResponse('unauthorised', 403)
    // Repeat the narrow type guards for control-flow narrowing, never cast
    // posted authority. Challenge IDs are created and consumed only here.
    if (!uuid(factorId) || typeof code !== 'string' || !continuation(destination)) return mfaErrorResponse('invalid_request')
    if (!await isMfaContextCurrent(client, context)) return mfaErrorResponse('unauthorised')
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code })
    if (error) return providerFailure(error, true)
    const upgraded = await readMfaContext(client)
    if (!upgraded || !hasRequiredMfa(upgraded) || !requireRecentTotp(upgraded, Math.floor(Date.now() / 1000)).allowed) return mfaErrorResponse('unavailable')
    return privateResponse(NextResponse.json({ ok: true, next: MFA_CONTINUATIONS[destination] }))
  } catch { return mfaErrorResponse('unavailable') }
}
