import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ query: vi.fn(), environment: 'TESTNET' }))
vi.mock('pg', () => ({ Pool: class { query = mocks.query } }))
vi.mock('./fund-lifecycle-server', async original => ({ ...await original<typeof import('./fund-lifecycle-server')>(), fundLifecycleEnvironment: () => mocks.environment }))
import { callFundWorker, fundWorkerDatabaseConfig } from './fund-lifecycle-worker'

beforeEach(() => {
  mocks.environment = 'TESTNET'; vi.clearAllMocks()
  vi.stubEnv('BLOCKXONE_FUND_EXECUTION_DATABASE_URL', 'postgresql://bx1_fund_execution_worker:synthetic-test-only@db.fegnnnlseuejkrusbbkv.supabase.co:5432/postgres?sslmode=verify-full')
  mocks.query.mockResolvedValue({ rows: [{ result: { fixture: 'not-chain-evidence' } }] })
})
afterEach(() => vi.unstubAllEnvs())

describe('finite authority-alignment worker statements', () => {
  it.each([
    ['read_fund_admission_authorised', 'select bx1_portal.read_fund_admission_authorised($1::uuid,$2::uuid) as result', ['request', 'receipt']],
    ['record_fund_admission_authorised', 'select bx1_portal.record_fund_admission_authorised($1::uuid,$2::jsonb,$3::text,$4::uuid) as result', ['request', {}, 'digest', 'receipt']],
    ['read_fund_authority_alignment', 'select bx1_portal.read_fund_authority_alignment($1::uuid,$2::uuid,$3::jsonb,$4::uuid) as result', ['request', 'actor', {}, 'receipt']],
    ['record_fund_authority_alignment', 'select bx1_portal.record_fund_authority_alignment($1::jsonb,$2::text,$3::uuid,$4::jsonb,$5::uuid) as result', [{}, 'PREPARE', 'key', {}, 'receipt']],
  ] as const)('uses the exact parameterised %s without interpolating payloads', async (name, statement, parameters) => {
    const args = [...parameters]
    await expect(callFundWorker(name, args)).resolves.toEqual({ fixture: 'not-chain-evidence' })
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith(statement, args)
  })
  it('does not surface database payloads on failure', async () => {
    mocks.query.mockRejectedValueOnce(new Error('synthetic-private-value-must-not-escape'))
    await expect(callFundWorker('read_fund_authority_alignment', [])).rejects.toThrow('The execution outcome could not be confirmed.')
  })
  it('keeps MAIN and foreign worker projects/configurations denied', () => {
    mocks.environment = 'MAINNET'
    expect(() => fundWorkerDatabaseConfig()).toThrow('Fund execution is not admitted in MAIN.')
    mocks.environment = 'TESTNET'
    expect(() => fundWorkerDatabaseConfig({ BLOCKXONE_FUND_EXECUTION_DATABASE_URL: 'postgresql://postgres:synthetic@db.oqkevkjbkpugjotihtda.supabase.co:5432/postgres?sslmode=verify-full' })).toThrow()
  })
})
