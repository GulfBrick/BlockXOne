import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatedRecovery, RECOVERY_STATES, type RecoveryCaseView, type RecoveryIntent, type RecoveryReadProjection, type RecoveryResult } from '@/lib/recovery/contracts'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
import { createRecoveryController, permittedRecoveryActions, postRecovery, RECOVERY_MEMORY_NOTICE, RECOVERY_STATE_LABELS, RECOVERY_UNKNOWN, RecoveryCaseHistoryLink, RecoveryPanel, registerRecoveryPageLifecycle } from './recovery-panel'

const principal = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', target = '33333333-3333-4333-8333-333333333333'
const caseId = '44444444-4444-4444-8444-444444444444', requestKey = '55555555-5555-4555-8555-555555555555', other = '66666666-6666-4666-8666-666666666666'
function ready(): RecoveryReadProjection { return { ...gatedRecovery('unavailable'), availability: 'ready', caller: { principalId: principal, personId: person }, canRequest: true } }
function item(): RecoveryCaseView { return { caseId, targetPersonId: target, requesterPrincipalId: other, state: 'PENDING_REVIEW', revision: '2', reason: 'LOST_AUTHENTICATOR', createdAt: '2026-09-20T00:00:00Z', expiresAt: '2026-09-21T00:00:00Z', proposedByPersonId: other, reviewedByPersonId: null, evidenceReference: 'SYNTHETIC-REF', isOwn: false, requiresStepUp: false, allowedActions: ['approve', 'reject'] } }
const ownIntent = (): RecoveryIntent => ({ intent: 'request', requestKey, reason: 'LOST_AUTHENTICATOR' })
const success = (): RecoveryResult => ({ ok: true, caseId, state: 'REQUESTED', revision: '1', replayed: false })
function fixture(view = ready(), postImplementation: Parameters<typeof createRecoveryController>[1]['post'] = async () => success()) {
  const post = vi.fn(postImplementation), refresh = vi.fn(), changed = vi.fn()
  return { controller: createRecoveryController(view, { post, refresh, onChange: changed }), post, refresh, changed }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('recovery containment presentation', () => {
  it('renders own request with no eager HTTP or provider work', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<RecoveryPanel projection={ready()} />)
    expect(html).toContain('Report a lost authenticator'); expect(html).toContain(RECOVERY_MEMORY_NOTICE)
    expect(html).toContain('A workspace role does not grant recovery authority.')
    for (const forbidden of ['Remove factor</button>', 'Reset authenticator</button>', 'Release containment</button>', 'Recovery seed', 'localStorage']) expect(html).not.toContain(forbidden)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('shows held status without mutation controls even with malicious action hints', () => {
    const projection = ready(); projection.held = true; projection.canRequest = true
    projection.selectedCase = { ...item(), events: [], historyTruncated: false }
    const html = renderToStaticMarkup(<RecoveryPanel projection={projection} />)
    expect(html).toContain('Your business access is held')
    expect(html).not.toContain('Report a lost authenticator</button>'); expect(html).not.toContain('Approve containment</button>')
  })
  it.each(['unavailable', 'unauthorised'] as const)('renders %s without private records or actions', availability => {
    const view = gatedRecovery(availability); view.cases = [item()]
    const html = renderToStaticMarkup(<RecoveryPanel projection={view} />)
    expect(html).toContain('Recovery status is temporarily unavailable')
    expect(html).not.toContain(caseId); expect(html).not.toContain('Report a lost authenticator')
  })
  it.each(RECOVERY_STATES)('labels %s without claiming complete recovery', state => {
    const view = ready(); view.canRequest = false; view.selectedCase = { ...item(), state, allowedActions: [], events: [], historyTruncated: false }
    const html = renderToStaticMarkup(<RecoveryPanel projection={view} />)
    expect(html).toContain(RECOVERY_STATE_LABELS[state]); expect(html).toContain('Audit history')
    expect(html).not.toContain('Account recovered')
  })
  it('renders opaque references as text, bounds and chronological evidence without private body spreads', () => {
    const view = ready(); view.canRequest = false; view.cases = [item()]; view.casesTruncated = true
    view.selectedCase = { ...item(), evidenceReference: 'https://example.invalid/reference', events: [{ sequence: '12', eventType: 'PROPOSED', at: '2026-09-20T00:01:00Z', actorPersonId: other, beforeState: 'REQUESTED', afterState: 'PENDING_REVIEW', beforeRevision: '1', afterRevision: '2' }], historyTruncated: true }
    const html = renderToStaticMarkup(<RecoveryPanel projection={view} />)
    expect(html).toContain('Showing up to 50 cases'); expect(html).toContain('Showing up to 100 audit events')
    expect(html).toContain('PROPOSED'); expect(html).toContain('event 12')
    expect(html).not.toContain('href="https://example.invalid/reference"')
    for (const marker of ['aria-live="polite"', 'min-h-11', '<dl', '<ol', 'tabindex="-1"', 'overflow-wrap:anywhere']) expect(html).toContain(marker)
  })
  it('keeps approved and apply steps separate and gives a current-TOTP step-up route', () => {
    const view = ready(); view.selectedCase = { ...item(), state: 'APPROVED', reviewedByPersonId: person, revision: '3', allowedActions: ['apply'], events: [], historyTruncated: false }
    const html = renderToStaticMarkup(<RecoveryPanel projection={view} />)
    expect(html).toContain('Apply approved containment'); expect(html).not.toContain('Approve containment</button>')
    view.selectedCase.requiresStepUp = true; view.selectedCase.allowedActions = []
    expect(renderToStaticMarkup(<RecoveryPanel projection={view} />)).toContain('href="/workspace/security"')
  })
  it('offers explicit read-only history navigation after uncertainty with a key-loss warning', () => {
    const html = renderToStaticMarkup(<RecoveryCaseHistoryLink caseId={caseId} unknown />)
    expect(html).toContain(`href="/workspace/recovery?case=${caseId}"`)
    expect(html).toContain('discards the original key; reconcile its audit before another action')
    expect(html).not.toContain('<form'); expect(html).not.toContain('/auth/recovery-command')
  })
})

describe('defensive person and state action gates', () => {
  it('admits independent review, not same-person aliases or the target', () => {
    expect(permittedRecoveryActions(item(), ready())).toEqual(['approve', 'reject'])
    expect(permittedRecoveryActions({ ...item(), proposedByPersonId: person }, ready())).toEqual([])
    expect(permittedRecoveryActions({ ...item(), targetPersonId: person }, ready())).toEqual([])
    expect(permittedRecoveryActions({ ...item(), isOwn: true }, ready())).toEqual([])
  })
  it('permits only original independent participants to apply an approved case', () => {
    const approved = { ...item(), state: 'APPROVED' as const, reviewedByPersonId: person, allowedActions: ['apply'] as const }
    expect(permittedRecoveryActions({ ...approved, allowedActions: [...approved.allowedActions] }, ready())).toEqual(['apply'])
    expect(permittedRecoveryActions({ ...approved, allowedActions: ['apply'], reviewedByPersonId: target }, ready())).toEqual([])
    expect(permittedRecoveryActions({ ...approved, allowedActions: ['apply'], reviewedByPersonId: other }, ready())).toEqual([])
    expect(permittedRecoveryActions({ ...approved, allowedActions: ['apply'], requiresStepUp: true }, ready())).toEqual([])
  })
  it('never enables actions in an incompatible terminal state or held view', () => {
    for (const state of ['QUARANTINED', 'EXPIRED', 'REJECTED', 'INVALIDATED'] as const) expect(permittedRecoveryActions({ ...item(), state }, ready())).toEqual([])
    expect(permittedRecoveryActions(item(), { ...ready(), held: true })).toEqual([])
  })
})

describe('in-memory recovery command lifecycle', () => {
  it('sends one exact form, binds the receipt and refreshes only after confirmation', async () => {
    const f = fixture(); await f.controller.submit(ownIntent())
    expect(f.post).toHaveBeenCalledOnce(); expect(f.post.mock.calls[0][0].toString()).toBe(new URLSearchParams(ownIntent()).toString())
    expect(f.controller.getState()).toMatchObject({ phase: 'confirmed', refreshing: true, result: success() })
    expect(f.refresh).toHaveBeenCalledOnce()
    await f.controller.submit({ ...ownIntent(), requestKey: other }); expect(f.post).toHaveBeenCalledOnce()
    f.controller.update({ ...ready(), canRequest: false }); expect(f.controller.getState().refreshing).toBe(false)
    await f.controller.submit(ownIntent()); expect(f.post).toHaveBeenCalledOnce()
  })
  it('keeps an unknown request blocked across an in-place refresh and never auto-retries', async () => {
    const f = fixture(ready(), vi.fn().mockRejectedValue(Error('private detail')))
    await f.controller.submit(ownIntent()); expect(f.controller.getState().phase).toBe('unknown')
    f.controller.checkRecordedStatus(); expect(f.refresh).toHaveBeenCalledOnce()
    f.controller.update(ready()); expect(f.controller.getState()).toMatchObject({ phase: 'unknown', refreshing: false })
    await f.controller.submit({ ...ownIntent(), requestKey: other }); expect(f.post).toHaveBeenCalledOnce()
    expect(JSON.stringify(f.controller.getState())).not.toContain('private detail')
  })
  it('retains the unknown intent across unavailable status and same-caller recovery', async () => {
    const f = fixture(ready(), vi.fn().mockRejectedValue(Error('Unavailable')))
    await f.controller.submit(ownIntent())
    f.controller.checkRecordedStatus()
    f.controller.update(gatedRecovery('unavailable'))
    expect(f.controller.getState()).toMatchObject({ phase: 'unknown', refreshing: false })
    expect(f.controller.matches(gatedRecovery('unavailable'))).toBe(false)
    await f.controller.submit({ ...ownIntent(), requestKey: other })
    f.controller.update(ready())
    expect(f.controller.matches(ready())).toBe(true)
    expect(f.controller.getState().phase).toBe('unknown')
    await f.controller.submit({ ...ownIntent(), requestKey: other })
    expect(f.post).toHaveBeenCalledOnce()
    expect(f.post.mock.calls[0][0].get('requestKey')).toBe(requestKey)
  })
  it('bounds a never-settling transport at 15 seconds and aborts it', async () => {
    vi.useFakeTimers()
    const f = fixture(ready(), vi.fn(() => new Promise<unknown>(() => undefined)))
    const pending = f.controller.submit(ownIntent())
    await vi.advanceTimersByTimeAsync(15_000); await pending
    expect(f.controller.getState().phase).toBe('unknown'); expect(f.post.mock.calls[0][1].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('prevents duplicate submission while pending', async () => {
    let resolve!: (value: unknown) => void
    const f = fixture(ready(), vi.fn(() => new Promise(value => { resolve = value })))
    const pending = f.controller.submit(ownIntent()); await f.controller.submit(ownIntent())
    expect(f.post).toHaveBeenCalledOnce(); resolve(success()); await pending
  })
  it.each([
    { label: 'wrong state', value: { ...success(), state: 'QUARANTINED' } },
    { label: 'wrong revision', value: { ...success(), revision: '9' } },
    { label: 'unavailable', value: { ok: false, error: 'unavailable' } },
    { label: 'extra fields', value: { ...success(), providerToken: 'private' } },
  ])('does not claim success for $label', async ({ value }) => {
    const f = fixture(ready(), vi.fn().mockResolvedValue(value)); await f.controller.submit(ownIntent())
    expect(f.controller.getState().phase).toBe('unknown'); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('binds operator successes to the exact case, state and next revision', async () => {
    const view = ready(); view.cases = [item()]
    const intent: RecoveryIntent = { intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'approve' }
    const post = vi.fn().mockResolvedValue({ ok: true, caseId: other, state: 'APPROVED', revision: '3', replayed: false })
    const f = fixture(view, post); await f.controller.submit(intent)
    expect(f.controller.getState().phase).toBe('unknown')
  })
  it('rejects invalid, self-authorised or stale intent before fetch', async () => {
    const view = ready(); view.cases = [{ ...item(), proposedByPersonId: person }]
    const f = fixture(view)
    await f.controller.submit({ intent: 'review', requestKey, caseId, expectedRevision: '2', decision: 'approve' })
    await f.controller.submit({ ...ownIntent(), requestKey: 'invalid' }); expect(f.post).not.toHaveBeenCalled()
  })
  it('erases an in-flight command on caller change and ignores late responses', async () => {
    let resolve!: (value: unknown) => void
    const f = fixture(ready(), vi.fn(() => new Promise(value => { resolve = value })))
    const pending = f.controller.submit(ownIntent())
    f.controller.update({ ...ready(), caller: { principalId: other, personId: target } })
    resolve(success()); await pending
    expect(f.post.mock.calls[0][1].aborted).toBe(true); expect(f.controller.getState().result).toBeNull(); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('publishes the gated-to-ready binding and disposes without leaving a timer', async () => {
    vi.useFakeTimers()
    const f = fixture(gatedRecovery('unavailable'))
    f.controller.update(ready()); expect(f.controller.matches(ready())).toBe(true); expect(f.changed).toHaveBeenCalled()
    f.controller.dispose(); await f.controller.submit(ownIntent()); expect(f.post).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('private transport and page lifecycle', () => {
  it('posts only to the fixed same-origin endpoint with cookies and no cache', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(success()), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal, body = new URLSearchParams(ownIntent())
    expect(await postRecovery(body, signal)).toEqual(success())
    expect(fetch).toHaveBeenCalledWith('/auth/recovery-command', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, body }))
  })
  it.each([
    { label: 'HTML redirect response', response: () => new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }) },
    { label: 'oversized response', response: () => new Response(' '.repeat(16_385), { headers: { 'content-type': 'application/json' } }) },
    { label: 'invalid UTF8', response: () => new Response(new Uint8Array([0xc0, 0xaf]), { headers: { 'content-type': 'application/json' } }) },
    { label: 'HTTP error with success body', response: () => new Response(JSON.stringify(success()), { status: 403, headers: { 'content-type': 'application/json' } }) },
    { label: 'malformed JSON', response: () => new Response('{', { headers: { 'content-type': 'application/json' } }) },
  ])('rejects $label', async ({ response }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    await expect(postRecovery(new URLSearchParams(ownIntent()), new AbortController().signal)).rejects.toThrow()
  })
  it('clears on pagehide and clears again before BFcache refresh without invoking any command', () => {
    const target = new EventTarget(), calls: string[] = []
    const unregister = registerRecoveryPageLifecycle(target, () => calls.push('clear'), () => calls.push('refresh'))
    target.dispatchEvent(new Event('pagehide'))
    const event = new Event('pageshow'); Object.defineProperty(event, 'persisted', { value: true }); target.dispatchEvent(event)
    expect(calls).toEqual(['clear', 'clear', 'refresh'])
    unregister(); target.dispatchEvent(new Event('pagehide')); expect(calls).toHaveLength(3)
    expect(RECOVERY_UNKNOWN).toContain('Do not create a replacement request')
  })
})
