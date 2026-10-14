-- Connected fund lifecycle, additive to the existing portal business records.
-- Definitions only. No admitted release/network/route/signer, approval, funding,
-- transaction or holding is seeded. Apply atomically after the Stage 3 overlay.
-- The public entry points never accept provider facts or a client ready flag.
do $baseline$
begin
  if current_user <> 'postgres'
    or pg_catalog.to_regclass('bx1_portal.fund_operations') is not null
    or pg_catalog.to_regprocedure('bx1_portal.offering_workflow_product_visible(jsonb,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.funding_state(uuid)') is null
    or pg_catalog.to_regprocedure('bx1_private.offering_signature_decisions_current(uuid,uuid,uuid)') is null then
    raise exception 'fund_lifecycle_baseline_required' using errcode='55000';
  end if;
end $baseline$;

-- Installation alone needs REFERENCES on the existing wallet proof identity.
-- Use only its existing owner role and restore the temporary column grant as
-- soon as the FK exists. No role membership, login or runtime permission is
-- granted. The entire installation remains one caller-owned transaction.
create temporary table bx1_fund_wallet_reference_restore on commit drop as
  select not pg_catalog.has_column_privilege('postgres','public.bx1_wallets','id','REFERENCES') as needed;
do $wallet_reference_install$
begin
  if (select needed from pg_temp.bx1_fund_wallet_reference_restore) then
    if not pg_catalog.pg_has_role('postgres','bx1_wallet_owner','MEMBER')
      or (select relowner from pg_catalog.pg_class where oid='public.bx1_wallets'::regclass)<>'bx1_wallet_owner'::regrole then
      raise exception 'fund_wallet_reference_owner_required' using errcode='42501'; end if;
    execute 'set local role bx1_wallet_owner';
    execute 'grant references(id) on public.bx1_wallets to postgres';
    execute 'reset role';
  end if;
end $wallet_reference_install$;

-- TST is a distinct six-decimal denomination, not a relabelling of ZAR_TEST.
-- The existing route/obligation/journal remain the sole funding authority.
alter table bx1_portal.funding_routes add column denomination text not null default 'ZAR_TEST';
do $denomination_constraints$
declare item record;
begin
  for item in select c.conname,c.conrelid::regclass as relation
    from pg_catalog.pg_constraint c where c.contype='c' and
      ((c.conrelid='bx1_portal.funding_routes'::regclass and
        (pg_catalog.pg_get_constraintdef(c.oid) like '%conversion_policy%' or pg_catalog.pg_get_constraintdef(c.oid) like '%posting_rule_version%'))
       or (c.conrelid='bx1_portal.funding_obligations'::regclass and pg_catalog.pg_get_constraintdef(c.oid) like '%currency%')
       or (c.conrelid='bx1_portal.funding_journals'::regclass and pg_catalog.pg_get_constraintdef(c.oid) like '%posting_rule_version%'))
  loop execute pg_catalog.format('alter table %s drop constraint %I',item.relation,item.conname); end loop;
end $denomination_constraints$;
alter table bx1_portal.funding_routes add constraint fund_route_denomination
  check((denomination='ZAR_TEST' and conversion_policy='ZAR_TEST_1_TO_1_V1'
    and posting_rule_version='TEST_TOKEN_ASSET_LIABILITY_V1')
    or (denomination='TST' and token_decimals=6 and chain_id=80002
      and conversion_policy='TST_BASE_UNITS_V1' and posting_rule_version='TEST_TST_ASSET_LIABILITY_V1'));
alter table bx1_portal.funding_obligations add constraint fund_obligation_denomination
  check(currency='ZAR_TEST' or (currency='TST' and token_decimals=6 and token_amount_base_units=amount_minor));
alter table bx1_portal.funding_journals add constraint fund_journal_posting_version
  check(posting_rule_version in ('TEST_TOKEN_ASSET_LIABILITY_V1','TEST_TST_ASSET_LIABILITY_V1'));

-- A submitted product-bound release is reviewed off-line before owner admission.
-- This source pin is selection, NOT conformance or deployment certification.
create table bx1_portal.fund_release_manifests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  native_organisation_id uuid not null references public.bx1_organisations(id) on delete restrict,
  environment text not null check(environment in ('TESTNET','MAINNET')),
  chain_id integer not null check(chain_id>0),
  release_version text not null check(release_version='ERC3643_4.1.3'),
  source_commit text not null check(source_commit='b6c5fabf86e733ede017fef754d59eeb8f80e3f4'),
  manifest_hash text not null check(manifest_hash ~ '^[0-9a-f]{64}$'),
  configuration_hash text not null check(configuration_hash ~ '^[0-9a-f]{64}$'),
  product_binding_hash text not null check(product_binding_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  authority_epoch integer not null check(authority_epoch>0),
  expected_token_address text not null check(expected_token_address ~ '^0x[0-9a-f]{40}$' and expected_token_address<>'0x0000000000000000000000000000000000000000'),
  controller_address text not null check(controller_address ~ '^0x[0-9a-f]{40}$' and controller_address<>'0x0000000000000000000000000000000000000000'),
  execution_account text not null check(execution_account ~ '^0x[0-9a-f]{40}$' and execution_account<>'0x0000000000000000000000000000000000000000'),
  required_confirmations integer not null check(required_confirmations>0),
  security_unit_decimals integer not null check(security_unit_decimals between 0 and 18),
  class_id uuid not null,
  class_name text not null check(char_length(class_name) between 1 and 200),
  settlement_route_id uuid references bx1_portal.funding_routes(id) on delete restrict,
  deployment_expectation jsonb not null check(pg_catalog.jsonb_typeof(deployment_expectation)='object'),
  issuance_expectation jsonb not null check(pg_catalog.jsonb_typeof(issuance_expectation)='object'),
  status text not null default 'NOT_ADMITTED' check(status in ('NOT_ADMITTED','ADMITTED','REVOKED')),
  conformance_receipt_id uuid, governance_receipt_id uuid, observation_policy_receipt_id uuid,
  admitted_by uuid references auth.users(id) on delete restrict,
  admitted_until timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  check(status<>'ADMITTED' or (admitted_by is not null and admitted_until is not null
    and conformance_receipt_id is not null and governance_receipt_id is not null and observation_policy_receipt_id is not null)),
  unique(id,product_id,offering_revision_id)
);
create unique index fund_release_one_current on bx1_portal.fund_release_manifests(product_id,offering_revision_id) where status='ADMITTED';

create table bx1_portal.fund_signer_policies (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  manifest_id uuid not null references bx1_portal.fund_release_manifests(id) on delete restrict,
  authority_policy_hash text not null check(authority_policy_hash ~ '^[0-9a-f]{64}$'),
  authority_epoch integer not null check(authority_epoch>0),
  approval_threshold integer not null check(approval_threshold between 2 and 20),
  safe_threshold integer not null check(safe_threshold between 2 and 20),
  status text not null default 'NOT_ADMITTED' check(status in ('NOT_ADMITTED','ADMITTED','REVOKED')),
  admission_receipt_id uuid, admitted_until timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(status<>'ADMITTED' or (admission_receipt_id is not null and admitted_until is not null)),
  unique(id,manifest_id)
);
-- Narrow product-operation authority; an existing membership alone does not
-- appoint an institutional signer, financial officer or register operator.
create table bx1_portal.fund_authorities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  signer_policy_id uuid not null references bx1_portal.fund_signer_policies(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  native_membership_id uuid not null references public.bx1_memberships(id) on delete restrict,
  person_id uuid not null,
  role text not null check(role in ('IssuerFundManager','ComplianceOfficer','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController')),
  can_approve boolean not null default false,
  can_sign boolean not null default false,
  signer_address text check(signer_address ~ '^0x[0-9a-f]{40}$' and signer_address<>'0x0000000000000000000000000000000000000000'),
  authority_receipt_id uuid not null,
  valid_from timestamptz not null, valid_until timestamptz not null,
  status text not null default 'NOT_ADMITTED' check(status in ('NOT_ADMITTED','ADMITTED','REVOKED')),
  check(valid_until>valid_from), check(not can_sign or (role='TokenisationAgent' and signer_address is not null)),
  unique(signer_policy_id,user_id,role), unique(signer_policy_id,person_id,role)
);
create unique index fund_signer_one_wallet on bx1_portal.fund_authorities(signer_policy_id,signer_address) where can_sign and status='ADMITTED';

create table bx1_portal.fund_delivery_bindings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  wallet_proof_id uuid not null references public.bx1_wallets(id) on delete restrict,
  wallet_address text not null check(wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null check(chain_id>0), revision integer not null default 1 check(revision>0),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','REVOKED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(investment_account_id,product_id)
);
do $wallet_reference_restore$
begin
  if (select needed from pg_temp.bx1_fund_wallet_reference_restore) then
    execute 'set local role bx1_wallet_owner';
    execute 'revoke references(id) on public.bx1_wallets from postgres';
    execute 'reset role';
    if pg_catalog.has_column_privilege('postgres','public.bx1_wallets','id','REFERENCES') then
      raise exception 'fund_wallet_reference_permission_not_restored' using errcode='42501'; end if;
  end if;
end $wallet_reference_restore$;
create table bx1_portal.fund_allocations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subscription_id uuid not null unique references bx1_portal.subscriptions(id) on delete restrict,
  obligation_id uuid not null unique references bx1_portal.funding_obligations(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  delivery_binding_id uuid not null references bx1_portal.fund_delivery_bindings(id) on delete restrict,
  eligibility_case_id uuid not null references bx1_portal.product_eligibility_cases(id) on delete restrict,
  eligibility_revision integer not null check(eligibility_revision>0),
  units_base numeric(78,0) not null check(units_base>0),
  amount_base_units numeric(78,0) not null check(amount_base_units>0),
  evidence_set_hash text not null check(evidence_set_hash ~ '^[0-9a-f]{64}$'),
  obligation_revision integer not null check(obligation_revision>0),
  revision integer not null default 1 check(revision>0),
  status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED','ISSUING','RECONCILED','CANCELLED')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_person_id uuid not null,
  requested_context jsonb not null,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_person_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  check(approved_person_id is null or approved_person_id<>requested_person_id),
  check(status not in ('APPROVED','ISSUING','RECONCILED') or (approved_by is not null and approved_at is not null))
);
create table bx1_portal.fund_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  subscription_id uuid references bx1_portal.subscriptions(id) on delete restrict,
  allocation_id uuid unique references bx1_portal.fund_allocations(id) on delete restrict,
  manifest_id uuid not null,
  signer_policy_id uuid not null,
  kind text not null check(kind in ('DEPLOYMENT','ISSUANCE')),
  revision integer not null default 1 check(revision>0),
  state text not null default 'REQUESTED' check(state in ('REQUESTED','APPROVAL_PENDING','APPROVED','SIGNING','BROADCAST','MINED','CONFIRMING','FINAL','REJECTED','SIGNING_FAILED','UNKNOWN','REPLACED','REVERTED','REORGED','CANCELLED','EXPIRED')),
  chain_id integer not null check(chain_id>0),
  execution_account text not null check(execution_account ~ '^0x[0-9a-f]{40}$'),
  binding_hash text not null check(binding_hash ~ '^[0-9a-f]{64}$'),
  intent_hash text not null check(intent_hash ~ '^[0-9a-f]{64}$'),
  authority_policy_hash text not null check(authority_policy_hash ~ '^[0-9a-f]{64}$'),
  authority_epoch integer not null check(authority_epoch>0),
  expectation jsonb not null check(pg_catalog.jsonb_typeof(expectation)='object'),
  expectation_hash text check(expectation_hash ~ '^[0-9a-f]{64}$'),
  intent jsonb check(pg_catalog.jsonb_typeof(intent)='object'),
  safe_nonce numeric(78,0) not null check(safe_nonce>=0),
  nonce_released boolean not null default false,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_person_id uuid,
  requested_context jsonb not null,
  expires_at timestamptz not null,
  transaction_hash text check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  token_address text check(token_address ~ '^0x[0-9a-f]{40}$'),
  controller_address text check(controller_address ~ '^0x[0-9a-f]{40}$'),
  confirmations integer check(confirmations>=0),
  reason_code text,
  final_observation_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict,
  foreign key(manifest_id,product_id,offering_revision_id) references bx1_portal.fund_release_manifests(id,product_id,offering_revision_id) on delete restrict,
  foreign key(signer_policy_id,manifest_id) references bx1_portal.fund_signer_policies(id,manifest_id) on delete restrict,
  check((kind='ISSUANCE')=(allocation_id is not null and subscription_id is not null)),
  check(expires_at>created_at), check(not nonce_released or state='CANCELLED')
);
create unique index fund_safe_nonce_reserved on bx1_portal.fund_operations(execution_account,safe_nonce) where not nonce_released;
create unique index fund_deployment_one_open on bx1_portal.fund_operations(product_id,offering_revision_id)
  where kind='DEPLOYMENT' and state not in ('REJECTED','CANCELLED','EXPIRED','REVERTED');
create unique index fund_issuance_one_unsettled on bx1_portal.fund_operations(product_id)
  where kind='ISSUANCE' and state not in ('FINAL','REJECTED','CANCELLED','EXPIRED','REVERTED');
