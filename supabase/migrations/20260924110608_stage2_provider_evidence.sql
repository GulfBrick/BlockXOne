-- Stage 2 provider evidence boundary. The same tables/RPC signatures install
-- in TEST and sealed MAIN. Only TEST sandbox writes are admitted in this
-- increment; MAIN provider actions require a separate reviewed live adapter.
-- Provider webhooks are evidence for a separate human decision, never an
-- application/account/role writer.
-- The restricted LOGIN/password and Sumsub sandbox configuration are admitted
-- separately; neither is created or guessed by this migration.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_portal.applications') is null
    or pg_catalog.to_regclass('bx1_portal.entry_configuration') is null
    or pg_catalog.to_regprocedure('bx1_portal.has_session()') is null
    or pg_catalog.to_regprocedure('bx1_portal.is_reviewer(uuid)') is null
    then raise exception 'stage2_provider_baseline_required' using errcode='55000'; end if;
end $$;

create role bx1_provider_evidence_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema bx1_private to bx1_provider_evidence_writer;

create table bx1_private.provider_application_bindings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider text not null check(provider='SUMSUB'),
  environment text not null check(environment in ('TESTNET','MAINNET')),
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  actor_id uuid not null references auth.users(id) on delete restrict,
  external_user_id text not null unique check(pg_catalog.char_length(external_user_id) between 45 and 100),
  created_at timestamptz not null default clock_timestamp(),
  unique(provider,environment,application_id,application_revision)
);
create index bx1_provider_binding_application on bx1_private.provider_application_bindings(application_id,application_revision);

create table bx1_private.provider_evidence_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  binding_id uuid not null references bx1_private.provider_application_bindings(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  provider text not null check(provider='SUMSUB'),
  environment text not null check(environment in ('TESTNET','MAINNET')),
  provider_applicant_id text not null check(pg_catalog.char_length(provider_applicant_id) between 8 and 100),
  provider_event_type text not null check(provider_event_type ~ '^applicant[A-Za-z]{3,60}$'),
  provider_correlation_id text check(provider_correlation_id is null or pg_catalog.char_length(provider_correlation_id) between 1 and 150),
  provider_client_id text not null check(pg_catalog.char_length(provider_client_id) between 1 and 150),
  event_at timestamptz not null check(pg_catalog.isfinite(event_at)),
  received_at timestamptz not null default clock_timestamp(),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  semantic_sha256 text not null check(semantic_sha256 ~ '^[0-9a-f]{64}$'),
  review_status text check(review_status is null or pg_catalog.char_length(review_status) between 1 and 60),
  review_answer text check(review_answer is null or pg_catalog.char_length(review_answer) between 1 and 60),
  review_reject_type text check(review_reject_type is null or pg_catalog.char_length(review_reject_type) between 1 and 60),
  manual_webhook_test boolean not null,
  ordering_state text not null check(ordering_state in ('CURRENT','STALE','MANUAL_TEST')),
  unique(binding_id,payload_sha256),
  unique(binding_id,semantic_sha256)
);
create index bx1_provider_evidence_application on bx1_private.provider_evidence_events(application_id,application_revision,event_at desc,id);
create index bx1_provider_evidence_ordering on bx1_private.provider_evidence_events(binding_id,ordering_state,event_at desc);

alter table bx1_private.provider_application_bindings enable row level security;
alter table bx1_private.provider_evidence_events enable row level security;
revoke all on bx1_private.provider_application_bindings,bx1_private.provider_evidence_events
  from public,anon,authenticated,service_role,bx1_provider_evidence_writer;
create trigger bx1_provider_binding_immutable before update or delete on bx1_private.provider_application_bindings
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_provider_event_immutable before update or delete on bx1_private.provider_evidence_events
  for each row execute function bx1_portal.immutable_record();

