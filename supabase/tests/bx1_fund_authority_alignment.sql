-- QUERY-ONLY installed boundary proof. No actor/claim/session is seeded here.
-- Real new-writer/CAS/audit tests run only in the disposable cloud PG17 harness.
do $alignment_catalog_proof$
declare spec jsonb;p pg_catalog.pg_proc;relation text;role_name text;signature text;claims text;denied boolean;
  expected constant jsonb:=$alignment_sources$[{"signature":"bx1_private.fund_alignment_operation_guard()","definer":false,"sha256":"bf643f17e7026edbd0465bd075d98eaeabaa885322462b57fbed4d70cca85d1e"},{"signature":"bx1_private.fund_alignment_binding(uuid)","definer":true,"sha256":"0b9aa9fb9f02bd8915ce9c23c9a13ebb89ac17031b0c5740135f16ff10e03812"},{"signature":"bx1_private.fund_alignment_snapshot_valid(jsonb)","definer":true,"sha256":"25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d"},{"signature":"bx1_private.fund_alignment_view(uuid,uuid,boolean)","definer":true,"sha256":"c08987000be5dc2ca33cf12572cfcb2d41121bc210d927c7bbf12b1299b1672a"},{"signature":"bx1_private.fund_alignment_execution_data(uuid)","definer":true,"sha256":"151ce7b10b4e7100fc853e1110bdc830252579087f3446866960316a0e8057ee"},{"signature":"bx1_private.fund_alignment_enter(uuid,uuid,text)","definer":true,"sha256":"9bc75c6e1784d4486a40e618651b5a7d07a19359be82ed1e3a2ae80d19567dca"},{"signature":"bx1_private.fund_alignment_consume(uuid,uuid,text)","definer":true,"sha256":"37acae3589d890881a101fda9aa24dd1a6176f208dc6d6ba6122878a174ebe66"},{"signature":"public.bx1_portal_fund_alignment_authorise(uuid,integer,jsonb,text)","definer":true,"sha256":"63828cea69e82644c8c16754c1abbae15492880480905027ce1a8f5a9c770fbe"},{"signature":"bx1_portal.read_fund_authority_alignment(uuid,uuid,jsonb,uuid)","definer":true,"sha256":"345c15b05ffebcc1a5308e24b7e26c689087b4e7332392cb2d9e4e60e6a1c24e"},{"signature":"bx1_portal.record_fund_authority_alignment(jsonb,text,uuid,jsonb,uuid)","definer":true,"sha256":"ee2e89dc3cc0a4c0caa3167d1efa93ffdd5d55c16273b6d8b69b186c66ad1dc2"},{"signature":"bx1_portal.read_fund_admission_authorised(uuid,uuid)","definer":true,"sha256":"a7400ab9955307343c9dbf8b03d0bd1d14765fb9f01cb02396cd8780a43e8ac0"},{"signature":"bx1_portal.record_fund_admission_authorised(uuid,jsonb,text,uuid)","definer":true,"sha256":"5cb502738f6b49ed65e0949aece6586e4da3143698db785a973229c0e07f00d3"}]$alignment_sources$;
begin
  claims:=pg_catalog.current_setting('request.jwt.claims',true);
  if current_user<>'postgres' or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'alignment_proof_exact_test_owner_required';end if;
  select * into strict p from pg_catalog.pg_proc where oid='bx1_portal.fund_admission_worker_enter(uuid)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>'2e85e284036dd632e186c963bb698ec7f67bb550e0d6e9359eec0516b6a756ec'
    or p.proowner<>'postgres'::regrole or not p.prosecdef or p.proacl::text<>'{postgres=X/postgres}' or p.proconfig is distinct from array['search_path=""']
    or pg_catalog.strpos(p.prosrc,'perform bx1_portal.fund_setup_lock(r.operating_context,r.product_id,true);')=0
    or pg_catalog.strpos(p.prosrc,'perform bx1_portal.fund_admission_seed(r.setup_id,r.setup_revision,r.operating_context);')=0
    or pg_catalog.strpos(p.prosrc,'r.actor_claims::text')<>0 then raise exception 'alignment_proof_worker_delta';end if;
  for spec in select value from pg_catalog.jsonb_array_elements(expected) loop
    select * into strict p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(spec->>'signature');
    if p.proowner<>'postgres'::regrole or p.prosecdef is distinct from (spec->>'definer')::boolean or p.proconfig is distinct from array['search_path=""']
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') is distinct from spec->>'sha256' then
      raise exception 'alignment_proof_helper_source: %',spec->>'signature';end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_function_privilege(role_name,p.oid,'EXECUTE') is distinct from
        ((role_name='authenticated' and spec->>'signature'='public.bx1_portal_fund_alignment_authorise(uuid,integer,jsonb,text)')
          or (role_name='bx1_fund_execution_worker' and (spec->>'signature') in ('bx1_portal.read_fund_authority_alignment(uuid,uuid,jsonb,uuid)',
            'bx1_portal.record_fund_authority_alignment(jsonb,text,uuid,jsonb,uuid)','bx1_portal.read_fund_admission_authorised(uuid,uuid)',
            'bx1_portal.record_fund_admission_authorised(uuid,jsonb,text,uuid)'))) then raise exception 'alignment_proof_helper_acl';end if;
    end loop;
  end loop;
  foreach relation in array array['fund_alignment_operations','fund_alignment_signatures','fund_alignment_authorisations','fund_alignment_consumptions',
    'fund_alignment_requests','fund_alignment_attempts','fund_alignment_observations'] loop
    if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('bx1_private.'||relation) and relrowsecurity and relowner='postgres'::regrole)
      or exists(select 1 from pg_catalog.pg_policy where polrelid=pg_catalog.to_regclass('bx1_private.'||relation)) then raise exception 'alignment_proof_private_rls';end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_private.'||relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'alignment_proof_raw_table_access';end if;
    end loop;
    if not exists(select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('bx1_private.'||relation) and not tgisinternal and tgenabled='O'
      and tgfoid=case when relation='fund_alignment_operations' then 'bx1_private.fund_alignment_operation_guard()'::regprocedure else 'bx1_portal.immutable_record()'::regprocedure end) then
      raise exception 'alignment_proof_history_guard';end if;
  end loop;
  -- Null scopes fail before any business mutation or captured-claim entry.
  denied:=false;begin perform public.bx1_portal_fund_alignment_authorise(null,null,null,'ALIGNMENT_READ');
  exception when sqlstate '42501' then denied:=true;end;
  if not denied then raise exception 'alignment_proof_null_authorisation';end if;
  denied:=false;begin perform bx1_portal.fund_admission_worker_enter(null);
  exception when sqlstate '42501' then denied:=true;end;
  if not denied then raise exception 'alignment_proof_direct_old_helper';end if;
  if bx1_private.fund_alignment_snapshot_valid('{}'::jsonb) is not false
    or bx1_private.fund_alignment_snapshot_valid('{"block":{"number":"1","hash":null,"timestamp":"2026-10-19T00:00:00Z"},"providers":[]}'::jsonb) is not false then
    raise exception 'alignment_proof_null_snapshot';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims then raise exception 'alignment_proof_claims_changed';end if;
end $alignment_catalog_proof$;
