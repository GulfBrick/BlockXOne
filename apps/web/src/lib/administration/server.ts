import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAdminIntent, parseAdminPayloadJson, parseAdminResult, type AdminIntent, type AdminReadProjection, type AdminResult, type AdminState } from './contracts'
import { administrationRpc, checkAdministrationContext, gatedAdministration, loadAdministrationContext } from './context'

export async function readAdministration(client: SupabaseClient, organisationId: string, selectedCommandId?: string): Promise<AdminReadProjection> {
  const loaded = await loadAdministrationContext(client, organisationId, selectedCommandId)
  if (!loaded.context) return loaded.projection
  const current = await checkAdministrationContext(client, loaded.context, 'administration.read', organisationId.toLowerCase())
  return current.allowed ? loaded.projection : gatedAdministration('unavailable')
}

export async function submitAdministrationCommand(client: SupabaseClient, candidate: AdminIntent): Promise<AdminResult> {
  try {
    const intent = parseAdminIntent(candidate)
    if (!intent) return { ok: false, error: 'invalid_request' }
    const loaded = await loadAdministrationContext(client, intent.organisationId, intent.intent === 'propose' ? undefined : intent.proposalId)
    if (!loaded.context) return { ok: false, error: loaded.error ?? 'forbidden' }
    const admission = await checkAdministrationContext(client, loaded.context, `administration.${intent.intent}`, intent.organisationId)
    if (!admission.allowed) return { ok: false, error: admission.reason }
    let command: Record<string, unknown>
    let expectedState: AdminState
    if (intent.intent === 'propose') {
      const parsed = parseAdminPayloadJson(intent.kind, intent.payload)
      if (!parsed) return { ok: false, error: 'invalid_request' }
      command = { intent: intent.intent, kind: parsed.kind, payload: parsed.payload, expectedScopeRevision: intent.expectedScopeRevision }
      expectedState = 'PENDING_REVIEW'
    } else {
      command = { intent: intent.intent, proposalId: intent.proposalId, expectedRevision: intent.expectedRevision }
      if (intent.intent === 'review') {
        command.decision = intent.decision
        expectedState = intent.decision === 'approve' ? 'APPROVED' : 'REJECTED'
      } else {
        expectedState = intent.intent === 'apply' ? 'APPLIED' : 'CANCELLED'
      }
    }
    // No comparisons to refreshed revision/allowedTransitions here: SQL must
    // adjudicate historical-key replay and persist discovered stale terminals.
    const response = await administrationRpc(client, 'bx1_administration_command', {
      target_organisation: intent.organisationId, request_key: intent.requestKey, command,
    })
    if (response.failed) return { ok: false, error: 'unavailable' }
    const result = parseAdminResult(response.data)
    if (!result || (result.ok && (result.state !== expectedState
      || (intent.intent !== 'propose' && result.proposalId !== intent.proposalId)
      || (intent.intent === 'propose' ? result.revision !== '1' || result.scopeRevision !== intent.expectedScopeRevision
        : result.revision !== (BigInt(intent.expectedRevision) + 1n).toString())
      || (intent.intent !== 'apply' && result.scopeState !== 'READY')))) return { ok: false, error: 'unavailable' }
    // Token rotation/expiry after dispatch is an unknown outcome, never proof
    // that an already committed effect did not happen. Do not return old data.
    const current = await checkAdministrationContext(client, loaded.context, 'administration.read', intent.organisationId)
    return current.allowed ? result : { ok: false, error: 'unavailable' }
  } catch { return { ok: false, error: 'unavailable' } }
}
