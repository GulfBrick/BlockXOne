-- Stage 2 TEST-only customer representative handoff. Approval of a customer
-- organisation is not a native role grant. No identities, roles, customer
-- organisations or bindings are seeded by this migration.
-- Apply after bx1_entry.sql, bx1_entry_admission.sql,
-- bx1_application_admission.sql and the effective scoped reader/writer.
-- MAIN receives definitions but its manual-review seal makes every new command
-- unavailable; existing login and historical legacy records remain intact.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.entry_command(text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_read()') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_manual_review_enabled()') is null
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null
    then raise exception 'customer_mandate_admission_baseline_required' using errcode='55000'; end if;
end $$;

create table bx1_portal.representative_mandates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  application_id uuid not null unique references bx1_portal.applications(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  product_organisation_id uuid not null unique references bx1_portal.organisations(id) on delete restrict,
  reviewer_scope_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  admission_revision integer not null check(admission_revision>0),
  role text not null default 'OfferingManager' check(role='OfferingManager'),
  revision integer not null default 1 check(revision>0),
  status text not null default 'SUBMITTED' check(status in
    ('SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','APPLIED','REVOKED')),
  evidence_reference text not null check(char_length(evidence_reference) between 20 and 400 and evidence_reference=btrim(evidence_reference)),
  requested_until timestamptz not null check(isfinite(requested_until)),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewer_user_id uuid references auth.users(id) on delete restrict,
  review_notes text,
  review_checks jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(review_checks)='object'),
  approval_receipt_id uuid unique,
  applied_at timestamptz,
  applied_by_user_id uuid references auth.users(id) on delete restrict,
  native_organisation_id uuid unique references public.bx1_organisations(id) on delete restrict,
  native_membership_id uuid unique references public.bx1_memberships(id) on delete restrict,
  authority_binding_id uuid unique references bx1_portal.organisation_authority_bindings(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revoke_reason text,
  provider_mode text not null default 'MANUAL_TEST_REVIEW' check(provider_mode='MANUAL_TEST_REVIEW'),
  created_at timestamptz not null default clock_timestamp(),
  check(reviewer_user_id is null or reviewer_user_id<>applicant_user_id),
  check(applied_by_user_id is null or applied_by_user_id<>applicant_user_id),
  check(applied_by_user_id is null or applied_by_user_id<>reviewer_user_id),
  check(status not in ('APPROVED','APPLIED','REVOKED') or (reviewer_user_id is not null and approval_receipt_id is not null)),
  check(status not in ('APPLIED','REVOKED') or
    (applied_at is not null and applied_by_user_id is not null and native_organisation_id is not null
      and native_membership_id is not null and authority_binding_id is not null)),
  check((status='REVOKED')=(revoked_at is not null))
);
create index bx1_mandate_review_queue on bx1_portal.representative_mandates
  (reviewer_scope_organisation_id,status,submitted_at,id);
create index bx1_mandate_applicant on bx1_portal.representative_mandates(applicant_user_id,submitted_at,id);

create table bx1_portal.representative_mandate_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  mandate_id uuid not null references bx1_portal.representative_mandates(id) on delete restrict,
  mandate_revision integer not null check(mandate_revision>0),
  action text not null check(action in
    ('request_representative_mandate','review_representative_mandate',
     'apply_representative_mandate','revoke_representative_mandate')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  command_payload jsonb not null check(pg_catalog.jsonb_typeof(command_payload)='object'),
  admission_revision integer not null check(admission_revision>0),
  status_after text not null check(status_after in
    ('SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','APPLIED','REVOKED')),
  native_organisation_id uuid,
  native_membership_id uuid,
  authority_binding_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(mandate_id,mandate_revision)
);
alter table bx1_portal.representative_mandates add constraint bx1_mandate_approval_receipt
  foreign key(approval_receipt_id) references bx1_portal.representative_mandate_receipts(id) on delete restrict;

create table bx1_portal.representative_mandate_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  command text not null check(command in
    ('request_representative_mandate','review_representative_mandate',
     'apply_representative_mandate','revoke_representative_mandate')),
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  payload jsonb not null check(pg_catalog.jsonb_typeof(payload)='object'),
  mandate_id uuid not null references bx1_portal.representative_mandates(id) on delete restrict,
  receipt_id uuid not null references bx1_portal.representative_mandate_receipts(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_key)
);
alter table bx1_portal.representative_mandates enable row level security;
alter table bx1_portal.representative_mandate_receipts enable row level security;
alter table bx1_portal.representative_mandate_requests enable row level security;
revoke all on bx1_portal.representative_mandates,bx1_portal.representative_mandate_receipts,
  bx1_portal.representative_mandate_requests from public,anon,authenticated,service_role;
