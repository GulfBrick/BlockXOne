import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source regressions only; the hosted SQL proof and genuine wallet journey are
// separate acceptance evidence.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_recipient_allocation_gate.sql'), 'utf8')
describe('recipient registration to canonical allocation handoff', () => {
  it('pins both installed dependencies and retains the canonical function metadata', () => {
    expect(sql).toContain('a5b9e25b44b1bd28225d9b800898c441f6b3107b091b3df7e43cdb261b3b95b3')
    expect(sql).toContain('25e247d94561e70b585342439433359d93527adfe6a0fe55db2b9a7af5647386')
    expect(sql).toContain('fund_recipient_allocation_exact_source_required')
    expect(sql).toContain("pg_catalog.to_jsonb(p)-'prosrc'")
    expect(sql).toContain('before_metadata is distinct from after_metadata')
  })
  it('requires actual registration only for explicit TEST provenance, without rewriting old records or facts', () => {
    expect(sql).toContain('a.roleplay_policy_id is null or bx1_portal.fund_recipient_ready_for_allocation(a.id)')
    expect(sql).toContain("bx1_private.test_roleplay_environment() is not true")
    expect(sql).not.toMatch(/(?:insert into|update|delete from)\s+bx1_portal\./i)
    expect(sql).not.toContain('create function')
    expect(sql).toContain('replace(body,original,replacement)')
  })
})
