-- Pure expression/catalog proof; no session, claims, application, decision,
-- person, role, provider or business rows are created. Cloud rollback wrapper owns DDL.
do $fund_base_review_proof$
declare target oid; metadata jsonb; source text; restored text; dependency jsonb;
  lane_expression text; identity_expression text; identity jsonb; case_row jsonb;
  outcome boolean; mandatory_expression text; count_cases integer:=0;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
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
  identity_terms constant jsonb:=$identities$[{"old":"bx1_portal.offering_workflow_base_independent(c,p.created_by)","next":"(bx1_portal.offering_workflow_base_independent(c,p.created_by) or (same_operator_lane and p.created_by=auth.uid()) is true)"},{"old":"bx1_portal.offering_workflow_base_independent(c,o.owner_id)","next":"(bx1_portal.offering_workflow_base_independent(c,o.owner_id) or (same_operator_lane and o.owner_id=auth.uid()) is true)"}]$identities$::jsonb;
  default_actor constant uuid:='11111111-1111-4111-8111-111111111111';
  default_key constant uuid:='33333333-3333-4333-8333-333333333333';
  default_product constant uuid:='44444444-4444-4444-8444-444444444444';
  default_context constant jsonb:=$context${"mode":"ROLE","organisationId":"55555555-5555-4555-8555-555555555555","role":"ComplianceOfficer"}$context$::jsonb;
  default_lane constant jsonb:=$lane${"transaction_id":"1","actor_id":"11111111-1111-4111-8111-111111111111","request_key":"33333333-3333-4333-8333-333333333333","product_id":"44444444-4444-4444-8444-444444444444","action":"review_product","operating_context":{"mode":"ROLE","organisationId":"55555555-5555-4555-8555-555555555555","role":"ComplianceOfficer"}}$lane$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_base_review_proof_exact_test_owner_required';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(specs) loop
    select pg_catalog.to_jsonb(p) into metadata from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature');
    if metadata is null or metadata->>'oid' is distinct from dependency->>'oid'
      or metadata-'prosrc' is distinct from dependency->'metadata'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(metadata->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_base_review_proof_dependency_changed: %',dependency->>'signature';end if;
  end loop;
  target:=pg_catalog.to_regprocedure('bx1_portal.offering_workflow_base_command(jsonb,text,uuid,jsonb)');
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 29619::oid or metadata-'prosrc' is distinct from target_metadata
    or (length(source)-length(replace(source,new_span,'')))/length(new_span)<>1 then
    raise exception 'fund_base_review_proof_native_or_cut_changed';end if;
  restored:=replace(source,new_span,old_span);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    is distinct from 'a6417519b5b6268cc66c1257343ec601bc944651f1b9f79e3b63b3946a6a7836' then
    raise exception 'fund_base_review_proof_outside_cut_changed';end if;
  -- The original reviewer and ENTIRE organisation/source-lane predicate remain
  -- in exactly the original order/bytes, not replaced by the local exception.
  mandatory_expression:=substring(old_span from strpos(old_span,'or not ((not bx1_portal.test_offering_is_source'));
  if strpos(new_span,'if not bx1_portal.offering_workflow_base_reviewer(c,p.id,o.reviewer_scope)')<=0
    or strpos(new_span,mandatory_expression)<=0 then raise exception 'fund_base_review_proof_mandatory_authority_changed';end if;
  -- Extract the ACTUAL installed local gate; replace its inputs with query-only
  -- scalar/record values, never auth claims or rows in the private lane table.
  lane_expression:=substring(source from strpos(source,'same_operator_lane:=')+length('same_operator_lane:='));
  lane_expression:=substring(lane_expression from 1 for strpos(lane_expression,';')-1);
  lane_expression:=replace(lane_expression,'bx1_private.test_roleplay_environment()','proof_environment');
  lane_expression:=replace(lane_expression,'bx1_private.fund_roleplay_lane_current(c,p.id,''review_product'')','proof_current');
  lane_expression:=replace(lane_expression,'bx1_private.fund_roleplay_command_lanes lane',
    'pg_catalog.jsonb_to_record($1) as lane(transaction_id xid8,actor_id uuid,request_key uuid,product_id uuid,action text,operating_context jsonb)');
  lane_expression:=replace(lane_expression,'offering_workflow_base_command.request_key','proof_key');
  lane_expression:=replace(lane_expression,'pg_catalog.pg_current_xact_id()','proof_xact');
  lane_expression:=replace(lane_expression,'auth.uid()','proof_actor');
  lane_expression:=replace(lane_expression,'p.id','proof_product');
  lane_expression:=replace(lane_expression,'command=''review_product''','proof_command=''review_product''');
  lane_expression:=pg_catalog.regexp_replace(lane_expression,'\mc\M','proof_context','g');
  if lane_expression ~ '(bx1_|auth\.|p\.)' then raise exception 'fund_base_review_proof_lane_extraction_incomplete';end if;
  for case_row in select value from pg_catalog.jsonb_array_elements($lane_cases$[
  {
    "name": "current exact lane",
    "allow": true
  },
  {
    "name": "no lane",
    "no_lane": true,
    "allow": false
  },
  {
    "name": "wrong transaction",
    "lane": {
      "transaction_id": "2"
    },
    "allow": false
  },
  {
    "name": "wrong actor",
    "lane": {
      "actor_id": "22222222-2222-4222-8222-222222222222"
    },
    "allow": false
  },
  {
    "name": "wrong key",
    "lane": {
      "request_key": "22222222-2222-4222-8222-222222222222"
    },
    "allow": false
  },
  {
    "name": "wrong product",
    "lane": {
      "product_id": "22222222-2222-4222-8222-222222222222"
    },
    "allow": false
  },
  {
    "name": "wrong action",
    "lane": {
      "action": "publish_product"
    },
    "allow": false
  },
  {
    "name": "wrong lane context",
    "lane": {
      "operating_context": {
        "mode": "ROLE",
        "organisationId": "22222222-2222-4222-8222-222222222222",
        "role": "ComplianceOfficer"
      }
    },
    "allow": false
  },
  {
    "name": "null lane key",
    "lane": {
      "request_key": null
    },
    "allow": false
  },
  {
    "name": "null lane context",
    "lane": {
      "operating_context": null
    },
    "allow": false
  },
  {
    "name": "null actor",
    "actor": null,
    "allow": false
  },
  {
    "name": "wrong command",
    "command": "publish_product",
    "allow": false
  },
  {
    "name": "null command",
    "command": null,
    "allow": false
  },
  {
    "name": "wrong role",
    "context": {
      "mode": "ROLE",
      "organisationId": "55555555-5555-4555-8555-555555555555",
      "role": "IssuerFundManager"
    },
    "allow": false
  },
  {
    "name": "null context",
    "context": null,
    "allow": false
  },
  {
    "name": "applicant context",
    "context": {
      "mode": "APPLICANT"
    },
    "allow": false
  },
  {
    "name": "MAIN environment",
    "environment": false,
    "allow": false
  },
  {
    "name": "null environment",
    "environment": null,
    "allow": false
  },
  {
    "name": "expired lane",
    "current": false,
    "allow": false
  },
  {
    "name": "null current lane",
    "current": null,
    "allow": false
  }
]$lane_cases$::jsonb) loop
    execute 'select '||lane_expression||' from (select $2::uuid proof_actor,$3::uuid proof_key,$4::uuid proof_product,$5::jsonb proof_context,$6::text proof_command,$7::boolean proof_environment,$8::boolean proof_current,$9::xid8 proof_xact) inputs'
      into outcome using (case when case_row->>'no_lane'='true' then null::jsonb else default_lane||coalesce(case_row->'lane','{}'::jsonb) end),
        (case when case_row ? 'actor' then (case_row->>'actor')::uuid else default_actor end),
        default_key,default_product,(case when case_row ? 'context' then case_row->'context' else default_context end),
        (case when case_row ? 'command' then case_row->>'command' else 'review_product' end),
        (case when case_row ? 'environment' then (case_row->>'environment')::boolean else true end),
        (case when case_row ? 'current' then (case_row->>'current')::boolean else true end),'1';
    if outcome is distinct from (case_row->>'allow')::boolean then
      raise exception 'fund_base_review_proof_lane_case_failed: %',case_row->>'name';end if;
    count_cases:=count_cases+1;
  end loop;
  if count_cases<>20 then raise exception 'fund_base_review_proof_lane_cases_missing';end if;
  -- Evaluate each ACTUAL particular-target identity alternative independently.
  -- Strict TRUE remains valid ordinarily; strict FALSE/NULL never acquires the
  -- new exception without total current-lane TRUE and that exact target=actor.
  for identity in select value from pg_catalog.jsonb_array_elements(identity_terms) loop
    if (length(source)-length(replace(source,identity->>'next','')))/length(identity->>'next')<>1 then
      raise exception 'fund_base_review_proof_identity_cut_not_unique';end if;
    identity_expression:=substring(source from strpos(source,identity->>'next') for length(identity->>'next'));
    identity_expression:=replace(identity_expression,identity->>'old','base_result');
    identity_expression:=replace(identity_expression,'same_operator_lane','lane_result');
    identity_expression:=replace(replace(identity_expression,'p.created_by','target_actor'),'o.owner_id','target_actor');
    identity_expression:=replace(identity_expression,'auth.uid()','actual_actor');
    for case_row in select value from pg_catalog.jsonb_array_elements($identity_cases$[{"base":false,"lane":true,"target":"11111111-1111-4111-8111-111111111111","actor":"11111111-1111-4111-8111-111111111111","allow":true},{"base":false,"lane":false,"target":"11111111-1111-4111-8111-111111111111","actor":"11111111-1111-4111-8111-111111111111","allow":false},{"base":false,"lane":null,"target":"11111111-1111-4111-8111-111111111111","actor":"11111111-1111-4111-8111-111111111111","allow":false},{"base":false,"lane":true,"target":"22222222-2222-4222-8222-222222222222","actor":"11111111-1111-4111-8111-111111111111","allow":false},{"base":false,"lane":true,"target":null,"actor":"11111111-1111-4111-8111-111111111111","allow":false},{"base":false,"lane":true,"target":"11111111-1111-4111-8111-111111111111","actor":null,"allow":false},{"base":null,"lane":false,"target":"11111111-1111-4111-8111-111111111111","actor":"11111111-1111-4111-8111-111111111111","allow":false},{"base":null,"lane":true,"target":"11111111-1111-4111-8111-111111111111","actor":"11111111-1111-4111-8111-111111111111","allow":true},{"base":true,"lane":false,"target":"22222222-2222-4222-8222-222222222222","actor":"11111111-1111-4111-8111-111111111111","allow":true}]$identity_cases$::jsonb) loop
      execute 'select ('||identity_expression||') is true from (select $1::boolean base_result,$2::boolean lane_result,$3::uuid target_actor,$4::uuid actual_actor) inputs'
        into outcome using (case_row->>'base')::boolean,(case_row->>'lane')::boolean,
          (case_row->>'target')::uuid,(case_row->>'actor')::uuid;
      if outcome is distinct from (case_row->>'allow')::boolean then raise exception 'fund_base_review_proof_identity_case_failed';end if;
    end loop;
  end loop;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'fund_base_review_proof_claims_changed';end if;
end $fund_base_review_proof$;
