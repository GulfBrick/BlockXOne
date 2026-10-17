import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract regressions only, not installation, MFA, human-independence,
// provider, financial or blockchain acceptance evidence.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_test_roleplay.sql'), 'utf8')
describe('TEST-only role-play authority foundation', () => {
  it('records one expressly nontrusted identity without inventing principals or editing global guards', () => {
    expect(sql).toContain("status='TEST_ROLE_PLAY'")
    expect(sql).toContain("'OWNER_ASSERTED_SINGLE_TEST_OPERATOR'")
    expect(sql).toContain("independence_proven boolean not null default false check(not independence_proven)")
    expect(sql).not.toMatch(/(?:insert into|update)\s+bx1_private\.person_principals/i)
    expect(sql).not.toMatch(/create (?:or replace )?function\s+(?:bx1_portal\.(?:entity_people_independent|independent_of|fund_person|fund_context|funding_person)|bx1_private\.(?:has_session_mfa|has_token_mfa|document_governance_trusted_person))\b/i)
    expect(sql).toContain('deferrable initially deferred for each row execute function bx1_private.test_roleplay_person_provenance()')
  })
  it('requires actual TEST issuer, live verified TOTP and native scoped capacity', () => {
    expect(sql).toContain("auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'")
    expect(sql).toContain("auth.jwt()->>'aal'='aal2'")
    expect(sql).toContain('bx1_private.has_session_mfa() and bx1_private.has_token_mfa()')
    expect(sql).toContain("f.status::text='verified' and f.factor_type::text='totp'")
    expect(sql).toContain("policy.product_id=p_product and policy.offering_revision_id=p_offering")
    expect(sql).toContain('p_actor is distinct from auth.uid()')
    expect(sql).toContain('test_roleplay_authority_changed_after_wait')
    expect(sql).toContain('roleplay_owner_edges_not_restored')
  })
  it('keeps funding/provider/chain facts and existing business writers out of provisioning', () => {
    expect(sql).toContain("ownership_assurance text not null default 'DECLARED_NOT_VERIFIED'")
    expect(sql).toContain("action text not null check(action in ('PROVISIONED','POLICY_REVOKED'))")
    expect(sql).not.toMatch(/(?:insert into|update)\s+bx1_portal\.(?:fund_(?:operations|authorities|holdings|register_entries)|funding_(?:observations|journals|references))/i)
    expect(sql).not.toMatch(/(?:insert into|update)\s+public\.bx1_memberships/i)
    expect(sql).not.toContain('create or replace function')
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres'")
    expect(sql).toContain("environment text not null default 'TESTNET' check(environment='TESTNET')")
  })
  it('restricts revocation to the approving owner or explicit current Super Admin and rechecks after locks', () => {
    const allowed = sql.split('create function bx1_private.test_roleplay_revoke_allowed')[1].split('create function')[0]
    const revoke = sql.split('create function bx1_private.test_roleplay_revoke(')[1].split('create function')[0]
    expect(allowed).toContain("c.user_id=auth.uid() and c.role='SuperAdmin'")
    expect(allowed).toContain("'revoke_test_roleplay'=any(c.actions)")
    expect(allowed).toContain('operator.person_id=policy.actual_operator_person_id')
    expect(allowed).toContain("identity.status='TEST_ROLE_PLAY'")
    expect(allowed).toContain('bx1_portal.native_membership_effective(m.id)')
    expect(allowed).toContain("'role','SuperAdmin'")
    expect(revoke).toContain('p_reason is null or char_length(pg_catalog.btrim(p_reason)) not between 20 and 2000')
    expect(revoke).toContain('for share of f')
    expect(revoke).toContain('lock_funding_person(auth.uid(),p.actual_operator_person_id)')
    expect(revoke).toContain('test_roleplay_revoke_authority_changed_after_wait')
    expect(revoke).toContain('test_roleplay_revoke_authority_changed_at_commit')
    expect(revoke.match(/test_roleplay_revoke_allowed\(p.id,p_context\)/g)).toHaveLength(3)
    expect(revoke.indexOf('for share')).toBeLessThan(revoke.indexOf('where id=p_policy for update'))
  })
})
