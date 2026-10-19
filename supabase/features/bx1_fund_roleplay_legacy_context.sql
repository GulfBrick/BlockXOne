-- Exact TEST fund-policy compatibility at three retained preparation-source
-- boundaries. Original preparation provenance is not a live professional role;
-- neither it nor historical source stamps are rewritten by this feature.
-- Only the current private command lane can add the explicitly simulated
-- same-operator continuation. MAIN and ordinary/legacy paths remain unchanged.
-- Apply as one owner transaction after the retained manager/command features.

do $fund_roleplay_legacy_context$
declare spec jsonb; dependency jsonb; cut jsonb; target oid; before_row jsonb; after_row jsonb;
  snapshots jsonb:='{}'::jsonb; original text; normalized text; next_body text; restored text; definition text;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)","sha":"e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177"},
    {"signature":"bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)","sha":"643ccda96e4c99f3b22082beab45bf7fe4135e15d3bbf78c296ef627c13bb6a3"},
    {"signature":"bx1_private.fund_roleplay_manager_publish_lane(uuid,uuid,jsonb)","sha":"261f4c1c7df4a400e51445ee0f0386cdd21d10c75fada9fd4ba8c1eea191338a"},
    {"signature":"bx1_private.fund_roleplay_review_exception(jsonb,uuid,text)","sha":"338b95433ed8b43f06d06b5a9b891a3534c4a4af527bf72c7196e1f4bd3e1b2d"},
    {"signature":"bx1_portal.test_offering_lock_source(uuid,uuid,integer)","sha":"325dfc7afc9c2df454125b1da47767000c1c78fa31bb32fe74c7d8e67e521106"}
  ]$dependencies$::jsonb;
  specs constant jsonb:=$specs$[
    {
      "signature":"bx1_portal.test_offering_lane_current(jsonb,uuid,uuid,text)",
      "sha":"bdaca8d9835ac8d58879ef4d0605d2dac9819475672d9619b6a1d50e79e8ec23",
      "language":"sql","result":"boolean","argnames":["c","target_product","key","action"],
      "changes":[{
        "from":"bx1_portal.test_offering_context(c)",
        "to":"(bx1_portal.test_offering_context(c) or (c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n    and action='request_product_service_appointment'\n    and bx1_private.fund_roleplay_manager_current(c,target_product,action) is true\n    and bx1_private.fund_roleplay_lane_current(c,target_product,action) is true\n    and exists(select 1 from bx1_private.fund_roleplay_command_lanes fund_lane\n      where fund_lane.transaction_id=pg_catalog.pg_current_xact_id() and fund_lane.actor_id=auth.uid()\n        and fund_lane.product_id=test_offering_lane_current.target_product\n        and fund_lane.operating_context=test_offering_lane_current.c\n        and fund_lane.action=test_offering_lane_current.action\n        and fund_lane.request_key=test_offering_lane_current.key)))"
      }]
    },
    {
      "signature":"bx1_portal.test_offering_review_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)",
      "sha":"5b6cb07e393c5c170e3d18fadb27273731c28d0b35ee202ec1df7ab372d111d5",
      "language":"plpgsql","result":"void",
      "argnames":["new_id","new_org","new_creator","new_status","new_revision","old_org","old_creator","old_status","old_revision","operation"],
      "changes":[{
        "from":"bx1_portal.offering_workflow_people_independent(auth.uid(),new_creator)",
        "to":"(bx1_portal.offering_workflow_people_independent(auth.uid(),new_creator)\n      or (new_creator=auth.uid()\n        and bx1_private.fund_roleplay_review_exception(lane.operating_context,new_id,lane.command) is true\n        and bx1_private.fund_roleplay_lane_current(lane.operating_context,new_id,lane.command) is true\n        and exists(select 1 from bx1_private.fund_roleplay_command_lanes fund_lane\n          where fund_lane.transaction_id=pg_catalog.pg_current_xact_id() and fund_lane.actor_id=auth.uid()\n            and fund_lane.product_id=test_offering_review_mutation.new_id\n            and fund_lane.operating_context=lane.operating_context and fund_lane.action=lane.command\n            and fund_lane.request_key=lane.request_key)))"
      }]
    },
    {
      "signature":"bx1_portal.test_workspace_product_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)",
      "sha":"094daabfea9a0c068e8e1dcccdf2107cf96f0001ab9b011e448ccb0ec800aa28",
      "language":"plpgsql","result":"void",
      "argnames":["new_id","new_org","new_creator","new_status","new_revision","old_org","old_creator","old_status","old_revision","operation"],
      "changes":[{
        "from":"declare lane bx1_private.test_workspace_product_commands; grant_id uuid;\nbegin\n",
        "to":"declare lane bx1_private.test_workspace_product_commands; grant_id uuid;\n  fund_lane bx1_private.fund_roleplay_command_lanes;\nbegin\n  select entered.* into fund_lane from bx1_private.fund_roleplay_command_lanes entered\n    where entered.transaction_id=pg_catalog.pg_current_xact_id() and entered.actor_id=auth.uid()\n      and entered.product_id=test_workspace_product_mutation.new_id for update;\n  if fund_lane.action='publish_product' then\n    if operation is distinct from 'UPDATE' or old_org is distinct from new_org\n      or old_creator is distinct from new_creator or new_creator is distinct from auth.uid()\n      or old_status is distinct from 'APPROVED' or new_status is distinct from 'PUBLISHED'\n      or old_revision is null or old_revision<1 or new_revision is distinct from old_revision+1\n      or fund_lane.operating_context->>'mode' is distinct from 'ROLE'\n      or fund_lane.operating_context->>'role' is distinct from 'OfferingManager'\n      or not exists(select 1 from bx1_portal.products product\n        where product.id=test_workspace_product_mutation.new_id\n          and product.organisation_id=test_workspace_product_mutation.new_org\n          and product.created_by=test_workspace_product_mutation.new_creator\n          and product.status=test_workspace_product_mutation.old_status\n          and product.revision=test_workspace_product_mutation.old_revision\n          and product.current_offering_revision_id=fund_lane.offering_revision_id)\n      or bx1_private.fund_roleplay_manager_publish_lane(new_id,fund_lane.request_key,fund_lane.operating_context) is not true then\n      raise exception 'fund_roleplay_legacy_publication_transition_denied' using errcode='42501';end if;\n    perform bx1_portal.test_offering_lock_source(new_org);\n    if bx1_private.fund_roleplay_manager_publish_lane(new_id,fund_lane.request_key,fund_lane.operating_context) is not true\n      or not exists(select 1 from bx1_portal.products product\n        where product.id=test_workspace_product_mutation.new_id\n          and product.organisation_id=test_workspace_product_mutation.new_org\n          and product.created_by=test_workspace_product_mutation.new_creator\n          and product.status=test_workspace_product_mutation.old_status\n          and product.revision=test_workspace_product_mutation.old_revision\n          and product.current_offering_revision_id=fund_lane.offering_revision_id) then\n      raise exception 'fund_roleplay_legacy_publication_authority_changed' using errcode='42501';end if;\n    return;\n  end if;\n"
      }]
    }
  ]$specs$::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_legacy_context_test_owner_required' using errcode='42501';end if;

  -- Complete dependency and target preflight precedes the first DDL statement.
  -- Helpers are reused without changing their source, owner, OID or ACL.
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
        is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_legacy_context_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or before_row->>'provolatile' is distinct from 'v'
      or before_row->'proargnames' is distinct from spec->'argnames'
      or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname=spec->>'language')
      or pg_catalog.pg_get_function_result(target) is distinct from spec->>'result'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')
        is distinct from spec->>'sha' then
      raise exception 'fund_roleplay_legacy_context_native_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(spec->>'signature',before_row);
  end loop;

  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from snapshots->(spec->>'signature') then
      raise exception 'fund_roleplay_legacy_context_changed_before_cut' using errcode='55000';end if;
    next_body:=original;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      if coalesce(length(cut->>'from'),0)=0
        or (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>1 then
        raise exception 'fund_roleplay_legacy_context_cut_not_unique' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
    restored:=next_body;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'changes') with ordinality x(value,ordinality) order by ordinality desc loop
      if coalesce(length(cut->>'to'),0)=0
        or (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'fund_roleplay_legacy_context_result_not_unique' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if restored is distinct from original then
      raise exception 'fund_roleplay_legacy_context_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_legacy_context_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_roleplay_legacy_context_metadata_changed' using errcode='55000';end if;
  end loop;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from snapshots->(dependency->>'signature') then
      raise exception 'fund_roleplay_legacy_context_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_legacy_context$;
