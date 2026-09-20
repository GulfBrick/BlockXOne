import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Exact disposable GitHub PostgreSQL17 service only. No local/project execution.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Portal SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('Portal SQL proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-portal-cloud-ci' }
const db = new pg.Client(options)
let phase = 'initialise', checks = 0, begun = false, connected = false, keySequence = 0
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
  eq(code, expectedCode, label)
}
const document = (n, kind, i) => ({ id: `ed000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`, kind, title: `Synthetic ${kind}`, storage_path: `${uid(n)}/synthetic-${kind}.pdf`, sha256: 'a'.repeat(64), size: 100, mime_type: 'application/pdf' })
const details = (n, entity = false, country = 'ZA') => ({ full_name: `Synthetic Applicant ${n}`, country, investor_type: entity ? 'ENTITY' : 'INDIVIDUAL', company_name: entity ? `Synthetic Company ${n}` : '', registration_reference: entity ? `SYNTHETIC-${n}` : '', source_of_funds: 'Fictional test savings only, no actual money or customer information.', beneficial_owners: entity ? 'Synthetic owner with one hundred percent fictional ownership.' : '', experience: 'Synthetic investment experience for workflow testing only.', documents: (entity ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => document(n, kind, i)), test_data_acknowledged: true })
const application = (n, persona = 'INVESTOR', revision = 0, country = 'ZA') => ({ persona, expected_revision: revision, details: details(n, persona === 'WEALTH_MANAGER', country) })
const reviewChecks = { identity: true, ownership: true, screening: true, suitability: true }
const offeringChecks = { issuer: true, terms: true, disclosures: true, eligibility: true }
const terms = (asset = 'FUND') => ({ asset_type: asset, name: `Synthetic ${asset} product`, issuer_name: 'Synthetic test issuer', summary: 'Fictional offering solely for testing a customer investment journey.', strategy: 'Fictional long-term diversified test strategy. This is not an investment offer.', share_class: 'Test Class A', currency: 'ZAR_TEST', unit_price_minor: '9007199254740993', cap_units: '10', minimum_units: '1', pricing_basis: 'Fixed synthetic unit price for workflow checks.', fees: 'No real fees or payments in this test.', redemption_terms: 'Future governed redemption service; not yet available for this test product.', eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'], property_address: asset === 'REAL_ESTATE' ? '100 Fictional Test Street' : '', property_valuation_minor: asset === 'REAL_ESTATE' ? '1234567890' : '0', rental_income_policy: asset === 'REAL_ESTATE' ? 'Fictional rental income policy requiring future reconciliation.' : '', documents: { memorandum: 'Synthetic memorandum. No property, fund interest or investment is offered. '.repeat(2), risks: 'Synthetic risk disclosure. This test does not represent real investment or ownership. '.repeat(2), subscription_terms: 'Synthetic subscription terms. Reservations do not confirm funding, assets or token delivery. '.repeat(2) } })
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

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'disposable service actor')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'fresh database')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query("alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security")
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
  phase = 'rollback'
  await db.query('rollback'); begun = false
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'all synthetic schema and fixtures rolled back')
  console.log(`BX1_PORTAL_SQL_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 exactAmounts=proven lifecycle=proven authProvider=not-proven documentBytes=not-proven concurrency=not-proven settlement=not-implemented cleanup=rolled-back`)
} catch (error) {
  const diagnostic = typeof error?.message === 'string' ? error.message.split(/[\r\n]/, 1)[0].slice(0, 200).replace(/[^\x20-\x7e]/g, '?') : 'unavailable'
  console.error(`BX1_PORTAL_SQL_FAILED phase=${phase} line=${error?.fixtureLine ?? 'unknown'} code=${error?.code ?? 'assertion'} diagnostic=${JSON.stringify(diagnostic)}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.query('rollback') } catch {} }
  if (connected) await db.end()
}
