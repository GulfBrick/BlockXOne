-- TEST-only read-cost repair. No business records, authority predicates,
-- original helper bodies, role grants or timeouts change. Apply atomically.
do $fund_read_reuse$
declare target oid; helper oid; dependency jsonb; cut jsonb; permission record; role_name text;
  original text; next_body text; restored text; definition text; before_row jsonb; after_row jsonb;
  dependencies_before jsonb; source_native text; wrapper_native text; selector text; source_branch text;
  marker text; expression text; old_return text; expected_helper text; start_at integer; index_in_roles integer;
  specs constant jsonb:=$dependencies$[
    {"oid":16542,"signature":"auth.uid()","sha":"09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16","metadata":{"oid":"16542","proacl":["=X/supabase_auth_admin","supabase_auth_admin=X/supabase_auth_admin","dashboard_user=X/supabase_auth_admin"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"uid","prorows":0,"pronargs":0,"proowner":"16545","proconfig":null,"proretset":false,"prosecdef":false,"prorettype":"2950","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"16498","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29594,"signature":"bx1_portal.offering_workflow_operator(jsonb,uuid)","sha":"b1331cb94fa47eafbd0ed14612ade3952b7114ef62dd8c8a3f5f9b5ffce174ff","metadata":{"oid":"29594","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_operator","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_org"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29598,"signature":"bx1_portal.offering_workflow_staff(jsonb,uuid,text)","sha":"22268c1e7b20c75e704a12aa7fb83d85fa93417ebc9aadd90564c37eaed04ad9","metadata":{"oid":"29598","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_staff","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_scope","actor_role"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29599,"signature":"bx1_portal.offering_workflow_people_independent(uuid,uuid)","sha":"922e30168ceb0e35d96d0e9f6b44534f053866fb660113677e1a9ac081cdeff9","metadata":{"oid":"29599","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_workflow_people_independent","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["a","b"],"proargtypes":["2950","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29609,"signature":"bx1_portal.offering_workflow_appointment_projection(jsonb,uuid)","sha":"f5390b38064a862c488c141cc1fe78a06dca1d2ae5ec71b1b6823c5a17722319","metadata":{"oid":"29609","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_appointment_projection","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_id"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":29616,"signature":"bx1_portal.offering_workflow_appointment_visible(jsonb,uuid)","sha":"5d4c9f19527c5e79504f192ed1ecfabf95e49b58cbf98713ad9072753abf6a2a","metadata":{"oid":"29616","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_appointment_visible","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_id"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30768,"signature":"bx1_portal.test_offering_is_source(uuid)","sha":"adde28645a0ece5113d74350578e9301c24e5c5a2a92acb583e8ad2515333fad","metadata":{"oid":"30768","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_is_source","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_org"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30773,"signature":"bx1_portal.test_offering_appointment_current(uuid)","sha":"e7221450da59b02021ee9f3b257ddc8455728242968273ef43c2e6db34359ad6","metadata":{"oid":"30773","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_appointment_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_appointment"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30776,"signature":"bx1_portal.test_offering_context(jsonb)","sha":"0517cbc73459848eece7831da76b76bcd05e310ccf3f7a7c4ae858de16cb56ca","metadata":{"oid":"30776","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_context","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30778,"signature":"bx1_portal.test_offering_appointment_effective(uuid)","sha":"44a21f115b5c97dba068fe2cb7440e1b899923abe84f1bba807489026f40b7e5","metadata":{"oid":"30778","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_appointment_effective","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_id"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30779,"signature":"bx1_portal.test_offering_appointed(jsonb,uuid,text)","sha":"9571b3b61b53f97104a06d001fec1638786d972cfd904ff3c5197e90da2d5667","metadata":{"oid":"30779","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_appointed","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product","target_role"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":30780,"signature":"bx1_portal.test_offering_appointment_visible(jsonb,uuid)","sha":"8294d42559de7fb0397381f11c4a1c5787ded0e7614baa4854f4006b5f17e4ea","metadata":{"oid":"30780","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"test_offering_appointment_visible","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_id"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":33388,"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","metadata":{"oid":"33388","proacl":["postgres=X/postgres","bx1_authority_owner=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_roleplay_environment","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},
    {"oid":37210,"signature":"bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)","sha":"643ccda96e4c99f3b22082beab45bf7fe4135e15d3bbf78c296ef627c13bb6a3","metadata":{"oid":"37210","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_manager_current","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product","action"],"proargtypes":["3802","2950","25"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":"({CONST :consttype 25 :consttypmod -1 :constcollid 100 :constlen -1 :constbyval false :constisnull true :location -1 :constvalue <>})","pronargdefaults":1}}
  ]$dependencies$::jsonb;
  target_metadata constant jsonb:=$target_metadata${"oid":"30335","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_read_scoped_pre_test_workspace","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}$target_metadata$::jsonb;
  cuts constant jsonb:=$cuts$[
  {
    "from": "  select coalesce(pg_catalog.jsonb_agg(v.value order by a.requested_at,a.id),'[]'::jsonb) into appointments_json\n    from bx1_portal.product_service_appointments a\n    cross join lateral (select bx1_portal.offering_workflow_appointment_projection(c,a.id) value) v\n    where v.value is not null and bx1_portal.offering_workflow_appointment_visible(c,a.id);",
    "to": "  with appointment_candidates as materialized (\n    select a.requested_at,a.id,bx1_private.fund_appointment_read_candidate(c,a.id) as value\n      from bx1_portal.product_service_appointments a\n  )\n  select coalesce(pg_catalog.jsonb_agg(value order by requested_at,id),'[]'::jsonb) into appointments_json\n    from appointment_candidates where value is not null;"
  },
  {
    "from": "    or exists(select 1 from pg_catalog.jsonb_array_elements(appointments_json) x(value)\n      where bx1_portal.offering_workflow_appointment_visible(c,(value->>'id')::uuid) is not true\n        or bx1_portal.offering_workflow_appointment_projection(c,(value->>'id')::uuid) is distinct from value)",
    "to": "    or exists(\n      with appointment_revalidation as materialized (\n        select x.value as saved_value,\n          bx1_private.fund_appointment_read_candidate(c,(x.value->>'id')::uuid) as fresh_value\n        from pg_catalog.jsonb_array_elements(appointments_json) x(value)\n      )\n      select 1 from appointment_revalidation\n        where fresh_value is null or fresh_value is distinct from saved_value)"
  }
]$cuts$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_read_reuse_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(specs) loop
    select pg_catalog.to_jsonb(p) into before_row from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if before_row is null or before_row->>'oid' is distinct from dependency->>'oid'
      or before_row-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(before_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_read_reuse_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) into dependencies_before
    from pg_catalog.pg_proc p where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs));
  target:=pg_catalog.to_regprocedure('bx1_portal.offering_workflow_read_scoped_pre_test_workspace(jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 30335::oid or before_row-'prosrc' is distinct from target_metadata then
    raise exception 'fund_read_reuse_reader_metadata_changed' using errcode='55000';end if;
  next_body:=original;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    ='e52f27c96c7512570a96d133708b2f8fe4bc799246c96b3c7062d5cfb6d1b52d' then
    for cut in select value from pg_catalog.jsonb_array_elements(cuts) loop
      if (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
        raise exception 'fund_read_reuse_cut_not_unique' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
  else
    restored:=original;
    for cut in select value from pg_catalog.jsonb_array_elements(cuts) with ordinality x(value,n) order by n desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'fund_read_reuse_repeat_source_changed' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'e52f27c96c7512570a96d133708b2f8fe4bc799246c96b3c7062d5cfb6d1b52d' then
      raise exception 'fund_read_reuse_outside_cut_changed' using errcode='55000';end if;
  end if;
  -- Derive from pinned native bodies, not caller-supplied projection data.
  select replace(p.prosrc,E'\r\n',E'\n') into source_native from pg_catalog.pg_proc p where p.oid=30780;
  select replace(p.prosrc,E'\r\n',E'\n') into wrapper_native from pg_catalog.pg_proc p where p.oid=29616;
  selector:=substring(wrapper_native from strpos(wrapper_native,'  if exists(')
    for strpos(wrapper_native,'    return bx1_portal.test_offering_appointment_visible')-strpos(wrapper_native,'  if exists('));
  source_branch:=pg_catalog.btrim(substring(source_native from strpos(source_native,'  select * into a')),E' \n\t');
  if right(source_branch,3)<>'end' then raise exception 'fund_read_reuse_source_derivation_changed';end if;
  source_branch:=left(source_branch,length(source_branch)-3);
  index_in_roles:=0;
  foreach role_name in array array['OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin'] loop
    marker:=(case when index_in_roles=0 then '  if' else '  elsif' end)||' c->>''role''='''||role_name||''' then'||E'\n'||'    return ';
    start_at:=strpos(source_native,marker);
    if start_at<=0 then raise exception 'fund_read_reuse_role_marker_changed';end if;
    expression:=substring(source_native from start_at+length(marker));
    expression:=substring(expression from 1 for strpos(expression,';')-1);
    old_return:='return '||expression||';';
    if (length(source_branch)-length(replace(source_branch,old_return,'')))/length(old_return)<>1 then
      raise exception 'fund_read_reuse_role_derivation_not_unique';end if;
    source_branch:=replace(source_branch,old_return,'if ('||expression||') is true then return v; end if; return null;');
    index_in_roles:=index_in_roles+1;
  end loop;
  source_branch:=replace(source_branch,'return false;','return null;');
  expected_helper:='declare a bx1_portal.product_service_appointments; v jsonb;'||E'\n'||'begin'||E'\n'||
    selector||source_branch||'  end if;'||E'\n'||
    '  -- Ordinary rows retain their existing complete visibility predicate.'||E'\n'||
    '  if bx1_portal.offering_workflow_appointment_visible(c,target_id) is true then'||E'\n'||
    '    return bx1_portal.offering_workflow_appointment_projection(c,target_id);'||E'\n'||
    '  end if;'||E'\n'||'  return null;'||E'\n'||'end';

  helper:=pg_catalog.to_regprocedure('bx1_private.fund_appointment_read_candidate(jsonb,uuid)');
  if helper is null then
    execute 'create function bx1_private.fund_appointment_read_candidate(c jsonb,target_id uuid) returns jsonb '||
      'language plpgsql volatile security definer set search_path='''' as '||pg_catalog.quote_literal(expected_helper);
    helper:=pg_catalog.to_regprocedure('bx1_private.fund_appointment_read_candidate(jsonb,uuid)');
    -- Close only this new helper against any actual default nonowner grants.
    for permission in select distinct acl.grantee from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=helper and acl.grantee<>p.proowner loop
      execute 'revoke all on function bx1_private.fund_appointment_read_candidate(jsonb,uuid) from '||
        (case when permission.grantee=0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(permission.grantee)) end);
    end loop;
  end if;
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=helper;
  if after_row->>'prosrc' is distinct from expected_helper
    or after_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or after_row->'prosecdef' is distinct from 'true'::jsonb
    or after_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or after_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or after_row->>'provolatile' is distinct from 'v'
    or after_row->'proargnames' is distinct from '["c","target_id"]'::jsonb
    or after_row->>'prolang' is distinct from (select oid::text from pg_catalog.pg_language where lanname='plpgsql')
    or pg_catalog.pg_get_function_result(helper) is distinct from 'jsonb' then
    raise exception 'fund_read_reuse_candidate_contract_changed' using errcode='55000';end if;
  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_read_reuse_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
    raise exception 'fund_read_reuse_reader_metadata_not_preserved' using errcode='55000';end if;
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.oid) from pg_catalog.pg_proc p
    where p.oid in(select (value->>'oid')::oid from pg_catalog.jsonb_array_elements(specs))) is distinct from dependencies_before then
    raise exception 'fund_read_reuse_dependency_modified' using errcode='55000';end if;
end $fund_read_reuse$;
