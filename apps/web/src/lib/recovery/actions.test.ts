import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('./server', () => ({ submitRecoveryCommand: mocks.submit }))
import { handleRecoveryAction } from './actions'
const requestKey = '40000000-0000-4000-8000-000000000001'
const caseId = '30000000-0000-4000-8000-000000000001'
const client = {} as SupabaseClient
const fields = { intent: 'request', requestKey, reason: 'LOST_AUTHENTICATOR' }
beforeEach(() => { mocks.submit.mockReset(); mocks.submit.mockResolvedValue({ ok: true, caseId, state: 'REQUESTED', revision: '1', replayed: false }) })
describe('recovery form adapter', () => {
  it('accepts only the closed form and preserves private headers', async () => {
    const response = await handleRecoveryAction(new URLSearchParams(fields), client)
    expect(response.status).toBe(200)
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(client, fields, undefined)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
  })
  it.each([new URLSearchParams({ ...fields, role: 'SuperAdmin' }), new URLSearchParams(`intent=request&intent=request&requestKey=${requestKey}&reason=LOST_AUTHENTICATOR`),
    new URLSearchParams({ ...fields, reason: 'x'.repeat(9000) })])('rejects forged, duplicate and oversized fields %#', async form => {
    expect((await handleRecoveryAction(form, client)).status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it.each([['forbidden', 403], ['step_up_required', 403], ['conflict', 409], ['expired', 409], ['unavailable', 503]] as const)('maps safe %s outcome without raw errors', async (error, status) => {
    mocks.submit.mockResolvedValue({ ok: false, error })
    const response = await handleRecoveryAction(new URLSearchParams(fields), client)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ ok: false, error })
  })
  it('sanitizes unexpected exceptions', async () => {
    mocks.submit.mockRejectedValue(new Error('private SQL provider body'))
    const response = await handleRecoveryAction(new URLSearchParams(fields), client)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
  })
})
