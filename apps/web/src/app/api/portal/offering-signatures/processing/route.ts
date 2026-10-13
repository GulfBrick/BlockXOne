import { NextRequest, NextResponse } from 'next/server'
import { privateResponse } from '@/lib/supabase/http'
import { readPortalBody } from '@/lib/portal/http'
import { requirePortalEnvironment, PortalError } from '@/lib/portal/server'
import { executeSignatureProcessing, OfferingSignatureError, signatureWorkerConfig,
  verifySignatureWorkerMessage } from '@/lib/portal/offering-signatures-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
      throw new OfferingSignatureError('Invalid signature processing message.', 400)
    }
    const raw = await readPortalBody(request, 4096)
    const command = verifySignatureWorkerMessage(raw, request.headers.get('x-bx1-signature-timestamp'),
      request.headers.get('x-bx1-signature-hmac'), signatureWorkerConfig())
    return privateResponse(NextResponse.json(await executeSignatureProcessing(command)))
  } catch (error) {
    return privateResponse(NextResponse.json({ error: error instanceof OfferingSignatureError || error instanceof PortalError ? error.message
      : 'Signature processing could not be confirmed. Resume the saved operation.' },
    { status: error instanceof OfferingSignatureError || error instanceof PortalError ? error.status : 503 }))
  }
}
