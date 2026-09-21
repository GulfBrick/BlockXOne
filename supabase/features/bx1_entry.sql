-- Stage 1 additive identity-entry cutover. Apply atomically after bx1_portal.sql,
-- 20260921160000_portal_authority_accounts.sql and bx1_portal_funding.sql.
-- No people, roles, memberships, review routes, money or contract records seeded.
-- Existing IDs, revisions, decisions and denomination history remain unchanged.
-- A privileged release owner must separately admit a TESTNET-only manual route;
-- absent configuration is closed. MAINNET cannot admit the legacy manual route.

alter table bx1_portal.applications drop constraint applications_user_id_key;
alter table bx1_portal.applications alter column reviewer_scope drop not null;
alter table bx1_portal.applications add column context_kind text not null default 'PERSONAL'
  check(context_kind in ('PERSONAL','ORGANISATION'));
alter table bx1_portal.applications add column context_organisation_id uuid
  references public.bx1_organisations(id) on delete restrict;
alter table bx1_portal.applications add column origin text not null default 'LEGACY'
  check(origin in ('LEGACY','SIGNUP','SELF_SERVICE'));
-- The original feature did not record draft creation times. Preserve unknown
-- history as null rather than inventing a timestamp during migration.
alter table bx1_portal.applications add column created_at timestamptz;
alter table bx1_portal.applications alter column created_at set default clock_timestamp();
alter table bx1_portal.applications add constraint bx1_application_context_shape
  check((context_kind='PERSONAL')=(context_organisation_id is null));
alter table bx1_portal.applications add constraint bx1_application_review_routing
  check(status='DRAFT' or reviewer_scope is not null);
alter table bx1_portal.applications drop constraint applications_provider_mode_check;
alter table bx1_portal.applications add constraint applications_provider_mode_check
  check(provider_mode in ('UNASSIGNED','MANUAL_TEST_REVIEW'));
alter table bx1_portal.applications alter column provider_mode set default 'UNASSIGNED';
create unique index bx1_application_personal_capacity on bx1_portal.applications(user_id,persona)
  where context_kind='PERSONAL';
create unique index bx1_application_organisation_capacity
  on bx1_portal.applications(user_id,persona,context_organisation_id) where context_kind='ORGANISATION';

create table bx1_portal.entry_configuration (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('TESTNET','MAINNET')),
  manual_test_review boolean not null default false,
  reviewer_scope uuid references public.bx1_organisations(id) on delete restrict,
  admission_reference text not null check(char_length(btrim(admission_reference)) between 10 and 400),
  -- This cutover preserves the one existing rehearsal route. Stage 2 replaces
  -- it with separately admitted organisation, eligibility and mandate queues.
  check(not manual_test_review or (environment='TESTNET' and reviewer_scope is not null
    and reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e'::uuid))
);
create table bx1_portal.entry_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null, command text not null, payload jsonb not null,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_key)
);
alter table bx1_portal.entry_configuration enable row level security;
alter table bx1_portal.entry_requests enable row level security;
revoke all on bx1_portal.entry_configuration,bx1_portal.entry_requests from public,anon,authenticated,service_role;
create trigger bx1_entry_request_immutable before update or delete on bx1_portal.entry_requests
  for each row execute function bx1_portal.immutable_record();

create function bx1_portal.guard_application_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' or row(NEW.id,NEW.user_id,NEW.persona,NEW.context_kind,NEW.context_organisation_id,NEW.origin,NEW.created_at)
    is distinct from row(OLD.id,OLD.user_id,OLD.persona,OLD.context_kind,OLD.context_organisation_id,OLD.origin,OLD.created_at) then
    raise exception 'entry_application_identity_immutable' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger bx1_application_identity_immutable before update or delete on bx1_portal.applications
  for each row execute function bx1_portal.guard_application_identity();

create function bx1_portal.entry_manual_review_enabled() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.entry_configuration c join public.bx1_organisations o on o.id=c.reviewer_scope
    where c.singleton and c.environment='TESTNET' and c.manual_test_review and o.status='ACTIVE');
