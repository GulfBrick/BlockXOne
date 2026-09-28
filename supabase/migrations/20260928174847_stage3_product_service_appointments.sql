-- TEST-only synthetic product service appointments. Existing native roles and
-- organisation bindings are prerequisites, never product-level authority.
-- MAIN receives the identical schema but its command grant remains sealed.
do $baseline$ begin
  if pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.offering_approved(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entity_people_independent(uuid,uuid)') is null
    or pg_catalog.to_regclass('bx1_portal.offering_decisions') is null then
    raise exception 'stage3_offering_appointments_baseline_required' using errcode='55000';
  end if;
end $baseline$;

-- Appointments are time-limited, revocable service authority for an enduring
-- product. The terms hash at request is an audit reference, not a gate that
-- could be revived by change-then-revert. Every offering decision remains
-- bound to one immutable revision, terms hash and document hashes instead.

create table bx1_portal.product_service_appointments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  product_organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  reviewer_scope_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  role text not null check(role in ('IssuerFundManager','ComplianceOfficer')),
  appointee_user_id uuid not null references auth.users(id) on delete restrict,
  native_membership_id uuid not null references public.bx1_memberships(id) on delete restrict,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  requested_in_context jsonb not null check(pg_catalog.jsonb_typeof(requested_in_context)='object'),
  product_revision_at_request integer not null check(product_revision_at_request>0),
  terms_hash_at_request text not null check(terms_hash_at_request ~ '^[0-9a-f]{64}$'),
  evidence_reference text not null check(char_length(evidence_reference) between 20 and 400
    and evidence_reference=pg_catalog.btrim(evidence_reference)),
  requested_until timestamptz not null check(pg_catalog.isfinite(requested_until)),
  status text not null default 'SUBMITTED' check(status in
    ('SUBMITTED','APPROVED','CHANGES_REQUIRED','REJECTED','APPLIED','REVOKED')),
  revision integer not null default 1 check(revision>0),
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  reviewed_at timestamptz, reviewed_by_user_id uuid references auth.users(id) on delete restrict,
  review_notes text, review_checks jsonb not null default '{}'::jsonb,
  approval_receipt_id uuid unique,
  applied_at timestamptz, applied_by_user_id uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz, revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revoke_reason text,
  provider_mode text not null default 'SYNTHETIC_TEST' check(provider_mode='SYNTHETIC_TEST'),
  check(requested_by_user_id<>appointee_user_id),
  check(reviewed_by_user_id is null or reviewed_by_user_id<>requested_by_user_id),
  check(reviewed_by_user_id is null or reviewed_by_user_id<>appointee_user_id),
  check(applied_by_user_id is null or applied_by_user_id not in
    (requested_by_user_id,appointee_user_id,reviewed_by_user_id)),
  check(status not in ('APPROVED','APPLIED','REVOKED')
    or (reviewed_by_user_id is not null and approval_receipt_id is not null)),
  check((status in ('APPLIED','REVOKED'))=(applied_at is not null and applied_by_user_id is not null)),
  check((status='REVOKED')=(revoked_at is not null and revoked_by_user_id is not null))
);
create unique index bx1_product_appointment_one_open on bx1_portal.product_service_appointments(product_id,role)
  where status in ('SUBMITTED','APPROVED','APPLIED');
create index bx1_product_appointment_queue on bx1_portal.product_service_appointments
  (reviewer_scope_organisation_id,status,requested_at,id);
create index bx1_product_appointment_actor on bx1_portal.product_service_appointments
  (appointee_user_id,role,status,product_id);

create table bx1_portal.product_service_appointment_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  appointment_id uuid not null references bx1_portal.product_service_appointments(id) on delete restrict,
  appointment_revision integer not null check(appointment_revision>0),
  action text not null check(action in ('request_product_service_appointment',
    'review_product_service_appointment','apply_product_service_appointment','revoke_product_service_appointment')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  command_payload jsonb not null check(pg_catalog.jsonb_typeof(command_payload)='object'),
  status_after text not null check(status_after in
    ('SUBMITTED','APPROVED','CHANGES_REQUIRED','REJECTED','APPLIED','REVOKED')),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(appointment_id,appointment_revision)
);
alter table bx1_portal.product_service_appointments add constraint bx1_product_appointment_approval_receipt
  foreign key(approval_receipt_id) references bx1_portal.product_service_appointment_receipts(id) on delete restrict;
create table bx1_portal.product_service_appointment_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_key uuid not null,
  command text not null check(command in ('request_product_service_appointment',
    'review_product_service_appointment','apply_product_service_appointment','revoke_product_service_appointment')),
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  payload jsonb not null check(pg_catalog.jsonb_typeof(payload)='object'),
  appointment_id uuid not null references bx1_portal.product_service_appointments(id) on delete restrict,
  receipt_id uuid not null references bx1_portal.product_service_appointment_receipts(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(actor_id,request_key)
);
alter table bx1_portal.product_service_appointments enable row level security;
alter table bx1_portal.product_service_appointment_receipts enable row level security;
alter table bx1_portal.product_service_appointment_requests enable row level security;
revoke all on bx1_portal.product_service_appointments,
  bx1_portal.product_service_appointment_receipts,
  bx1_portal.product_service_appointment_requests from public,anon,authenticated,service_role;
