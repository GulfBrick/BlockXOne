import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static source contracts, not provider execution or a genuine-session acceptance receipt.
const features = resolve(process.cwd(), '../../supabase/features')
const bridge = readFileSync(resolve(features, 'bx1_fund_roleplay_manager_bridge.sql'), 'utf8').replace(/\r\n/g, '\n')
const installer = readFileSync(resolve(features, 'bx1_offering_signature_roleplay_continuation.sql'), 'utf8').replace(/\r\n/g, '\n')
const proof = readFileSync(resolve(features, '../tests/bx1_offering_signature_roleplay_continuation.sql'), 'utf8')
const foundation = readFileSync(resolve(features, 'bx1_fund_test_roleplay.sql'), 'utf8')
const specs = JSON.parse(bridge.match(/\$manager_specs\$\s*(\[[\s\S]*?\])\s*\$manager_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
const before = specs.find(spec => spec.signature === 'bx1_private.test_roleplay_role_actions(text)')!.next_body
const cuts = [
  ["'request_product_service_appointment','REQUEST_PURPOSE']", "'request_product_service_appointment','REQUEST_PURPOSE','REQUEST_RECONCILIATION','REQUEST_RECOVERY']"],
  ["'PREPARE_EXECUTION','REQUEST_SIGNING_VIEW']", "'PREPARE_EXECUTION','REQUEST_SIGNING_VIEW','REQUEST_RECONCILIATION','REQUEST_RECOVERY']"],
  ["'REVIEW_PURPOSE','REVOKE_PURPOSE']", "'REVIEW_PURPOSE','REVOKE_PURPOSE','REQUEST_RECONCILIATION','REQUEST_RECOVERY']"],
]
const after = cuts.reduce((source, [from, to]) => source.replace(from, to), before)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

describe('TEST package signature continuation action map', () => {
  it('preserves the exact installed baseline and changes only three scoped role-list tails', () => {
    expect(hash(before)).toBe('2de3ad03e89f4d96dccf0a50058fc238348999aa710dd40daa7f1e8e8d692e72')
    expect(hash(after)).toBe('d8007ad89d4eae76b9cb050089989b8b29af7065544f79c7e4b99846dc92459a')
    for (const [from, to] of cuts) {
      expect(before.split(from)).toHaveLength(2)
      expect(installer).toContain(from.replaceAll("'", "''"))
      expect(installer).toContain(to.replaceAll("'", "''"))
    }
    expect(cuts.reduce((source, [from, to]) => source.replace(to, from), after)).toBe(before)
  })
  it('does not add signing, worker or evidence-setting powers to unrelated roles', () => {
    for (const line of after.split('\n')) {
      if (/when '(OfferingManager|IssuerFundManager|ComplianceOfficer)'/.test(line)) {
        expect(line).toContain("'REQUEST_RECONCILIATION','REQUEST_RECOVERY'")
      } else expect(line).not.toContain('REQUEST_RECOVERY')
    }
    expect(after).not.toMatch(/'WAKE'|'CLAIM'|'PROCESS'|'EVIDENCE_FINALIZED'/)
    expect(after.split('\n').find(line => line.includes("when 'OfferingManager'"))).not.toContain('REQUEST_SIGNING_VIEW')
    expect(after.split('\n').find(line => line.includes("when 'ComplianceOfficer'"))).not.toContain('REQUEST_SIGNING_VIEW')
  })
  it('requires owner-only TEST installation with unchanged OID, ACL and function metadata', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres'", "where singleton and environment='TESTNET'",
      "pg_catalog.to_jsonb(p)-'prosrc'", "is distinct from '{postgres=X/postgres}'", 'before_metadata is distinct from after_metadata',
      'signature_roleplay_continuation_exact_map_pin_mismatch', 'signature_roleplay_continuation_result_pin_mismatch']) expect(installer).toContain(fragment)
    expect(installer).not.toMatch(/(?:insert into|update|delete from|grant|revoke|alter role|create table)\s/i)
    expect(installer).not.toContain('create or replace function bx1_private.has_')
  })
  it('preserves immutable saved capacities and real protected-session/product-policy authority', () => {
    expect(foundation).toContain('p_action=any(capacity.actions)')
    expect(foundation).toContain('p_action=any(bx1_private.test_roleplay_role_actions(capacity.role))')
    expect(foundation).toContain('before update or delete on bx1_private.%I')
    expect(installer).toContain('Existing immutable capacity rows do NOT acquire these actions')
    expect(proof).toContain('signature_roleplay_continuation_saved_policy_action_guard_missing')
    expect(proof).toContain('signature_roleplay_continuation_missing_authority_not_denied')
    expect(proof).not.toMatch(/set_config\s*\(|insert into\s|update\s+auth\.|delete from\s/i)
  })
})
