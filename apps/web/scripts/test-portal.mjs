import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { proveProviderEvidence } from './provider-evidence-proof.mjs'
import { proveProviderBinding } from './provider-binding-proof.mjs'
import { proveCustomerMonitoring } from './customer-monitoring-proof.mjs'
import { proveDocumentRetentionAuthority } from './document-retention-authority-proof.mjs'
import { proveDocumentProcessing } from './document-processing-proof.mjs'
import { prepareEntityEligibilityLegacyFixture, proveEntityEligibility } from './entity-eligibility-proof.mjs'
import { proveTestOrdinaryEntry } from './test-ordinary-entry-proof.mjs'
import { proveSyntheticCompliance } from './test-synthetic-compliance.mjs'
import { proveAdmissionWorkflow } from './test-admission-workflow.mjs'
import { proveOfferingFileQuarantine, proveOfferingFileProductIsolation } from './offering-file-quarantine-proof.mjs'

// Exact disposable GitHub PostgreSQL17 service only. No local/project execution.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Portal SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_PORTAL_SQL_TEST_URL !== expected) throw new Error('Portal SQL proof requires the exact disposable CI database')
const fundV2LegacyCrossrefs = JSON.parse(await readFile(new URL('../src/lib/portal/fund-v2-legacy-crossrefs.json', import.meta.url), 'utf8'))
assert.deepEqual(Object.keys(fundV2LegacyCrossrefs).sort(), ['fees', 'pricing_basis', 'redemption_terms', 'strategy'], 'one shared v2 cross-reference contract')
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
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', aal: 'aal1', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })])
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
const fundV2Terms = (name = 'Synthetic TST fund package') => ({
  ...terms('FUND'), ...fundV2LegacyCrossrefs, name, terms_version: 2, currency: 'TST', settlement_decimals: 6,
  unit_price_minor: '10000000', cap_units: '100', minimum_units: '1',
  fund: {
    mandate: 'Fictional diversified fund mandate with no real portfolio or investable claim.',
    class_rights: 'Synthetic Class A equal economic rights, with no live ownership or transfer right.',
    nav: { valuation_method: 'Synthetic marked portfolio value divided by issued test units.', frequency: 'MONTHLY', pricing_cutoff: '16:00 UTC on last business day', correction_policy: 'Corrections require a reviewed replacement NAV version and disclosure.' },
    dealing: { subscription_frequency: 'MONTHLY', redemption_frequency: 'MONTHLY', notice_days: 10, settlement_days: 5 },
    fees: { management_bps: 100, performance_bps: 0, other_fees: 'No other synthetic fees are charged.' },
    liquidity: { lockup_days: 0, gate_bps: 10000, suspension_policy: 'A separately reviewed suspension decision is required before dealing stops.' },
    distributions: { frequency: 'NONE', policy: 'No distributions in this fictional initial fund class.' },
    redemption: { price_basis: 'NAV', conditions: 'Redemption depends on the reviewed dealing calendar and available liquidity.' },
  },
})
const propertyV2Terms = (name = 'Synthetic TST property package') => ({
  ...terms('REAL_ESTATE'), name, terms_version: 2, currency: 'TST', settlement_decimals: 6,
  unit_price_minor: '100000000', cap_units: '20', minimum_units: '1', property_valuation_minor: '3000000000',
  strategy: 'The real_estate.spv and real_estate.property policies define the property interest and control for this package.',
  pricing_basis: 'The real_estate.property valuation policy is the authoritative pricing basis for this package.',
  fees: 'The real_estate.cashflow expense and reserve policies govern charges for this package.',
  redemption_terms: 'The real_estate.exits policies distinguish eligible interest transfer from disposal and liquidation for this package.',
  rental_income_policy: 'The real_estate.cashflow rent and distribution policies govern income for this package.',
  real_estate: {
    spv: {
      legal_name: 'Fictional Property SPV', registration_reference: 'SYNTHETIC-SPV-001', jurisdiction: 'ZA',
      interest_rights: 'Each synthetic interest has the specified SPV class rights, not direct title to the fictional property.',
    },
    property: {
      title_evidence_reference: 'SYNTHETIC-TITLE-001', control_evidence_reference: 'SYNTHETIC-CONTROL-001',
      valuation_method: 'Illustrative synthetic appraisal, requiring separate dated independent review before actual pricing.',
      valuation_frequency: 'ANNUALLY',
      correction_policy: 'A material valuation error requires a reviewed correction version and treatment of affected holders.',
    },
    financing: {
      debt_policy: 'No actual debt is represented; any synthetic priority and covenant effects require reviewed terms.',
      lender_consent_policy: 'Required lender consent must be evidenced before a transfer, disposal or change of control.',
    },
    cashflow: {
      rent_policy: 'Synthetic rent claims are not distributable cash until independent settlement reconciliation.',
      expense_policy: 'Property expenses and taxes are recorded before a synthetic net income calculation.',
      reserve_policy: 'A reviewed maintenance and contingency reserve is retained before income distribution.',
      distribution_policy: 'Record-date entitlement, approved income and authorised payout evidence are required.',
    },
    governance: {
      consent_rights: 'Material disposal and financing changes require documented holder consent under the class terms.',
      voting_policy: 'Voting eligibility and threshold use a dated register snapshot, not a wallet connection.',
    },
    exits: {
      eligible_transfer_policy: 'Eligible interest transfer settles consideration and updates the holder while the product continues.',
      disposal_liquidation_policy: 'Property disposal and liquidation require a creditor and reserve waterfall, authorised payouts and supply closure.',
    },
  },
})
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
  const deadline = Date.now() + 10000
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
  // Only the disposable CI fixture needs this Storage API helper. Hosted
  // Supabase supplies its own operation-aware implementation.
  await db.query(`create function storage.allow_only_operation(text) returns boolean
    language sql stable as $$ select current_setting('request.storage.operation',true)=$1 $$`)
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
  await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Synthetic ownership human 14','TRUSTED','synthetic:test-human-14',$2)", [uid(50), uid(51)])
  await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:test-principal-14',$3)", [uid(14), uid(50), uid(51)])
  eq(await scalar('select count(distinct person_id)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[uid(14), uid(2), uid(10)]]), 3,
    'v3 applicant, Compliance reviewer and Super Admin are separate synthetic humans')
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
  phase = 'ownership-valid-manager-submission'
  let ownershipApp = (await entryCommand(14, 'submit_application', {
    application_id: ownershipDraft.id, expected_revision: ownershipDraft.revision, details: ownershipDetails,
  })).applications.find(a => a.id === ownershipDraft.id)
  eq(ownershipApp.status, 'SUBMITTED', 'typed ownership submission awaits independent decision')
  await admin()
  const organisationRequiredKeys = ['details_version', 'full_name', 'country', 'company_name',
    'registration_reference', 'beneficial_owners', 'business_activities', 'representative_position',
    'authority_basis', 'documents', 'test_data_acknowledged', 'ownership_control', 'ownership_change_reason']
  const admissionPackage = (await db.query("select admission_purpose,status,details->>'details_version' as details_version,details ?& $2::text[] as has_required_fields from bx1_portal.applications where id=$1",
    [ownershipApp.id, organisationRequiredKeys])).rows[0]
  eq([admissionPackage.admission_purpose, admissionPackage.status, admissionPackage.details_version,
    admissionPackage.has_required_fields], ['CUSTOMER_ORGANISATION_ADMISSION', 'SUBMITTED', '3', true],
  'submitted customer organisation has the v3 admission package before review')
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
  phase = 'ownership-independent-changes-required-review'
  ownershipApp = (await mandateScopedCommand(2, reviewer, 'review_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, decision: 'CHANGES_REQUIRED',
    notes: 'Clarify the fictional control relationship and disclose the correction.', checks: reviewChecks })).applications.find(a => a.id === ownershipApp.id)
  eq(ownershipApp.status, 'CHANGES_REQUIRED', 'reviewer requests information without approval')
  const correctedRelationship = { ...ownershipRelationship, ownership_basis_points: 7500,
    change_reason: 'Corrected fictional ownership after independent information request.' }
  await denied('material ownership change needs a new version reason', () => entryCommand(14,
    'submit_application', { application_id: ownershipApp.id, expected_revision: ownershipApp.revision,
      details: { ...ownershipDetails, ownership_control: [correctedRelationship] } }), '23514')
  phase = 'ownership-corrected-resubmission'
  ownershipApp = (await entryCommand(14, 'submit_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, details: { ...ownershipDetails, ownership_control: [correctedRelationship],
      ownership_change_reason: 'Corrected fictional ownership percentage after reviewer request.' } })).applications.find(a => a.id === ownershipApp.id)
  await admin()
  eq(await scalar('select count(distinct application_revision)::int from bx1_portal.application_ownership_control_versions where application_id=$1', [ownershipApp.id]), 2,
    'old and corrected relationship versions remain separately preserved')
  eq(await scalar('select ownership_basis_points from bx1_portal.application_ownership_control_versions where application_id=$1 order by application_revision limit 1', [ownershipApp.id]), 10000,
    'earlier disclosed percentage remains immutable')
  phase = 'ownership-independent-approval'
  ownershipApp = (await mandateScopedCommand(2, reviewer, 'review_application', { application_id: ownershipApp.id,
    expected_revision: ownershipApp.revision, decision: 'APPROVED',
    notes: 'Independent synthetic review of exact corrected ownership evidence.', checks: reviewChecks })).applications.find(a => a.id === ownershipApp.id)
  eq(ownershipApp.status, 'APPROVED', 'independent decision applies to exact structured revision')
  await admin()
  eq(await scalar('select bx1_portal.customer_admission_package_current($1::uuid)', [ownershipApp.id]), true,
    'approved v3 mandate source binds to the immediately preceding submitted ownership revision')
  eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(14)]), 0,
    'customer admission still grants no platform membership or signer authority')
  phase = 'ownership-v3-mandate-request'
  const v3Admission = (await entryRead(14)).applications.find(a => a.id === ownershipApp.id)
  eq(v3Admission.can_request_mandate, true, 'approved v3 customer admission exposes a separate mandate request')
  await denied('v3 customer admission alone cannot create a product', () => scopedCommand(14,
    { mode: 'APPLICANT' }, 'create_product', { organisation_id: v3Admission.organisation_id, terms: terms() }), '42501')
  const v3MandateInput = { application_id: ownershipApp.id, expected_revision: 0,
    evidence_reference: 'Synthetic independently reviewable v3 appointment evidence.',
    requested_until: new Date(Date.now() + 3 * 86400000).toISOString() }
  const v3MandateKey = key()
  let v3Mandate = (await entryCommand(14, 'request_representative_mandate', v3MandateInput,
    v3MandateKey)).organisation_mandates.find(m => m.application_id === ownershipApp.id)
  eq([v3Mandate.status, v3Mandate.effective, v3Mandate.admission_revision],
    ['SUBMITTED', false, ownershipApp.revision], 'v3 appointment awaits an independent decision on the exact admission revision')
  eq((await entryCommand(14, 'request_representative_mandate', v3MandateInput, v3MandateKey))
    .organisation_mandates.find(m => m.id === v3Mandate.id).id, v3Mandate.id,
  'v3 appointment request retry is idempotent')
  await admin()
  eq(await scalar("select count(*)::int from public.bx1_memberships where user_id=$1 and role='OfferingManager'", [uid(14)]), 0,
    'requesting a v3 mandate did not grant an operating role')
  phase = 'ownership-v3-mandate-independent-review'
  await denied('AAL1 reviewer cannot decide v3 appointment', () => scopedCommand(2, reviewer,
    'review_representative_mandate', { mandate_id: v3Mandate.id, expected_revision: v3Mandate.revision,
      decision: 'APPROVED', notes: 'Synthetic lower-assurance appointment decision.',
      checks: { appointment: true, evidence: true, scope: true } }), '42501')
  v3Mandate = (await mandateScopedCommand(2, reviewer, 'review_representative_mandate', {
    mandate_id: v3Mandate.id, expected_revision: v3Mandate.revision, decision: 'APPROVED',
    notes: 'Independent synthetic review of the v3 customer appointment and its exact source admission.',
    checks: { appointment: true, evidence: true, scope: true },
  })).organisation_mandates.find(m => m.id === v3Mandate.id)
  eq([v3Mandate.status, v3Mandate.effective, v3Mandate.next_owner], ['APPROVED', false, 'SUPER_ADMIN'],
    'Compliance approval of the v3 appointment still grants no role')
  phase = 'ownership-v3-mandate-independent-apply'
  v3Mandate = (await mandateScopedCommand(10, roleContext('SuperAdmin'), 'apply_representative_mandate', {
    mandate_id: v3Mandate.id, expected_revision: v3Mandate.revision,
  })).organisation_mandates.find(m => m.id === v3Mandate.id)
  eq([v3Mandate.status, v3Mandate.effective, v3Mandate.applied_by_user_id], ['APPLIED', true, uid(10)],
    'distinct assured Super Admin applies only the reviewed v3 appointment')
  const v3RoleContext = roleContext('OfferingManager', v3Mandate.native_organisation_id)
  const v3Workspace = await scopedRead(14, v3RoleContext)
  eq(v3Workspace.organisations.some(o => o.id === v3Admission.organisation_id), true,
    'applied v3 appointment opens the exact customer product workspace')
  eq(v3Workspace.organisation_mandates.length, 0, 'customer product role does not expose the staff mandate queue')
  const v3Draft = (await scopedCommand(14, v3RoleContext, 'create_product', {
    organisation_id: v3Admission.organisation_id, terms: { ...terms(), name: 'V3 ownership-governed synthetic draft' },
  })).products.find(p => p.terms.name === 'V3 ownership-governed synthetic draft')
  truth(v3Draft?.id, 'v3 customer can create a product only after the separate approved mandate is applied')
  await admin()
  checks += await proveProviderEvidence(db)
  await admin()
  await sqlFile('../../../supabase/migrations/20260924112832_stage2_document_quarantine_lifecycle.sql')
  await sqlFile('../../../supabase/tests/bx1_document_lifecycle.sql')
  checks++
  await sqlFile('../../../supabase/migrations/20260924125627_stage2_customer_monitoring.sql')
  checks += await proveCustomerMonitoring(db, {
    applicationId: ownershipApp.id,
    organisationId: v3Admission.organisation_id,
    draftProductId: v3Draft.id,
    managerMandateId: v3Mandate.id,
    investorApplicationId: ownApp3.id,
    investorAccountId: account3.id,
    eligibilityCaseId: approved.id,
  })
  await sqlFile('../../../supabase/migrations/20260924125811_stage2_document_retention_authority.sql')
  await sqlFile('../../../supabase/tests/bx1_document_retention_authority.sql')
  checks += await proveDocumentRetentionAuthority(db)
  phase = 'stage3-versioned-fund-package'
  const legacyFundCreateKey = key()
  const legacyFundCreateBody = {
    organisation_id: orgId, terms: { ...terms('FUND'), name: 'Legacy fund draft requiring v2 upgrade' },
  }
  const v1FundDraft = (await scopedCommand(1, manager, 'create_product', {
    ...legacyFundCreateBody,
  }, legacyFundCreateKey)).products.find(value => value.terms.name === 'Legacy fund draft requiring v2 upgrade')
  const legacyPropertyCreateKey = key()
  const legacyPropertyCreateBody = {
    organisation_id: orgId, terms: { ...terms('REAL_ESTATE'), name: 'Legacy property draft requiring v2 upgrade' },
  }
  const v1PropertyDraft = (await scopedCommand(1, manager, 'create_product',
    legacyPropertyCreateBody, legacyPropertyCreateKey)).products.find(value =>
    value.terms.name === 'Legacy property draft requiring v2 upgrade')
  await admin()
  phase = 'entity-eligibility-legacy-fixture-preparation'
  const entityEligibilityFixture = await prepareEntityEligibilityLegacyFixture(db)
  checks += entityEligibilityFixture.checks
  phase = 'stage3-versioned-fund-package'
  const legacyFundHash = await scalar('select terms_hash from bx1_portal.products where id=$1', [fundPackage.id])
  const legacyPropertyHash = await scalar('select terms_hash from bx1_portal.products where id=$1', [propertyPackage.id])
  const legacyOrderTermsHash = await scalar('select terms_hash from bx1_portal.subscriptions where id=$1', [historicalOrder.id])
  const legacySnapshots = await scalar("select count(*)::int from bx1_portal.offering_revisions where origin like 'LEGACY_%'")
  await sqlFile('../../../supabase/migrations/20260928141413_stage3_fund_terms_v2.sql')
  eq(await scalar('select terms_hash from bx1_portal.products where id=$1', [fundPackage.id]), legacyFundHash, 'v2 migration does not rehash a reviewed legacy fund')
  eq(await scalar('select terms_hash from bx1_portal.subscriptions where id=$1', [historicalOrder.id]), legacyOrderTermsHash, 'v2 migration does not change accepted order terms hash')
  eq(await scalar("select count(*)::int from bx1_portal.offering_revisions where origin like 'LEGACY_%'"), legacySnapshots, 'v2 migration preserves immutable legacy snapshots')
  eq(await scalar("select has_function_privilege('authenticated','public.bx1_portal_command(text,uuid,jsonb)','EXECUTE')"), false, 'legacy public command remains sealed')
  eq(await scalar("select has_function_privilege('authenticated','bx1_portal.execute_scoped_pre_fund_v2(jsonb,text,uuid,jsonb)','EXECUTE')"), false, 'previous scoped writer remains private')
  eq(await scalar("select has_function_privilege('authenticated','bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)','EXECUTE')"), false, 'v2 fund save helper remains private')
  eq(await scalar("select bx1_portal.offering_technical_ready($1)", [fundPackage.offering_package.id]), false, 'fund technical-readiness gate remains false')
  const replayedLegacyDraft = (await scopedCommand(1, manager, 'create_product', legacyFundCreateBody, legacyFundCreateKey)).products.find(value => value.id === v1FundDraft.id)
  eq(replayedLegacyDraft.id, v1FundDraft.id, 'pre-migration v1 idempotent replay remains a read, not a duplicate fund')
  await denied('new FUND cannot use v1 ZAR_TEST terms', () => scopedCommand(1, manager, 'create_product', {
    organisation_id: orgId, terms: { ...terms('FUND'), name: 'Prohibited new legacy fund' },
  }))
  await denied('even an internal status update cannot submit a legacy fund draft', async () => {
    await admin()
    await db.query("update bx1_portal.products set status='IN_REVIEW',revision=revision+1 where id=$1", [v1FundDraft.id])
  })
  await denied('legacy fund draft cannot submit without explicit v2 upgrade', () => scopedCommand(1, manager, 'submit_product', {
    product_id: v1FundDraft.id, expected_revision: v1FundDraft.revision,
  }))
  await admin()
  eq(await scalar('select status from bx1_portal.products where id=$1', [v1FundDraft.id]), 'DRAFT', 'rejected legacy submission rolled back status')
  await denied('fund draft cannot switch asset class to property', () => scopedCommand(1, manager, 'save_product', {
    product_id: v1FundDraft.id, expected_revision: v1FundDraft.revision,
    terms: { ...terms('REAL_ESTATE'), name: 'Prohibited asset class switch' },
  }))
  for (const [label, invalid] of [
    ['NAV frequency null', { fund: { ...fundV2Terms().fund, nav: { ...fundV2Terms().fund.nav, frequency: null } } }],
    ['dealing subscription frequency null', { fund: { ...fundV2Terms().fund, dealing: { ...fundV2Terms().fund.dealing, subscription_frequency: null } } }],
    ['dealing redemption frequency null', { fund: { ...fundV2Terms().fund, dealing: { ...fundV2Terms().fund.dealing, redemption_frequency: null } } }],
    ['distribution frequency null', { fund: { ...fundV2Terms().fund, distributions: { ...fundV2Terms().fund.distributions, frequency: null } } }],
    ['fee precision invalid', { fund: { ...fundV2Terms().fund, fees: { ...fundV2Terms().fund.fees, management_bps: 100.5 } } }],
    ['wrong settlement decimals', { settlement_decimals: 2 }],
    ['currency is not TST', { currency: 'ZAR_TEST' }],
    ['unexpected policy key', { fund: { ...fundV2Terms().fund, unreviewed_override: 'yes' } }],
    ['contradictory mandate summary', { strategy: 'A conflicting investment mandate that is not the typed fund mandate.' }],
    ['contradictory pricing summary', { pricing_basis: 'A fixed price of 10 TST regardless of the binding NAV and dealing policy.' }],
    ['contradictory fee summary', { fees: 'A management fee of nine thousand basis points, contrary to the typed policy.' }],
    ['contradictory exit summary', { redemption_terms: 'Immediate unconditional redemption, contrary to the typed dealing and liquidity rules.' }],
    ['legacy denomination hidden in mandate', { fund: { ...fundV2Terms().fund, mandate: 'Fictional test mandate wrongly denominated in zar_test despite TST terms.' } }],
    ['legacy denomination hidden in disclosure', { documents: { ...fundV2Terms().documents, risks: 'Synthetic risk disclosure wrongly says ZAR_TEST is the settlement asset. '.repeat(2).trim() } }],
  ]) {
    await denied(`v2 ${label} rejected by SQL`, async () => {
      await admin()
      await scalar('select bx1_portal.validate_terms($1::jsonb)', [JSON.stringify({ ...fundV2Terms(), ...invalid })])
    }, '22023')
  }
  await denied('direct command cannot create contradictory v2 fund economics', () => scopedCommand(1, manager, 'create_product', {
    organisation_id: orgId,
    terms: { ...fundV2Terms('Rejected conflicting fund'), fees: 'A conflicting 90 percent fee disclosed only in the legacy narrative.' },
  }), '22023')
  await db.query('savepoint oversized_fund_v2_command')
  let oversizedFundError
  try {
    await scopedCommand(1, manager, 'create_product', {
      organisation_id: orgId,
      terms: { ...fundV2Terms('Rejected oversized fund'), fund: { ...fundV2Terms().fund, mandate: 'x'.repeat(66000) } },
    })
  } catch (error) { oversizedFundError = error?.message }
  await db.query('rollback to savepoint oversized_fund_v2_command; release savepoint oversized_fund_v2_command')
  eq(oversizedFundError, 'fund_v2_command_too_large', 'oversized direct command rejected before nested policy validation')
  const upgraded = (await scopedCommand(1, manager, 'save_product', {
    product_id: v1FundDraft.id, expected_revision: v1FundDraft.revision,
    terms: fundV2Terms('Upgraded synthetic TST fund package'),
  })).products.find(value => value.id === v1FundDraft.id)
  eq([upgraded.terms.terms_version, upgraded.terms.currency, upgraded.terms.settlement_decimals], [2, 'TST', 6], 'legacy draft upgraded by explicit save, not data migration')
  eq((BigInt(upgraded.terms.cap_units) * BigInt(upgraded.terms.unit_price_minor)).toString(), '1000000000', '100 units at 10 TST each equal 1,000 synthetic TST base units')
  const v2Submitted = (await scopedCommand(1, manager, 'submit_product', {
    product_id: upgraded.id, expected_revision: upgraded.revision,
  })).products.find(value => value.id === upgraded.id)
  truth(v2Submitted.offering_package?.id, 'v2 fund submission creates immutable offering revision')
  eq(v2Submitted.offering_package.terms_hash, v2Submitted.terms_hash, 'v2 fund immutable revision bound to validated terms hash')
  eq(v2Submitted.offering_package.technical_readiness_status, 'NOT_VERIFIED', 'v2 fund is not open for payment or issuance')
  let v2Reviewed = (await mandateScopedCommand(13, issuerContext, 'review_offering_issuer', issuerInput(v2Submitted))).products.find(value => value.id === v2Submitted.id)
  v2Reviewed = (await mandateScopedCommand(2, reviewer, 'review_product', complianceInput(v2Reviewed))).products.find(value => value.id === v2Submitted.id)
  eq([v2Reviewed.status, v2Reviewed.offering_package.issuer_status, v2Reviewed.offering_package.compliance_status],
    ['APPROVED', 'APPROVED', 'APPROVED'], 'v2 fund receives separate appointed issuer and independent Compliance decisions')
  await db.query('savepoint v2_public_rpc_publication')
  let v2PublicationError
  const v2PublicationPayload = { product_id: v2Reviewed.id, expected_revision: v2Reviewed.revision }
  try {
    await scopedCommand(1, manager, 'publish_product', v2PublicationPayload)
  } catch (error) { v2PublicationError = { code: error?.code, message: error?.message } }
  await db.query('rollback to savepoint v2_public_rpc_publication; release savepoint v2_public_rpc_publication')
  await db.query('savepoint v2_direct_scoped_publication')
  let v2DirectPublicationError
  try {
    await actor(1)
    await scalar('select bx1_portal.execute_scoped($1::jsonb,$2,$3,$4::jsonb)',
      [JSON.stringify(manager), 'publish_product', key(), JSON.stringify(v2PublicationPayload)])
  } catch (error) { v2DirectPublicationError = { code: error?.code, message: error?.message } }
  await db.query('rollback to savepoint v2_direct_scoped_publication; release savepoint v2_direct_scoped_publication')
  eq(v2PublicationError, { code: '23514', message: 'fund_v2_settlement_route_not_admitted' },
    `v2 public=${v2PublicationError?.code}/${v2PublicationError?.message} direct=${v2DirectPublicationError?.code}/${v2DirectPublicationError?.message}`)
  await admin()
  eq(await scalar('select status from bx1_portal.products where id=$1', [v2Reviewed.id]), 'APPROVED', 'denied v2 publication leaves package reviewed but closed')
  await denied('internal update cannot publish v2 fund into legacy settlement route', async () => {
    await admin()
    await db.query("update bx1_portal.products set status='PUBLISHED' where id=$1", [v2Reviewed.id])
  })
  await denied('internal insert cannot subscribe to v2 fund through legacy route', async () => {
    await admin()
    await db.query(`insert into bx1_portal.subscriptions
      (product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)
      values($1,$2,$3,$4,$5,$6::jsonb,true,true,1,10000000)`,
    [v2Reviewed.id, uid(3), orgId, v2Reviewed.revision, v2Reviewed.terms_hash, JSON.stringify(v2Reviewed.terms)])
  })
  phase = 'fund-v2-other-organisation-own-draft-read'
  const ownReadStartedAt = Date.now()
  const foreignManagerOwnDraft = (await scopedRead(14, v3RoleContext)).products.find(value => value.id === v3Draft.id)
  console.log(`BX1_FUND_V2_TIMING scopedReadMs=${Date.now() - ownReadStartedAt} actor=synthetic-other-organisation`)
  eq(foreignManagerOwnDraft?.status, 'DRAFT', 'other-organisation manager sees only their own existing draft')
  await admin()
  phase = 'fund-v2-read-projection-profile'
  for (const layer of ['read_scoped_pre_eligibility', 'read_scoped_pre_mandate',
    'read_scoped_pre_entity', 'read_scoped_pre_offering']) {
    const layerStartedAt = Date.now()
    await scalar(`select pg_catalog.octet_length(bx1_portal.${layer}($1::jsonb)::text)`,
      [JSON.stringify(v3RoleContext)])
    console.log(`BX1_FUND_V2_TIMING layer=${layer} elapsedMs=${Date.now() - layerStartedAt}`)
  }
  const contextStartedAt = Date.now()
  await scalar('select bx1_portal.valid_operating_context($1::jsonb)', [JSON.stringify(v3RoleContext)])
  console.log(`BX1_FUND_V2_TIMING validContextMs=${Date.now() - contextStartedAt} actor=synthetic-other-organisation`)
  const operatorStartedAt = Date.now()
  await scalar('select bx1_portal.scoped_operator($1::jsonb,$2::uuid)',
    [JSON.stringify(v3RoleContext), v3Draft.organisation_id])
  console.log(`BX1_FUND_V2_TIMING scopedOperatorMs=${Date.now() - operatorStartedAt} actor=synthetic-other-organisation`)
  await admin()
  const ownDraftBefore = await scalar(`select jsonb_build_object(
    'revision',p.revision,'hash',p.terms_hash,'requests',(select count(*) from bx1_portal.requests r
      where r.actor_id=$2 and r.command='save_product' and r.payload->>'product_id'=($1::uuid)::text),
    'scoped',(select count(*) from bx1_portal.scoped_requests r
      where r.actor_id=$2 and r.command='save_product' and r.payload->>'product_id'=($1::uuid)::text),
    'events',(select count(*) from bx1_portal.events e
      where e.actor_id=$2 and e.kind='save_product' and e.subject_id=$1))
    from bx1_portal.products p where p.id=$1`, [v3Draft.id, uid(14)])
  phase = 'fund-v2-own-save-stale-revision'
  await denied('v2 fund save rejects stale revision before changing a draft', () => scopedCommand(14,
    v3RoleContext, 'save_product', {
      product_id: v3Draft.id, expected_revision: v3Draft.revision + 1,
      terms: fundV2Terms('Rejected synthetic TST fund with stale revision'),
    }), '23514')
  await admin()
  eq(await scalar('select revision from bx1_portal.products where id=$1', [v3Draft.id]),
    v3Draft.revision, 'stale save preserves the product revision')
  phase = 'fund-v2-own-save-audit-rollback'
  await denied('v2 fund save audit failure rolls back terms, revision and both receipts', async () => {
    await admin()
    await db.query(`create function public.synthetic_fund_v2_save_audit_failure() returns trigger
      language plpgsql as $$ begin if new.kind='save_product' then
        raise exception 'synthetic_fund_v2_save_audit_failure' using errcode='23514'; end if;
        return new; end $$;
      create trigger synthetic_fund_v2_save_audit_failure before insert on bx1_portal.events
      for each row execute function public.synthetic_fund_v2_save_audit_failure()`)
    await scopedCommand(14, v3RoleContext, 'save_product', {
      product_id: v3Draft.id, expected_revision: v3Draft.revision,
      terms: fundV2Terms('Rejected synthetic TST fund after audit failure'),
    })
  })
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'revision',p.revision,'hash',p.terms_hash,'requests',(select count(*) from bx1_portal.requests r
      where r.actor_id=$2 and r.command='save_product' and r.payload->>'product_id'=($1::uuid)::text),
    'scoped',(select count(*) from bx1_portal.scoped_requests r
      where r.actor_id=$2 and r.command='save_product' and r.payload->>'product_id'=($1::uuid)::text),
    'events',(select count(*) from bx1_portal.events e
      where e.actor_id=$2 and e.kind='save_product' and e.subject_id=$1))
    from bx1_portal.products p where p.id=$1`, [v3Draft.id, uid(14)]), ownDraftBefore,
  'failed v2 save left no product, receipt or event change')
  phase = 'fund-v2-other-organisation-own-draft-upgrade'
  const upgradeStartedAt = Date.now()
  const ownUpgradeKey = key()
  const ownUpgradeBody = {
    product_id: v3Draft.id, expected_revision: v3Draft.revision,
    terms: fundV2Terms('V3 own-organisation synthetic TST fund upgrade'),
  }
  let foreignManagerOwnUpgrade
  try {
    foreignManagerOwnUpgrade = (await scopedCommand(14, v3RoleContext, 'save_product', ownUpgradeBody,
      ownUpgradeKey)).products.find(value => value.id === v3Draft.id)
  } catch (error) {
    error.message = `own-v3-upgrade elapsedMs=${Date.now() - upgradeStartedAt} ${error.message}`
    throw error
  }
  console.log(`BX1_FUND_V2_SAVE_PROOF elapsedMs=${Date.now() - upgradeStartedAt} actor=synthetic-other-organisation result=success`)
  eq([foreignManagerOwnUpgrade?.id, foreignManagerOwnUpgrade?.revision,
    foreignManagerOwnUpgrade?.terms?.terms_version, foreignManagerOwnUpgrade?.terms?.currency],
  [v3Draft.id, v3Draft.revision + 1, 2, 'TST'],
  'other-organisation manager can upgrade only their own legacy draft under an effective mandate')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'requests',(select count(*) from bx1_portal.requests where actor_id=$1 and request_key=$2),
    'scoped',(select count(*) from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2),
    'events',(select count(*) from bx1_portal.events where actor_id=$1 and subject_id=$3 and kind='save_product'))`,
  [uid(14), ownUpgradeKey, v3Draft.id]), { requests: 1, scoped: 1, events: 1 },
  'one fund save creates both idempotency receipts and one audit event')
  phase = 'fund-v2-own-save-replay-and-conflict'
  const replayedOwnUpgrade = (await scopedCommand(14, v3RoleContext, 'save_product', ownUpgradeBody,
    ownUpgradeKey)).products.find(value => value.id === v3Draft.id)
  eq(replayedOwnUpgrade.revision, foreignManagerOwnUpgrade.revision,
    'exact fund save replay returns current scoped state without a second revision')
  await denied('fund save key cannot be reused with different terms', () => scopedCommand(14,
    v3RoleContext, 'save_product', { ...ownUpgradeBody,
      terms: fundV2Terms('Conflicting terms on the same save key') }, ownUpgradeKey), '23505')
  await admin()
  eq(await scalar("select count(*)::int from bx1_portal.events where actor_id=$1 and subject_id=$2 and kind='save_product'",
    [uid(14), v3Draft.id]), 1, 'replay and conflict create no second fund-save audit event')
  phase = 'fund-v2-cross-organisation-save-denial'
  await denied('cross-org manager cannot probe v2 fund save', () => scopedCommand(14, v3RoleContext, 'save_product', {
    product_id: v2Reviewed.id, expected_revision: v2Reviewed.revision,
    terms: fundV2Terms('Foreign attempted alteration'),
  }), '42501')
  await admin()
  eq(await scalar('select terms_hash from bx1_portal.products where id=$1', [v2Reviewed.id]), v2Reviewed.terms_hash, 'cross-org denied without package mutation')
  phase = 'stage3-property-v2-install-and-history'
  await sqlFile('../../../supabase/migrations/20260928161233_stage3_real_estate_terms_v2.sql')
  await sqlFile('../../../supabase/tests/stage3_real_estate_v2_acl.sql'); checks++
  eq(await scalar('select terms_hash from bx1_portal.products where id=$1', [propertyPackage.id]), legacyPropertyHash,
    'property v2 migration does not rehash a reviewed historical property package')
  eq(await scalar('select terms_hash from bx1_portal.subscriptions where id=$1', [historicalOrder.id]), legacyOrderTermsHash,
    'property v2 migration preserves earlier accepted order terms')
  eq(await scalar("select has_function_privilege('authenticated','bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)','EXECUTE')"), false,
    'typed property draft writer remains private')
  const oldProperty = (await scopedRead(1, manager)).products.find(value => value.id === propertyPackage.id)
  eq([oldProperty.id, oldProperty.terms_hash, oldProperty.terms.currency],
    [propertyPackage.id, legacyPropertyHash, 'ZAR_TEST'], 'legacy property remains readable without denomination rewrite')
  const replayedLegacyProperty = (await scopedCommand(1, manager, 'create_product',
    legacyPropertyCreateBody, legacyPropertyCreateKey)).products.find(value => value.id === v1PropertyDraft.id)
  eq(replayedLegacyProperty.id, v1PropertyDraft.id, 'pre-migration property create key replays existing draft only')
  await denied('new property cannot use v1 ZAR_TEST terms', () => scopedCommand(1, manager,
    'create_product', { organisation_id: orgId, terms: terms('REAL_ESTATE') }))
  await denied('internal status update cannot submit an unupgraded property draft', async () => {
    await admin(); await db.query("update bx1_portal.products set status='IN_REVIEW',revision=revision+1 where id=$1", [v1PropertyDraft.id])
  })
  await denied('legacy property draft cannot submit without explicit v2 upgrade', () => scopedCommand(1, manager,
    'submit_product', { product_id: v1PropertyDraft.id, expected_revision: v1PropertyDraft.revision }))
  for (const [label, invalid, sqlstate] of [
    ['wrong settlement decimals', { settlement_decimals: 2 }, '22023'],
    ['wrong currency', { currency: 'ZAR_TEST' }, '22023'],
    ['missing title evidence', { real_estate: { ...propertyV2Terms().real_estate,
      property: { ...propertyV2Terms().real_estate.property, title_evidence_reference: '' } } }, '22023'],
    ['unknown property policy', { real_estate: { ...propertyV2Terms().real_estate,
      unreviewed_override: 'yes' } }, '22023'],
    ['same transfer and liquidation path', { real_estate: { ...propertyV2Terms().real_estate,
      exits: { ...propertyV2Terms().real_estate.exits,
        disposal_liquidation_policy: propertyV2Terms().real_estate.exits.eligible_transfer_policy } } }, '23514'],
    ['contradictory old pricing narrative', { pricing_basis: 'Unreviewed fixed property price' }, '22023'],
    ['legacy denomination hidden in property disclosure', { documents: { ...propertyV2Terms().documents,
      risks: 'This fictional property wrongly promises ZAR_TEST settlement.' } }, '22023'],
  ]) await denied(`property v2 ${label} rejected by SQL`, async () => {
    await admin(); await scalar('select bx1_portal.validate_terms($1::jsonb)',
      [JSON.stringify({ ...propertyV2Terms(), ...invalid })])
  }, sqlstate)
  await denied('fund draft cannot become property by saving new typed terms', () => scopedCommand(1, manager,
    'save_product', { product_id: v2Reviewed.id, expected_revision: v2Reviewed.revision,
      terms: propertyV2Terms('Wrong asset for existing fund') }))
  const freshProperty = (await scopedCommand(1, manager, 'create_product', { organisation_id: orgId,
    terms: propertyV2Terms('Fresh synthetic TST property package') })).products.find(value =>
    value.terms.name === 'Fresh synthetic TST property package')
  eq([freshProperty?.terms?.terms_version, freshProperty?.terms?.currency,
    freshProperty?.terms?.settlement_decimals], [2, 'TST', 6], 'new property uses the common v2 settlement contract')
  eq((BigInt(freshProperty.terms.cap_units) * BigInt(freshProperty.terms.unit_price_minor)).toString(),
    '2000000000', '20 interests at 100 TST each equal 2,000 synthetic TST base units')
  eq(freshProperty.terms.property_valuation_minor, '3000000000',
    'illustrative 3,000 TST property valuation stays distinct from the 2,000 TST offering capacity')
  phase = 'stage3-property-v2-save-and-authority'
  await admin()
  const propertyBefore = await scalar(`select jsonb_build_object(
    'revision',p.revision,'hash',p.terms_hash,
    'requests',(select count(*) from bx1_portal.requests r where r.actor_id=$2 and r.command='save_product'
      and r.payload->>'product_id'=($1::uuid)::text),
    'scoped',(select count(*) from bx1_portal.scoped_requests r where r.actor_id=$2 and r.command='save_product'
      and r.payload->>'product_id'=($1::uuid)::text),
    'events',(select count(*) from bx1_portal.events e where e.actor_id=$2 and e.kind='save_product'
      and e.subject_id=$1)) from bx1_portal.products p where p.id=$1`, [v1PropertyDraft.id, uid(1)])
  await denied('property save rejects stale revision', () => scopedCommand(1, manager, 'save_product', {
    product_id: v1PropertyDraft.id, expected_revision: v1PropertyDraft.revision + 1,
    terms: propertyV2Terms('Rejected stale property upgrade'),
  }))
  await denied('property save audit failure rolls back draft, receipts and event', async () => {
    await admin()
    await db.query(`create function public.synthetic_property_save_audit_failure() returns trigger
      language plpgsql as $$ begin if new.kind='save_product' then
        raise exception 'synthetic_property_save_audit_failure' using errcode='23514'; end if;
        return new; end $$;
      create trigger synthetic_property_save_audit_failure before insert on bx1_portal.events
      for each row execute function public.synthetic_property_save_audit_failure()`)
    await scopedCommand(1, manager, 'save_product', {
      product_id: v1PropertyDraft.id, expected_revision: v1PropertyDraft.revision,
      terms: propertyV2Terms('Rejected property upgrade after audit failure'),
    })
  })
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'revision',p.revision,'hash',p.terms_hash,
    'requests',(select count(*) from bx1_portal.requests r where r.actor_id=$2 and r.command='save_product'
      and r.payload->>'product_id'=($1::uuid)::text),
    'scoped',(select count(*) from bx1_portal.scoped_requests r where r.actor_id=$2 and r.command='save_product'
      and r.payload->>'product_id'=($1::uuid)::text),
    'events',(select count(*) from bx1_portal.events e where e.actor_id=$2 and e.kind='save_product'
      and e.subject_id=$1)) from bx1_portal.products p where p.id=$1`, [v1PropertyDraft.id, uid(1)]), propertyBefore,
  'failed property audit leaves no revision, hash, receipt or event change')
  await db.query('savepoint property_manager_revocation')
  await admin()
  await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='OfferingManager'", [orgId])
  await denied('revoked manager cannot save property draft', () => scopedCommand(1, manager,
    'save_product', { product_id: v1PropertyDraft.id, expected_revision: v1PropertyDraft.revision,
      terms: propertyV2Terms('Rejected revoked manager property upgrade') }), '42501')
  await db.query('rollback to savepoint property_manager_revocation; release savepoint property_manager_revocation')
  await denied('other-organisation manager cannot alter property draft', () => scopedCommand(14,
    v3RoleContext, 'save_product', { product_id: v1PropertyDraft.id,
      expected_revision: v1PropertyDraft.revision, terms: propertyV2Terms('Foreign property alteration') }), '42501')
  const propertyUpgradeKey = key()
  const propertyUpgradeBody = { product_id: v1PropertyDraft.id, expected_revision: v1PropertyDraft.revision,
    terms: propertyV2Terms('Upgraded synthetic TST property package') }
  const upgradedProperty = (await scopedCommand(1, manager, 'save_product', propertyUpgradeBody,
    propertyUpgradeKey)).products.find(value => value.id === v1PropertyDraft.id)
  eq([upgradedProperty.terms.terms_version, upgradedProperty.terms.currency,
    upgradedProperty.revision], [2, 'TST', v1PropertyDraft.revision + 1],
  'legacy property draft requires explicit guarded upgrade, without changing its ID')
  const replayedPropertyUpgrade = (await scopedCommand(1, manager, 'save_product', propertyUpgradeBody,
    propertyUpgradeKey)).products.find(value => value.id === v1PropertyDraft.id)
  eq(replayedPropertyUpgrade.revision, upgradedProperty.revision,
    'same property save key replays without a second revision')
  await denied('property save key cannot be reused with changed terms', () => scopedCommand(1,
    manager, 'save_product', { ...propertyUpgradeBody,
      terms: propertyV2Terms('Conflicting property terms') }, propertyUpgradeKey), '23505')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'requests',(select count(*) from bx1_portal.requests where actor_id=$1 and request_key=$2),
    'scoped',(select count(*) from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2),
    'events',(select count(*) from bx1_portal.events where actor_id=$1 and subject_id=$3 and kind='save_product'))`,
  [uid(1), propertyUpgradeKey, v1PropertyDraft.id]), { requests: 1, scoped: 1, events: 1 },
  'one property save has both idempotency receipts and one audit event')
  phase = 'stage3-property-v2-review-and-closed-opening'
  const submittedProperty = (await scopedCommand(1, manager, 'submit_product', {
    product_id: upgradedProperty.id, expected_revision: upgradedProperty.revision,
  })).products.find(value => value.id === upgradedProperty.id)
  eq([submittedProperty.offering_package?.terms_hash,
    submittedProperty.offering_package?.technical_readiness_status],
  [submittedProperty.terms_hash, 'NOT_VERIFIED'],
  'typed property submission creates a hash-bound immutable package but no technical admission')
  let reviewedProperty = (await mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(submittedProperty))).products.find(value =>
    value.id === submittedProperty.id)
  reviewedProperty = (await mandateScopedCommand(2, reviewer,
    'review_product', complianceInput(reviewedProperty))).products.find(value =>
    value.id === submittedProperty.id)
  eq([reviewedProperty.status, reviewedProperty.offering_package.issuer_status,
    reviewedProperty.offering_package.compliance_status], ['APPROVED', 'APPROVED', 'APPROVED'],
  'typed property receives independent issuer and Compliance reviews on one revision')
  await denied('reviewed property cannot use legacy publish path', () => scopedCommand(1, manager,
    'publish_product', { product_id: reviewedProperty.id, expected_revision: reviewedProperty.revision }))
  await denied('internal property status update cannot bypass technical admission', async () => {
    await admin(); await db.query("update bx1_portal.products set status='PUBLISHED' where id=$1", [reviewedProperty.id])
  })
  await denied('internal property subscription insert cannot bypass v2 settlement closure', async () => {
    await admin()
    await db.query(`insert into bx1_portal.subscriptions
      (product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)
      values($1,$2,$3,$4,$5,$6::jsonb,true,true,1,100000000)`,
    [reviewedProperty.id, uid(3), orgId, reviewedProperty.revision,
      reviewedProperty.terms_hash, JSON.stringify(reviewedProperty.terms)])
  })
  await admin()
  eq(await scalar('select status from bx1_portal.products where id=$1', [reviewedProperty.id]), 'APPROVED',
    'denied property publication leaves reviewed package closed')
  phase = 'stage3-offering-file-quarantine'
  await sqlFile('../../../supabase/migrations/20260928174348_stage3_offering_file_quarantine.sql')
  await db.query('savepoint offering_file_quarantine_fixture')
  try {
    const fileDraftName = 'Synthetic file quarantine proof fund'
    const fileDraft = (await scopedCommand(1, manager, 'create_product', {
      organisation_id: orgId, terms: fundV2Terms(fileDraftName),
    })).products.find(value => value.terms.name === fileDraftName)
    truth(fileDraft?.id, 'isolated file proof has a typed fund draft')
    const fileSubmitted = (await scopedCommand(1, manager, 'submit_product', {
      product_id: fileDraft.id, expected_revision: fileDraft.revision,
    })).products.find(value => value.id === fileDraft.id)
    truth(fileSubmitted?.offering_package?.id, 'isolated file proof has a submitted revision')
    await admin()
    checks += await proveOfferingFileQuarantine(db, fileSubmitted.id)
  } finally {
    await admin()
    await db.query('rollback to savepoint offering_file_quarantine_fixture; release savepoint offering_file_quarantine_fixture')
  }
  phase = 'stage3-product-service-appointments'
  await sqlFile('../../../supabase/migrations/20260928174847_stage3_product_service_appointments.sql')
  for (const table of ['product_service_appointments', 'product_service_appointment_receipts',
    'product_service_appointment_requests', 'offering_review_reopen_receipts',
    'offering_amendment_begin_receipts']) {
    eq(await scalar(`select count(*)::int from bx1_portal.${table}`), 0,
      `${table} migration seeds no authority`)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      eq(await scalar('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')',
        [role, `bx1_portal.${table}`]), false, `${role} cannot directly mutate ${table}`)
    }
  }
  for (const legacyWriter of ['bx1_portal.execute_command(text,uuid,jsonb)',
    'public.bx1_portal_command(text,uuid,jsonb)',
    'bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)']) {
    eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',
      ['authenticated', legacyWriter]), false,
    `authenticated cannot bypass scoped command through ${legacyWriter}`)
  }
  eq(await scalar('select bx1_portal.offering_approved($1)', [reviewedProperty.id]), false,
    'historical review decisions do not silently acquire product appointments')
  const issuerMembershipId = await scalar(`select id from public.bx1_memberships
    where user_id=$1 and organisation_id=$2 and role='IssuerFundManager'`, [uid(13), nativeScope])
  const complianceMembershipId = await scalar(`select id from public.bx1_memberships
    where user_id=$1 and organisation_id=$2 and role='ComplianceOfficer'`, [uid(2), nativeScope])
  truth(issuerMembershipId && complianceMembershipId, 'pre-existing staff roles are prerequisites only')
  phase = 'stage3-legacy-manager-draft-action-projection'
  // Actor 5's synthetic session was raised to AAL2 earlier. AAL1 claims are
  // stale and must not be used even for this read-only projection proof.
  const legacyManagerDraft = (await mandateScopedRead(5, manager)).products
    .find(value => value.id === delegatedProduct.id)
  eq([legacyManagerDraft.allowed_actions.includes('save_product'),
    legacyManagerDraft.allowed_actions.includes('submit_product')], [true, false],
  'historical v1 draft exposes manager upgrade editor but not v1 submission')
  const appointedFundName = 'Synthetic exact-product appointment fund'
  let appointedFund = (await scopedCommand(1, manager, 'create_product', {
    organisation_id: orgId, terms: fundV2Terms(appointedFundName),
  })).products.find(value => value.terms.name === appointedFundName)
  const candidates = (await scopedRead(1, manager)).product_appointment_candidates
  truth(candidates.some(value => value.product_id === appointedFund.id
    && value.role === 'IssuerFundManager' && value.membership_id === issuerMembershipId),
  'manager sees only role candidate for its own editable product')
  eq((await mandateScopedRead(13, issuerContext)).product_appointment_candidates.length, 0,
    'issuer cannot enumerate manager candidate directory')
  const until = new Date(Date.now() + 14 * 86400000).toISOString()
  const appointmentInput = (targetRole, appointee, membership) => ({
    product_id: appointedFund.id, role: targetRole, appointee_user_id: uid(appointee),
    native_membership_id: membership, expected_product_revision: appointedFund.revision,
    evidence_reference: `SYNTHETIC-APPOINTMENT-${targetRole}-2026-09-28`, requested_until: until,
  })
  const issuerRequest = appointmentInput('IssuerFundManager', 13, issuerMembershipId)
  await denied('issuer cannot appoint itself from role label', () => mandateScopedCommand(13, issuerContext,
    'request_product_service_appointment', issuerRequest), '42501')
  const issuerKey = key()
  let issuerAppointment = (await scopedCommand(1, manager,
    'request_product_service_appointment', issuerRequest, issuerKey)).product_appointments
    .find(value => value.product_id === appointedFund.id && value.role === 'IssuerFundManager')
  eq(issuerAppointment.status, 'SUBMITTED', 'manager request confers no issuer authority')
  eq((await scopedCommand(1, manager, 'request_product_service_appointment', issuerRequest,
    issuerKey)).product_appointments.find(value => value.id === issuerAppointment.id).revision, 1,
  'exact appointment request replay is idempotent')
  await denied('same request key cannot nominate a different person', () => scopedCommand(1, manager,
    'request_product_service_appointment', { ...issuerRequest, appointee_user_id: uid(4) },
    issuerKey), '23505')
  const complianceRequest = appointmentInput('ComplianceOfficer', 2, complianceMembershipId)
  let complianceAppointment = (await scopedCommand(1, manager,
    'request_product_service_appointment', complianceRequest)).product_appointments
    .find(value => value.product_id === appointedFund.id && value.role === 'ComplianceOfficer')
  eq(complianceAppointment.status, 'SUBMITTED', 'separate Compliance appointment also starts pending')
  const reviewAppointment = appointment => ({ appointment_id: appointment.id,
    expected_revision: appointment.revision, decision: 'APPROVED',
    notes: 'Independent synthetic review of exact product appointment and cited scope.',
    checks: { appointment: true, evidence: true, scope: true } })
  await denied('appointee cannot review own appointment', () => mandateScopedCommand(2, reviewer,
    'review_product_service_appointment', reviewAppointment(complianceAppointment)), '42501')
  issuerAppointment = (await mandateScopedCommand(11, reviewer,
    'review_product_service_appointment', reviewAppointment(issuerAppointment))).product_appointments
    .find(value => value.id === issuerAppointment.id)
  complianceAppointment = (await mandateScopedCommand(11, reviewer,
    'review_product_service_appointment', reviewAppointment(complianceAppointment))).product_appointments
    .find(value => value.id === complianceAppointment.id)
  eq([issuerAppointment.status, complianceAppointment.status], ['APPROVED', 'APPROVED'],
    'independent review alone grants neither product decision')
  await denied('appointee cannot self-apply via second Super Admin role', () => mandateScopedCommand(2,
    roleContext('SuperAdmin'), 'apply_product_service_appointment', {
      appointment_id: complianceAppointment.id, expected_revision: complianceAppointment.revision,
    }), '42501')
  await db.query('savepoint appointment_reviewer_second_role')
  await admin()
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','ACTIVE')",
    [uid(11), nativeScope])
  await denied('actual appointment reviewer cannot self-apply through a second role',
    () => mandateScopedCommand(11, roleContext('SuperAdmin'),
      'apply_product_service_appointment', {
        appointment_id: issuerAppointment.id, expected_revision: issuerAppointment.revision,
      }), '42501')
  await db.query('rollback to savepoint appointment_reviewer_second_role; release savepoint appointment_reviewer_second_role')
  issuerAppointment = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
    'apply_product_service_appointment', { appointment_id: issuerAppointment.id,
      expected_revision: issuerAppointment.revision })).product_appointments
    .find(value => value.id === issuerAppointment.id)
  complianceAppointment = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
    'apply_product_service_appointment', { appointment_id: complianceAppointment.id,
      expected_revision: complianceAppointment.revision })).product_appointments
    .find(value => value.id === complianceAppointment.id)
  eq([issuerAppointment.effective, complianceAppointment.effective], [true, true],
    'two exact-product appointments applied without organisation-wide binding creation')
  phase = 'stage3-expired-pending-appointment-replacement'
  const expiredRequestFor = async (label, source, role, appointee, membership) => {
    const productName = `Synthetic expired ${label} appointment fund`
    const product = (await scopedCommand(1, manager, 'create_product', {
      organisation_id: orgId, terms: fundV2Terms(productName),
    })).products.find(value => value.terms.name === productName)
    await admin()
    const oldId = await scalar(`insert into bx1_portal.product_service_appointments(
      product_id,product_organisation_id,reviewer_scope_organisation_id,role,
      appointee_user_id,native_membership_id,requested_by_user_id,requested_in_context,
      product_revision_at_request,terms_hash_at_request,evidence_reference,requested_until)
      select p.id,p.organisation_id,a.reviewer_scope_organisation_id,a.role,
        a.appointee_user_id,a.native_membership_id,a.requested_by_user_id,a.requested_in_context,
        p.revision,p.terms_hash,a.evidence_reference,clock_timestamp()-interval '1 hour'
      from bx1_portal.products p cross join bx1_portal.product_service_appointments a
      where p.id=$1 and a.id=$2 returning id`, [product.id, source.id])
    const request = { product_id: product.id, role, appointee_user_id: uid(appointee),
      native_membership_id: membership, expected_product_revision: product.revision,
      evidence_reference: `SYNTHETIC-REPLACEMENT-${label}-2026-09-28`, requested_until: until }
    return { oldId, product, request }
  }
  const expiredIssuer = await expiredRequestFor('issuer-submitted', issuerAppointment,
    'IssuerFundManager', 13, issuerMembershipId)
  const expiredIssuerView = (await mandateScopedRead(11, reviewer)).product_appointments
    .find(value => value.id === expiredIssuer.oldId)
  eq([expiredIssuerView.status, expiredIssuerView.can_review, expiredIssuerView.next_owner],
    ['SUBMITTED', false, 'OFFERING_MANAGER'], 'expired pending issuer review is not falsely actionable')
  const replacementIssuerKey = key()
  const replacementIssuer = (await scopedCommand(1, manager,
    'request_product_service_appointment', expiredIssuer.request, replacementIssuerKey))
    .product_appointments.find(value => value.product_id === expiredIssuer.product.id && value.status === 'SUBMITTED')
  truth(replacementIssuer?.id && replacementIssuer.id !== expiredIssuer.oldId,
    'manager may replace an expired unreviewed nomination without resurrecting it')
  await admin()
  eq(await scalar('select status from bx1_portal.product_service_appointments where id=$1',
    [expiredIssuer.oldId]), 'EXPIRED', 'old unreviewed nomination is terminally expired')
  eq(await scalar(`select jsonb_build_object(
    'receipts',(select count(*) from bx1_portal.product_service_appointment_receipts
      where appointment_id=$1 and action='expire_product_service_appointment'),
    'events',(select count(*) from bx1_portal.events
      where subject_id=$1 and kind='expire_product_service_appointment'))`, [expiredIssuer.oldId]),
  { receipts: 1, events: 1 }, 'replacement records one immutable expiry receipt and audit event')
  eq((await scopedCommand(1, manager, 'request_product_service_appointment',
    expiredIssuer.request, replacementIssuerKey)).product_appointments
    .find(value => value.id === replacementIssuer.id).revision, 1,
  'replacement replay cannot expire twice or create another nomination')
  const expiredCompliance = await expiredRequestFor('compliance-approved', complianceAppointment,
    'ComplianceOfficer', 2, complianceMembershipId)
  await admin()
  const historicalApprovalId = await scalar(`insert into bx1_portal.product_service_appointment_receipts(
    appointment_id,appointment_revision,action,actor_id,operating_context,command_payload,status_after)
    values($1,2,'review_product_service_appointment',$2,$3::jsonb,
      '{"decision":"APPROVED","source":"synthetic-expiry-fixture"}'::jsonb,'APPROVED') returning id`,
  [expiredCompliance.oldId, uid(11), JSON.stringify(reviewer)])
  await db.query(`update bx1_portal.product_service_appointments set revision=2,status='APPROVED',
    reviewed_at=clock_timestamp(),reviewed_by_user_id=$2,
    review_notes='Synthetic reviewed nomination elapsed before application.',
    review_checks='{"appointment":true,"evidence":true,"scope":true}'::jsonb,
    approval_receipt_id=$3 where id=$1`, [expiredCompliance.oldId, uid(11), historicalApprovalId])
  const expiredComplianceView = (await mandateScopedRead(10, roleContext('SuperAdmin')))
    .product_appointments.find(value => value.id === expiredCompliance.oldId)
  eq([expiredComplianceView.status, expiredComplianceView.can_apply,
    expiredComplianceView.next_owner], ['APPROVED', false, 'OFFERING_MANAGER'],
  'expired approved nomination is not falsely applicable')
  const replacementCompliance = (await scopedCommand(1, manager,
    'request_product_service_appointment', expiredCompliance.request)).product_appointments
    .find(value => value.product_id === expiredCompliance.product.id && value.status === 'SUBMITTED')
  truth(replacementCompliance?.id && replacementCompliance.id !== expiredCompliance.oldId,
    'manager may replace an expired approved nomination')
  await admin()
  eq(await scalar('select status from bx1_portal.product_service_appointments where id=$1',
    [expiredCompliance.oldId]), 'EXPIRED', 'old approved nomination cannot become effective later')
  await denied('expired appointment cannot be revived by an internal state update', async () => {
    await admin()
    await db.query("update bx1_portal.product_service_appointments set revision=revision+1,status='APPLIED',applied_at=clock_timestamp(),applied_by_user_id=$2 where id=$1",
      [expiredCompliance.oldId, uid(10)])
  }, '23514')
  await db.query('savepoint appointment_suspended_profile')
  await admin()
  await db.query("update public.bx1_profiles set status='SUSPENDED' where id=$1", [uid(13)])
  eq(await scalar('select bx1_portal.product_appointment_effective($1)', [issuerAppointment.id]), false,
    'suspended appointee profile immediately disables an applied appointment')
  await db.query('rollback to savepoint appointment_suspended_profile; release savepoint appointment_suspended_profile')
  await db.query('savepoint appointment_offering_amendment')
  let amendmentPackage = (await scopedCommand(1, manager, 'submit_product', {
    product_id: appointedFund.id, expected_revision: appointedFund.revision,
  })).products.find(value => value.id === appointedFund.id)
  const oldOfferingRevision = amendmentPackage.offering_package.id
  amendmentPackage = (await mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(amendmentPackage))).products.find(value =>
    value.id === appointedFund.id)
  amendmentPackage = (await mandateScopedCommand(2, reviewer,
    'review_product', complianceInput(amendmentPackage, 'CHANGES_REQUIRED'))).products.find(value =>
    value.id === appointedFund.id)
  eq(amendmentPackage.status, 'CHANGES_REQUIRED',
    'independent Compliance requests changes on the exact first offering revision')
  const amendedAppointmentFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: amendmentPackage.revision,
    terms: fundV2Terms(`${appointedFundName} amended`),
  })).products.find(value => value.id === appointedFund.id)
  const restoredAppointmentFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: amendedAppointmentFund.revision,
    terms: fundV2Terms(appointedFundName),
  })).products.find(value => value.id === appointedFund.id)
  eq(restoredAppointmentFund.terms_hash, appointedFund.terms_hash,
    'restored terms have the original hash')
  await admin()
  eq(await scalar('select bx1_portal.product_appointment_effective($1)', [issuerAppointment.id]), true,
    'time-limited product service appointment survives offering amendment')
  await denied('restoring the same terms hash cannot resubmit an unchanged package',
    () => scopedCommand(1, manager, 'submit_product', {
      product_id: appointedFund.id, expected_revision: restoredAppointmentFund.revision,
    }), '23514')
  const finalAmendedAppointmentFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: restoredAppointmentFund.revision,
    terms: fundV2Terms(`${appointedFundName} amended and resubmitted`),
  })).products.find(value => value.id === appointedFund.id)
  const resubmittedAppointmentFund = (await scopedCommand(1, manager, 'submit_product', {
    product_id: appointedFund.id, expected_revision: finalAmendedAppointmentFund.revision,
  })).products.find(value => value.id === appointedFund.id)
  truth(resubmittedAppointmentFund.offering_package.id !== oldOfferingRevision,
    'restored terms create a new immutable offering revision')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.offering_decisions where offering_revision_id=$1',
    [resubmittedAppointmentFund.offering_package.id]), 0,
  'old issuer and Compliance decisions cannot carry onto a new revision with the same hash')
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), false,
    'new offering needs fresh issuer and Compliance decisions after hash restoration')
  await db.query('rollback to savepoint appointment_offering_amendment; release savepoint appointment_offering_amendment')
  await admin()
  await db.query(`update bx1_portal.organisation_authority_bindings set status='REVOKED'
    where product_organisation_id=$1 and role in ('IssuerFundManager','ComplianceOfficer')
      and status='ACTIVE'`, [orgId])
  eq(await scalar(`select count(*)::int from bx1_portal.organisation_authority_bindings
    where product_organisation_id=$1 and role in ('IssuerFundManager','ComplianceOfficer')
      and status='ACTIVE'`, [orgId]), 0,
  'appointment authority does not depend on manually seeded org-wide issuer or Compliance bindings')
  appointedFund = (await scopedCommand(1, manager, 'submit_product', {
    product_id: appointedFund.id, expected_revision: appointedFund.revision,
  })).products.find(value => value.id === appointedFund.id)
  checks += await proveOfferingFileProductIsolation(db, {
    appointedRevisionId: appointedFund.offering_package.id,
    otherRevisionId: reviewedProperty.offering_package.id,
    issuerContext, signInIssuer: () => actor(13, { aal: 'aal2' }),
  })
  phase = 'stage3-exact-appointed-offering-decisions'
  const issuerState = await mandateScopedRead(13, issuerContext)
  truth(issuerState.products.some(value => value.id === appointedFund.id),
    'issuer sees only the explicitly appointed product after old broad binding revocation')
  eq(['save_product','submit_product'].some(action => issuerState.products
    .find(value => value.id === appointedFund.id).allowed_actions.includes(action)), false,
  'issuer appointment does not expose manager edit or submit actions')
  appointedFund = (await mandateScopedCommand(13, issuerContext, 'review_offering_issuer',
    issuerInput(appointedFund))).products.find(value => value.id === appointedFund.id)
  eq(appointedFund.offering_package.issuer_status, 'APPROVED',
    'issuer decision is bound to its exact active product appointment')
  await admin()
  eq(await scalar(`select product_appointment_id from bx1_portal.offering_decisions
    where offering_revision_id=$1 and decision_kind='ISSUER'`, [appointedFund.offering_package.id]),
  issuerAppointment.id, 'immutable issuer decision records appointment identity')
  const exactComplianceState = await mandateScopedRead(2, reviewer)
  truth(exactComplianceState.products.some(value => value.id === appointedFund.id
    && value.offering_package.can_review_compliance),
  'appointed Compliance sees and can review the exact product without an org-wide binding')
  eq(exactComplianceState.products.some(value => value.id === reviewedProperty.id), false,
    'exact product appointment does not expose another product in the same organisation')
  const complianceDecisionPayload = complianceInput(appointedFund)
  const complianceDecisionKey = key()
  appointedFund = (await mandateScopedCommand(2, reviewer, 'review_product',
    complianceDecisionPayload, complianceDecisionKey)).products.find(value => value.id === appointedFund.id)
  eq([appointedFund.status, appointedFund.offering_package.compliance_status],
    ['APPROVED', 'APPROVED'],
  'appointed Compliance completes independent review through the exact-product writer')
  eq((await mandateScopedCommand(2, reviewer, 'review_product',
    complianceDecisionPayload, complianceDecisionKey)).products.find(value =>
    value.id === appointedFund.id).revision, appointedFund.revision,
  'exact Compliance command replay leaves product revision unchanged')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'native',(select count(*) from bx1_portal.requests where actor_id=$1 and request_key=$2),
    'scoped',(select count(*) from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2),
    'events',(select count(*) from bx1_portal.events where actor_id=$1 and subject_id=$3 and kind='review_product'),
    'decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$4 and decision_kind='COMPLIANCE'))`,
  [uid(2), complianceDecisionKey, appointedFund.id, appointedFund.offering_package.id]),
  { native: 1, scoped: 1, events: 1, decisions: 1 },
  'one exact Compliance decision has one native receipt, scoped receipt, event and immutable decision')
  eq(await scalar(`select product_appointment_id from bx1_portal.offering_decisions
    where offering_revision_id=$1 and decision_kind='COMPLIANCE'`, [appointedFund.offering_package.id]),
  complianceAppointment.id, 'immutable Compliance decision records exact appointment identity')
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), true,
    'both appointed human decisions approve the package without opening funding')
  phase = 'stage3-approved-offering-explicit-reopen'
  const originalOfferingId = appointedFund.offering_package.id
  const originalPackageNumber = appointedFund.offering_package.package_number
  const reopenPayload = { product_id: appointedFund.id,
    expected_revision: appointedFund.revision,
    reason: 'Synthetic service-appointment change requires both reviewers to decide a fresh immutable offering revision.' }
  const reopenKey = key()
  const managerBeforeReopen = await scopedRead(1, manager)
  truth(managerBeforeReopen.products.find(value => value.id === appointedFund.id)
    .allowed_actions.includes('reopen_offering_review'),
  'exact approved product offers explicit re-review to its current manager')
  truth(managerBeforeReopen.organisations.find(value => value.id === orgId)
    .capabilities.includes('reopen_offering_review'),
  'manager organisation advertises recovery only while a relevant product is reopenable')
  eq(managerBeforeReopen.products.find(value => value.id === reviewedProperty.id)
    ?.allowed_actions.includes('reopen_offering_review') ?? false, false,
  'unrelated property cannot inherit the fund reopen action')
  await db.query('savepoint reopen_approved_offering')
  await denied('wrong organisation cannot reopen an approved offering',
    () => scopedCommand(1, roleContext('OfferingManager', otherScope),
      'reopen_offering_review', reopenPayload), '42501')
  await denied('stale approved product revision cannot be reopened',
    () => scopedCommand(1, manager, 'reopen_offering_review',
      { ...reopenPayload, expected_revision: appointedFund.revision - 1 }), '23514')
  await db.query('savepoint reopen_never_published')
  await admin(); await db.query('update bx1_portal.products set published_at=clock_timestamp() where id=$1',
    [appointedFund.id])
  await denied('a product with publication history cannot be reopened',
    () => scopedCommand(1, manager, 'reopen_offering_review', reopenPayload), '23514')
  await db.query('rollback to savepoint reopen_never_published; release savepoint reopen_never_published')
  await db.query('savepoint reopen_no_reservations')
  await admin(); await db.query('update bx1_portal.products set reserved_units=1 where id=$1',
    [appointedFund.id])
  await denied('a product with reserved units cannot be reopened',
    () => scopedCommand(1, manager, 'reopen_offering_review', reopenPayload), '23514')
  await db.query('rollback to savepoint reopen_no_reservations; release savepoint reopen_no_reservations')
  await db.query('savepoint reopen_main_seal')
  await admin(); await db.query(`update bx1_portal.entry_configuration
    set environment='MAINNET',manual_test_review=false where singleton`)
  await denied('MAIN-equivalent seal rejects approved-offering reopen',
    () => scopedCommand(1, manager, 'reopen_offering_review', reopenPayload), '42501')
  await db.query('rollback to savepoint reopen_main_seal; release savepoint reopen_main_seal')
  await admin()
  const reopenBeforeAudit = await scalar(`select jsonb_build_object(
    'product',(select jsonb_build_object('status',status,'revision',revision,
      'offering',current_offering_revision_id) from bx1_portal.products where id=$1),
    'packages',(select count(*) from bx1_portal.offering_revisions where product_id=$1),
    'receipts',(select count(*) from bx1_portal.offering_review_reopen_receipts where product_id=$1),
    'requests',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3))`,
  [appointedFund.id, uid(1), reopenKey])
  await db.query('savepoint reopen_audit_failure')
  await admin(); await db.query(`create function public.synthetic_reopen_audit_failure() returns trigger
    language plpgsql as $$ begin if NEW.kind='reopen_offering_review' then
    raise exception 'synthetic_reopen_audit_failure' using errcode='23514'; end if;
    return NEW; end $$;
    create trigger synthetic_reopen_audit_failure before insert on bx1_portal.events
    for each row execute function public.synthetic_reopen_audit_failure()`)
  await denied('required audit failure rolls back reopened revision and receipt',
    () => scopedCommand(1, manager, 'reopen_offering_review', reopenPayload, reopenKey), '23514')
  await db.query('rollback to savepoint reopen_audit_failure; release savepoint reopen_audit_failure')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'product',(select jsonb_build_object('status',status,'revision',revision,
      'offering',current_offering_revision_id) from bx1_portal.products where id=$1),
    'packages',(select count(*) from bx1_portal.offering_revisions where product_id=$1),
    'receipts',(select count(*) from bx1_portal.offering_review_reopen_receipts where product_id=$1),
    'requests',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3))`,
  [appointedFund.id, uid(1), reopenKey]), reopenBeforeAudit,
  'failed audit leaves product, immutable package history, receipt and idempotency unchanged')
  let reopenedOffering = (await scopedCommand(1, manager, 'reopen_offering_review',
    reopenPayload, reopenKey)).products.find(value => value.id === appointedFund.id)
  eq([reopenedOffering.status, reopenedOffering.revision,
    reopenedOffering.offering_package.package_number],
    ['IN_REVIEW', appointedFund.revision + 1, originalPackageNumber + 1],
  'explicit reopen increments enduring product and immutable package number')
  truth(reopenedOffering.offering_package.id !== originalOfferingId,
    'reopen creates a different immutable offering identity even with unchanged terms')
  eq(reopenedOffering.terms_hash, appointedFund.terms_hash,
    'reopen does not alter approved economic terms without a separate amendment command')
  eq((await scopedCommand(1, manager, 'reopen_offering_review',
    reopenPayload, reopenKey)).products.find(value => value.id === appointedFund.id)
    .offering_package.id, reopenedOffering.offering_package.id,
  'exact replay returns the same new revision without a second write')
  await denied('reopen idempotency key cannot be reused with another reason',
    () => scopedCommand(1, manager, 'reopen_offering_review',
      { ...reopenPayload, reason: `${reopenPayload.reason} Changed.` }, reopenKey), '23505')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'old_decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$1),
    'new_decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$2),
    'receipts',(select count(*) from bx1_portal.offering_review_reopen_receipts where actor_id=$3 and request_key=$4),
    'requests',(select count(*) from bx1_portal.scoped_requests where actor_id=$3 and request_key=$4),
    'events',(select count(*) from bx1_portal.events where subject_id=$5 and kind='reopen_offering_review'),
    'orders',(select count(*) from bx1_portal.subscriptions where product_id=$5),
    'reserved',(select reserved_units::text from bx1_portal.products where id=$5))`,
  [originalOfferingId, reopenedOffering.offering_package.id, uid(1), reopenKey, appointedFund.id]),
  { old_decisions: 2, new_decisions: 0, receipts: 1, requests: 1,
    events: 1, orders: 0, reserved: '0' },
  'old decisions remain immutable and the new revision has one receipt/event but no financial effects')
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), false,
    'still-effective old appointments and decisions do not approve the new revision')
  reopenedOffering = (await mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(reopenedOffering))).products.find(value => value.id === appointedFund.id)
  reopenedOffering = (await mandateScopedCommand(2, reviewer,
    'review_product', complianceInput(reopenedOffering))).products.find(value => value.id === appointedFund.id)
  eq([reopenedOffering.status, reopenedOffering.offering_package.issuer_status,
    reopenedOffering.offering_package.compliance_status], ['APPROVED','APPROVED','APPROVED'],
  'fresh issuer and Compliance decisions approve only the new immutable revision')
  await db.query('rollback to savepoint reopen_approved_offering; release savepoint reopen_approved_offering')
  await db.query('savepoint reopen_after_authority_loss')
  await admin(); await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1 and status='TRUSTED'",
    [uid(11)])
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), false,
    'a now-ineffective historical appointment does not count as current approval')
  const reopenedAfterLoss = (await scopedCommand(1, manager, 'reopen_offering_review',
    reopenPayload)).products.find(value => value.id === appointedFund.id)
  eq([reopenedAfterLoss.status, reopenedAfterLoss.offering_package.issuer_status,
    reopenedAfterLoss.offering_package.compliance_status], ['IN_REVIEW','PENDING','PENDING'],
  'manager can recover a never-published approved package after appointment authority loss')
  await db.query('rollback to savepoint reopen_after_authority_loss; release savepoint reopen_after_authority_loss')
  phase = 'stage3-explicit-offering-terms-amendment'
  const amendmentPayload = { product_id: appointedFund.id,
    expected_revision: appointedFund.revision,
    reason: 'Synthetic reviewed manager requests amended fund terms with complete fresh issuer and Compliance decisions.' }
  const amendmentKey = key()
  const amendmentView = await scopedRead(1, manager)
  truth(amendmentView.products.find(value => value.id === appointedFund.id)
    .allowed_actions.includes('begin_offering_amendment'),
  'only the exact approved product exposes the begin-amendment action')
  truth(amendmentView.organisations.find(value => value.id === orgId)
    .capabilities.includes('begin_offering_amendment'),
  'current manager organisation advertises a governed amendment for its eligible product')
  await db.query('savepoint begin_amendment_proof')
  await denied('malformed product ID cannot begin an offering amendment',
    () => scopedCommand(1, manager, 'begin_offering_amendment',
      { ...amendmentPayload, product_id: 'not-a-uuid' }), '22023')
  await denied('wrong organisation cannot begin an offering amendment',
    () => scopedCommand(1, roleContext('OfferingManager', otherScope),
      'begin_offering_amendment', amendmentPayload), '42501')
  await denied('stale approved product cannot begin an amendment',
    () => scopedCommand(1, manager, 'begin_offering_amendment',
      { ...amendmentPayload, expected_revision: appointedFund.revision - 1 }), '23514')
  await db.query('savepoint amendment_file_intent_block')
  await admin()
  const blockedFileId = key()
  await db.query(`insert into bx1_portal.offering_file_upload_intents
    (id,offering_revision_id,product_id,actor_id,kind,title,storage_path,sha256,byte_size)
    values($1,$2,$3,$4,'MEMORANDUM','Synthetic unresolved PDF intent',$5,$6,100)`,
  [blockedFileId, originalOfferingId, appointedFund.id, uid(1),
    `${originalOfferingId}/${uid(1)}/${blockedFileId}`, 'a'.repeat(64)])
  await denied('unresolved offering-file intent blocks amendment',
    () => scopedCommand(1, manager, 'begin_offering_amendment', amendmentPayload), '23514')
  await db.query('rollback to savepoint amendment_file_intent_block; release savepoint amendment_file_intent_block')
  await db.query('savepoint amendment_main_seal')
  await admin(); await db.query(`update bx1_portal.entry_configuration
    set environment='MAINNET',manual_test_review=false where singleton`)
  await denied('MAIN-equivalent seal rejects synthetic amendment',
    () => scopedCommand(1, manager, 'begin_offering_amendment', amendmentPayload), '42501')
  await db.query('rollback to savepoint amendment_main_seal; release savepoint amendment_main_seal')
  await admin()
  const amendmentBaseline = await scalar(`select jsonb_build_object(
    'product',(select jsonb_build_object('status',status,'revision',revision,
      'offering',current_offering_revision_id) from bx1_portal.products where id=$1),
    'receipts',(select count(*) from bx1_portal.offering_amendment_begin_receipts where product_id=$1),
    'requests',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3))`,
  [appointedFund.id, uid(1), amendmentKey])
  await db.query('savepoint amendment_audit_failure')
  await admin(); await db.query(`create function public.synthetic_amendment_audit_failure() returns trigger
    language plpgsql as $$ begin if NEW.kind='begin_offering_amendment' then
    raise exception 'synthetic_amendment_audit_failure' using errcode='23514'; end if;
    return NEW; end $$;
    create trigger synthetic_amendment_audit_failure before insert on bx1_portal.events
    for each row execute function public.synthetic_amendment_audit_failure()`)
  await denied('mandatory audit failure rolls back amendment and receipt',
    () => scopedCommand(1, manager, 'begin_offering_amendment', amendmentPayload,
      amendmentKey), '23514')
  await db.query('rollback to savepoint amendment_audit_failure; release savepoint amendment_audit_failure')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'product',(select jsonb_build_object('status',status,'revision',revision,
      'offering',current_offering_revision_id) from bx1_portal.products where id=$1),
    'receipts',(select count(*) from bx1_portal.offering_amendment_begin_receipts where product_id=$1),
    'requests',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3))`,
  [appointedFund.id, uid(1), amendmentKey]), amendmentBaseline,
  'audit rejection preserves approved state, pointer and immutable receipt count')
  let amendingFund = (await scopedCommand(1, manager, 'begin_offering_amendment',
    amendmentPayload, amendmentKey)).products.find(value => value.id === appointedFund.id)
  eq([amendingFund.status, amendingFund.revision, amendingFund.offering_package],
    ['CHANGES_REQUIRED', appointedFund.revision + 1, null],
  'amendment detaches the reviewed package without deleting its decision history')
  eq([amendingFund.allowed_actions.includes('save_product'),
    amendingFund.allowed_actions.includes('submit_product')], [true, false],
  'amendment opens exact manager editor but not unchanged-terms submission')
  eq((await scopedCommand(1, manager, 'begin_offering_amendment', amendmentPayload,
    amendmentKey)).products.find(value => value.id === appointedFund.id).revision,
  amendingFund.revision, 'exact amendment replay creates no second transition')
  await denied('amendment key cannot be reused for different reason',
    () => scopedCommand(1, manager, 'begin_offering_amendment',
      { ...amendmentPayload, reason: `${amendmentPayload.reason} Different.` }, amendmentKey), '23505')
  await denied('first amendment save cannot retain unchanged approved terms',
    () => scopedCommand(1, manager, 'save_product', {
      product_id: appointedFund.id, expected_revision: amendingFund.revision,
      terms: fundV2Terms(appointedFundName),
    }), '23514')
  const amendedTerms = fundV2Terms(`${appointedFundName} governed amended class`)
  amendingFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: amendingFund.revision,
    terms: amendedTerms,
  })).products.find(value => value.id === appointedFund.id)
  eq([amendingFund.status, amendingFund.offering_package], ['DRAFT', null],
  'changed terms remain a draft without inherited approval')
  eq([amendingFund.allowed_actions.includes('save_product'),
    amendingFund.allowed_actions.includes('submit_product')], [true, true],
  'changed draft terms expose both exact manager editing and fresh submission')
  const restoredTermsFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: amendingFund.revision,
    terms: fundV2Terms(appointedFundName),
  })).products.find(value => value.id === appointedFund.id)
  eq(restoredTermsFund.allowed_actions.includes('submit_product'), false,
    'changed-then-restored hash cannot advertise a forbidden resubmission')
  await denied('changed-then-restored approved hash cannot reuse old decisions',
    () => scopedCommand(1, manager, 'submit_product', {
      product_id: appointedFund.id, expected_revision: restoredTermsFund.revision,
    }), '23514')
  amendingFund = (await scopedCommand(1, manager, 'save_product', {
    product_id: appointedFund.id, expected_revision: restoredTermsFund.revision,
    terms: amendedTerms,
  })).products.find(value => value.id === appointedFund.id)
  amendingFund = (await scopedCommand(1, manager, 'submit_product', {
    product_id: appointedFund.id, expected_revision: amendingFund.revision,
  })).products.find(value => value.id === appointedFund.id)
  truth(amendingFund.offering_package.id !== originalOfferingId,
    'genuinely amended terms produce a new immutable submitted package')
  eq([amendingFund.allowed_actions.includes('save_product'),
    amendingFund.allowed_actions.includes('submit_product')], [false, false],
  'submitted immutable package no longer exposes edit or duplicate submit actions')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'old_decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$1),
    'new_decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$2),
    'receipts',(select count(*) from bx1_portal.offering_amendment_begin_receipts where actor_id=$3 and request_key=$4),
    'events',(select count(*) from bx1_portal.events where subject_id=$5 and kind='begin_offering_amendment'),
    'orders',(select count(*) from bx1_portal.subscriptions where product_id=$5),
    'reserved',(select reserved_units::text from bx1_portal.products where id=$5))`,
  [originalOfferingId, amendingFund.offering_package.id, uid(1), amendmentKey, appointedFund.id]),
  { old_decisions: 2, new_decisions: 0, receipts: 1, events: 1, orders: 0, reserved: '0' },
  'old decisions stay historical and amended package starts without orders or inherited decisions')
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), false,
    'new amended package requires a new decision pair')
  amendingFund = (await mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(amendingFund))).products.find(value => value.id === appointedFund.id)
  amendingFund = (await mandateScopedCommand(2, reviewer,
    'review_product', complianceInput(amendingFund))).products.find(value => value.id === appointedFund.id)
  eq(amendingFund.status, 'APPROVED', 'independent issuer and Compliance review the amended package')
  await db.query('rollback to savepoint begin_amendment_proof; release savepoint begin_amendment_proof')
  phase = 'stage3-same-hash-offering-submitter-lineage'
  const lineageFundName = 'Synthetic two-manager same-hash lineage fund'
  let lineageFund = (await scopedCommand(1, manager, 'create_product', {
    organisation_id: orgId, terms: fundV2Terms(lineageFundName),
  })).products.find(value => value.terms.name === lineageFundName)
  lineageFund = (await mandateScopedCommand(5, manager, 'submit_product', {
    product_id: lineageFund.id, expected_revision: lineageFund.revision,
  })).products.find(value => value.id === lineageFund.id)
  const lineageOriginalRevisionId = lineageFund.offering_package.id
  const nominateForLineage = async (role, appointee, membership, evidence) => {
    let appointment = (await scopedCommand(1, manager, 'request_product_service_appointment', {
      product_id: lineageFund.id, role, appointee_user_id: uid(appointee),
      native_membership_id: membership, expected_product_revision: lineageFund.revision,
      evidence_reference: evidence, requested_until: until,
    })).product_appointments.find(value => value.product_id === lineageFund.id
      && value.role === role && value.status === 'SUBMITTED')
    appointment = (await mandateScopedCommand(11, reviewer,
      'review_product_service_appointment', reviewAppointment(appointment)))
      .product_appointments.find(value => value.id === appointment.id)
    return (await mandateScopedCommand(10, roleContext('SuperAdmin'),
      'apply_product_service_appointment', {
        appointment_id: appointment.id, expected_revision: appointment.revision,
      })).product_appointments.find(value => value.id === appointment.id)
  }
  const lineageIssuerAppointment = await nominateForLineage('IssuerFundManager', 13,
    issuerMembershipId, 'SYNTHETIC-LINEAGE-ISSUER-2026-09-28')
  let lineageComplianceAppointment = await nominateForLineage('ComplianceOfficer', 2,
    complianceMembershipId, 'SYNTHETIC-LINEAGE-COMPLIANCE-2026-09-28')
  lineageFund = (await mandateScopedCommand(13, issuerContext,
    'review_offering_issuer', issuerInput(lineageFund))).products.find(value => value.id === lineageFund.id)
  lineageFund = (await mandateScopedCommand(2, reviewer,
    'review_product', complianceInput(lineageFund))).products.find(value => value.id === lineageFund.id)
  eq(lineageFund.status, 'APPROVED', 'two-manager lineage fixture starts from a genuinely reviewed package')
  lineageFund = (await scopedCommand(1, manager, 'reopen_offering_review', {
    product_id: lineageFund.id, expected_revision: lineageFund.revision,
    reason: 'Manager A reopens Manager B original terms for new appointment review without erasing original authorship.',
  })).products.find(value => value.id === lineageFund.id)
  await admin()
  eq(await scalar(`select jsonb_agg(jsonb_build_object('id',id,'submitted_by',submitted_by)
    order by package_number) from bx1_portal.offering_revisions
    where product_id=$1 and origin='SUBMITTED' and terms_hash=$2`,
  [lineageFund.id, lineageFund.terms_hash]), [
    { id: lineageOriginalRevisionId, submitted_by: uid(5) },
    { id: lineageFund.offering_package.id, submitted_by: uid(1) },
  ], 'same-hash lineage preserves B as original submitter and A as the actual reopener')
  await db.query('savepoint lineage_original_submitter_appointed')
  await admin()
  const lineageBMembership = await scalar(`insert into public.bx1_memberships
    (user_id,organisation_id,role,status) values($1,$2,'ComplianceOfficer','ACTIVE') returning id`,
  [uid(5), nativeScope])
  lineageComplianceAppointment = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
    'revoke_product_service_appointment', {
      appointment_id: lineageComplianceAppointment.id,
      expected_revision: lineageComplianceAppointment.revision,
      reason: 'Synthetic replacement to prove the original author cannot review unchanged terms.',
    })).product_appointments.find(value => value.id === lineageComplianceAppointment.id)
  const lineageBAppointment = await nominateForLineage('ComplianceOfficer', 5,
    lineageBMembership, 'SYNTHETIC-LINEAGE-ORIGINAL-AUTHOR-2026-09-28')
  await actor(5, { aal: 'aal2' })
  await admin()
  eq(await scalar('select bx1_portal.product_appointment_authorised($1::jsonb,$2,$3)',
    [JSON.stringify(reviewer), lineageFund.id, 'ComplianceOfficer']), true,
  'B has a current exact-product Compliance appointment, so denial is lineage-specific')
  const lineageBView = await mandateScopedRead(5, reviewer)
  eq(lineageBView.products.find(value => value.id === lineageFund.id)
    .offering_package.can_review_compliance, false,
  'original submitter B cannot see a same-hash review action after A reopens')
  eq(lineageBView.products.find(value => value.id === lineageFund.id)
    .allowed_actions.includes('review_product'), false,
  'exact product actions do not advertise a forbidden same-hash review')
  const lineageDeniedKey = key()
  await denied('original submitter cannot approve unchanged terms through later appointment',
    () => mandateScopedCommand(5, reviewer, 'review_product',
      complianceInput(lineageFund), lineageDeniedKey), '42501')
  await admin()
  eq(await scalar(`select jsonb_build_object(
    'decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$1),
    'native_receipts',(select count(*) from bx1_portal.requests where actor_id=$2 and request_key=$3),
    'scoped_receipts',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3),
    'events',(select count(*) from bx1_portal.events where subject_id=$4
      and actor_id=$2 and kind='review_product'))`,
  [lineageFund.offering_package.id, uid(5), lineageDeniedKey, lineageFund.id]),
  { decisions: 0, native_receipts: 0, scoped_receipts: 0, events: 0 },
  'same-hash original author denial commits no decision, receipt or event')
  eq(lineageBAppointment.effective, true,
    'proof denies content self-review despite a valid synthetic appointment')
  await db.query('rollback to savepoint lineage_original_submitter_appointed; release savepoint lineage_original_submitter_appointed')
  eq(lineageIssuerAppointment.effective, true,
    'issuer appointment remains available for the later two-connection lineage revocation proof')
  phase = 'stage3-appointment-main-seal'
  await db.query('savepoint appointment_main_seal')
  await admin(); await db.query(`update bx1_portal.entry_configuration
    set environment='MAINNET',manual_test_review=false where singleton`)
  await denied('MAIN-equivalent admission seal rejects synthetic appointment writes',
    () => scopedCommand(1, manager, 'request_product_service_appointment', issuerRequest), '42501')
  await db.query('rollback to savepoint appointment_main_seal; release savepoint appointment_main_seal')
  issuerAppointment = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
    'revoke_product_service_appointment', { appointment_id: issuerAppointment.id,
      expected_revision: issuerAppointment.revision,
      reason: 'Synthetic issuer scope revoked after exact-product decision proof.' })).product_appointments
    .find(value => value.id === issuerAppointment.id)
  eq(issuerAppointment.effective, false, 'revocation immediately removes product authority')
  await admin()
  eq(await scalar('select bx1_portal.offering_approved($1)', [appointedFund.id]), false,
    'revoked issuer authority removes current offering approval')
  eq((await mandateScopedRead(13, issuerContext)).products.some(value => value.id === appointedFund.id), false,
    'revoked issuer cannot read appointed product through old native role')
  await db.query('commit'); begun = false
  phase = 'stage3-product-appointment-product-first-lock-order'
  await db.query('begin'); begun = true
  await admin()
  await db.query('select id from bx1_portal.products where id=$1 for update', [appointedFund.id])
  const pendingAppointmentRevoke = (async () => {
    await proofClients[0].query('begin')
    try {
      const result = await mandateScopedCommand(10, roleContext('SuperAdmin'),
        'revoke_product_service_appointment', { appointment_id: complianceAppointment.id,
          expected_revision: complianceAppointment.revision,
          reason: 'Synthetic lock-order proof releases the remaining product appointment.' },
        key(), proofClients[0])
      await proofClients[0].query('commit')
      return { result }
    } catch (error) {
      await proofClients[0].query('rollback')
      return { code: error?.code }
    }
  })()
  await waitForBlocked([pids[0]])
  eq(await scalar('select $1::int=any(pg_blocking_pids($2::int))',
    [await scalar('select pg_backend_pid()'), pids[0]]), true,
  'appointment revocation waits on the main connection product lock')
  await proofClients[1].query('begin')
  let appointmentUnlocked = false
  try {
    await proofClients[1].query('select id from bx1_portal.product_service_appointments where id=$1 for update nowait',
      [complianceAppointment.id])
    appointmentUnlocked = true
  } catch (error) {
    if (error?.code !== '55P03') throw error
  } finally {
    await proofClients[1].query('rollback')
  }
  await db.query('commit'); begun = false
  const revokedAfterProductLock = await pendingAppointmentRevoke
  eq(appointmentUnlocked, true,
    'revocation waiting on product has not taken an inverse appointment lock')
  eq(revokedAfterProductLock.code, undefined,
    'waiting revocation completes after the product lock is released')
  eq(revokedAfterProductLock.result.product_appointments.find(value =>
    value.id === complianceAppointment.id).status, 'REVOKED',
  'product-first revocation retains one successful authority transition')
  phase = 'stage3-appointment-trust-revocation-race-preparation'
  await db.query('begin'); begun = true
  const prepareDecisionRace = async (label, targetRole, appointee, membership, reviewerNumber) => {
    const name = `Synthetic ${label} trust-revocation fund`
    let product = (await scopedCommand(1, manager, 'create_product', {
      organisation_id: orgId, terms: fundV2Terms(name),
    })).products.find(value => value.terms.name === name)
    let appointment = (await scopedCommand(1, manager, 'request_product_service_appointment', {
      product_id: product.id, role: targetRole, appointee_user_id: uid(appointee),
      native_membership_id: membership, expected_product_revision: product.revision,
      evidence_reference: `SYNTHETIC-TRUST-RACE-${label}-2026-09-28`, requested_until: until,
    })).product_appointments.find(value => value.product_id === product.id && value.role === targetRole)
    appointment = (await mandateScopedCommand(reviewerNumber, reviewer,
      'review_product_service_appointment', reviewAppointment(appointment))).product_appointments
      .find(value => value.id === appointment.id)
    appointment = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
      'apply_product_service_appointment', {
        appointment_id: appointment.id, expected_revision: appointment.revision,
      })).product_appointments.find(value => value.id === appointment.id)
    eq(appointment.effective, true, `${label} appointment is effective before the race`)
    product = (await scopedCommand(1, manager, 'submit_product', {
      product_id: product.id, expected_revision: product.revision,
    })).products.find(value => value.id === product.id)
    return { product, appointment }
  }
  const complianceTrustRace = await prepareDecisionRace('compliance-reviewer',
    'ComplianceOfficer', 2, complianceMembershipId, 11)
  const issuerTrustRace = await prepareDecisionRace('issuer-applier',
    'IssuerFundManager', 13, issuerMembershipId, 2)
  const directInsertRace = await prepareDecisionRace('direct-insert-lock-order',
    'ComplianceOfficer', 2, complianceMembershipId, 11)
  await db.query('commit'); begun = false
  phase = 'stage3-direct-decision-insert-vs-appointment-revoke'
  await admin()
  const directRevision = (await db.query(`select terms_hash,document_hashes from bx1_portal.offering_revisions
    where id=$1`, [directInsertRace.product.offering_package.id])).rows[0]
  await db.query('begin'); begun = true
  await db.query('select id from bx1_portal.products where id=$1 for update',
    [directInsertRace.product.id])
  const directDecision = (async () => {
    await proofClients[0].query('begin')
    try {
      await actor(2, { aal: 'aal2' }, proofClients[0])
      await proofClients[0].query('reset role')
      await proofClients[0].query(`insert into bx1_portal.offering_decisions
        (offering_revision_id,decision_kind,decision,actor_id,operating_context,
         terms_hash,document_hashes,product_revision_at_decision,notes,checks)
        values($1,'COMPLIANCE','APPROVED',$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8::jsonb)`,
      [directInsertRace.product.offering_package.id, uid(2), JSON.stringify(reviewer),
        directRevision.terms_hash, JSON.stringify(directRevision.document_hashes),
        directInsertRace.product.revision,
        'Synthetic direct internal decision used solely for product-first lock-order proof.',
        JSON.stringify(offeringChecks)])
      await proofClients[0].query('commit')
      return { code: undefined }
    } catch (error) {
      await proofClients[0].query('rollback')
      return { code: error?.code }
    }
  })()
  await waitForBlocked([pids[0]])
  eq(await scalar('select $1::int=any(pg_blocking_pids($2::int))',
    [await scalar('select pg_backend_pid()'), pids[0]]), true,
  'direct internal decision waits on the main connection product lock')
  await db.query('select id from bx1_portal.product_service_appointments where id=$1 for update nowait',
    [directInsertRace.appointment.id])
  const directRevoked = (await mandateScopedCommand(10, roleContext('SuperAdmin'),
    'revoke_product_service_appointment', {
      appointment_id: directInsertRace.appointment.id,
      expected_revision: directInsertRace.appointment.revision,
      reason: 'Synthetic direct insert lock-order proof revokes authority before decision can commit.',
    })).product_appointments.find(value => value.id === directInsertRace.appointment.id)
  eq(directRevoked.status, 'REVOKED', 'product-first revocation completes while direct insert waits')
  await db.query('commit'); begun = false
  eq((await directDecision).code, '42501',
    'direct internal insert rejects appointment revoked before product lock release')
  await admin()
  eq(await scalar('select count(*)::int from bx1_portal.offering_decisions where offering_revision_id=$1',
    [directInsertRace.product.offering_package.id]), 0,
  'failed direct internal insert leaves no immutable offering decision')
  phase = 'stage3-inactive-applied-appointment-admin-queue'
  await db.query('begin'); begun = true
  await admin()
  await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1 and status='TRUSTED'",
    [uid(11)])
  const inactiveApplied = (await mandateScopedRead(10, roleContext('SuperAdmin')))
    .product_appointments.find(value => value.id === complianceTrustRace.appointment.id)
  truth(inactiveApplied, 'inactive applied appointment remains visible to Super Admin for recovery')
  eq([inactiveApplied.status, inactiveApplied.effective, inactiveApplied.next_owner],
    ['APPLIED', false, 'SUPER_ADMIN'],
  'ineffective APPLIED appointment queues Super Admin revocation before manager renewal')
  await denied('manager cannot silently replace an inactive APPLIED appointment',
    () => scopedCommand(1, manager, 'request_product_service_appointment', {
      product_id: complianceTrustRace.product.id, role: 'ComplianceOfficer',
      appointee_user_id: uid(2), native_membership_id: complianceMembershipId,
      expected_product_revision: complianceTrustRace.product.revision,
      evidence_reference: 'SYNTHETIC-INACTIVE-APPLIED-RENEWAL-2026-09-28', requested_until: until,
    }), '23505')
  await db.query('rollback'); begun = false
  phase = 'fund-v2-cached-event-scope-revoked-during-read'
  // The optimized base reader calculates allowed organisations before it
  // projects events. Block only the events relation, so the reader is paused
  // after that cache is built; revoke the binding on another connection and
  // require the final authority recheck to reject the whole response.
  await db.query('begin'); begun = true
  await actor(1)
  await admin()
  eq(await scalar('select bx1_portal.scoped_operator($1::jsonb,$2::uuid)',
    [JSON.stringify(manager), orgId]), true, 'manager is authorised before the read race')
  await db.query('lock table bx1_portal.events in access exclusive mode')
  const interruptedRead = (async () => {
    await proofClients[0].query('begin')
    try {
      const result = await scopedRead(1, manager, proofClients[0])
      await proofClients[0].query('commit')
      return { result }
    } catch (error) {
      await proofClients[0].query('rollback')
      return { code: error?.code }
    }
  })()
  await waitForBlocked([pids[0]])
  eq(await scalar(`select exists(select 1 from pg_locks where pid=$1
    and relation='bx1_portal.events'::regclass and mode='AccessShareLock' and not granted)`,
  [pids[0]]), true, 'read waits on events relation after calculating the operator scope')
  await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where product_organisation_id=$1 and role='OfferingManager' and status='ACTIVE'", [orgId])
  await db.query('commit'); begun = false
  const revokedRead = await interruptedRead
  eq(revokedRead.code, '42501', 'revocation during the cached-scope read denies the entire response')
  phase = 'stage3-appointment-trust-revocation-two-connection-proof'
  const proveDecisionRevocation = async (label, race, revokedPerson, decisionActor,
    decisionContext, action, payload) => {
    const decisionKey = key()
    await db.query('begin'); begun = true
    await admin()
    await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1 and status='TRUSTED'",
      [uid(revokedPerson)])
    const waitingDecision = (async () => {
      await proofClients[0].query('begin')
      try {
        const result = await mandateScopedCommand(decisionActor, decisionContext,
          action, payload, decisionKey, proofClients[0])
        await proofClients[0].query('commit')
        return { result }
      } catch (error) {
        await proofClients[0].query('rollback')
        return { code: error?.code }
      }
    })()
    await waitForBlocked([pids[0]])
    eq(await scalar(`select exists(select 1 from pg_locks where pid=$1
      and relation='bx1_private.person_principals'::regclass
      and mode='RowShareLock' and granted)`, [pids[0]]), true,
    `${label} decision reaches the trusted-person lock before writing its decision`)
    await db.query('commit'); begun = false
    const outcome = await waitingDecision
    eq(outcome.code, '42501', `${label} decision rejects trust revoked during the wait`)
    await admin()
    eq(await scalar('select bx1_portal.product_appointment_effective($1)',
      [race.appointment.id]), false, `${label} appointment loses effectiveness after trust revocation`)
    eq(await scalar(`select jsonb_build_object(
      'decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$1),
      'native_receipts',(select count(*) from bx1_portal.requests where actor_id=$2 and request_key=$3),
      'scoped_receipts',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3),
      'events',(select count(*) from bx1_portal.events where subject_id=$4 and kind=$5))`,
    [race.product.offering_package.id, uid(decisionActor), decisionKey, race.product.id, action]),
    { decisions: 0, native_receipts: 0, scoped_receipts: 0, events: 0 },
    `${label} rejected decision leaves no immutable decision, receipt or event`)
    eq(await scalar('select jsonb_build_object(\'status\',status,\'revision\',revision) from bx1_portal.products where id=$1',
      [race.product.id]), { status: 'IN_REVIEW', revision: race.product.revision },
    `${label} rejected decision does not advance the product`)
  }
  phase = 'stage3-original-submitter-trust-revocation-two-connection-proof'
  const lineageDecisionKey = key()
  await admin()
  const lineagePriorIssuerEvents = await scalar(`select count(*)::int from bx1_portal.events
    where subject_id=$1 and actor_id=$2 and kind='review_offering_issuer'`,
  [lineageFund.id, uid(13)])
  await db.query('begin'); begun = true
  await admin()
  await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1 and status='TRUSTED'",
    [uid(5)])
  const waitingLineageDecision = (async () => {
    await proofClients[0].query('begin')
    try {
      const result = await mandateScopedCommand(13, issuerContext,
        'review_offering_issuer', issuerInput(lineageFund), lineageDecisionKey, proofClients[0])
      await proofClients[0].query('commit')
      return { result }
    } catch (error) {
      await proofClients[0].query('rollback')
      return { code: error?.code }
    }
  })()
  await waitForBlocked([pids[0]])
  eq(await scalar('select $1::int=any(pg_blocking_pids($2::int))',
    [await scalar('select pg_backend_pid()'), pids[0]]), true,
  'issuer decision waits on the original submitter trust row held by the revoker')
  eq(await scalar(`select exists(select 1 from pg_locks where pid=$1
    and relation='bx1_private.person_principals'::regclass
    and mode='RowShareLock' and granted)`, [pids[0]]), true,
  'issuer decision locks every same-hash submitter before any decision write')
  await db.query('commit'); begun = false
  eq((await waitingLineageDecision).code, '42501',
    'original submitter trust revocation during wait fails closed for fresh review')
  await admin()
  eq(await scalar('select bx1_portal.product_appointment_effective($1)',
    [lineageIssuerAppointment.id]), true,
  'denial is attributable to same-hash original submitter, not the issuer appointment')
  eq(await scalar(`select jsonb_build_object(
    'decisions',(select count(*) from bx1_portal.offering_decisions where offering_revision_id=$1),
    'native_receipts',(select count(*) from bx1_portal.requests where actor_id=$2 and request_key=$3),
    'scoped_receipts',(select count(*) from bx1_portal.scoped_requests where actor_id=$2 and request_key=$3),
    'events',(select count(*) from bx1_portal.events where subject_id=$4
      and actor_id=$2 and kind='review_offering_issuer'))`,
  [lineageFund.offering_package.id, uid(13), lineageDecisionKey, lineageFund.id]),
  { decisions: 0, native_receipts: 0, scoped_receipts: 0,
    events: lineagePriorIssuerEvents },
  'lineage revocation race commits no decision, receipt or audit event')
  eq(await scalar('select jsonb_build_object(\'status\',status,\'revision\',revision) from bx1_portal.products where id=$1',
    [lineageFund.id]), { status: 'IN_REVIEW', revision: lineageFund.revision },
  'lineage revocation race cannot advance the offering')
  await proveDecisionRevocation('Compliance reviewer', complianceTrustRace, 11, 2,
    reviewer, 'review_product', complianceInput(complianceTrustRace.product))
  await proveDecisionRevocation('issuer appointment applier', issuerTrustRace, 10, 13,
    issuerContext, 'review_offering_issuer', issuerInput(issuerTrustRace.product))
  phase = 'provider-binding-final-chain-proof'
  checks += await proveProviderBinding(db, proofClients,
    await source('../../../supabase/features/bx1_provider_binding.sql'),
    await source('../../../supabase/features/bx1_provider_subject_availability.sql'))
  phase = 'shared-handoff-final-reader-chain'
  await db.query('begin'); begun = true
  await admin()
  const handoffRecords = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'applications',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a),
      'accounts',(select jsonb_agg(to_jsonb(i) order by id) from bx1_portal.investment_accounts i),
      'mandates',(select jsonb_agg(to_jsonb(m) order by id) from bx1_portal.representative_mandates m),
      'investing_mandates',(select jsonb_agg(to_jsonb(m) order by id) from bx1_portal.investing_representative_mandates m),
      'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m),
      'configuration',(select to_jsonb(c) from bx1_portal.entry_configuration c),
      'events',(select count(*) from bx1_portal.events),'requests',(select count(*) from bx1_portal.scoped_requests))`)
  }
  const beforeHandoff = await handoffRecords()
  const finalWriterBefore = await scalar("select md5(pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure))")
  await sqlFile('../../../supabase/features/bx1_customer_handoff.sql')
  eq(await handoffRecords(), beforeHandoff, 'shared handoff installation preserves final-chain business records')
  eq(await scalar("select md5(pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure))"), finalWriterBefore, 'shared handoff preserves the latest appointed-product command chain')
  const currentHandoffEntry = await entryRead(14)
  eq(currentHandoffEntry.workflow, { version: 1, environment: 'TESTNET', actor_id: uid(14), scoped_read_available: true }, 'full current reader chain exposes the shared configured workflow')
  truth(currentHandoffEntry.applications.every(a => a.handoff.application_id === a.id && a.handoff.actor_id === uid(14) && a.handoff.application_revision === a.revision), 'current-chain handoffs remain actor/application/revision bound')
  const ownerHandoffEntry = await entryRead(9)
  const revokedCustomerHandoff = ownerHandoffEntry.applications.find(a => a.id === managerApp.id).handoff
  eq([revokedCustomerHandoff.blocker, revokedCustomerHandoff.allowed_actions, revokedCustomerHandoff.native_context], ['MANDATE_NOT_EFFECTIVE', [], null], 'historically revoked mandate stays unusable after all later reader migrations')
  const entityHandoff = ownerHandoffEntry.applications.find(a => a.id === entityApp.id).handoff
  eq([entityHandoff.state, entityHandoff.next_owner, entityHandoff.blocker, entityHandoff.allowed_actions, entityHandoff.mandate?.id], ['MANDATE_REVIEW_PENDING', 'COMPLIANCE', 'NONE', [], renewed.id], 'entity account waits for the exact current investing-representative mandate without claiming access')
  await denied('final reader chain rejects a MAIN issuer in the TEST fixture', async () => {
    await actor(14, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' })
    await scalar('select public.bx1_entry_read()')
  }, '42501')
  eq(await handoffRecords(), beforeHandoff, 'full current handoff reads remain non-mutating')
  for (const signature of ['bx1_portal.customer_application_handoff(jsonb,uuid)', 'bx1_portal.entry_read_pre_handoff()', 'bx1_portal.read_scoped_pre_handoff(jsonb)']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false, `${role} cannot bypass the handoff reader through ${signature}`)
    }
  }
  // Retain the exact non-mutating feature that was just proved: the following
  // helpers must exercise the deployed handoff/document/entity reader chain.
  await db.query('commit'); begun = false
  console.log('BX1_CUSTOMER_HANDOFF_PASS chain=current-stage2-stage3 pureRead=proven scopedWriters=unchanged hostedProvider=not-proven')
  phase = 'document-processing-final-chain-proof'
  checks += await proveDocumentProcessing(db, proofClients,
    await source('../../../supabase/features/bx1_document_processing.sql'))
  phase = 'entity-eligibility-final-chain-proof'
  checks += await proveEntityEligibility(db, proofClients,
    await source('../../../supabase/features/bx1_entity_eligibility.sql'), entityEligibilityFixture)
  phase = 'test-ordinary-entry-proof'
  checks += await proveTestOrdinaryEntry(db, proofClients,
    await source('../../../supabase/features/bx1_test_ordinary_entry.sql'))
  phase = 'synthetic-compliance-review-proof'
  checks += await proveSyntheticCompliance(db, proofClients,
    await source('../../../supabase/features/bx1_synthetic_compliance.sql'),
    await source('../../../supabase/features/bx1_synthetic_compliance_lock_parity.sql'))
  phase = 'normal-admission-workflow-proof'
  checks += await proveAdmissionWorkflow(db, proofClients,
    await source('../../../supabase/features/bx1_admission_workflow.sql'))
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
