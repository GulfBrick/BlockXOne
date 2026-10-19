-- SIG-PROVIDER-COMPAT-20261015 revision 2: one existing TEST result CASE arm.
-- No business row is repaired here. Only a future authenticated, current,
-- same-envelope completion may retire its prior provider-integrity blocker.
-- All older observations, artifact receipts and other reasons remain intact.
-- Apply inside one owner transaction; the companion proof does not commit it.

do $signature_integrity_recovery$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_private.record_offering_signature_action(text,uuid,uuid,bigint,uuid,text,jsonb)');
  operation_guard oid:=pg_catalog.to_regprocedure('bx1_private.offering_signature_guard_operation()');
  before_function jsonb; after_function jsonb; before_guard jsonb;
  original text; restored text; next_body text; definition text;
  old_fragment constant text:=$old$noncurrent_reason=case when p_result->>'status'='COMPLETED' and p_result->'integrity_verified' is distinct from 'true'::jsonb
        then 'PROVIDER_INTEGRITY_UNPROVED' else noncurrent_reason end,$old$;
  new_fragment constant text:=$new$noncurrent_reason=case when noncurrent_reason is not null then
        case when p_action='RECONCILE_RESULT' and t.action='RECONCILE'
          and p_result->>'status'='COMPLETED' and p_result->'integrity_verified'='true'::jsonb
          and is_current is true and o.state='RECOVERY_REQUIRED' and o.environment='TESTNET'
          and o.noncurrent_reason='PROVIDER_INTEGRITY_UNPROVED'
          and o.envelope_id is not null and envelope=o.envelope_id
          and exists(select 1 from bx1_private.offering_signature_observations failed
            where failed.operation_id=o.id and failed.action in ('RECONCILE_RESULT','VOID_RESULT')
              and failed.result->>'status'='COMPLETED' and failed.result->'integrity_verified'='false'::jsonb)
          and (select count(*) from pg_catalog.jsonb_each(data))=6
          and not exists(select 1 from pg_catalog.jsonb_each(data) observed
            where observed.value->'observedAt' is null or pg_catalog.jsonb_typeof(observed.value->'observedAt') is distinct from 'number'
              or (observed.value->>'observedAt')::numeric<extract(epoch from t.created_at)*1000)
          then null else noncurrent_reason end
        when p_result->>'status'='COMPLETED' and p_result->'integrity_verified' is distinct from 'true'::jsonb
        then 'PROVIDER_INTEGRITY_UNPROVED' else noncurrent_reason end,$new$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or not exists(select 1 from bx1_private.offering_signature_policy where singleton and environment='TESTNET') then
    raise exception 'offering_signature_integrity_recovery_test_owner_required' using errcode='42501';end if;

  select pg_catalog.to_jsonb(p),p.prosrc into before_function,original from pg_catalog.pg_proc p where p.oid=target;
  select pg_catalog.to_jsonb(p) into before_guard from pg_catalog.pg_proc p where p.oid=operation_guard;
  if target is null or operation_guard is null
    or before_function->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_function->'prosecdef' is distinct from 'true'::jsonb
    or before_function->>'provolatile' is distinct from 'v'
    or before_function->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_function->'proacl' is distinct from '["postgres=X/postgres","bx1_offering_signature_worker=X/postgres"]'::jsonb
    or before_function->'proargnames' is distinct from '["p_worker","p_operation","p_lease","p_generation","p_request","p_action","p_result"]'::jsonb
    or before_function->>'prolang' is distinct from
      (select language.oid::text from pg_catalog.pg_language language where language.lanname='plpgsql')
    or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
    or before_guard->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_guard->'prosecdef' is distinct from 'true'::jsonb
    or before_guard->>'provolatile' is distinct from 'v'
    or before_guard->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_guard->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(before_guard->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '323ca08e297f9ce6dc66188ec89438ec729105562a58426170a45503d0fb2b09' then
    raise exception 'offering_signature_integrity_recovery_metadata_pin_mismatch' using errcode='55000';end if;

  -- A repeat is accepted only if reversing this exact one-cut repair recovers
  -- BOTH the original raw and normalized native source pins. Drift is not OK.
  if (length(original)-length(replace(original,new_fragment,'')))/length(new_fragment)=1 then
    restored:=replace(original,new_fragment,old_fragment);
    next_body:=original;
  elsif (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)=1
      and pg_catalog.strpos(original,new_fragment)=0 then
    restored:=original;
    next_body:=replace(original,old_fragment,new_fragment);
  else
    raise exception 'offering_signature_integrity_recovery_cut_not_unique' using errcode='55000';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(restored,E'\r\n',E'\n'),'UTF8')),'hex')
      is distinct from 'd31d2e4b27623a8dd6209d418f4eef4cb02d57e460d991e5efb98c4341995ccd'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '79e30a303f934764ac4e3280975a912bc32a7db379ecaf13484d35a5e06b9ad6'
    or replace(next_body,new_fragment,old_fragment) is distinct from restored
    or (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>1 then
    raise exception 'offering_signature_integrity_recovery_source_pin_mismatch' using errcode='55000';end if;

  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'offering_signature_integrity_recovery_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(p) into after_function from pg_catalog.pg_proc p where p.oid=target;
  if after_function-'prosrc' is distinct from before_function-'prosrc'
    or after_function->>'prosrc' is distinct from next_body
    or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=operation_guard) is distinct from before_guard then
    raise exception 'offering_signature_integrity_recovery_metadata_changed' using errcode='55000';end if;
end $signature_integrity_recovery$;