create trigger bx1_product_appointment_receipt_immutable before update or delete
  on bx1_portal.product_service_appointment_receipts for each row execute function bx1_portal.immutable_record();
create trigger bx1_product_appointment_request_immutable before update or delete
  on bx1_portal.product_service_appointment_requests for each row execute function bx1_portal.immutable_record();

create function bx1_portal.guard_product_service_appointment() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'product_appointment_history_immutable' using errcode='23514'; end if;
  if row(new.id,new.product_id,new.product_organisation_id,new.reviewer_scope_organisation_id,
      new.role,new.appointee_user_id,new.native_membership_id,
      new.requested_by_user_id,new.requested_in_context,new.product_revision_at_request,
      new.terms_hash_at_request,new.evidence_reference,new.requested_until,new.requested_at,
      new.provider_mode) is distinct from
    row(old.id,old.product_id,old.product_organisation_id,old.reviewer_scope_organisation_id,
      old.role,old.appointee_user_id,old.native_membership_id,
      old.requested_by_user_id,old.requested_in_context,old.product_revision_at_request,
      old.terms_hash_at_request,old.evidence_reference,old.requested_until,old.requested_at,
      old.provider_mode)
    or new.revision<>old.revision+1
    or not ((old.status='SUBMITTED' and new.status in ('APPROVED','CHANGES_REQUIRED','REJECTED'))
      or (old.status='APPROVED' and new.status='APPLIED')
      or (old.status='APPLIED' and new.status='REVOKED')) then
    raise exception 'product_appointment_invalid_transition' using errcode='23514';
  end if;
  return new;
end $$;
create trigger bx1_product_appointment_transition before update or delete
  on bx1_portal.product_service_appointments for each row execute function bx1_portal.guard_product_service_appointment();

create function bx1_portal.product_appointment_effective(target_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_service_appointments a
    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id
      and o.reviewer_scope=a.reviewer_scope_organisation_id
    join public.bx1_memberships m on m.id=a.native_membership_id
      and m.user_id=a.appointee_user_id and m.role=a.role
      and m.organisation_id=a.reviewer_scope_organisation_id
    join public.bx1_profiles profile on profile.id=a.appointee_user_id
      and profile.status='ACTIVE'
    join bx1_portal.entry_configuration cfg on cfg.singleton
      and cfg.environment='TESTNET' and cfg.manual_test_review
      and cfg.reviewer_scope=a.reviewer_scope_organisation_id
    where a.id=target_id and a.status='APPLIED' and a.approval_receipt_id is not null
      and a.requested_until>pg_catalog.clock_timestamp()
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.entity_people_independent(a.requested_by_user_id,a.appointee_user_id)
      and bx1_portal.entity_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)
      and bx1_portal.entity_people_independent(a.requested_by_user_id,a.applied_by_user_id)
      and bx1_portal.entity_people_independent(a.appointee_user_id,a.reviewed_by_user_id)
      and bx1_portal.entity_people_independent(a.appointee_user_id,a.applied_by_user_id)
      and bx1_portal.entity_people_independent(a.reviewed_by_user_id,a.applied_by_user_id));
