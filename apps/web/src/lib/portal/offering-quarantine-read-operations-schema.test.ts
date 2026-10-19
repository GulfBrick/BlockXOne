import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exact source contracts, not a fabricated session or hosted Storage read proof.
const sql = readFileSync(resolve(process.cwd(), '../../supabase/features/bx1_offering_quarantine_read_operations.sql'), 'utf8').replace(/\r\n/g, '\n')
const pins = JSON.parse(sql.match(/\$pins\$([\s\S]*?)\$pins\$::jsonb/)![1]) as {
  name: string; sha256: string; role: string; permissive: boolean;
}[]
const oldOperation = sql.match(/old_operation constant text:=\$old\$([\s\S]*?)\$old\$/)![1]
const newOperation = sql.match(/new_operation constant text:=\$new\$([\s\S]*?)\$new\$/)![1]
const originals = [
  "((bucket_id = 'bx1-offering-quarantine'::text) AND storage.allow_only_operation('object.get_authenticated'::text) AND bx1_portal.offering_file_owner_read_allowed(name, owner_id))",
  "((bucket_id <> 'bx1-offering-quarantine'::text) OR (storage.allow_only_operation('object.get_authenticated'::text) AND bx1_portal.offering_file_owner_read_allowed(name, owner_id)))",
]

describe('exact TEST offering-quarantine metadata and byte-read operation correction', () => {
  it('pins precisely the native permissive-owner and restrictive SELECT policies', () => {
    expect(pins).toEqual([
      { name: 'bx1_offering_file_owner_read', sha256: 'ed2f8d9c04b9f8fc76177080346ee3a3042800074a71e30ff2a72589c11f88c5', role: 'authenticated', permissive: true },
      { name: 'bx1_offering_file_read_restrict', sha256: '898f4042ae367089e25deaddcfcd5cec86794b92674d0c135ce23714c36b63ba', role: 'public', permissive: false },
    ])
    for (const [index, original] of originals.entries()) expect(createHash('sha256').update(original).digest('hex')).toBe(pins[index].sha256)
    expect(sql).toContain("current_user<>'postgres' or session_user<>'postgres'")
    expect(sql).toContain("where singleton and environment='TESTNET'")
    for (const signature of ['storage.allow_only_operation(text)', 'storage.allow_any_operation(text[])',
      'bx1_portal.offering_file_owner_read_allowed(text,text)']) expect(sql).toContain(`to_regprocedure('${signature}') is null`)
  })

  it('adds exactly the SDK metadata check while preserving download, bucket and owner/current-manager authority', () => {
    expect(oldOperation).toBe("storage.allow_only_operation('object.get_authenticated'::text)")
    expect(newOperation).toBe("storage.allow_any_operation(ARRAY['object.get_authenticated_info'::text, 'object.get_authenticated'::text])")
    for (const original of originals) {
      const next = original.replace(oldOperation, newOperation)
      expect(next.replace(newOperation, oldOperation)).toBe(original)
      expect(next).toContain("'bx1-offering-quarantine'::text")
      expect(next).toContain('bx1_portal.offering_file_owner_read_allowed(name, owner_id)')
      expect(next).not.toMatch(/object\.list|signed|public_url|service_role/)
    }
  })

  it('checks command, roles, permissiveness, WITH CHECK and every other policy field around both exact cuts', () => {
    expect(sql.match(/for spec in select value from pg_catalog\.jsonb_array_elements\(specifications\) loop/g)).toHaveLength(2)
    for (const fragment of ["before_row->>'polcmd' is distinct from 'r'", "before_row->'polpermissive' is distinct from spec->'permissive'",
      "before_row->'polwithcheck' is distinct from 'null'::jsonb", "before_row->'polroles' is distinct from (case",
      "after_row-'polqual' is distinct from before_row-'polqual'", 'after_expression is distinct from next_expression',
      'replace(after_expression,new_operation,old_operation) is distinct from original',
      'offering_quarantine_read_operations_native_pin_mismatch', 'offering_quarantine_read_operations_changed_before_cut',
      'offering_quarantine_read_operations_metadata_or_outside_cut_changed']) expect(sql).toContain(fragment)
    expect(sql).toContain("format('alter policy %I on storage.objects using (%s)',spec->>'name',next_expression)")
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:grant|revoke|create(?: or replace)? function|drop policy|alter role|alter table|insert into|update|delete from|set_config)\s/i)
  })
})
