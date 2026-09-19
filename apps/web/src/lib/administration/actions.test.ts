import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('./server', () => ({ submitAdministrationCommand: mocks.submit }))
import { handleAdministrationAction } from './actions'
import { ADMIN_ERRORS } from './contracts'
const org = '10000000-0000-4000-8000-000000000001'
const key = '20000000-0000-4000-8000-000000000001'
const proposal = '30000000-0000-4000-8000-000000000001'
const form = () => new URLSearchParams({ intent: 'apply', organisationId: org, requestKey: key, proposalId: proposal, expectedRevision: '2' })
const client = {} as SupabaseClient
const success = { ok: true, proposalId: proposal, state: 'APPLIED', revision: '3', replayed: false, scopeState: 'HOLD', scopeRevision: '2' }
beforeEach(() => { mocks.submit.mockResolvedValue(success) })

describe('bounded parsed-form administration HTTP adapter', () => {
  it('returns explicit authoritative JSON with private headers and no cookie-jar replacement', async () => {
    const response = await handleAdministrationAction(form(), client)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(success)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(client, Object.fromEntries(form()))
  })
  it.each(ADMIN_ERRORS)('maps safe %s without reflecting provider data', async error => {
    const statuses = [400, 401, 403, 403, 403, 403, 409, 409, 409, 429, 503]
    mocks.submit.mockResolvedValue({ ok: false, error })
    const response = await handleAdministrationAction(form(), client)
    expect(response.status).toBe(statuses[ADMIN_ERRORS.indexOf(error)])
    expect(await response.json()).toEqual({ ok: false, error })
  })
  it('rejects duplicate/extra/oversized/invalid fields before any server request', async () => {
    const duplicate = form(); duplicate.append('intent', 'apply')
    const unknown = form(); unknown.set('actorPersonId', proposal)
    const oversized = form(); oversized.set('expectedRevision', 'x'.repeat(8193))
    const invalid = form(); invalid.set('expectedRevision', '2.5')
    for (const value of [duplicate, unknown, oversized, invalid]) {
      const response = await handleAdministrationAction(value, client)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_request' })
    }
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('rejects escaped duplicate JSON payload keys before any RPC', async () => {
    const value = new URLSearchParams({ intent: 'propose', organisationId: org, requestKey: key, kind: 'MEMBERSHIP_GRANT',
      payload: '{"principalId":"x","princ\\u0069palId":"y","role":"Investor"}', expectedScopeRevision: '1' })
    expect((await handleAdministrationAction(value, client)).status).toBe(400)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('maps unexpected transport failure to unavailable and never retries', async () => {
    mocks.submit.mockRejectedValue(new Error('secret raw provider detail'))
    const response = await handleAdministrationAction(form(), client)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })
})
