// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type PortalCommand, type PortalOfferingPackage, type PortalProduct, type PortalProductServiceAppointment, type PortalSnapshot, type ProductTerms } from '@/lib/portal/contracts'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { OFFERING_COMMANDS, type OfferingAccess } from '@/lib/portal/offering-access'
import type { PlatformRelease } from '@/lib/platform-release'
import { PortalScreen } from './portal-screens'
import { PortalCommandProvider, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import { fictionalProductTerms } from './product-form'
import { IssuerOfferingReview, ProductActions, ProductReview } from './portal-workflows'
import { ProductAppointmentDecision } from './product-service-appointments'

// Normal mounted UI and real durable command transport, with synthetic returned
// records. This is not hosted SQL, independent human, file, e-sign or chain proof.
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }))
vi.mock('./offering-file-panel', () => ({ OfferingFilePanel: () => <p>Private-file acceptance is outside this mounted fixture.</p> }))

const manager = '11111111-1111-4111-8111-111111111111'
const issuer = '22222222-2222-4222-8222-222222222222'
const appointmentReviewer = '33333333-3333-4333-8333-333333333333'
const admin = '44444444-4444-4444-8444-444444444444'
const productReviewer = '55555555-5555-4555-8555-555555555555'
const productId = '66666666-6666-4666-8666-666666666666'
const productOrganisation = '77777777-7777-4777-8777-777777777777'
const managerOrganisation = '88888888-8888-4888-8888-888888888888'
const reviewOrganisation = '99999999-9999-4999-8999-999999999999'
const issuerOrganisation = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const issuerAppointmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const complianceAppointmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const issuerMembership = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const complianceMembership = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const firstPackageId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const secondPackageId = '00000000-0000-4000-8000-000000000001'
const thirdPackageId = '00000000-0000-4000-8000-000000000002'
const receiptId = '00000000-0000-4000-8000-000000000003'
const requestKey = '00000000-0000-4000-8000-000000000004'
const hash = 'ab'.repeat(32)
const release: PlatformRelease = { version: 'mounted-package-fixture', environment: 'TESTNET', source: 'normal-package-workflow-fixture' }
type Role = OfferingAccess['operating_context']['role']
const context = (role: Role): OfferingAccess['operating_context'] => ({ mode: 'ROLE', role, organisationId: role === 'OfferingManager' ? managerOrganisation : role === 'IssuerFundManager' ? issuerOrganisation : reviewOrganisation })
const actorFor = (role: Role) => role === 'OfferingManager' ? manager : role === 'IssuerFundManager' ? issuer : role === 'SuperAdmin' ? admin : productReviewer
const past = () => new Date(Date.now() - 60_000).toISOString()
const expiry = () => new Date(Date.now() + 7 * 86_400_000).toISOString()

