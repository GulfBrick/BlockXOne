import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Interface } from 'ethers'
import pg from 'pg'

// Actual new SQL writer/worker patch, original locks/mutation/audit/request guard.
// Auth/MFA, policy/package/conformance and chain observations below are explicit
// SYNTHETIC EXTERNAL SEAMS, never genuine hosted identity or Amoy evidence.
const url = 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci'
if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.BX1_FUND_AUTHORITY_ALIGNMENT_SQL_TEST_URL !== url) throw new Error('Authority alignment requires the exact disposable cloud PG17 fixture')
const config = { connectionString: url, ssl: false, statement_timeout: 15000, query_timeout: 20000, connectionTimeoutMillis: 5000 }
const db = new pg.Client(config), peers = []
let connected = false, created = false, phase = 'initialise', count = 0, sequence = 800000
const id = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`, key = () => id(++sequence)
const actor = id(1), org = id(2), session = id(3), policy = id(4), digest = 'a'.repeat(64)
const address = n => `0x${BigInt(n).toString(16).padStart(40, '0')}`, hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`
const context = { mode: 'ROLE', organisationId: org, role: 'TokenisationAgent' }
const safeAbi = new Interface(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)'])
const controllerAbi = new Interface(['function advanceAuthorityEpoch(uint256 nextEpoch,bytes32 reasonHash)'])
const zero = address(0), eq = (a, b, label) => { assert.deepEqual(a, b, label); count++ }
const file = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
function definition(source, name) {
  const start = source.indexOf(`create function ${name}(`), open = source.indexOf('$$', start), end = source.indexOf('$$;', open + 2)
  assert(start >= 0 && open > start && end > open, `real source definition ${name}`)
  return source.slice(start, end + 3)
}
function table(source, name) {
  const start = source.indexOf(`create table ${name} (`), end = source.indexOf('\n);', start)
  assert(start >= 0 && end > start, `real source table ${name}`); return source.slice(start, end + 3)
}
async function scalar(sql, values = [], client = db) { return Object.values((await client.query(sql, values)).rows[0])[0] }
async function owner(client = db) { await client.query('reset role') }
async function worker(client = db) { await client.query('set role bx1_fund_execution_worker') }
function claims(patch = {}) { return { sub: actor, session_id: session, aal: 'aal2', exp: Math.floor(Date.now() / 1000) + 3600,
  role: 'authenticated', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }], iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', ...patch } }
async function authorise(s, purpose, patch = {}, client = db) {
  await owner(client); await client.query('select set_config(\'request.jwt.claims\',$1,false)', [JSON.stringify(claims(patch))])
  await client.query('set role authenticated')
  return scalar('select public.bx1_portal_fund_alignment_authorise($1::uuid,$2::integer,$3::jsonb,$4::text)', [s.setup, 1, JSON.stringify(context), purpose], client)
}
async function read(s, client = db) {
  const authorised = await authorise(s, 'ALIGNMENT_READ', {}, client); await worker(client)
  return scalar('select bx1_portal.read_fund_authority_alignment($1::uuid,$2::uuid,$3::jsonb,$4::uuid)',
    [s.request, actor, JSON.stringify(context), authorised.authorisation_receipt_id], client)
}
async function grant(s, client = db) { return authorise(s, 'ALIGNMENT_WRITE', {}, client) }
async function record(preparation, action, evidence, receipt, requestKey = key(), client = db) {
  await worker(client)
  return scalar('select bx1_portal.record_fund_authority_alignment($1::jsonb,$2::text,$3::uuid,$4::jsonb,$5::uuid)',
    [JSON.stringify(preparation), action, requestKey, JSON.stringify(evidence), receipt,], client)
}
async function act(s, preparation, action, evidence, requestKey = key()) {
  const a = await grant(s); return record(preparation, action, evidence, a.authorisation_receipt_id, requestKey)
}
async function denied(label, action, code = '23514') {
  await owner(); await db.query('begin'); let actual
  try { await action() } catch (error) { actual = error.code }
  await db.query('rollback'); await owner(); eq(actual, code, label)
}
async function transaction(client, action) {
  await owner(client); await client.query('begin')
  try { const value = await action(); await client.query('commit'); return { value } }
  catch (error) { await client.query('rollback'); return { code: error.code } }
}
async function unchanged(s) {
  await owner()
  return scalar(`select jsonb_build_object('setup',(select to_jsonb(x) from bx1_portal.fund_setups x where id=$1::uuid),
    'steps',(select jsonb_agg(to_jsonb(x) order by ordinal) from bx1_portal.fund_setup_steps x where setup_id=$1::uuid),
    'request',(select to_jsonb(x) from bx1_portal.fund_admission_requests x where id=$2::uuid))`, [s.setup, s.request])
}
async function operationSnapshot(s) {
  await owner()
  return scalar(`select jsonb_build_object('operation',(select to_jsonb(x) from bx1_private.fund_alignment_operations x where request_id=$1::uuid),
    'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by request_key,action),'[]') from bx1_private.fund_alignment_requests x
      where operation_id=(select id from bx1_private.fund_alignment_operations where request_id=$1::uuid)),
    'consumed',(select coalesce(jsonb_agg(to_jsonb(x) order by receipt_id),'[]') from bx1_private.fund_alignment_consumptions x
      where receipt_id in(select id from bx1_private.fund_alignment_authorisations where request_id=$1::uuid)),
    'events',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from bx1_portal.fund_setup_events x where setup_id=$2::uuid))`, [s.request, s.setup])
}
function snapshot() { return { block: { number: '300', hash: hash(300), timestamp: '2026-10-19T00:00:00Z' },
  providers: ['https://80002.rpc.thirdweb.com', 'https://polygon-amoy.gateway.tenderly.co'].map(url => ({ url, finalized_block_number: '300', finalized_block_hash: hash(300) })) } }
