import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract checks only. These do not prove installation, a genuine MFA
// session, provider delivery, MetaMask signatures, payment or legal holdings.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_fund_roleplay_commands.sql'), 'utf8')
type Cutover = { signature: string; sha: string; owner: string; secdef: boolean; acl: string; config: string[]; next_body: string }
const match = sql.match(/\$roleplay_specs\$\s*([\s\S]*?)\s*\$roleplay_specs\$::jsonb/)
if (!match) throw new Error('Missing exact role-play cutover specifications')
const cutovers = JSON.parse(match[1]) as Cutover[]
const body = (name: string) => {
  const selected = cutovers.filter(item => item.signature.startsWith(`bx1_portal.${name}(`) || item.signature.startsWith(`bx1_private.${name}(`))
  if (selected.length !== 1) throw new Error(`Expected one exact cutover for ${name}`)
  return selected[0].next_body
}

describe('scoped TEST role-play canonical fund integration', () => {
  it('pins canonical bodies and preserves their OIDs and privilege metadata rather than creating competing writers', () => {
    expect(new Set(cutovers.map(item => item.signature)).size).toBe(cutovers.length)
    for (const item of cutovers) {
      expect(item.sha).toMatch(/^[0-9a-f]{64}$/)
      expect(item.owner).toBe('postgres')
      expect(item.config).toEqual(['search_path=""'])
    }
    expect(sql).toContain("pg_catalog.to_jsonb(p)-'prosrc'")
    expect(sql).toContain('fund_roleplay_canonical_metadata_changed')
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres'")
    expect(sql).toContain("environment='TESTNET'")
    for (const name of ['fund_person', 'fund_context', 'funding_person', 'entity_people_independent', 'independent_of',
      'has_session_mfa', 'has_token_mfa', 'document_governance_trusted_person']) {
      expect(cutovers.some(item => item.signature.match(new RegExp(`\\.${name}\\(`)))).toBe(false)
    }
    expect(cutovers.some(item => item.signature.includes('execute_scoped_pre_eligibility'))).toBe(false)
    expect(cutovers.some(item => item.signature.includes('funding_actions'))).toBe(false)
    expect(cutovers.some(item => item.signature.includes('funding_route_current'))).toBe(false)
  })

  it('stores actual operator and original policy provenance and denies selector replay or historical rebinding', () => {
    expect(sql).toContain('independence_proven boolean not null default false check(not independence_proven)')
    expect(sql).toContain('receipt.policy_id is distinct from policy')
    expect(sql).toContain('receipt.authority_epoch is distinct from p.authority_epoch')
    expect(sql).toContain('receipt.signing_address is distinct from fund_roleplay_enter.signing_address')
    expect(sql).toContain('lane.action=fund_roleplay_lane_current.action')
    expect(sql).toContain('lane.action=fund_roleplay_allocation_basis_current.action')
    expect(sql).toContain('fund_roleplay_cannot_backfill_existing_record')
    expect(sql).toContain('fund_roleplay_provenance_immutable')
    expect(sql).toContain('max(later.version)')
    expect(sql).toContain('fund_roleplay_authority_changed_after_wait')
    expect(sql).toContain('fund_roleplay_authority_changed_at_commit')
    expect(sql).toContain('for share of factor')
    expect(sql).not.toMatch(/(?:insert into|update)\s+bx1_private\.person_principals/i)
    expect(sql).not.toMatch(/status\s*=\s*'TRUSTED'/i)
  })

  it('requires real wallet control, separate admitted addresses and original cryptographic verification', () => {
    expect(sql).toContain('wallet.last_proof_id=binding.proof_id')
    expect(sql).toContain('proof.used_at is not null and proof.proof_signature is not null')
    expect(sql).toContain('proof.issued_at>=p.valid_from')
    expect(sql).toContain('fund_roleplay_exact_signing_owner_required')
    expect(sql).toContain('where roleplay_policy_id is null')
    expect(sql).toContain('fund_signatures_roleplay_key')
    expect(sql).toContain('fund_approvals_roleplay_key')
    expect(sql).toContain('operation_id,roleplay_signing_address')
    expect(body('fund_record_signature')).toContain("state','UNVERIFIED'")
    expect(cutovers.some(item => item.signature.includes('record_fund_signature_verification'))).toBe(false)
    expect(body('fund_claim_execution')).toContain("s.status='VERIFIED'")
    expect(body('fund_claim_execution')).toContain('if n<sp.safe_threshold')
    expect(body('fund_claim_execution')).toContain("set state='UNKNOWN'")
    expect(body('fund_prepare')).toContain('cardinality(owners)=1')
    expect(body('fund_operation_projection')).toContain("'signing_owner_addresses'")
    expect(body('fund_operation_projection')).toContain("o.roleplay_policy_id is not null and o.state='APPROVAL_PENDING'")
    expect(body('fund_record_signature')).toContain("o.state not in ('APPROVED','SIGNING')")
    expect(body('fund_claim_execution')).toContain("o.state<>'SIGNING'")
  })

  it('binds pre-payment issuer basis and downstream allocations to their saved epoch without inventing funding', () => {
    expect(body('fund_payment_basis_source_current')).toContain('sp.roleplay_policy_id=m.roleplay_policy_id')
    expect(body('fund_payment_basis_source_current')).toContain("admission.status='APPROVED'")
    expect(body('fund_payment_basis_source_current')).toContain('bx1_portal.fund_manifest_current(m.id)')
    expect(body('fund_payment_basis_proposal_current')).toContain("requested_context,'request_fund_payment_allocation_basis'")
    expect(body('fund_payment_basis_current')).toContain('authority.roleplay_epoch=basis.roleplay_epoch')
    expect(body('fund_payment_basis_current')).toContain('basis.approved_person_id=basis.requested_person_id')
    expect(body('fund_command')).toContain('fund_roleplay_allocation_basis_current')
    expect(body('fund_allocation_current')).toContain('basis.roleplay_policy_id=a.roleplay_policy_id')
    expect(body('fund_allocation_current')).toContain("bx1_portal.funding_state(o.id)='RECONCILED'")
    expect(body('fund_allocation_current')).toContain('bx1_portal.product_eligibility_current(eligibility.id)')
    expect(body('fund_prepare_payment')).toContain('fund_issuer_allocation_basis_required_before_payment')
    expect(body('fund_submit_payment')).toContain('fund_issuer_allocation_basis_changed_before_submission')
    expect(body('fund_record_payment')).not.toContain('fund_payment_basis_intent_current')
    expect(sql).not.toMatch(/(?:insert into|update)\s+bx1_portal\.(?:funding_(?:observations|journals)|fund_(?:holdings|register_entries))/i)
    expect(body('fund_order_projection')).toContain("'binding_id',b.id")
  })

  it('retains actual DocuSign evidence and approved document packages', () => {
    expect(body('offering_signature_authorisation_current')).toContain('offering_document_clean_receipts')
    expect(body('offering_signature_require_decision')).toContain('offering_signature_evidence_current')
    expect(body('offering_signature_bind_decision')).toContain("action='EVIDENCE_FINALIZED'")
    expect(body('offering_signature_bind_decision')).toContain("result->'integrity_verified'='true'::jsonb")
    expect(body('offering_signature_require_decision')).toContain('fund_roleplay_signature_decision_current')
    expect(sql).not.toMatch(/set\s+state\s*=\s*'EVIDENCE_RETAINED'/i)
  })

  it('closes private functions and exposes only guarded invoker RPC bridges', () => {
    expect(sql).toContain("n.nspname='bx1_private' and p.proname like 'fund_roleplay_%'")
    expect(sql).toContain('from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_fund_execution_worker')
    expect(sql).toContain('grant execute on function %s to postgres')
    expect(sql).toContain('public.bx1_portal_prepare_fund_transaction(operation_id uuid,expected_revision integer,operating_context jsonb,signing_address text)')
    expect(sql).toContain('public.bx1_portal_record_fund_signature(operation_id uuid,expected_revision integer,signature text,operating_context jsonb,signing_address text)')
    expect(sql).toContain('public.bx1_portal_fund_lifecycle_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb,signing_address text)')
    expect(sql).toContain('language sql volatile security invoker')
    expect(sql).toContain('fund_roleplay_never_grants_superadmin')
  })
})
