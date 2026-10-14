-- TEST-only read handoff to the existing same-order recipient workflow.
-- This does not grant a role, finance authority, KYC access or claim approval.
-- Existing writer/session/eligibility/manifest guards remain authoritative.
do $baseline$ begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_portal.fund_recipient_current(uuid,jsonb,text)') is null
    or pg_catalog.to_regprocedure('bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)') is not null then
    raise exception 'fund_recipient_compliance_queue_exact_test_baseline_required' using errcode='55000';end if;
end $baseline$;

create function bx1_private.fund_recipient_compliance_order_visible(c jsonb,target_subscription uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
    and exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    and exists(select 1 from bx1_portal.subscriptions subscription
      join bx1_portal.fund_delivery_bindings binding on binding.investment_account_id=subscription.investment_account_id
        and binding.product_id=subscription.product_id and binding.actor_id=subscription.investor_id
      join bx1_portal.fund_recipient_cases recipient on recipient.delivery_binding_id=binding.id
        and recipient.investment_account_id=subscription.investment_account_id and recipient.product_id=subscription.product_id
        and recipient.offering_revision_id=subscription.offering_revision_id and recipient.holder_user_id=subscription.investor_id
        and recipient.wallet_proof_id=binding.wallet_proof_id and recipient.wallet_address=binding.wallet_address
      join bx1_portal.fund_release_manifests manifest on manifest.id=recipient.manifest_id
        and manifest.product_id=subscription.product_id and manifest.offering_revision_id=subscription.offering_revision_id
      where subscription.id=target_subscription and recipient.state='CLAIM_SIGNATURE_REQUIRED'
        and c->>'organisationId'=manifest.native_organisation_id::text
        and bx1_portal.fund_recipient_current(recipient.id,c,'CLAIM_SIGNATURE')),false);
$$;
revoke all on function bx1_private.fund_recipient_compliance_order_visible(jsonb,uuid)
  from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer;

-- Replace one native read predicate in place; retain its OID, owner and ACL.
do $cutover$
declare definition text;body text;original text;actual_hash text;before_metadata jsonb;after_metadata jsonb;
  needle text:=$needle$      or (c->>'mode'='ROLE' and c->>'role' in ('OfferingManager','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController'))$needle$;
  replacement text:=$replacement$      or (c->>'mode'='ROLE' and c->>'role' in ('OfferingManager','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController'))
      or bx1_private.fund_recipient_compliance_order_visible(c,s.id)$replacement$;
begin
  select pg_catalog.pg_get_functiondef(p.oid),p.prosrc,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex'),
    pg_catalog.to_jsonb(p)-'prosrc'
    into definition,body,actual_hash,before_metadata from pg_catalog.pg_proc p
    where p.oid='bx1_portal.fund_order_visible(jsonb,uuid)'::regprocedure and p.proowner='postgres'::regrole
      and p.prosecdef and p.proconfig=array['search_path=""']::text[];
  if before_metadata is null or actual_hash is distinct from '2ef727f06db41cb915fa29011abee237e65e20533688e2590724084dd72fd6d3'
    or (pg_catalog.length(body)-pg_catalog.length(pg_catalog.replace(body,needle,'')))/pg_catalog.length(needle)<>1 then
    raise exception 'fund_recipient_compliance_queue_native_source_drift' using errcode='55000';end if;
  original:=body;body:=pg_catalog.replace(body,needle,replacement);
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,original,'')))/pg_catalog.length(original)<>1 then
    raise exception 'fund_recipient_compliance_queue_native_wrapper_drift' using errcode='55000';end if;
  execute pg_catalog.replace(definition,original,body);
  select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p
    where p.oid='bx1_portal.fund_order_visible(jsonb,uuid)'::regprocedure;
  if after_metadata is distinct from before_metadata then
    raise exception 'fund_recipient_compliance_queue_native_metadata_changed' using errcode='55000';end if;
end $cutover$;
