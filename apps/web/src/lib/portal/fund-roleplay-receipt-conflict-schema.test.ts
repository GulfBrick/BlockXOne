import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-contract regression only. No session, receipt, appointment or hosted
// positive business outcome is created or proved by these assertions.
const directory = resolve(process.cwd(), '../../supabase/features')
const read = (file: string) => readFileSync(resolve(directory, file), 'utf8').replace(/\r\n/g, '\n')
const sql = read('bx1_fund_roleplay_receipt_conflict.sql')
const commands = read('bx1_fund_roleplay_commands.sql')
const functionBody = (name: string) => commands.match(new RegExp(`create function ${name.replace(/\./g, '\\.')}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))![1]
const original = functionBody('bx1_private.fund_roleplay_finish')
const oldFragment = sql.match(/old_fragment constant text:='([^']+)';/)![1]
const newFragment = sql.match(/new_fragment constant text:='([^']+)';/)![1]
const corrected = original.replace(oldFragment, newFragment)

describe('exact TEST role-play receipt conflict-target correction', () => {
  it('pins the reproduced original helper and replaces exactly one conflict clause', () => {
    const hash = createHash('sha256').update(original.trim(), 'utf8').digest('hex')
    expect(hash).toBe('847bac5262d0a6ce58b2abd736fceddeec694b7888cd7d8da8165b6f854c5544')
    expect(sql).toContain(`is distinct from '${hash}'`)
    expect(sql).toContain("to_regprocedure('bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)')")
    expect(oldFragment).toBe('on conflict(actual_actor_id,request_key,action) do nothing;')
    expect(newFragment).toBe('on conflict on constraint fund_roleplay_command_receipt_actual_actor_id_request_key_a_key do nothing;')
    expect(original.split(oldFragment)).toHaveLength(2)
    expect(corrected.split(newFragment)).toHaveLength(2)
    expect(corrected.replace(newFragment, oldFragment)).toBe(original)
    expect(corrected).not.toContain(oldFragment)
    expect(sql).toContain('replace(next_body,new_fragment,old_fragment) is distinct from original')
  })

  it('retains both actual current-lane checks, immutable receipt fields and lane cleanup', () => {
    expect(corrected.match(/fund_roleplay_lane_current\(c,product,action\) is not true/g)).toHaveLength(2)
    for (const fragment of [
      'lane.request_key<>key or lane.action<>action',
      'where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid()',
      'actual_actor_id,actual_person_id,operating_context,action,request_key,signing_address)',
      'values(lane.policy_id,lane.authority_epoch,product,lane.offering_revision_id,auth.uid(),person,c,action,key,lane.signing_address)',
      'delete from bx1_private.fund_roleplay_command_lanes',
    ]) expect(corrected).toContain(fragment)
    expect(corrected.match(/fund_roleplay_authority_changed_at_commit/g)).toHaveLength(2)
    expect(corrected).not.toMatch(/do update|variable_conflict|set_config|grant|revoke/i)
  })

  it('requires the same exact immediate three-column unique constraint and unchanged index', () => {
    for (const fragment of [
      "k.conrelid=receipt_table",
      "k.conname='fund_roleplay_command_receipt_actual_actor_id_request_key_a_key'",
      "unique_columns is distinct from array['actual_actor_id','request_key','action']::text[]",
      "before_constraint->>'contype' is distinct from 'u'",
      "before_constraint->'condeferrable' is distinct from 'false'::jsonb",
      "before_constraint->'condeferred' is distinct from 'false'::jsonb",
      "before_constraint->'convalidated' is distinct from 'true'::jsonb",
      "pg_catalog.pg_get_constraintdef(constraint_oid) is distinct from 'UNIQUE (actual_actor_id, request_key, action)'",
      "before_index->>'indrelid' is distinct from receipt_table::text",
      "before_index->'indisunique' is distinct from 'true'::jsonb",
      "before_index->'indisvalid' is distinct from 'true'::jsonb",
      "before_index->'indisready' is distinct from 'true'::jsonb",
      "before_index->'indimmediate' is distinct from 'true'::jsonb",
      "before_index->'indpred' is distinct from 'null'::jsonb",
      "before_index->'indexprs' is distinct from 'null'::jsonb",
      'is distinct from before_constraint', 'is distinct from before_index',
    ]) expect(sql).toContain(fragment)
    expect(sql.indexOf('fund_roleplay_receipt_conflict_arbiter_changed')).toBeLessThan(sql.indexOf('execute replace(definition,original,next_body)'))
  })

  it('is owner-only TEST installation preserving native OID and all other function metadata', () => {
    for (const fragment of [
      "current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null",
      "where singleton and environment='TESTNET'", 'test_roleplay_environment() is not true',
      "before_function->>'proowner' is distinct from 'postgres'::regrole::oid::text",
      "before_function->'prosecdef' is distinct from 'true'::jsonb",
      "before_function->'proconfig' is distinct from '[\"search_path=\\\"\\\"\"]'::jsonb",
      "before_function->'proacl' is distinct from '[\"postgres=X/postgres\"]'::jsonb",
      "before_function->'proargnames' is distinct from '[\"c\",\"product\",\"action\",\"key\"]'::jsonb",
      "pg_catalog.pg_get_function_result(target) is distinct from 'void'",
      "after_function-'prosrc' is distinct from before_function-'prosrc'",
      "after_function->>'prosrc' is distinct from next_body",
    ]) expect(sql).toContain(fragment)
    expect(sql.match(/execute replace\(definition,original,next_body\)/g)).toHaveLength(1)
    expect(sql).not.toMatch(/(?:create(?: or replace)? function|alter table|alter role|grant|revoke|set_config)\s/i)
    expect(sql).not.toContain('variable_conflict')
  })

  it('bounds the original command-feature scan to four conflict clauses, with only the finish helper colliding with a parameter', () => {
    const clauses = commands.match(/on conflict\s*\([^)]*\)\s*do\s+(?:nothing|update)/gi)
    expect(clauses).toEqual([
      'on conflict(actual_actor_id,request_key,action) do nothing',
      'on conflict(policy_id,wallet_slot,proof_id) do nothing',
      'on conflict(investment_account_id,product_id) do update',
      'on conflict(operation_id,transaction_hash) do nothing',
    ])
    // The other targets do not name their owning functions' parameters or local
    // variables. Leave them unchanged; there is no generic conflict-policy fix.
    const bind = functionBody('bx1_private.fund_roleplay_bind_signer')
    expect(commands).toContain('fund_roleplay_bind_signer(policy uuid,epoch integer,slot_name text,wallet uuid,c jsonb)')
    expect(bind).toContain('on conflict(policy_id,wallet_slot,proof_id) do nothing;')
    const specs = JSON.parse(commands.match(/\$roleplay_specs\$([\s\S]*?)\$roleplay_specs\$::jsonb/)![1]) as { signature: string; next_body: string }[]
    const fund = specs.find(spec => spec.signature === 'bx1_portal.fund_command(jsonb,text,uuid,jsonb)')!.next_body
    const declarations = fund.slice(0, fund.indexOf('begin'))
    for (const name of ['investment_account_id', 'product_id', 'operation_id', 'transaction_hash']) {
      expect(declarations).not.toMatch(new RegExp(`\\b${name}\\s+(?:uuid|text)\\b`))
    }
    expect(sql).not.toContain("to_regprocedure('bx1_portal.fund_command(")
    expect(sql).not.toContain("to_regprocedure('bx1_private.fund_roleplay_bind_signer(")
  })
})
