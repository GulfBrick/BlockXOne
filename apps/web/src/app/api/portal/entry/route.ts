import { NextRequest, NextResponse } from 'next/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { entryCommandSchema, entrySnapshotSchema } from '@/lib/portal/entry-contracts'
import { readEntry, requireEntryEnvironment } from '@/lib/portal/entry-server'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    if (request.nextUrl.search) throw new PortalError('Invalid request.', 400)
    const snapshot = await readEntry(createRequestSupabaseClient(jar.adapter))
    return jar.finish(privateResponse(NextResponse.json({ snapshot })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}

export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requireEntryEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before saving.', 403)
    const bytes = await readPortalBody(request, 65536)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('Invalid JSON request.', 400) }
    const instruction = entryCommandSchema.safeParse(parsed)
    if (!instruction.success) throw new PortalError('Check the application request fields.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readEntry(client)
    if (before.actor.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before saving.', 403)
    const { command, key, payload } = instruction.data
    const { data, error } = await client.rpc('bx1_entry_command', { command, request_key: key, payload }).abortSignal(AbortSignal.timeout(15000))
    if (error) {
      if (error.code === '42501') throw new PortalError('You do not have current authority for this application.', 403)
      const evidenceErrors: Record<string, string> = {
        portal_documents_required: 'Attach the required evidence before submitting: identity evidence, plus company and beneficial-owner evidence for a wealth-manager or entity application.',
        portal_identity_document_required: 'Attach an identity evidence file before submitting your application.',
        portal_kyb_evidence_required: 'Complete the organisation and representative details, and attach identity, company and beneficial-owner evidence before submitting.',
        portal_document_upload_not_verified: 'A referenced evidence file could not be verified in your private uploads. Check the upload completed and select the correct file before submitting.',
        portal_invalid_document: 'Check each evidence file type, size and upload reference before submitting.',
        portal_invalid_application_version: 'The application questions do not match this saved capacity. Reopen the exact application before submitting.',
      }
      if (['22023', '23514'].includes(error.code ?? '') && evidenceErrors[error.message ?? '']) throw new PortalError(evidenceErrors[error.message], 409)
      if (error.code === '55000' && error.message === 'entry_independent_reviewer_unavailable') throw new PortalError('An independent compliance reviewer has not been assigned to this application route. Your application was not submitted. Contact the BlockXOne onboarding owner to arrange the reviewer, then submit again.', 409)
      if (error.code === '55000') throw new PortalError('This application does not yet have an admitted review route. Your draft is preserved; contact the onboarding owner before submitting.', 409)
      if (['22023', '23514', '23505', '40001', 'P0001'].includes(error.code)) throw new PortalError('The application state changed. Refresh before retrying.', 409)
      throw new PortalError('The result is uncertain. Retry only with the original request reference.', 503)
    }
    const saved = entrySnapshotSchema.safeParse(data)
    if (!saved.success || saved.data.actor.id !== expectedActor || saved.data.applications.some(application => application.user_id !== expectedActor)) throw new PortalError('The saved result could not be verified. Keep the original request reference.', 503)
    // Re-read live session/MFA after the command as well. A failed response may
    // still represent a committed command and must retain its request key.
    let current
    try { current = await readEntry(client) } catch { throw new PortalError('The command may have saved, but current access could not be revalidated. Keep the original request reference.', 503) }
    if (current.actor.id !== expectedActor) throw new PortalError('The account changed while saving.', 503)
    return jar.finish(privateResponse(NextResponse.json({ snapshot: current })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
