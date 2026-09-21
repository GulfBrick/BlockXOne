-- Bounded rc10 correction, applied transactionally AFTER bx1_entry.sql and
-- bx1_entry_admission.sql. Existing migrations and outer funding/authority
-- writers are unchanged. No participant, membership, invitation or approval seed.
-- MAIN keeps its existing entry-only ACL seal and unadmitted configuration.
do $$ begin
  if current_user<>'postgres' or to_regprocedure('bx1_portal.entry_submit(uuid,integer,jsonb)') is null
    or to_regprocedure('bx1_portal.scoped_operator(jsonb,uuid)') is null then
    raise exception 'application_admission_baseline_required' using errcode='55000';
  end if;
end $$;

alter table bx1_portal.applications add column admission_purpose text;
update bx1_portal.applications a set admission_purpose=case
  when a.persona='INVESTOR' then 'INVESTOR_ADMISSION'
  when a.status='APPROVED' and exists(select 1 from bx1_portal.organisations o
    where o.id=a.organisation_id and o.application_id=a.id and o.owner_id=a.user_id)
    then 'LEGACY_REHEARSAL'
  else 'CUSTOMER_ORGANISATION_ADMISSION' end;
alter table bx1_portal.applications alter column admission_purpose set not null;
alter table bx1_portal.applications add constraint bx1_application_admission_purpose check(
  (persona='INVESTOR' and admission_purpose='INVESTOR_ADMISSION') or
  (persona='WEALTH_MANAGER' and admission_purpose in ('LEGACY_REHEARSAL','CUSTOMER_ORGANISATION_ADMISSION')));

-- Capture the exact migration mapping without impersonating an applicant in the
-- business audit. Source revision is the revision observed, never a guessed
-- earlier submission revision. These rows are private and append-only.
create table bx1_portal.application_admission_baseline (
  application_id uuid primary key references bx1_portal.applications(id),
  source_revision integer not null, source_status text not null,
  source_organisation_id uuid, admission_purpose text not null,
  captured_at timestamptz not null default clock_timestamp()
);
insert into bx1_portal.application_admission_baseline(application_id,source_revision,source_status,source_organisation_id,admission_purpose)
  select id,revision,status,organisation_id,admission_purpose from bx1_portal.applications;
create table bx1_portal.application_detail_versions (
  application_id uuid not null references bx1_portal.applications(id),
  application_revision integer not null check(application_revision>0),
  details jsonb not null check(jsonb_typeof(details)='object'),
  submitted_at timestamptz not null,
  capture_kind text not null check(capture_kind in ('MIGRATION_SNAPSHOT','SUBMISSION')),
  captured_at timestamptz not null default clock_timestamp(),
  primary key(application_id,application_revision)
);
insert into bx1_portal.application_detail_versions(application_id,application_revision,details,submitted_at,capture_kind)
  select id,revision,details,submitted_at,'MIGRATION_SNAPSHOT' from bx1_portal.applications where submitted_at is not null;
alter table bx1_portal.application_admission_baseline enable row level security;
alter table bx1_portal.application_detail_versions enable row level security;
create trigger bx1_application_admission_baseline_immutable before update or delete on bx1_portal.application_admission_baseline
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_application_detail_version_immutable before update or delete on bx1_portal.application_detail_versions
  for each row execute function bx1_portal.immutable_record();

create function bx1_portal.guard_application_admission() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' then
    -- Server-derived for ALL writers, including old persona-only commands.
    if NEW.admission_purpose is not null then raise exception 'application_purpose_server_owned' using errcode='23514'; end if;
    NEW.admission_purpose:=case when NEW.persona='INVESTOR' then 'INVESTOR_ADMISSION' else 'CUSTOMER_ORGANISATION_ADMISSION' end;
  elsif NEW.admission_purpose is distinct from OLD.admission_purpose then
    raise exception 'application_purpose_immutable' using errcode='23514';
  end if;
  if NEW.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION' and NEW.status='APPROVED'
    and NEW.details->'details_version' is distinct from '2'::jsonb then
    raise exception 'application_organisation_details_required' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger bx1_application_admission_guard before insert or update on bx1_portal.applications
  for each row execute function bx1_portal.guard_application_admission();
create function bx1_portal.capture_application_details() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if NEW.status='SUBMITTED' and NEW.submitted_at is not null then
    insert into bx1_portal.application_detail_versions(application_id,application_revision,details,submitted_at,capture_kind)
      values(NEW.id,NEW.revision,NEW.details,NEW.submitted_at,'SUBMISSION');
  end if;
  return NEW;