$$;
create function bx1_portal.product_appointment_authorised(c jsonb,target_product uuid,target_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.valid_operating_context(c) and c->>'mode'='ROLE' and c->>'role'=target_role
    and auth.jwt()->>'aal'='aal2' and bx1_private.has_session_mfa() and bx1_private.has_token_mfa()
    and exists(select 1 from bx1_portal.product_service_appointments a
      join public.bx1_memberships m on m.id=a.native_membership_id
      where a.product_id=target_product and a.role=target_role
        and a.appointee_user_id=auth.uid() and m.organisation_id=(c->>'organisationId')::uuid
        and bx1_portal.product_appointment_effective(a.id));
$$;

create function bx1_portal.product_appointment_projection(c jsonb,target_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.product_service_appointments;
  is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean;
begin
  if bx1_portal.valid_operating_context(c) is not true then return null; end if;
  select * into a from bx1_portal.product_service_appointments where id=target_id;
  if a.id is null then return null; end if;
  is_manager:=a.requested_by_user_id=auth.uid() and c=a.requested_in_context
    and bx1_portal.scoped_operator(c,a.product_organisation_id);
  is_reviewer:=c->>'role'='ComplianceOfficer' and
    bx1_portal.representative_mandate_actor(c,a.reviewer_scope_organisation_id,'ComplianceOfficer');
  is_admin:=c->>'role'='SuperAdmin' and
    bx1_portal.representative_mandate_actor(c,a.reviewer_scope_organisation_id,'SuperAdmin');
  is_appointee:=a.appointee_user_id=auth.uid() and c->>'mode'='ROLE' and c->>'role'=a.role
    and c->>'organisationId'=(select m.organisation_id::text from public.bx1_memberships m
      where m.id=a.native_membership_id);
  if not(is_manager or is_reviewer or is_admin or is_appointee) then return null; end if;
  return pg_catalog.jsonb_build_object(
    'id',a.id,'product_id',a.product_id,'product_organisation_id',a.product_organisation_id,
    'reviewer_scope_organisation_id',a.reviewer_scope_organisation_id,
    'role',a.role,'appointee_user_id',a.appointee_user_id,
    'native_membership_id',a.native_membership_id,
    'requested_by_user_id',a.requested_by_user_id,
    'product_revision_at_request',a.product_revision_at_request,
    'terms_hash_at_request',a.terms_hash_at_request,'evidence_reference',a.evidence_reference,
    'requested_until',a.requested_until,'status',a.status,'revision',a.revision,
    'requested_at',a.requested_at,'reviewed_at',a.reviewed_at,
    'reviewed_by_user_id',a.reviewed_by_user_id,'review_notes',a.review_notes,
    'approval_receipt_id',a.approval_receipt_id,'applied_at',a.applied_at,
    'applied_by_user_id',a.applied_by_user_id,'revoked_at',a.revoked_at,
    'revoke_reason',a.revoke_reason,'effective',bx1_portal.product_appointment_effective(a.id),
    'next_owner',case when a.status='SUBMITTED' then 'COMPLIANCE'
      when a.status='APPROVED' then 'SUPER_ADMIN'
      when a.status in ('CHANGES_REQUIRED','REJECTED') then 'OFFERING_MANAGER'
      else 'NONE' end,
    'can_review',is_reviewer and a.status='SUBMITTED'
      and bx1_portal.entity_people_independent(auth.uid(),a.requested_by_user_id)
      and bx1_portal.entity_people_independent(auth.uid(),a.appointee_user_id),
    'can_apply',is_admin and a.status='APPROVED'
      and bx1_portal.entity_people_independent(auth.uid(),a.requested_by_user_id)
      and bx1_portal.entity_people_independent(auth.uid(),a.reviewed_by_user_id)
      and bx1_portal.entity_people_independent(auth.uid(),a.appointee_user_id),
    'can_revoke',is_admin and a.status='APPLIED'
      and bx1_portal.entity_people_independent(auth.uid(),a.appointee_user_id));
end $$;

create function bx1_portal.execute_product_service_appointment(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a bx1_portal.product_service_appointments;
  p bx1_portal.products; o bx1_portal.organisations;
  m public.bx1_memberships;
  previous bx1_portal.product_service_appointment_requests;
  receipt_id uuid; decision text; requested_until timestamptz; target_product uuid;
begin
  if bx1_portal.entry_manual_review_enabled() is not true
    or bx1_portal.valid_operating_context(c) is not true
    or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>8192 then
    raise exception 'product_appointment_unavailable' using errcode='42501';
  end if;
  perform bx1_portal.entry_lock_actor();
  select * into previous from bx1_portal.product_service_appointment_requests
    where actor_id=actor and request_key=key;
  if previous.actor_id is not null then
    if previous.command is distinct from action or previous.operating_context is distinct from c
      or previous.payload is distinct from body then
      raise exception 'product_appointment_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.scoped_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key) then
    raise exception 'product_appointment_prior_key_conflict' using errcode='23505'; end if;

  if action='request_product_service_appointment' then
    perform bx1_portal.require_keys(body,array['product_id','role','appointee_user_id',
      'native_membership_id','expected_product_revision',
      'evidence_reference','requested_until']);
    perform bx1_portal.require_text(body,'evidence_reference',20,400);
    if body->>'role' not in ('IssuerFundManager','ComplianceOfficer')
      or pg_catalog.jsonb_typeof(body->'expected_product_revision') is distinct from 'number'
      or body->>'expected_product_revision' !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'product_appointment_request_invalid' using errcode='22023'; end if;
    requested_until:=(body->>'requested_until')::timestamptz;
    if requested_until<=pg_catalog.clock_timestamp()+interval '1 hour'
      or requested_until>pg_catalog.clock_timestamp()+interval '90 days' then
      raise exception 'product_appointment_expiry_invalid' using errcode='22023'; end if;
    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;
    if p.id is null or p.revision<>(body->>'expected_product_revision')::integer
      or c->>'mode'<>'ROLE' or c->>'role'<>'OfferingManager'
      or bx1_portal.scoped_operator(c,p.organisation_id) is not true then
      raise exception 'product_appointment_product_denied' using errcode='42501'; end if;
    select * into o from bx1_portal.organisations where id=p.organisation_id for share;
    select * into m from public.bx1_memberships where id=(body->>'native_membership_id')::uuid for share;
    perform bx1_portal.lock_entity_people(array[actor,(body->>'appointee_user_id')::uuid]);
    if m.id is null or m.user_id<>(body->>'appointee_user_id')::uuid
      or m.role<>body->>'role' or bx1_portal.native_membership_effective(m.id) is not true
      or not exists(select 1 from public.bx1_profiles profile
        where profile.id=m.user_id and profile.status='ACTIVE')
      or m.organisation_id<>o.reviewer_scope
      or bx1_portal.entity_people_independent(actor,m.user_id) is not true
      or bx1_portal.current_product_organisation(o.id) is not true then
      raise exception 'product_appointment_target_denied' using errcode='42501'; end if;
    insert into bx1_portal.product_service_appointments(product_id,product_organisation_id,
      reviewer_scope_organisation_id,role,appointee_user_id,native_membership_id,
      requested_by_user_id,requested_in_context,
      product_revision_at_request,terms_hash_at_request,evidence_reference,requested_until)
      values(p.id,p.organisation_id,o.reviewer_scope,body->>'role',m.user_id,m.id,
        actor,c,p.revision,p.terms_hash,body->>'evidence_reference',requested_until)
      returning * into a;
  else
    if action='review_product_service_appointment' then
      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision',
        'decision','notes','checks']);
      perform bx1_portal.require_text(body,'notes',20,3000);
      decision:=body->>'decision';
      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then
        raise exception 'product_appointment_decision_invalid' using errcode='22023'; end if;
      perform bx1_portal.require_checks(body->'checks',array['appointment','evidence','scope'],
        decision='APPROVED');
    elsif action='apply_product_service_appointment' then
      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision']);
    elsif action='revoke_product_service_appointment' then
      perform bx1_portal.require_keys(body,array['appointment_id','expected_revision','reason']);
      perform bx1_portal.require_text(body,'reason',20,1000);
    else
      raise exception 'product_appointment_command_unknown' using errcode='22023'; end if;
    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'product_appointment_revision_invalid' using errcode='22023'; end if;
    -- The offering-decision writer locks the product before the appointment.
    -- Use the same order for review/apply/revoke to avoid inverse-lock cycles.
    select product_id into target_product from bx1_portal.product_service_appointments
      where id=(body->>'appointment_id')::uuid;
    if target_product is null then
      raise exception 'product_appointment_stale' using errcode='23514'; end if;
    select * into p from bx1_portal.products where id=target_product for update;
    select * into a from bx1_portal.product_service_appointments
      where id=(body->>'appointment_id')::uuid for update;
    if a.id is null or a.revision<>(body->>'expected_revision')::integer then
      raise exception 'product_appointment_stale' using errcode='23514'; end if;
    if p.id is distinct from a.product_id then
      raise exception 'product_appointment_stale' using errcode='23514'; end if;
    select * into o from bx1_portal.organisations where id=a.product_organisation_id for share;
    select * into m from public.bx1_memberships where id=a.native_membership_id for share;
    perform bx1_portal.lock_entity_people(array[actor,a.requested_by_user_id,
      a.appointee_user_id,a.reviewed_by_user_id]);
    if action='review_product_service_appointment' then
      if a.status<>'SUBMITTED'
        or a.requested_until<=pg_catalog.clock_timestamp()
        or bx1_portal.representative_mandate_actor(c,a.reviewer_scope_organisation_id,'ComplianceOfficer') is not true
        or bx1_portal.entity_people_independent(actor,a.requested_by_user_id) is not true
        or bx1_portal.entity_people_independent(actor,a.appointee_user_id) is not true then
        raise exception 'product_appointment_review_denied' using errcode='42501'; end if;
      if decision='APPROVED' and (m.organisation_id<>a.reviewer_scope_organisation_id
        or bx1_portal.native_membership_effective(m.id) is not true
        or not exists(select 1 from public.bx1_profiles profile
          where profile.id=m.user_id and profile.status='ACTIVE')) then
        raise exception 'product_appointment_target_changed' using errcode='42501'; end if;
    elsif action='apply_product_service_appointment' then
      if a.status<>'APPROVED' or a.approval_receipt_id is null
        or a.requested_until<=pg_catalog.clock_timestamp()
        or m.organisation_id<>a.reviewer_scope_organisation_id
        or bx1_portal.native_membership_effective(m.id) is not true
        or not exists(select 1 from public.bx1_profiles profile
          where profile.id=m.user_id and profile.status='ACTIVE')
        or bx1_portal.representative_mandate_actor(c,a.reviewer_scope_organisation_id,'SuperAdmin') is not true
        or bx1_portal.entity_people_independent(actor,a.requested_by_user_id) is not true
        or bx1_portal.entity_people_independent(actor,a.appointee_user_id) is not true
        or bx1_portal.entity_people_independent(actor,a.reviewed_by_user_id) is not true then
        raise exception 'product_appointment_apply_denied' using errcode='42501'; end if;
    elsif action='revoke_product_service_appointment' then
      if a.status<>'APPLIED'
        or bx1_portal.representative_mandate_actor(c,a.reviewer_scope_organisation_id,'SuperAdmin') is not true
        or bx1_portal.entity_people_independent(actor,a.appointee_user_id) is not true then
        raise exception 'product_appointment_revoke_denied' using errcode='42501'; end if;
    end if;
    if action='review_product_service_appointment' then
      insert into bx1_portal.product_service_appointment_receipts(appointment_id,appointment_revision,
        action,actor_id,operating_context,command_payload,status_after)
        values(a.id,a.revision+1,action,actor,c,body,decision) returning id into receipt_id;
      update bx1_portal.product_service_appointments set revision=revision+1,status=decision,
        reviewed_at=pg_catalog.clock_timestamp(),reviewed_by_user_id=actor,
        review_notes=body->>'notes',review_checks=body->'checks',
        approval_receipt_id=case when decision='APPROVED' then receipt_id else null end
        where id=a.id returning * into a;
    elsif action='apply_product_service_appointment' then
      update bx1_portal.product_service_appointments set revision=revision+1,
        status='APPLIED',applied_at=pg_catalog.clock_timestamp(),applied_by_user_id=actor
        where id=a.id returning * into a;
    elsif action='revoke_product_service_appointment' then
      update bx1_portal.product_service_appointments set revision=revision+1,
        status='REVOKED',revoked_at=pg_catalog.clock_timestamp(),
        revoked_by_user_id=actor,revoke_reason=body->>'reason'
        where id=a.id returning * into a;
    end if;
  end if;
  if receipt_id is null then
    insert into bx1_portal.product_service_appointment_receipts(appointment_id,appointment_revision,
      action,actor_id,operating_context,command_payload,status_after)
      values(a.id,a.revision,action,actor,c,body,a.status) returning id into receipt_id;
  end if;
  insert into bx1_portal.product_service_appointment_requests(actor_id,request_key,
    command,operating_context,payload,appointment_id,receipt_id)
    values(actor,key,action,c,body,a.id,receipt_id);
  insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
    values(a.id,a.product_organisation_id,action,actor,
      'Synthetic TEST product service appointment '||a.role||' '||a.status||
      '. No signing, funding or publication authority.');
  if bx1_portal.valid_operating_context(c) is not true
    or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'product_appointment_context_changed' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;

-- Every new offering decision captures the exact appointment that enabled it.
-- Historical decisions retain null and consequently cannot become newly
-- approved by this migration. This trigger is an independent DB backstop to
-- the command boundary, including privileged or legacy internal writers.
alter table bx1_portal.offering_decisions add column product_appointment_id uuid
  references bx1_portal.product_service_appointments(id) on delete restrict;
create function bx1_portal.guard_offering_decision_appointment() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_product uuid; target_role text; candidate uuid;
begin
  select r.product_id into target_product from bx1_portal.offering_revisions r
    where r.id=new.offering_revision_id;
  target_role:=case new.decision_kind when 'ISSUER' then 'IssuerFundManager'
    when 'COMPLIANCE' then 'ComplianceOfficer' end;
  if new.actor_id is distinct from auth.uid() or target_product is null
    or target_role is null then
    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;
  select a.id into candidate from bx1_portal.product_service_appointments a
    where a.product_id=target_product and a.role=target_role
      and a.appointee_user_id=new.actor_id and a.status='APPLIED'
    order by a.id limit 1 for share;
  if candidate is null or bx1_portal.product_appointment_authorised(
      new.operating_context,target_product,target_role) is not true
    or bx1_portal.product_appointment_effective(candidate) is not true then
    raise exception 'offering_product_appointment_required' using errcode='42501'; end if;
  new.product_appointment_id:=candidate;
  return new;
end $$;
create trigger bx1_offering_decision_product_appointment before insert on bx1_portal.offering_decisions
  for each row execute function bx1_portal.guard_offering_decision_appointment();

create or replace function bx1_portal.offering_issuer_authorised(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
    join public.bx1_memberships m on m.user_id=auth.uid()
      and m.organisation_id=(c->>'organisationId')::uuid and m.role='IssuerFundManager'
    where p.id=target_product and bx1_portal.offering_issuer_session_assured(c)
      and bx1_portal.product_appointment_authorised(c,p.id,'IssuerFundManager')
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.entity_people_independent(auth.uid(),p.created_by)
      and bx1_portal.entity_people_independent(auth.uid(),o.owner_id)
      and bx1_portal.entity_people_independent(auth.uid(),r.submitted_by)
      and bx1_portal.current_product_organisation(o.id)
      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash
      and not exists(select 1 from bx1_portal.offering_decisions d
        where d.offering_revision_id=r.id and d.decision_kind='ISSUER'));
$$;

create or replace function bx1_portal.offering_issuer_scope(c jsonb,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.offering_issuer_session_assured(c)
    and exists(select 1 from bx1_portal.products p
      where p.organisation_id=target_org
        and bx1_portal.product_appointment_authorised(c,p.id,'IssuerFundManager'));
$$;

create or replace function bx1_portal.scoped_product_visible(c jsonb,target_product uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; o bx1_portal.organisations;
begin
  if bx1_portal.valid_operating_context(c) is not true then return false; end if;
  select * into p from bx1_portal.products where id=target_product;
  if p.id is null then return false; end if;
  select * into o from bx1_portal.organisations where id=p.organisation_id;
  if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' then
    return bx1_portal.product_appointment_authorised(c,p.id,'IssuerFundManager'); end if;
  return bx1_portal.scoped_operator(c,o.id)
    or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
    or bx1_portal.product_appointment_authorised(c,p.id,'IssuerFundManager')
    or bx1_portal.product_appointment_authorised(c,p.id,'ComplianceOfficer')
    or ((c->>'mode'='APPLICANT' or c->>'role'='Investor') and p.status='PUBLISHED'
      and bx1_portal.offering_operational(p.id)
      and bx1_portal.current_product_organisation(o.id) and bx1_portal.is_eligible(p.terms));
end $$;

create or replace function bx1_portal.offering_approved(target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'
      and cfg.manual_test_review
    join bx1_portal.offering_decisions issuer on issuer.offering_revision_id=r.id
      and issuer.decision_kind='ISSUER' and issuer.decision='APPROVED'
      and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes
    join bx1_portal.product_service_appointments ia on ia.id=issuer.product_appointment_id
      and ia.product_id=p.id and ia.appointee_user_id=issuer.actor_id
      and ia.role='IssuerFundManager'
    join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id
      and compliance.decision_kind='COMPLIANCE' and compliance.decision='APPROVED'
      and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes
    join bx1_portal.product_service_appointments ca on ca.id=compliance.product_appointment_id
      and ca.product_id=p.id and ca.appointee_user_id=compliance.actor_id
      and ca.role='ComplianceOfficer'
    where p.id=target_product and issuer.actor_id<>compliance.actor_id
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.product_appointment_effective(ia.id)
      and bx1_portal.product_appointment_effective(ca.id)
      and bx1_portal.entity_people_independent(issuer.actor_id,compliance.actor_id)
      and bx1_portal.entity_people_independent(issuer.actor_id,r.submitted_by)
      and bx1_portal.entity_people_independent(compliance.actor_id,r.submitted_by));
$$;

alter function bx1_portal.offering_package_projection(jsonb,uuid)
  rename to offering_package_projection_pre_appointment;
create function bx1_portal.offering_package_projection(c jsonb,target_product uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; p bx1_portal.products; r bx1_portal.offering_revisions;
  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;
  appointed boolean; can_review boolean;
begin
  result:=bx1_portal.offering_package_projection_pre_appointment(c,target_product);
  if result is null then return null; end if;
  select * into p from bx1_portal.products where id=target_product;
  select * into r from bx1_portal.offering_revisions
    where id=p.current_offering_revision_id and product_id=p.id;
  select * into issuer from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='ISSUER';
  select * into compliance from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='COMPLIANCE';
  appointed:=bx1_portal.product_appointment_authorised(c,p.id,'ComplianceOfficer');
  can_review:=appointed and p.status='IN_REVIEW' and compliance.id is null
    and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms
    and bx1_portal.entity_people_independent(auth.uid(),r.submitted_by)
    and bx1_portal.entity_people_independent(auth.uid(),p.created_by)
    and bx1_portal.entity_people_independent(auth.uid(),
      (select o.owner_id from bx1_portal.organisations o where o.id=p.organisation_id))
    and (issuer.id is null or bx1_portal.entity_people_independent(auth.uid(),issuer.actor_id));
  result:=pg_catalog.jsonb_set(result,'{can_review_compliance}',pg_catalog.to_jsonb(can_review));
  if appointed then
    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}',
      coalesce(pg_catalog.to_jsonb(issuer.notes),'null'::jsonb));
    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}',
      coalesce(pg_catalog.to_jsonb(issuer.checks),'null'::jsonb));
  elsif bx1_portal.scoped_operator(c,p.organisation_id) is not true then
    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}','null'::jsonb);
    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}','null'::jsonb);
  end if;
  return result;
