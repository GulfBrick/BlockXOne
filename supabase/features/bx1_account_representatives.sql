-- S2-ACCOUNT-REPS-20261011. Additional representatives use the retained
-- account, mandate, receipt, request and audit records. No account delegation,
-- native role, financial eligibility, identity administration or MAIN route.
-- Apply atomically as postgres after rc32. Historical definitions remain in
-- their source files; every changed body below has an exact drift precondition.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.admission_access(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb)') is not null
    or exists(select 1 from information_schema.columns where table_schema='bx1_portal'
      and table_name='investing_representative_mandates' and column_name='proposal_hash') then
    raise exception 'account_representatives_baseline_required' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure
    and p.proowner='bx1_authority_owner'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
    and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      ='f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    or not pg_catalog.has_function_privilege('postgres','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE') then
    raise exception 'account_representatives_principal_lock_changed' using errcode='55000'; end if;
end $$;

alter table bx1_portal.investing_representative_mandates
  add column representative_email text,
  add column representative_name text,
  add column representative_application_id uuid references bx1_portal.applications(id) on delete restrict,
  add column representative_application_revision integer,
  add column representative_submitted_revision integer,
  add column representative_details_sha256 text,
  add column proposal_hash text,
  add column consent_decision text,
  add column consent_receipt_id uuid unique references bx1_portal.investing_representative_receipts(id) on delete restrict,
  add column responded_at timestamptz;

-- Resolve only the exact original self-equality constraint, not a guessed
-- generated name or another authority constraint.
do $$ declare target_name text; matches integer; begin
  select count(*)::integer,min(conname::text) into matches,target_name from pg_catalog.pg_constraint
    where conrelid='bx1_portal.investing_representative_mandates'::regclass and contype='c'
      and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid),'[[:space:]()]','','g')
        ='CHECKrepresentative_user_id=applicant_user_id';
  if matches<>1 then raise exception 'account_representatives_self_constraint_changed' using errcode='55000'; end if;
  execute pg_catalog.format('alter table bx1_portal.investing_representative_mandates drop constraint %I',target_name);
end $$;
alter table bx1_portal.investing_representative_mandates
  drop constraint investing_representative_mandates_status_check,
  add constraint investing_representative_mandates_status_check check(status in
    ('PROPOSED','DECLINED','SUBMITTED','CHANGES_REQUIRED','APPROVED','REJECTED','APPLIED','REVOKED')),
  add constraint bx1_account_representative_binding check(coalesce(
    (representative_user_id=applicant_user_id and representative_email is null and representative_name is null
      and representative_application_id is null and representative_application_revision is null
      and representative_submitted_revision is null and representative_details_sha256 is null
      and proposal_hash is null and consent_decision is null and consent_receipt_id is null and responded_at is null
      and status not in ('PROPOSED','DECLINED'))
    or (representative_user_id<>applicant_user_id and representative_email is not null
      and representative_name is not null and representative_application_id is not null
      and representative_application_revision>1 and representative_submitted_revision=representative_application_revision-1
      and representative_details_sha256 ~ '^[0-9a-f]{64}$' and proposal_hash ~ '^[0-9a-f]{64}$'
      and ((status='PROPOSED' and consent_decision is null and consent_receipt_id is null and responded_at is null)
        or (status='DECLINED' and consent_decision='DECLINE' and consent_receipt_id is not null and responded_at is not null)
        or (status not in ('PROPOSED','DECLINED') and consent_decision='ACCEPT'
          and consent_receipt_id is not null and responded_at is not null))),false));
alter table bx1_portal.investing_representative_receipts
  drop constraint investing_representative_receipts_action_check,
  add constraint investing_representative_receipts_action_check check(action in
    ('request_investing_representative_mandate','respond_investing_representative_proposal',
      'review_investing_representative_mandate','apply_investing_representative_mandate','revoke_investing_representative_mandate'));

create function bx1_portal.account_representative_proposal_hash(m bx1_portal.investing_representative_mandates) returns text
language sql immutable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'version',1,'id',m.id,'investment_account_id',m.investment_account_id,'entity_party_id',m.entity_party_id,
    'application_id',m.application_id,'admission_revision',m.admission_revision,'applicant_user_id',m.applicant_user_id,
    'representative_user_id',m.representative_user_id,'representative_email',m.representative_email,
    'representative_name',m.representative_name,'representative_application_id',m.representative_application_id,
    'representative_application_revision',m.representative_application_revision,
    'representative_submitted_revision',m.representative_submitted_revision,
    'representative_details_sha256',m.representative_details_sha256,'reviewer_scope',m.reviewer_scope_organisation_id,
    'cycle',m.cycle,'evidence_reference',m.evidence_reference,'appointment_document_id',m.appointment_document_id,
    'appointment_document_sha256',m.appointment_document_sha256,'scope',m.scope,
    'transaction_limit_minor',m.transaction_limit_minor::text,'requested_until_epoch',extract(epoch from m.requested_until),
    'created_at_epoch',extract(epoch from m.created_at))::text,'UTF8')),'hex');
$$;

