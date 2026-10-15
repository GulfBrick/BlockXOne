import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalOperatingContextSchema } from '@/lib/portal/operating-context'
import { offeringSignatureRequestSchema, offeringSignatureResponseSchema } from '@/lib/portal/offering-signatures'
import { verifiedOfferingFileSession } from '@/lib/portal/offering-files-server'
import { readOfferingSignatures, executeOfferingSignatureCommand, downloadOfferingSignatureArtifact,
  createOfferingSigningView, OfferingSignatureError } from '@/lib/portal/offering-signatures-server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { scheduleOfferingSignatureWake } from '@/lib/portal/offering-signature-wake'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 60
const id = z.string().uuid().regex(/^[0-9a-f-]{36}$/)

export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    const params = request.nextUrl.searchParams
    const permitted = ['revision_id','mode','organisation','role','download','id','expected_actor']
    if ([...params.keys()].some(key => !permitted.includes(key) || params.getAll(key).length !== 1)) throw new PortalError('Invalid signature record query.', 400)
    const download = params.get('download') === '1'
    if (params.has('download') && !download || !download && (params.has('id') || params.has('expected_actor'))) throw new PortalError('Invalid signature download query.', 400)
    const revisionId = id.parse(params.get('revision_id'))
    const expectedActor = id.parse(download ? params.get('expected_actor') : request.headers.get('x-bx1-expected-actor'))
    const context = portalOperatingContextSchema.parse(params.get('mode') === 'applicant' && !params.has('organisation') && !params.has('role')
      ? { mode: 'APPLICANT' } : !params.has('mode') ? { mode: 'ROLE', organisationId: params.get('organisation'), role: params.get('role') } : null)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readPortal(client, context)
    if (before.user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload the current workspace.', 403)
    const session = await verifiedOfferingFileSession(client, before.user.id)
    const input = { actorId: before.user.id, session, context, revisionId }
    const snapshot = await readOfferingSignatures(input)
    if (!download) return jar.finish(privateResponse(NextResponse.json(snapshot)))
    const artifactId = id.parse(params.get('id'))
    const bytes = await downloadOfferingSignatureArtifact(input, snapshot, artifactId)
    const after = await readPortal(client, context)
    const currentSession = await verifiedOfferingFileSession(client, before.user.id)
    if (after.user.id !== before.user.id || currentSession.id !== session.id || currentSession.aal !== session.aal) throw new PortalError('The account or session changed during download.', 403)
    const current = await readOfferingSignatures({ ...input, session: currentSession })
    const retained = (value: typeof snapshot) => value.operations.flatMap(operation => operation.artifacts.filter(artifact => artifact.id === artifactId)
      .map(artifact => ({ operation: operation.id, sha256: artifact.sha256, size: artifact.size })))
    if (JSON.stringify(retained(current)) !== JSON.stringify(retained(snapshot)) || retained(current).length !== 1) throw new PortalError('Signature evidence access changed during download.', 403)
    return jar.finish(privateResponse(new NextResponse(Buffer.from(bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="bx1-signature-${artifactId}.pdf"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    } })))
  } catch (error) {
    return jar.finish(portalFailure(error instanceof OfferingSignatureError ? new PortalError(error.message, error.status)
      : error instanceof z.ZodError ? new PortalError('Select the current signature record and operating context.', 400) : error))
  }
}

export async function POST(request: NextRequest) {
  const wakeDeadline = Date.now() + 50_000
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid signature request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON signature request.', 415)
    const raw = await readPortalBody(request, 16384)
    let body: unknown
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { throw new PortalError('Invalid signature request.', 400) }
    const instruction = offeringSignatureRequestSchema.parse(body)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readPortal(client, instruction.operating_context)
    if (before.user.id !== instruction.expected_actor) throw new PortalError('The signed-in account changed. Reload the current workspace.', 403)
    const session = await verifiedOfferingFileSession(client, before.user.id)
    const input = { actorId: before.user.id, session, context: instruction.operating_context, revisionId: instruction.request.payload.offering_revision_id }
    const outcome = await executeOfferingSignatureCommand(input, instruction.request)
    let view: { view_status: 'AVAILABLE' | 'RETRY_SAME_ENVELOPE'; signing_url?: string } | undefined
    if (instruction.request.command === 'REQUEST_SIGNING_VIEW') view = outcome.viewAction
      ? await createOfferingSigningView(client, input, outcome.viewAction)
      : { view_status: 'RETRY_SAME_ENVELOPE' }
    const currentSession = await verifiedOfferingFileSession(client, before.user.id)
    if (currentSession.id !== session.id || currentSession.aal !== session.aal) throw new PortalError('The session changed during this operation; refresh its saved state.', 403)
    const snapshot = await readOfferingSignatures({ ...input, session: currentSession })
    if (view?.view_status === 'AVAILABLE' && instruction.request.command === 'REQUEST_SIGNING_VIEW') {
      const operationId = instruction.request.payload.operation_id
      const operation = snapshot.operations.find(item => item.id === operationId)
      const authorisation = snapshot.authorisations.find(item => item.id === operation?.authorisation_id)
      if (!snapshot.admitted || !snapshot.allowed_commands.includes('REQUEST_SIGNING_VIEW')
        || operation?.state !== 'SENT' || operation.noncurrent_reason !== null || !operation.envelope_id
        || authorisation?.state !== 'APPROVED' || authorisation.signer_id !== before.user.id
        || Date.parse(authorisation.valid_from) > Date.now() || Date.parse(authorisation.valid_until) <= Date.now()) {
        throw new PortalError('Signing authority changed before the link could be delivered. Refresh the current package.', 403)
      }
    }
    const response = offeringSignatureResponseSchema.parse({ snapshot, command: instruction.request.command, key: instruction.request.key, ...view })
    const result = jar.finish(privateResponse(NextResponse.json(response)))
    scheduleOfferingSignatureWake(response, { actorId: before.user.id, sessionId: currentSession.id, aal: currentSession.aal,
      context: input.context, productId: instruction.request.payload.product_id, revisionId: input.revisionId }, wakeDeadline)
    return result
  } catch (error) {
    return jar.finish(portalFailure(error instanceof OfferingSignatureError ? new PortalError(error.message, error.status)
      : error instanceof z.ZodError ? new PortalError('The signature request or confirmed response is invalid. Refresh its saved state before retrying.', 400) : error))
  }
}
