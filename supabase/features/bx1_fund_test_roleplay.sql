-- TEST-only authority foundation. Definitions only; no operator, role, policy,
-- provider result, contract, signature, payment or holding is provisioned.
-- The caller owns the transaction. Existing business writers remain unchanged.
do $preflight$
begin
  if current_user<>'postgres'
    or not exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET')
    or pg_catalog.to_regclass('bx1_private.roleplay_operators') is not null
    or pg_catalog.to_regprocedure('bx1_private.has_session_mfa()') is null
    or pg_catalog.to_regprocedure('bx1_private.has_token_mfa()') is null
    or pg_catalog.to_regprocedure('bx1_private.lock_funding_person(uuid,uuid)') is null
    or (select relowner from pg_catalog.pg_class where oid='bx1_private.persons'::regclass)<>'bx1_authority_owner'::regrole
    or not exists(select 1 from pg_catalog.pg_constraint where conrelid='bx1_private.persons'::regclass
      and conname='persons_status_check' and contype='c' and convalidated
      and pg_catalog.pg_get_constraintdef(oid)='CHECK ((status = ANY (ARRAY[''TRUSTED''::text, ''REVOKED''::text])))') then
    raise exception 'fund_test_roleplay_test_baseline_required' using errcode='55000'; end if;
end $preflight$;

-- Temporarily use the existing identity owner for its one additive status
-- constraint and narrow person creator. Restore every grantor-specific edge
-- and schema ACL after installing the narrow identity trigger. No runtime
-- caller retains the temporary owner membership or schema privilege.
create temporary table bx1_roleplay_owner_edges on commit drop as
  select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
    where roleid='bx1_authority_owner'::regrole and member=current_user::regrole;
create temporary table bx1_roleplay_schema_acl on commit drop as
  select not pg_catalog.has_schema_privilege('bx1_authority_owner','bx1_private','CREATE') added_create,
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb)
      from pg_catalog.aclexplode(nspacl) a) original_acl from pg_catalog.pg_namespace where nspname='bx1_private';
grant bx1_authority_owner to current_user with inherit true,set true granted by current_user;
do $$ begin
  if (select added_create from pg_temp.bx1_roleplay_schema_acl) then
    grant create on schema bx1_private to bx1_authority_owner; end if;
end $$;
set local role bx1_authority_owner;
alter table bx1_private.persons drop constraint persons_status_check;
alter table bx1_private.persons add constraint persons_status_check check (
  status in ('TRUSTED','REVOKED') or (status='TEST_ROLE_PLAY' and evidence_reference ~ '^test_roleplay:[0-9a-f-]{36}$'));
