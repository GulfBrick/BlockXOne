-- Query-only metadata and actual-expression proof for TEST admission/account commit ACKs.
-- These are typed ephemeral values, not seeded actors, claims, sessions or business records.
-- This does NOT prove a hosted approval/account/payment/issuance journey.
do $admission_commit_proof$
declare
  spec constant jsonb:=$proof_spec${"target":{"oid":"24447","sha":"7dc78c7f016229e2209a3235eda1db874b3ef573b53d17083c007bf7052d07d0","metadata":{"oid":"24447","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_scoped_p2","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},"dependencies":[{"oid":"16542","sha":"9ab5ea099e74ec09e83b1505c51a3647791195aed7c742dcc3f257dfc7d2f300","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"16714","sha":"fed2a8ac0349ffaba807c1b574698bfb1348825b8ef5163ad72d8408386f5e3e","metadata":{"oid":"16714","proacl":["=X/supabase_auth_admin","postgres=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"jwt","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"27039","sha":"8fee52076847a861a51b598571efcf40335ef6ebad2c284b979258ab6f8fc0c2","metadata":{"oid":"27039","proacl":["postgres=X/postgres","authenticated=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_scoped","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"27107","sha":"9176731bf644dcbcdaa399901e24846da26522cbdfd4aa76dc0ac39a921a0e82","metadata":{"oid":"27107","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"admission_application_reviewer","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_scope","target_org"],"proargtypes":["3802","2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":"({CONST :consttype 2950 :consttypmod -1 :constcollid 0 :constlen 16 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}},{"oid":"27113","sha":"b61b281fa60b9f21e60aca0fa07b833025f1838d1eb8255b8e7ee9e69e34fe75","metadata":{"oid":"27113","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"admission_individual_account_current","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_account"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"33388","sha":"a5cec2e5a02b1cbc57f13a0a77d526c363bb9a2467de83e12382161388819865","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"33389","sha":"e183693977b0df93fa12c838bcdea27bfd4e80e91a9a17c611ee31e0bebd5784","metadata":{"oid":"33389","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_roleplay_protected_session","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"36223","sha":"dbcfc49997ae3de015a31d782e2695caad66c01cf116e6edfa8b98cddf45381b","metadata":{"oid":"36223","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_appointed","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product","role_name"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38178","sha":"adea38cb2ede4853650398e949e5827c0ea139d46d7919514fc631fa0d108c8c","metadata":{"oid":"38178","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_binding_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_binding"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38184","sha":"37a84b679f1d5bc4d2fcffff13e87865fb021ed65d5704c5b874310754d0f6a1","metadata":{"oid":"38184","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_decision_bound","prorows":0,"pronargs":11,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_id","p_user","p_reviewer","p_revision","p_status","p_details","p_submitted","p_reviewed","p_notes","p_checks","p_approved"],"proargtypes":["2950","2950","2950","23","25","3802","1184","1184","25","3802","1184"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38188","sha":"0e8620daae6162083a54d73467168de62c083bb7f165401106662dc3d547f40b","metadata":{"oid":"38188","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_application"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38189","sha":"1a65a12232cde427996388b55a01fad411a3e5767b3fdbd8d299b813db250c68","metadata":{"oid":"38189","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_admission_product","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_application","p_product"],"proargtypes":["2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":"38190","sha":"c1e3b355ec7dd63cc6ac4538910dd04fd20d582828c311183622607794674fa1","metadata":{"oid":"38190","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_roleplay_admission_finish","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2278","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_context","p_action","p_key","p_payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}],"evidence":[{"kind":"constraint","value":{"oid":"24292","conbin":null,"conkey":[1,2],"confkey":null,"conname":"requests_pkey","contype":"p","conindid":"24291","conrelid":"24285","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24400","conbin":null,"conkey":[1],"confkey":null,"conname":"investment_accounts_pkey","contype":"p","conindid":"24399","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24402","conbin":null,"conkey":[3],"confkey":null,"conname":"investment_accounts_application_id_key","contype":"u","conindid":"24401","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24404","conbin":null,"conkey":[1,2],"confkey":null,"conname":"investment_accounts_id_holder_user_id_key","contype":"u","conindid":"24403","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"24427","conbin":null,"conkey":[1,2],"confkey":null,"conname":"scoped_requests_pkey","contype":"p","conindid":"24426","conrelid":"24420","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"25503","conbin":null,"conkey":[7],"confkey":null,"conname":"investment_accounts_entity_party_id_key","contype":"u","conindid":"25502","conrelid":"24388","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38132","conbin":null,"conkey":[1],"confkey":null,"conname":"fund_roleplay_admission_decisions_pkey","contype":"p","conindid":"38131","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38134","conbin":null,"conkey":[3,5],"confkey":null,"conname":"fund_roleplay_admission_decis_application_id_decision_revis_key","contype":"u","conindid":"38133","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"constraint","value":{"oid":"38136","conbin":null,"conkey":[6,9],"confkey":null,"conname":"fund_roleplay_admission_decisions_actor_id_request_key_key","contype":"u","conindid":"38135","conrelid":"38115","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"22414","connoinherit":true,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}},{"kind":"default","value":{"table":"bx1_portal.events","column":"created_at","expression":"now()"}},{"kind":"default","value":{"table":"bx1_portal.investment_accounts","column":"created_at","expression":"clock_timestamp()"}},{"kind":"default","value":{"table":"bx1_portal.requests","column":"created_at","expression":"now()"}},{"kind":"default","value":{"table":"bx1_portal.scoped_requests","column":"created_at","expression":"clock_timestamp()"}},{"kind":"trigger","value":{"oid":"24346","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_requests_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24285","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"24347","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_events_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24298","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"24436","tgargs":"\\x","tgattr":[],"tgfoid":"24345","tgname":"bx1_portal_scoped_request_guard","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"24420","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"38175","tgargs":"\\x","tgattr":[],"tgfoid":"38174","tgname":"fund_roleplay_admission_binding_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"38056","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}},{"kind":"trigger","value":{"oid":"38176","tgargs":"\\x","tgattr":[],"tgfoid":"38174","tgname":"fund_roleplay_admission_decision_immutable","tgqual":null,"tgtype":27,"tgnargs":0,"tgrelid":"38115","tgenabled":"O","tgnewtable":null,"tgoldtable":null,"tgparentid":"0","tgconstraint":"0","tgdeferrable":false,"tgisinternal":false,"tgconstrindid":"0","tgconstrrelid":"0","tginitdeferred":false}}],"helperMetadata":{"proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"fund_roleplay_admission_commit","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_context","p_action","p_key","p_payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}$proof_spec$::jsonb;
  original constant text:=$original$declare v_actor uuid:=auth.uid(); old_request bx1_portal.scoped_requests; app bx1_portal.applications;
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
end$original$;
  expected_helper constant text:=$expected_helper$
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
$expected_helper$;
  old_return constant text:='return bx1_portal.read_scoped(c);';
  new_return constant text:='return coalesce(bx1_private.fund_roleplay_admission_commit(c,action,key,body),bx1_portal.read_scoped(c));';
  metadata jsonb; row_value jsonb; dependency jsonb; actual_evidence jsonb;
  target_body text; helper_body text; helper_oid oid; predicate text; record_query constant text:=$record_query$ from pg_catalog.jsonb_to_record($1) as input(actor uuid,p_context jsonb,p_action text,p_key uuid,p_payload jsonb,event_count bigint,subject uuid,caller_session uuid)
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_portal.applications,$1->'saved_application') saved_application
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_private.fund_roleplay_admission_bindings,$1->'saved_binding') saved_binding
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_private.fund_roleplay_admission_decisions,$1->'saved_decision') saved_decision
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_portal.requests,$1->'base_request') base_request
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_portal.scoped_requests,$1->'scoped_request') scoped_request
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_portal.investment_accounts,$1->'saved_account') saved_account
 cross join lateral pg_catalog.jsonb_populate_record(null::bx1_portal.events,$1->'saved_event') saved_event$record_query$;
  current_query constant text:=$current_query$ from pg_catalog.jsonb_to_record($1) as input(
    environment_current boolean,protected_current boolean,binding_current boolean,decision_current boolean,
    reviewer_current boolean,appointment_current boolean,account_current boolean,product_current boolean,
    observed_session uuid,caller_session uuid,p_action text)$current_query$;
  fixtures constant jsonb:=$fixture_baselines${"review":{"actor":"11111111-1111-4111-8111-000000000001","p_key":"11111111-1111-4111-8111-000000000002","p_action":"review_application","p_context":{"mode":"ROLE","organisationId":"11111111-1111-4111-8111-000000000012","role":"ComplianceOfficer"},"p_payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}},"subject":"11111111-1111-4111-8111-000000000003","event_count":1,"saved_application":{"id":"11111111-1111-4111-8111-000000000003","user_id":"11111111-1111-4111-8111-000000000001","revision":3,"reviewer_id":"11111111-1111-4111-8111-000000000001","status":"APPROVED"},"saved_binding":{"id":"11111111-1111-4111-8111-000000000004","application_id":"11111111-1111-4111-8111-000000000003","applicant_id":"11111111-1111-4111-8111-000000000001","submitted_revision":2,"independence_proven":false,"policy_id":"11111111-1111-4111-8111-000000000005","authority_epoch":2,"product_id":"11111111-1111-4111-8111-000000000006","offering_revision_id":"11111111-1111-4111-8111-000000000007","native_organisation_id":"11111111-1111-4111-8111-000000000012"},"saved_decision":{"id":"11111111-1111-4111-8111-000000000009","binding_id":"11111111-1111-4111-8111-000000000004","application_id":"11111111-1111-4111-8111-000000000003","actor_id":"11111111-1111-4111-8111-000000000001","submitted_revision":2,"decision_revision":3,"independence_proven":false,"session_id":"11111111-1111-4111-8111-000000000008","operating_context":{"mode":"ROLE","organisationId":"11111111-1111-4111-8111-000000000012","role":"ComplianceOfficer"},"request_key":"11111111-1111-4111-8111-000000000002","command_payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}},"decision":"APPROVED","reviewed_at":"2026-01-01T00:00:01Z"},"base_request":{"actor_id":"11111111-1111-4111-8111-000000000001","request_key":"11111111-1111-4111-8111-000000000002","command":"review_application","payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}},"created_at":"2026-01-01T00:00:00Z"},"scoped_request":{"actor_id":"11111111-1111-4111-8111-000000000001","request_key":"11111111-1111-4111-8111-000000000002","command":"review_application","payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}},"operating_context":{"mode":"ROLE","organisationId":"11111111-1111-4111-8111-000000000012","role":"ComplianceOfficer"},"created_at":"2026-01-01T00:00:02Z"},"saved_account":{"id":"11111111-1111-4111-8111-000000000010","application_id":"11111111-1111-4111-8111-000000000003","holder_user_id":"11111111-1111-4111-8111-000000000001","kind":"INDIVIDUAL","status":"ACTIVE","entity_party_id":null,"created_at":"2026-01-01T00:10:01Z"},"saved_event":{"id":"11111111-1111-4111-8111-000000000011","subject_id":"11111111-1111-4111-8111-000000000003","application_id":"11111111-1111-4111-8111-000000000003","actor_id":"11111111-1111-4111-8111-000000000001","kind":"review_application","created_at":"2026-01-01T00:00:00Z"},"caller_session":"11111111-1111-4111-8111-000000000008"},"account":{"actor":"11111111-1111-4111-8111-000000000001","p_key":"11111111-1111-4111-8111-000000000002","p_action":"create_investment_account","p_context":{"mode":"APPLICANT"},"p_payload":{"application_id":"11111111-1111-4111-8111-000000000003"},"subject":"11111111-1111-4111-8111-000000000010","event_count":1,"saved_application":{"id":"11111111-1111-4111-8111-000000000003","user_id":"11111111-1111-4111-8111-000000000001","revision":3,"reviewer_id":"11111111-1111-4111-8111-000000000001","status":"APPROVED"},"saved_binding":{"id":"11111111-1111-4111-8111-000000000004","application_id":"11111111-1111-4111-8111-000000000003","applicant_id":"11111111-1111-4111-8111-000000000001","submitted_revision":2,"independence_proven":false,"policy_id":"11111111-1111-4111-8111-000000000005","authority_epoch":2,"product_id":"11111111-1111-4111-8111-000000000006","offering_revision_id":"11111111-1111-4111-8111-000000000007","native_organisation_id":"11111111-1111-4111-8111-000000000012"},"saved_decision":{"id":"11111111-1111-4111-8111-000000000009","binding_id":"11111111-1111-4111-8111-000000000004","application_id":"11111111-1111-4111-8111-000000000003","actor_id":"11111111-1111-4111-8111-000000000001","submitted_revision":2,"decision_revision":3,"independence_proven":false,"session_id":"11111111-1111-4111-8111-000000000008","operating_context":{"mode":"ROLE","organisationId":"11111111-1111-4111-8111-000000000012","role":"ComplianceOfficer"},"request_key":"11111111-1111-4111-8111-000000000002","command_payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}},"decision":"APPROVED","reviewed_at":"2026-01-01T00:00:01Z"},"base_request":{"actor_id":"11111111-1111-4111-8111-000000000001","request_key":"11111111-1111-4111-8111-000000000002","command":"create_investment_account","payload":{"application_id":"11111111-1111-4111-8111-000000000003"},"created_at":"2026-01-01T00:10:00Z"},"scoped_request":{"actor_id":"11111111-1111-4111-8111-000000000001","request_key":"11111111-1111-4111-8111-000000000002","command":"create_investment_account","payload":{"application_id":"11111111-1111-4111-8111-000000000003"},"operating_context":{"mode":"APPLICANT"},"created_at":"2026-01-01T00:10:02Z"},"saved_account":{"id":"11111111-1111-4111-8111-000000000010","application_id":"11111111-1111-4111-8111-000000000003","holder_user_id":"11111111-1111-4111-8111-000000000001","kind":"INDIVIDUAL","status":"ACTIVE","entity_party_id":null,"created_at":"2026-01-01T00:10:01Z"},"saved_event":{"id":"11111111-1111-4111-8111-000000000011","subject_id":"11111111-1111-4111-8111-000000000010","application_id":"11111111-1111-4111-8111-000000000003","actor_id":"11111111-1111-4111-8111-000000000001","kind":"create_investment_account","created_at":"2026-01-01T00:10:00Z"},"caller_session":"11111111-1111-4111-8111-000000000008"}}$fixture_baselines$::jsonb;
  cases constant jsonb:=$predicate_cases$[{"group":"common","label":"review exact original receipt","seed":"review","patches":[],"denied":false},{"group":"common","label":"account exact original receipt","seed":"account","patches":[],"denied":false},{"group":"common","label":"missing binding","seed":"review","patches":[{"path":["saved_binding","id"],"value":null}],"denied":true},{"group":"common","label":"foreign application","seed":"review","patches":[{"path":["saved_binding","application_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"foreign applicant","seed":"review","patches":[{"path":["saved_binding","applicant_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"foreign decisionactor","seed":"review","patches":[{"path":["saved_decision","actor_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"changed submittedrevision","seed":"review","patches":[{"path":["saved_decision","submitted_revision"],"value":3}],"denied":true},{"group":"common","label":"changed decisionrevision","seed":"review","patches":[{"path":["saved_decision","decision_revision"],"value":4}],"denied":true},{"group":"common","label":"changed currentrevision","seed":"review","patches":[{"path":["saved_application","revision"],"value":4}],"denied":true},{"group":"common","label":"foreign reviewer","seed":"review","patches":[{"path":["saved_application","reviewer_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"changed decisionstatus","seed":"review","patches":[{"path":["saved_application","status"],"value":"REJECTED"}],"denied":true},{"group":"common","label":"false independentlabel","seed":"review","patches":[{"path":["saved_binding","independence_proven"],"value":true}],"denied":true},{"group":"common","label":"null independentlabel","seed":"review","patches":[{"path":["saved_decision","independence_proven"],"value":null}],"denied":true},{"group":"common","label":"foreign basereceipt","seed":"review","patches":[{"path":["base_request","actor_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"foreign scopedkey","seed":"review","patches":[{"path":["scoped_request","request_key"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"common","label":"wrong basecommand","seed":"review","patches":[{"path":["base_request","command"],"value":"create_product"}],"denied":true},{"group":"common","label":"changed basepayload","seed":"review","patches":[{"path":["base_request","payload","application_id"],"value":null},{"path":["base_request","payload","expected_revision"],"value":null},{"path":["base_request","payload","decision"],"value":null},{"path":["base_request","payload","notes"],"value":null},{"path":["base_request","payload","checks"],"value":null}],"denied":true},{"group":"common","label":"changed scopedpayload","seed":"review","patches":[{"path":["scoped_request","payload","application_id"],"value":null},{"path":["scoped_request","payload","expected_revision"],"value":null},{"path":["scoped_request","payload","decision"],"value":null},{"path":["scoped_request","payload","notes"],"value":null},{"path":["scoped_request","payload","checks"],"value":null}],"denied":true},{"group":"common","label":"foreign context","seed":"review","patches":[{"path":["scoped_request","operating_context","mode"],"value":"APPLICANT"},{"path":["scoped_request","operating_context","organisationId"],"value":null},{"path":["scoped_request","operating_context","role"],"value":null}],"denied":true},{"group":"common","label":"missing basetime","seed":"review","patches":[{"path":["base_request","created_at"],"value":null}],"denied":true},{"group":"common","label":"infinite scopedtime","seed":"review","patches":[{"path":["scoped_request","created_at"],"value":"infinity"}],"denied":true},{"group":"common","label":"reversed receipt times","seed":"review","patches":[{"path":["base_request","created_at"],"value":"2026-01-01T00:00:03Z"}],"denied":true},{"group":"common","label":"missing reviewtime","seed":"review","patches":[{"path":["saved_decision","reviewed_at"],"value":null}],"denied":true},{"group":"common","label":"zero originalsession","seed":"review","patches":[{"path":["saved_decision","session_id"],"value":"00000000-0000-0000-0000-000000000000"}],"denied":true},{"group":"common","label":"missing policy","seed":"review","patches":[{"path":["saved_binding","policy_id"],"value":null}],"denied":true},{"group":"common","label":"zero epoch","seed":"review","patches":[{"path":["saved_binding","authority_epoch"],"value":0}],"denied":true},{"group":"common","label":"missing offering","seed":"review","patches":[{"path":["saved_binding","offering_revision_id"],"value":null}],"denied":true},{"group":"review","label":"exact review binding","seed":"review","patches":[],"denied":false},{"group":"review","label":"wrong reviewercontext","seed":"review","patches":[{"path":["p_context","role"],"value":"Investor"}],"denied":true},{"group":"review","label":"changed decisioncontext","seed":"review","patches":[{"path":["saved_decision","operating_context","mode"],"value":"APPLICANT"},{"path":["saved_decision","operating_context","organisationId"],"value":null},{"path":["saved_decision","operating_context","role"],"value":null}],"denied":true},{"group":"review","label":"different original key","seed":"review","patches":[{"path":["saved_decision","request_key"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"review","label":"changed decisionpayload","seed":"review","patches":[{"path":["saved_decision","command_payload","application_id"],"value":null},{"path":["saved_decision","command_payload","expected_revision"],"value":null},{"path":["saved_decision","command_payload","decision"],"value":null},{"path":["saved_decision","command_payload","notes"],"value":null},{"path":["saved_decision","command_payload","checks"],"value":null}],"denied":true},{"group":"review","label":"wrong submittedrevision","seed":"review","patches":[{"path":["p_payload","expected_revision"],"value":3}],"denied":true},{"group":"review","label":"wrong decision","seed":"review","patches":[{"path":["p_payload","decision"],"value":"REJECTED"}],"denied":true},{"group":"review","label":"review before original command","seed":"review","patches":[{"path":["saved_decision","reviewed_at"],"value":"2025-12-31T23:59:59Z"}],"denied":true},{"group":"review","label":"review after scopedreceipt","seed":"review","patches":[{"path":["saved_decision","reviewed_at"],"value":"2026-01-01T00:00:03Z"}],"denied":true},{"group":"account","label":"exact applicant account","seed":"account","patches":[],"denied":false},{"group":"account","label":"exact native Investor account","seed":"account","patches":[{"path":["p_context","mode"],"value":"ROLE"},{"path":["p_context","organisationId"],"value":"11111111-1111-4111-8111-000000000012"},{"path":["p_context","role"],"value":"Investor"}],"denied":false},{"group":"account","label":"foreign role context","seed":"account","patches":[{"path":["p_context","mode"],"value":"ROLE"},{"path":["p_context","organisationId"],"value":"11111111-1111-4111-8111-000000000011"},{"path":["p_context","role"],"value":"Investor"}],"denied":true},{"group":"account","label":"nonapproved admission","seed":"account","patches":[{"path":["saved_decision","decision"],"value":"REJECTED"}],"denied":true},{"group":"account","label":"missing account","seed":"account","patches":[{"path":["saved_account","id"],"value":null}],"denied":true},{"group":"account","label":"foreign accountapp","seed":"account","patches":[{"path":["saved_account","application_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"account","label":"foreign holder","seed":"account","patches":[{"path":["saved_account","holder_user_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"account","label":"entity account","seed":"account","patches":[{"path":["saved_account","kind"],"value":"ENTITY"}],"denied":true},{"group":"account","label":"inactive account","seed":"account","patches":[{"path":["saved_account","status"],"value":"CLOSED"}],"denied":true},{"group":"account","label":"entity party","seed":"account","patches":[{"path":["saved_account","entity_party_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"account","label":"missing creationtime","seed":"account","patches":[{"path":["saved_account","created_at"],"value":null}],"denied":true},{"group":"account","label":"infinite creationtime","seed":"account","patches":[{"path":["saved_account","created_at"],"value":"infinity"}],"denied":true},{"group":"account","label":"creation before command","seed":"account","patches":[{"path":["saved_account","created_at"],"value":"2026-01-01T00:09:59Z"}],"denied":true},{"group":"account","label":"creation after receipt","seed":"account","patches":[{"path":["saved_account","created_at"],"value":"2026-01-01T00:10:03Z"}],"denied":true},{"group":"account","label":"creation before admission","seed":"account","patches":[{"path":["saved_account","created_at"],"value":"2026-01-01T00:00:00Z"}],"denied":true},{"group":"event","label":"exact review event","seed":"review","patches":[],"denied":false},{"group":"event","label":"exact account event","seed":"account","patches":[],"denied":false},{"group":"event","label":"no event","seed":"review","patches":[{"path":["event_count"],"value":0}],"denied":true},{"group":"event","label":"duplicate events","seed":"review","patches":[{"path":["event_count"],"value":2}],"denied":true},{"group":"event","label":"null count","seed":"review","patches":[{"path":["event_count"],"value":null}],"denied":true},{"group":"event","label":"missing eventid","seed":"review","patches":[{"path":["saved_event","id"],"value":null}],"denied":true},{"group":"event","label":"foreign subject","seed":"review","patches":[{"path":["saved_event","subject_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"event","label":"foreign eventapp","seed":"review","patches":[{"path":["saved_event","application_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"event","label":"foreign eventactor","seed":"review","patches":[{"path":["saved_event","actor_id"],"value":"11111111-1111-4111-8111-000000000012"}],"denied":true},{"group":"event","label":"wrong eventkind","seed":"review","patches":[{"path":["saved_event","kind"],"value":"subscribe"}],"denied":true},{"group":"event","label":"wrong originaltime","seed":"review","patches":[{"path":["saved_event","created_at"],"value":"2026-01-01T00:00:01Z"}],"denied":true}]$predicate_cases$::jsonb;
  current_base constant jsonb:=$current_base${"environment_current":true,"protected_current":true,"binding_current":true,"decision_current":true,"reviewer_current":true,"appointment_current":true,"account_current":true,"product_current":true,"observed_session":"11111111-1111-4111-8111-000000000008","caller_session":"11111111-1111-4111-8111-000000000008","p_action":"review_application"}$current_base$::jsonb;
  current_cases constant jsonb:=$current_cases$[{"group":"authority","label":"review_application current","patches":[],"denied":false},{"group":"authority","label":"review_application environment_current false","patches":[{"path":["environment_current"],"value":false}],"denied":true},{"group":"authority","label":"review_application environment_current null","patches":[{"path":["environment_current"],"value":null}],"denied":true},{"group":"authority","label":"review_application protected_current false","patches":[{"path":["protected_current"],"value":false}],"denied":true},{"group":"authority","label":"review_application protected_current null","patches":[{"path":["protected_current"],"value":null}],"denied":true},{"group":"authority","label":"review_application binding_current false","patches":[{"path":["binding_current"],"value":false}],"denied":true},{"group":"authority","label":"review_application binding_current null","patches":[{"path":["binding_current"],"value":null}],"denied":true},{"group":"authority","label":"review_application decision_current false","patches":[{"path":["decision_current"],"value":false}],"denied":true},{"group":"authority","label":"review_application decision_current null","patches":[{"path":["decision_current"],"value":null}],"denied":true},{"group":"authority","label":"create_investment_account current","patches":[{"path":["p_action"],"value":"create_investment_account"}],"denied":false},{"group":"authority","label":"create_investment_account environment_current false","patches":[{"path":["environment_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account environment_current null","patches":[{"path":["environment_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account protected_current false","patches":[{"path":["protected_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account protected_current null","patches":[{"path":["protected_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account binding_current false","patches":[{"path":["binding_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account binding_current null","patches":[{"path":["binding_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account decision_current false","patches":[{"path":["decision_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"authority","label":"create_investment_account decision_current null","patches":[{"path":["decision_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"review_application current","patches":[],"denied":false},{"group":"final","label":"review_application protected_current false","patches":[{"path":["protected_current"],"value":false}],"denied":true},{"group":"final","label":"review_application protected_current null","patches":[{"path":["protected_current"],"value":null}],"denied":true},{"group":"final","label":"review_application binding_current false","patches":[{"path":["binding_current"],"value":false}],"denied":true},{"group":"final","label":"review_application binding_current null","patches":[{"path":["binding_current"],"value":null}],"denied":true},{"group":"final","label":"review_application reviewer_current false","patches":[{"path":["reviewer_current"],"value":false}],"denied":true},{"group":"final","label":"review_application reviewer_current null","patches":[{"path":["reviewer_current"],"value":null}],"denied":true},{"group":"final","label":"review_application appointment_current false","patches":[{"path":["appointment_current"],"value":false}],"denied":true},{"group":"final","label":"review_application appointment_current null","patches":[{"path":["appointment_current"],"value":null}],"denied":true},{"group":"final","label":"review_application session drift","patches":[{"path":["observed_session"],"value":"11111111-1111-4111-8111-000000000009"}],"denied":true},{"group":"final","label":"create_investment_account current","patches":[{"path":["p_action"],"value":"create_investment_account"}],"denied":false},{"group":"final","label":"create_investment_account protected_current false","patches":[{"path":["protected_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account protected_current null","patches":[{"path":["protected_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account binding_current false","patches":[{"path":["binding_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account binding_current null","patches":[{"path":["binding_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account account_current false","patches":[{"path":["account_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account account_current null","patches":[{"path":["account_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account product_current false","patches":[{"path":["product_current"],"value":false},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account product_current null","patches":[{"path":["product_current"],"value":null},{"path":["p_action"],"value":"create_investment_account"}],"denied":true},{"group":"final","label":"create_investment_account session drift","patches":[{"path":["observed_session"],"value":"11111111-1111-4111-8111-000000000009"},{"path":["p_action"],"value":"create_investment_account"}],"denied":true}]$current_cases$::jsonb;
  substitutions constant jsonb:=$substitutions$[["bx1_private.test_roleplay_environment()","input.environment_current"],["bx1_private.test_roleplay_protected_session()","input.protected_current"],["bx1_private.fund_roleplay_admission_binding_current(saved_binding.id)","input.binding_current"],["bx1_private.fund_roleplay_admission_decision_bound(saved_application.id,saved_application.user_id,\n      saved_application.reviewer_id,saved_application.revision,saved_application.status,saved_application.details,\n      saved_application.submitted_at,saved_application.reviewed_at,saved_application.review_notes,\n      saved_application.review_checks,saved_application.approved_until)","input.decision_current"],["bx1_portal.admission_application_reviewer(p_context,saved_application.reviewer_scope,saved_application.organisation_id)","input.reviewer_current"],["bx1_private.fund_roleplay_appointed(p_context,saved_binding.product_id,'ComplianceOfficer')","input.appointment_current"],["bx1_portal.admission_individual_account_current(p_context,saved_account.id)","input.account_current"],["bx1_private.fund_roleplay_admission_product(saved_application.id,saved_binding.product_id)","input.product_current"],["(auth.jwt()->>'session_id')::uuid","input.observed_session"],["caller_session","input.caller_session"]]$substitutions$::jsonb;
  item jsonb; patch jsonb; replacement jsonb; denied boolean; marker text;
  claims_before text:=current_setting('request.jwt.claims',true);
  sub_before text:=current_setting('request.jwt.claim.sub',true);
  event_predicate text; event_rows jsonb; event_count bigint; wire_expression text; wire_value jsonb; wire_case jsonb;
begin
  if current_user<>'postgres' or auth.uid() is not null or bx1_private.test_roleplay_environment() is not true then
    raise exception 'admission_commit_proof_owner_without_claims_required' using errcode='42501';end if;
  select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=24447;
  target_body:=metadata->>'prosrc';
  if metadata-'prosrc' is distinct from spec->'target'->'metadata'
    or (length(target_body)-length(replace(target_body,new_return,'')))/length(new_return)<>2
    or replace(target_body,new_return,old_return) is distinct from original
    or encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from spec->'target'->>'sha' then
    raise exception 'admission_commit_proof_exact_inverse_or_metadata_failed';end if;
  if strpos(target_body,'old_request.payload is distinct from body')>=strpos(target_body,new_return)
    or strpos(target_body,'perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);')=0
    or strpos(reverse(target_body),reverse(new_return))>=strpos(reverse(target_body),reverse('perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);')) then
    raise exception 'admission_commit_proof_finish_or_replay_order_changed';end if;
  for dependency in select value from jsonb_array_elements(spec->'dependencies') loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(dependency->>'oid')::oid;
    if metadata is null or metadata-'prosrc' is distinct from dependency->'metadata'
      or encode(sha256(convert_to(metadata->>'prosrc','UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'admission_commit_proof_dependency_changed: %',dependency->>'oid';end if;
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
 ) evidence_row) into actual_evidence;
  if jsonb_array_length(actual_evidence) is distinct from jsonb_array_length(spec->'evidence')
    or actual_evidence @> (spec->'evidence') is not true or (spec->'evidence') @> actual_evidence is not true then
    raise exception 'admission_commit_proof_evidence_changed';end if;
  helper_oid:=to_regprocedure('bx1_private.fund_roleplay_admission_commit(jsonb,text,uuid,jsonb)');
  select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=helper_oid;
  helper_body:=metadata->>'prosrc';
  if helper_oid is null or metadata-'oid'-'prosrc' is distinct from spec->'helperMetadata'
    or helper_body is distinct from expected_helper
    or exists(select 1 from pg_catalog.pg_proc p cross join lateral
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) edge
      where p.oid=helper_oid and edge.grantee<>p.proowner) then
    raise exception 'admission_commit_proof_formatter_or_closed_acl_changed';end if;
  if bx1_private.fund_roleplay_admission_commit(null,'review_application',
      '11111111-1111-4111-8111-111111111111'::uuid,'{"application_id":"11111111-1111-4111-8111-111111111112"}'::jsonb) is not null
    or bx1_private.fund_roleplay_admission_commit(null,'create_investment_account',
      '11111111-1111-4111-8111-111111111111'::uuid,'{"application_id":"11111111-1111-4111-8111-111111111112"}'::jsonb) is not null then
    raise exception 'admission_commit_proof_null_actor_must_not_ack';end if;
  for item in select value from jsonb_array_elements(cases) loop
    row_value:=fixtures->(item->>'seed');
    for patch in select value from jsonb_array_elements(item->'patches') loop
      row_value:=jsonb_set(row_value,array(select jsonb_array_elements_text(patch->'path')),patch->'value',true);
    end loop;
    marker:=item->>'group';
    predicate:=split_part(split_part(helper_body,'/* admission_commit_'||marker||'_begin */',2),
      '/* admission_commit_'||marker||'_end */',1);
    if predicate='' then raise exception 'admission_commit_proof_predicate_not_found: %',marker;end if;
    execute 'select ('||predicate||')'||record_query into denied using row_value;
    if denied is distinct from (item->>'denied')::boolean then
      raise exception 'admission_commit_proof_predicate_case_failed: % / %',marker,item->>'label';end if;
  end loop;
  for item in select value from jsonb_array_elements(current_cases) loop
    row_value:=current_base;
    for patch in select value from jsonb_array_elements(item->'patches') loop
      row_value:=jsonb_set(row_value,array(select jsonb_array_elements_text(patch->'path')),patch->'value',true);
    end loop;
    marker:=item->>'group';
    predicate:=split_part(split_part(helper_body,'/* admission_commit_'||marker||'_begin */',2),
      '/* admission_commit_'||marker||'_end */',1);
    if predicate='' then raise exception 'admission_commit_proof_current_predicate_not_found: %',marker;end if;
    for replacement in select value from jsonb_array_elements(substitutions) loop
      predicate:=replace(predicate,replacement->>0,replacement->>1);
    end loop;
    if predicate like '%bx1_private.%' or predicate like '%bx1_portal.%' or predicate like '%auth.jwt%' then
      raise exception 'admission_commit_proof_unreplaced_authority_call';end if;
    execute 'select ('||predicate||')'||current_query into denied using row_value;
    if denied is distinct from (item->>'denied')::boolean then
      raise exception 'admission_commit_proof_current_case_failed: % / %',marker,item->>'label';end if;
  end loop;
  -- Execute the actual immutable-event selector against typed query values.
  -- No latest-row guess; zero/duplicate/foreign-event sets cannot satisfy count1.
  event_predicate:=split_part(split_part(helper_body,
    'select count(*) into event_count from bx1_portal.events event_row',2),';',1);
  if event_predicate='' then raise exception 'admission_commit_proof_event_selector_missing';end if;
  for item in select value from jsonb_array_elements($event_cases$[{"name":"review-original","seed":"review","patches":[{}],"count":1},{"name":"account-original","seed":"account","patches":[{}],"count":1},{"name":"missing","seed":"review","patches":[],"count":0},{"name":"duplicate","seed":"review","patches":[{},{}],"count":2},{"name":"foreign-subject","seed":"review","patches":[{"subject_id":"11111111-1111-4111-8111-000000000012"}],"count":0},{"name":"foreign-app","seed":"review","patches":[{"application_id":"11111111-1111-4111-8111-000000000012"}],"count":0},{"name":"foreign-actor","seed":"review","patches":[{"actor_id":"11111111-1111-4111-8111-000000000012"}],"count":0},{"name":"wrong-kind","seed":"review","patches":[{"kind":"subscribe"}],"count":0},{"name":"different-time","seed":"review","patches":[{"created_at":"2026-01-01T00:00:01Z"}],"count":0}]$event_cases$::jsonb) loop
    row_value:=fixtures->(item->>'seed');
    select coalesce(jsonb_agg((row_value->'saved_event')||value),'[]'::jsonb) into event_rows
      from jsonb_array_elements(item->'patches');
    execute 'select count(*)'||record_query
      ||' cross join lateral pg_catalog.jsonb_populate_recordset(null::bx1_portal.events,$2) event_row'
      ||event_predicate into event_count using row_value,event_rows;
    if event_count is distinct from (item->>'count')::bigint then
      raise exception 'admission_commit_proof_event_count_failed: %',item->>'name';end if;
  end loop;
  -- Format the actual return expression against the same ephemeral records.
  wire_expression:=split_part(split_part(helper_body,'return pg_catalog.jsonb_build_object(',2),';',1);
  if wire_expression='' then raise exception 'admission_commit_proof_wire_expression_missing';end if;
  wire_expression:='pg_catalog.jsonb_build_object('||wire_expression;
  for wire_case in select value from jsonb_array_elements($wire_cases$[{"seed":"review","expected":{"kind":"TEST_FUND_ADMISSION_COMMIT","version":1,"environment":"TESTNET","execution_mode":"TEST_ROLE_PLAY","independence_proven":false,"actor_id":"11111111-1111-4111-8111-000000000001","session_id":"11111111-1111-4111-8111-000000000008","operating_context":{"mode":"ROLE","organisationId":"11111111-1111-4111-8111-000000000012","role":"ComplianceOfficer"},"policy_id":"11111111-1111-4111-8111-000000000005","authority_epoch":2,"product_id":"11111111-1111-4111-8111-000000000006","offering_revision_id":"11111111-1111-4111-8111-000000000007","application_id":"11111111-1111-4111-8111-000000000003","event_id":"11111111-1111-4111-8111-000000000011","request":{"command":"review_application","key":"11111111-1111-4111-8111-000000000002","payload":{"application_id":"11111111-1111-4111-8111-000000000003","expected_revision":2,"decision":"APPROVED","notes":"Pure predicate fixture","checks":{"identity":true,"ownership":true,"screening":true,"suitability":true}}},"decision_id":"11111111-1111-4111-8111-000000000009","submitted_revision":2,"decision_revision":3,"decision":"APPROVED"},"recorded_at":"2026-01-01T00:00:01Z"},{"seed":"account","expected":{"kind":"TEST_FUND_ACCOUNT_COMMIT","version":1,"environment":"TESTNET","execution_mode":"TEST_ROLE_PLAY","independence_proven":false,"actor_id":"11111111-1111-4111-8111-000000000001","session_id":"11111111-1111-4111-8111-000000000008","operating_context":{"mode":"APPLICANT"},"policy_id":"11111111-1111-4111-8111-000000000005","authority_epoch":2,"product_id":"11111111-1111-4111-8111-000000000006","offering_revision_id":"11111111-1111-4111-8111-000000000007","application_id":"11111111-1111-4111-8111-000000000003","event_id":"11111111-1111-4111-8111-000000000011","request":{"command":"create_investment_account","key":"11111111-1111-4111-8111-000000000002","payload":{"application_id":"11111111-1111-4111-8111-000000000003"}},"account_id":"11111111-1111-4111-8111-000000000010","application_revision":3,"admission_decision_id":"11111111-1111-4111-8111-000000000009"},"recorded_at":"2026-01-01T00:10:00Z"}]$wire_cases$::jsonb) loop
    row_value:=fixtures->(wire_case->>'seed');
    execute 'select '||wire_expression||record_query into wire_value using row_value;
    if wire_value-'recorded_at' is distinct from wire_case->'expected'
      or (wire_value->>'recorded_at')::timestamptz is distinct from (wire_case->>'recorded_at')::timestamptz then
      raise exception 'admission_commit_proof_wire_case_failed: %',wire_case->>'seed';end if;
  end loop;
  if current_setting('request.jwt.claims',true) is distinct from claims_before
    or current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'admission_commit_proof_claims_changed';end if;
end $admission_commit_proof$;
