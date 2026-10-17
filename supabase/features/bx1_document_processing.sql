-- Stage 2 additive durable handoff. Installation is NOT scanner admission.
-- No credentials, role membership, LOGIN, Storage grants or business authority.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_private.document_quarantine_items') is null
    or pg_catalog.to_regclass('bx1_private.document_scan_events') is null
    or pg_catalog.to_regprocedure('bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)') is null
    or pg_catalog.to_regprocedure('bx1_private.promote_scanned_document(uuid)') is null then
    raise exception 'document_processing_baseline_required' using errcode='55000';
  end if;
end $$;

create role bx1_document_processing_worker nologin noinherit nosuperuser nocreatedb
  nocreaterole noreplication nobypassrls;
grant usage on schema bx1_private to bx1_document_processing_worker;

create table bx1_private.document_processing_policy (
  singleton boolean primary key default true check(singleton),
  state text not null default 'NOT_ADMITTED' check(state in ('NOT_ADMITTED','ADMITTED')),
  worker_id text,
  scanner_id text,
  authority_epoch bigint not null default 1 check(authority_epoch between 1 and 9007199254740991),
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(worker_id is null or worker_id ~ '^[a-z][a-z0-9_-]{2,119}$'),
  check(scanner_id is null or scanner_id ~ '^[a-z][a-z0-9_-]{2,119}$'),
  check(state<>'ADMITTED' or (worker_id is not null and scanner_id is not null))
);
insert into bx1_private.document_processing_policy(singleton) values(true);