-- No principal mapping is created. All existing TRUSTED-only helpers continue
-- rejecting this identity, and the original immutable-identity trigger remains.
create function bx1_private.test_roleplay_create_person(p_id uuid,p_label text,p_receipt uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if session_user<>'postgres' or pg_catalog.current_setting('role',true) not in ('none','postgres')
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'test_roleplay_person_owner_only' using errcode='42501'; end if;
  insert into bx1_private.persons(id,label,status,evidence_reference,bootstrap_receipt_id)
    values(p_id,'TEST role-play: '||p_label,'TEST_ROLE_PLAY','test_roleplay:'||p_receipt::text,p_receipt);
end $$;
revoke all on function bx1_private.test_roleplay_create_person(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function bx1_private.test_roleplay_create_person(uuid,text,uuid) to postgres;
reset role;

create table bx1_private.roleplay_owner_receipts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  owner_membership_id uuid not null references public.bx1_memberships(id) on delete restrict,
  request_key uuid not null check(request_key<>'00000000-0000-0000-0000-000000000000'),
  project_ref text not null default 'fegnnnlseuejkrusbbkv' check(project_ref='fegnnnlseuejkrusbbkv'),
  environment text not null default 'TESTNET' check(environment='TESTNET'),
  approval_method text not null default 'SQL_OWNER_USER_AUTHORISED_TEST_ROLEPLAY'
    check(approval_method='SQL_OWNER_USER_AUTHORISED_TEST_ROLEPLAY'),
  owner_reference text not null check(char_length(owner_reference) between 20 and 400),
  payload jsonb not null check(pg_catalog.jsonb_typeof(payload)='object'),
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'
    and payload_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload::text,'UTF8')),'hex')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(), unique(owner_user_id,request_key)
);
create table bx1_private.roleplay_people (
  person_id uuid primary key references bx1_private.persons(id) on delete restrict,
  owner_receipt_id uuid not null references bx1_private.roleplay_owner_receipts(id) on delete restrict,
  assurance text not null default 'OWNER_ASSERTED_SINGLE_TEST_OPERATOR' check(assurance='OWNER_ASSERTED_SINGLE_TEST_OPERATOR'),
  independent_human_verified boolean not null default false check(not independent_human_verified),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_private.roleplay_operators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  person_id uuid not null references bx1_private.roleplay_people(person_id) on delete restrict,
  owner_receipt_id uuid not null references bx1_private.roleplay_owner_receipts(id) on delete restrict,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED')),
  revision integer not null default 1 check(revision>0),
  revoked_at timestamptz, revoked_by uuid references auth.users(id) on delete restrict, revoked_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check((status='REVOKED')=(revoked_at is not null and revoked_by is not null and revoked_reason is not null))
);
create table bx1_private.roleplay_policies (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  project_ref text not null default 'fegnnnlseuejkrusbbkv' check(project_ref='fegnnnlseuejkrusbbkv'),
  environment text not null default 'TESTNET' check(environment='TESTNET'),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  product_organisation_id uuid not null references bx1_portal.organisations(id) on delete restrict,
  native_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  product_revision integer not null check(product_revision>0), terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  version integer not null check(version>0), authority_epoch integer not null check(authority_epoch>0),
  owner_receipt_id uuid not null unique references bx1_private.roleplay_owner_receipts(id) on delete restrict,
  actual_operator_person_id uuid not null references bx1_private.roleplay_people(person_id) on delete restrict,
  assurance text not null default 'TEST_ROLE_PLAY' check(assurance='TEST_ROLE_PLAY'),
  independence_proven boolean not null default false check(not independence_proven),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED')),
  valid_from timestamptz not null default pg_catalog.clock_timestamp(), valid_until timestamptz not null,
  revoked_at timestamptz, revoked_by uuid references auth.users(id) on delete restrict, revoked_reason text,
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  unique(product_id,version), unique(product_id,authority_epoch),
  check(pg_catalog.isfinite(valid_until) and valid_until>valid_from and valid_until<=valid_from+interval '7 days'),
  check((status='REVOKED')=(revoked_at is not null and revoked_by is not null and revoked_reason is not null))
);
create unique index roleplay_one_active_revision on bx1_private.roleplay_policies(product_id,offering_revision_id) where status='ACTIVE';
create table bx1_private.roleplay_capacities (
  policy_id uuid not null references bx1_private.roleplay_policies(id) on delete restrict,
  user_id uuid not null references bx1_private.roleplay_operators(user_id) on delete restrict,
  native_membership_id uuid not null references public.bx1_memberships(id) on delete restrict,
  role text not null check(role in ('Investor','OfferingManager','IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController','SuperAdmin')),
  actions text[] not null check(pg_catalog.cardinality(actions) between 1 and 30 and pg_catalog.array_position(actions,null) is null),
  primary key(policy_id,user_id,role), unique(policy_id,native_membership_id)
);
create table bx1_private.roleplay_wallet_slots (
  policy_id uuid not null, user_id uuid not null, role text not null check(role in ('Investor','TokenisationAgent')),
  slot text not null check(slot ~ '^[a-z][a-z0-9_-]{0,39}$'),
  chain_id integer not null default 80002 check(chain_id=80002),
  wallet_address text not null check(wallet_address ~ '^0x[0-9a-f]{40}$' and wallet_address<>'0x0000000000000000000000000000000000000000'),
  ownership_assurance text not null default 'DECLARED_NOT_VERIFIED' check(ownership_assurance='DECLARED_NOT_VERIFIED'),
  primary key(policy_id,slot), unique(policy_id,wallet_address),
  foreign key(policy_id,user_id,role) references bx1_private.roleplay_capacities(policy_id,user_id,role) on delete restrict
);
create table bx1_private.roleplay_events (
  id uuid primary key default pg_catalog.gen_random_uuid(), policy_id uuid not null references bx1_private.roleplay_policies(id) on delete restrict,
  event_number integer not null check(event_number>0), action text not null check(action in ('PROVISIONED','POLICY_REVOKED')),
  actor_id uuid not null references auth.users(id) on delete restrict, operating_context jsonb,
  assurance text not null default 'TEST_ROLE_PLAY' check(assurance='TEST_ROLE_PLAY'),
  independence_proven boolean not null default false check(not independence_proven),
  details jsonb not null, previous_hash text, event_hash text not null check(event_hash ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(), unique(policy_id,event_number)
);


create function bx1_private.test_roleplay_environment() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.entry_configuration where singleton and environment='TESTNET');
$$;
create function bx1_private.test_roleplay_protected_session() returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  return coalesce(bx1_private.test_roleplay_environment() and auth.uid() is not null
    and auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    and auth.jwt()->>'role'='authenticated' and auth.jwt()->>'aal'='aal2'
    and auth.jwt()->>'exp' ~ '^[0-9]{1,12}$' and (auth.jwt()->>'exp')::numeric>extract(epoch from pg_catalog.clock_timestamp())
    and bx1_portal.fresh_session() and bx1_private.has_session_mfa() and bx1_private.has_token_mfa()
    and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      join auth.users u on u.id=s.user_id join public.bx1_profiles p on p.id=u.id
      where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and s.aal::text='aal2'
        and f.status::text='verified' and f.factor_type::text='totp' and p.status='ACTIVE'
        and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())),false);
