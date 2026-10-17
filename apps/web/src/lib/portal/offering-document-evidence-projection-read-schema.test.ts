import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source contracts only. Native/cloud and actual browser performance are separate.
const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_offering_document_evidence_projection_read.sql'), 'utf8').replace(/\r\n/g, '\n')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_offering_document_evidence_projection_read.sql'), 'utf8').replace(/\r\n/g, '\n')
const tagged = (source: string, tag: string) => {
  const marker = '$' + tag + '$', parts = source.split(marker)
  if (parts.length !== 3) throw new Error('Expected one paired source tag: ' + tag)
  return parts[1]
}
type Cut = { name: string; from: string; to: string; count: number }
type Dependency = { oid: string; sha: string; metadata: Record<string, unknown> }
const original = tagged(feature, 'evidence_projection_original')
const metadata = JSON.parse(tagged(feature, 'evidence_projection_metadata')) as Record<string, unknown>
const cuts = JSON.parse(tagged(feature, 'evidence_projection_cuts')) as Cut[]
const dependencies = JSON.parse(tagged(feature, 'evidence_projection_dependencies')) as Dependency[]
const relations = JSON.parse(tagged(feature, 'evidence_projection_relations')) as { constraints: unknown[]; indexes: unknown[]; columns: { attnotnull: boolean }[] }
const spec = JSON.parse(tagged(proof, 'evidence_projection_proof_spec')) as {
  target: { oid: string; sha: string; metadata: Record<string, unknown> };
  cuts: Cut[]; dependencies: Dependency[]; relations: typeof relations;
  retainedStatus: string; retainedApproval: string; shared: string; finalFence: string;
  substitutions: { from: string; to: string }[];
}
const count = (source: string, fragment: string) => source.split(fragment).length - 1
const changed = cuts.reduce((source, cut) => source.replace(cut.from, cut.to), original)

