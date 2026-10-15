import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static source contracts, not an approval, scanner run, KYC outcome, native
// execution or hosted customer/account acceptance. The installer pins live SQL.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_investor_admission.sql')
type Cut = { from: string; to: string; count: number }
type Spec = { signature: string; oid: number; sha: string; cuts: Cut[] }
const specs = JSON.parse(sql.match(/\$specs\$([\s\S]*?)\$specs\$::jsonb/)![1]) as Spec[]
const body = (name: string) => sql.match(new RegExp(`create function bx1_private\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')

describe('exact TEST own-investor admission continuation source contract', () => {
  it('has exactly six pinned targets and retains current publication cuts', () => {
    expect(specs.map(spec => spec.oid)).toEqual([24447, 24343, 27054, 27038, 26200, 25200])
    expect(specs.map(spec => spec.cuts.map(cut => cut.count))).toEqual([[1, 1], [1, 1], [1], [1, 1, 1, 1, 1, 1], [1], [2, 1, 1]])
    expect(specs[0].sha).toBe('d6e5856bebc39049b70d9617d7af80675957d09743477662f634d8610bfe578d')
    const manager = read('bx1_fund_roleplay_manager_bridge.sql')
    const managerSpecs = JSON.parse(manager.match(/\$manager_specs\$([\s\S]*?)\$manager_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
    const publication = read('bx1_fund_roleplay_publication_commit.sql')
    const publicationSpecs = JSON.parse(publication.match(/\$specs\$([\s\S]*?)\$specs\$::jsonb/)![1]) as Spec[]
    const base = specs[1]
    let retained = managerSpecs.find(spec => spec.signature === base.signature)!.next_body
    for (const cut of publicationSpecs.find(spec => spec.signature === base.signature)!.cuts) retained = retained.replaceAll(cut.from, cut.to)
    expect(hash(retained)).toBe(base.sha)
    let corrected = retained
    for (const cut of base.cuts) {
      expect(corrected.split(cut.from)).toHaveLength(cut.count + 1)
      corrected = corrected.replaceAll(cut.from, cut.to)
    }
    for (const cut of [...base.cuts].reverse()) corrected = corrected.replaceAll(cut.to, cut.from)
    expect(corrected).toBe(retained)
    expect(sql).toContain("after_row-'prosrc' is distinct from before_row-'prosrc'")
    expect(sql).toContain('restored is distinct from original')
    expect(sql).toContain("before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb")
  })

  it('provisions only immutable configuration derived from the actual saved submission', () => {
    const provision = body('fund_roleplay_admission_provision')
    expect(provision).toContain("current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null")
    expect(provision).toContain("application.status<>'SUBMITTED'")
    expect(provision).toContain("application.provider_mode<>'MANUAL_TEST_REVIEW'")
    expect(provision).toContain("application.details->'test_data_acknowledged' is distinct from 'true'::jsonb")
    expect(provision).not.toContain('perform bx1_portal.validate_application(')
    expect(provision).toContain('bx1_private.fund_roleplay_admission_documents(application.id,application.revision,application.user_id,application.details)')
    expect(provision).toContain('insert into bx1_private.fund_roleplay_admission_bindings')
    expect(provision).not.toMatch(/insert into (?:bx1_portal|public|auth)\./)
    expect(provision).not.toMatch(/update\s|delete from\s/i)
    expect(sql).not.toContain('7051bacc-7d0d-4c25-9077-245161eb3aa0')
    expect(sql).not.toContain('4f681a71-5c88-493f-8a7c-eb4a50783978')
    expect(sql).not.toMatch(/alter table bx1_portal\.applications\s+add column/)
    expect(sql).toContain('references bx1_private.roleplay_people(person_id) on delete restrict')
    expect(sql).not.toContain('references bx1_private.persons(id)')
  })

  it('requires genuine bound clean scan/storage evidence without manufacturing provider identity', () => {
    const documents = body('fund_roleplay_admission_documents')
    for (const text of [
      "saved.capture_kind='SUBMISSION' and saved.details=p_details",
      'bound.application_id=p_application and bound.application_revision=p_revision',
      "item.state='PROMOTED' and item.promoted_at is not null",
      "scan.verdict='CLEAN'", "stored.bucket_id='bx1-portal-documents'",
      "stored.user_metadata->>'sha256'=item.sha256",
      "receipt.sha256=document->>'sha256'", 'bx1_private.document_scan_legacy_overlay_current(receipt.id,false)',
    ]) expect(documents).toContain(text)
    expect(documents).not.toMatch(/insert|update|delete/i)
    expect(sql).not.toMatch(/insert into bx1_private\.(?:persons|person_principals|roleplay_policies|roleplay_capacities)/)
    expect(sql).not.toMatch(/update bx1_private\.roleplay_policies/)
  })

  it('binds actor, actual protected session, context, key, exact payload and current policy after waits', () => {
    const allowed = body('fund_roleplay_admission_review_allowed')
    expect(allowed).toContain("p_context->>'role'='ComplianceOfficer'")
    expect(allowed).toContain('bx1_private.test_roleplay_protected_session()')
    expect(allowed).toContain('application.user_id=auth.uid()')
    expect(allowed).toContain("application.status='SUBMITTED' and application.revision=binding.submitted_revision")
    expect(allowed).toContain('bx1_portal.admission_application_reviewer')
    expect(allowed).toContain('bx1_private.fund_roleplay_appointed')
    const lane = body('fund_roleplay_admission_lane_current')
    expect(lane).toContain('lane.transaction_id=pg_current_xact_id() and lane.actor_id=auth.uid()')
    expect(lane).toContain("lane.session_id::text=auth.jwt()->>'session_id'")
    expect(lane).toContain("lane.command_payload->>'expected_revision'=binding.submitted_revision::text")
    const binding = body('fund_roleplay_admission_binding_current')
    for (const text of ['policy.authority_epoch=binding.authority_epoch', 'policy.terms_hash=binding.terms_hash',
      'policy.offering_revision_id=binding.offering_revision_id', 'application.submitted_at=binding.submitted_at',
      'binding.valid_until>clock_timestamp()', 'appointment.revision=binding.compliance_appointment_revision',
      'bx1_private.fund_roleplay_record_current', "'review_product_eligibility'"]) expect(binding).toContain(text)
    expect(binding).toContain('binding.valid_until=least(policy.valid_until,appointment.requested_until)')
  })

  it('historical CHECK truth is immutable and cannot expire or depend on a request', () => {
    const historical = body('fund_roleplay_admission_decision_bound')
    for (const text of ['decision.actor_id=p_user and p_reviewer=p_user', 'decision.decision_revision=p_revision',
      'decision.checks=p_checks', 'decision.approved_until is not distinct from p_approved',
      'binding.submitted_at=p_submitted', 'not binding.independence_proven and not decision.independence_proven',
      'decision.command_payload=jsonb_build_object']) expect(historical).toContain(text)
    expect(historical).not.toMatch(/clock_timestamp|auth\.|current_setting|binding_current|protected_session|valid_until/)
    expect(sql).toContain('reviewer_id is null or reviewer_id<>user_id\n  or bx1_private.fund_roleplay_admission_decision_bound')
    expect(sql).toContain('before update or delete on bx1_private.fund_roleplay_admission_decisions')
    expect(body('fund_roleplay_admission_stamp')).toContain('insert into bx1_private.fund_roleplay_admission_decisions')
    // Snapshot session UUIDs must not prohibit Supabase's later session cleanup.
    expect(sql).not.toContain('references auth.sessions')
  })

  it('keeps tagged admissions fail-closed and prevents another-product eligibility or subscription', () => {
    for (const helper of ['fund_roleplay_admission_current', 'fund_roleplay_admission_product']) {
      const current = body(helper)
      expect(current).toContain('case when not exists(select 1 from bx1_private.fund_roleplay_admission_bindings tagged')
      expect(current).toContain('where tagged.application_id=p_application) then true')
      expect(current).not.toContain('reviewer_id is distinct from application.user_id or')
    }
    expect(body('fund_roleplay_admission_product')).toContain('binding.product_id=p_product')
    expect(specs[4].cuts[0].to).toContain('bx1_private.fund_roleplay_admission_current(a.id)')
    expect(specs[5].cuts[0].count).toBe(2) // Before and after subscription writer wait.
    expect(specs[5].cuts.every(cut => cut.to.includes('fund_roleplay_admission_product'))).toBe(true)
    expect(specs[5].cuts[2].to).toContain("action='request_product_eligibility'")
  })

  it('uses canonical writer receipts and preserves existing same-key replay before lane entry', () => {
    const p2 = specs[0]
    expect(p2.cuts[0].from).toContain("raise exception 'portal_reviewer_scope_denied'")
    expect(p2.cuts[0].to).toContain('fund_roleplay_admission_enter(c,key,body)')
    expect(p2.cuts[1].to.startsWith(p2.cuts[1].from)).toBe(true)
    const finish = body('fund_roleplay_admission_finish')
    expect(finish).toContain('lane.request_key is distinct from p_key')
    expect(finish).toContain('lane.command_payload is distinct from p_payload')
    expect(finish).toContain('from bx1_portal.requests receipt')
    expect(finish).toContain('from bx1_portal.scoped_requests receipt')
    expect(finish).toContain('receipt.operating_context=p_context')
    expect(finish).toContain('bx1_private.fund_roleplay_admission_binding_current(lane.binding_id) is not true')
    expect(specs[1].cuts[1].to).toContain('decision.request_key=execute_command_pre_entry.request_key')
    expect(specs[1].cuts[1].to).toContain('independence_proven=false; no provider verification')
  })

  it('projects history to every already-visible tagged case while only its operator can review', () => {
    const projection = body('fund_roleplay_admission_read')
    expect(projection).toContain("p_snapshot->'actor'->>'id' is distinct from auth.uid()::text")
    expect(projection).toContain("p_snapshot->'operating_context' is distinct from p_context")
    expect(projection).toContain("from jsonb_array_elements(coalesce(p_snapshot->'applications','[]'::jsonb))")
    expect(projection).toContain('bx1_private.fund_roleplay_admission_review_allowed(p_context,binding.application_id)')
    expect(projection).toContain("visible->>'id'=saved.application_id::text")
    expect(projection).not.toContain('saved.applicant_id=auth.uid()')
    expect(projection).toContain("'test_roleplay_review'")
    expect(projection).toContain("'test_roleplay_admission'")
    expect(projection).toContain("'execution_mode','TEST_ROLE_PLAY','independence_proven',false")
    expect(projection).not.toMatch(/jsonb_build_object\('actor'|\{actor,can_review\}|\{stage2_access\}/)
    expect(sql).toContain('granted.grantee<>helper.proowner')
    expect(sql).toContain('granted.grantee<>relation.relowner')
    expect(sql).toContain('pg_catalog.aclexplode')
    expect(sql).not.toMatch(/grant execute.*(?:authenticated|anon|service_role)/i)
  })
})
