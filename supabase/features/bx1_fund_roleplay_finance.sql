-- Additive TEST-only financial integration after bx1_fund_roleplay_commands.
-- Six exact canonical bodies only. No role/person/provider/payment/journal is
-- seeded; NULL provenance and all property/legacy-denomination paths stay native.
do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_enter(jsonb,uuid,text,uuid,text)') is null
    or pg_catalog.to_regclass('bx1_portal.fund_admission_receipts') is null
    or pg_catalog.to_regclass('bx1_portal.fund_admission_requests') is null
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_finance_context(jsonb,uuid,text)') is not null then
    raise exception 'fund_roleplay_finance_exact_test_baseline_required' using errcode='55000';end if;
end $baseline$;

-- This is a TEST operating-capacity mapping, not a professional mandate or
-- invented organisation_authority_binding. The typed admission receipt,
-- actual native membership and exact saved policy/epoch all remain current.
-- Current callers separately require a genuine protected session; historical
-- evidence readers may check saved authority without borrowing a caller JWT.
create function bx1_private.fund_roleplay_finance_mandate_current(actor uuid,c jsonb,product uuid,action text,policy uuid,epoch integer) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_portal.fund_authorities a
    join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
    join bx1_private.roleplay_policies p on p.id=a.roleplay_policy_id
      and p.id=sp.roleplay_policy_id and p.id=m.roleplay_policy_id
      and p.authority_epoch=a.roleplay_epoch and p.authority_epoch=sp.roleplay_epoch and p.authority_epoch=m.roleplay_epoch
    join bx1_private.roleplay_capacities capacity on capacity.policy_id=p.id and capacity.user_id=actor
      and capacity.role=a.role and capacity.native_membership_id=a.native_membership_id
    join public.bx1_memberships native on native.id=a.native_membership_id and native.user_id=actor
      and native.role=a.role and native.organisation_id=p.native_organisation_id
    join bx1_portal.fund_admission_receipts receipt on receipt.id=a.authority_receipt_id
      and receipt.id=sp.admission_receipt_id and receipt.kind='ROLE_STATE'
    join bx1_portal.fund_admission_requests request on request.id=receipt.request_id
      and request.manifest_id=m.id and request.signer_policy_id=sp.id
    join bx1_portal.fund_setups setup on setup.id=request.setup_id
    where a.user_id=actor and a.person_id=p.actual_operator_person_id and a.role=c->>'role'
      and a.role in ('TreasuryOperator','FinancialController') and a.can_approve and not a.can_sign
      and p.id=policy and p.authority_epoch=epoch and p.product_id=product
      and m.product_id=product and m.offering_revision_id=p.offering_revision_id and m.native_organisation_id=p.native_organisation_id
      and c=pg_catalog.jsonb_build_object('mode','ROLE','organisationId',native.organisation_id,'role',native.role)
      and request.status='ADMITTED' and request.roleplay_policy_id=p.id and request.roleplay_epoch=p.authority_epoch
      and request.product_id=product and request.offering_revision_id=p.offering_revision_id
      and request.actor_id=actor and request.input_hash=bx1_portal.fund_digest(request.input)
      and request.result_hash=receipt.evidence->>'candidate_hash' and setup.recovery_hold is false
      and receipt.evidence_hash=bx1_portal.fund_digest(receipt.evidence)
      and receipt.evidence->>'kind'='ROLE_STATE' and receipt.evidence->>'roleplay_policy_id'=p.id::text
      and receipt.evidence->>'authority_epoch'=p.authority_epoch::text and receipt.evidence->>'product_id'=product::text
      and receipt.evidence->>'offering_revision_id'=p.offering_revision_id::text
      and receipt.evidence->>'source_pin'=m.source_commit and receipt.evidence->>'catalog_hash'=setup.catalog_hash
      and receipt.evidence->>'terms_hash'=m.terms_hash and receipt.evidence->>'configuration_hash'=m.configuration_hash
      and receipt.evidence->'independence_proven'='false'::jsonb
      and bx1_private.fund_roleplay_record_current(p.id,p.authority_epoch,product,p.offering_revision_id,actor,c,action)
      and bx1_private.fund_roleplay_authority_current(a.id) and bx1_portal.fund_manifest_current(m.id)),false);
$$;

