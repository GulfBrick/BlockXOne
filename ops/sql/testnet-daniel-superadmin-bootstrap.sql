-- One-time TEST-only assignment requested by the platform owner.
-- Apply through the TEST Supabase migration recorder; never run on MAIN.
-- This grants a native TEST SuperAdmin membership only. It does not create
-- a trusted-person mapping, authority scope, governance grant or MFA factor.
do $$
declare
  target_user auth.users%rowtype;
  target_organisation uuid;
begin
  if current_user <> 'postgres' then
    raise exception 'test_bootstrap_operator_required' using errcode='42501';
  end if;

  select cfg.reviewer_scope into target_organisation
    from bx1_portal.entry_configuration cfg
    where cfg.singleton and cfg.environment='TESTNET' and cfg.manual_test_review;
  if target_organisation is null or not exists (
    select 1 from public.bx1_organisations o
    where o.id=target_organisation and o.status='ACTIVE'
  ) then
    raise exception 'test_bootstrap_environment_required' using errcode='55000';
  end if;

  if (select count(*) from auth.users u where lower(u.email)='daniel@bx1.co.za') <> 1 then
    raise exception 'test_bootstrap_exact_user_required' using errcode='55000';
  end if;
  select * into strict target_user from auth.users u
    where lower(u.email)='daniel@bx1.co.za';
  if target_user.email_confirmed_at is null or target_user.deleted_at is not null
    or (target_user.banned_until is not null and target_user.banned_until>clock_timestamp())
    or not exists (
      select 1 from public.bx1_profiles p
      where p.id=target_user.id and p.status='ACTIVE'
    )
    or not exists (
      select 1 from public.bx1_memberships m
      where m.user_id=target_user.id and m.organisation_id=target_organisation
        and m.role='Investor' and m.status='ACTIVE'
    ) then
    raise exception 'test_bootstrap_active_identity_required' using errcode='55000';
  end if;
  if exists (
    select 1 from public.bx1_memberships m
    where m.user_id=target_user.id and m.role='SuperAdmin'
  ) then
    raise exception 'test_bootstrap_existing_superadmin' using errcode='23505';
  end if;

  insert into public.bx1_memberships(user_id,organisation_id,role,status)
    values(target_user.id,target_organisation,'SuperAdmin','ACTIVE');
end $$;
