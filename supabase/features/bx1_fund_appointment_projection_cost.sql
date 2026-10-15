-- One-invocation appointment projection cost correction. All original current
-- authority predicates and the callers' separate final revalidation remain.
-- Apply atomically to the existing TEST project; no records/grants are changed.

do $projection_cost$
declare target oid; dependency oid; original text; next_body text; restored text; definition text;
  before_row jsonb; after_row jsonb; dependency_before jsonb; cut jsonb;
  cuts constant jsonb:=$cuts$[
    {"from":"is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean;","to":"is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean; is_effective boolean;","count":1},
    {"from":"'effective',bx1_portal.offering_workflow_product_appointment_effective(a.id)","to":"'effective',is_effective","count":1},
    {"from":"when a.status='APPLIED' and bx1_portal.offering_workflow_product_appointment_effective(a.id) is not true","to":"when a.status='APPLIED' and is_effective is not true","count":1},
    {"from":"  return pg_catalog.jsonb_build_object(","to":"  is_effective:=bx1_portal.offering_workflow_product_appointment_effective(a.id);\n  return pg_catalog.jsonb_build_object(","count":1},
    {"from":"'can_review',is_reviewer and","to":"'can_review',case when is_reviewer is false or a.status<>'SUBMITTED' then false else is_reviewer and","count":1},
    {"from":",\n    'can_apply',is_admin and","to":" end,\n    'can_apply',case when is_admin is false or a.status<>'APPROVED' then false else is_admin and","count":1},
    {"from":",\n    'can_revoke',not bx1_portal.admission_password_session()","to":" end,\n    'can_revoke',case when is_admin is false or a.status<>'APPLIED' then false else not bx1_portal.admission_password_session()","count":1},
    {"from":"end)));\nend","to":"end)) end);\nend","count":1}
  ]$cuts$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_appointment_projection_cost_test_owner_required' using errcode='42501';end if;

  -- Keep the current table contract explicit, including timestamp nullability.
  if not exists(select 1 from pg_catalog.pg_attribute where attrelid='bx1_portal.product_service_appointments'::regclass
      and attname='status' and attnum>0 and not attisdropped and attnotnull and atttypid='text'::regtype)
    or not exists(select 1 from pg_catalog.pg_attribute where attrelid='bx1_portal.product_service_appointments'::regclass
      and attname='requested_until' and attnum>0 and not attisdropped and attnotnull and atttypid='timestamptz'::regtype) then
    raise exception 'fund_appointment_projection_cost_schema_changed' using errcode='55000';end if;

  dependency:=to_regprocedure('bx1_portal.offering_workflow_product_appointment_effective(uuid)');
  select to_jsonb(p) into dependency_before from pg_catalog.pg_proc p where p.oid=dependency;
  if dependency is distinct from 29596::oid
    or dependency_before->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or dependency_before->'prosecdef' is distinct from 'true'::jsonb
    or dependency_before->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or dependency_before->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or encode(sha256(convert_to(btrim(replace(dependency_before->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'fda841224e159fdcb5bb86e656d127e334b3caf263bf4f50f502583117a295ba' then
    raise exception 'fund_appointment_projection_cost_effective_dependency_changed' using errcode='55000';end if;

  target:=to_regprocedure('bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)');
  select to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 29609::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->'proargnames' is distinct from '["c","target_id"]'::jsonb
    or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
    or pg_get_function_result(target) is distinct from 'jsonb'
    or encode(sha256(convert_to(btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '8181a55d422897b1a57c265594ba0faae3dc29a708a020503db1b68f9997063f' then
    raise exception 'fund_appointment_projection_cost_native_pin_changed' using errcode='55000';end if;

  next_body:=original;
  for cut in select value from jsonb_array_elements(cuts) loop
    if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>(cut->>'count')::integer then
      raise exception 'fund_appointment_projection_cost_cut_not_exact' using errcode='55000';end if;
    next_body:=replace(next_body,cut->>'from',cut->>'to');
  end loop;
  restored:=next_body;
  for cut in select value from jsonb_array_elements(cuts) with ordinality item(value,n) order by n desc loop
    if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>(cut->>'count')::integer then
      raise exception 'fund_appointment_projection_cost_reverse_cut_not_exact' using errcode='55000';end if;
    restored:=replace(restored,cut->>'to',cut->>'from');
  end loop;
  if restored is distinct from original then
    raise exception 'fund_appointment_projection_cost_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_appointment_projection_cost_definition_not_unique' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_appointment_projection_cost_native_metadata_changed' using errcode='55000';end if;
  if (select to_jsonb(p) from pg_catalog.pg_proc p where p.oid=dependency) is distinct from dependency_before then
    raise exception 'fund_appointment_projection_cost_dependency_modified' using errcode='55000';end if;
end $projection_cost$;
