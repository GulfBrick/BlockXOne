import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ after: vi.fn(), process: vi.fn() }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('./offering-signatures-server', () => ({ executeSignatureProcessing: mocks.process }))
import { scheduleOfferingSignatureWake } from './offering-signature-wake'

const actor = '11111111-1111-4111-8111-111111111111'
const session = '22222222-2222-4222-8222-222222222222'
const product = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const key = '55555555-5555-4555-8555-555555555555'
const context = { mode: 'ROLE' as const, organisationId: product, role: 'IssuerFundManager' as const }
const scope = { actorId: actor, sessionId: session, aal: 'aal2' as const, context, productId: product, revisionId: revision }
const now = Date.UTC(2026, 9, 15, 12), deadline = now + 50_000
function confirmation(command = 'PREPARE_EXECUTION') {
  return { command, key, snapshot: { version: 1, actor_id: actor, session_id: session, context, environment: 'TESTNET',
    product_id: product, revision_id: revision, expected_revision: 3, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: true,
    authorisations: [], operations: [], allowed_commands: [], blocker: null } }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const [name, value] of Object.entries({ BLOCKXONE_AUTH_MODE: 'supabase', NEXT_PUBLIC_BLOCKXONE_AUTH_MODE: 'supabase',
    BLOCKXONE_APP_ORIGIN: 'https://testnet.bx1.co.za', SUPABASE_URL: 'https://fegnnnlseuejkrusbbkv.supabase.co', VERCEL_ENV: 'preview' })) vi.stubEnv(name, value)
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'BLOCKXONE_ENVIRONMENT', 'NEXT_PUBLIC_BLOCKXONE_RUNTIME_SCOPE']) vi.stubEnv(name, undefined)
  mocks.process.mockResolvedValue({ outcome: 'IDLE' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('authorised command post-response signature producer', () => {
  it.each(['PREPARE_EXECUTION', 'REQUEST_RECONCILIATION', 'REQUEST_RECOVERY'])(
    'defers %s and uses only the existing WAKE lease boundary', async command => {
      expect(scheduleOfferingSignatureWake(confirmation(command), scope, deadline)).toBe(true)
      expect(mocks.after).toHaveBeenCalledTimes(1)
      expect(mocks.process).not.toHaveBeenCalled()
      await mocks.after.mock.calls[0][0]()
      expect(mocks.process).toHaveBeenCalledExactlyOnceWith({ command: 'WAKE', request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }, deadline)
    })
  it.each(['REQUEST_SIGNING_VIEW', 'REQUEST_PURPOSE', 'REVIEW_PURPOSE', 'REVOKE_PURPOSE'])(
    'never schedules the non-background command %s', command => {
      const value = { ...confirmation(command), ...(command === 'REQUEST_SIGNING_VIEW' ? { view_status: 'RETRY_SAME_ENVELOPE' } : {}) }
      expect(scheduleOfferingSignatureWake(value, scope, deadline)).toBe(false)
      expect(mocks.after).not.toHaveBeenCalled()
    })
  it('requires the confirmed actor, session, context, product, revision, AAL2 and admission', () => {
    const changes = [{ actor_id: product }, { session_id: product }, { product_id: actor }, { revision_id: actor },
      { context: { ...context, role: 'ComplianceOfficer' } }, { admitted: false }]
    for (const change of changes) {
      const value = confirmation()
      expect(scheduleOfferingSignatureWake({ ...value, snapshot: { ...value.snapshot, ...change } }, scope, deadline)).toBe(false)
    }
    expect(scheduleOfferingSignatureWake(confirmation(), { ...scope, aal: 'aal1' }, deadline)).toBe(false)
    expect(scheduleOfferingSignatureWake({ ok: true }, scope, deadline)).toBe(false)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('never runs MAIN or an unbranded preview even with an otherwise valid confirmation', () => {
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    vi.stubEnv('SUPABASE_URL', 'https://oqkevkjbkpugjotihtda.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(scheduleOfferingSignatureWake(confirmation(), scope, deadline)).toBe(false)
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://block-x-one-review.vercel.app')
    vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(scheduleOfferingSignatureWake(confirmation(), scope, deadline)).toBe(false)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('stops after three attempts under the same deadline, without pretending completion', async () => {
    mocks.process.mockResolvedValue({ outcome: 'PROCESSED' })
    scheduleOfferingSignatureWake(confirmation(), scope, deadline)
    await mocks.after.mock.calls[0][0]()
    expect(mocks.process).toHaveBeenCalledTimes(3)
    expect(new Set(mocks.process.mock.calls.map(call => call[0].request_id)).size).toBe(3)
    expect(mocks.process.mock.calls.every(call => call[1] === deadline && call[0].command === 'WAKE')).toBe(true)
  })
  it('reserves time for checkpoints and will not start another attempt after the budget is consumed', async () => {
    let current = now
    vi.spyOn(Date, 'now').mockImplementation(() => current)
    mocks.process.mockImplementation(async () => { current += 42_001; return { outcome: 'PROCESSED' } })
    scheduleOfferingSignatureWake(confirmation(), scope, deadline)
    await mocks.after.mock.calls[0][0]()
    expect(mocks.process).toHaveBeenCalledTimes(1)
    for (const expired of [NaN, Infinity, now, now + 8_000]) expect(scheduleOfferingSignatureWake(confirmation(), scope, expired)).toBe(false)
  })
  it('does not schedule new work after a runtime configuration change', async () => {
    scheduleOfferingSignatureWake(confirmation(), scope, deadline)
    vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://bx1.co.za')
    await mocks.after.mock.calls[0][0]()
    expect(mocks.process).not.toHaveBeenCalled()
  })
  it('contains scheduler and worker errors without leaking provider or account data', async () => {
    mocks.process.mockRejectedValue(new Error('private-provider-response secret user@example.invalid'))
    expect(scheduleOfferingSignatureWake(confirmation(), scope, deadline)).toBe(true)
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined()
    expect(mocks.process).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledExactlyOnceWith('bx1_offering_signature_wake_failed')
    mocks.after.mockImplementation(() => { throw new Error('private scheduler data') })
    expect(scheduleOfferingSignatureWake(confirmation(), scope, deadline)).toBe(false)
    expect(console.error).toHaveBeenLastCalledWith('bx1_offering_signature_wake_schedule_failed')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|secret|@/)
  })
})
