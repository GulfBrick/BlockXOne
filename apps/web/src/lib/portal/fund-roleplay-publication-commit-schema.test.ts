import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static source contracts only: no authenticated session, publication, native
// execution or known-commit outcome is manufactured by these assertions.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_publication_commit.sql')
const manager = read('bx1_fund_roleplay_manager_bridge.sql')
const locks = read('bx1_fund_roleplay_review_locks.sql')
const submit = read('bx1_test_workspace_submit_readback.sql')
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
type Cut = { from: string; to: string; count: number }
type Spec = { signature: string; oid: number; sha: string; args: string[]; cuts: Cut[] }
const specs = JSON.parse(sql.match(/\$specs\$([\s\S]*?)\$specs\$::jsonb/)![1]) as Spec[]
const managerSpecs = JSON.parse(manager.match(/\$manager_specs\$([\s\S]*?)\$manager_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
const helper = sql.match(/as \$function\$([\s\S]*?)\$function\$;/)![1]
const issuerFrom = locks.match(/\$issuer_from\$([\s\S]*?)\$issuer_from\$/)![1]
const issuerTo = locks.match(/\$issuer_to\$([\s\S]*?)\$issuer_to\$/)![1]
const publisher = manager.match(/create function bx1_private\.fund_roleplay_manager_publish\(c jsonb,key uuid,body jsonb\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
const bodies = new Map<string, string>([
  ['bx1_portal.execute_command_pre_entry(text,uuid,jsonb)', managerSpecs.find(value => value.signature === 'bx1_portal.execute_command_pre_entry(text,uuid,jsonb)')!.next_body],
  ['bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)', managerSpecs.find(value => value.signature === 'bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)')!.next_body.replace(issuerFrom, issuerTo)],
  ['bx1_private.fund_roleplay_manager_publish(jsonb,uuid,jsonb)', publisher],
])

function patched(spec: Spec, original: string) {
  let next = original
  for (const cut of spec.cuts) {
    expect(next.split(cut.from)).toHaveLength(cut.count + 1)
    next = next.replaceAll(cut.from, cut.to)
  }
  let restored = next
  for (const cut of [...spec.cuts].reverse()) {
    expect(restored.split(cut.to)).toHaveLength(cut.count + 1)
    restored = restored.replaceAll(cut.to, cut.from)
  }
  expect(restored).toBe(original)
  return next
}

describe('exact TEST fund publication commit/read separation', () => {
  it('pins four retained targets and byte-restores every changed site of the independently retained bodies', () => {
    expect(specs.map(value => value.oid)).toEqual([24343, 24447, 25754, 37218])
    expect(specs.map(value => value.cuts.map(cut => cut.count))).toEqual([[2], [1], [1], [1, 1]])
    for (const spec of specs) {
      const original = bodies.get(spec.signature)
      if (original) { expect(hash(original)).toBe(spec.sha); patched(spec, original) }
    }
    // P2 has several separately accepted historical recipes. Its complete live
    // body is pinned by installation; this assertion checks only the unchanged
    // final tail and preserves the existing submit-only continuation contract.
    const p2 = specs[1]
    expect(p2.sha).toBe('55ce4d753f99118c8e791a087b003a43363ba6182776181087c33a8715b778e9')
    expect(p2.cuts[0].from).toBe('  return bx1_portal.read_scoped(c);\nend')
    expect(submit).toContain(p2.cuts[0].from)
    expect(p2.cuts[0].to.endsWith(p2.cuts[0].from)).toBe(true)
    expect(sql).toContain('restored is distinct from original')
  })

  it('suppresses only exact current private publication-lane reads, keeping ordinary returns and all writes', () => {
    const base = patched(specs[0], bodies.get(specs[0].signature)!)
    expect(base.match(/if command='publish_product' and bx1_private\.fund_roleplay_manager_publish_lane\(/g)).toHaveLength(2)
    expect(specs[0].cuts[0].to).toBe("      return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');")
    expect(base).toContain("update bx1_portal.products set status='PUBLISHED',revision=revision+1,published_at=v_now")
    expect(base).toContain('insert into bx1_portal.requests(actor_id,request_key,command,payload)')
    expect(base).toContain('insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)')
    expect(base).toContain('return bx1_portal.read_state();')
    for (const spec of specs.slice(1, 3)) {
      const cut = spec.cuts[0]
      expect(cut.to).toContain("if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then")
      expect(cut.to).toContain("'internal_continuation','TEST_FUND_PUBLICATION'")
      expect(cut.to.endsWith(cut.from)).toBe(true)
    }
    const offering = patched(specs[2], bodies.get(specs[2].signature)!)
    expect(offering).toContain("raise exception 'offering_issuer_and_compliance_approval_required'")
    expect(offering).toContain("raise exception 'offering_technical_readiness_required'")
    expect(offering).toContain("raise exception 'offering_context_changed'")
    expect(specs[2].cuts[0].to).toContain('perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n    return pg_catalog.jsonb_build_object')
  })

  it('keeps original outer finish for new commands and replays before either receipt-only return', () => {
    const spec = specs[3], corrected = patched(spec, publisher)
    for (const cut of spec.cuts) {
      expect(cut.from).toContain("perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);")
      expect(cut.to).toContain("perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);")
      expect(cut.to).toContain('return bx1_private.fund_roleplay_publication_commit(c,key,body);')
    }
    for (const fragment of ['fund_roleplay_manager_publish_replay_conflict', 'fund_roleplay_manager_approved_ready_offering_required',
      'result:=bx1_portal.execute_scoped_pre_monitoring', 'fund_roleplay_manager_publish_changed_at_commit',
    ]) expect(corrected).toContain(fragment)
    expect(helper).not.toContain('fund_roleplay_lane_current(')
    expect(helper).not.toContain('fund_roleplay_manager_publish_lane(')
  })

  it.each([
    ['wrong actual actor/key', "saved.actual_actor_id=auth.uid() and saved.request_key=p_key and saved.action='publish_product'"],
    ['missing canonical receipts', 'fund_receipt.id is null or base_request.actor_id is null or scoped_request.actor_id is null'],
    ['different base payload', 'base_request.command is distinct from \'publish_product\' or base_request.payload is distinct from p_body'],
    ['different scoped payload', 'scoped_request.command is distinct from \'publish_product\' or scoped_request.payload is distinct from p_body'],
    ['different scope', 'scoped_request.operating_context is distinct from p_context'],
    ['wrong creator', 'publication.created_by is distinct from auth.uid()'],
    ['non-advancing revision', "publication.revision<(p_body->>'expected_revision')::integer+1"],
    ['wrong current offering', 'saved_policy.offering_revision_id is distinct from offering_row.id'],
    ['changed terms', 'saved_policy.terms_hash is distinct from publication.terms_hash'],
    ['wrong native organisation', "saved_policy.native_organisation_id::text is distinct from p_context->>'organisationId'"],
    ['wrong policy epoch', 'fund_receipt.authority_epoch is distinct from saved_policy.authority_epoch'],
    ['wrong actor person', 'fund_receipt.actual_person_id is distinct from saved_policy.actual_operator_person_id'],
    ['false independence', 'fund_receipt.independence_proven is distinct from false'],
    ['expired/revoked source, policy or session', "fund_roleplay_manager_current(p_context,publication.id,'publish_product') is not true"],
    ['superseded saved authority', "publication.id,offering_row.id,auth.uid(),p_context,'publish_product') is not true"],
  ])('rejects the %s mismatch without a replacement command', (_reason, fragment) => {
    expect(helper).toContain(fragment)
  })

  it('matches the strict TEST-only wire and keeps historical confirmation separate from current state', () => {
    for (const fragment of ["'kind','TEST_FUND_PUBLICATION_COMMIT','version',1", "'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false",
      "'session_id',(auth.jwt()->>'session_id')::uuid", "'product_revision',publication.revision",
      "'request',pg_catalog.jsonb_build_object('command','publish_product','key',p_key,'payload',base_request.payload)",
      "'recorded_at',fund_receipt.recorded_at",
    ]) expect(helper).toContain(fragment)
    expect(helper).not.toContain("'status','PUBLISHED'")
    expect(helper).not.toContain("'published_at'")
    expect(helper).not.toMatch(/(?:insert into|update|delete from|set_config|perform|execute)\s/i)
  })

  it('preflights all bodies atomically and retains native OID/owner/ACL plus private helper ACL closure', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "target is distinct from (spec->>'oid')::oid", "after_row-'prosrc' is distinct from before_row-'prosrc'",
      "after_row->>'prosrc' is distinct from next_body", 'pg_catalog.aclexplode', 'a.grantee<>p.proowner',
      'fund_roleplay_publication_commit_target_changed_before_cut', 'fund_roleplay_publication_commit_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql.indexOf('execute helper_definition;')).toBeGreaterThan(sql.indexOf('prepared:=prepared||'))
    expect(sql).not.toMatch(/(?:grant|alter table|alter role)\s/i)
  })
})
