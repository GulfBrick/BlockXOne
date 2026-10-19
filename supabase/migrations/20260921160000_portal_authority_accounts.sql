-- P2A additive authority/account bridge. No identities, bindings, grants or money seeded.
-- Deployment cutover: old command execution is revoked atomically below. Deploy
-- the scoped web candidate immediately afterward; old reads/login remain available.
create table bx1_portal.organisation_authority_bindings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  native_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  role text not null check(role in ('OfferingManager','IssuerFundManager','ComplianceOfficer')),
  status text not null check(status in ('ACTIVE','REVOKED')),
  valid_from timestamptz not null check(isfinite(valid_from)),
  valid_until timestamptz not null check(isfinite(valid_until) and valid_until>valid_from),
  evidence_reference text not null check(char_length(btrim(evidence_reference)) between 10 and 400),
  approval_receipt_id uuid not null check(approval_receipt_id<>'00000000-0000-0000-0000-000000000000'),
  created_at timestamptz not null default clock_timestamp(),
  unique(product_organisation_id,native_organisation_id,role,approval_receipt_id)
);
create index bx1_portal_binding_scope on bx1_portal.organisation_authority_bindings(native_organisation_id,role,product_organisation_id);
create table bx1_portal.investment_accounts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  holder_user_id uuid not null references auth.users(id) on delete restrict,
  application_id uuid not null unique references bx1_portal.applications(id) on delete restrict,
  kind text not null default 'INDIVIDUAL' check(kind='INDIVIDUAL'),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','SUSPENDED')),
  created_at timestamptz not null default clock_timestamp(),
  unique(id,holder_user_id)
);
alter table bx1_portal.subscriptions add column investment_account_id uuid;
alter table bx1_portal.subscriptions add constraint bx1_subscription_account_holder
  foreign key(investment_account_id,investor_id) references bx1_portal.investment_accounts(id,holder_user_id) on delete restrict;
create table bx1_portal.scoped_requests (
  actor_id uuid not null references auth.users(id), request_key uuid not null,
  operating_context jsonb not null, command text not null, payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(), primary key(actor_id,request_key)
);
alter table bx1_portal.organisation_authority_bindings enable row level security;
alter table bx1_portal.investment_accounts enable row level security;
alter table bx1_portal.scoped_requests enable row level security;
revoke all on bx1_portal.organisation_authority_bindings,bx1_portal.investment_accounts,bx1_portal.scoped_requests from public,anon,authenticated,service_role;

create function bx1_portal.guard_authority_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'portal_provenance_is_permanent' using errcode='23514'; end if;
  if TG_TABLE_NAME='organisation_authority_bindings' then
    if TG_OP='INSERT' then
      -- An in-flight legacy-owner operation and first binding cannot cross.
      perform id from bx1_portal.organisations where id=NEW.product_organisation_id for update;
    elsif (to_jsonb(NEW)-'status') is distinct from (to_jsonb(OLD)-'status') or OLD.status='REVOKED' then
      raise exception 'portal_binding_is_immutable' using errcode='23514';
    end if;
  elsif TG_OP='UPDATE' and (to_jsonb(NEW)-'status') is distinct from (to_jsonb(OLD)-'status') then
    raise exception 'portal_account_identity_is_immutable' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger bx1_portal_binding_guard before insert or update or delete on bx1_portal.organisation_authority_bindings for each row execute function bx1_portal.guard_authority_account();
create trigger bx1_portal_account_guard before update or delete on bx1_portal.investment_accounts for each row execute function bx1_portal.guard_authority_account();
create trigger bx1_portal_scoped_request_guard before update or delete on bx1_portal.scoped_requests for each row execute function bx1_portal.immutable_record();
create function bx1_portal.guard_subscription_account() returns trigger
language plpgsql set search_path='' as $$
begin
  if OLD.investment_account_id is not null and NEW.investment_account_id is distinct from OLD.investment_account_id then
    raise exception 'portal_subscription_account_is_immutable' using errcode='23514';
  end if;
  return NEW;
end $$;
create trigger bx1_portal_subscription_account_guard before update of investment_account_id on bx1_portal.subscriptions
  for each row execute function bx1_portal.guard_subscription_account();

create function bx1_portal.fresh_session() returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  return bx1_portal.has_session() and exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.oauth_client_id is null
      and (s.not_after is null or s.not_after>clock_timestamp()) and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp()));
