import { NextRequest, NextResponse } from 'next/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalContextMatches, portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { fundingVerificationSchema } from '@/lib/portal/funding-contracts'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

/** Caller credentials only. Chain facts and the service writer stay in Supabase. */
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before verification.', 403)
    const bytes = await readPortalBody(request, 8192)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('The request is not valid JSON.', 400) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PortalError('Check the verification fields.', 400)
    const { operating_context: rawContext, ...instruction } = parsed as Record<string, unknown>
    const context = portalOperatingContextSchema.safeParse(rawContext)
    if (!context.success) throw new PortalError('Select your operating context again.', 403)
    const verification = fundingVerificationSchema.safeParse(instruction)
    if (!verification.success) throw new PortalError('Check the verification reference. Receipt facts cannot be supplied by the browser.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readPortal(client, context.data)
    if (before.user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before verification.', 403)
    const { data: verified, error } = await client.functions.invoke('bx1-funding-verifier', {
      body: { ...verification.data, operating_context: context.data }, method: 'POST',
      headers: { 'x-bx1-expected-actor': expectedActor }, signal: AbortSignal.timeout(30000),
    })
    if (error) {
      const status = error.context instanceof Response ? error.context.status : 0
      if ([401, 403].includes(status)) throw new PortalError('This session no longer has authority to verify that funding record.', 403)
      if ([400, 409, 422].includes(status)) throw new PortalError('The transfer could not be verified against the current funding requirements. Refresh the evidence; no funding was inferred.', 409)
      throw new PortalError('Verification could not be confirmed. Refresh saved evidence before retrying. No payment or posting was initiated.', 503)
    }
    // A 202 pending result is HTTP-success to the SDK, but is not saved evidence.
    if (!verified || verified.ok !== true || verified.kind !== verification.data.kind || verified.id !== verification.data.id || !['VERIFIED', 'INVALID'].includes(verified.status)) throw new PortalError('The transfer remains unverified or pending. Refresh the evidence before retrying; no funding was inferred.', 409)
    const after = await readPortal(client, context.data)
    if (after.user.id !== expectedActor || after.snapshot.actor.id !== expectedActor || !portalContextMatches(after.snapshot.operating_context, context.data)) throw new PortalError('The operating account changed. Refresh saved evidence.', 403)
    return jar.finish(privateResponse(NextResponse.json({ snapshot: after.snapshot })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
