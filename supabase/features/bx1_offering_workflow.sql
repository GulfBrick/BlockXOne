-- Normal Stage 3 package workflow. Install after the committed admission/representatives chain.
-- No public RPC, global authority predicate, financial writer or role grant is added.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.account_representative_command(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.offering_workflow_context(jsonb)') is not null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null then
    raise exception 'offering_workflow_baseline_required' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p
    where p.oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure
      and p.proowner='bx1_authority_owner'::regrole and p.prosecdef
      and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        ='f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    or not pg_catalog.has_function_privilege('postgres','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE') then
    raise exception 'offering_workflow_person_lock_changed' using errcode='55000'; end if;
end $$;

create function bx1_portal.offering_workflow_person_current(actor uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select actor is not null and exists(select 1 from auth.users u
    join public.bx1_profiles p on p.id=u.id and p.status='ACTIVE'
    where u.id=actor and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    and not exists(select 1 from bx1_private.person_principals p
      left join bx1_private.persons h on h.id=p.person_id
      where p.auth_user_id=actor and (p.status<>'TRUSTED' or h.status is distinct from 'TRUSTED'));
$$;

create function bx1_portal.offering_workflow_context(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.admission_password_session() and bx1_portal.admission_context(c)
    and c->>'mode'='ROLE'
    and c->>'role' in ('OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin')
    and bx1_portal.offering_workflow_person_current(auth.uid());
$$;

create function bx1_portal.offering_workflow_command_allowed(c jsonb,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.offering_workflow_context(c) and coalesce(case c->>'role'
    when 'OfferingManager' then action=any(array['create_product','save_product','submit_product',
      'begin_offering_amendment','reopen_offering_review','request_product_service_appointment'])
    when 'IssuerFundManager' then action='review_offering_issuer'
    when 'ComplianceOfficer' then action=any(array['review_product','review_product_service_appointment'])
    when 'SuperAdmin' then action='apply_product_service_appointment'
    else false end,false);
$$;

create function bx1_portal.offering_workflow_command_context(c jsonb,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session()
    then bx1_portal.offering_workflow_command_allowed(c,action)
      or bx1_portal.admission_command_allowed(c,action)
    else bx1_portal.valid_operating_context(c) end;
$$;

create function bx1_portal.offering_workflow_lock_actor(action text,c jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.admission_password_session() is not true then
    perform bx1_portal.entry_lock_actor(); return; end if;
  if bx1_portal.offering_workflow_command_context(c,action) is not true then
    raise exception 'offering_package_command_denied' using errcode='42501'; end if;
  perform bx1_portal.admission_lock_actor(null,c);
  perform bx1_portal.admission_lock_people(array[auth.uid()]);
  if bx1_portal.offering_workflow_command_context(c,action) is not true then
    raise exception 'offering_package_authority_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.offering_workflow_require_context(c jsonb,action text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.admission_password_session() then
    if bx1_portal.offering_workflow_command_allowed(c,action) is not true then
      raise exception 'offering_package_context_denied' using errcode='42501'; end if;
  else perform bx1_portal.entry_require_context((c->>'organisationId')::uuid); end if;
end $$;

create function bx1_portal.offering_workflow_manager_current(actor uuid,target_org uuid,native_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.offering_workflow_person_current(actor) and exists(
    select 1 from bx1_portal.representative_mandates m
    join bx1_portal.applications a on a.id=m.application_id and a.user_id=actor
    join bx1_portal.organisations o on o.id=m.product_organisation_id and o.application_id=a.id
    join bx1_portal.application_detail_versions v on v.application_id=a.id
      and v.application_revision=a.revision-1 and v.capture_kind='SUBMISSION' and v.details=a.details
    where m.product_organisation_id=target_org and m.native_organisation_id=native_org
      and m.applicant_user_id=actor and m.role='OfferingManager'
      and m.approval_receipt_id is not null and m.applied_at is not null
      and a.status='APPROVED' and a.persona='WEALTH_MANAGER'
      and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and a.approved_until>pg_catalog.clock_timestamp()
      and a.revision=m.admission_revision and o.owner_id=actor
      and bx1_portal.representative_mandate_effective(m.id)
      and bx1_portal.native_membership_effective(m.native_membership_id)
      and bx1_portal.monitoring_new_action_allowed(a.id));
$$;

create function bx1_portal.offering_workflow_operator(c jsonb,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session() then
    bx1_portal.offering_workflow_context(c) and c->>'role'='OfferingManager'
      and bx1_portal.offering_workflow_manager_current(auth.uid(),target_org,(c->>'organisationId')::uuid)
    else bx1_portal.scoped_operator(c,target_org) end;
$$;

-- Product first, then its immutable admission source and authority rows.
-- Snapshot reads do not lock a collection of products/mandates, avoiding inverse account locks.
create function bx1_portal.offering_workflow_lock_product(c jsonb,target_product uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; o bx1_portal.organisations; source_id uuid; users uuid[];
begin
  if bx1_portal.admission_password_session() is not true then return; end if;
  if bx1_portal.offering_workflow_context(c) is not true then
    raise exception 'offering_package_context_denied' using errcode='42501'; end if;
  select * into p from bx1_portal.products where id=target_product for update;
  if p.id is null then raise exception 'offering_product_denied' using errcode='42501'; end if;
  select application_id into source_id from bx1_portal.organisations where id=p.organisation_id;
  perform id from bx1_portal.applications where id=source_id for share;
  perform application_id from bx1_portal.customer_monitoring_cases where application_id=source_id for share;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  if o.id is null or o.application_id is distinct from source_id then
    raise exception 'offering_product_source_changed' using errcode='42501'; end if;
  perform id from bx1_portal.representative_mandates
    where product_organisation_id=o.id order by id for share;
  perform id from bx1_portal.organisation_authority_bindings
    where product_organisation_id=o.id order by id for share;
  perform m.id from public.bx1_memberships m join bx1_portal.representative_mandates r
    on r.native_membership_id=m.id where r.product_organisation_id=o.id order by m.id for share of m;
  perform n.id from public.bx1_organisations n join bx1_portal.representative_mandates r
    on r.native_organisation_id=n.id where r.product_organisation_id=o.id order by n.id for share of n;
  select pg_catalog.array_agg(distinct u order by u) into users from (
    select auth.uid() u union select p.created_by union select o.owner_id
    union select a.requested_by_user_id from bx1_portal.product_service_appointments a where a.product_id=p.id
    union select a.appointee_user_id from bx1_portal.product_service_appointments a where a.product_id=p.id
    union select a.reviewed_by_user_id from bx1_portal.product_service_appointments a where a.product_id=p.id
    union select a.applied_by_user_id from bx1_portal.product_service_appointments a where a.product_id=p.id) x
    where u is not null;
  perform au.id from auth.users as au where au.id=any(users) order by au.id for share;
  perform id from public.bx1_profiles where id=any(users) order by id for share;
  perform id from public.bx1_memberships where user_id=any(users)
    and role in ('OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin') order by id for share;
  perform id from public.bx1_organisations where id in (select organisation_id from public.bx1_memberships
    where user_id=any(users) and role in ('OfferingManager','IssuerFundManager','ComplianceOfficer','SuperAdmin')) order by id for share;
  perform bx1_portal.admission_lock_people(users);
  if bx1_portal.offering_workflow_context(c) is not true
    or bx1_portal.current_product_organisation(o.id) is not true
    or not exists(select 1 from bx1_portal.representative_mandates r
      where r.product_organisation_id=o.id
        and bx1_portal.offering_workflow_manager_current(o.owner_id,o.id,r.native_organisation_id)) then
    raise exception 'offering_product_authority_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.offering_workflow_product_appointment_effective(target_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session() is not true
    then bx1_portal.product_appointment_effective(target_id) else exists(
    select 1 from bx1_portal.product_service_appointments a
    join bx1_portal.products p on p.id=a.product_id and p.organisation_id=a.product_organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id and o.reviewer_scope=a.reviewer_scope_organisation_id
    join public.bx1_memberships m on m.id=a.native_membership_id
      and m.user_id=a.appointee_user_id and m.role=a.role
    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'
      and cfg.manual_test_review and cfg.test_ordinary_entry_enabled and cfg.reviewer_scope=a.reviewer_scope_organisation_id
    where a.id=target_id and a.status='APPLIED' and a.approval_receipt_id is not null
      and a.applied_at is not null and a.requested_until>pg_catalog.clock_timestamp()
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,
        (a.requested_in_context->>'organisationId')::uuid)
      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)
      and bx1_portal.offering_workflow_person_current(a.reviewed_by_user_id)
      and bx1_portal.offering_workflow_person_current(a.applied_by_user_id)
      and exists(select 1 from public.bx1_memberships review
        where review.user_id=a.reviewed_by_user_id and review.role='ComplianceOfficer'
          and review.organisation_id=a.reviewer_scope_organisation_id
          and bx1_portal.native_membership_effective(review.id))
      and exists(select 1 from public.bx1_memberships applier
        where applier.user_id=a.applied_by_user_id and applier.role='SuperAdmin'
          and applier.organisation_id=a.reviewer_scope_organisation_id
          and bx1_portal.native_membership_effective(applier.id))
      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.appointee_user_id)
      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.reviewed_by_user_id)
      and bx1_portal.admission_people_independent(a.requested_by_user_id,a.applied_by_user_id)
      and bx1_portal.admission_people_independent(a.appointee_user_id,a.reviewed_by_user_id)
      and bx1_portal.admission_people_independent(a.appointee_user_id,a.applied_by_user_id)
      and bx1_portal.admission_people_independent(a.reviewed_by_user_id,a.applied_by_user_id)) end;
$$;

create function bx1_portal.offering_workflow_product_appointment_authorised(c jsonb,target_product uuid,target_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session() is not true
    then bx1_portal.product_appointment_authorised(c,target_product,target_role)
    else bx1_portal.offering_workflow_context(c) and c->>'role'=target_role
      and target_role in ('IssuerFundManager','ComplianceOfficer')
      and exists(select 1 from bx1_portal.product_service_appointments a
        join public.bx1_memberships m on m.id=a.native_membership_id
        where a.product_id=target_product and a.role=target_role and a.appointee_user_id=auth.uid()
          and m.organisation_id=(c->>'organisationId')::uuid
          and bx1_portal.offering_workflow_product_appointment_effective(a.id)) end;
$$;

create function bx1_portal.offering_workflow_staff(c jsonb,target_scope uuid,actor_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session() then
    bx1_portal.offering_workflow_context(c) and bx1_portal.admission_mandate_actor(c,target_scope,actor_role)
    else bx1_portal.representative_mandate_actor(c,target_scope,actor_role) end;
$$;

create function bx1_portal.offering_workflow_people_independent(a uuid,b uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session()
    then bx1_portal.offering_workflow_person_current(a) and bx1_portal.offering_workflow_person_current(b)
      and bx1_portal.admission_people_independent(a,b)
    else bx1_portal.entity_people_independent(a,b) end;
$$;

create function bx1_portal.offering_workflow_lock_people(users uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.admission_password_session() then
    perform au.id from auth.users as au where au.id=any(users) order by au.id for share;
    perform id from public.bx1_profiles where id=any(users) order by id for share;
    perform bx1_portal.admission_lock_people(users);
  else perform bx1_portal.lock_entity_people(users); end if;
end $$;

create function bx1_portal.offering_workflow_lineage_independent(target_actor uuid,target_product uuid,target_terms_hash text) returns boolean
language sql volatile security definer set search_path='' as $$
  select target_actor is not null and target_product is not null and target_terms_hash is not null
    and not exists(select 1 from bx1_portal.offering_revisions prior
      where prior.product_id=target_product and prior.origin='SUBMITTED' and prior.terms_hash=target_terms_hash
        and bx1_portal.offering_workflow_people_independent(target_actor,prior.submitted_by) is not true);
$$;

create function bx1_portal.offering_workflow_lock_lineage_people(target_product uuid,target_terms_hash text,users uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$
declare all_users uuid[];
begin
  select pg_catalog.array_agg(distinct u order by u) into all_users from (
    select pg_catalog.unnest(users) u union select r.submitted_by
      from bx1_portal.offering_revisions r where r.product_id=target_product
        and r.origin='SUBMITTED' and r.terms_hash=target_terms_hash) x where u is not null;
  perform bx1_portal.offering_workflow_lock_people(all_users);
end $$;

create function bx1_portal.offering_workflow_reviewer(c jsonb,target_product uuid,target_scope uuid,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session()
    then bx1_portal.offering_workflow_product_appointment_authorised(c,target_product,'ComplianceOfficer')
    else bx1_portal.scoped_reviewer(c,target_scope,target_org) end;
$$;

create function bx1_portal.offering_workflow_appointment_source_current(target_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_service_appointments a
    join bx1_portal.organisations o on o.id=a.product_organisation_id
    join public.bx1_memberships m on m.id=a.native_membership_id
      and m.user_id=a.appointee_user_id and m.role=a.role and m.organisation_id=a.reviewer_scope_organisation_id
    where a.id=target_id and a.requested_until>pg_catalog.clock_timestamp()
      and o.reviewer_scope=a.reviewer_scope_organisation_id
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.offering_workflow_person_current(a.appointee_user_id)
      and bx1_portal.offering_workflow_manager_current(a.requested_by_user_id,o.id,
        (a.requested_in_context->>'organisationId')::uuid));
$$;
create function bx1_portal.offering_workflow_issuer_authorised(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
    join public.bx1_memberships m on m.user_id=auth.uid()
      and m.organisation_id=(c->>'organisationId')::uuid and m.role='IssuerFundManager'
    where p.id=target_product and (bx1_portal.offering_workflow_context(c) or bx1_portal.offering_issuer_session_assured(c))
      and bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'IssuerFundManager')
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),p.created_by)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),o.owner_id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),r.submitted_by)
      and bx1_portal.current_product_organisation(o.id)
      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash
      and not exists(select 1 from bx1_portal.offering_decisions d
        where d.offering_revision_id=r.id and d.decision_kind='ISSUER'));
$$;

create function bx1_portal.offering_workflow_approved(target_product uuid) returns boolean
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
      and bx1_portal.offering_workflow_product_appointment_effective(ia.id)
      and bx1_portal.offering_workflow_product_appointment_effective(ca.id)
      and bx1_portal.offering_workflow_people_independent(issuer.actor_id,compliance.actor_id)
      and bx1_portal.offering_workflow_lineage_independent(issuer.actor_id,p.id,r.terms_hash)
      and bx1_portal.offering_workflow_lineage_independent(compliance.actor_id,p.id,r.terms_hash));
$$;

create function bx1_portal.offering_workflow_package_projection_base(c jsonb,target_product uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; r bx1_portal.offering_revisions;
  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;
  can_issuer boolean; can_compliance boolean; is_ready boolean;
begin
  select * into p from bx1_portal.products where id=target_product;
  if p.id is null or p.current_offering_revision_id is null then return null; end if;
  select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id and product_id=p.id;
  if r.id is null or r.origin<>'SUBMITTED' then return null; end if;
  select * into issuer from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='ISSUER';
  select * into compliance from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='COMPLIANCE';
  can_issuer:=p.status in ('IN_REVIEW','APPROVED') and bx1_portal.offering_workflow_issuer_authorised(c,p.id)
    and (compliance.id is null or bx1_portal.offering_workflow_people_independent(auth.uid(),compliance.actor_id));
  can_compliance:=p.status='IN_REVIEW' and compliance.id is null
    and bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')
    and bx1_portal.offering_workflow_people_independent(auth.uid(),r.submitted_by)
    and (issuer.id is null or bx1_portal.offering_workflow_people_independent(auth.uid(),issuer.actor_id));
  is_ready:=false;
  return pg_catalog.jsonb_build_object(
    'id',r.id,'package_number',r.package_number,'origin',r.origin,
    'product_revision_at_submission',r.product_revision_at_submission,
    'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,'submitted_at',r.submitted_at,
    'issuer_status',coalesce(issuer.decision,'PENDING'),
    'compliance_status',coalesce(compliance.decision,'PENDING'),
    'issuer_review_notes',case when bx1_portal.offering_workflow_operator(c,p.organisation_id)
      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')
      then issuer.notes end,
    'issuer_review_checks',case when bx1_portal.offering_workflow_operator(c,p.organisation_id)
      or bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer')
      then issuer.checks else null end,
    'technical_readiness_status','NOT_VERIFIED',
    'status',case when issuer.decision='CHANGES_REQUIRED' or compliance.decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'
      when issuer.decision='APPROVED' and compliance.decision='APPROVED'
        and bx1_portal.offering_workflow_approved(p.id) then 'APPROVED_AWAITING_READINESS'
      when issuer.decision='APPROVED' and compliance.decision='APPROVED' then 'AUTHORITY_EXPIRED'
      else 'IN_REVIEW' end,
    'can_review_issuer',can_issuer,'can_review_compliance',can_compliance,
    'publishable',p.status='APPROVED' and is_ready,
    'subscribable',p.status='PUBLISHED' and is_ready);
end $$;

create function bx1_portal.offering_workflow_package_projection(c jsonb,target_product uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; p bx1_portal.products; r bx1_portal.offering_revisions;
  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;
  appointed boolean; can_review boolean;
begin
  result:=bx1_portal.offering_workflow_package_projection_base(c,target_product);
  if result is null then return null; end if;
  select * into p from bx1_portal.products where id=target_product;
  select * into r from bx1_portal.offering_revisions
    where id=p.current_offering_revision_id and product_id=p.id;
  select * into issuer from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='ISSUER';
  select * into compliance from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='COMPLIANCE';
  appointed:=bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,'ComplianceOfficer');
  can_review:=appointed and p.status='IN_REVIEW' and compliance.id is null
    and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms
    and bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash)
    and bx1_portal.offering_workflow_people_independent(auth.uid(),p.created_by)
    and bx1_portal.offering_workflow_people_independent(auth.uid(),
      (select o.owner_id from bx1_portal.organisations o where o.id=p.organisation_id))
    and (issuer.id is null or bx1_portal.offering_workflow_people_independent(auth.uid(),issuer.actor_id));
  result:=pg_catalog.jsonb_set(result,'{can_review_compliance}',pg_catalog.to_jsonb(can_review));
  if coalesce((result->>'can_review_issuer')::boolean,false)
    and bx1_portal.offering_workflow_lineage_independent(auth.uid(),p.id,r.terms_hash) is not true then
    result:=pg_catalog.jsonb_set(result,'{can_review_issuer}','false'::jsonb);
  end if;
  if appointed then
    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}',
      coalesce(pg_catalog.to_jsonb(issuer.notes),'null'::jsonb));
    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}',
      coalesce(pg_catalog.to_jsonb(issuer.checks),'null'::jsonb));
  elsif bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then
    result:=pg_catalog.jsonb_set(result,'{issuer_review_notes}','null'::jsonb);
    result:=pg_catalog.jsonb_set(result,'{issuer_review_checks}','null'::jsonb);
  end if;
  return result;
end $$;

create function bx1_portal.offering_workflow_appointment_projection(c jsonb,target_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.product_service_appointments;
  is_manager boolean; is_reviewer boolean; is_admin boolean; is_appointee boolean;
begin
  if (bx1_portal.valid_operating_context(c) or bx1_portal.offering_workflow_context(c)) is not true then return null; end if;
  select * into a from bx1_portal.product_service_appointments where id=target_id;
  if a.id is null then return null; end if;
  is_manager:=a.requested_by_user_id=auth.uid() and c=a.requested_in_context
    and bx1_portal.offering_workflow_operator(c,a.product_organisation_id);
  is_reviewer:=c->>'role'='ComplianceOfficer' and
    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer');
  is_admin:=c->>'role'='SuperAdmin' and
    bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin');
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
    'revoke_reason',a.revoke_reason,'effective',bx1_portal.offering_workflow_product_appointment_effective(a.id),
    'next_owner',case when a.status in ('SUBMITTED','APPROVED')
        and a.requested_until<=pg_catalog.clock_timestamp() then 'OFFERING_MANAGER'
      when a.status='SUBMITTED' then 'COMPLIANCE'
      when a.status='APPROVED' then 'SUPER_ADMIN'
      when a.status='APPLIED' and bx1_portal.offering_workflow_product_appointment_effective(a.id) is not true
        then 'SUPER_ADMIN'
      when a.status in ('CHANGES_REQUIRED','REJECTED') then 'OFFERING_MANAGER'
      else 'NONE' end,
    'can_review',is_reviewer and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='SUBMITTED'
      and a.requested_until>pg_catalog.clock_timestamp()
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id),
    'can_apply',is_admin and bx1_portal.offering_workflow_appointment_source_current(a.id) and a.status='APPROVED'
      and a.requested_until>pg_catalog.clock_timestamp()
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.reviewed_by_user_id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id),
    'can_revoke',not bx1_portal.admission_password_session() and is_admin and a.status='APPLIED'
      and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id));