create index fund_operation_queue on bx1_portal.fund_operations(state,created_at,id);
create table bx1_portal.fund_operation_approvals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null references bx1_portal.fund_operations(id) on delete restrict,
  authority_id uuid not null references bx1_portal.fund_authorities(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  person_id uuid not null, operating_context jsonb not null,
  intent_hash text not null, authority_epoch integer not null,
  approved_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(operation_id,person_id), unique(operation_id,actor_id)
);
create table bx1_portal.fund_transaction_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null references bx1_portal.fund_operations(id) on delete restrict,
  transaction_hash text not null check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(operation_id,transaction_hash), unique(transaction_hash)
);
create table bx1_portal.fund_chain_observations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null references bx1_portal.fund_operations(id) on delete restrict,
  attempt_id uuid not null references bx1_portal.fund_transaction_attempts(id) on delete restrict,
  observation_key uuid not null unique,
  expectation_hash text not null check(expectation_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check(pg_catalog.jsonb_typeof(result)='object'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table bx1_portal.fund_operations add foreign key(final_observation_id) references bx1_portal.fund_chain_observations(id) on delete restrict;
create table bx1_portal.fund_register_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null unique references bx1_portal.fund_operations(id) on delete restrict,
  subscription_id uuid not null unique references bx1_portal.subscriptions(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  offering_revision_id uuid not null,
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  class_id uuid not null, units_base numeric(78,0) not null check(units_base>0),
  token_address text not null, wallet_address text not null, chain_id integer not null,
  transaction_hash text not null, observation_id uuid not null unique references bx1_portal.fund_chain_observations(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict
);
create table bx1_portal.fund_holdings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  register_entry_id uuid not null unique references bx1_portal.fund_register_entries(id) on delete restrict,
  issuance_operation_id uuid not null unique references bx1_portal.fund_operations(id) on delete restrict,
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  investment_account_id uuid not null references bx1_portal.investment_accounts(id) on delete restrict,
  subscription_id uuid not null unique references bx1_portal.subscriptions(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);
-- Recognition transfers the already-posted liability. It never posts cash a
-- second time. Existing funding journals provide the linked original evidence.
create table bx1_portal.fund_recognition_journals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null unique references bx1_portal.fund_operations(id) on delete restrict,
  obligation_id uuid not null unique references bx1_portal.funding_obligations(id) on delete restrict,
  amount_base_units numeric(78,0) not null check(amount_base_units>0),
  evidence_set_hash text not null,
  posting_rule_version text not null check(posting_rule_version='TEST_TST_ISSUED_CAPITAL_V1'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_portal.fund_recognition_lines (
  journal_id uuid not null references bx1_portal.fund_recognition_journals(id) on delete restrict,
  line_number integer not null check(line_number in (1,2)),
  account text not null check(account in ('TEST_CUSTOMER_FUNDING_LIABILITY','TEST_ISSUED_FUND_CAPITAL')),
  side text not null check(side in ('DEBIT','CREDIT')), amount_base_units numeric(78,0) not null check(amount_base_units>0),
  primary key(journal_id,line_number)
);
create table bx1_portal.fund_operation_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid references bx1_portal.fund_operations(id) on delete restrict,
  subject_id uuid not null, product_id uuid not null references bx1_portal.products(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  operating_context jsonb, kind text not null, before_revision integer, after_revision integer,
  evidence_id uuid, details_hash text not null check(details_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_portal.fund_worker_leases (
  operation_id uuid primary key references bx1_portal.fund_operations(id) on delete restrict,
  lease_id uuid not null unique, generation bigint not null check(generation>0),
  worker_id text not null, lease_until timestamptz not null
);
create table bx1_portal.fund_safe_signatures (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  operation_id uuid not null references bx1_portal.fund_operations(id) on delete restrict,
  authority_id uuid not null references bx1_portal.fund_authorities(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict, person_id uuid not null,
  signature text not null check(signature ~ '^0x[0-9a-fA-F]{130}$'),
  intent_hash text not null, authority_epoch integer not null,
  status text not null default 'UNVERIFIED' check(status in ('UNVERIFIED','VERIFIED','INVALID')),
  verification_hash text, recovered_address text, verified_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(operation_id,person_id),unique(operation_id,actor_id),
  check(status<>'VERIFIED' or (verification_hash is not null and recovered_address is not null and verified_at is not null))
);
create table bx1_portal.fund_execution_claims (
  operation_id uuid primary key references bx1_portal.fund_operations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  authority_id uuid not null references bx1_portal.fund_authorities(id) on delete restrict,
  claimed_revision integer not null, signature_set_hash text not null,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bx1_portal.fund_payment_intents (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  subscription_id uuid not null references bx1_portal.subscriptions(id) on delete restrict,
  obligation_id uuid not null references bx1_portal.funding_obligations(id) on delete restrict,
  obligation_revision integer not null, route_id uuid not null references bx1_portal.funding_routes(id) on delete restrict,
  route_revision integer not null, actor_id uuid not null references auth.users(id) on delete restrict,
  payer_address text not null check(payer_address ~ '^0x[0-9a-f]{40}$'),
  token_address text not null, beneficiary_address text not null,
  amount_base_units numeric(78,0) not null check(amount_base_units>0),
  state text not null default 'PREPARED' check(state in ('PREPARED','UNKNOWN','BROADCAST')),
  transaction_hash text check(transaction_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at timestamptz not null, claimed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(obligation_id)
);

create function bx1_portal.fund_digest(value jsonb) returns text
language sql immutable set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value::text,'UTF8')),'hex');
$$;
create function bx1_portal.fund_person(actor uuid) returns uuid
language sql volatile security definer set search_path='' as $$
  select p.person_id from bx1_private.person_principals p join bx1_private.persons h on h.id=p.person_id
  where p.auth_user_id=actor and p.status='TRUSTED' and h.status='TRUSTED';
$$;
create function bx1_portal.fund_context(c jsonb,protected boolean default false) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare cfg bx1_portal.entry_configuration;
begin
  select * into cfg from bx1_portal.entry_configuration where singleton;
  if auth.uid() is null or cfg.environment not in ('TESTNET','MAINNET')
    or bx1_portal.admission_context(c) is not true then return false; end if;
  if not protected then return true; end if;
  return bx1_portal.fresh_session() and bx1_portal.valid_operating_context(c)
    and auth.jwt()->>'aal'='aal2' and bx1_portal.fund_person(auth.uid()) is not null
    and exists(select 1 from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.aal::text='aal2'
        and f.status::text='verified' and f.factor_type::text='totp');
end $$;
create function bx1_portal.fund_authority_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_authorities a
    join bx1_portal.fund_signer_policies s on s.id=a.signer_policy_id
    join bx1_portal.fund_release_manifests r on r.id=s.manifest_id
    join public.bx1_memberships m on m.id=a.native_membership_id and m.user_id=a.user_id and m.role=a.role
    join public.bx1_profiles p on p.id=a.user_id and p.status='ACTIVE'
    join auth.users u on u.id=a.user_id and u.deleted_at is null and u.email_confirmed_at is not null
    where a.id=target and a.status='ADMITTED' and s.status='ADMITTED' and r.status='ADMITTED'
      and a.valid_from<=pg_catalog.clock_timestamp() and a.valid_until>pg_catalog.clock_timestamp()
      and s.admitted_until>pg_catalog.clock_timestamp() and r.admitted_until>pg_catalog.clock_timestamp()
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.fund_person(a.user_id)=a.person_id and s.authority_epoch=r.authority_epoch);
$$;
create function bx1_portal.fund_authority(c jsonb,target_policy uuid,target_role text default null) returns uuid
language sql volatile security definer set search_path='' as $$
  select a.id from bx1_portal.fund_authorities a join public.bx1_memberships m on m.id=a.native_membership_id
  where a.signer_policy_id=target_policy and a.user_id=auth.uid() and a.role=c->>'role'
    and m.organisation_id::text=c->>'organisationId' and (target_role is null or a.role=target_role)
    and bx1_portal.fund_context(c,true) and bx1_portal.fund_authority_current(a.id);
$$;
create function bx1_portal.fund_manifest_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_release_manifests m
    join bx1_portal.products p on p.id=m.product_id and p.current_offering_revision_id=m.offering_revision_id
    join bx1_portal.offering_revisions r on r.id=m.offering_revision_id and r.product_id=p.id
    join bx1_portal.entry_configuration c on c.singleton and c.environment=m.environment
    where m.id=target and m.status='ADMITTED' and m.admitted_until>pg_catalog.clock_timestamp()
      and m.terms_hash=r.terms_hash and p.terms_hash=r.terms_hash
      and r.terms->>'asset_type'='FUND' and r.terms->>'terms_version'='3' and r.terms->>'currency'='TST'
      and r.terms->>'settlement_decimals'='6' and m.configuration_hash=r.deployment_configuration_hash
      and r.terms#>>'{deployment_configuration,primary_class_id}'=m.class_id::text
      and r.terms#>>'{common_envelope,classes,0,class_id}'=m.class_id::text
      and r.terms#>>'{common_envelope,classes,0,name}'=m.class_name
      and r.terms#>>'{common_envelope,classes,0,decimals}'=m.security_unit_decimals::text
      and m.deployment_expectation#>>'{manifest,token_details,name}'=r.terms->>'name'
      and m.deployment_expectation#>>'{manifest,token_details,decimals}'=m.security_unit_decimals::text
      and (m.deployment_expectation#>>'{manifest,maximum_supply}')::numeric
        =(r.terms->>'cap_units')::numeric*pg_catalog.power(10::numeric,m.security_unit_decimals)
      and m.deployment_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash
      and m.issuance_expectation#>>'{manifest,product_binding_hash}'=m.product_binding_hash
      and m.environment='TESTNET' and m.chain_id=80002
      and bx1_portal.current_product_organisation(p.organisation_id)
      and bx1_portal.offering_workflow_approved(p.id)
      and exists(select 1 from bx1_portal.offering_decisions i
        join bx1_portal.offering_decisions c on c.offering_revision_id=i.offering_revision_id and c.decision_kind='COMPLIANCE'
        where i.offering_revision_id=r.id and i.decision_kind='ISSUER'
          and i.decision='APPROVED' and c.decision='APPROVED'
          and bx1_private.offering_signature_decisions_current(r.id,i.id,c.id)));
$$;
create function bx1_portal.fund_product_visible(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.fund_context(c,false) and (
    bx1_portal.offering_workflow_product_visible(c,target_product)
    or exists(select 1 from bx1_portal.subscriptions s where s.product_id=target_product and s.investor_id=auth.uid()
      and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
    or exists(select 1 from bx1_portal.fund_authorities a join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
      join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
      join public.bx1_memberships n on n.id=a.native_membership_id
      where m.product_id=target_product and a.user_id=auth.uid() and a.role=c->>'role'
        and n.organisation_id::text=c->>'organisationId' and bx1_portal.fund_authority_current(a.id)));
$$;
create function bx1_portal.fund_order_visible(c jsonb,target_subscription uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.subscriptions s where s.id=target_subscription
    and bx1_portal.fund_product_visible(c,s.product_id) and (
      (s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))
      or (c->>'mode'='ROLE' and c->>'role' in ('OfferingManager','IssuerFundManager','TransferAgent','TokenisationAgent','TreasuryOperator','FinancialController'))));
$$;
create function bx1_portal.fund_binding_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_delivery_bindings b
    join bx1_portal.investment_accounts a on a.id=b.investment_account_id and a.holder_user_id=b.actor_id and a.kind='INDIVIDUAL' and a.status='ACTIVE'
    join public.bx1_wallets w on w.id=b.wallet_proof_id and w.user_id=b.actor_id and w.address=b.wallet_address and w.chain_id=b.chain_id
    join bx1_private.wallet_challenges q on q.id=w.last_proof_id and q.user_id=b.actor_id and q.used_at is not null and q.proof_signature is not null
    join bx1_portal.applications app on app.id=a.application_id and app.user_id=b.actor_id
      and app.persona='INVESTOR' and app.status='APPROVED' and app.approved_until>pg_catalog.clock_timestamp()
    where b.id=target and b.status='ACTIVE' and b.chain_id=80002 and bx1_portal.monitoring_new_action_allowed(app.id));
$$;
create function bx1_portal.fund_allocation_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_allocations a
    join bx1_portal.subscriptions s on s.id=a.subscription_id and s.product_id=a.product_id
      and s.offering_revision_id=a.offering_revision_id and s.investment_account_id=a.investment_account_id
    join bx1_portal.funding_obligations o on o.id=a.obligation_id and o.subscription_id=s.id
    join bx1_portal.product_eligibility_cases eligibility on eligibility.id=a.eligibility_case_id
      and eligibility.revision=a.eligibility_revision and eligibility.investment_account_id=a.investment_account_id
      and eligibility.product_id=a.product_id and eligibility.offering_revision_id=a.offering_revision_id
    where a.id=target and s.status='AWAITING_FUNDING' and o.currency='TST' and o.token_decimals=6
      and a.obligation_revision=o.revision and a.amount_base_units=o.token_amount_base_units
      and a.evidence_set_hash=bx1_portal.funding_evidence_hash(o.id)
      and bx1_portal.funding_state(o.id)='RECONCILED' and bx1_portal.funding_account_current(o.id)
      and bx1_portal.product_eligibility_current(eligibility.id)
      and bx1_portal.funding_route_current(o.route_id) and bx1_portal.fund_binding_current(a.delivery_binding_id)
      and not exists(select 1 from bx1_portal.funding_reversals rev where rev.obligation_id=o.id));
$$;
create function bx1_portal.fund_operation_current(target uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_operations o
    join bx1_portal.fund_signer_policies p on p.id=o.signer_policy_id and p.manifest_id=o.manifest_id
    where o.id=target and bx1_portal.fund_manifest_current(o.manifest_id)
      and p.status='ADMITTED' and p.admitted_until>pg_catalog.clock_timestamp()
      and p.authority_epoch=o.authority_epoch and p.authority_policy_hash=o.authority_policy_hash
      and (o.expires_at>pg_catalog.clock_timestamp() or o.state in ('BROADCAST','UNKNOWN','MINED','CONFIRMING'))
      and (o.kind='DEPLOYMENT' or bx1_portal.fund_allocation_current(o.allocation_id))
      and not exists(select 1 from bx1_portal.fund_operation_approvals a where a.operation_id=o.id
        and (a.intent_hash<>o.intent_hash or a.authority_epoch<>o.authority_epoch
          or bx1_portal.fund_authority_current(a.authority_id) is not true)));
$$;
create function bx1_portal.fund_audit(pid uuid,target uuid,op uuid,action text,c jsonb,before_rev integer,after_rev integer,evidence uuid,details jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); org uuid;
begin
  select organisation_id into org from bx1_portal.products where id=pid;
  insert into bx1_portal.fund_operation_events(operation_id,subject_id,product_id,actor_id,operating_context,kind,before_revision,after_revision,evidence_id,details_hash)
    values(op,target,pid,actor,c,action,before_rev,after_rev,evidence,bx1_portal.fund_digest(details));
  if actor is not null then
    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
      values(target,org,action,actor,'Fund lifecycle action: '||action||'. Ownership is recognised only after final reconciled evidence.');
  end if;
end $$;

create function bx1_portal.fund_recognition_balanced() returns trigger
language plpgsql set search_path='' as $$
declare target uuid; amount numeric; n integer; net numeric;
begin
  target:=case when TG_TABLE_NAME='fund_recognition_journals' then NEW.id else NEW.journal_id end;
  select amount_base_units into amount from bx1_portal.fund_recognition_journals where id=target;
  select count(*),sum(case when side='DEBIT' then amount_base_units else -amount_base_units end) into n,net
    from bx1_portal.fund_recognition_lines where journal_id=target;
  if n<>2 or net is distinct from 0::numeric
    or not exists(select 1 from bx1_portal.fund_recognition_lines where journal_id=target and account='TEST_CUSTOMER_FUNDING_LIABILITY' and side='DEBIT' and amount_base_units=amount)
    or not exists(select 1 from bx1_portal.fund_recognition_lines where journal_id=target and account='TEST_ISSUED_FUND_CAPITAL' and side='CREDIT' and amount_base_units=amount) then
    raise exception 'fund_recognition_unbalanced' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger fund_recognition_journal_balanced after insert on bx1_portal.fund_recognition_journals
  deferrable initially deferred for each row execute function bx1_portal.fund_recognition_balanced();
create constraint trigger fund_recognition_lines_balanced after insert on bx1_portal.fund_recognition_lines
  deferrable initially deferred for each row execute function bx1_portal.fund_recognition_balanced();

-- The funding overlay uses actual canonical bodies, not an alternate writer.
-- Every replacement has one exact source cutpoint; drift aborts atomically.
do $tst_writer_cutover$
declare original text; changed text; cut jsonb; actual text;
begin
  select pg_catalog.pg_get_functiondef(p.oid),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
    pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') into original,actual
    from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('bx1_portal.execute_scoped_pre_eligibility(jsonb,text,uuid,jsonb)')
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
  if actual is distinct from '9a9156a1a628c88cc51bcfca16670f8c6bc137933d4f512e34455f22b8e25d06' then
    raise exception 'fund_tst_writer_source_pin_changed' using errcode='55000'; end if;
  changed:=original;
  for cut in select value from pg_catalog.jsonb_array_elements($cuts$[
    {"from":"perform bx1_portal.require_keys(body,array['product_id','expected_revision','token_address','token_runtime_hash','token_decimals','receiving_address','authority_reference','code_review_reference','valid_until','standard_immutable_token_acknowledged','synthetic_conversion_acknowledged']);",
     "to":"perform bx1_portal.require_keys(body-'currency',array['product_id','expected_revision','token_address','token_runtime_hash','token_decimals','receiving_address','authority_reference','code_review_reference','valid_until','standard_immutable_token_acknowledged','synthetic_conversion_acknowledged']);"},
    {"from":"if p.status<>'PUBLISHED' or not bx1_portal.current_product_organisation(org) or body->'standard_immutable_token_acknowledged'",
     "to":"if p.status<>'PUBLISHED' or (body ? 'currency' and body->>'currency' is distinct from p.terms->>'currency') or (p.terms->>'currency'='TST' and body->>'token_decimals' is distinct from '6') or not bx1_portal.current_product_organisation(org) or body->'standard_immutable_token_acknowledged'"},
    {"from":"product_revision,terms_hash,token_address,token_runtime_hash,token_decimals,receiving_address,authority_reference,code_review_reference,valid_until,proposed_by,proposed_person,proposed_context)",
     "to":"product_revision,terms_hash,denomination,conversion_policy,posting_rule_version,token_address,token_runtime_hash,token_decimals,receiving_address,authority_reference,code_review_reference,valid_until,proposed_by,proposed_person,proposed_context)"},
    {"from":"values(p.id,org,p.revision,p.terms_hash,lower(body->>'token_address')",
     "to":"values(p.id,org,p.revision,p.terms_hash,p.terms->>'currency',case when p.terms->>'currency'='TST' then 'TST_BASE_UNITS_V1' else 'ZAR_TEST_1_TO_1_V1' end,case when p.terms->>'currency'='TST' then 'TEST_TST_ASSET_LIABILITY_V1' else 'TEST_TOKEN_ASSET_LIABILITY_V1' end,lower(body->>'token_address')"},
    {"from":"s.amount_minor*power(10::numeric,r.token_decimals-2)",
     "to":"case when r.denomination='TST' and s.accepted_terms->>'currency'='TST' then s.amount_minor else s.amount_minor*power(10::numeric,r.token_decimals-2) end"},
    {"from":"if s.status<>'AWAITING_FUNDING' or s.investment_account_id is null or r.product_id is distinct from s.product_id",
     "to":"if s.status<>'AWAITING_FUNDING' or s.investment_account_id is null or r.denomination is distinct from s.accepted_terms->>'currency' or r.product_id is distinct from s.product_id"},
    {"from":"if not(bx1_portal.funding_actions(c,'REVERSAL',v.id)?action) or not bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,org)",
     "to":"if exists(select 1 from bx1_portal.fund_recognition_journals where obligation_id=o.id) or not(bx1_portal.funding_actions(c,'REVERSAL',v.id)?action) or not bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,org)"}
  ]$cuts$::jsonb) loop
    if cut->>'from'=cut->>'to' then continue; end if;
    if (pg_catalog.length(changed)-pg_catalog.length(pg_catalog.replace(changed,cut->>'from','')))/pg_catalog.length(cut->>'from')<>1 then
      raise exception 'fund_tst_writer_source_drift: %',cut->>'from' using errcode='55000'; end if;
    changed:=pg_catalog.replace(changed,cut->>'from',cut->>'to');
  end loop;
  execute changed;
end $tst_writer_cutover$;

-- Version is derived from the real obligation, never from a caller assertion.
create function bx1_portal.fund_stamp_posting_version() returns trigger
language plpgsql set search_path='' as $$
declare denomination text;
begin
  select currency into denomination from bx1_portal.funding_obligations where id=NEW.obligation_id;
  if denomination='TST' then
    if NEW.token_decimals<>6 then raise exception 'fund_tst_posting_precision' using errcode='23514'; end if;
    if NEW.kind='FUNDING' and not exists(select 1 from bx1_portal.funding_obligations o
      join bx1_portal.subscriptions s on s.id=o.subscription_id
      join bx1_portal.product_eligibility_cases eligibility on eligibility.investment_account_id=o.investment_account_id
        and eligibility.product_id=o.product_id and eligibility.offering_revision_id=s.offering_revision_id
      where o.id=NEW.obligation_id and bx1_portal.product_eligibility_current(eligibility.id)) then
      raise exception 'fund_tst_current_eligibility_required' using errcode='23514'; end if;
    NEW.posting_rule_version:='TEST_TST_ASSET_LIABILITY_V1';
  elsif denomination<>'ZAR_TEST' then raise exception 'fund_posting_denomination_not_admitted' using errcode='23514'; end if;
  return NEW;
end $$;
create trigger fund_posting_denomination before insert on bx1_portal.funding_journals
  for each row execute function bx1_portal.fund_stamp_posting_version();

create function bx1_portal.fund_lock(c jsonb,pid uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  perform bx1_portal.admission_lock_actor(null,c);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||pid::text,0));
  perform id from bx1_portal.products where id=pid for update;
  perform id from bx1_portal.fund_release_manifests where product_id=pid order by id for share;
  perform sp.id from bx1_portal.fund_signer_policies sp join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
    where m.product_id=pid order by sp.id for share of sp;
  perform a.id from bx1_portal.fund_authorities a join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=pid order by a.id for share of a;
  perform n.id from public.bx1_memberships n join bx1_portal.fund_authorities a on a.native_membership_id=n.id
    join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id
    where m.product_id=pid order by n.id for share of n;
  perform u.id from auth.users u where u.id=auth.uid() or u.id in (
    select a.user_id from bx1_portal.fund_authorities a join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
      join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=pid) order by u.id for share;
  perform p.id from public.bx1_profiles p where p.id=auth.uid() or p.id in (
    select a.user_id from bx1_portal.fund_authorities a join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
      join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=pid) order by p.id for share;
  perform s.id from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' for share;
  perform bx1_portal.lock_entity_people(array(select distinct a.user_id from bx1_portal.fund_authorities a
    join bx1_portal.fund_signer_policies sp on sp.id=a.signer_policy_id
    join bx1_portal.fund_release_manifests m on m.id=sp.manifest_id where m.product_id=pid));
  if bx1_portal.fund_context(c,false) is not true or bx1_portal.fund_product_visible(c,pid) is not true then
    raise exception 'fund_context_changed_after_wait' using errcode='42501'; end if;
end $$;

create function bx1_portal.fund_action(action text,target uuid,rev integer,label text,owner_role text,allowed boolean,reason text,body jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_build_object('action_id',coalesce(action,'HANDOFF')||':'||target::text,
    'command',action,'record_id',target,'expected_revision',rev,'label',label,'owner_role',owner_role,
    'can_execute',allowed,'reason_code',reason,'payload',body);
$$;
create function bx1_portal.fund_operation_actions(c jsonb,oid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; allowed boolean; actions jsonb:='[]'::jsonb;
begin
  select * into o from bx1_portal.fund_operations where id=oid;
  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');
  if o.id is null then return actions; end if;
  allowed:=a.id is not null and bx1_portal.fund_operation_current(o.id);
  if o.state='REQUESTED' then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(null,o.id,o.revision,
      'Prepare the contract request','TokenisationAgent',allowed and a.can_sign and o.expires_at>pg_catalog.clock_timestamp(),
      'PREPARATION_REQUIRED',null));
  end if;
  if o.state='APPROVAL_PENDING' then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(
      case when o.kind='DEPLOYMENT' then 'approve_fund_deployment' else 'approve_fund_issuance' end,o.id,o.revision,
      case when o.kind='DEPLOYMENT' then 'Approve deployment request' else 'Approve unit issuance' end,'TokenisationAgent',
      allowed and a.can_approve and a.person_id is distinct from o.requested_person_id
        and bx1_portal.entity_people_independent(a.user_id,o.requested_by)
        and not exists(select 1 from bx1_portal.fund_operation_approvals ap where ap.operation_id=o.id and ap.person_id=a.person_id),
      case when not allowed then 'CURRENT_SIGNING_AUTHORITY_REQUIRED' end,
      pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision)));
  end if;
  if o.state in ('APPROVED','SIGNING') then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action(null,o.id,o.revision,
      'Review and sign the approved request','TokenisationAgent',allowed and a.can_sign
        and o.intent is not null and o.expires_at>pg_catalog.clock_timestamp(),'SAFE_SIGNATURE_REQUIRED',null));
  end if;
  if o.state in ('UNKNOWN','BROADCAST','REPLACED') then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('record_fund_transaction',o.id,o.revision,
      'Record the existing transaction hash','TokenisationAgent',allowed and a.can_sign
        and a.signer_address=o.expectation->>'signer_address'
        and exists(select 1 from bx1_portal.fund_execution_claims claim where claim.operation_id=o.id and claim.actor_id=auth.uid()),
      'EXISTING_TRANSACTION_HASH_REQUIRED',pg_catalog.jsonb_build_object('operation_id',o.id,'expected_revision',o.revision)));
  end if;
  if o.state in ('REQUESTED','APPROVAL_PENDING','APPROVED','SIGNING','SIGNING_FAILED') then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('cancel_fund_operation',o.id,o.revision,
      'Cancel unsigned operation','TokenisationAgent',false,'REASON_REQUIRED',null));
  end if;
  return actions;
