import { NextRequest, NextResponse } from 'next/server'
import { canonicalAppOrigin } from '@/lib/supabase/server'
import { privateResponse } from '@/lib/supabase/http'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { parseSumsubWebhook, providerEvidenceDatabaseConfig, recordProviderEvidence, sumsubWebhookConfig, verifySumsubWebhookDigest } from '@/lib/portal/provider-evidence'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const expected = canonicalAppOrigin()
    if (request.nextUrl.search || request.nextUrl.origin !== expected || request.headers.get('host') !== new URL(expected).host)
      throw new PortalError('Invalid provider destination.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Invalid provider media type.', 415)
    const config = sumsubWebhookConfig()
    providerEvidenceDatabaseConfig()
    const raw = await readPortalBody(request, 65536)
    if (!verifySumsubWebhookDigest(raw, request.headers.get('x-payload-digest-alg'), request.headers.get('x-payload-digest'), config.secret))
      throw new PortalError('Provider signature verification failed.', 401)
    const input = parseSumsubWebhook(raw, config.clientId)
    const receipt = await recordProviderEvidence(input)
    return privateResponse(NextResponse.json({ received: true, duplicate: receipt.duplicate, ordering_state: receipt.ordering_state }, { status: 200 }))
  } catch (error) { return portalFailure(error) }
}
