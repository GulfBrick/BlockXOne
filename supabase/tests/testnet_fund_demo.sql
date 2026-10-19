-- Synthetic serial PostgreSQL proof ONLY. Never run against hosted identities.
-- Cloud harness owns the outer BEGIN/ROLLBACK and loads Auth-shape fixtures,
-- existing identity/wallet/MFA migrations (optionally admin) and fund migration.
savepoint testnet_fund_demo_fixture;
insert into auth.users(id) values
  ('d1000000-0000-4000-8000-000000000001'),('d1000000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,not_after) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now()+interval '1 hour'),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',now()+interval '1 hour');
insert into public.bx1_profiles(id,display_name) values
  ('d1000000-0000-4000-8000-000000000001','Synthetic fund presenter A'),
  ('d1000000-0000-4000-8000-000000000002','Synthetic fund presenter B');
insert into public.bx1_organisations(id,name) values
  ('d3000000-0000-4000-8000-000000000001','Synthetic fund organisation A'),
  ('d3000000-0000-4000-8000-000000000002','Synthetic fund organisation B');
insert into public.bx1_memberships(user_id,organisation_id,role) values
  ('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Investor'),
  ('d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002','Investor');

-- These test identities intentionally have no enrolled factors: the demo does
-- not invent new MFA requirements or bootstrap production role authority.
do $$
declare
  v_result jsonb; v_replay jsonb; v_payload jsonb; v_fund uuid; v_subscription_a uuid; v_subscription_b uuid;
  v_mint_a uuid; v_mint_b uuid; v_redemption_a uuid; v_redemption_b uuid; v_burn_a uuid; v_burn_b uuid;
  v_key uuid; v_create_key uuid:=gen_random_uuid(); v_funding_key uuid:=gen_random_uuid(); v_prepare_key uuid:=gen_random_uuid();
  v_wallet_a text:='0x1111111111111111111111111111111111111111';
  v_wallet_b text:='0x2222222222222222222222222222222222222222';
  v_contract text:='0x3333333333333333333333333333333333333333';
  v_hash_deploy text:='0x'||repeat('1',64); v_hash_mint_a text:='0x'||repeat('2',64); v_hash_mint_b text:='0x'||repeat('3',64);
  v_hash_burn_a text:='0x'||repeat('4',64); v_hash_burn_b text:='0x'||repeat('5',64);
  v_denied boolean; v_count integer; v_checks integer:=0; v_before jsonb; v_distribution uuid;
  v_actor uuid:='d1000000-0000-4000-8000-000000000001'; v_session uuid:='d2000000-0000-4000-8000-000000000001';