end $$;
create function bx1_portal.fund_operation_projection(c jsonb,oid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; m bx1_portal.fund_release_manifests; intent jsonb;
begin
  select * into o from bx1_portal.fund_operations where id=oid;
  select * into m from bx1_portal.fund_release_manifests where id=o.manifest_id;
  if o.id is null or bx1_portal.fund_product_visible(c,o.product_id) is not true then return null; end if;
  -- Intent is withheld from customer roles and while authority/evidence drift.
  if bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent') is not null
    and bx1_portal.fund_operation_current(o.id) and o.state in ('APPROVED','SIGNING') then intent:=o.intent; end if;
  return pg_catalog.jsonb_build_object('id',o.id,'product_id',o.product_id,'offering_revision_id',o.offering_revision_id,
    'subscription_id',o.subscription_id,'allocation_id',o.allocation_id,'revision',o.revision,'kind',o.kind,'state',o.state,
    'chain_id',o.chain_id,'transaction_hash',o.transaction_hash,'token_address',o.token_address,
    'controller_address',o.controller_address,'manifest_id',o.manifest_id,'manifest_hash',m.manifest_hash,
    'intent_hash',o.intent_hash,'expires_at',o.expires_at,'confirmations',o.confirmations,
    'required_confirmations',m.required_confirmations,'reason_code',o.reason_code,'intent',intent,
    'actions',bx1_portal.fund_operation_actions(c,o.id),
    'signing_owner_address',(select a.signer_address from bx1_portal.fund_authorities a
      where a.id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent')),
    'signer_threshold',(select safe_threshold from bx1_portal.fund_signer_policies where id=o.signer_policy_id),
    'signature_count',(select count(*) from bx1_portal.fund_safe_signatures sig where sig.operation_id=o.id
      and sig.status='VERIFIED' and bx1_portal.fund_authority_current(sig.authority_id)));
end $$;
-- Owner-only receipt shape for the restricted API worker. This never chooses
-- client actions or substitutes an actor/context in the public projection.
create function bx1_portal.fund_operation_receipt(oid uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',o.id,'product_id',o.product_id,'offering_revision_id',o.offering_revision_id,
    'subscription_id',o.subscription_id,'allocation_id',o.allocation_id,'revision',o.revision,'kind',o.kind,'state',o.state,
    'chain_id',o.chain_id,'transaction_hash',o.transaction_hash,'token_address',o.token_address,'controller_address',o.controller_address,
    'manifest_id',o.manifest_id,'manifest_hash',m.manifest_hash,'intent_hash',o.intent_hash,'expires_at',o.expires_at,
    'confirmations',o.confirmations,'required_confirmations',m.required_confirmations,'reason_code',o.reason_code,
    'intent',o.intent,'actions','[]'::jsonb,'signing_owner_address',null,'signer_threshold',sp.safe_threshold,
    'signature_count',(select count(*) from bx1_portal.fund_safe_signatures sig where sig.operation_id=o.id
      and sig.status='VERIFIED' and bx1_portal.fund_authority_current(sig.authority_id)))
  from bx1_portal.fund_operations o join bx1_portal.fund_release_manifests m on m.id=o.manifest_id
    join bx1_portal.fund_signer_policies sp on sp.id=o.signer_policy_id where o.id=oid;
$$;

create function bx1_portal.fund_new_operation(c jsonb,pid uuid,mid uuid,policy_id uuid,allocation uuid default null) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare m bx1_portal.fund_release_manifests; sp bx1_portal.fund_signer_policies; a bx1_portal.fund_allocations;
  b bx1_portal.fund_delivery_bindings; oid uuid:=pg_catalog.gen_random_uuid(); expiry timestamptz;
  expectation jsonb; binding text; nonce numeric; kind text; prior_supply numeric; prior_balance numeric; reconciliation_id uuid;
begin
  select * into m from bx1_portal.fund_release_manifests where id=mid and product_id=pid;
  select * into sp from bx1_portal.fund_signer_policies where id=policy_id and manifest_id=m.id;
  if m.id is null or sp.id is null or bx1_portal.fund_manifest_current(m.id) is not true
    or sp.status<>'ADMITTED' or sp.admitted_until<=pg_catalog.clock_timestamp() then
    raise exception 'fund_canonical_dependencies_not_admitted' using errcode='55000'; end if;
  expiry:=least(pg_catalog.clock_timestamp()+interval '1 hour',m.admitted_until,sp.admitted_until);
  kind:=case when allocation is null then 'DEPLOYMENT' else 'ISSUANCE' end;
  expectation:=case when allocation is null then m.deployment_expectation else m.issuance_expectation end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund_safe:'||m.execution_account,0));
  nonce:=coalesce((select max(safe_nonce)+1 from bx1_portal.fund_operations where execution_account=m.execution_account and not nonce_released),
    (expectation#>>'{manifest,safe,nonce}')::numeric);
  if nonce is null or nonce<0 then raise exception 'fund_safe_nonce_not_admitted' using errcode='55000'; end if;
  binding:=bx1_portal.fund_digest(pg_catalog.jsonb_build_object('operation',oid,'product',pid,'offering',m.offering_revision_id,
    'terms',m.terms_hash,'configuration',m.configuration_hash,'manifest',m.manifest_hash,
    'policy',sp.authority_policy_hash,'epoch',sp.authority_epoch,'allocation',allocation));
  expectation:=expectation||pg_catalog.jsonb_build_object('version',1,'kind',kind,'operation_id',oid,
    'operation_revision',1,'product_id',pid,'offering_revision_id',m.offering_revision_id,'class_id',m.class_id,
    'environment',m.environment,'chain_id',m.chain_id,'binding_hash',binding,'authority_policy_hash',sp.authority_policy_hash,
    'authority_epoch',sp.authority_epoch,'expires_at',expiry);
  expectation:=pg_catalog.jsonb_set(expectation,'{manifest,product_binding_hash}',pg_catalog.to_jsonb(m.product_binding_hash));
  expectation:=pg_catalog.jsonb_set(expectation,'{manifest,safe,nonce}',pg_catalog.to_jsonb(nonce::text));
  expectation:=pg_catalog.jsonb_set(expectation,'{safe_transaction,nonce}',pg_catalog.to_jsonb(nonce::text));
  if allocation is not null then
    select * into a from bx1_portal.fund_allocations where id=allocation and product_id=pid for update;
    select * into b from bx1_portal.fund_delivery_bindings where id=a.delivery_binding_id;
    if a.status<>'APPROVED' or bx1_portal.fund_allocation_current(a.id) is not true then
      raise exception 'fund_current_allocation_required' using errcode='23514'; end if;
    perform id from bx1_portal.product_eligibility_cases where id=a.eligibility_case_id for share;
    select coalesce(sum(units_base),0),coalesce(sum(units_base) filter(where wallet_address=b.wallet_address),0)
      into prior_supply,prior_balance from bx1_portal.fund_register_entries where product_id=a.product_id;
    select id into reconciliation_id from bx1_portal.funding_journals where obligation_id=a.obligation_id and kind='FUNDING'
      order by created_at desc,id desc limit 1;
    if reconciliation_id is null then raise exception 'fund_posted_reconciliation_evidence_required' using errcode='23514'; end if;
    expectation:=pg_catalog.jsonb_set(expectation,'{issuance}',coalesce(expectation->'issuance','{}'::jsonb)
      ||pg_catalog.jsonb_build_object('allocation_id',a.id,'subscription_id',a.subscription_id,
        'investment_account_id',a.investment_account_id,'wallet_proof_id',b.wallet_proof_id,
        'eligibility_evidence_id',a.eligibility_case_id,'reconciliation_evidence_id',reconciliation_id,
        'previous_reconciled_supply',prior_supply::text,'previous_reconciled_balance',prior_balance::text,
        'recipient',b.wallet_address,'units_base',a.units_base::text));
  end if;
  insert into bx1_portal.fund_operations(id,product_id,offering_revision_id,subscription_id,allocation_id,manifest_id,
    signer_policy_id,kind,chain_id,execution_account,binding_hash,intent_hash,authority_policy_hash,authority_epoch,expectation,safe_nonce,
    requested_by,requested_person_id,requested_context,expires_at)
    values(oid,pid,m.offering_revision_id,a.subscription_id,allocation,m.id,sp.id,kind,m.chain_id,m.execution_account,binding,
      bx1_portal.fund_digest(expectation),sp.authority_policy_hash,sp.authority_epoch,expectation,nonce,
      auth.uid(),bx1_portal.fund_person(auth.uid()),c,expiry);
  if allocation is not null then update bx1_portal.fund_allocations set status='ISSUING',revision=revision+1 where id=allocation; end if;
  return oid;
end $$;

-- One command lane, one idempotency registry and the existing atomic audit.
create function bx1_portal.fund_command(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; m bx1_portal.fund_release_manifests; sp bx1_portal.fund_signer_policies;
  o bx1_portal.fund_operations; a bx1_portal.fund_allocations; authz bx1_portal.fund_authorities;
  s bx1_portal.subscriptions; obligation bx1_portal.funding_obligations; b bx1_portal.fund_delivery_bindings;
  eligibility bx1_portal.product_eligibility_cases;
  w public.bx1_wallets; previous bx1_portal.scoped_requests; pid uuid; target uuid; before_rev integer;
begin
  if action not in ('request_fund_deployment','approve_fund_deployment','record_fund_transaction',
    'request_fund_allocation','approve_fund_allocation','request_fund_issuance','approve_fund_issuance',
    'bind_fund_delivery_wallet','cancel_fund_operation') or bx1_portal.fund_context(c,false) is not true then
    raise exception 'fund_command_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or pg_catalog.jsonb_typeof(body)<>'object'
    or pg_catalog.octet_length(body::text)>65536 then raise exception 'fund_command_invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_portal:'||auth.uid()::text,0));
  select * into previous from bx1_portal.scoped_requests where actor_id=auth.uid() and request_key=key;
  if previous.actor_id is not null then
    if previous.command<>action or previous.payload<>body or previous.operating_context<>c then
      raise exception 'fund_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.fund_read(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=auth.uid() and request_key=key) then
    raise exception 'fund_legacy_request_key_conflict' using errcode='23505'; end if;
  if action='request_fund_deployment' then
    perform bx1_portal.require_keys(body,array['product_id','expected_revision','manifest_id','signer_policy_id']);
    pid:=(body->>'product_id')::uuid;
  elsif action='bind_fund_delivery_wallet' then
    perform bx1_portal.require_keys(body,array['investment_account_id','product_id','wallet_proof_id']);
    pid:=(body->>'product_id')::uuid;
  elsif action='request_fund_allocation' then
    perform bx1_portal.require_keys(body,array['subscription_id','expected_obligation_revision']);
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid; pid:=s.product_id;
  elsif action in ('approve_fund_allocation','request_fund_issuance') then
    perform bx1_portal.require_keys(body,array['allocation_id','expected_revision']);
    select * into a from bx1_portal.fund_allocations where id=(body->>'allocation_id')::uuid; pid:=a.product_id;
  else
    perform bx1_portal.require_keys(body,case when action='record_fund_transaction' then array['operation_id','expected_revision','transaction_hash']
      when action='cancel_fund_operation' then array['operation_id','expected_revision','reason'] else array['operation_id','expected_revision'] end);
    select * into o from bx1_portal.fund_operations where id=(body->>'operation_id')::uuid; pid:=o.product_id;
  end if;
  if pid is null then raise exception 'fund_target_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,pid);
  select * into p from bx1_portal.products where id=pid;
  if action='request_fund_deployment' then
    perform bx1_portal.funding_require_revision(p.revision,body->'expected_revision');
    select * into m from bx1_portal.fund_release_manifests where id=(body->>'manifest_id')::uuid and product_id=p.id;
    select * into sp from bx1_portal.fund_signer_policies where id=(body->>'signer_policy_id')::uuid and manifest_id=m.id;
    if not bx1_portal.offering_workflow_operator(c,p.organisation_id)
      and bx1_portal.fund_authority(c,sp.id,'TokenisationAgent') is null then
      raise exception 'fund_deployment_request_scope_denied' using errcode='42501'; end if;
    target:=bx1_portal.fund_new_operation(c,p.id,m.id,sp.id,null);
  elsif action='bind_fund_delivery_wallet' then
    if c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor' then raise exception 'fund_holder_required' using errcode='42501'; end if;
    if bx1_portal.account_usable(c,(body->>'investment_account_id')::uuid) is not true then
      raise exception 'fund_account_not_current' using errcode='42501'; end if;
    select * into w from public.bx1_wallets where id=(body->>'wallet_proof_id')::uuid and user_id=auth.uid() for share;
    if w.id is null or w.chain_id<>80002 or not exists(select 1 from bx1_private.wallet_challenges q
      where q.id=w.last_proof_id and q.user_id=auth.uid() and q.used_at is not null and q.proof_signature is not null) then
      raise exception 'fund_ownership_proof_required' using errcode='23514'; end if;
    if exists(select 1 from bx1_portal.fund_allocations where investment_account_id=(body->>'investment_account_id')::uuid
      and product_id=p.id and status not in ('CANCELLED')) then raise exception 'fund_allocated_wallet_recovery_required' using errcode='23514'; end if;
    insert into bx1_portal.fund_delivery_bindings(investment_account_id,product_id,actor_id,wallet_proof_id,wallet_address,chain_id)
      values((body->>'investment_account_id')::uuid,p.id,auth.uid(),w.id,w.address,w.chain_id)
      on conflict(investment_account_id,product_id) do update set wallet_proof_id=excluded.wallet_proof_id,
        wallet_address=excluded.wallet_address,status='ACTIVE',revision=bx1_portal.fund_delivery_bindings.revision+1 returning id into target;
  elsif action='request_fund_allocation' then
    select * into s from bx1_portal.subscriptions where id=s.id for update;
    select * into obligation from bx1_portal.funding_obligations where subscription_id=s.id for update;
    perform bx1_portal.funding_require_revision(obligation.revision,body->'expected_obligation_revision');
    select * into m from bx1_portal.fund_release_manifests where product_id=p.id and offering_revision_id=s.offering_revision_id and status='ADMITTED';
    select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';
    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,'IssuerFundManager');
    select * into b from bx1_portal.fund_delivery_bindings where investment_account_id=s.investment_account_id and product_id=p.id for share;
    select * into eligibility from bx1_portal.product_eligibility_cases where investment_account_id=s.investment_account_id
      and product_id=p.id and offering_revision_id=s.offering_revision_id for share;
    if authz.id is null or bx1_portal.fund_manifest_current(m.id) is not true or obligation.currency is distinct from 'TST'
      or obligation.token_decimals<>6 or bx1_portal.funding_state(obligation.id)<>'RECONCILED'
      or bx1_portal.funding_account_current(obligation.id) is not true or bx1_portal.fund_binding_current(b.id) is not true
      or bx1_portal.product_eligibility_current(eligibility.id) is not true
      or bx1_portal.entity_people_independent(auth.uid(),s.investor_id) is not true then
      raise exception 'fund_reconciled_current_allocation_required' using errcode='23514'; end if;
    insert into bx1_portal.fund_allocations(subscription_id,obligation_id,product_id,offering_revision_id,
      investment_account_id,delivery_binding_id,eligibility_case_id,eligibility_revision,units_base,amount_base_units,evidence_set_hash,obligation_revision,
      requested_by,requested_person_id,requested_context)
      values(s.id,obligation.id,p.id,s.offering_revision_id,s.investment_account_id,b.id,eligibility.id,eligibility.revision,
        s.units*pg_catalog.power(10::numeric,m.security_unit_decimals),obligation.token_amount_base_units,
        bx1_portal.funding_evidence_hash(obligation.id),obligation.revision,auth.uid(),authz.person_id,c) returning id into target;
  elsif action in ('approve_fund_allocation','request_fund_issuance') then
    select * into a from bx1_portal.fund_allocations where id=a.id for update; before_rev:=a.revision;
    perform bx1_portal.funding_require_revision(a.revision,body->'expected_revision');
    select * into m from bx1_portal.fund_release_manifests where product_id=a.product_id and offering_revision_id=a.offering_revision_id and status='ADMITTED';
    select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';
    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,
      case when action='approve_fund_allocation' then 'TransferAgent' else 'TokenisationAgent' end);
    if authz.id is null or bx1_portal.fund_allocation_current(a.id) is not true then
      raise exception 'fund_allocation_authority_changed' using errcode='42501'; end if;
    if action='approve_fund_allocation' then
      if a.status<>'REQUESTED' or bx1_portal.entity_people_independent(auth.uid(),a.requested_by) is not true then
        raise exception 'fund_independent_allocation_approval_required' using errcode='42501'; end if;
      update bx1_portal.fund_allocations set status='APPROVED',revision=revision+1,
        approved_by=auth.uid(),approved_person_id=authz.person_id,approved_at=pg_catalog.clock_timestamp() where id=a.id;
      target:=a.id;
    else target:=bx1_portal.fund_new_operation(c,p.id,m.id,sp.id,a.id); end if;
  else
    select * into o from bx1_portal.fund_operations where id=o.id for update; before_rev:=o.revision;
    perform bx1_portal.funding_require_revision(o.revision,body->'expected_revision');
    select * into sp from bx1_portal.fund_signer_policies where id=o.signer_policy_id;
    select * into authz from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,sp.id,'TokenisationAgent');
    if authz.id is null or bx1_portal.fund_operation_current(o.id) is not true then
      raise exception 'fund_execution_authority_not_current' using errcode='42501'; end if;
    if action in ('approve_fund_deployment','approve_fund_issuance') then
      if o.state<>'APPROVAL_PENDING' or o.intent is null or o.expires_at<=pg_catalog.clock_timestamp()
        or (action='approve_fund_deployment')<>(o.kind='DEPLOYMENT') or not authz.can_approve
        or bx1_portal.entity_people_independent(auth.uid(),o.requested_by) is not true then
        raise exception 'fund_independent_intent_approval_required' using errcode='42501'; end if;
      insert into bx1_portal.fund_operation_approvals(operation_id,authority_id,actor_id,person_id,operating_context,intent_hash,authority_epoch)
        values(o.id,authz.id,auth.uid(),authz.person_id,c,o.intent_hash,o.authority_epoch);
      update bx1_portal.fund_operations set revision=revision+1,updated_at=pg_catalog.clock_timestamp(),
        state=case when (select count(*) from bx1_portal.fund_operation_approvals where operation_id=o.id)>=sp.approval_threshold then 'APPROVED' else 'APPROVAL_PENDING' end where id=o.id;
    elsif action='record_fund_transaction' then
      if o.state not in ('SIGNING','UNKNOWN','BROADCAST','REPLACED') or not authz.can_sign
        or authz.signer_address is distinct from o.expectation->>'signer_address'
        or not exists(select 1 from bx1_portal.fund_execution_claims claim where claim.operation_id=o.id and claim.actor_id=auth.uid())
        or body->>'transaction_hash' !~ '^0x[0-9a-fA-F]{64}$' then raise exception 'fund_broadcast_not_authorised' using errcode='23514'; end if;
      insert into bx1_portal.fund_transaction_attempts(operation_id,transaction_hash,submitted_by)
        values(o.id,pg_catalog.lower(body->>'transaction_hash'),auth.uid()) on conflict(operation_id,transaction_hash) do nothing;
      update bx1_portal.fund_operations set state='BROADCAST',transaction_hash=pg_catalog.lower(body->>'transaction_hash'),
        revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=o.id;
    else
      perform bx1_portal.require_text(body,'reason',20,2000);
      if o.state not in ('REQUESTED','APPROVAL_PENDING','APPROVED','SIGNING_FAILED')
        or exists(select 1 from bx1_portal.fund_safe_signatures where operation_id=o.id)
        or exists(select 1 from bx1_portal.fund_transaction_attempts where operation_id=o.id) then
        raise exception 'fund_signed_operation_requires_governed_revocation' using errcode='23514'; end if;
      update bx1_portal.fund_operations set state='CANCELLED',nonce_released=true,revision=revision+1,
        reason_code='CANCELLED_BEFORE_SIGNING',updated_at=pg_catalog.clock_timestamp() where id=o.id;
    end if;
    target:=o.id;
  end if;
  perform bx1_portal.fund_audit(p.id,target,case when action in ('request_fund_deployment','request_fund_issuance') then target else o.id end,
    action,c,before_rev,null,null,body);
  if bx1_portal.fund_context(c,false) is not true or bx1_portal.fund_product_visible(c,p.id) is not true
    or (action not in ('request_fund_deployment','bind_fund_delivery_wallet') and bx1_portal.fund_context(c,true) is not true) then
    raise exception 'fund_authority_expired_at_commit' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,command,payload,operating_context) values(auth.uid(),key,action,body,c);
  return bx1_portal.fund_read(c);