function packageRecord(change: Partial<PortalOfferingPackage> = {}): PortalOfferingPackage {
  return { id: firstPackageId, package_number: 1, origin: 'SUBMITTED', terms_hash: hash,
    document_hashes: { memorandum: 'cd'.repeat(32), risks: 'de'.repeat(32), subscription_terms: 'ef'.repeat(32) },
    submitted_at: past(), issuer_status: 'PENDING', compliance_status: 'PENDING', technical_readiness_status: 'NOT_VERIFIED',
    publishable: false, subscribable: false, can_review_issuer: false, can_review_compliance: false, ...change }
}
function product(kind: ProductTerms['asset_type'] = 'FUND', change: Partial<PortalProduct> = {}): PortalProduct {
  return { id: productId, organisation_id: productOrganisation, created_by: manager, revision: 1, status: 'DRAFT',
    terms: fictionalProductTerms(kind), terms_hash: hash, reserved_units: '0', created_at: past(),
    reviewer_id: null, review_notes: null, reviewed_at: null, published_at: null, review_checks: {},
    offering_package: null, offering_history: [], allowed_actions: ['save_product', 'submit_product'], ...change }
}
function appointment(role: 'IssuerFundManager' | 'ComplianceOfficer', change: Partial<PortalProductServiceAppointment> = {}): PortalProductServiceAppointment {
  return { id: role === 'IssuerFundManager' ? issuerAppointmentId : complianceAppointmentId,
    product_id: productId, product_organisation_id: productOrganisation, reviewer_scope_organisation_id: reviewOrganisation,
    role, appointee_user_id: role === 'IssuerFundManager' ? issuer : productReviewer,
    native_membership_id: role === 'IssuerFundManager' ? issuerMembership : complianceMembership,
    requested_by_user_id: manager, product_revision_at_request: 2, terms_hash_at_request: hash,
    evidence_reference: 'Fictional exact-product appointment evidence REF-001.', requested_until: expiry(), status: 'SUBMITTED', revision: 1,
    requested_at: past(), reviewed_at: null, reviewed_by_user_id: null, review_notes: null, approval_receipt_id: null,
    applied_at: null, applied_by_user_id: null, revoked_at: null, revoke_reason: null,
    effective: false, next_owner: 'COMPLIANCE', can_review: false, can_apply: false, can_revoke: false, ...change }
}
function snapshot(role: Role, products: PortalProduct[] = [], appointments: PortalProductServiceAppointment[] = [], actorId = actorFor(role)): PortalSnapshot {
  const operatingContext = context(role)
  if (operatingContext.mode !== 'ROLE') throw new Error('Expected role fixture')
  const allowedCommands = OFFERING_COMMANDS.filter(command => role === 'OfferingManager'
    ? ['create_product', 'save_product', 'submit_product', 'begin_offering_amendment', 'reopen_offering_review', 'request_product_service_appointment'].includes(command)
    : role === 'IssuerFundManager' ? command === 'review_offering_issuer'
      : role === 'SuperAdmin' ? command === 'apply_product_service_appointment'
        : ['review_product', 'review_product_service_appointment'].includes(command))
  return { actor: { id: actorId, email: `${role.toLowerCase()}@example.invalid`, display_name: 'Fictional package participant', can_review: role === 'ComplianceOfficer' },
    operating_context: operatingContext,
    stage2_access: { version: 1, environment: 'TESTNET', actor_id: actorId, operating_context: operatingContext, session_mode: 'TEST_PASSWORD', allowed_commands: [] },
    offering_access: { version: 1, environment: 'TESTNET', actor_id: actorId, operating_context: operatingContext, session_mode: 'TEST_PASSWORD', allowed_commands: allowedCommands },
    applications: [], organisations: role === 'OfferingManager' ? [{ id: productOrganisation, name: 'Fictional Manager Customer', status: 'ACTIVE', authority_source: 'NATIVE_BINDING', native_organisation_id: managerOrganisation, roles: ['OfferingManager'], capabilities: ['create_product', 'save_product', 'submit_product', 'begin_offering_amendment', 'reopen_offering_review', 'publish_product', 'read_orders'] }] : [],
    products, subscriptions: [], events: [], requests: [], accounts: [], product_eligibility: [], entity_product_eligibility: [],
    product_appointments: appointments, product_appointment_candidates: products.flatMap(item => (['IssuerFundManager', 'ComplianceOfficer'] as const).map(serviceRole => ({ product_id: item.id, role: serviceRole, user_id: serviceRole === 'IssuerFundManager' ? issuer : productReviewer, membership_id: serviceRole === 'IssuerFundManager' ? issuerMembership : complianceMembership, email: serviceRole === 'IssuerFundManager' ? 'issuer@example.invalid' : 'product.compliance@example.invalid', display_name: `Fictional ${serviceRole}` }))),
    mandate_queue_available: true, organisation_mandates: [], entity_mandate_queue_available: true, investing_representative_mandates: [], entity_investment_accounts: [] }
}
function mount(value: PortalSnapshot, view: '/portal' | '/portal/products' | '/portal/products/new' | '/portal/products/detail' | '/portal/compliance' | '/portal/compliance/detail' = '/portal', id?: string, selectedRelease = release) {
  return render(<PortalScreen data={{ user: { id: value.actor.id, email: value.actor.email }, snapshot: value }} view={view} id={id} operatingContext={value.operating_context} release={selectedRelease} />)
}
let nextResult: PortalSnapshot | undefined
let failTransport = false
let expectedFetchCount = 0
let lastRequest: PortalCommand & { operating_context: PortalOperatingContext }
const fetchCommand = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  if (failTransport) throw new Error('Synthetic interrupted transport; outcome unknown.')
  const raw = JSON.parse(String(init?.body))
  expect(portalCommandSchema.safeParse({ command: raw.command, key: raw.key, payload: raw.payload }).success).toBe(true)
  lastRequest = raw
  if (!nextResult) throw new Error('A synthetic saved result was not configured.')
  expect(_url).toBe('/api/portal/command')
  expect(init).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  expect(init?.headers).toMatchObject({ 'x-bx1-expected-actor': nextResult.actor.id })
  return new Response(JSON.stringify({ snapshot: { ...nextResult, requests: [{ key: raw.key, command: raw.command }] } }), { headers: { 'content-type': 'application/json' } })
})
function recorded(command: string, payload: Record<string, unknown>) {
  expect(lastRequest.command).toBe(command)
  expect(lastRequest.payload).toMatchObject(payload)
  expect(lastRequest.key).toMatch(/^[0-9a-f-]{36}$/i)
  expect(lastRequest.operating_context).toEqual(nextResult?.operating_context)
}
async function saved() {
  const calls = ++expectedFetchCount
  await waitFor(() => expect(fetchCommand).toHaveBeenCalledTimes(calls))
  // A verified canonical result clears the exact durable marker. A child keyed
  // by the new workflow revision may remount and need not retain old feedback.
  await waitFor(() => expect(sessionStorage.length).toBe(0))
}
function checkLabels(labels: RegExp[]) { labels.forEach(label => fireEvent.click(screen.getByRole('checkbox', { name: label }))) }

