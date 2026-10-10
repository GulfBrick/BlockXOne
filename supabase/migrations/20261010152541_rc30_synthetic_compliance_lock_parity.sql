-- rc30: correct only the installed rc29 synthetic Compliance lock's hosted
-- SELECT-only native-identity permission boundary. No new helper or grant,
-- table/policy/config/business change, MFA relaxation, or funding dispatch.
-- Apply atomically as postgres after the exact rc29 feature.
-- The existing authority-owner helper also locks the linked person. Its known
-- cross-administration lock-order risk remains fail-closed, not resolved here.
do $synthetic_compliance_lock_parity$
declare parent pg_catalog.pg_proc; helper pg_catalog.pg_proc; definition text;
  expected_parent text; expected_helper text; old_lock text; new_lock text;
begin
  if current_user<>'postgres'
    or pg_catalog.to_regprocedure('bx1_portal.lock_synthetic_compliance(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null then
    raise exception 'synthetic_compliance_lock_parity_baseline_required' using errcode='55000'; end if;
  select * into parent from pg_catalog.pg_proc
    where oid='bx1_portal.lock_synthetic_compliance(jsonb,uuid)'::regprocedure;
  select * into helper from pg_catalog.pg_proc
    where oid='bx1_private.lock_funding_person(uuid,uuid)'::regprocedure;
  expected_helper:=$helper$declare linked_person uuid;
begin
  select pp.person_id into linked_person from bx1_private.person_principals pp
    where pp.auth_user_id=actor for share;
  perform p.id from bx1_private.persons p where p.id=coalesce(expected_person,linked_person) for share;
end$helper$;
  if helper.proowner<>'bx1_authority_owner'::regrole or not helper.prosecdef or helper.provolatile<>'v'
    or helper.prorettype<>'void'::regtype or helper.proargnames is distinct from array['actor','expected_person']::text[]
    or helper.proconfig is distinct from array['search_path=""']::text[]
    or pg_catalog.btrim(pg_catalog.replace(helper.prosrc,E'\r\n',E'\n'),E' \n\t')<>expected_helper
    or not pg_catalog.has_function_privilege('postgres',helper.oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('bx1_authority_owner',helper.oid,'EXECUTE')
    or exists(select 1 from pg_catalog.aclexplode(coalesce(helper.proacl,
        pg_catalog.acldefault('f',helper.proowner))) a
      where a.grantee not in ('postgres'::regrole,'bx1_authority_owner'::regrole)
        or a.privilege_type<>'EXECUTE' or a.is_grantable) then
    raise exception 'synthetic_compliance_lock_helper_changed' using errcode='55000'; end if;
  expected_parent:=$parent$declare actor uuid:=auth.uid();
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
end$parent$;
  if parent.proowner<>'postgres'::regrole or not parent.prosecdef or parent.provolatile<>'v'
    or parent.prorettype<>'void'::regtype or parent.proargnames is distinct from array['c','target_application']::text[]
    or parent.proconfig is distinct from array['search_path=""']::text[]
    or pg_catalog.btrim(pg_catalog.replace(parent.prosrc,E'\r\n',E'\n'),E' \n\t')<>expected_parent then
    raise exception 'synthetic_compliance_lock_parent_changed' using errcode='55000'; end if;
  old_lock:=$old$  perform p.auth_user_id from bx1_private.person_principals p
    where p.auth_user_id=actor or p.auth_user_id in (select applicant_user_id from bx1_private.synthetic_compliance_cases
      where reviewer_user_id=actor and reviewer_scope=(c->>'organisationId')::uuid
        and (target_application is null or application_id=target_application)) order by p.auth_user_id for share;$old$;
  new_lock:=$new$  for locked_actor in
    select actor union select applicant_user_id from bx1_private.synthetic_compliance_cases
      where reviewer_user_id=actor and reviewer_scope=(c->>'organisationId')::uuid
        and (target_application is null or application_id=target_application)
      order by 1
  loop
    perform bx1_private.lock_funding_person(locked_actor,null);
  end loop;$new$;
  definition:=pg_catalog.pg_get_functiondef(parent.oid);
  if pg_catalog.strpos(definition,old_lock)=0 then
    old_lock:=pg_catalog.replace(old_lock,E'\n',E'\r\n');
    new_lock:=pg_catalog.replace(new_lock,E'\n',E'\r\n');
  end if;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,old_lock,'')))
      <>pg_catalog.length(old_lock) then
    raise exception 'synthetic_compliance_lock_statement_changed' using errcode='55000'; end if;
  definition:=pg_catalog.replace(definition,'declare actor uuid:=auth.uid();',
    'declare actor uuid:=auth.uid(); locked_actor uuid;');
  execute pg_catalog.replace(definition,old_lock,new_lock);
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=parent.oid
    and p.proowner=parent.proowner and p.proacl is not distinct from parent.proacl
    and p.prosecdef=parent.prosecdef and p.proconfig is not distinct from parent.proconfig
    and p.provolatile=parent.provolatile) then
    raise exception 'synthetic_compliance_lock_identity_changed' using errcode='55000'; end if;
end $synthetic_compliance_lock_parity$;
