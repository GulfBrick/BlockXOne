// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandFeedback, PortalCommandProvider, mayDiscardDeniedPortalRequest, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker, usePortalCommand } from './portal-client'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { admissionOrAccountCommitSchema } from '@/lib/portal/admission-commit'
const actor = '11111111-1111-4111-8111-111111111111'
const key = '22222222-2222-4222-8222-222222222222'
const organisationId = '33333333-3333-4333-8333-333333333333'
const command = { command: 'cancel_subscription' as const, key, payload: { subscription_id: key } }
function storage() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: vi.fn((key: string) => { values.delete(key) }) } }
const applicant = { operatingContext: { mode: 'APPLICANT' } as PortalOperatingContext, environment: 'TESTNET' as const }
const investor = { operatingContext: { mode: 'ROLE', organisationId, role: 'Investor' } as PortalOperatingContext, environment: 'TESTNET' as const }
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('context-bound request recovery', () => {
  it('does not discard an uncertain prior attempt after a later permission or validation denial', () => {
    expect(mayDiscardDeniedPortalRequest(true, true)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(false, true)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(false, false)).toBe(false)
    expect(mayDiscardDeniedPortalRequest(true, false)).toBe(true)
  })
  it('isolates saved keys by environment and selected role, without erasing another context', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [], applicant)
    await prepareDurablePortalCommand(saved, actor, { ...command, key: actor }, [], investor)
    await prepareDurablePortalCommand(saved, actor, command, [], { ...investor, environment: 'MAINNET' })
    expect(saved.values.size).toBe(3)
    expect(reconcilePortalMarker(saved, actor, [{ key, command: command.command }], investor)).not.toBeNull()
    expect(saved.values.size).toBe(3)
    expect(reconcilePortalMarker(saved, actor, [{ key, command: command.command }], applicant)).toBeNull()
    expect(saved.values.size).toBe(2)
  })
  it('binds identical payload digests to the original context', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [], applicant)
    await prepareDurablePortalCommand(saved, actor, command, [], investor)
    expect(new Set([...saved.values.values()].map(value => JSON.parse(value).payloadHash)).size).toBe(2)
  })
  it('retains a previous-version marker rather than silently issuing a replacement', async () => {
    const saved = storage()
    await prepareDurablePortalCommand(saved, actor, command, [])
    await expect(prepareDurablePortalCommand(saved, actor, command, [], applicant)).rejects.toThrow('previous platform version')
    expect(saved.values.size).toBe(1)
  })
})

