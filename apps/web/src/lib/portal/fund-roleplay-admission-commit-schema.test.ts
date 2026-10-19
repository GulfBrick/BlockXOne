import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static source contract only. A cloud SQL predicate proof is not a hosted journey.
const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_roleplay_admission_commit.sql'), 'utf8').replace(/\r\n/g, '\n')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_fund_roleplay_admission_commit.sql'), 'utf8').replace(/\r\n/g, '\n')
const tagged = (source: string, tag: string) => {
  const marker = '$' + tag + '$'
  const parts = source.split(marker)
  if (parts.length !== 3) throw new Error('Expected one paired native source tag: ' + tag)
  return parts[1]
}
const original = tagged(feature, 'native_original')
const formatter = tagged(feature, 'helper_body')
const dependencies = JSON.parse(tagged(feature, 'dependencies')) as { oid: string; sha: string; metadata: Record<string, unknown> }[]
const metadata = JSON.parse(tagged(feature, 'target_metadata')) as Record<string, unknown>
const helperMetadata = JSON.parse(tagged(feature, 'helper_metadata')) as Record<string, unknown>
const oldReturn = 'return bx1_portal.read_scoped(c);'
const newReturn = 'return coalesce(bx1_private.fund_roleplay_admission_commit(c,action,key,body),bx1_portal.read_scoped(c));'
const count = (source: string, value: string) => source.split(value).length - 1

