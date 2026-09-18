import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { BX1_ROLES, type Bx1Role, type Bx1Workspace } from '@/lib/supabase/contracts'
import { evaluateActionPermission, FUTURE_ACTIONS, SUPPORTED_ACTIONS, type PermissionTarget } from './policy'

const targets = {
  'workspace.read': undefined,
  'profile.read_own': { userId: 'user-a' },
  'memberships.read_own': { userId: 'user-a' },
  'organisation.read': { organisationId: 'org-a' },
  'wallet.read_own': { userId: 'user-a', organisationId: 'org-a' },
  'wallet.ownership.challenge': { userId: 'user-a', organisationId: 'org-a' },
  'wallet.ownership.verify': { userId: 'user-a', organisationId: 'org-a' },
} as const

function workspace(roles: Bx1Role[] = ['Investor']): Bx1Workspace {
  return {
    user: { id: 'user-a', email: 'alice@example.test', platformUserId: 'platform-a', displayName: null },
    organisations: [{ id: 'org-a', name: 'Internal A', roles }],
  }
}

describe('server action contract', () => {
  it('freezes exactly the seven existing actions and the reviewed future catalog', () => {
    expect(SUPPORTED_ACTIONS).toEqual(Object.keys(targets))
    expect(FUTURE_ACTIONS).toEqual([
      'subscription.request', 'offering.draft', 'offering.publish', 'offering.approve',
      'compliance.case.review', 'compliance.case.approve', 'allocation.propose', 'allocation.approve',
      'treasury.payment.prepare', 'treasury.payment.approve', 'treasury.payment.execute',
      'journal.prepare', 'journal.approve', 'token.deploy', 'token.mint', 'token.burn',
      'transfer.force', 'recovery.execute', 'institutional_wallet.onboard', 'institutional_wallet.sign',
      'mandate.grant', 'mandate.revoke', 'access.invite', 'access.role.grant', 'access.role.revoke',
      'access.break_glass', 'governance.signer.change', 'governance.policy.change',
      'contract.upgrade', 'contract.role.grant',
    ])
    expect(Object.isFrozen(SUPPORTED_ACTIONS)).toBe(true)
    expect(Object.isFrozen(FUTURE_ACTIONS)).toBe(true)
  })

  describe.each(BX1_ROLES)('%s without a wallet', (role) => {
    it.each(Object.entries(targets))('allows only the matching scope of %s', (action, target) => {
      expect(evaluateActionPermission(workspace([role]), action, target)).toEqual({ allowed: true })
    })
    it.each(FUTURE_ACTIONS)('categorically disables %s', (action) => {
      expect(evaluateActionPermission(workspace([role]), action)).toEqual({ allowed: false, reason: 'not_enabled' })
    })
    it.each(['', '*', 'WORKSPACE.READ', 'wallet.read', 'wallet.read_own ', 'toString', '__proto__'])('disables unknown action %s', (action) => {
      expect(evaluateActionPermission(workspace([role]), action)).toEqual({ allowed: false, reason: 'not_enabled' })
    })
  })

  it.each([
    null, undefined, {}, [], { user: null, organisations: [] },
    { ...workspace(), user: { ...workspace().user, id: ' ' } },
    { ...workspace(), user: { ...workspace().user, platformUserId: '' } },
    { ...workspace(), user: { ...workspace().user, email: null } },
    { ...workspace(), user: { ...workspace().user, displayName: 1 } },
    { ...workspace(), organisations: [] },
    { ...workspace(), organisations: [null] },
    { ...workspace(), organisations: [{ id: ' ', name: 'A', roles: ['Investor'] }] },
    { ...workspace(), organisations: [{ id: 'org-a', name: null, roles: ['Investor'] }] },
    workspace([]), workspace(['Root'] as never), workspace(['investor'] as never),
    workspace(['Investor', 'Root'] as never), workspace(Array(1)),
    { ...workspace(), organisations: [...workspace().organisations, ...workspace().organisations] },
  ])('denies unresolved or malformed workspace %# before checking action', (candidate) => {
    expect(evaluateActionPermission(candidate as Bx1Workspace, 'workspace.read')).toEqual({ allowed: false, reason: 'unavailable_identity' })
    expect(evaluateActionPermission(candidate as Bx1Workspace, 'access.role.grant')).toEqual({ allowed: false, reason: 'unavailable_identity' })
  })

  it.each(Object.entries(targets))('rejects extra or malformed target fields for %s', (action, target) => {
    const invalid = [null, [], 'org-a', 1, { ...target, role: 'SuperAdmin' }, { ...target, active: true },
      { ...target, user_metadata: { role: 'SuperAdmin' } }, { ...target, [Symbol('scope')]: 'all' },
      Object.create({ ...target }), Object.defineProperty({ ...target }, 'extra', { value: true })]
    for (const scope of invalid) {
      expect(evaluateActionPermission(workspace(), action, scope as PermissionTarget)).toEqual({ allowed: false, reason: 'invalid_scope' })
    }
  })

  it('requires exactly the action-specific own-user and assigned-organisation keys', () => {
    expect(evaluateActionPermission(workspace(), 'workspace.read', {})).toEqual({ allowed: true })
    for (const [action, target] of Object.entries(targets)) {
      if (!target) continue
      for (const scope of [undefined, {}, { ...target, userId: 'other-user' }, { ...target, organisationId: 'other-org' }]) {
        expect(evaluateActionPermission(workspace(), action, scope)).toEqual({ allowed: false, reason: 'invalid_scope' })
      }
      for (const key of Object.keys(target)) {
        for (const value of ['', ' ', null, [], ['user-a', 'user-b']]) {
          expect(evaluateActionPermission(workspace(), action, { ...target, [key]: value } as PermissionTarget)).toEqual({ allowed: false, reason: 'invalid_scope' })
        }
      }
    }
  })

  it('does not widen scope through SuperAdmin, role unions or a second organisation', () => {
    const candidate = workspace([...BX1_ROLES])
    candidate.organisations.push({ id: 'org-b', name: 'B', roles: ['Investor'] })
    expect(evaluateActionPermission(candidate, 'wallet.read_own', { userId: 'user-a', organisationId: 'org-b' })).toEqual({ allowed: true })
    expect(evaluateActionPermission(candidate, 'wallet.read_own', { userId: 'other-user', organisationId: 'org-a' })).toEqual({ allowed: false, reason: 'invalid_scope' })
    expect(evaluateActionPermission(candidate, 'wallet.read_own', { userId: 'user-a', organisationId: 'org-c' })).toEqual({ allowed: false, reason: 'invalid_scope' })
    candidate.organisations[1].roles = []
    expect(evaluateActionPermission(candidate, 'organisation.read', { organisationId: 'org-a' })).toEqual({ allowed: false, reason: 'unavailable_identity' })
  })

  it('does not mutate frozen request-local workspace or target', () => {
    const candidate = workspace()
    Object.freeze(candidate.user)
    Object.freeze(candidate.organisations[0].roles)
    Object.freeze(candidate.organisations[0])
    Object.freeze(candidate.organisations)
    Object.freeze(candidate)
    const target = Object.freeze({ userId: 'user-a', organisationId: 'org-a' })
    const before = JSON.stringify({ candidate, target })
    expect(evaluateActionPermission(candidate, 'wallet.read_own', target)).toEqual({ allowed: true })
    expect(evaluateActionPermission(candidate, 'treasury.payment.execute', target)).toEqual({ allowed: false, reason: 'not_enabled' })
    expect(JSON.stringify({ candidate, target })).toBe(before)
  })

  describe.each(BX1_ROLES)('%s blanket unsupported-action denial, not maker-checker implementation', (role) => {
    it.each([
      ['self approval', { maker: 'user-a', checker: 'user-a', approved: true }],
      ['same person with two accounts', { maker: 'account-a', checker: 'account-b', personId: 'same-person' }],
      ['asserted independent approver', { maker: 'user-a', checker: 'user-b', independent: true }],
      ['claimed active mandate', { mandate: { status: 'ACTIVE', expiresAt: '2099-01-01' } }],
      ['claimed expired mandate', { mandate: { status: 'EXPIRED' } }],
      ['claimed revoked mandate', { mandate: { status: 'REVOKED' } }],
      ['changed approved payload', { approvedHash: 'old', payloadHash: 'new', approved: true }],
      ['wallet and governance flags', { walletVerified: true, emergency: true, enabled: true, roles: [...BX1_ROLES] }],
    ])('cannot enable future actions with %s', (_label, claims) => {
      for (const action of FUTURE_ACTIONS) {
        const candidate = { ...workspace([role]), ...claims }
        expect(evaluateActionPermission(candidate, action, { userId: 'user-a', organisationId: 'org-a', ...claims })).toEqual({ allowed: false, reason: 'not_enabled' })
      }
    })
  })
  it('all-role unions still categorically deny every future action', () => {
    for (const action of FUTURE_ACTIONS) {
      expect(evaluateActionPermission(workspace([...BX1_ROLES]), action, { userId: 'user-a', organisationId: 'org-a' })).toEqual({ allowed: false, reason: 'not_enabled' })
    }
  })
})
