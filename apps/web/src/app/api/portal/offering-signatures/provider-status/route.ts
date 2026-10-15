import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { platformRelease } from '@/lib/platform-release'
import { TESTNET_APP_ORIGIN } from '@/lib/testnet-fund/contracts'
import { portalFailure } from '@/lib/portal/http'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalContextMatches, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { verifiedOfferingFileSession } from '@/lib/portal/offering-files-server'
import { readOfferingSignatures } from '@/lib/portal/offering-signatures-server'
import { readOfferingProviderStatus } from '@/lib/portal/offering-provider-status'
import { canonicalAppOrigin, createRequestSupabaseClient } from '@/lib/supabase/server'
import { privateResponse, responseCookieAdapter } from '@/lib/supabase/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 90

const pathname = '/api/portal/offering-signatures/provider-status'
const reference = z.string().uuid().regex(/^[0-9a-f-]{36}$/)
const querySchema = z.object({ product_id: reference, revision_id: reference, organisation: reference,
  role: z.literal('OfferingManager'), expected_actor: reference }).strict()

async function currentScope(client: SupabaseClient, actorId: string, context: PortalOperatingContext,
  productId: string, revisionId: string) {
  const { user, snapshot } = await readPortal(client, context)
  const product = snapshot.products.find(item => item.id === productId)
  if (user.id !== actorId || snapshot.actor.id !== actorId || !portalContextMatches(snapshot.operating_context, context)
    || !product || product.offering_package?.id !== revisionId || product.offering_package.origin !== 'SUBMITTED') {
    throw new PortalError('Select the current signed-in manager and submitted package before checking the provider.', 403)
  }
  const session = await verifiedOfferingFileSession(client, actorId)
  if (session.aal !== 'aal2') throw new PortalError('Verify your authenticator before checking the provider connection.', 403)
  // This restricted reader validates the live DB session/factor and scoped
  // record even while admission is NOT_ADMITTED. Admission is never inferred.
  const signatures = await readOfferingSignatures({ actorId, session, context, revisionId })
  if (signatures.actor_id !== actorId || signatures.session_id !== session.id || signatures.environment !== 'TESTNET'
    || signatures.product_id !== productId || signatures.revision_id !== revisionId
    || signatures.expected_revision !== product.revision || !portalContextMatches(signatures.context, context)) {
    throw new PortalError('The current package and signing scope could not be verified.', 403)
  }
  return { sessionId: session.id, revision: product.revision }
}

/** Private, browser-navigable diagnosis. Never a provider activation endpoint. */
export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    const origin = canonicalAppOrigin()
    if (platformRelease(process.env)?.environment !== 'TESTNET' || origin !== TESTNET_APP_ORIGIN) {
      throw new PortalError('Provider diagnosis is unavailable in this environment.', 404)
    }
    if (request.method !== 'GET') throw new PortalError('Use the signed-in provider status page.', 405)
    if (request.nextUrl.pathname !== pathname || request.nextUrl.origin !== origin
      || request.headers.get('host') !== new URL(origin).host
      || request.headers.get('sec-fetch-site') === 'cross-site'
      || request.headers.has('next-router-prefetch')
      || ['purpose', 'sec-purpose'].some(name => request.headers.get(name)?.includes('prefetch'))
      || request.headers.has('origin') && request.headers.get('origin') !== origin
      || request.nextUrl.hash || request.url.length > 2048) {
      throw new PortalError('Open provider status from this TEST application.', 403)
    }
    const params = request.nextUrl.searchParams
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new PortalError('Select one current product and manager scope.', 400)
    const parsed = querySchema.safeParse(Object.fromEntries(params))
    if (!parsed.success) throw new PortalError('Select the current product, package and manager scope.', 400)
    const query = parsed.data
    const context: PortalOperatingContext = { mode: 'ROLE', organisationId: query.organisation, role: query.role }
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await currentScope(client, query.expected_actor, context, query.product_id, query.revision_id)
    const status = await readOfferingProviderStatus()
    // Provider I/O cannot retain read authority after logout, revocation,
    // factor/session replacement or a package revision change.
    const after = await currentScope(client, query.expected_actor, context, query.product_id, query.revision_id)
    if (after.sessionId !== before.sessionId || after.revision !== before.revision) {
      throw new PortalError('The account, session or package changed. Reopen the current provider status page.', 403)
    }
    return jar.finish(privateResponse(NextResponse.json({ environment: 'TESTNET', provider: 'DOCUSIGN',
      check: 'SANDBOX_AUTHENTICATION_ONLY', ...status }, { status: status.status === 'AVAILABLE' ? 200 : 503 })))
  } catch (error) {
    return jar.finish(portalFailure(error instanceof PortalError ? error
      : new PortalError('Provider status could not be verified for this current session and package.', 503)))
  }
}