exception when others then return false;
end $$;
create function bx1_private.test_roleplay_role_actions(p_role text) returns text[]
language sql immutable set search_path='' as $$
  select case p_role
    when 'Investor' then array['request_product_eligibility','subscribe','bind_fund_delivery_wallet','request_fund_payment_allocation_basis','prepare_fund_payment','submit_fund_payment','record_fund_payment','submit_funding_reference','verify_funding_reference']
    when 'OfferingManager' then array['FUND_SETUP','create_product','save_product','submit_product','request_product_service_appointment','REQUEST_PURPOSE']
    when 'IssuerFundManager' then array['review_offering_issuer','approve_fund_payment_allocation_basis','request_fund_allocation','PREPARE_EXECUTION','REQUEST_SIGNING_VIEW']
    when 'ComplianceOfficer' then array['review_product_service_appointment','review_product','review_product_eligibility','revoke_product_eligibility','REVIEW_PURPOSE','REVOKE_PURPOSE']
    when 'TransferAgent' then array['approve_fund_allocation']
    when 'TokenisationAgent' then array['FUND_SETUP','request_fund_deployment','approve_fund_deployment','prepare_fund_transaction','record_fund_signature','claim_fund_execution','record_fund_transaction','request_fund_issuance','approve_fund_issuance','cancel_fund_operation']
    when 'TreasuryOperator' then array['propose_funding_route','open_funding_obligation','propose_funding_acceptance','propose_funding_exception','propose_funding_reversal']
    when 'FinancialController' then array['approve_funding_route','reconcile_funding','resolve_funding_exception','approve_funding_reversal']
    when 'SuperAdmin' then array['apply_product_service_appointment','read_test_roleplay','revoke_test_roleplay']
    else array[]::text[] end;
$$;
create function bx1_private.test_roleplay_binding_current(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.test_roleplay_environment() and exists(select 1 from bx1_private.roleplay_policies r
    join bx1_portal.products p on p.id=r.product_id and p.organisation_id=r.product_organisation_id
    join bx1_portal.offering_revisions o on o.id=r.offering_revision_id and o.product_id=p.id
    join public.bx1_organisations n on n.id=r.native_organisation_id and n.status='ACTIVE'
    join bx1_private.roleplay_people person on person.person_id=r.actual_operator_person_id
    join bx1_private.persons identity on identity.id=person.person_id and identity.status='TEST_ROLE_PLAY'
    where r.id=p_id and r.status='ACTIVE' and r.valid_from<=pg_catalog.clock_timestamp() and r.valid_until>pg_catalog.clock_timestamp()
      and r.project_ref='fegnnnlseuejkrusbbkv' and r.environment='TESTNET' and r.assurance='TEST_ROLE_PLAY' and not r.independence_proven
      and p.current_offering_revision_id=o.id and p.terms_hash=r.terms_hash and o.terms_hash=r.terms_hash
      and p.revision>=r.product_revision and o.terms=p.terms and p.terms->>'asset_type'='FUND'
      and p.terms->>'currency'='TST' and p.terms->>'settlement_decimals'='6');
$$;
create function bx1_private.test_roleplay_policy_current(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.test_roleplay_protected_session() and bx1_private.test_roleplay_binding_current(p_id);
$$;
create function bx1_private.test_roleplay_person(p_product uuid,p_actor uuid) returns uuid
language sql volatile security definer set search_path='' as $$
  -- Identity/provenance lookup only, not command authority or proof of KYC.
  select operator.person_id from bx1_private.roleplay_operators operator
    join bx1_private.roleplay_capacities capacity on capacity.user_id=operator.user_id
    join bx1_private.roleplay_policies policy on policy.id=capacity.policy_id and policy.product_id=p_product
      and policy.actual_operator_person_id=operator.person_id
    join auth.users u on u.id=operator.user_id and u.email_confirmed_at is not null and u.deleted_at is null
    join public.bx1_profiles profile on profile.id=u.id and profile.status='ACTIVE'
    where operator.user_id=p_actor and operator.status='ACTIVE' and bx1_private.test_roleplay_policy_current(policy.id)
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
    order by policy.version desc limit 1;
$$;
create function bx1_private.test_roleplay_current(p_policy uuid,p_product uuid,p_offering uuid,p_actor uuid,p_context jsonb,
  p_action text,p_wallet_slot text default null,p_epoch integer default null) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_private.test_roleplay_protected_session() is not true or p_actor is distinct from auth.uid()
    or pg_catalog.jsonb_typeof(p_context) is distinct from 'object' or p_context->>'mode' is distinct from 'ROLE'
    or p_context-array['mode','organisationId','role']<>'{}'::jsonb then return false; end if;
  return exists(select 1 from bx1_private.roleplay_policies policy
    join bx1_private.roleplay_capacities capacity on capacity.policy_id=policy.id and capacity.user_id=p_actor and capacity.role=p_context->>'role'
    join bx1_private.roleplay_operators operator on operator.user_id=p_actor and operator.person_id=policy.actual_operator_person_id and operator.status='ACTIVE'
    join public.bx1_memberships membership on membership.id=capacity.native_membership_id and membership.user_id=p_actor
      and membership.role=capacity.role and membership.organisation_id=policy.native_organisation_id
    where policy.id=p_policy and policy.product_id=p_product and policy.offering_revision_id=p_offering
      and policy.native_organisation_id::text=p_context->>'organisationId' and membership.status='ACTIVE'
      and bx1_portal.native_membership_effective(membership.id) and bx1_private.test_roleplay_policy_current(policy.id)
      and (p_epoch is null or p_epoch=policy.authority_epoch) and p_action=any(capacity.actions)
      and p_action=any(bx1_private.test_roleplay_role_actions(capacity.role))
      and (p_wallet_slot is null or exists(select 1 from bx1_private.roleplay_wallet_slots wallet
        where wallet.policy_id=policy.id and wallet.user_id=p_actor and wallet.role=capacity.role and wallet.slot=p_wallet_slot)));
exception when others then return false;
end $$;
create function bx1_private.test_roleplay_projection(p_context jsonb,p_product uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.roleplay_policies; capacity bx1_private.roleplay_capacities;
begin
  if bx1_private.test_roleplay_protected_session() is not true then return null; end if;
  select policy.* into p from bx1_private.roleplay_policies policy
    join bx1_private.roleplay_capacities c on c.policy_id=policy.id and c.user_id=auth.uid() and c.role=p_context->>'role'
    where policy.product_id=p_product and bx1_private.test_roleplay_current(policy.id,p_product,policy.offering_revision_id,
      auth.uid(),p_context,c.actions[1],null,policy.authority_epoch) order by policy.version desc limit 1;
  if p.id is null then return null; end if;
  select * into capacity from bx1_private.roleplay_capacities where policy_id=p.id and user_id=auth.uid() and role=p_context->>'role';
  return pg_catalog.jsonb_build_object('policy_id',p.id,'authority_epoch',p.authority_epoch,'expires_at',p.valid_until,
    'offering_revision_id',p.offering_revision_id,'actual_operator_person_id',p.actual_operator_person_id,'assurance','TEST_ROLE_PLAY',
    'independence_proven',false,'label','TEST role-play: one operator, not independent human approval',
    'allowed_actions',capacity.actions,'wallet_slots',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.slot),'[]'::jsonb)
      from bx1_private.roleplay_wallet_slots w where w.policy_id=p.id and w.user_id=auth.uid() and w.role=capacity.role));