end $$;
create function bx1_portal.valid_operating_context(c jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare v_org uuid;
begin
  if bx1_portal.fresh_session() is not true or jsonb_typeof(c) is distinct from 'object' then return false; end if;
  if c=jsonb_build_object('mode','APPLICANT') then return true; end if;
  if c->>'mode' is distinct from 'ROLE' or not(c ?& array['mode','organisationId','role'])
    or c-array['mode','organisationId','role']<>'{}' or jsonb_typeof(c->'organisationId') is distinct from 'string'
    or c->>'organisationId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(c->'role') is distinct from 'string' then return false; end if;
  v_org:=(c->>'organisationId')::uuid;
  return exists(select 1 from public.bx1_memberships m join public.bx1_profiles p on p.id=m.user_id
    join public.bx1_organisations o on o.id=m.organisation_id where m.user_id=auth.uid()
      and m.organisation_id=v_org and m.role=c->>'role' and m.status='ACTIVE' and p.status='ACTIVE' and o.status='ACTIVE');
exception when others then return false;
end $$;
create function bx1_portal.current_product_organisation(target_org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  return exists(select 1 from bx1_portal.organisations o join bx1_portal.applications a on a.id=o.application_id
    where o.id=target_org and o.status='ACTIVE' and a.status='APPROVED' and a.persona='WEALTH_MANAGER'
      and a.approved_until>clock_timestamp());
end $$;
create function bx1_portal.scoped_operator(c jsonb,target_org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.valid_operating_context(c) is not true or not bx1_portal.current_product_organisation(target_org) then return false; end if;
  if c->>'mode'='APPLICANT' then
    return exists(select 1 from bx1_portal.organisations where id=target_org and owner_id=auth.uid())
      and not exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=target_org);
  end if;
  return c->>'role' in ('OfferingManager','IssuerFundManager') and exists(select 1 from bx1_portal.organisation_authority_bindings b
    where b.product_organisation_id=target_org and b.native_organisation_id=(c->>'organisationId')::uuid
      and b.role=c->>'role' and b.status='ACTIVE' and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
end $$;
create function bx1_portal.scoped_reviewer(c jsonb,target_scope uuid,target_org uuid default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.valid_operating_context(c) is not true or c->>'mode'<>'ROLE' or c->>'role'<>'ComplianceOfficer'
    or c->>'organisationId' is distinct from target_scope::text then return false; end if;
  -- Unbound historical applications retain their explicitly assigned review scope.
  if target_org is null or not exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=target_org) then return true; end if;
  return exists(select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=target_org
    and b.native_organisation_id=target_scope and b.role='ComplianceOfficer' and b.status='ACTIVE'
    and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
end $$;
create function bx1_portal.account_usable(c jsonb,target_account uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  return bx1_portal.valid_operating_context(c) and (c->>'mode'='APPLICANT' or c->>'role'='Investor')
    and exists(select 1 from bx1_portal.investment_accounts i join bx1_portal.applications a on a.id=i.application_id
      where i.id=target_account and i.holder_user_id=auth.uid() and i.status='ACTIVE' and a.user_id=auth.uid()
        and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>clock_timestamp()
        and a.details->>'investor_type'='INDIVIDUAL');
end $$;

-- Existing core commands are reused behind the scoped wrapper, not exposed as a
-- second writer. A binding of any status permanently ends the legacy owner path.
create or replace function bx1_portal.is_operator(target_org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.scoped_operator('{"mode":"APPLICANT"}'::jsonb,target_org) or exists(
    select 1 from bx1_portal.organisation_authority_bindings b where b.product_organisation_id=target_org
      and bx1_portal.scoped_operator(jsonb_build_object('mode','ROLE','organisationId',b.native_organisation_id,'role',b.role),target_org));
$$;
create or replace function bx1_portal.is_reviewer(target_scope uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.scoped_reviewer(jsonb_build_object('mode','ROLE','organisationId',target_scope,'role','ComplianceOfficer'),target_scope);
$$;
create function bx1_portal.scoped_product_visible(c jsonb,target_product uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; o bx1_portal.organisations;
begin
  if bx1_portal.valid_operating_context(c) is not true then return false; end if;
  select * into p from bx1_portal.products where id=target_product;
  if not found then return false; end if;
  select * into o from bx1_portal.organisations where id=p.organisation_id;
  return bx1_portal.scoped_operator(c,o.id) or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
    or ((c->>'mode'='APPLICANT' or c->>'role'='Investor') and p.status='PUBLISHED'
      and bx1_portal.current_product_organisation(o.id) and bx1_portal.is_eligible(p.terms));
end $$;

create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); result jsonb;
begin
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'portal_context_denied' using errcode='42501'; end if;
  select jsonb_build_object(
    'operating_context',c,
    'actor',jsonb_build_object('id',v_actor,'email',u.email,'display_name',(select display_name from public.bx1_profiles where id=v_actor),
      'can_review',c->>'mode'='ROLE' and c->>'role'='ComplianceOfficer'),
    'applications',coalesce((select jsonb_agg(to_jsonb(a)-'reviewer_scope' order by a.submitted_at,a.id)
      from bx1_portal.applications a where a.user_id=v_actor or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)),'[]'::jsonb),
    'organisations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status,
      'native_organisation_id',case when c->>'mode'='ROLE' then c->>'organisationId' end,
      'roles',case when c->>'mode'='ROLE' then jsonb_build_array(c->>'role') else '["IssuerFundManager","OfferingManager"]'::jsonb end,
      'authority_source',case when c->>'mode'='ROLE' then 'NATIVE_BINDING' else 'LEGACY_OWNER' end,
      'capabilities',case when bx1_portal.scoped_operator(c,o.id) then '["create_product","save_product","submit_product","publish_product","read_orders"]'::jsonb else '["review_product"]'::jsonb end)
      order by o.id) from bx1_portal.organisations o where bx1_portal.scoped_operator(c,o.id)
        or (exists(select 1 from bx1_portal.organisation_authority_bindings where product_organisation_id=o.id) and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id))),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at,i.id) from bx1_portal.investment_accounts i
      where i.holder_user_id=v_actor and (c->>'mode'='APPLICANT' or c->>'role'='Investor')),'[]'::jsonb),
    'products',coalesce((select jsonb_agg((to_jsonb(p)-array['cap_units','minimum_units','unit_price_minor'])||jsonb_build_object('reserved_units',p.reserved_units::text)
      order by p.created_at,p.id) from bx1_portal.products p where bx1_portal.scoped_product_visible(c,p.id)),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'product_id',s.product_id,'investor_id',s.investor_id,
      'investment_account_id',s.investment_account_id,'product_name',s.accepted_terms->>'name','organisation_id',s.organisation_id,
      'product_revision',s.product_revision,'terms_hash',s.terms_hash,'currency',s.accepted_terms->>'currency','units',s.units::text,
      'amount_minor',s.amount_minor::text,'status',s.status,'created_at',s.created_at) order by s.created_at,s.id)
      from bx1_portal.subscriptions s where bx1_portal.scoped_operator(c,s.organisation_id)
      or (s.investor_id=v_actor and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'subject_id',e.subject_id,'kind',e.kind,'actor_id',e.actor_id,'created_at',e.created_at,'summary',e.summary)
      order by e.created_at,e.id) from bx1_portal.events e where bx1_portal.scoped_operator(c,e.organisation_id)
        or (e.investor_id=v_actor and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
        or exists(select 1 from bx1_portal.applications a where a.id=e.application_id and (a.user_id=v_actor or bx1_portal.scoped_reviewer(c,a.reviewer_scope,a.organisation_id)))
        or exists(select 1 from bx1_portal.organisations o where o.id=e.organisation_id and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id))),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('key',r.request_key,'command',r.command) order by r.created_at desc,r.request_key)
      from (select * from bx1_portal.scoped_requests where actor_id=v_actor and operating_context=c
        and created_at>=clock_timestamp()-interval '7 days' order by created_at desc,request_key limit 1000) r),'[]'::jsonb)
  ) into result from auth.users u where u.id=v_actor;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;
  return result;