create trigger bx1_mandate_receipt_immutable before update or delete on bx1_portal.representative_mandate_receipts
  for each row execute function bx1_portal.immutable_record();
create trigger bx1_mandate_request_immutable before update or delete on bx1_portal.representative_mandate_requests
  for each row execute function bx1_portal.immutable_record();

create function bx1_portal.guard_representative_mandate() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'mandate_history_immutable' using errcode='23514'; end if;
  if row(NEW.id,NEW.application_id,NEW.applicant_user_id,NEW.product_organisation_id,
      NEW.reviewer_scope_organisation_id,NEW.admission_revision,NEW.role,NEW.created_at)
     is distinct from row(OLD.id,OLD.application_id,OLD.applicant_user_id,OLD.product_organisation_id,
      OLD.reviewer_scope_organisation_id,OLD.admission_revision,OLD.role,OLD.created_at)
    or NEW.revision<>OLD.revision+1
    or not ((OLD.status='SUBMITTED' and NEW.status in ('APPROVED','CHANGES_REQUIRED','REJECTED'))
      or (OLD.status in ('CHANGES_REQUIRED','REJECTED') and NEW.status='SUBMITTED')
      or (OLD.status='APPROVED' and OLD.requested_until<=clock_timestamp() and NEW.status='SUBMITTED')
      or (OLD.status='APPROVED' and NEW.status='APPLIED')
      or (OLD.status='APPLIED' and NEW.status='REVOKED')) then
    raise exception 'mandate_invalid_transition' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_representative_mandate_guard before update or delete on bx1_portal.representative_mandates
  for each row execute function bx1_portal.guard_representative_mandate();

-- The effective authority predicate is not a native membership test. Every
-- customer mandate is bound to its exact reviewed admission, reviewer scope,
-- native membership, portal binding and expiry. Expiry requires no scheduler.
create function bx1_portal.representative_mandate_effective(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.representative_mandates m
    join bx1_portal.applications a on a.id=m.application_id and a.user_id=m.applicant_user_id
    join bx1_portal.organisations po on po.id=m.product_organisation_id and po.application_id=a.id
    join public.bx1_organisations no on no.id=m.native_organisation_id
    join public.bx1_profiles p on p.id=m.applicant_user_id
    join public.bx1_memberships nm on nm.id=m.native_membership_id
    join bx1_portal.organisation_authority_bindings b on b.id=m.authority_binding_id
    join bx1_portal.entry_configuration cfg on cfg.singleton
    join public.bx1_organisations reviewer_org on reviewer_org.id=m.reviewer_scope_organisation_id
    where m.id=target_mandate and m.status='APPLIED' and m.role='OfferingManager'
      and m.requested_until>clock_timestamp() and a.approved_until>clock_timestamp()
      and a.status='APPROVED' and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and a.revision=m.admission_revision and a.persona='WEALTH_MANAGER'
      and a.provider_mode='MANUAL_TEST_REVIEW' and a.details->'details_version'='2'::jsonb
      and a.reviewer_scope=m.reviewer_scope_organisation_id
      and po.owner_id=m.applicant_user_id and po.reviewer_scope=m.reviewer_scope_organisation_id
      and po.status='ACTIVE' and no.status='ACTIVE' and reviewer_org.status='ACTIVE' and p.status='ACTIVE'
      and nm.user_id=m.applicant_user_id and nm.organisation_id=no.id
      and nm.role='OfferingManager' and nm.status='ACTIVE'
      and b.product_organisation_id=po.id and b.native_organisation_id=no.id
      and b.role='OfferingManager' and b.status='ACTIVE'
      and b.approval_receipt_id=m.approval_receipt_id
      and b.valid_from<=clock_timestamp() and b.valid_until=m.requested_until
      and b.valid_until>clock_timestamp()
      and cfg.environment='TESTNET' and cfg.manual_test_review
      and cfg.reviewer_scope=m.reviewer_scope_organisation_id);
$$;

create function bx1_portal.representative_mandate_requestable(target_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.applications a
    join bx1_portal.organisations o on o.id=a.organisation_id and o.application_id=a.id
    join bx1_portal.entry_configuration cfg on cfg.singleton
    where a.id=target_application and a.user_id=auth.uid()
      and a.persona='WEALTH_MANAGER' and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and a.status='APPROVED' and a.approved_until>clock_timestamp()
      and a.details->'details_version'='2'::jsonb and a.provider_mode='MANUAL_TEST_REVIEW'
      and a.reviewer_scope=o.reviewer_scope and o.owner_id=a.user_id and o.status='ACTIVE'
      and cfg.environment='TESTNET' and cfg.manual_test_review and cfg.reviewer_scope=a.reviewer_scope
      and not exists(select 1 from bx1_portal.organisation_authority_bindings b
        where b.product_organisation_id=o.id)
      and not exists(select 1 from bx1_portal.representative_mandates m
        where m.application_id=a.id));
