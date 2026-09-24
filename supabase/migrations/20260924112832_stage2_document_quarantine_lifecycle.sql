-- Additive document quarantine. Existing TEST documents remain explicitly
-- SYNTHETIC_UNSCANNED. A reviewer must enable SCANNER_REQUIRED only after a
-- real scanner adapter, credentials, and hosted byte/revocation proof exist.
-- MAIN's entry-only seal is not changed by installing these definitions.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_private.document_upload_receipts') is null
    or pg_catalog.to_regprocedure('bx1_private.guard_application_document_receipts()') is null
    or pg_catalog.to_regprocedure('bx1_portal.object_readable(text)') is null then
    raise exception 'document_lifecycle_baseline_required' using errcode='55000';
  end if;
end $$;

create table bx1_private.document_lifecycle_policy (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'SYNTHETIC_TEST_ONLY'
    check(mode in ('SYNTHETIC_TEST_ONLY','SCANNER_REQUIRED')),
  changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into bx1_private.document_lifecycle_policy(singleton) values(true);
create role bx1_document_scanner_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema bx1_private to bx1_document_scanner_writer;
create function bx1_private.guard_document_lifecycle_activation() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then
    raise exception 'document_lifecycle_policy_immutable' using errcode='55000'; end if;
  if OLD.mode='SCANNER_REQUIRED' and NEW.mode<>'SCANNER_REQUIRED' then
    raise exception 'document_scanner_downgrade_denied' using errcode='55000'; end if;
  if NEW.mode='SCANNER_REQUIRED' and
    (not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
      or pg_catalog.to_regclass('storage.buckets') is null
      or not exists(select 1 from storage.buckets where id='bx1-portal-quarantine')) then
    raise exception 'document_scanner_activation_not_ready' using errcode='55000'; end if;
  NEW.changed_at:=pg_catalog.clock_timestamp();
  return NEW;
end $$;
create trigger bx1_document_lifecycle_activation before update or delete on bx1_private.document_lifecycle_policy
  for each row execute function bx1_private.guard_document_lifecycle_activation();

create table bx1_private.document_quarantine_items (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  storage_path text not null unique,
  kind text not null check(kind in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')),
  title text not null check(pg_catalog.length(title) between 1 and 160),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check(byte_size between 1 and 4194304),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  state text not null default 'QUARANTINED'
    check(state in ('QUARANTINED','SCANNED_CLEAN','REJECTED','PROMOTED')),
  scanner_id text,
  scanner_reference text,
  scanned_at timestamptz,
  promoted_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(storage_path=actor_id::text||'/'||id::text),
  check((state='QUARANTINED' and scanned_at is null and scanner_id is null and scanner_reference is null)
    or (state<>'QUARANTINED' and scanned_at is not null and scanner_id is not null and scanner_reference is not null)),
  check((state='PROMOTED')=(promoted_at is not null))
);
create table bx1_private.document_scan_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references bx1_private.document_quarantine_items(id) on delete restrict,
  scanner_id text not null,
  scanner_reference text not null,
  verdict text not null check(verdict in ('CLEAN','MALICIOUS')),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(scanner_id,scanner_reference),
  unique(document_id)
);
create table bx1_private.document_hold_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references bx1_private.document_quarantine_items(id) on delete restrict,
  action text not null check(action in ('PLACE','RELEASE')),
  reason text not null check(pg_catalog.length(reason) between 8 and 1000),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index bx1_document_hold_latest on bx1_private.document_hold_events(document_id,id desc);
create index bx1_document_quarantine_actor on bx1_private.document_quarantine_items(actor_id,created_at);

alter table bx1_private.document_lifecycle_policy enable row level security;
alter table bx1_private.document_quarantine_items enable row level security;
alter table bx1_private.document_scan_events enable row level security;
alter table bx1_private.document_hold_events enable row level security;
revoke all on bx1_private.document_lifecycle_policy,bx1_private.document_quarantine_items,
  bx1_private.document_scan_events,bx1_private.document_hold_events
  from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_document_scanner_writer;
revoke all on sequence bx1_private.document_scan_events_id_seq,
  bx1_private.document_hold_events_id_seq from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_document_scanner_writer;
create trigger bx1_document_scan_event_immutable before update or delete on bx1_private.document_scan_events
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_document_hold_event_immutable before update or delete on bx1_private.document_hold_events
  for each row execute function bx1_portal.immutable_record();

-- Client-readable policy mode has no document data. Existing MAIN grant seal
-- remains intact; only admitted TEST sessions can call this public wrapper.
create function public.bx1_document_lifecycle_mode() returns text
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.has_session() is not true then
    raise exception 'document_lifecycle_session_denied' using errcode='42501'; end if;
  return (select mode from bx1_private.document_lifecycle_policy where singleton);
end $$;
revoke all on function public.bx1_document_lifecycle_mode() from public,anon,authenticated,service_role;
do $$ begin
  if (select environment='TESTNET' and manual_test_review from bx1_portal.entry_configuration where singleton) then
    grant execute on function public.bx1_document_lifecycle_mode() to authenticated;
  end if;
end $$;

-- Scanner-required uploads never land in the final document bucket through
-- an authenticated browser route. Only an already CLEAN, hash-bound item may
-- be inserted there by the server's Storage API promotion path.
create or replace function bx1_portal.document_upload_allowed(object_name text, object_owner text, object_metadata jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_count bigint;
begin
  -- Synthetic direct uploads are TEST-only. MAIN must not accept private
  -- documents before an admitted scanner path, even if a client bypasses web.
  if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SYNTHETIC_TEST_ONLY'
    or not exists(select 1 from bx1_portal.entry_configuration
      where singleton and environment='TESTNET') then return false; end if;
  if bx1_portal.has_session() is not true or object_owner is distinct from v_actor::text
    or pg_catalog.split_part(object_name,'/',1) is distinct from v_actor::text then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal_document:'||v_actor::text,0));
  if bx1_portal.has_session() is not true then return false; end if;
  select count(*) into v_count from storage.objects o where o.bucket_id='bx1-portal-documents'
    and (o.owner_id=v_actor::text or pg_catalog.split_part(o.name,'/',1)=v_actor::text);
  return v_count<8;
end $$;

-- Storage's privileged completion bypasses RLS. The existing no-overwrite
-- rule remains, and a CLEAN intent only permits one exact final path.
create or replace function bx1_portal.guard_stored_document() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare v_owner text; v_count bigint; q bx1_private.document_quarantine_items; mode_now text;
begin
  if TG_OP<>'INSERT' then
    if OLD.bucket_id in ('bx1-portal-documents','bx1-portal-quarantine') then
      raise exception 'portal_document_immutable' using errcode='23514'; end if;
    if TG_OP='DELETE' then return OLD; end if;
  end if;
  if NEW.bucket_id='bx1-portal-quarantine' then
    if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SCANNER_REQUIRED'
      or NEW.name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'document_quarantine_unavailable' using errcode='23514'; end if;
    return NEW;
  end if;
  if NEW.bucket_id<>'bx1-portal-documents' then return NEW; end if;
  select mode into mode_now from bx1_private.document_lifecycle_policy where singleton;
  if mode_now='SCANNER_REQUIRED' then
    select * into q from bx1_private.document_quarantine_items i
      where i.storage_path=NEW.name and i.state='SCANNED_CLEAN' for share;
    if q.id is null or NEW.metadata->>'size' is distinct from q.byte_size::text
      or NEW.metadata->>'mimetype' is distinct from q.mime_type then
      raise exception 'document_scan_required' using errcode='23514'; end if;
    NEW.owner_id:=q.actor_id::text;
  end if;
  v_owner:=NEW.owner_id;
  if v_owner is null or v_owner !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.split_part(NEW.name,'/',1) is distinct from v_owner then
    raise exception 'portal_document_owner_required' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal_document:'||v_owner,0));
  select count(*) into v_count from storage.objects o where o.bucket_id='bx1-portal-documents'
    and (o.owner_id=v_owner or pg_catalog.split_part(o.name,'/',1)=v_owner);
  if v_count>=8 then raise exception 'portal_document_quota_exceeded' using errcode='23514'; end if;
  return NEW;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('bx1-portal-quarantine','bx1-portal-quarantine',false,4194304,
  array['application/pdf','image/png','image/jpeg'])
on conflict(id) do nothing;
-- No authenticated SELECT, INSERT, UPDATE or DELETE policy is added for the
-- quarantine bucket. Existing broad policies are constrained too.
create policy bx1_quarantine_no_browser_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'bx1-portal-quarantine');
create policy bx1_quarantine_no_browser_read on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'bx1-portal-quarantine');
create policy bx1_quarantine_no_browser_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'bx1-portal-quarantine') with check(bucket_id<>'bx1-portal-quarantine');
create policy bx1_quarantine_no_browser_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'bx1-portal-quarantine');

