import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

// Synthetic, serial, in-memory PostgreSQL assertions. No DSN, network, hosted
// Auth, signature verification, bootstrap admission or concurrency claim.
if (process.argv.length !== 2) throw new Error('Administration SQL fixture accepts no arguments')
const db = new PGlite()
const tables = ['authority_root','persons','person_principals','authority_scopes','governance_grants',
  'legal_parties','workspace_parties','administration_commands','administration_requests','administration_events']
const roles = ['Investor','OfferingManager','ComplianceOfficer','IssuerFundManager','TransferAgent',
  'TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin']
const id = (p,n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const uid=n=>id(1,n), sid=n=>id(2,n), org=n=>id(3,n), person=n=>id(6,n)
const entityPayload = {displayName:'Synthetic entity',kind:'OTHER',jurisdictionCode:null,registrationReference:null}
const commandSql='select public.bx1_administration_command(target_organisation => $1, request_key => $2, command => $3::jsonb)'
const readSql='select public.bx1_administration_read(target_organisation => $1, selected_command => $2)'
let checks=0, cases=0, failures=0, begun=false, requestSequence=1000
let parseAdminResult, parseAdminReadProjection
const source=path=>readFile(new URL(path,import.meta.url),'utf8')
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label); checks++}
const truth=(actual,label)=>{assert.ok(actual,label); checks++}
const admin=()=>db.exec('reset role')
async function scalar(sql,params=[]) {return Object.values((await db.query(sql,params)).rows[0])[0]}
async function check(sql,expected,label,params=[]) {equal(await scalar(sql,params),expected,label)}
async function sqlFile(path) {await db.exec(await source(path))}
async function rejected(sql,params,label,code='23514') {
  await db.exec('savepoint rejected_case')
  let actual
  try {await db.query(sql,params)} catch(error) {actual=error?.code}
  await db.exec('rollback to savepoint rejected_case; release savepoint rejected_case')
  equal(actual,code,label)
}
async function test(label,body) {
  await admin(); await db.exec('savepoint isolated_case'); cases++
  const before=checks
  try {await body(); truth(checks>before,`${label} executes assertions`)}
  catch(error) {
    failures++
    console.error(`BX1_ADMINISTRATION_CASE_RED case=${label} code=${typeof error?.code==='string'?error.code:'assertion'} check=${error?.name==='AssertionError'?error.message.split('\n')[0]:'database operation'}`)
  } finally {await db.exec('rollback to savepoint isolated_case; release savepoint isolated_case'); await admin()}
}
async function actor(n=1,aal='aal2',extra={},age=0) {
  await admin()
  const now=Number(await scalar('select floor(extract(epoch from clock_timestamp()))::text'))
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({
    sub:uid(n),session_id:sid(n),role:'authenticated',aal,exp:now+3600,
    amr:[{method:'totp',timestamp:now-age}],...extra,
  })])
  await db.exec('set local role authenticated')
}
async function command(input,{n=1,tenant=1,key=id(9,requestSequence++),extra={},age=0,aal='aal2',privateEntry=false}={}) {
  await actor(n,aal,extra,age)
  const result=await scalar(privateEntry?'select bx1_private.execute_administration($1,$2,$3::jsonb)':commandSql,[org(tenant),key,JSON.stringify(input)])
  truth(parseAdminResult(result),'SQL command result satisfies frozen parser')
  return result
}
async function deny(input,error,options={}) {equal(await command(input,options),{ok:false,error},`command denied ${error}`)}
async function read({n=1,tenant=1,selected=null,extra={},age=0,aal='aal2'}={}) {
  await actor(n,aal,extra,age)
  const result=await scalar(readSql,[org(tenant),selected])
  truth(parseAdminReadProjection(result,{organisationId:org(tenant),principalId:uid(n),...(selected?{selectedProposalId:selected}:{})}),'SQL read satisfies frozen parser')
  return result
}
async function gate(availability,options={}) {
  equal(await read(options),{availability,scopeRevision:null,policyVersion:1,caller:null,scope:null,
    people:[],entities:[],proposals:[],selectedProposal:null,truncated:{people:false,entities:false,proposals:false},
    governanceGrants:[],grantsTruncated:false},`complete empty ${availability} projection`)
}
async function revision(tenant=1) {await admin(); return scalar('select revision::text from bx1_private.authority_scopes where organisation_id=$1',[org(tenant)])}
async function propose(kind='ENTITY_DRAFT_CREATE',payload=entityPayload,n=1,options={}) {
  const result=await command({intent:'propose',kind,payload,expectedScopeRevision:await revision(options.tenant??1)},{n,...options})
  truth(result.ok,'proposal accepted'); equal(result.state,'PENDING_REVIEW','proposal pending'); equal(result.revision,'1','proposal first revision')
  return result
}
async function review(proposal,n=3,decision='approve',options={}) {
  const result=await command({intent:'review',proposalId:proposal.proposalId,expectedRevision:proposal.revision,decision},{n,...options})
  truth(result.ok,'review accepted'); equal(result.state,decision==='approve'?'APPROVED':'REJECTED','review state')
  return result
}
async function apply(proposal,n=3,options={}) {
  const result=await command({intent:'apply',proposalId:proposal.proposalId,expectedRevision:proposal.revision},{n,...options})
  truth(result.ok,'apply accepted'); equal(result.state,'APPLIED','apply state'); return result
}
async function member(n=5,tenant=1,role='Investor') {
  await admin(); return scalar('select id::text from public.bx1_memberships where user_id=$1 and organisation_id=$2 and role=$3',[uid(n),org(tenant),role])
}
async function governor(p=3) {
  await admin()
  await db.query("insert into bx1_private.governance_grants(id,organisation_id,person_id,status,valid_from,valid_until,bootstrap_receipt_id) values($1,$2,$3,'ACTIVE',now()-interval '1 minute',now()+interval '30 days',$4)",[id(8,p),org(1),person(p),id(7,1)])
}
async function shortLivedRequesterGrant() {
  await admin()
  await db.query("update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where id=$1",[id(8,1)])
  await db.query("insert into bx1_private.governance_grants(id,organisation_id,person_id,status,valid_from,valid_until,bootstrap_receipt_id) values($1,$2,$3,'ACTIVE',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 seconds',$4)",[id(8,81),org(1),person(1),id(7,1)])
}
async function extraPrincipals(start,end,p=4) {
  await admin()
  await db.query(`insert into auth.users(id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($1::int,$2::int) n`,[start,end])
  await db.query(`insert into public.bx1_profiles(id,platform_user_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series($1::int,$2::int) n`,[start,end])
  await db.query(`insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$3,'TRUSTED','synthetic-large-target',$4 from generate_series($1::int,$2::int) n`,[start,end,person(p),id(7,1)])
  await db.query(`insert into public.bx1_memberships(user_id,organisation_id,role) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,o,'Investor' from generate_series($1::int,$2::int) n cross join unnest($3::uuid[]) o`,[start,end,[org(1),org(2)]])
}
async function state(proposal,expected,events=null) {
  await admin()
  await check('select state from bx1_private.administration_commands where id=$1',expected,'persisted command state',[proposal.proposalId])
  if(events) equal((await db.query('select event_type from bx1_private.administration_events where command_id=$1 order by event_sequence',[proposal.proposalId])).rows.map(r=>r.event_type),events,'ordered atomic event history')
}
async function visibleCounts() {
  const values=[]
  for(const table of ['bx1_profiles','bx1_memberships','bx1_organisations','bx1_wallets']) values.push(await scalar(`select count(id)::int from public.${table}`))
  return values
}
async function issueWallet(n,address,tenant=1) {
  await admin(); await db.exec('set local role bx1_wallet_verifier')
  return scalar('select bx1_private.issue_wallet_challenge($1,$2,$3,$4,$5,80002,$6,$7)',
    [uid(n),id(4,n),sid(n),org(tenant),address,'https://bx1.co.za',randomBytes(32).toString('hex')])
}
const walletConsumeParams=(n,c,tenant=1)=>[uid(n),id(4,n),sid(n),org(tenant),c.challengeId,c.message,'0x'+'11'.repeat(65)]
const consumeWalletSql='select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7)'