-- The server derives actor and session from a verified Supabase login; this
-- independent database check prevents a stale/revoked session from binding.
create function bx1_private.provider_session_current(p_actor uuid,p_session uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select p_actor is not null and p_session is not null and exists(
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_actor and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>clock_timestamp())
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and not exists(select 1 from public.bx1_profiles p where p.id=p_actor and p.status<>'ACTIVE')
      and (not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.status::text='verified')
        or (s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f
          where f.id=s.factor_id and f.user_id=p_actor and f.status::text='verified'))));
$$;

create function bx1_private.bind_provider_application(
  p_actor uuid,p_session uuid,p_application uuid,p_revision integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; b bx1_private.provider_application_bindings; env text;
begin
  select environment into env from bx1_portal.entry_configuration where singleton;
  if env is distinct from 'TESTNET' then raise exception 'provider_environment_not_admitted' using errcode='42501'; end if;
  perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;
  if bx1_private.provider_session_current(p_actor,p_session) is not true then
    raise exception 'provider_session_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=p_application for share;
  if a.id is null or a.user_id is distinct from p_actor or a.revision is distinct from p_revision
    or a.context_kind<>'PERSONAL' or a.status not in ('DRAFT','SUBMITTED','CHANGES_REQUIRED')
    or a.admission_purpose not in ('INVESTOR_ADMISSION','CUSTOMER_ORGANISATION_ADMISSION') then
    raise exception 'provider_application_denied' using errcode='42501'; end if;
  insert into bx1_private.provider_application_bindings
    (provider,environment,application_id,application_revision,actor_id,external_user_id)
    values('SUMSUB','TESTNET',a.id,a.revision,p_actor,'bx1:testnet:'||a.id::text||':r'||a.revision::text)
    on conflict(provider,environment,application_id,application_revision) do nothing;
  select * into b from bx1_private.provider_application_bindings
    where provider='SUMSUB' and environment='TESTNET' and application_id=a.id
      and application_revision=a.revision for share;
  if b.id is null or b.actor_id is distinct from p_actor then
    raise exception 'provider_binding_conflict' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('binding_id',b.id,'application_id',b.application_id,
    'application_revision',b.application_revision,'actor_id',b.actor_id,
    'environment',b.environment,'external_user_id',b.external_user_id);
end $$;

-- Only the authenticated webhook boundary holds this narrow database role.
-- A verified event is append-only; it cannot change customer admission or
-- product eligibility. Advisory serialization makes current/stale ordering
-- deterministic under simultaneous deliveries.
create function bx1_private.record_provider_evidence(
  p_external_user_id text,p_provider_applicant_id text,p_event_type text,
  p_correlation_id text,p_client_id text,p_event_at timestamptz,
  p_payload_sha256 text,p_semantic_sha256 text,p_review_status text,
  p_review_answer text,p_review_reject_type text,p_manual_webhook_test boolean,
  p_sandbox_mode boolean
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b bx1_private.provider_application_bindings; e bx1_private.provider_evidence_events;
  latest_at timestamptz; state text; env text;
begin
  select environment into env from bx1_portal.entry_configuration where singleton;
  if env is distinct from 'TESTNET' or p_sandbox_mode is distinct from true
    then raise exception 'provider_environment_mismatch' using errcode='42501'; end if;
  select * into b from bx1_private.provider_application_bindings
    where provider='SUMSUB' and environment=env and external_user_id=p_external_user_id for share;
  if b.id is null then raise exception 'provider_binding_unknown' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_provider:'||b.id::text,0));
  if p_provider_applicant_id is null or pg_catalog.char_length(p_provider_applicant_id) not between 8 and 100
    or p_event_type !~ '^applicant[A-Za-z]{3,60}$'
    or p_client_id is null or pg_catalog.char_length(p_client_id) not between 1 and 150
    or p_event_at is null or p_event_at>clock_timestamp()+interval '5 minutes'
    or p_event_at<b.created_at-interval '1 minute'
    or p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_semantic_sha256 !~ '^[0-9a-f]{64}$'
    or p_manual_webhook_test is null or (p_correlation_id is not null and pg_catalog.char_length(p_correlation_id) not between 1 and 150)
    or (p_review_status is not null and pg_catalog.char_length(p_review_status) not between 1 and 60)
    or (p_review_answer is not null and pg_catalog.char_length(p_review_answer) not between 1 and 60)
    or (p_review_reject_type is not null and pg_catalog.char_length(p_review_reject_type) not between 1 and 60)
    then raise exception 'provider_event_invalid' using errcode='22023'; end if;
  select * into e from bx1_private.provider_evidence_events
    where binding_id=b.id and (payload_sha256=p_payload_sha256 or semantic_sha256=p_semantic_sha256)
    order by received_at limit 1;
  if e.id is not null then return pg_catalog.jsonb_build_object('id',e.id,'application_id',e.application_id,
    'application_revision',e.application_revision,'ordering_state',e.ordering_state,'duplicate',true); end if;
  if exists(select 1 from bx1_private.provider_evidence_events x where x.binding_id=b.id
    and x.provider_applicant_id<>p_provider_applicant_id) then
    raise exception 'provider_applicant_mismatch' using errcode='23514'; end if;
  select max(x.event_at) into latest_at from bx1_private.provider_evidence_events x
    where x.binding_id=b.id and x.ordering_state='CURRENT';
  state:=case when p_manual_webhook_test then 'MANUAL_TEST'
    when latest_at is not null and p_event_at<=latest_at then 'STALE' else 'CURRENT' end;
  insert into bx1_private.provider_evidence_events
    (binding_id,application_id,application_revision,provider,environment,provider_applicant_id,
      provider_event_type,provider_correlation_id,provider_client_id,event_at,payload_sha256,
      semantic_sha256,review_status,review_answer,review_reject_type,manual_webhook_test,ordering_state)
    values(b.id,b.application_id,b.application_revision,b.provider,b.environment,p_provider_applicant_id,
      p_event_type,p_correlation_id,p_client_id,p_event_at,p_payload_sha256,p_semantic_sha256,
      p_review_status,p_review_answer,p_review_reject_type,p_manual_webhook_test,state)
    returning * into e;
  return pg_catalog.jsonb_build_object('id',e.id,'application_id',e.application_id,
    'application_revision',e.application_revision,'ordering_state',e.ordering_state,'duplicate',false);
end $$;

-- Minimal provider-neutral reviewer/applicant view: no raw webhook payload,
-- provider token, document contents or unchecked browser-selected role.
create function bx1_private.read_provider_evidence(p_application uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications;
begin
  if bx1_portal.has_session() is not true then raise exception 'provider_evidence_session_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=p_application;
  if a.id is null or not (a.user_id=auth.uid()
    or (a.status<>'DRAFT' and bx1_portal.is_reviewer(a.reviewer_scope))) then
    raise exception 'provider_evidence_scope_denied' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'application_id',e.application_id,'application_revision',e.application_revision,
      'provider',e.provider,'environment',e.environment,'event_type',e.provider_event_type,
      'event_at',e.event_at,'received_at',e.received_at,'review_status',e.review_status,
      'review_answer',e.review_answer,'review_reject_type',e.review_reject_type,
      'ordering_state',e.ordering_state,'manual_webhook_test',e.manual_webhook_test,
      'payload_sha256',e.payload_sha256) order by e.event_at,e.id)
    from bx1_private.provider_evidence_events e where e.application_id=a.id),'[]'::jsonb);
end $$;
create function public.bx1_provider_evidence_read(p_application uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select bx1_private.read_provider_evidence(p_application);
$$;

revoke all on function bx1_private.provider_session_current(uuid,uuid),
  bx1_private.bind_provider_application(uuid,uuid,uuid,integer),
  bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean),
  bx1_private.read_provider_evidence(uuid),public.bx1_provider_evidence_read(uuid) from public,anon,authenticated,service_role;
grant execute on function bx1_private.bind_provider_application(uuid,uuid,uuid,integer),
  bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean)
  to bx1_provider_evidence_writer;
grant execute on function bx1_private.read_provider_evidence(uuid) to authenticated;
grant execute on function public.bx1_provider_evidence_read(uuid) to authenticated;
