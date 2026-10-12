-- Additive Stage 2 qualification. Apply after the historical provider migration.
-- Existing rows are not backfilled: an unqualified record remains historical.
-- No provider activation, LOGIN, application decision, role or policy is seeded.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_private.provider_application_bindings') is null
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null
    or pg_catalog.to_regprocedure('bx1_portal.scoped_reviewer(jsonb,uuid,uuid)') is null then
    raise exception 'provider_binding_baseline_required' using errcode='55000';
  end if;
end $$;

alter table bx1_private.provider_application_bindings
  add column expected_applicant_type text,
  add column expected_level_name text,
  add column expected_client_id text,
  add column source_version_revision integer,
  add constraint bx1_provider_binding_qualification check (
    (expected_applicant_type is null and expected_level_name is null
      and expected_client_id is null and source_version_revision is null)
    or (expected_applicant_type is not null and expected_applicant_type in ('individual','company')
      and expected_level_name is not null and char_length(expected_level_name) between 1 and 120
      and expected_level_name=btrim(expected_level_name) and expected_level_name !~ '[[:cntrl:]]'
      and expected_client_id is not null and char_length(expected_client_id) between 1 and 150
      and expected_client_id=btrim(expected_client_id) and expected_client_id !~ '[[:cntrl:]]'
      and source_version_revision is not null and source_version_revision=application_revision)),
  add constraint bx1_provider_binding_source foreign key(application_id,source_version_revision)
    references bx1_portal.application_detail_versions(application_id,application_revision) on delete restrict;
alter table bx1_private.provider_evidence_events
  add column applicant_type text,
  add column level_name text,
  add constraint bx1_provider_event_qualification check (
    (applicant_type is null and level_name is null)
    or (applicant_type is not null and applicant_type in ('individual','company')
      and level_name is not null and char_length(level_name) between 1 and 120
      and level_name=btrim(level_name) and level_name !~ '[[:cntrl:]]'));

-- First genuine signed match pins identity. Manual tests never insert here.
create table bx1_private.provider_applicant_pins (
  binding_id uuid primary key references bx1_private.provider_application_bindings(id) on delete restrict,
  provider_applicant_id text not null check(char_length(provider_applicant_id) between 8 and 100),
  first_event_id uuid not null unique references bx1_private.provider_evidence_events(id) on delete restrict,
  pinned_at timestamptz not null default clock_timestamp()
);
-- Machine boundary receipts are not applicant-authored business events.
create table bx1_private.provider_boundary_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  binding_id uuid not null references bx1_private.provider_application_bindings(id) on delete restrict,
  event_id uuid unique references bx1_private.provider_evidence_events(id) on delete restrict,
  source_kind text not null check(source_kind in ('SERVER_BINDING','SIGNED_WEBHOOK')),
  actor_id uuid references auth.users(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  environment text not null check(environment='TESTNET'),
  created_at timestamptz not null default clock_timestamp(),
  check ((source_kind='SERVER_BINDING' and event_id is null and actor_id is not null)
    or (source_kind='SIGNED_WEBHOOK' and event_id is not null and actor_id is null))
);
create unique index bx1_provider_binding_receipt on bx1_private.provider_boundary_receipts(binding_id)
  where source_kind='SERVER_BINDING';
alter table bx1_private.provider_applicant_pins enable row level security;
alter table bx1_private.provider_boundary_receipts enable row level security;
create trigger bx1_provider_pin_immutable before update or delete on bx1_private.provider_applicant_pins
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_provider_receipt_immutable before update or delete on bx1_private.provider_boundary_receipts
  for each row execute function bx1_portal.immutable_record();
revoke all on bx1_private.provider_applicant_pins,bx1_private.provider_boundary_receipts
  from public,anon,authenticated,service_role,bx1_provider_evidence_writer;

