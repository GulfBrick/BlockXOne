-- Native TEST catalog/negative proof only. No document, signature, result,
-- scanner message, CLAIM, scan or promotion is created or executed here.
do $overlay_proof$
declare source text;role_name text;target oid;before_receipts text;after_receipts text;
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    raise exception 'document_scan_overlay_proof_test_owner_required';end if;
  target:='bx1_private.document_scan_legacy_overlay_current(uuid,boolean)'::regprocedure;
  select prosrc into source from pg_catalog.pg_proc where oid=target and proowner='postgres'::regrole::oid
    and prosecdef and proconfig=array['search_path=""']::text[];
  if source is null or strpos(source,$needle$receipt.validation_state='SYNTHETIC_UNSCANNED'$needle$)=0 then
    raise exception 'document_scan_overlay_proof_helper_invalid';end if;
  foreach role_name in array array['anon','authenticated','service_role','bx1_document_receipt_writer',
    'bx1_document_scanner_writer','bx1_document_processing_worker','bx1_fund_execution_worker','bx1_offering_signature_worker'] loop
    if pg_catalog.has_function_privilege(role_name,target,'EXECUTE') then
      raise exception 'document_scan_overlay_proof_helper_exposed';end if;
  end loop;
  if bx1_private.document_scan_legacy_overlay_current(null) is not false
    or bx1_private.document_scan_legacy_overlay_current('00000000-0000-4000-8000-000000000099'::uuid,true) is not false
    or bx1_private.document_scan_legacy_overlay_current('00000000-0000-4000-8000-000000000099'::uuid,false) is not false then
    raise exception 'document_scan_overlay_proof_missing_evidence_accepted';end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.document_upload_receipts'::regclass
    and tgname='bx1_document_receipt_immutable' and not tgisinternal and tgenabled in ('O','A')
    and tgfoid='bx1_portal.immutable_record()'::regprocedure) then
    raise exception 'document_scan_overlay_proof_historical_immutability_missing';end if;
  select prosrc into source from pg_catalog.pg_proc where oid='bx1_portal.immutable_record()'::regprocedure;
  if strpos(source,$needle$raise exception 'portal_history_immutable'$needle$)=0 then
    raise exception 'document_scan_overlay_proof_historical_guard_changed';end if;
  -- Function installation never upgrades an immutable receipt, including the
  -- actual recovery item. Genuine completion must use authenticated BFF replay.
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(receipt)::text,E'\n' order by receipt.id),''),'UTF8')),'hex') into before_receipts
    from bx1_private.document_upload_receipts receipt;
  perform bx1_private.document_scan_legacy_overlay_current(null,true);
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
    pg_catalog.to_jsonb(receipt)::text,E'\n' order by receipt.id),''),'UTF8')),'hex') into after_receipts
    from bx1_private.document_upload_receipts receipt;
  if before_receipts is distinct from after_receipts then raise exception 'document_scan_overlay_proof_receipt_mutated';end if;
end $overlay_proof$;
