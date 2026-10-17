import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source contracts only. Native query-only and genuine hosted acceptance are separate.
const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_offering_readiness_projection.sql'), 'utf8').replace(/\r\n/g, '\n')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_offering_readiness_projection.sql'), 'utf8').replace(/\r\n/g, '\n')
const tagged = (source: string, tag: string) => {
  const marker = '$' + tag + '$', parts = source.split(marker)
  if (parts.length !== 3) throw new Error('Expected one paired source tag: ' + tag)
  return parts[1]
}
type Cut = { name: string; from: string; to: string; count: number }
type Target = { oid: number; signature: string; sha: string; metadata: Record<string, unknown>; original: string; cuts: Cut[] }
type Dependency = { oid: number; signature: string; sha: string; metadata: Record<string, unknown> }
const targets = JSON.parse(tagged(feature, 'readiness_projection_targets')) as Target[]
const dependencies = JSON.parse(tagged(feature, 'readiness_projection_dependencies')) as Dependency[]
const spec = JSON.parse(tagged(proof, 'readiness_projection_proof_spec')) as {
  targets: Omit<Target, 'original'>[]; dependencies: Dependency[];
  fragments: { tagged: string; ordinary: string; label: string; finalFence: string };
}
const count = (source: string, fragment: string) => source.split(fragment).length - 1
const changed = (target: Target) => target.cuts.reduce((source, cut) => source.replace(cut.from, cut.to), target.original)

