-- Normal Stage 2 admission cutover. No new public RPC or business writer.
-- TEST password assurance is confined to the eleven existing admission actions.
-- Apply atomically as postgres after the retained rc.31 Stage 2 definitions.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.review_application_transition(uuid,integer,text,text,jsonb,timestamptz)') is null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null
    or pg_catalog.to_regclass('bx1_private.document_application_bindings') is null
    or pg_catalog.to_regprocedure('bx1_portal.test_ordinary_entry_session()') is null
    or pg_catalog.to_regprocedure('bx1_portal.admission_password_session()') is not null then
    raise exception 'admission_workflow_baseline_required' using errcode='55000'; end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure
    and p.proowner='bx1_authority_owner'::regrole and p.prosecdef
    and p.proconfig=array['search_path=""']::text[]
    and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
      ='f281df8a13239deaeb89f92282981365ad0996907a2a280c2b9419840a104ecc')
    or not pg_catalog.has_function_privilege('postgres','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','bx1_private.lock_funding_person(uuid,uuid)','EXECUTE') then
    raise exception 'admission_principal_lock_baseline_changed' using errcode='55000'; end if;
end $$;

create function bx1_portal.admission_password_session() returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); amr jsonb; entry record;
begin
  select environment,manual_test_review,test_ordinary_entry_enabled,reviewer_scope into entry
    from bx1_portal.entry_configuration where singleton;
  if actor is null or entry.environment is distinct from 'TESTNET'
    or entry.manual_test_review is not true or entry.test_ordinary_entry_enabled is not true
    or bx1_portal.entry_manual_review_enabled() is not true
    or claims->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    or claims->>'sub' is distinct from actor::text or claims->>'role' is distinct from 'authenticated'
    or claims->>'aal' is distinct from 'aal1' or coalesce((claims->>'is_anonymous')::boolean,false)
    or pg_catalog.jsonb_typeof(claims->'exp') is distinct from 'number'
    or coalesce(claims->>'exp','') !~ '^[1-9][0-9]{0,11}$'
    or (claims->>'exp')::numeric<=extract(epoch from pg_catalog.clock_timestamp()) then return false; end if;
  amr:=claims->'amr';
  if pg_catalog.jsonb_typeof(amr) is distinct from 'array' or pg_catalog.jsonb_array_length(amr)<>1
    or amr->0->>'method' is distinct from 'password'
    or pg_catalog.jsonb_typeof(amr->0->'timestamp') is distinct from 'number'
    or coalesce(amr->0->>'timestamp','') !~ '^[1-9][0-9]{0,11}$'
    or (amr->0->>'timestamp')::numeric>extract(epoch from pg_catalog.clock_timestamp()) then return false; end if;
  if exists(select 1 from public.bx1_profiles where id=actor)
    and bx1_private.has_active_session() is not true then return false; end if;
  return exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=actor and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
      and s.id::text=claims->>'session_id' and s.aal::text='aal1' and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
      and not exists(select 1 from public.bx1_profiles p where p.id=actor and p.status<>'ACTIVE'));
exception when others then return false;
end $$;

create function bx1_portal.admission_session() returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fresh_session() or bx1_portal.admission_password_session();
$$;