end $$;
create trigger bx1_application_details_capture after insert or update of details,submitted_at on bx1_portal.applications
  for each row execute function bx1_portal.capture_application_details();

-- Unversioned evidence remains valid with its original meaning. Version 2 is
-- organisation/representative evidence and is never accepted for an investor.
alter function bx1_portal.validate_application(jsonb,text) rename to validate_application_v1;
create function bx1_portal.validate_application(details jsonb,persona text) returns void
language plpgsql set search_path='' as $$
declare d jsonb; doc_ids text[]:='{}'; doc_paths text[]:='{}'; doc_kinds text[]:='{}'; v_size numeric;
begin
  if not(details ? 'details_version') then perform bx1_portal.validate_application_v1(details,persona); return; end if;
  if persona<>'WEALTH_MANAGER' or details->'details_version' is distinct from '2'::jsonb then
    raise exception 'portal_invalid_application_version' using errcode='22023'; end if;
  perform bx1_portal.require_keys(details,array['details_version','full_name','country','company_name','registration_reference',
    'beneficial_owners','business_activities','representative_position','authority_basis','documents','test_data_acknowledged']);
  perform bx1_portal.require_text(details,'full_name',2,120);
  perform bx1_portal.require_text(details,'country',2,2);
  perform bx1_portal.require_text(details,'company_name',3,160);
  perform bx1_portal.require_text(details,'registration_reference',3,100);
  perform bx1_portal.require_text(details,'beneficial_owners',20,2000);
  perform bx1_portal.require_text(details,'business_activities',20,2000);
  perform bx1_portal.require_text(details,'representative_position',2,160);
  perform bx1_portal.require_text(details,'authority_basis',20,2000);
  if details->>'country' !~ '^[A-Z]{2}$' or details->'test_data_acknowledged' is distinct from 'true'::jsonb
    or jsonb_typeof(details->'documents') is distinct from 'array' then raise exception 'portal_invalid_application' using errcode='22023'; end if;
  if jsonb_array_length(details->'documents') not between 1 and 8 then raise exception 'portal_documents_required' using errcode='23514'; end if;
  for d in select * from jsonb_array_elements(details->'documents') loop
    perform bx1_portal.require_keys(d,array['id','kind','title','storage_path','sha256','size','mime_type']);
    perform bx1_portal.require_text(d,'title',1,160);
    perform bx1_portal.require_text(d,'storage_path',1,400);
    if jsonb_typeof(d->'id') is distinct from 'string' or d->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(d->>'kind','') not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')
      or jsonb_typeof(d->'sha256') is distinct from 'string' or d->>'sha256' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(d->'size') is distinct from 'number' or d->>'size' !~ '^[1-9][0-9]{0,6}$'
      or coalesce(d->>'mime_type','') not in ('application/pdf','image/png','image/jpeg')
      or split_part(d->>'storage_path','/',1)<>auth.uid()::text
      or (d->>'id')=any(doc_ids) or (d->>'storage_path')=any(doc_paths) then
      raise exception 'portal_invalid_document' using errcode='22023'; end if;
    v_size:=(d->>'size')::numeric;
    if v_size>4194304 or not exists(select 1 from storage.objects o
      where o.bucket_id='bx1-portal-documents' and o.name=d->>'storage_path' and o.owner_id=auth.uid()::text
        and o.metadata->>'size'=d->>'size' and o.metadata->>'mimetype'=d->>'mime_type') then
      raise exception 'portal_document_upload_not_verified' using errcode='23514'; end if;
    doc_ids:=array_append(doc_ids,d->>'id'); doc_paths:=array_append(doc_paths,d->>'storage_path'); doc_kinds:=array_append(doc_kinds,d->>'kind');
  end loop;
  if not 'IDENTITY'=any(doc_kinds) or not 'COMPANY'=any(doc_kinds) or not 'BENEFICIAL_OWNERS'=any(doc_kinds) then
    raise exception 'portal_kyb_evidence_required' using errcode='23514'; end if;
end $$;

