import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_AVAILABILITIES, ADMIN_STATES, type AdminReadProjection, type AdminResult, type AdminSelectedProposalView } from '@/lib/administration/contracts'
import { AdministrationPanel, ADMIN_STATE_LABELS, ORIGINAL_KEY_LOST, buildProposalFromForm, permittedTransitions, registerAdministrationPageLifecycle } from './administration-panel'
import { createAdministrationController, postAdministration } from './administration-controller'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const org = '11111111-1111-4111-8111-111111111111'
const person = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const principal = '44444444-4444-4444-8444-444444444444'
const otherPrincipal = '55555555-5555-4555-8555-555555555555'
const grantId = '66666666-6666-4666-8666-666666666666'
const proposalId = '77777777-7777-4777-8777-777777777777'
const requestKey = '88888888-8888-4888-8888-888888888888'
const membershipId = '99999999-9999-4999-8999-999999999999'
type ReadyView = Extract<AdminReadProjection, { availability: 'ready' | 'hold' }>
function ready(): ReadyView {
  const grant = { id: grantId, personId: person, capability: 'ADMINISTRATION_V1' as const, status: 'ACTIVE' as const, validFrom: '2026-09-19T00:00:00Z', validUntil: '2026-10-19T00:00:00Z', revision: '1' }
  return {
    availability: 'ready', scopeRevision: '1', policyVersion: 1, caller: { principalId: principal, personId: person, grant },
    scope: { organisationId: org, state: 'READY', revision: '1', policyVersion: 1, trustRevision: '1' },
    people: [{ id: person, label: 'Synthetic Governor A', principalsTruncated: false, principals: [{ id: principal, memberships: [{ id: membershipId, principalId: principal, personId: person, role: 'SuperAdmin', status: 'ACTIVE' }] }] }, { id: other, label: 'Synthetic Governor B', principalsTruncated: false, principals: [{ id: otherPrincipal, memberships: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', principalId: otherPrincipal, personId: other, role: 'Investor', status: 'ACTIVE' }] }] }],
    entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [grant], grantsTruncated: false,
  }
}
function proposal(): AdminSelectedProposalView {
  return { id: proposalId, kind: 'ENTITY_DRAFT_CREATE', payload: { displayName: 'Synthetic Fund', kind: 'FUND', jurisdictionCode: null, registrationReference: null }, state: 'PENDING_REVIEW', revision: '1', requesterPersonId: other, beneficiaryPersonId: null, reviewerPersonId: null, payloadHash: 'a'.repeat(64), expiresAt: '2026-09-20T00:00:00Z', expectedScopeRevision: '1', expectedTrustRevision: '1', policyVersion: 1, allowedTransitions: ['approve', 'reject'], events: [], historyTruncated: false }
}
function gate(availability: Exclude<AdminReadProjection['availability'], 'ready' | 'hold'>): AdminReadProjection {
  return { availability, scopeRevision: null, policyVersion: 1, caller: null, scope: null, people: [], entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
}
const intent = () => ({ intent: 'propose' as const, organisationId: org, requestKey, kind: 'ENTITY_DRAFT_CREATE' as const, payload: JSON.stringify({ displayName: 'Synthetic Fund', kind: 'FUND', jurisdictionCode: null, registrationReference: null }), expectedScopeRevision: '1' })
const success = (): AdminResult => ({ ok: true, proposalId, state: 'PENDING_REVIEW', revision: '1', replayed: false, scopeState: 'READY', scopeRevision: '1' })
function controllerFixture(post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>().mockResolvedValue(success())) {
  const refresh = vi.fn(), changed = vi.fn()
  const controller = createAdministrationController(ready(), { post, refresh, onChange: changed })
  return { controller, post, refresh, changed }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('contained administration presentation', () => {
  it('renders scoped sections and deliberate controls without a provider client or eager mutation', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const html = renderToStaticMarkup(<AdministrationPanel view={ready()} organisations={[{ id: org, name: 'Synthetic organisation' }]} />)
    for (const text of ['People', 'Legal parties', 'Access proposals', 'Propose access change', 'Draft: unverified', ORIGINAL_KEY_LOST, 'Synthetic Governor A']) expect(html).toContain(text)
    for (const text of ['Invite', 'Reset factor', 'Approve issuer', 'FinancialController balance', 'localStorage']) expect(html).not.toContain(text)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(ADMIN_AVAILABILITIES.filter(value => value !== 'ready' && value !== 'hold'))('renders %s without a directory or composer', availability => {
    const html = renderToStaticMarkup(<AdministrationPanel view={gate(availability as Exclude<AdminReadProjection['availability'], 'ready' | 'hold'>)} organisations={[]} />)
    expect(html).not.toContain('Synthetic Governor')
    expect(html).not.toContain('Propose access change')
    expect(html).toContain('role="status"')
    if (availability === 'mfa_required' || availability === 'step_up_required') expect(html).toContain('href="/workspace/security"')
  })
  it.each(ADMIN_STATES)('renders truthful %s detail and immutable evidence', state => {
    const view = ready(), detail = { ...proposal(), state, allowedTransitions: [] }
    view.selectedProposal = detail
    const html = renderToStaticMarkup(<AdministrationPanel view={view} organisations={[{ id: org, name: 'Scoped organisation' }]} selectedProposalId={proposalId} />)
    expect(html).toContain(ADMIN_STATE_LABELS[state])
    expect(html).toContain('Immutable payload SHA-256')
    expect(html).toContain('Audit history')
    expect(html).toContain('No audit events in this permitted view. This is not proof of no effect.')
    expect(html).not.toContain('name="payload"')
  })
  it('renders HOLD evidence without any write controls even if malicious hints advertise them', () => {
    const view = ready(); view.availability = 'hold'; view.scope.state = 'HOLD'; view.selectedProposal = proposal()
    const html = renderToStaticMarkup(<AdministrationPanel view={view} organisations={[]} />)
    expect(html).toContain('Administration is on HOLD')
    for (const text of ['Approve proposal</button>', 'Apply approved change</button>', 'Propose access change</button>']) expect(html).not.toContain(text)
  })
  it('discloses each bounded list and history without implying complete absence', () => {
    const view = ready(); view.truncated = { people: true, entities: true, proposals: true }; view.selectedProposal = { ...proposal(), historyTruncated: true }
    view.people[0].principalsTruncated = true
    const html = renderToStaticMarkup(<AdministrationPanel view={view} organisations={[]} />)
    expect(html.match(/Showing up to 50 records/g)).toHaveLength(3)
    expect(html).toContain('Showing up to 100 audit events')
    expect(html).toContain('Showing up to 10 principals')
  })
  it('does not display or invent a foreign missing proposal', () => {
    const html = renderToStaticMarkup(<AdministrationPanel view={ready()} organisations={[]} selectedProposalId={proposalId} />)
    expect(html).toContain('The selected proposal is not available in this permitted view. This is not proof of no effect.')
    expect(html).not.toContain('Synthetic Fund')
  })
  it('uses semantic lists, live feedback, 44px controls and wrapping', () => {
    const view = ready(); view.selectedProposal = proposal()
    const html = renderToStaticMarkup(<AdministrationPanel view={view} organisations={[{ id: org, name: 'Organisation' }]} />)
    for (const marker of ['aria-live="polite"', 'min-h-11', '<dl', '<ol', 'overflow-wrap:anywhere', 'tabindex="-1"']) expect(html).toContain(marker)
    expect(html).not.toContain('animate-')
  })
})

describe('scoped forms and independent actions', () => {
  const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data }
  it.each([
    { changeKind: 'ENTITY_DRAFT_CREATE', displayName: 'Synthetic Fund', entityKind: 'FUND', jurisdictionCode: '', registrationReference: '' },
    { changeKind: 'MEMBERSHIP_GRANT', principalId: otherPrincipal, role: 'Investor' },
    { changeKind: 'MEMBERSHIP_REVOKE', membershipId, reason: 'security' },
    { changeKind: 'GOVERNANCE_GRANT', personId: other, validUntil: '2026-10-01T00:00:00Z' },
    { changeKind: 'GOVERNANCE_REVOKE', grantId, reason: 'routine' },
    { changeKind: 'PERSON_SCOPE_REVOKE', personId: person, reason: 'security' },
  ])('constructs the exact %s typed payload from scoped fields', values => {
    const result = buildProposalFromForm(form(values as Record<string, string>), ready())
    expect(result?.kind).toBe(values.changeKind)
    expect(result?.payload).not.toHaveProperty('changeKind')
  })
  it('does not invent legal facts', () => {
    expect(buildProposalFromForm(form({ changeKind: 'ENTITY_DRAFT_CREATE', displayName: 'Fund', entityKind: 'FUND' }), ready())?.payload).toEqual({ displayName: 'Fund', kind: 'FUND', jurisdictionCode: null, registrationReference: null })
  })
  it.each([
    { changeKind: 'MEMBERSHIP_GRANT', principalId: principal, role: 'SuperAdmin' },
    { changeKind: 'GOVERNANCE_GRANT', personId: person, validUntil: '2026-10-01T00:00:00Z' },
    { changeKind: 'MEMBERSHIP_REVOKE', membershipId: proposalId, reason: 'security' },
    { changeKind: 'GOVERNANCE_REVOKE', grantId: proposalId, reason: 'security' },
    { changeKind: 'PERSON_SCOPE_REVOKE', personId: proposalId, reason: 'security' },
    { changeKind: 'ENTITY_DRAFT_CREATE', displayName: 'Fund', entityKind: 'FUND', jurisdictionCode: 'za' },
  ])('rejects self elevation, unknown recipients or invalid legal facts %j', values => expect(buildProposalFromForm(form(values as Record<string, string>), ready())).toBeNull())
  it('permits self-requested reduction, but never self-review or beneficiary application', () => {
    const view = ready(), command = { ...proposal(), requesterPersonId: person, beneficiaryPersonId: person, allowedTransitions: ['approve', 'reject', 'cancel'] as const }
    expect(permittedTransitions({ ...command, allowedTransitions: [...command.allowedTransitions] }, view)).toEqual(['cancel'])
    expect(permittedTransitions({ ...command, state: 'APPROVED', reviewerPersonId: other, allowedTransitions: ['apply', 'cancel'] }, view)).toEqual(['cancel'])
    view.caller.personId = other
    expect(permittedTransitions({ ...command, allowedTransitions: [...command.allowedTransitions] }, view)).toEqual(['approve', 'reject'])
    expect(permittedTransitions({ ...command, state: 'APPROVED', reviewerPersonId: other, allowedTransitions: ['apply', 'cancel'] }, view)).toEqual(['apply'])
  })
  it('never exposes unrelated-governor apply or nonrequester cancel', () => {
    const view = ready()
    expect(permittedTransitions({ ...proposal(), state: 'APPROVED', reviewerPersonId: grantId, allowedTransitions: ['apply', 'cancel'] }, view)).toEqual([])
  })
})

describe('volatile command controller', () => {
  it('an old ignored-cancellation deadline cannot abort a newer scoped request', async () => {
    vi.useFakeTimers()
    let resolveNew!: (value: unknown) => void
    const post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve }))
    const { controller, refresh } = controllerFixture(post)
    const old = controller.submit(intent())
    await vi.advanceTimersByTimeAsync(5_000)
    controller.invalidate()
    const current = ready(); current.scope.organisationId = other
    controller.update(current)
    const next = controller.submit({ ...intent(), organisationId: other, requestKey: proposalId })
    const oldSignal = post.mock.calls[0][1], newSignal = post.mock.calls[1][1]
    expect(oldSignal.aborted).toBe(true)
    expect(newSignal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    await old
    expect(newSignal.aborted).toBe(false)
    expect(controller.getState().phase).toBe('pending')
    expect(refresh).not.toHaveBeenCalled()
    resolveNew(success()); await next
    expect(controller.getState().phase).toBe('confirmed')
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('notifies the mounted panel when a gated initial view becomes ready in place', () => {
    const onChange = vi.fn(), post = vi.fn(), refresh = vi.fn()
    const controller = createAdministrationController(gate('unconfigured'), { post, refresh, onChange })
    expect(controller.matches(ready())).toBe(false)
    controller.update(ready())
    expect(controller.matches(ready())).toBe(true)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ phase: 'idle' }))
    expect(post).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
  })
  it('is inert until deliberate submission and refreshes only after an authoritative result', async () => {
    const { controller, post, refresh } = controllerFixture()
    expect(post).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled()
    await controller.submit(intent())
    expect(post).toHaveBeenCalledOnce(); expect(post.mock.calls[0][0].get('requestKey')).toBe(requestKey)
    expect(controller.getState().phase).toBe('confirmed'); expect(refresh).toHaveBeenCalledOnce()
  })
  it('retains the exact original key and historical revision through uncertain in-place refresh', async () => {
    const post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>().mockRejectedValueOnce(Error('private transport detail')).mockResolvedValueOnce({ ...success(), replayed: true })
    const { controller, refresh } = controllerFixture(post)
    await controller.submit(intent())
    expect(controller.getState()).toMatchObject({ phase: 'unknown', retryReady: false })
    await controller.submit({ ...intent(), requestKey: proposalId }); expect(post).toHaveBeenCalledOnce()
    await controller.retryOriginal(); expect(post).toHaveBeenCalledOnce()
    controller.checkRecordedStatus(); expect(refresh).toHaveBeenCalledOnce()
    const current = ready(); current.scopeRevision = '19'; current.scope.revision = '19'
    controller.update(current)
    expect(controller.getState().retryReady).toBe(true)
    expect(post).toHaveBeenCalledOnce()
    await controller.retryOriginal()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1][0].toString()).toBe(post.mock.calls[0][0].toString())
    expect(controller.getState().result).toMatchObject({ replayed: true })
  })
  it('an empty/truncated refresh never becomes no-effect or confirmation', async () => {
    const { controller, post } = controllerFixture(vi.fn().mockRejectedValue(Error('failed')))
    await controller.submit(intent()); controller.checkRecordedStatus()
    const current = ready(); current.truncated.proposals = true; controller.update(current)
    expect(controller.getState()).toMatchObject({ phase: 'unknown', result: null })
    expect(post).toHaveBeenCalledOnce()
  })
  it('a full reload cannot recover the key and never retries or creates a replacement automatically', async () => {
    const old = controllerFixture(vi.fn().mockRejectedValue(Error('failed')))
    await old.controller.submit(intent()); old.controller.dispose()
    const next = controllerFixture(); await next.controller.retryOriginal(); next.controller.checkRecordedStatus()
    expect(next.post).not.toHaveBeenCalled(); expect(next.refresh).not.toHaveBeenCalled()
    expect(renderToStaticMarkup(<AdministrationPanel view={ready()} organisations={[]} />)).toContain(ORIGINAL_KEY_LOST)
  })
  it.each(['scope', 'principal', 'person', 'forbidden', 'pagehide'] as const)('invalidates late responses and clears private intent on %s loss', async change => {
    let resolve!: (value: unknown) => void
    const post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>(() => new Promise(resolvePromise => { resolve = resolvePromise }))
    const { controller, refresh } = controllerFixture(post)
    const pending = controller.submit(intent())
    const current = ready()
    if (change === 'scope') current.scope.organisationId = proposalId
    if (change === 'principal') current.caller.principalId = otherPrincipal
    if (change === 'person') current.caller.personId = other
    if (change === 'pagehide') controller.invalidate()
    else controller.update(change === 'forbidden' ? gate('forbidden') : current)
    expect(post.mock.calls[0][1].aborted).toBe(true)
    resolve(success()); await pending
    expect(refresh).not.toHaveBeenCalled(); expect(controller.getState().result).toBeNull()
  })
  it('blocks duplicate in-flight submissions', async () => {
    let resolve!: (value: unknown) => void
    const post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>(() => new Promise(done => { resolve = done })), { controller } = controllerFixture(post)
    const pending = controller.submit(intent()); await controller.submit(intent())
    expect(post).toHaveBeenCalledOnce(); resolve(success()); await pending
  })
  it.each([null, { token: 'private' }, { ok: false, error: 'unavailable' }])('keeps malformed/uncertain %j responses unknown without leaking details', async response => {
    const { controller, changed } = controllerFixture(vi.fn().mockResolvedValue(response))
    await controller.submit(intent())
    expect(controller.getState()).toMatchObject({ phase: 'unknown', result: null })
    expect(JSON.stringify(changed.mock.calls)).not.toContain('private')
  })
  it('does not accept a successful receipt for a different proposal', async () => {
    const { controller } = controllerFixture(vi.fn().mockResolvedValue(success()))
    await controller.submit({ intent: 'review', organisationId: org, requestKey, proposalId: other, expectedRevision: '1', decision: 'approve' })
    expect(controller.getState().phase).toBe('unknown')
  })
  it.each(['APPROVED', 'APPLIED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'INVALIDATED'] as const)('does not accept a %s receipt for a new proposal request', async state => {
    const { controller } = controllerFixture(vi.fn().mockResolvedValue({ ...success(), state }))
    await controller.submit(intent())
    expect(controller.getState().phase).toBe('unknown')
  })
  it('does not accept an impossible HOLD receipt for proposal submission', async () => {
    const { controller } = controllerFixture(vi.fn().mockResolvedValue({ ...success(), scopeState: 'HOLD' }))
    await controller.submit(intent())
    expect(controller.getState().phase).toBe('unknown')
  })
  it('preserves a confirmed APPLIED plus HOLD result and prevents more writes', async () => {
    const { controller, post } = controllerFixture(vi.fn().mockResolvedValue({ ...success(), state: 'APPLIED', scopeState: 'HOLD', scopeRevision: '2' }))
    await controller.submit({ intent: 'apply', organisationId: org, requestKey, proposalId, expectedRevision: '2' })
    const current = ready(); current.availability = 'hold'; current.scope.state = 'HOLD'; controller.update(current)
    expect(controller.getState().result).toMatchObject({ state: 'APPLIED', scopeState: 'HOLD' })
    await controller.submit(intent()); expect(post).toHaveBeenCalledOnce()
  })
  it('a deadline abort remains unknown, not a rollback claim', async () => {
    vi.useFakeTimers()
    const { controller } = controllerFixture(vi.fn(() => new Promise(() => undefined)))
    const pending = controller.submit(intent()); await vi.advanceTimersByTimeAsync(15_000); await pending
    expect(controller.getState().phase).toBe('unknown')
  })
})

describe('installed administration page lifecycle', () => {
  it('clears private screen state synchronously on pagehide before returning and invalidates pending results', async () => {
    const target = new EventTarget()
    let resolve!: (value: unknown) => void
    const post = vi.fn<Parameters<typeof createAdministrationController>[1]['post']>(() => new Promise(done => { resolve = done }))
    const { controller, refresh } = controllerFixture(post)
    let privateScreen = 'Scoped person and unsaved proposal'
    const calls: string[] = []
    const remove = registerAdministrationPageLifecycle(target, () => { controller.invalidate(); privateScreen = ''; calls.push('clear') }, () => { expect(privateScreen).toBe(''); calls.push('restore'); refresh() })
    const pending = controller.submit(intent())
    target.dispatchEvent(new Event('pagehide'))
    expect(privateScreen).toBe('')
    expect(controller.matches(ready())).toBe(false)
    expect(post.mock.calls[0][1].aborted).toBe(true)
    resolve(success()); await pending
    expect(refresh).not.toHaveBeenCalled()
    const cached = new Event('pageshow'); Object.defineProperty(cached, 'persisted', { value: true })
    target.dispatchEvent(cached)
    expect(calls).toEqual(['clear', 'clear', 'restore'])
    expect(refresh).toHaveBeenCalledOnce()
    remove()
    target.dispatchEvent(new Event('pagehide')); target.dispatchEvent(cached)
    expect(calls).toEqual(['clear', 'clear', 'restore'])
  })
  it('ignores ordinary pageshow and clears a restored page before requesting fresh access', () => {
    const target = new EventTarget(), calls: string[] = []
    const remove = registerAdministrationPageLifecycle(target, () => calls.push('clear'), () => calls.push('revalidate'))
    target.dispatchEvent(new Event('pageshow'))
    expect(calls).toEqual([])
    const cached = new Event('pageshow'); Object.defineProperty(cached, 'persisted', { value: true })
    target.dispatchEvent(cached)
    expect(calls).toEqual(['clear', 'revalidate'])
    remove()
  })
})

describe('bounded same-origin command transport', () => {
  it('rejects successful JSON on a failed HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(success()), { status: 503, headers: { 'content-type': 'application/json' } })))
    await expect(postAdministration(new URLSearchParams(), new AbortController().signal)).rejects.toThrow('Unavailable')
  })
  it('posts only to the fixed guarded route without redirects or browser storage', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(success()), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch)
    expect(await postAdministration(new URLSearchParams(), new AbortController().signal)).toEqual(success())
    expect(fetch).toHaveBeenCalledWith('/auth/admin-command', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error' }))
  })
  it.each(['oversize', 'utf8', 'html', 'json'] as const)('fails closed for %s without returning raw content', async kind => {
    const payload = kind === 'oversize' ? 'x'.repeat(131073) : kind === 'utf8' ? new Uint8Array([0xc3, 0x28]) : '<private>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(payload, { headers: { 'content-type': kind === 'html' ? 'text/html' : 'application/json' } })))
    await expect(postAdministration(new URLSearchParams(), new AbortController().signal)).rejects.toThrow()
  })
})
