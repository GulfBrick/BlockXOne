-- Reproduced TEST Submit SQLSTATE 57014 under the unchanged 8-second role limit.
-- Three full snapshots were built; the first two are explicitly discarded.
-- Suppress only those two continuation readbacks for the existing live private
-- OfferingManager Submit lane. Retain final package/audit/authority readback.
-- This is not a general reader, authority, replay, provider or timeout bypass.
do $test_workspace_submit_readback$
declare
  pin jsonb; target oid; source_body text; definition text; next_body text;
  before_metadata jsonb; after_metadata jsonb; backup oid; permission record;
  old_fragment text; new_fragment text; backup_name text;
  pins jsonb := $pins$[
  {
    "name": "execute_scoped_p2",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 24447,
    "sha": "60a2748e7c7c3a436346b9eecf92f3314968db6b0f90f5b7b391ebb7bad9149e"
  },
  {
    "name": "execute_scoped_pre_monitoring",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 25754,
    "sha": "11003d1b4bafcda12e3ce9012b7e52fcb4b8d75174d9c2072fa393e60c1eb97c"
  },
  {
    "name": "offering_workflow_base_command",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 29619,
    "sha": "c3ae44abf45965b7c5eb048fc3327dfa7febadcc59e1989a67bc714d1691256b"
  },
  {
    "name": "offering_workflow_parent_command",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 29622,
    "sha": "d6f61eb13c7cab15a845ce97002f3a3dafab9af964ad3db847c923fd3db1993a"
  },
  {
    "name": "test_offering_lane_current",
    "arguments": "jsonb,uuid,uuid,text",
    "oid": 30784,
    "sha": "bdaca8d9835ac8d58879ef4d0605d2dac9819475672d9619b6a1d50e79e8ec23"
  },
  {
    "name": "test_workspace_product_command",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 30373,
    "sha": "916f5796ce71cca6fa14fb7ac72b89106d0ab19a43ca9c7c73d6c24521449af4"
  },
  {
    "name": "execute_scoped_pre_eligibility",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 24927,
    "sha": "9a9156a1a628c88cc51bcfca16670f8c6bc137933d4f512e34455f22b8e25d06"
  },
  {
    "name": "offering_workflow_command",
    "arguments": "jsonb,text,uuid,jsonb",
    "oid": 29621,
    "sha": "f2f9f5bdb232ad6ca3404c95f1bcb085831b00baa38f2f195401123b8a71a2c6"
  },
  {
    "name": "test_offering_context",
    "arguments": "jsonb",
    "oid": 30776,
    "sha": "0517cbc73459848eece7831da76b76bcd05e310ccf3f7a7c4ae858de16cb56ca"
  },
  {
    "name": "test_offering_source_current",
    "arguments": "uuid,uuid,integer",
    "oid": 30770,
    "sha": "f15952b5ac59bd44826e2635e9197404eba372f4d0c9265bb09a4e05f391cd15"
  }
]$pins$::jsonb;
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true then
    raise exception 'test_workspace_submit_readback_test_required' using errcode='55000'; end if;

  -- Pin both mutation sites, their exact discard-only continuation chain and
  -- the private lane/current-source predicates before changing either body.
  for pin in select value from pg_catalog.jsonb_array_elements(pins) loop
    target:=pg_catalog.to_regprocedure('bx1_portal.'||(pin->>'name')||'('||(pin->>'arguments')||')');
    select p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' into source_body,before_metadata
      from pg_catalog.pg_proc p where p.oid=target;
    if target is distinct from (pin->>'oid')::oid
      or before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
      or before_metadata->>'prosecdef' is distinct from 'true'
      or before_metadata->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
        pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from pin->>'sha' then
      raise exception 'test_workspace_submit_readback_source_changed: %',pin->>'name' using errcode='55000'; end if;
  end loop;

  -- Static continuation proof, separately checked in addition to whole-body
  -- pins: base result is ignored, P2 result is discarded, package reader final.
  if pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=24447),
       'ignored:=bx1_portal.offering_workflow_base_command(c,action,key,forwarded);')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=24927),
       'return bx1_portal.execute_scoped_p2(c,action,key,body); end if;')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=25754),
       'perform bx1_portal.offering_workflow_parent_command(c,action,key,body);')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=25754),
       'insert into bx1_portal.offering_revisions(product_id,package_number,origin,')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=25754),
       'update bx1_portal.products set current_offering_revision_id=r.id where id=p.id;')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=25754),
       'return bx1_portal.read_scoped(c);')=0
    or pg_catalog.strpos((select prosrc from pg_catalog.pg_proc where oid=30373),
       'return result;')=0 then
    raise exception 'test_workspace_submit_readback_continuation_changed' using errcode='55000'; end if;

  for pin in select value from pg_catalog.jsonb_array_elements(pins)
    where value->>'name' in ('offering_workflow_base_command','execute_scoped_p2') loop
    target:=pg_catalog.to_regprocedure('bx1_portal.'||(pin->>'name')||'('||(pin->>'arguments')||')');
    select p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' into source_body,before_metadata
      from pg_catalog.pg_proc p where p.oid=target;
    if pin->>'name'='offering_workflow_base_command' then
      backup_name:='tr4_base_command_pre_submit_readback';
      old_fragment:=$old$  if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;
  return bx1_portal.read_state();
