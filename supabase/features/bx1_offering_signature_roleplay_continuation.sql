-- TEST only: expose the existing same-envelope reconciliation/recovery commands
-- to the three already-authorised package capacities. This does not admit a
-- provider, sign a document, alter TRUSTED/MFA helpers, or change saved policies.
-- Install after bx1_fund_roleplay_manager_bridge.sql, before any later action-map extension.
-- Existing immutable capacity rows do NOT acquire these actions. The owner must
-- issue a new reviewed policy version through fund_roleplay_provision_operator.

do $signature_roleplay_continuation$
declare target oid;before_metadata jsonb;after_metadata jsonb;source_body text;next_body text;definition text;
  old_tail text;new_tail text;index_no integer;
  old_tails constant text[]:=array[
    '''request_product_service_appointment'',''REQUEST_PURPOSE'']',
    '''PREPARE_EXECUTION'',''REQUEST_SIGNING_VIEW'']',
    '''REVIEW_PURPOSE'',''REVOKE_PURPOSE'']'];
  new_tails constant text[]:=array[
    '''request_product_service_appointment'',''REQUEST_PURPOSE'',''REQUEST_RECONCILIATION'',''REQUEST_RECOVERY'']',
    '''PREPARE_EXECUTION'',''REQUEST_SIGNING_VIEW'',''REQUEST_RECONCILIATION'',''REQUEST_RECOVERY'']',
    '''REVIEW_PURPOSE'',''REVOKE_PURPOSE'',''REQUEST_RECONCILIATION'',''REQUEST_RECOVERY'']'];
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'signature_roleplay_continuation_test_owner_required' using errcode='42501';end if;
  target:=pg_catalog.to_regprocedure('bx1_private.test_roleplay_role_actions(text)');
  if target is null then raise exception 'signature_roleplay_continuation_missing_map' using errcode='55000';end if;
  select pg_catalog.to_jsonb(p)-'prosrc',p.prosrc into before_metadata,source_body from pg_catalog.pg_proc p where p.oid=target;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(source_body,E'\r\n',E'\n'),'UTF8')),'hex')
      is distinct from '2de3ad03e89f4d96dccf0a50058fc238348999aa710dd40daa7f1e8e8d692e72'
    or (before_metadata->>'proowner')::oid is distinct from 'postgres'::regrole::oid
    or (before_metadata->>'prosecdef')::boolean is not false
    or before_metadata->>'provolatile' is distinct from 'i'
    or (select proacl::text from pg_catalog.pg_proc where oid=target) is distinct from '{postgres=X/postgres}'
    or (select proconfig from pg_catalog.pg_proc where oid=target) is distinct from array['search_path=""'] then
    raise exception 'signature_roleplay_continuation_exact_map_pin_mismatch' using errcode='55000';end if;
  next_body:=source_body;
  for index_no in 1..3 loop
    old_tail:=old_tails[index_no];new_tail:=new_tails[index_no];
    if (length(next_body)-length(replace(next_body,old_tail,'')))/length(old_tail)<>1 then
      raise exception 'signature_roleplay_continuation_tail_not_unique' using errcode='55000';end if;
    next_body:=replace(next_body,old_tail,new_tail);
  end loop;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(next_body,E'\r\n',E'\n'),'UTF8')),'hex')
      is distinct from 'd8007ad89d4eae76b9cb050089989b8b29af7065544f79c7e4b99846dc92459a' then
    raise exception 'signature_roleplay_continuation_result_pin_mismatch' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,source_body,'')))/length(source_body)<>1 then
    raise exception 'signature_roleplay_continuation_body_not_unique' using errcode='55000';end if;
  execute replace(definition,source_body,next_body);
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
  if before_metadata is distinct from after_metadata
    or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
    raise exception 'signature_roleplay_continuation_metadata_or_body_changed' using errcode='55000';end if;
end $signature_roleplay_continuation$;
