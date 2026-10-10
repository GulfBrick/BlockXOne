import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient, readVerifiedUser } from '@/lib/supabase/server'
import { PortalError } from '@/lib/portal/server'
import { portalFailure } from '@/lib/portal/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PortalError('Open this evidence from your portal.', 403)
    const params = request.nextUrl.searchParams
    if ([...params.keys()].some(key => key !== 'application_id') || params.getAll('application_id').length !== 1)
      throw new PortalError('Invalid application reference.', 400)
    const id = params.get('application_id')
    if (!z.string().uuid().safeParse(id).success) throw new PortalError('Invalid application reference.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const user = await readVerifiedUser(client)
    if (!user?.email || !user.email_confirmed_at || user.is_anonymous) throw new PortalError('Sign in to view identity evidence.', 401)
    const { data, error } = await client.rpc('bx1_provider_evidence_read', { p_application: id }).abortSignal(AbortSignal.timeout(12000))
    if (error?.code === '42501') throw new PortalError('Identity evidence is not available in this context.', 403)
    if (error || !Array.isArray(data)) throw new PortalError('Identity evidence is temporarily unavailable.', 503)
    return jar.finish(privateResponse(NextResponse.json({ application_id: id, events: data })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
