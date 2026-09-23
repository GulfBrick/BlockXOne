-- Static acceptance for the additive, read-only application-history boundary.
-- The connected actor tests run in the disposable portal cloud fixture.
do $$
declare role_name text; history_body text; lookup_body text; access_body text; storage_body text;
begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres'
    or to_regclass('bx1_portal.application_detail_versions') is null then
    raise exception 'document_history_proof_disposable_fixture_required'; end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c
    where c.oid='bx1_portal.application_detail_versions'::pg_catalog.regclass)
    or not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid='bx1_portal.application_detail_versions'::pg_catalog.regclass
        and t.tgname='bx1_application_detail_version_immutable' and t.tgenabled='O') then
    raise exception 'document_history_immutable_rls_missing'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_table_privilege(role_name,'bx1_portal.application_detail_versions','SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_function_privilege(role_name,'bx1_portal.application_document_access(uuid,jsonb)','EXECUTE') then
      raise exception 'document_history_private_source_exposed_%',role_name; end if;
  end loop;
  if pg_catalog.has_function_privilege('anon','public.bx1_application_document_versions(uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','bx1_portal.object_readable(text)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.bx1_application_document_versions(uuid,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.bx1_application_document_versions(uuid,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','bx1_portal.object_readable(text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)','EXECUTE') then
    raise exception 'document_history_rpc_grants_invalid'; end if;
  select pg_catalog.pg_get_functiondef('bx1_portal.application_document_access(uuid,jsonb)'::pg_catalog.regprocedure)
    into access_body;
  select pg_catalog.pg_get_functiondef('public.bx1_application_document_versions(uuid,jsonb)'::pg_catalog.regprocedure)
    into history_body;
  select pg_catalog.pg_get_functiondef('public.bx1_application_document_lookup(uuid,integer,uuid,jsonb)'::pg_catalog.regprocedure)
    into lookup_body;
  select pg_catalog.pg_get_functiondef('bx1_portal.object_readable(text)'::pg_catalog.regprocedure)
    into storage_body;
  if access_body not like '%fresh_session()%'
    or access_body not like '%entry_manual_review_enabled()%'
    or access_body not like '%has_session_mfa()%'
    or access_body not like '%has_token_mfa()%'
    or access_body not like '%factor_type%totp%'
    or access_body not like '%scoped_reviewer%'
    or history_body not like '%application_detail_versions%'
    or history_body like '%storage_path%'
    or lookup_body not like '%application_detail_versions%'
    or lookup_body not like '%storage.objects%'
    or lookup_body not like '%application_document_access%'
    or lookup_body not like '%claimed_sha256%'
    or storage_body not like '%fresh_session()%'
    or storage_body not like '%entry_manual_review_enabled()%'
    or storage_body not like '%has_session_mfa()%'
    or storage_body not like '%has_token_mfa()%'
    or storage_body not like '%application_detail_versions%'
    or storage_body not like '%application_document_access%'
    or storage_body like '%storage.objects%'
    or not exists(select 1 from pg_catalog.pg_proc p
      where p.oid='bx1_portal.object_readable(text)'::pg_catalog.regprocedure
        and p.prosecdef and p.provolatile='v') then
    raise exception 'document_history_manifest_or_authority_contract_invalid'; end if;
end $$;
