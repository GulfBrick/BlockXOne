-- Owner-run negative boundaries inside the atomic TEST installation envelope.
-- No fake people, JWT-backed session, MFA factor, grants, provider decisions,
-- signatures, tokens, accounting or ownership are created.
do $manager_negatives$
declare missing uuid:='00000000-0000-0000-0000-000000000001';
  c jsonb:='{"mode":"ROLE","organisationId":"00000000-0000-0000-0000-000000000002","role":"OfferingManager"}';
  denied boolean; before_counts jsonb; after_counts jsonb; helper oid;
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_manager_test_owner_required';end if;
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  select pg_catalog.jsonb_build_object(
    'policies',(select count(*) from bx1_private.roleplay_policies),
    'lanes',(select count(*) from bx1_private.fund_roleplay_command_lanes),
    'receipts',(select count(*) from bx1_private.fund_roleplay_command_receipts),
    'products',(select count(*) from bx1_portal.products),
    'appointments',(select count(*) from bx1_portal.product_service_appointments),
    'holdings',(select count(*) from bx1_portal.fund_holdings)) into before_counts;
  if bx1_private.fund_roleplay_manager_current(c,missing) is true
    or bx1_private.fund_roleplay_manager_current(c,missing,'publish_product') is true
    or bx1_private.fund_roleplay_manager_scope(c) is true
    or bx1_private.fund_roleplay_manager_command_operator(c,missing) is true
    or bx1_private.fund_roleplay_manager_publish_lane(missing,missing,c) is true
    or bx1_private.fund_roleplay_manager_publish_lane(missing,missing) is true
    or bx1_private.fund_roleplay_manager_offering_approved(c,missing) is true
    or bx1_private.fund_roleplay_manager_actions(c,missing)<>'[]'::jsonb then
    raise exception 'fund_roleplay_manager_missing_actual_authority_not_denied';end if;
  -- Merely asserting aal2 without a real user/session/factor is still denied.
  perform pg_catalog.set_config('request.jwt.claims',
    '{"role":"authenticated","aal":"aal2","iss":"https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1"}',true);
  if bx1_private.fund_roleplay_manager_current(c,missing) is true
    or bx1_private.fund_roleplay_manager_current(c||'{"role":"Investor"}'::jsonb,missing) is true
    or bx1_private.fund_roleplay_manager_current(c||'{"policy_id":"00000000-0000-0000-0000-000000000001"}'::jsonb,missing) is true then
    raise exception 'fund_roleplay_manager_unbacked_claim_not_denied';end if;
  denied:=false;
  begin perform bx1_private.fund_roleplay_manager_read(c);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_manager_unverified_read_not_denied';end if;
  denied:=false;
  begin perform bx1_private.fund_roleplay_manager_publish(c,missing,
    pg_catalog.jsonb_build_object('product_id',missing,'expected_revision',1));
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_manager_unverified_publish_not_denied';end if;
  denied:=false;
  begin perform bx1_private.fund_roleplay_manager_publish(c,missing,
    pg_catalog.jsonb_build_object('product_id',missing,'expected_revision',1,'approved',true));
  exception when invalid_parameter_value or check_violation or insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'fund_roleplay_manager_payload_authority_not_denied';end if;
  for helper in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and p.proname like 'fund_roleplay_manager_%' loop
    if has_function_privilege('anon',helper,'EXECUTE') or has_function_privilege('authenticated',helper,'EXECUTE')
      or has_function_privilege('service_role',helper,'EXECUTE') then
      raise exception 'fund_roleplay_manager_private_helper_exposed';end if;
  end loop;
  select pg_catalog.jsonb_build_object(
    'policies',(select count(*) from bx1_private.roleplay_policies),
    'lanes',(select count(*) from bx1_private.fund_roleplay_command_lanes),
    'receipts',(select count(*) from bx1_private.fund_roleplay_command_receipts),
    'products',(select count(*) from bx1_portal.products),
    'appointments',(select count(*) from bx1_portal.product_service_appointments),
    'holdings',(select count(*) from bx1_portal.fund_holdings)) into after_counts;
  if before_counts is distinct from after_counts then raise exception 'fund_roleplay_manager_negative_changed_data';end if;
end $manager_negatives$;
