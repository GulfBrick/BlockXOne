import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecoveryIntent } from './contracts'
vi.mock('server-only', () => ({}))
const mfa = vi.hoisted(() => ({ read: vi.fn(), current: vi.fn(), totp: vi.fn(), recent: vi.fn() }))
vi.mock('../supabase/mfa', () => ({ readMfaContext: mfa.read, isMfaContextCurrent: mfa.current, hasCurrentTotp: mfa.totp, requireRecentTotp: mfa.recent }))
import { readRecovery, recoveryRpc, RecoveryOperation, submitRecoveryCommand } from './server'
import { gatedRecovery } from './contracts'
const principal = '10000000-0000-4000-8000-000000000001'
const person = '20000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const requestKey = '40000000-0000-4000-8000-000000000001'
const other = '50000000-0000-4000-8000-000000000001'
const sessionId = '60000000-0000-4000-8000-000000000001'
function token(patch = {}) { return `header.${Buffer.from(JSON.stringify({ sub: principal, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal1', role: 'authenticated', ...patch })).toString('base64url')}.signature` }
const request: RecoveryIntent = { intent: 'request', requestKey, reason: 'LOST_AUTHENTICATOR' }
const apply: RecoveryIntent = { intent: 'apply', requestKey, caseId, expectedRevision: '3' }
function success(state = 'REQUESTED', revision = '1', patch = {}) { return { ok: true, caseId, state, revision, replayed: false, ...patch } }
function view(patch = {}) { return { availability: 'ready', policyVersion: 1, caller: { principalId: principal, personId: person }, held: true, canRequest: false, cases: [], casesTruncated: false, selectedCase: null, ...patch } }
let client: SupabaseClient
let getSession: ReturnType<typeof vi.fn>
let getUser: ReturnType<typeof vi.fn>
let rpc: ReturnType<typeof vi.fn>
let rpcResult: { data: unknown; error: unknown }
let activeToken: string
let observedSignal: AbortSignal | undefined
beforeEach(() => {
  vi.clearAllMocks()
  activeToken = token()
  getSession = vi.fn().mockImplementation(async () => ({ data: { session: { access_token: activeToken } }, error: null }))
  getUser = vi.fn().mockResolvedValue({ data: { user: { id: principal, email: 'synthetic@example.invalid', user_metadata: { role: 'SuperAdmin' } } }, error: null })
  rpcResult = { data: success(), error: null }
  rpc = vi.fn().mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { observedSignal = signal; return Promise.resolve(rpcResult) } }))
  client = { auth: { getSession, getUser }, rpc } as unknown as SupabaseClient
  mfa.read.mockResolvedValue(Object.freeze({}))
  mfa.current.mockResolvedValue(true)
  mfa.totp.mockReturnValue(true)
  mfa.recent.mockReturnValue({ allowed: true })
})
afterEach(() => vi.useRealTimers())
describe('recovery request-local identity and dispatch', () => {
  it('verifies the exact token and sends a target-free own AAL1 request without ordinary MFA admission', async () => {
    expect(await submitRecoveryCommand(client, request)).toEqual(success())
    expect(getUser).toHaveBeenCalledExactlyOnceWith(activeToken)
    expect(mfa.read).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('bx1_recovery_request', { request_key: requestKey, request: { intent: 'request', reason: 'LOST_AUTHENTICATOR' } })
  })
  it.each([
    { intent: 'propose', requestKey, caseId, expectedRevision: '1', evidenceReference: 'synthetic:review' },
    { intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'approve' },
    { intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'reject' }, apply,
  ] as RecoveryIntent[])('maps the privileged intent exactly and requires recent own TOTP %#', async intent => {
    const state = intent.intent === 'propose' ? 'PENDING_REVIEW' : intent.intent === 'review' ? intent.decision === 'approve' ? 'APPROVED' : 'REJECTED' : 'QUARANTINED'
    const revision = intent.intent === 'request' ? '1' : String(BigInt(intent.expectedRevision) + 1n)
    rpcResult.data = success(state, revision)
    expect(await submitRecoveryCommand(client, intent)).toEqual(rpcResult.data)
    const { requestKey: key, ...command } = intent
    expect(rpc).toHaveBeenCalledExactlyOnceWith('bx1_recovery_command', { request_key: key, command })
    expect(mfa.read).toHaveBeenCalledOnce()
    expect(mfa.recent).toHaveBeenCalledTimes(2)
  })
  it.each(['missing', 'wrong-user', 'expired', 'missing-session', 'wrong-role', 'provider-error'] as const)('denies %s before RPC', async variant => {
    if (variant === 'missing') activeToken = ''
    if (variant === 'wrong-user') getUser.mockResolvedValue({ data: { user: { id: other, email: 'x@example.invalid' } }, error: null })
    if (variant === 'expired') activeToken = token({ exp: 1 })
    if (variant === 'missing-session') activeToken = token({ session_id: null })
    if (variant === 'wrong-role') activeToken = token({ role: 'service_role' })
    if (variant === 'provider-error') getUser.mockResolvedValue({ data: { user: null }, error: { status: 403, message: 'private' } })
    expect(await submitRecoveryCommand(client, request)).toEqual({ ok: false, error: 'unauthorised' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not dispatch a forged target or a stale/absent factor context', async () => {
    expect(await submitRecoveryCommand(client, { ...request, target: other } as RecoveryIntent)).toEqual({ ok: false, error: 'invalid_request' })
    expect(getUser).not.toHaveBeenCalled()
    mfa.read.mockResolvedValue(null)
    expect(await submitRecoveryCommand(client, apply)).toEqual({ ok: false, error: 'forbidden' })
    mfa.read.mockResolvedValue({})
    mfa.recent.mockReturnValue({ allowed: false, reason: 'step_up_required' })
    expect(await submitRecoveryCommand(client, apply)).toEqual({ ok: false, error: 'step_up_required' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('checks recency again after preflight waits', async () => {
    mfa.recent.mockReturnValueOnce({ allowed: true }).mockReturnValueOnce({ allowed: false, reason: 'step_up_required' })
    expect(await submitRecoveryCommand(client, apply)).toEqual({ ok: false, error: 'step_up_required' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    success('APPROVED', '4'), success('QUARANTINED', '9'), success('QUARANTINED', '4', { caseId: other }),
    success('QUARANTINED', '4', { provider: 'private' }), null, { ok: false, error: 'raw SQL error' },
  ])('treats a misbound or malformed command receipt as unknown %#', async data => {
    rpcResult.data = data
    expect(await submitRecoveryCommand(client, apply)).toEqual({ ok: false, error: 'unavailable' })
    expect(rpc).toHaveBeenCalledOnce()
  })
  it('preserves exact key and body on explicit same-intent replay; never automatically retries', async () => {
    rpcResult.data = success('QUARANTINED', '4', { replayed: true })
    expect(await submitRecoveryCommand(client, apply)).toEqual(rpcResult.data)
    expect(await submitRecoveryCommand(client, apply)).toEqual(rpcResult.data)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  })
  it('returns unknown if the token changes after dispatch and never leaks errors', async () => {
    rpc.mockImplementation(() => ({ abortSignal: async () => { activeToken = token({ session_id: other }); return rpcResult } }))
    expect(await submitRecoveryCommand(client, request)).toEqual({ ok: false, error: 'unavailable' })
    expect(rpc).toHaveBeenCalledOnce()
    getUser.mockRejectedValue(new Error('private transport body'))
    expect(await submitRecoveryCommand(client, request)).toEqual({ ok: false, error: 'unavailable' })
  })
})
describe('one immutable operation deadline', () => {
  const fakeTime = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  it('bounds never-resolving preflight without a later mutation', async () => {
    fakeTime()
    let release: ((value: unknown) => void) | undefined
    getUser.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const pending = submitRecoveryCommand(client, request)
    await vi.advanceTimersByTimeAsync(12001)
    expect(await pending).toEqual({ ok: false, error: 'unavailable' })
    release?.({ data: { user: { id: principal, email: 'synthetic@example.invalid' } }, error: null })
    await vi.advanceTimersByTimeAsync(1)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not restart the deadline at each successful preflight step', async () => {
    fakeTime()
    getSession.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { session: { access_token: activeToken } }, error: null }), 4500)))
    getUser.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { user: { id: principal, email: 'synthetic@example.invalid' } }, error: null }), 4500)))
    const pending = submitRecoveryCommand(client, request)
    await vi.advanceTimersByTimeAsync(12001)
    expect(await pending).toEqual({ ok: false, error: 'unavailable' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('aborts transport at the same deadline after dispatch and reports unknown', async () => {
    fakeTime()
    rpc.mockImplementation(() => ({ abortSignal: (signal: AbortSignal) => { observedSignal = signal; return new Promise(() => undefined) } }))
    const pending = submitRecoveryCommand(client, request)
    await vi.advanceTimersByTimeAsync(12001)
    expect(await pending).toEqual({ ok: false, error: 'unavailable' })
    expect(rpc).toHaveBeenCalledOnce()
    expect(observedSignal?.aborted).toBe(true)
  })
  it('honours incoming cancellation before preflight and before dispatch', async () => {
    const abort = new AbortController()
    const operation = new RecoveryOperation(abort.signal)
    abort.abort()
    expect(await submitRecoveryCommand(client, request, operation)).toEqual({ ok: false, error: 'unavailable' })
    expect(getSession).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    operation.dispose()
  })
})
describe('safe own status and bounded operator reads', () => {
  it('reads held status without ordinary business/MFA context', async () => {
    rpcResult.data = view()
    expect(await readRecovery(client)).toEqual(view())
    expect(mfa.read).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('bx1_recovery_read', { selected_case: null })
  })
  it('fails closed on caller misbinding and invalid selected IDs', async () => {
    rpcResult.data = view({ caller: { principalId: other, personId: person } })
    expect(await readRecovery(client)).toEqual(gatedRecovery('unavailable'))
    rpc.mockClear()
    expect(await readRecovery(client, 'not-a-uuid')).toEqual(gatedRecovery('unavailable'))
    expect(rpc).not.toHaveBeenCalled()
  })
  it('requires current TOTP, not a recent timestamp, for operator case reads', async () => {
    const item = { caseId, targetPersonId: other, requesterPrincipalId: other, state: 'REQUESTED', revision: '1', reason: 'LOST_AUTHENTICATOR',
      createdAt: '2026-09-20T12:00:00Z', expiresAt: '2026-09-21T12:00:00Z', proposedByPersonId: null, reviewedByPersonId: null,
      evidenceReference: null, isOwn: false, requiresStepUp: true, allowedActions: [] }
    rpcResult.data = view({ held: false, cases: [item] })
    expect((await readRecovery(client)).cases).toEqual([item])
    expect(mfa.recent).not.toHaveBeenCalled()
    mfa.totp.mockReturnValue(false)
    expect(await readRecovery(client)).toEqual(gatedRecovery('unavailable'))
  })
  it('rejects oversized and provider-error responses without exposing content', async () => {
    rpcResult.data = { content: 'x'.repeat(16385) }
    expect(await recoveryRpc(client, 'bx1_recovery_request', {})).toEqual({ data: null, failed: true })
    rpcResult = { data: null, error: { message: 'private SQL context' } }
    expect(await readRecovery(client)).toEqual(gatedRecovery('unavailable'))
  })
})