end $$;

-- Worker hash uses the adapter's canonical TS schema serialization. It is
-- deliberately distinct from fund_digest(jsonb), which protects DB/audit data.
create function bx1_portal.prepare_fund_operation(oid uuid,expected_hash text,prepared_intent jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; m bx1_portal.fund_release_manifests;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_private_worker_required' using errcode='42501'; end if;
  if expected_hash is null or prepared_intent is null or pg_catalog.jsonb_typeof(prepared_intent) is distinct from 'object'
    or not (prepared_intent ?& array['operation_id','operation_revision','kind','binding_hash','authority_policy_hash','authority_epoch',
      'chain_id','execution_account','target_address','signer_address','execution_mode','value_base_units','expires_at','intent_hash','safe_transaction','transaction_data'])
    or exists(select 1 from pg_catalog.jsonb_each(prepared_intent) item where item.value='null'::jsonb) then
    raise exception 'fund_prepared_intent_incomplete' using errcode='22023'; end if;
  select * into o from bx1_portal.fund_operations where id=oid;
  if o.id is null then raise exception 'fund_operation_missing' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||o.product_id::text,0));
  perform id from bx1_portal.products where id=o.product_id for update;
  select * into o from bx1_portal.fund_operations where id=oid for update;
  select * into m from bx1_portal.fund_release_manifests where id=o.manifest_id for share;
  if o.id is null or o.state<>'REQUESTED' or bx1_portal.fund_operation_current(o.id) is not true
    or expected_hash !~ '^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(prepared_intent)<>'object'
    or prepared_intent->>'operation_id'<>o.id::text
    or prepared_intent->>'operation_revision'<>o.expectation->>'operation_revision'
    or prepared_intent->>'kind'<>o.kind or prepared_intent->>'binding_hash'<>o.binding_hash
    or prepared_intent->>'authority_policy_hash'<>o.authority_policy_hash
    or (prepared_intent->>'authority_epoch')::integer<>o.authority_epoch
    or (prepared_intent->>'chain_id')::integer<>o.chain_id
    or prepared_intent->>'execution_account'<>m.execution_account
    or prepared_intent->>'target_address'<>m.controller_address
    or prepared_intent->>'signer_address'<>o.expectation->>'signer_address'
    or prepared_intent->>'execution_mode'<>'SAFE_TRANSACTION'
    or prepared_intent->>'value_base_units'<>'0'
    or (prepared_intent->>'expires_at')::timestamptz<>o.expires_at
    or prepared_intent->>'intent_hash' !~ '^[0-9a-f]{64}$'
    or prepared_intent#>>'{safe_transaction,nonce}'<>o.safe_nonce::text
    or prepared_intent#>>'{safe_transaction,to}'<>m.controller_address
    or prepared_intent#>>'{safe_transaction,data}'<>prepared_intent->>'transaction_data'
    or prepared_intent->>'transaction_data' !~ '^0x([0-9a-fA-F]{2})+$' then
    raise exception 'fund_prepared_intent_binding_mismatch' using errcode='23514'; end if;
  update bx1_portal.fund_operations set expectation_hash=expected_hash,intent=prepared_intent,
    intent_hash=prepared_intent->>'intent_hash',state='APPROVAL_PENDING',revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=o.id;
  perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_INTENT_PREPARED',null,o.revision,o.revision+1,null,prepared_intent);
  return bx1_portal.fund_operation_receipt(o.id);
end $$;