alter table bx1_private.document_upload_receipts
  drop constraint document_upload_receipts_validation_state_check;
alter table bx1_private.document_upload_receipts
  add constraint document_upload_receipts_validation_state_check
  check(validation_state in ('SYNTHETIC_UNSCANNED','SCANNED_CLEAN'));

-- The old receipt writer cannot mint a new synthetic receipt after scanner
-- mode is enabled, even if a stale web instance continues to call it.
create function bx1_private.guard_receipt_lifecycle() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if (select mode from bx1_private.document_lifecycle_policy where singleton)='SCANNER_REQUIRED'
    and NEW.validation_state<>'SCANNED_CLEAN' then
    raise exception 'document_scan_required' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_receipt_scan_guard before insert on bx1_private.document_upload_receipts
  for each row execute function bx1_private.guard_receipt_lifecycle();

create function bx1_private.register_quarantined_document(p_actor uuid,p_session uuid,p_id uuid,
  p_kind text,p_title text,p_sha256 text,p_size integer,p_mime text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items; v_path text;
begin
  if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SCANNER_REQUIRED'
    or p_actor is null or p_session is null or p_id is null
    or p_kind not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')
    or p_title is null or pg_catalog.length(p_title) not between 1 and 160
    or p_sha256 !~ '^[0-9a-f]{64}$' or p_size not between 1 and 4194304
    or p_mime not in ('application/pdf','image/png','image/jpeg') then
    raise exception 'document_quarantine_invalid' using errcode='22023'; end if;
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_actor and s.oauth_client_id is null
        and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
        and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and not exists(select 1 from public.bx1_profiles p where p.id=p_actor and p.status<>'ACTIVE')
        and (not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.status::text='verified')
          or (s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id
            and f.user_id=p_actor and f.status::text='verified')))) then
    raise exception 'document_quarantine_session_denied' using errcode='42501'; end if;
  v_path:=p_actor::text||'/'||p_id::text;
  if not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-quarantine'
    and o.name=v_path and o.metadata->>'size'=p_size::text and o.metadata->>'mimetype'=p_mime) then
    raise exception 'document_quarantine_storage_mismatch' using errcode='23514'; end if;
  insert into bx1_private.document_quarantine_items
    (id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type)
  values(p_id,p_actor,p_session,v_path,p_kind,p_title,p_sha256,p_size,p_mime)
  on conflict(id) do nothing;
  select * into q from bx1_private.document_quarantine_items where id=p_id for share;
  if q.id is null or q.actor_id is distinct from p_actor or q.storage_path is distinct from v_path
    or q.kind is distinct from p_kind or q.title is distinct from p_title or q.sha256 is distinct from p_sha256
    or q.byte_size is distinct from p_size or q.mime_type is distinct from p_mime then
    raise exception 'document_quarantine_conflict' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('id',q.id,'actor_id',q.actor_id,'storage_path',q.storage_path,
    'sha256',q.sha256,'size',q.byte_size,'mime_type',q.mime_type,'state',q.state);
