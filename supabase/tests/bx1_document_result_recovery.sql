-- Catalog and missing-evidence denial proof only; no positive scan is fabricated.
do $proof$
declare target oid;role_name text;source text;
begin
  target:='bx1_private.read_document_processing_recorded_result(uuid,uuid,bigint,text,text)'::regprocedure;
  select prosrc into source from pg_catalog.pg_proc where oid=target and proowner='postgres'::regrole::oid
    and prosecdef and proconfig=array['search_path=""']::text[];
  if source is null or strpos(source,'document_processing_authority(p_worker,p_scanner)')=0 then
    raise exception 'document_result_recovery_helper_invalid';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_document_receipt_writer',
    'bx1_document_processing_worker','bx1_fund_execution_worker','bx1_offering_signature_worker'] loop
    if pg_catalog.has_function_privilege(role_name,target,'EXECUTE') then
      raise exception 'document_result_recovery_reader_exposed';end if;
  end loop;
  if not pg_catalog.has_function_privilege('bx1_document_scanner_writer',target,'EXECUTE') then
    raise exception 'document_result_recovery_scanner_reader_missing';end if;
  begin
    perform bx1_private.read_document_processing_recorded_result(null,null,null,null,null);
    raise exception 'document_result_recovery_missing_evidence_accepted';
  exception when insufficient_privilege then null;end;
  begin
    perform bx1_private.read_document_processing_recorded_result(
      '00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000',1,'missing-worker','missing-scanner');
    raise exception 'document_result_recovery_zero_identity_accepted';
  exception when insufficient_privilege then null;end;
end $proof$;