describe('existing offering readiness projection correction', () => {
  it('changes exactly three reversible fragments in only the two current readers', () => {
    expect(targets.map(target => target.oid)).toEqual([25750, 29607])
    expect(targets.map(target => target.sha)).toEqual([
      '3af34c6fb9b6e51b37d6fdfbf25193f5c079d430f002a5d02186444ee917fe1e',
      'd537cf85b5b4ee8488c14cb5a30df9693ee36ccad9d264a5afe385e34125c6a5',
    ])
    expect(targets.flatMap(target => target.cuts)).toHaveLength(3)
    for (const target of targets) {
      expect(createHash('sha256').update(target.original).digest('hex')).toBe(target.sha)
      let forward = target.original
      for (const cut of target.cuts) {
        expect(cut.count).toBe(1); expect(count(forward, cut.from)).toBe(1)
        forward = forward.replace(cut.from, cut.to)
      }
      let inverse = forward
      for (const cut of [...target.cuts].reverse()) {
        expect(count(inverse, cut.to)).toBe(1)
        inverse = inverse.replace(cut.to, cut.from)
      }
      expect(inverse).toBe(target.original)
      expect(spec.targets.find(item => item.oid === target.oid)).toEqual(Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'original')))
    }
    expect(feature).toContain('originals<>2 and finals<>2')
    expect(feature).toContain('offering_readiness_partial_baseline')
    expect(feature).toContain('offering_readiness_target_preservation_failed')
  })

  it('uses the existing closed tagged helper without expired/false/unknown ordinary fallback', () => {
    const legacy = targets[0], workflow = targets[1]
    expect(legacy.cuts.map(cut => cut.name)).toEqual(['tagged_readiness', 'readiness_status'])
    expect(workflow.cuts.map(cut => cut.name)).toEqual(['readiness_status'])
    expect(legacy.cuts[0].from).toBe('is_ready:=bx1_portal.offering_operational(p.id);')
    expect(legacy.cuts[0].to).toBe("is_ready:=case when p.review_roleplay_policy_id is not null then\n    bx1_private.fund_roleplay_investor_operational(p.id,p.review_roleplay_policy_id,p.review_roleplay_epoch)\n    else bx1_portal.offering_operational(p.id) end;")
    expect(legacy.cuts[0].to).not.toMatch(/\bcoalesce\b|\bor\b/i)
    expect(changed(workflow)).toContain('is_ready:=bx1_portal.offering_technical_ready(r.id) is true;')
    for (const target of targets) {
      expect(count(changed(target), "'technical_readiness_status',case when is_ready is true then 'VERIFIED' else 'NOT_VERIFIED' end")).toBe(1)
      expect(changed(target)).toContain("'publishable',p.status='APPROVED' and is_ready")
      expect(changed(target)).toContain("'subscribable',p.status='PUBLISHED' and is_ready")
    }
  })

  it('pins complete owner-only target metadata and all fourteen unchanged dependency functions', () => {
    for (const target of targets) expect(target.metadata).toMatchObject({
      oid: String(target.oid), proowner: '16388', prolang: '13619', provolatile: 'v', prosecdef: true,
      proacl: ['postgres=X/postgres'], proconfig: ['search_path=""'], prorettype: '3802', proargnames: ['c', 'target_product'],
    })
    expect(dependencies.map(item => item.oid)).toEqual([24445,25732,25733,25734,25738,25751,26608,29608,30039,30335,30781,31496,37285,38341])
    expect(dependencies.find(item => item.oid === 38341)?.sha).toBe('5107b4e646af2cea44a7597c487f6c79616512e0556ce463f66972a1308afc4a')
    expect(dependencies.find(item => item.oid === 30335)?.sha).toBe('d25a8baf9e630915ef2df083f152389c4378610a2bc9af2c66ef58db04c6e0c3')
    expect(dependencies.find(item => item.oid === 25751)?.sha).toBe('4b2cf0aac6c0ea150dccabffb2959dd5b79610720389f04638875ca028bf4f8c')
    expect(spec.dependencies).toEqual(dependencies)
    const executable = feature.slice(feature.indexOf('\nbegin\n'))
    expect(executable).not.toMatch(/create\s+(?:function|table|role)|grant\s+(?:all|execute|usage)|set_config\s*\(|statement_timeout|insert\s+into|update\s+bx1_|delete\s+from/i)
    expect(feature).toContain("metadata-'prosrc' is distinct from spec->'metadata'")
    expect(feature).toContain("metadata-'prosrc' is distinct from dependency->'metadata'")
  })

  it('provides actual-extracted typed branch/field cases and independently fresh final withdrawal checks', () => {
    expect(proof).toContain("old_rhs:=split_part(split_part(original,'is_ready:=',2),';',1)")
    expect(proof).toContain("label_rhs:=split_part(split_part(installed,'''technical_readiness_status'',',2)")
    expect(proof).toContain('branch_cases<>54 or field_cases<>36')
    expect(proof).toContain('tagged is true and roleplay_current is not true')
    expect(proof).toContain('new_value->>\'technical_readiness_status\' is distinct from')
    expect(proof).toContain("old_value-'technical_readiness_status' is distinct from new_value-'technical_readiness_status'")
    expect(proof).toContain("execute 'select '||fresh_fence")
    const phases = JSON.parse(tagged(proof, 'readiness_projection_fresh_cases')) as { initial: { technical_readiness_status: string }; final?: { technical_readiness_status: string }; denied: boolean }[]
    expect(phases).toHaveLength(3)
    expect(phases[1]).toMatchObject({ initial: { technical_readiness_status: 'VERIFIED' }, final: { technical_readiness_status: 'NOT_VERIFIED' }, denied: true })
    expect(phases[2].denied).toBe(true)
    expect(spec.fragments.finalFence).toContain('offering_workflow_package_projection')
    expect(spec.fragments.finalFence).toContain("is distinct from value->'offering_package'")
  })

  it('keeps the proof query-only with no actual business authority, claims or writers', () => {
    const executable = proof.slice(proof.indexOf('\nbegin\n'))
    expect(executable).not.toMatch(/set_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
    expect(proof).toContain('offering_readiness_proof_unreplaced_assignment')
    expect(proof).toContain('offering_readiness_proof_unreplaced_display_expression')
    expect(proof).toContain('offering_readiness_proof_claims_changed')
    expect(proof).toContain('execute query_text into old_value,new_value using supplied_ready,product_status')
    expect(proof).not.toContain("set_config('request.jwt")
  })
})