$$;

-- Existing historical rehearsal may continue through its original provenance.
-- New customer admission never restores the old applicant-owner product path.
create or replace function bx1_portal.scoped_operator(c jsonb,target_org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications;
begin
  if bx1_portal.valid_operating_context(c) is not true or not bx1_portal.current_product_organisation(target_org) then return false; end if;
  select source.* into a from bx1_portal.organisations o join bx1_portal.applications source on source.id=o.application_id
    where o.id=target_org;
  if a.id is null then return false; end if;
  if c->>'mode'='APPLICANT' then
    return a.admission_purpose='LEGACY_REHEARSAL'
      and exists(select 1 from bx1_portal.organisations o where o.id=target_org and o.owner_id=auth.uid())
      and not exists(select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=target_org);
  end if;
  if c->>'mode'<>'ROLE' or c->>'role' not in ('OfferingManager','IssuerFundManager') then return false; end if;
  if a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION' then
    return c->>'role'='OfferingManager' and exists(select 1 from bx1_portal.representative_mandates m
      where m.application_id=a.id and m.product_organisation_id=target_org
        and m.native_organisation_id=(c->>'organisationId')::uuid
        and m.applicant_user_id=auth.uid() and bx1_portal.representative_mandate_effective(m.id));
  end if;
  return exists(select 1 from bx1_portal.organisation_authority_bindings b
    where b.product_organisation_id=target_org and b.native_organisation_id=(c->>'organisationId')::uuid
      and b.role=c->>'role' and b.status='ACTIVE'
      and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
end $$;

create function bx1_portal.representative_mandate_admission_current(target_mandate uuid,
  require_unbound boolean default true,require_requested_until boolean default true)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.representative_mandates m
    join bx1_portal.applications a on a.id=m.application_id and a.user_id=m.applicant_user_id
    join bx1_portal.organisations o on o.id=m.product_organisation_id and o.application_id=a.id
    join bx1_portal.entry_configuration cfg on cfg.singleton
    join public.bx1_organisations review_org on review_org.id=m.reviewer_scope_organisation_id
    where m.id=target_mandate and m.role='OfferingManager'
      and (not require_requested_until or m.requested_until>clock_timestamp())
      and a.status='APPROVED' and a.persona='WEALTH_MANAGER'
      and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and a.provider_mode='MANUAL_TEST_REVIEW' and a.details->'details_version'='2'::jsonb
      and a.revision=m.admission_revision and a.approved_until>clock_timestamp()
      and o.owner_id=m.applicant_user_id and o.status='ACTIVE'
      and o.reviewer_scope=m.reviewer_scope_organisation_id and a.reviewer_scope=o.reviewer_scope
      and cfg.environment='TESTNET' and cfg.manual_test_review
      and cfg.reviewer_scope=m.reviewer_scope_organisation_id and review_org.status='ACTIVE'
      and (not require_unbound or not exists(select 1 from bx1_portal.organisation_authority_bindings b
        where b.product_organisation_id=o.id)));
$$;

create function bx1_portal.representative_mandate_actor(c jsonb,target_scope uuid,actor_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.valid_operating_context(c)
    and c->>'mode'='ROLE' and c->>'role'=actor_role
    and c->>'organisationId'=target_scope::text
    and auth.jwt()->>'aal'='aal2'
    and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
        and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp')
    and exists(select 1 from bx1_portal.entry_configuration cfg
      where cfg.singleton and cfg.environment='TESTNET' and cfg.reviewer_scope=target_scope);
$$;

create function bx1_portal.representative_mandate_projection(c jsonb,target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.representative_mandates; a bx1_portal.applications; o bx1_portal.organisations;
  applicant_visible boolean; reviewer_visible boolean; applier_visible boolean;
  request_allowed boolean; review_allowed boolean; apply_allowed boolean; revoke_allowed boolean;
  next_actor text;
begin
  if bx1_portal.valid_operating_context(c) is not true then return null; end if;
  select * into m from bx1_portal.representative_mandates where id=target_mandate;
  if m.id is null then return null; end if;
  select * into a from bx1_portal.applications where id=m.application_id;
  select * into o from bx1_portal.organisations where id=m.product_organisation_id;
  applicant_visible:=m.applicant_user_id=auth.uid() and c->>'mode'='APPLICANT';
  reviewer_visible:=bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer');
  applier_visible:=bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  if not(applicant_visible or reviewer_visible or applier_visible) then return null; end if;
  request_allowed:=applicant_visible and
    (m.status in ('CHANGES_REQUIRED','REJECTED')
      or (m.status='APPROVED' and m.requested_until<=clock_timestamp()))
    and bx1_portal.representative_mandate_admission_current(m.id,true,false);
  review_allowed:=reviewer_visible and m.status='SUBMITTED'
    and bx1_portal.independent_of(m.applicant_user_id)
    and bx1_portal.representative_mandate_admission_current(m.id,true);
  apply_allowed:=applier_visible and m.status='APPROVED' and m.approval_receipt_id is not null
    and bx1_portal.independent_of(m.applicant_user_id)
    and m.reviewer_user_id is not null and bx1_portal.independent_of(m.reviewer_user_id)
    and bx1_portal.representative_mandate_admission_current(m.id,true);
  revoke_allowed:=(reviewer_visible or applier_visible) and m.status='APPLIED'
    and bx1_portal.independent_of(m.applicant_user_id);
  next_actor:=case
    when request_allowed then 'APPLICANT'
    when review_allowed then 'COMPLIANCE'
    when apply_allowed then 'SUPER_ADMIN'
    else 'NONE' end;
  return pg_catalog.jsonb_build_object(
    'id',m.id,'application_id',m.application_id,'applicant_user_id',m.applicant_user_id,
    'product_organisation_id',m.product_organisation_id,'organisation_name',o.name,
    'reviewer_scope_organisation_id',m.reviewer_scope_organisation_id,
    'native_organisation_id',m.native_organisation_id,'role',m.role,
    'admission_revision',m.admission_revision,'admission_current_revision',a.revision,
    'admission_status',a.status,'admission_purpose',a.admission_purpose,
    'admission_approved_until',a.approved_until,'revision',m.revision,'status',m.status,
    'evidence_reference',m.evidence_reference,'requested_until',m.requested_until,
    'submitted_at',m.submitted_at,'reviewed_at',m.reviewed_at,
    'reviewer_user_id',m.reviewer_user_id,'review_notes',m.review_notes,'review_checks',m.review_checks,
    'approval_receipt_id',m.approval_receipt_id,'applied_at',m.applied_at,
    'applied_by_user_id',m.applied_by_user_id,'revoked_at',m.revoked_at,
    'revoke_reason',m.revoke_reason,'provider_mode',m.provider_mode,
    'effective',bx1_portal.representative_mandate_effective(m.id),
    'next_owner',next_actor,'can_request',request_allowed,'can_review',review_allowed,
    'can_apply',apply_allowed,'can_revoke',revoke_allowed);
end $$;

-- Preserve existing reader OIDs as owner-only implementation details. Public
-- invokers are rebound at the end, so there is one authenticated read route.
alter function bx1_portal.entry_read() rename to entry_read_pre_mandate;
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_mandate;

create function bx1_portal.entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; enriched_apps jsonb; cases jsonb; mandate_requests jsonb;
begin
  result:=bx1_portal.entry_read_pre_mandate();
  select coalesce(pg_catalog.jsonb_agg(app.item||pg_catalog.jsonb_build_object(
    'can_request_mandate',bx1_portal.representative_mandate_requestable((app.item->>'id')::uuid))
    order by app.ordinality),'[]'::jsonb) into enriched_apps
    from pg_catalog.jsonb_array_elements(result->'applications') with ordinality app(item,ordinality);
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.representative_mandate_projection('{"mode":"APPLICANT"}'::jsonb,m.id)
    order by m.submitted_at,m.id),'[]'::jsonb) into cases
    from bx1_portal.representative_mandates m where m.applicant_user_id=auth.uid();
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'key',r.request_key,'command',r.command,'application_id',m.application_id)
    order by r.created_at desc,r.request_key),'[]'::jsonb) into mandate_requests
    from (select * from bx1_portal.representative_mandate_requests
      where actor_id=auth.uid() and command='request_representative_mandate'
        and created_at>=clock_timestamp()-interval '7 days'
      order by created_at desc,request_key limit 1000) r
    join bx1_portal.representative_mandates m on m.id=r.mandate_id;
  if bx1_portal.fresh_session() is not true then raise exception 'mandate_entry_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(result,'{applications}',enriched_apps),
    '{organisation_mandates}',cases),'{requests}',coalesce(result->'requests','[]'::jsonb)||mandate_requests);
