-- Disposable synthetic PostgreSQL17 fixture only. Run after the lifecycle
-- migration inside the existing rollback-only cloud test transaction.
do $$
declare role_name text; relation_name text;
  actor uuid:='ed400000-0000-4000-8000-000000000001';
  session_id uuid:='ed410000-0000-4000-8000-000000000001';
  application_id uuid:='ed430000-0000-4000-8000-000000000001';
  clean_id uuid:='ed420000-0000-4000-8000-000000000001';
  bad_id uuid:='ed420000-0000-4000-8000-000000000002';
  path text; sha text:=repeat('b',64); q jsonb; r jsonb;
begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres' then
    raise exception 'document_lifecycle_disposable_fixture_required'; end if;
  if (select mode from bx1_private.document_lifecycle_policy where singleton)<>'SYNTHETIC_TEST_ONLY'
    or exists(select 1 from bx1_private.document_quarantine_items)
    or exists(select 1 from bx1_private.document_scan_events)
    or exists(select 1 from bx1_private.document_hold_events) then
    raise exception 'document_lifecycle_not_empty_and_disabled'; end if;
  for relation_name in select unnest(array['document_lifecycle_policy','document_quarantine_items',
    'document_scan_events','document_hold_events']) loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
      on n.oid=c.relnamespace where n.nspname='bx1_private' and c.relname=relation_name) then
      raise exception 'document_lifecycle_rls_missing_%',relation_name; end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_document_receipt_writer','bx1_document_scanner_writer'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_private.'||relation_name,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'document_lifecycle_raw_grant_%_%',role_name,relation_name; end if;
    end loop;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,
      'bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)','EXECUTE')
      or pg_catalog.has_function_privilege(role_name,
      'bx1_private.promote_scanned_document(uuid)','EXECUTE') then
      raise exception 'document_lifecycle_writer_exposed_%',role_name; end if;
  end loop;
  if pg_catalog.has_function_privilege('bx1_document_receipt_writer',
    'bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)','EXECUTE')
    or pg_catalog.has_function_privilege('bx1_document_receipt_writer',
    'bx1_private.promote_scanned_document(uuid)','EXECUTE') then
    raise exception 'upload_writer_can_self_attest_clean'; end if;
  if not pg_catalog.has_function_privilege('bx1_document_receipt_writer',
    'bx1_private.register_quarantined_document(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('bx1_document_scanner_writer',
      'bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)','EXECUTE') then
    raise exception 'separated_document_writers_missing'; end if;

  -- MAIN's schema is reviewed while its entry-only seal remains untouched.
  if not exists(select 1 from bx1_portal.entry_configuration where singleton
    and environment='TESTNET' and manual_test_review) then return; end if;
  if not exists(select 1 from auth.users where email='portal-synthetic-1@example.invalid') then
    raise exception 'document_lifecycle_test_identity_missing'; end if;
  if not exists(select 1 from pg_catalog.pg_attribute
    where attrelid='auth.users'::regclass and attname='raw_user_meta_data' and not attisdropped) then
    execute 'alter table auth.users add column raw_user_meta_data jsonb not null default ''{}''::jsonb';
  end if;
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values(actor,'lifecycle-synthetic@example.invalid',pg_catalog.clock_timestamp(),false);
  insert into auth.sessions(id,user_id,not_after,created_at)
    values(session_id,actor,pg_catalog.clock_timestamp()+interval '1 hour',pg_catalog.clock_timestamp());
  insert into bx1_portal.applications(id,user_id,persona,status,details,origin,provider_mode)
    values(application_id,actor,'INVESTOR','DRAFT','{}','SELF_SERVICE','UNASSIGNED');
  begin
    update bx1_private.document_lifecycle_policy set mode='SCANNER_REQUIRED' where singleton;
    raise exception 'scanner_activated_without_receipt_enforcement';
  exception when object_not_in_prerequisite_state then
    if SQLERRM<>'document_scanner_activation_not_ready' then raise; end if;
  end;
  update bx1_private.document_receipt_policy set enforced=true,changed_at=pg_catalog.clock_timestamp()
    where singleton;
  update bx1_private.document_lifecycle_policy set mode='SCANNER_REQUIRED' where singleton;
  path:=actor::text||'/'||clean_id::text;
  begin
    insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata)
      values('bx1-portal-documents',path,actor::text,
        '{"size":25,"mimetype":"application/pdf"}'::jsonb,pg_catalog.jsonb_build_object('sha256',sha));
    raise exception 'unscanned_final_object_accepted';
  exception when check_violation then
    if SQLERRM<>'document_scan_required' then raise; end if;
  end;
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
    values('bx1-portal-quarantine',path,'{"size":25,"mimetype":"application/pdf"}'::jsonb,
      pg_catalog.jsonb_build_object('sha256',sha));
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object(
    'sub',actor,'session_id',session_id,'aal','aal1')::text,true);
  q:=bx1_private.register_quarantined_document(actor,session_id,clean_id,
    'IDENTITY','Synthetic clean evidence',sha,25,'application/pdf');
  if q->>'state'<>'QUARANTINED' or q->>'sha256'<>sha
    or bx1_private.document_disposal_eligible(clean_id) then
    raise exception 'quarantine_or_indefinite_retention_failed'; end if;
  -- A later mistaken switch of the legacy receipt flag cannot bypass
  -- scanner-required submission. The lifecycle mode itself forces the gate.
  update bx1_private.document_receipt_policy set enforced=false where singleton;
  begin
    update bx1_portal.applications set status='SUBMITTED',revision=revision+1,
      reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
      details=pg_catalog.jsonb_build_object('documents',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('id',clean_id,'kind','IDENTITY','title','Synthetic clean evidence',
          'storage_path',path,'sha256',sha,'size',25,'mime_type','application/pdf'))),
      submitted_at=pg_catalog.clock_timestamp() where id=application_id;
    raise exception 'scan_submission_bypassed_when_legacy_flag_off';
  exception when check_violation then
    if SQLERRM<>'document_receipt_required' then raise; end if;
  end;
  update bx1_private.document_receipt_policy set enforced=true where singleton;
  begin
    insert into bx1_private.document_upload_receipts
      (id,actor_id,session_id,storage_path,kind,title,sha256,byte_size,mime_type)
      values(clean_id,actor,session_id,path,'IDENTITY','Synthetic clean evidence',sha,25,'application/pdf');
    raise exception 'synthetic_receipt_accepted_in_scanner_mode';
  exception when check_violation then
    if SQLERRM<>'document_scan_required' then raise; end if;
  end;
  begin
    perform bx1_private.record_document_scan(clean_id,repeat('c',64),'fixture-scanner',
      'fixture-clean-00001','CLEAN',pg_catalog.clock_timestamp());
    raise exception 'wrong_scan_hash_accepted';
  exception when check_violation then
    if SQLERRM<>'document_scan_hash_mismatch' then raise; end if;
  end;
  q:=bx1_private.record_document_scan(clean_id,sha,'fixture-scanner',
    'fixture-clean-00001','CLEAN',pg_catalog.clock_timestamp());
  if q->>'state'<>'SCANNED_CLEAN' then raise exception 'clean_scan_not_recorded'; end if;
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
    values('bx1-portal-documents',path,'{"size":25,"mimetype":"application/pdf"}'::jsonb,
      pg_catalog.jsonb_build_object('sha256',sha));
  if (select owner_id from storage.objects where bucket_id='bx1-portal-documents' and name=path)<>actor::text then
    raise exception 'promoted_object_not_actor_bound'; end if;
  r:=bx1_private.promote_scanned_document(clean_id);
  if r->>'validation_state'<>'SCANNED_CLEAN'
    or (select validation_state from bx1_private.document_upload_receipts where id=clean_id)<>'SCANNED_CLEAN'
    or (select state from bx1_private.document_quarantine_items where id=clean_id)<>'PROMOTED' then
    raise exception 'scanned_document_not_promoted'; end if;
  if bx1_private.promote_scanned_document(clean_id)<>r then raise exception 'promotion_not_idempotent'; end if;
  update bx1_private.document_quarantine_items set retention_until=pg_catalog.clock_timestamp()-interval '1 day'
    where id=clean_id;
  insert into bx1_private.document_hold_events(document_id,action,reason,actor_id)
    values(clean_id,'PLACE','Synthetic litigation hold',actor);
  if bx1_private.document_disposal_eligible(clean_id) then raise exception 'legal_hold_ignored'; end if;
  insert into bx1_private.document_hold_events(document_id,action,reason,actor_id)
    values(clean_id,'RELEASE','Synthetic hold released',actor);
  if not bx1_private.document_disposal_eligible(clean_id) then raise exception 'retention_guard_incorrect'; end if;
  begin
    delete from storage.objects where bucket_id='bx1-portal-documents' and name=path;
    raise exception 'direct_sql_delete_accepted';
  exception when check_violation then
    if SQLERRM<>'portal_document_immutable' then raise; end if;
  end;
  path:=actor::text||'/'||bad_id::text;
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
    values('bx1-portal-quarantine',path,'{"size":25,"mimetype":"application/pdf"}'::jsonb,
      pg_catalog.jsonb_build_object('sha256',sha));
  perform bx1_private.register_quarantined_document(actor,session_id,bad_id,
    'IDENTITY','Synthetic rejected evidence',sha,25,'application/pdf');
  q:=bx1_private.record_document_scan(bad_id,sha,'fixture-scanner',
    'fixture-bad-000001','MALICIOUS',pg_catalog.clock_timestamp());
  if q->>'state'<>'REJECTED' then raise exception 'malicious_scan_not_rejected'; end if;
  begin
    perform bx1_private.promote_scanned_document(bad_id);
    raise exception 'malicious_document_promoted';
  exception when check_violation then
    if SQLERRM<>'document_scan_required' then raise; end if;
  end;
  begin
    update bx1_private.document_lifecycle_policy set mode='SYNTHETIC_TEST_ONLY' where singleton;
    raise exception 'scanner_downgrade_was_allowed';
  exception when object_not_in_prerequisite_state then
    if SQLERRM<>'document_scanner_downgrade_denied' then raise; end if;
  end;
end $$;
