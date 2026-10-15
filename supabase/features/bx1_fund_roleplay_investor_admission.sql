-- Exact, owner-configured TEST own-investor admission continuation. Installation
-- creates no application approval, person, role, provider result or fund policy.
-- Ordinary admission remains independent. A real canonical review_application
-- command records a labelled, non-independent decision for the configured case.

do $dependencies$
declare dependency jsonb; target oid; metadata jsonb; source text;
begin
  for dependency in select value from jsonb_array_elements($pins$[
    {"signature":"bx1_private.test_roleplay_environment()","sha":"df3f47b7e75c9925105a77a558609cf65a8db2c135bbc857bb84bacb82123c21","acl":["postgres=X/postgres","bx1_authority_owner=X/postgres"]},
    {"signature":"bx1_private.test_roleplay_protected_session()","sha":"0cef4c386c389bb403f99fbae76f82a20faa874a1d7d9749d795c292b2822e14"},
    {"signature":"bx1_private.fund_roleplay_record_current(uuid,integer,uuid,uuid,uuid,jsonb,text)","sha":"fb47db73980dff11c505b4aad7838c89859b0d959ee97a4dda97e8e8a2c0cbe8"},
    {"signature":"bx1_private.fund_roleplay_appointment_current(uuid)","sha":"6fcb9829a5dff3398844bf54d316de411dfea9da51d3c65bbd75cf7267f9adc9"},
    {"signature":"bx1_private.document_scan_legacy_overlay_current(uuid,boolean)","sha":"f8e321808abf93e414f45eb4efa12aab8a85fc019ed219c556e932dd0b3d6684"},
    {"signature":"bx1_portal.admission_application_reviewer(jsonb,uuid,uuid)","sha":"cee6f7e581b8bc0ce2e041a8c7bf76d12b600322197875eb6c767aeea34be38e"}
  ]$pins$::jsonb) loop
    target:=to_regprocedure(dependency->>'signature');
    select to_jsonb(p),p.prosrc into metadata,source from pg_catalog.pg_proc p where p.oid=target;
    if target is null or metadata->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or metadata->'prosecdef' is distinct from 'true'::jsonb
      or metadata->'proacl' is distinct from coalesce(dependency->'acl','["postgres=X/postgres"]'::jsonb)
      or metadata->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or encode(sha256(convert_to(btrim(replace(source,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from dependency->>'sha' then
      raise exception 'fund_roleplay_admission_dependency_changed: %',dependency->>'signature' using errcode='55000';end if;
  end loop;
end $dependencies$;

do $baseline$
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regclass('bx1_private.fund_roleplay_admission_bindings') is not null
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid='bx1_portal.applications'::regclass
      and conname='applications_check' and contype='c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid)='CHECK (((reviewer_id IS NULL) OR (reviewer_id <> user_id)))') then
    raise exception 'fund_roleplay_admission_exact_test_baseline_required' using errcode='55000';end if;
end $baseline$;

create table bx1_private.fund_roleplay_admission_bindings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  submitted_revision integer not null check(submitted_revision>0),
  applicant_id uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null,
  details_sha256 text not null check(details_sha256 ~ '^[0-9a-f]{64}$'),
  documents_sha256 text not null check(documents_sha256 ~ '^[0-9a-f]{64}$'),
  policy_id uuid not null references bx1_private.roleplay_policies(id) on delete restrict,
  authority_epoch integer not null check(authority_epoch>0),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  native_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  operator_person_id uuid not null references bx1_private.roleplay_people(person_id) on delete restrict,
  compliance_appointment_id uuid not null references bx1_portal.product_service_appointments(id) on delete restrict,
  compliance_appointment_revision integer not null check(compliance_appointment_revision>0),
  valid_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  independence_proven boolean not null default false check(not independence_proven),
  unique(application_id,submitted_revision)
);

create table bx1_private.fund_roleplay_admission_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  binding_id uuid not null references bx1_private.fund_roleplay_admission_bindings(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  submitted_revision integer not null check(submitted_revision>0),
  decision_revision integer not null check(decision_revision=submitted_revision+1),
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  operating_context jsonb not null check(jsonb_typeof(operating_context)='object'),
  request_key uuid not null,
  command_payload jsonb not null check(jsonb_typeof(command_payload)='object'),
  decision text not null check(decision in ('APPROVED','CHANGES_REQUIRED','REJECTED')),
  notes text not null,
  checks jsonb not null check(jsonb_typeof(checks)='object'),
  reviewed_at timestamptz not null,
  approved_until timestamptz,
  independence_proven boolean not null default false check(not independence_proven),
  unique(application_id,decision_revision),
  unique(actor_id,request_key),
  check((decision='APPROVED')=(approved_until is not null)),
  check(approved_until is null or approved_until=reviewed_at+interval '30 days')
);

create table bx1_private.fund_roleplay_admission_lanes (
  transaction_id xid8 not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  binding_id uuid not null references bx1_private.fund_roleplay_admission_bindings(id) on delete restrict,
  application_id uuid not null references bx1_portal.applications(id) on delete restrict,
  operating_context jsonb not null,
  request_key uuid not null,
  command_payload jsonb not null,
  primary key(transaction_id,actor_id)
);
alter table bx1_private.fund_roleplay_admission_bindings enable row level security;
alter table bx1_private.fund_roleplay_admission_decisions enable row level security;
alter table bx1_private.fund_roleplay_admission_lanes enable row level security;
revoke all on bx1_private.fund_roleplay_admission_bindings,bx1_private.fund_roleplay_admission_decisions,
  bx1_private.fund_roleplay_admission_lanes from public,anon,authenticated,service_role;

create function bx1_private.fund_roleplay_admission_immutable() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin raise exception 'fund_roleplay_admission_history_immutable' using errcode='23514';end $$;
create trigger fund_roleplay_admission_binding_immutable before update or delete on bx1_private.fund_roleplay_admission_bindings
  for each row execute function bx1_private.fund_roleplay_admission_immutable();
create trigger fund_roleplay_admission_decision_immutable before update or delete on bx1_private.fund_roleplay_admission_decisions
  for each row execute function bx1_private.fund_roleplay_admission_immutable();

-- Inspect metadata and accepted scan evidence only. CLEAN means an actual
-- document scan, never a verified identity or a Sumsub result.
create function bx1_private.fund_roleplay_admission_documents(p_application uuid,p_revision integer,p_actor uuid,p_details jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(jsonb_typeof(p_details->'documents')='array' and jsonb_array_length(p_details->'documents')>0
    and exists(select 1 from bx1_portal.application_detail_versions saved
      where saved.application_id=p_application and saved.application_revision=p_revision
        and saved.capture_kind='SUBMISSION' and saved.details=p_details)
    and not exists(select 1 from jsonb_array_elements(p_details->'documents') document
      where not exists(select 1 from bx1_private.document_upload_receipts receipt
        join bx1_private.document_application_bindings bound on bound.receipt_id=receipt.id
          and bound.application_id=p_application and bound.application_revision=p_revision
        join bx1_private.document_quarantine_items item on item.id=receipt.id and item.actor_id=p_actor
          and item.storage_path=receipt.storage_path and item.sha256=receipt.sha256
          and item.byte_size=receipt.byte_size and item.mime_type=receipt.mime_type
          and item.state='PROMOTED' and item.promoted_at is not null
        join bx1_private.document_scan_events scan on scan.document_id=item.id and scan.verdict='CLEAN'
          and scan.sha256=item.sha256 and scan.scanner_id=item.scanner_id and scan.scanner_reference=item.scanner_reference
        join storage.objects stored on stored.bucket_id='bx1-portal-documents' and stored.name=item.storage_path
          and stored.owner_id=p_actor::text and stored.metadata->>'size'=item.byte_size::text
          and stored.metadata->>'mimetype'=item.mime_type and stored.user_metadata->>'sha256'=item.sha256
        where receipt.id::text=document->>'id' and receipt.actor_id=p_actor
          and receipt.storage_path=document->>'storage_path' and receipt.kind=document->>'kind'
          and receipt.title=document->>'title' and receipt.sha256=document->>'sha256'
          and receipt.byte_size::text=document->>'size' and receipt.mime_type=document->>'mime_type'
          and (receipt.validation_state='SCANNED_CLEAN'
            or bx1_private.document_scan_legacy_overlay_current(receipt.id,false))
          and not exists(select 1 from bx1_private.document_application_bindings other_binding
            where other_binding.receipt_id=receipt.id and other_binding.application_id<>p_application))),false);
$$;

-- Currentness is separate from historical receipt truth. It is usable by
-- canonical account/monitoring readers without borrowing another user's JWT.
create function bx1_private.fund_roleplay_admission_binding_current(p_binding uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.fund_roleplay_admission_bindings binding
    join bx1_private.roleplay_policies policy on policy.id=binding.policy_id and policy.authority_epoch=binding.authority_epoch
      and policy.product_id=binding.product_id and policy.offering_revision_id=binding.offering_revision_id
      and policy.terms_hash=binding.terms_hash and policy.native_organisation_id=binding.native_organisation_id
      and policy.actual_operator_person_id=binding.operator_person_id and policy.valid_until>=binding.valid_until
    join bx1_portal.applications application on application.id=binding.application_id and application.user_id=binding.applicant_id
    join bx1_portal.products product on product.id=binding.product_id and product.created_by=binding.applicant_id
    join bx1_portal.organisations organisation on organisation.id=product.organisation_id and organisation.owner_id=binding.applicant_id
    join bx1_portal.product_service_appointments appointment on appointment.id=binding.compliance_appointment_id
      and appointment.revision=binding.compliance_appointment_revision and appointment.product_id=binding.product_id
      and appointment.role='ComplianceOfficer' and appointment.appointee_user_id=binding.applicant_id
      and appointment.reviewer_scope_organisation_id=binding.native_organisation_id
      and appointment.roleplay_policy_id=binding.policy_id and appointment.roleplay_epoch=binding.authority_epoch
    where binding.id=p_binding and not binding.independence_proven
      and binding.valid_until=least(policy.valid_until,appointment.requested_until)
      and binding.valid_until>clock_timestamp() and bx1_private.fund_roleplay_appointment_current(appointment.id)
      and application.persona='INVESTOR' and application.context_kind='PERSONAL' and application.context_organisation_id is null
      and application.origin in ('SELF_SERVICE','SIGNUP') and application.admission_purpose='INVESTOR_ADMISSION'
      and application.organisation_id is null and application.provider_mode='MANUAL_TEST_REVIEW'
      and application.reviewer_scope=binding.native_organisation_id and organisation.reviewer_scope=application.reviewer_scope
      and application.details->>'investor_type'='INDIVIDUAL' and application.details->'test_data_acknowledged'='true'::jsonb
      and application.submitted_at=binding.submitted_at
      and encode(sha256(convert_to(application.details::text,'UTF8')),'hex')=binding.details_sha256
      and encode(sha256(convert_to((application.details->'documents')::text,'UTF8')),'hex')=binding.documents_sha256
      and application.revision in (binding.submitted_revision,binding.submitted_revision+1)
      and bx1_portal.entry_manual_review_enabled()
      and bx1_private.fund_roleplay_record_current(policy.id,policy.authority_epoch,product.id,policy.offering_revision_id,
        binding.applicant_id,jsonb_build_object('mode','ROLE','organisationId',binding.native_organisation_id::text,
          'role','ComplianceOfficer'),'review_product_eligibility') is true
      and bx1_private.fund_roleplay_admission_documents(application.id,binding.submitted_revision,binding.applicant_id,application.details)),false);
$$;

-- Configuration only: derives all evidence from the saved submitted application
-- and existing policy. It cannot approve, edit the policy or create an account.
create function bx1_private.fund_roleplay_admission_provision(p_application uuid,p_policy uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare application bx1_portal.applications; policy bx1_private.roleplay_policies;
  binding bx1_private.fund_roleplay_admission_bindings; expected_context jsonb;
  appointment bx1_portal.product_service_appointments;
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'fund_roleplay_admission_owner_required' using errcode='42501';end if;
  select * into application from bx1_portal.applications where id=p_application for share;
  select * into policy from bx1_private.roleplay_policies where id=p_policy for share;
  select * into appointment from bx1_portal.product_service_appointments saved
    where saved.product_id=policy.product_id and saved.role='ComplianceOfficer' and saved.appointee_user_id=application.user_id
      and saved.reviewer_scope_organisation_id=policy.native_organisation_id
      and saved.roleplay_policy_id=policy.id and saved.roleplay_epoch=policy.authority_epoch
      and bx1_private.fund_roleplay_appointment_current(saved.id) order by saved.id limit 1 for share;
  expected_context:=jsonb_build_object('mode','ROLE','organisationId',policy.native_organisation_id::text,'role','ComplianceOfficer');
  if application.id is null or policy.id is null or appointment.id is null or application.status<>'SUBMITTED'
    or application.persona<>'INVESTOR' or application.provider_mode<>'MANUAL_TEST_REVIEW'
    or application.context_kind<>'PERSONAL' or application.context_organisation_id is not null
    or application.origin not in ('SELF_SERVICE','SIGNUP') or application.admission_purpose<>'INVESTOR_ADMISSION'
    or application.organisation_id is not null or application.reviewer_id is not null
    or application.details->>'investor_type' is distinct from 'INDIVIDUAL'
    or application.details->'test_data_acknowledged' is distinct from 'true'::jsonb
    or application.reviewer_scope is distinct from policy.native_organisation_id
    or bx1_portal.entry_manual_review_enabled() is not true
    or bx1_private.fund_roleplay_record_current(policy.id,policy.authority_epoch,policy.product_id,policy.offering_revision_id,
      application.user_id,expected_context,'review_product_eligibility') is not true
    or not exists(select 1 from bx1_portal.products product join bx1_portal.organisations organisation on organisation.id=product.organisation_id
      where product.id=policy.product_id and product.created_by=application.user_id and organisation.owner_id=application.user_id
        and organisation.reviewer_scope=application.reviewer_scope)
    or bx1_private.fund_roleplay_admission_documents(application.id,application.revision,application.user_id,application.details) is not true then
    raise exception 'fund_roleplay_admission_saved_test_case_required' using errcode='42501';end if;
  -- Normal submission already performed validate_application under its real
  -- applicant session. The retained exact SUBMISSION and clean actor-bound
  -- documents above are rechecked here; never invent an owner JWT to replay it.
  insert into bx1_private.fund_roleplay_admission_bindings(application_id,submitted_revision,applicant_id,submitted_at,
    details_sha256,documents_sha256,policy_id,authority_epoch,product_id,offering_revision_id,terms_hash,
    native_organisation_id,operator_person_id,compliance_appointment_id,compliance_appointment_revision,valid_until)
    values(application.id,application.revision,application.user_id,application.submitted_at,
      encode(sha256(convert_to(application.details::text,'UTF8')),'hex'),
      encode(sha256(convert_to((application.details->'documents')::text,'UTF8')),'hex'),policy.id,policy.authority_epoch,
      policy.product_id,policy.offering_revision_id,policy.terms_hash,policy.native_organisation_id,policy.actual_operator_person_id,
      appointment.id,appointment.revision,least(policy.valid_until,appointment.requested_until))
    on conflict(application_id,submitted_revision) do nothing;
  select * into binding from bx1_private.fund_roleplay_admission_bindings saved
    where saved.application_id=application.id and saved.submitted_revision=application.revision;
  if binding.policy_id is distinct from policy.id or binding.authority_epoch is distinct from policy.authority_epoch
    or bx1_private.fund_roleplay_admission_binding_current(binding.id) is not true then
    raise exception 'fund_roleplay_admission_configuration_conflict' using errcode='23505';end if;
  return jsonb_build_object('binding_id',binding.id,'application_id',binding.application_id,'submitted_revision',binding.submitted_revision,
    'policy_id',binding.policy_id,'authority_epoch',binding.authority_epoch,'product_id',binding.product_id,
    'offering_revision_id',binding.offering_revision_id,'details_sha256',binding.details_sha256,
    'documents_sha256',binding.documents_sha256,'independence_proven',false,'decision_created',false);
end $$;

create function bx1_private.fund_roleplay_admission_review_allowed(p_context jsonb,p_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(p_context->>'mode'='ROLE' and p_context->>'role'='ComplianceOfficer'
    and bx1_private.test_roleplay_protected_session() and exists(
      select 1 from bx1_private.fund_roleplay_admission_bindings binding
      join bx1_portal.applications application on application.id=binding.application_id
      where application.id=p_application and application.user_id=auth.uid()
        and application.status='SUBMITTED' and application.revision=binding.submitted_revision
        and p_context->>'organisationId'=binding.native_organisation_id::text
        and bx1_private.fund_roleplay_admission_binding_current(binding.id)
        and bx1_portal.admission_application_reviewer(p_context,application.reviewer_scope,application.organisation_id)
        and bx1_private.fund_roleplay_appointed(p_context,binding.product_id,'ComplianceOfficer')),false);
$$;

create function bx1_private.fund_roleplay_admission_enter(p_context jsonb,p_key uuid,p_payload jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare binding bx1_private.fund_roleplay_admission_bindings; application bx1_portal.applications;
begin
  select * into application from bx1_portal.applications where id=(p_payload->>'application_id')::uuid;
  if application.user_id is distinct from auth.uid() then return;end if;
  if bx1_private.fund_roleplay_admission_review_allowed(p_context,application.id) is not true then
    raise exception 'fund_roleplay_admission_exact_review_required' using errcode='42501';end if;
  select * into binding from bx1_private.fund_roleplay_admission_bindings saved
    where saved.application_id=application.id and saved.submitted_revision=application.revision for share;
  perform id from bx1_private.roleplay_policies where id=binding.policy_id for share;
  perform id from bx1_portal.products where id=binding.product_id for share;
  perform id from bx1_portal.offering_revisions where id=binding.offering_revision_id for share;
  perform id from bx1_portal.product_service_appointments where product_id=binding.product_id
    and appointee_user_id=auth.uid() and role='ComplianceOfficer' order by id for share;
  if p_key is null or p_key='00000000-0000-0000-0000-000000000000'
    or (p_payload->>'expected_revision')::integer is distinct from binding.submitted_revision
    or bx1_private.fund_roleplay_admission_review_allowed(p_context,application.id) is not true then
    raise exception 'fund_roleplay_admission_authority_changed_after_wait' using errcode='42501';end if;
  insert into bx1_private.fund_roleplay_admission_lanes(transaction_id,actor_id,session_id,binding_id,application_id,
    operating_context,request_key,command_payload) values(pg_current_xact_id(),auth.uid(),(auth.jwt()->>'session_id')::uuid,
      binding.id,application.id,p_context,p_key,p_payload);
end $$;

create function bx1_private.fund_roleplay_admission_lane_current(p_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.fund_roleplay_admission_lanes lane
    join bx1_private.fund_roleplay_admission_bindings binding on binding.id=lane.binding_id
      and binding.application_id=lane.application_id
    where lane.transaction_id=pg_current_xact_id() and lane.actor_id=auth.uid()
      and lane.session_id::text=auth.jwt()->>'session_id' and lane.application_id=p_application
      and lane.command_payload->>'application_id'=p_application::text
      and lane.command_payload->>'expected_revision'=binding.submitted_revision::text
      and bx1_private.fund_roleplay_admission_review_allowed(lane.operating_context,p_application)),false);
$$;

-- The historical CHECK calls only this exact immutable receipt comparison. No
-- current policy, session, expiry, provider assertion or caller GUC is truth.
create function bx1_private.fund_roleplay_admission_decision_bound(p_id uuid,p_user uuid,p_reviewer uuid,p_revision integer,
  p_status text,p_details jsonb,p_submitted timestamptz,p_reviewed timestamptz,p_notes text,p_checks jsonb,p_approved timestamptz) returns boolean
language sql volatile security definer set search_path='' as $$
  select coalesce(exists(select 1 from bx1_private.fund_roleplay_admission_decisions decision
    join bx1_private.fund_roleplay_admission_bindings binding on binding.id=decision.binding_id
    where decision.application_id=p_id and binding.application_id=p_id
      and binding.applicant_id=p_user and decision.actor_id=p_user and p_reviewer=p_user
      and decision.submitted_revision=binding.submitted_revision and decision.decision_revision=p_revision
      and decision.decision=p_status and decision.reviewed_at=p_reviewed and decision.notes=p_notes
      and decision.checks=p_checks and decision.approved_until is not distinct from p_approved
      and binding.submitted_at=p_submitted and not binding.independence_proven and not decision.independence_proven
      and binding.details_sha256=encode(sha256(convert_to(p_details::text,'UTF8')),'hex')
      and binding.documents_sha256=encode(sha256(convert_to((p_details->'documents')::text,'UTF8')),'hex')
      and decision.command_payload=jsonb_build_object('application_id',p_id,'expected_revision',binding.submitted_revision,
        'decision',p_status,'notes',p_notes,'checks',p_checks)
      and decision.operating_context=jsonb_build_object('mode','ROLE','organisationId',binding.native_organisation_id::text,
        'role','ComplianceOfficer')),false);
$$;

create function bx1_private.fund_roleplay_admission_stamp() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.fund_roleplay_admission_lanes; binding bx1_private.fund_roleplay_admission_bindings;
begin
  if NEW.reviewer_id is distinct from NEW.user_id or NEW.reviewed_at is not distinct from OLD.reviewed_at then return NEW;end if;
  select * into lane from bx1_private.fund_roleplay_admission_lanes saved
    where saved.transaction_id=pg_current_xact_id() and saved.actor_id=auth.uid() and saved.application_id=OLD.id;
  select * into binding from bx1_private.fund_roleplay_admission_bindings where id=lane.binding_id;
  if lane.actor_id is null or OLD.status<>'SUBMITTED' or OLD.revision is distinct from binding.submitted_revision
    or NEW.user_id is distinct from auth.uid() or NEW.reviewer_id is distinct from auth.uid()
    or NEW.revision is distinct from OLD.revision+1 or NEW.details is distinct from OLD.details
    or NEW.submitted_at is distinct from OLD.submitted_at or NEW.organisation_id is not null
    or lane.command_payload is distinct from jsonb_build_object('application_id',OLD.id,'expected_revision',OLD.revision,
      'decision',NEW.status,'notes',NEW.review_notes,'checks',NEW.review_checks)
    or bx1_private.fund_roleplay_admission_lane_current(OLD.id) is not true then
    raise exception 'fund_roleplay_admission_canonical_decision_required' using errcode='42501';end if;
  insert into bx1_private.fund_roleplay_admission_decisions(binding_id,application_id,submitted_revision,decision_revision,
    actor_id,session_id,operating_context,request_key,command_payload,decision,notes,checks,reviewed_at,approved_until)
    values(binding.id,OLD.id,OLD.revision,NEW.revision,lane.actor_id,lane.session_id,lane.operating_context,
      lane.request_key,lane.command_payload,NEW.status,NEW.review_notes,NEW.review_checks,NEW.reviewed_at,NEW.approved_until);
  return NEW;
end $$;
create trigger zz_fund_roleplay_admission_decision before update on bx1_portal.applications
  for each row execute function bx1_private.fund_roleplay_admission_stamp();

alter table bx1_portal.applications drop constraint applications_check;
alter table bx1_portal.applications add constraint applications_check check(reviewer_id is null or reviewer_id<>user_id
  or bx1_private.fund_roleplay_admission_decision_bound(id,user_id,reviewer_id,revision,status,details,
    submitted_at,reviewed_at,review_notes,review_checks,approved_until));

create function bx1_private.fund_roleplay_admission_current(p_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when not exists(select 1 from bx1_private.fund_roleplay_admission_bindings tagged
      where tagged.application_id=p_application) then true
    else coalesce(exists(select 1 from bx1_portal.applications application where application.id=p_application
      and application.reviewer_id=application.user_id and exists(
      select 1 from bx1_private.fund_roleplay_admission_decisions decision
      where decision.application_id=application.id and decision.decision_revision=application.revision
        and decision.decision='APPROVED' and decision.actor_id=application.user_id
        and bx1_private.fund_roleplay_admission_decision_bound(application.id,application.user_id,application.reviewer_id,
          application.revision,application.status,application.details,application.submitted_at,application.reviewed_at,
          application.review_notes,application.review_checks,application.approved_until)
        and bx1_private.fund_roleplay_admission_binding_current(decision.binding_id))),false) end;
$$;

create function bx1_private.fund_roleplay_admission_product(p_application uuid,p_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when not exists(select 1 from bx1_private.fund_roleplay_admission_bindings tagged
      where tagged.application_id=p_application) then true
    else coalesce(exists(select 1 from bx1_portal.applications application where application.id=p_application
      and application.reviewer_id=application.user_id and exists(
      select 1 from bx1_private.fund_roleplay_admission_decisions decision
      join bx1_private.fund_roleplay_admission_bindings binding on binding.id=decision.binding_id
      where decision.application_id=application.id and decision.decision_revision=application.revision
        and decision.decision='APPROVED' and binding.product_id=p_product
        and bx1_private.fund_roleplay_admission_current(application.id))),false) end;
$$;

create function bx1_private.fund_roleplay_admission_finish(p_context jsonb,p_action text,p_key uuid,p_payload jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare lane bx1_private.fund_roleplay_admission_lanes;
begin
  if p_action is distinct from 'review_application' then return;end if;
  select * into lane from bx1_private.fund_roleplay_admission_lanes saved
    where saved.transaction_id=pg_current_xact_id() and saved.actor_id=auth.uid();
  if lane.actor_id is null then return;end if;
  if lane.operating_context is distinct from p_context or lane.request_key is distinct from p_key
    or lane.command_payload is distinct from p_payload or lane.session_id::text is distinct from auth.jwt()->>'session_id'
    or bx1_private.test_roleplay_protected_session() is not true
    or bx1_private.fund_roleplay_admission_binding_current(lane.binding_id) is not true
    or not exists(select 1 from bx1_private.fund_roleplay_admission_bindings binding where binding.id=lane.binding_id
      and bx1_private.fund_roleplay_appointed(p_context,binding.product_id,'ComplianceOfficer'))
    or not exists(select 1 from bx1_private.fund_roleplay_admission_decisions decision
      where decision.application_id=lane.application_id and decision.binding_id=lane.binding_id and decision.actor_id=auth.uid()
        and decision.session_id=lane.session_id and decision.request_key=p_key and decision.command_payload=p_payload)
    or not exists(select 1 from bx1_portal.requests receipt where receipt.actor_id=auth.uid()
      and receipt.request_key=p_key and receipt.command=p_action and receipt.payload=p_payload)
    or not exists(select 1 from bx1_portal.scoped_requests receipt where receipt.actor_id=auth.uid()
      and receipt.request_key=p_key and receipt.command=p_action and receipt.payload=p_payload and receipt.operating_context=p_context) then
    raise exception 'fund_roleplay_admission_recording_or_authority_changed' using errcode='42501';end if;
  delete from bx1_private.fund_roleplay_admission_lanes saved
    where saved.transaction_id=pg_current_xact_id() and saved.actor_id=auth.uid();
end $$;

-- Enrich only applications the canonical reader already exposed. Neither
-- marker creates authority; the writer independently checks its saved binding.
create function bx1_private.fund_roleplay_admission_read(p_context jsonb,p_snapshot jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare items jsonb:='[]'::jsonb; item jsonb; binding bx1_private.fund_roleplay_admission_bindings;
  decision bx1_private.fund_roleplay_admission_decisions;
begin
  if bx1_private.test_roleplay_environment() is not true or auth.uid() is null
    or p_snapshot->'actor'->>'id' is distinct from auth.uid()::text
    or p_snapshot->'operating_context' is distinct from p_context
    or not exists(select 1 from bx1_private.fund_roleplay_admission_bindings saved
      where exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'applications','[]'::jsonb)) visible
        where visible->>'id'=saved.application_id::text)) then
    return p_snapshot;end if;
  for item in select value from jsonb_array_elements(coalesce(p_snapshot->'applications','[]'::jsonb)) loop
    select * into binding from bx1_private.fund_roleplay_admission_bindings saved
      where saved.application_id::text=item->>'id'
      order by saved.submitted_revision desc limit 1;
    if binding.id is not null then
      if bx1_private.fund_roleplay_admission_review_allowed(p_context,binding.application_id) then
        item:=item||jsonb_build_object('test_roleplay_review',jsonb_build_object('version',1,'environment','TESTNET',
          'execution_mode','TEST_ROLE_PLAY','independence_proven',false,'actor_id',auth.uid(),'operating_context',p_context,
          'policy_id',binding.policy_id,'authority_epoch',binding.authority_epoch,'product_id',binding.product_id,
          'offering_revision_id',binding.offering_revision_id,'application_id',binding.application_id,
          'application_revision',binding.submitted_revision,'command','review_application','can_review',true,'valid_until',binding.valid_until));
      end if;
      select * into decision from bx1_private.fund_roleplay_admission_decisions saved
        where saved.binding_id=binding.id and saved.application_id=binding.application_id
          and saved.decision_revision::text=item->>'revision';
      if decision.id is not null then
        item:=item||jsonb_build_object('test_roleplay_admission',jsonb_build_object('version',1,'environment','TESTNET',
          'execution_mode','TEST_ROLE_PLAY','independence_proven',false,'policy_id',binding.policy_id,
          'authority_epoch',binding.authority_epoch,'product_id',binding.product_id,'offering_revision_id',binding.offering_revision_id,
          'application_id',binding.application_id,'submitted_revision',binding.submitted_revision,'decision_revision',decision.decision_revision,
          'decision',decision.decision,'reviewer_id',decision.actor_id,'reviewed_at',decision.reviewed_at,'valid_until',binding.valid_until));
      end if;
    end if;
    items:=items||jsonb_build_array(item);
  end loop;
  return jsonb_set(p_snapshot,'{applications}',items);
end $$;

-- Fixed native OIDs and exact normalized bodies: preserve every byte outside
-- these six finite cutpoints, including all existing publication continuations.
do $cutover$
declare spec jsonb; cut jsonb; target oid; original text; next_body text; restored text; definition text;
  before_row jsonb; after_row jsonb; snapshots jsonb:='{}'::jsonb; occurrences integer;
begin
  for spec in select value from jsonb_array_elements($specs$[
    {"signature":"bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb)","oid":24447,"sha":"d6e5856bebc39049b70d9617d7af80675957d09743477662f634d8610bfe578d","cuts":[
      {"from":"      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;\n  elsif action='create_investment_account' then","to":"      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;\n    perform bx1_private.fund_roleplay_admission_enter(c,key,body);\n  elsif action='create_investment_account' then","count":1},
      {"from":"  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);","to":"  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);\n  perform bx1_private.fund_roleplay_admission_finish(c,action,key,body);","count":1}
    ]},
    {"signature":"bx1_portal.execute_command_pre_entry(text,uuid,jsonb)","oid":24343,"sha":"f7c2a70086d1a4c1ce09cb11cc0c505c41c9c4a7b764fc586dc589d6c8aa865f","cuts":[
      {"from":"or not bx1_portal.admission_action_independent(a.user_id) then raise exception 'portal_review_denied'","to":"or not (bx1_portal.admission_action_independent(a.user_id) or bx1_private.fund_roleplay_admission_lane_current(a.id)) then raise exception 'portal_review_denied'","count":1},
      {"from":"v_summary:='Manual TEST_ONLY onboarding decision: '","to":"v_summary:=case when exists(select 1 from bx1_private.fund_roleplay_admission_decisions decision where decision.application_id=a.id and decision.actor_id=v_actor and decision.request_key=execute_command_pre_entry.request_key) then 'TEST_ROLE_PLAY own-investor decision; independence_proven=false; no provider verification. ' else '' end||'Manual TEST_ONLY onboarding decision: '","count":1}
    ]},
    {"signature":"bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamp with time zone)","oid":27054,"sha":"5f2653b65d4bb3b7d41c0a5bcb93232b9f192880018ff2be8cbaaddd17d8c015","cuts":[
      {"from":"if a.id is null or bx1_portal.independent_of(a.user_id) is not true then","to":"if a.id is null or (bx1_portal.independent_of(a.user_id) or bx1_private.fund_roleplay_admission_lane_current(a.id)) is not true then","count":1}
    ]},
    {"signature":"bx1_portal.read_scoped(jsonb)","oid":27038,"sha":"8f6f44c013f0a84656bee3254a1824c73d43ed09171f3d2a5bd25fc182429ba2","acl":["postgres=X/postgres","authenticated=X/postgres"],"cuts":[
      {"from":"return bx1_private.fund_roleplay_manager_read(c);","to":"return bx1_private.fund_roleplay_admission_read(c,bx1_private.fund_roleplay_manager_read(c));","count":1},
      {"from":"return roleplay_result;","to":"return bx1_private.fund_roleplay_admission_read(c,roleplay_result);","count":1},
      {"from":"return bx1_portal.read_scoped_pre_entity_eligibility(c);","to":"return bx1_private.fund_roleplay_admission_read(c,bx1_portal.read_scoped_pre_entity_eligibility(c));","count":1},
      {"from":"return bx1_portal.offering_workflow_read_scoped(c);","to":"return bx1_private.fund_roleplay_admission_read(c,bx1_portal.offering_workflow_read_scoped(c));","count":1},
      {"from":"return bx1_portal.test_workspace_read(c);","to":"return bx1_private.fund_roleplay_admission_read(c,bx1_portal.test_workspace_read(c));","count":1},
      {"from":"return bx1_portal.read_scoped_pre_test_workspace(c);","to":"return bx1_private.fund_roleplay_admission_read(c,bx1_portal.read_scoped_pre_test_workspace(c));","count":1}
    ]},
    {"signature":"bx1_portal.monitoring_new_action_allowed(uuid)","oid":26200,"sha":"7f0e3e17e391a5a382bc2b44d0204451a1e103b725dff202005b65b4d77feeae","cuts":[
      {"from":"and a.approved_until>pg_catalog.clock_timestamp()","to":"and a.approved_until>pg_catalog.clock_timestamp()\n      and bx1_private.fund_roleplay_admission_current(a.id)","count":1}
    ]},
    {"signature":"bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb)","oid":25200,"sha":"c584a3eed56c7ae72f96d6588f86966df4da08915d149e5897b0bed01644c903","cuts":[
      {"from":"or bx1_portal.account_usable(c,account_id) is not true","to":"or bx1_portal.account_usable(c,account_id) is not true\n      or bx1_private.fund_roleplay_admission_product(i.application_id,e.product_id) is not true","count":2},
      {"from":"if i.id is null or p.id is null or p.status<>'PUBLISHED'","to":"if i.id is null or p.id is null or bx1_private.fund_roleplay_admission_product(i.application_id,p.id) is not true or p.status<>'PUBLISHED'","count":1},
      {"from":"if action='request_product_eligibility' and bx1_portal.account_usable(c,e.investment_account_id) is not true then","to":"if action='request_product_eligibility' and (bx1_portal.account_usable(c,e.investment_account_id) is not true\n    or bx1_private.fund_roleplay_admission_product(i.application_id,e.product_id) is not true) then","count":1}
    ]}
  ]$specs$::jsonb) loop
    target:=to_regprocedure(spec->>'signature');
    select to_jsonb(p),p.prosrc into before_row,original from pg_catalog.pg_proc p where p.oid=target;
    if target is distinct from (spec->>'oid')::oid or before_row->>'proowner' is distinct from 'postgres'::regrole::oid::text
      or before_row->'prosecdef' is distinct from 'true'::jsonb or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
      or before_row->'proacl' is distinct from coalesce(spec->'acl','["postgres=X/postgres"]'::jsonb)
      or encode(sha256(convert_to(btrim(replace(original,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') is distinct from spec->>'sha' then
      raise exception 'fund_roleplay_admission_native_pin_changed: %',spec->>'signature' using errcode='55000';end if;
    snapshots:=snapshots||jsonb_build_object(spec->>'signature',before_row);
    next_body:=original;
    for cut in select value from jsonb_array_elements(spec->'cuts') loop
      occurrences:=(length(next_body)-length(replace(next_body,cut->>'from','')))/length(cut->>'from');
      if occurrences<>(cut->>'count')::integer then raise exception 'fund_roleplay_admission_cut_mismatch: %',spec->>'signature' using errcode='55000';end if;
      next_body:=replace(next_body,cut->>'from',cut->>'to');
    end loop;
    restored:=next_body;
    for cut in select value from jsonb_array_elements(spec->'cuts') with ordinality item(value,n) order by n desc loop
      if (length(restored)-length(replace(restored,cut->>'to','')))/length(cut->>'to')<>(cut->>'count')::integer then
        raise exception 'fund_roleplay_admission_reverse_cut_mismatch' using errcode='55000';end if;
      restored:=replace(restored,cut->>'to',cut->>'from');
    end loop;
    if restored is distinct from original then raise exception 'fund_roleplay_admission_outside_cut_changed' using errcode='55000';end if;
    definition:=pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'fund_roleplay_admission_definition_not_unique' using errcode='55000';end if;
    execute replace(definition,original,next_body);
    select to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
    if after_row-'prosrc' is distinct from before_row-'prosrc' or after_row->>'prosrc' is distinct from next_body then
      raise exception 'fund_roleplay_admission_native_metadata_changed' using errcode='55000';end if;
  end loop;
end $cutover$;

-- Close default function privileges, including roles added after older features.
do $acl$
declare helper record; permission record; relation record;
begin
  for relation in select c.oid,c.relowner from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='bx1_private' and c.relname in ('fund_roleplay_admission_bindings','fund_roleplay_admission_decisions','fund_roleplay_admission_lanes') loop
    for permission in select distinct granted.grantee from pg_catalog.pg_class c,
      lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) granted
      where c.oid=relation.oid and granted.grantee<>relation.relowner loop
      execute format('revoke all on table %s from %s',relation.oid::regclass,
        case when permission.grantee=0 then 'public' else quote_ident(pg_get_userbyid(permission.grantee)) end);
    end loop;
    if exists(select 1 from pg_catalog.pg_class c,lateral pg_catalog.aclexplode(c.relacl) granted
      where c.oid=relation.oid and granted.grantee<>c.relowner) then
      raise exception 'fund_roleplay_admission_table_not_closed' using errcode='55000';end if;
  end loop;
  for helper in select p.oid,p.proowner from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_private' and p.proname like 'fund_roleplay_admission_%' loop
    for permission in select distinct granted.grantee from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) granted
      where p.oid=helper.oid and granted.grantee<>helper.proowner loop
      execute format('revoke all on function %s from %s',helper.oid::regprocedure,
        case when permission.grantee=0 then 'public' else quote_ident(pg_get_userbyid(permission.grantee)) end);
    end loop;
    if exists(select 1 from pg_catalog.pg_proc p,lateral pg_catalog.aclexplode(p.proacl) granted
      where p.oid=helper.oid and granted.grantee<>p.proowner) then
      raise exception 'fund_roleplay_admission_helper_not_closed' using errcode='55000';end if;
  end loop;
end $acl$;