end $$;

create function bx1_portal.offering_workflow_lock_organisation(c jsonb,target_org uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare source_id uuid; actual_source uuid;
begin
  if bx1_portal.admission_password_session() is not true then return; end if;
  select application_id into source_id from bx1_portal.organisations where id=target_org;
  perform id from bx1_portal.applications where id=source_id for share;
  perform application_id from bx1_portal.customer_monitoring_cases where application_id=source_id for share;
  select application_id into actual_source from bx1_portal.organisations where id=target_org for share;
  perform id from bx1_portal.representative_mandates where product_organisation_id=target_org order by id for share;
  perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=target_org order by id for share;
  if source_id is null or actual_source is distinct from source_id
    or bx1_portal.offering_workflow_operator(c,target_org) is not true then
    raise exception 'offering_organisation_authority_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.offering_workflow_base_operator(c jsonb,target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when c is null then bx1_portal.is_operator(target_org)
    else bx1_portal.offering_workflow_operator(c,target_org) end;
$$;

create function bx1_portal.offering_workflow_base_reviewer(c jsonb,target_product uuid,target_scope uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when c is null then bx1_portal.is_reviewer(target_scope)
    else bx1_portal.offering_workflow_product_appointment_authorised(c,target_product,'ComplianceOfficer') end;
$$;

create function bx1_portal.offering_workflow_base_independent(c jsonb,target_actor uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when c is null then bx1_portal.independent_of(target_actor)
    else bx1_portal.offering_workflow_people_independent(auth.uid(),target_actor) end;
$$;

create function bx1_portal.offering_workflow_access(c jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.offering_workflow_context(c) then
    pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','actor_id',auth.uid(),
      'operating_context',c,'session_mode','TEST_PASSWORD',
      'allowed_commands',(select coalesce(pg_catalog.jsonb_agg(action order by ordinal),'[]'::jsonb)
        from pg_catalog.unnest(array['create_product','save_product','submit_product',
          'begin_offering_amendment','reopen_offering_review','request_product_service_appointment',
          'review_offering_issuer','review_product','review_product_service_appointment',
          'apply_product_service_appointment']) with ordinality x(action,ordinal)
        where bx1_portal.offering_workflow_command_allowed(c,action)))
    else null end;
$$;


create function bx1_portal.offering_workflow_product_visible(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.offering_workflow_context(c) and exists(select 1 from bx1_portal.products p
    where p.id=target_product and
      bx1_portal.current_product_organisation(p.organisation_id)
      and exists(select 1 from bx1_portal.organisations owner_org join bx1_portal.representative_mandates owner_m
        on owner_m.product_organisation_id=owner_org.id where owner_org.id=p.organisation_id
          and bx1_portal.offering_workflow_manager_current(owner_org.owner_id,owner_org.id,owner_m.native_organisation_id))
      and ((c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,p.organisation_id))
      or (c->>'role' in ('IssuerFundManager','ComplianceOfficer')
        and bx1_portal.offering_workflow_product_appointment_authorised(c,p.id,c->>'role'))
      or (c->>'role'='ComplianceOfficer' and exists(select 1 from bx1_portal.product_service_appointments a
        where a.product_id=p.id and a.status='SUBMITTED' and bx1_portal.offering_workflow_appointment_source_current(a.id)
          and bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer')
          and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
          and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)))
      or (c->>'role'='SuperAdmin' and exists(select 1 from bx1_portal.product_service_appointments a
        where a.product_id=p.id and a.approval_receipt_id is not null
          and bx1_portal.offering_workflow_appointment_source_current(a.id)
          and (a.status='APPROVED' or (a.status='APPLIED' and a.applied_by_user_id=auth.uid()
            and a.applied_at is not null and bx1_portal.offering_workflow_product_appointment_effective(a.id)))
          and bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'SuperAdmin')
          and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
          and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)
          and bx1_portal.offering_workflow_people_independent(auth.uid(),a.reviewed_by_user_id)))));
