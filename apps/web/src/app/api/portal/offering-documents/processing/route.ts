import { NextRequest, NextResponse } from 'next/server'
import { canonicalAppOrigin } from '@/lib/supabase/server'
import { privateResponse } from '@/lib/supabase/http'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { executeOfferingDocumentProcessing, offeringDocumentProcessingConfig, OfferingDocumentProcessingError,
  verifyOfferingDocumentProcessingMessage } from '@/lib/portal/offering-document-processing'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

/** Service-only offering protocol: admission HMACs and browser cookies confer no authority. */
export async function POST(request: NextRequest) {
  try {
    const expected = canonicalAppOrigin()
    if (request.nextUrl.search || request.nextUrl.hash || request.nextUrl.origin !== expected
      || request.headers.get('host') !== new URL(expected).host || request.headers.has('origin')
      || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new PortalError('Invalid offering document processing destination.', 403)
    }
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
      throw new PortalError('Invalid offering document processing media type.', 415)
    }
    const config = offeringDocumentProcessingConfig()
    const command = verifyOfferingDocumentProcessingMessage(await readPortalBody(request, 4096),
      request.headers.get('x-bx1-scanner-timestamp'), request.headers.get('x-bx1-scanner-signature'), config)
    const outcome = await executeOfferingDocumentProcessing(command, config)
    if (outcome.command === 'BYTES') {
      return privateResponse(new NextResponse(Buffer.from(outcome.bytes), { headers: {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(outcome.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${outcome.fileId}.bin"`,
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      } }))
    }
    return privateResponse(NextResponse.json(outcome.command === 'CLAIM' ? { job: outcome.job } : outcome.receipt))
  } catch (error) {
    return portalFailure(error instanceof OfferingDocumentProcessingError ? new PortalError(error.message, error.status) : error)
  }
}
