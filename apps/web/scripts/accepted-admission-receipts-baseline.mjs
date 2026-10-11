import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Integration-only proof in the existing disposable cloud fixture. The accepted
// receipt proof intentionally rolls its SQL back; this installs that exact SQL
// as inherited runtime BEFORE Stage3 takes its own protected baseline.
const ACCEPTED_SOURCE = '571bff8df52729e65c8b202db20daebd9cc05846'
const ACCEPTED_SQL_SHA256 = 'c6e7c8b10ffe10f8dc6623650a1d3bac949a2486324f51bd46c123504053324f'
const native8 = 'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)'
const explicit9 = 'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text,jsonb)'
const classifier = 'bx1_private.admission_receipt_session(uuid,uuid,jsonb)'
const signatures = [native8, explicit9, classifier]
const namespaces = ['auth', 'storage', 'public', 'bx1_private', 'bx1_portal']
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex')
const normalise = text => text.replace(/\r\n/g, '\n')

export async function installAcceptedAdmissionReceiptsBaseline(db, clients, featureSql, migrationSql) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.argv.length !== 2 || clients.length !== 2
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Accepted receipt inheritance requires exact disposable cloud fixture')
  let checks = 0, begun = false, primaryFailure, phase = 'accepted-source-pin'
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0]
  const admin = () => db.query('reset role')
  const failureCode = error => typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : 'assertion'
  const functions = async () => {
    await admin()
    return (await db.query(`select p.oid::text,n.nspname,p.proname,p.oid::regprocedure::text signature,
      encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') definition_hash,
      encode(sha256(convert_to(btrim(replace(p.prosrc,E'\\r\\n',E'\\n'),E' \\n\\t'),'UTF8')),'hex') source_hash,
      p.proowner::text owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel,
      p.proleakproof,p.proisstrict,p.proretset,p.prorettype::text,p.prolang::text,p.procost,p.prorows,
      p.pronargs,p.pronargdefaults,p.proargtypes::text,p.proallargtypes::text,p.proargmodes,p.proargnames,
      p.proargdefaults::text,p.prosupport::text,p.probin,p.prosqlbody::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=any($1::text[]) and p.prokind='f' order by p.oid`, [namespaces])).rows
  }
  const relations = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname,c.oid::text,c.relkind,c.relpersistence,c.reloptions,
      (select jsonb_agg(to_jsonb(a) order by a.attnum) from pg_attribute a
        where a.attrelid=c.oid and a.attnum>0) attributes,
      (select jsonb_agg(to_jsonb(d) order by d.adnum) from pg_attrdef d where d.adrelid=c.oid) defaults,
      (select jsonb_agg(to_jsonb(con) order by con.oid) from pg_constraint con where con.conrelid=c.oid) constraints,
      (select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i where i.indrelid=c.oid) indexes
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname=any($1::text[]) order by 1,2`, [namespaces])).rows
  }
  const rows = async specs => {
    await admin()
    const result = {}
    for (const spec of specs) {
      for (const name of [spec.nspname, spec.relname]) assert.match(name, /^[a-z0-9_]+$/)
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
      'schemas',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,nspname,nspowner,nspacl
        from pg_namespace where nspname=any($1::text[])) t),
      'relations',(select jsonb_agg(to_jsonb(t) order by oid) from (select c.oid,c.relname,c.relowner,c.relacl,
        c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname=any($1::text[])) t),
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t),
      'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from (select tr.oid,tr.tgrelid,tr.tgname,tr.tgenabled,
        tr.tgfoid,pg_get_triggerdef(tr.oid) definition from pg_trigger tr join pg_class c on c.oid=tr.tgrelid
        join pg_namespace n on n.oid=c.relnamespace where not tr.tgisinternal
          and n.nspname=any($1::text[])) t),
      'defaults',(select jsonb_agg(to_jsonb(t) order by oid) from pg_default_acl t))`, [namespaces])
  }
  const permissions = async signature => (await db.query(`select e.grantor::regrole::text grantor,
    case when e.grantee=0 then 'PUBLIC' else e.grantee::regrole::text end grantee,
    e.privilege_type,e.is_grantable from pg_proc p cross join lateral aclexplode(p.proacl) e
    where p.oid=$1::regprocedure order by grantee,e.privilege_type,e.grantor,e.is_grantable`, [signature])).rows
  const bodyFrom = marker => {
    const start = normalise(featureSql).indexOf(marker)
    assert.ok(start >= 0, 'exact accepted function body marker exists')
    const bodyStart = normalise(featureSql).indexOf('as $$', start) + 5
    const bodyEnd = normalise(featureSql).indexOf('end $$;', bodyStart) + 3
    assert.ok(bodyStart > start && bodyEnd > bodyStart, 'exact accepted function body delimiters exist')
    return normalise(featureSql).slice(bodyStart, bodyEnd).replace(/^[ \n\t]+|[ \n\t]+$/g, '')
  }
  let inheritedFunctions, inheritedRelations, inheritedRows, inheritedSecurity, installedReceipts
  try {
    eq(sha(normalise(featureSql)), ACCEPTED_SQL_SHA256, 'accepted rc33 feature bytes are frozen, modulo CRLF')
    eq(normalise(migrationSql), normalise(featureSql), 'accepted deployed migration and feature are identical')
    await admin()
    eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'exact disposable owner/database')
    const version = Number(await scalar('show server_version_num'))
    truth(version >= 170000 && version < 180000, 'retained PostgreSQL17 only')
    inheritedRelations = await relations(); inheritedRows = await rows(inheritedRelations)
    inheritedFunctions = await functions(); inheritedSecurity = await security()
    truth(inheritedFunctions.some(f => f.signature === native8), 'accepted proof leaves original native8 present')
    eq(inheritedFunctions.filter(f => [explicit9, classifier].includes(f.signature)), [], 'unchanged accepted proof removed its new signatures')
    phase = 'transactional-accepted-runtime-install'
    await db.query('begin'); begun = true
    await db.query(featureSql)
    const installed = await functions()
    for (const prior of inheritedFunctions) {
      const current = installed.find(f => f.oid === prior.oid)
      truth(current, `${prior.signature}: every inherited OID retained`)
      eq(prior.signature === native8 ? { ...current, definition_hash: prior.definition_hash, source_hash: prior.source_hash } : current,
        prior, `${prior.signature}: only exact native8 body can change; all other definitions/metadata stay exact`)
    }
    eq(installed.filter(f => !inheritedFunctions.some(prior => prior.oid === f.oid)).map(f => f.signature).sort(),
      [explicit9, classifier].sort(), 'exactly two accepted private additions, no other function')
    const owner = String(await scalar("select 'postgres'::regrole::oid"))
    for (const signature of [explicit9, classifier]) {
      const f = installed.find(value => value.signature === signature)
      eq([f.nspname, f.owner, f.prosecdef, f.proconfig, f.provolatile],
        ['bx1_private', owner, true, ['search_path=""'], 'v'], `${signature}: exact private owner/definer/search_path/volatility`)
      eq(f.source_hash, sha(bodyFrom(signature === classifier
        ? 'create function bx1_private.admission_receipt_session'
        : 'create function bx1_private.register_document_receipt')), `${signature}: installed body matches exact frozen accepted source`)
      const expected = [{ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false }]
      if (signature === explicit9) expected.unshift({ grantor: 'postgres', grantee: 'bx1_document_receipt_writer', privilege_type: 'EXECUTE', is_grantable: false })
      eq(await permissions(signature), expected, `${signature}: exact restricted ACL, no extra principal`)
    }
    const wrapper = `begin\n  return bx1_private.register_document_receipt(p_actor,p_session,p_id,p_kind,p_title,p_sha256,p_byte_size,p_mime_type,null::jsonb);\nend`
    eq(installed.find(f => f.signature === native8).source_hash, sha(wrapper), 'native8 is precisely the accepted native-assurance wrapper')
    eq(await relations(), inheritedRelations, 'accepted install creates/changes no relation, column, default, constraint or index')
    eq(await rows(inheritedRelations), inheritedRows, 'accepted install changes zero inherited business/authority/configuration rows')
    eq(await security(), inheritedSecurity, 'accepted install changes zero roles, edges, schemas, ACL/RLS/policies/guards/default grants')
    installedReceipts = installed.filter(f => signatures.includes(f.signature))
    eq(installedReceipts.length, 3, 'exact native8 and two new accepted private functions are installed')
    await db.query('commit'); begun = false
    eq((await functions()).filter(f => signatures.includes(f.signature)), installedReceipts, 'receipt runtime survives installation commit before Stage3 baseline')
    eq(await rows(inheritedRelations), inheritedRows, 'commit preserves every original row')
    console.log(`BX1_ACCEPTED_ADMISSION_RECEIPTS_BASELINE_PASS source=${ACCEPTED_SOURCE} sourceSHA256=${ACCEPTED_SQL_SHA256} assertions=${checks} rows=unchanged relations=unchanged security=unchanged native8=exact-wrapper-and-metadata privateAdditions=exact2 commit=before-stage3-baseline hostedAcceptance=not-proven`)
  } catch (error) {
    primaryFailure = error; error.acceptedAdmissionReceiptsPhase = phase
    throw error
  } finally {
    if (begun) {
      let cleanupFailure
      try {
        await db.query('rollback'); begun = false; await admin()
        eq(await functions(), inheritedFunctions, 'failed inheritance install restores every original function')
        eq(await relations(), inheritedRelations, 'failed inheritance install restores every relation')
        eq(await rows(inheritedRelations), inheritedRows, 'failed inheritance install restores every row')
        eq(await security(), inheritedSecurity, 'failed inheritance install restores all security metadata')
      } catch (error) { cleanupFailure = error }
      if (cleanupFailure) {
        console.error(`BX1_ACCEPTED_ADMISSION_RECEIPTS_RESTORE_FAILED code=${failureCode(cleanupFailure)} primary=${primaryFailure ? 'preserved' : 'none'}`)
        if (primaryFailure) throw primaryFailure
        cleanupFailure.acceptedAdmissionReceiptsPhase = phase; throw cleanupFailure
      }
    }
  }

  const verifyInstalled = async () => {
    const before = checks
    eq((await functions()).filter(f => signatures.includes(f.signature)), installedReceipts,
      'Stage3 retains exact accepted receipt OIDs/definitions/owners/ACL/security/search_path and all metadata')
    return checks - before
  }
  const provePostOverlay = async () => {
    const beforeChecks = checks
    let proofBegun = false, proofFailure, proofPhase = 'post-overlay-baseline'
    const actor = 'ef840000-0000-4000-8000-000000000007'
    const session = 'ef840000-0000-4000-8000-000000000107'
    const factor = 'ef840000-0000-4000-8000-000000000207'
    const doc = { id: 'ef850000-0000-4000-8000-000000000901', kind: 'IDENTITY',
      title: 'Fictional post-overlay receipt metadata only', storage_path: `${actor}/ef850000-0000-4000-8000-000000000901`,
      sha256: 'f'.repeat(64), size: 100, mime_type: 'application/pdf' }
    const objectId = 'ef850000-0000-4000-8000-000000000902'
    const specs = await relations(), beforeRows = await rows(specs)
    const beforeFunctions = await functions(), beforeSecurity = await security()
    const originalSession = await scalar('select to_jsonb(s) from auth.sessions s where s.id=$1 and s.user_id=$2', [session, actor])
    const originalFactors = await scalar("select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from auth.mfa_factors f where f.user_id=$1", [actor])
    const originalLifecycle = beforeRows['bx1_private.document_lifecycle_policy'][0]
    const originalEntry = beforeRows['bx1_portal.entry_configuration'][0]
    const dbClock = () => scalar("select to_jsonb(clock_timestamp()) #>> '{}'")
    const guard = async () => {
      eq(await scalar(`select tgenabled::text from pg_trigger
        where tgrelid='bx1_private.document_lifecycle_policy'::regclass and tgname='bx1_document_lifecycle_activation'`),
      'O', 'original lifecycle activation guard is enabled before every receipt invocation')
    }
    const attestation = () => ({ iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor,
      session_id: session, role: 'authenticated', aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600,
      is_anonymous: false, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 1 }] })
    const receipt = async value => {
      await admin(); await guard()
      await db.query("select set_config('request.jwt.claims','{}',true)")
      await db.query('set local role bx1_document_receipt_writer')
      const result = await scalar(`select bx1_private.register_document_receipt($1::uuid,$2::uuid,$3::uuid,
        $4::text,$5::text,$6::text,$7::integer,$8::text,$9::jsonb)`,
      [actor, session, doc.id, doc.kind, doc.title, doc.sha256, doc.size, doc.mime_type, JSON.stringify(value)])
      eq(await scalar("select current_setting('request.jwt.claims',true)"), '{}', 'explicit receipt never manufactures JWT claims')
      await admin(); return result
    }
    const denied = async (label, run) => {
      await admin(); const oldRows = await rows(specs)
      await db.query('savepoint post_overlay_receipt_denial')
      let outcomeError, unexpectedFailure
      try { await run() } catch (error) {
        outcomeError = error
        if (error?.code !== '42501') unexpectedFailure = error
      }
      try {
        await db.query('rollback to savepoint post_overlay_receipt_denial; release savepoint post_overlay_receipt_denial')
        await admin()
      } catch (cleanupError) {
        console.error(`BX1_ACCEPTED_ADMISSION_RECEIPTS_DENIAL_RESTORE_FAILED code=${failureCode(cleanupError)} primary=${unexpectedFailure ? 'preserved' : 'none'}`)
        throw unexpectedFailure ?? cleanupError
      }
      if (unexpectedFailure) throw unexpectedFailure
      eq(outcomeError?.code, '42501', `${label}: exact authority denial`)
      eq(await rows(specs), oldRows, `${label}: denied receipt changes no row`)
    }
    const policyDenial = async (label, sql, values = []) => {
      await admin(); const oldRows = await rows(specs)
      await db.query('savepoint post_overlay_receipt_policy')
      let policyFailure
      try {
        eq((await db.query(sql, values)).rowCount, 1, `${label}: precisely one existing policy/authority row selected`)
        await denied(label, () => receipt(attestation()))
      } catch (error) {
        policyFailure = error; throw error
      } finally {
        try {
          await db.query('rollback to savepoint post_overlay_receipt_policy; release savepoint post_overlay_receipt_policy')
          await admin()
        } catch (cleanupError) {
          console.error(`BX1_ACCEPTED_ADMISSION_RECEIPTS_POLICY_RESTORE_FAILED code=${failureCode(cleanupError)} primary=${policyFailure ? 'preserved' : 'none'}`)
          throw policyFailure ?? cleanupError
        }
      }
      eq(await rows(specs), oldRows, `${label}: complete original rows restored without compensating writes`)
    }
    const fullRestoration = async () => {
      await admin()
      eq(await relations(), specs, 'rollback restores every exact relation/column/default/constraint/index')
      eq(await rows(specs), beforeRows, 'rollback restores every original row including scanner mode/timestamp and receipt history')
      eq(await functions(), beforeFunctions, 'rollback preserves exact installed global/receipt/Stage3 definitions and metadata')
      eq(await security(), beforeSecurity, 'rollback restores all original roles/grants/RLS/policies/guards and guard O')
      eq(await scalar('select to_jsonb(s) from auth.sessions s where s.id=$1 and s.user_id=$2', [session, actor]),
        originalSession, 'every original AAL1 session field stays exact; no AAL2 staging or session changes')
      eq(await scalar("select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from auth.mfa_factors f where f.user_id=$1", [actor]),
        originalFactors, 'every original enrolled factor field stays exact; none added, removed or changed')
    }
    const inWindow = (value, start, end) => {
      truth(typeof value === 'string' && /T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value), 'generated receipt time has explicit offset')
      truth(Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.parse(start) && Date.parse(value) <= Date.parse(end),
        'generated receipt time lies inside independent database observation window')
    }
    try {
      await verifyInstalled()
      eq([originalSession?.user_id, originalSession?.aal, originalSession?.factor_id], [actor, 'aal1', null],
        'source-derived existing Stage3 actor-seven session is still enrolled AAL1, without native assurance binding')
      eq(originalFactors.filter(f => f.id === factor && f.user_id === actor && f.status === 'verified' && f.factor_type === 'totp').length,
        1, 'same existing source-derived own verified factor is present; no enrollment is simulated here')
      eq(await scalar("select email from auth.users where id=$1 and email_confirmed_at is not null and deleted_at is null and is_anonymous=false", [actor]),
        'offering-workflow-7@example.invalid', 'exact existing Stage3 synthetic account retained')
      eq(await scalar('select status from public.bx1_profiles where id=$1', [actor]), 'ACTIVE', 'existing synthetic profile is active')
      eq(originalLifecycle.mode, 'SCANNER_REQUIRED', 'original post-Stage3 scanner-required policy is retained, not relabelled clean')
      eq([originalEntry.environment, originalEntry.manual_test_review], ['TESTNET', true], 'normal accepted TEST fixture remains explicitly manual')
      eq(beforeRows['storage.objects'].some(row => row.id === objectId || row.name === doc.storage_path), false, 'isolated metadata identity/path is new')
      eq(beforeRows['bx1_private.document_upload_receipts'].some(row => row.id === doc.id), false, 'isolated document receipt identity is new')
      await guard()
      proofPhase = 'rollback-only-synthetic-setup'
      await db.query('begin'); proofBegun = true
      const proofStart = await dbClock()
      // Exact accepted proof149-159 fixture pattern. This owner-only setup is
      // rollback-only and never runs a receipt/business operation with guards
      // disabled. This setup changes no Auth row, factor, session, role or
      // function; the later expiry negative changes only not_after in its own
      // savepoint and rolls that original session row back exactly.
      await db.query('alter table bx1_private.document_lifecycle_policy disable trigger bx1_document_lifecycle_activation')
      await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
      await db.query('alter table bx1_private.document_lifecycle_policy enable trigger bx1_document_lifecycle_activation')
      await db.query("update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton")
      const lifecycleAt = await scalar('select to_jsonb(changed_at) from bx1_private.document_lifecycle_policy where singleton')
      await db.query('update bx1_portal.entry_configuration set test_ordinary_entry_enabled=true where singleton')
      eq(await scalar('select enforced from bx1_private.document_receipt_policy where singleton'), true, 'strict receipt enforcement never changes')
      await guard()
      const metadataObject = { id: objectId, bucket_id: 'bx1-portal-documents', name: doc.storage_path,
        owner_id: actor, metadata: { size: doc.size, mimetype: doc.mime_type }, user_metadata: { sha256: doc.sha256 } }
      await db.query(`insert into storage.objects(id,bucket_id,name,owner_id,metadata,user_metadata)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [objectId, metadataObject.bucket_id, metadataObject.name, actor, JSON.stringify(metadataObject.metadata), JSON.stringify(metadataObject.user_metadata)])
      proofPhase = 'deployed-nine-argument-positive'
      eq(await receipt(attestation()), { ...doc, actor_id: actor, validation_state: 'SYNTHETIC_UNSCANNED' },
        'deployed nine-argument path accepts exact enrolled AAL1 TEST metadata without native-session promotion')
      const positiveRows = await rows(specs), proofEnd = await dbClock()
      for (const [name, original] of Object.entries(beforeRows)) {
        const current = positiveRows[name]
        if (name === 'bx1_private.document_lifecycle_policy') eq(current,
          [{ ...original[0], mode: 'SYNTHETIC_TEST_ONLY', changed_at: lifecycleAt }], 'only exact temporary lifecycle mode/time differ')
        else if (name === 'bx1_portal.entry_configuration') eq(current,
          [{ ...original[0], test_ordinary_entry_enabled: true }], 'only exact temporary TEST entry flag differs')
        else if (name === 'storage.objects') {
          eq(current.filter(row => row.id !== objectId), original, 'every inherited Storage metadata row stays exact')
          eq(current.filter(row => row.id === objectId), [metadataObject], 'exactly one input-derived fictional metadata object is added')
        } else if (name === 'bx1_private.document_upload_receipts') {
          eq(current.filter(row => row.id !== doc.id), original, 'every inherited receipt row stays exact')
          const added = current.filter(row => row.id === doc.id)
          eq(added.length, 1, 'exactly one new input-bound synthetic receipt')
          const receiptRow = added[0]
          eq({ ...receiptRow, verified_at: undefined }, { id: doc.id, actor_id: actor, session_id: session,
            storage_path: doc.storage_path, kind: doc.kind, title: doc.title, sha256: doc.sha256, byte_size: doc.size,
            mime_type: doc.mime_type, validation_state: 'SYNTHETIC_UNSCANNED', verified_at: undefined }, 'receipt contains precisely expected input fields')
          inWindow(receiptRow.verified_at, proofStart, proofEnd)
        } else if (name === 'bx1_private.document_receipt_events') {
          eq(current.filter(row => row.receipt_id !== doc.id), original, 'every inherited receipt event stays exact')
          const events = current.filter(row => row.receipt_id === doc.id)
          eq(events.length, 1, 'exactly one registration event; no binding/application/audit invention')
          eq({ ...events[0], id: undefined, created_at: undefined }, { id: undefined, receipt_id: doc.id,
            application_id: null, application_revision: null, kind: 'REGISTERED', created_at: undefined }, 'new event equals exact registration intent')
          truth(Number.isSafeInteger(events[0].id) && events[0].id > 0, 'registration event has independently generated positive identity')
          inWindow(events[0].created_at, proofStart, proofEnd)
        } else eq(current, original, `no ${name} row changes or blanket footprint exceptions`)
      }
      eq(await functions(), beforeFunctions, 'positive receipt leaves every installed function exact')
      eq(await security(), beforeSecurity, 'positive receipt runs with every original guard/security setting')
      proofPhase = 'post-overlay-authority-denials'
      await denied('attestation principal mismatch', () => receipt({ ...attestation(), sub: 'ef840000-0000-4000-8000-000000000006' }))
      await policyDenial('current profile authority suspended', "update public.bx1_profiles set status='SUSPENDED' where id=$1", [actor])
      await policyDenial('current native session expired', 'update auth.sessions set not_after=clock_timestamp()-interval \'1 second\' where id=$1 and user_id=$2', [session, actor])
      await policyDenial('MAIN cannot inherit TEST receipt admission', "update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false,test_ordinary_entry_enabled=false where singleton")
      await policyDenial('scanner-required lifecycle denies TEST receipt admission', "update bx1_private.document_lifecycle_policy set mode='SCANNER_REQUIRED' where singleton")
      proofPhase = 'complete-original-state-restoration'
      await db.query('rollback'); proofBegun = false
      await fullRestoration()
      // Verify the restored SCANNER_REQUIRED policy actually denies the same
      // attested path, not only that the catalog row looks restored.
      await db.query('begin'); proofBegun = true
      await denied('restored scanner-required guard denies explicit TEST receipt', () => receipt(attestation()))
      await db.query('rollback'); proofBegun = false
      await fullRestoration(); await verifyInstalled()
      console.log(`BX1_ACCEPTED_ADMISSION_RECEIPTS_POST_OVERLAY_PASS assertions=${checks - beforeChecks} source=${ACCEPTED_SOURCE} transport=explicit-trusted-server-metadata-fiction enrolledAAL1=preserved factorMutation=none sessionAssurance=unchanged sessionExpiry=rollback-only-denied-and-restored positive=exact-nine-argument mismatchedAuthority=denied suspendedAuthority=denied MAIN=denied scannerRequired=denied footprint=one-object-one-receipt-one-event cleanup=full-rollback-and-exact-rows-definitions-security identitySequence=nontransactional-allocation-not-rollback authGetUser=not-proven documentBytes=not-proven providerAcceptance=not-proven hostedAcceptance=not-proven`)
      return checks - beforeChecks
    } catch (error) {
      proofFailure = error; error.acceptedAdmissionReceiptsPhase = proofPhase
      throw error
    } finally {
      let cleanupFailure
      if (proofBegun || proofFailure) {
        try {
          if (proofBegun) { await db.query('rollback'); proofBegun = false }
          await fullRestoration()
        } catch (error) { cleanupFailure = error }
      }
      if (cleanupFailure) {
        console.error(`BX1_ACCEPTED_ADMISSION_RECEIPTS_POST_OVERLAY_CLEANUP_FAILED code=${failureCode(cleanupFailure)} primary=${proofFailure ? 'preserved' : 'none'}`)
        if (proofFailure) throw proofFailure
        cleanupFailure.acceptedAdmissionReceiptsPhase = proofPhase; throw cleanupFailure
      }
    }
  }
  return { checks, verifyInstalled, provePostOverlay }
}
