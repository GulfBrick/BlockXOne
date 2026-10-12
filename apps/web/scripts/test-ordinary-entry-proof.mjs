import assert from 'node:assert/strict'

// Uses only the parent's disposable GitHub PostgreSQL17 clients. Never connects
// to a hosted project, handles credentials/factors, or runs on the user's PC.
function requireFixture() {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Ordinary entry proof requires exact disposable cloud fixture')
}

export async function proveTestOrdinaryEntry(db, clients, featureSql) {
  requireFixture()
  assert.equal(clients.length, 2, 'ordinary entry proof reuses two existing independent cloud clients')
  let checks = 0, begun = false
  const id = n => `ef790000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const manifest = async () => (await db.query(`select p.oid::text,
    md5(pg_get_functiondef(p.oid)) body,p.proacl::text acl,p.proowner::text owner
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_private','bx1_portal','public') and p.prokind='f'
      and p.proname not like '%test_ordinary_entry%'
    order by p.oid`)).rows
  const begin = async () => { await db.query('begin'); begun = true; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claims = async (n = 1, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: 'aal1',
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1',
      exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
      ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const read = async (n = 1, extra = {}) => {
    await claims(n, extra)
    return scalar('select public.bx1_test_ordinary_entry_read()')
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); await db.query('savepoint ordinary_entry_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint ordinary_entry_denial; release savepoint ordinary_entry_denial')
    await admin(); eq(code, expected, `${label} SQLSTATE=${code ?? 'none'}`)
  }
  const fixtureDigest = async () => scalar(`select md5(jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
    'sessions',(select jsonb_agg(to_jsonb(t) order by id) from auth.sessions t),
    'factors',(select jsonb_agg(to_jsonb(t) order by id) from auth.mfa_factors t),
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_profiles t),
    'memberships',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_memberships t),
    'applications',(select jsonb_agg(to_jsonb(t) order by id) from bx1_portal.applications t),
    'events',(select jsonb_agg(to_jsonb(t) order by id) from bx1_portal.events t),
    'requests',(select jsonb_agg(to_jsonb(t) order by actor_id,request_key) from bx1_portal.entry_requests t))::text)`)
  try {
    await begin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable owner')
    const oldFunctions = await manifest()
    const oldPolicies = (await db.query('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3')).rows
    const oldRows = await fixtureDigest()
    await db.query(featureSql)
    eq(await manifest(), oldFunctions, 'every existing function body/OID/ACL/owner unchanged by installation')
    eq((await db.query('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3')).rows, oldPolicies, 'all RLS policies unchanged')
    eq(await fixtureDigest(), oldRows, 'installation changes no Auth/application/authority/evidence rows')
    eq(await scalar('select test_ordinary_entry_enabled from bx1_portal.entry_configuration where singleton'), false, 'default disabled')
    for (const role of ['anon', 'service_role'])
      eq(await scalar("select has_function_privilege($1,'public.bx1_test_ordinary_entry_read()','EXECUTE')", [role]), false, `${role} no ordinary read`)
    eq(await scalar("select has_function_privilege('authenticated','public.bx1_test_ordinary_entry_read()','EXECUTE')"), true, 'authenticated only public wrapper')
    for (const helper of ['bx1_portal.test_ordinary_entry_session()', 'bx1_portal.test_ordinary_entry_projection()']) {
      for (const role of ['anon', 'authenticated', 'service_role'])
        eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, helper]), false, `${role} cannot bypass ${helper}`)
    }
    for (let n = 1; n <= 4; n++) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(n), `ordinary-entry-${n}@example.invalid`])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),'aal1')", [id(100 + n), id(n)])
      await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,$3,'totp')", [id(200 + n), id(n), n === 4 ? 'unverified' : 'verified'])
      if (n !== 3) await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Synthetic ordinary actor ${n}`])
    }
    for (const n of [1, 2]) {
      await db.query('insert into public.bx1_organisations(id,name) values($1,$2)', [id(300 + n), `Synthetic ordinary organisation ${n}`])
      for (const [offset, role] of [[0, 'Investor'], [10, 'SuperAdmin']])
        await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,$4)', [id(400 + n + offset), id(n), id(300 + n), role])
      await db.query(`insert into bx1_portal.applications(id,user_id,persona,status,details,reviewer_id,review_notes,review_checks,provider_mode,origin)
        values($1,$2,'INVESTOR','DRAFT',$3::jsonb,$4,'Private review note must never escape','{"identity":true}','UNASSIGNED','SELF_SERVICE')`,
      [id(500 + n), id(n), JSON.stringify({ full_name: 'Private identity must never escape', documents: [{ storage_path: 'private/forbidden.pdf', sha256: 'f'.repeat(64) }], beneficial_owners: 'Private control evidence' }), id(n === 1 ? 2 : 1)])
    }
    await denied('default-off denies even enrolled AAL1', () => read())
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    const beforeRead = await fixtureDigest()
    const result = await read()
    eq(Object.keys(result).sort(), ['entry', 'version', 'workspace'], 'fixed native envelope')
    eq(result.version, 1, 'envelope version')
    eq(result.entry.actor.id, id(1), 'entry actor is current caller')
    eq(result.workspace.user.id, id(1), 'workspace actor is same current caller')
    eq(result.entry.applications.map(a => a.id), [id(501)], 'only own application, no other applicant')
    eq(result.entry.contexts.map(c => c.organisation_id), [id(301)], 'only own effective context labels')
    eq(result.workspace.organisations.map(o => o.id), [id(301)], 'workspace has only same own organisation labels')
    eq(result.entry.contexts[0].roles, ['Investor', 'SuperAdmin'], 'role labels preserved without command authority')
    eq(result.entry.workflow, { version: 1, environment: 'TESTNET', actor_id: id(1), scoped_read_available: false }, 'all business reads unavailable')
    eq(result.entry.requests, [], 'no command receipts')
    eq(result.entry.organisation_mandates, [], 'no appointment/provenance records')
    eq(result.entry.admission, { manual_test_review: false }, 'no review route admitted')
    for (const a of result.entry.applications) {
      eq(a.details, {}, 'own private application details redacted')
      eq(a.review_checks, {}, 'review evidence redacted')
      eq(a.reviewer_id, null, 'reviewer identity redacted')
      eq(a.review_notes, null, 'reviewer notes redacted')
      eq(a.handoff, null, 'no business action handoff')
      eq(a.can_request_mandate, false, 'no mandate action')
      eq(a.review_route, 'NOT_ADMITTED', 'no reviewer availability')
    }
    truth(!JSON.stringify(result).includes('Private') && !JSON.stringify(result).includes('private/forbidden'), 'source/private evidence absent from complete result')
    await admin(); eq(await fixtureDigest(), beforeRead, 'successful read performs no mutation or factor change')
    eq((await read(2)).entry.applications.map(a => a.id), [id(502)], 'other legitimate caller sees only its own record')
    await denied('no-profile applicants are not a new authority bypass', () => read(3))
    await denied('unverified-only factor not admitted', () => read(4))
    for (const [label, extra] of [
      ['foreign MAIN issuer', { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }],
      ['wrong session actor', { session_id: id(102) }], ['missing session', { session_id: undefined }],
      ['expired JWT', { exp: Math.floor(Date.now() / 1000) - 1 }], ['missing expiry', { exp: undefined }],
      ['string expiry', { exp: String(Math.floor(Date.now() / 1000) + 3600) }],
      ['wrong JWT role', { role: 'service_role' }], ['claimed anonymous', { is_anonymous: true }],
      ['missing AAL', { aal: undefined }], ['AAL2 not the temporary ordinary class', { aal: 'aal2' }],
      ['missing AMR', { amr: undefined }], ['malformed AMR', { amr: 'password' }],
      ['recovery AMR', { amr: [{ method: 'recovery' }, { method: 'password' }] }],
      ['OAuth AMR', { amr: [{ method: 'oauth' }] }], ['unknown AMR', { amr: [{ method: 'new-unreviewed-method' }] }],
    ]) await denied(label, () => read(1, extra))
    for (const [label, sql] of [
      ['banned Auth user', 'update auth.users set banned_until=clock_timestamp()+interval \'1 hour\' where id=$1'],
      ['deleted Auth user', 'update auth.users set deleted_at=clock_timestamp() where id=$1'],
      ['unconfirmed email', 'update auth.users set email_confirmed_at=null where id=$1'],
      ['anonymous Auth user', 'update auth.users set is_anonymous=true where id=$1'],
      ['suspended native profile', "update public.bx1_profiles set status='SUSPENDED' where id=$1"],
      ['expired live session', "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=$1"],
      ['OAuth live session', 'update auth.sessions set oauth_client_id=$1 where user_id=$1'],
      ['removed verified factors', 'delete from auth.mfa_factors where user_id=$1'],
      ['deleted session', 'delete from auth.sessions where user_id=$1'],
    ]) await denied(label, async () => { await db.query(sql, [id(1)]); await read() })
    await denied('MAIN cannot enable continuation', () => db.query("update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false,reviewer_scope=null where singleton"), '23514')
    await denied('MAIN stays denied even with TEST issuer', async () => {
      await db.query("update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false,environment='MAINNET',manual_test_review=false,reviewer_scope=null where singleton")
      await read()
    })
    for (const [label, sql, values] of [
      ['strict entry remains MFA gated', 'select public.bx1_entry_read()', []],
      ['scoped business reads remain MFA gated', 'select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify({ mode: 'ROLE', organisationId: id(301), role: 'SuperAdmin' })]],
      ['entry mutation remains MFA gated', 'select public.bx1_entry_command($1,$2,$3::jsonb)', ['start_application', id(601), JSON.stringify({ persona: 'WEALTH_MANAGER' })]],
      ['financial mutation remains MFA gated', 'select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', ['propose_funding_route', id(602), '{}', JSON.stringify({ mode: 'ROLE', organisationId: id(301), role: 'SuperAdmin' })]],
      ['provider evidence remains gated', 'select public.bx1_provider_evidence_read($1)', [id(501)]],
      ['private application table remains denied', 'select * from bx1_portal.applications', []],
      ['MFA-gated native memberships remain unavailable', 'select count(*)::int from public.bx1_memberships where user_id=$1', [id(1)]],
    ]) {
      if (label.startsWith('MFA-gated native')) { await claims(); eq(await scalar(sql, values), 0, label) }
      else await denied(label, async () => { await claims(); await scalar(sql, values) })
    }
    await denied('anon execution denied', async () => { await db.query('set local role anon'); await scalar('select public.bx1_test_ordinary_entry_read()') })
    await admin(); await db.query('savepoint label_revocation')
    await db.query("update public.bx1_memberships set status='SUSPENDED' where id=$1", [id(401)])
    eq((await read()).workspace.organisations[0].roles, ['SuperAdmin'], 'revoked membership label removed immediately')
    await admin(); await db.query('rollback to savepoint label_revocation; release savepoint label_revocation')
    await db.query('savepoint org_suspension')
    await db.query("update public.bx1_organisations set status='SUSPENDED' where id=$1", [id(301)])
    const noAssignments = await read()
    eq(noAssignments.entry.contexts, [], 'suspended organisation removed')
    eq(noAssignments.workspace, null, 'no workspace inferred when all assignments ineffective')
    await admin(); await db.query('rollback to savepoint org_suspension; release savepoint org_suspension')
    eq(await manifest(), oldFunctions, 'all prior business/MFA/session/authority/wallet function bodies and ACLs still exact')
    await commit()
    // Force an actual cloud backend wait. Revocation/expiry after the caller's
    // first check must be rechecked, not treated as a cached AAL1 grant.
    const blocker = clients[0], waiting = clients[1]
    await blocker.query('begin'); await admin(blocker)
    try {
      await blocker.query('select id from auth.sessions where id=$1 for update', [id(101)])
      await waiting.query('begin'); await claims(1, {}, waiting)
      const waitingPid = await scalar('select pg_backend_pid()', [], waiting)
      const outcome = waiting.query('select public.bx1_test_ordinary_entry_read()').then(() => ({ code: null }), error => ({ code: error.code }))
      const deadline = Date.now() + 10000
      let blocked = false
      while (Date.now() < deadline) {
        if (await scalar('select cardinality(pg_blocking_pids($1))>0', [waitingPid])) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      truth(blocked, 'two distinct cloud backend requests genuinely overlap at live session lock')
      await blocker.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(101)])
      await blocker.query('commit')
      eq((await outcome).code, '42501', 'session expiry after lock wait denied before any projection')
      await waiting.query('rollback')
    } finally {
      await blocker.query('rollback').catch(() => {})
      await waiting.query('rollback').catch(() => {})
    }
    await begin()
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton')
    eq(await scalar('select test_ordinary_entry_enabled from bx1_portal.entry_configuration where singleton'), false, 'feature left disabled after disposable proof')
    eq(await manifest(), oldFunctions, 'concurrent proof did not modify original authority functions')
    await commit()
    console.log(`BX1_TEST_ORDINARY_ENTRY_PASS assertions=${checks} boundary=TEST-native-enrolled-AAL1-password-self-read-only factors=preserved writers=unchanged privateEvidence=redacted main=denied concurrency=observed-session-expiry-wait hostedAcceptance=not-proven default=disabled`)
    return checks
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
  }
}
