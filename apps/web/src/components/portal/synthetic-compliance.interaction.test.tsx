// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalApplication, type PortalSnapshot } from '@/lib/portal/contracts'
import type { PlatformRelease } from '@/lib/platform-release'
import type { PortalOperatingContext } from '@/lib/portal/operating-context'
import { parseSyntheticComplianceSnapshot } from '@/lib/portal/synthetic-compliance-contracts'

// Real screen, form, state updates and evidence components. Only the command
// boundary and vendor iframe are replaced with fixtures; no hosted, SQL,
// provider, scanner, MFA-completion or independent-human acceptance is proved.
const proof = vi.hoisted(() => ({
  submit: vi.fn(), result: undefined as PortalSnapshot | undefined,
  applicationReview: vi.fn(), privateDocument: vi.fn(), documentHistory: vi.fn(),
  providerEvidence: vi.fn(), monitoringDecision: vi.fn(), monitoringQueue: vi.fn(),
  appointmentQueue: vi.fn(), busy: false, unknown: false,
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('./portal-client', async importOriginal => ({
  ...await importOriginal<typeof import('./portal-client')>(),
  usePortalCommand: (onSaved: (snapshot: PortalSnapshot) => void) => ({
    busy: proof.busy, unknown: proof.unknown, message: '', retry: vi.fn(),
    submit: async (command: string, payload: Record<string, unknown>) => {
      proof.submit(command, payload)
      if (!proof.result) return false
      onSaved(proof.result)
      return true
    },
  }),
}))
vi.mock('./portal-workflows', async importOriginal => {
  const original = await importOriginal<typeof import('./portal-workflows')>()
  return { ...original, ApplicationReview: (props: React.ComponentProps<typeof original.ApplicationReview>) => {
    proof.applicationReview(props)
    return React.createElement(original.ApplicationReview, props)
  } }
})
vi.mock('./onboarding-form', async importOriginal => {
  const original = await importOriginal<typeof import('./onboarding-form')>()
  return { ...original,
    PrivateDocument: (props: React.ComponentProps<typeof original.PrivateDocument>) => {
      proof.privateDocument(props)
      return React.createElement(original.PrivateDocument, props)
    },
    ApplicationDocumentHistory: (props: React.ComponentProps<typeof original.ApplicationDocumentHistory>) => {
      proof.documentHistory(props)
      return React.createElement(original.ApplicationDocumentHistory, props)
    },
  }
})
vi.mock('./kyc-verification', async importOriginal => {
  const original = await importOriginal<typeof import('./kyc-verification')>()
  return { ...original, ProviderEvidenceReview: (props: React.ComponentProps<typeof original.ProviderEvidenceReview>) => {
    proof.providerEvidence(props)
    return React.createElement(original.ProviderEvidenceReview, props)
  } }
})
vi.mock('./customer-monitoring', async importOriginal => {
  const original = await importOriginal<typeof import('./customer-monitoring')>()
  return { ...original,
    CustomerMonitoringDecision: (props: React.ComponentProps<typeof original.CustomerMonitoringDecision>) => {
      proof.monitoringDecision(props)
      return React.createElement(original.CustomerMonitoringDecision, props)
    },
    CustomerMonitoringQueue: (props: React.ComponentProps<typeof original.CustomerMonitoringQueue>) => {
      proof.monitoringQueue(props)
      return React.createElement(original.CustomerMonitoringQueue, props)
    },
  }
})
vi.mock('./product-service-appointments', async importOriginal => {
  const original = await importOriginal<typeof import('./product-service-appointments')>()
  return { ...original, ProductAppointmentQueue: (props: React.ComponentProps<typeof original.ProductAppointmentQueue>) => {
    proof.appointmentQueue(props)
    return React.createElement(original.ProductAppointmentQueue, props)
  } }
})
import { PortalScreen } from './portal-screens'

const reviewer = '11111111-1111-4111-8111-111111111111'
const applicant = '22222222-2222-4222-8222-222222222222'
const applicationId = '33333333-3333-4333-8333-333333333333'
const organisationId = '44444444-4444-4444-8444-444444444444'
const documentId = '55555555-5555-4555-8555-555555555555'
const requestKey = '66666666-6666-4666-8666-666666666666'
const eventId = '77777777-7777-4777-8777-777777777777'
const reviewContext: PortalOperatingContext = { mode: 'ROLE', organisationId, role: 'ComplianceOfficer' }
const release: PlatformRelease = { version: 'mounted-rehearsal-fixture', environment: 'TESTNET', source: 'synthetic-fixture' }
const decisions = ['CHANGES_REQUIRED', 'REJECTED', 'APPROVED'] as const
type Decision = typeof decisions[number]

function syntheticSnapshot(): PortalSnapshot {
  return {
    rehearsal: { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: reviewer, operating_context: reviewContext },
    actor: { id: reviewer, email: 'reviewer@example.invalid', display_name: null, can_review: true },
    operating_context: reviewContext,
    applications: [{
      id: applicationId, user_id: applicant, persona: 'INVESTOR', status: 'SUBMITTED', revision: 2,
      details: { full_name: 'Fictional Applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Synthetic savings for this rehearsal only.', beneficial_owners: '', experience: 'Fictional experienced investor.',
        documents: [{ id: documentId, kind: 'IDENTITY', title: 'Fictional identity manifest', storage_path: `${applicant}/${documentId}`,
          sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' }], test_data_acknowledged: true },
      submitted_at: '2026-10-10T12:00:00Z', reviewed_at: null, reviewer_id: null, review_notes: null,
      organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: null,
      admission_purpose: 'INVESTOR_ADMISSION',
    }],
    organisations: [], products: [], subscriptions: [], events: [], requests: [],
  }
}
function checkedSnapshot(value: PortalSnapshot): PortalSnapshot {
  const parsed = parseSyntheticComplianceSnapshot(value, reviewer, reviewContext)
  expect(parsed).not.toBeNull()
  return parsed!
}
function savedSnapshot(decision: Decision, rationale: string): PortalSnapshot {
  const initial = syntheticSnapshot()
  return checkedSnapshot({ ...initial,
    applications: [{ ...initial.applications[0], revision: 3, status: decision, reviewer_id: reviewer,
      review_notes: rationale, reviewed_at: '2026-10-10T12:30:00Z', approved_until: decision === 'APPROVED' ? '2099-01-01T00:00:00Z' : null,
      review_checks: { identity: decision === 'APPROVED', ownership: decision === 'APPROVED', screening: decision === 'APPROVED', suitability: decision === 'APPROVED' } }],
    events: [{ id: eventId, subject_id: applicationId, kind: 'review_application', actor_id: reviewer,
      created_at: '2026-10-10T12:30:00Z', summary: `Synthetic ${decision} decision recorded for revision 2.` }],
    requests: [{ key: requestKey, command: 'review_application' }],
  })
}
function reviewScreen(value: PortalSnapshot, change: Partial<React.ComponentProps<typeof PortalScreen>> = {}) {
  return <PortalScreen data={{ user: { id: reviewer, email: 'reviewer@example.invalid' }, snapshot: value }}
    view="/portal/compliance/detail" id={applicationId} operatingContext={reviewContext} release={release} {...change} />
}
function expectNoProtectedComponents() {
  for (const spy of [proof.privateDocument, proof.documentHistory, proof.providerEvidence,
    proof.monitoringDecision, proof.monitoringQueue, proof.appointmentQueue]) expect(spy).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /View document|View submitted versions|Refresh signed provider evidence|Record monitoring decision/ })).toBeNull()
  expect(screen.queryByRole('heading', { name: /Private supporting evidence|Provider identity evidence|Submitted evidence history|Ongoing customer monitoring|Customer monitoring and restrictions/ })).toBeNull()
  expect(document.querySelector('input[type="file"]')).toBeNull()
  expect(globalThis.fetch).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  proof.result = undefined
  proof.busy = false; proof.unknown = false
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network request is authorised by this mounted synthetic-Compliance proof.') }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('mounted synthetic Compliance admission review', () => {
  it.each(decisions)('records %s against the displayed saved revision and refreshes read-only', async decision => {
    const rationale = `Fictional admission evidence reviewed; ${decision} is the recorded synthetic decision.`
    const result = savedSnapshot(decision, rationale)
    proof.result = result
    const mounted = render(reviewScreen(checkedSnapshot(syntheticSnapshot())))
    expect(proof.applicationReview).toHaveBeenCalled()
    expect(screen.getByText('Synthetic Compliance rehearsal')).toBeTruthy()
    expect(screen.getByText('Synthetic evidence manifests')).toBeTruthy()
    expect(screen.getByText('Fictional identity manifest')).toBeTruthy()
    expect(screen.getByText('Revision 2')).toBeTruthy()
    for (const label of ['Fictional submitted identity facts and manifest reviewed', 'Disclosed fictional ownership / authority facts reviewed', 'Manual synthetic screening recorded', 'Declared fictional service / suitability facts reviewed']) expect(screen.getByLabelText(label)).toBeTruthy()
    expect(screen.queryByLabelText('Identity evidence reviewed')).toBeNull()
    expect(screen.queryByLabelText('Ownership / authority reviewed')).toBeNull()
    expectNoProtectedComponents()

    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: decision } })
    fireEvent.change(screen.getByLabelText(/^Review rationale/), { target: { value: rationale } })
    if (decision === 'APPROVED') {
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(4)
      for (const checkbox of checkboxes) fireEvent.click(checkbox)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Record review decision' }))
    await waitFor(() => expect(screen.getByText('Revision 3')).toBeTruthy())
    const payload = { application_id: applicationId, expected_revision: 2, decision, notes: rationale,
      checks: { identity: decision === 'APPROVED', ownership: decision === 'APPROVED', screening: decision === 'APPROVED', suitability: decision === 'APPROVED' } }
    expect(proof.submit.mock.calls).toEqual([['review_application', payload]])
    expect(portalCommandSchema.safeParse({ command: 'review_application', key: requestKey, payload }).success).toBe(true)
    expect(screen.getByText(rationale)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record review decision' })).toBeNull()
    expect(screen.queryByLabelText('Decision')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(applicationId)).toBeTruthy()
    expectNoProtectedComponents()

    // A fresh mount represents the hosted page refresh; same-identity prop
    // rerender alone would retain OperatingPortalScreen's existing local state.
    mounted.unmount()
    render(reviewScreen(result))
    expect(screen.getByText('Revision 3')).toBeTruthy()
    expect(screen.getByText(rationale)).toBeTruthy()
    expect(screen.getByText(applicationId)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record review decision' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(proof.submit).toHaveBeenCalledTimes(1)
    expectNoProtectedComponents()
  })

  it.each(['/portal', '/portal/compliance'] as const)('keeps all saved statuses inspectable in %s without advanced operating panels', view => {
    const value = syntheticSnapshot()
    const statuses = ['SUBMITTED', ...decisions] as const
    value.applications = statuses.map((status, index): PortalApplication => ({ ...value.applications[0],
      id: `${(index + 8).toString(16)}8888888-8888-4888-8888-888888888888`, status,
      details: { ...value.applications[0].details, full_name: `Fictional ${status} applicant` },
      reviewed_at: status === 'SUBMITTED' ? null : '2026-10-10T12:30:00Z', reviewer_id: status === 'SUBMITTED' ? null : reviewer,
      review_notes: status === 'SUBMITTED' ? null : 'Fictional admission facts reviewed for this synthetic decision.',
      approved_until: status === 'APPROVED' ? '2099-01-01T00:00:00Z' : null,
      review_checks: { identity: true, ownership: true, screening: true, suitability: true },
    }))
    render(reviewScreen(checkedSnapshot(value), { view, id: undefined }))
    expect(screen.getByText('Synthetic Compliance rehearsal')).toBeTruthy()
    for (const status of statuses) expect(screen.getByText(`Fictional ${status} applicant`)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Review case' })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: 'Inspect saved decision' })).toHaveLength(3)
    expect(proof.applicationReview).not.toHaveBeenCalled()
    expect(proof.submit).not.toHaveBeenCalled()
    expectNoProtectedComponents()
  })

  it('does not expand to the full review surface if a returned snapshot loses its rehearsal marker', async () => {
    const value = syntheticSnapshot()
    proof.result = { ...savedSnapshot('CHANGES_REQUIRED', 'Clarify the fictional submitted source-of-funds facts.'), rehearsal: undefined }
    render(reviewScreen(value))
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'CHANGES_REQUIRED' } })
    fireEvent.change(screen.getByLabelText(/^Review rationale/), { target: { value: 'Clarify the fictional submitted source-of-funds facts.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record review decision' }))
    await waitFor(() => expect(screen.getByText('Synthetic review state unavailable')).toBeTruthy())
    expect(screen.queryByText('Fictional Applicant')).toBeNull()
    expectNoProtectedComponents()
  })

  it.each(['busy', 'unknown'] as const)('does not dispatch another synthetic review while %s', state => {
    proof[state] = true
    render(reviewScreen(syntheticSnapshot()))
    fireEvent.submit(screen.getByRole('button', { name: 'Record review decision' }).closest('form')!)
    expect(proof.submit).not.toHaveBeenCalled()
    expectNoProtectedComponents()
  })

  it.each(['actor', 'marker actor', 'organisation', 'MAINNET', 'missing release', 'protected path', 'unknown case'] as const)(
    'mounts no review or protected evidence components for invalid %s', failure => {
      const value = syntheticSnapshot()
      const change: Partial<React.ComponentProps<typeof PortalScreen>> = {}
      if (failure === 'actor') change.data = { user: { id: applicant, email: 'applicant@example.invalid' }, snapshot: value }
      if (failure === 'marker actor') value.rehearsal = { ...value.rehearsal!, actor_id: applicant }
      if (failure === 'organisation') change.operatingContext = { ...reviewContext, organisationId: applicant }
      if (failure === 'MAINNET') change.release = { ...release, environment: 'MAINNET' }
      if (failure === 'missing release') change.release = undefined
      if (failure === 'protected path') change.view = '/portal/products'
      if (failure === 'unknown case') change.id = documentId
      render(reviewScreen(value, change))
      expect(screen.getByText('Synthetic review state unavailable')).toBeTruthy()
      expect(screen.queryByText('Fictional Applicant')).toBeNull()
      expect(screen.queryByText('Fictional identity manifest')).toBeNull()
      expect(proof.applicationReview).not.toHaveBeenCalled()
      expect(proof.submit).not.toHaveBeenCalled()
      expectNoProtectedComponents()
    },
  )
})
