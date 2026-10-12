import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Appended to the unchanged Stage2 cloud proof, immediately before its existing
// disposable-schema cleanup. No local runtime, hosted user, uploaded bytes,
// scanner result, provider acceptance or real independent person is modelled.
export async function proveApplicationDrafts(db, clients, featureSql) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.argv.length !== 2
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Application draft proof requires exact disposable cloud fixture')
  assert.equal(clients.length, 2, 'two existing independent cloud backends required')
  let checks = 0, begun = false, phase = 'baseline', sequence = 1000
  const id = n => `ef850000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const issuer = 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
  const mainIssuer = 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1'
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const applicant = { mode: 'APPLICANT' }
  const readSignature = 'bx1_application_draft_read(uuid,integer,uuid)'
  const saveSignature = 'bx1_application_draft_save(uuid,jsonb)'
  const privateRead = 'bx1_portal.application_draft_read(uuid,integer,uuid)'
  const privateSave = 'bx1_portal.application_draft_save(uuid,jsonb)'
  const prerequisite = 'bx1_private.admission_receipt_session(uuid,uuid,jsonb)'
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const admin = (client = db) => client.query('reset role')
  const clock = () => scalar("select to_jsonb(clock_timestamp()) #>> '{}'")
  const claims = async (n, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: id(n), session_id: id(100 + n), role: 'authenticated', aal: 'aal1', iss: issuer,
      exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false,
      amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 1 }], ...extra,
    })])
    await client.query('set local role authenticated')
  }
  const seedActor = async n => {
    await admin()
    await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)',
      [id(n), `application-draft-${n}@example.invalid`])
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at,aal) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),'aal1')",
      [id(100 + n), id(n)])
  }
  const start = async (n, persona = 'INVESTOR', extra = {}) => {
    await claims(n, extra)
    const result = await scalar('select public.bx1_entry_command($1,$2,$3::jsonb)',
      ['start_application', key(), JSON.stringify({ persona })])
    const application = result.applications.find(a => a.persona === persona && a.context_kind === 'PERSONAL')
    truth(application?.id, 'fictional application identity comes from unchanged public entry RPC')
    eq(application.status, 'DRAFT', 'positive draft fixture begins unsubmitted and unapproved')
    return application
  }
  const read = async (n, application, requestKey = null, extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_application_draft_read($1::uuid,$2::integer,$3::uuid)',
      [application.id, application.revision, requestKey], client)
  }
  const save = async (n, payload, requestKey = key(), extra = {}, client = db) => {
    await claims(n, extra, client)
    return scalar('select public.bx1_application_draft_save($1::uuid,$2::jsonb)',
      [requestKey, payload === null ? null : JSON.stringify(payload)], client)
  }
  const unfinished = (extra = {}) => ({
    full_name: '', country: '', company_name: '', registration_reference: '', beneficial_owners: '',
    investor_type: 'INDIVIDUAL', source_of_funds: '', experience: '', business_activities: '',
    representative_position: '', authority_basis: '', documents: [], ownership_control: [], ownership_change_reason: '',
    ...extra,
  })
  const ownership = (n, extra = {}) => ({
    id: id(n), party_type: 'PERSON', legal_name: '', registration_reference: '', country: '', relationship: 'DIRECT_OWNER',
    ownership_basis_points: 0, control_basis: '', effective_on: '', change_reason: '', evidence_document_id: '', ...extra,
  })
  const body = (application, revision = 0, answers = unfinished(), step = 'identity') => ({
    application_id: application.id, expected_application_revision: application.revision,
    expected_draft_revision: revision, answers, step,
  })
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      md5(pg_get_functiondef(p.oid)) body,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','storage','public','bx1_private','bx1_portal') and p.prokind='f' order by p.oid`)).rows
  }
  const tables = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and (n.nspname in ('auth','storage','bx1_private','bx1_portal')
        or n.nspname='public' and c.relname like 'bx1_%') order by 1,2`)).rows
  }
  const rows = async (specs = installedTables) => {
    await admin()
    const result = {}
    for (const { nspname, relname } of specs) {
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
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t),
      'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from (select tr.oid,tr.tgrelid,tr.tgname,tr.tgenabled,
        pg_get_triggerdef(tr.oid) definition from pg_trigger tr join pg_class c on c.oid=tr.tgrelid
        join pg_namespace n on n.oid=c.relnamespace where not tr.tgisinternal
        and n.nspname in ('auth','storage','public','bx1_private','bx1_portal')) t))`)
  }
  const unchangedApplications = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'applications',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from bx1_portal.applications a),
      'history',(select coalesce(jsonb_agg(to_jsonb(v) order by application_id,application_revision),'[]') from bx1_portal.application_detail_versions v),
      'admission',(select coalesce(jsonb_agg(to_jsonb(b) order by application_id),'[]') from bx1_portal.application_admission_baseline b))`)
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); const before = await rows(); await db.query('savepoint draft_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint draft_denial; release savepoint draft_denial'); await admin()
    eq(code, expected, `${label}: exact SQLSTATE`)
    eq(await rows(), before, `${label}: failed operation leaves every business, authority, evidence, draft and receipt row unchanged`)
  }
  const isolated = async run => {
    await admin(); await db.query('savepoint draft_isolation')
    try { await run() }
    finally { await db.query('rollback to savepoint draft_isolation; release savepoint draft_isolation'); await admin() }
  }
  const exactKeys = (value, names, label) => eq(Object.keys(value).sort(), [...names].sort(), `${label}: exact fields`)
  const envelope = (value, actor, application, revision, payload = null, requestKey = null, startAt = null, endAt = null) => {
    exactKeys(value, ['version','environment','actor_id','application','base_application_revision','draft_revision','draft','receipt'], 'draft envelope')
    eq([value.version, value.environment, value.actor_id, value.base_application_revision, value.draft_revision],
      [1, 'TESTNET', actor, application.revision, revision], 'draft binds actual actor, environment and both independent revisions')
    eq(value.application, { id: application.id, persona: application.persona, status: application.status,
      context_kind: application.context_kind, context_organisation_id: application.context_organisation_id,
      origin: application.origin, admission_purpose: application.admission_purpose }, 'draft identity is the exact original application/context')
    if (payload === null) {
      eq([value.draft, value.receipt], [null, null], 'no current-base draft has no invented answers or receipt')
      return value
    }
    exactKeys(value.draft, ['answers','step','saved_at'], 'saved draft')
    eq([value.draft.answers, value.draft.step], [payload.answers, payload.step], 'all unfinished input survives without trimming, defaulting or final-admission coercion')
    truth(typeof value.draft.saved_at === 'string' && /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value.draft.saved_at), 'save time has explicit timezone')
    const timestamp = Date.parse(value.draft.saved_at)
    truth(Number.isFinite(timestamp), 'save time parses as a real timestamp')
    if (startAt !== null && endAt !== null) truth(timestamp >= Date.parse(startAt) && timestamp <= Date.parse(endAt), 'save time lies within the observed database window')
    if (requestKey === null) eq(value.receipt, null, 'unkeyed resume reveals no unrelated request receipt')
    else eq(value.receipt, { key: requestKey, payload, draft_revision: revision, saved_at: value.draft.saved_at }, 'receipt confirms exact sent key/body and current draft, not a partial echo')
    eq(Object.hasOwn(value.draft.answers, 'test_data_acknowledged'), false, 'draft cannot remember the submission acknowledgement')
    return value
  }
  const waitForBlocked = async (waiter, blocker) => {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await scalar(`select exists(select 1 from pg_stat_activity where pid=$1
        and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))`, [waiter, blocker])) { checks++; return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Application draft proof did not observe the required independent-backend revision lock wait')
  }
  let installedTables, installedFunctions, installedSecurity, retainedRows, raceApplication, inheritedApplicationRows
  let pendingRace
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable cloud owner')
    const version = Number(await scalar('show server_version_num'))
    truth(version >= 170000 && version < 180000, 'existing fixture uses PostgreSQL17')
    const pids = await Promise.all([db, ...clients].map(client => scalar('select pg_backend_pid()', [], client)))
    eq(new Set(pids).size, 3, 'one observer and two writers are actual distinct PostgreSQL backends')
    inheritedApplicationRows = await unchangedApplications()
    await db.query('begin'); begun = true
    phase = 'accepted-receipt-prerequisite'
    truth(await scalar("select to_regprocedure('bx1_portal.admission_password_session()') is not null"), 'unchanged preceding proof retained accepted normal-admission feature')
    truth(await scalar("select to_regprocedure('public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb)') is not null"), 'unchanged preceding proof retained accepted representative feature')
    if (await scalar('select to_regprocedure($1) is null', [prerequisite])) {
      const before = await rows(await tables())
      await db.query(await readFile(new URL('../../../supabase/features/bx1_admission_document_receipts.sql', import.meta.url), 'utf8'))
      eq(await rows(await tables()), before, 'accepted receipt prerequisite installs no business/Auth/Storage rows')
    }
    phase = 'additive-draft-install-and-private-acl'
    const priorFunctions = await functions(), priorTables = await tables(), priorRows = await rows(priorTables), priorSecurity = await security()
    eq(await scalar("select to_regclass('bx1_portal.application_drafts') is null and to_regclass('bx1_portal.application_draft_requests') is null"), true, 'new dedicated draft tables are not preinstalled')
    await db.query(featureSql)
    installedTables = await tables(); installedFunctions = await functions(); installedSecurity = await security()
    eq(await rows(priorTables), priorRows, 'new draft feature changes no inherited business, Auth, evidence or configuration row')
    for (const original of priorFunctions) eq(installedFunctions.find(f => f.oid === original.oid), original, `existing ${original.signature} keeps exact OID/body/owner/ACL/security/search_path`)
    for (const name of ['roles','edges','policies']) eq(installedSecurity[name], priorSecurity[name], `draft creates no global ${name}`)
    for (const name of ['relations','triggers']) for (const original of priorSecurity[name] ?? [])
      eq(installedSecurity[name].find(value => value.oid === original.oid), original, `every inherited ${name} object remains exact and active`)
    eq(installedTables.filter(t => !priorTables.some(p => p.nspname === t.nspname && p.relname === t.relname)),
      [{ nspname: 'bx1_portal', relname: 'application_draft_requests' }, { nspname: 'bx1_portal', relname: 'application_drafts' }], 'only two additive private draft tables')
    eq(installedFunctions.filter(f => f.nspname === 'public' && !priorFunctions.some(p => p.oid === f.oid)).map(f => f.signature).sort(),
      [readSignature, saveSignature].sort(), 'exactly two bounded new public draft RPCs')
    for (const signature of [readSignature, saveSignature]) {
      const f = installedFunctions.find(value => value.nspname === 'public' && value.signature === signature)
      eq([f.prosecdef, f.proconfig], [false, ['search_path=""']], `${signature} is an empty-search-path security-invoker bridge`)
      eq(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), true, 'authenticated can reach bounded public draft RPC')
      for (const role of ['anon','service_role']) eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [role, signature]), false, `${role} has no draft public RPC grant`)
    }
    for (const signature of [privateRead, privateSave]) {
      const f = installedFunctions.find(value => value.signature === signature)
      truth(f, 'public bridge has its exact bounded private implementation')
      eq([f.prosecdef, f.proconfig], [true, ['search_path=""']], `${signature} keeps an empty-search-path definer boundary`)
    }
    for (const f of installedFunctions.filter(value => value.nspname === 'bx1_portal' && !priorFunctions.some(p => p.oid === value.oid))) {
      for (const role of ['anon','service_role']) eq(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')', [role, f.signature]), false, `${role} cannot bypass through ${f.signature}`)
      if (![privateRead, privateSave].includes(f.signature)) eq(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE')", [f.signature]), false, `authenticated cannot directly invoke private helper ${f.signature}`)
    }
    for (const table of ['application_drafts','application_draft_requests']) {
      eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`bx1_portal.${table}`]), true, 'private draft table retains RLS')
      for (const role of ['anon','authenticated','service_role']) for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
        eq(await scalar('select has_table_privilege($1,$2,$3)', [role, `bx1_portal.${table}`, privilege]), false, `${role} has no raw ${table} ${privilege}`)
    }
    phase = 'narrow-committed-race-fixture'
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
    await seedActor(1); raceApplication = await start(1)
    eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=$1', [id(1)]), 0, 'fictional ordinary applicant has no fabricated trusted person mapping')
    eq(await scalar('select count(*)::int from auth.mfa_factors where user_id=$1', [id(1)]), 0, 'fictional draft fixture fabricates no enrolled MFA factor')
    retainedRows = await rows()
    await admin(); await db.query('commit'); begun = false

    // All functional/negative fixtures are rollback-only. Only the one native
    // application above is committed to make the two-writer wait observable.
    phase = 'lossless-save-resume-and-key-recovery'
    await db.query('begin'); begun = true
    await seedActor(2); await seedActor(3)
    const application = await start(2), manager = await start(2, 'WEALTH_MANAGER'), foreignApplication = await start(3)
    const originalApplications = await unchangedApplications()
    envelope(await read(2, application), id(2), application, 0)
    await claims(2)
    envelope(await scalar('select public.bx1_application_draft_read($1::uuid,$2::integer)', [application.id, application.revision]), id(2), application, 0)
    const answers = unfinished({ full_name: ' A ', country: 'Z', company_name: ' C ', registration_reference: 'R',
      beneficial_owners: ' \n ', investor_type: 'ENTITY', source_of_funds: ' S ', experience: 'E', business_activities: 'B',
      representative_position: 'P', authority_basis: 'A', ownership_change_reason: ' \nunfinished ',
      ownership_control: [ownership(500), ownership(501, { party_type: 'ENTITY', legal_name: ' L ', country: 'Z',
        relationship: 'INDIRECT_OWNER', ownership_basis_points: 10000, effective_on: '2026-', control_basis: ' C ', change_reason: 'x' })] })
    const firstBody = body(application, 0, answers, 'ownership'), firstKey = key(), firstStarted = await clock()
    const first = await save(2, firstBody, firstKey)
    envelope(first, id(2), application, 1, firstBody, firstKey, firstStarted, await clock())
    const afterFirst = await rows()
    eq(await scalar('select to_jsonb(d) from bx1_portal.application_drafts d where application_id=$1', [application.id]), {
      application_id: application.id, actor_id: id(2), base_application_revision: application.revision,
      draft_revision: 1, answers, step: firstBody.step, saved_at: first.draft.saved_at,
    }, 'stored draft row contains exact input-derived identity, revisions, answers and save time')
    const storedRequest = await scalar('select to_jsonb(r) from bx1_portal.application_draft_requests r where actor_id=$1 and request_key=$2', [id(2), firstKey])
    eq({ ...storedRequest, created_at: undefined }, { actor_id: id(2), request_key: firstKey,
      application_id: application.id, payload: firstBody, draft_revision: 1, saved_at: first.draft.saved_at, created_at: undefined },
    'stored request ledger contains exact sent body without reinterpretation')
    eq(await save(2, firstBody, firstKey), first, 'exact replay returns exact original receipt without a second save')
    eq(await rows(), afterFirst, 'exact replay emits no extra draft, ledger or audit mutation')
    eq(await read(2, application, firstKey), first, 'read-key recovers exact confirmed save after an unknown response')
    envelope(await read(2, application), id(2), application, 1, firstBody)
    envelope(await read(2, application, key()), id(2), application, 1, firstBody)
    await denied('changed body under original request key cannot overwrite', () => save(2, { ...firstBody, step: 'review' }, firstKey), '23505')
    await denied('another actor cannot resume private answers', () => read(3, application))
    await denied('another actor cannot save private answers', () => save(3, body(application, 1)))
    await denied('missing application is not a draft capability', () => read(2, { ...application, id: id(997) }))
    await denied('missing application cannot receive a draft', () => save(2, body({ ...application, id: id(997) })))
    await denied('read expected application revision is not optional authority', () => read(2, { ...application, revision: application.revision + 1 }), '40001')
    await denied('one actor cannot reuse another application receipt', () => read(2, manager, firstKey), '40001')
    await denied('stale draft revision cannot save', () => save(2, body(application, 0)), '40001')
    const secondBody = body(application, 1, unfinished(), 'review'), secondKey = key()
    const second = await save(2, secondBody, secondKey)
    envelope(second, id(2), application, 2, secondBody, secondKey)
    await denied('old exact replay cannot falsely confirm newer current content', () => save(2, firstBody, firstKey), '40001')
    await denied('old read-key cannot return superseded receipt as current', () => read(2, application, firstKey), '40001')
    envelope(await read(2, application, secondKey), id(2), application, 2, secondBody, secondKey)
    envelope(await read(3, foreignApplication, secondKey), id(3), foreignApplication, 0)
    eq(await unchangedApplications(), originalApplications, 'save/read/replay leave every application, submission history and admission baseline unchanged')

    phase = 'unfinished-bounds-and-no-submission-acknowledgement'
    const limits = { full_name: 120, country: 2, company_name: 160, registration_reference: 100,
      beneficial_owners: 2000, source_of_funds: 2000, experience: 2000, business_activities: 2000,
      representative_position: 160, authority_basis: 2000, ownership_change_reason: 500 }
    await isolated(async () => {
      const maximum = unfinished(Object.fromEntries(Object.entries(limits).map(([name, max]) => [name, '界'.repeat(max)])))
      maximum.ownership_control = Array.from({ length: 20 }, (_, i) => ownership(520 + i, {
        legal_name: '界'.repeat(160), registration_reference: '界'.repeat(100), country: '界界',
        control_basis: '界'.repeat(1000), change_reason: '界'.repeat(500), effective_on: 'x'.repeat(10),
      }))
      const maximumBody = body(manager, 0, maximum), maximumKey = key()
      envelope(await save(2, maximumBody, maximumKey), id(2), manager, 1, maximumBody, maximumKey)
      envelope(await read(2, manager), id(2), manager, 1, maximumBody)
    })
    await isolated(async () => {
      const astralBody = body(manager, 0, unfinished({ full_name: '😀'.repeat(60), country: '😀',
        ownership_control: [ownership(590, { control_basis: '😀'.repeat(500) })] })), astralKey = key()
      envelope(await save(2, astralBody, astralKey), id(2), manager, 1, astralBody, astralKey)
      envelope(await read(2, manager), id(2), manager, 1, astralBody)
    })
    for (const [field, maximum] of Object.entries(limits)) await denied(`bounded unfinished ${field}`,
      () => save(2, body(manager, 0, unfinished({ [field]: 'x'.repeat(maximum + 1) }))), '22023')
    await denied('astral text beyond browser UTF16 full-name bound', () => save(2,
      body(manager, 0, unfinished({ full_name: '😀'.repeat(61) }))), '22023')
    await denied('astral text beyond browser UTF16 country bound', () => save(2,
      body(manager, 0, unfinished({ country: '😀😀' }))), '22023')
    await denied('astral ownership beyond browser UTF16 control-basis bound', () => save(2,
      body(manager, 0, unfinished({ ownership_control: [ownership(591, { control_basis: '😀'.repeat(501) })] }))), '22023')
    for (const [label, payload] of [
      ['submission acknowledgement cannot be persisted', body(manager, 0, unfinished({ test_data_acknowledged: true }))],
      ['no invented final details version', body(manager, 0, unfinished({ details_version: 3 }))],
      ['unknown actor/environment/context is not authority', { ...body(manager), actor_id: id(3), environment: 'MAINNET', context: applicant }],
      ['missing answer field', body(manager, 0, Object.fromEntries(Object.entries(unfinished()).filter(([name]) => name !== 'full_name')))],
      ['wrong answer field type', body(manager, 0, unfinished({ full_name: null }))],
      ['unsupported investor type', body(manager, 0, unfinished({ investor_type: 'PROFESSIONAL' }))],
      ['noninteger draft revision', { ...body(manager), expected_draft_revision: 0.5 }],
      ['negative draft revision', { ...body(manager), expected_draft_revision: -1 }],
      ['invalid application revision', { ...body(manager), expected_application_revision: 0 }],
      ['unsupported step', { ...body(manager), step: 'approve' }],
      ['too many ownership records', body(manager, 0, unfinished({ ownership_control: Array.from({ length: 21 }, (_, i) => ownership(550 + i)) }))],
      ['invalid ownership identifier', body(manager, 0, unfinished({ ownership_control: [ownership(600, { id: '' })] }))],
      ['invalid ownership type', body(manager, 0, unfinished({ ownership_control: [ownership(600, { party_type: 'BANK' })] }))],
      ['unbounded ownership legal name', body(manager, 0, unfinished({ ownership_control: [ownership(600, { legal_name: 'x'.repeat(161) })] }))],
      ['unbounded ownership registration', body(manager, 0, unfinished({ ownership_control: [ownership(600, { registration_reference: 'x'.repeat(101) })] }))],
      ['unbounded ownership country', body(manager, 0, unfinished({ ownership_control: [ownership(600, { country: 'ZAF' })] }))],
      ['unbounded ownership control basis', body(manager, 0, unfinished({ ownership_control: [ownership(600, { control_basis: 'x'.repeat(1001) })] }))],
      ['unbounded ownership change reason', body(manager, 0, unfinished({ ownership_control: [ownership(600, { change_reason: 'x'.repeat(501) })] }))],
      ['unbounded unfinished ownership date', body(manager, 0, unfinished({ ownership_control: [ownership(600, { effective_on: 'x'.repeat(11) })] }))],
      ['ownership points outside bound', body(manager, 0, unfinished({ ownership_control: [ownership(600, { ownership_basis_points: 10001 })] }))],
      ['fractional ownership points', body(manager, 0, unfinished({ ownership_control: [ownership(600, { ownership_basis_points: 0.1 })] }))],
      ['malformed ownership evidence reference', body(manager, 0, unfinished({ ownership_control: [ownership(600, { evidence_document_id: 'not-a-uuid' })] }))],
      ['incomplete document metadata', body(manager, 0, unfinished({ documents: [{ id: id(650), kind: 'IDENTITY' }] }))],
    ]) await denied(label, () => save(2, payload), '22023')
    await denied('null payload is not an unfinished form', () => save(2, null), '22023')
    await denied('null request key cannot become a non-idempotent save', () => save(2, body(manager), null), '22023')
    await denied('zero request key cannot become a non-idempotent save', () => save(2, body(manager), '00000000-0000-0000-0000-000000000000'), '22023')

    phase = 'existing-fictional-receipt-reference-roundtrip'
    // Use real inherited synthetic metadata, without downgrading scanner mode,
    // suspending a native trigger, fabricating CLEAN evidence or handling bytes.
    const receiptActor = 'ef830000-0000-4000-8000-000000000001', receiptSession = 'ef830000-0000-4000-8000-000000000101'
    await admin()
    const reference = (await db.query(`select r.id,r.kind,r.title,r.storage_path,r.sha256,r.byte_size size,r.mime_type
      from bx1_private.document_upload_receipts r join storage.objects o
      on o.bucket_id='bx1-portal-documents' and o.name=r.storage_path and o.owner_id=r.actor_id::text
      where r.actor_id=$1 and r.kind='BENEFICIAL_OWNERS' order by r.id limit 1`, [receiptActor])).rows[0]
    truth(reference, 'accepted preceding fictional entity journey supplies an owner-bound reference')
    const receiptClaims = { sub: receiptActor, session_id: receiptSession }
    const referenceApp = await start(1, 'WEALTH_MANAGER', receiptClaims)
    const referenceApplications = await unchangedApplications()
    const referenceBody = body(referenceApp, 0, unfinished({ documents: [reference], ownership_control: [ownership(660, { evidence_document_id: reference.id })] }), 'evidence')
    const referenceKey = key()
    envelope(await save(1, referenceBody, referenceKey, receiptClaims), receiptActor, referenceApp, 1, referenceBody, referenceKey)
    envelope(await read(1, referenceApp, referenceKey, receiptClaims), receiptActor, referenceApp, 1, referenceBody, referenceKey)
    eq(await unchangedApplications(), referenceApplications, 'saving evidence references never binds, submits, approves or rewrites the inherited application history')
    await isolated(async () => {
      const maximumReferences = body(referenceApp, 1, unfinished({ documents: Array.from({ length: 8 }, () => reference) }), 'evidence'), k = key()
      envelope(await save(1, maximumReferences, k, receiptClaims), receiptActor, referenceApp, 2, maximumReferences, k)
      envelope(await read(1, referenceApp, null, receiptClaims), receiptActor, referenceApp, 2, maximumReferences)
    })
    await denied('foreign receipt ownership cannot be claimed in a draft', () => save(2, body(manager, 0, unfinished({ documents: [reference] }))))
    await denied('missing private receipt cannot be claimed in a draft', () => save(1,
      body(referenceApp, 1, unfinished({ documents: [{ ...reference, id: id(699), storage_path: `${receiptActor}/${id(699)}` }] })), key(), receiptClaims))
    await denied('receipt hash mismatch cannot be claimed in a draft', () => save(1,
      body(referenceApp, 1, unfinished({ documents: [{ ...reference, sha256: 'e'.repeat(64) }] })), key(), receiptClaims))
    for (const [field, value] of Object.entries({ title: `${reference.title} mismatch`, size: reference.size + 1,
      kind: reference.kind === 'IDENTITY' ? 'ADDRESS' : 'IDENTITY', mime_type: reference.mime_type === 'image/png' ? 'application/pdf' : 'image/png',
      storage_path: `${receiptActor}/${id(698)}` })) await denied(`receipt ${field} mismatch cannot be claimed`, () => save(1,
      body(referenceApp, 1, unfinished({ documents: [{ ...reference, [field]: value }] })), key(), receiptClaims))
    for (const [field, value] of Object.entries({ title: 'x'.repeat(161), storage_path: 'x'.repeat(401), sha256: 'not-a-sha256',
      size: 4194305, mime_type: 'text/html', kind: 'CLEARANCE' })) await denied(`bounded complete document ${field}`, () => save(1,
      body(referenceApp, 1, unfinished({ documents: [{ ...reference, [field]: value }] })), key(), receiptClaims), '22023')
    await denied('astral document title beyond browser UTF16 bound', () => save(1,
      body(referenceApp, 1, unfinished({ documents: [{ ...reference, title: '😀'.repeat(81) }] })), key(), receiptClaims), '22023')
    await denied('too many complete evidence references', () => save(1,
      body(referenceApp, 1, unfinished({ documents: Array.from({ length: 9 }, () => reference) })), key(), receiptClaims), '22023')

    phase = 'current-base-generation-and-editable-state-guards'
    await isolated(async () => {
      await db.query('update bx1_portal.applications set revision=revision+1 where id=$1', [application.id])
      const current = { ...application, revision: application.revision + 1 }
      envelope(await read(2, current), id(2), current, 0)
      await denied('old base cannot read current generation', () => read(2, application), '40001')
      await denied('old application base cannot save', () => save(2, body(application, 2)), '40001')
      await denied('old receipt cannot confirm a different current base', () => read(2, current, secondKey), '40001')
      const freshBody = body(current), freshKey = key()
      envelope(await save(2, freshBody, freshKey), id(2), current, 1, freshBody, freshKey)
      await admin()
      eq(await scalar('select count(*)::int from bx1_portal.application_draft_requests where actor_id=$1 and application_id=$2', [id(2), application.id]), 3, 'generation change retains immutable older receipts rather than silently deleting history')
    })
    for (const status of ['CHANGES_REQUIRED','REJECTED']) await isolated(async () => {
      await db.query('update bx1_portal.applications set status=$2,reviewer_scope=$3,provider_mode=\'MANUAL_TEST_REVIEW\' where id=$1', [manager.id, status, scope])
      const editable = { ...manager, status }
      envelope(await read(2, editable), id(2), editable, 0)
      const p = body(editable), k = key()
      envelope(await save(2, p, k), id(2), editable, 1, p, k)
    })
    for (const status of ['SUBMITTED','APPROVED']) await isolated(async () => {
      // Negative owner setup only; no command or test claims this empty case
      // passed submission validation. Its native receipt/identity guards stay on.
      await claims(2); await admin()
      await db.query(`update bx1_portal.applications set status=$2,reviewer_scope=$3,provider_mode='MANUAL_TEST_REVIEW',
        details=case when $2='SUBMITTED' then '{"documents":[]}'::jsonb else details end,
        reviewed_at=case when $2='APPROVED' then stamp.at else null end,
        approved_until=case when $2='APPROVED' then stamp.at+interval '30 days' else null end
        from (select clock_timestamp() at) stamp where id=$1`, [application.id, status, scope])
      await denied(`${status} application cannot resume editable answers`, () => read(2, application))
      await denied(`${status} application cannot save editable answers`, () => save(2, body(application, 2)))
    })
    await isolated(async () => {
      // Negative owner setup creates an unsupported organisation-context case;
      // its original immutable context guard remains active throughout.
      await db.query(`insert into bx1_portal.applications(id,user_id,persona,status,details,context_kind,context_organisation_id,origin,provider_mode)
        values($1,$2,'INVESTOR','DRAFT','{}','ORGANISATION',$3,'SELF_SERVICE','UNASSIGNED')`, [id(700), id(2), scope])
      const organisationCase = { ...application, id: id(700), revision: 1 }
      await denied('unsupported organisation context cannot read a personal draft', () => read(2, organisationCase))
      await denied('unsupported organisation context cannot save a personal draft', () => save(2, body(organisationCase)))
      await db.query("insert into public.bx1_profiles(id,display_name) values($1,'Fictional ordinary context member')", [id(2)])
      await db.query("insert into public.bx1_memberships(user_id,organisation_id,role) values($1,$2,'OfferingManager')", [id(2), scope])
      await claims(2); await admin()
      eq(await scalar('select bx1_portal.entry_context_available($1::uuid)', [scope]), true, 'negative unsupported context has real current fictional membership, not missing-context authority')
      await denied('even an active member cannot draft through an unadmitted organisation context', () => read(2, organisationCase))
      await denied('even an active member cannot save through an unadmitted organisation context', () => save(2, body(organisationCase)))
    })

    phase = 'live-session-and-main-default-closed'
    for (const [label, extra] of [
      ['foreign issuer', { iss: mainIssuer }], ['missing native session', { session_id: id(998) }],
      ['foreign actor session', { session_id: id(103) }],
    ]) {
      await denied(`${label} denies draft read`, () => read(2, application, null, extra))
      await denied(`${label} denies draft save`, () => save(2, body(application, 2), key(), extra))
    }
    for (const [label, sql, values] of [
      ['expired native session', "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(102)]],
      ['deleted actor', 'update auth.users set deleted_at=clock_timestamp() where id=$1', [id(2)]],
      ['banned actor', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [id(2)]],
      ['unconfirmed email', 'update auth.users set email_confirmed_at=null where id=$1', [id(2)]],
      ['anonymous native actor', 'update auth.users set is_anonymous=true where id=$1', [id(2)]],
      ['revoked native session', 'delete from auth.sessions where id=$1 and user_id=$2', [id(102), id(2)]],
      ['suspended native profile', "insert into public.bx1_profiles(id,display_name,status) values($1,'Fictional suspended draft applicant','SUSPENDED')", [id(2)]],
      ['disabled TEST intake', 'update bx1_portal.entry_configuration set manual_test_review=false,reviewer_scope=null where singleton', []],
    ]) await isolated(async () => {
      await db.query(sql, values)
      await denied(`${label} denies read`, () => read(2, application))
      await denied(`${label} denies save`, () => save(2, body(application, 2)))
    })
    await isolated(async () => {
      await db.query("update public.bx1_organisations set status='SUSPENDED' where id=$1", [scope])
      await denied('inactive admitted intake organisation denies draft read', () => read(2, application))
      await denied('inactive admitted intake organisation denies draft save', () => save(2, body(application, 2)))
    })
    // SQL receives server-verified transport. Do not invent a stricter legacy
    // token-verification policy here: malformed synthetic claims/switch changes
    // must behave exactly like the retained current PREPARE handoff permits.
    for (const [label, extra, disableOrdinary] of [
      ['expired synthetic token', { exp: Math.floor(Date.now() / 1000) - 1 }, false],
      ['anonymous synthetic token', { is_anonymous: true }, false],
      ['missing password method', { amr: [] }, false],
      ['ordinary TEST switch disabled with valid standard session', {}, true],
    ]) await isolated(async () => {
      if (disableOrdinary) await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton')
      await claims(2, extra); await admin(); await db.query('savepoint draft_native_preparation')
      let native, nativeCode
      try { native = await scalar('select bx1_portal.admission_application_handoff($1::jsonb,$2::uuid)', [JSON.stringify(applicant), application.id]) }
      catch (error) { nativeCode = error?.code }
      await db.query('rollback to savepoint draft_native_preparation; release savepoint draft_native_preparation')
      if (!nativeCode && native?.allowed_actions?.includes('PREPARE_APPLICATION')) {
        envelope(await read(2, application, null, extra), id(2), application, 2, secondBody)
        const p = body(application, 2), k = key()
        envelope(await save(2, p, k, extra), id(2), application, 3, p, k)
      } else {
        await denied(`${label} follows retained PREPARE read denial`, () => read(2, application, null, extra))
        await denied(`${label} follows retained PREPARE save denial`, () => save(2, body(application, 2), key(), extra))
      }
    })
    await isolated(async () => {
      await db.query("update bx1_portal.entry_configuration set environment='MAINNET',test_ordinary_entry_enabled=false,manual_test_review=false,reviewer_scope=null where singleton")
      await denied('MAIN default rejects read even with its matching issuer', () => read(2, application, null, { iss: mainIssuer }))
      await denied('MAIN default rejects save even with its matching issuer', () => save(2, body(application, 2), key(), { iss: mainIssuer }))
    })

    phase = 'atomic-audit-and-request-ledger-failure'
    for (const [table, condition, label] of [
      ['bx1_portal.events', "NEW.kind='save_application_draft'", 'mandatory audit'],
      ['bx1_portal.application_draft_requests', 'true', 'mandatory request ledger'],
    ]) await isolated(async () => {
      await db.query(`create function bx1_portal.draft_fixture_failure() returns trigger language plpgsql as $$
        begin if ${condition} then raise exception 'fictional draft atomicity failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger draft_fixture_failure before insert on ${table} for each row execute function bx1_portal.draft_fixture_failure()`)
      await denied(`${label} failure rolls back an existing draft save`, () => save(2, body(application, 2)), '23514')
      await denied(`${label} failure rolls back an initial draft save`, () => save(2, body(manager)), '23514')
    })
    await admin()
    eq(await functions(), installedFunctions, 'all functional probes preserve the exact installed functions and remove fault triggers')
    eq(await security(), installedSecurity, 'all original ACL/RLS/triggers remain active after the negative probes')
    await db.query('rollback'); begun = false
    eq(await rows(), retainedRows, 'complete functional rollback restores every inherited row and retains only the narrow committed race fixture')
    eq(await functions(), installedFunctions, 'functional rollback preserves exact additive installation')
    eq(await security(), installedSecurity, 'functional rollback preserves exact authority and active trigger settings')

    phase = 'two-backend-same-revision-real-wait'
    const raceStart = await unchangedApplications(), raceRows = await rows(), raceBodyA = body(raceApplication, 0, unfinished({ full_name: 'First fictional writer' })),
      raceBodyB = body(raceApplication, 0, unfinished({ full_name: 'Second fictional writer' })), raceKeyA = key(), raceKeyB = key()
    await admin(clients[0]); await admin(clients[1])
    await clients[0].query('begin'); await clients[1].query('begin')
    const raceWindowStart = await clock()
    const winning = await save(1, raceBodyA, raceKeyA, {}, clients[0])
    pendingRace = save(1, raceBodyB, raceKeyB, {}, clients[1]).then(value => ({ value }), error => ({ code: error?.code }))
    await waitForBlocked(pids[2], pids[1])
    // The real shared writer advisory lock, not Promise order or a mocked conflict,
    // makes the second transaction recheck revision after the first commits.
    await clients[0].query('commit'); await admin(clients[0])
    const losing = await pendingRace; pendingRace = null
    eq(losing.code, '40001', 'overlapping same-revision second writer denies after actual winner commit')
    await clients[1].query('rollback'); await admin(clients[1])
    envelope(winning, id(1), raceApplication, 1, raceBodyA, raceKeyA, raceWindowStart, await clock())
    await db.query('begin'); begun = true
    eq(await read(1, raceApplication, raceKeyA), winning, 'winner remains exact and recoverable after committed race')
    envelope(await read(1, raceApplication, raceKeyB), id(1), raceApplication, 1, raceBodyA)
    await admin()
    eq(await scalar('select count(*)::int from bx1_portal.application_drafts where application_id=$1 and draft_revision=1', [raceApplication.id]), 1, 'race commits exactly one current draft revision')
    eq(await scalar('select count(*)::int from bx1_portal.application_draft_requests where actor_id=$1 and application_id=$2', [id(1), raceApplication.id]), 1, 'race commits exactly one input-derived request ledger row')
    eq(await scalar('select count(*)::int from bx1_portal.application_draft_requests where actor_id=$1 and request_key=$2', [id(1), raceKeyB]), 0, 'stale racer commits no request ledger row')
    const audit = (await db.query("select subject_id,application_id,actor_id,kind,summary from bx1_portal.events where application_id=$1 and kind='save_application_draft'", [raceApplication.id])).rows
    eq(audit.length, 1, 'race winner emits exactly one mandatory draft audit')
    eq([audit[0].subject_id, audit[0].application_id, audit[0].actor_id, audit[0].kind],
      [raceApplication.id, raceApplication.id, id(1), 'save_application_draft'], 'race audit binds exact original application/actor/action')
    truth(!JSON.stringify(audit).includes(raceBodyA.answers.full_name) && !JSON.stringify(audit).includes(raceBodyB.answers.full_name), 'draft audit does not leak private answers')
    eq(await unchangedApplications(), raceStart, 'both committed winner and stale loser leave all applications and submission history exact')
    const afterRace = await rows()
    for (const [name, fingerprint] of Object.entries(raceRows)) if (!['bx1_portal.application_drafts','bx1_portal.application_draft_requests','bx1_portal.events'].includes(name))
      eq(afterRace[name], fingerprint, `race changes no inherited ${name} row`)
    const inheritedAfter = await unchangedApplications()
    for (const name of ['applications','history','admission']) for (const original of inheritedApplicationRows[name])
      truth(inheritedAfter[name].some(value => JSON.stringify(value) === JSON.stringify(original)), `every pre-proof ${name} row remains exact`)
    eq(await functions(), installedFunctions, 'race and recovery preserve all old and new function definitions')
    eq(await security(), installedSecurity, 'race and recovery preserve every native ACL/RLS/trigger')
    await db.query('rollback'); begun = false
    await Promise.all(clients.map(async client => { await client.query('rollback'); await admin(client) }))
    console.log(`BX1_APPLICATION_DRAFTS_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 unfinishedAnswers=lossless saveResume=exact keyRecovery=current-only idempotency=exact changedBody=denied staleBaseAndDraft=denied foreignActorAndContext=denied editableStates=guarded main=closed rawAccess=denied applicationsAndSubmissionHistory=unchanged auditRollback=proven requestLedgerRollback=proven concurrency=real-two-backend-one-winner-stale-loser cleanup=parent-disposable-schema-cleanup hostedAcceptance=not-proven authGetUser=not-proven documentBytes=not-proven scannerAcceptance=not-proven providerAcceptance=not-proven`)
    return checks
  } catch (error) {
    error.applicationDraftsPhase = phase
    const code = typeof error?.code === 'string' && /^[0-9A-Z_]{1,20}$/.test(error.code) ? error.code : 'assertion'
    console.error(`BX1_APPLICATION_DRAFTS_FAILED phase=${phase} code=${code}`)
    throw error
  } finally {
    // Release writer locks BEFORE awaiting any outstanding racer, so failures
    // in the observer cannot strand a connection or an unhandled rejection.
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
    if (pendingRace) await pendingRace
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
  }
}
