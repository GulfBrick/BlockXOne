-- Run after the feature in the isolated cloud fixture. These are database
-- boundary/definition checks, NOT genuine Supabase MFA or Amoy acceptance.
do $setup_contract$
declare rel text;role_name text;signature text;definition text;keys text[];
  original_claims text;denied boolean;before_count integer;proof jsonb;field text;
begin
  if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'setup_test_requires_test_configuration';end if;
  foreach rel in array array['fund_setups','fund_setup_steps','fund_setup_requests','fund_setup_transaction_attempts','fund_setup_observations','fund_setup_events'] loop
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=('bx1_portal.'||rel)::regclass and c.relrowsecurity) then
      raise exception 'setup_rls_missing_%',rel;end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_portal.'||rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'setup_raw_table_privilege_%_%',rel,role_name;end if;
    end loop;
    execute pg_catalog.format('select count(*) from bx1_portal.%I',rel) into before_count;
    if before_count<>0 then raise exception 'setup_feature_seeded_records_%',rel;end if;
  end loop;
  select pg_catalog.array_agg(step_key order by ordinal) into keys from bx1_portal.fund_setup_graph();
  if keys is distinct from array['token_implementation','ctr_implementation','irs_implementation','ir_implementation',
    'tir_implementation','mc_implementation','oid_implementation','oid_authority','oid_factory','trex_authority','trex_version',
    'trex_factory','ia_factory','trex_factory_binding','ia_factory_binding','oid_factory_binding','controller','factory_handoff',
    'trex_authority_handoff','oid_authority_handoff','oid_factory_handoff','holding_module','claim_issuer','token_identity','settlement'] then
    raise exception 'setup_graph_order_changed';end if;
  if (select count(*) from bx1_portal.fund_setup_graph() where kind='CREATE')<>17
    or (select count(*) from bx1_portal.fund_setup_graph() where kind='CALL')<>8 then raise exception 'setup_graph_count_changed';end if;

  foreach signature in array array['bx1_portal.read_fund_setup_preparation(uuid,text,integer,text,uuid,jsonb)',
    'bx1_portal.prepare_fund_setup_step(jsonb,jsonb)','bx1_portal.read_fund_setup_observation(uuid,uuid,integer,uuid,jsonb)',
    'bx1_portal.record_fund_setup_observation(jsonb,jsonb)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'setup_worker_publicly_callable_%_%',signature,role_name;end if;
    end loop;
    if not pg_catalog.has_function_privilege('bx1_fund_execution_worker',signature,'EXECUTE') then raise exception 'setup_worker_rpc_missing_%',signature;end if;
  end loop;
  foreach signature in array array['public.bx1_portal_fund_setup_read(uuid,jsonb)',
    'public.bx1_portal_fund_setup_command(text,uuid,jsonb,jsonb)','public.bx1_portal_fund_setup_authorise(uuid,integer,jsonb)'] loop
    if not pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'setup_client_rpc_missing_%',signature;end if;
    foreach role_name in array array['anon','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'setup_client_rpc_wrong_grantee_%_%',signature,role_name;end if;
    end loop;
  end loop;
  foreach signature in array array['bx1_portal.fund_setup_context(jsonb,uuid,boolean)','bx1_portal.fund_setup_worker_enter(uuid,uuid,jsonb,boolean)',
    'bx1_portal.fund_setup_lock(jsonb,uuid,boolean)','bx1_portal.fund_setup_preparation(uuid,text,integer,text,uuid,jsonb)',
    'bx1_portal.fund_setup_observation_request(uuid,uuid,integer,uuid,jsonb)','bx1_portal.fund_setup_audit(uuid,uuid,text,integer,integer,jsonb)'] loop
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'setup_internal_helper_leak_%_%',signature,role_name;end if;
    end loop;
  end loop;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.fund_setup_context(jsonb,uuid,boolean)'::regprocedure);
  if definition not like '%auth.sessions%' or definition not like '%auth.mfa_factors%' or definition not like '%verified%'
    or definition not like '%totp%' or definition not like '%aal2%' or definition not like '%fegnnnlseuejkrusbbkv%'
    or definition like '%fund_person(%' then raise exception 'setup_actual_factor_or_person_boundary_changed';end if;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.fund_setup_command(text,uuid,jsonb,jsonb)'::regprocedure);
  if definition not like '%state=''UNKNOWN''%' or definition not like '%FUND_SETUP_%'
    or definition not like '%idempotency_conflict%' or definition not like '%expected_step_revision%'
    or definition not like '%fund_setup_audit%' then raise exception 'setup_command_invariants_missing';end if;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.fund_setup_authorise(uuid,integer,jsonb)'::regprocedure);
  if definition not like '%fund_setup_lock(c,s.product_id,true)%' or definition not like '%actor_claims=auth.jwt()%'
    or definition like '%set revision=%' or definition like '%set intent=%' then raise exception 'setup_session_refresh_expands_authority';end if;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.record_fund_setup_observation(jsonb,jsonb)'::regprocedure);
  if definition not like '%fund_setup_observers_valid%' or definition not like '%final_effect_required%'
    or definition not like '%382117f5d97745f611e05f827603aadb493dc620%'
    or definition not like '%FUND_SETUP_RECOVERY_REQUIRED%' or definition not like '%recovery_hold=true%'
    or definition like '%insert into bx1_portal.fund_release_manifests%' or definition like '%status=''ADMITTED''%' then
    raise exception 'setup_observation_fabricates_admission_or_lacks_binding';end if;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.prepare_fund_setup_step(jsonb,jsonb)'::regprocedure);
  if definition not like '%t.intent is distinct from intent%' or definition not like '%FUND_SETUP_REFRESH_STEP%'
    or definition not like '%claimed_at is not null%' or definition like '%state=''NOT_STARTED''%' then
    raise exception 'setup_renewal_must_preserve_exact_unclaimed_intent';end if;
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.fund_setup_mutation_guard()'::regprocedure);
  if definition not like '%NEW.nonce%' or definition not like '%OLD.claimed_at%' or definition not like '%NEW.expires_at>OLD.expires_at%'
    or definition not like '%fund_setup_prepared_identity_immutable%' then raise exception 'setup_immutable_history_guard_missing';end if;
  if (select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid='bx1_portal.fund_setup_nonce_lease'::regclass)
    not like '%UNIQUE%sender, nonce%WHERE (nonce IS NOT NULL)%' then raise exception 'setup_nonce_lease_not_durable';end if;

  -- Two fixed independent observation sources; duplicated sources are rejected.
  if bx1_portal.fund_setup_observers_valid('{"providers":[{"url":"https://polygon-amoy.drpc.org","finalized_block_number":"40","finalized_block_hash":"0x1111111111111111111111111111111111111111111111111111111111111111"},{"url":"https://polygon-amoy.drpc.org","finalized_block_number":"40","finalized_block_hash":"0x1111111111111111111111111111111111111111111111111111111111111111"}]}') then
    raise exception 'setup_duplicate_provider_accepted';end if;
  if bx1_portal.fund_setup_observers_valid('{"providers":[]}') then raise exception 'setup_no_provider_accepted';end if;
  if bx1_portal.fund_setup_observers_valid('{"providers":[{"url":"https://polygon-amoy.drpc.org","finalized_block_number":"40","finalized_block_hash":null},{"url":"https://polygon-amoy-bor-rpc.publicnode.com","finalized_block_number":"40","finalized_block_hash":"0x1111111111111111111111111111111111111111111111111111111111111111"}]}') then
    raise exception 'setup_json_null_provider_hash_accepted';end if;
  proof:='{"version":1,"chain_id":80002,"status":"FINAL","step_key":"token_implementation","intent_hash":"abababababababababababababababababababababababababababababababab","transaction_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","block_number":"40","block_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","block_timestamp":"2026-10-14T10:00:00Z","runtime_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","checks":[]}'::jsonb;
  if bx1_portal.fund_setup_result_shape(proof,'STEP') is not true then raise exception 'setup_final_shape_positive_control_failed';end if;
  foreach field in array array['block_number','block_hash','block_timestamp','runtime_hash','checks','transaction_hash','intent_hash'] loop
    if bx1_portal.fund_setup_result_shape(pg_catalog.jsonb_set(proof,array[field],'null'::jsonb),'STEP') is not false then
      raise exception 'setup_final_json_null_accepted_%',field;end if;
  end loop;
  proof:='{"version":1,"chain_id":80002,"status":"VERIFIED_CODE_AND_STATE","release_version":"1.4.1","release_source_commit":"382117f5d97745f611e05f827603aadb493dc620","address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","runtime_hash":"0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c","singleton":{"address":"0x41675c099f32341bf84bfc5382af534df5c7461a","runtime_hash":"0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4"},"nonce":"0","block_number":"40","block_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","catalog_hash":"abababababababababababababababababababababababababababababababab"}'::jsonb;
  if bx1_portal.fund_setup_result_shape(proof,'SAFE') is not true then raise exception 'setup_safe_shape_positive_control_failed';end if;
  foreach field in array array['release_version','release_source_commit','address','runtime_hash','nonce','block_number','block_hash','catalog_hash','singleton'] loop
    if bx1_portal.fund_setup_result_shape(pg_catalog.jsonb_set(proof,array[field],'null'::jsonb),'SAFE') is not false then
      raise exception 'setup_safe_json_null_accepted_%',field;end if;
  end loop;
  foreach field in array array['address','runtime_hash'] loop
    if bx1_portal.fund_setup_result_shape(pg_catalog.jsonb_set(proof,array['singleton',field],'null'::jsonb),'SAFE') is not false then
      raise exception 'setup_safe_singleton_json_null_accepted_%',field;end if;
  end loop;
  original_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  if bx1_portal.fund_setup_context('{"mode":"APPLICANT"}',pg_catalog.gen_random_uuid(),true) then raise exception 'setup_unauthed_mfa_accepted';end if;
  denied:=false;
  begin perform public.bx1_portal_fund_setup_command('CREATE',pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object('product_id',pg_catalog.gen_random_uuid(),'expected_revision',1),'{"mode":"APPLICANT"}');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'setup_applicant_can_create';end if;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(original_claims,''),true);
end $setup_contract$;
