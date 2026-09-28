-- Stage 3 offering-file quarantine. These are supplemental, unscanned bytes,
-- not the three immutable in-form text disclosures in offering_revisions.
-- No file in this migration can become CLEAN, signed, approved, or public.
do $baseline$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_portal.offering_revisions') is null
    or pg_catalog.to_regprocedure('bx1_portal.scoped_operator(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.scoped_reviewer(jsonb,uuid,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.offering_issuer_scope(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.immutable_record()') is null
    or pg_catalog.to_regrole('bx1_document_receipt_writer') is null then
    raise exception 'offering_file_stage3_baseline_required' using errcode='55000';
  end if;
end $baseline$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bx1-offering-quarantine','bx1-offering-quarantine',false,4194304,array['application/pdf'])
on conflict(id) do nothing;
do $bucket$ begin
  if not exists(select 1 from storage.buckets where id='bx1-offering-quarantine'
    and public=false and file_size_limit=4194304 and allowed_mime_types=array['application/pdf']) then
    raise exception 'offering_quarantine_bucket_mismatch' using errcode='55000';
  end if;
end $bucket$;

create table bx1_portal.offering_file_quarantine (
  id uuid primary key,
  offering_revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  product_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check(kind in ('MEMORANDUM','RISKS','SUBSCRIPTION_TERMS')),
  title text not null check(char_length(title) between 1 and 160),
  storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check(byte_size between 1 and 4194304),
  mime_type text not null default 'application/pdf' check(mime_type='application/pdf'),
  validation_state text not null default 'QUARANTINED' check(validation_state='QUARANTINED'),
  uploaded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(offering_revision_id,kind),
  foreign key(offering_revision_id,product_id)
    references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  check(storage_path=offering_revision_id::text||'/'||actor_id::text||'/'||id::text)
);
create index bx1_offering_file_product_revision on bx1_portal.offering_file_quarantine(product_id,offering_revision_id);
alter table bx1_portal.offering_file_quarantine enable row level security;
revoke all on bx1_portal.offering_file_quarantine from public,anon,authenticated,service_role;
create trigger bx1_offering_file_immutable before update or delete on bx1_portal.offering_file_quarantine
  for each row execute function bx1_portal.immutable_record();

-- File registration and an issuer/Compliance decision serialize on the same
-- product. A late supplementary upload can never silently join a decided
-- revision; these files still do not form part of that decision's evidence.
create function bx1_portal.lock_offering_product_before_decision() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  perform p.id from bx1_portal.offering_revisions r
    join bx1_portal.products p on p.id=r.product_id
    where r.id=NEW.offering_revision_id for update of p;
  if not found then raise exception 'offering_revision_unavailable' using errcode='23514'; end if;
  if NEW.decision='APPROVED' and exists(select 1 from bx1_portal.offering_file_quarantine f
    where f.offering_revision_id=NEW.offering_revision_id) then
    raise exception 'offering_uploaded_files_unverified' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger bx1_offering_file_review_lock before insert on bx1_portal.offering_decisions
  for each row execute function bx1_portal.lock_offering_product_before_decision();