end $$;

-- The inherited scoped review writer requires an organisation-wide
-- Compliance binding twice. It must not be loosened globally: customer KYC,
-- documents and other products still use that organisation scope. Route only
-- the offering decision for this exact appointed product through the guarded
-- base transition, then record the immutable, appointment-bound decision.
create function bx1_portal.execute_appointed_compliance_decision(c jsonb,key uuid,body jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;
  r bx1_portal.offering_revisions; issuer bx1_portal.offering_decisions;
  a bx1_portal.product_service_appointments; prior bx1_portal.scoped_requests;
  decision text; original_revision integer;
begin
  if bx1_portal.entry_manual_review_enabled() is not true
    or bx1_portal.valid_operating_context(c) is not true
    or key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  select * into prior from bx1_portal.scoped_requests
    where actor_id=actor and request_key=key;
  if prior.actor_id is not null then
    if prior.command is distinct from 'review_product'
      or prior.operating_context is distinct from c or prior.payload is distinct from body then
      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.product_service_appointment_requests
      where actor_id=actor and request_key=key) then
    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;
  perform bx1_portal.require_keys(body,array['product_id','expected_revision',
    'offering_revision_id','terms_hash','decision','notes','checks']);
  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;
  if p.id is null then
    raise exception 'offering_product_denied' using errcode='42501'; end if;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  select * into r from bx1_portal.offering_revisions
    where id=p.current_offering_revision_id and product_id=p.id;
  if o.id is null or r.id is null or r.origin<>'SUBMITTED' or p.status<>'IN_REVIEW'
    or r.terms_hash is distinct from p.terms_hash or r.terms is distinct from p.terms
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'
    or (body->>'expected_revision')::integer<>p.revision
    or body->>'offering_revision_id' is distinct from r.id::text
    or body->>'terms_hash' is distinct from r.terms_hash then
    raise exception 'offering_stale_package' using errcode='23514'; end if;
  perform bx1_portal.require_text(body,'notes',20,3000);
  decision:=body->>'decision';
  if decision not in ('APPROVED','CHANGES_REQUIRED') then
    raise exception 'offering_decision_invalid' using errcode='22023'; end if;
  original_revision:=p.revision;
  select * into issuer from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='ISSUER';
  if exists(select 1 from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='COMPLIANCE') then
    raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;
  select * into a from bx1_portal.product_service_appointments appointed
    where appointed.product_id=p.id and appointed.role='ComplianceOfficer'
      and appointed.appointee_user_id=actor and appointed.status='APPLIED'
    order by appointed.id limit 1 for share;
  if a.id is null then
    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;
  perform m.id from public.bx1_memberships m where m.id=a.native_membership_id for share;
  perform profile.id from public.bx1_profiles profile where profile.id=actor for share;
  perform bx1_portal.lock_entity_people(array[actor,r.submitted_by,o.owner_id,issuer.actor_id]);
  if bx1_portal.product_appointment_authorised(c,p.id,'ComplianceOfficer') is not true
    or bx1_portal.current_product_organisation(o.id) is not true
    or bx1_portal.entity_people_independent(actor,r.submitted_by) is not true
    or bx1_portal.entity_people_independent(actor,p.created_by) is not true
    or bx1_portal.entity_people_independent(actor,o.owner_id) is not true
    or (issuer.id is not null and
      bx1_portal.entity_people_independent(actor,issuer.actor_id) is not true) then
    raise exception 'offering_compliance_appointment_required' using errcode='42501'; end if;
  -- The base transition preserves revision/state/check validation and its
  -- product/request/event audit path. Its reviewer predicate checks the
  -- native Compliance scope, not a customer-wide authority binding.
  perform bx1_portal.execute_command('review_product',key,
    body-'offering_revision_id'-'terms_hash');
  insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,
    actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)
    values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,
      original_revision,body->>'notes',body->'checks');
  if decision='APPROVED' and coalesce(issuer.decision,'PENDING')<>'APPROVED' then
    update bx1_portal.products set status='IN_REVIEW' where id=p.id;
  end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,'review_product',body);
  if bx1_portal.valid_operating_context(c) is not true
    or bx1_portal.product_appointment_authorised(c,p.id,'ComplianceOfficer') is not true then
    raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;

alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_product_appointment;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_product_appointment;

create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; appointments jsonb; candidates jsonb; item jsonb;
  products jsonb:='[]'::jsonb; actions jsonb; package jsonb;
begin
  result:=bx1_portal.read_scoped_pre_product_appointment(c);
  select coalesce(pg_catalog.jsonb_agg(projected.value order by a.requested_at,a.id),'[]'::jsonb)
    into appointments from bx1_portal.product_service_appointments a
      cross join lateral (select bx1_portal.product_appointment_projection(c,a.id) as value) projected
    where projected.value is not null;
  result:=pg_catalog.jsonb_set(result,'{product_appointments}',appointments);
  -- Candidate directory is limited to two role types in the product's
  -- reviewer-scope organisation and only to products this manager may edit.
  -- No global staff directory or cross-customer nomination is exposed.
  select coalesce(pg_catalog.jsonb_agg(candidate.value order by candidate.product_id,
      candidate.role,candidate.display_name,candidate.user_id),'[]'::jsonb)
    into candidates from (
      select p.id as product_id,m.role,profile.display_name,m.user_id,
        pg_catalog.jsonb_build_object('product_id',p.id,'role',m.role,
          'user_id',m.user_id,'membership_id',m.id,
          'display_name',profile.display_name,'email',u.email) as value
      from bx1_portal.products p
      join bx1_portal.organisations o on o.id=p.organisation_id
      join public.bx1_memberships m on m.organisation_id=o.reviewer_scope
        and m.role in ('IssuerFundManager','ComplianceOfficer')
      join public.bx1_profiles profile on profile.id=m.user_id
      join auth.users u on u.id=m.user_id and u.email is not null
      where c->>'mode'='ROLE' and c->>'role'='OfferingManager'
        and profile.status='ACTIVE'
        and bx1_portal.scoped_operator(c,p.organisation_id)
        and bx1_portal.native_membership_effective(m.id)
        and bx1_portal.entity_people_independent(auth.uid(),m.user_id)
      order by p.id,m.role,profile.display_name,m.user_id limit 100
    ) candidate;
  result:=pg_catalog.jsonb_set(result,'{product_appointment_candidates}',candidates);
  for item in select shown.value from pg_catalog.jsonb_array_elements(
    coalesce(result->'products','[]'::jsonb)) shown(value) loop
    if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager'
      and bx1_portal.product_appointment_authorised(c,(item->>'id')::uuid,'IssuerFundManager') is not true then
      continue; end if;
    package:=item->'offering_package';
    actions:=coalesce(item->'allowed_actions','[]'::jsonb);
    if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' then
      actions:=case when coalesce((package->>'can_review_issuer')::boolean,false)
        then '["review_offering_issuer"]'::jsonb else '[]'::jsonb end;
    end if;
    if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
      and bx1_portal.product_appointment_authorised(c,(item->>'id')::uuid,'ComplianceOfficer') is not true then
      if package is not null and package<>'null'::jsonb then
        package:=pg_catalog.jsonb_set(package,'{can_review_compliance}','false'::jsonb);
      end if;
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x.value) order by x.ordinality),'[]'::jsonb)
        into actions from pg_catalog.jsonb_array_elements_text(actions) with ordinality x(value,ordinality)
        where x.value<>'review_product';
    end if;
    products:=products||pg_catalog.jsonb_build_array(item||pg_catalog.jsonb_build_object(
      'offering_package',package,'allowed_actions',actions));
  end loop;
  result:=pg_catalog.jsonb_set(result,'{products}',products);
  if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' then
    -- The older organisation-scoped reader may have projected private orders,
    -- investor cases or unrelated events through a historical broad binding.
    -- Issuer appointments confer only exact-product review visibility.
    result:=pg_catalog.jsonb_set(result,'{organisations}',coalesce((
      select pg_catalog.jsonb_agg(org.value||pg_catalog.jsonb_build_object(
        'roles','["IssuerFundManager"]'::jsonb,
        'capabilities','["review_offering_issuer"]'::jsonb) order by org.ordinality)
      from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb))
        with ordinality org(value,ordinality)
      where exists(select 1 from bx1_portal.products p
        where p.organisation_id=(org.value->>'id')::uuid
          and bx1_portal.product_appointment_authorised(c,p.id,'IssuerFundManager'))
    ),'[]'::jsonb));
    result:=pg_catalog.jsonb_set(result,'{subscriptions}','[]'::jsonb);
    result:=pg_catalog.jsonb_set(result,'{events}','[]'::jsonb);
    result:=pg_catalog.jsonb_set(result,'{applications}','[]'::jsonb);
    result:=result-'accounts'-'entity_investment_accounts'-'product_eligibility'
      -'organisation_mandates'-'investing_representative_mandates'-'funding';
  end if;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'product_appointment_context_changed' using errcode='42501'; end if;
  return result;
