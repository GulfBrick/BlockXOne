import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BX1_ROLES } from '@/lib/supabase/contracts'
import { hasCurrentTotp, isMfaContextCurrent, readMfaContext, requireRecentTotp } from '@/lib/supabase/mfa'
import { readVerifiedUser } from '@/lib/supabase/server'
import { checkAdministrationContext, loadAdministrationContext } from './context'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const revision = /^[1-9][0-9]{0,18}$/
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type StaffError = 'invalid_request' | 'unauthorised' | 'forbidden' | 'mfa_required' | 'step_up_required' | 'governance_hold' | 'conflict' | 'outcome_unknown' | 'unavailable'
export type StaffResult = { ok: true; state: string; invitationId?: string; revision?: string; replayed?: boolean }
  | { ok: false; error: StaffError }
export type StaffInviteView = { id: string; email: string; role: string; state: string; revision: string;
  requesterPersonId: string; reviewerPersonId: string | null; reviewExpiresAt: string; acceptanceExpiresAt: string | null }
export type StaffInviteDirectory = { ok: true; scopeRevision: string; actorPersonId: string; invitations: StaffInviteView[] }
  | { ok: false; error: StaffError }

function key(value: string | null): value is string { return Boolean(value && uuid.test(value) && value !== '00000000-0000-0000-0000-000000000000') }
function positive(value: string | null): value is string {
  return Boolean(value && revision.test(value) && BigInt(value) <= 9223372036854775807n)
}
function result(value: unknown): StaffResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'unavailable' }
  const input = value as Record<string, unknown>
  if (input.ok === false && typeof input.error === 'string'
    && ['invalid_request','unauthorised','forbidden','mfa_required','step_up_required','governance_hold','conflict','outcome_unknown','unavailable'].includes(input.error)) {
    return { ok: false, error: input.error as StaffError }
  }
  if (input.ok === true && typeof input.state === 'string' && input.state.length <= 32) {
    return { ok: true, state: input.state,
      ...(typeof input.invitationId === 'string' && key(input.invitationId) ? { invitationId: input.invitationId } : {}),
      ...(typeof input.revision === 'string' && positive(input.revision) ? { revision: input.revision } : {}),
      ...(input.replayed === true ? { replayed: true } : {}) }
  }
  return { ok: false, error: 'unavailable' }
}
function exactFields(form: URLSearchParams, required: string[]): boolean {
  return [...form.keys()].length === required.length
    && [...form.keys()].every(field => required.includes(field) && form.getAll(field).length === 1)
}

export async function staffInvitationAction(client: SupabaseClient, form: URLSearchParams): Promise<StaffResult> {
  try {
    const intent = form.get('intent')
    if (intent === 'accept') {
      if (!exactFields(form, ['intent','invitationId']) || !key(form.get('invitationId'))) return { ok: false, error: 'invalid_request' }
      const user = await readVerifiedUser(client)
      if (!user?.email_confirmed_at || user.is_anonymous) return { ok: false, error: 'unauthorised' }
      const mfa = await readMfaContext(client)
      if (!mfa || !hasCurrentTotp(mfa)) return { ok: false, error: 'mfa_required' }
      if (!requireRecentTotp(mfa, Math.floor(Date.now()/1000)).allowed) return { ok: false, error: 'step_up_required' }
      const response = await client.rpc('bx1_staff_invitation_accept', { invitation_id: form.get('invitationId')! })
        .abortSignal(AbortSignal.timeout(12000))
      if (response.error || !await isMfaContextCurrent(client,mfa)) return { ok: false, error: 'unavailable' }
      return result(response.data)
    }
    const organisationId = form.get('organisationId')
    if (!key(organisationId)) return { ok: false, error: 'invalid_request' }
    const loaded = await loadAdministrationContext(client, organisationId)
    if (!loaded.context) return { ok: false, error: loaded.error === 'mfa_required' ? 'mfa_required' : 'forbidden' }
    const action = intent === 'approve' || intent === 'reject' ? 'administration.review'
      : intent === 'apply' || intent === 'dispatch' || intent === 'reconcile' ? 'administration.apply'
      : intent === 'cancel' ? 'administration.cancel' : 'administration.propose'
    const allowed = await checkAdministrationContext(client, loaded.context, action, organisationId)
    if (!allowed.allowed) return { ok: false, error: allowed.reason === 'step_up_required' ? 'step_up_required' : 'forbidden' }
    if (intent === 'dispatch' || intent === 'reconcile') {
      if (!exactFields(form,['intent','organisationId','invitationId']) || !key(form.get('invitationId'))) return { ok: false, error: 'invalid_request' }
      const response = intent === 'dispatch'
        ? await client.functions.invoke('bx1-staff-invite-dispatch', {
          method: 'POST', body: { organisationId, invitationId: form.get('invitationId') }, signal: AbortSignal.timeout(25000),
        })
        : await client.rpc('bx1_staff_invitation_reconcile', {
          target_organisation: organisationId, invitation_id: form.get('invitationId'),
        }).abortSignal(AbortSignal.timeout(12000))
      const current = await checkAdministrationContext(client, loaded.context, 'administration.read', organisationId)
      if (!current.allowed || response.error) return { ok: false, error: 'outcome_unknown' }
      return result(response.data)
    }
    const requestKey = form.get('requestKey')
    if (!key(requestKey)) return { ok: false, error: 'invalid_request' }
    let command: Record<string,string>
    if (intent === 'propose') {
      if (!exactFields(form,['intent','organisationId','requestKey','email','role','expectedScopeRevision'])) return { ok: false, error: 'invalid_request' }
      const targetEmail = form.get('email')?.trim().toLowerCase() ?? ''
      const role = form.get('role') ?? ''
      const expectedScopeRevision = form.get('expectedScopeRevision')
      if (targetEmail.length > 254 || !email.test(targetEmail) || !BX1_ROLES.some(candidate => candidate === role)
        || !positive(expectedScopeRevision)) return { ok: false, error: 'invalid_request' }
      command = { intent, email: targetEmail, role, expectedScopeRevision }
    } else if (intent === 'approve' || intent === 'reject' || intent === 'apply' || intent === 'cancel') {
      if (!exactFields(form,['intent','organisationId','requestKey','invitationId','expectedRevision'])
        || !key(form.get('invitationId')) || !positive(form.get('expectedRevision'))) return { ok: false, error: 'invalid_request' }
      command = { intent, invitationId: form.get('invitationId')!, expectedRevision: form.get('expectedRevision')! }
    } else return { ok: false, error: 'invalid_request' }
    const response = await client.rpc('bx1_staff_invitation_command', {
      target_organisation: organisationId, request_key: requestKey, command,
    }).abortSignal(AbortSignal.timeout(12000))
    const current = await checkAdministrationContext(client, loaded.context, 'administration.read', organisationId)
    if (response.error || !current.allowed) return { ok: false, error: 'outcome_unknown' }
    return result(response.data)
  } catch { return { ok: false, error: 'unavailable' } }
}

