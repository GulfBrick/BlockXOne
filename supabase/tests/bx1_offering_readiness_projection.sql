-- Query-only proof after the exact TEST readiness installer.
-- No business row, actor, session, JWT, transaction or positive authority call.
do $offering_readiness_projection_proof$
declare
  spec constant jsonb:=$readiness_projection_proof_spec${"targets":[{"oid":25750,"signature":"bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)","sha":"3af34c6fb9b6e51b37d6fdfbf25193f5c079d430f002a5d02186444ee917fe1e","metadata":{"oid":"25750","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_package_projection_pre_appointment","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"cuts":[{"name":"tagged_readiness","from":"is_ready:=bx1_portal.offering_operational(p.id);","to":"is_ready:=case when p.review_roleplay_policy_id is not null then\n    bx1_private.fund_roleplay_investor_operational(p.id,p.review_roleplay_policy_id,p.review_roleplay_epoch)\n    else bx1_portal.offering_operational(p.id) end;","count":1},{"name":"readiness_status","from":"'technical_readiness_status','NOT_VERIFIED'","to":"'technical_readiness_status',case when is_ready is true then 'VERIFIED' else 'NOT_VERIFIED' end","count":1}]},{"oid":29607,"signature":"bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)","sha":"d537cf85b5b4ee8488c14cb5a30df9693ee36ccad9d264a5afe385e34125c6a5","metadata":{"oid":"29607","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_package_projection_base","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0},"cuts":[{"name":"readiness_status","from":"'technical_readiness_status','NOT_VERIFIED'","to":"'technical_readiness_status',case when is_ready is true then 'VERIFIED' else 'NOT_VERIFIED' end","count":1}]}],"dependencies":[{"oid":24445,"signature":"bx1_portal.scoped_product_visible(c jsonb, target_product uuid)","sha":"aae37383f7c663145184e57759decb5e48cde198e486b66e975771c1319587fc","metadata":{"oid":"24445","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"scoped_product_visible","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":25732,"signature":"bx1_portal.offering_technical_ready(target_revision uuid)","sha":"0471d8bcfce0ce89bc0ddd2e99e7e953e9ca3e2b26d0905156c366f2aa1f0049","metadata":{"oid":"25732","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_technical_ready","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_revision"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":25733,"signature":"bx1_portal.offering_approved(target_product uuid)","sha":"ab18307440fc29e6554dad3fc8051a394b10a6c15e1bcd823529094012c67d06","metadata":{"oid":"25733","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_approved","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_product"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":25734,"signature":"bx1_portal.offering_operational(target_product uuid)","sha":"c69b7a977c41ff96e6f84b0fd83ed5f20baf4e8abb5cc5d6977263690177195d","metadata":{"oid":"25734","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_operational","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_product"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":25738,"signature":"bx1_portal.guard_offering_publication()","sha":"e84f699363ca160e1fba2d91acd6a3c70e1188111177c54a37357ba60d8b169d","metadata":{"oid":"25738","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"guard_offering_publication","prorows":0,"pronargs":0,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":false,"prorettype":"2279","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":null,"proargtypes":[],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":25751,"signature":"bx1_portal.offering_history_projection(target_product uuid)","sha":"4b2cf0aac6c0ea150dccabffb2959dd5b79610720389f04638875ca028bf4f8c","metadata":{"oid":"25751","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_history_projection","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_product"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":26608,"signature":"bx1_portal.offering_package_projection(c jsonb, target_product uuid)","sha":"337d15fce325fdec0fa43ecd7655430cfb1026844e82fcbe859f5385ef2bcf78","metadata":{"oid":"26608","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_package_projection","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":29608,"signature":"bx1_portal.offering_workflow_package_projection(c jsonb, target_product uuid)","sha":"575de24944154c7e4942345191731e89a2735ef3ff31772670508007b97640bd","metadata":{"oid":"29608","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_package_projection","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":30039,"signature":"bx1_private.offering_document_evidence_summary(target_revision uuid)","sha":"f3099226386e444b7b640427f9ab89a9f1d11e4c7c0910798475f0e98a61d954","metadata":{"oid":"30039","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"offering_document_evidence_summary","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target_revision"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"s","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":30335,"signature":"bx1_portal.offering_workflow_read_scoped_pre_test_workspace(c jsonb)","sha":"d25a8baf9e630915ef2df083f152389c4378610a2bc9af2c66ef58db04c6e0c3","metadata":{"oid":"30335","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"13619","proname":"offering_workflow_read_scoped_pre_test_workspace","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"3802","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c"],"proargtypes":["3802"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":30781,"signature":"bx1_portal.test_offering_product_visible(c jsonb, target_product uuid)","sha":"48e33189de3bc05eb43e1ca8ad899ec20ac0ca03a04af42fd4b7c7bfeec44b47","metadata":{"oid":"30781","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"test_offering_product_visible","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","target_product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":31496,"signature":"bx1_portal.fund_manifest_current(target uuid)","sha":"26dbb6c888477ed403b3317ee6e73d387d6f2e0ee8dc0429084996169f92de4a","metadata":{"oid":"31496","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_manifest_current","prorows":0,"pronargs":1,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["target"],"proargtypes":["2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"24138","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":37285,"signature":"bx1_private.fund_roleplay_eligibility_product_visible(c jsonb, product uuid)","sha":"c400f96d6c15136cfe91da5de2f18de799667dd58092f0ddde5a23bb3d154130","metadata":{"oid":"37285","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_eligibility_product_visible","prorows":0,"pronargs":2,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["c","product"],"proargtypes":["3802","2950"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"oid":38341,"signature":"bx1_private.fund_roleplay_investor_operational(p_product uuid, p_policy uuid, p_epoch integer)","sha":"5107b4e646af2cea44a7597c487f6c79616512e0556ce463f66972a1308afc4a","metadata":{"oid":"38341","proacl":["postgres=X/postgres"],"probin":null,"procost":100,"prokind":"f","prolang":"14","proname":"fund_roleplay_investor_operational","prorows":0,"pronargs":3,"proowner":"16388","proconfig":["search_path=\"\""],"proretset":false,"prosecdef":true,"prorettype":"16","prosqlbody":null,"prosupport":"-","proargmodes":null,"proargnames":["p_product","p_policy","p_epoch"],"proargtypes":["2950","2950","23"],"proisstrict":false,"proparallel":"u","protrftypes":null,"provariadic":"0","provolatile":"v","proleakproof":false,"pronamespace":"22414","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}],"fragments":{"tagged":"is_ready:=case when p.review_roleplay_policy_id is not null then\n    bx1_private.fund_roleplay_investor_operational(p.id,p.review_roleplay_policy_id,p.review_roleplay_epoch)\n    else bx1_portal.offering_operational(p.id) end;","ordinary":"is_ready:=bx1_portal.offering_operational(p.id);","label":"'technical_readiness_status',case when is_ready is true then 'VERIFIED' else 'NOT_VERIFIED' end","finalFence":"coalesce(bx1_portal.offering_workflow_package_projection(c,(value->>'id')::uuid),'null'::jsonb)\n          is distinct from value->'offering_package'"}}$readiness_projection_proof_spec$::jsonb;
  target_spec jsonb; dependency jsonb; cut jsonb; metadata jsonb;
  installed text; original text; rebuilt text; old_rhs text; new_rhs text; label_rhs text;
  old_publish text; new_publish text; old_subscribe text; new_subscribe text;
  old_label text; query_text text; reader_body text; fresh_fence text; phase_case jsonb;
  tagged boolean; roleplay_current boolean; ordinary_current boolean; supplied_ready boolean; product_status text;
  old_ready boolean; new_ready boolean; expected_ready boolean; old_value jsonb; new_value jsonb; denied boolean;
  branch_cases integer:=0; field_cases integer:=0; total_cuts integer:=0;
  claims_before text:=pg_catalog.current_setting('request.jwt.claims',true);
  sub_before text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'offering_readiness_proof_owner_without_claims_required' using errcode='42501';end if;
  if jsonb_array_length(spec->'targets')<>2 or jsonb_array_length(spec->'dependencies')<>14 then
    raise exception 'offering_readiness_proof_scope_changed';end if;
  for dependency in select value from jsonb_array_elements(spec->'dependencies') loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(dependency->>'oid')::oid;
    if metadata is null or metadata-'prosrc' is distinct from dependency->'metadata'
      or encode(sha256(convert_to(metadata->>'prosrc','UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'offering_readiness_proof_dependency_changed: %',dependency->>'oid';end if;
  end loop;
  for target_spec in select value from jsonb_array_elements(spec->'targets') loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata is null or metadata-'prosrc' is distinct from target_spec->'metadata' then
      raise exception 'offering_readiness_proof_target_metadata_changed';end if;
    installed:=metadata->>'prosrc';original:=installed;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
      if (length(original)-length(replace(original,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'offering_readiness_proof_reverse_cut_not_unique';end if;
      original:=replace(original,cut->>'to',cut->>'from');total_cuts:=total_cuts+1;
    end loop;
    if encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from target_spec->>'sha' then
      raise exception 'offering_readiness_proof_inverse_changed';end if;
    rebuilt:=original;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') loop
      if (length(rebuilt)-length(replace(rebuilt,cut->>'from','')))/length(cut->>'from')<>1 then
        raise exception 'offering_readiness_proof_forward_cut_not_unique';end if;
      rebuilt:=replace(rebuilt,cut->>'from',cut->>'to');
    end loop;
    if rebuilt is distinct from installed then raise exception 'offering_readiness_proof_rebuild_changed';end if;

    -- Execute only the actual extracted assignment with typed stand-ins for
    -- existing read-helper results. Tagged false/NULL MUST NOT fall back.
    old_rhs:=split_part(split_part(original,'is_ready:=',2),';',1);
    new_rhs:=split_part(split_part(installed,'is_ready:=',2),';',1);
    if old_rhs='' or new_rhs='' then raise exception 'offering_readiness_proof_assignment_missing';end if;
    old_rhs:=replace(old_rhs,'bx1_portal.offering_operational(p.id)','$3::boolean');
    new_rhs:=replace(new_rhs,'bx1_portal.offering_operational(p.id)','$3::boolean');
    new_rhs:=replace(new_rhs,'p.review_roleplay_policy_id is not null','$1::boolean');
    new_rhs:=replace(new_rhs,'bx1_private.fund_roleplay_investor_operational(p.id,p.review_roleplay_policy_id,p.review_roleplay_epoch)','$2::boolean');
    old_rhs:=replace(old_rhs,'bx1_portal.offering_technical_ready(r.id)','$2::boolean');
    new_rhs:=replace(new_rhs,'bx1_portal.offering_technical_ready(r.id)','$2::boolean');
    if old_rhs like '%bx1_%' or new_rhs like '%bx1_%' or new_rhs like '%p.%' or new_rhs like '%r.%' then
      raise exception 'offering_readiness_proof_unreplaced_assignment';end if;
    for tagged in select value from (values(false),(true),(null::boolean)) inputs(value) loop
      for roleplay_current in select value from (values(false),(true),(null::boolean)) inputs(value) loop
        for ordinary_current in select value from (values(false),(true),(null::boolean)) inputs(value) loop
          execute 'select '||old_rhs into old_ready using tagged,roleplay_current,ordinary_current;
          execute 'select '||new_rhs into new_ready using tagged,roleplay_current,ordinary_current;
          expected_ready:=case when target_spec->>'oid'='25750'
            then case when tagged is true then roleplay_current else ordinary_current end
            else roleplay_current is true end;
          if new_ready is distinct from expected_ready
            or ((target_spec->>'oid'<>'25750' or tagged is not true) and new_ready is distinct from old_ready)
            or (target_spec->>'oid'='25750' and tagged is true and roleplay_current is not true
              and new_ready is true) then
            raise exception 'offering_readiness_proof_tagged_or_ordinary_branch_changed';end if;
          branch_cases:=branch_cases+1;
        end loop;
      end loop;
    end loop;

    -- Project the actual label and unchanged publishing/subscribing expressions.
    -- This tests display only: no command or claim of a ready fund is executed.
    old_label:=split_part(split_part(original,'''technical_readiness_status'',',2),E',\n    ''status'',',1);
    label_rhs:=split_part(split_part(installed,'''technical_readiness_status'',',2),E',\n    ''status'',',1);
    old_publish:=split_part(split_part(original,'''publishable'',',2),E',\n    ''subscribable'',',1);
    new_publish:=split_part(split_part(installed,'''publishable'',',2),E',\n    ''subscribable'',',1);
    old_subscribe:=split_part(split_part(original,'''subscribable'',',2),') || case',1);
    new_subscribe:=split_part(split_part(installed,'''subscribable'',',2),') || case',1);
    if old_label is distinct from '''NOT_VERIFIED''' or label_rhs=''
      or old_publish='' or old_subscribe='' or new_publish is distinct from old_publish
      or new_subscribe is distinct from old_subscribe then
      raise exception 'offering_readiness_proof_unchanged_action_expression_missing';end if;
    query_text:='select jsonb_build_object(''technical_readiness_status'','||old_label
      ||',''publishable'','||old_publish||',''subscribable'','||old_subscribe||'),'
      ||'jsonb_build_object(''technical_readiness_status'','||label_rhs
      ||',''publishable'','||new_publish||',''subscribable'','||new_subscribe||')';
    query_text:=replace(replace(query_text,'p.status','$2::text'),'is_ready','$1::boolean');
    if query_text like '%bx1_%' or query_text like '%p.%' then
      raise exception 'offering_readiness_proof_unreplaced_display_expression';end if;
    for supplied_ready in select value from (values(false),(true),(null::boolean)) inputs(value) loop
      for product_status in select value from (values('DRAFT'::text),('IN_REVIEW'),('CHANGES_REQUIRED'),('APPROVED'),('PUBLISHED'),(null::text)) inputs(value) loop
        execute query_text into old_value,new_value using supplied_ready,product_status;
        if old_value-'technical_readiness_status' is distinct from new_value-'technical_readiness_status'
          or new_value->>'technical_readiness_status' is distinct from
            (case when supplied_ready is true then 'VERIFIED' else 'NOT_VERIFIED' end)
          or (supplied_ready is not true and new_value->>'technical_readiness_status'='VERIFIED') then
          raise exception 'offering_readiness_proof_display_truth_or_actions_changed';end if;
        field_cases:=field_cases+1;
      end loop;
    end loop;
  end loop;
  if total_cuts<>3 or branch_cases<>54 or field_cases<>36 then
    raise exception 'offering_readiness_proof_cases_missing';end if;
  -- A fresh final invocation still observes policy/readiness withdrawal, rather
  -- than reusing an initial true value. Pin and extract the existing comparison.
  select p.prosrc into reader_body from pg_catalog.pg_proc p where p.oid=30335;
  fresh_fence:=spec#>>'{fragments,finalFence}';
  if strpos(reader_body,fresh_fence)=0 then raise exception 'offering_readiness_proof_fresh_fence_missing';end if;
  fresh_fence:=replace(fresh_fence,'bx1_portal.offering_workflow_package_projection(c,(value->>''id'')::uuid)','$1::jsonb');
  fresh_fence:=replace(fresh_fence,'value->''offering_package''','$2::jsonb');
  if fresh_fence like '%bx1_%' then raise exception 'offering_readiness_proof_native_fence_call_remaining';end if;
  for phase_case in select value from jsonb_array_elements($readiness_projection_fresh_cases$[
    {"initial":{"technical_readiness_status":"VERIFIED","subscribable":true},"final":{"technical_readiness_status":"VERIFIED","subscribable":true},"denied":false},
    {"initial":{"technical_readiness_status":"VERIFIED","subscribable":true},"final":{"technical_readiness_status":"NOT_VERIFIED","subscribable":false},"denied":true},
    {"initial":{"technical_readiness_status":"VERIFIED","subscribable":true},"denied":true}
  ]$readiness_projection_fresh_cases$::jsonb) loop
    execute 'select '||fresh_fence into denied using phase_case->'final',phase_case->'initial';
    if denied is distinct from (phase_case->>'denied')::boolean then
      raise exception 'offering_readiness_proof_late_withdrawal_not_denied';end if;
  end loop;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims_before
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'offering_readiness_proof_claims_changed';end if;
end $offering_readiness_projection_proof$;
