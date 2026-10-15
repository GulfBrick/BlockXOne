-- TEST only: a later genuine scan may supplement an immutable historical
-- SYNTHETIC_UNSCANNED upload receipt. Never rewrite that receipt or its history.
-- Definitions only: no scan, CLAIM, result, promotion or provider outcome is run.
-- The caller owns the atomic transaction and the subsequent authenticated replay.

do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or not exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SCANNER_REQUIRED')
    or not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
    or pg_catalog.to_regprocedure('bx1_private.document_scan_legacy_overlay_current(uuid,boolean)') is not null
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_private.document_upload_receipts'::regclass
      and tgname='bx1_document_receipt_immutable' and not tgisinternal and tgenabled in ('O','A') and tgtype=27
      and tgfoid='bx1_portal.immutable_record()'::regprocedure) then
    raise exception 'document_scan_overlay_exact_test_baseline_required' using errcode='55000';end if;
end $baseline$;

-- Evidence-state predicate only; not document access or new scanner authority.
-- The real BFF still authenticates the original result and independently
-- downloads/rehashes BOTH objects before invoking canonical promotion.
create function bx1_private.document_scan_legacy_overlay_current(target uuid,allow_pending boolean default false) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.document_upload_receipts receipt
    join bx1_private.document_quarantine_items item on item.id=receipt.id and item.actor_id=receipt.actor_id
      and item.storage_path=receipt.storage_path and item.sha256=receipt.sha256
      and item.byte_size=receipt.byte_size and item.mime_type=receipt.mime_type
      and item.kind=receipt.kind and item.title=receipt.title
    join bx1_private.document_processing_jobs job on job.document_id=item.id and job.actor_id=item.actor_id
      and job.storage_path=item.storage_path and job.sha256=item.sha256
      and job.byte_size=item.byte_size and job.mime_type=item.mime_type
    join bx1_private.document_processing_attempts attempt on attempt.id=job.current_attempt_id
      and attempt.document_id=item.id and attempt.attempt_number=job.attempt_number and attempt.outcome='CLEAN'
    join bx1_private.document_scan_events scan on scan.document_id=item.id and scan.verdict='CLEAN'
      and scan.sha256=item.sha256 and scan.scanner_id=attempt.scanner_id and scan.scanner_reference=attempt.reference
      and scan.scanner_id=item.scanner_id and scan.scanner_reference=item.scanner_reference
    join bx1_private.document_processing_policy policy on policy.singleton and policy.state='ADMITTED'
      and policy.authority_epoch=attempt.authority_epoch and policy.worker_id=attempt.worker_id and policy.scanner_id=attempt.scanner_id
    join bx1_private.document_lifecycle_policy lifecycle on lifecycle.singleton and lifecycle.mode='SCANNER_REQUIRED'
    join bx1_private.document_receipt_policy enforced on enforced.singleton and enforced.enforced
    join bx1_portal.entry_configuration environment on environment.singleton and environment.environment='TESTNET'
    join storage.objects stored on stored.bucket_id='bx1-portal-documents' and stored.name=item.storage_path
      and stored.owner_id=item.actor_id::text and stored.metadata->>'size'=item.byte_size::text
      and stored.metadata->>'mimetype'=item.mime_type and stored.user_metadata->>'sha256'=item.sha256
    where receipt.id=target and receipt.validation_state='SYNTHETIC_UNSCANNED'
      and receipt.verified_at<=item.created_at and attempt.finished_at is not null
      and attempt.reference='bx1-scan:'||attempt.id::text
      and exists(select 1 from bx1_private.document_processing_events evidence where evidence.document_id=item.id
        and evidence.attempt_id=attempt.id and evidence.kind='RESULT_RECORDED'
        and evidence.evidence->>'sha256'=item.sha256 and evidence.evidence->>'verdict'='CLEAN'
        and evidence.evidence->>'scanner_id'=attempt.scanner_id and evidence.evidence->>'reference'=attempt.reference
        and evidence.evidence->>'authority_epoch'=attempt.authority_epoch::text)
      and ((allow_pending is true and item.state='SCANNED_CLEAN' and item.promoted_at is null and job.state='RESULT_RECORDED')
        or (item.state='PROMOTED' and item.promoted_at is not null and job.state='COMPLETED'
          and exists(select 1 from bx1_private.document_processing_events completed where completed.document_id=item.id
            and completed.attempt_id=attempt.id and completed.kind='COMPLETED'
            and completed.evidence->>'sha256'=item.sha256 and completed.evidence->>'reference'=attempt.reference
            and completed.evidence->>'authority_epoch'=attempt.authority_epoch::text)))),false);