describe('one existing offering-evidence read cost correction', () => {
  it('changes exactly three finite fragments in30039 and reverses every other byte', () => {
    expect(feature).toContain('target constant oid:=30039')
    expect(createHash('sha256').update(original).digest('hex')).toBe('ea231988a9911232814ef6bd59261d1810dc25a34fe03ce74cbea71f47ff8216')
    expect(cuts.map(cut => cut.name)).toEqual(['status', 'approval', 'profile_gate'])
    let forward = original
    for (const cut of cuts) {
      expect(cut.count).toBe(1); expect(count(forward, cut.from)).toBe(1)
      forward = forward.replace(cut.from, cut.to)
    }
    let reverse = forward
    for (const cut of [...cuts].reverse()) {
      expect(count(reverse, cut.to)).toBe(1)
      reverse = reverse.replace(cut.to, cut.from)
    }
    expect(reverse).toBe(original)
    expect(feature).toContain('metadata->>\'prosrc\' is distinct from original and metadata->>\'prosrc\' is distinct from next_body')
    expect(feature).toContain('evidence_projection_target_preservation_failed')
  })

  it('keeps existing SQL/STABLE/definer/owner-only metadata and all eleven dependencies', () => {
    expect(metadata).toMatchObject({ oid: '30039', proowner: '16388', prolang: '14', provolatile: 's',
      prosecdef: true, proacl: ['postgres=X/postgres'], proconfig: ['search_path=""'], prorettype: '3802' })
    expect(dependencies.map(row => row.oid)).toEqual(['25750','25751','29607','29608','30038','30040','30044','30335','30718','30720','30721'])
    expect(dependencies.find(row => row.oid === '30720')?.sha).toBe('0f463382e6e285429545fb074710c30402cfc828ce66d5cf834f427f73b9bfd5')
    expect(dependencies.find(row => row.oid === '30721')?.sha).toBe('d3b9130af57762a05311b4c1b8048ca580db3136fa59e3f00deb2e6de2a4c483')
    expect(dependencies.find(row => row.oid === '30335')?.sha).toBe('d25a8baf9e630915ef2df083f152389c4378610a2bc9af2c66ef58db04c6e0c3')
    expect(spec.target).toEqual({ oid: '30039', sha: createHash('sha256').update(original).digest('hex'), metadata })
    expect(spec.cuts).toEqual(cuts); expect(spec.dependencies).toEqual(dependencies); expect(spec.relations).toEqual(relations)
    expect(feature).not.toMatch(/\b(create\s+(?:function|table|role)|grant|set_config|statement_timeout)\b/i)
  })

  it('evaluates the identical retained-evidence EXISTS only once per profile-gated invocation', () => {
    expect(count(original, 'bx1_private.offering_signature_evidence_current(op.id)')).toBe(2)
    expect(count(changed, 'bx1_private.offering_signature_evidence_current(op.id)')).toBe(1)
    expect(count(changed, spec.shared)).toBe(2)
    expect(cuts[2].to).toContain('with retained_evidence as materialized')
    expect(cuts[2].to).toContain('from bx1_private.offering_document_profiles evidence_profile')
    expect(cuts[2].to).toContain('where evidence_profile.offering_revision_id=target_revision')
    expect(cuts[2].to).toContain(spec.retainedStatus)
    expect(spec.shared).toBe('coalesce((select retained.evidence_retained from retained_evidence retained),false)')
    expect(changed).toContain('case when q.offering_revision_id is null then null else')
    expect(changed.slice(changed.indexOf('from (select 1) base'))).toBe(original.slice(original.indexOf('from (select 1) base')))
    expect(relations.constraints).toHaveLength(4); expect(relations.indexes).toHaveLength(4)
    expect(relations.columns).toHaveLength(2); expect(relations.columns.every(column => column.attnotnull)).toBe(true)
  })

  it('preserves the full remaining status precedence and independent final fresh comparison', () => {
    const statuses = ['NOT_ADMITTED','EVIDENCE_RETAINED','RECOVERY_REQUIRED','NON_CURRENT','PENDING','SIGNATURE_REQUIRED','PURPOSE_REQUIRED']
    expect([...changed.matchAll(/then '([A-Z_]+)'|else '([A-Z_]+)'/g)].map(match => match[1] ?? match[2])).toEqual(statuses)
    expect(proof).toContain('cases<>432')
    expect(proof).toContain('evidence_projection_proof_false_or_unknown_must_not_approve')
    expect(proof).toContain('evidence_projection_proof_missing_profile_must_be_null')
    expect(proof).toContain('evidence_projection_proof_field_or_profile_gate_mismatch')
    expect(spec.finalFence).toContain('offering_workflow_package_projection')
    expect(spec.finalFence).toContain("is distinct from value->'offering_package'")
    const phases = JSON.parse(tagged(proof, 'evidence_projection_fresh_cases')) as { initial: { approval_allowed: boolean }; final?: { approval_allowed: boolean }; denied: boolean }[]
    expect(phases).toHaveLength(3)
    expect(phases[1]).toMatchObject({ initial: { approval_allowed: true }, final: { approval_allowed: false }, denied: true })
    expect(phases[2].denied).toBe(true)
  })

  it('supplies actual-extracted query-only expressions, not owner business execution or authority claims', () => {
    expect(proof).toContain("old_status:=split_part(split_part(original,'''signature_status'',',2)")
    expect(proof).toContain("materialized_sql:=left(installed,strpos(installed,E'\\n  select case')-1)")
    expect(proof).toContain('evidence_projection_proof_unreplaced_native_dependency')
    expect(proof).toContain('execute proof_query into old_result,new_result,gated_rows')
    expect(proof).toContain('execute \'select \'||fresh_fence')
    expect(proof).toContain('evidence_projection_proof_claims_changed')
    const executable = proof.slice(proof.indexOf('begin\n'))
    expect(executable).not.toMatch(/set_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
  })
})
