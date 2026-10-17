-- Reproduced TEST SQLSTATE 42702: record "lane" collided with a query alias.
-- Only the initial EXISTS alias changes; the record and all guards are retained.
do $test_workspace_review_alias$
declare target oid; before_metadata jsonb; after_metadata jsonb; source_body text;
  definition text; next_body text; backup oid; permission record;
  old_fragment text:=$old$  if exists(select 1 from bx1_private.test_workspace_product_commands lane
    where lane.transaction_id=pg_catalog.pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.command in ('review_product','review_offering_issuer')) then$old$;
  new_fragment text:=$new$  if exists(select 1 from bx1_private.test_workspace_product_commands command_lane
    where command_lane.transaction_id=pg_catalog.pg_current_xact_id() and command_lane.actor_id=auth.uid()
      and command_lane.command in ('review_product','review_offering_issuer')) then$new$;
begin
  if current_user<>'postgres' or bx1_portal.test_workspace_environment() is not true then
    raise exception 'test_workspace_review_alias_test_required' using errcode='55000'; end if;
  target:=pg_catalog.to_regprocedure('bx1_portal.test_workspace_product_mutation(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)');
  select p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' into source_body,before_metadata
    from pg_catalog.pg_proc p where p.oid=target;
  if target is distinct from 30374::oid
    or before_metadata->>'proowner' is distinct from ('postgres'::regrole::oid)::text
    or before_metadata->>'prosecdef' is distinct from 'true'
    or before_metadata->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '0e81729fc5e98ff14df5695f1f3de594a2d516d8db6fca856b267727befd74a3'
    or pg_catalog.to_regprocedure('bx1_portal.tr3_product_mutation_pre_alias(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)') is not null then
    raise exception 'test_workspace_review_alias_source_changed' using errcode='55000'; end if;
  if (pg_catalog.length(source_body)-pg_catalog.length(pg_catalog.replace(source_body,old_fragment,'')))
      /pg_catalog.length(old_fragment)<>1 then
    raise exception 'test_workspace_review_alias_cutpoint_changed' using errcode='55000'; end if;
  next_body:=pg_catalog.replace(source_body,old_fragment,new_fragment);
  if pg_catalog.replace(next_body,new_fragment,old_fragment) is distinct from source_body then
    raise exception 'test_workspace_review_alias_not_reversible' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if pg_catalog.strpos(definition,'CREATE OR REPLACE FUNCTION bx1_portal.test_workspace_product_mutation(')<>1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body)<>1 then
    raise exception 'test_workspace_review_alias_definition_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(definition,'CREATE OR REPLACE FUNCTION bx1_portal.test_workspace_product_mutation(',
    'CREATE OR REPLACE FUNCTION bx1_portal.tr3_product_mutation_pre_alias(');
  backup:=pg_catalog.to_regprocedure('bx1_portal.tr3_product_mutation_pre_alias(uuid,uuid,uuid,text,integer,uuid,uuid,text,integer,text)');
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
    raise exception 'test_workspace_review_alias_identity_changed' using errcode='55000'; end if;
end $test_workspace_review_alias$;
