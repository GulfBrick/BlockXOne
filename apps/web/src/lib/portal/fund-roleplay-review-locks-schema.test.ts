import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exact source contracts only. Real SQL installation, factor/session checks and
// positive hosted reviewer decisions are separate acceptance evidence.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (file: string) => readFileSync(resolve(directory, file), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_review_locks.sql')
const commands = read('bx1_fund_roleplay_commands.sql')
const manager = read('bx1_fund_roleplay_manager_bridge.sql')
const workflow = read('bx1_offering_workflow.sql')
const funding = read('bx1_portal_funding.sql')
const admission = read('bx1_admission_workflow.sql')
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
const compact = (value: string) => value.replace(/\s+/g, '')
type WriterSpec = { signature: string; sha: string; cut: 'ISSUER' | 'COMPLIANCE' }
type Dependency = { signature: string; owner: string; acl: string; sha: string }
const specifications = JSON.parse(sql.match(/\$specifications\$([\s\S]*?)\$specifications\$::jsonb/)![1]) as WriterSpec[]
const dependencies = JSON.parse(sql.match(/\$dependencies\$([\s\S]*?)\$dependencies\$::jsonb/)![1]) as Dependency[]
const commandBodies = JSON.parse(commands.match(/\$roleplay_specs\$([\s\S]*?)\$roleplay_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
const managerBodies = JSON.parse(manager.match(/\$manager_specs\$([\s\S]*?)\$manager_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
function fragment(name: string) { return sql.match(new RegExp(`${name} constant text:=\\$${name}\\$([\\s\\S]*?)\\$${name}\\$;`))![1] }
function body(source: string, name: string) {
  return source.match(new RegExp(`create function ${name.replace(/\./g, '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]
}

describe('two exact current TEST reviewer lock call corrections', () => {
  it('pins the actual current two native bodies and reverses only one exact call-site cut in each', () => {
    expect(specifications).toEqual([
      { signature: 'bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)', sha: '78fe020c0aba57a0b43f301bc4c1108878cc0c024123aaa50c31492ade1cfb7f', cut: 'ISSUER' },
      { signature: 'bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)', sha: 'f95a428f853a497b7fe64d4f33d5a19a9889305b6b21fdef626ade49b4343504', cut: 'COMPLIANCE' },
    ])
    for (const spec of specifications) {
      const original = (spec.cut === 'ISSUER' ? managerBodies : commandBodies).find(value => value.signature === spec.signature)!.next_body
      const from = fragment(`${spec.cut.toLowerCase()}_from`), to = fragment(`${spec.cut.toLowerCase()}_to`)
      expect(hash(original)).toBe(spec.sha)
      expect(original.split(from)).toHaveLength(2)
      const corrected = original.replace(from, to)
      expect(corrected.split(to)).toHaveLength(2)
      expect(corrected.replace(to, from)).toBe(original)
      expect(original.indexOf('fund_roleplay_enter(')).toBeLessThan(original.indexOf(from))
      expect(original.lastIndexOf('fund_roleplay_finish(')).toBeGreaterThan(original.indexOf(from))
      expect(corrected).toContain('return bx1_portal.read_scoped(c);')
      expect(corrected).toContain('product_common_envelope_review_replay_authority(')
    }
  })

  it('changes only the issuer branch and locks the identical user array only in its exact active lane', () => {
    const from = fragment('issuer_from'), to = fragment('issuer_to')
    expect(from).toContain("decision_kind='COMPLIANCE'")
    expect(to).toContain("c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' and action='review_offering_issuer'")
    expect(to).toContain('fund_roleplay_lane_current(c,p.id,action) is true')
    expect(to).toContain('locked.user_id is not null and locked.user_id is distinct from auth.uid()')
    const originalArray = compact(from.match(/array\[[\s\S]*?\]/)![0])
    expect(to.match(/array\[[\s\S]*?\]/g)!.map(compact)).toEqual([originalArray, originalArray, originalArray])
    expect(to).toContain('else\n      perform bx1_portal.offering_workflow_lock_people(')
  })

  it('preserves every explicit and historical same-terms lineage participant on both the guard and the acquired locks', () => {
    const from = fragment('compliance_from'), to = fragment('compliance_to')
    expect(to).toContain("c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'")
    expect(to).toContain("fund_roleplay_lane_current(c,p.id,'review_product') is true")
    expect(to).toContain('locked.user_id is not null and locked.user_id is distinct from auth.uid()')
    const explicitArray = compact(from.match(/array\[[\s\S]*?\]/)![0])
    expect(to.match(/array\[[\s\S]*?\]/g)!.map(compact)).toEqual([explicitArray, explicitArray, explicitArray])
    expect(to.match(/union select history\.submitted_by from bx1_portal\.offering_revisions history/g)).toHaveLength(2)
    expect(to.match(/history\.product_id=p\.id and history\.origin='SUBMITTED' and history\.terms_hash=r\.terms_hash/g)).toHaveLength(2)
    expect(to).toContain('admission_lock_people(array(select distinct locked.user_id')
    expect(to).toContain('where locked.user_id is not null order by locked.user_id)')
    expect(compact(to.split('else\n')[1])).toBe(compact(`${from}end if;`))
    const originalLineage = body(workflow, 'bx1_portal.offering_workflow_lock_lineage_people')
    expect(originalLineage).toContain('select pg_catalog.unnest(users) u union select r.submitted_by')
    expect(originalLineage).toContain("r.origin='SUBMITTED' and r.terms_hash=target_terms_hash")
    expect(originalLineage).toContain('array_agg(distinct u order by u)')
  })

  it('pins and preserves the existing helper owners, source and closed ACLs without grants', () => {
    const known = new Map([
      ['bx1_private.lock_funding_person(uuid,uuid)', body(funding, 'bx1_private.lock_funding_person')],
      ['bx1_portal.admission_lock_people(uuid[])', body(admission, 'bx1_portal.admission_lock_people')],
      ['bx1_portal.offering_workflow_lock_people(uuid[])', body(workflow, 'bx1_portal.offering_workflow_lock_people')],
      ['bx1_portal.offering_workflow_lock_lineage_people(uuid,text,uuid[])', body(workflow, 'bx1_portal.offering_workflow_lock_lineage_people')],
      ['bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)', body(commands, 'bx1_private.fund_roleplay_lane_current')],
    ])
    expect(dependencies).toHaveLength(6)
    for (const dependency of dependencies) {
      const source = known.get(dependency.signature)
      if (source !== undefined) expect(hash(source)).toBe(dependency.sha)
      else expect(dependency).toEqual({ signature: 'bx1_portal.lock_entity_people(uuid[])', owner: 'postgres',
        acl: '{postgres=X/postgres}', sha: 'cf4dde8eb823c839207922872abea9827f86be0a4a8835576b80971cdba22725' })
      expect(dependency.owner).toBe(dependency.signature.startsWith('bx1_private.lock_funding_person') ? 'bx1_authority_owner' : 'postgres')
    }
    expect(known.get('bx1_private.lock_funding_person(uuid,uuid)')).toContain('for share')
    expect(known.get('bx1_portal.admission_lock_people(uuid[])')).toContain('lock_funding_person(person_actor,null)')
    expect(known.get('bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)')).toContain('test_roleplay_current(')
    expect(sql).toContain('fund_roleplay_review_locks_dependency_mutated')
  })

  it('prepares both exact cuts before replacement and preserves every native OID, owner, ACL and security field', () => {
    expect(sql.match(/for spec in select value from pg_catalog\.jsonb_array_elements\(specifications\) loop/g)).toHaveLength(2)
    expect(sql.indexOf('fund_roleplay_review_locks_outside_cut_changed')).toBeLessThan(sql.indexOf('execute replace(definition,original,next_body)'))
    for (const item of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      'test_roleplay_environment() is not true', "where singleton and environment='TESTNET'",
      "before_row->'prosecdef' is distinct from 'true'::jsonb", "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "before_row->>'provolatile' is distinct from 'v'", "before_row->'proargnames' is distinct from (case",
      'replace(next_body,new_fragment,old_fragment) is distinct from original', 'writers_before->(spec->>\'signature\')',
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
    ]) expect(sql).toContain(item)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|update|delete from|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('read_scoped(')
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('fund_roleplay_finish(')
  })
})
