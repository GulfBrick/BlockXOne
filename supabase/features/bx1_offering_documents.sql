-- S3-PDF-20261012. Source preparation is not policy admission or acceptance.
-- Load in one transaction after the protected offering/common-envelope chain.
-- No historical migration, global assurance helper, role or provider is changed.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.offering_workflow_context(jsonb)') is null
    or pg_catalog.to_regclass('bx1_portal.product_issuer_declarations') is null
    or pg_catalog.to_regclass('bx1_private.document_processing_policy') is null
    or pg_catalog.to_regprocedure('bx1_private.offering_document_source_inventory()') is not null then
    raise exception 'offering_documents_baseline_required' using errcode='55000';
  end if;
end $$;

create function bx1_private.offering_document_source_inventory() returns jsonb
language sql immutable security definer set search_path='' as $inventory$
select $pins$[
 {"signature":"bx1_portal.offering_file_manager(uuid)","sha256":"4a889e30eb90c3e24a65afc990a68116f95989c31e5fea607dae9ddf4d4b1df4","language":"plpgsql","volatility":"v","result":"boolean","args":["target_revision"],"acl":"owner"},
 {"signature":"bx1_portal.offering_file_upload_allowed(text,text)","sha256":"520c708be8dd69d9a4aca2e0080a2e43e4dba9f9d1e97e0946e97eda6eec18ac","language":"plpgsql","volatility":"v","result":"boolean","args":["object_name","object_owner"],"acl":"policy"},
 {"signature":"bx1_portal.offering_file_owner_read_allowed(text,text)","sha256":"f96cb29519f6f11250a408ba516e1a776634db0bd13d6ae9825d18ac7c4cb94f","language":"plpgsql","volatility":"v","result":"boolean","args":["object_name","object_owner"],"acl":"policy"},
 {"signature":"bx1_portal.offering_file_visible(jsonb,uuid)","sha256":"afdf67e4dbd6fe0df3ebb3a7a4211c0caad471e9b39ad61350ba5c4ced75f329","language":"plpgsql","volatility":"v","result":"boolean","args":["c","target_revision"],"acl":"owner"},
 {"signature":"bx1_portal.list_offering_files(jsonb,uuid)","sha256":"719c846a728f3e125a6608ba6e959791e16f8aeb3015fac2f0d24f63c2d1b080","language":"plpgsql","volatility":"v","result":"jsonb","args":["operating_context","target_revision"],"acl":"read"},
 {"signature":"bx1_portal.lookup_offering_file(jsonb,uuid,uuid)","sha256":"0fd266606e50b9f3161b03342d63193682f0af6efd0a7a48f06fc8cf2ed1b6c4","language":"plpgsql","volatility":"v","result":"jsonb","args":["operating_context","target_revision","file_id"],"acl":"read"},
 {"signature":"bx1_portal.lock_offering_product_before_decision()","sha256":"1fdf8c8c86be088f1d94cdec249fd4861d546bb6c4c8618136d389c2d057c5d3","language":"plpgsql","volatility":"v","result":"trigger","args":null,"acl":"owner"},
 {"signature":"bx1_portal.offering_amendment_beginable(uuid)","sha256":"897c4070178e4ef653cc907843ad7b9dc60cbbc30d09a5751d79d808583bfe0a","language":"sql","volatility":"v","result":"boolean","args":["target_product"],"acl":"owner"},
 {"signature":"bx1_portal.offering_review_reopenable(uuid)","sha256":"581e65a96f18620ac4d09a1e202831e4e5779e2b8adba87821f7f788157df7d5","language":"sql","volatility":"v","result":"boolean","args":["target_product"],"acl":"owner"},
 {"signature":"bx1_portal.execute_reopen_offering_review(jsonb,uuid,jsonb)","sha256":"39d6d29117f875607928a8697cf7a469227c89dd43dbe1ea909e2f75faaf6608","language":"plpgsql","volatility":"v","result":"jsonb","args":["c","key","body"],"acl":"owner"},
 {"signature":"bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)","sha256":"c800d8ce2c40a20e000e87b3f07bee86fd4e5b5454a6c77b05dbe3cf18fc1733","language":"plpgsql","volatility":"v","result":"jsonb","args":["c","target_product"],"acl":"owner"},
 {"signature":"bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)","sha256":"5be6eac13995a76008b09a75186a72f0e93fd0b786b3b6ee8b316d28971e2295","language":"plpgsql","volatility":"v","result":"jsonb","args":["c","target_product"],"acl":"owner"},
 {"signature":"bx1_portal.offering_history_projection(uuid)","sha256":"487f5b7066c5025e6dd890faaba16e7f9414078eaf3d02160c5c02571cd88322","language":"sql","volatility":"s","result":"jsonb","args":["target_product"],"acl":"owner"},
 {"signature":"bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)","sha256":"4cf5f891051b6cbb4795fea042bfb8d4535eaa3d9c2e383cbb8579fb6f1ef33b","language":"plpgsql","volatility":"v","result":"jsonb","args":["p_actor","p_session","p_aal","operating_context","target_product","target_revision","file_id","file_kind","file_title","file_sha256","file_size"],"acl":"writer"},
 {"signature":"bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)","sha256":"f026b301ed757d76a4db3b0a4109504c5c4ed11c4008648af43273971942b881","language":"plpgsql","volatility":"v","result":"jsonb","args":["p_actor","p_session","p_aal","operating_context","target_product","target_revision","file_id","file_kind","file_title","file_sha256","file_size"],"acl":"writer"}
]$pins$::jsonb;
$inventory$;
revoke all on function bx1_private.offering_document_source_inventory() from public,anon,authenticated,service_role,
  bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker;

-- Preflight all old identities BEFORE any cutover, table, policy or trigger.
-- Expected ACLs come from canonical grants, never from a captured drifted row.
do $preflight$
declare spec jsonb; p pg_catalog.pg_proc; recipients text[]; actual text[]; test_grants boolean;
begin
  select exists(select 1 from bx1_portal.entry_configuration where singleton
    and environment='TESTNET' and manual_test_review) into test_grants;
  for spec in select value from pg_catalog.jsonb_array_elements(bx1_private.offering_document_source_inventory()) loop
    select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(spec->>'signature');
    recipients:=array['postgres'];
    if spec->>'acl'='policy' then recipients:=array['anon','authenticated','postgres'];
    elsif test_grants and spec->>'acl'='read' then recipients:=array['authenticated','postgres'];
    elsif test_grants and spec->>'acl'='writer' then recipients:=array['bx1_document_receipt_writer','postgres']; end if;
    select pg_catalog.array_agg(r.rolname::text order by r.rolname::text) into actual
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles r on r.oid=a.grantee
      where a.privilege_type='EXECUTE' and not a.is_grantable and a.grantor='postgres'::regrole;
    if p.oid is null or p.proowner<>'postgres'::regrole or p.prokind<>'f'
      or p.prolang<>(select oid from pg_catalog.pg_language where lanname=spec->>'language')
      or p.provolatile::text<>spec->>'volatility' or p.prosecdef is not true
      or p.proconfig is distinct from array['search_path=""']::text[]
      or p.proisstrict or p.proleakproof or p.proretset or p.proparallel<>'u'
      or p.procost<>100 or p.prorows<>0 or p.provariadic<>0 or p.prosupport<>0
      or p.pronargdefaults<>0 or p.proargdefaults is not null or p.proallargtypes is not null
      or p.proargmodes is not null or p.protrftypes is not null or p.probin is not null or p.prosqlbody is not null
      or p.prorettype<>pg_catalog.to_regtype(spec->>'result')
      or pg_catalog.to_jsonb(p.proargnames) is distinct from nullif(spec->'args','null'::jsonb)
      or actual is distinct from recipients
      or (select count(*) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))
        <>pg_catalog.cardinality(recipients)
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')<>spec->>'sha256' then
      raise exception 'offering_documents_source_or_metadata_changed: %',spec->>'signature' using errcode='55000';
    end if;
  end loop;
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(
    'bx1_private.offering_file_session_context(uuid,uuid,text)');
  if p.oid is null or p.proowner<>'postgres'::regrole or p.prosecdef is not true
    or p.proconfig is distinct from array['search_path=""']::text[]
    or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
    or p.provolatile<>'v' or p.prokind<>'f' or p.prorettype<>'void'::regtype
    or p.proisstrict or p.proleakproof or p.proretset or p.proparallel<>'u'
    or p.proargnames is distinct from array['p_actor','p_session','p_aal']::text[]
    or p.pronargdefaults<>0 or p.proargdefaults is not null
    or exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable)
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
    <>'e769060717837c064da0a2228a80fc46124910013a3bdad63b2306fb2becf7a3' then
    raise exception 'offering_documents_legacy_session_changed' using errcode='55000'; end if;
end $preflight$;

