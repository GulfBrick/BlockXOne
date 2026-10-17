-- Pure value equivalence and null-context denial only. This does NOT set Auth
-- claims, create a session, forge an ownership proof or bind a signer.
-- Run inside the owner TEST install transaction; ROLLBACK by default.

do $fund_roleplay_wallet_uid_proof$
declare
  target oid:=pg_catalog.to_regprocedure('bx1_private.lock_roleplay_wallet_proof(uuid,uuid,uuid)');
  uid_function oid:=pg_catalog.to_regprocedure('auth.uid()');
  source text;uid_source text;old_expression text;new_expression text;old_query text;new_query text;
  before_function jsonb;before_uid jsonb;before_namespaces jsonb;before_memberships jsonb;
  before_claims text:=pg_catalog.current_setting('request.jwt.claims',true);
  before_sub text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
  item jsonb;old_value uuid;new_value uuid;old_error text;new_error text;role_name text;denial text;
  inline_uid constant text:=$uid$coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$uid$;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'fund_roleplay_wallet_uid_proof_test_owner_required';end if;
  select pg_catalog.to_jsonb(p),p.prosrc into before_function,source from pg_catalog.pg_proc p where p.oid=target;
  select pg_catalog.to_jsonb(p),p.prosrc into before_uid,uid_source from pg_catalog.pg_proc p where p.oid=uid_function;
  if target is null or uid_function is null
    or (length(source)-length(replace(source,inline_uid,'')))/length(inline_uid)<>1
    or strpos(source,'auth.uid()')<>0
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      replace(replace(source,inline_uid,'auth.uid()'),E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '2fa6f5d32aa02b96a679965a31b8c0e9e30ecaf86a09ec9e2633586008e57826'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(replace(uid_source,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from '09131370dbc9061be86b1bd9578632dc7c94c0ba189275a60ae3c5ef45feec16'
    or before_function->>'proowner' is distinct from 'bx1_wallet_owner'::regrole::oid::text
    or before_function->'prosecdef' is distinct from 'true'::jsonb
    or before_function->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or before_function->'proacl' is distinct from '["bx1_wallet_owner=X/bx1_wallet_owner","postgres=X/bx1_wallet_owner"]'::jsonb then
    raise exception 'fund_roleplay_wallet_uid_proof_source_or_metadata_invalid';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_wallet_verifier','bx1_fund_execution_worker'] loop
    if pg_catalog.has_function_privilege(role_name,target,'EXECUTE') then
      raise exception 'fund_roleplay_wallet_uid_proof_lock_helper_exposed';end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.oid) into before_namespaces from pg_catalog.pg_namespace n;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb)
    into before_memberships from pg_catalog.pg_auth_members m;

  -- Evaluate the pinned native expression and its exact inline replacement on
  -- supplied VALUES. Actual request settings are neither changed nor forged.
  old_expression:=pg_catalog.regexp_replace(pg_catalog.btrim(uid_source,E' \n\t'),'^select[[:space:]]+','');
  old_expression:=replace(old_expression,'current_setting(''request.jwt.claim.sub'', true)','fixture.claim_sub');
  old_expression:=replace(old_expression,'current_setting(''request.jwt.claims'', true)','fixture.claims');
  new_expression:=replace(inline_uid,'pg_catalog.current_setting(''request.jwt.claim.sub'',true)','fixture.claim_sub');
  new_expression:=replace(new_expression,'pg_catalog.current_setting(''request.jwt.claims'',true)','fixture.claims');
  if strpos(old_expression,'current_setting')<>0 or strpos(new_expression,'current_setting')<>0 then
    raise exception 'fund_roleplay_wallet_uid_proof_expression_binding_invalid';end if;
  old_query:='select '||old_expression||' from (values($1::text,$2::text)) fixture(claim_sub,claims)';
  new_query:='select '||new_expression||' from (values($1::text,$2::text)) fixture(claim_sub,claims)';
  for item in select value from pg_catalog.jsonb_array_elements($cases$[
    {"claim_sub":null,"claims":null},
    {"claim_sub":"","claims":""},
    {"claim_sub":null,"claims":"{}"},
    {"claim_sub":null,"claims":"{\"sub\":null}"},
    {"claim_sub":null,"claims":"{\"sub\":\"11111111-1111-4111-8111-111111111111\"}"},
    {"claim_sub":"","claims":"{\"sub\":\"11111111-1111-4111-8111-111111111111\"}"},
    {"claim_sub":"22222222-2222-4222-8222-222222222222","claims":"{\"sub\":\"11111111-1111-4111-8111-111111111111\"}"},
    {"claim_sub":"22222222-2222-4222-8222-222222222222","claims":"not-json"},
    {"claim_sub":null,"claims":"not-json"},
    {"claim_sub":null,"claims":"{\"sub\":\"not-uuid\"}"},
    {"claim_sub":"not-uuid","claims":"{\"sub\":\"11111111-1111-4111-8111-111111111111\"}"},
    {"claim_sub":null,"claims":"{\"sub\":\"\"}"}
  ]$cases$::jsonb) loop
    old_value:=null;new_value:=null;old_error:=null;new_error:=null;
    begin execute old_query into old_value using item->>'claim_sub',item->>'claims';
    exception when others then get stacked diagnostics old_error=returned_sqlstate;end;
    begin execute new_query into new_value using item->>'claim_sub',item->>'claims';
    exception when others then get stacked diagnostics new_error=returned_sqlstate;end;
    if old_value is distinct from new_value or old_error is distinct from new_error then
      raise exception 'fund_roleplay_wallet_uid_proof_native_semantics_changed';end if;
  end loop;
  begin
    perform bx1_private.lock_roleplay_wallet_proof(null,null,null);
    raise exception 'fund_roleplay_wallet_uid_proof_missing_context_accepted';
  exception when insufficient_privilege then
    get stacked diagnostics denial=message_text;
    if denial is distinct from 'roleplay_wallet_lock_current_proof_required' then
      raise exception 'fund_roleplay_wallet_uid_proof_wrong_denial';end if;
  end;
  if (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=target) is distinct from before_function
    or (select pg_catalog.to_jsonb(p) from pg_catalog.pg_proc p where p.oid=uid_function) is distinct from before_uid
    or (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.oid) from pg_catalog.pg_namespace n) is distinct from before_namespaces
    or (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) order by m.oid),'[]'::jsonb) from pg_catalog.pg_auth_members m) is distinct from before_memberships
    or before_claims is distinct from pg_catalog.current_setting('request.jwt.claims',true)
    or before_sub is distinct from pg_catalog.current_setting('request.jwt.claim.sub',true) then
    raise exception 'fund_roleplay_wallet_uid_proof_changed_context_or_metadata';end if;
end $fund_roleplay_wallet_uid_proof$;