create function bx1_portal.admission_context(c jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.valid_operating_context(c) then return true; end if;
  if bx1_portal.admission_password_session() is not true or pg_catalog.jsonb_typeof(c) is distinct from 'object' then return false; end if;
  if c='{"mode":"APPLICANT"}'::jsonb then return true; end if;
  if c->>'mode' is distinct from 'ROLE' or not(c ?& array['mode','organisationId','role'])
    or c-array['mode','organisationId','role']<>'{}'
    or pg_catalog.jsonb_typeof(c->'organisationId') is distinct from 'string'
    or c->>'organisationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(c->'role') is distinct from 'string' then return false; end if;
  return exists(select 1 from public.bx1_memberships m
    join public.bx1_profiles p on p.id=m.user_id join public.bx1_organisations o on o.id=m.organisation_id
    where m.user_id=auth.uid() and m.organisation_id=(c->>'organisationId')::uuid and m.role=c->>'role'
      and p.status='ACTIVE' and o.status='ACTIVE' and bx1_portal.native_membership_effective(m.id));
exception when others then return false;
end $$;

create function bx1_portal.admission_command_allowed(c jsonb,action text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare scope uuid;
begin
  if bx1_portal.admission_context(c) is not true then return false; end if;
  select reviewer_scope into scope from bx1_portal.entry_configuration where singleton and environment='TESTNET' and manual_test_review;
  if scope is null or bx1_portal.entry_manual_review_enabled() is not true then return false; end if;
  if c='{"mode":"APPLICANT"}'::jsonb then
    return coalesce(action=any(array['start_application','submit_application','create_investment_account',
      'create_entity_investment_account','request_representative_mandate','request_investing_representative_mandate']),false);
  end if;
  if scope is null or c->>'organisationId' is distinct from scope::text then return false; end if;
  if c->>'role'='ComplianceOfficer' then
    return coalesce(action=any(array['review_application','review_representative_mandate','review_investing_representative_mandate']),false);
  elsif c->>'role'='SuperAdmin' then
    return coalesce(action=any(array['apply_representative_mandate','apply_investing_representative_mandate']),false);
  end if;
  return false;
end $$;

create function bx1_portal.admission_command_context(c jsonb,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session()
    then bx1_portal.admission_command_allowed(c,action) else bx1_portal.valid_operating_context(c) end;
$$;

create function bx1_portal.admission_application_reviewer(c jsonb,target_scope uuid,target_org uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.scoped_reviewer(c,target_scope,target_org) then return true; end if;
  if bx1_portal.admission_password_session() is not true or bx1_portal.admission_context(c) is not true
    or c->>'mode' is distinct from 'ROLE' or c->>'role' is distinct from 'ComplianceOfficer'
    or c->>'organisationId' is distinct from target_scope::text
    or not exists(select 1 from bx1_portal.entry_configuration cfg
      where cfg.singleton and cfg.environment='TESTNET' and cfg.manual_test_review and cfg.reviewer_scope=target_scope) then return false; end if;
  if target_org is null or not exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=target_org) then return true; end if;
  return exists(select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=target_org
    and b.native_organisation_id=target_scope and b.role='ComplianceOfficer' and b.status='ACTIVE'
    and b.valid_from<=pg_catalog.clock_timestamp() and b.valid_until>pg_catalog.clock_timestamp());
end $$;

create function bx1_portal.admission_mandate_actor(c jsonb,target_scope uuid,actor_role text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.representative_mandate_actor(c,target_scope,actor_role)
    or (bx1_portal.admission_password_session() and bx1_portal.admission_context(c)
      and c->>'mode'='ROLE' and c->>'role'=actor_role and actor_role in ('ComplianceOfficer','SuperAdmin')
      and c->>'organisationId'=target_scope::text and exists(select 1 from bx1_portal.entry_configuration cfg
        where cfg.singleton and cfg.environment='TESTNET' and cfg.manual_test_review and cfg.reviewer_scope=target_scope));
$$;

create function bx1_portal.admission_mandate_command_actor(c jsonb,target_scope uuid,actor_role text,action text) returns boolean
language sql volatile security definer set search_path='' as $$
  select case when bx1_portal.admission_password_session()
    then bx1_portal.admission_command_allowed(c,action) and bx1_portal.admission_mandate_actor(c,target_scope,actor_role)
    else bx1_portal.representative_mandate_actor(c,target_scope,actor_role) end;
$$;

create function bx1_portal.admission_people_independent(a uuid,b uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.entity_people_independent(a,b) then return true; end if;
  if bx1_portal.admission_password_session() is not true or a is null or b is null or a=b then return false; end if;
  -- Unknown identities are functional TEST logins, never verified independent humans.
  -- A known revoked/pending person cannot fall back to being "unknown".
  if exists(select 1 from bx1_private.person_principals p left join bx1_private.persons h on h.id=p.person_id
    where p.auth_user_id in (a,b) and (p.status<>'TRUSTED' or h.status is distinct from 'TRUSTED'))
    or exists(select 1 from bx1_private.person_principals p1 join bx1_private.person_principals p2 on p2.person_id=p1.person_id
      where p1.auth_user_id=a and p2.auth_user_id=b) then return false; end if;
  return true;
end $$;

create function bx1_portal.admission_lock_people(target_users uuid[]) returns void
language plpgsql volatile security definer set search_path='' as $$
declare person_actor uuid;
begin
  for person_actor in select distinct u from pg_catalog.unnest(target_users) u where u is not null order by u loop
    perform bx1_private.lock_funding_person(person_actor,null);
  end loop;
end $$;

create function bx1_portal.admission_lock_actor(action text,c jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if bx1_portal.admission_password_session() is not true then perform bx1_portal.entry_lock_actor(); return; end if;
  if action is not null and bx1_portal.admission_command_allowed(c,action) is not true then
    raise exception 'admission_command_denied' using errcode='42501'; end if;
  if bx1_portal.admission_context(c) is not true then raise exception 'admission_context_denied' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||actor::text,0));
  perform singleton from bx1_portal.entry_configuration where singleton for share;
  perform id from auth.users where id=actor for share;
  perform id from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=actor for share;
  perform id from auth.mfa_factors where user_id=actor for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=actor and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  if bx1_portal.admission_password_session() is not true or bx1_portal.admission_context(c) is not true
    or (action is not null and bx1_portal.admission_command_allowed(c,action) is not true) then
    raise exception 'admission_authority_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.admission_individual_account_current(c jsonb,target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.account_usable(c,target_account) or (bx1_portal.admission_password_session()
    and bx1_portal.admission_command_allowed(c,'create_investment_account')
    and exists(select 1 from bx1_portal.investment_accounts i join bx1_portal.applications a on a.id=i.application_id
      where i.id=target_account and i.kind='INDIVIDUAL' and i.holder_user_id=auth.uid() and i.status='ACTIVE'
        and a.user_id=auth.uid() and a.persona='INVESTOR' and a.status='APPROVED'
        and a.details->>'investor_type'='INDIVIDUAL' and a.approved_until>pg_catalog.clock_timestamp()
        and bx1_portal.monitoring_new_action_allowed(a.id)));
$$;

create function bx1_portal.admission_access(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actions jsonb; env text;
begin
  if bx1_portal.admission_context(c) is not true then return null; end if;
  select environment into env from bx1_portal.entry_configuration where singleton;
  select coalesce(pg_catalog.jsonb_agg(action order by ordinal),'[]'::jsonb) into actions
    from pg_catalog.unnest(array['start_application','submit_application','review_application','create_investment_account',
      'create_entity_investment_account','request_representative_mandate','review_representative_mandate',
      'apply_representative_mandate','request_investing_representative_mandate','review_investing_representative_mandate',
      'apply_investing_representative_mandate']) with ordinality x(action,ordinal)
    where env='TESTNET' and bx1_portal.entry_manual_review_enabled() and bx1_portal.admission_command_allowed(c,action);
  return pg_catalog.jsonb_build_object('version',1,'environment',env,'actor_id',auth.uid(),'operating_context',c,
    'session_mode',case when bx1_portal.admission_password_session() then 'TEST_PASSWORD' else 'STANDARD' end,
    'allowed_commands',actions);
end $$;

create function bx1_portal.admission_action_independent(target_actor uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
  select bx1_portal.independent_of(target_actor) and
    (not bx1_portal.admission_password_session() or bx1_portal.admission_people_independent(auth.uid(),target_actor));
$admission_body$;

-- Trusted provider writer still receives server-validated actor/session only.
-- This alternative is confined to its exact qualified Stage 2 binding handler.
create function bx1_portal.admission_provider_session_current(target_actor uuid,target_session uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
  select bx1_private.provider_session_current(target_actor,target_session) or
    (target_actor is not null and target_session is not null
      and exists(select 1 from bx1_portal.entry_configuration cfg
        join public.bx1_organisations o on o.id=cfg.reviewer_scope
        where cfg.singleton and cfg.environment='TESTNET' and cfg.manual_test_review
          and cfg.test_ordinary_entry_enabled and o.status='ACTIVE')
      and exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
        where u.id=target_actor and s.id=target_session and s.aal::text='aal1' and s.oauth_client_id is null
          and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
          and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
          and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
          and not exists(select 1 from public.bx1_profiles p where p.id=target_actor and p.status<>'ACTIVE')));
$admission_body$;



create function bx1_portal.admission_entity_account_current(target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
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
      and bx1_portal.admission_people_independent(a.user_id,a.reviewer_id)
      and a.reviewer_scope=cfg.reviewer_scope and cfg.environment='TESTNET' and cfg.manual_test_review
      and bx1_portal.entry_manual_review_enabled()
      and p.submitted_details_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex')
      and a.details=v.details) and bx1_portal.monitoring_new_action_allowed((select application_id from bx1_portal.investment_accounts where id=target_account));
$admission_body$;

create function bx1_portal.admission_entity_application_openable(target_application uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
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
      and bx1_portal.admission_people_independent(a.user_id,a.reviewer_id)
      and a.details=v.details and cfg.environment='TESTNET' and cfg.manual_test_review
      and a.reviewer_scope=cfg.reviewer_scope and bx1_portal.entry_manual_review_enabled()
      and not exists(select 1 from bx1_portal.investment_accounts i where i.application_id=a.id))
    and bx1_portal.monitoring_new_action_allowed(target_application);
$admission_body$;

create function bx1_portal.admission_investing_mandate_current(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
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
      and bx1_portal.admission_entity_account_current(i.id));
$admission_body$;

create function bx1_portal.admission_investing_mandate_effective(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
select exists(select 1 from bx1_portal.investing_representative_mandates m
    join auth.users u on u.id=m.representative_user_id
    where m.id=target_mandate and m.status='APPLIED' and m.scope=array['ACCOUNT_VIEW','REQUEST_ELIGIBILITY']::text[]
      and m.transaction_limit_minor=0 and m.approval_receipt_id is not null
      and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and bx1_portal.admission_people_independent(m.representative_user_id,m.reviewer_user_id)
      and bx1_portal.admission_people_independent(m.representative_user_id,m.applied_by_user_id)
      and bx1_portal.admission_people_independent(m.reviewer_user_id,m.applied_by_user_id)
      and bx1_portal.admission_investing_mandate_current(m.id));
$admission_body$;

create function bx1_portal.admission_entity_account_projection(c jsonb,target_account uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare i bx1_portal.investment_accounts; p bx1_portal.legal_entity_parties;
  a bx1_portal.applications; own_application boolean; effective_mandate boolean;
  requestable boolean;
begin
  if bx1_portal.admission_context(c) is not true then return null; end if;
  select * into i from bx1_portal.investment_accounts where id=target_account and kind='ENTITY';
  if i.id is null then return null; end if;
  select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id;
  select * into a from bx1_portal.applications where id=i.application_id;
  own_application:=c->>'mode'='APPLICANT' and a.user_id=auth.uid();
  effective_mandate:=c->>'mode'='APPLICANT' and exists(
    select 1 from bx1_portal.investing_representative_mandates m
      where m.investment_account_id=i.id and m.representative_user_id=auth.uid()
        and bx1_portal.admission_investing_mandate_effective(m.id));
  if not (own_application or effective_mandate) then return null; end if;
  requestable:=own_application and bx1_portal.admission_entity_account_current(i.id)
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
end
$admission_body$;

create function bx1_portal.admission_investing_mandate_projection(c jsonb,target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare m bx1_portal.investing_representative_mandates; a bx1_portal.applications;
  p bx1_portal.legal_entity_parties; applicant_visible boolean; reviewer_visible boolean;
  applier_visible boolean; current_admission boolean; next_actor text;
begin
  if bx1_portal.admission_context(c) is not true then return null; end if;
  select * into m from bx1_portal.investing_representative_mandates where id=target_mandate;
  if m.id is null then return null; end if;
  select * into a from bx1_portal.applications where id=m.application_id;
  select * into p from bx1_portal.legal_entity_parties where id=m.entity_party_id;
  applicant_visible:=c->>'mode'='APPLICANT' and m.applicant_user_id=auth.uid();
  reviewer_visible:=false; applier_visible:=false;
  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer' then
    reviewer_visible:=bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer');
  elsif c->>'mode'='ROLE' and c->>'role'='SuperAdmin' then
    applier_visible:=bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  end if;
  if not(applicant_visible or reviewer_visible or applier_visible) then return null; end if;
  current_admission:=bx1_portal.admission_investing_mandate_current(m.id);
  next_actor:=case
    when m.status in ('CHANGES_REQUIRED','REJECTED')
      and bx1_portal.admission_entity_account_current(m.investment_account_id) then 'APPLICANT'
    when m.status='APPROVED' and m.requested_until<=clock_timestamp()
      and bx1_portal.admission_entity_account_current(m.investment_account_id) then 'APPLICANT'
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
    'effective',bx1_portal.admission_investing_mandate_effective(m.id),
    'next_owner',next_actor,
    'can_request',applicant_visible and
      ((bx1_portal.admission_entity_account_current(m.investment_account_id)
          and m.status in ('CHANGES_REQUIRED','REJECTED'))
        or (m.status='APPROVED' and m.requested_until<=clock_timestamp()
          and bx1_portal.admission_entity_account_current(m.investment_account_id))),
    'can_review',reviewer_visible and m.status='SUBMITTED' and current_admission
      and bx1_portal.admission_people_independent(auth.uid(),m.applicant_user_id),
    'can_apply',applier_visible and m.status='APPROVED' and current_admission
      and m.approval_receipt_id is not null
      and bx1_portal.admission_people_independent(auth.uid(),m.applicant_user_id)
      and bx1_portal.admission_people_independent(auth.uid(),m.reviewer_user_id),
    'can_revoke',not bx1_portal.admission_password_session() and (reviewer_visible or applier_visible) and m.status='APPLIED'
      and bx1_portal.admission_people_independent(auth.uid(),m.applicant_user_id));
end
$admission_body$;

create function bx1_portal.admission_representative_mandate_projection(c jsonb,target_mandate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare m bx1_portal.representative_mandates; a bx1_portal.applications; o bx1_portal.organisations;
  applicant_visible boolean; reviewer_visible boolean; applier_visible boolean;
  request_allowed boolean; review_allowed boolean; apply_allowed boolean; revoke_allowed boolean;
  next_actor text;
begin
  if bx1_portal.admission_context(c) is not true then return null; end if;
  select * into m from bx1_portal.representative_mandates where id=target_mandate;
  if m.id is null then return null; end if;
  select * into a from bx1_portal.applications where id=m.application_id;
  select * into o from bx1_portal.organisations where id=m.product_organisation_id;
  applicant_visible:=m.applicant_user_id=auth.uid() and c->>'mode'='APPLICANT';
  reviewer_visible:=false;
  applier_visible:=false;
  -- Explicit branches avoid evaluating both expensive staff authority paths
  -- for an applicant or a customer OfferingManager read.
  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer' then
    reviewer_visible:=bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer');
  elsif c->>'mode'='ROLE' and c->>'role'='SuperAdmin' then
    applier_visible:=bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin');
  end if;
  if not(applicant_visible or reviewer_visible or applier_visible) then return null; end if;
  request_allowed:=applicant_visible and
    (m.status in ('CHANGES_REQUIRED','REJECTED')
      or (m.status='APPROVED' and m.requested_until<=clock_timestamp()))
    and bx1_portal.representative_mandate_admission_current(m.id,true,false);
  review_allowed:=reviewer_visible and m.status='SUBMITTED'
    and bx1_portal.admission_action_independent(m.applicant_user_id)
    and bx1_portal.representative_mandate_admission_current(m.id,true);
  apply_allowed:=applier_visible and m.status='APPROVED' and m.approval_receipt_id is not null
    and bx1_portal.admission_action_independent(m.applicant_user_id)
    and m.reviewer_user_id is not null and bx1_portal.admission_action_independent(m.reviewer_user_id)
    and bx1_portal.representative_mandate_admission_current(m.id,true);
  revoke_allowed:=not bx1_portal.admission_password_session() and (reviewer_visible or applier_visible) and m.status='APPLIED'
    and bx1_portal.admission_action_independent(m.applicant_user_id);
  next_actor:=case
    -- The queue owner is a property of the case, not the current reader's
    -- permission to perform that owner's action. The can_* fields above
    -- remain actor-relative and are the only UI action affordances.
    when m.status in ('CHANGES_REQUIRED','REJECTED')
      and bx1_portal.representative_mandate_admission_current(m.id,true,false) then 'APPLICANT'
    when m.status='APPROVED' and m.requested_until<=clock_timestamp()
      and bx1_portal.representative_mandate_admission_current(m.id,true,false) then 'APPLICANT'
    when m.status='SUBMITTED'
      and bx1_portal.representative_mandate_admission_current(m.id,true) then 'COMPLIANCE'
    when m.status='APPROVED' and m.approval_receipt_id is not null
      and bx1_portal.representative_mandate_admission_current(m.id,true) then 'SUPER_ADMIN'
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
end
$admission_body$;

create function bx1_portal.admission_application_handoff(c jsonb,target_application uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare a bx1_portal.applications; cfg bx1_portal.entry_configuration;
  actor uuid:=auth.uid(); route text; intake boolean; own_applicant boolean;
  monitoring_allowed boolean; monitoring_state text; accounts jsonb; account_row record;
  mandate_row record; mandate_json jsonb:=null; mandate_projection jsonb;
  native_context jsonb:=null; actions jsonb:='[]'::jsonb;
  stage text:='UNAVAILABLE'; next_actor text:='PROVIDER_OWNER'; blocker text:='NONE';
  destination text:='NONE'; expected_issuer text;
begin
  if bx1_portal.admission_context(c) is not true then
    raise exception 'customer_handoff_context_denied' using errcode='42501'; end if;
  select * into cfg from bx1_portal.entry_configuration where singleton;
  if cfg.environment is null or cfg.environment not in ('TESTNET','MAINNET') then
    raise exception 'customer_handoff_environment_unavailable' using errcode='55000'; end if;
  expected_issuer:=case cfg.environment when 'TESTNET' then 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    else 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' end;
  if auth.jwt()->>'iss' is distinct from expected_issuer then
    raise exception 'customer_handoff_environment_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=target_application;
  if a.id is null then return null; end if;
  own_applicant:=c->>'mode'='APPLICANT' and a.user_id=actor;
  -- ROLE reads receive only applications already admitted to the exact live
  -- Compliance scope. A caller-supplied role, id or context is not authority.
  if bx1_portal.admission_case_visible(c,a.id) is not true then return null; end if;
  intake:=cfg.environment='TESTNET' and bx1_portal.entry_manual_review_enabled()
    and a.context_kind='PERSONAL' and a.context_organisation_id is null;
  route:=bx1_portal.application_review_route(a.id);
  monitoring_allowed:=bx1_portal.monitoring_new_action_allowed(a.id);
  select state into monitoring_state from bx1_portal.customer_monitoring_cases where application_id=a.id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',i.id,'kind',i.kind,'status',i.status) order by i.created_at,i.id),'[]'::jsonb)
    into accounts from bx1_portal.investment_accounts i where i.application_id=a.id;
  select * into account_row from bx1_portal.investment_accounts where application_id=a.id;
  if a.persona='WEALTH_MANAGER' then
    select * into mandate_row from bx1_portal.representative_mandates where application_id=a.id;
    if mandate_row.id is not null then
      mandate_projection:=bx1_portal.admission_representative_mandate_projection(c,mandate_row.id);
      mandate_json:=pg_catalog.jsonb_build_object('id',mandate_row.id,'status',mandate_row.status,
        'effective',bx1_portal.representative_mandate_effective(mandate_row.id));
      if own_applicant and bx1_portal.representative_mandate_effective(mandate_row.id)
        and exists(select 1 from public.bx1_memberships m
          where m.id=mandate_row.native_membership_id and m.user_id=actor
            and m.organisation_id=mandate_row.native_organisation_id and m.role='OfferingManager'
            and bx1_portal.native_membership_effective(m.id)) then
        native_context:=pg_catalog.jsonb_build_object('organisation_id',mandate_row.native_organisation_id,
          'role','OfferingManager'); end if;
    end if;
  end if;

  -- A closed route never falls through into synthetic or live actions. A read
  -- exposes linked history, but it cannot enable MAIN's sealed command paths.
  if a.provider_mode not in ('UNASSIGNED','MANUAL_TEST_REVIEW')
    or (a.status='APPROVED' and a.provider_mode<>'MANUAL_TEST_REVIEW') then
    blocker:='PROVIDER_UNSUPPORTED';
  elsif cfg.environment='TESTNET' and (a.context_kind<>'PERSONAL' or a.context_organisation_id is not null) then
    blocker:='CONTEXT_NOT_SUPPORTED'; next_actor:='COMPLIANCE';
  elsif not intake then blocker:='INTAKE_NOT_ADMITTED';
  elsif monitoring_state='ON_HOLD' then blocker:='MONITORING_ON_HOLD'; next_actor:='COMPLIANCE';
  elsif monitoring_state='RENEWAL_REQUIRED' then blocker:='MONITORING_RENEWAL_REQUIRED'; next_actor:='COMPLIANCE';
  elsif a.status='APPROVED' and (a.approved_until is null or a.approved_until<=clock_timestamp()) then
    blocker:='ADMISSION_EXPIRED'; next_actor:='COMPLIANCE';
  elsif account_row.id is not null and account_row.status='SUSPENDED' then
    blocker:='ACCOUNT_SUSPENDED'; next_actor:='COMPLIANCE';
  elsif a.status in ('DRAFT','CHANGES_REQUIRED','REJECTED') then
    stage:=case a.status when 'DRAFT' then 'PREPARE_APPLICATION'
      when 'CHANGES_REQUIRED' then 'INFORMATION_REQUIRED' else 'REAPPLICATION_REQUIRED' end;
    next_actor:='APPLICANT';
    if own_applicant then actions:='["PREPARE_APPLICATION"]'::jsonb; end if;
    if route='AVAILABLE' then
      if own_applicant then actions:=actions||'["SUBMIT_APPLICATION"]'::jsonb; end if;
    else
      blocker:=case route when 'REVIEWER_UNAVAILABLE' then 'REVIEWER_UNAVAILABLE' else 'INTAKE_NOT_ADMITTED' end;
      next_actor:='PROVIDER_OWNER'; end if;
  elsif a.status='SUBMITTED' then
    stage:='REVIEW_PENDING'; next_actor:='COMPLIANCE';
    if route<>'AVAILABLE' then
      blocker:=case route when 'REVIEWER_UNAVAILABLE' then 'REVIEWER_UNAVAILABLE' else 'INTAKE_NOT_ADMITTED' end;
      next_actor:='PROVIDER_OWNER'; end if;
  elsif a.status<>'APPROVED' or not monitoring_allowed then
    blocker:='ADMISSION_NOT_APPROVED'; next_actor:='COMPLIANCE';
  elsif a.persona='INVESTOR' then
    next_actor:='APPLICANT';
    if account_row.id is null then
      if a.details->>'investor_type'='INDIVIDUAL'
        or (own_applicant and bx1_portal.admission_entity_application_openable(a.id)) then
        stage:='OPEN_ACCOUNT';
        if own_applicant then actions:='["OPEN_INVESTMENT_ACCOUNT"]'::jsonb; destination:='INVESTMENT_ACCOUNT'; end if;
      else blocker:='CONTEXT_UNAVAILABLE'; next_actor:='COMPLIANCE'; end if;
    elsif account_row.kind='INDIVIDUAL' then
      if own_applicant and bx1_portal.admission_individual_account_current(c,account_row.id) then
        stage:='ACCOUNT_AVAILABLE'; actions:='["VIEW_INVESTMENT_ACCOUNT"]'::jsonb; destination:='INVESTMENT_ACCOUNT';
      else blocker:='CONTEXT_UNAVAILABLE'; next_actor:='COMPLIANCE'; end if;
    else
      -- Entity identity is visible to its applicant; operating access still
      -- requires its separate current investing-representative mandate.
      select * into mandate_row from bx1_portal.investing_representative_mandates
        where investment_account_id=account_row.id and representative_user_id=a.user_id
        order by cycle desc,created_at desc,id limit 1;
      if mandate_row.id is not null then
        mandate_json:=pg_catalog.jsonb_build_object('id',mandate_row.id,'status',mandate_row.status,
          'effective',bx1_portal.admission_investing_mandate_effective(mandate_row.id));
      end if;
      select bx1_portal.admission_entity_account_projection(c,account_row.id) into mandate_projection;
      if own_applicant and coalesce((mandate_projection->>'can_view')::boolean,false) then
        stage:='ACCOUNT_AVAILABLE'; actions:='["VIEW_INVESTMENT_ACCOUNT"]'::jsonb; destination:='INVESTMENT_ACCOUNT';
      elsif own_applicant and coalesce((mandate_projection->>'can_request_mandate')::boolean,false) then
        stage:='REQUEST_MANDATE'; actions:='["REQUEST_INVESTING_REPRESENTATIVE_MANDATE"]'::jsonb;
        destination:='INVESTMENT_ACCOUNT';
      else
        if mandate_row.id is not null then
          mandate_projection:=bx1_portal.admission_investing_mandate_projection(c,mandate_row.id);
          next_actor:=coalesce(mandate_projection->>'next_owner','COMPLIANCE');
          if mandate_row.status='SUBMITTED' and next_actor='COMPLIANCE' then
            stage:='MANDATE_REVIEW_PENDING';
          elsif mandate_row.status='APPROVED' and next_actor='SUPER_ADMIN' then
            stage:='MANDATE_APPLY_PENDING';
          else blocker:='MANDATE_NOT_EFFECTIVE';
            if next_actor='NONE' then next_actor:='COMPLIANCE'; end if;
          end if;
        else blocker:='MANDATE_NOT_EFFECTIVE'; next_actor:='COMPLIANCE'; end if;
      end if;
    end if;
  elsif a.admission_purpose='LEGACY_REHEARSAL' then
    -- Preserved historical owner capabilities remain in the canonical portal
    -- reader. They are not a new customer mandate or native role assignment.
    blocker:='CONTEXT_NOT_SUPPORTED'; next_actor:='NONE';
  elsif mandate_json is null then
    if own_applicant and bx1_portal.representative_mandate_requestable(a.id) then
      stage:='REQUEST_MANDATE'; next_actor:='APPLICANT'; actions:='["REQUEST_REPRESENTATIVE_MANDATE"]'::jsonb;
    else blocker:='CONTEXT_UNAVAILABLE'; next_actor:='COMPLIANCE'; end if;
  elsif mandate_row.status='SUBMITTED' and coalesce(mandate_projection->>'next_owner','NONE')='COMPLIANCE' then
    stage:='MANDATE_REVIEW_PENDING'; next_actor:='COMPLIANCE';
  elsif mandate_row.status='APPROVED' and coalesce(mandate_projection->>'next_owner','NONE')='SUPER_ADMIN' then
    stage:='MANDATE_APPLY_PENDING'; next_actor:='SUPER_ADMIN';
  elsif coalesce(mandate_projection->>'next_owner','NONE')='APPLICANT' then
    stage:='MANDATE_INFORMATION_REQUIRED'; next_actor:='APPLICANT';
    if own_applicant and coalesce((mandate_projection->>'can_request')::boolean,false) then
      actions:='["REQUEST_REPRESENTATIVE_MANDATE"]'::jsonb; end if;
  elsif coalesce((mandate_json->>'effective')::boolean,false) and native_context is not null then
    stage:='WORKSPACE_AVAILABLE'; next_actor:='APPLICANT';
    actions:='["ENTER_OPERATING_WORKSPACE"]'::jsonb; destination:='OPERATING_WORKSPACE';
  else blocker:='MANDATE_NOT_EFFECTIVE'; next_actor:='COMPLIANCE'; end if;
  if blocker<>'NONE' then
    native_context:=null; destination:='NONE';
    if blocker<>'REVIEWER_UNAVAILABLE' then actions:='[]'::jsonb; end if;
  end if;
  if bx1_portal.admission_context(c) is not true then
    raise exception 'customer_handoff_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('version',1,'environment',cfg.environment,'actor_id',actor,
    'application_id',a.id,'application_revision',a.revision,'persona',a.persona,'operating_context',c,
    'state',stage,'next_owner',next_actor,'blocker',blocker,'allowed_actions',actions,
    'gates',pg_catalog.jsonb_build_object('intake_admitted',intake,'reviewer_available',route='AVAILABLE',
      'monitoring_allows_new_actions',monitoring_allowed),'accounts',accounts,'mandate',mandate_json,
    'native_context',native_context,'destination',destination);
end
$admission_body$;


-- Scope comes from current native membership and immutable case route, never client actor fields.
create function bx1_portal.admission_case_visible(c jsonb,target_application uuid) returns boolean
language sql volatile security definer set search_path='' as $admission_body$
  select bx1_portal.admission_context(c) and exists(select 1 from bx1_portal.applications a
    where a.id=target_application and (
      (c='{"mode":"APPLICANT"}'::jsonb and a.user_id=auth.uid())
      or (a.status<>'DRAFT' and bx1_portal.admission_application_reviewer(c,a.reviewer_scope,a.organisation_id))
      or (a.status<>'DRAFT' and c->>'mode'='ROLE' and c->>'role'='SuperAdmin'
        and (exists(select 1 from bx1_portal.representative_mandates m where m.application_id=a.id
          and m.status='APPROVED' and bx1_portal.representative_mandate_admission_current(m.id,true)
          and bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin'))
        or exists(select 1 from bx1_portal.investing_representative_mandates m where m.application_id=a.id
          and m.status='APPROVED' and bx1_portal.admission_investing_mandate_current(m.id)
          and bx1_portal.admission_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin'))))));
$admission_body$;

create function bx1_portal.admission_review_context(target_application uuid) returns jsonb
language sql volatile security definer set search_path='' as $admission_body$
  select pg_catalog.jsonb_build_object('mode','ROLE','organisationId',a.reviewer_scope::text,'role','ComplianceOfficer')
    from bx1_portal.applications a where a.id=target_application and a.status<>'DRAFT'
      and bx1_portal.admission_application_reviewer(pg_catalog.jsonb_build_object('mode','ROLE',
        'organisationId',a.reviewer_scope::text,'role','ComplianceOfficer'),a.reviewer_scope,a.organisation_id);
$admission_body$;

create function bx1_portal.admission_entry_read() returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare actor uuid:=auth.uid(); result jsonb; c jsonb:='{"mode":"APPLICANT"}'::jsonb;
begin
  perform bx1_portal.admission_lock_actor(null,c);
  perform bx1_portal.admission_lock_people(array(select distinct person_id from bx1_portal.applications a,
    lateral pg_catalog.unnest(array[a.user_id,a.reviewer_id]) x(person_id) where a.user_id=actor));
  select pg_catalog.jsonb_build_object('entry_version',1,
    'actor',pg_catalog.jsonb_build_object('id',u.id,'email',u.email),
    'applications',coalesce((select pg_catalog.jsonb_agg((pg_catalog.to_jsonb(a)-'reviewer_scope')
      ||pg_catalog.jsonb_build_object('review_route',bx1_portal.application_review_route(a.id),
        'can_request_mandate',bx1_portal.representative_mandate_requestable(a.id),
        'handoff',bx1_portal.admission_application_handoff(c,a.id))
      order by a.created_at nulls first,a.id) from bx1_portal.applications a where a.user_id=actor),'[]'::jsonb),
    'contexts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('context_key',o.id,
      'organisation_id',o.id,'name',o.name,'roles',o.roles) order by o.name,o.id)
      from (select org.id,org.name,pg_catalog.jsonb_agg(m.role order by m.role) roles
        from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
        join public.bx1_organisations org on org.id=m.organisation_id
        where m.user_id=actor and p.status='ACTIVE' and org.status='ACTIVE'
          and bx1_portal.native_membership_effective(m.id) group by org.id,org.name) o),'[]'::jsonb),
    'admission',pg_catalog.jsonb_build_object('manual_test_review',bx1_portal.entry_manual_review_enabled()),
    'requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.request_key,
      'command',r.command,'application_id',r.application_id) order by r.created_at desc,r.request_key)
      from (select * from (select request_key,command,application_id,created_at from bx1_portal.entry_requests where actor_id=actor
        union all select r.request_key,r.command,m.application_id,r.created_at
          from bx1_portal.representative_mandate_requests r join bx1_portal.representative_mandates m on m.id=r.mandate_id
          where r.actor_id=actor and r.operating_context=c) original_requests
        where created_at>=pg_catalog.clock_timestamp()-interval '7 days' order by created_at desc,request_key limit 1000) r),'[]'::jsonb),
    'organisation_mandates',coalesce((select pg_catalog.jsonb_agg(v.value order by m.submitted_at,m.id)
      from bx1_portal.representative_mandates m cross join lateral
      (select bx1_portal.admission_representative_mandate_projection(c,m.id) value) v
      where v.value is not null),'[]'::jsonb),
    'workflow',pg_catalog.jsonb_build_object('version',1,'environment','TESTNET','actor_id',actor,'scoped_read_available',true),
    'stage2_access',bx1_portal.admission_access(c)) into result from auth.users u where u.id=actor;
  if bx1_portal.admission_password_session() is not true or bx1_portal.admission_context(c) is not true then
    raise exception 'admission_entry_authority_changed' using errcode='42501'; end if;
  return result;
end $admission_body$;

create function bx1_portal.admission_read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $admission_body$
declare actor uuid:=auth.uid(); result jsonb; visible_ids uuid[];
begin
  if bx1_portal.admission_password_session() is not true or bx1_portal.admission_context(c) is not true
    or (c->>'mode'='ROLE' and c->>'role' not in ('ComplianceOfficer','SuperAdmin')) then
    raise exception 'admission_read_scope_denied' using errcode='42501'; end if;
  perform bx1_portal.admission_lock_actor(null,c);
  perform bx1_portal.admission_lock_people(array(select distinct person_id from bx1_portal.applications a,
    lateral pg_catalog.unnest(array[actor,a.user_id,a.reviewer_id]) x(person_id)
    where bx1_portal.admission_case_visible(c,a.id)));
  select coalesce(pg_catalog.array_agg(a.id order by a.id),'{}'::uuid[]) into visible_ids
    from bx1_portal.applications a where bx1_portal.admission_case_visible(c,a.id);
  select pg_catalog.jsonb_build_object('operating_context',c,'stage2_access',bx1_portal.admission_access(c),
    'actor',pg_catalog.jsonb_build_object('id',actor,'email',u.email,
      'display_name',(select display_name from public.bx1_profiles where id=actor),
      'can_review',c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'),
    'applications',coalesce((select pg_catalog.jsonb_agg((pg_catalog.to_jsonb(a)-'reviewer_scope')
      ||pg_catalog.jsonb_build_object('can_create_entity_account',c='{"mode":"APPLICANT"}'::jsonb
          and bx1_portal.admission_entity_application_openable(a.id),
        'handoff',bx1_portal.admission_application_handoff(c,a.id))
      order by a.submitted_at,a.id) from bx1_portal.applications a where a.id=any(visible_ids)),'[]'::jsonb),
    'organisations','[]'::jsonb,'products','[]'::jsonb,'subscriptions','[]'::jsonb,
    'accounts',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by i.created_at,i.id)
      from bx1_portal.investment_accounts i where i.kind='INDIVIDUAL' and i.holder_user_id=actor
        and c='{"mode":"APPLICANT"}'::jsonb),'[]'::jsonb),
    'entity_investment_accounts',coalesce((select pg_catalog.jsonb_agg(v.value order by i.created_at,i.id)
      from bx1_portal.investment_accounts i cross join lateral
        (select bx1_portal.admission_entity_account_projection(c,i.id) value) v
      where i.kind='ENTITY' and v.value is not null),'[]'::jsonb),
    'organisation_mandates',coalesce((select pg_catalog.jsonb_agg(v.value order by m.submitted_at,m.id)
      from bx1_portal.representative_mandates m cross join lateral
        (select bx1_portal.admission_representative_mandate_projection(c,m.id) value) v
      where v.value is not null),'[]'::jsonb),
    'investing_representative_mandates',coalesce((select pg_catalog.jsonb_agg(v.value order by m.submitted_at,m.id)
      from bx1_portal.investing_representative_mandates m cross join lateral
        (select bx1_portal.admission_investing_mandate_projection(c,m.id) value) v
      where v.value is not null),'[]'::jsonb),
    'mandate_queue_available',true,'mandate_queue_blocked_reason',null,
    'entity_account_route_available',true,'entity_account_blocked_reason',null,
    'entity_mandate_queue_available',true,'entity_mandate_queue_blocked_reason',null,
    'product_eligibility','[]'::jsonb,'entity_product_eligibility','[]'::jsonb,
    'product_appointments','[]'::jsonb,'product_appointment_candidates','[]'::jsonb,
    'customer_monitoring',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'application_id',a.id,'application_revision',a.revision,'state',coalesce(m.state,'CURRENT'),'case_revision',coalesce(m.revision,0),
      'admission_expires_at',a.approved_until,'renewal_due',a.approved_until<=pg_catalog.clock_timestamp()+interval '7 days',
      'new_actions_allowed',
      bx1_portal.monitoring_new_action_allowed(a.id)) order by a.id)
      from bx1_portal.applications a left join bx1_portal.customer_monitoring_cases m on m.application_id=a.id
      where a.id=any(visible_ids) and (a.status='APPROVED' or m.application_id is not null)),'[]'::jsonb),
    'events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id,'subject_id',e.subject_id,
      'kind',e.kind,'actor_id',e.actor_id,'created_at',e.created_at,'summary',e.summary) order by e.created_at,e.id)
      from bx1_portal.events e where e.application_id=any(visible_ids)
        and e.kind=any(array['start_application','submit_application','review_application','create_investment_account',
          'create_entity_investment_account','request_representative_mandate','review_representative_mandate',
          'apply_representative_mandate','request_investing_representative_mandate',
          'review_investing_representative_mandate','apply_investing_representative_mandate'])),'[]'::jsonb),
    'requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',r.request_key,'command',r.command)
      order by r.created_at desc,r.request_key) from (select * from (
        select request_key,command,created_at from bx1_portal.scoped_requests where actor_id=actor and operating_context=c
        union all select request_key,command,created_at from bx1_portal.representative_mandate_requests where actor_id=actor and operating_context=c
      ) original_requests where created_at>=pg_catalog.clock_timestamp()-interval '7 days'
      order by created_at desc,request_key limit 1000) r),'[]'::jsonb)) into result from auth.users u where u.id=actor;
  if bx1_portal.admission_password_session() is not true or bx1_portal.admission_context(c) is not true
    or exists(select 1 from pg_catalog.unnest(visible_ids) id where bx1_portal.admission_case_visible(c,id) is not true) then
    raise exception 'admission_read_authority_changed' using errcode='42501'; end if;
  return result;
