import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract proof only. This does not impersonate a reviewer, create an
// appointment or prove the hosted review/apply journey or professional authority.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_appointment_source.sql')
const workflow = read('bx1_offering_workflow.sql')
const review = read('bx1_test_workspace_offering_review.sql')
const commands = read('bx1_fund_roleplay_commands.sql')
const manager = read('bx1_fund_roleplay_manager_bridge.sql')
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
const initial = workflow.match(/create function bx1_portal\.offering_workflow_appointment_source_current\(target_id uuid\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
const sourceSpecs = JSON.parse(review.match(/\$test_offering_specs\$([\s\S]*?)\$test_offering_specs\$::jsonb/)![1]) as { signature: string; changes: { from: string; to: string }[] }[]
const sourceCuts = sourceSpecs.find(value => value.signature === 'bx1_portal.offering_workflow_appointment_source_current(uuid)')!.changes
const original = sourceCuts.reduce((value, cut) => value.replace(cut.from, cut.to), initial)
const oldFragment = sql.match(/\$old\$([\s\S]*?)\$old\$/)![1]
const newFragment = sql.match(/\$new\$([\s\S]*?)\$new\$/)![1]
const dependencies = JSON.parse(sql.match(/\$dependencies\$([\s\S]*?)\$dependencies\$::jsonb/)![1]) as { signature: string; sha: string }[]
const corrected = original.replace(oldFragment, newFragment)

describe('retained preparation source for a saved current TEST fund appointment', () => {
  it('pins the actual native source and changes only its final manager-context predicate', () => {
    expect(hash(original)).toBe('3df689ac7fe006e29062ca876b980e2389c63e11597cebbfe2abef6d745c90ff')
    expect(sql).toContain("is distinct from '3df689ac7fe006e29062ca876b980e2389c63e11597cebbfe2abef6d745c90ff'")
    expect(oldFragment).toBe("bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,\n        (a.requested_in_context->>'organisationId')::uuid)")
    expect(original.split(oldFragment)).toHaveLength(2)
    expect(corrected.split(newFragment)).toHaveLength(2)
    expect(corrected.replace(newFragment, oldFragment)).toBe(original)
    expect(newFragment.startsWith(`(${oldFragment}\n        or (`)).toBe(true)
    expect(sql).toContain('replace(next_body,new_fragment,old_fragment) is distinct from original')
  })

  it.each([
    ['unstamped or invalid policy', 'a.roleplay_policy_id is not null and a.roleplay_epoch>0'],
    ['different saved context', 'a.roleplay_context=a.requested_in_context'],
    ['non-manager context', "a.roleplay_context->>'role'='OfferingManager'"],
    ['wrong source', 'source.id=a.test_workspace_source_id and source.product_organisation_id=o.id'],
    ['wrong source actor', "source.user_id=a.requested_by_user_id and source.role='OfferingManager'"],
    ['wrong source environment', "source.environment='TESTNET'"],
    ['different entitlement', 'entitlement.id=a.test_workspace_entitlement_id'],
    ['stale entitlement revision', 'entitlement.revision=a.test_workspace_entitlement_revision'],
    ['different original native organisation', 'entitlement.native_organisation_id=source.native_organisation_id'],
    ['wrong product organisation', 'product.id=a.product_id and product.organisation_id=o.id'],
    ['wrong requester/owner', 'product.created_by=a.requested_by_user_id and o.owner_id=a.requested_by_user_id'],
    ['changed terms', 'product.terms_hash=a.terms_hash_at_request and offering.terms_hash=product.terms_hash'],
    ['changed offering', "offering.terms=product.terms and offering.origin='SUBMITTED'"],
    ['invalid product revision', 'a.product_revision_at_request>0 and product.revision>=a.product_revision_at_request'],
    ['withdrawn preparation source', 'bx1_portal.test_offering_appointment_current(a.id) is true'],
    ['lost original manager source', 'bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,source.native_organisation_id) is true'],
    ['wrong, expired, revoked or superseded policy/action', "product.id,offering.id,a.requested_by_user_id,a.roleplay_context,'request_product_service_appointment') is true"],
  ])('binds the %s guard in the additional branch only', (_reason, fragment) => {
    expect(newFragment).toContain(fragment)
  })

  it('retains existing expiry, membership, person and preparation guards without requiring a completed appointment', () => {
    for (const fragment of ['a.requested_until>pg_catalog.clock_timestamp()', 'o.reviewer_scope=a.reviewer_scope_organisation_id',
      'bx1_portal.test_offering_organisation_current(o.id)', 'bx1_portal.native_membership_effective(m.id)',
      'bx1_portal.offering_workflow_person_current(a.appointee_user_id)',
      '(not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_appointment_current(a.id))',
    ]) expect(corrected).toContain(fragment)
    expect(newFragment).not.toContain("a.status='APPLIED'")
    expect(newFragment).not.toContain('fund_roleplay_appointment_current(')
    expect(newFragment).not.toContain('fund_roleplay_current_policy(')
    expect(newFragment).not.toContain('auth.uid()')
    // This pure saved-source predicate adds no viewer permissions: callers keep
    // actual current Compliance/SuperAdmin role, session and independence gates.
    for (const fragment of ["'can_review',is_reviewer and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='SUBMITTED'",
      "'can_apply',is_admin and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='APPROVED'",
      'bx1_private.fund_roleplay_review_exception(c,a.product_id',
    ]) expect(manager).toContain(fragment)
  })

  it('reuses the exact current-policy predicate, including live revocation and latest-version checks', () => {
    const current = commands.match(/create function bx1_private\.fund_roleplay_record_current\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
    expect(hash(current)).toBe('fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8')
    expect(dependencies).toHaveLength(4)
    expect(dependencies.find(value => value.signature.startsWith('bx1_private.fund_roleplay_record_current('))?.sha).toBe(hash(current))
    for (const fragment of ['fund_roleplay_record_bound(policy,epoch,product,offering,actor,c,action)',
      'test_roleplay_binding_current(policy)', 'saved.version=(select max(later.version)',
      "operator.status='ACTIVE'", "membership.status='ACTIVE'", 'native_membership_effective(membership.id)',
    ]) expect(current).toContain(fragment)
  })

  it('preserves the native OID, owner, ACL and every non-body attribute without any data or authority writes', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", 'bx1_private.test_roleplay_environment() is not true',
      'target is distinct from 29604::oid', "before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text",
      "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "before_row->'proconfig' is distinct from '[\"search_path=\\\"\\\"\"]'::jsonb",
      "before_row->'proargnames' is distinct from '[\"target_id\"]'::jsonb",
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
      'fund_roleplay_appointment_source_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|delete from|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('update bx1_')
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('fund_roleplay_finish(')
  })
})
