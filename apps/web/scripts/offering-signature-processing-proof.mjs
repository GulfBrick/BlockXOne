import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

// DISPOSABLE CLOUD SQL MODEL ONLY. No HTTP, human signature, independent human,
// provider audit taxonomy, hosted storage or Stage3 acceptance is asserted here.
// Called inside the document proof's transaction while its two genuinely scanned
// manifests are current. The entire overlay/fixture is rolled back to a savepoint.
const actor = n => `ef840000-0000-4000-8000-${String(n).padStart(12, '0')}`
const person = n => `ef850000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = '0ba2b126-bd85-4cfb-9a1d-83633c9def1e'
const worker = 'synthetic-offering-signature-worker'
const schemas = ['auth', 'storage', 'public', 'bx1_private', 'bx1_portal']
const digest = value => createHash('sha256').update(value).digest('hex')
const normalized = value => value.replace(/\r\n/g, '\n').replace(/^[ \n\t]+|[ \n\t]+$/g, '')
const context = (role, organisationId = scope) => ({ mode: 'ROLE', organisationId, role })
const attestation = n => {
  const timestamp = Math.floor(Date.now() / 1000)
  return { iss: 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1', sub: actor(n), session_id: actor(100 + n),
    role: 'authenticated', aal: 'aal1', exp: timestamp + 3600, is_anonymous: false,
    amr: [{ method: 'password', timestamp }] }
}

export async function proveOfferingSignatures(db, clients, featureSql, fixture) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.BX1_PORTAL_SQL_TEST_URL, 'postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
  assert.equal(process.platform, 'linux')
  assert.equal(clients.length, 2)
  for (const client of [db, ...clients]) {
    assert.equal(client.connectionParameters.statement_timeout, 15000)
    assert.equal(client.connectionParameters.query_timeout, 20000)
  }
  assert.equal(fixture.products.length, 2)
  const products = fixture.products.map(item => item.p ?? item)
  assert.deepEqual(products.map(p => p.terms.asset_type).sort(), ['FUND', 'REAL_ESTATE'])
  const manager = fixture.manager
  let checks = 0, sequence = 0, overlayOpen = false, failure
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
  const truth = (actual, label) => { assert.ok(actual, label); checks++ }
  const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0]
  const admin = async () => { await db.query('reset role'); eq(await scalar('select current_user'), 'postgres', 'exact fixture owner') }
  const as = async role => {
    assert.ok(['authenticated', 'anon', 'service_role', 'bx1_document_receipt_writer', 'bx1_offering_signature_worker'].includes(role))
    await admin(); await db.query(`set local role ${role}`)
  }
  const relations = async () => {
    await admin()
    return (await db.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p') and n.nspname=any($1) order by 1,2`, [schemas])).rows
  }
  const rows = async specs => {
    await admin()
    const clauses = specs.map(({ nspname, relname }) => {
      assert.match(nspname, /^[a-z0-9_]+$/); assert.match(relname, /^[a-z0-9_]+$/)
      return `select '${nspname}.${relname}' name,count(*)::int count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') hash from ${nspname}.${relname} t`
    })
    return (await db.query(clauses.join(' union all ') + ' order by name')).rows
  }
  const functions = async () => {
    await admin()
    return (await db.query(`select oid::text,oid::regprocedure::text signature,to_jsonb(p) catalog from pg_proc p
      where pronamespace in (select oid from pg_namespace where nspname=any($1)) order by oid`, [schemas])).rows
  }
  const catalog = async () => {
    await admin()
    return scalar(`select jsonb_build_object(
      'roles',(select jsonb_agg(to_jsonb(t) order by oid) from pg_roles t),
      'memberships',(select jsonb_agg(to_jsonb(t) order by roleid,member,grantor) from pg_auth_members t),
      'namespaces',(select jsonb_agg(to_jsonb(t) order by oid) from pg_namespace t),
      'classes',(select jsonb_agg(to_jsonb(t) order by oid) from (select oid,relname,relnamespace,relkind,relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class
        where relnamespace in (select oid from pg_namespace where nspname=any($1))) t),
      'policies',(select jsonb_agg(to_jsonb(t) order by oid) from pg_policy t),
      'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t),
      'constraints',(select jsonb_agg(to_jsonb(t) order by oid) from pg_constraint t),
      'defaults',(select jsonb_agg(to_jsonb(t) order by oid) from pg_default_acl t),
      'settings',(select jsonb_agg(to_jsonb(t) order by setdatabase,setrole) from pg_db_role_setting t),
      'extensions',(select jsonb_agg(to_jsonb(t) order by oid) from pg_extension t),
      'event_triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_event_trigger t))`, [schemas])
  }
  const isolated = async run => {
    await admin(); const name = `signature_case_${++sequence}`
    await db.query(`savepoint ${name}`)
    try { return await run() } finally { await db.query(`rollback to savepoint ${name};release savepoint ${name}`); await admin() }
  }
  let installedSpecs
  const denied = async (label, run, code = '42501') => {
    const before = await rows(installedSpecs), beforeFunctions = await functions(), beforeCatalog = await catalog()
    let error
    await isolated(async () => { try { await run() } catch (caught) { error = caught } })
    truth(error, `${label}: actual rejection`); eq(error.code, code, `${label}: exact SQLSTATE`)
    eq(await rows(installedSpecs), before, `${label}: every row projection preserved`)
    eq(await functions(), beforeFunctions, `${label}: every function preserved`)
    eq(await catalog(), beforeCatalog, `${label}: complete security catalog preserved`)
  }
  const actorCall = async (n, c, p, action, extra = {}, key = randomUUID()) => {
    await as('bx1_document_receipt_writer')
    return scalar('select bx1_private.execute_offering_signature_command($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb)',
      [actor(n), actor(100 + n), 'aal1', JSON.stringify(c), action, key, JSON.stringify({ product_id: p.id,
        offering_revision_id: p.current_offering_revision_id, expected_revision: p.revision, ...extra }), JSON.stringify(attestation(n))])
  }
  const read = async (p, n = 1, c = manager) => {
    await as('bx1_document_receipt_writer')
    return scalar('select bx1_private.read_offering_signatures($1,$2,$3,$4::jsonb,$5,$6::jsonb)',
      [actor(n), actor(100 + n), 'aal1', JSON.stringify(c), p.current_offering_revision_id, JSON.stringify(attestation(n))])
  }
  const claim = async () => { await as('bx1_offering_signature_worker'); return scalar('select bx1_private.claim_offering_signature_action($1,$2)', [worker, randomUUID()]) }
  const workerRead = async lease => { await as('bx1_offering_signature_worker'); return scalar('select bx1_private.read_offering_signature_action($1,$2,$3,$4)', [worker, lease.operation_id, lease.lease_id, lease.generation]) }
  const record = async (lease, action, result, key = randomUUID()) => {
    await as('bx1_offering_signature_worker')
    return scalar('select bx1_private.record_offering_signature_action($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [worker, lease.operation_id, lease.lease_id, lease.generation, key, action, JSON.stringify(result)])
  }
  const age = async operation => {
    await admin()
    await db.query("update bx1_private.offering_signature_operations set lease_expires_at=clock_timestamp()-interval '1 second',next_check_at=clock_timestamp()-interval '1 second' where id=$1", [operation])
  }
  const consume = async (lease, action, extra = {}) => {
    const request = randomUUID(), body = { phase: 'INFLIGHT', ...extra }
    eq((await record(lease, action, body, request)).can_perform, true, 'first durable checkpoint grants one provider call')
    eq((await record(lease, action, body, request)).can_perform, false, 'same request never reauthorises provider HTTP')
    eq((await record(lease, action, body)).can_perform, false, 'fresh request cannot bypass consumed resource group')
  }
  const source = 'SYNTHETIC-CLOUD-PURPOSE: fictional issuer appointment source; no live mandate.'
  const seedPeople = async (collision = false) => {
    for (const n of [1, 2, 3]) {
      await admin()
      eq(await scalar('select count(*)::int from bx1_private.person_principals where auth_user_id=$1', [actor(n)]), 0, 'fixture mapping starts absent')
      await db.query("insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:signature-proof-only',$3)", [person(n), `FICTIONAL SQL signature actor ${n}`, person(100 + n)])
      await db.query("insert into bx1_private.person_principals(auth_user_id,person_id,status,evidence_reference,bootstrap_receipt_id) values($1,$2,'TRUSTED','fictional:signature-proof-only',$3)", [actor(n), person(collision && n === 2 ? 1 : n), person(200 + n)])
    }
  }
  const requestPurpose = async p => {
    await admin()
    const appointment = await scalar("select id from bx1_portal.product_service_appointments where product_id=$1 and role='IssuerFundManager' and appointee_user_id=$2 and status='APPLIED'", [p.id, actor(3)])
    truth(appointment, 'existing canonically applied issuer appointment')
    const state = await actorCall(1, manager, p, 'REQUEST_PURPOSE', { appointment_id: appointment,
      valid_from: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 86400000).toISOString(),
      source_reference: source, source_sha256: digest(source) })
    return state.authorisations.at(-1).id
  }
  const approvePurpose = async (p, id) => actorCall(2, context('ComplianceOfficer'), p, 'REVIEW_PURPOSE', {
    authorisation_id: id, decision: 'APPROVED', reason: 'Synthetic independently mapped TEST purpose decision, not offering approval.' })
  const prepare = async (p, id) => {
    const state = await actorCall(3, context('IssuerFundManager'), p, 'PREPARE_EXECUTION', { authorisation_id: id })
    const operation = state.operations.find(op => op.authorisation_id === id)
    truth(operation, 'one prepared durable operation'); return operation.id
  }
  const archive = async (lease, kind, label) => {
    if (kind !== 'COVER_ORIGINAL') await consume(lease, 'ARTIFACT_RESERVED', { kind })
    const bytes = Buffer.from(`%PDF-1.4\nSYNTHETIC SQL EVIDENCE ${label}\n%%EOF\n`)
    const identity = { sha256: digest(bytes), size: bytes.length }
    const reserved = await record(lease, 'ARTIFACT_RESERVED', { kind, ...identity })
    const after = await workerRead(lease), artifact = after.artifacts.find(a => a.id === reserved.artifact_id)
    eq(artifact.path, `testnet/${lease.revision_id}/${lease.operation_id}/${artifact.id}.pdf`, 'SQL derives exact immutable reservation path')
    // Model an independently verified object, never assert hosted Storage here.
    eq(digest(Buffer.from(bytes)), identity.sha256, 'separate synthetic byte readback matches source')
    await record(lease, 'ARTIFACT_RETAINED', { artifact_id: artifact.id, ...identity })
    return artifact
  }
  const send = async lease => {
    await archive(lease, 'COVER_ORIGINAL', 'original cover')
    const create = JSON.stringify({ transactionId: lease.operation_id, status: 'sent', recipientsLock: 'true', allowReassign: 'false',
      allowMarkup: 'false', enableWetSign: 'false', documents: ['1', '2', '3', '4'].map(documentId => ({ documentId,
        documentBase64: Buffer.from('%PDF-1.4\nSYNTHETIC\n%%EOF\n').toString('base64') })),
      recipients: { signers: [{ clientUserId: actor(3), email: lease.signer.email, name: lease.signer.name, recipientId: '1' }] } })
    eq((await record(lease, 'CREATE_RESULT', { phase: 'INFLIGHT', create_request: create, create_request_sha256: digest(create) })).can_perform,
      true, 'durable exact create checkpoint grants one outbound create')
    const persisted = await workerRead(lease)
    eq(persisted.create_request, create, 'exact outbound request persisted before network model')
    return create
  }
  const completionEvidence = lease => {
    const evidenceValues = { envelope: { envelopeId: lease.envelope_id, status: 'completed' }, recipients: { signers: [{ recipientId: '1', clientUserId: actor(3), email: lease.signer.email, status: 'completed' }] },
      documents: { envelopeDocuments: ['1', '2', '3', '4'].map(documentId => ({ documentId })) }, custom_fields: { textCustomFields: [] },
      audit_events: { auditEvents: ['Sent', 'Signed', 'Completed'].map(value => ({ eventFields: [{ name: 'Action', value }, { name: 'logTime', value: new Date().toISOString() }] })) },
      tabs: { signHereTabs: [{ documentId: '4', tabLabel: 'bx1_issuer_execution' }] } }
    return JSON.stringify(Object.fromEntries(Object.entries(evidenceValues).map(([key, value]) => [key, {
      value, sha256: digest(JSON.stringify(value)), observedAt: Date.now(),
    }])))
  }
  const complete = async operation => {
    await age(operation); const lease = await claim(); eq(lease.operation_id, operation, 'same durable operation reconciled')
    await consume(lease, 'RECONCILE_RESULT')
    const evidence = completionEvidence(lease)
    await denied('digest alone does not retain authenticated evidence', () => record(lease, 'RECONCILE_RESULT', {
      status: 'COMPLETED', envelope_id: lease.envelope_id, integrity_verified: true, evidence_sha256: digest(evidence),
      next_check_at: new Date(Date.now() + 901000).toISOString(),
    }), '22023')
    await denied('wrong audit payload digest rejected', () => record(lease, 'RECONCILE_RESULT', {
      status: 'COMPLETED', envelope_id: lease.envelope_id, integrity_verified: true, evidence_sha256: 'f'.repeat(64), evidence_json: evidence,
      next_check_at: new Date(Date.now() + 901000).toISOString(),
    }), '22023')
    await record(lease, 'RECONCILE_RESULT', { status: 'COMPLETED', envelope_id: lease.envelope_id,
      integrity_verified: true, evidence_sha256: digest(evidence), evidence_json: evidence, next_check_at: new Date(Date.now() + 901000).toISOString() })
    const retention = await claim(); eq(retention.action, 'RETAIN', 'observed completion requires separate archival')
    await denied('partial archival cannot finalize', () => record(retention, 'EVIDENCE_FINALIZED', {
      integrity_verified: true, evidence_sha256: digest(evidence),
    }), '23514')
    await denied('oversized signed artifact remains unretained', () => record(retention, 'ARTIFACT_RESERVED', {
      kind: 'MEMORANDUM_SIGNED', sha256: digest('synthetic oversize'), size: 4194305,
    }), '22023')
    for (const kind of ['MEMORANDUM_SIGNED', 'RISKS_SIGNED', 'SUBSCRIPTION_TERMS_SIGNED', 'COVER_SIGNED', 'CERTIFICATE']) await archive(retention, kind, kind)
    return { retention, result: await record(retention, 'EVIDENCE_FINALIZED', { integrity_verified: true, evidence_sha256: digest(evidence) }) }
  }
  const publicCommand = async (p, n, c, action, decision) => {
    await admin()
    const r = await scalar('select to_jsonb(r) from bx1_portal.offering_revisions r where id=$1', [p.current_offering_revision_id])
    const current = await scalar('select to_jsonb(p) from bx1_portal.products p where id=$1', [p.id])
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(attestation(n))]); await as('authenticated')
    return scalar('select public.bx1_portal_command_scoped($1,$2,$3::jsonb,$4::jsonb)', [action, randomUUID(), JSON.stringify({
      product_id: p.id, expected_revision: current.revision, offering_revision_id: r.id, terms_hash: r.terms_hash,
      common_envelope_hash: r.common_envelope_hash, deployment_configuration_hash: r.deployment_configuration_hash, decision,
      notes: 'Synthetic evidence-bound existing reviewer handoff; not an actual human/provider signature.',
      checks: n === 3 ? { issuer_authority: true, terms: true, rights: true } : { issuer: true, terms: true, disclosures: true, eligibility: true },
    }), JSON.stringify(c)])
  }
  const originalSpecs = await relations(), originalRows = await rows(originalSpecs), originalFunctions = await functions(), originalCatalog = await catalog()
  try {
    await admin(); await db.query('savepoint signature_overlay_proof'); overlayOpen = true
    await db.query(featureSql); installedSpecs = await relations()
    eq(installedSpecs.length - originalSpecs.length, 9, 'exact nine additional tables')
    const installedFunctions = await functions(), installedCatalog = await catalog()
    const recipes = JSON.parse(featureSql.match(/\$signature_recipes\$([\s\S]*?)\$signature_recipes\$/)[1])
    eq(recipes.length, 5, 'exact five historical source cutovers')
    eq(installedFunctions.length - originalFunctions.length, 14, 'exact fourteen new functions')
    for (const old of originalFunctions) {
      const current = installedFunctions.find(row => row.oid === old.oid)
      truth(current, 'every existing OID survives')
      const recipe = recipes.find(row => row.signature === old.signature)
      if (recipe) {
        eq(digest(normalized(old.catalog.prosrc)), recipe.source_hash, 'exact source pin')
        eq(digest(normalized(current.catalog.prosrc)), recipe.result_hash, 'independently derived result pin')
        const strip = ({ prosrc, ...rest }) => rest
        eq(strip(current.catalog), strip(old.catalog), 'every existing function metadata/ACL field preserved')
      } else eq(current, old, 'unlisted historical function byte-identical')
    }
    const additions = installedFunctions.filter(row => !originalFunctions.some(old => old.oid === row.oid))
    for (const fn of additions) {
      eq(fn.catalog.prosecdef, true, 'private security-definer entry'); eq(fn.catalog.proconfig, ['search_path=""'], 'empty search path')
      eq(fn.catalog.provolatile, 'v', 'fresh authority checks')
      const grants = await scalar(`select array_agg(case when a.grantee=0 then 'PUBLIC' else r.rolname::text end order by case when a.grantee=0 then 'PUBLIC' else r.rolname::text end)
        from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_roles r on r.oid=a.grantee where p.oid=$1::oid`, [fn.oid])
      const expected = ['postgres']
      if (/\.(read_offering_signatures|execute_offering_signature_command)\(/.test(fn.signature)) expected.push('bx1_document_receipt_writer')
      if (/\.(claim|read|record)_offering_signature_action\(/.test(fn.signature)) expected.push('bx1_offering_signature_worker')
      eq(grants, expected.sort(), 'exact function-only recipients')
    }
    await admin()
    eq(await scalar("select jsonb_build_object('state',state,'authority_epoch',authority_epoch,'worker_id',worker_id) from bx1_private.offering_signature_policy"),
      { state: 'NOT_ADMITTED', authority_epoch: 1, worker_id: null }, 'closed admission defaults')
    eq((await read(products[0])).admitted, false, 'client sees default-off capability')
    await denied('closed worker', claim)
    for (const role of ['anon', 'authenticated', 'service_role', 'bx1_document_receipt_writer', 'bx1_offering_signature_worker']) {
      for (const table of installedSpecs.filter(t => !originalSpecs.some(old => old.nspname === t.nspname && old.relname === t.relname))) {
        await admin()
        eq(await scalar('select has_table_privilege($1,$2,$3)', [role, `${table.nspname}.${table.relname}`, 'SELECT,INSERT,UPDATE,DELETE']), false, 'no direct private table grant')
        eq(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`${table.nspname}.${table.relname}`]), true, 'RLS defense in depth')
      }
    }
    eq(await scalar("select count(*)::int from pg_policy where polname like 'offering_signature_%_restrict' and not polpermissive and polroles=array[0::oid]"), 4, 'four native restrictive PUBLIC-only bucket policies')
    await admin(); await db.query("update bx1_private.offering_signature_policy set state='ADMITTED',authority_epoch=2,worker_id=$1 where singleton", [worker])
    await denied('missing trusted mappings never inferred', () => requestPurpose(products[0]))
    await isolated(async () => {
      await seedPeople(true)
      const id = await requestPurpose(products[0])
      await denied('two accounts sharing one TRUSTED person cannot independently authorise', () => approvePurpose(products[0], id))
    })
    await seedPeople()
    for (const p of products) {
      await isolated(async () => {
        const id = await requestPurpose(p)
        await admin()
        const sourceRow = await scalar('select to_jsonb(a) from bx1_private.offering_signature_authorisations a where id=$1', [id])
        truth(sourceRow.appointment_receipt_id, 'purpose binds appointment approval receipt, never offering approval')
        eq(await scalar('select count(*)::int from bx1_portal.offering_decisions where offering_revision_id=$1 and decision=$2', [p.current_offering_revision_id, 'APPROVED']), 0, 'purpose can precede offering approval')
        await denied('wrong issuer cannot approve own purpose', () => actorCall(3, context('IssuerFundManager'), p, 'REVIEW_PURPOSE', { authorisation_id: id, decision: 'APPROVED', reason: 'Synthetic forbidden self-purpose approval.' }))
        await approvePurpose(p, id)
        const operation = await prepare(p, id), again = await prepare(p, id)
        eq(again, operation, 'permanent operation dedupe across distinct command keys')
        await denied('offering approval cannot precede retained evidence', () => publicCommand(p, 3, context('IssuerFundManager'), 'review_offering_issuer', 'APPROVED'), '23514')
        let lease = await claim(); eq(lease.operation_id, operation, 'worker claims exact prepared operation'); eq(lease.action, 'PREPARE', 'first action prepares immutable cover')
        await isolated(async () => {
          const blockedUntil = new Date(Date.now() + 3600000).toISOString()
          await record(lease, 'RECOVERY_REQUIRED', { reason: 'PROVIDER_THROTTLED', evidence_sha256: null, next_check_at: blockedUntil })
          await actorCall(1, manager, p, 'REQUEST_RECOVERY', { operation_id: operation, reason: 'Synthetic recovery before any committed create request must keep the same operation.' })
          await admin()
          eq(await scalar("select jsonb_build_object('state',state,'next_action',next_action,'request',create_request,'envelope',envelope_id) from bx1_private.offering_signature_operations where id=$1", [operation]),
            { state: 'PREPARED', next_action: 'PREPARE', request: null, envelope: null }, 'pre-send recovery can prepare only when no durable create/envelope exists')
          eq(await claim(), null, 'pre-send recovery still respects provider deadline')
          await age(operation); const resumed = await claim()
          eq(resumed.operation_id, operation, 'pre-send recovery never replaces permanent identity')
          eq(resumed.action, 'PREPARE', 'pre-send recovery does not require nonexistent frozen request')
        })
        await denied('wrong lease rejected', () => workerRead({ ...lease, lease_id: randomUUID() }))
        await denied('premature finalization rejected', () => record(lease, 'EVIDENCE_FINALIZED', { integrity_verified: true, evidence_sha256: digest('synthetic') }), '23514')
        await send(lease)
        await isolated(async () => {
          await admin()
          await db.query("update bx1_private.offering_signature_operations set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [operation])
          eq(await claim(), null, 'crash after durable create checkpoint cannot poll before reserved 900 seconds')
          await denied('expired create lease cannot record success', () => record(lease, 'CREATE_RESULT', {
            phase: 'SENT', envelope_id: randomUUID(), evidence_sha256: digest('late stale lease'),
          }))
        })
        await denied('blind second create checkpoint rejected', () => record(lease, 'CREATE_RESULT', { phase: 'INFLIGHT', create_request: '{}', create_request_sha256: digest('{}') }), '23514')
        const envelope = randomUUID()
        await record(lease, 'CREATE_RESULT', { phase: 'SENT', envelope_id: envelope, evidence_sha256: digest('synthetic create response') })
        eq(await claim(), null, 'persisted polling deadline prevents immediate background request')
        const viewKey = randomUUID()
        const view = await actorCall(3, context('IssuerFundManager'), p, 'REQUEST_SIGNING_VIEW', { operation_id: operation }, viewKey)
        truth(view.action, 'fresh same-actor view is a leased synchronous intent')
        eq(await claim(), null, 'background cannot claim VIEW action')
        const viewLease = await workerRead(view.action)
        await consume(viewLease, 'SIGNING_VIEW_RESULT')
        await isolated(async () => {
          await record(viewLease, 'SIGNING_VIEW_RESULT', { outcome: 'UNKNOWN', url_sha256: null, expires_at: null,
            next_check_at: new Date(Date.now() + 3600000).toISOString() })
          await denied('fresh VIEW key cannot bypass provider recipient-view throttle', () => actorCall(3, context('IssuerFundManager'), p,
            'REQUEST_SIGNING_VIEW', { operation_id: operation }))
        })
        await record(viewLease, 'SIGNING_VIEW_RESULT', { outcome: 'CREATED', url_sha256: digest('synthetic ephemeral URL digest only'), expires_at: new Date(Date.now() + 240000).toISOString() })
        eq((await actorCall(3, context('IssuerFundManager'), p, 'REQUEST_SIGNING_VIEW', { operation_id: operation }, viewKey)).action, undefined, 'VIEW replay never returns URL or regenerates lease')
        await isolated(async () => {
          await age(operation); const polling = await claim()
          await admin()
          await db.query("update bx1_private.offering_signature_operations set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [operation])
          eq(await claim(), null, 'crashed reconciliation reserves resource polling before HTTP')
          await denied('generation forgery rejected', () => workerRead({ ...polling, generation: polling.generation + 1 }))
        })
        const done = await complete(operation)
        eq(done.result.current, true, `${p.terms.asset_type}: complete synthetic archival is current`)
        await denied('terminal retained evidence cannot queue unprocessable reconciliation', () => actorCall(3, context('IssuerFundManager'), p,
          'REQUEST_RECONCILIATION', { operation_id: operation }), '23514')
        await isolated(async () => {
          await actorCall(1, manager, p, 'REVOKE_PURPOSE', { authorisation_id: id, reason: 'Synthetic revocation after evidence retention preserves historical files.' })
          await admin(); eq(await scalar('select next_action from bx1_private.offering_signature_operations where id=$1', [operation]), 'NONE', 'revoking retained evidence queues no impossible VOID')
        })
        const snapshot = await read(p)
        eq(snapshot.operations.find(op => op.id === operation).artifacts.length, 6, 'original cover + four signed PDFs + certificate distinct')
        await publicCommand(p, 3, context('IssuerFundManager'), 'review_offering_issuer', 'APPROVED')
        // A newer fully retained candidate must not steal Compliance binding from
        // the actual existing issuer decision bound to the first operation.
        await admin(); const currentProduct = await scalar('select to_jsonb(p) from bx1_portal.products p where id=$1', [p.id])
        const newerPurpose = await requestPurpose(currentProduct); await approvePurpose(currentProduct, newerPurpose)
        const newerOperation = await prepare(currentProduct, newerPurpose), newerLease = await claim()
        await send(newerLease)
        await record(newerLease, 'CREATE_RESULT', { phase: 'SENT', envelope_id: randomUUID(), evidence_sha256: digest('synthetic second independently authorised operation') })
        eq((await complete(newerOperation)).result.current, true, 'second candidate has complete current evidence, not a dummy invalid row')
        await publicCommand(p, 2, context('ComplianceOfficer'), 'review_product', 'APPROVED')
        await admin()
        eq(await scalar('select count(*)::int from bx1_private.offering_signature_decision_bindings where operation_id=$1', [operation]), 2, 'both existing decisions bind same retained operation')
        eq(await scalar('select count(*)::int from bx1_private.offering_signature_decision_bindings where operation_id=$1', [newerOperation]), 0, 'newer unchosen candidate cannot capture validated decision binding')
        eq(await scalar('select bx1_portal.offering_workflow_approved($1)', [p.id]), true, 'existing approved predicate retains all native conditions plus exact signature')
        eq(await scalar('select bx1_portal.offering_approved($1)', [p.id]), true, 'existing legacy predicate also requires exact current binding')
        await isolated(async () => {
          await admin(); await db.query('update bx1_private.offering_signature_policy set authority_epoch=authority_epoch+1 where singleton')
          eq(await scalar('select bx1_portal.offering_workflow_approved($1)', [p.id]), false, 'policy epoch drift invalidates old current decision reliance')
          eq(await scalar('select count(*)::int from bx1_private.offering_signature_decision_bindings where operation_id=$1', [operation]), 2, 'epoch drift never deletes binding history')
        })
      })
      await isolated(async () => {
        const id = await requestPurpose(p); await approvePurpose(p, id); const operation = await prepare(p, id)
        const lease = await claim(); await send(lease)
        const laterThrottle = new Date(Date.now() + 3600000).toISOString()
        await record(lease, 'CREATE_RESULT', { phase: 'UNKNOWN', envelope_id: null, evidence_sha256: digest('synthetic lost create response'), next_check_at: laterThrottle })
        await admin(); eq(await scalar('select next_check_at=$2::timestamptz from bx1_private.offering_signature_operations where id=$1', [operation, laterThrottle]), true, 'CREATE uncertainty preserves provider deadline beyond minimum')
        await age(operation); const reconcile = await claim(); eq(reconcile.action, 'RECONCILE', 'unknown creation cannot claim another CREATE')
        await consume(reconcile, 'RECONCILE_RESULT')
        await denied('unknown cannot retry create', () => record(reconcile, 'CREATE_RESULT', { phase: 'SENT', envelope_id: randomUUID(), evidence_sha256: digest('forbidden') }), '23514')
        await record(reconcile, 'RECONCILE_RESULT', { status: 'SENT', envelope_id: randomUUID(), integrity_verified: false,
          evidence_sha256: digest('synthetic same transaction lookup'), next_check_at: new Date(Date.now() + 901000).toISOString() })
        for (const status of ['DECLINED', 'VOIDED']) await isolated(async () => {
          await age(operation); const terminalLease = await claim(); await consume(terminalLease, 'RECONCILE_RESULT')
          await record(terminalLease, 'RECONCILE_RESULT', { status, envelope_id: terminalLease.envelope_id, integrity_verified: false,
            evidence_sha256: digest(`synthetic ${status}`), next_check_at: new Date(Date.now() + 901000).toISOString() })
          await actorCall(1, manager, p, 'REVOKE_PURPOSE', { authorisation_id: id, reason: 'Synthetic revocation of already terminal provider operation.' })
          await admin(); eq(await scalar('select next_action from bx1_private.offering_signature_operations where id=$1', [operation]), 'NONE', `${status} never queues impossible VOID`)
        })
        await isolated(async () => {
          await age(operation); const throttleLease = await claim(); await consume(throttleLease, 'RECONCILE_RESULT')
          await record(throttleLease, 'RECOVERY_REQUIRED', { reason: 'PROVIDER_THROTTLED', evidence_sha256: null, next_check_at: laterThrottle })
          await actorCall(1, manager, p, 'REQUEST_RECOVERY', { operation_id: operation, reason: 'Synthetic explicit retry cannot shorten provider throttle reservation.' })
          await admin(); eq(await scalar('select next_check_at=$2::timestamptz from bx1_private.offering_signature_operations where id=$1', [operation, laterThrottle]), true, 'manual recovery preserves later provider deadline')
          eq(await claim(), null, 'provider throttle survives manual retry and new worker')
        })
        await actorCall(1, manager, p, 'REVOKE_PURPOSE', { authorisation_id: id, reason: 'Synthetic purpose revoked after uncertain provider send.' })
        await denied('revoked signer cannot request new view', () => actorCall(3, context('IssuerFundManager'), p, 'REQUEST_SIGNING_VIEW', { operation_id: operation }))
        await age(operation); const voidLease = await claim(); eq(voidLease.action, 'VOID', 'revocation leaves restricted provider void available')
        await consume(voidLease, 'VOID_RESULT')
        await record(voidLease, 'VOID_RESULT', { status: 'UNKNOWN', evidence_sha256: digest('synthetic uncertain void'), next_check_at: new Date(Date.now() + 901000).toISOString() })
        await age(operation)
        // The next service attempt remains a void/reconcile operation; no replacement.
        const late = await claim(); eq(late.operation_id, operation, 'late observation retains same permanent operation')
        await consume(late, 'VOID_RESULT')
        const evidence = completionEvidence(late)
        await denied('late void completion without full evidence cannot strand retention', () => record(late, 'VOID_RESULT', {
          status: 'COMPLETED', evidence_sha256: digest(evidence), next_check_at: new Date(Date.now() + 901000).toISOString(),
        }), '22023')
        await record(late, 'VOID_RESULT', { status: 'COMPLETED', integrity_verified: true, evidence_json: evidence,
          evidence_sha256: digest(evidence), next_check_at: new Date(Date.now() + 901000).toISOString() })
        const retention = await claim(); eq(retention.action, 'RETAIN', 'late revoked completion can still archive')
        eq(retention.completion_evidence, evidence, 'late VOID completion full resource evidence survives into RETAIN')
        eq(retention.completion_evidence_sha256, digest(evidence), 'late VOID evidence digest survives independently')
        for (const kind of ['MEMORANDUM_SIGNED', 'RISKS_SIGNED', 'SUBSCRIPTION_TERMS_SIGNED', 'COVER_SIGNED', 'CERTIFICATE']) await archive(retention, kind, `late ${kind}`)
        await denied('unverified late audit cannot finalize', () => record(retention, 'EVIDENCE_FINALIZED', { integrity_verified: true, evidence_sha256: digest('unproved late audit') }), '23514')
        const finalized = await record(retention, 'EVIDENCE_FINALIZED', { integrity_verified: true, evidence_sha256: digest(evidence) })
        eq(finalized.state, 'EVIDENCE_RETAINED', 'late complete evidence is retained, not stranded')
        eq(finalized.current, false, 'retained late evidence remains explicitly NON_CURRENT')
        await admin(); eq(await scalar('select bx1_private.offering_signature_evidence_current($1)', [operation]), false, 'late revoked archival cannot approve business')
      })
    }
    eq(await functions(), installedFunctions, 'all runtime paths preserve installed function bodies and metadata')
    eq(await catalog(), installedCatalog, 'all runtime paths preserve installed security catalog')
  } catch (error) { failure = error; throw error }
  finally {
    if (overlayOpen) {
      await db.query('rollback to savepoint signature_overlay_proof;release savepoint signature_overlay_proof')
      await admin()
      try {
        eq(await rows(originalSpecs), originalRows, 'unconditional exact original row cleanup including synthetic persons/policies')
        eq(await functions(), originalFunctions, 'unconditional exact original function/OID cleanup')
        eq(await catalog(), originalCatalog, 'unconditional complete original catalog cleanup')
        eq(await relations(), originalSpecs, 'all nine proof tables removed by rollback')
      } catch (cleanupError) { if (!failure) throw cleanupError; console.error('BX1_OFFERING_SIGNATURE_CLEANUP_FAILED') }
    }
  }
  console.log('BX1_OFFERING_SIGNATURES_PASS', JSON.stringify({ assertions: checks, models: ['FUND', 'REAL_ESTATE'],
    source_overlay: true, exact_body_cutovers: 5, new_tables: 9, new_functions: 14, fixture_cleanup: 'FULL_SAVEPOINT_ROLLBACK',
    provider_http: false, storage_http: false, genuine_audit_semantics: false, independent_humans: false, hosted_acceptance: false }))
  return checks
}
