import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), '../../', path), 'utf8').replace(/\r\n/g, '\n')
const feature = read('supabase/features/bx1_amoy_archive_observers.sql')
const proof = read('supabase/tests/bx1_amoy_archive_observers.sql')
const tagged = (source: string, tag: string) => {
  const parts = source.split('$' + tag + '$')
  if (parts.length !== 3) throw new Error('Expected one paired source tag: ' + tag)
  return parts[1]
}
type Cut = { name: string; from: string; to: string; count: number }
type Target = { oid: number; signature: string; sha: string; metadata: Record<string, unknown>; original: string; cuts: Cut[] }
type Dependency = { oid: number; signature: string; sha: string; metadata: Record<string, unknown> }
const targets = JSON.parse(tagged(feature, 'archive_observer_targets')) as Target[]
const dependency = JSON.parse(tagged(feature, 'archive_observer_dependency')) as Dependency
const spec = JSON.parse(tagged(proof, 'archive_observer_proof_spec')) as { targets: Omit<Target, 'original'>[]; dependency: Dependency }
const cases = JSON.parse(tagged(proof, 'archive_observer_cases')) as { name: string; providers?: { url?: string | null }[] | null; valid: boolean; ordered: boolean }[]
const count = (source: string, value: string) => source.split(value).length - 1
const canonical: Record<number, string> = {
  24934: read('supabase/features/bx1_portal_funding.sql'),
  33625: read('supabase/features/bx1_fund_setup.sql'),
  36424: read('supabase/features/bx1_fund_release_admission.sql'),
  36708: read('supabase/features/bx1_fund_recipient_operations.sql'),
  36709: read('supabase/features/bx1_fund_recipient_operations.sql'),
}
const d = 'https://polygon-amoy.drpc.org', p = 'https://polygon-amoy-bor-rpc.publicnode.com', t = 'https://polygon-amoy.gateway.tenderly.co'