end $$;
create function bx1_private.test_roleplay_lock(p_context jsonb,p_product uuid,p_action text,p_wallet_slot text default null) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare projection jsonb; v_policy_id uuid; v_person_id uuid;
begin
  projection:=bx1_private.test_roleplay_projection(p_context,p_product);
  v_policy_id:=(projection->>'policy_id')::uuid; v_person_id:=(projection->>'actual_operator_person_id')::uuid;
  if v_policy_id is null then raise exception 'test_roleplay_current_capacity_required' using errcode='42501'; end if;
  perform id from auth.users where id=auth.uid() for share;
  perform id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=auth.uid() for share;
  perform id from public.bx1_memberships where user_id=auth.uid()
    and organisation_id=(p_context->>'organisationId')::uuid and role=p_context->>'role' order by id for share;
  perform p.person_id from bx1_private.roleplay_people p where p.person_id=v_person_id for share;
  perform user_id from bx1_private.roleplay_operators where user_id=auth.uid() for share;
  perform id from bx1_private.roleplay_policies where id=v_policy_id for share;
  perform bx1_private.lock_funding_person(auth.uid(),v_person_id);
  if bx1_private.test_roleplay_current(v_policy_id,p_product,(projection->>'offering_revision_id')::uuid,auth.uid(),p_context,p_action,
    p_wallet_slot,(projection->>'authority_epoch')::integer) is not true then
    raise exception 'test_roleplay_authority_changed_after_wait' using errcode='42501'; end if;
  return v_policy_id;
