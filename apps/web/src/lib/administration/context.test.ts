import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ mfa: vi.fn(), totp: vi.fn(), current: vi.fn(), recent: vi.fn(), workspace: vi.fn() }))
vi.mock('../supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasCurrentTotp: mocks.totp, isMfaContextCurrent: mocks.current, requireRecentTotp: mocks.recent }))
vi.mock('../supabase/server', () => ({ readWorkspace: mocks.workspace }))
import { ADMINISTRATION_RPC_TIMEOUT_MS, administrationRpc, checkAdministrationContext, gatedAdministration, loadAdministrationContext } from './context'

const now = Date.parse('2026-09-19T12:00:00Z')
const org = '10000000-0000-4000-8000-000000000001'
const principal = '20000000-0000-4000-8000-000000000001'
const person = '30000000-0000-4000-8000-000000000001'
const grant = '40000000-0000-4000-8000-000000000001'
const other = '50000000-0000-4000-8000-000000000001'
function projection() {
  return { availability: 'ready', scopeRevision: '9', policyVersion: 1,
    caller: { principalId: principal, personId: person, grant: { id: grant, personId: person, capability: 'ADMINISTRATION_V1', status: 'ACTIVE', validFrom: '2026-09-19T11:00:00Z', validUntil: '2026-09-20T12:00:00Z', revision: '1' } },
    scope: { organisationId: org, state: 'READY', revision: '9', policyVersion: 1, trustRevision: '2' },
    people: [], entities: [], proposals: [], selectedProposal: null, governanceGrants: [], grantsTruncated: false,
    truncated: { people: false, entities: false, proposals: false } }
}
function fixture(data: unknown = projection()) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error: null })
  const rpc = vi.fn(() => ({ abortSignal }))
  return { rpc, abortSignal, client: { rpc } as unknown as SupabaseClient }
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  mocks.mfa.mockResolvedValue(Object.freeze({}))
  mocks.totp.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.recent.mockReturnValue({ allowed: true })
  mocks.workspace.mockResolvedValue({ user: { id: principal }, organisations: [{ id: org, roles: ['SuperAdmin'] }] })
})
afterEach(() => vi.useRealTimers())

