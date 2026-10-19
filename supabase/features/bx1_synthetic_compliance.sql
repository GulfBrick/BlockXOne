-- Bounded TEST-only Compliance rehearsal. No global session/MFA predicate,
-- Storage policy, provider writer, applicant/account/mandate/financial handler
-- or existing public EXECUTE grant is widened. Install atomically as postgres.
-- Owner provisioning of exact existing cases is a separate reviewed action.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.test_ordinary_entry_session()') is null
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null
    or pg_catalog.to_regclass('bx1_private.document_application_bindings') is null
    or pg_catalog.to_regclass('bx1_portal.product_service_appointment_requests') is null
    or pg_catalog.to_regclass('bx1_private.synthetic_compliance_cases') is not null then
    raise exception 'synthetic_compliance_baseline_required' using errcode='55000'; end if;
  if (select proowner from pg_catalog.pg_proc where oid=
      'bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure)<>'postgres'::regrole then
    raise exception 'synthetic_compliance_writer_owner_changed' using errcode='55000'; end if;
  if pg_catalog.to_regprocedure('bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)') is not null
    and (select proowner from pg_catalog.pg_proc where oid=
      pg_catalog.to_regprocedure('bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)'))<>'postgres'::regrole then
    raise exception 'synthetic_compliance_transition_owner_changed' using errcode='55000'; end if;
end $$;

-- This is the same sole transition used by the base install. CREATE OR REPLACE
-- delivers it to an already-installed rc.28 TEST without replaying the baseline.
create or replace function bx1_portal.review_application_transition(target_application uuid,expected_revision integer,
  decision text,notes text,checks jsonb,decision_at timestamptz) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; approved_organisation uuid;
begin
  if auth.uid() is null or decision is null or decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED')
    or expected_revision is null or expected_revision<1 or decision_at is null or not pg_catalog.isfinite(decision_at)
    or notes is null or char_length(notes) not between 20 and 3000 or notes<>btrim(notes) then
    raise exception 'portal_invalid_decision' using errcode='22023'; end if;
  perform bx1_portal.require_checks(checks,array['identity','ownership','screening','suitability'],decision='APPROVED');
  select * into a from bx1_portal.applications where id=target_application for update;
  if a.id is null or bx1_portal.independent_of(a.user_id) is not true then
    raise exception 'portal_review_denied' using errcode='42501'; end if;
  if a.status<>'SUBMITTED' or a.revision<>expected_revision then
    raise exception 'portal_stale_application' using errcode='23514'; end if;
  if decision='APPROVED' and a.persona='WEALTH_MANAGER' then
    insert into bx1_portal.organisations(application_id,owner_id,name,reviewer_scope)
      values(a.id,a.user_id,a.details->>'company_name',a.reviewer_scope) returning id into approved_organisation;
  end if;
  update bx1_portal.applications set status=decision,revision=revision+1,reviewer_id=auth.uid(),
    reviewed_at=decision_at,review_notes=notes,review_checks=checks,
    approved_until=case when decision='APPROVED' then decision_at+interval '30 days' end,
    organisation_id=coalesce(approved_organisation,organisation_id) where id=a.id;
  return approved_organisation;
end $$;

-- Cut over only the installed review branch. Preserve every other byte and the
-- existing signature/OID/owner/ACL. A fresh source install already delegates.
do $$
declare definition text; old_branch text; delegated_branch text; first_position integer; next_position integer;
begin
  definition:=pg_catalog.pg_get_functiondef('bx1_portal.execute_command_pre_entry(text,uuid,jsonb)'::regprocedure);
  if pg_catalog.strpos(definition,'bx1_portal.review_application_transition(a.id,')>0 then return; end if;
  old_branch:=$old$    if a.status<>'SUBMITTED' or a.revision<>(payload->>'expected_revision')::integer then raise exception 'portal_stale_application' using errcode='23514'; end if;
    if payload->>'decision'='APPROVED' and a.persona='WEALTH_MANAGER' then
      insert into bx1_portal.organisations(application_id,owner_id,name,reviewer_scope) values(a.id,a.user_id,a.details->>'company_name',a.reviewer_scope) returning * into o;
      v_org:=o.id;
    end if;
    update bx1_portal.applications set status=payload->>'decision',revision=revision+1,reviewer_id=v_actor,reviewed_at=v_now,review_notes=payload->>'notes',review_checks=payload->'checks',approved_until=case when payload->>'decision'='APPROVED' then v_now+interval '30 days' end,organisation_id=coalesce(v_org,organisation_id) where id=a.id;$old$;
  delegated_branch:=$new$    v_org:=bx1_portal.review_application_transition(a.id,(payload->>'expected_revision')::integer,
      payload->>'decision',payload->>'notes',payload->'checks',v_now);$new$;
  -- PostgreSQL preserves CRLF source too; match either exact newline form.
  first_position:=pg_catalog.strpos(definition,old_branch);
  if first_position=0 then
    old_branch:=pg_catalog.replace(old_branch,E'\n',E'\r\n');
    delegated_branch:=pg_catalog.replace(delegated_branch,E'\n',E'\r\n');
    first_position:=pg_catalog.strpos(definition,old_branch);
  end if;
  if first_position=0 then raise exception 'synthetic_compliance_review_branch_changed' using errcode='55000'; end if;
  next_position:=pg_catalog.strpos(pg_catalog.substr(definition,first_position+pg_catalog.length(old_branch)),old_branch);
  if next_position<>0 then raise exception 'synthetic_compliance_review_branch_ambiguous' using errcode='55000'; end if;
  execute pg_catalog.substr(definition,1,first_position-1)||delegated_branch||
    pg_catalog.substr(definition,first_position+pg_catalog.length(old_branch));
end $$;

create table bx1_private.synthetic_compliance_cases (
  application_id uuid primary key references bx1_portal.applications(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  reviewer_scope uuid not null references public.bx1_organisations(id) on delete restrict,
  valid_from timestamptz not null default pg_catalog.clock_timestamp() check(pg_catalog.isfinite(valid_from)),
  expires_at timestamptz not null check(pg_catalog.isfinite(expires_at)),
  release_reference text not null check(char_length(btrim(release_reference)) between 20 and 400 and release_reference=btrim(release_reference)),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text,
  check(applicant_user_id<>reviewer_user_id and expires_at>valid_from),
  check((revoked_at is null and revocation_reason is null) or
    (revoked_at is not null and pg_catalog.isfinite(revoked_at) and revocation_reason is not null
      and revocation_reason=btrim(revocation_reason) and char_length(revocation_reason) between 20 and 2000))
);
alter table bx1_private.synthetic_compliance_cases enable row level security;
revoke all on bx1_private.synthetic_compliance_cases from public,anon,authenticated,service_role;

create function bx1_private.guard_synthetic_compliance_case() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications;
begin
  if TG_OP='DELETE' then raise exception 'synthetic_compliance_policy_immutable' using errcode='23514'; end if;
  if TG_OP='UPDATE' then
    if (pg_catalog.to_jsonb(NEW)-array['revoked_at','revocation_reason']) is distinct from
        (pg_catalog.to_jsonb(OLD)-array['revoked_at','revocation_reason'])
      or OLD.revoked_at is not null or NEW.revoked_at is null then
      raise exception 'synthetic_compliance_policy_immutable' using errcode='23514'; end if;
    return NEW;
  end if;
  select * into a from bx1_portal.applications where id=NEW.application_id for share;
  if a.id is null or a.user_id<>NEW.applicant_user_id or a.context_kind<>'PERSONAL'
    or a.context_organisation_id is not null or a.admission_purpose not in ('INVESTOR_ADMISSION','CUSTOMER_ORGANISATION_ADMISSION')
    or (a.reviewer_scope is not null and a.reviewer_scope<>NEW.reviewer_scope)
    or not exists(select 1 from bx1_portal.entry_configuration cfg where cfg.singleton
      and cfg.environment='TESTNET' and cfg.manual_test_review and cfg.reviewer_scope=NEW.reviewer_scope)
    or not exists(select 1 from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
      join auth.users u on u.id=m.user_id where m.user_id=NEW.reviewer_user_id
      and m.organisation_id=NEW.reviewer_scope and m.role='ComplianceOfficer' and p.status='ACTIVE'
      and bx1_portal.native_membership_effective(m.id) and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    or exists(select 1 from bx1_private.person_principals p join bx1_private.person_principals q on q.person_id=p.person_id
      where p.auth_user_id=NEW.applicant_user_id and q.auth_user_id=NEW.reviewer_user_id) then
    raise exception 'synthetic_compliance_policy_case_denied' using errcode='42501'; end if;
  return NEW;
end $$;
create trigger bx1_synthetic_compliance_policy_guard before insert or update or delete on bx1_private.synthetic_compliance_cases
  for each row execute function bx1_private.guard_synthetic_compliance_case();

create function bx1_portal.synthetic_compliance_context(c jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(c) is distinct from 'object' or c->>'mode' is distinct from 'ROLE'
    or c->>'role' is distinct from 'ComplianceOfficer' or c-array['mode','organisationId','role']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(c->'organisationId') is distinct from 'string'
    or c->>'organisationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or bx1_portal.test_ordinary_entry_session() is not true
    or bx1_portal.entry_manual_review_enabled() is not true then return false; end if;
  return exists(select 1 from bx1_portal.entry_configuration cfg
    join public.bx1_memberships m on m.organisation_id=cfg.reviewer_scope and m.user_id=auth.uid()
    where cfg.singleton and cfg.environment='TESTNET' and cfg.manual_test_review
      and cfg.reviewer_scope::text=c->>'organisationId' and m.role='ComplianceOfficer'
      and bx1_portal.native_membership_effective(m.id))
    and exists(select 1 from bx1_private.synthetic_compliance_cases p
      where p.reviewer_user_id=auth.uid() and p.reviewer_scope::text=c->>'organisationId'
        and p.revoked_at is null and p.valid_from<=pg_catalog.clock_timestamp()
        and p.expires_at>pg_catalog.clock_timestamp());
exception when others then return false;
end $$;

-- Immutable submitted facts, not the current browser form or a guessed latest
-- receipt. Draft policies are allowed, but drafts never enter this projection.
create function bx1_portal.synthetic_compliance_case_current(c jsonb,target_application uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; v bx1_portal.application_detail_versions; p bx1_private.synthetic_compliance_cases; d jsonb;
begin
  if bx1_portal.synthetic_compliance_context(c) is not true then return false; end if;
  select * into p from bx1_private.synthetic_compliance_cases where application_id=target_application;
  select * into a from bx1_portal.applications where id=target_application;
  if p.application_id is null or a.id is null or p.applicant_user_id<>a.user_id
    or p.reviewer_user_id<>auth.uid() or p.reviewer_scope::text<>c->>'organisationId'
    or p.revoked_at is not null or p.valid_from>pg_catalog.clock_timestamp() or p.expires_at<=pg_catalog.clock_timestamp()
    or a.context_kind is distinct from 'PERSONAL' or a.context_organisation_id is not null or a.reviewer_scope is distinct from p.reviewer_scope
    or a.provider_mode<>'MANUAL_TEST_REVIEW' or a.status not in ('SUBMITTED','CHANGES_REQUIRED','REJECTED','APPROVED')
    or a.admission_purpose is distinct from (case a.persona when 'INVESTOR' then 'INVESTOR_ADMISSION'
      when 'WEALTH_MANAGER' then 'CUSTOMER_ORGANISATION_ADMISSION' end)
    or a.details->'test_data_acknowledged' is distinct from 'true'::jsonb
    or pg_catalog.jsonb_typeof(a.details->'documents') is distinct from 'array'
    or pg_catalog.jsonb_array_length(a.details->'documents') not between 1 and 8
    or bx1_portal.independent_of(a.user_id) is not true
    or not exists(select 1 from auth.users u where u.id=a.user_id and u.email_confirmed_at is not null
      and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()))
    or not exists(select 1 from bx1_private.document_receipt_policy where singleton and enforced)
    or not exists(select 1 from bx1_private.document_lifecycle_policy where singleton and mode='SYNTHETIC_TEST_ONLY') then return false; end if;
  select * into v from bx1_portal.application_detail_versions
    where application_id=a.id and capture_kind='SUBMISSION' and submitted_at=a.submitted_at
      and application_revision=case when a.status='SUBMITTED' then a.revision else a.revision-1 end;
  if v.application_id is null or v.details is distinct from a.details
    or (a.status='SUBMITTED' and (a.reviewer_id is not null or a.reviewed_at is not null
      or a.review_notes is not null or a.approved_until is not null))
    or (a.status<>'SUBMITTED' and (a.reviewer_id is distinct from auth.uid() or a.reviewed_at is null
      or a.review_notes is null or char_length(btrim(a.review_notes))<20))
    or (a.status='APPROVED' and (a.approved_until is null or a.approved_until<=a.reviewed_at
      or (a.persona='WEALTH_MANAGER' and a.organisation_id is null)
      or a.review_checks->'identity' is distinct from 'true'::jsonb
      or a.review_checks->'ownership' is distinct from 'true'::jsonb
      or a.review_checks->'screening' is distinct from 'true'::jsonb
      or a.review_checks->'suitability' is distinct from 'true'::jsonb))
    or (a.status<>'APPROVED' and a.approved_until is not null) then return false; end if;
  for d in select * from pg_catalog.jsonb_array_elements(v.details->'documents') loop
    if not exists(select 1 from bx1_private.document_upload_receipts r
      join bx1_private.document_application_bindings b on b.receipt_id=r.id
      where b.application_id=a.id and b.application_revision=v.application_revision
        and r.id::text=d->>'id' and r.actor_id=a.user_id and r.storage_path=d->>'storage_path'
        and r.kind=d->>'kind' and r.title=d->>'title' and r.sha256=d->>'sha256'
        and r.byte_size::text=d->>'size' and r.mime_type=d->>'mime_type'
        and r.validation_state='SYNTHETIC_UNSCANNED') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function bx1_portal.lock_synthetic_compliance(c jsonb,target_application uuid default null) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if bx1_portal.synthetic_compliance_context(c) is not true then
    raise exception 'synthetic_compliance_context_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||actor::text,0));
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  perform u.id from auth.users u where u.id=actor or u.id in (
    select applicant_user_id from bx1_private.synthetic_compliance_cases
      where reviewer_user_id=actor and reviewer_scope=(c->>'organisationId')::uuid
        and (target_application is null or application_id=target_application)) order by u.id for share;
  perform id from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=actor for share;
  perform id from auth.mfa_factors where user_id=actor order by id for share;
  perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
  perform id from public.bx1_memberships where user_id=actor and organisation_id=(c->>'organisationId')::uuid
    and role='ComplianceOfficer' order by id for share;
  perform application_id from bx1_private.synthetic_compliance_cases where reviewer_user_id=actor
    and reviewer_scope=(c->>'organisationId')::uuid
    and (target_application is null or application_id=target_application) order by application_id for share;
  perform p.auth_user_id from bx1_private.person_principals p
    where p.auth_user_id=actor or p.auth_user_id in (select applicant_user_id from bx1_private.synthetic_compliance_cases
      where reviewer_user_id=actor and reviewer_scope=(c->>'organisationId')::uuid
        and (target_application is null or application_id=target_application)) order by p.auth_user_id for share;
  perform a.id from bx1_portal.applications a join bx1_private.synthetic_compliance_cases p on p.application_id=a.id
    where p.reviewer_user_id=actor and p.reviewer_scope=(c->>'organisationId')::uuid
      and (target_application is null or a.id=target_application) order by a.id for share of a;
  if bx1_portal.synthetic_compliance_context(c) is not true then
    raise exception 'synthetic_compliance_authority_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.synthetic_compliance_projection(c jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$
  with visible as (select a.* from bx1_portal.applications a
    where bx1_portal.synthetic_compliance_case_current(c,a.id) order by a.submitted_at,a.id limit 100)
  select pg_catalog.jsonb_build_object(
    'rehearsal',pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','mode','SYNTHETIC_COMPLIANCE',
      'actor_id',u.id,'operating_context',c),
    'actor',pg_catalog.jsonb_build_object('id',u.id,'email',u.email,'display_name',p.display_name,'can_review',true),
    'operating_context',c,
    'applications',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',a.id,'user_id',a.user_id,'persona',a.persona,'status',a.status,'revision',a.revision,'details',a.details,
      'submitted_at',a.submitted_at,'reviewed_at',a.reviewed_at,'reviewer_id',a.reviewer_id,'review_notes',a.review_notes,
      'organisation_id',a.organisation_id,'review_checks',a.review_checks,'provider_mode',a.provider_mode,
      'approved_until',a.approved_until,'admission_purpose',a.admission_purpose) order by a.submitted_at,a.id) from visible a),'[]'::jsonb),
    'organisations','[]'::jsonb,'products','[]'::jsonb,'subscriptions','[]'::jsonb,
    'events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'subject_id',e.subject_id,'kind',e.kind,'actor_id',e.actor_id,'created_at',e.created_at,'summary',e.summary)
      order by e.created_at,e.id) from (select e.* from bx1_portal.events e join visible a on a.id=e.subject_id
        where e.application_id=a.id and ((e.kind='submit_application' and e.actor_id=a.user_id)
          or (e.kind='review_application' and e.actor_id=auth.uid()))
        order by e.created_at desc,e.id desc limit 1000) e),'[]'::jsonb),
    'requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.request_key,'command',r.command)
      order by r.created_at desc,r.request_key) from (select r.* from bx1_portal.scoped_requests r
        join visible a on a.id::text=r.payload->>'application_id'
        where r.actor_id=auth.uid() and r.operating_context=c and r.command='review_application'
          and r.created_at>=pg_catalog.clock_timestamp()-interval '7 days'
        order by r.created_at desc,r.request_key limit 1000) r),'[]'::jsonb))
  from auth.users u join public.bx1_profiles p on p.id=u.id where u.id=auth.uid();
