import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static source contracts, not a fabricated real session or hosted acceptance.
const featurePath = resolve(process.cwd(), '../../supabase/features')
const canonical = readFileSync(resolve(featurePath, 'bx1_offering_documents.sql'), 'utf8').replace(/\r\n/g, '\n')
const installer = readFileSync(resolve(featurePath, 'bx1_offering_aal2_otp_attestation.sql'), 'utf8').replace(/\r\n/g, '\n')
const negatives = readFileSync(resolve(featurePath, '../tests/bx1_offering_aal2_otp_attestation.sql'), 'utf8')
const guardMatch = canonical.match(/create function bx1_private\.offering_file_session_context\(p_actor uuid,p_session uuid,p_aal text,a jsonb\)\s*returns void language plpgsql volatile security definer set search_path='' as \$\$([\s\S]*?)\$\$;/)
if (!guardMatch) throw new Error('Missing the exact four-argument offering attestation guard')
const guard = guardMatch[1]
const oldPredicate = "or method->>'method' not in ('password','totp','mfa/totp')"
const newPredicate = [
  "or (method->>'method' not in ('password','totp','mfa/totp')",
  "        and not (p_aal='aal2' and method->>'method'='otp'",
  "          and exists(select 1 from pg_catalog.jsonb_array_elements(a->'amr') amr_proof(entry)",
  "            where amr_proof.entry->>'method' in ('totp','mfa/totp'))))",
].join('\n')
const sha = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex')

describe('one TEST offering-file AMR compatibility correction', () => {
  it('changes exactly one predicate and no other original guard source byte', () => {
    expect(guard.split(newPredicate)).toHaveLength(2)
    expect(guard).not.toContain(oldPredicate)
    expect(sha(guard.replace(newPredicate, oldPredicate)))
      .toBe('2096dc8db8e025d9aa684d03a34f18465519cb7195ea33c1a03842cbe50c48c1')
    expect(sha(guard)).toBe('9d7e289016a8afa0f3d6c4c9011f4b16c23b97f94d036f8971fb7ba733d73d5a')
  })

  it('requires TOTP AMR evidence as well as AAL2 for the recognised OTP primary method', () => {
    expect(newPredicate).toContain("p_aal='aal2' and method->>'method'='otp'")
    expect(newPredicate).toContain("where amr_proof.entry->>'method' in ('totp','mfa/totp')")
    expect(guard).toContain("method-array['method','timestamp']<>'{}'::jsonb")
    expect(guard).toContain("(method->>'timestamp')::numeric>at")
    expect(guard).toContain("pg_catalog.jsonb_array_length(a->'amr')<>1 or a->'amr'->0->>'method'<>'password'")
    expect(guard).toContain('bx1_portal.admission_password_session() is not true')
  })

  it('retains the real exact issuer/actor/session, live factor, person and expiry boundaries', () => {
    for (const fragment of [
      "a->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'",
      "a->>'sub' is distinct from p_actor::text or a->>'session_id' is distinct from p_session::text",
      "(a->>'exp')::numeric<=at",
      's.id=p_session and s.user_id=p_actor and s.aal::text=p_aal and s.oauth_client_id is null',
      's.not_after>pg_catalog.clock_timestamp()',
      'u.email_confirmed_at is not null and u.deleted_at is null',
      'u.banned_until<=pg_catalog.clock_timestamp()',
      'bx1_portal.offering_workflow_person_current(p_actor) is not true',
      'bx1_portal.fresh_session() is not true or bx1_private.has_session_mfa() is not true',
      'or bx1_private.has_token_mfa() is not true',
      "raise exception 'offering_file_native_assurance_denied'",
    ]) expect(guard).toContain(fragment)
    expect(guard.indexOf('from auth.sessions s join auth.users u')).toBeLessThan(guard.indexOf("set_config('request.jwt.claims'"))
    expect(canonical).toContain("raise exception 'offering_file_scope_denied'")
    expect(canonical).toContain('bx1_private.offering_document_manager(c,target_revision)')
    expect(canonical).toContain('perform bx1_portal.offering_workflow_lock_product(c,p.id)')
  })

  it('installs only on TEST as the existing owner with complete OID and privilege preservation', () => {
    expect(installer).toContain("current_user<>'postgres' or session_user<>'postgres'")
    expect(installer).toContain("where singleton and environment='TESTNET'")
    expect(installer).toContain("offering_file_session_context(uuid,uuid,text,jsonb)")
    expect(installer).toContain('2096dc8db8e025d9aa684d03a34f18465519cb7195ea33c1a03842cbe50c48c1')
    expect(installer).toContain('9d7e289016a8afa0f3d6c4c9011f4b16c23b97f94d036f8971fb7ba733d73d5a')
    expect(installer).toContain("pg_catalog.to_jsonb(p)-'prosrc'")
    expect(installer).toContain("is distinct from '{postgres=X/postgres}'")
    expect(installer).toContain('before_metadata is distinct from after_metadata')
    expect(installer).toContain('is distinct from next_body')
    expect(installer).toContain('offering_aal2_otp_predicate_not_unique')
    expect(installer).not.toMatch(/(?:grant|revoke|alter role|insert into|update|delete from|create table|set role)\s/i)
    expect(installer).not.toContain('create or replace function bx1_private.has_')
  })

  it('provides denial-only proof without seeding fake users, sessions, factors or JWT authority', () => {
    for (const label of [
      'incomplete', 'unknown-method', 'expired', 'wrong-issuer', 'wrong-subject', 'wrong-session',
      'future-method-time', 'malformed-method-time', 'otp-only-aal2', 'otp-totp-aal1',
      'otp-only-aal1', 'well-shaped-otp-totp-no-session', 'well-shaped-otp-mfa-totp-no-session',
      'original-password-totp-no-session', 'original-password-aal1-no-session',
    ]) expect(negatives).toContain("'" + label + "'")
    expect(negatives).toContain('offering_file_attestation_denied')
    expect(negatives).toContain('offering_file_session_denied')
    expect(negatives).toContain('before_counts is distinct from after_counts')
    expect(negatives).toContain("current_setting('request.jwt.claims',true)")
    expect(negatives).not.toMatch(/(?:insert into|update|delete from|set_config)\s*\(/i)
    expect(negatives).not.toMatch(/(?:insert into|update|delete from)\s+(?:auth|public)\./i)
  })
})
