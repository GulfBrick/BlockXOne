import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

// Execute only on the admitted GitHub cloud runner. Serial synthetic PostgreSQL;
// no DSN, network, real Auth, credentials, concurrency or hosted-timeout claim.
if (process.argv.length !== 2) throw new Error('Recovery SQL fixture accepts no arguments')
const db = new PGlite()
const id = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const uid = n => id('1', n), sid = n => id('2', n), org = n => id('3', n), person = n => id('6', n)
const ownIntent = { intent: 'request', reason: 'LOST_AUTHENTICATOR' }
const migration = '../../../supabase/migrations/20260920120609_bx1_recovery_containment.sql'
const tables = ['recovery_cases', 'recovery_authorities', 'recovery_holds', 'recovery_requests', 'recovery_events']
let checks = 0, cases = 0, failures = 0, begun = false, nextKey = 1000, parseResult, parseRead
let phase = 'initialise'
const source = path => readFile(new URL(path, import.meta.url), 'utf8')
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
const truth = (value, label) => { assert.ok(value, label); checks++ }
const admin = () => db.exec('reset role')
async function sqlFile(path) {
  phase = path.split('/').at(-1)
  const sql = await source(path)
  try { return await db.exec(sql) }
  catch (error) {
    const position = Number(error?.position)
    if (Number.isInteger(position) && position > 0 && position <= sql.length)
      error.fixtureLine = sql.slice(0, position - 1).split('\n').length
    throw error
  }
}
const schemaAclSql = "select nspname,coalesce((select jsonb_agg(to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable) from aclexplode(n.nspacl) a),'[]'::jsonb) acl from pg_namespace n where nspname in ('public','bx1_private','auth') order by nspname"
const key = () => id('b', nextKey++)
async function scalar(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0] }
async function check(sql, expected, label, params = []) { equal(await scalar(sql, params), expected, label) }
async function test(label, body) {
  await admin(); await db.exec('savepoint isolated_recovery_case'); cases++
  const before = checks
  try { await body(); truth(checks > before, `${label} asserts actual results`) }
  catch (error) {
    failures++
    console.error(`BX1_RECOVERY_CASE_RED case=${label} code=${typeof error?.code === 'string' ? error.code : 'assertion'} check=${error?.name === 'AssertionError' ? error.message.split('\n')[0] : 'database operation'}`)
  } finally { await db.exec('rollback to savepoint isolated_recovery_case; release savepoint isolated_recovery_case'); await admin() }
}
async function rejected(sql, params = [], expected = '23514') {
  await db.exec('savepoint expected_rejection')
  let code
  try { await db.query(sql, params) } catch (error) { code = error?.code }
  await db.exec('rollback to savepoint expected_rejection; release savepoint expected_rejection')
  equal(code, expected, 'expected database denial')
}
async function actor(n = 1, { aal = 'aal2', age = 0, extra = {} } = {}) {
  await admin()
  const now = Number(await scalar('select floor(extract(epoch from clock_timestamp()))::text'))
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', aal, exp: now + 3600, amr: [{ method: 'totp', timestamp: now - age }], ...extra })])
  await db.exec('set local role authenticated')
}
async function request({ n = 1, requestKey = key(), input = ownIntent, ...assurance } = {}) {
  await actor(n, assurance)
  const result = await scalar('select public.bx1_recovery_request($1,$2::jsonb)', [requestKey, JSON.stringify(input)])
  truth(parseResult(result), 'own RPC result satisfies actual application parser')
  return result
}
async function command(input, { n = 5, requestKey = key(), ...assurance } = {}) {
  await actor(n, assurance)
  const result = await scalar('select public.bx1_recovery_command($1,$2::jsonb)', [requestKey, JSON.stringify(input)])
  truth(parseResult(result), 'operator RPC result satisfies actual application parser')
  return result
}
async function read({ n = 1, selected = null, ...assurance } = {}) {
  await actor(n, assurance)
  const result = await scalar('select public.bx1_recovery_read($1)', [selected])
  truth(parseRead(result, { principalId: uid(n), ...(selected ? { selectedCaseId: selected } : {}) }), 'SQL read satisfies actual application parser')
  return result
}
const proposal = c => ({ intent: 'propose', caseId: c.caseId, expectedRevision: c.revision, evidenceReference: 'synthetic:case/identity-proof' })
const review = (c, decision = 'approve') => ({ intent: 'review', caseId: c.caseId, expectedRevision: c.revision, decision })
const apply = c => ({ intent: 'apply', caseId: c.caseId, expectedRevision: c.revision })
async function pending() { const c = await request(); truth(c.ok, 'own request succeeded'); const p = await command(proposal(c)); truth(p.ok, 'propose succeeded'); return p }
async function approved() { const p = await pending(); const a = await command(review(p), { n: 4 }); truth(a.ok, 'independent approval succeeded'); return a }
async function held() { const a = await approved(); const h = await command(apply(a)); truth(h.ok, 'containment applied'); return h }
async function totals() {
  await admin()
  return scalar(`select jsonb_build_object('root',(select to_jsonb(r) from bx1_private.authority_root r),
    'scopes',(select jsonb_agg(to_jsonb(s) order by organisation_id) from bx1_private.authority_scopes s),
    'grants',(select jsonb_agg(to_jsonb(g) order by id) from bx1_private.governance_grants g),
    'commands',(select jsonb_agg(to_jsonb(c) order by id) from bx1_private.administration_commands c),
    'adminEvents',(select jsonb_agg(to_jsonb(e) order by event_sequence) from bx1_private.administration_events e),
    'cases',(select jsonb_agg(to_jsonb(c) order by id) from bx1_private.recovery_cases c),
    'holds',(select jsonb_agg(to_jsonb(h) order by person_id) from bx1_private.recovery_holds h),
    'requests',(select jsonb_agg(to_jsonb(r) order by actor_principal_id,request_key) from bx1_private.recovery_requests r),
    'events',(select jsonb_agg(to_jsonb(e) order by event_sequence) from bx1_private.recovery_events e))`)
}
async function preservedBusiness() {
  await admin()
  return scalar(`select jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.bx1_profiles p),
    'memberships',(select jsonb_agg(to_jsonb(m) order by id) from public.bx1_memberships m),
    'wallets',(select jsonb_agg(to_jsonb(w) order by id) from public.bx1_wallets w),
    'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),
    'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s),
    'factors',(select jsonb_agg(to_jsonb(f) order by id) from auth.mfa_factors f))`)
}

