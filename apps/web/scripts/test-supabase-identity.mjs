import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// No DSN/network is accepted. Claims are synthetic; this does not prove GoTrue.
if (process.argv.length !== 2) throw new Error('This in-memory test accepts no connection arguments')
const db = new PGlite()
let checks = 0
const uid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const org = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const roles = ['Investor','OfferingManager','ComplianceOfficer','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin']
const tables = ['bx1_profiles','bx1_organisations','bx1_memberships']
async function equal(sql, expected, label) {
  const { rows } = await db.query(sql)
  assert.equal(Number(Object.values(rows[0])[0]), expected, label)
  checks++
}
async function denied(sql, label, code = '42501') {
  await db.exec('savepoint negative_case')
  let caught
  try { await db.exec(sql) } catch (error) { caught = error }
  await db.exec('rollback to savepoint negative_case; release savepoint negative_case')
  assert.equal(caught?.code, code, label)
  checks++
}
async function actor(user = 1, session = sid(user), extra = {}) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:uid(user),role:'authenticated',session_id:session,...extra})])
  await db.exec('set local role authenticated')
}
async function visible(profile, organisations, memberships, label) {
  await equal('select count(*) from public.bx1_profiles',profile,`${label}: profile`)
  await equal('select count(*) from public.bx1_organisations',organisations,`${label}: organisations`)
  await equal('select count(*) from public.bx1_memberships',memberships,`${label}: memberships`)
}
let begun = false
try {
  const version = Number((await db.query('show server_version_num')).rows[0].server_version_num)
  assert(version >= 170000 && version < 180000, `Expected PostgreSQL17, got ${version}`)
  checks++
  await db.exec('begin'); begun = true
  await db.exec(await readFile(new URL('../../../supabase/tests/bx1_identity_workspace.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql', import.meta.url), 'utf8'))
  for (let user = 1; user <= 3; user++) {
    await db.query('insert into auth.users(id) values ($1)',[uid(user)])
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)',[sid(user),uid(user)])
    await db.query('insert into public.bx1_profiles(id,display_name) values ($1,$2)',[uid(user),`Fixture ${user}`])
  }
  for (let tenant=1;tenant<=2;tenant++) await db.query('insert into public.bx1_organisations(id,name) values($1,$2)',[org(tenant),`Fixture tenant ${tenant}`])
  for (const role of roles) await db.query('insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,$3)',[uid(1),org(1),role])
  await db.query('insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,$3)',[uid(2),org(2),'SuperAdmin'])
  for (const table of tables) {
    await equal(`select relrowsecurity::int from pg_class where oid='public.${table}'::regclass`,1,`${table} RLS`)
    for (const role of ['anon','authenticated','service_role']) {
      await equal(`select has_table_privilege('${role}','public.${table}','SELECT')::int`,role==='authenticated'?1:0,`${role} ${table} read grant`)
      for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
        await equal(`select has_table_privilege('${role}','public.${table}','${privilege}')::int`,0,`${role} ${table} ${privilege}`)
    }
  }
  await actor()
  await visible(1,1,9,'own active identity')
  await equal(`select count(*) from public.bx1_profiles where id='${uid(2)}'`,0,'cannot choose another actor')
  await equal(`select count(*) from public.bx1_organisations where id='${org(2)}'`,0,'cannot choose another tenant')
  await denied('select * from auth.sessions','no raw Auth-session access')
  await denied('select * from auth.users','no raw Auth-user access')
  for (const table of tables) {
    await denied(`insert into public.${table} default values`,`${table} insert`)
    await denied(`update public.${table} set status='SUSPENDED'`,`${table} update`)
    await denied(`delete from public.${table}`,`${table} delete`)
    await denied(`truncate public.${table}`,`${table} truncate`)
  }
  await actor(2)
  await visible(1,1,1,'second tenant SuperAdmin cannot bypass isolation')
  await actor(3)
  await visible(1,0,0,'no assignment grants no workspace')
  await actor(1,sid(1),{user_metadata:{role:'SuperAdmin',organisation_id:org(2)},app_metadata:{role:'SuperAdmin'}})
  await visible(1,1,9,'metadata cannot widen database assignments')
  await actor(1,sid(2)); await visible(0,0,0,'other user session')
  await actor(1,null); await visible(0,0,0,'missing session')
  await actor(1,'invalid-uuid'); await visible(0,0,0,'malformed session')
  await actor(1,sid(9)); await visible(0,0,0,'nonexistent session')
  // Every role is independently allowed to read only its own active membership.
  for (const role of roles) {
    await db.exec('reset role')
    await db.query("update public.bx1_memberships set status=case when role=$1 then 'ACTIVE' else 'SUSPENDED' end where user_id=$2",[role,uid(1)])
    await actor(); await visible(1,1,1,`${role} least privilege`)
  }
  await db.exec("reset role; update public.bx1_memberships set status='ACTIVE'")
  for (const [table,condition] of [['bx1_profiles',`id='${uid(1)}'`],['bx1_organisations',`id='${org(1)}'`],['bx1_memberships',`user_id='${uid(1)}'`]]) {
    await db.exec(`reset role; update public.${table} set status='SUSPENDED' where ${condition}`)
    await actor(); await visible(table==='bx1_profiles'?0:1,0,0,`${table} suspension`)
    await db.exec(`reset role; update public.${table} set status='ACTIVE' where ${condition}`)
  }
  for (const [table,field,value] of [['auth.users','banned_until',"now()+interval '1 day'"],['auth.users','deleted_at','now()'],['auth.sessions','not_after',"now()-interval '1 second'"],['auth.sessions','oauth_client_id',`'${uid(9)}'::uuid`]]) {
    const id = table==='auth.users'?uid(1):sid(1)
    await db.exec(`reset role; update ${table} set ${field}=${value} where id='${id}'`)
    await actor(); await visible(0,0,0,`${field} denies`)
    await db.exec(`reset role; update ${table} set ${field}=null where id='${id}'`)
  }
  await actor(); await visible(1,1,9,'positive before session revocation')
  await db.exec(`reset role; delete from auth.sessions where id='${sid(1)}'`)
  await actor(); await visible(0,0,0,'same claims after session revocation')
  await db.exec('reset role')
  await denied(`update public.bx1_profiles set platform_user_id=pg_catalog.gen_random_uuid() where id='${uid(1)}'`,'immutable platform actor','23514')
  await denied(`update public.bx1_profiles set id='${uid(9)}' where id='${uid(1)}'`,'immutable Auth mapping','23514')
  await db.exec('set local role anon')
  for(const table of tables) await denied(`select * from public.${table}`,`anon ${table} denied`)
  await denied('select bx1_private.has_active_session()','anon cannot invoke private predicate')
  await db.exec('reset role')
  await equal("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='bx1_private' and p.prosecdef and p.proconfig @> array['search_path=\"\"']",2,'definer helpers have fixed empty search path')
  await db.exec('rollback'); begun = false
  await equal("select count(*) from pg_namespace where nspname in ('auth','bx1_private')",0,'fixture and migration rolled back')
  assert(checks>100,'No vacuous matrix')
  console.log(`BX1_IDENTITY_RLS_PASS assertions=${checks} postgres=${version} fixture=synthetic-in-memory no-GoTrue-proof`)
} finally {
  if (begun) await db.exec('rollback')
  await db.close()
}
