-- TEST-only workspace access, not customer admission or provider acceptance.
-- Install atomically after bx1_offering_workflow. No identities or grants seeded.
-- Owner provisioning is separate from authenticated read/command authority.
do $$
begin
  if current_user <> 'postgres' or not exists (
    select 1 from bx1_portal.entry_configuration where singleton
      and environment='TESTNET' and manual_test_review and test_ordinary_entry_enabled
  ) or pg_catalog.to_regprocedure('bx1_portal.offering_workflow_read_scoped(jsonb)') is null
    or pg_catalog.to_regclass('bx1_private.test_workspace_entitlements') is not null then
    raise exception 'test_workspace_test_baseline_required' using errcode='55000';
  end if;
end $$;

create table bx1_private.test_workspace_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  origin text not null default 'TEST_EVALUATION' check (origin='TEST_EVALUATION'),
  environment text not null default 'TESTNET' check (environment='TESTNET'),
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('OfferingManager','Investor')),
  native_organisation_id uuid not null unique references public.bx1_organisations(id) on delete restrict,
  product_organisation_id uuid unique references bx1_portal.organisations(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(user_id,role), unique(id,user_id,role,native_organisation_id)
);
-- A distinct provision source avoids creating a second organisation against an
-- applicant's existing draft and preserves later ordinary admission unchanged.
alter table bx1_portal.organisations add column test_workspace_source_id uuid unique
  references bx1_private.test_workspace_sources(id) on delete restrict;
alter table bx1_portal.organisations alter column application_id drop not null;
alter table bx1_portal.organisations add constraint bx1_organisation_provision_source
  check ((application_id is null)=(test_workspace_source_id is not null));

