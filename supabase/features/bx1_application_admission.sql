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

-- The authority migration already replaces the original owner-only legacy read
-- with this exact scoped delegate. Verify the EFFECTIVE definition, not the old
-- base-feature text. The scoped_operator correction above therefore governs
-- both public reads without changing their existing ACLs or funding wrapper.
do $$
declare actual text; expected text:=$expected$
declare result jsonb;
begin
  result:=bx1_portal.read_scoped('{"mode":"APPLICANT"}'::jsonb);
  return jsonb_set(result,'{actor,can_review}',to_jsonb(exists(select 1 from public.bx1_memberships m
    where m.user_id=auth.uid() and m.role='ComplianceOfficer' and m.status='ACTIVE'
      and bx1_portal.valid_operating_context(jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role',m.role)))));
end $expected$;
begin
  select p.prosrc into actual from pg_catalog.pg_proc p where p.oid='bx1_portal.read_state()'::regprocedure
    and p.prosecdef and p.provolatile='v' and p.proowner='postgres'::regrole;
  if actual is null or btrim(replace(actual,E'\r',''),E' \n\t') is distinct from btrim(expected,E' \n\t') then
    raise exception 'application_admission_legacy_projection_changed' using errcode='55000'; end if;
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

-- The version table is private. A caller may see only its own application's
-- immutable manifests, or a submitted application's currently appointed
-- Compliance reviewer in the exact native scope with verified TOTP/AAL2.
-- This is independent of Storage path possession and does not attest bytes.
create function bx1_portal.application_document_access(target_application uuid,operating_context jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications;
begin
  if target_application is null or bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then return false; end if;
  select * into a from bx1_portal.applications where id=target_application;
  if a.id is null then return false; end if;
  if operating_context='{"mode":"APPLICANT"}'::jsonb then return a.user_id=auth.uid(); end if;
  if a.status='DRAFT' or a.reviewer_scope is null
    or operating_context->>'mode' is distinct from 'ROLE'
    or operating_context->>'role' is distinct from 'ComplianceOfficer'
    or operating_context->>'organisationId' is distinct from a.reviewer_scope::text
    or auth.jwt()->>'aal' is distinct from 'aal2'
    or not exists(select 1 from auth.sessions s join auth.mfa_factors f
      on f.id=s.factor_id and f.user_id=s.user_id
      where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
        and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp')
    then return false; end if;
  return bx1_portal.scoped_reviewer(operating_context,a.reviewer_scope,a.organisation_id);
end $$;

-- Storage's pre-existing SELECT policies call this function. Never trust a
-- caller-supplied path as reviewer authority: match an immutable submission
-- manifest for that path and the application's actual owner, then apply the
-- same current AAL2/TOTP and scoped appointment rule as the history RPC.
-- This helper deliberately does not query storage.objects (RLS recursion).
create or replace function bx1_portal.object_readable(object_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_owner_prefix text; v_app record;
begin
  if object_name is null or bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then return false; end if;
  v_owner_prefix:=pg_catalog.split_part(object_name,'/',1);
  if v_owner_prefix=auth.uid()::text then return true; end if;
  if v_owner_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return false; end if;
  for v_app in select a.id,a.reviewer_scope from bx1_portal.applications a
    where a.user_id=v_owner_prefix::uuid and a.status<>'DRAFT' and a.reviewer_scope is not null loop
    if exists(select 1 from bx1_portal.application_detail_versions v
      cross join lateral pg_catalog.jsonb_array_elements(case
        when pg_catalog.jsonb_typeof(v.details->'documents')='array' then v.details->'documents'
        else '[]'::jsonb end) d(item)
      where v.application_id=v_app.id and d.item->>'storage_path'=object_name) then
      if bx1_portal.application_document_access(v_app.id,pg_catalog.jsonb_build_object(
        'mode','ROLE','organisationId',v_app.reviewer_scope::text,'role','ComplianceOfficer')) is true
        then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- A version list deliberately omits Storage paths. Hashes in older rows are
-- submitted claims, not independent byte-verification or scan evidence.
create function public.bx1_application_document_versions(application_id uuid,operating_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_application uuid:=$1; v_context jsonb:=$2; v_versions jsonb;
begin
  if bx1_portal.application_document_access(v_application,v_context) is not true then
    raise exception 'application_document_access_denied' using errcode='42501'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'revision',v.application_revision,'submitted_at',v.submitted_at,'capture_kind',v.capture_kind,
    'documents',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',d.item->>'id','kind',d.item->>'kind','title',d.item->>'title',
      'claimed_sha256',d.item->>'sha256','size',d.item->'size','mime_type',d.item->>'mime_type')
      order by d.ordinality),'[]'::jsonb)
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v.details->'documents')='array'
        then v.details->'documents' else '[]'::jsonb end) with ordinality d(item,ordinality)))
    order by v.application_revision),'[]'::jsonb) into v_versions
    from bx1_portal.application_detail_versions v where v.application_id=v_application;
  if bx1_portal.application_document_access(v_application,v_context) is not true then
    raise exception 'application_document_access_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('application_id',v_application,'versions',v_versions);
