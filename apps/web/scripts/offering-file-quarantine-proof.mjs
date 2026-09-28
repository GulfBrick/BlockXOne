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
        $2::text||'/'||$4::text||'/'||$1::text,$5,100)`,
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
  return 6
}