create table bx1_private.test_workspace_entitlements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  source_id uuid not null unique,
  user_id uuid not null,
  role text not null check (role in ('OfferingManager','Investor')),
  native_organisation_id uuid not null,
  membership_id uuid not null unique references public.bx1_memberships(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
  revision integer not null default 1 check (revision>0),
  valid_from timestamptz not null default pg_catalog.clock_timestamp(),
  valid_until timestamptz not null,
  decision_owner_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 20 and 1000),
  revoked_at timestamptz,
  foreign key(source_id,user_id,role,native_organisation_id)
    references bx1_private.test_workspace_sources(id,user_id,role,native_organisation_id) on delete restrict,
  check (pg_catalog.isfinite(valid_from) and pg_catalog.isfinite(valid_until) and valid_until>valid_from),
  check ((status='REVOKED')=(revoked_at is not null))
);
create index bx1_test_workspace_actor on bx1_private.test_workspace_entitlements(user_id,role,native_organisation_id);
create table bx1_private.test_workspace_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  entitlement_id uuid not null references bx1_private.test_workspace_entitlements(id) on delete restrict,
  event_type text not null check (event_type in ('PROVISIONED','RENEWED','REVOKED')),
  decision_owner_user_id uuid not null references auth.users(id) on delete restrict,
  revision integer not null,
  reason text not null,
  details jsonb not null check (pg_catalog.jsonb_typeof(details)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(entitlement_id,revision)
);
create table bx1_private.test_workspace_requests (
  request_key uuid primary key,
  command text not null check (command in ('PROVISION','REVOKE')),
  payload jsonb not null,
  entitlement_id uuid not null references bx1_private.test_workspace_entitlements(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table bx1_private.test_workspace_sources enable row level security;
alter table bx1_private.test_workspace_entitlements enable row level security;
alter table bx1_private.test_workspace_events enable row level security;
alter table bx1_private.test_workspace_requests enable row level security;
revoke all on bx1_private.test_workspace_sources,bx1_private.test_workspace_entitlements,
  bx1_private.test_workspace_events,bx1_private.test_workspace_requests from public,anon,authenticated,service_role;
create trigger bx1_test_workspace_event_immutable before update or delete on bx1_private.test_workspace_events
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_test_workspace_request_immutable before update or delete on bx1_private.test_workspace_requests
  for each row execute function bx1_portal.immutable_record();

create function bx1_portal.test_workspace_environment() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.entry_configuration c
    join public.bx1_organisations o on o.id=c.reviewer_scope and o.status='ACTIVE'
    where c.singleton and c.environment='TESTNET' and c.manual_test_review
      and c.test_ordinary_entry_enabled);
$$;
create function bx1_portal.test_workspace_session() returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_environment()
    and auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    and (bx1_portal.admission_password_session() or bx1_portal.fresh_session());
$$;
create function bx1_portal.test_workspace_source_guard() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.test_workspace_environment() is not true or TG_OP='DELETE' then
    raise exception 'test_workspace_source_immutable' using errcode='23514'; end if;
  if TG_OP='UPDATE' and ((pg_catalog.to_jsonb(NEW)-'product_organisation_id')
    is distinct from (pg_catalog.to_jsonb(OLD)-'product_organisation_id')
    or OLD.product_organisation_id is not null or NEW.product_organisation_id is null) then
    raise exception 'test_workspace_source_immutable' using errcode='23514'; end if;
  if NEW.product_organisation_id is not null and (NEW.role<>'OfferingManager' or not exists(
    select 1 from bx1_portal.organisations o where o.id=NEW.product_organisation_id
      and o.test_workspace_source_id=NEW.id and o.application_id is null and o.owner_id=NEW.user_id)) then
    raise exception 'test_workspace_source_link_invalid' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_test_workspace_source_guard before insert or update or delete on bx1_private.test_workspace_sources
  for each row execute function bx1_portal.test_workspace_source_guard();
create function bx1_portal.test_workspace_organisation_guard() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='UPDATE' and NEW.test_workspace_source_id is distinct from OLD.test_workspace_source_id then
    raise exception 'test_workspace_organisation_source_immutable' using errcode='23514'; end if;
  if NEW.test_workspace_source_id is not null and (bx1_portal.test_workspace_environment() is not true
    or NEW.application_id is not null or not exists(select 1 from bx1_private.test_workspace_sources s
      where s.id=NEW.test_workspace_source_id and s.user_id=NEW.owner_id and s.role='OfferingManager'
        and s.environment='TESTNET' and s.origin='TEST_EVALUATION')) then
    raise exception 'test_workspace_organisation_source_invalid' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_test_workspace_organisation_guard before insert or update on bx1_portal.organisations
  for each row execute function bx1_portal.test_workspace_organisation_guard();
create function bx1_portal.test_workspace_decision_owner_current(target_user uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_environment() and exists(select 1 from public.bx1_memberships m
    join public.bx1_profiles p on p.id=m.user_id and p.status='ACTIVE'
    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.reviewer_scope=m.organisation_id
    join auth.users u on u.id=m.user_id where m.user_id=target_user and m.role='SuperAdmin' and m.status='ACTIVE'
      and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()));
$$;
create function bx1_portal.test_workspace_entitlement_structure(target_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_environment() and exists (
    select 1 from bx1_private.test_workspace_entitlements e
    join bx1_private.test_workspace_sources s on s.id=e.source_id and s.user_id=e.user_id
      and s.role=e.role and s.native_organisation_id=e.native_organisation_id
    join auth.users u on u.id=e.user_id
    join public.bx1_profiles p on p.id=e.user_id and p.status='ACTIVE'
    join public.bx1_organisations n on n.id=e.native_organisation_id and n.status='ACTIVE'
    join public.bx1_memberships m on m.id=e.membership_id and m.user_id=e.user_id
      and m.organisation_id=e.native_organisation_id and m.role=e.role and m.status='ACTIVE'
    where e.id=target_id
      and s.origin='TEST_EVALUATION' and s.environment='TESTNET'
      and u.email is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
      and (s.role='Investor' and s.product_organisation_id is null or s.role='OfferingManager' and exists (
        select 1 from bx1_portal.organisations o where o.id=s.product_organisation_id
          and o.test_workspace_source_id=s.id and o.application_id is null
          and o.owner_id=s.user_id and o.status='ACTIVE'))
  );
$$;
-- Provisioning may wait for confirmation; access never bypasses it.
create function bx1_portal.test_workspace_entitlement_current(target_id uuid,as_of timestamptz) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.test_workspace_entitlement_structure(target_id) and pg_catalog.isfinite(as_of)
    and exists(select 1 from bx1_private.test_workspace_entitlements e join auth.users u on u.id=e.user_id
      where e.id=target_id and e.status='ACTIVE' and e.valid_from<=as_of and e.valid_until>as_of
        and u.email_confirmed_at is not null);
$$;
create function bx1_portal.test_workspace_entitlement(c jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
  if bx1_portal.test_workspace_session() is not true or pg_catalog.jsonb_typeof(c) is distinct from 'object'
    or c->>'mode' is distinct from 'ROLE' or c-array['mode','organisationId','role']<>'{}'::jsonb
    or c->>'role' not in ('OfferingManager','Investor')
    or coalesce(c->>'organisationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  select e.id into target from bx1_private.test_workspace_entitlements e
    where e.user_id=auth.uid() and e.role=c->>'role' and e.native_organisation_id=(c->>'organisationId')::uuid
      and bx1_portal.test_workspace_entitlement_current(e.id,pg_catalog.clock_timestamp());
  return target;
end $$;
create function bx1_portal.test_workspace_projection(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_private.test_workspace_entitlements; s bx1_private.test_workspace_sources;
begin
  select * into e from bx1_private.test_workspace_entitlements where id=bx1_portal.test_workspace_entitlement(c);
  if e.id is null then return null; end if;
  select * into s from bx1_private.test_workspace_sources where id=e.source_id;
  return pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','mode','TEST_EVALUATION',
    'actor_id',auth.uid(),'entitlement_id',e.id,'revision',e.revision,'operating_context',c,
    'product_organisation_id',s.product_organisation_id,'expires_at',e.valid_until,
    'allowed_commands',case e.role when 'OfferingManager' then '["create_product","save_product","submit_product"]'::jsonb else '[]'::jsonb end,
    'allowed_views',case e.role when 'OfferingManager' then '["/portal","/portal/products","/portal/products/new","/portal/products/detail"]'::jsonb
      else '["/portal","/portal/opportunities","/portal/opportunities/detail","/portal/portfolio"]'::jsonb end);
end $$;
create function bx1_portal.test_workspace_lock(c jsonb,target_org uuid default null) returns void
language plpgsql volatile security definer set search_path='' as $$
declare grant_id uuid; e bx1_private.test_workspace_entitlements;
begin
  grant_id:=bx1_portal.test_workspace_entitlement(c);
  if grant_id is null then raise exception 'test_workspace_access_denied' using errcode='42501'; end if;
  -- The ordinary actor lock precedes product/organisation/grant locks.
  perform bx1_portal.admission_lock_actor(null,c);
  select * into e from bx1_private.test_workspace_entitlements where id=grant_id for share;
  if e.id is null or bx1_portal.test_workspace_entitlement(c) is distinct from grant_id
    or (target_org is not null and not exists(select 1 from bx1_private.test_workspace_sources
      where id=e.source_id and product_organisation_id=target_org)) then
    raise exception 'test_workspace_access_changed_after_wait' using errcode='42501'; end if;
end $$;

-- Owner-only provisioning/revocation. Neither function is an application RPC.
create function bx1_portal.provision_test_workspace_access(target_user uuid,target_role text,
  workspace_name text,valid_until timestamptz,decision_owner uuid,reason text,request_key uuid,expected_revision integer default 0)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare s bx1_private.test_workspace_sources; e bx1_private.test_workspace_entitlements;
  prior bx1_private.test_workspace_requests; body jsonb; native_id uuid; portal_id uuid; member_id uuid; now_at timestamptz;
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true then
    raise exception 'test_workspace_owner_required' using errcode='42501'; end if;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  perform u.id from auth.users u where u.id=any(array[target_user,decision_owner]) order by u.id for share;
  perform p.id from public.bx1_profiles p where p.id=any(array[target_user,decision_owner]) order by p.id for share;
  perform m.id from public.bx1_memberships m where m.user_id=decision_owner and m.role='SuperAdmin' order by m.id for share;
  perform o.id from public.bx1_organisations o join bx1_portal.entry_configuration cfg on cfg.reviewer_scope=o.id where cfg.singleton for share of o;
  now_at:=pg_catalog.clock_timestamp();
  if target_user is null or target_role not in ('OfferingManager','Investor') or target_role is null
    or workspace_name is null or workspace_name<>btrim(workspace_name) or char_length(workspace_name) not between 3 and 120
    or workspace_name ~ '[[:cntrl:]]' or reason is null or reason<>btrim(reason) or char_length(reason) not between 20 and 1000
    or valid_until is null or not pg_catalog.isfinite(valid_until) or valid_until<=now_at or valid_until>now_at+interval '30 days'
    or request_key is null or request_key='00000000-0000-0000-0000-000000000000' or expected_revision is null or expected_revision<0 then
    raise exception 'test_workspace_invalid_provision' using errcode='22023'; end if;
  if bx1_portal.test_workspace_decision_owner_current(decision_owner) is not true then
    raise exception 'test_workspace_named_owner_required' using errcode='42501'; end if;
  body:=pg_catalog.jsonb_build_object('user_id',target_user,'role',target_role,'workspace_name',workspace_name,
    'valid_until',valid_until,'decision_owner',decision_owner,'reason',reason,'expected_revision',expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_test_workspace:'||target_user::text,0));
  select * into prior from bx1_private.test_workspace_requests r where r.request_key=provision_test_workspace_access.request_key;
  if prior.request_key is not null then
    if prior.command<>'PROVISION' or prior.payload is distinct from body then raise exception 'test_workspace_idempotency_conflict' using errcode='23505'; end if;
    select * into e from bx1_private.test_workspace_entitlements where id=prior.entitlement_id;
  else
    perform id from auth.users where id=target_user for share;
    if not exists(select 1 from auth.users u where u.id=target_user and u.email is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now_at))
      or exists(select 1 from public.bx1_profiles where id=target_user and status<>'ACTIVE') then
      raise exception 'test_workspace_active_user_required' using errcode='42501'; end if;
    insert into public.bx1_profiles(id,status) values(target_user,'ACTIVE') on conflict(id) do nothing;
    perform id from public.bx1_profiles where id=target_user for share;
    select * into s from bx1_private.test_workspace_sources where user_id=target_user and role=target_role for update;
    if s.id is null then
      if expected_revision<>0 then raise exception 'test_workspace_stale_revision' using errcode='23514'; end if;
      insert into public.bx1_organisations(name,status) values('[TEST] '||workspace_name,'ACTIVE') returning id into native_id;
      insert into public.bx1_memberships(user_id,organisation_id,role,status) values(target_user,native_id,target_role,'ACTIVE') returning id into member_id;
      insert into bx1_private.test_workspace_sources(user_id,role,native_organisation_id)
        values(target_user,target_role,native_id) returning * into s;
      if target_role='OfferingManager' then
        insert into bx1_portal.organisations(application_id,owner_id,name,status,reviewer_scope,test_workspace_source_id)
          select null,target_user,'[TEST] '||workspace_name,'ACTIVE',cfg.reviewer_scope,s.id
          from bx1_portal.entry_configuration cfg where cfg.singleton returning id into portal_id;
        update bx1_private.test_workspace_sources set product_organisation_id=portal_id where id=s.id;
      end if;
      insert into bx1_private.test_workspace_entitlements(source_id,user_id,role,native_organisation_id,
        membership_id,valid_from,valid_until,decision_owner_user_id,reason)
        values(s.id,target_user,target_role,native_id,member_id,now_at,valid_until,decision_owner,reason) returning * into e;
    else
      select * into e from bx1_private.test_workspace_entitlements where source_id=s.id for update;
      if e.id is null or e.revision<>expected_revision
        or not exists(select 1 from public.bx1_organisations where id=s.native_organisation_id and status='ACTIVE')
        or not exists(select 1 from public.bx1_memberships where id=e.membership_id and status='ACTIVE') then
        raise exception 'test_workspace_stale_or_suspended' using errcode='23514'; end if;
      update bx1_private.test_workspace_entitlements set status='ACTIVE',revision=revision+1,valid_from=now_at,
        valid_until=provision_test_workspace_access.valid_until,decision_owner_user_id=decision_owner,
        reason=provision_test_workspace_access.reason,revoked_at=null where id=e.id returning * into e;
    end if;
    if bx1_portal.test_workspace_entitlement_structure(e.id) is not true then
      raise exception 'test_workspace_provision_verification_failed' using errcode='42501'; end if;
    insert into bx1_private.test_workspace_events(entitlement_id,event_type,decision_owner_user_id,revision,reason,details)
      values(e.id,case when e.revision=1 then 'PROVISIONED' else 'RENEWED' end,decision_owner,e.revision,reason,
        pg_catalog.to_jsonb(e)||pg_catalog.jsonb_build_object('origin','TEST_EVALUATION'));
    insert into bx1_private.test_workspace_requests(request_key,command,payload,entitlement_id)
      values(request_key,'PROVISION',body,e.id);
  end if;
  select * into s from bx1_private.test_workspace_sources where id=e.source_id;
  if bx1_portal.test_workspace_decision_owner_current(decision_owner) is not true then
    raise exception 'test_workspace_owner_changed_after_wait' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('entitlement_id',e.id,'revision',e.revision,'origin','TEST_EVALUATION',
    'user_id',e.user_id,'role',e.role,'native_organisation_id',e.native_organisation_id,
    'product_organisation_id',s.product_organisation_id,'status',e.status,'expires_at',e.valid_until,
    'activation_state',case when (select email_confirmed_at from auth.users where id=e.user_id) is null
      then 'AWAITING_EMAIL_CONFIRMATION' when bx1_portal.test_workspace_entitlement_current(e.id,pg_catalog.clock_timestamp())
      then 'ACTIVE' else 'REVOKED_OR_EXPIRED' end);
end $$;
create function bx1_portal.revoke_test_workspace_access(entitlement_id uuid,expected_revision integer,
  decision_owner uuid,reason text,request_key uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare e bx1_private.test_workspace_entitlements; prior bx1_private.test_workspace_requests; body jsonb; target_user uuid;
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true then
    raise exception 'test_workspace_owner_required' using errcode='42501'; end if;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  perform u.id from auth.users u where u.id=decision_owner for share;
  perform p.id from public.bx1_profiles p where p.id=decision_owner for share;
  perform m.id from public.bx1_memberships m where m.user_id=decision_owner and m.role='SuperAdmin' order by m.id for share;
  perform o.id from public.bx1_organisations o join bx1_portal.entry_configuration cfg on cfg.reviewer_scope=o.id where cfg.singleton for share of o;
  if entitlement_id is null or expected_revision is null or expected_revision<1 or decision_owner is null
    or reason is null or reason<>btrim(reason) or char_length(reason) not between 20 and 1000
    or request_key is null or request_key='00000000-0000-0000-0000-000000000000' then
    raise exception 'test_workspace_invalid_revocation' using errcode='22023'; end if;
  if bx1_portal.test_workspace_decision_owner_current(decision_owner) is not true then
    raise exception 'test_workspace_named_owner_required' using errcode='42501'; end if;
  body:=pg_catalog.jsonb_build_object('entitlement_id',entitlement_id,'expected_revision',expected_revision,
    'decision_owner',decision_owner,'reason',reason);
  select current_grant.user_id into target_user from bx1_private.test_workspace_entitlements current_grant
    where current_grant.id=revoke_test_workspace_access.entitlement_id;
  if target_user is null then raise exception 'test_workspace_entitlement_missing' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_test_workspace:'||target_user::text,0));
  select * into prior from bx1_private.test_workspace_requests r where r.request_key=revoke_test_workspace_access.request_key;
  if prior.request_key is not null then
    if prior.command<>'REVOKE' or prior.payload is distinct from body then raise exception 'test_workspace_idempotency_conflict' using errcode='23505'; end if;
    select * into e from bx1_private.test_workspace_entitlements where id=prior.entitlement_id;
  else
    select * into e from bx1_private.test_workspace_entitlements current_grant
      where current_grant.id=revoke_test_workspace_access.entitlement_id for update;
    if e.revision<>expected_revision or e.status<>'ACTIVE' then raise exception 'test_workspace_stale_revision' using errcode='23514'; end if;
    update bx1_private.test_workspace_entitlements set status='REVOKED',revision=revision+1,
      revoked_at=pg_catalog.clock_timestamp(),decision_owner_user_id=decision_owner,reason=revoke_test_workspace_access.reason
      where id=e.id returning * into e;
    insert into bx1_private.test_workspace_events(entitlement_id,event_type,decision_owner_user_id,revision,reason,details)
      values(e.id,'REVOKED',decision_owner,e.revision,reason,
        pg_catalog.to_jsonb(e)||pg_catalog.jsonb_build_object('origin','TEST_EVALUATION'));
    insert into bx1_private.test_workspace_requests(request_key,command,payload,entitlement_id)
      values(request_key,'REVOKE',body,e.id);
  end if;
  if bx1_portal.test_workspace_decision_owner_current(decision_owner) is not true then
    raise exception 'test_workspace_owner_changed_after_wait' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('entitlement_id',e.id,'revision',e.revision,'status',e.status);
end $$;

-- Copy exact installed bodies into private compatibility helpers, then replace
-- original functions in place: their OIDs/ACLs/owners remain unchanged.
do $$
declare spec text[]; original_name text; backup_name text; signature text; definition text; old_prefix text;
begin
  foreach spec slice 1 in array array[
    ['native_membership_effective_at','uuid,timestamp with time zone'],
    ['offering_workflow_manager_current','uuid,uuid,uuid'],
    ['offering_workflow_operator','jsonb,uuid'],
    ['offering_workflow_context','jsonb'],
    ['offering_workflow_command_allowed','jsonb,text'],
    ['offering_workflow_product_visible','jsonb,uuid'],
    ['offering_workflow_lock_organisation','jsonb,uuid'],
    ['offering_workflow_lock_product','jsonb,uuid'],
    ['offering_workflow_read_scoped','jsonb'],
    ['offering_workflow_parent_command','jsonb,text,uuid,jsonb'],
    ['read_scoped','jsonb'],['entry_read',''],['execute_scoped','jsonb,text,uuid,jsonb']
  ] loop
    original_name:=spec[1]; signature:='bx1_portal.'||original_name||'('||spec[2]||')';
    backup_name:=original_name||'_pre_test_workspace';
    if pg_catalog.to_regprocedure(signature) is null or pg_catalog.to_regprocedure('bx1_portal.'||backup_name||'('||spec[2]||')') is not null
      or (select proowner from pg_catalog.pg_proc where oid=signature::regprocedure)<>'postgres'::regrole then
      raise exception 'test_workspace_function_baseline_changed' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(signature::regprocedure);
    old_prefix:='CREATE OR REPLACE FUNCTION bx1_portal.'||original_name||'(';
    if pg_catalog.strpos(definition,old_prefix)<>1 then raise exception 'test_workspace_function_shape_changed' using errcode='55000'; end if;
    execute 'CREATE OR REPLACE FUNCTION bx1_portal.'||backup_name||'('||pg_catalog.substr(definition,char_length(old_prefix)+1);
    execute pg_catalog.format('revoke all on function bx1_portal.%I(%s) from public,anon,authenticated,service_role',backup_name,spec[2]);
  end loop;
end $$;
-- Hosted funding wrappers retain the original product authority as execute_scoped_p2.
-- Select the sole exact-marker body, not a nominal alias that may be financial.
-- These two lane conditions are the entire change; terms/envelope/deployment,
-- revision, idempotency, audit and downstream business guards remain byte-exact.
do $test_workspace_product_lane$
declare target oid; candidates oid[]; source_body text; next_body text; definition text; fn_name text;
  old_condition text:='bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_allowed(c,action)';
  new_condition text:='(bx1_portal.admission_password_session() or bx1_portal.test_workspace_entitlement(c) is not null) and bx1_portal.offering_workflow_command_allowed(c,action)';
  before_metadata jsonb; after_metadata jsonb;
begin
  select pg_catalog.array_agg(p.oid order by p.oid) into candidates
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and left(p.proname,14)='execute_scoped'
      and right(p.proname,19)<>'_pre_test_workspace' and p.proargtypes='3802 25 2950 3802'::oidvector
      and pg_catalog.strpos(p.prosrc,'ignored:=bx1_portal.offering_workflow_base_command(c,action,key,forwarded);')>0;
  if coalesce(pg_catalog.cardinality(candidates),0)<>1 then
    raise exception 'test_workspace_product_lane_ambiguous' using errcode='55000'; end if;
  target:=candidates[1];
  select p.prosrc,p.proname,pg_catalog.to_jsonb(p)-'prosrc' into source_body,fn_name,before_metadata
    from pg_catalog.pg_proc p where p.oid=target;
  if before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
    or before_metadata->>'prosecdef' is distinct from 'true'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      <>'cf57f545044f1ac0e547ab4e7aa7f2e52bf466ba81350e35d77639e9019b3279'
    or (char_length(source_body)-char_length(pg_catalog.replace(source_body,old_condition,'')))/char_length(old_condition)<>2 then
    raise exception 'test_workspace_product_lane_baseline_changed' using errcode='55000'; end if;
  if pg_catalog.to_regprocedure('bx1_portal.'||fn_name||'_pre_test_workspace(jsonb,text,uuid,jsonb)') is not null then
    raise exception 'test_workspace_product_lane_backup_exists' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||fn_name||'(')<>1 then
    raise exception 'test_workspace_product_lane_definition_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||fn_name||'(',
    'CREATE OR REPLACE FUNCTION bx1_portal.'||fn_name||'_pre_test_workspace(');
  execute pg_catalog.format('revoke all on function bx1_portal.%I(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role',fn_name||'_pre_test_workspace');
  next_body:=pg_catalog.replace(source_body,old_condition,new_condition);
  if pg_catalog.replace(next_body,new_condition,old_condition) is distinct from source_body then
    raise exception 'test_workspace_product_lane_not_reversible' using errcode='55000'; end if;
  execute pg_catalog.replace(definition,old_condition,new_condition);
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
  if after_metadata is distinct from before_metadata
    or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
    raise exception 'test_workspace_product_lane_metadata_changed' using errcode='55000'; end if;
end $test_workspace_product_lane$;
create or replace function bx1_portal.native_membership_effective_at(target_membership uuid,as_of timestamptz) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when exists(select 1 from bx1_private.test_workspace_entitlements where membership_id=target_membership)
    then exists(select 1 from bx1_private.test_workspace_entitlements e where e.membership_id=target_membership
      and bx1_portal.test_workspace_entitlement_current(e.id,as_of))
    else bx1_portal.native_membership_effective_at_pre_test_workspace(target_membership,as_of) end;
$$;
create or replace function bx1_portal.offering_workflow_manager_current(actor uuid,target_org uuid,native_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when exists(select 1 from bx1_portal.organisations where id=target_org and test_workspace_source_id is not null)
    then actor=auth.uid() and exists(select 1 from bx1_private.test_workspace_entitlements e
      join bx1_private.test_workspace_sources s on s.id=e.source_id
      where e.id=bx1_portal.test_workspace_entitlement(pg_catalog.jsonb_build_object('mode','ROLE','organisationId',native_org,'role','OfferingManager'))
        and s.product_organisation_id=target_org and e.user_id=actor)
    else bx1_portal.offering_workflow_manager_current_pre_test_workspace(actor,target_org,native_org) end;
$$;
create or replace function bx1_portal.offering_workflow_command_allowed(c jsonb,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.test_workspace_entitlement(c) is not null
    then c->>'role'='OfferingManager' and action=any(array['create_product','save_product','submit_product'])
    else bx1_portal.offering_workflow_command_allowed_pre_test_workspace(c,action) end;
$$;
-- STANDARD/AAL2 normally delegates to scoped_operator. Evaluation authority is
-- deliberately confined to this offering-only gate, not generic org readiness.
create or replace function bx1_portal.offering_workflow_operator(c jsonb,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.test_workspace_entitlement(c) is not null
    then c->>'mode'='ROLE' and c->>'role'='OfferingManager'
      and bx1_portal.offering_workflow_manager_current(auth.uid(),target_org,(c->>'organisationId')::uuid)
    else bx1_portal.offering_workflow_operator_pre_test_workspace(c,target_org) end;
$$;
create or replace function bx1_portal.offering_workflow_context(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.test_workspace_entitlement(c) is not null
    then c->>'role'='OfferingManager' and bx1_portal.offering_workflow_person_current(auth.uid())
    else bx1_portal.offering_workflow_context_pre_test_workspace(c) end;
$$;
create or replace function bx1_portal.offering_workflow_product_visible(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.test_workspace_entitlement(c) is not null
    then c->>'role'='OfferingManager' and exists(select 1 from bx1_portal.products p
      where p.id=target_product and bx1_portal.offering_workflow_operator(c,p.organisation_id))
    else bx1_portal.offering_workflow_product_visible_pre_test_workspace(c,target_product) end;
$$;
create or replace function bx1_portal.offering_workflow_lock_organisation(c jsonb,target_org uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if exists(select 1 from bx1_portal.organisations where id=target_org and test_workspace_source_id is not null) then
    perform id from bx1_portal.organisations where id=target_org for share;
    perform bx1_portal.test_workspace_lock(c,target_org);
    if c->>'role' is distinct from 'OfferingManager' or bx1_portal.offering_workflow_operator(c,target_org) is not true then
      raise exception 'test_workspace_product_authority_denied' using errcode='42501'; end if;
    return;
  end if;
  perform bx1_portal.offering_workflow_lock_organisation_pre_test_workspace(c,target_org);
end $$;
create or replace function bx1_portal.offering_workflow_lock_product(c jsonb,target_product uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare target_org uuid;
begin
  select p.organisation_id into target_org from bx1_portal.products p join bx1_portal.organisations o on o.id=p.organisation_id
    where p.id=target_product and o.test_workspace_source_id is not null;
  if target_org is not null then
    perform id from bx1_portal.products where id=target_product for update;
    perform bx1_portal.offering_workflow_lock_organisation(c,target_org);
    if not exists(select 1 from bx1_portal.products where id=target_product and organisation_id=target_org) then
      raise exception 'test_workspace_product_changed_after_wait' using errcode='42501'; end if;
    return;
  end if;
  perform bx1_portal.offering_workflow_lock_product_pre_test_workspace(c,target_product);
end $$;

create function bx1_portal.test_workspace_read(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; access jsonb; commands jsonb; products jsonb; organisations jsonb;
begin
  perform bx1_portal.test_workspace_lock(c);
  access:=bx1_portal.test_workspace_projection(c);
  if access is null then raise exception 'test_workspace_read_denied' using errcode='42501'; end if;
  commands:=access->'allowed_commands';
  if c->>'role'='OfferingManager' then
    result:=bx1_portal.offering_workflow_read_scoped_pre_test_workspace(c);
    select coalesce(pg_catalog.jsonb_agg(o.value||pg_catalog.jsonb_build_object('authority_source','TEST_EVALUATION',
      'capabilities',commands) order by o.ordinality),'[]'::jsonb) into organisations
      from pg_catalog.jsonb_array_elements(result->'organisations') with ordinality o(value,ordinality);
    select coalesce(pg_catalog.jsonb_agg(p.value||pg_catalog.jsonb_build_object('allowed_actions',
      coalesce((select pg_catalog.jsonb_agg(a.value) from pg_catalog.jsonb_array_elements(coalesce(p.value->'allowed_actions','[]'::jsonb)) a(value)
        where commands @> pg_catalog.jsonb_build_array(a.value)),'[]'::jsonb)) order by p.ordinality),'[]'::jsonb) into products
      from pg_catalog.jsonb_array_elements(result->'products') with ordinality p(value,ordinality);
    result:=pg_catalog.jsonb_set(pg_catalog.jsonb_set(result,'{organisations}',organisations),'{products}',products);
    result:=pg_catalog.jsonb_set(result,'{offering_access,allowed_commands}',commands);
    if bx1_portal.admission_password_session() is not true then result:=result-'offering_access'; end if;
    result:=result||pg_catalog.jsonb_build_object('product_appointments','[]'::jsonb,'product_appointment_candidates','[]'::jsonb);
  else
    -- Public offering terms only. Neither unapproved drafts nor customer private
    -- evidence become visible through this catalogue. No order action granted.
    select coalesce(pg_catalog.jsonb_agg((pg_catalog.to_jsonb(p)-array['cap_units','minimum_units','unit_price_minor'])
      ||pg_catalog.jsonb_build_object('reserved_units',p.reserved_units::text,'allowed_actions','[]'::jsonb,
        'offering_package',bx1_portal.offering_package_projection(c,p.id)) order by p.created_at,p.id),'[]'::jsonb) into products
      from bx1_portal.products p where p.status='PUBLISHED' and bx1_portal.offering_approved(p.id)
        and bx1_portal.offering_operational(p.id)
        and bx1_portal.current_product_organisation(p.organisation_id);
    select pg_catalog.jsonb_build_object('operating_context',c,
      'actor',pg_catalog.jsonb_build_object('id',auth.uid(),'email',u.email,
        'display_name',(select display_name from public.bx1_profiles where id=auth.uid()),'can_review',false),
      'products',products,'applications','[]'::jsonb,'organisations','[]'::jsonb,
      'accounts','[]'::jsonb,'entity_investment_accounts','[]'::jsonb,'subscriptions','[]'::jsonb,
      'events','[]'::jsonb,'requests','[]'::jsonb,'organisation_mandates','[]'::jsonb,
      'investing_representative_mandates','[]'::jsonb,'product_eligibility','[]'::jsonb,
      'entity_product_eligibility','[]'::jsonb,'product_appointments','[]'::jsonb,
      'product_appointment_candidates','[]'::jsonb,'customer_monitoring','[]'::jsonb,
      'stage2_access',pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','actor_id',auth.uid(),
        'operating_context',c,'session_mode',case when bx1_portal.admission_password_session() then 'TEST_PASSWORD' else 'STANDARD' end,
        'allowed_commands','[]'::jsonb)) into result from auth.users u where u.id=auth.uid();
  end if;
  if bx1_portal.test_workspace_projection(c) is distinct from access then
    raise exception 'test_workspace_read_authority_changed' using errcode='42501'; end if;
  return result||pg_catalog.jsonb_build_object('evaluation_access',access);
end $$;
-- Existing writers return this same reader, so saved command responses retain
-- the authoritative evaluation marker instead of an unrelated authority source.
create or replace function bx1_portal.offering_workflow_read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.test_workspace_entitlement(c) is not null then return bx1_portal.test_workspace_read(c); end if;
  return bx1_portal.offering_workflow_read_scoped_pre_test_workspace(c);
end $$;
create or replace function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.test_workspace_entitlement(c) is not null then return bx1_portal.test_workspace_read(c); end if;
  return bx1_portal.read_scoped_pre_test_workspace(c);
end $$;
-- Enforce the capability list at the canonical DB command boundary too. A
-- direct RPC, an AAL2 session or a client-supplied role cannot widen this scope.
create or replace function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if c->>'mode'='ROLE' and exists(select 1 from bx1_private.test_workspace_sources s
    where s.native_organisation_id::text=c->>'organisationId') then
    if bx1_portal.test_workspace_entitlement(c) is null or c->>'role' is distinct from 'OfferingManager'
      or action is null or action not in ('create_product','save_product','submit_product') then
      raise exception 'test_workspace_command_denied' using errcode='42501'; end if;
    perform bx1_portal.test_workspace_lock(c);
    return bx1_portal.offering_workflow_command(c,action,key,body);
  end if;
  return bx1_portal.execute_scoped_pre_test_workspace(c,action,key,body);
end $$;
create or replace function bx1_portal.offering_workflow_parent_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.test_workspace_entitlement(c) is not null then
    if c->>'role' is distinct from 'OfferingManager' or action is null or action not in ('save_product','submit_product')
      or bx1_portal.offering_workflow_command_allowed(c,action) is not true then
      raise exception 'test_workspace_parent_command_denied' using errcode='42501'; end if;
    perform bx1_portal.test_workspace_lock(c);
    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);
  end if;
  return bx1_portal.offering_workflow_parent_command_pre_test_workspace(c,action,key,body);
end $$;
create or replace function bx1_portal.entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; grants jsonb;
begin
  result:=bx1_portal.entry_read_pre_test_workspace();
  select coalesce(pg_catalog.jsonb_agg(p.value order by e.role,e.native_organisation_id),'[]'::jsonb) into grants
    from bx1_private.test_workspace_entitlements e cross join lateral (
      select bx1_portal.test_workspace_projection(pg_catalog.jsonb_build_object('mode','ROLE',
        'organisationId',e.native_organisation_id,'role',e.role)) value) p
    where e.user_id=auth.uid() and p.value is not null;
  return result||pg_catalog.jsonb_build_object('evaluation_access',grants);
end $$;

-- All added helpers are private. Preserve ACLs on replaced public-name readers;
-- do not expose the owner provisioner, private grant table or compatibility bodies.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and (left(p.proname,15)='test_workspace_' or right(p.proname,19)='_pre_test_workspace'
      or p.proname in ('provision_test_workspace_access','revoke_test_workspace_access')) loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