end $$;

create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; cases jsonb; mandate_requests jsonb; queue_available boolean; queue_reason text;
begin
  result:=bx1_portal.read_scoped_pre_mandate(c);
  queue_available:=c->>'mode'='ROLE' and c->>'role' in ('ComplianceOfficer','SuperAdmin')
    and bx1_portal.representative_mandate_actor(c,(c->>'organisationId')::uuid,c->>'role');
  queue_reason:=case
    when c->>'mode'<>'ROLE' or c->>'role' not in ('ComplianceOfficer','SuperAdmin') then null
    when not exists(select 1 from bx1_portal.entry_configuration cfg where cfg.singleton
      and cfg.environment='TESTNET' and cfg.reviewer_scope=(c->>'organisationId')::uuid) then 'NOT_ADMITTED'
    when not queue_available then 'MFA_REQUIRED'
    else null end;
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.representative_mandate_projection(c,m.id)
    order by m.submitted_at,m.id),'[]'::jsonb) into cases
    from bx1_portal.representative_mandates m
    where (c->>'mode'='APPLICANT' and m.applicant_user_id=auth.uid())
      or bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer')
      or bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.request_key,'command',r.command)
    order by r.created_at desc,r.request_key),'[]'::jsonb) into mandate_requests
    from (select * from bx1_portal.representative_mandate_requests
      where actor_id=auth.uid() and operating_context=c and command<>'request_representative_mandate'
        and created_at>=clock_timestamp()-interval '7 days'
      order by created_at desc,request_key limit 1000) r;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'mandate_scope_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_set(pg_catalog.jsonb_set(result,'{organisation_mandates}',cases),
    '{requests}',coalesce(result->'requests','[]'::jsonb)||mandate_requests)
    ||pg_catalog.jsonb_build_object('mandate_queue_available',queue_available,
      'mandate_queue_blocked_reason',queue_reason);
