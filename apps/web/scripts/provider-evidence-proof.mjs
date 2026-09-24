import assert from 'node:assert/strict'

// Invoke only inside the existing exact synthetic GitHub PostgreSQL17 fixture,
// after stage2_provider_evidence.sql and all prior business assertions, before
// its final commit/cleanup. This module never opens a database connection.
export async function proveProviderEvidence(db) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Provider evidence proof requires the disposable cloud fixture')
  const actorId = 'e1000000-0000-4000-8000-000000000015'
  const otherId = 'e1000000-0000-4000-8000-000000000016'
  const sessionId = 'e2000000-0000-4000-8000-000000000015'
  const otherSession = 'e2000000-0000-4000-8000-000000000016'
  let checks = 0
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  const admin = async () => db.query('reset role')
  const writer = async (sql, params = []) => {
    await admin(); await db.query('set local role bx1_provider_evidence_writer')
    try { return await scalar(sql, params) } finally { await admin() }
  }
  const expectCode = async (label, action, expected) => {
    await db.query('savepoint provider_expected_denial')
    let code
    try { await action() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint provider_expected_denial; release savepoint provider_expected_denial')
    await admin(); eq(code, expected, label)
  }
  const claims = async (id, sid) => {
    await admin()
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, session_id: sid, role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })])
    await db.query('set local role authenticated')
  }

  await admin()
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'disposable postgres actor')
  eq(await scalar("select environment from bx1_portal.entry_configuration where singleton"), 'TESTNET', 'sandbox fixture environment')
  eq(await scalar("select has_table_privilege('bx1_provider_evidence_writer','bx1_private.provider_evidence_events','SELECT,INSERT,UPDATE,DELETE')"), false, 'writer cannot directly edit provider events')
  eq(await scalar("select has_table_privilege('authenticated','bx1_private.provider_evidence_events','SELECT,INSERT,UPDATE,DELETE')"), false, 'browser role cannot directly edit provider events')
  eq(await scalar("select has_function_privilege('anon','bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean)','EXECUTE')"), false, 'anon cannot invoke provider writer')
  eq(await scalar("select has_function_privilege('bx1_provider_evidence_writer','bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean)','EXECUTE')"), true, 'only dedicated writer can invoke provider write')
  await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'synthetic-provider-applicant@example.invalid',clock_timestamp(),false),($2,'synthetic-unrelated-applicant@example.invalid',clock_timestamp(),false)", [actorId, otherId])
  await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour'),($3,$4,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [sessionId, actorId, otherSession, otherId])
  const applicationId = await scalar("insert into bx1_portal.applications(user_id,persona,status,details,reviewer_scope,provider_mode,origin) values($1,'INVESTOR','DRAFT','{}'::jsonb,null,'UNASSIGNED','SELF_SERVICE') returning id", [actorId])
  const before = await scalar("select jsonb_build_object('status',a.status,'accounts',(select count(*) from bx1_portal.investment_accounts),'eligibility',(select count(*) from bx1_portal.product_eligibility_cases),'memberships',(select count(*) from public.bx1_memberships)) from bx1_portal.applications a where a.id=$1", [applicationId])
  const bindSql = 'select bx1_private.bind_provider_application($1,$2,$3,$4) as result'
  const binding = await writer(bindSql, [actorId, sessionId, applicationId, 1])
  eq(binding.external_user_id, `bx1:testnet:${applicationId}:r1`, 'server derives one external ID from exact application revision')
  eq(binding.actor_id, actorId, 'binding belongs to authenticated actor')
  eq((await writer(bindSql, [actorId, sessionId, applicationId, 1])).binding_id, binding.binding_id, 'same revision binding retry is idempotent')
  eq(await scalar('select count(*)::int from bx1_private.provider_application_bindings where application_id=$1', [applicationId]), 1, 'one binding per application revision')
  await expectCode('another valid session cannot bind the application', () => writer(bindSql, [otherId, otherSession, applicationId, 1]), '42501')
  await expectCode('stale application revision cannot bind', () => writer(bindSql, [actorId, sessionId, applicationId, 2]), '42501')
  await db.query('savepoint provider_wrong_environment')
  await admin(); await db.query("update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false where singleton")
  await expectCode('wrong database environment cannot bind', () => writer(bindSql, [actorId, sessionId, applicationId, 1]), '42501')
  await db.query('rollback to savepoint provider_wrong_environment; release savepoint provider_wrong_environment')

  const eventSql = 'select bx1_private.record_provider_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as result'
  const occurred = new Date(Date.now() + 2000).toISOString()
  const base = [binding.external_user_id, 'synthetic-applicant-14', 'applicantReviewed', 'synthetic-correlation', 'synthetic-sandbox-client', occurred,
    'a'.repeat(64), 'b'.repeat(64), 'completed', 'GREEN', null, false, true]
  const first = await writer(eventSql, base)
  eq([first.ordering_state, first.duplicate], ['CURRENT', false], 'verified event is current evidence only')
  const retry = await writer(eventSql, base)
  eq([retry.id, retry.duplicate], [first.id, true], 'webhook replay deduplicates durably')
  const reordered = await writer(eventSql, [...base.slice(0, 5), new Date(Date.now() + 1000).toISOString(), 'c'.repeat(64), 'd'.repeat(64), ...base.slice(8)])
  eq(reordered.ordering_state, 'STALE', 'out-of-order delivery cannot replace current event')
  const manuallySent = await writer(eventSql, [...base.slice(0, 5), new Date(Date.now() + 3000).toISOString(), 'e'.repeat(64), 'f'.repeat(64), ...base.slice(8, 11), true, true])
  eq(manuallySent.ordering_state, 'MANUAL_TEST', 'webhook-manager test never becomes current evidence')
  await expectCode('production-mode webhook refused in sandbox', () => writer(eventSql, [...base.slice(0, 12), false]), '42501')
  await expectCode('unbound externalUserId refused', () => writer(eventSql, ['bx1:testnet:e1000000-0000-4000-8000-000000000999:r1', ...base.slice(1)]), '42501')
  await expectCode('provider applicant change refused', () => writer(eventSql, [base[0], 'synthetic-applicant-99', ...base.slice(2, 6), '1'.repeat(64), '2'.repeat(64), ...base.slice(8)]), '23514')
  eq(await scalar('select count(*)::int from bx1_private.provider_evidence_events where application_id=$1', [applicationId]), 3, 'only unique bound events persisted')
  eq(await scalar("select jsonb_build_object('status',a.status,'accounts',(select count(*) from bx1_portal.investment_accounts),'eligibility',(select count(*) from bx1_portal.product_eligibility_cases),'memberships',(select count(*) from public.bx1_memberships)) from bx1_portal.applications a where a.id=$1", [applicationId]), before, 'provider evidence cannot approve or grant authority')
  await claims(actorId, sessionId)
  const own = await scalar('select public.bx1_provider_evidence_read($1)', [applicationId])
  eq(own.length, 3, 'applicant reads only normalized private evidence')
  eq(own.some(event => Object.hasOwn(event, 'raw_payload')), false, 'read RPC never exposes raw webhook payload')
  await claims(otherId, otherSession)
  await expectCode('unrelated actor cannot read evidence', () => scalar('select public.bx1_provider_evidence_read($1)', [applicationId]), '42501')
  await admin()
  return checks
}
