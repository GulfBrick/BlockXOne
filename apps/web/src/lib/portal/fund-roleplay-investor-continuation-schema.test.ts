import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static native-source proof only: not an approval, deployment, payment or holding.
const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_roleplay_investor_continuation.sql'), 'utf8').replace(/\r\n/g, '\n')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_fund_roleplay_investor_continuation.sql'), 'utf8').replace(/\r\n/g, '\n')
type Cut = { from: string; to: string; count: number }
type Spec = { oid: number; signature: string; sha: string; original: string; metadata: Record<string, unknown>; cuts: Cut[] }
const tagged = (name: string) => feature.match(new RegExp('\\$' + name + '\\$([\\s\\S]*?)\\$' + name + '\\$'))![1]
const specs = JSON.parse(tagged('specs')) as Spec[]
const dependencies = JSON.parse(tagged('dependencies')) as { oid: number; signature: string; sha: string; metadata: Record<string, unknown> }[]
const operational = tagged('operational_body')
const lane = tagged('lane_body')
const hash = (source: string) => createHash('sha256').update(source.trim()).digest('hex')
const occurrences = (source: string, fragment: string) => source.split(fragment).length - 1
const next = (id: number) => specs.find(spec => spec.oid === id)!.cuts.reduce((source, cut) => source.split(cut.from).join(cut.to), specs.find(spec => spec.oid === id)!.original)
const expected = [36417, 31496, 25738, 37275, 37285, 25748, 25754, 24447, 25740, 25744, 37279, 37280]