// Transport fixtures only, not evidence that a hosted review, account or holding exists.
const applicationId = '44444444-4444-4444-8444-444444444444', other = '55555555-5555-4555-8555-555555555555'
const newKey = '66666666-6666-4666-8666-666666666666'
const modes = ['review', 'applicant account', 'investor account'] as const
function admissionFixture(mode: typeof modes[number]) {
  const context: PortalOperatingContext = mode === 'applicant account' ? { mode: 'APPLICANT' }
    : { mode: 'ROLE', organisationId, role: mode === 'review' ? 'ComplianceOfficer' : 'Investor' }
  const request = portalCommandSchema.parse(mode === 'review'
    ? { command: 'review_application', key, payload: { application_id: applicationId, expected_revision: 2, decision: 'APPROVED',
      notes: 'Fictional manual TEST investor evidence reviewed.', checks: { identity: true, ownership: true, screening: true, suitability: true } } }
    : { command: 'create_investment_account', key, payload: { application_id: applicationId } })
  function acknowledgement(saved = request) {
    const common = { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
      actor_id: actor, session_id: other, operating_context: context, policy_id: other, authority_epoch: 2,
      product_id: other, offering_revision_id: other, application_id: applicationId, event_id: other,
      request: saved, recorded_at: '2026-10-16T13:30:00Z' }
    return mode === 'review' ? { ...common, kind: 'TEST_FUND_ADMISSION_COMMIT', decision_id: other,
      submitted_revision: 2, decision_revision: 3, decision: 'APPROVED' }
      : { ...common, kind: 'TEST_FUND_ACCOUNT_COMMIT', account_id: other, application_revision: 3, admission_decision_id: other }
  }
  return { context, request, acknowledgement }
}
function savedSnapshot(context: PortalOperatingContext, selectedActor = actor, requests: PortalSnapshot['requests'] = []): PortalSnapshot {
  return { actor: { id: selectedActor, email: 'fixture@example.invalid', display_name: 'TEST participant', can_review: true },
    operating_context: context, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests }
}
function confirmedAdmissionSnapshot(mode: typeof modes[number], request: PortalCommand): PortalSnapshot {
  const { context, acknowledgement } = admissionFixture(mode), ack = admissionOrAccountCommitSchema.parse(acknowledgement(request))
  const reviewedAt = mode === 'review' ? ack.recorded_at : '2026-10-16T13:00:00Z'
  return { ...savedSnapshot(context, actor, [{ key: request.key, command: request.command }]),
    applications: [{ id: applicationId, user_id: actor, persona: 'INVESTOR', status: 'APPROVED', revision: 3,
      details: { full_name: 'Fictional investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Fictional TEST funds only.', beneficial_owners: '', experience: 'Synthetic experience.', documents: [], test_data_acknowledged: true },
      submitted_at: '2026-10-16T12:00:00Z', reviewed_at: reviewedAt, reviewer_id: actor,
      review_notes: request.command === 'review_application' ? request.payload.notes : 'Fictional prior manual review rationale.',
      organisation_id: null, review_checks: { identity: true, ownership: true, screening: true, suitability: true },
      provider_mode: 'MANUAL_TEST_REVIEW', approved_until: '2099-01-01T00:00:00Z', admission_purpose: 'INVESTOR_ADMISSION',
      test_roleplay_admission: { version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
        policy_id: other, authority_epoch: 2, product_id: other, offering_revision_id: other, application_id: applicationId,
        submitted_revision: 2, decision_revision: 3, decision: 'APPROVED', reviewer_id: actor, reviewed_at: reviewedAt, valid_until: '2099-01-01T00:00:00Z' } }],
    accounts: mode === 'review' ? [] : [{ id: other, holder_user_id: actor, application_id: applicationId,
      kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: '2026-10-16T13:30:01Z' }],
    events: [{ id: other, subject_id: mode === 'review' ? applicationId : other, kind: request.command, actor_id: actor,
      created_at: mode === 'review' ? '2026-10-16T13:29:59Z' : ack.recorded_at, summary: 'Synthetic original event.' }] }
}
const responseJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function decodeSent(init?: RequestInit): PortalCommand {
  const { operating_context: _context, ...request } = JSON.parse(String(init?.body))
  return portalCommandSchema.parse(request)
}
function AdmissionHarness({ request, onSaved }: { request: PortalCommand; onSaved: (value: PortalSnapshot) => void }) {
  const command = usePortalCommand(onSaved)
  return <><button type="button" onClick={() => void command.submit(request.command, request.payload)}>Save original action</button>
    <output data-testid="busy">{String(command.busy)}</output><output data-testid="committed">{String(command.committed)}</output>
    <CommandFeedback command={command} /></>
}
function CompetingAdmissionAction({ request, onSaved }: { request: PortalCommand; onSaved: (value: PortalSnapshot) => void }) {
  const command = usePortalCommand(onSaved)
  return <><button type="button" onClick={() => void command.submit(request.command, { ...request.payload, application_id: other })}>Save replacement action</button>
    <p>{command.message}</p></>
}
function AdmissionPage({ request, value, environment = 'TESTNET', onSaved, competing = false }: {
  request: PortalCommand; value: PortalSnapshot; environment?: PlatformEnvironment; onSaved: (value: PortalSnapshot) => void; competing?: boolean;
}) {
  return <PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment={environment}>
    <AdmissionHarness request={request} onSaved={onSaved} />
    {competing ? <CompetingAdmissionAction request={request} onSaved={onSaved} /> : null}
  </PortalCommandProvider>
}

