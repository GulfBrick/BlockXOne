import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source contracts, not a hosted login, provider, funding or chain receipt.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_roleplay_manager_bridge.sql'), 'utf8')
type Cutover = { signature: string; sha: string; owner: string; secdef: boolean; acl: string; config: string[]; next_body: string }
const match = sql.match(/\$manager_specs\$\s*([\s\S]*?)\s*\$manager_specs\$::jsonb/)
if (!match) throw new Error('Missing exact manager bridge specifications')
const specs = JSON.parse(match[1]) as Cutover[]
const body = (name: string) => {
  const selected = specs.filter(item => item.signature.includes('.' + name + '('))
  if (selected.length !== 1) throw new Error('Expected one cutover for ' + name)
  return selected[0].next_body
}

describe('exact product-bound TEST manager continuation', () => {
  it('pins the existing writer OIDs and every privilege attribute', () => {
    expect(specs).toHaveLength(17)
    expect(new Set(specs.map(item => item.signature)).size).toBe(specs.length)
    for (const spec of specs) {
      expect(spec.sha).toMatch(/^[0-9a-f]{64}$/)
      expect(spec.owner).toBe('postgres')
      expect(spec.config).toEqual(['search_path=""'])
    }
    expect(sql).toContain("pg_catalog.to_jsonb(p)-'prosrc'")
    expect(sql).toContain('fund_roleplay_manager_exact_pin_mismatch')
    expect(sql).toContain('fund_roleplay_manager_metadata_changed')
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres'")
  })

  it('requires the genuine session, native policy and still-current original preparation source', () => {
    expect(sql).toContain('bx1_private.test_roleplay_protected_session()')
    expect(sql).toContain("policy.project_ref='fegnnnlseuejkrusbbkv'")
    expect(sql).toContain("policy.environment='TESTNET'")
    expect(sql).toContain('organisation.reviewer_scope=policy.native_organisation_id')
    expect(sql).toContain('p.created_by=auth.uid() and organisation.owner_id=auth.uid()')
    expect(sql).toContain('source.product_organisation_id=organisation.id')
    expect(sql).toContain('test_offering_source_current(organisation.id,preparation.id,preparation.revision)')
    expect(sql).toContain('p.current_offering_revision_id=policy.offering_revision_id')
    expect(sql).toContain('p.terms_hash=policy.terms_hash')
    expect(sql).toContain('max(later.version)')
    expect(sql).not.toMatch(/(?:insert into|update)\s+(?:bx1_private\.(?:person_principals|roleplay_policies)|bx1_portal\.(?:representative_mandates|organisation_authority_bindings))/i)
    for (const name of ['test_offering_context', 'test_workspace_entitlement', 'has_session_mfa',
      'has_token_mfa', 'entity_people_independent', 'scoped_operator', 'fund_person', 'fund_context']) {
      expect(specs.some(item => item.signature.includes('.' + name + '('))).toBe(false)
    }
  })

  it('does not create an organisation-wide writer loan or bypass an old evaluation entitlement', () => {
    expect(sql).toContain('lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()')
    expect(sql).toContain('lane.operating_context=c and product.organisation_id=target_org')
    expect(sql).toContain("lane.action in ('request_product_service_appointment','publish_product')")
    expect(sql).toContain('fund_roleplay_lane_current(c,product.id,lane.action)')
    expect(body('offering_workflow_operator')).toContain('offering_workflow_operator_pre_test_workspace(c,target_org)')
    expect(body('read_scoped').indexOf('fund_roleplay_manager_scope')).toBeLessThan(
      body('read_scoped').indexOf('test_workspace_entitlement(c)'))
    expect(body('read_scoped')).toContain('return bx1_portal.test_workspace_read(c)')
    expect(sql).toContain("'authority_source','TEST_ROLE_PLAY'")
    expect(sql).toContain("'base_records_available',false")
    expect(sql).toContain("and action='\"request_product_service_appointment\"'::jsonb")
    expect(sql).not.toContain("'evaluation_access'")
  })

  it('retains real appointments, document/signature evidence, approved packages and readiness', () => {
    expect(body('test_offering_command')).toContain('test_offering_source_current(o.id,e.id,e.revision)')
    expect(body('test_offering_command')).toContain('fund_roleplay_finish(c,target,action,key)')
    expect(body('offering_document_manager')).toContain("r.origin='SUBMITTED'")
    expect(body('offering_document_manager')).toContain('r.terms=p.terms and r.terms_hash=p.terms_hash')
    expect(body('offering_workflow_appointment_projection')).toContain('native_membership_id')
    expect(sql).toContain('execute_scoped_pre_monitoring(c,\'publish_product\',key,body)')
    expect(sql).toContain('bx1_private.fund_roleplay_manager_offering_approved(c,p.id) and bx1_portal.offering_technical_ready(p.current_offering_revision_id)')
    expect(sql).toContain('receipt.policy_id=policy and receipt.product_id=product')
    expect(sql).toContain('fund_roleplay_manager_publish_replay_conflict')
    expect(sql).not.toMatch(/(?:insert into|update)\s+bx1_portal\.(?:fund_holdings|fund_register_entries|funding_journals|product_eligibility_cases)/i)
  })

  it('closes every new helper and keeps current policy checks through the return boundary', () => {
    expect(sql).toContain('from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker')
    expect(sql).toContain('grant execute on function %s to postgres')
    expect(sql).not.toContain('to postgres,authenticated')
    expect(sql).toContain('fund_roleplay_manager_read_changed_after_wait')
    expect(sql).toContain('fund_roleplay_manager_read_authority_changed')
    expect(sql).toContain('fund_roleplay_manager_publish_changed_at_commit')
    expect(sql).toContain('candidate.native_membership_id=(value->>\'membership_id\')::uuid')
    expect(body('execute_scoped')).toContain("fund_roleplay_manager_current(c,(body->>'product_id')::uuid,'publish_product')")
  })

  it('continues publication only through the exact private product/action/key lane at the parent and base seams', () => {
    expect(sql).toContain("lane.product_id=product and lane.request_key=key and lane.action='publish_product'")
    expect(sql).toContain('and (c is null or lane.operating_context=c)')
    expect(body('offering_workflow_parent_command')).toContain("fund_roleplay_manager_publish_lane((body->>'product_id')::uuid,key,c)")
    expect(body('offering_workflow_parent_command')).toContain("action not in ('save_product','submit_product')")
    const base = body('execute_command_pre_entry')
    expect(base).toContain("elsif not bx1_portal.is_operator(o.id) and (command is distinct from 'publish_product' or bx1_private.fund_roleplay_manager_publish_lane(p.id,request_key) is not true)")
    expect(base).toContain("p.status<>'APPROVED' or p.reviewer_id is null")
    expect(base).toContain("p.revision<>(payload->>'expected_revision')::integer")
    expect(base).toContain('portal_idempotency_conflict')
    expect(base).toContain('fund_roleplay_manager_base_publish_authority_changed')
    expect(base).toContain('insert into bx1_portal.requests(actor_id,request_key,command,payload)')
    expect(base).toContain('insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)')
    expect(base.match(/return bx1_private\.fund_roleplay_manager_read/g)).toHaveLength(2)
    expect(base.match(/return bx1_portal\.read_state\(\)/g)).toHaveLength(2)
    expect(base.match(/lane\.request_key=execute_command_pre_entry\.request_key/g)).toHaveLength(2)
    expect(base).not.toContain('lane.request_key=request_key')
    expect(specs.some(item => item.signature.includes('.is_operator('))).toBe(false)
  })

  it('uses genuine workflow approval only in the current exact TEST publication lane', () => {
    const monitor = body('execute_scoped_pre_monitoring')
    expect(monitor).toContain("bx1_portal.offering_approved(p.id) or (action='publish_product'")
    expect(monitor).toContain('bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c)')
    expect(monitor).toContain('and bx1_portal.offering_workflow_approved(p.id)')
    expect(monitor).toContain('if bx1_portal.offering_technical_ready(r.id) is not true then')
    expect(monitor).toContain('perform bx1_portal.offering_workflow_parent_command(c,action,key,body)')
    expect(sql).toContain("fund_roleplay_manager_current(c,product,'publish_product')")
    expect(sql).toContain('fund_roleplay_manager_workflow_approval_dependency_changed')
    expect(specs.some(item => item.signature.includes('.offering_approved('))).toBe(false)
    expect(specs.some(item => item.signature.includes('.offering_workflow_approved('))).toBe(false)
  })
})
