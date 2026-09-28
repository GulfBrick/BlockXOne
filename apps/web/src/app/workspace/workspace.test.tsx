import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { BX1_ROLES, type Bx1Role, type Bx1Workspace } from '@/lib/supabase/contracts'
import * as policy from '@/lib/authorization/policy'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), workspace: vi.fn(), configured: vi.fn(), mfa: vi.fn(), sufficient: vi.fn(), current: vi.fn() }))
vi.mock('@/lib/supabase/mfa', () => ({ readMfaContext: mocks.mfa, hasRequiredMfa: mocks.sufficient, isMfaContextCurrent: mocks.current }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ readVerifiedUser: mocks.user, readWorkspace: mocks.workspace }))
vi.mock('@/lib/wallets/database', () => ({ isWalletDatabaseConfigured: mocks.configured }))
vi.mock('@/components/public/public-shell', () => ({ PublicShell: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, notFound: () => { throw new Error('NOT_FOUND') } }))
import WorkspacePage, { generateMetadata } from './page'
import AccessDeniedPage from './access-denied/page'

function resolvedWorkspace(roles: Bx1Role[]): Bx1Workspace {
  return { user: { id: 'u1', email: 'real@example.test', platformUserId: 'legacy1', displayName: 'Real Person' }, organisations: [{ id: 'o1', name: 'BlockXOne Internal', roles }] }
}

const savedRow = { id: 'wallet-a', organisation_id: 'o1', address: '0x1111111111111111111111111111111111111111', chain_id: 80002, verified_at: '2026-09-18T00:00:00.000Z', status: 'PENDING' }
function walletQuery(data: unknown = [], error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data, error }) }
  const from = vi.fn(() => query)
  mocks.client.mockResolvedValue({ from })
  return { from, query }
}

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  mocks.configured.mockReturnValue(false)
  mocks.mfa.mockResolvedValue({})
  mocks.sufficient.mockReturnValue(true)
  mocks.current.mockResolvedValue(true)
  mocks.client.mockResolvedValue({})
  mocks.user.mockResolvedValue({ id: 'u1', email: 'real@example.test' })
  mocks.workspace.mockResolvedValue({ user: { id: 'u1', email: 'real@example.test', platformUserId: 'legacy1', displayName: 'Real Person' }, organisations: [{ id: 'o1', name: 'BlockXOne Internal', roles: ['SuperAdmin', 'FinancialController'] }] })
})