beforeEach(() => {
  vi.clearAllMocks(); nextResult = undefined; failTransport = false; expectedFetchCount = 0; sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', fetchCommand); vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('normal TEST mounted offering package handoffs', () => {
  it.each(['FUND', 'REAL_ESTATE'] as const)('connects the %s editor, appointments, changes loop and exact independent package decisions', async kind => {
    const draft = product(kind)
    nextResult = snapshot('OfferingManager', [draft])
    let page = mount(snapshot('OfferingManager'), '/portal/products/new')
    if (kind === 'REAL_ESTATE') fireEvent.change(screen.getByLabelText(/^Asset template/), { target: { value: kind } })
    checkLabels([/I have reviewed this explicitly fictional product/])
    fireEvent.click(screen.getByRole('button', { name: 'Create product draft' }))
    await saved(); recorded('create_product', { organisation_id: productOrganisation, terms: { asset_type: kind, currency: 'TST' } })
    expect(push).toHaveBeenCalledWith(portalScopeHref('/portal/products', context('OfferingManager')))
    page.unmount()

    const edited = { ...draft, revision: 2, terms: { ...draft.terms, name: `Fictional ${kind} connected package` } }
    nextResult = snapshot('OfferingManager', [edited])
    page = mount(snapshot('OfferingManager', [draft]), '/portal/products/detail', productId)
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: edited.terms.name } })
    checkLabels([/I have reviewed this explicitly fictional product/])
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await saved(); recorded('save_product', { product_id: productId, expected_revision: 1, terms: { name: edited.terms.name, asset_type: kind } })
    page.unmount()

    const applied: PortalProductServiceAppointment[] = []
    for (const serviceRole of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const requested = appointment(serviceRole)
      nextResult = snapshot('OfferingManager', [edited], [...applied, requested])
      page = mount(snapshot('OfferingManager', [edited], applied), '/portal/products/detail', productId)
      fireEvent.change(screen.getByLabelText('Service role'), { target: { value: serviceRole } })
      fireEvent.change(screen.getByLabelText('Existing role member'), { target: { value: requested.native_membership_id } })
      fireEvent.change(screen.getByLabelText(/^Appointment evidence reference/), { target: { value: requested.evidence_reference } })
      fireEvent.change(screen.getByLabelText(/^Appointment end date/), { target: { value: expiry().slice(0, 10) } })
      fireEvent.click(screen.getByRole('button', { name: 'Request appointment review' }))
      await saved(); recorded('request_product_service_appointment', { product_id: productId, role: serviceRole, appointee_user_id: requested.appointee_user_id, native_membership_id: requested.native_membership_id, expected_product_revision: 2 })
      page.unmount()

      const approved = { ...requested, status: 'APPROVED' as const, revision: 2, can_apply: true, next_owner: 'SUPER_ADMIN' as const, reviewed_by_user_id: appointmentReviewer, reviewed_at: past(), approval_receipt_id: receiptId }
      nextResult = snapshot('ComplianceOfficer', [edited], [approved], appointmentReviewer)
      page = mount(snapshot('ComplianceOfficer', [edited], [{ ...requested, can_review: true }], appointmentReviewer), '/portal/compliance/detail', requested.id)
      checkLabels([/proposed person and role/, /referenced appointment evidence/, /product, organisation and expiry/])
      fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'APPROVED' } })
      fireEvent.change(screen.getByLabelText(/^Reasoned decision/), { target: { value: 'Fictional current appointment evidence reviewed for this exact product.' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record review' }))
      await saved(); recorded('review_product_service_appointment', { appointment_id: requested.id, expected_revision: 1, decision: 'APPROVED' })
      expect(screen.queryByRole('button', { name: 'Apply product appointment' })).toBeNull()
      page.unmount()

      const appliedCase = { ...approved, status: 'APPLIED' as const, revision: 3, can_apply: false, effective: true, applied_at: past(), applied_by_user_id: admin, next_owner: 'NONE' as const }
      nextResult = snapshot('SuperAdmin', [edited], [appliedCase])
      page = mount(snapshot('SuperAdmin', [edited], [approved]), '/portal/compliance/detail', requested.id)
      expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Apply product appointment' }))
      await saved(); recorded('apply_product_service_appointment', { appointment_id: requested.id, expected_revision: 2 })
      expect(screen.getByText('No action in this scope')).toBeTruthy()
      page.unmount(); applied.push(appliedCase)
    }

    const originalPackage = packageRecord()
    const submitted = { ...edited, revision: 3, status: 'IN_REVIEW' as const, offering_package: originalPackage, offering_history: [originalPackage], allowed_actions: [] }
    nextResult = snapshot('OfferingManager', [submitted], applied)
    page = mount(snapshot('OfferingManager', [edited], applied), '/portal/products/detail', productId)
    fireEvent.click(screen.getByRole('button', { name: 'Submit immutable offering package' }))
    await saved(); recorded('submit_product', { product_id: productId, expected_revision: 2 })
    expect(screen.getAllByText(firstPackageId).length).toBeGreaterThan(0)
    page.unmount()

    const changesPackage = { ...originalPackage, issuer_status: 'CHANGES_REQUIRED' as const, issuer_review_notes: 'Fictional issuer requests a clearer product rights disclosure.' }
    const changes = { ...submitted, revision: 4, status: 'CHANGES_REQUIRED' as const, offering_package: changesPackage, offering_history: [changesPackage], allowed_actions: ['save_product', 'submit_product'] }
    nextResult = snapshot('IssuerFundManager', [changes], applied)
    page = mount(snapshot('IssuerFundManager', [{ ...submitted, offering_package: { ...originalPackage, can_review_issuer: true }, allowed_actions: ['review_offering_issuer'] }], applied), '/portal/products/detail', productId)
    expect(screen.queryByRole('button', { name: 'Save revised draft' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Issuer decision'), { target: { value: 'CHANGES_REQUIRED' } })
    fireEvent.change(screen.getByLabelText(/^Issuer rationale/), { target: { value: changesPackage.issuer_review_notes } })
    fireEvent.click(screen.getByRole('button', { name: 'Record issuer decision' }))
    await saved(); recorded('review_offering_issuer', { offering_revision_id: firstPackageId, terms_hash: hash, expected_revision: 3, decision: 'CHANGES_REQUIRED' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(edited.terms.name)
    page.unmount()

    const corrected = { ...changes, status: 'DRAFT' as const, revision: 5, terms_hash: 'ce'.repeat(32), terms: { ...edited.terms, summary: 'Fictional revised disclosure of the precise proposed product rights and investor interests.' } }
    nextResult = snapshot('OfferingManager', [corrected], applied)
    page = mount(snapshot('OfferingManager', [changes], applied), '/portal/products/detail', productId)
    expect(screen.getByText(changesPackage.issuer_review_notes)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Investor-facing summary'), { target: { value: corrected.terms.summary } })
    checkLabels([/I have reviewed this explicitly fictional product/])
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await saved(); recorded('save_product', { product_id: productId, expected_revision: 4, terms: { summary: corrected.terms.summary } })
    page.unmount()

    const nextPackage = packageRecord({ id: secondPackageId, package_number: 2, terms_hash: corrected.terms_hash })
    const resubmitted = { ...corrected, revision: 6, status: 'IN_REVIEW' as const, offering_package: nextPackage, offering_history: [changesPackage, nextPackage], allowed_actions: [] }
    nextResult = snapshot('OfferingManager', [resubmitted], applied)
    page = mount(snapshot('OfferingManager', [corrected], applied), '/portal/products/detail', productId)
    fireEvent.click(screen.getByRole('button', { name: 'Submit immutable offering package' }))
    await saved(); recorded('submit_product', { product_id: productId, expected_revision: 5 })
    page.unmount()

    const issuerApprovedPackage = { ...nextPackage, issuer_status: 'APPROVED' as const }
    const issuerApproved = { ...resubmitted, revision: 7, offering_package: issuerApprovedPackage, offering_history: [changesPackage, issuerApprovedPackage] }
    nextResult = snapshot('IssuerFundManager', [issuerApproved], applied)
    page = mount(snapshot('IssuerFundManager', [{ ...resubmitted, offering_package: { ...nextPackage, can_review_issuer: true }, allowed_actions: ['review_offering_issuer'] }], applied), '/portal/products/detail', productId)
    checkLabels([/Appointed issuer authority/, /Exact preliminary package economics/, /Rights and obligations represented/])
    fireEvent.change(screen.getByLabelText(/^Issuer rationale/), { target: { value: 'Fictional corrected exact package reviewed under current issuer appointment.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record issuer decision' }))
    await saved(); recorded('review_offering_issuer', { offering_revision_id: secondPackageId, terms_hash: corrected.terms_hash, expected_revision: 6, decision: 'APPROVED' })
    page.unmount()

    const approvedPackage = { ...issuerApprovedPackage, compliance_status: 'APPROVED' as const }
    const accepted = { ...issuerApproved, revision: 8, status: 'APPROVED' as const, offering_package: approvedPackage, offering_history: [changesPackage, approvedPackage], allowed_actions: ['begin_offering_amendment', 'reopen_offering_review'] }
    nextResult = snapshot('ComplianceOfficer', [accepted], applied)
    page = mount(snapshot('ComplianceOfficer', [{ ...issuerApproved, offering_package: { ...issuerApprovedPackage, can_review_compliance: true }, allowed_actions: ['review_product'] }], applied), '/portal/compliance/detail', productId)
    checkLabels([/Fictional issuer and asset mandate/, /Economic and exit terms/, /In-form disclosures/, /Investor eligibility rules/])
    fireEvent.change(screen.getByLabelText('Review rationale'), { target: { value: 'Fictional exact corrected terms and restrictions independently reviewed.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record Compliance decision' }))
    await saved(); recorded('review_product', { offering_revision_id: secondPackageId, terms_hash: corrected.terms_hash, expected_revision: 7, decision: 'APPROVED' })
    page.unmount()

    page = mount(snapshot('OfferingManager', [accepted], applied), '/portal/products/detail', productId)
    expect(screen.queryByRole('button', { name: 'Open approved offering' })).toBeNull()
    expect(screen.queryByText('Incoming subscription orders')).toBeNull()
    expect(screen.getByRole('button', { name: 'Begin terms amendment' })).toBeTruthy()
    const freshReview = packageRecord({ id: thirdPackageId, package_number: 3, terms_hash: corrected.terms_hash })
    nextResult = snapshot('OfferingManager', [{ ...accepted, revision: 9, status: 'IN_REVIEW', offering_package: freshReview, offering_history: [...accepted.offering_history, freshReview], allowed_actions: [] }], applied)
    fireEvent.change(screen.getByLabelText(/^Reason for re-review/), { target: { value: 'Fictional new review cycle requires fresh independent package decisions.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create new review revision' }))
    await saved(); recorded('reopen_offering_review', { product_id: productId, expected_revision: 8 })
    expect(screen.getAllByText(thirdPackageId).length).toBeGreaterThan(0)
    expect(nextResult.products[0].offering_package).toMatchObject({ issuer_status: 'PENDING', compliance_status: 'PENDING', publishable: false })
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('connects %s amendment to the existing draft editor without reusing approvals', async kind => {
    const accepted = product(kind, { status: 'APPROVED', revision: 8, offering_package: packageRecord({ issuer_status: 'APPROVED', compliance_status: 'APPROVED' }), allowed_actions: ['begin_offering_amendment', 'reopen_offering_review'], offering_history: [packageRecord()] })
    nextResult = snapshot('OfferingManager', [{ ...accepted, status: 'DRAFT', revision: 9, offering_package: null, allowed_actions: ['save_product', 'submit_product'] }])
    mount(snapshot('OfferingManager', [accepted]), '/portal/products/detail', productId)
    fireEvent.change(screen.getByLabelText(/^Reason for terms amendment/), { target: { value: 'Fictional reviewed policy change requires newly submitted immutable terms.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin terms amendment' }))
    await saved(); recorded('begin_offering_amendment', { product_id: productId, expected_revision: 8 })
    expect(screen.getByRole('button', { name: 'Save revised draft' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open approved offering' })).toBeNull()
  })

  it('keeps issuer creation/editing denied despite native-looking stale manager capabilities', () => {
    const value = snapshot('IssuerFundManager', [product('FUND', { allowed_actions: ['save_product', 'submit_product'] })], [appointment('IssuerFundManager', { status: 'APPLIED', effective: true })])
    value.organisations = [{ ...snapshot('OfferingManager').organisations[0], roles: ['IssuerFundManager'], native_organisation_id: issuerOrganisation }]
    let page = mount(value, '/portal/products/new')
    expect(screen.queryByRole('button', { name: 'Create product draft' })).toBeNull(); page.unmount()
    page = mount(value, '/portal/products/detail', productId)
    expect(screen.queryByRole('button', { name: 'Save revised draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit immutable offering package' })).toBeNull()
    expect(screen.queryByText('Incoming subscription orders')).toBeNull()
  })

  it.each(['missing', 'revoked', 'expired', 'wrong actor'] as const)('does not open an issuer package with a %s appointment', failure => {
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord({ can_review_issuer: true }), allowed_actions: ['review_offering_issuer'] })
    const proof = appointment('IssuerFundManager', { status: 'APPLIED', effective: true })
    if (failure === 'revoked') proof.status = 'REVOKED'
    if (failure === 'expired') proof.requested_until = past()
    if (failure === 'wrong actor') proof.appointee_user_id = manager
    mount(snapshot('IssuerFundManager', [item], failure === 'missing' ? [] : [proof]), '/portal/products/detail', productId)
    expect(screen.queryByRole('button', { name: 'Record issuer decision' })).toBeNull()
    expect(screen.queryByRole('heading', { name: item.terms.name })).toBeNull()
  })

  it('does not promote Stage2-only access, foreign context or MAIN to a package workspace', () => {
    const value = snapshot('OfferingManager', [product()]); delete value.offering_access
    let page = mount(value); expect(screen.queryByText('Product register')).toBeNull(); page.unmount()
    const foreign = snapshot('OfferingManager', [product()])
    foreign.offering_access = { ...foreign.offering_access!, operating_context: { ...foreign.offering_access!.operating_context, organisationId: reviewOrganisation } }
    page = mount(foreign); expect(screen.queryByText('Product register')).toBeNull(); page.unmount()
    page = mount(snapshot('OfferingManager', [product()]), '/portal/products', undefined, { ...release, environment: 'MAINNET' })
    expect(screen.queryByText('Product register')).toBeNull()
  })

  it('suppresses publish and revoke even when stale record flags advertise them', () => {
    const value = snapshot('OfferingManager')
    const accepted = product('FUND', { status: 'APPROVED', allowed_actions: ['publish_product'], offering_package: packageRecord({ issuer_status: 'APPROVED', compliance_status: 'APPROVED', technical_readiness_status: 'VERIFIED', publishable: true }) })
    let page = render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><ProductActions product={accepted} availableCommands={['publish_product']} onSaved={() => {}} /></PortalCommandProvider>)
    expect(screen.queryByRole('button', { name: 'Open approved offering' })).toBeNull(); page.unmount()
    const staff = snapshot('SuperAdmin')
    page = render(<PortalCommandProvider snapshot={staff} operatingContext={staff.operating_context} environment="TESTNET"><ProductAppointmentDecision appointment={appointment('IssuerFundManager', { status: 'APPLIED', can_revoke: true })} snapshot={staff} onSaved={() => {}} /></PortalCommandProvider>)
    expect(screen.queryByRole('button', { name: 'Revoke appointment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull()
  })

  it.each(['ComplianceOfficer', 'SuperAdmin'] as const)('intersects stale appointment buttons with the exact %s command family', role => {
    const value = snapshot(role)
    render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><ProductAppointmentDecision appointment={appointment('IssuerFundManager', { status: 'APPROVED', can_review: true, can_apply: true, can_revoke: true })} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
    expect(screen.queryByRole('button', { name: role === 'ComplianceOfficer' ? 'Apply product appointment' : 'Record review' })).toBeNull()
    expect(screen.getByRole('button', { name: role === 'ComplianceOfficer' ? 'Record review' : 'Apply product appointment' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revoke appointment' })).toBeNull()
  })

  it.each(['IssuerFundManager', 'ComplianceOfficer'] as const)('requires both current package flags and the %s command projection', role => {
    const value = snapshot(role)
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord({ can_review_issuer: true, can_review_compliance: true }), allowed_actions: [] })
    const Review = role === 'IssuerFundManager' ? IssuerOfferingReview : ProductReview
    const page = render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><Review product={item} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
    expect(screen.queryByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' })).toBeNull()
    page.unmount()
    value.offering_access!.allowed_commands = []
    render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><Review product={{ ...item, allowed_actions: [role === 'IssuerFundManager' ? 'review_offering_issuer' : 'review_product'] }} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
    expect(screen.queryByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' })).toBeNull()
  })

  it('retains original-key retry after an unknown package command outcome', async () => {
    const draft = product(); const value = snapshot('OfferingManager', [draft])
    mount(value, '/portal/products/detail', productId)
    failTransport = true
    fireEvent.click(screen.getByRole('button', { name: 'Submit immutable offering package' }))
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    const original = JSON.parse(String(fetchCommand.mock.calls[0][1]?.body))
    expect(screen.getByRole('button', { name: 'Submit immutable offering package' }).hasAttribute('disabled')).toBe(true)
    failTransport = false; expectedFetchCount = 1; nextResult = snapshot('OfferingManager', [product('FUND', { status: 'IN_REVIEW', revision: 2, offering_package: packageRecord(), allowed_actions: [] })])
    fireEvent.click(screen.getByRole('button', { name: 'Retry the original saved request' }))
    await saved(); expect(lastRequest.key).toBe(original.key); expect(lastRequest.payload).toEqual(original.payload)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('offering saved-response continuity', () => {
  it.each(['missing', 'actor', 'context', 'environment', 'commands', 'stage2 mismatch'] as const)('keeps the durable marker when returned offering access has %s', async failure => {
    const value = snapshot('OfferingManager', [product()]); const expected = value.offering_access!
    const command = { command: 'submit_product' as const, key: requestKey, payload: { product_id: productId, expected_revision: 1 } }
    const scope = { operatingContext: context('OfferingManager'), environment: 'TESTNET' as const }
    const prepared = await prepareDurablePortalCommand(sessionStorage, manager, command, [], scope)
    const savedValue = snapshot('OfferingManager', [product()])
    if (failure === 'missing') delete savedValue.offering_access
    if (failure === 'actor') savedValue.offering_access!.actor_id = issuer
    if (failure === 'context') savedValue.offering_access = { ...savedValue.offering_access!, operating_context: { ...savedValue.offering_access!.operating_context, organisationId: reviewOrganisation } }
    if (failure === 'environment') (savedValue.offering_access as unknown as Record<string, unknown>).environment = 'MAINNET'
    if (failure === 'commands') savedValue.offering_access!.allowed_commands = ['save_product']
    if (failure === 'stage2 mismatch') savedValue.stage2_access!.session_mode = 'STANDARD'
    nextResult = savedValue
    await expect(postPortalCommand(prepared, scope.operatingContext, manager, value.stage2_access, expected)).rejects.toThrow(/offering context|workflow action/)
    expect(reconcilePortalMarker(sessionStorage, manager, [], scope)?.key).toBe(requestKey)
  })

  it('accepts the package family alongside unchanged Stage2 and rejects an excluded financial command', async () => {
    const value = snapshot('OfferingManager', [product()]); nextResult = value
    expect(await postPortalCommand({ command: 'submit_product', key: requestKey, payload: { product_id: productId, expected_revision: 1 } }, context('OfferingManager'), manager, value.stage2_access, value.offering_access)).toMatchObject({ offering_access: value.offering_access })
    await expect(postPortalCommand({ command: 'publish_product', key: requestKey, payload: { product_id: productId, expected_revision: 1 } }, context('OfferingManager'), manager, value.stage2_access, value.offering_access)).rejects.toThrow('workflow action')
  })
})
