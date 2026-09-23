-- Stage 2 document integrity increment. A browser-authenticated RPC cannot
-- attest to bytes it uploaded itself; the web server must use a separate,
-- restricted Postgres LOGIN credential, provisioned after this migration.
-- The policy starts unenforced to preserve existing TEST synthetic submissions
-- until that credential is installed and verified. MAIN remains sealed.
create role bx1_document_receipt_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema bx1_private to bx1_document_receipt_writer;

create table bx1_private.document_receipt_policy (
  singleton boolean primary key default true check(singleton),
  enforced boolean not null default false,
  changed_at timestamptz not null default clock_timestamp()
);
insert into bx1_private.document_receipt_policy(singleton,enforced) values(true,false);
create table bx1_private.document_upload_receipts (
  id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  storage_path text not null unique,
  kind text not null check(kind in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')),
  title text not null check(length(title) between 1 and 160),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check(byte_size between 1 and 4194304),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  validation_state text not null default 'SYNTHETIC_UNSCANNED' check(validation_state='SYNTHETIC_UNSCANNED'),
  verified_at timestamptz not null default clock_timestamp(),
  check(storage_path=actor_id::text||'/'||id::text)
);
create table bx1_private.document_application_bindings (
  receipt_id uuid not null references bx1_private.document_upload_receipts(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  application_revision integer not null check(application_revision>0),
  bound_at timestamptz not null default clock_timestamp(),
  primary key(receipt_id,application_id,application_revision)
);
create table bx1_private.document_receipt_events (
  id bigint generated always as identity primary key,
  receipt_id uuid not null references bx1_private.document_upload_receipts(id) on delete restrict,
  application_id uuid references bx1_portal.applications(id) on delete restrict,
  application_revision integer,
  kind text not null check(kind in ('REGISTERED','BOUND')),
  created_at timestamptz not null default clock_timestamp(),
  check((kind='REGISTERED' and application_id is null and application_revision is null)
    or (kind='BOUND' and application_id is not null and application_revision>0))
);
create unique index bx1_document_registered_once on bx1_private.document_receipt_events(receipt_id) where kind='REGISTERED';
create unique index bx1_document_bound_once on bx1_private.document_receipt_events(receipt_id,application_id,application_revision) where kind='BOUND';
create index bx1_document_binding_application on bx1_private.document_application_bindings(application_id,application_revision);

alter table bx1_private.document_receipt_policy enable row level security;
alter table bx1_private.document_upload_receipts enable row level security;
alter table bx1_private.document_application_bindings enable row level security;
alter table bx1_private.document_receipt_events enable row level security;
revoke all on bx1_private.document_receipt_policy,bx1_private.document_upload_receipts,
  bx1_private.document_application_bindings,bx1_private.document_receipt_events
  from public,anon,authenticated,service_role,bx1_document_receipt_writer;
revoke all on sequence bx1_private.document_receipt_events_id_seq from public,anon,authenticated,service_role,bx1_document_receipt_writer;
create trigger bx1_document_receipt_immutable before update or delete on bx1_private.document_upload_receipts
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_document_binding_immutable before update or delete on bx1_private.document_application_bindings
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_document_event_immutable before update or delete on bx1_private.document_receipt_events
  for each row execute function bx1_portal.immutable_record();

-- Only this narrow server credential may register a receipt. It supplies the
-- authenticated actor/session and a digest of bytes that the web server just
-- uploaded and independently downloaded from Storage. No browser RPC grant.
create function bx1_private.register_document_receipt(
  p_actor uuid,p_session uuid,p_id uuid,p_kind text,p_title text,
  p_sha256 text,p_byte_size integer,p_mime_type text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r bx1_private.document_upload_receipts; path text;
begin
  if not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
    or p_actor is null or p_session is null or p_id is null
    or not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_actor and s.oauth_client_id is null
        and (s.not_after is null or s.not_after>clock_timestamp()) and u.email_confirmed_at is not null
        and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=clock_timestamp())
        and not exists(select 1 from public.bx1_profiles p where p.id=p_actor and p.status<>'ACTIVE')
        and (not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.status::text='verified')
          or (s.aal::text='aal2' and exists(select 1 from auth.mfa_factors f where f.id=s.factor_id
            and f.user_id=p_actor and f.status::text='verified')))) then
    raise exception 'document_receipt_session_denied' using errcode='42501'; end if;
  if p_kind not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')
    or length(p_title) not between 1 and 160 or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_size not between 1 and 4194304
    or p_mime_type not in ('application/pdf','image/png','image/jpeg') then
    raise exception 'document_receipt_invalid' using errcode='22023'; end if;
  path:=p_actor::text||'/'||p_id::text;
  perform o.id from storage.objects o where o.bucket_id='bx1-portal-documents' and o.name=path
    and o.owner_id=p_actor::text and o.metadata->>'size'=p_byte_size::text
    and o.metadata->>'mimetype'=p_mime_type for share;
  if not found then raise exception 'document_receipt_storage_mismatch' using errcode='23514'; end if;
  insert into bx1_private.document_upload_receipts
    (id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type)
    values(p_id,p_actor,p_session,path,p_kind,p_title,p_sha256,p_byte_size,p_mime_type)
    on conflict(id) do nothing;
  select * into r from bx1_private.document_upload_receipts where id=p_id for share;
  if r.id is null or r.actor_id is distinct from p_actor or r.storage_path is distinct from path
    or r.kind is distinct from p_kind or r.title is distinct from p_title or r.sha256 is distinct from p_sha256
    or r.byte_size is distinct from p_byte_size or r.mime_type is distinct from p_mime_type then
    raise exception 'document_receipt_conflict' using errcode='23514'; end if;
  insert into bx1_private.document_receipt_events(receipt_id,kind) values(r.id,'REGISTERED')
    on conflict do nothing;
  return pg_catalog.jsonb_build_object('id',r.id,'actor_id',r.actor_id,'storage_path',r.storage_path,
    'kind',r.kind,'title',r.title,'sha256',r.sha256,'size',r.byte_size,'mime_type',r.mime_type,
    'validation_state',r.validation_state);
