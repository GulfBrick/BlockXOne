import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminIntent, AdminPayloadByKind } from './contracts'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ load: vi.fn(), check: vi.fn(), rpc: vi.fn() }))
vi.mock('./context', async original => ({ ...await original<object>(), loadAdministrationContext: mocks.load, checkAdministrationContext: mocks.check, administrationRpc: mocks.rpc }))
import { gatedAdministration } from './context'
import { readAdministration, submitAdministrationCommand } from './server'

const org = '10000000-0000-4000-8000-000000000001'
const principal = '20000000-0000-4000-8000-000000000001'
const person = '30000000-0000-4000-8000-000000000001'
const key = '40000000-0000-4000-8000-000000000001'
const proposal = '50000000-0000-4000-8000-000000000001'
const other = '60000000-0000-4000-8000-000000000001'
const client = {} as SupabaseClient
const context = Object.freeze({})
const payloads: AdminPayloadByKind = {
  ENTITY_DRAFT_CREATE: { displayName: 'Synthetic party', kind: 'FUND', jurisdictionCode: null, registrationReference: null },
  MEMBERSHIP_GRANT: { principalId: principal, role: 'Investor' },
  MEMBERSHIP_REVOKE: { membershipId: other, reason: 'routine' },
  GOVERNANCE_GRANT: { personId: person, validUntil: '2026-09-20T12:00:00Z' },
  GOVERNANCE_REVOKE: { grantId: other, reason: 'security' },
  PERSON_SCOPE_REVOKE: { personId: person, reason: 'security' },
}
function propose(kind: keyof AdminPayloadByKind = 'ENTITY_DRAFT_CREATE'): AdminIntent {
  return { intent: 'propose', organisationId: org, requestKey: key, kind, payload: JSON.stringify(payloads[kind]), expectedScopeRevision: '1' }
}
const apply: AdminIntent = { intent: 'apply', organisationId: org, requestKey: key, proposalId: proposal, expectedRevision: '2' }
function success(state = 'APPLIED', patch = {}) {
  return { ok: true, proposalId: proposal, state, revision: '3', replayed: false, scopeState: 'READY', scopeRevision: '10', ...patch }
}
beforeEach(() => {
  mocks.load.mockResolvedValue({ projection: { availability: 'ready', scopeRevision: '99', proposals: [], selectedProposal: null }, context })
  mocks.check.mockResolvedValue({ allowed: true })
  mocks.rpc.mockResolvedValue({ data: success(), failed: false })
})

describe('caller-session administration adapters', () => {
  it('returns gated reads unchanged and clears facts if final continuity fails', async () => {
    mocks.load.mockResolvedValueOnce({ context: null, projection: gatedAdministration('unconfigured') })
    expect(await readAdministration(client, org)).toEqual(gatedAdministration('unconfigured'))
    expect(mocks.check).not.toHaveBeenCalled()
    mocks.check.mockResolvedValue({ allowed: false, reason: 'unavailable' })
    expect(await readAdministration(client, org, proposal)).toEqual(gatedAdministration('unavailable'))
    expect(mocks.load).toHaveBeenLastCalledWith(client, org, proposal)
  })
  it.each(Object.keys(payloads) as Array<keyof AdminPayloadByKind>)('maps %s explicitly, with JSON object rather than string payload', async kind => {
    mocks.rpc.mockResolvedValue({ data: success('PENDING_REVIEW', { revision: '1', scopeRevision: '1' }), failed: false })
    expect((await submitAdministrationCommand(client, propose(kind))).ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(client, 'bx1_administration_command', {
      target_organisation: org, request_key: key,
      command: { intent: 'propose', kind, payload: payloads[kind], expectedScopeRevision: '1' },
    })
    const command = mocks.rpc.mock.calls[0][2].command
    expect(command).not.toHaveProperty('organisationId')
    expect(command).not.toHaveProperty('requestKey')
    expect(command).not.toHaveProperty('actor')
  })
  it.each([
    ['review', 'approve', 'APPROVED'], ['review', 'reject', 'REJECTED'],
    ['apply', undefined, 'APPLIED'], ['cancel', undefined, 'CANCELLED'],
  ] as const)('maps %s %s exactly and validates authoritative state', async (intent, decision, state) => {
    const candidate = { ...apply, intent, ...(decision ? { decision } : {}) } as AdminIntent
    mocks.rpc.mockResolvedValue({ data: success(state), failed: false })
    expect(await submitAdministrationCommand(client, candidate)).toEqual(success(state))
    expect(mocks.rpc.mock.calls[0][2]).toEqual({ target_organisation: org, request_key: key,
      command: { intent, proposalId: proposal, expectedRevision: '2', ...(decision ? { decision } : {}) } })
  })
  it('preserves the same original key/body on deliberate retries despite refreshed revisions and no transition hints', async () => {
    mocks.rpc.mockResolvedValue({ data: success('APPLIED', { replayed: true }), failed: false })
    const expected = success('APPLIED', { replayed: true })
    expect(await submitAdministrationCommand(client, apply)).toEqual(expected)
    expect(await submitAdministrationCommand(client, apply)).toEqual(expected)
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
    expect(mocks.check).toHaveBeenCalledWith(client, context, 'administration.apply', org)
  })
  it.each(['expired', 'conflict', 'forbidden'] as const)('lets SQL discover and return %s without inventing success', async error => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error }, failed: false })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves APPLIED plus HOLD as success, never a failed restriction', async () => {
    mocks.rpc.mockResolvedValue({ data: success('APPLIED', { scopeState: 'HOLD' }), failed: false })
    expect(await submitAdministrationCommand(client, apply)).toEqual(success('APPLIED', { scopeState: 'HOLD' }))
  })
  it.each(['mfa_required', 'step_up_required', 'governance_hold', 'forbidden'] as const)('blocks %s before mutation dispatch', async reason => {
    mocks.check.mockResolvedValue({ allowed: false, reason })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: reason })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('never manufactures capability from a badge or denied context', async () => {
    mocks.load.mockResolvedValue({ context: null, projection: gatedAdministration('unconfigured'), error: 'unconfigured' })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: 'unconfigured' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { ...apply, expectedRevision: '0' }, { ...apply, actor: principal },
    { ...apply, requestKey: 'bad' }, { ...apply, decision: 'approve' },
    { ...propose(), payload: '{"displayName":"a","displayName":"b"}' },
  ])('rejects malformed/forged intent locally %#', async candidate => {
    expect(await submitAdministrationCommand(client, candidate as AdminIntent)).toEqual({ ok: false, error: 'invalid_request' })
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    null, { ok: true }, success('APPROVED'), success('APPLIED', { proposalId: other }),
    success('APPLIED', { revision: '7' }), success('APPLIED', { token: 'private' }),
    { ok: false, error: 'raw-sql-error' },
  ])('rejects malformed, misbound or wrong-intent result %#', async data => {
    mocks.rpc.mockResolvedValue({ data, failed: false })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: 'unavailable' })
  })
  it('retains unknown outcome on transport error, expiry or token loss after dispatch; never retries', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, failed: true })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: 'unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    mocks.check.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: 'unavailable' })
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: 'unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
  it('redacts thrown provider or database details', async () => {
    mocks.rpc.mockRejectedValue(new Error('private-sql-token'))
    expect(await submitAdministrationCommand(client, apply)).toEqual({ ok: false, error: 'unavailable' })
  })
})
