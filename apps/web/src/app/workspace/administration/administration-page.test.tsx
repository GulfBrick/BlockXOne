import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminReadProjection } from '@/lib/administration/contracts'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), workspace: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn(), totp: vi.fn(), read: vi.fn(), panel: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current, hasCurrentTotp: mocks.totp }))
vi.mock('@/lib/administration/server', () => ({ readAdministration: mocks.read }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/workspace/administration-panel', () => ({ AdministrationPanel: (props: unknown) => { mocks.panel(props); return <p>Administration panel</p> } }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
import AdministrationPage, { dynamic, generateMetadata, revalidate } from './page'
const org = '11111111-1111-4111-8111-111111111111', another = '22222222-2222-4222-8222-222222222222', proposal = '33333333-3333-4333-8333-333333333333'
const denied: AdminReadProjection = { availability: 'unconfigured', scopeRevision: null, policyVersion: 1, caller: null, scope: null, people: [], entities: [], proposals: [], selectedProposal: null, truncated: { people: false, entities: false, proposals: false }, governanceGrants: [], grantsTruncated: false }
const props = (value: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(value) })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({}); mocks.mfa.mockResolvedValue({ privateToken: 'never serialize', factorSecret: 'never serialize' }); mocks.sufficient.mockReturnValue(true); mocks.totp.mockReturnValue(true); mocks.current.mockResolvedValue(true)
  mocks.workspace.mockResolvedValue({ user: { id: 'private-principal', email: 'private@example.test' }, organisations: [{ id: org, name: 'Organisation A', roles: ['SuperAdmin'] }, { id: another, name: 'Organisation B', roles: ['Investor'] }] })
  mocks.read.mockResolvedValue(denied)
})
afterEach(() => vi.unstubAllEnvs())
describe('fresh administration server document', () => {
  it('is dynamic/private and retains native logout and ordinary navigation', async () => {
    expect(dynamic).toBe('force-dynamic'); expect(revalidate).toBe(0)
    const html = renderToStaticMarkup(await AdministrationPage(props()))
    for (const value of ['Administration', 'action="/auth/logout"', 'method="post"', 'Account security', 'Financial and token operations are not enabled.']) expect(html).toContain(value)
    expect(await generateMetadata(props())).toMatchObject({ robots: { index: false, follow: false }, referrer: 'strict-origin' })
    expect(mocks.read).toHaveBeenCalledWith({}, org, undefined)
    expect(mocks.panel.mock.calls[0][0]).toMatchObject({ view: denied, organisations: [] })
    expect(JSON.stringify(mocks.panel.mock.calls)).not.toMatch(/never serialize|private@example|privateToken|factorSecret/)
  })
  it.each([
    { organisation: org }, { proposal }, { organisation: another, proposal },
  ])('accepts only independently validated selectors %j', async query => {
    renderToStaticMarkup(await AdministrationPage(props(query)))
    expect(mocks.read).toHaveBeenCalledWith({}, 'organisation' in query ? query.organisation : org, 'proposal' in query ? query.proposal : undefined)
    expect(mocks.current).toHaveBeenCalledOnce()
  })
  it.each([
    { token: 'private' }, { organisation: [org, org] }, { proposal: [proposal, proposal] }, { organisation: '' }, { proposal: 'not-an-id' }, { organisation: org, returnTo: '/workspace' }, { organisation: org, proposal: '00000000-0000-0000-0000-000000000000' },
  ])('rejects unsafe query %j before provider/workspace reads', async query => {
    renderToStaticMarkup(await AdministrationPage(props(query)))
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.panel.mock.calls[0][0].view.availability).toBe('unavailable')
    expect((await generateMetadata(props(query))).referrer).toBe('no-referrer')
  })
  it('does not query an organisation outside ordinary membership scope', async () => {
    renderToStaticMarkup(await AdministrationPage(props({ organisation: proposal })))
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.panel.mock.calls[0][0]).toMatchObject({ view: { availability: 'forbidden' }, organisations: [] })
  })
  it('requires current verified TOTP before any administration directory read', async () => {
    mocks.totp.mockReturnValue(false)
    renderToStaticMarkup(await AdministrationPage(props()))
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.panel.mock.calls[0][0]).toMatchObject({ view: { availability: 'mfa_required' }, organisations: [] })
  })
  it('redirects signed-out, insufficient ordinary MFA and unassigned callers', async () => {
    mocks.mfa.mockResolvedValueOnce(null)
    await expect(AdministrationPage(props())).rejects.toThrow('REDIRECT:/login')
    mocks.sufficient.mockReturnValueOnce(false)
    await expect(AdministrationPage(props())).rejects.toThrow('REDIRECT:/login/mfa')
    mocks.workspace.mockResolvedValueOnce(null)
    await expect(AdministrationPage(props())).rejects.toThrow('REDIRECT:/workspace/access-denied')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('erases any returned private view when token continuity fails', async () => {
    mocks.read.mockResolvedValue({ availability: 'ready', caller: { principalId: 'private' }, scope: { organisationId: org }, people: [{ label: 'Private person' }] })
    mocks.current.mockResolvedValue(false)
    renderToStaticMarkup(await AdministrationPage(props()))
    expect(mocks.panel.mock.calls[0][0]).toMatchObject({ view: { availability: 'unavailable', people: [] }, organisations: [] })
    expect(JSON.stringify(mocks.panel.mock.calls)).not.toContain('Private person')
  })
  it('turns provider/adapter failures into safe unavailable output, without exposing thrown details', async () => {
    mocks.read.mockRejectedValue(Error('provider token and internal query'))
    const html = renderToStaticMarkup(await AdministrationPage(props()))
    expect(html).not.toContain('provider token')
    expect(mocks.panel.mock.calls[0][0].view.availability).toBe('unavailable')
  })
  it('does not admit the page for mismatched configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    await expect(AdministrationPage(props())).rejects.toThrow('NOT_FOUND')
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