$$;

create function bx1_portal.offering_workflow_appointment_visible(c jsonb,target_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.product_service_appointments; o bx1_portal.organisations; v jsonb;
begin
  if bx1_portal.offering_workflow_context(c) is not true then return false; end if;
  select * into a from bx1_portal.product_service_appointments where id=target_id;
  select * into o from bx1_portal.organisations where id=a.product_organisation_id;
  if a.id is null or o.id is null or bx1_portal.current_product_organisation(o.id) is not true
    or not exists(select 1 from bx1_portal.representative_mandates m where m.product_organisation_id=o.id
      and bx1_portal.offering_workflow_manager_current(o.owner_id,o.id,m.native_organisation_id)) then return false; end if;
  v:=bx1_portal.offering_workflow_appointment_projection(c,a.id);
  if v is null then return false; end if;
  if c->>'role'='OfferingManager' then
    return a.requested_by_user_id=auth.uid() and a.requested_in_context=c
      and bx1_portal.offering_workflow_operator(c,o.id);
  elsif c->>'role'='IssuerFundManager' then
    return a.appointee_user_id=auth.uid() and a.role='IssuerFundManager'
      and bx1_portal.offering_workflow_product_appointment_authorised(c,a.product_id,'IssuerFundManager');
  elsif c->>'role'='ComplianceOfficer' then
    return coalesce((v->>'can_review')::boolean,false)
      or bx1_portal.offering_workflow_product_appointment_authorised(c,a.product_id,'ComplianceOfficer')
      or (a.reviewed_by_user_id=auth.uid() and a.approval_receipt_id is not null and a.reviewed_at is not null
        and bx1_portal.offering_workflow_staff(c,a.reviewer_scope_organisation_id,'ComplianceOfficer')
        and bx1_portal.offering_workflow_appointment_source_current(a.id)
        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.requested_by_user_id)
        and bx1_portal.offering_workflow_people_independent(auth.uid(),a.appointee_user_id)
        and (a.status='APPROVED' or (a.status='APPLIED' and bx1_portal.offering_workflow_product_appointment_effective(a.id))));
  elsif c->>'role'='SuperAdmin' then
    return coalesce((v->>'can_apply')::boolean,false)
      or (a.status='APPLIED' and a.applied_by_user_id=auth.uid() and a.applied_at is not null
        and a.approval_receipt_id is not null and bx1_portal.offering_workflow_product_appointment_effective(a.id));
  end if;
  return false;
end $$;

create function bx1_portal.offering_workflow_read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; visible_ids uuid[]; products_json jsonb; orgs_json jsonb;
  appointments_json jsonb; candidates_json jsonb; v_product bx1_portal.products;
  package jsonb; actions jsonb; shown jsonb;
begin
  if bx1_portal.offering_workflow_context(c) is not true then
    raise exception 'offering_package_read_denied' using errcode='42501'; end if;
  perform bx1_portal.admission_lock_actor(null,c);
  perform bx1_portal.admission_lock_people(array[auth.uid()]);
  if c->>'role' in ('ComplianceOfficer','SuperAdmin') then
    result:=bx1_portal.admission_read_scoped(c);
  else
    select pg_catalog.jsonb_build_object('operating_context',c,
      'stage2_access',bx1_portal.admission_access(c),
      'actor',pg_catalog.jsonb_build_object('id',auth.uid(),'email',u.email,
        'display_name',(select display_name from public.bx1_profiles where id=auth.uid()),'can_review',false),
      'applications','[]'::jsonb,'organisations','[]'::jsonb,'accounts','[]'::jsonb,
      'entity_investment_accounts','[]'::jsonb,'organisation_mandates','[]'::jsonb,
      'investing_representative_mandates','[]'::jsonb,'subscriptions','[]'::jsonb,
      'products','[]'::jsonb,'product_eligibility','[]'::jsonb,'entity_product_eligibility','[]'::jsonb,
      'customer_monitoring','[]'::jsonb,'funding','[]'::jsonb,'events','[]'::jsonb,'requests','[]'::jsonb,
      'product_appointments','[]'::jsonb,'product_appointment_candidates','[]'::jsonb)
      into result from auth.users u where u.id=auth.uid();
  end if;
  -- Select exact current products before any package/history/decision projection.
  select coalesce(pg_catalog.array_agg(p.id order by p.id),'{}'::uuid[]) into visible_ids
    from bx1_portal.products p where bx1_portal.offering_workflow_product_visible(c,p.id);
  products_json:='[]'::jsonb;
  for v_product in select * from bx1_portal.products where id=any(visible_ids)
    and c->>'role'<>'SuperAdmin' order by created_at,id loop
    package:=bx1_portal.offering_workflow_package_projection(c,v_product.id); actions:='[]'::jsonb;
    if c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,v_product.organisation_id) then
      if v_product.status in ('DRAFT','CHANGES_REQUIRED') then
        actions:=actions||'["save_product"]'::jsonb;
        if not exists(select 1 from (select r.terms_hash from bx1_portal.offering_revisions r
          where r.product_id=v_product.id and r.origin='SUBMITTED' order by r.package_number desc limit 1) latest
          where latest.terms_hash=v_product.terms_hash) then actions:=actions||'["submit_product"]'::jsonb; end if;
      end if;
      actions:=actions||'["request_product_service_appointment"]'::jsonb;
      if bx1_portal.offering_amendment_beginable(v_product.id) then actions:=actions||'["begin_offering_amendment"]'::jsonb; end if;
      if bx1_portal.offering_review_reopenable(v_product.id) then actions:=actions||'["reopen_offering_review"]'::jsonb; end if;
    elsif c->>'role'='IssuerFundManager' and coalesce((package->>'can_review_issuer')::boolean,false) then
      actions:='["review_offering_issuer"]'::jsonb;
    elsif c->>'role'='ComplianceOfficer' and coalesce((package->>'can_review_compliance')::boolean,false) then
      actions:='["review_product"]'::jsonb;
    end if;
    shown:=(pg_catalog.to_jsonb(v_product)-array['cap_units','minimum_units','unit_price_minor'])||
      pg_catalog.jsonb_build_object('reserved_units',v_product.reserved_units::text,
        'offering_package',package,'offering_history',bx1_portal.offering_history_projection(v_product.id),
        'allowed_actions',actions);
    products_json:=products_json||pg_catalog.jsonb_build_array(shown);
  end loop;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'name',o.name,'status',o.status)
    ||case when c->>'role'='OfferingManager' then pg_catalog.jsonb_build_object(
      'native_organisation_id',c->>'organisationId','roles','["OfferingManager"]'::jsonb,
      'authority_source','NATIVE_BINDING',
      'capabilities','["create_product","save_product","submit_product","request_product_service_appointment","begin_offering_amendment","reopen_offering_review"]'::jsonb)
      else pg_catalog.jsonb_build_object('roles','[]'::jsonb,'capabilities','[]'::jsonb) end
    order by o.id),'[]'::jsonb) into orgs_json
    from bx1_portal.organisations o where c->>'role'<>'SuperAdmin' and (
      (c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,o.id))
      or exists(select 1 from bx1_portal.products p where p.organisation_id=o.id and p.id=any(visible_ids)));
  select coalesce(pg_catalog.jsonb_agg(v.value order by a.requested_at,a.id),'[]'::jsonb) into appointments_json
    from bx1_portal.product_service_appointments a
    cross join lateral (select bx1_portal.offering_workflow_appointment_projection(c,a.id) value) v
    where v.value is not null and bx1_portal.offering_workflow_appointment_visible(c,a.id);
  select coalesce(pg_catalog.jsonb_agg(candidate.value order by candidate.product_id,candidate.role,
    candidate.display_name,candidate.user_id),'[]'::jsonb) into candidates_json from (
    select p.id product_id,m.role,profile.display_name,m.user_id,
      pg_catalog.jsonb_build_object('product_id',p.id,'role',m.role,'user_id',m.user_id,
        'membership_id',m.id,'display_name',profile.display_name,'email',u.email) value
    from bx1_portal.products p join bx1_portal.organisations o on o.id=p.organisation_id
    join public.bx1_memberships m on m.organisation_id=o.reviewer_scope and m.role in ('IssuerFundManager','ComplianceOfficer')
    join public.bx1_profiles profile on profile.id=m.user_id join auth.users u on u.id=m.user_id
    where c->>'role'='OfferingManager' and p.id=any(visible_ids)
      and bx1_portal.offering_workflow_operator(c,p.organisation_id)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.offering_workflow_people_independent(auth.uid(),m.user_id)
    order by p.id,m.role,profile.display_name,m.user_id limit 100) candidate;
  result:=result||pg_catalog.jsonb_build_object('offering_access',bx1_portal.offering_workflow_access(c),
    'products',products_json,'organisations',orgs_json,'product_appointments',appointments_json,
    'product_appointment_candidates',candidates_json);
  -- Durable recovery exposes only the actor's context/family keys, never payloads.
  -- Preserve inherited admission receipts while appending the two package journals.
  result:=pg_catalog.jsonb_set(result,'{requests}',coalesce((
    select pg_catalog.jsonb_agg(value order by value->>'key',value->>'command') from (
      select distinct value from pg_catalog.jsonb_array_elements(coalesce(result->'requests','[]'::jsonb)) x(value)
      union
      select pg_catalog.jsonb_build_object('key',r.request_key,'command',r.command) from (
        select request_key,command,created_at from (
          select request_key,command,created_at from bx1_portal.scoped_requests
            where actor_id=auth.uid() and operating_context=c
              and bx1_portal.offering_workflow_command_allowed(c,command)
          union all
          select request_key,command,created_at from bx1_portal.product_service_appointment_requests
            where actor_id=auth.uid() and operating_context=c
              and bx1_portal.offering_workflow_command_allowed(c,command)) journal
          where journal.created_at>=pg_catalog.clock_timestamp()-interval '7 days'
          order by created_at desc,request_key,command limit 1000) r
    ) all_keys(value)
  ),'[]'::jsonb));
  -- One bounded return-time predicate, not a serial check loop or blanket row locks.
  -- A completed concurrent authority change denies this response rather than returning cached history.
  if bx1_portal.offering_workflow_context(c) is not true
    or exists(select 1 from pg_catalog.jsonb_array_elements(products_json) x(value)
      where bx1_portal.offering_workflow_product_visible(c,(value->>'id')::uuid) is not true
        or not exists(select 1 from bx1_portal.products live where live.id=(value->>'id')::uuid
          and live.revision=(value->>'revision')::integer and live.status=value->>'status'
          and live.terms_hash=value->>'terms_hash'
          and live.current_offering_revision_id is not distinct from (value->>'current_offering_revision_id')::uuid)
        or coalesce(bx1_portal.offering_workflow_package_projection(c,(value->>'id')::uuid),'null'::jsonb)
          is distinct from value->'offering_package'
        or bx1_portal.offering_history_projection((value->>'id')::uuid)
          is distinct from value->'offering_history')
    or exists(select 1 from pg_catalog.jsonb_array_elements(orgs_json) x(value)
      where (c->>'role'='OfferingManager' and bx1_portal.offering_workflow_operator(c,(value->>'id')::uuid) is not true)
        or (c->>'role'<>'OfferingManager' and not exists(select 1 from bx1_portal.products p
          where p.organisation_id=(value->>'id')::uuid and p.id=any(visible_ids)
            and bx1_portal.offering_workflow_product_visible(c,p.id))))
    or exists(select 1 from pg_catalog.jsonb_array_elements(appointments_json) x(value)
      where bx1_portal.offering_workflow_appointment_visible(c,(value->>'id')::uuid) is not true
        or bx1_portal.offering_workflow_appointment_projection(c,(value->>'id')::uuid) is distinct from value)
    or exists(select 1 from pg_catalog.jsonb_array_elements(candidates_json) x(value)
      where not exists(select 1 from public.bx1_memberships m join bx1_portal.products p
        on p.id=(value->>'product_id')::uuid join bx1_portal.organisations o on o.id=p.organisation_id
        where m.id=(value->>'membership_id')::uuid and m.user_id=(value->>'user_id')::uuid
          and m.role=value->>'role' and m.organisation_id=o.reviewer_scope
          and bx1_portal.offering_workflow_operator(c,p.organisation_id)
          and bx1_portal.native_membership_effective(m.id)
          and bx1_portal.offering_workflow_people_independent(auth.uid(),m.user_id))) then
    raise exception 'offering_package_read_authority_changed' using errcode='42501'; end if;
  return result;
