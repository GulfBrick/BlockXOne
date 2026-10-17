-- Run inside the installer's owner TEST transaction, ROLLBACK by default.
-- Pure CASE fixtures are not provider/business evidence. No session or rows
-- are invented; the only command call is an invalid-worker denial probe.

do $signature_integrity_recovery_proof$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_private.record_offering_signature_action(text,uuid,uuid,bigint,uuid,text,jsonb)');
  source text; restored text; expression text; evaluate text; before_metadata jsonb;
  role_name text; item jsonb; fixture jsonb; outcome text; prior_reason text; first_outcome text; expected text;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  leading_arm constant text:=$arm$when noncurrent_reason is not null then
        case when p_action='RECONCILE_RESULT' and t.action='RECONCILE'
          and p_result->>'status'='COMPLETED' and p_result->'integrity_verified'='true'::jsonb
          and is_current is true and o.state='RECOVERY_REQUIRED' and o.environment='TESTNET'
          and o.noncurrent_reason='PROVIDER_INTEGRITY_UNPROVED'
          and o.envelope_id is not null and envelope=o.envelope_id
          and exists(select 1 from bx1_private.offering_signature_observations failed
            where failed.operation_id=o.id and failed.action in ('RECONCILE_RESULT','VOID_RESULT')
              and failed.result->>'status'='COMPLETED' and failed.result->'integrity_verified'='false'::jsonb)
          and (select count(*) from pg_catalog.jsonb_each(data))=6
          and not exists(select 1 from pg_catalog.jsonb_each(data) observed
            where observed.value->'observedAt' is null or pg_catalog.jsonb_typeof(observed.value->'observedAt') is distinct from 'number'
              or (observed.value->>'observedAt')::numeric<extract(epoch from t.created_at)*1000)
          then null else noncurrent_reason end
        $arm$;
  prior_observation constant text:=$prior$exists(select 1 from bx1_private.offering_signature_observations failed
            where failed.operation_id=o.id and failed.action in ('RECONCILE_RESULT','VOID_RESULT')
              and failed.result->>'status'='COMPLETED' and failed.result->'integrity_verified'='false'::jsonb)$prior$;
  baseline constant jsonb:='{"p_action":"RECONCILE_RESULT","attempt_action":"RECONCILE","status":"COMPLETED","integrity":true,"current":true,"state":"RECOVERY_REQUIRED","environment":"TESTNET","saved_envelope":"11111111-1111-4111-8111-111111111111","envelope":"11111111-1111-4111-8111-111111111111","prior_failed":true,"freshness":"FRESH"}';
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'offering_signature_integrity_recovery_proof_test_owner_required';end if;
  select pg_catalog.to_jsonb(p),p.prosrc into before_metadata,source from pg_catalog.pg_proc p where p.oid=target;
  if target is null or before_metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
    or before_metadata->'prosecdef' is distinct from 'true'::jsonb
    or before_metadata->>'provolatile' is distinct from 'v'
    or before_metadata->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_metadata->'proacl' is distinct from '["postgres=X/postgres","bx1_offering_signature_worker=X/postgres"]'::jsonb
    or (length(source)-length(replace(source,leading_arm,'')))/length(leading_arm)<>1 then
    raise exception 'offering_signature_integrity_recovery_proof_source_invalid';end if;
  restored:=replace(source,leading_arm,'');
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(replace(restored,E'\r\n',E'\n'),'UTF8')),'hex')
      is distinct from 'd31d2e4b27623a8dd6209d418f4eef4cb02d57e460d991e5efb98c4341995ccd'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(restored,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '79e30a303f934764ac4e3280975a912bc32a7db379ecaf13484d35a5e06b9ad6' then
    raise exception 'offering_signature_integrity_recovery_proof_outside_cut_changed';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,target,'EXECUTE') then
      raise exception 'offering_signature_integrity_recovery_proof_private_command_exposed';end if;
  end loop;
  if not pg_catalog.has_function_privilege('bx1_offering_signature_worker',target,'EXECUTE') then
    raise exception 'offering_signature_integrity_recovery_proof_existing_worker_missing';end if;

  -- Evaluate the WHOLE exact installed CASE, not a hand-written substitute.
  -- Replace only the historical-row EXISTS with a pure boolean fixture. All
  -- scope/state/resource predicates and the old null-reason branch stay real.
  expression:=pg_catalog.split_part(pg_catalog.split_part(source,'      noncurrent_reason=',2),E',\n      next_check_at=',1);
  if expression is null or pg_catalog.left(expression,5)<>'case '
    or (length(expression)-length(replace(expression,prior_observation,'')))/length(prior_observation)<>1 then
    raise exception 'offering_signature_integrity_recovery_proof_case_extraction_invalid';end if;
  expression:=replace(expression,prior_observation,'prior_failed');
  evaluate:=$evaluate$
    with value as (select $1::jsonb fixture,$2::text original_reason),
    input as (select original_reason,fixture->>'p_action' p_action,fixture->>'attempt_action' attempt_action,
      pg_catalog.jsonb_build_object('status',fixture->>'status')||case when fixture->>'omit_integrity'='true' then '{}'::jsonb
        else pg_catalog.jsonb_build_object('integrity_verified',fixture->'integrity') end p_result,
      (fixture->>'current')::boolean is_current,fixture->>'state' operation_state,fixture->>'environment' environment,
      (fixture->>'saved_envelope')::uuid saved_envelope,(fixture->>'envelope')::uuid envelope,
      (fixture->>'prior_failed')::boolean prior_failed,
      case when fixture->>'freshness'='MISSING' then null else
        (select pg_catalog.jsonb_object_agg(resource,case when fixture->>'freshness'='MISSING_FIELD' then '{}'::jsonb else
          pg_catalog.jsonb_build_object('observedAt',case when fixture->>'freshness'='STALE' then 1792022399999::numeric
            when fixture->>'freshness'='NULL_TIME' then null::numeric else 1792022400001::numeric end) end)
         from pg_catalog.unnest(array['envelope','recipients','documents','custom_fields','audit_events','tabs']) resources(resource)
         where fixture->>'freshness'<>'INCOMPLETE' or resource<>'tabs') end data
      from value)
    select $evaluate$||expression||$evaluate$
    from input cross join lateral (select input.operation_state state,input.environment environment,
      input.original_reason noncurrent_reason,input.saved_envelope envelope_id) o
    cross join lateral (select input.attempt_action action,'2026-10-15T00:00:00Z'::timestamptz created_at) t
  $evaluate$;

  -- Each false/NULL gate, each non-completion action/status and each resource
  -- freshness defect is denied independently. No fixture touches a real row.
  for item in select value from pg_catalog.jsonb_array_elements($cases$[
    {"label":"exact current fresh recovery","patch":{},"expected":null},
    {"label":"wrong result action","patch":{"p_action":"VOID_RESULT"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing result action","patch":{"p_action":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"wrong attempt action","patch":{"attempt_action":"VOID"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing attempt action","patch":{"attempt_action":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"sent result","patch":{"status":"SENT"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"unknown result","patch":{"status":"UNKNOWN"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing result status","patch":{"status":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"false integrity","patch":{"integrity":false},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"null integrity","patch":{"integrity":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing integrity","patch":{"omit_integrity":true},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"stale authority","patch":{"current":false},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"unknown authority","patch":{"current":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"other operation state","patch":{"state":"SENT"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing operation state","patch":{"state":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"MAIN environment","patch":{"environment":"MAINNET"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing environment","patch":{"environment":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing saved envelope","patch":{"saved_envelope":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"changed envelope","patch":{"envelope":"22222222-2222-4222-8222-222222222222"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing observed envelope","patch":{"envelope":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"no prior failure","patch":{"prior_failed":false},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"unknown prior failure","patch":{"prior_failed":null},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"old resource evidence","patch":{"freshness":"STALE"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing all evidence","patch":{"freshness":"MISSING"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"incomplete evidence set","patch":{"freshness":"INCOMPLETE"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"null observation time","patch":{"freshness":"NULL_TIME"},"expected":"PROVIDER_INTEGRITY_UNPROVED"},
    {"label":"missing observation time","patch":{"freshness":"MISSING_FIELD"},"expected":"PROVIDER_INTEGRITY_UNPROVED"}
  ]$cases$::jsonb) loop
    execute evaluate into outcome using baseline||(item->'patch'),'PROVIDER_INTEGRITY_UNPROVED';
    if outcome is distinct from item->>'expected' then
      raise exception 'offering_signature_integrity_recovery_case_failed:%',item->>'label';end if;
  end loop;

  -- Prove the old null->unproved behavior AND sequential false/good handling.
  -- Another historical reason must never first become the recoverable reason.
  foreach prior_reason in array array[null::text,'PROVIDER_INTEGRITY_UNPROVED','AUTHORITY_CHANGED',
      'PROVIDER_THROTTLED','LOOKUP_EXPIRED','OTHER_PRIVATE_REASON'] loop
    execute evaluate into first_outcome using baseline||'{"integrity":false}'::jsonb,prior_reason;
    expected:=coalesce(prior_reason,'PROVIDER_INTEGRITY_UNPROVED');
    if first_outcome is distinct from expected then
      raise exception 'offering_signature_integrity_recovery_false_result_laundered_reason';end if;
    execute evaluate into outcome using baseline,first_outcome;
    if outcome is distinct from (case when expected='PROVIDER_INTEGRITY_UNPROVED' then null else expected end) then
      raise exception 'offering_signature_integrity_recovery_good_result_laundered_reason';end if;
  end loop;
  execute evaluate into outcome using baseline,null::text;
  if outcome is not null then raise exception 'offering_signature_integrity_recovery_null_good_changed';end if;
  execute evaluate into outcome using baseline||'{"status":"SENT","integrity":false}'::jsonb,null::text;
  if outcome is not null then raise exception 'offering_signature_integrity_recovery_null_noncomplete_changed';end if;

  begin
    perform bx1_private.record_offering_signature_action('missing-worker',null,null,0,
      '00000000-0000-0000-0000-000000000001','RECONCILE_RESULT','{}'::jsonb);
    raise exception 'offering_signature_integrity_recovery_invalid_worker_accepted';
  exception when insufficient_privilege then null;end;
  if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=target) is distinct from before_metadata
    or before_claims is distinct from pg_catalog.current_setting('request.jwt.claims',true) then
    raise exception 'offering_signature_integrity_recovery_proof_changed_metadata_or_claims';end if;
end $signature_integrity_recovery_proof$;
