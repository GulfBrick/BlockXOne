import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  Pool: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn(),
  getSession: vi.fn(), getUser: vi.fn(),
}))
vi.mock('pg', () => ({ Pool: mocks.Pool }))
vi.mock('@/lib/supabase/page', () => ({ createPageSupabaseClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ readWorkspace: vi.fn() }))
vi.mock('@/lib/supabase/mfa', () => ({
  readMfaContext: vi.fn(), hasRequiredMfa: vi.fn(), isMfaContextCurrent: vi.fn(),
}))
vi.mock('./artifact.generated', () => ({ demoFundArtifact: null }))

import { chainEvidence, DemoError } from './server'

// Synthetic, mocked provider evidence only: no real token, provider, or socket.
const actor = '10000000-0000-4000-8000-000000000001'
const session = '20000000-0000-4000-8000-000000000001'
const target = '30000000-0000-4000-8000-000000000001'
const contract = `0x${'1'.repeat(40)}`
const wallet = `0x${'2'.repeat(40)}`
const transaction = `0x${'3'.repeat(64)}`
const token = `synthetic.${Buffer.from(JSON.stringify({ sub: actor, session_id: session })).toString('base64url')}.not-a-signature`
const client = { auth: { getSession: mocks.getSession, getUser: mocks.getUser } } as unknown as SupabaseClient

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('BLOCKXONE_TESTNET_FUND_DEMO', 'enabled')
  vi.stubEnv('BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_BLOCKXONE_AUTH_MODE', 'supabase')
  vi.stubEnv('SUPABASE_URL', 'https://fegnnnlseuejkrusbbkv.supabase.co')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BLOCKXONE_APP_ORIGIN', 'https://synthetic-fund-review.vercel.app')
  vi.stubEnv('BLOCKXONE_DEMO_DATABASE_URL', 'postgresql://bx1_demo_chain_verifier.fegnnnlseuejkrusbbkv:synthetic-not-a-secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full')
  mocks.Pool.mockImplementation(function () {
    return { query: mocks.query, end: mocks.end, on: mocks.on }
  })
  mocks.query.mockResolvedValue({ rows: [{}] })
  mocks.end.mockResolvedValue(undefined)
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: token } }, error: null })
  mocks.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('testnet receipt verifier adapter (mocked transport)', () => {
  it.each([
    ['bind', [target, contract, wallet, transaction], 'select public.bx1_demo_bind_contract($1,$2,$3,$4,$5,$6)'],
    ['confirm', [target, transaction, '12345', contract], 'select public.bx1_demo_confirm_chain($1,$2,$3,$4,$5,$6)'],
  ] as const)('uses exact %s SQL with the provider-verified actor and original session', async (command, sourceParams, sql) => {
    const params = [...sourceParams]
    const assertActive = vi.fn()
    await expect(chainEvidence(client, command, params, assertActive)).resolves.toBeUndefined()
    expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(token)
    expect(assertActive).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(sql, [...sourceParams, actor, session])
    expect(params).toEqual(sourceParams)
    expect(mocks.Pool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543, database: 'postgres',
      user: 'bx1_demo_chain_verifier.fegnnnlseuejkrusbbkv', max: 1,
      connectionTimeoutMillis: 3000, query_timeout: 8000, statement_timeout: 7000, lock_timeout: 4000,
      ssl: expect.objectContaining({ rejectUnauthorized: true, servername: 'aws-0-eu-central-1.pooler.supabase.com', ca: expect.any(String) }),
    }))
    expect(mocks.on).toHaveBeenCalledExactlyOnceWith('error', expect.any(Function))
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
    expect(assertActive.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0])
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.end.mock.invocationCallOrder[0])
  })

  it('preserves a deadline DemoError 503 without dispatch and still closes the pool', async () => {
    const deadline = new DemoError('The verification deadline expired.', 503)
    await expect(chainEvidence(client, 'confirm', [target, transaction, '12345', contract], () => { throw deadline })).rejects.toBe(deadline)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(['23514', '22023', '42501', '23505', '22P02'])('maps definite SQL rejection %s to 409, redacts details, and never resends', async code => {
    mocks.query.mockRejectedValue(Object.assign(new Error('synthetic-private-database-detail'), { code }))
    await expect(chainEvidence(client, 'confirm', [target, transaction, '12345', contract], () => {})).rejects.toMatchObject({
      status: 409, message: 'Verified chain evidence could not be saved. Do not resend; refresh and verify again.',
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
  })

  it.each([
    ['statement timeout', Object.assign(new Error('synthetic-private-timeout'), { code: '57014' })],
    ['connection timeout', Object.assign(new Error('synthetic-private-network'), { code: 'ETIMEDOUT' })],
    ['unclassified outcome', new Error('synthetic-private-unknown')],
  ])('keeps %s uncertain as 503 and never retries the mutation', async (_label, error) => {
    mocks.query.mockRejectedValue(error)
    await expect(chainEvidence(client, 'confirm', [target, transaction, '12345', contract], () => {})).rejects.toMatchObject({
      status: 503, message: 'Verified chain evidence could not be saved. Do not resend; refresh and verify again.',
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(['resolved mutation', 'known rejection'] as const)('reports cleanup failure as uncertain after %s', async outcome => {
    if (outcome === 'known rejection') mocks.query.mockRejectedValue({ code: '23514' })
    mocks.end.mockRejectedValue(new Error('synthetic-private-cleanup-detail'))
    await expect(chainEvidence(client, 'bind', [target, contract, wallet, transaction], () => {})).rejects.toMatchObject({
      status: 503, message: 'Receipt verification outcome is uncertain. Refresh and verify again; do not resend.',
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith()
  })

  it('does not open a database pool when provider identity disagrees with the token subject', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: target } }, error: null })
    await expect(chainEvidence(client, 'bind', [target, contract, wallet, transaction], () => {})).rejects.toMatchObject({ status: 403 })
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(token)
    expect(mocks.Pool).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.end).not.toHaveBeenCalled()
  })
})