end $$;

create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); old_request bx1_portal.scoped_requests; app bx1_portal.applications;
  p bx1_portal.products; o bx1_portal.organisations; s bx1_portal.subscriptions; account_row bx1_portal.investment_accounts;
  v_org uuid; account_id uuid; forwarded jsonb:=body; ignored jsonb; v_subject_id uuid;
  prior_order_ids uuid[]; new_order_ids uuid[];
begin
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'portal_context_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(body) is distinct from 'object'
    or octet_length(body::text)>65536 then raise exception 'portal_invalid_command' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||v_actor::text,0));
  -- Pin authority rows until commit; a concurrently completed revocation must be
  -- observed after a wait. Expiry uses wall time, not transaction-start now().
  perform id from auth.users where id=v_actor for share;
  perform id from auth.sessions where user_id=v_actor and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=v_actor for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=v_actor and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;
  select * into old_request from bx1_portal.scoped_requests where actor_id=v_actor and request_key=key;
  if found then
    if old_request.operating_context is distinct from c or old_request.command is distinct from action or old_request.payload is distinct from body then
      raise exception 'portal_context_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=v_actor and request_key=key) then raise exception 'portal_legacy_key_conflict' using errcode='23505'; end if;
  -- Personal onboarding is always the actor's own principal, never organisation
  -- authority; native staff may submit it without changing their selected role.
  if action in ('create_investment_account','subscribe','cancel_subscription') then
    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'portal_investor_context_required' using errcode='42501'; end if;
  end if;
  if action='create_product' then v_org:=(body->>'organisation_id')::uuid;
  elsif action in ('save_product','submit_product','review_product','publish_product','subscribe') then
    select * into p from bx1_portal.products where id=(body->>'product_id')::uuid;
    if not found then raise exception 'portal_product_denied' using errcode='42501'; end if;
    v_org:=p.organisation_id;
  elsif action='cancel_subscription' then
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid and investor_id=v_actor;
    if not found then raise exception 'portal_subscription_denied' using errcode='42501'; end if;
    v_org:=s.organisation_id;
  end if;
  if v_org is not null then
    select * into o from bx1_portal.organisations where id=v_org for share;
    perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=v_org order by id for share;
    if action in ('create_product','save_product','submit_product','publish_product') and bx1_portal.scoped_operator(c,v_org) is not true then
      raise exception 'portal_operator_scope_denied' using errcode='42501'; end if;
    if action='review_product' and bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true then
      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;
  end if;
  if action='review_application' then
    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid for update;
    if not found or bx1_portal.scoped_reviewer(c,app.reviewer_scope,app.organisation_id) is not true then
      raise exception 'portal_reviewer_scope_denied' using errcode='42501'; end if;
  elsif action='create_investment_account' then
    perform bx1_portal.require_keys(body,array['application_id']);
    select * into app from bx1_portal.applications where id=(body->>'application_id')::uuid and user_id=v_actor for update;
    if not found or app.persona<>'INVESTOR' or app.status<>'APPROVED' or app.approved_until<=clock_timestamp()
      or app.details->>'investor_type' is distinct from 'INDIVIDUAL' then raise exception 'portal_individual_approval_required' using errcode='42501'; end if;
    insert into bx1_portal.investment_accounts(holder_user_id,application_id) values(v_actor,app.id) returning * into account_row;
    v_subject_id:=account_row.id;
    insert into bx1_portal.requests(actor_id,request_key,command,payload) values(v_actor,key,action,body);
    insert into bx1_portal.events(subject_id,application_id,investor_id,kind,actor_id,summary)
      values(v_subject_id,app.id,v_actor,action,v_actor,'Individual investment account opened from current reviewed application. No holding or funding created.');
  elsif action='subscribe' then
    account_id:=(body->>'investment_account_id')::uuid;
    select * into account_row from bx1_portal.investment_accounts where id=account_id for share;
    if bx1_portal.account_usable(c,account_id) is not true then raise exception 'portal_account_denied' using errcode='42501'; end if;
    perform id from bx1_portal.applications where id=account_row.application_id for share;
    -- Claim the capacity row before the last account/authority/expiry check.
    perform id from bx1_portal.products where id=p.id for update;
    if bx1_portal.account_usable(c,account_id) is not true or not bx1_portal.current_product_organisation(v_org) then
      raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;
    forwarded:=body-'investment_account_id';
    select coalesce(array_agg(existing.id),'{}'::uuid[]) into prior_order_ids from bx1_portal.subscriptions existing
      where existing.investor_id=v_actor and existing.product_id=p.id;
  elsif action='cancel_subscription' and s.investment_account_id is not null then
    -- Cancellation does not require renewed KYC, but cannot act for another account.
    if not exists(select 1 from bx1_portal.investment_accounts where id=s.investment_account_id and holder_user_id=v_actor) then
      raise exception 'portal_account_denied' using errcode='42501'; end if;
  end if;
  if action<>'create_investment_account' then
    ignored:=bx1_portal.execute_command(action,key,forwarded);
    if action='subscribe' then
      -- The actor lock serializes all writes and the product lock holds capacity.
      -- Bind the exact newly inserted row, never a timestamp/latest-row guess.
      select array_agg(new_order.id) into new_order_ids from bx1_portal.subscriptions new_order
        where new_order.investor_id=v_actor and new_order.product_id=p.id and not(new_order.id=any(prior_order_ids));
      if coalesce(cardinality(new_order_ids),0)<>1 then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;
      update bx1_portal.subscriptions set investment_account_id=account_id where id=new_order_ids[1] and investor_id=v_actor and investment_account_id is null;
      if not found then raise exception 'portal_account_binding_failed' using errcode='23514'; end if;
    end if;
  end if;
  if bx1_portal.valid_operating_context(c) is not true then raise exception 'portal_context_changed' using errcode='42501'; end if;
  if v_org is not null and action in ('create_product','save_product','submit_product','publish_product') and not bx1_portal.scoped_operator(c,v_org) then
    raise exception 'portal_authority_expired' using errcode='42501'; end if;
  if (action='review_product' and not bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id))
    or (action='review_application' and not bx1_portal.scoped_reviewer(c,app.reviewer_scope,app.organisation_id)) then
    raise exception 'portal_reviewer_scope_expired' using errcode='42501'; end if;
  if action='subscribe' and (not bx1_portal.account_usable(c,account_id) or not bx1_portal.current_product_organisation(v_org)) then
    raise exception 'portal_account_or_product_expired' using errcode='42501'; end if;
  if action='create_investment_account' and not bx1_portal.account_usable(c,account_row.id) then
    raise exception 'portal_account_approval_expired' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(v_actor,key,c,action,body);
  return bx1_portal.read_scoped(c);
