import { NextRequest, NextResponse } from 'next/server'
import { platformRelease } from '@/lib/platform-release'
import { canonicalAppOrigin, createRequestSupabaseClient } from '@/lib/supabase/server'
import { privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { readEntry } from '@/lib/portal/entry-server'
import type { EntrySnapshot } from '@/lib/portal/entry-contracts'
import { PortalError } from '@/lib/portal/server'
import { portalFailure } from '@/lib/portal/http'
import { readSumsubSandboxReadiness } from '@/lib/portal/provider-evidence'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

const diagnosticRoles = new Set(['SuperAdmin', 'ComplianceOfficer', 'OfferingManager', 'IssuerFundManager'])
function staffContexts(snapshot: EntrySnapshot): Set<string> {
  return new Set(snapshot.contexts.flatMap(context => context.roles.filter(role => diagnosticRoles.has(role))
    .map(role => `${context.organisation_id}:${role}`)))
}

/** Read-only staff diagnostic. No credential, applicant mutation or provider outcome crosses this boundary. */
export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    if (platformRelease(process.env)?.environment !== 'TESTNET') throw new PortalError('Sandbox provider diagnostics are unavailable in this environment.', 404)
    if (request.nextUrl.search) throw new PortalError('Open the provider diagnostic without query parameters.', 400)
    const origin = canonicalAppOrigin()
    const suppliedOrigin = request.headers.get('origin')
    if (request.nextUrl.origin !== origin || request.headers.get('host') !== new URL(origin).host
      || (suppliedOrigin !== null && suppliedOrigin !== origin)
      || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? ''))
      throw new PortalError('Open the provider diagnostic from the signed-in TEST site.', 403)
    const expectedActor = request.headers.get('x-bx1-expected-actor')
    if (expectedActor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedActor))
      throw new PortalError('Invalid signed-in account reference.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readEntry(client)
    if (expectedActor !== null && before.actor.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before continuing.', 403)
    const contexts = staffContexts(before)
    if (contexts.size === 0) throw new PortalError('An existing authorised staff context is required for this diagnostic.', 403)
    const readiness = await readSumsubSandboxReadiness()
    // The provider call can wait. Recheck the actual actor and the same existing
    // staff authority before releasing even this sanitised configuration result.
    const after = await readEntry(client)
    if (after.actor.id !== before.actor.id || ![...staffContexts(after)].some(context => contexts.has(context)))
      throw new PortalError('Your signed-in staff context changed. Reload before continuing.', 403)
    return jar.finish(privateResponse(NextResponse.json({ actor_id: after.actor.id, ...readiness })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
