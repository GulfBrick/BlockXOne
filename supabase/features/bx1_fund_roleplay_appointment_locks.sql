-- TEST-only correction of two person-lock calls in one canonical appointment
-- command. The existing policy lane and the same actual operator are required.
-- No identity mapping, grant, role, appointment or approval is created here.

do $fund_roleplay_appointment_locks$
declare target oid; authority oid; before_row jsonb; after_row jsonb; helper_row jsonb;
  original text; normalized text; next_body text; restored text; definition text; cut jsonb;
  cuts constant jsonb:=$cuts$[
    {"from":"    perform bx1_portal.offering_workflow_lock_people(array[actor,(body->>'appointee_user_id')::uuid]);",
     "to":"    if bx1_private.fund_roleplay_lane_current(c,p.id,action) is true\n      and not exists(select 1 from pg_catalog.unnest(array[actor,(body->>'appointee_user_id')::uuid]) locked(user_id)\n        where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then\n      perform bx1_portal.admission_lock_people(array[actor,(body->>'appointee_user_id')::uuid]);\n    else\n      perform bx1_portal.offering_workflow_lock_people(array[actor,(body->>'appointee_user_id')::uuid]);\n    end if;"},
    {"from":"    perform bx1_portal.offering_workflow_lock_people(array[actor,a.requested_by_user_id,\n      a.appointee_user_id,a.reviewed_by_user_id]);",
     "to":"    if bx1_private.fund_roleplay_lane_current(c,p.id,action) is true\n      and not exists(select 1 from pg_catalog.unnest(array[actor,a.requested_by_user_id,\n        a.appointee_user_id,a.reviewed_by_user_id]) locked(user_id)\n        where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then\n      perform bx1_portal.admission_lock_people(array[actor,a.requested_by_user_id,\n        a.appointee_user_id,a.reviewed_by_user_id]);\n    else\n      perform bx1_portal.offering_workflow_lock_people(array[actor,a.requested_by_user_id,\n        a.appointee_user_id,a.reviewed_by_user_id]);\n    end if;"}
  ]$cuts$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)') is null
    or pg_catalog.to_regprocedure('bx1_portal.admission_lock_people(uuid[])') is null then
    raise exception 'fund_roleplay_appointment_locks_test_owner_required' using errcode='42501';end if;
  authority:=pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)');
  select pg_catalog.to_jsonb(p),p.prosrc into helper_row,original from pg_catalog.pg_proc p where p.oid=authority;
  if authority is null or helper_row->>'proowner' is distinct from 'bx1_authority_owner'::regrole::oid::text
    or helper_row->'prosecdef' is distinct from 'true'::jsonb
    or helper_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc' then
    raise exception 'fund_roleplay_appointment_authority_lock_changed' using errcode='55000';end if;

  target:=pg_catalog.to_regprocedure('bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->>'proacl' is distinct from '["postgres=X/postgres"]'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from '1aef18f802784b11478bdbbd0682707256517dafb1c8923e10cb4723725efada' then
    raise exception 'fund_roleplay_appointment_locks_native_pin_mismatch' using errcode='55000';end if;

  next_body:=original;
  for cut in select value from pg_catalog.jsonb_array_elements(cuts) loop
    if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
      raise exception 'fund_roleplay_appointment_locks_cut_not_unique' using errcode='55000';end if;
    next_body:=replace(next_body,cut->>'from',cut->>'to');
  end loop;
  restored:=next_body;
  for cut in select value from pg_catalog.jsonb_array_elements(cuts) loop
    if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
      raise exception 'fund_roleplay_appointment_locks_result_not_unique' using errcode='55000';end if;
    restored:=replace(restored,cut->>'to',cut->>'from');
  end loop;
  if restored is distinct from original then
    raise exception 'fund_roleplay_appointment_locks_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_roleplay_appointment_locks_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body
    or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=authority) is distinct from helper_row then
    raise exception 'fund_roleplay_appointment_locks_metadata_or_helper_changed' using errcode='55000';end if;
end $fund_roleplay_appointment_locks$;
