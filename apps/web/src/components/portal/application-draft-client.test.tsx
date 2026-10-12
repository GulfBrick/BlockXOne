// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applicationDraftAnswersSchema, type ApplicationDraftEnvelope, type ApplicationDraftRequest } from '@/lib/portal/application-drafts'
import { entryActorId, entryApplication } from '@/lib/portal/entry-test-fixtures'
import { draftEnvelopeMatches, draftSaveConfirmed, saveDraftBeforeExit, useApplicationDraft } from './application-draft-client'

const application = entryApplication({ review_route: 'AVAILABLE' })
const answers = applicationDraftAnswersSchema.parse({ full_name: '', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '', beneficial_owners: '', source_of_funds: '', experience: '', business_activities: '', representative_position: '', authority_basis: '', documents: [], ownership_control: [], ownership_change_reason: '' })
const savedAt = '2026-10-12T12:00:00Z'
const envelope = (request?: ApplicationDraftRequest): ApplicationDraftEnvelope => ({ version: 1, environment: 'TESTNET', actor_id: entryActorId,
  application: { id: application.id, persona: application.persona, status: 'DRAFT', context_kind: application.context_kind, context_organisation_id: application.context_organisation_id, origin: application.origin, admission_purpose: application.admission_purpose },
  base_application_revision: 1, draft_revision: request ? request.expected_draft_revision + 1 : 0,
  draft: request ? { answers: request.answers, step: request.step, saved_at: savedAt } : null,
  receipt: request ? { key: request.key, payload: { application_id: request.application_id, expected_application_revision: request.expected_application_revision, expected_draft_revision: request.expected_draft_revision, answers: request.answers, step: request.step }, draft_revision: request.expected_draft_revision + 1, saved_at: savedAt } : null,
})
const request = (overrides: Partial<ApplicationDraftRequest> = {}): ApplicationDraftRequest => ({ key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', application_id: application.id, expected_application_revision: 1, expected_draft_revision: 0, answers: { ...answers, full_name: 'Synthetic draft' }, step: 'identity', ...overrides })
const response = (draft: ApplicationDraftEnvelope) => new Response(JSON.stringify({ draft }), { headers: { 'Content-Type': 'application/json' } })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear() })
function mount(initialAnswers = answers, onResume = vi.fn()) {
  return renderHook(({ currentAnswers, currentApplication, actorId }) => useApplicationDraft({ application: currentApplication, actorId, environment: 'TESTNET', answers: currentAnswers, step: 'identity', enabled: true, onResume }), { initialProps: { currentAnswers: initialAnswers, currentApplication: application, actorId: entryActorId } })
}
describe('server-confirmed applicant drafts', () => {
  it('exits only after the current save confirms, and never exits on failure', async () => {
    const pending = deferred<boolean>(); const leave = vi.fn()
    const exit = saveDraftBeforeExit(() => pending.promise, leave)
    expect(leave).not.toHaveBeenCalled(); pending.resolve(false); expect(await exit).toBe(false); expect(leave).not.toHaveBeenCalled()
    expect(await saveDraftBeforeExit(async () => true, leave)).toBe(true); expect(leave).toHaveBeenCalledTimes(1)
  })
  it('loads only the exact saved application and does not claim a new blank record is saved', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope())); vi.stubGlobal('fetch', fetchMock)
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    expect(view.result.current.saved).toBe(false); expect(view.result.current.dirty).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(localStorage.length).toBe(0)
  })
  it('autosaves changed answers only after the debounce and a real confirmed response', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => !init?.method ? response(envelope()) : response(envelope(JSON.parse(init.body as string))))
    vi.stubGlobal('fetch', fetchMock)
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Automatically saved answer' }, currentApplication: application, actorId: entryActorId })
    expect(view.result.current.saved).toBe(false); expect(fetchMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(view.result.current.saved).toBe(true), { timeout: 2000 })
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(sessionStorage.length).toBe(0)
  })
  it('resumes exact unfinished answers and step without granting submission or acknowledging terms', async () => {
    const original = request({ answers: { ...answers, full_name: 'A', ownership_control: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', party_type: 'PERSON', legal_name: '', registration_reference: '', country: '', relationship: 'DIRECT_OWNER', ownership_basis_points: 0, control_basis: '', effective_on: '', change_reason: '', evidence_document_id: '' }] }, step: 'ownership' })
    const loaded = envelope(original); loaded.receipt = null
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(loaded)))
    const onResume = vi.fn(); const view = mount(answers, onResume)
    await waitFor(() => expect(view.result.current.status).toBe('READY'))
    expect(onResume).toHaveBeenCalledWith(original.answers, 'ownership')
    expect(onResume.mock.calls[0][0]).not.toHaveProperty('test_data_acknowledged')
    expect(sessionStorage.length).toBe(0)
  })
  it('keeps edits made during a save unsaved and stores references only', async () => {
    const pending = deferred<Response>(), followup = deferred<Response>(); const sent: ApplicationDraftRequest[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (!init?.method) return response(envelope()); sent.push(JSON.parse(init.body as string)); return sent.length === 1 ? pending.promise : followup.promise }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'First unfinished value' }, currentApplication: application, actorId: entryActorId })
    let saving!: Promise<boolean>
    await act(async () => { saving = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(view.result.current.status).toBe('SAVING'))
    const stored = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(stored).not.toContain('First unfinished value'); expect(stored).not.toContain('answers')
    view.rerender({ currentAnswers: { ...answers, full_name: 'New value typed during save' }, currentApplication: application, actorId: entryActorId })
    const leave = vi.fn(); let exit!: Promise<boolean>
    await act(async () => { exit = saveDraftBeforeExit(view.result.current.save, leave); pending.resolve(response(envelope(sent[0]))); await Promise.resolve() })
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(view.result.current.saved).toBe(false); expect(view.result.current.dirty).toBe(true); expect(view.result.current.revision).toBe(1); expect(leave).not.toHaveBeenCalled()
    expect(sent[1].answers.full_name).toBe('New value typed during save'); expect(sent[1].expected_draft_revision).toBe(1)
    await act(async () => { followup.resolve(response(envelope(sent[1]))); expect(await saving).toBe(true); expect(await exit).toBe(true) })
    expect(leave).toHaveBeenCalledTimes(1); expect(view.result.current.saved).toBe(true)
    expect(sessionStorage.length).toBe(0)
  })
  it('retries an unknown outcome with the original key and body even after further edits', async () => {
    const bodies: ApplicationDraftRequest[] = []; let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return response(envelope())
      const body = JSON.parse(init.body as string); bodies.push(body)
      if (++attempt === 1) throw new Error('network interrupted')
      return response(envelope(body))
    }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Original values' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(false) })
    expect(view.result.current.status).toBe('ERROR'); expect(sessionStorage.length).toBe(1)
    view.rerender({ currentAnswers: { ...answers, full_name: 'Further edits' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(true) })
    expect(bodies[1]).toEqual(bodies[0]); expect(bodies[2].answers.full_name).toBe('Further edits'); expect(bodies[2].key).not.toBe(bodies[0].key); expect(view.result.current.saved).toBe(true)
  })
  it('does not clear dirty for a different actor, application, environment or captured payload', async () => {
    const sent = request(); const original = envelope(sent)
    expect(draftSaveConfirmed(original, sent)).toBe(true)
    for (const changed of [{ ...original, actor_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { ...original, environment: 'MAINNET' as const }, { ...original, application: { ...original.application, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }]) expect(draftEnvelopeMatches(changed, application, entryActorId, 'TESTNET')).toBe(false)
    expect(draftSaveConfirmed({ ...original, draft: { ...original.draft!, answers: { ...sent.answers, full_name: 'Not the sent answer' } } }, sent)).toBe(false)
    expect(draftSaveConfirmed({ ...original, receipt: { ...original.receipt!, key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }, sent)).toBe(false)
  })
  it('holds a concurrent-write conflict without replacing or automatically retrying the answers', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => !init?.method ? response(envelope()) : new Response(JSON.stringify({ error: 'Another tab saved this draft. Reopen to resume.' }), { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Keep these values' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(false) })
    expect(view.result.current.status).toBe('CONFLICT'); expect(view.result.current.saved).toBe(false)
    await act(async () => { expect(await view.result.current.save()).toBe(false) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('never sends a replacement save after a 409, even with an earlier confirmed snapshot and reverted input', async () => {
    const conflict = deferred<Response>(); const sent: ApplicationDraftRequest[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return response(envelope())
      sent.push(JSON.parse(init.body as string))
      return sent.length === 1 ? response(envelope(sent[0])) : conflict.promise
    }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    const confirmed = { ...answers, full_name: 'Previously confirmed A' }
    view.rerender({ currentAnswers: confirmed, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(true) })
    view.rerender({ currentAnswers: { ...answers, full_name: 'Rejected B' }, currentApplication: application, actorId: entryActorId })
    let saving!: Promise<boolean>
    await act(async () => { saving = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(sent).toHaveLength(2))
    view.rerender({ currentAnswers: confirmed, currentApplication: application, actorId: entryActorId })
    await act(async () => { conflict.resolve(new Response(JSON.stringify({ error: 'Another tab changed the draft.' }), { status: 409 })); expect(await saving).toBe(false) })
    expect(view.result.current.status).toBe('CONFLICT'); expect(view.result.current.saved).toBe(false); expect(view.result.current.dirty).toBe(true)
    await act(async () => { expect(await view.result.current.save()).toBe(false) })
    expect(sent).toHaveLength(2)
  })
  it('deliberately recovers a superseded unknown receipt without a repeated keyed-load loop or silent replacement', async () => {
    let sent!: ApplicationDraftRequest
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (!init?.method) return response(envelope()); sent = JSON.parse(init.body as string); throw new Error('response lost') }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Unknown original save' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(false) }); view.unmount()
    const current = envelope(request({ expected_draft_revision: 2, answers: { ...answers, full_name: 'Other tab saved revision three' } })); current.receipt = null
    const recoveryFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method) return response(envelope(JSON.parse(init.body as string)))
      return String(url).includes('request_key=') ? new Response('{}', { status: 409 }) : response(current)
    }); vi.stubGlobal('fetch', recoveryFetch)
    const onResume = vi.fn(); const recovered = mount(answers, onResume)
    await waitFor(() => expect(recovered.result.current.status).toBe('CONFLICT'))
    expect(String(recoveryFetch.mock.calls[0][0])).toContain(`request_key=${sent.key}`)
    expect(onResume).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1)
    await act(async () => { expect(await recovered.result.current.recover(() => false)).toBe(false) })
    expect(onResume).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1); expect(recovered.result.current.dirty).toBe(true)
    await act(async () => { expect(await recovered.result.current.recover(() => true)).toBe(true) })
    expect(String(recoveryFetch.mock.calls[1][0])).not.toContain('request_key='); expect(String(recoveryFetch.mock.calls[2][0])).not.toContain('request_key=')
    expect(onResume).toHaveBeenCalledWith(current.draft!.answers, 'identity'); expect(sessionStorage.length).toBe(0); expect(recovered.result.current.revision).toBe(3)
    recovered.rerender({ currentAnswers: { ...answers, full_name: 'Explicitly chosen new answer' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await recovered.result.current.save()).toBe(true) })
    const savedRequest = JSON.parse(recoveryFetch.mock.calls.at(-1)![1]!.body as string)
    expect(savedRequest.expected_draft_revision).toBe(3); expect(savedRequest.key).not.toBe(sent.key)
  })
  it('ignores a late save response after application switching', async () => {
    const pending = deferred<Response>(); let sent!: ApplicationDraftRequest
    const next = entryApplication({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method) { sent = JSON.parse(init.body as string); return pending.promise }
      const value = envelope(); if (String(url).includes(next.id)) value.application.id = next.id
      return response(value)
    }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Old application' }, currentApplication: application, actorId: entryActorId })
    let saving!: Promise<boolean>; await act(async () => { saving = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(view.result.current.status).toBe('SAVING'))
    view.rerender({ currentAnswers: answers, currentApplication: next, actorId: entryActorId })
    await waitFor(() => expect(view.result.current.status).toBe('READY'))
    await act(async () => { pending.resolve(response(envelope(sent))); expect(await saving).toBe(false) })
    expect(view.result.current.revision).toBe(0); expect(view.result.current.saved).toBe(false)
  })
  it.each([false, true])('never installs or sends an obsolete request while its digest is pending (return to original: %s)', async returnToOriginal => {
    const pending = deferred<ArrayBuffer>(); let held!: Parameters<typeof webcrypto.subtle.digest>; let digestCalls = 0
    const digest = vi.fn((...args: Parameters<typeof webcrypto.subtle.digest>) => { if (++digestCalls === 1) { held = args; return pending.promise }; return webcrypto.subtle.digest(...args) })
    vi.stubGlobal('crypto', { subtle: { digest }, randomUUID: () => webcrypto.randomUUID() })
    const next = entryApplication({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }); const sent: ApplicationDraftRequest[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method) { const body = JSON.parse(init.body as string); sent.push(body); const value = envelope(body); value.application.id = body.application_id; return response(value) }
      const value = envelope(); if (String(url).includes(next.id)) value.application.id = next.id; return response(value)
    }))
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Old app values' }, currentApplication: application, actorId: entryActorId })
    let saving!: Promise<boolean>; await act(async () => { saving = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(digest).toHaveBeenCalledTimes(1))
    view.rerender({ currentAnswers: answers, currentApplication: next, actorId: entryActorId }); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    const selected = returnToOriginal ? application : next
    if (returnToOriginal) { view.rerender({ currentAnswers: answers, currentApplication: selected, actorId: entryActorId }); await waitFor(() => expect(view.result.current.status).toBe('READY')) }
    await act(async () => { pending.resolve(await webcrypto.subtle.digest(...held)); expect(await saving).toBe(false) })
    expect(sent).toHaveLength(0); expect(sessionStorage.length).toBe(0)
    view.rerender({ currentAnswers: { ...answers, full_name: 'Correct new app values' }, currentApplication: selected, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(true) })
    expect(sent).toHaveLength(1); expect(sent[0].application_id).toBe(selected.id); expect(sent[0].answers.full_name).toBe('Correct new app values')
  })
  it('retains newer input instead of overwriting it with a late initial draft', async () => {
    const pending = deferred<Response>(); const onResume = vi.fn(); vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const view = mount(answers, onResume)
    view.rerender({ currentAnswers: { ...answers, full_name: 'Newly typed answer' }, currentApplication: application, actorId: entryActorId })
    const loaded = envelope(request()); loaded.receipt = null
    await act(async () => { pending.resolve(response(loaded)) })
    await waitFor(() => expect(view.result.current.status).toBe('CONFLICT'))
    expect(onResume).not.toHaveBeenCalled(); expect(view.result.current.saved).toBe(false); expect(view.result.current.dirty).toBe(true)
  })
  it('ignores a completed save after preparation is disabled without changing identity', async () => {
    const pending = deferred<Response>(); let sent!: ApplicationDraftRequest
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (!init?.method) return response(envelope()); sent = JSON.parse(init.body as string); return pending.promise }))
    const view = renderHook(({ enabled }) => useApplicationDraft({ application, actorId: entryActorId, environment: 'TESTNET', answers: { ...answers, full_name: 'Prepared values' }, step: 'identity', enabled, onResume: vi.fn() }), { initialProps: { enabled: true } })
    await waitFor(() => expect(view.result.current.status).toBe('READY'))
    let saving!: Promise<boolean>; await act(async () => { saving = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(view.result.current.status).toBe('SAVING'))
    view.rerender({ enabled: false })
    await act(async () => { pending.resolve(response(envelope(sent))); expect(await saving).toBe(false) })
    expect(view.result.current.status).toBe('UNAVAILABLE'); expect(view.result.current.saved).toBe(false)
  })
  it('serializes concurrent saves into one request', async () => {
    const pending = deferred<Response>(); let sent!: ApplicationDraftRequest
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (!init?.method) return response(envelope()); sent = JSON.parse(init.body as string); return pending.promise }); vi.stubGlobal('fetch', fetchMock)
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'One shared save' }, currentApplication: application, actorId: entryActorId })
    let first!: Promise<boolean>, second!: Promise<boolean>
    await act(async () => { first = view.result.current.save(); second = view.result.current.save(); await Promise.resolve() })
    await waitFor(() => expect(view.result.current.status).toBe('SAVING'))
    await act(async () => { pending.resolve(response(envelope(sent))); expect(await first).toBe(true); expect(await second).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('recovers an interrupted save after remount using only its exact receipt reference', async () => {
    let sent!: ApplicationDraftRequest
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (!init?.method) return response(envelope()); sent = JSON.parse(init.body as string); throw new Error('response lost') }); vi.stubGlobal('fetch', fetchMock)
    const view = mount(); await waitFor(() => expect(view.result.current.status).toBe('READY'))
    view.rerender({ currentAnswers: { ...answers, full_name: 'Interrupted draft' }, currentApplication: application, actorId: entryActorId })
    await act(async () => { expect(await view.result.current.save()).toBe(false) }); view.unmount()
    expect(sessionStorage.length).toBe(1)
    const onResume = vi.fn(); const recoveryFetch = vi.fn().mockResolvedValue(response(envelope(sent))); vi.stubGlobal('fetch', recoveryFetch)
    const recovered = mount(answers, onResume); await waitFor(() => expect(recovered.result.current.status).toBe('READY'))
    expect(String(recoveryFetch.mock.calls[0][0])).toContain(`request_key=${sent.key}`)
    expect(onResume).toHaveBeenCalledWith(sent.answers, sent.step); expect(sessionStorage.length).toBe(0)
  })
})
