-- SIG-1.2-01. Additive definitions only; no hosted admission or provider effect.
-- Apply atomically after the accepted d42c offering-document overlay. This file
-- deliberately contains no BEGIN/COMMIT so its caller owns the transaction.
do $signature_baseline$
declare item jsonb; actual text;
begin
  if current_user<>'postgres' or pg_catalog.to_regclass('bx1_private.offering_signature_policy') is not null
    or exists(select 1 from pg_catalog.pg_roles where rolname='bx1_offering_signature_worker')
    or exists(select 1 from storage.buckets where id='bx1-offering-signatures') then
    raise exception 'offering_signature_install_collision' using errcode='55000'; end if;
  for item in select value from pg_catalog.jsonb_array_elements($pins$[
    {"signature":"bx1_portal.lock_offering_product_before_decision()","hash":"506497010034c90796c5228a00c1a37babdf184cb05ae0752e7de8c9e2ffd6f6"},
    {"signature":"bx1_portal.offering_approved(uuid)","hash":"921c8ce94823f9bca58549db1a85500c3239c3b6ffc340e37bc25acb442ba7bc"},
    {"signature":"bx1_portal.offering_workflow_approved(uuid)","hash":"50a4d79c984776a856998dcce59024cfd50e4486bc86820d3d91772ceea206b6"},
    {"signature":"bx1_private.offering_document_evidence_summary(uuid)","hash":"6be2329527648f4632db28161a37e29f76757c3528a6c6d8da4a9a66ee509049"},
    {"signature":"bx1_private.offering_document_snapshot(jsonb,uuid)","hash":"837a4b94faf4c138c19e9514eb54b3ff4c62544f28f67ccf794eae45ad10a9ba"}
  ]$pins$::jsonb) loop
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') into actual
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(item->>'signature')
        and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
    if actual is distinct from item->>'hash' then
      raise exception 'offering_signature_source_pin_changed: %',item->>'signature' using errcode='55000'; end if;
  end loop;
end $signature_baseline$;

create role bx1_offering_signature_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema bx1_private to bx1_offering_signature_worker;

create table bx1_private.offering_signature_policy(
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('TESTNET','MAINNET')),
  purpose text not null default 'ISSUER_PACKAGE_EXECUTION' check(purpose='ISSUER_PACKAGE_EXECUTION'),
  state text not null default 'NOT_ADMITTED' check(state in ('NOT_ADMITTED','ADMITTED')),
  authority_epoch bigint not null default 1 check(authority_epoch between 1 and 9007199254740991),
  worker_id text check(worker_id ~ '^[a-z][a-z0-9_-]{2,119}$'),
  check(state<>'ADMITTED' or (environment='TESTNET' and worker_id is not null))
);
insert into bx1_private.offering_signature_policy(environment)
  select environment from bx1_portal.entry_configuration where singleton;

