-- Additive Stage 2 subject availability. Apply after bx1_provider_binding.sql.
-- Replace only its qualified binding body; preserve signature, owner and ACL.
-- No existing binding/event/receipt, provider activation, LOGIN or grant changes.
do $$ begin
  if current_user <> 'postgres'
    or pg_catalog.to_regprocedure('bx1_private.bind_provider_application(uuid,uuid,uuid,integer,text,text,text)') is null
    or pg_catalog.to_regclass('bx1_private.provider_boundary_receipts') is null
    or pg_catalog.to_regclass('bx1_portal.application_detail_versions') is null then
    raise exception 'provider_subject_availability_baseline_required' using errcode='55000';
  end if;
end $$;

create or replace function bx1_private.bind_provider_application(
  p_actor uuid,p_session uuid,p_application uuid,p_revision integer,
  p_individual_level text,p_company_level text,p_client_id text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; v bx1_portal.application_detail_versions;
  b bx1_private.provider_application_bindings; env text; subject_type text; level text;
begin
  select environment into env from bx1_portal.entry_configuration where singleton for share;
  if env is distinct from 'TESTNET' then raise exception 'provider_environment_not_admitted' using errcode='42501'; end if;
  if p_actor is null or p_session is null or p_application is null or p_revision is null or p_revision<1
    or p_client_id is null or char_length(p_client_id) not between 1 and 150
    or p_client_id<>btrim(p_client_id) or p_client_id ~ '[[:cntrl:]]' then
    raise exception 'provider_binding_invalid' using errcode='22023'; end if;
  perform s.id from auth.sessions s where s.id=p_session and s.user_id=p_actor for share;
  if bx1_private.provider_session_current(p_actor,p_session) is not true then
    raise exception 'provider_session_denied' using errcode='42501'; end if;
  select * into a from bx1_portal.applications where id=p_application for share;
  if a.id is null or a.user_id is distinct from p_actor or a.revision is distinct from p_revision
    or a.context_kind<>'PERSONAL' or a.status<>'SUBMITTED'
    or a.admission_purpose not in ('INVESTOR_ADMISSION','CUSTOMER_ORGANISATION_ADMISSION') then
    raise exception 'provider_application_denied' using errcode='42501'; end if;
  select * into v from bx1_portal.application_detail_versions
    where application_id=a.id and application_revision=a.revision for share;
  if v.application_id is null or v.capture_kind<>'SUBMISSION' or v.details is distinct from a.details
    or v.submitted_at is distinct from a.submitted_at or a.submitted_at is null then
    raise exception 'provider_submission_required' using errcode='23514'; end if;
  if jsonb_typeof(v.details->'full_name') is distinct from 'string'
    or char_length(btrim(v.details->>'full_name')) not between 2 and 120
    or jsonb_typeof(v.details->'country') is distinct from 'string'
    or v.details->>'country' !~ '^[A-Z]{2}$' then
    raise exception 'provider_subject_invalid' using errcode='23514'; end if;
  if a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
    and v.details->>'investor_type'='INDIVIDUAL' and not(v.details ? 'details_version') then
    subject_type:='individual';
  elsif (a.persona='INVESTOR' and a.admission_purpose='INVESTOR_ADMISSION'
      and v.details->>'investor_type'='ENTITY'
      and (not(v.details ? 'details_version') or v.details->'details_version'='3'::jsonb))
    or (a.persona='WEALTH_MANAGER' and a.admission_purpose='CUSTOMER_ORGANISATION_ADMISSION'
      and v.details->'details_version' in ('2'::jsonb,'3'::jsonb)) then
    if jsonb_typeof(v.details->'company_name') is distinct from 'string'
      or char_length(btrim(v.details->>'company_name')) not between 3 and 160
      or jsonb_typeof(v.details->'registration_reference') is distinct from 'string'
      or char_length(btrim(v.details->>'registration_reference')) not between 3 and 100 then
      raise exception 'provider_subject_invalid' using errcode='23514'; end if;
    subject_type:='company';
  else raise exception 'provider_subject_invalid' using errcode='23514'; end if;
  -- Validate the independently derived subject's selected level, not an unused
  -- provider capability. Explicit NULL denial avoids three-valued IF bypass.
  level:=case when subject_type='individual' then p_individual_level else p_company_level end;
  if level is null or char_length(level) not between 1 and 120
    or level<>btrim(level) or level ~ '[[:cntrl:]]' then
    raise exception 'provider_binding_invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_provider_binding:'||a.id::text||':r'||a.revision,0));
  select * into b from bx1_private.provider_application_bindings
    where provider='SUMSUB' and environment=env and application_id=a.id and application_revision=a.revision;
  if b.id is not null then
    if row(b.actor_id,b.expected_applicant_type,b.expected_level_name,b.expected_client_id,b.source_version_revision)
      is distinct from row(p_actor,subject_type,level,p_client_id,a.revision) then
      raise exception 'provider_binding_conflict' using errcode='23514'; end if;
  else
    insert into bx1_private.provider_application_bindings
      (provider,environment,application_id,application_revision,actor_id,external_user_id,
       expected_applicant_type,expected_level_name,expected_client_id,source_version_revision)
      values('SUMSUB',env,a.id,a.revision,p_actor,'bx1:testnet:'||a.id::text||':r'||a.revision,
        subject_type,level,p_client_id,v.application_revision) returning * into b;
    insert into bx1_private.provider_boundary_receipts
      (binding_id,source_kind,actor_id,application_id,application_revision,environment)
      values(b.id,'SERVER_BINDING',p_actor,a.id,a.revision,env);
  end if;
  return pg_catalog.jsonb_build_object('binding_id',b.id,'application_id',b.application_id,
    'application_revision',b.application_revision,'actor_id',b.actor_id,'environment',b.environment,
    'external_user_id',b.external_user_id,'expected_applicant_type',b.expected_applicant_type,
    'expected_level_name',b.expected_level_name,'expected_client_id',b.expected_client_id,
    'source_version_revision',b.source_version_revision);
end $$;