async function schemaMatrix(fixtureOwner,definitions,defaults) {
  for(const table of tables) {
    await check("select relrowsecurity and pg_get_userbyid(relowner)='bx1_authority_owner' from pg_class where oid=$1::regclass",true,`${table} private RLS and owner`,['bx1_private.'+table])
    await check(`select count(*)::int from bx1_private.${table}`,table==='authority_root'?1:0,`${table} no admission seeds`)
    for(const role of ['anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier'])
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
        await check('select has_table_privilege($1,$2,$3)',false,`${role} no raw ${table} ${privilege}`,[role,'bx1_private.'+table,privilege])
  }
  await check("select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls from pg_roles where rolname='bx1_authority_owner'",true,'nonprivileged execution owner')
  for(const role of ['bx1_fixture_migrator','anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier'])
    for(const p of ['SET','USAGE']) await check('select pg_has_role($1,$2,$3)',false,`${role} no authority inheritance`,[role,'bx1_authority_owner',p])
  for(const role of [fixtureOwner,'bx1_fixture_migrator','anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier'])
    for(const p of ['SET','USAGE']) await check('select pg_has_role($1,$2,$3)',false,'owner cannot set/inherit other role',['bx1_authority_owner',role,p])
  for(const schema of ['public','bx1_private','auth']) await check("select has_schema_privilege('bx1_authority_owner',$1,'CREATE')",false,'owner no schema creation',[schema])
  for(const role of ['bx1_authority_owner','anon','authenticated','bx1_wallet_owner','bx1_wallet_verifier'])
    for(const table of ['auth.users','auth.sessions','auth.mfa_factors'])
      for(const p of ['SELECT','INSERT','UPDATE','DELETE']) await check('select has_table_privilege($1,$2,$3)',false,`${role} no raw Auth ${p}`,[role,table,p])
  for(const role of ['anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier'])
    for(const p of ['USAGE','SELECT','UPDATE']) await check('select has_sequence_privilege($1,$2,$3)',false,'audit sequence private',[role,'bx1_private.administration_events_event_sequence_seq',p])
  equal((await db.query('select * from pg_default_acl order by oid')).rows,defaults,'preexisting default ACL untouched')
  equal((await db.query(definitions.sql)).rows,definitions.rows,'existing base MFA and wallet function definitions unchanged')
}
async function upgradeMatrix() {
  for(const role of roles) await test(`upgrade-wallet-free-${role}`,async()=>{
    await db.query("update public.bx1_memberships set status=case when role=$1 then 'ACTIVE' else 'SUSPENDED' end where user_id=$2",[role,uid(1)])
    await actor(1,'aal1')
    equal(await visibleCounts(),[1,1,1,0],'wallet-free own scope visible')
    await check('select count(*)::int from public.bx1_profiles where id=$1',0,'foreign profile hidden',[uid(3)])
    await check('select count(*)::int from public.bx1_organisations where id=$1',0,'foreign tenant hidden',[org(2)])
    await rejected('select * from bx1_private.persons',[],'no raw trust directory','42501')
  })
  await test('upgrade-copied-and-revoked-session',async()=>{
    await actor(1,'aal1',{session_id:sid(3)}); equal(await visibleCounts(),[0,0,0,0],'copied foreign session denied')
    await admin(); await db.query('delete from auth.sessions where id=$1',[sid(1)])
    await actor(1,'aal1'); equal(await visibleCounts(),[0,0,0,0],'revoked current session denied')
  })
  for(const [label,sql,params] of [
    ['profile',"update public.bx1_profiles set status='SUSPENDED' where id=$1",[uid(1)]],
    ['organisation',"update public.bx1_organisations set status='SUSPENDED' where id=$1",[org(1)]],
    ['membership',"update public.bx1_memberships set status='SUSPENDED' where user_id=$1",[uid(1)]],
    ['banned','update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[uid(1)]],
    ['session-expired','update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[sid(1)]],
  ]) await test(`upgrade-live-${label}`,async()=>{
    await db.query(sql,params); await actor(1,'aal1')
    await check('select count(*)::int from public.bx1_organisations',0,'live revocation hides tenant')
  })
  await test('upgrade-current-stale-removed-totp',async()=>{
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'unverified','totp')",[id(5,1),uid(1)])
    await actor(1,'aal1'); await check('select count(*)::int from public.bx1_organisations',1,'pending enrollment preserves ordinary access')
    await admin(); await db.exec("update auth.mfa_factors set status='verified'")
    await actor(1,'aal1'); equal(await visibleCounts(),[0,0,0,0],'verified enrollment closes stale AAL1')
    await admin(); await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2",[id(5,1),sid(1)])
    await actor(1,'aal1'); equal(await visibleCounts(),[0,0,0,0],'old token remains stale after live upgrade')
    await actor(1); await check('select count(*)::int from public.bx1_organisations',1,'current own TOTP and AAL2 works')
    await admin(); await db.exec('delete from auth.mfa_factors')
    await actor(1,'aal1'); await check('select count(*)::int from public.bx1_organisations',1,'removed last factor returns wallet-free ordinary access')
    equal((await scalar('select bx1_private.read_mfa_status()')).session_is_totp,false,'removed factor is not current TOTP')
  })
  await test('upgrade-wallet-pending-global-uniqueness-and-rls',async()=>{
    const first=await issueWallet(1,'0x'+'1'.repeat(40))
    const linked=await scalar(consumeWalletSql,walletConsumeParams(1,first))
    equal(linked.status,'PENDING','proof does not confer active wallet mandate')
    await rejected(consumeWalletSql,walletConsumeParams(1,first),'one use challenge','BW004')
    const foreign=await issueWallet(6,'0x'+'2'.repeat(40),2)
    equal((await scalar(consumeWalletSql,walletConsumeParams(6,foreign,2))).status,'PENDING','foreign pending wallet created')
    await actor(1,'aal1'); await check('select count(id)::int from public.bx1_wallets',1,'own wallet visible foreign hidden')
    const duplicate=await issueWallet(6,'0x'+'1'.repeat(40),2)
    await rejected(consumeWalletSql,walletConsumeParams(6,duplicate,2),'global address/chain uniqueness','BW004')
    await admin(); await check('select count(*)::int from public.bx1_wallets',2,'duplicate created no wallet')
  })
  await test('upgrade-wallet-verifier-and-client-acls',async()=>{
    const functions=(await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bx1_private' and has_function_privilege('bx1_wallet_verifier',p.oid,'EXECUTE') order by 1")).rows.map(r=>r.proname)
    equal(functions,['consume_wallet_challenge','issue_wallet_challenge','read_wallet_challenge'],'exact three verifier entrypoints')
    for(const role of ['anon','authenticated','bx1_wallet_verifier']) {
      await admin(); await db.exec(`set local role ${role}`)
      for(const table of ['auth.users','auth.sessions','auth.mfa_factors']) {
        await rejected(`select * from ${table}`,[],`${role} actual raw Auth read denied`,'42501')
        await rejected(`delete from ${table}`,[],`${role} actual Auth DML denied`,'42501')
      }
    }
    for(const role of ['anon','authenticated']) {
      await admin(); await db.exec(`set local role ${role}`)
      for(const table of ['bx1_profiles','bx1_memberships','bx1_organisations','bx1_wallets']) {
        for(const action of ['delete from','truncate']) await rejected(`${action} public.${table}`,[],'ordinary client DML denied','42501')
        await rejected(`update public.${table} set id=id`,[],'ordinary client UPDATE denied','42501')
        await rejected(`insert into public.${table} default values`,[],'ordinary client INSERT denied','42501')
      }
    }
  })
  await test('upgrade-empty-bootstrap-unconfigured',async()=>{
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[id(5,1),uid(1)])
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2",[id(5,1),sid(1)])
    await gate('unconfigured')
    await deny({intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'},'unconfigured')
    await admin()
    for(const table of ['persons','person_principals','authority_scopes','governance_grants']) await check(`select count(*)::int from bx1_private.${table}`,0,'no inferred bootstrap')
  })
}

async function administrationMatrix() {
  // Domain cases below run against the same upgraded database, but each rolls
  // back to the explicit two-person synthetic governance fixture.
  await test('retained-foundation-constraints-and-private-provenance',async()=>{
    await check("select count(*)>0 and bool_and(not m.inherit_option and not m.set_option) from pg_auth_members m join pg_roles target on target.oid=m.roleid join pg_roles member on member.oid=m.member where target.rolname='bx1_authority_owner' and member.rolname='bx1_fixture_migrator'",true,'all temporary ownership membership edges restored')
    await rejected('insert into bx1_private.authority_root values(false,1,1)',[],'root singleton only')
    await rejected('update bx1_private.authority_root set policy_version=2',[],'policy pin immutable')
    await rejected('update bx1_private.authority_root set trust_revision=0',[],'positive trust revision')
    await rejected("insert into bx1_private.persons(label,status,evidence_reference,bootstrap_receipt_id) values(' ','TRUSTED','synthetic',$1)",[id(7,1)],'blank labels rejected')
    await rejected("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic',$3)",[uid(7),person(99),id(7,1)],'unknown person rejected','23503')
    const grantInsert="insert into bx1_private.governance_grants(organisation_id,person_id,status,capability,valid_from,valid_until,bootstrap_receipt_id) values($1,$2,'ACTIVE',$3,now(),$4::timestamptz,$5)"
    for(const [cap,until,receipt] of [['ADMINISTRATION_V1','infinity',id(7,1)],['token.mint',new Date(Date.now()+86400000).toISOString(),id(7,1)],['ADMINISTRATION_V1','2099-01-01T00:00:00Z',id(7,1)],['ADMINISTRATION_V1','2000-01-01T00:00:00Z',id(7,1)],['ADMINISTRATION_V1',new Date(Date.now()+86400000).toISOString(),null]])
      await rejected(grantInsert,[org(1),person(4),cap,until,receipt],'grant bounds/capability/provenance exact')
    await rejected(grantInsert,[org(1),person(1),'ADMINISTRATION_V1',new Date(Date.now()+86400000).toISOString(),id(7,1)],'one active grant per person scope','23505')
    await rejected("insert into bx1_private.authority_scopes(organisation_id,state,bootstrap_receipt_id) values($1,'ACTIVE',$2)",[org(2),id(7,1)],'scope state closed')
    const p=await propose(); await admin()
    await rejected("insert into bx1_private.administration_commands select * from bx1_private.administration_commands where id=$1",[p.proposalId],'proposal uniqueness retained','23505')
    await rejected("insert into bx1_private.administration_requests select * from bx1_private.administration_requests",[],'receipt uniqueness retained','23505')
    await rejected("insert into bx1_private.legal_parties(organisation_id,display_name,kind,created_command_id,status) values($1,'Synthetic','OTHER',$2,'VERIFIED')",[org(1),p.proposalId],'entity only DRAFT')
    await rejected("insert into bx1_private.legal_parties(organisation_id,display_name,kind,created_command_id,revision) values($1,'Synthetic','OTHER',$2,2)",[org(1),p.proposalId],'entity only initial revision')
    await db.query("insert into bx1_private.legal_parties(id,organisation_id,display_name,kind,created_command_id) values($1,$2,'Synthetic','OTHER',$3)",[id(7,2),org(1),p.proposalId])
    await rejected("insert into bx1_private.workspace_parties(organisation_id,party_id,created_command_id,relationship) values($1,$2,$3,'ISSUER')",[org(1),id(7,2),p.proposalId],'only RECORDED_ONLY relation')
    await rejected("insert into bx1_private.workspace_parties(organisation_id,party_id,created_command_id) values($1,$2,$3)",[org(2),id(7,2),p.proposalId],'foreign composite party/command link rejected','23503')
    for(const [type,reason] of [['RESET_TOTP',null],['PROPOSED','raw-secret-or-error']])
      await rejected("insert into bx1_private.administration_events(command_id,organisation_id,actor_principal_id,actor_person_id,event_type,after_revision,after_state,payload_hash,reason) select id,organisation_id,requester_principal_id,requester_person_id,$2,revision,state,payload_hash,$3 from bx1_private.administration_commands where id=$1",[p.proposalId,type,reason],'closed safe event vocabulary')
  })
  await test('runtime-entrypoints-ownership-acl-and-search-path',async()=>{
    for(const [signature,names] of [
      ['public.bx1_administration_command(uuid,uuid,jsonb)',['target_organisation','request_key','command']],
      ['public.bx1_administration_read(uuid,uuid)',['target_organisation','selected_command']],
    ]) await check('select proargnames from pg_proc where oid=$1::regprocedure',names,'exact public RPC named argument contract',[signature])
    for(const [signature,owner,definer] of [
      ['public.bx1_administration_command(uuid,uuid,jsonb)','bx1_fixture_migrator',false],
      ['public.bx1_administration_read(uuid,uuid)','bx1_fixture_migrator',false],
      ['bx1_private.execute_administration(uuid,uuid,jsonb)','bx1_authority_owner',true],
      ['bx1_private.read_administration(uuid,uuid)','bx1_authority_owner',true],
    ]) {
      const p=(await db.query('select pg_get_userbyid(proowner) owner,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows[0]
      equal(p.owner,owner,'exact entrypoint owner'); equal(p.prosecdef,definer,'entrypoint definer boundary')
      truth(p.proconfig?.some(v=>v==='search_path=""'||v==='search_path='),'empty entrypoint search path')
      truth(p.proconfig?.includes('statement_timeout=10s'),'per-function statement timeout metadata (not runtime proof)')
      for(const role of ['anon','authenticated','service_role','bx1_wallet_verifier','bx1_wallet_owner'])
        await check('select has_function_privilege($1,$2,\'EXECUTE\')',role==='authenticated','only authenticated entry access',[role,signature])
      await check("select count(*)::int from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'",0,'no PUBLIC execution',[signature])
    }
    for(const signature of ['bx1_private.has_recent_administration_totp()','bx1_private.is_eligible_governor(uuid,uuid)']) {
      const p=(await db.query('select pg_get_userbyid(proowner) owner,prosecdef,provolatile from pg_proc where oid=$1::regprocedure',[signature])).rows[0]
      equal(p,{owner:'bx1_fixture_migrator',prosecdef:true,provolatile:'v'},'narrow volatile Auth reader remains migrator owned')
    }
    const helpers=(await db.query("select oid::regprocedure::text signature from pg_proc where pronamespace='bx1_private'::regnamespace and (proname like '%administration%' or proname='is_eligible_governor') and proname not in ('execute_administration','read_administration')")).rows
    truth(helpers.length>=3,'private helper set is nonempty')
    for(const {signature} of helpers) for(const role of ['anon','authenticated','service_role','bx1_wallet_owner','bx1_wallet_verifier'])
      await check('select has_function_privilege($1,$2,\'EXECUTE\')',false,'no helper exposure',[role,signature])
    await check("select has_function_privilege('bx1_authority_owner','bx1_private.read_mfa_status()','EXECUTE')",true,'only existing read assurance execution granted')
    for(const table of ['bx1_profiles','bx1_organisations','bx1_memberships','bx1_wallets']) {
      await check("select has_table_privilege('bx1_authority_owner',$1,'SELECT')",table!=='bx1_wallets','narrow existing identity read grant',['public.'+table])
      for(const p of ['INSERT','UPDATE','DELETE','TRUNCATE']) await check('select has_table_privilege($1,$2,$3)',false,'no whole-table DML grant',['bx1_authority_owner','public.'+table,p])
    }
    for(const column of ['id','user_id','organisation_id','role','status','created_at']) {
      await check("select has_column_privilege('bx1_authority_owner','public.bx1_memberships',$1,'INSERT')",['user_id','organisation_id','role','status'].includes(column),'exact membership INSERT columns',[column])
      await check("select has_column_privilege('bx1_authority_owner','public.bx1_memberships',$1,'UPDATE')",column==='status','only membership status UPDATE',[column])
    }
  })
  await test('safe-ready-read-and-no-claim-authority',async()=>{
    const view=await read(); equal(view.availability,'ready','trusted governor read ready')
    equal(view.caller.personId,person(1),'underlying human caller'); equal(view.governanceGrants.length,2,'two governors')
    truth(view.people.some(p=>p.id===person(1)&&p.principals.length===2),'same-human principals grouped')
    truth(!view.people.some(p=>p.id===person(5)),'foreign-only person omitted')
    const serialized=JSON.stringify(view)
    for(const forbidden of ['evidence_reference','bootstrap_receipt','synthetic-attestation','factor_id','session_id','@','access_token']) truth(!serialized.includes(forbidden),'no admission/Auth secrets in safe read')
    await gate('forbidden',{n:5,extra:{app_metadata:{role:'SuperAdmin',governor:true},user_metadata:{personId:person(1)}}})
    await gate('forbidden',{n:7})
    await gate('unconfigured',{n:3,tenant:2})
    await gate('forbidden',{tenant:2})
  })
  await test('entity-propose-review-apply-atomic-history',async()=>{
    const p=await propose(); await state(p,'PENDING_REVIEW',['PROPOSED'])
    const a=await review(p); await state(a,'APPROVED',['PROPOSED','APPROVED'])
    await check('select count(*)::int from bx1_private.legal_parties',0,'approval has no domain effect')
    const done=await apply(a,1); equal(done.scopeRevision,'2','every apply increments scope')
    await state(done,'APPLIED',['PROPOSED','APPROVED','APPLIED'])
    await check("select count(*)::int from bx1_private.legal_parties where status='DRAFT' and revision=1",1,'one DRAFT only entity')
    await check("select count(*)::int from bx1_private.workspace_parties where relationship='RECORDED_ONLY'",1,'one recorded-only link')
    await check('select count(*)::int from bx1_private.administration_requests',3,'each transition exactly one receipt')
    await check("select payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex') from bx1_private.administration_commands where id=$1",true,'database canonical hash',[p.proposalId])
    const detail=await read({selected:p.proposalId}); equal(detail.selectedProposal.state,'APPLIED','selected applied state')
    equal(detail.selectedProposal.events.map(e=>e.type),['APPLIED','APPROVED','PROPOSED'],'newest safe audit first')
    equal(detail.selectedProposal.payload,entityPayload,'flat normalized payload')
  })
  await test('membership-grant-only-admitted-target-and-no-governance',async()=>{
    const p=await propose('MEMBERSHIP_GRANT',{principalId:uid(5),role:'SuperAdmin'})
    const done=await apply(await review(p)); await state(done,'APPLIED')
    await check("select count(*)::int from public.bx1_memberships where user_id=$1 and organisation_id=$2 and role='SuperAdmin' and status='ACTIVE'",1,'ordinary badge applied',[uid(5),org(1)])
    await check('select count(*)::int from bx1_private.governance_grants where person_id=$1',0,'SuperAdmin badge confers no governed authority',[person(4)])
    await gate('forbidden',{n:5})
  })
  await test('membership-reactivation-preserves-row',async()=>{
    await db.query("insert into public.bx1_memberships(user_id,organisation_id,role,status) values($1,$2,'SuperAdmin','SUSPENDED')",[uid(5),org(1)])
    const original=await member(5,1,'SuperAdmin')
    await apply(await review(await propose('MEMBERSHIP_GRANT',{principalId:uid(5),role:'SuperAdmin'})))
    equal(await member(5,1,'SuperAdmin'),original,'reactivated exact existing unique row')
    await check("select status from public.bx1_memberships where id=$1",'ACTIVE','reactivated membership',[original])
  })
  await test('membership-revoke-scoped-history',async()=>{
    const target=await member()
    await apply(await review(await propose('MEMBERSHIP_REVOKE',{membershipId:target,reason:'routine'})))
    await admin(); await check('select status from public.bx1_memberships where id=$1','SUSPENDED','target suspended, not deleted',[target])
    await check("select count(*)::int from public.bx1_memberships where user_id=$1 and organisation_id=$2 and status='ACTIVE'",1,'foreign membership preserved',[uid(5),org(2)])
    await check('select count(*)::int from bx1_private.governance_grants',2,'nongovernor membership revocation preserves governors')
  })
  await test('governance-grant-fixed-scope-and-history',async()=>{
    const validUntil=new Date(Date.now()+86400000).toISOString()
    await apply(await review(await propose('GOVERNANCE_GRANT',{personId:person(4),validUntil})))
    await admin(); await check("select count(*)::int from bx1_private.governance_grants where person_id=$1 and organisation_id=$2 and status='ACTIVE' and capability='ADMINISTRATION_V1' and created_command_id is not null and bootstrap_receipt_id is null",1,'fixed capability with command provenance',[person(4),org(1)])
    equal((await read({n:5})).availability,'ready','new current governor read allowed')
  })
  await test('governance-revoke-leaves-ordinary-memberships',async()=>{
    await governor(3)
    await apply(await review(await propose('GOVERNANCE_REVOKE',{grantId:id(8,3),reason:'routine'})))
    await admin(); await check('select status from bx1_private.governance_grants where id=$1','REVOKED','third governance grant revoked',[id(8,3)])
    await check('select revision::text from bx1_private.governance_grants where id=$1','2','grant revision advanced',[id(8,3)])
    await check("select count(*)::int from public.bx1_memberships where user_id=$1 and status='ACTIVE'",1,'ordinary access intentionally retained',[uid(4)])
    await gate('forbidden',{n:4})
  })
  await test('person-scope-revoke-all-accounts-selected-org-only',async()=>{
    await governor(4)
    const before=(await db.query("select id,user_id,aal,factor_id from auth.sessions order by id")).rows
    await apply(await review(await propose('PERSON_SCOPE_REVOKE',{personId:person(4),reason:'routine'})))
    await admin(); await check("select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[]) and organisation_id=$2 and status='ACTIVE'",0,'all same-person selected-org accounts removed',[[uid(5),uid(8)],org(1)])
    await check("select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[]) and organisation_id=$2 and status='ACTIVE'",2,'both foreign memberships preserved',[[uid(5),uid(8)],org(2)])
    await check('select status from bx1_private.governance_grants where id=$1','REVOKED','same-person governance revoked',[id(8,4)])
    equal((await db.query('select id,user_id,aal,factor_id from auth.sessions order by id')).rows,before,'Auth sessions and factors unchanged')
    await check('select count(*)::int from auth.users',8,'no Auth deletion'); await check('select count(*)::int from auth.mfa_factors',8,'no factor deletion')
  })
  for(const decision of ['reject','cancel-pending','cancel-approved']) await test(`terminal-${decision}`,async()=>{
    let p=await propose()
    if(decision==='reject') p=await review(p,3,'reject')
    else {
      if(decision==='cancel-approved') p=await review(p)
      const result=await command({intent:'cancel',proposalId:p.proposalId,expectedRevision:p.revision})
      truth(result.ok,'requester cancellation accepted'); equal(result.state,'CANCELLED','cancel state'); p=result
    }
    await admin(); await check('select count(*)::int from bx1_private.legal_parties',0,'terminal decision has no entity effect')
    await deny({intent:'apply',proposalId:p.proposalId,expectedRevision:p.revision},'conflict')
  })
  await test('same-person-review-beneficiary-and-unrelated-apply-deny',async()=>{
    const p=await propose()
    for(const n of [1,2]) await deny({intent:'review',proposalId:p.proposalId,expectedRevision:'1',decision:'approve'},'forbidden',{n})
    await governor(3); const a=await review(p)
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'forbidden',{n:4})
    await deny({intent:'cancel',proposalId:a.proposalId,expectedRevision:a.revision},'forbidden',{n:3})
    await state(a,'APPROVED'); await check('select count(*)::int from bx1_private.legal_parties',0,'all denied calls had no effect')
    await deny({intent:'propose',kind:'MEMBERSHIP_GRANT',payload:{principalId:uid(2),role:'SuperAdmin'},expectedScopeRevision:'1'},'forbidden')
    const reduction=await propose('GOVERNANCE_REVOKE',{grantId:id(8,2),reason:'security'})
    await deny({intent:'review',proposalId:reduction.proposalId,expectedRevision:'1',decision:'approve'},'forbidden',{n:3})
  })
  await test('foreign-target-scope-and-details-deny',async()=>{
    const p=await propose()
    await deny({intent:'review',proposalId:p.proposalId,expectedRevision:'1',decision:'approve'},'unconfigured',{n:3,tenant:2})
    await gate('unconfigured',{n:3,tenant:2,selected:p.proposalId})
    await deny({intent:'propose',kind:'MEMBERSHIP_GRANT',payload:{principalId:uid(6),role:'SuperAdmin'},expectedScopeRevision:'1'},'conflict')
    await deny({intent:'propose',kind:'MEMBERSHIP_GRANT',payload:{principalId:uid(7),role:'SuperAdmin'},expectedScopeRevision:'1'},'conflict')
    const foreignMember=await member(5,2)
    await deny({intent:'propose',kind:'MEMBERSHIP_REVOKE',payload:{membershipId:foreignMember,reason:'security'},expectedScopeRevision:'1'},'conflict')
    await state(p,'PENDING_REVIEW',['PROPOSED'])
    await check('select count(*)::int from bx1_private.administration_commands',1,'foreign/ineligible targets created no command')
    await check('select count(*)::int from bx1_private.administration_requests',1,'foreign/ineligible targets created no receipt')
  })
  for(const kind of ['GOVERNANCE_REVOKE','PERSON_SCOPE_REVOKE']) await test(`two-governor-self-security-${kind}`,async()=>{
    const payload=kind==='GOVERNANCE_REVOKE'?{grantId:id(8,1),reason:'security'}:{personId:person(1),reason:'security'}
    const p=await propose(kind,payload)
    const a=await review(p)
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'forbidden')
    const key=id(9,requestSequence++)
    const done=await apply(a,3,{key}); equal(done.scopeState,'HOLD','actual reduction enters HOLD')
    equal(done.scopeRevision,'2','HOLD and effect one scope revision')
    await state(done,'APPLIED',['PROPOSED','APPROVED','APPLIED','GOVERNANCE_HOLD'])
    await check('select status from bx1_private.governance_grants where id=$1','REVOKED','requester authority actually revoked',[id(8,1)])
    await check("select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[]) and organisation_id=$2 and status='ACTIVE'",kind==='PERSON_SCOPE_REVOKE'?0:10,'reduction exact ordinary access effect',[[uid(1),uid(2)],org(1)])
    const view=await read({n:3,selected:p.proposalId}); equal(view.availability,'hold','remaining governor reads evidence')
    equal(view.selectedProposal.allowedTransitions,[],'HOLD no mutation hints')
    await gate('forbidden',{selected:p.proposalId})
    for(const input of [
      {intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},
      {intent:'cancel',proposalId:a.proposalId,expectedRevision:done.revision},
      {intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'2'},
    ]) await deny(input,'governance_hold',{n:3,key})
  })
  await test('two-governor-routine-reduction-denied',async()=>{
    const p=await propose('GOVERNANCE_REVOKE',{grantId:id(8,1),reason:'routine'})
    const a=await review(p)
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'conflict',{n:3})
    await admin(); await check("select count(*)::int from bx1_private.governance_grants where status='ACTIVE'",2,'routine cannot remove second governor')
    await check('select state from bx1_private.authority_scopes','READY','routine does not enter HOLD')
    await state(a,'APPROVED',['PROPOSED','APPROVED'])
    await check('select count(*)::int from bx1_private.administration_requests',2,'routine floor no apply receipt')
  })
  for(const lost of ['revoked','expired']) await test(`self-security-requester-${lost}-before-apply-invalidates`,async()=>{
    if(lost==='expired') await shortLivedRequesterGrant()
    const p=await propose('GOVERNANCE_REVOKE',{grantId:id(8,lost==='expired'?81:1),reason:'security'})
    const a=await review(p); await admin()
    if(lost==='expired') await db.query('select pg_sleep(2.1)')
    else await db.query("update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where id=$1",[id(8,1)])
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'conflict',{n:3})
    await state(a,'INVALIDATED',['PROPOSED','APPROVED','INVALIDATED'])
    await check('select state from bx1_private.authority_scopes','READY','no applied security effect/HOLD after prerequisite lost')
  })
  await test('reviewer-offline-session-not-required-for-eligibility',async()=>{
    const a=await review(await propose()); await admin()
    await db.query('delete from auth.sessions where user_id=$1',[uid(3)])
    await check('select bx1_private.is_eligible_governor($1,$2)',true,'offline reviewer remains eligible with current verified TOTP',[person(2),org(1)])
    await apply(a,1)
  })
  for(const age of [0,300]) await test(`command-recency-boundary-${age}`,async()=>{
    const p=await propose('ENTITY_DRAFT_CREATE',entityPayload,1,{age}); await state(p,'PENDING_REVIEW',['PROPOSED'])
  })
  await test('stale-amr-read-success-command-cancel-and-replay-denied',async()=>{
    const key=id(9,requestSequence++)
    const input={intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'}
    const p=await command(input,{key}); truth(p.ok,'current proposal receipt created')
    equal((await read({age:301,selected:p.proposalId})).availability,'ready','stale age alone does not gate read')
    await deny(input,'step_up_required',{age:301})
    await deny(input,'step_up_required',{age:301,key})
    await deny({intent:'cancel',proposalId:p.proposalId,expectedRevision:'1'},'step_up_required',{age:301})
    await state(p,'PENDING_REVIEW',['PROPOSED'])
    await check('select count(*)::int from bx1_private.administration_requests',1,'stale denied calls did not create receipts')
  })
  for(const [label,amr] of [
    ['null',null],['absent',undefined],['empty',[]],['password',[{method:'password',timestamp:1}]],
    ['recovery',[{method:'recovery',timestamp:1}]],['object',{method:'totp',timestamp:1}],
    ['over-32',Array.from({length:33},()=>({method:'totp',timestamp:1}))],
  ]) await test(`invalid-amr-${label}`,async()=>{
    await deny({intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'},'step_up_required',{extra:{amr,iat:Math.floor(Date.now()/1000)}})
    await admin(); await check('select count(*)::int from bx1_private.administration_commands',0,'invalid AMR no proposal')
  })
  for(const [label,delta] of [['future',100],['fractional',0.5]]) await test(`invalid-amr-${label}`,async()=>{
    const now=Number(await scalar('select floor(extract(epoch from clock_timestamp()))::text'))
    await deny({intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'},'step_up_required',{extra:{amr:[{method:'totp',timestamp:now+delta}]}})
  })
  for(const otherAccount of [false,true]) await test(`phone-session-cannot-borrow-${otherAccount?'same-person-account':'own'}-totp`,async()=>{
    // Eligibility can be supplied by another verified TOTP; session assurance cannot.
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','phone')",[id(5,99),uid(1)])
    await db.query("update auth.sessions set factor_id=$1 where id=$2",[id(5,99),sid(1)])
    if(otherAccount) await db.query('delete from auth.mfa_factors where id=$1',[id(5,1)])
    await check('select bx1_private.is_eligible_governor($1,$2)',true,'roster still eligible',[person(1),org(1)])
    await gate('mfa_required')
    const result=await command({intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'})
    equal(result,{ok:false,error:'mfa_required'},'phone session has no current TOTP command assurance')
    await admin(); await check('select count(*)::int from bx1_private.administration_commands',0,'phone assurance denial no writes')
  })
  for(const [label,sql,params,availability,error] of [
    ['last-factor-removed','delete from auth.mfa_factors where user_id=$1',[uid(1)],'mfa_required','mfa_required'],
    ['foreign-factor','update auth.sessions set factor_id=$1 where id=$2',[id(5,3),sid(1)],'mfa_required','mfa_required'],
    ['live-aal1',"update auth.sessions set aal='aal1' where id=$1",[sid(1)],'mfa_required','mfa_required'],
    ['mapping-revoked',"update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1",[uid(1)],'forbidden','forbidden'],
    ['person-revoked',"update bx1_private.persons set status='REVOKED' where id=$1",[person(1)],'forbidden','forbidden'],
    ['profile-suspended',"update public.bx1_profiles set status='SUSPENDED' where id=$1",[uid(1)],'forbidden','unauthorised'],
    ['membership-suspended',"update public.bx1_memberships set status='SUSPENDED' where user_id=$1",[uid(1)],'forbidden','forbidden'],
    ['org-suspended',"update public.bx1_organisations set status='SUSPENDED' where id=$1",[org(1)],'forbidden','forbidden'],
    ['grant-expired','select pg_sleep(2.1)',[],'forbidden','forbidden'],
    ['session-revoked','delete from auth.sessions where id=$1',[sid(1)],'forbidden','unauthorised'],
  ]) await test(`current-authority-${label}`,async()=>{
    if(label==='grant-expired') await shortLivedRequesterGrant()
    const key=id(9,requestSequence++), input={intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'}
    const p=await command(input,{key}); truth(p.ok,'receipt before revocation')
    await admin(); await db.query(sql,params)
    await gate(availability,{selected:p.proposalId}); await deny(input,error,{key})
    await state(p,'PENDING_REVIEW',['PROPOSED'])
  })
  for(const [label,extra,availability,error] of [
    ['token-aal1',{aal:'aal1'},'mfa_required','mfa_required'],
    ['expired-token',{exp:1},'mfa_required','mfa_required'],
    ['string-exp',{exp:'9999999999'},'mfa_required','mfa_required'],
    ['fractional-exp',{exp:9999999999.5},'mfa_required','mfa_required'],
    ['copied-session',{session_id:sid(3)},'forbidden','unauthorised'],
  ]) await test(`signed-claims-${label}`,async()=>{
    await gate(availability,{extra})
    await deny({intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'},error,{extra})
  })
  await test('strict-command-keys-types-and-six-payloads',async()=>{
    const valid={intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'}
    for(const input of [null,[],{},'propose',{...valid,actorId:uid(1)},{...valid,requestKey:id(9,1)},
      {...valid,expectedScopeRevision:1},{...valid,expectedScopeRevision:'01'},{...valid,expectedScopeRevision:'0'},
      {...valid,expectedScopeRevision:'9223372036854775808'}, {...valid,expectedScopeRevision:'1e1'},
      {...valid,payload:{...entityPayload,extra:'no'}},{...valid,payload:JSON.stringify(entityPayload)},
      {...valid,payload:{...entityPayload,displayName:'x'.repeat(201)}},
      {...valid,payload:{...entityPayload,displayName:'unsafe\u0085name'}},
      {...valid,payload:{...entityPayload,displayName:[]}},
      {...valid,payload:{...entityPayload,kind:'ISSUER'}},
      {...valid,payload:{...entityPayload,jurisdictionCode:'za'}},
      {...valid,payload:{...entityPayload,registrationReference:''}},
      {...valid,kind:'MEMBERSHIP_GRANT',payload:{principalId:'00000000-0000-0000-0000-000000000000',role:'Investor'}},
      {...valid,kind:'MEMBERSHIP_GRANT',payload:{principalId:uid(5),role:'Governor'}},
      {...valid,kind:'MEMBERSHIP_REVOKE',payload:{membershipId:uid(5),reason:'emergency'}},
      {...valid,kind:'GOVERNANCE_GRANT',payload:{personId:person(4),validUntil:'2026-02-30T00:00:00Z'}},
      {...valid,kind:'GOVERNANCE_GRANT',payload:{personId:person(4),validUntil:'2099-01-01T00:00:00Z'}},
      {...valid,kind:'GOVERNANCE_GRANT',payload:{personId:person(4),validUntil:'2000-01-01T00:00:00Z'}},
      {...valid,kind:'GOVERNANCE_REVOKE',payload:{grantId:id(8,1),reason:null}},
      {...valid,kind:'PERSON_SCOPE_REVOKE',payload:{personId:person(4),reason:'routine',organisationId:org(2)}},
      {intent:'review',proposalId:id(9,1),expectedRevision:'1',decision:'apply'},
      {intent:'apply',proposalId:id(9,1),expectedRevision:'1',decision:'approve'},
      {intent:'cancel',proposalId:id(9,1),expectedRevision:1},
    ]) await deny(input,'invalid_request')
    for(const intent of ['bootstrap','recover','reset_totp','invite','transfer','mint','burn','settle','approve_order','create_fund','create_realestate','open_account','approve_kyc','approve_aml','move_cash','withdraw','deposit','pay','custody','sign','grant_owner','link_wallet','verify_entity','update_entity','delete_person','ban_user','delete_factor','remove_signer','refresh_grant','override_hold']) await deny({intent},'invalid_request')
    await admin(); await check('select count(*)::int from bx1_private.administration_commands',0,'invalid commands never persisted')
    const p=await propose('ENTITY_DRAFT_CREATE',{...entityPayload,displayName:'\u00a0 Synthetic entity \u00a0'},1,{privateEntry:true})
    const view=await read({selected:p.proposalId}); equal(view.selectedProposal.payload.displayName,'Synthetic entity','SQL owns normalized intent')
  })
  await test('immutable-principal-payload-scope-snapshot-and-audit',async()=>{
    const p=await propose(); await admin()
    await rejected('update bx1_private.person_principals set person_id=$1 where auth_user_id=$2',[person(3),uid(2)],'principal cannot remap underlying person')
    const changes=[
      ['payload',"jsonb_set(payload,'{displayName}','\"Changed\"')"],['target_snapshot',"'{\"changed\":true}'::jsonb"],
      ['expected_scope_revision','2'],['expected_trust_revision','2'],['requester_principal_id',`'${uid(2)}'::uuid`],
      ['requester_person_id',`'${person(3)}'::uuid`],['expires_at',"expires_at+interval '1 hour'"],['policy_version','2'],
    ]
    for(const [column,value] of changes) await rejected(`update bx1_private.administration_commands set ${column}=${value} where id=$1`,[p.proposalId],`frozen ${column}`)
    await rejected('delete from bx1_private.administration_commands where id=$1',[p.proposalId],'command append-only')
    for(const table of ['administration_events','administration_requests']) {
      await rejected(`delete from bx1_private.${table}`,[],`${table} cannot delete`)
      await rejected(`update bx1_private.${table} set ${table==='administration_events'?"reason='routine'":"result='{}'::jsonb"}`,[],`${table} cannot modify`)
    }
    await state(p,'PENDING_REVIEW',['PROPOSED'])
  })
  await test('idempotent-replay-reordering-historical-fields-and-key-conflict',async()=>{
    const key=id(9,requestSequence++), input={intent:'propose',kind:'ENTITY_DRAFT_CREATE',payload:entityPayload,expectedScopeRevision:'1'}
    const original=await command(input,{key}); truth(original.ok,'first accepted')
    const reordered={expectedScopeRevision:'1',payload:{registrationReference:null,jurisdictionCode:null,kind:'OTHER',displayName:'Synthetic entity'},kind:'ENTITY_DRAFT_CREATE',intent:'propose'}
    equal(await command(reordered,{key}),{...original,replayed:true},'JSON key ordering does not change normalized intent')
    await deny({...input,payload:{...entityPayload,displayName:'Different'}},'conflict',{key})
    const a=await review(original), applyKey=id(9,requestSequence++), applied=await apply(a,3,{key:applyKey})
    await apply(await review(await propose()))
    equal(await command(input,{key}),{...original,replayed:true},'old proposal replay preserves historical state/revision/scope')
    equal(await command({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},{n:3,key:applyKey}),{...applied,replayed:true},'old apply replay preserves original scope revision')
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'conflict',{n:3})
    await admin(); await check('select count(*)::int from bx1_private.legal_parties',2,'no replay duplicated domain effect')
    await check('select count(*)::int from bx1_private.administration_events where command_id=$1',3,'no replay duplicated audit',[a.proposalId])
    await check('select count(*)::int from bx1_private.administration_requests where command_id=$1',3,'no duplicate receipts',[a.proposalId])
  })
  for(const stale of ['scope','trust','target','requester','reviewer']) await test(`stale-${stale}-terminalization-and-replay`,async()=>{
    const kind=stale==='target'?'MEMBERSHIP_REVOKE':'ENTITY_DRAFT_CREATE'
    const target=await member(), payload=stale==='target'?{membershipId:target,reason:'routine'}:entityPayload
    const a=await review(await propose(kind,payload)); await admin()
    if(stale==='scope') await db.exec('update bx1_private.authority_scopes set revision=revision+1')
    if(stale==='trust') await db.exec('update bx1_private.authority_root set trust_revision=trust_revision+1')
    if(stale==='target') await db.query("update public.bx1_memberships set status='SUSPENDED' where id=$1",[target])
    if(stale==='requester') await db.query("update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where id=$1",[id(8,1)])
    if(stale==='reviewer') await db.query("update bx1_private.governance_grants set status='REVOKED',revision=revision+1 where id=$1",[id(8,2)])
    const n=stale==='reviewer'?1:3, key=id(9,requestSequence++), input={intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision}
    await deny(input,'conflict',{n,key}); await state(a,'INVALIDATED',['PROPOSED','APPROVED','INVALIDATED'])
    await check('select count(*)::int from bx1_private.legal_parties',0,'stale command no entity effect')
    await check('select count(*)::int from bx1_private.administration_requests where command_id=$1',3,'safe terminal failure has receipt',[a.proposalId])
    await deny(input,'conflict',{n,key}); await state(a,'INVALIDATED',['PROPOSED','APPROVED','INVALIDATED'])
  })
  await test('expiry-persists-safe-result-without-domain-effect',async()=>{
    const template=await propose(); await admin()
    const expired=id(9,requestSequence++)
    await db.query(`insert into bx1_private.administration_commands(id,organisation_id,request_key,kind,payload,payload_hash,target_snapshot,requester_principal_id,requester_person_id,expected_scope_revision,expected_trust_revision,created_at,expires_at)
      select $1,organisation_id,$2,kind,payload,payload_hash,target_snapshot,requester_principal_id,requester_person_id,expected_scope_revision,expected_trust_revision,now()-interval '25 hours',now()-interval '1 hour' from bx1_private.administration_commands where id=$3`,[expired,id(9,requestSequence++),template.proposalId])
    const input={intent:'review',proposalId:expired,expectedRevision:'1',decision:'approve'},key=id(9,requestSequence++)
    await deny(input,'expired',{n:3,key}); await state({proposalId:expired},'EXPIRED',['EXPIRED'])
    await check('select count(*)::int from bx1_private.administration_requests where command_id=$1',1,'expired denial persisted receipt',[expired])
    await deny(input,'expired',{n:3,key}); await state({proposalId:expired},'EXPIRED',['EXPIRED'])
    await check('select count(*)::int from bx1_private.legal_parties',0,'expiry no domain effect')
  })
  for(const kind of ['ENTITY_DRAFT_CREATE','MEMBERSHIP_GRANT','GOVERNANCE_GRANT']) await test(`audit-failure-rolls-back-${kind}`,async()=>{
    const payload=kind==='ENTITY_DRAFT_CREATE'?entityPayload:kind==='MEMBERSHIP_GRANT'?{principalId:uid(5),role:'SuperAdmin'}:{personId:person(4),validUntil:new Date(Date.now()+86400000).toISOString()}
    const a=await review(await propose(kind,payload)), key=id(9,requestSequence++); await admin()
    await db.exec("create function bx1_private.fixture_fail_audit() returns trigger language plpgsql set search_path='' as $$ begin raise exception using errcode='P0001',message='synthetic audit failure'; end $$; create trigger fixture_fail_audit before insert on bx1_private.administration_events for each row execute function bx1_private.fixture_fail_audit()")
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'unavailable',{n:3,key})
    await state(a,'APPROVED',['PROPOSED','APPROVED']); equal(await revision(),'1','scope bump rolled back')
    await check('select count(*)::int from bx1_private.administration_requests where request_key=$1',0,'receipt rolled back',[key])
    await check('select count(*)::int from bx1_private.legal_parties',0,'entity rolled back')
    await check("select count(*)::int from public.bx1_memberships where user_id=$1 and role='SuperAdmin'",0,'membership rolled back',[uid(5)])
    await check('select count(*)::int from bx1_private.governance_grants where person_id=$1',0,'grant rolled back',[person(4)])
    await db.exec('drop trigger fixture_fail_audit on bx1_private.administration_events; drop function bx1_private.fixture_fail_audit()')
    await apply(a,3,{key}); await state(a,'APPLIED',['PROPOSED','APPROVED','APPLIED'])
  })
  await test('full-person-scope-effect-exceeds-display-caps',async()=>{
    await extraPrincipals(20,79)
    const before=await read(), targetView=before.people.find(p=>p.id===person(4))
    equal(targetView.principals.length,10,'directory caps principals only'); equal(targetView.principalsTruncated,true,'directory admits incomplete display')
    const p=await propose('PERSON_SCOPE_REVOKE',{personId:person(4),reason:'routine'})
    await admin(); await check('select octet_length(target_snapshot::text)<=4096 from bx1_private.administration_commands where id=$1',true,'bounded snapshot covers full target',[p.proposalId])
    await apply(await review(p)); await admin()
    await check("select count(*)::int from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=$1 and m.organisation_id=$2 and m.status='SUSPENDED'",62,'ALL principals beyond10 and rows beyond50 suspended',[person(4),org(1)])
    await check("select count(*)::int from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=$1 and m.organisation_id=$2 and m.status='ACTIVE'",62,'ALL foreign memberships preserved',[person(4),org(2)])
  })
  for(const change of ['changed-tail','new-tail']) await test(`snapshot-invalidates-${change}-beyond-display-caps`,async()=>{
    await extraPrincipals(20,79)
    const a=await review(await propose('PERSON_SCOPE_REVOKE',{personId:person(4),reason:'routine'})); await admin()
    if(change==='changed-tail') await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and organisation_id=$2",[uid(79),org(1)])
    else await extraPrincipals(80,80)
    await deny({intent:'apply',proposalId:a.proposalId,expectedRevision:a.revision},'conflict',{n:3})
    await state(a,'INVALIDATED',['PROPOSED','APPROVED','INVALIDATED'])
    await check("select count(*)::int from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=$1 and m.organisation_id=$2 and m.status='ACTIVE'",change==='changed-tail'?61:63,'stale command does not revoke remaining target rows',[person(4),org(1)])
    await check("select count(*)::int from public.bx1_memberships m join bx1_private.person_principals pp on pp.auth_user_id=m.user_id where pp.person_id=$1 and m.organisation_id=$2 and m.status='ACTIVE'",change==='changed-tail'?62:63,'foreign scope unaffected',[person(4),org(2)])
  })
  await test('snapshot-digest-timezone-independent',async()=>{
    const payload={grantId:id(8,1),reason:'security'}
    await db.exec("set local timezone='UTC'")
    const utc=await scalar('select bx1_private.administration_target_snapshot($1,$2::jsonb,$3)',['GOVERNANCE_REVOKE',JSON.stringify(payload),org(1)])
    await db.exec("set local timezone='America/New_York'")
    equal(await scalar('select bx1_private.administration_target_snapshot($1,$2::jsonb,$3)',['GOVERNANCE_REVOKE',JSON.stringify(payload),org(1)]),utc,'same target digest across timezone settings')
    await db.exec("set local timezone='UTC'")
    const a=await review(await propose('GOVERNANCE_REVOKE',payload)); await admin()
    await db.exec("set local timezone='Pacific/Auckland'")
    await apply(a,3)
  })
  for(const kind of ['MEMBERSHIP_REVOKE','GOVERNANCE_REVOKE','PERSON_SCOPE_REVOKE']) await test(`cleanup-ineligible-recipient-${kind}`,async()=>{
    await governor(4)
    await db.query("update bx1_private.persons set status='REVOKED' where id=$1",[person(4)])
    await db.query("update bx1_private.person_principals set status='REVOKED' where person_id=$1",[person(4)])
    await db.query("update public.bx1_profiles set status='SUSPENDED' where id=any($1::uuid[])",[[uid(5),uid(8)]])
    const target=await member(), payload=kind==='MEMBERSHIP_REVOKE'?{membershipId:target,reason:'routine'}:kind==='GOVERNANCE_REVOKE'?{grantId:id(8,4),reason:'routine'}:{personId:person(4),reason:'routine'}
    await apply(await review(await propose(kind,payload))); await admin()
    if(kind!=='GOVERNANCE_REVOKE') await check('select status from public.bx1_memberships where id=$1','SUSPENDED','known active access cleaned despite ineligible recipient',[target])
    if(kind!=='MEMBERSHIP_REVOKE') await check('select status from bx1_private.governance_grants where id=$1','REVOKED','known active grant cleaned despite ineligible recipient',[id(8,4)])
    if(kind==='PERSON_SCOPE_REVOKE') await check("select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[]) and organisation_id=$2 and status='ACTIVE'",0,'revoked mappings still included in full reduction',[[uid(5),uid(8)],org(1)])
    await check("select count(*)::int from public.bx1_memberships where user_id=any($1::uuid[]) and organisation_id=$2 and status='ACTIVE'",2,'cleanup preserves other org access records',[[uid(5),uid(8)],org(2)])
    await check('select count(*)::int from auth.users',8,'cleanup does not mutate Auth users'); await check('select count(*)::int from auth.mfa_factors',8,'cleanup does not mutate factors')
  })
  await test('cleanup-no-affected-or-foreign-target-denied',async()=>{
    await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=any($1::uuid[]) and organisation_id=$2",[[uid(5),uid(8)],org(1)])
    for(const target of [person(4),person(5),person(999)])
      await deny({intent:'propose',kind:'PERSON_SCOPE_REVOKE',payload:{personId:target,reason:'security'},expectedScopeRevision:'1'},'conflict')
    await admin(); await check('select count(*)::int from bx1_private.administration_commands',0,'no affected target gives no command')
    await check('select count(*)::int from bx1_private.administration_events',0,'no affected target gives no event')
    await check('select count(*)::int from bx1_private.administration_requests',0,'no affected target gives no receipt')
  })
  await test('safe-read-at-and-over-every-bound-and-bigint-losslessness',async()=>{
    const p=await propose(); await admin()
    await extraPrincipals(20,27,1) // A: two original + eight = ten principals.
    async function people(start,end) {
      await db.query(`insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic bounded person '||n,'TRUSTED','synthetic-bounded',$3 from generate_series($1::int,$2::int) n`,[start,end,id(7,1)])
      for(let n=start;n<=end;n++) await extraPrincipals(n,n,n)
    }
    async function commands(start,end) {
      await db.query(`insert into bx1_private.administration_commands(id,organisation_id,request_key,kind,payload,payload_hash,target_snapshot,requester_principal_id,requester_person_id,expected_scope_revision,expected_trust_revision,created_at,expires_at)
        select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,organisation_id,('90000000-0000-4000-8000-'||lpad((n+10000)::text,12,'0'))::uuid,kind,payload,payload_hash,target_snapshot,requester_principal_id,requester_person_id,expected_scope_revision,expected_trust_revision,created_at+interval '1 second',expires_at+interval '1 second' from bx1_private.administration_commands cross join generate_series($1::int,$2::int) n where id=$3`,[start,end,p.proposalId])
    }
    async function entities() {
      await db.query(`insert into bx1_private.legal_parties(id,organisation_id,display_name,kind,created_command_id) select id,organisation_id,'Synthetic bounded entity','OTHER',id from bx1_private.administration_commands c where not exists(select 1 from bx1_private.legal_parties l where l.created_command_id=c.id)`)
      await db.exec(`insert into bx1_private.workspace_parties(organisation_id,party_id,created_command_id) select organisation_id,id,created_command_id from bx1_private.legal_parties l where not exists(select 1 from bx1_private.workspace_parties w where w.party_id=l.id)`)
    }
    async function grants(start,end) {
      await db.query(`insert into bx1_private.governance_grants(id,organisation_id,person_id,status,valid_from,valid_until,bootstrap_receipt_id) select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$3,$4,'REVOKED',now()-interval '2 days',now()-interval '1 day',$5 from generate_series($1::int,$2::int) n`,[start,end,org(1),person(1),id(7,1)])
    }
    async function events(start,end) {
      await db.query(`insert into bx1_private.administration_events(id,command_id,organisation_id,actor_principal_id,actor_person_id,event_type,after_revision,after_state,payload_hash)
        select ('70000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,id,organisation_id,requester_principal_id,requester_person_id,'PROPOSED',revision,state,payload_hash from bx1_private.administration_commands cross join generate_series($1::int,$2::int) n where id=$3`,[start,end,p.proposalId])
    }
    await people(100,145) // Four existing same-org people +46 =50.
    await commands(20000,20048); await entities() // One original +49 =50.
    await grants(100,147) // Two original +48 =50.
    await db.exec('alter sequence bx1_private.administration_events_event_sequence_seq restart with 9007199254740993')
    await events(100,198) // One original +99 =100.
    await db.query("insert into bx1_private.administration_events(organisation_id,event_type,evidence_reference) values($1,'BOOTSTRAP','synthetic-bootstrap-never-in-read')",[org(1)])
    const at=await read({selected:p.proposalId})
    equal([at.people.length,at.entities.length,at.proposals.length,at.governanceGrants.length,at.selectedProposal.events.length],[50,50,50,50,100],'exact maximum records retained')
    equal(at.truncated,{people:false,entities:false,proposals:false},'exact bound is not truncated'); equal(at.grantsTruncated,false,'exact grant bound'); equal(at.selectedProposal.historyTruncated,false,'exact event bound')
    equal(at.people.find(v=>v.id===person(1)).principalsTruncated,false,'exact principal bound')
    truth(at.selectedProposal.events.some(e=>BigInt(e.sequence)>9007199254740992n),'large event sequence strings exact')
    truth(!JSON.stringify(at).includes('synthetic-bootstrap-never-in-read'),'bootstrap evidence not projected')
    await admin(); await people(146,146); await commands(20049,20049); await entities(); await grants(148,148); await events(199,199); await extraPrincipals(28,28,1)
    const over=await read({selected:p.proposalId})
    equal([over.people.length,over.entities.length,over.proposals.length,over.governanceGrants.length,over.selectedProposal.events.length],[50,50,50,50,100],'strict truncation preserves bounded unique records')
    equal(over.truncated,{people:true,entities:true,proposals:true},'all over-bound list flags true'); equal(over.grantsTruncated,true,'grant truncation'); equal(over.selectedProposal.historyTruncated,true,'audit truncation')
    equal(over.people.find(v=>v.id===person(1)).principals.length,10,'nested principal cap'); equal(over.people.find(v=>v.id===person(1)).principalsTruncated,true,'nested overflow flag')
    truth(!over.proposals.some(v=>v.id===p.proposalId),'selected command is outside newest50'); equal(over.selectedProposal.id,p.proposalId,'known selected detail resolved independently of list truncation')
  })
}

try {
  const transpile=text=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ES2022}}).outputText
  const dataUrl=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64')
  const sharedUrl=dataUrl(transpile(await source('../src/lib/supabase/contracts.ts')))
  const contractCode=transpile(await source('../src/lib/administration/contracts.ts'))
  truth(contractCode.includes("from '../supabase/contracts'"),'known contract dependency for in-memory parser import')
  ;({parseAdminResult,parseAdminReadProjection}=await import(dataUrl(contractCode.replace("from '../supabase/contracts'",`from '${sharedUrl}'`))))
  await db.exec('begin'); begun=true
  const fixtureOwner=await scalar('select current_user::text')
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
  await sqlFile('../../../supabase/migrations/20260918015541_bx1_mfa_assurance.sql')
  const definitionSql="select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='bx1_private'::regnamespace and proname in ('has_active_session','can_access_organisation','read_mfa_status','read_wallet_challenge','issue_wallet_challenge','consume_wallet_challenge') order by 1"
  const definitions={sql:definitionSql,rows:(await db.query(definitionSql)).rows}
  const defaults=(await db.query('select * from pg_default_acl order by oid')).rows
  await sqlFile('../../../supabase/migrations/20260918234447_bx1_controlled_administration.sql')
  await admin(); await schemaMatrix(fixtureOwner,definitions,defaults)
  console.log(`BX1_ADMINISTRATION_SCHEMA_PASS assertions=${checks} migrations=4 non-superuser-migration`)
  const fixture=(await source('../../../supabase/tests/bx1_controlled_administration.sql')).split('-- ADMINISTRATION_TRUST_FIXTURE')
  equal(fixture.length,2,'ordinary identity and trusted governance fixture stages separated')
  await db.exec(fixture[0])
  const baselineStart=checks, baselineFailures=failures
  await upgradeMatrix()
  if(failures===baselineFailures) console.log(`BX1_ADMINISTRATION_UPGRADE_BASELINE_PASS assertions=${checks-baselineStart} sameDatabase=true beforeGovernanceFixtures=true`)
  await admin(); await db.exec(fixture[1])
  await check('select count(distinct person_id)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])',1,'two accounts one human',[[uid(1),uid(2)]])
  await check('select count(distinct person_id)::int from bx1_private.governance_grants',2,'exactly two underlying governors')
  await administrationMatrix()
  await admin(); await db.exec('rollback'); begun=false
  await check("select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')",0,'all synthetic state rolled back')
  if(failures) {console.error(`BX1_ADMINISTRATION_SQL_RED assertions=${checks} cases=${cases} failures=${failures} cleanup=rolled-back`); process.exitCode=1}
  else {
    truth(cases>30,'state matrix must run, not an empty/fixed-count pass')
    console.log(`BX1_ADMINISTRATION_SQL_PASS assertions=${checks} cases=${cases} cleanup=rolled-back fixture=synthetic-in-memory concurrency=not-proven GoTrue=not-proven`)
  }
} catch(error) {
  console.error(`BX1_ADMINISTRATION_SQL_FAILED assertions=${checks} code=${typeof error?.code==='string'?error.code:'assertion'} check=${error?.name==='AssertionError'?error.message.split('\n')[0]:'fixture operation'}`)
  process.exitCode=1
} finally {
  if(begun) await db.exec('rollback')
  await db.close()
}
