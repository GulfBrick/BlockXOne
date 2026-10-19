import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { readEntry, requireEntryEnvironment } from '@/lib/portal/entry-server'
import { validatedCustomerHandoff, customerHandoffHasAction } from '@/lib/portal/customer-handoff'
import { validatedStage2Access } from '@/lib/portal/stage2-access'
import { APPLICANT_CONTEXT } from '@/lib/portal/operating-context'
import { applicationDraftContentMatches, applicationDraftEnvelopeSchema, applicationDraftRequestSchema, type ApplicationDraftEnvelope } from '@/lib/portal/application-drafts'
import type { EntryApplication, EntrySnapshot } from '@/lib/portal/entry-contracts'
import { PortalError } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
const uuid = z.string().uuid()
const querySchema = z.object({ application_id: uuid, expected_application_revision: z.string().regex(/^[1-9][0-9]{0,8}$/).transform(Number), request_key: uuid.optional() }).strict()

function expectedActor(request: NextRequest): string {
  const parsed = uuid.safeParse(request.headers.get('x-bx1-expected-actor'))
  if (!parsed.success) throw new PortalError('Refresh your signed-in account before saving or restoring a draft.', 403)
  return parsed.data
}
function preparation(snapshot: EntrySnapshot, applicationId: string, baseRevision: number, actorId: string): EntryApplication {
  if (snapshot.actor.id !== actorId) throw new PortalError('The signed-in account changed. Your answers were not replaced.', 403)
  const application = snapshot.applications.find(item => item.id === applicationId && item.user_id === actorId)
  if (!application) throw new PortalError('You cannot access this application draft.', 403)
  if (application.revision !== baseRevision) throw new PortalError('The application changed. Keep your answers and reopen the exact application to reconcile its draft.', 409)
  const environment = snapshot.workflow?.environment
  if (!environment) throw new PortalError('Draft preparation is not available in this environment.', 403)
  const handoff = validatedCustomerHandoff(snapshot, application, environment)
  if (!customerHandoffHasAction(handoff, 'PREPARE_APPLICATION')) throw new PortalError('This application is not currently open for draft preparation.', 403)
  return application
}
function sameEnvelope(snapshot: EntrySnapshot, application: EntryApplication, value: ApplicationDraftEnvelope): boolean {
  return value.actor_id === snapshot.actor.id && value.environment === snapshot.workflow?.environment
    && value.base_application_revision === application.revision
    && applicationDraftContentMatches(value.application, {
      id: application.id, persona: application.persona, status: application.status, context_kind: application.context_kind,
      context_organisation_id: application.context_organisation_id, origin: application.origin, admission_purpose: application.admission_purpose,
    })
}
function rpcFailure(error: { code?: string }): never {
  if (error.code === '42501') throw new PortalError('Your current session cannot access or save this application draft.', 403)
  if (['40001', '23505', '23514', '22023', 'P0001'].includes(error.code ?? '')) throw new PortalError('The draft changed or this request conflicts with its saved revision. Keep your answers; reopen the exact application to recover its current draft.', 409)
  if (error.code === '55000') throw new PortalError('Draft saving is not available yet. Your browser answers have not been saved.', 409)
  throw new PortalError('The draft result is uncertain. Keep the original request reference and retry only its exact answers.', 503)
}

export async function GET(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requireEntryEnvironment()
    const actorId = expectedActor(request)
    if (request.headers.has('origin') && !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    const parameters = request.nextUrl.searchParams
    for (const key of parameters.keys()) if (parameters.getAll(key).length !== 1) throw new PortalError('Invalid draft request.', 400)
    const query = querySchema.safeParse(Object.fromEntries(parameters))
    if (!query.success) throw new PortalError('Select the exact application and saved revision.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readEntry(client)
    const application = preparation(before, query.data.application_id, query.data.expected_application_revision, actorId)
    const { data, error } = await client.rpc('bx1_application_draft_read', {
      application_id: application.id, expected_application_revision: application.revision, request_key: query.data.request_key ?? null,
    }).abortSignal(AbortSignal.timeout(12000))
    if (error) rpcFailure(error)
    const result = applicationDraftEnvelopeSchema.safeParse(data)
    if (!result.success || !sameEnvelope(before, application, result.data)
      || (query.data.request_key ? result.data.receipt !== null && result.data.receipt.key !== query.data.request_key : result.data.receipt !== null)) throw new PortalError('The saved draft could not be matched to your exact request. Nothing was restored.', 503)
    const current = await readEntry(client)
    const currentApplication = preparation(current, application.id, application.revision, actorId)
    if (!sameEnvelope(current, currentApplication, result.data)) throw new PortalError('Draft access changed while restoring. Nothing was replaced.', 503)
    return jar.finish(privateResponse(NextResponse.json({ draft: result.data })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}

export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requireEntryEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    const actorId = expectedActor(request)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON draft request.', 415)
    const bytes = await readPortalBody(request, 262144)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('Invalid JSON draft request.', 400) }
    const instruction = applicationDraftRequestSchema.safeParse(parsed)
    if (!instruction.success) throw new PortalError('Check the bounded unfinished draft fields.', 400)
    const { key, ...payload } = instruction.data
    const client = createRequestSupabaseClient(jar.adapter)
    const before = await readEntry(client)
    const application = preparation(before, payload.application_id, payload.expected_application_revision, actorId)
    const { data, error } = await client.rpc('bx1_application_draft_save', { request_key: key, payload }).abortSignal(AbortSignal.timeout(15000))
    if (error) rpcFailure(error)
    const result = applicationDraftEnvelopeSchema.safeParse(data)
    if (!result.success || !sameEnvelope(before, application, result.data) || !result.data.receipt
      || result.data.receipt.key !== key || !applicationDraftContentMatches(result.data.receipt.payload, payload)
      || result.data.draft_revision !== payload.expected_draft_revision + 1) throw new PortalError('The saved draft result could not be confirmed. Keep the original request reference and your answers.', 503)
    // A command may have committed even if this fresh session/context read fails.
    let current: EntrySnapshot
    try { current = await readEntry(client) } catch { throw new PortalError('Draft saving may have completed, but access could not be revalidated. Keep the original request reference.', 503) }
    let currentApplication: EntryApplication
    try { currentApplication = preparation(current, application.id, application.revision, actorId) } catch { throw new PortalError('Draft saving may have completed, but your application or account changed. Keep the original request reference.', 503) }
    const priorAccess = validatedStage2Access(before, APPLICANT_CONTEXT)
    const currentAccess = validatedStage2Access(current, APPLICANT_CONTEXT)
    if (!sameEnvelope(current, currentApplication, result.data) || priorAccess && (!currentAccess || currentAccess.environment !== priorAccess.environment || currentAccess.session_mode !== priorAccess.session_mode)) throw new PortalError('Draft saving may have completed, but preparation access changed. Keep the original request reference.', 503)
    return jar.finish(privateResponse(NextResponse.json({ draft: result.data })))
  } catch (error) { return jar.finish(portalFailure(error)) }
}