end $$;

-- The retained product branches are moved once; legacy entrypoints delegate below.
create function bx1_portal.offering_workflow_base_command(c jsonb,command text,request_key uuid,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_request bx1_portal.requests; a bx1_portal.applications;
  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions;
  v_subject uuid; v_application uuid; v_org uuid; v_investor uuid; v_units numeric; v_revision integer;
  v_now timestamptz:=clock_timestamp(); v_summary text;
begin
  if command not in ('create_product','save_product','submit_product','review_product')
    or (bx1_portal.admission_password_session() and (c is null or bx1_portal.offering_workflow_command_allowed(c,command) is not true)) then
    raise exception 'offering_base_package_command_denied' using errcode='42501'; end if;
  if (bx1_portal.has_session() or bx1_portal.admission_password_session()) is not true then raise exception 'portal_session_required' using errcode='42501'; end if;
  if request_key is null or request_key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;
  -- All commands by one principal serialize, including first application creation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));
  if (bx1_portal.has_session() or bx1_portal.admission_password_session()) is not true then raise exception 'portal_session_required' using errcode='42501'; end if;
  select * into v_request from bx1_portal.requests r where r.actor_id=v_actor and r.request_key=offering_workflow_base_command.request_key;
  if found then
    if v_request.command is distinct from command or v_request.payload is distinct from payload then raise exception 'portal_idempotency_conflict' using errcode='23505'; end if;
    -- Fresh scoped view, not a historical snapshot that could disclose revoked access.
    if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;
    return bx1_portal.read_state();
  end if;
  if command='create_product' then
    perform bx1_portal.require_keys(payload,array['organisation_id','terms']);
    v_org:=(payload->>'organisation_id')::uuid;
    if c is not null then perform bx1_portal.offering_workflow_lock_organisation(c,v_org); end if;
    if not bx1_portal.offering_workflow_base_operator(c,v_org) then raise exception 'portal_operator_denied' using errcode='42501'; end if;
    perform bx1_portal.validate_terms(payload->'terms');
    insert into bx1_portal.products(organisation_id,created_by,terms,terms_hash,cap_units,unit_price_minor,minimum_units)
      values(v_org,v_actor,payload->'terms',encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),(payload#>>'{terms,cap_units}')::numeric,(payload#>>'{terms,unit_price_minor}')::numeric,(payload#>>'{terms,minimum_units}')::numeric) returning * into p;
    v_subject:=p.id; v_summary:='Typed test product draft created. No assets or tokens issued.';
  elsif command in ('save_product','submit_product','review_product') then
    if command='save_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms']);
    elsif command='review_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','decision','notes','checks']);
    else perform bx1_portal.require_keys(payload,array['product_id','expected_revision']); end if;
    if c is not null then perform bx1_portal.offering_workflow_lock_product(c,(payload->>'product_id')::uuid); end if;
    select * into p from bx1_portal.products where id=(payload->>'product_id')::uuid for update;
    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;
    select * into o from bx1_portal.organisations where id=p.organisation_id;
    if command='review_product' then
      if not bx1_portal.offering_workflow_base_reviewer(c,p.id,o.reviewer_scope) or not bx1_portal.offering_workflow_base_independent(c,p.created_by) or not bx1_portal.offering_workflow_base_independent(c,o.owner_id) or not bx1_portal.organisation_active(o.id) then raise exception 'portal_review_denied' using errcode='42501'; end if;
    elsif not bx1_portal.offering_workflow_base_operator(c,o.id) then raise exception 'portal_operator_denied' using errcode='42501'; end if;
    if jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or p.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_product' using errcode='23514'; end if;
    v_subject:=p.id; v_org:=p.organisation_id;
    if command='save_product' then
      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_terms_locked' using errcode='23514'; end if;
      perform bx1_portal.validate_terms(payload->'terms');
      update bx1_portal.products set terms=payload->'terms',terms_hash=encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),cap_units=(payload#>>'{terms,cap_units}')::numeric,unit_price_minor=(payload#>>'{terms,unit_price_minor}')::numeric,minimum_units=(payload#>>'{terms,minimum_units}')::numeric,revision=revision+1,status='DRAFT',reviewer_id=null,review_notes=null,reviewed_at=null,review_checks='{}' where id=p.id;
      v_summary:='Test product draft terms revised; earlier review no longer applies.';
    elsif command='submit_product' then
      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;
      update bx1_portal.products set status='IN_REVIEW',revision=revision+1 where id=p.id;
      v_summary:='Test offering submitted for independent compliance review.';
    elsif command='review_product' then
      perform bx1_portal.require_text(payload,'notes',20,3000);
      if coalesce(payload->>'decision','') not in ('APPROVED','CHANGES_REQUIRED') or p.status<>'IN_REVIEW' then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;
      perform bx1_portal.require_checks(payload->'checks',array['issuer','terms','disclosures','eligibility'],payload->>'decision'='APPROVED');
      update bx1_portal.products set status=payload->>'decision',revision=revision+1,reviewer_id=v_actor,review_notes=payload->>'notes',reviewed_at=v_now,review_checks=payload->'checks' where id=p.id;
      v_summary:='Independent test offering review: '||(payload->>'decision')||'.';
    end if;
  else raise exception 'offering_base_package_command_denied' using errcode='42501'; end if;
  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,request_key,command,payload);
  insert into bx1_portal.events(subject_id,application_id,organisation_id,investor_id,kind,actor_id,summary)
    values(v_subject,v_application,v_org,v_investor,command,v_actor,v_summary);
  if c is not null then return bx1_portal.offering_workflow_read_scoped(c); end if;
  return bx1_portal.read_state();
end
$$;