create table bx1_private.offering_signature_authorisations(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  manifest_id uuid not null references bx1_private.offering_document_manifests(id) on delete restrict,
  manifest_hash text not null check(manifest_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  document_hashes jsonb not null check(pg_catalog.jsonb_typeof(document_hashes)='object'),
  common_envelope_hash text not null check(common_envelope_hash ~ '^[0-9a-f]{64}$'),
  deployment_configuration_hash text not null check(deployment_configuration_hash ~ '^[0-9a-f]{64}$'),
  issuer_reference uuid not null, declaration_revision integer not null,
  declaration_hash text not null check(declaration_hash ~ '^[0-9a-f]{64}$'),
  manager_organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  acting_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  requester_id uuid not null references auth.users(id) on delete restrict,
  -- Protected identity tables grant the installer SELECT, not REFERENCES. The
  -- existing owner helper resolves and locks these UUIDs; no identity ACL expands.
  requester_person_id uuid not null,
  signer_id uuid not null references auth.users(id) on delete restrict,
  signer_person_id uuid not null,
  appointment_id uuid not null references bx1_portal.product_service_appointments(id) on delete restrict,
  appointment_receipt_id uuid not null references bx1_portal.product_service_appointment_receipts(id) on delete restrict,
  purpose text not null default 'ISSUER_PACKAGE_EXECUTION' check(purpose='ISSUER_PACKAGE_EXECUTION'),
  valid_from timestamptz not null, valid_until timestamptz not null,
  source_reference text not null check(char_length(source_reference) between 20 and 1000),
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(product_id,issuer_reference,declaration_revision) references bx1_portal.product_issuer_declarations(product_id,issuer_reference,declaration_revision) on delete restrict,
  check(pg_catalog.isfinite(valid_from) and pg_catalog.isfinite(valid_until) and valid_until>valid_from)
);
create table bx1_private.offering_signature_authorisation_events(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  authorisation_id uuid not null references bx1_private.offering_signature_authorisations(id) on delete restrict,
  event_number integer not null check(event_number>0),
  state text not null check(state in ('APPROVED','REJECTED','REVOKED','SUPERSEDED')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  person_id uuid not null,
  appointment_id uuid references bx1_portal.product_service_appointments(id) on delete restrict,
  superseding_authorisation_id uuid references bx1_private.offering_signature_authorisations(id) on delete restrict,
  reason text not null check(char_length(reason) between 20 and 1000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(authorisation_id,event_number),
  check((state='SUPERSEDED')=(superseding_authorisation_id is not null)),
  check(superseding_authorisation_id is null or superseding_authorisation_id<>authorisation_id)
);
create table bx1_private.offering_signature_operations(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  authorisation_id uuid not null references bx1_private.offering_signature_authorisations(id) on delete restrict,
  approval_event_id uuid not null references bx1_private.offering_signature_authorisation_events(id) on delete restrict,
  manifest_id uuid not null references bx1_private.offering_document_manifests(id) on delete restrict,
  purpose text not null default 'ISSUER_PACKAGE_EXECUTION' check(purpose='ISSUER_PACKAGE_EXECUTION'),
  environment text not null check(environment='TESTNET'),
  provider_account_id uuid not null default '4af4aa20-5739-4d0e-bde2-d8e83f9cce67' check(provider_account_id='4af4aa20-5739-4d0e-bde2-d8e83f9cce67'),
  originals jsonb not null check(pg_catalog.jsonb_typeof(originals)='array' and pg_catalog.jsonb_array_length(originals)=3),
  create_request jsonb, create_request_text text, create_request_sha256 text check(create_request_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_id uuid,
  state text not null default 'PREPARED' check(state in ('PREPARED','CREATE_INFLIGHT','SENT','UNKNOWN_RECONCILIATION','COMPLETION_OBSERVED','EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED','RECOVERY_REQUIRED')),
  generation bigint not null default 0 check(generation between 0 and 9007199254740991),
  lease_id uuid, lease_expires_at timestamptz, worker_id text,
  next_action text not null default 'PREPARE' check(next_action in ('PREPARE','CREATE','RECONCILE','RETAIN','VOID','VIEW','NONE')),
  next_check_at timestamptz, authority_epoch bigint not null,
  originating_actor_id uuid references auth.users(id) on delete restrict,
  originating_session_id uuid, originating_context jsonb, originating_request_id uuid,
  noncurrent_reason text check(char_length(noncurrent_reason)<=120),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(authorisation_id,manifest_id,purpose), unique(provider_account_id,envelope_id),
  check((create_request is null)=(create_request_sha256 is null)),
  check((create_request is null)=(create_request_text is null)),
  check(create_request_text is null or pg_catalog.octet_length(create_request_text)<=18000000)
);
create table bx1_private.offering_signature_command_receipts(
  actor_id uuid not null references auth.users(id) on delete restrict, request_key uuid not null,
  command text not null, operating_context jsonb not null, payload jsonb not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check(pg_catalog.jsonb_typeof(result)='object'),
  revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  operation_id uuid references bx1_private.offering_signature_operations(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(), primary key(actor_id,request_key)
);
create table bx1_private.offering_signature_attempts(
  request_id uuid primary key,
  operation_id uuid not null references bx1_private.offering_signature_operations(id) on delete restrict,
  action text not null check(action in ('PREPARE','CREATE','RECONCILE','RETAIN','VOID','VIEW')),
  worker_id text not null, lease_id uuid not null, generation bigint not null, authority_epoch bigint not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(), unique(operation_id,generation)
);
create table bx1_private.offering_signature_observations(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  request_id uuid not null unique,
  operation_id uuid not null references bx1_private.offering_signature_operations(id) on delete restrict,
  attempt_id uuid not null references bx1_private.offering_signature_attempts(request_id) on delete restrict,
  action text not null, result jsonb not null, result_sha256 text not null check(result_sha256 ~ '^[0-9a-f]{64}$'),
  current_at_observation boolean not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_private.offering_signature_artifacts(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  reservation_id uuid references bx1_private.offering_signature_artifacts(id) on delete restrict,
  operation_id uuid not null references bx1_private.offering_signature_operations(id) on delete restrict,
  kind text not null check(kind in ('COVER_ORIGINAL','MEMORANDUM_SIGNED','RISKS_SIGNED','SUBSCRIPTION_TERMS_SIGNED','COVER_SIGNED','CERTIFICATE')),
  provider_document_id text not null check(provider_document_id in ('1','2','3','4','certificate')),
  state text not null check(state in ('RESERVED','RETAINED')),
  path text not null check(char_length(path)<200),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  size integer not null check(size between 1 and 4194304),
  mime_type text not null default 'application/pdf' check(mime_type='application/pdf'),
  observation_id uuid not null references bx1_private.offering_signature_observations(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check((state='RESERVED')=(reservation_id is null)),
  check(kind<>'COVER_ORIGINAL' or size<=262144), unique(reservation_id)
);
create unique index offering_signature_artifact_reservation on bx1_private.offering_signature_artifacts(operation_id,kind) where state='RESERVED';
create table bx1_private.offering_signature_decision_bindings(
  decision_id uuid primary key references bx1_portal.offering_decisions(id) on delete restrict,
  authorisation_id uuid not null references bx1_private.offering_signature_authorisations(id) on delete restrict,
  approval_event_id uuid not null references bx1_private.offering_signature_authorisation_events(id) on delete restrict,
  operation_id uuid not null references bx1_private.offering_signature_operations(id) on delete restrict,
  observation_id uuid not null references bx1_private.offering_signature_observations(id) on delete restrict,
  manifest_id uuid not null references bx1_private.offering_document_manifests(id) on delete restrict,
  manifest_hash text not null check(manifest_hash ~ '^[0-9a-f]{64}$'),
  decision_kind text not null check(decision_kind in ('ISSUER','COMPLIANCE')),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bx1-offering-signatures','bx1-offering-signatures',false,4194304,array['application/pdf']);
create policy offering_signature_read_restrict on storage.objects as restrictive for select to public using(bucket_id<>'bx1-offering-signatures');
create policy offering_signature_insert_restrict on storage.objects as restrictive for insert to public with check(bucket_id<>'bx1-offering-signatures');
create policy offering_signature_update_restrict on storage.objects as restrictive for update to public using(bucket_id<>'bx1-offering-signatures') with check(bucket_id<>'bx1-offering-signatures');
create policy offering_signature_delete_restrict on storage.objects as restrictive for delete to public using(bucket_id<>'bx1-offering-signatures');

do $signature_tables$
declare name text; grant_role text;
begin
  foreach name in array array['offering_signature_policy','offering_signature_authorisations','offering_signature_authorisation_events',
    'offering_signature_operations','offering_signature_command_receipts','offering_signature_attempts','offering_signature_observations',
    'offering_signature_artifacts','offering_signature_decision_bindings'] loop
    execute pg_catalog.format('alter table bx1_private.%I owner to postgres',name);
    execute pg_catalog.format('alter table bx1_private.%I enable row level security',name);
    execute pg_catalog.format('revoke all on bx1_private.%I from public,anon,authenticated,service_role,bx1_document_receipt_writer,bx1_offering_signature_worker',name);
    for grant_role in select distinct case when x.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(r.rolname) end
      from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
      left join pg_catalog.pg_roles r on r.oid=x.grantee
      where c.oid=pg_catalog.to_regclass('bx1_private.'||name) and x.grantee<>c.relowner loop
      execute pg_catalog.format('revoke all on table bx1_private.%I from %s',name,grant_role);
    end loop;
    if name not in ('offering_signature_policy','offering_signature_operations') then
      execute pg_catalog.format('create trigger %I before update or delete on bx1_private.%I for each row execute function bx1_portal.immutable_record()',name||'_immutable',name);
    end if;
  end loop;
end $signature_tables$;

create function bx1_private.offering_signature_admitted() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.offering_signature_policy s join bx1_portal.entry_configuration c on c.singleton
    where s.singleton and s.environment=c.environment and s.environment='TESTNET' and s.state='ADMITTED'
      and s.worker_id is not null and c.manual_test_review and c.test_ordinary_entry_enabled)
    and bx1_private.offering_document_admitted();
$$;

create function bx1_private.offering_signature_lock_context(p_actor uuid,p_session uuid,p_aal text,c jsonb,p_revision uuid,p_attestation jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare product uuid;
begin
  perform bx1_private.offering_file_session_context(p_actor,p_session,p_aal,p_attestation);
  if bx1_private.offering_document_context(c) is not true then raise exception 'offering_signature_context_denied' using errcode='42501'; end if;
  select product_id into product from bx1_portal.offering_revisions where id=p_revision;
  if product is null then raise exception 'offering_signature_revision_denied' using errcode='42501'; end if;
  perform bx1_portal.offering_workflow_lock_actor(case c->>'role' when 'IssuerFundManager' then 'review_offering_issuer'
    when 'ComplianceOfficer' then 'review_product' else 'reopen_offering_review' end,c);
  perform bx1_portal.offering_workflow_lock_product(c,product);
  if exists(select 1 from bx1_portal.products where id=product and current_offering_revision_id=p_revision
    and status in ('IN_REVIEW','CHANGES_REQUIRED')) then
    perform bx1_private.lock_offering_document_revision(p_revision);
  end if;
  perform singleton from bx1_private.offering_signature_policy where singleton for share;
  if bx1_private.offering_document_visible(c,p_revision) is not true then raise exception 'offering_signature_context_denied' using errcode='42501'; end if;
end $$;

create function bx1_private.offering_signature_authorisation_current(p_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_private.offering_signature_authorisations; e bx1_private.offering_signature_authorisation_events;
begin
  select * into a from bx1_private.offering_signature_authorisations where id=p_id;
  if a.id is null or bx1_private.offering_signature_admitted() is not true then return false; end if;
  perform id from bx1_portal.products where id=a.product_id for update;
  perform singleton from bx1_private.offering_signature_policy where singleton for share;
  perform singleton from bx1_private.offering_document_policy where singleton for share;
  perform singleton from bx1_private.offering_document_scanner_policy where singleton for share;
  select * into e from bx1_private.offering_signature_authorisation_events where authorisation_id=a.id order by event_number desc limit 1;
  perform id from bx1_portal.product_service_appointments where id in (a.appointment_id,e.appointment_id) order by id for share;
  perform id from public.bx1_memberships where user_id in (a.requester_id,a.signer_id,e.actor_id) order by id for share;
  perform bx1_portal.admission_lock_people(array[a.requester_id,a.signer_id,e.actor_id]);
  if e.state is distinct from 'APPROVED' or a.valid_from>pg_catalog.clock_timestamp() or a.valid_until<=pg_catalog.clock_timestamp()
    or bx1_private.document_governance_trusted_person(a.requester_id,a.requester_person_id) is distinct from a.requester_person_id
    or bx1_private.document_governance_trusted_person(a.signer_id,a.signer_person_id) is distinct from a.signer_person_id
    or bx1_private.document_governance_trusted_person(e.actor_id,e.person_id) is distinct from e.person_id
    or e.person_id in (a.requester_person_id,a.signer_person_id)
    or bx1_portal.offering_workflow_product_appointment_effective(a.appointment_id) is not true
    or bx1_portal.offering_workflow_product_appointment_effective(e.appointment_id) is not true then return false; end if;
  return exists(select 1 from bx1_portal.products p join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id
    join bx1_private.offering_document_manifests m on m.id=a.manifest_id and m.offering_revision_id=r.id
    join bx1_portal.product_issuer_declarations d on d.product_id=p.id and d.issuer_reference=a.issuer_reference and d.declaration_revision=a.declaration_revision
    join bx1_portal.product_service_appointments ap on ap.id=a.appointment_id
    join bx1_portal.product_service_appointment_receipts ar on ar.id=a.appointment_receipt_id
    join bx1_portal.product_service_appointments ca on ca.id=e.appointment_id
    where p.id=a.product_id and r.id=a.revision_id and r.origin='SUBMITTED' and r.terms=p.terms and p.terms_hash=a.terms_hash
      and r.terms->'terms_version'='3'::jsonb and r.terms->>'asset_type' in ('FUND','REAL_ESTATE')
      and r.document_hashes=a.document_hashes and r.common_envelope_hash=a.common_envelope_hash
      and r.deployment_configuration_hash=a.deployment_configuration_hash and m.hash=a.manifest_hash
      and not exists(select 1 from bx1_private.offering_document_clean_receipts clean
        cross join bx1_private.offering_document_policy dp cross join bx1_private.offering_document_scanner_policy sp
        where clean.file_id=any(m.file_ids) and dp.singleton and sp.singleton
          and (clean.authority_epoch<>dp.authority_epoch or clean.scanner_authority_epoch<>sp.authority_epoch))
      and d.declaration_hash=a.declaration_hash and r.issuer_declaration_reference=a.issuer_reference and r.issuer_declaration_revision=a.declaration_revision
      and ap.product_id=p.id and ap.appointee_user_id=a.signer_id and ap.role='IssuerFundManager' and ap.status='APPLIED'
      and ap.approval_receipt_id=ar.id and ar.appointment_id=ap.id and ar.status_after='APPROVED'
      and ar.action='review_product_service_appointment' and ap.reviewer_scope_organisation_id=a.acting_organisation_id
      and ca.product_id=p.id and ca.appointee_user_id=e.actor_id and ca.role='ComplianceOfficer' and ca.status='APPLIED');
end $$;

create function bx1_private.offering_signature_evidence_current(p_operation uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.offering_signature_operations o
    join bx1_private.offering_signature_policy p on p.singleton and p.authority_epoch=o.authority_epoch
    where o.id=p_operation and o.state='EVIDENCE_RETAINED' and o.noncurrent_reason is null
      and bx1_private.offering_signature_authorisation_current(o.authorisation_id)
      and exists(select 1 from bx1_private.offering_signature_authorisation_events e where e.id=o.approval_event_id and e.state='APPROVED'
        and not exists(select 1 from bx1_private.offering_signature_authorisation_events later where later.authorisation_id=e.authorisation_id and later.event_number>e.event_number))
      and exists(select 1 from bx1_private.offering_signature_observations obs where obs.operation_id=o.id and obs.action='EVIDENCE_FINALIZED'
        and obs.current_at_observation and obs.result->'integrity_verified'='true'::jsonb)
      and (select count(*) from bx1_private.offering_signature_artifacts a where a.operation_id=o.id and a.state='RETAINED')=6);
$$;

create function bx1_private.offering_signature_decisions_current(p_revision uuid,p_issuer uuid,p_compliance uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_private.offering_signature_decision_bindings i
    join bx1_private.offering_signature_decision_bindings c on c.operation_id=i.operation_id and c.manifest_id=i.manifest_id
      and c.authorisation_id=i.authorisation_id and c.approval_event_id=i.approval_event_id
    join bx1_private.offering_signature_authorisations a on a.id=i.authorisation_id and a.revision_id=p_revision
    where i.decision_id=p_issuer and c.decision_id=p_compliance and i.decision_kind='ISSUER' and c.decision_kind='COMPLIANCE'
      and bx1_private.offering_signature_evidence_current(i.operation_id));
$$;

create function bx1_private.offering_signature_snapshot(c jsonb,p_revision uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; cfg bx1_portal.entry_configuration; commands jsonb:='[]'::jsonb;
  admitted boolean; is_manager boolean; is_issuer boolean; is_compliance boolean; blocked text;
begin
  if bx1_private.offering_document_visible(c,p_revision) is not true then raise exception 'offering_signature_read_denied' using errcode='42501'; end if;
  select product.* into p from bx1_portal.products product join bx1_portal.offering_revisions r on r.product_id=product.id where r.id=p_revision;
  select * into cfg from bx1_portal.entry_configuration where singleton;
  admitted:=bx1_private.offering_signature_admitted();
  is_manager:=bx1_private.offering_document_manager(c,p_revision);
  is_issuer:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager');
  is_compliance:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer');
  blocked:=case when not admitted then 'NOT_ADMITTED' when p.current_offering_revision_id<>p_revision then 'REVISION_NOT_CURRENT'
    when p.terms->'terms_version' is distinct from '3'::jsonb then 'ISSUER_BINDING_UNSUPPORTED'
    when not exists(select 1 from bx1_private.offering_document_manifests where offering_revision_id=p_revision) then 'MANIFEST_REQUIRED'
    when bx1_private.document_governance_trusted_person(auth.uid(),null) is null then 'TRUSTED_PERSON_REQUIRED' else null end;
  if blocked is null then
    if is_manager then commands:=commands||'"REQUEST_PURPOSE"'::jsonb; end if;
    if is_compliance then commands:=commands||'"REVIEW_PURPOSE"'::jsonb; end if;
    if is_manager or is_compliance then commands:=commands||'"REVOKE_PURPOSE"'::jsonb; end if;
    if is_issuer then commands:=commands||'["PREPARE_EXECUTION","REQUEST_SIGNING_VIEW"]'::jsonb; end if;
    if is_manager or is_issuer or is_compliance then commands:=commands||'["REQUEST_RECONCILIATION","REQUEST_RECOVERY"]'::jsonb; end if;
  end if;
  return pg_catalog.jsonb_build_object('version',1,'actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id','context',c,
    'environment',cfg.environment,'product_id',p.id,'revision_id',p_revision,'expected_revision',p.revision,
    'purpose','ISSUER_PACKAGE_EXECUTION','admitted',admitted,'allowed_commands',commands,'blocker',blocked,
    'authorisations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'signer_id',a.signer_id,
      'signer_person_id',a.signer_person_id,'appointment_id',a.appointment_id,
      'state',coalesce((select e.state from bx1_private.offering_signature_authorisation_events e where e.authorisation_id=a.id order by e.event_number desc limit 1),'REQUESTED'),
      'valid_from',a.valid_from,'valid_until',a.valid_until,'source_reference',a.source_reference) order by a.created_at,a.id)
      from bx1_private.offering_signature_authorisations a where a.revision_id=p_revision),'[]'::jsonb),
    'operations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'authorisation_id',o.authorisation_id,
      'state',o.state,'current',bx1_private.offering_signature_evidence_current(o.id),'noncurrent_reason',
      case when bx1_private.offering_signature_authorisation_current(o.authorisation_id) then o.noncurrent_reason else 'AUTHORITY_NOT_CURRENT' end,
      'envelope_id',o.envelope_id,'next_check_at',o.next_check_at,
      'artifacts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ar.reservation_id,'kind',ar.kind,
        'sha256',ar.sha256,'size',ar.size,'mime_type',ar.mime_type) order by ar.kind)
        from bx1_private.offering_signature_artifacts ar where ar.operation_id=o.id and ar.state='RETAINED'),'[]'::jsonb)) order by o.created_at,o.id)
      from bx1_private.offering_signature_operations o join bx1_private.offering_signature_authorisations a on a.id=o.authorisation_id
      where a.revision_id=p_revision),'[]'::jsonb));