create function bx1_private.fund_roleplay_finance_context(c jsonb,product uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(
    exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    and exists(select 1 from bx1_portal.products p where p.id=product and p.terms->>'asset_type'='FUND' and p.terms->>'currency'='TST')
    and c->>'mode'='ROLE' and (
      (c->>'role'='TreasuryOperator' and action in ('propose_funding_route','revoke_funding_route','verify_funding_route',
        'verify_funding_reference','propose_funding_acceptance','propose_funding_exception','propose_funding_reversal','open_funding_obligation'))
      or (c->>'role'='FinancialController' and action in ('approve_funding_route','verify_funding_route',
        'verify_funding_reference','reconcile_funding','resolve_funding_exception','approve_funding_reversal'))
      or (c->>'role'='Investor' and action in ('open_funding_obligation','submit_funding_reference','verify_funding_reference','cancel_subscription')))
    and bx1_private.fund_roleplay_context(c,product,action)
    and (c->>'role'='Investor' or exists(select 1 from bx1_portal.organisation_authority_bindings b
      join bx1_portal.products p on p.organisation_id=b.product_organisation_id and p.id=product
      where b.native_organisation_id::text=c->>'organisationId' and b.role=c->>'role' and b.status='ACTIVE'
        and b.valid_from<=pg_catalog.clock_timestamp() and b.valid_until>pg_catalog.clock_timestamp())
      or exists(select 1 from bx1_private.roleplay_policies p
        where p.id=bx1_private.fund_roleplay_current_policy(c,product,action)
          and bx1_private.fund_roleplay_finance_mandate_current(auth.uid(),c,product,action,p.id,p.authority_epoch))),false);
$$;
create function bx1_private.fund_roleplay_finance_enter(c jsonb,product uuid,action text,key uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare policy uuid;
begin
  if bx1_private.fund_roleplay_finance_context(c,product,action) is not true then return null;end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' then
    raise exception 'fund_roleplay_finance_request_key_required' using errcode='22023';end if;
  -- A retained idempotency receipt is read-only; never create newer provenance
  -- for an older native/role-play command merely because it was replayed.
  if exists(select 1 from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key) then return null;end if;
  policy:=bx1_private.fund_roleplay_enter(c,product,action,key,null);
  if policy is not null and c->>'role' in ('TreasuryOperator','FinancialController') then
    -- Revocation/reorg fencing shares the same admitted records, in addition
    -- to the policy/person/current-factor locks taken by the exact lane.
    perform a.id from bx1_portal.fund_authorities a
      join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
      join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
      join bx1_portal.fund_admission_requests request on request.manifest_id=m.id and request.signer_policy_id=sp.id
      join bx1_portal.fund_setups setup on setup.id=request.setup_id
      where a.user_id=auth.uid() and a.role=c->>'role' and m.product_id=product
        and a.roleplay_policy_id=policy and sp.roleplay_policy_id=policy and m.roleplay_policy_id=policy
      order by m.id,sp.id,a.id for share of m,sp,a,setup;
  end if;
  if policy is not null and (bx1_private.fund_roleplay_lane_current(c,product,action) is not true
    or bx1_private.fund_roleplay_finance_context(c,product,action) is not true) then
    raise exception 'fund_roleplay_finance_admission_expired_after_wait' using errcode='42501';end if;
  return policy;
end $$;

create function bx1_private.fund_roleplay_finance_proposer_current(kind text,target uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare value jsonb;product uuid;organisation uuid;offering uuid;actor uuid;person uuid;context jsonb;policy uuid;epoch integer;action text;
begin
  if kind='ROUTE' then
    select pg_catalog.to_jsonb(r),r.product_id,r.organisation_id into value,product,organisation from bx1_portal.funding_routes r where r.id=target;
    action:='propose_funding_route';
  elsif kind='ACCEPTANCE' then
    select pg_catalog.to_jsonb(a),o.product_id,o.organisation_id into value,product,organisation
      from bx1_portal.funding_acceptances a join bx1_portal.funding_references r on r.id=a.reference_id
      join bx1_portal.funding_obligations o on o.id=r.obligation_id where a.id=target;
    action:=case value->>'kind' when 'ACCEPTANCE' then 'propose_funding_acceptance' when 'EXCEPTION' then 'propose_funding_exception' end;
  elsif kind='REVERSAL' then
    select pg_catalog.to_jsonb(v),o.product_id,o.organisation_id into value,product,organisation
      from bx1_portal.funding_reversals v join bx1_portal.funding_obligations o on o.id=v.obligation_id where v.id=target;
    action:='propose_funding_reversal';
  else return false;end if;
  if value is null then return false;end if;
  actor:=(value->>'proposed_by')::uuid;person:=(value->>'proposed_person')::uuid;context:=value->'proposed_context';
  policy:=(value->>'roleplay_policy_id')::uuid;epoch:=(value->>'roleplay_epoch')::integer;
  if policy is null then return coalesce(bx1_portal.funding_proposer_current(actor,person,context,organisation),false);end if;
  select p.offering_revision_id into offering from bx1_private.roleplay_policies p
    where p.id=policy and p.authority_epoch=epoch and p.product_id=product;
  return coalesce(action is not null and person=bx1_private.fund_roleplay_person_for(product,actor)
    and bx1_private.fund_roleplay_record_current(policy,epoch,product,offering,actor,context,action)
    and (exists(select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=organisation
      and b.native_organisation_id::text=context->>'organisationId' and b.role=context->>'role' and b.status='ACTIVE'
      and b.valid_from<=pg_catalog.clock_timestamp() and b.valid_until>pg_catalog.clock_timestamp())
      or bx1_private.fund_roleplay_finance_mandate_current(actor,context,product,action,policy,epoch)),false);
end $$;

create function bx1_private.fund_roleplay_finance_approval_allowed(kind text,target uuid,c jsonb,action text,investor uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare value jsonb;product uuid;offering uuid;policy uuid;epoch integer;
begin
  if kind='ROUTE' and action='approve_funding_route' then
    select pg_catalog.to_jsonb(r),r.product_id into value,product from bx1_portal.funding_routes r where r.id=target;
  elsif kind='ACCEPTANCE' and action in ('reconcile_funding','resolve_funding_exception') then
    select pg_catalog.to_jsonb(a),o.product_id into value,product from bx1_portal.funding_acceptances a
      join bx1_portal.funding_references r on r.id=a.reference_id join bx1_portal.funding_obligations o on o.id=r.obligation_id where a.id=target;
    if (action='reconcile_funding') is distinct from (value->>'kind'='ACCEPTANCE') then return false;end if;
  elsif kind='REVERSAL' and action='approve_funding_reversal' then
    select pg_catalog.to_jsonb(v),o.product_id into value,product from bx1_portal.funding_reversals v
      join bx1_portal.funding_obligations o on o.id=v.obligation_id where v.id=target;
  else return false;end if;
  if value is null or value->>'roleplay_policy_id' is null or (value->>'proposed_by')::uuid is distinct from auth.uid()
    or bx1_private.fund_roleplay_finance_context(c,product,action) is not true
    or bx1_private.fund_roleplay_finance_proposer_current(kind,target) is not true then return false;end if;
  policy:=(value->>'roleplay_policy_id')::uuid;epoch:=(value->>'roleplay_epoch')::integer;
  if bx1_private.fund_roleplay_current_policy(c,product,action) is distinct from policy then return false;end if;
  select p.offering_revision_id into offering from bx1_private.roleplay_policies p where p.id=policy and p.authority_epoch=epoch and p.product_id=product;
  if bx1_private.fund_roleplay_record_current(policy,epoch,product,offering,auth.uid(),c,action) is not true then return false;end if;
  if investor is not null then
    if investor=auth.uid() then
      -- Same-person investor exception is bound to an actual saved/current
      -- issuer-approved basis under the SAME policy/epoch, never an email match.
      if not exists(select 1 from bx1_portal.fund_payment_allocation_bases b
        join bx1_portal.funding_obligations o on o.subscription_id=b.subscription_id
        join bx1_portal.funding_references r on r.obligation_id=o.id
        join bx1_portal.funding_acceptances a on a.reference_id=r.id
        where a.id=target and b.roleplay_policy_id=policy and b.roleplay_epoch=epoch
          and b.requested_by=investor and b.offering_revision_id=offering
          and bx1_portal.fund_payment_basis_current(b.subscription_id)
          and bx1_private.fund_roleplay_record_current(policy,epoch,product,offering,investor,b.requested_context,'request_fund_payment_allocation_basis')) then return false;end if;
    elsif bx1_portal.independent_of(investor) is not true then return false;end if;
  end if;
  return true;
end $$;

create function bx1_private.fund_roleplay_finance_route_current(target uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.funding_routes;offering uuid;
begin
  select * into r from bx1_portal.funding_routes where id=target;
  if r.id is null or r.roleplay_policy_id is null or r.status<>'APPROVED'
    or r.approved_by is distinct from r.proposed_by or r.approved_person is distinct from r.proposed_person
    or bx1_private.fund_roleplay_finance_proposer_current('ROUTE',r.id) is not true then return false;end if;
  select p.offering_revision_id into offering from bx1_private.roleplay_policies p
    where p.id=r.roleplay_policy_id and p.authority_epoch=r.roleplay_epoch and p.product_id=r.product_id;
  return exists(
    select 1 from bx1_private.fund_roleplay_command_receipts receipt join bx1_portal.scoped_requests request
      on request.actor_id=receipt.actual_actor_id and request.request_key=receipt.request_key and request.command=receipt.action
      and request.operating_context=receipt.operating_context
    where receipt.policy_id=r.roleplay_policy_id and receipt.authority_epoch=r.roleplay_epoch
      and receipt.product_id=r.product_id and receipt.offering_revision_id=offering
      and receipt.actual_actor_id=r.approved_by and receipt.actual_person_id=r.approved_person
      and receipt.action='approve_funding_route' and request.payload->>'route_id'=r.id::text
      and request.payload->'expected_revision'=pg_catalog.to_jsonb(r.revision-1)
      and bx1_private.fund_roleplay_record_current(r.roleplay_policy_id,r.roleplay_epoch,r.product_id,offering,r.approved_by,receipt.operating_context,'approve_funding_route'))
    or exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
      where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid() and lane.actor_id=r.approved_by
        and lane.policy_id=r.roleplay_policy_id and lane.authority_epoch=r.roleplay_epoch and lane.product_id=r.product_id
        and lane.offering_revision_id=offering and lane.action='approve_funding_route'
        and bx1_private.fund_roleplay_lane_current(lane.operating_context,lane.product_id,lane.action));
end $$;

create function bx1_private.fund_roleplay_finance_route_action(c jsonb,target uuid,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_portal.funding_routes r join bx1_private.roleplay_policies p
    on p.id=r.roleplay_policy_id and p.authority_epoch=r.roleplay_epoch and p.product_id=r.product_id
    where r.id=target and bx1_private.fund_roleplay_finance_context(c,r.product_id,action)
      and bx1_private.fund_roleplay_current_policy(c,r.product_id,action)=r.roleplay_policy_id
      and bx1_private.fund_roleplay_record_current(r.roleplay_policy_id,r.roleplay_epoch,r.product_id,p.offering_revision_id,auth.uid(),c,action)),false);
$$;
create function bx1_private.fund_roleplay_finance_record(kind text,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.funding_routes r where r.roleplay_policy_id is not null and (
    (kind='ROUTE' and r.id=target)
    or (kind='OBLIGATION' and exists(select 1 from bx1_portal.funding_obligations o where o.id=target and o.route_id=r.id))
    or (kind='REFERENCE' and exists(select 1 from bx1_portal.funding_references f join bx1_portal.funding_obligations o on o.id=f.obligation_id where f.id=target and o.route_id=r.id))
    or (kind='JOURNAL' and exists(select 1 from bx1_portal.funding_journals j join bx1_portal.funding_obligations o on o.id=j.obligation_id where j.id=target and o.route_id=r.id))
    or (kind='REVERSAL' and exists(select 1 from bx1_portal.funding_reversals v join bx1_portal.funding_obligations o on o.id=v.obligation_id where v.id=target and o.route_id=r.id))));
$$;
create function bx1_private.fund_roleplay_finance_visible(c jsonb,product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(c->>'mode'='ROLE' and c->>'role' in ('TreasuryOperator','FinancialController')
    and bx1_private.test_roleplay_protected_session() and exists(
    select 1 from bx1_portal.products target_product
      join bx1_private.roleplay_policies policy on policy.product_id=target_product.id
        and policy.offering_revision_id=target_product.current_offering_revision_id
        and policy.product_organisation_id=target_product.organisation_id
      join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id and capacity.user_id=auth.uid()
        and capacity.role=c->>'role'
      cross join lateral pg_catalog.unnest(capacity.actions) grant_action(value)
    where target_product.id=product and target_product.terms->>'asset_type'='FUND' and target_product.terms->>'currency'='TST'
      and policy.id=bx1_private.fund_roleplay_current_policy(c,product,grant_action.value)
      and bx1_private.fund_roleplay_finance_context(c,product,grant_action.value)
      and bx1_private.fund_roleplay_finance_mandate_current(auth.uid(),c,product,grant_action.value,policy.id,policy.authority_epoch)),false);
$$;
create function bx1_private.fund_roleplay_finance_order_visible(c jsonb,target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.subscriptions subscription
    join bx1_portal.products product on product.id=subscription.product_id
      and product.organisation_id=subscription.organisation_id
      and product.current_offering_revision_id=subscription.offering_revision_id
    where subscription.id=target and bx1_private.fund_roleplay_finance_visible(c,product.id));
$$;
create function bx1_private.fund_roleplay_finance_route_visible(c jsonb,target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.funding_routes route
    join bx1_portal.products product on product.id=route.product_id and product.organisation_id=route.organisation_id
    join bx1_private.roleplay_policies policy on policy.id=route.roleplay_policy_id and policy.authority_epoch=route.roleplay_epoch
      and policy.product_id=product.id and policy.offering_revision_id=product.current_offering_revision_id
    join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id and capacity.user_id=auth.uid() and capacity.role=c->>'role'
    cross join lateral pg_catalog.unnest(capacity.actions) grant_action(value)
    where route.id=target and bx1_private.fund_roleplay_finance_visible(c,product.id)
      and policy.id=bx1_private.fund_roleplay_current_policy(c,product.id,grant_action.value));
$$;
create function bx1_private.fund_roleplay_finance_read_current(c jsonb,result jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(bx1_private.test_roleplay_protected_session() and bx1_portal.valid_operating_context(c)
    and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(result->'products','[]'::jsonb)) item
      left join bx1_portal.products product on product.id=(item->>'id')::uuid
      where product.id is null or (bx1_portal.scoped_product_visible(c,product.id)
        or bx1_portal.scoped_finance(c,product.organisation_id) or bx1_private.fund_roleplay_finance_visible(c,product.id)) is not true)
    and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(result->'subscriptions','[]'::jsonb)) item
      where bx1_portal.funding_order_visible(c,(item->>'id')::uuid) is not true)
    and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(result#>'{funding,routes}','[]'::jsonb)) item
      left join bx1_portal.funding_routes route on route.id=(item->>'id')::uuid
      where route.id is null or (bx1_portal.scoped_operator(c,route.organisation_id)
        or bx1_portal.scoped_finance(c,route.organisation_id) or bx1_private.fund_roleplay_finance_route_visible(c,route.id)
        or exists(select 1 from bx1_portal.subscriptions subscription where subscription.product_id=route.product_id
          and bx1_portal.funding_order_visible(c,subscription.id)
          and (bx1_portal.scoped_operator(c,subscription.organisation_id) or bx1_portal.scoped_finance(c,subscription.organisation_id)
            or (subscription.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
            or bx1_private.fund_roleplay_finance_route_visible(c,route.id)))) is not true),false);
$$;
create function bx1_private.fund_roleplay_finance_actions(c jsonb,kind text,target uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb:='[]'::jsonb;r bx1_portal.funding_routes;o bx1_portal.funding_obligations;f bx1_portal.funding_references;
  a bx1_portal.funding_acceptances;j bx1_portal.funding_journals;v bx1_portal.funding_reversals;obs bx1_portal.funding_observations;
begin
  if kind='ROUTE' then
    select * into r from bx1_portal.funding_routes where id=target;
    if bx1_private.fund_roleplay_finance_route_action(c,r.id,'verify_funding_route') then result:=result||'"verify_funding_route"'::jsonb;end if;
    if r.roleplay_policy_id is not null and r.status<>'REVOKED'
      and bx1_private.fund_roleplay_finance_route_action(c,r.id,'revoke_funding_route') then result:=result||'"revoke_funding_route"'::jsonb;end if;
    if r.status='PROPOSED' and r.valid_until>pg_catalog.clock_timestamp()
      and bx1_private.fund_roleplay_finance_approval_allowed('ROUTE',r.id,c,'approve_funding_route')
      and exists(select 1 from bx1_portal.products p where p.id=r.product_id and p.status='PUBLISHED' and p.revision=r.product_revision and p.terms_hash=r.terms_hash)
      and bx1_portal.current_product_organisation(r.organisation_id)
      and exists(select 1 from bx1_portal.funding_observations x where x.route_id=r.id and x.reference_id is null and x.status='VERIFIED' and x.observed_at>pg_catalog.clock_timestamp()-interval '5 minutes') then result:=result||'"approve_funding_route"'::jsonb;end if;
  elsif kind='OBLIGATION' then
    select * into o from bx1_portal.funding_obligations where id=target;
    -- Reporting a transfer does not authorise a new payment. Retain native
    -- late/cancelled/revoked-route evidence behaviour under the saved policy.
    if o.investor_id=auth.uid() and c->>'role'='Investor'
      and bx1_portal.funding_order_visible(c,o.subscription_id)
      and bx1_private.fund_roleplay_finance_route_action(c,o.route_id,'submit_funding_reference') then result:=result||'"submit_funding_reference"'::jsonb;end if;
  elsif kind='REFERENCE' then
    select * into f from bx1_portal.funding_references where id=target;select * into o from bx1_portal.funding_obligations where id=f.obligation_id;
    select * into r from bx1_portal.funding_routes where id=o.route_id;
    if bx1_private.fund_roleplay_finance_route_action(c,r.id,'verify_funding_reference')
      and (c->>'role' in ('TreasuryOperator','FinancialController') or (c->>'role'='Investor' and o.investor_id=auth.uid())) then result:=result||'"verify_funding_reference"'::jsonb;end if;
    obs:=bx1_portal.funding_last_observation(f.id);
    if r.roleplay_policy_id is not null and f.status='VERIFIED' and obs.status='VERIFIED' and obs.observed_at>pg_catalog.clock_timestamp()-interval '5 minutes'
      and bx1_portal.funding_route_current(o.route_id) and bx1_portal.funding_account_current(o.id)
      and bx1_portal.funding_state(o.id) not in ('REVERSED','UNAPPLIED','CANCELLED')
      and bx1_private.fund_roleplay_finance_route_action(c,r.id,'propose_funding_acceptance') then result:=result||'"propose_funding_acceptance"'::jsonb;end if;
    if r.roleplay_policy_id is not null and f.status in ('SUBMITTED','VERIFIED','UNAPPLIED')
      and bx1_private.fund_roleplay_finance_route_action(c,r.id,'propose_funding_exception') then result:=result||'"propose_funding_exception"'::jsonb;end if;
    select * into a from bx1_portal.funding_acceptances where reference_id=f.id and approved_by is null and reference_revision=f.revision order by proposed_at desc,id desc limit 1;
    if a.evidence_set_hash=bx1_portal.funding_evidence_hash(o.id) and bx1_private.fund_roleplay_finance_proposer_current('ACCEPTANCE',a.id) then
      if f.status='ACCEPTANCE_PROPOSED' and obs.status='VERIFIED' and obs.observed_at>pg_catalog.clock_timestamp()-interval '5 minutes'
        and bx1_portal.funding_route_current(o.route_id) and bx1_portal.funding_account_current(o.id)
        and bx1_private.fund_roleplay_finance_approval_allowed('ACCEPTANCE',a.id,c,'reconcile_funding',o.investor_id) then result:=result||'"reconcile_funding"'::jsonb;
      elsif f.status='EXCEPTION_PROPOSED' and bx1_private.fund_roleplay_finance_approval_allowed('ACCEPTANCE',a.id,c,'resolve_funding_exception',o.investor_id) then result:=result||'"resolve_funding_exception"'::jsonb;end if;
    end if;
  elsif kind='JOURNAL' then
    select * into j from bx1_portal.funding_journals where id=target;select * into o from bx1_portal.funding_obligations where id=j.obligation_id;
    select * into r from bx1_portal.funding_routes where id=o.route_id;
    if r.roleplay_policy_id is not null and j.kind='FUNDING' and not exists(select 1 from bx1_portal.funding_reversals where journal_id=j.id)
      and bx1_private.fund_roleplay_finance_route_action(c,r.id,'propose_funding_reversal') then result:=result||'"propose_funding_reversal"'::jsonb;end if;
  elsif kind='REVERSAL' then
    select * into v from bx1_portal.funding_reversals where id=target;select * into o from bx1_portal.funding_obligations where id=v.obligation_id;
    if v.status='PROPOSED' and bx1_private.fund_roleplay_finance_approval_allowed('REVERSAL',v.id,c,'approve_funding_reversal') then result:=result||'"approve_funding_reversal"'::jsonb;end if;
  end if;
  return result;
end $$;


do $cutover$
declare signature text;definition text;body text;original_body text;actual text;metadata jsonb;after_metadata jsonb;cut jsonb;count integer;
  cuts jsonb:=$cuts$[
{
  "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
  "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
  "needle": "where s.product_id=r.product_id and bx1_portal.funding_order_visible(c,s.id))",
  "replacement": "where s.product_id=r.product_id and bx1_portal.funding_order_visible(c,s.id)\n          and (bx1_portal.scoped_operator(c,s.organisation_id) or bx1_portal.scoped_finance(c,s.organisation_id)\n            or (s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))\n            or bx1_private.fund_roleplay_finance_route_visible(c,r.id)))",
  "occurrences": 1
},
{
    "signature": "bx1_portal.funding_order_visible(jsonb,uuid)",
    "source_hash": "b6984073846d8db1d6e10ba49b3cecdb507b42d09f6ece66668aadb36bb320bf",
    "needle": "      or (s.investor_id=auth.uid()",
    "replacement": "      or bx1_private.fund_roleplay_finance_order_visible(c,s.id)\n      or (s.investor_id=auth.uid()",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped(jsonb)",
    "source_hash": "3b34a597808515a66ef0383eaeebe13a29d66bae0706ca438b53986fd7c168d6",
    "needle": "\nbegin\n",
    "replacement": "\ndeclare roleplay_result jsonb;\nbegin\n  if c->>'mode'='ROLE' and c->>'role' in ('TreasuryOperator','FinancialController')\n    and exists(select 1 from bx1_portal.products product where bx1_private.fund_roleplay_finance_visible(c,product.id)) then\n    roleplay_result:=bx1_portal.read_scoped_pre_entity_eligibility(c);\n    if bx1_private.fund_roleplay_finance_read_current(c,roleplay_result) is not true then\n      raise exception 'fund_roleplay_finance_read_scope_expired' using errcode='42501';end if;\n    return roleplay_result;\n  end if;\n",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "'authority_source','NATIVE_BINDING'",
    "replacement": "'authority_source',case when bx1_portal.scoped_finance(c,o.id) then 'NATIVE_BINDING' else 'TEST_ROLE_PLAY' end",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "from bx1_portal.organisations o where bx1_portal.scoped_finance(c,o.id)",
    "replacement": "from bx1_portal.organisations o where bx1_portal.scoped_finance(c,o.id)\n      or exists(select 1 from bx1_portal.products product where product.organisation_id=o.id and bx1_private.fund_roleplay_finance_visible(c,product.id))",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "bx1_portal.scoped_finance(c,p.organisation_id,'TreasuryOperator') and p.status='PUBLISHED'",
    "replacement": "(bx1_portal.scoped_finance(c,p.organisation_id,'TreasuryOperator') or bx1_private.fund_roleplay_finance_context(c,p.id,'propose_funding_route')) and p.status='PUBLISHED'",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "where bx1_portal.scoped_product_visible(c,p.id) or bx1_portal.scoped_finance(c,p.organisation_id)",
    "replacement": "where bx1_portal.scoped_product_visible(c,p.id) or bx1_portal.scoped_finance(c,p.organisation_id) or bx1_private.fund_roleplay_finance_visible(c,p.id)",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "bx1_portal.scoped_finance(c,s.organisation_id,'TreasuryOperator') or (s.investor_id=auth.uid()",
    "replacement": "bx1_portal.scoped_finance(c,s.organisation_id,'TreasuryOperator') or bx1_private.fund_roleplay_finance_context(c,s.product_id,'open_funding_obligation') or (s.investor_id=auth.uid()",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "and bx1_portal.funding_route_current(r.id)) then",
    "replacement": "and bx1_portal.funding_route_current(r.id) and (r.roleplay_policy_id is null or bx1_private.fund_roleplay_finance_route_action(c,r.id,'open_funding_obligation'))) then",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.read_scoped_pre_eligibility(jsonb)",
    "source_hash": "5846effba041a73a352e17a41e20d1a9697931a3a61d14a00622e51c3100c22d",
    "needle": "where bx1_portal.scoped_operator(c,r.organisation_id) or bx1_portal.scoped_finance(c,r.organisation_id)",
    "replacement": "where bx1_portal.scoped_operator(c,r.organisation_id) or bx1_portal.scoped_finance(c,r.organisation_id) or bx1_private.fund_roleplay_finance_route_visible(c,r.id)",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.funding_actions(jsonb,text,uuid)",
    "source_hash": "05604e5dcaab573f365ef8d0fc5200ebc35982f13f896b2498001b816e5254f8",
    "needle": "  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then return result; end if;",
    "replacement": "  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then return result; end if;\n  if bx1_private.fund_roleplay_finance_record(kind,target) then return bx1_private.fund_roleplay_finance_actions(c,kind,target);end if;",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.funding_actions(jsonb,text,uuid)",
    "source_hash": "05604e5dcaab573f365ef8d0fc5200ebc35982f13f896b2498001b816e5254f8",
    "needle": "  return result;\nend",
    "replacement": "  return (select coalesce(pg_catalog.jsonb_agg(value order by first_seen),'[]'::jsonb) from\n    (select value,pg_catalog.min(ordinality) first_seen from pg_catalog.jsonb_array_elements(result||bx1_private.fund_roleplay_finance_actions(c,kind,target)) with ordinality values_with_order(value,ordinality) group by value) unique_actions);\nend",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.funding_route_current(uuid)",
    "source_hash": "935a19f57316e0bbfc85403153bb3d49236343f9ccab91a54c21df90e3a37250",
    "needle": "and bx1_portal.current_product_organisation(r.organisation_id));",
    "replacement": "and bx1_portal.current_product_organisation(r.organisation_id)\n      and (r.roleplay_policy_id is null or bx1_private.fund_roleplay_finance_route_current(r.id)));",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "new_id uuid; evidence_hash text; result jsonb; approval_action boolean:=false;",
    "replacement": "new_id uuid; evidence_hash text; result jsonb; approval_action boolean:=false; rp_policy uuid;",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "-- Always lock before looking for an obligation: opening may be in flight.",
    "replacement": "-- Always lock before looking for an obligation: opening may be in flight.\n      rp_policy:=bx1_private.fund_roleplay_finance_enter(c,s.product_id,action,key);",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "    return result;\n  end if;",
    "replacement": "    if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,s.product_id,action,key); end if;\n    return result;\n  end if;",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "if org is null then raise exception 'funding_target_denied' using errcode='42501'; end if;",
    "replacement": "if org is null then raise exception 'funding_target_denied' using errcode='42501'; end if;\n  rp_policy:=bx1_private.fund_roleplay_finance_enter(c,pid,action,key);",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "bx1_portal.scoped_finance(c,org,required_role)",
    "replacement": "(bx1_portal.scoped_finance(c,org,required_role) or (rp_policy is not null and c->>'role'=required_role and bx1_private.fund_roleplay_lane_current(c,pid,action)))",
    "occurrences": 3
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "bx1_portal.scoped_finance(c,org,'TreasuryOperator')",
    "replacement": "(bx1_portal.scoped_finance(c,org,'TreasuryOperator') or (rp_policy is not null and c->>'role'='TreasuryOperator' and bx1_private.fund_roleplay_lane_current(c,pid,action)))",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "person:=bx1_portal.funding_person();",
    "replacement": "person:=case when rp_policy is null then bx1_portal.funding_person() else bx1_private.fund_roleplay_person_for(pid,actor) end;\n  if rp_policy is not null and (person is null or bx1_private.fund_roleplay_lane_current(c,pid,action) is not true) then raise exception 'fund_roleplay_finance_expired_after_wait' using errcode='42501';end if;",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "  if v.id is not null then select * into v from bx1_portal.funding_reversals where id=v.id for update; end if;",
    "replacement": "  if v.id is not null then select * into v from bx1_portal.funding_reversals where id=v.id for update; end if;\n  if action<>'propose_funding_route' then\n    if o.id is not null then select * into r from bx1_portal.funding_routes where id=o.route_id for share;end if;\n    if (rp_policy is not null or r.roleplay_policy_id is not null) and (rp_policy is null or r.id is null or r.roleplay_policy_id is distinct from rp_policy\n      or bx1_private.fund_roleplay_finance_route_action(c,r.id,action) is not true) then\n      raise exception 'fund_roleplay_finance_saved_route_scope_required' using errcode='42501';end if;\n  end if;",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "bx1_portal.funding_proposer_current(r.proposed_by,r.proposed_person,r.proposed_context,org)",
    "replacement": "bx1_private.fund_roleplay_finance_proposer_current('ROUTE',r.id)",
    "occurrences": 2
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "bx1_portal.funding_proposer_current(a.proposed_by,a.proposed_person,a.proposed_context,org)",
    "replacement": "bx1_private.fund_roleplay_finance_proposer_current('ACCEPTANCE',a.id)",
    "occurrences": 2
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,org)",
    "replacement": "bx1_private.fund_roleplay_finance_proposer_current('REVERSAL',v.id)",
    "occurrences": 2
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "or a.proposed_person=person or not bx1_portal.independent_of(o.investor_id) then",
    "replacement": "or ((a.proposed_person=person or bx1_portal.independent_of(o.investor_id) is not true)\n          and bx1_private.fund_roleplay_finance_approval_allowed('ACCEPTANCE',a.id,c,action,o.investor_id) is not true) then",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);",
    "replacement": "  if rp_policy is not null then perform bx1_private.fund_roleplay_finish(c,pid,action,key);end if;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);",
    "occurrences": 1
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "source_hash": "4a14e549f4711c6b68118930b482c213b2330a2c2dae9c2c2a012c27cdc542e1",
    "needle": "  if bx1_portal.funding_session() is not true then raise exception 'funding_session_expired' using errcode='42501'; end if;",
    "replacement": "  if bx1_portal.funding_session() is not true or (rp_policy is not null and bx1_private.fund_roleplay_finance_context(c,pid,action) is not true) then raise exception 'funding_session_expired' using errcode='42501'; end if;",
    "occurrences": 1
  }
]$cuts$::jsonb;
begin
  for signature in select distinct value->>'signature' from pg_catalog.jsonb_array_elements(cuts) order by 1 loop
    select pg_catalog.pg_get_functiondef(p.oid),p.prosrc,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex'),
      pg_catalog.to_jsonb(p)-'prosrc'
      into definition,body,actual,metadata from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(signature)
        and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
    if metadata is null or actual is distinct from (select value->>'source_hash' from pg_catalog.jsonb_array_elements(cuts) where value->>'signature'=signature limit 1) then
      raise exception 'fund_roleplay_finance_source_drift: %',signature using errcode='55000';end if;
    original_body:=body;
    for cut in select value from pg_catalog.jsonb_array_elements(cuts) where value->>'signature'=signature loop
      count:=(pg_catalog.length(body)-pg_catalog.length(pg_catalog.replace(body,cut->>'needle','')))/pg_catalog.length(cut->>'needle');
      if count<>(cut->>'occurrences')::integer then
        raise exception 'fund_roleplay_finance_cutpoint_drift: % / %',signature,cut->>'needle' using errcode='55000';end if;
      body:=pg_catalog.replace(body,cut->>'needle',cut->>'replacement');
    end loop;
    if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,original_body,'')))/pg_catalog.length(original_body)<>1 then
      raise exception 'fund_roleplay_finance_definition_wrapper_changed: %',signature using errcode='55000';end if;
    execute pg_catalog.replace(definition,original_body,body);
    select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(signature);
    if after_metadata is distinct from metadata then raise exception 'fund_roleplay_finance_native_metadata_changed: %',signature using errcode='55000';end if;
  end loop;
end $cutover$;

do $closed_helpers$
declare signature text;
begin
  for signature in select p.oid::regprocedure::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and pg_catalog.left(p.proname,22)='fund_roleplay_finance_' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker,bx1_document_receipt_writer',signature);
  end loop;
end $closed_helpers$;
