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
  if (length(source)-length(replace(source,audit_new,'')))/length(audit_new)<>1 then
    raise exception 'fund_base_review_proof_truthful_audit_changed';end if;
  restored:=replace(replace(source,audit_new,audit_old),new_span,old_span);
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

-- Revision 2 persistence proof. All rows below are typed QUERY VALUES only.
-- It evaluates predicates extracted from the installed trigger/constraint;
-- it never invokes a business writer or sets actor/session claims.
do $fund_base_review_persistence_proof$
declare helper oid; metadata jsonb; trigger_source text; check_source text; part text;
  insert_input text; update_input text; reset_expression text; binding_expression text;
  tuple_expression text; history_expression text; transition_expression text; session_expression text;
  lane_query text; expression text; case_row jsonb; old_value jsonb; new_value jsonb;
  outcome boolean; binding_result boolean; tuple_result boolean; count_cases integer:=0;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  actor constant uuid:='11111111-1111-4111-8111-111111111111';
  other_actor constant uuid:='22222222-2222-4222-8222-222222222222';
  policy_id constant uuid:='33333333-3333-4333-8333-333333333333';
  product_id constant uuid:='44444444-4444-4444-8444-444444444444';
  organisation_id constant uuid:='55555555-5555-4555-8555-555555555555';
  offering_id constant uuid:='66666666-6666-4666-8666-666666666666';
  session_id constant uuid:='77777777-7777-4777-8777-777777777777';
  request_id constant uuid:='88888888-8888-4888-8888-888888888888';
  term_hash constant text:='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  baseline jsonb; historical jsonb; default_context jsonb; default_lane jsonb; default_policy jsonb; default_marker jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_base_review_persistence_proof_exact_test_owner_required';end if;
  helper:=pg_catalog.to_regprocedure('bx1_private.guard_product_test_review_provenance()');
  select pg_catalog.to_jsonb(p),p.prosrc into metadata,trigger_source from pg_catalog.pg_proc p where p.oid=helper;
  if helper is null or metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or metadata->'prosecdef' is distinct from 'true'::jsonb or metadata->>'provolatile' is distinct from 'v'
    or metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or metadata->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or metadata->>'pronargs' is distinct from '0' or metadata->>'prorettype' is distinct from 'trigger'::regtype::oid::text
    or metadata->>'prolang' is distinct from (select oid::text from pg_catalog.pg_language where lanname='plpgsql')
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(trigger_source,'UTF8')),'hex')
      is distinct from 'cecee253319a56d7a60f21893fb75c71f997ba85a1aacc039a51f5fe4fce823f' then
    raise exception 'fund_base_review_persistence_proof_trigger_changed';end if;
  if exists(select 1 from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where p.oid=helper and a.grantee<>p.proowner)
    or pg_catalog.has_function_privilege('anon',helper,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',helper,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',helper,'EXECUTE') then
    raise exception 'fund_base_review_persistence_proof_private_acl_changed';end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid='bx1_portal.products'::regclass
      and a.attnum in(19,20) and not a.attisdropped and not a.attnotnull and not a.atthasdef
      and a.attacl is null and a.attidentity='' and a.attgenerated=''
      and ((a.attnum=19 and a.attname='review_roleplay_policy_id' and a.atttypid='uuid'::regtype)
        or (a.attnum=20 and a.attname='review_roleplay_epoch' and a.atttypid='integer'::regtype)))<>2 then
    raise exception 'fund_base_review_persistence_proof_columns_changed';end if;
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='bx1_portal.products'::regclass
      and c.conname='bx1_product_test_review_policy_fk' and c.contype='f' and c.convalidated
      and c.confrelid='bx1_private.roleplay_policies'::regclass and c.conkey=array[19]::smallint[] and c.confkey=array[1]::smallint[]
      and not c.condeferrable and not c.condeferred and c.confupdtype='a' and c.confdeltype='r' and c.confmatchtype='s')
    or not exists(select 1 from pg_catalog.pg_index i
      where i.indexrelid=pg_catalog.to_regclass('bx1_portal.bx1_product_test_review_policy_idx')
        and i.indrelid='bx1_portal.products'::regclass and i.indisvalid and i.indisready and i.indislive
        and not i.indisunique and not i.indisprimary and i.indnkeyatts=1 and i.indnatts=1 and i.indkey::text='19'
        and pg_catalog.pg_get_expr(i.indpred,i.indrelid)='(review_roleplay_policy_id IS NOT NULL)')
    or not exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid='bx1_portal.products'::regclass
      and t.tgname='bx1_product_test_review_provenance' and t.tgfoid=helper and t.tgtype=23 and t.tgenabled='O'
      and not t.tgisinternal and t.tgconstraint=0 and t.tgqual is null and t.tgnargs=0 and t.tgargs=''::bytea) then
    raise exception 'fund_base_review_persistence_proof_schema_changed';end if;
  select pg_catalog.pg_get_expr(c.conbin,c.conrelid) into check_source from pg_catalog.pg_constraint c
    where c.conrelid='bx1_portal.products'::regclass and c.conname='products_check2'
      and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred;
  if check_source is distinct from '(((((reviewer_id IS NULL) OR (reviewer_id <> created_by)) AND (review_roleplay_policy_id IS NULL) AND (review_roleplay_epoch IS NULL)) OR ((reviewer_id IS NOT NULL) AND (reviewer_id = created_by) AND (review_roleplay_policy_id IS NOT NULL) AND (review_roleplay_epoch IS NOT NULL) AND (review_roleplay_epoch > 0))) IS TRUE)' then
    raise exception 'fund_base_review_persistence_proof_static_check_changed';end if;
  -- The CHECK proves shape/history only: never execute current auth or policy
  -- lookups when an existing reviewed product receives an unrelated update.
  if check_source ~* '(auth[.]|bx1_|current_setting|clock_timestamp|select)' then
    raise exception 'fund_base_review_persistence_proof_live_check_denied';end if;
  baseline:=pg_catalog.jsonb_build_object('id',product_id,'organisation_id',organisation_id,'created_by',actor,
    'revision',3,'status','IN_REVIEW','terms','{}'::jsonb,'terms_hash',term_hash,'current_offering_revision_id',offering_id,
    'reserved_units',0,'cap_units',100,'unit_price_minor',10000000,'minimum_units',1,
    'reviewer_id',null,'reviewed_at',null,'review_notes',null,'review_checks','{}'::jsonb,
    'review_roleplay_policy_id',null,'review_roleplay_epoch',null);
  historical:=baseline||pg_catalog.jsonb_build_object('reviewer_id',actor,'reviewed_at','2026-10-15T23:00:00Z',
    'review_notes','Fictional canonical review rationale.','review_checks','{"issuer":true,"terms":true,"disclosures":true,"eligibility":true}'::jsonb,
    'status','APPROVED','revision',4,'review_roleplay_policy_id',policy_id,'review_roleplay_epoch',2);
  for case_row in select value from pg_catalog.jsonb_array_elements($check_cases$[
    {"name":"unreviewed ordinary","patch":{},"allow":true},
    {"name":"independent ordinary","patch":{"reviewer_id":"22222222-2222-4222-8222-222222222222"},"allow":true},
    {"name":"untagged same operator","patch":{"reviewer_id":"11111111-1111-4111-8111-111111111111"},"allow":false},
    {"name":"complete historical TEST pair","historical":true,"patch":{},"allow":true},
    {"name":"policy only","historical":true,"patch":{"review_roleplay_epoch":null},"allow":false},
    {"name":"epoch only","historical":true,"patch":{"review_roleplay_policy_id":null},"allow":false},
    {"name":"zero epoch","historical":true,"patch":{"review_roleplay_epoch":0},"allow":false},
    {"name":"negative epoch","historical":true,"patch":{"review_roleplay_epoch":-1},"allow":false},
    {"name":"tag cannot label independent reviewer","historical":true,"patch":{"reviewer_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"tag cannot label null reviewer","historical":true,"patch":{"reviewer_id":null},"allow":false},
    {"name":"null creator cannot qualify","historical":true,"patch":{"created_by":null},"allow":false}
  ]$check_cases$::jsonb) loop
    execute 'select '||check_source||' from pg_catalog.jsonb_populate_record(null::bx1_portal.products,$1) value'
      into outcome using (case when case_row->>'historical'='true' then historical else baseline end)||(case_row->'patch');
    if outcome is distinct from (case_row->>'allow')::boolean then
      raise exception 'fund_base_review_persistence_proof_check_case_failed: %',case_row->>'name';end if;
    count_cases:=count_cases+1;
  end loop;
  if count_cases<>11 then raise exception 'fund_base_review_persistence_proof_check_cases_missing';end if;
  -- Extract exact branch expressions from the installed function, not a copied
  -- alternative implementation. All database/actor inputs below become values.
  part:=substring(trigger_source from strpos(trigger_source,'    if new.review_roleplay_policy_id')+length('    if '));
  insert_input:=substring(part from 1 for strpos(part,' then')-1);
  part:=substring(trigger_source from strpos(trigger_source,'  elsif new.review_roleplay_policy_id')+length('  elsif '));
  update_input:=substring(part from 1 for strpos(part,' then')-1);
  part:=substring(trigger_source from strpos(trigger_source,'  if new.reviewer_id is null')+length('  if '));
  reset_expression:=substring(part from 1 for strpos(part,' then')-1);
  part:=substring(trigger_source from strpos(trigger_source,'    binding_same:=')+length('    binding_same:='));
  binding_expression:=substring(part from 1 for strpos(part,';')-1);
  part:=substring(trigger_source from strpos(trigger_source,'    review_tuple_same:=')+length('    review_tuple_same:='));
  tuple_expression:=substring(part from 1 for strpos(part,';')-1);
  part:=substring(trigger_source from strpos(trigger_source,'    if binding_same is true')+length('    if '));
  history_expression:=substring(part from 1 for strpos(part,' then')-1);
  part:=substring(trigger_source from strpos(trigger_source,'  if tg_op<>')+length('  if '));
  transition_expression:=substring(part from 1 for strpos(part,' then')-1);
  part:=substring(trigger_source from strpos(trigger_source,'  if auth.uid() is null')+length('  if '));
  session_expression:=substring(part from 1 for strpos(part,' then')-1);
  if insert_input='' or update_input='' or reset_expression='' or binding_expression='' or tuple_expression=''
    or history_expression='' or transition_expression='' or session_expression=''
    or strpos(trigger_source,'product_test_review_provenance_input_denied')>strpos(trigger_source,'new.review_roleplay_policy_id:=null')
    or strpos(trigger_source,'if binding_same is true')>strpos(trigger_source,'product_test_review_session_denied')
    or strpos(trigger_source,'product_test_review_session_denied')>strpos(trigger_source,'select lane.* into strict review_lane')
    or strpos(trigger_source,'new.review_roleplay_policy_id:=review_lane.policy_id;')<=0
    or strpos(trigger_source,'new.review_roleplay_epoch:=review_lane.authority_epoch;')<=0 then
    raise exception 'fund_base_review_persistence_proof_branch_order_changed';end if;
  for case_row in select value from pg_catalog.jsonb_array_elements($branch_cases$[
    {"name":"ordinary insert absent markers","predicate":"insert","patch":{},"allow":false},
    {"name":"injected insert policy","predicate":"insert","patch":{"review_roleplay_policy_id":"33333333-3333-4333-8333-333333333333"},"allow":true},
    {"name":"unchanged caller markers","predicate":"input","historical":true,"patch":{},"allow":false},
    {"name":"relabel policy","predicate":"input","historical":true,"patch":{"review_roleplay_policy_id":"22222222-2222-4222-8222-222222222222"},"allow":true},
    {"name":"relabel epoch","predicate":"input","historical":true,"patch":{"review_roleplay_epoch":3},"allow":true},
    {"name":"caller cannot clear first","predicate":"input","historical":true,"patch":{"review_roleplay_policy_id":null,"review_roleplay_epoch":null},"allow":true},
    {"name":"null reviewer clears internally","predicate":"reset","historical":true,"patch":{"reviewer_id":null},"allow":true},
    {"name":"independent review clears internally","predicate":"reset","historical":true,"patch":{"reviewer_id":"22222222-2222-4222-8222-222222222222"},"allow":true},
    {"name":"same reviewer not reset","predicate":"reset","historical":true,"patch":{},"allow":false},
    {"name":"reserved units keep history","predicate":"history","historical":true,"patch":{"reserved_units":1},"allow":true},
    {"name":"publication keeps history","predicate":"history","historical":true,"patch":{"status":"PUBLISHED","revision":5},"allow":true},
    {"name":"internal status keeps history","predicate":"history","historical":true,"patch":{"status":"IN_REVIEW"},"allow":true},
    {"name":"changed notes need fresh review","predicate":"history","historical":true,"patch":{"review_notes":"Changed fictional review rationale."},"allow":false},
    {"name":"changed checks need fresh review","predicate":"history","historical":true,"patch":{"review_checks":{}},"allow":false},
    {"name":"changed timestamp needs fresh review","predicate":"history","historical":true,"patch":{"reviewed_at":"2026-10-15T23:01:00Z"},"allow":false},
    {"name":"terms do not carry history","predicate":"history","historical":true,"patch":{"terms":{"changed":true}},"allow":false},
    {"name":"package does not carry history","predicate":"history","historical":true,"patch":{"current_offering_revision_id":null},"allow":false},
    {"name":"fresh approved transition","predicate":"transition","fresh":true,"patch":{},"allow":false},
    {"name":"fresh changes transition","predicate":"transition","fresh":true,"patch":{"status":"CHANGES_REQUIRED"},"allow":false},
    {"name":"insert self review denied","predicate":"transition","fresh":true,"operation":"INSERT","patch":{},"allow":true},
    {"name":"old approved cannot fresh review","predicate":"transition","fresh":true,"old_patch":{"status":"APPROVED"},"patch":{},"allow":true},
    {"name":"revision must increment once","predicate":"transition","fresh":true,"patch":{"revision":5},"allow":true},
    {"name":"published is not review transition","predicate":"transition","fresh":true,"patch":{"status":"PUBLISHED"},"allow":true},
    {"name":"changed binding denied","predicate":"transition","fresh":true,"patch":{"terms_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"allow":true},
    {"name":"missing review time denied","predicate":"transition","fresh":true,"patch":{"reviewed_at":null},"allow":true},
    {"name":"genuine protected actor session","predicate":"session","fresh":true,"patch":{},"allow":false},
    {"name":"no actor denied","predicate":"session","fresh":true,"actor":null,"patch":{},"allow":true},
    {"name":"wrong actor denied","predicate":"session","fresh":true,"actor":"22222222-2222-4222-8222-222222222222","patch":{},"allow":true},
    {"name":"MAIN denied","predicate":"session","fresh":true,"environment":false,"patch":{},"allow":true},
    {"name":"unprotected session denied","predicate":"session","fresh":true,"protected":false,"patch":{},"allow":true},
    {"name":"unknown protection denied","predicate":"session","fresh":true,"protected":null,"patch":{},"allow":true}
  ]$branch_cases$::jsonb) loop
    old_value:=(case when case_row->>'historical'='true' then historical else baseline end)||coalesce(case_row->'old_patch','{}'::jsonb);
    new_value:=(case when case_row->>'fresh'='true' then historical||'{"review_roleplay_policy_id":null,"review_roleplay_epoch":null}'::jsonb else old_value end)||(case_row->'patch');
    expression:=pg_catalog.regexp_replace(pg_catalog.regexp_replace(binding_expression,'\mnew[.]','proof_new.','gi'),'\mold[.]','proof_old.','gi');
    execute 'select '||expression||' from pg_catalog.jsonb_populate_record(null::bx1_portal.products,$1) proof_new cross join pg_catalog.jsonb_populate_record(null::bx1_portal.products,$2) proof_old'
      into binding_result using new_value,old_value;
    expression:=pg_catalog.regexp_replace(pg_catalog.regexp_replace(tuple_expression,'\mnew[.]','proof_new.','gi'),'\mold[.]','proof_old.','gi');
    execute 'select '||expression||' from pg_catalog.jsonb_populate_record(null::bx1_portal.products,$1) proof_new cross join pg_catalog.jsonb_populate_record(null::bx1_portal.products,$2) proof_old'
      into tuple_result using new_value,old_value;
    expression:=case case_row->>'predicate' when 'insert' then insert_input when 'input' then update_input when 'reset' then reset_expression
      when 'history' then history_expression when 'transition' then transition_expression when 'session' then session_expression end;
    expression:=replace(replace(expression,'bx1_private.test_roleplay_environment()','proof_environment'),'bx1_private.test_roleplay_protected_session()','proof_protected');
    expression:=replace(expression,'auth.uid()','proof_actor');
    expression:=pg_catalog.regexp_replace(pg_catalog.regexp_replace(expression,'\mnew[.]','proof_new.','gi'),'\mold[.]','proof_old.','gi');
    if expression is null or expression ~ '(bx1_private[.]|auth[.])' then raise exception 'fund_base_review_persistence_proof_branch_extraction_incomplete';end if;
    execute 'select ('||expression||') is true from pg_catalog.jsonb_populate_record(null::bx1_portal.products,$1) proof_new cross join pg_catalog.jsonb_populate_record(null::bx1_portal.products,$2) proof_old cross join (select $3::boolean binding_same,$4::boolean review_tuple_same,$5::text tg_op,$6::uuid proof_actor,$7::boolean proof_environment,$8::boolean proof_protected) inputs'
      into outcome using new_value,old_value,binding_result,tuple_result,coalesce(case_row->>'operation','UPDATE'),
        (case when case_row ? 'actor' then (case_row->>'actor')::uuid else actor end),
        (case when case_row ? 'environment' then (case_row->>'environment')::boolean else true end),
        (case when case_row ? 'protected' then (case_row->>'protected')::boolean else true end);
    if outcome is distinct from (case_row->>'allow')::boolean then
      raise exception 'fund_base_review_persistence_proof_branch_case_failed: %',case_row->>'name';end if;
  end loop;
  -- The exact SELECT ... INTO STRICT lane query becomes an EXISTS over values.
  -- This preserves both joins, the actual session/key/context marker and the
  -- two mandatory post-wait current-lane calls, with no live business records.
  part:=substring(trigger_source from strpos(trigger_source,'    select lane.* into strict review_lane'));
  lane_query:=substring(part from 1 for strpos(part,';')-1);
  lane_query:=replace(lane_query,'select lane.* into strict review_lane','select lane.*');
  lane_query:=replace(lane_query,'bx1_private.fund_roleplay_command_lanes lane',
    'pg_catalog.jsonb_to_record($1) as lane(transaction_id xid8,actor_id uuid,policy_id uuid,authority_epoch integer,product_id uuid,offering_revision_id uuid,operating_context jsonb,action text,request_key uuid)');
  lane_query:=replace(lane_query,'bx1_private.roleplay_policies policy',
    'pg_catalog.jsonb_to_record($2) as policy(id uuid,authority_epoch integer,product_id uuid,offering_revision_id uuid,environment text,project_ref text,assurance text,independence_proven boolean,product_organisation_id uuid,terms_hash text,native_organisation_id uuid)');
  lane_query:=replace(lane_query,'bx1_private.test_workspace_product_commands marker',
    'pg_catalog.jsonb_to_record($3) as marker(transaction_id xid8,actor_id uuid,session_id uuid,request_key uuid,operating_context jsonb,product_organisation_id uuid,target_product_id uuid,command text)');
  lane_query:=replace(lane_query,'bx1_portal.test_offering_lane_current(lane.operating_context,new.id,lane.request_key,''review_product'')','proof_legacy_current');
  lane_query:=replace(lane_query,'bx1_private.fund_roleplay_lane_current(lane.operating_context,new.id,''review_product'')','proof_fund_current');
  lane_query:=replace(lane_query,'auth.jwt()->>''session_id''','proof_session::text');
  lane_query:=replace(lane_query,'auth.uid()','proof_actor');
  lane_query:=replace(lane_query,'pg_catalog.pg_current_xact_id()','proof_xact');
  lane_query:=pg_catalog.regexp_replace(lane_query,'\mnew[.]','proof_new.','gi');
  if lane_query ~ '(bx1_private[.]|bx1_portal[.]|auth[.]|into strict)' then
    raise exception 'fund_base_review_persistence_proof_lane_extraction_incomplete';end if;
  default_context:=pg_catalog.jsonb_build_object('mode','ROLE','organisationId',organisation_id,'role','ComplianceOfficer');
  default_lane:=pg_catalog.jsonb_build_object('transaction_id','1','actor_id',actor,'policy_id',policy_id,'authority_epoch',2,
    'product_id',product_id,'offering_revision_id',offering_id,'operating_context',default_context,'action','review_product','request_key',request_id);
  default_policy:=pg_catalog.jsonb_build_object('id',policy_id,'authority_epoch',2,'product_id',product_id,'offering_revision_id',offering_id,
    'environment','TESTNET','project_ref','fegnnnlseuejkrusbbkv','assurance','TEST_ROLE_PLAY','independence_proven',false,
    'product_organisation_id',organisation_id,'terms_hash',term_hash,'native_organisation_id',organisation_id);
  default_marker:=pg_catalog.jsonb_build_object('transaction_id','1','actor_id',actor,'session_id',session_id,'request_key',request_id,
    'operating_context',default_context,'product_organisation_id',organisation_id,'target_product_id',product_id,'command','review_product');
  count_cases:=0;
  for case_row in select value from pg_catalog.jsonb_array_elements($provenance_lane_cases$[
    {"name":"exact canonical lane","allow":true},
    {"name":"missing fund lane","lane":null,"allow":false},
    {"name":"wrong transaction","lane":{"transaction_id":"2"},"allow":false},
    {"name":"wrong actor","lane":{"actor_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong product","lane":{"product_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong offering","lane":{"offering_revision_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong action","lane":{"action":"publish_product"},"allow":false},
    {"name":"wrong role","lane":{"operating_context":{"mode":"ROLE","organisationId":"55555555-5555-4555-8555-555555555555","role":"IssuerFundManager"}},"allow":false},
    {"name":"wrong mode","lane":{"operating_context":{"mode":"APPLICANT"}},"allow":false},
    {"name":"wrong original policy","policy":{"id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong epoch","policy":{"authority_epoch":3},"allow":false},
    {"name":"wrong policy organisation","policy":{"product_organisation_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong policy terms","policy":{"terms_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"allow":false},
    {"name":"wrong native context","policy":{"native_organisation_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"MAIN policy","policy":{"environment":"MAINNET"},"allow":false},
    {"name":"wrong project","policy":{"project_ref":"oqkevkjbkpugjotihtda"},"allow":false},
    {"name":"wrong assurance","policy":{"assurance":"STANDARD"},"allow":false},
    {"name":"false independence claim","policy":{"independence_proven":true},"allow":false},
    {"name":"unknown independence","policy":{"independence_proven":null},"allow":false},
    {"name":"missing canonical marker","marker":null,"allow":false},
    {"name":"wrong marker session","marker":{"session_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong marker key","marker":{"request_key":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong marker context","marker":{"operating_context":{"mode":"APPLICANT"}},"allow":false},
    {"name":"wrong marker product","marker":{"target_product_id":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"name":"wrong marker action","marker":{"command":"publish_product"},"allow":false},
    {"name":"expired or revoked fund lane","fund_current":false,"allow":false},
    {"name":"unknown fund lane","fund_current":null,"allow":false},
    {"name":"source withdrawn","legacy_current":false,"allow":false},
    {"name":"unknown source lane","legacy_current":null,"allow":false},
    {"name":"null actual actor","actor":null,"allow":false},
    {"name":"null actual session","session":null,"allow":false}
  ]$provenance_lane_cases$::jsonb) loop
    execute 'select exists('||lane_query||') from pg_catalog.jsonb_populate_record(null::bx1_portal.products,$4) proof_new cross join (select $5::uuid proof_actor,$6::uuid proof_session,$7::xid8 proof_xact,$8::boolean proof_legacy_current,$9::boolean proof_fund_current) inputs'
      into outcome using
        (case when case_row ? 'lane' and case_row->'lane'='null'::jsonb then null::jsonb else default_lane||coalesce(case_row->'lane','{}'::jsonb) end),
        (case when case_row ? 'policy' and case_row->'policy'='null'::jsonb then null::jsonb else default_policy||coalesce(case_row->'policy','{}'::jsonb) end),
        (case when case_row ? 'marker' and case_row->'marker'='null'::jsonb then null::jsonb else default_marker||coalesce(case_row->'marker','{}'::jsonb) end),historical,
        (case when case_row ? 'actor' then (case_row->>'actor')::uuid else actor end),
        (case when case_row ? 'session' then (case_row->>'session')::uuid else session_id end),'1',
        (case when case_row ? 'legacy_current' then (case_row->>'legacy_current')::boolean else true end),
        (case when case_row ? 'fund_current' then (case_row->>'fund_current')::boolean else true end);
    if outcome is distinct from (case_row->>'allow')::boolean then
      raise exception 'fund_base_review_persistence_proof_lane_case_failed: %',case_row->>'name';end if;
    count_cases:=count_cases+1;
  end loop;
  if count_cases<>31 then raise exception 'fund_base_review_persistence_proof_lane_cases_missing';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from before_claims
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from before_sub then
    raise exception 'fund_base_review_persistence_proof_claims_changed';end if;
end $fund_base_review_persistence_proof$;