end $$;

create function bx1_private.read_offering_signatures(p_actor uuid,p_session uuid,p_aal text,p_context jsonb,p_revision uuid,p_attestation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform bx1_private.offering_signature_lock_context(p_actor,p_session,p_aal,p_context,p_revision,p_attestation);
  return bx1_private.offering_signature_snapshot(p_context,p_revision);
end $$;

create function bx1_private.execute_offering_signature_command(p_actor uuid,p_session uuid,p_aal text,p_context jsonb,p_command text,p_key uuid,p_payload jsonb,p_attestation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; r bx1_portal.offering_revisions; m bx1_private.offering_document_manifests;
  d bx1_portal.product_issuer_declarations; ap bx1_portal.product_service_appointments;
  a bx1_private.offering_signature_authorisations; e bx1_private.offering_signature_authorisation_events;
  o bx1_private.offering_signature_operations; policy bx1_private.offering_signature_policy;
  prior bx1_private.offering_signature_command_receipts; person uuid; signer_person uuid; target uuid; approval uuid;
  fields text[]; latest_state text; at timestamptz:=pg_catalog.clock_timestamp(); result jsonb; action jsonb;
begin
  if p_command is null or p_command not in ('REQUEST_PURPOSE','REVIEW_PURPOSE','REVOKE_PURPOSE','PREPARE_EXECUTION',
      'REQUEST_RECONCILIATION','REQUEST_RECOVERY','REQUEST_SIGNING_VIEW') or p_key is null
    or p_key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(p_payload::text)>16384 then raise exception 'offering_signature_command_invalid' using errcode='22023'; end if;
  fields:=array['product_id','offering_revision_id','expected_revision']||case p_command
    when 'REQUEST_PURPOSE' then array['appointment_id','valid_from','valid_until','source_reference','source_sha256']
    when 'REVIEW_PURPOSE' then array['authorisation_id','decision','reason']
    when 'REVOKE_PURPOSE' then array['authorisation_id','reason']
    when 'PREPARE_EXECUTION' then array['authorisation_id']
    when 'REQUEST_RECOVERY' then array['operation_id','reason'] else array['operation_id'] end;
  perform bx1_portal.require_keys(p_payload,fields);
  if pg_catalog.jsonb_typeof(p_payload->'expected_revision') is distinct from 'number'
    or p_payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then raise exception 'offering_signature_command_invalid' using errcode='22023'; end if;
  perform bx1_private.offering_signature_lock_context(p_actor,p_session,p_aal,p_context,(p_payload->>'offering_revision_id')::uuid,p_attestation);
  select * into p from bx1_portal.products where id=(p_payload->>'product_id')::uuid for update;
  select * into r from bx1_portal.offering_revisions where id=(p_payload->>'offering_revision_id')::uuid;
  select * into policy from bx1_private.offering_signature_policy where singleton for share;
  if p.id is null or r.product_id is distinct from p.id or p.current_offering_revision_id is distinct from r.id
    or p.terms is distinct from r.terms or r.terms->'terms_version' is distinct from '3'::jsonb
    or r.terms->>'asset_type' not in ('FUND','REAL_ESTATE') or bx1_private.offering_signature_admitted() is not true then
    raise exception 'offering_signature_scope_denied' using errcode='42501'; end if;
  person:=bx1_private.document_governance_trusted_person(p_actor,null);
  if person is null then raise exception 'offering_signature_trusted_person_required' using errcode='42501'; end if;
  select * into prior from bx1_private.offering_signature_command_receipts where actor_id=p_actor and request_key=p_key;
  if prior.actor_id is not null then
    if prior.command<>p_command or prior.operating_context is distinct from p_context or prior.payload is distinct from p_payload then
      raise exception 'offering_signature_request_conflict' using errcode='23505'; end if;
    -- Replay still needs present capability. A VIEW URL is never replayed.
    result:=bx1_private.offering_signature_snapshot(p_context,r.id);
    if not(result->'allowed_commands' ? p_command) then raise exception 'offering_signature_replay_denied' using errcode='42501'; end if;
    if p_command in ('PREPARE_EXECUTION','REQUEST_SIGNING_VIEW') then
      select au.* into a from bx1_private.offering_signature_authorisations au
        left join bx1_private.offering_signature_operations op on op.authorisation_id=au.id
        where (p_command='PREPARE_EXECUTION' and au.id=(p_payload->>'authorisation_id')::uuid)
          or (p_command='REQUEST_SIGNING_VIEW' and op.id=(p_payload->>'operation_id')::uuid) limit 1;
      if a.id is null or a.signer_id<>p_actor or a.signer_person_id<>person
        or bx1_private.offering_signature_authorisation_current(a.id) is not true then
        raise exception 'offering_signature_replay_authority_changed' using errcode='42501'; end if;
    end if;
    return result;
  end if;
  if exists(select 1 from bx1_portal.scoped_requests where actor_id=p_actor and request_key=p_key)
    or exists(select 1 from bx1_portal.requests where actor_id=p_actor and request_key=p_key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=p_actor and request_key=p_key)
    or exists(select 1 from bx1_private.offering_document_command_receipts where actor_id=p_actor and request_key=p_key) then
    raise exception 'offering_signature_request_conflict' using errcode='23505'; end if;
  if p.revision<>(p_payload->>'expected_revision')::integer then raise exception 'offering_signature_stale' using errcode='23514'; end if;
  result:=bx1_private.offering_signature_snapshot(p_context,r.id);
  if not(result->'allowed_commands' ? p_command) then raise exception 'offering_signature_command_denied' using errcode='42501'; end if;
  select * into m from bx1_private.offering_document_manifests where offering_revision_id=r.id;
  if p_command='REQUEST_PURPOSE' then
    select * into ap from bx1_portal.product_service_appointments where id=(p_payload->>'appointment_id')::uuid for share;
    select * into d from bx1_portal.product_issuer_declarations where product_id=p.id
      and issuer_reference=r.issuer_declaration_reference and declaration_revision=r.issuer_declaration_revision;
    signer_person:=bx1_private.document_governance_trusted_person(ap.appointee_user_id,null);
    perform bx1_portal.require_text(p_payload,'source_reference',20,1000);
    if ap.id is null or ap.product_id<>p.id or ap.role<>'IssuerFundManager' or ap.status<>'APPLIED'
      or bx1_portal.offering_workflow_product_appointment_effective(ap.id) is not true or signer_person is null
      or d.product_id is null or m.id is null
      or not exists(select 1 from bx1_portal.product_service_appointment_receipts receipt where receipt.id=ap.approval_receipt_id
        and receipt.appointment_id=ap.id and receipt.action='review_product_service_appointment' and receipt.status_after='APPROVED')
      or coalesce(p_payload->>'source_sha256','') !~ '^[0-9a-f]{64}$'
      or not pg_catalog.isfinite((p_payload->>'valid_from')::timestamptz) or not pg_catalog.isfinite((p_payload->>'valid_until')::timestamptz)
      or (p_payload->>'valid_until')::timestamptz<=at or (p_payload->>'valid_until')::timestamptz>ap.requested_until
      or (p_payload->>'valid_until')::timestamptz<=(p_payload->>'valid_from')::timestamptz then
      raise exception 'offering_signature_purpose_binding_denied' using errcode='42501'; end if;
    insert into bx1_private.offering_signature_authorisations(product_id,revision_id,manifest_id,manifest_hash,terms_hash,document_hashes,
      common_envelope_hash,deployment_configuration_hash,issuer_reference,declaration_revision,declaration_hash,manager_organisation_id,
      acting_organisation_id,requester_id,requester_person_id,signer_id,signer_person_id,appointment_id,appointment_receipt_id,
      valid_from,valid_until,source_reference,source_sha256)
      values(p.id,r.id,m.id,m.hash,r.terms_hash,r.document_hashes,r.common_envelope_hash,r.deployment_configuration_hash,
      d.issuer_reference,d.declaration_revision,d.declaration_hash,p.organisation_id,ap.reviewer_scope_organisation_id,p_actor,person,
      ap.appointee_user_id,signer_person,ap.id,ap.approval_receipt_id,(p_payload->>'valid_from')::timestamptz,
      (p_payload->>'valid_until')::timestamptz,p_payload->>'source_reference',p_payload->>'source_sha256') returning * into a;
  elsif p_command in ('REVIEW_PURPOSE','REVOKE_PURPOSE','PREPARE_EXECUTION') then
    select * into a from bx1_private.offering_signature_authorisations where id=(p_payload->>'authorisation_id')::uuid for update;
    if a.id is null or a.product_id<>p.id or a.revision_id<>r.id or a.manifest_id<>m.id then raise exception 'offering_signature_authorisation_denied' using errcode='42501'; end if;
    select * into e from bx1_private.offering_signature_authorisation_events where authorisation_id=a.id order by event_number desc limit 1;
    if p_command='REVIEW_PURPOSE' then
    perform bx1_portal.require_text(p_payload,'reason',20,1000);
      if e.id is not null or p_payload->>'decision' not in ('APPROVED','REJECTED')
        or person in (a.requester_person_id,a.signer_person_id)
        or bx1_private.document_governance_trusted_person(a.requester_id,a.requester_person_id) is distinct from a.requester_person_id
        or bx1_private.document_governance_trusted_person(a.signer_id,a.signer_person_id) is distinct from a.signer_person_id then
        raise exception 'offering_signature_independent_purpose_denied' using errcode='42501'; end if;
      select * into ap from bx1_portal.product_service_appointments where product_id=p.id and appointee_user_id=p_actor
        and role='ComplianceOfficer' and bx1_portal.offering_workflow_product_appointment_effective(id) order by id limit 1 for share;
      if ap.id is null then raise exception 'offering_signature_compliance_denied' using errcode='42501'; end if;
      insert into bx1_private.offering_signature_authorisation_events(authorisation_id,event_number,state,actor_id,person_id,appointment_id,reason)
        values(a.id,1,p_payload->>'decision',p_actor,person,ap.id,p_payload->>'reason');
      if p_payload->>'decision'='APPROVED' and bx1_private.offering_signature_authorisation_current(a.id) is not true then
        raise exception 'offering_signature_purpose_not_current' using errcode='42501'; end if;
    elsif p_command='REVOKE_PURPOSE' then
      perform bx1_portal.require_text(p_payload,'reason',20,1000);
      if e.state is distinct from 'APPROVED' then raise exception 'offering_signature_revoke_denied' using errcode='42501'; end if;
      insert into bx1_private.offering_signature_authorisation_events(authorisation_id,event_number,state,actor_id,person_id,reason)
        values(a.id,e.event_number+1,'REVOKED',p_actor,person,p_payload->>'reason');
      update bx1_private.offering_signature_operations set noncurrent_reason='PURPOSE_REVOKED',
        next_action=case when state in ('PREPARED','EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED') then 'NONE'
          when state='COMPLETION_OBSERVED' then 'RETAIN' when envelope_id is not null then 'VOID' else 'RECONCILE' end
        where authorisation_id=a.id;
    else
      if a.signer_id<>p_actor or a.signer_person_id<>person or bx1_private.offering_signature_authorisation_current(a.id) is not true then
        raise exception 'offering_signature_signer_denied' using errcode='42501'; end if;
      select * into o from bx1_private.offering_signature_operations where authorisation_id=a.id and manifest_id=m.id;
      if o.id is null then
        insert into bx1_private.offering_signature_operations(authorisation_id,approval_event_id,manifest_id,environment,originals,authority_epoch)
          values(a.id,e.id,m.id,'TESTNET',m.evidence->'files',policy.authority_epoch) returning * into o;
      end if;
    end if;
  else
    select * into o from bx1_private.offering_signature_operations where id=(p_payload->>'operation_id')::uuid for update;
    select * into a from bx1_private.offering_signature_authorisations where id=o.authorisation_id;
    if o.id is null or a.revision_id<>r.id then raise exception 'offering_signature_operation_denied' using errcode='42501'; end if;
    if p_command='REQUEST_SIGNING_VIEW' then
      if a.signer_id<>p_actor or a.signer_person_id<>person or o.state<>'SENT' or o.envelope_id is null
        or bx1_private.offering_signature_authorisation_current(a.id) is not true
        or exists(select 1 from bx1_private.offering_signature_observations obs where obs.operation_id=o.id
          and obs.action='SIGNING_VIEW_RESULT' and obs.result->>'outcome'='UNKNOWN' and obs.result ? 'next_check_at'
          and (obs.result->>'next_check_at')::timestamptz>pg_catalog.clock_timestamp())
        or (o.lease_id is not null and o.lease_expires_at>at) then raise exception 'offering_signature_view_denied' using errcode='42501'; end if;
      update bx1_private.offering_signature_operations set next_action='VIEW',lease_id=pg_catalog.gen_random_uuid(),
        generation=generation+1,lease_expires_at=at+interval '60 seconds',worker_id=policy.worker_id,
        originating_actor_id=p_actor,originating_session_id=p_session,originating_context=p_context,originating_request_id=p_key
        where id=o.id returning * into o;
      insert into bx1_private.offering_signature_attempts values(p_key,o.id,'VIEW',o.worker_id,o.lease_id,o.generation,policy.authority_epoch,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('request_id',p_key,'operation_id',o.id,
          'action','VIEW','worker_id',o.worker_id,'lease_id',o.lease_id,'generation',o.generation,'authority_epoch',policy.authority_epoch)::text,'UTF8')),'hex'),at);
      action:=pg_catalog.jsonb_build_object('operation_id',o.id,'lease_id',o.lease_id,'generation',o.generation,'request_id',p_key);
    else
      if p_command='REQUEST_RECOVERY' then perform bx1_portal.require_text(p_payload,'reason',20,1000); end if;
      if o.state in ('EVIDENCE_RETAINED','DECLINED','VOIDED','SUPERSEDED') then raise exception 'offering_signature_terminal_operation' using errcode='23514'; end if;
      -- Requests never shorten persisted polling deadlines or create a new operation.
      update bx1_private.offering_signature_operations set state=case when p_command='REQUEST_RECOVERY' and state='RECOVERY_REQUIRED'
          and create_request is null and envelope_id is null and bx1_private.offering_signature_authorisation_current(authorisation_id)
          and authority_epoch=policy.authority_epoch then 'PREPARED' else state end,
        next_action=case when p_command='REQUEST_RECOVERY' and create_request is null and envelope_id is null
          and bx1_private.offering_signature_authorisation_current(authorisation_id) and authority_epoch=policy.authority_epoch then 'PREPARE'
        when state='COMPLETION_OBSERVED' then 'RETAIN'
        when state='PREPARED' then next_action else 'RECONCILE' end,
        noncurrent_reason=case when p_command='REQUEST_RECOVERY' and noncurrent_reason='PROVIDER_THROTTLED'
          and bx1_private.offering_signature_authorisation_current(authorisation_id) and authority_epoch=policy.authority_epoch
          then null else noncurrent_reason end where id=o.id;
    end if;
  end if;
  insert into bx1_private.offering_signature_command_receipts(actor_id,request_key,command,operating_context,payload,payload_sha256,result,revision_id,operation_id)
    values(p_actor,p_key,p_command,p_context,p_payload,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload::text,'UTF8')),'hex'),
      pg_catalog.jsonb_build_object('revision_id',r.id,'authorisation_id',a.id,'operation_id',o.id),r.id,o.id);
  result:=bx1_private.offering_signature_snapshot(p_context,r.id);
  if action is not null then result:=result||pg_catalog.jsonb_build_object('action',action); end if;
  return result;
