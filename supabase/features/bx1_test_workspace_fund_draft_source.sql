-- TEST evaluation fund draft editing uses its explicit provision source, not a
-- fabricated customer application. Ordinary admitted fund sources are unchanged.
-- Apply atomically after the TEST workspace command-lane/monitoring increment.
do $$
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true
    or pg_catalog.to_regclass('bx1_private.test_workspace_product_commands') is null
    or pg_catalog.to_regprocedure('bx1_portal.test_workspace_fund_source_lock(jsonb,uuid,uuid)') is not null then
    raise exception 'test_workspace_fund_source_baseline_required' using errcode='55000'; end if;
end $$;

create function bx1_portal.test_workspace_fund_source_lock(c jsonb,target_product uuid,request_key uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.test_workspace_product_commands; p bx1_portal.products; grant_id uuid;
begin
  select * into lane from bx1_private.test_workspace_product_commands
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
  if lane.actor_id is null or lane.command is distinct from 'save_product'
    or lane.session_id::text is distinct from auth.jwt()->>'session_id'
    or lane.operating_context is distinct from c or c->>'role' is distinct from 'OfferingManager'
    or lane.request_key is distinct from request_key or lane.target_product_id is distinct from target_product then
    raise exception 'test_workspace_fund_source_lane_required' using errcode='42501'; end if;
  select * into p from bx1_portal.products where id=target_product;
  if p.id is null or p.organisation_id is distinct from lane.product_organisation_id
    or p.created_by is distinct from auth.uid() or p.terms->>'asset_type' is distinct from 'FUND'
    or p.status not in ('DRAFT','CHANGES_REQUIRED') then
    raise exception 'test_workspace_fund_source_product_denied' using errcode='42501'; end if;
  -- The retained save writer already holds the product and portal organisation.
  -- Source rows are immutable after their initial portal link; do not acquire
  -- an inverse source/grant lock against the owner renewal transaction.
  perform bx1_portal.test_workspace_lock(c,p.organisation_id);
  grant_id:=bx1_portal.test_workspace_entitlement(c);
  if grant_id is distinct from lane.entitlement_id or not exists (
    select 1 from bx1_private.test_workspace_entitlements e
    join bx1_private.test_workspace_sources s on s.id=e.source_id
    join bx1_portal.organisations o on o.id=s.product_organisation_id
    where e.id=grant_id and e.revision=lane.entitlement_revision and e.user_id=auth.uid()
      and e.role='OfferingManager' and e.native_organisation_id::text=c->>'organisationId'
      and s.origin='TEST_EVALUATION' and s.environment='TESTNET' and s.user_id=auth.uid()
      and o.id=p.organisation_id and o.test_workspace_source_id=s.id
      and o.application_id is null and o.owner_id=auth.uid() and o.status='ACTIVE'
  ) then raise exception 'test_workspace_fund_source_current_grant_required' using errcode='42501'; end if;
  if bx1_portal.test_workspace_entitlement(c) is distinct from grant_id then
    raise exception 'test_workspace_fund_source_changed_after_wait' using errcode='42501'; end if;
end $$;
revoke all on function bx1_portal.test_workspace_fund_source_lock(jsonb,uuid,uuid) from public,anon,authenticated,service_role;

do $test_workspace_fund_source_cutover$
declare target oid:='bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)'::regprocedure;
  before_metadata jsonb; after_metadata jsonb; source_body text; next_body text; definition text;
  old_fragment text:=$old$  perform id from bx1_portal.applications where id=source_application for share;
  if not found then raise exception 'fund_v2_save_denied' using errcode='42501'; end if;$old$;
  new_fragment text:=$new$  if source_application is null and exists(select 1 from bx1_portal.organisations
    where id=target_org and test_workspace_source_id is not null) then
    perform bx1_portal.test_workspace_fund_source_lock(c,p.id,key);
  else
    perform id from bx1_portal.applications where id=source_application for share;
    if not found then raise exception 'fund_v2_save_denied' using errcode='42501'; end if;
  end if;$new$;
begin
  select p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' into source_body,before_metadata from pg_catalog.pg_proc p where p.oid=target;
  if before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
    or before_metadata->>'prosecdef' is distinct from 'true'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      <>'929f8b1d861c1a04584aec7ebfe2d38d8e4f7987ff6d01ed5e04f2e4c767bf66'
    or (char_length(source_body)-char_length(pg_catalog.replace(source_body,old_fragment,'')))/char_length(old_fragment)<>1
    or pg_catalog.to_regprocedure('bx1_portal.save_fund_v2_scoped_pre_workspace_source(jsonb,uuid,jsonb)') is not null then
    raise exception 'test_workspace_fund_source_definition_changed' using errcode='55000'; end if;
  next_body:=pg_catalog.replace(source_body,old_fragment,new_fragment);
  if pg_catalog.replace(next_body,new_fragment,old_fragment) is distinct from source_body then
    raise exception 'test_workspace_fund_source_not_reversible' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION bx1_portal.save_fund_v2_scoped(')<>1 then
    raise exception 'test_workspace_fund_source_prefix_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION bx1_portal.save_fund_v2_scoped(',
    'CREATE OR REPLACE FUNCTION bx1_portal.save_fund_v2_scoped_pre_workspace_source(');
  revoke all on function bx1_portal.save_fund_v2_scoped_pre_workspace_source(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
  execute pg_catalog.replace(definition,old_fragment,new_fragment);
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
  if after_metadata is distinct from before_metadata or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
    raise exception 'test_workspace_fund_source_metadata_changed' using errcode='55000'; end if;
end $test_workspace_fund_source_cutover$;
