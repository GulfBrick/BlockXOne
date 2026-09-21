import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Never run locally or against Supabase. Provider facts below are deliberately
// synthetic trusted-writer inputs, not a claim that an on-chain payment occurred.
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Funding SQL proof requires cloud CI without arguments')
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.env.BX1_FUNDING_SQL_TEST_URL !== expected) throw new Error('Funding SQL proof requires the exact disposable CI database')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000, application_name: 'bx1-funding-cloud-ci' }
const db = new pg.Client(options), peers = []
let phase = 'initialise', checks = 0, sequence = 0, txSequence = 0, begun = false, committed = false, connected = false
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

try {
  await db.connect(); connected = true
  const version = Number(await scalar('show server_version_num'))
  truth(version >= 170000 && version < 180000, 'pinned PostgreSQL17')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'disposable service')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'empty fixture database')
  await db.query('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.query('alter table auth.users add column email text; alter table auth.users add column email_confirmed_at timestamptz; alter table auth.users add column is_anonymous boolean default false; alter table auth.sessions add column created_at timestamptz not null default now(); alter table auth.users enable row level security; alter table auth.sessions enable row level security')
  await db.query('create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,metadata jsonb,user_metadata jsonb,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated')
  for (const file of ['20260916234746_bx1_identity_workspace.sql', '20260917190042_bx1_wallet_ownership.sql', '20260918015541_bx1_mfa_assurance.sql', '20260918234447_bx1_controlled_administration.sql']) await sqlFile(`../../../supabase/migrations/${file}`)
  await sqlFile('../../../supabase/features/bx1_portal.sql')
  await sqlFile('../../../supabase/tests/bx1_portal.sql')
  phase = 'canonical-preexisting-business-records'
  await approveApplicant(1, true); await approveApplicant(3); await approveApplicant(6)
  await actor(1); const orgId = (await scalar('select public.bx1_portal_read()')).organisations[0].id
  const fund = await publish(orgId, 'FUND'), estate = await publish(orgId, 'REAL_ESTATE')
  await admin(); await sqlFile('../../../supabase/migrations/20260921160000_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/tests/bx1_portal_authority_accounts.sql')
  await sqlFile('../../../supabase/features/bx1_portal_funding.sql')
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
    await admin(); eq(await scalar("select sum(case when side='DEBIT' then amount_base_units else -amount_base_units end)::text from bx1_portal.funding_journal_lines l join bx1_portal.funding_journals j on j.id=l.journal_id where obligation_id=$1", [o.obligation.id]), '0', 'both journal legs balance exactly')
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
  for (let n = 0; n < 2; n++) { const client = new pg.Client({ ...options, application_name: `bx1-funding-race-${n}` }); await client.connect(); peers.push(client) }
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
  phase = 'cleanup'
  await db.query('drop schema bx1_portal,bx1_private,storage,auth,public cascade; create schema public'); committed = false
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','storage','bx1_private','bx1_portal')"), 0, 'synthetic schemas removed')
  console.log(`BX1_FUNDING_SQL_PASS assertions=${checks} bothAssets=canonical-obligation-and-ledger providerFacts=synthetic-only realChainReceipt=not-proven authProvider=not-proven mainnet=not-enabled concurrency=reference-cancellation-observation-retry-session-expiry cleanup=removed`)
} catch (error) {
  const diagnostic = typeof error?.message === 'string' ? error.message.split(/[\r\n]/, 1)[0].slice(0, 220).replace(/[^\x20-\x7e]/g, '?') : 'unavailable'
  console.error(`BX1_FUNDING_SQL_FAILED phase=${phase} line=${error?.fixtureLine ?? 'unknown'} code=${error?.code ?? 'assertion'} diagnostic=${JSON.stringify(diagnostic)}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.query('rollback') } catch {} }
  await Promise.all(peers.map(c => c.end().catch(() => {})))
  if (committed && connected) { try { await admin(); await db.query('drop schema bx1_portal,bx1_private,storage,auth,public cascade; create schema public') } catch { console.error('BX1_FUNDING_CLEANUP_FAILED disposable-service-will-be-destroyed-by-CI'); process.exitCode = 1 } }
  if (connected) await db.end()
}