end $$;

create function bx1_private.record_document_scan(p_id uuid,p_sha256 text,p_scanner text,
  p_reference text,p_verdict text,p_observed_at timestamptz) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items; e bx1_private.document_scan_events;
begin
  if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SCANNER_REQUIRED'
    or p_id is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_scanner is null or pg_catalog.length(p_scanner) not between 3 and 120
    or p_reference is null or pg_catalog.length(p_reference) not between 8 and 200
    or p_verdict not in ('CLEAN','MALICIOUS') or p_observed_at is null
    or p_observed_at>pg_catalog.clock_timestamp()+interval '5 minutes'
    or p_observed_at<pg_catalog.clock_timestamp()-interval '1 day' then
    raise exception 'document_scan_invalid' using errcode='22023'; end if;
  select * into q from bx1_private.document_quarantine_items where id=p_id for update;
  if q.id is null or q.sha256 is distinct from p_sha256 then
    raise exception 'document_scan_hash_mismatch' using errcode='23514'; end if;
  select * into e from bx1_private.document_scan_events where document_id=p_id;
  if e.id is not null then
    if e.scanner_id is distinct from p_scanner or e.scanner_reference is distinct from p_reference
      or e.verdict is distinct from p_verdict or e.sha256 is distinct from p_sha256
      or e.observed_at is distinct from p_observed_at then
      raise exception 'document_scan_replay_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('id',q.id,'state',q.state,'sha256',q.sha256,'storage_path',q.storage_path);
  end if;
  if q.state<>'QUARANTINED' then raise exception 'document_scan_state_conflict' using errcode='23514'; end if;
  insert into bx1_private.document_scan_events(document_id,scanner_id,scanner_reference,verdict,sha256,observed_at)
    values(p_id,p_scanner,p_reference,p_verdict,p_sha256,p_observed_at);
  update bx1_private.document_quarantine_items set
    state=case when p_verdict='CLEAN' then 'SCANNED_CLEAN' else 'REJECTED' end,
    scanner_id=p_scanner,scanner_reference=p_reference,scanned_at=p_observed_at where id=p_id;
  return pg_catalog.jsonb_build_object('id',q.id,'state',case when p_verdict='CLEAN' then 'SCANNED_CLEAN' else 'REJECTED' end,
    'sha256',q.sha256,'storage_path',q.storage_path);
