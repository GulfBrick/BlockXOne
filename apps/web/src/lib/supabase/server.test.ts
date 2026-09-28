import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const sdk = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@supabase/ssr', () => sdk)
import { createRequestSupabaseClient, readWorkspace, safeLocalRedirect, AuthUnavailableError } from './server'
import * as policy from '@/lib/authorization/policy'
import { BX1_ROLES } from './contracts'

function fixture() {
  const rows: Record<string, unknown> = {
    bx1_profiles: { id: 'user-a', platform_user_id: 'platform-a', display_name: 'Alice', status: 'ACTIVE' },
    bx1_memberships: [{ id: 'membership-a', organisation_id: 'org-a', role: 'Investor', status: 'ACTIVE' }],
    bx1_organisations: [{ id: 'org-a', name: 'Internal A', status: 'ACTIVE' }],
  }
  const filters: unknown[][] = []
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-a', email: 'alice@example.test', user_metadata: { role: 'SuperAdmin' }, app_metadata: { roles: ['SuperAdmin'], organisationId: 'forged-org' } } }, error: null }) },
    rpc: vi.fn(async () => ({
      data: rows.bx1_effective_membership_ids ?? (rows.bx1_memberships as { id: string }[]).map((member) => member.id),
      error: rows.bx1_effective_membership_error ?? null,
    })),
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((...args: unknown[]) => { filters.push([table, ...args]); return query }),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve),
      }
      return query
    }),
  }
  return { client, rows, filters }
}

beforeEach(() => {
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test-only')
  vi.stubEnv('NODE_ENV', 'production')
})

describe('request-local Supabase client', () => {
  it('forces host-only HttpOnly cookies, retains deletion options and no-store fetch', async () => {
    const adapter = { getAll: vi.fn(() => []), setAll: vi.fn() }
    createRequestSupabaseClient(adapter)
    createRequestSupabaseClient(adapter)
    expect(sdk.createServerClient).toHaveBeenCalledTimes(2)
    const options = sdk.createServerClient.mock.calls.at(-1)![2]
    const cacheHeaders = { 'Cache-Control': 'private, no-store' }
    await options.cookies.setAll([{ name: 'chunk.0', value: '', options: { maxAge: 0, domain: 'evil.test', httpOnly: false, secure: false } }], cacheHeaders)
    expect(adapter.setAll).toHaveBeenCalledWith([{ name: 'chunk.0', value: '', options: expect.objectContaining({ maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'lax' }) }], cacheHeaders)
    expect(adapter.setAll.mock.calls[0][0][0].options).not.toHaveProperty('domain')
    expect(options.auth.autoRefreshToken).toBe(false)
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await options.global.fetch('http://localhost/test', { cache: 'force-cache' })
    expect(fetchStub).toHaveBeenCalledWith('http://localhost/test', expect.objectContaining({ cache: 'no-store' }))
  })
  it('rejects a service key or mismatched mode before client construction', () => {
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_secret_must-not-be-used')
    expect(() => createRequestSupabaseClient({ getAll: () => [], setAll: () => {} })).toThrow(AuthUnavailableError)
    vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', '')
    expect(() => createRequestSupabaseClient({ getAll: () => [], setAll: () => {} })).toThrow(AuthUnavailableError)
  })
})

