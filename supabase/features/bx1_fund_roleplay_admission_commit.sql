-- Same existing TEST investor save/response correction; no business outcome installed.
-- Contract 50B50F1C4D2851E7F3D9DC3A3CD290C9874EF933B1D3FC65F79DA99A4C2018C6.
do $admission_commit_install$
declare target constant oid:=24447; helper_oid oid; dependency jsonb; permission record;
  before_row jsonb; after_row jsonb; original constant text:=$native_original$declare v_actor uuid:=auth.uid(); old_request bx1_portal.scoped_requests; app bx1_portal.applications;
  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions; account_row bx1_portal.investment_accounts;
  v_org uuid; account_id uuid; forwarded jsonb:=body; ignored jsonb; v_subject_id uuid;
  prior_order_ids uuid[]; new_order_ids uuid[];
begin
  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_context(c,action) is not true then
    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;
  perform bx1_portal.offering_workflow_lock_actor(action,c);
  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(body) is distinct from 'object'
    or octet_length(body::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));
  -- Pin authority rows until commit; a concurrently completed revocation must be
  -- observed after a wait. Expiry uses wall time, not transaction-start now().
  perform id from auth.users where id=v_actor for share;
  perform id from auth.sessions where user_id=v_actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=v_actor for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=v_actor and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;
  select * into old_request from bx1_portal.scoped_requests where actor_id=v_actor and request_key=key;
  if found then
    if old_request.operating_context is distinct from c or old_request.command is distinct from action or old_request.payload is distinct from body then
      raise exception 'portal_context_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=v_actor and request_key=key) then raise exception 'portal_legacy_key_conflict' using errcode='23505'; end if;
  -- Personal onboarding is always the actor's own principal, never organisation
  -- authority; native staff may submit it without changing their selected role.
  if action in ('create_investment_account','subscribe','cancel_subscription') then
    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'portal_investor_context_required' using errcode='42501'; end if;
  end if;
  if action='create_product' then v_org:=(body->>'organisation_id')::uuid;
  elsif action in ('save_product','submit_product','review_product','publish_product','subscribe') then
    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid;
    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;
    v_org:=p.organisation_id;
  elsif action='cancel_subscription' then
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid and investor_id=v_actor;
    if not found then raise exception 'portal_subscription_denied' using errcode='42501'; end if;
    v_org:=s.organisation_id;
  end if;
  if v_org is not null then
    if (bx1_portal.admission_password_session() or bx1_portal.test_workspace_entitlement(c) is not null) and bx1_portal.offering_workflow_command_allowed(c,action) then
      if action='create_product' then perform bx1_portal.offering_workflow_lock_organisation(c,v_org);
      else perform bx1_portal.offering_workflow_lock_product(c,p.id); end if;
    end if;
    select * into o from bx1_portal.organisations where id=v_org for share;
    perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=v_org order by id for share;
    if action in ('create_product','save_product','submit_product','publish_product') and bx1_portal.offering_workflow_operator(c,v_org) is not true then
      raise exception 'portal_operator_scope_denied' using errcode='42501'; end if;
    if action='review_product' and bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id) is not true then
      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;
  end if;
  if action='review_application' then
    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid for update;
    if not found or bx1_portal.admission_application_reviewer(c,app.reviewer_scope,app.organisation_id) is not true then
      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;
    perform bx1_private.fund_roleplay_admission_enter(c,key,body);
  elsif action='create_investment_account' then
    perform bx1_portal.require_keys(body,array['application_id']);
    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid and user_id=v_actor for update;
    if not found or app.persona<>'INVESTOR' or app.status<>'APPROVED' or app.approved_until<=clock_timestamp()
      or app.details->>'investor_type' is distinct from 'INDIVIDUAL' then raise exception 'portal_individual_approval_required' using errcode='42501'; end if;
    insert into bx1_portal.investment_accounts(holder_user_id,application_id) values(v_actor,app.id) returning * into account_row;
    v_subject_id:=account_row.id;
    insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,key,action,body);
    insert into bx1_portal.events(subject_id,application_id,investor_id,kind,actor_id,summary)
      values(v_subject_id,app.id,v_actor,action,v_actor,'Individual investment account opened from current reviewed application. No holding or funding created.');
  elsif action='subscribe' then
    account_id:=(body->>'investment_account_id')::uuid;
    select * into account_row from bx1_portal.investment_accounts where id=account_id for share;
    if bx1_portal.account_usable(c,account_id) is not true then raise exception 'portal_account_denied' using errcode='42501'; end if;
    perform id from bx1_portal.applications where id=account_row.application_id for share;
    -- Claim the capacity row before the last account/authority/expiry check.
    perform id from bx1_portal.products where id=p.id for update;
    if bx1_portal.account_usable(c,account_id) is not true or not (case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',key,c) else bx1_portal.current_product_organisation(v_org) end) then
      raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;
    forwarded:=body-'investment_account_id';
    select coalesce(array_agg(existing.id),'{}'::uuid[]) into prior_order_ids from bx1_portal.subscriptions existing
      where existing.investor_id=v_actor and existing.product_id=p.id;
  elsif action='cancel_subscription' and s.investment_account_id is not null then
    -- Cancellation does not require renewed KYC, but cannot act for another account.
    if not exists(select 1 from bx1_portal.investment_accounts where id=s.investment_account_id and holder_user_id=v_actor) then
      raise exception 'portal_account_denied' using errcode='42501'; end if;
  end if;
  if action<>'create_investment_account' then
    if (bx1_portal.admission_password_session() or bx1_portal.test_workspace_entitlement(c) is not null) and bx1_portal.offering_workflow_command_allowed(c,action) then
      ignored:=bx1_portal.offering_workflow_base_command(c,action,key,forwarded);
    else ignored:=bx1_portal.execute_command(action,key,forwarded); end if;
    if action='subscribe' then
      -- The actor lock serializes all writes and the product lock holds capacity.
      -- Bind the exact newly inserted row, never a timestamp/latest-row guess.
      select array_agg(new_order.id) into new_order_ids from bx1_portal.subscriptions new_order
        where new_order.investor_id=v_actor and new_order.product_id=p.id and not(new_order.id=any(prior_order_ids));
      if coalesce(cardinality(new_order_ids),0)<>1 then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;
      update bx1_portal.subscriptions set investment_account_id=account_id where id=new_order_ids[1] and investor_id=v_actor and investment_account_id is null;
      if not found then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;
    end if;
  end if;
  if bx1_portal.offering_workflow_command_context(c,action) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;
  if v_org is not null and action in ('create_product','save_product','submit_product','publish_product') and not bx1_portal.offering_workflow_operator(c,v_org) then
    raise exception 'portal_authority_expired' using errcode='42501'; end if;
  if (action='review_product' and not bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id))
    or (action='review_application' and not bx1_portal.admission_application_reviewer(c,app.reviewer_scope,app.organisation_id)) then
    raise exception 'portal_reviewer_scope_expired' using errcode='42501'; end if;
  if action='subscribe' and (not bx1_portal.account_usable(c,account_id) or not (case when p.review_roleplay_policy_id is not null then bx1_private.fund_roleplay_investor_write_lane(p.id,'subscribe',key,c) else bx1_portal.current_product_organisation(v_org) end)) then
    raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;
  if action='create_investment_account' and not bx1_portal.admission_individual_account_current(c,account_row.id) then
    raise exception 'portal_account_approval_expired' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);
  perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);
  -- The pinned immutable-package writer discards this intermediate snapshot.
  -- Idempotency replay above remains a full reader and is never suppressed.
  if action='submit_product' and c->>'mode'='ROLE' and c->>'role'='OfferingManager'
    and bx1_portal.test_offering_lane_current(c,p.id,key,'submit_product') is true then
    return pg_catalog.jsonb_build_object('internal_continuation','SUBMIT_PACKAGE');
  end if;
  if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then
    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');
  end if;
  return bx1_portal.read_scoped(c);
