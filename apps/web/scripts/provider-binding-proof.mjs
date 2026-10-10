import assert from 'node:assert/strict'

const writer = 'bx1_provider_evidence_writer'
const bindSignature = 'bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text)'
const eventSignature = 'bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean,text,text)'
const oldSignatures = [
  'bx1_private.bind_provider_application(uuid,uuid,uuid,integer)',
  'bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean)',
]
const tables = ['provider_application_bindings', 'provider_evidence_events', 'provider_applicant_pins', 'provider_boundary_receipts']
function requireFixture() {
  if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.BX1_PORTAL_SQL_TEST_URL !== 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    throw new Error('Provider binding proof requires exact disposable cloud fixture')
}

// Shared source/schema contract, including sealed MAIN. Does not activate a provider.
export async function proveProviderBindingDefaultAcl(db) {
  requireFixture()
  let checks = 0
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
  await db.query('reset role')
  eq(await scalar("select current_database()='bx1_demo_ci' and current_user='postgres'"), true, 'provider ACL proof stays in disposable owner fixture')
  eq(await scalar(`select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
    and not rolcreaterole and not rolreplication and not rolbypassrls from pg_roles where rolname=$1`, [writer]), true,
  'provider writer remains constrained NOLOGIN')
  eq(await scalar('select count(*)::int from pg_auth_members where member=(select oid from pg_roles where rolname=$1)', [writer]), 0,
    'provider writer has no inherited or SET-capable outgoing memberships')
  for (const table of tables) {
    eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`bx1_private.${table}`]), true, `${table} has RLS`)
    for (const role of ['anon', 'authenticated', 'service_role', writer])
      eq(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
        [role, `bx1_private.${table}`]), false, `${role} has no direct ${table} access`)
  }
  for (const signature of [bindSignature, eventSignature]) {
    eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [writer, signature]), true, `writer has narrow ${signature}`)
    for (const role of ['anon', 'authenticated', 'service_role'])
      eq(await scalar("select has_function_privilege($1,$2,'EXECUTE')", [role, signature]), false, `${role} cannot invoke ${signature}`)
  }
  for (const signature of [...oldSignatures, 'bx1_private.project_provider_evidence(uuid)'])
    eq(await scalar(`select not exists(select 1 from pg_proc p cross join lateral
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=$1::regprocedure and a.grantee<>p.proowner)`, [signature]), true, `${signature} is owner-only including PUBLIC`)
  eq(await scalar(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and has_function_privilege($1,p.oid,'EXECUTE')
      and p.oid<>all($2::regprocedure[])`, [writer, [bindSignature, eventSignature]]), 0,
  'provider writer has exactly two private function grants')
  eq(await scalar("select has_function_privilege('authenticated','public.bx1_provider_evidence_read(uuid)','EXECUTE')"), true, 'authenticated normalized read survives cutover')
  for (const role of ['anon', 'service_role', writer])
    eq(await scalar("select has_function_privilege($1,'public.bx1_provider_evidence_read(uuid)','EXECUTE')", [role]), false, `${role} has no public provider reader`)
  return checks
}

// Called BEFORE the final pure handoff transaction. Owns bounded transactions,
// commits feature + synthetic race fixtures before two other backend clients,
// and leaves the installed schema for the unchanged document-processing proof.
export async function proveProviderBinding(db, clients, featureSql, subjectAvailabilitySql) {
  requireFixture()
  assert.equal(clients.length, 2, 'provider pin race requires two independent clients')
  let checks = 0, sequence = 0, begun = false
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const truth = (value, label) => { assert.ok(value, label); checks++ }
  const scalar = async (sql, params = [], client = db) => Object.values((await client.query(sql, params)).rows[0])[0]
  const id = n => `eb760000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const oldActor = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const oldSession = n => `e2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
  const clientId = 'synthetic-qualified-sandbox-client'
  const individualLevel = 'Synthetic-Individual-Level', companyLevel = 'Synthetic-Company-Level'
  const admin = (client = db) => client.query('reset role')
  const begin = async () => { await db.query('begin'); begun = true; await admin() }
  const commit = async () => { await admin(); await db.query('commit'); begun = false }
  const asWriter = async (sql, params, client = db) => {
    await admin(client); await client.query(`set local role ${writer}`)
    return scalar(sql, params, client)
  }
  const bindSql = 'select bx1_private.bind_provider_application($1,$2,$3,$4,$5,$6,$7)'
  const eventSql = 'select bx1_private.record_provider_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)'
  const fixtureRevisions = new Map()
  const bind = (n, revision = fixtureRevisions.get(n), levels = [individualLevel, companyLevel, clientId]) =>
    asWriter(bindSql, [id(n), id(100 + n), id(200 + n), revision, ...levels])
  const claims = async (actor, session, extra = {}, client = db) => {
    await admin(client)
    await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor,
      session_id: session, role: 'authenticated', aal: 'aal1',
      iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })])
    await client.query('set local role authenticated')
  }
  const read = async (n, extra = {}) => { await claims(id(n), id(100 + n), extra); return scalar('select public.bx1_provider_evidence_read($1)', [id(200 + n)]) }
  const denied = async (label, action, expectedCode = '23514') => {
    await admin(); await db.query('savepoint provider_binding_denial')
    let code
    try { await action() } catch (error) { code = error?.code }
    await db.query('rollback to savepoint provider_binding_denial; release savepoint provider_binding_denial'); await admin()
    eq(code, expectedCode, `${label}: observed ${code ?? 'no error'}`)
  }
  const probe = async action => {
    await admin(); await db.query('savepoint provider_binding_probe')
    try { await action() } finally { await db.query('rollback to savepoint provider_binding_probe; release savepoint provider_binding_probe'); await admin() }
  }
  const legacyRows = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'bindings',(select jsonb_agg(to_jsonb(b)-array['expected_applicant_type','expected_level_name','expected_client_id','source_version_revision'] order by id)
        from bx1_private.provider_application_bindings b),
      'events',(select jsonb_agg(to_jsonb(e)-array['applicant_type','level_name'] order by id) from bx1_private.provider_evidence_events e))`)
  }
  const providerCounts = async () => {
    await admin()
    return scalar(`select jsonb_build_object('bindings',(select count(*) from bx1_private.provider_application_bindings),
      'events',(select count(*) from bx1_private.provider_evidence_events),
      'pins',(select count(*) from bx1_private.provider_applicant_pins),
      'audit',(select count(*) from bx1_private.provider_boundary_receipts))`)
  }
  const providerSnapshot = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'bindings',(select jsonb_agg(to_jsonb(b) order by id) from bx1_private.provider_application_bindings b),
      'events',(select jsonb_agg(to_jsonb(e) order by id) from bx1_private.provider_evidence_events e),
      'pins',(select jsonb_agg(to_jsonb(p) order by binding_id) from bx1_private.provider_applicant_pins p),
      'audit',(select jsonb_agg(to_jsonb(r) order by id) from bx1_private.provider_boundary_receipts r))`)
  }
  const businessFingerprint = async () => {
    await admin()
    const relations = (await db.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and (n.nspname='bx1_portal' or (n.nspname='public' and c.relname like 'bx1_%')) order by n.nspname,c.relname`)).rows
    const result = {}
    for (const { nspname, relname } of relations) {
      assert.match(nspname, /^[a-z0-9_]+$/); assert.match(relname, /^[a-z0-9_]+$/)
      result[`${nspname}.${relname}`] = await scalar(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) from ${nspname}.${relname} t`)
    }
    return result
  }
  const now = Date.now()
  const at = seconds => new Date(now + seconds * 1000).toISOString()
  const hash = () => (++sequence).toString(16).padStart(64, '0')
  const event = (binding, seconds, override = {}) => {
    const value = { applicantId: `synthetic-genuine-${binding.application_id}`, type: 'applicantReviewed',
      correlation: 'synthetic-signed-event', time: at(seconds), payload: hash(), semantic: hash(),
      status: 'completed', answer: 'GREEN', reject: null, manual: false, sandbox: true,
      kind: binding.expected_applicant_type, level: binding.expected_level_name, client: clientId, ...override }
    return [binding.external_user_id, value.applicantId, value.type, value.correlation, value.client,
      value.time, value.payload, value.semantic, value.status, value.answer, value.reject, value.manual,
      value.sandbox, value.kind, value.level]
  }
  const send = (args, client = db) => asWriter(eventSql, args, client)
  try {
    await begin()
    const historical = await legacyRows(), beforeInstall = await businessFingerprint()
    await db.query(featureSql)
    eq(await legacyRows(), historical, 'qualification cutover preserves every historical provider scalar')
    eq(await businessFingerprint(), beforeInstall, 'feature installation leaves every business row unchanged')
    checks += await proveProviderBindingDefaultAcl(db)
    for (const signature of oldSignatures)
      await denied(`old unqualified ${signature} rejects even owner`, () => scalar(signature.includes('bind_')
        ? 'select bx1_private.bind_provider_application(null,null,null,null)'
        : 'select bx1_private.record_provider_evidence(null,null,null,null,null,null,null,null,null,null,null,null,null)'), '55000')
    eq(await scalar('select count(*)::int from bx1_private.provider_boundary_receipts'), 0, 'legacy records receive no fabricated audit')
    for (let n = 1; n <= 9; n++) {
      await admin()
      await db.query('insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,clock_timestamp(),false)', [id(n), `synthetic-qualified-${n}@example.invalid`])
      await db.query("insert into auth.sessions(id,user_id,not_after,created_at) values($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 hour')", [id(100 + n), id(n)])
      // The guarded receipt-binding BEFORE UPDATE trigger needs its parent
      // application to exist. Create only a DRAFT, before any document work.
      const draftRevision = await scalar(`insert into bx1_portal.applications
        (id,user_id,persona,status,details,reviewer_scope,provider_mode,origin)
        values($1,$2,$3,'DRAFT','{}'::jsonb,$4,'UNASSIGNED','SELF_SERVICE') returning revision`,
      [id(200 + n), id(n), n === 3 ? 'WEALTH_MANAGER' : 'INVESTOR', scope])
      fixtureRevisions.set(n, draftRevision)
      eq(draftRevision, 1, `subject ${n}: empty DRAFT parent starts at revision 1`)
      eq(await scalar('select count(*)::int from bx1_portal.application_detail_versions where application_id=$1', [id(200 + n)]), 0,
        `subject ${n}: parent creation fabricates no immutable submission`)
      const documents = []
      for (const [i, kind] of (n === 2 || n === 3 ? ['IDENTITY', 'COMPANY', 'BENEFICIAL_OWNERS'] : ['IDENTITY']).entries()) {
        const documentId = id(500 + n * 10 + i), path = `${id(n)}/${documentId}`, digest = 'd'.repeat(64)
        const title = `Synthetic provider subject ${kind}`
        // Existing guarded scanner RPCs construct disposable fixture receipts;
        // no accepted source/trigger/policy is disabled or rewritten.
        await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
          values('bx1-portal-quarantine',$1,'{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',$2::text))`, [path, digest])
        const receipt = await scalar('select bx1_private.register_quarantined_document($1,$2,$3,$4,$5,$6,25,\'application/pdf\')',
          [id(n), id(100 + n), documentId, kind, title, digest])
        await scalar('select bx1_private.record_document_scan($1,$2,\'synthetic-provider-fixture-scanner\',$3,\'CLEAN\',clock_timestamp())',
          [documentId, digest, `synthetic-provider-fixture-${documentId}`])
        await db.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
          values('bx1-portal-documents',$1,'{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',$2::text))`, [path, digest])
        await scalar('select bx1_private.promote_scanned_document($1)', [documentId])
        documents.push({ id: receipt.id, kind, title, storage_path: path, sha256: digest, size: 25, mime_type: 'application/pdf' })
      }
      const common = { full_name: `Synthetic Qualified Applicant ${n}`, country: 'ZA', documents, test_data_acknowledged: true }
      const company = { company_name: n === 3 ? 'Synthetic Wealth Manager' : 'Synthetic Entity',
        registration_reference: `SYNTHETIC-${n}`, beneficial_owners: 'One fictional beneficial owner disclosed solely for cloud fixture checks.' }
      const ownership = { details_version: 3, ownership_change_reason: 'Initial fictional ownership evidence for provider qualification proof.',
        ownership_control: [{ id: id(700 + n), party_type: 'PERSON', legal_name: 'Synthetic Beneficial Owner', registration_reference: '',
          country: 'ZA', relationship: 'DIRECT_OWNER', ownership_basis_points: 10000,
          control_basis: 'Fictional direct shareholding for the disposable provider fixture.', effective_on: '2026-09-01',
          change_reason: 'Initial fictional ownership qualification for cloud proof.', evidence_document_id: documents.at(-1).id }] }
      const details = n === 3 ? { ...common, ...company, ...ownership,
        business_activities: 'Fictional wealth-manager operations for provider qualification only.',
        representative_position: 'Fictional representative', authority_basis: 'Fictional appointment, not signing or platform authority.' }
        : { ...common, investor_type: n === 2 ? 'ENTITY' : 'INDIVIDUAL',
          company_name: '', registration_reference: '', beneficial_owners: '',
          source_of_funds: 'Fictional savings only. No real money is represented in the cloud fixture.',
          experience: 'Fictional investing experience for provider qualification checks.',
          ...(n === 2 ? { ...company, ...ownership } : {}) }
      if (n === 8) delete details.investor_type
      const submit = async () => {
        await claims(id(n), id(100 + n))
        return scalar('select public.bx1_entry_command($1,$2::uuid,$3::jsonb)',
          ['submit_application', id(800 + n), JSON.stringify({ application_id: id(200 + n), expected_revision: draftRevision, details })])
      }
      if ([1, 2, 3, 4, 6].includes(n)) {
        const submitted = (await submit()).applications.find(a => a.id === id(200 + n))
        eq([submitted?.status, submitted?.revision], ['SUBMITTED', draftRevision + 1],
          `subject ${n}: typed guarded entry command submits DRAFT revision 1 as revision 2`)
        fixtureRevisions.set(n, submitted.revision)
        await admin()
        eq(await scalar(`select count(*)::int from bx1_portal.application_detail_versions v
          join bx1_portal.applications a on a.id=v.application_id
          where a.id=$1 and v.application_revision=a.revision and v.capture_kind='SUBMISSION'
            and v.details=a.details and v.submitted_at=a.submitted_at`, [id(200 + n)]), 1,
        `subject ${n}: unchanged capture trigger records one exact immutable SUBMISSION`)
        eq(await scalar('select count(*)::int from bx1_private.document_application_bindings where application_id=$1 and application_revision=$2',
          [id(200 + n), submitted.revision]), documents.length,
        `subject ${n}: scanned receipts bind only after the DRAFT parent exists`)
        eq(await scalar('select count(*)::int from bx1_portal.entry_requests where actor_id=$1 and request_key=$2', [id(n), id(800 + n)]), 1,
          `subject ${n}: guarded submission owns one typed command receipt`)
        if (n === 2 || n === 3) {
          eq(submitted.details.details_version, 3, `subject ${n}: ENTITY/wealth-manager submission retains valid v3 evidence`)
          eq(await scalar('select count(*)::int from bx1_portal.application_ownership_control_versions where application_id=$1 and application_revision=$2',
            [id(200 + n), submitted.revision]), 1, `subject ${n}: unchanged ownership capture records the exact v3 submitted revision`)
        }
      } else if (n === 8) {
        await denied('malformed subject cannot pass the typed entry submission command', submit, '22023')
        // Expressly malformed owner-only NEGATIVE fixture. Neither the typed
        // command nor any provider writer can create this state. The unchanged
        // capture trigger, not a manual version INSERT, freezes these details.
        await claims(id(n), id(100 + n)); await admin()
        await db.query(`update bx1_portal.applications set details=$2::jsonb,status='SUBMITTED',
          revision=revision+1,submitted_at=clock_timestamp() where id=$1`, [id(200 + n), JSON.stringify(details)])
        fixtureRevisions.set(n, await scalar('select revision from bx1_portal.applications where id=$1', [id(200 + n)]))
        eq(fixtureRevisions.get(n), 2, 'malformed owner-only negative fixture freezes revision 2 without bypassing capture guards')
        eq(await scalar(`select count(*)::int from bx1_portal.application_detail_versions v
          join bx1_portal.applications a on a.id=v.application_id where a.id=$1
          and v.application_revision=a.revision and v.capture_kind='SUBMISSION'
          and v.details=a.details and v.submitted_at=a.submitted_at`, [id(200 + n)]), 1,
          'malformed negative source version comes only from unchanged submission capture trigger')
        eq(await scalar('select count(*)::int from bx1_portal.entry_requests where actor_id=$1 and request_key=$2', [id(n), id(800 + n)]), 0,
          'malformed owner-only negative fixture is not represented as an accepted typed entry command')
      } else {
        await claims(id(n), id(100 + n)); await admin()
        await scalar('select bx1_portal.validate_application($1::jsonb,\'INVESTOR\')', [JSON.stringify(details)])
        await db.query('update bx1_portal.applications set details=$2::jsonb where id=$1', [id(200 + n), JSON.stringify(details)])
        eq(await scalar('select count(*)::int from bx1_portal.application_detail_versions where application_id=$1', [id(200 + n)]), 0,
          `subject ${n}: valid editable DRAFT details are not an immutable submission`)
      }
    }
    // A synthetic current-scope organisation binding enables an explicit
    // revoked/expired appointment check, not production customer admission.
    await db.query("insert into bx1_portal.organisations(id,application_id,owner_id,name,reviewer_scope) values($1,$2,$3,'Synthetic provider proof organisation',$4)", [id(300), id(203), id(3), scope])
    await db.query('update bx1_portal.applications set organisation_id=$1 where id=$2', [id(300), id(203)])
    await db.query(`insert into bx1_portal.organisation_authority_bindings(id,product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id)
      values($1,$2,$3,'ComplianceOfficer','ACTIVE',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','Synthetic provider read appointment only',$4)`, [id(301), id(300), scope, id(302)])
    await commit() // feature and all race fixtures visible to both clients

    await begin()
    const businessBefore = await businessFingerprint()
    // Preserve already-qualified individual bindings across the additive body
    // replacement; company bindings below are new post-cutover insertions.
    await bind(1); await bind(4)
    const beforeSubjectCutover = await providerSnapshot()
    const bindingMetadata = () => scalar(`select jsonb_build_object('oid',p.oid::text,
      'owner',p.proowner::regrole::text,'acl',p.proacl::text,'security_definer',p.prosecdef,
      'config',p.proconfig) from pg_proc p where p.oid=$1::regprocedure`, [bindSignature])
    const metadataBeforeSubjectCutover = await bindingMetadata()
    await db.query(subjectAvailabilitySql)
    eq(await bindingMetadata(), metadataBeforeSubjectCutover, 'subject cutover preserves exact function OID/owner/ACL/security/search path')
    eq(await providerSnapshot(), beforeSubjectCutover, 'subject cutover preserves every legacy/qualified provider row and receipt')
    eq(await businessFingerprint(), businessBefore, 'subject cutover preserves every business row')
    checks += await proveProviderBindingDefaultAcl(db)
    const bindings = []
    for (const n of [1, 2, 3, 4]) bindings.push(await bind(n, fixtureRevisions.get(n),
      n === 2 || n === 3 ? [null, companyLevel, clientId] : [individualLevel, null, clientId]))
    eq(bindings.map(b => [b.expected_applicant_type, b.expected_level_name, b.expected_client_id, b.source_version_revision]),
      [['individual', individualLevel, clientId, 2], ['company', companyLevel, clientId, 2], ['company', companyLevel, clientId, 2], ['individual', individualLevel, clientId, 2]],
    'three subject variants bind exact selected levels with their unused level NULL')
    eq((await bind(1)).binding_id, bindings[0].binding_id, 'exact qualified binding retry is idempotent')
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.provider_boundary_receipts where source_kind=\'SERVER_BINDING\''), 4, 'one machine binding receipt per binding including retry')
    await probe(async () => {
      const individualOnly = await bind(6, fixtureRevisions.get(6), [individualLevel, null, clientId])
      eq([individualOnly.expected_applicant_type, individualOnly.expected_level_name], ['individual', individualLevel],
        'new individual binding needs no company capability')
    })
    const beforeLevelDenials = await providerSnapshot()
    for (const invalid of [null, '', ' ', ` ${individualLevel}`, `${companyLevel} `, 'invalid\nlevel', 'x'.repeat(121)]) {
      await denied('selected individual NULL/invalid level denied', () => bind(1, fixtureRevisions.get(1), [invalid, null, clientId]), '22023')
      await denied('selected company NULL/invalid level denied', () => bind(2, fixtureRevisions.get(2), [null, invalid, clientId]), '22023')
    }
    for (const unused of [null, '', 'Changed-Unused-Level', 'invalid\nunused', 'x'.repeat(121)]) {
      eq((await bind(1, fixtureRevisions.get(1), [individualLevel, unused, clientId])).binding_id, bindings[0].binding_id,
        'unused company availability/config drift cannot alter individual binding')
      eq((await bind(2, fixtureRevisions.get(2), [unused, companyLevel, clientId])).binding_id, bindings[1].binding_id,
        'unused individual availability/config drift cannot alter company binding')
    }
    eq(await providerSnapshot(), beforeLevelDenials, 'selected-level denials and unused-level retries create no rows or receipts')
    await denied('individual config drift cannot rewrite binding', () => bind(1, fixtureRevisions.get(1), ['Changed-Level', companyLevel, clientId]))
    await denied('case-sensitive level drift is denied', () => bind(1, fixtureRevisions.get(1), [individualLevel.toLowerCase(), companyLevel, clientId]))
    await denied('client drift cannot rewrite binding', () => bind(1, fixtureRevisions.get(1), [individualLevel, companyLevel, 'other-client']))
    await denied('wrong actor cannot bind another subject', () => asWriter(bindSql, [id(2), id(102), id(201), fixtureRevisions.get(1), individualLevel, companyLevel, clientId]), '42501')
    await denied('wrong revision is denied', () => bind(1, fixtureRevisions.get(1) + 1), '42501')
    await denied('draft must submit first', () => bind(5), '42501')
    await probe(async () => { await db.query("update bx1_portal.applications set status='CHANGES_REQUIRED' where id=$1", [id(205)]); await denied('changes-required must resubmit first', () => bind(5), '42501') })
    await denied('unsupported immutable subject fails closed', () => bind(8))
    await probe(async () => {
      await claims(id(7), id(107)); await admin()
      await db.query("update bx1_portal.applications set status='SUBMITTED' where id=$1", [id(207)])
      eq(await scalar('select count(*)::int from bx1_portal.application_detail_versions where application_id=$1', [id(207)]), 0,
        'status-only owner negative fixture does not fabricate immutable source history')
      await denied('submitted label without snapshot is denied', () => bind(7))
    })
    await admin()
    const migrationSnapshot = (await db.query(`select a.id,a.user_id,a.revision,a.status,a.admission_purpose,
      v.capture_kind,v.application_revision as source_revision,s.id as session_id
      from bx1_portal.application_detail_versions v join bx1_portal.applications a on a.id=v.application_id
      join auth.sessions s on s.user_id=a.user_id where v.capture_kind='MIGRATION_SNAPSHOT' and a.status<>'SUBMITTED'
        and bx1_private.provider_session_current(a.user_id,s.id)
      order by a.id,v.application_revision,s.id limit 1`)).rows[0]
    truth(migrationSnapshot, 'prior application-admission feature supplies an actual migration-generated historical snapshot')
    eq(migrationSnapshot.capture_kind, 'MIGRATION_SNAPSHOT', 'historical migration source is read as captured, never manually inserted or relabelled')
    await denied('actual migration-captured historical application is not admitted as current SUBMITTED evidence; capture-kind denial alone is not isolated',
      () => asWriter(bindSql, [migrationSnapshot.user_id, migrationSnapshot.session_id, migrationSnapshot.id,
        migrationSnapshot.revision, individualLevel, companyLevel, clientId]), '42501')
    const countsBefore = await providerCounts(), snapshotBeforeAuditFailure = await providerSnapshot()
    await probe(async () => {
      await db.query(`create function public.synthetic_provider_audit_failure() returns trigger language plpgsql as $$
        begin raise exception 'synthetic_required_provider_audit_failure' using errcode='23514'; end $$;
        create trigger synthetic_provider_audit_failure before insert on bx1_private.provider_boundary_receipts
        for each row execute function public.synthetic_provider_audit_failure()`)
      await denied('required binding audit failure rolls back binding', () => bind(6))
      await denied('required signed-event audit failure rolls back event and first pin', () => send(event(bindings[1], 1)))
      eq(await providerCounts(), countsBefore, 'audit failure preserves bindings/events/pins/receipt counts')
      eq(await providerSnapshot(), snapshotBeforeAuditFailure, 'required audit failure preserves every binding/event/pin/audit scalar')
      eq(await businessFingerprint(), businessBefore, 'audit failure preserves complete business fingerprints')
    })
    const b = bindings[0]
    const manualFirst = await send(event(b, 1, { manual: true, applicantId: 'synthetic-manual-poison' }))
    eq([manualFirst.ordering_state, manualFirst.projection_state], ['MANUAL_TEST', 'MANUAL_TEST'], 'manual-first cannot advance ordering')
    await admin()
    eq(await scalar('select count(*)::int from bx1_private.provider_applicant_pins where binding_id=$1', [b.binding_id]), 0, 'manual-first never pins identity')
    const genuineArgs = event(b, 2), green = await send(genuineArgs)
    eq([green.evidence_kind, green.projection_state, green.ordering_state], ['COMPLETED_REVIEW', 'EFFECTIVE', 'CURRENT'], 'genuine reviewed GREEN is provider review evidence only')
    const beforeRetry = await providerCounts(), snapshotBeforeRetry = await providerSnapshot()
    eq((await send(genuineArgs)).id, green.id, 'exact replay returns same immutable event')
    const semanticReplay = [...genuineArgs]; semanticReplay[6] = hash()
    eq([ (await send(semanticReplay)).id, (await send(semanticReplay)).duplicate ], [green.id, true], 'semantic replay with different raw encoding deduplicates')
    eq(await providerCounts(), beforeRetry, 'exact and semantic retries create no event/pin/audit')
    eq(await providerSnapshot(), snapshotBeforeRetry, 'exact and semantic retries preserve every immutable provider scalar')
    for (const [index, value, label] of [[1, 'synthetic-wrong-genuine', 'ID'], [4, 'wrong-client', 'client'], [13, 'company', 'kind'], [14, individualLevel.toLowerCase(), 'level']]) {
      const wrong = [...genuineArgs]; wrong[index] = value
      await denied(`qualification and pin ${label} checked before duplicate acknowledgement`, () => send(wrong))
    }
    for (const [index, value] of [[2, 'applicantPending'], [3, 'changed-correlation'], [5, at(3)], [8, 'pending'], [9, 'RED'], [11, true]]) {
      const conflict = [...genuineArgs]; conflict[index] = value
      if (index === 9) conflict[10] = 'FINAL'
      await denied(`exact hash replay compares immutable scalar ${index}`, () => send(conflict))
    }
    const changedSemantic = [...genuineArgs]; changedSemantic[7] = hash()
    await denied('exact payload replay cannot substitute semantic digest', () => send(changedSemantic))
    for (const index of [0, 1, 2, 4, 5, 6, 7, 11, 12, 13, 14]) {
      const malformed = event(b, 3); malformed[index] = null
      await denied(`required nullable scalar ${index} fails closed`, () => send(malformed), index === 12 ? '42501' : '22023')
    }
    await denied('unadmitted workflow/action event family fails closed', () => send(event(b, 3, { type: 'applicantActionReviewed' })), '22023')
    await denied('infinite provider timestamp fails closed', () => send(event(b, 3, { time: 'infinity' })), '22023')
    await denied('future timestamp outside bounded skew fails closed', () => send(event(b, 600)), '22023')
    await denied('completed review without answer fails closed', () => send(event(b, 3, { answer: null })), '22023')
    await denied('GREEN must have no rejection type', () => send(event(b, 3, { reject: 'FINAL' })), '22023')
    await denied('RED requires RETRY or FINAL', () => send(event(b, 3, { answer: 'RED', reject: null })), '22023')
    const lifecycle = await send(event(b, 4, { type: 'applicantPending' }))
    eq([lifecycle.evidence_kind, lifecycle.projection_state], ['LIFECYCLE', 'EFFECTIVE'], 'pending carrying completed GREEN stays lifecycle')
    eq((await read(1)).find(e => e.id === green.id).projection_state, 'SUPERSEDED', 'latest genuine lifecycle supersedes old GREEN')
    const reordered = await send(event(b, 3, { type: 'applicantCreated' }))
    eq([reordered.ordering_state, reordered.projection_state], ['STALE', 'SUPERSEDED'], 'reordered older event is retained as superseded history')
    const tied = await send(event(b, 4, { type: 'applicantReset' }))
    eq([tied.ordering_state, tied.projection_state], ['STALE', 'CONFLICT'], 'equal-time distinct event is retained as explicit conflict')
    const conflictRows = (await read(1)).filter(e => [lifecycle.id, tied.id].includes(e.id))
    eq(conflictRows.map(e => e.projection_state), ['CONFLICT', 'CONFLICT'], 'delivery order cannot choose an effective tied event')
    eq((await read(1)).filter(e => e.ordering_state === 'CURRENT').length, 0, 'conflict suppresses all effective outcomes')
    const redRetry = await send(event(b, 5, { answer: 'RED', reject: 'RETRY' }))
    eq([redRetry.evidence_kind, redRetry.projection_state], ['COMPLETED_REVIEW', 'EFFECTIVE'], 'later unambiguous RED RETRY resolves tie as completed review evidence')
    const redFinal = await send(event(b, 6, { answer: 'RED', reject: 'FINAL' }))
    eq(redFinal.evidence_kind, 'COMPLETED_REVIEW', 'completed RED FINAL is normalized separately from lifecycle')
    for (const [n, type] of [[2, 'applicantDeactivated'], [3, 'applicantDeleted']]) {
      const currentBinding = bindings[n - 1]
      const original = await send(event(currentBinding, 7))
      await send(event(currentBinding, 8, { type, manual: true, applicantId: 'synthetic-manual-removal' }))
      eq((await read(n)).find(e => e.id === original.id).projection_state, 'EFFECTIVE', `manual ${type} cannot invalidate genuine GREEN`)
      const invalidator = await send(event(currentBinding, 9, { type }))
      eq([invalidator.evidence_kind, invalidator.projection_state], ['LIFECYCLE', 'EFFECTIVE'], `genuine ${type} invalidates apparent completion`)
      eq((await read(n)).find(e => e.id === original.id).projection_state, 'SUPERSEDED', `old GREEN is history after genuine ${type}`)
    }
    await claims(oldActor(2), oldSession(2), { aal: 'aal2' })
    truth((await scalar('select public.bx1_provider_evidence_read($1)', [id(203)])).length > 0, 'current scoped reviewer reads normalized company evidence')
    await denied('unrelated reviewer organisation denied', async () => {
      await claims(oldActor(5), oldSession(5), { aal: 'aal2' }); await scalar('select public.bx1_provider_evidence_read($1)', [id(203)])
    }, '42501')
    await probe(async () => {
      await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [id(301)])
      await denied('revoked exact organisation appointment denies old-scope-only reviewer', async () => {
        await claims(oldActor(2), oldSession(2), { aal: 'aal2' }); await scalar('select public.bx1_provider_evidence_read($1)', [id(203)])
      }, '42501')
    })
    await probe(async () => {
      await db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1", [id(301)])
      await db.query(`insert into bx1_portal.organisation_authority_bindings(id,product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,evidence_reference,approval_receipt_id)
        values($1,$2,$3,'ComplianceOfficer','ACTIVE',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour','Synthetic expired provider read appointment',$4)`, [id(303), id(300), scope, id(304)])
      await denied('expired exact organisation appointment denies historical reviewer scope', async () => {
        await claims(oldActor(2), oldSession(2), { aal: 'aal2' }); await scalar('select public.bx1_provider_evidence_read($1)', [id(203)])
      }, '42501')
    })
    await denied('another applicant cannot read', async () => { await claims(id(2), id(102)); await scalar('select public.bx1_provider_evidence_read($1)', [id(201)]) }, '42501')
    await denied('wrong environment issuer cannot read', () => read(1, { iss: 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' }), '42501')
    await probe(async () => {
      await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [id(101)])
      await denied('expired session cannot bind', () => bind(1), '42501')
      await denied('expired session cannot read', () => read(1), '42501')
    })
    await probe(async () => {
      await db.query('delete from auth.sessions where id=$1', [id(101)])
      await denied('revoked session cannot bind', () => bind(1), '42501')
      await denied('revoked session cannot read', () => read(1), '42501')
    })
    await probe(async () => {
      await db.query('insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,\'verified\',\'totp\')', [id(401), id(1)])
      await denied('enrolled factor cannot use AAL1 binding', () => bind(1), '42501')
      await denied('enrolled factor cannot use AAL1 reader', () => read(1), '42501')
    })
    await probe(async () => {
      await claims(id(1), id(101)); await admin()
      await db.query('update bx1_portal.applications set revision=revision+1 where id=$1', [id(201)])
      eq(await scalar('select revision from bx1_portal.applications where id=$1', [id(201)]), 3,
        'old-revision negative fixture advances the guarded submission revision 2 to application revision 3')
      const late = await send(event(b, 10, { type: 'applicantPending', status: 'pending', answer: null }))
      eq([late.ordering_state, late.projection_state], ['STALE', 'REVISION_STALE'], 'old-revision signed delivery remains historical')
      eq((await read(1)).filter(e => e.ordering_state === 'CURRENT').length, 0, 'old revision cannot provide effective completion')
    })
    await probe(async () => {
      await db.query("update bx1_portal.entry_configuration set environment='MAINNET',manual_test_review=false where singleton")
      await denied('MAIN provider session remains sealed', () => bind(1), '42501')
      await denied('MAIN signed write remains sealed', () => send(event(b, 10)), '42501')
    })
    const legacyApp = await scalar('select application_id from bx1_private.provider_evidence_events where applicant_type is null limit 1')
    truth(legacyApp, 'retained original provider proof supplies legacy evidence')
    const legacyActor = await scalar('select user_id from bx1_portal.applications where id=$1', [legacyApp])
    const legacySession = await scalar('select id from auth.sessions where user_id=$1 limit 1', [legacyActor])
    await claims(legacyActor, legacySession)
    const legacy = await scalar('select public.bx1_provider_evidence_read($1)', [legacyApp])
    truth(legacy.every(e => e.applicant_type === null && e.level_name === null && e.evidence_kind === 'LEGACY_UNQUALIFIED'
      && e.projection_state === 'LEGACY_UNQUALIFIED' && e.ordering_state === 'STALE'), 'legacy GREEN has no guessed qualification or effective completion')
    const normalized = await read(1)
    truth(normalized.every(e => !Object.hasOwn(e, 'provider_applicant_id') && !Object.hasOwn(e, 'raw_payload')
      && !Object.hasOwn(e, 'token') && !Object.hasOwn(e, 'provider_client_id')), 'normalized reader exposes no raw provider identity, payload, token or private comment')
    await denied('qualified binding cannot be rewritten', async () => { await admin(); await db.query("update bx1_private.provider_application_bindings set expected_level_name='rewritten' where id=$1", [b.binding_id]) })
    await denied('signed event cannot be rewritten', async () => { await admin(); await db.query("update bx1_private.provider_evidence_events set review_answer='RED' where id=$1", [green.id]) })
    await denied('machine boundary receipt cannot be deleted', async () => { await admin(); await db.query('delete from bx1_private.provider_boundary_receipts where binding_id=$1', [b.binding_id]) })
    await denied('identity pin cannot be rewritten', async () => { await admin(); await db.query("update bx1_private.provider_applicant_pins set provider_applicant_id='changed-pin-id' where binding_id=$1", [b.binding_id]) })
    eq(await businessFingerprint(), businessBefore, 'all provider operations preserve full application/role/account/mandate/money/business rows')
    await commit()

    const pids = await Promise.all(clients.map(client => scalar('select pg_backend_pid()', [], client)))
    truth(pids[0] !== pids[1], 'first-ID race uses two different PostgreSQL backend PIDs')
    const raceBinding = bindings[3]
    await clients[0].query('begin'); await clients[1].query('begin')
    try {
      const first = await send(event(raceBinding, 11, { applicantId: 'synthetic-first-genuine-race-A' }), clients[0])
      const waiting = send(event(raceBinding, 12, { applicantId: 'synthetic-first-genuine-race-B' }), clients[1])
        .then(result => ({ result }), error => ({ code: error?.code }))
      let overlapped = false
      for (let attempt = 0; attempt < 100; attempt++) {
        overlapped = await scalar(`select exists(select 1 from pg_stat_activity
          where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid)))`, [pids[1], pids[0]])
        if (overlapped) break
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      truth(overlapped, 'competing first-ID backend genuinely overlaps and waits on the first transaction lock')
      await clients[0].query('commit')
      eq(await waiting, { code: '23514' }, 'serialized competing first genuine ID is denied after winner commit')
      await clients[1].query('rollback')
      await begin()
      eq(await scalar('select provider_applicant_id from bx1_private.provider_applicant_pins where binding_id=$1', [raceBinding.binding_id]), 'synthetic-first-genuine-race-A', 'committed genuine pin records winner only')
      eq(await scalar('select count(*)::int from bx1_private.provider_evidence_events where binding_id=$1', [raceBinding.binding_id]), 1, 'race loser inserts no event')
      eq(await scalar("select count(*)::int from bx1_private.provider_boundary_receipts where binding_id=$1 and source_kind='SIGNED_WEBHOOK'", [raceBinding.binding_id]), 1, 'race loser inserts no machine audit')
      eq((await read(4)).find(e => e.id === first.id).projection_state, 'EFFECTIVE', 'single race winner projects through same SQL authority')
      eq(await businessFingerprint(), businessBefore, 'overlapped first-ID race leaves all business records unchanged')
      await commit()
    } finally {
      await Promise.all(clients.map(client => client.query('rollback').catch(() => {})))
      await Promise.all(clients.map(client => client.query('reset role').catch(() => {})))
    }
    // Only this module's synthetic appointment/session/factor is revoked.
    // Accepted fixture participants and authority helpers are untouched.
    const beforeReadRaces = await businessFingerprint()
    const authorityRows = async () => scalar(`select jsonb_agg(
      case when b.id=$1 then to_jsonb(b)-'status' else to_jsonb(b) end order by id)
      from bx1_portal.organisation_authority_bindings b`, [id(301)])
    const otherAuthRows = async () => scalar(`select jsonb_build_object(
      'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),
      'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s where id<>$1),
      'factors',(select jsonb_agg(to_jsonb(f) order by id) from auth.mfa_factors f where id<>$2))`, [id(101), id(405)])
    const beforeAuthorityRows = await authorityRows(), beforeOtherAuthRows = await otherAuthRows()
    const providerBeforeReadRaces = await providerSnapshot()
    const blockerPid = await scalar('select pg_backend_pid()')
    truth(blockerPid !== pids[0], 'evidence-read races use separate blocker and reader backend PIDs')
    const proveReadBoundaryRace = async (label, applicationId, actorId, sessionId, extra, revoke) => {
      await begin()
      await claims(actorId, sessionId, extra)
      truth((await scalar('select public.bx1_provider_evidence_read($1)', [applicationId])).length > 0,
        `${label}: live actor is authorized and has evidence before the wait`)
      await admin()
      await db.query('lock table bx1_private.provider_evidence_events in access exclusive mode')
      const interruptedRead = (async () => {
        await clients[0].query('begin')
        try {
          await claims(actorId, sessionId, extra, clients[0])
          const result = await scalar('select public.bx1_provider_evidence_read($1)', [applicationId], clients[0])
          await clients[0].query('commit')
          return { result }
        } catch (error) {
          await clients[0].query('rollback')
          return { code: error?.code }
        } finally { await clients[0].query('reset role') }
      })()
      try {
        let blockedAfterAuthorization = false
        for (let attempt = 0; attempt < 100; attempt++) {
          blockedAfterAuthorization = await scalar(`select exists(select 1 from pg_locks
            where pid=$1 and relation='bx1_private.provider_evidence_events'::regclass
              and mode='AccessShareLock' and not granted and $2=any(pg_blocking_pids(pid)))`, [pids[0], blockerPid])
          if (blockedAfterAuthorization) break
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        truth(blockedAfterAuthorization,
          `${label}: reader has passed initial authorization and observably waits on the evidence relation held by the other backend`)
        const mutation = await revoke()
        eq(mutation.rowCount, 1, `${label}: exactly one owned synthetic assurance record changes`)
        await commit() // revocation becomes visible before aggregation resumes
        const deniedRead = await interruptedRead
        eq(deniedRead, { code: '42501' }, `${label}: final boundary denies the whole cached-authority response`)
        eq(Object.hasOwn(deniedRead, 'result'), false, `${label}: no evidence is returned after revocation`)
      } finally {
        if (begun) { await db.query('rollback'); begun = false }
        await interruptedRead
      }
    }
    await proveReadBoundaryRace('exact-organisation appointment revoked during evidence-read wait', id(203),
      oldActor(2), oldSession(2), { aal: 'aal2' }, () =>
        db.query("update bx1_portal.organisation_authority_bindings set status='REVOKED' where id=$1 and status='ACTIVE'", [id(301)]))
    await proveReadBoundaryRace('own synthetic session revoked during evidence-read wait', id(201),
      id(1), id(101), {}, () => db.query('delete from auth.sessions where id=$1', [id(101)]))
    await proveReadBoundaryRace('new verified factor invalidates AAL1 during evidence-read wait', id(202),
      id(2), id(102), {}, () => db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [id(405), id(2)]))
    await admin()
    eq(await providerSnapshot(), providerBeforeReadRaces, 'blocked evidence reads and assurance revocations mutate no provider binding/event/pin/audit scalar')
    eq(await authorityRows(), beforeAuthorityRows, 'read races change only the declared synthetic appointment status')
    eq(await otherAuthRows(), beforeOtherAuthRows, 'read races preserve every other Auth user/session/factor')
    eq(await scalar('select status from bx1_portal.organisation_authority_bindings where id=$1', [id(301)]), 'REVOKED',
      'only this module synthetic appointment is left revoked, without weakening its one-way guard')
    const afterReadRaces = await businessFingerprint()
    for (const [relation, fingerprint] of Object.entries(beforeReadRaces)) {
      if (relation !== 'bx1_portal.organisation_authority_bindings')
        eq(afterReadRaces[relation], fingerprint, `blocked evidence read races preserve ${relation}`)
    }
    console.log(`BX1_PROVIDER_BINDING_PASS assertions=${checks} fixture=synthetic-cloud-PostgreSQL17 qualification=immutable projection=single-SQL-authority firstIdRace=two-overlapped-backend-PIDs readBoundaryRaces=observed-appointment-session-MFA-waits auditRollback=proven providerAcceptance=not-proven`)
    return checks
  } finally { if (begun) { await admin().catch(() => {}); await db.query('rollback').catch(() => {}) } }
}