end $$;

alter function bx1_portal.entry_command(text,uuid,jsonb) rename to entry_command_pre_mandate;
-- The Stage 1 entry writer qualifies its parameter against the function name.
-- A PostgreSQL rename does not rewrite those PL/pgSQL source references.
do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.entry_command_pre_mandate(text,uuid,jsonb)'::regprocedure);
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,'entry_command.request_key','')))
      /pg_catalog.length('entry_command.request_key')<>3 then
    raise exception 'mandate_entry_writer_definition_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(definition,'entry_command.request_key','entry_command_pre_mandate.request_key');
end $$;
create function bx1_portal.entry_command(command text,request_key uuid,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a bx1_portal.applications; o bx1_portal.organisations;
  m bx1_portal.representative_mandates; prior bx1_portal.representative_mandate_requests;
  receipt_id uuid; expected integer; expiry timestamptz; v_now timestamptz;
begin
  if command<>'request_representative_mandate' then
    return bx1_portal.entry_command_pre_mandate(command,request_key,payload); end if;
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or pg_catalog.octet_length(payload::text)>65536 then
    raise exception 'mandate_invalid_command' using errcode='22023'; end if;
  perform bx1_portal.entry_lock_actor();
  if bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'mandate_manual_route_unavailable' using errcode='55000'; end if;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  select * into prior from bx1_portal.representative_mandate_requests r
    where r.actor_id=actor and r.request_key=entry_command.request_key;
  if found then
    if prior.command is distinct from command or prior.operating_context is distinct from '{"mode":"APPLICANT"}'::jsonb
      or prior.payload is distinct from payload then
      raise exception 'mandate_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.entry_read();
  end if;
  if exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=entry_command.request_key)
    or exists(select 1 from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=entry_command.request_key)
    or exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=entry_command.request_key) then
    raise exception 'mandate_prior_key_conflict' using errcode='23505'; end if;
  perform bx1_portal.require_keys(payload,array['application_id','expected_revision','evidence_reference','requested_until']);
  perform bx1_portal.require_text(payload,'evidence_reference',20,400);
  if pg_catalog.jsonb_typeof(payload->'application_id') is distinct from 'string'
    or payload->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(payload->'expected_revision') is distinct from 'number'
    or payload->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'
    or pg_catalog.jsonb_typeof(payload->'requested_until') is distinct from 'string'
    or payload->>'requested_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
    raise exception 'mandate_invalid_request' using errcode='22023'; end if;
  expected:=(payload->>'expected_revision')::integer;
  expiry:=(payload->>'requested_until')::timestamptz;
  select * into a from bx1_portal.applications where id=(payload->>'application_id')::uuid
    and user_id=actor for share;
  if a.id is null then raise exception 'mandate_application_denied' using errcode='42501'; end if;
  select * into o from bx1_portal.organisations where id=a.organisation_id for update;
  if o.id is null or o.application_id<>a.id or o.owner_id<>actor then
    raise exception 'mandate_organisation_denied' using errcode='42501'; end if;
  perform id from public.bx1_organisations where id=a.reviewer_scope for share;
  select * into m from bx1_portal.representative_mandates where application_id=a.id for update;
  v_now:=clock_timestamp();
  if a.persona<>'WEALTH_MANAGER' or a.admission_purpose<>'CUSTOMER_ORGANISATION_ADMISSION'
    or a.status<>'APPROVED' or a.approved_until<=v_now or a.details->'details_version' is distinct from '2'::jsonb
    or a.provider_mode<>'MANUAL_TEST_REVIEW' or o.status<>'ACTIVE'
    or a.reviewer_scope is distinct from o.reviewer_scope
    or not exists(select 1 from bx1_portal.entry_configuration cfg where cfg.singleton
      and cfg.environment='TESTNET' and cfg.manual_test_review and cfg.reviewer_scope=a.reviewer_scope)
    or expiry<=v_now or expiry>a.approved_until or expiry>v_now+interval '30 days'
    or exists(select 1 from bx1_portal.organisation_authority_bindings b
      where b.product_organisation_id=o.id) then
    raise exception 'mandate_admission_unavailable' using errcode='42501'; end if;
  if m.id is null then
    if expected<>0 then raise exception 'mandate_stale_revision' using errcode='23514'; end if;
    insert into bx1_portal.representative_mandates(
      application_id,applicant_user_id,product_organisation_id,reviewer_scope_organisation_id,
      admission_revision,evidence_reference,requested_until,submitted_at)
      values(a.id,actor,o.id,a.reviewer_scope,a.revision,payload->>'evidence_reference',expiry,v_now)
      returning * into m;
  else
    if (m.status not in ('CHANGES_REQUIRED','REJECTED')
      and not(m.status='APPROVED' and m.requested_until<=v_now))
      or m.revision<>expected or m.admission_revision<>a.revision then
      raise exception 'mandate_stale_or_terminal' using errcode='23514'; end if;
    update bx1_portal.representative_mandates set status='SUBMITTED',revision=revision+1,
      evidence_reference=payload->>'evidence_reference',requested_until=expiry,submitted_at=v_now,
      reviewed_at=null,reviewer_user_id=null,review_notes=null,review_checks='{}'::jsonb,
      approval_receipt_id=null
      where id=m.id returning * into m;
  end if;
  if bx1_portal.fresh_session() is not true or not bx1_portal.representative_mandate_admission_current(m.id,true) then
    raise exception 'mandate_authority_changed' using errcode='42501'; end if;
  insert into bx1_portal.representative_mandate_receipts(
    mandate_id,mandate_revision,action,actor_id,operating_context,command_payload,admission_revision,status_after)
    values(m.id,m.revision,command,actor,'{"mode":"APPLICANT"}'::jsonb,payload,m.admission_revision,m.status)
    returning id into receipt_id;
  insert into bx1_portal.representative_mandate_requests(
    actor_id,request_key,command,operating_context,payload,mandate_id,receipt_id)
    values(actor,request_key,command,'{"mode":"APPLICANT"}'::jsonb,payload,m.id,receipt_id);
  return bx1_portal.entry_read();
