-- The existing signature worker already accepts the scoped TEST person for
-- preparation and purpose review. Its VIEW read must use the same saved-person
-- binding, not manufacture a TRUSTED production identity. Ordinary purposes
-- retain the exact original TRUSTED helper through the NULL-policy branch.
-- No lease, session, appointment, signature, policy or business row is changed.

do $signature_roleplay_view$
declare target oid; dependency jsonb; before_row jsonb; after_row jsonb;
  snapshots jsonb:='{}'::jsonb; original text; normalized text; next_body text; definition text;
  old_fragment constant text:=$old$bx1_private.document_governance_trusted_person(o.originating_actor_id,a.signer_person_id)$old$;
  new_fragment constant text:=$new$bx1_private.fund_roleplay_document_person(a.roleplay_policy_id,a.roleplay_epoch,a.product_id,a.revision_id,
      o.originating_actor_id,a.signer_person_id,o.originating_context,'REQUEST_SIGNING_VIEW')$new$;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.fund_roleplay_document_person(uuid,integer,uuid,uuid,uuid,uuid,jsonb,text)","sha":"a128ca42a6afa2430a0f5945c81c480b56807a8b96cfce7bb1f2352a10356f34"},
    {"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"},
    {"signature":"bx1_private.fund_roleplay_record_bound(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"4fc403282efa28d9df3d88efbded6e037d99aa5b7d14a3a6f83b23a4dfa0ea7f"},
    {"signature":"bx1_private.test_roleplay_binding_current(uuid)","sha":"9186933a7c0a53c67dc4c35f2f86de79a967619eb4606664569fb41a55b886a2"},
    {"signature":"bx1_private.offering_signature_authorisation_current(uuid)","sha":"243ec1250a873df96173333b0a42718f63b5087efb1e0b24fbadeee99e560fe5"}
  ]$dependencies$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'signature_roleplay_view_test_owner_required' using errcode='42501';end if;
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
      raise exception 'signature_roleplay_view_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;
  target:=pg_catalog.to_regprocedure('bx1_private.read_offering_signature_action(text,uuid,uuid,bigint)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is distinct from 30729::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->'proacl' is distinct from '["postgres=X/postgres","bx1_offering_signature_worker=X/postgres"]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from 'eeec411558c60d88335d456eb6aa3e3e9b5a5e3bd1ab94d7a996dc437885bdaa' then
    raise exception 'signature_roleplay_view_native_pin_mismatch' using errcode='55000';end if;
  if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'signature_roleplay_view_cut_not_unique' using errcode='55000';end if;
  next_body:=replace(original,old_fragment,new_fragment);
  if (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>1
    or replace(next_body,new_fragment,old_fragment) is distinct from original then
    raise exception 'signature_roleplay_view_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'signature_roleplay_view_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'signature_roleplay_view_metadata_changed' using errcode='55000';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from snapshots->(dependency->>'signature') then
      raise exception 'signature_roleplay_view_dependency_mutated' using errcode='55000';end if;
  end loop;
end $signature_roleplay_view$;
