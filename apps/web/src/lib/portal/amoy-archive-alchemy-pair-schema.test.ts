import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), '../../', path), 'utf8').replace(/\r\n/g, '\n')
const feature = read('supabase/features/bx1_amoy_archive_alchemy_pair.sql')
const proof = read('supabase/tests/bx1_amoy_archive_alchemy_pair.sql')
const harness = read('apps/web/scripts/test-amoy-archive-alchemy-pair.mjs')
const tagged = (source: string, name: string) => {
  const parts = source.split('$' + name + '$')
  if (parts.length !== 3) throw new Error('Expected one paired source tag: ' + name)
  return parts[1]
}
type Cut = { name: string; from: string; to: string; count: number }
type Target = { oid: number; signature: string; sha: string; final_sha: string; metadata: Record<string, unknown>; original: string; cuts: Cut[] }
type PairCase = { name: string; providers?: unknown; valid: boolean; ordered: boolean; narrow: boolean; narrow_ordered: boolean }
const targets = JSON.parse(tagged(feature, 'alchemy_pair_targets')) as Target[]
const proofTargets = JSON.parse(tagged(proof, 'alchemy_pair_proof_targets')) as Omit<Target, 'original'>[]
const inverseTargets = JSON.parse(tagged(feature, 'alchemy_inverse_targets')) as Omit<Target, 'original'>[]
const cases = JSON.parse(tagged(proof, 'alchemy_pair_cases')) as PairCase[]
const metadataCases = JSON.parse(tagged(proof, 'alchemy_pair_metadata_cases')) as unknown[]
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const count = (source: string, value: string) => source.split(value).length - 1
const urls = (item: PairCase): unknown => Array.isArray(item.providers) ? item.providers.map((entry: unknown) =>
  entry !== null && typeof entry === 'object' && 'url' in entry ? (entry as Record<string, unknown>).url : undefined) : item.providers
// Ignore case enumeration order, retaining each pair's order and duplicates.
const canonicalPairs = (pairs: unknown[]) => pairs.map(pair => JSON.stringify(pair)).sort()
const d = 'https://polygon-amoy.drpc.org', p = 'https://polygon-amoy-bor-rpc.publicnode.com'
const t = 'https://polygon-amoy.gateway.tenderly.co', w = 'https://80002.rpc.thirdweb.com', a = 'https://polygon-amoy.g.alchemy.com/v2'

