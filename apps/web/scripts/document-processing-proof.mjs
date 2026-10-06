import assert from 'node:assert/strict'

const worker = 'synthetic-processing-worker'
const scanner = 'synthetic-processing-scanner'
const workerRole = 'bx1_document_processing_worker'
const scannerRole = 'bx1_document_scanner_writer'
const processingFunctions = [
  'bx1_private.claim_document_processing(text,text,uuid)',
  'bx1_private.read_document_processing(uuid,uuid,bigint,text,text)',
  'bx1_private.fail_document_processing(uuid,uuid,bigint,text,text,text)',
]
const tables = ['document_processing_policy', 'document_processing_jobs',
  'document_processing_attempts', 'document_processing_claim_receipts', 'document_processing_events']

function requireFixture() {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Document processing proof requires exact disposable cloud fixture')
}

// Shared by the full portal proof and the final TEST/MAIN entry chains. This
// inspects the installed defaults; it never admits a real processing service.
export async function proveDocumentProcessingDefaultAcl(db) {
  requireFixture()
  let checks = 0
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  await db.query('reset role')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true,
    'processing ACL proof is confined to disposable owner fixture')
  eq(await scalar("select state='NOT_ADMITTED' and worker_id is null and scanner_id is null from bx1_private.document_processing_policy where singleton"), true,
    'document processing defaults unadmitted with no configured producer')
  eq(await scalar(`select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
    and not rolcreaterole and not rolreplication and not rolbypassrls
    from pg_roles where rolname=$1`, [workerRole]), true, 'processing worker is a constrained NOLOGIN role')
  eq(await scalar(`select count(*)::int from pg_auth_members
    where member=(select oid from pg_roles where rolname=$1)`, [workerRole]), 0,
  'processing worker has no outgoing role memberships')
  // PostgreSQL17 automatically gives a non-superuser CREATEROLE creator
  // administrative membership with SET/INHERIT both false. That is not
  // processing-service admission or executable inherited authority.
  eq(await scalar(`select count(*)::int from pg_auth_members
    where roleid=(select oid from pg_roles where rolname=$1)
      and (member<>(select oid from pg_roles where rolname=current_user)
        or inherit_option or set_option or not admin_option)`, [workerRole]), 0,
  'worker has no usable or seeded membership beyond PostgreSQL creator-only administration')
  for (const role of ['anon', 'authenticated', 'service_role', workerRole, scannerRole, 'bx1_document_receipt_writer']) {
    for (const table of tables) eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      [role, `bx1_private.${table}`]), false, `${role} has no direct ${table} grant`)
  }
  for (const signature of processingFunctions) {
    eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [workerRole, signature]), true,
      `function-only worker can invoke ${signature}`)
    for (const role of ['anon', 'authenticated', 'service_role', scannerRole, 'bx1_document_receipt_writer'])
      eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false,
        `${role} cannot invoke ${signature}`)
  }
  eq(await scalar(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and has_function_privilege($1,p.oid,'EXECUTE')
      and p.oid<>all($2::regprocedure[])`, [workerRole, processingFunctions]), 0,
  'processing worker has exactly three private entry-function grants')
  for (const signature of ['bx1_private.record_document_scan_pre_processing(uuid,text,text,text,text,timestamptz)',
    'bx1_private.promote_scanned_document_pre_processing(uuid)']) {
    eq(await scalar(`select not exists(select 1 from pg_proc p cross join lateral
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=$1::regprocedure and a.grantee<>p.proowner)`, [signature]), true,
    `${signature} is explicitly owner-only, including PUBLIC`)
  }
  for (const signature of ['bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)',
    'bx1_private.promote_scanned_document(uuid)', 'bx1_private.read_quarantined_document(uuid)',
    'bx1_private.document_disposal_eligible(uuid)'])
    eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [workerRole, signature]), false,
      `worker cannot attest, promote, bypass leased retrieval or dispose through ${signature}`)
  eq(await scalar("select has_schema_privilege($1,'storage','USAGE')", [workerRole]), false,
    'worker has no Storage schema authority')
  eq(await scalar("select has_table_privilege($1,'storage.objects','SELECT,INSERT,UPDATE,DELETE')", [workerRole]), false,
    'worker cannot read or mutate private Storage directly')
  for (const table of tables) eq(await scalar(`select relrowsecurity from pg_class where oid=$1::regclass`,
    [`bx1_private.${table}`]), true, `${table} retains RLS`)
  return checks
}

// Called at the end of the existing committed cloud fixture. It owns its
// bounded transactions, reuses two independently connected backend PIDs, and
// leaves schema cleanup to test-portal's existing finally block.
export async function proveDocumentProcessing(db, clients, featureSql) {
  requireFixture()
  assert.equal(clients.length, 2, 'processing concurrency requires exactly two proof clients')
  let checks = 0, sequence = 0, begun = false
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const truth = (value, label) => { assert.ok(value, label); checks++ }
  const scalar = async (sql, params = [], client = db) => Object.values((await client.query(sql, params)).rows[0])[0]
  const id = n => `ed750000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const request = () => `ef750000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const actor = id(900), session = id(901), hash = 'c'.repeat(64)
  const admin = client => (client ?? db).query('reset role')
  const role = async (name, client = db) => { await admin(client); await client.query(`set local role ${name}`) }
  const begin = async () => { await db.query('begin'); begun = true; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const claim = async (key = request(), client = db, claimedWorker = worker, claimedScanner = scanner) => {
    await role(workerRole, client)
    return scalar('select bx1_private.claim_document_processing($1,$2,$3::uuid)',
      [claimedWorker, claimedScanner, key], client)
  }
  const leased = async (manifest, operation = 'read', code = 'ENGINE_UNAVAILABLE') => {
    await role(workerRole)
    return scalar(`select bx1_private.${operation === 'read' ? 'read' : 'fail'}_document_processing($1::uuid,$2::uuid,$3::bigint,$4,$5${operation === 'read' ? '' : ',$6'})`,
      [manifest.document_id, manifest.attempt_id, manifest.authority_epoch, manifest.worker_id, manifest.scanner_id,
        ...(operation === 'read' ? [] : [code])])
  }
  const result = async (manifest, verdict = 'CLEAN', observed = new Date().toISOString(), overrides = {}) => {
    await role(scannerRole)
    return scalar('select bx1_private.record_document_scan($1::uuid,$2,$3,$4,$5,$6::timestamptz)',
      [overrides.document_id ?? manifest.document_id, overrides.sha256 ?? manifest.sha256,
        overrides.scanner_id ?? manifest.scanner_id, overrides.reference ?? manifest.reference,
        verdict, observed])
  }
  const promote = async documentId => { await role(scannerRole); return scalar('select bx1_private.promote_scanned_document($1::uuid)', [documentId]) }
  const denied = async (label, operation, expectedCode) => {
    await admin(); await db.query('savepoint processing_expected_denial')
    let failure
    try { await operation() } catch (error) { failure = error }
    await db.query('rollback to savepoint processing_expected_denial; release savepoint processing_expected_denial')
    await admin()
    truth(failure, `${label} rejects the operation`)
    if (expectedCode) eq(failure.code, expectedCode, `${label} SQLSTATE`)
  }
  const records = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'applications',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.applications a),
      'accounts',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.investment_accounts a),
      'mandates',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.representative_mandates a),
      'investing_mandates',(select jsonb_agg(to_jsonb(a) order by id) from bx1_portal.investing_representative_mandates a),
      'memberships',(select jsonb_agg(to_jsonb(a) order by id) from public.bx1_memberships a),
      'configuration',(select to_jsonb(c) from bx1_portal.entry_configuration c),
      'portal_events',(select count(*) from bx1_portal.events),
      'entry_requests',(select count(*) from bx1_portal.entry_requests),
      'scoped_requests',(select count(*) from bx1_portal.scoped_requests),
      'governance',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_governance_events a),
      'retention_policy',(select to_jsonb(a) from bx1_private.document_retention_admission a))`)
  }
  const documentRecords = async () => scalar(`select jsonb_build_object(
    'quarantine',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_quarantine_items a),
    'scans',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_scan_events a),
    'receipts',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_upload_receipts a))`)
  const writer = () => scalar("select md5(pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::regprocedure))")
  const jobState = async documentId => { await admin(); return scalar('select state from bx1_private.document_processing_jobs where document_id=$1', [documentId]) }
  const processingSnapshot = async () => {
    await admin()
    return scalar(`select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(a) order by document_id) from bx1_private.document_processing_jobs a),
      'attempts',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_processing_attempts a),
      'requests',(select jsonb_agg(to_jsonb(a) order by worker_id,request_id) from bx1_private.document_processing_claim_receipts a),
      'events',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_processing_events a),
      'quarantine',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_quarantine_items a),
      'scans',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_scan_events a),
      'receipts',(select jsonb_agg(to_jsonb(a) order by id) from bx1_private.document_upload_receipts a))`)
  }
  const insertDocument = async (n, state = 'QUARANTINED', matchingScan = false) => {
    await admin()
    const doc = id(n), path = `${actor}/${doc}`
    await db.query(`insert into bx1_private.document_quarantine_items
      (id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type,state,scanner_id,scanner_reference,scanned_at,promoted_at)
      values($1,$2,$3,$4,'IDENTITY','Synthetic processing evidence',$5,25,'application/pdf',$6,
        case when $6='QUARANTINED' then null else 'legacy-fixture-scanner' end,
        case when $6='QUARANTINED' then null else 'legacy:'||$1::text end,
        case when $6='QUARANTINED' then null else clock_timestamp() end,
        case when $6='PROMOTED' then clock_timestamp() else null end)`, [doc, actor, session, path, hash, state])
    if (matchingScan) await db.query(`insert into bx1_private.document_scan_events
      (document_id,scanner_id,scanner_reference,verdict,sha256,observed_at)
      select id,scanner_id,scanner_reference,case when state='REJECTED' then 'MALICIOUS' else 'CLEAN' end,sha256,scanned_at
      from bx1_private.document_quarantine_items where id=$1`, [doc])
    return doc
  }
  const register = async n => {
    await admin()
    const doc = id(n), path = `${actor}/${doc}`
    await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
      values('bx1-portal-quarantine',$1,'{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',$2::text))`, [path, hash])
    await role('bx1_document_receipt_writer')
    return scalar("select bx1_private.register_quarantined_document($1,$2,$3,'IDENTITY','Synthetic processing evidence',$4,25,'application/pdf')", [actor, session, doc, hash])
  }
  const expire = async manifest => {
    await admin()
    // Only the disposable owner can create elapsed-time fixtures. Production
    // roles cannot alter the immutable lease/identity snapshot.
    await db.query('alter table bx1_private.document_processing_attempts disable trigger bx1_document_processing_attempt_immutable')
    await db.query("update bx1_private.document_processing_attempts set started_at=aged.started,lease_expires_at=aged.started+interval '120 seconds' from (select clock_timestamp()-interval '121 seconds' started) aged where id=$1", [manifest.attempt_id])
    await db.query('alter table bx1_private.document_processing_attempts enable trigger bx1_document_processing_attempt_immutable')
  }
  const ready = async doc => { await admin(); await db.query("update bx1_private.document_processing_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where document_id=$1", [doc]) }
  const auditFailure = async (label, operation) => {
    const before = await processingSnapshot()
    await denied(label, async () => {
      await db.query(`create function public.synthetic_processing_audit_failure() returns trigger language plpgsql as $$
        begin raise exception 'synthetic_processing_required_audit' using errcode='23514'; end $$;
        create trigger synthetic_processing_audit_failure before insert on bx1_private.document_processing_events
        for each row execute function public.synthetic_processing_audit_failure()`)
      await operation()
    }, '23514')
    eq(await processingSnapshot(), before, `${label} rolls back every job, attempt, receipt, result and registry write`)
  }
  const parallelClaim = async (client, key) => {
    await client.query('begin')
    try { const manifest = await claim(key, client); await client.query('commit'); return manifest }
    catch (error) { await client.query('rollback'); throw error }
    finally { await admin(client) }
  }
  const waitForBothBlocked = async pids => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (await scalar(`select count(*)::int from pg_stat_activity where pid=any($1::int[])
        and cardinality(pg_blocking_pids(pid))>0`, [pids]) === 2) {
        checks++; return
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Processing claim race did not overlap on the held policy row')
  }
  try {
    await begin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable processing fixture')
    const pids = await Promise.all(clients.map(client => scalar('select pg_backend_pid()', [], client)))
    truth(pids[0] !== pids[1] && !pids.includes(await scalar('select pg_backend_pid()')), 'three distinct PostgreSQL backend PIDs')
    const businessBefore = await records(), writerBefore = await writer()
    await db.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'processing-fixture@example.invalid',clock_timestamp(),false)", [actor])
    await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp())", [session, actor])
    const legacy = [await insertDocument(1), await insertDocument(2, 'SCANNED_CLEAN', true),
      await insertDocument(3, 'SCANNED_CLEAN'), await insertDocument(4, 'PROMOTED', true), await insertDocument(5, 'REJECTED', true)]
    const documentsBefore = await documentRecords()
    try { await db.query(featureSql) } catch (error) {
      const position = Number(error.position)
      if (position > 0 && position <= featureSql.length) error.fixtureLine = featureSql.slice(0, position - 1).split('\n').length
      throw error
    }
    eq(await documentRecords(), documentsBefore, 'processing installation leaves all existing registry, scan and receipt history byte-for-byte unchanged')
    eq(await records(), businessBefore, 'processing installation changes no business, role, retention or governance authority')
    eq(await writer(), writerBefore, 'processing leaves the canonical application/financial command definition unchanged')
    checks += await proveDocumentProcessingDefaultAcl(db)
    eq((await db.query('select origin,state,current_attempt_id,attempt_number from bx1_private.document_processing_jobs where document_id=any($1::uuid[]) order by document_id', [legacy])).rows,
      [{ origin: 'LEGACY_PENDING', state: 'QUEUED', current_attempt_id: null, attempt_number: 0 },
        { origin: 'LEGACY_RESULT', state: 'RESULT_RECORDED', current_attempt_id: null, attempt_number: 0 },
        { origin: 'LEGACY_RESULT', state: 'LEGACY_BLOCKED', current_attempt_id: null, attempt_number: 0 },
        { origin: 'LEGACY_COMPLETED', state: 'COMPLETED', current_attempt_id: null, attempt_number: 0 },
        { origin: 'LEGACY_REJECTED', state: 'REJECTED', current_attempt_id: null, attempt_number: 0 }],
    'legacy classifications preserve explicit origins without invented attempts')
    eq(await scalar('select count(*)::int from bx1_private.document_processing_attempts'), 0, 'install manufactures no historical attempt')
    await denied('default-unadmitted worker cannot claim', () => claim(), '42501')
    await denied('unfenced legacy CLEAN cannot promote', () => promote(legacy[1]), '42501')
    await admin()
    await db.query('update bx1_private.document_receipt_policy set enforced=true where singleton')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SCANNER_REQUIRED' where singleton")
    await db.query("update bx1_private.document_processing_policy set state='ADMITTED',worker_id=$1,scanner_id=$2 where singleton", [worker, scanner])
    const initialEpoch = Number(await scalar('select authority_epoch from bx1_private.document_processing_policy where singleton'))
    truth(Number.isSafeInteger(initialEpoch) && initialEpoch > 0, 'fixture admission obtains a positive monotonic epoch')
    await db.query('savepoint processing_synthetic_mode_case')
    await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
    await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
    await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
    await denied('processing admission alone cannot bypass synthetic document mode', () => claim(), '42501')
    await db.query('rollback to savepoint processing_synthetic_mode_case; release savepoint processing_synthetic_mode_case')
    await denied('body-selected worker identity denied', () => claim(request(), db, 'another-worker'), '42501')
    await denied('body-selected scanner identity denied', () => claim(request(), db, worker, 'another-scanner'), '42501')
    await denied('registry hash input is immutable', () => db.query('update bx1_private.document_quarantine_items set sha256=$1 where id=$2', ['d'.repeat(64), legacy[0]]), '23514')
    await denied('job hash input is immutable', () => db.query('update bx1_private.document_processing_jobs set sha256=$1 where document_id=$2', ['d'.repeat(64), legacy[0]]), '23514')
    await denied('historical CLEAN stays fenced after admission', () => promote(legacy[1]), '42501')
    await denied('historical completed item cannot re-enter promotion without a reviewed attempt rebind', () => promote(legacy[3]), '42501')
    // Isolate the real claim races from unrelated earlier suite registry items.
    // This is fixture-owned setup, not a worker path or operational transition.
    await admin(); await db.query("update bx1_private.document_processing_jobs set state='LEGACY_BLOCKED' where state='QUEUED'")
    const emptyKey = request()
    eq(await claim(emptyKey), null, 'empty queue has an explicit null claim')
    await auditFailure('queue evidence failure', () => insertDocument(10))
    await register(10)
    await role('bx1_document_receipt_writer')
    await scalar("select bx1_private.register_quarantined_document($1,$2,$3,'IDENTITY','Synthetic processing evidence',$4,25,'application/pdf')", [actor, session, id(10), hash])
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.document_processing_jobs where document_id=$1', [id(10)]), 1, 'exact upload retry creates one immutable hash-bound job')
    eq(await claim(emptyKey), null, 'an empty-queue request receipt cannot consume a later upload')
    await auditFailure('claim evidence failure', () => claim())
    await commit()

    // Holding the one committed job proves SKIP LOCKED on other actual PIDs.
    await begin()
    await db.query('select document_id from bx1_private.document_processing_jobs where document_id=$1 for update', [id(10)])
    eq(await Promise.all(clients.map(client => parallelClaim(client, request()))), [null, null],
      'independent worker backends skip the held committed queue row')
    await commit()
    const raceKeys = [request(), request()]
    // Hold the policy's first lock until both distinct backend requests are
    // observably waiting. Releasing it launches the same-job race together.
    await begin()
    await db.query('select singleton from bx1_private.document_processing_policy where singleton for update')
    const pendingRace = Promise.all(clients.map((client, index) => parallelClaim(client, raceKeys[index])))
    let overlapError
    try { await waitForBothBlocked(pids) } catch (error) { overlapError = error }
    await commit()
    const raced = await pendingRace
    if (overlapError) throw overlapError
    eq(raced.filter(Boolean).length, 1, 'two simultaneous real backend claims acquire exactly one committed job')
    const manifest = raced.find(Boolean), winner = raced.findIndex(Boolean)
    eq(Object.keys(manifest).sort(), ['actor_id', 'attempt_id', 'attempt_number', 'authority_epoch', 'document_id',
      'lease_expires_at', 'mime_type', 'reference', 'scanner_id', 'sha256', 'size', 'storage_path', 'worker_id'].sort(), 'claim has the strict server-owned manifest contract')
    eq([manifest.document_id, manifest.actor_id, manifest.sha256, manifest.size, manifest.mime_type,
      manifest.worker_id, manifest.scanner_id, manifest.attempt_number, manifest.authority_epoch],
    [id(10), actor, hash, 25, 'application/pdf', worker, scanner, 1, initialEpoch], 'first claim binds exact registered document and admitted identities')
    eq(manifest.reference, `bx1-scan:${manifest.attempt_id}`, 'scanner reference is the canonical exact attempt UUID')
    await begin()
    await admin()
    eq(await scalar("select extract(epoch from lease_expires_at-started_at)::int from bx1_private.document_processing_attempts where id=$1", [manifest.attempt_id]), 120, 'lease is fixed at 120 seconds')
    eq(await claim(raceKeys[winner]), manifest, 'live exact request replay returns its original attempt manifest')
    eq(await claim(raceKeys[1 - winner]), null, 'losing race receipt stays null instead of consuming another job')
    eq((await leased(manifest)).document_id, manifest.document_id, 'leased retrieval revalidates the exact current attempt')
    await denied('wrong lease cannot retrieve', () => leased({ ...manifest, attempt_id: id(999) }), '42501')
    await denied('attempt authority snapshot cannot be edited', () => db.query('update bx1_private.document_processing_attempts set authority_epoch=authority_epoch+1 where id=$1', [manifest.attempt_id]), '23514')
    await denied('worker cannot self-attest CLEAN', async () => {
      await role(workerRole); await scalar('select bx1_private.record_document_scan($1,$2,$3,$4,$5,clock_timestamp())', [id(10), hash, scanner, manifest.reference, 'CLEAN'])
    }, '42501')
    await denied('legacy scanner reference cannot bypass lease fence', () => result(manifest, 'CLEAN', new Date().toISOString(), { reference: 'unfenced-legacy-result' }))
    await denied('result cannot use another scanner', () => result(manifest, 'CLEAN', new Date().toISOString(), { scanner_id: 'other-scanner' }), '42501')
    await denied('result cannot attest a different byte hash', () => result(manifest, 'CLEAN', new Date().toISOString(), { sha256: 'd'.repeat(64) }))
    await auditFailure('retry evidence failure', () => leased(manifest, 'fail', 'ENGINE_UNAVAILABLE'))
    const failed = await leased(manifest, 'fail', 'ENGINE_UNAVAILABLE')
    eq([failed.document_id, failed.attempt_id, failed.state, failed.attempt_number], [id(10), manifest.attempt_id, 'RETRY_WAIT', 1], 'explicit engine failure retains attempt and schedules retry')
    await admin()
    truth(await scalar("select next_attempt_at>clock_timestamp()+interval '25 seconds' and next_attempt_at<=clock_timestamp()+interval '30 seconds' from bx1_private.document_processing_jobs where document_id=$1", [id(10)]), 'retry backoff is fixed at 30 seconds')
    eq(await claim(raceKeys[winner]), null, 'ended request receipt never creates a second attempt')
    eq(await claim(), null, 'backoff blocks a premature fresh request')
    await denied('failed attempt cannot retrieve bytes', () => leased(manifest), '42501')
    await denied('claim request receipt is immutable', () => db.query("update bx1_private.document_processing_claim_receipts set manifest=null where worker_id=$1 and request_id=$2", [worker, raceKeys[winner]]), '23514')
    await ready(id(10))
    const second = await claim()
    eq(second.attempt_number, 2, 'fresh retry increments durable attempt number')
    await denied('old attempt cannot fail the new lease', () => leased(manifest, 'fail'), '42501')
    await denied('old scanner attempt cannot record a new result', () => result(manifest), '42501')
    await admin(); await db.query("update bx1_private.document_processing_policy set state='NOT_ADMITTED' where singleton")
    const revokedEpoch = Number(await scalar('select authority_epoch from bx1_private.document_processing_policy where singleton'))
    truth(revokedEpoch > initialEpoch, 'revocation advances authority epoch')
    await denied('revocation fences leased byte release', () => leased(second), '42501')
    await denied('revocation fences failure writes', () => leased(second, 'fail'), '42501')
    await denied('revocation fences scanner callback', () => result(second), '42501')
    await denied('revocation fences new claims', () => claim(), '42501')
    await admin(); await db.query("update bx1_private.document_processing_policy set state='ADMITTED' where singleton")
    await denied('readmission cannot revive old epoch', () => leased(second), '42501')
    await denied('readmission cannot revive an old scanner callback', () => result(second), '42501')
    eq(await claim(raceKeys[winner]), null, 'a request from a revoked epoch never consumes another attempt on readmission')
    await expire(second)
    await auditFailure('lease expiry evidence failure', () => claim())
    eq(await claim(), null, 'expiry transitions to retry wait without immediate replacement')
    await admin()
    eq(await scalar('select outcome from bx1_private.document_processing_attempts where id=$1', [second.attempt_id]), 'EXPIRED', 'elapsed attempt is durably EXPIRED')
    eq(await jobState(id(10)), 'RETRY_WAIT', 'expiry enforces retry backoff')
    await denied('expired lease cannot release bytes', () => leased(second), '42501')
    await denied('expired lease cannot write failure', () => leased(second, 'fail'), '42501')
    await denied('expired scanner cannot record a result', () => result(second), '42501')
    for (let attempt = 3; attempt <= 5; attempt++) {
      await ready(id(10))
      const next = await claim()
      eq(next.attempt_number, attempt, `retry attempt ${attempt} is monotonic`)
      await expire(next)
      if (attempt === 3) {
        eq(await scalar(`select j.state='LEASED' and a.outcome='LEASED'
          and a.authority_epoch=p.authority_epoch
          from bx1_private.document_processing_jobs j
          join bx1_private.document_processing_attempts a on a.id=j.current_attempt_id
          cross join bx1_private.document_processing_policy p
          where a.id=$1 and p.singleton`, [next.attempt_id]), true,
        'expiry denials retain the current epoch and an otherwise LEASED job/attempt')
        const expiredCurrentBefore = await processingSnapshot()
        await denied('expired current-epoch lease cannot release bytes', () => leased(next), '42501')
        await denied('expired current-epoch lease cannot write failure', () => leased(next, 'fail'), '42501')
        await denied('expired current-epoch scanner cannot record a result', () => result(next), '42501')
        eq(await processingSnapshot(), expiredCurrentBefore,
          'current-epoch expiry denials leave jobs, attempts, receipts, results and evidence unchanged')
      }
      eq(await claim(), null, `expired attempt ${attempt} does not mint an immediate replacement`)
      eq(await jobState(id(10)), attempt === 5 ? 'EXHAUSTED' : 'RETRY_WAIT', `attempt ${attempt} observes the fixed five-attempt ceiling`)
    }
    eq(await claim(), null, 'exhausted document is not claimed a sixth time')

    // Permanent failures and result/promotion retries use separate new jobs.
    await register(14); const delivery = await claim()
    await denied('unknown failure code cannot mutate an attempt', () => leased(delivery, 'fail', 'UNKNOWN_FAILURE'), '22023')
    eq((await leased(delivery, 'fail', 'DELIVERY_FAILED')).state, 'RETRY_WAIT', 'delivery interruption follows the same bounded retry path')
    await ready(id(14))
    const deliveredRetry = await claim()
    eq([deliveredRetry.document_id, deliveredRetry.attempt_number], [id(14), 2], 'delivery retry resumes the same job with a fresh monotonic attempt')
    eq((await leased(deliveredRetry, 'fail', 'INVALID_DOCUMENT')).state, 'EXHAUSTED', 'recovered delivery fixture terminates before unrelated job claims')
    for (const [n, code] of [[11, 'INVALID_DOCUMENT'], [12, 'HASH_MISMATCH']]) {
      await register(n); const next = await claim()
      eq(next.document_id, id(n), `${code} claim selects the exact fresh fixture document`)
      eq((await leased(next, 'fail', code)).state, 'EXHAUSTED', `${code} terminates without retry`)
    }
    await register(13); const clean = await claim()
    eq(clean.document_id, id(13), 'result proof owns the exact fresh fixture document')
    await auditFailure('result evidence failure', () => result(clean))
    const observed = new Date().toISOString()
    await result(clean, 'CLEAN', observed)
    eq(await jobState(id(13)), 'RESULT_RECORDED', 'CLEAN records a result, not promotion')
    await denied('CLEAN without final Storage object cannot promote', () => promote(id(13)), '23514')
    eq(await jobState(id(13)), 'RESULT_RECORDED', 'promotion failure retains the durable result retry path')
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.document_processing_attempts where document_id=$1', [id(13)]), 1, 'promotion failure does not rescan or create an attempt')
    await result(clean, 'CLEAN', observed)
    await denied('conflicting verdict cannot replace CLEAN', () => result(clean, 'MALICIOUS', observed), '23505')
    await denied('conflicting observation cannot replace immutable result', () => result(clean, 'CLEAN', new Date(new Date(observed).getTime() + 1).toISOString()), '23505')
    await admin()
    // Synthetic clock aging is restricted to owner setup and immediately
    // restores the historical event's immutable trigger before the RPC retry.
    const oldObserved = await scalar("select (clock_timestamp()-interval '2 days')::text")
    await db.query('alter table bx1_private.document_scan_events disable trigger bx1_document_scan_event_immutable')
    await db.query('update bx1_private.document_scan_events set observed_at=$1::timestamptz where document_id=$2', [oldObserved, id(13)])
    await db.query('alter table bx1_private.document_scan_events enable trigger bx1_document_scan_event_immutable')
    await db.query('update bx1_private.document_quarantine_items set scanned_at=$1::timestamptz where id=$2', [oldObserved, id(13)])
    const lateBefore = await processingSnapshot()
    await result(clean, 'CLEAN', oldObserved)
    eq(await processingSnapshot(), lateBefore, 'exact durable CLEAN replay remains idempotent beyond the original one-day window')
    await denied('old conflicting durable replay still rejects', () => result(clean, 'MALICIOUS', oldObserved), '23505')
    await admin()
    await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata)
      values('bx1-portal-documents',$1,$2,'{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',$3::text))`, [clean.storage_path, actor, hash])
    await auditFailure('promotion evidence failure', () => promote(id(13)))
    await db.query('savepoint processing_changed_scanner_request')
    await db.query("update bx1_private.document_processing_policy set scanner_id='synthetic-replacement-scanner' where singleton")
    await denied('immutable claim request rejects changed scanner authority',
      () => claim(raceKeys[winner], db, worker, 'synthetic-replacement-scanner'), '23505')
    await db.query('rollback to savepoint processing_changed_scanner_request; release savepoint processing_changed_scanner_request')
    await admin(); await db.query("update bx1_private.document_processing_policy set scanner_id='synthetic-replacement-scanner' where singleton")
    await denied('scanner reconfiguration fences recorded promotion', () => promote(id(13)), '42501')
    await db.query('rollback'); begun = false
    // The sequential adverse cases are rollback-only. Create a fresh admitted
    // positive result in a separate bounded transaction for terminal proof.
    await begin()
    await db.query("update bx1_private.document_processing_jobs set state='LEGACY_BLOCKED' where document_id=$1", [id(10)])
    await register(20); const completed = await claim()
    eq(completed.document_id, id(20), 'completion proof owns the exact fresh fixture document')
    await result(completed)
    await admin()
    await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata)
      values('bx1-portal-documents',$1,$2,'{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',$3::text))`, [completed.storage_path, actor, hash])
    await promote(id(20)); await promote(id(20))
    eq(await jobState(id(20)), 'COMPLETED', 'fenced clean result promotion completes idempotently')
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.document_upload_receipts where id=$1', [id(20)]), 1, 'completion mints only the existing exact scanned receipt')
    await register(21); const malicious = await claim()
    eq(malicious.document_id, id(21), 'malicious proof owns the exact fresh fixture document')
    const badObserved = new Date().toISOString()
    await result(malicious, 'MALICIOUS', badObserved); await result(malicious, 'MALICIOUS', badObserved)
    eq(await jobState(id(21)), 'REJECTED', 'malicious result is durably rejected and exactly replayable')
    await denied('malicious result cannot promote', () => promote(id(21)))
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.document_upload_receipts where id=$1', [id(21)]), 0, 'malicious result creates no clean receipt')
    await denied('processing events are append-only', () => db.query("update bx1_private.document_processing_events set evidence='{}' where document_id=$1", [id(20)]), '23514')
    eq(await records(), businessBefore, 'complete synthetic processing proof grants no application, account, mandate, membership or retention/disposal authority')
    eq(await writer(), writerBefore, 'processing proof leaves the canonical business writer untouched')
    await db.query('rollback'); begun = false
    console.log(`BX1_DOCUMENT_PROCESSING_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 concurrency=distinct-backends-skip-locked-and-simultaneous-race lease=120s backoff=30s attempts=5 admissionEpoch=fenced claimReplay=durable auditRollback=proven scannerEngine=not-proven documentBytes=not-proven`)
    return checks
  } finally {
    if (begun) await db.query('rollback').catch(() => {})
    await admin().catch(() => {})
    await Promise.all(clients.map(async client => { await client.query('rollback').catch(() => {}); await admin(client).catch(() => {}) }))
  }
}