end $$;
create function bx1_private.test_roleplay_owner_current(p_policy uuid,p_context jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_private.test_roleplay_protected_session() and exists(select 1 from bx1_private.roleplay_policies policy
    join bx1_private.roleplay_owner_receipts receipt on receipt.id=policy.owner_receipt_id and receipt.owner_user_id=auth.uid()
    join public.bx1_memberships m on m.id=receipt.owner_membership_id and m.user_id=auth.uid() and m.role='SuperAdmin'
    join public.bx1_organisations o on o.id=m.organisation_id and o.status='ACTIVE'
    where policy.id=p_policy and policy.project_ref='fegnnnlseuejkrusbbkv' and policy.environment='TESTNET'
      and m.status='ACTIVE' and bx1_portal.native_membership_effective(m.id)
      and p_context=pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role','SuperAdmin'));
$$;
create function bx1_private.test_roleplay_revoke_allowed(p_policy uuid,p_context jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  -- Revocation remains possible after policy expiry or product amendment. It
  -- still requires the recorded approving owner or an explicitly authorised,
  -- current Super Admin capacity of the actual recorded TEST operator.
  select coalesce(bx1_private.test_roleplay_owner_current(p_policy,p_context)
    or (bx1_private.test_roleplay_protected_session() and exists(
      select 1 from bx1_private.roleplay_policies policy
        join bx1_private.roleplay_capacities c on c.policy_id=policy.id and c.user_id=auth.uid() and c.role='SuperAdmin'
        join bx1_private.roleplay_operators operator on operator.user_id=c.user_id
          and operator.person_id=policy.actual_operator_person_id and operator.status='ACTIVE'
        join bx1_private.roleplay_people person on person.person_id=operator.person_id
        join bx1_private.persons identity on identity.id=person.person_id and identity.status='TEST_ROLE_PLAY'
        join public.bx1_memberships m on m.id=c.native_membership_id and m.user_id=auth.uid()
          and m.role='SuperAdmin' and m.organisation_id=policy.native_organisation_id
        join public.bx1_organisations o on o.id=m.organisation_id and o.status='ACTIVE'
      where policy.id=p_policy and policy.project_ref='fegnnnlseuejkrusbbkv' and policy.environment='TESTNET'
        and 'revoke_test_roleplay'=any(c.actions) and m.status='ACTIVE' and bx1_portal.native_membership_effective(m.id)
        and p_context=pg_catalog.jsonb_build_object('mode','ROLE','organisationId',m.organisation_id,'role','SuperAdmin'))),false);
$$;
create function bx1_private.test_roleplay_record_event(p_policy uuid,p_action text,p_actor uuid,p_context jsonb,p_details jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare n integer; previous text; payload jsonb;
begin
  perform id from bx1_private.roleplay_policies where id=p_policy for update;
  select event_number,event_hash into n,previous from bx1_private.roleplay_events where policy_id=p_policy order by event_number desc limit 1;
  n:=coalesce(n,0)+1;
  payload:=pg_catalog.jsonb_build_object('policy_id',p_policy,'event_number',n,'action',p_action,'actor_id',p_actor,
    'operating_context',p_context,'details',p_details,'previous_hash',previous,'assurance','TEST_ROLE_PLAY','independence_proven',false);
  insert into bx1_private.roleplay_events(policy_id,event_number,action,actor_id,operating_context,details,previous_hash,event_hash)
    values(p_policy,n,p_action,p_actor,p_context,p_details,previous,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(payload::text,'UTF8')),'hex'));
end $$;

create function bx1_private.test_roleplay_provision(p_owner uuid,p_key uuid,p_body jsonb) returns uuid
language plpgsql volatile security invoker set search_path='' as $$
declare receipt bx1_private.roleplay_owner_receipts; policy bx1_private.roleplay_policies;
  product bx1_portal.products; offering bx1_portal.offering_revisions; item jsonb; member public.bx1_memberships;
  person uuid; target uuid; version_no integer; epoch integer; until_at timestamptz; payload_hash text; role_actions text[];
begin
  if current_user<>'postgres' or session_user<>'postgres' or bx1_private.test_roleplay_environment() is not true then
    raise exception 'test_roleplay_postgres_owner_only' using errcode='42501'; end if;
  perform bx1_portal.require_keys(p_body,array['product_id','offering_revision_id','expected_product_revision','terms_hash',
    'native_organisation_id','owner_membership_id','owner_reference','operator_person_id','operator_label','capacities','wallet_slots','valid_until','expected_previous_version']);
  if p_key is null or p_key='00000000-0000-0000-0000-000000000000' or pg_catalog.octet_length(p_body::text)>32768
    or pg_catalog.jsonb_typeof(p_body->'capacities') is distinct from 'array' or pg_catalog.jsonb_array_length(p_body->'capacities') not between 1 and 30
    or pg_catalog.jsonb_typeof(p_body->'wallet_slots') is distinct from 'array' or pg_catalog.jsonb_array_length(p_body->'wallet_slots')>20 then
    raise exception 'test_roleplay_payload_invalid' using errcode='22023'; end if;
  perform bx1_portal.require_text(p_body,'owner_reference',20,400); perform bx1_portal.require_text(p_body,'operator_label',1,170);
  payload_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_body::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_test_roleplay:'||(p_body->>'product_id'),0));
  select * into receipt from bx1_private.roleplay_owner_receipts where owner_user_id=p_owner and request_key=p_key;
  if receipt.id is not null then
    if receipt.payload_hash is distinct from payload_hash or receipt.payload is distinct from p_body then
      raise exception 'test_roleplay_idempotency_conflict' using errcode='23505'; end if;
    select id into target from bx1_private.roleplay_policies where owner_receipt_id=receipt.id;
    if target is null then raise exception 'test_roleplay_receipt_incomplete' using errcode='23514'; end if;
    return target;
  end if;
  select * into member from public.bx1_memberships where id=(p_body->>'owner_membership_id')::uuid and user_id=p_owner
    and role='SuperAdmin' and status='ACTIVE' for share;
  if member.id is null or bx1_portal.native_membership_effective(member.id) is not true
    or not exists(select 1 from public.bx1_profiles p join auth.users u on u.id=p.id join public.bx1_organisations o on o.id=member.organisation_id
      where p.id=p_owner and p.status='ACTIVE' and u.email_confirmed_at is not null and u.deleted_at is null and o.status='ACTIVE'
        and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())) then
    raise exception 'test_roleplay_actual_owner_required' using errcode='42501'; end if;
  select * into product from bx1_portal.products where id=(p_body->>'product_id')::uuid for update;
  select * into offering from bx1_portal.offering_revisions where id=(p_body->>'offering_revision_id')::uuid and product_id=product.id;
  if product.id is null or product.revision is distinct from (p_body->>'expected_product_revision')::integer
    or product.current_offering_revision_id is distinct from offering.id or offering.terms is distinct from product.terms
    or product.terms_hash is distinct from p_body->>'terms_hash' or product.terms_hash is distinct from offering.terms_hash
    or product.terms->>'asset_type' is distinct from 'FUND' or product.terms->>'currency' is distinct from 'TST'
    or product.terms->>'settlement_decimals' is distinct from '6'
    or not exists(select 1 from public.bx1_organisations where id=(p_body->>'native_organisation_id')::uuid and status='ACTIVE') then
    raise exception 'test_roleplay_exact_test_fund_required' using errcode='23514'; end if;
  select coalesce(max(version),0)+1,coalesce(max(authority_epoch),0)+1 into version_no,epoch
    from bx1_private.roleplay_policies where product_id=product.id;
  if version_no-1 is distinct from (p_body->>'expected_previous_version')::integer then
    raise exception 'test_roleplay_policy_revision_changed' using errcode='23514'; end if;
  until_at:=(p_body->>'valid_until')::timestamptz; person:=(p_body->>'operator_person_id')::uuid;
  if person is null or person='00000000-0000-0000-0000-000000000000' or not pg_catalog.isfinite(until_at)
    or until_at<=pg_catalog.clock_timestamp() or until_at>pg_catalog.clock_timestamp()+interval '7 days' then
    raise exception 'test_roleplay_person_or_expiry_invalid' using errcode='22023'; end if;
  insert into bx1_private.roleplay_owner_receipts(owner_user_id,owner_membership_id,request_key,owner_reference,payload,payload_hash)
    values(p_owner,member.id,p_key,p_body->>'owner_reference',p_body,payload_hash) returning * into receipt;
  if not exists(select 1 from bx1_private.roleplay_people where person_id=person) then
    perform bx1_private.test_roleplay_create_person(person,p_body->>'operator_label',receipt.id);
    insert into bx1_private.roleplay_people(person_id,owner_receipt_id) values(person,receipt.id);
  elsif not exists(select 1 from bx1_private.roleplay_people r join bx1_private.persons p on p.id=r.person_id
    where r.person_id=person and p.status='TEST_ROLE_PLAY' and p.label='TEST role-play: '||(p_body->>'operator_label')) then
    raise exception 'test_roleplay_existing_person_changed' using errcode='23514'; end if;
  insert into bx1_private.roleplay_policies(product_id,offering_revision_id,product_organisation_id,native_organisation_id,
    product_revision,terms_hash,version,authority_epoch,owner_receipt_id,actual_operator_person_id,valid_until)
    values(product.id,offering.id,product.organisation_id,(p_body->>'native_organisation_id')::uuid,product.revision,
      product.terms_hash,version_no,epoch,receipt.id,person,until_at) returning * into policy;
  for item in select value from pg_catalog.jsonb_array_elements(p_body->'capacities') loop
    perform bx1_portal.require_keys(item,array['user_id','native_membership_id','role','actions']);
    if pg_catalog.jsonb_typeof(item->'actions') is distinct from 'array' then raise exception 'test_roleplay_actions_invalid' using errcode='22023'; end if;
    select pg_catalog.array_agg(value#>>'{}') into role_actions from pg_catalog.jsonb_array_elements(item->'actions');
    if role_actions is null or not(role_actions<@bx1_private.test_roleplay_role_actions(item->>'role')) or pg_catalog.cardinality(role_actions) not between 1 and 30
      or exists(select 1 from pg_catalog.jsonb_array_elements(item->'actions') a(value) where pg_catalog.jsonb_typeof(a.value) is distinct from 'string') then
      raise exception 'test_roleplay_actions_not_admitted' using errcode='22023'; end if;
    select * into member from public.bx1_memberships where id=(item->>'native_membership_id')::uuid
      and user_id=(item->>'user_id')::uuid and role=item->>'role' and organisation_id=policy.native_organisation_id and status='ACTIVE' for share;
    if member.id is null or bx1_portal.native_membership_effective(member.id) is not true
      or not exists(select 1 from auth.users u join public.bx1_profiles p on p.id=u.id where u.id=member.user_id
        and p.status='ACTIVE' and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())) then
      raise exception 'test_roleplay_actual_capacity_required' using errcode='42501'; end if;
    insert into bx1_private.roleplay_operators(user_id,person_id,owner_receipt_id) values(member.user_id,person,receipt.id) on conflict(user_id) do nothing;
    if not exists(select 1 from bx1_private.roleplay_operators where user_id=member.user_id and person_id=person and status='ACTIVE') then
      raise exception 'test_roleplay_operator_identity_conflict' using errcode='23514'; end if;
    insert into bx1_private.roleplay_capacities(policy_id,user_id,native_membership_id,role,actions)
      values(policy.id,member.user_id,member.id,member.role,role_actions);
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(p_body->'wallet_slots') loop
    perform bx1_portal.require_keys(item,array['user_id','role','slot','wallet_address']);
    insert into bx1_private.roleplay_wallet_slots(policy_id,user_id,role,slot,wallet_address)
      values(policy.id,(item->>'user_id')::uuid,item->>'role',item->>'slot',pg_catalog.lower(item->>'wallet_address'));
  end loop;
  if bx1_private.test_roleplay_binding_current(policy.id) is not true then raise exception 'test_roleplay_provision_changed' using errcode='23514'; end if;
  perform bx1_private.test_roleplay_record_event(policy.id,'PROVISIONED',p_owner,null,
    pg_catalog.jsonb_build_object('owner_receipt_id',receipt.id,'actual_operator_person_id',person,'version',version_no,'authority_epoch',epoch));
  return policy.id;
end $$;

create function bx1_private.test_roleplay_read(p_policy uuid,p_context jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.roleplay_policies;
begin
  if bx1_private.test_roleplay_protected_session() is not true then raise exception 'test_roleplay_mfa_required' using errcode='42501'; end if;
  select * into p from bx1_private.roleplay_policies where id=p_policy;
  if p.id is null or not (bx1_private.test_roleplay_owner_current(p.id,p_context)
    or exists(select 1 from bx1_private.roleplay_capacities c where c.policy_id=p.id and c.user_id=auth.uid()
      and bx1_private.test_roleplay_current(p.id,p.product_id,p.offering_revision_id,auth.uid(),p_context,c.actions[1],null,p.authority_epoch))) then
    raise exception 'test_roleplay_scope_denied' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('policy_id',p.id,'product_id',p.product_id,'offering_revision_id',p.offering_revision_id,
    'native_organisation_id',p.native_organisation_id,'version',p.version,'authority_epoch',p.authority_epoch,'status',p.status,
    'valid_until',p.valid_until,'assurance','TEST_ROLE_PLAY','independence_proven',false,'current',bx1_private.test_roleplay_policy_current(p.id),
    'actual_operator_person_id',p.actual_operator_person_id,'owner_receipt_id',p.owner_receipt_id,
    'capacities',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.user_id,c.role),'[]'::jsonb) from bx1_private.roleplay_capacities c
      where c.policy_id=p.id and (c.user_id=auth.uid() or bx1_private.test_roleplay_owner_current(p.id,p_context))),
    'wallet_slots',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(w) order by w.slot),'[]'::jsonb) from bx1_private.roleplay_wallet_slots w
      where w.policy_id=p.id and (w.user_id=auth.uid() or bx1_private.test_roleplay_owner_current(p.id,p_context))));
