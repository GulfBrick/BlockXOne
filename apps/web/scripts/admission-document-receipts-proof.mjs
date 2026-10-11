import assert from 'node:assert/strict'

// Called only after the unchanged normal-admission and representative proofs.
// This models trusted-server input and Storage metadata in disposable cloud SQL,
// NOT getUser verification, physical bytes, completed MFA, provider clearance or
// independent people. Mounted route/helper tests cover the token transport.
export async function proveAdmissionDocumentReceipts(db, clients, featureSql) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.argv.length !== 2
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Admission receipt proof requires exact disposable cloud fixture')
  assert.equal(clients.length, 2, 'two existing independent cloud backends required')
  let checks = 0, begun = false, committedWaitFixture = false, phase = 'baseline', sequence = 1000
  let primaryFailure
  const id = n => `ef840000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const inheritedId = n => `ef830000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const key = () => id(++sequence)
  const native8 = 'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)'
  const explicit9 = 'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text,jsonb)'
  const admissionHelper = 'bx1_private.admission_receipt_session(uuid,uuid,jsonb)'
  const issuer = 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const clone = value => JSON.parse(JSON.stringify(value))
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = [], client = db) => Object.values((await client.query(sql, values)).rows[0])[0]
  const dbClock = () => scalar("select to_jsonb(clock_timestamp()) #>> '{}'")
  const admin = (client = db) => client.query('reset role')
  const attestation = (actor, session, extra = {}) => ({ iss: issuer, sub: actor, session_id: session,
    role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: false,
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 1 }], ...extra })
  const document = (actor, n, kind = 'IDENTITY') => ({ id: id(n), kind,
    title: `Fictional receipt metadata ${kind} ${n}`, storage_path: `${actor}/${id(n)}`,
    sha256: 'd'.repeat(64), size: 100, mime_type: 'application/pdf' })
  const waitActor = inheritedId(1), waitSession = inheritedId(101)
  const waitDoc = document(waitActor, 990), waitObjectId = id(991)
  const seedObjects = [], receiptIntents = [], entryIntents = [], externalRestores = []
  let baselineRows, baselineFunctions, baselineSecurity, baselineRelations, waitFixtureRows, proofStart, proofEnd, selectedLifecycleAt
  let waitSessionOriginal, waitEventId
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      md5(pg_get_functiondef(p.oid)) body,p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('auth','storage','public','bx1_private','bx1_portal') and p.prokind='f' order by p.oid`)).rows
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
  const rows = async (specs = baselineRelations) => {
    await admin()
    const result = {}
    for (const spec of specs) {
      for (const name of [spec.nspname, spec.relname, ...spec.columns]) assert.match(name, /^[a-z0-9_]+$/)
      result[`${spec.nspname}.${spec.relname}`] = await scalar(`select coalesce(jsonb_agg(to_jsonb(t)
        order by to_jsonb(t)::text),'[]'::jsonb) from ${spec.nspname}.${spec.relname} t`)
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
  const inheritedExact = (before, current, label) => {
    const added = {}
    for (const spec of baselineRelations) {
      const name = `${spec.nspname}.${spec.relname}`
      const identity = row => spec.primary_key.length ? JSON.stringify(spec.primary_key.map(field => row[field])) : JSON.stringify(row)
      const original = new Map(before[name].map(row => [identity(row), row]))
      const now = new Map(current[name].map(row => [identity(row), row]))
      eq(original.size, before[name].length, `${label}: ${name} inherited identities are unique`)
      eq(now.size, current[name].length, `${label}: ${name} current identities are unique`)
      for (const [value, row] of original) eq(now.get(value), row, `${label}: every inherited ${name} row remains exact`)
      added[name] = [...now].filter(([value]) => !original.has(value)).map(([, row]) => row)
    }
    return added
  }
  const exactKeys = (value, names, label) => eq(Object.keys(value).sort(), [...names].sort(), `${label}: exact fields`)
  const uuid = (value, label) => { truth(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value), label) }
  const inWindow = (value, start = proofStart, end = proofEnd) => {
    truth(typeof value === 'string' && /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value), 'receipt timestamp has explicit offset')
    const parsed = Date.parse(value)
    truth(Number.isFinite(parsed) && parsed >= Date.parse(start) && parsed <= Date.parse(end), 'receipt timestamp is inside database observation window')
  }
  const receiptResult = (value, actor, doc) => eq(value, { ...doc, actor_id: actor,
    validation_state: 'SYNTHETIC_UNSCANNED' }, 'writer returns only the exact owner/hash/metadata synthetic receipt')
  const receipt = async (actor, session, doc, a = undefined) => {
    await admin()
    // The server writer has no browser JWT context. The explicit argument is
    // the only admission provenance transport; SQL must not manufacture one.
    await db.query("select set_config('request.jwt.claims','{}',true)")
    await db.query('set local role bx1_document_receipt_writer')
    const values = [actor, session, doc.id, doc.kind, doc.title, doc.sha256, doc.size, doc.mime_type]
    const value = await scalar(`select bx1_private.register_document_receipt($1::uuid,$2::uuid,$3::uuid,
      $4::text,$5::text,$6::text,$7::integer,$8::text${a === undefined ? '' : ',$9::jsonb'})`,
    a === undefined ? values : [...values, a === null ? null : JSON.stringify(a)])
    eq(await scalar("select current_setting('request.jwt.claims',true)"), '{}', 'private receipt transition does not manufacture caller JWT claims')
    await admin()
    return value
  }
  const object = async (actor, doc, objectId) => {
    await admin()
    await db.query(`insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata)
      values($1,'bx1-portal-documents',$2,$3,$4::jsonb,$5::jsonb)`,
    [objectId, doc.storage_path, actor, JSON.stringify({ size: doc.size, mimetype: doc.mime_type }), JSON.stringify({ sha256: doc.sha256 })])
    seedObjects.push({ id: objectId, bucket_id: 'bx1-portal-documents', name: doc.storage_path, owner_id: actor,
      metadata: { size: doc.size, mimetype: doc.mime_type }, user_metadata: { sha256: doc.sha256 } })
  }
  const denied = async (label, run, expected = '42501') => {
    await admin(); const before = await rows(); await db.query('savepoint receipt_denial')
    let code
    try { await run() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint receipt_denial; release savepoint receipt_denial'); await admin()
    truth((Array.isArray(expected) ? expected : [expected]).includes(code), `${label}: SQLSTATE=${code ?? 'none'}`)
    eq(await rows(), before, `${label}: failed operation changes no business, authority or receipt row`)
  }
  const isolated = async run => {
    await admin(); await db.query('savepoint receipt_isolation')
    try { await run() }
    finally { await db.query('rollback to savepoint receipt_isolation; release savepoint receipt_isolation'); await admin() }
  }
  const entry = async (n, action, payload, requestKey = key(), capture = false) => {
    const intent = clone({ actor_id: id(n), request_key: requestKey, command: action, payload })
    await admin()
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(attestation(id(n), id(100 + n)))])
    await db.query('set local role authenticated')
    const value = await scalar('select public.bx1_entry_command($1,$2,$3::jsonb)', [action, requestKey, JSON.stringify(payload)])
    if (capture) entryIntents.push(intent)
    return value
  }
  const lifecycle = async mode => {
    await admin()
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [mode])
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    // A same-mode guarded UPDATE now records the real policy transition time;
    // it cannot bypass a scanner downgrade. Every RPC sees the guard enabled.
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton', [mode])
    eq(await scalar(`select tgenabled::text from pg_trigger where tgrelid='bx1_private.document_lifecycle_policy'::regclass
      and tgname='bx1_document_lifecycle_activation'`), 'O', 'native lifecycle guard enabled before every receipt/business observation')
    return scalar('select to_jsonb(changed_at) from bx1_private.document_lifecycle_policy where singleton')
  }
  const observeWait = async (waiter, blocker) => {
    truth(waiter !== blocker, 'receipt waiter and blocker have distinct actual backend PIDs')
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await scalar(`select exists(select 1 from pg_stat_activity where pid=$1
        and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))`, [waiter, blocker], clients[1])) { checks++; return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Admission receipt proof did not observe required independent-backend lock wait')
  }
  const restoreSession = async (actor, session, original) => {
    const client = clients[0]
    await client.query('rollback'); await admin(client)
    await client.query('update auth.sessions set not_after=$3::timestamptz where id=$1 and user_id=$2', [session, actor, original.not_after])
    eq(await scalar('select to_jsonb(s) from auth.sessions s where id=$1 and user_id=$2', [session, actor], client), original,
      'every inherited session field restored exactly after real wait')
  }
  const cleanupWaitFixture = async () => {
    await admin(); await db.query('begin'); begun = true
    try {
      // Cleanup-only owner suspension occurs AFTER all business observations and
      // rollback. It is never a runtime bypass or a namespace deletion waiver.
      eq(await scalar('select count(*)::int from bx1_private.document_application_bindings where receipt_id=$1', [waitDoc.id]), 0,
        'dedicated wait fixture has no application binding to remove')
      await db.query('alter table bx1_private.document_receipt_events disable trigger bx1_document_event_immutable')
      await db.query('alter table bx1_private.document_upload_receipts disable trigger bx1_document_receipt_immutable')
      await db.query('alter table storage.objects disable trigger bx1_portal_stored_document_guard')
      eq((await db.query(`delete from bx1_private.document_receipt_events where id=$1 and receipt_id=$2
        and kind='REGISTERED' and application_id is null and application_revision is null`, [waitEventId, waitDoc.id])).rowCount, 1,
      'cleanup removes only the exact setup REGISTERED event')
      eq((await db.query('delete from bx1_private.document_upload_receipts where id=$1 and actor_id=$2 and session_id=$3',
        [waitDoc.id, waitActor, waitSession])).rowCount, 1, 'cleanup removes only the exact setup receipt')
      eq((await db.query("delete from storage.objects where id=$1 and bucket_id='bx1-portal-documents' and name=$2 and owner_id=$3",
        [waitObjectId, waitDoc.storage_path, waitActor])).rowCount, 1, 'cleanup removes only the exact setup metadata object')
      await db.query('alter table bx1_private.document_receipt_events enable trigger bx1_document_event_immutable')
      await db.query('alter table bx1_private.document_upload_receipts enable trigger bx1_document_receipt_immutable')
      await db.query('alter table storage.objects enable trigger bx1_portal_stored_document_guard')
      eq(await rows(), baselineRows, 'precise setup cleanup restores every original business and authority row')
      eq(await functions(), baselineFunctions, 'full rollback restores every original function definition/OID/owner/ACL')
      eq(await security(), baselineSecurity, 'all original roles/edges/table ACL/RLS/policies/triggers are restored')
      await db.query('commit'); begun = false; committedWaitFixture = false
    } finally {
      let rollbackFailure
      if (begun) {
        try { await db.query('rollback') } catch (error) { rollbackFailure = error }
        begun = false
      }
      await admin()
      // Mandatory even after a mid-delete failure. Rollback is not accepted as
      // restoration evidence without this exact guard/ACL/RLS assertion.
      eq(await security(), baselineSecurity, 'cleanup finally restores every exact original guard/security setting')
      if (rollbackFailure) throw rollbackFailure
    }
  }
  try {
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable cloud owner')
    const version = Number(await scalar('show server_version_num'))
    truth(version >= 170000 && version < 180000, 'existing disposable PostgreSQL17 fixture')
    baselineRelations = await relations(); baselineRows = await rows(); baselineFunctions = await functions(); baselineSecurity = await security()
    truth(baselineFunctions.some(f => f.signature === 'bx1_portal.admission_password_session()'), 'unchanged parent admission feature remains installed')
    truth(baselineFunctions.some(f => f.signature === 'public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb)'), 'unchanged representative feature remains installed')
    eq(baselineFunctions.some(f => f.signature === explicit9 || f.signature === admissionHelper), false, 'new receipt signatures are not preinstalled')
    eq(baselineRows['bx1_private.document_lifecycle_policy'][0].mode, 'SCANNER_REQUIRED', 'inherited scanner lifecycle is retained as baseline')
    eq(baselineRows['bx1_private.document_receipt_policy'][0].enforced, true, 'inherited scanner-required lifecycle has enforced receipt policy')
    const allGuardState = baselineSecurity.triggers.filter(t => ['bx1_document_lifecycle_activation',
      'bx1_portal_stored_document_guard', 'bx1_document_receipt_immutable', 'bx1_document_event_immutable'].includes(t.tgname))
    eq(allGuardState.length, 4, 'all four exact setup/cleanup guards exist')
    truth(allGuardState.every(t => t.tgenabled === 'O'), 'all setup/cleanup guards start enabled')
    waitSessionOriginal = await scalar('select to_jsonb(s) from auth.sessions s where id=$1 and user_id=$2', [waitSession, waitActor])
    eq(waitSessionOriginal?.aal, 'aal1', 'existing committed wait actor already has AAL1; no session promotion')
    eq(await scalar("select count(*)::int from auth.mfa_factors where user_id=$1 and status::text='verified'", [waitActor]), 0,
      'original native8 setup actor legitimately has no enrolled factor')

    phase = 'exact-committed-metadata-wait-fixture'
    await db.query('begin'); begun = true
    const setupStart = await dbClock()
    await lifecycle('SYNTHETIC_TEST_ONLY')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await object(waitActor, waitDoc, waitObjectId)
    receiptResult(await receipt(waitActor, waitSession, waitDoc), waitActor, waitDoc)
    // Restore exact inherited policy, including its original timestamp, before
    // committing only the three required cross-backend observation targets.
    await admin()
    await db.query('update bx1_private.document_lifecycle_policy set mode=$1 where singleton',
      [baselineRows['bx1_private.document_lifecycle_policy'][0].mode])
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_lifecycle_policy set changed_at=$1::timestamptz where singleton',
      [baselineRows['bx1_private.document_lifecycle_policy'][0].changed_at])
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    await db.query('update bx1_private.document_receipt_policy set enforced=$1,changed_at=$2::timestamptz where singleton',
      [baselineRows['bx1_private.document_receipt_policy'][0].enforced, baselineRows['bx1_private.document_receipt_policy'][0].changed_at])
    waitFixtureRows = await rows()
    const setupAdded = inheritedExact(baselineRows, waitFixtureRows, 'dedicated wait setup')
    for (const [name, values] of Object.entries(setupAdded)) if (!['storage.objects',
      'bx1_private.document_upload_receipts', 'bx1_private.document_receipt_events'].includes(name)) eq(values, [], `setup adds no ${name} rows`)
    eq(setupAdded['storage.objects'], [seedObjects[0]], 'setup commits exactly the input-derived metadata object')
    eq(setupAdded['bx1_private.document_upload_receipts'].length, 1, 'setup commits exactly one native receipt')
    const setupReceipt = setupAdded['bx1_private.document_upload_receipts'][0]
    eq({ ...setupReceipt, verified_at: undefined }, { id: waitDoc.id, actor_id: waitActor, session_id: waitSession,
      storage_path: waitDoc.storage_path, kind: waitDoc.kind, title: waitDoc.title, sha256: waitDoc.sha256,
      byte_size: waitDoc.size, mime_type: waitDoc.mime_type, validation_state: 'SYNTHETIC_UNSCANNED', verified_at: undefined },
    'setup receipt fields match original8 input, not an observed-row waiver')
    inWindow(setupReceipt.verified_at, setupStart, await dbClock())
    eq(setupAdded['bx1_private.document_receipt_events'].length, 1, 'setup commits exactly one REGISTERED event')
    const setupEvent = setupAdded['bx1_private.document_receipt_events'][0]; waitEventId = setupEvent.id
    truth(Number.isSafeInteger(waitEventId) && waitEventId > 0, 'setup event has generated positive identity')
    eq({ ...setupEvent, id: undefined, created_at: undefined }, { id: undefined, receipt_id: waitDoc.id,
      application_id: null, application_revision: null, kind: 'REGISTERED', created_at: undefined }, 'setup event is the exact native receipt registration')
    inWindow(setupEvent.created_at, setupStart, await dbClock())
    eq(await functions(), baselineFunctions, 'setup alters no installed function')
    eq(await security(), baselineSecurity, 'setup restores all policy/trigger/security metadata before commit')
    await db.query('commit'); begun = false; committedWaitFixture = true

    phase = 'additive-install-and-native-boundary'
    proofStart = await dbClock()
    await db.query('begin'); begun = true
    await db.query(featureSql)
    const installed = await functions()
    for (const prior of baselineFunctions) {
      const current = installed.find(f => f.oid === prior.oid)
      truth(current, `${prior.signature}: original OID retained`)
      eq(prior.signature === native8 ? { ...current, body: prior.body } : current, prior,
        `${prior.signature}: only native8 body changes; all metadata and all other bodies remain exact`)
    }
    eq(installed.filter(f => !baselineFunctions.some(prior => prior.oid === f.oid)).map(f => f.signature).sort(),
      [admissionHelper, explicit9].sort(), 'feature adds only the two frozen private signatures')
    eq(await rows(), waitFixtureRows, 'additive feature changes no inherited business/authority/configuration row')
    eq(await security(), baselineSecurity, 'feature creates no role/table/RLS/policy/trigger grants')
    for (const signature of [admissionHelper, explicit9]) {
      const f = installed.find(value => value.signature === signature)
      eq([f.owner, f.prosecdef, f.proconfig], [String(await scalar("select 'postgres'::regrole::oid")), true, ['search_path=""']],
        `${signature}: original owner and empty search_path boundary`)
      for (const r of ['anon', 'authenticated', 'service_role', 'bx1_document_scanner_writer'])
        eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [r, signature]), false, `${r} cannot invoke ${signature}`)
    }
    eq(await scalar("select has_function_privilege('bx1_document_receipt_writer',$1,'EXECUTE')", [explicit9]), true,
      'only existing restricted receipt writer gains explicit9 execution')
    eq(await scalar("select has_function_privilege('bx1_document_receipt_writer',$1,'EXECUTE')", [admissionHelper]), false,
      'receipt writer cannot invoke internal admission classifier directly')
    for (const table of ['auth.users', 'auth.sessions', 'auth.mfa_factors', 'bx1_private.document_upload_receipts',
      'bx1_private.document_receipt_events', 'bx1_private.person_principals', 'storage.objects'])
      eq(await scalar("select has_table_privilege('bx1_document_receipt_writer',$1,'SELECT,INSERT,UPDATE,DELETE')", [table]), false,
        `receipt writer gains no direct access to ${table}`)
    selectedLifecycleAt = await lifecycle('SYNTHETIC_TEST_ONLY')
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')

    phase = 'actual-auth-storage-and-receipt-waits'
    const session4 = inheritedId(104), actor4 = inheritedId(4)
    const session4Original = await scalar('select to_jsonb(s) from auth.sessions s where id=$1 and user_id=$2', [session4, actor4])
    eq(session4Original?.aal, 'aal1', 'committed enrolled revocation target remains AAL1')
    externalRestores.push(() => restoreSession(actor4, session4, session4Original),
      () => restoreSession(waitActor, waitSession, waitSessionOriginal))
    const blocker = clients[0], observer = clients[1]
    await admin(blocker); await admin(observer)
    const writerPid = await scalar('select pg_backend_pid()'), blockerPid = await scalar('select pg_backend_pid()', [], blocker)
    for (const lock of ['session', 'storage', 'receipt']) {
      const actor = lock === 'session' ? actor4 : waitActor
      const session = lock === 'session' ? session4 : waitSession
      const original = lock === 'session' ? session4Original : waitSessionOriginal
      await admin(blocker)
      if (lock !== 'session') await blocker.query("update auth.sessions set not_after=clock_timestamp()+interval '5 seconds' where id=$1 and user_id=$2", [session, actor])
      const beforeWait = await rows()
      await db.query('savepoint receipt_real_wait')
      await blocker.query('begin')
      await blocker.query(lock === 'session' ? 'select id from auth.sessions where id=$1 for update'
        : lock === 'storage' ? 'select id from storage.objects where id=$1 for update'
          : 'select id from bx1_private.document_upload_receipts where id=$1 for update',
      [lock === 'session' ? session : lock === 'storage' ? waitObjectId : waitDoc.id])
      const doc = lock === 'session' ? document(actor, 992) : waitDoc
      const pending = receipt(actor, session, doc, attestation(actor, session))
        .then(() => ({ code: null }), error => ({ code: error?.code }))
      try {
        await observeWait(writerPid, blockerPid)
        if (lock === 'session') await blocker.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1 and user_id=$2", [session, actor])
        else {
          const deadline = Date.now() + 10000
          let expired = false
          while (Date.now() < deadline) {
            expired = await scalar('select not_after<=clock_timestamp() from auth.sessions where id=$1 and user_id=$2', [session, actor], observer)
            if (expired) break
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          truth(expired, `${lock}: actual database clock expires session while receipt writer is blocked`)
        }
      } finally { await blocker.query('commit') }
      const outcome = await pending
      await db.query('rollback to savepoint receipt_real_wait; release savepoint receipt_real_wait'); await admin()
      eq(outcome.code, '42501', `${lock}: authority rechecked after real wait; no receipt succeeds after expiry/revocation`)
      await restoreSession(actor, session, original)
      const restoredWaitRows = await rows()
      // The temporary external session value is explicitly replaced by its
      // inherited input here; no receipt/event/table mutation is exempted.
      const expected = clone(beforeWait)
      const index = expected['auth.sessions'].findIndex(value => value.id === session)
      truth(index >= 0, 'exact changed external session exists in pre-wait snapshot')
      expected['auth.sessions'][index] = original
      expected['auth.sessions'].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      const actual = clone(restoredWaitRows)
      actual['auth.sessions'].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      eq(actual, expected, `${lock}: only exact external session restored; all receipt/event/business rows unchanged`)
    }
    const afterWaits = await rows(), expectedAfterWaits = clone(waitFixtureRows)
    expectedAfterWaits['bx1_private.document_lifecycle_policy'] = [{ ...baselineRows['bx1_private.document_lifecycle_policy'][0], mode: 'SYNTHETIC_TEST_ONLY', changed_at: selectedLifecycleAt }]
    expectedAfterWaits['bx1_private.document_receipt_policy'] = [{ ...baselineRows['bx1_private.document_receipt_policy'][0], enforced: true }]
    expectedAfterWaits['bx1_portal.entry_configuration'] = [{ ...baselineRows['bx1_portal.entry_configuration'][0], test_ordinary_entry_enabled: true }]
    eq(afterWaits, expectedAfterWaits, 'actual waits leave every inherited row exact, except the three exact selected policy values')
    externalRestores.length = 0

    phase = 'enrolled-aal1-and-native-preservation'
    for (const n of [1, 2, 3, 4]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)',
        [id(n), `admission-receipt-${n}@example.invalid`])
      if ([1, 3].includes(n)) await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(200 + n), id(n)])
      await db.query(`insert into auth.sessions(id,user_id,not_after,created_at,aal,factor_id)
        values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),$3,$4)`,
      [id(100 + n), id(n), n === 3 ? 'aal2' : 'aal1', n === 3 ? id(203) : null])
      if (n === 1) await db.query('insert into public.bx1_profiles(id,platform_user_id,display_name,created_at) values($1,$2,$3,clock_timestamp())',
        [id(n), id(801), 'Fictional enrolled receipt applicant'])
    }
    const authorityBefore = await rows(baselineRelations.filter(spec => spec.nspname === 'auth'
      || spec.nspname === 'public' || spec.nspname === 'bx1_private' && ['persons', 'person_principals'].includes(spec.relname)))
    const docs = [document(id(1), 301), document(id(2), 302), document(id(3), 303),
      document(id(1), 304, 'COMPANY'), document(id(1), 305, 'BENEFICIAL_OWNERS')]
    for (const [index, doc] of docs.entries()) await object(doc.storage_path.split('/')[0], doc, id(600 + index))
    await denied('enrolled AAL1 still fails original8 native assurance', () => receipt(id(1), id(101), docs[0]))
    for (const [actor, session, doc, a] of [[id(2), id(102), docs[1], undefined], [id(3), id(103), docs[2], undefined],
      [id(1), id(101), docs[0], attestation(id(1), id(101))], [id(1), id(101), docs[3], attestation(id(1), id(101))],
      [id(1), id(101), docs[4], attestation(id(1), id(101))]]) {
      receiptIntents.push(clone({ actor, session, doc }))
      receiptResult(await receipt(actor, session, doc, a), actor, doc)
    }
    await denied('AAL1 attestation cannot use a stored AAL2 session',
      () => receipt(id(3), id(103), docs[2], attestation(id(3), id(103))))
    await isolated(async () => {
      await db.query('update auth.sessions set factor_id=$1 where id=$2', [id(201), id(103)])
      await denied('native AAL2 still requires its own verified factor', () => receipt(id(3), id(103), docs[2]))
    })
    const afterRegistration = await rows()
    receiptResult(await receipt(id(1), id(101), docs[0], attestation(id(1), id(101))), id(1), docs[0])
    eq(await rows(), afterRegistration, 'exact enrolled upload retry adds no duplicate receipt or REGISTERED event')
    eq(await rows(baselineRelations.filter(spec => spec.nspname === 'auth'
      || spec.nspname === 'public' || spec.nspname === 'bx1_private' && ['persons', 'person_principals'].includes(spec.relname))),
    authorityBefore, 'receipt registration/retry preserves all factors, stored AAL, profiles, memberships and principals')

    phase = 'strict-attestation-current-authority-and-policy-denials'
    const valid = attestation(id(1), id(101))
    const invalid = [
      ['MAIN issuer', { ...valid, iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }],
      ['wrong actor', { ...valid, sub: id(4) }], ['wrong session', { ...valid, session_id: id(104) }],
      ['untrusted role', { ...valid, role: 'service_role' }], ['AAL promotion', { ...valid, aal: 'aal2' }],
      ['anonymous', { ...valid, is_anonymous: true }], ['anonymous string', { ...valid, is_anonymous: 'false' }],
      ['expired token', { ...valid, exp: Math.floor(Date.now() / 1000) - 1 }], ['expiry string', { ...valid, exp: String(valid.exp) }],
      ['fractional expiry', { ...valid, exp: valid.exp + 0.5 }], ['missing expiry', Object.fromEntries(Object.entries(valid).filter(([field]) => field !== 'exp'))],
      ['extra metadata', { ...valid, user_metadata: { aal: 'aal2', organisation_id: scope } }],
      ['caller tenant override', { ...valid, organisation_id: inheritedId(950) }],
      ['empty AMR', { ...valid, amr: [] }], ['OAuth AMR', { ...valid, amr: [{ method: 'oauth', timestamp: valid.exp - 3600 }] }],
      ['MFA AMR', { ...valid, amr: [...valid.amr, { method: 'totp', timestamp: valid.exp - 3600 }] }],
      ['future AMR', { ...valid, amr: [{ method: 'password', timestamp: valid.exp }] }],
      ['AMR timestamp string', { ...valid, amr: [{ method: 'password', timestamp: String(valid.amr[0].timestamp) }] }],
      ['extra AMR authority', { ...valid, amr: [{ ...valid.amr[0], role: 'SuperAdmin' }] }],
      ['array attestation', []], ['null native delegate for enrolled AAL1', null],
    ]
    for (const [label, a] of invalid) await denied(label, () => receipt(id(1), id(101), docs[0], a))
    await denied('attestation does not change supplied actor', () => receipt(id(4), id(101), docs[0], valid))
    await denied('attestation does not change supplied session', () => receipt(id(1), id(104), docs[0], valid))
    const policyCases = [
      ['password pause closed', 'update bx1_portal.entry_configuration set test_ordinary_entry_enabled=false where singleton', []],
      ['manual policy closed', 'update bx1_portal.entry_configuration set manual_test_review=false where singleton', []],
      ['MAIN configuration', "update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false,test_ordinary_entry_enabled=false where singleton", []],
      ['receipt policy disabled', 'update bx1_private.document_receipt_policy set enforced=false where singleton', []],
      ['reviewer tenant inactive', "update public.bx1_organisations set status='SUSPENDED' where id=$1", [scope]],
      ['email unconfirmed', 'update auth.users set email_confirmed_at=null where id=$1', [id(1)]],
      ['user banned/recovery denied', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [id(1)]],
      ['user deleted', 'update auth.users set deleted_at=clock_timestamp() where id=$1', [id(1)]],
      ['anonymous stored user', 'update auth.users set is_anonymous=true where id=$1', [id(1)]],
      ['profile recovery/suspended', "update public.bx1_profiles set status='SUSPENDED' where id=$1", [id(1)]],
      ['session expired', "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(101)]],
      ['session revoked', 'delete from auth.sessions where id=$1', [id(101)]],
      ['OAuth stored session', 'update auth.sessions set oauth_client_id=$1 where id=$2', [id(900), id(101)]],
    ]
    for (const [label, sql, values] of policyCases) await isolated(async () => {
      await db.query(sql, values); await denied(label, () => receipt(id(1), id(101), docs[0], valid))
    })
    await isolated(async () => {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional revoked receipt identity','TRUSTED','fictional:receipt-negative',$2)", [id(700), id(701)])
      await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'REVOKED','fictional:receipt-negative',$3)", [id(1), id(700), id(702)])
      await denied('revoked known principal cannot use admission receipt', () => receipt(id(1), id(101), docs[0], valid))
    })
    await isolated(async () => {
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,'Fictional revoked receipt person','REVOKED','fictional:receipt-person-negative',$2)", [id(700), id(701)])
      await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:receipt-person-negative',$3)", [id(1), id(700), id(702)])
      await denied('revoked/recovery known person cannot use admission receipt', () => receipt(id(1), id(101), docs[0], valid))
    })
    await isolated(async () => {
      await db.query("update bx1_private.document_lifecycle_policy set mode='SCANNER_REQUIRED' where singleton")
      await denied('new admission attestation cannot bypass scanner-required lifecycle', () => receipt(id(1), id(101), docs[0], valid))
      await denied('new admission exception is not reused for native quarantine registration', async () => {
        await admin(); await db.query('set local role bx1_document_receipt_writer')
        await scalar('select bx1_private.register_quarantined_document($1,$2,$3,$4,$5,$6,$7,$8)',
          [id(1), id(101), id(399), docs[0].kind, docs[0].title, docs[0].sha256, docs[0].size, docs[0].mime_type])
      })
    })
    await denied('receipt writer cannot call internal provenance classifier', async () => {
      await db.query('set local role bx1_document_receipt_writer')
      await scalar('select bx1_private.admission_receipt_session($1,$2,$3::jsonb)', [id(1), id(101), JSON.stringify(valid)])
    })
    await denied('browser cannot invoke explicit private writer', async () => {
      await db.query('set local role authenticated')
      await scalar('select bx1_private.register_document_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
        [id(1), id(101), docs[0].id, docs[0].kind, docs[0].title, docs[0].sha256, docs[0].size, docs[0].mime_type, JSON.stringify(valid)])
    })

    phase = 'exact-storage-and-atomic-receipt-audit'
    for (const [label, changed, code] of [
      ['wrong stored object identity', { id: id(999), storage_path: `${id(1)}/${id(999)}` }, '23514'],
      ['stored hash mismatch', { sha256: 'e'.repeat(64) }, '23514'],
      ['stored size mismatch', { size: 101 }, '23514'],
      ['stored MIME mismatch', { mime_type: 'image/png' }, '23514'],
      ['immutable title conflict', { title: 'Conflicting fictional receipt title' }, '23514'],
      ['invalid digest', { sha256: 'not-a-sha256' }, '22023'],
      ['invalid size', { size: 0 }, '22023'],
      ['invalid kind', { kind: 'PROVIDER_CLEARANCE' }, '22023'],
      ['missing title', { title: null }, '22023'],
    ]) await denied(label, () => receipt(id(1), id(101), { ...docs[0], ...changed }, valid), code)
    await isolated(async () => {
      const foreignDoc = document(id(4), 398)
      await object(id(4), foreignDoc, id(698))
      await denied('owner prefix possession cannot register another owner object',
        () => receipt(id(1), id(101), foreignDoc, valid), '23514')
    })
    await isolated(async () => {
      const auditDoc = document(id(1), 397)
      await object(id(1), auditDoc, id(697))
      await db.query(`create function bx1_private.admission_receipt_fixture_audit_failure() returns trigger language plpgsql as $$
        begin if NEW.receipt_id='${auditDoc.id}'::uuid then raise exception 'fictional receipt audit failure' using errcode='23514';
        end if; return NEW; end $$;
        create trigger admission_receipt_fixture_audit_failure before insert on bx1_private.document_receipt_events
        for each row execute function bx1_private.admission_receipt_fixture_audit_failure()`)
      await denied('required REGISTERED audit failure rolls back sole receipt transition',
        () => receipt(id(1), id(101), auditDoc, valid), '23514')
      eq(await scalar('select count(*)::int from bx1_private.document_upload_receipts where id=$1', [auditDoc.id]), 0,
        'failed receipt audit cannot leave an unjournalled receipt')
    })

    phase = 'normal-entry-exact-submission-binding'
    const startBody = { persona: 'INVESTOR' }, startKey = key()
    const investor = (await entry(1, 'start_application', startBody, startKey, true)).applications.find(a => a.persona === 'INVESTOR')
    truth(investor?.id, 'enrolled AAL1 actor starts arbitrary normal application through unchanged entry RPC')
    await denied('normal receipt actor cannot bind a capacity in another existing active tenant',
      () => entry(1, 'start_application', { persona: 'INVESTOR', context_key: inheritedId(950) }))
    const investorDetails = { full_name: 'Fictional enrolled receipt applicant', country: 'ZA', investor_type: 'INDIVIDUAL',
      company_name: '', registration_reference: '', beneficial_owners: '',
      source_of_funds: 'Fictional savings; no real money or customer information.',
      experience: 'Fictional experience for disposable normal admission proof.', documents: [docs[0]], test_data_acknowledged: true }
    const submitBody = { application_id: investor.id, expected_revision: investor.revision, details: investorDetails }
    const submitKey = key()
    await denied('wrong application actor cannot bind exact owned receipt', () => entry(4, 'submit_application', submitBody))
    await denied('stale application revision cannot bind receipt', () => entry(1, 'submit_application', { ...submitBody, expected_revision: investor.revision + 1 }), '23514')
    await denied('altered submitted receipt hash denied', () => entry(1, 'submit_application', {
      ...submitBody, details: { ...investorDetails, documents: [{ ...docs[0], sha256: 'f'.repeat(64) }] },
    }), '23514')
    await isolated(async () => {
      await db.query(`create function bx1_portal.admission_receipt_fixture_submit_failure() returns trigger language plpgsql as $$
        begin if NEW.application_id='${investor.id}'::uuid and NEW.kind='submit_application' then
        raise exception 'fictional submission audit failure' using errcode='23514'; end if; return NEW; end $$;
        create trigger admission_receipt_fixture_submit_failure before insert on bx1_portal.events
        for each row execute function bx1_portal.admission_receipt_fixture_submit_failure()`)
      await denied('canonical submission audit failure rolls back revision/binding/BOUND/version/request',
        () => entry(1, 'submit_application', submitBody, submitKey), '23514')
    })
    const submitted = (await entry(1, 'submit_application', submitBody, submitKey, true)).applications.find(a => a.id === investor.id)
    eq([submitted.status, submitted.revision, submitted.provider_mode], ['SUBMITTED', investor.revision + 1, 'MANUAL_TEST_REVIEW'],
      'same normal application submits enrolled AAL1 receipt under honest manual TEST policy')
    const beforeReplay = await rows()
    eq((await entry(1, 'submit_application', submitBody, submitKey)).applications.find(a => a.id === investor.id), submitted,
      'exact normal submission retry retains same application and revision')
    eq(await rows(), beforeReplay, 'submission replay creates no second binding/audit/version/request')
    const manager = (await entry(1, 'start_application', { persona: 'WEALTH_MANAGER' }, key(), true)).applications.find(a => a.persona === 'WEALTH_MANAGER')
    truth(manager?.id && manager.id !== investor.id, 'same actor has distinct normal manager application for cross-capacity proof')
    const managerDetails = { full_name: 'Fictional enrolled receipt applicant', country: 'ZA',
      company_name: 'Fictional receipt consistency company', registration_reference: 'FICTIONAL-RECEIPT-001',
      beneficial_owners: 'One fictional controlling owner; no actual customer company evidence.',
      business_activities: 'Fictional investment management for disposable workflow proof.',
      representative_position: 'Fictional authorised director',
      authority_basis: 'Fictional board authority for this application only; no platform or signing authority.',
      documents: [docs[0], docs[3], docs[4]], test_data_acknowledged: true, details_version: 3,
      ownership_change_reason: 'Initial fictional structured ownership for receipt reuse denial.',
      ownership_control: [{ id: id(501), party_type: 'PERSON', legal_name: 'Fictional Controlling Owner',
        registration_reference: '', country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
        control_basis: 'Fictional direct shareholding for disposable receipt binding proof.', effective_on: '2026-09-01',
        change_reason: 'Initial fictional ownership disclosure.', evidence_document_id: docs[4].id }] }
    await admin(); await db.query("select bx1_portal.validate_application($1::jsonb,'WEALTH_MANAGER')", [JSON.stringify(managerDetails)])
    checks++ // Full manager/ownership structure is independently valid FIRST.
    await denied('valid manager application cannot reuse investor-bound identity receipt', () => entry(1, 'submit_application', {
      application_id: manager.id, expected_revision: manager.revision, details: managerDetails,
    }), '23514')

    phase = 'strict-input-derived-footprint-and-full-rollback'
    proofEnd = await dbClock()
    const finalRows = await rows()
    // Policy fixture changes are restored by transaction rollback; they are not
    // a broad business-state waiver. Capture their exact selected values here.
    const selectedPolicyRows = clone(waitFixtureRows)
    inWindow(selectedLifecycleAt)
    selectedPolicyRows['bx1_private.document_lifecycle_policy'] = [{ ...baselineRows['bx1_private.document_lifecycle_policy'][0], mode: 'SYNTHETIC_TEST_ONLY', changed_at: selectedLifecycleAt }]
    selectedPolicyRows['bx1_private.document_receipt_policy'] = [{ ...baselineRows['bx1_private.document_receipt_policy'][0], enforced: true }]
    selectedPolicyRows['bx1_portal.entry_configuration'] = [{ ...baselineRows['bx1_portal.entry_configuration'][0], test_ordinary_entry_enabled: true }]
    const additions = inheritedExact(selectedPolicyRows, finalRows, 'complete successful receipt journey')
    const allowed = new Set(['auth.users', 'auth.sessions', 'auth.mfa_factors', 'public.bx1_profiles', 'storage.objects',
      'bx1_private.document_upload_receipts', 'bx1_private.document_application_bindings', 'bx1_private.document_receipt_events',
      'bx1_portal.applications', 'bx1_portal.entry_requests', 'bx1_portal.application_detail_versions', 'bx1_portal.events'])
    for (const [name, values] of Object.entries(additions)) if (!allowed.has(name)) eq(values, [], `no new out-of-scope ${name} rows`)
    eq(additions['auth.users'].length, 4, 'only four exact fictional users added')
    for (const row of additions['auth.users']) {
      const n = [1, 2, 3, 4].find(value => id(value) === row.id)
      truth(n, 'new Auth row has one exact fixture identity')
      eq({ ...row, email_confirmed_at: undefined }, { id: id(n), email: `admission-receipt-${n}@example.invalid`,
        banned_until: null, deleted_at: null, email_confirmed_at: undefined, is_anonymous: false, raw_user_meta_data: {} },
      'new Auth row has no metadata role, credential or customer intent')
      inWindow(row.email_confirmed_at)
    }
    eq(additions['auth.sessions'].length, 4, 'only four exact fictional sessions added')
    for (const row of additions['auth.sessions']) {
      const n = [1, 2, 3, 4].find(value => id(100 + value) === row.id)
      truth(n, 'new session has exact fixture identity')
      eq({ ...row, not_after: undefined, created_at: undefined }, { id: id(100 + n), user_id: id(n),
        aal: n === 3 ? 'aal2' : 'aal1', factor_id: n === 3 ? id(203) : null, oauth_client_id: null,
        not_after: undefined, created_at: undefined }, 'stored assurance is exact; enrolled actor remains AAL1')
      inWindow(row.created_at)
      truth(Date.parse(row.not_after) >= Date.parse(proofStart) + 3599000 && Date.parse(row.not_after) <= Date.parse(proofEnd) + 3601000,
        'new session expiry is one fixture hour from database observation window')
    }
    eq(additions['auth.mfa_factors'].sort((a, b) => a.id.localeCompare(b.id)), [1, 3].map(n => ({ id: id(200 + n), user_id: id(n), status: 'verified', factor_type: 'totp' })),
      'only separate fictional enrolled/native-AAL2 factors exist; no factor mutation')
    eq(additions['public.bx1_profiles'].length, 1, 'only fictional enrolled applicant has a native profile')
    const profile = additions['public.bx1_profiles'][0]
    eq({ ...profile, created_at: undefined }, { id: id(1), platform_user_id: id(801), display_name: 'Fictional enrolled receipt applicant', status: 'ACTIVE', created_at: undefined },
      'fictional native profile grants no membership')
    inWindow(profile.created_at)
    eq(additions['storage.objects'].sort((a, b) => a.id.localeCompare(b.id)), seedObjects.slice(1, 6).sort((a, b) => a.id.localeCompare(b.id)),
      'only the five exact input-derived successful metadata objects survive isolated negatives')
    eq(additions['bx1_private.document_upload_receipts'].length, receiptIntents.length, 'exactly one receipt per captured successful input')
    for (const intent of receiptIntents) {
      const r = additions['bx1_private.document_upload_receipts'].find(value => value.id === intent.doc.id)
      truth(r, 'captured receipt input has one registered counterpart')
      eq({ ...r, verified_at: undefined }, { id: intent.doc.id, actor_id: intent.actor, session_id: intent.session,
        storage_path: intent.doc.storage_path, kind: intent.doc.kind, title: intent.doc.title, sha256: intent.doc.sha256,
        byte_size: intent.doc.size, mime_type: intent.doc.mime_type, validation_state: 'SYNTHETIC_UNSCANNED', verified_at: undefined },
      'receipt counterpart equals captured input exactly')
      inWindow(r.verified_at)
    }
    eq(additions['bx1_private.document_application_bindings'].length, 1, 'only investor submission binds one receipt')
    const binding = additions['bx1_private.document_application_bindings'][0]
    eq({ ...binding, bound_at: undefined }, { receipt_id: docs[0].id, application_id: investor.id,
      application_revision: submitted.revision, bound_at: undefined }, 'binding equals exact owner submission/application/revision')
    inWindow(binding.bound_at)
    const receiptEvents = additions['bx1_private.document_receipt_events']
    eq(receiptEvents.length, receiptIntents.length + 1, 'five exact registrations and one exact BOUND event; no negative/replay event')
    for (const intent of receiptIntents) {
      const events = receiptEvents.filter(value => value.receipt_id === intent.doc.id && value.kind === 'REGISTERED')
      eq(events.length, 1, 'one exact REGISTERED event per captured input')
      eq({ ...events[0], id: undefined, created_at: undefined }, { id: undefined, receipt_id: intent.doc.id,
        application_id: null, application_revision: null, kind: 'REGISTERED', created_at: undefined }, 'REGISTERED audit has exact fields and no application invention')
    }
    const bound = receiptEvents.find(value => value.kind === 'BOUND')
    eq({ ...bound, id: undefined, created_at: undefined }, { id: undefined, receipt_id: docs[0].id,
      application_id: investor.id, application_revision: submitted.revision, kind: 'BOUND', created_at: undefined }, 'BOUND event equals exact canonical binding')
    for (const event of receiptEvents) {
      truth(Number.isSafeInteger(event.id) && event.id > 0, 'receipt audit has positive generated identity')
      inWindow(event.created_at)
    }
    eq(additions['bx1_portal.entry_requests'].length, entryIntents.length, 'only three captured start/submit entry intents survive')
    for (const intent of entryIntents) {
      const r = additions['bx1_portal.entry_requests'].find(value => value.actor_id === intent.actor_id && value.request_key === intent.request_key)
      truth(r, 'captured entry intent has its exact request counterpart')
      const appId = intent.command === 'submit_application' ? intent.payload.application_id
        : intent.payload.persona === 'INVESTOR' ? investor.id : manager.id
      eq({ ...r, created_at: undefined }, { ...intent, application_id: appId, created_at: undefined }, 'entry request equals captured pre-command input')
      inWindow(r.created_at)
    }
    eq(additions['bx1_portal.application_detail_versions'].length, 1, 'exactly one immutable investor submitted version captured')
    const versionRow = additions['bx1_portal.application_detail_versions'][0]
    eq({ ...versionRow, submitted_at: undefined, captured_at: undefined }, { application_id: investor.id,
      application_revision: submitted.revision, details: investorDetails, capture_kind: 'SUBMISSION', submitted_at: undefined, captured_at: undefined },
    'immutable version equals input details and exact submitted revision')
    inWindow(versionRow.submitted_at); inWindow(versionRow.captured_at)
    eq(additions['bx1_portal.applications'].length, 2, 'only two distinct captured normal applications exist')
    for (const a of additions['bx1_portal.applications']) {
      const isInvestor = a.id === investor.id
      truth(isInvestor || a.id === manager.id, 'application ID comes from exact normal start response')
      eq({ ...a, created_at: undefined, submitted_at: undefined }, {
        id: isInvestor ? investor.id : manager.id, user_id: id(1), persona: isInvestor ? 'INVESTOR' : 'WEALTH_MANAGER',
        status: isInvestor ? 'SUBMITTED' : 'DRAFT', revision: isInvestor ? investor.revision + 1 : 1,
        details: isInvestor ? investorDetails : {}, context_kind: 'PERSONAL', context_organisation_id: null,
        origin: 'SELF_SERVICE', admission_purpose: isInvestor ? 'INVESTOR_ADMISSION' : 'CUSTOMER_ORGANISATION_ADMISSION',
        provider_mode: isInvestor ? 'MANUAL_TEST_REVIEW' : 'UNASSIGNED', reviewer_scope: isInvestor ? scope : null,
        organisation_id: null, reviewer_id: null, reviewed_at: null, approved_until: null, review_notes: null, review_checks: {},
        created_at: undefined, submitted_at: undefined,
      }, 'application has exact input-derived fields, without approval/account/role or extra state')
      inWindow(a.created_at)
      if (isInvestor) inWindow(a.submitted_at); else eq(a.submitted_at, null, 'denied cross-capacity application has no submission time')
    }
    const expectedEvents = [
      { application_id: investor.id, kind: 'start_application', summary: 'Additional unapproved application capacity created; no role or eligibility granted.' },
      { application_id: investor.id, kind: 'submit_application', summary: 'Exact application evidence submitted to an independently staffed synthetic review function; no operational authority granted.' },
      { application_id: manager.id, kind: 'start_application', summary: 'Additional unapproved application capacity created; no role or eligibility granted.' },
    ]
    eq(additions['bx1_portal.events'].length, expectedEvents.length, 'only three exact canonical entry events survive')
    for (const expected of expectedEvents) {
      const matches = additions['bx1_portal.events'].filter(value => value.application_id === expected.application_id && value.kind === expected.kind)
      eq(matches.length, 1, 'captured command has one exact canonical event')
      const event = matches[0]
      exactKeys(event, ['id', 'subject_id', 'application_id', 'organisation_id', 'investor_id', 'kind', 'actor_id', 'created_at', 'summary'], 'canonical entry event')
      eq({ ...event, id: undefined, created_at: undefined }, { id: undefined, subject_id: expected.application_id,
        ...expected, organisation_id: null, investor_id: null, actor_id: id(1), created_at: undefined }, 'canonical event is exact; no unrelated command footprint')
      uuid(event.id, 'canonical event UUID generated'); inWindow(event.created_at)
    }
    eq(await functions(), installed, 'all functional observations leave installed receipt/global/quarantine/representative definitions exact')
    eq(await security(), baselineSecurity, 'all guards and private/public ACL/RLS remain enabled and exact during business observations')
    await db.query('rollback'); begun = false
    eq(await rows(), waitFixtureRows, 'whole proof rollback restores every inherited row and leaves only exact wait fixture')
    eq(await functions(), baselineFunctions, 'whole proof rollback restores original native8 and removes new signatures')
    eq(await security(), baselineSecurity, 'whole proof rollback restores every original security/trigger object')
    await cleanupWaitFixture()
    console.log(`BX1_ADMISSION_DOCUMENT_RECEIPTS_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 transport=explicit-trusted-server-attestation native8=compatible enrolledAAL1=synthetic-unscanned noFactor=preserved nativeAAL2=preserved factorMutation=none globalGuards=byte-identical quarantine=unchanged sessionRevocation=real-two-backend-wait storageExpiry=real-two-backend-wait receiptConflictExpiry=real-two-backend-wait binding=canonical-owner-application-revision crossCapacityReuse=denied auditRollback=receipt-and-submission preciseFootprint=input-derived cleanup=full-rollback-and-exact-three-rows hostedAcceptance=not-proven authGetUser=not-proven documentBytes=not-proven providerAcceptance=not-proven independentHumans=not-proven`)
    return checks
  } catch (error) {
    error.admissionDocumentReceiptsPhase = phase
    primaryFailure = error
    throw error
  } finally {
    if (begun) { await db.query('rollback').catch(() => {}); begun = false }
    await admin().catch(() => {})
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
    try {
      for (const restore of externalRestores.reverse()) await restore()
      if (committedWaitFixture) {
        try { await cleanupWaitFixture() }
        finally { if (begun) { await db.query('rollback').catch(() => {}); begun = false } }
      }
    } catch (cleanupFailure) {
      const code = cleanupFailure?.code === 'ERR_ASSERTION' ? 'assertion'
        : typeof cleanupFailure?.code === 'string' && /^[0-9A-Z]{5}$/.test(cleanupFailure.code) ? cleanupFailure.code : 'unavailable'
      console.error(`BX1_ADMISSION_DOCUMENT_RECEIPTS_CLEANUP_FAILED code=${code}`)
      if (primaryFailure) throw primaryFailure
      cleanupFailure.admissionDocumentReceiptsPhase = phase
      throw cleanupFailure
    }
  }
}