end $$;

-- The historical bootstrap never carries other customers' review or issuer
-- records. Explicit ROLE reads are the sole operational data entry point.
create or replace function bx1_portal.read_state() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  result:=bx1_portal.read_scoped('{"mode":"APPLICANT"}'::jsonb);
  return jsonb_set(result,'{actor,can_review}',to_jsonb(exists(select 1 from public.bx1_memberships m
    where m.user_id=auth.uid() and m.role='ComplianceOfficer' and m.status='ACTIVE'
      and bx1_portal.valid_operating_context(jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role',m.role)))));
end $$;
-- Storage has no role-selector argument. It may only expose evidence the actor
-- is authorised to review in at least one current, exact scope; never merely
-- because the actor has a ComplianceOfficer membership somewhere.
create or replace function bx1_portal.object_readable(object_name text) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fresh_session() and (split_part(object_name,'/',1)=auth.uid()::text
    or exists(select 1 from bx1_portal.applications a
      where a.status<>'DRAFT' and bx1_portal.scoped_reviewer(
        jsonb_build_object('mode','ROLE','organisationId',a.reviewer_scope,'role','ComplianceOfficer'),a.reviewer_scope,a.organisation_id)
        and exists(select 1 from jsonb_array_elements(a.details->'documents') d where d->>'storage_path'=object_name)));
$$;

create function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;
revoke all on function bx1_portal.guard_authority_account(),bx1_portal.guard_subscription_account(),bx1_portal.fresh_session(),bx1_portal.valid_operating_context(jsonb),
  bx1_portal.current_product_organisation(uuid),bx1_portal.scoped_operator(jsonb,uuid),bx1_portal.scoped_reviewer(jsonb,uuid,uuid),
  bx1_portal.account_usable(jsonb,uuid),bx1_portal.scoped_product_visible(jsonb,uuid),bx1_portal.read_scoped(jsonb),
  bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated;
revoke execute on function public.bx1_portal_command(text,uuid,jsonb),bx1_portal.execute_command(text,uuid,jsonb) from public,anon,authenticated,service_role;
comment on table bx1_portal.organisation_authority_bindings is 'Evidence-backed operating scope; inserts require separately authorised bootstrap, never inferred names or memberships. Revoked history is permanent.';
