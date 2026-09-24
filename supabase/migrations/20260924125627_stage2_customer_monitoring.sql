-- Stage 2 ongoing-monitoring decision boundary. Existing approvals and ids are
-- preserved. An absent case means no additional monitoring restriction; it
-- does NOT extend the application's independent admission expiry.
do $$ begin
  if current_user<>'postgres'
    or pg_catalog.to_regclass('bx1_portal.applications') is null
    or pg_catalog.to_regclass('bx1_portal.scoped_requests') is null
    or pg_catalog.to_regclass('bx1_portal.product_eligibility_cases') is null
    or pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.scoped_reviewer(jsonb,uuid,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.representative_mandate_actor(jsonb,uuid,text)') is null then
    raise exception 'customer_monitoring_baseline_required' using errcode='55000';
  end if;
end $$;

create table bx1_portal.customer_monitoring_cases (
  application_id uuid primary key references bx1_portal.applications(id) on delete restrict,
  state text not null check(state in ('CURRENT','RENEWAL_REQUIRED','ON_HOLD')),
  revision integer not null check(revision>0),
  decided_at timestamptz not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  last_receipt_id uuid not null unique
);
create table bx1_portal.customer_monitoring_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  application_id uuid not null references bx1_portal.customer_monitoring_cases(application_id) on delete restrict,
  case_revision integer not null check(case_revision>0),
  application_revision integer not null check(application_revision>0),
  state_before text check(state_before in ('CURRENT','RENEWAL_REQUIRED','ON_HOLD')),
  state_after text not null check(state_after in ('CURRENT','RENEWAL_REQUIRED','ON_HOLD')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  evidence_reference text not null check(pg_catalog.length(evidence_reference) between 20 and 400
    and evidence_reference=pg_catalog.btrim(evidence_reference)),
  reason text not null check(pg_catalog.length(reason) between 20 and 2000
    and reason=pg_catalog.btrim(reason)),
  checks jsonb not null check(pg_catalog.jsonb_typeof(checks)='object'),
  admission_expires_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(application_id,case_revision),
  check((case_revision=1 and state_before is null)
    or (case_revision>1 and state_before is not null))
);
alter table bx1_portal.customer_monitoring_cases enable row level security;
alter table bx1_portal.customer_monitoring_receipts enable row level security;
revoke all on bx1_portal.customer_monitoring_cases,bx1_portal.customer_monitoring_receipts
  from public,anon,authenticated,service_role;
create trigger bx1_customer_monitoring_receipt_immutable before update or delete
  on bx1_portal.customer_monitoring_receipts for each row
  execute function bx1_portal.immutable_record();

create function bx1_portal.guard_customer_monitoring_case() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'monitoring_history_immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if new.application_id is distinct from old.application_id
      or new.revision<>old.revision+1
      or new.state is not distinct from old.state
      or new.decided_at<=old.decided_at then
      raise exception 'monitoring_invalid_transition' using errcode='23514'; end if;
  elsif new.revision<>1 then
    raise exception 'monitoring_invalid_initial_revision' using errcode='23514';
  end if;
  return new;
end $$;
create trigger bx1_customer_monitoring_case_guard before insert or update or delete
  on bx1_portal.customer_monitoring_cases for each row
  execute function bx1_portal.guard_customer_monitoring_case();

-- Evidence is only a cited input. It never changes eligibility or authority.
-- A reviewed HOLD/RENEWAL_REQUIRED is an extra restriction, not an alternate
-- approval. An expired underlying admission remains expired after CURRENT.
create function bx1_portal.monitoring_new_action_allowed(target_application uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.applications a
    where a.id=target_application and a.status='APPROVED'
      and a.approved_until>pg_catalog.clock_timestamp()
      and not exists(select 1 from bx1_portal.customer_monitoring_cases m
        where m.application_id=a.id and m.state<>'CURRENT'));
$$;
create function bx1_portal.require_monitoring_new_action(target_application uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  -- The decision writer obtains FOR UPDATE on this same application first.
  -- A concurrent new action waits and rechecks after a completed hold.
  perform id from bx1_portal.applications where id=target_application for share;
  if bx1_portal.monitoring_new_action_allowed(target_application) is not true then
    raise exception 'customer_monitoring_new_action_blocked' using errcode='42501'; end if;
end $$;

create function bx1_portal.guard_customer_monitoring_new_action() returns trigger
language plpgsql set search_path='' as $$
declare target_application uuid; investor_application uuid;
begin
  if tg_table_name='investment_accounts' then
    target_application:=new.application_id;
  elsif tg_table_name in ('representative_mandates','investing_representative_mandates') then
    if tg_op='UPDATE' and (new.status is distinct from 'APPLIED' or old.status='APPLIED') then return new; end if;
    target_application:=new.application_id;
  elsif tg_table_name='products' then
    -- A hold does not obstruct corrective drafting or a changes-required
    -- decision. It prevents new products and advancement towards opening.
    if tg_op='UPDATE' and new.status not in ('IN_REVIEW','APPROVED','PUBLISHED') then return new; end if;
    if tg_op='UPDATE' and new.status is not distinct from old.status
      and new.terms is not distinct from old.terms then return new; end if;
    select application_id into target_application from bx1_portal.organisations where id=new.organisation_id;
  elsif tg_table_name='funding_routes' then
    if tg_op='UPDATE' and (new.status is distinct from 'APPROVED' or old.status='APPROVED') then return new; end if;
    select application_id into target_application from bx1_portal.organisations where id=new.organisation_id;
  elsif tg_table_name in ('subscriptions','product_eligibility_cases','funding_obligations') then
    select application_id into target_application from bx1_portal.organisations where id=new.organisation_id;
    if tg_table_name='product_eligibility_cases' and tg_op='UPDATE'
      and (new.status is distinct from 'APPROVED' or old.status='APPROVED') then return new; end if;
    if tg_table_name='subscriptions' and new.investment_account_id is null then
      -- The legacy scoped writer binds the validated account immediately
      -- after insert in the same transaction. This branch cannot pick one of
      -- several capacities; the final writer's exact account check still does.
      perform id from bx1_portal.applications where user_id=new.investor_id
        and persona='INVESTOR' order by id for share;
      if not exists(select 1 from bx1_portal.applications a where a.user_id=new.investor_id
        and a.persona='INVESTOR' and bx1_portal.monitoring_new_action_allowed(a.id)) then
        raise exception 'customer_monitoring_new_action_blocked' using errcode='42501'; end if;
    else
      select application_id into investor_application from bx1_portal.investment_accounts
        where id=new.investment_account_id;
      perform bx1_portal.require_monitoring_new_action(investor_application);
    end if;
  end if;
  perform bx1_portal.require_monitoring_new_action(target_application);
  return new;
end $$;
create trigger bx1_monitoring_account_open before insert on bx1_portal.investment_accounts
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
create trigger bx1_monitoring_manager_mandate before insert or update of status on bx1_portal.representative_mandates
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
create trigger bx1_monitoring_entity_mandate before insert or update of status on bx1_portal.investing_representative_mandates
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
create trigger bx1_monitoring_product before insert or update of status,terms on bx1_portal.products
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
create trigger bx1_monitoring_subscription before insert or update of investment_account_id on bx1_portal.subscriptions
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
create trigger bx1_monitoring_eligibility before insert or update of status on bx1_portal.product_eligibility_cases
  for each row execute function bx1_portal.guard_customer_monitoring_new_action();
-- Funding is a separately installed TEST feature. The installer below is
-- called here when funding already exists and again by the funding feature
-- after it creates tables. Neither installation order can silently omit it.
create function bx1_portal.guard_customer_monitoring_funding_transition() returns trigger
language plpgsql set search_path='' as $$
declare investor_application uuid; issuer_application uuid;
begin
  if tg_table_name='funding_acceptances' then
    if new.kind<>'ACCEPTANCE' then return new; end if;
    if tg_op='UPDATE' and
      (old.approved_by is not null or new.approved_by is null) then return new; end if;
    select i.application_id,o.organisation_id into investor_application,issuer_application
      from bx1_portal.funding_references r
      join bx1_portal.funding_obligations o on o.id=r.obligation_id
      join bx1_portal.investment_accounts i on i.id=o.investment_account_id
      where r.id=new.reference_id;
  elsif tg_table_name='funding_journals' then
    if new.kind<>'FUNDING' then return new; end if;
    select i.application_id,o.organisation_id into investor_application,issuer_application
      from bx1_portal.funding_obligations o
      join bx1_portal.investment_accounts i on i.id=o.investment_account_id
      where o.id=new.obligation_id;
  else
    raise exception 'monitoring_unknown_funding_transition' using errcode='55000';
  end if;
  select application_id into issuer_application from bx1_portal.organisations
    where id=issuer_application;
  perform bx1_portal.require_monitoring_new_action(investor_application);
  perform bx1_portal.require_monitoring_new_action(issuer_application);
  return new;
end $$;

create function bx1_portal.assert_customer_monitoring_funding_hooks() returns void
language plpgsql set search_path='' as $$
declare installed integer; expected record;
begin
  select count(*) into installed from (values
    (pg_catalog.to_regclass('bx1_portal.funding_routes')),
    (pg_catalog.to_regclass('bx1_portal.funding_obligations')),
    (pg_catalog.to_regclass('bx1_portal.funding_acceptances')),
    (pg_catalog.to_regclass('bx1_portal.funding_journals'))) t(relation) where relation is not null;
  if installed=0 then return; end if;
  if installed<>4 then raise exception 'monitoring_partial_funding_install' using errcode='55000'; end if;
  for expected in select * from (values
    ('bx1_portal.funding_routes','bx1_monitoring_funding_route','bx1_portal.guard_customer_monitoring_new_action()'),
    ('bx1_portal.funding_obligations','bx1_monitoring_funding_obligation','bx1_portal.guard_customer_monitoring_new_action()'),
    ('bx1_portal.funding_acceptances','bx1_monitoring_funding_acceptance','bx1_portal.guard_customer_monitoring_funding_transition()'),
    ('bx1_portal.funding_journals','bx1_monitoring_funding_journal','bx1_portal.guard_customer_monitoring_funding_transition()'))
    x(relation,trigger_name,handler) loop
    if not exists(select 1 from pg_catalog.pg_trigger t
      where t.tgrelid=expected.relation::regclass and t.tgname=expected.trigger_name
        and t.tgfoid=expected.handler::regprocedure and t.tgenabled in ('O','A')
        and not t.tgisinternal) then
      raise exception 'monitoring_funding_hook_missing:%',expected.trigger_name using errcode='55000';
    end if;
  end loop;
  if pg_catalog.to_regprocedure('bx1_portal.funding_account_current(uuid)') is null then
    raise exception 'monitoring_funding_account_gate_missing' using errcode='55000';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'bx1_portal.funding_account_current(uuid)'::regprocedure),
      'bx1_portal.monitoring_new_action_allowed')=0 then
    raise exception 'monitoring_funding_account_gate_missing' using errcode='55000';
  end if;
