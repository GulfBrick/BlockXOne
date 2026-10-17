-- Run immediately after the two original reviewed features, inside the native
-- TEST install transaction. Negative/catalog proof only: no positive users,
-- factors, approvals, payment observations, journals or holdings are fabricated.
do $payment_upgrade_contract$
declare name text;signature text;role_name text;definition text;denied boolean;
  original_claims text;original_subject text;missing uuid:='00000000-0000-4000-8000-000000000099';
begin
  if current_user<>'postgres' or session_user<>'postgres' or current_database()<>'postgres'
    or pg_catalog.current_setting('bx1.install.verified_project_ref',true) is distinct from 'fegnnnlseuejkrusbbkv'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'payment_upgrade_test_requires_native_test_target';end if;
  if not exists(select 1 from pg_catalog.pg_class c where c.oid='bx1_portal.fund_payment_allocation_bases'::regclass
    and c.relowner='postgres'::regrole and c.relrowsecurity)
    or exists(select 1 from bx1_portal.fund_payment_allocation_bases) then
    raise exception 'payment_upgrade_basis_not_private_empty_table';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
    if pg_catalog.has_table_privilege(role_name,'bx1_portal.fund_payment_allocation_bases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'payment_upgrade_raw_basis_privilege: %',role_name;end if;
  end loop;
  foreach name in array array['allocation_basis_id','allocation_basis_revision'] loop
    if not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='bx1_portal.fund_payment_intents'::regclass
      and a.attname=name and not a.attnotnull and not a.attisdropped) then
      raise exception 'payment_upgrade_nullable_history_column_missing: %',name;end if;
  end loop;
  if exists(select 1 from bx1_portal.fund_payment_intents where allocation_basis_id is not null or allocation_basis_revision is not null) then
    raise exception 'payment_upgrade_old_attempt_was_backfilled';end if;
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='bx1_portal.fund_payment_intents'::regclass
    and t.tgname='fund_payment_basis_stamp_intent' and t.tgfoid='bx1_portal.fund_payment_basis_stamp_intent()'::regprocedure
    and not t.tgisinternal and t.tgenabled='O' and t.tgtype=7)
    or not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='bx1_portal.fund_payment_allocation_bases'::regclass
      and t.tgname='fund_payment_basis_history_immutable' and t.tgfoid='bx1_portal.fund_payment_basis_guard()'::regprocedure
      and not t.tgisinternal and t.tgenabled='O' and t.tgtype=27) then
    raise exception 'payment_upgrade_basis_triggers_missing';end if;
  for signature in select p.oid::regprocedure::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and pg_catalog.left(p.proname,19)='fund_payment_basis_' loop
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'payment_upgrade_private_helper_exposed: % / %',signature,role_name;end if;
    end loop;
  end loop;
  foreach signature in array array['bx1_portal.fund_read_payment(jsonb,uuid)','public.bx1_portal_read_fund_payment(uuid,jsonb)'] loop
    foreach role_name in array array['anon','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'payment_upgrade_receipt_read_exposed: % / %',signature,role_name;end if;
    end loop;
    if not pg_catalog.has_function_privilege('authenticated',signature,'EXECUTE') then
      raise exception 'payment_upgrade_guarded_read_permission_missing: %',signature;end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc p where p.oid='public.bx1_portal_read_fund_payment(uuid,jsonb)'::regprocedure and p.prosecdef) then
    raise exception 'payment_upgrade_public_reader_must_be_invoker';end if;

  -- Assert each reviewed source cutover is present and the instruction gate
  -- remains FUND + TST only. This is not a synthetic property admission proof.
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,$gate$if s.accepted_terms->>'asset_type'='FUND' and s.accepted_terms->>'currency'='TST' and bx1_portal.fund_payment_basis_current(s.id) is not true then$gate$)=0
    or pg_catalog.strpos(definition,$broad$if s.accepted_terms->>'currency'='TST' and bx1_portal.fund_payment_basis_current(s.id) is not true then$broad$)>0 then
    raise exception 'payment_upgrade_property_branch_changed';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_command(jsonb,text,uuid,jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'return bx1_portal.fund_payment_basis_command(c,action,key,body);')=0
    or pg_catalog.strpos(definition,'or bx1_portal.fund_payment_basis_current(s.id) is not true or obligation.token_decimals<>6')=0 then
    raise exception 'payment_upgrade_request_or_final_allocation_cutover_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_order_projection(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'bx1_portal.fund_payment_basis_actions(c,s.id)||actions')=0
    or pg_catalog.strpos(definition,'bx1_portal.fund_payment_basis_projection(c,s.id)')=0 then
    raise exception 'payment_upgrade_dashboard_handoff_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_prepare_payment(jsonb,uuid,integer,text)'::regprocedure;
  if pg_catalog.strpos(definition,'fund_issuer_allocation_basis_required_before_payment')=0
    or pg_catalog.strpos(definition,'fund_existing_payment_basis_requires_recovery')=0 then
    raise exception 'payment_upgrade_preparation_gate_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_submit_payment(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'fund_issuer_allocation_basis_changed_before_submission')=0 then
    raise exception 'payment_upgrade_pre_prompt_gate_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_allocation_current(uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'where a.id=target and bx1_portal.fund_payment_basis_current(s.id)')=0 then
    raise exception 'payment_upgrade_final_allocation_currentness_missing';end if;

  -- Empty claims are a negative boundary, not an invented actor/session/factor.
  original_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  original_subject:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  if auth.uid() is not null then raise exception 'payment_upgrade_negative_actor_not_empty';end if;
  foreach name in array array['request_fund_payment_allocation_basis','approve_fund_payment_allocation_basis'] loop
    denied:=false;
    begin
      perform bx1_portal.fund_command('{"mode":"APPLICANT"}'::jsonb,name,missing,'{}'::jsonb);
    exception when insufficient_privilege then denied:=true;end;
    if not denied then raise exception 'payment_upgrade_unauthenticated_command_accepted: %',name;end if;
  end loop;
  denied:=false;
  begin perform public.bx1_portal_read_fund_payment(missing,'{"mode":"APPLICANT"}'::jsonb);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'payment_upgrade_unauthenticated_receipt_read_accepted';end if;
  if bx1_portal.fund_payment_basis_current(missing) is not false
    or bx1_portal.fund_payment_basis_intent_current(missing) is not false
    or bx1_portal.fund_payment_basis_hash(missing) is not null then
    raise exception 'payment_upgrade_missing_order_became_current';end if;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(original_subject,''),true);
  if exists(select 1 from bx1_portal.fund_payment_allocation_bases) then raise exception 'payment_upgrade_negatives_wrote_basis';end if;
end $payment_upgrade_contract$;
