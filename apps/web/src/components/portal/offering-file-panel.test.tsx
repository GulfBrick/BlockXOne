// @vitest-environment jsdom
import React from 'react'
import { webcrypto, createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalProduct } from '@/lib/portal/contracts'
import { offeringDocumentPayloadText, type OfferingDocumentSnapshot, type OfferingDocumentCommand } from '@/lib/portal/offering-files'
import { OfferingFilePanel } from './offering-file-panel'

const actorId = '11111111-1111-4111-8111-111111111111'
const context = { mode: 'ROLE' as const, organisationId: '22222222-2222-4222-8222-222222222222', role: 'OfferingManager' as const }
const revision = '44444444-4444-4444-8444-444444444444'
const product = { id: '33333333-3333-4333-8333-333333333333', revision: 3, status: 'IN_REVIEW',
  offering_package: { id: revision, origin: 'SUBMITTED', issuer_status: 'PENDING', compliance_status: 'PENDING' } } as PortalProduct
const ids = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777']
const fetcher = vi.fn()
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function snapshot(state: OfferingDocumentSnapshot['state'] = 'NOT_ADMITTED'): OfferingDocumentSnapshot {
  return { revision_id: revision, product_id: product.id, profile: 'PDF_SIGNATURE_REQUIRED_V1', state, manifest: null, files: [],
    document_access: { version: 1, actor_id: actorId, environment: 'TESTNET', context, session_id: ids[0],
      revision_id: revision, product_id: product.id, allowed_commands: state === 'NOT_ADMITTED' ? [] : ['resolve_offering_file_intent', 'seal_offering_document_manifest'],
      can_upload: state !== 'NOT_ADMITTED', can_read_clean: false, approval_allowed: false, approval_blocker: 'signature-not-connected' } }
}
function cleanSnapshot(sealed = false): OfferingDocumentSnapshot {
  const current = snapshot('READY_TO_SEAL')
  return { ...current, state: sealed ? 'SEALED_SIGNATURE_REQUIRED' : 'READY_TO_SEAL',
    files: (['MEMORANDUM', 'RISKS', 'SUBSCRIPTION_TERMS'] as const).map((kind, index) => ({ id: ids[index], revision_id: revision,
      kind, title: `Exact fictional ${kind}`, sha256: 'a'.repeat(64), size: 40, validation_state: 'QUARANTINED',
      uploaded_at: '2026-10-12T00:00:00Z', can_download: sealed, intent_state: 'PROMOTED_CLEAN', processing_state: 'COMPLETED',
      clean_receipt_id: ids[index], selected: sealed })),
    document_access: { ...current.document_access, can_upload: false, can_read_clean: sealed },
    manifest: sealed ? { id: actorId, hash: 'b'.repeat(64), sealed_at: '2026-10-12T00:00:00Z', file_ids: [...ids] as [string, string, string],
      correspondence_statement: 'These exact three fictional PDF bytes correspond to the immutable submitted text; declaration only.' } : null }
}
beforeEach(() => { fetcher.mockReset(); sessionStorage.clear(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('connected offering document panel (synthetic transport, not hosted/scanner proof)', () => {
  it('shows current v2 signature handoffs without rewriting legacy sealed evidence', async () => {
    const current = cleanSnapshot(true)
    fetcher.mockResolvedValue(reply({ ...current, document_access: { ...current.document_access, version: 2,
      signature_status: 'EVIDENCE_RETAINED', approval_allowed: true, approval_blocker: null } }))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByText(/Current signature evidence is retained/)
    expect(screen.getByText(/Publication remains a separate gate/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
  })
  it('has no upload action before a current authoritative register has been checked', () => {
    const html = renderToStaticMarkup(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    expect(html).toContain('Checking current document authority')
    expect(html).toContain('not an approved offering disclosure')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Mark clean')
    expect(html).not.toContain('Approve file')
  })

  it('explains NOT_ADMITTED and never infers a missing file or a staging permission', async () => {
    fetcher.mockResolvedValue(reply(snapshot()))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByText(/document-processing owner must explicitly admit/)
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
    expect(screen.queryByLabelText(/Private PDF/)).toBeNull()
  })

  it('clears a failed register-read message after a successful single-flight manual refresh', async () => {
    const staleError = 'The saved portal state is temporarily unavailable.'
    let completeRefresh!: (value: ReturnType<typeof reply>) => void
    fetcher.mockResolvedValueOnce(reply({ error: staleError }, 503))
      .mockImplementationOnce(() => new Promise(resolve => { completeRefresh = resolve }))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByText(staleError)
    const refreshButton = screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement
    fireEvent.click(refreshButton)
    fireEvent.click(refreshButton)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(staleError)).toBeNull()
    expect(screen.getByRole('button', { name: 'Refreshing processing state…' }).getAttribute('aria-busy')).toBe('true')
    expect(refreshButton.disabled).toBe(true)
    await act(async () => { completeRefresh(reply(snapshot())) })
    await screen.findByText(/document-processing owner must explicitly admit/)
    expect(screen.queryByText(staleError)).toBeNull()
    expect(screen.queryByText('Document authority unavailable')).toBeNull()
    expect((screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
  })

  it('ignores a late failed manual refresh from the old context after the new scope succeeds', async () => {
    let completeOldRefresh!: (value: ReturnType<typeof reply>) => void
    const nextContext = { ...context, organisationId: ids[2] }
    const nextSnapshot = snapshot('PENDING_SCAN')
    nextSnapshot.document_access.context = nextContext
    fetcher.mockResolvedValueOnce(reply(snapshot()))
      .mockImplementationOnce(() => new Promise(resolve => { completeOldRefresh = resolve }))
      .mockResolvedValueOnce(reply(nextSnapshot))
    const mounted = render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByText(/document-processing owner must explicitly admit/)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh processing state' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const oldSignal = fetcher.mock.calls[1][1].signal as AbortSignal
    mounted.rerender(<OfferingFilePanel product={product} context={nextContext} actorId={actorId} />)
    await screen.findByRole('button', { name: 'Stage in quarantine' })
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { completeOldRefresh(reply({ error: 'Old workspace failed after the context changed.' }, 503)) })
    expect(screen.queryByText('Old workspace failed after the context changed.')).toBeNull()
    expect(screen.queryByText('Document authority unavailable')).toBeNull()
    expect((screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Stage in quarantine' })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('fails closed on an unavailable/malformed or other actor register', async () => {
    const current = snapshot('PENDING_SCAN')
    fetcher.mockResolvedValue(reply({ ...current, document_access: { ...current.document_access, actor_id: ids[0] } }))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByText('Document authority unavailable')
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
    expect(screen.getByText(/No missing file or permission is inferred/)).toBeTruthy()
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('uses canonical category order to seal %s without creating signature/approval controls', async asset => {
    const requests: Record<string, unknown>[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'PUT') { requests.push(JSON.parse(options.body)); return reply(cleanSnapshot(true)) }
      return reply(cleanSnapshot())
    })
    render(<OfferingFilePanel product={{ ...product, terms: { asset_type: asset } } as PortalProduct} context={context} actorId={actorId} />)
    const categories = ['memorandum', 'risks', 'subscription terms']
    for (const [index, category] of categories.entries()) fireEvent.change(await screen.findByLabelText(`Clean ${category}`), { target: { value: ids[index] } })
    fireEvent.change(screen.getByLabelText(/^PDF\/text correspondence declaration/), { target: { value: cleanSnapshot(true).manifest!.correspondence_statement } })
    fireEvent.click(screen.getByRole('button', { name: 'Seal exact three-PDF manifest' }))
    await screen.findByText(/Exact clean manifest sealed/)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ expected_actor: actorId, operating_context: context, request: { command: 'seal_offering_document_manifest',
      payload: { product_id: product.id, offering_revision_id: revision, expected_revision: 3, file_ids: ids } } })
    expect(screen.getAllByRole('link', { name: 'Download selected clean PDF' })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /Approve|Mark clean/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
    expect(screen.getByText(/approval, publication and subscription remain unavailable/)).toBeTruthy()
  })

  it('keeps a rejected/abandoned intent immutable and retries unknown resolution with the identical key/body', async () => {
    const current = snapshot('PENDING_SCAN')
    const intent = { id: ids[0], revision_id: revision, kind: 'MEMORANDUM' as const, title: 'Abandoned immutable reservation', sha256: 'a'.repeat(64),
      size: 40, validation_state: 'QUARANTINED' as const, uploaded_at: null, can_download: false,
      intent_state: 'PENDING' as const, processing_state: null, clean_receipt_id: null, selected: false }
    current.files = [intent]
    const attempts: unknown[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'PUT') {
        attempts.push(JSON.parse(options.body))
        if (attempts.length === 1) throw new Error('Delivery outcome unknown')
        return reply({ ...current, state: 'REJECTED_OR_EXCLUDED', files: [{ ...intent, intent_state: 'EXCLUDED' }] })
      }
      return reply(current)
    })
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    fireEvent.change(await screen.findByLabelText(/^Intent resolution reason/), { target: { value: 'Deliberately exclude this abandoned intent without fabricating a scan.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this intent with reason' }))
    await screen.findByText('Document action requires reconciliation')
    expect(screen.queryByRole('button', { name: 'Exclude this intent with reason' })).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh processing state' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText('Document action requires reconciliation')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Exclude this intent with reason' })).toBeNull()
    expect(screen.getByText(/Delivery outcome unknown/)).toBeTruthy()
    expect(sessionStorage.length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same document request' }))
    await screen.findByText(/Intent resolution recorded/)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toEqual(attempts[1])
    expect(screen.getByText(/immutable category cannot be overwritten/)).toBeTruthy()
  })

  it('does not exclude an active scan lease or offer another upload into an occupied category', async () => {
    const current = snapshot('PENDING_SCAN')
    current.files = [{ id: ids[0], revision_id: revision, kind: 'MEMORANDUM', title: 'Active exact scan', sha256: 'a'.repeat(64), size: 40,
      validation_state: 'QUARANTINED', uploaded_at: '2026-10-12T00:00:00Z', can_download: true, intent_state: 'PENDING',
      processing_state: 'LEASED', clean_receipt_id: null, selected: false }]
    fetcher.mockResolvedValue(reply(current))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    const reason = await screen.findByLabelText(/^Intent resolution reason/)
    fireEvent.change(reason, { target: { value: 'An active scan must not be excluded by a manager while it holds the lease.' } })
    expect((screen.getByRole('button', { name: 'Exclude this intent with reason' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Stage in quarantine' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/already has an immutable intent/)).toBeTruthy()
  })

  it('retains the same PDF/category/title after an unknown upload and prohibits replacement actions', async () => {
    const uploads: FormData[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') { uploads.push(options.body); throw new Error('Upload outcome unknown') }
      return reply(snapshot('PENDING_SCAN'))
    })
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    const input = await screen.findByLabelText(/Private PDF/)
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7\nfictional bytes'], 'fixture.pdf', { type: 'application/pdf' })] } })
    fireEvent.change(screen.getByLabelText('File title'), { target: { value: 'Retained exact fictional PDF' } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    await screen.findByText('Upload requires reconciliation')
    expect(uploads).toHaveLength(1)
    expect(screen.queryByLabelText(/Private PDF/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same PDF bytes' }))
    await waitFor(() => expect(uploads).toHaveLength(2))
    expect(uploads[0].get('title')).toBe(uploads[1].get('title'))
    expect(uploads[0].get('kind')).toBe(uploads[1].get('kind'))
    expect(uploads[0].get('file')).toEqual(uploads[1].get('file'))
  })

  it('stages an admitted exact PDF and reads back queued processing without claiming a clean verdict', async () => {
    const file = new File(['%PDF-1.7\nfictional exact bytes'], 'fixture.pdf', { type: 'application/pdf' })
    const receipt = { id: ids[0], revision_id: revision, kind: 'MEMORANDUM', title: 'Exact admitted PDF',
      sha256: 'a'.repeat(64), size: file.size, validation_state: 'QUARANTINED', uploaded_at: '2026-10-12T00:00:00Z' }
    let registered = false
    const uploads: FormData[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        uploads.push(options.body)
        expect(options.headers).toMatchObject({ 'x-bx1-operating-context': JSON.stringify(context), 'x-bx1-expected-actor': actorId })
        expect(options.body.get('file')).toEqual(file)
        expect(options.body.get('title')).toBe(receipt.title)
        registered = true
        return reply({ document: receipt }, 202)
      }
      const current = snapshot('PENDING_SCAN')
      if (registered) current.files = [{ ...receipt, kind: 'MEMORANDUM', validation_state: 'QUARANTINED', can_download: true,
        intent_state: 'PENDING', processing_state: 'QUEUED', clean_receipt_id: null, selected: false }]
      return reply(current)
    })
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    const input = await screen.findByLabelText(/Private PDF/)
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('File title'), { target: { value: receipt.title } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    await screen.findByText(/Exact PDF bytes registered in quarantine/)
    expect(uploads).toHaveLength(1)
    expect(uploads[0].get('file')).toEqual(file)
    expect(uploads[0].get('kind')).toBe('MEMORANDUM')
    expect(uploads[0].get('title')).toBe(receipt.title)
    expect(uploads[0].get('product_id')).toBe(product.id)
    expect(uploads[0].get('revision_id')).toBe(revision)
    expect(screen.getByText(/pending · queued/)).toBeTruthy()
    expect(screen.queryByText('Upload requires reconciliation')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Seal exact three-PDF manifest' })).toBeNull()
  })

  it('resuming a saved intent rejects different bytes locally without attempting a replacement upload', async () => {
    const current = snapshot('PENDING_SCAN')
    current.files = [{ id: ids[0], revision_id: revision, kind: 'MEMORANDUM', title: 'Exact reserved title', sha256: 'a'.repeat(64), size: 40,
      validation_state: 'QUARANTINED', uploaded_at: null, can_download: false, intent_state: 'PENDING', processing_state: null,
      clean_receipt_id: null, selected: false }]
    fetcher.mockResolvedValue(reply(current))
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Select memorandum reservation to resume' }))
    const file = new File(['%PDF-1.7\ndifferent bytes'], 'changed.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('%PDF-1.7\ndifferent bytes').buffer })
    const input = screen.getByLabelText(/Private PDF/)
    fireEvent.change(input, { target: { files: [file] } })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    await screen.findByText(/Resume requires the exact reserved PDF bytes/)
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect((screen.getByLabelText('File title') as HTMLInputElement).value).toBe('Exact reserved title')
  })

  it('does not carry a prior actor/context capability through an account switch', async () => {
    fetcher.mockResolvedValue(reply(snapshot('PENDING_SCAN')))
    const mounted = render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await screen.findByRole('button', { name: 'Stage in quarantine' })
    mounted.rerender(<OfferingFilePanel product={product} context={context} actorId={ids[0]} />)
    expect(screen.queryByRole('button', { name: 'Stage in quarantine' })).toBeNull()
    await screen.findByText('Document authority unavailable')
  })

  it('restores the exact saved document request after remount instead of generating a new key', async () => {
    const current = snapshot('PENDING_SCAN')
    current.files = [{ id: ids[0], revision_id: revision, kind: 'MEMORANDUM', title: 'Abandoned reservation', sha256: 'a'.repeat(64), size: 40,
      validation_state: 'QUARANTINED', uploaded_at: null, can_download: false, intent_state: 'PENDING', processing_state: null,
      clean_receipt_id: null, selected: false }]
    const requests: unknown[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'PUT') { requests.push(JSON.parse(options.body)); throw new Error('Unknown delivery') }
      return reply(current)
    })
    const page = render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    fireEvent.change(await screen.findByLabelText(/^Intent resolution reason/), { target: { value: 'Retain exact request identity for this abandoned immutable intent.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this intent with reason' }))
    await screen.findByText('Document action requires reconciliation')
    expect(sessionStorage.length).toBe(1)
    page.unmount()
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry the same document request' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('button', { name: 'Exclude this intent with reason' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same document request' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0]).toEqual(requests[1])
  })

  function pendingResolutionSnapshot(): OfferingDocumentSnapshot {
    const current = snapshot('PENDING_SCAN')
    current.files = [{ id: ids[0], revision_id: revision, kind: 'MEMORANDUM', title: 'Abandoned reservation', sha256: 'a'.repeat(64), size: 40,
      validation_state: 'QUARANTINED', uploaded_at: null, can_download: false, intent_state: 'PENDING', processing_state: null,
      clean_receipt_id: null, selected: false }]
    return current
  }
  function definiteRollback(command: OfferingDocumentCommand) {
    return { outcome: 'DEFINITE_ROLLBACK', reason: 'STALE_PRODUCT_REVISION', effects: 'NONE', code: '23514',
      command: command.command, key: command.key, actor_id: actorId, product_id: product.id, revision_id: revision,
      expected_revision: command.payload.expected_revision, context,
      payload_sha256: createHash('sha256').update(offeringDocumentPayloadText(command)).digest('hex') }
  }

  it('reconciles exact fresh-stale rollback with no effects, then requires a parent revision refresh before a new key/payload', async () => {
    const current = pendingResolutionSnapshot(), requests: OfferingDocumentCommand[] = []
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'PUT') {
        const command = JSON.parse(options.body).request as OfferingDocumentCommand
        requests.push(command)
        if (requests.length === 1) return reply({ error: 'Fresh product revision was stale; exact invocation rolled back.', rollback: definiteRollback(command) }, 409)
        return reply({ ...current, state: 'REJECTED_OR_EXCLUDED', files: [{ ...current.files[0], intent_state: 'EXCLUDED' }] })
      }
      return reply(current)
    })
    const page = render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    fireEvent.change(await screen.findByLabelText(/^Intent resolution reason/), { target: { value: 'First fresh action uses the earlier product revision before concurrent review.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this intent with reason' }))
    await screen.findByText('Fresh request rolled back; revision refresh required')
    await waitFor(() => expect(sessionStorage.length).toBe(0))
    expect(screen.queryByRole('button', { name: 'Retry the same document request' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exclude this intent with reason' })).toBeNull()
    expect(requests).toHaveLength(1)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh processing state' }) as HTMLButtonElement).disabled).toBe(false))
    page.rerender(<OfferingFilePanel product={{ ...product, revision: 4 }} context={context} actorId={actorId} />)
    expect(screen.queryByText('Fresh request rolled back; revision refresh required')).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Intent resolution reason/), { target: { value: 'New user-initiated action after saved parent state refreshed to revision four.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this intent with reason' }))
    await screen.findByText(/Intent resolution recorded/)
    expect(requests).toHaveLength(2)
    expect(requests[0].payload.expected_revision).toBe(3)
    expect(requests[1].payload.expected_revision).toBe(4)
    expect(requests[1].key).not.toBe(requests[0].key)
    expect(requests[1].payload).not.toEqual(requests[0].payload)
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['missing', 'wrong-key', 'wrong-hash', 'wrong-actor', 'wrong-context', 'generic503'] as const)('retains original unknown request for %s rollback-shaped failure', async failure => {
    const current = pendingResolutionSnapshot()
    fetcher.mockImplementation(async (_url, options) => {
      if (options?.method === 'PUT') {
        const command = JSON.parse(options.body).request as OfferingDocumentCommand
        const rollback = definiteRollback(command)
        if (failure === 'wrong-key') rollback.key = ids[1]
        if (failure === 'wrong-hash') rollback.payload_sha256 = 'b'.repeat(64)
        if (failure === 'wrong-actor') rollback.actor_id = ids[1]
        if (failure === 'wrong-context') rollback.context = { ...context, organisationId: ids[1] }
        return reply({ error: 'The original command outcome could not be reconciled.', ...(failure === 'missing' ? {} : { rollback }) }, failure === 'generic503' ? 503 : 409)
      }
      return reply(current)
    })
    render(<OfferingFilePanel product={product} context={context} actorId={actorId} />)
    fireEvent.change(await screen.findByLabelText(/^Intent resolution reason/), { target: { value: 'The unknown command must retain its original complete request identity.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude this intent with reason' }))
    await screen.findByText('Document action requires reconciliation')
    expect(sessionStorage.length).toBe(1)
    expect(screen.queryByText('Fresh request rolled back; revision refresh required')).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Retry the same document request' }) as HTMLButtonElement).disabled).toBe(false))
  })
})