end $$;

alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_mandate;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); m bx1_portal.representative_mandates;
  a bx1_portal.applications; o bx1_portal.organisations;
  prior bx1_portal.representative_mandate_requests;
  expected integer; decision text; receipt_id uuid; v_now timestamptz;
  new_native_org uuid; new_membership uuid; new_binding uuid;
begin
  if action not in ('review_representative_mandate','apply_representative_mandate','revoke_representative_mandate') then
    return bx1_portal.execute_scoped_pre_mandate(c,action,key,body); end if;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'mandate_context_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'mandate_invalid_command' using errcode='22023'; end if;
  perform bx1_portal.entry_lock_actor();
  if c->>'mode'<>'ROLE' or c->>'role' not in ('ComplianceOfficer','SuperAdmin') then
    raise exception 'mandate_staff_context_required' using errcode='42501'; end if;
  perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
  perform id from public.bx1_memberships where user_id=actor
    and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'mandate_staff_context_changed' using errcode='42501'; end if;
  select * into prior from bx1_portal.representative_mandate_requests r
    where r.actor_id=actor and r.request_key=key;
  if found then
    if prior.command is distinct from action or prior.operating_context is distinct from c
      or prior.payload is distinct from body then
      raise exception 'mandate_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key) then
    raise exception 'mandate_prior_key_conflict' using errcode='23505'; end if;
  if action='review_representative_mandate' then
    perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','decision','notes','checks']);
    perform bx1_portal.require_text(body,'notes',20,3000);
    decision:=body->>'decision';
    if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then
      raise exception 'mandate_invalid_decision' using errcode='22023'; end if;
    perform bx1_portal.require_checks(body->'checks',array['appointment','evidence','scope'],decision='APPROVED');
  elsif action='revoke_representative_mandate' then
    perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','reason']);
    perform bx1_portal.require_text(body,'reason',20,1000);
  else
    perform bx1_portal.require_keys(body,array['mandate_id','expected_revision']);
  end if;
  if pg_catalog.jsonb_typeof(body->'mandate_id') is distinct from 'string'
    or body->>'mandate_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'mandate_invalid_reference' using errcode='22023'; end if;
  expected:=(body->>'expected_revision')::integer;
  -- Lock in a stable order shared with the applicant request: admission, portal
  -- organisation, then case. A first binding INSERT locks the same portal org.
  select * into m from bx1_portal.representative_mandates where id=(body->>'mandate_id')::uuid;
  if m.id is null then raise exception 'mandate_scope_denied' using errcode='42501'; end if;
  if c->>'organisationId' is distinct from m.reviewer_scope_organisation_id::text then
    raise exception 'mandate_scope_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=m.application_id for share;
  select * into o from bx1_portal.organisations where id=m.product_organisation_id for update;
  select * into m from bx1_portal.representative_mandates where id=m.id for update;
  if m.revision<>expected or a.id<>m.application_id or o.id<>m.product_organisation_id
    or a.user_id<>m.applicant_user_id or o.application_id<>a.id
    or a.reviewer_scope is distinct from m.reviewer_scope_organisation_id
    or o.reviewer_scope is distinct from m.reviewer_scope_organisation_id then
    raise exception 'mandate_stale_or_invalid' using errcode='23514'; end if;
  if not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role') then
    raise exception 'mandate_staff_authority_denied' using errcode='42501'; end if;
  v_now:=clock_timestamp();
  if action='review_representative_mandate' then
    if c->>'role'<>'ComplianceOfficer' or m.status<>'SUBMITTED'
      or not bx1_portal.independent_of(m.applicant_user_id)
      or not bx1_portal.representative_mandate_admission_current(m.id,true) then
      raise exception 'mandate_review_denied' using errcode='42501'; end if;
    -- A receipt ID is minted before the state transition so the approval can
    -- bind the later portal authority record without a guessed latest-row join.
    receipt_id:=pg_catalog.gen_random_uuid();
    insert into bx1_portal.representative_mandate_receipts(
      id,mandate_id,mandate_revision,action,actor_id,operating_context,command_payload,admission_revision,status_after)
      values(receipt_id,m.id,m.revision+1,action,actor,c,body,m.admission_revision,decision);
    update bx1_portal.representative_mandates set status=decision,revision=revision+1,
      reviewed_at=v_now,reviewer_user_id=actor,review_notes=body->>'notes',review_checks=body->'checks',
      approval_receipt_id=case when decision='APPROVED' then receipt_id else null end
      where id=m.id returning * into m;
    if not bx1_portal.representative_mandate_admission_current(m.id,true)
      or not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer') then
      raise exception 'mandate_review_changed_after_wait' using errcode='42501'; end if;
  elsif action='apply_representative_mandate' then
    if c->>'role'<>'SuperAdmin' or m.status<>'APPROVED' or m.approval_receipt_id is null
      or m.reviewer_user_id is null or not bx1_portal.independent_of(m.applicant_user_id)
      or not bx1_portal.independent_of(m.reviewer_user_id)
      or not bx1_portal.representative_mandate_admission_current(m.id,true) then
      raise exception 'mandate_apply_denied' using errcode='42501'; end if;
    -- Do not bootstrap a banned/deleted/unconfirmed applicant or reactivate a
    -- suspended profile. A new customer native organisation is created only
    -- inside this reviewed apply transaction, never at admission approval.
    perform id from auth.users where id=m.applicant_user_id for share;
    if not exists(select 1 from auth.users u where u.id=m.applicant_user_id
      and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
      raise exception 'mandate_applicant_disabled' using errcode='42501'; end if;
    perform id from public.bx1_profiles where id=m.applicant_user_id for share;
    if exists(select 1 from public.bx1_profiles p where p.id=m.applicant_user_id and p.status<>'ACTIVE') then
      raise exception 'mandate_applicant_profile_disabled' using errcode='42501'; end if;
    insert into public.bx1_profiles(id,display_name,status)
      values(m.applicant_user_id,a.details->>'full_name','ACTIVE') on conflict(id) do nothing;
    insert into public.bx1_organisations(name,status)
      values(o.name,'ACTIVE') returning id into new_native_org;
    insert into public.bx1_memberships(user_id,organisation_id,role,status)
      values(m.applicant_user_id,new_native_org,'OfferingManager','ACTIVE') returning id into new_membership;
    insert into bx1_portal.organisation_authority_bindings(
      product_organisation_id,native_organisation_id,role,status,valid_from,valid_until,
      evidence_reference,approval_receipt_id)
      values(o.id,new_native_org,'OfferingManager','ACTIVE',v_now,m.requested_until,
        m.evidence_reference,m.approval_receipt_id) returning id into new_binding;
    update bx1_portal.representative_mandates set status='APPLIED',revision=revision+1,
      applied_at=v_now,applied_by_user_id=actor,native_organisation_id=new_native_org,
      native_membership_id=new_membership,authority_binding_id=new_binding
      where id=m.id returning * into m;
    if not bx1_portal.representative_mandate_effective(m.id)
      or not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin')
      or not bx1_portal.independent_of(m.reviewer_user_id) then
      raise exception 'mandate_apply_changed_after_wait' using errcode='42501'; end if;
    insert into bx1_portal.representative_mandate_receipts(
      mandate_id,mandate_revision,action,actor_id,operating_context,command_payload,admission_revision,
      status_after,native_organisation_id,native_membership_id,authority_binding_id)
      values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status,
        new_native_org,new_membership,new_binding) returning id into receipt_id;
  else
    if m.status<>'APPLIED' or c->>'role' not in ('ComplianceOfficer','SuperAdmin')
      or not bx1_portal.independent_of(m.applicant_user_id) then
      raise exception 'mandate_revoke_denied' using errcode='42501'; end if;
    perform id from bx1_portal.organisation_authority_bindings where id=m.authority_binding_id for update;
    perform id from public.bx1_memberships where id=m.native_membership_id for update;
    update bx1_portal.organisation_authority_bindings set status='REVOKED'
      where id=m.authority_binding_id and product_organisation_id=m.product_organisation_id
        and native_organisation_id=m.native_organisation_id and role='OfferingManager' and status='ACTIVE';
    if not found then raise exception 'mandate_binding_stale' using errcode='23514'; end if;
    update public.bx1_memberships set status='SUSPENDED'
      where id=m.native_membership_id and user_id=m.applicant_user_id
        and organisation_id=m.native_organisation_id and role='OfferingManager' and status='ACTIVE';
    if not found then raise exception 'mandate_membership_stale' using errcode='23514'; end if;
    update bx1_portal.representative_mandates set status='REVOKED',revision=revision+1,
      revoked_at=v_now,revoked_by_user_id=actor,revoke_reason=body->>'reason'
      where id=m.id returning * into m;
    if bx1_portal.representative_mandate_effective(m.id) then
      raise exception 'mandate_revoke_failed' using errcode='23514'; end if;
    insert into bx1_portal.representative_mandate_receipts(
      mandate_id,mandate_revision,action,actor_id,operating_context,command_payload,admission_revision,
      status_after,native_organisation_id,native_membership_id,authority_binding_id)
      values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status,
        m.native_organisation_id,m.native_membership_id,m.authority_binding_id) returning id into receipt_id;
  end if;
  if not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role') then
    raise exception 'mandate_staff_authority_changed' using errcode='42501'; end if;
  insert into bx1_portal.representative_mandate_requests(
    actor_id,request_key,command,operating_context,payload,mandate_id,receipt_id)
    values(actor,key,action,c,body,m.id,receipt_id);
  return bx1_portal.read_scoped(c);