create function bx1_portal.fund_prepare(c jsonb,oid uuid,expected_revision integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; a bx1_portal.fund_authorities;
begin
  select * into o from bx1_portal.fund_operations where id=oid;
  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,o.product_id);
  select * into o from bx1_portal.fund_operations where id=oid for update;
  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');
  if o.revision<>expected_revision or a.id is null or not a.can_sign
    or o.state not in ('REQUESTED','APPROVED','SIGNING','BROADCAST','MINED','CONFIRMING','UNKNOWN','REPLACED')
    or (o.state in ('REQUESTED','APPROVED','SIGNING') and o.expires_at<=pg_catalog.clock_timestamp())
    or bx1_portal.fund_operation_current(o.id) is not true then raise exception 'fund_preparation_not_authorised' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('expectation',o.expectation,'operation',bx1_portal.fund_operation_projection(c,o.id),
    'signing_owner_address',a.signer_address);
end $$;

create function bx1_portal.fund_record_signature(c jsonb,oid uuid,expected_revision integer,raw_signature text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; sid uuid;
begin
  select * into o from bx1_portal.fund_operations where id=oid;
  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,o.product_id);
  select * into o from bx1_portal.fund_operations where id=oid for update;
  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');
  if o.revision<>expected_revision or a.id is null or not a.can_sign or o.state not in ('APPROVED','SIGNING')
    or o.intent is null or raw_signature !~ '^0x[0-9a-fA-F]{130}$'
    or bx1_portal.fund_operation_current(o.id) is not true or o.expires_at<=pg_catalog.clock_timestamp() then
    raise exception 'fund_signature_not_authorised' using errcode='42501'; end if;
  select id into sid from bx1_portal.fund_safe_signatures where operation_id=o.id and actor_id=auth.uid();
  if sid is not null then
    if not exists(select 1 from bx1_portal.fund_safe_signatures where id=sid and signature=raw_signature
      and intent_hash=o.intent_hash and authority_epoch=o.authority_epoch) then
      raise exception 'fund_signature_replay_conflict' using errcode='23505'; end if;
    return pg_catalog.jsonb_build_object('signature_id',sid,'operation_revision',o.revision);
  end if;
  insert into bx1_portal.fund_safe_signatures(operation_id,authority_id,actor_id,person_id,signature,intent_hash,authority_epoch)
    values(o.id,a.id,auth.uid(),a.person_id,raw_signature,o.intent_hash,o.authority_epoch) returning id into sid;
  update bx1_portal.fund_operations set state='SIGNING',revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=o.id;
  perform bx1_portal.fund_audit(o.product_id,sid,o.id,'FUND_RAW_SIGNATURE_RECEIVED',c,o.revision,o.revision+1,sid,
    pg_catalog.jsonb_build_object('signature_id',sid,'status','UNVERIFIED','intent_hash',o.intent_hash));
  return pg_catalog.jsonb_build_object('signature_id',sid,'state','UNVERIFIED','operation_revision',o.revision+1);
end $$;
create function bx1_portal.read_fund_signature_verification(signature_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_safe_signatures; o bx1_portal.fund_operations; a bx1_portal.fund_authorities;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_private_worker_required' using errcode='42501'; end if;
  select * into s from bx1_portal.fund_safe_signatures where id=signature_id;
  select * into o from bx1_portal.fund_operations where id=s.operation_id;
  select * into a from bx1_portal.fund_authorities where id=s.authority_id;
  if s.id is null or s.status not in ('UNVERIFIED','VERIFIED') or bx1_portal.fund_operation_current(o.id) is not true or bx1_portal.fund_authority_current(a.id) is not true then
    raise exception 'fund_signature_verification_not_current' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('signature_id',s.id,'expectation',o.expectation,'intent',o.intent,'signature',s.signature,
    'signing_owner_address',a.signer_address,'intent_hash',o.intent_hash,'expectation_hash',o.expectation_hash);
end $$;
create function bx1_portal.record_fund_signature_verification(signature_id uuid,observation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.fund_safe_signatures; o bx1_portal.fund_operations; a bx1_portal.fund_authorities;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_private_worker_required' using errcode='42501'; end if;
  select * into s from bx1_portal.fund_safe_signatures where id=signature_id;
  select * into o from bx1_portal.fund_operations where id=s.operation_id;
  if o.id is null then raise exception 'fund_signature_operation_missing' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||o.product_id::text,0));
  perform id from bx1_portal.products where id=o.product_id for update;
  select * into o from bx1_portal.fund_operations where id=o.id for update;
  select * into s from bx1_portal.fund_safe_signatures where id=signature_id for update;
  select * into a from bx1_portal.fund_authorities where id=s.authority_id for share;
  if s.id is null or s.status not in ('UNVERIFIED','VERIFIED') or bx1_portal.fund_operation_current(o.id) is not true
    or bx1_portal.fund_authority_current(a.id) is not true or observation->>'intent_hash' is distinct from o.intent_hash
    or observation->>'expectation_hash' is distinct from o.expectation_hash or observation->>'recovered_address' is distinct from a.signer_address
    or observation->'valid' is distinct from 'true'::jsonb then
    raise exception 'fund_signature_evidence_invalid' using errcode='23514'; end if;
  if s.status='UNVERIFIED' then
    update bx1_portal.fund_safe_signatures set status='VERIFIED',recovered_address=a.signer_address,
      verification_hash=bx1_portal.fund_digest(observation),verified_at=pg_catalog.clock_timestamp() where id=s.id;
    perform bx1_portal.fund_audit(o.product_id,s.id,o.id,'FUND_SIGNATURE_VERIFIED',null,o.revision,o.revision,s.id,observation);
  elsif s.verification_hash<>bx1_portal.fund_digest(observation) then
    raise exception 'fund_signature_verification_replay_conflict' using errcode='23505';
  end if;
  return pg_catalog.jsonb_build_object('operation',bx1_portal.fund_operation_receipt(o.id),'signature_count',
    (select count(*) from bx1_portal.fund_safe_signatures sig where sig.operation_id=o.id and sig.status='VERIFIED'
      and bx1_portal.fund_authority_current(sig.authority_id)),
    'threshold',(select safe_threshold from bx1_portal.fund_signer_policies where id=o.signer_policy_id));
end $$;
create function bx1_portal.fund_claim_execution(c jsonb,oid uuid,expected_revision integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; a bx1_portal.fund_authorities; sp bx1_portal.fund_signer_policies; signatures jsonb; n integer;
begin
  select * into o from bx1_portal.fund_operations where id=oid;
  if o.id is null then raise exception 'fund_operation_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,o.product_id);
  select * into o from bx1_portal.fund_operations where id=oid for update;
  select * into a from bx1_portal.fund_authorities where id=bx1_portal.fund_authority(c,o.signer_policy_id,'TokenisationAgent');
  select * into sp from bx1_portal.fund_signer_policies where id=o.signer_policy_id;
  if o.revision<>expected_revision or a.id is null or not a.can_sign or o.state<>'SIGNING'
    or a.signer_address<>o.expectation->>'signer_address' or bx1_portal.fund_operation_current(o.id) is not true
    or o.expires_at<=pg_catalog.clock_timestamp() then raise exception 'fund_execution_not_authorised' using errcode='42501'; end if;
  select count(*),pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_address',s.recovered_address,'signature',s.signature) order by s.recovered_address)
    into n,signatures from bx1_portal.fund_safe_signatures s
    where s.operation_id=o.id and s.status='VERIFIED' and s.intent_hash=o.intent_hash and s.authority_epoch=o.authority_epoch
      and bx1_portal.fund_authority_current(s.authority_id);
  if n<sp.safe_threshold then raise exception 'fund_verified_human_threshold_required' using errcode='23514'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signer_address',picked.recovered_address,'signature',picked.signature)
    order by picked.recovered_address) into signatures from (
      select sig.recovered_address,sig.signature from bx1_portal.fund_safe_signatures sig
      where sig.operation_id=o.id and sig.status='VERIFIED' and sig.intent_hash=o.intent_hash
        and sig.authority_epoch=o.authority_epoch and bx1_portal.fund_authority_current(sig.authority_id)
      order by sig.recovered_address limit sp.safe_threshold) picked;
  insert into bx1_portal.fund_execution_claims(operation_id,actor_id,authority_id,claimed_revision,signature_set_hash)
    values(o.id,auth.uid(),a.id,o.revision,bx1_portal.fund_digest(signatures));
  -- UNKNOWN is durable before the wallet broadcast. A lost response must not
  -- offer another spend/sign operation; it is a recovery/observation case.
  update bx1_portal.fund_operations set state='UNKNOWN',revision=revision+1,reason_code='EXECUTION_CLAIMED_OUTCOME_UNKNOWN',updated_at=pg_catalog.clock_timestamp() where id=o.id;
  perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_EXECUTION_CLAIMED',c,o.revision,o.revision+1,null,signatures);
  return pg_catalog.jsonb_build_object('expectation',o.expectation,'intent',o.intent,'signatures',signatures,
    'operation_revision',o.revision+1,'operation',bx1_portal.fund_operation_projection(c,o.id));
end $$;

create function bx1_portal.fund_stage(key text,state text,label text,description text,owner_role text,reason text,evidence uuid[]) returns jsonb
language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_build_object('key',key,'state',state,'label',label,'description',description,
    'owner_role',owner_role,'reason_code',reason,'evidence_ids',pg_catalog.to_jsonb(coalesce(evidence,array[]::uuid[])));
$$;
create function bx1_portal.fund_order_projection(c jsonb,sid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.subscriptions; o bx1_portal.funding_obligations; r bx1_portal.funding_routes;
  a bx1_portal.fund_allocations; b bx1_portal.fund_delivery_bindings; m bx1_portal.fund_release_manifests;
  sp bx1_portal.fund_signer_policies; funding jsonb; actions jsonb:='[]'::jsonb; allocation_role text;
begin
  select * into s from bx1_portal.subscriptions where id=sid;
  if s.id is null or bx1_portal.fund_order_visible(c,s.id) is not true then return null; end if;
  select * into o from bx1_portal.funding_obligations where subscription_id=s.id;
  select * into r from bx1_portal.funding_routes where id=o.route_id;
  select * into a from bx1_portal.fund_allocations where subscription_id=s.id;
  select * into b from bx1_portal.fund_delivery_bindings where investment_account_id=s.investment_account_id and product_id=s.product_id;
  select * into m from bx1_portal.fund_release_manifests where product_id=s.product_id and offering_revision_id=s.offering_revision_id and status='ADMITTED';
  select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED';
  if s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')
    and a.id is null and m.id is not null and bx1_portal.account_usable(c,s.investment_account_id)
    and (b.id is null or bx1_portal.fund_binding_current(b.id) is not true) then
    actions:=actions||coalesce((select pg_catalog.jsonb_agg(bx1_portal.fund_action('bind_fund_delivery_wallet',w.id,1,
      'Use this wallet for fund units','Investor',true,null,pg_catalog.jsonb_build_object(
        'investment_account_id',s.investment_account_id,'product_id',s.product_id,'wallet_proof_id',w.id)) order by w.verified_at desc,w.id)
      from public.bx1_wallets w join bx1_private.wallet_challenges proof on proof.id=w.last_proof_id
      where w.user_id=auth.uid() and w.organisation_id=m.native_organisation_id and w.chain_id=80002
        and proof.user_id=auth.uid() and proof.used_at is not null and proof.proof_signature is not null),'[]'::jsonb);
  end if;
  if o.currency='TST' and o.token_decimals=6 and r.denomination='TST' then
    funding:=pg_catalog.jsonb_build_object('obligation_id',o.id,'obligation_revision',o.revision,'route_id',r.id,'route_revision',r.revision,
      'currency','TST','settlement_decimals',6,'chain_id',80002,'settlement_token_address',r.token_address,
      'beneficiary_address',r.receiving_address,'required_base_units',o.token_amount_base_units::text,
      'verified_base_units',bx1_portal.funding_totals(o.id)->>'observed','posted_base_units',bx1_portal.funding_totals(o.id)->>'posted',
      'evidence_set_hash',bx1_portal.funding_evidence_hash(o.id),'state',bx1_portal.funding_state(o.id),
      'can_pay',s.investor_id=auth.uid() and bx1_portal.funding_actions(c,'OBLIGATION',o.id)?'submit_funding_reference'
        and bx1_portal.offering_technical_ready(s.offering_revision_id)
        and bx1_portal.funding_state(o.id)='AWAITING_FUNDING'
        and (not exists(select 1 from bx1_portal.fund_payment_intents where obligation_id=o.id)
          or exists(select 1 from bx1_portal.fund_payment_intents payment where payment.obligation_id=o.id
            and payment.actor_id=auth.uid() and payment.state='PREPARED' and payment.claimed_at is null
            and payment.transaction_hash is null and payment.obligation_revision=o.revision and payment.route_revision=r.revision)));
  end if;
  if a.id is null and o.id is not null then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_allocation',s.id,o.revision,
      'Prepare investor allocation','IssuerFundManager',
      bx1_portal.fund_authority(c,sp.id,'IssuerFundManager') is not null and bx1_portal.funding_state(o.id)='RECONCILED'
        and bx1_portal.fund_binding_current(b.id),'RECONCILED_PAYMENT_AND_WALLET_REQUIRED',
      pg_catalog.jsonb_build_object('subscription_id',s.id,'expected_obligation_revision',o.revision)));
  elsif a.status='REQUESTED' then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('approve_fund_allocation',a.id,a.revision,
      'Approve investor allocation','TransferAgent',bx1_portal.fund_authority(c,sp.id,'TransferAgent') is not null
        and bx1_portal.fund_allocation_current(a.id) and bx1_portal.entity_people_independent(auth.uid(),a.requested_by),
      'CURRENT_INDEPENDENT_ALLOCATION_REVIEW_REQUIRED',pg_catalog.jsonb_build_object('allocation_id',a.id,'expected_revision',a.revision)));
  elsif a.status='APPROVED' then
    actions:=actions||pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_issuance',a.id,a.revision,
      'Request unit issuance','TokenisationAgent',bx1_portal.fund_authority(c,sp.id,'TokenisationAgent') is not null
        and bx1_portal.fund_allocation_current(a.id),'CURRENT_ISSUANCE_AUTHORITY_REQUIRED',
      pg_catalog.jsonb_build_object('allocation_id',a.id,'expected_revision',a.revision)));
  end if;
  return pg_catalog.jsonb_build_object('subscription_id',s.id,'product_id',s.product_id,'investment_account_id',s.investment_account_id,
    'allocation_id',a.id,'allocation_revision',a.revision,
    'units_base',(s.units*pg_catalog.power(10::numeric,coalesce(m.security_unit_decimals,0)))::numeric(78,0)::text,
    'security_unit_decimals',coalesce(m.security_unit_decimals,0),'funding',funding,
    'delivery_wallet',case when b.id is not null then pg_catalog.jsonb_build_object('proof_id',b.wallet_proof_id,
      'address',b.wallet_address,'chain_id',b.chain_id,'effective',bx1_portal.fund_binding_current(b.id)) end,
    'issuance_operation_id',(select id from bx1_portal.fund_operations where allocation_id=a.id),'actions',actions);
end $$;

alter table bx1_portal.fund_release_manifests add constraint fund_product_binding_exact
  check(product_binding_hash=bx1_portal.fund_digest(pg_catalog.jsonb_build_object('product',product_id,
    'offering',offering_revision_id,'terms',terms_hash,'configuration',configuration_hash,
    'class',class_id,'token',expected_token_address)));

