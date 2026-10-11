import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// Called only AFTER the unchanged rc.32 proof, before test-portal's existing
// exact-schema cleanup. Committed fictional rows make independent backend
// waits observable. This is functional SQL evidence, never hosted acceptance,
// actual document bytes, provider/scanner acceptance or independent humans.
export async function proveAccountRepresentatives(db, clients, admissionSql, representativesSql) {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Account representatives proof requires exact disposable cloud fixture')
  assert.equal(clients.length, 2, 'two existing independent cloud backends required')
  let checks = 0, sequence = 1000, begun = false, phase = 'baseline'
  const prefix = 'ef830000-0000-4000-8000-'
  const id = n => `${prefix}${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const email = n => `account-representatives-${n}@example.invalid`
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e', otherScope = id(950)
  const applicant = { mode: 'APPLICANT' }
  const role = (name, organisationId = scope) => ({ mode: 'ROLE', organisationId, role: name })
  const reviewer = role('ComplianceOfficer'), applier = role('SuperAdmin')
  const requestAction = 'request_investing_representative_mandate'
  const responseAction = 'respond_investing_representative_proposal'
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const begin = async () => { await admin(); await db.query('begin'); begun = true }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claims = async (n, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: 'aal1',
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }], ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const read = async (n, c = applicant, extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_read_scoped($1::jsonb)', [JSON.stringify(c)], client)
  }
  const entry = async (n, action, payload, requestKey = key()) => {
    await claims(n)
    return scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [action, requestKey, JSON.stringify(payload)])
  }
  const command = async (n, c, action, payload, requestKey = key(), extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)',
      [action, requestKey, JSON.stringify(payload), JSON.stringify(c)], client)
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); await db.query('savepoint representatives_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint representatives_denial; release savepoint representatives_denial')
    await admin()
    truth((Array.isArray(expected) ? expected : [expected]).includes(code), `${label}: SQLSTATE=${code ?? 'none'}`)
  }
  const isolated = async run => {
    await admin(); await db.query('savepoint representatives_isolation')
    try { await run() }
    finally { await db.query('rollback to savepoint representatives_isolation; release savepoint representatives_isolation'); await admin() }
  }
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      md5(pg_get_functiondef(p.oid)) body,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','public','bx1_private','bx1_portal') and p.prokind='f' order by p.oid`)).rows
  }
  const changed = new Set([
    'bx1_portal.guard_investing_representative_mandate()',
    'bx1_portal.admission_command_allowed(jsonb,text)', 'bx1_portal.admission_access(jsonb)',
    'bx1_portal.admission_investing_mandate_current(uuid)', 'bx1_portal.investing_mandate_current(uuid)',
    'bx1_portal.admission_investing_mandate_effective(uuid)', 'bx1_portal.investing_mandate_effective(uuid)',
    'bx1_portal.admission_entity_account_projection(jsonb,uuid)', 'bx1_portal.entity_account_projection(jsonb,uuid)',
    'bx1_portal.admission_investing_mandate_projection(jsonb,uuid)', 'bx1_portal.investing_mandate_projection(jsonb,uuid)',
    'bx1_portal.execute_scoped_pre_offering(jsonb,text,uuid,jsonb)',
    'bx1_portal.object_readable(text)',
    'bx1_portal.read_scoped_pre_offering(jsonb)',
  ])
  const security = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,rolname,rolsuper,rolinherit,
        rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig from pg_roles) t),
      'edges',(select jsonb_agg(to_jsonb(t) order by roleid,member,grantor) from pg_auth_members t),
      'relations',(select jsonb_agg(to_jsonb(t) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,
        c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind='r' and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) t),
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t))`)
  }
  const relations = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname,
      array(select a.attname::text from pg_attribute a where a.attrelid=c.oid and a.attnum>0
        and not a.attisdropped order by a.attnum) columns,
      array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid=i.indrelid
        and a.attnum=any(i.indkey) where i.indrelid=c.oid and i.indisprimary order by a.attnum) primary_key
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'
        and (n.nspname in ('auth','storage','bx1_private','bx1_portal')
          or n.nspname='public' and c.relname like 'bx1_%') order by 1,2`)).rows
  }
  const rows = async specs => {
    await admin()
    const result = {}
    for (const spec of specs) {
      for (const name of [spec.nspname, spec.relname, ...spec.columns]) assert.match(name, /^[a-z0-9_]+$/)
      const projection = spec.columns.map(name => `'${name}',t.${name}`).join(',')
      result[`${spec.nspname}.${spec.relname}`] = await scalar(`select coalesce(jsonb_agg(v.value order by v.value::text),'[]'::jsonb)
        from ${spec.nspname}.${spec.relname} t cross join lateral (select jsonb_build_object(${projection}) value) v`)
    }
    return result
  }
  const state = async () => rows((await relations()).filter(spec => spec.nspname === 'bx1_portal'
    && ['applications', 'application_detail_versions', 'legal_entity_parties', 'investment_accounts',
      'investing_representative_mandates', 'investing_representative_receipts', 'scoped_requests', 'events'].includes(spec.relname)))
  const mandateFrom = (snapshot, mandateId) => snapshot.investing_representative_mandates.find(m => m.id === mandateId)
  const applicationFrom = (snapshot, applicationId) => snapshot.applications.find(a => a.id === applicationId)
  const reviewApplication = a => ({ application_id: a.id, expected_revision: a.revision, decision: 'APPROVED',
    notes: 'Fictional cloud functional admission only; not provider/scanner or independent-human acceptance.',
    checks: { identity: true, ownership: true, screening: true, suitability: true } })
  const reviewMandate = (m, decision = 'APPROVED') => ({ mandate_id: m.id, expected_revision: m.revision, decision,
    notes: 'Fictional exact appointment, proposer, target, legal entity and limited scope reviewed in disposable CI.',
    checks: { appointment: true, legal_entity: true, scope: true } })
  const response = (m, decision = 'ACCEPT') => ({ mandate_id: m.id, expected_revision: m.revision,
    proposal_hash: m.proposal_hash, decision })
  const manifest = async (n, m, documentId = m.appointment_document_id, c = applicant) => {
    await claims(n)
    return scalar('select public.bx1_investing_proposal_document_lookup($1,$2,$3::jsonb)',
      [documentId, m.id, JSON.stringify(c)])
  }
  const details = async (n, kind = 'INDIVIDUAL') => {
    const company = kind === 'ENTITY'
    const documents = (company ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).map((type, i) => ({
      id: id(300 + n * 10 + i), kind: type, title: `Fictional account representatives ${type}`,
      storage_path: `${id(n)}/${id(300 + n * 10 + i)}`, sha256: 'c'.repeat(64), size: 100, mime_type: 'application/pdf',
    }))
    await admin()
    for (const doc of documents) {
      await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
        values('bx1-portal-documents',$1,$2,'{"size":100,"mimetype":"application/pdf"}')`, [doc.storage_path, id(n)])
      await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8)',
        [id(n), id(100 + n), doc.id, doc.kind, doc.title, doc.sha256, doc.size, doc.mime_type])
    }
    return { full_name: `Fictional Representative ${n}`, country: 'ZA', investor_type: kind,
      company_name: company ? 'Fictional account representatives entity' : '',
      registration_reference: company ? 'FICTIONAL-REPS-001' : '',
      beneficial_owners: company ? 'One fictional controlling owner; no actual company evidence.' : '',
      source_of_funds: 'Fictional savings only; no customer money or personal information.',
      experience: 'Fictional experience for isolated functional workflow checks.', documents, test_data_acknowledged: true,
      ...(company ? { details_version: 3, ownership_change_reason: 'Initial fictional structured entity ownership.',
        ownership_control: [{ id: id(500 + n), party_type: 'PERSON', legal_name: 'Fictional Controlling Owner',
          registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
          control_basis: 'Fictional direct control for disposable functional proof only.', effective_on: '2026-09-01',
          change_reason: 'Initial fictional ownership disclosure.', evidence_document_id: documents[2].id }] } : {}) }
  }
  const approvedApplication = async (n, kind) => {
    let application = (await entry(n, 'start_application', { persona: 'INVESTOR' })).applications.find(a => a.persona === 'INVESTOR')
    const applicationDetails = await details(n, kind)
    application = applicationFrom(await entry(n, 'submit_application', { application_id: application.id,
      expected_revision: application.revision, details: applicationDetails }), application.id)
    application = applicationFrom(await command(4, reviewer, 'review_application', reviewApplication(application)), application.id)
    eq(application.status, 'APPROVED', `actor ${n} current ${kind} admission comes from canonical commands`)
    return { application, details: applicationDetails }
  }
  const waitOn = async (waiter, blocker) => {
    truth(waiter !== blocker, 'observed waiter and blocker are different PostgreSQL backends')
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await scalar(`select exists(select 1 from pg_stat_activity where pid=$1
        and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))`, [waiter, blocker], clients[1])) { checks++; return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Account representatives proof did not observe required independent-backend lock wait')
  }
  let baselineFunctions, parentFunctions, baselineSecurity, baselineRelations, baselineRows, installedFunctions
  let entity, targetB, targetC, account, ownMandate, accepted, declined, lifecycleMode
  const request = (n, overrides = {}) => ({ investment_account_id: account.id, expected_revision: 0,
    evidence_reference: 'Fictional board appointment of the named target in the already-reviewed COMPANY evidence.',
    appointment_document_id: entity.details.documents[1].id, requested_until: new Date(Date.now() + 86400000).toISOString(),
    ...(n === 1 ? {} : { representative_email: email(n) }), ...overrides })
  const mutationCases = a => [
    ['expired admission', 'update bx1_portal.applications set reviewed_at=now_at-interval \'31 days\',approved_until=now_at-interval \'1 day\' from (select clock_timestamp() now_at) t where id=$1', [a.id]],
    ['changed admission revision', 'update bx1_portal.applications set revision=revision+1 where id=$1', [a.id]],
    ['changed approved facts', "update bx1_portal.applications set details=jsonb_set(details,'{experience}',to_jsonb('Altered fictional facts without a new decision.'::text)) where id=$1", [a.id]],
    ['banned subject', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [a.user_id]],
    ['unconfirmed subject', 'update auth.users set email_confirmed_at=null where id=$1', [a.user_id]],
    ['suspended profile', "update public.bx1_profiles set status='SUSPENDED' where id=$1", [a.user_id]],
    ['monitoring hold', `insert into bx1_portal.customer_monitoring_cases(application_id,state,revision,decided_at,decided_by,last_receipt_id)
      values($1,'ON_HOLD',1,clock_timestamp(),$2,$3)`, [a.id, id(4), key()]],
    ['revoked known identity', `insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
      values($1,'Fictional negative identity','TRUSTED','fictional:representative-negative',$2);
      insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id)
      values($3,$1,'REVOKED','fictional:representative-negative',$4)`, [id(700), id(701), a.user_id, id(702)]],
  ]
  const assertMutationDenied = async (label, sql, values, run) => isolated(async () => {
    // Owner-only adversarial evidence setup is not a platform decision.
    // Split only the explicit two-statement negative identity fixture: pg does
    // not accept a multi-statement prepared query with bound parameters.
    if (label === 'revoked known identity') {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional negative identity','TRUSTED','fictional:representative-negative',$2)", values.slice(0, 2))
      await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'REVOKED','fictional:representative-negative',$3)", [values[2], values[0], values[3]])
    } else await db.query(sql, values)
    await run()
  })
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable cloud owner')
    const version = Number(await scalar('show server_version_num'))
    truth(version >= 170000 && version < 180000, 'existing disposable PostgreSQL17 fixture')
    const pids = await Promise.all([db, ...clients].map(client => scalar('select pg_backend_pid()', [], client)))
    eq(new Set(pids).size, 3, 'proof has three distinct actual backend PIDs')
    baselineFunctions = await functions(); baselineSecurity = await security(); baselineRelations = await relations(); baselineRows = await rows(baselineRelations)
    await begin()
    phase = 'exact-parent-prerequisite-and-install'
    if (await scalar("select to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null")) {
      const funding = await readFile(new URL('../../../supabase/features/bx1_portal_funding.sql', import.meta.url), 'utf8')
      const helper = funding.match(/create function bx1_private\.lock_funding_person\(actor uuid,expected_person uuid default null\) returns void\r?\nlanguage plpgsql volatile security definer set search_path='' as \$\$[\s\S]*?grant execute on function bx1_private\.lock_funding_person\(uuid,uuid\) to current_user;/g) ?? []
      eq(helper.length, 1, 'same exact canonical funding-person helper prerequisite as unchanged parent proof')
      await db.query(helper[0])
    }
    await db.query(admissionSql)
    parentFunctions = await functions()
    eq(await rows(baselineRelations), baselineRows, 'reinstalling exact rc32 parent creates no business or authority rows')
    eq(await security(), baselineSecurity, 'parent prerequisite/install preserves global role/table/RLS metadata')
    phase = 'representatives-install-and-preservation'
    // The offering migration renames the entity reader only AFTER the retained
    // SuperAdmin shell migration has narrowed its early guard. Derive that
    // exact precondition from both immutable source files, not an observed hash.
    const normalizeBody = body => body.replaceAll('\r\n', '\n').replace(/^[ \n\t]+|[ \n\t]+$/g, '')
    const bodyHash = body => createHash('sha256').update(normalizeBody(body), 'utf8').digest('hex')
    const entitySql = await readFile(new URL('../../../supabase/migrations/20260923171126_stage2_entity_investment_accounts.sql', import.meta.url), 'utf8')
    const shellSql = await readFile(new URL('../../../supabase/migrations/20260923175822_stage2_superadmin_shell_mfa_boundary.sql', import.meta.url), 'utf8')
    const offeringSql = await readFile(new URL('../../../supabase/migrations/20260923205519_stage3_immutable_offering_packages.sql', import.meta.url), 'utf8')
    const entityReaders = [...entitySql.matchAll(/create function bx1_portal\.read_scoped\(c jsonb\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)]
    const earlyGuards = [...shellSql.matchAll(/early_guard text:=\$bx1_pattern\$([\s\S]*?)\$bx1_pattern\$;/g)]
    const narrowedGuards = [...shellSql.matchAll(/narrowed_guard text:=\$bx1_replacement\$([\s\S]*?)\$bx1_replacement\$;/g)]
    eq(entityReaders.length, 1, 'retained entity migration has one canonical reader body')
    eq(earlyGuards.length, 1, 'retained shell migration has one exact early-guard pattern')
    eq(narrowedGuards.length, 1, 'retained shell migration has one exact narrowed-guard replacement')
    eq(offeringSql.split('alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_offering;').length - 1, 1,
      'retained offering migration renames the already-narrowed reader exactly once')
    const originalReader = normalizeBody(entityReaders[0][1])
    eq(bodyHash(originalReader), 'd617365508c6b7a9dda915738f66e5efec488006914da45de55810c9fdd95790',
      'retained pre-shell entity reader matches its original source digest')
    // Only POSIX whitespace needs translation for this retained SQL regex.
    const earlyGuard = new RegExp(earlyGuards[0][1].replaceAll('[[:space:]]', '\\s'), 'g')
    eq([...originalReader.matchAll(earlyGuard)].length, 1, 'retained shell guard transformation has exactly one reader callsite')
    const narrowedReader = originalReader.replace(earlyGuard, () => normalizeBody(narrowedGuards[0][1]))
    const narrowedHash = bodyHash(narrowedReader)
    eq(narrowedHash, '35b5e3f4757154acd203df6d998b8996dc8f2be1595f328cee8ebf7f902d6668',
      'source-derived post-shell reader has the exact installation precondition')
    eq(narrowedReader.split('where m.representative_user_id=auth.uid();').length - 1, 1,
      'post-shell reader retains exactly one intended representative visibility callsite')
    const cutoverBlocks = [...representativesSql.matchAll(/\$cutovers\$(\[[\s\S]*?\])\$cutovers\$::jsonb/g)]
    eq(cutoverBlocks.length, 1, 'representatives feature has one exact frozen cutover recipe block')
    const readerRecipes = JSON.parse(cutoverBlocks[0][1]).filter(spec => spec.signature === 'bx1_portal.read_scoped_pre_offering(jsonb)')
    eq(readerRecipes.length, 1, 'representatives feature has one exact renamed-reader recipe')
    eq(readerRecipes[0], { signature: 'bx1_portal.read_scoped_pre_offering(jsonb)', hash: narrowedHash,
      changes: [{ from: 'where m.representative_user_id=auth.uid();',
        to: 'where m.representative_user_id=auth.uid() or m.applicant_user_id=auth.uid();', count: 1 }] },
    'reader recipe requires source-derived exact body and unchanged single targeted replacement')
    const installedReader = await scalar("select prosrc from pg_proc where oid='bx1_portal.read_scoped_pre_offering(jsonb)'::regprocedure")
    eq(normalizeBody(installedReader), narrowedReader, 'actual cloud parent reader equals the exact retained migration-derived body')
    await db.query(representativesSql)
    installedFunctions = await functions()
    for (const prior of parentFunctions) {
      const current = installedFunctions.find(f => f.oid === prior.oid)
      truth(current, `existing ${prior.signature} retains OID`)
      eq({ ...current, body: prior.body }, prior, `existing ${prior.signature} retains signature/owner/ACL/security/search_path`)
      if (!changed.has(prior.signature)) eq(current.body, prior.body, `out-of-scope ${prior.signature} remains byte-identical`)
    }
    eq(installedFunctions.filter(f => f.nspname === 'public' && !parentFunctions.some(p => p.oid === f.oid)).map(f => f.signature),
      ['bx1_investing_proposal_document_lookup(uuid,uuid,jsonb)'], 'only one exact new public RPC; no proposal writer bypass')
    for (const helper of installedFunctions.filter(f => f.nspname === 'bx1_portal' && /^account_representative_/.test(f.proname))) {
      for (const r of ['anon', 'authenticated', 'service_role']) eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [r, helper.signature]), false,
        `${r} cannot invoke private ${helper.signature}`)
    }
    for (const relation of ['investing_representative_mandates', 'investing_representative_receipts']) {
      for (const r of ['anon', 'authenticated', 'service_role']) for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
        eq(await scalar('select has_table_privilege($1,$2,$3)', [r, `bx1_portal.${relation}`, privilege]), false, `${r} has no raw ${relation} ${privilege}`)
    }
    eq(await rows(baselineRelations), baselineRows, 'additive extension preserves all pre-existing row values')
    const originalMandateIds = baselineRows['bx1_portal.investing_representative_mandates'].map(m => m.id)
    eq(await scalar(`select count(*)::int from bx1_portal.investing_representative_mandates
      where id=any($1::uuid[]) and (representative_email is not null or representative_name is not null
        or representative_application_id is not null or representative_application_revision is not null
        or representative_submitted_revision is not null or representative_details_sha256 is not null
        or proposal_hash is not null or consent_decision is not null or consent_receipt_id is not null or responded_at is not null)`,
    [originalMandateIds]), 0, 'all new proposal/consent columns remain NULL on every inherited self-mandate')
    eq(await security(), baselineSecurity, 'extension changes no global roles/edges/relation grants/RLS policies')

    phase = 'fictional-current-admissions-and-original-self-mandate'
    lifecycleMode = await scalar('select mode from bx1_private.document_lifecycle_policy where singleton')
    eq(lifecycleMode, 'SCANNER_REQUIRED', 'inherited scanner-required mode recorded, never admitted as synthetic clean')
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    await db.query("insert into public.bx1_organisations(id,name,status) values($1,'Fictional unrelated representatives staff tenant','ACTIVE')", [otherScope])
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(n), email(n)])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),'aal1')", [id(100 + n), id(n)])
      await db.query('insert into public.bx1_profiles(id,display_name) values($1,$2)', [id(n), `Fictional Representative ${n}`])
      if ([4, 5, 6, 7].includes(n)) {
        await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(200 + n), id(n)])
        await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,$4)',
          [id(400 + n), id(n), n === 6 ? otherScope : scope, n === 5 || n === 7 ? 'SuperAdmin' : 'ComplianceOfficer'])
      }
    }
    entity = await approvedApplication(1, 'ENTITY'); targetB = await approvedApplication(2, 'INDIVIDUAL'); targetC = await approvedApplication(3, 'INDIVIDUAL')
    account = (await command(1, applicant, 'create_entity_investment_account', { application_id: entity.application.id })).entity_investment_accounts.find(a => a.application_id === entity.application.id)
    truth(account?.id, 'one legal-party/account created by original approved entity applicant')
    eq(account.can_view, false, 'account creation grants no representative view')
    ownMandate = (await command(1, applicant, requestAction, request(1))).investing_representative_mandates.find(m => m.representative_user_id === id(1))
    eq([ownMandate.status, ownMandate.revision], ['SUBMITTED', 1], 'unchanged self-request is its own consent, not PROPOSED')
    ownMandate = mandateFrom(await command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(ownMandate)), ownMandate.id)
    ownMandate = mandateFrom(await command(5, applier, 'apply_investing_representative_mandate', { mandate_id: ownMandate.id, expected_revision: ownMandate.revision }), ownMandate.id)
    eq([ownMandate.status, ownMandate.effective], ['APPLIED', true], 'original separately reviewed/applied self-mandate remains effective')

    phase = 'immutable-proposal-and-private-target-consent'
    // Exercise proposal evidence gates before B has any cycle: a live-cycle
    // denial must not stand in for actual source/target evidence validation.
    for (const subject of [entity.application, targetB.application]) for (const [label, sql, values] of mutationCases(subject))
      await assertMutationDenied(label, sql, values, () => denied(`${label} blocks proposing both source and target subjects`,
        () => command(1, applicant, requestAction, request(2))))
    for (const subject of [entity.application, targetB.application]) await assertMutationDenied('current but shorter admission',
      "update bx1_portal.applications set reviewed_at=expiry-interval '30 days',approved_until=expiry from (select clock_timestamp()+interval '1 hour' expiry) t where id=$1", [subject.id],
      () => denied('proposal cannot outlive either otherwise-current subject admission', () => command(1, applicant, requestAction, request(2))))
    await isolated(async () => {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(999), email(2)])
      await denied('non-unique target email is generic unavailable, not an arbitrary person', () => command(1, applicant, requestAction, request(2)))
    })
    await isolated(async () => {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional same-person negative','TRUSTED','fictional:same-person-negative',$2)", [id(700), id(701)])
      for (const n of [1, 2]) await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:same-person-negative',$3)", [id(n), id(700), id(710 + n)])
      await denied('known same person under proposer and target logins cannot create an additional-person proposal', () => command(1, applicant, requestAction, request(2)))
    })
    const proposalKey = key(), proposalBody = request(2)
    accepted = (await command(1, applicant, requestAction, proposalBody, proposalKey)).investing_representative_mandates.find(m => m.representative_user_id === id(2))
    eq([accepted.status, accepted.revision, accepted.next_owner, accepted.effective], ['PROPOSED', 1, 'REPRESENTATIVE', false], 'additional target owns consent before Compliance; no effective authority')
    eq([accepted.applicant_user_id, accepted.representative_user_id, accepted.representative_application_id, accepted.representative_application_revision],
      [id(1), id(2), targetB.application.id, targetB.application.revision], 'proposal binds original proposer and exact current individual target admission')
    assert.match(accepted.proposal_hash, /^[0-9a-f]{64}$/); checks++
    await admin()
    const originalTimeZone = await scalar('show TimeZone')
    await db.query("set local TimeZone='UTC'")
    const utcHash = await scalar('select bx1_portal.account_representative_proposal_hash(m) from bx1_portal.investing_representative_mandates m where id=$1', [accepted.id])
    await db.query("set local TimeZone='Pacific/Auckland'")
    eq(await scalar('select bx1_portal.account_representative_proposal_hash(m) from bx1_portal.investing_representative_mandates m where id=$1', [accepted.id]), utcHash,
      'immutable proposal fingerprint is independent of database TimeZone')
    eq(utcHash, accepted.proposal_hash, 'stored proposal fingerprint matches current exact canonical facts')
    await db.query("select set_config('TimeZone',$1,true)", [originalTimeZone])
    eq(accepted.transaction_limit_minor, '0', 'additional proposal transaction limit remains zero')
    eq(accepted.scope, ['ACCOUNT_VIEW', 'REQUEST_ELIGIBILITY'], 'additional proposal retains exact existing limited scope')
    const beforeProposalReplay = await state()
    eq(mandateFrom(await command(1, applicant, requestAction, proposalBody, proposalKey), accepted.id), accepted, 'exact proposal retry returns same immutable cycle')
    eq(await state(), beforeProposalReplay, 'proposal retry adds no request/receipt/audit or account')
    await denied('conflicting proposal request key', () => command(1, applicant, requestAction, { ...proposalBody, representative_email: email(3) }, proposalKey), '23505')
    await denied('live proposal cannot be overwritten by another key', () => command(1, applicant, requestAction, proposalBody), ['23514', '42501'])
    const targetRead = await read(2)
    eq(targetRead.investing_representative_mandates.map(m => m.id), [accepted.id], 'target sees own exact proposal, not original or other representative mandates')
    eq(targetRead.applications.map(a => a.id), [targetB.application.id], 'target cannot receive owner full admission/KYC/history in snapshot')
    eq(targetRead.entity_investment_accounts.some(a => a.id === account.id && a.can_view), false, 'PROPOSED grants no ACCOUNT_VIEW')
    eq(mandateFrom(targetRead, accepted.id).can_respond, true, 'current target may respond to exact proposal')
    eq(mandateFrom(await read(1), accepted.id).can_respond, false, 'proposer cannot consent for another person')
    eq((await read(3)).investing_representative_mandates.some(m => m.id === accepted.id), false, 'unrelated current individual cannot see B proposal')
    const document = await manifest(2, accepted)
    eq(Object.keys(document).sort(), ['applicant_user_id', 'document', 'mandate_id', 'mandate_revision', 'proposal_hash', 'validation_state'], 'proposal document lookup has exact bounded envelope')
    eq([document.mandate_id, document.mandate_revision, document.proposal_hash, document.applicant_user_id], [accepted.id, 1, accepted.proposal_hash, id(1)], 'private lookup binds exact proposal version and original source owner')
    eq(document.document, entity.details.documents[1], 'only exact already-reviewed COMPANY manifest supplied to target')
    eq(document.validation_state, 'SYNTHETIC_UNSCANNED', 'fictional manifest is labelled unscanned, never actual clean bytes')
    for (const doc of entity.details.documents) {
      await claims(2)
      eq(await scalar("select count(*)::int from storage.objects where bucket_id='bx1-portal-documents' and name=$1", [doc.storage_path]), doc.kind === 'COMPANY' ? 1 : 0, 'Storage grants only exact proposal COMPANY object, never owner identity/beneficial-owner objects')
      if (doc.kind !== 'COMPANY') await denied(`proposal cannot look up ${doc.kind} file`, () => manifest(2, accepted, doc.id))
    }
    await denied('unrelated actor cannot look up proposal document', () => manifest(3, accepted))
    await denied('target cannot use staff organisation context', () => manifest(2, accepted, accepted.appointment_document_id, reviewer))
    await denied('target cannot inspect full source history', async () => { await claims(2); await scalar('select public.bx1_application_document_versions($1,$2::jsonb)', [entity.application.id, JSON.stringify(applicant)]) })
    await denied('owner cannot respond for target', () => command(1, applicant, responseAction, response(accepted)))
    await denied('other target cannot respond', () => command(3, applicant, responseAction, response(accepted)))
    await denied('wrong proposal hash cannot consent', () => command(2, applicant, responseAction, { ...response(accepted), proposal_hash: 'a'.repeat(64) }), ['23514', '42501'])
    await denied('stale proposal revision cannot consent', () => command(2, applicant, responseAction, { ...response(accepted), expected_revision: 2 }), ['22023', '23514', '42501'])
    await denied('additional proposal cannot be reviewed before target consent', () => command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(accepted)))
    await denied('additional proposal cannot be applied before target consent', () => command(5, applier, 'apply_investing_representative_mandate', { mandate_id: accepted.id, expected_revision: 1 }))
    for (const [field, sql, value] of [
      ['explanation', 'evidence_reference', 'Changed fictional appointment without a new proposal.'],
      ['target', 'representative_user_id', id(3)], ['document', 'appointment_document_id', entity.details.documents[0].id],
      ['hash', 'proposal_hash', 'a'.repeat(64)],
    ]) await denied(`additional ${field} cannot mutate in place`, () => db.query(`update bx1_portal.investing_representative_mandates set ${sql}=$1 where id=$2`, [value, accepted.id]), '23514')

    phase = 'isolated-hosted-like-non-super-helper-owners'
    const paritySecurity = await security(), parityFunctions = await functions(), parityRows = await state()
    await isolated(async () => {
      const executor = 'bx1_account_reps_fixture_executor'
      eq(await scalar('select count(*)::int from pg_roles where rolname=$1', [executor]), 0, 'isolated parity executor is initially absent')
      await db.query(`create role ${executor} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
        grant usage on schema auth,public,bx1_private,storage to ${executor};
        grant usage,create on schema bx1_portal to ${executor};
        grant select,update on bx1_portal.investment_accounts,bx1_portal.investing_representative_mandates,
          bx1_portal.applications,bx1_portal.customer_monitoring_cases,bx1_portal.legal_entity_parties,
          auth.users,public.bx1_profiles,bx1_private.document_upload_receipts,
          bx1_private.document_lifecycle_policy,storage.objects to ${executor};
        grant select on bx1_portal.application_detail_versions,bx1_private.document_application_bindings,
          bx1_private.person_principals to ${executor};
        grant execute on function auth.uid(),bx1_portal.admission_context(jsonb),
          bx1_portal.admission_mandate_actor(jsonb,uuid,text),bx1_portal.admission_lock_people(uuid[]),
          bx1_portal.account_representative_document(uuid) to ${executor};
        alter function bx1_portal.account_representative_lock(jsonb,uuid) owner to ${executor};
        alter function bx1_portal.account_representative_document(uuid) owner to ${executor};
        grant execute on function bx1_portal.account_representative_lock(jsonb,uuid),
          bx1_portal.account_representative_document(uuid) to postgres`)
      eq(await scalar(`select not rolsuper and not rolinherit and not rolcanlogin and not rolcreatedb
        and not rolcreaterole and not rolreplication and rolbypassrls from pg_roles where rolname=$1`, [executor]), true,
      'new lock/document bodies themselves execute as hosted-like non-super owners')
      eq(await scalar("select has_any_column_privilege($1,'bx1_private.person_principals','UPDATE')", [executor]), false,
        'non-super lock owner does not acquire private principal row-update permission')
      eq(await scalar("select pg_has_role($1,'bx1_authority_owner','MEMBER')", [executor]), false,
        'non-super lock owner cannot inherit private identity authority')
      for (const signature of ['bx1_portal.account_representative_lock(jsonb,uuid)', 'bx1_portal.account_representative_document(uuid)'])
        eq(await scalar('select proowner=$2::regrole from pg_proc where oid=$1::regprocedure', [signature, executor]), true,
          'helper owner, not merely caller, is non-superuser')
      eq(await manifest(2, accepted), document, 'exact public document lookup works with non-super lock/document owners')
      const parityConsent = mandateFrom(await command(2, applicant, responseAction, response(accepted)), accepted.id)
      eq([parityConsent.status, parityConsent.revision, parityConsent.effective], ['SUBMITTED', 2, false],
        'canonical target response works under non-super helper ownership without additional authority')
    })
    eq(await security(), paritySecurity, 'isolated parity restores every role/edge/table/RLS grant')
    eq(await functions(), parityFunctions, 'isolated parity restores helper owner/ACL/body/config exactly')
    eq(await state(), parityRows, 'isolated parity response restores exact proposal/receipt/request/audit rows')

    phase = 'both-subjects-current-at-each-handoff'
    for (const subject of [entity.application, targetB.application]) for (const [label, sql, values] of mutationCases(subject)) {
      await assertMutationDenied(label, sql, values, async () => {
        await denied(`${subject.user_id} ${label} blocks target response`, () => command(2, applicant, responseAction, response(accepted)))
        await denied(`${subject.user_id} ${label} blocks exact proposal document`, () => manifest(2, accepted))
      })
    }
    for (const badEmail of ['missing-account-representative@example.invalid', email(4)]) {
      await denied('unavailable target returns generic authority denial', () => command(1, applicant, requestAction, request(2, { representative_email: badEmail })))
    }
    await denied('new file is not silently appended to reviewed COMPANY evidence', () => command(1, applicant, requestAction, request(3, { appointment_document_id: id(999) })))
    for (const expiry of [new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 31 * 86400000).toISOString()])
      await denied('proposal expiry must satisfy present admission and 30-day ceiling', () => command(1, applicant, requestAction, request(3, { requested_until: expiry })), ['42501', '22023', '23514'])
    const beforeConsentAudit = await state()
    await isolated(async () => {
      await db.query(`create function bx1_portal.representatives_fixture_audit_failure() returns trigger language plpgsql as $$
        begin if NEW.kind='${responseAction}' then raise exception 'fictional mandatory consent audit failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger representatives_fixture_audit_failure before insert on bx1_portal.events for each row execute function bx1_portal.representatives_fixture_audit_failure()`)
      await denied('consent cannot commit without required audit', () => command(2, applicant, responseAction, response(accepted)), '23514')
      eq(await state(), beforeConsentAudit, 'failed consent leaves proposal/receipts/requests/audit and account unchanged')
    })
    // Commit only disposable fiction and exact-source installers. The caller
    // already owns unconditional exact-schema cleanup on success AND failure.
    await commit()

    phase = 'simultaneous-response-real-backend-wait'
    await begin()
    const consentKey = key(), consentBody = response(accepted)
    accepted = mandateFrom(await command(2, applicant, responseAction, consentBody, consentKey), accepted.id)
    const blockerPid = await scalar('select pg_backend_pid()')
    await admin(clients[0]); await clients[0].query('begin')
    const waitingPid = await scalar('select pg_backend_pid()', [], clients[0])
    const responseOutcome = command(2, applicant, responseAction, consentBody, consentKey, {}, clients[0])
      .then(snapshot => ({ snapshot }), error => ({ code: error.code }))
    try { await waitOn(waitingPid, blockerPid) }
    finally { await commit() }
    const replayResult = await responseOutcome
    await admin(clients[0]); await clients[0].query(replayResult.code ? 'rollback' : 'commit')
    eq(replayResult.code, undefined, 'simultaneous exact consent retry succeeds only after actual original commit')
    eq(mandateFrom(replayResult.snapshot, accepted.id), accepted, 'simultaneous response returns same exact consent receipt/state')
    await begin(); await admin()
    eq([accepted.status, accepted.revision, accepted.consent_decision, accepted.next_owner, accepted.effective], ['SUBMITTED', 2, 'ACCEPT', 'COMPLIANCE', false], 'target ACCEPT advances immutable proposal to independent Compliance, not account authority')
    truth(accepted.consent_receipt_id && accepted.responded_at, 'response has durable operation-bound consent receipt and response time')
    for (const [label, field, value] of [
      ['explanation', 'evidence_reference', 'Changed fictional appointment despite existing target acceptance.'],
      ['expiry', 'requested_until', new Date(Date.now() + 2 * 86400000).toISOString()],
      ['document hash', 'appointment_document_sha256', 'a'.repeat(64)],
    ]) await denied(`consented ${label} is immutable even within an otherwise allowed staff transition`, () => db.query(`
      update bx1_portal.investing_representative_mandates set status='CHANGES_REQUIRED',revision=revision+1,
        reviewed_at=clock_timestamp(),reviewer_user_id=$1,review_notes='Fictional guarded transition comparison.',
        review_checks='{"appointment":true,"legal_entity":true,"scope":true}',${field}=$2 where id=$3`, [id(4), value, accepted.id]), '23514')
    await denied('durable consent receipt cannot be rewritten', () => db.query('update bx1_portal.investing_representative_receipts set command_payload=$1::jsonb where id=$2',
      [JSON.stringify({ ...consentBody, decision: 'DECLINE' }), accepted.consent_receipt_id]), '23514')
    await denied('durable consent receipt cannot be removed', () => db.query('delete from bx1_portal.investing_representative_receipts where id=$1', [accepted.consent_receipt_id]), '23514')
    eq(await scalar('select count(*)::int from bx1_portal.investing_representative_receipts where mandate_id=$1 and action=$2', [accepted.id, responseAction]), 1, 'concurrent exact response creates one consent receipt')
    eq(await scalar('select count(*)::int from bx1_portal.events where subject_id=$1 and kind=$2', [accepted.id, responseAction]), 1, 'concurrent exact response creates one audit event')
    await denied('opposite decision cannot reuse accepted response key', () => command(2, applicant, responseAction, { ...consentBody, decision: 'DECLINE' }, consentKey), '23505')
    await denied('accepted consent cannot be changed with another request key', () => command(2, applicant, responseAction, response(accepted, 'DECLINE')), ['22023', '42501', '23514'])
    for (const subject of [entity.application, targetB.application]) for (const [label, sql, values] of mutationCases(subject))
      await assertMutationDenied(label, sql, values, () => denied(`${label} blocks independent review for both subjects`, () => command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(accepted))))
    await denied('wrong staff scope cannot review accepted target', () => command(6, role('ComplianceOfficer', otherScope), 'review_investing_representative_mandate', reviewMandate(accepted)))
    await isolated(async () => {
      await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,\'ComplianceOfficer\'),($4,$5,$3,\'ComplianceOfficer\')', [key(), id(1), scope, key(), id(2)])
      await denied('proposer with staff role cannot review own proposal', () => command(1, reviewer, 'review_investing_representative_mandate', reviewMandate(accepted)))
      await denied('target with staff role cannot review own proposal', () => command(2, reviewer, 'review_investing_representative_mandate', reviewMandate(accepted)))
    })
    accepted = mandateFrom(await command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(accepted)), accepted.id)
    eq([accepted.status, accepted.revision, accepted.next_owner, accepted.effective], ['APPROVED', 3, 'SUPER_ADMIN', false], 'review advances same consented proposal to distinct application, not account access')
    for (const subject of [entity.application, targetB.application]) for (const [label, sql, values] of mutationCases(subject))
      await assertMutationDenied(label, sql, values, () => denied(`${label} blocks apply for both subjects`, () => command(5, applier, 'apply_investing_representative_mandate', { mandate_id: accepted.id, expected_revision: accepted.revision })))
    await isolated(async () => {
      for (const n of [1, 2, 4]) await db.query('insert into public.bx1_memberships(id,user_id,organisation_id,role) values($1,$2,$3,\'SuperAdmin\')', [key(), id(n), scope])
      for (const n of [1, 2, 4]) await denied('applier must differ from proposer, target and reviewer', () => command(n, applier, 'apply_investing_representative_mandate', { mandate_id: accepted.id, expected_revision: accepted.revision }))
    })
    const applyBody = { mandate_id: accepted.id, expected_revision: accepted.revision }, applyKey = key(), beforeApplyAudit = await state()
    await isolated(async () => {
      await db.query(`create function bx1_portal.representatives_fixture_apply_failure() returns trigger language plpgsql as $$
        begin if NEW.kind='apply_investing_representative_mandate' then raise exception 'fictional mandatory apply audit failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger representatives_fixture_apply_failure before insert on bx1_portal.events for each row execute function bx1_portal.representatives_fixture_apply_failure()`)
      await denied('apply cannot commit without required audit', () => command(5, applier, 'apply_investing_representative_mandate', applyBody), '23514')
      eq(await state(), beforeApplyAudit, 'failed apply leaves approval, consent, account and audit unchanged')
    })
    accepted = mandateFrom(await command(5, applier, 'apply_investing_representative_mandate', applyBody, applyKey), accepted.id)
    eq([accepted.status, accepted.revision, accepted.effective], ['APPLIED', 4, true], 'distinct functional TEST applier activates only target limited mandate')
    eq(mandateFrom(await command(5, applier, 'apply_investing_representative_mandate', applyBody, applyKey), accepted.id), accepted, 'apply exact retry preserves same consent and activation')
    eq((await read(2)).entity_investment_accounts.find(a => a.id === account.id)?.can_view, true, 'B account view becomes effective only after separate application')
    await denied('ACCOUNT_VIEW representative cannot delegate to another target', () => command(2, applicant, requestAction, request(3)))
    await denied('TEST password cannot protectively revoke', () => command(5, applier, 'revoke_investing_representative_mandate', { mandate_id: accepted.id, expected_revision: accepted.revision, reason: 'Fictional protective revocation boundary check.' }))
    for (const subject of [entity.application, targetB.application]) for (const [label, sql, values] of mutationCases(subject)) {
      await assertMutationDenied(label, sql, values, async () => {
        await claims(2); await admin()
        eq(await scalar('select bx1_portal.admission_investing_mandate_effective($1)', [accepted.id]), false, `${label} removes derived effective authority for both subjects`)
        await admin(); await db.query('savepoint representatives_read_gate')
        let snapshot, code
        try { snapshot = await read(1) } catch (error) { code = error.code }
        await db.query('rollback to savepoint representatives_read_gate; release savepoint representatives_read_gate'); await admin()
        truth(code === '42501' || (!code && mandateFrom(snapshot, accepted.id)?.effective !== true),
          'owner projection is denied/hidden/ineffective, never stale active target authority')
      })
    }
    await admin()
    eq(await scalar('select bx1_portal.entity_account_admission_current($1)', [account.id]), false, 'normal TEST extension does not inherit original downstream financial admission')
    for (const action of ['request_product_eligibility', 'subscribe', 'request_funding', 'settle_subscription', 'sign_transaction'])
      await denied(`representative view cannot execute ${action}`, () => command(2, applicant, action, {}))

    phase = 'decline-terminal-and-new-immutable-cycle'
    declined = (await command(1, applicant, requestAction, request(3))).investing_representative_mandates.find(m => m.representative_user_id === id(3))
    const declineKey = key(), declineBody = response(declined, 'DECLINE')
    declined = mandateFrom(await command(3, applicant, responseAction, declineBody, declineKey), declined.id)
    eq([declined.status, declined.revision, declined.consent_decision, declined.next_owner, declined.effective], ['DECLINED', 2, 'DECLINE', 'NONE', false], 'target decline is terminal and grants no authority')
    eq(mandateFrom(await command(3, applicant, responseAction, declineBody, declineKey), declined.id), declined, 'exact decline retry preserves immutable refusal')
    await denied('declined cycle cannot be accepted later', () => command(3, applicant, responseAction, response(declined)), ['22023', '42501', '23514'])
    await denied('declined cycle cannot receive staff approval', () => command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(declined)))
    eq(mandateFrom(await read(1), ownMandate.id).effective, true, 'C decline does not end A mandate')
    eq(mandateFrom(await read(1), accepted.id).effective, true, 'C decline does not end B mandate')
    const nextBody = request(3, { evidence_reference: 'New fictional immutable proposal following the prior target decline.' })
    const next = (await command(1, applicant, requestAction, nextBody)).investing_representative_mandates.find(m => m.representative_user_id === id(3) && m.cycle === declined.cycle + 1)
    truth(next?.id && next.id !== declined.id, 'new target cycle gets new immutable ID after terminal decline')
    eq([next.status, next.revision, next.consent_receipt_id, next.next_owner], ['PROPOSED', 1, null, 'REPRESENTATIVE'], 'new cycle requires fresh target consent')
    truth(next.proposal_hash !== declined.proposal_hash, 'new cycle facts produce a different proposal fingerprint')
    await denied('old consent hash cannot accept new cycle', () => command(3, applicant, responseAction, { ...response(next), proposal_hash: declined.proposal_hash }), ['42501', '23514'])
    let changes = mandateFrom(await command(3, applicant, responseAction, response(next)), next.id)
    changes = mandateFrom(await command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(changes, 'CHANGES_REQUIRED')), changes.id)
    await denied('additional changes-required facts cannot be edited in place', () => command(1, applicant, requestAction, { ...nextBody, expected_revision: changes.revision, evidence_reference: 'Edited fictional facts without fresh target consent.' }), '22023')
    await commit()

    phase = 'simultaneous-new-proposals-real-backend-wait'
    await begin()
    const concurrentBody = request(3, { evidence_reference: 'Another fictional immutable cycle following independent changes required.' })
    const concurrent = (await command(1, applicant, requestAction, concurrentBody)).investing_representative_mandates.find(m => m.representative_user_id === id(3) && m.cycle === changes.cycle + 1)
    truth(concurrent?.id, 'new changes-required cycle starts through original applicant only')
    await admin(clients[0]); await clients[0].query('begin')
    const proposalOutcome = command(1, applicant, requestAction, concurrentBody, key(), {}, clients[0]).then(snapshot => ({ snapshot }), error => ({ code: error.code }))
    try { await waitOn(pids[1], pids[0]) }
    finally { await commit() }
    const proposalResult = await proposalOutcome
    await admin(clients[0]); await clients[0].query('rollback')
    truth(['23514', '42501'].includes(proposalResult.code), 'simultaneous separate-key proposal cannot duplicate a live account/target cycle')
    await begin(); await admin()
    eq(await scalar('select count(*)::int from bx1_portal.investing_representative_mandates where investment_account_id=$1 and representative_user_id=$2 and cycle=$3', [account.id, id(3), concurrent.cycle]), 1, 'real proposal race creates exactly one immutable cycle')
    await command(3, applicant, responseAction, response(concurrent, 'DECLINE'))
    await commit()

    phase = 'authority-after-real-subject-row-waits'
    // Fresh committed proposal, then two genuine application-row waits.
    // Adversarial expiry is confined to these fictional admissions and restored
    // exactly afterward; no inherited authority/user/session is touched.
    await begin()
    let waitProposal = (await command(1, applicant, requestAction, request(3))).investing_representative_mandates.find(m => m.representative_user_id === id(3) && m.cycle === concurrent.cycle + 1)
    await commit()
    for (const subject of [entity.application, targetC.application]) {
      await begin()
      await admin(clients[0]); await clients[0].query('begin')
      const previous = (await clients[0].query('select reviewed_at::text,approved_until::text from bx1_portal.applications where id=$1 for update', [subject.id])).rows[0]
      await claims(3)
      const pending = scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [responseAction, key(), JSON.stringify(response(waitProposal)), JSON.stringify(applicant)])
        .then(value => ({ value }), error => ({ code: error.code }))
      let observed = false
      try {
        await waitOn(pids[0], pids[1]); observed = true
        await clients[0].query("update bx1_portal.applications set reviewed_at=now_at-interval '31 days',approved_until=now_at-interval '1 day' from (select clock_timestamp() now_at) t where id=$1", [subject.id])
      } finally { await clients[0].query('commit') }
      const result = await pending
      await db.query('rollback'); begun = false; await admin()
      await clients[0].query('update bx1_portal.applications set reviewed_at=$2::timestamptz,approved_until=$3::timestamptz where id=$1', [subject.id, previous.reviewed_at, previous.approved_until])
      truth(observed, 'response waited on a real locked subject admission')
      eq(result.code, '42501', 'subject expiry committed during actual wait denies consent after acquisition')
    }
    await begin()
    waitProposal = mandateFrom(await read(1), waitProposal.id)
    eq([waitProposal.status, waitProposal.revision], ['PROPOSED', 1], 'denied after-wait responses leave immutable proposal unchanged')

    phase = 'authority-after-real-monitoring-row-waits'
    // Owner-only adversarial monitoring rows add no authority beyond an absent
    // case. They are not claimed as canonical human decisions or provider
    // acceptance. Retained guard revision/state/time rules remain active.
    await admin()
    for (const subject of [entity.application, targetC.application]) {
      await db.query(`insert into bx1_portal.customer_monitoring_cases(application_id,state,revision,decided_at,decided_by,last_receipt_id)
        values($1,'CURRENT',1,clock_timestamp(),$2,$3)`, [subject.id, id(4), key()])
    }
    await commit()
    for (const subject of [entity.application, targetC.application]) {
      await begin()
      await admin(clients[0]); await clients[0].query('begin')
      await clients[0].query('select application_id from bx1_portal.customer_monitoring_cases where application_id=$1 for update', [subject.id])
      await claims(3)
      const pending = scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [responseAction, key(), JSON.stringify(response(waitProposal)), JSON.stringify(applicant)])
        .then(value => ({ value }), error => ({ code: error.code }))
      let observed = false
      try {
        await waitOn(pids[0], pids[1]); observed = true
        await clients[0].query(`update bx1_portal.customer_monitoring_cases set state='ON_HOLD',revision=revision+1,
          decided_at=greatest(clock_timestamp(),decided_at+interval '1 microsecond'),decided_by=$2,last_receipt_id=$3 where application_id=$1`,
        [subject.id, id(4), key()])
      } finally { await clients[0].query('commit') }
      const result = await pending
      await db.query('rollback'); begun = false; await admin()
      await clients[0].query(`update bx1_portal.customer_monitoring_cases set state='CURRENT',revision=revision+1,
        decided_at=greatest(clock_timestamp(),decided_at+interval '1 microsecond'),decided_by=$2,last_receipt_id=$3 where application_id=$1`,
      [subject.id, id(4), key()])
      truth(observed, 'consent waited on an actual existing subject monitoring row')
      eq(result.code, '42501', 'subject monitoring hold committed during actual wait denies consent after lock acquisition')
    }
    await begin()
    waitProposal = mandateFrom(await read(1), waitProposal.id)
    eq([waitProposal.status, waitProposal.revision, waitProposal.consent_receipt_id], ['PROPOSED', 1, null],
      'after-wait monitoring denials preserve proposal facts and absence of consent')

    phase = 'passive-expiry-and-fresh-target-consent'
    await command(3, applicant, responseAction, response(waitProposal, 'DECLINE'))
    const shortExpiry = new Date(Date.now() + 15000).toISOString()
    let expiring = (await command(1, applicant, requestAction, request(3, {
      requested_until: shortExpiry, evidence_reference: 'Short fictional appointment solely to observe real passive expiry.' })))
      .investing_representative_mandates.find(m => m.representative_user_id === id(3) && m.cycle === waitProposal.cycle + 1)
    truth(expiring?.id, 'short expiry is created by canonical new proposal, not by rewriting immutable dates')
    expiring = mandateFrom(await command(3, applicant, responseAction, response(expiring)), expiring.id)
    expiring = mandateFrom(await command(4, reviewer, 'review_investing_representative_mandate', reviewMandate(expiring)), expiring.id)
    expiring = mandateFrom(await command(5, applier, 'apply_investing_representative_mandate', { mandate_id: expiring.id, expected_revision: expiring.revision }), expiring.id)
    eq([expiring.status, expiring.revision, expiring.effective], ['APPLIED', 4, true], 'short appointment is independently applied before its real expiry')
    const beforePassiveExpiry = await state()
    const passiveDeadline = Date.now() + 20000
    while (Date.now() <= Date.parse(shortExpiry) && Date.now() < passiveDeadline) await new Promise(resolve => setTimeout(resolve, 20))
    truth(Date.now() > Date.parse(shortExpiry), 'bounded real clock reached immutable appointment expiry')
    const expiredProjection = mandateFrom(await read(1), expiring.id)
    eq([expiredProjection.status, expiredProjection.revision, expiredProjection.effective], ['APPLIED', 4, false],
      'passive expiry removes effective authority without fabricating an EXPIRED transition')
    eq(await state(), beforePassiveExpiry, 'passive clock expiry changes no stored proposal/receipt/request/audit row')
    eq((await read(3)).entity_investment_accounts.some(a => a.id === account.id && a.can_view), false, 'expired C loses account view')
    eq(mandateFrom(await read(1), ownMandate.id).effective, true, 'C passive expiry does not end A authority')
    eq(mandateFrom(await read(1), accepted.id).effective, true, 'C passive expiry does not end B authority')
    const renewal = (await command(1, applicant, requestAction, request(3, {
      evidence_reference: 'Fresh fictional appointment after passive expiry; target consent must be renewed.' })))
      .investing_representative_mandates.find(m => m.representative_user_id === id(3) && m.cycle === expiring.cycle + 1)
    eq([renewal?.status, renewal?.revision, renewal?.consent_receipt_id, renewal?.can_respond], ['PROPOSED', 1, null, false],
      'passive-expired cycle permits only a new immutable proposal, not inherited consent')
    truth(renewal.proposal_hash !== expiring.proposal_hash, 'fresh cycle after expiry has a new exact proposal hash')
    eq(mandateFrom(await read(3), renewal.id).can_respond, true, 'only the target can consent anew after passive expiry')

    phase = 'protected-revocation-and-isolated-other-representative'
    await isolated(async () => {
      // Explicit CI-only standard-assurance/person fixtures; NOT evidence of
      // actual independently verified people. Original protected revoke stays
      // unchanged and is invoked only through the canonical scoped command.
      for (const n of [1, 2, 4, 5]) {
        await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:protected-revoke-only',$3)", [id(800 + n), `Fictional protected revoke person ${n}`, id(850 + n)])
        await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:protected-revoke-only',$3)", [id(n), id(800 + n), id(870 + n)])
      }
      await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [id(205), id(105)])
      const assured = { aal: 'aal2', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }, { method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] }
      const revokeBody = { mandate_id: accepted.id, expected_revision: accepted.revision, reason: 'Fictional protective revocation of only the additional representative.' }, revokeKey = key()
      const revoked = mandateFrom(await command(5, applier, 'revoke_investing_representative_mandate', revokeBody, revokeKey, assured), accepted.id)
      eq([revoked.status, revoked.effective], ['REVOKED', false], 'unchanged protected canonical revocation ends only B mandate')
      eq(mandateFrom(await command(5, applier, 'revoke_investing_representative_mandate', revokeBody, revokeKey, assured), accepted.id).status, 'REVOKED', 'protected revoke exact retry is idempotent')
      eq(mandateFrom(await read(1), ownMandate.id).effective, true, 'protected B revocation preserves independent A authority')
      eq((await read(2)).entity_investment_accounts.some(a => a.id === account.id && a.can_view), false, 'revoked B loses account view')
    })
    eq(mandateFrom(await read(1), accepted.id).effective, true, 'rollback restores B fixture and removes all temporary TRUSTED identities/AAL2 changes')

    phase = 'final-global-financial-and-inherited-row-preservation'
    await admin()
    eq(await scalar('select count(*)::int from bx1_portal.investment_accounts where application_id=$1', [entity.application.id]), 1, 'all representative cycles share one unchanged legal-holder account')
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=any($1::uuid[])', [[1, 2, 3, 4, 5, 6, 7].map(id)]), 0, 'positive TEST fixture leaves no invented identity mappings')
    const finalFunctions = await functions()
    eq(finalFunctions, installedFunctions, 'all proof helper triggers/temporary functions roll back; installed definitions and ACLs remain exact')
    eq(await security(), baselineSecurity, 'all role/edge/table/RLS global metadata remains exact')
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [lifecycleMode])
    // The native upgrade necessarily records a new changed_at. Restore only
    // the original timestamp under a CI-owner fixture fence, then immediately
    // restore the unchanged trigger; no business command runs while disabled.
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_lifecycle_policy set changed_at=$1::timestamptz where singleton',
      [baselineRows['bx1_private.document_lifecycle_policy'][0].changed_at])
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    const originalConfiguration = baselineRows['bx1_portal.entry_configuration'][0]
    const originalReceiptPolicy = baselineRows['bx1_private.document_receipt_policy'][0]
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=$1 where singleton', [originalConfiguration.test_ordinary_entry_enabled])
    await db.query('update bx1_private.document_receipt_policy set enforced=$1 where singleton', [originalReceiptPolicy.enforced])
    const finalRows = await rows(baselineRelations)
    for (const spec of baselineRelations) {
      const name = `${spec.nspname}.${spec.relname}`
      const original = baselineRows[name], current = finalRows[name]
      for (const row of original) {
        const candidates = spec.primary_key.length ? current.filter(value => spec.primary_key.every(field => JSON.stringify(value[field]) === JSON.stringify(row[field]))) : current
        truth(candidates.some(value => JSON.stringify(value) === JSON.stringify(row)), `all inherited ${name} rows remain byte/value-identical`)
      }
      const permittedFixture = new Set(['auth.users', 'auth.sessions', 'auth.mfa_factors', 'public.bx1_profiles', 'public.bx1_memberships', 'public.bx1_organisations',
        'storage.objects', 'bx1_private.document_upload_receipts', 'bx1_private.document_application_bindings', 'bx1_private.document_receipt_events',
        'bx1_portal.applications', 'bx1_portal.entry_requests', 'bx1_portal.application_detail_versions', 'bx1_portal.customer_monitoring_cases',
        'bx1_portal.application_ownership_control_versions', 'bx1_portal.legal_entity_parties', 'bx1_portal.investment_accounts',
        'bx1_portal.investing_representative_mandates', 'bx1_portal.investing_representative_receipts', 'bx1_portal.scoped_requests', 'bx1_portal.events'])
      if (!permittedFixture.has(name)) eq(current, original, `all out-of-scope ${name} financial/provider/scanner/wallet/person rows remain exact`)
    }
    await commit()
    console.log(`BX1_ACCOUNT_REPRESENTATIVES_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 parent=rc32-original-proof-first account=one proposer=original-entity-applicant target=current-individual-admission consent=immutable-accept-decline documents=exact-proposal-only validation=synthetic-unscanned auditRollback=proven replay=proven concurrency=real-response-proposal-and-both-subject-admission-monitoring-waits hostedPrivilegeParity=non-super-lock-document-owner passiveExpiry=real-clock-new-consent-required delegation=denied financialExecution=denied inheritedRows=preserved globalGuards=preserved cleanup=caller-exact-schema-required hostedAcceptance=not-proven documentBytes=not-proven independentHumans=not-proven`)
    return checks
  } catch (error) {
    error.accountRepresentativesPhase = phase
    throw error
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
  }
}
