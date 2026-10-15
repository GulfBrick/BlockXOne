-- One TEST-only missed base-identity seam. No helper, grant, role, account,
-- provider fact or business record is created. Apply atomically.
do $fund_base_review$
declare target oid; original text; next_body text; restored text; definition text;
  before_row jsonb; after_row jsonb; dependency jsonb; dependencies_before jsonb;
  specs constant jsonb:=$dependencies$[
    {"oid":16542,"signature":"auth.uid()","sha":"09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":24330,"signature":"bx1_portal.organisation_active(uuid)","sha":"bada9231ecd70a35e70b5d498bd5f398215ac18696a301948fec3539e5e1e32c","metadata":{"oid":"24330","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"organisation_active","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_org"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26606,"signature":"bx1_portal.guard_offering_decision_appointment()","sha":"a247093525a237ab9220e9244fd6b1b4fd092d105208d9df57d27dfbe6b86898","metadata":{"oid":"26606","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_offering_decision_appointment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":26609,"signature":"bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)","sha":"9e2274b7baa730a529c288ce306855c261a5b5e65742fa0567be6f14ff734ebe","metadata":{"oid":"26609","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"execute_appointed_compliance_decision","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","key","body"],"proargtypes":["3802","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29612,"signature":"bx1_portal.offering_workflow_base_reviewer(jsonb,uuid,uuid)","sha":"1a53aa030d87e78d5da7e3af8827cc80ae8ba6397aadba3354947b67dfadd915","metadata":{"oid":"29612","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_base_reviewer","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product","target_scope"],"proargtypes":["3802","2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29613,"signature":"bx1_portal.offering_workflow_base_independent(jsonb,uuid)","sha":"8e9ed18d2df143442fc3773b9f3bc37f65b878677750b623217caa15481d63d0","metadata":{"oid":"29613","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_base_independent","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_actor"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30768,"signature":"bx1_portal.test_offering_is_source(uuid)","sha":"adde28645a0ece5113d74350578e9301c24e5c5a2a92acb583e8ad2515333fad","metadata":{"oid":"30768","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_is_source","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_org"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30783,"signature":"bx1_portal.test_offering_command(jsonb,text,uuid,jsonb)","sha":"4230af88f5b77ef0e615ec85fd98310b7a7b3d93881212cf34c0870156e62a28","metadata":{"oid":"30783","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_offering_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","action","key","body"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30784,"signature":"bx1_portal.test_offering_lane_current(jsonb,uuid,uuid,text)","sha":"f04cab165144ca3fc1471b0e448c92806f34e8a040eb97e87f724b1f8bc5f0d7","metadata":{"oid":"30784","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_lane_current","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product","key","action"],"proargtypes":["3802","2950","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33388,"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":36065,"signature":"bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)","sha":"e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177","metadata":{"oid":"36065","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_lane_current","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product","action"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":"({CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}}
  ]$dependencies$::jsonb;
  target_metadata constant jsonb:=$target_metadata${"oid":"29619","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_base_command","prorows":0,"pronargs":4,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","command","request_key","payload"],"proargtypes":["3802","25","2950","3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
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
  next_body:=original;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    ='a6417519b5b6268cc66c1257343ec601bc944651f1b9f79e3b63b3946a6a7836' then
    if (length(original)-length(replace(original,old_span,'')))/length(old_span)<>1 then
      raise exception 'fund_base_review_cut_not_unique' using errcode='55000';end if;
    next_body:=replace(original,old_span,new_span);
  else
    if (length(original)-length(replace(original,new_span,'')))/length(new_span)<>1 then
      raise exception 'fund_base_review_repeat_cut_changed' using errcode='55000';end if;
    restored:=replace(original,new_span,old_span);
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'a6417519b5b6268cc66c1257343ec601bc944651f1b9f79e3b63b3946a6a7836' then
      raise exception 'fund_base_review_outside_cut_changed' using errcode='55000';end if;
  end if;
  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_base_review_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_base_review_metadata_not_preserved' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) from pg_catalog.pg_proc p
    where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs))) is distinct from dependencies_before then
    raise exception 'fund_base_review_dependency_modified' using errcode='55000';end if;
end $fund_base_review$;
