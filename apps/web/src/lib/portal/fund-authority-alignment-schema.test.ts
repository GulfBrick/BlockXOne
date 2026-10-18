import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const feature = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_authority_alignment.sql'), 'utf8')
const proof = readFileSync(resolve(process.cwd(), '../../supabase/tests/bx1_fund_authority_alignment.sql'), 'utf8')
const fixture = readFileSync(resolve(process.cwd(), 'scripts/test-fund-authority-alignment.mjs'), 'utf8')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const specs = JSON.parse(feature.match(/\$alignment_sources\$(.*?)\$alignment_sources\$/s)![1]) as { signature: string; definer: boolean; sha256: string }[]

describe('bounded TEST Safe authority alignment native source', () => {
  it('pins every complete new function source and the one original worker patch', () => {
    const definitions = [...feature.matchAll(/create or replace function ([a-z_0-9.]+)\(([^)]*)\) returns [^\n]+\nlanguage ([^\n]+) as \$fn\$(.*?)\$fn\$;/gs)]
    expect(definitions).toHaveLength(12)
    for (const definition of definitions) {
      const types = definition[2].trim() ? definition[2].split(',').map(arg => arg.trim().split(/\s+/).at(-1)).join(',') : ''
      expect(specs.find(spec => spec.signature === `${definition[1]}(${types})`)).toEqual({ signature: `${definition[1]}(${types})`,
        definer: definition[3].includes('security definer'), sha256: hash(definition[4]) })
    }
    expect(proof.match(/\$alignment_sources\$(.*?)\$alignment_sources\$/s)?.[1]).toBe(JSON.stringify(specs))
    const worker = feature.match(/\$alignment_worker_final\$(.*?)\$alignment_worker_final\$/s)![1]
    expect(hash(worker)).toBe('2e85e284036dd632e186c963bb698ec7f67bb550e0d6e9359eec0516b6a756ec')
    expect(feature).toContain('3e238a44526efa202e243db0f9a1465e7448f77e8c803e53e4af4192f6e84ec7')
    expect(worker).toContain('perform bx1_portal.fund_setup_lock(r.operating_context,r.product_id,true);')
    expect(worker).toContain('perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);')
    expect(worker).not.toContain('r.actor_claims::text')
    expect(feature).toContain("p_before-'prosrc' is distinct from p_after-'prosrc'")
  })

  it('keeps phase authority exact, single-use and tied to current subject rather than a latest receipt', () => {
    for (const purpose of ['ALIGNMENT_READ', 'ALIGNMENT_WRITE', 'ADMISSION_READ', 'ADMISSION_WRITE']) expect(feature).toContain(purpose)
    expect(feature).toContain("now_at+interval '60 seconds'")
    expect(feature).toContain("j->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'")
    expect(feature).toContain('a.operation_revision,a.intent_hash')
    expect(feature).toContain('on conflict on constraint fund_alignment_consumptions_pkey do nothing')
    expect(feature).toContain("raise exception 'alignment_receipt_already_used'")
    expect(feature).toContain("r.roleplay_epoch<1")
    expect(feature).toContain("if r.roleplay_epoch<2 then")
    expect(feature).not.toMatch(/order by[^;]*expires_at desc/)
  })

  it('preserves original setup and request identity, original Safe intent, and terminal history', () => {
    expect(feature).not.toMatch(/(?:update|delete from|alter table) bx1_portal\.(?:fund_setups|fund_setup_steps|fund_admission_requests)/i)
    expect(feature).toContain("pg_catalog.jsonb_build_array('BX1_AUTHORITY_ALIGNMENT_V1',80002,safe,controller,")
    expect(feature).toContain("'0x6c76176b'")
    expect(feature).toContain("return '0x6a761202'")
    expect(feature).toContain("if action='CLAIM' and o.claimed_at is not null then")
    expect(feature).toContain("if o.state='UNKNOWN' and o.transaction_hash is null then")
    expect(feature).toContain("old.state='FINAL'")
    expect(feature).toContain("obs->'inner_execution_success' is distinct from 'true'::jsonb")
    expect(feature).toContain("obs->'observed_epoch' is distinct from o.intent->'target_epoch'")
    expect(feature).toContain("obs#>'{receipt_hashes,0}' is distinct from obs#>'{receipt_hashes,1}'")
  })

  it('uses only a disposable cloud fixture and exposes its genuine-auth/provider limitations', () => {
    expect(fixture).toContain("process.env.GITHUB_ACTIONS !== 'true'")
    expect(fixture).toContain('BX1_FUND_AUTHORITY_ALIGNMENT_SQL_TEST_URL')
    expect(fixture).toContain('postgresql://postgres:bx1-synthetic-ci-only@127.0.0.1:5432/bx1_demo_ci')
    expect(fixture).toContain('two-connection')
    expect(fixture).toContain('audit-rollback')
    expect(fixture).toContain('original JWT expired')
    expect(fixture).toContain('hostedAcceptance=not-proven')
    expect(fixture).not.toContain('process.env.SUPABASE')
    expect(proof).not.toMatch(/set_config\(|insert into|update bx1_|delete from|create function/i)
  })
})
