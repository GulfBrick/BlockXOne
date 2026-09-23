-- Static invariants for both hosted synthetic TEST fixture variants and MAIN.
-- Dynamic applicant/reviewer/subscribe gates are proved by the JS cloud runners.
do $$ declare rel text; signature text; role_name text; begin
  for rel in select unnest(array['product_eligibility_cases','product_eligibility_receipts']) loop
    if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bx1_portal' and c.relname=rel and c.relrowsecurity)<>1 then
      raise exception 'eligibility_rls_missing_%',rel using errcode='55000'; end if;
    if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bx1_portal' and c.relname=rel)<>1 then
      raise exception 'eligibility_table_missing_%',rel using errcode='55000'; end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_portal.'||rel,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'eligibility_raw_table_grant_%_%',role_name,rel using errcode='55000'; end if;
    end loop;
  end loop;
  if exists(select 1 from bx1_portal.product_eligibility_cases)
    or exists(select 1 from bx1_portal.product_eligibility_receipts) then
    raise exception 'eligibility_migration_seeded_case' using errcode='55000'; end if;
  foreach signature in array array[
    'bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)',
    'bx1_portal.read_scoped_pre_eligibility(jsonb)',
    'bx1_portal.product_eligibility_current(uuid)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'eligibility_bypass_grant_%_%',role_name,signature using errcode='55000'; end if;
    end loop;
  end loop;
  if pg_catalog.pg_get_functiondef('public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)'::pg_catalog.regprocedure)
      not like '%bx1_portal.execute_scoped(operating_context,command,request_key,payload)%' then
    raise exception 'eligibility_public_writer_not_rebound' using errcode='55000'; end if;
  if pg_catalog.pg_get_functiondef('public.bx1_portal_read_scoped(jsonb)'::pg_catalog.regprocedure)
      not like '%bx1_portal.read_scoped(operating_context)%' then
    raise exception 'eligibility_public_reader_not_rebound' using errcode='55000'; end if;
end $$;