-- Old callers fail closed. Retained source/proof remains unchanged.
create or replace function bx1_private.bind_provider_application(p_actor uuid,p_session uuid,p_application uuid,p_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin raise exception 'provider_qualified_binding_required' using errcode='55000'; end $$;
create or replace function bx1_private.record_provider_evidence(
  p_external_user_id text,p_provider_applicant_id text,p_event_type text,
  p_correlation_id text,p_client_id text,p_event_at timestamptz,
  p_payload_sha256 text,p_semantic_sha256 text,p_review_status text,
  p_review_answer text,p_review_reject_type text,p_manual_webhook_test boolean,p_sandbox_mode boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin raise exception 'provider_qualified_event_required' using errcode='55000'; end $$;

create function bx1_private.bind_provider_application(
  p_actor uuid,p_session uuid,p_application uuid,p_revision integer,
  p_individual_level text,p_company_level text,p_client_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; v bx1_portal.application_detail_versions;
  b bx1_private.provider_application_bindings; env text; subject_type text; level text;
begin
  select environment into env from bx1_portal.entry_configuration where singleton for share;
  if env is distinct from 'TESTNET' then raise exception 'provider_environment_not_admitted' using errcode='42501'; end if;
  if p_actor is null or p_session is null or p_application is null or p_revision is null or p_revision<1
    or p_individual_level is null or char_length(p_individual_level) not between 1 and 120
    or p_individual_level<>btrim(p_individual_level) or p_individual_level ~ '[[:cntrl:]]'
    or p_company_level is null or char_length(p_company_level) not between 1 and 120
    or p_company_level<>btrim(p_company_level) or p_company_level ~ '[[:cntrl:]]'
    or p_client_id is null or char_length(p_client_id) not between 1 and 150
    or p_client_id<>btrim(p_client_id) or p_client_id ~ '[[:cntrl:]]' then
    raise exception 'provider_binding_invalid' using errcode='22023'; end if;
  perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;
  if bx1_private.provider_session_current(p_actor,p_session) is not true then
    raise exception 'provider_session_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=p_application for share;
  if a.id is null or a.user_id is distinct from p_actor or a.revision is distinct from p_revision
    or a.context_kind<>'PERSONAL' or a.status<>'SUBMITTED'
    or a.admission_purpose not in ('INVESTOR_ADMISSION','CUSTOMER_ORGANISATION_ADMISSION') then
    raise exception 'provider_application_denied' using errcode='42501'; end if;
  select * into v from bx1_portal.application_detail_versions
    where application_id=a.id and application_revision=a.revision for share;
  if v.application_id is null or v.capture_kind<>'SUBMISSION' or v.details is distinct from a.details
    or v.submitted_at is distinct from a.submitted_at or a.submitted_at is null then
    raise exception 'provider_submission_required' using errcode='23514'; end if;
  if jsonb_typeof(v.details->'full_name') is distinct from 'string'
    or char_length(btrim(v.details->>'full_name')) not between 2 and 120
    or jsonb_typeof(v.details->'country') is distinct from 'string'
    or v.details->>'country' !~ '^[A-Z]{2}$' then
    raise exception 'provider_subject_invalid' using errcode='23514'; end if;
  if a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
    and v.details->>'investor_type'='INDIVIDUAL' and not(v.details ? 'details_version') then
    subject_type:='individual';
  elsif (a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
      and v.details->>'investor_type'='ENTITY'
      and (not(v.details ? 'details_version') or v.details->'details_version'='3'::jsonb))
    or (a.persona='WEALTH_MANAGER' and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and v.details->'details_version' in ('2'::jsonb,'3'::jsonb)) then
    if jsonb_typeof(v.details->'company_name') is distinct from 'string'
      or char_length(btrim(v.details->>'company_name')) not between 3 and 160
      or jsonb_typeof(v.details->'registration_reference') is distinct from 'string'
      or char_length(btrim(v.details->>'registration_reference')) not between 3 and 100 then
      raise exception 'provider_subject_invalid' using errcode='23514'; end if;
    subject_type:='company';
  else raise exception 'provider_subject_invalid' using errcode='23514'; end if;
  level:=case when subject_type='individual' then p_individual_level else p_company_level end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_provider_binding:'||a.id::text||':r'||a.revision,0));
  select * into b from bx1_private.provider_application_bindings
    where provider='SUMSUB' and environment=env and application_id=a.id and application_revision=a.revision;
  if b.id is not null then
    if row(b.actor_id,b.expected_applicant_type,b.expected_level_name,b.expected_client_id,b.source_version_revision)
      is distinct from row(p_actor,subject_type,level,p_client_id,a.revision) then
      raise exception 'provider_binding_conflict' using errcode='23514'; end if;
  else
    insert into bx1_private.provider_application_bindings
      (provider,environment,application_id,application_revision,actor_id,external_user_id,
       expected_applicant_type,expected_level_name,expected_client_id,source_version_revision)
      values('SUMSUB',env,a.id,a.revision,p_actor,'bx1:testnet:'||a.id::text||':r'||a.revision,
        subject_type,level,p_client_id,v.application_revision) returning * into b;
    insert into bx1_private.provider_boundary_receipts
      (binding_id,source_kind,actor_id,application_id,application_revision,environment)
      values(b.id,'SERVER_BINDING',p_actor,a.id,a.revision,env);
  end if;
  return pg_catalog.jsonb_build_object('binding_id',b.id,'application_id',b.application_id,
    'application_revision',b.application_revision,'actor_id',b.actor_id,'environment',b.environment,
    'external_user_id',b.external_user_id,'expected_applicant_type',b.expected_applicant_type,
    'expected_level_name',b.expected_level_name,'expected_client_id',b.expected_client_id,
    'source_version_revision',b.source_version_revision);
end $$;

-- One projection authority for inserts, retries and both reader contexts.
-- Physical legacy ordering_state is immutable history, never effective truth.
create function bx1_private.project_provider_evidence(p_application uuid)
returns table(id uuid,evidence_kind text,projection_state text,ordering_state text)
language sql stable security definer set search_path='' as $$
  with qualified as (
    select e.*, b.expected_applicant_type,b.expected_level_name,b.source_version_revision,
      (b.expected_applicant_type is not null and b.expected_level_name is not null
        and b.expected_client_id is not null and b.source_version_revision=e.application_revision
        and e.applicant_type=b.expected_applicant_type and e.level_name=b.expected_level_name
        and e.provider_client_id=b.expected_client_id) is true as qualified,
      (a.status='SUBMITTED' and a.revision=e.application_revision and a.context_kind='PERSONAL'
        and v.capture_kind='SUBMISSION' and v.details=a.details and v.submitted_at=a.submitted_at) is true as current_revision
    from bx1_private.provider_evidence_events e
    join bx1_private.provider_application_bindings b on b.id=e.binding_id
    join bx1_portal.applications a on a.id=e.application_id
    left join bx1_portal.application_detail_versions v on v.application_id=b.application_id
      and v.application_revision=b.source_version_revision
    where e.application_id=p_application
  ), latest as (
    select binding_id,max(event_at) as event_at from qualified where qualified and not manual_webhook_test group by binding_id
  ), ties as (
    select q.binding_id,count(*) as events from qualified q join latest l
      on l.binding_id=q.binding_id and l.event_at=q.event_at
      where q.qualified and not q.manual_webhook_test group by q.binding_id
  ), projected as (
    select q.id,
      case when not q.qualified then 'LEGACY_UNQUALIFIED'
        when q.provider_event_type='applicantReviewed' and q.review_status='completed'
          and ((q.review_answer='GREEN' and q.review_reject_type is null)
            or (q.review_answer='RED' and q.review_reject_type in ('RETRY','FINAL'))) then 'COMPLETED_REVIEW'
        else 'LIFECYCLE' end as evidence_kind,
      case when not q.qualified then 'LEGACY_UNQUALIFIED'
        when q.manual_webhook_test then 'MANUAL_TEST'
        when not q.current_revision then 'REVISION_STALE'
        when q.event_at<l.event_at then 'SUPERSEDED'
        when t.events>1 then 'CONFLICT' else 'EFFECTIVE' end as projection_state
    from qualified q left join latest l on l.binding_id=q.binding_id left join ties t on t.binding_id=q.binding_id
  ) select p.id,p.evidence_kind,p.projection_state,
    case when p.projection_state='EFFECTIVE' then 'CURRENT'
      when p.projection_state='MANUAL_TEST' then 'MANUAL_TEST' else 'STALE' end from projected p;
$$;

create function bx1_private.record_provider_evidence(
  p_external_user_id text,p_provider_applicant_id text,p_event_type text,
  p_correlation_id text,p_client_id text,p_event_at timestamptz,
  p_payload_sha256 text,p_semantic_sha256 text,p_review_status text,
  p_review_answer text,p_review_reject_type text,p_manual_webhook_test boolean,
  p_sandbox_mode boolean,p_applicant_type text,p_level_name text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b bx1_private.provider_application_bindings; e bx1_private.provider_evidence_events;
  pin bx1_private.provider_applicant_pins; env text; projection record;
begin
  select environment into env from bx1_portal.entry_configuration where singleton for share;
  if env is distinct from 'TESTNET' or p_sandbox_mode is distinct from true then
    raise exception 'provider_environment_mismatch' using errcode='42501'; end if;
  if p_external_user_id is null or char_length(p_external_user_id) not between 45 and 100
    or p_external_user_id !~ '^bx1:testnet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:r[1-9][0-9]*$'
    or p_provider_applicant_id is null or char_length(p_provider_applicant_id) not between 8 and 100
    or p_provider_applicant_id<>btrim(p_provider_applicant_id) or p_provider_applicant_id ~ '[[:cntrl:]]'
    or p_event_type is null or p_event_type not in ('applicantReviewed','applicantCreated','applicantPending',
      'applicantOnHold','applicantPersonalInfoChanged','applicantReset','applicantLevelChanged','applicantActivated',
      'applicantPrechecked','applicantAwaitingUser','applicantDeactivated','applicantDeleted')
    or p_client_id is null or char_length(p_client_id) not between 1 and 150
    or p_client_id<>btrim(p_client_id) or p_client_id ~ '[[:cntrl:]]'
    or p_event_at is null or not pg_catalog.isfinite(p_event_at) or p_event_at>clock_timestamp()+interval '5 minutes'
    or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_semantic_sha256 is null or p_semantic_sha256 !~ '^[0-9a-f]{64}$'
    or p_manual_webhook_test is null or p_applicant_type is null or p_applicant_type not in ('individual','company')
    or p_level_name is null or char_length(p_level_name) not between 1 and 120
    or p_level_name<>btrim(p_level_name) or p_level_name ~ '[[:cntrl:]]'
    or (p_correlation_id is not null and (char_length(p_correlation_id) not between 1 and 150
      or p_correlation_id<>btrim(p_correlation_id) or p_correlation_id ~ '[[:cntrl:]]'))
    or (p_review_status is not null and (char_length(p_review_status) not between 1 and 60
      or p_review_status<>btrim(p_review_status) or p_review_status ~ '[[:cntrl:]]'))
    or (p_review_answer is not null and (char_length(p_review_answer) not between 1 and 60
      or p_review_answer<>btrim(p_review_answer) or p_review_answer ~ '[[:cntrl:]]'))
    or (p_review_reject_type is not null and (char_length(p_review_reject_type) not between 1 and 60
      or p_review_reject_type<>btrim(p_review_reject_type) or p_review_reject_type ~ '[[:cntrl:]]')) then
    raise exception 'provider_event_invalid' using errcode='22023'; end if;
  if p_event_type='applicantReviewed' and p_review_status='completed'
    and ((p_review_answer='GREEN' and p_review_reject_type is null)
      or (p_review_answer='RED' and p_review_reject_type in ('RETRY','FINAL'))) is not true then
    raise exception 'provider_review_invalid' using errcode='22023'; end if;
  select * into b from bx1_private.provider_application_bindings
    where provider='SUMSUB' and environment=env and external_user_id=p_external_user_id for share;
  if b.id is null then raise exception 'provider_binding_unknown' using errcode='42501'; end if;
  if row(b.expected_applicant_type,b.expected_level_name,b.expected_client_id)
    is distinct from row(p_applicant_type,p_level_name,p_client_id) or b.source_version_revision is null
    or not exists(select 1 from bx1_portal.application_detail_versions v
      where v.application_id=b.application_id and v.application_revision=b.source_version_revision
        and v.capture_kind='SUBMISSION') then
    raise exception 'provider_qualification_mismatch' using errcode='23514'; end if;
  if p_event_at<b.created_at-interval '1 minute' then raise exception 'provider_event_invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_provider:'||b.id::text,0));
  select * into pin from bx1_private.provider_applicant_pins where binding_id=b.id;
  if not p_manual_webhook_test and pin.binding_id is not null and pin.provider_applicant_id<>p_provider_applicant_id then
    raise exception 'provider_applicant_mismatch' using errcode='23514'; end if;
  if (select count(*) from bx1_private.provider_evidence_events
    where binding_id=b.id and (payload_sha256=p_payload_sha256 or semantic_sha256=p_semantic_sha256))>1 then
    raise exception 'provider_replay_conflict' using errcode='23514'; end if;
  select * into e from bx1_private.provider_evidence_events
    where binding_id=b.id and (payload_sha256=p_payload_sha256 or semantic_sha256=p_semantic_sha256)
    order by received_at,id limit 1;
  if e.id is not null then
    if (e.payload_sha256=p_payload_sha256 and e.semantic_sha256 is distinct from p_semantic_sha256)
      or row(e.provider_applicant_id,e.provider_event_type,e.provider_correlation_id,e.provider_client_id,
        e.event_at,e.review_status,e.review_answer,e.review_reject_type,e.manual_webhook_test,e.applicant_type,e.level_name)
      is distinct from row(p_provider_applicant_id,p_event_type,p_correlation_id,p_client_id,
        p_event_at,p_review_status,p_review_answer,p_review_reject_type,p_manual_webhook_test,p_applicant_type,p_level_name) then
      raise exception 'provider_replay_conflict' using errcode='23514'; end if;
  else
    insert into bx1_private.provider_evidence_events
      (binding_id,application_id,application_revision,provider,environment,provider_applicant_id,
       provider_event_type,provider_correlation_id,provider_client_id,event_at,payload_sha256,semantic_sha256,
       review_status,review_answer,review_reject_type,manual_webhook_test,ordering_state,applicant_type,level_name)
      values(b.id,b.application_id,b.application_revision,b.provider,b.environment,p_provider_applicant_id,
        p_event_type,p_correlation_id,p_client_id,p_event_at,p_payload_sha256,p_semantic_sha256,
        p_review_status,p_review_answer,p_review_reject_type,p_manual_webhook_test,
        case when p_manual_webhook_test then 'MANUAL_TEST' else 'STALE' end,p_applicant_type,p_level_name) returning * into e;
    if not p_manual_webhook_test and pin.binding_id is null then
      insert into bx1_private.provider_applicant_pins(binding_id,provider_applicant_id,first_event_id)
        values(b.id,p_provider_applicant_id,e.id);
    end if;
    insert into bx1_private.provider_boundary_receipts
      (binding_id,event_id,source_kind,application_id,application_revision,environment)
      values(b.id,e.id,'SIGNED_WEBHOOK',b.application_id,b.application_revision,env);
    select * into projection from bx1_private.project_provider_evidence(b.application_id) x where x.id=e.id;
    return jsonb_build_object('id',e.id,'application_id',e.application_id,'application_revision',e.application_revision,
      'ordering_state',projection.ordering_state,'evidence_kind',projection.evidence_kind,
      'projection_state',projection.projection_state,'duplicate',false);
  end if;
  select * into projection from bx1_private.project_provider_evidence(b.application_id) x where x.id=e.id;
  return jsonb_build_object('id',e.id,'application_id',e.application_id,'application_revision',e.application_revision,
    'ordering_state',projection.ordering_state,'evidence_kind',projection.evidence_kind,
    'projection_state',projection.projection_state,'duplicate',true);
end $$;

create or replace function bx1_private.read_provider_evidence(p_application uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; current_a bx1_portal.applications;
  env text; issuer text; current_env text; current_issuer text; result jsonb;
begin
  select environment into env from bx1_portal.entry_configuration where singleton;
  issuer:=case env when 'TESTNET' then 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    when 'MAINNET' then 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' else null end;
  if bx1_portal.fresh_session() is not true or issuer is null or auth.jwt()->>'iss' is distinct from issuer then
    raise exception 'provider_evidence_session_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=p_application;
  if a.id is null or not (a.user_id=auth.uid() or (a.status<>'DRAFT' and a.reviewer_scope is not null
    and bx1_portal.scoped_reviewer(jsonb_build_object('mode','ROLE','organisationId',a.reviewer_scope::text,
      'role','ComplianceOfficer'),a.reviewer_scope,a.organisation_id))) then
    raise exception 'provider_evidence_scope_denied' using errcode='42501'; end if;
  select coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'application_id',e.application_id,'application_revision',e.application_revision,
      'provider',e.provider,'environment',e.environment,'event_type',e.provider_event_type,
      'event_at',e.event_at,'received_at',e.received_at,'review_status',e.review_status,
      'review_answer',e.review_answer,'review_reject_type',e.review_reject_type,
      'ordering_state',p.ordering_state,'manual_webhook_test',e.manual_webhook_test,
      'payload_sha256',e.payload_sha256,'applicant_type',e.applicant_type,'level_name',e.level_name,
      'evidence_kind',p.evidence_kind,'projection_state',p.projection_state) order by e.event_at,e.id)
    from bx1_private.provider_evidence_events e join bx1_private.project_provider_evidence(a.id) p on p.id=e.id
    where e.application_id=a.id and e.environment=env),'[]'::jsonb) into result;
  -- Aggregation can wait behind another transaction. Never return evidence
  -- under a cached session, environment, application or reviewer appointment.
  -- fresh_session/has_session preserve the current-factor and token-MFA guards.
  select environment into current_env from bx1_portal.entry_configuration where singleton;
  current_issuer:=case current_env when 'TESTNET' then 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    when 'MAINNET' then 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' else null end;
  if bx1_portal.fresh_session() is not true or bx1_portal.has_session() is not true
    or current_env is distinct from env or current_issuer is distinct from issuer
    or current_issuer is null or auth.jwt()->>'iss' is distinct from current_issuer then
    raise exception 'provider_evidence_session_changed' using errcode='42501'; end if;
  select * into current_a from bx1_portal.applications where id=p_application;
  if current_a.id is null or row(current_a.id,current_a.user_id,current_a.persona,current_a.admission_purpose,
      current_a.revision,current_a.status,current_a.reviewer_scope,current_a.organisation_id,
      current_a.context_kind,current_a.context_organisation_id,current_a.details,current_a.submitted_at)
    is distinct from row(a.id,a.user_id,a.persona,a.admission_purpose,a.revision,a.status,
      a.reviewer_scope,a.organisation_id,a.context_kind,a.context_organisation_id,a.details,a.submitted_at)
    or not (current_a.user_id=auth.uid() or (current_a.status<>'DRAFT' and current_a.reviewer_scope is not null
      and bx1_portal.scoped_reviewer(jsonb_build_object('mode','ROLE','organisationId',current_a.reviewer_scope::text,
        'role','ComplianceOfficer'),current_a.reviewer_scope,current_a.organisation_id))) then
    raise exception 'provider_evidence_scope_changed' using errcode='42501'; end if;
  return result;
end $$;

revoke all on function bx1_private.bind_provider_application(uuid,uuid,uuid,integer),
  bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean),
  bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text),
  bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean,text,text),
  bx1_private.project_provider_evidence(uuid),bx1_private.read_provider_evidence(uuid)
  from public,anon,authenticated,service_role,bx1_provider_evidence_writer;
grant execute on function bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text),
  bx1_private.record_provider_evidence(text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,boolean,text,text)
  to bx1_provider_evidence_writer;
grant execute on function bx1_private.read_provider_evidence(uuid) to authenticated;
