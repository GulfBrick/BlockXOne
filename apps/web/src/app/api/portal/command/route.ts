import { NextRequest, NextResponse } from 'next/server'
import { hasCanonicalOrigin, privateResponse, responseCookieAdapter } from '@/lib/supabase/http'
import { createRequestSupabaseClient } from '@/lib/supabase/server'
import { portalCommandSchema, type PortalSnapshot } from '@/lib/portal/contracts'
import { isPortalSnapshot, PortalError, readPortal, requirePortalEnvironment } from '@/lib/portal/server'
import { portalFailure, readPortalBody } from '@/lib/portal/http'
import { portalContextMatches, portalOperatingContextSchema, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { hasStage2CommandAccess, validatedStage2Access } from '@/lib/portal/stage2-access'
import { hasOfferingCommandAccess, isTestPasswordWorkflow, validatedOfferingAccess } from '@/lib/portal/offering-access'
import { hasEvaluationCommandAccess, sameEvaluationGrant, validatedEvaluationAccess } from '@/lib/portal/evaluation-access'
import { executeFundCommand, FundLifecycleError, isFundCommand, readFundLifecycle, unavailableFundLifecycle } from '@/lib/portal/fund-lifecycle-server'
import { platformRelease } from '@/lib/platform-release'
import { appointmentCommitSchema, matchesAppointmentCommit } from '@/lib/portal/appointment-commit'
import { fundPublicationCommitSchema, matchesFundPublicationCommit } from '@/lib/portal/fund-publication-commit'
import { offeringDecisionCommitSchema, matchesOfferingDecisionCommit } from '@/lib/portal/offering-decision-commit'

function requireSavedSnapshot(value: unknown, actorId: string, context: PortalOperatingContext, before: PortalSnapshot): asserts value is PortalSnapshot {
  if (!isPortalSnapshot(value, actorId) || !portalContextMatches(value.operating_context, context)) throw new PortalError('The saved result could not be read. Refresh before retrying.', 503)
  const priorAccess = validatedStage2Access(before, context)
  const savedAccess = validatedStage2Access(value, context)
  if (priorAccess && (!savedAccess || savedAccess.environment !== priorAccess.environment || savedAccess.session_mode !== priorAccess.session_mode)) throw new PortalError('The saved admission context could not be read. Refresh before retrying.', 503)
  const priorOffering = validatedOfferingAccess(before, context)
  const savedOffering = validatedOfferingAccess(value, context)
  if (priorOffering && (!savedOffering || savedOffering.environment !== priorOffering.environment || savedOffering.session_mode !== priorOffering.session_mode)) throw new PortalError('The saved package context could not be read. Refresh before retrying.', 503)
  const priorEvaluation = validatedEvaluationAccess(before, context)
  const savedEvaluation = validatedEvaluationAccess(value, context)
  if (priorEvaluation && (!savedEvaluation || !sameEvaluationGrant(priorEvaluation, savedEvaluation))) throw new PortalError('The saved TEST workspace result could not be verified. Refresh before retrying.', 503)
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const jar = responseCookieAdapter(request)
  try {
    requirePortalEnvironment()
    if (request.nextUrl.search || !hasCanonicalOrigin(request)) throw new PortalError('Invalid request origin.', 403)
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw new PortalError('Send a JSON request.', 415)
    const expectedActor = request.headers.get('x-bx1-expected-actor') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedActor)) throw new PortalError('Refresh your signed-in account before saving.', 403)
    const bytes = await readPortalBody(request, 65536)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new PortalError('The request is not valid JSON.', 400) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new PortalError('Check the request fields.', 400)
    const { operating_context: rawContext, ...instruction } = parsed as Record<string, unknown>
    const context = portalOperatingContextSchema.safeParse(rawContext)
    if (!context.success) throw new PortalError('Select your operating context again before saving.', 403)
    const command = portalCommandSchema.safeParse(instruction)
    if (!command.success) throw new PortalError(command.error.issues[0]?.message ?? 'Check the request fields.', 400)
    const client = createRequestSupabaseClient(jar.adapter)
    const { user, snapshot: before } = await readPortal(client, context.data)
    if (user.id !== expectedActor) throw new PortalError('The signed-in account changed. Reload before saving.', 403)
    if (!isPortalSnapshot(before, user.id) || !portalContextMatches(before.operating_context, context.data)) throw new PortalError('The current operating context could not be verified.', 503)
    if (isFundCommand(command.data.command)) {
      // The guarded database validates authority and transition before a new
      // write. Discovery is not an authorization gate: an original idempotency
      // key must still reach the database after its action has been consumed.
      const lifecycle = await executeFundCommand(client, user.id, context.data, command.data.command, command.data.key, command.data.payload)
      // The durable command result is authoritative for this extension. Other
      // record families are refreshed together by the existing page reader.
      return jar.finish(privateResponse(NextResponse.json({ snapshot: { ...before, fund_lifecycle: lifecycle,
        requests: [...(before.requests ?? []), ...(lifecycle.requests ?? [])] } })))
    }
    if (before.evaluation_access !== undefined && !hasEvaluationCommandAccess(before, command.data.command, context.data)) throw new PortalError('This action is not available in your TEST workspace.', 403)
    if (isTestPasswordWorkflow(before) && !hasStage2CommandAccess(before, command.data.command, context.data)
      && !hasOfferingCommandAccess(before, command.data.command, context.data)) throw new PortalError('This action is not available in your current workflow context.', 403)
    const { data, error } = await client.rpc('bx1_portal_command_scoped', { command: command.data.command, request_key: command.data.key, payload: command.data.payload, operating_context: context.data }).abortSignal(AbortSignal.timeout(15000))
    if (error) {
      if (error.code === '42501') throw new PortalError('You do not have current authority for this action.', 403)
      if (['22023', '23514', '23505', '40001', 'P0001'].includes(error.code)) throw new PortalError('The saved state or review requirements changed. Refresh and check the current requirements before retrying.', 409)
      throw new PortalError('The request outcome is uncertain. Refresh to check whether it saved; retry only with the same request key.', 503)
    }
    if (data && typeof data === 'object' && 'kind' in data
      && (data.kind === 'TEST_FUND_APPOINTMENT_COMMIT' || data.kind === 'TEST_FUND_PUBLICATION_COMMIT'
        || data.kind === 'TEST_FUND_OFFERING_DECISION_COMMIT')) {
      const expected = { actorId: user.id, context: context.data, request: command.data, environment: platformRelease(process.env)?.environment }
      const publication = data.kind === 'TEST_FUND_PUBLICATION_COMMIT'
      const decision = data.kind === 'TEST_FUND_OFFERING_DECISION_COMMIT'
      if (!(decision ? matchesOfferingDecisionCommit(data, expected) : publication ? matchesFundPublicationCommit(data, expected) : matchesAppointmentCommit(data, expected))) {
        throw new PortalError(decision ? 'The saved offering decision receipt could not be verified. Refresh before retrying.'
          : publication ? 'The saved publication receipt could not be verified. Refresh before retrying.'
          : 'The saved appointment receipt could not be verified. Refresh before retrying.', 503)
      }
      const committed = decision ? offeringDecisionCommitSchema.parse(data)
        : publication ? fundPublicationCommitSchema.parse(data) : appointmentCommitSchema.parse(data)
      try {
        // This is a separate RPC after the guarded writer returned a durable
        // receipt. A failed refresh cannot roll back that committed command.
        const refreshed = await readPortal(client, context.data)
        if (refreshed.user.id !== user.id) throw new PortalError('The signed-in account changed after saving.', 403)
        requireSavedSnapshot(refreshed.snapshot, user.id, context.data, before)
        return jar.finish(privateResponse(NextResponse.json({ snapshot: refreshed.snapshot, committed })))
      } catch {
        // No prior or fabricated snapshot is returned as current state. The
        // same operation key must be retained until its real receipt is read.
        return jar.finish(privateResponse(NextResponse.json({ committed, refresh_required: true }, { status: 202 })))
      }
    }
    requireSavedSnapshot(data, user.id, context.data, before)
    // The native command has already committed. Failure to enrich its display
    // must not tell a customer that the command itself failed or invite a new key.
    const lifecycle = await readFundLifecycle(client, user.id, context.data)
      .catch(() => unavailableFundLifecycle(user.id, context.data, 'LIFECYCLE_REFRESH_REQUIRED'))
    return jar.finish(privateResponse(NextResponse.json({ snapshot: { ...data, fund_lifecycle: lifecycle,
      requests: [...(data.requests ?? []), ...(lifecycle.requests ?? [])] } })))
  } catch (error) { return jar.finish(portalFailure(error instanceof FundLifecycleError ? new PortalError(error.message, error.status) : error)) }
}
