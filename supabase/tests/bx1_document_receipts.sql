-- Disposable PostgreSQL17 cloud fixture only; NEVER run on a hosted project.
-- The receipt policy is enabled briefly inside a test transaction, then
-- returned to its migration default. This is not a production cutover.
do $$
declare relation_name text; role_name text; application_a uuid:='ed300000-0000-4000-8000-000000000001';
  application_b uuid:='ed300000-0000-4000-8000-000000000002';
  application_c uuid:='ed300000-0000-4000-8000-000000000003';
  actor_a uuid:='ed000000-0000-4000-8000-000000000001';
  actor_b uuid:='ed000000-0000-4000-8000-000000000002';
  session_a uuid:='ed100000-0000-4000-8000-000000000001';
  v_receipt_id uuid:='ed200000-0000-4000-8000-000000000001';
  path text; sha text:=repeat('a',64); valid_doc jsonb; fake_doc jsonb;
begin
  if current_database()<>'bx1_demo_ci' or current_user<>'postgres'
    or not exists(select 1 from auth.users where email='portal-synthetic-1@example.invalid') then
    raise exception 'document_proof_disposable_fixture_required'; end if;
  if (select enforced from bx1_private.document_receipt_policy where singleton) is distinct from false then
    raise exception 'document_policy_not_default_off'; end if;
  if exists(select 1 from bx1_private.document_upload_receipts)
    or exists(select 1 from bx1_private.document_application_bindings)
    or exists(select 1 from bx1_private.document_receipt_events) then
    raise exception 'document_migration_seeded_evidence'; end if;
  for relation_name in select unnest(array['document_receipt_policy','document_upload_receipts',
    'document_application_bindings','document_receipt_events']) loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c join pg_catalog.pg_namespace n
      on n.oid=c.relnamespace where n.nspname='bx1_private' and c.relname=relation_name) then
      raise exception 'document_rls_missing_%',relation_name; end if;
    foreach role_name in array array['anon','authenticated','service_role','bx1_document_receipt_writer'] loop
      if pg_catalog.has_table_privilege(role_name,'bx1_private.'||relation_name,'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'document_raw_grant_%_%',role_name,relation_name; end if;
    end loop;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(role_name,
      'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE') then
      raise exception 'document_receipt_writer_exposed_%',role_name; end if;
  end loop;
  if not pg_catalog.has_function_privilege('bx1_document_receipt_writer',
    'bx1_private.register_document_receipt(uuid,uuid,uuid,text,text,text,integer,text)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='bx1_portal.applications'::regclass
      and tgname='bx1_application_document_receipts' and tgenabled='O') then
    raise exception 'document_guard_or_writer_missing'; end if;

  -- MAIN's sealed configuration has no synthetic submission route. Its schema
  -- invariants above still run; the dynamic proof belongs to TEST only.
  if not exists(select 1 from bx1_portal.entry_configuration where singleton
    and environment='TESTNET' and manual_test_review) then return; end if;
  insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
    (actor_a,'receipt-synthetic-a@example.invalid',clock_timestamp(),false),
    (actor_b,'receipt-synthetic-b@example.invalid',clock_timestamp(),false);
  insert into auth.sessions(id,user_id,not_after,created_at) values
    (session_a,actor_a,clock_timestamp()+interval '1 hour',clock_timestamp());
  insert into bx1_portal.applications(id,user_id,persona,status,details,origin,provider_mode) values
    (application_a,actor_a,'INVESTOR','DRAFT','{}','SELF_SERVICE','UNASSIGNED'),
    (application_b,actor_a,'WEALTH_MANAGER','DRAFT','{}','SELF_SERVICE','UNASSIGNED'),
    (application_c,actor_b,'INVESTOR','DRAFT','{}','SELF_SERVICE','UNASSIGNED');
  path:=actor_a::text||'/'||v_receipt_id::text;
  insert into storage.objects(bucket_id,name,owner_id,metadata,user_metadata) values
    ('bx1-portal-documents',path,actor_a::text,
      '{"size":25,"mimetype":"application/pdf"}'::jsonb,jsonb_build_object('sha256',sha));
  valid_doc:=pg_catalog.jsonb_build_object('id',v_receipt_id,'kind','IDENTITY','title','Synthetic identity',
    'storage_path',path,'sha256',sha,'size',25,'mime_type','application/pdf');
  fake_doc:=pg_catalog.jsonb_set(valid_doc,'{id}','"ed200000-0000-4000-8000-000000000002"'::jsonb);
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object(
    'sub',actor_a,'session_id',session_a,'aal','aal1')::text,true);
  update bx1_private.document_receipt_policy set enforced=true,changed_at=clock_timestamp() where singleton;
  if public.bx1_document_receipts_required() is not true then
    raise exception 'document_strict_policy_not_visible'; end if;

  begin
    update bx1_portal.applications set status='SUBMITTED',revision=revision+1,
      reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
      details=pg_catalog.jsonb_build_object('documents',pg_catalog.jsonb_build_array(fake_doc)),
      submitted_at=clock_timestamp() where id=application_a;
    raise exception 'document_forged_manifest_accepted';
  exception when check_violation then
    if SQLERRM<>'document_receipt_required' then raise; end if;
  end;

  -- SQL fixture stands in for the restricted web writer; the hosted route must
  -- independently prove exact Storage bytes before invoking this function.
  perform bx1_private.register_document_receipt(actor_a,session_a,v_receipt_id,
    'IDENTITY','Synthetic identity',sha,25,'application/pdf');
  update bx1_portal.applications set status='SUBMITTED',revision=revision+1,
    reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
    details=pg_catalog.jsonb_build_object('documents',pg_catalog.jsonb_build_array(valid_doc)),
    submitted_at=clock_timestamp() where id=application_a;
  if (select count(*) from bx1_private.document_application_bindings where receipt_id=v_receipt_id
    and application_id=application_a)<>1 then raise exception 'document_binding_missing'; end if;

  begin
    update bx1_portal.applications set status='SUBMITTED',revision=revision+1,
      reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
      details=pg_catalog.jsonb_build_object('documents',pg_catalog.jsonb_build_array(valid_doc)),
      submitted_at=clock_timestamp() where id=application_b;
    raise exception 'document_cross_application_reuse_accepted';
  exception when check_violation then
    if SQLERRM<>'document_receipt_application_bound' then raise; end if;
  end;
  begin
    perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object(
      'sub',actor_b,'session_id','ed100000-0000-4000-8000-000000000002','aal','aal1')::text,true);
    update bx1_portal.applications set status='SUBMITTED',revision=revision+1,
      reviewer_scope='0ba2b126-bd85-4cfb-9a1d-83633c9def1e',
      details=pg_catalog.jsonb_build_object('documents',pg_catalog.jsonb_build_array(valid_doc)),
      submitted_at=clock_timestamp() where id=application_c;
    raise exception 'document_cross_actor_reuse_accepted';
  exception when check_violation then
    if SQLERRM<>'document_receipt_mismatch' then raise; end if;
  end;
  update bx1_private.document_receipt_policy set enforced=false,changed_at=clock_timestamp() where singleton;
  if (select enforced from bx1_private.document_receipt_policy where singleton) is distinct from false then
    raise exception 'document_test_policy_left_enabled'; end if;
end $$;
