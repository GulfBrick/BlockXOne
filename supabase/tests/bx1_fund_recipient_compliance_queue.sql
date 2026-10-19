-- Hosted negative/catalog proof only. No actor/session/factor, investor,
-- eligibility, recipient claim, role, contract or holding is fabricated.
do $boundaries$
declare definition text;role_name text;claims text;subject text;
  missing uuid:='00000000-0000-4000-8000-000000000097';
  context jsonb:='{"mode":"ROLE","organisationId":"00000000-0000-4000-8000-000000000098","role":"ComplianceOfficer"}'::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_recipient_compliance_queue_test_requires_native_test';end if;
  if not exists(select 1 from pg_catalog.pg_proc p
    where p.oid='bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)'::regprocedure
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
    raise exception 'fund_recipient_compliance_queue_helper_metadata_changed';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker','bx1_document_receipt_writer'] loop
    if pg_catalog.has_function_privilege(role_name,'bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)','EXECUTE') then
      raise exception 'fund_recipient_compliance_queue_private_helper_exposed: %',role_name;end if;
  end loop;
  select p.prosrc into definition from pg_catalog.pg_proc p
    where p.oid='bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,$needle$recipient.state='CLAIM_SIGNATURE_REQUIRED'$needle$)=0
    or pg_catalog.strpos(definition,'recipient.offering_revision_id=subscription.offering_revision_id')=0
    or pg_catalog.strpos(definition,'recipient.investment_account_id=subscription.investment_account_id')=0
    or pg_catalog.strpos(definition,'recipient.holder_user_id=subscription.investor_id')=0
    or pg_catalog.strpos(definition,'recipient.wallet_proof_id=binding.wallet_proof_id')=0
    or pg_catalog.strpos(definition,$needle$c->>'organisationId'=manifest.native_organisation_id::text$needle$)=0
    or pg_catalog.strpos(definition,$needle$bx1_portal.fund_recipient_current(recipient.id,c,'CLAIM_SIGNATURE')$needle$)=0 then
    raise exception 'fund_recipient_compliance_queue_case_scope_or_current_authority_missing';end if;
  select p.prosrc into definition from pg_catalog.pg_proc p where p.oid='bx1_portal.fund_order_visible(jsonb,uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'bx1_private.fund_recipient_compliance_order_visible(c,s.id)')=0
    or pg_catalog.strpos(definition,'bx1_portal.fund_product_visible(c,s.product_id)')=0
    or pg_catalog.strpos(definition,$needle$'OfferingManager','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController'$needle$)=0 then
    raise exception 'fund_recipient_compliance_queue_original_role_scope_changed';end if;
  claims:=pg_catalog.current_setting('request.jwt.claims',true);subject:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  if auth.uid() is not null then raise exception 'fund_recipient_compliance_queue_negative_actor_not_empty';end if;
  if bx1_private.fund_recipient_compliance_order_visible(context,missing) is not false
    or bx1_private.fund_recipient_compliance_order_visible(context-'organisationId',missing) is not false
    or bx1_private.fund_recipient_compliance_order_visible(context||'{"role":"TreasuryOperator"}'::jsonb,missing) is not false
    or bx1_private.fund_recipient_compliance_order_visible('{"mode":"APPLICANT"}'::jsonb,missing) is not false
    or bx1_portal.fund_order_visible(context,missing) is not false then
    raise exception 'fund_recipient_compliance_queue_missing_case_or_wrong_context_authorised';end if;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(claims,''),true);
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(subject,''),true);
end $boundaries$;