create function bx1_portal.offering_workflow_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.offering_workflow_command_allowed(c,action) is not true then
    raise exception 'offering_package_command_denied' using errcode='42501'; end if;
  if action='create_product' then return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);
  elsif action='save_product' then
    if body#>'{terms,terms_version}'='2'::jsonb and body#>>'{terms,asset_type}'='FUND' then
      return bx1_portal.save_fund_v2_scoped(c,key,body);
    elsif body#>'{terms,terms_version}'='2'::jsonb and body#>>'{terms,asset_type}'='REAL_ESTATE' then
      return bx1_portal.save_real_estate_v2_scoped(c,key,body);
    end if;
    return bx1_portal.execute_scoped_pre_monitoring(c,action,key,body);
  elsif action in ('submit_product','review_offering_issuer') then
    return bx1_portal.execute_scoped_pre_monitoring(c,action,key,body);
  elsif action='review_product' then return bx1_portal.execute_appointed_compliance_decision(c,key,body);
  elsif action in ('request_product_service_appointment','review_product_service_appointment','apply_product_service_appointment') then
    return bx1_portal.execute_product_service_appointment(c,action,key,body);
  elsif action='begin_offering_amendment' then return bx1_portal.execute_begin_offering_amendment(c,key,body);
  elsif action='reopen_offering_review' then return bx1_portal.execute_reopen_offering_review(c,key,body);
  end if;
  raise exception 'offering_package_command_denied' using errcode='42501';
end $$;

create function bx1_portal.offering_workflow_parent_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.admission_password_session() and action in ('save_product','submit_product') then
    if bx1_portal.offering_workflow_command_allowed(c,action) is not true then
      raise exception 'offering_package_parent_command_denied' using errcode='42501'; end if;
    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body);
  end if;
  return bx1_portal.execute_scoped_pre_offering(c,action,key,body);
end $$;

-- Whole-body fingerprints derive from retained migrations, entry alias qualifier rewrite,
-- and exact accepted admission/representatives recipes. Only the retained reader
-- recipe changes here; the other thirteen entries and all target identities remain exact.
do $offering_cutover$
declare spec jsonb; change jsonb; target oid; source_body text; next_body text;
  definition text; before_meta jsonb; after_meta jsonb; occurrences integer;
