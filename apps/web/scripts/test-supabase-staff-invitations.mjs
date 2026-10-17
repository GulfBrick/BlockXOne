import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// Synthetic SQL fixture only. Cloud mode is restricted to the disposable
// GitHub Actions PostgreSQL 17 service, never a Supabase project or DSN.
if (process.argv.length !== 2) throw new Error('No external connection arguments accepted')
const cloud = process.env.BX1_STAFF_INVITE_CLOUD === 'github-postgres17'
let db
if (cloud) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'GulfBrick/BlockXOne'
    || process.env.BX1_CI_POSTGRES_PASSWORD !== 'bx1-synthetic-ci-only') throw new Error('Cloud PostgreSQL fixture is CI-only')
  const { default: pg } = await import('pg')
  const client = new pg.Client({ host:'127.0.0.1', port:5432, database:'bx1_demo_ci', user:'postgres',
    password:'bx1-synthetic-ci-only', ssl:false, connectionTimeoutMillis:5000 })
  await client.connect()
  const server = (await client.query('show server_version_num')).rows[0].server_version_num
  if (Number(server)<170000 || Number(server)>=180000) { await client.end(); throw new Error('Expected disposable PostgreSQL 17') }
  db = { query:(sql,params)=>client.query(sql,params), exec:sql=>client.query(sql), close:()=>client.end() }
} else {
  if (process.env.BX1_STAFF_INVITE_CLOUD) throw new Error('Unsupported SQL fixture mode')
  const { PGlite } = await import('@electric-sql/pglite')
  db = new PGlite()
}
const source = path => readFile(new URL(path, import.meta.url), 'utf8')
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const fid = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const org = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const key = n => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
let begun = false
async function scalar(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0] }
async function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
async function file(path) { await db.exec(await source(path)) }
async function owner() { await db.exec('reset role') }
async function actor(n, aal = 'aal2', age = 0) {
  await owner()
  const now = Number(await scalar('select floor(extract(epoch from clock_timestamp()))::text'))
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
    sub: uid(n), role: 'authenticated', session_id: sid(n), exp: now + 3600, aal,
    amr: [{ method: 'totp', timestamp: now - age }],
  })])
  await db.exec('set local role authenticated')
}
async function command(n, tenant, request, body, aal = 'aal2') {
  await actor(n, aal)
  return scalar('select public.bx1_staff_invitation_command($1,$2,$3::jsonb)', [org(tenant), key(request), JSON.stringify(body)])
}
async function read(n, tenant) {
  await actor(n)
  return scalar('select public.bx1_staff_invitation_read($1)', [org(tenant)])
}
async function serviceAck(invitationId, leaseId, authUserId, delivered = true) {
  await owner()
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })])
  await db.exec('set local role service_role')
  return scalar('select public.bx1_staff_invitation_dispatch_result($1,$2,$3,$4)',
    [invitationId, leaseId, authUserId, delivered])
}
async function isolated(name, run) {
  await owner()
  await db.exec('savepoint staff_invitation_case')
  try { await run() }
  catch (error) {
    console.error('STAFF_INVITE_CAUSE', error?.code ?? 'unknown', error?.message?.slice(0, 500) ?? 'unknown')
    await db.exec('rollback to savepoint staff_invitation_case; release savepoint staff_invitation_case')
    throw new Error(`${name}: ${error?.message ?? 'failed'}`, { cause: error })
  }
  await owner(); await db.exec('rollback to savepoint staff_invitation_case; release savepoint staff_invitation_case')
}
async function approvedInvite() {
  const proposed = await command(1, 1, 1, { intent: 'propose', email: 'new.staff@example.invalid', role: 'ComplianceOfficer', expectedScopeRevision: '1' })
  await eq(proposed.ok, true, `independent-governed proposal created ${JSON.stringify(proposed)}`)
  const reviewed = await command(3, 1, 2, { intent: 'approve', invitationId: proposed.invitationId, expectedRevision: proposed.revision })
  await eq(reviewed.state, 'APPROVED', 'different person reviewed')
  const applied = await command(1, 1, 3, { intent: 'apply', invitationId: proposed.invitationId, expectedRevision: reviewed.revision })
  await eq(applied.state, 'QUEUED', 'apply creates send outbox, not a role')
  await owner()
  await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(9)]), 0, 'queued invitation grants no role')
  return applied
}
try {
  await db.exec('begin'); begun = true
  await file('../../../supabase/tests/bx1_identity_workspace.sql')
  await file('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.exec(`alter table auth.users add column email text, add column email_confirmed_at timestamptz,
    add column invited_at timestamptz, add column confirmation_sent_at timestamptz,
    add column raw_user_meta_data jsonb default '{}'::jsonb,
    add column raw_app_meta_data jsonb default '{}'::jsonb,
    add column is_anonymous boolean default false;
    alter table auth.users enable row level security; alter table auth.sessions enable row level security;`)
  await file('../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql')
  await db.exec(`create role bx1_fixture_migrator nologin noinherit nosuperuser createdb createrole bypassrls;
    grant usage,create on schema public to bx1_fixture_migrator with grant option;
    grant usage on schema auth to bx1_fixture_migrator;
    grant select on auth.users,auth.sessions,auth.mfa_factors to bx1_fixture_migrator;
    grant references on auth.users to bx1_fixture_migrator;
    alter schema bx1_private owner to bx1_fixture_migrator;
    alter table public.bx1_profiles owner to bx1_fixture_migrator;
    alter table public.bx1_organisations owner to bx1_fixture_migrator;
    alter table public.bx1_memberships owner to bx1_fixture_migrator;
    alter function bx1_private.has_active_session() owner to bx1_fixture_migrator;
    alter function bx1_private.can_access_organisation(uuid) owner to bx1_fixture_migrator;
    set local role bx1_fixture_migrator;`)
  await file('../../../supabase/migrations/20260917190042_bx1_wallet_ownership.sql')
  await file('../../../supabase/migrations/20260918015541_bx1_mfa_assurance.sql')
  await file('../../../supabase/migrations/20260918234447_bx1_controlled_administration.sql')
  await owner()
  // Apply the new DDL as a non-superuser, as in the hosted-like MAIN fixture.
  await db.exec('set local role bx1_fixture_migrator')
  await file('../../../supabase/migrations/20260924110911_stage1_staff_invitation_intents.sql')
  await eq(await scalar("select has_table_privilege(current_user,'bx1_private.authority_scopes','REFERENCES')"),
    false, 'migration role retains no REFERENCES on the isolated authority scope')
  assert.ok(await scalar("select count(*)::int from pg_auth_members where member=(select oid from pg_roles where rolname=current_user) and roleid=(select oid from pg_roles where rolname='bx1_authority_owner')")>=1,
    'isolated owner membership remains recorded'); checks++
  await eq(await scalar("select count(*)::int from pg_auth_members where member=(select oid from pg_roles where rolname=current_user) and roleid=(select oid from pg_roles where rolname='bx1_authority_owner') and (inherit_option or set_option)"),
    0, 'every owner membership has INHERIT and SET disabled after migration')
  await owner()
  await eq(await scalar("select relrowsecurity from pg_class where oid='bx1_private.staff_invitation_intents'::regclass"), true, 'private invitation table has RLS')
  await eq(await scalar("select has_table_privilege('authenticated','bx1_private.staff_invitation_intents','INSERT')"), false, 'no direct invitation insert')
  await eq(await scalar("select has_function_privilege('authenticated','public.bx1_staff_invitation_dispatch_result(uuid,uuid,uuid,boolean)','EXECUTE')"), false, 'only service can acknowledge')
  await eq(await scalar("select pg_get_userbyid(relowner) from pg_class where oid='bx1_private.staff_invitation_intents'::regclass"),
    'bx1_authority_owner', 'invitation state is owned by isolated non-login authority role')
  await eq(await scalar("select pg_get_userbyid(proowner) from pg_proc where oid='bx1_private.staff_invitation_command(uuid,uuid,jsonb)'::regprocedure"),
    'bx1_authority_owner', 'guarded command runs with isolated authority role')
  await eq(await scalar("select has_function_privilege('authenticated','bx1_private.staff_invitation_auth_self(boolean)','EXECUTE')"),
    false, 'private Auth evidence helper is not client-callable')
  console.log(`BX1_STAFF_INVITATION_SCHEMA_PASS assertions=${checks}`)
  const fixture = (await source('../../../supabase/tests/bx1_controlled_administration.sql')).split('-- ADMINISTRATION_TRUST_FIXTURE')
  await db.exec(fixture[0]); await db.exec(fixture[1])
  await db.exec("update auth.users set email=case id when '10000000-0000-4000-8000-000000000001' then 'governor.one@example.invalid' when '10000000-0000-4000-8000-000000000003' then 'governor.two@example.invalid' else 'fixture@example.invalid' end, email_confirmed_at=now()")
  await isolated('governed first-time invite and MFA-only acceptance', async () => {
    const applied = await approvedInvite()
    const reused = await command(1, 1, 3, { intent: 'apply', invitationId: applied.invitationId, expectedRevision: '2' })
    await eq(reused.replayed, true, 'same request key returns recorded receipt')
    const forbiddenReview = await command(2, 1, 4, { intent: 'approve', invitationId: applied.invitationId, expectedRevision: '1' })
    await eq(forbiddenReview.ok, false, 'same human using second login cannot approve')
    const crossOrg = await read(4, 2)
    await eq(crossOrg.ok, false, 'other organisation cannot read invitation queue')
    await actor(3)
    const claim = await scalar('select public.bx1_staff_invitation_claim($1,$2)', [org(1), applied.invitationId])
    await eq(claim.ok, true, 'authorised delivery claim')
    await owner()
    await db.query('insert into auth.users(id,email,email_confirmed_at,invited_at,confirmation_sent_at,raw_app_meta_data) values($1,$2,null,clock_timestamp(),clock_timestamp(),$3::jsonb)',
      [uid(9), 'new.staff@example.invalid', JSON.stringify({bx1_staff_invitation_id:applied.invitationId,bx1_staff_lease_id:claim.leaseId})])
    await db.query('insert into auth.sessions(id,user_id,aal) values($1,$2,\'aal1\')', [sid(9), uid(9)])
    await db.query("select set_config('request.jwt.claims','{}',true)")
    await db.exec('set local role service_role')
    await eq((await scalar('select public.bx1_staff_invitation_dispatch_result($1,$2,$3,true)',
      [applied.invitationId, claim.leaseId, uid(9)])).error, 'forbidden',
    'missing service JWT claim cannot acknowledge delivery')
    const sent = await serviceAck(applied.invitationId, claim.leaseId, uid(9))
    await eq(sent.state, 'INVITED', 'service records exact Auth user after send')
    await actor(9, 'aal1')
    const beforeVerification = await scalar('select public.bx1_staff_invitation_begin()')
    await eq(beforeVerification.ok, false, 'unconfirmed email cannot bind')
    await owner()
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [uid(9)])
    await actor(9, 'aal1')
    const bound = await scalar('select public.bx1_staff_invitation_begin()')
    await eq(bound.state, 'MFA_PENDING', `confirmed exact email enters pre-role state ${JSON.stringify(bound)}`)
    const status = await scalar('select public.bx1_mfa_status()')
    await eq(status.active, true, 'pre-role invitee can enroll authenticator')
    await eq(await scalar('select bx1_private.can_access_organisation($1)', [org(1)]), false, 'pre-role invitee has no organisation access at AAL1')
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(9)]), 0, 'AAL1 has no staff membership')
    await eq((await scalar('select public.bx1_staff_invitation_accept($1)', [applied.invitationId])).ok, false, 'AAL1 cannot accept staff role')
    await owner()
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [fid(9), uid(9)])
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [fid(9), sid(9)])
    await actor(9, 'aal2')
    const accepted = await scalar('select public.bx1_staff_invitation_accept($1)', [applied.invitationId])
    await eq(accepted.state, 'ACCEPTED', 'verified TOTP activates one scoped role')
    await eq(await scalar('select bx1_private.can_access_organisation($1)', [org(1)]), true, 'accepted AAL2 staff can access exact organisation')
    await eq(await scalar('select bx1_private.can_access_organisation($1)', [org(2)]), false, 'accepted staff cannot cross organisation')
    await eq((await scalar('select public.bx1_staff_invitation_accept($1)', [applied.invitationId])).replayed, true, 'acceptance replay is idempotent')
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1 and organisation_id=$2', [uid(9), org(1)]), 1, 'replay created no duplicate membership')
    await owner()
    await db.query("update auth.sessions set aal='aal1',factor_id=null where id=$1",[sid(9)])
    await actor(9,'aal1')
    await eq(await scalar('select bx1_private.can_access_organisation($1)',[org(1)]),false,
      'subsequent AAL1 login cannot read staff organisation despite accepted membership')
    await eq((await scalar('select public.bx1_staff_invitation_read($1)',[org(1)])).ok,false,
      'subsequent AAL1 login cannot use administration command/read boundary')
  })
  await isolated('wrong Auth account and revocation', async () => {
    const applied = await approvedInvite()
    await actor(3)
    const claim = await scalar('select public.bx1_staff_invitation_claim($1,$2)', [org(1), applied.invitationId])
    await owner()
    await db.query('insert into auth.users(id,email,email_confirmed_at,invited_at,confirmation_sent_at,raw_app_meta_data) values($1,$2,now(),clock_timestamp(),clock_timestamp(),$3::jsonb)',
      [uid(9), 'wrong@example.invalid', JSON.stringify({bx1_staff_invitation_id:applied.invitationId,bx1_staff_lease_id:claim.leaseId})])
    await db.query("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')", [sid(9), uid(9)])
    await eq((await serviceAck(applied.invitationId, claim.leaseId, uid(9))).ok, false, 'wrong provider Auth email cannot mark invite sent')
    await actor(9, 'aal1')
    await eq((await scalar('select public.bx1_staff_invitation_begin()')).state, 'NONE', 'wrong-email user cannot bind')
    await owner()
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [uid(9)]), 0, 'wrong-email user has no membership')
  })
  await isolated('user-editable metadata is not invitation authority', async () => {
    const applied = await approvedInvite()
    await actor(3)
    const claim = await scalar('select public.bx1_staff_invitation_claim($1,$2)', [org(1), applied.invitationId])
    await owner()
    await db.query('insert into auth.users(id,email,invited_at,confirmation_sent_at,raw_user_meta_data) values($1,$2,clock_timestamp(),clock_timestamp(),$3::jsonb)',
      [uid(9), 'new.staff@example.invalid', JSON.stringify({bx1_staff_invitation_id:applied.invitationId,bx1_staff_lease_id:claim.leaseId})])
    await eq((await serviceAck(applied.invitationId,claim.leaseId,uid(9))).ok,false,
      'forged user_metadata cannot acknowledge an Auth invitation')
    await actor(1)
    await eq((await scalar('select public.bx1_staff_invitation_reconcile($1,$2)',
      [org(1),applied.invitationId])).error,'outcome_unknown',
    'forged user_metadata cannot reconcile a claimed provider send')
  })
  await isolated('revoked and expired invitations deny delivery and role', async () => {
    const applied = await approvedInvite()
    const cancelled = await command(1, 1, 8, { intent:'cancel', invitationId:applied.invitationId, expectedRevision:applied.revision })
    await eq(cancelled.state, 'CANCELLED', 'requester can revoke a queued invitation')
    await actor(3)
    await eq((await scalar('select public.bx1_staff_invitation_claim($1,$2)', [org(1),applied.invitationId])).ok,
      false, 'revoked invitation cannot be dispatched')
    await owner()
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1',[uid(9)]),0,
      'revocation cannot create membership')
  })
  await isolated('expired invitation denies provider claim', async () => {
    const applied = await approvedInvite()
    await owner()
    await db.query("update bx1_private.staff_invitation_intents set acceptance_expires_at=clock_timestamp()-interval '1 second' where id=$1",[applied.invitationId])
    await actor(3)
    await eq((await scalar('select public.bx1_staff_invitation_claim($1,$2)', [org(1),applied.invitationId])).ok,
      false, 'expired approval cannot send email')
  })
  await isolated('expired review closes with audit and releases first-time email', async () => {
    const proposed = await command(1,1,71,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    await eq(proposed.state,'PENDING_REVIEW','pending proposal occupies first-time email slot')
    await owner()
    await db.query("update bx1_private.staff_invitation_intents set created_at=statement_timestamp()-interval '25 hours',review_expires_at=statement_timestamp()-interval '1 hour' where id=$1",[proposed.invitationId])
    const directory = await read(1,1)
    await eq(directory.invitations.find(row=>row.id===proposed.invitationId).state,'EXPIRED',
      'expired projection is shown before durable close')
    const closed = await command(1,1,72,{intent:'cancel',invitationId:proposed.invitationId,expectedRevision:proposed.revision})
    await eq(closed.state,'EXPIRED','authorised requester records terminal expiry')
    await owner()
    await eq(await scalar('select state from bx1_private.staff_invitation_intents where id=$1',[proposed.invitationId]),'EXPIRED',
      'expiry releases the partial unique index')
    await eq(await scalar("select count(*)::int from bx1_private.staff_invitation_events where invitation_id=$1 and event_type='EXPIRED' and before_state='PENDING_REVIEW' and after_state='EXPIRED'",[proposed.invitationId]),1,
      'terminal expiry has one immutable event')
    const replacement = await command(1,1,73,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    await eq(replacement.ok,true,'fresh proposal of released email succeeds without a provider send')
    await owner()
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1',[uid(9)]),0,
      'closing and reproposing cannot grant a role')
  })
  await isolated('expired approved and queued entries auto-close under the proposal lock', async () => {
    const proposed = await command(1,1,74,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    const reviewed = await command(3,1,75,{intent:'approve',invitationId:proposed.invitationId,expectedRevision:proposed.revision})
    await owner()
    await db.query("update bx1_private.staff_invitation_intents set created_at=statement_timestamp()-interval '25 hours',review_expires_at=statement_timestamp()-interval '1 hour' where id=$1",[proposed.invitationId])
    const replacement = await command(1,1,76,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    await eq(replacement.ok,true,'new proposal atomically closes expired approval')
    await owner()
    await eq(await scalar("select count(*)::int from bx1_private.staff_invitation_events where invitation_id=$1 and event_type='EXPIRED' and before_state='APPROVED'",[reviewed.invitationId]),1,
      'approved expiry records original state')
    const reviewedAgain = await command(3,1,77,{intent:'approve',invitationId:replacement.invitationId,expectedRevision:replacement.revision})
    const applied = await command(1,1,78,{intent:'apply',invitationId:replacement.invitationId,expectedRevision:reviewedAgain.revision})
    await owner()
    await db.query("update bx1_private.staff_invitation_intents set acceptance_expires_at=clock_timestamp()-interval '1 second' where id=$1",[applied.invitationId])
    const afterQueueExpiry = await command(1,1,79,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    await eq(afterQueueExpiry.ok,true,'expired never-claimed queue releases email without dispatch')
    await owner()
    await eq(await scalar("select count(*)::int from bx1_private.staff_invitation_events where invitation_id=$1 and event_type='EXPIRED' and before_state='QUEUED'",[applied.invitationId]),1,
      'queued expiry records original state')
    await eq(await scalar('select state from bx1_private.staff_invitation_outbox where invitation_id=$1',[applied.invitationId]),'PENDING',
      'expired queue was never claimed by provider')
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1',[uid(9)]),0,
      'replacement proposal cannot grant a role')
  })
  await isolated('expired claimed send can close but cannot silently resend', async () => {
    const applied = await approvedInvite()
    await actor(3)
    const claim = await scalar('select public.bx1_staff_invitation_claim($1,$2)',[org(1),applied.invitationId])
    await eq(claim.ok,true,'provider delivery was claimed once')
    await owner()
    await db.query("update bx1_private.staff_invitation_intents set acceptance_expires_at=clock_timestamp()-interval '1 second' where id=$1",[applied.invitationId])
    const closed = await command(1,1,80,{intent:'cancel',invitationId:applied.invitationId,expectedRevision:'4'})
    await eq(closed.state,'EXPIRED','authorised close makes expired claimed send terminal')
    const replacement = await command(1,1,81,{intent:'propose',email:'new.staff@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1'})
    await eq(replacement.error,'conflict','unacknowledged Auth claim blocks a second first-time send')
    await eq((await serviceAck(applied.invitationId,claim.leaseId,uid(9),false)).error,'conflict',
      'late provider acknowledgement cannot reopen terminal invitation')
    await owner()
    await eq(await scalar('select state from bx1_private.staff_invitation_outbox where invitation_id=$1',[applied.invitationId]),'CLAIMED',
      'claimed lease remains available for forensic review')
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1',[uid(9)]),0,
      'no role is created by closing unknown delivery')
  })
  await isolated('unknown provider outcome reconciles only exact invite evidence', async () => {
    const applied = await approvedInvite()
    await actor(3)
    const claim = await scalar('select public.bx1_staff_invitation_claim($1,$2)',[org(1),applied.invitationId])
    await eq(claim.ok,true,'unknown send begins with one locked delivery claim')
    await actor(1)
    await eq((await scalar('select public.bx1_staff_invitation_reconcile($1,$2)',[org(1),applied.invitationId])).error,
      'outcome_unknown','absence of provider Auth evidence never resends or binds')
    await owner()
    await db.query("insert into auth.users(id,email,invited_at,confirmation_sent_at,raw_app_meta_data) values($1,$2,clock_timestamp(),clock_timestamp(),$3::jsonb)",
      [uid(9),'new.staff@example.invalid',JSON.stringify({bx1_staff_invitation_id:applied.invitationId,bx1_staff_lease_id:key(99)})])
    await actor(1)
    await eq((await scalar('select public.bx1_staff_invitation_reconcile($1,$2)',[org(1),applied.invitationId])).error,
      'outcome_unknown','wrong provider lease marker cannot bind invite')
    await owner()
    await db.query("update auth.users set raw_app_meta_data=$1::jsonb where id=$2",[
      JSON.stringify({bx1_staff_invitation_id:applied.invitationId,bx1_staff_lease_id:claim.leaseId}),uid(9)])
    await actor(1)
    await eq((await scalar('select public.bx1_staff_invitation_reconcile($1,$2)',[org(1),applied.invitationId])).state,
      'INVITED','exact lease, invitation, email and post-claim timestamps reconcile without send')
    await eq((await scalar('select public.bx1_staff_invitation_reconcile($1,$2)',[org(1),applied.invitationId])).replayed,
      true,'repeated reconciliation is idempotent')
    await owner()
    await eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1',[uid(9)]),0,
      'reconciled invite still grants no membership')
  })
  await isolated('audit failure rolls back proposed intent', async () => {
    await owner()
    await db.exec("create function public.synthetic_staff_audit_failure() returns trigger language plpgsql as $$ begin if NEW.event_type='PROPOSED' then raise exception 'synthetic_audit_failure' using errcode='23514'; end if; return NEW; end $$; create trigger synthetic_staff_audit_failure before insert on bx1_private.staff_invitation_events for each row execute function public.synthetic_staff_audit_failure()")
    const denied = await command(1,1,10,{ intent:'propose',email:'audit.fail@example.invalid',role:'ComplianceOfficer',expectedScopeRevision:'1' })
    await eq(denied.ok,false,'required audit insertion failure denies proposal')
    await owner()
    await eq(await scalar("select count(*)::int from bx1_private.staff_invitation_intents where email='audit.fail@example.invalid'"),0,
      'failed audit leaves no invitation intent')
  })
  if (cloud) {
    // Commit only synthetic fixture identities to make them visible to two
    // independent PostgreSQL connections. The disposable CI service is torn
    // down after this job; no real project or Auth API is contacted.
    await owner(); await db.exec('commit'); begun = false
    const { default: pg } = await import('pg')
    const race = async (actorNumber, requestNumber) => {
      const peer = new pg.Client({ host:'127.0.0.1', port:5432, database:'bx1_demo_ci', user:'postgres',
        password:'bx1-synthetic-ci-only', ssl:false, connectionTimeoutMillis:5000 })
      await peer.connect()
      try {
        await peer.query('begin')
        const epoch = Math.floor(Date.now()/1000)
        await peer.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({
          sub:uid(actorNumber),role:'authenticated',session_id:sid(actorNumber),exp:epoch+3600,aal:'aal2',
          amr:[{method:'totp',timestamp:epoch}],
        })])
        await peer.query('set local role authenticated')
        const answer = (await peer.query('select public.bx1_staff_invitation_command($1,$2,$3::jsonb) as answer',[
          org(1),key(requestNumber),JSON.stringify({intent:'propose',email:'race.staff@example.invalid',
            role:'ComplianceOfficer',expectedScopeRevision:'1'}),
        ])).rows[0].answer
        await peer.query('commit')
        return answer
      } catch (error) { await peer.query('rollback').catch(()=>{}); throw error }
      finally { await peer.end() }
    }
    const pair = await Promise.all([race(1,51),race(3,52)])
    await eq(pair.filter(outcome=>outcome.ok===true).length,1,'simultaneous proposals accept exactly one')
    await eq(pair.filter(outcome=>outcome.ok===false).length,1,'simultaneous duplicate proposal conflicts')
    await eq(await scalar("select count(*)::int from bx1_private.staff_invitation_intents where email='race.staff@example.invalid'"),1,
      'two connections created one durable invitation')
  }
  console.log(`BX1_STAFF_INVITATION_SQL_PASS assertions=${checks} fixture=${cloud?'github-postgresql17-synthetic':'pglite-in-memory-synthetic'} Auth-SMTP=not-proven concurrency=${cloud?'two-connection-proven':'not-proven'}`)
  if (begun) { await db.exec('rollback'); begun = false }
} catch (error) {
  console.error(`BX1_STAFF_INVITATION_SQL_RED checks=${checks} code=${error?.code ?? 'assertion'} message=${error?.message?.slice(0, 300) ?? 'unknown'}`)
  process.exitCode = 1
} finally {
  if (begun) await db.exec('rollback')
  await db.close()
}
