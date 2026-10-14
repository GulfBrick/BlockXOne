import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { platformRelease } from '@/lib/platform-release'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from './operating-context'
import { fundCommands, validatedFundLifecycle, type FundLifecycleAction, type FundLifecycleSnapshot } from './fund-lifecycle-contracts'

export class FundLifecycleError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message) }
}

export function fundLifecycleEnvironment() {
  const release = platformRelease(process.env)
  if (!release) throw new FundLifecycleError('ENVIRONMENT_INVALID', 'The application environment could not be verified.', 503)
  return release.environment
}

/** Compatibility with the existing release, not synthetic business state or a successful acceptance receipt. */
export function unavailableFundLifecycle(actorId: string, context: PortalOperatingContext, reason = 'LIFECYCLE_NOT_INSTALLED'): FundLifecycleSnapshot {
  return { schema_version: 1, projection_revision: 1, actor_id: actorId, environment: fundLifecycleEnvironment(),
    operating_context: context, observed_at: new Date().toISOString(), availability: 'UNAVAILABLE', reason_code: reason, products: [] }
}

export async function readFundLifecycle(client: SupabaseClient, actorId: string, context: PortalOperatingContext = APPLICANT_CONTEXT): Promise<FundLifecycleSnapshot> {
  const { data, error } = await client.rpc('bx1_portal_fund_lifecycle_read_scoped', { operating_context: context }).abortSignal(AbortSignal.timeout(10000))
  if (error && ['42883', 'PGRST202'].includes(error.code)) return unavailableFundLifecycle(actorId, context)
  // A new extension must not break an existing legitimately readable login.
  // Its API separately requires AVAILABLE before preparing any wallet action.
  if (error?.code === '42501') return unavailableFundLifecycle(actorId, context, 'FUND_AUTHORITY_NOT_CURRENT')
  if (error) throw new FundLifecycleError('LIFECYCLE_READ_FAILED', error.code === '42501'
    ? 'Your current account or workspace cannot open this fund workflow.' : 'Fund progress could not be loaded. Retry without submitting another transaction.', error.code === '42501' ? 403 : 503)
  const snapshot = validatedFundLifecycle(data, actorId, context, fundLifecycleEnvironment())
  if (!snapshot) throw new FundLifecycleError('LIFECYCLE_BINDING_INVALID', 'Fund progress could not be verified for this account and workspace.', 503)
  return snapshot
}

export function isFundCommand(command: string): boolean { return (fundCommands as readonly string[]).includes(command) }

export function fundLifecycleActions(snapshot: FundLifecycleSnapshot): FundLifecycleAction[] {
  return snapshot.products.flatMap(product => [
    ...product.actions, ...(product.next_action ? [product.next_action] : []),
    ...product.operations.flatMap(operation => operation.actions), ...product.orders.flatMap(order => order.actions),
  ])
}

/** Discovery only. The database always repeats authority, revision, evidence and transition checks. */
export function fundCommandDiscoverable(snapshot: FundLifecycleSnapshot, command: string, payload: unknown): boolean {
  if (snapshot.availability !== 'AVAILABLE' || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const body = payload as Record<string, unknown>
  return fundLifecycleActions(snapshot).some(action => action.can_execute && action.command === command
    && action.payload !== null && Object.keys(action.payload).length === Object.keys(body).length
    && Object.entries(action.payload).every(([key, value]) => body[key] === value))
}

export async function executeFundCommand(client: SupabaseClient, actorId: string, context: PortalOperatingContext, command: string, key: string, payload: unknown): Promise<FundLifecycleSnapshot> {
  const { data, error } = await client.rpc('bx1_portal_fund_lifecycle_command_scoped', {
    command, request_key: key, payload, operating_context: context,
  }).abortSignal(AbortSignal.timeout(15000))
  if (error) throw new FundLifecycleError(error.code === '42501' ? 'AUTHORITY_CHANGED' : 'COMMAND_NOT_CONFIRMED',
    error.code === '42501' ? 'Your current authority no longer permits this action.'
      : ['22023', '23505', '23514', '40001', 'P0001'].includes(error.code)
        ? 'The fund requirements or saved version changed. Refresh and check the next action.'
        : 'The outcome is uncertain. Refresh the saved fund and retain this request reference before retrying.',
    error.code === '42501' ? 403 : ['22023', '23505', '23514', '40001', 'P0001'].includes(error.code) ? 409 : 503)
  const snapshot = validatedFundLifecycle(data, actorId, context, fundLifecycleEnvironment())
  if (!snapshot) throw new FundLifecycleError('COMMAND_RESULT_UNVERIFIED', 'The saved fund result could not be verified. Refresh before retrying.', 503)
  return snapshot
}