describe('fresh scoped opaque administration context', () => {
  it('issues a nonserializable request-local handle only after exact projection and token checks', async () => {
    const f = fixture()
    const loaded = await loadAdministrationContext(f.client, org)
    expect(loaded.error).toBeUndefined()
    expect(loaded.projection.availability).toBe('ready')
    expect(JSON.stringify(loaded.context)).toBe('{}')
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('bx1_administration_read', { target_organisation: org, selected_command: null })
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.read', org)).toEqual({ allowed: true })
    expect(await checkAdministrationContext(f.client, {} as never, 'administration.read', org)).toEqual({ allowed: false, reason: 'forbidden' })
    expect(await checkAdministrationContext(fixture().client, loaded.context, 'administration.read', org)).toEqual({ allowed: false, reason: 'forbidden' })
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.read', other)).toEqual({ allowed: false, reason: 'forbidden' })
  })
  it('requires current TOTP for reads but recency only for commands', async () => {
    const f = fixture()
    mocks.recent.mockReturnValue({ allowed: false, reason: 'step_up_required' })
    const loaded = await loadAdministrationContext(f.client, org)
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.read', org)).toEqual({ allowed: true })
    expect(mocks.recent).not.toHaveBeenCalled()
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.cancel', org)).toEqual({ allowed: false, reason: 'step_up_required' })
    mocks.totp.mockReturnValue(false)
    expect((await loadAdministrationContext(f.client, org)).error).toBe('mfa_required')
    expect(f.rpc).toHaveBeenCalledTimes(1)
  })
  it.each(['missing', 'no-totp', 'foreign', 'malformed', 'changed-token'])('denies %s before any administration RPC', async kind => {
    const f = fixture()
    if (kind === 'missing') mocks.mfa.mockResolvedValue(null)
    if (kind === 'no-totp') mocks.totp.mockReturnValue(false)
    if (kind === 'foreign') mocks.workspace.mockResolvedValue({ user: { id: principal }, organisations: [{ id: other }] })
    if (kind === 'changed-token') mocks.current.mockResolvedValue(false)
    const loaded = await loadAdministrationContext(f.client, kind === 'malformed' ? 'bad' : org)
    expect(loaded.context).toBeNull()
    expect(loaded.projection.people).toEqual([])
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('passes an independently scoped selected detail identifier without requiring list membership', async () => {
    const f = fixture()
    await loadAdministrationContext(f.client, org, other)
    expect(f.rpc).toHaveBeenCalledWith('bx1_administration_read', { target_organisation: org, selected_command: other })
  })
  it.each(['unconfigured', 'forbidden', 'mfa_required', 'unavailable'] as const)('keeps %s gated with no roster or manufactured authority', async availability => {
    const loaded = await loadAdministrationContext(fixture(gatedAdministration(availability)).client, org)
    expect(loaded).toEqual({ context: null, projection: gatedAdministration(availability), error: availability })
  })
  it('rejects forged principal, cross-org projection and foreign selected detail', async () => {
    for (const data of [
      { ...projection(), caller: { ...projection().caller, principalId: other } },
      { ...projection(), scope: { ...projection().scope, organisationId: other } },
      { ...gatedAdministration('unconfigured'), people: [{ id: person }] },
      { ...projection(), selectedProposal: { id: other } },
    ]) expect((await loadAdministrationContext(fixture(data).client, org)).error).toBe('unavailable')
  })
  it('rejects expired grant or authority expiry during awaited continuity validation', async () => {
    const expired = projection()
    expired.caller.grant.validUntil = '2026-09-19T12:00:00Z'
    expect((await loadAdministrationContext(fixture(expired).client, org)).error).toBe('forbidden')
    const f = fixture()
    const loaded = await loadAdministrationContext(f.client, org)
    mocks.current.mockImplementationOnce(async () => { vi.spyOn(Date, 'now').mockReturnValue(now + 15_000); return true })
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.propose', org)).toEqual({ allowed: false, reason: 'forbidden' })
  })
  it('allows HOLD evidence reads but denies every mutation including replay', async () => {
    const data = projection(); data.availability = 'hold'; data.scope.state = 'HOLD'
    const f = fixture(data)
    const loaded = await loadAdministrationContext(f.client, org)
    expect(await checkAdministrationContext(f.client, loaded.context, 'administration.read', org)).toEqual({ allowed: true })
    for (const action of ['propose', 'review', 'apply', 'cancel'] as const) expect(await checkAdministrationContext(f.client, loaded.context, `administration.${action}`, org)).toEqual({ allowed: false, reason: 'governance_hold' })
  })
  it('rejects token continuity loss after the read and redacts RPC failures', async () => {
    const f = fixture()
    mocks.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await loadAdministrationContext(f.client, org)).error).toBe('unavailable')
    f.abortSignal.mockRejectedValue(new Error('raw-provider-secret'))
    expect(JSON.stringify(await loadAdministrationContext(f.client, org))).not.toContain('raw-provider-secret')
  })
  it('aborts a never-settling administration read at its finite deadline', async () => {
    vi.useFakeTimers()
    const f = fixture(); f.abortSignal.mockReturnValue(new Promise(() => {}))
    const pending = loadAdministrationContext(f.client, org)
    await vi.advanceTimersByTimeAsync(ADMINISTRATION_RPC_TIMEOUT_MS + 1)
    expect((await pending).error).toBe('unavailable')
    expect((f.abortSignal.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
  })
  it('times out a dispatched command without a rollback/no-effect assertion or an automatic retry', async () => {
    vi.useFakeTimers()
    const f = fixture(); f.abortSignal.mockReturnValue(new Promise(() => {}))
    const pending = administrationRpc(f.client, 'bx1_administration_command', { target_organisation: org })
    await vi.advanceTimersByTimeAsync(ADMINISTRATION_RPC_TIMEOUT_MS + 1)
    expect(await pending).toEqual({ data: null, failed: true })
    expect(f.rpc).toHaveBeenCalledTimes(1)
    expect((f.abortSignal.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
