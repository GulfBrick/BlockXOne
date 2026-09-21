import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Source editing is local; every runtime and database proof is cloud-only.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Entry SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('Entry SQL proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-entry-cloud-ci' }
const db = new pg.Client(options), peers = []
let phase = 'initialise', checks = 0, sequence = 0, begun = false, connected = false, committed = false
const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => `ef400000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', other = 'e3000000-0000-4000-8000-000000000002'
const eq = (actual, wanted, label) => { assert.deepEqual(actual, wanted, label); checks++ }
const truth = (actual, label) => { assert.ok(actual, label); checks++ }
async function scalar(sql, values = [], client = db) { return Object.values((await client.query(sql, values)).rows[0])[0] }
async function admin(client = db) { await client.query('reset role') }
async function actor(n, client = db, extra = {}) {
  await admin(client)
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', aal: 'aal1', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })])
  await client.query('set local role authenticated')
}
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  try { await db.query(sql) } catch (error) { const p = Number(error.position); if (p > 0 && p <= sql.length) error.fixtureLine = sql.slice(0, p - 1).split('\n').length; throw error }
}
async function read(n, client = db) { await actor(n, client); return scalar('select public.bx1_entry_read()', [], client) }
async function command(n, kind, payload, requestKey = key(), client = db) {
  await actor(n, client)
  return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [kind, requestKey, JSON.stringify(payload)], client)
}
async function scoped(n, kind, payload, requestKey = key()) {
  await actor(n)
  return scalar("select public.bx1_portal_command_scoped($1,$2,$3::jsonb,'{\"mode\":\"APPLICANT\"}'::jsonb)", [kind, requestKey, JSON.stringify(payload)])
}
async function denied(label, action, wanted = '23514') {
  await db.query('savepoint denied_case')
  let actual
  try { await action() } catch (error) { actual = error.code }
  await db.query('rollback to savepoint denied_case; release savepoint denied_case')
  eq(actual, wanted, label)
}
const doc = (n, kind, i) => ({ id: `ed000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, kind, title: `Synthetic ${kind}`, storage_path: `${uid(n)}/synthetic-${kind}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' })
const details = (n, wm = false) => ({ full_name: `Synthetic Applicant ${n}`, country: 'ZA', investor_type: wm ? 'ENTITY' : 'INDIVIDUAL', company_name: wm ? 'Synthetic Company' : '', registration_reference: wm ? 'SYNTHETIC-1' : '', source_of_funds: 'Fictional test savings only, no actual money or customer information.', beneficial_owners: wm ? 'Synthetic owner with one hundred percent fictional ownership.' : '', experience: 'Synthetic investment experience for workflow testing only.', documents: (wm ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => doc(n, kind, i)), test_data_acknowledged: true })
async function snapshot() {
  await admin()
  return scalar(`select jsonb_build_object('applications',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a),
    'entry_requests',(select count(*) from bx1_portal.entry_requests),'requests',(select count(*) from bx1_portal.requests),
    'events',(select count(*) from bx1_portal.events),'memberships',(select count(*) from public.bx1_memberships),
    'profiles',(select count(*) from public.bx1_profiles),'accounts',(select count(*) from bx1_portal.investment_accounts))`)
}
async function concurrent(client, action) {
  await client.query('begin')
  try { const result = await action(client); await client.query('commit'); return { result } }
  catch (error) { await client.query('rollback'); return { code: error.code } }
}
async function waitBlocked(pids) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    if (await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids]) === pids.length) { checks++; return }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Entry requests did not overlap on the actual actor lock')
}

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'disposable service only')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'fresh fixture')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.users add column raw_user_meta_data jsonb default '{}'; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await db.query('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated')
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql', '20260918234447_bx1_controlled_administration.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  await sqlFile('../../../supabase/tests/bx1_portal.sql')
  phase = 'legacy-baseline'
  await actor(3)
  const legacyKey = key(), legacyPayload = { persona: 'INVESTOR', expected_revision: 0, details: details(3) }
  const legacy = await scalar('select public.bx1_portal_command($1,$2,$3::jsonb)', ['submit_application', legacyKey, JSON.stringify(legacyPayload)])
  const legacyApplication = legacy.applications[0]
  await admin()
  const history = await scalar("select jsonb_build_object('application',(select to_jsonb(a) from bx1_portal.applications a where id=$1),'requests',(select jsonb_agg(to_jsonb(r) order by request_key) from bx1_portal.requests r),'events',(select jsonb_agg(to_jsonb(e) order by id) from bx1_portal.events e),'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m))", [legacyApplication.id])
  await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/features/bx1_portal_funding.sql')
  const wrapperDefinitions = await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure)")
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  phase = 'additive-cutover-and-default-denial'
  eq(await scalar("select jsonb_build_object('application',(select to_jsonb(a)-array['context_kind','context_organisation_id','origin','created_at'] from bx1_portal.applications a where id=$1),'requests',(select jsonb_agg(to_jsonb(r) order by request_key) from bx1_portal.requests r),'events',(select jsonb_agg(to_jsonb(e) order by id) from bx1_portal.events e),'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m))", [legacyApplication.id]), history, 'historical IDs, decisions, receipts, audit and memberships unchanged')
  eq(await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure)"), wrapperDefinitions, 'outer authority and funding writers unchanged')
  const historicalRead = await read(3)
  eq(historicalRead.applications[0].id, legacyApplication.id, 'entry projection keeps exact historical application')
  eq(historicalRead.applications[0].origin, 'LEGACY', 'legacy provenance explicit')
  eq(historicalRead.admission.manual_test_review, false, 'absent release configuration closes manual review')
  eq(historicalRead.contexts, [], 'applicant does not acquire native role context')
  await actor(3)
  truth((await scalar("select public.bx1_portal_read_scoped('{\"mode\":\"APPLICANT\"}'::jsonb)")).funding, 'funding projection remains installed after entry cutover')
  await actor(3, db, { iss: undefined })
  eq((await scalar("select public.bx1_portal_read_scoped('{\"mode\":\"APPLICANT\"}'::jsonb)")).funding, undefined, 'existing funding issuer gate remains closed for missing issuer')
  await admin()
  for (const table of ['entry_configuration', 'entry_requests']) {
    for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')", [role, `bx1_portal.${table}`]), false, `${role} cannot access ${table} directly`)
    eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`bx1_portal.${table}`]), true, `${table} RLS enabled`)
  }
  for (const role of ['anon', 'service_role']) eq(await scalar("select has_function_privilege($1,'public.bx1_entry_command(text,uuid,jsonb)','EXECUTE')", [role]), false, `${role} cannot invoke entry command`)
  for (const name of ['execute_command_pre_entry(text,uuid,jsonb)', 'execute_command(text,uuid,jsonb)', 'entry_submit(uuid,integer,jsonb)', 'snapshot_signup_capacity()']) eq(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [`bx1_portal.${name}`]), false, `no direct privileged ${name}`)
  await denied('historical identity cannot be overwritten', () => db.query("update bx1_portal.applications set persona='WEALTH_MANAGER' where id=$1", [legacyApplication.id]))
  await denied('mainnet cannot enable manual rehearsal review', () => db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('MAINNET',true,$1,'synthetic test admission')", [scope]))
  await denied('null routing cannot bypass check', () => db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,null,'synthetic test admission')"))
  await denied('unknown reviewer route cannot claim legacy compatibility', () => db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic test admission')", [other]))
  await denied('privileged Storage completion is default closed', () => db.query("insert into storage.objects(bucket_id,name,owner_id) values('bx1-portal-documents',$1,$2)", [`${uid(9)}/unadmitted-upload.pdf`, uid(9)]), '55000')

  phase = 'signup-intent-and-no-authority'
  for (const [n, intent] of [[11, 'investor'], [12, 'wealth-manager'], [13, 'SuperAdmin']]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3::jsonb)', [uid(n), `entry-${n}@example.invalid`, JSON.stringify({ portal_intent: intent, role: 'SuperAdmin' })])
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,now()+interval '1 hour',now()-interval '1 hour')", [sid(n), uid(n)])
  }
  const investor = (await read(11)).applications[0], manager = (await read(12)).applications[0]
  eq([investor.persona, manager.persona], ['INVESTOR', 'WEALTH_MANAGER'], 'fresh signup intents become distinct server-owned drafts')
  eq([investor.status, investor.origin, investor.provider_mode, investor.context_kind], ['DRAFT', 'SIGNUP', 'UNASSIGNED', 'PERSONAL'], 'signup is preference not approval')
  eq((await read(13)).applications.length, 0, 'unknown intent never falls back to investor')
  await admin(); eq(await scalar('select count(*)::int from public.bx1_profiles where id=any($1::uuid[])', [[uid(11), uid(12), uid(13)]]), 0, 'signup creates no privileged profile')
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[])', [[uid(11), uid(12), uid(13)]]), 0, 'signup creates no roles')
  await db.query("update auth.users set raw_user_meta_data='{\"portal_intent\":\"investor\",\"role\":\"SuperAdmin\"}' where id=$1", [uid(12)])
  eq((await read(12)).applications.map(a => [a.id, a.persona]), [[manager.id, 'WEALTH_MANAGER']], 'editable metadata cannot redirect or add capacities later')
  await denied('unverified account cannot enter', () => read(7), '42501')
  await denied('missing MFA blocks enrolled applicant', async () => { await admin(); await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(11), uid(11)]); await read(11) }, '42501')

  phase = 'capacity-exactness-and-routing'
  const startKey = key(), startPayload = { persona: 'WEALTH_MANAGER' }
  let state = await command(11, 'start_application', startPayload, startKey)
  const second = state.applications.find(a => a.persona === 'WEALTH_MANAGER')
  eq(state.applications.length, 2, 'one person has both personal capacities')
  eq(state.applications.find(a => a.id === investor.id), investor, 'adding capacity preserves first application exactly')
  eq((await command(11, 'start_application', startPayload, startKey)).applications.length, 2, 'same key replay adds no capacity')
  truth((await read(11)).requests.some(receipt => receipt.key === startKey && receipt.command === 'start_application' && receipt.application_id === second.id), 'readback carries own durable receipt for uncertain-save refresh recovery')
  eq((await read(12)).requests.length, 0, 'receipts never cross users')
  eq((await command(11, 'start_application', startPayload)).applications.find(a => a.persona === 'WEALTH_MANAGER').id, second.id, 'new key still resolves same capacity identity')
  await denied('same key changed body rejected', () => command(11, 'start_application', { persona: 'INVESTOR' }, startKey), '23505')
  await denied('caller cannot assign role in entry payload', () => command(11, 'start_application', { persona: 'INVESTOR', role: 'SuperAdmin' }), '22023')
  await denied('caller cannot submit another principal case', () => command(11, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: details(11, true) }), '42501')
  await denied('submission is default closed', () => command(11, 'submit_application', { application_id: investor.id, expected_revision: investor.revision, details: details(11) }), '55000')
  await admin(); await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic entry acceptance fixture')", [scope])
  for (const n of [11, 12, 13]) await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) select 'bx1-portal-documents',$1||'/synthetic-'||kind||'.pdf',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}',jsonb_build_object('sha256',repeat('a',64)) from unnest(array['IDENTITY','COMPANY','BENEFICIAL_OWNERS'])kind", [uid(n)])
  await denied('TEST configuration cannot invoke MAIN-only ACL seal', () => db.query('select bx1_portal.seal_entry_only_baseline()'), '55000')
  const submitKey = key(), submission = { application_id: investor.id, expected_revision: investor.revision, details: details(11) }
  state = await command(11, 'submit_application', submission, submitKey)
  eq(state.applications.find(a => a.id === investor.id).status, 'SUBMITTED', 'exact investor case submitted')
  eq(state.applications.find(a => a.id === second.id).status, 'DRAFT', 'other capacity untouched')
  eq((await command(11, 'submit_application', submission, submitKey)).applications.find(a => a.id === investor.id).revision, 2, 'submit replay has one revision')
  await denied('different key stale revision rejected', () => command(11, 'submit_application', submission))
  await denied('persona cannot be changed on exact submission', () => command(12, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: details(12, true), persona: 'INVESTOR' }), '22023')
  eq((await command(12, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: details(12, true) })).applications[0].persona, 'WEALTH_MANAGER', 'manager route preserved through submission')
  eq((await read(11)).applications.some(a => a.user_id !== uid(11)), false, 'entry projection is strictly person-owned')
  const contexts = (await read(1)).contexts
  eq(contexts.map(c => [c.context_key, c.roles]), [[scope, ['Investor']]], 'only authoritative active native scope listed')
  const orgDraft = (await command(1, 'start_application', { persona: 'WEALTH_MANAGER', context_key: scope })).applications.find(a => a.context_kind === 'ORGANISATION')
  eq([orgDraft.context_organisation_id, orgDraft.status], [scope, 'DRAFT'], 'current organisation capacity is distinct draft')
  await denied('unrelated organisation context denied', () => command(1, 'start_application', { persona: 'WEALTH_MANAGER', context_key: other }), '42501')
  await denied('organisation draft never enters legacy owner review', () => command(1, 'submit_application', { application_id: orgDraft.id, expected_revision: orgDraft.revision, details: details(1, true) }), '55000')
  await denied('suspended membership prevents subsequent capacity writes', async () => { await admin(); await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1", [uid(1)]); await command(1, 'start_application', { persona: 'INVESTOR', context_key: scope }) }, '42501')
  const legacyState = await scoped(3, 'submit_application', { persona: 'WEALTH_MANAGER', expected_revision: 0, details: details(3, true) })
  eq(legacyState.applications.find(a => a.id === legacyApplication.id).persona, 'INVESTOR', 'legacy persona route cannot overwrite existing investor identity')
  eq(legacyState.applications.filter(a => a.user_id === uid(3)).length, 2, 'legacy route resolves exact personal persona')
  await denied('legacy cannot reuse entry command key', () => scoped(11, 'submit_application', { persona: 'WEALTH_MANAGER', expected_revision: second.revision, details: details(11, true) }, startKey), '23505')

  phase = 'audit-atomicity'
  const beforeFailure = await snapshot()
  await denied('audit failure rolls back draft and request', async () => {
    await admin(); await db.query("create function public.synthetic_entry_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic_audit_failure' using errcode='23514'; end $$; create trigger synthetic_entry_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_entry_audit_failure()")
    await command(9, 'start_application', { persona: 'INVESTOR' })
  })
  eq(await snapshot(), beforeFailure, 'failed audit leaves all records and authority unchanged')
  const beforeSubmitFailure = await snapshot()
  await denied('audit failure rolls back exact-case submission', async () => {
    await admin(); await db.query("create function public.synthetic_entry_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic_audit_failure' using errcode='23514'; end $$; create trigger synthetic_entry_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_entry_audit_failure()")
    await command(11, 'submit_application', { application_id: second.id, expected_revision: second.revision, details: details(11, true) })
  })
  eq(await snapshot(), beforeSubmitFailure, 'failed submission audit leaves revisions, details and receipts unchanged')
  await admin(); await db.query('commit'); begun = false; committed = true

  phase = 'actual-simultaneous-capacity-requests'
  for (let i = 0; i < 2; i++) { const client = new pg.Client({ ...options, application_name: `bx1-entry-race-${i}` }); await client.connect(); peers.push(client) }
  const pids = await Promise.all(peers.map(c => scalar('select pg_backend_pid()', [], c)))
  await db.query('begin'); begun = true
  await db.query("select pg_advisory_xact_lock(hashtextextended('bx1_portal:'||$1,0))", [uid(9)])
  const raceKey = key(), racePayload = { persona: 'INVESTOR' }
  const pending = peers.map(c => concurrent(c, client => command(9, 'start_application', racePayload, raceKey, client)))
  await waitBlocked(pids)
  await db.query('commit'); begun = false
  const races = await Promise.all(pending)
  truth(races.every(r => r.result), 'both real concurrent identical requests complete')
  eq(races[0].result.applications[0].id, races[1].result.applications[0].id, 'racing requests resolve same application')
  eq(await scalar('select count(*)::int from bx1_portal.entry_requests where actor_id=$1 and request_key=$2', [uid(9), raceKey]), 1, 'one durable receipt after simultaneous requests')
  eq(await scalar('select count(*)::int from bx1_portal.events where actor_id=$1 and kind=$2', [uid(9), 'start_application']), 1, 'one creation audit after simultaneous requests')

  phase = 'revocation-observed-after-actual-wait'
  await db.query('begin'); begun = true
  await db.query("select pg_advisory_xact_lock(hashtextextended('bx1_portal:'||$1,0))", [uid(1)])
  const revoked = concurrent(peers[0], client => command(1, 'start_application', { persona: 'INVESTOR', context_key: scope }, key(), client))
  await waitBlocked([pids[0]])
  await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1", [uid(1)])
  await db.query('commit'); begun = false
  eq((await revoked).code, '42501', 'completed revocation defeats a previously waiting command')
  eq(await scalar("select count(*)::int from bx1_portal.applications where user_id=$1 and persona='INVESTOR' and context_kind='ORGANISATION'", [uid(1)]), 0, 'revocation race created no unauthorised capacity')

  phase = 'mfa-and-expiry-after-wait'
  for (const mode of ['mfa', 'expiry']) {
    const n = mode === 'mfa' ? 6 : 8
    await db.query('begin'); begun = true
    await db.query("select pg_advisory_xact_lock(hashtextextended('bx1_portal:'||$1,0))", [uid(n)])
    const waiting = concurrent(peers[0], client => command(n, 'start_application', { persona: 'INVESTOR' }, key(), client))
    await waitBlocked([pids[0]])
    if (mode === 'mfa') await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(n), uid(n)])
    else await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=$1", [uid(n)])
    await db.query('commit'); begun = false
    eq((await waiting).code, '42501', `${mode} changed during wait fails closed`)
  }
  console.log(JSON.stringify({ ok: true, suite: 'stage1-entry-cloud-sql', checks, historical_application_id: legacyApplication.id, proof_boundary: 'Synthetic cloud PostgreSQL17 only; not hosted UI, genuine MFA enrollment, or production admission.' }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, suite: 'stage1-entry-cloud-sql', phase, checks, code: error?.code ?? null, fixtureLine: error?.fixtureLine ?? null, message: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
} finally {
  if (begun && connected) await db.query('rollback').catch(() => {})
  for (const peer of peers) await peer.end().catch(() => {})
  if (committed && connected) {
    await admin().catch(() => {})
    await db.query('drop schema if exists bx1_portal,bx1_private,storage,auth,public cascade; create schema public').catch(error => { console.error(JSON.stringify({ ok: false, phase: 'fixture-cleanup', code: error.code })); process.exitCode = 1 })
  }
  if (connected) await db.end().catch(() => {})
}
