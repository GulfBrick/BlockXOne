-- Exact TEST publication return-path correction. Canonical mutation, locks,
-- audit/events, idempotency and finish remain in their existing writers.
-- Two discarded inner snapshots and the pre-commit dashboard read become a
-- private continuation only inside the current publication lane. The outer
-- bridge returns a receipt after finish; a separate HTTP read refreshes the UI.
-- Apply atomically with the matching strict application receipt consumer.

do $fund_roleplay_publication_commit$
declare spec jsonb; dependency jsonb; cut jsonb; target oid; helper oid; permission record;
  before_row jsonb; after_row jsonb; helper_row jsonb; snapshots jsonb:='{}'::jsonb;
  prepared jsonb:='{}'::jsonb; original text; normalized text; next_body text; restored text; definition text;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.fund_roleplay_manager_publish_lane(uuid,uuid,jsonb)","sha":"261f4c1c7df4a400e51445ee0f0386cdd21d10c75fada9fd4ba8c1eea191338a"},
    {"signature":"bx1_private.fund_roleplay_manager_current(jsonb,uuid,text)","sha":"643ccda96e4c99f3b22082beab45bf7fe4135e15d3bbf78c296ef627c13bb6a3"},
    {"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"},
    {"signature":"bx1_private.fund_roleplay_finish(jsonb,uuid,text,uuid)","sha":"3168472a61298bb600ccc544cecbd18c490fa4154fa45044bf7ef32ff2056302"}
  ]$dependencies$::jsonb;
  specs constant jsonb:=$specs$[
    {"signature":"bx1_portal.execute_command_pre_entry(text,uuid,jsonb)","oid":24343,
     "sha":"509d104df875b3c1bca1212dcc2cbd24f3b31de4dd361142586d182ce9329149","args":["command","request_key","payload"],"cuts":[
      {"from":"      return bx1_private.fund_roleplay_manager_read((select lane.operating_context from bx1_private.fund_roleplay_command_lanes lane\n        where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()\n          and lane.product_id=(payload->>'product_id')::uuid and lane.action='publish_product' and lane.request_key=execute_command_pre_entry.request_key));",
       "to":"      return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');","count":2}]},
    {"signature":"bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)","oid":24447,
     "sha":"55ce4d753f99118c8e791a087b003a43363ba6182776181087c33a8715b778e9","args":["c","action","key","body"],"cuts":[
      {"from":"  return bx1_portal.read_scoped(c);\nend",
       "to":"  if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then\n    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');\n  end if;\n  return bx1_portal.read_scoped(c);\nend","count":1}]},
    {"signature":"bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)","oid":25754,
     "sha":"327fcbf6a89250c4f73b624e1c0ccc94c45803941fc8cbc7c72a739b267aa614","args":["c","action","key","body"],"cuts":[
      {"from":"  perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\nend",
       "to":"  if action='publish_product' and bx1_private.fund_roleplay_manager_publish_lane(p.id,key,c) is true then\n    perform bx1_private.fund_roleplay_finish(c,p.id,action,key);\n    return pg_catalog.jsonb_build_object('internal_continuation','TEST_FUND_PUBLICATION');\n  end if;\n  perform bx1_private.fund_roleplay_finish(c,p.id,action,key); return bx1_portal.read_scoped(c);\nend","count":1}]},
    {"signature":"bx1_private.fund_roleplay_manager_publish(jsonb,uuid,jsonb)","oid":37218,
     "sha":"f6ce6077088a76ea9353ec593d0a00eff47337b812f5d43179c50a9fa33704bc","args":["c","key","body"],"cuts":[
      {"from":"    perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);\n    return bx1_private.fund_roleplay_manager_read(c);",
       "to":"    perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);\n    return bx1_private.fund_roleplay_publication_commit(c,key,body);","count":1},
      {"from":"  perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);\n  return result;",
       "to":"  perform bx1_private.fund_roleplay_finish(c,product,'publish_product',key);\n  return bx1_private.fund_roleplay_publication_commit(c,key,body);","count":1}]}
  ]$specs$::jsonb;
  helper_definition constant text:=$helper$
