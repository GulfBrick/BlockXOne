import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Fresh synthetic GitHub service only. NEVER run against either Supabase project.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('MAIN entry proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('MAIN entry proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-main-entry-cloud-ci' }
let db = new pg.Client(options), maintenance, connected = false, maintenanceConnected = false, begun = false, committed = false
let phase = 'initialise', checks = 0, sequence = 0
const id = n => `e5000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `e5100000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => `ef500000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
const eq = (actual, wanted, label) => { assert.deepEqual(actual, wanted, label); checks++ }
async function scalar(sql, values = [], client = db) { return Object.values((await client.query(sql, values)).rows[0])[0] }
async function admin() { await db.query('reset role') }
async function actor(n, extra = {}) {
  await admin()
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id(n), session_id: sid(n), role: 'authenticated', aal: n === 1 ? 'aal2' : 'aal1', iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })])
  await db.query('set local role authenticated')
}
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  try { await db.query(sql) } catch (error) { const p = Number(error.position); if (p > 0 && p <= sql.length) error.fixtureLine = sql.slice(0, p - 1).split('\n').length; throw error }
}
async function denied(label, action, wanted = '42501') {
  await db.query('savepoint denied_case')
  let actual
  try { await action() } catch (error) { actual = error.code }
  await db.query('rollback to savepoint denied_case; release savepoint denied_case')
  eq(actual, wanted, label)
}
async function command(n, kind, payload) {
  await actor(n)
  return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [kind, key(), JSON.stringify(payload)])
}
async function nativeRecords(client = db) {
  return scalar(`select jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),
    'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s),
    'factors',(select jsonb_agg(to_jsonb(f) order by id) from auth.mfa_factors f),
    'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.bx1_profiles p),
    'organisations',(select jsonb_agg(to_jsonb(o) order by id) from public.bx1_organisations o),
    'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m),
    'wallets',(select jsonb_agg(to_jsonb(w) order by id) from public.bx1_wallets w),
    'wallet_proofs',(select jsonb_agg(to_jsonb(c) order by id) from bx1_private.wallet_challenges c))`, [], client)
}
async function functionManifest(signatures) {
  return scalar(`select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition',md5(pg_get_functiondef(p.oid)),
    'owner',p.proowner::regrole::text)) from pg_proc p where p.oid::regprocedure::text=any($1::text[])`, [signatures])
}
async function grantManifest(signatures) {
  return (await db.query(`select p.oid::regprocedure::text signature,a.grantor::regrole::text grantor,
    case when a.grantee=0 then 'PUBLIC' else a.grantee::regrole::text end grantee,a.privilege_type,a.is_grantable
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid::regprocedure::text=any($1::text[]) order by signature,grantor,grantee,a.privilege_type`, [signatures])).rows
}

try {
  await db.connect(); connected = true
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and oid<>10 and rolsuper from pg_roles where rolname=current_user"), true, 'independent non-bootstrap fixture postgres')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'fresh database')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.users add column raw_user_meta_data jsonb default '{}'; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await db.query('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated')
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  phase = 'preexisting-native-history'
  for (const n of [1, 2, 3]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id(n), `main-entry-native-${n}@example.invalid`])
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,now()+interval '1 hour',now()-interval '1 hour')", [sid(n), id(n)])
  }
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic existing staff')", [id(1)])
  await db.query("insert into public.bx1_organisations(id,name) values($1,'Synthetic existing MAIN organisation')", [id(100)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'SuperAdmin')", [id(1), id(100)])
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp');", [id(110), id(1)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [id(110), id(1)])
  await db.query("insert into bx1_private.wallet_challenges(id,nonce,user_id,platform_user_id,session_id,organisation_id,domain,chain_id,address,message,issued_at,expires_at,used_at,proof_signature) select $1,repeat('b',64),id,platform_user_id,$2,$3,'https://bx1.co.za',80002,'0x1111111111111111111111111111111111111111','Synthetic historical ownership proof',now(),now()+interval '5 minutes',now(),'0x'||repeat('a',130) from public.bx1_profiles where id=$4", [id(120), sid(1), id(100), id(1)])
  await db.query("insert into public.bx1_wallets(user_id,platform_user_id,organisation_id,address,chain_id,verified_at,last_proof_id) select id,platform_user_id,$1,'0x1111111111111111111111111111111111111111',80002,now(),$2 from public.bx1_profiles where id=$3", [id(100), id(120), id(1)])
  await db.query("insert into storage.buckets(id,name,public) values('preexisting-native-bucket','preexisting-native-bucket',false)")
  await db.query("insert into storage.objects(id,bucket_id,name,owner_id) values($1,'preexisting-native-bucket','historical-native-document',$2)", [id(130), id(1)])
  await db.query(`create policy synthetic_native_read on storage.objects for select to authenticated
    using(bucket_id='preexisting-native-bucket' and owner_id=auth.uid()::text);
    create policy synthetic_native_insert on storage.objects for insert to authenticated
    with check(bucket_id='preexisting-native-bucket' and owner_id=auth.uid()::text);
    create policy synthetic_native_update on storage.objects for update to authenticated
    using(bucket_id='preexisting-native-bucket' and owner_id=auth.uid()::text)
    with check(bucket_id='preexisting-native-bucket' and owner_id=auth.uid()::text);
    create policy synthetic_native_delete on storage.objects for delete to authenticated
    using(bucket_id='preexisting-native-bucket' and owner_id=auth.uid()::text)`)
  const nativeStoragePolicies = await scalar("select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid='storage.objects'::regclass and polname like 'synthetic_native_%'")
  const signatures = (await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('bx1_private','public') order by signature")).rows.map(row => row.signature)
  const preservedSignatures = signatures.filter((signature) => signature !== 'bx1_private.can_access_organisation(uuid)')
  const nativeFunctions = await functionManifest(preservedSignatures), nativeGrants = await grantManifest(signatures), nativeHistory = await nativeRecords()
  eq(await scalar("select to_regclass('bx1_private.person_principals') is null and to_regnamespace('bx1_portal') is null"), true, 'MAIN-shaped baseline has no person-principal or portal subsystem')
  await db.query('create role bx1_fixture_bootstrap nologin superuser')
  await db.query('commit'); begun = false; committed = true
  maintenance = new pg.Client({ ...options, application_name: 'bx1-main-entry-fixture-maintenance' })
  await maintenance.connect(); maintenanceConnected = true
  await maintenance.query('set session authorization bx1_fixture_bootstrap')
  await maintenance.query('grant anon,authenticated,service_role to postgres with inherit false,set true; alter role postgres nosuperuser bypassrls')
  await db.end(); connected = false
  db = new pg.Client(options); await db.connect(); connected = true
  eq(await scalar("select not rolsuper and rolcreaterole and rolbypassrls from pg_roles where rolname=current_user"), true, 'bootstrap executes as hosted-like non-superuser')

  phase = 'atomic-empty-main-entry-bootstrap'
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/migrations/20260918234447_bx1_controlled_administration.sql')
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,admission_reference) values('MAINNET',false,'synthetic cloud Stage 1 MAIN baseline acceptance')")
  await db.query('select bx1_portal.seal_entry_only_baseline()')
  await sqlFile('../../../supabase/features/bx1_application_admission.sql')
  await sqlFile('../../../supabase/migrations/20260923134152_stage2_product_eligibility.sql')
  await sqlFile('../../../supabase/tests/bx1_product_eligibility.sql')
  await sqlFile('../../../supabase/migrations/20260923143713_stage2_customer_mandates.sql')
  await sqlFile('../../../supabase/tests/bx1_customer_mandates.sql')
  await sqlFile('../../../supabase/migrations/20260923144216_stage2_document_receipts.sql')
  await sqlFile('../../../supabase/migrations/20260923171126_stage2_entity_investment_accounts.sql')
  eq(await functionManifest(preservedSignatures), nativeFunctions, 'unrelated native auth/MFA/wallet function definitions and owners exactly preserved')
  const grantsAfter = await grantManifest(signatures)
  eq(grantsAfter.filter(grant => grant.grantee !== 'bx1_authority_owner'), nativeGrants, 'all existing native function grants preserved')
  eq(grantsAfter.filter(grant => grant.grantee === 'bx1_authority_owner').map(grant => [grant.signature, grant.privilege_type, grant.is_grantable]), [
    ['bx1_private.can_access_organisation(uuid)', 'EXECUTE', false],
    ['bx1_private.has_active_session()', 'EXECUTE', false],
    ['bx1_private.read_mfa_status()', 'EXECUTE', false],
  ], 'exact canonical NOLOGIN authority-owner helper grants recorded, not hidden as zero ACL change')
  eq(await scalar("select to_regclass('bx1_portal.funding_obligations') is null"), true, 'MAIN entry does not pretend funding is installed')
  for (const table of ['applications', 'organisations', 'organisation_authority_bindings', 'investment_accounts', 'products', 'subscriptions', 'requests', 'events', 'entry_requests']) eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0, `bootstrap does not seed ${table}`)
  for (const table of ['product_eligibility_cases', 'product_eligibility_receipts']) eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0, `Stage 2 definition does not seed ${table} in MAIN`)
  for (const table of ['legal_entity_parties', 'investing_representative_mandates', 'investing_representative_receipts']) eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0, `entity definition does not seed ${table} in MAIN`)
  eq(await scalar('select count(*)::int from bx1_private.person_principals'), 0, 'dependency creates no person-principal grants')
  eq(await scalar('select count(*)::int from bx1_private.governance_grants'), 0, 'dependency creates no governance grants')
  eq(await scalar("select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid='storage.objects'::regclass and polname like 'synthetic_native_%'"), nativeStoragePolicies, 'pre-existing unrelated Storage policies preserved exactly')
  await db.query('commit'); begun = false
  eq(await nativeRecords(maintenance), nativeHistory, 'native IDs, users, sessions, factors, role rows, wallet links and proof history preserved')

  phase = 'effective-entry-only-acl'
  await db.query('begin'); begun = true
  const portalFunctions = (await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bx1_portal' or (n.nspname='public' and left(p.proname,11)='bx1_portal_')")).rows.map(row => row.signature)
  for (const signature of portalFunctions) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const allowed = role === 'authenticated' && ['bx1_portal.entry_read()', 'bx1_portal.entry_command(text,uuid,jsonb)'].includes(signature)
      eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), allowed, `${role} effective ${signature} admission`)
    }
  }
  for (const signature of ['public.bx1_application_document_versions(uuid,jsonb)',
    'public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false,
        `${role} cannot use unadmitted MAIN document history RPC ${signature}`)
    }
  }
  for (const signature of ['bx1_private.read_administration(uuid,uuid)', 'bx1_private.execute_administration(uuid,uuid,jsonb)', 'public.bx1_administration_read(uuid,uuid)', 'public.bx1_administration_command(uuid,uuid,jsonb)']) {
    for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false, `${role} cannot use new unadmitted administration RPC/helper`)
  }
  await actor(1)
  eq((await scalar('select public.bx1_mfa_status()')).session_is_totp, true, 'existing MFA-backed staff sign-in remains valid')
  eq(await scalar('select count(*)::int from public.bx1_memberships'), 1, 'existing scoped role remains readable')
  eq(await scalar('select count(*)::int from public.bx1_wallets'), 1, 'existing MetaMask proof remains readable')
  const staff = await scalar('select public.bx1_entry_read()')
  eq(staff.contexts.map(c => [c.organisation_id, c.roles]), [[id(100), ['SuperAdmin']]], 'staff sees exactly existing invited scope')
  eq(staff.applications, [], 'staff receives no accidental investor application')
  await denied('missing enrolled MFA cannot use entry', async () => { await actor(1, { aal: 'aal1' }); await scalar('select public.bx1_entry_read()') })
  await denied('legacy portal writer is denied directly', async () => { await actor(2); await scalar("select public.bx1_portal_command('submit_application',$1,'{}')", [key()]) })
  await denied('scoped legacy writer is denied directly', async () => { await actor(2); await scalar("select public.bx1_portal_command_scoped('submit_application',$1,'{}','{\"mode\":\"APPLICANT\"}')", [key()]) })
  await denied('private legacy helper is denied directly', async () => { await actor(2); await scalar("select bx1_portal.execute_command('submit_application',$1,'{}')", [key()]) })
  await denied('entry-only seal cannot be invoked by applicant', async () => { await actor(2); await scalar('select bx1_portal.seal_entry_only_baseline()') })
  await denied('direct application writes are denied', async () => { await actor(2); await db.query("insert into bx1_portal.applications(user_id,persona,status,details) values($1,'INVESTOR','DRAFT','{}')", [id(2)]) })
  await denied('privileged Storage completion is denied in MAIN', async () => { await admin(); await db.query("insert into storage.objects(bucket_id,name,owner_id) values('bx1-portal-documents',$1,$2)", [`${id(2)}/unadmitted.pdf`, id(2)]) }, '55000')
  await denied('authenticated Storage upload is denied in MAIN', async () => { await actor(2); await db.query("insert into storage.objects(bucket_id,name,owner_id) values('bx1-portal-documents',$1,$2)", [`${id(2)}/unadmitted.pdf`, id(2)]) }, '55000')
  await actor(1)
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='preexisting-native-bucket'"), 1, 'authenticated existing unrelated document remains readable')
  eq((await db.query("insert into storage.objects(id,bucket_id,name,owner_id) values($1,'preexisting-native-bucket','authenticated-native-upload',$2)", [id(131), id(1)])).rowCount, 1, 'authenticated unrelated INSERT works after helper revocation')
  eq((await db.query("update storage.objects set name='authenticated-native-updated' where id=$1", [id(131)])).rowCount, 1, 'authenticated unrelated UPDATE works after helper revocation')
  eq(await scalar('select name from storage.objects where id=$1', [id(131)]), 'authenticated-native-updated', 'authenticated unrelated SELECT returns updated record')
  eq((await db.query('delete from storage.objects where id=$1', [id(131)])).rowCount, 1, 'authenticated unrelated DELETE works after helper revocation')
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='preexisting-native-bucket'"), 1, 'historical unrelated document survived authenticated CRUD proof')
  await actor(2)
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='preexisting-native-bucket'"), 0, 'unrelated bucket ownership isolation remains enforced')

  phase = 'same-entry-contract-without-live-admission'
  let investor = await command(2, 'start_application', { persona: 'INVESTOR' })
  let manager = await command(3, 'start_application', { persona: 'WEALTH_MANAGER' })
  eq([investor.applications[0].persona, manager.applications[0].persona], ['INVESTOR', 'WEALTH_MANAGER'], 'MAIN supports distinct pending capacities using same RPC contract')
  eq(investor.admission.manual_test_review, false, 'MAIN does not invent provider admission')
  investor = await command(2, 'start_application', { persona: 'WEALTH_MANAGER' })
  eq(investor.applications.length, 2, 'MAIN supports multiple capacities without investor fallback')
  await denied('MAIN evidence submission remains unadmitted', () => command(3, 'submit_application', { application_id: manager.applications[0].id, expected_revision: 1, details: {} }), '55000')
  await denied('unassigned organisation is denied', () => command(2, 'start_application', { persona: 'INVESTOR', context_key: id(100) }))
  await admin(); eq(await scalar('select count(*)::int from public.bx1_profiles'), 1, 'entry creates no native profile')
  eq(await scalar('select count(*)::int from public.bx1_memberships'), 1, 'entry creates no native role')
  eq(await scalar('select count(*)::int from bx1_portal.investment_accounts'), 0, 'entry creates no investment account')
  await denied('MAIN config cannot enable synthetic review', () => db.query("update bx1_portal.entry_configuration set manual_test_review=true"), '23514')
  await denied('nonempty baseline cannot be resealed as an empty install', () => db.query('select bx1_portal.seal_entry_only_baseline()'), '55000')
  await db.query('rollback'); begun = false
  console.log(JSON.stringify({ ok: true, suite: 'stage1-main-entry-cloud-sql', checks, native_history_preserved: true, native_function_manifest_preserved: true, funding_installed: false, boundary: 'Synthetic cloud non-superuser database only; exact hosted prerequisite/DDL/advisor/UI acceptance still required. Canonical dependency adds NOLOGIN owner/schema/policies and three owner helper grants, but no people or customer roles.' }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, suite: 'stage1-main-entry-cloud-sql', phase, checks, code: error?.code ?? null, fixtureLine: error?.fixtureLine ?? null, message: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
} finally {
  if (begun && connected) await db.query('rollback').catch(() => {})
  if (committed && maintenanceConnected) {
    await maintenance.query('alter role postgres superuser; drop schema if exists bx1_portal,bx1_private,storage,auth,public cascade; create schema public authorization postgres').catch(error => { console.error(JSON.stringify({ ok: false, phase: 'main-fixture-cleanup', code: error.code })); process.exitCode = 1 })
    await maintenance.query('reset session authorization; drop role if exists bx1_fixture_bootstrap').catch(() => {})
  }
  if (connected) await db.end().catch(() => {})
  if (maintenanceConnected) await maintenance.end().catch(() => {})
}
