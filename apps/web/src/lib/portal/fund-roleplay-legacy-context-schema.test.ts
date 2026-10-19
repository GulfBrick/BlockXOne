import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract regression only: these assertions do not execute SQL, create
// a session/policy/approval or prove a positive hosted business journey.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (file: string) => readFileSync(resolve(directory, file), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_legacy_context.sql')
const review = read('bx1_test_workspace_offering_review.sql')
const monitoring = read('bx1_test_workspace_product_monitoring.sql')
const alias = read('bx1_test_workspace_review_alias.sql')
const commands = read('bx1_fund_roleplay_commands.sql')
const manager = read('bx1_fund_roleplay_manager_bridge.sql')
const roleplay = read('bx1_fund_test_roleplay.sql')
type Cut = { from: string; to: string }
type Spec = { signature: string; sha: string; language: string; result: string; argnames: string[]; changes: Cut[] }
type Pin = { signature: string; sha: string }
const specs = JSON.parse(sql.match(/\$specs\$([\s\S]*?)\$specs\$::jsonb/)![1]) as Spec[]
const dependencies = JSON.parse(sql.match(/\$dependencies\$([\s\S]*?)\$dependencies\$::jsonb/)![1]) as Pin[]
const hash = (value: string) => createHash('sha256').update(value.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
const body = (source: string, name: string) => source.match(new RegExp(`create function ${name.replace(/\./g, '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]
const mutationSignature = 'bx1_portal.test_workspace_product_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)'
const reviewSpecs = JSON.parse(review.match(/\$test_offering_specs\$([\s\S]*?)\$test_offering_specs\$::jsonb/)![1]) as (Spec & { changes: (Cut & { count: number })[] })[]
let mutation = body(monitoring, 'bx1_portal.test_workspace_product_mutation')
for (const cut of reviewSpecs.find(spec => spec.signature === mutationSignature)!.changes) mutation = mutation.replace(cut.from, cut.to)
mutation = mutation.replace(alias.match(/old_fragment text:=\$old\$([\s\S]*?)\$old\$/)![1], alias.match(/new_fragment text:=\$new\$([\s\S]*?)\$new\$/)![1])
const originals = [body(review, 'bx1_portal.test_offering_lane_current'), body(review, 'bx1_portal.test_offering_review_mutation'), mutation]
const corrected = (index: number) => specs[index].changes.reduce((value, cut) => value.replace(cut.from, cut.to), originals[index])

describe('three retained preparation-source/current TEST fund-policy boundaries', () => {
  it('pins exactly the current three canonical native bodies reconstructed from retained source', () => {
    expect(specs.map(({ signature, sha }) => ({ signature, sha }))).toEqual([
      { signature: 'bx1_portal.test_offering_lane_current(jsonb,uuid,uuid,text)', sha: 'bdaca8d9835ac8d58879ef4d0605d2dac9819475672d9619b6a1d50e79e8ec23' },
      { signature: 'bx1_portal.test_offering_review_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)', sha: '5b6cb07e393c5c170e3d18fadb27273731c28d0b35ee202ec1df7ab372d111d5' },
      { signature: mutationSignature, sha: '094daabfea9a0c068e8e1dcccdf2107cf96f0001ab9b011e448ccb0ec800aa28' },
    ])
    expect(specs.map(spec => spec.changes.length)).toEqual([1, 1, 1])
    expect(specs.map(spec => spec.language)).toEqual(['sql', 'plpgsql', 'plpgsql'])
    expect(originals.map(hash)).toEqual(specs.map(spec => spec.sha))
    for (let index = 0; index < specs.length; index += 1) {
      let value = originals[index]
      for (const cut of specs[index].changes) {
        expect(value.split(cut.from)).toHaveLength(2)
        value = value.replace(cut.from, cut.to)
      }
      for (const cut of [...specs[index].changes].reverse()) {
        expect(value.split(cut.to)).toHaveLength(2)
        value = value.replace(cut.to, cut.from)
      }
      expect(value).toBe(originals[index])
    }
  })

  it('adds only exact request-appointment manager context while retaining the entire original source lane', () => {
    const cut = specs[0].changes[0]
    expect(cut.from).toBe('bx1_portal.test_offering_context(c)')
    expect(corrected(0)).toBe(originals[0].replace(cut.from, cut.to))
    for (const fragment of ["c->>'mode'='ROLE' and c->>'role'='OfferingManager'", "action='request_product_service_appointment'",
      'fund_roleplay_manager_current(c,target_product,action) is true', 'fund_roleplay_lane_current(c,target_product,action) is true',
      'fund_lane.transaction_id=pg_catalog.pg_current_xact_id() and fund_lane.actor_id=auth.uid()',
      'fund_lane.product_id=test_offering_lane_current.target_product', 'fund_lane.operating_context=test_offering_lane_current.c',
      'fund_lane.action=test_offering_lane_current.action', 'fund_lane.request_key=test_offering_lane_current.key',
    ]) expect(cut.to).toContain(fragment)
    const oldSourceLane = originals[0].slice(originals[0].indexOf(' and exists(select 1 from bx1_private.test_workspace_product_commands'))
    expect(corrected(0).endsWith(oldSourceLane)).toBe(true)
    for (const fragment of ["lane.session_id::text=auth.jwt()->>'session_id'", 'lane.operating_context=c',
      'lane.target_product_id=target_product and lane.request_key=key and lane.command=action',
      'test_offering_source_current(p.organisation_id,lane.entitlement_id,lane.entitlement_revision)',
    ]) expect(oldSourceLane).toContain(fragment)
    expect(cut.to).not.toContain("action in (")
  })

  it('waives only true human independence for the actual same creator in the exact entered review lane', () => {
    const cut = specs[1].changes[0]
    expect(cut.from).toBe('bx1_portal.offering_workflow_people_independent(auth.uid(),new_creator)')
    for (const fragment of ['new_creator=auth.uid()', 'fund_roleplay_review_exception(lane.operating_context,new_id,lane.command) is true',
      'fund_roleplay_lane_current(lane.operating_context,new_id,lane.command) is true',
      'fund_lane.transaction_id=pg_catalog.pg_current_xact_id() and fund_lane.actor_id=auth.uid()',
      'fund_lane.product_id=test_offering_review_mutation.new_id', 'fund_lane.operating_context=lane.operating_context',
      'fund_lane.action=lane.command', 'fund_lane.request_key=lane.request_key',
    ]) expect(cut.to).toContain(fragment)
    expect(corrected(1)).toContain(`${cut.to} is not true then`)
    for (const fragment of ["lane.command not in ('review_product','review_offering_issuer')", "operation<>'UPDATE'",
      'old_org is distinct from new_org or old_creator is distinct from new_creator',
      'test_offering_lock_source(new_org,lane.entitlement_id,lane.entitlement_revision)',
      'test_offering_revision_current(p.current_offering_revision_id)', 'test_offering_appointed(lane.operating_context,new_id,',
      'test_offering_compliance_transition_denied', 'test_offering_issuer_transition_denied',
    ]) expect(corrected(1)).toContain(fragment)
    expect(corrected(1).match(/test_offering_lane_current\(lane.operating_context,new_id,lane.request_key,lane.command\) is not true/g)).toHaveLength(2)
    expect(body(commands, 'bx1_private.fund_roleplay_review_exception')).toContain('NOT an assertion that two actor IDs')
  })

  it('permits only APPROVED to PUBLISHED UPDATE at revision plus one with an unchanged creator, organisation and package', () => {
    const cut = specs[2].changes[0]
    expect(cut.from).toBe('declare lane bx1_private.test_workspace_product_commands; grant_id uuid;\nbegin\n')
    for (const fragment of ['entered.transaction_id=pg_catalog.pg_current_xact_id() and entered.actor_id=auth.uid()',
      'entered.product_id=test_workspace_product_mutation.new_id for update', "if fund_lane.action='publish_product' then",
      "operation is distinct from 'UPDATE'", 'old_org is distinct from new_org', 'old_creator is distinct from new_creator',
      'new_creator is distinct from auth.uid()', "old_status is distinct from 'APPROVED' or new_status is distinct from 'PUBLISHED'",
      'old_revision is null or old_revision<1 or new_revision is distinct from old_revision+1',
      "fund_lane.operating_context->>'mode' is distinct from 'ROLE'", "fund_lane.operating_context->>'role' is distinct from 'OfferingManager'",
      'product.id=test_workspace_product_mutation.new_id', 'product.organisation_id=test_workspace_product_mutation.new_org',
      'product.created_by=test_workspace_product_mutation.new_creator', 'product.status=test_workspace_product_mutation.old_status',
      'product.revision=test_workspace_product_mutation.old_revision', 'product.current_offering_revision_id=fund_lane.offering_revision_id',
      'fund_roleplay_legacy_publication_transition_denied', 'fund_roleplay_legacy_publication_authority_changed',
    ]) expect(cut.to).toContain(fragment)
    const guard = 'fund_roleplay_manager_publish_lane(new_id,fund_lane.request_key,fund_lane.operating_context) is not true'
    expect(cut.to.split(guard)).toHaveLength(3)
    const sourceLock = cut.to.indexOf('perform bx1_portal.test_offering_lock_source(new_org);')
    expect(sourceLock).toBeGreaterThan(cut.to.indexOf(guard))
    expect(sourceLock).toBeLessThan(cut.to.lastIndexOf(guard))
    expect(cut.to.trimEnd().endsWith('return;\n  end if;')).toBe(true)
    expect(corrected(2).endsWith(originals[2].slice(cut.from.length))).toBe(true)
    expect(cut.to).not.toMatch(/(?:update|insert into|delete from)\s+bx1_/i)
    const publish = body(manager, 'bx1_private.fund_roleplay_manager_publish_lane')
    for (const fragment of ["lane.action='publish_product'", 'lane.request_key=key', '(c is null or lane.operating_context=c)',
      'fund_roleplay_lane_current(', 'fund_roleplay_manager_current(', 'fund_roleplay_manager_offering_approved(', 'offering_technical_ready(',
    ]) expect(publish).toContain(fragment)
  })

  it.each([
    ['wrong actor', 'p_actor is distinct from auth.uid()'],
    ['wrong organisation', "policy.native_organisation_id::text=p_context->>'organisationId'"],
    ['wrong product', 'policy.product_id=p_product'],
    ['missing policy', 'policy.id=p_policy'],
    ['revoked policy', "r.status='ACTIVE'"],
    ['expired policy', 'r.valid_until>pg_catalog.clock_timestamp()'],
    ['stale authority epoch', '(p_epoch is null or p_epoch=policy.authority_epoch)'],
  ])('retains the delegated fail-closed guard for %s rather than inventing a new authority predicate', (_case, fragment) => {
    expect(roleplay).toContain(fragment)
    expect(specs[0].changes[0].to).toContain('fund_roleplay_lane_current(')
    expect(specs[1].changes[0].to).toContain('fund_roleplay_lane_current(')
    expect(specs[2].changes[0].to).toContain('fund_roleplay_manager_publish_lane(')
  })

  it('rejects wrong keys/currentness through the original private policy and source contracts, including after source-lock waits', () => {
    expect(specs[0].changes[0].to).toContain('fund_lane.request_key=test_offering_lane_current.key')
    expect(specs[1].changes[0].to).toContain('fund_lane.request_key=lane.request_key')
    const lane = body(commands, 'bx1_private.fund_roleplay_lane_current')
    for (const fragment of ['test_roleplay_current(lane.policy_id,lane.product_id,lane.offering_revision_id,lane.actor_id,',
      'lane.operating_context,lane.action,null,lane.authority_epoch)', 'fund_roleplay_record_current(lane.policy_id,lane.authority_epoch,',
    ]) expect(lane).toContain(fragment)
    const current = body(manager, 'bx1_private.fund_roleplay_manager_current')
    for (const fragment of ['test_roleplay_protected_session()', "policy.project_ref='fegnnnlseuejkrusbbkv'", "policy.environment='TESTNET'",
      'source.native_organisation_id', 'organisation.reviewer_scope=policy.native_organisation_id',
      'test_offering_source_current(organisation.id,preparation.id,preparation.revision)',
      'p.current_offering_revision_id=policy.offering_revision_id and p.terms_hash=policy.terms_hash',
      'policy.version=(select max(later.version)', 'fund_roleplay_record_current(', 'test_roleplay_current(',
    ]) expect(current).toContain(fragment)
    expect(sql).not.toContain('547776c9')
    expect(sql).not.toContain('0ba2b126')
    expect(sql).not.toContain('4f681a71')
  })

  it('preflights all targets and pins before any DDL and preserves OIDs, metadata, private ACLs and every dependency', () => {
    expect(dependencies).toHaveLength(5)
    const sources = [commands, manager, manager, commands, review]
    for (let index = 0; index < dependencies.length; index += 1) {
      const name = dependencies[index].signature.split('(')[0]
      expect(hash(body(sources[index], name))).toBe(dependencies[index].sha)
    }
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", 'test_roleplay_environment() is not true',
      "before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text", "before_row->'prosecdef' is distinct from 'true'::jsonb",
      "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb", "before_row->'proargnames' is distinct from spec->'argnames'",
      "before_row is distinct from snapshots->(spec->>'signature')", "after_row-'prosrc' is distinct from before_row-'prosrc'",
      "after_row->>'prosrc' is distinct from next_body", 'restored is distinct from original',
      'fund_roleplay_legacy_context_cut_not_unique', 'fund_roleplay_legacy_context_result_not_unique',
      'fund_roleplay_legacy_context_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql.match(/for spec in select value from pg_catalog\.jsonb_array_elements\(specs\) loop/g)).toHaveLength(2)
    expect(sql.indexOf('snapshots:=snapshots||pg_catalog.jsonb_build_object(spec')).toBeLessThan(sql.indexOf('execute replace(definition,original,next_body)'))
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|delete from|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('test_workspace_source_id=')
    expect(sql).not.toContain('test_workspace_entitlement_id=')
  })
})
