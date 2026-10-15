// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import type { FundPublicationCommit } from '@/lib/portal/fund-publication-commit'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, PortalCommandProvider, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker, usePortalCommand } from './portal-client'

// Transport/interaction fixtures only: not an actual publication, provider
// approval, deployment, or hosted business-flow acceptance.
const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333', product = '44444444-4444-4444-8444-444444444444'
const offering = '55555555-5555-4555-8555-555555555555', policy = '66666666-6666-4666-8666-666666666666'
const session = '77777777-7777-4777-8777-777777777777', key = '88888888-8888-4888-8888-888888888888'
const nextKey = '99999999-9999-4999-8999-999999999999'
const context: Extract<PortalOperatingContext, { mode: 'ROLE' }> = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
const instruction: PortalCommand = { command: 'publish_product', key, payload: { product_id: product, expected_revision: 3 } }
function acknowledgement(request: PortalCommand = instruction): FundPublicationCommit {
  if (request.command !== 'publish_product') throw new Error('The publication fixture requires a publish_product request.')
  return { kind: 'TEST_FUND_PUBLICATION_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
    actor_id: actor, session_id: session, operating_context: { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' },
    policy_id: policy, authority_epoch: 2, product_id: product, offering_revision_id: offering, product_revision: 4,
    request, recorded_at: '2026-10-15T15:15:00Z' }
}
function snapshot(selectedActor = actor, selectedContext = context, requests: PortalSnapshot['requests'] = []): PortalSnapshot {
  return { actor: { id: selectedActor, email: 'fixture@example.invalid', display_name: 'Synthetic participant', can_review: false },
    operating_context: selectedContext, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function sentRequest(init?: RequestInit): PortalCommand {
  const { operating_context: _context, ...request } = JSON.parse(String(init?.body))
  return portalCommandSchema.parse(request)
}
function Harness({ onSaved, replacement = false }: { onSaved: (value: PortalSnapshot) => void; replacement?: boolean }) {
  const command = usePortalCommand(onSaved)
  return <section aria-label={replacement ? 'Replacement' : 'Original'}>
    <button type="button" onClick={() => void command.submit('publish_product', {
      product_id: replacement ? other : product, expected_revision: 3,
    })}>{replacement ? 'Publish another product' : 'Publish fund'}</button>
    {!replacement ? <><output data-testid="busy">{String(command.busy)}</output><output data-testid="committed">{String(command.committed)}</output><CommandFeedback command={command} /></> : <p role="note">{command.message}</p>}
  </section>
}
function Page({ value = snapshot(), environment = 'TESTNET', onSaved }: { value?: PortalSnapshot; environment?: PlatformEnvironment; onSaved: (value: PortalSnapshot) => void }) {
  return <PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment={environment}>
    <Harness onSaved={onSaved} /><Harness onSaved={onSaved} replacement />
  </PortalCommandProvider>
}
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('strict publication commit transport', () => {
  it('distinguishes a saved publication request with failed readback from an unknown result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(instruction, context, actor)).rejects.toMatchObject({ committed: true, definitive: false,
      message: expect.stringContaining('Your publication request was saved.') })
  })
  it.each(['actor', 'context', 'environment', 'key', 'payload', 'revision', 'kind', 'command', 'extra'] as const)(
    'does not claim a commit for a foreign or malformed %s receipt', async failure => {
      const ack: Record<string, unknown> = { ...acknowledgement() }
      if (failure === 'actor') ack.actor_id = other
      if (failure === 'context') ack.operating_context = { ...context, organisationId: other }
      if (failure === 'environment') ack.environment = 'MAINNET'
      if (failure === 'key') ack.request = { ...instruction, key: other }
      if (failure === 'payload') ack.request = { ...instruction, payload: { product_id: product, expected_revision: 2 } }
      if (failure === 'revision') ack.product_revision = 3
      if (failure === 'kind') ack.kind = 'TEST_FUND_APPOINTMENT_COMMIT'
      if (failure === 'command') ack.request = { command: 'submit_product', key, payload: { product_id: product, expected_revision: 3 } }
      if (failure === 'extra') ack.status = 'PUBLISHED'
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: ack, refresh_required: true }, 202)))
      await expect(postPortalCommand(instruction, context, actor)).rejects.not.toHaveProperty('committed')
    })
  it.each([201, 400, 403, 503])('does not treat HTTP %s as a valid commit response', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, status)))
    await expect(postPortalCommand(instruction, context, actor)).rejects.not.toHaveProperty('committed')
  })
  it('rejects TEST receipts in MAIN and never treats an error plus ACK as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(instruction, context, actor, undefined, undefined, undefined, 'MAINNET')).rejects.not.toHaveProperty('committed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), error: 'Denied' })))
    await expect(postPortalCommand(instruction, context, actor)).rejects.not.toHaveProperty('committed')
  })
  it.each(['missing receipt', 'other key', 'other command', 'actor', 'context', 'shape'] as const)(
    'keeps refresh-required on %s readback, never returning ACK as a snapshot', async failure => {
      const value = snapshot(actor, context, [{ key, command: instruction.command }])
      if (failure === 'missing receipt') value.requests = []
      if (failure === 'other key') value.requests = [{ key: other, command: instruction.command }]
      if (failure === 'other command') value.requests = [{ key, command: 'submit_product' }]
      if (failure === 'actor') value.actor.id = other
      if (failure === 'context') value.operating_context = { ...context, organisationId: other }
      if (failure === 'shape') Reflect.deleteProperty(value, 'products')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), snapshot: value })))
      await expect(postPortalCommand(instruction, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
    })
  it('returns only the valid current snapshot with the exact request receipt', async () => {
    const value = snapshot(actor, context, [{ key, command: instruction.command }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), snapshot: value })))
    expect(await postPortalCommand(instruction, context, actor)).toEqual(value)
  })
})