end $$;
create function bx1_private.test_roleplay_revoke(p_policy uuid,p_context jsonb,p_reason text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_private.roleplay_policies;
begin
  if p_reason is null or char_length(pg_catalog.btrim(p_reason)) not between 20 and 2000
    or bx1_private.test_roleplay_protected_session() is not true then
    raise exception 'test_roleplay_revoke_mfa_or_reason_required' using errcode='42501'; end if;
  select * into p from bx1_private.roleplay_policies where id=p_policy;
  if p.id is null or bx1_private.test_roleplay_revoke_allowed(p.id,p_context) is not true then
    raise exception 'test_roleplay_revoke_scope_denied' using errcode='42501'; end if;
  -- Match the authority-lock order of the business guard before taking the
  -- policy write lock. Re-read authority after all possible waits.
  perform id from auth.users where id=auth.uid() for share;
  perform id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' for share;
  perform f.id from auth.mfa_factors f join auth.sessions s on s.factor_id=f.id and s.user_id=f.user_id
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' for share of f;
  perform id from public.bx1_profiles where id=auth.uid() for share;
  perform o.id from public.bx1_organisations o where o.id=p.native_organisation_id
    or exists(select 1 from bx1_private.roleplay_owner_receipts receipt join public.bx1_memberships m on m.id=receipt.owner_membership_id
      where receipt.id=p.owner_receipt_id and receipt.owner_user_id=auth.uid() and m.organisation_id=o.id) order by o.id for share;
  perform m.id from public.bx1_memberships m where m.user_id=auth.uid() and m.role='SuperAdmin'
    and (m.organisation_id=p.native_organisation_id or exists(select 1 from bx1_private.roleplay_owner_receipts receipt
      where receipt.id=p.owner_receipt_id and receipt.owner_user_id=auth.uid() and receipt.owner_membership_id=m.id)) order by m.id for share;
  perform person_id from bx1_private.roleplay_people where person_id=p.actual_operator_person_id for share;
  perform user_id from bx1_private.roleplay_operators where user_id=auth.uid() for share;
  select * into p from bx1_private.roleplay_policies where id=p_policy for update;
  perform bx1_private.lock_funding_person(auth.uid(),p.actual_operator_person_id);
  if p.id is null or bx1_private.test_roleplay_revoke_allowed(p.id,p_context) is not true then
    raise exception 'test_roleplay_revoke_authority_changed_after_wait' using errcode='42501'; end if;
  if p.status='REVOKED' then return; end if;
  update bx1_private.roleplay_policies set status='REVOKED',revoked_at=pg_catalog.clock_timestamp(),revoked_by=auth.uid(),revoked_reason=pg_catalog.btrim(p_reason) where id=p.id;
  perform bx1_private.test_roleplay_record_event(p.id,'POLICY_REVOKED',auth.uid(),p_context,
    pg_catalog.jsonb_build_object('reason',pg_catalog.btrim(p_reason),'authority_epoch',p.authority_epoch,'independence_proven',false));
  if bx1_private.test_roleplay_revoke_allowed(p.id,p_context) is not true then
    raise exception 'test_roleplay_revoke_authority_changed_at_commit' using errcode='42501'; end if;
end $$;
create function bx1_private.test_roleplay_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'test_roleplay_history_permanent' using errcode='23514'; end if;
  if TG_TABLE_NAME not in ('roleplay_policies','roleplay_operators') then
    raise exception 'test_roleplay_record_immutable' using errcode='23514'; end if;
  if OLD.status<>'ACTIVE' or NEW.status<>'REVOKED'
    or pg_catalog.to_jsonb(NEW)-array['status','revoked_at','revoked_by','revoked_reason','revision']
      is distinct from pg_catalog.to_jsonb(OLD)-array['status','revoked_at','revoked_by','revoked_reason','revision']
    or (TG_TABLE_NAME='roleplay_operators' and (pg_catalog.to_jsonb(NEW)->>'revision')::integer<>(pg_catalog.to_jsonb(OLD)->>'revision')::integer+1) then
    raise exception 'test_roleplay_record_immutable' using errcode='23514'; end if;
  return NEW;
end $$;
create function bx1_private.test_roleplay_person_provenance() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if NEW.status='TEST_ROLE_PLAY' and not exists(select 1 from bx1_private.roleplay_people p
    join bx1_private.roleplay_owner_receipts r on r.id=p.owner_receipt_id where p.person_id=NEW.id
      and NEW.bootstrap_receipt_id=r.id and NEW.evidence_reference='test_roleplay:'||r.id::text
      and exists(select 1 from bx1_private.roleplay_operators o where o.person_id=p.person_id)
      and exists(select 1 from bx1_private.roleplay_policies policy where policy.actual_operator_person_id=p.person_id)) then
    raise exception 'test_roleplay_person_receipt_required' using errcode='23514'; end if;
  return null;
end $$;
-- Deferred because the owner creates the person and its explicit provenance in
-- one atomic command. The original person mutation guard is not replaced.
grant execute on function bx1_private.test_roleplay_person_provenance() to bx1_authority_owner;
set local role bx1_authority_owner;
create constraint trigger bx1_test_roleplay_person_provenance after insert on bx1_private.persons
  deferrable initially deferred for each row execute function bx1_private.test_roleplay_person_provenance();
reset role;

do $restore_owner$
declare edge record; actual jsonb; expected jsonb;
begin
  if (select added_create from pg_temp.bx1_roleplay_schema_acl) then revoke create on schema bx1_private from bx1_authority_owner; end if;
  select original_acl into expected from pg_temp.bx1_roleplay_schema_acl;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by grantor,grantee,privilege_type,is_grantable),'[]'::jsonb) into actual
    from pg_catalog.pg_namespace n cross join lateral pg_catalog.aclexplode(n.nspacl) a where n.nspname='bx1_private';
  if actual is distinct from expected then raise exception 'roleplay_schema_acl_not_restored' using errcode='55000'; end if;
  select * into edge from pg_temp.bx1_roleplay_owner_edges where grantor=current_user::regrole;
  if found then execute pg_catalog.format('grant bx1_authority_owner to %I with admin %s,inherit %s,set %s granted by %I',current_user,
    case when edge.admin_option then 'true' else 'false' end,case when edge.inherit_option then 'true' else 'false' end,
    case when edge.set_option then 'true' else 'false' end,current_user);
  else execute pg_catalog.format('revoke bx1_authority_owner from %I granted by %I',current_user,current_user); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into expected from pg_temp.bx1_roleplay_owner_edges e;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by grantor),'[]'::jsonb) into actual from
    (select grantor,admin_option,inherit_option,set_option from pg_catalog.pg_auth_members
      where roleid='bx1_authority_owner'::regrole and member=current_user::regrole) e;
  if actual is distinct from expected then raise exception 'roleplay_owner_edges_not_restored' using errcode='55000'; end if;