begin
  -- Static marker families are necessary-only. Their unchanged current authority
  -- must match the accepted complete body before any retained recipe is installed.
  target:=pg_catalog.to_regprocedure('bx1_portal.admission_command_allowed(jsonb,text)');
  if target is null then raise exception 'offering_workflow_admission_authority_missing' using errcode='55000'; end if;
  select p.prosrc,pg_catalog.jsonb_build_object('owner',p.proowner,'security_definer',p.prosecdef,
    'configuration',p.proconfig,'kind',p.prokind,'language',p.prolang,'volatility',p.provolatile)
    into source_body,before_meta from pg_catalog.pg_proc p where p.oid=target;
  if before_meta->>'owner' is distinct from ('postgres'::regrole::oid)::text
    or before_meta->>'security_definer' is distinct from 'true'
    or before_meta->'configuration' is distinct from '["search_path=\"\""]'::jsonb
    or before_meta->>'kind' is distinct from 'f'
    or before_meta->>'language' is distinct from (select oid::text from pg_catalog.pg_language where lanname='plpgsql')
    or before_meta->>'volatility' is distinct from 'v'
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      is distinct from 'f30143f864299f2edfa1fa7630167125212327c030aa7a35b3474625a9a57ea2' then
    raise exception 'offering_workflow_admission_authority_changed' using errcode='55000'; end if;
  for spec in select value from pg_catalog.jsonb_array_elements($offering_recipes$
[
  {
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "expected_sha256": "d35ef9590bcc28e59d1664630099c2a3f4b3b34151fce2f6d9f74a3f6ec6c707",
    "changes": [
      {
        "from": "bx1_portal.admission_command_allowed(c,action)",
        "to": "bx1_portal.offering_workflow_command_context(c,action)",
        "count": 1
      },
      {
        "from": "bx1_portal.admission_lock_actor(action,c)",
        "to": "bx1_portal.offering_workflow_lock_actor(action,c)",
        "count": 1
      },
      {
        "from": "bx1_portal.admission_command_context(c,action)",
        "to": "bx1_portal.offering_workflow_command_context(c,action)",
        "count": 3
      },
      {
        "from": "bx1_portal.scoped_operator(c,",
        "to": "bx1_portal.offering_workflow_operator(c,",
        "count": 2
      },
      {
        "from": "bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)",
        "to": "bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id)",
        "count": 2
      },
      {
        "from": "  if v_org is not null then\n    select * into o",
        "to": "  if v_org is not null then\n    if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_allowed(c,action) then\n      if action='create_product' then perform bx1_portal.offering_workflow_lock_organisation(c,v_org);\n      else perform bx1_portal.offering_workflow_lock_product(c,p.id); end if;\n    end if;\n    select * into o",
        "count": 1
      },
      {
        "from": "    ignored:=bx1_portal.execute_command(action,key,forwarded);",
        "to": "    if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_allowed(c,action) then\n      ignored:=bx1_portal.offering_workflow_base_command(c,action,key,forwarded);\n    else ignored:=bx1_portal.execute_command(action,key,forwarded); end if;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_command_pre_entry(text,uuid,jsonb)",
    "expected_sha256": "85a334a24f723af28a178563c01ed208d66df3459813285e15678cfbca3445df",
    "changes": [
      {
        "from": "  elsif command='create_product' then\n    perform bx1_portal.require_keys(payload,array['organisation_id','terms']);\n    v_org:=(payload->>'organisation_id')::uuid;\n    if not bx1_portal.is_operator(v_org) then raise exception 'portal_operator_denied' using errcode='42501'; end if;\n    perform bx1_portal.validate_terms(payload->'terms');\n    insert into bx1_portal.products(organisation_id,created_by,terms,terms_hash,cap_units,unit_price_minor,minimum_units)\n      values(v_org,v_actor,payload->'terms',encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),(payload#>>'{terms,cap_units}')::numeric,(payload#>>'{terms,unit_price_minor}')::numeric,(payload#>>'{terms,minimum_units}')::numeric) returning * into p;\n    v_subject:=p.id; v_summary:='Typed test product draft created. No assets or tokens issued.';\n  elsif command in ('save_product','submit_product','review_product','publish_product','subscribe') then\n    if command='save_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms']);\n    elsif command='review_product' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','decision','notes','checks']);\n    elsif command='subscribe' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms_hash','units','accepted_documents','accepted_risks']);\n    else perform bx1_portal.require_keys(payload,array['product_id','expected_revision']); end if;\n    select * into p from bx1_portal.products where id=(payload->>'product_id')::uuid for update;\n    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;\n    select * into o from bx1_portal.organisations where id=p.organisation_id;\n    if command='review_product' then\n      if not bx1_portal.is_reviewer(o.reviewer_scope) or not bx1_portal.independent_of(p.created_by) or not bx1_portal.independent_of(o.owner_id) or not bx1_portal.organisation_active(o.id) then raise exception 'portal_review_denied' using errcode='42501'; end if;\n    elsif command='subscribe' then\n      if not bx1_portal.is_eligible(p.terms) or not bx1_portal.organisation_active(o.id) or not bx1_portal.independent_of(o.owner_id) then raise exception 'portal_investor_denied' using errcode='42501'; end if;\n    elsif not bx1_portal.is_operator(o.id) then raise exception 'portal_operator_denied' using errcode='42501'; end if;\n    if jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or p.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_product' using errcode='23514'; end if;\n    v_subject:=p.id; v_org:=p.organisation_id;\n    if command='save_product' then\n      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_terms_locked' using errcode='23514'; end if;\n      perform bx1_portal.validate_terms(payload->'terms');\n      update bx1_portal.products set terms=payload->'terms',terms_hash=encode(sha256(convert_to((payload->'terms')::text,'UTF8')),'hex'),cap_units=(payload#>>'{terms,cap_units}')::numeric,unit_price_minor=(payload#>>'{terms,unit_price_minor}')::numeric,minimum_units=(payload#>>'{terms,minimum_units}')::numeric,revision=revision+1,status='DRAFT',reviewer_id=null,review_notes=null,reviewed_at=null,review_checks='{}' where id=p.id;\n      v_summary:='Test product draft terms revised; earlier review no longer applies.';\n    elsif command='submit_product' then\n      if p.status not in ('DRAFT','CHANGES_REQUIRED') then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;\n      update bx1_portal.products set status='IN_REVIEW',revision=revision+1 where id=p.id;\n      v_summary:='Test offering submitted for independent compliance review.';\n    elsif command='review_product' then\n      perform bx1_portal.require_text(payload,'notes',20,3000);\n      if coalesce(payload->>'decision','') not in ('APPROVED','CHANGES_REQUIRED') or p.status<>'IN_REVIEW' then raise exception 'portal_invalid_product_state' using errcode='23514'; end if;\n      perform bx1_portal.require_checks(payload->'checks',array['issuer','terms','disclosures','eligibility'],payload->>'decision'='APPROVED');\n      update bx1_portal.products set status=payload->>'decision',revision=revision+1,reviewer_id=v_actor,review_notes=payload->>'notes',reviewed_at=v_now,review_checks=payload->'checks' where id=p.id;\n      v_summary:='Independent test offering review: '||(payload->>'decision')||'.';\n    elsif command='publish_product' then\n      if p.status<>'APPROVED' or p.reviewer_id is null then raise exception 'portal_approval_required' using errcode='23514'; end if;\n      update bx1_portal.products set status='PUBLISHED',revision=revision+1,published_at=v_now where id=p.id;\n      v_summary:='Approved test offering published to eligible investors.';\n    else\n      if p.status<>'PUBLISHED' or payload->>'terms_hash' is distinct from p.terms_hash or payload->'accepted_documents' is distinct from 'true'::jsonb or payload->'accepted_risks' is distinct from 'true'::jsonb then raise exception 'portal_terms_acceptance_required' using errcode='23514'; end if;\n      v_units:=bx1_portal.positive(payload->'units');\n      if v_units<p.minimum_units or p.reserved_units+v_units>p.cap_units then raise exception 'portal_capacity_unavailable' using errcode='23514'; end if;\n      insert into bx1_portal.subscriptions(product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)\n        values(p.id,v_actor,p.organisation_id,p.revision,p.terms_hash,p.terms,true,true,v_units,v_units*p.unit_price_minor) returning * into s;\n      update bx1_portal.products set reserved_units=reserved_units+v_units where id=p.id;\n      v_subject:=s.id; v_investor:=v_actor; v_summary:='Test subscription reserved; awaiting funding. No cash received, holding, or token issued.';\n    end if;\n",
        "to": "  elsif command in ('create_product','save_product','submit_product','review_product') then\n    return bx1_portal.offering_workflow_base_command(null,command,request_key,payload);\n  elsif command in ('publish_product','subscribe') then\n    if command='subscribe' then perform bx1_portal.require_keys(payload,array['product_id','expected_revision','terms_hash','units','accepted_documents','accepted_risks']);\n    else perform bx1_portal.require_keys(payload,array['product_id','expected_revision']); end if;\n    select * into p from bx1_portal.products where id=(payload->>'product_id')::uuid for update;\n    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;\n    select * into o from bx1_portal.organisations where id=p.organisation_id;\n    if command='subscribe' then\n      if not bx1_portal.is_eligible(p.terms) or not bx1_portal.organisation_active(o.id) or not bx1_portal.independent_of(o.owner_id) then raise exception 'portal_investor_denied' using errcode='42501'; end if;\n    elsif not bx1_portal.is_operator(o.id) then raise exception 'portal_operator_denied' using errcode='42501'; end if;\n    if jsonb_typeof(payload->'expected_revision') is distinct from 'number' or payload->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' or p.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_product' using errcode='23514'; end if;\n    v_subject:=p.id; v_org:=p.organisation_id;\n    if command='publish_product' then\n      if p.status<>'APPROVED' or p.reviewer_id is null then raise exception 'portal_approval_required' using errcode='23514'; end if;\n      update bx1_portal.products set status='PUBLISHED',revision=revision+1,published_at=v_now where id=p.id;\n      v_summary:='Approved test offering published to eligible investors.';\n    else\n      if p.status<>'PUBLISHED' or payload->>'terms_hash' is distinct from p.terms_hash or payload->'accepted_documents' is distinct from 'true'::jsonb or payload->'accepted_risks' is distinct from 'true'::jsonb then raise exception 'portal_terms_acceptance_required' using errcode='23514'; end if;\n      v_units:=bx1_portal.positive(payload->'units');\n      if v_units<p.minimum_units or p.reserved_units+v_units>p.cap_units then raise exception 'portal_capacity_unavailable' using errcode='23514'; end if;\n      insert into bx1_portal.subscriptions(product_id,investor_id,organisation_id,product_revision,terms_hash,accepted_terms,accepted_documents,accepted_risks,units,amount_minor)\n        values(p.id,v_actor,p.organisation_id,p.revision,p.terms_hash,p.terms,true,true,v_units,v_units*p.unit_price_minor) returning * into s;\n      update bx1_portal.products set reserved_units=reserved_units+v_units where id=p.id;\n      v_subject:=s.id; v_investor:=v_actor; v_summary:='Test subscription reserved; awaiting funding. No cash received, holding, or token issued.';\n    end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "expected_sha256": "14c86a432445c03b0c6e3b3b3b07d31740a6812b11fc7a4da08797501bc3ec7a",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and action='review_product' then\n    return bx1_portal.execute_appointed_compliance_decision(c,key,body); end if;\n",
        "count": 1
      },
      {
        "from": "bx1_portal.admission_command_allowed(c,action)",
        "to": "bx1_portal.offering_workflow_command_context(c,action)",
        "count": 1
      },
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,action)",
        "count": 3
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor(action,c)",
        "count": 1
      },
      {
        "from": "  select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "count": 1
      },
      {
        "from": "bx1_portal.execute_scoped_pre_offering(c,action,key,",
        "to": "bx1_portal.offering_workflow_parent_command(c,action,key,",
        "count": 6
      },
      {
        "from": "bx1_portal.offering_issuer_authorised",
        "to": "bx1_portal.offering_workflow_issuer_authorised",
        "count": 2
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)",
        "to": "bx1_portal.offering_workflow_reviewer(c,p.id,o.reviewer_scope,o.id)",
        "count": 2
      },
      {
        "from": "bx1_portal.entity_people_independent",
        "to": "bx1_portal.offering_workflow_people_independent",
        "count": 4
      },
      {
        "from": "bx1_portal.lock_entity_people",
        "to": "bx1_portal.offering_workflow_lock_people",
        "count": 2
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)",
    "expected_sha256": "49dcdb142027f4b97c736717856eacff57b2b21fc87b0532960ed07982dd0bc9",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_command_allowed(c,action) then\n    return bx1_portal.offering_workflow_command(c,action,key,body); end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.read_scoped(jsonb)",
    "expected_sha256": "24a05351237a5615f91e518ee61d33142d681ad82fed65c8d7595e5de8c47866",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.offering_workflow_context(c) then\n    return bx1_portal.offering_workflow_read_scoped(c); end if;\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.read_scoped_pre_handoff(jsonb)",
    "expected_sha256": "9b410b549291c11fc639ba1968ff6402601f175dc054496d1bfac0304881a37c",
    "changes": [
      {
        "from": "  select coalesce(pg_catalog.jsonb_agg(candidate.value order by candidate.product_id,\n      candidate.role,candidate.display_name,candidate.user_id),'[]'::jsonb)\n    into candidates from (\n      select p.id as product_id,m.role,profile.display_name,m.user_id,\n        pg_catalog.jsonb_build_object('product_id',p.id,'role',m.role,\n          'user_id',m.user_id,'membership_id',m.id,\n          'display_name',profile.display_name,'email',u.email) as value\n      from bx1_portal.products p\n      join bx1_portal.organisations o on o.id=p.organisation_id\n      join public.bx1_memberships m on m.organisation_id=o.reviewer_scope\n        and m.role in ('IssuerFundManager','ComplianceOfficer')\n      join public.bx1_profiles profile on profile.id=m.user_id\n      join auth.users u on u.id=m.user_id and u.email is not null\n      where c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n        and profile.status='ACTIVE'\n        and bx1_portal.scoped_operator(c,p.organisation_id)\n        and bx1_portal.native_membership_effective(m.id)\n        and bx1_portal.entity_people_independent(auth.uid(),m.user_id)\n      order by p.id,m.role,profile.display_name,m.user_id limit 100\n    ) candidate;",
        "to": "  candidates:='[]'::jsonb;\n  if c->>'mode'='ROLE' and c->>'role'='OfferingManager' then\n    with scope_inputs as materialized (\n      select o.id,o.reviewer_scope from bx1_portal.organisations o\n      where c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n        and exists(select 1 from bx1_portal.products p where p.organisation_id=o.id)\n        and exists(select 1 from bx1_portal.organisation_authority_bindings b\n          where b.product_organisation_id=o.id\n            and b.native_organisation_id::text=c->>'organisationId'\n            and b.role='OfferingManager')\n    ), authorised_organisations as materialized (\n      select s.id,s.reviewer_scope from scope_inputs s\n      where bx1_portal.scoped_operator(c,s.id)\n    ), candidate_inputs as materialized (\n      select p.id as product_id,m.role,profile.display_name,m.user_id,m.id as membership_id,u.email\n      from bx1_portal.products p\n      join authorised_organisations o on o.id=p.organisation_id\n      join public.bx1_memberships m on m.organisation_id=o.reviewer_scope\n        and m.role in ('IssuerFundManager','ComplianceOfficer')\n      join public.bx1_profiles profile on profile.id=m.user_id\n      join auth.users u on u.id=m.user_id and u.email is not null\n      where profile.status='ACTIVE'\n    )\n    select coalesce(pg_catalog.jsonb_agg(candidate.value order by candidate.product_id,\n        candidate.role,candidate.display_name,candidate.user_id),'[]'::jsonb)\n      into candidates from (\n        select i.product_id,i.role,i.display_name,i.user_id,\n          pg_catalog.jsonb_build_object('product_id',i.product_id,'role',i.role,\n            'user_id',i.user_id,'membership_id',i.membership_id,\n            'display_name',i.display_name,'email',i.email) as value\n        from candidate_inputs i\n        where bx1_portal.native_membership_effective(i.membership_id)\n          and bx1_portal.entity_people_independent(auth.uid(),i.user_id)\n        order by i.product_id,i.role,i.display_name,i.user_id limit 100\n      ) candidate;\n  end if;",
        "count": 1
      },
      {
        "from": "  if bx1_portal.valid_operating_context(c) is not true then\n    raise exception 'product_appointment_context_changed' using errcode='42501'; end if;",
        "to": "  if exists(with resolved_candidates as materialized (\n      select p.id as product_id,o.id as organisation_id,\n        (captured.value->>'organisation_id')::uuid as captured_organisation_id\n      from pg_catalog.jsonb_array_elements(candidates) emitted\n      left join pg_catalog.jsonb_array_elements(manager_product_refs) captured\n        on captured.value->>'product_id'=emitted.value->>'product_id'\n      left join bx1_portal.products p on p.id=(emitted.value->>'product_id')::uuid\n      left join bx1_portal.organisations o on o.id=p.organisation_id\n    ), resolved_products as materialized (\n      select p.id as product_id,o.id as organisation_id,\n        (ref.value->>'organisation_id')::uuid as captured_organisation_id,\n        exists(select 1 from pg_catalog.jsonb_array_elements(products) emitted\n          where emitted.value->>'id'=ref.value->>'product_id'\n            and emitted.value->>'organisation_id'=ref.value->>'organisation_id') as emitted_reference\n      from pg_catalog.jsonb_array_elements(manager_product_refs) ref\n      left join bx1_portal.products p on p.id=(ref.value->>'product_id')::uuid\n      left join bx1_portal.organisations o on o.id=p.organisation_id\n    ), resolved_organisations as materialized (\n      select o.id as organisation_id,\n        exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb)) emitted\n          where emitted.value->>'id'=ref.value#>>'{}') as emitted_reference\n      from pg_catalog.jsonb_array_elements(manager_organisation_refs) ref\n      left join bx1_portal.organisations o on o.id=(ref.value#>>'{}')::uuid\n    ), contributing_organisations as materialized (\n      select organisation_id from resolved_candidates\n      union select organisation_id from resolved_products\n      union select organisation_id from resolved_organisations\n    ) select 1 where exists(select 1 from resolved_candidates\n        where product_id is null or organisation_id is null\n          or organisation_id is distinct from captured_organisation_id)\n      or exists(select 1 from resolved_products where product_id is null or organisation_id is null\n        or organisation_id is distinct from captured_organisation_id or not emitted_reference)\n      or exists(select 1 from resolved_organisations where organisation_id is null or not emitted_reference)\n      or exists(select 1 from contributing_organisations current_org\n        where bx1_portal.scoped_operator(c,current_org.organisation_id) is not true)) then\n    raise exception 'product_appointment_candidate_scope_changed' using errcode='42501'; end if;\n  if bx1_portal.valid_operating_context(c) is not true then\n    raise exception 'product_appointment_context_changed' using errcode='42501'; end if;",
        "count": 1
      },
      {
        "from": "  manager_product bx1_portal.products;",
        "to": "  manager_product bx1_portal.products;\n  manager_org bx1_portal.organisations; manager_org_item jsonb;\n  manager_authority jsonb:='{}'::jsonb;\n  manager_product_refs jsonb:='[]'::jsonb; manager_organisation_refs jsonb:='[]'::jsonb;\n  manager_reopen boolean; manager_amend boolean; manager_draft boolean; manager_allowed boolean;",
        "count": 1
      },
      {
        "from": "    if c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and bx1_portal.scoped_operator(c,(item->>'organisation_id')::uuid)\n      and bx1_portal.offering_review_reopenable((item->>'id')::uuid) then\n      actions:=actions||pg_catalog.jsonb_build_array('reopen_offering_review');\n    end if;\n    if c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and bx1_portal.scoped_operator(c,(item->>'organisation_id')::uuid)\n      and bx1_portal.offering_amendment_beginable((item->>'id')::uuid) then\n      actions:=actions||pg_catalog.jsonb_build_array('begin_offering_amendment');\n    end if;\n    if c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and manager_product.status in ('DRAFT','CHANGES_REQUIRED')\n      and manager_product.terms->>'asset_type' in ('FUND','REAL_ESTATE')\n      and manager_product.reserved_units=0\n      and not exists(select 1 from bx1_portal.subscriptions s\n        where s.product_id=manager_product.id)\n      and bx1_portal.entry_manual_review_enabled()\n      and bx1_portal.scoped_operator(c,manager_product.organisation_id) then\n      if not (actions ? 'save_product') then\n        actions:=actions||pg_catalog.jsonb_build_array('save_product'); end if;\n      if manager_product.terms->'terms_version'='2'::jsonb\n        and not exists(select 1 from (\n        select previous.terms_hash from bx1_portal.offering_revisions previous\n          where previous.product_id=manager_product.id and previous.origin='SUBMITTED'\n          order by previous.package_number desc limit 1) latest\n        where latest.terms_hash=manager_product.terms_hash)\n        and not (actions ? 'submit_product') then\n        actions:=actions||pg_catalog.jsonb_build_array('submit_product');\n      end if;\n    end if;\n",
        "to": "    if c->>'mode'='ROLE' and c->>'role'='OfferingManager' then\n      if manager_product.id is null\n        or manager_product.organisation_id is distinct from (item->>'organisation_id')::uuid\n        or not exists(select 1 from bx1_portal.organisations o where o.id=manager_product.organisation_id) then\n        raise exception 'product_appointment_projection_reference_changed' using errcode='42501'; end if;\n      -- State is necessary-only; both original current helpers remain independent.\n      manager_reopen:=bx1_portal.offering_review_reopenable(manager_product.id);\n      manager_amend:=bx1_portal.offering_amendment_beginable(manager_product.id);\n      manager_draft:=manager_product.status in ('DRAFT','CHANGES_REQUIRED')\n        and manager_product.terms->>'asset_type' in ('FUND','REAL_ESTATE')\n        and manager_product.reserved_units=0\n        and not exists(select 1 from bx1_portal.subscriptions s where s.product_id=manager_product.id)\n        and bx1_portal.entry_manual_review_enabled();\n      manager_allowed:=false;\n      if manager_reopen or manager_amend or manager_draft then\n        if not (manager_authority ? manager_product.organisation_id::text) then\n          manager_authority:=manager_authority||pg_catalog.jsonb_build_object(\n            manager_product.organisation_id::text,bx1_portal.scoped_operator(c,manager_product.organisation_id) is true);\n        end if;\n        manager_allowed:=(manager_authority->>manager_product.organisation_id::text)::boolean;\n      end if;\n      if manager_allowed then\n        if manager_reopen then\n          actions:=actions||pg_catalog.jsonb_build_array('reopen_offering_review'); end if;\n        if manager_amend then\n          actions:=actions||pg_catalog.jsonb_build_array('begin_offering_amendment'); end if;\n        if manager_draft then\n          if not (actions ? 'save_product') then\n            actions:=actions||pg_catalog.jsonb_build_array('save_product'); end if;\n          if manager_product.terms->'terms_version'='2'::jsonb\n            and not exists(select 1 from (\n            select previous.terms_hash from bx1_portal.offering_revisions previous\n              where previous.product_id=manager_product.id and previous.origin='SUBMITTED'\n              order by previous.package_number desc limit 1) latest\n            where latest.terms_hash=manager_product.terms_hash)\n            and not (actions ? 'submit_product') then\n            actions:=actions||pg_catalog.jsonb_build_array('submit_product');\n          end if;\n        end if;\n      end if;\n      -- Include inherited actions, not an invented command-family whitelist.\n      if actions<>'[]'::jsonb or exists(select 1 from pg_catalog.jsonb_array_elements(candidates) emitted\n        where emitted.value->>'product_id'=manager_product.id::text) then\n        manager_product_refs:=manager_product_refs||pg_catalog.jsonb_build_array(\n          pg_catalog.jsonb_build_object('product_id',manager_product.id,'organisation_id',manager_product.organisation_id));\n      end if;\n    end if;\n",
        "count": 1
      },
      {
        "from": "  select coalesce(pg_catalog.jsonb_agg(case\n    when c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and bx1_portal.scoped_operator(c,(org.value->>'id')::uuid)\n      and exists(select 1 from bx1_portal.products p\n        where p.organisation_id=(org.value->>'id')::uuid\n          and bx1_portal.offering_review_reopenable(p.id))\n    then org.value||pg_catalog.jsonb_build_object('capabilities',\n      coalesce(org.value->'capabilities','[]'::jsonb)||\n        pg_catalog.jsonb_build_array('reopen_offering_review'))\n    else org.value end order by org.ordinality),'[]'::jsonb) into organisations\n    from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb))\n      with ordinality org(value,ordinality);\n  result:=pg_catalog.jsonb_set(result,'{organisations}',organisations);\n  select coalesce(pg_catalog.jsonb_agg(case\n    when c->>'mode'='ROLE' and c->>'role'='OfferingManager'\n      and bx1_portal.scoped_operator(c,(org.value->>'id')::uuid)\n      and exists(select 1 from bx1_portal.products p\n        where p.organisation_id=(org.value->>'id')::uuid\n          and bx1_portal.offering_amendment_beginable(p.id))\n    then org.value||pg_catalog.jsonb_build_object('capabilities',\n      coalesce(org.value->'capabilities','[]'::jsonb)||\n        pg_catalog.jsonb_build_array('begin_offering_amendment'))\n    else org.value end order by org.ordinality),'[]'::jsonb) into organisations\n    from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb))\n      with ordinality org(value,ordinality);\n  result:=pg_catalog.jsonb_set(result,'{organisations}',organisations);\n",
        "to": "  organisations:='[]'::jsonb;\n  for manager_org_item in select org.value\n    from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb))\n      with ordinality org(value,ordinality) order by org.ordinality loop\n    if c->>'mode'='ROLE' and c->>'role'='OfferingManager' then\n      select * into manager_org from bx1_portal.organisations where id=(manager_org_item->>'id')::uuid;\n      if manager_org.id is null then\n        raise exception 'product_appointment_projection_reference_changed' using errcode='42501'; end if;\n      if coalesce(manager_org_item->'capabilities','[]'::jsonb) ? 'create_product' then\n        manager_organisation_refs:=manager_organisation_refs||pg_catalog.jsonb_build_array(manager_org.id);\n      end if;\n      manager_allowed:=false;\n      if exists(select 1 from bx1_portal.products p where p.organisation_id=manager_org.id\n        and bx1_portal.offering_review_reopenable(p.id)) then\n        if not (manager_authority ? manager_org.id::text) then\n          manager_authority:=manager_authority||pg_catalog.jsonb_build_object(\n            manager_org.id::text,bx1_portal.scoped_operator(c,manager_org.id) is true);\n        end if;\n        manager_allowed:=(manager_authority->>manager_org.id::text)::boolean;\n      end if;\n      if manager_allowed then\n        manager_org_item:=manager_org_item||pg_catalog.jsonb_build_object('capabilities',\n          coalesce(manager_org_item->'capabilities','[]'::jsonb)||\n            pg_catalog.jsonb_build_array('reopen_offering_review'));\n        manager_organisation_refs:=manager_organisation_refs||pg_catalog.jsonb_build_array(manager_org.id);\n      end if;\n    end if;\n    organisations:=organisations||pg_catalog.jsonb_build_array(manager_org_item);\n  end loop;\n  result:=pg_catalog.jsonb_set(result,'{organisations}',organisations);\n  organisations:='[]'::jsonb;\n  for manager_org_item in select org.value\n    from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb))\n      with ordinality org(value,ordinality) order by org.ordinality loop\n    if c->>'mode'='ROLE' and c->>'role'='OfferingManager' then\n      select * into manager_org from bx1_portal.organisations where id=(manager_org_item->>'id')::uuid;\n      if manager_org.id is null then\n        raise exception 'product_appointment_projection_reference_changed' using errcode='42501'; end if;\n      manager_allowed:=false;\n      if exists(select 1 from bx1_portal.products p where p.organisation_id=manager_org.id\n        and bx1_portal.offering_amendment_beginable(p.id)) then\n        if not (manager_authority ? manager_org.id::text) then\n          manager_authority:=manager_authority||pg_catalog.jsonb_build_object(\n            manager_org.id::text,bx1_portal.scoped_operator(c,manager_org.id) is true);\n        end if;\n        manager_allowed:=(manager_authority->>manager_org.id::text)::boolean;\n      end if;\n      if manager_allowed then\n        manager_org_item:=manager_org_item||pg_catalog.jsonb_build_object('capabilities',\n          coalesce(manager_org_item->'capabilities','[]'::jsonb)||\n            pg_catalog.jsonb_build_array('begin_offering_amendment'));\n        manager_organisation_refs:=manager_organisation_refs||pg_catalog.jsonb_build_array(manager_org.id);\n      end if;\n    end if;\n    organisations:=organisations||pg_catalog.jsonb_build_array(manager_org_item);\n  end loop;\n  result:=pg_catalog.jsonb_set(result,'{organisations}',organisations);\n",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.save_fund_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "5c11de8529ace876c7895c3fd089fb0644ad8e2064ead2993b99e2eade7be597",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,'save_product')",
        "count": 4
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor('save_product',c)",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 3
      },
      {
        "from": "  target_org:=p.organisation_id;",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  target_org:=p.organisation_id;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.save_real_estate_v2_scoped(jsonb,uuid,jsonb)",
    "expected_sha256": "61073e81476d0e305cce1760994c3c2812d4d239323a178ee71122f2f6bc86d4",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,'save_product')",
        "count": 4
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor('save_product',c)",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 3
      },
      {
        "from": "  target_org:=p.organisation_id;",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  target_org:=p.organisation_id;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_appointed_compliance_decision(jsonb,uuid,jsonb)",
    "expected_sha256": "9a3b261d0280c847088377cf3fc9d644a361ec5773919456924176ca7644cf00",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,'review_product')",
        "count": 2
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor('review_product',c)",
        "count": 1
      },
      {
        "from": "bx1_portal.entity_people_independent",
        "to": "bx1_portal.offering_workflow_people_independent",
        "count": 3
      },
      {
        "from": "bx1_portal.product_appointment_authorised",
        "to": "bx1_portal.offering_workflow_product_appointment_authorised",
        "count": 2
      },
      {
        "from": "bx1_portal.lock_offering_lineage_people",
        "to": "bx1_portal.offering_workflow_lock_lineage_people",
        "count": 1
      },
      {
        "from": "bx1_portal.offering_lineage_independent",
        "to": "bx1_portal.offering_workflow_lineage_independent",
        "count": 1
      },
      {
        "from": "  select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "count": 1
      },
      {
        "from": "  perform bx1_portal.execute_command('review_product',key,\n    body-'offering_revision_id'-'terms_hash');",
        "to": "  if bx1_portal.admission_password_session() then\n    perform bx1_portal.offering_workflow_base_command(c,'review_product',key,body-'offering_revision_id'-'terms_hash');\n  else perform bx1_portal.execute_command('review_product',key,body-'offering_revision_id'-'terms_hash'); end if;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_begin_offering_amendment(jsonb,uuid,jsonb)",
    "expected_sha256": "9e70fcc56f110e5aefef21abff54ba0781cca658587c2330ad1ed597b957a2d8",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,'begin_offering_amendment')",
        "count": 2
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor('begin_offering_amendment',c)",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 3
      },
      {
        "from": "bx1_portal.lock_entity_people",
        "to": "bx1_portal.offering_workflow_lock_people",
        "count": 1
      },
      {
        "from": "bx1_portal.entry_require_context((c->>'organisationId')::uuid)",
        "to": "bx1_portal.offering_workflow_require_context(c,'begin_offering_amendment')",
        "count": 1
      },
      {
        "from": "  if p.id is null or bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  if p.id is null or bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_reopen_offering_review(jsonb,uuid,jsonb)",
    "expected_sha256": "734102c10fa9a58e7514da3d240bbf939761e7d5a99b327cbb8d777f63573739",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,'reopen_offering_review')",
        "count": 2
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor('reopen_offering_review',c)",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 3
      },
      {
        "from": "bx1_portal.lock_entity_people",
        "to": "bx1_portal.offering_workflow_lock_people",
        "count": 1
      },
      {
        "from": "bx1_portal.entry_require_context((c->>'organisationId')::uuid)",
        "to": "bx1_portal.offering_workflow_require_context(c,'reopen_offering_review')",
        "count": 1
      },
      {
        "from": "  if p.id is null or bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then",
        "to": "  perform bx1_portal.offering_workflow_lock_product(c,p.id);\n  if p.id is null or bx1_portal.offering_workflow_operator(c,p.organisation_id) is not true then",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.execute_product_service_appointment(jsonb,text,uuid,jsonb)",
    "expected_sha256": "d0038611c2f9089f942c5579e88043b5e0de3ad82a315800d8a30f292c457545",
    "changes": [
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.offering_workflow_command_context(c,action)",
        "count": 2
      },
      {
        "from": "bx1_portal.entry_lock_actor()",
        "to": "bx1_portal.offering_workflow_lock_actor(action,c)",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_operator",
        "to": "bx1_portal.offering_workflow_operator",
        "count": 1
      },
      {
        "from": "bx1_portal.lock_entity_people",
        "to": "bx1_portal.offering_workflow_lock_people",
        "count": 2
      },
      {
        "from": "bx1_portal.entity_people_independent",
        "to": "bx1_portal.offering_workflow_people_independent",
        "count": 7
      },
      {
        "from": "bx1_portal.representative_mandate_actor",
        "to": "bx1_portal.offering_workflow_staff",
        "count": 3
      },
      {
        "from": "    select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "to": "    perform bx1_portal.offering_workflow_lock_product(c,p.id);\n    select * into o from bx1_portal.organisations where id=p.organisation_id for share;",
        "count": 1
      },
      {
        "from": "    select * into a from bx1_portal.product_service_appointments\n      where id=(body->>'appointment_id')::uuid for update;",
        "to": "    perform bx1_portal.offering_workflow_lock_product(c,p.id);\n    select * into a from bx1_portal.product_service_appointments\n      where id=(body->>'appointment_id')::uuid for update;",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.guard_offering_decision_appointment()",
    "expected_sha256": "ef289639533107fa54879bc0a5df23ce863950ec2adde5d866736dd6eca25a85",
    "changes": [
      {
        "from": "  select * into candidate from bx1_portal.product_service_appointments a",
        "to": "  perform bx1_portal.offering_workflow_lock_product(new.operating_context,target_product);\n  select * into candidate from bx1_portal.product_service_appointments a",
        "count": 1
      },
      {
        "from": "bx1_portal.lock_offering_lineage_people",
        "to": "bx1_portal.offering_workflow_lock_lineage_people",
        "count": 1
      },
      {
        "from": "bx1_portal.product_appointment_authorised",
        "to": "bx1_portal.offering_workflow_product_appointment_authorised",
        "count": 1
      },
      {
        "from": "bx1_portal.product_appointment_effective",
        "to": "bx1_portal.offering_workflow_product_appointment_effective",
        "count": 1
      },
      {
        "from": "bx1_portal.offering_lineage_independent",
        "to": "bx1_portal.offering_workflow_lineage_independent",
        "count": 1
      }
    ]
  },
  {
    "signature": "bx1_portal.admission_access(jsonb)",
    "expected_sha256": "092f3e6825cc278903c75c22425dacf35f53617e35e3a89533db185954a5ad28",
    "changes": [
      {
        "from": "bx1_portal.admission_command_allowed(c,action)",
        "to": "case\n      when c='{\"mode\":\"APPLICANT\"}'::jsonb and action=any(array['start_application','submit_application','create_investment_account',\n        'create_entity_investment_account','request_representative_mandate','request_investing_representative_mandate',\n        'respond_investing_representative_proposal']) then bx1_portal.admission_command_allowed(c,action)\n      when c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'\n        and action=any(array['review_application','review_representative_mandate','review_investing_representative_mandate'])\n        then bx1_portal.admission_command_allowed(c,action)\n      when c->>'mode'='ROLE' and c->>'role'='SuperAdmin'\n        and action=any(array['apply_representative_mandate','apply_investing_representative_mandate'])\n        then bx1_portal.admission_command_allowed(c,action)\n      else false end",
        "count": 1
      }
    ]
  }
]
$offering_recipes$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'offering_workflow_function_missing: %',spec->>'signature' using errcode='55000'; end if;
    select p.prosrc,pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
      'security_definer',p.prosecdef,'configuration',p.proconfig,'arguments',p.proargtypes::text,
      'result',p.prorettype,'kind',p.prokind,'language',p.prolang,'volatility',p.provolatile)
      into source_body,before_meta from pg_catalog.pg_proc p where p.oid=target;
    if before_meta->>'owner' is distinct from ('postgres'::regrole::oid)::text
      or before_meta->>'security_definer' is distinct from 'true'
      or before_meta->'configuration' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from spec->>'expected_sha256' then
      raise exception 'offering_workflow_definition_changed: %',spec->>'signature' using errcode='55000'; end if;
    next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))
        /pg_catalog.length(change->>'from');
      if occurrences is distinct from (change->>'count')::integer then
        raise exception 'offering_workflow_callsite_changed: %',spec->>'signature' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'offering_workflow_body_ambiguous' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
      'security_definer',p.prosecdef,'configuration',p.proconfig,'arguments',p.proargtypes::text,
      'result',p.prorettype,'kind',p.prokind,'language',p.prolang,'volatility',p.provolatile)
      into after_meta from pg_catalog.pg_proc p where p.oid=target;
    if after_meta is distinct from before_meta or (select p.prosrc from pg_catalog.pg_proc p where p.oid=target) is distinct from next_body then
      raise exception 'offering_workflow_function_identity_changed' using errcode='55000'; end if;
  end loop;