end $$;

create function bx1_private.claim_offering_signature_action(p_worker text,p_request uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_private.offering_signature_operations; a bx1_private.offering_signature_authorisations;
  previous bx1_private.offering_signature_attempts; policy bx1_private.offering_signature_policy;
  candidate uuid; is_current boolean; at timestamptz;
begin
  if p_request is null or p_request='00000000-0000-0000-0000-000000000000' then
    raise exception 'offering_signature_claim_invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1-signature-claim:'||p_request::text,0));
  select * into policy from bx1_private.offering_signature_policy where singleton;
  if policy.environment<>'TESTNET' or policy.state<>'ADMITTED' or policy.worker_id is distinct from p_worker then
    raise exception 'offering_signature_worker_denied' using errcode='42501'; end if;
  select * into previous from bx1_private.offering_signature_attempts where request_id=p_request;
  if previous.request_id is not null then
    if previous.worker_id<>p_worker or previous.action='VIEW' then raise exception 'offering_signature_claim_conflict' using errcode='23505'; end if;
    select * into o from bx1_private.offering_signature_operations where id=previous.operation_id;
    if o.lease_id=previous.lease_id and o.generation=previous.generation and o.lease_expires_at>pg_catalog.clock_timestamp() then
      return bx1_private.read_offering_signature_action(p_worker,o.id,o.lease_id,o.generation); end if;
    return null;
  end if;
  for candidate in select op.id from bx1_private.offering_signature_operations op
    where op.next_action<>'NONE' and (op.next_action<>'VIEW' or op.lease_expires_at<=pg_catalog.clock_timestamp())
      and (op.next_check_at is null or op.next_check_at<=pg_catalog.clock_timestamp())
      and (op.lease_expires_at is null or op.lease_expires_at<=pg_catalog.clock_timestamp())
    order by op.created_at,op.id limit 32 loop
    select au.* into a from bx1_private.offering_signature_authorisations au
      join bx1_private.offering_signature_operations op on op.authorisation_id=au.id where op.id=candidate;
    perform id from bx1_portal.products where id=a.product_id for update skip locked;
    if not found then continue; end if;
    select * into o from bx1_private.offering_signature_operations where id=candidate for update skip locked;
    select * into policy from bx1_private.offering_signature_policy where singleton for share;
    if policy.state<>'ADMITTED' or policy.environment<>'TESTNET' or policy.worker_id is distinct from p_worker then
      raise exception 'offering_signature_worker_changed' using errcode='42501'; end if;
    at:=pg_catalog.clock_timestamp();
    if o.id is null or o.next_action='NONE' or o.next_check_at>at or o.lease_expires_at>at then continue; end if;
    -- An abandoned synchronous VIEW can resume observation, never generate a view.
    if o.next_action='VIEW' then
      update bx1_private.offering_signature_operations set next_action='RECONCILE' where id=o.id returning * into o;
    end if;
    is_current:=bx1_private.offering_signature_authorisation_current(a.id) and o.authority_epoch=policy.authority_epoch;
    at:=pg_catalog.clock_timestamp();
    -- An expired create lease is uncertain even when the process died before HTTP.
    if o.state='CREATE_INFLIGHT' then
      update bx1_private.offering_signature_operations set state='UNKNOWN_RECONCILIATION',next_action='RECONCILE' where id=o.id returning * into o;
    end if;
    if not is_current then
      update bx1_private.offering_signature_operations set noncurrent_reason=coalesce(noncurrent_reason,'AUTHORITY_CHANGED'),
        next_action=case when state='PREPARED' then 'NONE' when state='COMPLETION_OBSERVED' then 'RETAIN'
          when envelope_id is not null and state in ('SENT','UNKNOWN_RECONCILIATION') then 'VOID' else next_action end
        where id=o.id returning * into o;
      if o.next_action='NONE' then continue; end if;
    end if;
    update bx1_private.offering_signature_operations set lease_id=pg_catalog.gen_random_uuid(),generation=generation+1,
      lease_expires_at=at+interval '60 seconds',worker_id=p_worker,
      next_check_at=case when next_action in ('RECONCILE','VOID','RETAIN') then at+interval '900 seconds' else next_check_at end
      where id=o.id returning * into o;
    insert into bx1_private.offering_signature_attempts values(p_request,o.id,o.next_action,p_worker,o.lease_id,o.generation,policy.authority_epoch,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('request_id',p_request,'operation_id',o.id,
        'action',o.next_action,'worker_id',p_worker,'lease_id',o.lease_id,'generation',o.generation,'authority_epoch',policy.authority_epoch)::text,'UTF8')),'hex'),at);
    return bx1_private.read_offering_signature_action(p_worker,o.id,o.lease_id,o.generation);
  end loop;
  return null;
end $$;

