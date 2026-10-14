-- Hosted installed-definition and deny-boundary proof only.
-- No fake user, login session, MFA factor, provider proof, chain receipt,
-- funding journal or ownership record is created. Run inside the owner's
-- atomic TEST install transaction (or a separate rollback transaction).
do $roleplay_command_negatives$
declare before_counts jsonb;after_counts jsonb;result jsonb;denied boolean;spec jsonb;
  missing uuid:='00000000-0000-0000-0000-000000000001';
  context jsonb:='{"mode":"ROLE","organisationId":"00000000-0000-0000-0000-000000000002","role":"TokenisationAgent"}';
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_test_owner_required';end if;
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  select pg_catalog.jsonb_build_object(
    'lanes',(select count(*) from bx1_private.fund_roleplay_command_lanes),
    'receipts',(select count(*) from bx1_private.fund_roleplay_command_receipts),
    'wallets',(select count(*) from bx1_private.fund_roleplay_wallet_proofs),
    'capacities',(select count(*) from bx1_private.fund_roleplay_capacity_receipts),
    'operations',(select count(*) from bx1_portal.fund_operations),
    'funding_journals',(select count(*) from bx1_portal.funding_journals),
    'holdings',(select count(*) from bx1_portal.fund_holdings),
    'register',(select count(*) from bx1_portal.fund_register_entries)) into before_counts;
  if bx1_private.fund_roleplay_current_policy(context,missing,'prepare_fund_transaction') is not null
    or bx1_private.fund_roleplay_lane_current(context,missing,'prepare_fund_transaction') is true
    or bx1_private.fund_roleplay_record_current(missing,1,missing,missing,missing,context,'approve_fund_deployment') is true
    or bx1_private.fund_roleplay_control_proof_current(missing,1,'owner-1',missing) is true then
    raise exception 'fund_roleplay_missing_actual_session_not_denied';end if;
  result:=public.bx1_portal_fund_roleplay_read(missing,context);
  if result is not null then raise exception 'fund_roleplay_unverified_read_not_denied';end if;
  denied:=false;
  begin perform public.bx1_portal_bind_roleplay_signer(missing,1,'owner-1',missing,context);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_unverified_wallet_bind_not_denied';end if;
  denied:=false;
  begin perform public.bx1_portal_prepare_fund_transaction(missing,1,context,'0x1111111111111111111111111111111111111111');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_unverified_prepare_not_denied';end if;
  denied:=false;
  begin perform public.bx1_portal_record_fund_signature(missing,1,'0x'||pg_catalog.repeat('1',130),context,'0x1111111111111111111111111111111111111111');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_unverified_signature_not_denied';end if;
  denied:=false;
  begin perform public.bx1_portal_fund_lifecycle_command_scoped('approve_fund_deployment',missing,
    pg_catalog.jsonb_build_object('operation_id',missing,'expected_revision',1),context,'0x1111111111111111111111111111111111111111');
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_unverified_approval_not_denied';end if;
  denied:=false;
  begin perform public.bx1_portal_prepare_fund_transaction(missing,1,context,'0x0000000000000000000000000000000000000000');
  exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_zero_owner_not_denied';end if;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and p.proname like 'fund_roleplay_%'
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
        or has_function_privilege('service_role',p.oid,'EXECUTE'))) then
    raise exception 'fund_roleplay_private_helper_exposed';end if;
  if has_table_privilege('authenticated','bx1_private.fund_roleplay_command_lanes','INSERT')
    or has_table_privilege('authenticated','bx1_private.fund_roleplay_wallet_proofs','INSERT')
    or has_function_privilege('authenticated','bx1_private.fund_roleplay_provision_operator(uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'fund_roleplay_owner_or_fact_writer_exposed';end if;
  select pg_catalog.jsonb_build_object(
    'lanes',(select count(*) from bx1_private.fund_roleplay_command_lanes),
    'receipts',(select count(*) from bx1_private.fund_roleplay_command_receipts),
    'wallets',(select count(*) from bx1_private.fund_roleplay_wallet_proofs),
    'capacities',(select count(*) from bx1_private.fund_roleplay_capacity_receipts),
    'operations',(select count(*) from bx1_portal.fund_operations),
    'funding_journals',(select count(*) from bx1_portal.funding_journals),
    'holdings',(select count(*) from bx1_portal.fund_holdings),
    'register',(select count(*) from bx1_portal.fund_register_entries)) into after_counts;
  if before_counts is distinct from after_counts then raise exception 'fund_roleplay_negative_changed_business_data';end if;
end $roleplay_command_negatives$;
