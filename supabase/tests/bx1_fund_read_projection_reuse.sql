-- Pure catalog/predicate proof only. Integrator wraps exact installation,
-- repeat and this proof in the existing forced-rollback preservation envelope.
-- No actor, claims, sessions, policy, provider or business rows are fabricated.
do $fund_read_reuse_proof$
declare dependency jsonb; cut jsonb; metadata jsonb; source text; restored text; helper oid;
  source_native text; wrapper_native text; selector text; source_branch text; expected_helper text;
  marker text; expression text; old_return text; start_at integer; index_in_roles integer; role_name text;
  candidate jsonb; case_row jsonb; replacement jsonb; outcome boolean; count_cases integer:=0;
  guard_expression text; final_expression text;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
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
  replacements constant jsonb:=$replacements$[["a.requested_by_user_id=auth.uid()","requester_match"],["a.requested_in_context=c","requested_context"],["bx1_portal.offering_workflow_operator(c,a.product_organisation_id)","operator_current"],["bx1_private.fund_roleplay_manager_current(c,a.product_id)","manager_current"],["a.appointee_user_id=auth.uid()","appointee_match"],["a.role='IssuerFundManager'","issuer_role"],["bx1_portal.test_offering_appointed(c,a.product_id,'IssuerFundManager')","issuer_appointed"],["coalesce((v->>'can_review')::boolean,false)","coalesce(can_review,false)"],["bx1_portal.test_offering_appointed(c,a.product_id,'ComplianceOfficer')","compliance_appointed"],["a.reviewed_by_user_id=auth.uid()","reviewer_match"],["a.approval_receipt_id is not null","receipt_present"],["a.reviewed_at is not null","reviewed_time"],["bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer')","staff_current"],["bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)","requester_independent"],["bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)","appointee_independent"],["a.status='APPROVED'","status_approved"],["a.status='APPLIED'","status_applied"],["bx1_portal.test_offering_appointment_effective(a.id)","effective"],["coalesce((v->>'can_apply')::boolean,false)","coalesce(can_apply,false)"],["a.applied_by_user_id=auth.uid()","applier_match"],["a.applied_at is not null","applied_time"]]$replacements$::jsonb;
  defaults constant jsonb:=$defaults${"requester_match":false,"requested_context":false,"operator_current":false,"manager_current":false,"appointee_match":false,"issuer_role":false,"issuer_appointed":false,"compliance_appointed":false,"reviewer_match":false,"receipt_present":false,"reviewed_time":false,"staff_current":false,"requester_independent":false,"appointee_independent":false,"status_approved":false,"status_applied":false,"effective":false,"applier_match":false,"applied_time":false,"can_review":false,"can_apply":false}$defaults$::jsonb;
  role_cases constant jsonb:=$role_cases$[
  {
    "role": "OfferingManager",
    "values": {
      "requester_match": true,
      "requested_context": true,
      "operator_current": true
    },
    "allow": true
  },
  {
    "role": "OfferingManager",
    "values": {
      "requester_match": true,
      "requested_context": true,
      "manager_current": true
    },
    "allow": true
  },
  {
    "role": "OfferingManager",
    "values": {
      "requester_match": true,
      "requested_context": true,
      "operator_current": null,
      "manager_current": null
    },
    "allow": false
  },
  {
    "role": "OfferingManager",
    "values": {
      "requester_match": false,
      "requested_context": true,
      "operator_current": true
    },
    "allow": false
  },
  {
    "role": "IssuerFundManager",
    "values": {
      "appointee_match": true,
      "issuer_role": true,
      "issuer_appointed": true
    },
    "allow": true
  },
  {
    "role": "IssuerFundManager",
    "values": {
      "appointee_match": true,
      "issuer_role": true,
      "issuer_appointed": null
    },
    "allow": false
  },
  {
    "role": "IssuerFundManager",
    "values": {
      "appointee_match": false,
      "issuer_role": true,
      "issuer_appointed": true
    },
    "allow": false
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "can_review": true
    },
    "allow": true
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "compliance_appointed": true
    },
    "allow": true
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "reviewer_match": true,
      "receipt_present": true,
      "reviewed_time": true,
      "staff_current": true,
      "requester_independent": true,
      "appointee_independent": true,
      "status_approved": true
    },
    "allow": true
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "reviewer_match": true,
      "receipt_present": true,
      "reviewed_time": true,
      "staff_current": true,
      "requester_independent": true,
      "appointee_independent": true,
      "status_applied": true,
      "effective": true
    },
    "allow": true
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "reviewer_match": true,
      "receipt_present": true,
      "reviewed_time": true,
      "staff_current": null,
      "requester_independent": true,
      "appointee_independent": true,
      "status_approved": true
    },
    "allow": false
  },
  {
    "role": "ComplianceOfficer",
    "values": {
      "can_review": null,
      "compliance_appointed": null
    },
    "allow": false
  },
  {
    "role": "SuperAdmin",
    "values": {
      "can_apply": true
    },
    "allow": true
  },
  {
    "role": "SuperAdmin",
    "values": {
      "status_applied": true,
      "applier_match": true,
      "applied_time": true,
      "receipt_present": true,
      "effective": true
    },
    "allow": true
  },
  {
    "role": "SuperAdmin",
    "values": {
      "status_applied": true,
      "applier_match": true,
      "applied_time": true,
      "receipt_present": true,
      "effective": null
    },
    "allow": false
  },
  {
    "role": "SuperAdmin",
    "values": {
      "can_apply": null
    },
    "allow": false
  }
]$role_cases$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_read_reuse_proof_exact_test_owner_required';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(specs) loop
    select pg_catalog.to_jsonb(p) into metadata from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if metadata is null or metadata->>'oid' is distinct from dependency->>'oid'
      or metadata-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(metadata->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_read_reuse_proof_dependency_changed: %',dependency->>'signature';end if;
  end loop;
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=30335;
  if metadata-'prosrc' is distinct from target_metadata then raise exception 'fund_read_reuse_proof_reader_metadata_changed';end if;
  restored:=source;
  for cut in select value from pg_catalog.jsonb_array_elements(cuts) with ordinality x(value,n) order by n desc loop
    if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
      raise exception 'fund_read_reuse_proof_cut_not_unique';end if;
    restored:=replace(restored,cut->>'to',cut->>'from');
    if (length(cut->>'to')-length(replace(cut->>'to','bx1_private.fund_appointment_read_candidate(','')))/
      length('bx1_private.fund_appointment_read_candidate(')<>1
      or strpos(cut->>'to',' as materialized (')<=0 then
      raise exception 'fund_read_reuse_proof_once_per_phase_changed';end if;
  end loop;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    is distinct from 'e52f27c96c7512570a96d133708b2f8fe4bc799246c96b3c7062d5cfb6d1b52d' then
    raise exception 'fund_read_reuse_proof_outside_cut_changed';end if;
  -- Reconstruct the helper from the ORIGINAL pinned selector and row predicates.
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
  select pg_catalog.to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=helper;
  if helper is null or metadata->>'prosrc' is distinct from expected_helper
    or metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or metadata->'prosecdef' is distinct from 'true'::jsonb
    or metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or metadata->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or metadata->>'provolatile' is distinct from 'v'
    or metadata->'proargnames' is distinct from '["c","target_id"]'::jsonb
    or pg_catalog.pg_get_function_result(helper) is distinct from 'jsonb'
    or expected_helper ~* '\m(insert|update|delete|set_config|execute)\M' then
    raise exception 'fund_read_reuse_proof_candidate_boundary_changed';end if;
  if bx1_private.fund_appointment_read_candidate(null,null) is not null then
    raise exception 'fund_read_reuse_proof_null_actor_context_not_denied';end if;
  -- Evaluate ACTUAL extracted native role expressions as values. These booleans
  -- are not authenticated authority outcomes and never enter a business table.
  index_in_roles:=0;
  foreach role_name in array array['OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin'] loop
    marker:=(case when index_in_roles=0 then '  if' else '  elsif' end)||' c->>''role''='''||role_name||''' then'||E'\n'||'    return ';
    start_at:=strpos(source_native,marker);
    expression:=substring(source_native from start_at+length(marker));
    expression:=substring(expression from 1 for strpos(expression,';')-1);
    for replacement in select value from pg_catalog.jsonb_array_elements(replacements) loop
      expression:=replace(expression,replacement->>0,replacement->>1);
    end loop;
    if expression ~ '(bx1_|auth\.|a\.|v->)' then raise exception 'fund_read_reuse_proof_role_extraction_incomplete';end if;
    for case_row in select value from pg_catalog.jsonb_array_elements(role_cases) where value->>'role'=role_name loop
      execute 'select ('||expression||') is true from pg_catalog.jsonb_to_record($1) as inputs(requester_match boolean,requested_context boolean,operator_current boolean,manager_current boolean,appointee_match boolean,issuer_role boolean,issuer_appointed boolean,compliance_appointed boolean,reviewer_match boolean,receipt_present boolean,reviewed_time boolean,staff_current boolean,requester_independent boolean,appointee_independent boolean,status_approved boolean,status_applied boolean,effective boolean,applier_match boolean,applied_time boolean,can_review boolean,can_apply boolean)'
        into outcome using defaults||(case_row->'values');
      if outcome is distinct from (case_row->>'allow')::boolean then
        raise exception 'fund_read_reuse_proof_role_boolean_changed: %',role_name;end if;
      count_cases:=count_cases+1;
    end loop;
    index_in_roles:=index_in_roles+1;
  end loop;
  if count_cases<>17 then raise exception 'fund_read_reuse_proof_role_cases_missing';end if;
  -- Retain the actual source row gate and TRUE-only/NULL semantics.
  guard_expression:=substring(source_native from strpos(source_native,'a.id is null')
    for strpos(source_native,' then return false; end if;')-strpos(source_native,'a.id is null'));
  guard_expression:=replace(replace(replace(replace(guard_expression,'a.id is null','missing_row'),
    'bx1_portal.test_offering_context(c)','test_context'),
    'bx1_private.fund_roleplay_manager_current(c,a.product_id)','manager_current'),
    'bx1_portal.test_offering_appointment_current(a.id)','appointment_current');
  for case_row in select value from pg_catalog.jsonb_array_elements($guards$[
    {"missing":false,"context":true,"manager":false,"current":true,"deny":false},
    {"missing":false,"context":false,"manager":true,"current":true,"deny":false},
    {"missing":true,"context":true,"manager":false,"current":true,"deny":true},
    {"missing":false,"context":null,"manager":false,"current":true,"deny":true},
    {"missing":false,"context":false,"manager":null,"current":true,"deny":true},
    {"missing":false,"context":true,"manager":false,"current":null,"deny":true},
    {"missing":false,"context":true,"manager":false,"current":false,"deny":true}
  ]$guards$::jsonb) loop
    execute 'select '||guard_expression||' from (select $1::boolean missing_row,$2::boolean test_context,$3::boolean manager_current,$4::boolean appointment_current) inputs'
      into outcome using (case_row->>'missing')::boolean,(case_row->>'context')::boolean,
        (case_row->>'manager')::boolean,(case_row->>'current')::boolean;
    if outcome is distinct from (case_row->>'deny')::boolean then raise exception 'fund_read_reuse_proof_source_row_gate_changed';end if;
  end loop;
  -- A separately evaluated final candidate cannot reuse the first-phase value.
  final_expression:=substring(cuts->1->>'to' from strpos(cuts->1->>'to','where fresh_value')+6);
  final_expression:=left(final_expression,length(final_expression)-1);
  for case_row in select value from pg_catalog.jsonb_array_elements($finals$[
    {"saved":{"revision":3},"fresh":{"revision":3},"deny":false},
    {"saved":{"revision":3},"fresh":{"revision":4},"deny":true},
    {"saved":{"revision":3},"fresh":null,"deny":true}
  ]$finals$::jsonb) loop
    execute 'select '||final_expression||' from (select $1::jsonb saved_value,$2::jsonb fresh_value) inputs'
      into outcome using case_row->'saved',nullif(case_row->'fresh','null'::jsonb);
    if outcome is distinct from (case_row->>'deny')::boolean then raise exception 'fund_read_reuse_proof_fresh_final_mismatch_not_denied';end if;
  end loop;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'fund_read_reuse_proof_claims_changed';end if;
end $fund_read_reuse_proof$;