create function bx1_portal.fund_holding_projection(c jsonb,hid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare h bx1_portal.fund_holdings; r bx1_portal.fund_register_entries; m bx1_portal.fund_release_manifests;
  p bx1_portal.products; o bx1_portal.fund_operations;
begin
  select * into h from bx1_portal.fund_holdings where id=hid;
  if h.id is null or bx1_portal.fund_order_visible(c,h.subscription_id) is not true then return null; end if;
  select * into r from bx1_portal.fund_register_entries where id=h.register_entry_id;
  select * into o from bx1_portal.fund_operations where id=h.issuance_operation_id;
  select * into m from bx1_portal.fund_release_manifests where id=o.manifest_id;
  select * into p from bx1_portal.products where id=h.product_id;
  return pg_catalog.jsonb_build_object('id',h.id,'product_id',h.product_id,'investment_account_id',h.investment_account_id,
    'subscription_id',h.subscription_id,'register_entry_id',h.register_entry_id,'issuance_operation_id',h.issuance_operation_id,
    'product_name',coalesce(p.terms->>'name','Fund'),'class_name',m.class_name,'units_base',r.units_base::text,
    'security_unit_decimals',m.security_unit_decimals,'token_address',r.token_address,'wallet_address',r.wallet_address,
    'chain_id',r.chain_id,'transaction_hash',r.transaction_hash,'recorded_at',r.recorded_at,'state','RECONCILED','valuation',null);
end $$;
create function bx1_portal.fund_product_projection(c jsonb,pid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; m bx1_portal.fund_release_manifests; sp bx1_portal.fund_signer_policies;
  native_org uuid; approved boolean; prepared boolean; deployed boolean; opened boolean; n_orders integer; n_paid integer; n_issued integer;
  operations jsonb; orders jsonb; holdings jsonb; actions jsonb:='[]'::jsonb; stages jsonb; next_action jsonb;
begin
  select * into p from bx1_portal.products where id=pid;
  if p.id is null or p.terms->>'asset_type'<>'FUND' or bx1_portal.fund_product_visible(c,p.id) is not true then return null; end if;
  select * into m from bx1_portal.fund_release_manifests where product_id=p.id and offering_revision_id=p.current_offering_revision_id
    order by (status='ADMITTED') desc,created_at desc,id desc limit 1;
  select * into sp from bx1_portal.fund_signer_policies where manifest_id=m.id and status='ADMITTED' order by created_at desc,id desc limit 1;
  native_org:=coalesce(m.native_organisation_id,
    (select native_organisation_id from bx1_portal.representative_mandates where product_organisation_id=p.organisation_id and applied_at is not null limit 1),
    (select native_organisation_id from bx1_private.test_workspace_sources where product_organisation_id=p.organisation_id));
  if native_org is null then return null; end if;
  prepared:=p.current_offering_revision_id is not null;
  approved:=prepared and bx1_portal.offering_workflow_approved(p.id)
    and exists(select 1 from bx1_portal.offering_decisions i join bx1_portal.offering_decisions co on co.offering_revision_id=i.offering_revision_id
      where i.offering_revision_id=p.current_offering_revision_id and i.decision_kind='ISSUER' and co.decision_kind='COMPLIANCE'
        and bx1_private.offering_signature_decisions_current(i.offering_revision_id,i.id,co.id));
  deployed:=prepared and bx1_portal.offering_technical_ready(p.current_offering_revision_id);
  opened:=deployed and p.status='PUBLISHED' and exists(select 1 from bx1_portal.funding_routes route
    where route.product_id=p.id and route.product_revision=p.revision and route.terms_hash=p.terms_hash
      and route.denomination='TST' and route.token_decimals=6 and bx1_portal.funding_route_current(route.id));
  select count(*),count(*) filter(where bx1_portal.funding_state(o.id)='RECONCILED'),count(h.id) into n_orders,n_paid,n_issued
    from bx1_portal.subscriptions s left join bx1_portal.funding_obligations o on o.subscription_id=s.id
    left join bx1_portal.fund_holdings h on h.subscription_id=s.id where s.product_id=p.id and s.status<>'CANCELLED'
      and bx1_portal.fund_order_visible(c,s.id);
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.fund_operation_projection(c,o.id) order by o.created_at,o.id),'[]'::jsonb)
    into operations from bx1_portal.fund_operations o where o.product_id=p.id
      and (o.kind='DEPLOYMENT' or bx1_portal.fund_order_visible(c,o.subscription_id));
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.fund_order_projection(c,s.id) order by s.created_at,s.id),'[]'::jsonb)
    into orders from bx1_portal.subscriptions s where s.product_id=p.id and bx1_portal.fund_order_visible(c,s.id);
  select coalesce(pg_catalog.jsonb_agg(bx1_portal.fund_holding_projection(c,h.id) order by h.recorded_at,h.id),'[]'::jsonb)
    into holdings from bx1_portal.fund_holdings h where h.product_id=p.id and bx1_portal.fund_order_visible(c,h.subscription_id);
  if approved and not deployed and not exists(select 1 from bx1_portal.fund_operations where product_id=p.id and kind='DEPLOYMENT'
    and state not in ('CANCELLED','REJECTED','REVERTED','EXPIRED')) then
    actions:=pg_catalog.jsonb_build_array(bx1_portal.fund_action('request_fund_deployment',p.id,p.revision,
      'Request fund deployment','OfferingManager',m.id is not null and sp.id is not null
        and bx1_portal.fund_manifest_current(m.id) and (bx1_portal.offering_workflow_operator(c,p.organisation_id)
          or bx1_portal.fund_authority(c,sp.id,'TokenisationAgent') is not null),
      case when m.id is null or sp.id is null then 'CANONICAL_DEPLOYMENT_NOT_ADMITTED' end,
      case when m.id is not null and sp.id is not null then pg_catalog.jsonb_build_object('product_id',p.id,
        'expected_revision',p.revision,'manifest_id',m.id,'signer_policy_id',sp.id) end));
  end if;
  select a.value into next_action from pg_catalog.jsonb_array_elements(actions
    ||coalesce((select pg_catalog.jsonb_agg(x.value) from pg_catalog.jsonb_array_elements(operations) op
      cross join lateral pg_catalog.jsonb_array_elements(op.value->'actions') x),'[]'::jsonb)
    ||coalesce((select pg_catalog.jsonb_agg(x.value) from pg_catalog.jsonb_array_elements(orders) ord
      cross join lateral pg_catalog.jsonb_array_elements(ord.value->'actions') x),'[]'::jsonb)) a
    order by (a.value->>'can_execute')::boolean desc limit 1;
  if next_action is null then
    next_action:=bx1_portal.fund_action(null,p.id,p.revision,
      case when not prepared then 'Complete the fund details'
        when not approved then 'Complete issuer review, compliance review and signing'
        when not deployed then 'Prepare and deploy the approved fund'
        when not opened then case when p.status='PUBLISHED' then 'Approve the TST payment route' else 'Publish the ready offering' end
        when n_orders=0 then 'Invite eligible investors to subscribe'
        when n_paid<n_orders then 'Complete payment review and reconciliation'
        when n_issued<n_orders then 'Complete approved unit issuance' else 'View reconciled investor holdings' end,
      case when not prepared then 'OfferingManager' when not approved then 'IssuerFundManager'
        when not deployed then 'TokenisationAgent' when not opened then case when p.status='PUBLISHED' then 'FinancialController' else 'OfferingManager' end
        when n_orders=0 then 'Investor' when n_paid<n_orders then 'FinancialController'
        when n_issued<n_orders then 'TokenisationAgent' else 'Investor' end,false,
      case when not approved then 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED' when not deployed then 'GOVERNED_DEPLOYMENT_REQUIRED' end,null);
  end if;
  stages:=pg_catalog.jsonb_build_array(
    bx1_portal.fund_stage('PREPARATION',case when prepared then 'COMPLETE' else 'CURRENT' end,'Fund details',
      'Create the fund, investment terms and supporting documents.','OfferingManager',null,array[]::uuid[]),
    bx1_portal.fund_stage('APPROVAL',case when approved then 'COMPLETE' when prepared then 'CURRENT' else 'NOT_STARTED' end,'Review and sign',
      'The appointed issuer and compliance reviewer approve the same signed offering.','IssuerFundManager',
      case when prepared and not approved then 'CURRENT_REVIEW_AND_SIGNATURE_REQUIRED' end,
      case when prepared then array[p.current_offering_revision_id] else array[]::uuid[] end),
    bx1_portal.fund_stage('DEPLOYMENT',case when deployed then 'COMPLETE' when approved then case when m.id is null or sp.id is null then 'BLOCKED' else 'CURRENT' end else 'NOT_STARTED' end,'Deploy fund token',
      'Appointed institutional signers use MetaMask. The contract and its authority are independently verified.','TokenisationAgent',
      case when approved and not deployed and (m.id is null or sp.id is null) then 'CANONICAL_DEPLOYMENT_NOT_ADMITTED' end,
      case when m.id is not null then array[m.id] else array[]::uuid[] end),
    bx1_portal.fund_stage('OPENING',case when opened then 'COMPLETE' when deployed then 'CURRENT' else 'NOT_STARTED' end,'Open the offering',
      'Publish only after deployment readiness and the approved settlement route are established.','OfferingManager',null,array[]::uuid[]),
    bx1_portal.fund_stage('SUBSCRIPTION',case when n_orders>0 then 'COMPLETE' when opened then 'CURRENT' else 'NOT_STARTED' end,'Investor subscription',
      'An eligible investor accepts this offering and reserves units using an investment account.','Investor',null,array[]::uuid[]),
    bx1_portal.fund_stage('PAYMENT',case when n_orders>0 and n_paid=n_orders then 'COMPLETE' when n_orders>0 then 'CURRENT' else 'NOT_STARTED' end,'Pay and reconcile',
      'Actual TST payment evidence is matched by Treasury and independently posted by Finance.','FinancialController',null,array[]::uuid[]),
    bx1_portal.fund_stage('ISSUANCE',case when n_orders>0 and n_issued=n_orders then 'COMPLETE' when n_paid>n_issued then 'CURRENT' else 'NOT_STARTED' end,'Issue allocated units',
      'The issuer and transfer agent confirm the allocation and delivery wallet before governed issuance.','TokenisationAgent',null,array[]::uuid[]),
    bx1_portal.fund_stage('HOLDINGS',case when n_issued>0 then 'COMPLETE' when n_orders>0 then 'WAITING' else 'NOT_STARTED' end,'Investor holdings',
      'Ownership appears only after final token effects, the legal register and accounting reconcile.','Investor',null,array[]::uuid[]));
  return pg_catalog.jsonb_build_object('product_id',p.id,'organisation_id',p.organisation_id,'native_organisation_id',native_org,
    'product_revision',p.revision,'offering_revision_id',p.current_offering_revision_id,'class_id',m.class_id,
    'product_name',coalesce(p.terms->>'name','Fund'),'terms_hash',p.terms_hash,'configuration_hash',m.configuration_hash,
    'availability',case when m.id is not null and sp.id is not null and bx1_portal.fund_manifest_current(m.id) then 'AVAILABLE' else 'DEPENDENCY_NOT_ADMITTED' end,
    'stages',stages,'next_action',next_action,'operations',operations,'orders',orders,'holdings',holdings,'actions',actions);
end $$;
create function bx1_portal.fund_read(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare products jsonb; env text;
begin
  if bx1_portal.fund_context(c,false) is not true then raise exception 'fund_read_context_denied' using errcode='42501'; end if;
  select environment into env from bx1_portal.entry_configuration where singleton;
  select coalesce(pg_catalog.jsonb_agg(item.value order by item.created_at,item.id),'[]'::jsonb) into products from (
    select p.id,p.created_at,bx1_portal.fund_product_projection(c,p.id) as value
    from bx1_portal.products p where p.terms->>'asset_type'='FUND' and bx1_portal.fund_product_visible(c,p.id)
    order by p.created_at,p.id limit 500) item where item.value is not null;
  if bx1_portal.fund_context(c,false) is not true then raise exception 'fund_read_context_expired' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object('schema_version',1,'projection_revision',1,'actor_id',auth.uid(),'environment',env,
    'operating_context',c,'observed_at',pg_catalog.clock_timestamp(),'availability','AVAILABLE','reason_code',null,'products',products,
    'requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',receipt.request_key,'command',receipt.command)
      order by receipt.created_at,receipt.request_key) from (
        select request_key,command,created_at from bx1_portal.scoped_requests where actor_id=auth.uid() and operating_context=c
          and command in ('request_fund_deployment','approve_fund_deployment','record_fund_transaction','request_fund_allocation',
            'approve_fund_allocation','request_fund_issuance','approve_fund_issuance','bind_fund_delivery_wallet','cancel_fund_operation')
          order by created_at desc,request_key desc limit 500) receipt),'[]'::jsonb));
end $$;

