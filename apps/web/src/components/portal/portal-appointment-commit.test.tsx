// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalCommand, type PortalSnapshot } from '@/lib/portal/contracts'
import type { AppointmentCommit } from '@/lib/portal/appointment-commit'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import type { PlatformEnvironment } from '@/lib/platform-release'
import { CommandFeedback, PortalCommandProvider, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker, usePortalCommand } from './portal-client'

// Mounted client/transport fixtures only. They are not genuine database commits,
// independent human review, provider evidence or hosted acceptance.
const actor = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const organisation = '33333333-3333-4333-8333-333333333333'
const product = '44444444-4444-4444-8444-444444444444'
const appointment = '55555555-5555-4555-8555-555555555555'
const policy = '66666666-6666-4666-8666-666666666666'
const offering = '77777777-7777-4777-8777-777777777777'
const session = '88888888-8888-4888-8888-888888888888'
const key = '99999999-9999-4999-8999-999999999999'
const membership = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const context: Extract<PortalOperatingContext, { mode: 'ROLE' }> = { mode: 'ROLE', organisationId: organisation, role: 'OfferingManager' }
const instruction = portalCommandSchema.parse({ command: 'request_product_service_appointment', key, payload: {
  product_id: product, role: 'IssuerFundManager', appointee_user_id: other, native_membership_id: membership,
  expected_product_revision: 3, evidence_reference: 'Synthetic appointment evidence for this exact product.', requested_until: '2099-01-01T23:59:59Z',
} })
function acknowledgement(request: PortalCommand = instruction): AppointmentCommit {
  return { kind: 'TEST_FUND_APPOINTMENT_COMMIT', version: 1, environment: 'TESTNET', execution_mode: 'TEST_ROLE_PLAY', independence_proven: false,
    actor_id: actor, session_id: session, operating_context: context, policy_id: policy, authority_epoch: 2,
    product_id: product, offering_revision_id: offering, appointment_id: appointment, appointment_revision: 1,
    request, recorded_at: '2026-10-15T15:15:00Z' }
}
function snapshot(selectedActor = actor, selectedContext = context, requests: PortalSnapshot['requests'] = []): PortalSnapshot {
  return { actor: { id: selectedActor, email: 'fixture@example.invalid', display_name: 'Synthetic participant', can_review: false },
    operating_context: selectedContext, applications: [], organisations: [], products: [], subscriptions: [], events: [], requests,
    ...(selectedContext.mode === 'ROLE' && selectedContext.role === 'OfferingManager' ? { offering_access: {
      version: 1 as const, environment: 'TESTNET' as const, actor_id: selectedActor,
      operating_context: { mode: 'ROLE' as const, organisationId: selectedContext.organisationId, role: 'OfferingManager' as const },
      session_mode: 'STANDARD' as const, allowed_commands: ['request_product_service_appointment' as const],
    } } : {}) }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function sentRequest(init?: RequestInit): PortalCommand {
  const { operating_context: _context, ...request } = JSON.parse(String(init?.body))
  return portalCommandSchema.parse(request)
}
function Harness({ onSaved, replacement = false }: { onSaved: (value: PortalSnapshot) => void; replacement?: boolean }) {
  const command = usePortalCommand(onSaved)
  return <section aria-label={replacement ? 'Other action' : 'Original action'}>
    <button type="button" onClick={() => void command.submit(instruction.command, { ...instruction.payload,
      ...(replacement ? { role: 'ComplianceOfficer' } : {}),
    })}>{replacement ? 'Start another appointment' : 'Submit appointment'}</button>
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

describe('strict appointment commit transport', () => {
  it('distinguishes a validated saved command with failed readback from an unknown outcome', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(instruction, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
  })

  it.each(['actor', 'context', 'environment', 'key', 'payload', 'independence', 'command', 'extra'] as const)('does not claim a commit for a malformed or foreign %s acknowledgement', async failure => {
    const ack: Record<string, unknown> = { ...acknowledgement() }
    if (failure === 'actor') ack.actor_id = other
    if (failure === 'context') ack.operating_context = { ...context, organisationId: other }
    if (failure === 'environment') ack.environment = 'MAINNET'
    if (failure === 'key') ack.request = { ...instruction, key: other }
    if (failure === 'payload') ack.request = { ...instruction, payload: { ...instruction.payload, evidence_reference: 'Different synthetic evidence, not the saved request.' } }
    if (failure === 'independence') ack.independence_proven = true
    if (failure === 'command') ack.request = { command: 'publish_product', key, payload: { product_id: product, expected_revision: 3 } }
    if (failure === 'extra') ack.unrecognised = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: ack, refresh_required: true }, 202)))
    await expect(postPortalCommand(instruction, context, actor)).rejects.not.toHaveProperty('committed')
  })

  it.each([400, 403, 500, 503])('does not trust an acknowledgement on failure status %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, status)))
    await expect(postPortalCommand(instruction, context, actor)).rejects.not.toHaveProperty('committed')
  })

  it('rejects TEST acknowledgement use in MAIN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ committed: acknowledgement(), refresh_required: true }, 202)))
    await expect(postPortalCommand(instruction, context, actor, undefined, undefined, undefined, 'MAINNET')).rejects.not.toHaveProperty('committed')
  })

  it.each(['missing', 'other key', 'other command', 'actor', 'context', 'shape'] as const)('keeps confirmed-write/refresh-required state when the snapshot has %s proof', async failure => {
    const value = snapshot(actor, context, [{ key, command: instruction.command }])
    if (failure === 'missing') value.requests = []
    if (failure === 'other key') value.requests = [{ key: other, command: instruction.command }]
    if (failure === 'other command') value.requests = [{ key, command: 'apply_product_service_appointment' }]
    if (failure === 'actor') value.actor.id = other
    if (failure === 'context') value.operating_context = { mode: 'ROLE', role: 'SuperAdmin', organisationId: organisation }
    if (failure === 'shape') Reflect.deleteProperty(value, 'products')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ snapshot: value, committed: acknowledgement() })))
    await expect(postPortalCommand(instruction, context, actor)).rejects.toMatchObject({ committed: true, definitive: false })
  })

  it('returns only a validated current snapshot with the exact command receipt, never the ACK as a snapshot', async () => {
    const value = snapshot(actor, context, [{ key, command: instruction.command }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ snapshot: value, committed: acknowledgement() })))
    expect(await postPortalCommand(instruction, context, actor)).toEqual(value)
  })
})

