-- Isolated cloud installation/negative-boundary proof only. These assertions
-- are not real Supabase MFA, Amoy execution, eligibility or ownership evidence.
do $recipient_contract$
declare rel text;role_name text;signature text;body text;count_before integer;denied boolean;claims text;
 proof jsonb;field text;altered jsonb;
begin
 if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then raise exception 'recipient_test_requires_test';end if;
 foreach rel in array array['fund_recipient_cases','fund_recipient_operations','fund_recipient_claim_signatures','fund_recipient_claim_verifications',
  'fund_recipient_safe_signatures','fund_recipient_safe_verifications','fund_recipient_observations','fund_recipient_requests','fund_recipient_events'] loop
  if not exists(select 1 from pg_catalog.pg_class where oid=('bx1_portal.'||rel)::regclass and relrowsecurity) then raise exception 'recipient_rls_missing_%',rel;end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
   if pg_catalog.has_table_privilege(role_name,'bx1_portal.'||rel,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'recipient_raw_grant_%_%',rel,role_name;end if;
  end loop;
  execute pg_catalog.format('select count(*) from bx1_portal.%I',rel) into count_before;
  if count_before<>0 then raise exception 'recipient_records_seeded_%',rel;end if;
 end loop;
 foreach signature in array array['bx1_portal.read_fund_recipient_preparation(uuid,integer,uuid,jsonb)',
  'bx1_portal.prepare_fund_recipient_operation(jsonb,jsonb)','bx1_portal.read_fund_recipient_observation(uuid,integer,uuid,jsonb)',
  'bx1_portal.record_fund_recipient_observation(jsonb,jsonb)','bx1_portal.read_fund_recipient_claim(uuid,integer,uuid,jsonb)',
  'bx1_portal.record_fund_recipient_claim(jsonb,jsonb)','bx1_portal.read_fund_recipient_signature(uuid)',
  'bx1_portal.record_fund_recipient_signature(uuid,jsonb)','bx1_portal.read_fund_recipient_execution(uuid,integer,uuid,jsonb)'] loop
  if not pg_catalog.has_function_privilege('bx1_fund_execution_worker',signature,'EXECUTE') then raise exception 'recipient_worker_grant_missing_%',signature;end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'recipient_worker_grant_leaked_%_%',signature,role_name;end if;
  end loop;
 end loop;
 foreach signature in array array['public.bx1_portal_fund_recipient_read(uuid,jsonb)','public.bx1_portal_fund_recipient_find(uuid,jsonb)',
  'public.bx1_portal_fund_recipient_command(text,uuid,jsonb,jsonb)','public.bx1_portal_fund_recipient_claim_signing_request(uuid,jsonb)'] loop
  if not pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'recipient_client_grant_missing_%',signature;end if;
  foreach role_name in array array['anon','service_role','bx1_fund_execution_worker'] loop
   if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'recipient_client_grant_leaked_%_%',signature,role_name;end if;
  end loop;
 end loop;
 foreach signature in array array['bx1_portal.fund_recipient_expectation(uuid)','bx1_portal.fund_recipient_worker_enter(uuid,uuid,jsonb)',
  'bx1_portal.fund_recipient_current(uuid,jsonb,text)','bx1_portal.fund_recipient_lock(uuid,jsonb,text)','bx1_portal.fund_recipient_result_shape(jsonb)',
  'bx1_private.lock_fund_recipient_wallet(uuid,uuid)','bx1_portal.fund_recipient_ready_for_allocation(uuid)'] loop
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
   if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then raise exception 'recipient_helper_leaked_%_%',signature,role_name;end if;
  end loop;
 end loop;
 if (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc where oid='bx1_private.lock_fund_recipient_wallet(uuid,uuid)'::regprocedure)
  is distinct from 'bx1_wallet_owner' then raise exception 'recipient_native_wallet_owner_wrong';end if;
 if bx1_portal.fund_recipient_country('ZA') is distinct from 710 or bx1_portal.fund_recipient_country('GB') is distinct from 826
  or bx1_portal.fund_recipient_country('US') is distinct from 840 or bx1_portal.fund_recipient_country('XX') is not null then raise exception 'recipient_country_mapping_wrong';end if;

 body:=pg_catalog.pg_get_functiondef('bx1_portal.fund_recipient_session()'::regprocedure);
 if body not like '%auth.sessions%' or body not like '%auth.mfa_factors%' or body not like '%fegnnnlseuejkrusbbkv%' or body not like '%aal2%'
  or body like '%fund_person(%' then raise exception 'recipient_actual_test_session_missing';end if;
 body:=pg_catalog.pg_get_functiondef('bx1_portal.fund_recipient_lock(uuid,jsonb,text)'::regprocedure);
 if body not like '%for share of app%' or body not like '%lock_fund_recipient_wallet%' or body not like '%authority_changed_after_wait%'
  or body not like '%test_roleplay_lock%' then raise exception 'recipient_after_wait_locks_missing';end if;
 body:=pg_catalog.pg_get_functiondef('bx1_portal.fund_recipient_command(text,uuid,jsonb,jsonb)'::regprocedure);
 if body not like '%state=''UNKNOWN''%' or body not like '%original_hash_immutable_recovery_required%' or body not like '%fund_recipient_audit%'
  or body not like '%idempotency_conflict%' or body like '%set status=''APPROVED''%' or body like '%fund_register_entries%' then raise exception 'recipient_command_boundary_wrong';end if;
 body:=pg_catalog.pg_get_functiondef('bx1_portal.fund_new_operation(jsonb,uuid,uuid,uuid,uuid)'::regprocedure);
 if body not like '%union all select ro.safe_nonce%' or body not like '%fund_recipient_operations ro%' or body not like '%bx1_fund_safe:%' then raise exception 'recipient_shared_nonce_counter_missing';end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.fund_setup_steps'::regclass and tgname='fund_recipient_setup_nonce_boundary')
  or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.fund_operations'::regclass and tgname='fund_recipient_safe_nonce_boundary') then raise exception 'recipient_cross_family_nonce_triggers_missing';end if;
 if bx1_portal.fund_recipient_ready_for_allocation('10000000-0000-4000-8000-000000000001') is not false then raise exception 'recipient_missing_allocation_ready';end if;
 body:=pg_catalog.pg_get_functiondef('bx1_portal.fund_recipient_ready_for_allocation(uuid)'::regprocedure);
 if body not like '%r.eligibility_revision=a.eligibility_revision%' or body not like '%r.state=''READY''%' or body not like '%registration_observation_id%'
  or body not like '%registry_verified%' or body not like '%claim_verifications%' then raise exception 'recipient_issuance_readiness_binding_missing';end if;

 -- Positive evidence shape uses labelled synthetic literals only. Every null
 -- below must be rejected; no structural helper writes or manufactures facts.
 proof:=pg_catalog.jsonb_build_object('version',1,'chain_id',80002,'operation_id','10000000-0000-4000-8000-000000000001',
  'operation_revision',1,'phase','REGISTER_IDENTITY','expectation_hash',pg_catalog.repeat('a',64),
  'transaction_hash','0x'||pg_catalog.repeat('b',64),'identity_address','0x'||pg_catalog.repeat('c',40),
  'claim_data_hash','0x'||pg_catalog.repeat('d',64),'claim_id','0x'||pg_catalog.repeat('e',64),'expiry_enforced_on_chain',false,
  'status','FINAL','reason_code',null,'block_number','40','block_hash','0x'||pg_catalog.repeat('f',64),
  'block_timestamp','2026-10-15T00:00:00Z','transaction_index',0,'inner_execution_success',true,'registry_verified',true,
  'providers',pg_catalog.jsonb_build_array(
   pg_catalog.jsonb_build_object('url','https://polygon-amoy.drpc.org','finalized_block_number','41','finalized_block_hash','0x'||pg_catalog.repeat('1',64)),
   pg_catalog.jsonb_build_object('url','https://polygon-amoy-bor-rpc.publicnode.com','finalized_block_number','43','finalized_block_hash','0x'||pg_catalog.repeat('2',64))));
 if bx1_portal.fund_recipient_result_shape(proof) is not true then raise exception 'recipient_positive_shape_control_failed';end if;
 foreach field in array array['version','chain_id','operation_id','operation_revision','phase','expectation_hash','transaction_hash','identity_address',
  'claim_data_hash','claim_id','expiry_enforced_on_chain','status','block_number','block_hash','block_timestamp','transaction_index','inner_execution_success','registry_verified','providers'] loop
  if bx1_portal.fund_recipient_result_shape(pg_catalog.jsonb_set(proof,array[field],'null')) is not false
   or bx1_portal.fund_recipient_result_shape(proof-field) is not false then raise exception 'recipient_null_shape_accepted_%',field;end if;
 end loop;
 foreach field in array array['url','finalized_block_number','finalized_block_hash'] loop
  altered:=pg_catalog.jsonb_set(proof,array['providers','0',field],'null');
  if bx1_portal.fund_recipient_result_shape(altered) is not false then raise exception 'recipient_null_provider_accepted_%',field;end if;
 end loop;
 altered:=pg_catalog.jsonb_set(proof,'{providers,1}',proof#>'{providers,0}');
 if bx1_portal.fund_recipient_result_shape(altered) is not false then raise exception 'recipient_same_observer_accepted';end if;
 if bx1_portal.fund_recipient_result_shape(pg_catalog.jsonb_set(proof,'{block_hash}',pg_catalog.to_jsonb('0x'||pg_catalog.repeat('0',64)))) is not false then raise exception 'recipient_zero_canonical_hash_accepted';end if;

 claims:=pg_catalog.current_setting('request.jwt.claims',true);perform pg_catalog.set_config('request.jwt.claims','{}',true);
 if bx1_portal.fund_recipient_session() is not false then raise exception 'recipient_no_session_accepted';end if;
 denied:=false;begin perform public.bx1_portal_fund_recipient_command(null,null,null,'{"mode":"APPLICANT"}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'recipient_null_command_accepted';end if;
 denied:=false;begin perform public.bx1_portal_fund_recipient_find('10000000-0000-4000-8000-000000000001','{"mode":"APPLICANT"}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'recipient_unowned_binding_exposed';end if;
 denied:=false;begin perform bx1_portal.read_fund_recipient_execution('10000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000002','{"mode":"APPLICANT"}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'recipient_missing_executor_accepted';end if;
 perform pg_catalog.set_config('request.jwt.claims',coalesce(claims,''),true);
end $recipient_contract$;
