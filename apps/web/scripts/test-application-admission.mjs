import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Application handoff proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('Application handoff proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-application-handoff-cloud-ci' }
const db = new pg.Client(options), peers = []
let phase = 'initialise', checks = 0, sequence = 0, begun = false, connected = false, committed = false
const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => `ef500000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', other = 'e3000000-0000-4000-8000-000000000002'
const applicant = { mode: 'APPLICANT' }, reviewer = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const truth = (value, label) => { assert.ok(value, label); checks++ }
async function scalar(sql, values = [], client = db) { return Object.values((await client.query(sql, values)).rows[0])[0] }
async function admin(client = db) { await client.query('reset role') }
async function actor(n, client = db) {
  await admin(client)
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', aal: 'aal1', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 })])
  await client.query('set local role authenticated')
}
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  try { await db.query(sql) } catch (error) { const p = Number(error.position); if (p > 0 && p <= sql.length) error.fixtureLine = sql.slice(0, p - 1).split('\n').length; throw error }
}
async function entry(n, command, payload, requestKey = key(), client = db) {
  await actor(n, client)
  return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [command, requestKey, JSON.stringify(payload)], client)
}
async function read(n) { await actor(n); return scalar('select public.bx1_entry_read()') }
async function scoped(n, command, payload, context = applicant, requestKey = key()) {
  await actor(n)
  return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [command, requestKey, JSON.stringify(payload), JSON.stringify(context)])
}
async function old(n, command, payload) {
  await actor(n)
  return scalar('select public.bx1_portal_command($1,$2,$3::jsonb)', [command, key(), JSON.stringify(payload)])
}
async function denied(label, operation, code = '23514', message) {
  await db.query('savepoint denied_case')
  let failure
  try { await operation() } catch (error) { failure = error }
  await db.query('rollback to savepoint denied_case; release savepoint denied_case')
  eq(failure?.code, code, label)
  if (message) eq(failure?.message, message, `${label} actionable reason`)
}
const doc = (n, kind, i) => ({ id: `ed000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, kind, title: `Synthetic ${kind}`, storage_path: `${uid(n)}/synthetic-${kind}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' })
const v1 = (n, wm = false) => ({ full_name: `Synthetic Applicant ${n}`, country: 'ZA', investor_type: wm ? 'ENTITY' : 'INDIVIDUAL', company_name: wm ? 'Synthetic Company' : '', registration_reference: wm ? 'SYNTHETIC-1' : '', source_of_funds: 'Original fictional test capital source, never new organisation facts.', beneficial_owners: wm ? 'Synthetic owner with one hundred percent fictional ownership.' : '', experience: 'Original fictional investment objectives, not manager activities.', documents: (wm ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => doc(n, kind, i)), test_data_acknowledged: true })
const v2 = n => ({ details_version: 2, full_name: `Synthetic Representative ${n}`, country: 'ZA', company_name: 'Synthetic Wealth Manager', registration_reference: 'SYNTHETIC-WM-1', beneficial_owners: 'Fictional owner with the entire synthetic organisation interest.', business_activities: 'Explicit synthetic management and customer services description.', representative_position: 'Director', authority_basis: 'Explicit fictional board authorisation for this application.', documents: ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, i) => doc(n, kind, i)), test_data_acknowledged: true })
const reviewBody = (a, decision = 'APPROVED') => ({ application_id: a.id, expected_revision: a.revision, decision, notes: 'Synthetic independent review of the submitted evidence revision.', checks: { identity: true, ownership: true, screening: true, suitability: true } })
const terms = { asset_type: 'FUND', name: 'Historical Synthetic Fund', issuer_name: 'Synthetic Issuer', summary: 'Wholly fictional test offering with no real investment.', strategy: 'Wholly fictional strategy used for compatibility testing only.', share_class: 'A', currency: 'ZAR_TEST', unit_price_minor: '1000', cap_units: '100', minimum_units: '1', pricing_basis: 'Fixed fictional test price.', fees: 'No actual fees charged.', redemption_terms: 'Synthetic exit terms, not a promise of actual liquidity.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL'], property_address: '', property_valuation_minor: '0', rental_income_policy: '', documents: { memorandum: 'Wholly fictional memorandum for an isolated synthetic test fixture only.', risks: 'Wholly fictional risks document for synthetic testing without actual money.', subscription_terms: 'Synthetic subscription terms do not represent ownership or actual payment.' } }
async function snapshot() {
  await admin()
  return scalar(`select jsonb_build_object('applications',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a),
    'versions',(select jsonb_agg(to_jsonb(v) order by application_id,application_revision) from bx1_portal.application_detail_versions v),
    'organisations',(select jsonb_agg(to_jsonb(o) order by id) from bx1_portal.organisations o),
    'events',(select count(*) from bx1_portal.events),'requests',(select count(*) from bx1_portal.entry_requests),
    'memberships',(select count(*) from public.bx1_memberships),'profiles',(select count(*) from public.bx1_profiles))`)
}
async function waitBlocked(pids) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    if (await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids]) === pids.length) { checks++; return }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Requests did not overlap on the required database lock')
}
async function concurrent(client, operation) {
  await client.query('begin')
  try { const result = await operation(client); await client.query('commit'); return { result } }
  catch (error) { await client.query('rollback'); return { code: error.code, message: error.message } }
}

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'exact disposable cloud service')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'fresh fixture only')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.users add column raw_user_meta_data jsonb default '{}'; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await db.query('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated')
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql', '20260918234447_bx1_controlled_administration.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  await sqlFile('../../../supabase/tests/bx1_portal.sql')
  phase = 'historical-application-fixtures'
  let legacy = (await old(1, 'submit_application', { persona: 'WEALTH_MANAGER', expected_revision: 0, details: v1(1, true) })).applications[0]
  await old(2, 'review_application', reviewBody(legacy))
  const pending = (await old(6, 'submit_application', { persona: 'WEALTH_MANAGER', expected_revision: 0, details: v1(6, true) })).applications[0]
  await admin()
  const historical = await scalar('select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a')
  const nativeRows = await scalar("select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.bx1_profiles p),'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m))")
  await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/features/bx1_portal_funding.sql')
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic application handoff cloud acceptance')", [scope])
  const wrappers = await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure)")
  await sqlFile('../../../supabase/features/bx1_application_admission.sql')
  phase = 'history-and-acl-preservation'
  eq(await scalar("select jsonb_agg(to_jsonb(a)-array['admission_purpose','context_kind','context_organisation_id','origin','created_at'] order by id) from bx1_portal.applications a"), historical, 'historical IDs, evidence, decisions, timestamps and organisations unchanged')
  eq(await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure)"), wrappers, 'outer funding and authority writers unchanged')
  eq(await scalar("select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.bx1_profiles p),'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m))"), nativeRows, 'no profiles or memberships created or altered')
  for (const table of ['application_admission_baseline', 'application_detail_versions']) for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')", [role, `bx1_portal.${table}`]), false, `${role} no direct ${table} access`)
  for (const fn of ['application_review_route(uuid)', 'guard_application_admission()', 'capture_application_details()', 'validate_application(jsonb,text)', 'validate_application_v1(jsonb,text)']) for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, `bx1_portal.${fn}`]), false, `${role} cannot invoke private ${fn}`)
  legacy = (await read(1)).applications[0]
  eq(legacy.admission_purpose, 'LEGACY_REHEARSAL', 'already approved linked historical case keeps explicit legacy capability')
  eq((await read(6)).applications[0].admission_purpose, 'CUSTOMER_ORGANISATION_ADMISSION', 'pending legacy-shaped case receives no future owner bypass')
  await admin()
  await denied('purpose immutable even for old shape', () => db.query("update bx1_portal.applications set admission_purpose='LEGACY_REHEARSAL' where id=$1", [pending.id]))
  await denied('baseline mapping immutable', () => db.query('delete from bx1_portal.application_admission_baseline where application_id=$1', [legacy.id]))
  await denied('historical evidence immutable', () => db.query("update bx1_portal.application_detail_versions set details='{}' where application_id=$1", [pending.id]))
  await denied('insert cannot request grandfather authority', () => db.query("insert into bx1_portal.applications(user_id,persona,status,details,admission_purpose) values($1,'WEALTH_MANAGER','DRAFT','{}','LEGACY_REHEARSAL')", [uid(9)]))

  phase = 'persona-specific-entry-and-review-routing'
  const manager = (await entry(8, 'start_application', { persona: 'WEALTH_MANAGER' })).applications[0]
  const investor = (await entry(9, 'start_application', { persona: 'INVESTOR' })).applications[0]
  eq(manager.admission_purpose, 'CUSTOMER_ORGANISATION_ADMISSION', 'new manager is organisation applicant, never legacy operator')
  eq(investor.admission_purpose, 'INVESTOR_ADMISSION', 'investor meaning unchanged')
  eq(manager.review_route, 'AVAILABLE', 'independent configured reviewer assignment visible without staff identity')
  truth(!JSON.stringify(await read(8)).includes('portal-synthetic-2@') && !JSON.stringify(await read(8)).includes('reviewer_count'), 'applicant projection leaks no reviewer contact or counts')
  await denied('wrong persona cannot submit WM v2', () => entry(9, 'submit_application', { application_id: investor.id, expected_revision: investor.revision, details: v2(9) }), '22023')
  await denied('v2 cannot reinterpret investor facts', () => entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: { ...v2(8), source_of_funds: v1(8).source_of_funds } }), '22023')
  await denied('v2 requires all three evidence kinds', () => entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: { ...v2(8), documents: v2(8).documents.slice(0, 1) } }), '23514', 'portal_kyb_evidence_required')
  await denied('v2 rejects unverified upload references', () => entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: { ...v2(8), documents: v2(8).documents.map(d => d.kind === 'IDENTITY' ? { ...d, storage_path: `${uid(8)}/not-uploaded.pdf` } : d) } }), '23514', 'portal_document_upload_not_verified')
  await denied('v2 requires actual representative authority description', () => entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: { ...v2(8), authority_basis: '' } }), '22023')
  await denied('another application cannot be submitted', () => entry(9, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: v2(9) }), '42501')
  await admin(); await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=any($1::uuid[]) and role='ComplianceOfficer'", [[uid(2), uid(4)]])
  eq((await read(8)).applications[0].review_route, 'REVIEWER_UNAVAILABLE', 'unrelated active reviewer does not staff target queue')
  const unstaffed = await snapshot()
  await denied('missing independent reviewer blocks canonical submit', () => entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: v2(8) }), '55000', 'entry_independent_reviewer_unavailable')
  await denied('missing reviewer blocks old persona command too', () => scoped(8, 'submit_application', { persona: 'WEALTH_MANAGER', expected_revision: manager.revision, details: v1(8, true) }), '55000')
  eq(await snapshot(), unstaffed, 'unstaffed rejection changes neither draft, evidence versions, audit nor receipts')
  eq((await read(6)).applications[0].status, 'SUBMITTED', 'existing submitted case preserved despite no staffed reviewer')
  await admin(); await db.query("update public.bx1_memberships set status='ACTIVE' where user_id=$1 and role='ComplianceOfficer'", [uid(4)])
  const self = (await entry(4, 'start_application', { persona: 'INVESTOR' })).applications[0]
  eq(self.review_route, 'REVIEWER_UNAVAILABLE', 'self assignment is not an independent review route')
  eq((await read(1)).applications[0].review_route, 'REVIEWER_UNAVAILABLE', 'same attested human under another login is not independent')
  await admin(); await db.query("update public.bx1_memberships set status='ACTIVE' where user_id=$1 and role='ComplianceOfficer'", [uid(2)])
  await denied('banned reviewer is unavailable', async () => {
    await admin(); await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and role='ComplianceOfficer'", [uid(4)])
    await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [uid(2)])
    await entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: v2(8) })
  }, '55000')

  phase = 'explicit-resubmission-and-new-admission-without-operator-power'
  await denied('pending v1 manager cannot be approved as new organisation admission', async () => scoped(2, 'review_application', reviewBody((await read(6)).applications[0]), reviewer))
  await scoped(2, 'review_application', reviewBody((await read(6)).applications[0], 'CHANGES_REQUIRED'), reviewer)
  let resubmitted = (await read(6)).applications[0]
  resubmitted = (await entry(6, 'submit_application', { application_id: resubmitted.id, expected_revision: resubmitted.revision, details: v2(6) })).applications[0]
  await admin()
  eq(await scalar('select details from bx1_portal.application_detail_versions where application_id=$1 and application_revision=$2', [pending.id, pending.revision]), v1(6, true), 'original legacy evidence retained with original meanings')
  eq(await scalar("select count(*)::int from bx1_portal.application_detail_versions where application_id=$1 and capture_kind='SUBMISSION'", [pending.id]), 1, 'new explicit v2 revision captured')
  await scoped(2, 'review_application', reviewBody(resubmitted), reviewer)
  let submitted = (await entry(8, 'submit_application', { application_id: manager.id, expected_revision: manager.revision, details: v2(8) })).applications[0]
  await denied('wrong organisation cannot review the case', () => scoped(5, 'review_application', reviewBody(submitted), { ...reviewer, organisationId: other }), '42501')
  await scoped(2, 'review_application', reviewBody(submitted), reviewer)
  submitted = (await read(8)).applications[0]
  eq([submitted.status, submitted.admission_purpose], ['APPROVED', 'CUSTOMER_ORGANISATION_ADMISSION'], 'approval means admitted customer awaiting operational assignment')
  await actor(8)
  eq((await scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(applicant)])).organisations, [], 'scoped applicant projection gives no product powers')
  eq((await scalar('select public.bx1_portal_read()')).organisations, [], 'legacy public read gives new admission no implied operational roles')
  await admin()
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(8)]), 0, 'approval creates no native membership')
  eq(await scalar('select count(*)::int from bx1_portal.organisation_authority_bindings where product_organisation_id=$1', [submitted.organisation_id]), 0, 'approval creates no appointed operational binding')
  const productBody = { organisation_id: submitted.organisation_id, terms }
  await denied('new applicant cannot create products through scoped endpoint', () => scoped(8, 'create_product', productBody), '42501')
  await denied('old public write endpoint remains revoked', () => old(8, 'create_product', productBody), '42501')
  await denied('private base writer also denies new applicant owner powers', async () => {
    await actor(8); await admin(); await scalar('select bx1_portal.execute_command($1,$2,$3::jsonb)', ['create_product', key(), JSON.stringify(productBody)])
  }, '42501')
  await denied('pre-entry base writer cannot bypass the purpose gate', async () => {
    await actor(8); await admin(); await scalar('select bx1_portal.execute_command_pre_entry($1,$2,$3::jsonb)', ['create_product', key(), JSON.stringify(productBody)])
  }, '42501')
  const oldProduct = await scoped(1, 'create_product', { organisation_id: legacy.organisation_id, terms })
  eq(oldProduct.products.length, 1, 'existing historical product operation still works')
  await actor(1)
  eq((await scalar('select public.bx1_portal_read()')).organisations[0].roles, ['IssuerFundManager', 'OfferingManager'], 'legacy read retains only mapped grandfather owner capabilities')
  await admin()
  eq(await scalar("select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.bx1_profiles p),'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m))"), nativeRows, 'whole workflow creates no native roles/profiles')

  phase = 'submission-audit-failure-atomicity'
  const beforeAudit = await snapshot()
  await denied('failed mandatory audit aborts application and archived revision', async () => {
    await admin(); await db.query("create function public.fixture_fail_application_event() returns trigger language plpgsql as $$ begin raise exception 'synthetic required audit failed'; end $$; create trigger fixture_fail_application_event before insert on bx1_portal.events for each row execute function public.fixture_fail_application_event()")
    await entry(9, 'submit_application', { application_id: investor.id, expected_revision: investor.revision, details: v1(9) })
  }, 'P0001')
  eq(await snapshot(), beforeAudit, 'audit failure preserves all business/history/receipt state')
  await denied('MAIN remains closed even with assigned TEST reviewer', async () => {
    await admin(); await db.query("update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false,reviewer_scope=null")
    eq((await read(9)).applications[0].review_route, 'NOT_ADMITTED', 'MAIN does not claim manual review availability')
    await entry(9, 'submit_application', { application_id: investor.id, expected_revision: investor.revision, details: v1(9) })
  }, '55000', 'entry_review_route_unavailable')
  await admin(); await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and role='ComplianceOfficer'", [uid(4)])
  await db.query('commit'); begun = false; committed = true

  phase = 'reviewer-revocation-after-actual-row-wait'
  for (let n = 0; n < 2; n++) { const client = new pg.Client({ ...options, application_name: `bx1-handoff-race-${n}` }); await client.connect(); peers.push(client) }
  const pids = await Promise.all(peers.map(client => scalar('select pg_backend_pid()', [], client)))
  await db.query('begin'); begun = true
  await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and role='ComplianceOfficer'", [uid(2)])
  const waiting = concurrent(peers[0], client => entry(9, 'submit_application', { application_id: investor.id, expected_revision: investor.revision, details: v1(9) }, key(), client))
  await waitBlocked([pids[0]])
  await db.query('commit'); begun = false
  eq(await waiting, { code: '55000', message: 'entry_independent_reviewer_unavailable' }, 'revocation committed during candidate-row wait defeats submit')
  eq(await scalar('select status from bx1_portal.applications where id=$1', [investor.id]), 'DRAFT', 'revocation wait left application unsubmitted')

  phase = 'concurrent-idempotent-submission'
  await db.query("update public.bx1_memberships set status='ACTIVE' where user_id=$1 and role='ComplianceOfficer'", [uid(2)])
  await db.query('begin'); begun = true
  await db.query("select pg_advisory_xact_lock(hashtextextended('bx1_portal:'||$1,0))", [uid(9)])
  const requestKey = key(), payload = { application_id: investor.id, expected_revision: investor.revision, details: v1(9) }
  const pendingSaves = peers.map(client => concurrent(client, c => entry(9, 'submit_application', payload, requestKey, c)))
  await waitBlocked(pids)
  await db.query('commit'); begun = false
  const results = await Promise.all(pendingSaves)
  truth(results.every(result => result.result?.applications[0]?.status === 'SUBMITTED'), 'duplicate concurrent commands both reconcile the same submission')
  eq(await scalar('select count(*)::int from bx1_portal.application_detail_versions where application_id=$1', [investor.id]), 1, 'one immutable evidence revision for duplicate requests')
  eq(await scalar('select count(*)::int from bx1_portal.entry_requests where actor_id=$1 and request_key=$2', [uid(9), requestKey]), 1, 'one exact durable receipt')
  console.log(JSON.stringify({ ok: true, suite: 'application-admission-cloud-sql', checks, proof_boundary: 'Synthetic cloud PostgreSQL17 only; not hosted participant evidence, real MFA, reviewer appointment or operational admission.' }))
} catch (error) {
  console.error(JSON.stringify({ ok: false, suite: 'application-admission-cloud-sql', phase, checks, code: error?.code ?? null, fixtureLine: error?.fixtureLine ?? null, message: error instanceof Error ? error.message : String(error) }))
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
