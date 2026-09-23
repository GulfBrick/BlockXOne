-- Synthetic cloud fixture: static schema, ACL, authority and cutover guards.
do $$
declare rel text; role_name text; signature text; body text;
begin
  for rel in select unnest(array['legal_entity_parties','investing_representative_mandates',
    'investing_representative_receipts']) loop
    if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='bx1_portal' and c.relname=rel and c.relrowsecurity) then
      raise exception 'entity_rls_missing_%',rel using errcode='55000'; end if;
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_portal.'||rel,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'entity_raw_table_grant_%_%',role_name,rel using errcode='55000'; end if;
    end loop;
  end loop;
  if exists(select 1 from bx1_portal.legal_entity_parties)
    or exists(select 1 from bx1_portal.investing_representative_mandates)
    or exists(select 1 from bx1_portal.investing_representative_receipts) then
    raise exception 'entity_migration_seeded_authority' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='bx1_portal.investment_accounts'::pg_catalog.regclass
      and conname='bx1_investment_account_holder_xor') then
    raise exception 'entity_holder_discriminator_missing' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='bx1_portal.subscriptions'::pg_catalog.regclass
      and conname='bx1_subscription_account_holder') then
    raise exception 'individual_order_fk_lost' using errcode='55000'; end if;
  foreach signature in array array[
    'bx1_portal.read_scoped_pre_entity(jsonb)',
    'bx1_portal.execute_scoped_pre_entity(jsonb,text,uuid,jsonb)',
    'bx1_portal.entity_staff_source_assured(jsonb)',
    'bx1_portal.entity_people_independent(uuid,uuid)',
    'bx1_portal.entity_account_admission_current(uuid)',
    'bx1_portal.investing_mandate_effective(uuid)'] loop
    foreach role_name in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(role_name,signature,'EXECUTE') then
        raise exception 'entity_bypass_grant_%_%',role_name,signature using errcode='55000'; end if;
    end loop;
  end loop;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.entity_people_independent(uuid,uuid)'::pg_catalog.regprocedure);
  if body not like '%p1.status = ''TRUSTED''%' and body not like '%p1.status=''TRUSTED''%' then
    raise exception 'entity_missing_trusted_person_gate' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)'::pg_catalog.regprocedure);
  if body not like '%execute_scoped_pre_entity%' or body not like '%entry_manual_review_enabled%'
    or body not like '%entity_people_independent%'
    or body not like '%entity_staff_source_assured%' then
    raise exception 'entity_command_gate_missing' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.read_scoped(jsonb)'::pg_catalog.regprocedure);
  if pg_catalog.strpos(body,'entity_staff_source_assured')=0
    or pg_catalog.strpos(body,'read_scoped_pre_entity')=0
    or pg_catalog.strpos(body,'entity_staff_source_assured')>pg_catalog.strpos(body,'read_scoped_pre_entity')
    or pg_catalog.strpos(body,'draft.status')=0
    or pg_catalog.strpos(body,'filtered_events')=0 then
    raise exception 'entity_staff_pii_gate_after_legacy_reader' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.scoped_reviewer(jsonb,uuid,uuid)'::pg_catalog.regprocedure);
  if pg_catalog.strpos(body,'entity_staff_source_assured')=0 then
    raise exception 'entity_shared_reviewer_pii_gate_missing' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('bx1_portal.investing_mandate_effective(uuid)'::pg_catalog.regprocedure);
  if body not like '%transaction_limit_minor = 0%' and body not like '%transaction_limit_minor=0%' then
    raise exception 'entity_zero_transaction_limit_missing' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)'::pg_catalog.regprocedure);
  if body not like '%bx1_portal.execute_scoped(operating_context,command,request_key,payload)%' then
    raise exception 'entity_public_command_not_rebound' using errcode='55000'; end if;
  body:=pg_catalog.pg_get_functiondef('public.bx1_portal_read_scoped(jsonb)'::pg_catalog.regprocedure);
  if body not like '%bx1_portal.read_scoped(operating_context)%' then
    raise exception 'entity_public_reader_not_rebound' using errcode='55000'; end if;
end $$;
