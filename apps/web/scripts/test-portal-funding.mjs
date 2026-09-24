import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { proveCustomerMonitoringFunding } from './customer-monitoring-proof.mjs'

// Never run locally or against Supabase. Provider facts below are deliberately
// synthetic trusted-writer inputs, not a claim that an on-chain payment occurred.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Funding SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_FUNDING_SQL_TEST_URL !== expected) throw new Error('Funding SQL proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-funding-cloud-ci' }
let db = new pg.Client(options), maintenance
const peers = []
let phase = 'initialise', checks = 0, sequence = 0, txSequence = 0, begun = false, committed = false, connected = false, maintenanceConnected = false
const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => `ef300000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', other = 'e3000000-0000-4000-8000-000000000002'
const applicant = { mode: 'APPLICANT' }, context = (role, organisationId = scope) => ({ mode: 'ROLE', organisationId, role })
const investor = context('Investor'), treasury = context('TreasuryOperator'), controller = context('FinancialController')
const token = `0x${'31'.repeat(20)}`, receiver = `0x${'32'.repeat(20)}`, payer = `0x${'33'.repeat(20)}`, runtime = hash(444)
const eq = (actual, wanted, label) => { assert.deepEqual(actual, wanted, label); checks++ }
const truth = (value, label) => { assert.ok(value, label); checks++ }
async function scalar(sql, params = [], client = db) { return Object.values((await client.query(sql, params)).rows[0])[0] }
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
async function legacy(n, kind, body) { await actor(n); return scalar('select public.bx1_portal_command($1,$2,$3::jsonb)', [kind, key(), JSON.stringify(body)]) }
async function read(n, c = investor, client = db) { await actor(n, client); return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(c)], client) }
async function command(n, c, kind, body, requestKey = key(), client = db) {
  await actor(n, client)
  return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [kind, requestKey, JSON.stringify(body), JSON.stringify(c)], client)
}
async function denied(label, action, code = '23514') {
  await db.query('savepoint denied_case')
  let actual
  try { await action() } catch (error) { actual = error.code }
  await db.query('rollback to savepoint denied_case; release savepoint denied_case')
  eq(actual, code, label)
}
const doc = (n, kind, i) => ({ id: `ed000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, kind, title: `Synthetic ${kind}`, storage_path: `${uid(n)}/synthetic-${kind}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' })
async function approveApplicant(n, wm = false) {
  const details = { full_name: `Synthetic Applicant ${n}`, country: 'ZA', investor_type: wm ? 'ENTITY' : 'INDIVIDUAL', company_name: wm ? 'Synthetic Company' : '', registration_reference: wm ? 'SYNTHETIC-1' : '', source_of_funds: 'Fictional test savings only, no actual money or customer information.', beneficial_owners: wm ? 'Synthetic owner with one hundred percent fictional ownership.' : '', experience: 'Synthetic investment experience for workflow testing only.', documents: (wm ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => doc(n, kind, i)), test_data_acknowledged: true }
  const state = await legacy(n, 'submit_application', { persona: wm ? 'WEALTH_MANAGER' : 'INVESTOR', expected_revision: 0, details })
  const app = state.applications.find(a => a.user_id === uid(n))
  await legacy(2, 'review_application', { application_id: app.id, expected_revision: app.revision, decision: 'APPROVED', notes: 'Independent manual TEST_ONLY review of fictional evidence.', checks: { identity: true, ownership: true, screening: true, suitability: true } })
}
function terms(asset) { return { asset_type: asset, name: `P3 synthetic ${asset}`, issuer_name: 'Synthetic test issuer', summary: 'Fictional offering solely for testing a customer investment journey.', strategy: 'Fictional long-term diversified test strategy. This is not an investment offer.', share_class: 'Test Class A', currency: 'ZAR_TEST', unit_price_minor: '9007199254740993', cap_units: '100', minimum_units: '1', pricing_basis: 'Fixed synthetic unit price for workflow checks.', fees: 'No real fees or payments in this test.', redemption_terms: 'Future governed redemption service; not yet available for this test product.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL'], property_address: asset === 'REAL_ESTATE' ? '100 Fictional Test Street' : '', property_valuation_minor: asset === 'REAL_ESTATE' ? '1234567890' : '0', rental_income_policy: asset === 'REAL_ESTATE' ? 'Fictional rental income policy requiring future reconciliation.' : '', documents: { memorandum: 'Synthetic memorandum. No property, fund interest or investment is offered. '.repeat(2).trim(), risks: 'Synthetic risk disclosure. This test does not represent real investment or ownership. '.repeat(2).trim(), subscription_terms: 'Synthetic subscription terms. Reservations do not confirm funding, assets or token delivery. '.repeat(2).trim() } } }
async function publish(orgId, asset) {
  let state = await legacy(1, 'create_product', { organisation_id: orgId, terms: terms(asset) })
  let p = state.products.find(p => p.terms.asset_type === asset)
  state = await legacy(1, 'submit_product', { product_id: p.id, expected_revision: p.revision }); p = state.products.find(x => x.id === p.id)
  state = await legacy(2, 'review_product', { product_id: p.id, expected_revision: p.revision, decision: 'APPROVED', notes: 'Independent fictional issuer, terms and disclosure test review.', checks: { issuer: true, terms: true, disclosures: true, eligibility: true } }); p = state.products.find(x => x.id === p.id)
  return (await legacy(1, 'publish_product', { product_id: p.id, expected_revision: p.revision })).products.find(x => x.id === p.id)
}
const routeBody = (p, decimals = 6) => ({ product_id: p.id, expected_revision: p.revision, token_address: token, token_runtime_hash: runtime, token_decimals: decimals, receiving_address: receiver, authority_reference: 'Synthetic authority for the disposable SQL proof only.', code_review_reference: 'Synthetic immutable standard token code review fixture only.', valid_until: new Date(Date.now() + 3600000).toISOString(), standard_immutable_token_acknowledged: true, synthetic_conversion_acknowledged: true })
async function mint(n, c, kind, id, client = db) { await actor(n, client); return scalar('select public.bx1_portal_funding_verification_context($1,$2,$3::jsonb)', [kind, id, JSON.stringify(c)], client) }
function facts(e, amount, overrides = {}) {
  // Deterministic synthetic facts: avoid millisecond JS time preceding the
  // database's microsecond obligation time within the same wall-clock tick.
  return { version: 1, kind: e.kind, status: 'VERIFIED', chain_id: 80002, token_address: e.route.token_address, token_runtime_hash: e.route.token_runtime_hash, token_decimals: e.route.token_decimals, receiving_address: e.route.receiving_address, block_number: '123', block_hash: hash(123), block_timestamp: new Date(Date.now() + 1000).toISOString(), providers: [{ url: 'https://polygon-amoy.drpc.org', finalized_block_number: '130', finalized_block_hash: hash(130) }, { url: 'https://polygon-amoy-bor-rpc.publicnode.com', finalized_block_number: '131', finalized_block_hash: hash(131) }], ...(e.kind === 'REFERENCE' ? { transaction_hash: e.reference.transaction_hash, transaction_index: 0, log_index: e.reference.log_index, payer_address: e.reference.payer_address, claim_hash: hash(987), amount_base_units: amount } : {}), ...overrides }
}
async function store(e, f, client = db) {
  await admin(client)
  await client.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  await client.query('set local role service_role')
  return scalar('select public.bx1_portal_record_funding_observation($1,$2::jsonb)', [e.id, JSON.stringify(f)], client)
}
async function verify(n, c, kind, id, amount, overrides) { const e = await mint(n, c, kind, id); return store(e, facts(e, amount, overrides)) }
async function approveRoute(p, decimals = 6, proposer = 5) {
  const before = (await read(proposer, treasury)).funding.routes.map(r => r.id)
  const s = await command(proposer, treasury, 'propose_funding_route', routeBody(p, decimals))
  let r = s.funding.routes.find(r => !before.includes(r.id))
  await verify(5, treasury, 'ROUTE', r.id)
  r = (await command(2, controller, 'approve_funding_route', { route_id: r.id, expected_revision: r.revision })).funding.routes.find(x => x.id === r.id)
  eq(r.status, 'APPROVED', `${p.terms.asset_type} independently approved route`)
  return r
}
async function order(n, p, accountId, route) {
  const before = (await read(n)).subscriptions.map(s => s.id)
  const s = await command(n, investor, 'subscribe', { product_id: p.id, expected_revision: p.revision, terms_hash: p.terms_hash, units: '1', accepted_documents: true, accepted_risks: true, investment_account_id: accountId })
  const subscription = s.subscriptions.find(x => !before.includes(x.id))
  const opened = await command(n, investor, 'open_funding_obligation', { subscription_id: subscription.id, route_id: route.id })
  const obligation = opened.funding.obligations.find(o => o.subscription_id === subscription.id)
  eq(obligation.token_amount_base_units, (BigInt(subscription.amount_minor) * 10n ** BigInt(route.token_decimals - 2)).toString(), 'exact token conversion exceeds safe JS number without rounding')
  return { subscription, obligation, route, n }
}
async function reference(o, transactionHash = hash(++txSequence + 1000)) {
  const current = (await read(o.n)).funding.obligations.find(x => x.id === o.obligation.id)
  const state = await command(o.n, investor, 'submit_funding_reference', { obligation_id: current.id, expected_revision: current.revision, expected_route_revision: o.route.revision, payer_address: payer, transaction_hash: transactionHash, log_index: 0, signature: `0x${'11'.repeat(65)}` })
  return state.funding.references.find(r => r.obligation_id === current.id && r.transaction_hash === transactionHash)
}
async function referencePayload(o, ref, n = 5, c = treasury) {
  const state = await read(n, c), f = state.funding.references.find(r => r.id === ref.id), current = state.funding.obligations.find(x => x.id === o.obligation.id)
  return { reference_id: f.id, expected_revision: f.revision, expected_obligation_revision: current.revision }
}
async function reconcile(o, ref) {
  await command(5, treasury, 'propose_funding_acceptance', await referencePayload(o, ref))
  const state = await read(2, controller), current = state.funding.obligations.find(x => x.id === o.obligation.id)
  return command(2, controller, 'reconcile_funding', { ...await referencePayload(o, ref, 2, controller), evidence_set_hash: current.evidence_set_hash })
}
async function concurrent(client, action) { await client.query('begin'); try { const value = await action(client); await client.query('commit'); return { value } } catch (error) { await client.query('rollback'); return { code: error.code } } }
async function blocked(pids) {
  const until = Date.now() + 5000
  while (Date.now() < until) { if (await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids]) === pids.length) { checks++; return } await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Statements did not overlap on the actual product/actor lock')
}
async function authorityBoundary() {
  return scalar(`select jsonb_build_object(
    'membership',(select jsonb_agg(jsonb_build_array(grantor,admin_option,inherit_option,set_option) order by grantor)
      from pg_auth_members where roleid='bx1_authority_owner'::regrole and member='postgres'::regrole),
    'schema_acl',(select to_jsonb(array(select a::text from unnest(nspacl) a order by a::text)) from pg_namespace where nspname='bx1_private'),
    'table_acls',(select jsonb_object_agg(relname,to_jsonb(array(select a::text from unnest(relacl) a order by a::text)))
      from pg_class where oid in ('bx1_private.persons'::regclass,'bx1_private.person_principals'::regclass)))`)
}
async function checkHostedRole(client = db) {
  eq(await scalar("select current_user='postgres' and session_user='postgres' and not rolsuper and rolbypassrls from pg_roles where rolname=current_user", [], client), true, 'migration/runtime connection is hosted-like postgres, not superuser')
}
async function cleanupFixture() {
  // Maintenance is deliberately unavailable to migration/RPC helpers. It only
  // prepares the disposable role boundary and restores/removes the fixture.
  if (maintenanceConnected) {
    await maintenance.query('rollback')
    await maintenance.query('alter role postgres superuser')
    await maintenance.query('drop schema if exists bx1_portal,bx1_private,storage,auth,public cascade; create schema public authorization postgres')
    await maintenance.query(`do $$ begin
      if exists(select 1 from pg_auth_members where roleid='bx1_authority_owner'::regrole
        and member='postgres'::regrole and grantor='bx1_fixture_bootstrap'::regrole) then
        revoke bx1_authority_owner from postgres granted by bx1_fixture_bootstrap;
      end if;
    end $$`)
    await maintenance.query('reset session authorization; drop role if exists bx1_fixture_bootstrap')
  } else if (connected) {
    await admin()
    await db.query('drop schema if exists bx1_portal,bx1_private,storage,auth,public cascade; create schema public; drop role if exists bx1_fixture_bootstrap')
  } else throw new Error('Disposable fixture cleanup has no connected maintenance session')
  committed = false
}

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'disposable service')
  eq(await scalar("select oid<>10 and rolsuper from pg_roles where rolname=current_user"), true, 'CI must provision non-bootstrap postgres before the hosted-role demotion proof')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'empty fixture database')
  eq(await scalar("select count(*)::int from pg_roles where rolname in ('anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier','bx1_authority_owner','bx1_fixture_bootstrap')"), 0, 'fresh independent cloud service has no prior fixture roles')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.users add column raw_user_meta_data jsonb default '{}'::jsonb; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await db.query('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated')
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql', '20260918234447_bx1_controlled_administration.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  await sqlFile('../../../supabase/tests/bx1_portal.sql')
  // The later monitoring decision requires trusted, distinct humans. The
  // standard funding fixture's investor has no native role, but receives a
  // synthetic identity mapping before postgres loses private-schema writes.
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic admitted investor 3')", [uid(3)])
  await db.query(`insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
    values('e6000000-0000-4000-8000-000000000004',
      'Synthetic test human investor 3','TRUSTED','synthetic:funding-investor-3',
      'e7000000-0000-4000-8000-000000000001')`)
  await db.query(`insert into bx1_private.person_principals
    (auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
    values($1,'e6000000-0000-4000-8000-000000000004','TRUSTED',
      'synthetic:funding-investor-principal-3',
      'e7000000-0000-4000-8000-000000000001')`, [uid(3)])
  phase = 'canonical-preexisting-business-records'
  await approveApplicant(1, true); await approveApplicant(3); await approveApplicant(6)
  await actor(1); const orgId = (await scalar('select public.bx1_portal_read()')).organisations[0].id
  const fund = await publish(orgId, 'FUND'), estate = await publish(orgId, 'REAL_ESTATE')
  await admin(); await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/tests/bx1_portal_authority_accounts.sql')
  phase = 'hosted-like-migration-role-boundary'
  // Preserve existing postgres-owned functions: demote the real fixture role
  // instead of assigning selected objects to an artificial privileged owner.
  await db.query('create role bx1_fixture_bootstrap nologin superuser')
  await db.query('commit'); begun = false; committed = true
  maintenance = new pg.Client({ ...options, application_name: 'bx1-funding-fixture-maintenance' })
  await maintenance.connect(); maintenanceConnected = true
  await maintenance.query('set session authorization bx1_fixture_bootstrap')
  await maintenance.query(`begin;
    grant anon,authenticated,service_role to postgres with inherit false, set true;
    grant bx1_authority_owner to postgres with admin true, inherit false, set false;
    grant bx1_authority_owner to bx1_fixture_bootstrap with admin true, inherit false, set false;
    grant bx1_authority_owner to postgres with admin false, inherit false, set false granted by bx1_fixture_bootstrap;
    revoke all on bx1_private.persons,bx1_private.person_principals from postgres;
    grant select on bx1_private.persons,bx1_private.person_principals to postgres;
    alter role postgres nosuperuser bypassrls;
    commit`)
  // Authenticate a fresh restricted session so no initially-superuser session
  // authorization privilege remains on any connection used for the proof.
  await db.end(); connected = false
  db = new pg.Client(options)
  await db.connect(); connected = true
  await checkHostedRole()
  await db.query('begin'); begun = true
  eq(await scalar("select count(*)=2 and bool_or(admin_option) and bool_and(not inherit_option and not set_option) from pg_auth_members where roleid='bx1_authority_owner'::regrole and member='postgres'::regrole"), true, 'two grantor-specific authority edges preserve ADMIN access without inheritance or SET')
  for (const table of ['persons', 'person_principals']) {
    eq(await scalar('select has_table_privilege(current_user,$1,\'SELECT\')', [`bx1_private.${table}`]), true, `restricted postgres can read ${table}`)
    eq(await scalar('select has_table_privilege(current_user,$1,\'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER\')', [`bx1_private.${table}`]), false, `restricted postgres has no write or REFERENCES privilege on ${table}`)
  }
  await denied('restricted postgres cannot SET ROLE to authority owner', () => db.query('set local role bx1_authority_owner'), '42501')
  await denied('SELECT-only persons cannot be locked directly', () => db.query('select id from bx1_private.persons for update'), '42501')
  await denied('SELECT-only principals cannot be locked directly', () => db.query('select auth_user_id from bx1_private.person_principals for update'), '42501')
  await denied('SELECT-only persons cannot be a new foreign-key target', () => db.query('create table bx1_portal.synthetic_forbidden_person_reference (person_id uuid references bx1_private.persons(id))'), '42501')
  const originalAuthorityBoundary = await authorityBoundary()
  await sqlFile('../../../supabase/features/bx1_portal_funding.sql')
  phase = 'hosted-like-migration-preserves-private-boundary'
  await checkHostedRole()
  eq(await authorityBoundary(), originalAuthorityBoundary, 'funding migration restores exact authority membership and private schema/table ACLs')
  eq(await scalar("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('bx1_portal','public') and p.prosecdef and p.proowner='postgres'::regrole and p.proname like '%funding%'") > 0, true, 'funding definers retain hosted postgres ownership')
  eq(await scalar("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in ('bx1_portal','public','bx1_private') and p.prosecdef and p.proname like '%funding%' and r.rolsuper"), 0, 'no funding definer runs as superuser')
  eq(await scalar("select proowner='bx1_authority_owner'::regrole and prosecdef from pg_proc where oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure"), true, 'narrow person-lock helper uses the existing authority owner')
  eq(await scalar("select has_function_privilege('postgres','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE')"), true, 'restricted migration owner can invoke the narrow lock helper')
  for (const role of ['anon', 'authenticated', 'service_role', 'bx1_wallet_owner', 'bx1_wallet_verifier']) eq(await scalar('select has_function_privilege($1,\'bx1_private.lock_funding_person(uuid,uuid)\',\'EXECUTE\')', [role]), false, `${role} cannot invoke person-lock helper`)
  await denied('authenticated cannot call the authority lock helper directly', async () => { await actor(3); await scalar('select bx1_private.lock_funding_person($1::uuid,null::uuid)', [uid(3)]) }, '42501')
  await denied('service role cannot call the authority lock helper directly', async () => { await admin(); await db.query('set local role service_role'); await scalar('select bx1_private.lock_funding_person($1::uuid,null::uuid)', [uid(3)]) }, '42501')
  await admin()
  phase = 'migration-has-no-financial-seeds'
  for (const name of ['routes', 'obligations', 'references', 'verification_expectations', 'observations', 'receipt_claims', 'acceptances', 'journals', 'journal_lines', 'reversals']) {
    eq(await scalar(`select count(*)::int from bx1_portal.funding_${name}`), 0, `${name} has no seeded money`)
    for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')', [role, `bx1_portal.funding_${name}`]), false, `${role} no raw ${name}`)
  }
  for (const role of ['anon', 'authenticated']) eq(await scalar('select has_function_privilege($1,\'public.bx1_portal_record_funding_observation(uuid,jsonb)\',\'EXECUTE\')', [role]), false, `${role} cannot assert verified observation`)
  await sqlFile('../../../supabase/tests/bx1_portal_funding.sql')
  const account3 = (await command(3, investor, 'create_investment_account', { application_id: (await read(3)).applications[0].id })).accounts[0]
  const account6 = (await command(6, investor, 'create_investment_account', { application_id: (await read(6)).applications[0].id })).accounts[0]
  phase = 'routes-maker-checker-and-context'
  await denied('wrong organisation cannot propose route', () => command(2, context('FinancialController', other), 'propose_funding_route', routeBody(fund)), '42501')
  await denied('applicant cannot gain finance from other role', () => command(5, applicant, 'propose_funding_route', routeBody(fund)), '42501')
  const sameHuman = (await command(1, treasury, 'propose_funding_route', routeBody(fund))).funding.routes[0]
  await denied('route approval requires server verification', () => command(2, controller, 'approve_funding_route', { route_id: sameHuman.id, expected_revision: sameHuman.revision }), '42501')
  await verify(5, treasury, 'ROUTE', sameHuman.id)
  await denied('distinct login cannot approve same trusted person proposal', () => command(4, controller, 'approve_funding_route', { route_id: sameHuman.id, expected_revision: sameHuman.revision }), '42501')
  const routeFund = await approveRoute(fund, 6), routeEstate = await approveRoute(estate, 18)
  eq((await read(2, context('FinancialController', other))).funding.routes.length, 0, 'other organisation cannot read routes')
  await denied('MAINNET issuer JWT cannot enter TEST funding', async () => { await actor(5, db, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }); await scalar('select public.bx1_portal_funding_verification_context($1,$2,$3::jsonb)', ['ROUTE', routeFund.id, JSON.stringify(treasury)]) }, '42501')
  const eRoute = await mint(5, treasury, 'ROUTE', routeFund.id)
  eq(eRoute.operating_context, treasury, 'expectation binds exact context')
  await denied('client cannot write an observation', async () => { await actor(5); await scalar('select public.bx1_portal_record_funding_observation($1,$2::jsonb)', [eRoute.id, JSON.stringify(facts(eRoute))]) }, '42501')
  await denied('provider substitution rejected', () => store(eRoute, facts(eRoute, undefined, { providers: [{ url: 'https://attacker.invalid', finalized_block_number: '130', finalized_block_hash: hash(130) }] })), '22023')
  const routeAck = await store(eRoute, facts(eRoute)), replayFacts = await (async () => { await admin(); return scalar('select facts from bx1_portal.funding_observations where id=$1', [routeAck.observation_id]) })()
  eq(await store(eRoute, replayFacts), routeAck, 'same expectation exact observation retry reuses receipt')
  await denied('same expectation cannot replace evidence', () => store(eRoute, { ...replayFacts, block_hash: hash(999) }), '23505')
  phase = 'both-assets-exact-reconciliation'
  const completed = []
  for (const [product, route] of [[fund, routeFund], [estate, routeEstate]]) {
    const o = await order(3, product, account3.id, route), ref = await reference(o)
    await denied('unverified reference does not imply payment', async () => command(5, treasury, 'propose_funding_acceptance', await referencePayload(o, ref)), '42501')
    await denied('reference blocks cancellation before verification', () => command(3, investor, 'cancel_subscription', { subscription_id: o.subscription.id }))
    await verify(3, investor, 'REFERENCE', ref.id, o.obligation.token_amount_base_units)
    const s = await reconcile(o, ref), reconciled = s.funding.obligations.find(x => x.id === o.obligation.id)
    eq(reconciled.state, 'RECONCILED', `${product.terms.asset_type} full amount independently reconciled`)
    eq(reconciled.posted_amount_base_units, o.obligation.token_amount_base_units, 'posted amount exact')
    eq(s.subscriptions.find(x => x.id === o.subscription.id).status, 'AWAITING_FUNDING', 'funding does not invent issuance/reservation status')
    eq((await read(1, context('IssuerFundManager'))).funding.obligations.find(x => x.id === o.obligation.id).state, 'RECONCILED', 'issuer sees same canonical obligation')
    eq((await read(6)).funding.obligations.some(x => x.id === o.obligation.id), false, 'other investor cannot read funding')
    await admin(); eq(await scalar("select sum(case when l.side='DEBIT' then l.amount_base_units else -l.amount_base_units end)::text from bx1_portal.funding_journal_lines l join bx1_portal.funding_journals j on j.id=l.journal_id where j.obligation_id=$1", [o.obligation.id]), '0', 'both journal legs balance exactly')
    completed.push({ o, ref })
  }
  phase = 'receipt-deduplication-and-exceptions'
  const duplicate = await order(6, fund, account6.id, routeFund), duplicateRef = await reference(duplicate, completed[0].ref.transaction_hash)
  await denied('verified receipt cannot pay a second account', () => verify(6, investor, 'REFERENCE', duplicateRef.id, duplicate.obligation.token_amount_base_units), '23505')
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.funding_receipt_claims where transaction_hash=$1', [duplicateRef.transaction_hash]), 1, 'economic source claimed globally once')
  await denied('unknown evidence cannot be closed as unpaid', async () => command(5, treasury, 'propose_funding_exception', { ...await referencePayload(duplicate, duplicateRef), decision: 'REJECTED_UNPAID', reason: 'Synthetic unknown payment is not evidence of no payment.' }))
  const failed = await order(3, fund, account3.id, routeFund), failedRef = await reference(failed)
  const reverted = await mint(3, investor, 'REFERENCE', failedRef.id), invalidFacts = facts(reverted, undefined, { status: 'INVALID', reason_code: 'RECEIPT_REVERTED' }); delete invalidFacts.amount_base_units
  await store(reverted, invalidFacts)
  await command(5, treasury, 'propose_funding_exception', { ...await referencePayload(failed, failedRef), decision: 'REJECTED_UNPAID', reason: 'Both finalized providers prove this transaction reverted.' })
  await command(2, controller, 'resolve_funding_exception', await referencePayload(failed, failedRef, 2, controller))
  const cancelled = await command(3, investor, 'cancel_subscription', { subscription_id: failed.subscription.id })
  eq(cancelled.subscriptions.find(x => x.id === failed.subscription.id).status, 'CANCELLED', 'conclusively reverted independently resolved reference permits cancellation')
  const late = await order(3, estate, account3.id, routeEstate), lateRef = await reference(late)
  await verify(3, investor, 'REFERENCE', lateRef.id, late.obligation.token_amount_base_units, { block_timestamp: new Date(Date.parse(late.obligation.created_at) - 1000).toISOString() })
  eq((await read(3)).funding.obligations.find(x => x.id === late.obligation.id).state, 'UNAPPLIED', 'pre-obligation genuine facts retained but not accepted')
  await denied('pre-obligation retained value cannot free capacity', () => command(3, investor, 'cancel_subscription', { subscription_id: late.subscription.id }))
  phase = 'partial-overpaid-and-late-policy-facts'
  const partial = await order(3, fund, account3.id, routeFund), firstPart = await reference(partial)
  const partAmount = BigInt(partial.obligation.token_amount_base_units) / 3n
  await verify(3, investor, 'REFERENCE', firstPart.id, partAmount.toString())
  eq((await read(3)).funding.obligations.find(o => o.id === partial.obligation.id).state, 'PARTIAL', 'verified underpayment is explicitly partial')
  eq((await reconcile(partial, firstPart)).funding.obligations.find(o => o.id === partial.obligation.id).state, 'PARTIAL', 'posted partial does not unlock reconciled')
  const remainder = await reference(partial)
  await verify(3, investor, 'REFERENCE', remainder.id, (BigInt(partial.obligation.token_amount_base_units) - partAmount).toString())
  eq((await reconcile(partial, remainder)).funding.obligations.find(o => o.id === partial.obligation.id).state, 'RECONCILED', 'independently posted exact remainder reconciles')
  const overpaid = await order(6, estate, account6.id, routeEstate), overRef = await reference(overpaid)
  await verify(6, investor, 'REFERENCE', overRef.id, (BigInt(overpaid.obligation.token_amount_base_units) + 1n).toString())
  eq((await read(6)).funding.obligations.find(o => o.id === overpaid.obligation.id).state, 'OVERPAID', 'one extra base unit is visible as overpayment')
  const revokedRoute = await approveRoute(fund), revokedOrder = await order(6, fund, account6.id, revokedRoute), revokedRef = await reference(revokedOrder)
  await command(5, treasury, 'revoke_funding_route', { route_id: revokedRoute.id, expected_revision: revokedRoute.revision, reason: 'Synthetic route revoked after an investor submitted evidence.' })
  const pinned = await mint(6, investor, 'REFERENCE', revokedRef.id)
  eq(pinned.route.revision, revokedRoute.revision, 'existing claim keeps signed route revision after revocation')
  await store(pinned, facts(pinned, revokedOrder.obligation.token_amount_base_units))
  eq((await read(6)).funding.obligations.find(o => o.id === revokedOrder.obligation.id).state, 'UNAPPLIED', 'revoked-route facts retained without acceptance')
  await denied('stale route signature revision is rejected before reference insert', () => reference(revokedOrder))
  const afterCancelledRef = await reference(failed)
  await verify(3, investor, 'REFERENCE', afterCancelledRef.id, failed.obligation.token_amount_base_units)
  const afterCancelled = await read(3)
  eq(afterCancelled.funding.obligations.find(o => o.id === failed.obligation.id).state, 'UNAPPLIED', 'late payment on cancelled reservation is not concealed')
  eq(afterCancelled.subscriptions.find(s => s.id === failed.subscription.id).status, 'CANCELLED', 'late observation cannot reopen a cancelled reservation')
  phase = 'reversal-is-compensation-not-refund'
  const paid = completed[0], paidState = await read(5, treasury), journal = paidState.funding.journals.find(j => j.obligation_id === paid.o.obligation.id && j.kind === 'FUNDING')
  const proposed = await command(5, treasury, 'propose_funding_reversal', { journal_id: journal.id, expected_obligation_revision: paidState.funding.obligations.find(x => x.id === paid.o.obligation.id).revision, reason: 'Synthetic accounting correction, not an on-chain refund.' })
  const reversal = proposed.funding.reversals.find(v => v.journal_id === journal.id)
  const reversalBody = { reversal_id: reversal.id, expected_obligation_revision: proposed.funding.obligations.find(x => x.id === paid.o.obligation.id).revision }
  await denied('treasury cannot approve its own reversal via second role', () => command(5, controller, 'approve_funding_reversal', reversalBody), '42501')
  const reversed = await command(2, controller, 'approve_funding_reversal', reversalBody)
  eq(reversed.funding.obligations.find(x => x.id === paid.o.obligation.id).state, 'REVERSED', 'explicit reversed state')
  eq(reversed.funding.obligations.find(x => x.id === paid.o.obligation.id).posted_amount_base_units, '0', 'compensating journal nets to zero')
  await denied('reversal does not make payment cancellable', () => command(3, investor, 'cancel_subscription', { subscription_id: paid.o.subscription.id }))
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.funding_receipt_claims where reference_id=$1', [paid.ref.id]), 1, 'receipt remains permanently consumed after reversal')
  await denied('journal history immutable', async () => { await admin(); await db.query('update bx1_portal.funding_journals set amount_base_units=1 where id=$1', [journal.id]) })
  phase = 'audit-rollback'
  const auditOrder = await order(3, fund, account3.id, routeFund), auditRef = await reference(auditOrder)
  await verify(3, investor, 'REFERENCE', auditRef.id, auditOrder.obligation.token_amount_base_units)
  await command(5, treasury, 'propose_funding_acceptance', await referencePayload(auditOrder, auditRef))
  const auditState = await read(2, controller), auditOb = auditState.funding.obligations.find(x => x.id === auditOrder.obligation.id)
  const auditBody = { ...await referencePayload(auditOrder, auditRef, 2, controller), evidence_set_hash: auditOb.evidence_set_hash }
  await denied('checker cannot substitute a stale evidence set', () => command(2, controller, 'reconcile_funding', { ...auditBody, evidence_set_hash: 'b'.repeat(64) }))
  await denied('deferred balanced journal invariant rejects missing legs', async () => {
    await admin()
    await db.query("insert into bx1_portal.funding_journals(obligation_id,reference_id,kind,amount_base_units,token_address,token_decimals,evidence_set_hash,posted_by,posted_person) values($1,$2,'FUNDING',1,$3,6,$4,$5,'e6000000-0000-4000-8000-000000000002')", [auditOb.id, auditRef.id, token, auditOb.evidence_set_hash, uid(2)])
    await db.query('set constraints all immediate')
  })
  await admin(); const baseline = await scalar("select jsonb_build_object('journals',(select count(*) from bx1_portal.funding_journals),'lines',(select count(*) from bx1_portal.funding_journal_lines),'requests',(select count(*) from bx1_portal.scoped_requests),'revision',(select revision from bx1_portal.funding_obligations where id=$1))", [auditOb.id])
  await denied('audit failure rolls back journal and transition', async () => { await admin(); await db.query("create function public.synthetic_funding_audit_failure() returns trigger language plpgsql as $$ begin if NEW.kind='reconcile_funding' then raise exception 'synthetic_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_funding_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_funding_audit_failure()"); await command(2, controller, 'reconcile_funding', auditBody) })
  await admin(); eq(await scalar("select jsonb_build_object('journals',(select count(*) from bx1_portal.funding_journals),'lines',(select count(*) from bx1_portal.funding_journal_lines),'requests',(select count(*) from bx1_portal.scoped_requests),'revision',(select revision from bx1_portal.funding_obligations where id=$1))", [auditOb.id]), baseline, 'failed audit leaves all financial state unchanged')
  const raceOrder = await order(3, fund, account3.id, routeFund)
  const retryOrder = await order(6, estate, account6.id, routeEstate), retryRef = await reference(retryOrder)
  const retryExpectation = await mint(6, investor, 'REFERENCE', retryRef.id), retryEvidence = facts(retryExpectation, retryOrder.obligation.token_amount_base_units)
  const expiryExpectation = await mint(5, treasury, 'ROUTE', routeFund.id)
  await admin(); await db.query('set constraints all immediate'); await db.query('commit'); begun = false; committed = true
  for (let n = 0; n < 2; n++) { const client = new pg.Client({ ...options, application_name: `bx1-funding-race-${n}` }); await client.connect(); peers.push(client); await checkHostedRole(client) }
  const pids = await Promise.all(peers.map(c => scalar('select pg_backend_pid()', [], c)))
  phase = 'two-connection-reference-versus-cancellation'
  await db.query('begin'); begun = true; await db.query('select id from bx1_portal.products where id=$1 for update', [fund.id])
  const raceBody = { obligation_id: raceOrder.obligation.id, expected_revision: raceOrder.obligation.revision, expected_route_revision: routeFund.revision, payer_address: payer, transaction_hash: hash(++txSequence + 1000), log_index: 0, signature: `0x${'11'.repeat(65)}` }
  const raceCalls = [concurrent(peers[0], c => command(3, investor, 'submit_funding_reference', raceBody, key(), c)), concurrent(peers[1], c => command(3, investor, 'cancel_subscription', { subscription_id: raceOrder.subscription.id }, key(), c))]
  await blocked(pids); await db.query('commit'); begun = false
  const races = await Promise.all(raceCalls)
  truth(Boolean(races[0].value), 'an investor may report a reference even after cancellation')
  truth(Boolean(races[1].value) || races[1].code === '23514', 'cancellation commits first or is denied by the reference')
  const raceSubscriptionStatus = await scalar('select status from bx1_portal.subscriptions where id=$1', [raceOrder.subscription.id])
  eq(raceSubscriptionStatus, races[1].value ? 'CANCELLED' : 'AWAITING_FUNDING', 'reservation outcome matches the committed cancellation')
  await db.query('begin'); begun = true
  const raceRef = (await read(3)).funding.references.find(r => r.obligation_id === raceOrder.obligation.id)
  await verify(3, investor, 'REFERENCE', raceRef.id, raceOrder.obligation.token_amount_base_units)
  const raceState = await read(3), raceOb = raceState.funding.obligations.find(o => o.id === raceOrder.obligation.id)
  eq(raceOb.state, races[1].value ? 'UNAPPLIED' : 'EVIDENCE_REVIEW', 'late successful facts never restore a cancelled reservation')
  eq(raceState.subscriptions.find(s => s.id === raceOrder.subscription.id).status, raceSubscriptionStatus, 'chain observation does not change reservation outcome')
  await admin(); await db.query('commit'); begun = false
  phase = 'two-connection-observation-idempotency'
  await db.query('begin'); begun = true; await db.query('select id from bx1_portal.products where id=$1 for update', [estate.id])
  const retries = peers.map(c => concurrent(c, cc => store(retryExpectation, retryEvidence, cc)))
  await blocked(pids); await db.query('commit'); begun = false
  const retryResults = await Promise.all(retries)
  eq(retryResults.filter(x => x.value).length, 2, 'simultaneous exact verified retries both resolve')
  eq(retryResults[0].value, retryResults[1].value, 'both retries return one immutable observation')
  eq(await scalar('select count(*)::int from bx1_portal.funding_observations where expectation_id=$1', [retryExpectation.id]), 1, 'one observation')
  eq(await scalar('select count(*)::int from bx1_portal.funding_receipt_claims where reference_id=$1', [retryRef.id]), 1, 'one global receipt claim')
  phase = 'post-wait-verifier-session-expiry'
  await db.query("update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id=$1", [sid(5)])
  await db.query('begin'); begun = true; await db.query('select id from bx1_portal.products where id=$1 for update', [fund.id])
  const expiring = concurrent(peers[0], c => store(expiryExpectation, facts(expiryExpectation), c))
  await blocked([pids[0]])
  await db.query('select pg_sleep(greatest(0,extract(epoch from not_after-clock_timestamp()))+0.1) from auth.sessions where id=$1', [sid(5)])
  await db.query('commit'); begun = false
  eq((await expiring).code, '42501', 'service writer rechecks original caller after actual lock wait')
  eq(await scalar('select count(*)::int from bx1_portal.funding_observations where expectation_id=$1', [expiryExpectation.id]), 0, 'expired authority leaves no observation')
  await checkHostedRole()
  eq(await authorityBoundary(), originalAuthorityBoundary, 'runtime actions leave private authority ACLs and membership unchanged')
  phase = 'stage2-eligibility-over-funding-wrapper'
  await db.query('begin'); begun = true
  await admin()
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic funding plus eligibility cloud acceptance')", [scope])
  await sqlFile('../../../supabase/features/bx1_application_admission.sql')
  const historicalOrders = await scalar('select count(*)::int from bx1_portal.subscriptions')
  await sqlFile('../../../supabase/migrations/20260923134152_stage2_product_eligibility.sql')
  await sqlFile('../../../supabase/tests/bx1_product_eligibility.sql')
  await sqlFile('../../../supabase/migrations/20260923143713_stage2_customer_mandates.sql')
  await sqlFile('../../../supabase/tests/bx1_customer_mandates.sql')
  await sqlFile('../../../supabase/migrations/20260923144216_stage2_document_receipts.sql')
  await sqlFile('../../../supabase/tests/bx1_document_receipts.sql')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders, 'funding-wrapper migration preserves historical orders and obligations')
  await denied('funding prior scoped writer cannot bypass eligibility', async () => {
    await actor(3)
    await scalar('select bx1_portal.execute_scoped_pre_eligibility($1::jsonb,$2,$3,$4::jsonb)', [JSON.stringify(investor), 'subscribe', key(), JSON.stringify({ product_id: fund.id, expected_revision: fund.revision, terms_hash: fund.terms_hash, units: '1', accepted_documents: true, accepted_risks: true, investment_account_id: account3.id })])
  }, '42501')
  const eligibilitySubscription = { product_id: fund.id, expected_revision: fund.revision, terms_hash: fund.terms_hash, units: '1', accepted_documents: true, accepted_risks: true, investment_account_id: account3.id }
  await denied('funding-enabled public subscribe still needs eligibility decision', () => command(3, investor, 'subscribe', eligibilitySubscription), '42501')
  const requested = (await command(3, investor, 'request_product_eligibility', { product_id: fund.id, investment_account_id: account3.id, expected_revision: 0, investor_statement: 'Synthetic account-specific investment objectives for this test fund.' })).product_eligibility[0]
  eq([requested.status, requested.effective], ['SUBMITTED', false], 'funding-wrapper request does not itself grant subscription eligibility')
  const compliance = context('ComplianceOfficer')
  eq((await read(4, compliance)).product_eligibility.some(e => e.id === requested.id), true, 'same-human issuer has reviewer scope before independence rejection')
  await denied('funding-wrapper reviewer independence rejects issuer alias', () => command(4, compliance, 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Synthetic issuer alias must never decide the case independently.', checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true } }), '42501')
  const approved = (await command(2, compliance, 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Independent synthetic customer and product suitability review.', checks: { identity: true, product_fit: true, restrictions: true, source_of_funds: true } })).product_eligibility[0]
  eq(approved.effective, true, 'independent approval effective for exact app and fund revisions')
  const nextOrder = await command(3, investor, 'subscribe', eligibilitySubscription)
  eq(nextOrder.funding.routes.length > 0, true, 'eligibility wrapper preserves funding read projection')
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders + 1, 'approved case permits one new order through funding-enabled public RPC')
  const revoked = (await command(2, compliance, 'revoke_product_eligibility', { eligibility_case_id: approved.id, expected_revision: approved.revision, reason: 'Synthetic product-specific restriction requires immediate revocation of eligibility.' })).product_eligibility[0]
  eq([revoked.status, revoked.effective], ['REVOKED', false], 'funding-enabled subscription route sees the same revoked case')
  await denied('funding wrapper cannot bypass product-specific revocation', () => command(3, investor, 'subscribe', eligibilitySubscription), '42501')
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders + 1, 'funding wrapper adds no order after revocation')
  phase = 'latest-offering-migration-over-funded-history'
  await sqlFile('../../../supabase/migrations/20260923161500_stage2_application_document_history.sql')
  await sqlFile('../../../supabase/migrations/20260923171126_stage2_entity_investment_accounts.sql')
  await sqlFile('../../../supabase/migrations/20260923175822_stage2_superadmin_shell_mfa_boundary.sql')
  const fundedHistory = await scalar(`select jsonb_build_object(
    'products',(select count(*) from bx1_portal.products),
    'subscriptions',(select count(*) from bx1_portal.subscriptions),
    'routes',(select count(*) from bx1_portal.funding_routes),
    'obligations',(select count(*) from bx1_portal.funding_obligations),
    'journals',(select count(*) from bx1_portal.funding_journals))`)
  await sqlFile('../../../supabase/migrations/20260923205519_stage3_immutable_offering_packages.sql')
  eq(await scalar(`select jsonb_build_object(
    'products',(select count(*) from bx1_portal.products),
    'subscriptions',(select count(*) from bx1_portal.subscriptions),
    'routes',(select count(*) from bx1_portal.funding_routes),
    'obligations',(select count(*) from bx1_portal.funding_obligations),
    'journals',(select count(*) from bx1_portal.funding_journals))`), fundedHistory,
    'latest offering cutover retains all historical funding and journal references')
  const preserved = (await read(3, investor)).subscriptions.find(s => s.id === raceOrder.subscription.id)
  truth(preserved?.offering_revision_id, 'investor can still read historical funded order mapped to immutable legacy snapshot')
  truth((await read(2, controller)).funding.obligations.some(o => o.id === raceOrder.obligation.id),
    'controller can still read historical obligation for exception or recovery')
  await admin(); await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=$1", [sid(5)])
  const oldFinance = await read(5, treasury)
  eq(oldFinance.products.find(p => p.id === fund.id)?.allowed_actions.includes('propose_funding_route'), false,
    'Treasury is not offered a new funding route on historical published product')
  eq((await read(2, controller)).funding.routes.some(r => r.allowed_actions.includes('approve_funding_route')),
    false, 'Controller is not offered route approval without current package and readiness')
  await denied('old funded product cannot accept a new route at the table boundary', async () => {
    await admin(); await db.query(`insert into bx1_portal.funding_routes(product_id,organisation_id,product_revision,terms_hash,
      token_address,token_runtime_hash,token_decimals,receiving_address,authority_reference,
      code_review_reference,valid_until,proposed_by,proposed_person,proposed_context)
      select product_id,organisation_id,product_revision,terms_hash,token_address,token_runtime_hash,
        token_decimals,receiving_address,authority_reference,code_review_reference,
        clock_timestamp()+interval '1 hour',proposed_by,proposed_person,proposed_context
      from bx1_portal.funding_routes order by created_at,id limit 1`)
  }, '23514')
  await denied('old funded product cannot create another obligation at the table boundary', async () => {
    await admin(); await db.query(`insert into bx1_portal.funding_obligations(subscription_id,investment_account_id,
      investor_id,product_id,organisation_id,route_id,product_revision,terms_hash,amount_minor,
      currency,token_amount_base_units,token_decimals)
      select subscription_id,investment_account_id,investor_id,product_id,organisation_id,
        route_id,product_revision,terms_hash,amount_minor,currency,token_amount_base_units,token_decimals
      from bx1_portal.funding_obligations order by created_at,id limit 1`)
  }, '23514')
  phase = 'funding-monitoring-held-existing-obligation'
  await admin()
  await sqlFile('../../../supabase/migrations/20260924125627_stage2_customer_monitoring.sql')
  checks += await proveCustomerMonitoringFunding(db, {
    investorApplicationId: await scalar('select application_id from bx1_portal.investment_accounts where id=$1', [account3.id]),
    heldObligationId: auditOrder.obligation.id,
    otherObligationId: duplicate.obligation.id,
    unpostedReferenceId: auditRef.id,
  })
  await db.query('commit'); begun = false
  phase = 'cleanup'
  await cleanupFixture()
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'synthetic schemas removed')
  eq(await scalar("select count(*)::int from pg_roles where rolname='bx1_fixture_bootstrap'"), 0, 'maintenance-only superuser role removed')
  console.log(`BX1_FUNDING_SQL_PASS assertions=${checks} migrationRole=nosuperuser-bypassrls runtimeDefiners=non-superuser privateAuthority=select-only-restored bothAssets=canonical-obligation-and-ledger providerFacts=synthetic-only realChainReceipt=not-proven authProvider=not-proven mainnet=not-enabled concurrency=reference-cancellation-observation-retry-session-expiry cleanup=removed`)
} catch (error) {
  const diagnostic = typeof error?.message === 'string' ? error.message.split(/[\r\n]/, 1)[0].slice(0, 220).replace(/[^\x20-\x7e]/g, '?') : 'unavailable'
  console.error(`BX1_FUNDING_SQL_FAILED phase=${phase} line=${error?.fixtureLine ?? 'unknown'} code=${error?.code ?? 'assertion'} diagnostic=${JSON.stringify(diagnostic)}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.query('rollback') } catch {} }
  await Promise.all(peers.map(c => c.end().catch(() => {})))
  if (committed) { try { await cleanupFixture() } catch { console.error('BX1_FUNDING_CLEANUP_FAILED disposable-service-will-be-destroyed-by-CI'); process.exitCode = 1 } }
  if (maintenanceConnected) await maintenance.end().catch(() => {})
  if (connected) await db.end()
}