$$;
do $private_acl$
declare grantee text;
begin
  for grantee in select distinct case when a.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(r.rolname) end
    from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid='bx1_private.document_scan_legacy_overlay_current(uuid,boolean)'::regprocedure and a.grantee<>p.proowner loop
    execute pg_catalog.format('revoke all on function bx1_private.document_scan_legacy_overlay_current(uuid,boolean) from %s',grantee);
  end loop;
end $private_acl$;

-- Four body-only cuts. Preserve the installed OIDs, owners, ACLs, session/MFA,
-- actor/scope, byte/hash, immutability and historical-reference checks.
do $cutover$
declare spec jsonb;change jsonb;target oid;before_row jsonb;after_row jsonb;original text;next_body text;definition text;occurrences integer;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($recipes$[
    {"signature":"bx1_private.promote_scanned_document_pre_processing(uuid)","sha256":"8a58a86b3aa9edb8594bd283fb1251f86b639065c964769e6f5a54a5dd811a66","changes":[
      {"from":"or r.storage_path is distinct from q.storage_path or r.validation_state<>'SCANNED_CLEAN' then",
       "to":"or r.storage_path is distinct from q.storage_path or (r.validation_state<>'SCANNED_CLEAN'\n      and bx1_private.document_scan_legacy_overlay_current(q.id,true) is not true) then"}]},
    {"signature":"public.bx1_document_scan_status(uuid)","sha256":"bee2e3daf995c4ce2a688ececbbbfe650dc2887943de389e25eb78208308fcf0","changes":[
      {"from":"where id=q.id and actor_id=q.actor_id and validation_state='SCANNED_CLEAN';",
       "to":"where id=q.id and actor_id=q.actor_id and (validation_state='SCANNED_CLEAN'\n        or bx1_private.document_scan_legacy_overlay_current(q.id));"}]},
    {"signature":"bx1_private.guard_application_document_receipts()","sha256":"01885f8daa926fd1846ee43f5cf2580a5fe268604df59d3cda4e23f402031322","changes":[
      {"from":"or (lifecycle_mode='SCANNER_REQUIRED' and r.validation_state<>'SCANNED_CLEAN'\n          and not exists",
       "to":"or (lifecycle_mode='SCANNER_REQUIRED' and r.validation_state<>'SCANNED_CLEAN'\n          and bx1_private.document_scan_legacy_overlay_current(r.id) is not true\n          and not exists"}]},
    {"signature":"bx1_portal.object_readable(text)","sha256":"ebd421331d5a2b09d189c6bcfce21d15a17b18899266759191734186ea3616a3","changes":[
      {"from":"where r.storage_path=object_name and r.validation_state='SCANNED_CLEAN')",
       "to":"where r.storage_path=object_name and (r.validation_state='SCANNED_CLEAN'\n        or bx1_private.document_scan_legacy_overlay_current(r.id)))"}]}
  ]$recipes$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    next_body:=pg_catalog.replace(original,E'\r\n',E'\n');
    if target is null or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb
      or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(next_body,'UTF8')),'hex') is distinct from spec->>'sha256' then
      raise exception 'document_scan_overlay_native_body_changed: %',spec->>'signature' using errcode='55000';end if;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(length(next_body)-length(replace(next_body,change->>'from','')))/length(change->>'from');
      if occurrences<>1 then raise exception 'document_scan_overlay_cut_not_unique: %',spec->>'signature' using errcode='55000';end if;
      next_body:=replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'document_scan_overlay_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'document_scan_overlay_native_metadata_changed' using errcode='55000';end if;
  end loop;
end $cutover$;