end $$;

create function bx1_private.read_quarantined_document(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items;
begin
  select * into q from bx1_private.document_quarantine_items where id=p_id;
  if q.id is null then raise exception 'document_quarantine_not_found' using errcode='P0002'; end if;
  return pg_catalog.jsonb_build_object('id',q.id,'actor_id',q.actor_id,'storage_path',q.storage_path,
    'sha256',q.sha256,'size',q.byte_size,'mime_type',q.mime_type,'state',q.state);
end $$;

create function bx1_private.promote_scanned_document(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items; r bx1_private.document_upload_receipts;
begin
  if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SCANNER_REQUIRED' then
    raise exception 'document_scan_required' using errcode='23514'; end if;
  select * into q from bx1_private.document_quarantine_items where id=p_id for update;
  if q.id is null or q.state not in ('SCANNED_CLEAN','PROMOTED') then
    raise exception 'document_scan_required' using errcode='23514'; end if;
  if not exists(select 1 from bx1_private.document_scan_events e where e.document_id=q.id
    and e.verdict='CLEAN' and e.sha256=q.sha256 and e.scanner_id=q.scanner_id
    and e.scanner_reference=q.scanner_reference) then
    raise exception 'document_clean_event_required' using errcode='23514'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
    and o.name=q.storage_path and o.owner_id=q.actor_id::text
    and o.metadata->>'size'=q.byte_size::text and o.metadata->>'mimetype'=q.mime_type) then
    raise exception 'document_promoted_storage_mismatch' using errcode='23514'; end if;
  insert into bx1_private.document_upload_receipts
    (id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type,validation_state)
  values(q.id,q.actor_id,q.session_id,q.storage_path,q.kind,q.title,q.sha256,q.byte_size,q.mime_type,'SCANNED_CLEAN')
  on conflict(id) do nothing;
  select * into r from bx1_private.document_upload_receipts where id=q.id for share;
  if r.id is null or r.actor_id is distinct from q.actor_id or r.sha256 is distinct from q.sha256
    or r.storage_path is distinct from q.storage_path or r.validation_state<>'SCANNED_CLEAN' then
    raise exception 'document_promotion_receipt_conflict' using errcode='23514'; end if;
  insert into bx1_private.document_receipt_events(receipt_id,kind) values(q.id,'REGISTERED')
    on conflict do nothing;
  if q.state='SCANNED_CLEAN' then
    update bx1_private.document_quarantine_items set state='PROMOTED',promoted_at=pg_catalog.clock_timestamp()
      where id=q.id;
  end if;
  return pg_catalog.jsonb_build_object('id',q.id,'actor_id',q.actor_id,'storage_path',q.storage_path,
    'kind',q.kind,'title',q.title,'sha256',q.sha256,'size',q.byte_size,'mime_type',q.mime_type,
    'validation_state','SCANNED_CLEAN');
end $$;

-- Retention is deliberately indefinite until an approved per-document date is
-- recorded. A legal hold always blocks disposal. This is an eligibility guard,
-- not a byte-deletion path: the latter must call the Storage API with two-party
-- authority and then verify/reconcile the deleted object.
create function bx1_private.document_disposal_eligible(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.document_quarantine_items q
    where q.id=p_id and q.retention_until is not null and q.retention_until<=pg_catalog.clock_timestamp()
      and not exists(select 1 from bx1_private.document_hold_events h where h.document_id=q.id
        and h.id=(select max(last_h.id) from bx1_private.document_hold_events last_h where last_h.document_id=q.id)
        and h.action='PLACE'));
$$;

-- Applicant polling never exposes scanner identity, provider reference, or
-- quarantine bytes. A usable document manifest appears only after a scanned
-- receipt is fully promoted; the browser cannot infer CLEAN from a callback.
create function public.bx1_document_scan_status(document_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare q bx1_private.document_quarantine_items; r bx1_private.document_upload_receipts;
begin
  if bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then
    raise exception 'document_scan_status_denied' using errcode='42501'; end if;
  select * into q from bx1_private.document_quarantine_items
    where id=document_id and actor_id=auth.uid();
  if q.id is null then raise exception 'document_scan_status_not_found' using errcode='P0002'; end if;
  if q.state='PROMOTED' then
    select * into r from bx1_private.document_upload_receipts
      where id=q.id and actor_id=q.actor_id and validation_state='SCANNED_CLEAN';
    if r.id is null then raise exception 'document_scan_receipt_unavailable' using errcode='55000'; end if;
    return pg_catalog.jsonb_build_object('id',q.id,'state','SCANNED_CLEAN','document',
      pg_catalog.jsonb_build_object('id',r.id,'kind',r.kind,'title',r.title,
        'storage_path',r.storage_path,'sha256',r.sha256,'size',r.byte_size,'mime_type',r.mime_type));
  end if;
  return pg_catalog.jsonb_build_object('id',q.id,'state',
    case when q.state='SCANNED_CLEAN' then 'QUARANTINED' else q.state end);
end $$;
create function public.bx1_document_scan_queue() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  if bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then
    raise exception 'document_scan_queue_denied' using errcode='42501'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',q.id,'kind',q.kind,'title',q.title,
    'state',case when q.state='SCANNED_CLEAN' then 'QUARANTINED'
      when q.state='PROMOTED' then 'SCANNED_CLEAN' else q.state end,
    'created_at',q.created_at) order by q.created_at desc,q.id),'[]'::jsonb)
    into result from (select * from bx1_private.document_quarantine_items i
      where i.actor_id=auth.uid() order by i.created_at desc,i.id limit 100) q;
  return result;
