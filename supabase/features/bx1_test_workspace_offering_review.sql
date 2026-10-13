-- TEST Stage 3 handoff overlay. Install atomically after workspace access,
-- monitoring/save compatibility and the source-pinned offering signature feature.
-- No provider admission, roles, applications, mandates, money or contracts seeded.
do $baseline$
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true
    or pg_catalog.to_regprocedure('bx1_private.offering_signature_require_decision(uuid,uuid,text)') is null
    or pg_catalog.to_regclass('bx1_private.test_workspace_product_commands') is null
    or pg_catalog.to_regprocedure('bx1_portal.test_offering_source_current(uuid,uuid,integer)') is not null
    or exists(select 1 from bx1_private.test_workspace_product_commands) then
    raise exception 'test_offering_review_baseline_required' using errcode='55000'; end if;
end $baseline$;

-- The authority epoch belongs to the existing immutable business history.
-- NULL triples remain normal/historical records. Never backfill old evidence.
alter table bx1_portal.offering_revisions
  add column test_workspace_source_id uuid references bx1_private.test_workspace_sources(id) on delete restrict,
  add column test_workspace_entitlement_id uuid references bx1_private.test_workspace_entitlements(id) on delete restrict,
  add column test_workspace_entitlement_revision integer,
  add constraint offering_revision_test_source_complete check (
    (test_workspace_source_id is null and test_workspace_entitlement_id is null and test_workspace_entitlement_revision is null)
    or (test_workspace_source_id is not null and test_workspace_entitlement_id is not null and test_workspace_entitlement_revision is not null and test_workspace_entitlement_revision>0));
alter table bx1_portal.product_service_appointments
  add column test_workspace_source_id uuid references bx1_private.test_workspace_sources(id) on delete restrict,
  add column test_workspace_entitlement_id uuid references bx1_private.test_workspace_entitlements(id) on delete restrict,
  add column test_workspace_entitlement_revision integer,
  add constraint product_appointment_test_source_complete check (
    (test_workspace_source_id is null and test_workspace_entitlement_id is null and test_workspace_entitlement_revision is null)
    or (test_workspace_source_id is not null and test_workspace_entitlement_id is not null and test_workspace_entitlement_revision is not null and test_workspace_entitlement_revision>0));
alter table bx1_private.test_workspace_product_commands
  drop constraint test_workspace_product_commands_command_check,
  add constraint test_workspace_product_commands_command_check check (command in (
    'create_product','save_product','submit_product','request_product_service_appointment',
    'review_product_service_appointment','apply_product_service_appointment','review_offering_issuer','review_product'));

create function bx1_portal.test_offering_is_source(target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.organisations o
    where o.id=target_org and o.test_workspace_source_id is not null);
$$;
create function bx1_portal.test_offering_source_entitlement(target_org uuid) returns uuid
language sql volatile security definer set search_path='' as $$
  select e.id from bx1_portal.organisations o
    join bx1_private.test_workspace_sources s on s.id=o.test_workspace_source_id
      and s.product_organisation_id=o.id and s.user_id=o.owner_id and s.role='OfferingManager'
      and s.origin='TEST_EVALUATION' and s.environment='TESTNET'
    join bx1_private.test_workspace_entitlements e on e.source_id=s.id and e.user_id=s.user_id
      and e.native_organisation_id=s.native_organisation_id and e.role='OfferingManager'
    where o.id=target_org and o.status='ACTIVE' and o.application_id is null
      and bx1_portal.test_workspace_entitlement_current(e.id,pg_catalog.clock_timestamp());
$$;
create function bx1_portal.test_offering_source_current(target_org uuid,grant_id uuid default null,grant_revision integer default null) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_environment()
    and (grant_id is null and grant_revision is null or grant_id is not null and grant_revision>0)
    and exists(select 1 from bx1_private.test_workspace_entitlements e
      where e.id=bx1_portal.test_offering_source_entitlement(target_org)
        and (grant_id is null or (e.id=grant_id and e.revision=grant_revision)));