create table bx1_private.document_processing_jobs (
  document_id uuid primary key references bx1_private.document_quarantine_items(id) on delete restrict,
  origin text not null check(origin in ('NEW','LEGACY_PENDING','LEGACY_RESULT','LEGACY_COMPLETED','LEGACY_REJECTED')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check(byte_size between 1 and 4194304),
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  state text not null check(state in ('QUEUED','LEASED','RETRY_WAIT','EXHAUSTED','RESULT_RECORDED','COMPLETED','REJECTED','LEGACY_BLOCKED')),
  attempt_number integer not null default 0 check(attempt_number between 0 and 5),
  current_attempt_id uuid,
  next_attempt_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(storage_path=actor_id::text||'/'||document_id::text),
  check((attempt_number=0)=(current_attempt_id is null)),
  check((state='RETRY_WAIT')=(next_attempt_at is not null)),
  check(state<>'LEASED' or current_attempt_id is not null)
);
create table bx1_private.document_processing_attempts (
  id uuid primary key,
  document_id uuid not null references bx1_private.document_processing_jobs(document_id) on delete restrict,
  authority_epoch bigint not null check(authority_epoch between 1 and 9007199254740991),
  attempt_number integer not null check(attempt_number between 1 and 5),
  worker_id text not null,
  scanner_id text not null,
  reference text not null unique,
  started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  outcome text not null default 'LEASED' check(outcome in ('LEASED','EXPIRED','FAILED','CLEAN','MALICIOUS')),
  failure_code text check(failure_code in ('ENGINE_UNAVAILABLE','INVALID_DOCUMENT','DELIVERY_FAILED','HASH_MISMATCH')),
  finished_at timestamptz,
  unique(document_id,attempt_number),
  unique(document_id,id),
  check(reference='bx1-scan:'||id::text),
  check(lease_expires_at=started_at+interval '120 seconds'),
  check((outcome='LEASED')=(finished_at is null)),
  check((outcome='FAILED')=(failure_code is not null))
);
alter table bx1_private.document_processing_jobs add constraint bx1_document_processing_current_attempt
  foreign key(document_id,current_attempt_id)
  references bx1_private.document_processing_attempts(document_id,id) on delete restrict;
create table bx1_private.document_processing_claim_receipts (
  worker_id text not null,
  request_id uuid not null,
  scanner_id text not null,
  authority_epoch bigint not null,
  manifest jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(worker_id,request_id),
  check(manifest is null or pg_catalog.jsonb_typeof(manifest)='object')
);
create table bx1_private.document_processing_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references bx1_private.document_processing_jobs(document_id) on delete restrict,
  attempt_id uuid,
  kind text not null check(kind in ('QUEUED','LEGACY_IMPORTED','CLAIMED','RETRY_WAIT','EXHAUSTED','RESULT_RECORDED','REJECTED','COMPLETED')),
  evidence jsonb not null check(pg_catalog.jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(document_id,attempt_id) references bx1_private.document_processing_attempts(document_id,id) on delete restrict
);
create index bx1_document_processing_queue on bx1_private.document_processing_jobs(state,next_attempt_at,created_at,document_id);
create index bx1_document_processing_evidence on bx1_private.document_processing_events(document_id,id);

alter table bx1_private.document_processing_policy enable row level security;
alter table bx1_private.document_processing_jobs enable row level security;
alter table bx1_private.document_processing_attempts enable row level security;
alter table bx1_private.document_processing_claim_receipts enable row level security;
alter table bx1_private.document_processing_events enable row level security;
revoke all on bx1_private.document_processing_policy,bx1_private.document_processing_jobs,
  bx1_private.document_processing_attempts,bx1_private.document_processing_claim_receipts,
  bx1_private.document_processing_events from public,anon,authenticated,service_role,
  bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker;
revoke all on sequence bx1_private.document_processing_events_id_seq from public,anon,authenticated,
  service_role,bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker;

create function bx1_private.guard_document_processing_policy() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' or NEW.singleton is distinct from OLD.singleton then
    raise exception 'document_processing_policy_immutable' using errcode='23514'; end if;
  if NEW.state is distinct from OLD.state or NEW.worker_id is distinct from OLD.worker_id
    or NEW.scanner_id is distinct from OLD.scanner_id then
    if OLD.authority_epoch>=9007199254740991 then
      raise exception 'document_processing_epoch_exhausted' using errcode='55000'; end if;
    NEW.authority_epoch:=OLD.authority_epoch+1;
  else NEW.authority_epoch:=OLD.authority_epoch; end if;
  NEW.changed_at:=pg_catalog.clock_timestamp();
  return NEW;
end $$;
create trigger bx1_document_processing_policy_guard before update or delete
  on bx1_private.document_processing_policy for each row
  execute function bx1_private.guard_document_processing_policy();

-- Input identity is fixed at quarantine; later retention decisions remain free
-- to set their existing retention field and never change the byte/hash binding.
create function bx1_private.guard_document_processing_input() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then
    raise exception 'document_processing_input_immutable' using errcode='23514'; end if;
  if NEW.id is distinct from OLD.id or NEW.actor_id is distinct from OLD.actor_id
    or NEW.session_id is distinct from OLD.session_id or NEW.storage_path is distinct from OLD.storage_path
    or NEW.kind is distinct from OLD.kind or NEW.title is distinct from OLD.title
    or NEW.sha256 is distinct from OLD.sha256 or NEW.byte_size is distinct from OLD.byte_size
    or NEW.mime_type is distinct from OLD.mime_type or NEW.created_at is distinct from OLD.created_at then
    raise exception 'document_processing_input_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_document_processing_input_immutable before update or delete
  on bx1_private.document_quarantine_items for each row
  execute function bx1_private.guard_document_processing_input();
create function bx1_private.guard_document_processing_job() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'document_processing_job_immutable' using errcode='23514'; end if;
  if NEW.document_id is distinct from OLD.document_id or NEW.origin is distinct from OLD.origin
    or NEW.actor_id is distinct from OLD.actor_id or NEW.storage_path is distinct from OLD.storage_path
    or NEW.sha256 is distinct from OLD.sha256 or NEW.byte_size is distinct from OLD.byte_size
    or NEW.mime_type is distinct from OLD.mime_type or NEW.created_at is distinct from OLD.created_at then
    raise exception 'document_processing_job_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_document_processing_job_immutable before update or delete
  on bx1_private.document_processing_jobs for each row
  execute function bx1_private.guard_document_processing_job();
create function bx1_private.guard_document_processing_attempt() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'document_processing_attempt_immutable' using errcode='23514'; end if;
  if NEW.id is distinct from OLD.id or NEW.document_id is distinct from OLD.document_id
    or NEW.authority_epoch is distinct from OLD.authority_epoch or NEW.attempt_number is distinct from OLD.attempt_number
    or NEW.worker_id is distinct from OLD.worker_id or NEW.scanner_id is distinct from OLD.scanner_id
    or NEW.reference is distinct from OLD.reference or NEW.started_at is distinct from OLD.started_at
    or NEW.lease_expires_at is distinct from OLD.lease_expires_at or OLD.outcome<>'LEASED' then
    raise exception 'document_processing_attempt_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_document_processing_attempt_immutable before update or delete
  on bx1_private.document_processing_attempts for each row
  execute function bx1_private.guard_document_processing_attempt();
create trigger bx1_document_processing_receipt_immutable before update or delete
  on bx1_private.document_processing_claim_receipts for each row execute function bx1_portal.immutable_record();
create trigger bx1_document_processing_event_immutable before update or delete
  on bx1_private.document_processing_events for each row execute function bx1_portal.immutable_record();

create function bx1_private.queue_document_processing() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if NEW.state<>'QUARANTINED' then
    raise exception 'document_processing_new_quarantine_required' using errcode='23514'; end if;
  insert into bx1_private.document_processing_jobs
    (document_id,origin,actor_id,storage_path,sha256,byte_size,mime_type,state)
  values(NEW.id,'NEW',NEW.actor_id,NEW.storage_path,NEW.sha256,NEW.byte_size,NEW.mime_type,'QUEUED');
  insert into bx1_private.document_processing_events(document_id,kind,evidence)
  values(NEW.id,'QUEUED',pg_catalog.jsonb_build_object('origin','NEW','sha256',NEW.sha256,
    'storage_path',NEW.storage_path,'size',NEW.byte_size,'mime_type',NEW.mime_type));
  return NEW;
end $$;
create trigger bx1_document_processing_quarantine_enqueue after insert
  on bx1_private.document_quarantine_items for each row execute function bx1_private.queue_document_processing();

-- Real historical scan rows are retained, not repackaged as invented attempts.
-- A legacy CLEAN job cannot pass the leased-result promotion fence without a
-- separately reviewed rebind, deliberately absent from this work package.
insert into bx1_private.document_processing_jobs
  (document_id,origin,actor_id,storage_path,sha256,byte_size,mime_type,state,created_at)
select q.id,case q.state when 'QUARANTINED' then 'LEGACY_PENDING'
    when 'SCANNED_CLEAN' then 'LEGACY_RESULT' when 'PROMOTED' then 'LEGACY_COMPLETED'
    else 'LEGACY_REJECTED' end,q.actor_id,q.storage_path,q.sha256,q.byte_size,q.mime_type,
  case q.state when 'QUARANTINED' then 'QUEUED' when 'PROMOTED' then 'COMPLETED'
    when 'REJECTED' then 'REJECTED' else case when exists(
      select 1 from bx1_private.document_scan_events e where e.document_id=q.id and e.verdict='CLEAN'
        and e.sha256=q.sha256 and e.scanner_id=q.scanner_id and e.scanner_reference=q.scanner_reference)
      then 'RESULT_RECORDED' else 'LEGACY_BLOCKED' end end,q.created_at
from bx1_private.document_quarantine_items q;
insert into bx1_private.document_processing_events(document_id,kind,evidence)
select j.document_id,'LEGACY_IMPORTED',pg_catalog.jsonb_build_object('origin',j.origin,
  'state',j.state,'sha256',j.sha256,'attempt_created',false,'result_created',false)
from bx1_private.document_processing_jobs j;

create function bx1_private.document_processing_authority(p_worker text,p_scanner text)
returns bx1_private.document_processing_policy
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy;
begin
  select * into p from bx1_private.document_processing_policy where singleton for share;
  if p.state is distinct from 'ADMITTED' or p.worker_id is distinct from p_worker
    or p.scanner_id is distinct from p_scanner or p_worker is null or p_scanner is null
    or not exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SCANNER_REQUIRED') then
    raise exception 'document_processing_not_admitted' using errcode='42501'; end if;
  return p;
end $$;
create function bx1_private.document_processing_manifest(p_job bx1_private.document_processing_jobs,
  p_attempt bx1_private.document_processing_attempts) returns jsonb
language sql immutable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('document_id',p_job.document_id,'attempt_id',p_attempt.id,
    'authority_epoch',p_attempt.authority_epoch,'attempt_number',p_attempt.attempt_number,
    'worker_id',p_attempt.worker_id,'scanner_id',p_attempt.scanner_id,'reference',p_attempt.reference,
    'lease_expires_at',p_attempt.lease_expires_at,'actor_id',p_job.actor_id,'storage_path',p_job.storage_path,
    'sha256',p_job.sha256,'size',p_job.byte_size,'mime_type',p_job.mime_type);
$$;

create function bx1_private.claim_document_processing(p_worker text,p_scanner text,p_request uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy; j bx1_private.document_processing_jobs;
  a bx1_private.document_processing_attempts; r bx1_private.document_processing_claim_receipts;
  result jsonb; v_now timestamptz;
begin
  if p_worker is null or p_scanner is null or p_request is null then
    raise exception 'document_processing_claim_invalid' using errcode='22023'; end if;
  p:=bx1_private.document_processing_authority(p_worker,p_scanner);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bx1_document_processing_request:'||p_worker||':'||p_request::text,0));
  select * into r from bx1_private.document_processing_claim_receipts
    where worker_id=p_worker and request_id=p_request;
  if r.request_id is not null then
    if r.scanner_id is distinct from p_scanner then
      raise exception 'document_processing_request_conflict' using errcode='23505'; end if;
    if r.manifest is null or r.authority_epoch<>p.authority_epoch then return null; end if;
    select * into j from bx1_private.document_processing_jobs
      where document_id=(r.manifest->>'document_id')::uuid for share;
    select * into a from bx1_private.document_processing_attempts
      where id=(r.manifest->>'attempt_id')::uuid and document_id=j.document_id;
    if j.state='LEASED' and j.current_attempt_id=a.id and a.outcome='LEASED'
      and a.authority_epoch=p.authority_epoch and a.lease_expires_at>pg_catalog.clock_timestamp()
      and a.worker_id=p_worker and a.scanner_id=p_scanner then return r.manifest; end if;
    return null;
  end if;
  loop
    v_now:=pg_catalog.clock_timestamp();
    select candidate.* into j from bx1_private.document_processing_jobs candidate
      left join bx1_private.document_processing_attempts last_attempt on last_attempt.id=candidate.current_attempt_id
      where candidate.state='QUEUED'
        or (candidate.state='RETRY_WAIT' and candidate.next_attempt_at<=v_now)
        or (candidate.state='LEASED' and (last_attempt.lease_expires_at<=v_now
          or last_attempt.authority_epoch<>p.authority_epoch))
      order by candidate.created_at,candidate.document_id
      for update of candidate skip locked limit 1;
    if j.document_id is null then exit; end if;
    if j.state='LEASED' then
      select * into a from bx1_private.document_processing_attempts where id=j.current_attempt_id for update;
      update bx1_private.document_processing_attempts set outcome='EXPIRED',finished_at=v_now where id=a.id;
      update bx1_private.document_processing_jobs set
        state=case when attempt_number>=5 then 'EXHAUSTED' else 'RETRY_WAIT' end,
        next_attempt_at=case when attempt_number>=5 then null else v_now+interval '30 seconds' end,
        updated_at=v_now where document_id=j.document_id returning * into j;
      insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
      values(j.document_id,a.id,j.state,pg_catalog.jsonb_build_object('reason',
        case when a.authority_epoch<>p.authority_epoch then 'AUTHORITY_CHANGED' else 'LEASE_EXPIRED' end,
        'sha256',j.sha256,'authority_epoch',a.authority_epoch,'attempt_number',a.attempt_number));
      continue;
    end if;
    if j.attempt_number>=5 then
      update bx1_private.document_processing_jobs set state='EXHAUSTED',next_attempt_at=null,
        updated_at=v_now where document_id=j.document_id returning * into j;
      insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
      values(j.document_id,j.current_attempt_id,'EXHAUSTED',pg_catalog.jsonb_build_object('reason','ATTEMPT_LIMIT','sha256',j.sha256));
      continue;
    end if;
    insert into bx1_private.document_processing_attempts
      (id,document_id,authority_epoch,attempt_number,worker_id,scanner_id,reference,started_at,lease_expires_at)
    select attempt_id,j.document_id,p.authority_epoch,j.attempt_number+1,p_worker,p_scanner,
      'bx1-scan:'||attempt_id::text,v_now,v_now+interval '120 seconds'
    from (select pg_catalog.gen_random_uuid() attempt_id) fresh returning * into a;
    update bx1_private.document_processing_jobs set state='LEASED',attempt_number=a.attempt_number,
      current_attempt_id=a.id,next_attempt_at=null,updated_at=v_now
      where document_id=j.document_id returning * into j;
    result:=bx1_private.document_processing_manifest(j,a);
    insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
    values(j.document_id,a.id,'CLAIMED',result||pg_catalog.jsonb_build_object('request_id',p_request));
    exit;
  end loop;
  insert into bx1_private.document_processing_claim_receipts(worker_id,request_id,scanner_id,authority_epoch,manifest)
  values(p_worker,p_request,p_scanner,p.authority_epoch,result);
  return result;
end $$;

create function bx1_private.read_document_processing(p_document uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy; j bx1_private.document_processing_jobs;
  a bx1_private.document_processing_attempts;
begin
  p:=bx1_private.document_processing_authority(p_worker,p_scanner);
  select * into j from bx1_private.document_processing_jobs where document_id=p_document for share;
  select * into a from bx1_private.document_processing_attempts where id=p_attempt and document_id=p_document;
  if p_document is null or p_attempt is null or p_epoch is null
    or j.document_id is null or a.id is null or j.state<>'LEASED' or a.outcome<>'LEASED'
    or j.current_attempt_id is distinct from a.id or a.document_id is distinct from p_document
    or a.authority_epoch is distinct from p_epoch or p.authority_epoch is distinct from p_epoch
    or a.worker_id is distinct from p_worker or a.scanner_id is distinct from p_scanner
    or a.lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'document_processing_lease_denied' using errcode='42501'; end if;
  return bx1_private.document_processing_manifest(j,a);
end $$;

create function bx1_private.fail_document_processing(p_document uuid,p_attempt uuid,p_epoch bigint,
  p_worker text,p_scanner text,p_code text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy; j bx1_private.document_processing_jobs;
  a bx1_private.document_processing_attempts; v_now timestamptz;
begin
  if p_code is null or p_code not in ('ENGINE_UNAVAILABLE','INVALID_DOCUMENT','DELIVERY_FAILED','HASH_MISMATCH') then
    raise exception 'document_processing_failure_invalid' using errcode='22023'; end if;
  p:=bx1_private.document_processing_authority(p_worker,p_scanner);
  select * into j from bx1_private.document_processing_jobs where document_id=p_document for update;
  select * into a from bx1_private.document_processing_attempts where id=p_attempt and document_id=p_document for update;
  v_now:=pg_catalog.clock_timestamp();
  if p_document is null or p_attempt is null or p_epoch is null
    or j.document_id is null or a.id is null or j.state<>'LEASED' or a.outcome<>'LEASED'
    or j.current_attempt_id is distinct from a.id or a.document_id is distinct from p_document
    or a.authority_epoch is distinct from p_epoch or p.authority_epoch is distinct from p_epoch
    or a.worker_id is distinct from p_worker or a.scanner_id is distinct from p_scanner
    or a.lease_expires_at<=v_now then
    raise exception 'document_processing_lease_denied' using errcode='42501'; end if;
  update bx1_private.document_processing_attempts set outcome='FAILED',failure_code=p_code,
    finished_at=v_now where id=a.id;
  update bx1_private.document_processing_jobs set
    state=case when attempt_number>=5 or p_code in ('INVALID_DOCUMENT','HASH_MISMATCH')
      then 'EXHAUSTED' else 'RETRY_WAIT' end,
    next_attempt_at=case when attempt_number>=5 or p_code in ('INVALID_DOCUMENT','HASH_MISMATCH')
      then null else v_now+interval '30 seconds' end,updated_at=v_now
    where document_id=j.document_id returning * into j;
  insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
  values(j.document_id,a.id,j.state,pg_catalog.jsonb_build_object('code',p_code,'sha256',j.sha256,
    'authority_epoch',a.authority_epoch,'attempt_number',a.attempt_number,'next_attempt_at',j.next_attempt_at));
  return pg_catalog.jsonb_build_object('document_id',j.document_id,'attempt_id',a.id,
    'state',j.state,'attempt_number',j.attempt_number,'next_attempt_at',j.next_attempt_at);
end $$;

-- The old bodies are preserved verbatim under owner-only names, never exposed
-- as an alternate writer path. Both public signatures below are mandatory fences.
alter function bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz)
  rename to record_document_scan_pre_processing;
alter function bx1_private.promote_scanned_document(uuid) rename to promote_scanned_document_pre_processing;
revoke all on function bx1_private.record_document_scan_pre_processing(uuid,text,text,text,text,timestamptz),
  bx1_private.promote_scanned_document_pre_processing(uuid) from public,anon,authenticated,service_role,
  bx1_document_receipt_writer,bx1_document_scanner_writer,bx1_document_processing_worker;

create function bx1_private.record_document_scan(p_id uuid,p_sha256 text,p_scanner text,
  p_reference text,p_verdict text,p_observed_at timestamptz) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy; j bx1_private.document_processing_jobs;
  a bx1_private.document_processing_attempts; e bx1_private.document_scan_events;
  q bx1_private.document_quarantine_items; result jsonb;
begin
  if p_id is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_scanner is null or p_reference is null
    or p_reference !~ '^bx1-scan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_verdict is null or p_verdict not in ('CLEAN','MALICIOUS') or p_observed_at is null then
    raise exception 'document_processing_result_invalid' using errcode='22023'; end if;
  -- Policy is always the first row lock, shared with claim/read/failure.
  select * into p from bx1_private.document_processing_policy where singleton for share;
  if p.state is distinct from 'ADMITTED' or p.scanner_id is distinct from p_scanner
    or not exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SCANNER_REQUIRED') then
    raise exception 'document_processing_not_admitted' using errcode='42501'; end if;
  select * into j from bx1_private.document_processing_jobs where document_id=p_id for update;
  select * into a from bx1_private.document_processing_attempts
    where id=pg_catalog.substr(p_reference,10)::uuid and document_id=p_id for update;
  if j.document_id is null or a.id is null or j.current_attempt_id is distinct from a.id
    or a.document_id is distinct from p_id or a.reference is distinct from p_reference
    or a.authority_epoch is distinct from p.authority_epoch or a.worker_id is distinct from p.worker_id
    or a.scanner_id is distinct from p_scanner or j.sha256 is distinct from p_sha256 then
    raise exception 'document_processing_result_fence_denied' using errcode='42501'; end if;
  select * into e from bx1_private.document_scan_events where document_id=p_id;
  if e.id is not null then
    if e.scanner_id is distinct from p_scanner or e.scanner_reference is distinct from p_reference
      or e.verdict is distinct from p_verdict or e.sha256 is distinct from p_sha256
      or e.observed_at is distinct from p_observed_at then
      raise exception 'document_scan_replay_conflict' using errcode='23505'; end if;
    if a.outcome is distinct from p_verdict or j.state not in ('RESULT_RECORDED','COMPLETED','REJECTED') then
      raise exception 'document_processing_result_fence_denied' using errcode='42501'; end if;
    -- Exact durable retry precedes freshness and lease gates. It cannot create
    -- new evidence and must remain valid after the original one-day window.
    select * into q from bx1_private.document_quarantine_items where id=p_id;
    return pg_catalog.jsonb_build_object('id',q.id,'state',q.state,'sha256',q.sha256,'storage_path',q.storage_path);
  end if;
  -- Acquire the historical writer's quarantine lock before the final lease
  -- check: a concurrent retention operation must not let this gate age while
  -- the delegated original writer waits for that same row.
  select * into q from bx1_private.document_quarantine_items where id=p_id for update;
  if q.id is null or q.sha256 is distinct from j.sha256 or q.storage_path is distinct from j.storage_path
    or j.state<>'LEASED' or a.outcome<>'LEASED' or a.lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'document_processing_result_fence_denied' using errcode='42501'; end if;
  result:=bx1_private.record_document_scan_pre_processing(p_id,p_sha256,p_scanner,p_reference,p_verdict,p_observed_at);
  update bx1_private.document_processing_attempts set outcome=p_verdict,
    finished_at=pg_catalog.clock_timestamp() where id=a.id;
  update bx1_private.document_processing_jobs set state=case when p_verdict='CLEAN'
    then 'RESULT_RECORDED' else 'REJECTED' end,updated_at=pg_catalog.clock_timestamp()
    where document_id=p_id returning * into j;
  insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
  values(p_id,a.id,j.state,pg_catalog.jsonb_build_object('scanner_id',p_scanner,
    'reference',p_reference,'verdict',p_verdict,'sha256',p_sha256,'observed_at',p_observed_at,
    'authority_epoch',a.authority_epoch));
  return result;
end $$;

create function bx1_private.promote_scanned_document(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.document_processing_policy; j bx1_private.document_processing_jobs;
  a bx1_private.document_processing_attempts; result jsonb;
begin
  select * into p from bx1_private.document_processing_policy where singleton for share;
  if p.state is distinct from 'ADMITTED'
    or not exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SCANNER_REQUIRED') then
    raise exception 'document_processing_not_admitted' using errcode='42501'; end if;
  select * into j from bx1_private.document_processing_jobs where document_id=p_id for update;
  select * into a from bx1_private.document_processing_attempts
    where id=j.current_attempt_id and document_id=p_id for update;
  if p_id is null or j.document_id is null or a.id is null
    or j.state not in ('RESULT_RECORDED','COMPLETED') or a.outcome<>'CLEAN'
    or a.document_id is distinct from p_id or a.authority_epoch is distinct from p.authority_epoch
    or a.worker_id is distinct from p.worker_id or a.scanner_id is distinct from p.scanner_id
    or not exists(select 1 from bx1_private.document_scan_events e where e.document_id=p_id
      and e.verdict='CLEAN' and e.sha256=j.sha256 and e.scanner_id=a.scanner_id
      and e.scanner_reference=a.reference) then
    raise exception 'document_processing_promotion_fence_denied' using errcode='42501'; end if;
  -- Byte copy/rehash is still the existing server authority. If its original
  -- promotion fails, this entire transaction retains RESULT_RECORDED/CLEAN.
  result:=bx1_private.promote_scanned_document_pre_processing(p_id);
  if j.state<>'COMPLETED' then
    update bx1_private.document_processing_jobs set state='COMPLETED',updated_at=pg_catalog.clock_timestamp()
      where document_id=p_id;
    insert into bx1_private.document_processing_events(document_id,attempt_id,kind,evidence)
    values(p_id,a.id,'COMPLETED',pg_catalog.jsonb_build_object('sha256',j.sha256,
      'reference',a.reference,'authority_epoch',a.authority_epoch));
  end if;
  return result;
end $$;

revoke all on function bx1_private.guard_document_processing_policy(),bx1_private.guard_document_processing_input(),
  bx1_private.guard_document_processing_job(),bx1_private.guard_document_processing_attempt(),
  bx1_private.queue_document_processing(),bx1_private.document_processing_authority(text,text),
  bx1_private.document_processing_manifest(bx1_private.document_processing_jobs,bx1_private.document_processing_attempts),
  bx1_private.claim_document_processing(text,text,uuid),
  bx1_private.read_document_processing(uuid,uuid,bigint,text,text),
  bx1_private.fail_document_processing(uuid,uuid,bigint,text,text,text),
  bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz),
  bx1_private.promote_scanned_document(uuid)
  from public,anon,authenticated,service_role,bx1_document_receipt_writer,
    bx1_document_scanner_writer,bx1_document_processing_worker;
grant execute on function bx1_private.claim_document_processing(text,text,uuid),
  bx1_private.read_document_processing(uuid,uuid,bigint,text,text),
  bx1_private.fail_document_processing(uuid,uuid,bigint,text,text,text)
  to bx1_document_processing_worker;
grant execute on function bx1_private.record_document_scan(uuid,text,text,text,text,timestamptz),
  bx1_private.promote_scanned_document(uuid) to bx1_document_scanner_writer;