create function bx1_portal.account_representative_user_current(target_user uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from auth.users u where u.id=target_user and u.email_confirmed_at is not null
    and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    and not exists(select 1 from public.bx1_profiles p where p.id=target_user and p.status<>'ACTIVE')
    and not exists(select 1 from bx1_private.person_principals p left join bx1_private.persons h on h.id=p.person_id
      where p.auth_user_id=target_user and (p.status<>'TRUSTED' or h.status is distinct from 'TRUSTED'));
$$;

create function bx1_portal.account_representative_person_admission(target_application uuid,target_user uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.applications a
    join bx1_portal.application_detail_versions v on v.application_id=a.id
      and v.application_revision=a.revision-1 and v.capture_kind='SUBMISSION'
    join bx1_portal.entry_configuration cfg on cfg.singleton
    where a.id=target_application and a.user_id=target_user and a.persona='INVESTOR'
      and a.admission_purpose='INVESTOR_ADMISSION' and a.context_kind='PERSONAL' and a.context_organisation_id is null
      and a.status='APPROVED' and a.provider_mode='MANUAL_TEST_REVIEW' and a.details->>'investor_type'='INDIVIDUAL'
      and a.details=v.details and a.approved_until>pg_catalog.clock_timestamp()
      and a.review_checks='{"identity":true,"ownership":true,"screening":true,"suitability":true}'::jsonb
      and bx1_portal.admission_people_independent(a.user_id,a.reviewer_id)
      and cfg.environment='TESTNET' and cfg.manual_test_review and a.reviewer_scope=cfg.reviewer_scope
      and bx1_portal.entry_manual_review_enabled() and bx1_portal.account_representative_user_current(a.user_id)
      and bx1_portal.monitoring_new_action_allowed(a.id));
$$;

create function bx1_portal.account_representative_document(target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.investing_representative_mandates; doc jsonb; matches integer; state text; lifecycle text;
begin
  select * into m from bx1_portal.investing_representative_mandates where id=target_mandate;
  if m.proposal_hash is null then return null; end if;
  select count(*)::integer,pg_catalog.jsonb_agg(d.item)->0 into matches,doc
    from bx1_portal.legal_entity_parties p join bx1_portal.application_detail_versions v
      on v.application_id=p.application_id and v.application_revision=p.submitted_revision and v.capture_kind='SUBMISSION'
    cross join lateral pg_catalog.jsonb_array_elements(v.details->'documents') d(item)
    where p.id=m.entity_party_id and p.application_id=m.application_id
      and d.item->>'id'=m.appointment_document_id::text and d.item->>'kind'='COMPANY'
      and d.item->>'sha256'=m.appointment_document_sha256;
  if matches<>1 or doc is null or pg_catalog.split_part(doc->>'storage_path','/',1) is distinct from m.applicant_user_id::text
    or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'
      and o.name=doc->>'storage_path' and o.owner_id=m.applicant_user_id::text
      and o.metadata->>'size'=doc->>'size' and o.metadata->>'mimetype'=doc->>'mime_type') then return null; end if;
  select r.validation_state into state from bx1_private.document_upload_receipts r where r.id=m.appointment_document_id
    and r.actor_id=m.applicant_user_id and r.storage_path=doc->>'storage_path' and r.kind='COMPANY'
    and r.sha256=doc->>'sha256' and r.byte_size::text=doc->>'size' and r.mime_type=doc->>'mime_type'
    and exists(select 1 from bx1_private.document_application_bindings binding join bx1_portal.legal_entity_parties p
      on p.id=m.entity_party_id where binding.receipt_id=r.id and binding.application_id=m.application_id
        and binding.application_revision=p.submitted_revision);
  select mode into lifecycle from bx1_private.document_lifecycle_policy where singleton;
  if lifecycle is null or lifecycle not in ('SYNTHETIC_TEST_ONLY','SCANNER_REQUIRED')
    or state is null or state not in ('SYNTHETIC_UNSCANNED','SCANNED_CLEAN')
    or (lifecycle='SCANNER_REQUIRED' and state<>'SCANNED_CLEAN') then return null; end if;
  return pg_catalog.jsonb_build_object('document',doc,'validation_state',state);
end $$;

create function bx1_portal.account_representative_consent_current(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investing_representative_mandates m
    join bx1_portal.investing_representative_receipts r on r.id=m.consent_receipt_id and r.mandate_id=m.id
    where m.id=target_mandate and m.proposal_hash is not null and m.consent_decision='ACCEPT'
      and r.action='respond_investing_representative_proposal' and r.actor_id=m.representative_user_id
      and r.operating_context='{"mode":"APPLICANT"}'::jsonb and r.status_after='SUBMITTED' and r.mandate_revision=2
      and r.command_payload=pg_catalog.jsonb_build_object('mandate_id',m.id,'expected_revision',1,
        'proposal_hash',m.proposal_hash,'decision','ACCEPT') and r.admission_revision=m.admission_revision
      and m.responded_at is not null);
$$;

create function bx1_portal.account_representative_current(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.admission_session() and exists(select 1 from bx1_portal.investing_representative_mandates m
    join bx1_portal.investment_accounts i on i.id=m.investment_account_id
    join bx1_portal.legal_entity_parties p on p.id=m.entity_party_id
    join bx1_portal.applications a on a.id=m.application_id
    join bx1_portal.applications b on b.id=m.representative_application_id
    join bx1_portal.application_detail_versions v on v.application_id=b.id
      and v.application_revision=m.representative_submitted_revision and v.capture_kind='SUBMISSION'
    join auth.users u on u.id=m.representative_user_id
    where m.id=target_mandate and m.proposal_hash is not null and m.status not in ('DECLINED','REJECTED','CHANGES_REQUIRED','REVOKED')
      and m.applicant_user_id<>m.representative_user_id and a.user_id=m.applicant_user_id
      and i.application_id=a.id and i.entity_party_id=p.id and p.application_id=a.id
      and p.admission_revision=m.admission_revision and a.revision=m.admission_revision
      and a.reviewer_scope=m.reviewer_scope_organisation_id
      and bx1_portal.admission_entity_account_current(i.id)
      and bx1_portal.account_representative_user_current(m.applicant_user_id)
      and bx1_portal.account_representative_person_admission(b.id,m.representative_user_id)
      and b.revision=m.representative_application_revision and b.details=v.details
      and m.representative_details_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex')
      and m.representative_email=pg_catalog.lower(u.email) and m.representative_name=v.details->>'full_name'
      and bx1_portal.admission_people_independent(m.applicant_user_id,m.representative_user_id)
      and m.requested_until>pg_catalog.clock_timestamp() and m.requested_until<=a.approved_until
      and m.requested_until<=b.approved_until and m.requested_until<=m.created_at+interval '30 days'
      and m.scope=array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']::text[] and m.transaction_limit_minor=0
      and m.proposal_hash=bx1_portal.account_representative_proposal_hash(m)
      and bx1_portal.account_representative_document(m.id) is not null
      and (m.status='PROPOSED' or bx1_portal.account_representative_consent_current(m.id)));
$$;

create function bx1_portal.account_representative_staff_independent(target_mandate uuid,reviewer uuid,applier uuid default null) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.investing_representative_mandates m where m.id=target_mandate
    and bx1_portal.admission_people_independent(reviewer,m.applicant_user_id)
    and bx1_portal.admission_people_independent(reviewer,m.representative_user_id)
    and (applier is null or (bx1_portal.admission_people_independent(applier,m.applicant_user_id)
      and bx1_portal.admission_people_independent(applier,m.representative_user_id)
      and bx1_portal.admission_people_independent(applier,reviewer))));
$$;

create function bx1_portal.account_representative_lock(c jsonb,target_mandate uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.investing_representative_mandates; subjects uuid[];
begin
  select * into m from bx1_portal.investing_representative_mandates where id=target_mandate;
  if m.proposal_hash is null then return; end if;
  if bx1_portal.admission_context(c) is not true or not(
    (c='{"mode":"APPLICANT"}'::jsonb and auth.uid() in (m.applicant_user_id,m.representative_user_id))
    or (c->>'mode'='ROLE' and c->>'role' in ('ComplianceOfficer','SuperAdmin')
      and bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role'))) then
    raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
  select array[auth.uid(),m.applicant_user_id,m.representative_user_id,m.reviewer_user_id,m.applied_by_user_id,
    a.reviewer_id,b.reviewer_id] into subjects from bx1_portal.applications a,bx1_portal.applications b
    where a.id=m.application_id and b.id=m.representative_application_id;
  -- Same hierarchy as propose: actor/config, account, sorted subjects and
  -- admissions, then the exact mandate. A read never reverses these locks.
  perform id from bx1_portal.investment_accounts where id=m.investment_account_id for share;
  perform id from auth.users where id=any(subjects) order by id for share;
  perform id from public.bx1_profiles where id=any(subjects) order by id for share;
  perform bx1_portal.admission_lock_people(subjects);
  perform id from bx1_portal.applications where id in (m.application_id,m.representative_application_id) order by id for share;
  perform application_id from bx1_portal.customer_monitoring_cases
    where application_id in (m.application_id,m.representative_application_id) order by application_id for share;
  perform id from bx1_portal.legal_entity_parties where id=m.entity_party_id for share;
  perform id from bx1_private.document_upload_receipts where id=m.appointment_document_id for share;
  perform singleton from bx1_private.document_lifecycle_policy where singleton for share;
  perform o.id from storage.objects o where o.bucket_id='bx1-portal-documents'
    and o.name=bx1_portal.account_representative_document(m.id)->'document'->>'storage_path' for share;
  perform id from bx1_portal.investing_representative_mandates where id=m.id for update;
  if bx1_portal.admission_context(c) is not true then
    raise exception 'representative_proposal_authority_changed' using errcode='42501'; end if;
end $$;

create function bx1_portal.account_representative_projection(c jsonb,target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.investing_representative_mandates; a bx1_portal.applications; p bx1_portal.legal_entity_parties;
  own_proposer boolean; own_target boolean; review_actor boolean; apply_actor boolean; current_case boolean; next_actor text;
begin
  if bx1_portal.admission_context(c) is not true then return null; end if;
  select * into m from bx1_portal.investing_representative_mandates where id=target_mandate;
  if m.proposal_hash is null then return null; end if;
  own_proposer:=c='{"mode":"APPLICANT"}'::jsonb and m.applicant_user_id=auth.uid();
  own_target:=c='{"mode":"APPLICANT"}'::jsonb and m.representative_user_id=auth.uid();
  review_actor:=c->>'role'='ComplianceOfficer' and bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer');
  apply_actor:=c->>'role'='SuperAdmin' and bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  if not(own_proposer or own_target or coalesce(review_actor,false) or coalesce(apply_actor,false)) then return null; end if;
  select * into a from bx1_portal.applications where id=m.application_id;
  select * into p from bx1_portal.legal_entity_parties where id=m.entity_party_id;
  current_case:=bx1_portal.account_representative_current(m.id);
  next_actor:=case when m.status in ('DECLINED','REVOKED') then 'NONE'
    when m.status='PROPOSED' and current_case then 'REPRESENTATIVE'
    when m.status='SUBMITTED' and current_case then 'COMPLIANCE'
    when m.status='APPROVED' and current_case then 'SUPER_ADMIN'
    when m.status in ('CHANGES_REQUIRED','REJECTED') or m.requested_until<=pg_catalog.clock_timestamp() then 'APPLICANT'
    else 'NONE' end;
  return pg_catalog.jsonb_build_object('id',m.id,'investment_account_id',m.investment_account_id,
    'application_id',m.application_id,'applicant_user_id',m.applicant_user_id,'representative_user_id',m.representative_user_id,
    'entity_party_id',m.entity_party_id,'entity_name',p.legal_name,'reviewer_scope_organisation_id',m.reviewer_scope_organisation_id,
    'admission_revision',m.admission_revision,'admission_current_revision',a.revision,'admission_approved_until',a.approved_until,
    'cycle',m.cycle,'revision',m.revision,'status',m.status,'scope',pg_catalog.to_jsonb(m.scope),
    'transaction_limit_minor',m.transaction_limit_minor::text,'evidence_reference',m.evidence_reference,
    'appointment_document_id',m.appointment_document_id,'requested_until',m.requested_until,'submitted_at',m.submitted_at,
    'reviewed_at',m.reviewed_at,'reviewer_user_id',m.reviewer_user_id,'review_notes',m.review_notes,'review_checks',m.review_checks,
    'approval_receipt_id',m.approval_receipt_id,'applied_at',m.applied_at,'applied_by_user_id',m.applied_by_user_id,
    'revoked_at',m.revoked_at,'revoke_reason',m.revoke_reason,'representative_email',m.representative_email,
    'representative_name',m.representative_name,'representative_application_id',m.representative_application_id,
    'representative_application_revision',m.representative_application_revision,'proposal_hash',m.proposal_hash,
    'consent_decision',m.consent_decision,'consent_receipt_id',m.consent_receipt_id,'responded_at',m.responded_at,
    'effective',bx1_portal.admission_investing_mandate_effective(m.id),'next_owner',next_actor,
    'can_request',false,'can_respond',own_target and m.status='PROPOSED' and current_case,
    'can_review',coalesce(review_actor,false) and m.status='SUBMITTED' and current_case
      and bx1_portal.account_representative_staff_independent(m.id,auth.uid()),
    'can_apply',coalesce(apply_actor,false) and m.status='APPROVED' and current_case and m.approval_receipt_id is not null
      and bx1_portal.account_representative_staff_independent(m.id,m.reviewer_user_id,auth.uid()),
    'can_revoke',not bx1_portal.admission_password_session() and (coalesce(review_actor,false) or coalesce(apply_actor,false))
      and m.status='APPLIED' and bx1_portal.admission_people_independent(auth.uid(),m.representative_user_id)
      and bx1_portal.admission_people_independent(auth.uid(),m.applicant_user_id));
end $$;

create function bx1_portal.account_representative_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests; i bx1_portal.investment_accounts;
  a bx1_portal.applications; b bx1_portal.applications; p bx1_portal.legal_entity_parties;
  v bx1_portal.application_detail_versions; m bx1_portal.investing_representative_mandates; previous bx1_portal.investing_representative_mandates;
  target_user uuid; target_email text; target_count integer; doc jsonb; expiry timestamptz; now_at timestamptz;
  receipt_id uuid; decision text; summary text;
begin
  if c is distinct from '{"mode":"APPLICANT"}'::jsonb or bx1_portal.admission_command_context(c,action) is not true
    or bx1_portal.entry_manual_review_enabled() is not true
    or action not in ('request_investing_representative_mandate','respond_investing_representative_proposal') then
    raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then raise exception 'representative_proposal_invalid' using errcode='22023'; end if;
  perform bx1_portal.admission_lock_actor(action,c);
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from action or prior.payload is distinct from body then
      raise exception 'representative_proposal_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.representative_mandate_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.product_service_appointment_requests where actor_id=actor and request_key=key) then
    raise exception 'representative_proposal_prior_key_conflict' using errcode='23505'; end if;
  if action='request_investing_representative_mandate' then
    perform bx1_portal.require_keys(body,array['investment_account_id','expected_revision','evidence_reference',
      'appointment_document_id','requested_until','representative_email']);
    perform bx1_portal.require_text(body,'evidence_reference',20,400);
    perform bx1_portal.require_text(body,'representative_email',3,254);
    if pg_catalog.jsonb_typeof(body->'investment_account_id') is distinct from 'string'
      or body->>'investment_account_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or pg_catalog.jsonb_typeof(body->'appointment_document_id') is distinct from 'string'
      or body->>'appointment_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or body->'expected_revision' is distinct from '0'::jsonb
      or body->>'representative_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or pg_catalog.jsonb_typeof(body->'requested_until') is distinct from 'string'
      or body->>'requested_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' then
      raise exception 'representative_proposal_invalid' using errcode='22023'; end if;
    begin expiry:=(body->>'requested_until')::timestamptz;
    exception when others then raise exception 'representative_proposal_invalid' using errcode='22023'; end;
    target_email:=pg_catalog.lower(body->>'representative_email');
    select count(*)::integer into target_count from auth.users where pg_catalog.lower(email)=target_email;
    if target_count<>1 then raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    select id into target_user from auth.users where pg_catalog.lower(email)=target_email;
    if target_user=actor then raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    select * into i from bx1_portal.investment_accounts where id=(body->>'investment_account_id')::uuid and kind='ENTITY' for update;
    select * into a from bx1_portal.applications where id=i.application_id and user_id=actor;
    select count(*)::integer into target_count from bx1_portal.applications
      where user_id=target_user and persona='INVESTOR' and context_kind='PERSONAL';
    if target_count<>1 then raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    select * into b from bx1_portal.applications where user_id=target_user and persona='INVESTOR' and context_kind='PERSONAL';
    if i.id is null or a.id is null or b.id is null then raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    perform id from auth.users where id in (actor,target_user,a.reviewer_id,b.reviewer_id) order by id for share;
    perform id from public.bx1_profiles where id in (actor,target_user,a.reviewer_id,b.reviewer_id) order by id for share;
    perform bx1_portal.admission_lock_people(array[actor,target_user,a.reviewer_id,b.reviewer_id]);
    perform id from bx1_portal.applications where id in (a.id,b.id) order by id for share;
    perform application_id from bx1_portal.customer_monitoring_cases where application_id in (a.id,b.id) order by application_id for share;
    select * into a from bx1_portal.applications where id=a.id;
    select * into b from bx1_portal.applications where id=b.id;
    select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id for share;
    select * into v from bx1_portal.application_detail_versions where application_id=b.id
      and application_revision=b.revision-1 and capture_kind='SUBMISSION' for share;
    select d.item into doc from bx1_portal.application_detail_versions ev cross join lateral
      pg_catalog.jsonb_array_elements(ev.details->'documents') d(item)
      where ev.application_id=a.id and ev.application_revision=p.submitted_revision and ev.capture_kind='SUBMISSION'
        and d.item->>'id'=body->>'appointment_document_id' and d.item->>'kind'='COMPANY';
    perform id from bx1_private.document_upload_receipts where id=(body->>'appointment_document_id')::uuid for share;
    perform singleton from bx1_private.document_lifecycle_policy where singleton for share;
    perform o.id from storage.objects o where o.bucket_id='bx1-portal-documents'
      and o.name=doc->>'storage_path' for share;
    now_at:=pg_catalog.clock_timestamp();
    if bx1_portal.admission_entity_account_current(i.id) is not true
      or bx1_portal.account_representative_user_current(actor) is not true
      or bx1_portal.account_representative_person_admission(b.id,target_user) is not true
      or bx1_portal.admission_people_independent(actor,target_user) is not true
      or not exists(select 1 from auth.users where id=target_user and pg_catalog.lower(email)=target_email)
      or (select count(*) from auth.users where pg_catalog.lower(email)=target_email)<>1
      or v.application_id is null or doc is null or expiry<=now_at or expiry>a.approved_until
      or expiry>b.approved_until or expiry>now_at+interval '30 days' then
      raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    select * into previous from bx1_portal.investing_representative_mandates
      where investment_account_id=i.id and representative_user_id=target_user order by cycle desc limit 1 for update;
    if previous.id is not null and previous.status not in ('DECLINED','CHANGES_REQUIRED','REJECTED','REVOKED')
      and previous.requested_until>now_at then raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    m.id:=pg_catalog.gen_random_uuid(); m.investment_account_id:=i.id; m.application_id:=a.id; m.entity_party_id:=p.id;
    m.applicant_user_id:=actor; m.representative_user_id:=target_user; m.reviewer_scope_organisation_id:=a.reviewer_scope;
    m.admission_revision:=a.revision; m.cycle:=coalesce(previous.cycle,0)+1; m.revision:=1; m.status:='PROPOSED';
    m.scope:=array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']; m.transaction_limit_minor:=0;
    m.evidence_reference:=body->>'evidence_reference'; m.appointment_document_id:=(body->>'appointment_document_id')::uuid;
    m.appointment_document_sha256:=doc->>'sha256'; m.requested_until:=expiry; m.submitted_at:=now_at; m.created_at:=now_at;
    m.review_checks:='{}'::jsonb; m.representative_email:=target_email; m.representative_name:=v.details->>'full_name';
    m.representative_application_id:=b.id; m.representative_application_revision:=b.revision;
    m.representative_submitted_revision:=v.application_revision;
    m.representative_details_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex');
    m.proposal_hash:=bx1_portal.account_representative_proposal_hash(m);
    insert into bx1_portal.investing_representative_mandates select (m).*;
    if bx1_portal.account_representative_current(m.id) is not true then
      raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    summary:='Additional representative proposed, not appointed. Target consent and independent appointment review required; zero transaction limit.';
  else
    perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','proposal_hash','decision']);
    if pg_catalog.jsonb_typeof(body->'mandate_id') is distinct from 'string'
      or body->>'mandate_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or body->'expected_revision' is distinct from '1'::jsonb
      or pg_catalog.jsonb_typeof(body->'proposal_hash') is distinct from 'string'
      or body->>'proposal_hash' !~ '^[0-9a-f]{64}$'
      or pg_catalog.jsonb_typeof(body->'decision') is distinct from 'string'
      or coalesce(body->>'decision','') not in ('ACCEPT','DECLINE') then
      raise exception 'representative_proposal_invalid' using errcode='22023'; end if;
    perform bx1_portal.account_representative_lock(c,(body->>'mandate_id')::uuid);
    select * into m from bx1_portal.investing_representative_mandates where id=(body->>'mandate_id')::uuid for update;
    if m.id is null or m.representative_user_id<>actor or m.status<>'PROPOSED' or m.revision<>1
      or m.proposal_hash is distinct from body->>'proposal_hash' or bx1_portal.account_representative_current(m.id) is not true then
      raise exception 'representative_proposal_unavailable' using errcode='42501'; end if;
    decision:=body->>'decision'; receipt_id:=pg_catalog.gen_random_uuid(); now_at:=pg_catalog.clock_timestamp();
    insert into bx1_portal.investing_representative_receipts(id,mandate_id,mandate_revision,action,actor_id,
      operating_context,command_payload,admission_revision,status_after)
      values(receipt_id,m.id,2,action,actor,c,body,m.admission_revision,case decision when 'ACCEPT' then 'SUBMITTED' else 'DECLINED' end);
    update bx1_portal.investing_representative_mandates set status=case decision when 'ACCEPT' then 'SUBMITTED' else 'DECLINED' end,
      revision=2,consent_decision=decision,consent_receipt_id=receipt_id,responded_at=now_at,submitted_at=now_at
      where id=m.id returning * into m;
    if decision='ACCEPT' and bx1_portal.account_representative_current(m.id) is not true then
      raise exception 'representative_proposal_authority_changed' using errcode='42501'; end if;
    summary:='Named representative response to exact immutable proposal: '||decision||'. No account access or financial authority granted.';
  end if;
  if action='request_investing_representative_mandate' then
    insert into bx1_portal.investing_representative_receipts(mandate_id,mandate_revision,action,actor_id,operating_context,
      command_payload,admission_revision,status_after) values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);
  end if;
  if bx1_portal.admission_command_context(c,action) is not true or bx1_portal.entry_manual_review_enabled() is not true then
    raise exception 'representative_proposal_authority_changed' using errcode='42501'; end if;
  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary) values(m.id,m.application_id,action,actor,summary);
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end $$;

create function bx1_portal.account_representative_document_allowed(c jsonb,target_mandate uuid,document_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select c='{"mode":"APPLICANT"}'::jsonb and bx1_portal.admission_context(c)
    and exists(select 1 from bx1_portal.investing_representative_mandates m where m.id=target_mandate
      and m.representative_user_id=auth.uid() and m.appointment_document_id=document_id
      and bx1_portal.account_representative_current(m.id));
$$;

create function public.bx1_investing_proposal_document_lookup(document_id uuid,mandate_id uuid,operating_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.investing_representative_mandates; envelope jsonb;
begin
  if bx1_portal.account_representative_document_allowed($3,$2,$1) is not true then
    raise exception 'representative_proposal_document_unavailable' using errcode='42501'; end if;
  perform bx1_portal.admission_lock_actor(null,$3);
  perform bx1_portal.account_representative_lock($3,$2);
  select * into m from bx1_portal.investing_representative_mandates where id=$2;
  envelope:=bx1_portal.account_representative_document(m.id);
  if envelope is null or bx1_portal.account_representative_document_allowed($3,$2,$1) is not true then
    raise exception 'representative_proposal_document_unavailable' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('mandate_id',m.id,'mandate_revision',m.revision,'proposal_hash',m.proposal_hash,
    'applicant_user_id',m.applicant_user_id,'document',envelope->'document','validation_state',envelope->>'validation_state');
end $$;

create function bx1_portal.account_representative_object_readable(object_name text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare target uuid; c jsonb:='{"mode":"APPLICANT"}'::jsonb;
begin
  if bx1_portal.admission_context(c) is not true then return false; end if;
  for target in select m.id from bx1_portal.investing_representative_mandates m
    where m.representative_user_id=auth.uid() and m.proposal_hash is not null
      and bx1_portal.account_representative_document(m.id)->'document'->>'storage_path'=object_name order by m.id loop
    perform bx1_portal.account_representative_lock(c,target);
    if bx1_portal.account_representative_current(target) then return true; end if;
  end loop;
  return false;
end $$;

-- In-place exact-body replacements preserve OID, owner, ACL, SECDEF, language,
-- volatility and empty search_path, including the retained invoker trigger.
do $account_representative_cutover$
declare spec jsonb; change jsonb; target oid; source_body text; next_body text; definition text;
  before_meta jsonb; after_meta jsonb; occurrences integer;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($cutovers$[
    {"signature":"bx1_portal.admission_command_allowed(jsonb,text)","hash":"c3efbcc33389e5b4503cf0ff6454a6cbb6f08ace8792ac3688f78330cb9f4d48","changes":[{"from":"'request_investing_representative_mandate']),false);","to":"'request_investing_representative_mandate','respond_investing_representative_proposal']),false);","count":1}]},
    {"signature":"bx1_portal.admission_access(jsonb)","hash":"9d15cf7fa7200b51d4e9b3bc86aaa6a2a18de8cb398f0834ad1c2016437ec7d7","changes":[{"from":"'apply_investing_representative_mandate']) with ordinality","to":"'apply_investing_representative_mandate','respond_investing_representative_proposal']) with ordinality","count":1}]},
    {"signature":"bx1_portal.admission_investing_mandate_current(uuid)","hash":"353094d7b774ee750533f1df28856d9ef4ef5eb3b232f41a7227617c325c9583","changes":[{"from":"select exists(","to":"select bx1_portal.account_representative_current(target_mandate) or exists(","count":1}]},
    {"signature":"bx1_portal.investing_mandate_current(uuid)","hash":"551c2027c0bd908a4336b4a0e88b5c8aa5d6d5fa40788c34da47a398611ddd44","changes":[{"from":"select exists(","to":"select bx1_portal.account_representative_current(target_mandate) or exists(","count":1}]},
    {"signature":"bx1_portal.admission_investing_mandate_effective(uuid)","hash":"03a8a52f6540047b0822aedfe53111dc734ec568f4707e9a3bb265cae5a3ea4e","changes":[{"from":"and m.transaction_limit_minor=0 and m.approval_receipt_id is not null","to":"and m.transaction_limit_minor=0 and m.approval_receipt_id is not null\n      and (m.proposal_hash is null or (bx1_portal.account_representative_consent_current(m.id)\n        and bx1_portal.account_representative_staff_independent(m.id,m.reviewer_user_id,m.applied_by_user_id)))","count":1}]},
    {"signature":"bx1_portal.investing_mandate_effective(uuid)","hash":"435739c171844b99705f06c5c5067f45e87ae344a6cb5e31ea154ebb54145bf9","changes":[{"from":"and m.transaction_limit_minor=0 and m.approval_receipt_id is not null","to":"and m.transaction_limit_minor=0 and m.approval_receipt_id is not null\n      and (m.proposal_hash is null or (bx1_portal.account_representative_consent_current(m.id)\n        and bx1_portal.account_representative_staff_independent(m.id,m.reviewer_user_id,m.applied_by_user_id)))","count":1}]},
    {"signature":"bx1_portal.admission_entity_account_projection(jsonb,uuid)","hash":"979c8dd1a47a993d8704b3e6e74a030f8ca0af2f2bd131147f0a9c5996762d9e","changes":[{"from":"'can_request_mandate',requestable,'can_view',effective_mandate,","to":"'can_request_mandate',requestable,'can_view',effective_mandate,\n    'can_propose_representative',own_application and bx1_portal.admission_entity_account_current(i.id)\n      and bx1_portal.account_representative_user_current(auth.uid()),","count":1}]},
    {"signature":"bx1_portal.entity_account_projection(jsonb,uuid)","hash":"4031c4a5f9b9136d9f9c16e9d620bd9594fe2c035dba202a0bbd85b90a3d4d5f","changes":[{"from":"'can_request_mandate',requestable,'can_view',effective_mandate,","to":"'can_request_mandate',requestable,'can_view',effective_mandate,\n    'can_propose_representative',own_application and bx1_portal.admission_entity_account_current(i.id)\n      and bx1_portal.account_representative_user_current(auth.uid()),","count":1}]},
    {"signature":"bx1_portal.admission_investing_mandate_projection(jsonb,uuid)","hash":"cfdefcd63ad010d569548202cfaf666ef768f3204512efd9b6c5449a820f6507","changes":[{"from":"if m.id is null then return null; end if;","to":"if m.id is null then return null; end if;\n  if m.proposal_hash is not null then return bx1_portal.account_representative_projection(c,m.id); end if;","count":1}]},
    {"signature":"bx1_portal.investing_mandate_projection(jsonb,uuid)","hash":"5cd8fe19e4bea8b9f9eff60a0545edf893d11eb66114456007ea3afe1f4ab87e","changes":[{"from":"if m.id is null then return null; end if;","to":"if m.id is null then return null; end if;\n  if m.proposal_hash is not null then return bx1_portal.account_representative_projection(c,m.id); end if;","count":1}]},
    {"signature":"bx1_portal.read_scoped_pre_offering(jsonb)","hash":"d617365508c6b7a9dda915738f66e5efec488006914da45de55810c9fdd95790","changes":[{"from":"where m.representative_user_id=auth.uid();","to":"where m.representative_user_id=auth.uid() or m.applicant_user_id=auth.uid();","count":1}]},
    {"signature":"bx1_portal.object_readable(text)","hash":"18286fddff5177892f0bd55118945dbbe31c84a30c2494e6fe44440977ce6111","changes":[{"from":"v_owner_prefix:=pg_catalog.split_part(object_name,'/',1);","to":"if bx1_portal.account_representative_object_readable(object_name) then return true; end if;\n  v_owner_prefix:=pg_catalog.split_part(object_name,'/',1);","count":1}]},
    {"signature":"bx1_portal.execute_scoped_pre_offering(jsonb,text,uuid,jsonb)","hash":"dbe564d2bed7a933ea8f35aa93570016b6e7ab6185466af00ef3a8007d28275e","changes":[{"from":"begin\n  if bx1_portal.admission_password_session()","to":"begin\n  if action='respond_investing_representative_proposal'\n    or (action='request_investing_representative_mandate' and body ? 'representative_email') then\n    return bx1_portal.account_representative_command(c,action,key,body); end if;\n  if bx1_portal.admission_password_session()","count":1},{"from":"select * into a from bx1_portal.applications where id=m.application_id for share;","to":"perform bx1_portal.account_representative_lock(c,m.id);\n    select * into a from bx1_portal.applications where id=m.application_id for share;","count":1},{"from":"now_at:=clock_timestamp();\n    if action='review_investing_representative_mandate' then","to":"now_at:=clock_timestamp();\n    if m.proposal_hash is not null and (\n      not bx1_portal.admission_people_independent(actor,m.applicant_user_id)\n      or (action in ('review_investing_representative_mandate','apply_investing_representative_mandate')\n        and not bx1_portal.account_representative_consent_current(m.id))) then\n      raise exception 'representative_proposal_staff_denied' using errcode='42501'; end if;\n    if action='review_investing_representative_mandate' then","count":1},{"from":"or not bx1_portal.admission_people_independent(actor,m.representative_user_id) then\n      raise exception 'entity_mandate_staff_authority_changed'","to":"or not bx1_portal.admission_people_independent(actor,m.representative_user_id)\n      or (m.proposal_hash is not null and not bx1_portal.admission_people_independent(actor,m.applicant_user_id)) then\n      raise exception 'entity_mandate_staff_authority_changed'","count":1}]},
    {"signature":"bx1_portal.guard_investing_representative_mandate()","hash":"844144b422ece5c238e4ce71c05e49f59f5f95d10656af61c345030dc54d15f8","changes":[{"from":"begin\n","to":"begin\n  if TG_OP<>'DELETE' and OLD.proposal_hash is not null then\n    if (pg_catalog.to_jsonb(NEW)-array['revision','status','submitted_at','reviewed_at','reviewer_user_id','review_notes','review_checks','approval_receipt_id','applied_at','applied_by_user_id','revoked_at','revoked_by_user_id','revoke_reason','consent_decision','consent_receipt_id','responded_at'])\n      is distinct from (pg_catalog.to_jsonb(OLD)-array['revision','status','submitted_at','reviewed_at','reviewer_user_id','review_notes','review_checks','approval_receipt_id','applied_at','applied_by_user_id','revoked_at','revoked_by_user_id','revoke_reason','consent_decision','consent_receipt_id','responded_at'])\n      or NEW.revision<>OLD.revision+1\n      or not ((OLD.status='PROPOSED' and NEW.status in ('SUBMITTED','DECLINED'))\n        or (OLD.status='SUBMITTED' and NEW.status in ('APPROVED','CHANGES_REQUIRED','REJECTED'))\n        or (OLD.status='APPROVED' and NEW.status='APPLIED') or (OLD.status='APPLIED' and NEW.status='REVOKED'))\n      or (OLD.status<>'PROPOSED' and row(NEW.consent_decision,NEW.consent_receipt_id,NEW.responded_at,NEW.submitted_at)\n        is distinct from row(OLD.consent_decision,OLD.consent_receipt_id,OLD.responded_at,OLD.submitted_at))\n      or (OLD.status='PROPOSED' and not exists(select 1 from bx1_portal.investing_representative_receipts r\n        where r.id=NEW.consent_receipt_id and r.mandate_id=NEW.id and r.mandate_revision=NEW.revision\n          and r.action='respond_investing_representative_proposal' and r.actor_id=NEW.representative_user_id\n          and r.operating_context='{\"mode\":\"APPLICANT\"}'::jsonb and r.status_after=NEW.status\n          and r.command_payload=pg_catalog.jsonb_build_object('mandate_id',NEW.id,'expected_revision',OLD.revision,\n            'proposal_hash',NEW.proposal_hash,'decision',NEW.consent_decision))) then\n      raise exception 'entity_mandate_invalid_transition' using errcode='23514'; end if;\n    return NEW;\n  end if;\n","count":1}]}
  ]$cutovers$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null then raise exception 'account_representatives_function_missing: %',spec->>'signature' using errcode='55000'; end if;
    select p.prosrc,pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,
      'configuration',p.proconfig,'arguments',p.proargtypes::text,'result',p.prorettype,'kind',p.prokind,
      'language',p.prolang,'volatility',p.provolatile) into source_body,before_meta from pg_catalog.pg_proc p where p.oid=target;
    if before_meta->>'owner' is distinct from ('postgres'::regrole::oid)::text
      or before_meta->>'security_definer' is distinct from (case when spec->>'signature'='bx1_portal.guard_investing_representative_mandate()' then 'false' else 'true' end)
      or before_meta->'configuration' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from spec->>'hash' then raise exception 'account_representatives_definition_changed: %',spec->>'signature' using errcode='55000'; end if;
    next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))/pg_catalog.length(change->>'from');
      if occurrences is distinct from (change->>'count')::integer then
        raise exception 'account_representatives_callsite_changed: %',spec->>'signature' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))/pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'account_representatives_ambiguous_body' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'security_definer',p.prosecdef,
      'configuration',p.proconfig,'arguments',p.proargtypes::text,'result',p.prorettype,'kind',p.prokind,
      'language',p.prolang,'volatility',p.provolatile) into after_meta from pg_catalog.pg_proc p where p.oid=target;
    if before_meta is distinct from after_meta or (select prosrc from pg_catalog.pg_proc where oid=target) is distinct from next_body then
      raise exception 'account_representatives_identity_changed' using errcode='55000'; end if;
  end loop;
end $account_representative_cutover$;

do $account_representative_acl$ declare routine record; begin
  for routine in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and p.proname::text like 'account_representative_%' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',routine.oid::regprocedure);
  end loop;
end $account_representative_acl$;
alter function public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    grant execute on function public.bx1_investing_proposal_document_lookup(uuid,uuid,jsonb) to authenticated;
  end if;
end $$;
