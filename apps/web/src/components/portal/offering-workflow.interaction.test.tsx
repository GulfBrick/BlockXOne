// @vitest-environment jsdom

import React from 'react'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { portalCommandSchema, type FundTermsV2, type RealEstateTermsV2, type PortalCommand, type PortalOfferingPackage, type PortalProduct, type PortalProductServiceAppointment, type PortalSnapshot, type ProductTerms } from '@/lib/portal/contracts'
import { prepareCommonEnvelopeUpgrade } from '@/lib/portal/product-common-envelope'
import { productDraftFields } from '@/lib/portal/product-form-flow'
import { portalScopeHref, type PortalOperatingContext } from '@/lib/portal/operating-context'
import { OFFERING_COMMANDS, type OfferingAccess } from '@/lib/portal/offering-access'
import type { PlatformRelease } from '@/lib/platform-release'
import { fundStageKeys, type FundProductLifecycle } from '@/lib/portal/fund-lifecycle-contracts'
import { PortalScreen } from './portal-screens'
import { PortalCommandProvider, postPortalCommand, prepareDurablePortalCommand, reconcilePortalMarker } from './portal-client'
import { fictionalProductTerms } from './product-form'
import { IssuerOfferingReview, ProductActions, ProductReview, SubscriptionForm } from './portal-workflows'
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
function reviewSavedDraft() {
  fireEvent.click(within(screen.getByRole('list', { name: 'Product setup steps' })).getByRole('button', { name: /^\d+\. Review and save$/ }))
}
/** Fill the current blank v3 editor through its actual mounted controls. The
 * values are synthetic terms, not fake approvals or document/provider proof.
 */