create function bx1_private.read_offering_signature_action(p_worker text,p_operation uuid,p_lease uuid,p_generation bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_private.offering_signature_operations; a bx1_private.offering_signature_authorisations;
  t bx1_private.offering_signature_attempts; policy bx1_private.offering_signature_policy;
  email text; label text; is_current boolean; files jsonb;
begin
  select au.* into a from bx1_private.offering_signature_authorisations au
    join bx1_private.offering_signature_operations op on op.authorisation_id=au.id where op.id=p_operation;
  perform id from bx1_portal.products where id=a.product_id for update;
  select * into o from bx1_private.offering_signature_operations where id=p_operation for update;
  select * into policy from bx1_private.offering_signature_policy where singleton for share;
  select * into t from bx1_private.offering_signature_attempts where operation_id=o.id and generation=p_generation;
  if o.id is null or policy.state<>'ADMITTED' or policy.environment<>'TESTNET' or policy.worker_id is distinct from p_worker
    or o.worker_id is distinct from p_worker or o.lease_id is distinct from p_lease or o.generation is distinct from p_generation
    or o.lease_expires_at<=pg_catalog.clock_timestamp() or t.request_id is null or t.lease_id is distinct from p_lease
    or t.authority_epoch<>policy.authority_epoch then raise exception 'offering_signature_lease_denied' using errcode='42501'; end if;
  is_current:=bx1_private.offering_signature_authorisation_current(a.id) and o.authority_epoch=policy.authority_epoch;
  if o.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception 'offering_signature_lease_expired_after_wait' using errcode='42501'; end if;
  if t.action in ('PREPARE','CREATE','VIEW') and not is_current then
    raise exception 'offering_signature_authority_changed' using errcode='42501'; end if;
  if t.action='VIEW' and (o.originating_actor_id is distinct from a.signer_id
    or not exists(select 1 from auth.sessions s where s.id=o.originating_session_id and s.user_id=a.signer_id
      and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp()))
    or bx1_private.document_governance_trusted_person(o.originating_actor_id,a.signer_person_id) is distinct from a.signer_person_id) then
    raise exception 'offering_signature_view_actor_changed' using errcode='42501'; end if;
  select u.email,coalesce(nullif(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'),''),u.email) into email,label
    from auth.users u where u.id=a.signer_id and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp());
  -- Editable display name is a label only; account/TRUSTED person/appointment are authority.
  if email is null and t.action in ('PREPARE','CREATE','VIEW') then raise exception 'offering_signature_verified_signer_required' using errcode='42501'; end if;
  if o.create_request is not null then
    if t.action in ('PREPARE','CREATE','VIEW') and email is distinct from o.create_request->'recipients'->'signers'->0->>'email' then
      raise exception 'offering_signature_signer_email_changed' using errcode='42501'; end if;
    email:=o.create_request->'recipients'->'signers'->0->>'email';
    label:=o.create_request->'recipients'->'signers'->0->>'name';
  end if;
  select pg_catalog.jsonb_agg(f.value||pg_catalog.jsonb_build_object('storage_path',c.storage_path) order by f.ordinality) into files
    from pg_catalog.jsonb_array_elements(o.originals) with ordinality f(value,ordinality)
    join bx1_private.offering_document_clean_receipts c on c.id=(f.value->>'clean_receipt_id')::uuid and c.file_id=(f.value->>'file_id')::uuid;
  if pg_catalog.jsonb_array_length(files) is distinct from 3 then raise exception 'offering_signature_originals_missing' using errcode='23514'; end if;
  return pg_catalog.jsonb_build_object('operation_id',o.id,'authorisation_id',a.id,'action',t.action,'lease_id',o.lease_id,
    'generation',o.generation,'lease_expires_at',o.lease_expires_at,'authority_epoch',t.authority_epoch,'worker_id',p_worker,'environment',o.environment,
    'revision_id',a.revision_id,'manifest_id',a.manifest_id,'manifest_hash',a.manifest_hash,'provider_account_id',o.provider_account_id,
    'envelope_id',o.envelope_id,'current',is_current,'create_request',o.create_request_text,'create_request_sha256',o.create_request_sha256,
    'first_attempt_at',coalesce((select min(obs.created_at) from bx1_private.offering_signature_observations obs
      where obs.operation_id=o.id and obs.action='CREATE_RESULT' and obs.result->>'phase'='INFLIGHT'),o.created_at),
    'completion_evidence',(select obs.result->>'evidence_json' from bx1_private.offering_signature_observations obs
      where obs.operation_id=o.id and obs.action in ('RECONCILE_RESULT','VOID_RESULT') and obs.result->>'status'='COMPLETED'
      order by obs.created_at desc,obs.id limit 1),
    'completion_evidence_sha256',(select obs.result->>'evidence_sha256' from bx1_private.offering_signature_observations obs
      where obs.operation_id=o.id and obs.action in ('RECONCILE_RESULT','VOID_RESULT') and obs.result->>'status'='COMPLETED'
      order by obs.created_at desc,obs.id limit 1),
    'signer',pg_catalog.jsonb_build_object('actor_id',a.signer_id,'person_id',a.signer_person_id,'email',email,
      'name',pg_catalog.left(label,100),'client_user_id',a.signer_id::text),'originals',files,
    'binding',pg_catalog.jsonb_build_object('product_id',a.product_id,'issuer_reference',a.issuer_reference,
      'declaration_revision',a.declaration_revision,'declaration_hash',a.declaration_hash,'purpose',a.purpose,'terms_hash',a.terms_hash,
      'document_hashes',a.document_hashes,'common_envelope_hash',a.common_envelope_hash,'deployment_configuration_hash',a.deployment_configuration_hash,
      'text_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(a.document_hashes::text,'UTF8')),'hex'),
      'appointment_id',a.appointment_id,'appointment_receipt_id',a.appointment_receipt_id,'acting_organisation_id',a.acting_organisation_id,
      'manager_organisation_id',a.manager_organisation_id,'valid_from',a.valid_from,'valid_until',a.valid_until,
      'source_reference',a.source_reference,'source_sha256',a.source_sha256),
    'artifacts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ar.id,'kind',ar.kind,
      'provider_document_id',ar.provider_document_id,'path',ar.path,'sha256',ar.sha256,'size',ar.size,
      'state',case when exists(select 1 from bx1_private.offering_signature_artifacts done where done.reservation_id=ar.id) then 'RETAINED' else 'RESERVED' end) order by ar.kind)
      from bx1_private.offering_signature_artifacts ar where ar.operation_id=o.id and ar.state='RESERVED'),'[]'::jsonb),
    'request_id',t.request_id,'originating_actor_id',o.originating_actor_id,'originating_session_id',o.originating_session_id);
end $$;