create function bx1_private.fund_roleplay_publication_commit(p_context jsonb,p_key uuid,p_body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $function$
declare publication bx1_portal.products; offering_row bx1_portal.offering_revisions;
  saved_policy bx1_private.roleplay_policies; fund_receipt bx1_private.fund_roleplay_command_receipts;
  base_request bx1_portal.requests; scoped_request bx1_portal.scoped_requests;
begin
  if bx1_private.test_roleplay_environment() is not true or auth.uid() is null
    or pg_catalog.jsonb_typeof(p_context) is distinct from 'object'
    or p_context->>'mode' is distinct from 'ROLE' or p_context->>'role' is distinct from 'OfferingManager'
    or p_context-array['mode','organisationId','role']<>'{}'::jsonb
    or p_key is null or p_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(p_body) is distinct from 'object'
    or not(p_body ?& array['product_id','expected_revision'])
    or p_body-array['product_id','expected_revision']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_body->'product_id') is distinct from 'string'
    or coalesce(p_body->>'product_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(p_body->'expected_revision') is distinct from 'number'
    or coalesce(p_body->>'expected_revision','') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'fund_roleplay_publication_commit_scope_denied' using errcode='42501';end if;

  -- The entered lane is already consumed on a new command. Only its original
  -- immutable receipt can confirm finish; no replacement lane is manufactured.
  select saved.* into fund_receipt from bx1_private.fund_roleplay_command_receipts saved
    where saved.actual_actor_id=auth.uid() and saved.request_key=p_key and saved.action='publish_product';
  select saved.* into base_request from bx1_portal.requests saved where saved.actor_id=auth.uid() and saved.request_key=p_key;
  select saved.* into scoped_request from bx1_portal.scoped_requests saved where saved.actor_id=auth.uid() and saved.request_key=p_key;
  select saved.* into publication from bx1_portal.products saved where saved.id=(p_body->>'product_id')::uuid;
  select saved.* into offering_row from bx1_portal.offering_revisions saved where saved.id=publication.current_offering_revision_id;
  select saved.* into saved_policy from bx1_private.roleplay_policies saved where saved.id=fund_receipt.policy_id;
  if fund_receipt.id is null or base_request.actor_id is null or scoped_request.actor_id is null
    or base_request.command is distinct from 'publish_product' or base_request.payload is distinct from p_body
    or scoped_request.command is distinct from 'publish_product' or scoped_request.payload is distinct from p_body
    or scoped_request.operating_context is distinct from p_context
    or publication.id is null or publication.created_by is distinct from auth.uid()
    or publication.revision<(p_body->>'expected_revision')::integer+1
    or offering_row.id is null or offering_row.product_id is distinct from publication.id
    or offering_row.origin is distinct from 'SUBMITTED' or offering_row.terms is distinct from publication.terms
    or offering_row.terms_hash is distinct from publication.terms_hash
    or saved_policy.id is null or saved_policy.product_id is distinct from publication.id
    or saved_policy.product_organisation_id is distinct from publication.organisation_id
    or saved_policy.offering_revision_id is distinct from offering_row.id
    or saved_policy.terms_hash is distinct from publication.terms_hash
    or saved_policy.native_organisation_id::text is distinct from p_context->>'organisationId'
    or saved_policy.environment is distinct from 'TESTNET' or saved_policy.project_ref is distinct from 'fegnnnlseuejkrusbbkv'
    or fund_receipt.authority_epoch is distinct from saved_policy.authority_epoch
    or fund_receipt.product_id is distinct from publication.id or fund_receipt.offering_revision_id is distinct from offering_row.id
    or fund_receipt.actual_person_id is distinct from saved_policy.actual_operator_person_id
    or fund_receipt.operating_context is distinct from p_context or fund_receipt.assurance is distinct from 'TEST_ROLE_PLAY'
    or fund_receipt.independence_proven is distinct from false or fund_receipt.recorded_at is null then
    raise exception 'fund_roleplay_publication_commit_binding_changed' using errcode='42501';end if;
  -- One current manager/source/session gate plus the SAVED receipt's policy and
  -- epoch. Neither a generic session nor a newly looked-up policy relabels history.
  if bx1_private.fund_roleplay_manager_current(p_context,publication.id,'publish_product') is not true
    or bx1_private.fund_roleplay_record_current(fund_receipt.policy_id,fund_receipt.authority_epoch,
      publication.id,offering_row.id,auth.uid(),p_context,'publish_product') is not true then
    raise exception 'fund_roleplay_publication_commit_authority_changed' using errcode='42501';end if;
  -- Revision is CURRENT; recorded_at belongs to the original immutable command.
  -- This confirms that command, not an unchanged current publication status.
  return pg_catalog.jsonb_build_object('kind','TEST_FUND_PUBLICATION_COMMIT','version',1,
    'environment','TESTNET','execution_mode','TEST_ROLE_PLAY','independence_proven',false,
    'actor_id',auth.uid(),'session_id',(auth.jwt()->>'session_id')::uuid,'operating_context',p_context,
    'policy_id',saved_policy.id,'authority_epoch',saved_policy.authority_epoch,'product_id',publication.id,
    'offering_revision_id',offering_row.id,'product_revision',publication.revision,
    'request',pg_catalog.jsonb_build_object('command','publish_product','key',p_key,'payload',base_request.payload),
    'recorded_at',fund_receipt.recorded_at);
end $function$;
$helper$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or bx1_private.test_roleplay_environment() is not true
    or pg_catalog.to_regprocedure('bx1_private.fund_roleplay_publication_commit(jsonb,uuid,jsonb)') is not null then
    raise exception 'fund_roleplay_publication_commit_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_publication_commit_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;
  -- Pin and prepare every target before creating the closed helper or changing
  -- any target. Reverse replacement proves all original writes/guards survive.
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is distinct from (spec->>'oid')::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or before_row->>'provolatile' is distinct from 'v' or before_row->'proargnames' is distinct from spec->'args'
      or before_row->>'prolang' is distinct from (select l.oid::text from pg_catalog.pg_language l where l.lanname='plpgsql')
      or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'fund_roleplay_publication_commit_native_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    next_body:=original;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') loop
      if coalesce(length(cut->>'from'),0)=0 or (length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from')<>(cut->>'count')::integer then
        raise exception 'fund_roleplay_publication_commit_cut_count_changed' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
    restored:=next_body;
    for cut in select value from pg_catalog.jsonb_array_elements(spec->'cuts') with ordinality x(value,ordinality) order by ordinality desc loop
      if coalesce(length(cut->>'to'),0)=0 or (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>(cut->>'count')::integer then
        raise exception 'fund_roleplay_publication_commit_result_count_changed' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if restored is distinct from original then raise exception 'fund_roleplay_publication_commit_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_publication_commit_definition_not_unique' using errcode='55000';end if;
    snapshots:=snapshots||pg_catalog.jsonb_build_object(spec->>'signature',before_row);
    prepared:=prepared||pg_catalog.jsonb_build_object(spec->>'signature',pg_catalog.jsonb_build_object('original',original,'next',next_body,'definition',definition));
  end loop;
  execute helper_definition;
  helper:=pg_catalog.to_regprocedure('bx1_private.fund_roleplay_publication_commit(jsonb,uuid,jsonb)');
  for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=helper and a.grantee<>p.proowner loop
    if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',helper::regprocedure);
    else execute pg_catalog.format('revoke all on function %s from %I',helper::regprocedure,permission.rolname);end if;
  end loop;
  select pg_catalog.to_jsonb(p) into helper_row from pg_catalog.pg_proc p where p.oid=helper;
  if helper is null or helper_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or helper_row->'prosecdef' is distinct from 'true'::jsonb
    or helper_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or helper_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb then
    raise exception 'fund_roleplay_publication_commit_helper_acl_changed' using errcode='55000';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(specs) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from snapshots->(spec->>'signature') then raise exception 'fund_roleplay_publication_commit_target_changed_before_cut' using errcode='55000';end if;
    original:=prepared#>>array[spec->>'signature','original']; next_body:=prepared#>>array[spec->>'signature','next'];
    definition:=prepared#>>array[spec->>'signature','definition'];
    execute replace(definition,original,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_roleplay_publication_commit_metadata_changed' using errcode='55000';end if;
  end loop;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(dependency->>'signature'))
      is distinct from snapshots->(dependency->>'signature') then raise exception 'fund_roleplay_publication_commit_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_publication_commit$;
