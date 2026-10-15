// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderConnectionCheck } from './provider-connection-check'

// Synthetic transport only: these mounted checks do not prove provider admission,
// an applicant result, an envelope, signature evidence or a hosted connection.
const actor = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333', revisionId = '44444444-4444-4444-8444-444444444444'
const compliance = { mode: 'ROLE' as const, organisationId: productId, role: 'ComplianceOfficer' as const }
const manager = { ...compliance, role: 'OfferingManager' as const }
const fetcher = vi.fn<typeof fetch>()
const individual = { configured: true, enabled: true, level_present: true, provider_subject_type: 'individual', classifier: 'LEVEL_PRESENT' }
function sumsub() { return { actor_id: actor, provider: 'SUMSUB', environment: 'TESTNET', status: 'CONNECTED', classifier: 'AUTHENTICATED_LEVELS_READ',
  sandbox_enabled: true, individual, company: { configured: false, enabled: false, level_present: null, provider_subject_type: null, classifier: 'LEVEL_NOT_CONFIGURED' },
  available_levels: [{ name: 'private-level-name', applicant_type: 'individual' }], webhook: { configured: true, delivery_proved: false },
  evidence_writer: { configured: true, connection_proved: false }, verification_proved: false, admission_granted: false } }
function docusign(available = true) { return { environment: 'TESTNET', provider: 'DOCUSIGN', check: 'SANDBOX_AUTHENTICATION_ONLY',
  status: available ? 'AVAILABLE' : 'UNAVAILABLE', classifier: available ? 'AUTHENTICATED' : 'NOT_CONFIGURED', checkedAt: '2026-10-15T10:00:00.000Z' } }
const reply = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const sumsubUi = (actorId = actor, context = compliance, environment: 'TESTNET' | 'MAINNET' = 'TESTNET') =>
  <ProviderConnectionCheck provider="SUMSUB" actorId={actorId} context={context} environment={environment} />