create function bx1_private.record_offering_signature_action(p_worker text,p_operation uuid,p_lease uuid,p_generation bigint,
  p_request uuid,p_action text,p_result jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_private.offering_signature_operations; a bx1_private.offering_signature_authorisations;
  t bx1_private.offering_signature_attempts; policy bx1_private.offering_signature_policy;
  prior bx1_private.offering_signature_observations; ar bx1_private.offering_signature_artifacts;
  observation uuid; artifact uuid; is_current boolean; at timestamptz; digest text; data jsonb; envelope uuid; scheduled timestamptz;
  resource jsonb; resource_name text;
  checkpoint boolean;
begin
  if p_request is null or p_request='00000000-0000-0000-0000-000000000000' or p_action not in
    ('CREATE_RESULT','RECONCILE_RESULT','SIGNING_VIEW_RESULT','VOID_RESULT','ARTIFACT_RESERVED','ARTIFACT_RETAINED','EVIDENCE_FINALIZED','RECOVERY_REQUIRED')
    or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
    or pg_catalog.octet_length(p_result::text)>19000000 then raise exception 'offering_signature_result_invalid' using errcode='22023'; end if;
  if exists(select 1 from pg_catalog.jsonb_each(p_result) v where pg_catalog.jsonb_typeof(v.value) in ('object','array')
    or (v.value='null'::jsonb and not(v.key='envelope_id' or (p_action='SIGNING_VIEW_RESULT' and v.key in ('url_sha256','expires_at'))
      or (p_action='RECOVERY_REQUIRED' and v.key='evidence_sha256')))
    or (v.key in ('sha256','evidence_sha256','create_request_sha256','url_sha256') and v.value<>'null'::jsonb
      and pg_catalog.jsonb_typeof(v.value)<>'string')) then raise exception 'offering_signature_result_type_invalid' using errcode='22023'; end if;
  select au.* into a from bx1_private.offering_signature_authorisations au
    join bx1_private.offering_signature_operations op on op.authorisation_id=au.id where op.id=p_operation;
  perform id from bx1_portal.products where id=a.product_id for update;
  select * into o from bx1_private.offering_signature_operations where id=p_operation for update;
  select * into policy from bx1_private.offering_signature_policy where singleton for share;
  select * into t from bx1_private.offering_signature_attempts where operation_id=o.id and generation=p_generation;
  at:=pg_catalog.clock_timestamp();
  if o.id is null or policy.state<>'ADMITTED' or policy.environment<>'TESTNET' or policy.worker_id is distinct from p_worker
    or o.worker_id is distinct from p_worker or o.lease_id is distinct from p_lease or o.generation is distinct from p_generation
    or o.lease_expires_at<=at or t.request_id is null or t.lease_id is distinct from p_lease or t.authority_epoch<>policy.authority_epoch then
    raise exception 'offering_signature_lease_denied' using errcode='42501'; end if;
  digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_result::text,'UTF8')),'hex');
  select * into prior from bx1_private.offering_signature_observations where request_id=p_request;
  if prior.id is not null then
    if prior.operation_id<>o.id or prior.attempt_id<>t.request_id or prior.action<>p_action or prior.result is distinct from p_result then
      raise exception 'offering_signature_result_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('operation_id',o.id,'state',o.state,'next_action',o.next_action,
      'next_check_at',o.next_check_at,'artifact_id',(select coalesce(reservation_id,id) from bx1_private.offering_signature_artifacts where observation_id=prior.id limit 1),
      'current',bx1_private.offering_signature_evidence_current(o.id),'can_perform',false);
  end if;
  is_current:=bx1_private.offering_signature_authorisation_current(a.id) and o.authority_epoch=policy.authority_epoch;
  at:=pg_catalog.clock_timestamp();
  if o.lease_expires_at<=at then raise exception 'offering_signature_lease_expired_after_wait' using errcode='42501'; end if;
  observation:=pg_catalog.gen_random_uuid();
  checkpoint:=coalesce(p_result->>'phase'='INFLIGHT',false);
  -- Validate every closed result before recording; URLs, paths and client identities are never accepted.
  if checkpoint and p_action<>'CREATE_RESULT' then
    perform bx1_portal.require_keys(p_result,case when p_action='ARTIFACT_RESERVED' then array['phase','kind'] else array['phase'] end);
    if not ((p_action='RECONCILE_RESULT' and t.action='RECONCILE' and o.state in ('SENT','UNKNOWN_RECONCILIATION','RECOVERY_REQUIRED'))
      or (p_action='VOID_RESULT' and t.action='VOID' and o.state in ('SENT','UNKNOWN_RECONCILIATION','RECOVERY_REQUIRED'))
      or (p_action='SIGNING_VIEW_RESULT' and t.action='VIEW' and o.state='SENT' and is_current)
      or (p_action='ARTIFACT_RESERVED' and t.action='RETAIN' and o.state='COMPLETION_OBSERVED'
        and p_result->>'kind' in ('MEMORANDUM_SIGNED','RISKS_SIGNED','SUBSCRIPTION_TERMS_SIGNED','COVER_SIGNED','CERTIFICATE'))) then
      raise exception 'offering_signature_http_checkpoint_denied' using errcode='23514'; end if;
    if p_action='SIGNING_VIEW_RESULT' then perform bx1_private.read_offering_signature_action(p_worker,o.id,p_lease,p_generation); end if;
    if exists(select 1 from bx1_private.offering_signature_observations obs where obs.attempt_id=t.request_id
      and obs.action=p_action and obs.result->>'phase'='INFLIGHT'
      and (p_action<>'ARTIFACT_RESERVED' or obs.result->>'kind'=p_result->>'kind')) then
      return pg_catalog.jsonb_build_object('operation_id',o.id,'state',o.state,'next_action',o.next_action,'next_check_at',o.next_check_at,
        'artifact_id',null,'current',bx1_private.offering_signature_evidence_current(o.id),'can_perform',false);
    end if;
  elsif p_action='CREATE_RESULT' then
    if t.action not in ('PREPARE','CREATE') then raise exception 'offering_signature_result_predecessor' using errcode='23514'; end if;
    if p_result->>'phase'='INFLIGHT' then
      perform bx1_portal.require_keys(p_result,array['phase','create_request','create_request_sha256']);
      if not is_current or o.state<>'PREPARED' or o.create_request is not null
        or pg_catalog.jsonb_typeof(p_result->'create_request') is distinct from 'string'
        or pg_catalog.octet_length(p_result->>'create_request')>18000000
        or not exists(select 1 from bx1_private.offering_signature_artifacts where operation_id=o.id and kind='COVER_ORIGINAL' and state='RETAINED')
        or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_result->>'create_request','UTF8')),'hex') is distinct from p_result->>'create_request_sha256' then
        raise exception 'offering_signature_create_checkpoint_denied' using errcode='23514'; end if;
      data:=(p_result->>'create_request')::jsonb;
      if data->>'transactionId' is distinct from o.id::text or data->>'status' is distinct from 'sent'
        or data->'recipientsLock' is distinct from '"true"'::jsonb or data->'allowReassign' is distinct from '"false"'::jsonb
        or data->'allowMarkup' is distinct from '"false"'::jsonb or data->'enableWetSign' is distinct from '"false"'::jsonb
        or pg_catalog.jsonb_array_length(data->'documents') is distinct from 4
        or pg_catalog.jsonb_array_length(data->'recipients'->'signers') is distinct from 1
        or data->'recipients'->'signers'->0->>'clientUserId' is distinct from a.signer_id::text
        or data->'recipients'->'signers'->0->>'email' is distinct from (select email from auth.users where id=a.signer_id and email_confirmed_at is not null) then
        raise exception 'offering_signature_create_binding_denied' using errcode='23514'; end if;
      update bx1_private.offering_signature_operations set create_request=data,create_request_text=p_result->>'create_request',
        create_request_sha256=p_result->>'create_request_sha256',state='CREATE_INFLIGHT',next_action='RECONCILE',
        next_check_at=at+interval '900 seconds' where id=o.id;
    else
      perform bx1_portal.require_keys(p_result,array['phase','envelope_id','evidence_sha256']||
        case when p_result->>'phase'='UNKNOWN' and p_result ? 'next_check_at' then array['next_check_at'] else array[]::text[] end);
      envelope:=(p_result->>'envelope_id')::uuid;
      if o.state<>'CREATE_INFLIGHT' or p_result->>'phase' not in ('SENT','UNKNOWN')
        or (p_result->>'phase'='SENT' and envelope is null) or (p_result->>'phase'='UNKNOWN' and envelope is not null)
        or p_result->>'evidence_sha256' !~ '^[0-9a-f]{64}$' then raise exception 'offering_signature_create_result_denied' using errcode='23514'; end if;
      scheduled:=case when p_result ? 'next_check_at' then (p_result->>'next_check_at')::timestamptz else at+interval '900 seconds' end;
      if scheduled is null or not pg_catalog.isfinite(scheduled) then raise exception 'offering_signature_schedule_invalid' using errcode='22023'; end if;
      update bx1_private.offering_signature_operations set envelope_id=envelope,state=case when envelope is null then 'UNKNOWN_RECONCILIATION' else 'SENT' end,
        next_action=case when envelope is not null and not is_current then 'VOID' else 'RECONCILE' end,
        next_check_at=greatest(scheduled,at+interval '900 seconds'),lease_expires_at=at where id=o.id;
    end if;
  elsif p_action in ('RECONCILE_RESULT','VOID_RESULT') then
    if (p_action='RECONCILE_RESULT' and t.action<>'RECONCILE') or (p_action='VOID_RESULT' and t.action<>'VOID')
      or o.state not in ('SENT','UNKNOWN_RECONCILIATION','RECOVERY_REQUIRED') then
      raise exception 'offering_signature_result_predecessor' using errcode='23514'; end if;
    if not exists(select 1 from bx1_private.offering_signature_observations obs where obs.attempt_id=t.request_id
      and obs.action=p_action and obs.result->>'phase'='INFLIGHT') then
      raise exception 'offering_signature_http_checkpoint_required' using errcode='23514'; end if;
    perform bx1_portal.require_keys(p_result,case when p_action='RECONCILE_RESULT' then
      array['status','envelope_id','integrity_verified','evidence_sha256','next_check_at']||
        case when p_result->>'status'='COMPLETED' then array['evidence_json'] else array[]::text[] end
      else array['status','evidence_sha256','next_check_at']||
        case when p_result->>'status'='COMPLETED' then array['evidence_json','integrity_verified'] else array[]::text[] end end);
    envelope:=case when p_action='VOID_RESULT' then o.envelope_id else (p_result->>'envelope_id')::uuid end;
    scheduled:=(p_result->>'next_check_at')::timestamptz;
    if p_result->>'status' not in ('SENT','COMPLETED','DECLINED','VOIDED','UNKNOWN')
      or (p_action='VOID_RESULT' and p_result->>'status' not in ('VOIDED','COMPLETED','UNKNOWN'))
      or (p_result->>'status'<>'UNKNOWN' and envelope is null)
      or (o.envelope_id is not null and envelope is distinct from o.envelope_id)
      or p_result->>'evidence_sha256' !~ '^[0-9a-f]{64}$' or scheduled is null or not pg_catalog.isfinite(scheduled)
      or ((p_action='RECONCILE_RESULT' or p_result->>'status'='COMPLETED') and pg_catalog.jsonb_typeof(p_result->'integrity_verified') is distinct from 'boolean') then
      raise exception 'offering_signature_reconciliation_invalid' using errcode='22023'; end if;
    scheduled:=greatest(scheduled,at+interval '900 seconds');
    if p_result->>'status'='COMPLETED' then
      if pg_catalog.jsonb_typeof(p_result->'evidence_json') is distinct from 'string'
        or pg_catalog.octet_length(p_result->>'evidence_json')>6291456
        or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_result->>'evidence_json','UTF8')),'hex') is distinct from p_result->>'evidence_sha256' then
        raise exception 'offering_signature_complete_evidence_digest_invalid' using errcode='22023'; end if;
      data:=(p_result->>'evidence_json')::jsonb;
      perform bx1_portal.require_keys(data,array['envelope','recipients','documents','custom_fields','audit_events','tabs']);
      for resource_name,resource in select key,value from pg_catalog.jsonb_each(data) loop
        perform bx1_portal.require_keys(resource,array['value','sha256','observedAt']);
        if pg_catalog.jsonb_typeof(resource->'value') is distinct from 'object'
          or pg_catalog.jsonb_typeof(resource->'sha256') is distinct from 'string'
          or resource->>'sha256' !~ '^[0-9a-f]{64}$'
          or pg_catalog.jsonb_typeof(resource->'observedAt') is distinct from 'number'
          or resource->>'observedAt' !~ '^[1-9][0-9]{9,15}$'
          or (resource->>'observedAt')::numeric>extract(epoch from at)*1000+5000
          or pg_catalog.octet_length((resource->'value')::text)>1048576 then
          raise exception 'offering_signature_complete_resource_invalid' using errcode='22023'; end if;
      end loop;
      if data->'envelope'->'value'->>'envelopeId' is distinct from envelope::text
        or data->'envelope'->'value'->>'status' is distinct from 'completed'
        or pg_catalog.jsonb_typeof(data->'audit_events'->'value'->'auditEvents') is distinct from 'array'
        or pg_catalog.jsonb_array_length(data->'audit_events'->'value'->'auditEvents')<1
        or pg_catalog.jsonb_array_length(data->'recipients'->'value'->'signers') is distinct from 1
        or data->'recipients'->'value'->'signers'->0->>'clientUserId' is distinct from a.signer_id::text
        or pg_catalog.jsonb_typeof(data->'documents'->'value'->'envelopeDocuments') is distinct from 'array'
        or pg_catalog.jsonb_array_length(data->'documents'->'value'->'envelopeDocuments') not between 4 and 5 then
        raise exception 'offering_signature_complete_envelope_mismatch' using errcode='23514'; end if;
    end if;
    update bx1_private.offering_signature_operations set envelope_id=coalesce(envelope_id,envelope),
      state=case p_result->>'status' when 'COMPLETED' then 'COMPLETION_OBSERVED' when 'DECLINED' then 'DECLINED'
        when 'VOIDED' then 'VOIDED' when 'SENT' then 'SENT' else 'UNKNOWN_RECONCILIATION' end,
      next_action=case p_result->>'status' when 'COMPLETED' then 'RETAIN' when 'DECLINED' then 'NONE' when 'VOIDED' then 'NONE'
        else case when not is_current and envelope is not null then 'VOID' else 'RECONCILE' end end,
      noncurrent_reason=case when p_result->>'status'='COMPLETED' and p_result->'integrity_verified' is distinct from 'true'::jsonb
        then 'PROVIDER_INTEGRITY_UNPROVED' else noncurrent_reason end,
      next_check_at=case when p_result->>'status'='COMPLETED' then at else scheduled end,lease_expires_at=at where id=o.id;
  elsif p_action in ('ARTIFACT_RESERVED','ARTIFACT_RETAINED') then
    if t.action not in ('PREPARE','RETAIN') or (t.action='PREPARE' and (not is_current or o.state<>'PREPARED'))
      or (t.action='RETAIN' and o.state<>'COMPLETION_OBSERVED') then
      raise exception 'offering_signature_artifact_predecessor' using errcode='23514'; end if;
    perform bx1_portal.require_keys(p_result,case when p_action='ARTIFACT_RESERVED' then array['kind','sha256','size'] else array['artifact_id','sha256','size'] end);
    if p_result->>'sha256' !~ '^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(p_result->'size') is distinct from 'number'
      or p_result->>'size' !~ '^[1-9][0-9]{0,6}$' or (p_result->>'size')::integer>4194304 then
      raise exception 'offering_signature_artifact_invalid' using errcode='22023'; end if;
    if p_action='ARTIFACT_RESERVED' then
      if t.action='RETAIN' and not exists(select 1 from bx1_private.offering_signature_observations obs where obs.attempt_id=t.request_id
        and obs.action='ARTIFACT_RESERVED' and obs.result->>'phase'='INFLIGHT' and obs.result->>'kind'=p_result->>'kind') then
        raise exception 'offering_signature_http_checkpoint_required' using errcode='23514'; end if;
      if (t.action='PREPARE' and p_result->>'kind' is distinct from 'COVER_ORIGINAL')
        or (t.action='RETAIN' and p_result->>'kind' not in ('MEMORANDUM_SIGNED','RISKS_SIGNED','SUBSCRIPTION_TERMS_SIGNED','COVER_SIGNED','CERTIFICATE'))
        or (p_result->>'kind'='COVER_ORIGINAL' and (p_result->>'size')::integer>262144) then
        raise exception 'offering_signature_artifact_kind_denied' using errcode='22023'; end if;
      select * into ar from bx1_private.offering_signature_artifacts where operation_id=o.id and kind=p_result->>'kind' and state='RESERVED';
      if ar.id is not null and (ar.sha256 is distinct from p_result->>'sha256' or ar.size<>(p_result->>'size')::integer) then
        raise exception 'offering_signature_artifact_conflict' using errcode='23505'; end if;
      artifact:=coalesce(ar.id,pg_catalog.gen_random_uuid());
    else
      select * into ar from bx1_private.offering_signature_artifacts where id=(p_result->>'artifact_id')::uuid and operation_id=o.id and state='RESERVED';
      if ar.id is null or ar.sha256 is distinct from p_result->>'sha256' or ar.size<>(p_result->>'size')::integer then
        raise exception 'offering_signature_artifact_mismatch' using errcode='23514'; end if;
      artifact:=ar.id;
    end if;
  elsif p_action='SIGNING_VIEW_RESULT' then
    perform bx1_portal.require_keys(p_result,array['outcome','url_sha256','expires_at']||
      case when p_result->>'outcome'='UNKNOWN' and p_result ? 'next_check_at' then array['next_check_at'] else array[]::text[] end);
    if t.action<>'VIEW' or o.state<>'SENT' or p_result->>'outcome' not in ('CREATED','UNKNOWN') then
      raise exception 'offering_signature_view_result_denied' using errcode='23514'; end if;
    if not exists(select 1 from bx1_private.offering_signature_observations obs where obs.attempt_id=t.request_id
      and obs.action=p_action and obs.result->>'phase'='INFLIGHT') then
      raise exception 'offering_signature_http_checkpoint_required' using errcode='23514'; end if;
    if p_result->>'outcome'='CREATED' then
      perform bx1_private.read_offering_signature_action(p_worker,o.id,p_lease,p_generation);
      if p_result->>'url_sha256' !~ '^[0-9a-f]{64}$' or (p_result->>'expires_at')::timestamptz<=at
        or (p_result->>'expires_at')::timestamptz>at+interval '5 minutes' then
        raise exception 'offering_signature_view_result_invalid' using errcode='22023'; end if;
    elsif p_result->'url_sha256'<>'null'::jsonb or p_result->'expires_at'<>'null'::jsonb then
      raise exception 'offering_signature_view_result_invalid' using errcode='22023'; end if;
    if p_result ? 'next_check_at' and (not pg_catalog.isfinite((p_result->>'next_check_at')::timestamptz)
      or (p_result->>'next_check_at')::timestamptz<=at) then
      raise exception 'offering_signature_view_schedule_invalid' using errcode='22023'; end if;
    update bx1_private.offering_signature_operations set next_action='RECONCILE',lease_expires_at=at where id=o.id;
  elsif p_action='EVIDENCE_FINALIZED' then
    perform bx1_portal.require_keys(p_result,array['integrity_verified','evidence_sha256']);
    if t.action<>'RETAIN' or o.state<>'COMPLETION_OBSERVED' or p_result->'integrity_verified' is distinct from 'true'::jsonb
      or p_result->>'evidence_sha256' !~ '^[0-9a-f]{64}$'
      or (select count(*) from bx1_private.offering_signature_artifacts where operation_id=o.id and state='RETAINED')<>6
      or not exists(select 1 from bx1_private.offering_signature_observations where operation_id=o.id and action in ('RECONCILE_RESULT','VOID_RESULT')
        and result->>'status'='COMPLETED' and result->'integrity_verified'='true'::jsonb
        and result->>'evidence_sha256'=p_result->>'evidence_sha256' and result ? 'evidence_json') then
      raise exception 'offering_signature_evidence_incomplete' using errcode='23514'; end if;
    update bx1_private.offering_signature_operations set state='EVIDENCE_RETAINED',next_action='NONE',lease_expires_at=at where id=o.id;
  else
    perform bx1_portal.require_keys(p_result,array['reason','evidence_sha256']||
      case when p_result->>'reason'='PROVIDER_THROTTLED' then array['next_check_at'] else array[]::text[] end);
    if p_result->>'reason' !~ '^[A-Z][A-Z0-9_]{2,119}$' or (p_result->'evidence_sha256'<>'null'::jsonb and p_result->>'evidence_sha256' !~ '^[0-9a-f]{64}$') then
      raise exception 'offering_signature_recovery_invalid' using errcode='22023'; end if;
    scheduled:=case when p_result->>'reason'='PROVIDER_THROTTLED' then (p_result->>'next_check_at')::timestamptz else o.next_check_at end;
    if p_result->>'reason'='PROVIDER_THROTTLED' and (scheduled is null or not pg_catalog.isfinite(scheduled)) then
      raise exception 'offering_signature_schedule_invalid' using errcode='22023'; end if;
    update bx1_private.offering_signature_operations set state='RECOVERY_REQUIRED',next_action='NONE',
      noncurrent_reason=coalesce(noncurrent_reason,p_result->>'reason'),lease_expires_at=at,
      next_check_at=greatest(scheduled,o.next_check_at,at+interval '900 seconds') where id=o.id;
  end if;
  insert into bx1_private.offering_signature_observations(id,request_id,operation_id,attempt_id,action,result,result_sha256,current_at_observation)
    values(observation,p_request,o.id,t.request_id,p_action,p_result,digest,is_current);
  if p_action='ARTIFACT_RESERVED' and not checkpoint and ar.id is null then
    insert into bx1_private.offering_signature_artifacts(id,operation_id,kind,provider_document_id,state,path,sha256,size,observation_id)
      values(artifact,o.id,p_result->>'kind',case p_result->>'kind' when 'MEMORANDUM_SIGNED' then '1' when 'RISKS_SIGNED' then '2'
        when 'SUBSCRIPTION_TERMS_SIGNED' then '3' when 'CERTIFICATE' then 'certificate' else '4' end,'RESERVED',
        pg_catalog.lower(o.environment)||'/'||a.revision_id::text||'/'||o.id::text||'/'||artifact::text||'.pdf',
        p_result->>'sha256',(p_result->>'size')::integer,observation);
  elsif p_action='ARTIFACT_RETAINED' and not exists(select 1 from bx1_private.offering_signature_artifacts where reservation_id=ar.id) then
    insert into bx1_private.offering_signature_artifacts(reservation_id,operation_id,kind,provider_document_id,state,path,sha256,size,observation_id)
      values(ar.id,ar.operation_id,ar.kind,ar.provider_document_id,'RETAINED',ar.path,ar.sha256,ar.size,observation);
  end if;
  if not is_current then update bx1_private.offering_signature_operations set noncurrent_reason=coalesce(noncurrent_reason,'AUTHORITY_CHANGED') where id=o.id; end if;
  select * into o from bx1_private.offering_signature_operations where id=o.id;
  return pg_catalog.jsonb_build_object('operation_id',o.id,'state',o.state,'next_action',o.next_action,'next_check_at',o.next_check_at,
    'artifact_id',artifact,'current',bx1_private.offering_signature_evidence_current(o.id),'can_perform',checkpoint);
