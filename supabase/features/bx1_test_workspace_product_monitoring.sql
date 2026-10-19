-- Reproduced TEST evaluation CREATE correction. No application-monitoring bypass.
-- A private command lane binds the existing canonical command to its exact
-- actor/session/grant/tenant/request. It exists only within that transaction.
-- Install atomically after test_workspace_access; existing grants are unchanged.
do $$
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true
    or pg_catalog.to_regclass('bx1_private.test_workspace_entitlements') is null
    or pg_catalog.to_regclass('bx1_private.test_workspace_product_commands') is not null then
    raise exception 'test_workspace_product_monitoring_baseline_required' using errcode='55000'; end if;
end $$;
create table bx1_private.test_workspace_product_commands (
  transaction_id xid8 not null,
  actor_id uuid not null,
  session_id uuid not null,
  entitlement_id uuid not null references bx1_private.test_workspace_entitlements(id) on delete restrict,
  entitlement_revision integer not null,
  operating_context jsonb not null,
  product_organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  command text not null check (command in ('create_product','save_product','submit_product')),
  request_key uuid not null,
  target_product_id uuid,
  primary key(transaction_id,actor_id)
);
alter table bx1_private.test_workspace_product_commands enable row level security;
revoke all on bx1_private.test_workspace_product_commands from public,anon,authenticated,service_role;

create function bx1_portal.test_workspace_product_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare grant_id uuid; e bx1_private.test_workspace_entitlements; source bx1_private.test_workspace_sources;
  target_id uuid; requested_org uuid; result jsonb; access jsonb;
