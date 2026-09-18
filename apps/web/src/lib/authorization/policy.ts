import 'server-only'

import { BX1_ROLES, type Bx1Workspace } from '@/lib/supabase/contracts'

export const SUPPORTED_ACTIONS = Object.freeze([
  'workspace.read', 'profile.read_own', 'memberships.read_own', 'organisation.read',
  'wallet.read_own', 'wallet.ownership.challenge', 'wallet.ownership.verify',
] as const)

export const FUTURE_ACTIONS = Object.freeze([
  'subscription.request', 'offering.draft', 'offering.publish', 'offering.approve',
  'compliance.case.review', 'compliance.case.approve', 'allocation.propose', 'allocation.approve',
  'treasury.payment.prepare', 'treasury.payment.approve', 'treasury.payment.execute',
  'journal.prepare', 'journal.approve', 'token.deploy', 'token.mint', 'token.burn',
  'transfer.force', 'recovery.execute', 'institutional_wallet.onboard', 'institutional_wallet.sign',
  'mandate.grant', 'mandate.revoke', 'access.invite', 'access.role.grant', 'access.role.revoke',
  'access.break_glass', 'governance.signer.change', 'governance.policy.change',
  'contract.upgrade', 'contract.role.grant',
] as const)

export type PermissionTarget = { userId?: string; organisationId?: string }
export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: 'unavailable_identity' | 'invalid_scope' | 'not_enabled' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function resolvedWorkspace(value: unknown): value is Bx1Workspace {
  if (!record(value) || !record(value.user) || !Array.isArray(value.organisations) || !value.organisations.length) return false
  const user = value.user
  if (!identifier(user.id) || !identifier(user.platformUserId) || !identifier(user.email)
    || !(user.displayName === null || typeof user.displayName === 'string')) return false
  const ids = new Set<string>()
  for (const organisation of value.organisations) {
    if (!record(organisation) || !identifier(organisation.id) || typeof organisation.name !== 'string'
      || !Array.isArray(organisation.roles) || !organisation.roles.length || ids.has(organisation.id)) return false
    for (const role of organisation.roles) {
      if (!BX1_ROLES.some((known) => known === role)) return false
    }
    ids.add(organisation.id)
  }
  return true
}

// Only trusted server callers may supply a fresh getUser/RLS-resolved workspace.
// Shape validation is not authentication, and this policy does not replace RLS.
export function evaluateActionPermission(
  workspace: Bx1Workspace | null,
  action: string,
  target?: PermissionTarget,
): PermissionDecision {
  if (!resolvedWorkspace(workspace)) return { allowed: false, reason: 'unavailable_identity' }
  if (!SUPPORTED_ACTIONS.some((supported) => supported === action)) return { allowed: false, reason: 'not_enabled' }

  const keys = action === 'workspace.read' ? []
    : action === 'profile.read_own' || action === 'memberships.read_own' ? ['userId']
      : action === 'organisation.read' ? ['organisationId'] : ['userId', 'organisationId']
  const scope = target === undefined && action === 'workspace.read' ? {} : target
  if (!record(scope) || Reflect.ownKeys(scope).length !== keys.length
    || keys.some((key) => !Object.hasOwn(scope, key) || !identifier(scope[key]))) {
    return { allowed: false, reason: 'invalid_scope' }
  }
  if (keys.includes('userId') && scope.userId !== workspace.user.id) return { allowed: false, reason: 'invalid_scope' }
  if (keys.includes('organisationId') && !workspace.organisations.some((organisation) => organisation.id === scope.organisationId)) {
    return { allowed: false, reason: 'invalid_scope' }
  }
  return { allowed: true }
}
