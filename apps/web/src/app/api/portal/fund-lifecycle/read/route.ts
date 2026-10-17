import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { PortalError, readPortal } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
const inputSchema = z.object({ operating_context: portalOperatingContextSchema }).strict()
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const bytes = await readPortalBody(request, 2048)
    let body: unknown
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('Invalid request.', 400) }
    const parsed = inputSchema.safeParse(body)
    if (!parsed.success) throw new PortalError('Select your workspace again.', 403)
    const page = await readPortal(createRequestSupabaseClient(jar.adapter), parsed.data.operating_context)
    if (page.user.id !== request.headers.get('x-bx1-expected-actor')) throw new PortalError('The signed-in account changed. Reload before continuing.', 403)
    return jar.finish(privateResponse(NextResponse.json({ snapshot: page.snapshot })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