$$;
create function bx1_portal.entry_context_available(target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fresh_session() and exists(
    select 1 from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
    join public.bx1_organisations o on o.id=m.organisation_id
    where m.user_id=auth.uid() and m.organisation_id=target_org
      and m.status='ACTIVE' and p.status='ACTIVE' and o.status='ACTIVE');
$$;
create function bx1_portal.entry_lock_actor() returns void
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_required' using errcode='42501'; end if;
  -- Same lock namespace as every existing portal writer, not a competing writer.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));
  perform id from auth.users where id=v_actor for share;
  perform id from auth.sessions where user_id=v_actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=v_actor for share;
  perform id from auth.mfa_factors where user_id=v_actor for share;
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_changed' using errcode='42501'; end if;
end $$;
create function bx1_portal.entry_require_context(target_org uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if target_org is null then return; end if;
  perform id from public.bx1_organisations where id=target_org for share;
  perform id from public.bx1_memberships where user_id=auth.uid() and organisation_id=target_org for share;
  if bx1_portal.entry_context_available(target_org) is not true then
    raise exception 'entry_context_denied' using errcode='42501';
  end if;
end $$;

create function bx1_portal.entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); result jsonb;
begin
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_required' using errcode='42501'; end if;
  select jsonb_build_object('entry_version',1,'actor',jsonb_build_object('id',u.id,'email',u.email),
    'applications',coalesce((select jsonb_agg(to_jsonb(a)-'reviewer_scope' order by a.created_at nulls first,a.id)
      from bx1_portal.applications a where a.user_id=v_actor),'[]'::jsonb),
    'contexts',coalesce((select jsonb_agg(jsonb_build_object('context_key',o.id,'organisation_id',o.id,'name',o.name,'roles',o.roles) order by o.name,o.id)
      from (select org.id,org.name,jsonb_agg(m.role order by m.role) roles
        from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
        join public.bx1_organisations org on org.id=m.organisation_id
        where m.user_id=v_actor and m.status='ACTIVE' and p.status='ACTIVE' and org.status='ACTIVE'
        group by org.id,org.name) o),'[]'::jsonb),
    'admission',jsonb_build_object('manual_test_review',bx1_portal.entry_manual_review_enabled()))
    into result from auth.users u where u.id=v_actor;
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_changed' using errcode='42501'; end if;
  return result;
end $$;

-- Mutable signup metadata is an initial preference only. Snapshot on INSERT,
-- never on metadata UPDATE; it creates no profile, membership or eligibility.
create function bx1_portal.snapshot_signup_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_persona text; v_id uuid;
begin
  v_persona:=case NEW.raw_user_meta_data->>'portal_intent'
    when 'investor' then 'INVESTOR' when 'wealth-manager' then 'WEALTH_MANAGER' end;
  if v_persona is null then return NEW; end if;
  insert into bx1_portal.applications(user_id,persona,status,details,context_kind,origin,provider_mode)
    values(NEW.id,v_persona,'DRAFT','{}','PERSONAL','SIGNUP','UNASSIGNED')
    on conflict do nothing returning id into v_id;
  if v_id is not null then
    insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
      values(v_id,v_id,'start_application',NEW.id,'Initial signup preference recorded as an unapproved personal application.');
  end if;
  return NEW;
end $$;
create trigger bx1_entry_signup_capacity after insert on auth.users
  for each row execute function bx1_portal.snapshot_signup_capacity();

