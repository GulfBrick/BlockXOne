-- A command receipt is not a dashboard snapshot. The existing canonical
-- appointment writer keeps every guard, write, audit, finish and replay check;
-- only its two return projections can use this closed TEST acknowledgement.
-- Dashboard refresh belongs to a separate request after the write commits.
-- Install atomically as the TEST owner; no business record is created here.

do $fund_roleplay_appointment_commit$
declare target oid; helper oid; dependency jsonb; permission record;
  before_row jsonb; after_row jsonb; helper_row jsonb; dependencies_before jsonb:='{}'::jsonb;
  original text; normalized text; next_body text; definition text;
  old_fragment constant text:='return bx1_portal.read_scoped(c);';
  new_fragment constant text:='return coalesce(bx1_private.fund_roleplay_appointment_commit(c,action,key,body),bx1_portal.read_scoped(c));';
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.test_roleplay_protected_session()","sha":"0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14"},
    {"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"},
    {"signature":"bx1_portal.test_offering_source_current(uuid,uuid,integer)","sha":"f15952b5ac59bd44826e2635e9197404eba372f4d0c9265bb09a4e05f391cd15"},
    {"signature":"bx1_portal.test_offering_appointment_current(uuid)","sha":"e7221450da59b02021ee9f3b257ddc8455728242968273ef43c2e6db34359ad6"},
    {"signature":"bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)","sha":"3168472a61298bb600ccc544cecbd18c490fa4154fa45044bf7ef32ff2056302"}
  ]$dependencies$::jsonb;
  helper_definition constant text:=$helper$