$$;

create function bx1_portal.synthetic_compliance_read(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform bx1_portal.lock_synthetic_compliance(c);
  result:=bx1_portal.synthetic_compliance_projection(c);
  if result is null or result is distinct from bx1_portal.synthetic_compliance_projection(c)
    or bx1_portal.synthetic_compliance_context(c) is not true then
    raise exception 'synthetic_compliance_read_changed' using errcode='42501'; end if;
  return result;
end $$;

create function bx1_portal.synthetic_compliance_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a bx1_portal.applications; prior bx1_portal.scoped_requests; approved_organisation uuid;
begin
  if action is distinct from 'review_application' then
    raise exception 'synthetic_compliance_command_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>65536 then
    raise exception 'synthetic_compliance_invalid_command' using errcode='22023'; end if;
  perform bx1_portal.require_keys(body,array['application_id','expected_revision','decision','notes','checks']);
  perform bx1_portal.require_text(body,'notes',20,3000);
  if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'
    or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'
    or coalesce(body->>'decision','') not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then
    raise exception 'synthetic_compliance_invalid_decision' using errcode='22023'; end if;
  perform bx1_portal.lock_synthetic_compliance(c,(body->>'application_id')::uuid);
  if bx1_portal.synthetic_compliance_case_current(c,(body->>'application_id')::uuid) is not true then
    raise exception 'synthetic_compliance_case_denied' using errcode='42501'; end if;
  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from action or prior.payload is distinct from body then
      raise exception 'synthetic_compliance_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.synthetic_compliance_read(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.representative_mandate_requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.product_service_appointment_requests where actor_id=actor and request_key=key) then
    raise exception 'synthetic_compliance_prior_key_conflict' using errcode='23505'; end if;
  select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid for update;
  if bx1_portal.synthetic_compliance_case_current(c,a.id) is not true then
    raise exception 'synthetic_compliance_case_changed_after_wait' using errcode='42501'; end if;
  approved_organisation:=bx1_portal.review_application_transition(a.id,(body->>'expected_revision')::integer,
    body->>'decision',body->>'notes',body->'checks',pg_catalog.clock_timestamp());
  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(actor,key,action,body);
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);
  insert into bx1_portal.events(subject_id,application_id,organisation_id,kind,actor_id,summary)
    values(a.id,a.id,approved_organisation,action,actor,
      'SYNTHETIC_COMPLIANCE manifest-only AAL1 rehearsal decision: '||(body->>'decision')||'. Not independent-human, scanner or provider acceptance.');
  if bx1_portal.synthetic_compliance_context(c) is not true or bx1_portal.synthetic_compliance_case_current(c,a.id) is not true then
    raise exception 'synthetic_compliance_authority_changed' using errcode='42501'; end if;
  return bx1_portal.synthetic_compliance_read(c);
