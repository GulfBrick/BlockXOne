-- Metadata/negative-boundary evidence only. Does not manufacture a READY
-- identity, prove MetaMask registration or claim a completed issuance.
do $recipient_allocation_gate_proof$
declare actual text;missing uuid:='00000000-0000-0000-0000-000000000001';
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_recipient_allocation_proof_test_owner_required';end if;
  select prosrc into actual from pg_catalog.pg_proc where oid='bx1_portal.fund_allocation_current(uuid)'::regprocedure;
  if position('where a.id=target and (a.roleplay_policy_id is null or bx1_portal.fund_recipient_ready_for_allocation(a.id)) and' in actual)=0
    or position('bx1_portal.fund_payment_basis_current(s.id)' in actual)=0
    or position('bx1_portal.funding_state(o.id)=''RECONCILED''' in actual)=0
    or position('bx1_portal.product_eligibility_current(eligibility.id)' in actual)=0
    or position('bx1_portal.fund_binding_current(a.delivery_binding_id)' in actual)=0
    or position('not exists(select 1 from bx1_portal.funding_reversals' in actual)=0 then
    raise exception 'fund_recipient_allocation_required_guards_missing';end if;
  if bx1_portal.fund_recipient_ready_for_allocation(missing) is true or bx1_portal.fund_allocation_current(missing) is true then
    raise exception 'fund_recipient_missing_identity_or_allocation_not_denied';end if;
  if has_function_privilege('anon','bx1_portal.fund_recipient_ready_for_allocation(uuid)','EXECUTE')
    or has_function_privilege('authenticated','bx1_portal.fund_recipient_ready_for_allocation(uuid)','EXECUTE') then
    raise exception 'fund_recipient_allocation_private_guard_exposed';end if;
end $recipient_allocation_gate_proof$;
