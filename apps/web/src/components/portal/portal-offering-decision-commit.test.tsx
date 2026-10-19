// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import type { OfferingDecisionCommit } from '@/lib/portal/offering-decision-commit'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, PortalCommandProvider, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker, usePortalCommand } from './portal-client'

// Transport/interaction fixtures only: no real approval, provider result,
// publication, deployment, money, or hosted business-flow acceptance.
const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333', product = '44444444-4444-4444-8444-444444444444'
const offering = '55555555-5555-4555-8555-555555555555', policy = '66666666-6666-4666-8666-666666666666'
const session = '77777777-7777-4777-8777-777777777777', key = '88888888-8888-4888-8888-888888888888'
const nextKey = '99999999-9999-4999-8999-999999999999', hash = 'a'.repeat(64)
type RoleContext = Extract<PortalOperatingContext, { mode: 'ROLE' }>
const cases = [
  { command: 'review_offering_issuer', role: 'IssuerFundManager', kind: 'ISSUER', checks: { issuer_authority: true, terms: true, rights: true } },
  { command: 'review_product', role: 'ComplianceOfficer', kind: 'COMPLIANCE', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } },
] as const
function instruction(item: typeof cases[number]): PortalCommand {
  return portalCommandSchema.parse({ command: item.command, key, payload: { product_id: product, offering_revision_id: offering,
    expected_revision: 3, terms_hash: hash, common_envelope_hash: hash, deployment_configuration_hash: hash,
    decision: 'APPROVED', notes: 'Fictional reviewed offering package rationale.', checks: item.checks } })
}
function acknowledgement(request: PortalCommand): OfferingDecisionCommit {
  if (request.command !== 'review_offering_issuer' && request.command !== 'review_product') throw new Error('A decision fixture is required.')
  const issuer = request.command === 'review_offering_issuer'
  return { kind: 'TEST_FUND_OFFERING_DECISION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY',
    independence_proven: false, actor_id: actor, session_id: session,
    operating_context: { mode: 'ROLE', organisationId: organisation, role: issuer ? 'IssuerFundManager' : 'ComplianceOfficer' },
    policy_id: policy, authority_epoch: 2, product_id: product, offering_revision_id: offering, decision_id: other,
    decision_kind: issuer ? 'ISSUER' : 'COMPLIANCE', request, recorded_at: '2026-10-15T22:00:00Z' }
}
function snapshot(context: RoleContext, selectedActor = actor, requests: PortalSnapshot['requests'] = []): PortalSnapshot {
  return { actor: { id: selectedActor, email: 'fixture@example.invalid', display_name: 'Synthetic participant', can_review: true },
    operating_context: context, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function sentRequest(init?: RequestInit): PortalCommand {
  const { operating_context: _context, ...request } = JSON.parse(String(init?.body))
  return portalCommandSchema.parse(request)
}
function Harness({ item, onSaved, replacement = false }: { item: typeof cases[number]; onSaved: (value: PortalSnapshot) => void; replacement?: boolean }) {
  const command = usePortalCommand(onSaved), request = instruction(item)
  return <section aria-label={replacement ? 'Replacement' : 'Original'}>
    <button type="button" onClick={() => void command.submit(item.command, { ...request.payload, product_id: replacement ? other : product })}>
      {replacement ? 'Record another decision' : 'Record offering decision'}</button>
    {!replacement ? <><output data-testid="busy">{String(command.busy)}</output><output data-testid="committed">{String(command.committed)}</output><CommandFeedback command={command} /></> : <p role="note">{command.message}</p>}
  </section>
}
function Page({ item, value, environment = 'TESTNET', onSaved }: { item: typeof cases[number]; value: PortalSnapshot; environment?: PlatformEnvironment; onSaved: (value: PortalSnapshot) => void }) {
  return <PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment={environment}>
    <Harness item={item} onSaved={onSaved} /><Harness item={item} onSaved={onSaved} replacement />
  </PortalCommandProvider>
}
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe.each(cases)('$kind decision commit transport and recovery', item => {
  const context: RoleContext = { mode: 'ROLE', organisationId: organisation, role: item.role }
  const request = instruction(item)
  it('distinguishes a saved decision with failed readback from an unknown result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), refresh_required: true }, 202)))
    await expect(postPortalCommand(request, context, actor)).rejects.toMatchObject({ committed: true, definitive: false,
      message: expect.stringContaining('Your offering decision was saved.') })
  })
  it.each(['actor', 'context', 'environment', 'key', 'payload', 'offering', 'kind', 'role', 'command', 'extra'] as const)(
    'never claims a saved decision for foreign or malformed %s evidence', async failure => {
      const ack: Record<string, unknown> = { ...acknowledgement(request) }
      if (failure === 'actor') ack.actor_id = other
      if (failure === 'context') ack.operating_context = { ...context, organisationId: other }
      if (failure === 'environment') ack.environment = 'MAINNET'
      if (failure === 'key') ack.request = { ...request, key: other }
      if (failure === 'payload') ack.request = { ...request, payload: { ...request.payload, expected_revision: 2 } }
      if (failure === 'offering') ack.offering_revision_id = other
      if (failure === 'kind') ack.decision_kind = item.kind === 'ISSUER' ? 'COMPLIANCE' : 'ISSUER'
      if (failure === 'role') ack.operating_context = { ...context, role: item.role === 'IssuerFundManager' ? 'ComplianceOfficer' : 'IssuerFundManager' }
      if (failure === 'command') ack.request = { command: 'submit_product', key, payload: { product_id: product, expected_revision: 3 } }
      if (failure === 'extra') ack.status = 'APPROVED'
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: ack, refresh_required: true }, 202)))
      await expect(postPortalCommand(request, context, actor)).rejects.not.toHaveProperty('committed')
    })
  it.each([201, 400, 403, 503])('does not accept HTTP%s as a known commit', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), refresh_required: true }, status)))
    await expect(postPortalCommand(request, context, actor)).rejects.not.toHaveProperty('committed')
  })
  it('rejects TEST receipts in MAIN and error-plus-ACK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), refresh_required: true }, 202)))
    await expect(postPortalCommand(request, context, actor, undefined, undefined, undefined, 'MAINNET')).rejects.not.toHaveProperty('committed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), error: 'Denied.' })))
    await expect(postPortalCommand(request, context, actor)).rejects.not.toHaveProperty('committed')
  })
  it.each(['missing receipt', 'other key', 'other command', 'actor', 'context', 'shape'] as const)(
    'requires refreshed saved state with the exact request, not %s', async failure => {
      const value = snapshot(context, actor, [{ key, command: request.command }])
      if (failure === 'missing receipt') value.requests = []
      if (failure === 'other key') value.requests = [{ key: other, command: request.command }]
      if (failure === 'other command') value.requests = [{ key, command: 'submit_product' }]
      if (failure === 'actor') value.actor.id = other
      if (failure === 'context') value.operating_context = { ...context, organisationId: other }
      if (failure === 'shape') Reflect.deleteProperty(value, 'products')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), snapshot: value })))
      await expect(postPortalCommand(request, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
    })
  it('returns only the separately refreshed real snapshot with its exact request receipt', async () => {
    const value = snapshot(context, actor, [{ key, command: request.command }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(request), snapshot: value })))
    expect(await postPortalCommand(request, context, actor)).toEqual(value)
  })
  it('retains the private original marker, blocks replacement and retries the same saved request', async () => {
    const onSaved = vi.fn(), received: PortalCommand[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = sentRequest(init); received.push(sent)
      return received.length === 1 ? json({ committed: acknowledgement(sent), refresh_required: true }, 202)
        : json({ committed: acknowledgement(sent), snapshot: snapshot(context, actor, [{ key: sent.key, command: sent.command }]) })
    })
    vi.stubGlobal('fetch', fetch)
    render(<Page item={item} value={snapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record offering decision' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(screen.queryByText(/result is uncertain/i)).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(Object.keys(JSON.parse(originalMarker)).sort()).toEqual(['command', 'key', 'payloadHash'])
    expect(originalMarker).not.toContain(product); expect(originalMarker).not.toContain(session); expect(originalMarker).not.toContain('rationale')
    fireEvent.click(screen.getByRole('button', { name: 'Record another decision' }))
    await screen.findByText(/Re-enter the original values/)
    expect(fetch).toHaveBeenCalledOnce(); expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(received[1]).toEqual(received[0]); expect(sessionStorage.length).toBe(0)
  })
  it('preserves the known commit through unrelated refresh state and a later authority denial', async () => {
    const onSaved = vi.fn(); let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = sentRequest(init); attempt += 1
      if (attempt === 1) return json({ committed: acknowledgement(sent), refresh_required: true }, 202)
      return attempt === 2 ? json({ snapshot: snapshot(context) }) : json({ error: 'Current authority unavailable.' }, 403)
    }))
    render(<Page item={item} value={snapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record offering decision' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    const marker = sessionStorage.getItem(sessionStorage.key(0)!)
    for (const count of [2, 3]) {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
      await waitFor(() => expect(attempt).toBe(count))
      await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'))
    }
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(screen.getByText(/Your offering decision was saved, but/)).toBeTruthy()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(marker)
  })
  const lateCases = (['actor', 'environment', 'context'] as const).flatMap(change =>
    (['acknowledgement', 'snapshot', 'read failure'] as const).map(result => ({ change, result })))
  it.each(lateCases)('ignores late $result after $change changes without clearing either scoped marker', async ({ change, result }) => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let sent: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      sent = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page item={item} value={snapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record offering decision' }))
    await waitFor(() => expect(sent).toBeDefined())
    const oldKey = sessionStorage.key(0)!, original = sessionStorage.getItem(oldKey)
    const nextActor = change === 'actor' ? other : actor
    const nextContext = change === 'context' ? { ...context, organisationId: other } : context
    const nextEnvironment = change === 'environment' ? 'MAINNET' : 'TESTNET'
    const nextScope = { operatingContext: nextContext, environment: nextEnvironment } as const
    await prepareDurablePortalCommand(sessionStorage, nextActor, { ...request, key: nextKey }, [], nextScope)
    page.rerender(<Page item={item} value={snapshot(nextContext, nextActor)} environment={nextEnvironment} onSaved={onSaved} />)
    await act(async () => finish!(result === 'acknowledgement' ? json({ committed: acknowledgement(sent!), refresh_required: true }, 202)
      : result === 'snapshot' ? json({ committed: acknowledgement(sent!), snapshot: snapshot(context, actor, [{ key: sent!.key, command: sent!.command }]) })
        : json({ error: 'Saved state unavailable.' }, 503)))
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
    expect(sessionStorage.getItem(oldKey)).toBe(original); expect(sessionStorage.length).toBe(2)
    expect(reconcilePortalMarker(sessionStorage, nextActor, [], nextScope)?.key).toBe(nextKey)
  })
  it('does not adopt an old ACK after switching away and back to the same actor and context', async () => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let sent: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      sent = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page item={item} value={snapshot(context)} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record offering decision' }))
    await waitFor(() => expect(sent).toBeDefined())
    const marker = sessionStorage.getItem(sessionStorage.key(0)!)
    page.rerender(<Page item={item} value={snapshot(context, other)} onSaved={onSaved} />)
    page.rerender(<Page item={item} value={snapshot(context)} onSaved={onSaved} />)
    await act(async () => finish!(json({ committed: acknowledgement(sent!), refresh_required: true }, 202)))
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(marker)
  })
})
