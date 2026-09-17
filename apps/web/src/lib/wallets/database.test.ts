import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const fake = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), pool: vi.fn() }))
vi.mock('pg', () => ({ Pool: fake.pool }))
import { createWalletDatabase, walletDatabaseConfig, WalletDatabaseError } from './database'

const actor = { userId: '10000000-0000-4000-8000-000000000001', platformUserId: '40000000-0000-4000-8000-000000000001', sessionId: '20000000-0000-4000-8000-000000000001', organisationId: '30000000-0000-4000-8000-000000000001' }
const challenge = { challengeId: '50000000-0000-4000-8000-000000000001', address: '0x1111111111111111111111111111111111111111', chainId: 80002, domain: 'https://bx1.co.za', message: 'bound message', issuedAt: '2026-09-17T19:00:00.000Z', expiresAt: '2026-09-17T19:05:00.000Z' }
const direct = 'postgresql://bx1_wallet_verifier:unit-test-only@db.oqkevkjbkpugjotihtda.supabase.co:5432/postgres'

beforeEach(() => {
  vi.clearAllMocks()
  fake.connect.mockResolvedValue({ query: fake.query, release: fake.release })
  fake.pool.mockImplementation(function () { return { connect: fake.connect, on: vi.fn() } })
  fake.query.mockResolvedValue({ rows: [{ result: challenge }] })
})

describe('restricted wallet database configuration', () => {
  it('rejects missing credentials without any general database fallback', () => {
    expect(() => walletDatabaseConfig({ DATABASE_URL: direct })).toThrow(WalletDatabaseError)
    expect(fake.pool).not.toHaveBeenCalled()
  })
  it('requires exact dedicated role, project host, TLS verification and bounded pooling', () => {
    const config = walletDatabaseConfig({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct })
    expect(config).toMatchObject({ host: 'db.oqkevkjbkpugjotihtda.supabase.co', user: 'bx1_wallet_verifier', port: 5432, database: 'postgres', max: 2, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 3000, query_timeout: 8000, statement_timeout: 7000 })
    expect(config).not.toHaveProperty('connectionString')
  })
  it('admits only the verified shared pooler and role.project username', () => {
    const url = direct.replace('bx1_wallet_verifier:', 'bx1_wallet_verifier.oqkevkjbkpugjotihtda:').replace('db.oqkevkjbkpugjotihtda.supabase.co:5432', 'aws-0-eu-central-1.pooler.supabase.com:6543')
    expect(walletDatabaseConfig({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: url })).toMatchObject({ host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543, user: 'bx1_wallet_verifier.oqkevkjbkpugjotihtda', ssl: { rejectUnauthorized: true, servername: 'aws-0-eu-central-1.pooler.supabase.com' } })
    for (const invalid of [url.replace('oqkevkjbkpugjotihtda:', 'wrongproject:'), url.replace('.oqkevkjbkpugjotihtda:', ':'), url.replace(':6543/', ':5432/'), url.replace('aws-0-eu-central-1', 'aws-0-us-east-1')]) {
      expect(() => walletDatabaseConfig({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: invalid })).toThrow('unavailable')
    }
  })
  it.each([
    direct.replace('bx1_wallet_verifier:', 'postgres:'),
    direct.replace('bx1_wallet_verifier:', 'service_role:'),
    direct.replace('oqkevkjbkpugjotihtda', 'otherproject'),
    direct.replace('db.oqkevkjbkpugjotihtda.supabase.co', 'attacker.example'),
    direct + '?sslmode=disable', direct + '?sslmode=no-verify', direct.replace(':5432/', ':6543/'),
    direct.replace('/postgres', '/other'), direct.replace('postgresql:', 'http:'),
  ])('rejects unadmitted credentials without exposing them', (url) => {
    try { walletDatabaseConfig({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: url }); throw new Error('not rejected') } catch (error) {
      expect(error).toBeInstanceOf(WalletDatabaseError)
      expect(String(error)).toBe('WalletDatabaseError: unavailable')
    }
  })
})

describe('restricted function adapter', () => {
  it('parameterizes all bindings and calls only an explicit private function', async () => {
    const db = createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct })
    const value = await db.issueChallenge(actor, challenge.address, 80002, 'ab'.repeat(32))
    expect(value).toEqual(challenge)
    const sqlCall = fake.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('issue_wallet_challenge'))
    expect(sqlCall?.[0]).toBe('select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,$6,$7,$8) as result')
    expect(sqlCall?.[1].slice(0, 7)).toEqual([actor.userId, actor.platformUserId, actor.sessionId, actor.organisationId, challenge.address, 80002, 'https://bx1.co.za'])
    expect(sqlCall?.[1][7]).toMatch(/^[0-9a-f]{64}$/)
    expect(fake.query.mock.calls[0][0]).toBe('begin')
    expect(fake.query.mock.calls.at(-1)?.[0]).toBe('commit')
    expect(fake.release).toHaveBeenCalledTimes(1)
    expect(fake.query.mock.calls.some(([sql]) => /(?:insert|update|delete|from public\.)/i.test(String(sql)))).toBe(false)
  })
  it('binds read and consume to actor session and exact persisted message', async () => {
    const db = createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct })
    await db.readChallenge(actor, challenge.challengeId)
    await db.consumeChallenge(actor, challenge.challengeId, challenge.message, '0x' + '11'.repeat(65))
    expect(fake.query).toHaveBeenCalledWith('select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5) as result', [actor.userId, actor.platformUserId, actor.sessionId, actor.organisationId, challenge.challengeId])
    expect(fake.query).toHaveBeenCalledWith('select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7) as result', [actor.userId, actor.platformUserId, actor.sessionId, actor.organisationId, challenge.challengeId, challenge.message, '0x' + '11'.repeat(65)])
  })
  it.each([['BW001', 'unauthorised'], ['BW002', 'invalid_request'], ['BW003', 'expired'], ['BW004', 'conflict'], ['BW005', 'rate_limited'], ['XX000', 'unavailable']])('rolls back and maps %s without raw errors', async (code, expected) => {
    fake.query.mockImplementation(async (sql) => { if (sql.startsWith('select ')) throw Object.assign(new Error(direct), { code }); return { rows: [] } })
    const db = createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct })
    await expect(db.readChallenge(actor, challenge.challengeId)).rejects.toMatchObject({ code: expected, message: expected })
    expect(fake.query).toHaveBeenCalledWith('rollback')
    expect(fake.release).toHaveBeenCalledTimes(1)
  })
  it('does not pass a failed connection error or password to callers', async () => {
    fake.connect.mockRejectedValue(new Error(direct))
    await expect(createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct }).readChallenge(actor, challenge.challengeId)).rejects.toMatchObject({ code: 'unavailable', message: 'unavailable' })
  })
  it('discards a connection whose rollback failed', async () => {
    fake.query.mockImplementation(async (sql) => {
      if (sql.startsWith('select ') || sql === 'rollback') throw new Error(direct)
      return { rows: [] }
    })
    await expect(createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct }).readChallenge(actor, challenge.challengeId)).rejects.toThrow('unavailable')
    expect(fake.release).toHaveBeenCalledWith(true)
  })
  it('rolls back unexpected empty function output instead of returning false success', async () => {
    fake.query.mockResolvedValue({ rows: [] })
    await expect(createWalletDatabase({ BLOCKXONE_WALLET_VERIFIER_DATABASE_URL: direct }).readChallenge(actor, challenge.challengeId)).rejects.toThrow('unavailable')
    expect(fake.query).toHaveBeenCalledWith('rollback')
    expect(fake.query).not.toHaveBeenCalledWith('commit')
  })
})
