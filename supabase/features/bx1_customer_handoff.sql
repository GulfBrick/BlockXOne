-- Shared Stage 2 customer handoff. Read projections only: no customer, account,
-- mandate, decision, role, provider event, financial or contract mutation.
-- Install after the current Stage 2 account/monitoring definitions and all
-- later retained reader migrations. MAIN's scoped RPC seal is preserved.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regclass('bx1_portal.customer_monitoring_cases') is null
    or pg_catalog.to_regclass('bx1_portal.investing_representative_mandates') is null
    or pg_catalog.to_regprocedure('bx1_portal.monitoring_new_action_allowed(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entity_application_account_openable(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.representative_mandate_projection(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_read_pre_handoff()') is not null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped_pre_handoff(jsonb)') is not null then
    raise exception 'customer_handoff_baseline_required' using errcode='55000'; end if;
  if exists(select 1 from pg_catalog.pg_proc p where p.oid in (
      'bx1_portal.entry_read()'::regprocedure,'bx1_portal.read_scoped(jsonb)'::regprocedure,
      'public.bx1_entry_read()'::regprocedure,'public.bx1_portal_read_scoped(jsonb)'::regprocedure)
      and p.proowner<>'postgres'::regrole) then
    raise exception 'customer_handoff_reader_owner_changed' using errcode='55000'; end if;
end $$;

create function bx1_portal.customer_application_handoff(c jsonb,target_application uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a bx1_portal.applications; cfg bx1_portal.entry_configuration;
  actor uuid:=auth.uid(); route text; intake boolean; own_applicant boolean;
  monitoring_allowed boolean; monitoring_state text; accounts jsonb; account_row record;
  mandate_row record; mandate_json jsonb:=null; mandate_projection jsonb;
  native_context jsonb:=null; actions jsonb:='[]'::jsonb;
  stage text:='UNAVAILABLE'; next_actor text:='PROVIDER_OWNER'; blocker text:='NONE';
  destination text:='NONE'; expected_issuer text;
begin
  if bx1_portal.valid_operating_context(c) is not true then
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
  if a.user_id<>actor and not (a.status<>'DRAFT'
    and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)) then return null; end if;
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
      mandate_projection:=bx1_portal.representative_mandate_projection(c,mandate_row.id);
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
        or (own_applicant and bx1_portal.entity_application_account_openable(a.id)) then
        stage:='OPEN_ACCOUNT';
        if own_applicant then actions:='["OPEN_INVESTMENT_ACCOUNT"]'::jsonb; destination:='INVESTMENT_ACCOUNT'; end if;
      else blocker:='CONTEXT_UNAVAILABLE'; next_actor:='COMPLIANCE'; end if;
    elsif account_row.kind='INDIVIDUAL' then
      if own_applicant and bx1_portal.account_usable(c,account_row.id) then
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
          'effective',bx1_portal.investing_mandate_effective(mandate_row.id));
      end if;
      select bx1_portal.entity_account_projection(c,account_row.id) into mandate_projection;
      if own_applicant and coalesce((mandate_projection->>'can_view')::boolean,false) then
        stage:='ACCOUNT_AVAILABLE'; actions:='["VIEW_INVESTMENT_ACCOUNT"]'::jsonb; destination:='INVESTMENT_ACCOUNT';
      elsif own_applicant and coalesce((mandate_projection->>'can_request_mandate')::boolean,false) then
        stage:='REQUEST_MANDATE'; actions:='["REQUEST_INVESTING_REPRESENTATIVE_MANDATE"]'::jsonb;
        destination:='INVESTMENT_ACCOUNT';
      else
        if mandate_row.id is not null then
          mandate_projection:=bx1_portal.investing_mandate_projection(c,mandate_row.id);
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
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'customer_handoff_context_changed' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('version',1,'environment',cfg.environment,'actor_id',actor,
    'application_id',a.id,'application_revision',a.revision,'persona',a.persona,'operating_context',c,
    'state',stage,'next_owner',next_actor,'blocker',blocker,'allowed_actions',actions,
    'gates',pg_catalog.jsonb_build_object('intake_admitted',intake,'reviewer_available',route='AVAILABLE',
      'monitoring_allows_new_actions',monitoring_allowed),'accounts',accounts,'mandate',mandate_json,
    'native_context',native_context,'destination',destination);
end $$;
revoke all on function bx1_portal.customer_application_handoff(jsonb,uuid) from public,anon,authenticated,service_role;