async function schemaMatrix(beforeIdentity, beforeEdges, beforeRoles, beforeSchemaAcls) {
  equal(await scalar("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl) from pg_proc where oid='bx1_private.has_active_session()'::regprocedure"), beforeIdentity, 'active-session OID owner and ACL retained')
  equal((await db.query('select roleid,member,grantor,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor')).rows, beforeEdges, 'all membership grantors and flags restored')
  equal((await db.query('select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles order by oid')).rows, beforeRoles, 'role attributes unchanged')
  equal((await db.query(schemaAclSql)).rows, beforeSchemaAcls, 'all schema ACL grantors and privileges restored')
  await check("select has_schema_privilege('bx1_authority_owner','bx1_private','CREATE')", false, 'application owner retains no schema CREATE')
  await check("select count(*)::int from pg_class where relnamespace='bx1_private'::regnamespace and relname=any($1::text[]) and relrowsecurity and relowner='bx1_authority_owner'::regrole", 5, 'exact five private RLS owner tables', [tables])
  for (const role of ['anon', 'authenticated', 'service_role', 'bx1_wallet_owner', 'bx1_wallet_verifier']) {
    for (const table of tables) await check('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')', false, `${role} has no direct ${table} access`, [role, `bx1_private.${table}`])
    for (const table of ['auth.users', 'auth.sessions', 'auth.mfa_factors']) await check('select has_table_privilege($1,$2,\'INSERT,UPDATE,DELETE\')', false, `${role} no Auth mutation`, [role, table])
  }
  await check("select has_table_privilege('bx1_authority_owner','auth.sessions','SELECT')", false, 'application owner receives no Auth SELECT')
  await check("select has_function_privilege('authenticated','bx1_private.has_identity_session()','EXECUTE')", false, 'raw identity helper not client callable')
  for (const signature of ['public.bx1_recovery_request(uuid,jsonb)', 'public.bx1_recovery_read(uuid)', 'public.bx1_recovery_command(uuid,jsonb)']) {
    await check('select not prosecdef and proconfig @> array[\'search_path=""\',\'statement_timeout=10s\'] from pg_proc where oid=$1::regprocedure', true, 'public facade invoker and bounded metadata', [signature])
    await check("select has_function_privilege('authenticated',$1,'EXECUTE')", true, 'caller can invoke guarded facade', [signature])
    await check("select has_function_privilege('service_role',$1,'EXECUTE')", false, 'service role has no recovery facade grant', [signature])
  }
  for (const table of tables) await check(`select count(*)::int from bx1_private.${table}`, 0, 'migration seeds no case or authority')
}

