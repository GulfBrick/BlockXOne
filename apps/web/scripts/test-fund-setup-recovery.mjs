import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

// Disposable GitHub PostgreSQL17 ONLY. Never use a Supabase/project connection.
// Real new writer, existing locks/guards/nonce/audit; explicit synthetic external
// actor/MFA/wallet seams below are NOT genuine hosted authentication or Amoy.
const expected = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.BX1_FUND_SETUP_RECOVERY_SQL_TEST_URL !== expected) throw new Error('Setup recovery proof requires the exact disposable cloud fixture')
const options = { connectionString: expected, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 20000, statement_timeout: 15000 }
const db = new pg.Client(options), peers = []
let connected = false, created = false, phase = 'initialise', checks = 0, sequence = 800000
const id = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = () => id(++sequence), actor = id(1), organisation = id(2)
const context = { mode: 'ROLE', organisationId: organisation, role: 'TokenisationAgent' }
const address = n => `0x${BigInt(n).toString(16).padStart(40, '0')}`
const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`
const digest = 'a'.repeat(64), runtime = hash(999)
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
async function scalar(sql, params = [], client = db) { return Object.values((await client.query(sql, params)).rows[0])[0] }
async function owner(client = db) { await client.query('reset role') }
async function worker(client = db) { await client.query('set role bx1_fund_execution_worker') }
const file = async path => readFile(new URL(path, import.meta.url), 'utf8')
function definition(source, name) {
  const start = source.indexOf(`create function ${name}(`), delimiter = source.indexOf('$$', start), end = source.indexOf('$$;', delimiter + 2)
  assert(start >= 0 && delimiter > start && end > delimiter, `Exact fixture function ${name} exists`)
  return source.slice(start, end + 3)
}
function table(source, name) {
  const start = source.indexOf(`create table ${name} (`), end = source.indexOf('\n);', start)
  assert(start >= 0 && end > start, `Exact fixture table ${name} exists`)
  return source.slice(start, end + 3)
}
async function denied(label, action, wanted = '23514') {
  await owner(); await db.query('begin'); let code
  try { await action() } catch (error) { code = error.code }
  await db.query('rollback'); await owner(); eq(code, wanted, label)
}
async function revision(s, client = db) { await owner(client); return scalar('select revision from bx1_portal.fund_setups where id=$1', [s.setup], client) }
async function read(s, client = db) {
  const rev = await revision(s, client); await worker(client)
  return scalar('select bx1_portal.read_fund_setup_retry($1,$2,$3,$4,$5::jsonb)', [s.setup, s.step, rev, actor, JSON.stringify(context)], client)
}
async function record(preparation, action, details, requestKey = key(), client = db) {
  await worker(client)
  return scalar('select bx1_portal.record_fund_setup_retry($1::jsonb,$2,$3,$4::jsonb)',
    [JSON.stringify(preparation), action, requestKey, JSON.stringify(details)], client)
}
function proof(r, patch = {}) {
  const anchor = { block_number: '200', block_hash: hash(200) }
  return { version: 1, chain_id: 80002, checked_at: new Date().toISOString(), status: 'RETRY_AVAILABLE', reason_code: null,
    sender: r.sender, nonce: r.intent.nonce, intent_hash: r.intent_hash, anchor,
    providers: ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'].map(url => ({ url,
      finalized_block_number: '200', finalized_block_hash: hash(200), latest_nonce: r.intent.nonce, pending_nonce: r.intent.nonce })),
    finalized_nonce: { ...anchor, nonce: r.intent.nonce },
    transaction_hash: null, retry_checks: { runtime_hash: r.intent.expected_runtime_hash, owner: r.sender, before_version: '0.0.0', simulation_succeeded: true },
    winner: null, ...patch }
}
async function snapshot(s) {
  await owner()
  return scalar(`select jsonb_build_object('setup',(select to_jsonb(f) from bx1_portal.fund_setups f where f.id=$1),
    'step',(select to_jsonb(t) from bx1_portal.fund_setup_steps t where t.id=$2),
    'leases',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from bx1_private.fund_setup_retry_leases l where setup_id=$1),
    'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by request_key),'[]') from bx1_portal.fund_setup_requests r where setup_id=$1),
    'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from bx1_portal.fund_setup_transaction_attempts a where setup_id=$1),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from bx1_portal.fund_setup_events e where setup_id=$1),
    'fund_events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from bx1_portal.fund_operation_events e where product_id=$3),
    'portal_events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from bx1_portal.events e where organisation_id=$4 and subject_id=$2))`,
  [s.setup, s.step, s.product, organisation])
}
async function seed(n) {
  await owner()
  const s = { setup: id(10000 + n), step: id(20000 + n), product: id(30000 + n), offering: id(40000 + n), sender: address(100000 + n) }
  const authority = address(50000 + n), cfg = { safe_address: address(2), identity_management_key: address(3), claim_management_key: address(4),
    token_management_key: address(5), maximum_holding_base_units: '100', tst_initial_holder: address(6), tst_initial_supply_base_units: '1000000' }
  await db.query('insert into bx1_private.fixture_authority(product_id,actor_id,context,sender,expires_at) values($1,$2,$3::jsonb,$4,clock_timestamp()+interval \'1 hour\')', [s.product, actor, JSON.stringify(context), s.sender])
  await db.query('insert into bx1_private.fixture_package(product_id,approved) values($1,true)', [s.product])
  const claims = { sub: actor, session_id: id(3), aal: 'aal2', role: 'authenticated', iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 }
  const terms = { terms_version: 3, asset_type: 'FUND', currency: 'TST', settlement_decimals: 6 }
  await db.query('insert into bx1_portal.products(id,organisation_id,revision,current_offering_revision_id,terms_hash,terms) values($1,$2,1,$3,$4,$5::jsonb)', [s.product, organisation, s.offering, digest, JSON.stringify(terms)])
  await db.query('insert into bx1_portal.offering_revisions(id,product_id,terms_hash,deployment_configuration_hash,terms) values($1,$2,$3,$3,$4::jsonb)', [s.offering, s.product, digest, JSON.stringify(terms)])
  await db.query(`insert into bx1_portal.fund_setups(id,product_id,offering_revision_id,product_revision,terms_hash,configuration_hash,
    actor_id,operating_context,actor_claims,roleplay_policy,expires_at,safe_address,safe_state,safe_owners,safe_threshold,safe_observation_id,
    configuration,setup_configuration_hash,catalog_hash) values($1,$2,$3,1,$4,$4,$5,$6::jsonb,$7::jsonb,
    bx1_portal.fund_setup_roleplay($6::jsonb,$2),clock_timestamp()+interval '1 hour',$8,'VERIFIED','[]',2,$9,$10::jsonb,$4,$4)`,
  [s.setup, s.product, s.offering, digest, actor, JSON.stringify(context), JSON.stringify(claims), address(2), id(60000 + n), JSON.stringify(cfg)])
  const graph = (await db.query('select * from bx1_portal.fund_setup_graph() order by ordinal')).rows
  for (const g of graph) {
    if (g.ordinal > 11) { await db.query('insert into bx1_portal.fund_setup_steps(setup_id,step_key,ordinal,kind) values($1,$2,$3,$4)', [s.setup, g.step_key, g.ordinal, g.kind]); continue }
    const stepId = g.ordinal === 11 ? s.step : id(100000 + n * 100 + g.ordinal), observedId = id(200000 + n * 100 + g.ordinal)
    const intent = { version: 1, chain_id: 80002, step_key: g.step_key, kind: g.kind, sender: s.sender, nonce: String(g.ordinal - 1), value: '0',
      to: g.ordinal === 11 ? authority : null, data: '0x1234', expected_address: g.ordinal === 10 ? authority : address(100 + g.ordinal),
      artifact_name: g.ordinal === 11 ? 'TREXImplementationAuthority' : 'SyntheticDependency', expected_runtime_hash: runtime,
      checks: [], configuration_hash: digest, catalog_hash: digest }
    await db.query(`insert into bx1_portal.fund_setup_steps(id,setup_id,step_key,ordinal,kind,state,actor_id,sender,nonce,intent,intent_hash,data_hash,
      expires_at,claimed_at,transaction_hash,deployed_address,observation_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,bx1_portal.fund_digest($10::jsonb),encode(sha256(decode('1234','hex')),'hex'),
      clock_timestamp()-interval '9 minutes',clock_timestamp()-interval '10 minutes',$11,$12,$13)`,
    [stepId, s.setup, g.step_key, g.ordinal, g.kind, g.ordinal === 11 ? 'UNKNOWN' : 'FINAL', actor, s.sender, String(g.ordinal - 1), JSON.stringify(intent),
      g.ordinal === 11 ? null : hash(1000 + g.ordinal), g.ordinal === 11 ? null : intent.expected_address, g.ordinal === 11 ? null : observedId])
    if (g.ordinal < 11) {
      const result = { status: 'FINAL', block_number: String(100 + g.ordinal), block_hash: hash(100 + g.ordinal) }
      await db.query(`insert into bx1_portal.fund_setup_observations(id,setup_id,step_id,request_hash,result_hash,actor_id,operating_context,result)
        values($1,$2,$3,bx1_portal.fund_digest(to_jsonb($1::text)),bx1_portal.fund_digest($4::jsonb),$5,$6::jsonb,$4::jsonb)`,
      [observedId, s.setup, stepId, JSON.stringify(result), actor, JSON.stringify(context)])
    }
  }
  return s
}
async function pastLease(s, ageSeconds = 300) {
  const createdAt = new Date(Date.now() - ageSeconds * 1000).toISOString()
  const r = await read(s), requestKey = key(), leaseId = key(), p = proof(r, { checked_at: createdAt })
  await owner(); await db.query('begin')
  // Seed only an explicitly historical disposable fixture, never alter an
  // immutable live lease or pretend that a real 120-second wait occurred.
  const identity = { action: 'CLAIM', setup_id: s.setup, step_id: s.step, actor_id: actor, operating_context: context,
    intent_hash: r.intent_hash, sender: r.sender, nonce: r.intent.nonce, expected_revision: r.expected_revision, expected_step_revision: r.expected_step_revision }
  await db.query(`insert into bx1_portal.fund_setup_requests(actor_id,request_key,setup_id,command,payload,operating_context)
    values($1,$2,$3,'RETRY_CLAIM',$5::jsonb,$4::jsonb)`, [actor, requestKey, s.setup, JSON.stringify(context), JSON.stringify({ retry_identity: identity, server_proof: p })])
  await db.query(`insert into bx1_private.fund_setup_retry_leases(id,setup_id,step_id,actor_id,operating_context,intent_hash,sender,nonce,request_key,
    created_at,expires_at,expected_revision,expected_step_revision,proof,proof_hash)
    values($1,$2,$3,$4,$5::jsonb,$6,$7,10,$8,$9::timestamptz,$9::timestamptz+interval '120 seconds',
    $10,$11,$12::jsonb,bx1_portal.fund_digest($12::jsonb))`,
  [leaseId, s.setup, s.step, actor, JSON.stringify(context), r.intent_hash, r.sender, requestKey, createdAt, r.expected_revision, r.expected_step_revision, JSON.stringify(p)])
  await db.query('update bx1_portal.fund_setup_steps set revision=revision+1 where id=$1', [s.step])
  await db.query('update bx1_portal.fund_setups set revision=revision+1 where id=$1', [s.setup]); await db.query('commit')
  return { lease_id: leaseId, request_key: requestKey, preparation: r }
}
async function transaction(client, action) {
  await owner(client); await client.query('begin')
  try { const value = await action(client); await client.query('commit'); return { value } }
  catch (error) { await client.query('rollback'); return { code: error.code } }
}
async function blocked(pids) {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    await db.query('select pg_stat_clear_snapshot()')
    if (await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids]) === pids.length) { checks++; return }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Retry writer calls did not overlap on the real product lock')
}
try {
  await db.connect(); connected = true
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and inet_server_addr() is not null"), true, 'exact disposable service')
  const version = Number(await scalar('show server_version_num')); assert(version >= 170000 && version < 180000); checks++
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','bx1_private','bx1_portal')"), 0, 'fresh disposable schema')
  phase = 'declared-fixture'
  const [identitySql, portal, funding, lifecycle, setup, installer, catalogProof] = await Promise.all([
    file('../../../supabase/tests/bx1_identity_workspace.sql'), file('../../../supabase/features/bx1_portal.sql'), file('../../../supabase/features/bx1_portal_funding.sql'),
    file('../../../supabase/features/bx1_fund_lifecycle.sql'), file('../../../supabase/features/bx1_fund_setup.sql'),
    file('../../../supabase/features/bx1_fund_setup_unknown_recovery.sql'), file('../../../supabase/tests/bx1_fund_setup_unknown_recovery.sql')])
  await db.query(identitySql); created = true
  await db.query(`create role bx1_fund_execution_worker nologin;create schema bx1_private;create schema bx1_portal;
    create table bx1_portal.entry_configuration(singleton boolean primary key default true,environment text not null);
    insert into bx1_portal.entry_configuration values(true,'TESTNET');
    create table bx1_portal.organisations(id uuid primary key);
    create table bx1_portal.applications(id uuid primary key);
    create table bx1_portal.products(id uuid primary key,organisation_id uuid,revision integer,current_offering_revision_id uuid,terms_hash text,terms jsonb);
    create table bx1_portal.offering_revisions(id uuid primary key,product_id uuid,terms_hash text,deployment_configuration_hash text,terms jsonb);
    create table bx1_portal.fund_operations(id uuid primary key);
    create table bx1_private.fixture_authority(product_id uuid primary key,actor_id uuid,context jsonb,sender text,expires_at timestamptz,wallet boolean default true,enabled boolean default true);
    create table bx1_private.fixture_package(product_id uuid primary key,approved boolean not null);
    insert into auth.users(id) values('${actor}');insert into bx1_portal.organisations values('${organisation}');
    grant usage on schema bx1_portal to bx1_fund_execution_worker;`)
  for (const [source, name] of [[portal, 'bx1_portal.require_keys'], [portal, 'bx1_portal.immutable_record'], [funding, 'bx1_portal.funding_require_revision'], [lifecycle, 'bx1_portal.fund_digest']]) await db.query(definition(source, name))
  await db.query(table(portal, 'bx1_portal.events')); await db.query(table(lifecycle, 'bx1_portal.fund_operation_events'))
  const coreStart = setup.indexOf('create table bx1_portal.fund_setups ('), coreEnd = setup.indexOf('create function bx1_portal.fund_setup_graph(')
  assert(coreStart >= 0 && coreEnd > coreStart); await db.query(setup.slice(coreStart, coreEnd))
  // EXPLICIT external authority seams, restricted to this disposable fixture.
  // Locks, current immutable setup binding, saved-claim entry and audit are real.
  await db.query(`create function bx1_portal.fund_setup_roleplay(c jsonb,pid uuid) returns jsonb language sql volatile set search_path='' as $$
    select jsonb_build_object('policy_id','e1000000-0000-4000-8000-000000000099','epoch',2,'expires_at',a.expires_at,'label','SYNTHETIC CLOUD AUTHORITY ONLY')
      from bx1_private.fixture_authority a where a.product_id=pid and a.context=c and a.enabled;$$;
    create function bx1_portal.fund_setup_context(c jsonb,pid uuid,protected boolean default false) returns boolean language sql volatile set search_path='' as $$
      select exists(select 1 from bx1_private.fixture_authority a where a.product_id=pid and a.actor_id=auth.uid() and a.context=c and a.enabled
        and a.expires_at>clock_timestamp() and (not protected or auth.jwt()->>'aal'='aal2'))
        and exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET');$$;
    create function bx1_portal.fund_setup_wallet_current(actor uuid,sender text) returns boolean language sql volatile set search_path='' as $$
      select exists(select 1 from bx1_private.fixture_authority a where a.actor_id=$1 and a.sender=$2 and a.wallet and a.enabled);$$;
    create function bx1_private.test_roleplay_lock(c jsonb,pid uuid,lane text,action text) returns void language plpgsql set search_path='' as $$
      begin perform a.product_id from bx1_private.fixture_authority a where a.product_id=pid and a.context=c for share;end;$$;
    create function bx1_portal.admission_lock_actor(application uuid,c jsonb) returns void language plpgsql as $$begin raise exception 'unused ordinary authority seam';end;$$;
    create function bx1_portal.offering_workflow_lock_product(c jsonb,pid uuid) returns void language plpgsql as $$begin raise exception 'unused ordinary authority seam';end;$$;
    create function bx1_portal.fund_setup_package_approved(pid uuid) returns boolean language sql volatile set search_path='' as $$
      select exists(select 1 from bx1_private.fixture_package p where p.product_id=$1 and p.approved);$$;`)
  for (const name of ['fund_setup_graph', 'fund_setup_lock', 'fund_setup_current', 'fund_setup_worker_enter', 'fund_setup_audit', 'fund_setup_projection']) await db.query(definition(setup, `bx1_portal.${name}`))
  await db.query(definition(lifecycle, 'bx1_portal.fund_audit'))
  await db.query('revoke all on all functions in schema bx1_portal,bx1_private from public,anon,authenticated,service_role,bx1_fund_execution_worker')
  await db.query('alter default privileges in schema bx1_private grant select on tables to authenticated')
  const baseline = await scalar("select jsonb_object_agg(oid::text,to_jsonb(p)) from pg_proc p where pronamespace in ('bx1_portal'::regnamespace,'bx1_private'::regnamespace)")
  phase = 'additive-installer-twice'
  await db.query('begin'); await db.query(installer); await db.query(installer); await db.query(catalogProof); await db.query('commit')
  eq(await scalar("select jsonb_object_agg(oid::text,to_jsonb(p)) from pg_proc p where pronamespace in ('bx1_portal'::regnamespace,'bx1_private'::regnamespace) and proname not in ('read_fund_setup_retry','record_fund_setup_retry')"), baseline, 'all existing fixture functions preserved')
  const s = await seed(1), original = await snapshot(s), r = await read(s), requestKey = key()
  eq(r.original_state, 'UNKNOWN', 'original UNKNOWN read'); eq(Date.parse(r.original_expires_at) < Date.now(), true, 'expired original preparation is historical, not retry authority')
  phase = 'claim-replay-and-limits'
  const claimed = await record(r, 'CLAIM', { proof: proof(r) }, requestKey), afterClaim = await snapshot(s)
  eq(claimed.lease.expected_revision, r.expected_revision, 'grant pins original setup revision'); eq(claimed.lease.expected_step_revision, r.expected_step_revision, 'grant pins original step revision')
  eq(claimed.lease.nonce, '10', 'public lease nonce stays an exact decimal string')
  eq(Object.keys(claimed.lease).sort(), ['id', 'setup_id', 'step_id', 'actor_id', 'operating_context', 'intent_hash', 'sender', 'nonce', 'request_key',
    'created_at', 'expires_at', 'expected_revision', 'expected_step_revision'].sort(), 'lease public contract excludes private proof')
  eq(Date.parse(claimed.lease.expires_at) - Date.parse(claimed.lease.created_at), 120000, 'lease exactly120seconds')
  for (const field of ['intent', 'intent_hash', 'nonce', 'sender', 'claimed_at', 'expires_at', 'state', 'transaction_hash']) eq(afterClaim.step[field], original.step[field], `grant preserves original${field}`)
  const replay = await record(r, 'CLAIM', { proof: proof(r, { checked_at: '2000-01-01T00:00:00Z' }) }, requestKey)
  eq(replay.lease, claimed.lease, 'same-key grant replay returns original lease despite stale CAS/proof'); eq(await snapshot(s), afterClaim, 'replay has no additional writes')
  await denied('changed key payload conflicts', () => record({ ...r, expected_revision: 99 }, 'CLAIM', { proof: proof(r) }, requestKey), '23505')
  const current = await read(s)
  await denied('active lease blocks new grant', () => record(current, 'CLAIM', { proof: proof(current) }))
  await denied('stale setup CAS denied', () => record(r, 'CLAIM', { proof: proof(r) }))
  await denied('stale step CAS denied', () => record({ ...current, expected_step_revision: 999 }, 'CLAIM', { proof: proof(current) }))
  await denied('changed immutable intent denied', () => record({ ...r, intent: { ...r.intent, data: '0xabcd' } }, 'CLAIM', { proof: proof(r) }))
  await denied('foreign context denied', () => record({ ...r, operating_context: { ...context, organisationId: id(88) } }, 'CLAIM', { proof: proof(r) }), '42501')
  await denied('MAIN denies before retry writes', async () => { await db.query("update bx1_portal.entry_configuration set environment='MAINNET'"); await read(s) }, '42501')
  await denied('revoked wallet seam denies', async () => { await db.query('update bx1_private.fixture_authority set wallet=false where product_id=$1', [s.product]); await read(s) }, '42501')
  await denied('expired authority seam denies', async () => { await db.query("update bx1_private.fixture_authority set expires_at=clock_timestamp()-interval '1 second' where product_id=$1", [s.product]); await read(s) }, '42501')
  for (const patch of [{ checked_at: '2000-01-01T00:00:00Z' }, { status: 'WAITING' }, { chain_id: 1 }, { intent_hash: 'b'.repeat(64) },
    { providers: [] }, { providers: proof(current).providers.map(p => ({ ...p, pending_nonce: '11' })) },
    { finalized_nonce: { block_number: '200', block_hash: hash(200), nonce: '11' } },
    { finalized_nonce: { block_number: '199', block_hash: hash(199), nonce: '10' } },
    { finalized_nonce: { block_number: '200', block_hash: hash(999), nonce: '10' } }]) {
    await denied('fresh proof negative remains denied', () => record(current, 'CLAIM', { proof: proof(current, patch) }))
  }
  await denied('missing finalized nonce fact denied', () => record(current, 'CLAIM', { proof: proof(current, { finalized_nonce: null }) }), '22023')
  await denied('original step immutable guard retained', async () => { await owner(); await db.query('update bx1_portal.fund_setup_steps set nonce=99,revision=revision+1 where id=$1', [s.step]) })
  await denied('lease immutable update denied', async () => { await owner(); await db.query("update bx1_private.fund_setup_retry_leases set expires_at=expires_at+interval '1 second' where id=$1", [claimed.lease.id]) })
  const outcomeBefore = await snapshot(s)
  await record(await read(s), 'OUTCOME', { lease_id: claimed.lease.id, outcome: 'REJECTED' })
  const outcomeAfter = await snapshot(s); eq(outcomeAfter.step, outcomeBefore.step, 'wallet rejection never resets original step'); eq(outcomeAfter.setup, outcomeBefore.setup, 'wallet rejection never renews setup')
  phase = 'audit-rollback'
  const auditSetup = await seed(2), auditRead = await read(auditSetup), auditBefore = await snapshot(auditSetup)
  await denied('revoked package/signature seam blocks a new grant', async () => {
    await db.query('update bx1_private.fixture_package set approved=false where product_id=$1', [auditSetup.product])
    await record(auditRead, 'CLAIM', { proof: proof(auditRead) })
  }, '42501')
  await denied('real audit failure rolls back lease/CAS/request/events', async () => {
    await db.query(`create function public.setup_retry_audit_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic_audit_failure' using errcode='23514';end;$$;
      create trigger setup_retry_audit_failure before insert on bx1_portal.fund_operation_events for each row execute function public.setup_retry_audit_failure()`)
    await record(auditRead, 'CLAIM', { proof: proof(auditRead) })
  })
  eq(await snapshot(auditSetup), auditBefore, 'failed downstream audit restores full original snapshot')
  phase = 'past-expiry-late-hash-and-cap'
  const late = await seed(3), expiredLease = await pastLease(late), lateRead = await read(late), expiredBefore = await snapshot(late)
  const expiredReplay = await record(expiredLease.preparation, 'CLAIM', { proof: proof(lateRead) }, expiredLease.request_key)
  eq(expiredReplay.lease.id, expiredLease.lease_id, 'expired same-key replay resolves original lease only')
  eq(Date.parse(expiredReplay.lease.expires_at) < Date.now(), true, 'replay does not renew expired lease'); eq(await snapshot(late), expiredBefore, 'expired replay has no mutation')
  await record(lateRead, 'HASH', { lease_id: expiredLease.lease_id, transaction_hash: hash(700), discovery_proof: null })
  eq((await snapshot(late)).step.state, 'BROADCAST', 'expired lease still retains late candidate')
  const broadcastBefore = await snapshot(late)
  await record(await read(late), 'HASH', { lease_id: expiredLease.lease_id, transaction_hash: hash(702), discovery_proof: null })
  const broadcastAfter = await snapshot(late)
  eq(broadcastAfter.step, broadcastBefore.step, 'late lease hash only appends when another candidate is BROADCAST')
  eq(broadcastAfter.setup, broadcastBefore.setup, 'late BROADCAST candidate does not revise setup')
  await owner(); await db.query("update bx1_portal.fund_setup_steps set state='PENDING',revision=revision+1 where id=$1", [late.step])
  const pendingBefore = await snapshot(late)
  await record(await read(late), 'HASH', { lease_id: expiredLease.lease_id, transaction_hash: hash(703), discovery_proof: null })
  const pendingAfter = await snapshot(late)
  eq(pendingAfter.step, pendingBefore.step, 'late leased hash cannot regress PENDING or replace tracked candidate')
  eq(pendingAfter.setup, pendingBefore.setup, 'late PENDING candidate preserves setup revision')
  eq(pendingAfter.attempts.length, pendingBefore.attempts.length + 1, 'late PENDING response remains immutable history')
  await owner(); await db.query("update bx1_portal.fund_setup_steps set state='FINAL',observation_id=$2,revision=revision+1 where id=$1", [late.step, id(333)])
  const winnerBefore = await snapshot(late)
  await record(await read(late), 'HASH', { lease_id: expiredLease.lease_id, transaction_hash: hash(701), discovery_proof: null })
  const winnerAfter = await snapshot(late); eq(winnerAfter.step, winnerBefore.step, 'late candidate cannot overwrite FINAL winner/observation'); eq(winnerAfter.setup, winnerBefore.setup, 'late candidate does not revise final setup')
  eq(winnerAfter.attempts.length, winnerBefore.attempts.length + 1, 'late candidate remains immutable history')
  const capped = await seed(4); for (let n = 0; n < 3; n++) await pastLease(capped, 300 + n * 150)
  const cappedRead = await read(capped); eq(cappedRead.retry_count, 3, 'all three historical grants counted')
  await denied('fourth new grant denied', () => record(cappedRead, 'CLAIM', { proof: proof(cappedRead) }))
  phase = 'authoritative-hold-only'
  const held = await seed(5), heldRead = await read(held)
  await denied('provider unavailability cannot create hold', () => record(heldRead, 'HOLD', { proof: proof(heldRead, { status: 'WAITING', reason_code: 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION' }) }))
  const holdProof = proof(heldRead, { status: 'HOLD', reason_code: 'SETUP_RETRY_EXTERNAL_NONCE_CONSUMPTION', retry_checks: null,
    finalized_nonce: { block_number: '200', block_hash: hash(200), nonce: '11' },
    providers: proof(heldRead).providers.map(p => ({ ...p, latest_nonce: '11', pending_nonce: '11' })) })
  await denied('latest/pending consumption alone cannot create irreversible hold', () => record(heldRead, 'HOLD', {
    proof: { ...holdProof, finalized_nonce: { ...holdProof.finalized_nonce, nonce: '10' } } }))
  await record(heldRead, 'HOLD', { proof: holdProof }); eq((await snapshot(held)).setup.recovery_hold, true, 'authoritative server hold is irreversible')
  await denied('existing hold closes protected retry read', () => read(held), '42501')
  phase = 'two-real-connection-CAS'
  const race = await seed(6), raceRead = await read(race), raceProof = proof(raceRead)
  for (let n = 0; n < 2; n++) { const client = new pg.Client(options); await client.connect(); peers.push(client) }
  const pids = await Promise.all(peers.map(client => scalar('select pg_backend_pid()', [], client)))
  await owner(); await db.query('begin'); await db.query('select id from bx1_portal.products where id=$1 for update', [race.product])
  const races = peers.map(client => transaction(client, c => record(raceRead, 'CLAIM', { proof: raceProof }, key(), c)))
  await blocked(pids); await db.query('commit')
  const results = await Promise.all(races)
  eq(results.filter(result => result.value).length, 1, 'exactly one competing grant commits'); eq(results.filter(result => result.code === '23514').length, 1, 'loser sees actual stale CAS')
  const raceAfter = await snapshot(race); eq(raceAfter.leases.length, 1, 'one durable retry lease'); eq(raceAfter.step.nonce, 10, 'concurrent retry never releases original nonce')
  phase = 'two-connection-same-key-replay'
  const replaySetup = await seed(7), replayRead = await read(replaySetup), replayProof = proof(replayRead), replayKey = key()
  await owner(); await db.query('begin'); await db.query('select id from bx1_portal.products where id=$1 for update', [replaySetup.product])
  const sameKeyCalls = peers.map(client => transaction(client, c => record(replayRead, 'CLAIM', { proof: replayProof }, replayKey, c)))
  await blocked(pids); await db.query('commit')
  const sameKeyResults = await Promise.all(sameKeyCalls)
  eq(sameKeyResults.filter(result => result.value).length, 2, 'concurrent exact replay both resolve'); eq(sameKeyResults[0].value.lease, sameKeyResults[1].value.lease, 'same immutable lease returned twice')
  eq((await snapshot(replaySetup)).leases.length, 1, 'same-key race has one lease')
  phase = 'package-revoked-during-real-lock-wait'
  const revoked = await seed(9), revokedRead = await read(revoked), revokedProof = proof(revokedRead)
  await owner(); await db.query('begin'); await db.query('select id from bx1_portal.products where id=$1 for update', [revoked.product])
  const waitingClaim = transaction(peers[0], c => record(revokedRead, 'CLAIM', { proof: revokedProof }, key(), c))
  await blocked([pids[0]])
  await db.query('update bx1_private.fixture_package set approved=false where product_id=$1', [revoked.product]); await db.query('commit')
  eq((await waitingClaim).code, '42501', 'new grant sees package withdrawal after product-lock wait')
  eq((await snapshot(revoked)).leases.length, 0, 'revocation creates no lease or revision mutation')
  phase = 'server-discovered-canonical-candidate'
  const discovered = await seed(8), discoveryRead = await read(discovered)
  const winner = { block_number: '150', block_hash: hash(150), transaction_hash: hash(800), from: discoveryRead.sender,
    to: discoveryRead.intent.to, value: '0', data: discoveryRead.intent.data, nonce: discoveryRead.intent.nonce, chain_id: 80002 }
  const discoveryProof = proof(discoveryRead, { status: 'WINNER', transaction_hash: hash(800), retry_checks: null, anchor: discoveryRead.anchor, winner,
    providers: proof(discoveryRead).providers.map(p => ({ ...p, latest_nonce: '11', pending_nonce: '11' })),
    finalized_nonce: { block_number: '200', block_hash: hash(200), nonce: '11' } })
  await denied('discovery requires finalized nonce consumption', () => record(discoveryRead, 'HASH', { lease_id: null, transaction_hash: hash(800),
    discovery_proof: { ...discoveryProof, finalized_nonce: { ...discoveryProof.finalized_nonce, nonce: '10' } } }))
  await denied('mismatching discovered payload cannot be adopted', () => record(discoveryRead, 'HASH', { lease_id: null, transaction_hash: hash(800), discovery_proof: { ...discoveryProof, winner: { ...winner, data: '0xabcd' } } }))
  await record(discoveryRead, 'HASH', { lease_id: null, transaction_hash: hash(800), discovery_proof: discoveryProof })
  eq((await snapshot(discovered)).step.state, 'BROADCAST', 'discovery still does not assert FINAL')
  await owner(); await db.query(catalogProof)
  console.log(`BX1_FUND_SETUP_RECOVERY_SQL_PASS assertions=${checks} fixture=disposable-cloud-PostgreSQL17 writer=actual guards=original auditRollback=actual twoConnectionCAS=proven originalNonce=retained authority=MFA-wallet-stubs-only hostedAcceptance=not-proven Amoy=not-proven`)
} catch (error) {
  console.error(`BX1_FUND_SETUP_RECOVERY_SQL_FAILED phase=${phase} code=${typeof error?.code === 'string' ? error.code : 'assertion'}`)
  process.exitCode = 1
} finally {
  if (connected) await db.query('rollback').catch(() => {})
  await Promise.all(peers.map(async client => { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}) }))
  if (connected) {
    await db.query('rollback').catch(() => {}); await owner().catch(() => {})
    if (created) {
      try { await db.query('drop schema if exists bx1_portal,bx1_private,auth cascade') }
      catch { console.error('BX1_FUND_SETUP_RECOVERY_CLEANUP_FAILED disposable-service-will-be-destroyed'); process.exitCode = 1 }
    }
    await db.end()
  }
}
