-- Query-only installation/closed-boundary proof; safe on the populated TEST.
-- Actual writer, audit rollback and concurrent CAS cases are exclusively in the
-- GITHUB_ACTIONS disposable PostgreSQL17 harness. This is not hosted MFA/Amoy proof.
do $setup_retry_catalog_proof$
declare signature text;role_name text;source text;claims text;denied boolean;
begin
  claims:=pg_catalog.current_setting('request.jwt.claims',true);
  if current_user<>'postgres' or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'setup_retry_proof_test_owner_required';end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='bx1_private.fund_setup_retry_leases'::regclass
    and relrowsecurity and relowner='postgres'::regrole)
    or exists(select 1 from pg_catalog.pg_policy where polrelid='bx1_private.fund_setup_retry_leases'::regclass) then
    raise exception 'setup_retry_proof_private_rls_required';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_fund_execution_worker'] loop
    if pg_catalog.has_table_privilege(role_name,'bx1_private.fund_setup_retry_leases','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'setup_retry_proof_raw_table_access_%',role_name;end if;
  end loop;
  foreach signature in array array['bx1_portal.read_fund_setup_retry(uuid,uuid,integer,uuid,jsonb)',
    'bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)'] loop
    if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(signature)
      and proowner='postgres'::regrole and prosecdef and provolatile='v' and proconfig=array['search_path=""']) then
      raise exception 'setup_retry_proof_metadata_%',signature;end if;
    if not pg_catalog.has_function_privilege('bx1_fund_execution_worker',signature,'EXECUTE') then
      raise exception 'setup_retry_proof_worker_missing_%',signature;end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'setup_retry_proof_public_helper_%_%',role_name,signature;end if;
    end loop;
  end loop;
  if (select count(*) from pg_catalog.pg_trigger where tgrelid='bx1_private.fund_setup_retry_leases'::regclass
    and not tgisinternal and tgfoid='bx1_portal.immutable_record()'::regprocedure and tgenabled='O')<>1 then
    raise exception 'setup_retry_proof_immutable_lease_required';end if;
  if not exists(select 1 from pg_catalog.pg_index where indexrelid='bx1_portal.fund_setup_nonce_lease'::regclass and indisunique)
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.fund_setup_steps'::regclass
      and tgname='fund_setup_steps_guard' and tgfoid='bx1_portal.fund_setup_mutation_guard()'::regprocedure) then
    raise exception 'setup_retry_proof_original_nonce_guard_required';end if;
  select prosrc into source from pg_catalog.pg_proc where oid='bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)'::regprocedure;
  if strpos(source,'if prior.actor_id is not null then')>=strpos(source,'perform bx1_portal.funding_require_revision(s.revision')
    or strpos(source,'insert into bx1_portal.fund_setup_requests')=0
    or strpos(source,'perform bx1_portal.fund_setup_audit')=0
    or strpos(source,'interval ''120 seconds''')=0 or strpos(source,'interval ''30 seconds''')=0
    or strpos(source,'retry_count>=3')=0
    or strpos(source,'if t.state<>''FINAL'' and (lease_id is null or (t.state=''UNKNOWN'' and t.transaction_hash is null)) then')=0
    or (length(source)-length(replace(source,'bx1_portal.fund_setup_package_approved(s.product_id)','')))/length('bx1_portal.fund_setup_package_approved(s.product_id)')<>2
    or strpos(source,'fund_setup_retry_finalized_nonce_invalid')=0
    or source like '%state=''PREPARED''%' or source like '%set claimed_at=%' or source like '%set expires_at=%'
    or source like '%set nonce=%' or source like '%set intent=%' then
    raise exception 'setup_retry_proof_bounded_writer_source_changed';end if;
  -- No actual user/session/claim is invented and no existing business row is called.
  denied:=false;
  begin perform bx1_portal.read_fund_setup_retry(null,null,null,null,null);
  exception when sqlstate '22023' then denied:=true;end;
  if not denied then raise exception 'setup_retry_proof_null_scope_accepted';end if;
  denied:=false;
  begin perform bx1_portal.record_fund_setup_retry('{}','UNKNOWN',null,'{}');
  exception when sqlstate '22023' then denied:=true;end;
  if not denied then raise exception 'setup_retry_proof_invalid_action_accepted';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims then
    raise exception 'setup_retry_proof_claims_changed';end if;
end $setup_retry_catalog_proof$;
