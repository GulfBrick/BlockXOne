-- Synthetic PostgreSQL17 cloud proof. Execute in the existing disposable
-- rollback-only fixture after 20260924125811. No live document is touched.
do $$
declare role_name text; body text; row_count bigint;
begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres' then
    raise exception 'document_governance_disposable_fixture_required'; end if;
  if not exists(select 1 from pg_catalog.pg_class c
    where c.oid='bx1_private.document_governance_events'::pg_catalog.regclass
      and c.relrowsecurity) then
    raise exception 'document_governance_rls_missing'; end if;
  select count(*) into row_count from bx1_private.document_governance_events;
  if row_count<>0 then raise exception 'document_governance_migration_seeded_events'; end if;
  if (select count(*) from bx1_private.document_retention_admission
      where singleton and policy_version=0 and state='NOT_ADMITTED')<>1
    or not (select c.relrowsecurity from pg_catalog.pg_class c
      where c.oid='bx1_private.document_retention_admission'::pg_catalog.regclass) then
    raise exception 'document_retention_policy_not_fail_closed'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint c
    where c.conrelid='bx1_private.document_governance_events'::pg_catalog.regclass
      and c.contype='f' and pg_catalog.pg_get_constraintdef(c.oid)
        like '%(actor_id, actor_person_id)%') then
    raise exception 'document_governance_canonical_person_fk_missing'; end if;
  if (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
      where p.oid='bx1_private.document_governance_trusted_person(uuid,uuid)'::pg_catalog.regprocedure)
      is distinct from 'bx1_authority_owner'
    or not pg_catalog.has_function_privilege('postgres',
      'bx1_private.document_governance_trusted_person(uuid,uuid)','EXECUTE') then
    raise exception 'document_governance_lock_helper_owner_invalid'; end if;
  foreach role_name in array array['anon','authenticated','service_role',
    'bx1_document_receipt_writer','bx1_document_scanner_writer'] loop
    if pg_catalog.has_table_privilege(role_name,'bx1_private.document_governance_events',
      'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'document_governance_raw_table_grant_%',role_name; end if;
    if pg_catalog.has_function_privilege(role_name,
      'bx1_private.document_disposal_authorised(uuid)','EXECUTE') then
      raise exception 'document_disposal_authority_exposed_%',role_name; end if;
    if pg_catalog.has_function_privilege(role_name,
      'bx1_private.document_governance_trusted_person(uuid,uuid)','EXECUTE') then
      raise exception 'document_governance_lock_helper_exposed_%',role_name; end if;
    if pg_catalog.has_table_privilege(role_name,'bx1_private.document_retention_admission',
      'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'document_retention_admission_exposed_%',role_name; end if;
  end loop;
  if pg_catalog.has_function_privilege('anon',
    'public.bx1_document_governance_command(uuid,jsonb,uuid,text,text,timestamptz,bigint)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'public.bx1_document_governance_command(uuid,jsonb,uuid,text,text,timestamptz,bigint)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'public.bx1_document_governance_state(uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'public.bx1_document_governance_state(uuid,jsonb)','EXECUTE') then
    raise exception 'document_governance_public_bypass'; end if;
  if (select environment='TESTNET' and manual_test_review
      from bx1_portal.entry_configuration where singleton)
    is distinct from pg_catalog.has_function_privilege('authenticated',
      'public.bx1_document_governance_command(uuid,jsonb,uuid,text,text,timestamptz,bigint)','EXECUTE')
    or (select environment='TESTNET' and manual_test_review
      from bx1_portal.entry_configuration where singleton)
    is distinct from pg_catalog.has_function_privilege('authenticated',
      'public.bx1_document_governance_state(uuid,jsonb)','EXECUTE') then
    raise exception 'document_governance_environment_grant_invalid'; end if;
  body:=pg_catalog.pg_get_functiondef(
    'public.bx1_document_governance_command(uuid,jsonb,uuid,text,text,timestamptz,bigint)'::pg_catalog.regprocedure);
  if body not like '%has_recent_administration_totp%'
    or body not like '%representative_mandate_actor%'
    or body not like '%document_governance_trusted_person%'
    or body not like '%actor_person_id,actor_membership_id,application_revision%'
    or body not like '%request_event.actor_person_id=actor_person%'
    or body not like '%request_event.application_revision<>a.revision%'
    or body not like '%request_event.review_expires_at<=v_now%'
    or body not like '%requester_authority_lost%'
    or body not like '%document_retention_policy_unconfigured%'
    or body not like '%document_disposal_eligible%'
    or body not like '%document_governance_independent_approval_denied%'
    or body not like '%insert into bx1_private.document_governance_events%'
    or body not like '%document_hold_events%' then
    raise exception 'document_governance_command_guard_missing'; end if;
  body:=pg_catalog.pg_get_functiondef(
    'bx1_private.document_disposal_authorised(uuid)'::pg_catalog.regprocedure);
  if body not like '%SCANNED_CLEAN%' or body not like '%document_disposal_eligible%'
    or body not like '%DISPOSAL_APPROVED%' or body not like '%storage.objects%'
    or body not like '%request.actor_person_id<>approval.actor_person_id%'
    or body not like '%document_retention_admission%'
    or body not like '%approval.created_at>pg_catalog.clock_timestamp()-interval%'
    then
    raise exception 'document_disposal_authorisation_guard_missing'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.guard_stored_document()'::pg_catalog.regprocedure);
  if body not like '%portal_document_immutable%' then
    raise exception 'storage_delete_guard_weakened'; end if;
  if bx1_private.document_disposal_authorised('f1010000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'missing_document_authorised_for_disposal'; end if;
  -- The preceding lifecycle fixture may contain a clean, expired, released
  -- synthetic object. Legacy eligibility alone must not authorise disposal.
  if exists(select 1 from bx1_private.document_quarantine_items
      where id='ed420000-0000-4000-8000-000000000001'::uuid)
    and bx1_private.document_disposal_authorised(
      'ed420000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'legacy_retention_without_approval_authorised_disposal'; end if;
  begin
    perform public.bx1_document_governance_command(
      'f1010000-0000-4000-8000-000000000001'::uuid,
      '{"mode":"ROLE","role":"ComplianceOfficer","organisationId":"f1020000-0000-4000-8000-000000000001"}'::jsonb,
      'f1030000-0000-4000-8000-000000000001'::uuid,
      'DISPOSAL_REQUESTED','Synthetic denied command');
    raise exception 'unauthenticated_disposal_request_accepted';
  exception when insufficient_privilege then
    if SQLERRM<>'document_governance_denied' then raise; end if;
  end;
end $$;