describe('additive Alchemy observer pair catalog/predicate contract, not provider acceptance', () => {
  it('pins exactly seven actual native bodies and eleven unique reversible provider-only cuts', () => {
    expect(targets.map(target => target.oid)).toEqual([24934, 33625, 36424, 36708, 36709, 38526, 38760])
    expect(targets.map(target => target.sha)).toEqual([
      '0537e0578f0516cda9484f5ea4648af5b74e93f44fbf5b644bd76448546305fb',
      'c9eda9d4cdf1b1e50c28e66e91911a590909e6fa49d7035e6f953bae993d001c',
      '22002bab1e1930ea79f32db15e76260a2e1746e448839d01b45b77cdfeae43da',
      '6e6fa46f5383f172df9a811b7020c04effc51e7015398a6da5ccada1d1400c3f',
      '93bdb1489699bf4dd5b554fb85fe55c2b6fd697955832a328a8844578f531a99',
      'e3c353516b891c419d95f52b25cca4ed8368e313a6efa046af6a41147fb94f5a',
      '25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d',
    ])
    expect(targets.map(target => target.final_sha)).toEqual([
      'a76dc61a37cee8ef51fa2770ab0d1d7152467bc7000ef820c14f3a29a5e561af',
      'a5e330b4d8d77c5bc6e3d24c123bb7ae9ac0747a6289744cf24d67384a6d8335',
      '14a917d8a77ebe165c613ed3dd632805471b6dde8b2037b1342aeb0dda3ff176',
      '84cefa54ec6e792231b08f22362dedbf7fdf732444d938e3a6536b81da85b295',
      '32de9e76002e8bff1baa821fd6e23a9fc0ee5f78dd9eac60da1c6cf1777ab69f',
      'f5c9e7853e9b3815dd4edabf678055d255c2ceb02dd45c9c0bfe63f7cc544612',
      '7b314b7a47839d6f87b8798ad6629569308c3c37ddd33d243f45109f8cb47566',
    ])
    expect(targets.flatMap(target => target.cuts)).toHaveLength(11)
    for (const target of targets) {
      expect(hash(target.original)).toBe(target.sha)
      let body = target.original
      for (const cut of target.cuts) {
        expect(cut.count).toBe(1)
        expect(count(body, cut.from)).toBe(1)
        expect(cut.to).toContain(a)
        body = body.replace(cut.from, cut.to)
      }
      expect(hash(body)).toBe(target.final_sha)
      for (const cut of [...target.cuts].reverse()) {
        expect(count(body, cut.to)).toBe(1)
        body = body.replace(cut.to, cut.from)
      }
      expect(body).toBe(target.original)
      const { original: _original, ...compact } = target
      expect(proofTargets.find(item => item.oid === target.oid)).toEqual(compact)
      expect(inverseTargets.find(item => item.oid === target.oid)).toEqual(compact)
    }
  })

  it('preserves complete native metadata including the two immutable invokers and existing ACLs', () => {
    for (const target of targets) expect(target.metadata).toMatchObject({
      oid: String(target.oid), proowner: '16388', prolang: '13619', proconfig: ['search_path=""'],
      prokind: 'f', proisstrict: false, proretset: false, proparallel: 'u',
    })
    for (const oid of [33625, 36708]) expect(targets.find(item => item.oid === oid)?.metadata).toMatchObject({
      prosecdef: false, provolatile: 'i', proacl: ['postgres=X/postgres'], prorettype: '16',
    })
    for (const oid of [24934, 36424, 36709, 38526, 38760]) expect(targets.find(item => item.oid === oid)?.metadata).toMatchObject({ prosecdef: true, provolatile: 'v' })
    expect(targets.find(item => item.oid === 24934)?.metadata.proacl).toEqual(['postgres=X/postgres', 'service_role=X/postgres'])
    for (const oid of [36424, 36709, 38526]) expect(targets.find(item => item.oid === oid)?.metadata.proacl).toEqual(['postgres=X/postgres', 'bx1_fund_execution_worker=X/postgres'])
    expect(targets.find(item => item.oid === 38760)?.metadata).toMatchObject({ pronamespace: '22414', proacl: ['postgres=X/postgres'] })
    expect(feature).toContain("metadata-'prosrc' is distinct from target_spec->'metadata'")
    expect(feature).toContain('(originals<>7 and finals<>7)')
    expect(feature).toContain('cut_count<>11')
    expect(feature).toContain('alchemy_pair_unknown_preimage')
    expect(feature).toContain('alchemy_pair_non_target_changed')
    expect(feature).toContain('alchemy_pair_target_preservation_failed')
    expect(feature).toContain("is distinct from 'TESTNET'")
    expect(feature).toContain('auth.uid() is not null')
  })

  it('accepts exactly four historical/new pairs, without broadening current-only retry/alignment history', () => {
    expect(cases).toHaveLength(40)
    expect(canonicalPairs(cases.filter(item => item.valid).map(urls))).toEqual(canonicalPairs([[d, p], [d, t], [p, d], [t, d], [t, w], [w, t], [w, a], [a, w]]))
    expect(canonicalPairs(cases.filter(item => item.ordered).map(urls))).toEqual(canonicalPairs([[d, p], [d, t], [w, t], [w, a]]))
    expect(canonicalPairs(cases.filter(item => item.narrow).map(urls))).toEqual(canonicalPairs([[t, w], [w, t], [w, a]]))
    expect(canonicalPairs(cases.filter(item => item.narrow_ordered).map(urls))).toEqual(canonicalPairs([[w, t], [w, a]]))
    for (const pair of [[d, a], [a, d], [p, a], [a, p], [t, a], [a, t], [w, p], [p, w], [w, d], [d, w], [a, a]]) {
      expect(cases.find(item => JSON.stringify(urls(item)) === JSON.stringify(pair))?.valid, JSON.stringify(pair)).toBe(false)
    }
    for (const name of ['credentials', 'query', 'key path', 'foreign', 'http', 'extra provider', 'single provider', 'empty providers', 'null URL', 'missing URL', 'null providers', 'null provider', 'numeric URL', 'object providers', 'missing providers']) {
      expect(cases.find(item => item.name === name)?.valid, name).toBe(false)
    }
    expect(targets.find(item => item.oid === 38526)?.cuts[0].to).toContain('provider_index+1')
    expect(targets.find(item => item.oid === 38760)?.cuts[1].to).toContain("urls = array['" + w + "','" + a + "']")
    expect(cases.find(item => item.name === 'a+w')).toMatchObject({ valid: true, narrow: false, narrow_ordered: false })
    expect(cases.find(item => item.name === 't+w')).toMatchObject({ valid: true, narrow: true, narrow_ordered: false })
    expect(targets.find(item => item.oid === 38760)?.cuts[1].to).not.toContain(d)
  })

  it('keeps finality, actual pure validators and checked whole-body inverse proof query-only', () => {
    expect(metadataCases).toHaveLength(11)
    expect(proof).toContain('bx1_portal.fund_setup_observers_valid(setup_value)')
    expect(proof).toContain('bx1_portal.fund_recipient_result_shape(recipient_value)')
    expect(proof).toContain('bx1_private.fund_alignment_snapshot_valid(alignment_value)')
    expect(proof).toContain("recipient_pair:=replace(substring(recipient_pair from 1 for end_at-1),'urls','($1::text[])')")
    expect(proof).toContain("target_spec->>'signature'='bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)'")
    expect(proof).toContain('alchemy_pair_finality_or_null_changed')
    expect(proof).toContain('case_count<>40 or metadata_count<>11')
    const executable = proof.slice(proof.indexOf('\nbegin\n'), proof.indexOf('end $amoy_archive_alchemy_proof$'))
    expect(executable).not.toMatch(/set_config\s*\(|set\s+(?:local\s+)?role|insert\s+into|update\s+bx1_|delete\s+from|create\s+(?:function|table)/i)
    expect(executable).not.toMatch(/(?:perform|select)\s+bx1_portal\.record_/i)
    const inverse = tagged(feature, 'alchemy_pair_inverse')
    expect(inverse).toContain('alchemy_pair_inverse_metadata_changed')
    expect(inverse).toContain('alchemy_pair_inverse_partial_baseline')
    expect(inverse).toContain('alchemy_pair_inverse_preservation_failed')
    expect(feature.indexOf('/*')).toBeLessThan(feature.indexOf('$alchemy_pair_inverse$'))
    const checkpoint = tagged(proof, 'alchemy_pair_checkpoint')
    expect(count(checkpoint, "'::regprocedure")).toBe(7)
    expect(checkpoint).toContain('not exists(select 1 from target_ids t where t.oid=p.oid)')
    expect(checkpoint).toContain("'bx1_private'")
  })

  it('uses the same installer algorithm in a tightly guarded isolated PG17 catalog adaptation, never a production bypass', () => {
    expect(harness).toContain("process.env.GITHUB_ACTIONS !== 'true'")
    expect(harness).toContain('BX1_AMOY_ARCHIVE_ALCHEMY_SQL_TEST_URL')
    expect(harness).toContain('postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    expect(harness).toContain('All non-catalog-specific native metadata copied exactly')
    expect(harness).toContain("replaceTag(feature, 'alchemy_pair_targets', JSON.stringify(local))")
    expect(harness).toContain("tag(source, name) + '$' + name + '$', () => '$' + name + '$' + value")
    expect(harness).toContain('Second real CREATE OR REPLACE failure rolls back first')
    expect(harness).toContain('Idempotent repeat exact full catalog equality')
    expect(harness).toContain('Checked inverse restores seven full original pg_proc rows')
    expect(harness).toContain('Unknown body rejected without partial cut')
    expect(harness).toContain('Mixed original/final set rejected')
    expect(harness).toContain('All three historical provider payload/hash rows unchanged')
    expect(harness).toContain('writers=not-called auth=not-proven provider=not-proven businessJourney=not-proven')
    expect(harness).not.toContain('check_function_bodies')
    expect(harness).not.toContain('set_config')
    expect(harness).not.toMatch(/(?:fetch\(|https:\/\/.*supabase\.co|SUPABASE.*KEY)/)
  })

  it('does not rewrite historical installers or old accepted proof sources', () => {
    for (const [path, expected] of [
      ['supabase/features/bx1_amoy_archive_observers.sql', '06b4fd06506e96c7fdd7f83e4eae61cabf0ee4f781dc9bca07e94d9ed73392b2'],
      ['supabase/features/bx1_amoy_archive_pair_v2.sql', '8782ef5c8e309ca42ab2be07362d5c3cb377854dc14437eb05ac83332c93d977'],
      ['supabase/tests/bx1_amoy_archive_observers.sql', '01d4e0e31963ca9bee7149be21c05e90169e469d2cad068e43e8680b3de98ab0'],
      ['supabase/tests/bx1_amoy_archive_pair_v2.sql', 'a25ebeeebd948a2d473e2bc2b3f0cdffee268c931cd8e7e4a6fe83561fa05355'],
    ]) expect(hash(read(path)), path).toBe(expected)
  })
})
