-- Stage 2 read-only application document history. Apply after the admission,
-- mandate, and document-receipt migrations. No table grant, writer change,
-- provider claim, participant seed, or environment admission is introduced.
do $$ begin
  if current_user<>'postgres'
    or to_regclass('bx1_portal.application_detail_versions') is null
    or to_regclass('bx1_private.document_upload_receipts') is null
    or to_regprocedure('bx1_portal.scoped_reviewer(jsonb,uuid,uuid)') is null then
    raise exception 'application_document_history_baseline_required' using errcode='55000';
  end if;
end $$;

create or replace function bx1_portal.application_document_access(target_application uuid,operating_context jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications;
begin
  if target_application is null or bx1_portal.entry_manual_review_enabled() is not true
    or bx1_portal.fresh_session() is not true
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

-- Replace the existing direct Storage SELECT policy predicate without
-- changing the policy or its upload guards. Historical reviewer access must
-- derive from an immutable version, not a mutable current application field.
-- No storage.objects read here: this function runs from its RLS policy.
create or replace function bx1_portal.object_readable(object_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_owner_prefix text; v_app record;
begin
  if object_name is null or bx1_portal.entry_manual_review_enabled() is not true
    or bx1_portal.fresh_session() is not true
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

create or replace function public.bx1_application_document_versions(application_id uuid,operating_context jsonb) returns jsonb
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

create or replace function public.bx1_application_document_lookup(application_id uuid,revision integer,
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

alter function bx1_portal.application_document_access(uuid,jsonb) owner to postgres;
alter function bx1_portal.object_readable(text) owner to postgres;
alter function public.bx1_application_document_versions(uuid,jsonb) owner to postgres;
alter function public.bx1_application_document_lookup(uuid,integer,uuid,jsonb) owner to postgres;
revoke all on function bx1_portal.application_document_access(uuid,jsonb),
  bx1_portal.object_readable(text),
  public.bx1_application_document_versions(uuid,jsonb),
  public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)
  from public,anon,authenticated,service_role;
-- Do not reopen the MAIN entry-only seal. This release exposes the document
-- reader only through TEST's explicitly admitted manual-review configuration.
do $document_history_grants$ begin
  if bx1_portal.entry_manual_review_enabled() is true then
    execute 'grant execute on function public.bx1_application_document_versions(uuid,jsonb), public.bx1_application_document_lookup(uuid,integer,uuid,jsonb), bx1_portal.object_readable(text) to authenticated';
  end if;
end $document_history_grants$;
