-- Cloud disposable PostgreSQL installation/negative guards only. No records,
-- grants, factors, transactions or provider evidence are fabricated here.
do $proof$
declare table_name text; role_name text; signature text; original_claims text; result boolean;
begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres'
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'test_roleplay_proof_requires_disposable_test_fixture' using errcode='55000'; end if;
  foreach table_name in array array['roleplay_owner_receipts','roleplay_people','roleplay_operators','roleplay_policies',
    'roleplay_capacities','roleplay_wallet_slots','roleplay_events'] loop
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bx1_private' and c.relname=table_name and c.relrowsecurity) then
      raise exception 'roleplay_private_rls_missing: %',table_name using errcode='55000'; end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_private.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'roleplay_raw_access_not_closed: % %',role_name,table_name using errcode='55000'; end if;
    end loop;
    execute pg_catalog.format('select exists(select 1 from bx1_private.%I)',table_name) into result;
    if result then raise exception 'roleplay_install_seeded_records: %',table_name using errcode='55000'; end if;
  end loop;
  foreach signature in array array[
    'bx1_private.test_roleplay_provision(uuid,uuid,jsonb)',
    'bx1_private.test_roleplay_create_person(uuid,text,uuid)',
    'bx1_private.test_roleplay_current(uuid,uuid,uuid,uuid,jsonb,text,text,integer)',
    'bx1_private.test_roleplay_person(uuid,uuid)',
    'bx1_private.test_roleplay_projection(jsonb,uuid)',
    'bx1_private.test_roleplay_lock(jsonb,uuid,text,text)',
    'bx1_private.test_roleplay_record_event(uuid,text,uuid,jsonb,jsonb)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'roleplay_internal_writer_callable: % %',role_name,signature using errcode='55000'; end if;
    end loop;
  end loop;
  foreach role_name in array array['Investor','OfferingManager','IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController'] loop
    if 'revoke_test_roleplay'=any(bx1_private.test_roleplay_role_actions(role_name)) then
      raise exception 'roleplay_nonadmin_revoke_action_admitted: %',role_name using errcode='55000'; end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,'bx1_private.test_roleplay_revoke_allowed(uuid,jsonb)','EXECUTE') then
      raise exception 'roleplay_revoke_helper_callable: %',role_name using errcode='55000'; end if;
  end loop;
  foreach signature in array array['public.bx1_test_roleplay_read(uuid,jsonb)','public.bx1_test_roleplay_revoke(uuid,jsonb,text)'] loop
    if not pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'roleplay_guarded_boundary_missing: %',signature using errcode='55000'; end if;
    foreach role_name in array array['anon','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'roleplay_unauthenticated_boundary_open: % %',role_name,signature using errcode='55000'; end if;
    end loop;
  end loop;
  if not ('FUND_SETUP'=any(bx1_private.test_roleplay_role_actions('OfferingManager')))
    or not ('FUND_SETUP'=any(bx1_private.test_roleplay_role_actions('TokenisationAgent')))
    or 'FUND_SETUP'=any(bx1_private.test_roleplay_role_actions('Investor'))
    or 'EVIDENCE_FINALIZED'=any(bx1_private.test_roleplay_role_actions('SuperAdmin'))
    or pg_catalog.cardinality(bx1_private.test_roleplay_role_actions('unknown'))<>0 then
    raise exception 'roleplay_action_allowlist_incorrect' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.persons'::regclass and tgname='bx1_persons_immutable')
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.persons'::regclass
      and tgname='bx1_test_roleplay_person_provenance' and tgdeferrable and tginitdeferred) then
    raise exception 'roleplay_identity_immutability_or_provenance_missing' using errcode='55000'; end if;
  original_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  if bx1_private.test_roleplay_protected_session() is not false
    or bx1_private.test_roleplay_current(null,null,null,null,'{"mode":"ROLE"}'::jsonb,'FUND_SETUP',null,null) is not false
    or bx1_private.test_roleplay_projection('{"mode":"ROLE"}'::jsonb,null) is not null
    or bx1_private.test_roleplay_person(null,null) is not null then
    raise exception 'roleplay_missing_auth_claims_not_denied' using errcode='55000'; end if;
  perform pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","aal":"aal1","iss":"https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1"}',true);
  if bx1_private.test_roleplay_protected_session() is not false then
    raise exception 'roleplay_aal1_not_denied' using errcode='55000'; end if;
  perform pg_catalog.set_config('request.jwt.claims','{"role":"authenticated","aal":"aal2","iss":"https://oqkevkjbkpugjotihtda.supabase.co/auth/v1"}',true);
  if bx1_private.test_roleplay_protected_session() is not false then
    raise exception 'roleplay_main_issuer_not_denied' using errcode='55000'; end if;
  begin
    perform public.bx1_test_roleplay_read('00000000-0000-4000-8000-000000000001','{"mode":"APPLICANT"}'::jsonb);
    raise exception 'roleplay_unassured_read_was_accepted' using errcode='55000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bx1_test_roleplay_revoke('00000000-0000-4000-8000-000000000001','{"mode":"APPLICANT"}'::jsonb,'Synthetic denial must not produce a revoke event.');
    raise exception 'roleplay_unassured_revoke_was_accepted' using errcode='55000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bx1_test_roleplay_revoke('00000000-0000-4000-8000-000000000001','{"mode":"ROLE","role":"SuperAdmin"}'::jsonb,null);
    raise exception 'roleplay_null_revoke_reason_was_accepted' using errcode='55000';
  exception when insufficient_privilege then
    if SQLERRM<>'test_roleplay_revoke_mfa_or_reason_required' then raise; end if;
  end;
  if bx1_private.test_roleplay_revoke_allowed('00000000-0000-4000-8000-000000000001','{"mode":"ROLE","role":"Investor"}'::jsonb) is not false
    or bx1_private.test_roleplay_revoke_allowed('00000000-0000-4000-8000-000000000001','{"mode":"ROLE","role":"SuperAdmin"}'::jsonb) is not false then
    raise exception 'roleplay_unassured_revoke_authority_was_accepted' using errcode='55000'; end if;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(original_claims,''),true);
end $proof$;