describe('same-app TEST admission/account saved-result native contract', () => {
  it('changes exactly two response readers in the current one writer and reverses every byte', () => {
    expect(feature).toContain('target constant oid:=24447')
    expect(createHash('sha256').update(original).digest('hex')).toBe('7dc78c7f016229e2209a3235eda1db874b3ef573b53d17083c007bf7052d07d0')
    expect(count(original, oldReturn)).toBe(2)
    const changed = original.split(oldReturn).join(newReturn)
    expect(count(changed, newReturn)).toBe(2)
    expect(changed.split(newReturn).join(oldReturn)).toBe(original)
    expect(changed.indexOf('old_request.payload is distinct from body')).toBeLessThan(changed.indexOf(newReturn))
    expect(changed.lastIndexOf('perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);')).toBeLessThan(changed.lastIndexOf(newReturn))
    expect(metadata).toMatchObject({ oid: '24447', proowner: '16388', prosecdef: true, proconfig: ['search_path=""'] })
    expect(feature).toContain("before_row-'prosrc' is distinct from expected_metadata")
    expect(feature).toContain('admission_commit_partial_or_unexpected_installation')
    expect(feature).toContain('restored is distinct from original')
  })

  it('pins unchanged dependencies, receipt uniqueness, event clocks and immutable audit triggers', () => {
    expect(dependencies.map(row => row.oid)).toEqual(['16542','16714','27039','27107','27113','33388','33389','36223','38178','38184','38188','38189','38190'])
    for (const row of dependencies) expect(row.sha).toMatch(/^[0-9a-f]{64}$/)
    expect(dependencies.filter(row => ['16542', '16714'].includes(row.oid)).every(row => row.metadata.prosecdef === false)).toBe(true)
    const evidence = JSON.parse(tagged(feature, 'evidence')) as { kind: string; value: Record<string, unknown> }[]
    expect(evidence.filter(row => row.kind === 'default')).toHaveLength(4)
    expect(evidence.filter(row => row.kind === 'constraint')).toHaveLength(9)
    expect(evidence.filter(row => row.kind === 'trigger')).toHaveLength(5)
    expect(feature).toContain('existing_evidence @> expected_evidence is not true')
    expect(feature).toContain('expected_evidence @> existing_evidence is not true')
    expect(formatter).toContain('event_row.created_at=base_request.created_at')
    expect(formatter).toContain('event_count is distinct from 1')
    expect(formatter).not.toMatch(/order by|limit 1/i)
  })

  it('adds one closed postgres-only read formatter with no runtime writer or authority shortcut', () => {
    expect(formatter).not.toMatch(/\b(insert|update|delete|grant|revoke|execute|perform|set_config)\b/i)
    expect(helperMetadata).toMatchObject({
      proname: 'fund_roleplay_admission_commit', proowner: '16388', prosecdef: true,
      proacl: ['postgres=X/postgres'], proconfig: ['search_path=""'], provolatile: 'v',
      proargnames: ['p_context', 'p_action', 'p_key', 'p_payload'],
    })
    expect(feature).toContain('pg_catalog.aclexplode')
    expect(feature).toContain('a.grantee<>p.proowner')
    expect(feature).toContain("case when permission.grantee=0 then 'public'")
    expect(feature).not.toMatch(/grant\s+(execute|select|insert|update)|create\s+(table|role)|alter\s+table/i)
    expect(feature).toContain("current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null")
    expect(formatter).toContain('bx1_private.test_roleplay_environment() is not true')
    expect(formatter).toContain('bx1_private.test_roleplay_protected_session() is not true')
    expect(formatter).toContain('bx1_private.fund_roleplay_admission_binding_current(saved_binding.id) is not true')
    expect(formatter).not.toContain('fund_roleplay_admission_review_allowed(')
    expect(formatter).not.toContain('fund_roleplay_admission_enter(')
  })

  it('separates immutable review and account evidence and emits only the two agreed historical ACKs', () => {
    expect(formatter).toContain('TEST_FUND_ADMISSION_COMMIT')
    expect(formatter).toContain('TEST_FUND_ACCOUNT_COMMIT')
    expect(formatter).toContain('saved_decision.command_payload is distinct from p_payload')
    expect(formatter).toContain('saved_decision.decision_revision is distinct from saved_binding.submitted_revision+1')
    expect(formatter).toContain('saved_account.application_id is distinct from saved_application.id')
    expect(formatter).toContain('saved_account.holder_user_id is distinct from actor')
    expect(formatter).toContain('saved_account.created_at<saved_decision.reviewed_at')
    expect(formatter).toContain('bx1_portal.admission_individual_account_current(p_context,saved_account.id) is not true')
    expect(formatter).toContain('bx1_private.fund_roleplay_admission_product(saved_application.id,saved_binding.product_id) is not true')
    expect(formatter).toContain("'session_id',caller_session")
    expect(formatter).toContain("'recorded_at',case p_action when 'review_application' then saved_decision.reviewed_at else saved_event.created_at end")
    expect(formatter).not.toContain("'status',")
  })

  it('supplies only actual-extracted query-value proofs, not seeded principals or business acceptance', () => {
    const cases = JSON.parse(tagged(proof, 'predicate_cases')) as { group: string; denied: boolean }[]
    expect(cases).toHaveLength(62)
    expect(cases.filter(row => row.group === 'common')).toHaveLength(27)
    expect(cases.filter(row => row.group === 'review')).toHaveLength(9)
    expect(cases.filter(row => row.group === 'account')).toHaveLength(15)
    expect(cases.filter(row => row.group === 'event')).toHaveLength(11)
    expect(JSON.parse(tagged(proof, 'current_cases'))).toHaveLength(38)
    expect(JSON.parse(tagged(proof, 'event_cases'))).toHaveLength(9)
    expect(JSON.parse(tagged(proof, 'wire_cases'))).toHaveLength(2)
    for (const group of ['common', 'review', 'account', 'event', 'authority', 'final']) {
      expect(formatter).toContain('/* admission_commit_' + group + '_begin */')
      expect(formatter).toContain('/* admission_commit_' + group + '_end */')
    }
    expect(proof).toContain('jsonb_populate_record(null::bx1_portal.applications')
    expect(proof).toContain('jsonb_populate_recordset(null::bx1_portal.events,$2)')
    expect(proof).toContain('admission_commit_proof_null_actor_must_not_ack')
    expect(proof).toContain('admission_commit_proof_claims_changed')
    const executableProof = proof.slice(proof.indexOf("begin\n  if current_user"))
    expect(executableProof).not.toMatch(/\bset_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
    expect(tagged(proof, 'expected_helper')).toBe(formatter)
  })
})