-- Preserve the exact existing reader chain and public OIDs. The old reader
-- becomes owner-only, never a competing externally callable boundary.
do $handoff_readers$
declare entry_allowed boolean; scoped_allowed boolean;
begin
  entry_allowed:=pg_catalog.has_function_privilege('authenticated','bx1_portal.entry_read()','EXECUTE');
  scoped_allowed:=pg_catalog.has_function_privilege('authenticated','bx1_portal.read_scoped(jsonb)','EXECUTE');
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='MAINNET') and scoped_allowed then
    raise exception 'customer_handoff_main_scope_not_sealed' using errcode='55000'; end if;
  alter function bx1_portal.entry_read() rename to entry_read_pre_handoff;
  alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_handoff;
  execute $entry_definition$
    create function bx1_portal.entry_read() returns jsonb
    language plpgsql volatile security definer set search_path='' as $entry_body$
    declare result jsonb; applications jsonb; environment_name text; scoped_available boolean; expected_issuer text;
    begin
      result:=bx1_portal.entry_read_pre_handoff();
      select environment into environment_name from bx1_portal.entry_configuration where singleton;
      if environment_name is null then raise exception 'customer_handoff_environment_unavailable' using errcode='55000'; end if;
      expected_issuer:=case environment_name when 'TESTNET' then 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
        when 'MAINNET' then 'https://oqkevkjbkpugjotihtda.supabase.co/auth/v1' end;
      if expected_issuer is null or auth.jwt()->>'iss' is distinct from expected_issuer then
        raise exception 'customer_handoff_environment_denied' using errcode='42501'; end if;
      scoped_available:=environment_name='TESTNET'
        and pg_catalog.has_function_privilege('authenticated','public.bx1_portal_read_scoped(jsonb)','EXECUTE');
      select coalesce(pg_catalog.jsonb_agg(app.item||pg_catalog.jsonb_build_object('handoff',
        bx1_portal.customer_application_handoff('{"mode":"APPLICANT"}'::jsonb,(app.item->>'id')::uuid))
        order by app.ordinality),'[]'::jsonb) into applications
        from pg_catalog.jsonb_array_elements(result->'applications') with ordinality app(item,ordinality);
      if bx1_portal.fresh_session() is not true then raise exception 'customer_handoff_session_changed' using errcode='42501'; end if;
      return pg_catalog.jsonb_set(result,'{applications}',applications)||pg_catalog.jsonb_build_object('workflow',
        pg_catalog.jsonb_build_object('version',1,'environment',environment_name,'actor_id',auth.uid(),
          'scoped_read_available',scoped_available));
    end $entry_body$;
  $entry_definition$;
  execute $scoped_definition$
    create function bx1_portal.read_scoped(c jsonb) returns jsonb
    language plpgsql volatile security definer set search_path='' as $scoped_body$
    declare result jsonb; applications jsonb; environment_name text;
    begin
      result:=bx1_portal.read_scoped_pre_handoff(c);
      select environment into environment_name from bx1_portal.entry_configuration where singleton;
      if environment_name is distinct from 'TESTNET' then
        raise exception 'customer_handoff_scope_not_admitted' using errcode='42501'; end if;
      if auth.jwt()->>'iss' is distinct from 'https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1' then
        raise exception 'customer_handoff_environment_denied' using errcode='42501'; end if;
      select coalesce(pg_catalog.jsonb_agg(app.item||pg_catalog.jsonb_build_object('handoff',
        bx1_portal.customer_application_handoff(c,(app.item->>'id')::uuid))
        order by app.ordinality),'[]'::jsonb) into applications
        from pg_catalog.jsonb_array_elements(result->'applications') with ordinality app(item,ordinality);
      if bx1_portal.valid_operating_context(c) is not true then
        raise exception 'customer_handoff_context_changed' using errcode='42501'; end if;
      return pg_catalog.jsonb_set(result,'{applications}',applications)||pg_catalog.jsonb_build_object('workflow',
        pg_catalog.jsonb_build_object('version',1,'environment',environment_name,'actor_id',auth.uid(),
          'scoped_read_available',true));
    end $scoped_body$;
  $scoped_definition$;
  revoke all on function bx1_portal.entry_read_pre_handoff(),bx1_portal.read_scoped_pre_handoff(jsonb),
    bx1_portal.entry_read(),bx1_portal.read_scoped(jsonb) from public,anon,authenticated,service_role;
  if entry_allowed then grant execute on function bx1_portal.entry_read() to authenticated; end if;
  if scoped_allowed then grant execute on function bx1_portal.read_scoped(jsonb) to authenticated; end if;
end $handoff_readers$;
create or replace function public.bx1_entry_read() returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.entry_read(); $$;
create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