create function bx1_portal.application_review_route(target_application uuid) returns text
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; review_scope uuid;
begin
  select * into a from bx1_portal.applications where id=target_application;
  select reviewer_scope into review_scope from bx1_portal.entry_configuration where singleton;
  if a.id is null or a.context_kind<>'PERSONAL' or bx1_portal.entry_manual_review_enabled() is not true
    or (a.reviewer_scope is not null and a.reviewer_scope is distinct from review_scope) then return 'NOT_ADMITTED'; end if;
  if exists(select 1 from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
    join auth.users u on u.id=m.user_id join public.bx1_organisations o on o.id=m.organisation_id
    where m.organisation_id=review_scope and m.role='ComplianceOfficer' and m.status='ACTIVE'
      and p.status='ACTIVE' and o.status='ACTIVE' and m.user_id<>a.user_id and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and not exists(select 1 from bx1_private.person_principals applicant join bx1_private.person_principals reviewer on reviewer.person_id=applicant.person_id
        where applicant.auth_user_id=a.user_id and reviewer.auth_user_id=m.user_id)
      and (a.organisation_id is null or not exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=a.organisation_id)
        or exists(select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=a.organisation_id
          and b.native_organisation_id=review_scope and b.role='ComplianceOfficer' and b.status='ACTIVE'
          and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp()))) then return 'AVAILABLE'; end if;
  -- Availability means a current independent assignment exists. It is not an
  -- assertion that another person's live session or MFA has been exercised.
  return 'REVIEWER_UNAVAILABLE';
end $$;

create or replace function bx1_portal.entry_submit(target_application uuid,expected_revision integer,details jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; v_scope uuid; v_now timestamptz;
begin
  select * into a from bx1_portal.applications where id=target_application and user_id=auth.uid() for update;
  if not found then raise exception 'entry_application_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_require_context(a.context_organisation_id);
  if a.context_kind<>'PERSONAL' then raise exception 'entry_representative_route_unavailable' using errcode='55000'; end if;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  select reviewer_scope into v_scope from bx1_portal.entry_configuration where singleton and environment='TESTNET' and manual_test_review;
  if v_scope is not null then perform id from public.bx1_organisations where id=v_scope for share; end if;
  if v_scope is null or bx1_portal.entry_manual_review_enabled() is not true then raise exception 'entry_review_route_unavailable' using errcode='55000'; end if;
  if a.reviewer_scope is not null and a.reviewer_scope is distinct from v_scope then raise exception 'entry_review_scope_changed' using errcode='55000'; end if;
  if a.status not in ('DRAFT','CHANGES_REQUIRED','REJECTED') or a.revision is distinct from expected_revision then
    raise exception 'entry_stale_application' using errcode='23514'; end if;
  -- Pin current candidate assignments and their principals before the final
  -- fresh check. A revocation committed while we wait must be observed.
  perform m.id from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id join auth.users u on u.id=m.user_id
    where m.organisation_id=v_scope and m.role='ComplianceOfficer' and m.user_id<>a.user_id
    order by m.id for share of m,p,u;
  if bx1_portal.application_review_route(a.id)<>'AVAILABLE' then
    raise exception 'entry_independent_reviewer_unavailable' using errcode='55000'; end if;
  perform bx1_portal.validate_application(details,a.persona);
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_changed' using errcode='42501'; end if;
  if bx1_portal.application_review_route(a.id)<>'AVAILABLE' then raise exception 'entry_independent_reviewer_unavailable' using errcode='55000'; end if;
  v_now:=clock_timestamp();
  update bx1_portal.applications set status='SUBMITTED',revision=revision+1,details=entry_submit.details,
    reviewer_scope=v_scope,provider_mode='MANUAL_TEST_REVIEW',submitted_at=v_now,
    reviewed_at=null,reviewer_id=null,review_notes=null,review_checks='{}',approved_until=null where id=a.id;
  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
    values(a.id,a.id,'submit_application',auth.uid(),'Exact application evidence submitted to an independently staffed synthetic review function; no operational authority granted.');
  return a.id;
end $$;

-- The sole legacy-owner authority gate, also used by is_operator(), read_state(),
-- scoped reads and ALL legacy/scoped product commands. Native bindings remain
-- separate future appointments; the application payload cannot set purpose.
create or replace function bx1_portal.scoped_operator(c jsonb,target_org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.valid_operating_context(c) is not true or not bx1_portal.current_product_organisation(target_org) then return false; end if;
  if c->>'mode'='APPLICANT' then
    return exists(select 1 from bx1_portal.organisations o join bx1_portal.applications a on a.id=o.application_id
      where o.id=target_org and o.owner_id=auth.uid() and a.admission_purpose='LEGACY_REHEARSAL')
      and not exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=target_org);
  end if;
  return c->>'role' in ('OfferingManager','IssuerFundManager') and exists(select 1 from bx1_portal.organisation_authority_bindings b
    where b.product_organisation_id=target_org and b.native_organisation_id=(c->>'organisationId')::uuid
      and b.role=c->>'role' and b.status='ACTIVE' and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
end $$;

-- The legacy public read is still callable in TEST. Its original owner-only
-- projection hard-coded two operational roles even when no command was allowed.
-- Correct that exact predicate without replacing its other history projections.
do $$
declare definition text; old_predicate text:='from bx1_portal.organisations o where o.owner_id=v_actor';
begin
  definition:=pg_get_functiondef('bx1_portal.read_state()'::regprocedure);
  if (length(definition)-length(replace(definition,old_predicate,'')))/length(old_predicate)<>1 then
    raise exception 'application_admission_legacy_projection_changed' using errcode='55000'; end if;
  execute replace(definition,old_predicate,old_predicate||' and bx1_portal.scoped_operator(''{"mode":"APPLICANT"}''::jsonb,o.id)');
end $$;

create or replace function bx1_portal.entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); result jsonb;
begin
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_required' using errcode='42501'; end if;
  select jsonb_build_object('entry_version',1,'actor',jsonb_build_object('id',u.id,'email',u.email),
    'applications',coalesce((select jsonb_agg((to_jsonb(a)-'reviewer_scope')||jsonb_build_object('review_route',bx1_portal.application_review_route(a.id))
      order by a.created_at nulls first,a.id) from bx1_portal.applications a where a.user_id=v_actor),'[]'::jsonb),
    'contexts',coalesce((select jsonb_agg(jsonb_build_object('context_key',o.id,'organisation_id',o.id,'name',o.name,'roles',o.roles) order by o.name,o.id)
      from (select org.id,org.name,jsonb_agg(m.role order by m.role) roles from public.bx1_memberships m
        join public.bx1_profiles p on p.id=m.user_id join public.bx1_organisations org on org.id=m.organisation_id
        where m.user_id=v_actor and m.status='ACTIVE' and p.status='ACTIVE' and org.status='ACTIVE' group by org.id,org.name) o),'[]'::jsonb),
    'admission',jsonb_build_object('manual_test_review',bx1_portal.entry_manual_review_enabled()),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('key',r.request_key,'command',r.command,'application_id',r.application_id)
      order by r.created_at desc,r.request_key) from (select request_key,command,application_id,created_at from bx1_portal.entry_requests
        where actor_id=v_actor and created_at>=clock_timestamp()-interval '7 days' order by created_at desc,request_key limit 1000) r),'[]'::jsonb))
    into result from auth.users u where u.id=v_actor;
  if bx1_portal.fresh_session() is not true then raise exception 'entry_session_changed' using errcode='42501'; end if;
  return result;