async function matrix() {
  await test('unheld-five-migration-identity-MFA-wallet-regression', async () => {
    await actor(1)
    await check('select count(*)::int from public.bx1_memberships where organisation_id=$1', 9, 'all nine target role memberships preserved', [org(1)])
    await check('select bx1_private.has_active_session()', true, 'ordinary active session')
    await check("select (public.bx1_mfa_status()->>'session_is_totp')::boolean", true, 'existing current-factor bootstrap unchanged')
    await check('select count(id)::int from public.bx1_wallets', 1, 'existing PENDING ownership readable')
    await actor(1, { aal: 'aal1' }); await check('select count(*)::int from public.bx1_memberships', 0, 'enrolled AAL1 still blocked by RLS')
    const own = await read({ aal: 'aal1' }); equal(own.availability, 'ready', 'own raw AAL1 route admitted'); equal(own.canRequest, true, 'own request available')
  })
  await test('own-request-and-exact-replay', async () => {
    const k = key(), c = await request({ requestKey: k, aal: 'aal1' })
    equal(c.state, 'REQUESTED', 'request no containment'); equal(c.revision, '1', 'initial revision')
    equal(await request({ requestKey: k, aal: 'aal1' }), { ...c, replayed: true }, 'same actor/key replay')
    equal(await request({ n: 2 }), { ok: false, error: 'conflict' }, 'target alias cannot open another case')
    await admin(); await check('select count(*)::int from bx1_private.recovery_holds', 0, 'request alone does not quarantine')
    await check('select count(*)::int from bx1_private.recovery_requests', 1, 'one request receipt')
  })
  await test('malformed-closed-wire', async () => {
    const c = await request()
    for (const input of [null, {}, { ...proposal(c), targetPersonId: person(2) }, { ...proposal(c), intent: null }, { ...proposal(c), expectedRevision: '9223372036854775808' }, { ...proposal(c), evidenceReference: '<script>' }, { ...review(c), decision: null }])
      equal(await command(input), { ok: false, error: 'invalid_request' }, 'malformed command rejected')
    equal(await request({ input: { ...ownIntent, target: person(2) } }), { ok: false, error: 'invalid_request' }, 'own request cannot pick target')
  })
  await test('raw-identity-denials', async () => {
    for (const extra of [{ sub: uid(99) }, { session_id: sid(99) }]) equal((await read({ extra })).availability, 'unauthorised', 'subject/session binding denied')
    equal((await read({ n: 7 })).availability, 'unauthorised', 'unmapped account not inferred')
    for (const statement of ["update auth.users set banned_until=now()+interval '1 day' where id=$1", 'update auth.users set deleted_at=now() where id=$1', "update public.bx1_profiles set status='SUSPENDED' where id=$1"]) {
      await admin(); await db.exec('savepoint identity_denial'); await db.query(statement, [uid(1)])
      equal((await read()).availability, 'unauthorised', 'inactive raw identity denied')
      await admin(); await db.exec('rollback to savepoint identity_denial; release savepoint identity_denial')
    }
    await admin(); await db.query('update auth.sessions set oauth_client_id=$1 where id=$2', [id('a', 9), sid(1)])
    equal((await read()).availability, 'unauthorised', 'OAuth session denied')
  })
  await test('recovery-only-expiry-and-assurance-claims', async () => {
    for (const extra of [{ exp: undefined }, { exp: null }, { exp: '9999999999' }, { exp: 1 }, { exp: 123.5 }, { aal: undefined }, { aal: 'aal3' }]) {
      equal((await read({ extra })).availability, 'unauthorised', 'invalid recovery claims deny own read')
      equal(await request({ extra }), { ok: false, error: 'unauthorised' }, 'invalid recovery claims deny own write')
    }
    await admin(); await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(1), session_id: sid(1), role: 'authenticated' })])
    await db.exec('set local role bx1_wallet_verifier')
    const challenge = await scalar('select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5)', [uid(1), id('4', 1), sid(1), org(1), id('a', 1)])
    truth(challenge, 'trusted wallet no-exp internal claims remain compatible before hold')
  })
  await test('no-grant-badge-and-subject-denials', async () => {
    const c = await request()
    equal(await command(proposal(c), { n: 1 }), { ok: false, error: 'forbidden' }, 'Super Admin target cannot propose own containment')
    equal(await command(proposal(c), { n: 6 }), { ok: false, error: 'forbidden' }, 'unconfigured operator denied')
    equal((await read({ n: 6, selected: c.caseId })).selectedCase, null, 'foreign case not leaked')
    await admin(); await db.query("update bx1_private.recovery_authorities set status='REVOKED',revision=revision+1 where operator_person_id=$1", [person(4)])
    equal(await command(proposal(c)), { ok: false, error: 'forbidden' }, 'revoked grant denied')
  })
  await test('two-people-not-two-accounts', async () => {
    const p = await pending()
    equal(await command(review(p), { n: 8 }), { ok: false, error: 'forbidden' }, 'proposer alias not independent reviewer')
    equal(await command(review(p), { n: 1 }), { ok: false, error: 'forbidden' }, 'subject cannot review')
    const a = await command(review(p), { n: 4 }); equal(a.state, 'APPROVED', 'independent reviewer accepted')
    equal(await command(apply(a), { n: 3 }), { ok: false, error: 'forbidden' }, 'unrelated granted operator cannot apply')
  })
  await test('current-TOTP-and-recent-AMR-boundary', async () => {
    const c = await request()
    equal(await command(proposal(c), { aal: 'aal1' }), { ok: false, error: 'step_up_required' }, 'signed AAL1 denied')
    equal(await command(proposal(c), { age: 301 }), { ok: false, error: 'step_up_required' }, 'stale AMR denied')
    equal(await command(proposal(c), { extra: { amr: [{ method: 'recovery', timestamp: 1 }] } }), { ok: false, error: 'step_up_required' }, 'recovery-only AMR denied')
    const stale = await read({ n: 5, age: 301, selected: c.caseId })
    equal(stale.selectedCase.requiresStepUp, true, 'operator stale-TOTP read permitted with step-up'); equal(stale.selectedCase.allowedActions, [], 'stale mutation hints absent')
  })
  await test('own-redaction-and-operator-actions', async () => {
    const p = await pending(), own = await read({ selected: p.caseId, aal: 'aal1' }), op = await read({ n: 4, selected: p.caseId })
    equal(own.selectedCase.evidenceReference, null, 'subject evidence reference hidden'); equal(own.selectedCase.proposedByPersonId, null, 'operator identity hidden')
    equal(own.selectedCase.events.map(e => e.actorPersonId), [person(1), null], 'only own actor identity retained')
    equal(op.selectedCase.allowedActions, ['approve', 'reject'], 'independent review choices'); equal(op.selectedCase.evidenceReference, 'synthetic:case/identity-proof', 'operator sees opaque evidence reference')
  })
  await test('rejection-no-hold-and-new-request', async () => {
    const p = await pending(), rejectedCase = await command(review(p, 'reject'), { n: 4 })
    equal(rejectedCase.state, 'REJECTED', 'rejected terminal'); equal((await read()).canRequest, true, 'new own request allowed after rejection')
    truth((await request()).ok, 'explicit later request succeeds'); await admin(); await check('select count(*)::int from bx1_private.recovery_holds', 0, 'no hold on rejection')
  })
  await test('stale-target-terminalizes-normally', async () => {
    const p = await pending(); await admin(); await db.query("update public.bx1_memberships set status='SUSPENDED' where user_id=$1 and organisation_id=$2", [uid(2), org(2)])
    equal(await command(review(p), { n: 4 }), { ok: false, error: 'conflict' }, 'target change invalidates')
    await admin(); await check('select state from bx1_private.recovery_cases where id=$1', 'INVALIDATED', 'terminalization retained', [p.caseId])
    await check('select count(*)::int from bx1_private.recovery_requests', 3, 'failed transition receipt retained')
  })
  await test('target-commitment-is-timezone-independent', async () => {
    await db.exec("set local TimeZone='UTC'")
    const p = await pending()
    await admin(); const utc = await scalar('select bx1_private.recovery_target_snapshot($1)', [person(1)])
    await db.exec("set local TimeZone='Pacific/Auckland'")
    equal(await scalar('select bx1_private.recovery_target_snapshot($1)', [person(1)]), utc, 'canonical target unchanged across session timezone')
    equal((await command(review(p), { n: 4 })).state, 'APPROVED', 'unchanged target not falsely invalidated')
  })
  await test('recorded-proposer-revocation-terminalizes', async () => {
    const p = await pending(); await admin(); await db.query("update bx1_private.recovery_authorities set status='REVOKED',revision=revision+1 where id=$1", [id('9', 4)])
    equal(await command(review(p), { n: 4 }), { ok: false, error: 'conflict' }, 'recorded grant revocation invalidates')
    await admin(); await check('select state from bx1_private.recovery_cases where id=$1', 'INVALIDATED', 'invalidated original case', [p.caseId])
  })
  await test('recorded-proposer-banned-terminalizes', async () => {
    const p = await pending(); await admin(); await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [uid(5)])
    equal(await command(review(p), { n: 4 }), { ok: false, error: 'conflict' }, 'banned recorded principal cannot authorize later apply')
  })
  await test('stale-root-trust-terminalizes', async () => {
    const a = await approved(); await admin(); await db.exec('update bx1_private.authority_root set trust_revision=trust_revision+1')
    equal(await command(apply(a)), { ok: false, error: 'conflict' }, 'trust changed after approval')
    await admin(); await check('select count(*)::int from bx1_private.recovery_holds', 0, 'no hold on stale trust')
  })
  await test('expiry-is-durable-not-exception-rollback', async () => {
    const caseId = id('c', 1)
    await db.query(`insert into bx1_private.recovery_cases(id,target_person_id,requester_principal_id,requested_trust_revision,created_at,expires_at)
      values($1,$2,$3,1,now()-interval '25 hours',now()-interval '1 hour')`, [caseId, person(1), uid(1)])
    equal(await command(proposal({ caseId, revision: '1' })), { ok: false, error: 'expired' }, 'expired normal result')
    await admin(); await check('select state from bx1_private.recovery_cases where id=$1', 'EXPIRED', 'expired case committed in call', [caseId])
    await check('select count(*)::int from bx1_private.recovery_requests', 1, 'expiry receipt retained')
  })
  await test('quarantine-exact-effects-and-preservation', async () => {
    const before = await preservedBusiness(), oldHold = await scalar('select to_jsonb(s) from bx1_private.authority_scopes s where organisation_id=$1', [org(2)])
    const h = await held(); equal(h.state, 'QUARANTINED', 'terminal containment'); equal(h.revision, '4', 'four-state progression')
    equal(await preservedBusiness(), before, 'profiles memberships wallets and all Auth rows unchanged')
    await check("select count(*)::int from bx1_private.governance_grants where person_id=$1 and status='REVOKED'", 2, 'both active and expired-active governance retired', [person(1)])
    await check('select trust_revision::text from bx1_private.authority_root', '2', 'root trust advances exactly once')
    equal(await scalar('select to_jsonb(s) from bx1_private.authority_scopes s where organisation_id=$1', [org(2)]), oldHold, 'already HOLD byte-preserved')
    await check("select state||':'||revision::text from bx1_private.authority_scopes where organisation_id=$1", 'HOLD:2', 'READY becomes HOLD once', [org(1)])
    await check('select count(*)::int from bx1_private.authority_scopes where organisation_id=$1', 0, 'no scope created for ordinary-only org', [org(3)])
    await check("select state||':'||revision::text from bx1_private.authority_scopes where organisation_id=$1", 'READY:1', 'unrelated scope unchanged', [org(4)])
    await check('select count(*)::int from bx1_private.recovery_events', 4, 'four exact recovery events')
    await check('select count(*)::int from bx1_private.recovery_requests', 4, 'four exact receipts')
  })
  await test('business-denial-across-aliases-and-factorless-state', async () => {
    const h = await held()
    for (const n of [1, 2]) {
      await actor(n)
      await check('select bx1_private.has_active_session()', false, 'held alias business session denied')
      await check('select count(*)::int from public.bx1_profiles', 0, 'profile RLS denied')
      await check('select count(*)::int from public.bx1_memberships', 0, 'membership RLS denied')
      await check('select count(*)::int from public.bx1_organisations', 0, 'org RLS denied')
      await check('select count(id)::int from public.bx1_wallets', 0, 'wallet RLS denied')
      await check("select (public.bx1_mfa_status()->>'active')::boolean", false, 'ordinary MFA bootstrap denied')
      await check("select public.bx1_administration_read($1,null)->>'availability'", 'forbidden', 'admin denied', [org(1)])
      const own = await read({ n, selected: h.caseId, aal: 'aal1' }); equal(own.held, true, 'own raw status survives'); equal(own.canRequest, false, 'new request disabled'); equal(own.selectedCase.isOwn, true, 'same-person ownership')
    }
    await admin(); await db.query('delete from auth.mfa_factors where user_id=any($1::uuid[])', [[uid(1), uid(2)]])
    await actor(1, { aal: 'aal1' }); await check('select bx1_private.has_active_session()', false, 'last-factor removal cannot reopen access')
    await admin(); await db.query("update auth.sessions set created_at=clock_timestamp()+interval '1 second' where user_id=$1", [uid(1)])
    await actor(1, { aal: 'aal1' }); await check('select bx1_private.has_active_session()', false, 'post-cutoff session also held; no release exception')
    await actor(4); await check('select bx1_private.has_active_session()', true, 'unrelated operator stays active')
  })
  await test('future-alias-and-revoked-mapping-no-escape', async () => {
    await held(); await admin()
    await db.query(`insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
      values($1,$2,'TRUSTED','synthetic-later-alias',$3)`, [uid(7), person(1), id('7', 1)])
    await actor(7); await check('select bx1_private.has_active_session()', false, 'new mapped alias inherits live hold')
    await admin(); await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1", [uid(2)])
    await actor(2); await check('select bx1_private.has_active_session()', false, 'revoked mapping does not hide hold')
  })
  await test('held-governor-never-counted-and-no-new-open-case', async () => {
    const h = await held(); await admin()
    await check('select bx1_private.is_eligible_governor($1,$2)', false, 'held target excluded from governor floor', [person(1), org(1)])
    equal(await request({ n: 2 }), { ok: false, error: 'conflict' }, 'held subject alias cannot make new case')
    await admin(); await rejected('delete from bx1_private.recovery_holds where case_id=$1', [h.caseId]); await rejected("update bx1_private.recovery_holds set session_cutoff=session_cutoff+interval '1 second'")
  })
  await test('wallet-private-guard-after-containment', async () => {
    await held(); await admin(); await db.exec('set local role bx1_wallet_verifier')
    await rejected('select bx1_private.read_wallet_challenge($1,$2,$3,$4,$5)', [uid(1), id('4', 1), sid(1), org(1), id('a', 1)], 'BW001')
    await rejected('select bx1_private.consume_wallet_challenge($1,$2,$3,$4,$5,$6,$7)', [uid(1), id('4', 1), sid(1), org(1), id('a', 1), 'Synthetic recovery regression proof', `0x${'1'.repeat(130)}`], 'BW001')
  })
  await test('admin-pending-intents-invalidated-atomically', async () => {
    await actor(1)
    const adminProposal = await scalar('select public.bx1_administration_command($1,$2,$3::jsonb)', [org(1), key(), JSON.stringify({ intent: 'propose', kind: 'ENTITY_DRAFT_CREATE', payload: { displayName: 'Synthetic pending intent', kind: 'OTHER', jurisdictionCode: null, registrationReference: null }, expectedScopeRevision: '1' })])
    truth(adminProposal.ok, 'actual guarded administration proposal exists')
    await held(); await admin()
    await check('select state from bx1_private.administration_commands where id=$1', 'INVALIDATED', 'pending admin case invalidated', [adminProposal.proposalId])
    await check("select count(*)::int from bx1_private.administration_events where command_id=$1 and event_type='INVALIDATED' and reason='stale_scope'", 1, 'one matching invalidation audit event', [adminProposal.proposalId])
    await check("select (details->>'commandsInvalidated')::int from bx1_private.recovery_events where event_type='QUARANTINED'", 1, 'exact invalidated command count retained')
  })
  await test('late-audit-failure-rolls-back-every-effect', async () => {
    const a = await approved(), before = await totals()
    await db.exec("alter table bx1_private.recovery_events add constraint synthetic_recovery_audit_failure check(event_type<>'QUARANTINED')")
    equal(await command(apply(a)), { ok: false, error: 'unavailable' }, 'late fault reported unavailable')
    equal(await totals(), before, 'all domain events receipts holds and revisions rolled back')
  })
  await test('immutable-case-and-receipt-history', async () => {
    const p = await pending(); await admin()
    await rejected('update bx1_private.recovery_cases set evidence_reference=$1,revision=revision+1 where id=$2', ['different:proof', p.caseId])
    await rejected("update bx1_private.recovery_requests set result='{}'::jsonb")
    await rejected('delete from bx1_private.recovery_events')
    await rejected("update bx1_private.recovery_authorities set valid_until=valid_until+interval '1 day'")
  })
  await test('operator-replay-is-currently-authorized', async () => {
    const a = await approved(), k = key(), body = apply(a), h = await command(body, { requestKey: k })
    equal(await command(body, { requestKey: k }), { ...h, replayed: true }, 'same-key effect replay')
    equal(await command({ ...body, expectedRevision: '4' }, { requestKey: k }), { ok: false, error: 'conflict' }, 'same key changed intent denied')
    equal(await command(body, { requestKey: k, age: 301 }), { ok: false, error: 'step_up_required' }, 'stale MFA cannot replay success')
    await admin(); await db.query("update bx1_private.recovery_authorities set status='REVOKED',revision=revision+1 where id=$1", [id('9', 4)])
    equal(await command(body, { requestKey: k }), { ok: false, error: 'forbidden' }, 'revoked operator cannot replay success')
    await admin(); await check('select count(*)::int from bx1_private.recovery_holds', 1, 'one hold despite retries')
  })
  await test('bounded-list-and-selected-case-outside-page', async () => {
    await db.exec(`insert into bx1_private.recovery_cases(target_person_id,requester_principal_id,state,requested_trust_revision,created_at,expires_at)
      select '${person(1)}','${uid(1)}','EXPIRED',1,now()-(n||' hours')::interval,now()-(n||' hours')::interval+interval '24 hours' from generate_series(25,85) n`)
    const oldest = await scalar('select id from bx1_private.recovery_cases order by created_at,id limit 1')
    const view = await read({ selected: oldest, aal: 'aal1' }); equal(view.cases.length, 50, 'bounded case list'); equal(view.casesTruncated, true, 'truncation explicit')
    equal(view.selectedCase.caseId, oldest, 'separately authorized selected case'); truth(!view.cases.some(c => c.caseId === oldest), 'selected outside page')
  })
}

