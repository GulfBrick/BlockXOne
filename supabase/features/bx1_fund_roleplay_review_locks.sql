-- Two exact TEST reviewer call-site corrections. The same current private
-- product/action lane and actual operator are required; other-person and
-- ordinary callers retain their existing lock path. No grants or writer changes.
do $fund_roleplay_review_locks$
declare spec jsonb; dependency jsonb; target oid; before_row jsonb; after_row jsonb;
  original text; normalized text; definition text; next_body text; old_fragment text; new_fragment text;
  dependencies_before jsonb:='{}'::jsonb; writers_before jsonb:='{}'::jsonb; prepared jsonb:='{}'::jsonb;
  dependencies constant jsonb:=$dependencies$[
    {"signature":"bx1_private.lock_funding_person(uuid,uuid)","owner":"bx1_authority_owner","acl":"{bx1_authority_owner=X/bx1_authority_owner,postgres=X/bx1_authority_owner}","sha":"f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc"},
    {"signature":"bx1_portal.admission_lock_people(uuid[])","owner":"postgres","acl":"{postgres=X/postgres}","sha":"2563cade1dc60a9afbc459cc93be3e6cdbef9f0eaaadd9deb095b57d6fa54838"},
    {"signature":"bx1_portal.offering_workflow_lock_people(uuid[])","owner":"postgres","acl":"{postgres=X/postgres}","sha":"305f54bc93a9340a42ead8e101ce21b970e6aa2e09b009569b15367b1f31a985"},
    {"signature":"bx1_portal.lock_entity_people(uuid[])","owner":"postgres","acl":"{postgres=X/postgres}","sha":"cf4dde8eb823c839207922872abea9827f86be0a4a8835576b80971cdba22725"},
    {"signature":"bx1_portal.offering_workflow_lock_lineage_people(uuid,text,uuid[])","owner":"postgres","acl":"{postgres=X/postgres}","sha":"057c41be2841648011e2076cb3231758240ea6afbeaac0d4b27244cbf58d807e"},
    {"signature":"bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)","owner":"postgres","acl":"{postgres=X/postgres}","sha":"e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177"}
  ]$dependencies$::jsonb;
  specifications constant jsonb:=$specifications$[
    {"signature":"bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)","sha":"78fe020c0aba57a0b43f301bc4c1108878cc0c024123aaa50c31492ade1cfb7f","cut":"ISSUER"},
    {"signature":"bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)","sha":"f95a428f853a497b7fe64d4f33d5a19a9889305b6b21fdef626ade49b4343504","cut":"COMPLIANCE"}
  ]$specifications$::jsonb;
  issuer_from constant text:=$issuer_from$    select * into d from bx1_portal.offering_decisions
      where offering_revision_id=r.id and decision_kind='COMPLIANCE';
    perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);$issuer_from$;
  issuer_to constant text:=$issuer_to$    select * into d from bx1_portal.offering_decisions
      where offering_revision_id=r.id and decision_kind='COMPLIANCE';
    if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' and action='review_offering_issuer'
      and bx1_private.fund_roleplay_lane_current(c,p.id,action) is true
      and not exists(select 1 from pg_catalog.unnest(array[actor,r.submitted_by,o.owner_id,d.actor_id]) locked(user_id)
        where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then
      perform bx1_portal.admission_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);
    else
      perform bx1_portal.offering_workflow_lock_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);
    end if;$issuer_to$;
  compliance_from constant text:=$compliance_from$  perform bx1_portal.offering_workflow_lock_lineage_people(p.id,r.terms_hash,
    array[actor,r.submitted_by,p.created_by,o.owner_id,
      issuer.actor_id,a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]);$compliance_from$;
  compliance_to constant text:=$compliance_to$  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
    and bx1_private.fund_roleplay_lane_current(c,p.id,'review_product') is true
    and not exists(select 1 from (
      select pg_catalog.unnest(array[actor,r.submitted_by,p.created_by,o.owner_id,
        issuer.actor_id,a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]) user_id
      union select history.submitted_by from bx1_portal.offering_revisions history
        where history.product_id=p.id and history.origin='SUBMITTED' and history.terms_hash=r.terms_hash
    ) locked where locked.user_id is not null and locked.user_id is distinct from auth.uid()) then
    -- Preserve the helper's complete sorted/deduplicated lineage, including
    -- historical submitters with the same immutable terms, not just this row.
    perform bx1_portal.admission_lock_people(array(select distinct locked.user_id from (
      select pg_catalog.unnest(array[actor,r.submitted_by,p.created_by,o.owner_id,
        issuer.actor_id,a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]) user_id
      union select history.submitted_by from bx1_portal.offering_revisions history
        where history.product_id=p.id and history.origin='SUBMITTED' and history.terms_hash=r.terms_hash
    ) locked where locked.user_id is not null order by locked.user_id));
  else
    perform bx1_portal.offering_workflow_lock_lineage_people(p.id,r.terms_hash,
      array[actor,r.submitted_by,p.created_by,o.owner_id,
        issuer.actor_id,a.requested_by_user_id,a.reviewed_by_user_id,a.applied_by_user_id]);
  end if;$compliance_to$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_review_locks_exact_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    target:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from (dependency->>'owner')::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or (select p.proacl::text from pg_catalog.pg_proc p where p.oid=target) is distinct from dependency->>'acl'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_review_locks_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
    dependencies_before:=dependencies_before||pg_catalog.jsonb_build_object(dependency->>'signature',before_row);
  end loop;
  -- Pin and prepare BOTH bodies before replacing either one.
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    normalized:=pg_catalog.btrim(replace(original,E'\r\n',E'\n'),E' \n\t');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
      or before_row->>'provolatile' is distinct from 'v'
      or before_row->>'prolang' is distinct from (select language.oid::text from pg_catalog.pg_language language where language.lanname='plpgsql')
      or before_row->'proargnames' is distinct from (case spec->>'cut' when 'ISSUER'
        then '["c","action","key","body"]'::jsonb else '["c","key","body"]'::jsonb end)
      or pg_catalog.pg_get_function_result(target) is distinct from 'jsonb'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'fund_roleplay_review_locks_native_pin_mismatch: %',spec->>'signature' using errcode='55000';end if;
    old_fragment:=case spec->>'cut' when 'ISSUER' then issuer_from else compliance_from end;
    new_fragment:=case spec->>'cut' when 'ISSUER' then issuer_to else compliance_to end;
    if (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)<>1
      or pg_catalog.strpos(original,new_fragment)<>0 then
      raise exception 'fund_roleplay_review_locks_cut_not_unique' using errcode='55000';end if;
    next_body:=replace(original,old_fragment,new_fragment);
    if (length(next_body)-length(replace(next_body,new_fragment,'')))/length(new_fragment)<>1
      or replace(next_body,new_fragment,old_fragment) is distinct from original then
      raise exception 'fund_roleplay_review_locks_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_review_locks_definition_not_unique' using errcode='55000';end if;
    writers_before:=writers_before||pg_catalog.jsonb_build_object(spec->>'signature',before_row);
    prepared:=prepared||pg_catalog.jsonb_build_object(spec->>'signature',pg_catalog.jsonb_build_object(
      'source',original,'next',next_body,'definition',definition));
  end loop;
  for spec in select value from pg_catalog.jsonb_array_elements(specifications) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p) into before_row from pg_catalog.pg_proc p where p.oid=target;
    if before_row is distinct from writers_before->(spec->>'signature') then
      raise exception 'fund_roleplay_review_locks_changed_before_cut' using errcode='55000';end if;
    original:=prepared#>>array[spec->>'signature','source'];
    next_body:=prepared#>>array[spec->>'signature','next'];
    definition:=prepared#>>array[spec->>'signature','definition'];
    execute replace(definition,original,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_roleplay_review_locks_metadata_changed' using errcode='55000';end if;
  end loop;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure(dependency->>'signature')) is distinct from dependencies_before->(dependency->>'signature') then
      raise exception 'fund_roleplay_review_locks_dependency_mutated' using errcode='55000';end if;
  end loop;
end $fund_roleplay_review_locks$;
