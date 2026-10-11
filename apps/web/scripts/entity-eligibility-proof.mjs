import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Never imports pg or connects independently. This helper accepts only the
// parent's exact disposable GitHub PostgreSQL17 service and existing clients.
function requireFixture() {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Entity eligibility proof requires exact disposable cloud fixture')
}

const fixtureId = n => `ee760000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fixturePrefix = 'ee760000-0000-4000-8000-'
const fixtureScope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
const fixtureLabel = 'synthetic-legacy-v1-compatibility'
const fixtureScalar = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
const sha256 = value => createHash('sha256').update(value).digest('hex')
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
const fixtureDocument = (n, index, kind) => ({ id: fixtureId(800 + n * 10 + index), kind,
  title: `Synthetic entity ${kind} evidence`, storage_path: `${fixtureId(n)}/${fixtureId(800 + n * 10 + index)}`,
  sha256: 'a'.repeat(64), size: 25, mime_type: 'application/pdf' })
const ownerDetails = () => ({ details_version: 3, full_name: 'Synthetic Wealth Manager', country: 'ZA',
  company_name: 'Synthetic Entity Product Issuer', registration_reference: 'SYNTHETIC-ISSUER',
  beneficial_owners: 'Fictional sole owner; not provider cleared.', business_activities: 'Synthetic wealth-manager product evaluation only.',
  representative_position: 'Synthetic director', authority_basis: 'Fictional board mandate for isolated proof only.',
  documents: ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].map((kind, index) => fixtureDocument(2, index, kind)),
  test_data_acknowledged: true, ownership_change_reason: 'Initial synthetic issuer ownership disclosure for this bounded proof.',
  ownership_control: [{ id: fixtureId(952), party_type: 'PERSON', legal_name: 'Synthetic Issuer Owner', registration_reference: '',
    country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
    control_basis: 'Fictional sole owner and controller.', effective_on: '2026-09-01',
    change_reason: 'Initial synthetic owner disclosure.', evidence_document_id: fixtureId(822) }] })
const legacyTerms = () => ({ asset_type: 'FUND', name: 'Synthetic Legacy ENTITY Eligibility Compatibility Fund',
  issuer_name: 'Synthetic Entity Product Issuer', summary: 'Fictional historical-v1 package for eligibility compatibility only.',
  strategy: 'Fictional diversified compatibility strategy; no investable fund or real portfolio.', share_class: 'Synthetic Class A',
  currency: 'ZAR_TEST', unit_price_minor: '10000', cap_units: '100', minimum_units: '1',
  pricing_basis: 'Fixed fictional legacy unit price for compatibility checks only.', fees: 'No real fees or payments in this synthetic proof.',
  redemption_terms: 'Future governed service, unavailable for this fictional compatibility package.',
  eligible_countries: ['ZA'], eligible_investor_types: ['INDIVIDUAL', 'ENTITY'], property_address: '',
  property_valuation_minor: '0', rental_income_policy: '', documents: {
    memorandum: 'Synthetic historical memorandum. No fund interest or investment is offered. '.repeat(2).trim(),
    risks: 'Synthetic historical risk disclosure. No real investment, return or ownership is represented. '.repeat(2).trim(),
    subscription_terms: 'Synthetic historical subscription terms. No funding, assets or token delivery is authorised. '.repeat(2).trim(),
  } })
const modernTerms = () => ({ ...legacyTerms(), name: 'Synthetic Modern ENTITY Eligibility Closed Fund',
  terms_version: 2, currency: 'TST', settlement_decimals: 6, unit_price_minor: '10000000',
  strategy: 'The fund.mandate policy is the authoritative investment mandate for this package.',
  pricing_basis: 'The fund.nav and fund.dealing policies are the authoritative pricing terms for this package.',
  fees: 'The fund.fees policy is the authoritative fee schedule for this package.',
  redemption_terms: 'The fund.redemption, fund.dealing and fund.liquidity policies govern exits for this package.',
  fund: {
    mandate: 'Fictional diversified fund mandate with no real portfolio or investable claim.',
    class_rights: 'Synthetic Class A equal economic rights, with no live ownership or transfer right.',
    nav: { valuation_method: 'Synthetic marked portfolio value divided by issued test units.', frequency: 'MONTHLY',
      pricing_cutoff: '16:00 UTC on last business day', correction_policy: 'Corrections require a reviewed replacement NAV version and disclosure.' },
    dealing: { subscription_frequency: 'MONTHLY', redemption_frequency: 'MONTHLY', notice_days: 10, settlement_days: 5 },
    fees: { management_bps: 100, performance_bps: 0, other_fees: 'No other synthetic fees are charged.' },
    liquidity: { lockup_days: 0, gate_bps: 10000, suspension_policy: 'A separately reviewed suspension decision is required before dealing stops.' },
    distributions: { frequency: 'NONE', policy: 'No distributions in this fictional initial fund class.' },
    redemption: { price_basis: 'NAV', conditions: 'Redemption depends on the reviewed dealing calendar and available liquidity.' },
  } })
async function insertFixtureIdentity(db, n) {
  const id = fixtureId
  await db.query(`insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values($1,$2,clock_timestamp(),false)`, [id(n), `entity-eligibility-${n}@example.invalid`])
  await db.query(`insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')`, [id(400 + n), id(n)])
  await db.query(`insert into auth.sessions(id,user_id,not_after,created_at,aal,factor_id)
    values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour','aal2',$3)`, [id(100 + n), id(n), id(400 + n)])
  await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Synthetic Entity Eligibility Actor ${n}`])
  if (n !== 8) await db.query(`insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
    values($1,$2,'TRUSTED','synthetic:entity-proof-person',$3)`, [id(500 + n), `Synthetic entity-proof person ${n}`, id(600 + n)])
  await db.query(`insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
    values($1,$2,'TRUSTED','synthetic:entity-proof-principal',$3)`, [id(n), id(n === 8 ? 501 : 500 + n), id(700 + n)])
}
// Whole rows stay immutable except the expressly later product status/review timestamps.
async function foundationEvidence(db) {
  return fixtureScalar(db, `select jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t where id=any($1::uuid[])),
    'sessions',(select jsonb_agg(to_jsonb(t) order by id) from auth.sessions t where user_id=any($1::uuid[])),
    'factors',(select jsonb_agg(to_jsonb(t) order by id) from auth.mfa_factors t where user_id=any($1::uuid[])),
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_profiles t where id=any($1::uuid[])),
    'persons',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.persons t where id=any($2::uuid[])),
    'principals',(select jsonb_agg(to_jsonb(t) order by auth_user_id) from bx1_private.person_principals t where auth_user_id=any($1::uuid[])),
    'application',(select to_jsonb(t) from bx1_portal.applications t where id=$3),
    'submission',(select to_jsonb(t) from bx1_portal.application_detail_versions t where application_id=$3 and application_revision=2),
    'ownership',(select jsonb_agg(to_jsonb(t) order by relationship_id) from bx1_portal.application_ownership_control_versions t where application_id=$3),
    'organisation',(select to_jsonb(t) from bx1_portal.organisations t where id=$4),
    'product',(select to_jsonb(t)-array['status','reviewer_id','review_notes','reviewed_at','published_at','review_checks'] from bx1_portal.products t where id=$5),
    'offering',(select to_jsonb(t) from bx1_portal.offering_revisions t where id=$6))`,
  [[fixtureId(2), fixtureId(5)], [fixtureId(502), fixtureId(505)], fixtureId(202), fixtureId(302), fixtureId(300), fixtureId(301)])
}
async function fixtureRelations(db) {
  return (await db.query(`select n.nspname||'.'||c.relname relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('auth','public','bx1_portal','bx1_private','storage') order by 1`)).rows.map(row => row.relation)
}
async function outsideFixture(db, relations) {
  const result = {}
  for (const relation of relations) {
    assert.match(relation, /^[a-z0-9_]+\.[a-z0-9_]+$/)
    result[relation] = await fixtureScalar(db, `select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''))
      from ${relation} t where to_jsonb(t)::text not like $1`, [`%${fixturePrefix}%`])
  }
  return result
}
async function functionEvidence(db, signatures) {
  const result = {}
  for (const signature of signatures) {
    const row = await fixtureScalar(db, `select jsonb_build_object('definition',pg_get_functiondef(p.oid),
      'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,
      'triggers',coalesce((select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,
        'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgrelid,t.tgname)
        from pg_trigger t where t.tgfoid=p.oid),'[]'::jsonb)) from pg_proc p where p.oid=$1::regprocedure`, [signature])
    const { definition, ...attributes } = row
    result[signature] = { sha256: sha256(definition), ...attributes }
  }
  return result
}
export async function prepareEntityEligibilityLegacyFixture(db) {
  requireFixture()
  let checks = 0
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = (sql, params = []) => fixtureScalar(db, sql, params)
  await db.query('reset role')
  await db.query('savepoint entity_eligibility_legacy_preparation')
  try {
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact cloud owner preparation')
    eq(await scalar("select to_regprocedure('bx1_portal.guard_fund_v2_product()') is null"), true, 'legacy foundation is prepared before v2 cutover, never bypassed after it')
    const relations = await fixtureRelations(db), outside = await outsideFixture(db, relations)
    for (const relation of relations) eq(await scalar(`select count(*)::int from ${relation} t where to_jsonb(t)::text like $1`, [`%${fixturePrefix}%`]), 0,
      `${relation}: all entity fixture IDs are absent before preparation`)
    const guards = ['bx1_portal.guard_offering_publication()', 'bx1_portal.guard_offering_subscription()',
      'bx1_portal.guard_offering_eligibility()', 'bx1_portal.offering_operational(uuid)',
      'bx1_portal.offering_technical_ready(uuid)']
    const oldGuards = await functionEvidence(db, guards)
    eq(await scalar('select bx1_portal.entry_manual_review_enabled()'), true, 'explicit TEST/manual scope is already enabled, not modified by preparation')
    eq(await scalar('select reviewer_scope::text from bx1_portal.entry_configuration where singleton'), fixtureScope, 'prepared issuer uses the existing exact reviewer scope')
    for (const n of [2, 5]) await insertFixtureIdentity(db, n)
    const details = ownerDetails()
    await db.query(`insert into bx1_portal.applications(id,user_id,persona,status,revision,details,reviewer_scope,provider_mode,
      submitted_at,reviewed_at,reviewer_id,review_notes,review_checks,approved_until)
      values($1,$2,'WEALTH_MANAGER','APPROVED',3,$3::jsonb,$4,'MANUAL_TEST_REVIEW',clock_timestamp()-interval '1 minute',
        statement_timestamp(),$5,'Synthetic issuer admission prerequisite only; no provider or human acceptance.',
        '{"identity":true,"ownership":true,"screening":true,"suitability":true}',statement_timestamp()+interval '30 days')`,
    [fixtureId(202), fixtureId(2), JSON.stringify(details), fixtureScope, fixtureId(5)])
    await db.query(`insert into bx1_portal.application_detail_versions(application_id,application_revision,details,submitted_at,capture_kind)
      select id,2,details,submitted_at,'SUBMISSION' from bx1_portal.applications where id=$1`, [fixtureId(202)])
    await db.query(`insert into bx1_portal.application_ownership_control_versions(application_id,application_revision,relationship_id,
      party_type,legal_name,registration_reference,country,relationship,ownership_basis_points,control_basis,effective_on,
      change_reason,ownership_change_reason,evidence_document_id,submitted_details_sha256,submitted_at)
      select a.id,2,(r->>'id')::uuid,r->>'party_type',r->>'legal_name',r->>'registration_reference',r->>'country',r->>'relationship',
        (r->>'ownership_basis_points')::integer,r->>'control_basis',(r->>'effective_on')::date,r->>'change_reason',
        a.details->>'ownership_change_reason',(r->>'evidence_document_id')::uuid,encode(sha256(convert_to(a.details::text,'UTF8')),'hex'),a.submitted_at
      from bx1_portal.applications a cross join lateral jsonb_array_elements(a.details->'ownership_control') r where a.id=$1`, [fixtureId(202)])
    await db.query(`insert into bx1_portal.organisations(id,application_id,owner_id,name,reviewer_scope)
      values($1,$2,$3,'Synthetic Entity Eligibility Issuer',$4)`, [fixtureId(302), fixtureId(202), fixtureId(2), fixtureScope])
    await db.query('update bx1_portal.applications set organisation_id=$1 where id=$2', [fixtureId(302), fixtureId(202)])
    const terms = legacyTerms()
    await scalar('select bx1_portal.validate_terms($1::jsonb)', [JSON.stringify(terms)])
    await db.query(`insert into bx1_portal.products(id,organisation_id,created_by,status,revision,terms,terms_hash,cap_units,unit_price_minor,minimum_units)
      values($1,$2,$3,'IN_REVIEW',1,$4::jsonb,encode(sha256(convert_to(($4::jsonb)::text,'UTF8')),'hex'),
        ($4::jsonb->>'cap_units')::numeric,($4::jsonb->>'unit_price_minor')::numeric,($4::jsonb->>'minimum_units')::numeric)`,
    [fixtureId(300), fixtureId(302), fixtureId(2), JSON.stringify(terms)])
    await db.query(`insert into bx1_portal.offering_revisions(id,product_id,package_number,origin,product_revision_at_submission,
      terms,terms_hash,document_hashes,submitted_by,submitted_at) select $1,id,1,'SUBMITTED',revision,terms,terms_hash,
      bx1_portal.offering_document_hashes(terms),created_by,clock_timestamp() from bx1_portal.products where id=$2`, [fixtureId(301), fixtureId(300)])
    await db.query('update bx1_portal.products set current_offering_revision_id=$1 where id=$2', [fixtureId(301), fixtureId(300)])
    eq(await scalar('select bx1_portal.customer_admission_package_current($1)', [fixtureId(202)]), true, 'synthetic owner has exact immutable predecessor and ownership hash, not invented approval lineage')
    eq(await scalar('select jsonb_build_array(admission_purpose,provider_mode) from bx1_portal.applications where id=$1', [fixtureId(202)]),
      ['CUSTOMER_ORGANISATION_ADMISSION', 'MANUAL_TEST_REVIEW'], 'purpose is server-derived and mode explicitly synthetic')
    eq(await scalar('select bx1_portal.offering_technical_ready($1)', [fixtureId(301)]), false, 'prepared package has no technical acceptance')
    const allowed = new Set(['auth.users','auth.sessions','auth.mfa_factors','public.bx1_profiles','bx1_private.persons',
      'bx1_private.person_principals','bx1_portal.applications','bx1_portal.application_detail_versions',
      'bx1_portal.application_ownership_control_versions','bx1_portal.organisations','bx1_portal.products','bx1_portal.offering_revisions'])
    for (const relation of relations.filter(relation => !allowed.has(relation))) eq(await scalar(
      `select count(*)::int from ${relation} t where to_jsonb(t)::text like $1`, [`%${fixturePrefix}%`]), 0,
    `${relation}: no early grant, provider, storage, quarantine, processing, appointment, eligibility, money or command side effect`)
    eq(await outsideFixture(db, relations), outside, 'preparation preserves every pre-existing outside-namespace row')
    eq(await functionEvidence(db, guards), oldGuards, 'preparation preserves production guard definitions, owners, ACLs and enabled triggers')
    const foundation = await foundationEvidence(db)
    truth(foundation.product && foundation.offering && foundation.submission && foundation.ownership?.length === 1, 'complete exact pre-cutover foundation evidence')
    const packet = freeze({ version: 1, label: fixtureLabel, checks, evidence: { namespace: fixturePrefix,
      ids: { actors: [fixtureId(2), fixtureId(5)], application: fixtureId(202), organisation: fixtureId(302),
        product: fixtureId(300), offering: fixtureId(301), documents: [fixtureId(820), fixtureId(821), fixtureId(822)] },
      foundation, sha256: sha256(JSON.stringify(foundation)) } })
    await db.query('release savepoint entity_eligibility_legacy_preparation')
    return packet
  } catch (error) {
    await db.query('rollback to savepoint entity_eligibility_legacy_preparation; release savepoint entity_eligibility_legacy_preparation')
    throw error
  }
}

export async function proveEntityEligibility(db, clients, featureSql, preparedFixture) {
  requireFixture()
  assert.equal(clients.length, 2, 'entity proof requires two independent clients')
  assert.equal(preparedFixture?.version, 1, 'exact prepared fixture packet required; no fallback')
  assert.equal(preparedFixture.label, fixtureLabel, 'positive is historical compatibility only')
  assert.ok(Number.isSafeInteger(preparedFixture.checks) && preparedFixture.checks >= 0, 'seed checks are counted separately by parent')
  assert.deepEqual(Object.keys(preparedFixture).sort(), ['checks', 'evidence', 'label', 'version'])
  assert.deepEqual(Object.keys(preparedFixture.evidence).sort(), ['foundation', 'ids', 'namespace', 'sha256'])
  assert.equal(preparedFixture.evidence.namespace, fixturePrefix)
  assert.deepEqual(preparedFixture.evidence.ids, { actors: [fixtureId(2), fixtureId(5)], application: fixtureId(202),
    organisation: fixtureId(302), product: fixtureId(300), offering: fixtureId(301), documents: [fixtureId(820), fixtureId(821), fixtureId(822)] })
  assert.equal(sha256(JSON.stringify(preparedFixture.evidence.foundation)), preparedFixture.evidence.sha256, 'altered seed evidence is rejected')
  let checks = 0, sequence = 0, begun = false, technicalInstalled = false
  let originalTechnical, originalTechnicalHash, originalTechnicalEvidence
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const truth = (value, label) => { assert.ok(value, label); checks++ }
  const scalar = async (sql, params = [], client = db) => Object.values((await client.query(sql, params)).rows[0])[0]
  const id = fixtureId
  const key = () => `ef760000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const prefix = fixturePrefix
  const scope = fixtureScope
  const otherScope = 'e3000000-0000-4000-8000-000000000002'
  const applicant = { mode: 'APPLICANT' }
  const reviewer = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
  const issuer = { mode: 'ROLE', organisationId: scope, role: 'IssuerFundManager' }
  const mainIssuer = 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1'
  const testIssuer = 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
  const eligibilityChecks = { identity: true, product_fit: true, restrictions: true, source_of_funds: true }
  const admissionChecks = { identity: true, ownership: true, screening: true, suitability: true }
  const admin = (client = db) => client.query('reset role')
  const role = async (name, client = db) => { await admin(client); await client.query(`set local role ${name}`) }
  const begin = async () => { await db.query('begin'); begun = true; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claims = async (n, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: 'aal2', iss: testIssuer,
      exp: Math.floor(Date.now() / 1000) + 3600, ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const read = async (n, context = applicant, client = db, extra = {}) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)], client)
  }
  const command = async (n, context, action, body, request = key(), client = db, extra = {}) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      [action, request, JSON.stringify(body), JSON.stringify(context)], client)
  }
  const denied = async (label, action, expectedCode = '42501', expectedMessage = null) => {
    await admin(); await db.query('savepoint entity_expected_denial')
    let error
    try { await action() } catch (failure) { error = failure }
    await db.query('rollback to savepoint entity_expected_denial; release savepoint entity_expected_denial'); await admin()
    truth(error, `${label}: operation denied`)
    eq(error.code, expectedCode, `${label}: SQLSTATE`)
    if (expectedMessage !== null) eq(error.message, expectedMessage, `${label}: preserved exact guard diagnostic`)
  }
  const probe = async action => {
    await admin(); await db.query('savepoint entity_probe')
    try { await action() } finally { await db.query('rollback to savepoint entity_probe; release savepoint entity_probe'); await admin() }
  }
  const snapshot = async relations => {
    await admin()
    const value = {}
    for (const relation of relations) {
      assert.match(relation, /^[a-z0-9_]+\.[a-z0-9_]+$/)
      value[relation] = await scalar(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from ${relation} t`)
    }
    return value
  }
  const unchangedRelations = async () => (await db.query(`select n.nspname||'.'||c.relname relation
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='bx1_portal'
      and (c.relname like '%funding%' or c.relname in ('subscriptions','settlement_receipts','settlement_commands','holdings'))
    order by c.relname`)).rows.map(row => row.relation)
  const individualHistory = async (installed = false) => {
    await admin()
    const caseFields = ['account_kind', 'entity_party_id', 'representative_user_id', 'representative_mandate_id',
      'mandate_cycle', 'mandate_revision', 'decision_appointment_id', 'decision_appointment_revision']
    const receiptFields = [...caseFields, 'investment_account_id', 'offering_revision_id']
    return scalar(`select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(e)${installed ? '-$1::text[]' : ''} order by id)
        from bx1_portal.product_eligibility_cases e ${installed ? "where account_kind='INDIVIDUAL'" : ''}),
      'receipts',(select jsonb_agg(to_jsonb(r)${installed ? '-$2::text[]' : ''} order by case_id,case_revision)
        from bx1_portal.product_eligibility_receipts r ${installed ? "where account_kind='INDIVIDUAL'" : ''}))`, installed ? [caseFields, receiptFields] : [])
  }
  const business = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'cases',(select jsonb_agg(to_jsonb(e) order by id) from bx1_portal.product_eligibility_cases e where account_kind='ENTITY'),
      'receipts',(select jsonb_agg(to_jsonb(r) order by case_id,case_revision) from bx1_portal.product_eligibility_receipts r where account_kind='ENTITY'),
      'events',(select jsonb_agg(to_jsonb(e) order by id) from bx1_portal.events e
        where subject_id in (select id from bx1_portal.product_eligibility_cases where account_kind='ENTITY')),
      'requests',(select jsonb_agg(to_jsonb(r) order by actor_id,request_key) from bx1_portal.scoped_requests r
        where request_key::text like 'ef760000-0000-4000-8000-%' and command like '%product_eligibility'))`)
  }
  const authoritySnapshot = () => snapshot(['public.bx1_memberships', 'bx1_portal.entry_configuration',
    'bx1_private.document_lifecycle_policy', 'bx1_private.document_receipt_policy',
    'bx1_private.document_processing_policy', 'bx1_private.provider_application_bindings',
    'bx1_private.provider_evidence_events', 'bx1_private.provider_applicant_pins', 'bx1_private.provider_boundary_receipts'])
  const existingSubjects = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'users',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from auth.users t where id::text not like $1),
      'sessions',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from auth.sessions t where user_id::text not like $1),
      'factors',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from auth.mfa_factors t where user_id::text not like $1),
      'memberships',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.bx1_memberships t where user_id::text not like $1),
      'persons',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_private.persons t where id::text not like $1),
      'principals',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by auth_user_id)::text,'')) from bx1_private.person_principals t where auth_user_id::text not like $1),
      'applications',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.applications t where user_id::text not like $1),
      'submissions',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by application_id,application_revision)::text,'')) from bx1_portal.application_detail_versions t where application_id::text not like $1),
      'ownership',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by application_id,application_revision,relationship_id)::text,'')) from bx1_portal.application_ownership_control_versions t where application_id::text not like $1),
      'organisations',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.organisations t where id::text not like $1),
      'products',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.products t where id::text not like $1),
      'offerings',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.offering_revisions t where product_id::text not like $1),
      'offering_decisions',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.offering_decisions t where offering_revision_id::text not like $1),
      'accounts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.investment_accounts t where application_id::text not like $1),
      'investing_mandates',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.investing_representative_mandates t where representative_user_id::text not like $1),
      'appointments',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_portal.product_service_appointments t where product_id::text not like $1),
      'document_registry',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_private.document_quarantine_items t where id::text not like $1),
      'document_jobs',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by document_id)::text,'')) from bx1_private.document_processing_jobs t where document_id::text not like $1),
      'document_attempts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_private.document_processing_attempts t where document_id::text not like $1),
      'document_scans',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_private.document_scan_events t where document_id::text not like $1),
      'document_receipts',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from bx1_private.document_upload_receipts t where id::text not like $1))`, [prefix + '%'])
  }
  const handoffFunctions = ['bx1_portal.customer_application_handoff(jsonb,uuid)',
    'bx1_portal.entry_read_pre_handoff()', 'bx1_portal.read_scoped_pre_handoff(jsonb)']
  const functions = ['bx1_portal.product_eligibility_current(uuid)', 'bx1_portal.account_usable(jsonb,uuid)',
    'bx1_portal.offering_operational(uuid)', 'bx1_portal.guard_offering_eligibility()',
    'bx1_portal.guard_fund_v2_product()', 'bx1_portal.guard_real_estate_v2_product()',
    // The FUND-named retained subscription guard covers both v2 asset classes.
    'bx1_portal.guard_fund_v2_subscription()', 'bx1_portal.guard_offering_publication()',
    'bx1_portal.guard_offering_subscription()', ...handoffFunctions]
  const functionHashes = async () => {
    await admin()
    return functionEvidence(db, functions)
  }
  const waitOn = async (waiter, blocker, relation = null, lock = null) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const waiting = await scalar(`select exists(select 1 from pg_stat_activity a where a.pid=$1
        and a.wait_event_type='Lock' and $2=any(pg_blocking_pids(a.pid))
        and ($3::text is null or exists(select 1 from pg_locks l where l.pid=a.pid
          and l.relation=to_regclass($3) and not l.granted and ($4::text is null or l.mode=$4))))`,
      [waiter, blocker, relation, lock])
      if (waiting) { checks++; return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Entity proof did not observe the required independent-backend lock wait')
  }
  const until = new Date(Date.now() + 3 * 86400000).toISOString()
  const productId = id(300), offeringId = id(301), organisationId = id(302), ownerAppId = id(202)
  const accountByActor = new Map(), mandateByActor = new Map()
  let product
  const requestBody = (n, revision = 0) => {
    const mandate = mandateByActor.get(n)
    return { product_id: productId, investment_account_id: accountByActor.get(n), expected_revision: revision,
      investor_statement: 'Synthetic entity product-fit statement; no real customer, funds or provider clearance.',
      representative_mandate_id: mandate.id, expected_mandate_revision: mandate.revision, expected_mandate_cycle: mandate.cycle,
      expected_product_revision: product.revision, offering_revision_id: offeringId, terms_hash: product.terms_hash }
  }
  const reviewBody = (row, decision = 'APPROVED') => ({ eligibility_case_id: row.id, expected_revision: row.revision,
    decision, notes: 'Independent synthetic MANUAL_TEST_REVIEW of exact entity, mandate and offering evidence.', checks: eligibilityChecks })
  const find = (result, actor) => result.entity_product_eligibility.find(e => e.representative_user_id === id(actor))
  const handoffRelations = ['bx1_portal.applications', 'bx1_portal.investment_accounts',
    'bx1_portal.representative_mandates', 'bx1_portal.investing_representative_mandates',
    'public.bx1_memberships', 'bx1_portal.entry_configuration',
    'bx1_portal.product_eligibility_cases', 'bx1_portal.product_eligibility_receipts',
    'bx1_portal.events', 'bx1_portal.scoped_requests']
  const proveCurrentHandoff = async (status, revision) => {
    const label = `current-chain handoff at entity ${status}/${revision}`
    await admin()
    const application = await scalar('select to_jsonb(a) from bx1_portal.applications a where id=$1', [id(201)])
    const nonMutatingRead = async (surface, action) => {
      const before = await snapshot(handoffRelations)
      const result = await action()
      eq(await snapshot(handoffRelations), before,
        `${label}: ${surface} changes no canonical record, grant, decision, audit or request`)
      return result
    }
    const entry = await nonMutatingRead('applicant entry', async () => {
      await claims(1)
      return scalar('select public.bx1_entry_read()')
    })
    const own = await nonMutatingRead('applicant scoped read', () => read(1))
    const staff = await nonMutatingRead('appointed-reviewer source read', () => read(4, reviewer))
    const handoffs = []
    for (const [result, actor, context] of [[entry, 1, applicant], [own, 1, applicant], [staff, 4, reviewer]]) {
      eq(result.workflow, { version: 1, environment: 'TESTNET', actor_id: id(actor), scoped_read_available: true },
        `${label}: exact caller-bound workflow`)
      truth(result.applications.every(a => a.handoff?.actor_id === id(actor)
        && a.handoff.application_id === a.id && a.handoff.application_revision === a.revision
        && a.handoff.environment === 'TESTNET'), `${label}: every visible source handoff retains exact actor/application/revision`)
      const source = result.applications.find(a => a.id === application.id)
      truth(source, `${label}: separately scoped canonical entity admission remains visible`)
      eq([source.revision, source.handoff.application_revision, source.handoff.operating_context],
        [application.revision, application.revision, context], `${label}: source handoff is not a substituted product case or context`)
      handoffs.push(source.handoff)
    }
    eq(handoffs[0], handoffs[1], `${label}: current entry and scoped applicant readers agree`)
    const entity = find(staff, 1)
    eq([entity.status, entity.revision], [status, revision], `${label}: source handoff accompanies the exact current eligibility revision`)
    truth(entity.investor_application, `${label}: appointed reviewer retains separately authorized source evidence`)
    eq([entity.investor_application.id, entity.investor_application.revision, entity.investor_application.status],
      [application.id, application.revision, application.status], `${label}: eligibility evidence and source handoff bind the same admission`)
  }
  const revokeAppointment = async (target = id(304)) => {
    await admin()
    return db.query(`update bx1_portal.product_service_appointments set status='REVOKED',revision=revision+1,
      revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Synthetic exact appointment withdrawn.'
      where id=$1 and status='APPLIED'`, [target, id(6)])
  }
  const createAppointment = async (appointment, actor, membership, staffRole, targetProduct = product) => {
    await admin()
    await db.query(`insert into bx1_portal.product_service_appointments(id,product_id,product_organisation_id,
      reviewer_scope_organisation_id,role,appointee_user_id,native_membership_id,requested_by_user_id,requested_in_context,
      product_revision_at_request,terms_hash_at_request,evidence_reference,requested_until)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,1,$10,'Synthetic isolated entity-proof appointment evidence.',$11::timestamptz)`,
    [appointment, targetProduct.id, organisationId, scope, staffRole, id(actor), membership, id(2),
      JSON.stringify({ mode: 'ROLE', organisationId: scope, role: 'OfferingManager' }), targetProduct.terms_hash, until])
    const receipt = await scalar(`insert into bx1_portal.product_service_appointment_receipts(appointment_id,
      appointment_revision,action,actor_id,operating_context,command_payload,status_after)
      values($1,2,'review_product_service_appointment',$2,$3::jsonb,
        '{"source":"fresh-synthetic-entity-fixture","decision":"APPROVED"}','APPROVED') returning id`,
    [appointment, id(5), JSON.stringify(reviewer)])
    await db.query(`update bx1_portal.product_service_appointments set status='APPROVED',revision=2,
      reviewed_at=clock_timestamp(),reviewed_by_user_id=$2,review_notes='Synthetic independent appointment review.',
      review_checks='{"appointment":true,"evidence":true,"scope":true}',approval_receipt_id=$3 where id=$1`, [appointment, id(5), receipt])
    await db.query(`update bx1_portal.product_service_appointments set status='APPLIED',revision=3,
      applied_at=clock_timestamp(),applied_by_user_id=$2 where id=$1`, [appointment, id(6)])
    eq(await scalar('select bx1_portal.product_appointment_effective($1)', [appointment]), true,
      'fresh synthetic appointment meets preserved effective-authority predicate')
  }
  try {
    await begin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable owner fixture')
    eq(await foundationEvidence(db), preparedFixture.evidence.foundation, 'final chain consumes every exact prepared identity/admission/organisation/package row without replacement')
    eq(await scalar('select status from bx1_portal.products where id=$1', [productId]), 'IN_REVIEW', 'legacy fixture enters final proof already in review; no post-cutover submit')
    eq(await scalar('select bx1_portal.customer_admission_package_current($1)', [ownerAppId]), true, 'prepared owner retains exact submission and ownership predecessor')
    for (const signature of handoffFunctions) {
      eq(await scalar('select to_regprocedure($1) is not null', [signature]), true, `${signature} is retained in the final current reader chain`)
      eq(await scalar(`select not exists(select 1 from pg_proc p cross join lateral
        aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=$1::regprocedure and acl.grantee<>p.proowner)`,
      [signature]), true, `${signature} has no nonowner ACL, including PUBLIC`)
      for (const name of ['anon', 'authenticated', 'service_role'])
        eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [name, signature]), false, `${name} cannot call private ${signature}`)
    }
    const oldIndividuals = await individualHistory(), oldFunctions = await functionHashes()
    const oldSubjects = await existingSubjects()
    const moneyRelations = await unchangedRelations(), oldMoney = await snapshot(moneyRelations)
    const oldAuthority = await authoritySnapshot()
    const oldReadDefinition = await scalar("select pg_get_functiondef('bx1_portal.read_scoped(jsonb)'::regprocedure)")
    const oldWriterDefinition = await scalar("select pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure)")
    originalTechnical = await scalar("select pg_get_functiondef('bx1_portal.offering_technical_ready(uuid)'::regprocedure)")
    originalTechnicalHash = createHash('sha256').update(originalTechnical).digest('hex')
    originalTechnicalEvidence = await functionEvidence(db, ['bx1_portal.offering_technical_ready(uuid)'])
    truth(/SELECT false;/i.test(originalTechnical), 'original technical-ready definition is the explicit closed Stage4 gate')
    const nonNamespaceReadiness = (await db.query(`select id,bx1_portal.offering_technical_ready(id) ready
      from bx1_portal.offering_revisions where id<>$1 order by id`, [offeringId])).rows
    truth(nonNamespaceReadiness.every(row => row.ready === false), 'all prior nonnamespace technical readiness cases are negative')
    eq(await scalar('select bx1_portal.offering_technical_ready($1)', [offeringId]), false, 'separately prepared own historical package is also closed initially')
    try { await db.query(featureSql) } catch (error) {
      const position = Number(error.position)
      if (position > 0 && position <= featureSql.length) error.fixtureLine = featureSql.slice(0, position - 1).split('\n').length
      throw error
    }
    eq(await individualHistory(true), oldIndividuals, 'additive installation preserves every original individual scalar and receipt')
    eq(await functionHashes(), oldFunctions, 'individual execution and production offering guards are verbatim unchanged')
    eq(await authoritySnapshot(), oldAuthority, 'installation changes no memberships, policy, provider or admission configuration')
    eq(await snapshot(moneyRelations), oldMoney, 'installation changes no subscription/funding/settlement record')
    eq((await scalar("select pg_get_functiondef('bx1_portal.read_scoped_pre_entity_eligibility(jsonb)'::regprocedure)"))
      .replaceAll('read_scoped_pre_entity_eligibility', 'read_scoped'), oldReadDefinition, 'preserved reader body is unchanged')
    eq((await scalar("select pg_get_functiondef('bx1_portal.execute_scoped_pre_entity_eligibility(jsonb,text,uuid,jsonb)'::regprocedure)"))
      .replaceAll('execute_scoped_pre_entity_eligibility', 'execute_scoped'), oldWriterDefinition, 'preserved writer body is unchanged')
    for (const relation of ['bx1_portal.product_eligibility_cases', 'bx1_portal.product_eligibility_receipts']) {
      eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [relation]), true, `${relation} retains RLS`)
      for (const name of ['anon', 'authenticated', 'service_role']) eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')", [name, relation]), false, `${name} has no direct ${relation} access`)
    }
    for (const signature of ['bx1_portal.entity_product_eligibility_current(uuid)',
      'bx1_portal.entity_eligibility_source_current(uuid,uuid,integer,integer,uuid,integer,uuid,text)',
      'bx1_portal.read_scoped_pre_entity_eligibility(jsonb)', 'bx1_portal.execute_scoped_pre_entity_eligibility(jsonb,text,uuid,jsonb)',
      ...handoffFunctions])
      eq(await scalar(`select not exists(select 1 from pg_proc p cross join lateral
        aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=$1::regprocedure and acl.grantee<>p.proowner)`, [signature]), true, `${signature} remains owner-only including PUBLIC`)
    // Fresh synthetic identities are test setup only, not business command side
    // effects or evidence that separate email accounts are independent humans.
    for (const n of [1, 3, 4, 6, 7, 8, 9, 10]) await insertFixtureIdentity(db, n)
    const memberships = new Map()
    for (const [n, staffRole] of [[2, 'OfferingManager'], [3, 'IssuerFundManager'], [4, 'ComplianceOfficer'],
      [5, 'ComplianceOfficer'], [6, 'SuperAdmin'], [7, 'ComplianceOfficer'], [8, 'ComplianceOfficer']]) {
      memberships.set(n, await scalar(`insert into public.bx1_memberships(user_id,organisation_id,role,status)
        values($1,$2,$3,'ACTIVE') returning id`, [id(n), scope, staffRole]))
    }
    await db.query(`insert into public.bx1_memberships(user_id,organisation_id,role,status)
      values($1,$2,'ComplianceOfficer','ACTIVE')`, [id(7), otherScope])
    eq(await scalar('select bx1_portal.entity_people_independent($1,$2)', [id(1), id(8)]), false, 'separate fixture emails sharing one trusted person are not independent')
    // The preceding document helper leaves its scanner-required disposable
    // producer admitted. Preserve it. Lock all pre-existing jobs on a separate
    // backend so SKIP LOCKED cannot consume/expire any prior fixture record.
    eq(await scalar("select mode from bx1_private.document_lifecycle_policy where singleton"), 'SCANNER_REQUIRED', 'accepted scanner-required policy is not downgraded')
    const processingPolicy = (await db.query('select * from bx1_private.document_processing_policy where singleton')).rows[0]
    eq(processingPolicy.state, 'ADMITTED', 'synthetic document fixture producer is the already-admitted test producer')
    await clients[1].query('begin')
    await clients[1].query('select document_id from bx1_private.document_processing_jobs order by document_id for update')
    const documents = new Map()
    try {
      for (const n of [1, 2, 9, 10]) {
        const docs = []
        for (const [index, kind] of ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'].entries()) {
          const doc = fixtureDocument(n, index, kind)
          await admin()
          await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
            values('bx1-portal-quarantine',$1,'{"size":25,"mimetype":"application/pdf"}',jsonb_build_object('sha256',$2::text))`, [doc.storage_path, doc.sha256])
          await role('bx1_document_receipt_writer')
          await scalar('select bx1_private.register_quarantined_document($1,$2,$3,$4,$5,$6,$7,$8)',
            [id(n), id(100 + n), doc.id, doc.kind, doc.title, doc.sha256, doc.size, doc.mime_type])
          await role('bx1_document_processing_worker')
          const lease = await scalar('select bx1_private.claim_document_processing($1,$2,$3)', [processingPolicy.worker_id, processingPolicy.scanner_id, key()])
          eq(lease?.document_id, doc.id, 'synthetic scanner claim owns exact fresh document, not earlier proof jobs')
          await role('bx1_document_scanner_writer')
          await scalar("select bx1_private.record_document_scan($1,$2,$3,$4,'CLEAN',clock_timestamp())", [doc.id, doc.sha256, processingPolicy.scanner_id, lease.reference])
          await admin()
          await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata)
            values('bx1-portal-documents',$1,$2,'{"size":25,"mimetype":"application/pdf"}',jsonb_build_object('sha256',$3::text))`, [doc.storage_path, id(n), doc.sha256])
          await role('bx1_document_scanner_writer'); await scalar('select bx1_private.promote_scanned_document($1)', [doc.id])
          docs.push(doc)
        }
        documents.set(n, docs)
      }
    } finally { await clients[1].query('rollback'); await admin(clients[1]); await admin() }
    // Approved admission and immutable submission are explicit synthetic
    // preconditions; the new package does not re-prove human/provider admission.
    for (const n of [1, 9, 10]) {
      const docs = documents.get(n)
      const details = { details_version: 3, full_name: `Synthetic Entity Representative ${n}`, country: 'ZA', investor_type: 'ENTITY',
        company_name: `Synthetic Entity Eligibility ${n}`, registration_reference: `SYNTHETIC-ENTITY-${n}`,
        source_of_funds: 'Fictional company treasury only; no real funds or customers.', beneficial_owners: 'Fictional single owner for bounded synthetic evaluation.',
        experience: 'Synthetic investment experience for workflow testing only.', documents: docs, test_data_acknowledged: true,
        ownership_change_reason: 'Initial fictional ownership disclosure for this isolated proof.', ownership_control: [{
          id: id(950 + n), party_type: 'PERSON', legal_name: `Synthetic Owner ${n}`, registration_reference: '', country: 'ZA',
          relationship: 'DIRECT_OWNER', ownership_basis_points: 10000, control_basis: 'Fictional sole owner and controller.',
          effective_on: '2026-09-01', change_reason: 'Initial synthetic owner disclosure.', evidence_document_id: docs[2].id,
        }] }
      await db.query(`insert into bx1_portal.applications(id,user_id,persona,status,revision,details,reviewer_scope,
        provider_mode,submitted_at,reviewed_at,reviewer_id,review_notes,review_checks,approved_until)
        values($1,$2,'INVESTOR','APPROVED',3,$3::jsonb,$4,'MANUAL_TEST_REVIEW',clock_timestamp()-interval '1 minute',statement_timestamp(),$5,
          'Synthetic admission precondition; not hosted human or provider acceptance.',$6::jsonb,statement_timestamp()+interval '30 days')`,
      [id(200 + n), id(n), JSON.stringify(details), scope, id(4), JSON.stringify(admissionChecks)])
      await db.query(`insert into bx1_portal.application_detail_versions(application_id,application_revision,details,submitted_at,capture_kind)
        select id,2,details,submitted_at,'SUBMISSION' from bx1_portal.applications where id=$1`, [id(200 + n)])
      await claims(n); await admin()
      eq(await scalar('select jsonb_build_array(admission_purpose,provider_mode) from bx1_portal.applications where id=$1', [id(200 + n)]),
        ['INVESTOR_ADMISSION', 'MANUAL_TEST_REVIEW'], `synthetic entity ${n}: server-owned purpose and explicit manual prerequisite mode`)
      eq(await scalar('select bx1_portal.entity_application_account_openable($1)', [id(200 + n)]), true,
        `synthetic entity ${n}: exact preserved admission gate is open under its applicant JWT before guarded create`)
      const opened = await command(n, applicant, 'create_entity_investment_account', { application_id: id(200 + n) })
      const account = opened.entity_investment_accounts.find(row => row.application_id === id(200 + n))
      truth(account?.id, 'fresh synthetic approved entity creates canonical account through unchanged guarded command')
      accountByActor.set(n, account.id)
      let mandate = (await command(n, applicant, 'request_investing_representative_mandate', { investment_account_id: account.id,
        expected_revision: 0, evidence_reference: 'Synthetic board-appointed representative for account view and eligibility only.',
        appointment_document_id: docs[1].id, requested_until: until })).investing_representative_mandates.find(row => row.investment_account_id === account.id)
      mandate = (await command(4, reviewer, 'review_investing_representative_mandate', { mandate_id: mandate.id, expected_revision: mandate.revision,
        decision: 'APPROVED', notes: 'Independent synthetic legal entity, appointment and restricted scope review.',
        checks: { appointment: true, legal_entity: true, scope: true } })).investing_representative_mandates.find(row => row.id === mandate.id)
      mandate = (await command(6, { mode: 'ROLE', organisationId: scope, role: 'SuperAdmin' }, 'apply_investing_representative_mandate',
        { mandate_id: mandate.id, expected_revision: mandate.revision })).investing_representative_mandates.find(row => row.id === mandate.id)
      eq([mandate.effective, mandate.transaction_limit_minor], [true, '0'], 'existing applied mandate stays limited to view and eligibility')
      mandateByActor.set(n, mandate)
      await admin()
    }
    eq(documents.get(2), ownerDetails().documents, 'late promoted owner documents match the immutable pre-cutover descriptors exactly')
    eq(await foundationEvidence(db), preparedFixture.evidence.foundation, 'late synthetic identities/documents/admissions have not rewritten the prepared foundation')
    product = (await db.query('select * from bx1_portal.products where id=$1', [productId])).rows[0]
    eq(product.terms, legacyTerms(), 'positive terms are deterministic v1/ZAR_TEST, not an arbitrary v2 template')
    await createAppointment(id(303), 3, memberships.get(3), 'IssuerFundManager')
    await createAppointment(id(304), 4, memberships.get(4), 'ComplianceOfficer')
    const approveSyntheticPackage = async targetOffering => {
      for (const [actor, context, kind, decisionChecks] of [[3, issuer, 'ISSUER', { issuer_authority: true, terms: true, rights: true }],
        [4, reviewer, 'COMPLIANCE', { issuer: true, terms: true, disclosures: true, eligibility: true }]]) {
        await claims(actor); await admin()
        await db.query(`insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,actor_id,
          operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)
          select id,$2,'APPROVED',$3,$4::jsonb,terms_hash,document_hashes,product_revision_at_submission,
            'Synthetic exact-package review precondition, not technical chain proof.',$5::jsonb
          from bx1_portal.offering_revisions where id=$1`, [targetOffering, kind, id(actor), JSON.stringify(context), JSON.stringify(decisionChecks)])
      }
    }
    await approveSyntheticPackage(offeringId)
    eq(await scalar('select bx1_portal.offering_approved($1)', [productId]), true, 'current appointed exact-package synthetic decisions are operational preconditions')
    eq(await scalar('select bx1_portal.offering_operational($1)', [productId]), false, 'real technical readiness is still closed before isolated override')
    await db.query(`update bx1_portal.products set status='APPROVED',reviewer_id=$2,reviewed_at=clock_timestamp(),
      review_notes='Synthetic historical-v1 package compatibility prerequisite only.',
      review_checks='{"issuer":true,"terms":true,"disclosures":true,"eligibility":true}' where id=$1`, [productId, id(4)])
    const typedTerms = modernTerms()
    await scalar('select bx1_portal.validate_terms($1::jsonb)', [JSON.stringify(typedTerms)])
    const modernProduct = (await db.query(`insert into bx1_portal.products(id,organisation_id,created_by,status,revision,
      terms,terms_hash,cap_units,unit_price_minor,minimum_units) values($1,$2,$3,'IN_REVIEW',1,$4::jsonb,
        encode(sha256(convert_to(($4::jsonb)::text,'UTF8')),'hex'),($4::jsonb->>'cap_units')::numeric,
        ($4::jsonb->>'unit_price_minor')::numeric,($4::jsonb->>'minimum_units')::numeric) returning *`,
    [id(308), organisationId, id(2), JSON.stringify(typedTerms)])).rows[0]
    await db.query(`insert into bx1_portal.offering_revisions(id,product_id,package_number,origin,
      product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)
      select $1,id,1,'SUBMITTED',revision,terms,terms_hash,bx1_portal.offering_document_hashes(terms),created_by,clock_timestamp()
      from bx1_portal.products where id=$2`, [id(309), id(308)])
    await db.query('update bx1_portal.products set current_offering_revision_id=$1 where id=$2', [id(309), id(308)])
    await createAppointment(id(310), 3, memberships.get(3), 'IssuerFundManager', modernProduct)
    await createAppointment(id(311), 4, memberships.get(4), 'ComplianceOfficer', modernProduct)
    await approveSyntheticPackage(id(309))
    await db.query(`update bx1_portal.products set status='APPROVED',reviewer_id=$2,reviewed_at=clock_timestamp(),
      review_notes='Synthetic modern-v2 approval remains settlement and technical closed.',
      review_checks='{"issuer":true,"terms":true,"disclosures":true,"eligibility":true}' where id=$1`, [id(308), id(4)])
    eq(await scalar('select bx1_portal.offering_approved($1)', [id(308)]), true, 'modern negative has exact current appointed package approval, not missing reviewers')
    eq(await scalar('select bx1_portal.offering_technical_ready($1)', [id(309)]), false, 'modern negative has no technical override')
    const expectedOutsideReadiness = [...nonNamespaceReadiness, { id: id(309), ready: false }].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    eq((await db.query(`select id,bx1_portal.offering_technical_ready(id) ready from bx1_portal.offering_revisions
      where id<>$1 order by id`, [offeringId])).rows, expectedOutsideReadiness,
    'new modern negative is accounted for without dropping any prior readiness proof')
    const negativeRelations = [...new Set([...moneyRelations, 'bx1_portal.products','bx1_portal.offering_revisions',
      'bx1_portal.offering_decisions','bx1_portal.product_service_appointments','bx1_portal.product_service_appointment_receipts',
      'bx1_portal.product_eligibility_cases','bx1_portal.product_eligibility_receipts','bx1_portal.events','bx1_portal.requests','bx1_portal.scoped_requests'])]
    const beforeModernDenials = await snapshot(negativeRelations)
    await denied('modern v2 publication retains the unconditional settlement seal', () => db.query(
      "update bx1_portal.products set status='PUBLISHED',published_at=clock_timestamp() where id=$1", [id(308)]),
    '23514', 'fund_v2_settlement_route_not_admitted')
    const modernRequest = { ...requestBody(1), product_id: id(308), expected_product_revision: modernProduct.revision,
      offering_revision_id: id(309), terms_hash: modernProduct.terms_hash }
    await denied('approved but closed modern v2 cannot obtain entity eligibility', () => command(1, applicant, 'request_product_eligibility', modernRequest))
    await denied('approved but closed modern v2 cannot subscribe', () => command(1, applicant, 'subscribe', {
      product_id: id(308), investment_account_id: accountByActor.get(1), expected_revision: modernProduct.revision,
      terms_hash: modernProduct.terms_hash, offering_revision_id: id(309), units: '1', accepted_documents: true, accepted_risks: true }))
    eq(await snapshot(negativeRelations), beforeModernDenials, 'modern denials preserve exact product/package/appointment/case/audit/request/order/funding fingerprints')
    eq(await scalar('select bx1_portal.offering_operational($1)', [id(308)]), false, 'modern approval is not modern operational acceptance')
    // EXACT isolated revision, all other revisions stay hard false. The
    // original definition is restored and SHA-256 verified in finally too.
    await db.query(`create or replace function bx1_portal.offering_technical_ready(target_revision uuid) returns boolean
      language sql volatile security definer set search_path='' as $$ select target_revision='${offeringId}'::uuid; $$`)
    technicalInstalled = true
    const installedTechnicalEvidence = await functionEvidence(db, ['bx1_portal.offering_technical_ready(uuid)'])
    const technicalSignature = 'bx1_portal.offering_technical_ready(uuid)'
    const { sha256: originalSourceHash, ...originalAttributes } = originalTechnicalEvidence[technicalSignature]
    const { sha256: syntheticSourceHash, ...syntheticAttributes } = installedTechnicalEvidence[technicalSignature]
    truth(originalSourceHash !== syntheticSourceHash, 'sole technical fixture changes its explicit definition, not authority attributes')
    eq(syntheticAttributes, originalAttributes, 'sole technical fixture preserves owner, ACL, security and search-path attributes')
    eq(await scalar('select bx1_portal.offering_technical_ready($1)', [offeringId]), true, 'explicit single synthetic technical fixture revision only')
    eq((await db.query(`select id,bx1_portal.offering_technical_ready(id) ready
      from bx1_portal.offering_revisions where id<>$1 order by id`, [offeringId])).rows, expectedOutsideReadiness,
    'every accepted outside readiness negative and the new modern negative remain unchanged')
    await db.query("update bx1_portal.products set status='PUBLISHED',published_at=clock_timestamp() where id=$1", [productId])
    eq(await scalar('select bx1_portal.offering_operational($1)', [productId]), true, 'positive is historical-v1 compatibility with synthetic readiness, not Stage4 acceptance')
    eq(await foundationEvidence(db), preparedFixture.evidence.foundation, 'publication preserves original foundation terms/hash/scalars/revision/pointer and owner history')
    eq(await scalar('select bx1_portal.current_product_organisation($1)', [organisationId]), true, 'prerequisite: current approved and unheld issuer organisation')
    eq(await scalar('select bx1_portal.customer_admission_package_current($1)', [ownerAppId]), true, 'prerequisite: issuer exact immutable submission and ownership predecessor remains complete')
    eq(await scalar(`select jsonb_build_array(p.revision,p.terms_hash,p.current_offering_revision_id,p.cap_units::text,
      p.unit_price_minor::text,p.minimum_units::text,r.origin,r.product_revision_at_submission,
      r.terms_hash=p.terms_hash and r.terms=p.terms and r.document_hashes=bx1_portal.offering_document_hashes(p.terms))
      from bx1_portal.products p join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id where p.id=$1`, [productId]),
    [1, product.terms_hash, offeringId, '100', '10000', '1', 'SUBMITTED', 1, true], 'prerequisite: exact immutable v1 package, canonical hash and copied numeric scalars')
    for (const n of [1, 9, 10]) {
      await claims(n); await admin()
      const account = accountByActor.get(n), mandate = mandateByActor.get(n)
      eq(await scalar(`select exists(select 1 from bx1_portal.applications a join bx1_portal.application_detail_versions d
        on d.application_id=a.id and d.application_revision=2 and d.capture_kind='SUBMISSION'
        where a.id=$1 and a.user_id=$2 and a.status='APPROVED' and a.revision=3
          and a.admission_purpose='INVESTOR_ADMISSION' and a.provider_mode='MANUAL_TEST_REVIEW'
          and d.details=a.details and d.submitted_at=a.submitted_at and a.approved_until>clock_timestamp())`, [id(200 + n), id(n)]), true,
      `prerequisite entity ${n}: exact synthetic approved admission and immutable submission`)
      eq(await scalar('select bx1_portal.entity_account_admission_current($1)', [account]), true, `prerequisite entity ${n}: canonical current account admission`)
      eq(await scalar('select bx1_portal.investing_mandate_effective($1)', [mandate.id]), true, `prerequisite entity ${n}: effective exact applied representative mandate`)
      eq(await scalar(`select jsonb_build_array(m.representative_user_id,m.cycle,m.revision,m.transaction_limit_minor::text,
        m.scope @> array['REQUEST_ELIGIBILITY']::text[],m.entity_party_id=i.entity_party_id,m.application_id=i.application_id)
        from bx1_portal.investing_representative_mandates m join bx1_portal.investment_accounts i on i.id=m.investment_account_id
        where m.id=$1 and i.id=$2`, [mandate.id, account]), [id(n), mandate.cycle, mandate.revision, '0', true, true, true],
      `prerequisite entity ${n}: exact legal-party/account/representative/cycle/revision and zero execution limit`)
      eq(await scalar('select bx1_portal.entity_eligibility_documents_current($1)', [account]), true, `prerequisite entity ${n}: exact promoted document receipts under retained scanner-required policy`)
      eq(await scalar('select bx1_portal.entity_eligibility_source_current($1,$2,$3,$4,$5,$6,$7,$8)',
        [account, mandate.id, mandate.cycle, mandate.revision, productId, product.revision, offeringId, product.terms_hash]), true,
      `prerequisite entity ${n}: complete connected source currency before lifecycle commands`)
      await claims(4); await admin()
      eq(await scalar('select bx1_portal.entity_eligibility_reviewer($1::jsonb,$2,$3)', [JSON.stringify(reviewer), account, productId]), true,
        `prerequisite entity ${n}: current independent exact product-appointed reviewer`)
      eq(await scalar('select bx1_portal.entity_eligibility_source_access($1::jsonb,$2)', [JSON.stringify(reviewer), account]), true,
        `prerequisite entity ${n}: separately authorised source application and every document path`)
    }
    const proofAuthority = await authoritySnapshot()
    eq(await existingSubjects(), oldSubjects, 'isolated preconditions and synthetic document pipeline preserve every earlier subject, assurance and document fixture')
    await commit()

    await begin()
    const body = requestBody(1), requestKey = key()
    await denied('mandatory audit failure rolls back first entity request', async () => {
      await db.query(`create function public.synthetic_entity_eligibility_audit_failure() returns trigger language plpgsql as $$
        begin if NEW.kind='request_product_eligibility' then raise exception 'synthetic_entity_audit_failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger synthetic_entity_eligibility_audit_failure before insert on bx1_portal.events
          for each row execute function public.synthetic_entity_eligibility_audit_failure()`)
      await command(1, applicant, 'request_product_eligibility', body, requestKey)
    }, '23514')
    eq(await scalar("select count(*)::int from bx1_portal.product_eligibility_cases where account_kind='ENTITY'"), 0, 'failed audit leaves no case or receipt')
    let row = find(await command(1, applicant, 'request_product_eligibility', body, requestKey), 1)
    eq([row.account_kind, row.representative_mandate_id, row.mandate_revision, row.mandate_cycle, row.offering_revision_id,
      row.product_revision, row.terms_hash, row.next_owner, row.provider_mode],
    ['ENTITY', mandateByActor.get(1).id, mandateByActor.get(1).revision, mandateByActor.get(1).cycle,
      offeringId, product.revision, product.terms_hash, 'COMPLIANCE', 'MANUAL_TEST_REVIEW'], 'request binds complete exact subject/package/mandate snapshot')
    eq(Object.hasOwn(row, 'holder_user_id'), false, 'entity projection never impersonates an individual holder')
    await proveCurrentHandoff('SUBMITTED', 1)
    const beforeRetry = await business()
    eq(find(await command(1, applicant, 'request_product_eligibility', body, requestKey), 1).id, row.id, 'exact request replay returns canonical same case')
    eq(await business(), beforeRetry, 'exact retry creates no receipt, request or event')
    await denied('divergent retry cannot replace statement', () => command(1, applicant, 'request_product_eligibility',
      { ...body, investor_statement: 'Conflicting synthetic statement using the same request key.' }, requestKey), '23505')
    for (const [field, value] of [['representative_mandate_id', mandateByActor.get(9).id], ['expected_mandate_revision', body.expected_mandate_revision + 1],
      ['expected_mandate_cycle', body.expected_mandate_cycle + 1], ['expected_product_revision', body.expected_product_revision + 1],
      ['offering_revision_id', id(9999)], ['terms_hash', 'f'.repeat(64)]])
      await denied(`exact binding denies ${field}`, () => command(1, applicant, 'request_product_eligibility', { ...body, [field]: value }))
    await denied('another entity owner cannot request first account', () => command(9, applicant, 'request_product_eligibility', body))
    await denied('original four-field shape cannot fall back to individual for ENTITY', () => command(1, applicant, 'request_product_eligibility',
      { product_id: body.product_id, investment_account_id: body.investment_account_id, expected_revision: 0, investor_statement: body.investor_statement }), '22023')
    eq((await read(1)).product_eligibility.some(value => value.id === row.id), false, 'entity case is never in individual read array')
    eq((await read(9)).entity_product_eligibility.some(value => value.id === row.id), false, 'other applicant cannot enumerate case')
    eq((await read(7, reviewer)).entity_product_eligibility.length, 0, 'native Compliance alone gives no entity case queue')
    eq((await read(7, { ...reviewer, organisationId: otherScope })).entity_product_eligibility.length, 0, 'wrong tenant cannot enumerate entity cases')
    await denied('unappointed native Compliance cannot decide', () => command(7, reviewer, 'review_product_eligibility', reviewBody(row)))
    await denied('AAL1 cannot use appointed reviewer', () => command(4, reviewer, 'review_product_eligibility', reviewBody(row), key(), db, { aal: 'aal1' }))
    await probe(async () => {
      await revokeAppointment()
      await createAppointment(id(305), 8, memberships.get(8), 'ComplianceOfficer')
      await denied('same trusted human under separate reviewer email cannot decide', () => command(8, reviewer, 'review_product_eligibility', reviewBody(row)))
      eq((await read(8, reviewer)).entity_product_eligibility.length, 0, 'same-human alias cannot enumerate counterpart case')
    })
    let reviewerRow = find(await read(4, reviewer), 1)
    truth(reviewerRow.can_decide && reviewerRow.can_approve && reviewerRow.investor_application, 'current appointed assured independent reviewer gets separately authorized source evidence')
    await probe(async () => {
      await db.query('update bx1_portal.applications set reviewer_scope=$1 where id=$2', [otherScope, id(201)])
      const hidden = find(await read(4, reviewer), 1)
      eq([hidden.can_approve, hidden.investor_application], [false, null], 'product appointment adds no cross-scope source visibility')
      await denied('unavailable separately authorized source blocks approval', () => command(4, reviewer, 'review_product_eligibility', reviewBody(row)))
    })
    row = find(await command(4, reviewer, 'review_product_eligibility', reviewBody(row, 'CHANGES_REQUIRED')), 1)
    eq([row.status, row.next_owner], ['CHANGES_REQUIRED', 'APPLICANT'], 'information request has applicant next owner')
    const correction = find(await read(1), 1)
    truth(correction.can_request, 'current applicant can resubmit same correction case')
    for (const field of ['representative_mandate_id', 'mandate_cycle', 'mandate_revision']) {
      await denied(`receipt ${field} cannot misrepresent canonical subject`, () => db.query(`insert into bx1_portal.product_eligibility_receipts(
        case_id,case_revision,action,actor_id,operating_context,command_payload,application_revision,product_revision,terms_hash,status_after,
        account_kind,investment_account_id,entity_party_id,representative_user_id,representative_mandate_id,mandate_cycle,mandate_revision,
        offering_revision_id,decision_appointment_id,decision_appointment_revision)
        select id,revision,'review_product_eligibility',reviewer_id,'{}','{}',application_revision,product_revision,terms_hash,status,
          account_kind,investment_account_id,entity_party_id,representative_user_id,
          ${field === 'representative_mandate_id' ? '$2::uuid' : 'representative_mandate_id'},
          ${field === 'mandate_cycle' ? 'mandate_cycle+1' : 'mandate_cycle'},
          ${field === 'mandate_revision' ? 'mandate_revision+1' : 'mandate_revision'},
          offering_revision_id,decision_appointment_id,decision_appointment_revision
        from bx1_portal.product_eligibility_cases where id=$1`, field === 'representative_mandate_id' ? [row.id, mandateByActor.get(9).id] : [row.id]), '23514')
    }
    row = find(await command(1, applicant, 'request_product_eligibility', requestBody(1, row.revision)), 1)
    await probe(async () => {
      await db.query("update bx1_portal.entry_configuration set manual_test_review=false where singleton")
      await denied('unavailable manual/provider policy cannot approve', () => command(4, reviewer, 'review_product_eligibility', reviewBody(row)))
    })
    await probe(async () => {
      await db.query("update bx1_portal.applications set details=jsonb_set(details,'{documents,0,sha256}',to_jsonb(repeat('f',64))) where id=$1", [id(201)])
      eq(await scalar('select bx1_portal.entity_eligibility_documents_current($1)', [accountByActor.get(1)]), false,
        'unqualified claimed document hash does not match the exact promoted receipt')
      const unavailable = find(await read(4, reviewer), 1)
      eq([unavailable.can_approve, unavailable.investor_application], [false, null], 'unavailable document source cannot project approval authority or qualified source detail')
      await denied('unavailable current document source cannot approve', () => command(4, reviewer, 'review_product_eligibility', reviewBody(row)))
    })
    eq([row.revision, row.decision_appointment_id], [3, null], 'same-case resubmission resets current decision, retains immutable history')
    row = find(await command(4, reviewer, 'review_product_eligibility', reviewBody(row, 'REJECTED')), 1)
    eq([row.status, row.next_owner], ['REJECTED', 'APPLICANT'], 'rejected case is explicit, not individual fallback')
    row = find(await command(1, applicant, 'request_product_eligibility', requestBody(1, row.revision)), 1)
    const beforeFailedReview = await business()
    await denied('mandatory decision receipt failure rolls back all changes', async () => {
      await db.query(`create function public.synthetic_entity_eligibility_receipt_failure() returns trigger language plpgsql as $$
        begin raise exception 'synthetic_entity_receipt_failure' using errcode='23514'; end $$;
        create trigger synthetic_entity_eligibility_receipt_failure before insert on bx1_portal.product_eligibility_receipts
          for each row execute function public.synthetic_entity_eligibility_receipt_failure()`)
      await command(4, reviewer, 'review_product_eligibility', reviewBody(row))
    }, '23514')
    eq(await business(), beforeFailedReview, 'receipt failure retains case revision and exact immutable receipt/event/request fingerprint')
    const approveKey = key(), approvalBody = reviewBody(row)
    row = find(await command(4, reviewer, 'review_product_eligibility', approvalBody, approveKey), 1)
    eq([row.status, row.effective, row.decision_appointment_id, row.decision_appointment_revision],
      ['APPROVED', true, id(304), 3], 'approved decision binds exact deciding appointment id/revision')
    const approvedFingerprint = await business()
    eq(find(await command(4, reviewer, 'review_product_eligibility', approvalBody, approveKey), 1).revision, 6, 'exact staff retry does not re-decide')
    eq(await business(), approvedFingerprint, 'staff retry leaves exact atomic fingerprint unchanged')
    await admin()
    eq(await scalar('select bx1_portal.entity_product_eligibility_current($1)', [row.id]), true, 'entity decision currency is caller-independent owner predicate')
    eq(await scalar('select bx1_portal.product_eligibility_current($1)', [row.id]), false, 'entity approval never passes preserved individual eligibility predicate')
    await claims(1); await admin()
    eq(await scalar('select bx1_portal.account_usable($1::jsonb,$2)', [JSON.stringify(applicant), accountByActor.get(1)]), false, 'entity approval cannot unlock individual account execution')
    await denied('approved entity remains unable to subscribe', () => command(1, applicant, 'subscribe', { product_id: productId,
      investment_account_id: accountByActor.get(1), expected_revision: product.revision, terms_hash: product.terms_hash,
      offering_revision_id: offeringId, units: '1', accepted_documents: true, accepted_risks: true }))
    await probe(async () => {
      await revokeAppointment(); await createAppointment(id(306), 4, memberships.get(4), 'ComplianceOfficer')
      eq(await scalar('select bx1_portal.entity_product_eligibility_current($1)', [row.id]), false, 'new appointment for same reviewer cannot revive old exact approval')
      const replacement = find(await read(4, reviewer), 1)
      eq([replacement.effective, replacement.can_revoke], [false, true], 'current replacement reviewer may protectively revoke, not inherit approval')
    })
    for (const [label, mutation] of [
      ['account suspension', () => db.query("update bx1_portal.investment_accounts set status='SUSPENDED' where id=$1", [accountByActor.get(1)])],
      ['admission expiry', () => db.query("update bx1_portal.applications set reviewed_at=statement_timestamp()-interval '31 days',approved_until=statement_timestamp()-interval '1 day' where id=$1", [id(201)])],
      ['mandate revision/revocation', () => db.query(`update bx1_portal.investing_representative_mandates set status='REVOKED',revision=revision+1,
        revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Synthetic representative mandate withdrawn.' where id=$1`, [mandateByActor.get(1).id, id(4)])],
      ['monitoring hold', async () => {
        await command(4, reviewer, 'set_customer_monitoring', { application_id: id(201), expected_revision: 0,
          state: 'ON_HOLD', evidence_reference: 'Synthetic entity monitoring restriction evidence.',
          reason: 'Synthetic current monitoring hold prevents new actions.', checks: { identity: true, ownership: true, screening: true, suitability: true } })
      }],
      ['changed offering revision', async () => {
        await db.query(`insert into bx1_portal.offering_revisions(id,product_id,package_number,origin,product_revision_at_submission,
          terms,terms_hash,document_hashes,submitted_by,submitted_at) select $1,product_id,2,origin,product_revision_at_submission,
            terms,terms_hash,document_hashes,submitted_by,clock_timestamp() from bx1_portal.offering_revisions where id=$2`, [id(307), offeringId])
        await db.query("update bx1_portal.products set status='DRAFT',current_offering_revision_id=$1,revision=revision+1 where id=$2", [id(307), productId])
      }],
    ]) await probe(async () => {
      await admin(); await mutation(); await admin()
      eq(await scalar('select bx1_portal.entity_product_eligibility_current($1)', [row.id]), false, `${label} invalidates decision currency`)
    })
    await probe(async () => {
      const originalMandate = mandateByActor.get(1)
      await command(4, reviewer, 'revoke_investing_representative_mandate', { mandate_id: originalMandate.id,
        expected_revision: originalMandate.revision, reason: 'Synthetic clock-expiry proof replaces the current limited representative appointment.' })
      const shortUntil = new Date(Date.now() + 20000).toISOString()
      let shortMandate = (await command(1, applicant, 'request_investing_representative_mandate', {
        investment_account_id: accountByActor.get(1), expected_revision: 0, requested_until: shortUntil,
        evidence_reference: 'Synthetic bounded clock-expiry appointment using the same reviewed company evidence.',
        appointment_document_id: documents.get(1)[1].id,
      })).investing_representative_mandates.find(value => value.cycle === 2)
      truth(shortMandate?.id && shortMandate.id !== originalMandate.id, 'guarded renewal creates a fresh mandate cycle, not revival of original authority')
      shortMandate = (await command(4, reviewer, 'review_investing_representative_mandate', { mandate_id: shortMandate.id,
        expected_revision: shortMandate.revision, decision: 'APPROVED', notes: 'Independent synthetic bounded appointment and exact reviewed company evidence.',
        checks: { appointment: true, legal_entity: true, scope: true } })).investing_representative_mandates.find(value => value.id === shortMandate.id)
      shortMandate = (await command(6, { mode: 'ROLE', organisationId: scope, role: 'SuperAdmin' }, 'apply_investing_representative_mandate',
        { mandate_id: shortMandate.id, expected_revision: shortMandate.revision })).investing_representative_mandates.find(value => value.id === shortMandate.id)
      truth(shortMandate.effective, 'short-lived synthetic mandate is actually effective before its clock deadline')
      let temporaryCase = find(await command(1, applicant, 'request_product_eligibility', { ...requestBody(1, row.revision),
        representative_mandate_id: shortMandate.id, expected_mandate_revision: shortMandate.revision, expected_mandate_cycle: shortMandate.cycle }), 1)
      temporaryCase = find(await command(4, reviewer, 'review_product_eligibility', reviewBody(temporaryCase)), 1)
      eq([temporaryCase.effective, temporaryCase.mandate_cycle, temporaryCase.representative_mandate_id],
        [true, 2, shortMandate.id], 'fresh review is bound to renewed exact mandate; no approval is inherited')
      await admin()
      const remaining = Number(await scalar('select extract(epoch from ($1::timestamptz-clock_timestamp()))', [shortUntil]))
      truth(remaining > 0 && remaining <= 20, 'expiry proof uses one bounded live deadline without editing clock/authority rows')
      await new Promise(resolve => setTimeout(resolve, Math.ceil(remaining * 1000) + 50))
      eq(await scalar('select bx1_portal.investing_mandate_effective($1)', [shortMandate.id]), false, 'the guarded mandate becomes ineffective by actual clock expiry')
      eq(await scalar('select bx1_portal.entity_product_eligibility_current($1)', [row.id]), false, 'exact entity approval becomes noncurrent at actual mandate expiry')
      const expiredView = find(await read(4, reviewer), 1)
      eq([expiredView.effective, expiredView.can_revoke], [false, true], 'current independent product reviewer can still protectively revoke expired authority')
      const expiredRevoke = find(await command(4, reviewer, 'revoke_product_eligibility', { eligibility_case_id: temporaryCase.id,
        expected_revision: temporaryCase.revision, reason: 'Protective synthetic revocation after actual restricted mandate clock expiry.' }), 1)
      eq([expiredRevoke.status, expiredRevoke.effective], ['REVOKED', false], 'protective revoke succeeds after actual mandate expiry without restoring it')
    })
    await probe(async () => {
      await db.query("update bx1_portal.applications set reviewed_at=statement_timestamp()-interval '31 days',approved_until=statement_timestamp()-interval '1 day' where id=$1", [id(201)])
      const protectedCase = find(await command(4, reviewer, 'revoke_product_eligibility', { eligibility_case_id: row.id,
        expected_revision: row.revision, reason: 'Protective synthetic revocation after upstream admission and mandate expiry.' }), 1)
      eq([protectedCase.status, protectedCase.effective], ['REVOKED', false], 'expiry does not prevent protective current-independent-reviewer revocation')
    })
    await probe(async () => {
      await db.query("update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false where singleton")
      const before = await business()
      for (const iss of [testIssuer, mainIssuer]) {
        await denied('strict MAIN configuration denies entity request regardless of issuer', () => command(9, applicant,
          'request_product_eligibility', requestBody(9), key(), db, { iss }))
        await denied('strict MAIN configuration denies entity decision', () => command(4, reviewer,
          'review_product_eligibility', approvalBody, key(), db, { iss }))
        await denied('strict MAIN configuration denies entity protective revoke', () => command(4, reviewer,
          'revoke_product_eligibility', { eligibility_case_id: row.id, expected_revision: row.revision,
            reason: 'Synthetic sealed MAIN revocation attempt cannot change case.' }, key(), db, { iss }))
      }
      eq(await business(), before, 'MAIN rejects every entity mutation without case/receipt/event/request side effect')
      eq(await scalar('select bx1_portal.entity_product_eligibility_current($1)', [row.id]), false, 'owner currency also fails closed under sealed MAIN')
    })
    await denied('hybrid holder/entity shape cannot be owner-invented', async () => {
      await db.query('update bx1_portal.product_eligibility_cases set holder_user_id=$2,revision=revision+1 where id=$1', [row.id, id(1)])
    }, '23514')
    await denied('entity subject kind cannot be converted to individual', async () => {
      await db.query(`update bx1_portal.product_eligibility_cases set account_kind='INDIVIDUAL',revision=revision+1 where id=$1`, [row.id])
    }, '23514')
    await denied('immutable entity receipt cannot be deleted', () => db.query('delete from bx1_portal.product_eligibility_receipts where case_id=$1', [row.id]), '23514')
    row = find(await command(4, reviewer, 'revoke_product_eligibility', { eligibility_case_id: row.id, expected_revision: row.revision,
      reason: 'Synthetic evaluation complete; entity approval protectively revoked with no execution.' }), 1)
    eq([row.status, row.revision, row.effective], ['REVOKED', 7, false], 'terminal revoke preserves same case and closes decision')
    await denied('revoked case cannot resurrect using still-effective mandate', () => command(1, applicant, 'request_product_eligibility', requestBody(1, row.revision)), '23514')
    await admin()
    const receipts = (await db.query(`select case_revision,action,status_after,account_kind,investment_account_id,entity_party_id,
      representative_user_id,representative_mandate_id,mandate_revision,mandate_cycle,offering_revision_id,
      product_revision,application_revision,terms_hash,decision_appointment_id,decision_appointment_revision
      from bx1_portal.product_eligibility_receipts where case_id=$1 order by case_revision`, [row.id])).rows
    eq(receipts.map(r => [r.case_revision, r.status_after]), [[1, 'SUBMITTED'], [2, 'CHANGES_REQUIRED'], [3, 'SUBMITTED'],
      [4, 'REJECTED'], [5, 'SUBMITTED'], [6, 'APPROVED'], [7, 'REVOKED']], 'exact immutable revision sequence proves connected information/resubmit/review/revoke flow')
    truth(receipts.every(r => r.account_kind === 'ENTITY' && r.investment_account_id === accountByActor.get(1)
      && r.entity_party_id === row.entity_party_id && r.representative_user_id === id(1)
      && r.representative_mandate_id === mandateByActor.get(1).id && r.mandate_revision === mandateByActor.get(1).revision
      && r.mandate_cycle === 1 && r.offering_revision_id === offeringId && r.product_revision === product.revision
      && r.application_revision === 3 && r.terms_hash === product.terms_hash
      && (r.action === 'request_product_eligibility' ? r.decision_appointment_id === null && r.decision_appointment_revision === null
        : r.decision_appointment_id === id(304) && r.decision_appointment_revision === 3)), 'every receipt contains complete exact subject, source and deciding-appointment snapshot')
    const other = find(await command(9, applicant, 'request_product_eligibility', requestBody(9)), 9)
    await command(4, reviewer, 'review_product_eligibility', reviewBody(other, 'CHANGES_REQUIRED'))
    await admin(); eq(await authoritySnapshot(), proofAuthority, 'eligibility commands change no fixture memberships/policy/provider or admission configuration')
    eq(await individualHistory(true), oldIndividuals, 'full connected entity flow preserves historical individual cases and receipts')
    eq(await existingSubjects(), oldSubjects, 'entity lifecycle preserves every nonnamespace historical assurance and document record')
    eq(await snapshot(moneyRelations), oldMoney, 'full connected flow produces no order/funding/settlement mutation')
    await commit()

    const pids = await Promise.all(clients.map(client => scalar('select pg_backend_pid()', [], client)))
    const blockerPid = await scalar('select pg_backend_pid()')
    truth(new Set([...pids, blockerPid]).size === 3, 'all concurrency checks use three independently connected backend PIDs')
    const transact = async (client, action) => {
      await client.query('begin')
      try { const result = await action(); await client.query('commit'); return { result } }
      catch (error) { await client.query('rollback'); return { code: error?.code } }
      finally { await admin(client) }
    }
    // Two requests really overlap on the owner-held product. The winner writes
    // once; the second backend must observe the same committed exact retry.
    await begin(); await db.query('select id from bx1_portal.products where id=$1 for update', [productId])
    const raceKey = key(), raceBody = requestBody(10)
    const replayRaces = clients.map(client => transact(client, () => command(10, applicant,
      'request_product_eligibility', raceBody, raceKey, client)))
    try {
      let overlap = false
      for (let attempt = 0; attempt < 150; attempt++) {
        overlap = await scalar(`select (select count(*) from pg_stat_activity where pid=any($1::int[])
          and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)=2
          and exists(select 1 from pg_stat_activity where pid=any($1::int[]) and $2=any(pg_blocking_pids(pid)))`, [pids, blockerPid])
        if (overlap) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      truth(overlap, 'both independent replay backends genuinely overlap on the owner product lock and canonical actor serialization')
      await commit()
      const outcomes = await Promise.all(replayRaces)
      truth(outcomes.every(outcome => outcome.result), 'both overlapped exact-retry clients return successful same operation')
      const rows = outcomes.map(outcome => find(outcome.result, 10))
      eq([rows[0].id, rows[0].revision], [rows[1].id, 1], 'two-backend replay creates exactly one canonical submitted case')
      await begin()
      eq(await scalar('select count(*)::int from bx1_portal.product_eligibility_receipts where case_id=$1', [rows[0].id]), 1, 'overlapped replay has one exact immutable receipt')
      eq(await scalar('select count(*)::int from bx1_portal.events where subject_id=$1 and kind=$2', [rows[0].id, 'request_product_eligibility']), 1, 'overlapped replay has one mandatory audit event')
      eq(await scalar('select count(*)::int from bx1_portal.scoped_requests where actor_id=$1 and request_key=$2', [id(10), raceKey]), 1, 'overlapped replay has one idempotency receipt')
      await commit()
    } finally {
      if (begun) { await db.query('rollback'); begun = false }
      await Promise.all(replayRaces)
    }
    // Request resumes AFTER revocation of its exact applicant mandate. Product
    // locks are held by the writer, so the case must remain changes-required.
    await begin()
    const currentOther = find(await read(9), 9)
    const requestBefore = await business()
    await admin(); await db.query('select id from bx1_portal.products where id=$1 for update', [productId])
    const interruptedRequest = transact(clients[0], () => command(9, applicant, 'request_product_eligibility',
      requestBody(9, currentOther.revision), key(), clients[0]))
    try {
      await waitOn(pids[0], blockerPid)
      const revoked = await db.query(`update bx1_portal.investing_representative_mandates set status='REVOKED',revision=revision+1,
        revoked_at=clock_timestamp(),revoked_by_user_id=$2,revoke_reason='Synthetic mandate revoked while eligibility request waits.'
        where id=$1 and status='APPLIED'`, [mandateByActor.get(9).id, id(4)])
      eq(revoked.rowCount, 1, 'wait race revokes exactly the helper-owned applicant mandate')
      await commit()
      eq(await interruptedRequest, { code: '42501' }, 'waited request observes committed exact-mandate revocation and returns no projection')
      await begin(); eq(await business(), requestBefore, 'denied waited request creates no case revision/receipt/event/request'); await commit()
    } finally {
      if (begun) { await db.query('rollback'); begun = false }
      await interruptedRequest
    }
    // A relation wait guarantees the read passed initial context validation.
    // Only our synthetic actor's session is removed before aggregation resumes.
    await begin(); truth(find(await read(1), 1), 'helper-owned applicant can read its history before session race')
    const readBefore = await business()
    await admin(); await db.query('lock table bx1_portal.product_eligibility_cases in access exclusive mode')
    const interruptedRead = transact(clients[0], () => read(1, applicant, clients[0]))
    try {
      await waitOn(pids[0], blockerPid, 'bx1_portal.product_eligibility_cases', 'AccessShareLock')
      eq((await db.query('delete from auth.sessions where id=$1', [id(101)])).rowCount, 1, 'read race removes one helper-owned synthetic session')
      await commit()
      eq(await interruptedRead, { code: '42501' }, 'read revalidates current session after genuine relation wait and returns no cached history')
      await begin(); eq(await business(), readBefore, 'read wait revocation creates no case or audit writes'); await commit()
    } finally {
      if (begun) { await db.query('rollback'); begun = false }
      await interruptedRead
    }
    // The deciding appointment is revoked while an already-assured staff
    // operation waits for the canonical product lock. No cached native role or
    // appointment can authorise the resumed decision.
    await begin()
    const waitingCase = find(await read(4, reviewer), 10), reviewBefore = await business()
    truth(waitingCase?.can_approve, 'current appointed reviewer is authorized before decision wait')
    await admin(); await db.query('select id from bx1_portal.products where id=$1 for update', [productId])
    const interruptedReview = transact(clients[0], () => command(4, reviewer, 'review_product_eligibility', reviewBody(waitingCase), key(), clients[0]))
    try {
      await waitOn(pids[0], blockerPid)
      eq((await revokeAppointment()).rowCount, 1, 'decision race revokes one exact helper-owned appointment')
      await commit()
      eq(await interruptedReview, { code: '42501' }, 'waited decision observes revoked current appointment and returns no projection')
      await begin(); eq(await business(), reviewBefore, 'denied waited review rolls back decision/receipt/event/idempotency completely')
      eq(await individualHistory(true), oldIndividuals, 'all concurrency preserves every original individual case and receipt')
      eq(await snapshot(moneyRelations), oldMoney, 'all concurrency preserves no-order/no-funding fingerprints')
      eq(await authoritySnapshot(), proofAuthority, 'all concurrency preserves native grants, policies, provider evidence and entry configuration')
      eq(await existingSubjects(), oldSubjects, 'wait revocations affect only explicitly owned fresh namespace subjects, never accepted participants')
      eq(await functionHashes(), oldFunctions, 'all production individual and offering guards are still unchanged')
      eq(await foundationEvidence(db), preparedFixture.evidence.foundation, 'all lifecycle and rollback probes preserve exact immutable prepared foundation')
      eq((await db.query(`select id,bx1_portal.offering_technical_ready(id) ready from bx1_portal.offering_revisions
        where id<>$1 order by id`, [offeringId])).rows, expectedOutsideReadiness, 'all lifecycle/waits preserve every outside technical negative including modern v2')
      await db.query(originalTechnical)
      const restored = await scalar("select pg_get_functiondef('bx1_portal.offering_technical_ready(uuid)'::regprocedure)")
      eq(createHash('sha256').update(restored).digest('hex'), originalTechnicalHash, 'original technical-readiness function is exactly SHA-256 restored before returning')
      eq(await functionEvidence(db, ['bx1_portal.offering_technical_ready(uuid)']), originalTechnicalEvidence,
        'original technical-ready full definition hash/owner/ACL/security/search-path attributes are restored')
      eq(await scalar('select bx1_portal.offering_technical_ready($1)', [offeringId]), false, 'own positive fixture closes too when original readiness is restored')
      eq(await scalar('select bx1_portal.offering_technical_ready($1)', [id(309)]), false, 'modern v2 remains closed after restoration too')
      eq(await scalar('select status from bx1_portal.products where id=$1', [id(308)]), 'APPROVED', 'modern v2 negative is never published by the compatibility proof')
      await commit(); technicalInstalled = false
    } finally {
      if (begun) { await db.query('rollback'); begun = false }
      await interruptedReview
    }
    console.log(`BX1_ENTITY_ELIGIBILITY_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 positive=synthetic-legacy-v1-compatibility modernV2=approved-but-closed modernAcceptance=not-proven subject=canonical-XOR decisionAppointment=exact-no-revival lifecycle=request-info-resubmit-review-revoke handoff=current-chain-actor-application-revision-nonmutating concurrency=three-distinct-observed-backend-PIDs auditRollback=atomic idempotency=overlapped-exact-replay technicalReadiness=synthetic-fixture-not-chain-proof providerAcceptance=not-proven scannerEngine=not-proven humanAcceptance=not-proven entityExecution=denied MAIN=sealed`)
    return checks
  } finally {
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
    if (begun) { await admin().catch(() => {}); await db.query('rollback').catch(() => {}); begun = false }
    await admin().catch(() => {})
    if (technicalInstalled && originalTechnical) {
      // Restoring is deliberately attempted even when a proof assertion fails.
      // The outer test runner subsequently drops its disposable schema only.
      await db.query('begin')
      try {
        await db.query(originalTechnical)
        const restored = await scalar("select pg_get_functiondef('bx1_portal.offering_technical_ready(uuid)'::regprocedure)")
        assert.equal(createHash('sha256').update(restored).digest('hex'), originalTechnicalHash, 'failure cleanup restores exact original technical-ready source')
        assert.deepEqual(await functionEvidence(db, ['bx1_portal.offering_technical_ready(uuid)']), originalTechnicalEvidence,
          'failure cleanup restores full original technical-ready owner/ACL/security/search-path attributes')
        await db.query('commit')
      } catch (error) { await db.query('rollback'); throw error }
    }
  }
}
