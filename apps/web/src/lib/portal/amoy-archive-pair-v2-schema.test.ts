import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), '../../', path), 'utf8').replace(/\r\n/g, '\n')
const feature = read('supabase/features/bx1_amoy_archive_pair_v2.sql')
const proof = read('supabase/tests/bx1_amoy_archive_pair_v2.sql')
const tagged = (source: string, name: string) => {
  const parts = source.split('$' + name + '$')
  if (parts.length !== 3) throw new Error('Expected one paired source tag: ' + name)
  return parts[1]
}
type Cut = { name: string; from: string; to: string; count: number }
type Target = { oid: number; signature: string; sha: string; metadata: Record<string, unknown>; original: string; cuts: Cut[] }
type Dependency = { oid: number; signature: string; sha: string; metadata: Record<string, unknown> }
type PairCase = { name: string; providers?: { url?: unknown }[] | null | Record<string, unknown>; valid: boolean; ordered: boolean }
const targets = JSON.parse(tagged(feature, 'archive_pair_v2_targets')) as Target[]
const dependency = JSON.parse(tagged(feature, 'archive_pair_v2_dependency')) as Dependency
const spec = JSON.parse(tagged(proof, 'archive_pair_v2_proof_spec')) as { targets: Omit<Target, 'original'>[]; dependency: Dependency }
const cases = JSON.parse(tagged(proof, 'archive_pair_v2_cases')) as PairCase[]
const metadataCases = JSON.parse(tagged(proof, 'archive_pair_v2_metadata_cases')) as unknown[]
const count = (source: string, value: string) => source.split(value).length - 1
const hash = (source: string) => createHash('sha256').update(source).digest('hex')
const canonical: Record<number, string> = {
  24934: read('supabase/features/bx1_portal_funding.sql'),
  33625: read('supabase/features/bx1_fund_setup.sql'),
  36424: read('supabase/features/bx1_fund_release_admission.sql'),
  36708: read('supabase/features/bx1_fund_recipient_operations.sql'),
  36709: read('supabase/features/bx1_fund_recipient_operations.sql'),
}
const d = 'https://polygon-amoy.drpc.org', p = 'https://polygon-amoy-bor-rpc.publicnode.com'
const t = 'https://polygon-amoy.gateway.tenderly.co', w = 'https://80002.rpc.thirdweb.com'
const urls = (item: PairCase) => Array.isArray(item.providers) ? item.providers.map(provider => provider?.url) : item.providers