end $$;

-- Public policy read contains no document data; it fails closed for an invalid
-- Supabase session. Before this function exists, the web route may treat only
-- PostgREST's missing-function error as the pre-migration legacy policy.
create function public.bx1_document_receipts_required() returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.has_session() is not true then raise exception 'document_policy_session_denied' using errcode='42501'; end if;
  return coalesce((select enforced from bx1_private.document_receipt_policy where singleton),true);
end $$;

-- The post-mandate entry_command wrapper still calls entry_submit; this trigger
-- binds exact receipts without replacing either command implementation.
create function bx1_private.guard_application_document_receipts() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare d jsonb; r bx1_private.document_upload_receipts; env text;
begin
  if TG_OP='INSERT' then
    if NEW.status<>'SUBMITTED' then return NEW; end if;
  elsif NEW.status<>'SUBMITTED' or
    (OLD.status='SUBMITTED' and NEW.submitted_at is not distinct from OLD.submitted_at
      and NEW.details is not distinct from OLD.details and NEW.revision is not distinct from OLD.revision) then
    return NEW;
  end if;
  if not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced) then return NEW; end if;
  select environment into env from bx1_portal.entry_configuration where singleton;
  if env is distinct from 'TESTNET' then raise exception 'document_production_scan_required' using errcode='23514'; end if;
  if NEW.user_id is distinct from auth.uid() or jsonb_typeof(NEW.details->'documents') is distinct from 'array'
    then raise exception 'document_receipt_actor_denied' using errcode='42501'; end if;
  for d in select * from pg_catalog.jsonb_array_elements(NEW.details->'documents') loop
    -- A receipt is one application's evidence. Serialize concurrent attempts
    -- to bind the same actor-owned upload to different capacities.
    select * into r from bx1_private.document_upload_receipts where id=(d->>'id')::uuid for update;
    if r.id is not null then
      if r.actor_id is distinct from NEW.user_id or r.storage_path is distinct from d->>'storage_path'
        or r.kind is distinct from d->>'kind' or r.title is distinct from d->>'title'
        or r.sha256 is distinct from d->>'sha256' or r.byte_size is distinct from (d->>'size')::integer
        or r.mime_type is distinct from d->>'mime_type' or r.validation_state<>'SYNTHETIC_UNSCANNED' then
        raise exception 'document_receipt_mismatch' using errcode='23514'; end if;
      if exists(select 1 from bx1_private.document_application_bindings b
        where b.receipt_id=r.id and b.application_id<>NEW.id) then
        raise exception 'document_receipt_application_bound' using errcode='23514'; end if;
      insert into bx1_private.document_application_bindings(receipt_id,application_id,application_revision)
        values(r.id,NEW.id,NEW.revision) on conflict do nothing;
      insert into bx1_private.document_receipt_events(receipt_id,application_id,application_revision,kind)
        values(r.id,NEW.id,NEW.revision,'BOUND') on conflict do nothing;
    elsif not exists(
      select 1 from bx1_portal.application_detail_versions v
      cross join lateral pg_catalog.jsonb_array_elements(v.details->'documents') old_d
      where v.application_id=NEW.id and old_d=d and v.submitted_at<NEW.submitted_at
    ) then
      -- Already-submitted historical evidence remains usable by the SAME
      -- application only. New browser-only uploads cannot bypass the writer.
      raise exception 'document_receipt_required' using errcode='23514';
    end if;
  end loop;
  return NEW;
end $$;
create trigger bx1_application_document_receipts before insert or update on bx1_portal.applications
  for each row execute function bx1_private.guard_application_document_receipts();

revoke all on function bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text),
  bx1_private.guard_application_document_receipts(),public.bx1_document_receipts_required()
  from public,anon,authenticated,service_role;
grant execute on function bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)
  to bx1_document_receipt_writer;
grant execute on function public.bx1_document_receipts_required() to authenticated;
-- No LOGIN/password or Vercel secret is created by this migration. Sequence:
-- disposable cloud SQL proof; provision the dedicated LOGIN and hosted secret;
-- temporarily enable policy in TEST; run hosted exact-byte/reviewer proof;
-- retain TEST enforcement only on success, otherwise turn it back off. MAIN
-- remains sealed pending its separate scanning/admission implementation.
