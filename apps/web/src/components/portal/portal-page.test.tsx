import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ load: vi.fn(), guard: vi.fn(), screen: vi.fn(), entry: vi.fn() }))
vi.mock('@/lib/portal/server', () => ({ requirePortalEnvironment: fixture.guard, PortalError: class extends Error { constructor(message: string, public readonly status: number) { super(message) } } }))
vi.mock('@/lib/portal/dashboard-server', () => ({ loadRoleDashboard: fixture.load }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./portal-screens', () => ({ PortalScreen: (props: unknown) => { fixture.screen(props); return createElement('p', null, 'Scoped business screen') } }))
vi.mock('./portal-shell', () => ({ PortalShell: ({ children }: { children: ReactNode }) => createElement('section', null, children) }))
vi.mock('./role-dashboard', () => ({ RoleDashboardContent: () => createElement('p', null, 'Contextual role help') }))
vi.mock('./entry-screen', () => ({ EntryScreen: (props: unknown) => { fixture.entry(props); return createElement('p', null, 'Saved identity capacities') } }))
import { PortalError } from '@/lib/portal/server'
import { PortalPage } from './portal-page'
import { entryApplication, entryFixture } from '@/lib/portal/entry-test-fixtures'
import type { PortalOrganisationMandate } from '@/lib/portal/contracts'

const organisation = '33333333-3333-4333-8333-333333333333'
const otherOrganisation = '44444444-4444-4444-8444-444444444444'
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'actor@example.invalid' }
const context = { mode: 'ROLE' as const, organisationId: organisation, role: 'Investor' as const }
const scope = { organisationId: organisation, organisationName: 'Fictional organisation', role: 'Investor' as const }
const release = { version: '1.1.0-rc.3', environment: 'TESTNET' as const, source: 'a'.repeat(12) }
function roleData() {
  return { kind: 'role' as const, user, release, scope, scopes: [scope], operatingContext: context, availablePaths: ['/portal/opportunities'], queue: [], queueMessage: undefined,
    portal: { user, snapshot: { actor: { ...user, can_review: false }, operating_context: context, applications: [], organisations: [], products: [], subscriptions: [], events: [] } } }
}
const mandateId = '55555555-5555-4555-8555-555555555555'
function approvedMandate(change: Partial<PortalOrganisationMandate> = {}): PortalOrganisationMandate {
  return { id: mandateId, application_id: 'application', product_organisation_id: 'product-org', native_organisation_id: null,
    reviewer_scope_organisation_id: organisation, applicant_user_id: 'separate-applicant', organisation_name: 'Fictional customer',
    role: 'OfferingManager', status: 'APPROVED', revision: 2, requested_until: '2099-10-20T00:00:00Z',
    evidence_reference: 'Synthetic appointment evidence', review_notes: 'Independent appointment review',
    reviewer_user_id: 'separate-reviewer', applied_by_user_id: null, admission_revision: 3, admission_status: 'APPROVED',
    admission_approved_until: '2099-10-20T00:00:00Z', admission_purpose: 'CUSTOMER_ORGANISATION_ADMISSION',
    effective: false, next_owner: 'SUPER_ADMIN', can_request: false, can_review: false, can_apply: true, can_revoke: false, ...change }
}
function adminData(mandate = approvedMandate()) {
  const data = roleData()
  const adminContext = { ...context, role: 'SuperAdmin' as const }
  const adminScope = { ...scope, role: 'SuperAdmin' as const }
  return { ...data, scope: adminScope, scopes: [adminScope], operatingContext: adminContext,
    portal: { ...data.portal, snapshot: { ...data.portal.snapshot, operating_context: adminContext,
      mandate_queue_available: true, organisation_mandates: [mandate] } } }
}
beforeEach(() => { vi.resetAllMocks(); fixture.load.mockResolvedValue(roleData()) })

describe('portal server page access and selected context', () => {
  it('renders the pause inside the existing shell without business or application mutation components', async () => {
    const entry = entryFixture([entryApplication({ status: 'SUBMITTED' })])
    fixture.load.mockResolvedValueOnce({ kind: 'ordinary-entry', user: entry.actor, entry, release, scopes: [scope], scope, operatingContext: context, portal: undefined })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal', query: { organisation, role: 'Investor', add: 'capacity' } }))
    expect(html).toContain('Authenticator paused for ordinary Testnet entry')
    expect(html).toContain('My application status'); expect(html).toContain('submitted')
    expect(html).toContain('Your existing authenticator has not been removed')
    expect(html).not.toContain('<input'); expect(html).not.toContain('<form'); expect(html).not.toContain('Create or continue')
    expect(fixture.entry).not.toHaveBeenCalled(); expect(fixture.screen).not.toHaveBeenCalled()
  })
  it.each(['/portal/compliance', '/portal/compliance/detail', '/portal/products', '/portal/portfolio', '/portal/orders/detail'] as const)('requires security step-up without private components or false retry for ordinary %s', async view => {
    const entry = entryFixture()
    fixture.load.mockResolvedValueOnce({ kind: 'ordinary-entry', user: entry.actor, entry, release, scopes: [scope], scope, operatingContext: context, portal: undefined })
    const html = renderToStaticMarkup(await PortalPage({ view, id: 'private-record', query: { organisation, role: 'Investor' } }))
    expect(html).toContain('Authenticator required for protected operations')
    expect(html).toContain('read-only entry only'); expect(html).toContain('Your existing authenticator has not been removed')
    expect(html).toContain('href="/login/mfa"'); expect(html).toContain('Complete sign-in security')
    expect(html).not.toContain('Saved portal state is unavailable'); expect(html).not.toContain('Retry loading the portal')
    expect(html).not.toContain('private-record'); expect(html).not.toContain('<input'); expect(html).not.toContain('<form')
    expect(html).not.toContain('My application status')
    expect(fixture.entry).not.toHaveBeenCalled(); expect(fixture.screen).not.toHaveBeenCalled()
  })
  it('passes an exact own-scope approved mandate apply detail to the existing Super Admin handler without reviewer powers', async () => {
    const data = adminData()
    fixture.load.mockResolvedValueOnce(data)
    renderToStaticMarkup(await PortalPage({ view: '/portal/compliance/detail', id: mandateId, query: { organisation, role: 'SuperAdmin' } }))
    expect(fixture.screen).toHaveBeenCalledWith(expect.objectContaining({ data: data.portal, view: '/portal/compliance/detail',
      id: mandateId, operatingContext: data.operatingContext, scope: data.scope }))
    expect(data.portal.snapshot.actor.can_review).toBe(false)
    expect(fixture.entry).not.toHaveBeenCalled()
  })
  it('reopens the same applied mandate detail with the real receipt and existing guarded revocation flag intact', async () => {
    fixture.load.mockResolvedValueOnce(adminData())
    renderToStaticMarkup(await PortalPage({ view: '/portal/compliance/detail', id: mandateId, query: { organisation, role: 'SuperAdmin' } }))
    const applied = { ...approvedMandate({ status: 'APPLIED', revision: 3, native_organisation_id: otherOrganisation,
      applied_by_user_id: user.id, can_apply: false, can_revoke: true, next_owner: 'NONE', effective: true }),
      approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: '2026-10-02T00:00:00Z' }
    const saved = adminData(applied)
    fixture.load.mockResolvedValueOnce(saved)
    renderToStaticMarkup(await PortalPage({ view: '/portal/compliance/detail', id: mandateId, query: { organisation, role: 'SuperAdmin' } }))
    expect(fixture.screen).toHaveBeenCalledTimes(2)
    expect(fixture.screen).toHaveBeenLastCalledWith(expect.objectContaining({ data: saved.portal, id: mandateId,
      operatingContext: saved.operatingContext }))
    expect(saved.portal.snapshot.organisation_mandates[0]).toEqual(applied)
    expect(saved.portal.snapshot.actor.can_review).toBe(false)
    expect(fixture.entry).not.toHaveBeenCalled()
  })
  it.each([
    { applied_by_user_id: 'other-admin', approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: '2026-10-02T00:00:00Z' },
    { applied_by_user_id: user.id, approval_receipt_id: null, applied_at: '2026-10-02T00:00:00Z' },
    { applied_by_user_id: user.id, approval_receipt_id: '66666666-6666-4666-8666-666666666666', applied_at: null },
  ])('denies an applied mandate without own-applier and actual returned receipt evidence %#', async proof => {
    const applied = { ...approvedMandate({ status: 'APPLIED', native_organisation_id: otherOrganisation,
      can_apply: false, can_revoke: true, next_owner: 'NONE' }), ...proof }
    fixture.load.mockResolvedValueOnce(adminData(applied))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/compliance/detail', id: mandateId, query: { organisation, role: 'SuperAdmin' } }))
    expect(html).toContain('Complete your account access'); expect(fixture.screen).not.toHaveBeenCalled()
  })
  it.each([
    { view: '/portal/compliance' as const, id: mandateId, change: {} },
    { view: '/portal/compliance/detail' as const, id: 'application', change: {} },
    { view: '/portal/compliance/detail' as const, id: 'product-org', change: {} },
    { view: '/portal/compliance/detail' as const, id: undefined, change: {} },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { status: 'SUBMITTED' as const } },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { reviewer_scope_organisation_id: otherOrganisation } },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { can_apply: false } },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { applicant_user_id: user.id } },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { reviewer_user_id: user.id } },
    { view: '/portal/compliance/detail' as const, id: mandateId, change: { can_review: true } },
  ])('does not expose other Compliance routes, records or non-applicable cases to Super Admin %#', async ({ view, id, change }) => {
    fixture.load.mockResolvedValueOnce(adminData(approvedMandate(change)))
    const html = renderToStaticMarkup(await PortalPage({ view, id, query: { organisation, role: 'SuperAdmin' } }))
    expect(html).toContain('Complete your account access')
    expect(html).not.toContain('Fictional customer'); expect(html).not.toContain('Independent appointment review')
    expect(fixture.screen).not.toHaveBeenCalled(); expect(fixture.entry).not.toHaveBeenCalled()
  })
  it('redirects an anonymous session to the existing sign-in route', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Sign in', 401))
    await expect(PortalPage({ view: '/portal' })).rejects.toThrow('REDIRECT:/login')
  })
  it('returns not-found for disabled business routes before loading data', async () => {
    fixture.guard.mockImplementationOnce(() => { throw new PortalError('Not enabled', 404) })
    await expect(PortalPage({ view: '/portal/products' })).rejects.toThrow('NOT_FOUND')
    expect(fixture.load).not.toHaveBeenCalled()
  })
  it('offers sign-in security without granting roles when the selected context lacks access', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Denied', 403))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).toContain('Complete your account access'); expect(html).toContain('href="/login/mfa"'); expect(html).toContain('No new privileges')
    expect(fixture.screen).not.toHaveBeenCalled()
  })
  it('shows a truthful retry state without leaking backend errors', async () => {
    fixture.load.mockRejectedValueOnce(new Error('private database diagnostic'))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal' }))
    expect(html).toContain('Saved portal state is unavailable'); expect(html).not.toContain('private database diagnostic')
  })
  it('passes selected role, organisation, record, release and scope to a child business screen', async () => {
    const query = { organisation, role: 'Investor' }
    const data = roleData()
    fixture.load.mockResolvedValueOnce(data)
    const node = await PortalPage({ view: '/portal/opportunities/detail', id: 'selected-product', query })
    renderToStaticMarkup(node)
    expect(fixture.guard).toHaveBeenCalledTimes(1)
    expect(fixture.load).toHaveBeenCalledWith(query)
    expect(fixture.screen).toHaveBeenCalledWith(expect.objectContaining({ data: data.portal, view: '/portal/opportunities/detail', id: 'selected-product', operatingContext: context, release, scope, scopes: [scope] }))
    expect(node.key).toContain(`${user.id}:TESTNET:${organisation}:Investor:/portal/opportunities/detail:selected-product`)
  })
  it('uses the same operational renderer for the root dashboard', async () => {
    renderToStaticMarkup(await PortalPage({ view: '/portal', query: { organisation, role: 'Investor' } }))
    expect(fixture.guard).not.toHaveBeenCalled()
    expect(fixture.screen).toHaveBeenCalledWith(expect.objectContaining({ view: '/portal', operatingContext: context }))
  })
  it('gives explicit personal onboarding its own context and component identity even for a native user', async () => {
    const applicantContext = { mode: 'APPLICANT' as const }
    const data = roleData()
    fixture.load.mockResolvedValueOnce({ kind: 'applicant', entry: { entry_version: 1, actor: user, applications: [], contexts: [], admission: { manual_test_review: true } }, release, scopes: [scope], operatingContext: applicantContext, portal: { ...data.portal, snapshot: { ...data.portal.snapshot, operating_context: applicantContext } } })
    const node = await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } })
    renderToStaticMarkup(node)
    expect(fixture.load).toHaveBeenCalledWith({ mode: 'applicant', organisation: undefined, role: undefined })
    expect(fixture.entry).toHaveBeenCalledWith(expect.objectContaining({ initial: expect.objectContaining({ actor: user }) }))
    expect(fixture.screen).not.toHaveBeenCalled()
    expect(node.key).toContain(`${user.id}:TESTNET:`)
  })
  it('denies operational child views in personal applicant mode even with a reviewer-shaped snapshot', async () => {
    const data = roleData()
    fixture.load.mockResolvedValueOnce({ kind: 'applicant', entry: { entry_version: 1, actor: user, applications: [], contexts: [], admission: { manual_test_review: true } }, release, scopes: [scope], operatingContext: { mode: 'APPLICANT' }, portal: { ...data.portal, snapshot: { ...data.portal.snapshot, actor: { ...data.portal.snapshot.actor, can_review: true } } } })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/compliance', query: { mode: 'applicant' } }))
    expect(html).toContain('Complete your account access')
    expect(fixture.screen).not.toHaveBeenCalled()
  })
  it('cannot turn a missing business snapshot into an empty child workspace', async () => {
    fixture.load.mockResolvedValueOnce({ ...roleData(), portal: undefined, queueMessage: 'Saved business records unavailable.' })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/portfolio', query: { organisation, role: 'Investor' } }))
    expect(html).toContain('Saved portal state is unavailable')
    expect(fixture.screen).not.toHaveBeenCalled()
  })
  it('keeps an unavailable root snapshot clearly separate from operational content', async () => {
    fixture.load.mockResolvedValueOnce({ ...roleData(), portal: undefined, queueMessage: 'Saved business records unavailable.' })
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal', query: { organisation, role: 'Investor' } }))
    expect(html).toContain('Operational records are unavailable in this context.')
    expect(html).toContain('<details')
    expect(fixture.screen).not.toHaveBeenCalled()
  })
  it('uses a different component key when the selected native organisation changes', async () => {
    const first = await PortalPage({ view: '/portal/portfolio', query: { organisation, role: 'Investor' } })
    const data = roleData()
    fixture.load.mockResolvedValueOnce({ ...data, scope: { ...scope, organisationId: otherOrganisation }, operatingContext: { ...context, organisationId: otherOrganisation } })
    const second = await PortalPage({ view: '/portal/portfolio', query: { organisation: otherOrganisation, role: 'Investor' } })
    expect(first.key).not.toBe(second.key)
  })
  it('preserves explicit applicant mode after a transient failure', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Unavailable', 503))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } }))
    expect(html).toContain('href="/portal/onboarding?mode=applicant"')
  })
  it('preserves a valid requested role and organisation in a transient-error retry', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Unavailable', 503))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/portfolio', query: { organisation, role: 'Investor' } }))
    expect(html).toContain(`href="/portal/portfolio?organisation=${organisation}&amp;role=Investor"`)
  })
  it('preserves the selected detail record as well as its role and organisation on retry', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Unavailable', 503))
    const html = renderToStaticMarkup(await PortalPage({ view: '/portal/opportunities/detail', id: 'selected-product', query: { organisation, role: 'Investor' } }))
    expect(html).toContain(`href="/portal/opportunities/detail?organisation=${organisation}&amp;role=Investor&amp;id=selected-product"`)
  })
})