describe('server-rendered protected workspace', () => {
  it('rejects a changed token after workspace lookup before querying wallets', async () => {
    mocks.configured.mockReturnValue(true)
    mocks.current.mockResolvedValue(false)
    const { from } = walletQuery([savedRow])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain(savedRow.address)
    expect(from).not.toHaveBeenCalled()
  })
  it('rejects a token changed during wallet lookup before rendering any identity', async () => {
    mocks.configured.mockReturnValue(true)
    mocks.current.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { from } = walletQuery([savedRow])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(from).toHaveBeenCalledOnce()
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain(savedRow.address)
  })
  it.each(BX1_ROLES)('%s must complete enrolled MFA before workspace or wallet queries', async role => {
    mocks.workspace.mockResolvedValue(resolvedWorkspace([role]))
    mocks.sufficient.mockReturnValue(false)
    const { from } = walletQuery()
    await expect(WorkspacePage()).rejects.toThrow('REDIRECT:/login/mfa')
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it('has an account security entry without changing financial availability', async () => {
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('href="/workspace/security"')
    expect(html).toContain('Account security')
    expect(html).toContain('href="/workspace/administration"')
    expect(html).toContain('Administration')
    expect(html).toContain('Financial and token operations are not enabled.')
  })
  it('MFA provider failure does not become unenrolled access', async () => {
    mocks.mfa.mockRejectedValue(Error('private assurance detail'))
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('private assurance detail')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  describe.each(BX1_ROLES)('%s wallet-optional access', (role) => {
    it('retains identity, assignments and POST signout without provider or verifier configuration', async () => {
      mocks.workspace.mockResolvedValue(resolvedWorkspace([role]))
      const { from } = walletQuery()
      const html = renderToStaticMarkup(await WorkspacePage())
      expect(html).toContain('real@example.test')
      expect(html).toContain(role)
      expect(html).toContain('method="post" action="/auth/logout"')
      expect(html).toContain('Financial and token operations are not enabled.')
      expect(html).toContain('Wallet linking is being configured')
      expect(from).not.toHaveBeenCalled()
    })
    it('uses real own-user policy before the unchanged safe RLS projection with no saved wallet', async () => {
      mocks.configured.mockReturnValue(true)
      const workspace = resolvedWorkspace([role])
      workspace.organisations.push({ id: 'o2', name: 'Second organisation', roles: ['Investor'] })
      mocks.workspace.mockResolvedValue(workspace)
      const evaluate = vi.spyOn(policy, 'evaluateActionPermission')
      const { from, query } = walletQuery()
      const html = renderToStaticMarkup(await WorkspacePage())
      expect(evaluate.mock.calls).toEqual([
        [workspace, 'wallet.read_own', { userId: 'u1', organisationId: 'o1' }],
        [workspace, 'wallet.read_own', { userId: 'u1', organisationId: 'o2' }],
      ])
      expect(evaluate.mock.invocationCallOrder.at(-1)).toBeLessThan(from.mock.invocationCallOrder[0])
      expect(from).toHaveBeenCalledWith('bx1_wallets')
      expect(query.select).toHaveBeenCalledWith('id,organisation_id,address,chain_id,verified_at,status')
      expect(query.in).toHaveBeenCalledWith('organisation_id', ['o1', 'o2'])
      expect(html).toContain('real@example.test')
      expect(html).not.toContain('Ownership verified: compliance pending')
    })
  })
  it('skips the entire wallet query if any organisation is denied while preserving usable identity/logout', async () => {
    mocks.configured.mockReturnValue(true)
    const workspace = resolvedWorkspace(['SuperAdmin', 'FinancialController'])
    workspace.organisations.push({ id: 'o2', name: 'Second organisation', roles: ['Investor'] })
    mocks.workspace.mockResolvedValue(workspace)
    const realEvaluate = policy.evaluateActionPermission
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission').mockImplementation((candidate, action, target) =>
      target?.organisationId === 'o2' ? { allowed: false, reason: 'invalid_scope' } : realEvaluate(candidate, action, target))
    const { from, query } = walletQuery([savedRow])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(from).not.toHaveBeenCalled()
    expect(query.select).not.toHaveBeenCalled()
    expect(html).toContain('real@example.test')
    expect(html).toContain('Active assignments')
    expect(html).toContain('method="post" action="/auth/logout"')
    expect(html).toContain('Wallet records are temporarily unavailable')
    expect(html).not.toContain(savedRow.address)
  })
  it.each([{ roles: [] }, { roles: ['Root'] }, { roles: ['Investor', 'Root'] }])('real policy denies invalid role fixture $roles without querying wallets', async ({ roles }) => {
    mocks.configured.mockReturnValue(true)
    mocks.workspace.mockResolvedValue(resolvedWorkspace(roles as Bx1Role[]))
    const { from } = walletQuery([savedRow])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(from).not.toHaveBeenCalled()
    expect(html).toContain('Wallet records are temporarily unavailable')
    expect(html).toContain('real@example.test')
    expect(html).not.toContain(savedRow.address)
  })
  it('retains the safe own-wallet projection and PENDING/Amoy presentation', async () => {
    mocks.configured.mockReturnValue(true)
    const { query } = walletQuery([{ ...savedRow, user_id: 'not-select-granted', signature: 'private-proof' }])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(query.select).toHaveBeenCalledWith('id,organisation_id,address,chain_id,verified_at,status')
    expect(html).toContain('Ownership verified: compliance pending')
    expect(html).toContain('80002')
    expect(html).toContain(savedRow.address)
    expect(html).not.toContain('not-select-granted')
    expect(html).not.toContain('private-proof')
    // RLS establishes ownership; this mock only proves safe-field projection.
  })
  it.each([{ organisation_id: 'foreign-org' }, { chain_id: 1 }, { status: 'APPROVED' }, { verified_at: 'bad' }])('rejects malformed wallet projection %j without exposing partial results', async (change) => {
    mocks.configured.mockReturnValue(true)
    walletQuery([savedRow, { ...savedRow, ...change }])
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Wallet records are temporarily unavailable')
    expect(html).toContain('real@example.test')
    expect(html).not.toContain(savedRow.address)
  })
  it('workspace metadata enables native signout while token-bearing URLs retain no-referrer', async () => {
    expect((await generateMetadata({ searchParams: Promise.resolve({}) })).referrer).toBe('strict-origin')
    expect((await generateMetadata({ searchParams: Promise.resolve({ access_token: 'synthetic' }) })).referrer).toBe('no-referrer')
  })
  it('renders only actual identity/assignments, a POST logout and explicit unavailable operations', async () => {
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(mocks.workspace).toHaveBeenCalledOnce()
    expect(html).toContain('real@example.test')
    expect(html).toContain('Real Person')
    expect(html).toContain('BlockXOne Internal')
    expect(html).toContain('SuperAdmin')
    expect(html).toContain('FinancialController')
    expect(html).toContain('method="post" action="/auth/logout"')
    expect(html).toContain('Financial and token operations are not enabled.')
    expect(html).not.toContain('balance')
    expect(html).not.toContain('/api/')
    expect(html).not.toContain('legacy1')
  })
  it('redirects missing identity to login before workspace lookup', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(WorkspacePage()).rejects.toThrow('REDIRECT:/login')
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('redirects absent active assignment to the generic denied page', async () => {
    mocks.workspace.mockResolvedValue(null)
    await expect(WorkspacePage()).rejects.toThrow('REDIRECT:/workspace/access-denied')
  })
  it('does not render identity or pretend signout on provider/database failure', async () => {
    mocks.workspace.mockRejectedValue(new Error('private-query-detail'))
    const html = renderToStaticMarkup(await WorkspacePage())
    expect(html).toContain('Access is temporarily unavailable.')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain('private-query-detail')
  })
  it('does not render a workspace when paired mode is absent or inconsistent', async () => {
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    await expect(WorkspacePage()).rejects.toThrow('NOT_FOUND')
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('access denial contains public-safe copy and recovery links only', () => {
    const html = renderToStaticMarkup(<AccessDeniedPage />)
    expect(html).toContain('Workspace access is unavailable.')
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('real@example.test')
    expect(html).not.toContain('/auth/setup')
  })
})