create table bx1_private.offering_document_policy (
  singleton boolean primary key default true check(singleton),
  state text not null default 'NOT_ADMITTED' check(state in ('NOT_ADMITTED','ADMITTED')),
  authority_epoch bigint not null default 1 check(authority_epoch between 1 and 9007199254740991),
  changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_private.offering_document_scanner_policy (
  singleton boolean primary key default true check(singleton),
  state text not null default 'NOT_ADMITTED' check(state in ('NOT_ADMITTED','ADMITTED')),
  worker_id text check(worker_id ~ '^[a-z][a-z0-9_-]{2,119}$'),
  scanner_id text check(scanner_id ~ '^[a-z][a-z0-9_-]{2,119}$'),
  authority_epoch bigint not null default 1 check(authority_epoch between 1 and 9007199254740991),
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(state<>'ADMITTED' or (worker_id is not null and scanner_id is not null))
);
insert into bx1_private.offering_document_policy(singleton) values(true);
insert into bx1_private.offering_document_scanner_policy(singleton) values(true);

create table bx1_private.offering_document_profiles (
  offering_revision_id uuid primary key references bx1_portal.offering_revisions(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  environment text not null check(environment in ('TESTNET','MAINNET')),
  profile text not null check(profile='PDF_SIGNATURE_REQUIRED_V1'),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  document_hashes jsonb not null,
  common_envelope_hash text,
  deployment_configuration_hash text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(product_id,offering_revision_id)
);
create table bx1_private.offering_document_processing_jobs (
  file_id uuid primary key references bx1_portal.offering_file_quarantine(id) on delete restrict,
  product_id uuid not null,
  offering_revision_id uuid not null,
  uploader_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check(byte_size between 1 and 4194304),
  mime_type text not null check(mime_type='application/pdf'),
  kind text not null check(kind in ('MEMORANDUM','RISKS','SUBSCRIPTION_TERMS')),
  state text not null default 'QUEUED' check(state in ('QUEUED','LEASED','RETRY_WAIT','EXHAUSTED','RESULT_RECORDED','COMPLETED','REJECTED','EXCLUDED')),
  attempt_number integer not null default 0 check(attempt_number between 0 and 5),
  current_attempt_id uuid,
  next_attempt_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(product_id,offering_revision_id) references bx1_private.offering_document_profiles(product_id,offering_revision_id) on delete restrict,
  check(storage_path=offering_revision_id::text||'/'||uploader_id::text||'/'||file_id::text),
  check((attempt_number=0)=(current_attempt_id is null)),
  check((state='RETRY_WAIT')=(next_attempt_at is not null))
);
create table bx1_private.offering_document_processing_attempts (
  id uuid primary key,
  file_id uuid not null references bx1_private.offering_document_processing_jobs(file_id) on delete restrict,
  authority_epoch bigint not null,
  scanner_authority_epoch bigint not null,
  attempt_number integer not null check(attempt_number between 1 and 5),
  worker_id text not null,
  scanner_id text not null,
  reference text not null unique,
  started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  outcome text not null default 'LEASED' check(outcome in ('LEASED','EXPIRED','FAILED','CLEAN','MALICIOUS')),
  failure_code text check(failure_code in ('ENGINE_UNAVAILABLE','INVALID_DOCUMENT','DELIVERY_FAILED','HASH_MISMATCH')),
  finished_at timestamptz,
  unique(file_id,attempt_number), unique(file_id,id),
  check(reference='bx1-offering-scan:'||id::text),
  check(lease_expires_at=started_at+interval '120 seconds'),
  check((outcome='LEASED')=(finished_at is null)),
  check((outcome='FAILED')=(failure_code is not null))
);
alter table bx1_private.offering_document_processing_jobs add constraint offering_document_current_attempt
  foreign key(file_id,current_attempt_id) references bx1_private.offering_document_processing_attempts(file_id,id) on delete restrict;
create table bx1_private.offering_document_processing_claim_receipts (
  worker_id text not null, request_id uuid not null, scanner_id text not null,
  authority_epoch bigint not null, scanner_authority_epoch bigint not null,
  manifest jsonb, created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(worker_id,request_id)
);
create table bx1_private.offering_document_processing_events (
  id bigint generated always as identity primary key,
  file_id uuid not null references bx1_private.offering_document_processing_jobs(file_id) on delete restrict,
  attempt_id uuid,
  kind text not null check(kind in ('QUEUED','CLAIMED','RETRY_WAIT','EXHAUSTED','RESULT_RECORDED','REJECTED','COMPLETED','EXCLUDED')),
  evidence jsonb not null check(pg_catalog.jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(file_id,attempt_id) references bx1_private.offering_document_processing_attempts(file_id,id) on delete restrict
);
create table bx1_private.offering_document_scan_events (
  id bigint generated always as identity primary key,
  file_id uuid not null unique references bx1_private.offering_document_processing_jobs(file_id) on delete restrict,
  attempt_id uuid not null,
  scanner_id text not null, reference text not null unique,
  verdict text not null check(verdict in ('CLEAN','MALICIOUS')),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  authority_epoch bigint not null, scanner_authority_epoch bigint not null,
  observed_at timestamptz not null, recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(file_id,attempt_id) references bx1_private.offering_document_processing_attempts(file_id,id) on delete restrict
);
create table bx1_private.offering_document_clean_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  file_id uuid not null unique references bx1_portal.offering_file_quarantine(id) on delete restrict,
  scan_event_id bigint not null unique references bx1_private.offering_document_scan_events(id) on delete restrict,
  product_id uuid not null, offering_revision_id uuid not null,
  uploader_id uuid not null, storage_path text not null unique,
  sha256 text not null, byte_size integer not null, mime_type text not null check(mime_type='application/pdf'),
  authority_epoch bigint not null, scanner_authority_epoch bigint not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(product_id,offering_revision_id) references bx1_private.offering_document_profiles(product_id,offering_revision_id) on delete restrict,
  check(storage_path=offering_revision_id::text||'/'||uploader_id::text||'/'||file_id::text)
);
create table bx1_private.offering_document_intent_resolutions (
  intent_id uuid primary key references bx1_portal.offering_file_upload_intents(id) on delete restrict,
  product_id uuid not null, offering_revision_id uuid not null,
  state text not null check(state in ('PROMOTED_CLEAN','REJECTED','EXCLUDED')),
  actor_id uuid references auth.users(id) on delete restrict,
  request_key uuid, operating_context jsonb, reason text,
  scan_event_id bigint references bx1_private.offering_document_scan_events(id) on delete restrict,
  clean_receipt_id uuid references bx1_private.offering_document_clean_receipts(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(product_id,offering_revision_id) references bx1_private.offering_document_profiles(product_id,offering_revision_id) on delete restrict,
  check((state='EXCLUDED')=(actor_id is not null and request_key is not null and operating_context is not null and reason is not null)),
  check(reason is null or pg_catalog.char_length(reason) between 20 and 1000),
  check((state='PROMOTED_CLEAN')=(clean_receipt_id is not null)),
  check(state='EXCLUDED' or scan_event_id is not null)
);
create table bx1_private.offering_document_manifests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  offering_revision_id uuid not null unique,
  product_id uuid not null, organisation_id uuid not null, environment text not null,
  file_ids uuid[] not null check(pg_catalog.cardinality(file_ids)=3),
  evidence jsonb not null check(pg_catalog.jsonb_typeof(evidence)='object'),
  hash text not null check(hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null, request_key uuid not null,
  correspondence_statement text not null check(pg_catalog.char_length(correspondence_statement) between 20 and 3000),
  sealed_at timestamptz not null,
  foreign key(product_id,offering_revision_id) references bx1_private.offering_document_profiles(product_id,offering_revision_id) on delete restrict
);
create table bx1_private.offering_document_command_receipts (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null, operating_context jsonb not null,
  command text not null check(command in ('resolve_offering_file_intent','seal_offering_document_manifest')),
  payload jsonb not null, product_id uuid not null, offering_revision_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(actor_id,request_key),
  foreign key(product_id,offering_revision_id) references bx1_private.offering_document_profiles(product_id,offering_revision_id) on delete restrict
);
create index offering_document_job_queue on bx1_private.offering_document_processing_jobs(state,next_attempt_at,created_at,file_id);
create index offering_document_job_revision on bx1_private.offering_document_processing_jobs(offering_revision_id,file_id);
create index offering_document_event_file on bx1_private.offering_document_processing_events(file_id,id);

create function bx1_private.guard_offering_document_policy() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' or NEW.singleton is distinct from OLD.singleton then
    raise exception 'offering_document_policy_immutable' using errcode='23514'; end if;
  if (pg_catalog.to_jsonb(NEW)-array['authority_epoch','changed_at'])
      is distinct from (pg_catalog.to_jsonb(OLD)-array['authority_epoch','changed_at']) then
    if OLD.authority_epoch>=9007199254740991 then
      raise exception 'offering_document_epoch_exhausted' using errcode='55000'; end if;
    NEW.authority_epoch:=OLD.authority_epoch+1;
  else NEW.authority_epoch:=OLD.authority_epoch; end if;
  NEW.changed_at:=pg_catalog.clock_timestamp(); return NEW;
end $$;
create trigger offering_document_policy_guard before update or delete on bx1_private.offering_document_policy
  for each row execute function bx1_private.guard_offering_document_policy();
create trigger offering_document_scanner_policy_guard before update or delete on bx1_private.offering_document_scanner_policy
  for each row execute function bx1_private.guard_offering_document_policy();

create function bx1_private.guard_offering_document_processing_identity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare mutable text[];
begin
  if TG_OP='DELETE' then raise exception 'offering_document_processing_immutable' using errcode='23514'; end if;
  if TG_TABLE_NAME='offering_document_processing_jobs' then
    mutable:=array['state','attempt_number','current_attempt_id','next_attempt_at','updated_at'];
  else
    mutable:=array['outcome','failure_code','finished_at'];
    if OLD.outcome<>'LEASED' then raise exception 'offering_document_attempt_terminal' using errcode='23514'; end if;
  end if;
  if (pg_catalog.to_jsonb(NEW)-mutable) is distinct from (pg_catalog.to_jsonb(OLD)-mutable) then
    raise exception 'offering_document_processing_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger offering_document_job_identity before update or delete on bx1_private.offering_document_processing_jobs
  for each row execute function bx1_private.guard_offering_document_processing_identity();
create trigger offering_document_attempt_identity before update or delete on bx1_private.offering_document_processing_attempts
  for each row execute function bx1_private.guard_offering_document_processing_identity();

create function bx1_private.profile_new_offering_revision() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; cfg bx1_portal.entry_configuration;
begin
  if NEW.origin<>'SUBMITTED' then return NEW; end if;
  select * into p from bx1_portal.products where id=NEW.product_id for update;
  select * into cfg from bx1_portal.entry_configuration where singleton for share;
  if p.id is null or NEW.terms is distinct from p.terms or NEW.terms_hash is distinct from p.terms_hash
    or NEW.document_hashes is distinct from bx1_portal.offering_document_hashes(NEW.terms) then
    raise exception 'offering_document_profile_binding_denied' using errcode='23514'; end if;
  insert into bx1_private.offering_document_profiles(offering_revision_id,product_id,organisation_id,
    environment,profile,terms_hash,document_hashes,common_envelope_hash,deployment_configuration_hash)
  values(NEW.id,p.id,p.organisation_id,cfg.environment,'PDF_SIGNATURE_REQUIRED_V1',NEW.terms_hash,
    NEW.document_hashes,NEW.common_envelope_hash,NEW.deployment_configuration_hash);
  return NEW;
end $$;
create trigger offering_document_profile_new_revision after insert on bx1_portal.offering_revisions
  for each row execute function bx1_private.profile_new_offering_revision();

-- No permissive browser policy exists for clean objects. The fixed server proxy
-- rehashes actual bytes and rechecks the exact manifest/appointment afterwards.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bx1-offering-documents','bx1-offering-documents',false,4194304,array['application/pdf']);
create policy offering_document_clean_read_restrict on storage.objects as restrictive for select to public
  using(bucket_id<>'bx1-offering-documents');
create policy offering_document_clean_insert_restrict on storage.objects as restrictive for insert to public
  with check(bucket_id<>'bx1-offering-documents');
create policy offering_document_clean_update_restrict on storage.objects as restrictive for update to public
  using(bucket_id<>'bx1-offering-documents') with check(bucket_id<>'bx1-offering-documents');
create policy offering_document_clean_delete_restrict on storage.objects as restrictive for delete to public
  using(bucket_id<>'bx1-offering-documents');

do $private_tables$
declare name text;
begin
  foreach name in array array['offering_document_policy','offering_document_scanner_policy','offering_document_profiles',
    'offering_document_processing_jobs','offering_document_processing_attempts','offering_document_processing_claim_receipts',
    'offering_document_processing_events','offering_document_scan_events','offering_document_clean_receipts',
    'offering_document_intent_resolutions','offering_document_manifests','offering_document_command_receipts'] loop
    execute pg_catalog.format('alter table bx1_private.%I enable row level security',name);
    execute pg_catalog.format('revoke all on bx1_private.%I from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker',name);
  end loop;
  foreach name in array array['offering_document_profiles','offering_document_processing_claim_receipts',
    'offering_document_processing_events','offering_document_scan_events','offering_document_clean_receipts',
    'offering_document_intent_resolutions','offering_document_manifests','offering_document_command_receipts'] loop
    execute pg_catalog.format('create trigger %I before update or delete on bx1_private.%I for each row execute function bx1_portal.immutable_record()',name||'_immutable',name);
  end loop;
end $private_tables$;
revoke all on sequence bx1_private.offering_document_processing_events_id_seq,
  bx1_private.offering_document_scan_events_id_seq from public,anon,authenticated,service_role,
  bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker;

create function bx1_private.offering_document_admitted() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.offering_document_policy p
    join bx1_private.offering_document_scanner_policy s on s.singleton
    join bx1_portal.entry_configuration c on c.singleton
    where p.singleton and p.state='ADMITTED' and s.state='ADMITTED'
      and c.environment='TESTNET' and c.manual_test_review and c.test_ordinary_entry_enabled);
$$;

create function bx1_private.offering_file_session_context(p_actor uuid,p_session uuid,p_aal text,a jsonb)
returns void language plpgsql volatile security definer set search_path='' as $$
declare method jsonb; at numeric:=extract(epoch from pg_catalog.clock_timestamp());
begin
  if p_actor is null or p_session is null or p_aal not in ('aal1','aal2')
    or pg_catalog.jsonb_typeof(a) is distinct from 'object'
    or not(a ?& array['iss','sub','session_id','role','aal','exp','is_anonymous','amr'])
    or a-array['iss','sub','session_id','role','aal','exp','is_anonymous','amr']<>'{}'::jsonb
    or a->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or a->>'sub' is distinct from p_actor::text or a->>'session_id' is distinct from p_session::text
    or a->>'aal' is distinct from p_aal or a->>'role' is distinct from 'authenticated'
    or a->'is_anonymous' is distinct from 'false'::jsonb
    or pg_catalog.jsonb_typeof(a->'exp') is distinct from 'number'
    or coalesce(a->>'exp','') !~ '^[1-9][0-9]{0,11}$' or (a->>'exp')::numeric<=at
    or pg_catalog.jsonb_typeof(a->'amr') is distinct from 'array'
    or pg_catalog.jsonb_array_length(a->'amr') not between 1 and 8 then
    raise exception 'offering_file_attestation_denied' using errcode='42501'; end if;
  for method in select value from pg_catalog.jsonb_array_elements(a->'amr') loop
    if pg_catalog.jsonb_typeof(method) is distinct from 'object'
      or not(method ?& array['method','timestamp']) or method-array['method','timestamp']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(method->'method') is distinct from 'string'
      or method->>'method' not in ('password','totp','mfa/totp')
      or pg_catalog.jsonb_typeof(method->'timestamp') is distinct from 'number'
      or coalesce(method->>'timestamp','') !~ '^[1-9][0-9]{0,11}$'
      or (method->>'timestamp')::numeric>at then
      raise exception 'offering_file_attestation_denied' using errcode='42501'; end if;
  end loop;
  perform u.id from auth.users u where u.id=p_actor for share;
  perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;
  perform pr.id from public.bx1_profiles pr where pr.id=p_actor for share;
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_actor and s.aal::text=p_aal and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
      and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    or bx1_portal.offering_workflow_person_current(p_actor) is not true then
    raise exception 'offering_file_session_denied' using errcode='42501'; end if;
  perform pg_catalog.set_config('request.jwt.claims',a::text,true);
  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor::text,true);
  if p_aal='aal1' then
    if pg_catalog.jsonb_array_length(a->'amr')<>1 or a->'amr'->0->>'method'<>'password'
      or bx1_portal.admission_password_session() is not true then
      raise exception 'offering_file_password_session_denied' using errcode='42501'; end if;
  elsif bx1_portal.fresh_session() is not true or bx1_private.has_session_mfa() is not true
      or bx1_private.has_token_mfa() is not true then
    raise exception 'offering_file_native_assurance_denied' using errcode='42501';
  end if;
end $$;

create function bx1_private.offering_document_context(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.entry_manual_review_enabled() and bx1_portal.offering_workflow_person_current(auth.uid())
    and case when bx1_portal.admission_password_session() then bx1_portal.offering_workflow_context(c)
      else bx1_portal.valid_operating_context(c) end
    and c->>'mode'='ROLE' and c->>'role' in ('OfferingManager','IssuerFundManager','ComplianceOfficer');
$$;
create function bx1_private.offering_document_manager(c jsonb,target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.offering_document_context(c) and c->>'role'='OfferingManager'
    and exists(select 1 from bx1_portal.offering_revisions r join bx1_portal.products p on p.id=r.product_id
      where r.id=target_revision and r.origin='SUBMITTED' and p.current_offering_revision_id=r.id
        and p.status in ('IN_REVIEW','CHANGES_REQUIRED') and r.terms=p.terms and r.terms_hash=p.terms_hash
        and bx1_portal.offering_workflow_operator(c,p.organisation_id));
$$;
create function bx1_private.offering_document_manager_context(target_revision uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;
begin
  for c in select pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role','OfferingManager')
    from public.bx1_memberships m where m.user_id=auth.uid() and m.role='OfferingManager' order by m.id loop
    if bx1_private.offering_document_manager(c,target_revision) then return c; end if;
  end loop;
  return null;
end $$;
create function bx1_private.offering_document_can_upload(target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.offering_document_admitted()
    and bx1_private.offering_document_manager_context(target_revision) is not null
    and exists(select 1 from bx1_private.offering_document_profiles q join bx1_portal.products p on p.id=q.product_id
      where q.offering_revision_id=target_revision and p.current_offering_revision_id=target_revision and p.status='IN_REVIEW')
    and not exists(select 1 from bx1_private.offering_document_manifests where offering_revision_id=target_revision)
    and not exists(select 1 from bx1_portal.offering_decisions where offering_revision_id=target_revision);
$$;
create function bx1_private.offering_document_visible(c jsonb,target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.offering_document_context(c) and exists(select 1
    from bx1_portal.offering_revisions r join bx1_portal.products p on p.id=r.product_id
    where r.id=target_revision and r.origin='SUBMITTED' and (
      (c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,p.organisation_id))
      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager')
      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')));
$$;
create function bx1_private.offering_document_clean_visible(c jsonb,target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.offering_document_admitted() and bx1_private.offering_document_visible(c,target_revision)
    and exists(select 1 from bx1_portal.offering_revisions r join bx1_portal.products p on p.id=r.product_id
      join bx1_private.offering_document_manifests m on m.offering_revision_id=r.id and m.product_id=p.id
      where r.id=target_revision and p.current_offering_revision_id=r.id
        and p.status in ('IN_REVIEW','CHANGES_REQUIRED') and r.terms=p.terms and r.terms_hash=p.terms_hash
        and not exists(select 1 from bx1_private.offering_document_clean_receipts clean
          cross join bx1_private.offering_document_policy op cross join bx1_private.offering_document_scanner_policy sp
          where clean.file_id=any(m.file_ids) and op.singleton and sp.singleton
            and (clean.authority_epoch<>op.authority_epoch or clean.scanner_authority_epoch<>sp.authority_epoch)));
$$;

create function bx1_private.offering_document_processing_authority(p_worker text,p_scanner text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.offering_document_policy; s bx1_private.offering_document_scanner_policy;
begin
  select * into p from bx1_private.offering_document_policy where singleton for share;
  select * into s from bx1_private.offering_document_scanner_policy where singleton for share;
  if p_worker is null or p_scanner is null or p.state is distinct from 'ADMITTED'
    or s.state is distinct from 'ADMITTED' or s.worker_id is distinct from p_worker
    or s.scanner_id is distinct from p_scanner or bx1_private.offering_document_admitted() is not true then
    raise exception 'offering_document_processing_not_admitted' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('authority_epoch',p.authority_epoch,'scanner_authority_epoch',s.authority_epoch);
end $$;
create function bx1_private.lock_offering_document_revision(target_revision uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; r bx1_portal.offering_revisions;
begin
  select product.* into p from bx1_portal.offering_revisions revision
    join bx1_portal.products product on product.id=revision.product_id
    where revision.id=target_revision for update of product;
  select * into r from bx1_portal.offering_revisions where id=target_revision;
  perform id from bx1_portal.organisations where id=p.organisation_id for share;
  perform id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id order by id for share;
  perform m.id from public.bx1_memberships m join bx1_portal.representative_mandates mandate
    on mandate.native_membership_id=m.id where mandate.product_organisation_id=p.organisation_id order by m.id for share of m;
  perform bx1_portal.admission_lock_people(array[r.submitted_by,p.created_by]);
  if p.id is null or p.current_offering_revision_id is distinct from r.id
    or p.status not in ('IN_REVIEW','CHANGES_REQUIRED') or r.terms is distinct from p.terms
    or r.terms_hash is distinct from p.terms_hash
    or bx1_portal.current_product_organisation(p.organisation_id) is not true
    or bx1_portal.offering_workflow_person_current(r.submitted_by) is not true
    or not exists(select 1 from bx1_portal.representative_mandates mandate
      where mandate.product_organisation_id=p.organisation_id and mandate.applicant_user_id=r.submitted_by
        and bx1_portal.offering_workflow_manager_current(r.submitted_by,p.organisation_id,mandate.native_organisation_id))
    or not exists(select 1 from bx1_private.offering_document_profiles q
      where q.offering_revision_id=r.id and q.product_id=p.id and q.organisation_id=p.organisation_id
        and q.terms_hash=r.terms_hash and q.document_hashes=r.document_hashes
        and q.common_envelope_hash is not distinct from r.common_envelope_hash
        and q.deployment_configuration_hash is not distinct from r.deployment_configuration_hash) then
    raise exception 'offering_document_current_revision_denied' using errcode='42501'; end if;
end $$;

create function bx1_private.queue_offering_document_processing() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=NEW.offering_revision_id) then return NEW; end if;
  perform bx1_private.lock_offering_document_revision(NEW.offering_revision_id);
  if bx1_private.offering_document_can_upload(NEW.offering_revision_id) is not true then
    raise exception 'offering_document_intake_denied' using errcode='42501'; end if;
  insert into bx1_private.offering_document_processing_jobs(file_id,product_id,offering_revision_id,uploader_id,
    storage_path,sha256,byte_size,mime_type,kind)
  values(NEW.id,NEW.product_id,NEW.offering_revision_id,NEW.actor_id,NEW.storage_path,NEW.sha256,NEW.byte_size,NEW.mime_type,NEW.kind);
  insert into bx1_private.offering_document_processing_events(file_id,kind,evidence)
  values(NEW.id,'QUEUED',pg_catalog.jsonb_build_object('file_id',NEW.id,'product_id',NEW.product_id,
    'offering_revision_id',NEW.offering_revision_id,'sha256',NEW.sha256,'storage_path',NEW.storage_path));
  return NEW;
end $$;
create trigger offering_document_processing_enqueue after insert on bx1_portal.offering_file_quarantine
  for each row execute function bx1_private.queue_offering_document_processing();

create function bx1_private.offering_document_processing_manifest(j bx1_private.offering_document_processing_jobs,
  a bx1_private.offering_document_processing_attempts) returns jsonb
language sql immutable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('file_id',j.file_id,'product_id',j.product_id,'offering_revision_id',j.offering_revision_id,
    'uploader_id',j.uploader_id,'attempt_id',a.id,'authority_epoch',a.authority_epoch,
    'scanner_authority_epoch',a.scanner_authority_epoch,'attempt_number',a.attempt_number,
    'worker_id',a.worker_id,'scanner_id',a.scanner_id,'reference',a.reference,'lease_expires_at',a.lease_expires_at,
    'storage_path',j.storage_path,'sha256',j.sha256,'size',j.byte_size,'mime_type',j.mime_type,'kind',j.kind);
$$;

create function bx1_private.claim_offering_document_processing(p_worker text,p_scanner text,p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare policy jsonb; j bx1_private.offering_document_processing_jobs; a bx1_private.offering_document_processing_attempts;
  r bx1_private.offering_document_processing_claim_receipts; v_now timestamptz; result jsonb; candidate uuid;
begin
  if p_request is null or p_request='00000000-0000-0000-0000-000000000000' then
    raise exception 'offering_document_claim_invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_offering_claim:'||p_worker||':'||p_request::text,0));
  select * into r from bx1_private.offering_document_processing_claim_receipts where worker_id=p_worker and request_id=p_request;
  if r.request_id is not null then
    if r.scanner_id is distinct from p_scanner then raise exception 'offering_document_claim_conflict' using errcode='23505'; end if;
    if r.manifest is null then policy:=bx1_private.offering_document_processing_authority(p_worker,p_scanner); return null; end if;
    perform bx1_private.lock_offering_document_revision((r.manifest->>'offering_revision_id')::uuid);
    policy:=bx1_private.offering_document_processing_authority(p_worker,p_scanner);
    if r.authority_epoch<>(policy->>'authority_epoch')::bigint or r.scanner_authority_epoch<>(policy->>'scanner_authority_epoch')::bigint then return null; end if;
    select * into j from bx1_private.offering_document_processing_jobs where file_id=(r.manifest->>'file_id')::uuid for share;
    select * into a from bx1_private.offering_document_processing_attempts where id=j.current_attempt_id;
    if j.state='LEASED' and a.id=(r.manifest->>'attempt_id')::uuid and a.outcome='LEASED'
      and a.lease_expires_at>pg_catalog.clock_timestamp() then return r.manifest; end if;
    return null;
  end if;
  if bx1_private.offering_document_admitted() is not true then raise exception 'offering_document_processing_not_admitted' using errcode='42501'; end if;
  loop
    v_now:=pg_catalog.clock_timestamp();
    select q.file_id into candidate from bx1_private.offering_document_processing_jobs q
      join bx1_portal.products p on p.id=q.product_id and p.current_offering_revision_id=q.offering_revision_id
      left join bx1_private.offering_document_processing_attempts last on last.id=q.current_attempt_id
      cross join bx1_private.offering_document_policy op cross join bx1_private.offering_document_scanner_policy sp
      where op.singleton and sp.singleton and p.status in ('IN_REVIEW','CHANGES_REQUIRED')
        and not exists(select 1 from bx1_private.offering_document_intent_resolutions x where x.intent_id=q.file_id)
        and (q.state='QUEUED' or q.state='RETRY_WAIT' and q.next_attempt_at<=v_now
          or q.state='LEASED' and (last.lease_expires_at<=v_now or last.authority_epoch<>op.authority_epoch
            or last.scanner_authority_epoch<>sp.authority_epoch))
      order by q.created_at,q.file_id for update of p skip locked limit 1;
    if candidate is null then policy:=bx1_private.offering_document_processing_authority(p_worker,p_scanner); exit; end if;
    select * into j from bx1_private.offering_document_processing_jobs where file_id=candidate for update skip locked;
    if j.file_id is null then continue; end if;
    perform bx1_private.lock_offering_document_revision(j.offering_revision_id);
    policy:=bx1_private.offering_document_processing_authority(p_worker,p_scanner);
    v_now:=pg_catalog.clock_timestamp();
    if j.state='LEASED' then
      select * into a from bx1_private.offering_document_processing_attempts where id=j.current_attempt_id for update;
      if a.outcome<>'LEASED' then raise exception 'offering_document_job_attempt_inconsistent' using errcode='55000'; end if;
      update bx1_private.offering_document_processing_attempts set outcome='EXPIRED',finished_at=v_now where id=a.id;
      update bx1_private.offering_document_processing_jobs set state=case when attempt_number>=5 then 'EXHAUSTED' else 'RETRY_WAIT' end,
        next_attempt_at=case when attempt_number>=5 then null else v_now+interval '30 seconds' end,updated_at=v_now where file_id=j.file_id returning * into j;
      insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence)
        values(j.file_id,a.id,j.state,pg_catalog.jsonb_build_object('reason','LEASE_OR_AUTHORITY_EXPIRED','attempt_number',a.attempt_number));
      continue;
    end if;
    if j.attempt_number>=5 then
      update bx1_private.offering_document_processing_jobs set state='EXHAUSTED',next_attempt_at=null,updated_at=v_now where file_id=j.file_id;
      continue;
    end if;
    insert into bx1_private.offering_document_processing_attempts(id,file_id,authority_epoch,scanner_authority_epoch,
      attempt_number,worker_id,scanner_id,reference,started_at,lease_expires_at)
    select id,j.file_id,(policy->>'authority_epoch')::bigint,(policy->>'scanner_authority_epoch')::bigint,j.attempt_number+1,
      p_worker,p_scanner,'bx1-offering-scan:'||id::text,v_now,v_now+interval '120 seconds'
      from (select pg_catalog.gen_random_uuid() id) fresh returning * into a;
    update bx1_private.offering_document_processing_jobs set state='LEASED',attempt_number=a.attempt_number,
      current_attempt_id=a.id,next_attempt_at=null,updated_at=v_now where file_id=j.file_id returning * into j;
    result:=bx1_private.offering_document_processing_manifest(j,a);
    insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence) values(j.file_id,a.id,'CLAIMED',result);
    exit;
  end loop;
  insert into bx1_private.offering_document_processing_claim_receipts(worker_id,request_id,scanner_id,authority_epoch,scanner_authority_epoch,manifest)
    values(p_worker,p_request,p_scanner,(policy->>'authority_epoch')::bigint,(policy->>'scanner_authority_epoch')::bigint,result);
  return result;
end $$;

create function bx1_private.read_offering_document_scan_input(p_file uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare policy jsonb; j bx1_private.offering_document_processing_jobs; a bx1_private.offering_document_processing_attempts;
  e bx1_private.offering_document_scan_events; result jsonb;
begin
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_file;
  if j.file_id is null then raise exception 'offering_document_processing_lease_denied' using errcode='42501'; end if;
  perform bx1_private.lock_offering_document_revision(j.offering_revision_id);
  policy:=bx1_private.offering_document_processing_authority(p_worker,p_scanner);
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_file for share;
  select * into a from bx1_private.offering_document_processing_attempts where id=p_attempt and file_id=p_file;
  if p_file is null or p_attempt is null or p_epoch is null or a.id is null
    or j.current_attempt_id is distinct from a.id or a.authority_epoch is distinct from p_epoch
    or a.authority_epoch<>(policy->>'authority_epoch')::bigint
    or a.scanner_authority_epoch<>(policy->>'scanner_authority_epoch')::bigint
    or a.worker_id is distinct from p_worker or a.scanner_id is distinct from p_scanner
    or exists(select 1 from bx1_private.offering_document_intent_resolutions x where x.intent_id=p_file and x.state='EXCLUDED') then
    raise exception 'offering_document_processing_lease_denied' using errcode='42501'; end if;
  select * into e from bx1_private.offering_document_scan_events where file_id=p_file and attempt_id=p_attempt;
  if e.id is not null then
    if a.outcome<>e.verdict or j.state not in ('RESULT_RECORDED','COMPLETED','REJECTED')
      or e.authority_epoch<>a.authority_epoch or e.scanner_authority_epoch<>a.scanner_authority_epoch
      or e.scanner_id<>a.scanner_id or e.reference<>a.reference or e.sha256<>j.sha256 then
      raise exception 'offering_document_result_inconsistent' using errcode='55000'; end if;
    result:=pg_catalog.jsonb_build_object('file_id',e.file_id,'attempt_id',e.attempt_id,'scan_event_id',e.id,
      'verdict',e.verdict,'sha256',e.sha256,'scanner_id',e.scanner_id,'reference',e.reference,'observed_at',e.observed_at,
      'authority_epoch',e.authority_epoch,'scanner_authority_epoch',e.scanner_authority_epoch);
  elsif j.state<>'LEASED' or a.outcome<>'LEASED' or a.lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'offering_document_processing_lease_denied' using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object('manifest',bx1_private.offering_document_processing_manifest(j,a),'result',result);
end $$;
create function bx1_private.read_offering_document_processing(p_file uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=bx1_private.read_offering_document_scan_input(p_file,p_attempt,p_epoch,p_worker,p_scanner);
  if result->'result' is distinct from 'null'::jsonb then
    raise exception 'offering_document_processing_lease_denied' using errcode='42501'; end if;
  return result->'manifest';
end $$;
create function bx1_private.fail_offering_document_processing(p_file uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text,p_code text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare manifest jsonb; j bx1_private.offering_document_processing_jobs; at timestamptz;
begin
  if p_code is null or p_code not in ('ENGINE_UNAVAILABLE','INVALID_DOCUMENT','DELIVERY_FAILED','HASH_MISMATCH') then
    raise exception 'offering_document_failure_invalid' using errcode='22023'; end if;
  manifest:=bx1_private.read_offering_document_processing(p_file,p_attempt,p_epoch,p_worker,p_scanner);
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_file for update;
  perform id from bx1_private.offering_document_processing_attempts where id=p_attempt for update;
  -- Waits may have consumed the lease; the final check uses the database clock.
  manifest:=bx1_private.read_offering_document_processing(p_file,p_attempt,p_epoch,p_worker,p_scanner);
  at:=pg_catalog.clock_timestamp();
  update bx1_private.offering_document_processing_attempts set outcome='FAILED',failure_code=p_code,finished_at=at where id=p_attempt;
  update bx1_private.offering_document_processing_jobs set state=case when attempt_number>=5
      or p_code in ('INVALID_DOCUMENT','HASH_MISMATCH') then 'EXHAUSTED' else 'RETRY_WAIT' end,
    next_attempt_at=case when attempt_number>=5 or p_code in ('INVALID_DOCUMENT','HASH_MISMATCH') then null else at+interval '30 seconds' end,
    updated_at=at where file_id=p_file returning * into j;
  insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence)
    values(p_file,p_attempt,j.state,pg_catalog.jsonb_build_object('code',p_code,'sha256',j.sha256,'attempt_number',j.attempt_number));
  return pg_catalog.jsonb_build_object('file_id',p_file,'attempt_id',p_attempt,'state',j.state,
    'attempt_number',j.attempt_number,'next_attempt_at',j.next_attempt_at);
end $$;
create function bx1_private.record_offering_document_scan(p_id uuid,p_sha256 text,p_scanner text,
  p_reference text,p_verdict text,p_observed_at timestamptz) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare input jsonb; j bx1_private.offering_document_processing_jobs; a bx1_private.offering_document_processing_attempts;
  e bx1_private.offering_document_scan_events; attempt uuid;
begin
  if p_id is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_scanner is null
    or p_reference is null or p_reference !~ '^bx1-offering-scan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_verdict is null or p_verdict not in ('CLEAN','MALICIOUS') or p_observed_at is null then
    raise exception 'offering_document_scan_invalid' using errcode='22023'; end if;
  attempt:=pg_catalog.substr(p_reference,19)::uuid;
  select * into a from bx1_private.offering_document_processing_attempts where id=attempt and file_id=p_id;
  input:=bx1_private.read_offering_document_scan_input(p_id,attempt,a.authority_epoch,a.worker_id,p_scanner);
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_id for update;
  select * into a from bx1_private.offering_document_processing_attempts where id=attempt and file_id=p_id for update;
  if j.sha256 is distinct from p_sha256 or a.reference is distinct from p_reference then
    raise exception 'offering_document_scan_binding_denied' using errcode='42501'; end if;
  select * into e from bx1_private.offering_document_scan_events where file_id=p_id;
  if e.id is not null then
    if e.attempt_id is distinct from attempt or e.scanner_id is distinct from p_scanner
      or e.reference is distinct from p_reference or e.verdict is distinct from p_verdict
      or e.sha256 is distinct from p_sha256 or e.observed_at is distinct from p_observed_at then
      raise exception 'offering_document_scan_replay_conflict' using errcode='23505'; end if;
  else
    -- No committed result: live lease and observed-time checks remain mandatory.
    input:=bx1_private.read_offering_document_scan_input(p_id,attempt,a.authority_epoch,a.worker_id,p_scanner);
    if input->'result' is distinct from 'null'::jsonb or a.outcome<>'LEASED'
      or a.lease_expires_at<=pg_catalog.clock_timestamp() or p_observed_at<a.started_at
      or p_observed_at>pg_catalog.clock_timestamp()+interval '5 minutes'
      or p_observed_at<pg_catalog.clock_timestamp()-interval '1 day' then
      raise exception 'offering_document_scan_freshness_denied' using errcode='42501'; end if;
    insert into bx1_private.offering_document_scan_events(file_id,attempt_id,scanner_id,reference,verdict,sha256,
      authority_epoch,scanner_authority_epoch,observed_at)
    values(p_id,attempt,p_scanner,p_reference,p_verdict,p_sha256,a.authority_epoch,a.scanner_authority_epoch,p_observed_at)
      returning * into e;
    update bx1_private.offering_document_processing_attempts set outcome=p_verdict,finished_at=pg_catalog.clock_timestamp() where id=attempt;
    update bx1_private.offering_document_processing_jobs set state=case when p_verdict='CLEAN' then 'RESULT_RECORDED' else 'REJECTED' end,
      updated_at=pg_catalog.clock_timestamp() where file_id=p_id returning * into j;
    if p_verdict='MALICIOUS' then
      insert into bx1_private.offering_document_intent_resolutions(intent_id,product_id,offering_revision_id,state,scan_event_id)
        values(p_id,j.product_id,j.offering_revision_id,'REJECTED',e.id);
    end if;
    insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence)
      values(p_id,attempt,j.state,pg_catalog.jsonb_build_object('scan_event_id',e.id,'verdict',p_verdict,'sha256',p_sha256,
        'reference',p_reference,'observed_at',p_observed_at,'authority_epoch',a.authority_epoch,'scanner_authority_epoch',a.scanner_authority_epoch));
  end if;
  return pg_catalog.jsonb_build_object('file_id',p_id,'scan_event_id',e.id,'state',case when e.verdict='CLEAN' then 'RESULT_RECORDED' else 'REJECTED' end,
    'sha256',e.sha256,'storage_path',j.storage_path);
end $$;
create function bx1_private.promote_scanned_offering_document(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare input jsonb; j bx1_private.offering_document_processing_jobs; a bx1_private.offering_document_processing_attempts;
  e bx1_private.offering_document_scan_events; clean bx1_private.offering_document_clean_receipts;
begin
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_id;
  select * into a from bx1_private.offering_document_processing_attempts where id=j.current_attempt_id;
  input:=bx1_private.read_offering_document_scan_input(p_id,a.id,a.authority_epoch,a.worker_id,a.scanner_id);
  select * into j from bx1_private.offering_document_processing_jobs where file_id=p_id for update;
  select * into e from bx1_private.offering_document_scan_events where file_id=p_id;
  if e.id is null or e.verdict<>'CLEAN' or a.outcome<>'CLEAN'
    or j.state not in ('RESULT_RECORDED','COMPLETED') then
    raise exception 'offering_document_promotion_denied' using errcode='42501'; end if;
  -- Service-key uploads genuinely have no Storage owner. The uploader is bound
  -- by immutable quarantine/profile/scan/receipt, never spoofed into owner_id.
  perform 1 from storage.objects o where o.bucket_id='bx1-offering-documents' and o.name=j.storage_path
    and o.owner_id is null and o.metadata->>'size'=j.byte_size::text
    and o.metadata->>'mimetype'='application/pdf' and o.user_metadata->>'sha256'=j.sha256 for share;
  if not found then raise exception 'offering_document_clean_object_unverified' using errcode='23514'; end if;
  input:=bx1_private.read_offering_document_scan_input(p_id,a.id,a.authority_epoch,a.worker_id,a.scanner_id);
  select * into clean from bx1_private.offering_document_clean_receipts where file_id=p_id;
  if clean.id is null then
    insert into bx1_private.offering_document_clean_receipts(file_id,scan_event_id,product_id,offering_revision_id,uploader_id,
      storage_path,sha256,byte_size,mime_type,authority_epoch,scanner_authority_epoch)
    values(p_id,e.id,j.product_id,j.offering_revision_id,j.uploader_id,j.storage_path,j.sha256,j.byte_size,j.mime_type,
      e.authority_epoch,e.scanner_authority_epoch) returning * into clean;
    insert into bx1_private.offering_document_intent_resolutions(intent_id,product_id,offering_revision_id,state,scan_event_id,clean_receipt_id)
      values(p_id,j.product_id,j.offering_revision_id,'PROMOTED_CLEAN',e.id,clean.id);
    update bx1_private.offering_document_processing_jobs set state='COMPLETED',updated_at=pg_catalog.clock_timestamp() where file_id=p_id;
    insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence)
      values(p_id,a.id,'COMPLETED',pg_catalog.jsonb_build_object('clean_receipt_id',clean.id,'scan_event_id',e.id,'sha256',j.sha256));
  elsif clean.scan_event_id<>e.id or clean.sha256<>j.sha256 or clean.storage_path<>j.storage_path then
    raise exception 'offering_document_clean_receipt_conflict' using errcode='23505';
  end if;
  return pg_catalog.jsonb_build_object('file_id',p_id,'product_id',j.product_id,'offering_revision_id',j.offering_revision_id,
    'clean_receipt_id',clean.id,'scan_event_id',e.id,'state','PROMOTED_CLEAN','storage_path',clean.storage_path,
    'sha256',clean.sha256,'size',clean.byte_size,'mime_type',clean.mime_type);
end $$;

create function bx1_private.offering_document_revision_terminal(target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select not exists(select 1 from bx1_portal.offering_file_upload_intents i
      where i.offering_revision_id=target_revision and not exists(
        select 1 from bx1_private.offering_document_intent_resolutions x where x.intent_id=i.id))
    and not exists(select 1 from bx1_private.offering_document_processing_jobs j
      where j.offering_revision_id=target_revision and j.state in ('QUEUED','LEASED','RETRY_WAIT','RESULT_RECORDED'));
$$;
create function bx1_private.offering_document_correction_ready(target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id
    join bx1_private.offering_document_profiles q on q.offering_revision_id=r.id and q.product_id=p.id
    where p.id=target_product and p.status in ('IN_REVIEW','CHANGES_REQUIRED') and r.origin='SUBMITTED'
      and r.terms=p.terms and r.terms_hash=p.terms_hash and p.published_at is null and p.reserved_units=0
      and bx1_private.offering_document_revision_terminal(r.id)
      and exists(select 1 from bx1_portal.offering_file_upload_intents i where i.offering_revision_id=r.id)
      and not exists(select 1 from bx1_portal.events e where e.subject_id=p.id and e.kind='publish_product')
      and not exists(select 1 from bx1_portal.subscriptions s where s.product_id=p.id)
      and not exists(select 1 from bx1_portal.product_eligibility_cases e where e.product_id=p.id));
$$;
create function bx1_private.lock_offering_document_correction(target_product uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;
begin
  select current_offering_revision_id into target from bx1_portal.products where id=target_product for update;
  if not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target) then return; end if;
  perform file_id from bx1_private.offering_document_processing_jobs where offering_revision_id=target order by file_id for update;
  perform id from bx1_private.offering_document_processing_attempts where file_id in (
    select file_id from bx1_private.offering_document_processing_jobs where offering_revision_id=target) order by id for share;
  if bx1_private.offering_document_correction_ready(target_product) is not true then
    raise exception 'offering_document_correction_not_terminal' using errcode='23514'; end if;
end $$;

create function bx1_private.list_profiled_offering_files(c jsonb,target_revision uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.offering_file_visible(c,target_revision) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',i.id,'revision_id',i.offering_revision_id,'kind',i.kind,'title',i.title,'sha256',i.sha256,'size',i.byte_size,
    'validation_state','QUARANTINED','uploaded_at',f.uploaded_at,'intent_state',coalesce(x.state,'PENDING'),
    'processing_state',j.state,'clean_receipt_id',clean.id,'selected',coalesce(i.id=any(m.file_ids),false),
    'can_download',case when clean.id is not null and i.id=any(m.file_ids)
      then bx1_private.offering_document_clean_visible(c,target_revision)
      else f.id is not null and f.actor_id=auth.uid()
        and bx1_portal.offering_file_owner_read_allowed(f.storage_path,f.actor_id::text) end)
    order by case i.kind when 'MEMORANDUM' then 1 when 'RISKS' then 2 else 3 end,i.id)
    from bx1_portal.offering_file_upload_intents i left join bx1_portal.offering_file_quarantine f on f.id=i.id
    left join bx1_private.offering_document_intent_resolutions x on x.intent_id=i.id
    left join bx1_private.offering_document_processing_jobs j on j.file_id=i.id
    left join bx1_private.offering_document_clean_receipts clean on clean.file_id=i.id
    left join bx1_private.offering_document_manifests m on m.offering_revision_id=i.offering_revision_id
    where i.offering_revision_id=target_revision),'[]'::jsonb);
end $$;
create function bx1_private.lookup_profiled_offering_file(c jsonb,target_revision uuid,p_file uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare f bx1_portal.offering_file_quarantine; clean bx1_private.offering_document_clean_receipts;
  m bx1_private.offering_document_manifests; bucket text; state text;
begin
  if bx1_portal.offering_file_visible(c,target_revision) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  select * into f from bx1_portal.offering_file_quarantine where id=p_file and offering_revision_id=target_revision;
  if f.id is null then raise exception 'offering_file_unavailable' using errcode='P0002'; end if;
  select * into clean from bx1_private.offering_document_clean_receipts where file_id=p_file;
  select * into m from bx1_private.offering_document_manifests where offering_revision_id=target_revision and p_file=any(file_ids);
  if clean.id is not null and m.id is not null and bx1_private.offering_document_clean_visible(c,target_revision) then
    if clean.offering_revision_id<>target_revision or clean.product_id<>f.product_id
      or clean.uploader_id<>f.actor_id or clean.storage_path<>f.storage_path or clean.sha256<>f.sha256
      or clean.byte_size<>f.byte_size or not exists(select 1 from bx1_private.offering_document_intent_resolutions x
        where x.intent_id=f.id and x.state='PROMOTED_CLEAN' and x.clean_receipt_id=clean.id) then
      raise exception 'offering_document_clean_binding_denied' using errcode='42501'; end if;
    bucket:='bx1-offering-documents'; state:='PROMOTED_CLEAN';
  elsif f.actor_id=auth.uid() and bx1_portal.offering_file_owner_read_allowed(f.storage_path,f.actor_id::text) then
    bucket:='bx1-offering-quarantine';
    select coalesce(x.state,'PENDING') into state from (select 1) base
      left join bx1_private.offering_document_intent_resolutions x on x.intent_id=f.id;
    clean.id:=null; m.id:=null; m.hash:=null;
  else raise exception 'offering_file_unavailable' using errcode='P0002'; end if;
  return pg_catalog.jsonb_build_object('id',f.id,'revision_id',f.offering_revision_id,'product_id',f.product_id,
    'uploader_id',f.actor_id,'bucket',bucket,'storage_path',f.storage_path,'sha256',f.sha256,'size',f.byte_size,
    'mime_type',f.mime_type,'validation_state','QUARANTINED','intent_state',state,'clean_receipt_id',clean.id,
    'manifest_id',m.id,'manifest_hash',m.hash);
end $$;

create function bx1_private.offering_document_readiness(target_revision uuid) returns text
language sql stable security definer set search_path='' as $$
  select case
    when not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision) then 'LEGACY_TEXT_ONLY'
    when exists(select 1 from bx1_private.offering_document_manifests where offering_revision_id=target_revision) then 'SEALED_SIGNATURE_REQUIRED'
    when not exists(select 1 from bx1_private.offering_document_policy p join bx1_private.offering_document_scanner_policy s on s.singleton
      join bx1_portal.entry_configuration c on c.singleton
      where p.singleton and p.state='ADMITTED' and s.state='ADMITTED' and c.environment='TESTNET'
        and c.manual_test_review and c.test_ordinary_entry_enabled) then 'NOT_ADMITTED'
    when exists(select 1 from bx1_portal.offering_file_upload_intents i where i.offering_revision_id=target_revision
      and not exists(select 1 from bx1_private.offering_document_intent_resolutions x where x.intent_id=i.id)) then 'PENDING_SCAN'
    when (select count(*) from bx1_private.offering_document_clean_receipts clean
      join bx1_private.offering_document_policy p on p.singleton and p.authority_epoch=clean.authority_epoch
      join bx1_private.offering_document_scanner_policy s on s.singleton and s.authority_epoch=clean.scanner_authority_epoch
      where clean.offering_revision_id=target_revision)=3
      and bx1_private.offering_document_revision_terminal(target_revision) then 'READY_TO_SEAL'
    when exists(select 1 from bx1_private.offering_document_intent_resolutions where offering_revision_id=target_revision
      and state in ('REJECTED','EXCLUDED')) then 'REJECTED_OR_EXCLUDED'
    else 'PENDING_SCAN' end;
$$;
create function bx1_private.offering_document_evidence_summary(target_revision uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when q.offering_revision_id is null then null else pg_catalog.jsonb_build_object(
    'profile',q.profile,'state',bx1_private.offering_document_readiness(target_revision),'manifest_id',m.id,
    'manifest_hash',m.hash,'signature_status','NOT_CONNECTED','approval_allowed',false) end
    from (select 1) base left join bx1_private.offering_document_profiles q on q.offering_revision_id=target_revision
    left join bx1_private.offering_document_manifests m on m.offering_revision_id=target_revision;
$$;
create function bx1_private.offering_document_snapshot(c jsonb,target_revision uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; q bx1_private.offering_document_profiles; m bx1_private.offering_document_manifests;
  cfg bx1_portal.entry_configuration; manager boolean; commands jsonb:='[]'::jsonb;
begin
  if bx1_portal.offering_file_visible(c,target_revision) is not true then
    raise exception 'offering_file_scope_denied' using errcode='42501'; end if;
  select product.* into p from bx1_portal.products product join bx1_portal.offering_revisions r on r.product_id=product.id where r.id=target_revision;
  select * into q from bx1_private.offering_document_profiles where offering_revision_id=target_revision;
  select * into m from bx1_private.offering_document_manifests where offering_revision_id=target_revision;
  select * into cfg from bx1_portal.entry_configuration where singleton;
  manager:=q.offering_revision_id is not null and bx1_private.offering_document_admitted()
    and bx1_private.offering_document_manager(c,target_revision);
  if manager then commands:='["resolve_offering_file_intent","seal_offering_document_manifest"]'::jsonb; end if;
  return pg_catalog.jsonb_build_object('revision_id',target_revision,'product_id',p.id,'profile',q.profile,
    'state',bx1_private.offering_document_readiness(target_revision),
    'manifest',case when m.id is null then null else pg_catalog.jsonb_build_object('id',m.id,'hash',m.hash,
      'sealed_at',m.sealed_at,'file_ids',m.file_ids,'correspondence_statement',m.correspondence_statement) end,
    'files',bx1_private.list_profiled_offering_files(c,target_revision),
    'document_access',pg_catalog.jsonb_build_object('version',1,'actor_id',auth.uid(),'environment',cfg.environment,
      'context',c,'session_id',auth.jwt()->>'session_id','revision_id',target_revision,'product_id',p.id,
      'allowed_commands',commands,'can_upload',manager and bx1_private.offering_document_can_upload(target_revision),
      'can_read_clean',q.offering_revision_id is not null and bx1_private.offering_document_clean_visible(c,target_revision),
      'approval_allowed',false,'approval_blocker',case when q.offering_revision_id is null then null else 'signature-not-connected' end));
end $$;
create function bx1_private.read_offering_documents(p_actor uuid,p_session uuid,p_aal text,c jsonb,
  target_revision uuid,p_attestation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if p_attestation is null then
    if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision) then
      raise exception 'offering_document_attestation_required' using errcode='42501'; end if;
    perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal);
  else perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal,p_attestation); end if;
  return bx1_private.offering_document_snapshot(c,target_revision);
end $$;

create function bx1_private.execute_offering_document_command(p_actor uuid,p_session uuid,p_aal text,c jsonb,
  command text,key uuid,body jsonb,p_attestation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; r bx1_portal.offering_revisions; prior bx1_private.offering_document_command_receipts;
  i bx1_portal.offering_file_upload_intents; j bx1_private.offering_document_processing_jobs;
  resolution bx1_private.offering_document_intent_resolutions; selected uuid[]; entries jsonb; evidence jsonb;
  q bx1_private.offering_document_profiles; at timestamptz; manifest_id uuid; manifest_hash text;
begin
  perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal,p_attestation);
  if command is null or command not in ('resolve_offering_file_intent','seal_offering_document_manifest')
    or key is null or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>8192 then raise exception 'offering_document_command_invalid' using errcode='22023'; end if;
  perform bx1_portal.require_keys(body,case when command='resolve_offering_file_intent'
    then array['product_id','offering_revision_id','expected_revision','intent_id','reason']
    else array['product_id','offering_revision_id','expected_revision','file_ids','correspondence_statement'] end);
  if pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string'
    or body->>'product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'offering_revision_id') is distinct from 'string'
    or body->>'offering_revision_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'offering_document_command_invalid' using errcode='22023'; end if;
  if bx1_private.offering_document_context(c) is not true or c->>'role'<>'OfferingManager' then
    raise exception 'offering_document_manager_denied' using errcode='42501'; end if;
  perform bx1_portal.offering_workflow_lock_actor('reopen_offering_review',c);
  perform cfg.singleton from bx1_portal.entry_configuration cfg where cfg.singleton for share;
  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;
  perform bx1_portal.offering_workflow_lock_product(c,p.id);
  perform bx1_private.lock_offering_document_revision((body->>'offering_revision_id')::uuid);
  perform singleton from bx1_private.offering_document_policy where singleton for share;
  perform singleton from bx1_private.offering_document_scanner_policy where singleton for share;
  if p.id is null or p.current_offering_revision_id is distinct from (body->>'offering_revision_id')::uuid
    or bx1_private.offering_document_admitted() is not true
    or bx1_private.offering_document_manager(c,p.current_offering_revision_id) is not true then
    raise exception 'offering_document_manager_denied' using errcode='42501'; end if;
  select * into prior from bx1_private.offering_document_command_receipts where actor_id=p_actor and request_key=key;
  if prior.actor_id is not null then
    if prior.operating_context is distinct from c or prior.command is distinct from command or prior.payload is distinct from body then
      raise exception 'offering_document_idempotency_conflict' using errcode='23505'; end if;
    return bx1_private.offering_document_snapshot(c,p.current_offering_revision_id);
  end if;
  if exists(select 1 from bx1_portal.scoped_requests where actor_id=p_actor and request_key=key)
    or exists(select 1 from bx1_portal.requests where actor_id=p_actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=p_actor and request_key=key)
    or exists(select 1 from bx1_portal.product_service_appointment_requests where actor_id=p_actor and request_key=key) then
    raise exception 'offering_document_prior_key_conflict' using errcode='23505'; end if;
  if p.revision<>(body->>'expected_revision')::integer then raise exception 'offering_document_stale' using errcode='23514'; end if;
  select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id;
  select * into q from bx1_private.offering_document_profiles where offering_revision_id=r.id;
  if exists(select 1 from bx1_private.offering_document_manifests where offering_revision_id=r.id) then
    raise exception 'offering_document_manifest_sealed' using errcode='23514'; end if;
  if command='resolve_offering_file_intent' then
    perform bx1_portal.require_text(body,'reason',20,1000);
    if pg_catalog.jsonb_typeof(body->'intent_id') is distinct from 'string'
      or body->>'intent_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'offering_document_intent_invalid' using errcode='22023'; end if;
    select * into i from bx1_portal.offering_file_upload_intents where id=(body->>'intent_id')::uuid
      and product_id=p.id and offering_revision_id=r.id for share;
    select * into j from bx1_private.offering_document_processing_jobs where file_id=i.id for update;
    select * into resolution from bx1_private.offering_document_intent_resolutions where intent_id=i.id;
    if i.id is null or resolution.state in ('PROMOTED_CLEAN','EXCLUDED') or j.state in ('LEASED','RESULT_RECORDED','COMPLETED') then
      raise exception 'offering_document_intent_resolution_denied' using errcode='23514'; end if;
    if resolution.intent_id is null then
      insert into bx1_private.offering_document_intent_resolutions(intent_id,product_id,offering_revision_id,state,
        actor_id,request_key,operating_context,reason) values(i.id,p.id,r.id,'EXCLUDED',p_actor,key,c,body->>'reason');
      if j.file_id is not null then
        update bx1_private.offering_document_processing_jobs set state='EXCLUDED',next_attempt_at=null,updated_at=pg_catalog.clock_timestamp() where file_id=i.id;
        insert into bx1_private.offering_document_processing_events(file_id,attempt_id,kind,evidence)
          values(i.id,j.current_attempt_id,'EXCLUDED',pg_catalog.jsonb_build_object('actor_id',p_actor,'request_key',key,'reason',body->>'reason'));
      end if;
    end if;
  else
    perform bx1_portal.require_text(body,'correspondence_statement',20,3000);
    if pg_catalog.jsonb_typeof(body->'file_ids') is distinct from 'array' or pg_catalog.jsonb_array_length(body->'file_ids')<>3
      or exists(select 1 from pg_catalog.jsonb_array_elements(body->'file_ids') f where pg_catalog.jsonb_typeof(f) is distinct from 'string'
        or f#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'offering_document_manifest_invalid' using errcode='22023'; end if;
    select pg_catalog.array_agg((f.value#>>'{}')::uuid order by f.ordinality) into selected
      from pg_catalog.jsonb_array_elements(body->'file_ids') with ordinality f(value,ordinality);
    perform file_id from bx1_private.offering_document_processing_jobs where offering_revision_id=r.id order by file_id for update;
    if bx1_private.offering_document_revision_terminal(r.id) is not true
      or (select count(distinct id) from pg_catalog.unnest(selected) id)<>3 then
      raise exception 'offering_document_manifest_not_ready' using errcode='23514'; end if;
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('file_id',upload_intent.id,'kind',upload_intent.kind,'uploader_id',upload_intent.actor_id,
      'size',upload_intent.byte_size,'sha256',upload_intent.sha256,'scan_event_id',clean.scan_event_id,'clean_receipt_id',clean.id)
      order by case upload_intent.kind when 'MEMORANDUM' then 1 when 'RISKS' then 2 else 3 end) into entries
      from bx1_portal.offering_file_upload_intents upload_intent join bx1_private.offering_document_intent_resolutions x
        on x.intent_id=upload_intent.id and x.state='PROMOTED_CLEAN'
      join bx1_private.offering_document_clean_receipts clean on clean.id=x.clean_receipt_id and clean.file_id=upload_intent.id
      join bx1_private.offering_document_processing_jobs job on job.file_id=upload_intent.id and job.state='COMPLETED'
      join bx1_private.offering_document_scan_events scan on scan.id=clean.scan_event_id and scan.verdict='CLEAN'
      join bx1_private.offering_document_policy op on op.singleton and op.authority_epoch=clean.authority_epoch
      join bx1_private.offering_document_scanner_policy sp on sp.singleton and sp.authority_epoch=clean.scanner_authority_epoch
      where upload_intent.product_id=p.id and upload_intent.offering_revision_id=r.id and upload_intent.id=any(selected);
    if entries is null or pg_catalog.jsonb_array_length(entries)<>3
      or entries->0->>'kind'<>'MEMORANDUM' or entries->1->>'kind'<>'RISKS' or entries->2->>'kind'<>'SUBSCRIPTION_TERMS'
      or pg_catalog.to_jsonb(selected) is distinct from pg_catalog.jsonb_build_array(entries->0->'file_id',entries->1->'file_id',entries->2->'file_id') then
      raise exception 'offering_document_manifest_not_ready' using errcode='23514'; end if;
    at:=pg_catalog.clock_timestamp(); manifest_id:=pg_catalog.gen_random_uuid();
    evidence:=pg_catalog.jsonb_build_object('manifest_version',1,'profile',q.profile,'environment',q.environment,
      'product_id',p.id,'organisation_id',p.organisation_id,'offering_revision_id',r.id,'terms_hash',r.terms_hash,
      'document_hashes',r.document_hashes,'common_envelope_hash',r.common_envelope_hash,
      'deployment_configuration_hash',r.deployment_configuration_hash,'files',entries,
      'correspondence_statement',body->>'correspondence_statement','actor_id',p_actor,'operating_context',c,'sealed_at',at);
    manifest_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('bx1-offering-document-manifest-v1:'||evidence::text,'UTF8')),'hex');
    insert into bx1_private.offering_document_manifests(id,offering_revision_id,product_id,organisation_id,environment,
      file_ids,evidence,hash,actor_id,operating_context,request_key,correspondence_statement,sealed_at)
    values(manifest_id,r.id,p.id,p.organisation_id,q.environment,selected,evidence,manifest_hash,p_actor,c,key,body->>'correspondence_statement',at);
  end if;
  insert into bx1_private.offering_document_command_receipts(actor_id,request_key,operating_context,command,payload,product_id,offering_revision_id)
    values(p_actor,key,c,command,body,p.id,r.id);
  insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
    values(r.id,p.organisation_id,command,p_actor,case when command='seal_offering_document_manifest'
      then 'Exact three-PDF manifest sealed. Signature is not connected; approval and business operations remain blocked.'
      else 'Manager resolved an abandoned intent or acknowledged its immutable rejection; original evidence remains unchanged.' end);
  if bx1_private.offering_document_manager(c,r.id) is not true or bx1_private.offering_document_admitted() is not true
    or bx1_portal.offering_workflow_person_current(p_actor) is not true then
    raise exception 'offering_document_authority_changed' using errcode='42501'; end if;
  return bx1_private.offering_document_snapshot(c,r.id);
end $$;

-- Literal recipes, not marker heuristics or wildcard rewrites. The full old
-- normalized body is the literal cutpoint for structural replacements.
create function bx1_private.offering_document_replacement_recipes() returns jsonb
language sql immutable security definer set search_path='' as $recipes$
select $json$[
 {"signature":"bx1_portal.offering_file_manager(uuid)","changes":[{"from":"begin\n","to":"begin\n  if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision) then\n    return bx1_private.offering_document_can_upload(target_revision); end if;\n","count":1}]},
 {"signature":"bx1_portal.offering_file_upload_allowed(text,text)","changes":[{"from":"and i.storage_path=object_name);","to":"and i.storage_path=object_name\n        and not exists(select 1 from bx1_private.offering_document_intent_resolutions x where x.intent_id=i.id));","count":1}]},
 {"signature":"bx1_portal.offering_file_owner_read_allowed(text,text)","changes":[{"from":"begin\n","to":"begin\n  if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=pg_catalog.split_part(object_name,'/',1)::uuid) then\n    return object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      and auth.uid() is not null and object_owner=auth.uid()::text\n      and pg_catalog.split_part(object_name,'/',2)=auth.uid()::text\n      and bx1_private.offering_document_admitted()\n      and bx1_private.offering_document_manager_context(pg_catalog.split_part(object_name,'/',1)::uuid) is not null;\n  end if;\n","count":1}]},
 {"signature":"bx1_portal.offering_file_visible(jsonb,uuid)","changes":[{"from":"begin\n","to":"begin\n  if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision) then\n    return bx1_private.offering_document_visible(c,target_revision); end if;\n","count":1}]},
 {"signature":"bx1_portal.list_offering_files(jsonb,uuid)","changes":[{"from":"$SOURCE_BODY","to":"begin\n  return bx1_private.list_profiled_offering_files(operating_context,target_revision);\nend","count":1}]},
 {"signature":"bx1_portal.lookup_offering_file(jsonb,uuid,uuid)","changes":[{"from":"$SOURCE_BODY","to":"begin\n  return bx1_private.lookup_profiled_offering_file(operating_context,target_revision,file_id);\nend","count":1}]},
 {"signature":"bx1_portal.lock_offering_product_before_decision()","changes":[{"from":"  if NEW.decision='APPROVED' and (","to":"  if NEW.decision='APPROVED' and exists(select 1 from bx1_private.offering_document_profiles q\n    where q.offering_revision_id=NEW.offering_revision_id) then\n    raise exception 'offering_document_signature_not_connected' using errcode='23514'; end if;\n  if NEW.decision='APPROVED' and (","count":1}]},
 {"signature":"bx1_portal.offering_amendment_beginable(uuid)","changes":[{"from":"$SOURCE_BODY","to":"select exists(select 1 from bx1_portal.products p where p.id=target_product and p.status='APPROVED'\n  and bx1_portal.offering_review_reopenable(target_product)\n  and bx1_private.offering_document_revision_terminal(p.current_offering_revision_id));","count":1}]},
 {"signature":"bx1_portal.offering_review_reopenable(uuid)","changes":[{"from":"and not exists(select 1 from bx1_portal.product_eligibility_cases e where e.product_id=p.id));","to":"and not exists(select 1 from bx1_portal.product_eligibility_cases e where e.product_id=p.id))\n    or (bx1_portal.entry_manual_review_enabled() and bx1_private.offering_document_correction_ready(target_product));","count":1}]},
 {"signature":"bx1_portal.execute_reopen_offering_review(jsonb,uuid,jsonb)","changes":[{"from":"  if bx1_portal.offering_review_reopenable(p.id) is not true","to":"  perform bx1_private.lock_offering_document_correction(p.id);\n  if bx1_portal.offering_review_reopenable(p.id) is not true","count":1},{"from":"Synthetic TEST approved offering reopened for fresh issuer and Compliance review. Prior decisions preserved; no publication, order or funding created.","to":"Synthetic TEST offering reopened for fresh document, issuer and Compliance review. Prior terms, decisions and evidence preserved; no signature, publication, order or funding created.","count":1}]},
 {"signature":"bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)","changes":[{"from":"'subscribable',p.status='PUBLISHED' and is_ready);","to":"'subscribable',p.status='PUBLISHED' and is_ready) || case when exists(\n      select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n      then pg_catalog.jsonb_build_object('document_evidence',bx1_private.offering_document_evidence_summary(r.id))\n      else '{}'::jsonb end;","count":1}]},
 {"signature":"bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)","changes":[{"from":"'subscribable',p.status='PUBLISHED' and is_ready);","to":"'subscribable',p.status='PUBLISHED' and is_ready) || case when exists(\n      select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n      then pg_catalog.jsonb_build_object('document_evidence',bx1_private.offering_document_evidence_summary(r.id))\n      else '{}'::jsonb end;","count":1}]},
 {"signature":"bx1_portal.offering_history_projection(uuid)","changes":[{"from":"'technical_readiness_status','NOT_VERIFIED') order by r.package_number,r.id)","to":"'technical_readiness_status','NOT_VERIFIED') || case when exists(\n      select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n      then pg_catalog.jsonb_build_object('document_evidence',bx1_private.offering_document_evidence_summary(r.id))\n      else '{}'::jsonb end order by r.package_number,r.id)","count":1}]},
 {"signature":"bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)","changes":[{"from":"$SOURCE_BODY","to":"begin\n  return bx1_private.reserve_offering_file(p_actor,p_session,p_aal,operating_context,target_product,target_revision,\n    file_id,file_kind,file_title,file_sha256,file_size,null::jsonb);\nend","count":1}]},
 {"signature":"bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)","changes":[{"from":"$SOURCE_BODY","to":"begin\n  return bx1_private.register_offering_file(p_actor,p_session,p_aal,operating_context,target_product,target_revision,\n    file_id,file_kind,file_title,file_sha256,file_size,null::jsonb);\nend","count":1}]}
]$json$::jsonb;
$recipes$;
create function bx1_private.offering_document_writer_recipe() returns jsonb
language sql immutable security definer set search_path='' as $writer$
select $json$[
 {"from":"  perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal);","to":"  if p_attestation is null then\n    perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal);\n  else\n    perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal,p_attestation);\n    perform bx1_portal.offering_workflow_lock_actor('reopen_offering_review',operating_context);\n  end if;","count":1},
 {"from":"  select * into v_product from bx1_portal.products where id=target_product for update;","to":"  select * into v_product from bx1_portal.products where id=target_product for update;\n  if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision) then\n    if p_attestation is null then raise exception 'offering_document_attestation_required' using errcode='42501'; end if;\n    perform bx1_portal.offering_workflow_lock_product(operating_context,target_product);\n    perform bx1_private.lock_offering_document_revision(target_revision);\n    if bx1_private.offering_document_manager(operating_context,target_revision) is not true\n      or bx1_private.offering_document_admitted() is not true then\n      raise exception 'offering_document_intake_denied' using errcode='42501'; end if;\n  end if;","count":1},
 {"from":"bx1_portal.scoped_operator(operating_context,v_product.organisation_id)","to":"(case when exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision)\n      then bx1_portal.offering_workflow_operator(operating_context,v_product.organisation_id)\n      else bx1_portal.scoped_operator(operating_context,v_product.organisation_id) end)","count":1},
 {"from":"  return pg_catalog.jsonb_build_object(","to":"  if exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=target_revision)\n    and (bx1_private.offering_document_manager(operating_context,target_revision) is not true\n      or bx1_private.offering_document_admitted() is not true) then\n    raise exception 'offering_document_authority_changed' using errcode='42501'; end if;\n  return pg_catalog.jsonb_build_object(","count":1}
]$json$::jsonb;
$writer$;
create function bx1_private.offering_document_apply_body_recipe(source_body text,changes jsonb) returns text
language plpgsql immutable security definer set search_path='' as $$
declare change jsonb; next_body text:=source_body; needle text; occurrences integer;
begin
  for change in select value from pg_catalog.jsonb_array_elements(changes) loop
    needle:=case when change->>'from'='$SOURCE_BODY' then source_body else change->>'from' end;
    if needle is null or pg_catalog.length(needle)=0 then raise exception 'offering_document_empty_cutpoint' using errcode='55000'; end if;
    occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,needle,'')))/pg_catalog.length(needle);
    if occurrences<>(change->>'count')::integer then raise exception 'offering_document_cutpoint_changed' using errcode='55000'; end if;
    next_body:=pg_catalog.replace(next_body,needle,change->>'to');
  end loop;
  return next_body;
end $$;

do $cutover$
declare spec jsonb; recipe jsonb; target oid; source_body text; normalized text; next_body text;
  before_row jsonb; after_row jsonb; definition text; occurrences integer; operation text; writer_body text;
  -- Independently reconstructed, source-derived RESULT body pins. These are
  -- checked before CREATE/REPLACE; no database capture can bless a changed body.
  expected_results jsonb:=$results${
   "bx1_portal.offering_file_manager(uuid)":"a30b6f972fa6aa8eb2204971bae36601adbe66615170d3b66f50363e141ca466",
   "bx1_portal.offering_file_upload_allowed(text,text)":"1a53ad81e2f6d731521fd344ebaa2d602363a44b4fc80a358dc1520918f61531",
   "bx1_portal.offering_file_owner_read_allowed(text,text)":"df6e5d8fa29708a1d1c39424617e0948f83ebafe80563e1ec2b551f6de9eb8f6",
   "bx1_portal.offering_file_visible(jsonb,uuid)":"1b319874b1c9d3f5d5c3922044b7e4bcecdcad9805e4d2899e9b1088ca2a00da",
   "bx1_portal.list_offering_files(jsonb,uuid)":"971b27d500274d3ab6a59191746d7c3f9d6410325b58678110b556bc90549206",
   "bx1_portal.lookup_offering_file(jsonb,uuid,uuid)":"ed27b443044f58ea7c7567a3dde6ef258312741e95fa5d77677dade7cc5b9527",
   "bx1_portal.lock_offering_product_before_decision()":"506497010034c90796c5228a00c1a37babdf184cb05ae0752e7de8c9e2ffd6f6",
   "bx1_portal.offering_amendment_beginable(uuid)":"79255ffc62ca4824799b16a038ae96921ad626fefbafd996300f74c966b30e63",
   "bx1_portal.offering_review_reopenable(uuid)":"4549e1b54a96e58c644621739ad841352273cb04dd57260d8faff9df877019e3",
   "bx1_portal.execute_reopen_offering_review(jsonb,uuid,jsonb)":"7b3f6ca1c2d36fc66002231ae6fcef955f19a37d93c877412febfff14c03fc91",
   "bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid)":"3af34c6fb9b6e51b37d6fdfbf25193f5c079d430f002a5d02186444ee917fe1e",
   "bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)":"942b5f2b4d87d6581258299a0eaf1803e8974490db717c71de568601bf690fbe",
   "bx1_portal.offering_history_projection(uuid)":"4b2cf0aac6c0ea150dccabffb2959dd5b79610720389f04638875ca028bf4f8c",
   "bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)":"2dca890fd539342cda7b06df2619ddf711e9b8f9ef860cad0de2e7a2c7a06d48",
   "bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)":"be05778770a6b1cc00388fc9bb2e942ffe74292d49b80e442b681cdc95c443a2",
   "bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)":"602b5b6094d517b30d8a49936b76bd7e618728ea206fe98f456b44c9915765fa",
   "bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)":"2546b4672d54146c22dbd90e67aec8021e83ce45d82ba1e2159177b9b92131ea"
  }$results$::jsonb;
begin
  -- Move the two canonical DML bodies once. Old OIDs become guarded delegates;
  -- the old three-argument session helper is neither altered nor bypassed.
  foreach operation in array array['reserve_offering_file','register_offering_file'] loop
    target:=pg_catalog.to_regprocedure('bx1_private.'||operation||'(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer)');
    select pg_catalog.btrim(pg_catalog.replace(prosrc,E'\r\n',E'\n'),E' \n\t') into normalized from pg_catalog.pg_proc where oid=target;
    writer_body:=bx1_private.offering_document_apply_body_recipe(normalized,bx1_private.offering_document_writer_recipe());
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(writer_body,'UTF8')),'hex')
      is distinct from expected_results->>('bx1_private.'||operation||'(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)') then
      raise exception 'offering_document_writer_result_changed' using errcode='55000'; end if;
    execute pg_catalog.format('create function bx1_private.%I(p_actor uuid,p_session uuid,p_aal text,operating_context jsonb,target_product uuid,target_revision uuid,file_id uuid,file_kind text,file_title text,file_sha256 text,file_size integer,p_attestation jsonb) returns jsonb language plpgsql volatile security definer set search_path=%L as %L',operation,'',writer_body);
  end loop;
  if pg_catalog.jsonb_array_length(bx1_private.offering_document_replacement_recipes())<>15 then
    raise exception 'offering_document_recipe_count_changed' using errcode='55000'; end if;
  -- Validate every cutpoint and expected old body again before changing ANY OID.
  for spec in select value from pg_catalog.jsonb_array_elements(bx1_private.offering_document_source_inventory()) loop
    select value into recipe from pg_catalog.jsonb_array_elements(bx1_private.offering_document_replacement_recipes())
      where value->>'signature'=spec->>'signature';
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select prosrc into source_body from pg_catalog.pg_proc where oid=target;
    normalized:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized,'UTF8')),'hex')<>spec->>'sha256' or recipe is null then
      raise exception 'offering_document_cutover_source_changed' using errcode='55000'; end if;
    next_body:=bx1_private.offering_document_apply_body_recipe(normalized,recipe->'changes');
    if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(next_body,'UTF8')),'hex')
      is distinct from expected_results->>(spec->>'signature') then
      raise exception 'offering_document_result_body_changed' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))/pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'offering_document_body_ambiguous' using errcode='55000'; end if;
  end loop;
  for recipe in select value from pg_catalog.jsonb_array_elements(bx1_private.offering_document_replacement_recipes()) loop
    target:=pg_catalog.to_regprocedure(recipe->>'signature');
    select prosrc,pg_catalog.to_jsonb(p) into source_body,before_row from pg_catalog.pg_proc p where oid=target;
    normalized:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    next_body:=bx1_private.offering_document_apply_body_recipe(normalized,recipe->'changes');
    definition:=pg_catalog.pg_get_functiondef(target);
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'offering_document_function_identity_changed' using errcode='55000'; end if;
  end loop;
