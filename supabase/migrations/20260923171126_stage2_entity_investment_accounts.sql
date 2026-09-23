-- Stage 2: one investment-account identity for natural and legal persons.
-- TEST-only reviewed entity account/representative admission. This introduces
-- no entity subscription, payment, product eligibility, role or signer grant.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regclass('bx1_portal.investment_accounts') is null
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null
    or pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.representative_mandate_actor(jsonb,uuid,text)') is null
    then raise exception 'entity_admission_baseline_required' using errcode='55000'; end if;
end $$;

create table bx1_portal.legal_entity_parties (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  application_id uuid not null unique references bx1_portal.applications(id) on delete restrict,
  admission_revision integer not null check(admission_revision>1),
  submitted_revision integer not null check(submitted_revision>0),
  legal_name text not null check(pg_catalog.char_length(legal_name) between 3 and 160),
  registration_reference text not null check(pg_catalog.char_length(registration_reference) between 3 and 100),
  country text not null check(country ~ '^[A-Z]{2}$'),
  submitted_details_sha256 text not null check(submitted_details_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique(id,application_id)
);
alter table bx1_portal.legal_entity_parties enable row level security;
revoke all on bx1_portal.legal_entity_parties from public,anon,authenticated,service_role;
create trigger bx1_legal_entity_party_immutable before update or delete on bx1_portal.legal_entity_parties
  for each row execute function bx1_portal.immutable_record();

-- The existing individual (id,holder_user_id) FK on subscriptions stays in
-- place. A null individual holder cannot pass that FK: entities have no order
-- or funding route until their own account/mandate/eligibility join is built.
alter table bx1_portal.investment_accounts drop constraint investment_accounts_kind_check;
alter table bx1_portal.investment_accounts alter column holder_user_id drop not null;
alter table bx1_portal.investment_accounts add column entity_party_id uuid unique
  references bx1_portal.legal_entity_parties(id) on delete restrict;
alter table bx1_portal.investment_accounts add constraint bx1_investment_account_holder_xor check(
  (kind='INDIVIDUAL' and holder_user_id is not null and entity_party_id is null)
  or (kind='ENTITY' and holder_user_id is null and entity_party_id is not null));

create function bx1_portal.guard_entity_account_insert() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if NEW.kind='ENTITY' and not exists(select 1 from bx1_portal.legal_entity_parties p
      where p.id=NEW.entity_party_id and p.application_id=NEW.application_id) then
    raise exception 'entity_account_party_mismatch' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_entity_account_insert before insert on bx1_portal.investment_accounts
  for each row execute function bx1_portal.guard_entity_account_insert();

create table bx1_portal.investing_representative_mandates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  entity_party_id uuid not null references bx1_portal.legal_entity_parties(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  representative_user_id uuid not null references auth.users(id) on delete restrict,
  reviewer_scope_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  admission_revision integer not null check(admission_revision>1),
  cycle integer not null default 1 check(cycle>0),
  revision integer not null default 1 check(revision>0),
  status text not null default 'SUBMITTED' check(status in
    ('SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','APPLIED','REVOKED')),
  scope text[] not null default array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']::text[]
    check(scope=array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']::text[]),
  transaction_limit_minor numeric(38,0) not null default 0 check(transaction_limit_minor=0),
  evidence_reference text not null check(pg_catalog.char_length(evidence_reference) between 20 and 400
    and evidence_reference=pg_catalog.btrim(evidence_reference)),
  appointment_document_id uuid not null,
  appointment_document_sha256 text not null check(appointment_document_sha256 ~ '^[0-9a-f]{64}$'),
  requested_until timestamptz not null check(pg_catalog.isfinite(requested_until)),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewer_user_id uuid references auth.users(id) on delete restrict,
  review_notes text,
  review_checks jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(review_checks)='object'),
  approval_receipt_id uuid unique,
  applied_at timestamptz,
  applied_by_user_id uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revoke_reason text,
  created_at timestamptz not null default clock_timestamp(),
  unique(investment_account_id,representative_user_id,cycle),
  check(representative_user_id=applicant_user_id),
  check(reviewer_user_id is null or reviewer_user_id<>representative_user_id),
  check(applied_by_user_id is null or applied_by_user_id not in (representative_user_id,reviewer_user_id)),
  check(status not in ('APPROVED','APPLIED','REVOKED')
    or (reviewer_user_id is not null and approval_receipt_id is not null)),
  check(status<>'APPLIED' or (applied_at is not null and applied_by_user_id is not null)),
  check((status='REVOKED')=(revoked_at is not null))
);
create index bx1_entity_mandate_review_queue on bx1_portal.investing_representative_mandates
  (reviewer_scope_organisation_id,status,submitted_at,id);
create index bx1_entity_mandate_representative on bx1_portal.investing_representative_mandates
  (representative_user_id,submitted_at,id);
alter table bx1_portal.investing_representative_mandates enable row level security;
revoke all on bx1_portal.investing_representative_mandates from public,anon,authenticated,service_role;

create table bx1_portal.investing_representative_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  mandate_id uuid not null references bx1_portal.investing_representative_mandates(id) on delete restrict,
  mandate_revision integer not null check(mandate_revision>0),
  action text not null check(action in ('request_investing_representative_mandate',
    'review_investing_representative_mandate','apply_investing_representative_mandate',
    'revoke_investing_representative_mandate')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  command_payload jsonb not null check(pg_catalog.jsonb_typeof(command_payload)='object'),
  admission_revision integer not null,
  status_after text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(mandate_id,mandate_revision)
);
alter table bx1_portal.investing_representative_receipts enable row level security;
revoke all on bx1_portal.investing_representative_receipts from public,anon,authenticated,service_role;
create trigger bx1_entity_mandate_receipt_immutable before update or delete on bx1_portal.investing_representative_receipts
  for each row execute function bx1_portal.immutable_record();
alter table bx1_portal.investing_representative_mandates add constraint bx1_entity_mandate_approval_receipt
  foreign key(approval_receipt_id) references bx1_portal.investing_representative_receipts(id) on delete restrict;

create function bx1_portal.guard_investing_representative_mandate() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'entity_mandate_history_immutable' using errcode='23514'; end if;
  if row(NEW.id,NEW.investment_account_id,NEW.application_id,NEW.entity_party_id,
      NEW.applicant_user_id,NEW.representative_user_id,NEW.reviewer_scope_organisation_id,
      NEW.admission_revision,NEW.cycle,NEW.scope,NEW.transaction_limit_minor,NEW.created_at)
    is distinct from row(OLD.id,OLD.investment_account_id,OLD.application_id,OLD.entity_party_id,
      OLD.applicant_user_id,OLD.representative_user_id,OLD.reviewer_scope_organisation_id,
      OLD.admission_revision,OLD.cycle,OLD.scope,OLD.transaction_limit_minor,OLD.created_at)
    or NEW.revision<>OLD.revision+1
    or not ((OLD.status='SUBMITTED' and NEW.status in ('APPROVED','CHANGES_REQUIRED','REJECTED'))
      or (OLD.status in ('CHANGES_REQUIRED','REJECTED') and NEW.status='SUBMITTED')
      or (OLD.status='APPROVED' and OLD.requested_until<=clock_timestamp() and NEW.status='SUBMITTED')
      or (OLD.status='APPROVED' and NEW.status='APPLIED')
      or (OLD.status='APPLIED' and NEW.status='REVOKED')) then
    raise exception 'entity_mandate_invalid_transition' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger bx1_entity_mandate_guard before update or delete on bx1_portal.investing_representative_mandates
  for each row execute function bx1_portal.guard_investing_representative_mandate();

create function bx1_portal.entity_people_independent(a uuid,b uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  -- Distinct emails are not evidence of distinct humans. Missing trusted
  -- person mappings fail closed, including the user's multi-email TEST setup.
  select a is not null and b is not null and a<>b and exists(
    select 1 from bx1_private.person_principals p1
      join bx1_private.persons h1 on h1.id=p1.person_id and h1.status='TRUSTED'
      join bx1_private.person_principals p2 on p2.auth_user_id=b and p2.status='TRUSTED'
      join bx1_private.persons h2 on h2.id=p2.person_id and h2.status='TRUSTED'
      where p1.auth_user_id=a and p1.status='TRUSTED' and p1.person_id<>p2.person_id);
$$;
create function bx1_portal.lock_entity_people(target_users uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  -- Serialize a decision with trust revocation; a status change committed
  -- during the wait is observed by the later fresh independence check.
  perform p.auth_user_id from bx1_private.person_principals p
    where p.auth_user_id=any(target_users) order by p.auth_user_id for share;
  perform h.id from bx1_private.persons h
    where h.id in (select p.person_id from bx1_private.person_principals p
      where p.auth_user_id=any(target_users)) order by h.id for share;
end $$;
create function bx1_portal.entity_account_admission_current(target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investment_accounts i
    join bx1_portal.legal_entity_parties p on p.id=i.entity_party_id and p.application_id=i.application_id
    join bx1_portal.applications a on a.id=i.application_id
    join bx1_portal.application_detail_versions v on v.application_id=a.id
      and v.application_revision=p.submitted_revision and v.capture_kind='SUBMISSION'
    join bx1_portal.entry_configuration cfg on cfg.singleton
    where i.id=target_account and i.kind='ENTITY' and i.holder_user_id is null and i.status='ACTIVE'
      and a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
      and a.context_kind='PERSONAL' and a.status='APPROVED' and a.provider_mode='MANUAL_TEST_REVIEW'
      and a.details->>'investor_type'='ENTITY' and a.revision=p.admission_revision
      and a.approved_until>clock_timestamp() and a.reviewer_id is not null
      and a.review_checks='{"identity":true,"ownership":true,"screening":true,"suitability":true}'::jsonb
      and bx1_portal.entity_people_independent(a.user_id,a.reviewer_id)
      and a.reviewer_scope=cfg.reviewer_scope and cfg.environment='TESTNET' and cfg.manual_test_review
      and bx1_portal.entry_manual_review_enabled()
      and p.submitted_details_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex')
      and a.details=v.details);
$$;
create function bx1_portal.entity_application_account_openable(target_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.applications a
    join bx1_portal.application_detail_versions v on v.application_id=a.id
      and v.application_revision=a.revision-1 and v.capture_kind='SUBMISSION'
    join bx1_portal.entry_configuration cfg on cfg.singleton
    where a.id=target_application and a.user_id=auth.uid()
      and a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
      and a.context_kind='PERSONAL' and a.status='APPROVED'
      and a.provider_mode='MANUAL_TEST_REVIEW' and a.details->>'investor_type'='ENTITY'
      and a.approved_until>clock_timestamp() and a.reviewer_id is not null
      and a.review_checks='{"identity":true,"ownership":true,"screening":true,"suitability":true}'::jsonb
      and bx1_portal.entity_people_independent(a.user_id,a.reviewer_id)
      and a.details=v.details and cfg.environment='TESTNET' and cfg.manual_test_review
      and a.reviewer_scope=cfg.reviewer_scope and bx1_portal.entry_manual_review_enabled()
      and not exists(select 1 from bx1_portal.investment_accounts i where i.application_id=a.id));
$$;
create function bx1_portal.investing_mandate_current(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investing_representative_mandates m
    join bx1_portal.investment_accounts i on i.id=m.investment_account_id
    join bx1_portal.legal_entity_parties p on p.id=m.entity_party_id
    join bx1_portal.applications a on a.id=m.application_id
    join bx1_portal.application_detail_versions v on v.application_id=a.id
      and v.application_revision=p.submitted_revision and v.capture_kind='SUBMISSION'
    cross join lateral pg_catalog.jsonb_array_elements(v.details->'documents') d(item)
    where m.id=target_mandate and i.entity_party_id=p.id and i.application_id=a.id
      and a.user_id=m.applicant_user_id and m.representative_user_id=m.applicant_user_id
      and a.reviewer_scope=m.reviewer_scope_organisation_id
      and a.revision=m.admission_revision and p.admission_revision=m.admission_revision
      and m.requested_until>clock_timestamp() and m.requested_until<=a.approved_until
      and d.item->>'id'=m.appointment_document_id::text and d.item->>'kind'='COMPANY'
      and d.item->>'sha256'=m.appointment_document_sha256
      and bx1_portal.entity_account_admission_current(i.id));
$$;
create function bx1_portal.investing_mandate_effective(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investing_representative_mandates m
    join auth.users u on u.id=m.representative_user_id
    where m.id=target_mandate and m.status='APPLIED' and m.scope=array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']::text[]
      and m.transaction_limit_minor=0 and m.approval_receipt_id is not null
      and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and bx1_portal.entity_people_independent(m.representative_user_id,m.reviewer_user_id)
      and bx1_portal.entity_people_independent(m.representative_user_id,m.applied_by_user_id)
      and bx1_portal.entity_people_independent(m.reviewer_user_id,m.applied_by_user_id)
      and bx1_portal.investing_mandate_current(m.id));
$$;

create function bx1_portal.entity_account_projection(c jsonb,target_account uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i bx1_portal.investment_accounts; p bx1_portal.legal_entity_parties;
  a bx1_portal.applications; own_application boolean; effective_mandate boolean;
  requestable boolean;
begin
  if bx1_portal.valid_operating_context(c) is not true then return null; end if;
  select * into i from bx1_portal.investment_accounts where id=target_account and kind='ENTITY';
  if i.id is null then return null; end if;
  select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id;
  select * into a from bx1_portal.applications where id=i.application_id;
  own_application:=c->>'mode'='APPLICANT' and a.user_id=auth.uid();
  effective_mandate:=c->>'mode'='APPLICANT' and exists(
    select 1 from bx1_portal.investing_representative_mandates m
      where m.investment_account_id=i.id and m.representative_user_id=auth.uid()
        and bx1_portal.investing_mandate_effective(m.id));
  if not (own_application or effective_mandate) then return null; end if;
  requestable:=own_application and bx1_portal.entity_account_admission_current(i.id)
    and not exists(select 1 from bx1_portal.investing_representative_mandates m
      where m.investment_account_id=i.id and m.representative_user_id=auth.uid()
        and (m.status='SUBMITTED' or (m.status='APPROVED' and m.requested_until>clock_timestamp())
          or (m.status='APPLIED' and m.requested_until>clock_timestamp())));
  return pg_catalog.jsonb_build_object(
    'id',i.id,'application_id',a.id,'entity_party_id',p.id,
    'entity_name',p.legal_name,'registration_reference',p.registration_reference,
    'country',p.country,'kind',i.kind,'status',i.status,'created_at',i.created_at,
    'admission_revision',p.admission_revision,'admission_approved_until',a.approved_until,
    'can_request_mandate',requestable,'can_view',effective_mandate,
    -- Recorded mandate scope is conditional future policy; no guarded entity
    -- product-eligibility command exists in this increment.
    'can_request_eligibility',false);
end $$;

create function bx1_portal.investing_mandate_projection(c jsonb,target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.investing_representative_mandates; a bx1_portal.applications;
  p bx1_portal.legal_entity_parties; applicant_visible boolean; reviewer_visible boolean;
  applier_visible boolean; current_admission boolean; next_actor text;
begin
  if bx1_portal.valid_operating_context(c) is not true then return null; end if;
  select * into m from bx1_portal.investing_representative_mandates where id=target_mandate;
  if m.id is null then return null; end if;
  select * into a from bx1_portal.applications where id=m.application_id;
  select * into p from bx1_portal.legal_entity_parties where id=m.entity_party_id;
  applicant_visible:=c->>'mode'='APPLICANT' and m.applicant_user_id=auth.uid();
  reviewer_visible:=false; applier_visible:=false;
  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer' then
    reviewer_visible:=bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer');
  elsif c->>'mode'='ROLE' and c->>'role'='SuperAdmin' then
    applier_visible:=bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  end if;
  if not(applicant_visible or reviewer_visible or applier_visible) then return null; end if;
  current_admission:=bx1_portal.investing_mandate_current(m.id);
  next_actor:=case
    when m.status in ('CHANGES_REQUIRED','REJECTED')
      and bx1_portal.entity_account_admission_current(m.investment_account_id) then 'APPLICANT'
    when m.status='APPROVED' and m.requested_until<=clock_timestamp()
      and bx1_portal.entity_account_admission_current(m.investment_account_id) then 'APPLICANT'
    when m.status='SUBMITTED' and current_admission then 'COMPLIANCE'
    when m.status='APPROVED' and current_admission then 'SUPER_ADMIN'
    else 'NONE' end;
  return pg_catalog.jsonb_build_object(
    'id',m.id,'investment_account_id',m.investment_account_id,
    'application_id',m.application_id,'applicant_user_id',m.applicant_user_id,
    'representative_user_id',m.representative_user_id,'entity_party_id',m.entity_party_id,
    'entity_name',p.legal_name,'reviewer_scope_organisation_id',m.reviewer_scope_organisation_id,
    'admission_revision',m.admission_revision,'admission_current_revision',a.revision,
    'admission_approved_until',a.approved_until,'cycle',m.cycle,'revision',m.revision,'status',m.status,
    'scope',pg_catalog.to_jsonb(m.scope),'transaction_limit_minor',m.transaction_limit_minor::text,
    'evidence_reference',m.evidence_reference,'appointment_document_id',m.appointment_document_id,
    'requested_until',m.requested_until,'submitted_at',m.submitted_at,
    'reviewed_at',m.reviewed_at,'reviewer_user_id',m.reviewer_user_id,
    'review_notes',m.review_notes,'review_checks',m.review_checks,
    'approval_receipt_id',m.approval_receipt_id,'applied_at',m.applied_at,
    'applied_by_user_id',m.applied_by_user_id,'revoked_at',m.revoked_at,
    'revoke_reason',m.revoke_reason,
    'effective',bx1_portal.investing_mandate_effective(m.id),
    'next_owner',next_actor,
    'can_request',applicant_visible and
      ((bx1_portal.entity_account_admission_current(m.investment_account_id)
          and m.status in ('CHANGES_REQUIRED','REJECTED'))
        or (m.status='APPROVED' and m.requested_until<=clock_timestamp()
          and bx1_portal.entity_account_admission_current(m.investment_account_id))),
    'can_review',reviewer_visible and m.status='SUBMITTED' and current_admission
      and bx1_portal.entity_people_independent(auth.uid(),m.applicant_user_id),
    'can_apply',applier_visible and m.status='APPROVED' and current_admission
      and m.approval_receipt_id is not null
      and bx1_portal.entity_people_independent(auth.uid(),m.applicant_user_id)
      and bx1_portal.entity_people_independent(auth.uid(),m.reviewer_user_id),
    'can_revoke',(reviewer_visible or applier_visible) and m.status='APPLIED'
      and bx1_portal.entity_people_independent(auth.uid(),m.applicant_user_id));
end $$;

-- Only the existing scoped portal reader is exposed. Array presence is stable
-- even when a caller has no eligible cases or lacks staff MFA.
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_entity;
create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; accounts jsonb:='[]'::jsonb; cases jsonb:='[]'::jsonb;
  enriched_apps jsonb; available boolean:=false; blocked text; route_available boolean:=false;
begin
  result:=bx1_portal.read_scoped_pre_entity(c);
  route_available:=c->>'mode'='APPLICANT' and bx1_portal.entry_manual_review_enabled();
  select coalesce(pg_catalog.jsonb_agg(app.item||pg_catalog.jsonb_build_object(
    'can_create_entity_account',route_available and bx1_portal.entity_application_account_openable((app.item->>'id')::uuid))
    order by app.ordinality),'[]'::jsonb) into enriched_apps
    from pg_catalog.jsonb_array_elements(result->'applications') with ordinality app(item,ordinality);
  if c->>'mode'='APPLICANT' then
    select coalesce(pg_catalog.jsonb_agg(bx1_portal.entity_account_projection(c,i.id)
      order by i.created_at,i.id),'[]'::jsonb) into accounts
      from bx1_portal.investment_accounts i join bx1_portal.applications a on a.id=i.application_id
      where i.kind='ENTITY' and (a.user_id=auth.uid() or exists(
        select 1 from bx1_portal.investing_representative_mandates m
        where m.investment_account_id=i.id and m.representative_user_id=auth.uid()
          and bx1_portal.investing_mandate_effective(m.id)));
    select coalesce(pg_catalog.jsonb_agg(bx1_portal.investing_mandate_projection(c,m.id)
      order by m.submitted_at,m.id),'[]'::jsonb) into cases
      from bx1_portal.investing_representative_mandates m where m.representative_user_id=auth.uid();
  elsif c->>'mode'='ROLE' and c->>'role' in ('ComplianceOfficer','SuperAdmin') then
    available:=bx1_portal.representative_mandate_actor(c,(c->>'organisationId')::uuid,c->>'role');
    blocked:=case when not exists(select 1 from bx1_portal.entry_configuration cfg
      where cfg.singleton and cfg.environment='TESTNET'
        and cfg.reviewer_scope=(c->>'organisationId')::uuid) then 'NOT_ADMITTED'
      when not available then 'MFA_REQUIRED' else null end;
    if available then
      select coalesce(pg_catalog.jsonb_agg(bx1_portal.investing_mandate_projection(c,m.id)
        order by m.submitted_at,m.id),'[]'::jsonb) into cases
        from bx1_portal.investing_representative_mandates m
        where m.reviewer_scope_organisation_id=(c->>'organisationId')::uuid;
    end if;
  end if;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'entity_scope_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_set(result,'{applications}',enriched_apps)||pg_catalog.jsonb_build_object(
    'entity_investment_accounts',accounts,
    'investing_representative_mandates',cases,
    'entity_account_route_available',route_available,
    'entity_account_blocked_reason',case when route_available then null else 'NOT_ADMITTED' end,
    'entity_mandate_queue_available',available,
    'entity_mandate_queue_blocked_reason',blocked);
end $$;

-- The same public scoped command remains the sole writer. Existing commands
-- delegate to the preceding guarded implementation; only these four new
-- account/mandate actions are handled here. No duplicate status-setting RPC.
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_entity;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests;
  a bx1_portal.applications; i bx1_portal.investment_accounts;
  p bx1_portal.legal_entity_parties; m bx1_portal.investing_representative_mandates;
  v bx1_portal.application_detail_versions; doc jsonb; existing_m uuid;
  expected integer; decision text; expiry timestamptz; receipt_id uuid;
  now_at timestamptz; record_id uuid; v_subject uuid; v_summary text;
begin
  if action not in ('create_entity_investment_account',
    'request_investing_representative_mandate',
    'review_investing_representative_mandate',
    'apply_investing_representative_mandate',
    'revoke_investing_representative_mandate') then
    return bx1_portal.execute_scoped_pre_entity(c,action,key,body); end if;
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true
    then raise exception 'entity_route_unavailable' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'entity_invalid_command' using errcode='22023'; end if;
  perform bx1_portal.entry_lock_actor();
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=actor
      and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true
    then raise exception 'entity_context_changed' using errcode='42501'; end if;
  select * into prior from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from action
      or prior.payload is distinct from body then
      raise exception 'entity_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.representative_mandate_requests r where r.actor_id=actor and r.request_key=key) then
    raise exception 'entity_prior_key_conflict' using errcode='23505'; end if;

  if action='create_entity_investment_account' then
    if c<>'{"mode":"APPLICANT"}'::jsonb then
      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;
    perform bx1_portal.require_keys(body,array['application_id']);
    if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'
      or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'entity_application_reference_invalid' using errcode='22023'; end if;
    select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid
      and user_id=actor for share;
    if a.id is not null then perform bx1_portal.lock_entity_people(array[actor,a.reviewer_id]); end if;
    if a.id is null or bx1_portal.entity_application_account_openable(a.id) is not true then
      raise exception 'entity_reviewed_application_required' using errcode='42501'; end if;
    select * into v from bx1_portal.application_detail_versions
      where application_id=a.id and application_revision=a.revision-1
        and capture_kind='SUBMISSION' for share;
    if v.application_id is null then raise exception 'entity_submitted_revision_missing' using errcode='23514'; end if;
    insert into bx1_portal.legal_entity_parties(application_id,admission_revision,submitted_revision,
      legal_name,registration_reference,country,submitted_details_sha256)
      values(a.id,a.revision,v.application_revision,v.details->>'company_name',
        v.details->>'registration_reference',v.details->>'country',
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex'))
      returning * into p;
    insert into bx1_portal.investment_accounts(application_id,kind,entity_party_id)
      values(a.id,'ENTITY',p.id) returning * into i;
    if bx1_portal.entity_account_admission_current(i.id) is not true then
      raise exception 'entity_admission_changed' using errcode='42501'; end if;
    v_subject:=i.id; v_summary:='Reviewed synthetic entity investment account opened. No representative, order, holding, wallet or funding authority granted.';

  elsif action='request_investing_representative_mandate' then
    if c<>'{"mode":"APPLICANT"}'::jsonb then
      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;
    perform bx1_portal.require_keys(body,array['investment_account_id','expected_revision',
      'evidence_reference','appointment_document_id','requested_until']);
    perform bx1_portal.require_text(body,'evidence_reference',20,400);
    if pg_catalog.jsonb_typeof(body->'investment_account_id') is distinct from 'string'
      or body->>'investment_account_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(body->'appointment_document_id') is distinct from 'string'
      or body->>'appointment_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'
      or pg_catalog.jsonb_typeof(body->'requested_until') is distinct from 'string'
      or body->>'requested_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
      raise exception 'entity_mandate_request_invalid' using errcode='22023'; end if;
    begin expiry:=(body->>'requested_until')::timestamptz;
    exception when others then raise exception 'entity_mandate_expiry_invalid' using errcode='22023'; end;
    expected:=(body->>'expected_revision')::integer;
    select * into i from bx1_portal.investment_accounts where id=(body->>'investment_account_id')::uuid
      and kind='ENTITY' for share;
    if i.id is null then raise exception 'entity_account_denied' using errcode='42501'; end if;
    select * into a from bx1_portal.applications where id=i.application_id and user_id=actor for share;
    if a.id is not null then perform bx1_portal.lock_entity_people(array[actor,a.reviewer_id]); end if;
    select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id for share;
    select * into v from bx1_portal.application_detail_versions
      where application_id=a.id and application_revision=p.submitted_revision
        and capture_kind='SUBMISSION' for share;
    -- CHANGES_REQUIRED can revise explanation, expiry, or select another
    -- COMPANY document from this already-approved immutable submission. A
    -- newly uploaded object is deliberately NOT a correction route here.
    select d.item into doc from pg_catalog.jsonb_array_elements(v.details->'documents') d(item)
      where d.item->>'id'=body->>'appointment_document_id' and d.item->>'kind'='COMPANY';
    now_at:=clock_timestamp();
    if a.id is null or p.id is null or v.application_id is null or doc is null
      or bx1_portal.entity_account_admission_current(i.id) is not true
      or expiry<=now_at or expiry>a.approved_until or expiry>now_at+interval '30 days'
      or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
        and o.name=doc->>'storage_path' and o.owner_id=actor::text
        and o.metadata->>'size'=doc->>'size'
        and o.metadata->>'mimetype'=doc->>'mime_type') then
      raise exception 'entity_mandate_evidence_or_admission_denied' using errcode='42501'; end if;
    select * into m from bx1_portal.investing_representative_mandates
      where investment_account_id=i.id and representative_user_id=actor
      order by cycle desc limit 1 for update;
    if m.id is null or m.status='REVOKED'
      or (m.status='APPLIED' and m.requested_until<=now_at) then
      if expected<>0 then raise exception 'entity_mandate_stale_revision' using errcode='23514'; end if;
      insert into bx1_portal.investing_representative_mandates(
        investment_account_id,application_id,entity_party_id,applicant_user_id,
        representative_user_id,reviewer_scope_organisation_id,admission_revision,cycle,
        evidence_reference,appointment_document_id,appointment_document_sha256,
        requested_until,submitted_at)
        values(i.id,a.id,p.id,actor,actor,a.reviewer_scope,a.revision,coalesce(m.cycle,0)+1,
          body->>'evidence_reference',(body->>'appointment_document_id')::uuid,
          doc->>'sha256',expiry,now_at) returning * into m;
    else
      if m.revision<>expected or m.admission_revision<>a.revision
        or (m.status not in ('CHANGES_REQUIRED','REJECTED')
          and not(m.status='APPROVED' and m.requested_until<=now_at)) then
        raise exception 'entity_mandate_stale_or_terminal' using errcode='23514'; end if;
      update bx1_portal.investing_representative_mandates set
        status='SUBMITTED',revision=revision+1,evidence_reference=body->>'evidence_reference',
        appointment_document_id=(body->>'appointment_document_id')::uuid,
        appointment_document_sha256=doc->>'sha256',requested_until=expiry,
        submitted_at=now_at,reviewed_at=null,reviewer_user_id=null,
        review_notes=null,review_checks='{}'::jsonb,approval_receipt_id=null
        where id=m.id returning * into m;
    end if;
    if bx1_portal.investing_mandate_current(m.id) is not true or bx1_portal.fresh_session() is not true then
      raise exception 'entity_mandate_authority_changed' using errcode='42501'; end if;
    v_subject:=m.id; v_summary:='Entity representative appointment requested for account view and later eligibility request only. Transaction limit is zero.';

  else
    if c->>'mode'<>'ROLE' or c->>'role' not in ('ComplianceOfficer','SuperAdmin') then
      raise exception 'entity_staff_context_required' using errcode='42501'; end if;
    if action='review_investing_representative_mandate' then
      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','decision','notes','checks']);
      perform bx1_portal.require_text(body,'notes',20,3000);
      decision:=body->>'decision';
      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then
        raise exception 'entity_mandate_decision_invalid' using errcode='22023'; end if;
      perform bx1_portal.require_checks(body->'checks',array['appointment','legal_entity','scope'],decision='APPROVED');
    elsif action='revoke_investing_representative_mandate' then
      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','reason']);
      perform bx1_portal.require_text(body,'reason',20,1000);
    else
      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision']);
    end if;
    if pg_catalog.jsonb_typeof(body->'mandate_id') is distinct from 'string'
      or body->>'mandate_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'entity_mandate_reference_invalid' using errcode='22023'; end if;
    expected:=(body->>'expected_revision')::integer;
    select * into m from bx1_portal.investing_representative_mandates where id=(body->>'mandate_id')::uuid;
    if m.id is null or c->>'organisationId' is distinct from m.reviewer_scope_organisation_id::text then
      raise exception 'entity_mandate_scope_denied' using errcode='42501'; end if;
    select * into a from bx1_portal.applications where id=m.application_id for share;
    select * into i from bx1_portal.investment_accounts where id=m.investment_account_id for share;
    perform id from auth.users where id=m.representative_user_id for share;
    perform bx1_portal.lock_entity_people(array[actor,m.representative_user_id,m.reviewer_user_id,a.reviewer_id]);
    select * into m from bx1_portal.investing_representative_mandates where id=m.id for update;
    if m.revision<>expected or a.id<>m.application_id or i.id<>m.investment_account_id
      or not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role') then
      raise exception 'entity_mandate_staff_or_revision_denied' using errcode='42501'; end if;
    now_at:=clock_timestamp();
    if action='review_investing_representative_mandate' then
      if c->>'role'<>'ComplianceOfficer' or m.status<>'SUBMITTED'
        or not bx1_portal.entity_people_independent(actor,m.representative_user_id)
        or not bx1_portal.investing_mandate_current(m.id) then
        raise exception 'entity_mandate_review_denied' using errcode='42501'; end if;
      -- The reviewer must inspect the exact immutable application document.
      -- Its SHA-256 is an applicant claim until an independent byte check is
      -- recorded; these checks are a manual synthetic decision, not provider
      -- verification or automatic approval.
      receipt_id:=pg_catalog.gen_random_uuid();
      insert into bx1_portal.investing_representative_receipts(
        id,mandate_id,mandate_revision,action,actor_id,operating_context,
        command_payload,admission_revision,status_after)
        values(receipt_id,m.id,m.revision+1,action,actor,c,body,m.admission_revision,decision);
      update bx1_portal.investing_representative_mandates set status=decision,revision=revision+1,
        reviewed_at=now_at,reviewer_user_id=actor,review_notes=body->>'notes',
        review_checks=body->'checks',approval_receipt_id=case when decision='APPROVED' then receipt_id else null end
        where id=m.id returning * into m;
      v_summary:='Independent synthetic review of exact entity representative appointment: '||decision||'. No trading granted.';
    elsif action='apply_investing_representative_mandate' then
      if c->>'role'<>'SuperAdmin' or m.status<>'APPROVED' or m.approval_receipt_id is null
        or not bx1_portal.investing_mandate_current(m.id)
        or not bx1_portal.entity_people_independent(actor,m.representative_user_id)
        or not bx1_portal.entity_people_independent(actor,m.reviewer_user_id) then
        raise exception 'entity_mandate_apply_denied' using errcode='42501'; end if;
      update bx1_portal.investing_representative_mandates set status='APPLIED',revision=revision+1,
        applied_at=now_at,applied_by_user_id=actor where id=m.id returning * into m;
      if bx1_portal.investing_mandate_effective(m.id) is not true then
        raise exception 'entity_mandate_effective_check_failed' using errcode='42501'; end if;
      insert into bx1_portal.investing_representative_receipts(
        mandate_id,mandate_revision,action,actor_id,operating_context,
        command_payload,admission_revision,status_after)
        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);
      v_summary:='Separately approved entity representative mandate applied: account view and future eligibility request; zero transaction limit.';
    else
      if m.status<>'APPLIED' or not bx1_portal.entity_people_independent(actor,m.representative_user_id) then
        raise exception 'entity_mandate_revoke_denied' using errcode='42501'; end if;
      update bx1_portal.investing_representative_mandates set status='REVOKED',revision=revision+1,
        revoked_at=now_at,revoked_by_user_id=actor,revoke_reason=body->>'reason'
        where id=m.id returning * into m;
      if bx1_portal.investing_mandate_effective(m.id) then
        raise exception 'entity_mandate_revoke_failed' using errcode='23514'; end if;
      insert into bx1_portal.investing_representative_receipts(
        mandate_id,mandate_revision,action,actor_id,operating_context,
        command_payload,admission_revision,status_after)
        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);
      v_summary:='Entity representative mandate revoked; account view and eligibility-request scope ended.';
    end if;
    if not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role')
      or not bx1_portal.entity_people_independent(actor,m.representative_user_id) then
      raise exception 'entity_mandate_staff_authority_changed' using errcode='42501'; end if;
    v_subject:=m.id;
  end if;
  if action='request_investing_representative_mandate' then
    insert into bx1_portal.investing_representative_receipts(
      mandate_id,mandate_revision,action,actor_id,operating_context,
      command_payload,admission_revision,status_after)
      values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);
  end if;
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'entity_authority_changed' using errcode='42501'; end if;
  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)
    values(v_subject,a.id,action,actor,v_summary) returning id into record_id;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end $$;