-- Storage cannot receive a client-selected operating context. Derive a live
-- manager mandate from the authenticated actor; the registration RPC below
-- additionally checks the explicitly selected context.
create function bx1_portal.offering_file_manager(target_revision uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_product bx1_portal.products;
begin
  if auth.uid() is null or bx1_portal.fresh_session() is not true
    or bx1_portal.entry_manual_review_enabled() is not true then return false; end if;
  select p.* into v_product from bx1_portal.offering_revisions r
    join bx1_portal.products p on p.id=r.product_id
    where r.id=target_revision and r.origin='SUBMITTED'
      and p.current_offering_revision_id=r.id and p.status='IN_REVIEW';
  if v_product.id is null or exists(select 1 from bx1_portal.offering_decisions d
    where d.offering_revision_id=target_revision) then return false; end if;
  if bx1_portal.scoped_operator('{"mode":"APPLICANT"}'::jsonb,v_product.organisation_id) then return true; end if;
  return exists(select 1 from public.bx1_memberships m where m.user_id=auth.uid()
    and m.role='OfferingManager' and bx1_portal.scoped_operator(
      pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role','OfferingManager'),
      v_product.organisation_id));
end $$;

create function bx1_portal.offering_file_upload_allowed(object_name text,object_owner text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_revision uuid; v_actor uuid;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or auth.uid() is null or object_owner is distinct from auth.uid()::text then return false; end if;
  v_revision:=pg_catalog.split_part(object_name,'/',1)::uuid;
  v_actor:=pg_catalog.split_part(object_name,'/',2)::uuid;
  return v_actor=auth.uid() and bx1_portal.offering_file_manager(v_revision);
exception when others then return false;
end $$;

-- The bucket is private, but its direct Storage API remains reachable by an
-- authenticated browser. Ownership alone must not survive mandate revocation.
create function bx1_portal.offering_file_owner_read_allowed(object_name text,object_owner text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_revision uuid; v_org uuid;
begin
  if object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or auth.uid() is null or object_owner is distinct from auth.uid()::text
    or pg_catalog.split_part(object_name,'/',2) is distinct from auth.uid()::text
    or bx1_portal.fresh_session() is not true
    or bx1_portal.entry_manual_review_enabled() is not true then return false; end if;
  v_revision:=pg_catalog.split_part(object_name,'/',1)::uuid;
  select p.organisation_id into v_org from bx1_portal.offering_revisions r
    join bx1_portal.products p on p.id=r.product_id
    where r.id=v_revision and r.origin='SUBMITTED';
  if v_org is null then return false; end if;
  if bx1_portal.scoped_operator('{"mode":"APPLICANT"}'::jsonb,v_org) then return true; end if;
  return exists(select 1 from public.bx1_memberships m where m.user_id=auth.uid()
    and m.role='OfferingManager' and bx1_portal.scoped_operator(
      pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role','OfferingManager'),v_org));
exception when others then return false;
end $$;

-- Restrictive policies contain any pre-existing broad Storage policies. An
-- authenticated manager may stage, and only that actor may retrieve their
-- quarantined bytes. Reviewers see metadata only, not unscanned file bytes.
create policy bx1_offering_file_stage on storage.objects for insert to authenticated
  with check(bucket_id='bx1-offering-quarantine'
    and bx1_portal.offering_file_upload_allowed(name,owner_id));
create policy bx1_offering_file_stage_restrict on storage.objects as restrictive for insert to public
  with check(bucket_id<>'bx1-offering-quarantine'
    or bx1_portal.offering_file_upload_allowed(name,owner_id));
create policy bx1_offering_file_owner_read on storage.objects for select to authenticated
  using(bucket_id='bx1-offering-quarantine'
    and storage.allow_only_operation('object.get_authenticated')
    and bx1_portal.offering_file_owner_read_allowed(name,owner_id));
create policy bx1_offering_file_read_restrict on storage.objects as restrictive for select to public
  using(bucket_id<>'bx1-offering-quarantine'
    or (storage.allow_only_operation('object.get_authenticated')
      and bx1_portal.offering_file_owner_read_allowed(name,owner_id)));
create policy bx1_offering_file_update_restrict on storage.objects as restrictive for update to public
  using(bucket_id<>'bx1-offering-quarantine') with check(bucket_id<>'bx1-offering-quarantine');
create policy bx1_offering_file_delete_restrict on storage.objects as restrictive for delete to public
  using(bucket_id<>'bx1-offering-quarantine');

-- Storage stages permission checks with partial metadata, then completes the
-- object write under its internal privileged connection. Do not install a
-- trigger on storage.objects: it would reject genuine uploads and interfere
-- with Storage's own rollback/cleanup. The trusted receipt writer below checks
-- the completed object's owner, MIME and size after the web route has fetched
-- and hashed the actual saved bytes. Unreceipted objects remain quarantined.

create function bx1_portal.offering_file_visible(c jsonb,target_revision uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_product bx1_portal.products;
begin
  if bx1_portal.valid_operating_context(c) is not true then return false; end if;
  select p.* into v_product from bx1_portal.offering_revisions r
    join bx1_portal.products p on p.id=r.product_id
    where r.id=target_revision and r.origin='SUBMITTED';
  if v_product.id is null then return false; end if;
  return bx1_portal.scoped_operator(c,v_product.organisation_id)
    or bx1_portal.product_appointment_authorised(c,v_product.id,'ComplianceOfficer')
    or bx1_portal.product_appointment_authorised(c,v_product.id,'IssuerFundManager');
end $$;

-- The browser cannot register a content digest. Only the existing, restricted
-- server-side document-receipt writer may do so after fetching the saved bytes
-- and comparing them to the incoming PDF. The JWT-derived session and AAL are
-- checked against live Auth state here and used only for this transaction.
create function bx1_private.register_offering_file(p_actor uuid,p_session uuid,p_aal text,
  operating_context jsonb,target_product uuid,target_revision uuid,file_id uuid,
  file_kind text,file_title text,file_sha256 text,file_size integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_product bx1_portal.products; v_record bx1_portal.offering_file_quarantine;
  v_path text; v_inserted integer;
begin
  if p_actor is null or p_session is null or p_aal not in ('aal1','aal2')
    or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_actor and s.aal::text=p_aal
        and s.oauth_client_id is null and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
        and u.email_confirmed_at is not null and u.deleted_at is null
        and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and not exists(select 1 from public.bx1_profiles profile
          where profile.id=p_actor and profile.status<>'ACTIVE')) then
    raise exception 'offering_file_session_denied' using errcode='42501'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object(
    'sub',p_actor,'session_id',p_session,'aal',p_aal,'role','authenticated')::text,true);
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor::text,true);
  if file_id is null or file_kind is null
    or file_kind not in ('MEMORANDUM','RISKS','SUBSCRIPTION_TERMS')
    or file_title is null or char_length(file_title) not between 1 and 160
    or file_sha256 is null or file_sha256 !~ '^[0-9a-f]{64}$'
    or file_size is null or file_size not between 1 and 4194304 then
    raise exception 'offering_file_invalid' using errcode='22023'; end if;
  select * into v_product from bx1_portal.products where id=target_product for update;
  if v_product.id is null or v_product.current_offering_revision_id is distinct from target_revision
    or bx1_portal.offering_file_manager(target_revision) is not true
    or (operating_context <> '{"mode":"APPLICANT"}'::jsonb
      and operating_context->>'role' is distinct from 'OfferingManager')
    or bx1_portal.scoped_operator(operating_context,v_product.organisation_id) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  v_path:=target_revision::text||'/'||p_actor::text||'/'||file_id::text;
  perform 1 from storage.objects o where o.bucket_id='bx1-offering-quarantine'
    and o.name=v_path and o.owner_id=p_actor::text
    and o.metadata->>'size'=file_size::text
    and o.metadata->>'mimetype'='application/pdf' for share;
  if not found then raise exception 'offering_file_storage_mismatch' using errcode='23514'; end if;
  insert into bx1_portal.offering_file_quarantine
    (id,offering_revision_id,product_id,actor_id,kind,title,storage_path,sha256,byte_size)
    values(file_id,target_revision,target_product,p_actor,file_kind,file_title,v_path,file_sha256,file_size)
    on conflict(id) do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_record from bx1_portal.offering_file_quarantine where id=file_id;
  if v_record.id is null or v_record.offering_revision_id is distinct from target_revision
    or v_record.product_id is distinct from target_product or v_record.actor_id is distinct from p_actor
    or v_record.kind is distinct from file_kind or v_record.title is distinct from file_title
    or v_record.storage_path is distinct from v_path or v_record.sha256 is distinct from file_sha256
    or v_record.byte_size is distinct from file_size then
    raise exception 'offering_file_receipt_conflict' using errcode='23514'; end if;
  if v_inserted=1 then
    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
      values(target_revision,v_product.organisation_id,'offering_file_quarantined',p_actor,
        'Private unscanned offering file staged for immutable package. It is not approved or signed.');
  end if;
  return pg_catalog.jsonb_build_object('id',v_record.id,'revision_id',v_record.offering_revision_id,
    'kind',v_record.kind,'title',v_record.title,'sha256',v_record.sha256,'size',v_record.byte_size,
    'validation_state','QUARANTINED','uploaded_at',v_record.uploaded_at);
end $$;

create function bx1_portal.list_offering_files(operating_context jsonb,target_revision uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.offering_file_visible(operating_context,target_revision) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',f.id,'revision_id',f.offering_revision_id,'kind',f.kind,'title',f.title,
    'sha256',f.sha256,'size',f.byte_size,'validation_state',f.validation_state,
    'uploaded_at',f.uploaded_at,'can_download',f.actor_id=auth.uid()) order by f.kind,f.id)
    from bx1_portal.offering_file_quarantine f where f.offering_revision_id=target_revision),'[]'::jsonb);
end $$;

create function bx1_portal.lookup_offering_file(operating_context jsonb,target_revision uuid,file_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare f bx1_portal.offering_file_quarantine;
begin
  if bx1_portal.offering_file_visible(operating_context,target_revision) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  select * into f from bx1_portal.offering_file_quarantine
    where id=file_id and offering_revision_id=target_revision and actor_id=auth.uid();
  if f.id is null then raise exception 'offering_file_unavailable' using errcode='P0002'; end if;
  return pg_catalog.jsonb_build_object('id',f.id,'revision_id',f.offering_revision_id,
    'storage_path',f.storage_path,'sha256',f.sha256,'size',f.byte_size,'mime_type',f.mime_type,
    'validation_state',f.validation_state);
end $$;

-- Only metadata listing/lookup is exposed to authenticated sessions. There
-- is deliberately no browser-callable writer for file digests or receipts.
create function public.bx1_offering_file_list(operating_context jsonb,target_revision uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select bx1_portal.list_offering_files(operating_context,target_revision);
$$;
create function public.bx1_offering_file_lookup(operating_context jsonb,target_revision uuid,file_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select bx1_portal.lookup_offering_file(operating_context,target_revision,file_id);
$$;

revoke all on function bx1_portal.offering_file_manager(uuid),
  bx1_portal.lock_offering_product_before_decision(),
  bx1_portal.offering_file_upload_allowed(text,text),
  bx1_portal.offering_file_owner_read_allowed(text,text),
  bx1_portal.offering_file_visible(jsonb,uuid),
  bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer),
  bx1_portal.list_offering_files(jsonb,uuid),
  bx1_portal.lookup_offering_file(jsonb,uuid,uuid),
  public.bx1_offering_file_list(jsonb,uuid),
  public.bx1_offering_file_lookup(jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
do $test_grants$ begin
  -- Policy evaluation also occurs on unrelated buckets in both environments.
  -- This helper grants no operation by itself and returns false outside TEST.
  grant execute on function bx1_portal.offering_file_upload_allowed(text,text) to anon,authenticated;
  grant execute on function bx1_portal.offering_file_owner_read_allowed(text,text) to anon,authenticated;
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET' and manual_test_review) then
    grant execute on function bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)
      to bx1_document_receipt_writer;
    grant execute on function bx1_portal.list_offering_files(jsonb,uuid),
      bx1_portal.lookup_offering_file(jsonb,uuid,uuid),
      public.bx1_offering_file_list(jsonb,uuid),
      public.bx1_offering_file_lookup(jsonb,uuid,uuid) to authenticated;
  end if;
end $test_grants$;