-- A final outer receipt is insufficient: verifyFundTransaction proves the
-- expected Safe inner execution, controller event, exact suite/effects and
-- two independent finality sources. Only this restricted evidence writer can
-- project readiness/register/holdings. An audit failure aborts all projections.
create function bx1_portal.record_fund_observation(oid uuid,observation jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; m bx1_portal.fund_release_manifests; attempt bx1_portal.fund_transaction_attempts;
  a bx1_portal.fund_allocations; obligation bx1_portal.funding_obligations; binding bx1_portal.fund_delivery_bindings;
  obs_id uuid; register_id uuid; journal_id uuid; existing_supply numeric; existing_balance numeric; claimed_lease bx1_portal.fund_worker_leases; core_observation jsonb;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_private_worker_required' using errcode='42501'; end if;
  select * into o from bx1_portal.fund_operations where id=oid;
  if o.id is null then raise exception 'fund_operation_missing' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bx1_fund:'||o.product_id::text,0));
  perform id from bx1_portal.products where id=o.product_id for update;
  select * into o from bx1_portal.fund_operations where id=oid for update;
  select * into m from bx1_portal.fund_release_manifests where id=o.manifest_id for share;
  select * into attempt from bx1_portal.fund_transaction_attempts where operation_id=o.id and transaction_hash=observation->>'transaction_hash';
  core_observation:=observation-'verification_lease';
  if o.state='FINAL' then
    if o.transaction_hash=observation->>'transaction_hash' and exists(select 1 from bx1_portal.fund_chain_observations obs
      where obs.id=o.final_observation_id and obs.result=core_observation) then
      return bx1_portal.fund_operation_receipt(o.id);
    end if;
    raise exception 'fund_final_evidence_conflict' using errcode='23505';
  end if;
  select * into claimed_lease from bx1_portal.fund_worker_leases where operation_id=o.id for update;
  if claimed_lease.operation_id is null or claimed_lease.lease_until<=pg_catalog.clock_timestamp()
    or claimed_lease.lease_id::text is distinct from observation#>>'{verification_lease,lease_id}'
    or claimed_lease.generation::text is distinct from observation#>>'{verification_lease,generation}' then
    raise exception 'fund_observation_lease_not_current' using errcode='42501'; end if;
  if observation is null or pg_catalog.jsonb_typeof(observation) is distinct from 'object'
    or not(observation ?& array['version','status','kind','operation_id','operation_revision','expectation_hash','intent_hash',
      'binding_hash','manifest_hash','chain_id','transaction_hash','block_number','block_hash','block_timestamp','transaction_index',
      'confirmations','execution_account','token_address','controller_address','inner_execution_success','providers']) then
    raise exception 'fund_chain_evidence_incomplete' using errcode='22023'; end if;
  if o.state not in ('BROADCAST','UNKNOWN','MINED','CONFIRMING','REPLACED') or attempt.id is null
    or pg_catalog.jsonb_typeof(observation) is distinct from 'object'
    or observation->>'version' is distinct from '1' or observation->>'kind' is distinct from o.kind
    or observation->>'operation_id' is distinct from o.id::text
    or observation->>'operation_revision' is distinct from o.expectation->>'operation_revision'
    or observation->>'expectation_hash' is distinct from o.expectation_hash
    or observation->>'intent_hash' is distinct from o.intent_hash
    or observation->>'binding_hash' is distinct from o.binding_hash
    or observation->>'manifest_hash' is distinct from m.manifest_hash
    or observation->>'chain_id' is distinct from o.chain_id::text
    or observation->>'execution_account' is distinct from m.execution_account
    or observation->>'controller_address' is distinct from m.controller_address
    or observation->>'token_address' is distinct from m.expected_token_address
    or (observation->>'block_hash' ~ '^0x[0-9a-f]{64}$') is not true
    or (observation->>'block_number' ~ '^(0|[1-9][0-9]{0,77})$') is not true
    or (observation->>'confirmations' ~ '^[0-9]{1,10}$') is not true
    or (observation->>'confirmations')::integer<m.required_confirmations
    or pg_catalog.jsonb_typeof(observation->'providers') is distinct from 'array'
    or pg_catalog.jsonb_array_length(observation->'providers') is distinct from 2
    or (observation->'providers'->0->>'url') is null or (observation->'providers'->1->>'url') is null
    or (observation->'providers'->0->>'url')=(observation->'providers'->1->>'url')
    or observation->>'block_timestamp' is null
    or (observation->>'status'='FINAL' and ((observation->>'block_timestamp')::timestamptz<=o.expires_at) is not true)
    or observation->>'status' not in ('FINAL','REVERTED') then
    raise exception 'fund_chain_evidence_binding_mismatch' using errcode='23514'; end if;
  insert into bx1_portal.fund_chain_observations(operation_id,attempt_id,observation_key,expectation_hash,result)
    values(o.id,attempt.id,pg_catalog.gen_random_uuid(),o.expectation_hash,core_observation) returning id into obs_id;
  update bx1_portal.fund_worker_leases set lease_until=pg_catalog.clock_timestamp() where operation_id=o.id;
  if observation->>'status'='REVERTED' then
    update bx1_portal.fund_operations set state='REVERTED',revision=revision+1,transaction_hash=attempt.transaction_hash,
      confirmations=(observation->>'confirmations')::integer,reason_code='VERIFIED_TRANSACTION_REVERTED',updated_at=pg_catalog.clock_timestamp() where id=o.id;
    perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_OPERATION_REVERTED',null,o.revision,o.revision+1,obs_id,observation);
    return bx1_portal.fund_operation_receipt(o.id);
  end if;
  if observation->'inner_execution_success' is distinct from 'true'::jsonb
    or (observation->>'controller_log_index' ~ '^[0-9]{1,10}$') is not true then
    raise exception 'fund_successful_inner_execution_required' using errcode='23514'; end if;
  -- Retain external effects even if authority expired/revoked while pending.
  -- Do not create new legal ownership until an explicit recovery reconciles it.
  if bx1_portal.fund_operation_current(o.id) is not true then
    update bx1_portal.fund_operations set state='UNKNOWN',reason_code='FINAL_EFFECT_AUTHORITY_CHANGED_RECOVERY_REQUIRED',
      revision=revision+1,transaction_hash=attempt.transaction_hash,updated_at=pg_catalog.clock_timestamp() where id=o.id;
    perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_FINAL_EFFECT_RECOVERY_REQUIRED',null,o.revision,o.revision+1,obs_id,observation);
    return bx1_portal.fund_operation_receipt(o.id);
  end if;
  if o.kind='ISSUANCE' then
    select * into a from bx1_portal.fund_allocations where id=o.allocation_id for update;
    select * into obligation from bx1_portal.funding_obligations where id=a.obligation_id for update;
    select * into binding from bx1_portal.fund_delivery_bindings where id=a.delivery_binding_id for share;
    perform id from bx1_portal.funding_journals where obligation_id=obligation.id order by id for share;
    select coalesce(sum(units_base),0),coalesce(sum(units_base) filter(where wallet_address=binding.wallet_address),0)
      into existing_supply,existing_balance from bx1_portal.fund_register_entries where product_id=o.product_id;
    if a.status<>'ISSUING' or bx1_portal.fund_allocation_current(a.id) is not true
      or observation->>'recipient' is distinct from binding.wallet_address
      or observation->>'units_base' is distinct from a.units_base::text
      or (observation->>'token_log_index' ~ '^[0-9]{1,10}$') is not true
      or (observation->>'supply_after' ~ '^(0|[1-9][0-9]{0,77})$') is not true
      or (observation->>'balance_after' ~ '^(0|[1-9][0-9]{0,77})$') is not true
      or (observation->>'supply_after')::numeric is distinct from existing_supply+a.units_base
      or (observation->>'balance_after')::numeric is distinct from existing_balance+a.units_base
      or (o.expectation#>>'{issuance,previous_reconciled_supply}')::numeric is distinct from existing_supply
      or (o.expectation#>>'{issuance,previous_reconciled_balance}')::numeric is distinct from existing_balance
      or obligation.currency<>'TST' or obligation.token_decimals<>6
      or (bx1_portal.funding_totals(obligation.id)->>'posted')::numeric<>a.amount_base_units then
      raise exception 'fund_supply_register_money_reconciliation_failed' using errcode='23514'; end if;
    insert into bx1_portal.fund_register_entries(operation_id,subscription_id,product_id,offering_revision_id,
      investment_account_id,class_id,units_base,token_address,wallet_address,chain_id,transaction_hash,observation_id)
      values(o.id,a.subscription_id,o.product_id,o.offering_revision_id,a.investment_account_id,m.class_id,
        a.units_base,m.expected_token_address,binding.wallet_address,o.chain_id,attempt.transaction_hash,obs_id) returning id into register_id;
    insert into bx1_portal.fund_holdings(register_entry_id,issuance_operation_id,product_id,investment_account_id,subscription_id)
      values(register_id,o.id,o.product_id,a.investment_account_id,a.subscription_id);
    insert into bx1_portal.fund_recognition_journals(operation_id,obligation_id,amount_base_units,evidence_set_hash,posting_rule_version)
      values(o.id,obligation.id,a.amount_base_units,a.evidence_set_hash,'TEST_TST_ISSUED_CAPITAL_V1') returning id into journal_id;
    insert into bx1_portal.fund_recognition_lines(journal_id,line_number,account,side,amount_base_units)
      values(journal_id,1,'TEST_CUSTOMER_FUNDING_LIABILITY','DEBIT',a.amount_base_units),
        (journal_id,2,'TEST_ISSUED_FUND_CAPITAL','CREDIT',a.amount_base_units);
    update bx1_portal.fund_allocations set status='RECONCILED',revision=revision+1 where id=a.id;
  elsif observation->>'supply_after' is distinct from '0' then
    raise exception 'fund_deployment_unexpected_initial_supply' using errcode='23514';
  end if;
  update bx1_portal.fund_operations set state='FINAL',revision=revision+1,transaction_hash=attempt.transaction_hash,
    token_address=m.expected_token_address,controller_address=m.controller_address,
    confirmations=(observation->>'confirmations')::integer,final_observation_id=obs_id,reason_code=null,
    updated_at=pg_catalog.clock_timestamp() where id=o.id;
  perform bx1_portal.fund_audit(o.product_id,o.id,o.id,'FUND_OPERATION_FINAL_RECONCILED',null,o.revision,o.revision+1,obs_id,observation);
  return bx1_portal.fund_operation_receipt(o.id);
end $$;

create function bx1_portal.claim_fund_observation(oid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.fund_operations; lease bx1_portal.fund_worker_leases;
begin
  if session_user not in ('postgres','bx1_fund_execution_worker') then raise exception 'fund_private_worker_required' using errcode='42501'; end if;
  select * into o from bx1_portal.fund_operations where id=oid for update;
  if o.id is null or o.state not in ('BROADCAST','UNKNOWN','MINED','CONFIRMING','REPLACED')
    or o.transaction_hash is null or o.expectation_hash is null then raise exception 'fund_observation_not_requested' using errcode='23514'; end if;
  select * into lease from bx1_portal.fund_worker_leases where operation_id=o.id for update;
  if lease.operation_id is not null and lease.lease_until>pg_catalog.clock_timestamp() then
    raise exception 'fund_observation_already_leased' using errcode='55P03'; end if;
  insert into bx1_portal.fund_worker_leases(operation_id,lease_id,generation,worker_id,lease_until)
    values(o.id,pg_catalog.gen_random_uuid(),coalesce(lease.generation,0)+1,session_user,pg_catalog.clock_timestamp()+interval '2 minutes')
    on conflict(operation_id) do update set lease_id=excluded.lease_id,generation=excluded.generation,
      worker_id=excluded.worker_id,lease_until=excluded.lease_until returning * into lease;
  return pg_catalog.jsonb_build_object('verification_lease',pg_catalog.jsonb_build_object('lease_id',lease.lease_id,'generation',lease.generation),
    'expectation',o.expectation,'transaction_hash',o.transaction_hash);
end $$;

-- Replace ONLY the documented false readiness stub. Readiness is derived from
-- final observed deployment, current product/package/signature/policy evidence.
do $readiness_cutover$
declare body text;
begin
  select pg_catalog.btrim(p.prosrc,E' \n\r\t') into body from pg_catalog.pg_proc p
    where p.oid='bx1_portal.offering_technical_ready(uuid)'::regprocedure;
  if body<>'select false;' then raise exception 'fund_readiness_stub_source_drift' using errcode='55000'; end if;
end $readiness_cutover$;
create or replace function bx1_portal.offering_technical_ready(target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.fund_operations o
    join bx1_portal.fund_release_manifests m on m.id=o.manifest_id
    join bx1_portal.fund_signer_policies sp on sp.id=o.signer_policy_id
    join bx1_portal.fund_chain_observations obs on obs.id=o.final_observation_id and obs.operation_id=o.id
    where o.offering_revision_id=target_revision and o.kind='DEPLOYMENT' and o.state='FINAL'
      and o.token_address=m.expected_token_address and o.controller_address=m.controller_address
      and o.authority_epoch=m.authority_epoch and o.authority_epoch=sp.authority_epoch
      and o.authority_policy_hash=sp.authority_policy_hash and sp.status='ADMITTED'
      and sp.admitted_until>pg_catalog.clock_timestamp() and bx1_portal.fund_manifest_current(m.id)
      and obs.result->>'status'='FINAL' and obs.result->'inner_execution_success'='true'::jsonb
      and obs.result->>'intent_hash'=o.intent_hash and obs.result->>'expectation_hash'=o.expectation_hash
      and obs.result->>'manifest_hash'=m.manifest_hash
      and (obs.result->>'confirmations')::integer>=m.required_confirmations);
$$;

-- The former fund-template blanket publication block is replaced only for
-- this exact fund family. Property and v2 packages keep their existing gate.
do $fund_publication_cutover$
declare original text; actual text; cutpoint text:=E'  if new.terms->\'terms_version\' in (\'2\'::jsonb,\'3\'::jsonb) and new.status=\'PUBLISHED\' then\n    raise exception \'fund_v2_settlement_route_not_admitted\' using errcode=\'23514\'; end if;';
begin
  select pg_catalog.pg_get_functiondef(p.oid),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
    pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') into original,actual
    from pg_catalog.pg_proc p where p.oid='bx1_portal.guard_fund_v2_product()'::regprocedure
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
  if actual is distinct from 'cd08c997ab119293ee0cf081f50058a56073b2d0b0dc0248dc80d6fecf9da846'
    or (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,cutpoint,'')))/pg_catalog.length(cutpoint)<>1 then
    raise exception 'fund_publication_guard_source_pin_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(original,cutpoint,
    E'  if new.terms->\'terms_version\' in (\'2\'::jsonb,\'3\'::jsonb) and new.status=\'PUBLISHED\' and\n    (new.terms->>\'asset_type\' is distinct from \'FUND\' or new.terms->>\'terms_version\' is distinct from \'3\'\n      or new.terms->>\'currency\' is distinct from \'TST\' or bx1_portal.offering_technical_ready(new.current_offering_revision_id) is not true) then\n    raise exception \'fund_v2_settlement_route_not_admitted\' using errcode=\'23514\'; end if;');
end $fund_publication_cutover$;

do $fund_readiness_projection_cutover$
declare original text; actual text; cutpoint text:='is_ready:=false;';
begin
  select pg_catalog.pg_get_functiondef(p.oid),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
    pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') into original,actual
    from pg_catalog.pg_proc p where p.oid='bx1_portal.offering_workflow_package_projection_base(jsonb,uuid)'::regprocedure
      and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
  if actual is distinct from '942b5f2b4d87d6581258299a0eaf1803e8974490db717c71de568601bf690fbe'
    or (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,cutpoint,'')))/pg_catalog.length(cutpoint)<>1 then
    raise exception 'fund_readiness_projection_source_pin_changed' using errcode='55000'; end if;
  execute pg_catalog.replace(original,cutpoint,'is_ready:=bx1_portal.offering_technical_ready(r.id) is true;');
end $fund_readiness_projection_cutover$;

-- Reconnect the already guarded canonical funding engine through the current
-- outer portal dispatchers. No competing finance tables/writer or evaluation
-- permission is introduced. The source pins are the effective TEST catalog,
-- not an older base-feature file whose function has since been renamed.
do $fund_finance_dispatch_cutover$
declare item jsonb; original text; actual text; cutpoint text:=E'\nbegin\n';
begin
  for item in select value from pg_catalog.jsonb_array_elements($pins$[
    {"signature":"bx1_portal.read_scoped(jsonb)","hash":"09f2900ef555b58311daae1e1f25e99de6cb787ec77cc61237a486b195b14d42",
     "branch":"  if c->>'mode'='ROLE' and c->>'role' in ('TreasuryOperator','FinancialController')\n    and bx1_portal.fund_context(c,true) and bx1_portal.test_workspace_entitlement(c) is null\n    and exists(select 1 from bx1_portal.organisations org where bx1_portal.scoped_finance(c,org.id,c->>'role')) then\n    return bx1_portal.read_scoped_pre_entity_eligibility(c); end if;\n"},
    {"signature":"bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)","hash":"b5dfbe91a1c023997f00a4adc64d4d37909f29ebac2625dca9b8dd2859b63c2c",
     "branch":"  if action in ('propose_funding_route','approve_funding_route','revoke_funding_route','open_funding_obligation',\n    'submit_funding_reference','propose_funding_acceptance','reconcile_funding','propose_funding_exception',\n    'resolve_funding_exception','propose_funding_reversal','approve_funding_reversal','cancel_subscription')\n    and bx1_portal.funding_session() and bx1_portal.valid_operating_context(c)\n    and bx1_portal.test_workspace_entitlement(c) is null then\n    return bx1_portal.execute_scoped_pre_eligibility(c,action,key,body); end if;\n"},
    {"signature":"bx1_portal.read_scoped_pre_entity_eligibility(jsonb)","hash":"de8973ef4c775be878f833992837a3acc58387dd90763cc1cf5687cc56547fdf","branch":null}
  ]$pins$::jsonb) loop
    select pg_catalog.pg_get_functiondef(p.oid),pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.btrim(
      pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),E' \n\t'),'UTF8')),'hex') into original,actual
      from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(item->>'signature')
        and p.proowner='postgres'::regrole and p.prosecdef and p.proconfig=array['search_path=""']::text[];
    if actual is distinct from item->>'hash' then
      raise exception 'fund_finance_dispatch_source_pin_changed: %',item->>'signature' using errcode='55000'; end if;
    if item->>'branch' is not null then
      if (pg_catalog.length(original)-pg_catalog.length(pg_catalog.replace(original,cutpoint,'')))/pg_catalog.length(cutpoint)<>1 then
        raise exception 'fund_finance_dispatch_cutpoint_changed' using errcode='55000'; end if;
      execute pg_catalog.replace(original,cutpoint,cutpoint||(item->>'branch'));
    end if;
  end loop;
end $fund_finance_dispatch_cutover$;

create function bx1_portal.fund_uint256_hex(value numeric) returns text
language plpgsql immutable set search_path='' as $$
declare digits text:='0123456789abcdef'; result text:=''; n numeric:=value; digit integer;
begin
  if value<0 or value<>pg_catalog.trunc(value) or value>=pg_catalog.power(2::numeric,256) then
    raise exception 'fund_uint256_invalid' using errcode='22023'; end if;
  loop
    digit:=pg_catalog.mod(n,16)::integer;
    result:=pg_catalog.substr(digits,digit+1,1)||result;
    n:=pg_catalog.trunc(n/16);
    exit when n=0;
  end loop;
  return pg_catalog.lpad(result,64,'0');