$$;
create function bx1_portal.test_offering_organisation_current(target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.test_offering_is_source(target_org)
    then bx1_portal.test_offering_source_current(target_org)
    else bx1_portal.current_product_organisation(target_org) end;
$$;
create function bx1_portal.test_offering_revision_current(target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.offering_revisions r
    join bx1_portal.products p on p.id=r.product_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    where r.id=target_revision and r.origin='SUBMITTED' and r.submitted_by=o.owner_id
      and p.created_by=o.owner_id and r.test_workspace_source_id=o.test_workspace_source_id
      and r.test_workspace_source_id is not null
      and bx1_portal.test_offering_source_current(o.id,r.test_workspace_entitlement_id,r.test_workspace_entitlement_revision));
$$;
create function bx1_portal.test_offering_appointment_current(target_appointment uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_service_appointments a
    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    where a.id=target_appointment and a.requested_by_user_id=o.owner_id and p.created_by=o.owner_id
      and a.test_workspace_source_id=o.test_workspace_source_id and a.test_workspace_source_id is not null
      and a.reviewer_scope_organisation_id=o.reviewer_scope
      and bx1_portal.test_offering_source_current(o.id,a.test_workspace_entitlement_id,a.test_workspace_entitlement_revision));
$$;
create function bx1_portal.test_offering_lock_source(target_org uuid,grant_id uuid default null,grant_revision integer default null) returns void
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_private.test_workspace_entitlements; o bx1_portal.organisations;
begin
  select * into o from bx1_portal.organisations where id=target_org for share;
  select * into e from bx1_private.test_workspace_entitlements
    where id=bx1_portal.test_offering_source_entitlement(target_org) for share;
  perform id from bx1_private.test_workspace_sources where id=o.test_workspace_source_id for share;
  if o.id is null or e.id is null or bx1_portal.test_offering_source_current(target_org,grant_id,grant_revision) is not true then
    raise exception 'test_offering_source_not_current' using errcode='42501'; end if;
end $$;

create function bx1_portal.test_offering_assured_context(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_environment() and bx1_portal.test_workspace_session()
    and bx1_portal.valid_operating_context(c) and c->>'mode'='ROLE'
    and c->>'role' in ('OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin')
    and auth.jwt()->>'aal'='aal2' and bx1_private.has_session_mfa() and bx1_private.has_token_mfa()
    and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
        and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp');
$$;

create function bx1_portal.test_offering_context(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_session() and bx1_portal.offering_workflow_person_current(auth.uid())
    and c->>'mode'='ROLE' and c->>'role' in ('OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin')
    and ((c->>'role'='OfferingManager' and bx1_portal.test_workspace_entitlement(c) is not null)
      or (c->>'role' in ('IssuerFundManager','ComplianceOfficer','SuperAdmin')
        and (bx1_portal.test_offering_assured_context(c)
          or (bx1_portal.admission_password_session() and bx1_portal.admission_context(c)))));
$$;
create function bx1_portal.test_offering_lock_product_context(c jsonb,target_product uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; o bx1_portal.organisations;
begin
  select * into p from bx1_portal.products where id=target_product for update;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  if p.id is null or bx1_portal.test_offering_context(c) is not true then
    raise exception 'test_offering_context_denied' using errcode='42501'; end if;
  perform bx1_portal.test_offering_lock_source(o.id);
  if c->>'role'='OfferingManager' then
    if bx1_portal.offering_workflow_operator(c,o.id) is not true then
      raise exception 'test_offering_manager_denied' using errcode='42501'; end if;
  elsif c->>'role'='IssuerFundManager' then
    if c->>'organisationId' is distinct from o.reviewer_scope::text
      or bx1_portal.test_offering_appointed(c,p.id,'IssuerFundManager') is not true then
      raise exception 'test_offering_issuer_scope_denied' using errcode='42501'; end if;
  elsif c->>'organisationId' is distinct from o.reviewer_scope::text
    or bx1_portal.offering_workflow_staff(c,o.reviewer_scope,c->>'role') is not true then
    raise exception 'test_offering_staff_scope_denied' using errcode='42501'; end if;
  if p.current_offering_revision_id is not null then
    if bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true then
      raise exception 'test_offering_revision_source_not_current' using errcode='42501'; end if;
  end if;
end $$;

create function bx1_portal.test_offering_appointment_effective(target_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_service_appointments a
    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id and o.reviewer_scope=a.reviewer_scope_organisation_id
    join public.bx1_memberships m on m.id=a.native_membership_id
      and m.user_id=a.appointee_user_id and m.role=a.role and m.organisation_id=a.reviewer_scope_organisation_id
    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'
      and cfg.manual_test_review and cfg.test_ordinary_entry_enabled and cfg.reviewer_scope=o.reviewer_scope
    join bx1_portal.product_service_appointment_receipts receipt on receipt.id=a.approval_receipt_id
      and receipt.appointment_id=a.id and receipt.action='review_product_service_appointment'
      and receipt.status_after='APPROVED' and receipt.actor_id=a.reviewed_by_user_id
    where a.id=target_id and a.status='APPLIED' and a.applied_at is not null
      and a.requested_until>pg_catalog.clock_timestamp() and bx1_portal.test_offering_appointment_current(a.id)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)
      and bx1_portal.offering_workflow_person_current(a.reviewed_by_user_id)
      and bx1_portal.offering_workflow_person_current(a.applied_by_user_id)
      and exists(select 1 from public.bx1_memberships reviewer where reviewer.user_id=a.reviewed_by_user_id
        and reviewer.role='ComplianceOfficer' and reviewer.organisation_id=a.reviewer_scope_organisation_id
        and bx1_portal.native_membership_effective(reviewer.id))
      and exists(select 1 from public.bx1_memberships applier where applier.user_id=a.applied_by_user_id
        and applier.role='SuperAdmin' and applier.organisation_id=a.reviewer_scope_organisation_id
        and bx1_portal.native_membership_effective(applier.id))
      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.appointee_user_id)
      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)
      and bx1_portal.offering_workflow_people_independent(a.requested_by_user_id,a.applied_by_user_id)
      and bx1_portal.offering_workflow_people_independent(a.appointee_user_id,a.reviewed_by_user_id)
      and bx1_portal.offering_workflow_people_independent(a.appointee_user_id,a.applied_by_user_id)
      and bx1_portal.offering_workflow_people_independent(a.reviewed_by_user_id,a.applied_by_user_id));
$$;
create function bx1_portal.test_offering_appointed(c jsonb,target_product uuid,target_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_offering_context(c) and c->>'role'=target_role
    and target_role in ('IssuerFundManager','ComplianceOfficer')
    and exists(select 1 from bx1_portal.product_service_appointments a
      join public.bx1_memberships m on m.id=a.native_membership_id
      where a.product_id=target_product and a.appointee_user_id=auth.uid() and a.role=target_role
        and m.organisation_id::text=c->>'organisationId'
        and bx1_portal.test_offering_appointment_effective(a.id));
$$;
create function bx1_portal.test_offering_appointment_visible(c jsonb,target_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.product_service_appointments; v jsonb;
begin
  select * into a from bx1_portal.product_service_appointments where id=target_id;
  if a.id is null or bx1_portal.test_offering_context(c) is not true
    or bx1_portal.test_offering_appointment_current(a.id) is not true then return false; end if;
  v:=bx1_portal.offering_workflow_appointment_projection(c,a.id);
  if v is null then return false; end if;
  if c->>'role'='OfferingManager' then
    return a.requested_by_user_id=auth.uid() and a.requested_in_context=c
      and bx1_portal.offering_workflow_operator(c,a.product_organisation_id);
  elsif c->>'role'='IssuerFundManager' then
    return a.appointee_user_id=auth.uid() and a.role='IssuerFundManager'
      and bx1_portal.test_offering_appointed(c,a.product_id,'IssuerFundManager');
  elsif c->>'role'='ComplianceOfficer' then
    return coalesce((v->>'can_review')::boolean,false)
      or bx1_portal.test_offering_appointed(c,a.product_id,'ComplianceOfficer')
      or (a.reviewed_by_user_id=auth.uid() and a.approval_receipt_id is not null and a.reviewed_at is not null
        and bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer')
        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)
        and (a.status='APPROVED' or (a.status='APPLIED' and bx1_portal.test_offering_appointment_effective(a.id))));
  elsif c->>'role'='SuperAdmin' then
    return coalesce((v->>'can_apply')::boolean,false)
      or (a.status='APPLIED' and a.applied_by_user_id=auth.uid() and a.applied_at is not null
        and a.approval_receipt_id is not null and bx1_portal.test_offering_appointment_effective(a.id));
  end if;
  return false;
end $$;
create function bx1_portal.test_offering_product_visible(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_offering_context(c) and exists(select 1 from bx1_portal.products p
    join bx1_portal.organisations o on o.id=p.organisation_id
    where p.id=target_product and bx1_portal.test_offering_source_current(o.id)
      and (p.current_offering_revision_id is null or bx1_portal.test_offering_revision_current(p.current_offering_revision_id))
      and ((c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,o.id))
        or bx1_portal.test_offering_appointed(c,p.id,c->>'role')
        or (c->>'role'='ComplianceOfficer' and exists(select 1 from bx1_portal.product_service_appointments a
          where a.product_id=p.id and a.status='SUBMITTED' and bx1_portal.test_offering_appointment_visible(c,a.id)))
        or (c->>'role'='SuperAdmin' and exists(select 1 from bx1_portal.product_service_appointments a
          where a.product_id=p.id and bx1_portal.test_offering_appointment_visible(c,a.id)))));
$$;

create function bx1_portal.test_offering_target(action text,body jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare target uuid; value text;
begin
  if pg_catalog.jsonb_typeof(body) is distinct from 'object' then return null; end if;
  if action in ('request_product_service_appointment','review_offering_issuer','review_product') then
    value:=body->>'product_id';
    if value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then target:=value::uuid; end if;
  elsif action in ('review_product_service_appointment','apply_product_service_appointment') then
    value:=body->>'appointment_id';
    if value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select product_id into target from bx1_portal.product_service_appointments where id=value::uuid;
    end if;
  end if;
  if exists(select 1 from bx1_portal.products p where p.id=target and bx1_portal.test_offering_is_source(p.organisation_id)) then return target; end if;
  return null;
end $$;

create function bx1_portal.test_offering_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target uuid; p bx1_portal.products; o bx1_portal.organisations;
  e bx1_private.test_workspace_entitlements; a bx1_portal.product_service_appointments; result jsonb;
begin
  target:=bx1_portal.test_offering_target(action,body);
  if target is null or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536
    or bx1_portal.test_offering_context(c) is not true
    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then
    raise exception 'test_offering_command_denied' using errcode='42501'; end if;
  perform bx1_portal.offering_workflow_lock_actor(action,c);
  perform bx1_portal.test_offering_lock_product_context(c,target);
  select * into p from bx1_portal.products where id=target;
  select * into o from bx1_portal.organisations where id=p.organisation_id;
  select * into e from bx1_private.test_workspace_entitlements where id=bx1_portal.test_offering_source_entitlement(o.id);
  if action='request_product_service_appointment' then
    if c->>'role'<>'OfferingManager' or bx1_portal.offering_workflow_operator(c,o.id) is not true then
      raise exception 'test_offering_nomination_denied' using errcode='42501'; end if;
  elsif action in ('review_product_service_appointment','apply_product_service_appointment') then
    select * into a from bx1_portal.product_service_appointments where id=(body->>'appointment_id')::uuid for share;
    if a.product_id is distinct from p.id or bx1_portal.test_offering_appointment_current(a.id) is not true
      or bx1_portal.offering_workflow_staff(c,o.reviewer_scope,
        case action when 'review_product_service_appointment' then 'ComplianceOfficer' else 'SuperAdmin' end) is not true then
      raise exception 'test_offering_appointment_command_denied' using errcode='42501'; end if;
  elsif action in ('review_offering_issuer','review_product') then
    if p.current_offering_revision_id is null or bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true
      or bx1_portal.test_offering_appointed(c,p.id,case action when 'review_product' then 'ComplianceOfficer' else 'IssuerFundManager' end) is not true then
      raise exception 'test_offering_review_appointment_required' using errcode='42501'; end if;
  else raise exception 'test_offering_command_denied' using errcode='42501'; end if;
  insert into bx1_private.test_workspace_product_commands(transaction_id,actor_id,session_id,entitlement_id,
    entitlement_revision,operating_context,product_organisation_id,command,request_key,target_product_id)
    values(pg_catalog.pg_current_xact_id(),auth.uid(),(auth.jwt()->>'session_id')::uuid,e.id,e.revision,c,o.id,action,key,p.id);
  -- Existing guarded business writers remain the only writers.
  result:=bx1_portal.offering_workflow_command(c,action,key,body);
  if bx1_portal.test_offering_source_current(o.id,e.id,e.revision) is not true
    or bx1_portal.test_offering_context(c) is not true
    or bx1_portal.offering_workflow_command_allowed(c,action) is not true then
    raise exception 'test_offering_authority_changed_after_wait' using errcode='42501'; end if;
  delete from bx1_private.test_workspace_product_commands where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid();
  return result;
end $$;

create function bx1_portal.test_offering_lane_current(c jsonb,target_product uuid,key uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_offering_context(c) and exists(select 1 from bx1_private.test_workspace_product_commands lane
    join bx1_portal.products p on p.id=lane.target_product_id and p.organisation_id=lane.product_organisation_id
    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.session_id::text=auth.jwt()->>'session_id' and lane.operating_context=c
      and lane.target_product_id=target_product and lane.request_key=key and lane.command=action
      and bx1_portal.test_offering_source_current(p.organisation_id,lane.entitlement_id,lane.entitlement_revision));
$$;
create function bx1_portal.test_offering_review_mutation(new_id uuid,new_org uuid,new_creator uuid,new_status text,new_revision integer,
  old_org uuid,old_creator uuid,old_status text,old_revision integer,operation text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.test_workspace_product_commands; p bx1_portal.products;
begin
  select * into lane from bx1_private.test_workspace_product_commands
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() for update;
  if lane.actor_id is null or lane.command not in ('review_product','review_offering_issuer') or operation<>'UPDATE'
    or old_org is distinct from new_org or old_creator is distinct from new_creator
    or lane.target_product_id is distinct from new_id or lane.product_organisation_id is distinct from new_org
    or bx1_portal.test_offering_lane_current(lane.operating_context,new_id,lane.request_key,lane.command) is not true then
    raise exception 'test_offering_review_lane_required' using errcode='42501'; end if;
  perform bx1_portal.test_offering_lock_source(new_org,lane.entitlement_id,lane.entitlement_revision);
  select * into p from bx1_portal.products where id=new_id;
  if bx1_portal.test_offering_revision_current(p.current_offering_revision_id) is not true
    or bx1_portal.test_offering_appointed(lane.operating_context,new_id,
      case lane.command when 'review_product' then 'ComplianceOfficer' else 'IssuerFundManager' end) is not true
    or bx1_portal.offering_workflow_people_independent(auth.uid(),new_creator) is not true then
    raise exception 'test_offering_review_authority_changed' using errcode='42501'; end if;
  if lane.command='review_product' then
    if not ((old_status='IN_REVIEW' and new_status in ('APPROVED','CHANGES_REQUIRED') and new_revision=old_revision+1)
      or (old_status='APPROVED' and new_status='IN_REVIEW' and new_revision=old_revision and p.reviewer_id=auth.uid())) then
      raise exception 'test_offering_compliance_transition_denied' using errcode='42501'; end if;
  elsif old_status not in ('IN_REVIEW','APPROVED') or new_status not in ('APPROVED','IN_REVIEW','CHANGES_REQUIRED')
    or new_revision is distinct from old_revision+1 then
    raise exception 'test_offering_issuer_transition_denied' using errcode='42501'; end if;
  if bx1_portal.test_offering_lane_current(lane.operating_context,new_id,lane.request_key,lane.command) is not true then
    raise exception 'test_offering_review_authority_changed' using errcode='42501'; end if;
end $$;

-- Source stamp for a nomination enters only from the canonical request lane.
create function bx1_portal.test_offering_stamp_appointment() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.test_workspace_product_commands; o bx1_portal.organisations;
begin
  select * into o from bx1_portal.organisations where id=NEW.product_organisation_id;
  if o.test_workspace_source_id is null then
    if NEW.test_workspace_source_id is not null or NEW.test_workspace_entitlement_id is not null
      or NEW.test_workspace_entitlement_revision is not null then
      raise exception 'test_offering_ordinary_source_denied' using errcode='42501'; end if;
    return NEW;
  end if;
  select * into lane from bx1_private.test_workspace_product_commands
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() for update;
  if lane.command is distinct from 'request_product_service_appointment' or NEW.requested_by_user_id is distinct from auth.uid()
    or NEW.requested_in_context is distinct from lane.operating_context
    or bx1_portal.test_offering_lane_current(lane.operating_context,NEW.product_id,lane.request_key,lane.command) is not true then
    raise exception 'test_offering_appointment_source_lane_required' using errcode='42501'; end if;
  perform bx1_portal.test_offering_lock_source(o.id,lane.entitlement_id,lane.entitlement_revision);
  if (NEW.test_workspace_source_id is not null and NEW.test_workspace_source_id is distinct from o.test_workspace_source_id)
    or (NEW.test_workspace_entitlement_id is not null and NEW.test_workspace_entitlement_id is distinct from lane.entitlement_id)
    or (NEW.test_workspace_entitlement_revision is not null and NEW.test_workspace_entitlement_revision is distinct from lane.entitlement_revision) then
    raise exception 'test_offering_appointment_source_mismatch' using errcode='42501'; end if;
  NEW.test_workspace_source_id:=o.test_workspace_source_id;
  NEW.test_workspace_entitlement_id:=lane.entitlement_id;
  NEW.test_workspace_entitlement_revision:=lane.entitlement_revision;
  return NEW;
end $$;
create trigger bx1_test_offering_appointment_source before insert on bx1_portal.product_service_appointments
  for each row execute function bx1_portal.test_offering_stamp_appointment();

create function bx1_portal.test_offering_stamp_revision(r bx1_portal.offering_revisions) returns bx1_portal.offering_revisions
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.test_workspace_product_commands; p bx1_portal.products; o bx1_portal.organisations;
begin
  select * into p from bx1_portal.products where id=r.product_id for update;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  if o.test_workspace_source_id is null then
    if r.test_workspace_source_id is not null or r.test_workspace_entitlement_id is not null
      or r.test_workspace_entitlement_revision is not null then
      raise exception 'test_offering_ordinary_source_denied' using errcode='42501'; end if;
    return r;
  end if;
  select * into lane from bx1_private.test_workspace_product_commands
    where transaction_id=pg_catalog.pg_current_xact_id() and actor_id=auth.uid() for update;
  if r.origin is distinct from 'SUBMITTED' or r.submitted_by is distinct from auth.uid()
    or p.created_by is distinct from auth.uid() or o.owner_id is distinct from auth.uid()
    or lane.command is distinct from 'submit_product' or p.status is distinct from 'IN_REVIEW'
    or r.product_revision_at_submission is distinct from p.revision
    or r.terms is distinct from p.terms or r.terms_hash is distinct from p.terms_hash
    or bx1_portal.test_offering_lane_current(lane.operating_context,p.id,lane.request_key,lane.command) is not true then
    raise exception 'test_offering_revision_source_lane_required' using errcode='42501'; end if;
  perform bx1_portal.test_offering_lock_source(o.id,lane.entitlement_id,lane.entitlement_revision);
  if (r.test_workspace_source_id is not null and r.test_workspace_source_id is distinct from o.test_workspace_source_id)
    or (r.test_workspace_entitlement_id is not null and r.test_workspace_entitlement_id is distinct from lane.entitlement_id)
    or (r.test_workspace_entitlement_revision is not null and r.test_workspace_entitlement_revision is distinct from lane.entitlement_revision) then
    raise exception 'test_offering_revision_source_mismatch' using errcode='42501'; end if;
  r.test_workspace_source_id:=o.test_workspace_source_id;
  r.test_workspace_entitlement_id:=lane.entitlement_id;
  r.test_workspace_entitlement_revision:=lane.entitlement_revision;
  return r;
end $$;

-- Exact post-signature source pins; every alteration remains body-only.
do $test_offering_cutover$
declare spec jsonb; change jsonb; target oid; before_metadata jsonb; after_metadata jsonb;
  source_body text; next_body text; definition text; function_name text; namespace_name text;
  occurrences integer; backup oid; permission record;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($test_offering_specs$
[
  {
    "signature": "bx1_portal.offering_workflow_manager_current(uuid,uuid,uuid)",
    "sha": "299f7ac272728efeed0bf07fc95cbf09abb3cc9675f73b18eb597e0bbc07ae7b",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_manager_current",
    "changes": [
      {
        "from": "then actor=auth.uid() and exists",
        "to": "then actor is not null and exists",
        "count": 1
      },
      {
        "from": "e.id=bx1_portal.test_workspace_entitlement(pg_catalog.jsonb_build_object('mode','ROLE','organisationId',native_org,'role','OfferingManager'))",
        "to": "e.id=bx1_portal.test_offering_source_entitlement(target_org) and e.native_organisation_id=native_org",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.test_workspace_projection(jsonb)",
    "sha": "0b6b195ac6d9697a224c859e631b1f4ad9b5c4b775683f63a61cc31837ba36f4",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_test_workspace_projection",
    "changes": [
      {
        "from": "'[\"create_product\",\"save_product\",\"submit_product\"]'::jsonb",
        "to": "'[\"create_product\",\"save_product\",\"submit_product\",\"request_product_service_appointment\"]'::jsonb",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_command_allowed(jsonb,text)",
    "sha": "f32376828eff192fdbe0b43ec1b47a85866500c5f9b9fad3e789c540c30e6555",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_command_allowed",
    "changes": [
      {
        "from": "array['create_product','save_product','submit_product']",
        "to": "array['create_product','save_product','submit_product','request_product_service_appointment']",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.test_workspace_read(jsonb)",
    "sha": "f9c76c8384e2cacf8b7f9c6dd1828a0953ecba8c7c83d35952a261a705c06cf8",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_test_workspace_read",
    "changes": [
      {
        "from": "    result:=result||pg_catalog.jsonb_build_object('product_appointments','[]'::jsonb,'product_appointment_candidates','[]'::jsonb);",
        "to": "    -- Keep the existing exact-product nomination/appointment projections.",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_lock_product(jsonb,uuid)",
    "sha": "76ecd950cd0a66199a190cf2decfaf0c92c0e483654cc8004a443ac31e5e0dad",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_lock_product",
    "changes": [
      {
        "from": "perform bx1_portal.offering_workflow_lock_organisation(c,target_org);",
        "to": "perform bx1_portal.test_offering_lock_product_context(c,target_product);",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_product_visible(jsonb,uuid)",
    "sha": "e93b33f05dbfb92197b7099c844f7503284132539124627ab67bf52be82212d3",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_product_visible",
    "changes": [
      {
        "from": "\n  select case when bx1_portal.test_workspace_entitlement(c) is not null\n    then c->>'role'='OfferingManager' and exists(select 1 from bx1_portal.products p\n      where p.id=target_product and bx1_portal.offering_workflow_operator(c,p.organisation_id))\n    else bx1_portal.offering_workflow_product_visible_pre_test_workspace(c,target_product) end;\n",
        "to": "\n  select case when exists(select 1 from bx1_portal.products p where p.id=target_product and bx1_portal.test_offering_is_source(p.organisation_id))\n    then bx1_portal.test_offering_product_visible(c,target_product) else (case when bx1_portal.test_workspace_entitlement(c) is not null\n    then c->>'role'='OfferingManager' and exists(select 1 from bx1_portal.products p\n      where p.id=target_product and bx1_portal.offering_workflow_operator(c,p.organisation_id))\n    else bx1_portal.offering_workflow_product_visible_pre_test_workspace(c,target_product) end) end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_product_appointment_effective(uuid)",
    "sha": "4c07278c11020724b76f195d14cb69b6022a138f7174c9c6c0d992ad1f4d62ce",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_product_appointment_effective",
    "changes": [
      {
        "from": "\n  select case when bx1_portal.admission_password_session() is not true\n    then bx1_portal.product_appointment_effective(target_id) else exists(\n    select 1 from bx1_portal.product_service_appointments a\n    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id\n    join bx1_portal.organisations o on o.id=p.organisation_id and o.reviewer_scope=a.reviewer_scope_organisation_id\n    join public.bx1_memberships m on m.id=a.native_membership_id\n      and m.user_id=a.appointee_user_id and m.role=a.role\n    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'\n      and cfg.manual_test_review and cfg.test_ordinary_entry_enabled and cfg.reviewer_scope=a.reviewer_scope_organisation_id\n    where a.id=target_id and a.status='APPLIED' and a.approval_receipt_id is not null\n      and a.applied_at is not null and a.requested_until>pg_catalog.clock_timestamp()\n      and bx1_portal.current_product_organisation(o.id)\n      and bx1_portal.native_membership_effective(m.id)\n      and bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,\n        (a.requested_in_context->>'organisationId')::uuid)\n      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)\n      and bx1_portal.offering_workflow_person_current(a.reviewed_by_user_id)\n      and bx1_portal.offering_workflow_person_current(a.applied_by_user_id)\n      and exists(select 1 from public.bx1_memberships review\n        where review.user_id=a.reviewed_by_user_id and review.role='ComplianceOfficer'\n          and review.organisation_id=a.reviewer_scope_organisation_id\n          and bx1_portal.native_membership_effective(review.id))\n      and exists(select 1 from public.bx1_memberships applier\n        where applier.user_id=a.applied_by_user_id and applier.role='SuperAdmin'\n          and applier.organisation_id=a.reviewer_scope_organisation_id\n          and bx1_portal.native_membership_effective(applier.id))\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.appointee_user_id)\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.applied_by_user_id)\n      and bx1_portal.admission_people_independent(a.appointee_user_id,a.reviewed_by_user_id)\n      and bx1_portal.admission_people_independent(a.appointee_user_id,a.applied_by_user_id)\n      and bx1_portal.admission_people_independent(a.reviewed_by_user_id,a.applied_by_user_id)) end;\n",
        "to": "\n  select case when exists(select 1 from bx1_portal.product_service_appointments a where a.id=target_id and bx1_portal.test_offering_is_source(a.product_organisation_id))\n    then bx1_portal.test_offering_appointment_effective(target_id) else (case when bx1_portal.admission_password_session() is not true\n    then bx1_portal.product_appointment_effective(target_id) else exists(\n    select 1 from bx1_portal.product_service_appointments a\n    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id\n    join bx1_portal.organisations o on o.id=p.organisation_id and o.reviewer_scope=a.reviewer_scope_organisation_id\n    join public.bx1_memberships m on m.id=a.native_membership_id\n      and m.user_id=a.appointee_user_id and m.role=a.role\n    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'\n      and cfg.manual_test_review and cfg.test_ordinary_entry_enabled and cfg.reviewer_scope=a.reviewer_scope_organisation_id\n    where a.id=target_id and a.status='APPLIED' and a.approval_receipt_id is not null\n      and a.applied_at is not null and a.requested_until>pg_catalog.clock_timestamp()\n      and bx1_portal.current_product_organisation(o.id)\n      and bx1_portal.native_membership_effective(m.id)\n      and bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,\n        (a.requested_in_context->>'organisationId')::uuid)\n      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)\n      and bx1_portal.offering_workflow_person_current(a.reviewed_by_user_id)\n      and bx1_portal.offering_workflow_person_current(a.applied_by_user_id)\n      and exists(select 1 from public.bx1_memberships review\n        where review.user_id=a.reviewed_by_user_id and review.role='ComplianceOfficer'\n          and review.organisation_id=a.reviewer_scope_organisation_id\n          and bx1_portal.native_membership_effective(review.id))\n      and exists(select 1 from public.bx1_memberships applier\n        where applier.user_id=a.applied_by_user_id and applier.role='SuperAdmin'\n          and applier.organisation_id=a.reviewer_scope_organisation_id\n          and bx1_portal.native_membership_effective(applier.id))\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.appointee_user_id)\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)\n      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.applied_by_user_id)\n      and bx1_portal.admission_people_independent(a.appointee_user_id,a.reviewed_by_user_id)\n      and bx1_portal.admission_people_independent(a.appointee_user_id,a.applied_by_user_id)\n      and bx1_portal.admission_people_independent(a.reviewed_by_user_id,a.applied_by_user_id)) end) end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_product_appointment_authorised(jsonb,uuid,text)",
    "sha": "1602e8779b7de899e9d72d9c12c0e29ae272cbf6f8e3c7ab21123928eccb84bd",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_product_appointment_authorised",
    "changes": [
      {
        "from": "\n  select case when bx1_portal.admission_password_session() is not true\n    then bx1_portal.product_appointment_authorised(c,target_product,target_role)\n    else bx1_portal.offering_workflow_context(c) and c->>'role'=target_role\n      and target_role in ('IssuerFundManager','ComplianceOfficer')\n      and exists(select 1 from bx1_portal.product_service_appointments a\n        join public.bx1_memberships m on m.id=a.native_membership_id\n        where a.product_id=target_product and a.role=target_role and a.appointee_user_id=auth.uid()\n          and m.organisation_id=(c->>'organisationId')::uuid\n          and bx1_portal.offering_workflow_product_appointment_effective(a.id)) end;\n",
        "to": "\n  select case when exists(select 1 from bx1_portal.products p where p.id=target_product and bx1_portal.test_offering_is_source(p.organisation_id))\n    then bx1_portal.test_offering_appointed(c,target_product,target_role) else (case when bx1_portal.admission_password_session() is not true\n    then bx1_portal.product_appointment_authorised(c,target_product,target_role)\n    else bx1_portal.offering_workflow_context(c) and c->>'role'=target_role\n      and target_role in ('IssuerFundManager','ComplianceOfficer')\n      and exists(select 1 from bx1_portal.product_service_appointments a\n        join public.bx1_memberships m on m.id=a.native_membership_id\n        where a.product_id=target_product and a.role=target_role and a.appointee_user_id=auth.uid()\n          and m.organisation_id=(c->>'organisationId')::uuid\n          and bx1_portal.offering_workflow_product_appointment_effective(a.id)) end) end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_reviewer(jsonb,uuid,uuid,uuid)",
    "sha": "4d97d1b0605ab8e4a343f4e0a80979b4a72e38f9bb4202d9450f97bdb4564d96",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_reviewer",
    "changes": [
      {
        "from": "\n  select case when bx1_portal.admission_password_session()\n    then bx1_portal.offering_workflow_product_appointment_authorised(c,target_product,'ComplianceOfficer')\n    else bx1_portal.scoped_reviewer(c,target_scope,target_org) end;\n",
        "to": "\n  select case when bx1_portal.test_offering_is_source(target_org)\n    then bx1_portal.test_offering_appointed(c,target_product,'ComplianceOfficer') else (case when bx1_portal.admission_password_session()\n    then bx1_portal.offering_workflow_product_appointment_authorised(c,target_product,'ComplianceOfficer')\n    else bx1_portal.scoped_reviewer(c,target_scope,target_org) end) end;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_appointment_source_current(uuid)",
    "sha": "9ba07a4427749827206db017e5840a789cf2df8c3e4b55faf8111f8474771836",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_appointment_source_current",
    "changes": [
      {
        "from": "and bx1_portal.current_product_organisation(o.id)",
        "to": "and bx1_portal.test_offering_organisation_current(o.id)\n      and (not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_appointment_current(a.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_appointment_visible(jsonb,uuid)",
    "sha": "40f512cda8581c0681095132c748386d39c2628d39edbafb20206c6672fd8229",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_appointment_visible",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if exists(select 1 from bx1_portal.product_service_appointments source_appointment\n    where source_appointment.id=target_id and bx1_portal.test_offering_is_source(source_appointment.product_organisation_id)) then\n    return bx1_portal.test_offering_appointment_visible(c,target_id); end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_issuer_authorised(jsonb,uuid)",
    "sha": "8b9d8902fa895e06d73344266a4b97fa1812d9ff7e4a3f3c113260538042260f",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_issuer_authorised",
    "changes": [
      {
        "from": "and bx1_portal.current_product_organisation(o.id)",
        "to": "and bx1_portal.test_offering_organisation_current(o.id)\n      and (not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_revision_current(r.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_approved(uuid)",
    "sha": "802961d325a697660c74c362a60c42ea9af1b4865ce857f753964dd321e790a3",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_approved",
    "changes": [
      {
        "from": "and bx1_portal.current_product_organisation(o.id)",
        "to": "and bx1_portal.test_offering_organisation_current(o.id)\n      and (not bx1_portal.test_offering_is_source(o.id) or bx1_portal.test_offering_revision_current(r.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)",
    "sha": "9f0bf3fe761947aa7f05a7bbd8794bd13123cb28c0c0cbeb553def00174e7604",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_execute_product_service_appointment",
    "changes": [
      {
        "from": "or bx1_portal.current_product_organisation(o.id) is not true",
        "to": "or bx1_portal.test_offering_organisation_current(o.id) is not true",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "sha": "7e955b7dadbe25668d6216fd5d0ae187039e0e0b4c68fc88f956046680696424",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_execute_appointed_compliance_decision",
    "changes": [
      {
        "from": "or bx1_portal.current_product_organisation(o.id) is not true",
        "to": "or bx1_portal.test_offering_organisation_current(o.id) is not true",
        "count": 1
      },
      {
        "from": "  if bx1_portal.admission_password_session() then\n    perform bx1_portal.offering_workflow_base_command(c,'review_product'",
        "to": "  if bx1_portal.admission_password_session() or bx1_portal.test_offering_is_source(o.id) then\n    perform bx1_portal.offering_workflow_base_command(c,'review_product'",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_base_command(jsonb,text,uuid,jsonb)",
    "sha": "9f7f486f0b3fd7fda92f7110a7f354b227d41e707fee70a552582ebde9f09b98",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_base_command",
    "changes": [
      {
        "from": "or not bx1_portal.organisation_active(o.id)",
        "to": "or not ((not bx1_portal.test_offering_is_source(o.id) and bx1_portal.organisation_active(o.id))\n        or bx1_portal.test_offering_lane_current(c,p.id,request_key,'review_product'))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)",
    "sha": "f08cb35917d4b3fa12a8b662672f7eff66559010db4475418eeba9612d061e5e",
    "secdef": true,
    "acl": [
      "postgres=X/postgres",
      "authenticated=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_execute_scoped",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.test_offering_target(action,body) is not null then\n    return bx1_portal.test_offering_command(c,action,key,body); end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.test_workspace_product_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)",
    "sha": "f0f22d18f813181d2cd72d4cbe542fda646481d4f9f2c10575af47ff1670fb5c",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_test_workspace_product_mutation",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if exists(select 1 from bx1_private.test_workspace_product_commands lane\n    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n      and lane.command in ('review_product','review_offering_issuer')) then\n    perform bx1_portal.test_offering_review_mutation(new_id,new_org,new_creator,new_status,new_revision,\n      old_org,old_creator,old_status,old_revision,operation);\n    return;\n  end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_product_service_appointment()",
    "sha": "7596443a3f35244e23435389e3d5eb510cb29c6356bfb7997f6eda40755a3d3e",
    "secdef": false,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_guard_product_service_appointment",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if tg_op='UPDATE' and row(NEW.test_workspace_source_id,NEW.test_workspace_entitlement_id,NEW.test_workspace_entitlement_revision)\n    is distinct from row(OLD.test_workspace_source_id,OLD.test_workspace_entitlement_id,OLD.test_workspace_entitlement_revision) then\n    raise exception 'test_offering_appointment_source_immutable' using errcode='23514'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_offering_revision_product_lock()",
    "sha": "2455d3bf21ff49dc6c5f5624b0943196e4244ab4c3958153e69b3250ea94863f",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_guard_offering_revision_product_lock",
    "changes": [
      {
        "from": "begin\n  -- The product lock",
        "to": "begin\n  NEW:=bx1_portal.test_offering_stamp_revision(NEW);\n  -- The product lock",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_document_context(jsonb)",
    "sha": "168599a14f6ce74cb976f0f88da1846bdd9c72d8a27a8656659274161aec45bb",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_document_context",
    "changes": [
      {
        "from": "and case when bx1_portal.admission_password_session() then",
        "to": "and case when bx1_portal.test_workspace_entitlement(c) is not null then bx1_portal.test_offering_context(c)\n      when bx1_portal.admission_password_session() then",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.lock_offering_document_revision(uuid)",
    "sha": "bb444dcd1ae2e4987fea8687c2d76f4e2529764187d54c37709fdbdf01e6c19b",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_lock_offering_document_revision",
    "changes": [
      {
        "from": "or bx1_portal.current_product_organisation(p.organisation_id) is not true",
        "to": "or bx1_portal.test_offering_organisation_current(p.organisation_id) is not true",
        "count": 1
      },
      {
        "from": "or not exists(select 1 from bx1_portal.representative_mandates mandate\n      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by\n        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))",
        "to": "or not (bx1_portal.test_offering_revision_current(target_revision) or (not bx1_portal.test_offering_is_source(p.organisation_id)\n      and exists(select 1 from bx1_portal.representative_mandates mandate\n      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by\n        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_signature_require_decision(uuid,uuid,text)",
    "sha": "8c950b366c01dabf814596e70131915e551d6a025e08a4e751d2be5ba2c164a9",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_signature_require_decision",
    "changes": [
      {
        "from": "or bx1_portal.current_product_organisation(p.organisation_id) is not true",
        "to": "or bx1_portal.test_offering_organisation_current(p.organisation_id) is not true",
        "count": 1
      },
      {
        "from": "or not exists(select 1 from bx1_portal.representative_mandates mandate\n      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by\n        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))",
        "to": "or not (bx1_portal.test_offering_revision_current(p_revision) or (not bx1_portal.test_offering_is_source(p.organisation_id)\n      and exists(select 1 from bx1_portal.representative_mandates mandate\n      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by\n        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_signature_lock_context(uuid,uuid,text,jsonb,uuid,jsonb)",
    "sha": "9b3c8ac4fc31f7d701ab3c92d789a204bb578f76e84c69c413bcf978944b9ae5",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_signature_lock_context",
    "changes": [
      {
        "from": "when 'ComplianceOfficer' then 'review_product' else 'reopen_offering_review' end,c);",
        "to": "when 'ComplianceOfficer' then 'review_product'\n    when 'OfferingManager' then case when bx1_portal.test_workspace_entitlement(c) is not null\n      then 'request_product_service_appointment' else 'reopen_offering_review' end\n    else 'reopen_offering_review' end,c);",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_signature_authorisation_current(uuid)",
    "sha": "8466c7333bb4b1ad0595b4a1783e199d255d20653014d8fd21363c3fdd28d99f",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_signature_authorisation_current",
    "changes": [
      {
        "from": "where p.id=a.product_id and r.id=a.revision_id",
        "to": "where p.id=a.product_id\n      and (not bx1_portal.test_offering_is_source(p.organisation_id) or bx1_portal.test_offering_revision_current(r.id))\n      and r.id=a.revision_id",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_context(jsonb)",
    "sha": "58dceed7565fbaead1984be2716aff273aa550be8107df7a34b89ff424dde8c6",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_context",
    "changes": [
      {
        "from": "select case when bx1_portal.test_workspace_entitlement(c) is not null",
        "to": "select case when bx1_portal.test_workspace_environment() and c->>'mode'='ROLE'\n      and c->>'role' in ('IssuerFundManager','ComplianceOfficer','SuperAdmin')\n    then bx1_portal.test_offering_context(c)\n    when bx1_portal.test_workspace_entitlement(c) is not null",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_access(jsonb)",
    "sha": "30cad17ae43a9a87125dfff0632eeaee07bf44892131f6e6ee35d4b8493c5556",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_access",
    "changes": [
      {
        "from": "'operating_context',c,'session_mode','TEST_PASSWORD',",
        "to": "'operating_context',c,'session_mode',case when bx1_portal.admission_password_session() then 'TEST_PASSWORD' else 'STANDARD' end,",
        "count": 1
      },
      {
        "from": "select case when bx1_portal.offering_workflow_context(c) then",
        "to": "select case when bx1_portal.offering_workflow_context(c)\n      and (bx1_portal.admission_password_session() or bx1_portal.test_offering_assured_context(c)) then",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_read_scoped_pre_test_workspace(jsonb)",
    "sha": "e98e6e666f1864bab9eb89c3a78442afa29d94760ee70e0611e23e34216506a6",
    "secdef": true,
    "acl": [
      "postgres=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_offering_workflow_read_scoped_pre_test_workspace",
    "changes": [
      {
        "from": "result:=bx1_portal.admission_read_scoped(c);",
        "to": "if bx1_portal.admission_password_session() then result:=bx1_portal.admission_read_scoped(c);\n    else result:=bx1_portal.read_scoped_pre_test_workspace(c); end if;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.read_scoped(jsonb)",
    "sha": "a2a5856e4e488f2ebe796d82f7cb3d221ab2409f0cc680ee4e4dffd7600f13c2",
    "secdef": true,
    "acl": [
      "postgres=X/postgres",
      "authenticated=X/postgres"
    ],
    "config": [
      "search_path=\"\""
    ],
    "backup": "tr3_read_scoped",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.test_offering_context(c) and c->>'role' in ('IssuerFundManager','ComplianceOfficer','SuperAdmin')\n    and exists(select 1 from bx1_portal.products target_product\n      where bx1_portal.test_offering_is_source(target_product.organisation_id)\n        and bx1_portal.test_offering_product_visible(c,target_product.id)) then\n    return bx1_portal.offering_workflow_read_scoped(c); end if;\n",
        "count": 1
      }
    ]
  }
]
$test_offering_specs$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select p.prosrc,pg_catalog.to_jsonb(p)-'prosrc',p.proname,n.nspname
      into source_body,before_metadata,function_name,namespace_name
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where p.oid=target;
    if target is null or before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
      or before_metadata->>'prosecdef' is distinct from spec->>'secdef'
      or before_metadata->'proacl' is distinct from spec->'acl'
      or before_metadata->'proconfig' is distinct from spec->'config'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
        pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'test_offering_cutover_source_changed: %',spec->>'signature' using errcode='55000'; end if;
    if pg_catalog.length(spec->>'backup')>63 then
      raise exception 'test_offering_backup_name_invalid' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION '||namespace_name||'.'||function_name||'(')<>1 then
      raise exception 'test_offering_definition_header_changed' using errcode='55000'; end if;
    if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname=namespace_name and p.proname=spec->>'backup') then
      raise exception 'test_offering_backup_exists' using errcode='55000'; end if;
    next_body:=source_body;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))
        /pg_catalog.length(change->>'from');
      if occurrences<>(change->>'count')::integer then
        raise exception 'test_offering_cutpoint_changed: %',spec->>'signature' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') with ordinality x(value,ordinality) order by ordinality desc loop
      next_body:=pg_catalog.replace(next_body,change->>'to',change->>'from');
    end loop;
    if next_body is distinct from source_body then
      raise exception 'test_offering_body_not_reversible' using errcode='55000'; end if;
    next_body:=source_body;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION '||namespace_name||'.'||function_name||'(',
      'CREATE OR REPLACE FUNCTION '||namespace_name||'.'||(spec->>'backup')||'(');
    select p.oid into backup from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname=namespace_name and p.proname=spec->>'backup';
    for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=backup and a.grantee<>p.proowner loop
      if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',backup::regprocedure);
      else execute pg_catalog.format('revoke all on function %s from %I',backup::regprocedure,permission.rolname); end if;
    end loop;
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'test_offering_definition_body_ambiguous' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
    if after_metadata is distinct from before_metadata
      or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'test_offering_function_identity_changed' using errcode='55000'; end if;
  end loop;
end $test_offering_cutover$;

-- Private helpers have no direct web, worker, service-role or PUBLIC entry point.
-- Public bridges retain their original OIDs/ACLs and guarded call path.
do $test_offering_private_helpers$
declare routine record; permission record;
begin
  for routine in select p.oid,p.proowner,p.prosecdef,p.proconfig from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and p.proname like 'test_offering_%' loop
    if routine.proowner is distinct from 'postgres'::regrole::oid or routine.prosecdef is not true
      or routine.proconfig is distinct from array['search_path=""']::text[] then
      raise exception 'test_offering_private_helper_metadata_changed' using errcode='55000'; end if;
    for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=routine.oid and a.grantee<>p.proowner loop
      if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',routine.oid::regprocedure);
      else execute pg_catalog.format('revoke all on function %s from %I',routine.oid::regprocedure,permission.rolname); end if;
    end loop;
  end loop;
end $test_offering_private_helpers$;