function enterNewProductTerms(kind: 'FUND' | 'REAL_ESTATE') {
  const template = prepareCommonEnvelopeUpgrade(fictionalProductTerms(kind) as FundTermsV2 | RealEstateTermsV2, productOrganisation, issuerOrganisation, receiptId)
  const values = new Map(productDraftFields(template).map(item => [item.path, item.value]))
  const steps = within(screen.getByRole('list', { name: 'Product setup steps' })).getAllByRole('button')
  for (const step of steps) {
    fireEvent.click(step)
    if (/Review and save$/.test(step.textContent ?? '')) break
    for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-product-field]')) {
      const path = input.getAttribute('data-product-field')!, value = values.get(path)
      expect(value, `Synthetic value for the rendered ${path} control`).not.toBeUndefined()
      if (input instanceof HTMLSelectElement && input.multiple) {
        expect(Array.isArray(value)).toBe(true)
        for (const option of input.options) option.selected = (value as string[]).includes(option.value)
        fireEvent.change(input)
      } else fireEvent.change(input, { target: { value: Array.isArray(value) ? value.join(',') : String(value) } })
    }
  }
  checkLabels([/I have reviewed these TEST terms/])
}

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
    enterNewProductTerms(kind)
    fireEvent.click(screen.getByRole('button', { name: 'Create product draft' }))
    await saved(); recorded('create_product', { organisation_id: productOrganisation, terms: { asset_type: kind, currency: 'TST' } })
    expect(lastRequest.payload).toMatchObject({ terms: { terms_version: 3, common_envelope: { manager_organisation_id: productOrganisation } } })
    expect(push).toHaveBeenCalledWith(portalScopeHref('/portal/products', context('OfferingManager')))
    page.unmount()

    const edited = { ...draft, revision: 2, terms: { ...draft.terms, name: `Fictional ${kind} connected package` } }
    nextResult = snapshot('OfferingManager', [edited])
    page = mount(snapshot('OfferingManager', [draft]), '/portal/products/detail', productId)
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: edited.terms.name } })
    reviewSavedDraft()
    checkLabels([/I have reviewed this explicitly fictional product/])
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await saved(); recorded('save_product', { product_id: productId, expected_revision: 1, terms: { name: edited.terms.name, asset_type: kind } })
    page.unmount()

    const applied: PortalProductServiceAppointment[] = []
    for (const serviceRole of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const requested = appointment(serviceRole)
      nextResult = snapshot('OfferingManager', [edited], [...applied, requested])
      page = mount(snapshot('OfferingManager', [edited], applied), '/portal/products/detail', productId)
      fireEvent.click(screen.getByRole('button', { name: 'Appointments' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit immutable offering package' }))
    await saved(); recorded('submit_product', { product_id: productId, expected_revision: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'View recorded package evidence' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    fireEvent.click(screen.getByRole('button', { name: 'View recorded package evidence' }))
    expect(screen.getByText(changesPackage.issuer_review_notes)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    fireEvent.change(screen.getByLabelText('Investor-facing summary'), { target: { value: corrected.terms.summary } })
    reviewSavedDraft()
    checkLabels([/I have reviewed this explicitly fictional product/])
    fireEvent.click(screen.getByRole('button', { name: 'Save revised draft' }))
    await saved(); recorded('save_product', { product_id: productId, expected_revision: 4, terms: { summary: corrected.terms.summary } })
    page.unmount()

    const nextPackage = packageRecord({ id: secondPackageId, package_number: 2, terms_hash: corrected.terms_hash })
    const resubmitted = { ...corrected, revision: 6, status: 'IN_REVIEW' as const, offering_package: nextPackage, offering_history: [changesPackage, nextPackage], allowed_actions: [] }
    nextResult = snapshot('OfferingManager', [resubmitted], applied)
    page = mount(snapshot('OfferingManager', [corrected], applied), '/portal/products/detail', productId)
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'View recorded package evidence' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    reviewSavedDraft()
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
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
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

describe('saved appointment case handoff', () => {
  const requested = () => appointment('IssuerFundManager', { can_review: true, appointee_user_id: manager, requested_by_user_id: manager })
  function reviewer(cases = [requested()]) {
    const value = snapshot('ComplianceOfficer', [product()], cases, manager)
    value.offering_access!.session_mode = 'STANDARD'; value.stage2_access!.session_mode = 'STANDARD'
    return value
  }
  function recordReview() {
    checkLabels([/proposed person and role/, /referenced appointment evidence/, /product, organisation and expiry/])
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'APPROVED' } })
    fireEvent.change(screen.getByLabelText(/^Reasoned decision/), { target: { value: 'Synthetic current appointment reviewed within this exact TEST capacity.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record review' }))
  }
  it('shows a confirmed saved handoff when the current reader no longer returns the reviewed case, without keeping stale case controls', async () => {
    nextResult = reviewer([])
    mount(reviewer(), '/portal/compliance/detail', issuerAppointmentId)
    recordReview(); await saved()
    expect(screen.getByText('Appointment change saved')).toBeTruthy()
    expect(screen.queryByText('Record unavailable')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply product appointment' })).toBeNull()
    expect(screen.queryByText('Appointment evidence reference')).toBeNull()
    expect(screen.getByRole('link', { name: 'Return to Compliance work queue' }).getAttribute('href')).toBe(`/portal/compliance?organisation=${reviewOrganisation}&role=ComplianceOfficer`)
    expect(screen.getByText(/Approved appointments require Super Admin application/)).toBeTruthy()
  })
  it('keeps an initially missing case unavailable rather than inventing a saved handoff', () => {
    mount(reviewer([]), '/portal/compliance/detail', issuerAppointmentId)
    expect(screen.getByText('Record unavailable')).toBeTruthy()
    expect(screen.queryByText('Appointment change saved')).toBeNull()
  })
  it('continues rendering a current retained case after a confirmed save instead of replacing it with a historical notice', async () => {
    nextResult = reviewer([appointment('IssuerFundManager', { ...requested(), status: 'APPROVED', revision: 2, can_review: false,
      reviewed_by_user_id: manager, reviewed_at: past(), approval_receipt_id: receiptId, next_owner: 'SUPER_ADMIN' })])
    mount(reviewer(), '/portal/compliance/detail', issuerAppointmentId)
    recordReview(); await saved()
    expect(screen.getByText('Appointment evidence reference')).toBeTruthy()
    expect(screen.queryByText('Appointment change saved')).toBeNull()
  })
  it('does not show a saved handoff for an interrupted request', async () => {
    failTransport = true
    mount(reviewer(), '/portal/compliance/detail', issuerAppointmentId)
    recordReview()
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    expect(screen.queryByText('Appointment change saved')).toBeNull()
    expect(sessionStorage.length).toBe(1)
  })
  it('does not show a saved handoff for a foreign actor response', async () => {
    const foreign = reviewer([]); foreign.actor.id = issuer
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ snapshot: foreign }), { headers: { 'content-type': 'application/json' } })))
    mount(reviewer(), '/portal/compliance/detail', issuerAppointmentId)
    recordReview()
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    expect(screen.queryByText('Appointment change saved')).toBeNull()
    expect(sessionStorage.length).toBe(1)
  })
  it.each(['actor', 'environment', 'context', 'case'] as const)('does not borrow a late saved handoff after a %s change', async change => {
    let finish: ((response: Response) => void) | undefined
    let sent: { key: string; command: string } | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)); return new Promise<Response>(resolve => { finish = resolve })
    }))
    const value = reviewer(), page = mount(value, '/portal/compliance/detail', issuerAppointmentId)
    recordReview(); await waitFor(() => expect(sent).toBeDefined())
    const next = reviewer([])
    if (change === 'actor') {
      next.actor.id = productReviewer; next.offering_access!.actor_id = productReviewer; next.stage2_access!.actor_id = productReviewer
    }
    if (change === 'context') {
      const changed = { mode: 'ROLE' as const, organisationId: managerOrganisation, role: 'ComplianceOfficer' as const }
      next.operating_context = changed; next.offering_access!.operating_context = changed; next.stage2_access!.operating_context = changed
    }
    const nextRelease = change === 'environment' ? { ...release, environment: 'MAINNET' as const } : release
    page.rerender(<PortalScreen data={{ user: { id: next.actor.id, email: next.actor.email }, snapshot: next }}
      view="/portal/compliance/detail" id={change === 'case' ? complianceAppointmentId : issuerAppointmentId}
      operatingContext={next.operating_context} release={nextRelease} />)
    await act(async () => finish!(new Response(JSON.stringify({ snapshot: { ...reviewer([]), requests: [sent!] } }), { headers: { 'content-type': 'application/json' } })))
    await waitFor(() => expect(screen.queryByText('Appointment change saved')).toBeNull())
    expect(sessionStorage.length).toBe(1)
  })
})

