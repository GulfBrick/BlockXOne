-- Stage 1 release-admission definitions. Apply transactionally after bx1_entry.
-- No configuration or business rows are seeded and no existing TEST grant is
-- widened/revoked by installing these definitions alone.
--
-- Fresh MAIN baseline recipe, as ONE transaction before app release:
--   1. Verify exact native prerequisites and empty portal namespace.
--   2. If MAIN lacks person_principals, install the exact empty canonical
--      20260918234447 controlled-administration dependency, then canonical
--      portal + authority/account bridge + entry features. New administration
--      RPCs are closed below; no authority bootstrap accompanies the dependency.
--   3. Install these admission definitions.
--   4. Record entry_configuration MAINNET/manual_test_review=false with the
--      reviewed release receipt (no reviewer route, no user/role/business seed).
--   5. Invoke bx1_portal.seal_entry_only_baseline() and verify the ACL manifest.
--   6. Commit only after zero new business rows and native-history preservation.
-- Existing TEST installs use the same definitions, retaining independently
-- admitted manual rehearsal config and exact existing legacy/funding ACLs.

create function bx1_portal.guard_entry_storage_admission() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  -- Storage's privileged final completion bypasses RLS. Guard the persisted row
  -- as well as the user request, without affecting any other storage bucket.
  if NEW.bucket_id='bx1-portal-documents' and bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'entry_document_collection_not_admitted' using errcode='55000';
  end if;
  return NEW;
end $$;
create trigger bx1_entry_storage_admission before insert on storage.objects
  for each row execute function bx1_portal.guard_entry_storage_admission();
revoke all on function bx1_portal.guard_entry_storage_admission() from public,anon,authenticated,service_role;

-- Narrow privileged release operation: can only remove legacy capabilities
-- from an empty, unadmitted MAIN baseline. It cannot grant customer roles,
-- activate business workflows, or convert an operating TEST project to MAIN.
create function bx1_portal.seal_entry_only_baseline() returns void
language plpgsql security invoker set search_path='' as $$
declare operation record; owner_edge record; owner_edges_before jsonb; owner_edges_after jsonb;
begin
  if not exists(select 1 from bx1_portal.entry_configuration
    where singleton and environment='MAINNET' and not manual_test_review and reviewer_scope is null) then
    raise exception 'entry_unadmitted_main_configuration_required' using errcode='55000';
  end if;
  if exists(select 1 from bx1_portal.applications)
    or exists(select 1 from bx1_portal.organisations)
    or exists(select 1 from bx1_portal.organisation_authority_bindings)
    or exists(select 1 from bx1_portal.investment_accounts)
    or exists(select 1 from bx1_portal.products)
    or exists(select 1 from bx1_portal.subscriptions)
    or exists(select 1 from storage.objects where bucket_id='bx1-portal-documents')
    or pg_catalog.to_regclass('bx1_portal.funding_obligations') is not null then
    raise exception 'entry_baseline_is_not_empty' using errcode='55000';
  end if;
  -- Scope is exact: native auth/MFA/workspace/wallet objects are untouched.
  -- Revoke the private helpers too; public-only revocation is not a complete
  -- boundary if exposed-schema settings are subsequently broadened.
  for operation in select p.oid::regprocedure signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' or (n.nspname='public' and left(p.proname,11)='bx1_portal_')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',operation.signature);
  end loop;
  revoke all on all tables in schema bx1_portal from public,anon,authenticated,service_role;
  -- The canonical baseline added portal-specific Storage policies. Their
  -- helpers are no longer executable after sealing, and PostgreSQL is free to
  -- validate function privileges before a bucket predicate. Do not leave dead
  -- helper references that could break existing unrelated authenticated buckets.
  -- Preserve every pre-existing unrelated policy and the helper-free immutable
  -- UPDATE/DELETE guards; only this transaction's exact portal policies change.
  drop policy bx1_portal_document_insert on storage.objects;
  drop policy bx1_portal_document_read on storage.objects;
  drop policy bx1_portal_document_insert_guard on storage.objects;
  drop policy bx1_portal_document_read_guard on storage.objects;
  create policy bx1_portal_document_insert_guard on storage.objects as restrictive
    for insert to authenticated with check(bucket_id<>'bx1-portal-documents');
  create policy bx1_portal_document_read_guard on storage.objects as restrictive
    for select to authenticated using(bucket_id<>'bx1-portal-documents');
  grant usage on schema bx1_portal to authenticated;
  grant execute on function bx1_portal.entry_read(),bx1_portal.entry_command(text,uuid,jsonb),
    public.bx1_entry_read(),public.bx1_entry_command(text,uuid,jsonb) to authenticated;
  -- The canonical person-principal dependency adds two guarded admin RPCs.
  -- They are deliberately not admitted by this entry-only bootstrap. Restore
  -- every pre-existing role edge after temporarily inheriting the owner role
  -- needed to revoke its private helper grants on hosted non-superuser Postgres.
  select coalesce(jsonb_agg(to_jsonb(e) order by grantor),'[]'::jsonb) into owner_edges_before
    from (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
      where roleid='bx1_authority_owner'::regrole and member=current_user::regrole) e;
  select * into owner_edge from pg_catalog.pg_auth_members
    where roleid='bx1_authority_owner'::regrole and member=current_user::regrole and grantor=current_user::regrole;
  grant bx1_authority_owner to current_user with inherit true,set true granted by current_user;
  revoke all on function bx1_private.read_administration(uuid,uuid),bx1_private.execute_administration(uuid,uuid,jsonb),
    public.bx1_administration_read(uuid,uuid),public.bx1_administration_command(uuid,uuid,jsonb)
    from public,anon,authenticated,service_role;
  if owner_edge.roleid is not null then
    execute format('grant bx1_authority_owner to %I with admin %s, inherit %s, set %s granted by %I',current_user,
      case when owner_edge.admin_option then 'true' else 'false' end,
      case when owner_edge.inherit_option then 'true' else 'false' end,
      case when owner_edge.set_option then 'true' else 'false' end,current_user);
  else
    execute format('revoke bx1_authority_owner from %I granted by %I',current_user,current_user);
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by grantor),'[]'::jsonb) into owner_edges_after
    from (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
      where roleid='bx1_authority_owner'::regrole and member=current_user::regrole) e;
  if owner_edges_after is distinct from owner_edges_before then
    raise exception 'entry_authority_owner_edges_not_restored' using errcode='55000';
  end if;
end $$;
revoke all on function bx1_portal.seal_entry_only_baseline() from public,anon,authenticated,service_role;