end $$;

create function bx1_private.offering_signature_require_decision(p_revision uuid,p_actor uuid,p_kind text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare person uuid; eligible uuid;
begin
  perform bx1_private.lock_offering_document_revision(p_revision);
  person:=bx1_private.document_governance_trusted_person(p_actor,null);
  if person is null or p_kind not in ('ISSUER','COMPLIANCE') then
    raise exception 'offering_signature_decision_person_denied' using errcode='42501'; end if;
  select o.id into eligible from bx1_private.offering_signature_operations o
    join bx1_private.offering_signature_authorisations a on a.id=o.authorisation_id
    where a.revision_id=p_revision and bx1_private.offering_signature_evidence_current(o.id)
      and ((p_kind='ISSUER' and a.signer_id=p_actor and a.signer_person_id=person)
        or (p_kind='COMPLIANCE' and person not in (a.signer_person_id,a.requester_person_id)
          and exists(select 1 from bx1_private.offering_signature_decision_bindings b
            join bx1_portal.offering_decisions d on d.id=b.decision_id
            where b.operation_id=o.id and b.decision_kind='ISSUER' and d.decision='APPROVED' and d.offering_revision_id=p_revision)))
    order by o.created_at desc,o.id limit 1 for update of o;
  if eligible is null then raise exception 'offering_signature_current_evidence_required' using errcode='23514'; end if;
end $$;

create function bx1_private.offering_signature_bind_decision() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_private.offering_signature_operations; a bx1_private.offering_signature_authorisations; evidence uuid; person uuid;
begin
  if NEW.decision<>'APPROVED' or not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=NEW.offering_revision_id) then
    return NEW; end if;
  perform bx1_private.offering_signature_require_decision(NEW.offering_revision_id,NEW.actor_id,NEW.decision_kind);
  person:=bx1_private.document_governance_trusted_person(NEW.actor_id,null);
  select op.* into o from bx1_private.offering_signature_operations op
    join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id
    where au.revision_id=NEW.offering_revision_id and bx1_private.offering_signature_evidence_current(op.id)
      and ((NEW.decision_kind='ISSUER' and au.signer_id=NEW.actor_id and au.signer_person_id=person)
        or (NEW.decision_kind='COMPLIANCE' and person not in (au.signer_person_id,au.requester_person_id)
          and exists(select 1 from bx1_private.offering_signature_decision_bindings b
            join bx1_portal.offering_decisions d on d.id=b.decision_id
            where b.operation_id=op.id and b.decision_kind='ISSUER' and d.decision='APPROVED'
              and d.offering_revision_id=NEW.offering_revision_id)))
    order by op.created_at desc,op.id limit 1 for update of op;
  select * into a from bx1_private.offering_signature_authorisations where id=o.authorisation_id;
  select id into evidence from bx1_private.offering_signature_observations where operation_id=o.id and action='EVIDENCE_FINALIZED'
    and current_at_observation and result->'integrity_verified'='true'::jsonb order by created_at desc,id limit 1;
  if evidence is null then raise exception 'offering_signature_decision_binding_missing' using errcode='23514'; end if;
  insert into bx1_private.offering_signature_decision_bindings(decision_id,authorisation_id,approval_event_id,operation_id,
    observation_id,manifest_id,manifest_hash,decision_kind)
    values(NEW.id,a.id,o.approval_event_id,o.id,evidence,a.manifest_id,a.manifest_hash,NEW.decision_kind);
  return NEW;
end $$;

