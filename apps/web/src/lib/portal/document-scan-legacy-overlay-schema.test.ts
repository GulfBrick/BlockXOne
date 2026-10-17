import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source contracts only; not an engine scan, live recovery or customer admission.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_document_scan_legacy_overlay.sql'), 'utf8')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_document_scan_legacy_overlay.sql'), 'utf8')
const recipes = JSON.parse(sql.match(/\$recipes\$([\s\S]*?)\$recipes\$::jsonb/)![1]) as {
  signature: string; sha256: string; changes: { from: string; to: string }[];
}[]

describe('genuine later scan overlay on immutable TEST upload history', () => {
  it('changes exactly four current consumers without changing receipt history or the scanner writer', () => {
    expect(recipes.map(item => item.signature)).toEqual([
      'bx1_private.promote_scanned_document_pre_processing(uuid)', 'public.bx1_document_scan_status(uuid)',
      'bx1_private.guard_application_document_receipts()', 'bx1_portal.object_readable(text)',
    ])
    for (const recipe of recipes) {
      expect(recipe.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(recipe.changes).toHaveLength(1)
      expect(recipe.changes[0].to).toContain('document_scan_legacy_overlay_current(')
    }
    expect(sql).not.toMatch(/(?:insert into|update|delete from|alter table)\s+(?:bx1_private\.)?document_upload_receipts/i)
    expect(sql).not.toMatch(/(?:drop|disable|replace)\s+trigger|grant\s+execute|set_config\s*\(/i)
    expect(sql).not.toContain('create or replace function bx1_private.record_document_scan')
    expect(sql).toContain("after_row-'prosrc' is distinct from before_row-'prosrc'")
  })
  it('binds exact old receipt, genuine scan, current attempt and policy, stored final object and TEST', () => {
    for (const fragment of ["receipt.validation_state='SYNTHETIC_UNSCANNED'", 'item.actor_id=receipt.actor_id',
      'item.storage_path=receipt.storage_path', 'item.sha256=receipt.sha256', 'item.byte_size=receipt.byte_size',
      'item.mime_type=receipt.mime_type', 'item.kind=receipt.kind', 'item.title=receipt.title',
      'attempt.id=job.current_attempt_id', "attempt.outcome='CLEAN'", "scan.verdict='CLEAN'",
      'scan.scanner_reference=attempt.reference', 'scan.scanner_reference=item.scanner_reference',
      "policy.state='ADMITTED'", 'policy.authority_epoch=attempt.authority_epoch',
      'policy.worker_id=attempt.worker_id', 'policy.scanner_id=attempt.scanner_id',
      "lifecycle.mode='SCANNER_REQUIRED'", "environment.environment='TESTNET'", 'enforced.enforced',
      "stored.bucket_id='bx1-portal-documents'", "stored.user_metadata->>'sha256'=item.sha256",
      "evidence.kind='RESULT_RECORDED'", "evidence.evidence->>'verdict'='CLEAN'"]) expect(sql).toContain(fragment)
  })
  it('does not show a document as clean until canonical promotion and completion finish', () => {
    expect(sql).toContain('allow_pending boolean default false')
    expect(sql).toContain("allow_pending is true and item.state='SCANNED_CLEAN'")
    expect(sql).toContain("job.state='RESULT_RECORDED'")
    expect(sql).toContain("item.state='PROMOTED' and item.promoted_at is not null and job.state='COMPLETED'")
    expect(sql).toContain("completed.kind='COMPLETED'")
    expect(recipes[0].changes[0].to).toContain('document_scan_legacy_overlay_current(q.id,true)')
    for (const recipe of recipes.slice(1)) expect(recipe.changes[0].to).not.toContain(',true)')
    expect(proof).toContain('document_scan_overlay_proof_missing_evidence_accepted')
    expect(proof).toContain('document_scan_overlay_proof_historical_immutability_missing')
    expect(proof).not.toMatch(/perform\s+bx1_private\.(?:record_document_scan|promote_scanned_document|claim_document)/i)
  })
})
