-- Current-factor opt-in MFA. No role, financial or institutional signing grants.
-- Apply transactionally after the identity and wallet migrations. Auth is read
-- only: this migration does not enroll, remove, reset or modify anyone's factors.
-- The original has_active_session() remains the live identity/revocation base.

create function bx1_private.has_session_mfa()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select bx1_private.has_active_session()) and (
    not exists (select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified')
    or exists (
      select 1 from auth.sessions s
      join auth.mfa_factors f on f.id = s.factor_id and f.user_id = s.user_id
      where s.user_id = (select auth.uid())
        and s.id::text = ((select auth.jwt()) ->> 'session_id')
        and s.aal = 'aal2' and f.status = 'verified'
    )
  );
$$;

create function bx1_private.has_token_mfa()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select bx1_private.has_session_mfa()) and (
    not exists (select 1 from auth.mfa_factors f
      where f.user_id = (select auth.uid()) and f.status = 'verified')
    or coalesce(((select auth.jwt()) ->> 'aal') = 'aal2', false)
  );
$$;

-- The private wallet verifier passes authenticated identity/session identifiers,
-- not a browser-provided AAL assertion. These calls retain their existing trust
-- boundary: server exact-token checks, then this fresh session/factor guard.
-- A revocation committed after the wallet's final guard snapshot cannot cancel
-- an already-authorized in-flight transaction; no stronger guarantee is made.
create or replace function bx1_private.can_access_organisation(target_organisation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select bx1_private.has_active_session())
    and (select bx1_private.has_session_mfa()) and exists (
      select 1 from public.bx1_memberships m
      join public.bx1_organisations o on o.id = m.organisation_id
      where m.user_id = (select auth.uid())
        and m.organisation_id = target_organisation
        and m.status = 'ACTIVE' and o.status = 'ACTIVE'
    );
$$;

-- No actor arguments and no Auth rows/identifiers/secrets leave this boundary.
-- Bootstrap deliberately avoids can_access_organisation and MFA-gated RLS so an
-- enrolled AAL1 user can complete their challenge. It is not a workspace grant.
create function bx1_private.read_mfa_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  current_aal text;
  current_factor_type text;
  requires_factor boolean;
  current_mfa boolean;
begin
  if not bx1_private.has_active_session() or not exists (
    select 1 from public.bx1_memberships m
    join public.bx1_organisations o on o.id = m.organisation_id
    where m.user_id = (select auth.uid())
      and m.status = 'ACTIVE' and o.status = 'ACTIVE'
  ) then
    return pg_catalog.jsonb_build_object('active',false,'requires_mfa',false,
      'session_aal',null,'session_is_mfa',false,'session_is_totp',false);
  end if;
  select s.aal::text, f.factor_type::text into current_aal, current_factor_type
  from auth.sessions s
  left join auth.mfa_factors f on f.id = s.factor_id
    and f.user_id = s.user_id and f.status = 'verified'
  where s.user_id = (select auth.uid())
    and s.id::text = ((select auth.jwt()) ->> 'session_id');
  select exists (select 1 from auth.mfa_factors f
    where f.user_id = (select auth.uid()) and f.status = 'verified') into requires_factor;
  current_mfa := coalesce(current_aal = 'aal2' and current_factor_type is not null, false);
  return pg_catalog.jsonb_build_object('active',true,'requires_mfa',requires_factor,
    'session_aal',current_aal,'session_is_mfa',current_mfa,
    'session_is_totp',current_mfa and coalesce(current_factor_type = 'totp',false));
end;
$$;

create function public.bx1_mfa_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select bx1_private.read_mfa_status();
$$;

revoke all on function bx1_private.has_session_mfa(), bx1_private.has_token_mfa(),
  bx1_private.read_mfa_status(), public.bx1_mfa_status()
  from public, anon, authenticated, service_role, bx1_wallet_owner, bx1_wallet_verifier;
grant execute on function bx1_private.has_token_mfa(), bx1_private.read_mfa_status(),
  public.bx1_mfa_status() to authenticated;

create policy bx1_profile_mfa_read on public.bx1_profiles
as restrictive for select to authenticated using ((select bx1_private.has_token_mfa()));
create policy bx1_organisation_mfa_read on public.bx1_organisations
as restrictive for select to authenticated using ((select bx1_private.has_token_mfa()));
create policy bx1_membership_mfa_read on public.bx1_memberships
as restrictive for select to authenticated using ((select bx1_private.has_token_mfa()));

-- Hosted postgres is not superuser; temporarily inherit the existing table owner
-- for this DDL only, then restore the original NOINHERIT/non-SET membership.
-- No Auth/table data grants or permanent owner capabilities are introduced.
grant bx1_wallet_owner to current_user with inherit true, set false;
create policy bx1_wallet_mfa_read on public.bx1_wallets
as restrictive for select to authenticated using ((select bx1_private.has_token_mfa()));
grant bx1_wallet_owner to current_user with inherit false, set false;

comment on function public.bx1_mfa_status() is 'Caller-only active identity and current-factor session status for MFA bootstrap. No workspace, role or financial authority.';
comment on function bx1_private.has_token_mfa() is 'Opt-in MFA requires signed JWT AAL2 plus live session bound to a current verified own factor. No verified factors preserves ordinary access.';
comment on function bx1_private.has_session_mfa() is 'Current-factor live-session guard for private wallet calls. The trusted application separately verifies exact-token assurance.';