describe('saved appointment refresh without replacement writes', () => {
  it('retains the original private marker, blocks another component and retries the exact same command until snapshot receipt matches', async () => {
    const onSaved = vi.fn()
    const received: PortalCommand[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = sentRequest(init); received.push(request)
      return received.length === 1 ? json({ committed: acknowledgement(request), refresh_required: true }, 202)
        : json({ committed: acknowledgement(request), snapshot: snapshot(actor, context, [{ key: request.key, command: request.command }]) })
    })
    vi.stubGlobal('fetch', fetch)
    render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    expect(screen.queryByText(/result is uncertain/i)).toBeNull()
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(onSaved).not.toHaveBeenCalled()
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)!
    expect(Object.keys(JSON.parse(originalMarker)).sort()).toEqual(['command', 'key', 'payloadHash'])
    expect(originalMarker).not.toContain('Synthetic appointment evidence')
    expect(originalMarker).not.toContain(session)
    fireEvent.click(screen.getByRole('button', { name: 'Start another appointment' }))
    await screen.findByText(/Re-enter the original values/)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(received[1]).toEqual(received[0])
    expect(sessionStorage.length).toBe(0)
    expect(screen.getByTestId('committed').textContent).toBe('false')
  })

  it('does not clear committed state or marker on an unrelated successful snapshot or later denial', async () => {
    const onSaved = vi.fn()
    let attempt = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = sentRequest(init)
      attempt += 1
      if (attempt === 1) return json({ committed: acknowledgement(request), refresh_required: true }, 202)
      if (attempt === 2) return json({ snapshot: snapshot(actor, context) })
      return json({ error: 'The operating authority is no longer available.' }, 403)
    }))
    render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(attempt).toBe(2))
    await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved result' }))
    await waitFor(() => expect(attempt).toBe(3))
    await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'))
    expect(onSaved).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
    expect(screen.getByTestId('committed').textContent).toBe('true')
    expect(screen.queryByText(/result is uncertain/i)).toBeNull()
  })

  it('clears only when a separately refreshed current snapshot includes the original request receipt', async () => {
    const onSaved = vi.fn(); let request: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      request = sentRequest(init); return json({ committed: acknowledgement(request), refresh_required: true }, 202)
    }))
    const page = render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await screen.findByRole('button', { name: 'Refresh saved result' })
    page.rerender(<Page onSaved={onSaved} value={snapshot(actor, context, [{ key: other, command: instruction.command }])} />)
    expect(sessionStorage.length).toBe(1)
    expect(screen.getByTestId('committed').textContent).toBe('true')
    page.rerender(<Page onSaved={onSaved} value={snapshot(actor, context, [{ key: request!.key, command: request!.command }])} />)
    await waitFor(() => expect(sessionStorage.length).toBe(0))
    expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('retains unknown state, not committed state, for a foreign acknowledgement', async () => {
    const onSaved = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => json({
      committed: { ...acknowledgement(sentRequest(init)), actor_id: other }, refresh_required: true,
    }, 202)))
    render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
    expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(onSaved).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(1)
  })

  const lateCases = (['actor', 'environment', 'context'] as const).flatMap(change =>
    (['acknowledgement', 'snapshot', 'read failure'] as const).map(result => ({ change, result })))
  it.each(lateCases)('ignores late $result after a $change switch while keeping both scopes markers', async ({ change, result }) => {
    const onSaved = vi.fn()
    let finish: ((value: Response) => void) | undefined
    let request: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      request = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await waitFor(() => expect(request).toBeDefined())
    const oldMarkerKey = sessionStorage.key(0)!, oldMarker = sessionStorage.getItem(oldMarkerKey)
    const nextActor = change === 'actor' ? other : actor
    const nextContext: PortalOperatingContext = change === 'context' ? { mode: 'ROLE', organisationId: other, role: 'OfferingManager' } : context
    const nextEnvironment = change === 'environment' ? 'MAINNET' : 'TESTNET'
    const nextScope = { operatingContext: nextContext, environment: nextEnvironment } as const
    await prepareDurablePortalCommand(sessionStorage, nextActor, { ...instruction, key: membership }, [], nextScope)
    page.rerender(<Page onSaved={onSaved} value={snapshot(nextActor, nextContext)} environment={nextEnvironment} />)
    await act(async () => finish!(result === 'acknowledgement' ? json({ committed: acknowledgement(request!), refresh_required: true }, 202)
      : result === 'snapshot' ? json({ committed: acknowledgement(request!), snapshot: snapshot(actor, context, [{ key: request!.key, command: request!.command }]) })
        : json({ error: 'The saved portal state is temporarily unavailable.' }, 503)))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
    expect(sessionStorage.getItem(oldMarkerKey)).toBe(oldMarker)
    expect(sessionStorage.length).toBe(2)
    expect(reconcilePortalMarker(sessionStorage, nextActor, [], nextScope)?.key).toBe(membership)
  })

  it('does not borrow a late acknowledgement after switching away and back to the same context', async () => {
    const onSaved = vi.fn(); let finish: ((value: Response) => void) | undefined; let request: PortalCommand | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      request = sentRequest(init); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const page = render(<Page onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit appointment' }))
    await waitFor(() => expect(request).toBeDefined())
    const originalMarker = sessionStorage.getItem(sessionStorage.key(0)!)
    page.rerender(<Page onSaved={onSaved} value={snapshot(other)} />)
    page.rerender(<Page onSaved={onSaved} value={snapshot()} />)
    await act(async () => finish!(json({ committed: acknowledgement(request!), refresh_required: true }, 202)))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('committed').textContent).toBe('false')
    expect(screen.queryByRole('button', { name: 'Refresh saved result' })).toBeNull()
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(originalMarker)
  })
})
