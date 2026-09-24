import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { proveProviderEvidence } from './provider-evidence-proof.mjs'

// Exact disposable GitHub PostgreSQL17 service only. No local/project execution.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Portal SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('Portal SQL proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-portal-cloud-ci' }
const db = new pg.Client(options)
let phase = 'initialise', checks = 0, begun = false, connected = false, keySequence = 0
let committedFixture = false
const proofClients = []
const uid = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => `ef000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`
const eq = (actual, expectedValue, label) => { assert.deepEqual(actual, expectedValue, label); checks++ }
const truth = (actual, label) => { assert.ok(actual, label); checks++ }
const source = path => readFile(new URL(path, import.meta.url), 'utf8')
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await source(path)
  try { await db.query(sql) } catch (error) {
    const position = Number(error?.position)
    if (Number.isInteger(position) && position > 0 && position <= sql.length) error.fixtureLine = sql.slice(0, position - 1).split('\n').length
    throw error
  }
}
async function scalar(sql, params = [], client = db) { return Object.values((await client.query(sql, params)).rows[0])[0] }
async function admin() { await db.query('reset role') }
async function actor(n, extra = {}, client = db) {
  await client.query('reset role')
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })])
  await client.query('set local role authenticated')
}
async function read(n) { await actor(n); return scalar('select public.bx1_portal_read()') }
async function command(n, kind, payload, requestKey = key(), client = db) {
  await actor(n, {}, client)
  return scalar('select public.bx1_portal_command($1,$2,$3::jsonb)', [kind, requestKey, JSON.stringify(payload)], client)
}
async function denied(label, body, expectedCode = '23514') {
  await db.query('savepoint expected_denial')
  let code
  try { await body() } catch (error) { code = error?.code }
  await db.query('rollback to savepoint expected_denial; release savepoint expected_denial')
  eq(code, expectedCode, `${label} (observed SQLSTATE ${code ?? 'none'})`)
}
const document = (n, kind, i) => ({ id: `ed000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, kind, title: `Synthetic ${kind}`, storage_path: `${uid(n)}/synthetic-${kind}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' })
const details = (n, entity = false, country = 'ZA') => ({ full_name: `Synthetic Applicant ${n}`, country, investor_type: entity ? 'ENTITY' : 'INDIVIDUAL', company_name: entity ? `Synthetic Company ${n}` : '', registration_reference: entity ? `SYNTHETIC-${n}` : '', source_of_funds: 'Fictional test savings only, no actual money or customer information.', beneficial_owners: entity ? 'Synthetic owner with one hundred percent fictional ownership.' : '', experience: 'Synthetic investment experience for workflow testing only.', documents: (entity ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => document(n, kind, i)), test_data_acknowledged: true })
const application = (n, persona = 'INVESTOR', revision = 0, country = 'ZA') => ({ persona, expected_revision: revision, details: details(n, persona === 'WEALTH_MANAGER', country) })
const reviewChecks = { identity: true, ownership: true, screening: true, suitability: true }
const offeringChecks = { issuer: true, terms: true, disclosures: true, eligibility: true }
const terms = (asset = 'FUND') => ({ asset_type: asset, name: `Synthetic ${asset} product`, issuer_name: 'Synthetic test issuer', summary: 'Fictional offering solely for testing a customer investment journey.', strategy: 'Fictional long-term diversified test strategy. This is not an investment offer.', share_class: 'Test Class A', currency: 'ZAR_TEST', unit_price_minor: '9007199254740993', cap_units: '10', minimum_units: '1', pricing_basis: 'Fixed synthetic unit price for workflow checks.', fees: 'No real fees or payments in this test.', redemption_terms: 'Future governed redemption service; not yet available for this test product.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'], property_address: asset === 'REAL_ESTATE' ? '100 Fictional Test Street' : '', property_valuation_minor: asset === 'REAL_ESTATE' ? '1234567890' : '0', rental_income_policy: asset === 'REAL_ESTATE' ? 'Fictional rental income policy requiring future reconciliation.' : '', documents: { memorandum: 'Synthetic memorandum. No property, fund interest or investment is offered. '.repeat(2).trim(), risks: 'Synthetic risk disclosure. This test does not represent real investment or ownership. '.repeat(2).trim(), subscription_terms: 'Synthetic subscription terms. Reservations do not confirm funding, assets or token delivery. '.repeat(2).trim() } })
async function approveApplication(n, persona = 'INVESTOR', country = 'ZA') {
  const submitted = await command(n, 'submit_application', application(n, persona, 0, country))
  const a = submitted.applications.find(value => value.user_id === uid(n))
  await command(2, 'review_application', { application_id: a.id, expected_revision: a.revision, decision: 'APPROVED', notes: 'Independent manual TEST_ONLY review of fictional evidence.', checks: reviewChecks })
  return (await read(n)).applications.find(value => value.user_id === uid(n))
}
async function publishProduct(orgId, asset = 'FUND') {
  const created = await command(1, 'create_product', { organisation_id: orgId, terms: terms(asset) })
  let p = created.products.find(value => value.terms.asset_type === asset && value.status === 'DRAFT')
  const submitted = await command(1, 'submit_product', { product_id: p.id, expected_revision: p.revision }); p = submitted.products.find(value => value.id === p.id)
  const reviewed = await command(2, 'review_product', { product_id: p.id, expected_revision: p.revision, decision: 'APPROVED', notes: 'Independent fictional issuer, terms and disclosure test review.', checks: offeringChecks }); p = reviewed.products.find(value => value.id === p.id)
  return (await command(1, 'publish_product', { product_id: p.id, expected_revision: p.revision })).products.find(value => value.id === p.id)
}
const subscribe = (p, units = '3') => ({ product_id: p.id, expected_revision: p.revision, terms_hash: p.terms_hash, units, accepted_documents: true, accepted_risks: true })
const applicant = { mode: 'APPLICANT' }
const nativeScope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
const otherScope = 'e3000000-0000-4000-8000-000000000002'
const roleContext = (role, organisationId = nativeScope) => ({ mode: 'ROLE', organisationId, role })
async function scopedRead(n, context, client = db) {
  await actor(n, {}, client)
  return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)], client)
}
async function scopedCommand(n, context, kind, payload, requestKey = key(), client = db) {
  await actor(n, {}, client)
  return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [kind, requestKey, JSON.stringify(payload), JSON.stringify(context)], client)
}
async function mandateScopedRead(n, context, client = db) {
  await actor(n, { aal: 'aal2' }, client)
  return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)], client)
}
async function mandateScopedCommand(n, context, kind, payload, requestKey = key(), client = db) {
  await actor(n, { aal: 'aal2' }, client)
  return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [kind, requestKey, JSON.stringify(payload), JSON.stringify(context)], client)
}
async function entryRead(n, client = db) { await actor(n, {}, client); return scalar('select public.bx1_entry_read()', [], client) }
async function entryCommand(n, kind, payload, requestKey = key(), client = db) {
  await actor(n, {}, client)
  return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [kind, requestKey, JSON.stringify(payload)], client)
}
async function scopedPublishedProduct(orgId, asset, name, cap = '10') {
  const context = roleContext('OfferingManager')
  const created = await scopedCommand(1, context, 'create_product', { organisation_id: orgId, terms: { ...terms(asset), name, cap_units: cap } })
  let p = created.products.find(value => value.terms.name === name)
  const submitted = await scopedCommand(1, context, 'submit_product', { product_id: p.id, expected_revision: p.revision }); p = submitted.products.find(value => value.id === p.id)
  const reviewed = await scopedCommand(2, roleContext('ComplianceOfficer'), 'review_product', { product_id: p.id, expected_revision: p.revision, decision: 'APPROVED', notes: 'Independent fictional offering review through explicit native scope.', checks: offeringChecks }); p = reviewed.products.find(value => value.id === p.id)
  return (await scopedCommand(1, roleContext('IssuerFundManager'), 'publish_product', { product_id: p.id, expected_revision: p.revision })).products.find(value => value.id === p.id)
}
async function waitForBlocked(pids) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const blocked = await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids])
    if (blocked === pids.length) { checks++; return }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Concurrent statements did not overlap on the held capacity/authority lock')
}
async function concurrentCall(client, n, context, kind, payload, requestKey) {
  await client.query('begin')
  try {
    const result = await scopedCommand(n, context, kind, payload, requestKey, client)
    await client.query('commit')
    return { result }
  } catch (error) {
    await client.query('rollback')
    return { code: error?.code }
  }
}

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'disposable service actor')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'fresh database')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.users add column raw_user_meta_data jsonb default '{}'::jsonb; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await db.query("create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated")
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql', '20260918234447_bx1_controlled_administration.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  phase = 'feature-empty-boundary'
  eq(await scalar('select count(*)::int from auth.users'), 0, 'no Auth seeds')
  for (const table of ['applications', 'organisations', 'products', 'subscriptions', 'requests', 'events']) {
    eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0, `no ${table} seeds`)
    for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')', [role, `bx1_portal.${table}`]), false, `${role} no direct ${table}`)
  }
  for (const role of ['anon', 'service_role']) eq(await scalar('select has_function_privilege($1,\'public.bx1_portal_command(text,uuid,jsonb)\',\'EXECUTE\')', [role]), false, `${role} cannot command`)
  eq(await scalar("select count(*)::int from pg_class where relnamespace='bx1_portal'::regnamespace and relkind='r' and relrowsecurity"), 6, 'all portal tables RLS')
  await sqlFile('../../../supabase/tests/bx1_portal.sql')
  phase = 'registration-and-boundaries'
  eq((await read(3)).applications.length, 0, 'new verified signup can access own empty portal')
  await admin(); eq(await scalar('select count(*)::int from public.bx1_profiles where id=$1', [uid(3)]), 0, 'signup did not silently create native privileges')
  await denied('unverified email denied', () => read(7), '42501')
  await denied('anonymous account denied', async () => { await admin(); await db.query('update auth.users set is_anonymous=true where id=$1', [uid(3)]); await read(3) }, '42501')
  await denied('suspended native profile cannot become applicant bypass', async () => { await admin(); await db.query("update public.bx1_profiles set status='SUSPENDED' where id=$1", [uid(1)]); await read(1) }, '42501')
  await denied('expired session denied', async () => { await admin(); await db.query("update auth.sessions set not_after=now()-interval '1 minute' where user_id=$1", [uid(3)]); await read(3) }, '42501')
  await denied('wrong session binding denied', async () => { await actor(3, { session_id: sid(1) }); await scalar('select public.bx1_portal_read()') }, '42501')
  await denied('unprovisioned enrolled AAL1 blocked', async () => { await admin(); await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(9), uid(3)]); await read(3) }, '42501')
  await denied('missing AAL cannot yield nullable session bypass', async () => { await admin(); await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(9), uid(3)]); await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(9), uid(3)]); await actor(3, { aal: undefined }); await scalar('select public.bx1_portal_read()') }, '42501')
  await denied('missing uploaded document denied', () => command(3, 'submit_application', { ...application(3), details: { ...details(3), documents: [{ ...document(3, 'IDENTITY', 0), storage_path: `${uid(3)}/absent.pdf` }] } }))
  await denied('foreign uploaded evidence denied', () => command(3, 'submit_application', { ...application(3), details: { ...details(3), documents: [document(1, 'IDENTITY', 0)] } }), '22023')
  await denied('raw null hash denied', () => command(3, 'submit_application', { ...application(3), details: { ...details(3), documents: [{ ...document(3, 'IDENTITY', 0), sha256: null }] } }), '22023')
  await denied('KYB evidence cannot be omitted', () => command(1, 'submit_application', { ...application(1, 'WEALTH_MANAGER'), details: details(1) }))
  await denied('raw invented role field denied', () => command(3, 'submit_application', { ...application(3), role: 'SuperAdmin' }), '22023')
  const appKey = key(), wmInput = application(1, 'WEALTH_MANAGER')
  let state = await command(1, 'submit_application', wmInput, appKey)
  let wmApp = state.applications[0]
  eq(wmApp.status, 'SUBMITTED', 'WM submitted')
  eq((await command(1, 'submit_application', wmInput, appKey)).applications[0].revision, 1, 'exact replay no extra revision')
  const receipts = (await read(1)).requests
  truth(receipts.some(r => r.key === appKey && r.command === 'submit_application'), 'caller-owned receipt supports refresh recovery')
  truth(receipts.every(r => Object.keys(r).sort().join(',') === 'command,key'), 'request receipts expose no submitted evidence or payload')
  eq((await read(3)).requests.length, 0, 'other caller cannot see request keys')
  await denied('same key changed body denied', () => command(1, 'submit_application', { ...wmInput, details: { ...wmInput.details, full_name: 'Changed Applicant' } }, appKey), '23505')
  const review = { application_id: wmApp.id, expected_revision: wmApp.revision, decision: 'APPROVED', notes: 'Independent manual TEST_ONLY review of fictional evidence.', checks: reviewChecks }
  await denied('maker cannot approve self', () => command(1, 'review_application', review), '42501')
  await denied('known same human second login cannot approve', () => command(4, 'review_application', review), '42501')
  await denied('unrelated tenant reviewer denied', () => command(5, 'review_application', review), '42501')
  await denied('reviewer cannot approve unchecked case', () => command(2, 'review_application', { ...review, checks: { ...reviewChecks, screening: false } }))
  eq((await read(5)).applications.length, 0, 'unrelated reviewer sees no private case')
  await actor(5); eq(await scalar("select count(*)::int from storage.objects where owner_id=$1", [uid(1)]), 0, 'restrictive read defeats broader existing policy')
  await actor(2); eq(await scalar("select count(*)::int from storage.objects where owner_id=$1", [uid(1)]), 3, 'delegated reviewer sees case evidence only')
  await actor(1); eq((await db.query("update storage.objects set metadata='{}' where owner_id=$1", [uid(1)])).rowCount, 0, 'no overwrite even with broad existing update policy')
  eq((await db.query('delete from storage.objects where owner_id=$1', [uid(1)])).rowCount, 0, 'no deletion even with broad existing delete policy')
  await denied('cannot create foreign-path object', async () => { await actor(3); await db.query("insert into storage.objects(bucket_id,name,owner_id) values('bx1-portal-documents',$1,$2)", [`${uid(1)}/forged.pdf`, uid(3)]) })
  await denied('eight object worst-case quota enforced on upload', async () => {
    await admin(); await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) select 'bx1-portal-documents',$1||'/quota-count-'||n,$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb from generate_series(1,5)n", [uid(3)])
    await actor(3); await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [`${uid(3)}/one-too-many`, uid(3)])
  })
  await denied('privileged Storage completion cannot bypass quota', async () => {
    await admin(); await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) select 'bx1-portal-documents',$1||'/quota-final-'||n,$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb from generate_series(1,5)n", [uid(3)])
    await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [`${uid(3)}/too-many-final-objects`, uid(3)])
  })
  await db.query('savepoint upload_probe')
  await actor(3); eq((await db.query("insert into storage.objects(bucket_id,name,owner_id) values('bx1-portal-documents',$1,$2)", [`${uid(3)}/metadata-absent-probe`, uid(3)])).rowCount, 1, 'Storage canUpload probe permitted without final size metadata')
  await db.query('rollback to savepoint upload_probe; release savepoint upload_probe')
  await denied('privileged final persistence cannot overwrite evidence', async () => { await admin(); await db.query("update storage.objects set metadata='{}' where owner_id=$1", [uid(1)]) })
  await actor(3); eq((await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [`${uid(3)}/allowed-small-upload`, uid(3)])).rowCount, 1, 'ordinary own upload within quota succeeds')
  await command(2, 'review_application', review)
  wmApp = (await read(1)).applications[0]
  eq(wmApp.status, 'APPROVED', 'independent WM review')
  eq(Date.parse(wmApp.approved_until) - Date.parse(wmApp.reviewed_at), 30 * 86400000, 'explicit thirty day test expiry')
  const orgId = wmApp.organisation_id
  truth(orgId, 'private portal organisation created')
  await admin(); eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(1)]), 1, 'no native financial role granted by portal')
  await approveApplication(3); await approveApplication(6); await approveApplication(8, 'INVESTOR', 'US')
  eq((await read(3)).applications.length, 1, 'investor sees only own case')
  phase = 'typed-products-and-reservations'
  await denied('investor cannot create product', () => command(3, 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  await denied('invalid real estate perimeter denied', () => command(1, 'create_product', { organisation_id: orgId, terms: { ...terms('REAL_ESTATE'), property_valuation_minor: '0' } }))
  await denied('null asset rejected by SQL', () => command(1, 'create_product', { organisation_id: orgId, terms: { ...terms(), asset_type: null } }), '22023')
  await denied('numeric money rejected by SQL', () => command(1, 'create_product', { organisation_id: orgId, terms: { ...terms(), unit_price_minor: 1000 } }), '22023')
  let created = await command(1, 'create_product', { organisation_id: orgId, terms: terms() }), draft = created.products[0]
  eq((await read(3)).products.length, 0, 'unpublished offering is private')
  await denied('publication without review denied', () => command(1, 'publish_product', { product_id: draft.id, expected_revision: draft.revision }))
  draft = (await command(1, 'submit_product', { product_id: draft.id, expected_revision: draft.revision })).products[0]
  await denied('known maker alias cannot review offering', () => command(4, 'review_product', { product_id: draft.id, expected_revision: draft.revision, decision: 'APPROVED', notes: review.notes, checks: offeringChecks }), '42501')
  await denied('disclosures unchecked blocks approval', () => command(2, 'review_product', { product_id: draft.id, expected_revision: draft.revision, decision: 'APPROVED', notes: review.notes, checks: { ...offeringChecks, disclosures: false } }))
  draft = (await command(2, 'review_product', { product_id: draft.id, expected_revision: draft.revision, decision: 'APPROVED', notes: review.notes, checks: offeringChecks })).products.find(p => p.id === draft.id)
  const fund = (await command(1, 'publish_product', { product_id: draft.id, expected_revision: draft.revision })).products.find(p => p.id === draft.id)
  const property = await publishProduct(orgId, 'REAL_ESTATE')
  eq((await read(3)).products.length, 2, 'approved investor sees both typed eligible offerings')
  eq((await read(8)).products.length, 0, 'country-ineligible investor sees no offerings')
  await denied('ineligible country cannot subscribe directly', () => command(8, 'subscribe', subscribe(fund)), '42501')
  await denied('published terms immutable', () => command(1, 'save_product', { product_id: fund.id, expected_revision: fund.revision, terms: terms() }))
  await denied('stale terms version denied', () => command(3, 'subscribe', { ...subscribe(fund), expected_revision: fund.revision - 1 }))
  await denied('wrong document hash denied', () => command(3, 'subscribe', { ...subscribe(fund), terms_hash: 'b'.repeat(64) }))
  await denied('explicit risk acceptance required', () => command(3, 'subscribe', { ...subscribe(fund), accepted_risks: false }))
  await denied('zero quantity denied', () => command(3, 'subscribe', subscribe(fund, '0')), '22023')
  const subscriptionKey = key(), intent = subscribe(fund)
  const reserved = await command(3, 'subscribe', intent, subscriptionKey), sub = reserved.subscriptions[0]
  eq(sub.status, 'AWAITING_FUNDING', 'no fabricated funded state')
  eq(sub.amount_minor, '27021597764222979', 'exact amount above JS safe integer')
  eq(reserved.products.find(p => p.id === fund.id).reserved_units, '3', 'capacity reserved atomically')
  eq((await command(3, 'subscribe', intent, subscriptionKey)).subscriptions.length, 1, 'subscription idempotency')
  eq((await read(6)).subscriptions.length, 0, 'other investor subscription private')
  await denied('oversubscription denied', () => command(6, 'subscribe', subscribe(fund, '8')))
  await denied('cannot cancel another investor reservation', () => command(6, 'cancel_subscription', { subscription_id: sub.id }), '42501')
  const cancelled = await command(3, 'cancel_subscription', { subscription_id: sub.id })
  eq(cancelled.subscriptions[0].status, 'CANCELLED', 'cancelled unfunded subscription')
  eq(cancelled.products.find(p => p.id === fund.id).reserved_units, '0', 'cancel releases capacity')
  await denied('double cancellation denied', () => command(3, 'cancel_subscription', { subscription_id: sub.id }))
  const propertySub = (await command(3, 'subscribe', subscribe(property, '1'))).subscriptions.find(s => s.product_id === property.id)
  eq(propertySub.status, 'AWAITING_FUNDING', 'real estate journey shares guarded state machine')
  await denied('expired investor approval prevents new reserve', async () => { await admin(); await db.query("update bx1_portal.applications set reviewed_at=now()-interval '31 days',approved_until=now()-interval '1 day' where user_id=$1", [uid(3)]); await command(3, 'subscribe', subscribe(fund)) }, '42501')
  await denied('expired issuer approval prevents new reserve', async () => { await admin(); await db.query("update bx1_portal.applications set reviewed_at=now()-interval '31 days',approved_until=now()-interval '1 day' where user_id=$1", [uid(1)]); await command(3, 'subscribe', subscribe(fund)) }, '42501')
  await denied('audit history immutable', async () => { await admin(); await db.query("update bx1_portal.events set summary='forged'") })
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions where status not in (\'AWAITING_FUNDING\',\'CANCELLED\')'), 0, 'no payment/mint status exists')
  eq(await scalar('select count(*)::int from public.bx1_profiles where id=any($1::uuid[])', [[uid(3), uid(6), uid(8)]]), 0, 'approved investor creates no native profile grants')
  phase = 'scoped-additive-migration'
  const preserved = await scalar('select jsonb_build_object(\'products\',(select count(*) from bx1_portal.products),\'subscriptions\',(select count(*) from bx1_portal.subscriptions))')
  await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  eq(await scalar('select jsonb_build_object(\'products\',(select count(*) from bx1_portal.products),\'subscriptions\',(select count(*) from bx1_portal.subscriptions))'), preserved, 'migration preserves historical product and order rows')
  for (const table of ['organisation_authority_bindings', 'investment_accounts', 'scoped_requests']) {
    eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0, `migration does not seed ${table}`)
    for (const role of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')', [role, `bx1_portal.${table}`]), false, `${role} no direct ${table}`)
  }
  eq((await scopedRead(1, applicant)).organisations[0].authority_source, 'LEGACY_OWNER', 'unbound existing approved owner remains explicit legacy path')
  await denied('missing context is denied', () => scopedRead(1, null), '42501')
  await denied('invented native role is denied', () => scopedRead(1, roleContext('SuperAdmin')), '42501')
  await denied('old public command is no longer callable', () => command(1, 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  await denied('private legacy command cannot bypass scoped wrapper', async () => { await actor(1); await scalar('select bx1_portal.execute_command($1,$2,$3)', ['create_product', key(), JSON.stringify({ organisation_id: orgId, terms: terms() })]) }, '42501')
  await admin(); await sqlFile('../../../supabase/tests/bx1_portal_authority_accounts.sql')
  phase = 'scoped-authority-and-account-boundaries'
  const manager = roleContext('OfferingManager'), issuer = roleContext('IssuerFundManager'), investor = roleContext('Investor'), reviewer = roleContext('ComplianceOfficer')
  const managerState = await scopedRead(1, manager)
  eq(managerState.operating_context, manager, 'returned context exact')
  eq(managerState.organisations.map(o => [o.id, o.native_organisation_id, o.roles, o.authority_source]), [[orgId, nativeScope, ['OfferingManager'], 'NATIVE_BINDING']], 'exact binding not name or owner-derived')
  eq((await scopedRead(1, roleContext('OfferingManager', otherScope))).products.length, 0, 'membership in unrelated scope gives no mapped product data')
  eq((await scopedRead(1, applicant)).organisations.length, 0, 'binding permanently ends legacy owner authority')
  eq((await read(2)).applications.length, 0, 'bootstrap read carries no foreign review cases')
  await denied('legacy owner cannot mutate bound organisation', () => scopedCommand(1, applicant, 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  await denied('valid wrong native scope cannot mutate product', () => scopedCommand(1, roleContext('OfferingManager', otherScope), 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  await denied('reviewer cannot use operator action', () => scopedCommand(2, reviewer, 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  for (const role of ['TransferAgent', 'TokenisationAgent', 'TreasuryOperator', 'FinancialController', 'SuperAdmin']) {
    const scoped = await scopedRead(1, roleContext(role))
    eq([scoped.products.length, scoped.subscriptions.length, scoped.organisations.length], [0, 0, 0], `${role} receives no implied product or investor authority`)
    await denied(`${role} cannot create offerings`, () => scopedCommand(1, roleContext(role), 'create_product', { organisation_id: orgId, terms: terms() }), '42501')
  }
  const delegatedProduct = (await scopedCommand(5, manager, 'create_product', { organisation_id: orgId, terms: { ...terms(), name: 'Explicit delegated non-owner draft' } })).products.find(p => p.terms.name === 'Explicit delegated non-owner draft')
  eq(delegatedProduct.created_by, uid(5), 'explicit native binding authorises a non-owner manager without copying the organisation')
  const ownApp3 = (await scopedRead(3, investor)).applications[0]
  const accountKey = key()
  const account3 = (await scopedCommand(3, investor, 'create_investment_account', { application_id: ownApp3.id }, accountKey)).accounts[0]
  eq(account3.holder_user_id, uid(3), 'investment account belongs to authenticated investor')
  eq((await scopedCommand(3, investor, 'create_investment_account', { application_id: ownApp3.id }, accountKey)).accounts.length, 1, 'account replay creates no duplicate')
  await denied('same idempotency key cannot migrate operating context', () => scopedCommand(3, applicant, 'create_investment_account', { application_id: ownApp3.id }, accountKey), '23505')
  await denied('cannot open account for another applicant', () => scopedCommand(6, investor, 'create_investment_account', { application_id: ownApp3.id }), '42501')
  const ownApp6 = (await scopedRead(6, investor)).applications[0]
  const account6 = (await scopedCommand(6, investor, 'create_investment_account', { application_id: ownApp6.id })).accounts[0]
  eq((await scopedRead(6, investor)).accounts.length, 1, 'other investor sees only own account')
  await denied('operator cannot create an investment account through role context', () => scopedCommand(1, manager, 'create_investment_account', { application_id: ownApp3.id }), '42501')
  await denied('entity approval cannot create an individual account', async () => { await admin(); await db.query("update bx1_portal.applications set details=jsonb_set(details,'{investor_type}','\"ENTITY\"') where id=$1", [ownApp6.id]); await scopedCommand(6, investor, 'create_investment_account', { application_id: ownApp6.id }) }, '42501')
  await denied('suspended account cannot subscribe', async () => { await admin(); await db.query("update bx1_portal.investment_accounts set status='SUSPENDED' where id=$1", [account3.id]); await scopedCommand(3, investor, 'subscribe', { ...subscribe(fund, '1'), investment_account_id: account3.id }) }, '42501')
  await denied('subscription requires explicit account', () => scopedCommand(3, investor, 'subscribe', subscribe(fund, '1')), '42501')
  await denied('foreign account cannot subscribe', () => scopedCommand(3, investor, 'subscribe', { ...subscribe(fund, '1'), investment_account_id: account6.id }), '42501')
  await denied('revoked mapped authority denies write immediately', async () => { await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='OfferingManager'", [orgId]); await scopedCommand(1, manager, 'create_product', { organisation_id: orgId, terms: terms() }) }, '42501')
  await denied('binding tombstone cannot be deleted', async () => { await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='OfferingManager'", [orgId]); await db.query("delete from bx1_portal.organisation_authority_bindings where product_organisation_id=$1 and role='OfferingManager'", [orgId]) })
  await denied('revocation cannot restore legacy owner fallback', async () => { await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1", [orgId]); await scopedCommand(1, applicant, 'create_product', { organisation_id: orgId, terms: terms() }) }, '42501')
  for (const timing of ['EXPIRED', 'FUTURE']) {
    await denied(`${timing} binding cannot authorise product write`, async () => {
      await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='OfferingManager'", [orgId])
      await db.query("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'OfferingManager','ACTIVE',clock_timestamp()+($3::int*interval '1 hour'),clock_timestamp()+($4::int*interval '1 hour'),'synthetic-cloud-proof:timed-binding',$5)", [orgId, nativeScope, timing === 'EXPIRED' ? -2 : 1, timing === 'EXPIRED' ? -1 : 2, key()])
      await scopedCommand(1, manager, 'create_product', { organisation_id: orgId, terms: terms() })
    }, '42501')
  }
  await denied('investment account holder cannot be reassigned', async () => { await admin(); await db.query('update bx1_portal.investment_accounts set holder_user_id=$1 where id=$2', [uid(6), account3.id]) })
  await db.query('savepoint revoked_read')
  await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='ComplianceOfficer'", [orgId])
  eq((await scopedRead(2, reviewer)).applications.some(a => a.id === wmApp.id), false, 'revoked binding removes organisation case from reviewer')
  await actor(2); eq(await scalar('select count(*)::int from storage.objects where owner_id=$1', [uid(1)]), 0, 'revoked binding removes direct Storage evidence access')
  await db.query('rollback to savepoint revoked_read; release savepoint revoked_read')
  phase = 'two-assets-same-record-inbox'
  const scopedFund = await scopedPublishedProduct(orgId, 'FUND', 'Scoped synthetic fund')
  const scopedProperty = await scopedPublishedProduct(orgId, 'REAL_ESTATE', 'Scoped synthetic real estate')
  const newOrderIds = []
  for (const product of [scopedFund, scopedProperty]) {
    const input = { ...subscribe(product, '2'), investment_account_id: account3.id }, requestKey = key()
    const investorView = await scopedCommand(3, investor, 'subscribe', input, requestKey)
    const order = investorView.subscriptions.find(s => s.product_id === product.id)
    const issuerOrder = (await scopedRead(1, issuer)).subscriptions.find(s => s.id === order.id)
    eq(issuerOrder, order, `${product.terms.asset_type} issuer sees exact same order, account, revision, terms hash and amount`)
    eq([order.investment_account_id, order.amount_minor, order.currency, order.status], [account3.id, '18014398509481986', 'ZAR_TEST', 'AWAITING_FUNDING'], 'exact account-based instruction, not funded holding')
    eq((await scopedCommand(3, investor, 'subscribe', input, requestKey)).subscriptions.filter(s => s.product_id === product.id).length, 1, 'same-context retry produces one instruction')
    newOrderIds.push(order.id)
  }
  eq((await scopedRead(6, investor)).subscriptions.filter(s => newOrderIds.includes(s.id)).length, 0, 'second investor sees none of first investor orders')
  eq((await scopedRead(5, roleContext('OfferingManager', otherScope))).subscriptions.length, 0, 'unrelated organisation issuer sees no orders')
  await denied('accepted subscription account cannot be reassigned', async () => { await admin(); await db.query('update bx1_portal.subscriptions set investment_account_id=$1 where id=$2', [account6.id, newOrderIds[0]]) })
  await admin()
  const auditBaseline = await scalar("select jsonb_build_object('orders',(select count(*) from bx1_portal.subscriptions),'receipts',(select count(*) from bx1_portal.scoped_requests),'events',(select count(*) from bx1_portal.events),'reserved',(select reserved_units::text from bx1_portal.products where id=$1))", [scopedFund.id])
  await denied('audit insert failure rolls back instruction, account binding, capacity and request receipts', async () => {
    await admin()
    await db.query("create function public.synthetic_portal_audit_failure() returns trigger language plpgsql as $$ begin if NEW.kind='subscribe' then raise exception 'synthetic_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_portal_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_portal_audit_failure()")
    await scopedCommand(3, investor, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: account3.id })
  })
  await admin(); eq(await scalar("select jsonb_build_object('orders',(select count(*) from bx1_portal.subscriptions),'receipts',(select count(*) from bx1_portal.scoped_requests),'events',(select count(*) from bx1_portal.events),'reserved',(select reserved_units::text from bx1_portal.products where id=$1))", [scopedFund.id]), auditBaseline, 'audit failure leaves all accounting-adjacent state unchanged')
  const raceProduct = await scopedPublishedProduct(orgId, 'FUND', 'Concurrent capacity synthetic fund', '3')
  const replayProduct = await scopedPublishedProduct(orgId, 'REAL_ESTATE', 'Concurrent retry synthetic property', '3')
  await admin(); await db.query('commit'); begun = false; committedFixture = true
  phase = 'real-two-connection-capacity-and-idempotency'
  for (let i = 0; i < 2; i++) { const client = new pg.Client({ ...options, application_name: `bx1-portal-concurrency-${i}` }); await client.connect(); proofClients.push(client) }
  const pids = await Promise.all(proofClients.map(client => scalar('select pg_backend_pid()', [], client)))
  await db.query('begin'); begun = true
  await db.query('select id from bx1_portal.products where id=$1 for update', [raceProduct.id])
  const raceCalls = [concurrentCall(proofClients[0], 3, investor, 'subscribe', { ...subscribe(raceProduct, '2'), investment_account_id: account3.id }, key()), concurrentCall(proofClients[1], 6, investor, 'subscribe', { ...subscribe(raceProduct, '2'), investment_account_id: account6.id }, key())]
  await waitForBlocked(pids)
  await db.query('commit'); begun = false
  const race = await Promise.all(raceCalls)
  eq(race.filter(v => v.result).length, 1, 'two simultaneous investors receive one capacity winner')
  eq(race.filter(v => v.code === '23514').length, 1, 'capacity loser rolls back')
  eq(await scalar('select reserved_units::text from bx1_portal.products where id=$1', [raceProduct.id]), '2', 'capacity never oversubscribed')
  const replayKey = key(), replayInput = { ...subscribe(replayProduct, '2'), investment_account_id: account3.id }
  await db.query('begin'); begun = true
  await db.query('select id from bx1_portal.products where id=$1 for update', [replayProduct.id])
  const retries = proofClients.map(client => concurrentCall(client, 3, investor, 'subscribe', replayInput, replayKey))
  await waitForBlocked(pids)
  await db.query('commit'); begun = false
  const retryResults = await Promise.all(retries)
  eq(retryResults.filter(v => v.result).length, 2, 'simultaneous same-context exact retries both resolve')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions where product_id=$1', [replayProduct.id]), 1, 'simultaneous retries persist one instruction')
  eq(await scalar('select count(*)::int from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2', [uid(3), replayKey]), 1, 'simultaneous retries persist one receipt')
  phase = 'authority-expiry-after-real-lock-wait'
  // Revoke one synthetic role binding, replace it with a short-lived fixture,
  // and hold the organisation row past its expiry. No timestamp field is edited.
  await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='IssuerFundManager'", [orgId])
  const timedBinding = await scalar("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'IssuerFundManager','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '2 seconds','synthetic-cloud-proof:wait-expiry',$3) returning id", [orgId, nativeScope, key()])
  await db.query('begin'); begun = true
  await db.query('select id from bx1_portal.organisations where id=$1 for update', [orgId])
  const expiryKey = key(), expiredCall = concurrentCall(proofClients[0], 1, issuer, 'create_product', { organisation_id: orgId, terms: { ...terms(), name: 'Must not survive expiry wait' } }, expiryKey)
  await waitForBlocked([pids[0]])
  await db.query('select pg_sleep(greatest(0,extract(epoch from valid_until-clock_timestamp()))+0.1) from bx1_portal.organisation_authority_bindings where id=$1', [timedBinding])
  await db.query('commit'); begun = false
  eq((await expiredCall).code, '42501', 'binding expiry after simultaneous lock wait denies write')
  eq(await scalar('select count(*)::int from bx1_portal.scoped_requests where request_key=$1', [expiryKey]), 0, 'expired authority after wait leaves no accepted receipt')
  eq(await scalar("select count(*)::int from bx1_portal.products where terms->>'name'='Must not survive expiry wait'"), 0, 'expired authority after wait creates no product')
  phase = 'stage2-eligibility-authority-only-wrapper'
  await db.query('begin'); begun = true
  await admin()
  await sqlFile('../../../supabase/features/bx1_entry.sql')
  await sqlFile('../../../supabase/features/bx1_entry_admission.sql')
  await db.query("insert into bx1_portal.entry_configuration(environment,manual_test_review,reviewer_scope,admission_reference) values('TESTNET',true,$1,'synthetic product-eligibility cloud acceptance')", [nativeScope])
  await sqlFile('../../../supabase/features/bx1_application_admission.sql')
  const historicalOrders = await scalar('select count(*)::int from bx1_portal.subscriptions')
  await sqlFile('../../../supabase/migrations/20260923134152_stage2_product_eligibility.sql')
  await sqlFile('../../../supabase/tests/bx1_product_eligibility.sql')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders, 'new gate preserves historical subscription identifiers and history')
  await denied('direct former scoped writer cannot bypass eligibility', async () => {
    await actor(3)
    await scalar('select bx1_portal.execute_scoped_pre_eligibility($1::jsonb,$2,$3,$4::jsonb)', [JSON.stringify(investor), 'subscribe', key(), JSON.stringify({ ...subscribe(scopedFund, '1'), investment_account_id: account3.id })])
  }, '42501')
  await denied('published matching fund requires product-specific approval', () => scopedCommand(3, investor, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: account3.id }), '42501')
  const requestBody = (product, account, revision = 0) => ({ product_id: product.id, investment_account_id: account.id, expected_revision: revision, investor_statement: 'Synthetic suitability and investment objective statement for this exact offering.' })
  const eligibilityChecks = { identity: true, product_fit: true, restrictions: true, source_of_funds: true }
  await denied('divergent product and investor-admission reviewer scopes cannot create a private case', async () => {
    await admin(); await db.query('update bx1_portal.organisations set reviewer_scope=$1 where id=$2', [otherScope, orgId])
    await scopedCommand(3, investor, 'request_product_eligibility', requestBody(replayProduct, account3))
  }, '42501')
  const requested = (await scopedCommand(3, investor, 'request_product_eligibility', requestBody(scopedFund, account3))).product_eligibility[0]
  eq([requested.status, requested.effective, requested.product_revision, requested.terms_hash], ['SUBMITTED', false, scopedFund.revision, scopedFund.terms_hash], 'request binds current fund terms without granting purchase rights')
  eq((await scopedRead(6, investor)).product_eligibility.length, 0, 'other investor cannot read private eligibility case')
  await db.query('savepoint divergent_scope_read')
  await admin(); await db.query('update bx1_portal.organisations set reviewer_scope=$1 where id=$2', [otherScope, orgId])
  await db.query("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'ComplianceOfficer','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','synthetic-cloud-proof:divergent-review-scope',$3)", [orgId, otherScope, key()])
  const divergentRead = await scopedRead(5, roleContext('ComplianceOfficer', otherScope))
  eq(divergentRead.product_eligibility.some(e => e.id === requested.id), false, 'product-only reviewer in another organisation cannot read investor source statement')
  eq(divergentRead.events.some(e => e.subject_id === requested.id), false, 'product-only reviewer cannot read private case event metadata after scope divergence')
  await db.query('rollback to savepoint divergent_scope_read; release savepoint divergent_scope_read')
  eq((await scopedRead(4, reviewer)).product_eligibility.some(e => e.id === requested.id), true, 'same-human issuer reviewer has exact role scope before independence denial')
  await denied('request cannot review itself as investor', () => scopedCommand(3, investor, 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Synthetic independent product suitability review with complete checked evidence.', checks: eligibilityChecks }), '42501')
  await denied('same human as issuer cannot independently review', () => scopedCommand(4, reviewer, 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Synthetic review attempted by the issuer human under another login.', checks: eligibilityChecks }), '42501')
  await denied('wrong reviewer organisation cannot approve', () => scopedCommand(2, roleContext('ComplianceOfficer', otherScope), 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Synthetic review attempted through an unrelated organisation scope.', checks: eligibilityChecks }), '42501')
  const approved = (await scopedCommand(2, reviewer, 'review_product_eligibility', { eligibility_case_id: requested.id, expected_revision: requested.revision, decision: 'APPROVED', notes: 'Independent synthetic test product and customer evidence review.', checks: eligibilityChecks })).product_eligibility[0]
  eq([approved.status, approved.effective, approved.application_revision], ['APPROVED', true, ownApp3.revision], 'independent decision is current and bound to customer evidence revision')
  eq((await scopedRead(2, reviewer)).product_eligibility[0].investor_application.id, ownApp3.id, 'appointed reviewer can inspect exact originating investor application')
  const stage2SubscriptionKey = key(), stage2Input = { ...subscribe(scopedFund, '1'), investment_account_id: account3.id }
  const afterEligibility = await scopedCommand(3, investor, 'subscribe', stage2Input, stage2SubscriptionKey)
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders + 1, 'approved case permits one additional fund instruction without changing old orders')
  eq((await scopedCommand(3, investor, 'subscribe', stage2Input, stage2SubscriptionKey)).subscriptions.length, afterEligibility.subscriptions.length, 'exact subscription retry remains idempotent')
  await denied('changing investor admission revision invalidates earlier eligibility', async () => {
    await admin(); await db.query('update bx1_portal.applications set revision=revision+1 where id=$1', [ownApp3.id])
    await scopedCommand(3, investor, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: account3.id })
  }, '42501')
  await denied('eligibility expiry prevents new reservation', async () => {
    await admin(); await db.query("update bx1_portal.product_eligibility_cases set reviewed_at=clock_timestamp()-interval '31 days',approved_until=clock_timestamp()-interval '1 day' where id=$1", [approved.id])
    await scopedCommand(3, investor, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: account3.id })
  }, '42501')
  await denied('missing required audit rolls back eligibility revocation', async () => {
    await admin()
    await db.query("create function public.synthetic_eligibility_audit_failure() returns trigger language plpgsql as $$ begin if NEW.kind='revoke_product_eligibility' then raise exception 'synthetic_eligibility_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_eligibility_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_eligibility_audit_failure()")
    await scopedCommand(2, reviewer, 'revoke_product_eligibility', { eligibility_case_id: approved.id, expected_revision: approved.revision, reason: 'Synthetic material restriction requires immediate suspension of this approval.' })
  })
  eq((await scopedRead(3, investor)).product_eligibility[0].status, 'APPROVED', 'failed mandatory audit did not revoke eligibility')
  const revoked = (await scopedCommand(2, reviewer, 'revoke_product_eligibility', { eligibility_case_id: approved.id, expected_revision: approved.revision, reason: 'Synthetic material restriction requires immediate suspension of this approval.' })).product_eligibility[0]
  eq([revoked.status, revoked.effective], ['REVOKED', false], 'independent revocation immediately removes eligibility')
  await denied('revoked case cannot reserve another unit', () => scopedCommand(3, investor, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: account3.id }), '42501')
  await denied('revoked case cannot be self-reopened', () => scopedCommand(3, investor, 'request_product_eligibility', requestBody(scopedFund, account3, revoked.revision)))
  await admin(); eq(await scalar('select count(*)::int from bx1_portal.product_eligibility_receipts where case_id=$1', [approved.id]), 3, 'request, approval and revocation have immutable ordered receipts')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), historicalOrders + 1, 'denied eligibility writes create no extra reservations')
  await db.query('commit'); begun = false
  phase = 'stage2-reviewer-binding-revocation-race'
  // The synthetic actor helper uses transaction-local JWT claims and role.
  // Create the pending case in its own committed transaction so the separate
  // reviewer connection can see it before the competing binding lock begins.
  await db.query('begin'); begun = true
  const raceCase = (await scopedCommand(3, investor, 'request_product_eligibility', requestBody(replayProduct, account3))).product_eligibility.find(e => e.product_id === replayProduct.id)
  truth(raceCase?.id, 'separate published product supplies a pending case for real revocation race')
  await db.query('commit'); begun = false
  await admin(); await db.query('begin'); begun = true
  const reviewBinding = await scalar("select id from bx1_portal.organisation_authority_bindings where product_organisation_id=$1 and native_organisation_id=$2 and role='ComplianceOfficer' and status='ACTIVE' for update", [orgId, nativeScope])
  truth(reviewBinding, 'appointed Compliance binding exists and is locked by competing transaction')
  const racedReviewKey = key()
  const racedReview = concurrentCall(proofClients[0], 2, reviewer, 'review_product_eligibility', { eligibility_case_id: raceCase.id, expected_revision: raceCase.revision, decision: 'APPROVED', notes: 'Synthetic review must not survive concurrent authority revocation.', checks: eligibilityChecks }, racedReviewKey)
  await waitForBlocked([pids[0]])
  await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [reviewBinding])
  await db.query('commit'); begun = false
  eq((await racedReview).code, '42501', 'reviewer binding revoked during lock wait prevents approval')
  await admin(); eq(await scalar('select status from bx1_portal.product_eligibility_cases where id=$1', [raceCase.id]), 'SUBMITTED', 'failed concurrent review leaves case pending')
  eq(await scalar('select count(*)::int from bx1_portal.scoped_requests where request_key=$1', [racedReviewKey]), 0, 'failed concurrent review leaves no accepted receipt')
  phase = 'stage2-customer-representative-mandate'
  await db.query('begin'); begun = true
  await admin()
  await sqlFile('../../../supabase/migrations/20260923143713_stage2_customer_mandates.sql')
  await sqlFile('../../../supabase/tests/bx1_customer_mandates.sql')
  phase = 'mandate-fixture-identity'
  await actor(1); eq(await scalar('select bx1_private.can_access_organisation($1::uuid)', [nativeScope]), true, 'legacy native membership remains effective')
  await admin()
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-mandate-admin@example.invalid',clock_timestamp(),false)", [uid(10)])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(10), uid(10)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic independent mandate applier')", [uid(10)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','ACTIVE')", [uid(10), nativeScope])
  await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Synthetic test human 10','TRUSTED','synthetic:test-human-10',$2)", [uid(20), uid(21)])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:test-principal-10',$3)", [uid(10), uid(20), uid(21)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic roleless manager applicant')", [uid(9)])
  await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Synthetic test human 9','TRUSTED','synthetic:test-human-9',$2)", [uid(30), uid(31)])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:test-principal-9',$3)", [uid(9), uid(30), uid(31)])
  await admin(); eq(await scalar('select count(distinct person_id)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[uid(9), uid(2), uid(10)]]), 3, 'applicant reviewer and applier are three mapped synthetic humans')
  phase = 'mandate-customer-admission'
  eq((await entryRead(9)).applications.length, 0, 'fresh manager starts with no assumed capacity')
  const startedManager = await entryCommand(9, 'start_application', { persona: 'WEALTH_MANAGER' })
  const managerAppDraft = startedManager.applications.find(value => value.user_id === uid(9) && value.persona === 'WEALTH_MANAGER')
  truth(managerAppDraft?.id, 'wealth-manager signup selects exact application capacity')
  const managerDetails = {
    details_version: 2, full_name: 'Synthetic Applicant Nine', country: 'ZA',
    company_name: 'Synthetic Customer Wealth Management', registration_reference: 'SYNTHETIC-WM-9',
    beneficial_owners: 'Synthetic owner holds all fictional customer interests.',
    business_activities: 'Synthetic wealth-management activity for isolated TEST rehearsal only.',
    representative_position: 'Fictional authorised representative',
    authority_basis: 'Synthetic appointment basis pending independent manual TEST review.',
    documents: ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, i) => document(9, kind, i)),
    test_data_acknowledged: true,
  }
  await admin()
  for (const doc of managerDetails.documents) {
    eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1 and owner_id=$2 and metadata->>'size'=$3 and metadata->>'mimetype'=$4",
      [doc.storage_path, uid(9), String(doc.size), doc.mime_type]), 1, 'preseeded manager evidence matches exact owner and metadata')
  }
  const submittedManager = await entryCommand(9, 'submit_application', {
    application_id: managerAppDraft.id, expected_revision: managerAppDraft.revision, details: managerDetails,
  })
  let managerApp = submittedManager.applications.find(value => value.id === managerAppDraft.id)
  eq(managerApp.status, 'SUBMITTED', 'customer organisation admission is independently reviewable')
  const approvedManager = await scopedCommand(2, reviewer, 'review_application', {
    application_id: managerApp.id, expected_revision: managerApp.revision, decision: 'APPROVED',
    notes: 'Independent synthetic customer organisation admission only; no role is granted.', checks: reviewChecks,
  })
  managerApp = (await entryRead(9)).applications.find(value => value.id === managerApp.id)
  eq(managerApp.status, 'APPROVED', 'customer organisation admission approved')
  truth(managerApp.organisation_id, 'admission creates portal customer organisation')
  eq(managerApp.can_request_mandate, true, 'server exposes first mandate request availability')
  await admin()
  eq(await scalar("select count(*)::int from public.bx1_memberships where user_id=$1 and role='OfferingManager'", [uid(9)]), 0, 'customer admission did not grant OfferingManager')
  eq((await scopedRead(9, applicant)).organisations.some(value => value.id === managerApp.organisation_id), false, 'new customer cannot inherit historical applicant-owner product capability')
  await denied('new admitted applicant cannot create product before separate mandate', () => scopedCommand(9, applicant, 'create_product', { organisation_id: managerApp.organisation_id, terms: terms() }), '42501')
  phase = 'mandate-request-and-queue'
  const mandateRequest = (revision = 0, evidence = 'synthetic-appointment-reference-9-v1') => ({
    application_id: managerApp.id, expected_revision: revision, evidence_reference: evidence,
    requested_until: new Date(Date.now() + 3 * 86400000).toISOString(),
  })
  const firstMandateKey = key(), firstMandateInput = mandateRequest()
  let mandate = (await entryCommand(9, 'request_representative_mandate', firstMandateInput, firstMandateKey)).organisation_mandates[0]
  eq([mandate.status, mandate.role, mandate.effective], ['SUBMITTED', 'OfferingManager', false], 'request creates no operating authority')
  eq((await entryCommand(9, 'request_representative_mandate', firstMandateInput, firstMandateKey)).organisation_mandates[0].id, mandate.id, 'exact retry preserves one mandate case')
  eq((await entryRead(9)).requests.some(value => value.key === firstMandateKey && value.command === 'request_representative_mandate'), true, 'entry request receipt supports interrupted-command recovery')
  eq((await scopedRead(2, reviewer)).mandate_queue_blocked_reason, 'MFA_REQUIRED', 'AAL1 staff sees explicit MFA gate without case metadata')
  eq((await scopedRead(10, roleContext('SuperAdmin'))).mandate_queue_blocked_reason, 'MFA_REQUIRED', 'AAL1 admin sees MFA action rather than false empty queue')
  eq((await scopedRead(5, roleContext('ComplianceOfficer', otherScope))).organisation_mandates.length, 0, 'unrelated organisation sees no mandate evidence')
  await admin()
  for (const n of [2, 10]) {
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(20 + n), uid(n)])
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(20 + n), uid(n)])
  }
  phase = 'mandate-independent-review'
  const approvedChecks = { appointment: true, evidence: true, scope: true }
  const mandateReview = (caseRow, decision = 'APPROVED') => ({
    mandate_id: caseRow.id, expected_revision: caseRow.revision, decision,
    notes: 'Independent synthetic appointment evidence and exact scope reviewed.', checks: approvedChecks,
  })
  eq((await mandateScopedRead(2, reviewer)).organisation_mandates.some(value => value.id === mandate.id), true, 'assured Compliance sees exact scoped case')
  await denied('applicant cannot review own mandate', () => scopedCommand(9, applicant, 'review_representative_mandate', mandateReview(mandate)), '42501')
  mandate = (await mandateScopedCommand(2, reviewer, 'review_representative_mandate', mandateReview(mandate, 'CHANGES_REQUIRED'))).organisation_mandates.find(value => value.id === mandate.id)
  eq((await entryRead(9)).organisation_mandates.find(value => value.id === mandate.id).can_request, true, 'changes required returns case to applicant')
  mandate = (await entryCommand(9, 'request_representative_mandate', mandateRequest(mandate.revision, 'synthetic-appointment-reference-9-v2'))).organisation_mandates[0]
  mandate = (await mandateScopedCommand(2, reviewer, 'review_representative_mandate', mandateReview(mandate))).organisation_mandates.find(value => value.id === mandate.id)
  eq([mandate.status, mandate.effective, mandate.next_owner], ['APPROVED', false, 'SUPER_ADMIN'], 'Compliance approval is not a role grant')
  await admin(); eq(await scalar("select count(*)::int from public.bx1_memberships where user_id=$1 and role='OfferingManager'", [uid(9)]), 0, 'approved mandate still has no native role')
  phase = 'mandate-distinct-apply-and-audit-rollback'
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','ACTIVE')", [uid(2), nativeScope])
  await denied('same human reviewer cannot apply with a second role', () => mandateScopedCommand(2, roleContext('SuperAdmin'), 'apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision }), '42501')
  await denied('unrelated tenant cannot apply', () => scopedCommand(5, roleContext('ComplianceOfficer', otherScope), 'apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision }), '42501')
  await denied('mandatory receipt failure rolls back native organisation and role', async () => {
    await admin()
    await db.query("create function public.synthetic_mandate_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action='apply_representative_mandate' then raise exception 'synthetic_mandate_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_mandate_audit_failure before insert on bx1_portal.representative_mandate_receipts for each row execute function public.synthetic_mandate_audit_failure()")
    await mandateScopedCommand(10, roleContext('SuperAdmin'), 'apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision })
  })
  await admin(); eq(await scalar("select count(*)::int from public.bx1_memberships where user_id=$1 and role='OfferingManager'", [uid(9)]), 0, 'audit failure leaves no native role')
  mandate = (await mandateScopedCommand(10, roleContext('SuperAdmin'), 'apply_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision })).organisation_mandates.find(value => value.id === mandate.id)
  phase = 'mandate-native-authority-and-expiry'
  eq([mandate.status, mandate.effective, mandate.applied_by_user_id], ['APPLIED', true, uid(10)], 'distinct assured admin atomically provisions exact first representative')
  truth(mandate.native_organisation_id, 'new customer has separate native organisation')
  await admin()
  phase = 'mandate-native-membership-lookup'
  const managedMembershipId = await scalar('select native_membership_id from bx1_portal.representative_mandates where id=$1', [mandate.id])
  const afterMandateExpiry = new Date(Date.parse(mandate.requested_until) + 1000).toISOString()
  phase = 'mandate-native-asof-expiry'
  eq(await scalar('select bx1_portal.native_membership_effective_at($1,$2::timestamptz)', [managedMembershipId, afterMandateExpiry]), false, 'passive expiry denies exact native membership without waiting for a job')
  phase = 'mandate-case-asof-expiry'
  eq(await scalar('select bx1_portal.representative_mandate_effective_at($1,$2::timestamptz)', [mandate.id, afterMandateExpiry]), false, 'passive expiry denies reviewed authority at the same instant')
  phase = 'mandate-native-wallet-access'
  await actor(9); eq(await scalar('select bx1_private.can_access_organisation($1::uuid)', [mandate.native_organisation_id]), true, 'effective mandate permits native workspace and wallet organisation')
  phase = 'mandate-native-membership-rls'
  eq(await scalar("select count(*)::int from public.bx1_memberships where organisation_id=$1 and role='OfferingManager'", [mandate.native_organisation_id]), 1, 'effective representative membership visible through RLS')
  phase = 'mandate-workspace-effective-rpc'
  eq((await scalar('select public.bx1_workspace_effective_membership_ids()')).includes(managedMembershipId), true, 'workspace RPC includes only live exact representative membership')
  phase = 'mandate-entry-effective-context'
  eq((await entryRead(9)).contexts.some(value => value.organisation_id === mandate.native_organisation_id && value.roles.includes('OfferingManager')), true, 'entry context shows effective representative')
  phase = 'mandate-scoped-customer-read'
  const managerScoped = await scopedRead(9, roleContext('OfferingManager', mandate.native_organisation_id))
  eq(managerScoped.organisations.some(value => value.id === managerApp.organisation_id), true, 'manager can operate only exact portal organisation')
  eq(managerScoped.organisation_mandates.length, 0, 'OfferingManager role read exposes no staff mandate queue')
  phase = 'mandate-product-handoff'
  const newDraft = (await scopedCommand(9, roleContext('OfferingManager', mandate.native_organisation_id), 'create_product', { organisation_id: managerApp.organisation_id, terms: { ...terms(), name: 'Mandated synthetic draft' } })).products.find(value => value.terms.name === 'Mandated synthetic draft')
  truth(newDraft?.id, 'mandated manager can create draft after apply')
  const inReview = (await scopedCommand(9, roleContext('OfferingManager', mandate.native_organisation_id), 'submit_product', { product_id: newDraft.id, expected_revision: newDraft.revision })).products.find(value => value.id === newDraft.id)
  await denied('customer admission did not silently appoint product Compliance reviewer', () => mandateScopedCommand(2, reviewer, 'review_product', { product_id: inReview.id, expected_revision: inReview.revision, decision: 'APPROVED', notes: 'Synthetic attempt without separately appointed product Compliance scope.', checks: offeringChecks }), '42501')
  phase = 'mandate-revocation'
  const revokedMandate = (await mandateScopedCommand(2, reviewer, 'revoke_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision, reason: 'Synthetic reviewed authority withdrawn after demonstration.' })).organisation_mandates.find(value => value.id === mandate.id)
  eq([revokedMandate.status, revokedMandate.effective], ['REVOKED', false], 'scoped revocation removes mandate authority')
  await admin(); eq(await scalar("select status from public.bx1_memberships where id=(select native_membership_id from bx1_portal.representative_mandates where id=$1)", [mandate.id]), 'SUSPENDED', 'exact native membership suspended on revoke')
  eq(await scalar("select status from bx1_portal.organisation_authority_bindings where id=(select authority_binding_id from bx1_portal.representative_mandates where id=$1)", [mandate.id]), 'REVOKED', 'exact portal authority binding revoked')
  await actor(9); eq(await scalar('select bx1_private.can_access_organisation($1::uuid)', [mandate.native_organisation_id]), false, 'revoked representative loses native workspace and wallet organisation')
  eq(await scalar("select count(*)::int from public.bx1_memberships where organisation_id=$1 and role='OfferingManager'", [mandate.native_organisation_id]), 0, 'revoked representative role hidden through RLS')
  eq((await scalar('select public.bx1_workspace_effective_membership_ids()')).includes(managedMembershipId), false, 'revoked representative excluded from workspace authority RPC')
  eq((await entryRead(9)).contexts.some(value => value.organisation_id === mandate.native_organisation_id), false, 'revoked representative removed from entry contexts')
  await denied('revoked manager cannot continue existing product draft', () => scopedCommand(9, roleContext('OfferingManager', mandate.native_organisation_id), 'save_product', { product_id: inReview.id, expected_revision: inReview.revision, terms: terms() }), '42501')
  await admin()
  phase = 'document-receipt-proof'
  await sqlFile('../../../supabase/migrations/20260923144216_stage2_document_receipts.sql')
  await sqlFile('../../../supabase/tests/bx1_document_receipts.sql')
  phase = 'document-history-migration'
  await sqlFile('../../../supabase/migrations/20260923161500_stage2_application_document_history.sql')
  await sqlFile('../../../supabase/tests/bx1_application_document_history.sql')
  phase = 'document-history-caller-bound-proof'
  const historyContext = JSON.stringify(applicant)
  const reviewerContext = JSON.stringify(reviewer)
  const ownHistory = await (async () => {
    await actor(9)
    return scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [managerApp.id, historyContext])
  })()
  eq(ownHistory.application_id, managerApp.id, 'applicant reads only its exact application history')
  eq(ownHistory.versions.length, 1, 'submitted customer application has one immutable revision manifest')
  eq(JSON.stringify(ownHistory).includes('storage_path'), false, 'broad revision list never exposes Storage paths')
  const ownVersion = ownHistory.versions[0]
  eq(ownVersion.documents[0].claimed_sha256, managerDetails.documents[0].sha256, 'historic hash is explicitly a claim')
  await actor(9)
  const ownDocument = await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
    [managerApp.id, ownVersion.revision, ownVersion.documents[0].id, historyContext])
  eq(ownDocument.storage_path, managerDetails.documents[0].storage_path, 'exact revision and document ID resolve DB-owned Storage path')
  eq(ownDocument.claimed_sha256, managerDetails.documents[0].sha256, 'lookup does not invent verified-byte evidence')
  await actor(9)
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [ownDocument.storage_path]), 1, 'unenrolled applicant retains direct access to own uploaded evidence')
  await db.query('savepoint enrolled_owner_storage')
  await admin()
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(39), uid(9)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(39), uid(9)])
  await actor(9)
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [ownDocument.storage_path]), 0, 'enrolled applicant AAL1 JWT cannot read direct Storage even with AAL2 session')
  await denied('enrolled applicant AAL1 JWT cannot enumerate historic manifests', async () => {
    await actor(9)
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [managerApp.id, historyContext])
  }, '42501')
  await actor(9, { aal: 'aal2' })
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [ownDocument.storage_path]), 1, 'enrolled applicant with AAL2 JWT retains own evidence access')
  await db.query('rollback to savepoint enrolled_owner_storage; release savepoint enrolled_owner_storage')
  await denied('another applicant cannot enumerate customer history', async () => {
    await actor(3)
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [managerApp.id, historyContext])
  }, '42501')
  await denied('other applicant cannot discover a historical Storage path', async () => {
    await actor(3)
    await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
      [managerApp.id, ownVersion.revision, ownVersion.documents[0].id, historyContext])
  }, '42501')
  await denied('unknown application does not reveal whether it exists', async () => {
    await actor(9)
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [uid(99), historyContext])
  }, '42501')
  await denied('wrong revision cannot resolve a current document path', async () => {
    await actor(9)
    await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
      [managerApp.id, ownVersion.revision + 1, ownVersion.documents[0].id, historyContext])
  }, 'P0002')
  await denied('wrong document ID cannot resolve another version path', async () => {
    await actor(9)
    await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
      [managerApp.id, ownVersion.revision, uid(99), historyContext])
  }, 'P0002')
  await denied('real document ID from another application cannot resolve this version path', async () => {
    await actor(9)
    await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
      [managerApp.id, ownVersion.revision, 'ed200000-0000-4000-8000-000000000001', historyContext])
  }, 'P0002')
  await denied('submitted revision manifest cannot be rewritten', async () => {
    await admin()
    await db.query("update bx1_portal.application_detail_versions set details='{}'::jsonb where application_id=$1 and application_revision=$2", [managerApp.id, ownVersion.revision])
  }, '23514')
  const receiptApplication = 'ed300000-0000-4000-8000-000000000001'
  const receiptDocument = 'ed200000-0000-4000-8000-000000000001'
  await actor(2, { aal: 'aal2' })
  const reviewerHistory = await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [receiptApplication, reviewerContext])
  eq(reviewerHistory.versions.length, 1, 'assured Compliance sees only exact submitted application history')
  await actor(2, { aal: 'aal2' })
  const reviewerDocument = await scalar('select public.bx1_application_document_lookup($1::uuid,$2::integer,$3::uuid,$4::jsonb)',
    [receiptApplication, reviewerHistory.versions[0].revision, receiptDocument, reviewerContext])
  eq(reviewerDocument.id, receiptDocument, 'reviewer lookup binds document UUID to immutable revision')
  await actor(2)
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [reviewerDocument.storage_path]), 0, 'AAL1 Compliance cannot bypass history RPC through direct Storage')
  await actor(2, { aal: 'aal2' })
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [reviewerDocument.storage_path]), 1, 'AAL2 appointed Compliance can read an immutable historic-version object')
  await db.query('savepoint immutable_history_only_storage')
  await admin()
  await db.query("update bx1_portal.applications set status='CHANGES_REQUIRED',details=pg_catalog.jsonb_set(details,'{documents}','[]'::jsonb) where id=$1", [receiptApplication])
  await actor(2, { aal: 'aal2' })
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [reviewerDocument.storage_path]), 1, 'historic object stays readable from immutable version after current manifest changes')
  await db.query('rollback to savepoint immutable_history_only_storage; release savepoint immutable_history_only_storage')
  await actor(5, { aal: 'aal2' })
  eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
    [reviewerDocument.storage_path]), 0, 'other organisation cannot use direct Storage to read historic case')
  await denied('AAL1 Compliance cannot read private historic manifests', async () => {
    await actor(2)
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [receiptApplication, reviewerContext])
  }, '42501')
  await denied('wrong organisation context cannot read historic case', async () => {
    await actor(2, { aal: 'aal2' })
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)',
      [receiptApplication, JSON.stringify(roleContext('ComplianceOfficer', otherScope))])
  }, '42501')
  await denied('SuperAdmin role is not a document reviewer appointment', async () => {
    await actor(10, { aal: 'aal2' })
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)',
      [receiptApplication, JSON.stringify(roleContext('SuperAdmin'))])
  }, '42501')
  await denied('revoked Compliance membership loses historic document access', async () => {
    await admin()
    await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and organisation_id=$2 and role='ComplianceOfficer'", [uid(2), nativeScope])
    await actor(2, { aal: 'aal2' })
    eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
      [reviewerDocument.storage_path]), 0, 'revoked Compliance cannot read direct Storage')
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [receiptApplication, reviewerContext])
  }, '42501')
  await denied('expired reviewer session loses historic document access', async () => {
    await admin()
    await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=$1", [uid(2)])
    await actor(2, { aal: 'aal2' })
    eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
      [reviewerDocument.storage_path]), 0, 'expired reviewer session cannot read direct Storage')
    await scalar('select public.bx1_application_document_versions($1::uuid,$2::jsonb)', [receiptApplication, reviewerContext])
  }, '42501')
  phase = 'entity-investment-account-migration'
  await admin()
  const individualAccountsBeforeEntity = await scalar("select count(*)::int from bx1_portal.investment_accounts where kind='INDIVIDUAL'")
  const individualOrdersBeforeEntity = await scalar('select count(*)::int from bx1_portal.subscriptions')
  await sqlFile('../../../supabase/migrations/20260923171126_stage2_entity_investment_accounts.sql')
  await sqlFile('../../../supabase/migrations/20260923175822_stage2_superadmin_shell_mfa_boundary.sql')
  await sqlFile('../../../supabase/tests/bx1_entity_investment_accounts.sql')
  eq(await scalar("select count(*)::int from bx1_portal.investment_accounts where kind='INDIVIDUAL'"), individualAccountsBeforeEntity, 'entity migration preserves individual investment accounts')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), individualOrdersBeforeEntity, 'entity migration preserves historical orders')
  eq(await scalar('select bx1_portal.entity_people_independent($1::uuid,$2::uuid)', [uid(9), uid(2)]), true, 'trusted distinct synthetic people pass independent-person gate')
  eq(await scalar('select bx1_portal.entity_people_independent($1::uuid,$2::uuid)', [uid(9), uid(11)]), false, 'missing person mapping cannot prove independence')
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-same-human-reviewer@example.invalid',clock_timestamp(),false)", [uid(11)])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(11), uid(11)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic same-human reviewer')", [uid(11)])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:same-human-principal-11',$3)", [uid(11), uid(30), uid(32)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'ComplianceOfficer','ACTIVE')", [uid(11), nativeScope])
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-unenrolled-admin@example.invalid',clock_timestamp(),false)", [uid(12)])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(12), uid(12)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic unenrolled Super Admin')", [uid(12)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','ACTIVE')", [uid(12), nativeScope])
  eq(await scalar('select bx1_portal.entity_people_independent($1::uuid,$2::uuid)', [uid(9), uid(11)]), false, 'distinct TEST emails mapped to same trusted human cannot be independent')
  phase = 'entity-investor-admission'
  const entityEvidence = ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, index) => ({
    id: `ed400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind, title: `Synthetic legal-entity ${kind} and appointment evidence`,
    storage_path: `${uid(9)}/ed400000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, sha256: 'b'.repeat(64),
    size: 100, mime_type: 'application/pdf',
  }))
  for (const doc of entityEvidence) await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb)", [doc.storage_path, uid(9)])
  const entityDetails = { ...details(9, true), company_name: 'Synthetic Entity Investor Nine', registration_reference: 'SYNTHETIC-ENTITY-9', documents: entityEvidence }
  const entityStart = await entryCommand(9, 'start_application', { persona: 'INVESTOR' })
  let entityApp = entityStart.applications.find(value => value.user_id === uid(9) && value.persona === 'INVESTOR')
  truth(entityApp?.id, 'same person adds a distinct entity-investor application without merging manager admission')
  await db.query('savepoint entity_draft_review_scope')
  await admin()
  await db.query('update bx1_portal.applications set reviewer_scope=$1 where id=$2', [nativeScope, entityApp.id])
  const draftEventId = (await db.query("insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary) values($1,$1,'synthetic_draft_marker',$2,'Synthetic unsubmitted draft event') returning id", [entityApp.id, uid(9)])).rows[0].id
  const reviewerDraftProjection = await mandateScopedRead(2, reviewer)
  eq(reviewerDraftProjection.applications.some(value => value.id === entityApp.id), false, 'assured staff cannot read an unsubmitted customer draft even if reviewer scope is set')
  eq(reviewerDraftProjection.events.some(value => value.id === draftEventId), false, 'assured staff cannot read unsubmitted customer draft event metadata')
  await db.query('rollback to savepoint entity_draft_review_scope; release savepoint entity_draft_review_scope')
  const entitySubmitted = await entryCommand(9, 'submit_application', { application_id: entityApp.id, expected_revision: entityApp.revision, details: entityDetails })
  entityApp = entitySubmitted.applications.find(value => value.id === entityApp.id)
  await mandateScopedCommand(2, reviewer, 'review_application', { application_id: entityApp.id,
    expected_revision: entityApp.revision, decision: 'APPROVED',
    notes: 'Independent synthetic entity identity, ownership, screening and suitability review.', checks: reviewChecks })
  entityApp = (await scopedRead(9, applicant)).applications.find(value => value.id === entityApp.id)
  eq([entityApp.status, entityApp.can_create_entity_account], ['APPROVED', true], 'reviewed entity application enables an account, not investing authority')
  await denied('unenrolled AAL1 Compliance cannot read an approved entity source application',
    () => scopedRead(11, reviewer), '42501')
  await db.query('savepoint entity_scope_pause')
  await admin(); await db.query('update bx1_portal.entry_configuration set manual_test_review=false,reviewer_scope=$1 where singleton', [otherScope])
  await actor(9); await admin()
  eq(await scalar('select bx1_portal.entity_application_account_openable($1::uuid)', [entityApp.id]), false, 'scope rotation or admission pause removes entity-account affordance')
  await db.query('rollback to savepoint entity_scope_pause; release savepoint entity_scope_pause')
  await denied('entity account cannot be opened from a different application owner', () => scopedCommand(3, applicant, 'create_entity_investment_account', { application_id: entityApp.id }), '42501')
  const entityAccountKey = key()
  const entityAccountResult = await scopedCommand(9, applicant, 'create_entity_investment_account', { application_id: entityApp.id }, entityAccountKey)
  const entityAccount = entityAccountResult.entity_investment_accounts.find(value => value.application_id === entityApp.id)
  truth(entityAccount?.id, 'approved synthetic entity produces one legal-party investment account')
  eq([entityAccount.kind, entityAccount.can_view, entityAccount.can_request_mandate], ['ENTITY', false, true], 'account creation alone grants no representative view or transaction')
  eq((await scopedCommand(9, applicant, 'create_entity_investment_account', { application_id: entityApp.id }, entityAccountKey)).entity_investment_accounts.length,
    entityAccountResult.entity_investment_accounts.length, 'exact entity account retry is idempotent')
  await denied('new request key cannot duplicate the legal party/account', () => scopedCommand(9, applicant, 'create_entity_investment_account', { application_id: entityApp.id }), '42501')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.legal_entity_parties where application_id=$1', [entityApp.id]), 1, 'one immutable legal party binds approved application')
  eq(await scalar('select count(*)::int from bx1_portal.investment_accounts where application_id=$1 and kind=\'ENTITY\' and holder_user_id is null', [entityApp.id]), 1, 'entity uses same account authority without individual holder')
  await actor(9); await admin()
  eq(await scalar('select auth.uid()'), uid(9), 'private semantic guard is evaluated with applicant JWT despite postgres test role')
  eq(await scalar('select bx1_portal.account_usable($1::jsonb,$2::uuid)', [JSON.stringify(applicant), entityAccount.id]), false, 'entity account cannot pass individual subscription guard')
  await denied('entity account cannot submit an individual subscription', () => scopedCommand(9, applicant, 'subscribe', { ...subscribe(scopedFund, '1'), investment_account_id: entityAccount.id }), '42501')
  phase = 'entity-representative-review-and-apply'
  const entityRequestBody = (revision = 0) => ({ investment_account_id: entityAccount.id,
    expected_revision: revision, evidence_reference: 'Synthetic board appointment is recorded in the reviewed company evidence.',
    appointment_document_id: entityEvidence[1].id, requested_until: new Date(Date.now() + 3 * 86400000).toISOString() })
  const entityRequestKey = key(), entityRequest = entityRequestBody()
  let entityMandate = (await scopedCommand(9, applicant, 'request_investing_representative_mandate', entityRequest, entityRequestKey)).investing_representative_mandates[0]
  eq([entityMandate.status, entityMandate.effective, entityMandate.transaction_limit_minor], ['SUBMITTED', false, '0'], 'request has zero trading limit and no authority')
  eq((await scopedCommand(9, applicant, 'request_investing_representative_mandate', entityRequest, entityRequestKey)).investing_representative_mandates[0].id,
    entityMandate.id, 'exact representative request retry is idempotent')
  await denied('enrolled AAL1 Compliance cannot enter the scoped portal to enumerate entity mandates',
    () => scopedRead(2, reviewer), '42501')
  const unenrolledAdminShell = await scopedRead(12, roleContext('SuperAdmin'))
  eq([unenrolledAdminShell.actor.id, unenrolledAdminShell.applications.length,
    unenrolledAdminShell.organisation_mandates.length, unenrolledAdminShell.investing_representative_mandates.length,
    unenrolledAdminShell.entity_mandate_queue_available, unenrolledAdminShell.entity_mandate_queue_blocked_reason],
    [uid(12), 0, 0, 0, false, 'MFA_REQUIRED'], 'unenrolled AAL1 Super Admin reaches shell without customer case details')
  eq((await mandateScopedRead(2, reviewer)).investing_representative_mandates.some(value => value.id === entityMandate.id), true, 'AAL2 appointed Compliance sees exact entity case')
  await admin()
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(42), uid(5)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(42), uid(5)])
  eq((await mandateScopedRead(5, roleContext('ComplianceOfficer', otherScope))).investing_representative_mandates.length, 0, 'unrelated organisation cannot read entity mandate')
  const entityChecks = { appointment: true, legal_entity: true, scope: true }
  const entityReview = (row, decision) => ({ mandate_id: row.id, expected_revision: row.revision, decision,
    notes: 'Independent synthetic appointment, legal entity, and restricted scope reviewed.', checks: entityChecks })
  await denied('unenrolled AAL1 Compliance cannot decide an entity representative case', () => scopedCommand(11, reviewer,
    'review_investing_representative_mandate', entityReview(entityMandate, 'APPROVED')), '42501')
  await admin()
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(41), uid(11)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(41), uid(11)])
  await denied('same human under separate assured Compliance login cannot review entity mandate', () => mandateScopedCommand(11, reviewer,
    'review_investing_representative_mandate', entityReview(entityMandate, 'APPROVED')), '42501')
  entityMandate = (await mandateScopedCommand(2, reviewer, 'review_investing_representative_mandate', entityReview(entityMandate, 'CHANGES_REQUIRED'))).investing_representative_mandates.find(value => value.id === entityMandate.id)
  eq(entityMandate.next_owner, 'APPLICANT', 'changes-required returns the same case to applicant')
  const unsubmittedAppointmentId = 'ed400000-0000-4000-8000-000000000004'
  await admin(); await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb)", [`${uid(9)}/${unsubmittedAppointmentId}`, uid(9)])
  await denied('new uploaded COMPANY object is not correction evidence until approved admission versions it', () => scopedCommand(9, applicant,
    'request_investing_representative_mandate', { ...entityRequestBody(entityMandate.revision), appointment_document_id: unsubmittedAppointmentId }), '42501')
  const correctedExplanation = 'Synthetic board appointment provision and signed authority are in the reviewed company evidence.'
  entityMandate = (await scopedCommand(9, applicant, 'request_investing_representative_mandate', {
    ...entityRequestBody(entityMandate.revision), evidence_reference: correctedExplanation,
  })).investing_representative_mandates.find(value => value.id === entityMandate.id)
  eq([entityMandate.evidence_reference, entityMandate.appointment_document_id], [correctedExplanation, entityEvidence[1].id], 'same-cycle correction changes explanation while retaining approved evidence')
  entityMandate = (await mandateScopedCommand(2, reviewer, 'review_investing_representative_mandate', entityReview(entityMandate, 'APPROVED'))).investing_representative_mandates.find(value => value.id === entityMandate.id)
  eq([entityMandate.status, entityMandate.effective], ['APPROVED', false], 'Compliance approval alone grants no representative authority')
  await denied('AAL1 Super Admin cannot apply approved representative mandate', () => scopedCommand(10, roleContext('SuperAdmin'),
    'apply_investing_representative_mandate', { mandate_id: entityMandate.id, expected_revision: entityMandate.revision }), '42501')
  await denied('reviewing human cannot apply with another role', () => mandateScopedCommand(2, roleContext('SuperAdmin'), 'apply_investing_representative_mandate', { mandate_id: entityMandate.id, expected_revision: entityMandate.revision }), '42501')
  await denied('mandatory audit failure rolls back representative apply', async () => {
    await admin()
    await db.query("create function public.synthetic_entity_audit_failure() returns trigger language plpgsql as $$ begin if NEW.kind='apply_investing_representative_mandate' then raise exception 'synthetic_entity_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_entity_audit_failure before insert on bx1_portal.events for each row execute function public.synthetic_entity_audit_failure()")
    await mandateScopedCommand(10, roleContext('SuperAdmin'), 'apply_investing_representative_mandate', { mandate_id: entityMandate.id, expected_revision: entityMandate.revision })
  }, '23514')
  await admin(); eq(await scalar('select status from bx1_portal.investing_representative_mandates where id=$1', [entityMandate.id]), 'APPROVED', 'failed mandatory audit leaves mandate unapplied')
  entityMandate = (await mandateScopedCommand(10, roleContext('SuperAdmin'), 'apply_investing_representative_mandate', { mandate_id: entityMandate.id, expected_revision: entityMandate.revision })).investing_representative_mandates.find(value => value.id === entityMandate.id)
  eq([entityMandate.status, entityMandate.effective, entityMandate.transaction_limit_minor], ['APPLIED', true, '0'], 'third trusted human applies restricted account mandate')
  eq((await scopedRead(9, applicant)).entity_investment_accounts.find(value => value.id === entityAccount.id).can_view, true, 'applied representative gains current account view')
  entityMandate = (await mandateScopedCommand(2, reviewer, 'revoke_investing_representative_mandate', { mandate_id: entityMandate.id,
    expected_revision: entityMandate.revision, reason: 'Synthetic appointment withdrawn with immediate restricted access removal.' })).investing_representative_mandates.find(value => value.id === entityMandate.id)
  eq([entityMandate.status, entityMandate.effective], ['REVOKED', false], 'revocation removes entity mandate immediately')
  eq((await scopedRead(9, applicant)).entity_investment_accounts.find(value => value.id === entityAccount.id).can_view, false, 'revoked representative loses account view')
  eq((await scopedRead(9, applicant)).entity_investment_accounts.find(value => value.id === entityAccount.id).can_request_mandate, true, 'current admission may request a fresh cycle after revocation')
  const renewed = (await scopedCommand(9, applicant, 'request_investing_representative_mandate', entityRequestBody(0))).investing_representative_mandates.find(value => value.cycle === 2)
  truth(renewed?.id && renewed.id !== entityMandate.id, 'reappointment starts a new case and preserves revoked cycle')
  eq([renewed.status, renewed.effective], ['SUBMITTED', false], 'fresh cycle does not resurrect revoked authority')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.investing_representative_receipts where mandate_id=$1', [entityMandate.id]), 6, 'request, resubmission, decisions, apply and revoke have immutable receipts')
  eq(await scalar('select count(*)::int from bx1_portal.investing_representative_receipts where mandate_id=$1', [renewed.id]), 1, 'new cycle has its own initial audit receipt')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), individualOrdersBeforeEntity, 'entity workflow creates no order or funding record')
  phase = 'immutable-offering-package-cutover'
  await admin()
  const legacyProductsBeforeOffering = await scalar('select count(*)::int from bx1_portal.products')
  const legacyOrdersBeforeOffering = await scalar('select count(*)::int from bx1_portal.subscriptions')
  await sqlFile('../../../supabase/migrations/20260923205519_stage3_immutable_offering_packages.sql')
  eq(await scalar('select count(*)::int from bx1_portal.products'), legacyProductsBeforeOffering, 'offering migration preserves product IDs')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), legacyOrdersBeforeOffering, 'offering migration preserves accepted orders')
  eq(await scalar("select count(*)::int from bx1_portal.offering_decisions"), 0, 'historical Compliance labels are not invented issuer or package approvals')
  eq(await scalar("select count(*)::int from bx1_portal.offering_revisions where origin='LEGACY_PRODUCT_SNAPSHOT'"), legacyProductsBeforeOffering, 'each historical product has immutable snapshot, not a current package')
  eq(await scalar("select count(*)::int from bx1_portal.offering_revisions where origin='LEGACY_ORDER_SNAPSHOT'"), legacyOrdersBeforeOffering, 'each accepted order has its own terms snapshot')
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions where offering_revision_id is null'), 0, 'historical orders map to immutable legacy snapshots without changing original references')
  await denied('accepted order cannot be pointed at a different offering snapshot', async () => {
    await admin(); await db.query('update bx1_portal.subscriptions set offering_revision_id=$1 where id=(select id from bx1_portal.subscriptions order by created_at,id limit 1)', [key()])
  }, '23514')
  const historicalOrder = (await scopedRead(3, investor)).subscriptions.find(value => value.product_id === scopedFund.id)
  truth(historicalOrder?.offering_revision_id, 'investor still reads historical accepted order and its new non-authoritative snapshot ID')
  const historicalManagerProduct = (await scopedRead(1, manager)).products.find(value => value.id === scopedFund.id)
  eq(historicalManagerProduct.offering_package, null, 'historical published product has no newly inferred current approved package')
  eq(historicalManagerProduct.offering_history[0].origin, 'LEGACY_PRODUCT_SNAPSHOT', 'operator can inspect preserved legacy history')
  eq((await scopedRead(3, investor)).products.some(value => value.id === scopedFund.id), false, 'historic PUBLISHED label is no longer marketed as an open offering')
  await denied('historic product cannot create a new order without exact package', () => scopedCommand(3, investor, 'subscribe', {
    ...subscribe(scopedFund, '1'), investment_account_id: account3.id, offering_revision_id: historicalManagerProduct.offering_history[0].id,
  }), '23514')
  await denied('pre-offering delegate cannot be called by authenticated actor', async () => {
    await actor(1); await scalar('select bx1_portal.execute_scoped_pre_offering($1::jsonb,$2,$3,$4::jsonb)',
      [JSON.stringify(manager), 'publish_product', key(), JSON.stringify({ product_id: scopedFund.id, expected_revision: scopedFund.revision })])
  }, '42501')
  for (const table of ['offering_revisions', 'offering_decisions']) {
    for (const role of ['anon', 'authenticated', 'service_role'])
      eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')', [role, `bx1_portal.${table}`]), false, `${role} no direct ${table}`)
  }
  phase = 'new-exact-fund-and-property-packages'
  // New synthetic humans and appointments exist ONLY in this disposable cloud
  // transaction. New customer organisations do not inherit an issuer.
  await admin()
  await db.query("update public.bx1_memberships set status='ACTIVE' where user_id=$1 and organisation_id=$2 and role='ComplianceOfficer'", [uid(2), nativeScope])
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-issuer-13@example.invalid',clock_timestamp(),false)", [uid(13)])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(13), uid(13)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic independently appointed issuer')", [uid(13)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'IssuerFundManager','ACTIVE')", [uid(13), nativeScope])
  await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Synthetic independent issuer human','TRUSTED','synthetic:test-human-13',$2)", [uid(33), uid(34)])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:test-principal-13',$3)", [uid(13), uid(33), uid(34)])
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(43), uid(13)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(43), uid(13)])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'IssuerFundManager','ACTIVE')", [uid(4), nativeScope])
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [sid(44), uid(4)])
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where user_id=$2", [sid(44), uid(4)])
  await db.query("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'ComplianceOfficer','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','synthetic-cloud-proof:offering-compliance',$3)", [orgId, nativeScope, key()])
  await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [timedBinding])
  const issuerContext = roleContext('IssuerFundManager')
  const issuerChecks = { issuer_authority: true, terms: true, rights: true }
  const issuerInput = (product, decision = 'APPROVED') => ({ product_id: product.id, expected_revision: product.revision,
    offering_revision_id: product.offering_package.id, terms_hash: product.offering_package.terms_hash,
    decision, notes: 'Synthetic appointed issuer reviewed exact immutable test package.', checks: issuerChecks })
  const complianceInput = (product, decision = 'APPROVED') => ({ product_id: product.id, expected_revision: product.revision,
    offering_revision_id: product.offering_package.id, terms_hash: product.offering_package.terms_hash,
    decision, notes: 'Synthetic independent Compliance decision on exact offering package.', checks: offeringChecks })
  let fundPackage = (await scopedCommand(1, manager, 'create_product', { organisation_id: orgId,
    terms: { ...terms('FUND'), name: 'Exact synthetic fund package v1' } })).products.find(value => value.terms.name === 'Exact synthetic fund package v1')
  fundPackage = (await scopedCommand(1, manager, 'submit_product', { product_id: fundPackage.id, expected_revision: fundPackage.revision })).products.find(value => value.id === fundPackage.id)
  truth(fundPackage.offering_package?.id, 'fund submission creates immutable exact package ID')
  eq(fundPackage.offering_package.document_hashes.memorandum.length, 64, 'fund disclosure text is hashed in exact package')
  await denied('no issuer binding means no issuer decision', () => mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(fundPackage)), '42501')
  await admin()
  const issuerBindingId = (await db.query("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'IssuerFundManager','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','synthetic-cloud-proof:offering-issuer',$3) returning id", [orgId, nativeScope, key()])).rows[0].id
  await denied('same human under second issuer login cannot approve own package', () => mandateScopedCommand(4, issuerContext,
    'review_offering_issuer', issuerInput(fundPackage)), '42501')
  await denied('wrong issuer organisation cannot approve', () => mandateScopedCommand(13, roleContext('IssuerFundManager', otherScope),
    'review_offering_issuer', issuerInput(fundPackage)), '42501')
  await denied('stale issuer package ID rejected', () => mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', { ...issuerInput(fundPackage), offering_revision_id: key() }), '23514')
  await denied('wrong Compliance terms hash rejected', () => mandateScopedCommand(2, reviewer,
    'review_product', { ...complianceInput(fundPackage), terms_hash: 'b'.repeat(64) }), '23514')
  fundPackage = (await mandateScopedCommand(13, issuerContext, 'review_offering_issuer', issuerInput(fundPackage, 'CHANGES_REQUIRED'))).products.find(value => value.id === fundPackage.id)
  eq([fundPackage.status, fundPackage.offering_package.issuer_status], ['CHANGES_REQUIRED', 'CHANGES_REQUIRED'], 'issuer changes-required returns fund to manager')
  const firstFundRevision = fundPackage.offering_package.id
  await denied('changes-required cannot be resubmitted unchanged', () => scopedCommand(1, manager,
    'submit_product', { product_id: fundPackage.id, expected_revision: fundPackage.revision }), '23514')
  fundPackage = (await scopedCommand(1, manager, 'save_product', { product_id: fundPackage.id,
    expected_revision: fundPackage.revision, terms: { ...terms('FUND'), name: 'Exact synthetic fund package v1' } })).products.find(value => value.id === fundPackage.id)
  await denied('save of identical terms does not evade package revision gate', () => scopedCommand(1, manager,
    'submit_product', { product_id: fundPackage.id, expected_revision: fundPackage.revision }), '23514')
  fundPackage = (await scopedCommand(1, manager, 'save_product', { product_id: fundPackage.id,
    expected_revision: fundPackage.revision, terms: { ...terms('FUND'), name: 'Exact synthetic fund package v2' } })).products.find(value => value.id === fundPackage.id)
  eq(fundPackage.offering_package, null, 'saved amendment clears active package without mutating old snapshot')
  fundPackage = (await scopedCommand(1, manager, 'submit_product', { product_id: fundPackage.id, expected_revision: fundPackage.revision })).products.find(value => value.id === fundPackage.id)
  truth(fundPackage.offering_package.id !== firstFundRevision, 'amendment creates a new immutable package ID')
  eq(fundPackage.offering_history.find(value => value.id === firstFundRevision).issuer_status, 'CHANGES_REQUIRED', 'old decision remains with old package only')
  eq(fundPackage.offering_package.issuer_status, 'PENDING', 'new fund package inherits no approval')
  fundPackage = (await mandateScopedCommand(13, issuerContext, 'review_offering_issuer', issuerInput(fundPackage))).products.find(value => value.id === fundPackage.id)
  eq(fundPackage.status, 'IN_REVIEW', 'issuer-only approval is not whole-offering approval')
  fundPackage = (await mandateScopedCommand(2, reviewer, 'review_product', complianceInput(fundPackage))).products.find(value => value.id === fundPackage.id)
  eq([fundPackage.status, fundPackage.offering_package.issuer_status, fundPackage.offering_package.compliance_status],
    ['APPROVED', 'APPROVED', 'APPROVED'], 'two independent exact fund decisions complete business review')
  eq([fundPackage.offering_package.technical_readiness_status, fundPackage.offering_package.publishable],
    ['NOT_VERIFIED', false], 'business approval does not fabricate chain readiness')
  await db.query('savepoint issuer_revocation_projection')
  await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [issuerBindingId])
  const revokedIssuerPackage = (await scopedRead(1, manager)).products.find(value => value.id === fundPackage.id).offering_package
  eq([revokedIssuerPackage.issuer_status, revokedIssuerPackage.status, revokedIssuerPackage.publishable],
    ['APPROVED', 'AUTHORITY_EXPIRED', false], 'historic issuer decision remains visible but revocation removes current approval')
  await db.query('rollback to savepoint issuer_revocation_projection; release savepoint issuer_revocation_projection')
  await denied('publication cannot smuggle changed terms during status transition', async () => {
    await admin(); await db.query("update bx1_portal.products set status='PUBLISHED',terms=jsonb_set(terms,'{name}','\"Smuggled substitute\"') where id=$1", [fundPackage.id])
  }, '23514')
  await denied('fund cannot publish without independent technical readiness', () => scopedCommand(1, manager,
    'publish_product', { product_id: fundPackage.id, expected_revision: fundPackage.revision }), '23514')
  await denied('fund investor cannot subscribe to approved but unopened package', () => scopedCommand(3, investor,
    'subscribe', { ...subscribe(fundPackage, '1'), investment_account_id: account3.id,
      offering_revision_id: fundPackage.offering_package.id }), '42501')
  let propertyPackage = (await scopedCommand(1, manager, 'create_product', { organisation_id: orgId,
    terms: { ...terms('REAL_ESTATE'), name: 'Exact synthetic property package' } })).products.find(value => value.terms.name === 'Exact synthetic property package')
  propertyPackage = (await scopedCommand(1, manager, 'submit_product', { product_id: propertyPackage.id, expected_revision: propertyPackage.revision })).products.find(value => value.id === propertyPackage.id)
  propertyPackage = (await mandateScopedCommand(2, reviewer, 'review_product', complianceInput(propertyPackage))).products.find(value => value.id === propertyPackage.id)
  eq(propertyPackage.status, 'IN_REVIEW', 'Compliance-only property approval remains under review')
  propertyPackage = (await mandateScopedCommand(13, issuerContext, 'review_offering_issuer', issuerInput(propertyPackage))).products.find(value => value.id === propertyPackage.id)
  eq([propertyPackage.status, propertyPackage.offering_package.compliance_status, propertyPackage.offering_package.issuer_status],
    ['APPROVED', 'APPROVED', 'APPROVED'], 'property supports reverse decision order on its exact package')
  await denied('property cannot publish without independent technical readiness', () => scopedCommand(1, manager,
    'publish_product', { product_id: propertyPackage.id, expected_revision: propertyPackage.revision }), '23514')
  phase = 'appointed-issuer-new-customer-organisation-visibility'
  // Stage 2 revoked this customer's manager mandate. Its submitted draft is
  // intentionally a LEGACY snapshot after cutover. In this disposable fixture
  // only, attach one exact synthetic SUBMITTED package to that existing draft
  // to isolate the new issuer read/decision contract without reviving mandate.
  await admin()
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'IssuerFundManager','ACTIVE')", [uid(13), mandate.native_organisation_id])
  const customerIssuerContext = roleContext('IssuerFundManager', mandate.native_organisation_id)
  eq((await mandateScopedRead(13, customerIssuerContext)).products.some(value => value.id === inReview.id), false,
    'native issuer membership alone never exposes a customer product')
  await admin()
  const customerIssuerBindingId = await scalar("insert into bx1_portal.organisation_authority_bindings(product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id) values($1,$2,'IssuerFundManager','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','synthetic-cloud-proof:customer-issuer',$3) returning id", [managerApp.organisation_id, mandate.native_organisation_id, key()])
  const customerPackageId = await scalar(`insert into bx1_portal.offering_revisions(product_id,package_number,origin,
    product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)
    select p.id,2,'SUBMITTED',p.revision,p.terms,p.terms_hash,
      bx1_portal.offering_document_hashes(p.terms),p.created_by,clock_timestamp()
    from bx1_portal.products p where p.id=$1 returning id`, [inReview.id])
  await db.query('update bx1_portal.products set current_offering_revision_id=$1 where id=$2', [customerPackageId, inReview.id])
  let customerIssuerState = await mandateScopedRead(13, customerIssuerContext)
  eq(customerIssuerState.organisations.some(value => value.id === managerApp.organisation_id), true,
    'appointed issuer sees exact new customer organisation as read-only scope')
  let customerIssuerProduct = customerIssuerState.products.find(value => value.id === inReview.id)
  eq(customerIssuerProduct?.offering_package?.id, customerPackageId,
    'appointed issuer sees exact submitted customer package in shared portal')
  eq(customerIssuerProduct.allowed_actions.includes('review_offering_issuer'), true,
    'new customer issuer sees its exact review action')
  for (const forbidden of ['create_product','save_product','submit_product','publish_product','read_orders'])
    eq(customerIssuerState.organisations.find(value => value.id === managerApp.organisation_id).capabilities.includes(forbidden), false,
      `issuer appointment does not grant ${forbidden}`)
  customerIssuerState = await mandateScopedCommand(13, customerIssuerContext, 'review_offering_issuer', {
    ...issuerInput(customerIssuerProduct), notes: 'Synthetic independent issuer decision for exact new-customer package.',
  })
  customerIssuerProduct = customerIssuerState.products.find(value => value.id === inReview.id)
  eq(customerIssuerProduct?.offering_package?.issuer_status, 'APPROVED',
    'new customer issuer decision stays visible in its portal after review')
  eq(customerIssuerProduct.allowed_actions.includes('review_offering_issuer'), false,
    'issuer cannot decide the same immutable package twice')
  await db.query('savepoint customer_issuer_revoked_visibility')
  await admin(); await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [customerIssuerBindingId])
  eq((await mandateScopedRead(13, customerIssuerContext)).products.some(value => value.id === inReview.id), false,
    'revoked customer issuer appointment immediately removes product visibility')
  await db.query('rollback to savepoint customer_issuer_revoked_visibility; release savepoint customer_issuer_revoked_visibility')
  eq((await mandateScopedRead(13, issuerContext)).products.some(value => value.id === inReview.id), false,
    'issuer binding in another native organisation does not expose customer product')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.subscriptions'), legacyOrdersBeforeOffering, 'new package workflow creates no order or funding')
  await sqlFile('../../../supabase/migrations/20260924110608_stage2_provider_evidence.sql')
  phase = 'structured-beneficial-ownership-cutover'
  const priorManagerStatus = await scalar('select status from bx1_portal.applications where id=$1', [managerApp.id])
  await sqlFile('../../../supabase/migrations/20260924110922_stage2_beneficial_ownership_control.sql')
  eq(await scalar('select status from bx1_portal.applications where id=$1', [managerApp.id]), priorManagerStatus,
    'historical customer admission remains intact without invented ownership rows')
  eq(await scalar('select count(*)::int from bx1_portal.application_ownership_control_versions'), 0,
    'legacy v1/v2 submissions are not reinterpreted as structured ownership')
  for (const role of ['anon', 'authenticated', 'service_role'])
    eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')',
      [role, 'bx1_portal.application_ownership_control_versions']), false, `${role} has no direct ownership-row access`)
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-owner-applicant-14@example.invalid',clock_timestamp(),false)", [uid(14)])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sid(14), uid(14)])
  await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Synthetic ownership applicant')", [uid(14)])
  const ownershipDocs = ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, i) => document(14, kind, i))
  for (const doc of ownershipDocs) await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('bx1-portal-documents',$1,$2,'{\"size\":100,\"mimetype\":\"application/pdf\"}'::jsonb)", [doc.storage_path, uid(14)])
  const ownershipRelationship = { id: 'e1400000-0000-4000-8000-000000000001', party_type: 'PERSON',
    legal_name: 'Synthetic Direct Owner', registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER',
    ownership_basis_points: 10000, control_basis: 'Synthetic direct shareholding in the fictional customer organisation.',
    effective_on: '2026-09-01', change_reason: 'Initial fictional direct ownership disclosure.',
    evidence_document_id: ownershipDocs[2].id }
  const ownershipDetails = { details_version: 3, full_name: 'Synthetic Applicant Fourteen', country: 'ZA',
    company_name: 'Synthetic Ownership Advisory', registration_reference: 'SYNTHETIC-OWN-14',
    beneficial_owners: 'Synthetic direct owner disclosed in a separate typed relationship record.',
    business_activities: 'Synthetic wealth-manager operations for test admission only.',
    representative_position: 'Fictional authorised representative',
    authority_basis: 'Synthetic appointment evidence, not a platform role or signing mandate.',
    documents: ownershipDocs, test_data_acknowledged: true, ownership_control: [ownershipRelationship],
    ownership_change_reason: 'Initial fictional beneficial-ownership disclosure.' }
  const wrongCapacity = (await entryCommand(14, 'start_application', { persona: 'INVESTOR' })).applications.find(a => a.persona === 'INVESTOR')
  await denied('manager ownership package cannot be submitted as investor capacity', () => entryCommand(14,
    'submit_application', { application_id: wrongCapacity.id, expected_revision: wrongCapacity.revision, details: ownershipDetails }), '22023')
  const ownershipDraft = (await entryCommand(14, 'start_application', { persona: 'WEALTH_MANAGER' })).applications.find(a => a.persona === 'WEALTH_MANAGER')
  await denied('legacy free-text-only package cannot submit as new customer', () => entryCommand(14,
    'submit_application', { application_id: ownershipDraft.id, expected_revision: ownershipDraft.revision,
      details: { ...managerDetails, documents: ownershipDocs } }), '23514')
  await denied('foreign evidence reference is not an ownership proof', () => entryCommand(14,
    'submit_application', { application_id: ownershipDraft.id, expected_revision: ownershipDraft.revision,
      details: { ...ownershipDetails, ownership_control: [{ ...ownershipRelationship, evidence_document_id: managerDetails.documents[2].id }] } }), '22023')
  await denied('stale ownership application revision rejected', () => entryCommand(14,
    'submit_application', { application_id: ownershipDraft.id, expected_revision: ownershipDraft.revision + 1,
      details: ownershipDetails }), '23514')
  let ownershipApp = (await entryCommand(14, 'submit_application', {
    application_id: ownershipDraft.id, expected_revision: ownershipDraft.revision, details: ownershipDetails,
  })).applications.find(a => a.id === ownershipDraft.id)
  eq(ownershipApp.status, 'SUBMITTED', 'typed ownership submission awaits independent decision')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.application_ownership_control_versions where application_id=$1 and application_revision=$2',
    [ownershipApp.id, ownershipApp.revision]), 1, 'exact submitted revision captures one immutable relationship')
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(14)]), 0,
    'ownership disclosure did not create a platform membership')
  await denied('other-organisation assured Compliance cannot review ownership package', () => mandateScopedCommand(5,
    roleContext('ComplianceOfficer', otherScope), 'review_application', { application_id: ownershipApp.id,
      expected_revision: ownershipApp.revision, decision: 'APPROVED',
      notes: 'Synthetic unrelated organisation attempted admission decision.', checks: reviewChecks }), '42501')
  await denied('AAL1 Compliance cannot review ownership package', () => scopedCommand(2, reviewer,
    'review_application', { application_id: ownershipApp.id, expected_revision: ownershipApp.revision,
      decision: 'CHANGES_REQUIRED', notes: 'Synthetic lower-assurance review attempt.', checks: reviewChecks }), '42501')
  ownershipApp = (await mandateScopedCommand(2, reviewer, 'review_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, decision: 'CHANGES_REQUIRED',
    notes: 'Clarify the fictional control relationship and disclose the correction.', checks: reviewChecks })).applications.find(a => a.id === ownershipApp.id)
  eq(ownershipApp.status, 'CHANGES_REQUIRED', 'reviewer requests information without approval')
  const correctedRelationship = { ...ownershipRelationship, ownership_basis_points: 7500,
    change_reason: 'Corrected fictional ownership after independent information request.' }
  await denied('material ownership change needs a new version reason', () => entryCommand(14,
    'submit_application', { application_id: ownershipApp.id, expected_revision: ownershipApp.revision,
      details: { ...ownershipDetails, ownership_control: [correctedRelationship] } }), '23514')
  ownershipApp = (await entryCommand(14, 'submit_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, details: { ...ownershipDetails, ownership_control: [correctedRelationship],
      ownership_change_reason: 'Corrected fictional ownership percentage after reviewer request.' } })).applications.find(a => a.id === ownershipApp.id)
  await admin()
  eq(await scalar('select count(distinct application_revision)::int from bx1_portal.application_ownership_control_versions where application_id=$1', [ownershipApp.id]), 2,
    'old and corrected relationship versions remain separately preserved')
  eq(await scalar('select ownership_basis_points from bx1_portal.application_ownership_control_versions where application_id=$1 order by application_revision limit 1', [ownershipApp.id]), 10000,
    'earlier disclosed percentage remains immutable')
  ownershipApp = (await mandateScopedCommand(2, reviewer, 'review_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, decision: 'APPROVED',
    notes: 'Independent synthetic review of exact corrected ownership evidence.', checks: reviewChecks })).applications.find(a => a.id === ownershipApp.id)
  eq(ownershipApp.status, 'APPROVED', 'independent decision applies to exact structured revision')
  await admin()
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(14)]), 0,
    'customer admission still grants no platform membership or signer authority')
  await admin()
  checks += await proveProviderEvidence(db)
  await admin()
  await sqlFile('../../../supabase/migrations/20260924112832_stage2_document_quarantine_lifecycle.sql')
  await sqlFile('../../../supabase/tests/bx1_document_lifecycle.sql')
  checks++
  await db.query('commit'); begun = false
  phase = 'cleanup-committed-disposable-fixture'
  await db.query('drop schema bx1_portal,bx1_private,storage,auth,public cascade; create schema public')
  committedFixture = false
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'committed synthetic schemas removed after concurrent proof')
  console.log(`BX1_PORTAL_SQL_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 exactAmounts=proven scopedAuthority=proven sameRecordBothAssets=proven auditRollback=proven authProvider=not-proven documentBytes=not-proven concurrency=two-connection-capacity-retry-and-expiry-wait settlement=not-implemented cleanup=synthetic-schemas-removed`)
} catch (error) {
  const diagnostic = typeof error?.message === 'string' ? error.message.split(/[\r\n]/, 1)[0].slice(0, 200).replace(/[^\x20-\x7e]/g, '?') : 'unavailable'
  console.error(`BX1_PORTAL_SQL_FAILED phase=${phase} line=${error?.fixtureLine ?? 'unknown'} code=${error?.code ?? 'assertion'} diagnostic=${JSON.stringify(diagnostic)}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.query('rollback') } catch {} }
  await Promise.all(proofClients.map(client => client.end().catch(() => {})))
  if (committedFixture && connected) {
    try { await db.query('reset role'); await db.query('drop schema bx1_portal,bx1_private,storage,auth,public cascade; create schema public') } catch { console.error('BX1_PORTAL_CLOUD_CLEANUP_FAILED disposable-service-will-be-destroyed-by-CI'); process.exitCode = 1 }
  }
  if (connected) await db.end()
}
