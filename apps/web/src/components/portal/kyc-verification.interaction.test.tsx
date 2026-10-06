// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortalSnapshot } from '@/lib/portal/contracts'
import type { EntryApplication } from '@/lib/portal/entry-contracts'
import { entryActorId, entryApplication, entryApplicationId, entryOrganisationId } from '@/lib/portal/entry-test-fixtures'
import { APPLICANT_CONTEXT, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { PortalCommandProvider } from './portal-client'

// Mount the real portal component and real account/context providers. Only the
// external vendor iframe is replaced; all HTTP responses are synthetic fixtures.
vi.mock('next/dynamic', () => ({ default: () => (props: { accessToken: string }) => createElement('div', {
  'data-testid': 'sandbox-sdk', 'data-synthetic-token': props.accessToken,
}) }))
import { KycVerification, ProviderEvidenceReview } from './kyc-verification'

const submitted = () => entryApplication({ status: 'SUBMITTED', revision: 3, submitted_at: '2026-10-07T10:00:00Z',
  details: { full_name: 'Synthetic Applicant', country: 'ZA', investor_type: 'INDIVIDUAL' }, review_route: 'AVAILABLE' })
const otherActor = '55555555-5555-4555-8555-555555555555'
const reviewerContext: PortalOperatingContext = { mode: 'ROLE', organisationId: entryOrganisationId, role: 'ComplianceOfficer' }
function Scope({ children, actor = entryActorId, context = APPLICANT_CONTEXT }: {
  children: ReactNode; actor?: string; context?: PortalOperatingContext
}) {
  // The provider consumes only actor.id/requests; no business authority is fabricated.
  const snapshot = { actor: { id: actor }, requests: [] } as unknown as PortalSnapshot
  return <PortalCommandProvider snapshot={snapshot} operatingContext={context} environment="TESTNET">{children}</PortalCommandProvider>
}
function applicant(application = submitted(), actor = entryActorId, context = APPLICANT_CONTEXT) {
  return <Scope actor={actor} context={context}><KycVerification application={application} actorId={entryActorId}
    environment="TESTNET" sandboxEnabled /></Scope>
}
function reviewer(applicationId = entryApplicationId, revision = 3, actor = entryActorId, context = reviewerContext) {
  return <Scope actor={actor} context={context}><ProviderEvidenceReview applicationId={applicationId} revision={revision} environment="TESTNET" /></Scope>
}
function event(overrides: Record<string, unknown> = {}) {
  return { id: 'f1111111-1111-4111-8111-111111111111', application_id: entryApplicationId, application_revision: 3,
    environment: 'TESTNET', event_type: 'applicantReviewed', event_at: '2026-10-07T10:01:00Z', received_at: '2026-10-07T10:01:01Z',
    ordering_state: 'CURRENT', manual_webhook_test: false, review_status: 'completed', review_answer: 'GREEN', review_reject_type: null,
    applicant_type: 'individual', level_name: 'Synthetic-Exact-Level', evidence_kind: 'COMPLETED_REVIEW', projection_state: 'EFFECTIVE', ...overrides }
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }
function evidence(applicationId: string, events: unknown[]) { return json({ application_id: applicationId, events }) }
function token(application: EntryApplication = submitted()) { return json({ token: 'synthetic-bound-sdk-token', expires_in_seconds: 600,
  level_name: 'Synthetic-Exact-Level', application_id: application.id, application_revision: application.revision, environment: 'TESTNET' }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function serveEvents(events: unknown[]) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.startsWith('/api/portal/kyc/evidence?')) throw new Error('Unexpected network request in mounted provider fixture.')
    return evidence(new URL(url, 'https://synthetic.invalid').searchParams.get('application_id')!, events)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('mounted revision-bound provider evidence', () => {
  it.each([
    ['applicantPending', 'Provider review pending'], ['applicantReset', 'Provider verification reset'],
    ['applicantDeactivated', 'Provider verification inactive'], ['applicantDeleted', 'Provider verification deleted'],
  ])('replaces an old GREEN with effective %s in both applicant and reviewer views', async (eventType, label) => {
    const events = [event({ projection_state: 'SUPERSEDED', ordering_state: 'STALE' }),
      event({ id: 'f2222222-2222-4222-8222-222222222222', event_type: eventType, evidence_kind: 'LIFECYCLE',
        event_at: '2026-10-07T10:02:00Z' })]
    serveEvents(events)
    const mounted = render(applicant())
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    expect(screen.queryByText('Provider answer only')).toBeNull()
    expect(screen.getByText(/Provider evidence history \(2\)/)).toBeTruthy()
    if (['applicantDeactivated', 'applicantDeleted'].includes(eventType))
      expect(screen.getByText(/Contact the provider\/reviewer\. This genuine lifecycle event invalidates/)).toBeTruthy()
    mounted.unmount()
    render(reviewer())
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    expect(screen.queryByText('Provider answer only')).toBeNull()
  })

  it.each(['applicantDeactivated', 'applicantDeleted'])('retains genuine GREEN when later %s is only a manual simulation', async eventType => {
    serveEvents([event(), event({ id: 'f2222222-2222-4222-8222-222222222222', event_type: eventType,
      event_at: '2026-10-07T10:03:00Z', evidence_kind: 'LIFECYCLE', projection_state: 'MANUAL_TEST',
      manual_webhook_test: true, ordering_state: 'MANUAL_TEST' })])
    render(applicant())
    await waitFor(() => expect(screen.getByText('Provider review completed: GREEN - independent BlockXOne review required')).toBeTruthy())
    expect(screen.getByText('Sandbox simulation only')).toBeTruthy()
    expect(screen.queryByText(/^Provider verification (inactive|deleted)$/)).toBeNull()
    expect(screen.getByText(/Await independent BlockXOne review/)).toBeTruthy()
  })

  it('shows tied conflict events explicitly and suppresses completed review even when a GREEN snapshot exists', async () => {
    serveEvents([event({ projection_state: 'CONFLICT', ordering_state: 'STALE' }),
      event({ id: 'f2222222-2222-4222-8222-222222222222', event_type: 'applicantPending',
        evidence_kind: 'LIFECYCLE', projection_state: 'CONFLICT', ordering_state: 'STALE' })])
    render(reviewer())
    await waitFor(() => expect(screen.getByText('Provider evidence conflict - no effective completed review')).toBeTruthy())
    expect(screen.getByText(/later unambiguous signed event is required/)).toBeTruthy()
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    expect(screen.queryByText('Provider answer only')).toBeNull()
    expect(screen.getAllByText('CONFLICT')).toHaveLength(2)
  })

  it.each([
    ['applicantOnHold', 'Provider review on hold'], ['applicantAwaitingUser', 'Provider is awaiting your evidence'],
    ['applicantActivated', 'Provider verification in progress - no completed review'],
  ])('renders %s as lifecycle even with completed/GREEN provider snapshot fields', async (eventType, label) => {
    serveEvents([event({ event_type: eventType, evidence_kind: 'LIFECYCLE' })])
    render(applicant())
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    expect(screen.queryByText('Provider answer only')).toBeNull()
  })

  it.each(['RETRY', 'FINAL'])('displays completed RED %s with the provider-specific next owner', async reject => {
    serveEvents([event({ review_answer: 'RED', review_reject_type: reject })])
    render(reviewer())
    await waitFor(() => expect(screen.getByText(new RegExp(`Provider review completed: RED ${reject}`))).toBeTruthy())
    expect(screen.getByText(reject === 'RETRY'
      ? /Complete or resubmit the requested provider evidence/ : /Contact the provider\/reviewer about the final provider result/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Record review decision/ })).toBeNull()
  })

  it('exposes normalized manual/legacy/stale history without current completion', async () => {
    serveEvents([event({ projection_state: 'REVISION_STALE', ordering_state: 'STALE', application_revision: 2 }),
      event({ id: 'f2222222-2222-4222-8222-222222222222', projection_state: 'LEGACY_UNQUALIFIED', ordering_state: 'STALE',
        evidence_kind: 'LEGACY_UNQUALIFIED', applicant_type: null, level_name: null }),
      event({ id: 'f3333333-3333-4333-8333-333333333333', projection_state: 'MANUAL_TEST', ordering_state: 'MANUAL_TEST', manual_webhook_test: true })])
    render(reviewer())
    await waitFor(() => expect(screen.getByText('Sandbox simulation received for this application revision')).toBeTruthy())
    expect(screen.getByText('REVISION_STALE')).toBeTruthy()
    expect(screen.getAllByText('LEGACY_UNQUALIFIED')).toHaveLength(2)
    expect(screen.getByText('Sandbox simulation only')).toBeTruthy()
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
  })

  it.each(['DRAFT', 'CHANGES_REQUIRED'] as const)('requires submission first for %s and offers no start action', async status => {
    const fetcher = serveEvents([])
    render(applicant(entryApplication({ status, revision: 3 })))
    await waitFor(() => expect(screen.getByText('No provider evidence received yet')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Start sandbox identity check' })).toBeNull()
    expect(screen.getByText(status === 'DRAFT' ? /Submit the application for review first/ : /Update and resubmit the application first/)).toBeTruthy()
    expect(fetcher.mock.calls.every(([input]) => String(input).startsWith('/api/portal/kyc/evidence?'))).toBe(true)
  })

  it('opens the SDK only after an actual start click and an exact application-bound token response', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/portal/kyc/session'
      ? token() : evidence(entryApplicationId, []))
    vi.stubGlobal('fetch', fetcher)
    render(applicant())
    await waitFor(() => expect(screen.getByText('No provider evidence received yet')).toBeTruthy())
    expect(screen.queryByTestId('sandbox-sdk')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start sandbox identity check' }))
    await waitFor(() => expect(screen.getByTestId('sandbox-sdk').getAttribute('data-synthetic-token')).toBe('synthetic-bound-sdk-token'))
    expect(fetcher).toHaveBeenCalledWith('/api/portal/kyc/session', expect.objectContaining({ method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bx1-expected-actor': entryActorId },
      body: JSON.stringify({ application_id: entryApplicationId, expected_revision: 3 }) }))
    expect(screen.getByText(/Completion is not an admission decision/)).toBeTruthy()
    expect(screen.queryByText(/Provider review completed:/)).toBeNull()
  })

  it('refuses a returned token for a different revision without mounting the SDK', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/portal/kyc/session'
      ? token({ ...submitted(), revision: 2 }) : evidence(entryApplicationId, [])))
    render(applicant())
    fireEvent.click(screen.getByRole('button', { name: 'Start sandbox identity check' }))
    await waitFor(() => expect(screen.getByText(/session did not match this application/)).toBeTruthy())
    expect(screen.queryByTestId('sandbox-sdk')).toBeNull()
  })

  it.each(['actor', 'context', 'application', 'revision', 'state', 'subject'])('drops a delayed token and old outcome after %s changes', async change => {
    const pending = deferred<Response>()
    let evidenceCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/portal/kyc/session') return pending.promise
      const applicationId = new URL(String(input), 'https://synthetic.invalid').searchParams.get('application_id')!
      evidenceCalls += 1
      return evidence(applicationId, evidenceCalls === 1 ? [event()] : [])
    }))
    const mounted = render(applicant())
    await waitFor(() => expect(screen.getByText(/Provider review completed: GREEN/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Start sandbox identity check' }))
    const changedApplication = change === 'application' ? { ...submitted(), id: entryOrganisationId }
      : change === 'revision' ? { ...submitted(), revision: 4 }
        : change === 'state' ? { ...submitted(), status: 'CHANGES_REQUIRED' as const }
          : change === 'subject' ? { ...submitted(), details: { ...submitted().details, investor_type: 'ENTITY' as const } } : submitted()
    mounted.rerender(applicant(changedApplication, change === 'actor' ? otherActor : entryActorId,
      change === 'context' ? reviewerContext : APPLICANT_CONTEXT))
    await act(async () => { pending.resolve(token()); await pending.promise })
    expect(screen.queryByTestId('sandbox-sdk')).toBeNull()
    expect(screen.queryByText(/Sandbox verification opened/)).toBeNull()
    if (change === 'actor' || change === 'context') {
      expect(screen.queryByRole('button', { name: 'Start sandbox identity check' })).toBeNull()
      expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    }
    if (change === 'application' || change === 'revision' || change === 'state' || change === 'subject') expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    if (change === 'state') expect(screen.queryByRole('button', { name: 'Start sandbox identity check' })).toBeNull()
  })

  it.each(['actor', 'context', 'application'])('removes an already mounted token when %s changes', async change => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/portal/kyc/session') return token()
      return evidence(new URL(String(input), 'https://synthetic.invalid').searchParams.get('application_id')!, [])
    }))
    const mounted = render(applicant())
    fireEvent.click(screen.getByRole('button', { name: 'Start sandbox identity check' }))
    await waitFor(() => expect(screen.getByTestId('sandbox-sdk')).toBeTruthy())
    mounted.rerender(applicant(change === 'application' ? { ...submitted(), id: entryOrganisationId } : submitted(),
      change === 'actor' ? otherActor : entryActorId, change === 'context' ? reviewerContext : APPLICANT_CONTEXT))
    expect(screen.queryByTestId('sandbox-sdk')).toBeNull()
    expect(screen.queryByText(/Sandbox verification opened/)).toBeNull()
  })

  it.each(['actor', 'context', 'application'])('discards a delayed reviewer outcome after %s changes', async change => {
    const pending = deferred<Response>()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls += 1
      const applicationId = new URL(String(input), 'https://synthetic.invalid').searchParams.get('application_id')!
      return calls === 1 ? pending.promise : evidence(applicationId, [])
    }))
    const mounted = render(reviewer())
    mounted.rerender(reviewer(change === 'application' ? entryOrganisationId : entryApplicationId, 3,
      change === 'actor' ? otherActor : entryActorId,
      change === 'context' ? { ...reviewerContext, organisationId: otherActor } : reviewerContext))
    await act(async () => { pending.resolve(evidence(entryApplicationId, [event()])); await pending.promise })
    await waitFor(() => expect(screen.getByText('No provider evidence received yet')).toBeTruthy())
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    expect(screen.queryByText('Provider answer only')).toBeNull()
  })

  it('clears previously completed display on refresh failure rather than retaining apparent clearance', async () => {
    const fetcher = serveEvents([event()])
    const mounted = render(reviewer())
    await waitFor(() => expect(screen.getByText(/Provider review completed: GREEN/)).toBeTruthy())
    fetcher.mockResolvedValueOnce(json({ error: 'synthetic unavailable' }, 503))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh signed provider evidence' }))
    await waitFor(() => expect(screen.getByText(/Do not infer a clear result while evidence is unavailable/)).toBeTruthy())
    expect(screen.queryByText(/Provider review completed: GREEN/)).toBeNull()
    mounted.unmount()
  })
})
