-- BASE-REVIEW revision 2. TEST-only, explicit historical same-operator review
-- provenance. No policy/user/provider/decision rows are created or backfilled.
do $fund_base_review$
declare target oid; original text; next_body text; restored text; definition text;
  before_row jsonb; after_row jsonb; dependency jsonb; dependencies_before jsonb;
  helper oid; permission record; bootstrap boolean; marker_count integer; had_audit boolean;
  old_columns jsonb; old_constraints jsonb; old_triggers jsonb; old_indexes jsonb;
  rows_before text; tags_before jsonb; check_row jsonb;
  specs constant jsonb:=$dependencies$[
    {"oid":16542,"signature":"auth.uid()","sha":"09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":16714,"signature":"auth.jwt()","sha":"f2899304329d35e79c3f0bd0bfe249faf4cb20c8540d4ef391848b40fb0890ca","metadata":{"oid":"16714","proacl":["=X/supabase_auth_admin","postgres=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"jwt","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":24330,"signature":"bx1_portal.organisation_active(uuid)","sha":"bada9231ecd70a35e70b5d498bd5f398215ac18696a301948fec3539e5e1e32c","metadata":{"oid":"24330","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"organisation_active","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_org"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":25738,"signature":"bx1_portal.guard_offering_publication()","sha":"16998557a368f6f8847082838f58f8256e7ccfeea36b9f20c338d38df7b3feb2","metadata":{"oid":"25738","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_offering_publication","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26202,"signature":"bx1_portal.guard_customer_monitoring_new_action()","sha":"16af9ebcebc028003b54d6bb923c5157aabba66bb01941904eda0074b480cd6b","metadata":{"oid":"26202","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_customer_monitoring_new_action","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26346,"signature":"bx1_portal.guard_fund_v2_product()","sha":"d87a1bc6adafbc516170e85b24d6dbceb3833cef7a08a05de039236d814906d9","metadata":{"oid":"26346","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_fund_v2_product","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26360,"signature":"bx1_portal.guard_real_estate_v2_product()","sha":"f0d0bb35e840a6187733415e8b9c3cd35a88360deff7f3441368f5962b5dca30","metadata":{"oid":"26360","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_real_estate_v2_product","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26606,"signature":"bx1_portal.guard_offering_decision_appointment()","sha":"a247093525a237ab9220e9244fd6b1b4fd092d105208d9df57d27dfbe6b86898","metadata":{"oid":"26606","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_offering_decision_appointment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26609,"signature":"bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)","sha":"9e2274b7baa730a529c288ce306855c261a5b5e65742fa0567be6f14ff734ebe","metadata":{"oid":"26609","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_appointed_compliance_decision","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","key","body"],"proargtypes":["3802","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26676,"signature":"bx1_portal.guard_offering_amendment_first_save()","sha":"17c4b9e91f4dae8930d96f9407b969968a339d04aa963372656c384e609a93f7","metadata":{"oid":"26676","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_offering_amendment_first_save","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29612,"signature":"bx1_portal.offering_workflow_base_reviewer(jsonb,uuid,uuid)","sha":"1a53aa030d87e78d5da7e3af8827cc80ae8ba6397aadba3354947b67dfadd915","metadata":{"oid":"29612","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_base_reviewer","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product","target_scope"],"proargtypes":["3802","2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29613,"signature":"bx1_portal.offering_workflow_base_independent(jsonb,uuid)","sha":"8e9ed18d2df143442fc3773b9f3bc37f65b878677750b623217caa15481d63d0","metadata":{"oid":"29613","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_base_independent","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_actor"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29686,"signature":"bx1_portal.guard_product_common_envelope_declaration()","sha":"e494221e22a9aba30c8abf9c9d219d4a782237e99c6984cf8323787243570ad1","metadata":{"oid":"29686","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_product_common_envelope_declaration","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30768,"signature":"bx1_portal.test_offering_is_source(uuid)","sha":"adde28645a0ece5113d74350578e9301c24e5c5a2a92acb583e8ad2515333fad","metadata":{"oid":"30768","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_is_source","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_org"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30783,"signature":"bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)","sha":"4230af88f5b77ef0e615ec85fd98310b7a7b3d93881212cf34c0870156e62a28","metadata":{"oid":"30783","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_offering_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30784,"signature":"bx1_portal.test_offering_lane_current(jsonb,uuid,uuid,text)","sha":"f04cab165144ca3fc1471b0e448c92806f34e8a040eb97e87f724b1f8bc5f0d7","metadata":{"oid":"30784","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_lane_current","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product","key","action"],"proargtypes":["3802","2950","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33388,"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33389,"signature":"bx1_private.test_roleplay_protected_session()","sha":"0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14","metadata":{"oid":"33389","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_roleplay_protected_session","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":36060,"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8","metadata":{"oid":"36060","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_record_current","prorows":0,"pronargs":7,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["policy","epoch","product","offering","actor","c","action"],"proargtypes":["2950","23","2950","2950","2950","3802","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":36065,"signature":"bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)","sha":"e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177","metadata":{"oid":"36065","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_lane_current","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product","action"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":"({CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}}
  ]$dependencies$::jsonb;
  target_metadata constant jsonb:=$target_metadata${"oid":"29619","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_base_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","command","request_key","payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
  original_columns constant jsonb:=$original_columns$[{"name":"id","type":"2950","not_null":true,"num":1},{"name":"organisation_id","type":"2950","not_null":true,"num":2},{"name":"created_by","type":"2950","not_null":true,"num":3},{"name":"revision","type":"23","not_null":true,"num":4},{"name":"status","type":"25","not_null":true,"num":5},{"name":"terms","type":"3802","not_null":true,"num":6},{"name":"terms_hash","type":"25","not_null":true,"num":7},{"name":"reserved_units","type":"1700","not_null":true,"num":8},{"name":"cap_units","type":"1700","not_null":true,"num":9},{"name":"unit_price_minor","type":"1700","not_null":true,"num":10},{"name":"minimum_units","type":"1700","not_null":true,"num":11},{"name":"created_at","type":"1184","not_null":true,"num":12},{"name":"reviewer_id","type":"2950","not_null":false,"num":13},{"name":"review_notes","type":"25","not_null":false,"num":14},{"name":"reviewed_at","type":"1184","not_null":false,"num":15},{"name":"published_at","type":"1184","not_null":false,"num":16},{"name":"review_checks","type":"3802","not_null":true,"num":17},{"name":"current_offering_revision_id","type":"2950","not_null":false,"num":18}]$original_columns$::jsonb;
  original_constraint constant jsonb:=$original_constraint${"oid":"24227","conbin":"{BOOLEXPR :boolop or :args ({NULLTEST :arg {VAR :varno 1 :varattno 13 :vartype 2950 :vartypmod -1 :varcollid 0 :varnullingrels (b) :varlevelsup 0 :varnosyn 1 :varattnosyn 13 :location -1} :nulltesttype 0 :argisrow false :location -1} {OPEXPR :opno 2973 :opfuncid 2959 :opresulttype 16 :opretset false :opcollid 0 :inputcollid 0 :args ({VAR :varno 1 :varattno 13 :vartype 2950 :vartypmod -1 :varcollid 0 :varnullingrels (b) :varlevelsup 0 :varnosyn 1 :varattnosyn 13 :location -1} {VAR :varno 1 :varattno 3 :vartype 2950 :vartypmod -1 :varcollid 0 :varnullingrels (b) :varlevelsup 0 :varnosyn 1 :varattnosyn 3 :location -1}) :location -1}) :location -1}","conkey":[13,3],"confkey":null,"conname":"products_check2","contype":"c","conindid":"0","conrelid":"24210","contypid":"0","conexclop":null,"conffeqop":null,"confrelid":"0","conpfeqop":null,"conppeqop":null,"conislocal":true,"definition":"CHECK (((reviewer_id IS NULL) OR (reviewer_id <> created_by)))","condeferred":false,"confdeltype":" ","confupdtype":" ","coninhcount":0,"conparentid":"0","connamespace":"24138","connoinherit":false,"convalidated":true,"condeferrable":false,"confmatchtype":" ","confdelsetcols":null}$original_constraint$::jsonb;
  old_span constant text:=$old_span$    if command='review_product' then
      if not bx1_portal.offering_workflow_base_reviewer(c,p.id,o.reviewer_scope) or not bx1_portal.offering_workflow_base_independent(c,p.created_by) or not bx1_portal.offering_workflow_base_independent(c,o.owner_id) or not ((not bx1_portal.test_offering_is_source(o.id) and bx1_portal.organisation_active(o.id))
        or bx1_portal.test_offering_lane_current(c,p.id,request_key,'review_product')) then raise exception 'portal_review_denied' using errcode='42501'; end if;
$old_span$;
  new_span constant text:=$new_span$    if command='review_product' then
      declare same_operator_lane boolean;
      begin
        same_operator_lane:=(
          command='review_product' and auth.uid() is not null
          and c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
          and bx1_private.test_roleplay_environment() is true
          and exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
            where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
              and lane.request_key=offering_workflow_base_command.request_key
              and lane.product_id=p.id and lane.action='review_product' and lane.operating_context=c)
          and bx1_private.fund_roleplay_lane_current(c,p.id,'review_product') is true
        ) is true;
      if not bx1_portal.offering_workflow_base_reviewer(c,p.id,o.reviewer_scope) or not (bx1_portal.offering_workflow_base_independent(c,p.created_by) or (same_operator_lane and p.created_by=auth.uid()) is true) or not (bx1_portal.offering_workflow_base_independent(c,o.owner_id) or (same_operator_lane and o.owner_id=auth.uid()) is true) or not ((not bx1_portal.test_offering_is_source(o.id) and bx1_portal.organisation_active(o.id))
        or bx1_portal.test_offering_lane_current(c,p.id,request_key,'review_product')) then raise exception 'portal_review_denied' using errcode='42501'; end if;
      end;
$new_span$;
  audit_old constant text:=$audit_old$      v_summary:='Independent test offering review: '||(payload->>'decision')||'.';$audit_old$;
  audit_new constant text:=$audit_new$      v_summary:=case when (p.created_by=auth.uid() and ((
          command='review_product' and auth.uid() is not null
          and c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
          and bx1_private.test_roleplay_environment() is true
          and exists(select 1 from bx1_private.fund_roleplay_command_lanes lane
            where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
              and lane.request_key=offering_workflow_base_command.request_key
              and lane.product_id=p.id and lane.action='review_product' and lane.operating_context=c)
          and bx1_private.fund_roleplay_lane_current(c,p.id,'review_product') is true
        ) is true)) is true
        then 'TEST role-play offering review (independence not proved): '||(payload->>'decision')||'.'
        else 'Independent test offering review: '||(payload->>'decision')||'.' end;$audit_new$;
  check_expression constant text:=$check_expression$(((((reviewer_id IS NULL) OR (reviewer_id <> created_by)) AND (review_roleplay_policy_id IS NULL) AND (review_roleplay_epoch IS NULL)) OR ((reviewer_id IS NOT NULL) AND (reviewer_id = created_by) AND (review_roleplay_policy_id IS NOT NULL) AND (review_roleplay_epoch IS NOT NULL) AND (review_roleplay_epoch > 0))) IS TRUE)$check_expression$;
  trigger_body constant text:=$trigger_body$declare review_lane bx1_private.fund_roleplay_command_lanes;
  binding_same boolean:=false; review_tuple_same boolean:=false;
begin
  -- Caller input is checked before any internally derived/cleared value.
  if tg_op='INSERT' then
    if new.review_roleplay_policy_id is not null or new.review_roleplay_epoch is not null then
      raise exception 'product_test_review_provenance_input_denied' using errcode='42501';end if;
  elsif new.review_roleplay_policy_id is distinct from old.review_roleplay_policy_id
    or new.review_roleplay_epoch is distinct from old.review_roleplay_epoch then
    raise exception 'product_test_review_provenance_input_denied' using errcode='42501';
  end if;
  if new.reviewer_id is null or new.reviewer_id<>new.created_by then
    new.review_roleplay_policy_id:=null;new.review_roleplay_epoch:=null;return new;
  end if;
  if tg_op='UPDATE' then
    binding_same:=(new.id,new.organisation_id,new.created_by,new.terms,new.terms_hash,new.current_offering_revision_id)
      is not distinct from (old.id,old.organisation_id,old.created_by,old.terms,old.terms_hash,old.current_offering_revision_id);
    review_tuple_same:=(new.reviewer_id,new.reviewed_at,new.review_notes,new.review_checks)
      is not distinct from (old.reviewer_id,old.reviewed_at,old.review_notes,old.review_checks);
    -- Historical provenance is not a fresh permission or current-policy claim.
    if binding_same is true and review_tuple_same is true then return new;end if;
  end if;
  if tg_op<>'UPDATE' or binding_same is not true
    or old.status<>'IN_REVIEW' or new.status not in ('APPROVED','CHANGES_REQUIRED')
    or new.revision is distinct from old.revision+1 or new.reviewed_at is null then
    raise exception 'product_test_review_transition_denied' using errcode='42501';end if;
  if auth.uid() is null or new.reviewer_id is distinct from auth.uid() or new.created_by is distinct from auth.uid()
    or bx1_private.test_roleplay_environment() is not true
    or bx1_private.test_roleplay_protected_session() is not true then
    raise exception 'product_test_review_session_denied' using errcode='42501';end if;
  begin
    select lane.* into strict review_lane
      from bx1_private.fund_roleplay_command_lanes lane
      join bx1_private.roleplay_policies policy on policy.id=lane.policy_id
        and policy.authority_epoch=lane.authority_epoch and policy.product_id=lane.product_id
        and policy.offering_revision_id=lane.offering_revision_id
      where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
        and lane.product_id=new.id and lane.offering_revision_id=new.current_offering_revision_id
        and lane.action='review_product' and lane.operating_context->>'mode'='ROLE'
        and lane.operating_context->>'role'='ComplianceOfficer'
        and policy.environment='TESTNET' and policy.project_ref='fegnnnlseuejkrusbbkv'
        and policy.assurance='TEST_ROLE_PLAY' and policy.independence_proven is false
        and policy.product_organisation_id=new.organisation_id and policy.terms_hash=new.terms_hash
        and policy.native_organisation_id::text=lane.operating_context->>'organisationId'
        and exists(select 1 from bx1_private.test_workspace_product_commands marker
          where marker.transaction_id=lane.transaction_id and marker.actor_id=lane.actor_id
            and marker.session_id::text=auth.jwt()->>'session_id'
            and marker.request_key=lane.request_key and marker.operating_context=lane.operating_context
            and marker.product_organisation_id=new.organisation_id
            and marker.target_product_id=new.id and marker.command=lane.action)
        and bx1_portal.test_offering_lane_current(lane.operating_context,new.id,lane.request_key,'review_product') is true
        and bx1_private.fund_roleplay_lane_current(lane.operating_context,new.id,'review_product') is true;
  exception when no_data_found or too_many_rows then
    raise exception 'product_test_review_lane_denied' using errcode='42501';
  end;
  new.review_roleplay_policy_id:=review_lane.policy_id;
  new.review_roleplay_epoch:=review_lane.authority_epoch;
  return new;
end$trigger_body$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_base_review_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(specs) loop
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if after_row is null or after_row->>'oid' is distinct from dependency->>'oid'
      or after_row-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(after_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_base_review_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) into dependencies_before
    from pg_catalog.pg_proc p where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs));
  target:=pg_catalog.to_regprocedure('bx1_portal.offering_workflow_base_command(jsonb,text,uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 29619::oid or before_row-'prosrc' is distinct from target_metadata then
    raise exception 'fund_base_review_native_metadata_changed' using errcode='55000';end if;
  restored:=original;
  had_audit:=(length(restored)-length(replace(restored,audit_new,'')))/length(audit_new)=1;
  if had_audit then restored:=replace(restored,audit_new,audit_old);
  elsif (length(restored)-length(replace(restored,audit_old,'')))/length(audit_old)<>1 then
    raise exception 'fund_base_review_audit_cut_changed' using errcode='55000';end if;
  if (length(restored)-length(replace(restored,new_span,'')))/length(new_span)=1 then
    restored:=replace(restored,new_span,old_span);
  elsif had_audit or (length(restored)-length(replace(restored,old_span,'')))/length(old_span)<>1 then
    raise exception 'fund_base_review_guard_cut_changed' using errcode='55000';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    is distinct from 'a6417519b5b6268cc66c1257343ec601bc944651f1b9f79e3b63b3946a6a7836' then
    raise exception 'fund_base_review_outside_cut_changed' using errcode='55000';end if;
  next_body:=replace(replace(restored,old_span,new_span),audit_old,audit_new);
  if not exists(select 1 from pg_catalog.pg_class where oid='bx1_portal.products'::regclass
    and oid=24210 and relowner='postgres'::regrole and relrowsecurity and not relforcerowsecurity
    and relacl::text='{postgres=arwdDxtm/postgres}') then
    raise exception 'fund_base_review_product_relation_changed' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',a.attname,'type',a.atttypid,
      'not_null',a.attnotnull,'num',a.attnum) order by a.attnum) from pg_catalog.pg_attribute a
    where a.attrelid='bx1_portal.products'::regclass and a.attnum between 1 and 18 and not a.attisdropped)
    is distinct from original_columns then raise exception 'fund_base_review_original_columns_changed' using errcode='55000';end if;
  select count(*) into marker_count from pg_catalog.pg_attribute where attrelid='bx1_portal.products'::regclass
    and attname in ('review_roleplay_policy_id','review_roleplay_epoch') and attnum>0 and not attisdropped;
  if marker_count not in (0,2) then raise exception 'fund_base_review_partial_columns' using errcode='55000';end if;
  bootstrap:=marker_count=0;
  if bootstrap then
    select pg_catalog.to_jsonb(c) into check_row from pg_catalog.pg_constraint c
      where c.conrelid='bx1_portal.products'::regclass and c.conname='products_check2';
    if had_audit or check_row is distinct from original_constraint-'definition'
      or pg_catalog.to_regprocedure('bx1_private.guard_product_test_review_provenance()') is not null
      or pg_catalog.to_regclass('bx1_portal.bx1_product_test_review_policy_idx') is not null
      or exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.products'::regclass and tgname='bx1_product_test_review_provenance')
      or exists(select 1 from pg_catalog.pg_constraint where conrelid='bx1_portal.products'::regclass and conname='bx1_product_test_review_policy_fk') then
      raise exception 'fund_base_review_partial_or_changed_bootstrap' using errcode='55000';end if;
  elsif not had_audit or original is distinct from next_body then
    raise exception 'fund_base_review_partial_existing_install' using errcode='55000';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum) into old_columns
    from pg_catalog.pg_attribute a where a.attrelid='bx1_portal.products'::regclass and a.attnum between 1 and 18;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.oid) into old_constraints
    from pg_catalog.pg_constraint c where c.conrelid='bx1_portal.products'::regclass and c.conname<>'products_check2';
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.oid) into old_triggers
    from pg_catalog.pg_trigger t where t.tgrelid='bx1_portal.products'::regclass;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.indexrelid) into old_indexes
    from pg_catalog.pg_index i where i.indrelid='bx1_portal.products'::regclass;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(product)-array['review_roleplay_policy_id','review_roleplay_epoch'] order by product.id),'[]'::jsonb)::text,'UTF8')),'hex')
    into rows_before from bx1_portal.products product;
  if not bootstrap then
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(product.id,product.review_roleplay_policy_id,product.review_roleplay_epoch) order by product.id)
      into tags_before from bx1_portal.products product;
  end if;
  if bootstrap then
    alter table bx1_portal.products add column review_roleplay_policy_id uuid,add column review_roleplay_epoch integer;
    alter table bx1_portal.products add constraint bx1_product_test_review_policy_fk
      foreign key(review_roleplay_policy_id) references bx1_private.roleplay_policies(id) on delete restrict;
    create index bx1_product_test_review_policy_idx on bx1_portal.products(review_roleplay_policy_id)
      where review_roleplay_policy_id is not null;
    execute 'create function bx1_private.guard_product_test_review_provenance() returns trigger '||
      'language plpgsql volatile security definer set search_path='''' as '||pg_catalog.quote_literal(trigger_body);
    helper:=pg_catalog.to_regprocedure('bx1_private.guard_product_test_review_provenance()');
    for permission in select distinct acl.grantee from pg_catalog.pg_proc proc
      cross join lateral pg_catalog.aclexplode(coalesce(proc.proacl,pg_catalog.acldefault('f',proc.proowner))) acl
      where proc.oid=helper and acl.grantee<>proc.proowner loop
      execute 'revoke all on function bx1_private.guard_product_test_review_provenance() from '||
        (case when permission.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(permission.grantee)) end);
    end loop;
    create trigger bx1_product_test_review_provenance before insert or update on bx1_portal.products
      for each row execute function bx1_private.guard_product_test_review_provenance();
    alter table bx1_portal.products drop constraint products_check2;
    execute 'alter table bx1_portal.products add constraint products_check2 check '||check_expression;
  end if;
  -- Repeat installation accepts only the complete exact reviewed objects.
  if (select count(*) from pg_catalog.pg_attribute where attrelid='bx1_portal.products'::regclass and not attisdropped
    and not attnotnull and not atthasdef and attacl is null and attidentity='' and attgenerated=''
    and ((attname='review_roleplay_policy_id' and attnum=19 and atttypid='uuid'::regtype)
      or (attname='review_roleplay_epoch' and attnum=20 and atttypid='integer'::regtype)))<>2 then
    raise exception 'fund_base_review_marker_columns_changed' using errcode='55000';end if;
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='bx1_portal.products'::regclass
    and c.conname='products_check2' and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred
    and pg_catalog.pg_get_expr(c.conbin,c.conrelid) = check_expression) then
    raise exception 'fund_base_review_check_changed' using errcode='55000';end if;
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='bx1_portal.products'::regclass
    and c.conname='bx1_product_test_review_policy_fk' and c.contype='f' and c.convalidated
    and c.confrelid='bx1_private.roleplay_policies'::regclass and c.conkey=array[19]::smallint[] and c.confkey=array[1]::smallint[]
    and not c.condeferrable and not c.condeferred and c.confupdtype='a' and c.confdeltype='r' and c.confmatchtype='s'
    and pg_catalog.pg_get_constraintdef(c.oid)='FOREIGN KEY (review_roleplay_policy_id) REFERENCES bx1_private.roleplay_policies(id) ON DELETE RESTRICT') then
    raise exception 'fund_base_review_policy_fk_changed' using errcode='55000';end if;
  if not exists(select 1 from pg_catalog.pg_index i where i.indexrelid=pg_catalog.to_regclass('bx1_portal.bx1_product_test_review_policy_idx')
    and i.indrelid='bx1_portal.products'::regclass and i.indisvalid and i.indisready and i.indislive and not i.indisunique and not i.indisprimary
    and i.indnkeyatts=1 and i.indnatts=1 and i.indkey::text='19'
    and pg_catalog.pg_get_indexdef(i.indexrelid)='CREATE INDEX bx1_product_test_review_policy_idx ON bx1_portal.products USING btree (review_roleplay_policy_id) WHERE (review_roleplay_policy_id IS NOT NULL)') then
    raise exception 'fund_base_review_policy_index_changed' using errcode='55000';end if;
  helper:=pg_catalog.to_regprocedure('bx1_private.guard_product_test_review_provenance()');
  select pg_catalog.to_jsonb(proc) into after_row from pg_catalog.pg_proc proc where proc.oid=helper;
  if helper is null or after_row->>'prosrc' is distinct from trigger_body
    or after_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or after_row->'prosecdef' is distinct from 'true'::jsonb or after_row->>'provolatile' is distinct from 'v'
    or after_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or after_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or after_row->>'pronargs' is distinct from '0' or after_row->>'prorettype' is distinct from 'trigger'::regtype::oid::text
    or after_row->>'prolang' is distinct from (select oid::text from pg_catalog.pg_language where lanname='plpgsql')
    or after_row->'proisstrict' is distinct from 'false'::jsonb or after_row->'proretset' is distinct from 'false'::jsonb then
    raise exception 'fund_base_review_provenance_function_changed' using errcode='55000';end if;
  if not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='bx1_portal.products'::regclass
    and t.tgname='bx1_product_test_review_provenance' and t.tgfoid=helper and t.tgtype=23 and t.tgenabled='O'
    and not t.tgisinternal and t.tgconstraint=0 and t.tgqual is null and t.tgnargs=0 and t.tgargs=''::bytea
    and pg_catalog.pg_get_triggerdef(t.oid)='CREATE TRIGGER bx1_product_test_review_provenance BEFORE INSERT OR UPDATE ON bx1_portal.products FOR EACH ROW EXECUTE FUNCTION bx1_private.guard_product_test_review_provenance()') then
    raise exception 'fund_base_review_provenance_trigger_changed' using errcode='55000';end if;
  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_base_review_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(proc) into after_row from pg_catalog.pg_proc proc where proc.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_base_review_metadata_not_preserved' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(proc) order by proc.oid) from pg_catalog.pg_proc proc
    where proc.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs))) is distinct from dependencies_before then
    raise exception 'fund_base_review_dependency_modified' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.attnum) from pg_catalog.pg_attribute a
    where a.attrelid='bx1_portal.products'::regclass and a.attnum between 1 and 18) is distinct from old_columns
    or exists(select 1 from pg_catalog.jsonb_array_elements(old_constraints) saved(value)
      where not exists(select 1 from pg_catalog.pg_constraint c where c.oid=(saved.value->>'oid')::oid and pg_catalog.to_jsonb(c)=saved.value))
    or exists(select 1 from pg_catalog.jsonb_array_elements(old_triggers) saved(value)
      where not exists(select 1 from pg_catalog.pg_trigger t where t.oid=(saved.value->>'oid')::oid and pg_catalog.to_jsonb(t)=saved.value))
    or exists(select 1 from pg_catalog.jsonb_array_elements(old_indexes) saved(value)
      where not exists(select 1 from pg_catalog.pg_index i where i.indexrelid=(saved.value->>'indexrelid')::oid and pg_catalog.to_jsonb(i)=saved.value)) then
    raise exception 'fund_base_review_preexisting_schema_changed' using errcode='55000';end if;
  if (select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(product)-array['review_roleplay_policy_id','review_roleplay_epoch'] order by product.id),'[]'::jsonb)::text,'UTF8')),'hex')
    from bx1_portal.products product) is distinct from rows_before
    or bootstrap and exists(select 1 from bx1_portal.products where review_roleplay_policy_id is not null or review_roleplay_epoch is not null)
    or not bootstrap and (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(product.id,product.review_roleplay_policy_id,product.review_roleplay_epoch) order by product.id)
      from bx1_portal.products product) is distinct from tags_before then
    raise exception 'fund_base_review_product_data_changed' using errcode='55000';end if;
end $fund_base_review$;