end $$;

create function public.bx1_portal_synthetic_compliance_read(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.synthetic_compliance_read(operating_context); $$;
create function public.bx1_portal_synthetic_compliance_command(operating_context jsonb,command text,request_key uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.synthetic_compliance_command(operating_context,command,request_key,payload); $$;

revoke all on function bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz),
  bx1_private.guard_synthetic_compliance_case(),bx1_portal.synthetic_compliance_context(jsonb),
  bx1_portal.synthetic_compliance_case_current(jsonb,uuid),bx1_portal.lock_synthetic_compliance(jsonb,uuid),
  bx1_portal.synthetic_compliance_projection(jsonb),bx1_portal.synthetic_compliance_read(jsonb),
  bx1_portal.synthetic_compliance_command(jsonb,text,uuid,jsonb),
  public.bx1_portal_synthetic_compliance_read(jsonb),public.bx1_portal_synthetic_compliance_command(jsonb,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
do $$ begin
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET' and manual_test_review) then
    grant execute on function bx1_portal.synthetic_compliance_read(jsonb),bx1_portal.synthetic_compliance_command(jsonb,text,uuid,jsonb),
      public.bx1_portal_synthetic_compliance_read(jsonb),public.bx1_portal_synthetic_compliance_command(jsonb,text,uuid,jsonb) to authenticated;
  end if;
end $$;
comment on table bx1_private.synthetic_compliance_cases is
  'Owner-provisioned exact TEST fictional admission cases. No independent-human proof, MFA completion, provider/document clearance or operational grant.';