create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;

revoke all on function bx1_portal.guard_entity_account_insert(),
  bx1_portal.guard_investing_representative_mandate(),
  bx1_portal.entity_people_independent(uuid,uuid),
  bx1_portal.lock_entity_people(uuid[]),
  bx1_portal.entity_application_account_openable(uuid),
  bx1_portal.entity_account_admission_current(uuid),
  bx1_portal.investing_mandate_current(uuid),bx1_portal.investing_mandate_effective(uuid),
  bx1_portal.entity_account_projection(jsonb,uuid),bx1_portal.investing_mandate_projection(jsonb,uuid),
  bx1_portal.read_scoped_pre_entity(jsonb),bx1_portal.execute_scoped_pre_entity(jsonb,text,uuid,jsonb),
  bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
do $entity_grants$ begin
  -- Grant once for TEST configuration, even if admission is temporarily paused.
  -- Every read/write still checks fresh session, scope and current admission.
  if exists(select 1 from bx1_portal.entry_configuration cfg
    where cfg.singleton and cfg.environment='TESTNET') then
    execute 'grant execute on function bx1_portal.read_scoped(jsonb), bx1_portal.execute_scoped(jsonb,text,uuid,jsonb), public.bx1_portal_read_scoped(jsonb), public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated';
  end if;
end $entity_grants$;
