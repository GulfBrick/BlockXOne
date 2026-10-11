import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Invoked by test-portal.mjs in its exact disposable GitHub PostgreSQL17
// fixture only. Business fields are written only through the existing public
// entry/scoped RPCs. Owner setup models fictional Auth/Storage inputs, never
// uploaded bytes, scanner/provider acceptance or independently verified people.
export async function proveAdmissionWorkflow(db, clients, featureSql) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Admission workflow proof requires exact disposable cloud fixture')
  assert.equal(clients.length, 2, 'two existing cloud backends required')
  let checks = 0, begun = false, sequence = 1000, phase = 'baseline'
  const id = n => `ef820000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const otherScope = id(950)
  const applicant = { mode: 'APPLICANT' }
  const role = (name, organisationId = scope) => ({ mode: 'ROLE', organisationId, role: name })
  const reviewer = role('ComplianceOfficer'), applier = role('SuperAdmin')
  const commands = {
    APPLICANT: ['start_application', 'submit_application', 'create_investment_account',
      'create_entity_investment_account', 'request_representative_mandate', 'request_investing_representative_mandate'],
    ComplianceOfficer: ['review_application', 'review_representative_mandate', 'review_investing_representative_mandate'],
    SuperAdmin: ['apply_representative_mandate', 'apply_investing_representative_mandate'],
  }
  const allCommands = Object.values(commands).flat()
  const checksForReview = { identity: true, ownership: true, screening: true, suitability: true }
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const claims = async (n, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: 'aal1',
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const entryRead = async n => { await claims(n); return scalar('select public.bx1_entry_read()') }
  const read = async (n, c = applicant, extra = {}) => {
    await claims(n, extra)
    return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(c)])
  }
  const entry = async (n, action, body, requestKey = key()) => {
    await claims(n)
    return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [action, requestKey, JSON.stringify(body)])
  }
  const command = async (n, c, action, body, requestKey = key(), extra = {}) => {
    await claims(n, extra)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      [action, requestKey, JSON.stringify(body), JSON.stringify(c)])
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); await db.query('savepoint admission_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint admission_denial; release savepoint admission_denial')
    await admin()
    truth((Array.isArray(expected) ? expected : [expected]).includes(code), `${label}: SQLSTATE=${code ?? 'none'}`)
  }
  const isolated = async run => {
    await admin(); await db.query('savepoint admission_isolation')
    try { await run() }
    finally { await db.query('rollback to savepoint admission_isolation; release savepoint admission_isolation'); await admin() }
  }
  const access = (snapshot, n, c = applicant) => {
    eq(Object.keys(snapshot.stage2_access ?? {}).sort(), ['actor_id', 'allowed_commands', 'environment',
      'operating_context', 'session_mode', 'version'], 'normal snapshot has exact Stage2 capability shape')
    eq({ ...snapshot.stage2_access, allowed_commands: undefined }, {
      version: 1, environment: 'TESTNET', actor_id: id(n), operating_context: c,
      session_mode: 'TEST_PASSWORD', allowed_commands: undefined,
    }, 'normal capability binds exact actor/context/environment/assurance')
    const allowed = snapshot.stage2_access.allowed_commands
    eq(allowed.length, new Set(allowed).size, 'capability has unique commands')
    eq([...allowed].sort(), [...(commands[c.mode === 'APPLICANT' ? 'APPLICANT' : c.role] ?? [])].sort(),
      'capability command names are exactly narrowed to current capacity')
    eq(snapshot.rehearsal, undefined, 'normal snapshot is never synthetic rehearsal authority')
    return snapshot
  }
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      md5(pg_get_functiondef(p.oid)) body,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','public','bx1_private','bx1_portal') and p.prokind='f' order by p.oid`)).rows
  }
  const protectedFunctions = async () => (await functions()).filter(f => [
    'has_session', 'fresh_session', 'valid_operating_context', 'scoped_reviewer', 'representative_mandate_actor',
    'entity_staff_source_assured', 'entity_people_independent', 'entity_account_admission_current',
    'investing_mandate_current', 'investing_mandate_effective', 'review_application_transition',
    'test_ordinary_entry_session',
  ].includes(f.proname) || f.nspname === 'bx1_private' && /mfa|token_assured|has_active_session/.test(f.proname))
  const fingerprint = async () => {
    await admin()
    const tables = (await db.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and (n.nspname in ('auth','storage','bx1_private','bx1_portal')
        or n.nspname='public' and c.relname like 'bx1_%') order by 1,2`)).rows
    const result = {}
    for (const { nspname, relname } of tables) {
      assert.match(nspname, /^[a-z0-9_]+$/); assert.match(relname, /^[a-z0-9_]+$/)
      result[`${nspname}.${relname}`] = await scalar(`select md5(coalesce(jsonb_agg(to_jsonb(t)
        order by to_jsonb(t)::text)::text,'')) from ${nspname}.${relname} t`)
    }
    return result
  }
  const security = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,rolname,rolsuper,rolinherit,
        rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles) t),
      'edges',(select jsonb_agg(to_jsonb(t) order by roleid,member,grantor) from pg_auth_members t),
      'relations',(select jsonb_agg(to_jsonb(t) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,
        c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) t),
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t))`)
  }
  const selectedFingerprints = async names => {
    const all = await fingerprint()
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  const authorityTables = ['auth.users', 'auth.sessions', 'auth.mfa_factors', 'public.bx1_profiles',
    'public.bx1_memberships', 'public.bx1_organisations', 'bx1_private.persons', 'bx1_private.person_principals']
  let financeTables
  const scannerTables = ['bx1_private.document_processing_policy', 'bx1_private.document_quarantine_items',
    'bx1_private.document_scan_events', 'bx1_private.document_processing_jobs',
    'bx1_private.document_processing_attempts', 'bx1_private.document_processing_claim_receipts',
    'bx1_private.document_processing_events']
  const review = (a, decision = 'APPROVED') => ({ application_id: a.id, expected_revision: a.revision,
    decision, notes: 'Fictional TEST admission decision only; not provider, scanner or independent-human acceptance.',
    checks: checksForReview })
  const submit = async (n, a, details, requestKey = key()) =>
    (await entry(n, 'submit_application', { application_id: a.id, expected_revision: a.revision, details }, requestKey))
      .applications.find(value => value.id === a.id)
  const applicationFrom = (snapshot, applicationId) => snapshot.applications.find(value => value.id === applicationId)
  const details = async (n, kind = 'INDIVIDUAL') => {
    const company = kind !== 'INDIVIDUAL'
    const documents = (company ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((type, i) => ({
      id: id(300 + n * 10 + i), kind: type, title: `Fictional admission ${type}`,
      storage_path: `${id(n)}/${id(300 + n * 10 + i)}`, sha256: 'c'.repeat(64), size: 100, mime_type: 'application/pdf',
    }))
    await admin()
    for (const d of documents) {
      await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
        values('bx1-portal-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}')`, [d.storage_path, id(n)])
      await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8)',
        [id(n), id(100 + n), d.id, d.kind, d.title, d.sha256, d.size, d.mime_type])
    }
    const common = { full_name: `Fictional Applicant ${n}`, country: 'ZA', documents, test_data_acknowledged: true }
    const companyFields = { company_name: `Fictional Company ${n}`, registration_reference: `FICTIONAL-${n}`,
      beneficial_owners: 'One fictional controlling owner; no actual company or customer evidence.' }
    const ownership = company ? { details_version: 3, ownership_change_reason: 'Initial fictional structured ownership for TEST admission.',
      ownership_control: [{ id: id(500 + n), party_type: 'PERSON', legal_name: 'Fictional Controlling Owner',
        registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
        control_basis: 'Fictional direct shareholding for disposable workflow proof only.', effective_on: '2026-09-01',
        change_reason: 'Initial fictional ownership disclosure.', evidence_document_id: documents[2].id }] } : {}
    if (kind === 'MANAGER') return { ...common, ...companyFields, ...ownership,
      business_activities: 'Fictional investment management activity for isolated TEST workflow checks.',
      representative_position: 'Fictional authorised director',
      authority_basis: 'Fictional board authority to submit this TEST application only; not platform signing authority.' }
    return { ...common, investor_type: kind, company_name: '', registration_reference: '', beneficial_owners: '',
      source_of_funds: 'Fictional savings only; no real money or customer information.',
      experience: 'Fictional experience disclosed for this workflow proof only.',
      ...(company ? { ...companyFields, ...ownership } : {}) }
  }
  let baselineFunctions, baselineRows, baselineSecurity
  const externalRestores = []
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable owner')
    truth(Number(await scalar('show server_version_num')) >= 170000 && Number(await scalar('show server_version_num')) < 180000,
      'existing fixture uses PostgreSQL17')
    baselineFunctions = await functions(); baselineRows = await fingerprint(); baselineSecurity = await security()
    financeTables = Object.keys(baselineRows).filter(name => /^bx1_portal\.(products|subscriptions|funding_|holdings|positions|ledger)/.test(name))
    truth(financeTables.includes('bx1_portal.products') && financeTables.includes('bx1_portal.subscriptions'),
      'financial fingerprint includes actual installed product and subscription state')
    await db.query('begin'); begun = true
    // A complete rollback restores ALL new functions, helpers, fictional rows,
    // trigger setup and configuration. No new fixture is committed for races.
    phase = 'canonical-helper-prerequisite'
    if (await scalar("select to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null")) {
      eq(await scalar(`select count(*)::int from pg_class where oid in
        ('bx1_private.person_principals'::regclass,'bx1_private.persons'::regclass)
        and relowner='bx1_authority_owner'::regrole and relrowsecurity`), 2, 'canonical private authority owner and identity tables exist')
      eq(await scalar(`select count(*)::int from pg_roles where rolname in
        ('bx1_authority_owner','bx1_wallet_owner','bx1_wallet_verifier')`), 3, 'canonical helper revoke-target roles already exist')
      const funding = await readFile(new URL('../../../supabase/features/bx1_portal_funding.sql', import.meta.url), 'utf8')
      const helper = funding.match(/create function bx1_private\.lock_funding_person\(actor uuid,expected_person uuid default null\) returns void\r?\nlanguage plpgsql volatile security definer set search_path='' as \$\$[\s\S]*?grant execute on function bx1_private\.lock_funding_person\(uuid,uuid\) to current_user;/g) ?? []
      eq(helper.length, 1, 'extract only exact canonical lock helper DDL, owner and private ACL')
      await db.query(helper[0])
      eq(await fingerprint(), baselineRows, 'fixture lock prerequisite changes no business or authority rows')
      eq(await security(), baselineSecurity, 'fixture helper changes no roles/table/RLS grants')
    }
    phase = 'additive-install-authority-preservation'
    const beforeInstall = await functions(), guards = await protectedFunctions(), beforeInstallRows = await fingerprint()
    await db.query(featureSql)
    eq((await scalar("select prosrc from pg_proc where oid='bx1_portal.synthetic_compliance_command(jsonb,text,uuid,jsonb)'::regprocedure"))
      .replace(/\r\n/g, '\n').trim(), "begin\n  raise exception 'admission_legacy_rehearsal_write_retired' using errcode='42501';\nend",
      'legacy private rehearsal writer is exactly an unconditional retirement denial')
    const installed = await functions()
    for (const prior of beforeInstall) {
      const current = installed.find(f => f.oid === prior.oid)
      truth(current, `existing function ${prior.signature} retains its OID`)
      eq({ ...current, body: prior.body }, prior, `existing ${prior.signature} retains name/owner/ACL/security/search_path`)
    }
    eq(await protectedFunctions(), guards, 'all global generic/MFA/entity predicates and sole review transition remain byte-identical')
    eq(await fingerprint(), beforeInstallRows, 'additive feature installs no applications/accounts/mandates/factors/people or policy cases')
    eq(await security(), baselineSecurity, 'feature creates no role/edge/table/RLS grants')
    eq(installed.filter(f => f.nspname === 'public').map(f => f.signature),
      beforeInstall.filter(f => f.nspname === 'public').map(f => f.signature), 'same public RPC surface; no new rehearsal RPC')
    const privateHelpers = installed.filter(f => f.nspname === 'bx1_portal' && /^admission_/.test(f.proname))
    truth(privateHelpers.length > 0, 'bounded admission helpers installed privately')
    for (const f of privateHelpers) for (const r of ['anon', 'authenticated', 'service_role'])
      eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [r, f.signature]), false, `${r} cannot invoke ${f.signature}`)
    eq(allCommands.length, 11, 'frozen contract contains eleven existing Stage2 commands')
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')

    // Use an inherited committed native actor ONLY to make actual row waits
    // observable across existing cloud backends. Restore exact original values
    // externally; no fictional case/schema has to be committed for this proof.
    phase = 'session-and-membership-after-real-wait'
    const oldActor = 'e1000000-0000-4000-8000-000000000002'
    const oldSession = 'e2000000-0000-4000-8000-000000000002'
    await admin(clients[0]); await admin(clients[1])
    const oldSessionRow = (await clients[0].query('select id,aal::text,factor_id,not_after::text from auth.sessions where id=$1 and user_id=$2',
      [oldSession, oldActor])).rows[0]
    truth(oldSessionRow, 'inherited committed native session supplies real row-wait target')
    const oldMember = (await clients[0].query(`select id,status from public.bx1_memberships
      where user_id=$1 and organisation_id=$2 and role='ComplianceOfficer' and status='ACTIVE' order by id limit 1`, [oldActor, scope])).rows[0]
    truth(oldMember, 'inherited committed native reviewer membership supplies real row-wait target')
    const restoreExternal = async () => {
      const client = clients[0]
      await client.query('rollback'); await admin(client)
      await client.query('update auth.sessions set aal=$2,factor_id=$3,not_after=$4 where id=$1',
        [oldSessionRow.id, oldSessionRow.aal, oldSessionRow.factor_id, oldSessionRow.not_after])
      await client.query('update public.bx1_memberships set status=$2 where id=$1', [oldMember.id, oldMember.status])
    }
    externalRestores.push(restoreExternal)
    for (const kind of ['session', 'membership']) {
      const blocker = clients[0], observer = clients[1]
      await admin(blocker)
      await blocker.query("update auth.sessions set aal='aal1',not_after=clock_timestamp()+interval '1 hour' where id=$1", [oldSession])
      await db.query('savepoint admission_after_wait')
      await claims(2, { sub: oldActor, session_id: oldSession })
      const pid = await scalar('select pg_backend_pid()')
      await blocker.query('begin')
      await blocker.query(kind === 'session' ? 'select id from auth.sessions where id=$1 for update'
        : 'select id from public.bx1_memberships where id=$1 for update', [kind === 'session' ? oldSession : oldMember.id])
      const outcome = db.query('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(reviewer)])
        .then(() => ({ code: null }), error => ({ code: error.code }))
      let blocked = false
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        if (await scalar('select cardinality(pg_blocking_pids($1))>0', [pid], observer)) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      if (blocked) {
        if (kind === 'session') await blocker.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [oldSession])
        else await blocker.query("update public.bx1_memberships set status='SUSPENDED' where id=$1", [oldMember.id])
      }
      await blocker.query('commit')
      const result = await outcome
      await db.query('rollback to savepoint admission_after_wait; release savepoint admission_after_wait'); await admin()
      await restoreExternal()
      truth(blocked, `${kind} admission reader waits on a real distinct-backend authority row lock`)
      eq(result.code, '42501', `${kind} committed revocation after wait denies normal projection`)
    }
    eq(await selectedFingerprints(authorityTables), Object.fromEntries(authorityTables.map(name => [name, baselineRows[name]])),
      'inherited users/sessions/factors/people/memberships restored exactly after concurrency proof')
    externalRestores.pop()

    phase = 'fictional-evidence-fixture'
    const lifecycleMode = await scalar('select mode from bx1_private.document_lifecycle_policy where singleton')
    const inheritedScanner = await selectedFingerprints(scannerTables)
    eq(lifecycleMode, 'SCANNER_REQUIRED', 'inherited scanner mode explicitly recorded')
    eq(await scalar(`select tgenabled::text from pg_trigger where tgrelid='bx1_private.document_lifecycle_policy'::regclass
      and tgname='bx1_document_lifecycle_activation'`), 'O', 'native no-downgrade trigger starts active')
    await denied('native scanner downgrade remains forbidden',
      () => db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton"), '55000')
    // Exact disposable-owner setup models TEST's fictional evidence policy.
    // No CLEAN record, scanner producer or business-command bypass is created.
    // Reenable the existing trigger BEFORE every business RPC, then restore by
    // the existing guarded upgrade before the module's complete rollback.
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    eq(await scalar(`select tgenabled::text from pg_trigger where tgrelid='bx1_private.document_lifecycle_policy'::regclass
      and tgname='bx1_document_lifecycle_activation'`), 'O', 'native lifecycle guard is active before all business RPCs')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    eq(await selectedFingerprints(scannerTables), inheritedScanner, 'fixture selection changes no processing/scan evidence')
    const syntheticPolicies = await scalar('select count(*)::int from bx1_private.synthetic_compliance_cases')
    const initialFinance = await selectedFingerprints(financeTables)
    // A separate active fictional staff tenant makes wrong-scope denials prove
    // case routing, not an earlier missing/disabled organisation prerequisite.
    await db.query("insert into public.bx1_organisations(id,name,status) values($1,'Fictional unrelated admission staff tenant','ACTIVE')", [otherScope])
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)',
        [id(n), `admission-workflow-${n}@example.invalid`])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),'aal1')",
        [id(100 + n), id(n)])
      if ([2, 3, 7].includes(n)) {
        await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Fictional admission staff ${n}`])
        await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(200 + n), id(n)])
        await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,$4)',
          [id(400 + n), id(n), n === 7 ? otherScope : scope, n === 3 ? 'SuperAdmin' : 'ComplianceOfficer'])
      }
    }
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])',
      [[1, 2, 3, 4, 5, 6, 7].map(id)]), 0, 'positive TEST journey fabricates no person mappings')
    access(await entryRead(1), 1)
    const reviewerSnapshot = access(await read(2, reviewer), 2, reviewer)
    eq([reviewerSnapshot.products, reviewerSnapshot.subscriptions], [[], []], 'TEST password projection exposes no product or financial order data')
    access(await read(3, applier), 3, applier)
    await claims(2); await admin()
    eq(await scalar('select bx1_portal.has_session()'), false, 'enrolled AAL1 staff still fail original protected session predicate')
    eq(await scalar('select bx1_private.has_token_mfa()'), false, 'password policy does not pretend to complete token MFA')

    phase = 'arbitrary-application-submit-rfi-resubmit-decision'
    const startKey = key(), startBody = { persona: 'INVESTOR' }
    let investor = (await entry(1, 'start_application', startBody, startKey)).applications.find(a => a.persona === 'INVESTOR')
    truth(investor?.id, 'arbitrary no-profile applicant starts through unchanged entry RPC')
    eq((await entry(1, 'start_application', startBody, startKey)).applications.find(a => a.id === investor.id).id,
      investor.id, 'exact start retry retains one application')
    await denied('start idempotency conflict cannot create another persona',
      () => entry(1, 'start_application', { persona: 'WEALTH_MANAGER' }, startKey), '23505')
    const investorDetails = await details(1)
    await denied('unregistered applicant document cannot become evidence',
      () => submit(1, investor, { ...investorDetails, documents: [{ ...investorDetails.documents[0], id: id(999) }] }), ['23514', '42501'])
    await denied('another actor cannot submit own exact case', () => submit(6, investor, investorDetails))
    investor = await submit(1, investor, investorDetails)
    eq([investor.status, investor.provider_mode], ['SUBMITTED', 'MANUAL_TEST_REVIEW'], 'same canonical TEST platform decision policy; no invented provider enum')
    await isolated(async () => {
      // Only this module's fictional enrolled reviewer is upgraded inside a
      // rollback-only preservation probe. No inherited or live factor changes.
      await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [id(202), id(102)])
      const assured = { aal: 'aal2', amr: [
        { method: 'password', timestamp: Math.floor(Date.now() / 1000) },
        { method: 'totp', timestamp: Math.floor(Date.now() / 1000) },
      ] }
      const normal = await read(2, reviewer, assured)
      eq(normal.stage2_access.session_mode, 'STANDARD', 'normal AAL2 route keeps standard assurance')
      eq(applicationFrom(normal, investor.id).status, 'SUBMITTED', 'standard reviewer sees same arbitrary submitted application')
      const changed = applicationFrom(await command(2, reviewer, 'review_application', review(investor, 'CHANGES_REQUIRED'), key(), assured), investor.id)
      eq(changed.status, 'CHANGES_REQUIRED', 'existing assured writer still uses sole canonical review transition')
    })
    eq(applicationFrom(await read(2, reviewer), investor.id).status, 'SUBMITTED', 'AAL2 preservation probe rolls back its decision and fictional session upgrade')
    eq(applicationFrom(access(await read(2, reviewer), 2, reviewer), investor.id).details, investorDetails,
      'current appointed reviewer sees arbitrary submitted facts without case policy')
    await denied('another organisation cannot review the case', () => command(7, role('ComplianceOfficer', otherScope), 'review_application', review(investor)))
    await denied('client cannot add its own scope capability', () => read(2, { ...reviewer, admission: true }))
    await denied('applicant cannot self-review', () => command(1, reviewer, 'review_application', review(investor)))
    await denied('stale submitted revision cannot decide', () => command(2, reviewer, 'review_application',
      { ...review(investor), expected_revision: investor.revision + 1 }), '23514')
    await denied('incomplete checks cannot approve', () => command(2, reviewer, 'review_application',
      { ...review(investor), checks: { ...checksForReview, screening: false } }), '23514')
    const beforeKnownPerson = await selectedFingerprints(authorityTables)
    await isolated(async () => {
      await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(1), 'Known-person NEGATIVE fixture only'])
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional shared person','TRUSTED','fictional:negative-same-person',$2)", [id(700), id(701)])
      for (const n of [1, 2]) await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:negative-same-person',$3)",
        [id(n), id(700), id(701 + n)])
      await denied('known same human under two logins cannot review', () => command(2, reviewer, 'review_application', review(investor)))
      await claims(2); await admin()
      eq(await scalar('select bx1_portal.admission_people_independent($1,$2)', [id(1), id(2)]), false, 'known same person is not functional independence')
      await db.query("update bx1_private.person_principals set status='REVOKED' where auth_user_id=$1", [id(2)])
      eq(await scalar('select bx1_portal.admission_people_independent($1,$2)', [id(2), id(3)]), false, 'known revoked identity is not treated as an unmapped TEST actor')
    })
    eq(await selectedFingerprints(authorityTables), beforeKnownPerson, 'known-person negative removes every fictional profile/principal/person')
    const beforeAudit = await fingerprint()
    await isolated(async () => {
      await db.query(`create function bx1_portal.admission_fixture_audit_failure() returns trigger language plpgsql as $$
        begin if NEW.actor_id='${id(2)}'::uuid and NEW.kind='review_application' then
          raise exception 'fictional mandatory review audit failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger admission_fixture_audit_failure before insert on bx1_portal.events for each row
          execute function bx1_portal.admission_fixture_audit_failure()`)
      await denied('canonical review aborts without mandatory audit', () => command(2, reviewer, 'review_application', review(investor)), '23514')
      eq(await fingerprint(), beforeAudit, 'failed review preserves case/revisions/receipts/authority/evidence')
    })
    const rfiKey = key(), rfi = review(investor, 'CHANGES_REQUIRED')
    investor = applicationFrom(await command(2, reviewer, 'review_application', rfi, rfiKey), investor.id)
    eq([investor.status, investor.revision], ['CHANGES_REQUIRED', rfi.expected_revision + 1], 'canonical RFI advances same application revision')
    eq(applicationFrom(await command(2, reviewer, 'review_application', rfi, rfiKey), investor.id), investor, 'exact review retry is idempotent')
    await denied('conflicting review replay cannot change saved decision',
      () => command(2, reviewer, 'review_application', { ...rfi, notes: 'Conflicting fictional request note.' }, rfiKey), '23505')
    await admin()
    eq(await scalar("select count(*)::int from bx1_portal.events where subject_id=$1 and kind='review_application'", [investor.id]), 1, 'one decision emits one canonical event despite retry')
    const submitKey = key(), resubmitBody = { application_id: investor.id, expected_revision: investor.revision, details: investorDetails }
    investor = applicationFrom(await entry(1, 'submit_application', resubmitBody, submitKey), investor.id)
    eq([investor.status, investor.reviewer_id], ['SUBMITTED', null], 'same-ID resubmission resets previous review only')
    eq(applicationFrom(await entry(1, 'submit_application', resubmitBody, submitKey), investor.id), investor, 'resubmission retry retains one revision')
    investor = applicationFrom(await command(2, reviewer, 'review_application', review(investor)), investor.id)
    eq(investor.status, 'APPROVED', 'normal scoped decision reaches own account handoff')
    const accountKey = key(), accountBody = { application_id: investor.id }
    const individual = (await command(1, applicant, 'create_investment_account', accountBody, accountKey)).accounts.find(a => a.application_id === investor.id)
    truth(individual?.id, 'approved arbitrary investor opens same canonical individual account')
    eq((await command(1, applicant, 'create_investment_account', accountBody, accountKey)).accounts.find(a => a.id === individual.id).id,
      individual.id, 'individual account exact retry is idempotent')
    await denied('wrong applicant cannot open another approved account', () => command(6, applicant, 'create_investment_account', accountBody))
    await admin()
    eq(await scalar('select count(*)::int from public.bx1_profiles where id=$1', [id(1)]), 0, 'individual applicant remains without native profile')
    eq(await scalar('select count(*)::int from bx1_portal.application_detail_versions where application_id=$1', [investor.id]), 2, 'RFI/resubmit preserves both exact immutable submitted versions')

    phase = 'normal-document-history-and-private-manifest'
    const history = async (n, applicationId, c) => {
      await claims(n)
      return scalar('select public.bx1_application_document_versions($1,$2::jsonb)', [applicationId, JSON.stringify(c)])
    }
    const ownHistory = await history(1, investor.id, applicant)
    eq(ownHistory.application_id, investor.id, 'own normal application history binds exact case')
    eq(ownHistory.versions.length, 2, 'same-case history includes original and resubmitted version')
    eq(JSON.stringify(ownHistory).includes('storage_path'), false, 'history list never exposes private Storage paths')
    eq((await history(2, investor.id, reviewer)).versions, ownHistory.versions, 'assigned reviewer sees same immutable normal history at TEST password assurance')
    await denied('unrelated actor cannot read history', () => history(6, investor.id, applicant))
    await denied('unrelated reviewer org cannot read history', () => history(7, investor.id, role('ComplianceOfficer', otherScope)))
    await claims(2)
    const manifest = await scalar('select public.bx1_application_document_lookup($1,$2,$3,$4::jsonb)',
      [investor.id, ownHistory.versions.at(-1).revision, investorDetails.documents[0].id, JSON.stringify(reviewer)])
    eq(manifest.claimed_sha256, investorDetails.documents[0].sha256, 'reviewer lookup labels supplied digest as a claim, never byte verification')
    eq(manifest.storage_path, investorDetails.documents[0].storage_path, 'normal scoped lookup binds existing private receipt/object')
    eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
      [investorDetails.documents[0].storage_path]), 1, 'scoped reviewer Storage policy recognises same admitted private manifest')
    await claims(7)
    eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1",
      [investorDetails.documents[0].storage_path]), 0, 'path possession never authorises unrelated reviewer Storage access')

    phase = 'wealth-manager-request-review-apply'
    let manager = (await entry(4, 'start_application', { persona: 'WEALTH_MANAGER' })).applications.find(a => a.persona === 'WEALTH_MANAGER')
    manager = await submit(4, manager, await details(4, 'MANAGER'))
    manager = applicationFrom(await command(2, reviewer, 'review_application', review(manager)), manager.id)
    truth(manager.organisation_id, 'manager approval creates canonical customer organisation, not native capacity')
    await admin()
    eq(await scalar('select count(*)::int from public.bx1_memberships where user_id=$1', [id(4)]), 0, 'application approval grants no native membership')
    const mandateBody = (revision = 0) => ({ application_id: manager.id, expected_revision: revision,
      evidence_reference: 'Fictional board appointment evidence for exact TEST management scope only.',
      requested_until: new Date(Date.now() + 86400000).toISOString() })
    const mandateKey = key(), mandateInput = mandateBody()
    let mandate = (await entry(4, 'request_representative_mandate', mandateInput, mandateKey)).organisation_mandates.find(m => m.application_id === manager.id)
    eq([mandate.status, mandate.effective, mandate.role], ['SUBMITTED', false, 'OfferingManager'], 'separate request creates no operational authority')
    eq((await entry(4, 'request_representative_mandate', mandateInput, mandateKey)).organisation_mandates.find(m => m.id === mandate.id).id,
      mandate.id, 'manager mandate request exact retry uses same case')
    const mandateReview = (m, decision = 'APPROVED') => ({ mandate_id: m.id, expected_revision: m.revision, decision,
      notes: 'Fictional independent TEST role-scope review; not independent-human evidence.',
      checks: { appointment: true, evidence: true, scope: true } })
    await denied('manager cannot decide own representative mandate', () => command(4, reviewer, 'review_representative_mandate', mandateReview(mandate)))
    mandate = (await command(2, reviewer, 'review_representative_mandate', mandateReview(mandate, 'CHANGES_REQUIRED'))).organisation_mandates.find(m => m.id === mandate.id)
    mandate = (await entry(4, 'request_representative_mandate', mandateBody(mandate.revision))).organisation_mandates.find(m => m.id === mandate.id)
    mandate = (await command(2, reviewer, 'review_representative_mandate', mandateReview(mandate))).organisation_mandates.find(m => m.id === mandate.id)
    eq([mandate.status, mandate.effective], ['APPROVED', false], 'mandate approval is not a role grant')
    const applyBody = { mandate_id: mandate.id, expected_revision: mandate.revision }
    await isolated(async () => {
      await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'SuperAdmin')", [id(2), scope])
      await denied('same reviewer cannot apply under a second role', () => command(2, applier, 'apply_representative_mandate', applyBody))
    })
    const beforeApplyAudit = await fingerprint()
    await isolated(async () => {
      await db.query(`create function bx1_portal.admission_fixture_apply_failure() returns trigger language plpgsql as $$
        begin if NEW.action='apply_representative_mandate' then raise exception 'fictional apply audit failure'
          using errcode='23514'; end if; return NEW; end $$;
        create trigger admission_fixture_apply_failure before insert on bx1_portal.representative_mandate_receipts
          for each row execute function bx1_portal.admission_fixture_apply_failure()`)
      await denied('apply cannot provision authority without mandatory receipt', () => command(3, applier, 'apply_representative_mandate', applyBody), '23514')
      eq(await fingerprint(), beforeApplyAudit, 'failed apply restores organisation/profile/membership/binding/mandate')
    })
    const applyKey = key()
    mandate = (await command(3, applier, 'apply_representative_mandate', applyBody, applyKey)).organisation_mandates.find(m => m.id === mandate.id)
    eq([mandate.status, mandate.effective, mandate.applied_by_user_id], ['APPLIED', true, id(3)], 'distinct TEST admin applies canonical first representative')
    eq((await command(3, applier, 'apply_representative_mandate', applyBody, applyKey)).organisation_mandates.find(m => m.id === mandate.id).id,
      mandate.id, 'exact apply retry retains one native organisation and binding')
    await admin()
    eq(await scalar('select jsonb_agg(role order by role) from public.bx1_memberships where user_id=$1', [id(4)]), ['OfferingManager'],
      'canonical apply grants ONLY exact OfferingManager capacity')
    eq(await scalar('select count(*)::int from bx1_portal.organisation_authority_bindings where product_organisation_id=$1', [manager.organisation_id]), 1,
      'manager apply adds one existing scoped binding, no issuer/Compliance appointment')
    truth((await entryRead(4)).contexts.some(c => c.organisation_id === mandate.native_organisation_id && c.roles.includes('OfferingManager')),
      'normal entry exposes actual effective workspace handoff')
    await admin()
    eq(await scalar('select bx1_portal.representative_mandate_effective_at($1,$2::timestamptz)',
      [mandate.id, new Date(Date.parse(mandate.requested_until) + 1000).toISOString()]), false, 'passive mandate expiry removes capacity without job or date mutation')
    await denied('applied manager password capability cannot create product',
      () => command(4, role('OfferingManager', mandate.native_organisation_id), 'create_product', { organisation_id: manager.organisation_id, terms: {} }))

    phase = 'entity-account-and-restricted-investing-mandate'
    let entity = (await entry(5, 'start_application', { persona: 'INVESTOR' })).applications.find(a => a.persona === 'INVESTOR')
    const entityDetails = await details(5, 'ENTITY')
    entity = await submit(5, entity, entityDetails)
    await denied('missing company provider entitlement cannot create a binding', async () => {
      await admin(); await db.query('set local role bx1_provider_evidence_writer')
      await scalar('select bx1_private.bind_provider_application($1,$2,$3,$4,$5,$6,$7)',
        [id(5), id(105), entity.id, entity.revision, 'Fictional-Individual-Level', null, 'fictional-admission-qualified-client'])
    }, ['22023', '55000'])
    eq(await scalar('select count(*)::int from bx1_private.provider_application_bindings where application_id=$1', [entity.id]), 0,
      'missing company capability leaves no provider binding or machine receipt')
    entity = applicationFrom(await command(2, reviewer, 'review_application', review(entity)), entity.id)
    const entityKey = key(), entityBody = { application_id: entity.id }
    const entityAccount = (await command(5, applicant, 'create_entity_investment_account', entityBody, entityKey)).entity_investment_accounts.find(a => a.application_id === entity.id)
    eq([entityAccount?.kind, entityAccount?.can_view], ['ENTITY', false], 'entity account alone grants no representative view or transaction')
    eq((await command(5, applicant, 'create_entity_investment_account', entityBody, entityKey)).entity_investment_accounts.find(a => a.id === entityAccount.id).id,
      entityAccount.id, 'canonical entity account retry keeps same legal party/account')
    await denied('other applicant cannot create entity account', () => command(6, applicant, 'create_entity_investment_account', entityBody))
    const investingInput = { investment_account_id: entityAccount.id, expected_revision: 0,
      evidence_reference: 'Fictional exact board appointment in the approved COMPANY submission evidence.',
      appointment_document_id: entityDetails.documents[1].id, requested_until: new Date(Date.now() + 86400000).toISOString() }
    const investingKey = key()
    let investing = (await command(5, applicant, 'request_investing_representative_mandate', investingInput, investingKey)).investing_representative_mandates.find(m => m.application_id === entity.id)
    eq([investing.status, investing.effective, investing.transaction_limit_minor], ['SUBMITTED', false, '0'], 'entity request binds approved evidence with zero execution limit')
    eq((await command(5, applicant, 'request_investing_representative_mandate', investingInput, investingKey)).investing_representative_mandates.find(m => m.id === investing.id).id,
      investing.id, 'entity mandate retry preserves exact case')
    const investingReview = { mandate_id: investing.id, expected_revision: investing.revision, decision: 'APPROVED',
      notes: 'Fictional exact legal party and appointment scope review; no financial execution is granted.',
      checks: { appointment: true, legal_entity: true, scope: true } }
    await denied('wrong organisation cannot decide entity representative',
      () => command(7, role('ComplianceOfficer', otherScope), 'review_investing_representative_mandate', investingReview))
    investing = (await command(2, reviewer, 'review_investing_representative_mandate', investingReview)).investing_representative_mandates.find(m => m.id === investing.id)
    eq([investing.status, investing.effective], ['APPROVED', false], 'entity representative review creates no effective authority')
    const investingApplyBody = { mandate_id: investing.id, expected_revision: investing.revision }
    const beforeInvestingAudit = await fingerprint()
    await isolated(async () => {
      await db.query(`create function bx1_portal.admission_fixture_entity_failure() returns trigger language plpgsql as $$
        begin if NEW.kind='apply_investing_representative_mandate' then raise exception 'fictional entity audit failure'
          using errcode='23514'; end if; return NEW; end $$;
        create trigger admission_fixture_entity_failure before insert on bx1_portal.events for each row
          execute function bx1_portal.admission_fixture_entity_failure()`)
      await denied('entity apply cannot survive required audit failure',
        () => command(3, applier, 'apply_investing_representative_mandate', investingApplyBody), '23514')
      eq(await fingerprint(), beforeInvestingAudit, 'entity audit rollback preserves restricted mandate and account')
    })
    const investingApplyKey = key()
    investing = (await command(3, applier, 'apply_investing_representative_mandate', investingApplyBody, investingApplyKey)).investing_representative_mandates.find(m => m.id === investing.id)
    eq([investing.status, investing.effective, investing.transaction_limit_minor], ['APPLIED', true, '0'], 'TEST-only functional separation applies view mandate with zero execution limit')
    eq((await command(3, applier, 'apply_investing_representative_mandate', investingApplyBody, investingApplyKey)).investing_representative_mandates.find(m => m.id === investing.id).id,
      investing.id, 'entity mandate apply exact retry preserves one activation')
    eq((await read(5)).entity_investment_accounts.find(a => a.id === entityAccount.id).can_view, true, 'normal applicant can view its currently represented entity account')
    await claims(5); await admin()
    eq(await scalar('select bx1_portal.entity_people_independent($1,$2)', [id(5), id(2)]), false, 'original entity independent-human guard remains strict for unknown mappings')
    eq(await scalar('select bx1_portal.entity_account_admission_current($1)', [entityAccount.id]), false, 'original downstream entity source does not inherit TEST functional capability')
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[1, 2, 3, 4, 5, 6, 7].map(id)]), 0,
      'entire positive individual/manager/entity journey still has no invented person mappings')

    phase = 'qualified-provider-evidence-to-same-human-decision'
    let qualified = (await entry(6, 'start_application', { persona: 'INVESTOR' })).applications.find(a => a.persona === 'INVESTOR')
    qualified = await submit(6, qualified, await details(6))
    const writer = 'bx1_provider_evidence_writer'
    const asWriter = async (sql, values) => { await admin(); await db.query(`set local role ${writer}`); return scalar(sql, values) }
    const clientId = 'fictional-admission-qualified-client', level = 'Fictional-Individual-Level'
    const binding = await asWriter('select bx1_private.bind_provider_application($1,$2,$3,$4,$5,$6,$7)',
      [id(6), id(106), qualified.id, qualified.revision, level, null, clientId])
    eq([binding.expected_applicant_type, binding.source_version_revision], ['individual', qualified.revision], 'existing provider writer binds same immutable application revision')
    const eventAt = Date.now()
    const hash = () => (++sequence).toString(16).padStart(64, '0')
    const event = (seconds, overrides = {}) => {
      const value = { type: 'applicantReviewed', time: new Date(eventAt + seconds * 1000).toISOString(),
        status: 'completed', answer: 'GREEN', reject: null, manual: false, ...overrides }
      return [binding.external_user_id, 'fictional-admission-provider-applicant', value.type, 'fictional-authenticated-event', clientId,
        value.time, hash(), hash(), value.status, value.answer, value.reject, value.manual, true, 'individual', level]
    }
    const send = values => asWriter('select bx1_private.record_provider_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', values)
    const manual = await send(event(0, { manual: true }))
    eq(manual.projection_state, 'MANUAL_TEST', 'manual webhook test is never qualified provider acceptance')
    const greenInput = event(2), green = await send(greenInput)
    eq([green.evidence_kind, green.projection_state], ['COMPLETED_REVIEW', 'EFFECTIVE'], 'authenticated qualified completed evidence uses existing provider projection')
    eq((await send(greenInput)).duplicate, true, 'exact signed provider event retry is deduped')
    const stale = await send(event(1, { type: 'applicantPending', status: 'pending', answer: null }))
    eq(stale.projection_state, 'SUPERSEDED', 'reordered older provider event cannot replace current completion')
    const providerRead = async n => { await claims(n); return scalar('select public.bx1_provider_evidence_read($1)', [qualified.id]) }
    truth((await providerRead(2)).some(e => e.id === green.id && e.projection_state === 'EFFECTIVE'), 'current assigned TEST-password reviewer sees actual normalized evidence contract')
    await denied('unrelated actor cannot read provider evidence', () => providerRead(1))
    await denied('wrong reviewer org cannot read provider evidence', () => providerRead(7))
    eq(applicationFrom(await entryRead(6), qualified.id).status, 'SUBMITTED', 'GREEN evidence never auto-approves application')
    qualified = applicationFrom(await command(2, reviewer, 'review_application', review(qualified)), qualified.id)
    eq([qualified.status, qualified.provider_mode], ['APPROVED', 'MANUAL_TEST_REVIEW'], 'same independent platform decision retains real database provider policy spelling')
    truth((await command(6, applicant, 'create_investment_account', { application_id: qualified.id })).accounts.some(a => a.application_id === qualified.id),
      'qualified provider case reaches same canonical account destination')

    phase = 'session-context-protected-boundary-and-MAIN-denials'
    for (const [label, extra] of [
      ['MAIN issuer', { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }],
      ['expired JWT', { exp: Math.floor(Date.now() / 1000) - 1 }], ['another live session', { session_id: id(103) }],
      ['missing expiry', { exp: undefined }],
      ['recovery AMR', { amr: [{ method: 'recovery' }] }], ['OAuth AMR', { amr: [{ method: 'oauth' }] }],
      ['missing AMR', { amr: undefined }], ['anonymous JWT', { is_anonymous: true }],
      ['missing password timestamp', { amr: [{ method: 'password' }] }],
      ['future password timestamp', { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) + 3600 }] }],
    ]) {
      await claims(2, extra); await admin()
      eq(await scalar('select bx1_portal.admission_password_session()'), false, `${label} fails narrow password capability itself`)
      await denied(label, () => read(2, reviewer, extra))
    }
    for (const [label, sql, values] of [
      ['banned reviewer', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [id(2)]],
      ['unconfirmed email', 'update auth.users set email_confirmed_at=null where id=$1', [id(2)]],
      ['suspended profile', "update public.bx1_profiles set status='SUSPENDED' where id=$1", [id(2)]],
      ['revoked membership', "update public.bx1_memberships set status='SUSPENDED' where id=$1", [id(402)]],
      ['expired native session', "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(102)]],
    ]) await denied(label, async () => { await db.query(sql, values); await read(2, reviewer) })
    const protectedActions = ['create_product', 'save_product', 'submit_product', 'review_product', 'publish_product',
      'request_product_eligibility', 'review_product_eligibility', 'subscribe', 'request_funding', 'reconcile_funding',
      'settle_subscription', 'request_transfer', 'sign_transaction', 'revoke_representative_mandate',
      'revoke_investing_representative_mandate', 'review_customer_monitoring']
    for (const action of protectedActions)
      await denied(`TEST password cannot execute ${action}`, () => command(2, reviewer, action, {}))
    const aliases = (await functions()).filter(f => f.nspname === 'bx1_portal'
      && /^(execute_command|execute_scoped)(_|$)/.test(f.proname))
    for (const [n, c, capacity] of [[2, reviewer, 'enrolled reviewer'],
      [4, role('OfferingManager', mandate.native_organisation_id), 'applied manager with no enrolled factor']]) {
      // A newly applied native profile has no fabricated factor. Original
      // has_token_mfa deliberately permits profiles with no verified factors;
      // prove the bounded admission barrier, not only an earlier MFA denial.
      for (const alias of aliases) await denied(`legacy ${alias.signature} cannot bypass protected authority for ${capacity}`, async () => {
        await claims(n); await admin()
        const scoped = alias.proname.startsWith('execute_scoped')
        await scalar(scoped ? `select bx1_portal.${alias.proname}($1::jsonb,$2,$3,$4::jsonb)`
          : `select bx1_portal.${alias.proname}($1,$2,$3::jsonb)`, scoped
          ? [JSON.stringify(c), 'create_product', key(), JSON.stringify({ organisation_id: manager.organisation_id, terms: {} })]
          : ['create_product', key(), JSON.stringify({ organisation_id: manager.organisation_id, terms: {} })])
      })
    }
    await denied('old public unscoped command remains revoked', async () => {
      await claims(2); await scalar('select public.bx1_portal_command($1,$2,$3::jsonb)', ['review_application', key(), JSON.stringify(review(investor))])
    })
    await denied('legacy public rehearsal command authority is retired', async () => {
      await claims(2)
      try {
        await scalar('select public.bx1_portal_synthetic_compliance_command($1::jsonb,$2,$3,$4::jsonb)',
          [JSON.stringify(reviewer), 'review_application', key(), JSON.stringify(review(investor))])
      } catch (error) {
        eq(error.message, 'admission_legacy_rehearsal_write_retired', 'public rehearsal RPC reaches only the unconditional retirement denial')
        throw error
      }
    })
    for (const signature of [
      'bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text)',
      'bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean,text,text)',
      'bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)',
      'bx1_private.promote_scanned_document(uuid)',
    ]) eq(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), false,
      `admitted password actor never gains private processing/provider writer ${signature}`)
    await denied('disabled temporary TEST switch removes admission capability', async () => {
      await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton')
      await read(2, reviewer)
    })
    await isolated(async () => {
      await db.query("update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false,environment='MAINNET',manual_test_review=false,reviewer_scope=null where singleton")
      await claims(2, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }); await admin()
      eq(await scalar('select bx1_portal.admission_password_session()'), false, 'MAIN can never acquire TEST_PASSWORD capability')
      for (const [capacity, actions] of Object.entries(commands)) {
        const n = capacity === 'APPLICANT' ? 1 : capacity === 'ComplianceOfficer' ? 2 : 3
        const c = capacity === 'APPLICANT' ? applicant : role(capacity)
        await claims(n, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }); await admin()
        for (const action of actions)
          eq(await scalar('select bx1_portal.admission_command_allowed($1::jsonb,$2)', [JSON.stringify(c), action]), false,
            `MAIN bounded admission policy denies ${action} even in its correct caller capacity`)
      }
      await denied('MAIN scoped password read remains sealed', () => read(2, reviewer,
        { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }))
      await denied('MAIN cannot invoke TEST canonical review', () => command(2, reviewer, 'review_application', review(investor), key(),
        { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }))
    })
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.synthetic_compliance_cases'), syntheticPolicies,
      'arbitrary individual/manager/entity/provider journeys never add a synthetic case policy')
    eq(await selectedFingerprints(financeTables), initialFinance, 'all admitted journeys and denied aliases create no product/order/funding/holding/ledger state')
    eq(await protectedFunctions(), guards, 'all shared protected predicates and sole canonical transition remain byte-identical after journeys')
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [lifecycleMode])
    eq(await scalar('select mode from bx1_private.document_lifecycle_policy where singleton'), lifecycleMode,
      'original scanner mode restored through unchanged native upgrade')
    eq(await selectedFingerprints(scannerTables), inheritedScanner, 'no scan-clean result or private processing evidence was fabricated')
    await db.query('rollback'); begun = false
    eq(await functions(), baselineFunctions, 'complete rollback restores exact original function OIDs/bodies/owners/ACLs and helper absence')
    eq(await fingerprint(), baselineRows, 'complete rollback restores every inherited business/config/Auth/Storage/principal/evidence row')
    eq(await security(), baselineSecurity, 'complete rollback restores all native role/edge/relation/RLS metadata')
    console.log(`BX1_ADMISSION_WORKFLOW_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 publicRPCs=unchanged cases=arbitrary-no-policy individual=submit-rfi-same-case-resubmit-review-account manager=request-review-apply entity=account-request-review-apply provider=qualified-evidence-same-human-decision auditRollback=proven idempotency=proven concurrency=session-and-membership-after-real-wait globalGuards=byte-identical main=denied financialExecution=denied factors=preserved cleanup=exact-rollback hostedAcceptance=not-proven independentHumans=not-proven providerAcceptance=not-proven documentBytes=not-proven`)
    return checks
  } catch (error) {
    error.admissionPhase = phase
    throw error
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    for (const restore of externalRestores.reverse()) await restore()
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
  }
}
