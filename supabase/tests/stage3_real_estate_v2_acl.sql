-- Run after the Stage 3 property migration on disposable cloud PostgreSQL in
-- both TESTNET and MAINNET fixture configurations. This is an ACL/seal proof,
-- not a complete product-workflow acceptance test.
do $property_v2_acl$
declare is_test boolean;
begin
  select environment='TESTNET' into strict is_test
    from bx1_portal.entry_configuration where singleton;
  if pg_catalog.has_function_privilege('authenticated',
      'bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)','EXECUTE')
      is distinct from is_test then
    raise exception 'property_v2_dispatcher_environment_acl_mismatch'; end if;
  if pg_catalog.has_function_privilege('authenticated',
      'public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)','EXECUTE')
      is distinct from is_test then
    raise exception 'property_v2_public_command_environment_acl_mismatch'; end if;
  if pg_catalog.has_function_privilege('authenticated',
      'bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)','EXECUTE') then
    raise exception 'property_v2_private_writer_executable'; end if;
  if pg_catalog.has_function_privilege('authenticated',
      'bx1_portal.validate_real_estate_terms_v2(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon',
      'bx1_portal.validate_real_estate_terms_v2(jsonb)','EXECUTE') then
    raise exception 'property_v2_validator_executable'; end if;
  if pg_catalog.has_function_privilege('anon',
      'bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
      'bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)','EXECUTE') then
    raise exception 'property_v2_dispatcher_publicly_executable'; end if;
end $property_v2_acl$;