describe('exact TEST observer-pair v2 compatibility, not archive or upstream-quorum admission', () => {
  it('pins five current raw preimages and eight unique cuts, with exact whole-body inverse', () => {
    expect(targets.map(target => target.oid)).toEqual([24934, 33625, 36424, 36708, 36709])
    expect(targets.map(target => target.sha)).toEqual([
      'a11984946f2ee3f35a0eee7b2158795ac45da4cf16d019bc63f265396451638a',
      '0da53212b45ccc2780748da62054829889302e6f96e5a36279f50ba663854220',
      'c1df6da97579faf7306a6355d28597787e64b7f3103c45703f9b6246041cfaa4',
      '4398f905dd2e018cfd2bcf88d2e048c3be377dbde829ca4e9b8aa1f1c593b641',
      '030f0da12f9a7b2ebc135a5df2d2ac9845c4c27a4c3667435f7c0337dcdb6f13',
    ])
    expect(targets.flatMap(target => target.cuts)).toHaveLength(8)
    for (const target of targets) {
      expect(hash(target.original)).toBe(target.sha)
      let body = target.original
      for (const cut of target.cuts) {
        expect(cut.count).toBe(1)
        expect(count(body, cut.from)).toBe(1)
        body = body.replace(cut.from, cut.to)
        expect(count(canonical[target.oid], cut.to)).toBe(1)
      }
      const name = target.signature.split('(')[0].replace(/[.*+?^{}$()|[\]\\]/g, '\\$&')
      const match = canonical[target.oid].match(new RegExp('create(?: or replace)? function\\s+' + name + '\\([\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;', 'i'))
      expect(match?.[1].trim()).toBe(body.trim())
      for (const cut of [...target.cuts].reverse()) {
        expect(count(body, cut.to)).toBe(1)
        body = body.replace(cut.to, cut.from)
      }
      expect(body).toBe(target.original)
      expect(spec.targets.find(item => item.oid === target.oid)).toEqual(Object.fromEntries(Object.entries(target).filter(([key]) => key !== 'original')))
    }
    expect(feature).toContain('(originals<>5 and finals<>5)')
    expect(feature).toContain('archive_pair_v2_unknown_preimage')
    expect(feature).toContain('archive_pair_v2_partial_baseline')
  })
  it('preserves full metadata, existing privileges and unchanged operation writer31534', () => {
    for (const target of targets) expect(target.metadata).toMatchObject({
      oid: String(target.oid), proowner: '16388', prolang: '13619', proconfig: ['search_path=""'],
    })
    for (const oid of [33625, 36708]) expect(targets.find(target => target.oid === oid)?.metadata).toMatchObject({
      prosecdef: false, provolatile: 'i', proacl: ['postgres=X/postgres'], prorettype: '16',
    })
    expect(targets.find(target => target.oid === 24934)?.metadata.proacl).toEqual(['postgres=X/postgres', 'service_role=X/postgres'])
    for (const oid of [36424, 36709]) expect(targets.find(target => target.oid === oid)?.metadata.proacl).toEqual(['postgres=X/postgres', 'bx1_fund_execution_worker=X/postgres'])
    expect(dependency).toMatchObject({ oid: 31534, sha: '59f356c8435b06d174bdd104563b0d471cd36772bfbf5c13ff14dac68a140bdf' })
    expect(spec.dependency).toEqual(dependency)
    expect(feature).toContain("metadata-'prosrc' is distinct from target_spec->'metadata'")
    expect(feature).toContain('archive_pair_v2_target_preservation_failed')
  })
  it('admits exactly the three whole pairs and only the three prescribed admission orders', () => {
    expect(cases.filter(item => item.valid).map(urls)).toEqual([[d, p], [d, t], [p, d], [t, d], [t, w], [w, t]])
    expect(cases.filter(item => item.ordered).map(urls)).toEqual([[d, p], [d, t], [w, t]])
    for (const pair of [[d, w], [w, d], [p, t], [t, p], [p, w], [w, p], [d, d], [p, p], [t, t], [w, w]]) {
      expect(cases.find(item => JSON.stringify(urls(item)) === JSON.stringify(pair))?.valid, JSON.stringify(pair)).toBe(false)
    }
    for (const name of ['foreign', 'credentials', 'query', 'path', 'http', 'extra provider', 'single provider', 'empty providers', 'null URL', 'missing URL', 'null providers', 'null provider', 'numeric URL', 'object providers', 'missing providers']) {
      expect(cases.find(item => item.name === name)?.valid, name).toBe(false)
    }
    expect(targets.find(target => target.oid === 24934)!.cuts[0].to).toContain("source_urls is distinct from array['" + w + "','" + t + "']::text[]")
    const admission = targets.find(target => target.oid === 36424)!
    expect(admission.cuts).toHaveLength(1)
    expect(admission.cuts[0].to).toContain("'{observed,providers,0,url}' is distinct from '" + w + "'")
    expect(admission.original).toContain("jsonb_array_length(candidate#>'{observed,providers}')<>2")
    for (const oid of [33625, 36708, 36709]) for (const [first, second] of [[d, p], [d, t], [w, t]]) {
      expect(targets.find(target => target.oid === oid)!.cuts[1].to).toContain("urls @> array['" + first + "','" + second + "']::text[]")
    }
  })
  it('keeps historical v1 evidence sources intact and undoes only v2 for old assertions', () => {
    expect(hash(read('supabase/features/bx1_amoy_archive_observers.sql'))).toBe('06b4fd06506e96c7fdd7f83e4eae61cabf0ee4f781dc9bca07e94d9ed73392b2')
    expect(hash(read('supabase/tests/bx1_amoy_archive_observers.sql'))).toBe('01d4e0e31963ca9bee7149be21c05e90169e469d2cad068e43e8680b3de98ab0')
    const old = read('apps/web/src/lib/portal/amoy-archive-observers-schema.test.ts')
    expect(old).toContain("tagged(read('supabase/features/bx1_amoy_archive_pair_v2.sql'), 'archive_pair_v2_targets')")
    expect(old).toContain("if (matches === 1) source = source.replace(cut.to, cut.from)")
    expect(old).toContain('expect(cases).toHaveLength(19)')
  })
  it('keeps proof query-only and preserves actual metadata/finality/null checks', () => {
    expect(cases).toHaveLength(31)
    expect(metadataCases).toHaveLength(11)
    expect(proof).toContain('bx1_portal.fund_setup_observers_valid(setup_value)')
    expect(proof).toContain('bx1_portal.fund_recipient_result_shape(recipient_value)')
    expect(proof).toContain("start_at:=strpos(installed,target_spec#>>'{cuts,0,to}')")
    expect(proof).toContain("recipient_pair:=replace(recipient_pair,'urls','($1::text[])')")
    expect(proof).not.toContain("recipient_pair:=replace(recipient_pair,'urls','$1::text[]')")
    expect(proof).toContain('case_count<>31')
    expect(proof).toContain('metadata_count<>11')
    expect(proof).toContain('archive_pair_v2_proof_finality_or_null_guard_changed')
    const executable = proof.slice(proof.indexOf('\nbegin\n'))
    expect(executable).not.toMatch(/set_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
    expect(executable).not.toMatch(/perform\s+bx1_portal\.record_|select\s+bx1_portal\.record_/i)
    const install = feature.slice(feature.indexOf('\nbegin\n'))
    expect(install).not.toMatch(/(?:insert\s+into|update\s+bx1_|delete\s+from|grant\s|revoke\s|create\s+(?:table|role)|set_config\s*\(|statement_timeout)/i)
    expect(install).toContain("is distinct from 'TESTNET'")
    expect(install).toContain('auth.uid() is not null')
  })
})