end $restore_owner$;

do $acl$
declare t text; p record;
begin
  foreach t in array array['roleplay_owner_receipts','roleplay_people','roleplay_operators','roleplay_policies','roleplay_capacities','roleplay_wallet_slots','roleplay_events'] loop
    execute pg_catalog.format('alter table bx1_private.%I enable row level security',t);
    execute pg_catalog.format('revoke all on table bx1_private.%I from public,anon,authenticated,service_role',t);
    execute pg_catalog.format('create trigger %I before update or delete on bx1_private.%I for each row execute function bx1_private.test_roleplay_guard()',t||'_immutable',t);
  end loop;
  for p in select oid::regprocedure signature from pg_catalog.pg_proc where pronamespace='bx1_private'::regnamespace
    and pg_catalog.left(proname,14)='test_roleplay_' loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
  end loop;
end $acl$;
grant execute on function bx1_private.test_roleplay_create_person(uuid,text,uuid) to postgres;
grant execute on function bx1_private.test_roleplay_environment() to bx1_authority_owner;
create function public.bx1_test_roleplay_read(policy_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_private.test_roleplay_read(policy_id,operating_context); $$;
create function public.bx1_test_roleplay_revoke(policy_id uuid,operating_context jsonb,reason text) returns void
language sql security invoker set search_path='' as $$ select bx1_private.test_roleplay_revoke(policy_id,operating_context,reason); $$;
revoke all on function public.bx1_test_roleplay_read(uuid,jsonb),public.bx1_test_roleplay_revoke(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function bx1_private.test_roleplay_read(uuid,jsonb),bx1_private.test_roleplay_revoke(uuid,jsonb,text),
  public.bx1_test_roleplay_read(uuid,jsonb),public.bx1_test_roleplay_revoke(uuid,jsonb,text) to authenticated;
