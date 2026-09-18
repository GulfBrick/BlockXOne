import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

// No network/DSN or real identities. JWTs and signatures are synthetic fixtures.
if (process.argv.length !== 2) throw new Error('MFA SQL fixture accepts no arguments')
const db = new PGlite()
let checks = 0, begun = false
const id = (p,n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const uid=n=>id(1,n), sid=n=>id(2,n), org=n=>id(3,n), pid=n=>id(4,n), fid=n=>id(5,n)
const roles=['Investor','OfferingManager','ComplianceOfficer','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin']
const tables=['bx1_profiles','bx1_organisations','bx1_memberships','bx1_wallets']
const inactive={active:false,requires_mfa:false,session_aal:null,session_is_mfa:false,session_is_totp:false}
const signature='0x'+'11'.repeat(65)
const migration='../../../supabase/migrations/20260918015541_bx1_mfa_assurance.sql'
async function sqlFile(name) { await db.exec(await readFile(new URL(name,import.meta.url),'utf8')) }
async function check(sql,expected,label,params=[]) {
  const {rows}=await db.query(sql,params)
  assert.deepEqual(Object.values(rows[0])[0],expected,label); checks++
}
async function denied(sql,params,label,code='42501') {
  await db.exec('savepoint negative_case')
  let caught
  try {await db.query(sql,params)} catch(error) {caught=error}
  await db.exec('rollback to savepoint negative_case; release savepoint negative_case')
  assert.equal(caught?.code,code,label); checks++
}
async function actor(n=1,aal='aal1',session=sid(n),extra={}) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:session,role:'authenticated',aal,...extra})])
  await db.exec('set local role authenticated')
}
async function visible(counts,label) {
  for(let i=0;i<tables.length;i++) {
    // Wallet SELECT is intentionally column-granted; count(*) may require more.
    await check(`select count(id)::int from public.${tables[i]}`,counts[i],`${label}: ${tables[i]}`)
  }
}
async function status(expected,label) { await check('select public.bx1_mfa_status()',expected,label) }
async function verifier() { await db.exec('reset role; set local role bx1_wallet_verifier') }
const actorParams=(n=1,tenant=1)=>[uid(n),pid(n),sid(n),org(tenant)]
const issueSql='select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,80002,$6,$7)'
const readSql='select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5)'
const consumeSql='select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7)'
async function issue(n=1,addressNumber=1,tenant=1) {
  const {rows}=await db.query(issueSql,[...actorParams(n,tenant),'0x'+String(addressNumber).padStart(40,'0'),'https://bx1.co.za',randomBytes(32).toString('hex')])
  return Object.values(rows[0])[0]
}
async function consume(c,n=1,tenant=1) {
  const {rows}=await db.query(consumeSql,[...actorParams(n,tenant),c.challengeId,c.message,signature])
  return Object.values(rows[0])[0]
}
async function setSession(aal,factorId) {
  await db.exec('reset role')
  await db.query('update auth.sessions set aal=$1,factor_id=$2 where id=$3',[aal,factorId,sid(1)])
}
try {
  await db.exec('begin'); begun=true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.exec('alter table auth.users enable row level security; alter table auth.sessions enable row level security')
  await sqlFile('../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql')
  await db.exec(`
    create role bx1_fixture_migrator nologin noinherit nosuperuser createdb createrole bypassrls;
    grant usage,create on schema public to bx1_fixture_migrator with grant option;
    grant usage on schema auth to bx1_fixture_migrator;
    grant select on auth.users,auth.sessions,auth.mfa_factors to bx1_fixture_migrator;
    alter schema bx1_private owner to bx1_fixture_migrator;
    alter table public.bx1_profiles owner to bx1_fixture_migrator;
    alter table public.bx1_organisations owner to bx1_fixture_migrator;
    alter table public.bx1_memberships owner to bx1_fixture_migrator;
    alter function bx1_private.has_active_session() owner to bx1_fixture_migrator;
    alter function bx1_private.can_access_organisation(uuid) owner to bx1_fixture_migrator;
    set local role bx1_fixture_migrator;
  `)
  await sqlFile('../../../supabase/migrations/20260917190042_bx1_wallet_ownership.sql')
  const before=await db.query("select pg_get_functiondef('bx1_private.has_active_session()'::regprocedure) as definition")
  await sqlFile(migration)
  await db.exec('reset role')
  await check("select count(*)::int from pg_policy where polrelid in ('public.bx1_profiles'::regclass,'public.bx1_organisations'::regclass,'public.bx1_memberships'::regclass,'public.bx1_wallets'::regclass) and not polpermissive and polcmd='r'",4,'four restrictive MFA policies exist')
  await check("select pg_get_functiondef('bx1_private.has_active_session()'::regprocedure)",before.rows[0].definition,'base revocation predicate unchanged')
  for(let n=1;n<=3;n++) {
    await db.query('insert into auth.users(id) values($1)',[uid(n)])
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid(n),uid(n)])
    await db.query('insert into public.bx1_profiles(id,platform_user_id) values($1,$2)',[uid(n),pid(n)])
  }
  for(let n=1;n<=2;n++) await db.query('insert into public.bx1_organisations(id,name) values($1,$2)',[org(n),`Fixture ${n}`])
  for(const role of roles) await db.query('insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,$3)',[uid(1),org(1),role])
  await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'Investor'),($1,$3,'SuperAdmin')",[uid(2),org(1),org(2)])
  await verifier()
  const w1=await consume(await issue())
  const w2=await consume(await issue(2,2),2)
  assert.equal(w1.status,'PENDING'); checks++
  assert.equal(w2.status,'PENDING'); checks++
  const pending=await issue(1,3)
  await actor()
  await visible([1,1,9,1],'unenrolled AAL1 preserves access')
  await status({active:true,requires_mfa:false,session_aal:'aal1',session_is_mfa:false,session_is_totp:false},'unenrolled bootstrap')
  for(const role of roles) {
    await db.exec('reset role')
    await db.query("update public.bx1_memberships set status=case when role=$1 then 'ACTIVE' else 'SUSPENDED' end where user_id=$2",[role,uid(1)])
    await actor(); await visible([1,1,1,1],`${role} remains wallet-optional`)
  }
  await db.exec("reset role; update public.bx1_memberships set status='ACTIVE'")
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'unverified','totp'),($3,$4,'verified','totp')",[fid(1),uid(1),fid(2),uid(2)])
  await actor(); await visible([1,1,9,1],'pending factor does not enforce enrollment')
  await db.exec('reset role')
  await db.query("update auth.mfa_factors set status='verified' where id=$1",[fid(1)])
  await actor(); await visible([0,0,0,0],'verified factor blocks AAL1')
  await status({active:true,requires_mfa:true,session_aal:'aal1',session_is_mfa:false,session_is_totp:false},'AAL1 bootstrap is not RLS-deadlocked')
  await verifier()
  await denied(issueSql,[...actorParams(),'0x'+'4'.padStart(40,'0'),'https://bx1.co.za',randomBytes(32).toString('hex')],'wallet issue requires live MFA','BW001')
  await denied(readSql,[...actorParams(),pending.challengeId],'wallet read requires live MFA','BW001')
  await denied(consumeSql,[...actorParams(),pending.challengeId,pending.message,signature],'wallet consume requires live MFA','BW001')
  await db.exec('reset role')
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'unverified','totp')",[fid(4),uid(1)])
  for(const badFactor of [null,fid(2),fid(4),fid(99)]) {
    await setSession('aal2',badFactor)
    await actor(1,'aal2'); await visible([0,0,0,0],'missing foreign or deleted factor denies AAL2')
  }
  await setSession('aal2',fid(1))
  await actor(1,'aal1'); await visible([0,0,0,0],'old AAL1 token after session upgrade denied')
  for(const aal of [null,'aal3']) {
    await actor(1,aal); await visible([0,0,0,0],'missing or unknown token AAL cannot satisfy MFA')
  }
  await actor(1,'aal1',sid(1),{aal:undefined,user_metadata:{aal:'aal2'},app_metadata:{aal:'aal2'}})
  await visible([0,0,0,0],'metadata cannot supply AAL')
  await setSession('aal1',fid(1))
  await actor(1,'aal2'); await visible([0,0,0,0],'AAL2 token cannot replace live AAL2 session')
  await setSession('aal2',fid(1))
  await actor(1,'aal2'); await visible([1,1,9,1],'token and live MFA pass own rows')
  await status({active:true,requires_mfa:true,session_aal:'aal2',session_is_mfa:true,session_is_totp:true},'current TOTP session status')
  await check('select count(id)::int from public.bx1_wallets where id=$1',0,'same-organisation other wallet remains private',[w2.id])
  await check('select count(id)::int from public.bx1_organisations where id=$1',0,'other organisation remains private',[org(2)])
  await verifier(); await check(readSql,pending,'verified narrow wallet read unchanged',[...actorParams(),pending.challengeId])
  const linked=await consume(pending)
  assert.equal(linked.status,'PENDING'); checks++
  await denied(consumeSql,[...actorParams(),pending.challengeId,pending.message,signature],'one use retained','BW004')
  await db.exec('reset role')
  await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[fid(3),uid(1)])
  await db.query('delete from auth.mfa_factors where id=$1',[fid(1)])
  await actor(1,'aal2'); await visible([0,0,0,0],'removed used factor with another remaining denies')
  await status({active:true,requires_mfa:true,session_aal:'aal2',session_is_mfa:false,session_is_totp:false},'stale AAL2 cannot imply active used factor')
  await verifier()
  await denied(issueSql,[...actorParams(),'0x'+'9'.padStart(40,'0'),'https://bx1.co.za',randomBytes(32).toString('hex')],'removed used factor blocks wallet issue','BW001')
  await denied(readSql,[...actorParams(),pending.challengeId],'removed used factor blocks wallet read','BW001')
  await denied(consumeSql,[...actorParams(),pending.challengeId,pending.message,signature],'removed used factor blocks wallet consume','BW001')
  await setSession('aal2',fid(3))
  await db.query("update auth.mfa_factors set factor_type='phone' where id=$1",[fid(3)])
  await actor(1,'aal1'); await visible([0,0,0,0],'non TOTP verified factor also enforces MFA')
  await actor(1,'aal2'); await visible([1,1,9,2],'sufficient non TOTP assurance ordinary read')
  await status({active:true,requires_mfa:true,session_aal:'aal2',session_is_mfa:true,session_is_totp:false},'phone is not recent TOTP')
  await db.exec('reset role')
  await db.query("update auth.mfa_factors set status='unverified' where id=$1",[fid(3)])
  await actor(1,'aal1'); await visible([1,1,9,2],'last verified factor removal restores ordinary opt-in access')
  await status({active:true,requires_mfa:false,session_aal:'aal2',session_is_mfa:false,session_is_totp:false},'removed factor never grants TOTP readiness')
  await actor(3); await status(inactive,'no active assignment bootstrap denied')
  for(const role of roles) {
    await db.exec('reset role')
    await db.query('insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,$3)',[uid(3),org(2),role])
    await actor(3); await visible([1,1,1,0],`${role} workspace requires no wallet`)
    await db.exec('reset role'); await db.query('delete from public.bx1_memberships where user_id=$1',[uid(3)])
  }
  await actor(1,'aal2',sid(2)); await status(inactive,'foreign session bootstrap denied')
  await actor(1,'aal2',null); await visible([0,0,0,0],'missing session')
  for(const [table,condition] of [['bx1_profiles',`id='${uid(1)}'`],['bx1_organisations',`id='${org(1)}'`],['bx1_memberships',`user_id='${uid(1)}'`]]) {
    await db.exec(`reset role; update public.${table} set status='SUSPENDED' where ${condition}`)
    await actor(1,'aal2'); await status(inactive,`${table} suspension blocks bootstrap`)
    await verifier(); await denied(readSql,[...actorParams(),pending.challengeId],`${table} revocation still wins`,'BW001')
    await db.exec(`reset role; update public.${table} set status='ACTIVE' where ${condition}`)
  }
  for(const [table,column,value] of [['auth.users','banned_until',"now()+interval '1 hour'"],['auth.users','deleted_at','now()'],['auth.sessions','not_after',"now()-interval '1 second'"],['auth.sessions','oauth_client_id',`'${uid(9)}'`]]) {
    const target=table==='auth.users'?uid(1):sid(1)
    await db.exec(`reset role; update ${table} set ${column}=${value} where id='${target}'`)
    await actor(1,'aal2'); await status(inactive,`${column} blocks bootstrap`); await visible([0,0,0,0],column)
    await db.exec(`reset role; update ${table} set ${column}=null where id='${target}'`)
  }
  await db.exec('reset role'); await db.query('delete from auth.sessions where id=$1',[sid(1)])
  await actor(1,'aal2'); await visible([0,0,0,0],'revoked copied token denies'); await status(inactive,'revoked bootstrap')
  await db.exec('reset role')
  await check("select not prosecdef and pronargs=0 from pg_proc where oid='public.bx1_mfa_status()'::regprocedure",true,'public facade invoker no caller IDs')
  for(const name of ['has_session_mfa','has_token_mfa','read_mfa_status']) {
    await check('select prosecdef and proconfig @> array[\'search_path=""\'] and pronargs=0 from pg_proc where oid=$1::regprocedure',true,`${name} narrow fixed definer`,[`bx1_private.${name}()`])
  }
  for(const r of ['anon','service_role','bx1_wallet_verifier']) {
    await db.exec(`reset role; set local role ${r}`)
    await denied('select public.bx1_mfa_status()',[],`${r} cannot invoke bootstrap`)
  }
  await db.exec('reset role')
  for(const r of ['authenticated','anon','bx1_wallet_owner','bx1_wallet_verifier'])
    for(const t of ['auth.users','auth.sessions','auth.mfa_factors'])
      for(const p of ['SELECT','INSERT','UPDATE','DELETE'])
        await check('select has_table_privilege($1,$2,$3)',false,`${r} no ${t} ${p}`,[r,t,p])
  for(const r of ['authenticated','anon','service_role','bx1_wallet_verifier'])
    for(const t of tables)
      for(const p of ['INSERT','UPDATE','DELETE','TRUNCATE'])
        await check('select has_table_privilege($1,$2,$3)',false,`${r} no ${t} ${p}`,[r,'public.'+t,p])
  await check("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bx1_private' and has_function_privilege('bx1_wallet_verifier',p.oid,'EXECUTE')",3,'verifier retains exactly 3 private functions')
  for(const privilege of ['SET','USAGE']) await check('select pg_has_role($1,$2,$3)',false,`temporary migration ${privilege} removed`,['bx1_fixture_migrator','bx1_wallet_owner',privilege])
  await db.exec('rollback'); begun=false
  await check("select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')",0,'fixture rollback')
  assert(checks>200,'No vacuous MFA SQL proof')
  console.log(`BX1_MFA_RLS_PASS assertions=${checks} fixture=synthetic-in-memory non-superuser-migration no-GoTrue-or-concurrency-proof`)
} catch(error) {
  console.error(`BX1_MFA_RLS_FAILED checks=${checks} code=${typeof error?.code==='string'?error.code:'assertion'} check=${error?.name==='AssertionError'?error.message:'fixture operation'}`)
  process.exitCode=1
} finally {
  if(begun) await db.exec('rollback')
  await db.close()
}
