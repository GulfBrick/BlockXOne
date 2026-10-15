-- The fund read DTO describes current operating authority, not the original
-- preparation organisation. Keep manifest/mandate precedence and the exact
-- ordinary fallback, adding only a genuinely current bound TEST policy lookup.
-- No source stamp, manifest, policy, appointment or business record is changed.

do $fund_roleplay_projection_context$
declare target oid; dependency jsonb; before_row jsonb; after_row jsonb;
  snapshots jsonb:='{}'::jsonb; original text; normalized text; next_body text; definition text;
  old_fragment constant text:=$old$  native_org:=coalesce(m.native_organisation_id,
    (select native_organisation_id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id and applied_at is not null limit 1),
$old$;
  new_fragment constant text:=$new$  native_org:=coalesce(m.native_organisation_id,
    (select native_organisation_id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id and applied_at is not null limit 1),
    (select policy.native_organisation_id from bx1_private.roleplay_policies policy
      join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id
        and capacity.user_id=auth.uid() and capacity.role=c->>'role'
      where policy.product_id=p.id and policy.product_organisation_id=p.organisation_id
        and policy.offering_revision_id=p.current_offering_revision_id and policy.terms_hash=p.terms_hash
        and policy.environment='TESTNET' and policy.project_ref='fegnnnlseuejkrusbbkv'
        and policy.native_organisation_id::text=c->>'organisationId'
        and policy.version=(select max(later.version) from bx1_private.roleplay_policies later where later.product_id=policy.product_id)
        and bx1_private.test_roleplay_current(policy.id,p.id,p.current_offering_revision_id,
          auth.uid(),c,capacity.actions[1],null,policy.authority_epoch) is true
      order by policy.version desc limit 1),
$new$;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.test_roleplay_current(uuid,uuid,uuid,uuid,jsonb,text,text,integer)","sha":"7deac8847570793b144ede604df1b130077e4f735194c0da27e3a92d76244fdd"},
    {"signature":"bx1_private.test_roleplay_policy_current(uuid)","sha":"5d11d5b64e607116a0047af9020f549de37d58ba367012756d516a0e6d6e3c9d"},
    {"signature":"bx1_private.test_roleplay_binding_current(uuid)","sha":"9186933a7c0a53c67dc4c35f2f86de79a967619eb4606664569fb41a55b886a2"},
    {"signature":"bx1_private.test_roleplay_protected_session()","sha":"0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14"}
  ]$dependencies$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_projection_context_test_owner_required' using errcode='42501';end if;
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
      raise exception 'fund_roleplay_projection_context_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;

  target:=pg_catalog.to_regprocedure('bx1_portal.fund_product_projection(jsonb,uuid)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is distinct from 31531::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->'proargnames' is distinct from '["c","pid"]'::jsonb
    or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
    or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from '5ea5687a23f2fa4f904dcca6634607268d1eec11c32ff8956f68681accfcb43b' then
    raise exception 'fund_roleplay_projection_context_native_pin_mismatch' using errcode='55000';end if;
  if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1 then
    raise exception 'fund_roleplay_projection_context_cut_not_unique' using errcode='55000';end if;
  next_body:=replace(original,old_fragment,new_fragment);
  if (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>1
    or replace(next_body,new_fragment,old_fragment) is distinct from original then
    raise exception 'fund_roleplay_projection_context_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_roleplay_projection_context_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_roleplay_projection_context_metadata_changed' using errcode='55000';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from snapshots->(dependency->>'signature') then
      raise exception 'fund_roleplay_projection_context_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_projection_context$;
