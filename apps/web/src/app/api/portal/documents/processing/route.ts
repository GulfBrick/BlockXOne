import { NextRequest, NextResponse } from 'next/server'
import { canonicalAppOrigin } from '@/lib/supabase/server'
import { privateResponse } from '@/lib/supabase/http'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { documentProcessingConfig, DocumentProcessingError, executeDocumentProcessing,
  verifyDocumentProcessingMessage } from '@/lib/portal/document-processing'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

/** Scanner adapter service only; browser cookies confer no processing authority. */
export async function POST(request: NextRequest) {
  try {
    const expected = canonicalAppOrigin()
    if (request.nextUrl.search || request.nextUrl.hash || request.nextUrl.origin !== expected
      || request.headers.get('host') !== new URL(expected).host || request.headers.has('origin')
      || request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new PortalError('Invalid document processing destination.', 403)
    }
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
      throw new PortalError('Invalid document processing media type.', 415)
    }
    const config = documentProcessingConfig()
    const raw = await readPortalBody(request, 4096)
    const command = verifyDocumentProcessingMessage(raw,
      request.headers.get('x-bx1-scanner-timestamp'), request.headers.get('x-bx1-scanner-signature'), config)
    const outcome = await executeDocumentProcessing(command, config)
    if (outcome.command === 'BYTES') {
      // Raw 4 MiB stays below the hosting response limit; base64 would not.
      return privateResponse(new NextResponse(Buffer.from(outcome.bytes), { headers: {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(outcome.bytes.byteLength),
        'Content-Disposition': `attachment; filename="${outcome.documentId}.bin"`,
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      } }))
    }
    return privateResponse(NextResponse.json(outcome.command === 'CLAIM' ? { job: outcome.job } : outcome.receipt))
  } catch (error) {
    return portalFailure(error instanceof DocumentProcessingError ? new PortalError(error.message, error.status) : error)
  }
}
