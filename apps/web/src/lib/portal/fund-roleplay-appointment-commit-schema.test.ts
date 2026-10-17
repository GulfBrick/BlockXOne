import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract proof only. No session, appointment, receipt or positive
// hosted command is created by these assertions. SQL/API/UI acceptance is separate.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_appointment_commit.sql')
const commands = read('bx1_fund_roleplay_commands.sql')
const locks = read('bx1_fund_roleplay_appointment_locks.sql')
const review = read('bx1_test_workspace_offering_review.sql')
const roleplay = read('bx1_fund_test_roleplay.sql')
const conflict = read('bx1_fund_roleplay_receipt_conflict.sql')
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
const body = (source: string, name: string) => source.match(new RegExp(`create function ${name.replace(/\./g, '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]
type Cut = { from: string; to: string }
const specs = JSON.parse(commands.match(/\$roleplay_specs\$([\s\S]*?)\$roleplay_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
const cuts = JSON.parse(locks.match(/\$cuts\$([\s\S]*?)\$cuts\$::jsonb/)![1]) as Cut[]
const oldWriter = specs.find(spec => spec.signature === 'bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)')!.next_body
const original = cuts.reduce((value, cut) => value.replace(cut.from, cut.to), oldWriter)
const oldFragment = sql.match(/old_fragment constant text:='([^']+)';/)![1]
const newFragment = sql.match(/new_fragment constant text:='([^']+)';/)![1]
const helper = sql.match(/as \$function\$([\s\S]*?)\$function\$;/)![1]
const dependencies = JSON.parse(sql.match(/\$dependencies\$([\s\S]*?)\$dependencies\$::jsonb/)![1]) as { signature: string; sha: string }[]

describe('receipt-only TEST appointment commit continuation', () => {
  it('changes only the two dashboard-return sites of the actual retained canonical writer', () => {
    expect(hash(original)).toBe('fefc59c05659dace30de8a3743d7507c437869693eb9b069dfe52c98ad5749b2')
    expect(sql).toContain("is distinct from 'fefc59c05659dace30de8a3743d7507c437869693eb9b069dfe52c98ad5749b2'")
    expect(oldFragment).toBe('return bx1_portal.read_scoped(c);')
    expect(newFragment).toBe('return coalesce(bx1_private.fund_roleplay_appointment_commit(c,action,key,body),bx1_portal.read_scoped(c));')
    expect(original.split(oldFragment)).toHaveLength(3)
    const corrected = original.replaceAll(oldFragment, newFragment)
    expect(corrected.split(newFragment)).toHaveLength(3)
    expect(corrected.replaceAll(newFragment, oldFragment)).toBe(original)
    for (const fragment of ['product_appointment_idempotency_conflict', 'product_appointment_prior_key_conflict',
      'product_appointment_context_changed', 'product_appointment_target_denied', 'product_appointment_review_denied',
      'product_appointment_apply_denied', 'product_appointment_revoke_denied', 'fund_roleplay_finish(c,p.id,action,key)',
      'insert into bx1_portal.product_service_appointment_requests', 'insert into bx1_portal.events',
    ]) expect(corrected).toContain(fragment)
    expect(corrected.indexOf('fund_roleplay_finish(c,p.id,action,key)')).toBeLessThan(corrected.lastIndexOf(newFragment))
    expect(sql).toContain('fund_roleplay_appointment_commit_cut_not_exactly_two')
    expect(sql).toContain('replace(next_body,new_fragment,old_fragment) is distinct from original')
  })

  it('uses unambiguous helper parameters and returns null for ordinary/MAIN rather than broadening authority', () => {
    expect(sql).toContain('fund_roleplay_appointment_commit(p_context jsonb,p_action text,p_key uuid,p_body jsonb)')
    expect(helper).toContain('test_roleplay_environment() is not true')
    expect(helper).toContain("p_action not in ('request_product_service_appointment','review_product_service_appointment',\n      'apply_product_service_appointment','revoke_product_service_appointment')")
    expect(helper).toContain('if appointment.id is null or appointment.roleplay_policy_id is null then return null;end if;')
    expect(helper).toContain('if command_receipt.id is null then return null;end if;')
    expect(helper.indexOf('if command_receipt.id is null then return null;end if;')).toBeLessThan(helper.indexOf("if p_context->>'mode'"))
    expect(helper).not.toMatch(/(?:insert into|update|delete from|set_config|perform|execute)\s/i)
    expect(helper).not.toContain('read_scoped(')
    expect(helper).not.toContain('fund_roleplay_enter(')
    expect(helper).not.toContain('fund_roleplay_finish(')
    expect(helper).not.toContain('fund_roleplay_current_policy(')
  })

  it.each([
    ['wrong actor', 'saved.actor_id=auth.uid() and saved.request_key=p_key'],
    ['wrong key', 'source_lane.request_key is distinct from p_key'],
    ['wrong command', 'request_row.command is distinct from p_action'],
    ['wrong payload', 'request_row.payload is distinct from p_body'],
    ['wrong context', 'request_row.operating_context is distinct from p_context'],
    ['wrong current session', "source_lane.session_id::text is distinct from auth.jwt()->>'session_id'"],
    ['wrong receipt actor', 'receipt.actor_id is distinct from auth.uid()'],
    ['wrong receipt action', 'receipt.action is distinct from p_action'],
    ['wrong receipt payload', 'receipt.command_payload is distinct from p_body'],
    ['wrong product', 'source_lane.target_product_id is distinct from product.id'],
    ['wrong organisation', 'source_lane.product_organisation_id is distinct from product.organisation_id'],
    ['wrong saved policy', 'receipt.roleplay_policy_id is distinct from policy.id'],
    ['wrong epoch', 'receipt.roleplay_epoch is distinct from policy.authority_epoch'],
    ['wrong current offering', 'product.current_offering_revision_id is distinct from policy.offering_revision_id'],
    ['changed terms', 'offering.terms is distinct from product.terms'],
    ['revoked policy', "policy.status is distinct from 'ACTIVE'"],
    ['fake independence', 'policy.independence_proven is distinct from false'],
    ['wrong fund receipt policy', 'command_receipt.policy_id is distinct from policy.id'],
    ['wrong original source', 'source_lane.entitlement_id is distinct from appointment.test_workspace_entitlement_id'],
  ])('rejects the %s binding without creating or relabelling evidence', (_reason, fragment) => {
    expect(helper).toContain(fragment)
    expect(helper).toContain("raise exception 'fund_roleplay_appointment_commit_binding_changed' using errcode='42501'")
  })

  it('uses the still-current source lane plus genuine immutable fund receipt after finish consumed the fund lane', () => {
    for (const fragment of ['entered.transaction_id=pg_catalog.pg_current_xact_id() and entered.actor_id=auth.uid()',
      'source_lane.operating_context is distinct from p_context', 'source_lane.command is distinct from p_action',
      'source_lane.entitlement_revision is distinct from appointment.test_workspace_entitlement_revision',
      'test_offering_appointment_current(appointment.id) is not true',
      'saved.actual_actor_id=auth.uid() and saved.request_key=p_key', 'saved.action=p_action',
      'command_receipt.authority_epoch is distinct from policy.authority_epoch',
      'command_receipt.offering_revision_id is distinct from offering.id',
      'command_receipt.actual_person_id is distinct from policy.actual_operator_person_id',
      "command_receipt.assurance is distinct from 'TEST_ROLE_PLAY'", 'command_receipt.independence_proven is distinct from false',
    ]) expect(helper).toContain(fragment)
    expect(helper).not.toContain('fund_roleplay_lane_current(')
    expect(helper).not.toContain('test_offering_lane_current(')
    expect(helper).not.toContain('547776c9')
    expect(helper).not.toContain('0ba2b126')
  })

  it('rechecks genuine protected current policy/source and retains policy expiry, revocation and exact authority', () => {
    const currentGuard = 'fund_roleplay_record_current(policy.id,policy.authority_epoch,product.id,offering.id,auth.uid(),p_context,p_action) is not true'
    expect(helper.split(currentGuard)).toHaveLength(2)
    expect(helper.match(/test_roleplay_protected_session\(\) is not true/g)).toHaveLength(1)
    expect(helper).toContain('or (case when appointment.requested_by_user_id=auth.uid() and appointment.roleplay_context=p_context')
    expect(helper).toContain("and p_action='request_product_service_appointment' then false")
    expect(helper).toContain("appointment.roleplay_context,'request_product_service_appointment') is not true end)")
    expect(helper.match(/test_offering_appointment_current\(appointment.id\) is not true/g)).toHaveLength(1)
    expect(helper).not.toContain('test_offering_source_current(')
    const source = body(review, 'bx1_portal.test_offering_appointment_current')
    expect(source).toContain('test_offering_source_current(o.id,a.test_workspace_entitlement_id,a.test_workspace_entitlement_revision)')
    expect(source).not.toMatch(/a\.status|a\.requested_until/)
    const current = body(commands, 'bx1_private.fund_roleplay_record_current')
    expect(current).toContain('test_roleplay_binding_current(policy)')
    expect(current).toContain('saved.version=(select max(later.version)')
    expect(roleplay).toContain("r.status='ACTIVE' and r.valid_from<=pg_catalog.clock_timestamp() and r.valid_until>pg_catalog.clock_timestamp()")
    expect(helper.indexOf('fund_roleplay_appointment_commit_authority_changed')).toBeLessThan(helper.indexOf("'kind','TEST_FUND_APPOINTMENT_COMMIT'"))
  })

  it('emits exactly the agreed ACK shape, original command evidence and current appointment/session on replay', () => {
    const ack = helper.slice(helper.indexOf('return pg_catalog.jsonb_build_object('))
    for (const fragment of ["'kind','TEST_FUND_APPOINTMENT_COMMIT','version',1", "'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false",
      "'actor_id',auth.uid(),'session_id',(auth.jwt()->>'session_id')::uuid,'operating_context',p_context",
      "'policy_id',policy.id,'authority_epoch',policy.authority_epoch,'product_id',product.id,'offering_revision_id',offering.id",
      "'appointment_id',appointment.id,'appointment_revision',appointment.revision",
      "'request',pg_catalog.jsonb_build_object('command',request_row.command,'key',request_row.request_key,'payload',request_row.payload)",
      "'recorded_at',receipt.recorded_at",
    ]) expect(ack).toContain(fragment)
    expect(helper).toContain('appointment.revision<receipt.appointment_revision')
    expect(helper).not.toContain('appointment.revision is distinct from receipt.appointment_revision')
    expect(ack).not.toContain('snapshot')
    expect(ack.slice(ack.indexOf("'recorded_at'"))).not.toContain('session_id')
    expect(ack).not.toContain('command_payload')
    expect(ack).not.toContain('signing_address')
  })

  it('preflights the reviewed unchanged dependencies and preserves the native writer OID/ACL/security metadata', () => {
    expect(dependencies).toHaveLength(5)
    const finish = body(commands, 'bx1_private.fund_roleplay_finish')
      .replace(conflict.match(/old_fragment constant text:='([^']+)';/)![1], conflict.match(/new_fragment constant text:='([^']+)';/)![1])
    const sources = [body(roleplay, 'bx1_private.test_roleplay_protected_session'), body(commands, 'bx1_private.fund_roleplay_record_current'),
      body(review, 'bx1_portal.test_offering_source_current'), body(review, 'bx1_portal.test_offering_appointment_current'), finish]
    expect(sources.map(hash)).toEqual(dependencies.map(pin => pin.sha))
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", "before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text",
      "before_row->'prosecdef' is distinct from 'true'::jsonb", "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "before_row->'proargnames' is distinct from '[\"c\",\"action\",\"key\",\"body\"]'::jsonb",
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
      'fund_roleplay_appointment_commit_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql.indexOf('fund_roleplay_appointment_commit_native_pin_mismatch')).toBeLessThan(sql.indexOf('execute helper_definition'))
    expect(sql.indexOf('fund_roleplay_appointment_commit_cut_not_exactly_two')).toBeLessThan(sql.indexOf('execute helper_definition'))
  })

  it('creates only one private read helper and removes every non-owner default execute ACL atomically', () => {
    expect(sql.match(/create function /g)).toHaveLength(1)
    expect(sql).toContain('create function bx1_private.fund_roleplay_appointment_commit(')
    expect(sql).toContain('pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault(\'f\',p.proowner)))')
    expect(sql).toContain('a.grantee<>p.proowner')
    expect(sql).toContain("helper_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb")
    expect(sql).not.toMatch(/(?:grant|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('statement_timeout')
    expect(sql).not.toContain('fund_roleplay_provision')
  })
})