try {
  const compiled = ts.transpileModule(await source('../src/lib/recovery/contracts.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2022 } }).outputText
  ;({ parseRecoveryResult: parseResult, parseRecoveryReadProjection: parseRead } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`))
  await db.exec('begin'); begun = true
  await sqlFile('../../../supabase/tests/bx1_identity_workspace.sql')
  await sqlFile('../../../supabase/tests/bx1_mfa_assurance.sql')
  await db.exec("alter table auth.sessions add column created_at timestamptz not null default now()-interval '1 hour'; alter table auth.users enable row level security; alter table auth.sessions enable row level security")
  await sqlFile('../../../supabase/migrations/20260916234746_bx1_identity_workspace.sql')
  phase = 'non-superuser-migrator-setup'
  await db.exec(`create role bx1_fixture_migrator nologin noinherit nosuperuser createdb createrole bypassrls;
    grant usage,create on schema public to bx1_fixture_migrator with grant option;
    grant usage on schema auth to bx1_fixture_migrator;
    grant select on auth.users,auth.sessions,auth.mfa_factors to bx1_fixture_migrator;
    alter schema bx1_private owner to bx1_fixture_migrator;
    alter table public.bx1_profiles owner to bx1_fixture_migrator;
    alter table public.bx1_organisations owner to bx1_fixture_migrator;
    alter table public.bx1_memberships owner to bx1_fixture_migrator;
    alter function bx1_private.has_active_session() owner to bx1_fixture_migrator;
    alter function bx1_private.can_access_organisation(uuid) owner to bx1_fixture_migrator;
    set local role bx1_fixture_migrator;`)
  await sqlFile('../../../supabase/migrations/20260917190042_bx1_wallet_ownership.sql')
  await sqlFile('../../../supabase/migrations/20260918015541_bx1_mfa_assurance.sql')
  await sqlFile('../../../supabase/migrations/20260918234447_bx1_controlled_administration.sql')
  phase = 'before-recovery-catalog-capture'
  const beforeIdentity = await scalar("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl) from pg_proc where oid='bx1_private.has_active_session()'::regprocedure")
  const beforeEdges = (await db.query('select roleid,member,grantor,admin_option,inherit_option,set_option from pg_auth_members order by roleid,member,grantor')).rows
  const beforeRoles = (await db.query('select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls from pg_roles order by oid')).rows
  const beforeSchemaAcls = (await db.query(schemaAclSql)).rows
  await sqlFile(migration)
  phase = 'schema-matrix'
  await admin(); await schemaMatrix(beforeIdentity, beforeEdges, beforeRoles, beforeSchemaAcls)
  console.log(`BX1_RECOVERY_SCHEMA_PASS assertions=${checks} migrations=5 nonSuperuser=true`)
  await sqlFile('../../../supabase/tests/bx1_controlled_administration.sql')
  await sqlFile('../../../supabase/tests/bx1_recovery_containment.sql')
  phase = 'recovery-matrix'
  await matrix()
  await admin(); await db.exec('rollback'); begun = false
  await check("select count(*)::int from pg_namespace where nspname in ('auth','bx1_private')", 0, 'all synthetic database state rolled back')
  truth(cases >= 24, 'all bounded recovery scenarios ran')
  if (failures) { console.error(`BX1_RECOVERY_SQL_RED assertions=${checks} cases=${cases} failures=${failures} cleanup=rolled-back`); process.exitCode = 1 }
  else console.log(`BX1_RECOVERY_SQL_PASS assertions=${checks} cases=${cases} cleanup=rolled-back migrations=5 fixture=synthetic-serial-cloud-CI GoTrue=not-proven concurrency=not-proven hostedTimeout=not-proven recoveryProviderEffects=not-enabled`)
} catch (error) {
  console.error(`BX1_RECOVERY_SQL_FAILED phase=${phase} line=${Number.isInteger(error?.fixtureLine) ? error.fixtureLine : 'unknown'} assertions=${checks} code=${typeof error?.code === 'string' ? error.code : 'assertion'} check=${error?.name === 'AssertionError' ? error.message.split('\n')[0] : 'fixture operation'}`)
  process.exitCode = 1
} finally {
  if (begun) { try { await db.exec('rollback') } catch {} }
  await db.close()
}