end $$;

-- Rebind public invokers to the new guarded OIDs; never expose pre-mandate
-- functions that could become a parallel writer/read path after this cutover.
create or replace function public.bx1_entry_read() returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.entry_read(); $$;
create or replace function public.bx1_entry_command(command text,request_key uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.entry_command(command,request_key,payload); $$;
create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;
revoke all on function bx1_portal.guard_representative_mandate(),
  bx1_portal.representative_mandate_effective(uuid),
  bx1_portal.representative_mandate_requestable(uuid),
  bx1_portal.representative_mandate_admission_current(uuid,boolean,boolean),
  bx1_portal.representative_mandate_actor(jsonb,uuid,text),
  bx1_portal.representative_mandate_projection(jsonb,uuid),
  bx1_portal.entry_read_pre_mandate(),bx1_portal.read_scoped_pre_mandate(jsonb),
  bx1_portal.entry_command_pre_mandate(text,uuid,jsonb),
  bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb),
  bx1_portal.entry_read(),bx1_portal.read_scoped(jsonb),
  bx1_portal.entry_command(text,uuid,jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_entry_read(),public.bx1_entry_command(text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function bx1_portal.entry_read(),bx1_portal.entry_command(text,uuid,jsonb),
  public.bx1_entry_read(),public.bx1_entry_command(text,uuid,jsonb) to authenticated;
do $$ begin
  -- MAIN entry-only baseline must remain entry-only after this additive schema.
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
      public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated;
  end if;
end $$;
comment on table bx1_portal.representative_mandates is
  'First representative only for an approved synthetic customer organisation. Later representatives require a separate source-application model; customer admission itself never grants a role.';