end $$;

-- Existing evidence access is unchanged. Archived documents remain available to
-- their owner, and only the currently scoped reviewer of that same application.
create or replace function bx1_portal.object_readable(object_name text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fresh_session() and (split_part(object_name,'/',1)=auth.uid()::text or exists(
    select 1 from bx1_portal.applications a where a.status<>'DRAFT' and bx1_portal.scoped_reviewer(
      jsonb_build_object('mode','ROLE','organisationId',a.reviewer_scope,'role','ComplianceOfficer'),a.reviewer_scope,a.organisation_id)
      and (exists(select 1 from jsonb_array_elements(a.details->'documents') d where d->>'storage_path'=object_name)
        or exists(select 1 from bx1_portal.application_detail_versions v cross join lateral jsonb_array_elements(v.details->'documents') d
          where v.application_id=a.id and d->>'storage_path'=object_name))));
$$;

alter table bx1_portal.application_admission_baseline owner to postgres;
alter table bx1_portal.application_detail_versions owner to postgres;
alter function bx1_portal.guard_application_admission() owner to postgres;
alter function bx1_portal.capture_application_details() owner to postgres;
alter function bx1_portal.validate_application(jsonb,text) owner to postgres;
alter function bx1_portal.application_review_route(uuid) owner to postgres;
revoke all on bx1_portal.application_admission_baseline,bx1_portal.application_detail_versions from public,anon,authenticated,service_role;
revoke all on function bx1_portal.guard_application_admission(),bx1_portal.capture_application_details(),
  bx1_portal.validate_application(jsonb,text),bx1_portal.validate_application_v1(jsonb,text),
  bx1_portal.application_review_route(uuid) from public,anon,authenticated,service_role;
-- CREATE OR REPLACE preserved existing ACLs on entry_submit/scoped_operator/
-- entry_read/object_readable. In particular it must NOT reopen MAIN Storage.