const docuUi = (productRevision = 3) => <ProviderConnectionCheck provider="DOCUSIGN" actorId={actor} context={manager} environment="TESTNET"
  productId={productId} revisionId={revisionId} productRevision={productRevision} />
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('existing-workspace sandbox connection controls', () => {
  it('does not fetch on mount and keeps both checks hidden in MAIN or the wrong capacity', () => {
    const view = render(sumsubUi())
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' })).toBeTruthy()
    view.rerender(sumsubUi(actor, compliance, 'MAINNET'))
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<ProviderConnectionCheck provider="SUMSUB" actorId={actor} context={manager} environment="TESTNET" />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<ProviderConnectionCheck provider="DOCUSIGN" actorId={actor} context={compliance} environment="TESTNET"
      productId={productId} revisionId={revisionId} productRevision={3} />)
    expect(screen.queryByRole('button')).toBeNull()
    view.rerender(<ProviderConnectionCheck provider="DOCUSIGN" actorId={actor} context={manager} environment="MAINNET"
      productId={productId} revisionId={revisionId} productRevision={3} />)
    expect(screen.queryByRole('button')).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks Sumsub with cookies and expected actor, without claiming company verification or admission', async () => {
    fetcher.mockResolvedValue(reply(sumsub()))
    render(sumsubUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
    await screen.findByText('Sumsub sandbox authentication confirmed.')
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/portal/kyc/readiness', expect.objectContaining({ method: 'GET', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': actor }, signal: expect.any(AbortSignal) }))
    expect(screen.getByText(/Individual verification:/).textContent).toContain('Configured level confirmed')
    expect(screen.getByText(/Company verification:/).textContent).toContain('Not enabled')
    expect(screen.getByText('A connection check does not verify an applicant or approve an application.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('private-level-name')
    expect(document.body.textContent).not.toContain('delivery_proved')
  })
  it('uses the exact current manager/package query and handles a classified DocuSign 503 without an envelope', async () => {
    fetcher.mockResolvedValue(reply(docusign(false), 503))
    render(docuUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' }))
    await screen.findByText('The sandbox connection is not configured. The integration owner must finish setup.')
    const [url, init] = fetcher.mock.calls[0]
    const parsed = new URL(String(url), 'https://testnet.bx1.co.za')
    expect(parsed.pathname).toBe('/api/portal/offering-signatures/provider-status')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ product_id: productId, revision_id: revisionId, organisation: manager.organisationId,
      role: 'OfferingManager', expected_actor: actor })
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
    expect(init?.body).toBeUndefined()
    expect(screen.getByText('Authentication does not enable signature processing, create an envelope or prove a completed signature.')).toBeTruthy()
    expect(screen.queryByText('DocuSign sandbox authentication confirmed.')).toBeNull()
  })
  it('shows an authenticated DocuSign connection only for a consistent strict provider response', async () => {
    fetcher.mockResolvedValue(reply(docusign()))
    render(docuUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' }))
    await screen.findByText('DocuSign sandbox authentication confirmed.')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['actor', 'shape', 'inconsistent status', 'content type', 'oversized', 'authentication'])(
    'rejects an unsafe or unavailable response: %s', async failure => {
      const value = sumsub()
      let response: Response
      if (failure === 'actor') response = reply({ ...value, actor_id: other })
      else if (failure === 'shape') response = reply({ ...value, secret: 'DO-NOT-RENDER' })
      else if (failure === 'inconsistent status') response = reply({ ...value, status: 'UNAVAILABLE' })
      else if (failure === 'content type') response = reply(value, 200, { 'content-type': 'text/html' })
      else if (failure === 'oversized') response = reply(value, 200, { 'content-length': '65537' })
      else response = reply({ error: 'DO-NOT-RENDER' }, 403)
      fetcher.mockResolvedValue(response)
      render(sumsubUi())
      fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
      await screen.findByText(failure === 'authentication' ? /Your session or access changed/ : /The connection check could not finish/)
      expect(screen.queryByText('Sumsub sandbox authentication confirmed.')).toBeNull()
      expect(document.body.textContent).not.toContain('DO-NOT-RENDER')
    })
  it('discards A→B→A late replies without overriding the newer A result or unlocking a pending check', async () => {
    const old = deferred<Response>(), latest = deferred<Response>()
    fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const view = render(sumsubUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
    const oldSignal = fetcher.mock.calls[0][1]?.signal
    view.rerender(sumsubUi(actor, { ...compliance, organisationId: other }))
    expect(oldSignal?.aborted).toBe(true)
    view.rerender(sumsubUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
    await act(async () => { old.resolve(reply(sumsub())); await old.promise })
    expect(screen.queryByText('Sumsub sandbox authentication confirmed.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Checking Sumsub connection…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { latest.resolve(reply({ ...sumsub(), status: 'NOT_CONFIGURED', classifier: 'CREDENTIALS_NOT_CONFIGURED' })); await latest.promise })
    await screen.findByText(/The sandbox connection is not configured/)
    expect(screen.queryByText('Sumsub sandbox authentication confirmed.')).toBeNull()
  })
  it('clears completed status on actor, package revision or environment changes and aborts on unmount', async () => {
    fetcher.mockResolvedValueOnce(reply(sumsub()))
    const view = render(sumsubUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
    await screen.findByText('Sumsub sandbox authentication confirmed.')
    view.rerender(sumsubUi(other))
    expect(screen.queryByText('Sumsub sandbox authentication confirmed.')).toBeNull()
    view.rerender(docuUi())
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' }))
    const signal = fetcher.mock.calls.at(-1)?.[1]?.signal
    view.rerender(docuUi(4))
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve(reply(docusign())); await pending.promise })
    expect(screen.queryByText('DocuSign sandbox authentication confirmed.')).toBeNull()
    const unmounted = deferred<Response>(); fetcher.mockReturnValueOnce(unmounted.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' }))
    const lastSignal = fetcher.mock.calls.at(-1)?.[1]?.signal
    view.unmount(); expect(lastSignal?.aborted).toBe(true)
  })
  it('reports timeout without retaining a successful state or automatically retrying', async () => {
    vi.useFakeTimers()
    fetcher.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    render(sumsubUi())
    fireEvent.click(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })
    expect(screen.getByText(/The connection check could not finish/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check Sumsub sandbox connection' }).hasAttribute('disabled')).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