-- The sole submission mutation used by new and legacy interfaces. All callers
-- already hold the actor lock; the exact immutable application is locked here.
create function bx1_portal.entry_submit(target_application uuid, expected_revision integer, details jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; v_scope uuid; v_now timestamptz;
begin
  select * into a from bx1_portal.applications where id=target_application and user_id=auth.uid() for update;
  if not found then raise exception 'entry_application_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_require_context(a.context_organisation_id);
  -- Stage 2 admits representative and provider routes. Never send organisation
  -- drafts through the legacy customer-owner review path as an approximation.
  if a.context_kind<>'PERSONAL' then raise exception 'entry_representative_route_unavailable' using errcode='55000'; end if;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  select reviewer_scope into v_scope from bx1_portal.entry_configuration
    where singleton and environment='TESTNET' and manual_test_review;
  if v_scope is not null then perform id from public.bx1_organisations where id=v_scope for share; end if;
  if v_scope is null or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'entry_review_route_unavailable' using errcode='55000';
  end if;
  if a.reviewer_scope is not null and a.reviewer_scope is distinct from v_scope then
    raise exception 'entry_review_scope_changed' using errcode='55000';
  end if;
  if a.status not in ('DRAFT','CHANGES_REQUIRED','REJECTED') or a.revision is distinct from expected_revision then
    raise exception 'entry_stale_application' using errcode='23514';
  end if;
  perform bx1_portal.validate_application(details,a.persona);
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_changed' using errcode='42501'; end if;
  v_now:=clock_timestamp();
  update bx1_portal.applications set status='SUBMITTED',revision=revision+1,details=entry_submit.details,
    reviewer_scope=v_scope,provider_mode='MANUAL_TEST_REVIEW',submitted_at=v_now,
    reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}',approved_until=null
    where id=a.id;
  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
    values(a.id,a.id,'submit_application',auth.uid(),'Exact personal application submitted to the admitted synthetic manual-review route.');
  return a.id;
end $$;

create function bx1_portal.entry_command(command text, request_key uuid, payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); r bx1_portal.entry_requests; a bx1_portal.applications; v_org uuid; v_id uuid;
begin
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000'
    or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>65536 then
    raise exception 'entry_invalid_command' using errcode='22023';
  end if;
  perform bx1_portal.entry_lock_actor();
  select * into r from bx1_portal.entry_requests where actor_id=v_actor and entry_requests.request_key=entry_command.request_key;
  if found then
    if r.command is distinct from command or r.payload is distinct from payload then
      raise exception 'entry_idempotency_conflict' using errcode='23505';
    end if;
    select * into a from bx1_portal.applications where id=r.application_id;
    perform bx1_portal.entry_require_context(a.context_organisation_id);
    return bx1_portal.entry_read();
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=v_actor and requests.request_key=entry_command.request_key)
    or exists(select 1 from bx1_portal.scoped_requests where actor_id=v_actor and scoped_requests.request_key=entry_command.request_key) then
    raise exception 'entry_legacy_key_conflict' using errcode='23505';
  end if;
  if command='start_application' then
    if payload ? 'context_key' then perform bx1_portal.require_keys(payload,array['persona','context_key']);
    else perform bx1_portal.require_keys(payload,array['persona']); end if;
    if coalesce(payload->>'persona','') not in ('INVESTOR','WEALTH_MANAGER') then
      raise exception 'entry_invalid_persona' using errcode='22023';
    end if;
    if payload ? 'context_key' then
      if jsonb_typeof(payload->'context_key') is distinct from 'string' or payload->>'context_key' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'entry_invalid_context' using errcode='22023'; end if;
      v_org:=(payload->>'context_key')::uuid;
      perform bx1_portal.entry_require_context(v_org);
    end if;
    select * into a from bx1_portal.applications where user_id=v_actor and persona=payload->>'persona'
      and context_organisation_id is not distinct from v_org;
    if found then v_id:=a.id;
    else
      insert into bx1_portal.applications(user_id,persona,status,details,context_kind,context_organisation_id,origin,provider_mode)
        values(v_actor,payload->>'persona','DRAFT','{}',case when v_org is null then 'PERSONAL' else 'ORGANISATION' end,v_org,'SELF_SERVICE','UNASSIGNED')
        returning id into v_id;
      insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
        values(v_id,v_id,command,v_actor,'Additional unapproved application capacity created; no role or eligibility granted.');
    end if;
  elsif command='submit_application' then
    perform bx1_portal.require_keys(payload,array['application_id','expected_revision','details']);
    if jsonb_typeof(payload->'application_id') is distinct from 'string' or payload->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'entry_invalid_application' using errcode='22023'; end if;
    v_id:=bx1_portal.entry_submit((payload->>'application_id')::uuid,(payload->>'expected_revision')::integer,payload->'details');
  else raise exception 'entry_unknown_command' using errcode='22023'; end if;
  insert into bx1_portal.entry_requests(actor_id,request_key,command,payload,application_id)
    values(v_actor,request_key,command,payload,v_id);
  return bx1_portal.entry_read();
