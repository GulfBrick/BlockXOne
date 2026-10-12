import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ read: vi.fn(), guard: vi.fn(), create: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/portal/entry-server', () => ({ readEntry: mocks.read, requireEntryEnvironment: mocks.guard }))
vi.mock('@/lib/supabase/server', async original => ({ ...await original<object>(), createRequestSupabaseClient: mocks.create }))
import { GET, POST } from './route'
import { PortalError } from '@/lib/portal/server'
import { entryActorId, entryApplication, entryApplicationId, entryFixture, entryHandoff } from '@/lib/portal/entry-test-fixtures'
import { applicationDraftAnswersSchema } from '@/lib/portal/application-drafts'

const origin = 'https://testnet.bx1.co.za'
const other = '88888888-8888-4888-8888-888888888888'
const application = entryApplication({ review_route: 'AVAILABLE' })
const snapshot = entryFixture([{ ...application, handoff: entryHandoff(application) }])
const answers = applicationDraftAnswersSchema.parse({ full_name: ' A ', country: '', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', beneficial_owners: '', source_of_funds: '', experience: '', business_activities: '', representative_position: '', authority_basis: '', documents: [], ownership_control: [], ownership_change_reason: '' })
const instruction = { key: '44444444-4444-4444-8444-444444444444', application_id: entryApplicationId, expected_application_revision: 1, expected_draft_revision: 0, answers, step: 'identity' }
const { key, ...payload } = instruction
const savedAt = '2026-10-12T12:00:00Z'
const empty = { version: 1, environment: 'TESTNET', actor_id: entryActorId, application: { id: application.id, persona: application.persona, status: application.status, context_kind: application.context_kind, context_organisation_id: application.context_organisation_id, origin: application.origin, admission_purpose: application.admission_purpose }, base_application_revision: 1, draft_revision: 0, draft: null, receipt: null }
const saved = { ...empty, draft_revision: 1, draft: { answers, step: instruction.step, saved_at: savedAt }, receipt: { key, payload, draft_revision: 1, saved_at: savedAt } }
const unsafeHeaders: Record<string, string>[] = [{ origin: 'null' }, { origin: 'https://evil.invalid' }, { 'x-bx1-expected-actor': '' }, { 'x-bx1-expected-actor': other }]
function read(query = `application_id=${entryApplicationId}&expected_application_revision=1`, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/portal/application-drafts?${query}`, { headers: { 'x-bx1-expected-actor': entryActorId, ...headers } })
}
function write(body: unknown = instruction, headers: Record<string, string> = {}, suffix = '') {
  return new NextRequest(`${origin}/api/portal/application-drafts${suffix}`, { method: 'POST', headers: { origin, host: 'testnet.bx1.co.za', 'content-type': 'application/json', 'x-bx1-expected-actor': entryActorId, ...headers }, body: JSON.stringify(body) })
}
function result(data: unknown, error: unknown = null) {
  mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data, error }) })
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('BLOCKXONE_APP_ORIGIN', origin); vi.stubEnv('NODE_ENV', 'production')
  mocks.read.mockResolvedValue(snapshot); mocks.create.mockReturnValue({ rpc: mocks.rpc }); result(empty)
})
afterEach(() => vi.unstubAllEnvs())

describe('guarded private draft read/save boundary', () => {
  it('loads only the selected application/revision with private no-store response', async () => {
    const response = await GET(read())
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store')
    expect((await response.json()).draft).toEqual(empty)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_application_draft_read', { application_id: application.id, expected_application_revision: 1, request_key: null })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it('recovers only the requested exact receipt and allows missing receipts without inventing confirmation', async () => {
    result(saved)
    const query = `application_id=${application.id}&expected_application_revision=1&request_key=${key}`
    expect((await GET(read(query))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_application_draft_read', { application_id: application.id, expected_application_revision: 1, request_key: key })
    result({ ...saved, receipt: null })
    const response = await GET(read(query))
    expect(response.status).toBe(200); expect((await response.json()).draft.receipt).toBeNull()
  })
  it('does not accept a receipt on an unkeyed read or for another requested key', async () => {
    result(saved)
    expect((await GET(read())).status).toBe(503)
    expect((await GET(read(`application_id=${application.id}&expected_application_revision=1&request_key=${other}`))).status).toBe(503)
  })
  it('dispatches exact captured unfinished answers without the final submit command', async () => {
    result(saved)
    const response = await POST(write())
    expect(response.status).toBe(200); expect((await response.json()).draft).toEqual(saved)
    expect(mocks.rpc).toHaveBeenCalledWith('bx1_application_draft_save', { request_key: key, payload })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })
  it.each(unsafeHeaders)('rejects unsafe origin or changed caller %# before saving', async headers => {
    expect((await POST(write(instruction, headers))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects extra/query identity claims, duplicate read parameters, missing actor, content type and oversized body', async () => {
    for (const body of [{ ...instruction, actor_id: entryActorId }, { ...instruction, answers: { ...answers, test_data_acknowledged: true } }]) expect((await POST(write(body))).status).toBe(400)
    expect((await POST(write(instruction, {}, '?application_id=' + application.id))).status).toBe(403)
    expect((await POST(write(instruction, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(write(instruction, { 'content-length': '262145' }))).status).toBe(413)
    for (const query of [`application_id=${application.id}&expected_application_revision=1&user_id=${entryActorId}`, `application_id=${application.id}&application_id=${other}&expected_application_revision=1`, `application_id=${application.id}&expected_application_revision=0`]) expect((await GET(read(query))).status).toBe(400)
    expect((await GET(read(undefined, { 'x-bx1-expected-actor': '' }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['SUBMITTED', 'APPROVED'] as const)('cannot save closed %s applications', async status => {
    const changed = entryApplication({ status, review_route: 'AVAILABLE' })
    mocks.read.mockResolvedValue(entryFixture([{ ...changed, handoff: entryHandoff(changed) }]))
    expect((await POST(write())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('keeps MAIN, unadmitted, foreign application and stale canonical revision closed', async () => {
    mocks.read.mockResolvedValue(entryFixture([{ ...application, handoff: entryHandoff(application, { environment: 'MAINNET', allowed_actions: [], gates: { intake_admitted: false, reviewer_available: false, monitoring_allows_new_actions: false } }) }], 'MAINNET'))
    expect((await POST(write())).status).toBe(403)
    mocks.read.mockResolvedValue(entryFixture())
    expect((await POST(write())).status).toBe(403)
    mocks.read.mockResolvedValue(snapshot)
    expect((await POST(write({ ...instruction, application_id: other }))).status).toBe(403)
    expect((await POST(write({ ...instruction, expected_application_revision: 2 }))).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['40001', '23505', '23514', '22023', 'P0001'])('maps definite draft rejection %s to conflict without raw diagnostics', async code => {
    result(null, { code, message: 'PRIVATE_OPERATOR_DETAIL' })
    const response = await POST(write())
    expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_OPERATOR_DETAIL')
  })
  it('does not confirm another actor/context/environment, wrong receipt or altered content', async () => {
    for (const value of [
      { ...saved, actor_id: other }, { ...saved, environment: 'MAINNET' }, { ...saved, application: { ...saved.application, origin: 'LEGACY' } },
      { ...saved, receipt: null }, { ...saved, receipt: { ...saved.receipt, key: other } },
      { ...saved, draft: { ...saved.draft, answers: { ...answers, full_name: 'Different' } } },
      { ...saved, receipt: { ...saved.receipt, payload: { ...payload, step: 'purpose' } } },
    ]) { result(value); expect((await POST(write())).status).toBe(503) }
  })
  it('retains uncertain-outcome guidance when post-write session, revision or mode changes', async () => {
    result(saved)
    mocks.read.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new PortalError('MFA changed', 403))
    let response = await POST(write())
    expect(response.status).toBe(503); expect((await response.json()).error).toContain('original request reference')
    const changed = { ...application, revision: 2 }
    mocks.read.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(entryFixture([{ ...changed, handoff: entryHandoff(changed) }]))
    response = await POST(write()); expect(response.status).toBe(503)
    const access = { version: 1, environment: 'TESTNET', actor_id: entryActorId, operating_context: { mode: 'APPLICANT' }, session_mode: 'TEST_PASSWORD', allowed_commands: ['submit_application'] }
    mocks.read.mockResolvedValueOnce({ ...snapshot, stage2_access: access }).mockResolvedValueOnce(snapshot)
    response = await POST(write()); expect(response.status).toBe(503)
  })
  it('rechecks access after reads and never reflects an unverified draft', async () => {
    mocks.read.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...snapshot, actor: { id: other, email: 'other@example.invalid' } })
    expect((await GET(read())).status).toBe(403)
    mocks.read.mockResolvedValue(snapshot); result({ ...empty, base_application_revision: 2 })
    expect((await GET(read())).status).toBe(503)
  })
})
