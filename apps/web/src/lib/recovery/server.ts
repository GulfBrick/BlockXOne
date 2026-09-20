import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasCurrentTotp, isMfaContextCurrent, readMfaContext, requireRecentTotp, type VerifiedMfaContext } from '../supabase/mfa'
import { gatedRecovery, parseRecoveryIntent, parseRecoveryReadProjection, parseRecoveryResult, recoveryUuid,
  type RecoveryIntent, type RecoveryReadProjection, type RecoveryResult, type RecoveryState } from './contracts'

export const RECOVERY_RPC_TIMEOUT_MS = 12_000
type IdentityBinding = { principalId: string; accessToken: string; expiresAt: number }
// This narrow binding never leaves this module or becomes a workspace context.
// Provider verification is necessary; the RPC separately proves live first-party
// session, active profile and trusted person mapping using current database state.
export class RecoveryOperation {
  private readonly controller = new AbortController()
  private readonly expiresAt = performance.now() + RECOVERY_RPC_TIMEOUT_MS
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly cancel = () => this.controller.abort()
  constructor(private readonly incoming?: AbortSignal) {
    this.timer = setTimeout(this.cancel, RECOVERY_RPC_TIMEOUT_MS)
    incoming?.addEventListener('abort', this.cancel, { once: true })
    if (incoming?.aborted) this.cancel()
  }
  get signal(): AbortSignal { return this.controller.signal }
  check(): void {
    if (this.signal.aborted || performance.now() >= this.expiresAt) { this.cancel(); throw new Error('unavailable') }
  }
  async wait<T>(start: () => PromiseLike<T>): Promise<T> {
    this.check()
    let onAbort: (() => void) | undefined
    try {
      const interrupted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('unavailable'))
        this.signal.addEventListener('abort', onAbort, { once: true })
      })
      const result = await Promise.race([Promise.resolve(start()), interrupted])
      this.check()
      return result
    } finally { if (onAbort) this.signal.removeEventListener('abort', onAbort) }
  }
  dispose(): void {
    clearTimeout(this.timer)
    this.incoming?.removeEventListener('abort', this.cancel)
    this.cancel()
  }
}
function identityError(error: { status?: number; name?: string } | null): boolean {
  if (!error) return false
  if ([400, 401, 403].includes(error.status ?? 0) || error.name === 'AuthSessionMissingError') return true
  throw new Error('unavailable')
}
async function readIdentity(client: SupabaseClient, operation: RecoveryOperation): Promise<IdentityBinding | null> {
  const session = await operation.wait(() => client.auth.getSession())
  if (identityError(session.error)) return null
  const accessToken = session.data.session?.access_token
  if (typeof accessToken !== 'string' || accessToken.length > 16384 || !accessToken) return null
  const verified = await operation.wait(() => client.auth.getUser(accessToken))
  if (identityError(verified.error)) return null
  const user = verified.data.user
  if (!user || !recoveryUuid(user.id) || !user.email) return null
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null
    const claims: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[1], 'base64url')))
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
    const value = claims as Record<string, unknown>
    if (value.sub !== user.id || !recoveryUuid(value.session_id) || !Number.isSafeInteger(value.exp)
      || typeof value.exp !== 'number' || value.exp <= Math.floor(Date.now() / 1000)
      || (value.aal !== 'aal1' && value.aal !== 'aal2') || value.role !== 'authenticated') return null
    const binding = { principalId: user.id, accessToken, expiresAt: value.exp }
    return await identityCurrent(client, binding, operation) ? binding : null
  } catch { operation.check(); return null }
}
async function identityCurrent(client: SupabaseClient, binding: IdentityBinding, operation: RecoveryOperation): Promise<boolean> {
  if (binding.expiresAt <= Math.floor(Date.now() / 1000)) return false
  const current = await operation.wait(() => client.auth.getSession())
  return !identityError(current.error) && current.data.session?.access_token === binding.accessToken
    && binding.expiresAt > Math.floor(Date.now() / 1000)
}
export async function recoveryRpc(client: SupabaseClient,
  name: 'bx1_recovery_read' | 'bx1_recovery_request' | 'bx1_recovery_command', args: Record<string, unknown>,
  existingOperation?: RecoveryOperation,
): Promise<{ data: unknown; failed: boolean }> {
  const operation = existingOperation ?? new RecoveryOperation()
  try {
    const result = await operation.wait(() => client.rpc(name, args).abortSignal(operation.signal))
    if (result.error) return { data: null, failed: true }
    const size = new TextEncoder().encode(JSON.stringify(result.data)).length
    if (size > (name === 'bx1_recovery_read' ? 262144 : 16384)) return { data: null, failed: true }
    operation.check()
    return { data: result.data as unknown, failed: false }
  } catch { return { data: null, failed: true } }
  finally { if (!existingOperation) operation.dispose() }
}
export async function readRecovery(client: SupabaseClient, selectedCaseId?: string): Promise<RecoveryReadProjection> {
  const operation = new RecoveryOperation()
  try {
    if (selectedCaseId !== undefined && !recoveryUuid(selectedCaseId)) return gatedRecovery('unavailable')
    const identity = await readIdentity(client, operation)
    if (!identity) return gatedRecovery('unauthorised')
    const result = await recoveryRpc(client, 'bx1_recovery_read', { selected_case: selectedCaseId ?? null }, operation)
    if (result.failed) return gatedRecovery('unavailable')
    const projection = parseRecoveryReadProjection(result.data, { principalId: identity.principalId, selectedCaseId })
    if (!projection || !await identityCurrent(client, identity, operation)) return gatedRecovery('unavailable')
    // Own held AAL1 status deliberately does not use the ordinary MFA predicate.
    if (projection.cases.some(item => !item.isOwn) || (projection.selectedCase && !projection.selectedCase.isOwn)) {
      const mfa = await operation.wait(() => readMfaContext(client))
      if (!mfa || !hasCurrentTotp(mfa) || !await operation.wait(() => isMfaContextCurrent(client, mfa)) || !await identityCurrent(client, identity, operation)) return gatedRecovery('unavailable')
    }
    return projection
  } catch { return gatedRecovery('unavailable') }
  finally { operation.dispose() }
}
function expectedResult(intent: RecoveryIntent, result: Extract<RecoveryResult, { ok: true }>): boolean {
  const expectedState: RecoveryState = intent.intent === 'request' ? 'REQUESTED' : intent.intent === 'propose' ? 'PENDING_REVIEW'
    : intent.intent === 'review' ? intent.decision === 'approve' ? 'APPROVED' : 'REJECTED' : 'QUARANTINED'
  if (result.state !== expectedState) return false
  if (intent.intent === 'request') return result.revision === '1'
  return result.caseId === intent.caseId && BigInt(result.revision) === BigInt(intent.expectedRevision) + 1n
}
export async function submitRecoveryCommand(client: SupabaseClient, candidate: RecoveryIntent, existingOperation?: RecoveryOperation): Promise<RecoveryResult> {
  const fail = (error: 'invalid_request' | 'unauthorised' | 'forbidden' | 'step_up_required' | 'unavailable'): RecoveryResult => ({ ok: false, error })
  const operation = existingOperation ?? new RecoveryOperation()
  try {
    const intent = parseRecoveryIntent(candidate)
    if (!intent) return fail('invalid_request')
    const identity = await readIdentity(client, operation)
    if (!identity) return fail('unauthorised')
    const mfa: VerifiedMfaContext | null = intent.intent === 'request'
      ? null : await operation.wait(() => readMfaContext(client))
    if (intent.intent !== 'request') {
      if (!mfa || !hasCurrentTotp(mfa)) return fail('forbidden')
      if (!await operation.wait(() => isMfaContextCurrent(client, mfa))) return fail('unavailable')
      if (!requireRecentTotp(mfa, Math.floor(Date.now() / 1000)).allowed) return fail('step_up_required')
    }
    if (!await identityCurrent(client, identity, operation)) return fail('unavailable')
    if (mfa && !requireRecentTotp(mfa, Math.floor(Date.now() / 1000)).allowed) return fail('step_up_required')
    const { requestKey, ...command } = intent
    const result = intent.intent === 'request'
      ? await recoveryRpc(client, 'bx1_recovery_request', { request_key: requestKey, request: command }, operation)
      : await recoveryRpc(client, 'bx1_recovery_command', { request_key: requestKey, command }, operation)
    // After dispatch, unavailable means UNKNOWN outcome, never safe to replace
    // the original key/body. SQL may have committed before a network failure.
    if (result.failed || !await identityCurrent(client, identity, operation)
      || (mfa && !await operation.wait(() => isMfaContextCurrent(client, mfa)))) return fail('unavailable')
    const receipt = parseRecoveryResult(result.data)
    if (!receipt || (receipt.ok && !expectedResult(intent, receipt))) return fail('unavailable')
    return receipt
  } catch { return fail('unavailable') }
  finally { if (!existingOperation) operation.dispose() }
}
