import 'server-only'
import { Pool, type PoolConfig } from 'pg'
import supabaseCa from '@/lib/wallets/supabase-ca.json'
import { fundLifecycleEnvironment, FundLifecycleError } from './fund-lifecycle-server'

/** A restricted evidence writer, never a Supabase service-role client or signing key. */
export function fundWorkerDatabaseConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  if (fundLifecycleEnvironment() !== 'TESTNET') throw new FundLifecycleError('WORKER_NOT_ADMITTED', 'Fund execution is not admitted in MAIN.', 409)
  let url: URL
  try { url = new URL(env.BLOCKXONE_FUND_EXECUTION_DATABASE_URL ?? '') }
  catch { throw new FundLifecycleError('WORKER_NOT_CONFIGURED', 'The fund execution worker is not connected yet.', 503) }
  const project = 'fegnnnlseuejkrusbbkv'
  const role = 'bx1_fund_execution_worker'
  const direct = url.hostname === `db.${project}.supabase.co` && url.port === '5432' && decodeURIComponent(url.username) === role
  const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && ['5432', '6543'].includes(url.port) && decodeURIComponent(url.username) === `${role}.${project}`
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled) || !url.password || url.pathname !== '/postgres'
    || url.hash || url.searchParams.get('sslmode') !== 'verify-full' || [...url.searchParams.keys()].some(key => key !== 'sslmode')) {
    throw new FundLifecycleError('WORKER_CONFIGURATION_INVALID', 'The restricted TEST execution connection could not be verified.', 503)
  }
  return { host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: 'postgres', ssl: { ca: supabaseCa.pem, rejectUnauthorized: true, servername: url.hostname }, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000,
    application_name: 'blockxone-fund-execution', statement_timeout: 8000 }
}

let pool: Pool | undefined
type WorkerFunction = 'prepare_fund_operation' | 'claim_fund_observation' | 'record_fund_observation' | 'read_fund_signature_verification' | 'record_fund_signature_verification'
  | 'read_fund_setup_preparation' | 'prepare_fund_setup_step' | 'read_fund_setup_observation' | 'record_fund_setup_observation'
export async function callFundWorker(name: WorkerFunction, parameters: unknown[]): Promise<unknown> {
  pool ??= new Pool(fundWorkerDatabaseConfig())
  const statements: Record<WorkerFunction, string> = {
    prepare_fund_operation: 'select bx1_portal.prepare_fund_operation($1::uuid,$2::text,$3::jsonb) as result',
    claim_fund_observation: 'select bx1_portal.claim_fund_observation($1::uuid) as result',
    record_fund_observation: 'select bx1_portal.record_fund_observation($1::uuid,$2::jsonb) as result',
    read_fund_signature_verification: 'select bx1_portal.read_fund_signature_verification($1::uuid) as result',
    record_fund_signature_verification: 'select bx1_portal.record_fund_signature_verification($1::uuid,$2::jsonb) as result',
    read_fund_setup_preparation: 'select bx1_portal.read_fund_setup_preparation($1::uuid,$2::text,$3::integer,$4::text,$5::uuid,$6::jsonb) as result',
    prepare_fund_setup_step: 'select bx1_portal.prepare_fund_setup_step($1::jsonb,$2::jsonb) as result',
    read_fund_setup_observation: 'select bx1_portal.read_fund_setup_observation($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb) as result',
    record_fund_setup_observation: 'select bx1_portal.record_fund_setup_observation($1::jsonb,$2::jsonb) as result',
  }
  try {
    const result = await pool.query(statements[name], parameters)
    if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0], 'result')) throw new Error('UNVERIFIED_WORKER_RESULT')
    return result.rows[0].result
  } catch {
    // Database exceptions can carry payloads, connection details or provider
    // data. Keep the complete diagnostic outside public error messages.
    throw new FundLifecycleError('WORKER_RESULT_UNAVAILABLE', 'The execution outcome could not be confirmed. Refresh the existing operation; do not submit another transaction.', 503)
  }
}