begin
  grant_id:=bx1_portal.test_workspace_entitlement(c);
  if grant_id is null or c->>'role' is distinct from 'OfferingManager' or action is null
    or action not in ('create_product','save_product','submit_product')
    or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'test_workspace_product_command_denied' using errcode='42501'; end if;
  perform bx1_portal.test_workspace_lock(c);
  select * into e from bx1_private.test_workspace_entitlements where id=grant_id;
  select * into source from bx1_private.test_workspace_sources where id=e.source_id;
  if action='create_product' then
    if coalesce(body->>'organisation_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'test_workspace_product_command_denied' using errcode='42501'; end if;
    requested_org:=(body->>'organisation_id')::uuid;
  else
    if coalesce(body->>'product_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'test_workspace_product_command_denied' using errcode='42501'; end if;
    target_id:=(body->>'product_id')::uuid;
    select organisation_id into requested_org from bx1_portal.products where id=target_id and created_by=auth.uid();
  end if;
  if requested_org is distinct from source.product_organisation_id or source.user_id is distinct from auth.uid()
    or source.native_organisation_id::text is distinct from c->>'organisationId' then
    raise exception 'test_workspace_product_tenant_denied' using errcode='42501'; end if;
  access:=bx1_portal.test_workspace_projection(c);
  insert into bx1_private.test_workspace_product_commands(transaction_id,actor_id,session_id,
    entitlement_id,entitlement_revision,operating_context,product_organisation_id,command,request_key,target_product_id)
    values(pg_catalog.pg_current_xact_id(),auth.uid(),(auth.jwt()->>'session_id')::uuid,
      e.id,e.revision,c,requested_org,action,key,target_id);
  -- This is the original offering dispatcher, not a second business writer.
  result:=bx1_portal.offering_workflow_command(c,action,key,body);
  if bx1_portal.test_workspace_projection(c) is distinct from access then
    raise exception 'test_workspace_product_command_authority_changed' using errcode='42501'; end if;
  delete from bx1_private.test_workspace_product_commands where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
  return result;
end $$;

create function bx1_portal.test_workspace_product_mutation(new_id uuid,new_org uuid,new_creator uuid,
  new_status text,new_revision integer,old_org uuid,old_creator uuid,old_status text,old_revision integer,operation text)
returns void language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.test_workspace_product_commands; grant_id uuid;
begin
  select * into lane from bx1_private.test_workspace_product_commands
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() for update;
  if lane.actor_id is null or lane.session_id::text is distinct from auth.jwt()->>'session_id'
    or lane.product_organisation_id is distinct from new_org or new_creator is distinct from auth.uid() then
    raise exception 'test_workspace_product_lane_required' using errcode='42501'; end if;
  perform bx1_portal.test_workspace_lock(lane.operating_context,new_org);
  grant_id:=bx1_portal.test_workspace_entitlement(lane.operating_context);
  if grant_id is distinct from lane.entitlement_id or not exists(select 1 from bx1_private.test_workspace_entitlements
    where id=grant_id and revision=lane.entitlement_revision) then
    raise exception 'test_workspace_product_lane_authority_changed' using errcode='42501'; end if;
  if operation='INSERT' then
    if lane.command<>'create_product' or new_status is distinct from 'DRAFT' or new_revision is distinct from 1
      or (lane.target_product_id is not null and lane.target_product_id is distinct from new_id) then
      raise exception 'test_workspace_product_insert_denied' using errcode='42501'; end if;
    update bx1_private.test_workspace_product_commands set target_product_id=new_id
      where transaction_id=lane.transaction_id and actor_id=lane.actor_id;
  elsif operation='UPDATE' then
    if lane.target_product_id is distinct from new_id or old_org is distinct from new_org
      or old_creator is distinct from new_creator then
      raise exception 'test_workspace_product_update_tenant_denied' using errcode='42501'; end if;
    if lane.command='save_product' then
      if old_status not in ('DRAFT','CHANGES_REQUIRED') or new_status is distinct from 'DRAFT'
        or new_revision is distinct from old_revision+1 then
        raise exception 'test_workspace_product_save_transition_denied' using errcode='42501'; end if;
    elsif lane.command='submit_product' then
      if not ((old_status in ('DRAFT','CHANGES_REQUIRED') and new_status='IN_REVIEW' and new_revision=old_revision+1)
        or (old_status='IN_REVIEW' and new_status='IN_REVIEW' and new_revision=old_revision)) then
        raise exception 'test_workspace_product_submit_transition_denied' using errcode='42501'; end if;
      -- The same-revision IN_REVIEW update is the retained writer binding its
      -- newly inserted immutable offering revision, not a separate approval.
    else raise exception 'test_workspace_product_update_command_denied' using errcode='42501'; end if;
  else raise exception 'test_workspace_product_mutation_denied' using errcode='42501'; end if;
  if bx1_portal.test_workspace_entitlement(lane.operating_context) is distinct from grant_id then
    raise exception 'test_workspace_product_mutation_authority_changed' using errcode='42501'; end if;
end $$;
revoke all on function bx1_portal.test_workspace_product_command(jsonb,text,uuid,jsonb),
  bx1_portal.test_workspace_product_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)
  from public,anon,authenticated,service_role;

-- In-place exact-body cutovers preserve OIDs, trigger identity and all original
-- security-invoker/security-definer/ACL/configuration attributes. No other table
-- branch or generic monitoring predicate changes.
do $test_workspace_product_monitoring_cutover$
declare spec jsonb; target oid; before_metadata jsonb; after_metadata jsonb; source_body text;
  definition text; changed_definition text; fn_name text; backup_name text;
  old_fragment text; new_fragment text; next_body text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements('[
    {"signature":"bx1_portal.guard_customer_monitoring_new_action()","sha":"27db4b64df3ff7b694677c53665bd9c138abae99d6742c2c7c3961996c3b4bd2","backup":"guard_customer_monitoring_new_action_pre_workspace_products","kind":"TRIGGER"},
    {"signature":"bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)","sha":"c0eb1cf633f0377229ecee518ef5cadd5729d2b10fe6ca115a874c6c97a2b64b","backup":"execute_scoped_pre_workspace_product_monitoring","kind":"COMMAND"}
  ]'::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'test_workspace_product_monitoring_function_missing' using errcode='55000'; end if;
    select p.prosrc,p.proname,pg_catalog.to_jsonb(p)-'prosrc' into source_body,fn_name,before_metadata
      from pg_catalog.pg_proc p where p.oid=target;
    if before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
        pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'test_workspace_product_monitoring_source_changed' using errcode='55000'; end if;
    backup_name:=spec->>'backup';
    if spec->>'kind'='TRIGGER' then
      if before_metadata->>'prosecdef' is distinct from 'false' then
        raise exception 'test_workspace_product_monitoring_invoker_changed' using errcode='55000'; end if;
      old_fragment:=$old$  elsif tg_table_name='products' then
$old$;
      new_fragment:=$new$  elsif tg_table_name='products' then
    if exists(select 1 from bx1_portal.organisations where id=new.organisation_id and test_workspace_source_id is not null) then
      if tg_op='INSERT' then
        perform bx1_portal.test_workspace_product_mutation(new.id,new.organisation_id,new.created_by,new.status,new.revision,null,null,null,null,tg_op);
      elsif tg_op='UPDATE' then
        perform bx1_portal.test_workspace_product_mutation(new.id,new.organisation_id,new.created_by,new.status,new.revision,old.organisation_id,old.created_by,old.status,old.revision,tg_op);
      else raise exception 'test_workspace_product_mutation_denied' using errcode='42501'; end if;
      return new;
    end if;
$new$;
      if pg_catalog.to_regprocedure('bx1_portal.'||backup_name||'()') is not null then
        raise exception 'test_workspace_product_monitoring_backup_exists' using errcode='55000'; end if;
    else
      if before_metadata->>'prosecdef' is distinct from 'true' then
        raise exception 'test_workspace_product_command_definer_changed' using errcode='55000'; end if;
      old_fragment:=$old$    perform bx1_portal.test_workspace_lock(c);
    return bx1_portal.offering_workflow_command(c,action,key,body);$old$;
      new_fragment:=$new$    return bx1_portal.test_workspace_product_command(c,action,key,body);$new$;
      if pg_catalog.to_regprocedure('bx1_portal.'||backup_name||'(jsonb,text,uuid,jsonb)') is not null then
        raise exception 'test_workspace_product_monitoring_backup_exists' using errcode='55000'; end if;
    end if;
    if (char_length(source_body)-char_length(pg_catalog.replace(source_body,old_fragment,'')))/char_length(old_fragment)<>1 then
      raise exception 'test_workspace_product_monitoring_cutpoint_changed' using errcode='55000'; end if;
    next_body:=pg_catalog.replace(source_body,old_fragment,new_fragment);
    if pg_catalog.replace(next_body,new_fragment,old_fragment) is distinct from source_body then
      raise exception 'test_workspace_product_monitoring_not_reversible' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||fn_name||'(')<>1 then
      raise exception 'test_workspace_product_monitoring_definition_changed' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||fn_name||'(',
      'CREATE OR REPLACE FUNCTION bx1_portal.'||backup_name||'(');
    if spec->>'kind'='TRIGGER' then
      execute pg_catalog.format('revoke all on function bx1_portal.%I() from public,anon,authenticated,service_role',backup_name);
    else
      execute pg_catalog.format('revoke all on function bx1_portal.%I(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role',backup_name);
    end if;
    changed_definition:=pg_catalog.replace(definition,old_fragment,new_fragment);
    execute changed_definition;
    select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
    if after_metadata is distinct from before_metadata or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'test_workspace_product_monitoring_metadata_changed' using errcode='55000'; end if;
  end loop;
end $test_workspace_product_monitoring_cutover$;
