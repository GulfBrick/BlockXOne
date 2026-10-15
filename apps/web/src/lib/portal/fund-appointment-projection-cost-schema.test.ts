import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source/equivalence checks only, not native execution, performance acceptance
// or a fabricated authorised actor. Hosted revalidation remains separate.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_appointment_projection_cost.sql')
const manager = read('bx1_fund_roleplay_manager_bridge.sql')
const specs = JSON.parse(manager.match(/\$manager_specs\$([\s\S]*?)\$manager_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
const original = specs.find(spec => spec.signature === 'bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)')!.next_body
const cuts = JSON.parse(sql.match(/\$cuts\$([\s\S]*?)\$cuts\$::jsonb/)![1]) as { from: string; to: string; count: number }[]
const corrected = cuts.reduce((source, cut) => source.replaceAll(cut.from, cut.to), original)
type SqlBoolean = boolean | null
const values: SqlBoolean[] = [true, false, null]
const and = (...items: SqlBoolean[]): SqlBoolean => items.includes(false) ? false : items.includes(null) ? null : true
const equal = (status: string | null, target: string): SqlBoolean => status === null ? null : status === target

describe('same-invocation offering appointment projection cost', () => {
  it('pins and reversibly changes only the exact native projection', () => {
    expect(createHash('sha256').update(original.trim()).digest('hex')).toBe('8181a55d422897b1a57c265594ba0faae3dc29a708a020503db1b68f9997063f')
    expect(sql).toContain('target is distinct from 29609::oid')
    expect(sql).toContain("before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb")
    expect(sql).toContain("before_row->'proargnames' is distinct from '[\"c\",\"target_id\"]'::jsonb")
    expect(sql).toContain("after_row-'prosrc' is distinct from before_row-'prosrc'")
    let next = original
    for (const cut of cuts) {
      expect(next.split(cut.from)).toHaveLength(cut.count + 1)
      next = next.replaceAll(cut.from, cut.to)
    }
    expect(next).toBe(corrected)
    for (const cut of [...cuts].reverse()) {
      expect(next.split(cut.to)).toHaveLength(cut.count + 1)
      next = next.replaceAll(cut.to, cut.from)
    }
    expect(next).toBe(original)
  })

  it('evaluates effectiveness once only after the unchanged row visibility check', () => {
    const call = 'bx1_portal.offering_workflow_product_appointment_effective(a.id)'
    expect(original.split(call)).toHaveLength(3)
    expect(corrected.split(call)).toHaveLength(2)
    expect(corrected).toContain(`is_effective:=${call};`)
    expect(corrected).toContain("'effective',is_effective")
    expect(corrected).toContain("when a.status='APPLIED' and is_effective is not true")
    expect(corrected.indexOf('is_effective:=')).toBeGreaterThan(corrected.indexOf('if not(is_manager or is_reviewer or is_admin or is_appointee) then return null'))
    expect(sql).toContain('dependency is distinct from 29596::oid')
    expect(sql).toContain('fda841224e159fdcb5bb86e656d127e334b3caf263bf4f50f502583117a295ba')
    expect(sql).not.toMatch(/create (?:or replace )?function|set_config|statement_timeout|grant\s/i)
  })

  it('wraps the original action expressions without removing any authority or expiry predicate', () => {
    const review = original.split("'can_review',")[1].split(",\n    'can_apply',")[0]
    const apply = original.split("'can_apply',")[1].split(",\n    'can_revoke',")[0]
    const revoke = original.split("'can_revoke',")[1].split(');\nend')[0]
    expect(corrected).toContain(`'can_review',case when is_reviewer is false or a.status<>'SUBMITTED' then false else ${review} end,`)
    expect(corrected).toContain(`'can_apply',case when is_admin is false or a.status<>'APPROVED' then false else ${apply} end,`)
    expect(corrected).toContain(`'can_revoke',case when is_admin is false or a.status<>'APPLIED' then false else ${revoke} end);`)
    expect(corrected.split('a.requested_until>pg_catalog.clock_timestamp()')).toHaveLength(3)
    expect(corrected.split('bx1_private.fund_roleplay_review_exception(')).toHaveLength(7)
    expect(corrected.split('bx1_portal.offering_workflow_appointment_source_current(a.id)')).toHaveLength(3)
  })

  it.each(['SUBMITTED', 'APPROVED', 'APPLIED'])('preserves SQL TRUE/FALSE/NULL across the %s action gate', target => {
    for (const role of values) for (const status of [target, 'OTHER', null]) {
      for (const source of values) for (const time of values) for (const first of values) for (const second of values) {
        const originalTruth = and(role, equal(status, target), source, time, first, second)
        // CASE WHEN treats unknown as not selected; role IS FALSE does not
        // collapse NULL. Even a future nullable status therefore falls through.
        const gatedTruth = role === false || (status !== null && status !== target) ? false : originalTruth
        expect(gatedTruth).toBe(originalTruth)
      }
    }
  })

  it('pins the relied-on column types/nullability and changes no final reader or writer', () => {
    expect(sql).toContain("attname='status' and attnum>0 and not attisdropped and attnotnull and atttypid='text'::regtype")
    expect(sql).toContain("attname='requested_until' and attnum>0 and not attisdropped and attnotnull and atttypid='timestamptz'::regtype")
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null")
    expect(sql).toContain("environment='TESTNET'")
    expect(sql).not.toMatch(/execute_scoped|execute_command|read_scoped_pre_test_workspace|alter function|alter role/i)
    const source = corrected.replace(/'(?:''|[^'])*'/g, "''").replace(/--[^\n]*/g, '')
    let depth = 0
    for (const character of source) {
      if (character === '(') depth++
      if (character === ')') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })
})