describe.each(modes)('%s original commit recovery', mode => {
  const { context, request, acknowledgement } = admissionFixture(mode)
  it('distinguishes a saved canonical result from unknown without inventing a snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(request, context, actor)).rejects.toMatchObject({ committed: true, definitive: false,
      message: expect.stringContaining(mode === 'review' ? 'Your application decision was saved.' : 'Your investment account was saved.') })
  })
  it.each(['actor', 'context', 'key', 'application', 'event', 'payload', 'extra', 'MAIN'] as const)(
    'does not claim commit from mismatched %s evidence', async failure => {
      const ack: Record<string, unknown> = { ...acknowledgement() }
      if (failure === 'actor') ack.actor_id = other
      if (failure === 'context') ack.operating_context = { mode: 'ROLE', organisationId: other, role: 'Investor' }
      if (failure === 'key') ack.request = { ...request, key: other }
      if (failure === 'application') ack.application_id = other
      if (failure === 'event') ack.event_id = null
      if (failure === 'payload') ack.request = { ...request, payload: { ...request.payload, application_id: other } }
      if (failure === 'extra') ack.status = 'ACTIVE'
      if (failure === 'MAIN') ack.environment = 'MAINNET'
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: ack, refresh_required: true }, 202)))
      await expect(postPortalCommand(request, context, actor)).rejects.not.toHaveProperty('committed')
    })
  it('rejects a TEST acknowledgement on MAIN, an error-plus-ACK, or an invalid HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(request, context, actor, undefined, undefined, undefined, 'MAINNET')).rejects.not.toHaveProperty('committed')
    for (const [body, status] of [[{ committed: acknowledgement(), error: 'Denied.' }, 200], [{ committed: acknowledgement() }, 503]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson(body, status)))
      await expect(postPortalCommand(request, context, actor)).rejects.not.toHaveProperty('committed')
    }
  })
  it.each(['receipt', 'actor', 'context', 'complete shape'] as const)('requires the separate full readback, including %s', async failure => {
    const value = confirmedAdmissionSnapshot(mode, request)
    if (failure === 'receipt') value.requests = []
    if (failure === 'actor') value.actor.id = other
    if (failure === 'context') value.operating_context = { mode: 'ROLE', organisationId: other, role: 'Investor' }
    if (failure === 'complete shape') Reflect.deleteProperty(value, 'products')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: acknowledgement(), snapshot: value })))
    await expect(postPortalCommand(request, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
  })
  it('returns only the complete refreshed snapshot containing the original request receipt', async () => {
    const value = confirmedAdmissionSnapshot(mode, request)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: acknowledgement(), snapshot: value })))
    expect(await postPortalCommand(request, context, actor)).toEqual(value)
  })
  it.each((['missing application', 'duplicate application', 'foreign application', 'later revision', 'wrong policy', 'wrong decision',
    'missing event', 'duplicate event', 'foreign event', 'missing account', 'duplicate account', 'foreign account'] as const)
    .filter(failure => mode !== 'review' || !['missing account', 'duplicate account', 'foreign account'].includes(failure)))(
    'retains a known commit when the %s result cannot be confirmed', async failure => {
      const value = confirmedAdmissionSnapshot(mode, request)
      if (failure === 'missing application') value.applications = []
      if (failure === 'duplicate application') value.applications.push({ ...value.applications[0] })
      if (failure === 'foreign application') value.applications[0].user_id = other
      if (failure === 'later revision') value.applications[0].revision = 4
      if (failure === 'wrong policy') value.applications[0].test_roleplay_admission!.policy_id = actor
      if (failure === 'wrong decision') value.applications[0].status = 'REJECTED'
      if (failure === 'missing event') value.events = []
      if (failure === 'duplicate event') value.events.push({ ...value.events[0] })
      if (failure === 'foreign event') value.events[0].actor_id = other
      if (failure === 'missing account') value.accounts = []
      if (failure === 'duplicate account') value.accounts!.push({ ...value.accounts![0] })
      if (failure === 'foreign account') value.accounts![0].holder_user_id = other
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ committed: acknowledgement(), snapshot: value })))
      await expect(postPortalCommand(request, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
    })
  it('recovers the same key after reload only when original values are re-entered; private payload is never persisted', async () => {
    const scope = { operatingContext: context, environment: 'TESTNET' as const }
    await prepareDurablePortalCommand(sessionStorage, actor, request, [], scope)
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(Object.keys(JSON.parse(originalMarker)).sort()).toEqual(['command', 'key', 'payloadHash'])
    expect(originalMarker).not.toContain(applicationId); expect(originalMarker).not.toContain('evidence reviewed')
    const reentered = await prepareDurablePortalCommand(sessionStorage, actor, { ...request, key: newKey }, [], scope)
    expect(reentered).toEqual(request)
    await expect(prepareDurablePortalCommand(sessionStorage, actor, { ...request, key: newKey,
      payload: { ...request.payload, application_id: other } } as PortalCommand, [], scope)).rejects.toThrow('Re-enter the original values')
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
  })
  it('retains uncertainty and then the known commit until the same original request has a confirmed readback', async () => {
    const onSaved = vi.fn(), sent: PortalCommand[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const original = decodeSent(init); sent.push(original)
      return sent.length === 1 ? responseJson({ error: 'Request outcome uncertain.' }, 503)
        : sent.length === 2 ? responseJson({ committed: acknowledgement(original), refresh_required: true }, 202)
          : responseJson({ committed: acknowledgement(original), snapshot: confirmedAdmissionSnapshot(mode, original) })
    }))
    render(<AdmissionPage request={request} value={savedSnapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save original action' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry the original saved request' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    expect(onSaved).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(sent[1]).toEqual(sent[0]); expect(sent[2]).toEqual(sent[0]); expect(sessionStorage.length).toBe(0)
  })
  it('keeps a known new-family marker across two hooks and parent receipt-only refresh until exact same-key result confirmation', async () => {
    const onSaved = vi.fn(), sent: PortalCommand[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const original = decodeSent(init); sent.push(original)
      return sent.length === 1 ? responseJson({ committed: acknowledgement(original), refresh_required: true }, 202)
        : responseJson({ committed: acknowledgement(original), snapshot: confirmedAdmissionSnapshot(mode, original) })
    }))
    const page = render(<AdmissionPage request={request} value={savedSnapshot(context)} onSaved={onSaved} competing />)
    fireEvent.click(screen.getByRole('button', { name: 'Save original action' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    const markerKey = sessionStorage.key(0)!, marker = sessionStorage.getItem(markerKey)
    page.rerender(<AdmissionPage request={request} value={savedSnapshot(context, actor,
      [{ key: sent[0].key, command: sent[0].command }])} onSaved={onSaved} competing />)
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(sessionStorage.getItem(markerKey)).toBe(marker); expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save replacement action' }))
    await screen.findByText(/Re-enter the original values/)
    expect(sent).toHaveLength(1); expect(sessionStorage.getItem(markerKey)).toBe(marker)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(sent[1]).toEqual(sent[0]); expect(sessionStorage.length).toBe(0)
  })
  it.each(['actor', 'context', 'environment', 'ABA'] as const)('ignores a late ACK after %s change and retains the original scoped marker', async change => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let sent: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      sent = decodeSent(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<AdmissionPage request={request} value={savedSnapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save original action' }))
    await waitFor(() => expect(sent).toBeDefined())
    const markerKey = sessionStorage.key(0)!, originalMarker = sessionStorage.getItem(markerKey)
    const nextContext: PortalOperatingContext = change === 'context' ? { mode: 'ROLE', organisationId: other, role: 'Investor' } : context
    page.rerender(<AdmissionPage request={request} value={savedSnapshot(nextContext, change === 'actor' || change === 'ABA' ? other : actor)}
      environment={change === 'environment' ? 'MAINNET' : 'TESTNET'} onSaved={onSaved} />)
    if (change === 'ABA') page.rerender(<AdmissionPage request={request} value={savedSnapshot(context)} onSaved={onSaved} />)
    await act(async () => finish!(responseJson({ committed: acknowledgement(sent!), refresh_required: true }, 202)))
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(sessionStorage.getItem(markerKey)).toBe(originalMarker)
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
  })
})