end $$;

-- Cut over the legacy base submit path only. Scoped authority/account wrappers
-- and their funding wrappers keep calling this name; no outer writer is replaced.
alter function bx1_portal.execute_command(text,uuid,jsonb) rename to execute_command_pre_entry;
-- PL/pgSQL's implicit parameter label follows the function name. Update that
-- one qualified reference after rename; abort on an unexpected legacy body.
do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure);
  if (length(definition)-length(replace(definition,'execute_command.request_key','')))/length('execute_command.request_key')<>1 then
    raise exception 'entry_legacy_writer_definition_changed' using errcode='55000';
  end if;
  execute replace(definition,'execute_command.request_key','execute_command_pre_entry.request_key');
end $$;
create function bx1_portal.execute_command(command text, request_key uuid, payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); r bx1_portal.requests; a bx1_portal.applications; v_id uuid;
begin
  if command='review_application' and bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'entry_review_route_unavailable' using errcode='55000';
  end if;
  if command<>'submit_application' then return bx1_portal.execute_command_pre_entry(command,request_key,payload); end if;
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(payload) is distinct from 'object'
    or octet_length(payload::text)>65536 then raise exception 'entry_invalid_command' using errcode='22023'; end if;
  perform bx1_portal.entry_lock_actor();
  select * into r from bx1_portal.requests where actor_id=v_actor and requests.request_key=execute_command.request_key;
  if found then
    if r.command is distinct from command or r.payload is distinct from payload then raise exception 'entry_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_state();
  end if;
  if exists(select 1 from bx1_portal.entry_requests where actor_id=v_actor and entry_requests.request_key=execute_command.request_key) then
    raise exception 'entry_key_conflict' using errcode='23505'; end if;
  perform bx1_portal.require_keys(payload,array['persona','expected_revision','details']);
  if coalesce(payload->>'persona','') not in ('INVESTOR','WEALTH_MANAGER') or jsonb_typeof(payload->'expected_revision') is distinct from 'number'
    or payload->>'expected_revision' !~ '^[0-9]{1,9}$' then raise exception 'entry_invalid_application' using errcode='22023'; end if;
  select * into a from bx1_portal.applications where user_id=v_actor and persona=payload->>'persona' and context_kind='PERSONAL' for update;
  if not found then
    if (payload->>'expected_revision')::integer<>0 then raise exception 'entry_stale_application' using errcode='23514'; end if;
    insert into bx1_portal.applications(user_id,persona,status,details,origin,provider_mode)
      values(v_actor,payload->>'persona','DRAFT','{}','SELF_SERVICE','UNASSIGNED') returning * into a;
    v_id:=bx1_portal.entry_submit(a.id,a.revision,payload->'details');
  else
    v_id:=bx1_portal.entry_submit(a.id,(payload->>'expected_revision')::integer,payload->'details');
  end if;
  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,request_key,command,payload);
  return bx1_portal.read_state();
end $$;

create function public.bx1_entry_read() returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.entry_read(); $$;
create function public.bx1_entry_command(command text,request_key uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.entry_command(command,request_key,payload); $$;
revoke all on function bx1_portal.guard_application_identity(),bx1_portal.entry_manual_review_enabled(),
  bx1_portal.entry_context_available(uuid),bx1_portal.entry_lock_actor(),bx1_portal.entry_require_context(uuid),
  bx1_portal.entry_read(),bx1_portal.snapshot_signup_capacity(),bx1_portal.entry_submit(uuid,integer,jsonb),
  bx1_portal.entry_command(text,uuid,jsonb),bx1_portal.execute_command_pre_entry(text,uuid,jsonb),
  bx1_portal.execute_command(text,uuid,jsonb),public.bx1_entry_read(),public.bx1_entry_command(text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function bx1_portal.entry_read(),bx1_portal.entry_command(text,uuid,jsonb),
  public.bx1_entry_read(),public.bx1_entry_command(text,uuid,jsonb) to authenticated;