describe('workspace reads', () => {
  it.each(BX1_ROLES)('passes verified own rows through real policy for %s without wallet facts', async (role) => {
    const { client, rows } = fixture()
    rows.bx1_memberships = [{ id: 'membership-a', organisation_id: 'org-a', role, status: 'ACTIVE' }]
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission')
    const result = await readWorkspace(client as never)
    expect(result?.organisations[0].roles).toEqual([role])
    expect(evaluate.mock.calls).toEqual([
      [result, 'workspace.read'],
      [result, 'profile.read_own', { userId: 'user-a' }],
      [result, 'memberships.read_own', { userId: 'user-a' }],
      [result, 'organisation.read', { organisationId: 'org-a' }],
    ])
    expect(client.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(client.from.mock.invocationCallOrder[0])
    expect(client.from.mock.invocationCallOrder.at(-1)).toBeLessThan(evaluate.mock.invocationCallOrder[0])
  })
  it.each(['workspace.read', 'profile.read_own', 'memberships.read_own', 'organisation.read'])('returns no workspace when policy denies %s', async (deniedAction) => {
    const { client } = fixture()
    const realEvaluate = policy.evaluateActionPermission
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission').mockImplementation((workspace, action, target) =>
      action === deniedAction ? { allowed: false, reason: 'invalid_scope' } : realEvaluate(workspace, action, target))
    expect(await readWorkspace(client as never)).toBeNull()
    expect(evaluate).toHaveBeenCalledWith(expect.any(Object), deniedAction, ...deniedAction === 'workspace.read' ? [] : [expect.any(Object)])
  })
  it.each(['mismatched profile', 'suspended profile', 'suspended organisation'])('denies %s before policy sees a candidate', async (failure) => {
    const { client, rows } = fixture()
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission')
    if (failure === 'mismatched profile') rows.bx1_profiles = { id: 'other-user', platform_user_id: 'platform-a', status: 'ACTIVE' }
    if (failure === 'suspended profile') rows.bx1_profiles = { id: 'user-a', platform_user_id: 'platform-a', status: 'SUSPENDED' }
    if (failure === 'suspended organisation') rows.bx1_organisations = [{ id: 'org-a', name: 'A', status: 'SUSPENDED' }]
    expect(await readWorkspace(client as never)).toBeNull()
    expect(evaluate).not.toHaveBeenCalled()
  })
  it('denies suspended membership rows and does not promote metadata roles', async () => {
    const { client, rows } = fixture()
    rows.bx1_memberships = [{ id: 'membership-a', organisation_id: 'org-a', role: 'Investor', status: 'SUSPENDED' }]
    await expect(readWorkspace(client as never)).rejects.toThrow(AuthUnavailableError)
  })
  it('checks each resolved organisation without admitting metadata-only assignments', async () => {
    const { client, rows } = fixture()
    rows.bx1_memberships = [{ id: 'membership-a', organisation_id: 'org-a', role: 'Investor', status: 'ACTIVE' }, { id: 'membership-b', organisation_id: 'org-b', role: 'SuperAdmin', status: 'ACTIVE' }]
    rows.bx1_organisations = [{ id: 'org-a', name: 'A', status: 'ACTIVE' }, { id: 'org-b', name: 'B', status: 'ACTIVE' }, { id: 'forged-org', name: 'Forged', status: 'ACTIVE' }]
    const evaluate = vi.spyOn(policy, 'evaluateActionPermission')
    const result = await readWorkspace(client as never)
    expect(result?.organisations.map((org) => org.id)).toEqual(['org-a', 'org-b'])
    expect(evaluate).toHaveBeenCalledWith(result, 'organisation.read', { organisationId: 'org-a' })
    expect(evaluate).toHaveBeenCalledWith(result, 'organisation.read', { organisationId: 'org-b' })
    expect(evaluate).not.toHaveBeenCalledWith(result, 'organisation.read', { organisationId: 'forged-org' })
  })
  it('verifies user then reads actual own active profile and tenant roles, ignoring metadata', async () => {
    const { client, filters } = fixture()
    const result = await readWorkspace(client as never)
    expect(result).toEqual({ user: { id: 'user-a', email: 'alice@example.test', platformUserId: 'platform-a', displayName: 'Alice' }, organisations: [{ id: 'org-a', name: 'Internal A', roles: ['Investor'] }] })
    expect(filters).toContainEqual(['bx1_profiles', 'id', 'user-a'])
    expect(filters).toContainEqual(['bx1_memberships', 'user_id', 'user-a'])
    expect(client.rpc).toHaveBeenCalledWith('bx1_workspace_effective_membership_ids')
    expect(client.auth.getUser).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('SuperAdmin')
  })
  it.each(['bx1_profiles', 'bx1_memberships', 'bx1_organisations'])('denies absent %s', async (table) => {
    const { client, rows } = fixture()
    rows[table] = table === 'bx1_profiles' ? null : []
    expect(await readWorkspace(client as never)).toBeNull()
  })
  it('denies invalid user without any database lookup', async () => {
    const { client } = fixture()
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } } as never)
    expect(await readWorkspace(client as never)).toBeNull()
    expect(client.from).not.toHaveBeenCalled()
  })
  it('does not turn provider or SQL failure into a successful empty workspace', async () => {
    const { client } = fixture()
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } } as never)
    await expect(readWorkspace(client as never)).rejects.toThrow(AuthUnavailableError)
    const broken = fixture().client
    broken.from.mockImplementation(() => { throw new Error('secret provider detail') })
    await expect(readWorkspace(broken as never)).rejects.toThrow('Access is temporarily unavailable.')
  })
  it('rejects an unknown role instead of trusting metadata or widening access', async () => {
    const { client, rows } = fixture()
    rows.bx1_memberships = [{ id: 'membership-a', organisation_id: 'org-a', role: 'Root', status: 'ACTIVE' }]
    await expect(readWorkspace(client as never)).rejects.toThrow(AuthUnavailableError)
  })
  it('removes an expired manager membership even if an earlier table read still returned it', async () => {
    const { client, rows } = fixture()
    rows.bx1_memberships = [
      { id: 'membership-a', organisation_id: 'org-a', role: 'Investor', status: 'ACTIVE' },
      { id: 'membership-b', organisation_id: 'org-b', role: 'OfferingManager', status: 'ACTIVE' },
    ]
    rows.bx1_organisations = [{ id: 'org-a', name: 'Independent investor account', status: 'ACTIVE' }, { id: 'org-b', name: 'Expired customer manager', status: 'ACTIVE' }]
    rows.bx1_effective_membership_ids = ['membership-a']
    const result = await readWorkspace(client as never)
    expect(result?.organisations).toEqual([{ id: 'org-a', name: 'Independent investor account', roles: ['Investor'] }])
  })
  it('fails closed when the native membership authority check is unavailable', async () => {
    const { client, rows } = fixture()
    rows.bx1_effective_membership_error = { message: 'provider unavailable' }
    await expect(readWorkspace(client as never)).rejects.toThrow(AuthUnavailableError)
  })
})

describe('redirect allowlist', () => {
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/workspace%0d%0aX:1', '/workspace?next=https://evil.test', '/workspace/'])('rejects %s', (value) => {
    expect(safeLocalRedirect(value, '/login?setup=1')).toBe('/login?setup=1')
  })
  it('only allows fixed local destinations and sanitizes the fallback too', () => {
    expect(safeLocalRedirect('/workspace', '/login?setup=1')).toBe('/workspace')
    expect(safeLocalRedirect('/login?setup=1', '/workspace')).toBe('/login?setup=1')
    expect(safeLocalRedirect(null, 'https://evil.test')).toBe('/workspace')
  })
})