describe('same-app current TEST investor native continuation', () => {
  it('pins exactly twelve current native bodies and mechanically restores every original byte', () => {
    expect(specs.map(spec => spec.oid)).toEqual(expected)
    expect(new Set(specs.map(spec => spec.signature)).size).toBe(12)
    for (const spec of specs) {
      expect(hash(spec.original)).toBe(spec.sha)
      let changed = spec.original
      for (const cut of spec.cuts) {
        expect(occurrences(changed, cut.from)).toBe(cut.count)
        changed = changed.split(cut.from).join(cut.to)
      }
      expect(changed).not.toBe(spec.original)
      for (const cut of [...spec.cuts].reverse()) {
        expect(occurrences(changed, cut.to)).toBe(cut.count)
        changed = changed.split(cut.to).join(cut.from)
      }
      expect(changed).toBe(spec.original)
      expect(spec.metadata.proowner).toBe('16388')
      expect(spec.metadata.proconfig).toEqual(['search_path=""'])
    }
    expect(feature).toContain('restored is distinct from original')
    expect(feature).toContain("after_row-'prosrc' is distinct from spec->'metadata'")
    expect(feature).toContain('originals=12 and finals=0')
    expect(feature).toContain('originals=0 and finals=12')
    expect(feature).toContain('fund_investor_partial_installation_denied')
  })

  it('retains the three global strict helpers as unchanged pinned dependencies', () => {
    const globals = [24441, 25733, 25734]
    expect(globals.every(id => !expected.includes(id))).toBe(true)
    for (const id of globals) expect(dependencies.find(value => value.oid === id)?.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(dependencies.find(value => value.oid === 25733)?.sha).toBe('ab18307440fc29e6554dad3fc8051a394b10a6c15e1bcd823529094012c67d06')
    expect(dependencies.find(value => value.oid === 25734)?.sha).toBe('ce138ffe4c21e992116678f0f0295c009c5240f20512e46956b07ca811802978')
    expect(feature).toContain('fund_investor_dependency_or_trigger_mutated')
    expect(JSON.parse(tagged('expected_triggers'))).toHaveLength(6)
    expect(feature).not.toMatch(/alter table|create trigger|alter trigger|set_config\(/i)
  })

  it('adds only two closed SQL read helpers with full metadata checks and no trusted outcome writes', () => {
    for (const body of [operational, lane]) expect(body).not.toMatch(/\b(insert|update|delete|grant|revoke|set_config|execute|perform)\b/i)
    expect(feature).toContain("current_row-'prosrc'-'oid' is distinct from helper_spec->'metadata'")
    expect(feature).toContain('a.grantee<>p.proowner')
    expect(feature).toContain("case when permission.grantee=0 then 'public'")
    expect(feature).not.toMatch(/grant\s+(?:execute|select|update|insert)|create\s+(?:role|table)/i)
    for (const name of ['op_metadata', 'lane_metadata']) {
      const metadata = JSON.parse(tagged(name)) as Record<string, unknown>
      expect(metadata.proacl).toEqual(['postgres=X/postgres'])
      expect(metadata.prosecdef).toBe(true)
      expect(metadata.proconfig).toEqual(['search_path=""'])
      expect(metadata.provolatile).toBe('v')
      expect(metadata.pronargdefaults).toBe(0)
    }
  })

  it.each([
    'product_row.review_roleplay_policy_id=policy.id',
    'product_row.review_roleplay_epoch=policy.authority_epoch',
    'policy.offering_revision_id=product_row.current_offering_revision_id',
    'policy.terms_hash=product_row.terms_hash',
    'product_row.reviewer_id=product_row.created_by',
    "policy.status='ACTIVE' and policy.valid_until>pg_catalog.clock_timestamp()",
    'bx1_private.test_roleplay_environment() is true',
    'bx1_private.fund_roleplay_eligibility_organisation_current(policy.id,policy.authority_epoch,product_row.id) is true',
    'bx1_private.fund_roleplay_approved(product_row.id) is true',
    'bx1_portal.offering_technical_ready(product_row.current_offering_revision_id) is true',
  ])('requires actual saved operational evidence: %s', guard => {
    expect(operational).toContain(guard)
    expect(operational).not.toContain('fund_roleplay_eligibility_source(')
    expect(operational).not.toContain('fund_roleplay_eligibility_current(')
  })

  it.each([
    'lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()',
    'lane.product_id=p_product and lane.action=p_action',
    "lane.request_key<>'00000000-0000-0000-0000-000000000000'::uuid",
    '(p_key is null or lane.request_key=p_key)',
    '(p_context is null or lane.operating_context=p_context)',
    'bx1_private.test_roleplay_protected_session() is true',
    'bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action) is true',
    'bx1_private.fund_roleplay_investor_operational(lane.product_id,lane.policy_id,lane.authority_epoch) is true',
  ])('requires the exact actual command lane: %s', guard => expect(lane).toContain(guard))

  it('uses tagged-only selectors and action-specific trigger lanes, retaining original ordinary branches', () => {
    expect(next(31496)).toContain('case when m.roleplay_policy_id is not null then')
    expect(next(31496)).toContain('else bx1_portal.current_product_organisation(p.organisation_id) end')
    expect(next(25738)).toContain("old.status='APPROVED' and new.revision=old.revision+1")
    expect(next(25738)).toContain("fund_roleplay_manager_publish_lane(new.id,lane.request_key,lane.operating_context)")
    expect(next(25738)).toContain('else bx1_portal.offering_operational(new.id) end')
    expect(next(25748)).toContain("when TG_OP='INSERT' or new.status='SUBMITTED' then 'request_product_eligibility'")
    expect(next(25748)).toContain("when new.status='APPROVED' then 'review_product_eligibility'")
    expect(next(25740)).toContain("fund_roleplay_investor_write_lane(p.id,'subscribe',null,null)")
    for (const action of ['propose_funding_route', 'approve_funding_route', 'open_funding_obligation']) expect(next(25744)).toContain("'" + action + "',null,null)")
    expect(next(25744)).toContain("TG_TABLE_NAME='funding_routes' and TG_OP='INSERT'")
    expect(next(25744)).toContain("TG_TABLE_NAME='funding_obligations' and TG_OP='INSERT'")
    expect(occurrences(next(24447), "fund_roleplay_investor_write_lane(p.id,'subscribe',key,c)")).toBe(2)
  })

  it('enters subscribe before the outer precheck, inherits its lane inside and finishes without modifying old replay branches', () => {
    const outer = next(25754)
    const entry = "perform bx1_private.fund_roleplay_eligibility_enter(c,action,key,body-'offering_revision_id');"
    expect(occurrences(outer, entry)).toBe(1)
    expect(outer.indexOf(entry)).toBeLessThan(outer.indexOf("fund_roleplay_investor_write_lane(p.id,'subscribe',key,c)"))
    const spec = specs.find(value => value.oid === 25754)!
    const start = "  elsif action='subscribe' then"
    expect(outer.slice(0, outer.indexOf(start))).toBe(spec.original.slice(0, spec.original.indexOf(start)))
    expect(next(37279)).toContain("if action='subscribe' then")
    expect(next(37279)).toContain("and prior.operating_context=c and prior.command='subscribe' and prior.payload=body")
    expect(next(37279)).toContain('fund_roleplay_command_receipts receipt')
    expect(next(37279)).toContain('fund_roleplay_admission_product(account_row.application_id,product)')
    expect(next(37279)).toContain('perform bx1_private.fund_roleplay_enter(c,product,action,key,null)')
    expect(next(37280)).toContain("action in ('request_product_eligibility','subscribe')")
    expect(next(37280)).toContain('perform bx1_private.fund_roleplay_finish(c,product,action,key)')
  })

  it('requires all exact twenty-five graph steps with matching final observations, never counting Safe as infrastructure', () => {
    const cut = specs.find(spec => spec.oid === 36417)!.cuts[0]
    expect(cut.from).toContain("where setup_id=s.id and state='FINAL'")
    for (const guard of ['fund_setup_graph())<>25', 'step.step_key=graph.step_key', 'step.ordinal=graph.ordinal', 'step.kind=graph.kind',
      'observed.setup_id=s.id and observed.step_id=step.id', "step.state is distinct from 'FINAL'", "observed.result->>'status' is distinct from 'FINAL'",
      "observed.result->>'intent_hash' is distinct from step.intent_hash", "observed.result->>'transaction_hash' is distinct from step.transaction_hash",
      "step.step_key='safe_creation' and step.ordinal=0 and step.kind='CALL'", "observed.result->>'status'='VERIFIED_CODE_AND_STATE'",
    ]) expect(cut.to).toContain(guard)
    expect(next(36417)).not.toContain(cut.from)
  })

  it('retains actual-extracted native proof for fail-closed cases without claims or business rows', () => {
    for (const fragment of ['investor_operational_begin', 'investor_write_lane_begin', 'safe_plus_24', 'complete_26', 'reused_observation',
      'missing_safe_observation', 'wrong_safe_owners', 'fund_investor_proof_old_count_counterexample',
      'fund_investor_proof_manifest_fallback', 'fund_investor_proof_claims_changed',
    ]) expect(proof).toContain(fragment)
    expect(proof).not.toMatch(/\b(?:set_config|insert into|update bx1_|delete from|set role)\b/i)
    expect(proof).toContain('jsonb_to_recordset')
    expect(proof).toContain('before_claims')
  })
})
