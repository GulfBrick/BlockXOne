import { NextRequest, NextResponse } from 'next/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { portalCommandSchema } from '@/lib/portal/contracts'
import { isPortalSnapshot, PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalContextMatches, portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { readMfaContext, isMfaContextCurrent } from '@/lib/supabase/mfa'
import { isTestOrdinaryEntryAllowed, testOrdinaryEntryMfaPaused } from '@/lib/supabase/test-ordinary-entry'
import { readSyntheticCompliance } from '@/lib/portal/synthetic-compliance'
import { parseSyntheticComplianceSnapshot } from '@/lib/portal/synthetic-compliance-contracts'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before saving.', 403)
    const bytes = await readPortalBody(request, 65536)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('The request is not valid JSON.', 400) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PortalError('Check the request fields.', 400)
    const { operating_context: rawContext, ...instruction } = parsed as Record<string, unknown>
    const context = portalOperatingContextSchema.safeParse(rawContext)
    if (!context.success) throw new PortalError('Select your operating context again before saving.', 403)
    const command = portalCommandSchema.safeParse(instruction)
    if (!command.success) throw new PortalError(command.error.issues[0]?.message ?? 'Check the request fields.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const mfa = context.data.mode === 'ROLE' && context.data.role === 'ComplianceOfficer' && testOrdinaryEntryMfaPaused(process.env) ? await readMfaContext(client) : null
    const synthetic = Boolean(mfa && isTestOrdinaryEntryAllowed(mfa))
    if (synthetic && command.data.command !== 'review_application') throw new PortalError('Only designated synthetic admission reviews are available without authenticator verification.', 403)
    const { user, snapshot: before } = synthetic && mfa ? await readSyntheticCompliance(client, context.data, mfa) : await readPortal(client, context.data)
    if (user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before saving.', 403)
    if (synthetic && command.data.command === 'review_application' && !before.applications.some(application => application.id === command.data.payload.application_id)) throw new PortalError('This case is not assigned for synthetic review.', 403)
    const { data, error } = await client.rpc(synthetic ? 'bx1_portal_synthetic_compliance_command' : 'bx1_portal_command_scoped', { command: command.data.command, request_key: command.data.key, payload: command.data.payload, operating_context: context.data }).abortSignal(AbortSignal.timeout(15000))
    if (error) {
      if (error.code === '42501') throw new PortalError('You do not have current authority for this action.', 403)
      if (['22023', '23514', '23505', '40001', 'P0001'].includes(error.code)) throw new PortalError('The saved state or review requirements changed. Refresh and check the current requirements before retrying.', 409)
      throw new PortalError('The request outcome is uncertain. Refresh to check whether it saved; retry only with the same request key.', 503)
    }
    if (synthetic && mfa) {
      const saved = parseSyntheticComplianceSnapshot(data, user.id, context.data)
      if (!saved || command.data.command !== 'review_application' || !saved.applications.some(application => application.id === command.data.payload.application_id)
        || !await isMfaContextCurrent(client, mfa)) throw new PortalError('The saved result could not be read. Refresh before retrying.', 503)
    } else if (!isPortalSnapshot(data, user.id) || data.rehearsal !== undefined || !portalContextMatches(data.operating_context, context.data)) throw new PortalError('The saved result could not be read. Refresh before retrying.', 503)
    return jar.finish(privateResponse(NextResponse.json({ snapshot: data })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