describe('existing product workspace next-step navigation', () => {
  function withFundProgress(value: PortalSnapshot, current: 'PREPARATION' | 'APPROVAL' = 'APPROVAL'): PortalSnapshot {
    const item = value.products[0]
    const lifecycle: FundProductLifecycle = { product_id: item.id, organisation_id: item.organisation_id,
      native_organisation_id: managerOrganisation, product_revision: item.revision, offering_revision_id: item.offering_package?.id ?? null,
      class_id: null, product_name: item.terms.name, terms_hash: item.terms_hash, configuration_hash: null,
      availability: 'DEPENDENCY_NOT_ADMITTED', stages: fundStageKeys.map(key => ({ key,
        state: key === current ? 'CURRENT' : current === 'APPROVAL' && key === 'PREPARATION' ? 'COMPLETE' : 'NOT_STARTED',
        label: key, description: 'Follow the current saved fund record.', reason_code: key === current ? 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED' : null,
        owner_role: current === 'PREPARATION' ? 'OfferingManager' : 'IssuerFundManager', evidence_ids: [] })),
      next_action: { action_id: `fund:${item.id}`, command: null, record_id: item.id, expected_revision: item.revision,
        label: current === 'PREPARATION' ? 'Complete the fund details' : 'Complete issuer review, compliance review and signing',
        reason_code: 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED', owner_role: current === 'PREPARATION' ? 'OfferingManager' : 'IssuerFundManager',
        can_execute: false, payload: null }, operations: [], orders: [], holdings: [], actions: [] }
    return { ...value, fund_lifecycle: { schema_version: 1, projection_revision: 1, actor_id: value.actor.id, environment: 'TESTNET',
      operating_context: value.operating_context!, observed_at: past(), availability: 'AVAILABLE', reason_code: null, products: [lifecycle] } }
  }
  const fetchOfferingReads = vi.fn(async () => new Response(JSON.stringify({
    error: 'Synthetic document/signature service is unavailable; no provider admission or acceptance is implied.', admitted: false,
  }), { status: 503, headers: { 'content-type': 'application/json' } }))
  beforeEach(() => {
    fetchOfferingReads.mockClear()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (typeof input === 'string' || input instanceof URL ? 'GET' : input.method)).toUpperCase()
      if (method === 'GET' && (url.startsWith('/api/portal/offering-documents?') || url.startsWith('/api/portal/offering-signatures?'))) return fetchOfferingReads()
      return fetchCommand(input, init)
    }))
  })

  function lifecycleOnlyOperator(role: 'TokenisationAgent' | 'TransferAgent' = 'TokenisationAgent'): PortalSnapshot {
    const prepared = withFundProgress(snapshot('OfferingManager', [product('FUND', { revision: 7 })]))
    const operatingContext: PortalOperatingContext = { mode: 'ROLE', organisationId: managerOrganisation, role }
    return { actor: prepared.actor, operating_context: operatingContext, base_records_available: false,
      applications: [], organisations: [], products: [], subscriptions: [], events: [], requests: [],
      fund_lifecycle: { ...prepared.fund_lifecycle!, operating_context: operatingContext } }
  }

  it('opens the existing guarded signer-wallet setup from a Tokenisation Agent lifecycle-only fund record', async () => {
    const value = lifecycleOnlyOperator(), operatingContext = value.operating_context!
    const setupResponse = { schema_version: 1, actor_id: manager, environment: 'TESTNET', operating_context: operatingContext,
      observed_at: past(), product_id: productId, product_revision: 7, offering_revision_id: firstPackageId,
      terms_hash: hash, configuration_hash: null, source_pin: 'b6c5fabf86e733ede017fef754d59eeb8f80e3f4',
      roleplay_policy: { policy_id: receiptId, epoch: 1, expires_at: expiry(), label: 'TEST ROLE PLAY - one operator; not independent human approval' },
      availability: 'UNAVAILABLE', reason_code: 'READ_DENIED', setup: null }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const result = url.endsWith('/setup/read') ? setupResponse : url.endsWith('/keys/read') ? { policy: {
        policy_id: receiptId, authority_epoch: 1, expires_at: expiry(), wallet_slots: [
          { slot: 'owner_1', wallet_address: `0x${'ab'.repeat(20)}`, control_proof_current: false, wallet_id: null },
          { slot: 'owner_2', wallet_address: `0x${'cd'.repeat(20)}`, control_proof_current: false, wallet_id: null },
        ],
      } } : url === '/api/wallet/context' ? { ok: true, context: { organisation: { id: managerOrganisation, name: 'Synthetic scoped organisation' }, configured: false, wallets: [] } } : null
      if (result === null) throw new Error('No write or chain request is allowed in this navigation fixture')
      if (url.endsWith('/setup/read') || url.endsWith('/keys/read')) expect(JSON.parse(String(init?.body))).toMatchObject({ product_id: productId, operating_context: operatingContext })
      return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetcher)
    mount(value, '/portal/products/detail', productId)
    const button = screen.getByRole('button', { name: 'Open signer wallets and blockchain setup' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(button)
    await screen.findByRole('heading', { name: 'Prove the appointed signing wallets' })
    const region = screen.getByRole('region', { name: 'Hide signer wallets and blockchain setup' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(region)
    expect(screen.getByText('Blockchain setup is not available in this capacity')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create saved blockchain setup' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bind this verified key to its signing slot' })).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    fireEvent.click(button)
    expect(screen.queryByRole('region', { name: 'Open signer wallets and blockchain setup' })).toBeNull()
    fireEvent.click(button)
    expect(screen.getByRole('heading', { name: 'Prove the appointed signing wallets' })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it.each(['other-role', 'no-fund', 'read-denied', 'wrong-actor', 'wrong-context', 'main'] as const)('does not infer a signer setup entry for %s', fault => {
    const value = lifecycleOnlyOperator(fault === 'other-role' ? 'TransferAgent' : 'TokenisationAgent')
    if (fault === 'no-fund') value.fund_lifecycle!.products = []
    if (fault === 'read-denied') { value.fund_lifecycle!.availability = 'UNAVAILABLE'; value.fund_lifecycle!.reason_code = 'READ_DENIED' }
    if (fault === 'wrong-actor') value.fund_lifecycle!.actor_id = issuer
    if (fault === 'wrong-context') value.fund_lifecycle!.operating_context = { mode: 'ROLE', organisationId: reviewOrganisation, role: 'TokenisationAgent' }
    if (fault === 'main') value.fund_lifecycle!.environment = 'MAINNET'
    mount(value, '/portal/products/detail', productId, fault === 'main' ? { ...release, environment: 'MAINNET' } : release)
    expect(screen.queryByRole('button', { name: 'Open signer wallets and blockchain setup' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Set up the fund’s blockchain' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('opens the single shared account menu and preserves full-document account boundaries', () => {
    mount(snapshot('OfferingManager'))
    const account = screen.getByRole('button', { name: 'Account' })
    expect(account.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Account options' })).toBeNull()
    fireEvent.click(account)
    const menu = within(screen.getByRole('region', { name: 'Account options' }))
    expect(account.getAttribute('aria-expanded')).toBe('true')
    for (const [name, path] of [['Account security', '/workspace/security'], ['Account workspace', '/workspace']] as const) {
      const link = menu.getByRole('link', { name })
      expect(link.getAttribute('href')).toBe(path)
      expect(link.hasAttribute('data-client-navigation')).toBe(false)
    }
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Account options' })).toBeNull()
    expect(document.activeElement).toBe(account)
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it.each(['IN_REVIEW', 'CHANGES_REQUIRED'] as const)('reveals the exact %s manager rationale only on request and keeps it out of investor discovery', status => {
    const notes = `Private issuer changes for this ${status} package only.`
    const item = product('FUND', { status, offering_package: packageRecord({ issuer_status: 'CHANGES_REQUIRED', issuer_review_notes: notes }), allowed_actions: [] })
    const page = mount(snapshot('OfferingManager', [item]), '/portal/products/detail', productId)
    expect(screen.queryByText(notes)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View recorded package evidence' }))
    expect(screen.getByText('Issuer decision rationale')).toBeTruthy()
    expect(screen.getByText(notes)).toBeTruthy()
    expect(screen.getAllByText(firstPackageId).length).toBeGreaterThan(0)
    page.unmount()

    const published = product('FUND', { status: 'PUBLISHED', offering_package: packageRecord({ issuer_status: 'APPROVED', compliance_status: 'APPROVED',
      technical_readiness_status: 'VERIFIED', subscribable: true, issuer_review_notes: notes }), allowed_actions: [] })
    const investor = snapshot('OfferingManager', [published])
    delete investor.stage2_access; delete investor.offering_access
    investor.operating_context = { mode: 'ROLE', organisationId: managerOrganisation, role: 'Investor' }
    investor.organisations = []
    render(<PortalScreen data={{ user: { id: investor.actor.id, email: investor.actor.email }, snapshot: investor }} view="/portal/opportunities/detail" id={productId} operatingContext={investor.operating_context} release={release} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(published.terms.name)
    expect(screen.queryByText(notes)).toBeNull()
    expect(screen.queryByText('Issuer decision rationale')).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('keeps an unsaved fund draft safe and reaches Edit details from the connected preparation step', () => {
    mount(withFundProgress(snapshot('OfferingManager', [product('FUND')]), 'PREPARATION'), '/portal/products/detail', productId)
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Fictional unsaved fund edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    expect(screen.getByText('Complete and save the product details, then submit the saved version for review.')).toBeTruthy()
    expect(screen.getByText('Save your changes in Edit details before submitting. They are not part of the saved package yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit immutable offering package' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Edit details' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Edit details' }))
    expect((screen.getByLabelText('Product name') as HTMLInputElement).value).toBe('Fictional unsaved fund edit')
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('reaches the existing appointment form from connected fund review without creating a second next-step card', () => {
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord(), allowed_actions: [] })
    mount(withFundProgress(snapshot('OfferingManager', [item])), '/portal/products/detail', productId)
    expect(screen.getByLabelText('Next fund action')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your next step' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Appointments' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Appointments' }))
    expect(screen.getByLabelText(/^Appointment evidence reference/)).toBeTruthy()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('mounts and focuses the existing documents/signing section from connected fund review', () => {
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord(), allowed_actions: [] })
    const applied = (['IssuerFundManager', 'ComplianceOfficer'] as const).map(role => appointment(role, { status: 'APPLIED', effective: true }))
    mount(withFundProgress(snapshot('OfferingManager', [item], applied)), '/portal/products/detail', productId)
    fireEvent.click(screen.getByRole('button', { name: 'Open Documents & signing' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Documents & signing' }))
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('connects the genuine STANDARD TEST role-play manager to the existing fund tabs and DocuSign check without creating authority', async () => {
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord(), allowed_actions: [] })
    item.terms = prepareCommonEnvelopeUpgrade(item.terms as FundTermsV2, productOrganisation, issuerOrganisation, receiptId)
    const value = snapshot('OfferingManager', [item])
    delete value.stage2_access
    value.base_records_available = false
    value.offering_access!.session_mode = 'STANDARD'
    value.offering_access!.allowed_commands = ['request_product_service_appointment']
    value.organisations[0].authority_source = 'TEST_ROLE_PLAY'
    value.organisations[0].capabilities = []
    mount(withFundProgress(value), '/portal/products/detail', productId)
    expect(screen.getByRole('navigation', { name: 'Product workspace sections' })).toBeTruthy()
    expect(fetchOfferingReads).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Appointments' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Appointments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Documents & signing' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Documents & signing' }))
    expect(screen.getByRole('button', { name: 'Check DocuSign sandbox connection' })).toBeTruthy()
    await screen.findByText('Signature authority unavailable')
    expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit immutable offering package' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Create a product' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('shows the same submitted package tabs to the genuinely appointed STANDARD issuer with limited base records', () => {
    const item = product('FUND', { status: 'IN_REVIEW', offering_package: packageRecord({ can_review_issuer: true }), allowed_actions: ['review_offering_issuer'] })
    const applied = appointment('IssuerFundManager', { appointee_user_id: manager, requested_by_user_id: manager,
      reviewed_by_user_id: manager, reviewer_scope_organisation_id: issuerOrganisation,
      status: 'APPLIED', effective: true, approval_receipt_id: receiptId, next_owner: 'NONE' })
    const value = snapshot('IssuerFundManager', [item], [applied], manager)
    delete value.stage2_access; value.offering_access!.session_mode = 'STANDARD'
    value.base_records_available = false; value.organisations = []
    mount(withFundProgress(value), '/portal/products/detail', productId)
    expect(screen.getByRole('navigation', { name: 'Product workspace sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record issuer decision' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Create a product' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
    expect(fetchOfferingReads).not.toHaveBeenCalled()
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('focuses the %s details handoff without losing an unsaved edit or enabling submission', kind => {
    mount(snapshot('OfferingManager', [product(kind)]), '/portal/products/detail', productId)
    const editedName = `Fictional unsaved ${kind} draft`
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: editedName } })
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Review & next step' }))
    expect(screen.queryByRole('button', { name: 'Submit immutable offering package' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Edit details' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Edit details' }))
    expect((screen.getByLabelText('Product name') as HTMLInputElement).value).toBe(editedName)
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('focuses the %s appointments handoff and retains the mounted appointment draft', kind => {
    const item = product(kind, { status: 'IN_REVIEW', offering_package: packageRecord(), allowed_actions: [] })
    mount(snapshot('OfferingManager', [item]), '/portal/products/detail', productId)
    fireEvent.click(screen.getByRole('button', { name: 'Open Appointments' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Appointments' }))
    const evidence = 'Fictional unsaved appointment evidence for this exact product.'
    fireEvent.change(screen.getByLabelText(/^Appointment evidence reference/), { target: { value: evidence } })
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Appointments' }))
    expect((screen.getByLabelText(/^Appointment evidence reference/) as HTMLTextAreaElement).value).toBe(evidence)
    expect(screen.queryByRole('button', { name: 'Record issuer decision' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('mounts and focuses the %s documents handoff, then keeps its content mounted when switching', kind => {
    const item = product(kind, { status: 'IN_REVIEW', offering_package: packageRecord(), allowed_actions: [] })
    const applied = (['IssuerFundManager', 'ComplianceOfficer'] as const).map(role => appointment(role, { status: 'APPLIED', effective: true }))
    mount(snapshot('OfferingManager', [item], applied), '/portal/products/detail', productId)
    expect(document.getElementById(`product-${productId}-DOCUMENTS`)).toBeNull()
    expect(screen.getByRole('button', { name: 'View recorded package evidence' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Open Documents & signing' }))
    const documents = screen.getByRole('region', { name: 'Documents & signing' })
    expect(document.activeElement).toBe(documents)
    fireEvent.click(screen.getByRole('button', { name: 'Review & next step' }))
    expect(document.getElementById(`product-${productId}-DOCUMENTS`)).toBe(documents)
    expect(documents.hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open Documents & signing' }))
    expect(document.activeElement).toBe(documents)
    expect(documents.hidden).toBe(false)
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it.each(['NOT_CONNECTED', 'NOT_ADMITTED', 'DEPLOYMENT'] as const)('uses only a real document destination or a waiting message for the %s prerequisite', prerequisite => {
    const document_evidence = prerequisite === 'NOT_CONNECTED'
      ? { profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'SEALED_SIGNATURE_REQUIRED', manifest_id: receiptId,
        manifest_hash: hash, signature_status: 'NOT_CONNECTED', approval_allowed: false } as const
      : prerequisite === 'NOT_ADMITTED' ? { version: 2, profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'SEALED_SIGNATURE_REQUIRED', manifest_id: receiptId,
        manifest_hash: hash, signature_status: 'NOT_ADMITTED', approval_allowed: false } as const : undefined
    const pkg = packageRecord({ issuer_status: 'APPROVED', compliance_status: 'APPROVED', ...(document_evidence ? { document_evidence } : {}) })
    const applied = (['IssuerFundManager', 'ComplianceOfficer'] as const).map(role => appointment(role, { status: 'APPLIED', effective: true }))
    mount(snapshot('OfferingManager', [product('FUND', { status: 'IN_REVIEW', offering_package: pkg, allowed_actions: [] })], applied), '/portal/products/detail', productId)
    expect(screen.getByText(prerequisite === 'DEPLOYMENT' ? /package still needs verified blockchain deployment/ : /Document signing is not connected for this package yet/)).toBeTruthy()
    if (prerequisite === 'DEPLOYMENT') {
      expect(screen.queryByRole('button', { name: /^Open (Edit details|Appointments|Documents & signing)$/ })).toBeNull()
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Open Documents & signing' }))
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Documents & signing' }))
      expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Open approved offering' })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })
})

describe('subscription reservation orders handoff', () => {
  function investorFixture() {
    const item = product('FUND', { status: 'PUBLISHED', allowed_actions: [], offering_package: packageRecord({
      issuer_status: 'APPROVED', compliance_status: 'APPROVED', technical_readiness_status: 'VERIFIED', subscribable: true,
    }) })
    const value = snapshot('OfferingManager', [item])
    delete value.stage2_access; delete value.offering_access
    value.operating_context = { mode: 'ROLE', role: 'Investor', organisationId: managerOrganisation }
    value.organisations = []
    value.applications = [{ id: secondPackageId, user_id: manager, persona: 'INVESTOR', status: 'APPROVED', revision: 1,
      details: { full_name: 'Fictional Investor', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
        source_of_funds: 'Fictional savings for this synthetic reservation.', beneficial_owners: '', experience: 'Fictional investment experience for review.',
        documents: [], test_data_acknowledged: true }, submitted_at: past(), reviewed_at: past(), reviewer_id: productReviewer,
      review_notes: null, organisation_id: null, review_checks: {}, provider_mode: 'MANUAL_TEST_REVIEW', approved_until: expiry() }]
    value.accounts = [{ id: thirdPackageId, holder_user_id: manager, application_id: secondPackageId, kind: 'INDIVIDUAL', status: 'ACTIVE', created_at: past() }]
    value.product_eligibility = [{ id: receiptId, investment_account_id: thirdPackageId, product_id: productId, organisation_id: productOrganisation,
      product_revision: item.revision, offering_revision_id: firstPackageId, terms_hash: hash, application_revision: 1, revision: 1,
      status: 'APPROVED', investor_statement: 'Fictional product suitability and source-of-funds statement.', submitted_at: past(), reviewed_at: past(),
      reviewer_id: productReviewer, review_notes: 'Fictional independently approved eligibility.', review_checks: {}, approved_until: expiry(),
      effective: true, can_decide: false, can_approve: false, can_revoke: false, holder_user_id: manager, product_name: item.terms.name,
      account_kind: 'INDIVIDUAL', investor_application: value.applications[0] }]
    const reservation = { id: requestKey, product_id: productId, investment_account_id: thirdPackageId, investor_id: manager, product_name: item.terms.name,
      organisation_id: productOrganisation, product_revision: item.revision, offering_revision_id: firstPackageId, terms_hash: hash,
      units: item.terms.minimum_units, amount_minor: (BigInt(item.terms.minimum_units) * BigInt(item.terms.unit_price_minor)).toString(),
      currency: item.terms.currency, status: 'AWAITING_FUNDING' as const, created_at: past() }
    nextResult = { ...value, subscriptions: [reservation, { ...reservation, id: receiptId }] }
    const onSaved = vi.fn()
    render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><SubscriptionForm product={item} snapshot={value} onSaved={onSaved} operatingContext={value.operating_context} /></PortalCommandProvider>)
    checkLabels([/I have read and accept the memorandum/, /I have read the risk disclosures/])
    return { item, value, onSaved }
  }

  it('keeps an ambiguous confirmed reservation on the generic orders route without guessing or submitting again', async () => {
    const { item, value, onSaved } = investorFixture()
    fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await saved()
    recorded('subscribe', { product_id: productId, offering_revision_id: firstPackageId, investment_account_id: thirdPackageId, units: item.terms.minimum_units })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'View my subscription orders' }).getAttribute('href')).toBe(portalScopeHref('/portal/portfolio', value.operating_context))
    expect(screen.getByText('Check your saved orders')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept terms and reserve units' })).toBeNull()
    expect(screen.getByText(/Approved funding instructions may still be pending/)).toBeTruthy()
    expect(screen.getByText(/Only verified settlement and confirmed issuance can create a holding/)).toBeTruthy()
  })

  it('defers orders navigation for an unknown reservation and recovers the original request before restoring the link', async () => {
    const { value, onSaved } = investorFixture()
    failTransport = true
    fireEvent.click(screen.getByRole('button', { name: 'Accept terms and reserve units' }))
    await screen.findByRole('button', { name: 'Retry the original saved request' })
    const original = JSON.parse(String(fetchCommand.mock.calls[0][1]?.body))
    expect(screen.queryByRole('link', { name: 'View my subscription orders' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Accept terms and reserve units' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect(screen.getByText(/Resolve the original saved request above before leaving this page/)).toBeTruthy()
    expect(sessionStorage.length).toBe(1)
    expect(onSaved).not.toHaveBeenCalled()
    failTransport = false; expectedFetchCount = 1
    fireEvent.click(screen.getByRole('button', { name: 'Retry the original saved request' }))
    await saved()
    expect(lastRequest.key).toBe(original.key)
    expect(lastRequest.payload).toEqual(original.payload)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retry the original saved request' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View my subscription orders' }).getAttribute('href')).toBe(portalScopeHref('/portal/portfolio', value.operating_context))
    expect(screen.queryByRole('link', { name: 'Continue with this order' })).toBeNull()
  })
})

describe('profiled document review remains signature-blocked', () => {
  it.each(['FUND', 'REAL_ESTATE'] as const)('keeps both independent %s reviewer decisions CHANGES_REQUIRED after a clean seal', async kind => {
    for (const role of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const document_evidence = { profile: 'PDF_SIGNATURE_REQUIRED_V1' as const, state: 'SEALED_SIGNATURE_REQUIRED' as const,
        manifest_id: receiptId, manifest_hash: 'aa'.repeat(32), signature_status: 'NOT_CONNECTED' as const, approval_allowed: false as const }
      const item = product(kind, { status: 'IN_REVIEW', offering_package: packageRecord({ can_review_issuer: true,
        can_review_compliance: true, document_evidence }), allowed_actions: [role === 'IssuerFundManager' ? 'review_offering_issuer' : 'review_product'] })
      const value = snapshot(role, [item])
      nextResult = snapshot(role, [{ ...item, revision: 2, status: 'CHANGES_REQUIRED' }])
      const Review = role === 'IssuerFundManager' ? IssuerOfferingReview : ProductReview
      const page = render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><Review product={item} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
      const choice = screen.getByLabelText(role === 'IssuerFundManager' ? 'Issuer decision' : 'Decision') as HTMLSelectElement
      expect(choice.value).toBe('CHANGES_REQUIRED')
      expect((choice.querySelector('option[value="APPROVED"]') as HTMLOptionElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText(role === 'IssuerFundManager' ? /^Issuer rationale/ : 'Review rationale'), { target: { value: 'Genuine signatures are not connected; request the exact corrected immutable package evidence.' } })
      fireEvent.click(screen.getByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' }))
      await saved()
      recorded(role === 'IssuerFundManager' ? 'review_offering_issuer' : 'review_product', { decision: 'CHANGES_REQUIRED', offering_revision_id: firstPackageId })
      page.unmount()
    }
  })

  it('uses the existing durable reopen command for terminal same-terms PDF correction, not a new product writer', async () => {
    const item = product('FUND', { status: 'CHANGES_REQUIRED', allowed_actions: ['reopen_offering_review'], offering_package: packageRecord({
      document_evidence: { profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'REJECTED_OR_EXCLUDED', manifest_id: null,
        manifest_hash: null, signature_status: 'NOT_CONNECTED', approval_allowed: false } }) })
    const value = snapshot('OfferingManager', [item])
    nextResult = snapshot('OfferingManager', [{ ...item, revision: 2, status: 'IN_REVIEW', offering_package: { ...item.offering_package!, id: secondPackageId } }])
    render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><ProductActions product={item} availableCommands={['reopen_offering_review']} onSaved={() => {}} /></PortalCommandProvider>)
    fireEvent.change(screen.getByLabelText(/^Reason for re-review/), { target: { value: 'Correct terminal rejected PDF bytes under the same retained immutable package terms.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create new review revision' }))
    await saved()
    recorded('reopen_offering_review', { product_id: productId, expected_revision: 1 })
    expect(screen.getByText(/new revision inherits no earlier PDF manifest/)).toBeTruthy()
  })
})

describe('connected v3 issuer execution in existing dashboards', () => {
  function signatureProduct(kind: 'FUND' | 'REAL_ESTATE'): PortalProduct {
    const item = product(kind)
    const terms = prepareCommonEnvelopeUpgrade(item.terms as FundTermsV2 | RealEstateTermsV2, productOrganisation, issuerOrganisation, receiptId)
    if (terms.asset_type === 'REAL_ESTATE') { terms.issuer_name = terms.real_estate.spv.legal_name; terms.common_envelope.issuer.legal_name = terms.real_estate.spv.legal_name }
    const pkg = packageRecord({ can_review_issuer: true, can_review_compliance: true, common_envelope: terms.common_envelope,
      deployment_configuration: terms.deployment_configuration, common_envelope_hash: 'b'.repeat(64), deployment_configuration_hash: 'c'.repeat(64),
      document_evidence: { version: 2, profile: 'PDF_SIGNATURE_REQUIRED_V1', state: 'SEALED_SIGNATURE_REQUIRED', manifest_id: receiptId,
        manifest_hash: hash, signature_status: 'EVIDENCE_RETAINED', approval_allowed: true } })
    return { ...item, terms, status: 'IN_REVIEW', offering_package: pkg, allowed_actions: ['review_product', 'review_offering_issuer'] }
  }

  it.each(['IssuerFundManager', 'ComplianceOfficer'] as const)('shows the genuine same-operator TEST %s form only with current backend review and appointment flags', role => {
    const item = signatureProduct('FUND'), actualOperator = manager
    const applied = appointment(role, { appointee_user_id: actualOperator, requested_by_user_id: actualOperator,
      reviewed_by_user_id: actualOperator, reviewer_scope_organisation_id: context(role).organisationId,
      status: 'APPLIED', effective: true, approval_receipt_id: receiptId, next_owner: 'NONE' })
    const value = snapshot(role, [item], [applied], actualOperator)
    delete value.stage2_access; value.offering_access!.session_mode = 'STANDARD'
    const Review = role === 'IssuerFundManager' ? IssuerOfferingReview : ProductReview
    const label = role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision'
    const renderReview = (environment: 'TESTNET' | 'MAINNET') => <PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment={environment}>
      <Review product={item} snapshot={value} onSaved={vi.fn()} />
    </PortalCommandProvider>
    const page = render(renderReview('TESTNET'))
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.getByText(/Independent human approval is not proved/)).toBeTruthy()
    page.rerender(renderReview('MAINNET'))
    expect(screen.queryByRole('button', { name: label })).toBeNull()
    page.rerender(renderReview('TESTNET'))
    value.product_appointments![0].effective = false
    page.rerender(renderReview('TESTNET'))
    expect(screen.queryByRole('button', { name: label })).toBeNull()
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it('keeps the current signature requirement while presenting an authorised same-operator TEST reviewer', () => {
    const item = signatureProduct('FUND')
    item.offering_package!.document_evidence = { ...item.offering_package!.document_evidence!, version: 2, signature_status: 'NOT_ADMITTED', approval_allowed: false }
    const value = snapshot('IssuerFundManager', [item], [appointment('IssuerFundManager', { appointee_user_id: manager,
      requested_by_user_id: manager, reviewed_by_user_id: manager, reviewer_scope_organisation_id: issuerOrganisation,
      status: 'APPLIED', effective: true, approval_receipt_id: receiptId, next_owner: 'NONE' })], manager)
    delete value.stage2_access; value.offering_access!.session_mode = 'STANDARD'
    render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET">
      <IssuerOfferingReview product={item} snapshot={value} onSaved={vi.fn()} />
    </PortalCommandProvider>)
    expect(screen.getByText('Current signature evidence required')).toBeTruthy()
    expect((screen.getByLabelText('Issuer decision') as HTMLSelectElement).value).toBe('CHANGES_REQUIRED')
    expect((screen.getByRole('option', { name: 'Approve this exact package' }) as HTMLOptionElement).disabled).toBe(true)
    expect(fetchCommand).not.toHaveBeenCalled()
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('mounts actual %s signature reads in manager, appointed issuer and Compliance screens', async kind => {
    for (const role of ['OfferingManager', 'IssuerFundManager', 'ComplianceOfficer'] as const) {
      const item = signatureProduct(kind), value = snapshot(role, [item], [appointment('IssuerFundManager', { status: 'APPLIED', effective: true, approval_receipt_id: receiptId })])
      const signatureFetch = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toContain('/api/portal/offering-signatures?revision_id=')
        expect(init?.headers).toEqual({ 'x-bx1-expected-actor': actorFor(role) })
        return new Response(JSON.stringify({ version: 1, actor_id: actorFor(role), session_id: receiptId, context: context(role), environment: 'TESTNET',
          product_id: productId, revision_id: firstPackageId, expected_revision: item.revision, purpose: 'ISSUER_PACKAGE_EXECUTION', admitted: false,
          authorisations: [], operations: [], allowed_commands: [], blocker: 'Synthetic unadmitted fixture; not provider acceptance.' }))
      })
      vi.stubGlobal('fetch', signatureFetch)
      const page = mount(value, role === 'ComplianceOfficer' ? '/portal/compliance/detail' : '/portal/products/detail', productId)
      if (role !== 'ComplianceOfficer') {
        expect(signatureFetch).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Documents & signing' }))
      }
      await screen.findByText('Signature processing not admitted')
      expect(screen.getByRole('heading', { name: 'Issuer package execution' })).toBeTruthy()
      expect(signatureFetch).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: 'Get my DocuSign signing link' })).toBeNull()
      page.unmount()
    }
  })

  it.each(['FUND', 'REAL_ESTATE'] as const)('releases the exact %s review fence only for current evidence and keeps changes available', async kind => {
    for (const role of ['IssuerFundManager', 'ComplianceOfficer'] as const) {
      const item = signatureProduct(kind), value = snapshot(role, [item])
      const Review = role === 'IssuerFundManager' ? IssuerOfferingReview : ProductReview
      const page = render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><Review product={item} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
      const choice = screen.getByLabelText(role === 'IssuerFundManager' ? 'Issuer decision' : 'Decision') as HTMLSelectElement
      expect((choice.querySelector('option[value="APPROVED"]') as HTMLOptionElement).disabled).toBe(false)
      expect(choice.querySelector('option[value="CHANGES_REQUIRED"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: role === 'IssuerFundManager' ? 'Record issuer decision' : 'Record Compliance decision' }).hasAttribute('disabled')).toBe(true)
      page.unmount()
      const stale = { ...item, offering_package: { ...item.offering_package!, document_evidence: { ...item.offering_package!.document_evidence!, version: 2 as const, signature_status: 'NON_CURRENT' as const, approval_allowed: false } } } as PortalProduct
      const stalePage = render(<PortalCommandProvider snapshot={value} operatingContext={value.operating_context} environment="TESTNET"><Review product={stale} snapshot={value} onSaved={() => {}} /></PortalCommandProvider>)
      const staleChoice = screen.getByLabelText(role === 'IssuerFundManager' ? 'Issuer decision' : 'Decision') as HTMLSelectElement
      expect(staleChoice.value).toBe('CHANGES_REQUIRED')
      expect((staleChoice.querySelector('option[value="APPROVED"]') as HTMLOptionElement).disabled).toBe(true)
      stalePage.unmount()
    }
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