end $$;
revoke all on function public.bx1_document_scan_status(uuid) from public,anon,authenticated,service_role;
revoke all on function public.bx1_document_scan_queue() from public,anon,authenticated,service_role;
do $$ begin
  if (select environment='TESTNET' and manual_test_review from bx1_portal.entry_configuration where singleton) then
    grant execute on function public.bx1_document_scan_status(uuid),public.bx1_document_scan_queue() to authenticated;
  end if;
end $$;

-- Existing synthetic TEST submission remains unchanged; scanner mode demands
-- the exact promoted receipt. Historical submitted evidence in the same
-- application remains readable and referencable, but is never relabelled clean.
create or replace function bx1_private.guard_application_document_receipts() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare d jsonb; r bx1_private.document_upload_receipts; env text; lifecycle_mode text;
begin
  if TG_OP='INSERT' then
    if NEW.status<>'SUBMITTED' then return NEW; end if;
  elsif NEW.status<>'SUBMITTED' or
    (OLD.status='SUBMITTED' and NEW.submitted_at is not distinct from OLD.submitted_at
      and NEW.details is not distinct from OLD.details and NEW.revision is not distinct from OLD.revision) then
    return NEW;
  end if;
  select mode into lifecycle_mode from bx1_private.document_lifecycle_policy where singleton;
  if lifecycle_mode='SYNTHETIC_TEST_ONLY'
    and not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced) then return NEW; end if;
  select environment into env from bx1_portal.entry_configuration where singleton;
  if lifecycle_mode='SYNTHETIC_TEST_ONLY' and env is distinct from 'TESTNET' then
    raise exception 'document_production_scan_required' using errcode='23514'; end if;
  if NEW.user_id is distinct from auth.uid() or pg_catalog.jsonb_typeof(NEW.details->'documents') is distinct from 'array'
    then raise exception 'document_receipt_actor_denied' using errcode='42501'; end if;
  for d in select * from pg_catalog.jsonb_array_elements(NEW.details->'documents') loop
    select * into r from bx1_private.document_upload_receipts where id=(d->>'id')::uuid for update;
    if r.id is not null then
      if r.actor_id is distinct from NEW.user_id or r.storage_path is distinct from d->>'storage_path'
        or r.kind is distinct from d->>'kind' or r.title is distinct from d->>'title'
        or r.sha256 is distinct from d->>'sha256' or r.byte_size is distinct from (d->>'size')::integer
        or r.mime_type is distinct from d->>'mime_type'
        or (lifecycle_mode='SYNTHETIC_TEST_ONLY'
          and r.validation_state not in ('SYNTHETIC_UNSCANNED','SCANNED_CLEAN'))
        or (lifecycle_mode='SCANNER_REQUIRED' and r.validation_state<>'SCANNED_CLEAN'
          and not exists(select 1 from bx1_portal.application_detail_versions v
            cross join lateral pg_catalog.jsonb_array_elements(v.details->'documents') old_d
            where v.application_id=NEW.id and old_d=d and v.submitted_at<NEW.submitted_at)) then
        raise exception 'document_receipt_mismatch' using errcode='23514'; end if;
      if exists(select 1 from bx1_private.document_application_bindings b
        where b.receipt_id=r.id and b.application_id<>NEW.id) then
        raise exception 'document_receipt_application_bound' using errcode='23514'; end if;
      insert into bx1_private.document_application_bindings(receipt_id,application_id,application_revision)
        values(r.id,NEW.id,NEW.revision) on conflict do nothing;
      insert into bx1_private.document_receipt_events(receipt_id,application_id,application_revision,kind)
        values(r.id,NEW.id,NEW.revision,'BOUND') on conflict do nothing;
    elsif not exists(select 1 from bx1_portal.application_detail_versions v
      cross join lateral pg_catalog.jsonb_array_elements(v.details->'documents') old_d
      where v.application_id=NEW.id and old_d=d and v.submitted_at<NEW.submitted_at) then
      raise exception 'document_receipt_required' using errcode='23514';
    end if;
  end loop;
  return NEW;
