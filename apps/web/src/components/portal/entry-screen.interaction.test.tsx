// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LegacyApplicationDetails } from '@/lib/portal/contracts'
import { entrySnapshotSchema, type EntrySnapshot } from '@/lib/portal/entry-contracts'
import { entryActorId, entryApplication, entryFixture, entryHandoff } from '@/lib/portal/entry-test-fixtures'

vi.mock('next/image', () => ({ default: (props: { src: string; alt: string }) => createElement('img', { src: props.src, alt: props.alt }) }))
// Provider evidence and its SDK are outside this isolated React state-retention
// proof. No provider session, consent, document download or external call occurs.
vi.mock('./kyc-verification', () => ({ KycVerification: () => null }))
import { EntryScreen } from './entry-screen'

const release = { version: 'interaction-fixture', environment: 'TESTNET' as const, source: 'synthetic-fixture' }
const details: LegacyApplicationDetails = {
  full_name: 'Alex Saved Example', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
  source_of_funds: 'Fictional savings from synthetic employment income.', beneficial_owners: '',
  experience: 'Fictional long-term investment experience and objectives.',
  documents: [{ id: '44444444-4444-4444-8444-444444444444', kind: 'IDENTITY', title: 'Fictional identity evidence',
    storage_path: `${entryActorId}/synthetic-identity.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }],
  test_data_acknowledged: true,
}
const markerStorageKey = `bx1-entry:TESTNET:${entryActorId}:pending-request`
const pendingMarker = JSON.stringify({ key: '99999999-9999-4999-8999-999999999999', command: 'submit_application', hash: 'b'.repeat(64) })

function missingReviewerSnapshot(): EntrySnapshot {
  const application = entryApplication({ review_route: 'REVIEWER_UNAVAILABLE', details })
  return entrySnapshotSchema.parse(entryFixture([{ ...application, handoff: entryHandoff(application) }]))
}
function reviewerAvailable(initial: EntrySnapshot, revision = initial.applications[0].revision): EntrySnapshot {
  const application = { ...initial.applications[0], review_route: 'AVAILABLE' as const, revision }
  return entrySnapshotSchema.parse({ ...initial, applications: [{ ...application, handoff: entryHandoff(application) }] })
}
function isolatedEntryRead(next: EntrySnapshot) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input !== '/api/portal/entry' || (init?.method ?? 'GET') !== 'GET') throw new Error('Unexpected network request in isolated entry-screen interaction proof.')
    return new Response(JSON.stringify({ snapshot: next }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
function prepareUnsavedAnswers() {
  const fullName = screen.getByLabelText(/^Full name/) as HTMLInputElement
  const acknowledgement = screen.getByRole('checkbox', { name: /I confirm this application and all evidence are fictional test data/ }) as HTMLInputElement
  fireEvent.change(fullName, { target: { value: 'Alex Unsaved Browser Revision' } })
  fireEvent.click(acknowledgement)
  expect(fullName.value).toBe('Alex Unsaved Browser Revision')
  expect(acknowledgement.checked).toBe(true)
  return { fullName, acknowledgement }
}

beforeEach(() => { sessionStorage.clear(); sessionStorage.setItem(markerStorageKey, pendingMarker) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('real entry-screen review-availability interaction', () => {
  it('preserves typed answers and acknowledgement while the same saved revision regains submission availability', async () => {
    const initial = missingReviewerSnapshot()
    const fetchMock = isolatedEntryRead(reviewerAvailable(initial))
    render(createElement(EntryScreen, { initial, release }))
    expect((screen.getByRole('button', { name: 'Submission unavailable; review route required' }) as HTMLButtonElement).disabled).toBe(true)
    const { fullName, acknowledgement } = prepareUnsavedAnswers()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh review availability' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(false))

    // Node identity also proves the form was not remounted during the read.
    expect(screen.getByLabelText(/^Full name/)).toBe(fullName)
    expect(fullName.value).toBe('Alex Unsaved Browser Revision')
    expect(screen.getByRole('checkbox', { name: /I confirm this application and all evidence are fictional test data/ })).toBe(acknowledgement)
    expect(acknowledgement.checked).toBe(true)
    expect((screen.getByLabelText('Investor classification') as HTMLSelectElement).value).toBe('INDIVIDUAL')
    expect(screen.getByText(/Your browser answers are retained; nothing was submitted/)).toBeTruthy()
    expect(screen.getByText(/Saved record: revision 1/)).toBeTruthy()
    expect(sessionStorage.getItem(markerStorageKey)).toBe(pendingMarker)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/portal/entry', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-bx1-expected-actor': entryActorId } }))
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('refuses a changed saved revision without replacing typed answers, acknowledgement or the pending request marker', async () => {
    const initial = missingReviewerSnapshot()
    const fetchMock = isolatedEntryRead(reviewerAvailable(initial, 2))
    render(createElement(EntryScreen, { initial, release }))
    const { fullName, acknowledgement } = prepareUnsavedAnswers()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh review availability' }))
    await waitFor(() => expect(screen.getByText(/The saved application changed\. Your browser answers were retained/)).toBeTruthy())

    expect(screen.getByLabelText(/^Full name/)).toBe(fullName)
    expect(fullName.value).toBe('Alex Unsaved Browser Revision')
    expect(acknowledgement.checked).toBe(true)
    expect((screen.getByRole('button', { name: 'Submission unavailable; review route required' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull()
    expect(screen.getByText(/Saved record: revision 1/)).toBeTruthy()
    expect(sessionStorage.getItem(markerStorageKey)).toBe(pendingMarker)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })
})
