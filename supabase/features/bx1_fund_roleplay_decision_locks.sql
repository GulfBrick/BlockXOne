-- DECISION-LINEAGE-20261015: one BEFORE INSERT trigger lock call-site.
-- No grants, global helper changes, claims, appointments or decisions are made.
-- Apply in one TEST owner transaction, followed by the companion rollback proof.
do $fund_roleplay_decision_locks$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_portal.guard_offering_decision_appointment()');
  dependency jsonb;dependency_oid oid;dependency_row jsonb;dependencies_before jsonb:='{}';
  before_function jsonb;after_function jsonb;original text;restored text;next_body text;definition text;
  dependencies constant jsonb:=$dependencies$[
  {
    "signature": "bx1_private.lock_funding_person(uuid,uuid)",
    "owner": "bx1_authority_owner",
    "acl": "{bx1_authority_owner=X/bx1_authority_owner,postgres=X/bx1_authority_owner}",
    "sha": "f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc"
  },
  {
    "signature": "bx1_portal.admission_lock_people(uuid[])",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "2563cade1dc60a9afbc459cc93be3e6cdbef9f0eaaadd9deb095b57d6fa54838"
  },
  {
    "signature": "bx1_portal.offering_workflow_lock_lineage_people(uuid,text,uuid[])",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "057c41be2841648011e2076cb3231758240ea6afbeaac0d4b27244cbf58d807e"
  },
  {
    "signature": "bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "e825147bef46f9ffadd52345e31345f71df4af0f93564b9a13b8749553321177"
  },
  {
    "signature": "bx1_portal.offering_workflow_product_appointment_authorised(jsonb,uuid,text)",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "fe957c62f1c82f98fafdff6c78ec96f43367d32f950b58ed4e149afd9df1c200"
  },
  {
    "signature": "bx1_portal.offering_workflow_product_appointment_effective(uuid)",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "fda841224e159fdcb5bb86e656d127e334b3caf263bf4f50f502583117a295ba"
  },
  {
    "signature": "bx1_portal.offering_workflow_lineage_independent(uuid,uuid,text)",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "5ef7aac7a1dcb9978677293c24089e4759f4892dfde1115b7894daa7a5923d34"
  },
  {
    "signature": "bx1_portal.offering_workflow_lock_product(jsonb,uuid)",
    "owner": "postgres",
    "acl": "{postgres=X/postgres}",
    "sha": "3ed89ea0153642d69163b1fcc36644b7b98157f97c8d2075ee0a18e14312b23e"
  }
]$dependencies$::jsonb;
  old_fragment constant text:=$old$  perform bx1_portal.offering_workflow_lock_lineage_people(target_product,r.terms_hash,
    array[new.actor_id,candidate.requested_by_user_id,
    candidate.reviewed_by_user_id,candidate.applied_by_user_id,
    p.created_by,o.owner_id,r.submitted_by]);$old$;
  new_fragment constant text:=$new$  declare roleplay_users uuid[];
  begin
    if auth.uid() is not null and new.operating_context->>'mode'='ROLE'
      and new.operating_context->>'role'=target_role
      and bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,
        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'
          when 'COMPLIANCE' then 'review_product' end) is true then
      select pg_catalog.array_agg(distinct locked.user_id order by locked.user_id) into roleplay_users from (
        select pg_catalog.unnest(array[new.actor_id,candidate.requested_by_user_id,
          candidate.reviewed_by_user_id,candidate.applied_by_user_id,
          p.created_by,o.owner_id,r.submitted_by]) user_id
        union select history.submitted_by from bx1_portal.offering_revisions history
          where history.product_id=target_product and history.origin='SUBMITTED' and history.terms_hash=r.terms_hash
      ) locked where locked.user_id is not null;
    end if;
    if roleplay_users is not null and pg_catalog.cardinality(roleplay_users)>0
      and not exists(select 1 from pg_catalog.unnest(roleplay_users) locked(user_id)
        where locked.user_id is distinct from auth.uid()) then
      perform bx1_portal.admission_lock_people(roleplay_users);
    else
      perform bx1_portal.offering_workflow_lock_lineage_people(target_product,r.terms_hash,
        array[new.actor_id,candidate.requested_by_user_id,
        candidate.reviewed_by_user_id,candidate.applied_by_user_id,
        p.created_by,o.owner_id,r.submitted_by]);
    end if;
  end;$new$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_decision_locks_test_owner_required' using errcode='42501';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    dependency_oid:=pg_catalog.to_regprocedure(dependency->>'signature');
    select pg_catalog.to_jsonb(p) into dependency_row from pg_catalog.pg_proc p where p.oid=dependency_oid;
    if dependency_oid is null
      or dependency_row->>'proowner' is distinct from (dependency->>'owner')::regrole::oid::text
      or dependency_row->'prosecdef' is distinct from 'true'::jsonb
      or dependency_row->>'provolatile' is distinct from 'v'
      or dependency_row->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
      or (select proacl::text from pg_catalog.pg_proc where oid=dependency_oid) is distinct from dependency->>'acl'
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.btrim(replace(dependency_row->>'prosrc',E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_decision_locks_dependency_drift:%',dependency->>'signature' using errcode='55000';end if;
    dependencies_before:=dependencies_before||pg_catalog.jsonb_build_object(dependency->>'signature',dependency_row);
  end loop;
  select pg_catalog.to_jsonb(p),p.prosrc into before_function,original from pg_catalog.pg_proc p where p.oid=target;
  if target is null or before_function->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_function->'prosecdef' is distinct from 'true'::jsonb
    or before_function->>'provolatile' is distinct from 'v'
    or before_function->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or before_function->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or before_function->'proargnames' is distinct from 'null'::jsonb
    or pg_catalog.pg_get_function_result(target) is distinct from 'trigger'
    or before_function->>'prolang' is distinct from
      (select language.oid::text from pg_catalog.pg_language language where language.lanname='plpgsql') then
    raise exception 'fund_roleplay_decision_locks_metadata_pin_mismatch' using errcode='55000';end if;
  if (length(original)-length(replace(original,new_fragment,'')))/length(new_fragment)=1 then
    restored:=replace(original,new_fragment,old_fragment);next_body:=original;
  elsif (length(original)-length(replace(original,old_fragment,'')))/length(old_fragment)=1
      and pg_catalog.strpos(original,new_fragment)=0 then
    restored:=original;next_body:=replace(original,old_fragment,new_fragment);
  else raise exception 'fund_roleplay_decision_locks_cut_not_unique' using errcode='55000';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'f9d59d64e5ea2ea1b1803384de5eaff46b86b0905c385b02641bedf6e93f9a23'
    or replace(next_body,new_fragment,old_fragment) is distinct from restored then
    raise exception 'fund_roleplay_decision_locks_source_pin_mismatch' using errcode='55000';end if;
  if next_body is distinct from original then
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_decision_locks_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
  end if;
  select pg_catalog.to_jsonb(p) into after_function from pg_catalog.pg_proc p where p.oid=target;
  if after_function-'prosrc' is distinct from before_function-'prosrc'
    or after_function->>'prosrc' is distinct from next_body then
    raise exception 'fund_roleplay_decision_locks_metadata_changed' using errcode='55000';end if;
  for dependency in select value from pg_catalog.jsonb_array_elements(dependencies) loop
    if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p
        where p.oid=pg_catalog.to_regprocedure(dependency->>'signature'))
        is distinct from dependencies_before->(dependency->>'signature') then
      raise exception 'fund_roleplay_decision_locks_dependency_changed' using errcode='55000';end if;
  end loop;
end $fund_roleplay_decision_locks$;
