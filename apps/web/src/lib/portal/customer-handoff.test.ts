import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { customerHandoffHasAction, customerHandoffHref, customerHandoffSchema, customerScopedReadAvailable, validatedCustomerHandoff, type CustomerHandoff } from './customer-handoff'
import { entryApplication, entryFixture, entryHandoff, entryMandate, entryOrganisationId } from './entry-test-fixtures'

const other = '44444444-4444-4444-8444-444444444444'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
function fixture(applicationOverrides: Parameters<typeof entryApplication>[0] = {}, handoffOverrides: Partial<CustomerHandoff> = {}) {
  const application = entryApplication({ review_route: 'AVAILABLE', ...applicationOverrides })
  application.handoff = entryHandoff(application, handoffOverrides)
  return { application, snapshot: entryFixture([application]) }
}
function approved(overrides: Partial<CustomerHandoff> = {}) {
  return fixture({ status: 'APPROVED', approved_until: '2027-01-01T00:00:00Z', provider_mode: 'MANUAL_TEST_REVIEW' }, overrides)
}
describe('bound advisory customer handoff', () => {
  it('preserves application id and revision while enabling only recorded preparation/submission', () => {
    const { snapshot, application } = fixture()
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(handoff?.application_id).toBe(application.id)
    expect(handoff?.application_revision).toBe(application.revision)
    expect(customerHandoffHasAction(handoff, 'SUBMIT_APPLICATION')).toBe(true)
    expect(customerHandoffHref(handoff)).toBeNull()
  })
  it.each(['actor_id', 'application_id'] as const)('denies another identity/reference in %s', field => {
    const { snapshot, application } = fixture({}, { [field]: other })
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it.each([
    { application_revision: 2 }, { persona: 'WEALTH_MANAGER' }, { environment: 'MAINNET' },
    { operating_context: { mode: 'ROLE', organisationId: entryOrganisationId, role: 'SuperAdmin' } },
    { allowed_actions: ['PREPARE_APPLICATION', 'PREPARE_APPLICATION'] },
  ] as Partial<CustomerHandoff>[])('rejects stale/wrong environment/capacity/context %j', override => {
    const { snapshot, application } = fixture({}, override)
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('does not infer an action from raw approved status when projection is missing', () => {
    const { snapshot, application } = approved()
    delete application.handoff
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
    expect(customerHandoffHasAction(null, 'OPEN_INVESTMENT_ACCOUNT')).toBe(false)
    expect(customerHandoffHref(null)).toBeNull()
  })
  it('requires the environment/actor workflow envelope even for an otherwise valid projection', () => {
    const { snapshot, application } = fixture()
    delete snapshot.workflow
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
    expect(customerScopedReadAvailable(snapshot, 'TESTNET')).toBe(false)
  })
  it('keeps absent reviewer preparation separate from staffed submission', () => {
    const { snapshot, application } = fixture({ review_route: 'REVIEWER_UNAVAILABLE' })
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(customerHandoffHasAction(handoff, 'PREPARE_APPLICATION')).toBe(true)
    expect(customerHandoffHasAction(handoff, 'SUBMIT_APPLICATION')).toBe(false)
    expect(handoff?.blocker).toBe('REVIEWER_UNAVAILABLE')
  })
  it('retains rejected same-application reapplication without changing the rejection', () => {
    const { snapshot, application } = fixture({ status: 'REJECTED', revision: 4, review_notes: 'Synthetic review rejection retained.' })
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(handoff?.state).toBe('REAPPLICATION_REQUIRED')
    expect(customerHandoffHasAction(handoff, 'SUBMIT_APPLICATION')).toBe(true)
    expect(application.status).toBe('REJECTED'); expect(application.revision).toBe(4)
  })
  it.each(['MONITORING_ON_HOLD', 'MONITORING_RENEWAL_REQUIRED', 'ADMISSION_EXPIRED', 'PROVIDER_UNSUPPORTED', 'ACCOUNT_SUSPENDED'] as const)('rejects an enabled approval action despite %s', blocker => {
    const { snapshot, application } = approved({ blocker })
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('denies expired approval even when a stale read still advertises opening', () => {
    const { snapshot, application } = approved()
    application.approved_until = '2026-10-05T00:00:00Z'
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('rejects approved-but-unassigned evidence mode instead of inventing provider clearance', () => {
    const { snapshot, application } = approved()
    application.provider_mode = 'UNASSIGNED'
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('shows a recorded hold with no destination rather than overriding it', () => {
    const { snapshot, application } = approved({ state: 'UNAVAILABLE', blocker: 'MONITORING_ON_HOLD', next_owner: 'COMPLIANCE', allowed_actions: [], destination: 'NONE', gates: { intake_admitted: true, reviewer_available: true, monitoring_allows_new_actions: false } })
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(handoff?.next_owner).toBe('COMPLIANCE'); expect(customerHandoffHref(handoff)).toBeNull()
  })
  it('distinguishes account opening from a suspended existing account', () => {
    const { snapshot, application } = approved({ accounts: [{ id: other, kind: 'INDIVIDUAL', status: 'SUSPENDED' }] })
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('uses the supported account route without inventing account-detail URLs', () => {
    const { snapshot, application } = approved({ state: 'ACCOUNT_AVAILABLE', accounts: [{ id: other, kind: 'INDIVIDUAL', status: 'ACTIVE' }], allowed_actions: ['VIEW_INVESTMENT_ACCOUNT'] })
    expect(customerHandoffHref(validatedCustomerHandoff(snapshot, application, 'TESTNET'))).toBe('/portal/portfolio?mode=applicant')
  })
  it('does not advertise an account destination through an unavailable scoped reader', () => {
    const { snapshot, application } = approved()
    snapshot.workflow!.scoped_read_available = false
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('routes entity mandate request separately from account view authority', () => {
    const { snapshot, application } = approved({ state: 'REQUEST_MANDATE', accounts: [{ id: other, kind: 'ENTITY', status: 'ACTIVE' }], allowed_actions: ['REQUEST_INVESTING_REPRESENTATIVE_MANDATE'] })
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(customerHandoffHasAction(handoff, 'VIEW_INVESTMENT_ACCOUNT')).toBe(false)
    expect(customerHandoffHref(handoff)).toBe('/portal/portfolio?mode=applicant')
  })
  it('does not turn manager admission into an applied role or signing authority', () => {
    const { snapshot, application } = fixture({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2027-01-01T00:00:00Z', provider_mode: 'MANUAL_TEST_REVIEW' })
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(customerHandoffHasAction(handoff, 'REQUEST_REPRESENTATIVE_MANDATE')).toBe(true)
    expect(customerHandoffHasAction(handoff, 'ENTER_OPERATING_WORKSPACE')).toBe(false)
    expect(snapshot.contexts).toEqual([])
  })
  it('requires applied effective mandate and matching current native context for manager workspace', () => {
    const { snapshot, application } = fixture({ persona: 'WEALTH_MANAGER', status: 'APPROVED', approved_until: '2027-01-01T00:00:00Z', provider_mode: 'MANUAL_TEST_REVIEW' }, { state: 'WORKSPACE_AVAILABLE', allowed_actions: ['ENTER_OPERATING_WORKSPACE'], destination: 'OPERATING_WORKSPACE', mandate: { id: other, status: 'APPLIED', effective: true }, native_context: { organisation_id: entryOrganisationId, role: 'OfferingManager' } })
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
    snapshot.contexts = [{ context_key: entryOrganisationId, organisation_id: entryOrganisationId, name: 'Synthetic manager', roles: ['OfferingManager'] }]
    snapshot.organisation_mandates = [entryMandate({ id: other, status: 'APPLIED', effective: true, native_organisation_id: entryOrganisationId })]
    const handoff = validatedCustomerHandoff(snapshot, application, 'TESTNET')
    expect(customerHandoffHref(handoff)).toBe(`/portal?organisation=${entryOrganisationId}&role=OfferingManager`)
    application.handoff!.mandate!.effective = false
    expect(validatedCustomerHandoff(snapshot, application, 'TESTNET')).toBeNull()
  })
  it('rejects arbitrary URLs/unknown fields and unrecognised provider actions', () => {
    const { application } = fixture()
    expect(customerHandoffSchema.safeParse({ ...application.handoff, href: 'https://attacker.invalid' }).success).toBe(false)
    expect(customerHandoffSchema.safeParse({ ...application.handoff, allowed_actions: ['AUTO_APPROVE'] }).success).toBe(false)
  })
  it('retains the same MAIN contract with a specific unadmitted blocker and no scoped business read', () => {
    const { application } = fixture({}, { environment: 'MAINNET', state: 'UNAVAILABLE', next_owner: 'PROVIDER_OWNER', blocker: 'INTAKE_NOT_ADMITTED', allowed_actions: [], destination: 'NONE', gates: { intake_admitted: false, reviewer_available: false, monitoring_allows_new_actions: false } })
    const snapshot = entryFixture([application], 'MAINNET')
    expect(validatedCustomerHandoff(snapshot, application, 'MAINNET')?.blocker).toBe('INTAKE_NOT_ADMITTED')
    expect(customerScopedReadAvailable(snapshot, 'MAINNET')).toBe(false)
    snapshot.workflow!.scoped_read_available = true
    expect(customerScopedReadAvailable(snapshot, 'MAINNET')).toBe(false)
    expect(validatedCustomerHandoff(snapshot, application, 'MAINNET')).toBeNull()
  })
})