create function bx1_private.offering_signature_guard_operation() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if TG_TABLE_NAME='offering_signature_policy' then
    if TG_OP='DELETE' or NEW.singleton is distinct from OLD.singleton or NEW.environment is distinct from OLD.environment
      or NEW.purpose is distinct from OLD.purpose or NEW.authority_epoch<>OLD.authority_epoch+1 then
      raise exception 'offering_signature_policy_epoch_invalid' using errcode='23514'; end if;
    return NEW;
  end if;
  if TG_OP='DELETE' then raise exception 'offering_signature_operation_permanent' using errcode='42501'; end if;
  if (pg_catalog.to_jsonb(NEW)-array['create_request','create_request_text','create_request_sha256','envelope_id','state','generation','lease_id',
    'lease_expires_at','worker_id','next_action','next_check_at','originating_actor_id','originating_session_id','originating_context',
    'originating_request_id','noncurrent_reason']) is distinct from
    (pg_catalog.to_jsonb(OLD)-array['create_request','create_request_text','create_request_sha256','envelope_id','state','generation','lease_id',
    'lease_expires_at','worker_id','next_action','next_check_at','originating_actor_id','originating_session_id','originating_context',
    'originating_request_id','noncurrent_reason'])
    or (OLD.create_request is not null and (NEW.create_request is distinct from OLD.create_request
      or NEW.create_request_text is distinct from OLD.create_request_text or NEW.create_request_sha256 is distinct from OLD.create_request_sha256))
    or (OLD.envelope_id is not null and NEW.envelope_id is distinct from OLD.envelope_id)
    or NEW.generation<OLD.generation or NEW.generation>OLD.generation+1
    or (NEW.state<>OLD.state and not(case OLD.state
      when 'PREPARED' then NEW.state in ('CREATE_INFLIGHT','RECOVERY_REQUIRED','SUPERSEDED')
      when 'CREATE_INFLIGHT' then NEW.state in ('SENT','UNKNOWN_RECONCILIATION','RECOVERY_REQUIRED')
      when 'SENT' then NEW.state in ('UNKNOWN_RECONCILIATION','COMPLETION_OBSERVED','DECLINED','VOIDED','RECOVERY_REQUIRED')
      when 'UNKNOWN_RECONCILIATION' then NEW.state in ('SENT','COMPLETION_OBSERVED','DECLINED','VOIDED','RECOVERY_REQUIRED')
      when 'COMPLETION_OBSERVED' then NEW.state in ('EVIDENCE_RETAINED','RECOVERY_REQUIRED')
      when 'RECOVERY_REQUIRED' then NEW.state in ('SENT','UNKNOWN_RECONCILIATION','COMPLETION_OBSERVED','DECLINED','VOIDED')
        or (NEW.state='PREPARED' and OLD.create_request is null and OLD.envelope_id is null
          and NEW.create_request is null and NEW.envelope_id is null)
      else false end)) then raise exception 'offering_signature_operation_transition_denied' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger offering_signature_operation_guard before update or delete on bx1_private.offering_signature_operations
  for each row execute function bx1_private.offering_signature_guard_operation();
create trigger offering_signature_policy_guard before update or delete on bx1_private.offering_signature_policy
  for each row execute function bx1_private.offering_signature_guard_operation();
create trigger offering_signature_decision_binding after insert on bx1_portal.offering_decisions
  for each row execute function bx1_private.offering_signature_bind_decision();

do $signature_privileges$
declare name text; function_oid oid; grant_role text;
begin
  foreach name in array array[
    'bx1_private.offering_signature_admitted()','bx1_private.offering_signature_lock_context(uuid,uuid,text,jsonb,uuid,jsonb)',
    'bx1_private.offering_signature_authorisation_current(uuid)','bx1_private.offering_signature_evidence_current(uuid)',
    'bx1_private.offering_signature_decisions_current(uuid,uuid,uuid)','bx1_private.offering_signature_snapshot(jsonb,uuid)',
    'bx1_private.offering_signature_require_decision(uuid,uuid,text)','bx1_private.offering_signature_bind_decision()',
    'bx1_private.offering_signature_guard_operation()','bx1_private.read_offering_signatures(uuid,uuid,text,jsonb,uuid,jsonb)',
    'bx1_private.execute_offering_signature_command(uuid,uuid,text,jsonb,text,uuid,jsonb,jsonb)',
    'bx1_private.claim_offering_signature_action(text,uuid)','bx1_private.read_offering_signature_action(text,uuid,uuid,bigint)',
    'bx1_private.record_offering_signature_action(text,uuid,uuid,bigint,uuid,text,jsonb)'] loop
    function_oid:=pg_catalog.to_regprocedure(name);
    execute pg_catalog.format('alter function %s owner to postgres',name);
    -- Clear any ambient default ACL rather than assuming it is PUBLIC alone.
    for grant_role in select distinct case when x.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(r.rolname) end
      from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x
      left join pg_catalog.pg_roles r on r.oid=x.grantee where p.oid=function_oid and x.grantee<>p.proowner loop
      execute pg_catalog.format('revoke all on function %s from %s',name,grant_role);
    end loop;
  end loop;
  if exists(select 1 from bx1_private.offering_signature_policy where singleton and environment='TESTNET') then
    grant execute on function bx1_private.read_offering_signatures(uuid,uuid,text,jsonb,uuid,jsonb),
      bx1_private.execute_offering_signature_command(uuid,uuid,text,jsonb,text,uuid,jsonb,jsonb) to bx1_document_receipt_writer;
  end if;
  grant execute on function bx1_private.claim_offering_signature_action(text,uuid),
    bx1_private.read_offering_signature_action(text,uuid,uuid,bigint),
    bx1_private.record_offering_signature_action(text,uuid,uuid,bigint,uuid,text,jsonb) to bx1_offering_signature_worker;
end $signature_privileges$;

-- Exactly five pinned body-only cutovers. Seven literal occurrences total.
-- OIDs and every pg_proc field except prosrc must remain byte-identical.
do $signature_cutover$
declare spec jsonb; change jsonb; target oid; before_row jsonb; after_row jsonb;
  source_body text; next_body text; definition text; needle text; occurrences integer; actual text;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($signature_recipes$
[
  {
    "signature": "bx1_portal.offering_approved(uuid)",
    "source_hash": "921c8ce94823f9bca58549db1a85500c3239c3b6ffc340e37bc25acb442ba7bc",
    "result_hash": "ab18307440fc29e6554dad3fc8051a394b10a6c15e1bcd823529094012c67d06",
    "changes": [
      {
        "from": "where p.id=target_product and issuer.actor_id<>compliance.actor_id",
        "to": "where p.id=target_product and issuer.actor_id<>compliance.actor_id\n      and (not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n        or bx1_private.offering_signature_decisions_current(r.id,issuer.id,compliance.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.lock_offering_product_before_decision()",
    "source_hash": "506497010034c90796c5228a00c1a37babdf184cb05ae0752e7de8c9e2ffd6f6",
    "result_hash": "1a944a5f4fe244878ffa4162e4e1d4e8cb4c97a52e9503fbb243baf1364bac08",
    "changes": [
      {
        "from": "    raise exception 'offering_document_signature_not_connected' using errcode='23514'; end if;",
        "to": "    perform bx1_private.offering_signature_require_decision(NEW.offering_revision_id,NEW.actor_id,NEW.decision_kind); end if;",
        "count": 1
      },
      {
        "from": "  if NEW.decision='APPROVED' and (exists",
        "to": "  if NEW.decision='APPROVED' and not exists(select 1 from bx1_private.offering_document_profiles\n    where offering_revision_id=NEW.offering_revision_id) and (exists",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.offering_workflow_approved(uuid)",
    "source_hash": "50a4d79c984776a856998dcce59024cfd50e4486bc86820d3d91772ceea206b6",
    "result_hash": "802961d325a697660c74c362a60c42ea9af1b4865ce857f753964dd321e790a3",
    "changes": [
      {
        "from": "where p.id=target_product and issuer.actor_id<>compliance.actor_id",
        "to": "where p.id=target_product and issuer.actor_id<>compliance.actor_id\n      and (not exists(select 1 from bx1_private.offering_document_profiles where offering_revision_id=r.id)\n        or bx1_private.offering_signature_decisions_current(r.id,issuer.id,compliance.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_document_evidence_summary(uuid)",
    "source_hash": "6be2329527648f4632db28161a37e29f76757c3528a6c6d8da4a9a66ee509049",
    "result_hash": "9194ea2429f9ed0ef9d177fef923e284f31406727f6908833c4b6c63e9cd26f1",
    "changes": [
      {
        "from": "'manifest_hash',m.hash,'signature_status','NOT_CONNECTED','approval_allowed',false",
        "to": "'manifest_hash',m.hash,'version',2,'signature_status',case\n      when bx1_private.offering_signature_admitted() is not true then 'NOT_ADMITTED'\n      when exists(select 1 from bx1_private.offering_signature_operations op join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n        where au.revision_id=target_revision and bx1_private.offering_signature_evidence_current(op.id)) then 'EVIDENCE_RETAINED'\n      when exists(select 1 from bx1_private.offering_signature_operations op join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n        where au.revision_id=target_revision and op.state='RECOVERY_REQUIRED') then 'RECOVERY_REQUIRED'\n      when exists(select 1 from bx1_private.offering_signature_operations op join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n        where au.revision_id=target_revision and (op.noncurrent_reason is not null or not bx1_private.offering_signature_authorisation_current(au.id))) then 'NON_CURRENT'\n      when exists(select 1 from bx1_private.offering_signature_operations op join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n        where au.revision_id=target_revision) then 'PENDING'\n      when exists(select 1 from bx1_private.offering_signature_authorisations au where au.revision_id=target_revision\n        and bx1_private.offering_signature_authorisation_current(au.id)) then 'SIGNATURE_REQUIRED' else 'PURPOSE_REQUIRED' end,\n    'approval_allowed',exists(select 1 from bx1_private.offering_signature_operations op\n      join bx1_private.offering_signature_authorisations au on au.id=op.authorisation_id\n      where au.revision_id=target_revision and bx1_private.offering_signature_evidence_current(op.id))",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_private.offering_document_snapshot(jsonb,uuid)",
    "source_hash": "837a4b94faf4c138c19e9514eb54b3ff4c62544f28f67ccf794eae45ad10a9ba",
    "result_hash": "4e69580d4abd894c68c0cc0a9da0452af92264b2c0630d1f84ef0c63f825fe9e",
    "changes": [
      {
        "from": "'document_access',pg_catalog.jsonb_build_object('version',1,",
        "to": "'document_access',pg_catalog.jsonb_build_object('version',2,",
        "count": 1
      },
      {
        "from": "'approval_allowed',false,'approval_blocker',case when q.offering_revision_id is null then null else 'signature-not-connected' end",
        "to": "'signature_status',coalesce(bx1_private.offering_document_evidence_summary(target_revision)->>'signature_status','NOT_ADMITTED'),\n      'approval_allowed',coalesce((bx1_private.offering_document_evidence_summary(target_revision)->>'approval_allowed')::boolean,false),\n      'approval_blocker',case when q.offering_revision_id is null\n        or (bx1_private.offering_document_evidence_summary(target_revision)->>'approval_allowed')::boolean then null\n        when bx1_private.offering_signature_admitted() is not true then 'signature-not-admitted'\n        when bx1_private.offering_document_evidence_summary(target_revision)->>'signature_status'='NON_CURRENT' then 'signature-noncurrent'\n        else 'signature-required' end",
        "count": 1
      }
    ]
  }
]
$signature_recipes$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    select pg_catalog.to_jsonb(p),p.prosrc into before_row,source_body from pg_catalog.pg_proc p where p.oid=target;
    actual:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex');
    if actual is distinct from spec->>'source_hash' then raise exception 'offering_signature_cutover_source_changed' using errcode='55000'; end if;
    next_body:=source_body;
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      needle:=change->>'from';
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,needle,'')))/pg_catalog.length(needle);
      if occurrences<>(change->>'count')::integer then raise exception 'offering_signature_literal_cutpoint_changed' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,needle,change->>'to');
    end loop;
    actual:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(next_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex');
    if actual is distinct from spec->>'result_hash' then raise exception 'offering_signature_derived_body_changed' using errcode='55000'; end if;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))/pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'offering_signature_definition_ambiguous' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if (before_row-'prosrc') is distinct from (after_row-'prosrc') or after_row->>'prosrc' is distinct from next_body then
      raise exception 'offering_signature_existing_metadata_changed' using errcode='55000'; end if;
  end loop;
end $signature_cutover$;

