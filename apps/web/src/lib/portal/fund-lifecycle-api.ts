import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import type { z } from 'zod'
import { createRequestSupabaseClient, readVerifiedUser } from '@/lib/supabase/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { portalFailure, readPortalBody } from './http'
import { PortalError } from './server'
import { FundLifecycleError, fundLifecycleEnvironment, readFundLifecycle } from './fund-lifecycle-server'
import type { PortalOperatingContext } from './operating-context'

/** Same authenticated/canonical web boundary; no service-role or URL-supplied authority. */
export async function fundApiRequest<T extends { operating_context: PortalOperatingContext }>(request: NextRequest, schema: z.ZodType<T>,
  action: (input: T, context: { actorId: string; client: ReturnType<typeof createRequestSupabaseClient> }) => Promise<unknown>) {
  const jar = responseCookieAdapter(request)
  try {
    if (fundLifecycleEnvironment() !== 'TESTNET') throw new PortalError('Fund execution is not admitted in MAIN.', 409)
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const expectedActor = request.headers.get('x-bx1-expected-actor')
    if (!expectedActor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before continuing.', 403)
    const body = await readPortalBody(request, 65536)
    let json: unknown
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) } catch { throw new PortalError('The request is not valid JSON.', 400) }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new PortalError('Check the fund instruction and saved version.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const user = await readVerifiedUser(client)
    if (!user?.email_confirmed_at || user.is_anonymous || user.id !== expectedActor) throw new PortalError('The signed-in account changed. Sign in again before continuing.', 403)
    const snapshot = await readFundLifecycle(client, user.id, parsed.data.operating_context)
    if (snapshot.availability !== 'AVAILABLE') throw new PortalError('The connected fund workflow is not available in this environment yet.', 409)
    return jar.finish(privateResponse(NextResponse.json(await action(parsed.data, { actorId: user.id, client }))))
  } catch (error) {
    return jar.finish(portalFailure(error instanceof FundLifecycleError ? new PortalError(error.message, error.status) : error))
  }
}

export function requireFundRpcResult(data: unknown, error: { code?: string } | null): Record<string, unknown> {
  if (error) throw new PortalError(error.code === '42501' ? 'Your current authority does not permit this fund action.'
    : 'The fund requirements changed or the action could not be confirmed. Refresh the saved operation before retrying.', error.code === '42501' ? 403 : 409)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PortalError('The saved fund instruction could not be verified.', 503)
  return data as Record<string, unknown>
}
