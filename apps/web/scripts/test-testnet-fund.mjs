import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Admitted cloud CI only. No connection string, network, credentials, provider
// calls or real identities. This proves serial SQL semantics, not Amoy finality.
if (process.argv.length !== 2) throw new Error('Fund SQL proof accepts no arguments')
const db = new PGlite()
let begun = false
let phase = 'initialise'
let checks = 0
const files = [
  '../../../supabase/tests/bx1_identity_workspace.sql',
  '../../../supabase/tests/bx1_mfa_assurance.sql',
  '../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql',
  '../../../supabase/migrations/20260917190042_bx1_wallet_ownership.sql',
  '../../../supabase/migrations/20260918015541_bx1_mfa_assurance.sql',
  '../../../supabase/migrations/20260920161000_testnet_fund_demo.sql',
]
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  try { await db.exec(sql) }
  catch (error) {
    const position = Number(error?.position)
    if (Number.isInteger(position) && position > 0 && position <= sql.length)
      error.fixtureLine = sql.slice(0, position - 1).split('\n').length
    throw error
  }
}
async function scalar(sql) { return Object.values((await db.query(sql)).rows[0])[0] }
async function equal(sql, expected, label) {
  assert.deepEqual(await scalar(sql), expected, label)
  checks++
}
try {
  const version = Number(await scalar('show server_version_num'))
  assert(version >= 170000 && version < 180000, 'Expected pinned PostgreSQL17')
  checks++
  await db.exec('begin'); begun = true
  for (const file of files) await sqlFile(file)
  phase = 'empty-schema-boundary'
  await equal('select count(*)::int from bx1_demo.funds', 0, 'migration creates no demo funds')
  await equal('select count(*)::int from auth.users', 0, 'migration creates no Auth users')
  await equal("select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolbypassrls and not rolinherit from pg_roles where rolname='bx1_demo_chain_verifier'", true, 'verifier initially has no login or broad role powers')
  await equal("select count(*)::int from pg_class where relnamespace='bx1_demo'::regnamespace and relkind='r' and relrowsecurity", 10, 'all ten demo tables have RLS')
  await sqlFile('../../../supabase/tests/testnet_fund_demo.sql')
  phase = 'fixture-rollback'
  await equal('select count(*)::int from bx1_demo.funds', 0, 'fund lifecycle fixtures rolled back')
  await equal('select count(*)::int from auth.users', 0, 'synthetic identities rolled back')
  await equal('select count(*)::int from bx1_demo.journal_entries', 0, 'synthetic journals rolled back')
  await db.exec('rollback'); begun = false
  await equal("select count(*)::int from pg_namespace where nspname in ('auth','bx1_private','bx1_demo')", 0, 'outer transaction removes every synthetic schema')
  console.log(`BX1_TESTNET_FUND_SQL_PASS boundaryAssertions=${checks} lifecycleScript=completed cleanup=rolled-back fixture=synthetic-serial-cloud-CI Amoy=not-proven GoTrue=not-proven concurrency=not-proven`)
} catch (error) {
  const diagnostic = typeof error?.message === 'string' ? error.message.split(/[\r\n]/, 1)[0].slice(0, 180).replace(/[^\x20-\x7e]/g, '?') : 'unavailable'
  const internalPosition = Number(error?.internalPosition)
  console.error(`BX1_TESTNET_FUND_SQL_FAILED phase=${phase} line=${Number.isInteger(error?.fixtureLine) ? error.fixtureLine : 'unknown'} internalPosition=${Number.isInteger(internalPosition) && internalPosition > 0 ? internalPosition : 'unknown'} code=${typeof error?.code === 'string' ? error.code : 'assertion'} diagnostic=${JSON.stringify(diagnostic)}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.exec('rollback') } catch {} }
  await db.close()
}