end $$;

create or replace function bx1_portal.object_readable(object_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_owner_prefix text; v_app record; policy_mode text; changed timestamptz; safe_document boolean;
begin
  if object_name is null or bx1_portal.entry_manual_review_enabled() is not true
    or bx1_portal.fresh_session() is not true
    or bx1_private.has_session_mfa() is not true
    or bx1_private.has_token_mfa() is not true then return false; end if;
  select mode,changed_at into policy_mode,changed from bx1_private.document_lifecycle_policy where singleton;
  if policy_mode='SCANNER_REQUIRED' then
    select exists(select 1 from bx1_private.document_upload_receipts r
      where r.storage_path=object_name and r.validation_state='SCANNED_CLEAN')
      or exists(select 1 from bx1_portal.application_detail_versions v
        cross join lateral pg_catalog.jsonb_array_elements(case
          when pg_catalog.jsonb_typeof(v.details->'documents')='array' then v.details->'documents'
          else '[]'::jsonb end) d(item)
        where d.item->>'storage_path'=object_name and v.submitted_at<changed)
      into safe_document;
    if not safe_document then return false; end if;
  end if;
  v_owner_prefix:=pg_catalog.split_part(object_name,'/',1);
  if v_owner_prefix=auth.uid()::text then return true; end if;
  if v_owner_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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

revoke all on function bx1_private.guard_receipt_lifecycle(),
  bx1_private.guard_document_lifecycle_activation(),
  bx1_private.register_quarantined_document(uuid,uuid,uuid,text,text,text,integer,text),
  bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz),
  bx1_private.read_quarantined_document(uuid),
  bx1_private.promote_scanned_document(uuid),bx1_private.document_disposal_eligible(uuid)
  from public,anon,authenticated,service_role;
grant execute on function bx1_private.register_quarantined_document(uuid,uuid,uuid,text,text,text,integer,text),
  bx1_private.document_disposal_eligible(uuid)
  to bx1_document_receipt_writer;
grant execute on function bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz),
  bx1_private.read_quarantined_document(uuid),bx1_private.promote_scanned_document(uuid)
  to bx1_document_scanner_writer;