end$old$;
      new_fragment:=$new$  -- The pinned parent consumes this result only as an internal continuation.
  -- The package writer still builds and returns the final authorised snapshot.
  if command='submit_product' and c->>'mode'='ROLE' and c->>'role'='OfferingManager'
    and bx1_portal.test_offering_lane_current(c,p.id,request_key,'submit_product') is true then
    return pg_catalog.jsonb_build_object('internal_continuation','SUBMIT_PACKAGE');
  end if;
  if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;
  return bx1_portal.read_state();
end$new$;
    else
      backup_name:='tr4_scoped_p2_pre_submit_readback';
      old_fragment:=$old$  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end$old$;
      new_fragment:=$new$  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);
  -- The pinned immutable-package writer discards this intermediate snapshot.
  -- Idempotency replay above remains a full reader and is never suppressed.
  if action='submit_product' and c->>'mode'='ROLE' and c->>'role'='OfferingManager'
    and bx1_portal.test_offering_lane_current(c,p.id,key,'submit_product') is true then
    return pg_catalog.jsonb_build_object('internal_continuation','SUBMIT_PACKAGE');
  end if;
  return bx1_portal.read_scoped(c);
end$new$;
    end if;
    if pg_catalog.to_regprocedure('bx1_portal.'||backup_name||'('||(pin->>'arguments')||')') is not null
      or (pg_catalog.length(source_body)-pg_catalog.length(pg_catalog.replace(source_body,old_fragment,'')))
        /pg_catalog.length(old_fragment)<>1 then
      raise exception 'test_workspace_submit_readback_cutpoint_changed: %',pin->>'name' using errcode='55000'; end if;
    next_body:=pg_catalog.replace(source_body,old_fragment,new_fragment);
    if pg_catalog.replace(next_body,new_fragment,old_fragment) is distinct from source_body then
      raise exception 'test_workspace_submit_readback_not_reversible: %',pin->>'name' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||(pin->>'name')||'(')<>1
      or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
        /pg_catalog.length(source_body)<>1 then
      raise exception 'test_workspace_submit_readback_definition_changed: %',pin->>'name' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION bx1_portal.'||(pin->>'name')||'(',
      'CREATE OR REPLACE FUNCTION bx1_portal.'||backup_name||'(');
    backup:=pg_catalog.to_regprocedure('bx1_portal.'||backup_name||'('||(pin->>'arguments')||')');
    for permission in select distinct a.grantee,r.rolname from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee where p.oid=backup and a.grantee<>p.proowner loop
      if permission.grantee=0 then execute pg_catalog.format('revoke all on function %s from public',backup::regprocedure);
      else execute pg_catalog.format('revoke all on function %s from %I',backup::regprocedure,permission.rolname); end if;
    end loop;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p)-'prosrc' into after_metadata from pg_catalog.pg_proc p where p.oid=target;
    if after_metadata is distinct from before_metadata
      or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'test_workspace_submit_readback_identity_changed: %',pin->>'name' using errcode='55000'; end if;
  end loop;
end $test_workspace_submit_readback$;