function intent(r) {
  const saved = r.input.setup.setup, controller = saved.dependencies.controller
  return { version: 1, chain_id: 80002, admission_request_id: r.admission_request_id, native_binding_hash: r.native_binding_hash, reason_hash: r.reason_hash,
    previous_epoch: r.input.authority_epoch - 1, target_epoch: r.input.authority_epoch, controller_address: controller, controller_runtime_hash: hash(999),
    factory_address: saved.dependencies.trex_factory, safe_address: saved.safe_address, safe_owners: saved.safe_owners, safe_threshold: saved.safe_threshold,
    executor_address: r.input.signer_address, executor_nonce: '77', safe_transaction: { to: controller, value: '0',
      data: controllerAbi.encodeFunctionData('advanceAuthorityEpoch', [r.input.authority_epoch, r.reason_hash]).toLowerCase(), operation: 0,
      safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: zero, refundReceiver: zero, nonce: '0' },
    safe_transaction_hash: hash(777), snapshot: snapshot(), valid_until: r.input.setup.roleplay_policy.expires_at }
}
function execution(r) {
  const i = r.operation.intent, signatures = [...r.operation.signatures].sort((a, b) => a.signer.localeCompare(b.signer)).map(s => s.signature.slice(2)).join('')
  return { chain_id: 80002, from: i.executor_address, to: i.safe_address, value: '0', nonce: i.executor_nonce,
    data: safeAbi.encodeFunctionData('execTransaction', [i.controller_address, '0', i.safe_transaction.data, 0, 0, 0, 0, zero, zero, `0x${signatures}`]).toLowerCase() }
}
function observation(r, patch = {}) {
  const i = r.operation.intent
  return { schema_version: 1, chain_id: 80002, status: 'FINAL', admission_request_id: r.admission_request_id, native_binding_hash: r.native_binding_hash,
    safe_transaction_hash: i.safe_transaction_hash, reason_hash: i.reason_hash, transaction_hash: hash(800), executor_address: i.executor_address,
    executor_nonce: i.executor_nonce, safe_address: i.safe_address, safe_nonce: i.safe_transaction.nonce, controller_address: i.controller_address,
    previous_epoch: i.previous_epoch, target_epoch: i.target_epoch, block_number: '200', block_hash: hash(200), confirmations: '101', required_confirmations: 64,
    snapshot: snapshot(), receipt_hashes: ['b'.repeat(64), 'b'.repeat(64)], reason_code: null, inner_execution_success: true, epoch_verified: true,
    observed_epoch: i.target_epoch, epoch_event: { previous_epoch: i.previous_epoch, target_epoch: i.target_epoch, reason_hash: i.reason_hash }, ...patch }
}
async function seed(n, epoch = 2, admitted = false) {
  await owner(); await db.query('select set_config(\'request.jwt.claims\',$1,false)', [JSON.stringify(claims())])
  const s = { setup: id(10000 + n), product: id(20000 + n), offering: id(30000 + n), request: id(40000 + n) }
  const owners = [address(100000 + n), address(200000 + n)], safe = address(300000 + n)
  await db.query('insert into bx1_private.fixture_authority(product_id,actor_id,context,owners,epoch,expires_at) values($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5,clock_timestamp()+interval \'1 hour\')',
    [s.product, actor, JSON.stringify(context), JSON.stringify(owners), epoch])
  await db.query('insert into bx1_portal.products values($1::uuid,$2::uuid,1,$3::uuid,$4,$5::jsonb)',
    [s.product, org, s.offering, digest, JSON.stringify({ terms_version: 3, asset_type: 'FUND', currency: 'TST', settlement_decimals: 6 })])
  await db.query('insert into bx1_portal.offering_revisions values($1::uuid,$2::uuid,$3,$3,$4::jsonb)',
    [s.offering, s.product, digest, JSON.stringify({ terms_version: 3, asset_type: 'FUND', currency: 'TST', settlement_decimals: 6 })])
  await db.query(`insert into bx1_portal.fund_setups(id,product_id,offering_revision_id,product_revision,terms_hash,configuration_hash,actor_id,operating_context,actor_claims,
    roleplay_policy,expires_at,safe_address,safe_state,safe_owners,safe_threshold,safe_observation_id,configuration,setup_configuration_hash,catalog_hash)
    values($1::uuid,$2::uuid,$3::uuid,1,$4,$4,$5::uuid,$6::jsonb,$7::jsonb,bx1_portal.fund_setup_roleplay($6::jsonb,$2::uuid),
    clock_timestamp()+interval '1 hour',$8,'VERIFIED',$9::jsonb,2,$10::uuid,$11::jsonb,$4,$4)`,
    [s.setup, s.product, s.offering, digest, actor, JSON.stringify(context), JSON.stringify(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })), safe,
      JSON.stringify(owners), id(50000 + n), JSON.stringify({ safe_address: safe })])
  const graph = (await db.query('select * from bx1_portal.fund_setup_graph() order by ordinal')).rows
  for (const g of [{ step_key: 'safe_creation', ordinal: 0, kind: 'CREATE' }, ...graph]) {
    const stepId = id(100000 + n * 100 + g.ordinal), observed = id(200000 + n * 100 + g.ordinal), deployed = g.ordinal === 0 ? safe : address(500000 + n * 100 + g.ordinal)
    const i = { chain_id: 80002, step_key: g.step_key, sender: owners[0], nonce: String(g.ordinal), data: '0x1234', expected_runtime_hash: hash(999) }
    await db.query(`insert into bx1_portal.fund_setup_steps(id,setup_id,step_key,ordinal,kind,state,actor_id,sender,nonce,intent,intent_hash,data_hash,expires_at,claimed_at,transaction_hash,deployed_address,observation_id)
      values($1::uuid,$2::uuid,$3,$4,$5,'FINAL',$6::uuid,$7,$8,$9::jsonb,bx1_portal.fund_digest($9::jsonb),$10,clock_timestamp()-interval '1 hour',clock_timestamp()-interval '2 hours',$11,$12,$13::uuid)`,
      [stepId, s.setup, g.step_key, g.ordinal, g.kind, actor, owners[0], String(g.ordinal), JSON.stringify(i), digest, hash(1000 + g.ordinal), g.kind === 'CREATE' ? deployed : null, observed])
  }
  const input = { setup: await scalar('select bx1_portal.fund_setup_projection($1::uuid,$2::jsonb)', [s.product, JSON.stringify(context)]),
    authority_epoch: epoch, signer_address: owners[0], required_confirmations: 64 }
  // Input is a declared minimal admission seam, not a parallel production DTO.
  await db.query(`insert into bx1_portal.fund_admission_requests(id,request_key,setup_id,setup_revision,product_id,offering_revision_id,actor_id,operating_context,actor_claims,
    roleplay_policy_id,roleplay_epoch,conformance_receipt_id,input,input_hash,status,result_hash,admitted_at)
    values($1::uuid,$2::uuid,$3::uuid,1,$4::uuid,$5::uuid,$6::uuid,$7::jsonb,$8::jsonb,$9::uuid,$10,$11::uuid,$12::jsonb,bx1_portal.fund_digest($12::jsonb),
      $13,case when $14::boolean then bx1_portal.fund_digest('{}'::jsonb) else null end,case when $14::boolean then clock_timestamp() else null end)`,
    [s.request, key(), s.setup, s.product, s.offering, actor, JSON.stringify(context), JSON.stringify(claims({ exp: Math.floor(Date.now() / 1000) - 3600 })), policy, epoch,
      id(9), JSON.stringify(input), admitted ? 'ADMITTED' : 'RESERVED_NOT_ADMITTED', admitted])
  return s
}
try {
  await db.connect(); connected = true
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres' and current_setting('server_version_num')::integer between 170000 and 179999"), true, 'exact disposable PG17')
  eq(await scalar("select count(*)::int from pg_namespace where nspname in ('auth','bx1_portal','bx1_private')"), 0, 'prior isolated fixture cleaned schemas')
  const [identity, portal, lifecycle, setup, admission, feature, catalog] = await Promise.all([
    file('../../../supabase/tests/bx1_identity_workspace.sql'), file('../../../supabase/features/bx1_portal.sql'), file('../../../supabase/features/bx1_fund_lifecycle.sql'),
    file('../../../supabase/features/bx1_fund_setup.sql'), file('../../../supabase/features/bx1_fund_release_admission.sql'),
    file('../../../supabase/features/bx1_fund_authority_alignment.sql'), file('../../../supabase/tests/bx1_fund_authority_alignment.sql')])
  eq(controllerAbi.getFunction('advanceAuthorityEpoch').selector, feature.match(/tx->>'data' is distinct from '(0x[0-9a-f]{8})'/)?.[1],
    'independent ABI-derived selector matches the actual native one-step validator')
  phase = 'synthetic-external-seams'
  await db.query(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;
    if not exists(select 1 from pg_roles where rolname='bx1_fund_execution_worker') then create role bx1_fund_execution_worker nologin;end if;end $$;`)
  await db.query(identity.replace(/^create role [^;]+;\n/gm, '')); created = true
  await db.query(`create schema bx1_portal;create schema bx1_private;
    create table bx1_portal.entry_configuration(singleton boolean primary key,environment text);insert into bx1_portal.entry_configuration values(true,'TESTNET');
    create table bx1_portal.organisations(id uuid primary key);create table bx1_portal.applications(id uuid primary key);
    create table bx1_portal.products(id uuid primary key,organisation_id uuid,revision integer,current_offering_revision_id uuid,terms_hash text,terms jsonb);
    create table bx1_portal.offering_revisions(id uuid primary key,product_id uuid,terms_hash text,deployment_configuration_hash text,terms jsonb,unique(id,product_id));
    create table bx1_portal.fund_operations(id uuid primary key);create table bx1_private.roleplay_policies(id uuid primary key);
    create table bx1_portal.fund_contract_release_receipts(id uuid primary key);
    create table bx1_private.fixture_authority(product_id uuid primary key,actor_id uuid,context jsonb,owners jsonb,epoch integer,expires_at timestamptz,enabled boolean default true,package_current boolean default true);
    insert into auth.users(id) values('${actor}');insert into auth.sessions values('${session}','${actor}',clock_timestamp()+interval '2 hours',null);
    insert into bx1_portal.organisations values('${org}');insert into bx1_private.roleplay_policies values('${policy}');insert into bx1_portal.fund_contract_release_receipts values('${id(9)}');
    grant usage on schema bx1_portal to authenticated,bx1_fund_execution_worker;`)
  for (const [source, name] of [[portal, 'bx1_portal.require_keys'], [portal, 'bx1_portal.immutable_record'], [lifecycle, 'bx1_portal.fund_digest']]) await db.query(definition(source, name))
  await db.query(table(portal, 'bx1_portal.events')); await db.query(table(lifecycle, 'bx1_portal.fund_operation_events'))
  await db.query(setup.slice(setup.indexOf('create table bx1_portal.fund_setups ('), setup.indexOf('create function bx1_portal.fund_setup_graph(')))
  await db.query(table(admission, 'bx1_portal.fund_admission_requests'))
  await db.query(definition(admission, 'bx1_portal.fund_admission_request_guard'))
  await db.query('create trigger fund_admission_request_immutable before update or delete on bx1_portal.fund_admission_requests for each row execute function bx1_portal.fund_admission_request_guard()')
  await db.query(`create function bx1_portal.fund_setup_roleplay(c jsonb,pid uuid) returns jsonb language sql volatile as $$select jsonb_build_object('policy_id','${policy}','epoch',a.epoch,'expires_at',a.expires_at,'label','SYNTHETIC AUTHORITY ONLY') from bx1_private.fixture_authority a where a.product_id=pid and a.context=c and a.enabled;$$;
    create function bx1_portal.fund_setup_context(c jsonb,pid uuid,protected boolean default false) returns boolean language sql volatile as $$
      select exists(select 1 from bx1_private.fixture_authority a join auth.sessions s on s.id::text=auth.jwt()->>'session_id' and s.user_id=a.actor_id
        where a.product_id=pid and a.actor_id=auth.uid() and a.context=c and a.enabled and a.expires_at>clock_timestamp() and s.not_after>clock_timestamp()
          and auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1' and (auth.jwt()->>'exp')::numeric>extract(epoch from clock_timestamp())
          and (not protected or auth.jwt()->>'aal'='aal2')) and exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET');$$;
    create function bx1_portal.fund_setup_wallet_current(actor uuid,sender text) returns boolean language sql volatile as $$select exists(select 1 from bx1_private.fixture_authority a where a.actor_id=$1 and a.enabled and a.owners ? $2);$$;
    create function bx1_private.test_roleplay_lock(c jsonb,pid uuid,lane text,action text) returns void language plpgsql as $$begin perform product_id from bx1_private.fixture_authority where product_id=pid for share;end;$$;
    create function bx1_portal.admission_lock_actor(application uuid,c jsonb) returns void language plpgsql as $$begin raise exception 'unused ordinary seam';end;$$;
    create function bx1_portal.offering_workflow_lock_product(c jsonb,pid uuid) returns void language plpgsql as $$begin raise exception 'unused ordinary seam';end;$$;
    create function bx1_portal.fund_setup_package_approved(pid uuid) returns boolean language sql volatile as $$select exists(select 1 from bx1_private.fixture_authority where product_id=pid and package_current);$$;
    create function bx1_portal.fund_admission_seed(sid uuid,expected integer,c jsonb) returns jsonb language plpgsql as $$declare s bx1_portal.fund_setups;begin
      select * into s from bx1_portal.fund_setups where id=sid;if s.revision is distinct from expected or bx1_portal.fund_setup_current(sid,c) is not true
        or bx1_portal.fund_setup_context(c,s.product_id,true) is not true or bx1_portal.fund_setup_package_approved(s.product_id) is not true
        or (select count(*) from bx1_portal.fund_setup_steps where setup_id=sid and ordinal>0 and state='FINAL' and observation_id is not null)<>25 then
        raise exception 'synthetic_external_admission_authority_denied' using errcode='42501';end if;return '{}'::jsonb;end;$$;`)
  for (const name of ['fund_setup_graph', 'fund_setup_lock', 'fund_setup_current', 'fund_setup_audit', 'fund_setup_projection']) await db.query(definition(setup, `bx1_portal.${name}`))
  await db.query(definition(lifecycle, 'bx1_portal.fund_audit'))
  for (const name of ['fund_admission_worker_enter', 'read_fund_admission', 'record_fund_admission']) await db.query(definition(admission, `bx1_portal.${name}`))
  await db.query('revoke all on all functions in schema bx1_private,bx1_portal from public,anon,authenticated,service_role,bx1_fund_execution_worker')
  await db.query('grant execute on function bx1_portal.read_fund_admission(uuid),bx1_portal.record_fund_admission(uuid,jsonb,text) to bx1_fund_execution_worker')
  await db.query('alter default privileges in schema bx1_private grant select on tables to authenticated')
  const original = await scalar("select jsonb_object_agg(oid::text,to_jsonb(p)) from pg_proc p where pronamespace in ('bx1_private'::regnamespace,'bx1_portal'::regnamespace)")
  phase = 'installer-idempotency'
  await db.query('begin'); await db.query(feature); await db.query(feature); await db.query(catalog); await db.query('commit')
  const oldWorker = await scalar("select oid from pg_proc where oid='bx1_portal.fund_admission_worker_enter(uuid)'::regprocedure")
  eq(await scalar('select jsonb_object_agg(oid::text,to_jsonb(p)) from pg_proc p where oid::text=any($1::text[]) and oid<>$2::oid', [Object.keys(original), oldWorker]),
    Object.fromEntries(Object.entries(original).filter(([oid]) => oid !== String(oldWorker))), 'all other existing function rows preserved')
  await denied('unexpected original worker source refuses installation', async () => {
    await db.query("create or replace function bx1_portal.fund_admission_worker_enter(request uuid) returns text language plpgsql volatile security definer set search_path='' as $$begin return 'changed';end $$")
    await db.query(feature)
  }, '55000')
  const s = await seed(1), baseline = await unchanged(s)
  eq(Number(baseline.request.actor_claims.exp) < Date.now() / 1000, true, 'original JWT expired deliberately, never extended')
  phase = 'genuine-auth-seam-and-one-use-receipts'
  for (const patch of [{ aal: 'aal1' }, { iss: 'https://wrong.invalid/auth/v1' }, { iss: null }, { sub: id(999) }, { exp: 1 }]) {
    await denied('current genuine-auth seam rejects invalid identity/issuer/expiry', () => authorise(s, 'ALIGNMENT_READ', patch), '42501')
  }
  const auth = await authorise(s, 'ADMISSION_READ'); eq(auth.operation, null, 'public receipt never exposes operation or signatures')
  eq(JSON.stringify(auth).includes('actor_claims'), false, 'no JWT leaves native authority boundary')
  await worker(); const admittedRead = await scalar('select bx1_portal.read_fund_admission_authorised($1::uuid,$2::uuid)', [s.request, auth.authorisation_receipt_id])
  eq(admittedRead.input, baseline.request.input, 'fresh receipt resumes original request with expired captured JWT')
  await denied('receipt cannot be reused', async () => { await worker(); await db.query('select bx1_portal.read_fund_admission_authorised($1::uuid,$2::uuid)', [s.request, auth.authorisation_receipt_id]) }, '42501')
  await denied('direct old worker helper has no phase receipt', async () => { await worker(); await db.query('select bx1_portal.read_fund_admission($1::uuid)', [s.request]) }, '42501')
  const wrongPurpose = await authorise(s, 'ALIGNMENT_READ')
  await denied('wrong phase receipt denied', async () => { await worker(); await db.query('select bx1_portal.read_fund_admission_authorised($1::uuid,$2::uuid)', [s.request, wrongPurpose.authorisation_receipt_id]) }, '42501')
  const revoked = await authorise(s, 'ALIGNMENT_READ')
  await denied('revoked current authority denies saved receipt', async () => { await db.query('update bx1_private.fixture_authority set enabled=false where product_id=$1::uuid', [s.product]); await worker();
    await db.query('select bx1_portal.read_fund_authority_alignment($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [s.request, actor, JSON.stringify(context), revoked.authorisation_receipt_id]) }, '42501')
  await denied('MAIN refuses phase authorisation', async () => { await db.query("update bx1_portal.entry_configuration set environment='MAINNET'"); await authorise(s, 'ALIGNMENT_READ') }, '42501')
  await denied('wrong capacity/context refuses authorisation', async () => {
    await owner(); await db.query('select set_config(\'request.jwt.claims\',$1,false)', [JSON.stringify(claims())]); await db.query('set role authenticated')
    await db.query('select public.bx1_portal_fund_alignment_authorise($1::uuid,1,$2::jsonb,\'ALIGNMENT_READ\')', [s.setup, JSON.stringify({ ...context, role: 'Investor' })])
  }, '42501')
  const stale = await authorise(s, 'ALIGNMENT_READ', { exp: Math.floor(Date.now() / 1000) + 2 })
  await new Promise(resolve => setTimeout(resolve, 2200))
  await denied('short receipt expiry denies old handoff', async () => { await worker(); await db.query('select bx1_portal.read_fund_authority_alignment($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [s.request, actor, JSON.stringify(context), stale.authorisation_receipt_id]) }, '42501')
  const epoch1 = await seed(2, 1), a1 = await authorise(epoch1, 'ADMISSION_READ'); await worker()
  eq((await scalar('select bx1_portal.read_fund_admission_authorised($1::uuid,$2::uuid)', [epoch1.request, a1.authorisation_receipt_id])).request_id, epoch1.request, 'initial epoch1 admission still reauthorises')
  await owner(); eq(await scalar('select count(*)::int from bx1_private.fund_alignment_operations where request_id=$1::uuid', [epoch1.request]), 0, 'admission does not create an alignment operation')
  await denied('epoch1 alignment transition denied', () => authorise(epoch1, 'ALIGNMENT_READ'), '42501')
  const replaySetup = await seed(3, 2, true), replayOriginal = await unchanged(replaySetup), replayAuth = await authorise(replaySetup, 'ADMISSION_WRITE')
  await worker(); const replayResult = await scalar('select bx1_portal.record_fund_admission_authorised($1::uuid,$2::jsonb,$3::text,$4::uuid)',
    [replaySetup.request, '{}', digest, replayAuth.authorisation_receipt_id])
  eq(replayResult.status, 'ADMITTED', 'existing admitted result replay remains guarded and unchanged')
  eq(await unchanged(replaySetup), replayOriginal, 'already-admitted replay does not rewrite original request')
  phase = 'one-intent-signatures-and-canonical-execution'
  let r = await read(s), i = intent(r), prepKey = key()
  r = await act(s, r, 'PREPARE', { already_aligned: false, intent: i }, prepKey)
  eq(r.operation.state, 'PREPARED', 'only exact one-step intent prepared')
  const immutableIntent = r.operation.intent, immutableHash = r.operation.intent_hash
  const invalidIntent = { ...i, target_epoch: 3 }
  await denied('changed intent cannot overwrite original', () => act(s, r, 'PREPARE', { already_aligned: false, intent: invalidIntent }))
  const signatures = r.operation.intent.safe_owners.map((signer, n) => ({ signer, signature: `0x${String(n + 1).padStart(64, '0')}${'1'.padStart(64, '0')}1b` }))
  await denied('foreign owner signature denied', () => act(s, r, 'SIGNATURE', { ...signatures[0], signer: address(999) }))
  await denied('high-s signature denied', () => act(s, r, 'SIGNATURE', { ...signatures[0], signature: `0x${'1'.padStart(64, '0')}${'f'.repeat(64)}1b` }))
  r = await act(s, r, 'SIGNATURE', signatures[0])
  await denied('duplicate signer is not a second owner', () => act(s, r, 'SIGNATURE', signatures[0]))
  r = await act(s, r, 'SIGNATURE', signatures[1])
  eq(r.operation.intent, immutableIntent, 'signatures never renew original intent'); eq(r.operation.intent_hash, immutableHash, 'native intent digest retained')
  const tx = execution(r)
  await denied('wrong execution calldata denied', () => act(s, r, 'CLAIM', { intent: i, execution: { ...tx, data: '0x1234' } }))
  phase = 'audit-rollback'
  const grantBeforeAudit = await grant(s), beforeAudit = await operationSnapshot(s)
  await denied('mandatory audit failure rolls back actual CLAIM and phase consumption', async () => {
    await db.query(`create function public.alignment_audit_failure() returns trigger language plpgsql as $$begin if new.kind='AUTHORITY_ALIGNMENT_CLAIM' then raise exception 'synthetic audit failure' using errcode='23514';end if;return new;end $$;
      create trigger alignment_audit_failure before insert on bx1_portal.fund_operation_events for each row execute function public.alignment_audit_failure()`)
    await record(r, 'CLAIM', { intent: i, execution: tx }, grantBeforeAudit.authorisation_receipt_id)
  })
  eq(await operationSnapshot(s), beforeAudit, 'actual operation/request/audit rows restored atomically')
  phase = 'two-connection-single-flight-claim'
  const grants = [await grant(s), await grant(s)]
  for (let n = 0; n < 2; n++) { const client = new pg.Client(config); await client.connect(); peers.push(client) }
  const pids = await Promise.all(peers.map(client => scalar('select pg_backend_pid()', [], client)))
  await owner(); await db.query('begin'); await db.query('select id from bx1_portal.products where id=$1::uuid for update', [s.product])
  const calls = peers.map((client, n) => transaction(client, () => record(r, 'CLAIM', { intent: i, execution: tx }, grants[n].authorisation_receipt_id, key(), client)))
  const until = Date.now() + 5000; let blocked = false
  while (Date.now() < until) { await db.query('select pg_stat_clear_snapshot()'); if (await scalar('select count(*)::int from pg_stat_activity where pid=any($1::int[]) and cardinality(pg_blocking_pids(pid))>0', [pids]) === 2) { blocked = true; break } await new Promise(resolve => setTimeout(resolve, 20)) }
  assert(blocked, 'two real connections wait on original product lock'); count++; await db.query('commit')
  const results = await Promise.all(calls); eq(results.filter(x => x.value).length, 1, 'exactly one actionable claim response'); eq(results.filter(x => x.code === '42501').length, 1, 'second receipt subject is stale')
  r = results.find(x => x.value).value
  await denied('CLAIM replay can never return another actionable response', () => act(s, r, 'CLAIM', { intent: i, execution: tx }, r.operation.claim_key), '42501')
  phase = 'late-hash-and-exact-finality'
  const verifyKey = key(); r = await act(s, r, 'HASH', { transaction_hash: hash(800) }, verifyKey)
  eq(r.operation.state, 'BROADCAST', 'hash alone is not finality')
  const good = observation(r)
  for (const patch of [{ inner_execution_success: false }, { epoch_verified: false }, { observed_epoch: 1 }, { epoch_event: null },
    { epoch_event: { ...good.epoch_event, reason_hash: hash(999) } }, { block_number: null }, { confirmations: '1' }, { receipt_hashes: [null, null] },
    { receipt_hashes: ['b'.repeat(64), 'c'.repeat(64)] }, { transaction_hash: null }, { snapshot: { ...good.snapshot, providers: [] } }]) {
    await denied('malformed or non-final observation cannot create FINAL', () => act(s, r, 'OBSERVE', { ...good, ...patch }))
  }
  r = await act(s, r, 'OBSERVE', good, verifyKey); eq(r.operation.state, 'FINAL', 'actual writer requires full sealed finalized facts')
  const final = structuredClone(r.operation), late = await act(s, r, 'HASH', { transaction_hash: hash(801) })
  eq(late.operation, final, 'late hash is history only, FINAL never overwritten')
  eq(await unchanged(s), baseline, 'all original 25 steps, Safe0, setup and immutable admission request unchanged')
  phase = 'current-session-revoked-after-real-lock-wait'
  const waitingSetup = await seed(4), waitingReceipt = await authorise(waitingSetup, 'ALIGNMENT_READ')
  await owner(); await db.query('begin'); await db.query('select id from bx1_portal.products where id=$1::uuid for update', [waitingSetup.product])
  const waitingCall = transaction(peers[0], async () => { await worker(peers[0]); return scalar('select bx1_portal.read_fund_authority_alignment($1::uuid,$2::uuid,$3::jsonb,$4::uuid)',
    [waitingSetup.request, actor, JSON.stringify(context), waitingReceipt.authorisation_receipt_id], peers[0]) })
  const waitUntil = Date.now() + 5000; let waiting = false
  while (Date.now() < waitUntil) { await db.query('select pg_stat_clear_snapshot()'); if (await scalar('select cardinality(pg_blocking_pids($1::int))>0', [pids[0]])) { waiting = true; break } await new Promise(resolve => setTimeout(resolve, 20)) }
  assert(waiting, 'real protected read waits before session withdrawal'); count++
  await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1::uuid", [session]); await db.query('commit')
  eq((await waitingCall).code, '42501', 'protected authority rechecks the revoked session after product-lock wait')
  await owner(); await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=$1::uuid", [session])
  await owner(); await db.query(catalog)
  console.log(`BX1_FUND_AUTHORITY_ALIGNMENT_SQL_PASS assertions=${count} originalJWT=expired writer=actual twoConnection=actual auditRollback=actual authority=synthetic-external-seams chain=synthetic-observations hostedAcceptance=not-proven Amoy=not-proven`)
} catch (error) {
  const code = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'assertion'
  const label = code === 'assertion' && typeof error?.message === 'string' ? error.message.split(/\r?\n/, 1)[0].replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 240) : null
  console.error(`BX1_FUND_AUTHORITY_ALIGNMENT_SQL_FAILED phase=${phase} code=${code}${label ? ` label=${JSON.stringify(label)}` : ''}`); process.exitCode = 1
} finally {
  if (connected) await db.query('rollback').catch(() => {})
  await Promise.all(peers.map(async client => { await client.query('rollback').catch(() => {}); await client.end().catch(() => {}) }))
  if (connected) { await owner().catch(() => {}); if (created) await db.query('drop schema if exists bx1_portal,bx1_private,auth cascade').catch(() => { process.exitCode = 1 }); await db.end() }
}
