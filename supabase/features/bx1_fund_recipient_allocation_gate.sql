-- Install AFTER the exact commands, recipient operations and finance features.
-- A real READY identity registration is a precondition for role-play allocation
-- acceptance/issuance. Retained NULL-provenance allocation rules are unchanged.
-- No recipient, allocation, operation, money or ownership record is written.

do $recipient_allocation_gate$
declare target oid;helper oid;body text;definition text;before_metadata jsonb;after_metadata jsonb;original text;replacement text;
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_recipient_allocation_test_owner_required' using errcode='42501';end if;
  target:=pg_catalog.to_regprocedure('bx1_portal.fund_allocation_current(uuid)');
  helper:=pg_catalog.to_regprocedure('bx1_portal.fund_recipient_ready_for_allocation(uuid)');
  if target is null or helper is null or pg_catalog.to_regclass('bx1_portal.fund_recipient_cases') is null then
    raise exception 'fund_recipient_allocation_exact_dependencies_required' using errcode='55000';end if;
  select prosrc,pg_catalog.to_jsonb(p)-'prosrc' into body,before_metadata from pg_catalog.pg_proc p where p.oid=target;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(body,E'\r\n',E'\n'),'UTF8')),'hex')
    is distinct from 'a5b9e25b44b1bd28225d9b800898c441f6b3107b091b3df7e43cdb261b3b95b3'
    or (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      from pg_catalog.pg_proc where oid=helper) is distinct from '25e247d94561e70b585342439433359d93527adfe6a0fe55db2b9a7af5647386' then
    raise exception 'fund_recipient_allocation_exact_source_required' using errcode='55000';end if;
  original:='where a.id=target and';
  replacement:='where a.id=target and (a.roleplay_policy_id is null or bx1_portal.fund_recipient_ready_for_allocation(a.id)) and';
  if (pg_catalog.length(body)-pg_catalog.length(replace(body,original,'')))/pg_catalog.length(original)<>1 then
    raise exception 'fund_recipient_allocation_fragment_not_unique';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  execute replace(definition,body,replace(body,original,replacement));
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
  if before_metadata is distinct from after_metadata
    or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from replace(body,original,replacement) then
    raise exception 'fund_recipient_allocation_metadata_changed';end if;
end $recipient_allocation_gate$;
