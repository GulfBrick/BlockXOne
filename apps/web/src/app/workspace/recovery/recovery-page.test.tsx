import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gatedRecovery, type RecoveryReadProjection } from '@/lib/recovery/contracts'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn(), panel: vi.fn(), workspace: vi.fn(), mfa: vi.fn() }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/recovery/server', () => ({ readRecovery: mocks.read }))
vi.mock('@/lib/supabase/server', () => ({ readWorkspace: mocks.workspace }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/components/auth/recovery-panel', () => ({ RecoveryPanel: (props: unknown) => { mocks.panel(props); return <p>Recovery panel</p> } }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
import RecoveryPage, { dynamic, revalidate, generateMetadata } from './page'

const principal = '11111111-1111-4111-8111-111111111111', person = '22222222-2222-4222-8222-222222222222', caseId = '33333333-3333-4333-8333-333333333333'
const props = (query: Record<string, string | string[] | undefined> = {}) => ({ searchParams: Promise.resolve(query) })
const ready = (): RecoveryReadProjection => ({ ...gatedRecovery('unavailable'), availability: 'ready', caller: { principalId: principal, personId: person }, canRequest: true })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase'); vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.client.mockResolvedValue({ opaqueProvider: 'NEVER_SERIALIZE' }); mocks.read.mockResolvedValue(ready())
})
afterEach(() => vi.unstubAllEnvs())
describe('recovery server document', () => {
  it('reads the raw-identity safe adapter without workspace or MFA bootstrap admission', async () => {
    const html = renderToStaticMarkup(await RecoveryPage(props()))
    expect(dynamic).toBe('force-dynamic'); expect(revalidate).toBe(0)
    expect(mocks.read).toHaveBeenCalledWith({ opaqueProvider: 'NEVER_SERIALIZE' }, undefined)
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.mfa).not.toHaveBeenCalled()
    expect(html).toContain('Recovery containment'); expect(html).toContain('method="post"'); expect(html).toContain('action="/auth/logout"')
    expect(html).toContain('Authenticator replacement and release from containment are not available here.')
    expect(JSON.stringify(mocks.panel.mock.calls)).not.toContain('NEVER_SERIALIZE')
    expect(await generateMetadata(props())).toMatchObject({ robots: { index: false, follow: false } })
  })
  it('admits own held status without redirecting it into ordinary MFA or workspace', async () => {
    const projection = { ...ready(), held: true, canRequest: false }
    mocks.read.mockResolvedValue(projection)
    renderToStaticMarkup(await RecoveryPage(props()))
    expect(mocks.panel).toHaveBeenCalledWith({ projection })
    expect(mocks.mfa).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('passes only a validated case selector to the adapter', async () => {
    renderToStaticMarkup(await RecoveryPage(props({ case: caseId })))
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), caseId)
  })
  const invalidQueries: Array<Record<string, string | string[]>> = [
    { case: [caseId, caseId] }, { case: 'invalid' }, { person }, { access_token: 'private' }, { case: caseId, target: person }, { case: '00000000-0000-0000-0000-000000000000' },
  ]
  it.each(invalidQueries)('rejects unsafe selectors before provider calls %j', async query => {
    renderToStaticMarkup(await RecoveryPage(props(query)))
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.panel).toHaveBeenCalledWith({ projection: gatedRecovery('unavailable') })
  })
  it('redirects only an explicit unauthorised safe result', async () => {
    mocks.read.mockResolvedValue(gatedRecovery('unauthorised'))
    await expect(RecoveryPage(props())).rejects.toThrow('REDIRECT:/login')
  })
  it('keeps provider failures generic and never serializes them', async () => {
    mocks.read.mockRejectedValue(Error('private SQL/token details'))
    const html = renderToStaticMarkup(await RecoveryPage(props()))
    expect(html).not.toContain('private SQL/token details')
    expect(mocks.panel).toHaveBeenCalledWith({ projection: gatedRecovery('unavailable') })
  })
  it('has no legacy or mismatched auth-mode fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    await expect(RecoveryPage(props())).rejects.toThrow('NOT_FOUND')
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