create function bx1_private.fund_roleplay_appointment_commit(p_context jsonb,p_action text,p_key uuid,p_body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $function$
declare request_row bx1_portal.product_service_appointment_requests;
  appointment bx1_portal.product_service_appointments;
  receipt bx1_portal.product_service_appointment_receipts;
  product bx1_portal.products; offering bx1_portal.offering_revisions;
  policy bx1_private.roleplay_policies; source_lane bx1_private.test_workspace_product_commands;
  command_receipt bx1_private.fund_roleplay_command_receipts;
begin
  -- Ordinary and MAIN callers retain the original canonical read projection.
  if bx1_private.test_roleplay_environment() is not true
    or p_action is null or p_action not in ('request_product_service_appointment','review_product_service_appointment',
      'apply_product_service_appointment','revoke_product_service_appointment')
    or p_key is null or p_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(p_body) is distinct from 'object' or pg_catalog.octet_length(p_body::text)>8192 then return null;end if;
  select saved.* into request_row from bx1_portal.product_service_appointment_requests saved
    where saved.actor_id=auth.uid() and saved.request_key=p_key;
  if request_row.actor_id is null then return null;end if;
  select saved.* into appointment from bx1_portal.product_service_appointments saved where saved.id=request_row.appointment_id;
  if appointment.id is null or appointment.roleplay_policy_id is null then return null;end if;
  -- A tagged appointment can also receive an ordinary guarded staff command.
  -- Without this actor/key/action's real fund receipt, keep its old projection.
  select saved.* into command_receipt from bx1_private.fund_roleplay_command_receipts saved
    where saved.actual_actor_id=auth.uid() and saved.request_key=p_key
      and saved.action=p_action;
  if command_receipt.id is null then return null;end if;

  -- These are saved immutable provenance references, never a lookup of a new
  -- policy to relabel an old appointment/receipt. A changed policy fails closed.
  select saved.* into receipt from bx1_portal.product_service_appointment_receipts saved where saved.id=request_row.receipt_id;
  select saved.* into product from bx1_portal.products saved where saved.id=appointment.product_id;
  select saved.* into offering from bx1_portal.offering_revisions saved where saved.id=product.current_offering_revision_id;
  select saved.* into policy from bx1_private.roleplay_policies saved where saved.id=appointment.roleplay_policy_id;
  select entered.* into source_lane from bx1_private.test_workspace_product_commands entered
    where entered.transaction_id=pg_catalog.pg_current_xact_id() and entered.actor_id=auth.uid();
  if p_context->>'mode' is distinct from 'ROLE' or request_row.command is distinct from p_action
    or request_row.operating_context is distinct from p_context or request_row.payload is distinct from p_body
    or receipt.id is null or receipt.appointment_id is distinct from appointment.id
    or receipt.actor_id is distinct from auth.uid() or receipt.action is distinct from p_action
    or receipt.operating_context is distinct from p_context or receipt.command_payload is distinct from p_body
    or receipt.roleplay_context is distinct from p_context or receipt.appointment_revision is null
    or receipt.appointment_revision<1 or appointment.revision<receipt.appointment_revision
    or policy.id is null or appointment.roleplay_epoch is distinct from policy.authority_epoch
    or receipt.roleplay_policy_id is distinct from policy.id or receipt.roleplay_epoch is distinct from policy.authority_epoch
    or product.id is null or product.organisation_id is distinct from appointment.product_organisation_id
    or product.id is distinct from policy.product_id or product.current_offering_revision_id is distinct from policy.offering_revision_id
    or offering.id is null or offering.product_id is distinct from product.id or offering.origin is distinct from 'SUBMITTED'
    or offering.terms_hash is distinct from product.terms_hash or offering.terms is distinct from product.terms
    or product.terms_hash is distinct from policy.terms_hash or appointment.terms_hash_at_request is distinct from product.terms_hash
    or appointment.product_revision_at_request>product.revision
    or policy.environment is distinct from 'TESTNET' or policy.project_ref is distinct from 'fegnnnlseuejkrusbbkv'
    or policy.status is distinct from 'ACTIVE' or policy.independence_proven is distinct from false
    or source_lane.actor_id is null or source_lane.session_id::text is distinct from auth.jwt()->>'session_id'
    or source_lane.operating_context is distinct from p_context or source_lane.command is distinct from p_action
    or source_lane.request_key is distinct from p_key or source_lane.target_product_id is distinct from product.id
    or source_lane.product_organisation_id is distinct from product.organisation_id
    or source_lane.entitlement_id is distinct from appointment.test_workspace_entitlement_id
    or source_lane.entitlement_revision is distinct from appointment.test_workspace_entitlement_revision
    or command_receipt.id is null or command_receipt.policy_id is distinct from policy.id
    or command_receipt.authority_epoch is distinct from policy.authority_epoch
    or command_receipt.product_id is distinct from product.id or command_receipt.offering_revision_id is distinct from offering.id
    or command_receipt.actual_person_id is distinct from policy.actual_operator_person_id
    or command_receipt.operating_context is distinct from p_context or command_receipt.assurance is distinct from 'TEST_ROLE_PLAY'
    or command_receipt.independence_proven is distinct from false then
    raise exception 'fund_roleplay_appointment_commit_binding_changed' using errcode='42501';end if;

  -- Returning the old command receipt with the CURRENT appointment revision
  -- confirms the original command, not that a later review never happened.
  -- The fund command lane has already been finished on a new command; its
  -- immutable receipt above is required instead of manufacturing another lane.
  if bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_record_current(policy.id,policy.authority_epoch,product.id,offering.id,auth.uid(),p_context,p_action) is not true
    or (case when appointment.requested_by_user_id=auth.uid() and appointment.roleplay_context=p_context
        and p_action='request_product_service_appointment' then false
      else bx1_private.fund_roleplay_record_current(appointment.roleplay_policy_id,appointment.roleplay_epoch,
        product.id,offering.id,appointment.requested_by_user_id,appointment.roleplay_context,'request_product_service_appointment') is not true end)
    -- This pinned source predicate checks the exact same entitlement/revision
    -- matched to source_lane above; no second identical source read is needed.
    or bx1_portal.test_offering_appointment_current(appointment.id) is not true then
    raise exception 'fund_roleplay_appointment_commit_authority_changed' using errcode='42501';end if;
  return pg_catalog.jsonb_build_object('kind','TEST_FUND_APPOINTMENT_COMMIT','version',1,
    'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',auth.uid(),'session_id',(auth.jwt()->>'session_id')::uuid,'operating_context',p_context,
    'policy_id',policy.id,'authority_epoch',policy.authority_epoch,'product_id',product.id,'offering_revision_id',offering.id,
    'appointment_id',appointment.id,'appointment_revision',appointment.revision,
    'request',pg_catalog.jsonb_build_object('command',request_row.command,'key',request_row.request_key,'payload',request_row.payload),
    'recorded_at',receipt.recorded_at);
end $function$;
$helper$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_appointment_commit(jsonb,text,uuid,jsonb)') is not null then
    raise exception 'fund_roleplay_appointment_commit_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_appointment_commit_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    dependencies_before:=dependencies_before||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;

  target:=pg_catalog.to_regprocedure('bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
  if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_row->'prosecdef' is distinct from 'true'::jsonb
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->'proargnames' is distinct from '["c","action","key","body"]'::jsonb
    or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
    or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
      is distinct from 'fefc59c05659dace30de8a3743d7507c437869693eb9b069dfe52c98ad5749b2' then
    raise exception 'fund_roleplay_appointment_commit_native_pin_mismatch' using errcode='55000';end if;
  if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>2
    or pg_catalog.strpos(original,new_fragment)<>0 then
    raise exception 'fund_roleplay_appointment_commit_cut_not_exactly_two' using errcode='55000';end if;
  next_body:=replace(original,old_fragment,new_fragment);
  if (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>2
    or replace(next_body,new_fragment,old_fragment) is distinct from original then
    raise exception 'fund_roleplay_appointment_commit_outside_cut_changed' using errcode='55000';end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
    raise exception 'fund_roleplay_appointment_commit_definition_not_unique' using errcode='55000';end if;

  execute helper_definition;
  helper:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_appointment_commit(jsonb,text,uuid,jsonb)');
  -- Close every inherited/default non-owner function ACL, including PUBLIC.
  for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=helper and a.grantee<>p.proowner loop
    if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',helper::regprocedure);
    else execute pg_catalog.format('revoke all on function %s from %I',helper::regprocedure,permission.rolname);end if;
  end loop;
  select pg_catalog.to_jsonb(p) into helper_row from pg_catalog.pg_proc p where p.oid=helper;
  if helper is null or helper_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or helper_row->'prosecdef' is distinct from 'true'::jsonb
    or helper_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or helper_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb then
    raise exception 'fund_roleplay_appointment_commit_helper_acl_changed' using errcode='55000';end if;
  execute replace(definition,original,next_body);
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_roleplay_appointment_commit_metadata_changed' using errcode='55000';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from dependencies_before->(dependency->>'signature') then
      raise exception 'fund_roleplay_appointment_commit_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_appointment_commit$;