end $offering_cutover$;

-- One existing shared leaf changes execution language, not its authority query.
-- Keep this outside the fourteen body-only recipes and their strict metadata gate.
do $offering_mandate_leaf_cutover$
declare target oid; source_body text; next_body text; definition text;
  before_row jsonb; after_row jsonb; sql_language oid; plpgsql_language oid;
begin
  target:=pg_catalog.to_regprocedure('bx1_portal.representative_mandate_effective_at(uuid,timestamptz)');
  select oid into sql_language from pg_catalog.pg_language where lanname='sql';
  select oid into plpgsql_language from pg_catalog.pg_language where lanname='plpgsql';
  if target is null or sql_language is null or plpgsql_language is null then
    raise exception 'offering_mandate_leaf_missing' using errcode='55000'; end if;
  select p.prosrc,pg_catalog.to_jsonb(p) into source_body,before_row
    from pg_catalog.pg_proc p where p.oid=target;
  next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
  if before_row->>'prolang' is distinct from sql_language::text
    or before_row->>'proowner' is distinct from ('postgres'::regrole::oid)::text
    or before_row->>'prosecdef' is distinct from 'true'
    or before_row->>'provolatile' is distinct from 'v'
    or before_row->'proconfig' is distinct from '["search_path=\"\""]'::jsonb
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(next_body,'UTF8')),'hex')
      is distinct from '934f86f41419d13fa60ddc71f18efb8f2c3eedb21b5d9ae789a0c6903d830c1c'
    or pg_catalog.left(next_body,14)<>'select exists(' or pg_catalog.right(next_body,2)<>');' then
    raise exception 'offering_mandate_leaf_definition_changed' using errcode='55000'; end if;
  next_body:=E'begin\n  return '||pg_catalog.substr(next_body,8)||E'\nend;';
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(next_body,'UTF8')),'hex')
    is distinct from 'd0eaa7a7589711c812cc1ad5a5b2ef387a5db3e7abaa51093ce056da4ea2896f' then
    raise exception 'offering_mandate_leaf_wrapper_changed' using errcode='55000'; end if;
  definition:=pg_catalog.pg_get_functiondef(target);
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,'LANGUAGE sql','')))
      /pg_catalog.length('LANGUAGE sql')<>1 then
    raise exception 'offering_mandate_leaf_header_or_body_ambiguous' using errcode='55000'; end if;
  execute pg_catalog.replace(pg_catalog.replace(definition,source_body,next_body),'LANGUAGE sql','LANGUAGE plpgsql');
  select pg_catalog.to_jsonb(p) into after_row from pg_catalog.pg_proc p where p.oid=target;
  if after_row-array['prolang','prosrc'] is distinct from before_row-array['prolang','prosrc']
    or after_row->>'prolang' is distinct from plpgsql_language::text
    or after_row->>'prosrc' is distinct from next_body then
    raise exception 'offering_mandate_leaf_catalog_changed' using errcode='55000'; end if;
end $offering_mandate_leaf_cutover$;

do $private_helpers$
declare routine record; helper_count integer:=0;
begin
  for routine in select p.oid,p.proowner,p.prosecdef,p.proconfig,n.nspname,p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) args
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and p.proname like 'offering_workflow_%' loop
    helper_count:=helper_count+1;
    if routine.proowner is distinct from 'postgres'::regrole::oid or routine.prosecdef is not true
      or routine.proconfig is distinct from array['search_path=""']::text[] then
      raise exception 'offering_workflow_private_helper_metadata_changed' using errcode='55000'; end if;
    execute pg_catalog.format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',
      routine.nspname,routine.proname,routine.args);
  end loop;
  if helper_count<>34 then raise exception 'offering_workflow_helper_count_changed' using errcode='55000'; end if;
end $private_helpers$;
