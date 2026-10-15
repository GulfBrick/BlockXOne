-- Native hosted TEST negative/catalog proof only. No actor, approved customer,
-- account, provider result, document, eligibility decision or transaction seeded.
do $eligibility_boundaries$
declare signature text;role_name text;definition text;original_claims text;original_subject text;denied boolean;
  missing uuid:='00000000-0000-4000-8000-000000000099';
  context jsonb:='{"mode":"ROLE","organisationId":"00000000-0000-4000-8000-000000000099","role":"ComplianceOfficer"}'::jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_eligibility_test_requires_native_test';end if;
  foreach signature in array array[
    'bx1_private.fund_roleplay_eligibility_organisation_current(uuid,integer,uuid)',
    'bx1_private.fund_roleplay_eligibility_source(uuid)',
    'bx1_private.fund_roleplay_eligibility_current(uuid)',
    'bx1_private.fund_roleplay_eligibility_request(jsonb,uuid,uuid)',
    'bx1_private.fund_roleplay_eligibility_review(jsonb,uuid,text)',
    'bx1_private.fund_roleplay_eligibility_enter(jsonb,text,uuid,jsonb)',
    'bx1_private.fund_roleplay_eligibility_finish(jsonb,text,uuid,jsonb)',
    'bx1_private.fund_roleplay_eligibility_stamp()',
    'bx1_private.fund_roleplay_eligibility_projection(jsonb,uuid)',
    'bx1_private.fund_roleplay_eligibility_product_visible(jsonb,uuid)'] loop
    if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(signature)
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
      raise exception 'fund_roleplay_eligibility_helper_metadata_changed: %',signature;end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker',
      'bx1_document_receipt_writer','bx1_document_processing_worker','bx1_document_scanner_writer','bx1_offering_signature_worker'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'fund_roleplay_eligibility_helper_exposed: % / %',signature,role_name;end if;
    end loop;
  end loop;
  -- Exact unchanged customer and account gates: role-play is NOT admission.
  if exists(select 1 from (values
      ('bx1_portal.account_usable(jsonb,uuid)','2bc4db89d70ab7ee3f30f9d4a3b05828a0be23aa3a6410c2867dd232b46a19a1'),
      ('bx1_portal.admission_individual_account_current(jsonb,uuid)','99d269a1b4a78222ad29092425d91747b1a4e6ec1d99c79c35df3291795c2e6b'),
      ('bx1_portal.monitoring_new_action_allowed(uuid)','7f0e3e17e391a5a382bc2b44d0204451a1e103b725dff202005b65b4d77feeae'),
      ('bx1_portal.product_eligibility_current(uuid)','404909ba3f710ce4628853f63565eafcdfe061cd9fe8ed4b7682e6132d7b8b97')) pinned(signature,sha)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(pinned.signature)
    where p.oid is null or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from pinned.sha) then
    raise exception 'fund_roleplay_eligibility_customer_account_or_monitoring_gate_changed';end if;
  select prosrc into definition from pg_catalog.pg_proc where oid='bx1_private.fund_roleplay_eligibility_source(uuid)'::regprocedure;
  if pg_catalog.strpos(definition,$needle$a.status='APPROVED'$needle$)=0
    or pg_catalog.strpos(definition,'bx1_portal.monitoring_new_action_allowed(a.id)')=0
    or pg_catalog.strpos(definition,'e.application_revision=a.revision')=0
    or pg_catalog.strpos(definition,'e.product_revision=p.revision')=0
    or pg_catalog.strpos(definition,'e.offering_revision_id=p.current_offering_revision_id')=0
    or pg_catalog.strpos(definition,'bx1_portal.offering_operational(p.id)')=0
    or pg_catalog.strpos(definition,'fund_roleplay_record_current')=0 then
    raise exception 'fund_roleplay_eligibility_native_evidence_gate_missing';end if;
  select prosrc into definition from pg_catalog.pg_proc where oid='bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'fund_roleplay_eligibility_enter(c,action,key,body)')=0
    or pg_catalog.strpos(definition,'fund_roleplay_eligibility_finish(c,action,key,body)')=0
    or pg_catalog.strpos(definition,'fund_roleplay_eligibility_review(c,e.id,action)')=0
    or pg_catalog.strpos(definition,'product_eligibility_reviewer_expired')=0
    or pg_catalog.strpos(definition,$needle$a.status<>'APPROVED'$needle$)=0
    or pg_catalog.strpos(definition,'bx1_portal.account_usable(c,account_id) is not true')=0
    or pg_catalog.strpos(definition,'bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true')=0 then
    raise exception 'fund_roleplay_eligibility_command_commit_guards_missing';end if;
  select prosrc into definition from pg_catalog.pg_proc where oid='bx1_portal.product_eligibility_current_pre_monitoring(uuid)'::regprocedure;
  if pg_catalog.strpos(definition,'saved.roleplay_policy_id is not null')=0
    or pg_catalog.strpos(definition,'fund_roleplay_eligibility_current(target_case)')=0
    or pg_catalog.strpos(definition,$needle$a.persona='INVESTOR' and a.status='APPROVED'$needle$)=0 then
    raise exception 'fund_roleplay_eligibility_terminal_fence_missing';end if;

  original_claims:=pg_catalog.current_setting('request.jwt.claims',true);
  original_subject:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  perform pg_catalog.set_config('request.jwt.claims','{}',true);
  perform pg_catalog.set_config('request.jwt.claim.sub','',true);
  if auth.uid() is not null then raise exception 'fund_roleplay_eligibility_negative_actor_not_empty';end if;
  if bx1_private.fund_roleplay_eligibility_organisation_current(missing,1,missing) is not false
    or bx1_private.fund_roleplay_eligibility_organisation_current(null,null,null) is not false
    or bx1_private.fund_roleplay_eligibility_source(missing) is not false
    or bx1_private.fund_roleplay_eligibility_current(missing) is not false
    or bx1_private.fund_roleplay_eligibility_request(context,missing,missing) is not false
    or bx1_private.fund_roleplay_eligibility_request('{}'::jsonb,missing,missing) is not false
    or bx1_private.fund_roleplay_eligibility_review(context,missing,'review_product_eligibility') is not false
    or bx1_private.fund_roleplay_eligibility_review(context,missing,'revoke_product_eligibility') is not false
    or bx1_private.fund_roleplay_eligibility_review(context,missing,'INVALID') is not false
    or bx1_private.fund_roleplay_eligibility_product_visible(context,missing) is not false
    or bx1_private.fund_roleplay_eligibility_projection(context,missing) is not null then
    raise exception 'fund_roleplay_eligibility_missing_scope_became_authority';end if;
  foreach signature in array array['request_product_eligibility','review_product_eligibility','revoke_product_eligibility'] loop
    denied:=false;
    begin
      perform bx1_portal.execute_scoped_pre_mandate(context,signature,missing,
        pg_catalog.jsonb_build_object('product_id',missing,'eligibility_case_id',missing));
    exception when insufficient_privilege then denied:=true;end;
    if not denied then raise exception 'fund_roleplay_eligibility_unauthenticated_command_accepted: %',signature;end if;
  end loop;
  perform pg_catalog.set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(original_subject,''),true);
end $eligibility_boundaries$;
