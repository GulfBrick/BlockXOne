import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

/**
 * Call after the quarantine migration and immediately after a fresh submitted
 * synthetic offering revision, before either decision. The caller's cloud-CI
 * transaction rolls everything back; savepoints also erase these probes.
 */
export async function proveOfferingFileQuarantine(db, productId) {
  await db.query('reset role')
  const { rows } = await db.query(`select r.id as revision_id,r.submitted_by,p.id as product_id,
      p.organisation_id,p.revision,p.status,r.terms_hash,r.document_hashes
    from bx1_portal.products p join bx1_portal.offering_revisions r
      on r.id=p.current_offering_revision_id and r.product_id=p.id
    where p.id=$1 and r.origin='SUBMITTED'`, [productId])
  assert.equal(rows.length, 1, 'fresh submitted package required for file proof')
  const item = rows[0]
  assert.equal(item.status, 'IN_REVIEW')
  const directWriter = await db.query(`select
    pg_catalog.to_regprocedure('public.bx1_offering_file_register(jsonb,uuid,uuid,uuid,text,text,text,integer)') is null as no_public_writer,
    has_function_privilege('authenticated',
      'bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)','EXECUTE') as browser_can_register,
    has_function_privilege('bx1_document_receipt_writer',
      'bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)','EXECUTE') as trusted_writer_can_register`)
  assert.deepEqual(directWriter.rows[0], { no_public_writer: true,
    browser_can_register: false, trusted_writer_can_register: true },
  'an authenticated browser cannot forge a digest or occupy a receipt through RPC')
  await db.query('savepoint bx1_forged_digest_denial')
  let forgedDigestError
  try {
    await db.query('set local role authenticated')
    await db.query(`select bx1_private.register_offering_file($1::uuid,$2::uuid,'aal1'::text,
      '{"mode":"APPLICANT"}'::jsonb,$3::uuid,$4::uuid,$5::uuid,
      'MEMORANDUM'::text,'Forged receipt'::text,$6::text,100::integer)`,
    [item.submitted_by, randomUUID(), item.product_id, item.revision_id, randomUUID(), 'f'.repeat(64)])
  } catch (error) { forgedDigestError = error }
  await db.query('rollback to savepoint bx1_forged_digest_denial; release savepoint bx1_forged_digest_denial')
  assert.equal(forgedDigestError?.code, '42501', 'direct forged digest is denied by the restricted writer boundary')
  const noForgedReceipt = await db.query('select count(*)::int as count from bx1_portal.offering_file_quarantine where offering_revision_id=$1',
    [item.revision_id])
  assert.equal(noForgedReceipt.rows[0].count, 0, 'forged request leaves no receipt')
  const noForgedEvent = await db.query(`select count(*)::int as count from bx1_portal.events
    where subject_id=$1 and kind='offering_file_quarantined'`, [item.revision_id])
  assert.equal(noForgedEvent.rows[0].count, 0, 'forged request leaves no event')
  const storagePolicies = await db.query(`select policyname,qual from pg_catalog.pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname in ('bx1_offering_file_owner_read','bx1_offering_file_read_restrict')`)
  assert.equal(storagePolicies.rowCount, 2, 'both private download policies exist')
  assert.ok(storagePolicies.rows.every(row => row.qual.includes("allow_only_operation('object.get_authenticated'")),
    'signed URL and listing must not pass the SELECT policies')
  const storageTrigger = await db.query(`select count(*)::int as count from pg_catalog.pg_trigger
    where tgrelid='storage.objects'::regclass and tgname='bx1_offering_quarantine_guard'`)
  assert.equal(storageTrigger.rows[0].count, 0, 'no trigger may break the Storage preflight/completion/cleanup path')
  await db.query('savepoint bx1_trusted_receipt_probe')
  try {
    await db.query('reset role')
    const session = await db.query(`select id,aal::text as aal from auth.sessions
      where user_id=$1 and (not_after is null or not_after>now()) limit 1`, [item.submitted_by])
    assert.equal(session.rowCount, 1, 'synthetic manager has a live Auth session')
    const managerScope = await db.query(`select organisation_id from public.bx1_memberships
      where user_id=$1 and role='OfferingManager' and status='ACTIVE' limit 1`, [item.submitted_by])
    assert.equal(managerScope.rowCount, 1, 'synthetic manager has a native role context')
    const actorContext = JSON.stringify({ mode: 'ROLE', organisationId: managerScope.rows[0].organisation_id,
      role: 'OfferingManager' })
    const fileId = randomUUID(), digest = 'd'.repeat(64)
    await db.query(`insert into storage.objects(bucket_id,name,owner_id,metadata)
      values('bx1-offering-quarantine',$1,$2,'{"size":100,"mimetype":"application/pdf"}'::jsonb)`,
    [`${item.revision_id}/${item.submitted_by}/${fileId}`, item.submitted_by])
    await db.query('set local role bx1_document_receipt_writer')
    const receipt = await db.query(`select bx1_private.register_offering_file(
      $1::uuid,$2::uuid,$3::text,$4::jsonb,$5::uuid,$6::uuid,$7::uuid,
      'MEMORANDUM'::text,'Synthetic trusted-only file'::text,$8::text,100::integer) as result`,
    [item.submitted_by, session.rows[0].id, session.rows[0].aal, actorContext,
      item.product_id, item.revision_id, fileId, digest])
    assert.equal(receipt.rows[0].result.id, fileId, 'trusted writer receives its exact immutable receipt')
    await db.query('reset role')
    const event = await db.query(`select count(*)::int as count from bx1_portal.events
      where subject_id=$1 and kind='offering_file_quarantined'`, [item.revision_id])
    assert.equal(event.rows[0].count, 1, 'one trusted registration creates one audit event')
  } finally {
    await db.query('rollback to savepoint bx1_trusted_receipt_probe; release savepoint bx1_trusted_receipt_probe')
  }
  const currentDecisions = await db.query('select count(*)::int as count from bx1_portal.offering_decisions where offering_revision_id=$1', [item.revision_id])
  assert.equal(currentDecisions.rows[0].count, 0, 'the proof must run before either decision')

  const decide = () => db.query(`insert into bx1_portal.offering_decisions
    (offering_revision_id,decision_kind,decision,actor_id,operating_context,
      terms_hash,document_hashes,product_revision_at_decision,notes,checks)
    values($1,'ISSUER','APPROVED',$2,'{"mode":"APPLICANT"}'::jsonb,
      $3,$4,$5,'Synthetic direct trigger regression only; rolled back.','{}'::jsonb)`,
  [item.revision_id,item.submitted_by,item.terms_hash,item.document_hashes,item.revision])

  // The new trigger must not regress the pre-existing text-only decision path.
  await db.query('savepoint bx1_text_only_review_probe')
  try {
    await decide()
    const outcome = await db.query(`select count(*)::int as count from bx1_portal.offering_decisions
      where offering_revision_id=$1 and decision_kind='ISSUER' and decision='APPROVED'`, [item.revision_id])
    assert.equal(outcome.rows[0].count, 1, 'text-only decision remains possible')
  } finally {
    await db.query('rollback to savepoint bx1_text_only_review_probe; release savepoint bx1_text_only_review_probe')
  }

  await db.query('savepoint bx1_unscanned_file_probe')
  try {
    const fileId = randomUUID()
    await db.query(`insert into bx1_portal.offering_file_quarantine
      (id,offering_revision_id,product_id,actor_id,kind,title,storage_path,sha256,byte_size)
      values($1,$2,$3,$4,'MEMORANDUM','Synthetic quarantine-only regression PDF',
        $2::uuid::text||'/'||$4::uuid::text||'/'||$1::uuid::text,$5,100)`,
    [fileId,item.revision_id,item.product_id,item.submitted_by,'a'.repeat(64)])
    const blocked = await db.query('select validation_state from bx1_portal.offering_file_quarantine where id=$1', [fileId])
    assert.equal(blocked.rows[0].validation_state, 'QUARANTINED')
    await db.query('savepoint bx1_expected_file_denial')
    let error
    try { await decide() } catch (caught) { error = caught }
    await db.query('rollback to savepoint bx1_expected_file_denial; release savepoint bx1_expected_file_denial')
    assert.equal(error?.code, '23514', 'unscanned PDF must deny approval')
    assert.equal(error?.message, 'offering_uploaded_files_unverified', 'denial must be the file gate')
    const ready = await db.query('select bx1_portal.offering_technical_ready($1::uuid) as ready', [item.revision_id])
    assert.equal(ready.rows[0].ready, false, 'file receipt cannot establish technical readiness or publication')
  } finally {
    await db.query('rollback to savepoint bx1_unscanned_file_probe; release savepoint bx1_unscanned_file_probe')
  }

  const stillClean = await db.query('select count(*)::int as count from bx1_portal.offering_file_quarantine where offering_revision_id=$1', [item.revision_id])
  assert.equal(stillClean.rows[0].count, 0, 'probe must not leave a staged file on the test product')
  return 16
}

/** Run after product appointments: one issuer login, two products in one organisation. */
export async function proveOfferingFileProductIsolation(db, {
  appointedRevisionId, otherRevisionId, issuerContext, signInIssuer,
}) {
  await signInIssuer()
  const own = await db.query('select public.bx1_offering_file_list($1::jsonb,$2::uuid) as files',
    [JSON.stringify(issuerContext), appointedRevisionId])
  assert.deepEqual(own.rows[0].files, [], 'the appointed issuer can list its exact product file metadata')
  await db.query('savepoint bx1_offering_file_cross_product_denial')
  let denial
  try {
    await signInIssuer()
    await db.query('select public.bx1_offering_file_list($1::jsonb,$2::uuid)',
      [JSON.stringify(issuerContext), otherRevisionId])
  } catch (error) { denial = error }
  await db.query('rollback to savepoint bx1_offering_file_cross_product_denial; release savepoint bx1_offering_file_cross_product_denial')
  assert.equal(denial?.code, '42501', 'issuer appointed to product A cannot enumerate product B in the same organisation')
  return 2
}
