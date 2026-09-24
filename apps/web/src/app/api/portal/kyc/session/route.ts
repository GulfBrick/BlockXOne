import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { readEntry } from '@/lib/portal/entry-server'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { bindProviderApplication, issueSumsubSandboxToken, providerEvidenceDatabaseConfig, sumsubSessionConfig } from '@/lib/portal/provider-evidence'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
const requestSchema = z.object({ application_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict()

async function currentSessionId(client: ReturnType<typeof createRequestSupabaseClient>, actorId: string): Promise<string> {
  const { data, error } = await client.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) throw new PortalError('Sign in again before starting identity verification.', 401)
  const verified = await client.auth.getUser(token)
  if (verified.error || verified.data.user?.id !== actorId) throw new PortalError('The signed-in account changed.', 403)
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
    if (claims.sub !== actorId || typeof claims.session_id !== 'string' || !z.string().uuid().safeParse(claims.session_id).success) throw new Error()
    return claims.session_id
  } catch { throw new PortalError('The signed-in session is unavailable.', 403) }
}

export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid identity-verification origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const actorId = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!z.string().uuid().safeParse(actorId).success) throw new PortalError('Refresh your signed-in account before continuing.', 403)
    const config = sumsubSessionConfig()
    providerEvidenceDatabaseConfig()
    const raw = await readPortalBody(request, 4096)
    let body: unknown
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { throw new PortalError('Invalid JSON request.', 400) }
    const instruction = requestSchema.safeParse(body)
    if (!instruction.success) throw new PortalError('Select the application and refresh its revision.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readEntry(client)
    const application = before.applications.find(item => item.id === instruction.data.application_id && item.user_id === before.actor.id)
    if (before.actor.id !== actorId) throw new PortalError('The signed-in account changed. Reload before continuing.', 403)
    if (!application || application.revision !== instruction.data.expected_revision
      || application.context_kind !== 'PERSONAL' || !['DRAFT','SUBMITTED','CHANGES_REQUIRED'].includes(application.status)
      || !['INVESTOR_ADMISSION','CUSTOMER_ORGANISATION_ADMISSION'].includes(application.admission_purpose))
      throw new PortalError('The application changed or is not available for identity verification.', 409)
    const levelName = application.persona === 'WEALTH_MANAGER' || application.details.investor_type === 'ENTITY'
      ? config.companyLevel : config.individualLevel
    const sessionId = await currentSessionId(client, actorId)
    const binding = await bindProviderApplication(actorId, sessionId, application.id, application.revision)
    const current = await readEntry(client)
    if (current.actor.id !== actorId || !current.applications.some(item => item.id === application.id
      && item.revision === application.revision && item.status === application.status))
      throw new PortalError('The application changed while preparing verification. Refresh and retry.', 409)
    const token = await issueSumsubSandboxToken(binding.external_user_id, levelName, config)
    const after = await readEntry(client)
    if (after.actor.id !== actorId || !after.applications.some(item => item.id === application.id
      && item.revision === application.revision && item.status === application.status))
      throw new PortalError('The application changed while preparing verification. Refresh and retry.', 409)
    return jar.finish(privateResponse(NextResponse.json({ token, expires_in_seconds: 600, level_name: levelName,
      application_id: application.id, application_revision: application.revision, environment: 'TESTNET' })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
