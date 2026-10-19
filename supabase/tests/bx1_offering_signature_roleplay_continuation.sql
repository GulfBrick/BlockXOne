-- Source installation and denial proof only. No fabricated session, approval,
-- signature, provider result, account, document, role or policy is inserted.
do $signature_roleplay_continuation_proof$
declare role_name text;action_name text;target oid;guard_source text;before_claims text;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'signature_roleplay_continuation_proof_test_owner_required';end if;
  target:=pg_catalog.to_regprocedure('bx1_private.test_roleplay_role_actions(text)');
  if target is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=target
    and p.proowner='postgres'::regrole::oid and not p.prosecdef and p.provolatile='i'
    and p.proacl::text='{postgres=X/postgres}' and p.proconfig=array['search_path=""']
    and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      ='d8007ad89d4eae76b9cb050089989b8b29af7065544f79c7e4b99846dc92459a') then
    raise exception 'signature_roleplay_continuation_proof_map_invalid';end if;
  foreach role_name in array array['OfferingManager','IssuerFundManager','ComplianceOfficer'] loop
    foreach action_name in array array['REQUEST_RECONCILIATION','REQUEST_RECOVERY'] loop
      if not action_name=any(bx1_private.test_roleplay_role_actions(role_name)) then
        raise exception 'signature_roleplay_continuation_expected_action_missing';end if;
    end loop;
  end loop;
  foreach role_name in array array['Investor','SuperAdmin','TokenisationAgent','TransferAgent','TreasuryOperator','FinancialController','unknown'] loop
    if bx1_private.test_roleplay_role_actions(role_name)&&array['REQUEST_RECONCILIATION','REQUEST_RECOVERY'] then
      raise exception 'signature_roleplay_continuation_unrelated_role_widened';end if;
  end loop;
  foreach role_name in array array['OfferingManager','ComplianceOfficer'] loop
    if 'REQUEST_SIGNING_VIEW'=any(bx1_private.test_roleplay_role_actions(role_name)) then
      raise exception 'signature_roleplay_continuation_signer_role_widened';end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,'bx1_private.test_roleplay_role_actions(text)','EXECUTE') then
      raise exception 'signature_roleplay_continuation_private_map_exposed';end if;
  end loop;
  select prosrc into guard_source from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(
    'bx1_private.test_roleplay_current(uuid,uuid,uuid,uuid,jsonb,text,text,integer)');
  if guard_source is null or strpos(guard_source,'p_action=any(capacity.actions)')=0
    or strpos(guard_source,'p_action=any(bx1_private.test_roleplay_role_actions(capacity.role))')=0 then
    raise exception 'signature_roleplay_continuation_saved_policy_action_guard_missing';end if;
  before_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  if bx1_private.test_roleplay_current(null,null,null,null,'{"mode":"APPLICANT"}'::jsonb,
      'REQUEST_RECOVERY',null,null) is not false
    or bx1_private.test_roleplay_current(null,null,null,null,'{"mode":"ROLE"}'::jsonb,
      'REQUEST_RECONCILIATION',null,null) is not false then
    raise exception 'signature_roleplay_continuation_missing_authority_not_denied';end if;
  if before_claims is distinct from pg_catalog.current_setting('request.jwt.claims',true) then
    raise exception 'signature_roleplay_continuation_proof_changed_claims';end if;
end $signature_roleplay_continuation_proof$;