begin
  if has_function_privilege('authenticated','public.bx1_demo_confirm_chain(uuid,text,bigint,text,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.bx1_demo_bind_contract(uuid,text,text,text,uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.bx1_demo_confirm_chain(uuid,text,bigint,text,uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.bx1_demo_bind_contract(uuid,text,text,text,uuid,uuid)','EXECUTE')
    or has_schema_privilege('authenticated','bx1_demo','USAGE')
    or has_schema_privilege('bx1_demo_chain_verifier','bx1_demo','USAGE')
    or has_table_privilege('bx1_demo_chain_verifier','bx1_demo.holdings','UPDATE')
    or has_table_privilege('service_role','bx1_demo.holdings','UPDATE') then raise exception 'demo_test_service_boundary'; end if;
  v_checks:=v_checks+8;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','d1000000-0000-4000-8000-000000000001','session_id','d2000000-0000-4000-8000-000000000001','role','authenticated','aal','aal1','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);
  set local role authenticated;
  v_payload:=jsonb_build_object('organisation_id','d3000000-0000-4000-8000-000000000001','name','Synthetic hosted fund','unit_price_minor','1000','cap_units','10');
  v_result:=public.bx1_demo_command('create_fund',v_create_key,v_payload);
  v_fund:=(v_result#>>'{funds,0,id}')::uuid;
  if v_fund is null or v_result#>>'{funds,0,status}'<>'DRAFT' or v_result#>>'{funds,0,currency}'<>'ZAR_TEST' then raise exception 'demo_test_create'; end if;
  if public.bx1_demo_command('create_fund',v_create_key,v_payload) is distinct from v_result then raise exception 'demo_test_create_replay'; end if;
  v_checks:=v_checks+4;
  v_denied:=false;
  begin perform public.bx1_demo_command('create_fund',v_create_key,v_payload||'{"cap_units":"11"}'); exception when unique_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_key_payload_conflict'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('open_offering',gen_random_uuid(),jsonb_build_object('fund_id',v_fund)); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_unbound_open'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_bind_contract(v_fund,v_contract,v_wallet_a,v_hash_deploy,v_actor,v_session); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_browser_binding_denied'; end if; v_checks:=v_checks+1;
  reset role; set local role bx1_demo_chain_verifier;
  v_result:=public.bx1_demo_bind_contract(v_fund,v_contract,v_wallet_a,v_hash_deploy,v_actor,v_session);
  if public.bx1_demo_bind_contract(v_fund,v_contract,v_wallet_a,v_hash_deploy,v_actor,v_session) is distinct from v_result then raise exception 'demo_test_binding_replay'; end if; v_checks:=v_checks+1;
  reset role; set local role authenticated;
  v_result:=public.bx1_demo_command('open_offering',gen_random_uuid(),jsonb_build_object('fund_id',v_fund));
  if v_result#>>'{funds,0,status}'<>'OPEN' then raise exception 'demo_test_open'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_command('subscribe',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','3','investor_wallet',v_wallet_a));
  v_subscription_a:=(v_result#>>'{funds,0,subscriptions,0,id}')::uuid;
  v_result:=public.bx1_demo_command('subscribe',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','7','investor_wallet',v_wallet_b));
  v_subscription_b:=(v_result#>>'{funds,0,subscriptions,1,id}')::uuid;
  if v_result#>>'{funds,0,reserved_subscription_units}'<>'10' or v_result#>>'{funds,0,subscriptions,0,amount_minor}'<>'3000' then raise exception 'demo_test_quote_capacity'; end if; v_checks:=v_checks+2;
  v_denied:=false;
  begin perform public.bx1_demo_command('subscribe',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','1','investor_wallet',v_wallet_a)); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_oversubscription'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('subscribe',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','1.1','investor_wallet',v_wallet_a)); exception when invalid_parameter_value then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_fractional_units'; end if; v_checks:=v_checks+1;
  v_payload:=jsonb_build_object('fund_id',v_fund,'subscription_id',v_subscription_a);
  v_result:=public.bx1_demo_command('record_test_funding',v_funding_key,v_payload);
  if public.bx1_demo_command('record_test_funding',v_funding_key,v_payload) is distinct from v_result then raise exception 'demo_test_funding_replay'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('record_test_funding',gen_random_uuid(),v_payload); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_double_funding'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_command('prepare_mint',v_prepare_key,v_payload); v_mint_a:=(v_result#>>'{operation,id}')::uuid;
  if public.bx1_demo_command('prepare_mint',v_prepare_key,v_payload) is distinct from v_result then raise exception 'demo_test_prepare_replay'; end if;
  if v_result#>>'{operation,status}'<>'PREPARED' or v_result#>>'{funds,0,issued_units}'<>'0' then raise exception 'demo_test_prepared_not_issued'; end if; v_checks:=v_checks+3;
  v_denied:=false;
  begin perform public.bx1_demo_confirm_chain(v_mint_a,v_hash_mint_a,100,v_contract,v_actor,v_session); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_fake_browser_receipt'; end if; v_checks:=v_checks+1;
  reset role; set local role bx1_demo_chain_verifier;
  v_result:=public.bx1_demo_confirm_chain(v_mint_a,v_hash_mint_a,100,v_contract,v_actor,v_session);
  if public.bx1_demo_confirm_chain(v_mint_a,v_hash_mint_a,100,v_contract,v_actor,v_session) is distinct from v_result then raise exception 'demo_test_confirmation_replay'; end if;
  if v_result#>>'{funds,0,issued_units}'<>'3' then raise exception 'demo_test_first_mint'; end if; v_checks:=v_checks+2;
  reset role; set local role authenticated;
  v_payload:=jsonb_build_object('fund_id',v_fund,'subscription_id',v_subscription_b);
  -- Prove pending subscriber cash is not available to redeem an earlier holder.
  -- This isolated probe is rolled back without changing the normal journey.
  begin
    perform public.bx1_demo_command('record_distribution',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','100'));
    perform public.bx1_demo_command('record_test_funding',gen_random_uuid(),v_payload);
    v_denied:=false;
    begin perform public.bx1_demo_command('request_redemption',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','3','investor_wallet',v_wallet_a)); exception when check_violation then v_denied:=true; end;
    if not v_denied then raise exception 'demo_test_pending_cash_protected'; end if;
    v_checks:=v_checks+1;
    raise exception 'demo_probe_rollback' using errcode='P0100';
  exception when sqlstate 'P0100' then null;
  end;
  perform public.bx1_demo_command('record_test_funding',gen_random_uuid(),v_payload);
  v_result:=public.bx1_demo_command('prepare_mint',gen_random_uuid(),v_payload); v_mint_b:=(v_result#>>'{operation,id}')::uuid;
  reset role; set local role bx1_demo_chain_verifier;
  v_denied:=false;
  begin perform public.bx1_demo_confirm_chain(v_mint_b,v_hash_mint_b,101,v_wallet_a,v_actor,v_session); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_wrong_contract'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_confirm_chain(v_mint_b,v_hash_mint_a,100,v_contract,v_actor,v_session); exception when unique_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_duplicate_transaction'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_confirm_chain(v_mint_b,v_hash_mint_b,101,v_contract,v_actor,v_session);
  if v_result#>>'{funds,0,issued_units}'<>'10' or v_result#>>'{funds,0,synthetic_cash_minor}'<>'10000' then raise exception 'demo_test_second_mint'; end if; v_checks:=v_checks+2;
  reset role;
  -- Every operational quantity still agrees after the failed duplicate receipt.
  if (select count(*) from bx1_demo.journal_entries where fund_id=v_fund and event_kind='MINT')<>2 then raise exception 'demo_test_failed_confirmation_rollback'; end if; v_checks:=v_checks+1;
  set local role authenticated;
  perform public.bx1_demo_command('record_test_income',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','101'));
  v_result:=public.bx1_demo_command('record_distribution',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','101'));
  v_distribution:=(v_result#>>'{funds,0,distributions,0,id}')::uuid;
  if v_result#>>'{funds,0,synthetic_cash_minor}'<>'10000'
    or v_result#>>'{funds,0,distributions,0,entitlements,0,amount_minor}'<>'30'
    or v_result#>>'{funds,0,distributions,0,entitlements,1,amount_minor}'<>'71' then raise exception 'demo_test_distribution_rounding'; end if; v_checks:=v_checks+3;
  v_denied:=false;
  begin perform public.bx1_demo_command('record_distribution',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','10001')); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_overdistribution'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_command('request_redemption',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','3','investor_wallet',v_wallet_a));
  v_redemption_a:=(v_result#>>'{funds,0,redemptions,0,id}')::uuid;
  v_result:=public.bx1_demo_command('request_redemption',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','7','investor_wallet',v_wallet_b));
  v_redemption_b:=(v_result#>>'{funds,0,redemptions,1,id}')::uuid;
  if v_result#>>'{funds,0,reserved_redemption_units}'<>'10' then raise exception 'demo_test_redemption_reservation'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('request_redemption',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'units','1','investor_wallet',v_wallet_a)); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_overredemption'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('record_distribution',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','1')); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_reserved_cash_protected'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('complete_test_payout',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'redemption_id',v_redemption_a)); exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_payout_before_burn'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_command('prepare_burn',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'redemption_id',v_redemption_a)); v_burn_a:=(v_result#>>'{operation,id}')::uuid;
  v_result:=public.bx1_demo_command('prepare_burn',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'redemption_id',v_redemption_b)); v_burn_b:=(v_result#>>'{operation,id}')::uuid;
  reset role; set local role bx1_demo_chain_verifier;
  perform public.bx1_demo_confirm_chain(v_burn_a,v_hash_burn_a,102,v_contract,v_actor,v_session);
  v_result:=public.bx1_demo_confirm_chain(v_burn_b,v_hash_burn_b,103,v_contract,v_actor,v_session);
  if v_result#>>'{funds,0,issued_units}'<>'0' or v_result#>>'{funds,0,reserved_redemption_units}'<>'0' then raise exception 'demo_test_burn_completion'; end if; v_checks:=v_checks+2;
  reset role; set local role authenticated;
  v_key:=gen_random_uuid(); v_payload:=jsonb_build_object('fund_id',v_fund,'redemption_id',v_redemption_a);
  v_result:=public.bx1_demo_command('complete_test_payout',v_key,v_payload);
  if public.bx1_demo_command('complete_test_payout',v_key,v_payload) is distinct from v_result then raise exception 'demo_test_payout_replay'; end if; v_checks:=v_checks+1;
  v_result:=public.bx1_demo_command('complete_test_payout',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'redemption_id',v_redemption_b));
  if v_result#>>'{funds,0,synthetic_cash_minor}'<>'0' or v_result#>>'{funds,0,redemptions,1,status}'<>'PAID' then raise exception 'demo_test_complete_exit'; end if; v_checks:=v_checks+2;
  if public.bx1_demo_snapshot(v_fund) is distinct from v_result then raise exception 'demo_test_persisted_snapshot'; end if; v_checks:=v_checks+1;
  reset role;
  if (select sum(amount_minor) from bx1_demo.entitlements where distribution_id=v_distribution)<>101 then raise exception 'demo_test_entitlement_total'; end if;
  if (select count(*) from bx1_demo.journal_entries where fund_id=v_fund)<>14 then raise exception 'demo_test_journal_count'; end if;
  if exists(select 1 from bx1_demo.journal_entries e join bx1_demo.journal_lines l on l.entry_id=e.id where e.fund_id=v_fund group by e.id having count(*)<>2 or sum(case when l.direction='DEBIT' then l.amount else -l.amount end)<>0) then raise exception 'demo_test_balanced_journals'; end if;
  if (select sum(case when l.direction='CREDIT' then l.amount else -l.amount end) from bx1_demo.journal_entries e join bx1_demo.journal_lines l on l.entry_id=e.id where e.fund_id=v_fund and l.account='INVESTOR_UNITS')<>0 then raise exception 'demo_test_unit_ledger_reconciled'; end if;
  v_checks:=v_checks+4;
  v_denied:=false;
  begin update bx1_demo.funds set unit_price_minor=1 where id=v_fund; exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_terms_immutable'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin delete from bx1_demo.journal_entries where fund_id=v_fund; exception when check_violation then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_journal_immutable'; end if; v_checks:=v_checks+1;
  if to_regprocedure('bx1_private.has_token_mfa()') is not null then
    begin
      insert into auth.mfa_factors(id,user_id,status,factor_type) values('d5000000-0000-4000-8000-000000000001',v_actor,'verified','totp');
      update auth.sessions set aal='aal2',factor_id='d5000000-0000-4000-8000-000000000001' where id=v_session;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'session_id',v_session,'role','authenticated','aal','aal1','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);
      set local role authenticated;
      v_denied:=false;
      begin perform public.bx1_demo_command('record_test_income',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','1')); exception when insufficient_privilege then v_denied:=true; end;
      if not v_denied then raise exception 'demo_test_enrolled_aal1_rpc_denied'; end if; v_checks:=v_checks+1;
      v_denied:=false;
      begin perform public.bx1_demo_snapshot(v_fund); exception when insufficient_privilege then v_denied:=true; end;
      if not v_denied then raise exception 'demo_test_enrolled_aal1_read_denied'; end if; v_checks:=v_checks+1;
      reset role;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'session_id',v_session,'role','authenticated','aal','aal2','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);
      set local role authenticated;
      if public.bx1_demo_snapshot(v_fund)#>>'{funds,0,id}'<>v_fund::text then raise exception 'demo_test_enrolled_aal2_read'; end if; v_checks:=v_checks+1;
      reset role;
      raise exception 'demo_probe_rollback' using errcode='P0100';
    exception when sqlstate 'P0100' then null;
    end;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','d1000000-0000-4000-8000-000000000002','session_id','d2000000-0000-4000-8000-000000000002','role','authenticated','aal','aal1','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);
  set local role authenticated;
  if public.bx1_demo_snapshot(null)<>'{"funds":[]}'::jsonb then raise exception 'demo_test_other_tenant_list'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_snapshot(v_fund); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_other_tenant_read'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('record_test_income',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','1')); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_other_tenant_write'; end if; v_checks:=v_checks+1;
  reset role;
  insert into public.bx1_memberships(user_id,organisation_id,role) values('d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','SuperAdmin');
  set local role authenticated;
  if public.bx1_demo_snapshot(v_fund)#>>'{funds,0,id}'<>v_fund::text then raise exception 'demo_test_same_org_shared_read'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_command('record_test_income',gen_random_uuid(),jsonb_build_object('fund_id',v_fund,'amount_minor','1')); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_same_org_nonpresenter_write'; end if; v_checks:=v_checks+1;
  reset role; set local role bx1_demo_chain_verifier;
  v_denied:=false;
  begin perform public.bx1_demo_bind_contract(v_fund,v_contract,v_wallet_a,v_hash_deploy,'d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002'); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_same_org_nonpresenter_binding'; end if; v_checks:=v_checks+1;
  v_denied:=false;
  begin perform public.bx1_demo_confirm_chain(v_mint_a,v_hash_mint_a,100,v_contract,'d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002'); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_same_org_nonpresenter_confirmation'; end if; v_checks:=v_checks+1;
  reset role;
  delete from auth.sessions where id='d2000000-0000-4000-8000-000000000002';
  set local role authenticated;
  v_denied:=false;
  begin perform public.bx1_demo_command('create_fund',gen_random_uuid(),jsonb_build_object('organisation_id','d3000000-0000-4000-8000-000000000002','name','revoked','unit_price_minor','1','cap_units','1')); exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'demo_test_revoked_session'; end if; v_checks:=v_checks+1;
  reset role;
  set constraints all immediate;
  raise notice 'BX1_TESTNET_FUND_DEMO_SQL_PASS assertions=% full_synthetic_lifecycle=true real_chain_receipts=not_proven concurrent_connections=not_proven',v_checks;
end $$;
rollback to savepoint testnet_fund_demo_fixture;
release savepoint testnet_fund_demo_fixture;
