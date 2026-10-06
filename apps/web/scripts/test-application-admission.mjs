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
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic application handoff cloud acceptance')", [scope])
  await sqlFile('../../../supabase/features/bx1_portal_funding.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  const wrappers = await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_state()'::regprocedure)")
  await sqlFile('../../../supabase/features/bx1_application_admission.sql')
  phase = 'history-and-acl-preservation'
  eq(await scalar("select jsonb_agg(to_jsonb(a)-array['admission_purpose','context_kind','context_organisation_id','origin','created_at'] order by id) from bx1_portal.applications a"), historical, 'historical IDs, evidence, decisions, timestamps and organisations unchanged')
  eq(await scalar("select jsonb_object_agg(oid::regprocedure::text,md5(pg_get_functiondef(oid))) from pg_proc where oid in ('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,'bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)'::regprocedure,'bx1_portal.read_state()'::regprocedure)"), wrappers, 'outer funding/authority writers and effective legacy scoped delegate unchanged')
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
  phase = 'shared-handoff-current-stage2-chain'
  await db.query('begin'); begun = true
  await admin()
  for (const file of ['20260923134152_stage2_product_eligibility.sql',
    '20260923143713_stage2_customer_mandates.sql', '20260923144216_stage2_document_receipts.sql',
    '20260923161500_stage2_application_document_history.sql', '20260923171126_stage2_entity_investment_accounts.sql',
    '20260923175822_stage2_superadmin_shell_mfa_boundary.sql', '20260924110608_stage2_provider_evidence.sql',
    '20260924110922_stage2_beneficial_ownership_control.sql', '20260924112832_stage2_document_quarantine_lifecycle.sql',
    '20260924125627_stage2_customer_monitoring.sql', '20260924125811_stage2_document_retention_authority.sql']) {
    await sqlFile(`../../../supabase/migrations/${file}`)
  }
  const handoffRecords = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'applications',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a),
      'accounts',(select jsonb_agg(to_jsonb(i) order by id) from bx1_portal.investment_accounts i),
      'mandates',(select jsonb_agg(to_jsonb(m) order by id) from bx1_portal.representative_mandates m),
      'investing_mandates',(select jsonb_agg(to_jsonb(m) order by id) from bx1_portal.investing_representative_mandates m),
      'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m),
      'configuration',(select to_jsonb(c) from bx1_portal.entry_configuration c),
      'events',(select count(*) from bx1_portal.events),'entry_requests',(select count(*) from bx1_portal.entry_requests),
      'scoped_requests',(select count(*) from bx1_portal.scoped_requests))`)
  }
  const beforeHandoffInstall = await handoffRecords()
  const commandDefinition = await scalar("select md5(pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure))")
  await sqlFile('../../../supabase/features/bx1_customer_handoff.sql')
  eq(await handoffRecords(), beforeHandoffInstall, 'handoff definition neither seeds nor changes saved business history')
  eq(await scalar("select md5(pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure))"), commandDefinition, 'handoff leaves canonical writer definition unchanged')
  const projectedInvestor = (await read(9)).applications.find(a => a.id === investor.id)
  eq([projectedInvestor.handoff.state, projectedInvestor.handoff.next_owner, projectedInvestor.handoff.allowed_actions], ['REVIEW_PENDING', 'COMPLIANCE', []], 'saved submission hands off to Compliance without ownership')
  eq(await handoffRecords(), beforeHandoffInstall, 'handoff reads leave applications, roles, accounts, mandates, admission and receipts unchanged')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    eq(await scalar("select has_function_privilege($1,'bx1_portal.customer_application_handoff(jsonb,uuid)','EXECUTE')", [role]), false, `${role} cannot invoke the private handoff helper`)
  }
  phase = 'shared-handoff-synthetic-participant-assurance'
  for (const n of [10, 11]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [uid(n), `handoff-${n}@example.invalid`])
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(n), uid(n)])
  }
  // The canonical person-principal FK targets native profiles, not Auth users.
  // Supply this synthetic identity dependency before inserting its mappings;
  // a profile alone does not create a membership or an operating role.
  for (const n of [9, 10, 11]) {
    await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)',
      [uid(n), n === 10 ? 'Synthetic independent handoff applier' : `Synthetic handoff applicant ${n}`])
  }
  eq(await scalar('select count(*)::int from public.bx1_profiles where id=any($1::uuid[])', [[uid(9), uid(10), uid(11)]]), 3, 'synthetic native profile dependencies precede principal mappings')
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[])', [[uid(9), uid(11)]]), 0, 'synthetic applicant profiles grant no operating assignments')
  for (const n of [9, 10, 11]) {
    const person = `e6100000-0000-4000-8000-${String(n).padStart(12, '0')}`
    await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED',$3,$4)", [person, `Synthetic handoff human ${n}`, `synthetic-handoff-human-${n}`, key()])
    await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED',$3,$4)", [uid(n), person, `synthetic-handoff-principal-${n}`, key()])
  }
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','ACTIVE')", [uid(10), scope])
  for (const n of [2, 10]) {
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(100 + n), uid(n)])
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(100 + n), uid(n)])
  }
  const assured = async (n, action, payload, context = reviewer) => {
    await actor(n, db, { aal: 'aal2' })
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [action, key(), JSON.stringify(payload), JSON.stringify(context)])
  }
  const ownApplication = async (n, applicationId) => (await read(n)).applications.find(a => a.id === applicationId)
  phase = 'shared-handoff-investor-information-and-reapplication'
  let currentInvestor = await ownApplication(9, investor.id)
  await assured(2, 'review_application', reviewBody(currentInvestor, 'CHANGES_REQUIRED'))
  currentInvestor = await ownApplication(9, investor.id)
  eq([currentInvestor.handoff.state, currentInvestor.handoff.next_owner], ['INFORMATION_REQUIRED', 'APPLICANT'], 'information request returns the same case to applicant')
  currentInvestor = (await entry(9, 'submit_application', { application_id: currentInvestor.id, expected_revision: currentInvestor.revision, details: v1(9) })).applications.find(a => a.id === investor.id)
  await assured(2, 'review_application', reviewBody(currentInvestor, 'REJECTED'))
  currentInvestor = await ownApplication(9, investor.id)
  eq([currentInvestor.handoff.state, currentInvestor.handoff.allowed_actions], ['REAPPLICATION_REQUIRED', ['PREPARE_APPLICATION', 'SUBMIT_APPLICATION']], 'rejected case permits explicit guarded reapplication, not approval')
  const rejectedRevision = currentInvestor.revision
  currentInvestor = (await entry(9, 'submit_application', { application_id: currentInvestor.id, expected_revision: currentInvestor.revision, details: v1(9) })).applications.find(a => a.id === investor.id)
  eq([currentInvestor.id, currentInvestor.revision, currentInvestor.handoff.state], [investor.id, rejectedRevision + 1, 'REVIEW_PENDING'], 'reapplication preserves identity and advances only the submission revision')
  await denied('handoff does not bypass stale reapplication revision', () => entry(9, 'submit_application', { application_id: investor.id, expected_revision: rejectedRevision, details: v1(9) }), '23514')
  await assured(2, 'review_application', reviewBody(currentInvestor))
  currentInvestor = await ownApplication(9, investor.id)
  eq([currentInvestor.handoff.state, currentInvestor.handoff.allowed_actions, currentInvestor.handoff.accounts], ['OPEN_ACCOUNT', ['OPEN_INVESTMENT_ACCOUNT'], []], 'independent admission offers account creation without a holding')
  await scoped(9, 'create_investment_account', { application_id: investor.id })
  currentInvestor = await ownApplication(9, investor.id)
  eq([currentInvestor.handoff.state, currentInvestor.handoff.destination, currentInvestor.handoff.allowed_actions], ['ACCOUNT_AVAILABLE', 'INVESTMENT_ACCOUNT', ['VIEW_INVESTMENT_ACCOUNT']], 'guarded account command connects the same admitted investor to its account')
  eq(currentInvestor.handoff.accounts.length, 1, 'exact one linked account is projected')
  await admin()
  await db.query('savepoint handoff_suspended_account')
  await db.query("update bx1_portal.investment_accounts set status='SUSPENDED' where application_id=$1", [investor.id])
  eq((await ownApplication(9, investor.id)).handoff.blocker, 'ACCOUNT_SUSPENDED', 'suspended account cannot disappear into a new-account action')
  eq((await ownApplication(9, investor.id)).handoff.allowed_actions, [], 'suspended account exposes no enabled business action')
  await admin(); await db.query('rollback to savepoint handoff_suspended_account; release savepoint handoff_suspended_account')
  phase = 'shared-handoff-current-monitoring-precedence'
  await assured(2, 'set_customer_monitoring', { application_id: investor.id, expected_revision: 0, state: 'ON_HOLD', evidence_reference: 'synthetic-independent-monitoring-evidence', reason: 'Synthetic held admission must prevent new account or operating actions.', checks: {} })
  currentInvestor = await ownApplication(9, investor.id)
  eq([currentInvestor.handoff.state, currentInvestor.handoff.blocker, currentInvestor.handoff.next_owner, currentInvestor.handoff.allowed_actions], ['UNAVAILABLE', 'MONITORING_ON_HOLD', 'COMPLIANCE', []], 'monitoring hold overrides otherwise approved active account')
  await assured(2, 'set_customer_monitoring', { application_id: investor.id, expected_revision: 1, state: 'RENEWAL_REQUIRED', evidence_reference: 'synthetic-independent-renewal-evidence', reason: 'Synthetic renewal requirement must prevent stale approved affordances.', checks: {} })
  eq((await ownApplication(9, investor.id)).handoff.blocker, 'MONITORING_RENEWAL_REQUIRED', 'renewal requirement is distinct from a hold')
  await assured(2, 'set_customer_monitoring', { application_id: investor.id, expected_revision: 2, state: 'CURRENT', evidence_reference: 'synthetic-independent-current-evidence', reason: 'Synthetic renewal evidence restores only current underlying admission.', checks: { identity: true, ownership: true, screening: true, suitability: true } })
  await admin(); await db.query('savepoint handoff_expired_admission')
  await db.query("update bx1_portal.applications set approved_until=clock_timestamp()-interval '1 second',reviewed_at=clock_timestamp()-interval '2 seconds' where id=$1", [investor.id])
  eq([(await ownApplication(9, investor.id)).handoff.blocker, (await ownApplication(9, investor.id)).handoff.allowed_actions], ['ADMISSION_EXPIRED', []], 'current monitoring cannot extend expired admission')
  await admin(); await db.query('rollback to savepoint handoff_expired_admission; release savepoint handoff_expired_admission')

  phase = 'shared-handoff-wealth-manager-connected-customer-submission'
  const wmDocuments = ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, i) => doc(11, kind, i))
  for (const document of wmDocuments) await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}',jsonb_build_object('sha256',repeat('a',64)))", [document.storage_path, uid(11)])
  const wmEvidence = { ...v2(11), details_version: 3, documents: wmDocuments,
    ownership_change_reason: 'Initial fictional owner declaration for cloud handoff acceptance.',
    ownership_control: [{ id: 'e6200000-0000-4000-8000-000000000011', party_type: 'PERSON', legal_name: 'Synthetic Handoff Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000, control_basis: 'Fictional sole ownership of the synthetic customer organisation.', effective_on: '2026-09-01', change_reason: 'Initial fictional owner relationship for this synthetic application.', evidence_document_id: wmDocuments[2].id }] }
  let currentManager = (await entry(11, 'start_application', { persona: 'WEALTH_MANAGER' })).applications[0]
  const wmId = currentManager.id
  eq(currentManager.handoff.state, 'PREPARE_APPLICATION', 'fresh manager starts in distinct customer-admission preparation')
  await admin(); await db.query('savepoint handoff_reviewer_unavailable')
  await db.query("update public.bx1_memberships set status='SUSPENDED' where role='ComplianceOfficer' and organisation_id=$1", [scope])
  const missingReviewer = await ownApplication(11, wmId)
  eq([missingReviewer.handoff.blocker, missingReviewer.handoff.allowed_actions], ['REVIEWER_UNAVAILABLE', ['PREPARE_APPLICATION']], 'missing reviewer preserves preparation but disables submission')
  await admin(); await db.query('rollback to savepoint handoff_reviewer_unavailable; release savepoint handoff_reviewer_unavailable')
  await admin(); await db.query('savepoint handoff_unsupported_provider')
  await db.query('alter table bx1_portal.applications drop constraint applications_provider_mode_check')
  await db.query("update bx1_portal.applications set provider_mode='UNADMITTED_PROVIDER' where id=$1", [wmId])
  const unsupportedProvider = await ownApplication(11, wmId)
  eq([unsupportedProvider.handoff.blocker, unsupportedProvider.handoff.allowed_actions], ['PROVIDER_UNSUPPORTED', []], 'unexpected provider mode cannot manufacture available actions')
  await admin(); await db.query('rollback to savepoint handoff_unsupported_provider; release savepoint handoff_unsupported_provider')
  const beforeConnectedAudit = await handoffRecords()
  await denied('connected submission still requires atomic audit', async () => {
    await admin()
    await db.query("create function public.synthetic_handoff_audit_failure() returns trigger language plpgsql as $$ begin if new.kind='submit_application' then raise exception 'synthetic_handoff_required_audit'; end if; return new; end $$; create trigger synthetic_handoff_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_handoff_audit_failure()")
    await entry(11, 'submit_application', { application_id: wmId, expected_revision: currentManager.revision, details: wmEvidence })
  }, 'P0001')
  eq(await handoffRecords(), beforeConnectedAudit, 'failed connected submission preserves draft, evidence, authority and receipts')
  currentManager = (await entry(11, 'submit_application', { application_id: wmId, expected_revision: currentManager.revision, details: wmEvidence })).applications[0]
  await assured(2, 'review_application', reviewBody(currentManager, 'CHANGES_REQUIRED'))
  currentManager = await ownApplication(11, wmId)
  eq(currentManager.handoff.state, 'INFORMATION_REQUIRED', 'manager information request returns the actual case to the applicant')
  currentManager = (await entry(11, 'submit_application', { application_id: wmId, expected_revision: currentManager.revision, details: wmEvidence })).applications[0]
  await assured(2, 'review_application', reviewBody(currentManager))
  currentManager = await ownApplication(11, wmId)
  eq([currentManager.handoff.state, currentManager.handoff.next_owner, currentManager.handoff.allowed_actions], ['REQUEST_MANDATE', 'APPLICANT', ['REQUEST_REPRESENTATIVE_MANDATE']], 'customer admission awaits applicant mandate request, not a fictitious granted role')
  const mandatePayload = expected_revision => ({ application_id: wmId, expected_revision, evidence_reference: 'synthetic-independent-handoff-appointment', requested_until: new Date(Date.now() + 86400000).toISOString() })
  let wmMandate = (await entry(11, 'request_representative_mandate', mandatePayload(0))).organisation_mandates[0]
  eq([(await ownApplication(11, wmId)).handoff.state, (await ownApplication(11, wmId)).handoff.next_owner], ['MANDATE_REVIEW_PENDING', 'COMPLIANCE'], 'requested mandate hands off to scoped Compliance')
  const mandateReview = decision => ({ mandate_id: wmMandate.id, expected_revision: wmMandate.revision, decision, notes: 'Independent synthetic appointment and exact scope reviewed for handoff.', checks: { appointment: true, evidence: true, scope: true } })
  wmMandate = (await assured(2, 'review_representative_mandate', mandateReview('APPROVED'))).organisation_mandates.find(m => m.id === wmMandate.id)
  eq([(await ownApplication(11, wmId)).handoff.state, (await ownApplication(11, wmId)).handoff.next_owner], ['MANDATE_APPLY_PENDING', 'SUPER_ADMIN'], 'approved mandate is pending independent application, not yet a workspace')
  wmMandate = (await assured(10, 'apply_representative_mandate', { mandate_id: wmMandate.id, expected_revision: wmMandate.revision }, { mode: 'ROLE', organisationId: scope, role: 'SuperAdmin' })).organisation_mandates.find(m => m.id === wmMandate.id)
  currentManager = await ownApplication(11, wmId)
  eq([currentManager.handoff.state, currentManager.handoff.destination, currentManager.handoff.native_context], ['WORKSPACE_AVAILABLE', 'OPERATING_WORKSPACE', { organisation_id: wmMandate.native_organisation_id, role: 'OfferingManager' }], 'only applied effective mandate provides the exact native operating context')
  const beforeRepeatedReads = await handoffRecords()
  await ownApplication(11, wmId); await ownApplication(9, investor.id)
  eq(await handoffRecords(), beforeRepeatedReads, 'completed handoff reads alter no business, authority or admission records')
  wmMandate = (await assured(2, 'revoke_representative_mandate', { mandate_id: wmMandate.id, expected_revision: wmMandate.revision, reason: 'Synthetic exact operating mandate withdrawn after handoff proof.' })).organisation_mandates.find(m => m.id === wmMandate.id)
  currentManager = await ownApplication(11, wmId)
  eq([currentManager.handoff.blocker, currentManager.handoff.allowed_actions, currentManager.handoff.native_context], ['MANDATE_NOT_EFFECTIVE', [], null], 'revocation removes the workspace affordance without deleting history')
  eq((await read(9)).applications.some(a => a.id === wmId), false, 'applicant projection never leaks another participant application')
  await actor(9); await admin()
  eq(await scalar('select bx1_portal.customer_application_handoff($1::jsonb,$2)', [JSON.stringify(applicant), wmId]), null, 'private helper independently rejects another applicant record even when executed by fixture owner')
  await denied('foreign actor cannot get a handoff through the private helper', async () => { await actor(9); await scalar('select bx1_portal.customer_application_handoff($1::jsonb,$2)', [JSON.stringify(applicant), wmId]) }, '42501')
  await denied('wrong token environment cannot read the TEST handoff', async () => { await actor(9, db, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }); await scalar('select public.bx1_entry_read()') }, '42501')
  await admin(); await db.query('savepoint handoff_missing_configuration')
  await db.query('delete from bx1_portal.entry_configuration')
  await denied('missing configuration fails the entire handoff read', () => read(9), '55000')
  await admin(); await db.query('rollback to savepoint handoff_missing_configuration; release savepoint handoff_missing_configuration')
  await admin(); await db.query('rollback'); begun = false
  console.log(JSON.stringify({ ok: true, suite: 'application-admission-cloud-sql', checks, handoff: 'investor-and-wealth-manager-connected-pure-read', proof_boundary: 'Synthetic cloud PostgreSQL17 only; not hosted participant evidence, real MFA, reviewer appointment or operational admission.' }))
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
