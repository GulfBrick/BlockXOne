import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateAdministrationPermission, issueAdministrationContext, type AdministrationAction, type VerifiedAdministrationContext } from '../authorization/policy'
import { readWorkspace } from '../supabase/server'
import { hasCurrentTotp, isMfaContextCurrent, readMfaContext, requireRecentTotp, type VerifiedMfaContext } from '../supabase/mfa'
import { parseAdminReadProjection, type AdminError, type AdminReadProjection } from './contracts'
import { parseAdministrationQuery } from './query'

type GatedAvailability = Exclude<AdminReadProjection['availability'], 'ready' | 'hold'>
export function gatedAdministration(availability: GatedAvailability): AdminReadProjection {
  return { availability, scopeRevision: null, policyVersion: 1, caller: null, scope: null,
    people: [], entities: [], proposals: [], selectedProposal: null,
    truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
}
export type AdministrationLoad = {
  projection: AdminReadProjection; context: VerifiedAdministrationContext | null; error?: AdminError
}
const bindings = new WeakMap<VerifiedAdministrationContext, { client: SupabaseClient; mfa: VerifiedMfaContext; organisationId: string }>()
export const ADMINISTRATION_RPC_TIMEOUT_MS = 12_000

// The transport deadline bounds both read and command waits. An aborted command
// may have committed; the caller must reconcile/retry only its original key.
export async function administrationRpc(client: SupabaseClient,
  name: 'bx1_administration_read' | 'bx1_administration_command', args: Record<string, unknown>,
): Promise<{ data: unknown; failed: boolean }> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<{ data: unknown; failed: boolean }>(resolve => {
      timer = setTimeout(() => { abort.abort(); resolve({ data: null, failed: true }) }, ADMINISTRATION_RPC_TIMEOUT_MS)
    })
    const request = Promise.resolve(client.rpc(name, args).abortSignal(abort.signal))
      .then(result => ({ data: result.data as unknown, failed: Boolean(result.error) }), () => ({ data: null, failed: true }))
    return await Promise.race([request, timeout])
  } catch { return { data: null, failed: true } }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

export async function loadAdministrationContext(client: SupabaseClient, organisationId: string, selectedCommandId?: string): Promise<AdministrationLoad> {
  const fail = (error: 'unauthorised' | 'invalid_request' | 'mfa_required' | 'forbidden' | 'unavailable'): AdministrationLoad => ({ projection: gatedAdministration(error === 'unauthorised' ? 'forbidden'
    : error === 'invalid_request' ? 'unavailable' : error), context: null, error })
  try {
    const query = parseAdministrationQuery({ organisation: organisationId, ...(selectedCommandId === undefined ? {} : { proposal: selectedCommandId }) })
    if (!query?.organisationId) return fail('invalid_request')
    const mfa = await readMfaContext(client)
    if (!mfa) return fail('unauthorised')
    if (!hasCurrentTotp(mfa)) return fail('mfa_required')
    const workspace = await readWorkspace(client)
    if (!workspace || !workspace.organisations.some(org => org.id === query.organisationId)) return fail('forbidden')
    if (!await isMfaContextCurrent(client, mfa) || !hasCurrentTotp(mfa)) return fail('unavailable')
    const result = await administrationRpc(client, 'bx1_administration_read', {
      target_organisation: query.organisationId, selected_command: query.proposalId ?? null,
    })
    if (result.failed) return fail('unavailable')
    const projection = parseAdminReadProjection(result.data, { organisationId: query.organisationId,
      principalId: workspace.user.id, ...(query.proposalId ? { selectedProposalId: query.proposalId } : {}) })
    if (!projection || !await isMfaContextCurrent(client, mfa) || !hasCurrentTotp(mfa)) return fail('unavailable')
    if (projection.availability !== 'ready' && projection.availability !== 'hold') return { projection, context: null, error: projection.availability }
    const context = issueAdministrationContext({ principalId: projection.caller.principalId, personId: projection.caller.personId,
      organisationId: projection.scope.organisationId, scopeRevision: projection.scope.revision, trustRevision: projection.scope.trustRevision,
      state: projection.scope.state, grantFrom: Date.parse(projection.caller.grant.validFrom), grantUntil: Date.parse(projection.caller.grant.validUntil) })
    if (!context) return fail('forbidden')
    bindings.set(context, { client, mfa, organisationId: query.organisationId })
    return { projection, context }
  } catch { return fail('unavailable') }
}

export async function checkAdministrationContext(client: SupabaseClient, context: VerifiedAdministrationContext | null,
  action: AdministrationAction, organisationId: string,
): Promise<{ allowed: true } | { allowed: false; reason: AdminError }> {
  try {
    const binding = context && bindings.get(context)
    if (!binding || binding.client !== client || binding.organisationId !== organisationId) return { allowed: false, reason: 'forbidden' }
    const policy = evaluateAdministrationPermission(context, action, { organisationId })
    if (!policy.allowed) return policy
    if (!await isMfaContextCurrent(client, binding.mfa)) return { allowed: false, reason: 'unavailable' }
    if (!hasCurrentTotp(binding.mfa)) return { allowed: false, reason: 'mfa_required' }
    const finalPolicy = evaluateAdministrationPermission(context, action, { organisationId })
    if (!finalPolicy.allowed) return finalPolicy
    if (action !== 'administration.read') return requireRecentTotp(binding.mfa, Math.floor(Date.now() / 1000))
    return { allowed: true }
  } catch { return { allowed: false, reason: 'unavailable' } }
}