end $cutover$;

-- Revoke default EXECUTE on every newly declared helper, identified by its exact
-- declared inventory (not a wildcard affecting another owner's functions).
do $helpers$
declare signature text; signatures text[]:=array[
 'bx1_private.offering_document_source_inventory()',
 'bx1_private.guard_offering_document_policy()',
 'bx1_private.guard_offering_document_processing_identity()',
 'bx1_private.profile_new_offering_revision()',
 'bx1_private.offering_document_admitted()',
 'bx1_private.offering_file_session_context(uuid,uuid,text,jsonb)',
 'bx1_private.offering_document_context(jsonb)',
 'bx1_private.offering_document_manager(jsonb,uuid)',
 'bx1_private.offering_document_manager_context(uuid)',
 'bx1_private.offering_document_can_upload(uuid)',
 'bx1_private.offering_document_visible(jsonb,uuid)',
 'bx1_private.offering_document_clean_visible(jsonb,uuid)',
 'bx1_private.offering_document_processing_authority(text,text)',
 'bx1_private.lock_offering_document_revision(uuid)',
 'bx1_private.queue_offering_document_processing()',
 'bx1_private.offering_document_processing_manifest(bx1_private.offering_document_processing_jobs,bx1_private.offering_document_processing_attempts)',
 'bx1_private.claim_offering_document_processing(text,text,uuid)',
 'bx1_private.read_offering_document_scan_input(uuid,uuid,bigint,text,text)',
 'bx1_private.read_offering_document_processing(uuid,uuid,bigint,text,text)',
 'bx1_private.fail_offering_document_processing(uuid,uuid,bigint,text,text,text)',
 'bx1_private.record_offering_document_scan(uuid,text,text,text,text,timestamptz)',
 'bx1_private.promote_scanned_offering_document(uuid)',
 'bx1_private.offering_document_revision_terminal(uuid)',
 'bx1_private.offering_document_correction_ready(uuid)',
 'bx1_private.lock_offering_document_correction(uuid)',
 'bx1_private.list_profiled_offering_files(jsonb,uuid)',
 'bx1_private.lookup_profiled_offering_file(jsonb,uuid,uuid)',
 'bx1_private.offering_document_readiness(uuid)',
 'bx1_private.offering_document_evidence_summary(uuid)',
 'bx1_private.offering_document_snapshot(jsonb,uuid)',
 'bx1_private.read_offering_documents(uuid,uuid,text,jsonb,uuid,jsonb)',
 'bx1_private.execute_offering_document_command(uuid,uuid,text,jsonb,text,uuid,jsonb,jsonb)',
 'bx1_private.offering_document_replacement_recipes()',
 'bx1_private.offering_document_writer_recipe()',
 'bx1_private.offering_document_apply_body_recipe(text,jsonb)',
 'bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)',
 'bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb)'];
begin
  foreach signature in array signatures loop
    if pg_catalog.to_regprocedure(signature) is null then raise exception 'offering_document_helper_missing: %',signature using errcode='55000'; end if;
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker',signature);
  end loop;
end $helpers$;
grant execute on function bx1_private.claim_offering_document_processing(text,text,uuid),
  bx1_private.read_offering_document_processing(uuid,uuid,bigint,text,text),
  bx1_private.fail_offering_document_processing(uuid,uuid,bigint,text,text,text) to bx1_document_processing_worker;
grant execute on function bx1_private.read_offering_document_scan_input(uuid,uuid,bigint,text,text),
  bx1_private.record_offering_document_scan(uuid,text,text,text,text,timestamptz),
  bx1_private.promote_scanned_offering_document(uuid) to bx1_document_scanner_writer;
do $writer_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET' and manual_test_review) then
    grant execute on function bx1_private.reserve_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb),
      bx1_private.register_offering_file(uuid,uuid,text,jsonb,uuid,uuid,uuid,text,text,text,integer,jsonb),
      bx1_private.read_offering_documents(uuid,uuid,text,jsonb,uuid,jsonb),
      bx1_private.execute_offering_document_command(uuid,uuid,text,jsonb,text,uuid,jsonb,jsonb) to bx1_document_receipt_writer;
  end if;
end $writer_grants$;
