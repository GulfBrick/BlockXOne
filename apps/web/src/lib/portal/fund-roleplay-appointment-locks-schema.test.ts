import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract proof only, not SQL execution or a fabricated appointment,
// session, identity mapping, MFA factor or positive hosted approval.
const directory = resolve(process.cwd(), '../../supabase/features')
const sql = readFileSync(resolve(directory, 'bx1_fund_roleplay_appointment_locks.sql'), 'utf8').replace(/\r\n/g, '\n')
const commands = readFileSync(resolve(directory, 'bx1_fund_roleplay_commands.sql'), 'utf8').replace(/\r\n/g, '\n')
const funding = readFileSync(resolve(directory, 'bx1_portal_funding.sql'), 'utf8').replace(/\r\n/g, '\n')
const admission = readFileSync(resolve(directory, 'bx1_admission_workflow.sql'), 'utf8').replace(/\r\n/g, '\n')
const spec = JSON.parse(commands.match(/\{\s*"signature": "bx1_portal\.execute_product_service_appointment\(jsonb,text,uuid,jsonb\)"[\s\S]*?\n\s*\}/)![0]) as { next_body: string }
const original = spec.next_body
const cuts = JSON.parse(sql.match(/\$cuts\$([\s\S]*?)\$cuts\$::jsonb/)![1]) as { from: string; to: string }[]
const hash = (value: string) => createHash('sha256').update(value.replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
const compact = (value: string) => value.replace(/\s+/g, '')

describe('two scoped one-operator TEST appointment lock corrections', () => {
  it('pins the actual canonical command and changes exactly its two existing lock calls', () => {
    expect(hash(original)).toBe('1aef18f802784b11478bdbbd0682707256517dafb1c8923e10cb4723725efada')
    expect(sql).toContain('1aef18f802784b11478bdbbd0682707256517dafb1c8923e10cb4723725efada')
    expect(cuts).toHaveLength(2)
    expect(cuts[0].from).toBe("    perform bx1_portal.offering_workflow_lock_people(array[actor,(body->>'appointee_user_id')::uuid]);")
    expect(cuts[1].from).toBe('    perform bx1_portal.offering_workflow_lock_people(array[actor,a.requested_by_user_id,\n      a.appointee_user_id,a.reviewed_by_user_id]);')
    let corrected = original
    for (const cut of cuts) {
      expect(corrected.split(cut.from)).toHaveLength(2)
      corrected = corrected.replace(cut.from, cut.to)
    }
    for (const cut of cuts) {
      expect(corrected.split(cut.to)).toHaveLength(2)
      corrected = corrected.replace(cut.to, cut.from)
    }
    expect(corrected).toBe(original)
    expect(sql).toContain('restored is distinct from original')
  })
  it('uses the identical user arrays only in a current exact role-play lane with no foreign non-null participant', () => {
    for (const cut of cuts) {
      expect(cut.to).toContain('if bx1_private.fund_roleplay_lane_current(c,p.id,action) is true')
      expect(cut.to).toContain('and not exists(select 1 from pg_catalog.unnest(array[')
      expect(cut.to).toContain('where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then')
      expect(cut.to).toContain('perform bx1_portal.admission_lock_people(array[')
      const originalArray = compact(cut.from.match(/array\[[\s\S]*?\]/)![0])
      const replacementArrays = cut.to.match(/array\[[\s\S]*?\]/g)!
      expect(replacementArrays).toHaveLength(3)
      expect(replacementArrays.map(compact)).toEqual([originalArray, originalArray, originalArray])
      expect(compact(cut.to.split('else\n')[1])).toBe(compact(`${cut.from}end if;`))
    }
    expect(original.indexOf('fund_roleplay_enter(')).toBeLessThan(original.indexOf(cuts[0].from))
    expect(original.indexOf('fund_roleplay_finish(')).toBeGreaterThan(original.indexOf(cuts[1].from))
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('set_config(')
  })
  it('pins and reuses the existing authority-owner lock without changing its source or privileges', () => {
    const authority = funding.match(/create function bx1_private\.lock_funding_person\(actor uuid,expected_person uuid default null\) returns void[\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
    expect(hash(authority)).toBe('f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    expect(sql).toContain('f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    expect(authority).toContain('where pp.auth_user_id=actor for share')
    expect(authority).toContain('where p.id=coalesce(expected_person,linked_person) for share')
    expect(admission).toContain('perform bx1_private.lock_funding_person(person_actor,null);')
    expect(sql).toContain("helper_row->>'proowner' is distinct from 'bx1_authority_owner'::regrole::oid::text")
    expect(sql).toContain("where p.oid=authority) is distinct from helper_row")
  })
  it('retains the TEST owner, native OID/ACL/security metadata and all original decision/authority checks', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres'", "where singleton and environment='TESTNET'",
      "before_row->'prosecdef' is distinct from 'true'::jsonb", "before_row->>'proacl' is distinct from '[\"postgres=X/postgres\"]'",
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
      'fund_roleplay_appointment_locks_cut_not_unique', 'fund_roleplay_appointment_locks_result_not_unique',
    ]) expect(sql).toContain(fragment)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|update|delete from|alter table|alter role)\s/i)
    for (const fragment of ['product_appointment_idempotency_conflict', 'product_appointment_expiry_invalid',
      'native_membership_effective(m.id)', 'fund_roleplay_review_exception(c,p.id,action)',
      'product_appointment_context_changed', 'fund_roleplay_finish(c,p.id,action,key)']) expect(original).toContain(fragment)
  })
})
