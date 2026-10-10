import assert from 'node:assert/strict'

// Executed only by the parent's exact disposable GitHub PostgreSQL17 fixture.
// This module never connects to a project, signs in, changes real Auth factors,
// downloads bytes, runs a scanner, or claims hosted/independent-human acceptance.
export async function proveSyntheticCompliance(db, clients, featureSql, lockParitySql) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Synthetic Compliance proof requires exact disposable cloud fixture')
  assert.equal(clients.length, 2)
  let checks = 0, begun = false, sequence = 600
  const id = n => `ef810000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const context = { mode: 'ROLE', organisationId: scope, role: 'ComplianceOfficer' }
  const applicant = { mode: 'APPLICANT' }
  const reviewChecks = { identity: true, ownership: true, screening: true, suitability: true }
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const begin = async () => { await db.query('begin'); begun = true; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claims = async (n = 2, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: n === 3 ? 'aal2' : 'aal1',
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
      amr: n === 3 ? [{ method: 'password' }, { method: 'totp' }] : [{ method: 'password' }], ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const read = async (c = context, n = 2, extra = {}) => {
    await claims(n, extra)
    return scalar('select public.bx1_portal_synthetic_compliance_read($1::jsonb)', [JSON.stringify(c)])
  }
  const command = async (body, requestKey = key(), c = context, n = 2, action = 'review_application', extra = {}) => {
    await claims(n, extra)
    return scalar('select public.bx1_portal_synthetic_compliance_command($1::jsonb,$2,$3,$4::jsonb)',
      [JSON.stringify(c), action, requestKey, JSON.stringify(body)])
  }
  const entry = async (action, body, n = 1) => {
    await claims(n)
    return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [action, key(), JSON.stringify(body)])
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); await db.query('savepoint synthetic_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint synthetic_denial; release savepoint synthetic_denial')
    await admin(); eq(code, expected, `${label} SQLSTATE=${code ?? 'none'}`)
  }
  const functions = async () => (await db.query(`select p.oid::text,md5(pg_get_functiondef(p.oid)) body,
    p.proacl::text acl,p.proowner::text owner,p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('bx1_private','bx1_portal','public') and p.prokind='f'
    order by p.oid`)).rows
  const rowsDigest = () => scalar(`select md5(jsonb_build_object(
    'applications',(select jsonb_agg(to_jsonb(t) order by id) from bx1_portal.applications t),
    'accounts',(select jsonb_agg(to_jsonb(t) order by id) from bx1_portal.investment_accounts t),
    'organisations',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_organisations t),
    'memberships',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_memberships t),
    'factors',(select jsonb_agg(to_jsonb(t) order by id) from auth.mfa_factors t),
    'events',(select jsonb_agg(to_jsonb(t) order by id) from bx1_portal.events t),
    'requests',(select jsonb_agg(to_jsonb(t) order by actor_id,request_key) from bx1_portal.requests t),
    'scoped_requests',(select jsonb_agg(to_jsonb(t) order by actor_id,request_key) from bx1_portal.scoped_requests t),
    'bindings',(select jsonb_agg(to_jsonb(t) order by receipt_id,application_id,application_revision) from bx1_private.document_application_bindings t))::text)`)
  const identityDigest = () => scalar(`select md5(jsonb_build_object(
    'users',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t),
    'sessions',(select jsonb_agg(to_jsonb(t) order by id) from auth.sessions t),
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_profiles t),
    'persons',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.persons t),
    'principals',(select jsonb_agg(to_jsonb(t) order by auth_user_id) from bx1_private.person_principals t),
    'memberships',(select jsonb_agg(to_jsonb(t) order by id) from public.bx1_memberships t),
    'factors',(select jsonb_agg(to_jsonb(t) order by id) from auth.mfa_factors t))::text)`)
  const securityDigest = () => scalar(`select md5(jsonb_build_object(
    'roles',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,rolname,rolsuper,rolinherit,
      rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles) t),
    'edges',(select jsonb_agg(to_jsonb(t) order by roleid,member,grantor) from pg_auth_members t),
    'schemas',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,nspname,nspowner,nspacl
      from pg_namespace where nspname in ('auth','public','bx1_private','bx1_portal')) t),
    'tables',(select jsonb_agg(to_jsonb(t) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,
      c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('auth','public','bx1_private','bx1_portal')) t))::text)`)
  const scannerDigest = () => scalar(`select md5(jsonb_build_object(
    'policy',(select to_jsonb(t) from bx1_private.document_processing_policy t where singleton),
    'quarantine',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.document_quarantine_items t),
    'scan_events',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.document_scan_events t),
    'jobs',(select jsonb_agg(to_jsonb(t) order by document_id) from bx1_private.document_processing_jobs t),
    'attempts',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.document_processing_attempts t),
    'claims',(select jsonb_agg(to_jsonb(t) order by worker_id,request_id) from bx1_private.document_processing_claim_receipts t),
    'events',(select jsonb_agg(to_jsonb(t) order by id) from bx1_private.document_processing_events t))::text)`)
  const lifecycleTriggerEnabled = () => scalar(`select tgenabled::text from pg_trigger
    where tgrelid='bx1_private.document_lifecycle_policy'::regclass and tgname='bx1_document_lifecycle_activation'`)
  const policy = async (applicationId, n = 1, options = {}) => {
    await admin()
    await db.query(`insert into bx1_private.synthetic_compliance_cases(application_id,applicant_user_id,reviewer_user_id,
      reviewer_scope,valid_from,expires_at,release_reference) values($1,$2,$3,$4,
      clock_timestamp()-interval '1 hour',clock_timestamp()+($5::int*interval '1 hour'),$6)`,
    [applicationId, id(n), id(options.reviewer ?? 2), scope, options.hours ?? 720,
      'synthetic-cloud-proof:rc29-exact-case-owner-policy'])
  }
  const details = async (n, manager = false) => {
    const documents = (manager ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((kind, i) => ({
      id: id(300 + n * 10 + i + (manager ? 50 : 0)), kind, title: `Synthetic ${kind}`,
      storage_path: `${id(n)}/${id(300 + n * 10 + i + (manager ? 50 : 0))}`,
      sha256: 'b'.repeat(64), size: 100, mime_type: 'application/pdf',
    }))
    await admin()
    for (const d of documents) {
      await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
        values('bx1-portal-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}')`, [d.storage_path, id(n)])
      // Existing owner/server receipt function; the fixture supplies metadata,
      // not actual uploaded/scanned bytes. It still binds exactly at submission.
      await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8)',
        [id(n), id(100 + n), d.id, d.kind, d.title, d.sha256, d.size, d.mime_type])
    }
    return manager ? {
      details_version: 3, full_name: 'Synthetic applicant', country: 'ZA', company_name: 'Synthetic management firm',
      registration_reference: 'SYNTHETIC-COMPANY-001', beneficial_owners: 'Fictional controlling owner for this rehearsal only.',
      business_activities: 'Fictional investment management business for workflow testing only.',
      representative_position: 'Synthetic director', authority_basis: 'Fictional board authority to submit this TEST application only.',
      documents, test_data_acknowledged: true,
      ownership_change_reason: 'Initial fictional structured ownership disclosure for TEST only.',
      ownership_control: [{ id: id(500 + n), party_type: 'PERSON', legal_name: 'Synthetic controlling owner',
        registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
        control_basis: 'Fictional direct shareholding for this customer admission rehearsal only.', effective_on: '2026-09-01',
        change_reason: 'Initial fictional direct ownership disclosure.', evidence_document_id: documents[2].id }],
    } : {
      full_name: 'Synthetic applicant', country: 'ZA', investor_type: 'INDIVIDUAL', company_name: '', registration_reference: '',
      source_of_funds: 'Fictional savings only with no actual money or customer information.', beneficial_owners: '',
      experience: 'Fictional investment experience for this workflow rehearsal only.', documents, test_data_acknowledged: true,
    }
  }
  const submit = async (applicationId, revision, applicationDetails, n = 1) => {
    const state = await entry('submit_application', { application_id: applicationId, expected_revision: revision, details: applicationDetails }, n)
    return state.applications.find(a => a.id === applicationId)
  }
  const review = (a, decision = 'APPROVED') => ({ application_id: a.id, expected_revision: a.revision, decision,
    notes: 'Fictional manifest-only TEST rehearsal; not independent human or provider acceptance.', checks: reviewChecks })
  const proveHostedLockParity = async (investor, manager) => {
    await admin()
    const executor = 'bx1_synthetic_compliance_ci_lock_owner'
    const lockSignature = 'bx1_portal.lock_synthetic_compliance(jsonb,uuid)'
    const lockOid = await scalar('select $1::regprocedure::oid::text', [lockSignature])
    const oldLockDefinition = await scalar('select pg_get_functiondef($1::regprocedure)', [lockSignature])
    const normalize = text => text.replace(/\r\n/g, '\n')
    const oldLock = normalize(lockParitySql.match(/old_lock:=\$old\$([\s\S]*?)\$old\$/)?.[1] ?? '')
    const newLock = normalize(lockParitySql.match(/new_lock:=\$new\$([\s\S]*?)\$new\$/)?.[1] ?? '')
    truth(oldLock && newLock, 'exact frozen corrective lock replacement present')
    eq(normalize(oldLockDefinition).split(oldLock).length, 2, 'one old direct principal lock before correction')
    eq(await scalar('select count(*)::int from pg_roles where rolname=$1', [executor]), 0, 'parity executor absent initially')
    const nativeProbeActor = await scalar('select auth_user_id from bx1_private.person_principals order by auth_user_id limit 1')
    truth(nativeProbeActor, 'preceding committed fixture supplies actual mapped principal lock target')
    const probe = clients[0]
    const probePrincipal = async () => {
      await probe.query('begin'); await admin(probe)
      try { return (await probe.query('select auth_user_id from bx1_private.person_principals where auth_user_id=$1 for update nowait', [nativeProbeActor])).rows.length }
      finally { await probe.query('rollback') }
    }
    eq(await probePrincipal(), 1, 'committed mapped principal is lockable before isolated parity probe')
    const beforeRows = await rowsDigest(), beforeIdentity = await identityDigest(), beforeSecurity = await securityDigest()
    const beforeFunctions = await functions()
    const installExecutor = async () => {
      await db.query(`create role ${executor} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
        grant usage on schema auth,public,bx1_private to ${executor};
        grant usage,create on schema bx1_portal to ${executor};
        grant select,update on bx1_portal.entry_configuration,bx1_private.synthetic_compliance_cases,
          bx1_portal.applications,auth.users,auth.sessions,auth.mfa_factors,
          public.bx1_profiles,public.bx1_organisations,public.bx1_memberships to ${executor};
        grant select on bx1_private.person_principals to ${executor};
        grant execute on function bx1_portal.synthetic_compliance_context(jsonb),
          bx1_private.lock_funding_person(uuid,uuid) to ${executor};
        alter function bx1_portal.lock_synthetic_compliance(jsonb,uuid) owner to ${executor};
        grant execute on function bx1_portal.lock_synthetic_compliance(jsonb,uuid) to postgres`)
      eq(await scalar(`select not rolsuper and not rolinherit and not rolcanlogin and not rolcreaterole
        and not rolcreatedb and not rolreplication and rolbypassrls from pg_roles where rolname=$1`, [executor]), true,
      'lock body itself executes as non-superuser with hosted-like RLS visibility')
      eq(await scalar("select has_table_privilege($1,'bx1_private.person_principals','SELECT')", [executor]), true, 'parity executor has native principal SELECT')
      eq(await scalar("select has_any_column_privilege($1,'bx1_private.person_principals','UPDATE')", [executor]), false, 'parity executor has no native principal row-lock or UPDATE privilege')
      eq(await scalar("select pg_has_role($1,'bx1_authority_owner','MEMBER')", [executor]), false, 'parity executor cannot inherit or set private identity owner')
      eq(await scalar('select proowner=$2::regrole from pg_proc where oid=$1::regprocedure', [lockSignature, executor]), true, 'SECURITY DEFINER parent owner, not only caller, is non-superuser')
    }
    const assertRestored = async (expectedFunctions, label) => {
      await admin()
      eq(await functions(), expectedFunctions, `${label} all function owners/ACLs/bodies/config restored`)
      eq(await securityDigest(), beforeSecurity, `${label} all roles/edges/schema and table grants restored`)
      eq(await rowsDigest(), beforeRows, `${label} business and evidence rows restored`)
      eq(await identityDigest(), beforeIdentity, `${label} identity/session/factor/role data restored`)
      eq(await scalar('select count(*)::int from pg_roles where rolname=$1', [executor]), 0, `${label} disposable executor removed`)
    }
    await db.query('savepoint uncorrected_hosted_lock_parity')
    await installExecutor()
    let uncorrectedDiagnostic
    await denied('uncorrected hosted-like full public read reproduces native lock permission failure',
      () => read().catch(error => { uncorrectedDiagnostic = error.message; throw error }))
    truth(/permission denied for table person_principals/.test(uncorrectedDiagnostic ?? ''), 'old denial is specifically native principal permission, not earlier authority gate')
    await admin(); await db.query('rollback to savepoint uncorrected_hosted_lock_parity; release savepoint uncorrected_hosted_lock_parity')
    await assertRestored(beforeFunctions, 'uncorrected parity rollback')
    await db.query(lockParitySql)
    const correctedFunctions = await functions()
    for (const previous of beforeFunctions) {
      const actual = correctedFunctions.find(f => f.oid === previous.oid)
      eq(previous.oid === lockOid ? { ...actual, body: previous.body } : actual, previous,
        `corrective install preserves function ${previous.oid} except exact target lock body`)
    }
    eq(correctedFunctions.length, beforeFunctions.length, 'correction creates no new function or helper')
    eq(normalize(await scalar('select pg_get_functiondef($1::regprocedure)', [lockSignature])),
      normalize(oldLockDefinition).replace('declare actor uuid:=auth.uid();', 'declare actor uuid:=auth.uid(); locked_actor uuid;').replace(oldLock, newLock),
      'only declaration and direct principal lock changed; every other guard/lock retained')
    eq(await securityDigest(), beforeSecurity, 'corrective feature changes no roles/edges/schema/table grants')
    eq(await rowsDigest(), beforeRows, 'corrective feature changes no business/evidence rows')
    eq(await identityDigest(), beforeIdentity, 'corrective feature changes no native identity/session/factor data')
    await db.query('savepoint corrected_hosted_lock_parity')
    await installExecutor()
    eq((await read()).applications.map(a => a.id).sort(), [investor.id, manager.id].sort(), 'corrected non-super lock owner permits full exact designated public projection')
    const rfi = await command(review(investor, 'CHANGES_REQUIRED'))
    eq(rfi.applications.find(a => a.id === investor.id).status, 'CHANGES_REQUIRED', 'corrected non-super lock owner permits same canonical public RFI command')
    await denied('non-super parity preserves normal full reader AAL2 boundary', async () => {
      await claims(); await scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)])
    })
    // This committed mapped row comes from the preceding synthetic fixture,
    // not a new no-profile applicant mapping. Prove the unchanged authority-
    // owner helper takes an actual conflicting row lock, not a zero-row no-op.
    await claims(); await db.query(`set local role ${executor}`)
    await scalar('select bx1_private.lock_funding_person($1,null)', [nativeProbeActor])
    let lockConflict
    try { await probePrincipal() } catch (error) { lockConflict = error.code }
    eq(lockConflict, '55P03', 'existing owner helper locks actual mapped principal against a distinct backend')
    await admin(); await db.query('rollback to savepoint corrected_hosted_lock_parity; release savepoint corrected_hosted_lock_parity')
    await assertRestored(correctedFunctions, 'corrected parity rollback')
    eq(await probePrincipal(), 1, 'isolated mapped-principal lock released after parity rollback')
    eq((await read()).applications.map(a => a.id).sort(), [investor.id, manager.id].sort(), 'corrected ordinary owner queue intact after non-super scenario')
    await admin()
  }
  try {
    await begin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable owner')
    const inheritedLifecycleMode = await scalar('select mode from bx1_private.document_lifecycle_policy where singleton')
    const inheritedScannerHistory = await scannerDigest()
    eq(inheritedLifecycleMode, 'SCANNER_REQUIRED', 'preceding scanner/entity proof state is intentional and recorded')
    eq(await lifecycleTriggerEnabled(), 'O', 'native no-downgrade trigger initially enabled')
    const oldFunctions = await functions()
    const oldPolicies = (await db.query('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3')).rows
    const oldRows = await rowsDigest()
    const originalDefinition = await scalar("select pg_get_functiondef('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure)")
    // Model the installed rc28 writer for the additive cutover, including OID
    // preservation. The source-built writer already delegates at base install.
    const oldBranch = featureSql.match(/old_branch:=\$old\$([\s\S]*?)\$old\$/)?.[1]
    const delegatedBranch = featureSql.match(/delegated_branch:=\$new\$([\s\S]*?)\$new\$/)?.[1]
    truth(oldBranch && delegatedBranch, 'frozen exact old and delegated branches present')
    const normalize = text => text.replace(/\r\n/g, '\n')
    const live = normalize(originalDefinition), delegated = normalize(delegatedBranch)
    eq(live.split(delegated).length, 2, 'one sole review delegation in base writer')
    await db.query('savepoint installed_rc28_cutover')
    await db.query(live.replace(delegated, normalize(oldBranch)))
    await db.query('drop function bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)')
    eq(await scalar("select to_regprocedure('bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)') is null"), true, 'installed rc28 fixture has no future transition helper')
    await db.query(featureSql)
    eq(normalize(await scalar("select pg_get_functiondef('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure)")),
      live, 'installed exact old branch replaced with sole canonical transition only')
    const writerOid = await scalar("select 'bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure::oid::text")
    const installedWriter = (await functions()).find(f => f.oid === writerOid)
    const priorWriter = oldFunctions.find(f => f.oid === writerOid)
    eq({ ...installedWriter, body: priorWriter.body }, priorWriter, 'installed cutover preserves writer OID/owner/ACL/config/security mode')
    await db.query('rollback to savepoint installed_rc28_cutover; release savepoint installed_rc28_cutover')
    await db.query(featureSql)
    const afterFunctions = await functions()
    for (const previous of oldFunctions) {
      const actual = afterFunctions.find(f => f.oid === previous.oid)
      eq(actual, previous, `fresh-install existing function OID ${previous.oid} authority/ACL/body retained`)
    }
    eq((await db.query('select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies order by 1,2,3')).rows, oldPolicies, 'all existing RLS policies unchanged')
    eq(await rowsDigest(), oldRows, 'feature installation mutates no cases/accounts/roles/factors/evidence')
    eq(await scalar('select count(*)::int from bx1_private.synthetic_compliance_cases'), 0, 'no policy or live case seeded')
    for (const role of ['anon', 'service_role']) {
      for (const signature of ['public.bx1_portal_synthetic_compliance_read(jsonb)', 'public.bx1_portal_synthetic_compliance_command(jsonb,text,uuid,jsonb)'])
        eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false, `${role} denied ${signature}`)
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      eq(await scalar("select has_function_privilege($1,'bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)','EXECUTE')", [role]), false, `${role} cannot call sole transition`)
      eq(await scalar("select has_table_privilege($1,'bx1_private.synthetic_compliance_cases','SELECT,INSERT,UPDATE,DELETE')", [role]), false, `${role} cannot edit policy`)
    }
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await denied('unchanged native scanner policy forbids downgrade',
      () => db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton"), '55000')
    // Exact disposable-owner fixture selection only, not an admitted command or
    // operational scanner downgrade. The preceding suite deliberately commits
    // SCANNER_REQUIRED; this separate synthetic rehearsal must model TEST's
    // actual SYNTHETIC_UNSCANNED configuration. Reenable before ANY business RPC.
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    eq(await lifecycleTriggerEnabled(), 'O', 'no-downgrade trigger active before all rehearsal RPCs')
    eq(await scalar("select mode='SYNTHETIC_TEST_ONLY' from bx1_private.document_lifecycle_policy where singleton"), true, 'isolated disposable synthetic mode selected; no scanner acceptance claim')
    eq(await scannerDigest(), inheritedScannerHistory, 'fixture selection changes no scanner admission, job, attempt or scan evidence')
    for (let n = 1; n <= 4; n++) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(n), `synthetic-compliance-${n}@example.invalid`])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),$3)", [id(100 + n), id(n), n === 3 ? 'aal2' : 'aal1'])
      if ([2, 3].includes(n)) {
        await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Synthetic reviewer ${n}`])
        await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(200 + n), id(n)])
        if (n === 3) await db.query('update auth.sessions set factor_id=$1 where id=$2', [id(203), id(103)])
        await db.query("insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,'ComplianceOfficer')", [id(400 + n), id(n), scope])
      }
    }
    await denied('no designated case denies even native reviewer', () => read())
    let investor = (await entry('start_application', { persona: 'INVESTOR' })).applications.find(a => a.persona === 'INVESTOR')
    let manager = (await entry('start_application', { persona: 'WEALTH_MANAGER' })).applications.find(a => a.persona === 'WEALTH_MANAGER')
    await policy(investor.id); await policy(manager.id)
    eq((await read()).applications, [], 'DRAFT policies never expose draft facts')
    await denied('policy cannot be client edited', async () => { await claims(); await db.query('update bx1_private.synthetic_compliance_cases set expires_at=clock_timestamp()+interval \'90 days\'') })
    await denied('owner policy immutable scope', () => db.query('update bx1_private.synthetic_compliance_cases set reviewer_user_id=$1 where application_id=$2', [id(3), investor.id]), '23514')
    await denied('owner policy revocation needs reason', () => db.query('update bx1_private.synthetic_compliance_cases set revoked_at=clock_timestamp() where application_id=$1', [investor.id]), '23514')
    const investorDetails = await details(1), managerDetails = await details(1, true)
    investor = await submit(investor.id, investor.revision, investorDetails)
    manager = await submit(manager.id, manager.revision, managerDetails)
    await proveHostedLockParity(investor, manager)
    const snapshot = await read()
    eq(snapshot.rehearsal, { version: 1, environment: 'TESTNET', mode: 'SYNTHETIC_COMPLIANCE', actor_id: id(2), operating_context: context }, 'exact strict rehearsal marker')
    eq(Object.keys(snapshot).sort(), ['actor', 'applications', 'events', 'operating_context', 'organisations', 'products', 'rehearsal', 'requests', 'subscriptions'], 'fixed minimal projection')
    eq(snapshot.applications.map(a => a.id).sort(), [investor.id, manager.id].sort(), 'only two exact submitted designated cases')
    eq([snapshot.organisations, snapshot.products, snapshot.subscriptions], [[], [], []], 'no broad authority/finance projection')
    eq(snapshot.applications.find(a => a.id === investor.id).details, investorDetails, 'captured immutable submitted manifest projected')
    await admin()
    eq(await scalar('select count(*)::int from public.bx1_profiles where id=$1', [id(1)]), 0, 'ordinary applicant never acquired native profile prerequisite')
    for (const [label, c, n, extra] of [
      ['applicant context', applicant, 2, {}], ['arbitrary organisation', { ...context, organisationId: id(499) }, 2, {}],
      ['wrong role', { ...context, role: 'SuperAdmin' }, 2, {}], ['extra client authority', { ...context, synthetic: true }, 2, {}],
      ['self applicant', context, 1, {}], ['MAIN issuer', context, 2, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }],
      ['wrong live session', context, 2, { session_id: id(101) }], ['recovery AMR', context, 2, { amr: [{ method: 'recovery' }] }],
      ['expired JWT', context, 2, { exp: Math.floor(Date.now() / 1000) - 1 }], ['missing AMR', context, 2, { amr: undefined }],
    ]) await denied(label, () => read(c, n, extra))
    await db.query('savepoint otherwise_eligible_reviewer')
    await db.query("update auth.sessions set aal='aal1' where id=$1", [id(103)])
    const ordinaryReviewerClaims = { aal: 'aal1', amr: [{ method: 'password' }] }
    await claims(3, ordinaryReviewerClaims); await admin()
    eq(await scalar('select bx1_portal.test_ordinary_entry_session()'), true, 'different reviewer satisfies ordinary enrolled AAL1 password session')
    eq(await scalar('select bx1_portal.native_membership_effective($1)', [id(403)]), true, 'different reviewer has effective same-scope Compliance membership')
    await denied('otherwise eligible reviewer not designated cannot read', () => read(context, 3, ordinaryReviewerClaims))
    await denied('otherwise eligible reviewer not designated cannot command',
      () => command(review(investor), key(), context, 3, 'review_application', ordinaryReviewerClaims))
    await db.query('rollback to savepoint otherwise_eligible_reviewer; release savepoint otherwise_eligible_reviewer')
    for (const action of ['submit_application', 'create_investment_account', 'apply_representative_mandate', 'review_representative_mandate', 'reconcile_funding'])
      await denied(`${action} not in rehearsal command allowlist`, () => command(review(investor), key(), context, 2, action))
    await denied('arbitrary case absent policy', () => command({ ...review(investor), application_id: id(599) }))
    await denied('stale submitted revision', () => command({ ...review(investor), expected_revision: investor.revision + 1 }), '23514')
    await denied('approval incomplete checks', () => command({ ...review(investor), checks: { ...reviewChecks, screening: false } }), '23514')
    await denied('extra payload authority', () => command({ ...review(investor), bypass: true }), '22023')
    const beforeRollback = await rowsDigest()
    await db.query('savepoint failed_audit')
    await db.query(`create function bx1_portal.synthetic_fixture_audit_failure() returns trigger language plpgsql as $$
      begin if NEW.actor_id='${id(2)}'::uuid and NEW.kind='review_application' then raise exception 'synthetic audit failure' using errcode='23514'; end if; return NEW; end $$;
      create trigger synthetic_fixture_audit_failure before insert on bx1_portal.events for each row execute function bx1_portal.synthetic_fixture_audit_failure()`)
    await denied('canonical decision rolls back on missing audit', () => command(review(investor)), '23514')
    eq(await rowsDigest(), beforeRollback, 'audit failure leaves application/account/authority/evidence unchanged')
    await db.query('rollback to savepoint failed_audit; release savepoint failed_audit')
    const rfiBody = review(investor, 'CHANGES_REQUIRED'), rfiKey = key()
    investor = (await command(rfiBody, rfiKey)).applications.find(a => a.id === investor.id)
    eq([investor.status, investor.revision], ['CHANGES_REQUIRED', rfiBody.expected_revision + 1], 'RFI uses same canonical case transition')
    eq((await command(rfiBody, rfiKey)).applications.find(a => a.id === investor.id), investor, 'exact request replay sees current same record')
    await denied('conflicting idempotency body', () => command({ ...rfiBody, notes: 'Changed fictional note must not replace the prior request.' }, rfiKey), '23505')
    await admin(); eq(await scalar("select count(*)::int from bx1_portal.events where subject_id=$1 and kind='review_application'", [investor.id]), 1, 'one event for one decision including retry')
    eq((await read()).applications.find(a => a.id === investor.id).status, 'CHANGES_REQUIRED', 'RFI remains visible at original submitted revision binding')
    investor = await submit(investor.id, investor.revision, investorDetails)
    eq((await read()).applications.find(a => a.id === investor.id).reviewer_id, null, 'normal resubmit clears old review fields')
    investor = (await command(review(investor, 'REJECTED'))).applications.find(a => a.id === investor.id)
    eq(investor.status, 'REJECTED', 'rejection remains visible without provider clearance')
    investor = await submit(investor.id, investor.revision, investorDetails)
    investor = (await command(review(investor))).applications.find(a => a.id === investor.id)
    eq(investor.status, 'APPROVED', 'same investor case approved after unchanged normal resubmission')
    await claims(1)
    const accountKey = key()
    const accountState = await scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      ['create_investment_account', accountKey, JSON.stringify({ application_id: investor.id }), JSON.stringify(applicant)])
    truth(accountState.accounts.some(a => a.application_id === investor.id), 'normal applicant command opens same approved individual account')
    await admin(); const nativeBeforeManager = await scalar('select count(*)::int from public.bx1_memberships')
    manager = (await command(review(manager))).applications.find(a => a.id === manager.id)
    truth(manager.organisation_id, 'normal manager approval creates only canonical customer organisation')
    await admin(); eq(await scalar('select count(*)::int from public.bx1_memberships'), nativeBeforeManager, 'manager approval grants no native role or operational workspace')
    const mandateState = await entry('request_representative_mandate', { application_id: manager.id, expected_revision: 0,
      evidence_reference: 'Fictional next-owner TEST mandate request only.', requested_until: new Date(Date.now() + 86400000).toISOString() })
    truth(mandateState.organisation_mandates.some(m => m.application_id === manager.id && m.status === 'SUBMITTED'), 'unchanged manager request reaches next Compliance/SA owner, not activated authority')
    await denied('terminal case cannot accept new decision', () => command(review(investor)), '23514')
    await db.query('savepoint different_historical_reviewer')
    await db.query('update bx1_portal.applications set reviewer_id=$1 where id=$2', [id(3), manager.id])
    eq((await read()).applications.map(a => a.id), [investor.id], 'different historical reviewer omitted without poisoning entire strict queue')
    await admin(); await db.query('rollback to savepoint different_historical_reviewer; release savepoint different_historical_reviewer')
    for (const [label, sql, values] of [
      ['full business reader still AAL2', 'select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(context)]],
      ['normal review writer still AAL2', 'select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', ['review_application', key(), JSON.stringify(review(manager)), JSON.stringify(context)]],
      ['provider evidence private', 'select public.bx1_provider_evidence_read($1)', [investor.id]],
      ['private helper direct grant absent', 'select bx1_portal.synthetic_compliance_projection($1::jsonb)', [JSON.stringify(context)]],
      ['private byte download remains denied', 'select count(*)::int from storage.objects where bucket_id=\'bx1-portal-documents\' and name=$1', [investorDetails.documents[0].storage_path]],
    ]) {
      if (label.startsWith('private byte')) { await claims(); eq(await scalar(sql, values), 0, label) }
      else await denied(label, async () => { await claims(); await scalar(sql, values) })
    }
    await admin()
    const beforeKnownPersonIdentity = await identityDigest()
    eq(await scalar('select count(*)::int from public.bx1_profiles where id=$1', [id(1)]), 0, 'ordinary positive flow still has no applicant native profile before isolated identity negative')
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[id(1), id(2)]]), 0, 'neither fictional login is mapped before isolated identity negative')
    eq(await scalar('select count(*)::int from bx1_private.persons where id=$1', [id(450)]), 0, 'fictional same-person identity absent before isolated negative')
    await db.query('savepoint same_person')
    // Canonical principal FK requires a native profile, but only this fictional
    // negative scenario supplies one. No factor/membership or applicant entry
    // prerequisite is added; rollback must remove the whole identity setup.
    await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(1), 'Synthetic known-person negative scenario only'])
    await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Synthetic known same person','TRUSTED','synthetic:rc29-same-person',$2)", [id(450), id(451)])
    for (const n of [1, 2]) await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','synthetic:rc29-same-person-principal',$3)", [id(n), id(450), id(451 + n)])
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[]) and person_id=$2', [[id(1), id(2)], id(450)]), 2, 'known-person denial uses actual canonical mapping prerequisites')
    eq((await read()).applications, [], 'known same person denies even existing designated cases')
    await denied('known same person cannot review', () => command(review(investor)))
    await admin(); await db.query('rollback to savepoint same_person; release savepoint same_person')
    eq(await identityDigest(), beforeKnownPersonIdentity, 'isolated identity negative restores all native identity, session, role and factor rows exactly')
    eq(await scalar('select count(*)::int from public.bx1_profiles where id=$1', [id(1)]), 0, 'ordinary applicant remains without native profile after identity rollback')
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[id(1), id(2)]]), 0, 'both fictional principal mappings disappear after identity rollback')
    eq(await scalar('select count(*)::int from bx1_private.persons where id=$1', [id(450)]), 0, 'fictional same-person record disappears after identity rollback')
    eq((await read()).applications.map(a => a.id).sort(), [investor.id, manager.id].sort(), 'designated queue restored after isolated known-person denial')
    await denied('banned applicant case omitted without poisoning queue', async () => {
      await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [id(1)])
      eq((await read()).applications, [], 'designated banned applicant omitted')
      await command(review(investor))
    })
    await denied('MAIN config cannot use TEST policy', async () => {
      await db.query("update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false,environment='MAINNET',manual_test_review=false,reviewer_scope=null where singleton")
      await read()
    })
    // A non-designated ordinary application remains reviewable ONLY through the
    // genuine AAL2 source path, proving the sole transition did not break it.
    let ordinary = (await entry('start_application', { persona: 'INVESTOR' }, 4)).applications.find(a => a.persona === 'INVESTOR')
    ordinary = await submit(ordinary.id, ordinary.revision, await details(4), 4)
    await denied('unlisted submitted case cannot be reviewed at AAL1', () => command(review(ordinary)))
    await policy(ordinary.id, 4, { hours: 0 })
    await denied('expired owner policy cannot review a submitted case', () => command(review(ordinary)))
    await denied('expired policy cannot be extended', () => db.query("update bx1_private.synthetic_compliance_cases set expires_at=clock_timestamp()+interval '30 days' where application_id=$1", [ordinary.id]), '23514')
    await claims(3)
    const normalState = await scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', ['review_application', key(), JSON.stringify(review(ordinary)), JSON.stringify(context)])
    eq(normalState.applications.find(a => a.id === ordinary.id).status, 'APPROVED', 'ordinary AAL2 review still calls sole canonical transition')
    eq((await read()).applications.length, 2, 'unlisted normal review never leaks into designated queue')
    await admin(); const protectedAfter = await functions()
    for (const previous of oldFunctions)
      eq(protectedAfter.find(f => f.oid === previous.oid), previous, `protected existing function ${previous.oid} still unchanged`)
    await commit()
    // Real cloud backend overlap: session expiry and policy revocation after a
    // lock wait must be rechecked before any manifest projection is returned.
    for (const kind of ['session', 'policy']) {
      const blocker = clients[0], waiting = clients[1]
      await blocker.query('begin'); await admin(blocker)
      try {
        const locked = kind === 'session'
          ? ['select id from auth.sessions where id=$1 for update', id(102)]
          : ['select application_id from bx1_private.synthetic_compliance_cases where reviewer_user_id=$1 order by application_id for update', id(2)]
        await blocker.query(locked[0], [locked[1]])
        await waiting.query('begin'); await claims(2, {}, waiting)
        const pid = await scalar('select pg_backend_pid()', [], waiting)
        const outcome = waiting.query('select public.bx1_portal_synthetic_compliance_read($1::jsonb)', [JSON.stringify(context)]).then(() => ({ code: null }), error => ({ code: error.code }))
        let blocked = false
        const deadline = Date.now() + 10000
        while (Date.now() < deadline) {
          if (await scalar('select cardinality(pg_blocking_pids($1))>0', [pid])) { blocked = true; break }
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        truth(blocked, `${kind} proof observes genuine distinct-backend lock wait`)
        if (kind === 'session') await blocker.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(102)])
        else await blocker.query("update bx1_private.synthetic_compliance_cases set revoked_at=clock_timestamp(),revocation_reason='Owner revoked exact fictional case after actual lock wait.' where reviewer_user_id=$1", [id(2)])
        await blocker.query('commit')
        eq((await outcome).code, '42501', `${kind} authority changed after wait denies projection`)
        await waiting.query('rollback')
      } finally {
        await blocker.query('rollback').catch(() => {}); await waiting.query('rollback').catch(() => {})
      }
      if (kind === 'session') {
        await begin(); await db.query("update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id=$1", [id(102)]); await commit()
      }
    }
    await begin()
    await denied('revoked exact policy cannot be reopened', () => db.query('update bx1_private.synthetic_compliance_cases set revoked_at=null,revocation_reason=null where application_id=$1', [investor.id]), '23514')
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton')
    await denied('ordinary temporary switch left off', () => read())
    // Restore through the unchanged guarded synthetic -> scanner upgrade; no
    // trigger override is used here, and prior producer/evidence stays exact.
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [inheritedLifecycleMode])
    eq(await scalar('select mode from bx1_private.document_lifecycle_policy where singleton'), inheritedLifecycleMode, 'original scanner-required fixture mode restored via native upgrade')
    eq(await lifecycleTriggerEnabled(), 'O', 'native lifecycle trigger remains active at completion')
    eq(await scannerDigest(), inheritedScannerHistory, 'all preceding scanner producer and immutable evidence preserved')
    await commit()
    console.log(`BX1_SYNTHETIC_COMPLIANCE_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 writer=sole-canonical-review actorScope=exact-owner-policy investor=normal-submit-rfi-resubmit-review-account manager=normal-submit-review-mandate-request-only auditRollback=proven dedupe=proven concurrency=session-and-policy-after-wait hostedPrivilegeParity=non-super-SELECT-only-principal main=denied factors=preserved hostedAcceptance=not-proven independentHumans=not-proven providerAcceptance=not-proven documentBytes=not-proven mandateApply=not-relaxed`)
    return checks
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
  }
}