end $$;

create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target_product uuid; appointment_id uuid;
begin
  if action in ('request_product_service_appointment','review_product_service_appointment',
    'apply_product_service_appointment','revoke_product_service_appointment') then
    return bx1_portal.execute_product_service_appointment(c,action,key,body); end if;
  -- The issuer's product appointment is review-only, never an operator or
  -- funding authority even where an older org binding still exists.
  if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager'
    and action<>'review_offering_issuer' then
    raise exception 'product_issuer_operator_action_denied' using errcode='42501'; end if;
  if action='review_product' then
    return bx1_portal.execute_appointed_compliance_decision(c,key,body); end if;
  if action='review_offering_issuer' then
    if pg_catalog.jsonb_typeof(body) is distinct from 'object'
      or pg_catalog.jsonb_typeof(body->'product_id') is distinct from 'string' then
      raise exception 'offering_product_appointment_required' using errcode='42501'; end if;
    target_product:=(body->>'product_id')::uuid;
    select a.id into appointment_id from bx1_portal.product_service_appointments a
      where a.product_id=target_product and a.role='IssuerFundManager'
        and a.appointee_user_id=auth.uid() and a.status='APPLIED'
      order by a.id limit 1;
    if appointment_id is null or bx1_portal.product_appointment_authorised(c,target_product,'IssuerFundManager') is not true
      or bx1_portal.product_appointment_effective(appointment_id) is not true then
      raise exception 'offering_product_appointment_required' using errcode='42501'; end if;
  end if;
  return bx1_portal.execute_scoped_pre_product_appointment(c,action,key,body);
end $$;

create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,
  payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select bx1_portal.execute_scoped(operating_context,command,request_key,payload);
$$;

revoke all on function bx1_portal.guard_product_service_appointment(),
  bx1_portal.product_appointment_effective(uuid),
  bx1_portal.product_appointment_authorised(jsonb,uuid,text),
  bx1_portal.product_appointment_projection(jsonb,uuid),
  bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb),
  bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb),
  bx1_portal.offering_package_projection_pre_appointment(jsonb,uuid),
  bx1_portal.offering_package_projection(jsonb,uuid),
  bx1_portal.guard_offering_decision_appointment(),
  bx1_portal.read_scoped_pre_product_appointment(jsonb),
  bx1_portal.execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb),
  bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
do $test_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration
    where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.read_scoped(jsonb),
      bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
      public.bx1_portal_read_scoped(jsonb),
      public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated;
  end if;
end $test_grants$;