end $$;

create function bx1_portal.install_customer_monitoring_funding_hooks() returns void
language plpgsql set search_path='' as $install$
declare installed integer;
begin
  if current_user<>'postgres' then
    raise exception 'monitoring_funding_installer_owner_required' using errcode='42501'; end if;
  select count(*) into installed from (values
    (pg_catalog.to_regclass('bx1_portal.funding_routes')),
    (pg_catalog.to_regclass('bx1_portal.funding_obligations')),
    (pg_catalog.to_regclass('bx1_portal.funding_acceptances')),
    (pg_catalog.to_regclass('bx1_portal.funding_journals'))) t(relation) where relation is not null;
  if installed=0 then return; end if;
  if installed<>4 then raise exception 'monitoring_partial_funding_install' using errcode='55000'; end if;
  execute 'create or replace trigger bx1_monitoring_funding_route before insert or update of status
    on bx1_portal.funding_routes for each row execute function bx1_portal.guard_customer_monitoring_new_action()';
  execute 'create or replace trigger bx1_monitoring_funding_obligation before insert
    on bx1_portal.funding_obligations for each row execute function bx1_portal.guard_customer_monitoring_new_action()';
  execute 'create or replace trigger bx1_monitoring_funding_acceptance before insert or update of approved_by
    on bx1_portal.funding_acceptances for each row execute function bx1_portal.guard_customer_monitoring_funding_transition()';
  execute 'create or replace trigger bx1_monitoring_funding_journal before insert
    on bx1_portal.funding_journals for each row execute function bx1_portal.guard_customer_monitoring_funding_transition()';
  execute $gate$create or replace function bx1_portal.funding_account_current(oid uuid) returns boolean
    language sql volatile security definer set search_path='' as $$
      select exists(select 1 from bx1_portal.funding_obligations o
        join bx1_portal.investment_accounts i on i.id=o.investment_account_id
        join bx1_portal.applications a on a.id=i.application_id
        join auth.users u on u.id=i.holder_user_id
        where o.id=oid and i.holder_user_id=o.investor_id and i.status='ACTIVE'
          and a.user_id=o.investor_id and a.persona='INVESTOR'
          and bx1_portal.monitoring_new_action_allowed(a.id)
          and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
          and not exists(select 1 from public.bx1_profiles p
            where p.id=o.investor_id and p.status<>'ACTIVE'));
    $$$gate$;
  perform bx1_portal.assert_customer_monitoring_funding_hooks();