end $$;
create function bx1_portal.fund_payment_projection(payment uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('payment_id',p.id,'subscription_id',p.subscription_id,'obligation_id',p.obligation_id,
    'obligation_revision',p.obligation_revision,'route_id',p.route_id,'route_revision',p.route_revision,'actor_id',p.actor_id,
    'payer_address',p.payer_address,'chain_id',80002,'token_address',p.token_address,'beneficiary_address',p.beneficiary_address,
    'amount_base_units',p.amount_base_units::text,'decimals',6,'currency','TST',
    'data','0xa9059cbb'||pg_catalog.lpad(pg_catalog.substr(p.beneficiary_address,3),64,'0')||bx1_portal.fund_uint256_hex(p.amount_base_units),
    'expires_at',p.expires_at,'state',p.state,'transaction_hash',p.transaction_hash)
  from bx1_portal.fund_payment_intents p where p.id=payment;
$$;
create function bx1_portal.fund_prepare_payment(c jsonb,sid uuid,expected_revision integer,payer text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s bx1_portal.subscriptions; o bx1_portal.funding_obligations; r bx1_portal.funding_routes; p bx1_portal.fund_payment_intents;
begin
  select * into s from bx1_portal.subscriptions where id=sid and investor_id=auth.uid();
  if s.id is null or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then
    raise exception 'fund_payment_holder_required' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,s.product_id);
  select * into o from bx1_portal.funding_obligations where subscription_id=s.id for update;
  select * into r from bx1_portal.funding_routes where id=o.route_id for share;
  if o.revision<>expected_revision or o.currency is distinct from 'TST' or o.token_decimals<>6 or r.denomination is distinct from 'TST'
    or r.chain_id<>80002 or bx1_portal.funding_route_current(r.id) is not true
    or bx1_portal.funding_account_current(o.id) is not true or bx1_portal.offering_technical_ready(s.offering_revision_id) is not true
    or not exists(select 1 from bx1_portal.product_eligibility_cases eligibility where eligibility.investment_account_id=s.investment_account_id
      and eligibility.product_id=s.product_id and eligibility.offering_revision_id=s.offering_revision_id
      and bx1_portal.product_eligibility_current(eligibility.id))
    or bx1_portal.funding_state(o.id)<>'AWAITING_FUNDING' or pg_catalog.lower(payer) !~ '^0x[0-9a-f]{40}$'
    or pg_catalog.lower(payer)='0x0000000000000000000000000000000000000000' then
    raise exception 'fund_payment_current_tst_obligation_required' using errcode='23514'; end if;
  select * into p from bx1_portal.fund_payment_intents where obligation_id=o.id for update;
  if p.id is not null then
    if p.state<>'PREPARED' or p.payer_address<>pg_catalog.lower(payer) or p.obligation_revision<>o.revision
      or p.route_revision<>r.revision or p.claimed_at is not null or p.transaction_hash is not null then
      raise exception 'fund_existing_payment_requires_recovery' using errcode='23514'; end if;
    if p.expires_at<=pg_catalog.clock_timestamp() then
      update bx1_portal.fund_payment_intents set expires_at=pg_catalog.clock_timestamp()+interval '5 minutes' where id=p.id;
      perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_UNSENT_PAYMENT_RENEWED',c,null,null,null,
        pg_catalog.jsonb_build_object('payment_id',p.id,'obligation_revision',o.revision,'route_revision',r.revision));
    end if;
    return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));
  end if;
  insert into bx1_portal.fund_payment_intents(subscription_id,obligation_id,obligation_revision,route_id,route_revision,
    actor_id,payer_address,token_address,beneficiary_address,amount_base_units,expires_at)
    values(s.id,o.id,o.revision,r.id,r.revision,auth.uid(),pg_catalog.lower(payer),r.token_address,r.receiving_address,
      o.token_amount_base_units,pg_catalog.clock_timestamp()+interval '5 minutes') returning * into p;
  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_PREPARED',c,null,1,null,
    pg_catalog.jsonb_build_object('subscription_id',s.id,'obligation_id',o.id,'amount_base_units',o.token_amount_base_units::text));
  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));
end $$;
create function bx1_portal.fund_submit_payment(c jsonb,payment uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.fund_payment_intents; o bx1_portal.funding_obligations; s bx1_portal.subscriptions;
begin
  select * into p from bx1_portal.fund_payment_intents where id=payment and actor_id=auth.uid();
  select * into s from bx1_portal.subscriptions where id=p.subscription_id;
  if p.id is null or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then raise exception 'fund_payment_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,s.product_id);
  select * into p from bx1_portal.fund_payment_intents where id=payment for update;
  select * into o from bx1_portal.funding_obligations where id=p.obligation_id for update;
  if p.state<>'PREPARED' or p.expires_at<=pg_catalog.clock_timestamp() or p.obligation_revision<>o.revision
    or bx1_portal.funding_account_current(o.id) is not true or bx1_portal.funding_state(o.id)<>'AWAITING_FUNDING'
    or not exists(select 1 from bx1_portal.product_eligibility_cases eligibility where eligibility.investment_account_id=s.investment_account_id
      and eligibility.product_id=s.product_id and eligibility.offering_revision_id=s.offering_revision_id
      and bx1_portal.product_eligibility_current(eligibility.id))
    or not exists(select 1 from bx1_portal.funding_routes r where r.id=p.route_id and r.revision=p.route_revision
      and r.denomination='TST' and r.token_address=p.token_address and r.receiving_address=p.beneficiary_address
      and bx1_portal.funding_route_current(r.id)) then raise exception 'fund_payment_intent_changed' using errcode='23514'; end if;
  update bx1_portal.fund_payment_intents set state='UNKNOWN',claimed_at=pg_catalog.clock_timestamp() where id=p.id;
  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_CLAIMED',c,1,2,null,
    pg_catalog.jsonb_build_object('payment_id',p.id,'state','UNKNOWN'));
  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id));
end $$;
create function bx1_portal.fund_record_payment(c jsonb,payment uuid,tx text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.fund_payment_intents; s bx1_portal.subscriptions;
begin
  select * into p from bx1_portal.fund_payment_intents where id=payment and actor_id=auth.uid();
  select * into s from bx1_portal.subscriptions where id=p.subscription_id;
  if p.id is null or pg_catalog.lower(tx) !~ '^0x[0-9a-f]{64}$' or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then
    raise exception 'fund_payment_record_denied' using errcode='42501'; end if;
  perform bx1_portal.fund_lock(c,s.product_id);
  select * into p from bx1_portal.fund_payment_intents where id=payment for update;
  if p.state='BROADCAST' and p.transaction_hash=pg_catalog.lower(tx) then
    return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id),'next_action','SUBMIT_SIGNED_FUNDING_REFERENCE'); end if;
  if p.state<>'UNKNOWN' or p.transaction_hash is not null then raise exception 'fund_payment_record_conflict' using errcode='23505'; end if;
  update bx1_portal.fund_payment_intents set state='BROADCAST',transaction_hash=pg_catalog.lower(tx) where id=p.id;
  perform bx1_portal.fund_audit(s.product_id,p.id,null,'FUND_PAYMENT_BROADCAST_RECORDED',c,2,3,null,
    pg_catalog.jsonb_build_object('payment_id',p.id,'transaction_hash',pg_catalog.lower(tx)));
  -- A hash is not a verified payment. Existing signed funding-reference,
  -- independent receipt observation, Treasury and Controller paths remain.
  return pg_catalog.jsonb_build_object('intent',bx1_portal.fund_payment_projection(p.id),'next_action','SUBMIT_SIGNED_FUNDING_REFERENCE');
end $$;

create function public.bx1_portal_fund_lifecycle_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_read(operating_context); $$;
create function public.bx1_portal_fund_lifecycle_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_command(operating_context,command,request_key,payload); $$;
create function public.bx1_portal_prepare_fund_transaction(operation_id uuid,expected_revision integer,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_prepare(operating_context,operation_id,expected_revision); $$;
create function public.bx1_portal_record_fund_signature(operation_id uuid,expected_revision integer,signature text,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_record_signature(operating_context,operation_id,expected_revision,signature); $$;
create function public.bx1_portal_claim_fund_execution(operation_id uuid,expected_revision integer,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_claim_execution(operating_context,operation_id,expected_revision); $$;
create function public.bx1_portal_prepare_fund_payment(subscription_id uuid,expected_obligation_revision integer,payer_address text,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_prepare_payment(operating_context,subscription_id,expected_obligation_revision,payer_address); $$;
create function public.bx1_portal_submit_fund_payment(payment_id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_submit_payment(operating_context,payment_id); $$;
create function public.bx1_portal_record_fund_payment(payment_id uuid,transaction_hash text,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.fund_record_payment(operating_context,payment_id,transaction_hash); $$;

create function bx1_portal.fund_mutation_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'fund_lifecycle_history_permanent' using errcode='23514'; end if;
  if TG_TABLE_NAME in ('fund_release_manifests','fund_signer_policies','fund_authorities') then
    if OLD.status='REVOKED' or (OLD.status='ADMITTED' and
      pg_catalog.to_jsonb(NEW)-'status' is distinct from pg_catalog.to_jsonb(OLD)-'status') then
      raise exception 'fund_admitted_configuration_immutable' using errcode='23514'; end if;
    if OLD.status='ADMITTED' and NEW.status<>'REVOKED' then
      raise exception 'fund_admission_requires_new_immutable_version' using errcode='23514'; end if;
  elsif TG_TABLE_NAME='fund_operations' then
    if pg_catalog.to_jsonb(NEW)-array['revision','state','intent_hash','expectation_hash','intent','transaction_hash','token_address',
      'controller_address','confirmations','reason_code','final_observation_id','updated_at','nonce_released']
      is distinct from pg_catalog.to_jsonb(OLD)-array['revision','state','intent_hash','expectation_hash','intent','transaction_hash','token_address',
        'controller_address','confirmations','reason_code','final_observation_id','updated_at','nonce_released']
      or NEW.revision<>OLD.revision+1 or OLD.state='FINAL'
      or (OLD.intent is not null and (NEW.intent,NEW.intent_hash,NEW.expectation_hash) is distinct from (OLD.intent,OLD.intent_hash,OLD.expectation_hash)) then
      raise exception 'fund_operation_intent_identity_immutable' using errcode='23514'; end if;
  elsif TG_TABLE_NAME='fund_allocations' then
    if pg_catalog.to_jsonb(NEW)-array['status','revision','approved_by','approved_person_id','approved_at']
      is distinct from pg_catalog.to_jsonb(OLD)-array['status','revision','approved_by','approved_person_id','approved_at']
      or NEW.revision<>OLD.revision+1 or OLD.status in ('CANCELLED','RECONCILED')
      or (OLD.approved_by is not null and (NEW.approved_by,NEW.approved_person_id,NEW.approved_at)
        is distinct from (OLD.approved_by,OLD.approved_person_id,OLD.approved_at)) then
      raise exception 'fund_allocation_identity_immutable' using errcode='23514'; end if;
  elsif TG_TABLE_NAME='fund_safe_signatures' then
    if pg_catalog.to_jsonb(NEW)-array['status','verification_hash','recovered_address','verified_at']
      is distinct from pg_catalog.to_jsonb(OLD)-array['status','verification_hash','recovered_address','verified_at']
      or OLD.status<>'UNVERIFIED' then raise exception 'fund_signed_history_immutable' using errcode='23514'; end if;
  elsif TG_TABLE_NAME='fund_payment_intents' then
    if pg_catalog.to_jsonb(NEW)-array['state','transaction_hash','claimed_at','expires_at']
      is distinct from pg_catalog.to_jsonb(OLD)-array['state','transaction_hash','claimed_at','expires_at']
      or OLD.state='BROADCAST' or not ((OLD.state='PREPARED' and NEW.state='UNKNOWN') or (OLD.state='UNKNOWN' and NEW.state='BROADCAST')
        or (OLD.state='PREPARED' and NEW.state='PREPARED' and OLD.claimed_at is null and NEW.claimed_at is null
          and OLD.transaction_hash is null and NEW.transaction_hash is null and NEW.expires_at>OLD.expires_at
          and NEW.expires_at<=pg_catalog.clock_timestamp()+interval '5 minutes')) then
      raise exception 'fund_payment_intent_immutable' using errcode='23514'; end if;
  end if;
  return NEW;
end $$;

-- Default-EXECUTE never leaks an evidence/admission lane. The worker starts
-- NOLOGIN and cannot select/write any table directly. Credential provision and
-- exact environment admission are separate reviewed deployment actions.
create role bx1_fund_execution_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema bx1_portal to authenticated,bx1_fund_execution_worker;
do $acl$
declare item record;
begin
  for item in select c.oid::regclass as relation,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='bx1_portal' and c.relkind='r' and pg_catalog.left(c.relname,5)='fund_'
  loop
    execute pg_catalog.format('alter table %s enable row level security',item.relation);
    execute pg_catalog.format('revoke all on table %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',item.relation);
    if item.relname in ('fund_operation_approvals','fund_transaction_attempts','fund_chain_observations','fund_register_entries',
      'fund_holdings','fund_recognition_journals','fund_recognition_lines','fund_operation_events','fund_execution_claims') then
      execute pg_catalog.format('create trigger %I before update or delete on %s for each row execute function bx1_portal.immutable_record()',item.relname||'_immutable',item.relation);
    elsif item.relname in ('fund_release_manifests','fund_signer_policies','fund_authorities','fund_operations','fund_allocations','fund_safe_signatures','fund_payment_intents') then
      execute pg_catalog.format('create trigger %I before update or delete on %s for each row execute function bx1_portal.fund_mutation_guard()',item.relname||'_guard',item.relation);
    end if;
  end loop;
  for item in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='bx1_portal' and (pg_catalog.left(p.proname,5)='fund_' or p.proname in ('prepare_fund_operation','claim_fund_observation','record_fund_observation','read_fund_signature_verification','record_fund_signature_verification')))
      or (n.nspname='public' and p.proname in ('bx1_portal_fund_lifecycle_read_scoped','bx1_portal_fund_lifecycle_command_scoped',
        'bx1_portal_prepare_fund_transaction','bx1_portal_record_fund_signature','bx1_portal_claim_fund_execution',
        'bx1_portal_prepare_fund_payment','bx1_portal_submit_fund_payment','bx1_portal_record_fund_payment'))
  loop execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,bx1_fund_execution_worker',item.signature); end loop;
end $acl$;
grant execute on function bx1_portal.fund_read(jsonb),bx1_portal.fund_command(jsonb,text,uuid,jsonb),
  bx1_portal.fund_prepare(jsonb,uuid,integer),bx1_portal.fund_record_signature(jsonb,uuid,integer,text),
  bx1_portal.fund_claim_execution(jsonb,uuid,integer),bx1_portal.fund_prepare_payment(jsonb,uuid,integer,text),
  bx1_portal.fund_submit_payment(jsonb,uuid),bx1_portal.fund_record_payment(jsonb,uuid,text),
  public.bx1_portal_fund_lifecycle_read_scoped(jsonb),public.bx1_portal_fund_lifecycle_command_scoped(text,uuid,jsonb,jsonb),
  public.bx1_portal_prepare_fund_transaction(uuid,integer,jsonb),public.bx1_portal_record_fund_signature(uuid,integer,text,jsonb),
  public.bx1_portal_claim_fund_execution(uuid,integer,jsonb),public.bx1_portal_prepare_fund_payment(uuid,integer,text,jsonb),
  public.bx1_portal_submit_fund_payment(uuid,jsonb),public.bx1_portal_record_fund_payment(uuid,text,jsonb) to authenticated;
grant execute on function bx1_portal.prepare_fund_operation(uuid,text,jsonb),bx1_portal.record_fund_observation(uuid,jsonb),
  bx1_portal.claim_fund_observation(uuid),bx1_portal.read_fund_signature_verification(uuid),bx1_portal.record_fund_signature_verification(uuid,jsonb) to bx1_fund_execution_worker;
