-- UX-D1: private unfinished answers, separate from application/admission history.
-- Install atomically after the accepted normal admission and document receipts.
-- No existing function, application row, role, provider or MAIN gate is changed.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.admission_lock_actor(text,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.admission_application_handoff(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_private.admission_receipt_session(uuid,uuid,jsonb)') is null
    or pg_catalog.to_regclass('bx1_portal.application_drafts') is not null then
    raise exception 'application_drafts_baseline_required' using errcode='55000'; end if;
end $$;

create table bx1_portal.application_drafts (
  application_id uuid primary key references bx1_portal.applications(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  base_application_revision integer not null check(base_application_revision>0),
  draft_revision integer not null check(draft_revision>0),
  answers jsonb not null check(pg_catalog.jsonb_typeof(answers)='object'),
  step text not null check(step in ('identity','organisation','purpose','evidence','ownership','review')),
  saved_at timestamptz not null
);
create table bx1_portal.application_draft_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null, application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  payload jsonb not null check(pg_catalog.jsonb_typeof(payload)='object'),
  draft_revision integer not null check(draft_revision>0), saved_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(), primary key(actor_id,request_key)
);
alter table bx1_portal.application_drafts enable row level security;
alter table bx1_portal.application_draft_requests enable row level security;
revoke all on bx1_portal.application_drafts,bx1_portal.application_draft_requests from public,anon,authenticated,service_role;
create trigger application_draft_request_immutable before update or delete on bx1_portal.application_draft_requests
  for each row execute function bx1_portal.immutable_record();

create function bx1_portal.application_draft_guard(target_application uuid) returns bx1_portal.applications
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; h jsonb;
begin
  -- Actor/session locks are shared with retained writers; this is not sufficient
  -- write authority on its own. Exact ownership and admitted PREPARE are below.
  perform bx1_portal.admission_lock_actor(null,'{"mode":"APPLICANT"}'::jsonb);
  select * into a from bx1_portal.applications where id=target_application and user_id=auth.uid() for share;
  if a.id is null or a.status not in ('DRAFT','CHANGES_REQUIRED','REJECTED') then
    raise exception 'application_draft_authority_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_require_context(a.context_organisation_id);
  h:=bx1_portal.admission_application_handoff('{"mode":"APPLICANT"}'::jsonb,a.id);
  if h is null or h->>'actor_id' is distinct from auth.uid()::text
    or h->>'application_id' is distinct from a.id::text
    or h->>'application_revision' is distinct from a.revision::text
    or h->>'persona' is distinct from a.persona
    or h->'operating_context' is distinct from '{"mode":"APPLICANT"}'::jsonb
    or h->>'environment' is distinct from (select environment from bx1_portal.entry_configuration where singleton)
    or coalesce(h->>'state','') not in ('PREPARE_APPLICATION','INFORMATION_REQUIRED','REAPPLICATION_REQUIRED')
    or h->'gates'->'intake_admitted' is distinct from 'true'::jsonb
    or coalesce(h->'allowed_actions' ? 'PREPARE_APPLICATION',false) is not true
    or coalesce(h->>'blocker','') not in ('NONE','REVIEWER_UNAVAILABLE') then
    raise exception 'application_draft_preparation_denied' using errcode='42501'; end if;
  return a;
end $$;

-- Match JavaScript/Zod's UTF-16 bounds, not PostgreSQL's codepoint count.
-- Valid UTF-8 has one F0..F4 leading byte for each two-unit non-BMP character.
create function bx1_portal.draft_text_length(value text) returns integer
language sql immutable strict security invoker set search_path='' as $$
  with bytes as materialized (select pg_catalog.convert_to(value,'UTF8') b)
  select char_length(value)+(select count(*)::integer from bytes
    cross join lateral pg_catalog.generate_series(0,octet_length(b)-1) g(i)
    where pg_catalog.get_byte(b,i) between 240 and 244);
$$;

create function bx1_portal.validate_draft_answers(answers jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare field text; maximum integer; item jsonb; r bx1_private.document_upload_receipts;
begin
  perform bx1_portal.require_keys(answers,array['full_name','country','investor_type','company_name','registration_reference',
    'beneficial_owners','source_of_funds','experience','business_activities','representative_position','authority_basis',
    'documents','ownership_control','ownership_change_reason']);
  for field,maximum in select * from (values ('full_name',120),('country',2),('company_name',160),('registration_reference',100),
    ('beneficial_owners',2000),('source_of_funds',2000),('experience',2000),('business_activities',2000),
    ('representative_position',160),('authority_basis',2000),('ownership_change_reason',500)) limits loop
    if pg_catalog.jsonb_typeof(answers->field) is distinct from 'string' or bx1_portal.draft_text_length(answers->>field)>maximum then
      raise exception 'application_draft_invalid_answers' using errcode='22023'; end if;
  end loop;
  if pg_catalog.jsonb_typeof(answers->'investor_type') is distinct from 'string'
    or answers->>'investor_type' not in ('INDIVIDUAL','ENTITY')
    or pg_catalog.jsonb_typeof(answers->'documents') is distinct from 'array'
    or pg_catalog.jsonb_array_length(answers->'documents')>8
    or pg_catalog.jsonb_typeof(answers->'ownership_control') is distinct from 'array'
    or pg_catalog.jsonb_array_length(answers->'ownership_control')>20 then
    raise exception 'application_draft_invalid_answers' using errcode='22023'; end if;
  for item in select value from pg_catalog.jsonb_array_elements(answers->'ownership_control') loop
    perform bx1_portal.require_keys(item,array['id','party_type','legal_name','registration_reference','country','relationship',
      'ownership_basis_points','control_basis','effective_on','change_reason','evidence_document_id']);
    for field,maximum in select * from (values ('legal_name',160),('registration_reference',100),('country',2),
      ('control_basis',1000),('effective_on',10),('change_reason',500),('evidence_document_id',36)) limits loop
      if pg_catalog.jsonb_typeof(item->field) is distinct from 'string' or bx1_portal.draft_text_length(item->>field)>maximum then
        raise exception 'application_draft_invalid_ownership' using errcode='22023'; end if;
    end loop;
    if pg_catalog.jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item->'party_type') is distinct from 'string' or item->>'party_type' not in ('PERSON','ENTITY')
      or pg_catalog.jsonb_typeof(item->'relationship') is distinct from 'string' or item->>'relationship' not in ('DIRECT_OWNER','INDIRECT_OWNER','CONTROLLER')
      or pg_catalog.jsonb_typeof(item->'ownership_basis_points') is distinct from 'number'
      or item->>'ownership_basis_points' !~ '^(0|[1-9][0-9]{0,4})$' or (item->>'ownership_basis_points')::integer>10000
      or (item->>'evidence_document_id'<>'' and item->>'evidence_document_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'application_draft_invalid_ownership' using errcode='22023'; end if;
  end loop;
  -- A draft reference still belongs to a verified private upload. It does not
  -- claim scanner/provider/ownership clearance and no complete evidence set is required.
  for item in select value from pg_catalog.jsonb_array_elements(answers->'documents') loop
    perform bx1_portal.require_keys(item,array['id','kind','title','storage_path','sha256','size','mime_type']);
    if pg_catalog.jsonb_typeof(item->'id') is distinct from 'string' or item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(item->'kind') is distinct from 'string' or item->>'kind' not in ('IDENTITY','ADDRESS','COMPANY','BENEFICIAL_OWNERS')
      or pg_catalog.jsonb_typeof(item->'title') is distinct from 'string' or bx1_portal.draft_text_length(item->>'title') not between 1 and 160
      or pg_catalog.jsonb_typeof(item->'storage_path') is distinct from 'string' or bx1_portal.draft_text_length(item->>'storage_path') not between 1 and 400
      or pg_catalog.jsonb_typeof(item->'sha256') is distinct from 'string' or item->>'sha256' !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(item->'size') is distinct from 'number' or item->>'size' !~ '^[1-9][0-9]{0,6}$'
      or (item->>'size')::integer>4194304 or pg_catalog.jsonb_typeof(item->'mime_type') is distinct from 'string'
      or item->>'mime_type' not in ('application/pdf','image/png','image/jpeg') then
      raise exception 'application_draft_invalid_document' using errcode='22023'; end if;
    select * into r from bx1_private.document_upload_receipts where id=(item->>'id')::uuid and actor_id=auth.uid() for share;
    if r.id is null or r.storage_path is distinct from item->>'storage_path' or r.kind is distinct from item->>'kind'
      or r.title is distinct from item->>'title' or r.sha256 is distinct from item->>'sha256'
      or r.byte_size is distinct from (item->>'size')::integer or r.mime_type is distinct from item->>'mime_type'
      or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
        and o.name=r.storage_path and o.owner_id=auth.uid()::text
        and o.metadata->>'size'=r.byte_size::text and o.metadata->>'mimetype'=r.mime_type) then
      raise exception 'application_draft_document_denied' using errcode='42501'; end if;
  end loop;
end $$;

create function bx1_portal.application_draft_read(application_id uuid,expected_application_revision integer,request_key uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; d bx1_portal.application_drafts; r bx1_portal.application_draft_requests; environment text;
begin
  a:=bx1_portal.application_draft_guard(application_id);
  if expected_application_revision is null or expected_application_revision is distinct from a.revision then
    raise exception 'application_draft_stale_application' using errcode='40001'; end if;
  select * into d from bx1_portal.application_drafts x where x.application_id=a.id and x.actor_id=auth.uid();
  if d.base_application_revision is distinct from a.revision then d:=null; end if;
  if request_key is not null then
    select * into r from bx1_portal.application_draft_requests x where x.actor_id=auth.uid() and x.request_key=application_draft_read.request_key;
    if r.request_key is not null and (r.application_id is distinct from a.id
      or r.payload->>'expected_application_revision' is distinct from a.revision::text
      or d.application_id is null or r.draft_revision is distinct from d.draft_revision
      or r.payload->'answers' is distinct from d.answers or r.payload->>'step' is distinct from d.step
      or r.saved_at is distinct from d.saved_at) then
      raise exception 'application_draft_receipt_not_current' using errcode='40001'; end if;
  end if;
  a:=bx1_portal.application_draft_guard(a.id);
  select c.environment into environment from bx1_portal.entry_configuration c where c.singleton;
  return pg_catalog.jsonb_build_object('version',1,'environment',environment,'actor_id',auth.uid(),
    'application',pg_catalog.jsonb_build_object('id',a.id,'persona',a.persona,'status',a.status,'context_kind',a.context_kind,
      'context_organisation_id',a.context_organisation_id,'origin',a.origin,'admission_purpose',a.admission_purpose),
    'base_application_revision',a.revision,'draft_revision',coalesce(d.draft_revision,0),
    'draft',case when d.application_id is null then null else pg_catalog.jsonb_build_object('answers',d.answers,'step',d.step,'saved_at',d.saved_at) end,
    'receipt',case when r.request_key is null then null else pg_catalog.jsonb_build_object('key',r.request_key,'payload',r.payload,'draft_revision',r.draft_revision,'saved_at',r.saved_at) end);
end $$;

create function bx1_portal.application_draft_save(request_key uuid,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; d bx1_portal.application_drafts; r bx1_portal.application_draft_requests;
  new_revision integer; saved_time timestamptz;
begin
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>262144 then
    raise exception 'application_draft_invalid_request' using errcode='22023'; end if;
  perform bx1_portal.require_keys(payload,array['application_id','expected_application_revision','expected_draft_revision','answers','step']);
  if pg_catalog.jsonb_typeof(payload->'application_id') is distinct from 'string'
    or payload->>'application_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(payload->'expected_application_revision') is distinct from 'number'
    or payload->>'expected_application_revision' !~ '^[1-9][0-9]{0,8}$'
    or pg_catalog.jsonb_typeof(payload->'expected_draft_revision') is distinct from 'number'
    or payload->>'expected_draft_revision' !~ '^(0|[1-9][0-9]{0,8})$'
    or pg_catalog.jsonb_typeof(payload->'step') is distinct from 'string'
    or payload->>'step' not in ('identity','organisation','purpose','evidence','ownership','review') then
    raise exception 'application_draft_invalid_request' using errcode='22023'; end if;
  a:=bx1_portal.application_draft_guard((payload->>'application_id')::uuid);
  if a.revision is distinct from (payload->>'expected_application_revision')::integer then
    raise exception 'application_draft_stale_application' using errcode='40001'; end if;
  select * into r from bx1_portal.application_draft_requests x where x.actor_id=auth.uid() and x.request_key=application_draft_save.request_key;
  if r.request_key is not null then
    if r.payload is distinct from payload then raise exception 'application_draft_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.application_draft_read(a.id,a.revision,request_key);
  end if;
  select * into d from bx1_portal.application_drafts x where x.application_id=a.id for update;
  if d.application_id is not null and d.actor_id is distinct from auth.uid() then
    raise exception 'application_draft_authority_denied' using errcode='42501'; end if;
  if d.base_application_revision is distinct from a.revision then d:=null; end if;
  if coalesce(d.draft_revision,0) is distinct from (payload->>'expected_draft_revision')::integer then
    raise exception 'application_draft_stale_revision' using errcode='40001'; end if;
  perform bx1_portal.validate_draft_answers(payload->'answers');
  new_revision:=coalesce(d.draft_revision,0)+1;
  if new_revision>999999999 then raise exception 'application_draft_revision_exhausted' using errcode='40001'; end if;
  saved_time:=pg_catalog.clock_timestamp();
  insert into bx1_portal.application_drafts(application_id,actor_id,base_application_revision,draft_revision,answers,step,saved_at)
    values(a.id,auth.uid(),a.revision,new_revision,payload->'answers',payload->>'step',saved_time)
    on conflict(application_id) do update set base_application_revision=excluded.base_application_revision,
      draft_revision=excluded.draft_revision,answers=excluded.answers,step=excluded.step,saved_at=excluded.saved_at;
  insert into bx1_portal.application_draft_requests(actor_id,request_key,application_id,payload,draft_revision,saved_at)
    values(auth.uid(),request_key,a.id,payload,new_revision,saved_time);
  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
    values(a.id,a.id,'save_application_draft',auth.uid(),'Unfinished applicant answers saved privately; no submission or authority change.');
  return bx1_portal.application_draft_read(a.id,a.revision,request_key);
end $$;

create function public.bx1_application_draft_read(application_id uuid,expected_application_revision integer,request_key uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$ select bx1_portal.application_draft_read(application_id,expected_application_revision,request_key); $$;
create function public.bx1_application_draft_save(request_key uuid,payload jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$ select bx1_portal.application_draft_save(request_key,payload); $$;
revoke all on function bx1_portal.application_draft_guard(uuid),bx1_portal.draft_text_length(text),bx1_portal.validate_draft_answers(jsonb),
  bx1_portal.application_draft_read(uuid,integer,uuid),bx1_portal.application_draft_save(uuid,jsonb),
  public.bx1_application_draft_read(uuid,integer,uuid),public.bx1_application_draft_save(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function bx1_portal.application_draft_read(uuid,integer,uuid),bx1_portal.application_draft_save(uuid,jsonb),
  public.bx1_application_draft_read(uuid,integer,uuid),public.bx1_application_draft_save(uuid,jsonb) to authenticated;
