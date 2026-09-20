import { NextRequest, NextResponse } from 'next/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { portalCommandSchema } from '@/lib/portal/contracts'
import { isPortalSnapshot, PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const bytes = await readPortalBody(request, 65536)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('The request is not valid JSON.', 400) }
    const command = portalCommandSchema.safeParse(parsed)
    if (!command.success) throw new PortalError(command.error.issues[0]?.message ?? 'Check the request fields.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const { user } = await readPortal(client)
    const { data, error } = await client.rpc('bx1_portal_command', { command: command.data.command, request_key: command.data.key, payload: command.data.payload }).abortSignal(AbortSignal.timeout(15000))
    if (error) {
      if (error.code === '42501') throw new PortalError('You do not have current authority for this action.', 403)
      if (['22023', '23514', '23505', '40001', 'P0001'].includes(error.code)) throw new PortalError('The saved state or review requirements changed. Refresh and check the current requirements before retrying.', 409)
      throw new PortalError('The request outcome is uncertain. Refresh to check whether it saved; retry only with the same request key.', 503)
    }
    if (!isPortalSnapshot(data, user.id)) throw new PortalError('The saved result could not be read. Refresh before retrying.', 503)
    return jar.finish(privateResponse(NextResponse.json({ snapshot: data })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