end $admission_body$;



-- Each altered routine is matched by the whole retained source body, not a
-- guessed hosted legacy alias. Unknown or ambiguous definitions fail closed.
do $admission_cutover$
declare spec jsonb; change jsonb; candidate_ids oid[]; target oid; before_meta jsonb; after_meta jsonb;
  source_body text; next_body text; definition text; occurrences integer;
begin
  for spec in select value from pg_catalog.jsonb_array_elements($baseline$[{"signature":"bx1_portal.customer_application_handoff(jsonb,uuid)","hash":"7bae3f759cfcc6a0138a58a47d3d28a196b68c3435f7b152fb072dc9fc9710b7"},{"signature":"bx1_portal.representative_mandate_projection(jsonb,uuid)","hash":"08f7ed45db76eb6f34fdb0b165b60bd7bdaeb19a9b63d1b301a09602356a9d4b"},{"signature":"bx1_portal.entity_account_admission_current_pre_monitoring(uuid)","hash":"de39bc7920c390c4b0d4eed1d32a4d4ae6d4ec073d32881079a1628b59dc9a76"},{"signature":"bx1_portal.entity_application_account_openable(uuid)","hash":"49c431b9540e04f409292f8f2a5b85c453aa9c1ae4c799425af4ad79b452dbbc"},{"signature":"bx1_portal.investing_mandate_current(uuid)","hash":"551c2027c0bd908a4336b4a0e88b5c8aa5d6d5fa40788c34da47a398611ddd44"},{"signature":"bx1_portal.investing_mandate_effective(uuid)","hash":"435739c171844b99705f06c5c5067f45e87ae344a6cb5e31ea154ebb54145bf9"},{"signature":"bx1_portal.investing_mandate_projection(jsonb,uuid)","hash":"5cd8fe19e4bea8b9f9eff60a0545edf893d11eb66114456007ea3afe1f4ab87e"},{"signature":"bx1_portal.entity_account_projection(jsonb,uuid)","hash":"4031c4a5f9b9136d9f9c16e9d620bd9594fe2c035dba202a0bbd85b90a3d4d5f"}]$baseline$::jsonb) loop
    target:=pg_catalog.to_regprocedure(spec->>'signature');
    if target is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=target
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')=spec->>'hash') then
      raise exception 'admission_projection_baseline_changed: %',spec->>'signature' using errcode='55000'; end if;
  end loop;
  for spec in select value from pg_catalog.jsonb_array_elements($cutovers$
[
  {
    "label": "canonical-application-review-and-individual-account",
    "signature": "bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "9900adab1a5188a28498b4de21bb1c1fb0f6210093621baba3b7d4129b708450",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  perform bx1_portal.admission_lock_actor(action,c);\n",
        "count": 1
      },
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.admission_command_context(c,action)",
        "count": 3
      },
      {
        "from": "bx1_portal.scoped_reviewer(c,app.reviewer_scope,app.organisation_id)",
        "to": "bx1_portal.admission_application_reviewer(c,app.reviewer_scope,app.organisation_id)",
        "count": 2
      },
      {
        "from": "if action='create_investment_account' and not bx1_portal.account_usable(c,account_row.id)",
        "to": "if action='create_investment_account' and not bx1_portal.admission_individual_account_current(c,account_row.id)",
        "count": 1
      }
    ]
  },
  {
    "label": "sole-legacy-review-transition-caller",
    "signature": "bx1_portal.execute_command_pre_entry(text,uuid,jsonb)",
    "scope": "exact",
    "expected_sha256": "dfd1d697b6202c3fb09d1f022bff7fae1b57e02b71903b440cec638e508d3c7a",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and command is distinct from 'review_application' then\n    raise exception 'admission_legacy_command_denied' using errcode='42501'; end if;\n  if bx1_portal.admission_password_session() then\n    perform bx1_portal.admission_lock_actor(command,bx1_portal.admission_review_context((payload->>'application_id')::uuid)); end if;\n",
        "count": 1
      },
      {
        "from": "bx1_portal.has_session()",
        "to": "(bx1_portal.has_session() or bx1_portal.admission_password_session())",
        "count": 2
      },
      {
        "from": "not bx1_portal.is_reviewer(a.reviewer_scope)",
        "to": "not (bx1_portal.is_reviewer(a.reviewer_scope) or bx1_portal.admission_application_reviewer(bx1_portal.admission_review_context(a.id),a.reviewer_scope,a.organisation_id))",
        "count": 1
      },
      {
        "from": "if not found or not (bx1_portal.is_reviewer",
        "to": "perform bx1_portal.admission_lock_people(array[v_actor,a.user_id]);\n    if a.id is null or not (bx1_portal.is_reviewer",
        "count": 1
      },
      {
        "from": "return bx1_portal.read_state();",
        "to": "if bx1_portal.admission_password_session() then return bx1_portal.admission_read_scoped(bx1_portal.admission_review_context((payload->>'application_id')::uuid)); end if;\n    return bx1_portal.read_state();",
        "count": 2
      },
      {
        "from": "not bx1_portal.independent_of(a.user_id)",
        "to": "not bx1_portal.admission_action_independent(a.user_id)",
        "count": 1
      }
    ]
  },
  {
    "label": "normal-start-submit",
    "signature": "bx1_portal.entry_command_pre_mandate(text,uuid,jsonb)",
    "scope": "exact",
    "expected_sha256": "09553d06aaa3f86389792202a97c6ff3d848c9bd5a45f2a9031e559ffbac473d",
    "changes": [
      {
        "from": "perform bx1_portal.entry_lock_actor();",
        "to": "perform bx1_portal.admission_lock_actor(command,'{\"mode\":\"APPLICANT\"}'::jsonb);",
        "count": 1
      }
    ]
  },
  {
    "label": "sole-submission",
    "signature": "bx1_portal.entry_submit(uuid,integer,jsonb)",
    "scope": "exact",
    "expected_sha256": "1d46ccb97f5e864a49b716f1805985a65bb81e9965351a358738c3744781335b",
    "changes": [
      {
        "from": "bx1_portal.fresh_session()",
        "to": "bx1_portal.admission_session()",
        "count": 1
      },
      {
        "from": "perform bx1_portal.validate_application(details,a.persona);",
        "to": "perform bx1_portal.admission_lock_people(array(select distinct x.actor_id from public.bx1_memberships m,\n    lateral pg_catalog.unnest(array[a.user_id,m.user_id]) x(actor_id)\n    where m.organisation_id=v_scope and m.role='ComplianceOfficer'));\n  perform bx1_portal.validate_application(details,a.persona);",
        "count": 1
      }
    ]
  },
  {
    "label": "normal-manager-request",
    "signature": "bx1_portal.entry_command(text,uuid,jsonb)",
    "scope": "exact",
    "expected_sha256": "48cb51ba7072de353735c1352ba9a7982a61e9bd1f8d38fb887460562efff4dd",
    "changes": [
      {
        "from": "perform bx1_portal.entry_lock_actor();",
        "to": "perform bx1_portal.admission_lock_actor(command,'{\"mode\":\"APPLICANT\"}'::jsonb);",
        "count": 1
      },
      {
        "from": "bx1_portal.fresh_session()",
        "to": "bx1_portal.admission_session()",
        "count": 1
      },
      {
        "from": "v_now:=clock_timestamp();",
        "to": "perform bx1_portal.admission_lock_people(array[actor,a.reviewer_id,m.reviewer_user_id]);\n  v_now:=clock_timestamp();",
        "count": 1
      }
    ]
  },
  {
    "label": "canonical-manager-mandate-review-apply",
    "signature": "bx1_portal.execute_scoped_pre_entity(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "db6e49489d3d8be9d150effbe463946ec1bd38bcccf49331c6f9c1f7187503ee",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      },
      {
        "from": "bx1_portal.valid_operating_context(c)",
        "to": "bx1_portal.admission_command_context(c,action)",
        "count": 2
      },
      {
        "from": "perform bx1_portal.entry_lock_actor();",
        "to": "perform bx1_portal.admission_lock_actor(action,c);",
        "count": 1
      },
      {
        "from": "bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role')",
        "to": "bx1_portal.admission_mandate_command_actor(c,m.reviewer_scope_organisation_id,c->>'role',action)",
        "count": 2
      },
      {
        "from": "bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer')",
        "to": "bx1_portal.admission_mandate_command_actor(c,m.reviewer_scope_organisation_id,'ComplianceOfficer',action)",
        "count": 1
      },
      {
        "from": "bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin')",
        "to": "bx1_portal.admission_mandate_command_actor(c,m.reviewer_scope_organisation_id,'SuperAdmin',action)",
        "count": 1
      },
      {
        "from": "v_now:=clock_timestamp();",
        "to": "perform bx1_portal.admission_lock_people(array[actor,m.applicant_user_id,m.reviewer_user_id,a.reviewer_id]);\n  v_now:=clock_timestamp();",
        "count": 1
      },
      {
        "from": "bx1_portal.independent_of(m.applicant_user_id)",
        "to": "bx1_portal.admission_action_independent(m.applicant_user_id)",
        "count": 3
      },
      {
        "from": "bx1_portal.independent_of(m.reviewer_user_id)",
        "to": "bx1_portal.admission_action_independent(m.reviewer_user_id)",
        "count": 2
      }
    ]
  },
  {
    "label": "canonical-entity-account-and-mandate",
    "signature": "bx1_portal.execute_scoped_pre_offering(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "4173d27b53fbcc4e6e7fac808e9bcef28d2f1dee7db8ba64714720d5f207a111",
    "changes": [
      {
        "from": "declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests;\n  a bx1_portal.applications; i bx1_portal.investment_accounts;\n  p bx1_portal.legal_entity_parties; m bx1_portal.investing_representative_mandates;\n  v bx1_portal.application_detail_versions; doc jsonb; existing_m uuid;\n  expected integer; decision text; expiry timestamptz; receipt_id uuid;\n  now_at timestamptz; record_id uuid; v_subject uuid; v_summary text;\nbegin\n  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'\n    and bx1_portal.entity_staff_source_assured(c) is not true then\n    raise exception 'entity_staff_source_mfa_required' using errcode='42501'; end if;\n  if action not in ('create_entity_investment_account',\n    'request_investing_representative_mandate',\n    'review_investing_representative_mandate',\n    'apply_investing_representative_mandate',\n    'revoke_investing_representative_mandate') then\n    return bx1_portal.execute_scoped_pre_entity(c,action,key,body); end if;\n  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true\n    then raise exception 'entity_route_unavailable' using errcode='42501'; end if;\n  if key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object'\n    or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'entity_invalid_command' using errcode='22023'; end if;\n  perform bx1_portal.entry_lock_actor();\n  perform singleton from bx1_portal.entry_configuration where singleton for share;\n  if c->>'mode'='ROLE' then\n    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;\n    perform id from public.bx1_memberships where user_id=actor\n      and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;\n  end if;\n  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true\n    then raise exception 'entity_context_changed' using errcode='42501'; end if;\n  select * into prior from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=key;\n  if found then\n    if prior.operating_context is distinct from c or prior.command is distinct from action\n      or prior.payload is distinct from body then\n      raise exception 'entity_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key)\n    or exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)\n    or exists(select 1 from bx1_portal.representative_mandate_requests r where r.actor_id=actor and r.request_key=key) then\n    raise exception 'entity_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='create_entity_investment_account' then\n    if c<>'{\"mode\":\"APPLICANT\"}'::jsonb then\n      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;\n    perform bx1_portal.require_keys(body,array['application_id']);\n    if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'\n      or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then\n      raise exception 'entity_application_reference_invalid' using errcode='22023'; end if;\n    select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid\n      and user_id=actor for share;\n    if a.id is not null then perform bx1_portal.lock_entity_people(array[actor,a.reviewer_id]); end if;\n    if a.id is null or bx1_portal.entity_application_account_openable(a.id) is not true then\n      raise exception 'entity_reviewed_application_required' using errcode='42501'; end if;\n    select * into v from bx1_portal.application_detail_versions\n      where application_id=a.id and application_revision=a.revision-1\n        and capture_kind='SUBMISSION' for share;\n    if v.application_id is null then raise exception 'entity_submitted_revision_missing' using errcode='23514'; end if;\n    insert into bx1_portal.legal_entity_parties(application_id,admission_revision,submitted_revision,\n      legal_name,registration_reference,country,submitted_details_sha256)\n      values(a.id,a.revision,v.application_revision,v.details->>'company_name',\n        v.details->>'registration_reference',v.details->>'country',\n        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex'))\n      returning * into p;\n    insert into bx1_portal.investment_accounts(application_id,kind,entity_party_id)\n      values(a.id,'ENTITY',p.id) returning * into i;\n    if bx1_portal.entity_account_admission_current(i.id) is not true then\n      raise exception 'entity_admission_changed' using errcode='42501'; end if;\n    v_subject:=i.id; v_summary:='Reviewed synthetic entity investment account opened. No representative, order, holding, wallet or funding authority granted.';\n\n  elsif action='request_investing_representative_mandate' then\n    if c<>'{\"mode\":\"APPLICANT\"}'::jsonb then\n      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;\n    perform bx1_portal.require_keys(body,array['investment_account_id','expected_revision',\n      'evidence_reference','appointment_document_id','requested_until']);\n    perform bx1_portal.require_text(body,'evidence_reference',20,400);\n    if pg_catalog.jsonb_typeof(body->'investment_account_id') is distinct from 'string'\n      or body->>'investment_account_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'appointment_document_id') is distinct from 'string'\n      or body->>'appointment_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'\n      or pg_catalog.jsonb_typeof(body->'requested_until') is distinct from 'string'\n      or body->>'requested_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$' then\n      raise exception 'entity_mandate_request_invalid' using errcode='22023'; end if;\n    begin expiry:=(body->>'requested_until')::timestamptz;\n    exception when others then raise exception 'entity_mandate_expiry_invalid' using errcode='22023'; end;\n    expected:=(body->>'expected_revision')::integer;\n    select * into i from bx1_portal.investment_accounts where id=(body->>'investment_account_id')::uuid\n      and kind='ENTITY' for share;\n    if i.id is null then raise exception 'entity_account_denied' using errcode='42501'; end if;\n    select * into a from bx1_portal.applications where id=i.application_id and user_id=actor for share;\n    if a.id is not null then perform bx1_portal.lock_entity_people(array[actor,a.reviewer_id]); end if;\n    select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id for share;\n    select * into v from bx1_portal.application_detail_versions\n      where application_id=a.id and application_revision=p.submitted_revision\n        and capture_kind='SUBMISSION' for share;\n    -- CHANGES_REQUIRED can revise explanation, expiry, or select another\n    -- COMPANY document from this already-approved immutable submission. A\n    -- newly uploaded object is deliberately NOT a correction route here.\n    select d.item into doc from pg_catalog.jsonb_array_elements(v.details->'documents') d(item)\n      where d.item->>'id'=body->>'appointment_document_id' and d.item->>'kind'='COMPANY';\n    now_at:=clock_timestamp();\n    if a.id is null or p.id is null or v.application_id is null or doc is null\n      or bx1_portal.entity_account_admission_current(i.id) is not true\n      or expiry<=now_at or expiry>a.approved_until or expiry>now_at+interval '30 days'\n      or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'\n        and o.name=doc->>'storage_path' and o.owner_id=actor::text\n        and o.metadata->>'size'=doc->>'size'\n        and o.metadata->>'mimetype'=doc->>'mime_type') then\n      raise exception 'entity_mandate_evidence_or_admission_denied' using errcode='42501'; end if;\n    select * into m from bx1_portal.investing_representative_mandates\n      where investment_account_id=i.id and representative_user_id=actor\n      order by cycle desc limit 1 for update;\n    if m.id is null or m.status='REVOKED'\n      or (m.status='APPLIED' and m.requested_until<=now_at) then\n      if expected<>0 then raise exception 'entity_mandate_stale_revision' using errcode='23514'; end if;\n      insert into bx1_portal.investing_representative_mandates(\n        investment_account_id,application_id,entity_party_id,applicant_user_id,\n        representative_user_id,reviewer_scope_organisation_id,admission_revision,cycle,\n        evidence_reference,appointment_document_id,appointment_document_sha256,\n        requested_until,submitted_at)\n        values(i.id,a.id,p.id,actor,actor,a.reviewer_scope,a.revision,coalesce(m.cycle,0)+1,\n          body->>'evidence_reference',(body->>'appointment_document_id')::uuid,\n          doc->>'sha256',expiry,now_at) returning * into m;\n    else\n      if m.revision<>expected or m.admission_revision<>a.revision\n        or (m.status not in ('CHANGES_REQUIRED','REJECTED')\n          and not(m.status='APPROVED' and m.requested_until<=now_at)) then\n        raise exception 'entity_mandate_stale_or_terminal' using errcode='23514'; end if;\n      update bx1_portal.investing_representative_mandates set\n        status='SUBMITTED',revision=revision+1,evidence_reference=body->>'evidence_reference',\n        appointment_document_id=(body->>'appointment_document_id')::uuid,\n        appointment_document_sha256=doc->>'sha256',requested_until=expiry,\n        submitted_at=now_at,reviewed_at=null,reviewer_user_id=null,\n        review_notes=null,review_checks='{}'::jsonb,approval_receipt_id=null\n        where id=m.id returning * into m;\n    end if;\n    if bx1_portal.investing_mandate_current(m.id) is not true or bx1_portal.fresh_session() is not true then\n      raise exception 'entity_mandate_authority_changed' using errcode='42501'; end if;\n    v_subject:=m.id; v_summary:='Entity representative appointment requested for account view and later eligibility request only. Transaction limit is zero.';\n\n  else\n    if c->>'mode'<>'ROLE' or c->>'role' not in ('ComplianceOfficer','SuperAdmin') then\n      raise exception 'entity_staff_context_required' using errcode='42501'; end if;\n    if action='review_investing_representative_mandate' then\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','decision','notes','checks']);\n      perform bx1_portal.require_text(body,'notes',20,3000);\n      decision:=body->>'decision';\n      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then\n        raise exception 'entity_mandate_decision_invalid' using errcode='22023'; end if;\n      perform bx1_portal.require_checks(body->'checks',array['appointment','legal_entity','scope'],decision='APPROVED');\n    elsif action='revoke_investing_representative_mandate' then\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','reason']);\n      perform bx1_portal.require_text(body,'reason',20,1000);\n    else\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision']);\n    end if;\n    if pg_catalog.jsonb_typeof(body->'mandate_id') is distinct from 'string'\n      or body->>'mandate_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then\n      raise exception 'entity_mandate_reference_invalid' using errcode='22023'; end if;\n    expected:=(body->>'expected_revision')::integer;\n    select * into m from bx1_portal.investing_representative_mandates where id=(body->>'mandate_id')::uuid;\n    if m.id is null or c->>'organisationId' is distinct from m.reviewer_scope_organisation_id::text then\n      raise exception 'entity_mandate_scope_denied' using errcode='42501'; end if;\n    select * into a from bx1_portal.applications where id=m.application_id for share;\n    select * into i from bx1_portal.investment_accounts where id=m.investment_account_id for share;\n    perform id from auth.users where id=m.representative_user_id for share;\n    perform bx1_portal.lock_entity_people(array[actor,m.representative_user_id,m.reviewer_user_id,a.reviewer_id]);\n    select * into m from bx1_portal.investing_representative_mandates where id=m.id for update;\n    if m.revision<>expected or a.id<>m.application_id or i.id<>m.investment_account_id\n      or not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role') then\n      raise exception 'entity_mandate_staff_or_revision_denied' using errcode='42501'; end if;\n    now_at:=clock_timestamp();\n    if action='review_investing_representative_mandate' then\n      if c->>'role'<>'ComplianceOfficer' or m.status<>'SUBMITTED'\n        or not bx1_portal.entity_people_independent(actor,m.representative_user_id)\n        or not bx1_portal.investing_mandate_current(m.id) then\n        raise exception 'entity_mandate_review_denied' using errcode='42501'; end if;\n      -- The reviewer must inspect the exact immutable application document.\n      -- Its SHA-256 is an applicant claim until an independent byte check is\n      -- recorded; these checks are a manual synthetic decision, not provider\n      -- verification or automatic approval.\n      receipt_id:=pg_catalog.gen_random_uuid();\n      insert into bx1_portal.investing_representative_receipts(\n        id,mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(receipt_id,m.id,m.revision+1,action,actor,c,body,m.admission_revision,decision);\n      update bx1_portal.investing_representative_mandates set status=decision,revision=revision+1,\n        reviewed_at=now_at,reviewer_user_id=actor,review_notes=body->>'notes',\n        review_checks=body->'checks',approval_receipt_id=case when decision='APPROVED' then receipt_id else null end\n        where id=m.id returning * into m;\n      v_summary:='Independent synthetic review of exact entity representative appointment: '||decision||'. No trading granted.';\n    elsif action='apply_investing_representative_mandate' then\n      if c->>'role'<>'SuperAdmin' or m.status<>'APPROVED' or m.approval_receipt_id is null\n        or not bx1_portal.investing_mandate_current(m.id)\n        or not bx1_portal.entity_people_independent(actor,m.representative_user_id)\n        or not bx1_portal.entity_people_independent(actor,m.reviewer_user_id) then\n        raise exception 'entity_mandate_apply_denied' using errcode='42501'; end if;\n      update bx1_portal.investing_representative_mandates set status='APPLIED',revision=revision+1,\n        applied_at=now_at,applied_by_user_id=actor where id=m.id returning * into m;\n      if bx1_portal.investing_mandate_effective(m.id) is not true then\n        raise exception 'entity_mandate_effective_check_failed' using errcode='42501'; end if;\n      insert into bx1_portal.investing_representative_receipts(\n        mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n      v_summary:='Separately approved entity representative mandate applied: account view and future eligibility request; zero transaction limit.';\n    else\n      if m.status<>'APPLIED' or not bx1_portal.entity_people_independent(actor,m.representative_user_id) then\n        raise exception 'entity_mandate_revoke_denied' using errcode='42501'; end if;\n      update bx1_portal.investing_representative_mandates set status='REVOKED',revision=revision+1,\n        revoked_at=now_at,revoked_by_user_id=actor,revoke_reason=body->>'reason'\n        where id=m.id returning * into m;\n      if bx1_portal.investing_mandate_effective(m.id) then\n        raise exception 'entity_mandate_revoke_failed' using errcode='23514'; end if;\n      insert into bx1_portal.investing_representative_receipts(\n        mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n      v_summary:='Entity representative mandate revoked; account view and eligibility-request scope ended.';\n    end if;\n    if not bx1_portal.representative_mandate_actor(c,m.reviewer_scope_organisation_id,c->>'role')\n      or not bx1_portal.entity_people_independent(actor,m.representative_user_id) then\n      raise exception 'entity_mandate_staff_authority_changed' using errcode='42501'; end if;\n    v_subject:=m.id;\n  end if;\n  if action='request_investing_representative_mandate' then\n    insert into bx1_portal.investing_representative_receipts(\n      mandate_id,mandate_revision,action,actor_id,operating_context,\n      command_payload,admission_revision,status_after)\n      values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n  end if;\n  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.entry_manual_review_enabled() is not true then\n    raise exception 'entity_authority_changed' using errcode='42501'; end if;\n  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)\n    values(v_subject,a.id,action,actor,v_summary) returning id into record_id;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n    values(actor,key,c,action,body);\n  return bx1_portal.read_scoped(c);\nend",
        "to": "declare actor uuid:=auth.uid(); prior bx1_portal.scoped_requests;\n  a bx1_portal.applications; i bx1_portal.investment_accounts;\n  p bx1_portal.legal_entity_parties; m bx1_portal.investing_representative_mandates;\n  v bx1_portal.application_detail_versions; doc jsonb; existing_m uuid;\n  expected integer; decision text; expiry timestamptz; receipt_id uuid;\n  now_at timestamptz; record_id uuid; v_subject uuid; v_summary text;\nbegin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n  if c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'\n    and bx1_portal.entity_staff_source_assured(c) is not true\n    and not (bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action)) then\n    raise exception 'entity_staff_source_mfa_required' using errcode='42501'; end if;\n  if action not in ('create_entity_investment_account',\n    'request_investing_representative_mandate',\n    'review_investing_representative_mandate',\n    'apply_investing_representative_mandate',\n    'revoke_investing_representative_mandate') then\n    return bx1_portal.execute_scoped_pre_entity(c,action,key,body); end if;\n  if bx1_portal.admission_command_context(c,action) is not true or bx1_portal.entry_manual_review_enabled() is not true\n    then raise exception 'entity_route_unavailable' using errcode='42501'; end if;\n  if key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object'\n    or pg_catalog.octet_length(body::text)>65536 then\n    raise exception 'entity_invalid_command' using errcode='22023'; end if;\n  perform bx1_portal.admission_lock_actor(action,c);\n  perform singleton from bx1_portal.entry_configuration where singleton for share;\n  if c->>'mode'='ROLE' then\n    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;\n    perform id from public.bx1_memberships where user_id=actor\n      and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;\n  end if;\n  if bx1_portal.admission_command_context(c,action) is not true or bx1_portal.entry_manual_review_enabled() is not true\n    then raise exception 'entity_context_changed' using errcode='42501'; end if;\n  select * into prior from bx1_portal.scoped_requests r where r.actor_id=actor and r.request_key=key;\n  if found then\n    if prior.operating_context is distinct from c or prior.command is distinct from action\n      or prior.payload is distinct from body then\n      raise exception 'entity_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.read_scoped(c);\n  end if;\n  if exists(select 1 from bx1_portal.entry_requests r where r.actor_id=actor and r.request_key=key)\n    or exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)\n    or exists(select 1 from bx1_portal.representative_mandate_requests r where r.actor_id=actor and r.request_key=key) then\n    raise exception 'entity_prior_key_conflict' using errcode='23505'; end if;\n\n  if action='create_entity_investment_account' then\n    if c<>'{\"mode\":\"APPLICANT\"}'::jsonb then\n      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;\n    perform bx1_portal.require_keys(body,array['application_id']);\n    if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'\n      or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then\n      raise exception 'entity_application_reference_invalid' using errcode='22023'; end if;\n    select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid\n      and user_id=actor for share;\n    if a.id is not null then perform bx1_portal.admission_lock_people(array[actor,a.reviewer_id]); end if;\n    if a.id is null or bx1_portal.admission_entity_application_openable(a.id) is not true then\n      raise exception 'entity_reviewed_application_required' using errcode='42501'; end if;\n    select * into v from bx1_portal.application_detail_versions\n      where application_id=a.id and application_revision=a.revision-1\n        and capture_kind='SUBMISSION' for share;\n    if v.application_id is null then raise exception 'entity_submitted_revision_missing' using errcode='23514'; end if;\n    insert into bx1_portal.legal_entity_parties(application_id,admission_revision,submitted_revision,\n      legal_name,registration_reference,country,submitted_details_sha256)\n      values(a.id,a.revision,v.application_revision,v.details->>'company_name',\n        v.details->>'registration_reference',v.details->>'country',\n        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v.details::text,'UTF8')),'hex'))\n      returning * into p;\n    insert into bx1_portal.investment_accounts(application_id,kind,entity_party_id)\n      values(a.id,'ENTITY',p.id) returning * into i;\n    if bx1_portal.admission_entity_account_current(i.id) is not true then\n      raise exception 'entity_admission_changed' using errcode='42501'; end if;\n    v_subject:=i.id; v_summary:='Reviewed synthetic entity investment account opened. No representative, order, holding, wallet or funding authority granted.';\n\n  elsif action='request_investing_representative_mandate' then\n    if c<>'{\"mode\":\"APPLICANT\"}'::jsonb then\n      raise exception 'entity_applicant_context_required' using errcode='42501'; end if;\n    perform bx1_portal.require_keys(body,array['investment_account_id','expected_revision',\n      'evidence_reference','appointment_document_id','requested_until']);\n    perform bx1_portal.require_text(body,'evidence_reference',20,400);\n    if pg_catalog.jsonb_typeof(body->'investment_account_id') is distinct from 'string'\n      or body->>'investment_account_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'appointment_document_id') is distinct from 'string'\n      or body->>'appointment_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'\n      or pg_catalog.jsonb_typeof(body->'requested_until') is distinct from 'string'\n      or body->>'requested_until' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$' then\n      raise exception 'entity_mandate_request_invalid' using errcode='22023'; end if;\n    begin expiry:=(body->>'requested_until')::timestamptz;\n    exception when others then raise exception 'entity_mandate_expiry_invalid' using errcode='22023'; end;\n    expected:=(body->>'expected_revision')::integer;\n    select * into i from bx1_portal.investment_accounts where id=(body->>'investment_account_id')::uuid\n      and kind='ENTITY' for share;\n    if i.id is null then raise exception 'entity_account_denied' using errcode='42501'; end if;\n    select * into a from bx1_portal.applications where id=i.application_id and user_id=actor for share;\n    if a.id is not null then perform bx1_portal.admission_lock_people(array[actor,a.reviewer_id]); end if;\n    select * into p from bx1_portal.legal_entity_parties where id=i.entity_party_id for share;\n    select * into v from bx1_portal.application_detail_versions\n      where application_id=a.id and application_revision=p.submitted_revision\n        and capture_kind='SUBMISSION' for share;\n    -- CHANGES_REQUIRED can revise explanation, expiry, or select another\n    -- COMPANY document from this already-approved immutable submission. A\n    -- newly uploaded object is deliberately NOT a correction route here.\n    select d.item into doc from pg_catalog.jsonb_array_elements(v.details->'documents') d(item)\n      where d.item->>'id'=body->>'appointment_document_id' and d.item->>'kind'='COMPANY';\n    now_at:=clock_timestamp();\n    if a.id is null or p.id is null or v.application_id is null or doc is null\n      or bx1_portal.admission_entity_account_current(i.id) is not true\n      or expiry<=now_at or expiry>a.approved_until or expiry>now_at+interval '30 days'\n      or not exists(select 1 from storage.objects o where o.bucket_id='bx1-portal-documents'\n        and o.name=doc->>'storage_path' and o.owner_id=actor::text\n        and o.metadata->>'size'=doc->>'size'\n        and o.metadata->>'mimetype'=doc->>'mime_type') then\n      raise exception 'entity_mandate_evidence_or_admission_denied' using errcode='42501'; end if;\n    select * into m from bx1_portal.investing_representative_mandates\n      where investment_account_id=i.id and representative_user_id=actor\n      order by cycle desc limit 1 for update;\n    if m.id is null or m.status='REVOKED'\n      or (m.status='APPLIED' and m.requested_until<=now_at) then\n      if expected<>0 then raise exception 'entity_mandate_stale_revision' using errcode='23514'; end if;\n      insert into bx1_portal.investing_representative_mandates(\n        investment_account_id,application_id,entity_party_id,applicant_user_id,\n        representative_user_id,reviewer_scope_organisation_id,admission_revision,cycle,\n        evidence_reference,appointment_document_id,appointment_document_sha256,\n        requested_until,submitted_at)\n        values(i.id,a.id,p.id,actor,actor,a.reviewer_scope,a.revision,coalesce(m.cycle,0)+1,\n          body->>'evidence_reference',(body->>'appointment_document_id')::uuid,\n          doc->>'sha256',expiry,now_at) returning * into m;\n    else\n      if m.revision<>expected or m.admission_revision<>a.revision\n        or (m.status not in ('CHANGES_REQUIRED','REJECTED')\n          and not(m.status='APPROVED' and m.requested_until<=now_at)) then\n        raise exception 'entity_mandate_stale_or_terminal' using errcode='23514'; end if;\n      update bx1_portal.investing_representative_mandates set\n        status='SUBMITTED',revision=revision+1,evidence_reference=body->>'evidence_reference',\n        appointment_document_id=(body->>'appointment_document_id')::uuid,\n        appointment_document_sha256=doc->>'sha256',requested_until=expiry,\n        submitted_at=now_at,reviewed_at=null,reviewer_user_id=null,\n        review_notes=null,review_checks='{}'::jsonb,approval_receipt_id=null\n        where id=m.id returning * into m;\n    end if;\n    if bx1_portal.admission_investing_mandate_current(m.id) is not true or bx1_portal.admission_session() is not true then\n      raise exception 'entity_mandate_authority_changed' using errcode='42501'; end if;\n    v_subject:=m.id; v_summary:='Entity representative appointment requested for account view and later eligibility request only. Transaction limit is zero.';\n\n  else\n    if c->>'mode'<>'ROLE' or c->>'role' not in ('ComplianceOfficer','SuperAdmin') then\n      raise exception 'entity_staff_context_required' using errcode='42501'; end if;\n    if action='review_investing_representative_mandate' then\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','decision','notes','checks']);\n      perform bx1_portal.require_text(body,'notes',20,3000);\n      decision:=body->>'decision';\n      if decision not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then\n        raise exception 'entity_mandate_decision_invalid' using errcode='22023'; end if;\n      perform bx1_portal.require_checks(body->'checks',array['appointment','legal_entity','scope'],decision='APPROVED');\n    elsif action='revoke_investing_representative_mandate' then\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision','reason']);\n      perform bx1_portal.require_text(body,'reason',20,1000);\n    else\n      perform bx1_portal.require_keys(body,array['mandate_id','expected_revision']);\n    end if;\n    if pg_catalog.jsonb_typeof(body->'mandate_id') is distinct from 'string'\n      or body->>'mandate_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n      or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$' then\n      raise exception 'entity_mandate_reference_invalid' using errcode='22023'; end if;\n    expected:=(body->>'expected_revision')::integer;\n    select * into m from bx1_portal.investing_representative_mandates where id=(body->>'mandate_id')::uuid;\n    if m.id is null or c->>'organisationId' is distinct from m.reviewer_scope_organisation_id::text then\n      raise exception 'entity_mandate_scope_denied' using errcode='42501'; end if;\n    select * into a from bx1_portal.applications where id=m.application_id for share;\n    select * into i from bx1_portal.investment_accounts where id=m.investment_account_id for share;\n    perform id from auth.users where id=m.representative_user_id for share;\n    perform bx1_portal.admission_lock_people(array[actor,m.representative_user_id,m.reviewer_user_id,a.reviewer_id]);\n    select * into m from bx1_portal.investing_representative_mandates where id=m.id for update;\n    if m.revision<>expected or a.id<>m.application_id or i.id<>m.investment_account_id\n      or not bx1_portal.admission_mandate_command_actor(c,m.reviewer_scope_organisation_id,c->>'role',action) then\n      raise exception 'entity_mandate_staff_or_revision_denied' using errcode='42501'; end if;\n    now_at:=clock_timestamp();\n    if action='review_investing_representative_mandate' then\n      if c->>'role'<>'ComplianceOfficer' or m.status<>'SUBMITTED'\n        or not bx1_portal.admission_people_independent(actor,m.representative_user_id)\n        or not bx1_portal.admission_investing_mandate_current(m.id) then\n        raise exception 'entity_mandate_review_denied' using errcode='42501'; end if;\n      -- The reviewer must inspect the exact immutable application document.\n      -- Its SHA-256 is an applicant claim until an independent byte check is\n      -- recorded; these checks are a manual synthetic decision, not provider\n      -- verification or automatic approval.\n      receipt_id:=pg_catalog.gen_random_uuid();\n      insert into bx1_portal.investing_representative_receipts(\n        id,mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(receipt_id,m.id,m.revision+1,action,actor,c,body,m.admission_revision,decision);\n      update bx1_portal.investing_representative_mandates set status=decision,revision=revision+1,\n        reviewed_at=now_at,reviewer_user_id=actor,review_notes=body->>'notes',\n        review_checks=body->'checks',approval_receipt_id=case when decision='APPROVED' then receipt_id else null end\n        where id=m.id returning * into m;\n      v_summary:='Independent synthetic review of exact entity representative appointment: '||decision||'. No trading granted.';\n    elsif action='apply_investing_representative_mandate' then\n      if c->>'role'<>'SuperAdmin' or m.status<>'APPROVED' or m.approval_receipt_id is null\n        or not bx1_portal.admission_investing_mandate_current(m.id)\n        or not bx1_portal.admission_people_independent(actor,m.representative_user_id)\n        or not bx1_portal.admission_people_independent(actor,m.reviewer_user_id) then\n        raise exception 'entity_mandate_apply_denied' using errcode='42501'; end if;\n      update bx1_portal.investing_representative_mandates set status='APPLIED',revision=revision+1,\n        applied_at=now_at,applied_by_user_id=actor where id=m.id returning * into m;\n      if bx1_portal.admission_investing_mandate_effective(m.id) is not true then\n        raise exception 'entity_mandate_effective_check_failed' using errcode='42501'; end if;\n      insert into bx1_portal.investing_representative_receipts(\n        mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n      v_summary:='Separately approved entity representative mandate applied: account view and future eligibility request; zero transaction limit.';\n    else\n      if m.status<>'APPLIED' or not bx1_portal.admission_people_independent(actor,m.representative_user_id) then\n        raise exception 'entity_mandate_revoke_denied' using errcode='42501'; end if;\n      update bx1_portal.investing_representative_mandates set status='REVOKED',revision=revision+1,\n        revoked_at=now_at,revoked_by_user_id=actor,revoke_reason=body->>'reason'\n        where id=m.id returning * into m;\n      if bx1_portal.admission_investing_mandate_effective(m.id) then\n        raise exception 'entity_mandate_revoke_failed' using errcode='23514'; end if;\n      insert into bx1_portal.investing_representative_receipts(\n        mandate_id,mandate_revision,action,actor_id,operating_context,\n        command_payload,admission_revision,status_after)\n        values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n      v_summary:='Entity representative mandate revoked; account view and eligibility-request scope ended.';\n    end if;\n    if not bx1_portal.admission_mandate_command_actor(c,m.reviewer_scope_organisation_id,c->>'role',action)\n      or not bx1_portal.admission_people_independent(actor,m.representative_user_id) then\n      raise exception 'entity_mandate_staff_authority_changed' using errcode='42501'; end if;\n    v_subject:=m.id;\n  end if;\n  if action='request_investing_representative_mandate' then\n    insert into bx1_portal.investing_representative_receipts(\n      mandate_id,mandate_revision,action,actor_id,operating_context,\n      command_payload,admission_revision,status_after)\n      values(m.id,m.revision,action,actor,c,body,m.admission_revision,m.status);\n  end if;\n  if bx1_portal.admission_command_context(c,action) is not true or bx1_portal.entry_manual_review_enabled() is not true then\n    raise exception 'entity_authority_changed' using errcode='42501'; end if;\n  insert into bx1_portal.events(subject_id,application_id,kind,actor_id,summary)\n    values(v_subject,a.id,action,actor,v_summary) returning id into record_id;\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)\n    values(actor,key,c,action,body);\n  return bx1_portal.read_scoped(c);\nend",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-legacy-dispatch-eligibility_outer",
    "signature": "bx1_portal.execute_scoped_pre_mandate(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "5fd22051fd2142ecd653a082c603d6eeafda732562d68631d3bd174d49f99755",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-legacy-dispatch-offering_outer",
    "signature": "bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "eb17e37bf841e1c2a46228db54632e9304c3614729463e954eeed74d836a978b",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-legacy-dispatch-monitoring_outer",
    "signature": "bx1_portal.execute_scoped_pre_fund_v2(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "f7614aea6ad0eb5d21531ae483ab23527b4cbfe0f0d82ce9808259b6e27b05b0",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-legacy-dispatch-realestate_outer",
    "signature": "bx1_portal.execute_scoped_pre_product_appointment(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "3c44ee1422ef0cfff71ebf57c98e158a65d3937697aa20f6355eaa34de30b77e",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-legacy-dispatch-appointment_outer",
    "signature": "bx1_portal.execute_scoped_pre_entity_eligibility(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "7429b08cc18cc7bd487f87c68eff6e18fbec908e4538d35ed3df33e5945f0948",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-current-dispatch",
    "signature": "bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)",
    "scope": "scoped-body",
    "expected_sha256": "0dea8e84625354c1b37be22fdb17bf2d0bbebfc4d71cf2cc87318dd3efc839eb",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and bx1_portal.admission_command_allowed(c,action) is not true then\n    raise exception 'admission_protected_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      }
    ]
  },
  {
    "label": "protected-normal-command-dispatch",
    "signature": "bx1_portal.execute_command(text,uuid,jsonb)",
    "scope": "exact",
    "expected_sha256": "0c45109e5eb115608844f989a2fefdd7f359a15c6cd16dfcba615f8e2e435844",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() and command not in ('submit_application','review_application') then\n    raise exception 'admission_legacy_command_denied' using errcode='42501'; end if;\n",
        "count": 1
      },
      {
        "from": "perform bx1_portal.entry_lock_actor();",
        "to": "perform bx1_portal.admission_lock_actor(command,'{\"mode\":\"APPLICANT\"}'::jsonb);",
        "count": 1
      },
      {
        "from": "return bx1_portal.read_state();",
        "to": "if bx1_portal.admission_password_session() then return bx1_portal.admission_read_scoped('{\"mode\":\"APPLICANT\"}'::jsonb); end if;\n    return bx1_portal.read_state();",
        "count": 2
      }
    ]
  },
  {
    "label": "normal-entry-reader",
    "signature": "bx1_portal.entry_read()",
    "scope": "exact",
    "expected_sha256": "9801051cc1bf2d19a1d99fe4286b5815e908b0885d331573102e8badd823e174",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n      if bx1_portal.admission_password_session() then return bx1_portal.admission_entry_read(); end if;\n",
        "count": 1
      },
      {
        "from": "'scoped_read_available',scoped_available));",
        "to": "'scoped_read_available',scoped_available))||pg_catalog.jsonb_build_object('stage2_access',bx1_portal.admission_access('{\"mode\":\"APPLICANT\"}'::jsonb));",
        "count": 1
      }
    ]
  },
  {
    "label": "normal-scoped-reader",
    "signature": "bx1_portal.read_scoped(jsonb)",
    "scope": "exact",
    "expected_sha256": "b5c7085f21d208b211a555a98963690b7c7a0f36cf825be604109a218f799b15",
    "changes": [
      {
        "from": "begin\n",
        "to": "begin\n  if bx1_portal.admission_password_session() then return bx1_portal.admission_read_scoped(c); end if;\n",
        "count": 1
      },
      {
        "from": "'entity_product_eligibility',cases,'entity_investment_accounts',accounts);",
        "to": "'entity_product_eligibility',cases,'entity_investment_accounts',accounts,'stage2_access',bx1_portal.admission_access(c));",
        "count": 1
      }
    ]
  },
  {
    "label": "private-case-document-scope",
    "signature": "bx1_portal.application_document_access(uuid,jsonb)",
    "scope": "exact",
    "expected_sha256": "2bf2e66a039a0ad28bc9127810027ba3996b54dbfafc89aa92f2faa88fb0b721",
    "changes": [
      {
        "from": "or bx1_portal.fresh_session() is not true\n    or bx1_private.has_session_mfa() is not true\n    or bx1_private.has_token_mfa() is not true",
        "to": "or not ((bx1_portal.fresh_session() and bx1_private.has_session_mfa() and bx1_private.has_token_mfa())\n      or bx1_portal.admission_password_session())",
        "count": 1
      },
      {
        "from": "if a.id is null then return false; end if;",
        "to": "if a.id is null then return false; end if;\n  if bx1_portal.admission_password_session() then\n    return bx1_portal.admission_case_visible(operating_context,a.id) and\n      (operating_context='{\"mode\":\"APPLICANT\"}'::jsonb or operating_context->>'role'='ComplianceOfficer'); end if;",
        "count": 1
      }
    ]
  },
  {
    "label": "immutable-private-document-download",
    "signature": "bx1_portal.object_readable(text)",
    "scope": "exact",
    "expected_sha256": "cd87feab3e3e09b08af6a787e7656514392cb8bfaa17a2f284e55be4c5cc6d95",
    "changes": [
      {
        "from": "or bx1_portal.fresh_session() is not true\n    or bx1_private.has_session_mfa() is not true\n    or bx1_private.has_token_mfa() is not true",
        "to": "or not ((bx1_portal.fresh_session() and bx1_private.has_session_mfa() and bx1_private.has_token_mfa())\n      or bx1_portal.admission_password_session())",
        "count": 1
      }
    ]
  },
  {
    "label": "application-document-lifecycle",
    "signature": "public.bx1_document_lifecycle_mode()",
    "scope": "exact",
    "expected_sha256": "21ab987ad99354bbe485d6579df804e2c2d2b7266880704a817def65c0b2a06a",
    "changes": [
      {
        "from": "bx1_portal.has_session()",
        "to": "(bx1_portal.has_session() or bx1_portal.admission_password_session())",
        "count": 1
      }
    ]
  },
  {
    "label": "application-document-receipts",
    "signature": "public.bx1_document_receipts_required()",
    "scope": "exact",
    "expected_sha256": "7dab78ee41efc5689515595af883ed9dc87e0a8b1076a19cdda5298591b72548",
    "changes": [
      {
        "from": "bx1_portal.has_session()",
        "to": "(bx1_portal.has_session() or bx1_portal.admission_password_session())",
        "count": 1
      }
    ]
  },
  {
    "label": "application-document-upload",
    "signature": "bx1_portal.document_upload_allowed(text,text,jsonb)",
    "scope": "exact",
    "expected_sha256": "c10deeee44cfd2b446175a57a5c9c351a9293658faf0c0e1f41ee5c17989463e",
    "changes": [
      {
        "from": "bx1_portal.has_session()",
        "to": "(bx1_portal.has_session() or bx1_portal.admission_password_session())",
        "count": 2
      }
    ]
  },
  {
    "label": "application-document-scan_status",
    "signature": "public.bx1_document_scan_status(uuid)",
    "scope": "exact",
    "expected_sha256": "5f2abf62914870b8cf825c05d4cd8665a694a2b2e792dfa7f19104eac409cea7",
    "changes": [
      {
        "from": "if bx1_portal.fresh_session() is not true\n    or bx1_private.has_session_mfa() is not true\n    or bx1_private.has_token_mfa() is not true",
        "to": "if not ((bx1_portal.fresh_session() and bx1_private.has_session_mfa() and bx1_private.has_token_mfa())\n    or bx1_portal.admission_password_session())",
        "count": 1
      }
    ]
  },
  {
    "label": "application-document-scan_queue",
    "signature": "public.bx1_document_scan_queue()",
    "scope": "exact",
    "expected_sha256": "eb4f29196f779fb3b97788504dafd89a96875d219f686df7212e1da38e6207b2",
    "changes": [
      {
        "from": "if bx1_portal.fresh_session() is not true\n    or bx1_private.has_session_mfa() is not true\n    or bx1_private.has_token_mfa() is not true",
        "to": "if not ((bx1_portal.fresh_session() and bx1_private.has_session_mfa() and bx1_private.has_token_mfa())\n    or bx1_portal.admission_password_session())",
        "count": 1
      }
    ]
  },
  {
    "label": "qualified-provider-evidence-reader",
    "signature": "bx1_private.read_provider_evidence(uuid)",
    "scope": "exact",
    "expected_sha256": "607eab49af59c7f566f4609e405ca804d976fb912784571b60c1568ba02d21c6",
    "changes": [
      {
        "from": "bx1_portal.fresh_session()",
        "to": "bx1_portal.admission_session()",
        "count": 2
      },
      {
        "from": "bx1_portal.has_session()",
        "to": "(bx1_portal.has_session() or bx1_portal.admission_password_session())",
        "count": 1
      },
      {
        "from": "bx1_portal.scoped_reviewer(",
        "to": "bx1_portal.admission_application_reviewer(",
        "count": 2
      }
    ]
  },
  {
    "label": "qualified-provider-exact-submission-binding",
    "signature": "bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text)",
    "scope": "exact",
    "expected_sha256": "c2793d17d6d4fbb6e198616e7a12e1e9f07aa1853383d02baf634cad658127da",
    "changes": [
      {
        "from": "perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;",
        "to": "perform id from auth.users where id=p_actor for share;\n  perform id from public.bx1_profiles where id=p_actor for share;\n  perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;",
        "count": 1
      },
      {
        "from": "bx1_private.provider_session_current(p_actor,p_session)",
        "to": "bx1_portal.admission_provider_session_current(p_actor,p_session)",
        "count": 1
      },
      {
        "from": "select * into b from bx1_private.provider_application_bindings",
        "to": "if bx1_portal.admission_provider_session_current(p_actor,p_session) is not true then\n    raise exception 'provider_session_changed_after_wait' using errcode='42501'; end if;\n  select * into b from bx1_private.provider_application_bindings",
        "count": 1
      }
    ]
  }