end $install$;

revoke all on function bx1_portal.guard_customer_monitoring_funding_transition(),
  bx1_portal.install_customer_monitoring_funding_hooks(),
  bx1_portal.assert_customer_monitoring_funding_hooks()
  from public,anon,authenticated,service_role;
select bx1_portal.install_customer_monitoring_funding_hooks();

-- Existing authority and account identities remain; their ability to start
-- new operations additionally respects the reviewed monitoring decision.
create or replace function bx1_portal.current_product_organisation(target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.organisations o
    join bx1_portal.applications a on a.id=o.application_id
    where o.id=target_org and o.status='ACTIVE' and a.persona='WEALTH_MANAGER'
      and bx1_portal.monitoring_new_action_allowed(a.id));
$$;
create or replace function bx1_portal.account_usable(c jsonb,target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.valid_operating_context(c) and (c->>'mode'='APPLICANT' or c->>'role'='Investor')
    and exists(select 1 from bx1_portal.investment_accounts i
      join bx1_portal.applications a on a.id=i.application_id
      where i.id=target_account and i.holder_user_id=auth.uid() and i.status='ACTIVE'
        and a.user_id=auth.uid() and a.persona='INVESTOR'
        and a.details->>'investor_type'='INDIVIDUAL'
        and bx1_portal.monitoring_new_action_allowed(a.id));
$$;

-- These already-reviewed authorities remain recorded, but do not project as
-- currently usable while their source admission is under a reviewed hold.
-- The original predicates retain all of their existing version/identity and
-- offering checks; monitoring is an additional negative gate only.
alter function bx1_portal.product_eligibility_current(uuid) rename to product_eligibility_current_pre_monitoring;
create function bx1_portal.product_eligibility_current(target_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.product_eligibility_current_pre_monitoring(target_case)
    and exists(select 1 from bx1_portal.product_eligibility_cases e
      join bx1_portal.investment_accounts i on i.id=e.investment_account_id
      where e.id=target_case and bx1_portal.monitoring_new_action_allowed(i.application_id));
$$;
alter function bx1_portal.entity_account_admission_current(uuid) rename to entity_account_admission_current_pre_monitoring;
create function bx1_portal.entity_account_admission_current(target_account uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.entity_account_admission_current_pre_monitoring(target_account)
    and exists(select 1 from bx1_portal.investment_accounts i
      where i.id=target_account and bx1_portal.monitoring_new_action_allowed(i.application_id));
$$;
create or replace function bx1_portal.representative_mandate_effective(target_mandate uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.representative_mandate_effective_at(target_mandate,pg_catalog.clock_timestamp())
    and exists(select 1 from bx1_portal.representative_mandates m
      where m.id=target_mandate and bx1_portal.monitoring_new_action_allowed(m.application_id));
$$;
create or replace function bx1_portal.native_membership_effective(target_membership uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.native_membership_effective_at(target_membership,pg_catalog.clock_timestamp())
    and not exists(select 1 from bx1_portal.representative_mandates m
      where m.native_membership_id=target_membership and m.status='APPLIED'
        and not bx1_portal.monitoring_new_action_allowed(m.application_id));
$$;

-- Wrap the existing single scoped command path, preserving all prior writer
-- branches. MAIN retains its existing sealed public EXECUTE permissions.
-- The wrapper is owned by the migration role and invokes this previously
-- restricted predicate at runtime. Grant only that role; never expose the
-- predicate to authenticated clients or service_role.
grant execute on function bx1_portal.scoped_reviewer(jsonb,uuid,uuid) to postgres;
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_monitoring;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_monitoring;
create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; monitoring jsonb;
begin
  result:=bx1_portal.read_scoped_pre_monitoring(c);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'application_id',a.id,'application_revision',a.revision,
    'state',coalesce(m.state,'CURRENT'),'case_revision',coalesce(m.revision,0),
    'admission_expires_at',a.approved_until,
    'renewal_due',a.approved_until<=pg_catalog.clock_timestamp()+interval '7 days',
    'new_actions_allowed',bx1_portal.monitoring_new_action_allowed(a.id))
    order by a.id),'[]'::jsonb) into monitoring
  from bx1_portal.applications a left join bx1_portal.customer_monitoring_cases m on m.application_id=a.id
  where (a.status='APPROVED' or m.application_id is not null)
    and (c->>'mode'='APPLICANT' and a.user_id=auth.uid()
      or c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'
        and bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id));
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'monitoring_context_changed' using errcode='42501'; end if;
  return result||pg_catalog.jsonb_build_object('customer_monitoring',monitoring);
end $$;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a bx1_portal.applications; m bx1_portal.customer_monitoring_cases;
  prior bx1_portal.scoped_requests; expected integer; state_after text; receipt_id uuid;
  ref text; reason_text text; checks jsonb;
begin
  if action<>'set_customer_monitoring' then
    return bx1_portal.execute_scoped_pre_monitoring(c,action,key,body); end if;
  if bx1_portal.valid_operating_context(c) is not true or key is null
    or key='00000000-0000-0000-0000-000000000000'
    or pg_catalog.jsonb_typeof(body) is distinct from 'object'
    or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'monitoring_command_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  perform bx1_portal.require_keys(body,array['application_id','expected_revision','state','evidence_reference','reason','checks']);
  if pg_catalog.jsonb_typeof(body->'application_id') is distinct from 'string'
    or body->>'application_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
    or body->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'
    or body->>'state' not in ('CURRENT','RENEWAL_REQUIRED','ON_HOLD') then
    raise exception 'monitoring_invalid_request' using errcode='22023'; end if;
  expected:=(body->>'expected_revision')::integer;
  state_after:=body->>'state'; ref:=body->>'evidence_reference'; reason_text:=body->>'reason'; checks:=body->'checks';
  if ref is null or pg_catalog.length(ref) not between 20 and 400 or ref<>pg_catalog.btrim(ref)
    or reason_text is null or pg_catalog.length(reason_text) not between 20 and 2000
    or reason_text<>pg_catalog.btrim(reason_text) or pg_catalog.jsonb_typeof(checks) is distinct from 'object'
    or (state_after='CURRENT' and checks is distinct from
      '{"identity":true,"ownership":true,"screening":true,"suitability":true}'::jsonb) then
    raise exception 'monitoring_evidence_or_checks_invalid' using errcode='22023'; end if;
  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if found then
    if prior.operating_context is distinct from c or prior.command is distinct from action
      or prior.payload is distinct from body then
      raise exception 'monitoring_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests r where r.actor_id=actor and r.request_key=key)
    or exists(select 1 from bx1_portal.representative_mandate_requests r
      where r.actor_id=actor and r.request_key=key) then
    raise exception 'monitoring_prior_key_conflict' using errcode='23505'; end if;
  select * into a from bx1_portal.applications where id=(body->>'application_id')::uuid for update;
  if a.id is null or a.status<>'APPROVED' or a.reviewer_scope is null
    or c->>'mode' is distinct from 'ROLE' or c->>'role' is distinct from 'ComplianceOfficer'
    or c->>'organisationId' is distinct from a.reviewer_scope::text
    or bx1_portal.representative_mandate_actor(c,a.reviewer_scope,'ComplianceOfficer') is not true
    or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id) is not true
    or bx1_portal.entity_people_independent(actor,a.user_id) is not true then
    raise exception 'monitoring_reviewer_denied' using errcode='42501'; end if;
  if state_after='CURRENT' and a.approved_until<=pg_catalog.clock_timestamp() then
    raise exception 'monitoring_expired_admission_requires_renewal' using errcode='23514'; end if;
  select * into m from bx1_portal.customer_monitoring_cases where application_id=a.id for update;
  if coalesce(m.revision,0)<>expected or (m.application_id is null and state_after='CURRENT')
    or (m.application_id is not null and m.state=state_after) then
    raise exception 'monitoring_stale_or_noop' using errcode='23514'; end if;
  receipt_id:=pg_catalog.gen_random_uuid();
  if m.application_id is null then
    insert into bx1_portal.customer_monitoring_cases
      (application_id,state,revision,decided_at,decided_by,last_receipt_id)
      values(a.id,state_after,1,pg_catalog.clock_timestamp(),actor,receipt_id);
  else
    update bx1_portal.customer_monitoring_cases set state=state_after,revision=revision+1,
      decided_at=pg_catalog.clock_timestamp(),decided_by=actor,last_receipt_id=receipt_id
      where application_id=a.id;
  end if;
  insert into bx1_portal.customer_monitoring_receipts
    (id,application_id,case_revision,application_revision,state_before,state_after,
      actor_id,operating_context,evidence_reference,reason,checks,admission_expires_at)
    values(receipt_id,a.id,expected+1,a.revision,m.state,state_after,
      actor,c,ref,reason_text,checks,a.approved_until);
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
    values(actor,key,c,action,body);
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'monitoring_reviewer_changed_after_wait' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;
create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;

revoke all on function bx1_portal.guard_customer_monitoring_case(),
  bx1_portal.monitoring_new_action_allowed(uuid),bx1_portal.require_monitoring_new_action(uuid),
  bx1_portal.guard_customer_monitoring_new_action(),
  bx1_portal.product_eligibility_current_pre_monitoring(uuid),
  bx1_portal.product_eligibility_current(uuid),
  bx1_portal.entity_account_admission_current_pre_monitoring(uuid),
  bx1_portal.entity_account_admission_current(uuid),
  bx1_portal.representative_mandate_effective(uuid),
  bx1_portal.native_membership_effective(uuid),
  bx1_portal.read_scoped_pre_monitoring(jsonb),bx1_portal.execute_scoped_pre_monitoring(jsonb,text,uuid,jsonb),
  bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
do $monitoring_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
      public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
      to authenticated;
  end if;
end $monitoring_grants$;
