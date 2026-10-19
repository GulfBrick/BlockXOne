-- Source/ACL and pure branch equivalence only, no invented real actors/claims.
-- Run with installer in the TEST owner transaction; ROLLBACK by default.
do $fund_roleplay_decision_locks_proof$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_portal.guard_offering_decision_appointment()');
  source text;restored text;before_metadata jsonb;role_name text;item jsonb;outcome boolean;
  entry_expression text;final_expression text;post_expression text;denial_expression text;evaluate text;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  old_fragment constant text:=$old$  perform bx1_portal.offering_workflow_lock_lineage_people(target_product,r.terms_hash,
    array[new.actor_id,candidate.requested_by_user_id,
    candidate.reviewed_by_user_id,candidate.applied_by_user_id,
    p.created_by,o.owner_id,r.submitted_by]);
  if bx1_portal.offering_workflow_product_appointment_authorised(
      new.operating_context,target_product,target_role) is not true
    or bx1_portal.offering_workflow_product_appointment_effective(candidate.id) is not true
    or bx1_portal.offering_workflow_lineage_independent(new.actor_id,target_product,r.terms_hash) is not true then
    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;$old$;
  new_fragment constant text:=$new$  declare roleplay_users uuid[]; roleplay_lineage boolean:=false;
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
      roleplay_lineage:=auth.uid() is not null and new.operating_context->>'mode'='ROLE'
      and new.operating_context->>'role'=target_role
      and bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,
        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'
          when 'COMPLIANCE' then 'review_product' end) is true
      and (roleplay_users is not null and pg_catalog.cardinality(roleplay_users)>0
      and not exists(select 1 from pg_catalog.unnest(roleplay_users) locked(user_id)
        where locked.user_id is distinct from auth.uid()));
    else
      perform bx1_portal.offering_workflow_lock_lineage_people(target_product,r.terms_hash,
        array[new.actor_id,candidate.requested_by_user_id,
        candidate.reviewed_by_user_id,candidate.applied_by_user_id,
        p.created_by,o.owner_id,r.submitted_by]);
    end if;
  if bx1_portal.offering_workflow_product_appointment_authorised(
      new.operating_context,target_product,target_role) is not true
    or bx1_portal.offering_workflow_product_appointment_effective(candidate.id) is not true
    or (bx1_portal.offering_workflow_lineage_independent(new.actor_id,target_product,r.terms_hash) is not true
      and roleplay_lineage is not true) then
    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;
  end;$new$;
  entry_gate constant text:=$entry$auth.uid() is not null and new.operating_context->>'mode'='ROLE'
      and new.operating_context->>'role'=target_role
      and bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,
        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'
          when 'COMPLIANCE' then 'review_product' end) is true$entry$;
  final_gate constant text:=$final$roleplay_users is not null and pg_catalog.cardinality(roleplay_users)>0
      and not exists(select 1 from pg_catalog.unnest(roleplay_users) locked(user_id)
        where locked.user_id is distinct from auth.uid())$final$;
  lane_call constant text:=$lane$bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,
        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'
          when 'COMPLIANCE' then 'review_product' end)$lane$;
  post_gate constant text:=$post$auth.uid() is not null and new.operating_context->>'mode'='ROLE'
      and new.operating_context->>'role'=target_role
      and bx1_private.fund_roleplay_lane_current(new.operating_context,target_product,
        case new.decision_kind when 'ISSUER' then 'review_offering_issuer'
          when 'COMPLIANCE' then 'review_product' end) is true
      and (roleplay_users is not null and pg_catalog.cardinality(roleplay_users)>0
      and not exists(select 1 from pg_catalog.unnest(roleplay_users) locked(user_id)
        where locked.user_id is distinct from auth.uid()))$post$;
  denial_gate constant text:=$denial$bx1_portal.offering_workflow_product_appointment_authorised(
      new.operating_context,target_product,target_role) is not true
    or bx1_portal.offering_workflow_product_appointment_effective(candidate.id) is not true
    or (bx1_portal.offering_workflow_lineage_independent(new.actor_id,target_product,r.terms_hash) is not true
      and roleplay_lineage is not true)$denial$;
  authorised_call constant text:=$authorised$bx1_portal.offering_workflow_product_appointment_authorised(
      new.operating_context,target_product,target_role)$authorised$;
  baseline constant jsonb:='{"actor":"11111111-1111-4111-8111-111111111111","mode":"ROLE","role":"IssuerFundManager","kind":"ISSUER","lane":true,"users":["11111111-1111-4111-8111-111111111111"],"history":[],"authorised":true,"effective":true,"independent":false}';
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_decision_locks_proof_test_owner_required';end if;
  select pg_catalog.to_jsonb(p),p.prosrc into before_metadata,source from pg_catalog.pg_proc p where p.oid=target;
  if target is null or before_metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_metadata->'prosecdef' is distinct from 'true'::jsonb
    or before_metadata->'proconfig' is distinct from pg_catalog.to_jsonb(array['search_path=""']::text[])
    or before_metadata->'proacl' is distinct from '["postgres=X/postgres"]'::jsonb
    or (length(source)-length(replace(source,new_fragment,'')))/length(new_fragment)<>1 then
    raise exception 'fund_roleplay_decision_locks_proof_installed_source_invalid';end if;
  restored:=replace(source,new_fragment,old_fragment);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'f9d59d64e5ea2ea1b1803384de5eaff46b86b0905c385b02641bedf6e93f9a23' then
    raise exception 'fund_roleplay_decision_locks_proof_outside_cut_changed';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
    if pg_catalog.has_function_privilege(role_name,target,'EXECUTE')
      or pg_catalog.has_function_privilege(role_name,'bx1_private.fund_roleplay_lane_current(jsonb,uuid,text)','EXECUTE')
      or pg_catalog.has_function_privilege(role_name,'bx1_portal.admission_lock_people(uuid[])','EXECUTE') then
      raise exception 'fund_roleplay_decision_locks_proof_private_guard_exposed';end if;
  end loop;
  if strpos(new_fragment,entry_gate)=0 or strpos(new_fragment,final_gate)=0
    or strpos(new_fragment,'roleplay_lineage:='||post_gate||';')=0 or strpos(new_fragment,denial_gate)=0
    or (length(entry_gate)-length(replace(entry_gate,lane_call,'')))/length(lane_call)<>1 then
    raise exception 'fund_roleplay_decision_locks_proof_gate_extraction_invalid';end if;
  entry_expression:=replace(replace(replace(replace(entry_gate,lane_call,'lane_is_current'),
    'auth.uid()','actor_id'),'new.operating_context','operating_context'),'new.decision_kind','decision_kind');
  final_expression:=replace(final_gate,'auth.uid()','actor_id');
  post_expression:=replace(replace(replace(replace(post_gate,lane_call,'lane_is_current_after'),
    'auth.uid()','actor_id_after'),'new.operating_context','operating_context_after'),'new.decision_kind','decision_kind_after');
  denial_expression:=replace(replace(replace(denial_gate,authorised_call,'authorised'),
    'bx1_portal.offering_workflow_product_appointment_effective(candidate.id)','effective'),
    'bx1_portal.offering_workflow_lineage_independent(new.actor_id,target_product,r.terms_hash)','independent');
  evaluate:=$evaluate$
    with value as (select $1::jsonb v),
    input as (select (v->>'actor')::uuid actor_id,
      pg_catalog.jsonb_build_object('mode',v->>'mode','role',v->>'role') operating_context,
      v->>'kind' decision_kind,
      case v->>'kind' when 'ISSUER' then 'IssuerFundManager' when 'COMPLIANCE' then 'ComplianceOfficer' end target_role,
      (v->>'lane')::boolean lane_is_current,
      (case when v?'lane_after' then v->>'lane_after' else v->>'lane' end)::boolean lane_is_current_after,
      (case when v?'actor_after' then v->>'actor_after' else v->>'actor' end)::uuid actor_id_after,
      pg_catalog.jsonb_build_object('mode',case when v?'mode_after' then v->>'mode_after' else v->>'mode' end,
        'role',case when v?'role_after' then v->>'role_after' else v->>'role' end) operating_context_after,
      v->>'kind' decision_kind_after,
      (v->>'authorised')::boolean authorised,(v->>'effective')::boolean effective,(v->>'independent')::boolean independent,
      (select pg_catalog.array_agg(distinct user_id order by user_id) from (
        select u::uuid user_id from pg_catalog.jsonb_array_elements_text(v->'users') participants(u)
        union select (h->>'user')::uuid from pg_catalog.jsonb_array_elements(v->'history') history(h)
          where h->>'product'='same-product' and h->>'origin'='SUBMITTED' and h->>'terms'='same-terms'
      ) lineage where user_id is not null) full_users
      from value),
    scoped as (select input.*,case when $evaluate$||entry_expression||$evaluate$
      then full_users else null::uuid[] end roleplay_users from input),
    delegated as (select scoped.*,($evaluate$||final_expression||$evaluate$) is true delegated from scoped),
    checked as (select delegated.*,case when delegated then ($evaluate$||post_expression||$evaluate$)
      else false end roleplay_lineage from delegated)
    select not ($evaluate$||denial_expression||$evaluate$) from checked
  $evaluate$;
  for item in select value from pg_catalog.jsonb_array_elements($cases$[
    {"label":"current issuer","patch":{},"allow":true},
    {"label":"current Compliance","patch":{"role":"ComplianceOfficer","kind":"COMPLIANCE"},"allow":true},
    {"label":"no actual actor","patch":{"actor":null},"allow":false},
    {"label":"other context mode","patch":{"mode":"APPLICANT"},"allow":false},
    {"label":"missing context mode","patch":{"mode":null},"allow":false},
    {"label":"wrong issuer role","patch":{"role":"ComplianceOfficer"},"allow":false},
    {"label":"wrong Compliance role","patch":{"kind":"COMPLIANCE"},"allow":false},
    {"label":"missing role","patch":{"role":null},"allow":false},
    {"label":"unknown decision kind","patch":{"kind":"OTHER"},"allow":false},
    {"label":"missing decision kind","patch":{"kind":null},"allow":false},
    {"label":"missing expired revoked or foreign scope lane","patch":{"lane":false},"allow":false},
    {"label":"unknown lane","patch":{"lane":null},"allow":false},
    {"label":"empty lineage","patch":{"users":[]},"allow":false},
    {"label":"all-null lineage","patch":{"users":[null,null]},"allow":false},
    {"label":"duplicate and null participants","patch":{"users":["11111111-1111-4111-8111-111111111111",null,"11111111-1111-4111-8111-111111111111"]},"allow":true},
    {"label":"other original participant","patch":{"users":["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]},"allow":false},
    {"label":"other historical submitter","patch":{"history":[{"user":"22222222-2222-4222-8222-222222222222","product":"same-product","origin":"SUBMITTED","terms":"same-terms"}]},"allow":false},
    {"label":"same historical submitter","patch":{"history":[{"user":"11111111-1111-4111-8111-111111111111","product":"same-product","origin":"SUBMITTED","terms":"same-terms"}]},"allow":true},
    {"label":"other product not in this lineage","patch":{"history":[{"user":"22222222-2222-4222-8222-222222222222","product":"other-product","origin":"SUBMITTED","terms":"same-terms"}]},"allow":true},
    {"label":"other terms not in this lineage","patch":{"history":[{"user":"22222222-2222-4222-8222-222222222222","product":"same-product","origin":"SUBMITTED","terms":"other-terms"}]},"allow":true},
    {"label":"unsubmitted revision not in this lineage","patch":{"history":[{"user":"22222222-2222-4222-8222-222222222222","product":"same-product","origin":"DRAFT","terms":"same-terms"}]},"allow":true},
    {"label":"lane revoked after lock","patch":{"lane_after":false},"allow":false},
    {"label":"lane unknown after lock","patch":{"lane_after":null},"allow":false},
    {"label":"actor missing after lock","patch":{"actor_after":null},"allow":false},
    {"label":"actor changed after lock","patch":{"actor_after":"22222222-2222-4222-8222-222222222222"},"allow":false},
    {"label":"role changed after lock","patch":{"role_after":"ComplianceOfficer"},"allow":false},
    {"label":"role missing after lock","patch":{"role_after":null},"allow":false},
    {"label":"context changed after lock","patch":{"mode_after":"APPLICANT"},"allow":false},
    {"label":"authorised always mandatory","patch":{"authorised":false},"allow":false},
    {"label":"unknown authorised always denied","patch":{"authorised":null},"allow":false},
    {"label":"effective always mandatory","patch":{"effective":false},"allow":false},
    {"label":"unknown effective always denied","patch":{"effective":null},"allow":false},
    {"label":"ordinary independent path no lane","patch":{"lane":false,"independent":true},"allow":true},
    {"label":"ordinary independent path post-lane false","patch":{"lane_after":false,"independent":true},"allow":true},
    {"label":"ordinary independent path no context","patch":{"mode":"APPLICANT","independent":true},"allow":true},
    {"label":"ordinary independent still needs authority","patch":{"lane":false,"independent":true,"authorised":false},"allow":false},
    {"label":"ordinary independent still needs effective appointment","patch":{"lane":false,"independent":true,"effective":false},"allow":false},
    {"label":"unknown independence without local alternative denied","patch":{"lane":false,"independent":null},"allow":false}
  ]$cases$::jsonb) loop
    execute evaluate into outcome using baseline||(item->'patch');
    if outcome is distinct from (item->>'allow')::boolean then
      raise exception 'fund_roleplay_decision_locks_branch_failed:%',item->>'label';end if;
  end loop;
  if bx1_private.fund_roleplay_lane_current(null,null,null) is not false then
    raise exception 'fund_roleplay_decision_locks_proof_null_scope_not_denied';end if;
  if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=target) is distinct from before_metadata
    or before_claims is distinct from pg_catalog.current_setting('request.jwt.claims',true) then
    raise exception 'fund_roleplay_decision_locks_proof_metadata_or_context_changed';end if;
end $fund_roleplay_decision_locks_proof$;