describe('saved publication refresh without replacement writes', () => {
  it('retains the original private marker, blocks another action and retries the exact original key and payload', async () => {
    const onSaved = vi.fn(), received: PortalCommand[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = sentRequest(init); received.push(request)
      return received.length === 1 ? json({ committed: acknowledgement(request), refresh_required: true }, 202)
        : json({ committed: acknowledgement(request), snapshot: snapshot(actor, context, [{ key: request.key, command: request.command }]) })
    })
    vi.stubGlobal('fetch', fetch)
    render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish fund' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(screen.queryByText(/result is uncertain/i)).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(Object.keys(JSON.parse(originalMarker)).sort()).toEqual(['command', 'key', 'payloadHash'])
    expect(originalMarker).not.toContain(product); expect(originalMarker).not.toContain(session)
    fireEvent.click(screen.getByRole('button', { name: 'Publish another product' }))
    await screen.findByText(/Re-enter the original values/)
    expect(fetch).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(received[1]).toEqual(received[0]); expect(sessionStorage.length).toBe(0)
  })
  it('does not clear a known commit on an unrelated snapshot or a later authority denial', async () => {
    const onSaved = vi.fn(); let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = sentRequest(init); attempt += 1
      if (attempt === 1) return json({ committed: acknowledgement(request), refresh_required: true }, 202)
      return attempt === 2 ? json({ snapshot: snapshot() }) : json({ error: 'Current authority unavailable.' }, 403)
    }))
    render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish fund' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    const original = sessionStorage.getItem(sessionStorage.key(0)!)
    for (const count of [2, 3]) {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
      await waitFor(() => expect(attempt).toBe(count))
      await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'))
    }
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(screen.getByText(/Your publication request was saved, but/)).toBeTruthy()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(original)
  })
  const lateCases = (['actor', 'environment', 'context'] as const).flatMap(change =>
    (['acknowledgement', 'snapshot', 'read failure'] as const).map(result => ({ change, result })))
  it.each(lateCases)('ignores late $result after $change switch without clearing either scope marker', async ({ change, result }) => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let request: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      request = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish fund' }))
    await waitFor(() => expect(request).toBeDefined())
    const oldKey = sessionStorage.key(0)!, original = sessionStorage.getItem(oldKey)
    const nextActor = change === 'actor' ? other : actor
    const nextContext = change === 'context' ? { ...context, organisationId: other } : context
    const nextEnvironment = change === 'environment' ? 'MAINNET' : 'TESTNET'
    const nextScope = { operatingContext: nextContext, environment: nextEnvironment } as const
    await prepareDurablePortalCommand(sessionStorage, nextActor, { ...instruction, key: nextKey }, [], nextScope)
    page.rerender(<Page onSaved={onSaved} value={snapshot(nextActor, nextContext)} environment={nextEnvironment} />)
    await act(async () => finish!(result === 'acknowledgement' ? json({ committed: acknowledgement(request!), refresh_required: true }, 202)
      : result === 'snapshot' ? json({ committed: acknowledgement(request!), snapshot: snapshot(actor, context, [{ key: request!.key, command: request!.command }]) })
        : json({ error: 'Saved state unavailable.' }, 503)))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
    expect(sessionStorage.getItem(oldKey)).toBe(original); expect(sessionStorage.length).toBe(2)
    expect(reconcilePortalMarker(sessionStorage, nextActor, [], nextScope)?.key).toBe(nextKey)
  })
  it('does not adopt an old ACK after switching away and back to the same scope', async () => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let request: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      request = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish fund' }))
    await waitFor(() => expect(request).toBeDefined())
    const marker = sessionStorage.getItem(sessionStorage.key(0)!)
    page.rerender(<Page onSaved={onSaved} value={snapshot(other)} />)
    page.rerender(<Page onSaved={onSaved} />)
    await act(async () => finish!(json({ committed: acknowledgement(request!), refresh_required: true }, 202)))
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(marker)
  })
})
