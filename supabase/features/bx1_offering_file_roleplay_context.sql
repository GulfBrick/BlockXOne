-- Two exact TEST-only offering-file context corrections. The existing saved
-- product policy is read; no command lane, role, provider result or file is made.
-- The existing twelve-argument writers retain their OIDs and complete metadata.
-- The owner applies this source in its guarded atomic TEST installation.

do $offering_file_roleplay_context$
declare spec jsonb; target oid; before_row jsonb; after_row jsonb;
  original text; normalized text; next_body text; definition text;
  old_case constant text:=$old$(case when exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision)
      then bx1_portal.offering_workflow_operator(operating_context,v_product.organisation_id)
      else bx1_portal.scoped_operator(operating_context,v_product.organisation_id) end)$old$;
  new_case constant text:=$new$(case when exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision)
      then (bx1_portal.offering_workflow_operator(operating_context,v_product.organisation_id)
        or (bx1_private.offering_document_manager(operating_context,target_revision)
          and bx1_private.fund_roleplay_manager_current(operating_context,v_product.id)))
      else bx1_portal.scoped_operator(operating_context,v_product.organisation_id) end)$new$;
  specifications constant jsonb:=$pins$[
    {"signature":"bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)","sha256":"602b5b6094d517b30d8a49936b76bd7e618728ea206fe98f456b44c9915765fa"},
    {"signature":"bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)","sha256":"2546b4672d54146c22dbd90e67aec8021e83ce45d82ba1e2159177b9b92131ea"}
  ]$pins$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_private.offering_document_manager(jsonb,uuid)') is null
    or pg_catalog.to_regrole('bx1_document_receipt_writer') is null then
    raise exception 'offering_file_roleplay_exact_test_owner_required' using errcode='42501';end if;

  -- Check both current definitions before replacing either one. Each is checked
  -- again in the replacement loop; any error aborts this entire DO statement.
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(pg_catalog.replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->>'provolatile' is distinct from 'v'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from spec->>'sha256'
      or exists(select 1 from pg_catalog.pg_proc p cross join lateral
        pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) permission
        where p.oid=target and (permission.grantee not in ('postgres'::regrole::oid,'bx1_document_receipt_writer'::regrole::oid)
          or permission.privilege_type<>'EXECUTE')) then
      raise exception 'offering_file_roleplay_native_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    if (length(original)-length(replace(original,old_case,'')))/length(old_case)<>1 then
      raise exception 'offering_file_roleplay_cut_not_unique: %',spec->>'signature' using errcode='55000';end if;
  end loop;

  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(pg_catalog.replace(original,E'\r\n',E'\n'),E' \n\t');
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from spec->>'sha256'
      or (length(original)-length(replace(original,old_case,'')))/length(old_case)<>1 then
      raise exception 'offering_file_roleplay_native_changed_before_cut: %',spec->>'signature' using errcode='55000';end if;
    next_body:=replace(original,old_case,new_case);
    if replace(next_body,new_case,old_case) is distinct from original
      or (length(next_body)-length(replace(next_body,new_case,'')))/length(new_case)<>1 then
      raise exception 'offering_file_roleplay_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'offering_file_roleplay_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'offering_file_roleplay_metadata_or_body_changed' using errcode='55000';end if;
  end loop;
end $offering_file_roleplay_context$;