end$native_original$;
  expected_metadata constant jsonb:=$target_metadata${"oid":"24447","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_scoped_p2","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
  original_sha constant text:='7dc78c7f016229e2209a3235eda1db874b3ef573b53d17083c007bf7052d07d0';
  dependencies constant jsonb:=$dependencies$[{"oid":"16542","sha":"9ab5ea099e74ec09e83b1505c51a3647791195aed7c742dcc3f257dfc7d2f300","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"16714","sha":"fed2a8ac0349ffaba807c1b574698bfb1348825b8ef5163ad72d8408386f5e3e","metadata":{"oid":"16714","proacl":["=X/supabase_auth_admin","postgres=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"jwt","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"27039","sha":"8fee52076847a861a51b598571efcf40335ef6ebad2c284b979258ab6f8fc0c2","metadata":{"oid":"27039","proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_scoped","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"27107","sha":"9176731bf644dcbcdaa399901e24846da26522cbdfd4aa76dc0ac39a921a0e82","metadata":{"oid":"27107","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"admission_application_reviewer","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_scope","target_org"],"proargtypes":["3802","2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":"({CONST :consttype 2950 :consttypmod -1 :constcollid 0 :constlen 16 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}},{"oid":"27113","sha":"b61b281fa60b9f21e60aca0fa07b833025f1838d1eb8255b8e7ee9e69e34fe75","metadata":{"oid":"27113","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"admission_individual_account_current","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_account"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"33388","sha":"a5cec2e5a02b1cbc57f13a0a77d526c363bb9a2467de83e12382161388819865","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"33389","sha":"e183693977b0df93fa12c838bcdea27bfd4e80e91a9a17c611ee31e0bebd5784","metadata":{"oid":"33389","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_roleplay_protected_session","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"36223","sha":"dbcfc49997ae3de015a31d782e2695caad66c01cf116e6edfa8b98cddf45381b","metadata":{"oid":"36223","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_appointed","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product","role_name"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38178","sha":"adea38cb2ede4853650398e949e5827c0ea139d46d7919514fc631fa0d108c8c","metadata":{"oid":"38178","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_binding_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_binding"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38184","sha":"37a84b679f1d5bc4d2fcffff13e87865fb021ed65d5704c5b874310754d0f6a1","metadata":{"oid":"38184","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_decision_bound","prorows":0,"pronargs":11,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_id","p_user","p_reviewer","p_revision","p_status","p_details","p_submitted","p_reviewed","p_notes","p_checks","p_approved"],"proargtypes":["2950","2950","2950","23","25","3802","1184","1184","25","3802","1184"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38188","sha":"0e8620daae6162083a54d73467168de62c083bb7f165401106662dc3d547f40b","metadata":{"oid":"38188","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_application"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38189","sha":"1a65a12232cde427996388b55a01fad411a3e5767b3fdbd8d299b813db250c68","metadata":{"oid":"38189","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_product","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_application","p_product"],"proargtypes":["2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38190","sha":"c1e3b355ec7dd63cc6ac4538910dd04fd20d582828c311183622607794674fa1","metadata":{"oid":"38190","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_roleplay_admission_finish","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2278","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_context","p_action","p_key","p_payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]$dependencies$::jsonb;
  expected_evidence constant jsonb:=$evidence$[{"kind":"constraint","value":{"oid":"24292","conbin":null,"conkey":[1,2],"confkey":null,"conname":"requests_pkey","contype":"p","conindid":"24291","conrelid":"24285","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24400","conbin":null,"conkey":[1],"confkey":null,"conname":"investment_accounts_pkey","contype":"p","conindid":"24399","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24402","conbin":null,"conkey":[3],"confkey":null,"conname":"investment_accounts_application_id_key","contype":"u","conindid":"24401","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24404","conbin":null,"conkey":[1,2],"confkey":null,"conname":"investment_accounts_id_holder_user_id_key","contype":"u","conindid":"24403","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24427","conbin":null,"conkey":[1,2],"confkey":null,"conname":"scoped_requests_pkey","contype":"p","conindid":"24426","conrelid":"24420","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"25503","conbin":null,"conkey":[7],"confkey":null,"conname":"investment_accounts_entity_party_id_key","contype":"u","conindid":"25502","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38132","conbin":null,"conkey":[1],"confkey":null,"conname":"fund_roleplay_admission_decisions_pkey","contype":"p","conindid":"38131","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38134","conbin":null,"conkey":[3,5],"confkey":null,"conname":"fund_roleplay_admission_decis_application_id_decision_revis_key","contype":"u","conindid":"38133","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38136","conbin":null,"conkey":[6,9],"confkey":null,"conname":"fund_roleplay_admission_decisions_actor_id_request_key_key","contype":"u","conindid":"38135","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"default","value":{"table":"bx1_portal.events","column":"created_at","expression":"now()"}},{"kind":"default","value":{"table":"bx1_portal.investment_accounts","column":"created_at","expression":"clock_timestamp()"}},{"kind":"default","value":{"table":"bx1_portal.requests","column":"created_at","expression":"now()"}},{"kind":"default","value":{"table":"bx1_portal.scoped_requests","column":"created_at","expression":"clock_timestamp()"}},{"kind":"trigger","value":{"oid":"24346","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_requests_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24285","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"24347","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_events_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24298","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"24436","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_scoped_request_guard","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24420","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"38175","tgargs":"\\x","tgattr":[],"tgfoid":"38174","tgname":"fund_roleplay_admission_binding_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"38056","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"38176","tgargs":"\\x","tgattr":[],"tgfoid":"38174","tgname":"fund_roleplay_admission_decision_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"38115","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}}]$evidence$::jsonb;
  helper_metadata constant jsonb:=$helper_metadata${"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_roleplay_admission_commit","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_context","p_action","p_key","p_payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$helper_metadata$::jsonb;
  helper_body constant text:=$helper_body$
declare
  actor uuid:=auth.uid(); caller_session uuid;
  saved_application bx1_portal.applications; saved_binding bx1_private.fund_roleplay_admission_bindings;
  saved_decision bx1_private.fund_roleplay_admission_decisions; saved_account bx1_portal.investment_accounts;
  base_request bx1_portal.requests; scoped_request bx1_portal.scoped_requests; saved_event bx1_portal.events;
  event_count bigint; subject uuid;
begin
  if p_action is null or p_action not in ('review_application','create_investment_account') or actor is null
    or p_key is null or p_key='00000000-0000-0000-0000-000000000000'::uuid
    or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' then return null;end if;
  select application.* into saved_application from bx1_portal.applications application
    where application.id=(p_payload->>'application_id')::uuid;
  if saved_application.id is null or saved_application.user_id is distinct from actor then return null;end if;
  if p_action='review_application' then
    select decision.* into saved_decision from bx1_private.fund_roleplay_admission_decisions decision
      where decision.actor_id=actor and decision.request_key=p_key;
  else
    -- Ordinary accounts never acquire a TEST admission provenance on replay.
    if not exists(select 1 from bx1_private.fund_roleplay_admission_bindings binding
      where binding.application_id=saved_application.id) then return null;end if;
    select decision.* into saved_decision from bx1_private.fund_roleplay_admission_decisions decision
      where decision.application_id=saved_application.id and decision.decision_revision=saved_application.revision;
  end if;
  if saved_decision.id is null then return null;end if;
  select binding.* into saved_binding from bx1_private.fund_roleplay_admission_bindings binding
    where binding.id=saved_decision.binding_id;
  select receipt.* into base_request from bx1_portal.requests receipt
    where receipt.actor_id=actor and receipt.request_key=p_key;
  select receipt.* into scoped_request from bx1_portal.scoped_requests receipt
    where receipt.actor_id=actor and receipt.request_key=p_key;
  if /* admission_commit_common_begin */
    saved_binding.id is null or saved_binding.application_id is distinct from saved_application.id
    or saved_binding.applicant_id is distinct from actor
    or saved_decision.application_id is distinct from saved_application.id or saved_decision.actor_id is distinct from actor
    or saved_decision.submitted_revision is distinct from saved_binding.submitted_revision
    or saved_decision.decision_revision is distinct from saved_binding.submitted_revision+1
    or saved_application.revision is distinct from saved_decision.decision_revision
    or saved_application.reviewer_id is distinct from actor or saved_application.status is distinct from saved_decision.decision
    or saved_binding.independence_proven is distinct from false or saved_decision.independence_proven is distinct from false
    or base_request.actor_id is distinct from actor or scoped_request.actor_id is distinct from actor
    or base_request.request_key is distinct from p_key or scoped_request.request_key is distinct from p_key
    or base_request.command is distinct from p_action or scoped_request.command is distinct from p_action
    or base_request.payload is distinct from p_payload or scoped_request.payload is distinct from p_payload
    or scoped_request.operating_context is distinct from p_context
    or base_request.created_at is null or scoped_request.created_at is null
    or pg_catalog.isfinite(base_request.created_at) is not true or pg_catalog.isfinite(scoped_request.created_at) is not true
    or base_request.created_at>scoped_request.created_at
    or saved_decision.reviewed_at is null or pg_catalog.isfinite(saved_decision.reviewed_at) is not true
    or saved_decision.session_id is null or saved_decision.session_id='00000000-0000-0000-0000-000000000000'::uuid
    or saved_binding.policy_id is null or saved_binding.authority_epoch is null or saved_binding.authority_epoch<=0
    or saved_binding.product_id is null or saved_binding.offering_revision_id is null
    /* admission_commit_common_end */ then
    raise exception 'fund_roleplay_admission_commit_binding_changed' using errcode='42501';end if;
  if /* admission_commit_authority_begin */ bx1_private.test_roleplay_environment() is not true
    or bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_admission_binding_current(saved_binding.id) is not true
    or bx1_private.fund_roleplay_admission_decision_bound(saved_application.id,saved_application.user_id,
      saved_application.reviewer_id,saved_application.revision,saved_application.status,saved_application.details,
      saved_application.submitted_at,saved_application.reviewed_at,saved_application.review_notes,
      saved_application.review_checks,saved_application.approved_until) is not true /* admission_commit_authority_end */ then
    raise exception 'fund_roleplay_admission_commit_authority_changed' using errcode='42501';end if;
  caller_session:=(auth.jwt()->>'session_id')::uuid;
  if caller_session is null or caller_session='00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'fund_roleplay_admission_commit_session_required' using errcode='42501';end if;
  if p_action='review_application' then
    if /* admission_commit_review_begin */
      p_context is distinct from pg_catalog.jsonb_build_object('mode','ROLE',
        'organisationId',saved_binding.native_organisation_id::text,'role','ComplianceOfficer')
      or saved_decision.operating_context is distinct from p_context
      or saved_decision.request_key is distinct from p_key or saved_decision.command_payload is distinct from p_payload
      or p_payload->'expected_revision' is distinct from pg_catalog.to_jsonb(saved_binding.submitted_revision)
      or p_payload->>'decision' is distinct from saved_decision.decision
      or saved_decision.reviewed_at<base_request.created_at or saved_decision.reviewed_at>scoped_request.created_at
      /* admission_commit_review_end */ then
      raise exception 'fund_roleplay_admission_commit_review_changed' using errcode='42501';end if;
    if bx1_portal.admission_application_reviewer(p_context,saved_application.reviewer_scope,saved_application.organisation_id) is not true
      or bx1_private.fund_roleplay_appointed(p_context,saved_binding.product_id,'ComplianceOfficer') is not true then
      raise exception 'fund_roleplay_admission_commit_review_authority_changed' using errcode='42501';end if;
    subject:=saved_application.id;
  else
    select account_row.* into saved_account from bx1_portal.investment_accounts account_row
      where account_row.application_id=saved_application.id;
    if /* admission_commit_account_begin */
      (p_context is distinct from '{"mode":"APPLICANT"}'::jsonb
        and p_context is distinct from pg_catalog.jsonb_build_object('mode','ROLE',
          'organisationId',saved_binding.native_organisation_id::text,'role','Investor'))
      or saved_decision.decision is distinct from 'APPROVED'
      or saved_account.id is null or saved_account.application_id is distinct from saved_application.id
      or saved_account.holder_user_id is distinct from actor or saved_account.kind is distinct from 'INDIVIDUAL'
      or saved_account.status is distinct from 'ACTIVE' or saved_account.entity_party_id is not null
      or saved_account.created_at is null or pg_catalog.isfinite(saved_account.created_at) is not true
      or saved_account.created_at<base_request.created_at or saved_account.created_at>scoped_request.created_at
      or saved_account.created_at<saved_decision.reviewed_at
      /* admission_commit_account_end */ then
      raise exception 'fund_roleplay_admission_commit_account_changed' using errcode='42501';end if;
    if bx1_portal.admission_individual_account_current(p_context,saved_account.id) is not true
      or bx1_private.fund_roleplay_admission_product(saved_application.id,saved_binding.product_id) is not true then
      raise exception 'fund_roleplay_admission_commit_account_authority_changed' using errcode='42501';end if;
    subject:=saved_account.id;
  end if;
  -- The canonical event and base request use the same now() transaction time.
  -- Account/scoped receipt use clock_timestamp(); never equate those clocks.
  select count(*) into event_count from bx1_portal.events event_row
    where event_row.subject_id=subject and event_row.application_id=saved_application.id
      and event_row.actor_id=actor and event_row.kind=p_action and event_row.created_at=base_request.created_at;
  if event_count=1 then
    select event_row.* into saved_event from bx1_portal.events event_row
      where event_row.subject_id=subject and event_row.application_id=saved_application.id
        and event_row.actor_id=actor and event_row.kind=p_action and event_row.created_at=base_request.created_at;
  end if;
  if /* admission_commit_event_begin */
    event_count is distinct from 1 or saved_event.id is null or saved_event.subject_id is distinct from subject
    or saved_event.application_id is distinct from saved_application.id or saved_event.actor_id is distinct from actor
    or saved_event.kind is distinct from p_action or saved_event.created_at is distinct from base_request.created_at
    /* admission_commit_event_end */ then
    raise exception 'fund_roleplay_admission_commit_event_required' using errcode='42501';end if;
  -- No lane is borrowed after finish. Recheck live authority against ORIGINAL
  -- saved provenance after all reads, while the canonical writer's locks remain.
  if /* admission_commit_final_begin */ bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_admission_binding_current(saved_binding.id) is not true
    or (case when p_action='review_application' then
      bx1_portal.admission_application_reviewer(p_context,saved_application.reviewer_scope,saved_application.organisation_id)
        and bx1_private.fund_roleplay_appointed(p_context,saved_binding.product_id,'ComplianceOfficer')
      else bx1_portal.admission_individual_account_current(p_context,saved_account.id)
        and bx1_private.fund_roleplay_admission_product(saved_application.id,saved_binding.product_id) end) is not true
    or (auth.jwt()->>'session_id')::uuid is distinct from caller_session /* admission_commit_final_end */ then
    raise exception 'fund_roleplay_admission_commit_expired_at_return' using errcode='42501';end if;
  return pg_catalog.jsonb_build_object(
    'kind',case p_action when 'review_application' then 'TEST_FUND_ADMISSION_COMMIT' else 'TEST_FUND_ACCOUNT_COMMIT' end,
    'version',1,'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',actor,'session_id',caller_session,'operating_context',p_context,
    'policy_id',saved_binding.policy_id,'authority_epoch',saved_binding.authority_epoch,
    'product_id',saved_binding.product_id,'offering_revision_id',saved_binding.offering_revision_id,
    'application_id',saved_application.id,'event_id',saved_event.id,
    'request',pg_catalog.jsonb_build_object('command',p_action,'key',p_key,'payload',p_payload),
    'recorded_at',case p_action when 'review_application' then saved_decision.reviewed_at else saved_event.created_at end)
    ||case p_action when 'review_application' then pg_catalog.jsonb_build_object(
      'decision_id',saved_decision.id,'submitted_revision',saved_decision.submitted_revision,
      'decision_revision',saved_decision.decision_revision,'decision',saved_decision.decision)
      else pg_catalog.jsonb_build_object('account_id',saved_account.id,'application_revision',saved_application.revision,
        'admission_decision_id',saved_decision.id) end;
end
$helper_body$;
  old_return constant text:='return bx1_portal.read_scoped(c);';
  new_return constant text:='return coalesce(bx1_private.fund_roleplay_admission_commit(c,action,key,body),bx1_portal.read_scoped(c));';
  next_body text; definition text; restored text; existing_evidence jsonb; bootstrap boolean;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'admission_commit_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from jsonb_array_elements(dependencies) loop
    select to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=(dependency->>'oid')::oid;
    if before_row is null or before_row-'prosrc' is distinct from dependency->'metadata'
      or encode(sha256(convert_to(before_row->>'prosrc','UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'admission_commit_dependency_changed: %',dependency->>'oid' using errcode='55000';end if;
  end loop;
  select (select coalesce(jsonb_agg(to_jsonb(evidence_row) order by evidence_row.kind,evidence_row.value::text),'[]'::jsonb) from (
 select 'default' kind,jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid)) value
 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attname='created_at' and a.attrelid in('bx1_portal.events'::regclass,'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,'bx1_portal.investment_accounts'::regclass)
 union all select 'constraint',to_jsonb(c) from pg_catalog.pg_constraint c where c.conrelid in(
 'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,'bx1_portal.investment_accounts'::regclass,
 'bx1_private.fund_roleplay_admission_decisions'::regclass) and c.contype in('u','p')
 union all select 'trigger',to_jsonb(t) from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgrelid in(
 'bx1_portal.events'::regclass,'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,
 'bx1_private.fund_roleplay_admission_bindings'::regclass,'bx1_private.fund_roleplay_admission_decisions'::regclass)
 ) evidence_row) into existing_evidence;
  if (jsonb_array_length(existing_evidence) is distinct from jsonb_array_length(expected_evidence) or existing_evidence @> expected_evidence is not true or expected_evidence @> existing_evidence is not true) then
    raise exception 'admission_commit_evidence_metadata_changed' using errcode='55000';end if;
  select to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=target;
  if before_row is null or before_row-'prosrc' is distinct from expected_metadata
    or encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from original_sha
    or (length(original)-length(replace(original,old_return,'')))/length(old_return)<>2 then
    raise exception 'admission_commit_original_source_or_metadata_changed' using errcode='55000';end if;
  next_body:=replace(original,old_return,new_return);
  if (length(next_body)-length(replace(next_body,new_return,'')))/length(new_return)<>2 then
    raise exception 'admission_commit_exact_two_returns_required' using errcode='55000';end if;
  restored:=replace(next_body,new_return,old_return);
  if restored is distinct from original then raise exception 'admission_commit_inverse_mismatch' using errcode='55000';end if;
  helper_oid:=to_regprocedure('bx1_private.fund_roleplay_admission_commit(jsonb,text,uuid,jsonb)');
  bootstrap:=helper_oid is null;
  if (bootstrap and before_row->>'prosrc' is distinct from original)
    or (not bootstrap and before_row->>'prosrc' is distinct from next_body) then
    raise exception 'admission_commit_partial_or_unexpected_installation' using errcode='55000';end if;
  if bootstrap then
    execute 'create function bx1_private.fund_roleplay_admission_commit(p_context jsonb,p_action text,p_key uuid,p_payload jsonb)'
      ||' returns jsonb language plpgsql volatile security definer set search_path='''' as $formatter$'||helper_body||'$formatter$';
    helper_oid:=to_regprocedure('bx1_private.fund_roleplay_admission_commit(jsonb,text,uuid,jsonb)');
    for permission in select distinct a.grantee,role_row.rolname from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles role_row on role_row.oid=a.grantee
      where p.oid=helper_oid and a.grantee<>p.proowner loop
      execute format('revoke all on function bx1_private.fund_roleplay_admission_commit(jsonb,text,uuid,jsonb) from %s',
        case when permission.grantee=0 then 'public' else quote_ident(permission.rolname) end);
    end loop;
  end if;
  select to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=helper_oid;
  if after_row is null or after_row-'oid'-'prosrc' is distinct from helper_metadata
    or after_row->>'prosrc' is distinct from helper_body
    or exists(select 1 from pg_catalog.pg_proc p cross join lateral
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=helper_oid and a.grantee<>p.proowner) then
    raise exception 'admission_commit_private_formatter_changed' using errcode='55000';end if;
  if bootstrap then
    definition:=pg_catalog.pg_get_functiondef(target);
    execute replace(definition,original,next_body);
  end if;
  select to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from expected_metadata or after_row->>'prosrc' is distinct from next_body then
    raise exception 'admission_commit_target_preservation_failed' using errcode='55000';end if;
  for dependency in select value from jsonb_array_elements(dependencies) loop
    select to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=(dependency->>'oid')::oid;
    if after_row-'prosrc' is distinct from dependency->'metadata'
      or encode(sha256(convert_to(after_row->>'prosrc','UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'admission_commit_dependency_mutated' using errcode='55000';end if;
  end loop;
  select (select coalesce(jsonb_agg(to_jsonb(evidence_row) order by evidence_row.kind,evidence_row.value::text),'[]'::jsonb) from (
 select 'default' kind,jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid)) value
 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attname='created_at' and a.attrelid in('bx1_portal.events'::regclass,'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,'bx1_portal.investment_accounts'::regclass)
 union all select 'constraint',to_jsonb(c) from pg_catalog.pg_constraint c where c.conrelid in(
 'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,'bx1_portal.investment_accounts'::regclass,
 'bx1_private.fund_roleplay_admission_decisions'::regclass) and c.contype in('u','p')
 union all select 'trigger',to_jsonb(t) from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgrelid in(
 'bx1_portal.events'::regclass,'bx1_portal.requests'::regclass,'bx1_portal.scoped_requests'::regclass,
 'bx1_private.fund_roleplay_admission_bindings'::regclass,'bx1_private.fund_roleplay_admission_decisions'::regclass)
 ) evidence_row) into existing_evidence;
  if (jsonb_array_length(existing_evidence) is distinct from jsonb_array_length(expected_evidence) or existing_evidence @> expected_evidence is not true or expected_evidence @> existing_evidence is not true) then raise exception 'admission_commit_evidence_mutated' using errcode='55000';end if;
end $admission_commit_install$;
