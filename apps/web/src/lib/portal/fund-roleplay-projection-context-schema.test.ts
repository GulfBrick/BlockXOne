import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract proof, not a synthetic authenticated session or positive
// hosted projection. The existing runtime guard still decides each real read.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_projection_context.sql')
const lifecycle = read('bx1_fund_lifecycle.sql')
const roleplay = read('bx1_fund_test_roleplay.sql')
const hash = (value: string) => createHash('sha256').update(value.trim(), 'utf8').digest('hex')
const original = lifecycle.match(/create function bx1_portal\.fund_product_projection\(c jsonb,pid uuid\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/)![1]
const oldFragment = sql.match(/\$old\$([\s\S]*?)\$old\$/)![1]
const newFragment = sql.match(/\$new\$([\s\S]*?)\$new\$/)![1]
const corrected = original.replace(oldFragment, newFragment)
const dependencies = JSON.parse(sql.match(/\$dependencies\$([\s\S]*?)\$dependencies\$::jsonb/)![1]) as { signature: string; sha: string }[]
const helperBody = (name: string) => roleplay.match(new RegExp(`create function bx1_private\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]

describe('current TEST authority organisation in the existing fund projection', () => {
  it('pins and changes only the native organisation fallback, preserving manifest/mandate precedence and original preparation source', () => {
    expect(hash(original)).toBe('5ea5687a23f2fa4f904dcca6634607268d1eec11c32ff8956f68681accfcb43b')
    expect(sql).toContain("is distinct from '5ea5687a23f2fa4f904dcca6634607268d1eec11c32ff8956f68681accfcb43b'")
    expect(oldFragment).toBe('  native_org:=coalesce(m.native_organisation_id,\n    (select native_organisation_id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id and applied_at is not null limit 1),\n')
    expect(original.split(oldFragment)).toHaveLength(2)
    expect(corrected.split(newFragment)).toHaveLength(2)
    expect(corrected.replace(newFragment, oldFragment)).toBe(original)
    expect(newFragment.startsWith(oldFragment)).toBe(true)
    expect(corrected).toContain('order by policy.version desc limit 1),\n    (select native_organisation_id from bx1_private.test_workspace_sources where product_organisation_id=p.organisation_id));')
    expect(sql).toContain('replace(next_body,new_fragment,old_fragment) is distinct from original')
  })

  it.each([
    ['wrong actor', 'capacity.user_id=auth.uid()'],
    ['wrong capacity', "capacity.role=c->>'role'"],
    ['wrong product', 'policy.product_id=p.id and policy.product_organisation_id=p.organisation_id'],
    ['wrong offering', 'policy.offering_revision_id=p.current_offering_revision_id'],
    ['changed terms', 'policy.terms_hash=p.terms_hash'],
    ['wrong environment', "policy.environment='TESTNET' and policy.project_ref='fegnnnlseuejkrusbbkv'"],
    ['wrong organisation', "policy.native_organisation_id::text=c->>'organisationId'"],
    ['superseded policy', 'policy.version=(select max(later.version)'],
    ['wrong policy/epoch or current session', 'test_roleplay_current(policy.id,p.id,p.current_offering_revision_id,\n          auth.uid(),c,capacity.actions[1],null,policy.authority_epoch) is true'],
  ])('requires the exact %s binding before projecting policy authority', (_label, fragment) => {
    expect(newFragment).toContain(fragment)
  })

  it('pins the unchanged current-policy guard chain, including real session/MFA, time, revocation and membership checks', () => {
    const current = helperBody('test_roleplay_current'), policy = helperBody('test_roleplay_policy_current')
    const binding = helperBody('test_roleplay_binding_current'), session = helperBody('test_roleplay_protected_session')
    expect(dependencies).toHaveLength(4)
    for (const [name, body] of [['test_roleplay_current', current], ['test_roleplay_policy_current', policy],
      ['test_roleplay_binding_current', binding], ['test_roleplay_protected_session', session]]) {
      expect(dependencies.find(value => value.signature.startsWith(`bx1_private.${name}(`))?.sha).toBe(hash(body))
    }
    for (const fragment of ['p_actor is distinct from auth.uid()', 'test_roleplay_protected_session() is not true',
      'policy.id=p_policy and policy.product_id=p_product and policy.offering_revision_id=p_offering',
      "policy.native_organisation_id::text=p_context->>'organisationId'", 'p_epoch=policy.authority_epoch',
      "membership.status='ACTIVE'", 'native_membership_effective(membership.id)',
      'p_action=any(capacity.actions)', 'p_action=any(bx1_private.test_roleplay_role_actions(capacity.role))',
    ]) expect(current).toContain(fragment)
    expect(policy).toContain('test_roleplay_protected_session() and bx1_private.test_roleplay_binding_current(p_id)')
    for (const fragment of ["r.status='ACTIVE'", 'r.valid_from<=pg_catalog.clock_timestamp()', 'r.valid_until>pg_catalog.clock_timestamp()',
      "r.environment='TESTNET'", 'not r.independence_proven', 'p.current_offering_revision_id=o.id', 'p.terms_hash=r.terms_hash',
      "p.terms->>'currency'='TST'", "p.terms->>'settlement_decimals'='6'",
    ]) expect(binding).toContain(fragment)
    expect(session).toContain('test_roleplay_environment()')
  })

  it('does not change admission, product visibility, manifest readiness or the returned business state', () => {
    for (const fragment of ['bx1_portal.fund_product_visible(c,p.id) is not true then return null',
      'if native_org is null then return null', "'native_organisation_id',native_org", "'product_revision',p.revision",
      "'offering_revision_id',p.current_offering_revision_id", "'terms_hash',p.terms_hash",
      "'availability',case when m.id is not null and sp.id is not null and bx1_portal.fund_manifest_current(m.id) then 'AVAILABLE' else 'DEPENDENCY_NOT_ADMITTED' end",
    ]) expect(corrected).toContain(fragment)
    expect(newFragment).not.toContain("'AVAILABLE'")
    expect(newFragment).not.toContain('test_workspace_sources')
    expect(newFragment).not.toContain('set_config(')
  })

  it('preserves native OID/owner/ACL/all non-body metadata and creates no helper, grant or stored record', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", 'target is distinct from 31531::oid',
      "before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text",
      "before_row->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "before_row->'proconfig' is distinct from '[\"search_path=\\\"\\\"\"]'::jsonb",
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
      'fund_roleplay_projection_context_dependency_mutated',
    ]) expect(sql).toContain(fragment)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|delete from|alter table|alter role|set_config)\s/i)
    expect(sql).not.toContain('update bx1_')
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('fund_roleplay_finish(')
  })
})
