-- Static, synthetic cloud fixture invariants. This file mutates no records.
do $$
declare rel text; signature text; role_name text; body text;
begin
  for rel in select unnest(array['representative_mandates','representative_mandate_receipts',
    'representative_mandate_requests']) loop
    if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bx1_portal' and c.relname=rel and c.relrowsecurity)<>1 then
      raise exception 'mandate_rls_missing_%',rel using errcode='55000'; end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_portal.'||rel,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'mandate_raw_table_grant_%_%',role_name,rel using errcode='55000'; end if;
    end loop;
  end loop;
  if exists(select 1 from bx1_portal.representative_mandates)
    or exists(select 1 from bx1_portal.representative_mandate_receipts)
    or exists(select 1 from bx1_portal.representative_mandate_requests) then
    raise exception 'mandate_migration_seeded_authority' using errcode='55000'; end if;
  foreach signature in array array[
    'bx1_portal.entry_read_pre_mandate()',
    'bx1_portal.read_scoped_pre_mandate(jsonb)',
    'bx1_portal.entry_command_pre_mandate(text,uuid,jsonb)',
    'bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb)',
    'bx1_portal.representative_mandate_effective(uuid)',
    'bx1_portal.representative_mandate_actor(jsonb,uuid,text)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'mandate_bypass_grant_%_%',role_name,signature using errcode='55000'; end if;
    end loop;
  end loop;
  if pg_catalog.pg_get_functiondef('public.bx1_entry_command(text,uuid,jsonb)'::pg_catalog.regprocedure)
      not like '%bx1_portal.entry_command(command,request_key,payload)%'
    or pg_catalog.pg_get_functiondef('public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)'::pg_catalog.regprocedure)
      not like '%bx1_portal.execute_scoped(operating_context,command,request_key,payload)%' then
    raise exception 'mandate_public_writer_not_rebound' using errcode='55000'; end if;
  if pg_catalog.pg_get_functiondef('public.bx1_entry_read()'::pg_catalog.regprocedure)
      not like '%bx1_portal.entry_read()%'
    or pg_catalog.pg_get_functiondef('public.bx1_portal_read_scoped(jsonb)'::pg_catalog.regprocedure)
      not like '%bx1_portal.read_scoped(operating_context)%' then
    raise exception 'mandate_public_reader_not_rebound' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.scoped_operator(jsonb,uuid)'::pg_catalog.regprocedure);
  if body not like '%LEGACY_REHEARSAL%' or body not like '%representative_mandate_effective%' then
    raise exception 'mandate_legacy_owner_or_new_customer_gate_missing' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.representative_mandate_actor(jsonb,uuid,text)'::pg_catalog.regprocedure);
  if body not like '%aal2%' or body not like '%mfa_factors%' then
    raise exception 'mandate_real_mfa_gate_missing' using errcode='55000'; end if;
end $$;
