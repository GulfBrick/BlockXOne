import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'

const mode = process.argv.slice(2)
if (mode.length && (mode.length !== 1 || mode[0] !== '--concurrency')) throw new Error('Unsupported test mode')
const fixture = await readFile(new URL('../../../supabase/tests/bx1_identity_workspace.sql', import.meta.url), 'utf8')
const identity = await readFile(new URL('../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql', import.meta.url), 'utf8')
const wallet = await readFile(new URL('../../../supabase/migrations/20260917190042_bx1_wallet_ownership.sql', import.meta.url), 'utf8')
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const uid = (n) => id(1,n), sid = (n) => id(2,n), org = (n) => id(3,n), pid = (n) => id(4,n)
const address = (n) => '0x' + String(n).padStart(40, '0')
const signature = '0x' + '11'.repeat(65) // Fixture verifier assertion, NOT real cryptographic proof.
const actorParams = (user=1, tenant=user) => [uid(user), pid(user), sid(user), org(tenant)]
let checks = 0
async function check(db, sql, expected, label, params=[]) {
  const {rows} = await db.query(sql,params)
  assert.equal(Object.values(rows[0])[0], expected, label); checks++
}
async function setup(db) {
  await db.exec(fixture)
  // Hosted Auth tables have RLS. No policy/grant is added for the wallet owner.
  await db.exec('alter table auth.users enable row level security; alter table auth.sessions enable row level security;')
  await db.exec(identity)
  // Hosted postgres is not a superuser. Reproduce its schema-owner and
  // CREATEROLE capabilities so superuser migration runs cannot mask ALTER OWNER.
  await db.exec(`
    create role bx1_fixture_migrator nologin noinherit nosuperuser createdb createrole bypassrls;
    grant usage, create on schema public to bx1_fixture_migrator with grant option;
    grant usage on schema auth to bx1_fixture_migrator;
    grant select on auth.users, auth.sessions to bx1_fixture_migrator;
    alter schema bx1_private owner to bx1_fixture_migrator;
    alter table public.bx1_profiles owner to bx1_fixture_migrator;
    alter table public.bx1_organisations owner to bx1_fixture_migrator;
    alter table public.bx1_memberships owner to bx1_fixture_migrator;
    alter function bx1_private.has_active_session() owner to bx1_fixture_migrator;
    alter function bx1_private.can_access_organisation(uuid) owner to bx1_fixture_migrator;
    alter default privileges for role bx1_fixture_migrator in schema public grant all on tables to anon, authenticated, service_role;
    set local role bx1_fixture_migrator;
  `)
  await db.exec(wallet)
  await db.exec('reset role')
  for(let user=1;user<=3;user++) {
    await db.query('insert into auth.users(id) values ($1)',[uid(user)])
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)',[sid(user),uid(user)])
    await db.query('insert into public.bx1_profiles(id,platform_user_id) values ($1,$2)',[uid(user),pid(user)])
    await db.query('insert into public.bx1_organisations(id,name) values($1,$2)',[org(user),`Fixture ${user}`])
    await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'SuperAdmin')",[uid(user),org(user)])
  }
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'Investor')",[uid(1),org(2)])
}
async function issue(db,user=1,tenant=user,addr=address(user)) {
  const { rows } = await db.query('select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,$6,$7,$8) as result', [...actorParams(user,tenant),addr,80002,'https://bx1.co.za',randomBytes(32).toString('hex')])
  return rows[0].result
}
async function consume(db,challenge,user=1,tenant=user) {
  const {rows} = await db.query('select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7) as result',[...actorParams(user,tenant),challenge.challengeId,challenge.message,signature])
  return rows[0].result
}
async function denied(db,sql,params,label,code='42501') {
  await db.exec('savepoint negative_case')
  let caught
  try {await db.query(sql,params)} catch(error) {caught=error}
  await db.exec('rollback to savepoint negative_case; release savepoint negative_case')
  assert.equal(caught?.code,code,label); checks++
}
const issueSQL = 'select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,$6,$7,$8) as result'
const readSQL = 'select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5) as result'
const consumeSQL = 'select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7) as result'
const functionSignatures = [
  'bx1_private.issue_wallet_challenge(uuid,uuid,uuid,uuid,text,integer,text,text)',
  'bx1_private.read_wallet_challenge(uuid,uuid,uuid,uuid,uuid)',
  'bx1_private.consume_wallet_challenge(uuid,uuid,uuid,uuid,uuid,text,text)',
]
async function verifier(db) { await db.exec('reset role; set local role bx1_wallet_verifier') }
async function caller(db,user=1,session=sid(user),metadata={}) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(user),session_id:session,role:'authenticated',...metadata})])
  await db.exec('set local role authenticated')
}
async function ageChallenges(db) {
  await db.exec("reset role; update bx1_private.wallet_challenges set issued_at=issued_at-interval '1 hour', expires_at=expires_at-interval '1 hour';")
  await verifier(db)
}
async function matrix(db) {
  for(const role of ['bx1_wallet_owner','bx1_wallet_verifier']) {
    for(const flag of ['rolsuper','rolinherit','rolcreaterole','rolcreatedb','rolcanlogin','rolreplication','rolbypassrls'])
      await check(db,`select ${flag} from pg_roles where rolname=$1`,false,`${role} ${flag}`,[role])
    for(const schema of ['public','bx1_private','auth'])
      await check(db,'select has_schema_privilege($1,$2,\'CREATE\')',false,`${role} cannot CREATE in ${schema}`,[role,schema])
    for(const authTable of ['auth.users','auth.sessions'])
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
        await check(db,'select has_table_privilege($1,$2,$3)',false,`${role} ${authTable} ${privilege}`,[role,authTable,privilege])
  }
  await check(db,"select pg_has_role('bx1_wallet_verifier','bx1_wallet_owner','MEMBER')",false,'verifier cannot become owner')
  await check(db,"select pg_has_role('bx1_wallet_verifier','postgres','MEMBER')",false,'verifier cannot become postgres')
  await check(db,"select pg_has_role('bx1_fixture_migrator','bx1_wallet_owner','SET')",false,'temporary migration SET capability removed')
  await check(db,"select pg_has_role('bx1_fixture_migrator','bx1_wallet_owner','USAGE')",false,'migration owner membership not inherited')
  for(const table of ['public.bx1_wallets','bx1_private.wallet_challenges']) {
    await check(db,'select relrowsecurity from pg_class where oid=$1::regclass',true,`${table} RLS`,[table])
    await check(db,'select pg_get_userbyid(relowner) from pg_class where oid=$1::regclass','bx1_wallet_owner',`${table} bounded owner`,[table])
    for(const role of ['anon','authenticated','service_role','bx1_wallet_verifier'])
      for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','SELECT'])
        await check(db,'select has_table_privilege($1,$2,$3)',false,`${role} no broad ${table} ${privilege}`,[role,table,privilege])
  }
  for(const column of ['id','organisation_id','address','chain_id','verified_at','status'])
    await check(db,"select has_column_privilege('authenticated','public.bx1_wallets',$1,'SELECT')",true,`safe ${column} exposed`,[column])
  for(const column of ['user_id','platform_user_id','last_proof_id'])
    await check(db,"select has_column_privilege('authenticated','public.bx1_wallets',$1,'SELECT')",false,`private ${column} hidden`,[column])
  for(const sig of functionSignatures) {
    await check(db,"select prosecdef and proconfig @> array['search_path=\"\"'] and pg_get_userbyid(proowner)='bx1_wallet_owner' from pg_proc where oid=$1::regprocedure",true,'bounded definer fixed path',[sig])
    for(const role of ['anon','authenticated','service_role','bx1_wallet_verifier'])
      await check(db,'select has_function_privilege($1,$2,\'EXECUTE\')',role==='bx1_wallet_verifier',`${role} function grant`,[role,sig])
  }
  await check(db,"select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bx1_private' and has_function_privilege('bx1_wallet_verifier',p.oid,'EXECUTE')",3,'verifier can execute exactly three private functions')
  await check(db,"select count(*)::int from pg_policy where polrelid in ('auth.users'::regclass,'auth.sessions'::regclass)",0,'No Auth RLS policy workaround')
  await check(db,"select has_column_privilege('bx1_wallet_owner','public.bx1_profiles','id','SELECT')",true,'bounded UUID mapping read')
  await check(db,"select has_column_privilege('bx1_wallet_owner','public.bx1_profiles','status','SELECT')",false,'no broader profile read')
  // Unlike SET ROLE from a superuser session, this exercises actual escalation denial.
  await db.exec('set session authorization bx1_wallet_verifier')
  await denied(db,'set role bx1_wallet_owner',[],'cannot SET ROLE owner')
  await denied(db,'set role postgres',[],'cannot SET ROLE postgres')
  await denied(db,'select * from auth.sessions',[],'cannot read raw Auth')
  await denied(db,'select * from bx1_private.wallet_challenges',[],'cannot read raw challenges')
  await denied(db,'select * from public.bx1_wallets',[],'cannot read raw wallets')
  await denied(db,'create table bx1_private.forbidden(id int)',[],'cannot create private tables')
  // PGlite RESET uses its current authorization default; restore the known
  // disposable fixture bootstrap identity explicitly, never infer from SET ROLE.
  await db.exec('set session authorization postgres')
  await verifier(db)
  const c = await issue(db)
  assert.equal(c.chainId,80002); checks++
  assert.equal(c.domain,'https://bx1.co.za'); checks++
  assert.equal(Date.parse(c.expiresAt)-Date.parse(c.issuedAt),300000); checks++
  assert(c.message.includes('Link this wallet to BlockXOne. This is not a transaction or financial approval.')); checks++
  assert(c.message.includes(pid(1)) && c.message.includes(org(1)) && !c.message.includes(sid(1))); checks++
  const read = await db.query(readSQL,[...actorParams(),c.challengeId])
  assert.deepEqual(read.rows[0].result,c); checks++
  const linked=await consume(db,c)
  assert.equal(linked.status,'PENDING'); checks++
  await denied(db,consumeSQL,[...actorParams(),c.challengeId,c.message,signature],'replay cannot consume','BW004')
  const again=await issue(db)
  assert.equal((await consume(db,again)).id,linked.id); checks++
  const crossActor=await issue(db,2,2,address(1))
  await denied(db,consumeSQL,[...actorParams(2),crossActor.challengeId,crossActor.message,signature],'another actor cannot claim same address','BW004')
  const crossTenant=await issue(db,1,2,address(1))
  await denied(db,consumeSQL,[...actorParams(1,2),crossTenant.challengeId,crossTenant.message,signature],'same actor cannot reassign tenant','BW004')
  await caller(db)
  await check(db,'select count(id)::int from public.bx1_wallets',1,'own wallet visible')
  await denied(db,'select last_proof_id from public.bx1_wallets',[],'proof reference private')
  await denied(db,'update public.bx1_wallets set status=\'PENDING\'',[],'caller cannot write')
  await denied(db,consumeSQL,[...actorParams(),c.challengeId,c.message,signature],'caller cannot attest proof')
  await caller(db,2)
  await check(db,'select count(id)::int from public.bx1_wallets',0,'SuperAdmin cannot read other actor wallet')
  await caller(db,2,sid(2),{user_metadata:{user_id:uid(1),role:'SuperAdmin'}})
  await check(db,'select count(id)::int from public.bx1_wallets',0,'metadata does not widen access')
  await caller(db,1,sid(2))
  await check(db,'select count(id)::int from public.bx1_wallets',0,'wrong session cannot read')
  await ageChallenges(db)
  const pending=await issue(db,1,1,address(9))
  for(const [args,label,code] of [
    [[...actorParams(2),pending.challengeId], 'other actor read','BW004'],
    [[...actorParams(1,2),pending.challengeId], 'other tenant read','BW004'],
    [[uid(1),pid(1),sid(2),org(1),pending.challengeId], 'wrong session','BW001'],
    [[uid(1),pid(2),sid(1),org(1),pending.challengeId], 'immutable mapping mismatch','BW001'],
  ]) await denied(db,readSQL,args,label,code)
  await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message+'altered',signature],'altered message','BW004')
  await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message,'0x11'],'invalid signature shape','BW002')
  for(const [index,value] of [[4,address(0)],[4,'bad'],[5,1],[6,'https://evil.example'],[7,'weak'],[0,null]]) {
    const args=[...actorParams(),address(9),80002,'https://bx1.co.za',randomBytes(32).toString('hex')]; args[index]=value
    await denied(db,issueSQL,args,`invalid issue binding ${index}`,'BW002')
  }
  for(const [table,condition] of [['public.bx1_profiles',`id='${uid(1)}'`],['public.bx1_organisations',`id='${org(1)}'`],['public.bx1_memberships',`user_id='${uid(1)}' and organisation_id='${org(1)}'`]]) {
    await db.exec(`reset role; update ${table} set status='SUSPENDED' where ${condition}`)
    await verifier(db)
    await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message,signature],`${table} suspended after read`,'BW001')
    await denied(db,issueSQL,[...actorParams(),address(9),80002,'https://bx1.co.za',randomBytes(32).toString('hex')],`${table} cannot issue`,'BW001')
    await caller(db)
    await check(db,'select count(id)::int from public.bx1_wallets',0,`${table} suspension hides wallet`)
    await db.exec(`reset role; update ${table} set status='ACTIVE' where ${condition}`)
  }
  for(const [table,column,value] of [['auth.users','banned_until',"now()+interval '1 day'"],['auth.users','deleted_at','now()'],['auth.sessions','not_after',"now()-interval '1 second'"],['auth.sessions','oauth_client_id',`'${uid(9)}'::uuid`]]) {
    const target=table==='auth.users'?uid(1):sid(1)
    await db.exec(`reset role; update ${table} set ${column}=${value} where id='${target}'`)
    await verifier(db)
    await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message,signature],`${column} denies consume`,'BW001')
    await db.exec(`reset role; update ${table} set ${column}=null where id='${target}'`)
  }
  await db.exec(`delete from auth.sessions where id='${sid(1)}'`)
  await verifier(db)
  await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message,signature],'revocation after read denies consume','BW001')
  await db.exec('reset role')
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid(1),uid(1)])
  await ageChallenges(db)
  await denied(db,consumeSQL,[...actorParams(),pending.challengeId,pending.message,signature],'expired challenge cannot consume','BW003')
  await denied(db,readSQL,[...actorParams(),pending.challengeId],'expired challenge cannot read','BW003')
  // Limit is actor-wide even if requests alternate between valid organisations.
  for(let i=0;i<10;i++) await issue(db,1,i%2+1,address(20+i))
  await denied(db,issueSQL,[...actorParams(1,2),address(40),80002,'https://bx1.co.za',randomBytes(32).toString('hex')],'11th issue across tenants rate limited','BW005')
  for(const role of ['anon','service_role']) {
    await db.exec(`reset role; set local role ${role}`)
    await denied(db,'select id from public.bx1_wallets',[],`${role} no wallet read`)
    await denied(db,readSQL,[...actorParams(),c.challengeId],`${role} no proof RPC`)
  }
  await db.exec('reset role')
  await check(db,'select count(*)::int from public.bx1_wallets',1,'no denied case created a wallet')
  await check(db,'select count(*)::int from bx1_private.wallet_challenges where used_at is not null',2,'only successful proofs consumed')
}

