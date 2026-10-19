import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Finite source-contract proof only. Not a fabricated session, file, scanner
// result, role grant or positive hosted upload acceptance.
const root = resolve(process.cwd(), '../../supabase/features')
const sql = readFileSync(resolve(root, 'bx1_offering_file_roleplay_context.sql'), 'utf8').replace(/\r\n/g, '\n')
const canonical = readFileSync(resolve(root, 'bx1_offering_documents.sql'), 'utf8').replace(/\r\n/g, '\n')
const manager = readFileSync(resolve(root, 'bx1_fund_roleplay_manager_bridge.sql'), 'utf8').replace(/\r\n/g, '\n')
const pins = JSON.parse(sql.match(/\$pins\$([\s\S]*?)\$pins\$::jsonb/)![1]) as { signature: string; sha256: string }[]
const oldCase = sql.match(/old_case constant text:=\$old\$([\s\S]*?)\$old\$/)![1]
const newCase = sql.match(/new_case constant text:=\$new\$([\s\S]*?)\$new\$/)![1]

describe('exact TEST offering-file role-play context correction', () => {
  it('pins only the two installed twelve-argument writers, never delegates or global authority helpers', () => {
    expect(pins).toEqual([
      { signature: 'bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)', sha256: '602b5b6094d517b30d8a49936b76bd7e618728ea206fe98f456b44c9915765fa' },
      { signature: 'bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)', sha256: '2546b4672d54146c22dbd90e67aec8021e83ce45d82ba1e2159177b9b92131ea' },
    ])
    for (const pin of pins) expect(canonical).toContain(`"${pin.signature}":"${pin.sha256}"`)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|grant|revoke|insert into|update|delete from|alter table|alter role|set_config)\s/i)
  })
  it('changes only the profiled operator case and preserves the non-profiled operator byte-for-byte', () => {
    const addition = '\n        or (bx1_private.offering_document_manager(operating_context,target_revision)\n          and bx1_private.fund_roleplay_manager_current(operating_context,v_product.id))'
    const originalOperator = 'bx1_portal.offering_workflow_operator(operating_context,v_product.organisation_id)'
    expect(newCase).toBe(oldCase.replace(originalOperator, `(${originalOperator}${addition})`))
    expect(newCase).toContain('else bx1_portal.scoped_operator(operating_context,v_product.organisation_id) end)')
    const recipe = JSON.parse(canonical.match(/create function bx1_private\.offering_document_writer_recipe\(\)[\s\S]*?\$json\$([\s\S]*?)\$json\$/)![1]) as { from: string; to: string; count: number }[]
    expect(recipe.find(change => change.from === 'bx1_portal.scoped_operator(operating_context,v_product.organisation_id)')?.to).toBe(oldCase)
    expect(sql).toContain('replace(next_body,new_case,old_case) is distinct from original')
    expect(sql).toContain('offering_file_roleplay_cut_not_unique')
    expect(sql).toContain('offering_file_roleplay_native_changed_before_cut')
  })
  it('preserves owner, OID, ACLs, security, search path and every other original source byte', () => {
    for (const fragment of ["current_user<>'postgres' or session_user<>'postgres'",
      "where singleton and environment='TESTNET'", "before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text",
      "before_row->'prosecdef' is distinct from 'true'::jsonb", "before_row->'proconfig' is distinct from '[\"search_path=\\\"\\\"\"]'::jsonb",
      "permission.grantee not in ('postgres'::regrole::oid,'bx1_document_receipt_writer'::regrole::oid)",
      "after_row-'prosrc' is distinct from before_row-'prosrc'", "after_row->>'prosrc' is distinct from next_body",
      'pg_catalog.pg_get_functiondef(target)', 'execute replace(definition,original,next_body)',
    ]) expect(sql).toContain(fragment)
    expect(sql).not.toContain('fund_roleplay_enter(')
    expect(sql).not.toContain('fund_roleplay_command_lanes')
    expect(sql.match(/for spec in select value from pg_catalog\.jsonb_array_elements\(specifications\) loop/g)).toHaveLength(2)
  })
  it('reuses real current TEST product authority and leaves intake/final checks in the original bodies', () => {
    for (const fragment of ['test_roleplay_protected_session()', "p.created_by=auth.uid()", 'p.current_offering_revision_id=policy.offering_revision_id',
      'p.terms_hash=policy.terms_hash', "policy.project_ref='fegnnnlseuejkrusbbkv'", 'fund_roleplay_record_current(', 'test_roleplay_current(']) expect(manager).toContain(fragment)
    for (const fragment of ['offering_document_attestation_required', 'offering_document_intake_denied',
      'perform bx1_portal.offering_workflow_lock_product(operating_context,target_product)',
      'perform bx1_private.lock_offering_document_revision(target_revision)', 'offering_document_authority_changed']) expect(canonical).toContain(fragment)
    expect(newCase).toContain('offering_document_manager(operating_context,target_revision)')
    expect(newCase).toContain('fund_roleplay_manager_current(operating_context,v_product.id)')
  })
})
