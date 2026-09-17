-- Human identity and read-only workspace only. No financial or chain privileges.
-- Auth and service roles cannot bootstrap or modify assignments through Data API.
-- No IF NOT EXISTS: conflicting objects must stop a deployment for review.
create schema bx1_private;
revoke all on schema bx1_private from public, anon, authenticated, service_role;
grant usage on schema bx1_private to authenticated;

create table public.bx1_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  platform_user_id uuid not null unique default pg_catalog.gen_random_uuid(),
  display_name text check (char_length(display_name) <= 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now()
);
create table public.bx1_organisations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now()
);
create table public.bx1_memberships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.bx1_profiles(id) on delete restrict,
  organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  role text not null check (role in (
    'Investor', 'OfferingManager', 'ComplianceOfficer', 'IssuerFundManager',
    'TransferAgent', 'TokenisationAgent', 'TreasuryOperator',
    'FinancialController', 'SuperAdmin'
  )),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  unique (user_id, organisation_id, role)
);
create index bx1_memberships_organisation_idx on public.bx1_memberships(organisation_id);

create function bx1_private.prevent_identity_remap()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.platform_user_id is distinct from old.platform_user_id then
    raise exception 'business identity mapping is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function bx1_private.prevent_identity_remap() from public, anon, authenticated, service_role;
create trigger bx1_profile_identity_immutable before update on public.bx1_profiles
for each row execute function bx1_private.prevent_identity_remap();

-- Narrow definer lookup prevents recursive RLS and never accepts caller-selected
-- user/session IDs. PostgREST verifies the signed JWT before setting auth claims.
create function bx1_private.has_active_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    join public.bx1_profiles p on p.id = u.id
    where s.user_id = (select auth.uid())
      and s.id::text = ((select auth.jwt()) ->> 'session_id')
      and (s.not_after is null or s.not_after > now())
      and s.oauth_client_id is null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and p.status = 'ACTIVE'
  );
$$;
create function bx1_private.can_access_organisation(target_organisation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select bx1_private.has_active_session()) and exists (
    select 1
    from public.bx1_memberships m
    join public.bx1_organisations o on o.id = m.organisation_id
    where m.user_id = (select auth.uid())
      and m.organisation_id = target_organisation
      and m.status = 'ACTIVE' and o.status = 'ACTIVE'
  );
$$;
revoke all on function bx1_private.has_active_session() from public, anon, authenticated, service_role;
revoke all on function bx1_private.can_access_organisation(uuid) from public, anon, authenticated, service_role;
grant execute on function bx1_private.has_active_session() to authenticated;
grant execute on function bx1_private.can_access_organisation(uuid) to authenticated;

alter table public.bx1_profiles enable row level security;
alter table public.bx1_organisations enable row level security;
alter table public.bx1_memberships enable row level security;
revoke all on public.bx1_profiles, public.bx1_organisations, public.bx1_memberships
  from public, anon, authenticated, service_role;
grant select on public.bx1_profiles, public.bx1_organisations, public.bx1_memberships to authenticated;

create policy bx1_profile_self_read on public.bx1_profiles for select to authenticated
using (id = (select auth.uid()) and (select bx1_private.has_active_session()));
create policy bx1_organisation_member_read on public.bx1_organisations for select to authenticated
using (bx1_private.can_access_organisation(id));
create policy bx1_membership_self_read on public.bx1_memberships for select to authenticated
using (user_id = (select auth.uid()) and status = 'ACTIVE'
  and bx1_private.can_access_organisation(organisation_id));

comment on schema bx1_private is 'Private policy predicates; must never be added to Data API exposed schemas.';
comment on table public.bx1_profiles is 'Immutable Auth-to-business actor mapping; assignments managed only by reviewed administrative bootstrap.';
comment on function bx1_private.has_active_session() is 'Caller-bound first-party live Auth session and active user/profile predicate. Deleted/revoked sessions deny immediately.';