end $$;

-- Exact historical lookup for a future private-document proxy. The caller
-- supplies application/revision/document identity, never a Storage path.
create function public.bx1_application_document_lookup(application_id uuid,revision integer,
  document_id uuid,operating_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_application uuid:=$1; v_revision integer:=$2; v_document uuid:=$3; v_context jsonb:=$4;
  v_count bigint; v_matches jsonb; v_document_manifest jsonb; v_owner uuid; v_path text;
begin
  if bx1_portal.application_document_access(v_application,v_context) is not true then
    raise exception 'application_document_access_denied' using errcode='42501'; end if;
  select count(*),pg_catalog.jsonb_agg(d.item) into v_count,v_matches
    from bx1_portal.application_detail_versions v
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v.details->'documents')='array'
      then v.details->'documents' else '[]'::jsonb end) d(item)
    where v.application_id=v_application and v.application_revision=v_revision
      and d.item->>'id'=v_document::text;
  if v_count<>1 then raise exception 'application_document_not_found' using errcode='P0002'; end if;
  v_document_manifest:=v_matches->0;
  v_path:=v_document_manifest->>'storage_path';
  select a.user_id into v_owner from bx1_portal.applications a where a.id=v_application;
  if v_path is null or pg_catalog.split_part(v_path,'/',1) is distinct from v_owner::text
    or coalesce(v_document_manifest->>'sha256','') !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
      and o.name=v_path and o.owner_id=v_owner::text
      and o.metadata->>'size'=v_document_manifest->>'size'
      and o.metadata->>'mimetype'=v_document_manifest->>'mime_type') then
    raise exception 'application_document_storage_unavailable' using errcode='55000'; end if;
  if bx1_portal.application_document_access(v_application,v_context) is not true then
    raise exception 'application_document_access_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('application_id',v_application,'revision',v_revision,
    'id',v_document,'kind',v_document_manifest->>'kind','title',v_document_manifest->>'title',
    'storage_path',v_path,'claimed_sha256',v_document_manifest->>'sha256',
    'size',v_document_manifest->'size','mime_type',v_document_manifest->>'mime_type');
end $$;

alter table bx1_portal.application_admission_baseline owner to postgres;
alter table bx1_portal.application_detail_versions owner to postgres;
alter function bx1_portal.guard_application_admission() owner to postgres;
alter function bx1_portal.capture_application_details() owner to postgres;
alter function bx1_portal.validate_application(jsonb,text) owner to postgres;
alter function bx1_portal.application_review_route(uuid) owner to postgres;
alter function bx1_portal.application_document_access(uuid,jsonb) owner to postgres;
alter function bx1_portal.object_readable(text) owner to postgres;
alter function public.bx1_application_document_versions(uuid,jsonb) owner to postgres;
alter function public.bx1_application_document_lookup(uuid,integer,uuid,jsonb) owner to postgres;
revoke all on bx1_portal.application_admission_baseline,bx1_portal.application_detail_versions from public,anon,authenticated,service_role;
revoke all on function bx1_portal.guard_application_admission(),bx1_portal.capture_application_details(),
  bx1_portal.validate_application(jsonb,text),bx1_portal.validate_application_v1(jsonb,text),
  bx1_portal.application_review_route(uuid),bx1_portal.application_document_access(uuid,jsonb),
  bx1_portal.object_readable(text),
  public.bx1_application_document_versions(uuid,jsonb),
  public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.bx1_application_document_versions(uuid,jsonb),
  public.bx1_application_document_lookup(uuid,integer,uuid,jsonb) to authenticated;
grant execute on function bx1_portal.object_readable(text) to authenticated;
-- CREATE OR REPLACE preserved existing ACLs on entry_submit/scoped_operator/
-- entry_read. In particular it must NOT reopen MAIN Storage.
