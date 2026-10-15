-- Retain an appointment's original preparation source while recognising its
-- explicitly stamped current TEST fund-policy requester context. This is a
-- source-current predicate, not viewer authority, approval or an effective
-- appointment. Existing review/apply/session/independence gates are unchanged.
-- Apply atomically as the existing TEST owner; no records or grants are added.

do $fund_roleplay_appointment_source$
declare target oid; dependency jsonb; before_row jsonb; after_row jsonb;
  snapshots jsonb:='{}'::jsonb; original text; normalized text; next_body text; definition text;
  old_fragment constant text:=$old$bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,
        (a.requested_in_context->>'organisationId')::uuid)$old$;
  new_fragment constant text:=$new$(bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,
        (a.requested_in_context->>'organisationId')::uuid)
        or (a.roleplay_policy_id is not null and a.roleplay_epoch>0
          and a.roleplay_context=a.requested_in_context
          and a.roleplay_context->>'mode'='ROLE' and a.roleplay_context->>'role'='OfferingManager'
          and exists(select 1 from bx1_portal.products product
            join bx1_portal.offering_revisions offering on offering.id=product.current_offering_revision_id
              and offering.product_id=product.id
            join bx1_private.test_workspace_sources source on source.id=o.test_workspace_source_id
              and source.id=a.test_workspace_source_id and source.product_organisation_id=o.id
              and source.user_id=a.requested_by_user_id and source.role='OfferingManager'
              and source.environment='TESTNET'
            join bx1_private.test_workspace_entitlements entitlement on entitlement.id=a.test_workspace_entitlement_id
              and entitlement.source_id=source.id and entitlement.revision=a.test_workspace_entitlement_revision
              and entitlement.user_id=a.requested_by_user_id and entitlement.role=source.role
              and entitlement.native_organisation_id=source.native_organisation_id
            where product.id=a.product_id and product.organisation_id=o.id
              and product.created_by=a.requested_by_user_id and o.owner_id=a.requested_by_user_id
              and product.terms_hash=a.terms_hash_at_request and offering.terms_hash=product.terms_hash
              and offering.terms=product.terms and offering.origin='SUBMITTED'
              and a.product_revision_at_request>0 and product.revision>=a.product_revision_at_request
              and bx1_portal.test_offering_appointment_current(a.id) is true
              and bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,source.native_organisation_id) is true
              and bx1_private.fund_roleplay_record_current(a.roleplay_policy_id,a.roleplay_epoch,
                product.id,offering.id,a.requested_by_user_id,a.roleplay_context,'request_product_service_appointment') is true)))$new$;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"},
    {"signature":"bx1_portal.offering_workflow_manager_current(uuid,uuid,uuid)","sha":"56c0bd72bf04a6a5caf8539c792b6f8958d8ff860e7fa3e7b9f70da87893d0bd"},
    {"signature":"bx1_portal.test_offering_appointment_current(uuid)","sha":"e7221450da59b02021ee9f3b257ddc8455728242968273ef43c2e6db34359ad6"},
    {"signature":"bx1_portal.test_offering_source_current(uuid,uuid,integer)","sha":"f15952b5ac59bd44826e2635e9197404eba372f4d0c9265bb09a4e05f391cd15"}
  ]$dependencies$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_appointment_source_test_owner_required' using errcode='42501';end if;

  -- Complete native dependency preflight precedes the only source cut.
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_appointment_source_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;

  target:=pg_catalog.to_regprocedure('bx1_portal.offering_workflow_appointment_source_current(uuid)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is distinct from 29604::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->'proargnames' is distinct from '["target_id"]'::jsonb
    or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='sql')
    or pg_catalog.pg_get_function_result(target) is distinct from 'boolean'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from '3df689ac7fe006e29062ca876b980e2389c63e11597cebbfe2abef6d745c90ff' then
    raise exception 'fund_roleplay_appointment_source_native_pin_mismatch' using errcode='55000';end if;
  if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'fund_roleplay_appointment_source_cut_not_unique' using errcode='55000';end if;
  next_body:=replace(original,old_fragment,new_fragment);
  if (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>1
    or replace(next_body,new_fragment,old_fragment) is distinct from original then
    raise exception 'fund_roleplay_appointment_source_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_roleplay_appointment_source_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_roleplay_appointment_source_metadata_changed' using errcode='55000';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from snapshots->(dependency->>'signature') then
      raise exception 'fund_roleplay_appointment_source_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_appointment_source$;
