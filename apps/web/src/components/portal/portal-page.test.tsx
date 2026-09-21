import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ load: vi.fn(), guard: vi.fn(), screen: vi.fn() }))
vi.mock('@/lib/portal/server', () => ({ requirePortalEnvironment: fixture.guard, PortalError: class extends Error { constructor(message: string, public readonly status: number) { super(message) } } }))
vi.mock('@/lib/portal/dashboard-server', () => ({ loadRoleDashboard: fixture.load }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('./portal-screens', () => ({ PortalScreen: (props: unknown) => { fixture.screen(props); return createElement('p', null, 'Scoped business screen') } }))
vi.mock('./portal-shell', () => ({ PortalShell: ({ children }: { children: ReactNode }) => createElement('section', null, children) }))
vi.mock('./role-dashboard', () => ({ RoleDashboardContent: () => createElement('p', null, 'Contextual role help') }))
import { PortalError } from '@/lib/portal/server'
import { PortalPage } from './portal-page'

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
beforeEach(() => { vi.resetAllMocks(); fixture.load.mockResolvedValue(roleData()) })

describe('portal server page access and selected context', () => {
  it('redirects an anonymous session to the existing sign-in route', async () => {
    fixture.load.mockRejectedValueOnce(new PortalError('Sign in', 401))
    await expect(PortalPage({ view: '/portal' })).rejects.toThrow('REDIRECT:/login')
  })
  it('returns not-found for disabled business routes before loading data', async () => {
    fixture.guard.mockImplementationOnce(() => { throw new PortalError('Not enabled', 404) })
    await expect(PortalPage({ view: '/portal/onboarding' })).rejects.toThrow('NOT_FOUND')
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
    fixture.load.mockResolvedValueOnce({ kind: 'applicant', release, scopes: [scope], operatingContext: applicantContext, portal: { ...data.portal, snapshot: { ...data.portal.snapshot, operating_context: applicantContext } } })
    const node = await PortalPage({ view: '/portal/onboarding', query: { mode: 'applicant' } })
    renderToStaticMarkup(node)
    expect(fixture.load).toHaveBeenCalledWith({ mode: 'applicant' })
    expect(fixture.screen).toHaveBeenCalledWith(expect.objectContaining({ operatingContext: applicantContext, scope: undefined }))
    expect(node.key).toContain(':TESTNET:applicant:/portal/onboarding:')
  })
  it('denies operational child views in personal applicant mode even with a reviewer-shaped snapshot', async () => {
    const data = roleData()
    fixture.load.mockResolvedValueOnce({ kind: 'applicant', release, scopes: [scope], operatingContext: { mode: 'APPLICANT' }, portal: { ...data.portal, snapshot: { ...data.portal.snapshot, actor: { ...data.portal.snapshot.actor, can_review: true } } } })
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
