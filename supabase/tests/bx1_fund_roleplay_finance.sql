-- Hosted TEST negative/catalog proof after commands -> finance integration.
-- No actor/session/factor, approval, provider receipt, cash, journal or holding
-- is invented. Successful real-role/Amoy business acceptance is separate.
do $finance_boundaries$
declare signature text;role_name text;definition text;denied boolean;original_claims text;original_subject text;
  missing uuid:='00000000-0000-4000-8000-000000000099';
  context jsonb:='{"mode":"ROLE","organisationId":"00000000-0000-4000-8000-000000000099","role":"FinancialController"}'::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_finance_test_requires_native_test';end if;
  foreach signature in array array[
    'bx1_private.fund_roleplay_finance_mandate_current(uuid,jsonb,uuid,text,uuid,integer)',
    'bx1_private.fund_roleplay_finance_context(jsonb,uuid,text)',
    'bx1_private.fund_roleplay_finance_enter(jsonb,uuid,text,uuid)',
    'bx1_private.fund_roleplay_finance_proposer_current(text,uuid)',
    'bx1_private.fund_roleplay_finance_approval_allowed(text,uuid,jsonb,text,uuid)',
    'bx1_private.fund_roleplay_finance_route_current(uuid)',
    'bx1_private.fund_roleplay_finance_route_action(jsonb,uuid,text)',
    'bx1_private.fund_roleplay_finance_record(text,uuid)',
    'bx1_private.fund_roleplay_finance_visible(jsonb,uuid)',
    'bx1_private.fund_roleplay_finance_order_visible(jsonb,uuid)',
    'bx1_private.fund_roleplay_finance_route_visible(jsonb,uuid)',
    'bx1_private.fund_roleplay_finance_read_current(jsonb,jsonb)',
    'bx1_private.fund_roleplay_finance_actions(jsonb,text,uuid)'] loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(signature)
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
      raise exception 'fund_roleplay_finance_helper_metadata_changed: %',signature;end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker','bx1_document_receipt_writer'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'fund_roleplay_finance_helper_exposed: % / %',signature,role_name;end if;
    end loop;
  end loop;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_private.fund_roleplay_finance_context(jsonb,uuid,text)'::regprocedure;
  if pg_catalog.strpos(definition,$needle$p.terms->>'asset_type'='FUND'$needle$)=0
    or pg_catalog.strpos(definition,$needle$p.terms->>'currency'='TST'$needle$)=0
    or pg_catalog.strpos(definition,'bx1_private.fund_roleplay_context(c,product,action)')=0
    or pg_catalog.strpos(definition,'organisation_authority_bindings')=0 then
    raise exception 'fund_roleplay_finance_narrow_scope_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_private.fund_roleplay_finance_mandate_current(uuid,jsonb,uuid,text,uuid,integer)'::regprocedure;
  if pg_catalog.strpos(definition,$needle$receipt.kind='ROLE_STATE'$needle$)=0
    or pg_catalog.strpos(definition,'receipt.id=sp.admission_receipt_id')=0
    or pg_catalog.strpos(definition,'native.organisation_id=p.native_organisation_id')=0
    or pg_catalog.strpos(definition,'request.roleplay_epoch=p.authority_epoch')=0
    or pg_catalog.strpos(definition,'receipt.evidence_hash=bx1_portal.fund_digest(receipt.evidence)')=0
    or pg_catalog.strpos(definition,'bx1_private.fund_roleplay_authority_current(a.id)')=0 then
    raise exception 'fund_roleplay_finance_typed_test_mandate_binding_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_private.fund_roleplay_finance_route_current(uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'receipt.policy_id=r.roleplay_policy_id')=0
    or pg_catalog.strpos(definition,'receipt.authority_epoch=r.roleplay_epoch')=0
    or pg_catalog.strpos(definition,'request.payload')=0
    or pg_catalog.strpos(definition,'fund_roleplay_lane_current')=0 then
    raise exception 'fund_roleplay_finance_saved_approval_binding_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.funding_route_current(uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'r.roleplay_policy_id is null or bx1_private.fund_roleplay_finance_route_current(r.id)')=0
    or pg_catalog.strpos(definition,$needle$r.status='APPROVED'$needle$)=0
    or pg_catalog.strpos(definition,'p.revision=r.product_revision and p.terms_hash=r.terms_hash')=0 then
    raise exception 'fund_roleplay_finance_native_route_gate_changed';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'fund_roleplay_finance_expired_after_wait')=0
    or pg_catalog.strpos(definition,'fund_roleplay_finance_saved_route_scope_required')=0
    or pg_catalog.strpos(definition,'fund_roleplay_finish(c,pid,action,key)')=0
    or pg_catalog.strpos(definition,'funding_receipt_claims where reference_id=f.id')=0
    or pg_catalog.strpos(definition,'fund_recognition_journals where obligation_id=o.id')=0
    or pg_catalog.strpos(definition,$needle$'TEST_SETTLEMENT_TOKEN_ASSET','DEBIT',obs.amount_base_units$needle$)=0
    or pg_catalog.strpos(definition,$needle$'TEST_CUSTOMER_FUNDING_LIABILITY','CREDIT',obs.amount_base_units$needle$)=0
    or pg_catalog.strpos(definition,$needle$case when r.denomination='TST' and s.accepted_terms->>'currency'='TST' then s.amount_minor else s.amount_minor*power(10::numeric,r.token_decimals-2) end$needle$)=0 then
    raise exception 'fund_roleplay_finance_original_receipt_posting_or_denomination_gate_changed';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.funding_actions(jsonb,text,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'if bx1_private.fund_roleplay_finance_record(kind,target) then return bx1_private.fund_roleplay_finance_actions(c,kind,target)')=0 then
    raise exception 'fund_roleplay_finance_native_authority_must_not_bypass_saved_test_record';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_private.fund_roleplay_finance_order_visible(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'product.organisation_id=subscription.organisation_id')=0
    or pg_catalog.strpos(definition,'product.current_offering_revision_id=subscription.offering_revision_id')=0 then
    raise exception 'fund_roleplay_finance_order_read_scope_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_private.fund_roleplay_finance_route_visible(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'policy.id=route.roleplay_policy_id and policy.authority_epoch=route.roleplay_epoch')=0
    or pg_catalog.strpos(definition,'policy.offering_revision_id=product.current_offering_revision_id')=0 then
    raise exception 'fund_roleplay_finance_route_read_saved_scope_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.read_scoped(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'fund_roleplay_finance_read_current(c,roleplay_result)')=0
    or pg_catalog.strpos(definition,'fund_roleplay_finance_read_scope_expired')=0 then
    raise exception 'fund_roleplay_finance_post_read_authority_check_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.read_scoped_pre_eligibility(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,$needle$else 'TEST_ROLE_PLAY'$needle$)=0
    or pg_catalog.strpos(definition,'bx1_private.fund_roleplay_finance_visible(c,p.id)')=0
    or pg_catalog.strpos(definition,'bx1_private.fund_roleplay_finance_route_visible(c,r.id)')=0 then
    raise exception 'fund_roleplay_finance_connected_scoped_read_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.scoped_finance(jsonb,uuid,text)'::regprocedure;
  if pg_catalog.strpos(definition,'bx1_portal.funding_person() is not null')=0
    or pg_catalog.strpos(definition,'bx1_portal.organisation_authority_bindings')=0
    or pg_catalog.strpos(definition,'fund_roleplay')>0 then
    raise exception 'fund_roleplay_finance_global_native_finance_gate_changed';end if;

  original_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  original_subject:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  if auth.uid() is not null then raise exception 'fund_roleplay_finance_negative_actor_not_empty';end if;
  if bx1_private.fund_roleplay_finance_context(context,missing,'reconcile_funding') is not false
    or bx1_private.fund_roleplay_finance_mandate_current(missing,context,missing,'reconcile_funding',missing,1) is not false
    or bx1_private.fund_roleplay_finance_enter(context,missing,'reconcile_funding',missing) is not null
    or bx1_private.fund_roleplay_finance_proposer_current('ROUTE',missing) is not false
    or bx1_private.fund_roleplay_finance_proposer_current('ACCEPTANCE',missing) is not false
    or bx1_private.fund_roleplay_finance_proposer_current('REVERSAL',missing) is not false
    or bx1_private.fund_roleplay_finance_proposer_current('INVALID',missing) is not false
    or bx1_private.fund_roleplay_finance_approval_allowed('ACCEPTANCE',missing,context,'reconcile_funding',missing) is not false
    or bx1_private.fund_roleplay_finance_route_current(missing) is not false
    or bx1_private.fund_roleplay_finance_route_action(context,missing,'approve_funding_route') is not false
    or bx1_private.fund_roleplay_finance_record('ROUTE',missing) is not false
    or bx1_private.fund_roleplay_finance_record('REFERENCE',missing) is not false
    or bx1_private.fund_roleplay_finance_record('INVALID',missing) is not false
    or bx1_private.fund_roleplay_finance_visible(context,missing) is not false
    or bx1_private.fund_roleplay_finance_visible(context-'organisationId',missing) is not false
    or bx1_private.fund_roleplay_finance_order_visible(context,missing) is not false
    or bx1_private.fund_roleplay_finance_route_visible(context,missing) is not false
    or bx1_private.fund_roleplay_finance_read_current(context,'{"products":[],"subscriptions":[],"funding":{"routes":[]}}'::jsonb) is not false
    or bx1_private.fund_roleplay_finance_actions(context,'ROUTE',missing) is distinct from '[]'::jsonb then
    raise exception 'fund_roleplay_finance_missing_scope_or_record_became_authority';end if;
  denied:=false;
  begin perform bx1_portal.execute_scoped_pre_eligibility(context,'propose_funding_route',missing,'{}'::jsonb);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_finance_unauthenticated_write_accepted';end if;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(original_subject,''),true);
end $finance_boundaries$;