describe('bounded Amoy archive observer compatibility', () => {
  it('pins exactly five current preimages and eight fully reversible cuts', () => {
    expect(targets.map(target => target.oid)).toEqual([24934,33625,36424,36708,36709])
    expect(targets.map(target => target.sha)).toEqual(["582cf7ae3a77c986b66ba500c556445af34aa05cb227a83622242d3705785b54","bfc4c603e62cc227707a115cb04943d69564cd3cf6a5e324f3c2f6ea347374b2","41bd2d85e87751e1539184232ea14a9888426bf3617ba64ccf3749c0afc1df9a","12aaea5b1f0621ffb7c5e6deac4dac352b62b8a5fd19a5b6096d7bbedd230a94","e6f18caacdd33227ffb2219c5b88ffa38f92da135ba5b9306bc2c6b8cb87391b"])
    expect(targets.flatMap(target => target.cuts)).toHaveLength(8)
    for (const target of targets) {
      expect(createHash('sha256').update(target.original).digest('hex')).toBe(target.sha)
      let body = target.original
      for (const cut of target.cuts) {
        expect(cut.count).toBe(1)
        expect(count(body, cut.from)).toBe(1)
        body = body.replace(cut.from, cut.to)
        expect(count(canonical[target.oid], cut.to)).toBe(1)
      }
      for (const cut of [...target.cuts].reverse()) {
        expect(count(body, cut.to)).toBe(1)
        body = body.replace(cut.to, cut.from)
      }
      expect(body).toBe(target.original)
      expect(spec.targets.find(value => value.oid === target.oid)).toEqual(Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'original')))
    }
    expect(feature).toContain('archive_observer_unknown_preimage')
    expect(feature).toContain('(originals<>5 and finals<>5)')
    expect(feature).toContain('archive_observer_partial_baseline')
  })

  it('retains exact original function metadata and the unchanged operation writer', () => {
    for (const target of targets) expect(target.metadata).toMatchObject({
      oid: String(target.oid), proowner: '16388', prolang: '13619', proconfig: ['search_path=""'],
    })
    for (const oid of [33625,36708]) expect(targets.find(target => target.oid === oid)?.metadata).toMatchObject({
      prosecdef: false, provolatile: 'i', proacl: ['postgres=X/postgres'], prorettype: '16',
    })
    expect(targets.find(target => target.oid === 24934)?.metadata.proacl).toEqual(['postgres=X/postgres','service_role=X/postgres'])
    for (const oid of [36424,36709]) expect(targets.find(target => target.oid === oid)?.metadata.proacl).toEqual(['postgres=X/postgres','bx1_fund_execution_worker=X/postgres'])
    expect(dependency).toMatchObject({ oid: 31534, sha: '59f356c8435b06d174bdd104563b0d471cd36772bfbf5c13ff14dac68a140bdf' })
    expect(spec.dependency).toEqual(dependency)
    expect(feature).toContain("metadata-'prosrc' is distinct from target_spec->'metadata'")
    expect(feature).toContain('archive_observer_target_preservation_failed')
    expect(feature).toContain('archive_observer_unchanged_operation_writer_changed')
  })

  it('requires dRPC for either legacy or archive pair, not arbitrary two-of-three providers', () => {
    const valid = cases.filter(value => value.valid).map(value => value.providers?.map(provider => provider.url))
    expect(valid).toEqual([[d,p],[p,d],[d,t],[t,d]])
    expect(cases.filter(value => value.ordered).map(value => value.providers?.map(provider => provider.url))).toEqual([[d,p],[d,t]])
    expect(cases.find(value => value.name === 'no dRPC')).toMatchObject({ providers: [{ url: p }, { url: t }], valid: false })
    for (const name of ['duplicate 0','duplicate 1','duplicate 2','foreign','credentials','query','extra provider','single provider','empty providers','null URL','missing URL','null providers','missing providers']) {
      expect(cases.find(value => value.name === name)?.valid, name).toBe(false)
    }
    expect(targets.find(target => target.oid === 24934)?.cuts[0].to).toBe("(source_urls is distinct from array['" + p + "','" + d + "']::text[]\n    and source_urls is distinct from array['" + d + "','" + t + "']::text[])")
    expect(targets.find(target => target.oid === 33625)?.cuts[1].to).toContain("('" + d + "'=any(urls)) is true")
    for (const oid of [36708,36709]) expect(targets.find(target => target.oid === oid)?.cuts[1].to).toContain("('" + d + "'=any(urls)) is not true")
  })

  it('preserves ordered admission cardinality and original provider labels in saved evidence', () => {
    const target = targets.find(value => value.oid === 36424)!
    expect(target.cuts).toHaveLength(1)
    expect(target.cuts[0].from).toContain("'{observed,providers,1,url}'")
    expect(target.cuts[0].to).toContain("is distinct from '" + p + "'")
    expect(target.cuts[0].to).toContain("is distinct from '" + t + "'")
    expect(target.original).toContain("candidate#>>'{observed,providers,0,url}' is distinct from '" + d + "'")
    expect(target.original).toContain("jsonb_array_length(candidate#>'{observed,providers}')<>2")
    for (const target of targets) {
      const withoutCuts = target.cuts.reduce((body, cut) => body.replace(cut.from, ''), target.original)
      expect(withoutCuts).toContain('providers')
    }
    const executable = feature.slice(feature.indexOf('\nbegin\n'))
    expect(executable).not.toMatch(/(?:insert\s+into|update\s+bx1_|delete\s+from|grant\s|revoke\s|create\s+(?:table|role)|set_config\s*\(|statement_timeout)/i)
    expect(executable).toContain("is distinct from 'TESTNET'")
    expect(executable).toContain('auth.uid() is not null')
  })

  it('uses nineteen actual-validator and extracted-predicate cases without business writers or claims', () => {
    expect(cases).toHaveLength(19)
    expect(proof).toContain('bx1_portal.fund_setup_observers_valid(setup_value)')
    expect(proof).toContain('bx1_portal.fund_recipient_result_shape(recipient_value)')
    expect(proof).toContain("funding_predicate:=target_spec#>>'{cuts,0,to}'")
    expect(proof).toContain("admission_predicate:=substring(installed from start_at)")
    expect(proof).toContain("recipient_pair:=split_part(split_part(recipient_pair,'if ',2),' then',1)")
    expect(proof).toContain("recipient_pair:=replace(recipient_pair,'urls','($1::text[])')")
    expect(proof).not.toContain("recipient_pair:=replace(recipient_pair,'urls','$1::text[]')")
    expect(proof).toContain('case_count<>19')
    const executable = proof.slice(proof.indexOf('\nbegin\n'))
    expect(executable).not.toMatch(/set_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
    expect(executable).not.toMatch(/perform\s+bx1_portal\.record_|select\s+bx1_portal\.record_/i)
    expect(executable).toContain('archive_proof_claims_changed')
  })
})
