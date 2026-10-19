-- Resolve the reproduced PL/pgSQL action-parameter collision in the existing
-- TEST role-play receipt writer. This changes only its conflict-target syntax;
-- the same native unique constraint, DO NOTHING and all authority/audit checks
-- remain in force. Apply inside one owner transaction after the command feature.

do $fund_roleplay_receipt_conflict$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)');
  receipt_table oid:=pg_catalog.to_regclass('bx1_private.fund_roleplay_command_receipts');
  constraint_oid oid; index_oid oid; unique_columns text[];
  before_function jsonb; after_function jsonb; before_constraint jsonb; before_index jsonb;
  original text; normalized text; next_body text; definition text;
  old_fragment constant text:='on conflict(actual_actor_id,request_key,action) do nothing;';
  new_fragment constant text:='on conflict on constraint fund_roleplay_command_receipt_actual_actor_id_request_key_a_key do nothing;';
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_receipt_conflict_test_owner_required' using errcode='42501';end if;

  -- Pin the exact original function and its closed metadata before any DDL.
  select pg_catalog.to_jsonb(p),p.prosrc into before_function,original
    from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is null or receipt_table is null
    or before_function->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_function->'prosecdef' is distinct from 'true'::jsonb
    or before_function->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_function->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_function->>'provolatile' is distinct from 'v'
    or before_function->'proargnames' is distinct from '["c","product","action","key"]'::jsonb
    or before_function->>'prolang' is distinct from
      (select language.oid::text from pg_catalog.pg_language language where language.lanname='plpgsql')
    or pg_catalog.pg_get_function_result(target) is distinct from 'void'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from '847bac5262d0a6ce58b2abd736fceddeec694b7888cd7d8da8165b6f854c5544' then
    raise exception 'fund_roleplay_receipt_conflict_native_pin_mismatch' using errcode='55000';end if;

  -- Naming the constraint is safe only while it is exactly the existing
  -- immediate, validated three-column receipt arbiter, not a broader conflict.
  select k.oid,k.conindid,pg_catalog.to_jsonb(k),
      (select pg_catalog.array_agg(attribute.attname::text order by columns.ordinality)
        from pg_catalog.unnest(k.conkey) with ordinality columns(attnum,ordinality)
        join pg_catalog.pg_attribute attribute on attribute.attrelid=k.conrelid and attribute.attnum=columns.attnum)
    into constraint_oid,index_oid,before_constraint,unique_columns
    from pg_catalog.pg_constraint k
    where k.conrelid=receipt_table
      and k.conname='fund_roleplay_command_receipt_actual_actor_id_request_key_a_key';
  select pg_catalog.to_jsonb(i) into before_index from pg_catalog.pg_index i where i.indexrelid=index_oid;
  if constraint_oid is null or index_oid is null
    or unique_columns is distinct from array['actual_actor_id','request_key','action']::text[]
    or before_constraint->>'contype' is distinct from 'u'
    or before_constraint->'condeferrable' is distinct from 'false'::jsonb
    or before_constraint->'condeferred' is distinct from 'false'::jsonb
    or before_constraint->'convalidated' is distinct from 'true'::jsonb
    or before_constraint->'conislocal' is distinct from 'true'::jsonb
    or before_constraint->'coninhcount' is distinct from '0'::jsonb
    or pg_catalog.pg_get_constraintdef(constraint_oid) is distinct from 'UNIQUE (actual_actor_id, request_key, action)'
    or before_index->>'indrelid' is distinct from receipt_table::text
    or before_index->'indisunique' is distinct from 'true'::jsonb
    or before_index->'indisvalid' is distinct from 'true'::jsonb
    or before_index->'indisready' is distinct from 'true'::jsonb
    or before_index->'indislive' is distinct from 'true'::jsonb
    or before_index->'indimmediate' is distinct from 'true'::jsonb
    or before_index->'indnatts' is distinct from '3'::jsonb
    or before_index->'indnkeyatts' is distinct from '3'::jsonb
    or before_index->'indpred' is distinct from 'null'::jsonb
    or before_index->'indexprs' is distinct from 'null'::jsonb then
    raise exception 'fund_roleplay_receipt_conflict_arbiter_changed' using errcode='55000';end if;

  if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1
    or pg_catalog.strpos(original,new_fragment)<>0 then
    raise exception 'fund_roleplay_receipt_conflict_cut_not_unique' using errcode='55000';end if;
  next_body:=replace(original,old_fragment,new_fragment);
  if replace(next_body,new_fragment,old_fragment) is distinct from original then
    raise exception 'fund_roleplay_receipt_conflict_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_roleplay_receipt_conflict_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);

  select pg_catalog.to_jsonb(p) into after_function from pg_catalog.pg_proc p where p.oid=target;
  if after_function-'prosrc' is distinct from before_function-'prosrc'
    or after_function->>'prosrc' is distinct from next_body
    or (select pg_catalog.to_jsonb(k) from pg_catalog.pg_constraint k where k.oid=constraint_oid)
      is distinct from before_constraint
    or (select pg_catalog.to_jsonb(i) from pg_catalog.pg_index i where i.indexrelid=index_oid)
      is distinct from before_index then
    raise exception 'fund_roleplay_receipt_conflict_metadata_changed' using errcode='55000';end if;
end $fund_roleplay_receipt_conflict$;
