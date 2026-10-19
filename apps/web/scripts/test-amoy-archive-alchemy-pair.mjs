import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Cloud-only catalog/compiler/predicate proof. No production connection, RPC,
// actor claims, business writers or provider capability is exercised here.
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.BX1_AMOY_ARCHIVE_ALCHEMY_SQL_TEST_URL !== expected) throw new Error('Alchemy native proof requires the exact disposable cloud PG17 fixture')
const db = new pg.Client({ connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000 })
let connected = false, created = false, phase = 'initialise', checks = 0
const file = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
const hash = value => createHash('sha256').update(value).digest('hex')
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const tag = (source, name) => {
  const parts = source.split('$' + name + '$')
  assert.equal(parts.length, 3, 'Exactly one source tag ' + name); return parts[1]
}
const replaceTag = (source, name, value) => source.replace('$' + name + '$' + tag(source, name) + '$' + name + '$', () => '$' + name + '$' + value + '$' + name + '$')
const quote = identifier => '"' + identifier.replace(/"/g, '""') + '"'
function definition(source, name) {
  const start = source.indexOf('create function ' + name + '('), open = source.indexOf('$$', start), end = source.indexOf('$$;', open + 2)
  assert(start >= 0 && open > start && end > open, 'Real dependency definition ' + name)
  return source.slice(start, end + 3)
}
function ddl(target, body = target.original) {
  const name = target.signature.split('(')[0], types = target.signature.slice(target.signature.indexOf('(') + 1, -1).split(',')
  const args = types.map((type, index) => quote(target.metadata.proargnames[index]) + ' ' + type).join(',')
  // Native metadata pins below are compared before adapting catalog-specific
  // OIDs. The complete actual captured body is compiled, never a writer stub.
  return 'create or replace function ' + name + '(' + args + ') returns ' + (target.metadata.prorettype === '16' ? 'boolean' : 'jsonb')
    + " language plpgsql " + (target.metadata.provolatile === 'i' ? 'immutable' : 'volatile')
    + (target.metadata.prosecdef ? ' security definer' : ' security invoker') + " set search_path='' as $alchemy_fixture$" + body + '$alchemy_fixture$;'
}
async function scalar(sql, values = []) { return Object.values((await db.query(sql, values)).rows[0])[0] }
async function denied(label, action, code = 'P0001') {
  await db.query('begin'); let actual
  try { await action() } catch (error) { actual = error.code }
  await db.query('rollback'); await db.query('reset role'); eq(actual, code, label)
}
async function catalog() {
  return scalar(`select jsonb_build_object(
    'functions',(select coalesce(jsonb_agg(to_jsonb(p) order by p.oid),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('bx1_portal','bx1_private','public','auth')),
    'history',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.alchemy_fixture_history x),
    'roles',(select md5(jsonb_agg(to_jsonb(r) order by oid)::text) from pg_roles r),
    'members',(select md5(coalesce(jsonb_agg(to_jsonb(m) order by roleid,member,grantor)::text,'[]')) from pg_auth_members m),
    'namespaces',(select md5(jsonb_agg(to_jsonb(n) order by oid)::text) from pg_namespace n),
    'triggers',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by oid)::text,'[]')) from pg_trigger t))`)
}
function finalBody(target) { return target.cuts.reduce((body, cut) => body.replace(cut.from, cut.to), target.original) }

try {
  await db.connect(); connected = true
  eq(await scalar("select current_setting('server_version_num')::integer/10000"), 17, 'Actual cloud PostgreSQL17')
  eq(await scalar('select current_user'), 'postgres', 'Disposable owner')
  eq(await scalar("select count(*)::integer from pg_namespace where nspname in('bx1_portal','bx1_private','auth')"), 0, 'Earlier fixtures cleaned schemas')
  const [feature, proof, portal, roleplay, identity] = await Promise.all([
    file('../../../supabase/features/bx1_amoy_archive_alchemy_pair.sql'),
    file('../../../supabase/tests/bx1_amoy_archive_alchemy_pair.sql'),
    file('../../../supabase/features/bx1_portal.sql'),
    file('../../../supabase/features/bx1_fund_test_roleplay.sql'),
    file('../../../supabase/tests/bx1_identity_workspace.sql'),
  ])
  const targets = JSON.parse(tag(feature, 'alchemy_pair_targets'))
  eq(targets.length, 7, 'Exact seven targets'); eq(targets.flatMap(t => t.cuts).length, 11, 'Exact eleven cuts')
  phase = 'compile-captured-originals'
  await db.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin;end if;
    if not exists(select 1 from pg_roles where rolname='bx1_fund_execution_worker') then create role bx1_fund_execution_worker nologin;end if;
    end $$;
    create schema auth;create schema bx1_portal;create schema bx1_private;
    create table bx1_portal.entry_configuration(singleton boolean primary key,environment text not null);
    insert into bx1_portal.entry_configuration values(true,'TESTNET');
    create table public.alchemy_fixture_history(id integer primary key,payload jsonb not null,original_hash text not null);`)
  created = true
  await db.query(definition(identity, 'auth.jwt')); await db.query(definition(identity, 'auth.uid'))
  await db.query(definition(portal, 'bx1_portal.require_keys'))
  await db.query(definition(roleplay, 'bx1_private.test_roleplay_environment'))
  // Composite declarations are required to compile the real saved bodies.
  // No writer is called; these empty relations do not model business authority.
  const compositeRelations = new Set()
  for (const target of targets) {
    eq(hash(target.original), target.sha, 'Captured original SHA ' + target.oid)
    eq(hash(finalBody(target)), target.final_sha, 'Captured final SHA ' + target.oid)
    const declarations = target.original.slice(0, target.original.indexOf('\nbegin'))
    for (const match of declarations.matchAll(/\b\w+\s+(bx1_(?:portal|private)\.\w+)/g)) compositeRelations.add(match[1])
  }
  for (const name of compositeRelations) await db.query('create table ' + name + '(id uuid primary key)')
  const local = []
  for (const target of targets) {
    await db.query(ddl(target))
    await db.query('revoke all on function ' + target.signature + ' from public,anon,authenticated,service_role,bx1_fund_execution_worker')
    for (const acl of target.metadata.proacl) await db.query('grant execute on function ' + target.signature + ' to ' + quote(acl.split('=')[0]))
    const row = (await db.query("select oid::integer,prosrc,to_jsonb(p)-'prosrc' as metadata from pg_proc p where oid=to_regprocedure($1)", [target.signature])).rows[0]
    eq(row.prosrc, target.original, 'Actual compiled original bytes')
    const captured = { ...target.metadata }, actual = { ...row.metadata }
    for (const field of ['oid', 'proowner', 'pronamespace', 'prolang']) { delete captured[field]; delete actual[field] }
    eq(actual, captured, 'All non-catalog-specific native metadata copied exactly')
    local.push({ ...target, oid: row.oid, metadata: row.metadata })
  }
  // EXPLICIT FIXTURE ADAPTATION ONLY: OID/namespace/owner/language catalog
  // identifiers differ in fresh PG17. No executable installer branch changes.
  const localCompact = local.map(({ original, ...target }) => target)
  let installer = replaceTag(feature, 'alchemy_pair_targets', JSON.stringify(local))
  installer = replaceTag(installer, 'alchemy_inverse_targets', JSON.stringify(localCompact))
  const queryProof = replaceTag(proof, 'alchemy_pair_proof_targets', JSON.stringify(localCompact))
  const inverse = tag(installer, 'alchemy_pair_inverse')
  const urls = ['https://polygon-amoy.drpc.org', 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.gateway.tenderly.co', 'https://80002.rpc.thirdweb.com']
  for (const [index, pair] of [[urls[0], urls[1]], [urls[0], urls[2]], [urls[3], urls[2]]].entries()) {
    await db.query('insert into public.alchemy_fixture_history values($1,$2::jsonb,md5(($2::jsonb)::text))', [index, JSON.stringify({ providers: pair })])
  }
  const baseline = await catalog()
  phase = 'negative-preflight'
  await denied('MAIN gate denies', async () => {
    await db.query("update bx1_portal.entry_configuration set environment='MAINNET'"); await db.query(installer)
  }, '42501')
  await denied('Non-owner denies', async () => { await db.query('set role authenticated'); await db.query(installer) }, '42501')
  await denied('Unknown body rejected without partial cut', async () => {
    await db.query(ddl(local[0], local[0].original + '\n-- synthetic source drift')); await db.query(installer)
  })
  await denied('Full metadata drift rejected', async () => {
    await db.query('alter function ' + local[0].signature + ' cost 101'); await db.query(installer)
  })
  await denied('Mixed original/final set rejected', async () => {
    await db.query(ddl(local[0], finalBody(local[0]))); await db.query(installer)
  })
  const badTargets = structuredClone(local); badTargets[6].cuts[0].from += '__missing_cut'
  await denied('Unknown literal cut rejected', () => db.query(replaceTag(installer, 'alchemy_pair_targets', JSON.stringify(badTargets))))
  eq(await catalog(), baseline, 'Every negative restores full functions/history/catalog')
  phase = 'atomic-failed-second-ddl'
  await db.query(`create table public.alchemy_fixture_failure(n integer);insert into public.alchemy_fixture_failure values(0);
    create function public.alchemy_fixture_fail_second() returns event_trigger language plpgsql as $$
    begin update public.alchemy_fixture_failure set n=n+1;
      if (select n from public.alchemy_fixture_failure)=2 then raise exception 'synthetic_second_ddl_failure';end if;end;$$;
    create event trigger alchemy_fixture_fail_second on ddl_command_end when tag in('CREATE FUNCTION') execute function public.alchemy_fixture_fail_second();`)
  const failureBaseline = await catalog()
  await denied('Second real CREATE OR REPLACE failure rolls back first', () => db.query(installer))
  eq(await catalog(), failureBaseline, 'Second-DDL failure restores complete catalog/history')
  eq(await scalar('select n from public.alchemy_fixture_failure'), 0, 'Failure counter itself rolled back')
  await db.query('drop event trigger alchemy_fixture_fail_second;drop function public.alchemy_fixture_fail_second();drop table public.alchemy_fixture_failure')
  eq(await catalog(), baseline, 'Failure instrumentation fully removed')
  phase = 'forced-rollback'
  await db.query('begin'); await db.query(installer); await db.query(installer); await db.query(queryProof); await db.query('rollback')
  eq(await catalog(), baseline, 'Install twice plus pure proof transaction rollback restores exact baseline')
  phase = 'install-idempotence-inverse'
  await db.query(installer); const once = await catalog()
  await db.query(installer); eq(await catalog(), once, 'Idempotent repeat exact full catalog equality')
  await db.query(queryProof)
  const final = await catalog()
  eq(final.history, baseline.history, 'All three historical provider payload/hash rows unchanged')
  for (const target of local) {
    const row = (await db.query("select prosrc,to_jsonb(p)-'prosrc' as metadata from pg_proc p where oid=$1::oid", [target.oid])).rows[0]
    eq(row.metadata, target.metadata, 'Target OID/full metadata unchanged')
    eq(hash(row.prosrc), target.final_sha, 'Actual final source exact')
  }
  const ids = new Set(local.map(t => String(t.oid)))
  eq(final.functions.filter(p => !ids.has(String(p.oid))), baseline.functions.filter(p => !ids.has(String(p.oid))), 'Every non-target function unchanged')
  for (const key of ['roles', 'members', 'namespaces', 'triggers']) eq(final[key], baseline[key], 'No ' + key + ' drift')
  await db.query(inverse); eq(await catalog(), baseline, 'Checked inverse restores seven full original pg_proc rows')
  await db.query(inverse); eq(await catalog(), baseline, 'Inverse idempotence')
  await db.query(installer); await db.query(queryProof)
  console.log('BX1_AMOY_ARCHIVE_ALCHEMY_SQL_PASS assertions=' + checks + ' targets=7 cuts=11 pairCases=40 metadataCases=11 fixture=disposable-PG17 catalogAdaptation=explicit productionBypass=none writers=not-called auth=not-proven provider=not-proven businessJourney=not-proven')
} catch (error) {
  const code = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'ASSERTION'
  const label = typeof error?.message === 'string' ? error.message.split(/[\r\n]/)[0].replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 220) : ''
  console.error('BX1_AMOY_ARCHIVE_ALCHEMY_SQL_FAILED phase=' + phase + ' code=' + code + ' label=' + JSON.stringify(label)); process.exitCode = 1
} finally {
  if (connected) {
    await db.query('rollback').catch(() => {}); await db.query('reset role').catch(() => {})
    if (created) await db.query('drop schema if exists bx1_portal,bx1_private,auth cascade;drop table if exists public.alchemy_fixture_history,public.alchemy_fixture_failure;drop event trigger if exists alchemy_fixture_fail_second;drop function if exists public.alchemy_fixture_fail_second()').catch(() => { process.exitCode = 1 })
    await db.end()
  }
}