export async function readStaffInvitationDirectory(client: SupabaseClient, organisationId: string): Promise<StaffInviteDirectory> {
  try {
    if (!key(organisationId)) return { ok: false, error: 'invalid_request' }
    const response = await client.rpc('bx1_staff_invitation_read', { target_organisation: organisationId })
      .abortSignal(AbortSignal.timeout(12000))
    if (response.error || !response.data || typeof response.data !== 'object') return { ok: false, error: 'unavailable' }
    const data = response.data as Record<string,unknown>
    if (data.ok !== true || typeof data.scopeRevision !== 'string' || !positive(data.scopeRevision)
      || typeof data.actorPersonId !== 'string' || !key(data.actorPersonId)
      || !Array.isArray(data.invitations) || data.invitations.length>50) return { ok: false, error: 'unavailable' }
    for (const raw of data.invitations) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'unavailable' }
      const item = raw as Record<string,unknown>
      if (typeof item.id !== 'string' || !key(item.id) || typeof item.revision !== 'string' || !positive(item.revision)
        || typeof item.email !== 'string' || !email.test(item.email)
        || typeof item.role !== 'string' || !BX1_ROLES.some(role => role === item.role)
        || typeof item.state !== 'string' || typeof item.requesterPersonId !== 'string' || !key(item.requesterPersonId)) return { ok: false, error: 'unavailable' }
    }
    return data as StaffInviteDirectory
  } catch { return { ok: false, error: 'unavailable' } }
}

export async function beginStaffInvitation(client: SupabaseClient): Promise<boolean> {
  try {
    const response = await client.rpc('bx1_staff_invitation_begin').abortSignal(AbortSignal.timeout(12000))
    return !response.error && result(response.data).ok === true && (response.data as { state?: string }).state === 'MFA_PENDING'
  } catch { return false }
}

export async function pendingStaffInvitations(client: SupabaseClient): Promise<{ id: string; organisationId: string; role: string; expiresAt: string }[]> {
  try {
    const response = await client.rpc('bx1_staff_invitation_self_read').abortSignal(AbortSignal.timeout(12000))
    const data = response.data as { ok?: boolean; invitations?: unknown } | null
    if (response.error || data?.ok !== true || !Array.isArray(data.invitations) || data.invitations.length>20) return []
    const output: { id: string; organisationId: string; role: string; expiresAt: string }[] = []
    for (const raw of data.invitations) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
      const item = raw as Record<string,unknown>
      if (typeof item.id !== 'string' || !key(item.id) || typeof item.organisationId !== 'string' || !key(item.organisationId)
        || typeof item.role !== 'string' || !BX1_ROLES.some(role => role === item.role) || typeof item.expiresAt !== 'string') return []
      output.push({ id:item.id,organisationId:item.organisationId,role:item.role,expiresAt:item.expiresAt })
    }
    return output
  } catch { return [] }
}
