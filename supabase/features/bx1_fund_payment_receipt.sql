-- Read-only bridge from the existing MetaMask payment to its payer claim.
-- No chain result, financial status, reference, role or approval is written.
do $preflight$
begin
  if current_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regprocedure('bx1_portal.fund_payment_projection(uuid)') is null
    or pg_catalog.to_regprocedure('public.bx1_portal_read_fund_payment(uuid,jsonb)') is not null then
    raise exception 'fund_payment_receipt_read_preflight' using errcode='55000'; end if;
end $preflight$;

create function bx1_portal.fund_read_payment(c jsonb,sid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.fund_payment_intents; s bx1_portal.subscriptions;
  o bx1_portal.funding_obligations; r bx1_portal.funding_routes;
begin
  if not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_portal.fund_context(c,false) is not true
    or (c->>'mode' is distinct from 'APPLICANT' and c->>'role' is distinct from 'Investor') then
    raise exception 'fund_payment_read_denied' using errcode='42501'; end if;
  select * into p from bx1_portal.fund_payment_intents where subscription_id=sid and actor_id=auth.uid();
  select * into s from bx1_portal.subscriptions where id=p.subscription_id and investor_id=auth.uid();
  if p.id is null or s.id is null or bx1_portal.fund_order_visible(c,s.id) is not true then
    raise exception 'fund_payment_read_denied' using errcode='42501'; end if;
  select * into o from bx1_portal.funding_obligations where id=p.obligation_id and subscription_id=s.id;
  select * into r from bx1_portal.funding_routes where id=p.route_id and product_id=s.product_id;
  -- Terms/route drift is not replaced with new instructions. The original
  -- hash remains in payment history for recovery by its authorised operators.
  if o.id is null or r.id is null or p.state<>'BROADCAST' or p.transaction_hash is null
    or o.investment_account_id<>s.investment_account_id or o.route_id<>r.id
    or p.route_revision<>r.revision or p.token_address<>r.token_address
    or p.beneficiary_address<>r.receiving_address or p.amount_base_units<>o.token_amount_base_units
    or o.currency<>'TST' or r.denomination<>'TST' or r.chain_id<>80002 or r.token_decimals<>6
    or bx1_portal.funding_route_current(r.id) is not true then
    raise exception 'fund_payment_saved_reference_changed' using errcode='23514'; end if;
  if bx1_portal.fund_context(c,false) is not true or bx1_portal.fund_order_visible(c,s.id) is not true then
    raise exception 'fund_payment_read_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id),
    'token_runtime_hash',r.token_runtime_hash,'investment_account_id',o.investment_account_id,
    'obligation_created_at',o.created_at,'route_valid_until',r.valid_until);
end $$;

create function public.bx1_portal_read_fund_payment(subscription_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select bx1_portal.fund_read_payment(operating_context,subscription_id);
$$;
revoke all on function bx1_portal.fund_read_payment(jsonb,uuid),public.bx1_portal_read_fund_payment(uuid,jsonb)
  from public,anon,authenticated,service_role,bx1_fund_execution_worker;
grant execute on function bx1_portal.fund_read_payment(jsonb,uuid),public.bx1_portal_read_fund_payment(uuid,jsonb)
  to authenticated;