,
{
  "label": "retire-legacy-rehearsal-write-authority",
  "signature": "bx1_portal.synthetic_compliance_command(jsonb,text,uuid,jsonb)",
  "scope": "exact",
  "expected_sha256": "e6ea9b70fd7fe6267df3f9d15c212ccd5c56ae3f5c28e0cdef15568e2ff5fe14",
  "changes": [
    {
      "from": "declare actor uuid:=auth.uid(); a bx1_portal.applications; prior bx1_portal.scoped_requests; approved_organisation uuid;\nbegin\n  if action is distinct from 'review_application' then\n    raise exception 'synthetic_compliance_command_denied' using errcode='42501'; end if;\n  if key is null or key='00000000-0000-0000-0000-000000000000'\n    or pg_catalog.jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>65536 then\n    raise exception 'synthetic_compliance_invalid_command' using errcode='22023'; end if;\n  perform bx1_portal.require_keys(body,array['application_id','expected_revision','decision','notes','checks']);\n  perform bx1_portal.require_text(body,'notes',20,3000);\n  if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'\n    or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'\n    or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'\n    or coalesce(body->>'decision','') not in ('APPROVED','CHANGES_REQUIRED','REJECTED') then\n    raise exception 'synthetic_compliance_invalid_decision' using errcode='22023'; end if;\n  perform bx1_portal.lock_synthetic_compliance(c,(body->>'application_id')::uuid);\n  if bx1_portal.synthetic_compliance_case_current(c,(body->>'application_id')::uuid) is not true then\n    raise exception 'synthetic_compliance_case_denied' using errcode='42501'; end if;\n  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;\n  if found then\n    if prior.operating_context is distinct from c or prior.command is distinct from action or prior.payload is distinct from body then\n      raise exception 'synthetic_compliance_idempotency_conflict' using errcode='23505'; end if;\n    return bx1_portal.synthetic_compliance_read(c);\n  end if;\n  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.representative_mandate_requests where actor_id=actor and request_key=key)\n    or exists(select 1 from bx1_portal.product_service_appointment_requests where actor_id=actor and request_key=key) then\n    raise exception 'synthetic_compliance_prior_key_conflict' using errcode='23505'; end if;\n  select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid for update;\n  if bx1_portal.synthetic_compliance_case_current(c,a.id) is not true then\n    raise exception 'synthetic_compliance_case_changed_after_wait' using errcode='42501'; end if;\n  approved_organisation:=bx1_portal.review_application_transition(a.id,(body->>'expected_revision')::integer,\n    body->>'decision',body->>'notes',body->'checks',pg_catalog.clock_timestamp());\n  insert into bx1_portal.requests(actor_id,request_key,command,payload) values(actor,key,action,body);\n  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);\n  insert into bx1_portal.events(subject_id,application_id,organisation_id,kind,actor_id,summary)\n    values(a.id,a.id,approved_organisation,action,actor,\n      'SYNTHETIC_COMPLIANCE manifest-only AAL1 rehearsal decision: '||(body->>'decision')||'. Not independent-human, scanner or provider acceptance.');\n  if bx1_portal.synthetic_compliance_context(c) is not true or bx1_portal.synthetic_compliance_case_current(c,a.id) is not true then\n    raise exception 'synthetic_compliance_authority_changed' using errcode='42501'; end if;\n  return bx1_portal.synthetic_compliance_read(c);\nend",
      "to": "begin\n  raise exception 'admission_legacy_rehearsal_write_retired' using errcode='42501';\nend",
      "count": 1
    }
  ]
}
]
$cutovers$::jsonb) loop
    if spec->>'scope'='scoped-body' then
      select pg_catalog.array_agg(p.oid) into candidate_ids from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='bx1_portal' and p.proname::text like 'execute_scoped%'
          and pg_catalog.oidvectortypes(p.proargtypes)='jsonb, text, uuid, jsonb'
          and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')=spec->>'expected_sha256';
      if pg_catalog.cardinality(candidate_ids) is distinct from 1 then
        raise exception 'admission_writer_target_ambiguous: %',spec->>'label' using errcode='55000'; end if;
      target:=candidate_ids[1];
    else target:=pg_catalog.to_regprocedure(spec->>'signature'); end if;
    if target is null then raise exception 'admission_function_missing: %',spec->>'label' using errcode='55000'; end if;
    select p.prosrc,pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
      'security_definer',p.prosecdef,'configuration',p.proconfig,'arguments',p.proargtypes::text,
      'result',p.prorettype,'kind',p.prokind,'language',p.prolang,'volatility',p.provolatile)
      into source_body,before_meta from pg_catalog.pg_proc p where p.oid=target;
    if before_meta->>'owner' is distinct from ('postgres'::regrole::oid)::text
      or before_meta->>'security_definer' is distinct from 'true'
      or before_meta->'configuration' is distinct from '["search_path=\"\""]'::jsonb
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex')
        is distinct from spec->>'expected_sha256' then
      raise exception 'admission_full_definition_changed: %',spec->>'label' using errcode='55000'; end if;
    next_body:=pg_catalog.btrim(pg_catalog.replace(source_body,E'\r\n',E'\n'),E' \n\t');
    for change in select value from pg_catalog.jsonb_array_elements(spec->'changes') loop
      occurrences:=(pg_catalog.length(next_body)-pg_catalog.length(pg_catalog.replace(next_body,change->>'from','')))
        /pg_catalog.length(change->>'from');
      if occurrences is distinct from (change->>'count')::integer then
        raise exception 'admission_exact_callsite_changed: %',spec->>'label' using errcode='55000'; end if;
      next_body:=pg_catalog.replace(next_body,change->>'from',change->>'to');
    end loop;
    definition:=pg_catalog.pg_get_functiondef(target);
    occurrences:=(pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body);
    if occurrences<>1 then raise exception 'admission_function_body_ambiguous' using errcode='55000'; end if;
    execute pg_catalog.replace(definition,source_body,next_body);
    select pg_catalog.jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
      'security_definer',p.prosecdef,'configuration',p.proconfig,'arguments',p.proargtypes::text,
      'result',p.prorettype,'kind',p.prokind,'language',p.prolang,'volatility',p.provolatile)
      into after_meta from pg_catalog.pg_proc p where p.oid=target;
    if after_meta is distinct from before_meta or (select p.prosrc from pg_catalog.pg_proc p where p.oid=target) is distinct from next_body then
      raise exception 'admission_function_identity_changed' using errcode='55000'; end if;
  end loop;
end $admission_cutover$;

-- These derived routines are callable only by the existing trusted owner
-- boundaries. No public RPC, row policy, table grant, role or factor is added.
do $admission_private_acl$
declare routine record;
begin
  for routine in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='bx1_portal' and p.proname::text like 'admission_%' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',routine.oid::regprocedure);
  end loop;
end $admission_private_acl$;
