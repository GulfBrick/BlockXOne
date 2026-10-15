// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalProduct, PortalProductServiceAppointment } from '@/lib/portal/contracts'
import type { OfferingSignatureSnapshot } from '@/lib/portal/offering-signatures'
import { OfferingSignatures } from './offering-signatures'

const actor = '11111111-1111-4111-8111-111111111111', productId = '22222222-2222-4222-8222-222222222222', revisionId = '33333333-3333-4333-8333-333333333333'
const authorisation = '44444444-4444-4444-8444-444444444444', operation = '55555555-5555-4555-8555-555555555555'
const context = { mode: 'ROLE' as const, organisationId: productId, role: 'IssuerFundManager' as const }
const product = { id: productId, revision: 3, terms: { terms_version: 3 }, offering_package: { id: revisionId, origin: 'SUBMITTED' } } as PortalProduct
const fetcher = vi.fn()
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function saved(change: Partial<OfferingSignatureSnapshot> = {}): OfferingSignatureSnapshot {
  return { version: 1, actor_id: actor, session_id: actor, context, environment: 'TESTNET', product_id: productId, revision_id: revisionId,
    expected_revision: 3, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: true, blocker: null, allowed_commands: ['REQUEST_SIGNING_VIEW', 'REQUEST_RECONCILIATION'],
    authorisations: [{ id: authorisation, signer_id: actor, signer_person_id: actor, appointment_id: authorisation, state: 'APPROVED', valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: new Date(Date.now() + 86400000).toISOString(), source_reference: 'Synthetic purpose evidence reference' }],
    operations: [{ id: operation, authorisation_id: authorisation, state: 'SENT', current: false, noncurrent_reason: null, envelope_id: operation, next_check_at: new Date(Date.now() + 900000).toISOString(), artifacts: [] }], ...change }
}
beforeEach(() => { fetcher.mockReset(); sessionStorage.clear(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('mounted issuer execution controls (synthetic transport, not provider acceptance)', () => {
  it('sends a manager purpose request with an existing appointment and source references, never a signer email', async () => {
    const managerContext = { ...context, role: 'OfferingManager' as const }
    const value = saved({ context: managerContext, authorisations: [], operations: [], allowed_commands: ['REQUEST_PURPOSE'] })
    const appointment = { id: authorisation, product_id: productId, role: 'IssuerFundManager', status: 'APPLIED', effective: true,
      approval_receipt_id: authorisation, requested_until: new Date(Date.now() + 86400000).toISOString(), appointee_user_id: operation } as PortalProductServiceAppointment
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return reply(value)
      const request = JSON.parse(init.body).request
      return reply({ snapshot: value, command: request.command, key: request.key })
    })
    render(<OfferingSignatures product={product} context={managerContext} actorId={actor} appointments={[appointment]} />)
    fireEvent.click(await screen.findByRole('radio', { name: /Appointed issuer/ }))
    fireEvent.change(screen.getByLabelText('Purpose valid from'), { target: { value: '2026-10-01T10:00' } })
    fireEvent.change(screen.getByLabelText('Purpose valid until'), { target: { value: '2026-11-01T10:00' } })
    fireEvent.change(screen.getByLabelText('Purpose source evidence reference'), { target: { value: 'Existing independently reviewable synthetic purpose evidence.' } })
    fireEvent.change(screen.getByLabelText(/^Source evidence SHA-256/), { target: { value: 'a'.repeat(64) } })
    fireEvent.click(screen.getByRole('button', { name: 'Request independent purpose review' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const body = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(body.operating_context).toEqual(managerContext)
    expect(body.request.command).toBe('REQUEST_PURPOSE')
    expect(body.request.payload.appointment_id).toBe(authorisation)
    expect(body.request.payload).not.toHaveProperty('signer_email')
    expect(body.request.payload).not.toHaveProperty('signer_id')
    expect(screen.queryByRole('button', { name: 'Approve synthetic signing purpose' })).toBeNull()
  })
  it('keeps purpose approval separate from offering approval and uses the appointed Compliance capability', async () => {
    const complianceContext = { ...context, role: 'ComplianceOfficer' as const }
    const value = saved({ context: complianceContext, operations: [], allowed_commands: ['REVIEW_PURPOSE'] })
    value.authorisations[0].state = 'REQUESTED'
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return reply(value)
      const request = JSON.parse(init.body).request
      return reply({ snapshot: value, command: request.command, key: request.key })
    })
    render(<OfferingSignatures product={product} context={complianceContext} actorId={actor} />)
    await screen.findByRole('button', { name: 'Approve synthetic signing purpose' })
    fireEvent.change(screen.getByLabelText(/^Signature decision or recovery reason/), { target: { value: 'Independent synthetic signing-purpose evidence reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve synthetic signing purpose' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const request = JSON.parse(fetcher.mock.calls[1][1].body).request
    expect(request.command).toBe('REVIEW_PURPOSE')
    expect(request.payload).toMatchObject({ authorisation_id: authorisation, decision: 'APPROVED' })
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
  })
  it('keeps actions closed while loading and on malformed/other actor or unknown versions', async () => {
    let resolve: (value: unknown) => void = () => {}
    fetcher.mockReturnValue(new Promise(value => { resolve = value }))
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    expect(screen.getByText('Checking signature authority')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    resolve(reply(saved({ actor_id: productId })))
    await screen.findByText('Signature authority unavailable')
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'x-bx1-expected-actor': actor })
  })
  it('shows scheduled local evidence without polling and links a short-lived view only after exact acknowledgement', async () => {
    const snapshot = saved(), url = 'https://demo.docusign.net/Signing/start?token=synthetic-view'
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST'
      ? reply({ snapshot, command: 'REQUEST_SIGNING_VIEW', key: JSON.parse(init.body).request.key, view_status: 'AVAILABLE', signing_url: url }) : reply(snapshot))
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get my DocuSign signing link' }))
    const link = await screen.findByRole('link', { name: 'Open my short-lived DocuSign signing session' })
    expect(link.getAttribute('href')).toBe(url)
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(sessionStorage.length).toBe(0)
    expect(screen.getByText(/Returning from DocuSign does not confirm completion/)).toBeTruthy()
    expect(screen.getByText(/Next provider check no earlier/)).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved signature state' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Open my short-lived DocuSign signing session' })).toBeNull())
  })
  it('retains unknown-command identity through retry and rejects a wrong acknowledgement key', async () => {
    const snapshot = saved()
    let successful = false
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return reply(snapshot)
      const request = JSON.parse(init.body).request
      return successful ? reply({ snapshot, command: request.command, key: request.key }) : reply({ snapshot, command: request.command, key: operation })
    })
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Request scheduled reconciliation' }))
    await screen.findByText(/outcome is unknown or access changed/)
    const first = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(sessionStorage.length).toBe(1)
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    successful = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same signature request' }))
    await waitFor(() => expect(sessionStorage.length).toBe(0))
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual(first)
  })
  it('reconciles a lost view receipt before allowing a fresh link for the same operation', async () => {
    const snapshot = saved()
    let viewAttempt = 0
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return reply(snapshot)
      const request = JSON.parse(init.body).request
      if (++viewAttempt === 1) throw new Error('Synthetic lost actor response')
      return reply({ snapshot, command: request.command, key: request.key, view_status: 'RETRY_SAME_ENVELOPE' })
    })
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get my DocuSign signing link' }))
    await screen.findByText(/outcome is unknown or access changed/)
    const original = JSON.parse(fetcher.mock.calls[1][1].body).request
    expect(sessionStorage.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same signature request' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open a new signing link for this same envelope' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
    expect(JSON.parse(fetcher.mock.calls[2][1].body).request).toEqual(original)
    const fresh = JSON.parse(fetcher.mock.calls[3][1].body).request
    expect(fresh.key).not.toBe(original.key)
    expect(fresh.payload.operation_id).toBe(original.payload.operation_id)
    expect(fresh.command).toBe('REQUEST_SIGNING_VIEW')
    expect(screen.queryByRole('link', { name: 'Open my short-lived DocuSign signing session' })).toBeNull()
  })
  it.each(['DECLINED', 'UNKNOWN_RECONCILIATION', 'RECOVERY_REQUIRED'] as const)('shows the next owner for %s without inventing completion or a signing link', async state => {
    const value = saved(); value.operations[0].state = state
    fetcher.mockResolvedValue(reply(value))
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    await screen.findByRole('heading', { name: state.replaceAll('_', ' ') })
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open my short-lived DocuSign signing session' })).toBeNull()
  })
  it('retains historical evidence without offering a signing view after revocation', async () => {
    const value = saved(); value.authorisations[0].state = 'REVOKED'; value.operations[0].current = false; value.operations[0].noncurrent_reason = 'Purpose revoked; historical reconciliation only.'
    fetcher.mockResolvedValue(reply(value))
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    await screen.findByText('Historical / non-current evidence')
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Request scheduled reconciliation' })).toBeTruthy()
  })
  it.each(['EVIDENCE_RETAINED', 'DECLINED', 'VOIDED', 'SUPERSEDED'] as const)('hides reconciliation for terminal %s while retaining historical artifact access', async state => {
    const value = saved()
    value.authorisations[0].state = 'REVOKED'
    value.operations[0] = { ...value.operations[0], state, current: false, next_check_at: null,
      noncurrent_reason: 'Historical evidence remains available after purpose revocation.',
      artifacts: [{ id: authorisation, kind: 'CERTIFICATE', sha256: 'a'.repeat(64), size: 32, mime_type: 'application/pdf' }] }
    fetcher.mockResolvedValue(reply(value))
    render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    const link = await screen.findByRole('link', { name: 'CERTIFICATE PDF' })
    expect(screen.queryByRole('button', { name: 'Request scheduled reconciliation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    const href = new URL(link.getAttribute('href')!, 'https://testnet.bx1.co.za')
    expect(href.pathname).toBe('/api/portal/offering-signatures')
    expect(Object.fromEntries(href.searchParams)).toEqual({ revision_id: revisionId, organisation: productId,
      role: 'IssuerFundManager', id: authorisation, download: '1', expected_actor: actor })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects stale read and command responses after actor/context changes, retaining the old journal', async () => {
    const snapshot = saved()
    let resolvePost: (value: unknown) => void = () => {}
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST' ? new Promise(resolve => { resolvePost = resolve }) : reply(init?.headers['x-bx1-expected-actor'] === actor ? snapshot : saved({ actor_id: productId, allowed_commands: [] })))
    const page = render(<OfferingSignatures product={product} context={context} actorId={actor} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Get my DocuSign signing link' }))
    const request = JSON.parse(fetcher.mock.calls[1][1].body).request
    page.rerender(<OfferingSignatures product={product} context={context} actorId={productId} />)
    resolvePost(reply({ snapshot, command: request.command, key: request.key, view_status: 'AVAILABLE', signing_url: 'https://demo.docusign.net/Signing/start?token=old-actor' }))
    await screen.findByText(/An issuer review appointment is not execution authority/)
    expect(screen.queryByRole('link', { name: 'Open my short-lived DocuSign signing session' })).toBeNull()
    expect(sessionStorage.length).toBe(1)
  })
  it('does not read or upgrade historical v2 packages', () => {
    const legacy = { ...product, terms: { ...product.terms, terms_version: 2 } } as PortalProduct
    render(<OfferingSignatures product={legacy} context={context} actorId={actor} />)
    expect(screen.getByText(/Historical text-only packages are not upgraded/)).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps an explicit provider connection check available in the manager panel before signature admission', async () => {
    const managerContext = { ...context, role: 'OfferingManager' as const }
    const value = saved({ context: managerContext, admitted: false, allowed_commands: [], authorisations: [], operations: [] })
    fetcher.mockImplementation(async url => String(url).startsWith('/api/portal/offering-signatures/provider-status?')
      ? new Response(JSON.stringify({ environment: 'TESTNET', provider: 'DOCUSIGN', check: 'SANDBOX_AUTHENTICATION_ONLY', status: 'AVAILABLE',
        classifier: 'AUTHENTICATED', checkedAt: '2026-10-15T10:00:00.000Z' }), { headers: { 'content-type': 'application/json' } })
      : reply(value))
    render(<OfferingSignatures product={product} context={managerContext} actorId={actor} environment="TESTNET" />)
    await screen.findByText('Signature processing not admitted')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' }))
    await screen.findByText('DocuSign sandbox authentication confirmed.')
    expect(screen.getByText('Signature processing not admitted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request independent purpose review' })).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })
  it('does not offer TEST provider checks to MAIN managers or other package roles', async () => {
    const managerContext = { ...context, role: 'OfferingManager' as const }
    fetcher.mockResolvedValue(reply(saved({ context: managerContext, admitted: false, allowed_commands: [] })))
    const view = render(<OfferingSignatures product={product} context={managerContext} actorId={actor} environment="MAINNET" />)
    await screen.findByText('Signature processing not admitted')
    expect(screen.queryByRole('button', { name: 'Check DocuSign sandbox connection' })).toBeNull()
    view.rerender(<OfferingSignatures product={product} context={context} actorId={actor} environment="TESTNET" />)
    expect(screen.queryByRole('button', { name: 'Check DocuSign sandbox connection' })).toBeNull()
  })
})