async function concurrency() {
  const raw=process.env.BLOCKXONE_WALLET_TEST_DATABASE_URL
  let url
  try { url=new URL(raw ?? '') } catch { /* missing configuration fails below */ }
  if(process.env.BLOCKXONE_WALLET_TEST_DISPOSABLE !== '1' || !url
    || !['postgres:','postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || !/^\/bx1_wallet_(?:fixture|test_[a-z0-9_]+)$/.test(url.pathname)
    || url.search || url.hash || !url.username) {
    console.error('BX1_WALLET_CONCURRENCY_BLOCKED: explicitly acknowledged disposable loopback PostgreSQL17 fixture required')
    process.exitCode=2; return
  }
  const { Client }=await import('pg')
  // Explicit fields prevent URL options from disabling safeguards or changing hosts.
  const config={host:'127.0.0.1',port:Number(url.port||5432),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:3000,query_timeout:10000,statement_timeout:9000}
  const a=new Client(config), b=new Client(config)
  a.exec=(sql)=>a.query(sql); b.exec=(sql)=>b.query(sql)
  let aConnected=false,bConnected=false,created=false,proofCompleted=false,cleanupCompleted=false,version
  try {
    await a.connect(); aConnected=true
    await b.connect(); bConnected=true
    version=Number((await a.query('show server_version_num')).rows[0].server_version_num)
    assert(version>=170000 && version<180000,'PostgreSQL17 is required'); checks++
    const names=['anon','authenticated','service_role','bx1_fixture_migrator','bx1_wallet_owner','bx1_wallet_verifier']
    await check(a,'select count(*)::int from pg_roles where rolname=any($1)',0,'refuse existing fixture roles',[names])
    await check(a,"select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')",0,'refuse existing fixture schemas')
    await check(a,"select count(*)::int from pg_tables where schemaname='public'",0,'disposable database must be empty')
    await a.exec('begin')
    try {await setup(a); await a.exec('commit'); created=true} catch(error) {await a.exec('rollback'); throw error}
    const bpid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid
    async function blocked() {
      // The fixture controller needs pg_stat_activity visibility. RESET ROLE
      // does not release its held transaction locks; the consumer stays bounded.
      await a.exec('reset role')
      const until=Date.now()+3000
      while(Date.now()<until) {
        const {rows}=await a.query("select wait_event_type='Lock' as blocked from pg_stat_activity where pid=$1",[bpid])
        if(rows[0]?.blocked) {checks++;return}
        await pause(20)
      }
      assert.fail('second real connection never contended on the held lock')
    }
    async function issued(user,tenant,addr) {
      await a.exec('begin'); await verifier(a)
      try {const c=await issue(a,user,tenant,addr);await a.exec('commit');return c} catch(error){await a.exec('rollback');throw error}
    }
    async function attempt(db,c,user=1,tenant=user) {
      try {return {value:await consume(db,c,user,tenant)}} catch(error){return {code:error.code}}
    }
    // Two independent connections: the same one-time challenge has one consumer.
    const replay=await issued(1,1,address(101))
    await a.exec('begin'); await verifier(a)
    const first=await consume(a,replay)
    await b.exec('begin'); await verifier(b)
    const second=attempt(b,replay)
    await blocked(); await a.exec('commit')
    assert.equal((await second).code,'BW004','exactly one same-challenge winner');checks++
    await b.exec('rollback')
    await check(a,'select count(*)::int from public.bx1_wallets where id=$1',1,'single persisted wallet',[first.id])
    // Distinct valid proofs from two principals for one address serialize ownership.
    const c1=await issued(1,1,address(102)),c2=await issued(2,2,address(102))
    await a.exec('begin'); await verifier(a); await consume(a,c1)
    await b.exec('begin'); await verifier(b)
    const conflicting=attempt(b,c2,2,2)
    await blocked(); await a.exec('commit')
    assert.equal((await conflicting).code,'BW004','exactly one address owner');checks++
    await b.exec('rollback')
    await check(a,'select count(*)::int from public.bx1_wallets where address=$1',1,'one address-chain row',[address(102)])
    await check(a,'select used_at is null from bx1_private.wallet_challenges where id=$1',true,'losing proof not consumed',[c2.challengeId])
    // The challenge was read while authorized. Revoke AFTER that read and BEFORE
    // the consumer obtains its lock/final fresh guard snapshot.
    for(const revoked of ['membership','session']) {
      const c=await issued(1,1,address(revoked==='membership'?103:104))
      await a.exec('begin')
      await a.query('select id from bx1_private.wallet_challenges where id=$1 for update',[c.challengeId])
      await b.exec('begin');await verifier(b)
      const pending=attempt(b,c)
      await blocked()
      if(revoked==='membership') await a.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and organisation_id=$2",[uid(1),org(1)])
      else await a.query('delete from auth.sessions where id=$1',[sid(1)])
      await a.exec('commit')
      assert.equal((await pending).code,'BW001',`${revoked} committed before guard must deny`);checks++
      await b.exec('rollback')
      await check(a,'select used_at is null from bx1_private.wallet_challenges where id=$1',true,`${revoked} denied without consuming proof`,[c.challengeId])
      if(revoked==='membership') await a.query("update public.bx1_memberships set status='ACTIVE' where user_id=$1 and organisation_id=$2",[uid(1),org(1)])
      else await a.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid(1),uid(1)])
    }
    // Expiry crosses while B waits: transaction-start now() would be unsafe.
    const expiry=await issued(1,1,address(105))
    await a.query("update bx1_private.wallet_challenges set expires_at=t.expires, issued_at=t.expires-interval '5 minutes' from (select clock_timestamp()+interval '500 milliseconds' as expires) t where id=$1",[expiry.challengeId])
    await a.exec('begin')
    await a.query('select id from bx1_private.wallet_challenges where id=$1 for update',[expiry.challengeId])
    await b.exec('begin');await verifier(b)
    const expiring=attempt(b,expiry)
    await blocked(); await pause(600); await a.exec('commit')
    assert.equal((await expiring).code,'BW003','clock_timestamp expiry after lock wait'); checks++
    await b.exec('rollback')
    const rolledBack=await issued(1,1,address(106))
    await b.exec('begin'); await verifier(b); await consume(b,rolledBack); await b.exec('rollback')
    await check(a,'select count(*)::int from public.bx1_wallets where address=$1',0,'explicit rollback removed wallet',[address(106)])
    await check(a,'select used_at is null from bx1_private.wallet_challenges where id=$1',true,'explicit rollback restored unused proof',[rolledBack.challengeId])
    await check(b,"select nullif(current_setting('request.jwt.claims',true),'') is null",true,'pooled claims cleared after rollback')
    await check(a,"select nullif(current_setting('request.jwt.claims',true),'') is null",true,'pooled claims cleared after commit')
    assert(checks>=20,'No vacuous concurrency proof')
    proofCompleted=true
  } catch(error) {
    // Never print a connection URI, driver parameters, signature or provider stack.
    console.error(`BX1_WALLET_CONCURRENCY_FAILED code=${typeof error?.code==='string'?error.code:'assertion'} check=${error?.name==='AssertionError'?error.message:'database fixture operation'}`)
    process.exitCode=1
  } finally {
    // Release controller locks first, so a failed assertion cannot strand B.
    if(aConnected) await a.query('rollback').catch(()=>{})
    if(bConnected) await b.query('rollback').catch(()=>{})
    if(aConnected) {
      await a.query('rollback').catch(()=>{})
      if(created) {
        // These exact objects were proven absent before this invocation. Database
        // is loopback-only, name constrained, explicitly disposable and empty.
        try {
          // Remove the two deliberate default ACL fixtures before dropping any
          // grantees. Multi-role DROP OWNED can revisit overlapping ACL tuples.
          await a.query(`begin;
            alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
            alter default privileges for role bx1_fixture_migrator in schema public revoke all on tables from anon, authenticated, service_role;
            drop schema bx1_private cascade;
            drop table public.bx1_wallets, public.bx1_memberships, public.bx1_profiles, public.bx1_organisations cascade;
            drop schema auth cascade;
            drop owned by bx1_wallet_owner;
            drop owned by bx1_wallet_verifier;
            drop owned by bx1_fixture_migrator;
            drop owned by anon;
            drop owned by authenticated;
            drop owned by service_role;
            drop role bx1_wallet_owner, bx1_wallet_verifier, bx1_fixture_migrator, anon, authenticated, service_role;
            commit;`)
          await check(a,"select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')",0,'disposable schemas removed')
          await check(a,"select count(*)::int from pg_roles where rolname in ('anon','authenticated','service_role','bx1_fixture_migrator','bx1_wallet_owner','bx1_wallet_verifier')",0,'disposable roles removed')
          cleanupCompleted=true
        } catch {
          await a.query('rollback').catch(()=>{})
          console.error('BX1_WALLET_CONCURRENCY_CLEANUP_FAILED: fixture residue requires reviewed cleanup')
          process.exitCode=1
        }
      }
    }
    if(bConnected) await b.end()
    if(aConnected) await a.end()
  }
  if(proofCompleted && cleanupCompleted && !process.exitCode)
    console.log(`BX1_WALLET_CONCURRENCY_PASS assertions=${checks} postgres=${version} connections=2 cleanup=passed fixture=disposable-loopback no-GoTrue-proof`)
}

if(mode[0] === '--concurrency') {
  await concurrency()
} else {
  const db = new PGlite()
  let begun = false
  try {
    await db.exec('begin'); begun=true
    await setup(db)
    const version=Number((await db.query('show server_version_num')).rows[0].server_version_num)
    assert(version>=170000 && version<180000); checks++
    await matrix(db)
    await db.exec('rollback'); begun=false
    await check(db,"select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')",0,'Fixture rollback')
    await check(db,"select count(*)::int from pg_roles where rolname in ('bx1_wallet_owner','bx1_wallet_verifier')",0,'Role rollback')
    await check(db,"select nullif(current_setting('request.jwt.claims',true),'') is null",true,'transaction-local claims do not bleed after rollback')
    assert(checks>170,'No vacuous SQL/grant matrix')
    console.log(`BX1_WALLET_RLS_PASS assertions=${checks} fixture=synthetic-in-memory no-GoTrue-or-concurrency-proof`)
  } finally {
    if(begun) await db.exec('rollback')
    await db.close()
  }
}
