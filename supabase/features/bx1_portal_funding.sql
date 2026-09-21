-- P3A: additive TESTNET funding on canonical portal orders. No customer, role,
-- wallet, token, route or business-data seeds. No real-money or production gate.
alter table bx1_portal.organisation_authority_bindings drop constraint organisation_authority_bindings_role_check;
alter table bx1_portal.organisation_authority_bindings add constraint organisation_authority_bindings_role_check
  check(role in ('OfferingManager','IssuerFundManager','ComplianceOfficer','TreasuryOperator','FinancialController'));

create table bx1_portal.funding_routes (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references bx1_portal.products(id),
  organisation_id uuid not null references bx1_portal.organisations(id), product_revision integer not null check(product_revision>0),
  terms_hash text not null, revision integer not null default 1 check(revision>0),
  status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED','REVOKED')),
  chain_id integer not null default 80002 check(chain_id=80002),
  conversion_policy text not null default 'ZAR_TEST_1_TO_1_V1' check(conversion_policy='ZAR_TEST_1_TO_1_V1'),
  posting_rule_version text not null default 'TEST_TOKEN_ASSET_LIABILITY_V1' check(posting_rule_version='TEST_TOKEN_ASSET_LIABILITY_V1'),
  token_address text not null check(token_address~'^0x[0-9a-f]{40}$' and token_address<>'0x0000000000000000000000000000000000000000'),
  token_runtime_hash text not null check(token_runtime_hash~'^0x[0-9a-f]{64}$'),
  token_decimals integer not null check(token_decimals between 2 and 18),
  receiving_address text not null check(receiving_address~'^0x[0-9a-f]{40}$' and receiving_address<>'0x0000000000000000000000000000000000000000'),
  authority_reference text not null check(char_length(btrim(authority_reference)) between 20 and 2000),
  code_review_reference text not null check(char_length(btrim(code_review_reference)) between 20 and 2000),
  valid_until timestamptz not null check(isfinite(valid_until)), created_at timestamptz not null default clock_timestamp(),
  proposed_by uuid not null references auth.users(id), proposed_person uuid not null references bx1_private.persons(id), proposed_context jsonb not null,
  approved_by uuid references auth.users(id), approved_person uuid references bx1_private.persons(id), approved_at timestamptz,
  revoked_reason text, unique(id,product_id,organisation_id),
  check(approved_person is null or approved_person<>proposed_person)
);
create table bx1_portal.funding_obligations (
  id uuid primary key default gen_random_uuid(), subscription_id uuid not null unique references bx1_portal.subscriptions(id),
  investment_account_id uuid not null references bx1_portal.investment_accounts(id), investor_id uuid not null references auth.users(id),
  product_id uuid not null references bx1_portal.products(id), organisation_id uuid not null references bx1_portal.organisations(id),
  route_id uuid not null references bx1_portal.funding_routes(id), product_revision integer not null, terms_hash text not null,
  amount_minor numeric(40,0) not null check(amount_minor>0), currency text not null check(currency='ZAR_TEST'),
  token_amount_base_units numeric(78,0) not null check(token_amount_base_units>0), token_decimals integer not null check(token_decimals between 2 and 18),
  revision integer not null default 1 check(revision>0), created_at timestamptz not null default clock_timestamp(),
  unique(id,organisation_id)
);
create table bx1_portal.funding_references (
  id uuid primary key default gen_random_uuid(), obligation_id uuid not null references bx1_portal.funding_obligations(id),
  actor_id uuid not null references auth.users(id), payer_address text not null check(payer_address~'^0x[0-9a-f]{40}$'),
  transaction_hash text not null check(transaction_hash~'^0x[0-9a-f]{64}$'), log_index integer not null check(log_index>=0),
  claim_signature text not null check(claim_signature~'^0x[0-9a-fA-F]{130}$'), claim_route_revision integer not null check(claim_route_revision>0),
  revision integer not null default 1 check(revision>0),
  status text not null default 'SUBMITTED' check(status in ('SUBMITTED','VERIFIED','ACCEPTANCE_PROPOSED','POSTED','EXCEPTION_PROPOSED','REJECTED_UNPAID','UNAPPLIED')),
  created_at timestamptz not null default clock_timestamp(), unique(obligation_id,transaction_hash,log_index)
);
create table bx1_portal.funding_verification_expectations (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('ROUTE','REFERENCE')), target_id uuid not null,
  actor_id uuid not null references auth.users(id), session_id uuid not null, operating_context jsonb not null,
  trusted_claims jsonb not null, version integer not null, expected jsonb not null, expectation_hash text not null,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create table bx1_portal.funding_observations (
  id uuid primary key default gen_random_uuid(), expectation_id uuid not null unique references bx1_portal.funding_verification_expectations(id),
  route_id uuid not null references bx1_portal.funding_routes(id), reference_id uuid references bx1_portal.funding_references(id),
  status text not null check(status in ('VERIFIED','INVALID')), facts jsonb not null,
  amount_base_units numeric(78,0) check(amount_base_units>0), block_number numeric(78,0), block_hash text,
  observed_at timestamptz not null default clock_timestamp()
);
-- Unverified references cannot reserve this identity. A verified economic event
-- is claimed globally forever, independently of reversals or route changes.
create table bx1_portal.funding_receipt_claims (
  chain_id integer not null check(chain_id=80002), transaction_hash text not null, log_index integer not null,
  reference_id uuid not null unique references bx1_portal.funding_references(id),
  first_observation_id uuid not null unique references bx1_portal.funding_observations(id),
  primary key(chain_id,transaction_hash,log_index)
);
create table bx1_portal.funding_acceptances (
  id uuid primary key default gen_random_uuid(), reference_id uuid not null references bx1_portal.funding_references(id),
  kind text not null check(kind in ('ACCEPTANCE','EXCEPTION')),
  decision text check(decision in ('REJECTED_UNPAID','UNAPPLIED')), reason text,
  proposed_by uuid not null references auth.users(id), proposed_person uuid not null references bx1_private.persons(id), proposed_context jsonb not null,
  proposed_at timestamptz not null default clock_timestamp(), reference_revision integer not null,
  evidence_set_hash text not null, approved_by uuid references auth.users(id), approved_person uuid references bx1_private.persons(id),
  approved_at timestamptz, check(approved_person is null or approved_person<>proposed_person)
);
create table bx1_portal.funding_journals (
  id uuid primary key default gen_random_uuid(), obligation_id uuid not null references bx1_portal.funding_obligations(id),
  reference_id uuid not null references bx1_portal.funding_references(id), kind text not null check(kind in ('FUNDING','REVERSAL')),
  amount_base_units numeric(78,0) not null check(amount_base_units>0), token_address text not null, token_decimals integer not null,
  posting_rule_version text not null default 'TEST_TOKEN_ASSET_LIABILITY_V1' check(posting_rule_version='TEST_TOKEN_ASSET_LIABILITY_V1'),
  original_journal_id uuid unique references bx1_portal.funding_journals(id), acceptance_id uuid unique references bx1_portal.funding_acceptances(id),
  evidence_set_hash text not null, posted_by uuid not null references auth.users(id), posted_person uuid not null references bx1_private.persons(id),
  created_at timestamptz not null default clock_timestamp(), check((kind='REVERSAL')=(original_journal_id is not null))
);
create unique index funding_one_original_post on bx1_portal.funding_journals(reference_id) where kind='FUNDING';
create table bx1_portal.funding_journal_lines (
  journal_id uuid not null references bx1_portal.funding_journals(id), line_number integer not null check(line_number in (1,2)),
  account text not null check(account in ('TEST_SETTLEMENT_TOKEN_ASSET','TEST_CUSTOMER_FUNDING_LIABILITY')),
  side text not null check(side in ('DEBIT','CREDIT')), amount_base_units numeric(78,0) not null check(amount_base_units>0),
  primary key(journal_id,line_number)
);
create table bx1_portal.funding_reversals (
  id uuid primary key default gen_random_uuid(), obligation_id uuid not null references bx1_portal.funding_obligations(id),
  journal_id uuid not null unique references bx1_portal.funding_journals(id),
  status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED')), reason text not null check(char_length(btrim(reason)) between 20 and 2000),
  proposed_by uuid not null references auth.users(id), proposed_person uuid not null references bx1_private.persons(id), proposed_context jsonb not null,
  approved_by uuid references auth.users(id), approved_person uuid references bx1_private.persons(id),
  created_at timestamptz not null default clock_timestamp(), approved_at timestamptz,
  check(approved_person is null or approved_person<>proposed_person)
);
create index funding_obligation_scope on bx1_portal.funding_obligations(organisation_id,investor_id);
create index funding_reference_obligation on bx1_portal.funding_references(obligation_id);
create index funding_observation_reference on bx1_portal.funding_observations(reference_id,observed_at);

create function bx1_portal.funding_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception 'funding_history_permanent' using errcode='23514'; end if;
  if TG_TABLE_NAME='funding_routes' and to_jsonb(OLD)->>'approved_by' is not null
    and (to_jsonb(NEW)->'approved_by',to_jsonb(NEW)->'approved_person',to_jsonb(NEW)->'approved_at') is distinct from (to_jsonb(OLD)->'approved_by',to_jsonb(OLD)->'approved_person',to_jsonb(OLD)->'approved_at') then raise exception 'funding_approval_immutable' using errcode='23514'; end if;
  if TG_TABLE_NAME in ('funding_acceptances','funding_reversals') and to_jsonb(OLD)->>'approved_by' is not null then raise exception 'funding_approval_final' using errcode='23514'; end if;
  if TG_TABLE_NAME='funding_routes' and (to_jsonb(NEW)-array['revision','status','approved_by','approved_person','approved_at','revoked_reason']) is distinct from (to_jsonb(OLD)-array['revision','status','approved_by','approved_person','approved_at','revoked_reason']) then
    raise exception 'funding_route_identity_immutable' using errcode='23514';
  elsif TG_TABLE_NAME='funding_obligations' and to_jsonb(NEW)-'revision' is distinct from to_jsonb(OLD)-'revision' then
    raise exception 'funding_obligation_identity_immutable' using errcode='23514';
  elsif TG_TABLE_NAME='funding_references' and to_jsonb(NEW)-array['revision','status'] is distinct from to_jsonb(OLD)-array['revision','status'] then
    raise exception 'funding_reference_identity_immutable' using errcode='23514';
  elsif TG_TABLE_NAME='funding_acceptances' and to_jsonb(NEW)-array['approved_by','approved_person','approved_at'] is distinct from to_jsonb(OLD)-array['approved_by','approved_person','approved_at'] then
    raise exception 'funding_proposal_immutable' using errcode='23514';
  elsif TG_TABLE_NAME='funding_reversals' and to_jsonb(NEW)-array['status','approved_by','approved_person','approved_at'] is distinct from to_jsonb(OLD)-array['status','approved_by','approved_person','approved_at'] then
    raise exception 'funding_reversal_immutable' using errcode='23514';
  end if;
  return NEW;
end $$;
do $$ declare t text; begin
  foreach t in array array['funding_routes','funding_obligations','funding_references','funding_verification_expectations','funding_observations','funding_receipt_claims','funding_acceptances','funding_journals','funding_journal_lines','funding_reversals'] loop
    execute format('alter table bx1_portal.%I enable row level security',t);
    execute format('revoke all on bx1_portal.%I from public,anon,authenticated,service_role',t);
    if t in ('funding_routes','funding_obligations','funding_references','funding_acceptances','funding_reversals') then
      execute format('create trigger %I before update or delete on bx1_portal.%I for each row execute function bx1_portal.funding_guard()',t||'_guard',t);
    else
      execute format('create trigger %I before update or delete on bx1_portal.%I for each row execute function bx1_portal.immutable_record()',t||'_immutable',t);
    end if;
  end loop;
end $$;
create function bx1_portal.funding_balanced() returns trigger language plpgsql set search_path='' as $$
declare target uuid; j bx1_portal.funding_journals; n integer; net numeric;
begin
  if TG_TABLE_NAME='funding_journals' then target:=NEW.id; else target:=NEW.journal_id; end if;
  select * into j from bx1_portal.funding_journals where id=target;
  select count(*),sum(case when side='DEBIT' then amount_base_units else -amount_base_units end) into n,net from bx1_portal.funding_journal_lines where journal_id=target;
  if n<>2 or net is distinct from 0::numeric or not exists(select 1 from bx1_portal.funding_journal_lines where journal_id=target and account='TEST_SETTLEMENT_TOKEN_ASSET' and side=case when j.kind='FUNDING' then 'DEBIT' else 'CREDIT' end and amount_base_units=j.amount_base_units)
    or not exists(select 1 from bx1_portal.funding_journal_lines where journal_id=target and account='TEST_CUSTOMER_FUNDING_LIABILITY' and side=case when j.kind='FUNDING' then 'CREDIT' else 'DEBIT' end and amount_base_units=j.amount_base_units) then
    raise exception 'funding_unbalanced_journal' using errcode='23514'; end if;
  return null;
end $$;
create constraint trigger funding_entry_balanced after insert on bx1_portal.funding_journals deferrable initially deferred for each row execute function bx1_portal.funding_balanced();
create constraint trigger funding_lines_balanced after insert on bx1_portal.funding_journal_lines deferrable initially deferred for each row execute function bx1_portal.funding_balanced();

create function bx1_portal.funding_session() returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  return coalesce(bx1_portal.fresh_session() and auth.jwt()->>'iss'='https://fegnnnlseuejkrusbbkv.supabase.co/auth/v1'
    and auth.jwt()->>'role'='authenticated' and auth.jwt()->>'exp'~'^[0-9]{1,12}$'
    and (auth.jwt()->>'exp')::numeric>extract(epoch from clock_timestamp()),false);
exception when others then return false;
end $$;
create function bx1_portal.funding_person() returns uuid language sql volatile security definer set search_path='' as $$
  select p.id from bx1_private.person_principals pp join bx1_private.persons p on p.id=pp.person_id
    where pp.auth_user_id=auth.uid() and pp.status='TRUSTED' and p.status='TRUSTED' and bx1_portal.funding_session();
$$;
create function bx1_portal.funding_proposer_current(actor uuid,person uuid,c jsonb,org uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select c->>'mode'='ROLE' and exists(select 1 from bx1_private.person_principals pp join bx1_private.persons p on p.id=pp.person_id
    join public.bx1_profiles pr on pr.id=pp.auth_user_id join auth.users u on u.id=pr.id
    join public.bx1_memberships m on m.user_id=pr.id join public.bx1_organisations n on n.id=m.organisation_id
    join bx1_portal.organisation_authority_bindings b on b.native_organisation_id=m.organisation_id and b.role=m.role
    where pp.auth_user_id=actor and pp.person_id=person and pp.status='TRUSTED' and p.status='TRUSTED' and pr.status='ACTIVE'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and n.status='ACTIVE'
      and m.status='ACTIVE' and m.organisation_id=(c->>'organisationId')::uuid and m.role=c->>'role'
      and b.product_organisation_id=org and b.status='ACTIVE' and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
$$;
create function bx1_portal.scoped_finance(c jsonb,target_org uuid,required_role text default null) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.funding_session() and bx1_portal.valid_operating_context(c) and c->>'mode'='ROLE'
    and c->>'role' in ('TreasuryOperator','FinancialController') and (required_role is null or c->>'role'=required_role)
    and bx1_portal.funding_person() is not null and exists(select 1 from bx1_portal.organisation_authority_bindings b
      where b.product_organisation_id=target_org and b.native_organisation_id=(c->>'organisationId')::uuid and b.role=c->>'role'
        and b.status='ACTIVE' and b.valid_from<=clock_timestamp() and b.valid_until>clock_timestamp());
$$;
create function bx1_portal.funding_lock_proposer(actor uuid,person uuid,c jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  perform id from auth.users where id=actor for share;
  perform id from public.bx1_profiles where id=actor for share;
  perform auth_user_id from bx1_private.person_principals where auth_user_id=actor for share;
  perform id from bx1_private.persons where id=person for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=actor and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
end $$;
create function bx1_portal.funding_order_visible(c jsonb,sid uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.funding_session() and bx1_portal.valid_operating_context(c) and exists(select 1 from bx1_portal.subscriptions s
    where s.id=sid and (bx1_portal.scoped_operator(c,s.organisation_id) or bx1_portal.scoped_finance(c,s.organisation_id)
      or (s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor'))));
$$;
create function bx1_portal.funding_route_current(rid uuid) returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.funding_routes r join bx1_portal.products p on p.id=r.product_id
    where r.id=rid and r.status='APPROVED' and r.valid_until>clock_timestamp() and p.status='PUBLISHED'
      and p.revision=r.product_revision and p.terms_hash=r.terms_hash and bx1_portal.current_product_organisation(r.organisation_id));
$$;
create function bx1_portal.funding_last_observation(ref uuid) returns bx1_portal.funding_observations
language sql stable security definer set search_path='' as $$
  select o from bx1_portal.funding_observations o where o.reference_id=ref order by o.observed_at desc,o.id desc limit 1;
$$;
create function bx1_portal.funding_evidence_hash(oid uuid) returns text language sql volatile security definer set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('obligation',o.id,'revision',o.revision,'route',o.route_id,
    'references',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.revision,r.status,(bx1_portal.funding_last_observation(r.id)).id) order by r.id) from bx1_portal.funding_references r where r.obligation_id=o.id),'[]'),
    'journals',coalesce((select jsonb_agg(jsonb_build_array(j.id,j.kind,j.amount_base_units::text,j.original_journal_id) order by j.id) from bx1_portal.funding_journals j where j.obligation_id=o.id),'[]'))::text,'UTF8')),'hex')
  from bx1_portal.funding_obligations o where o.id=oid;
$$;
create function bx1_portal.funding_can_cancel(sid uuid) returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.subscriptions s where s.id=sid and s.status='AWAITING_FUNDING')
    and not exists(select 1 from bx1_portal.funding_obligations o join bx1_portal.funding_references r on r.obligation_id=o.id
      where o.subscription_id=sid and (r.status<>'REJECTED_UNPAID' or exists(select 1 from bx1_portal.funding_receipt_claims q where q.reference_id=r.id)))
    and not exists(select 1 from bx1_portal.funding_obligations o join bx1_portal.funding_journals j on j.obligation_id=o.id where o.subscription_id=sid);
$$;
create function bx1_portal.funding_account_current(oid uuid) returns boolean language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.funding_obligations o join bx1_portal.investment_accounts i on i.id=o.investment_account_id
    join bx1_portal.applications a on a.id=i.application_id join auth.users u on u.id=i.holder_user_id
    where o.id=oid and i.holder_user_id=o.investor_id and i.status='ACTIVE' and a.user_id=o.investor_id and a.persona='INVESTOR'
      and a.status='APPROVED' and a.approved_until>clock_timestamp() and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and not exists(select 1 from public.bx1_profiles p where p.id=o.investor_id and p.status<>'ACTIVE'));
$$;
create function bx1_portal.funding_totals(oid uuid) returns jsonb language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('observed',coalesce((select sum(x.amount_base_units) from bx1_portal.funding_references r
    cross join lateral bx1_portal.funding_last_observation(r.id) x where r.obligation_id=oid and x.status='VERIFIED'),0)::text,
    'posted',coalesce((select sum(case when j.kind='FUNDING' then j.amount_base_units else -j.amount_base_units end) from bx1_portal.funding_journals j where j.obligation_id=oid),0)::text);
$$;
create function bx1_portal.funding_state(oid uuid) returns text language plpgsql volatile security definer set search_path='' as $$
declare o bx1_portal.funding_obligations; t jsonb;
begin
  select * into o from bx1_portal.funding_obligations where id=oid; t:=bx1_portal.funding_totals(oid);
  if exists(select 1 from bx1_portal.funding_references where obligation_id=oid and status='UNAPPLIED') then return 'UNAPPLIED'; end if;
  if exists(select 1 from bx1_portal.subscriptions where id=o.subscription_id and status='CANCELLED') then
    if exists(select 1 from bx1_portal.funding_references where obligation_id=oid and status<>'REJECTED_UNPAID') then return 'EVIDENCE_REVIEW'; end if;
    return 'CANCELLED';
  end if;
  if exists(select 1 from bx1_portal.funding_reversals where obligation_id=oid and status='APPROVED') then return 'REVERSED'; end if;
  if (t->>'observed')::numeric>o.token_amount_base_units then return 'OVERPAID'; end if;
  if (t->>'observed')::numeric>0 and (bx1_portal.funding_route_current(o.route_id) is not true or bx1_portal.funding_account_current(oid) is not true) then return 'EVIDENCE_REVIEW'; end if;
  if (t->>'posted')::numeric=o.token_amount_base_units and not exists(select 1 from bx1_portal.funding_references where obligation_id=oid and status not in ('POSTED','REJECTED_UNPAID'))
    and not exists(select 1 from bx1_portal.funding_reversals where obligation_id=oid) then return 'RECONCILED'; end if;
  if (t->>'observed')::numeric>0 and (t->>'observed')::numeric<o.token_amount_base_units then return 'PARTIAL'; end if;
  if exists(select 1 from bx1_portal.funding_references where obligation_id=oid and status<>'REJECTED_UNPAID') then return 'EVIDENCE_REVIEW'; end if;
  return 'AWAITING_FUNDING';
end $$;

alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_p2;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_p2;
revoke all on function bx1_portal.read_scoped_p2(jsonb),bx1_portal.execute_scoped_p2(jsonb,text,uuid,jsonb) from public,anon,authenticated,service_role;

create function bx1_portal.funding_require_revision(actual integer,expected jsonb) returns void language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(expected) is distinct from 'number' or expected::text !~ '^[1-9][0-9]{0,8}$' or actual is distinct from (expected::text)::integer then
    raise exception 'funding_stale_revision' using errcode='23514'; end if;
end $$;
create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); person uuid; required_role text; pid uuid; org uuid; sid uuid; oid uuid; target uuid;
  p bx1_portal.products; s bx1_portal.subscriptions; r bx1_portal.funding_routes; o bx1_portal.funding_obligations;
  f bx1_portal.funding_references; obs bx1_portal.funding_observations; a bx1_portal.funding_acceptances;
  j bx1_portal.funding_journals; v bx1_portal.funding_reversals; previous bx1_portal.scoped_requests;
  new_id uuid; evidence_hash text; result jsonb; approval_action boolean:=false;
begin
  if action not in ('propose_funding_route','approve_funding_route','revoke_funding_route','open_funding_obligation','submit_funding_reference','propose_funding_acceptance','reconcile_funding','propose_funding_exception','resolve_funding_exception','propose_funding_reversal','approve_funding_reversal','cancel_subscription') then
    return bx1_portal.execute_scoped_p2(c,action,key,body); end if;
  if action='cancel_subscription' then
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid and investor_id=actor;
    if s.id is not null then
      -- Always lock before looking for an obligation: opening may be in flight.
      perform bx1_portal.funding_lock(c,s.organisation_id,s.product_id,s.id,null);
      select * into s from bx1_portal.subscriptions where id=s.id;
      select * into o from bx1_portal.funding_obligations where subscription_id=s.id for update;
      if o.id is not null then perform id from bx1_portal.funding_references where obligation_id=o.id order by id for update; end if;
      if s.status='AWAITING_FUNDING' and bx1_portal.funding_can_cancel(s.id) is not true then raise exception 'funding_reference_prevents_cancellation' using errcode='23514'; end if;
    end if;
    result:=bx1_portal.execute_scoped_p2(c,action,key,body);
    if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_cancellation_authority_expired' using errcode='42501'; end if;
    return result;
  end if;
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_context_denied' using errcode='42501'; end if;
  if key is null or key='00000000-0000-0000-0000-000000000000' or jsonb_typeof(body) is distinct from 'object' or octet_length(body::text)>65536 then raise exception 'funding_invalid_command' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bx1_portal:'||actor::text,0));
  select * into previous from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if found then
    if previous.operating_context is distinct from c or previous.command is distinct from action or previous.payload is distinct from body then raise exception 'funding_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key) then raise exception 'funding_legacy_key_conflict' using errcode='23505'; end if;
  required_role:=case when action in ('approve_funding_route','reconcile_funding','resolve_funding_exception','approve_funding_reversal') then 'FinancialController'
    when action in ('propose_funding_route','revoke_funding_route','propose_funding_acceptance','propose_funding_exception','propose_funding_reversal') then 'TreasuryOperator' end;
  if action='propose_funding_route' then
    perform bx1_portal.require_keys(body,array['product_id','expected_revision','token_address','token_runtime_hash','token_decimals','receiving_address','authority_reference','code_review_reference','valid_until','standard_immutable_token_acknowledged','synthetic_conversion_acknowledged']);
    pid:=(body->>'product_id')::uuid;
  elsif action in ('approve_funding_route','revoke_funding_route') then
    if action='approve_funding_route' then perform bx1_portal.require_keys(body,array['route_id','expected_revision']);
    else perform bx1_portal.require_keys(body,array['route_id','expected_revision','reason']); perform bx1_portal.require_text(body,'reason',20,2000); end if;
    select * into r from bx1_portal.funding_routes where id=(body->>'route_id')::uuid; pid:=r.product_id;
  elsif action='open_funding_obligation' then
    perform bx1_portal.require_keys(body,array['subscription_id','route_id']);
    select * into s from bx1_portal.subscriptions where id=(body->>'subscription_id')::uuid; sid:=s.id; pid:=s.product_id;
    select * into r from bx1_portal.funding_routes where id=(body->>'route_id')::uuid;
  elsif action='submit_funding_reference' then
    perform bx1_portal.require_keys(body,array['obligation_id','expected_revision','expected_route_revision','payer_address','transaction_hash','log_index','signature']);
    oid:=(body->>'obligation_id')::uuid;
  elsif action in ('propose_funding_acceptance','reconcile_funding','propose_funding_exception','resolve_funding_exception') then
    if action='reconcile_funding' then perform bx1_portal.require_keys(body,array['reference_id','expected_revision','expected_obligation_revision','evidence_set_hash']);
    elsif action='propose_funding_exception' then perform bx1_portal.require_keys(body,array['reference_id','expected_revision','expected_obligation_revision','decision','reason']); perform bx1_portal.require_text(body,'reason',20,2000);
    else perform bx1_portal.require_keys(body,array['reference_id','expected_revision','expected_obligation_revision']); end if;
    select * into f from bx1_portal.funding_references where id=(body->>'reference_id')::uuid; oid:=f.obligation_id;
  elsif action='propose_funding_reversal' then
    perform bx1_portal.require_keys(body,array['journal_id','expected_obligation_revision','reason']); perform bx1_portal.require_text(body,'reason',20,2000);
    select * into j from bx1_portal.funding_journals where id=(body->>'journal_id')::uuid; oid:=j.obligation_id;
  else
    perform bx1_portal.require_keys(body,array['reversal_id','expected_obligation_revision']);
    select * into v from bx1_portal.funding_reversals where id=(body->>'reversal_id')::uuid; oid:=v.obligation_id;
  end if;
  if oid is not null then select * into o from bx1_portal.funding_obligations where id=oid; pid:=o.product_id; sid:=o.subscription_id; end if;
  select * into p from bx1_portal.products where id=pid; org:=p.organisation_id;
  if org is null then raise exception 'funding_target_denied' using errcode='42501'; end if;
  if required_role is not null then
    if bx1_portal.scoped_finance(c,org,required_role) is not true then raise exception 'funding_scope_denied' using errcode='42501'; end if;
  elsif action='submit_funding_reference' then
    if o.investor_id is distinct from actor or (c->>'mode'<>'APPLICANT' and c->>'role'<>'Investor') then raise exception 'funding_payer_required' using errcode='42501'; end if;
  elsif not (s.investor_id=actor and (c->>'mode'='APPLICANT' or c->>'role'='Investor')) and bx1_portal.scoped_finance(c,org,'TreasuryOperator') is not true then raise exception 'funding_order_denied' using errcode='42501'; end if;
  perform bx1_portal.funding_lock(c,org,pid,sid,oid);
  person:=bx1_portal.funding_person();
  if required_role is not null and bx1_portal.scoped_finance(c,org,required_role) is not true then raise exception 'funding_scope_expired' using errcode='42501'; end if;
  select * into p from bx1_portal.products where id=pid;
  if sid is not null then select * into s from bx1_portal.subscriptions where id=sid; end if;
  if oid is not null then select * into o from bx1_portal.funding_obligations where id=oid; end if;
  if r.id is not null then select * into r from bx1_portal.funding_routes where id=r.id for update; end if;
  if f.id is not null then select * into f from bx1_portal.funding_references where id=f.id; end if;
  if v.id is not null then select * into v from bx1_portal.funding_reversals where id=v.id for update; end if;
  if action='propose_funding_route' then
    perform bx1_portal.funding_require_revision(p.revision,body->'expected_revision');
    if p.status<>'PUBLISHED' or not bx1_portal.current_product_organisation(org) or body->'standard_immutable_token_acknowledged' is distinct from 'true'::jsonb
      or body->'synthetic_conversion_acknowledged' is distinct from 'true'::jsonb or jsonb_typeof(body->'token_decimals') is distinct from 'number'
      or body->>'token_decimals' !~ '^(2|3|4|5|6|7|8|9|1[0-8])$' or (body->>'valid_until')::timestamptz<=clock_timestamp()
      or (body->>'valid_until')::timestamptz>clock_timestamp()+interval '30 days' then raise exception 'funding_route_invalid' using errcode='23514'; end if;
    insert into bx1_portal.funding_routes(product_id,organisation_id,product_revision,terms_hash,token_address,token_runtime_hash,token_decimals,receiving_address,authority_reference,code_review_reference,valid_until,proposed_by,proposed_person,proposed_context)
      values(p.id,org,p.revision,p.terms_hash,lower(body->>'token_address'),lower(body->>'token_runtime_hash'),(body->>'token_decimals')::integer,lower(body->>'receiving_address'),body->>'authority_reference',body->>'code_review_reference',(body->>'valid_until')::timestamptz,actor,person,c) returning id into target;
  elsif action='approve_funding_route' then
    perform bx1_portal.funding_require_revision(r.revision,body->'expected_revision');
    perform bx1_portal.funding_lock_proposer(r.proposed_by,r.proposed_person,r.proposed_context);
    if not(bx1_portal.funding_actions(c,'ROUTE',r.id)?action) or not bx1_portal.funding_proposer_current(r.proposed_by,r.proposed_person,r.proposed_context,org)
      or p.revision<>r.product_revision or p.terms_hash<>r.terms_hash or p.status<>'PUBLISHED' then raise exception 'funding_route_approval_denied' using errcode='42501'; end if;
    update bx1_portal.funding_routes set status='APPROVED',revision=revision+1,approved_by=actor,approved_person=person,approved_at=clock_timestamp() where id=r.id; target:=r.id;
  elsif action='revoke_funding_route' then
    perform bx1_portal.funding_require_revision(r.revision,body->'expected_revision');
    if r.status='REVOKED' then raise exception 'funding_route_already_revoked' using errcode='23514'; end if;
    update bx1_portal.funding_routes set status='REVOKED',revision=revision+1,revoked_reason=body->>'reason' where id=r.id; target:=r.id;
  elsif action='open_funding_obligation' then
    if s.status<>'AWAITING_FUNDING' or s.investment_account_id is null or r.product_id is distinct from s.product_id or r.product_revision is distinct from s.product_revision
      or r.terms_hash is distinct from s.terms_hash or not bx1_portal.funding_route_current(r.id) then raise exception 'funding_route_unavailable' using errcode='23514'; end if;
    insert into bx1_portal.funding_obligations(subscription_id,investment_account_id,investor_id,product_id,organisation_id,route_id,product_revision,terms_hash,amount_minor,currency,token_amount_base_units,token_decimals)
      values(s.id,s.investment_account_id,s.investor_id,s.product_id,s.organisation_id,r.id,s.product_revision,s.terms_hash,s.amount_minor,s.accepted_terms->>'currency',s.amount_minor*power(10::numeric,r.token_decimals-2),r.token_decimals) returning * into o;
    perform bx1_portal.funding_lock(c,org,pid,s.id,o.id);
    if not bx1_portal.funding_account_current(o.id) then raise exception 'funding_account_denied' using errcode='42501'; end if; target:=o.id; oid:=o.id;
  elsif action='submit_funding_reference' then
    perform bx1_portal.funding_require_revision(o.revision,body->'expected_revision');
    select * into r from bx1_portal.funding_routes where id=o.route_id for update;
    perform bx1_portal.funding_require_revision(r.revision,body->'expected_route_revision');
    if not(bx1_portal.funding_actions(c,'OBLIGATION',o.id)?action) or jsonb_typeof(body->'log_index') is distinct from 'number'
      or body->>'log_index' !~ '^[0-9]{1,10}$' then raise exception 'funding_reference_denied' using errcode='23514'; end if;
    insert into bx1_portal.funding_references(obligation_id,actor_id,payer_address,transaction_hash,log_index,claim_signature,claim_route_revision)
      values(o.id,actor,lower(body->>'payer_address'),lower(body->>'transaction_hash'),(body->>'log_index')::integer,body->>'signature',r.revision) returning id into target;
    update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;
  elsif action in ('propose_funding_acceptance','reconcile_funding','propose_funding_exception','resolve_funding_exception') then
    perform bx1_portal.funding_require_revision(f.revision,body->'expected_revision'); perform bx1_portal.funding_require_revision(o.revision,body->'expected_obligation_revision');
    if not(bx1_portal.funding_actions(c,'REFERENCE',f.id)?action) then raise exception 'funding_transition_denied' using errcode='42501'; end if;
    obs:=bx1_portal.funding_last_observation(f.id);
    if action in ('propose_funding_acceptance','propose_funding_exception') then
      if action='propose_funding_exception' then
        if coalesce(body->>'decision','') not in ('REJECTED_UNPAID','UNAPPLIED') then raise exception 'funding_exception_invalid' using errcode='22023'; end if;
        if body->>'decision'='REJECTED_UNPAID' and (obs.status is distinct from 'INVALID' or obs.facts->>'reason_code' is distinct from 'RECEIPT_REVERTED'
          or exists(select 1 from bx1_portal.funding_receipt_claims where reference_id=f.id)) then raise exception 'funding_not_conclusively_unpaid' using errcode='23514'; end if;
      end if;
      update bx1_portal.funding_references set revision=revision+1,status=case when action='propose_funding_acceptance' then 'ACCEPTANCE_PROPOSED' else 'EXCEPTION_PROPOSED' end where id=f.id returning * into f;
      update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;
      insert into bx1_portal.funding_acceptances(reference_id,kind,decision,reason,proposed_by,proposed_person,proposed_context,reference_revision,evidence_set_hash)
        values(f.id,case when action='propose_funding_acceptance' then 'ACCEPTANCE' else 'EXCEPTION' end,body->>'decision',body->>'reason',actor,person,c,f.revision,bx1_portal.funding_evidence_hash(o.id));
    else
      select * into a from bx1_portal.funding_acceptances where reference_id=f.id and reference_revision=f.revision and approved_by is null order by proposed_at desc,id desc limit 1 for update;
      perform bx1_portal.funding_lock_proposer(a.proposed_by,a.proposed_person,a.proposed_context);
      evidence_hash:=bx1_portal.funding_evidence_hash(o.id);
      if a.id is null or a.evidence_set_hash is distinct from evidence_hash or bx1_portal.funding_proposer_current(a.proposed_by,a.proposed_person,a.proposed_context,org) is not true
        or a.proposed_person=person or not bx1_portal.independent_of(o.investor_id) then raise exception 'funding_independent_current_approval_required' using errcode='42501'; end if;
      if action='reconcile_funding' then
        if body->>'evidence_set_hash' is distinct from evidence_hash or a.kind<>'ACCEPTANCE' or obs.status<>'VERIFIED' or obs.observed_at<=clock_timestamp()-interval '5 minutes'
          or not bx1_portal.funding_route_current(o.route_id) or not bx1_portal.funding_account_current(o.id)
          or not exists(select 1 from bx1_portal.funding_receipt_claims where reference_id=f.id) then raise exception 'funding_evidence_changed' using errcode='23514'; end if;
        select * into r from bx1_portal.funding_routes where id=o.route_id;
        insert into bx1_portal.funding_journals(obligation_id,reference_id,kind,amount_base_units,token_address,token_decimals,acceptance_id,evidence_set_hash,posted_by,posted_person)
          values(o.id,f.id,'FUNDING',obs.amount_base_units,r.token_address,r.token_decimals,a.id,evidence_hash,actor,person) returning id into new_id;
        insert into bx1_portal.funding_journal_lines values(new_id,1,'TEST_SETTLEMENT_TOKEN_ASSET','DEBIT',obs.amount_base_units),(new_id,2,'TEST_CUSTOMER_FUNDING_LIABILITY','CREDIT',obs.amount_base_units);
        update bx1_portal.funding_references set status='POSTED',revision=revision+1 where id=f.id;
      else
        if a.kind<>'EXCEPTION' then raise exception 'funding_exception_required' using errcode='23514'; end if;
        if a.decision='REJECTED_UNPAID' and (obs.status is distinct from 'INVALID' or obs.facts->>'reason_code' is distinct from 'RECEIPT_REVERTED'
          or exists(select 1 from bx1_portal.funding_receipt_claims where reference_id=f.id)) then raise exception 'funding_not_conclusively_unpaid' using errcode='23514'; end if;
        update bx1_portal.funding_references set status=a.decision,revision=revision+1 where id=f.id;
      end if;
      update bx1_portal.funding_acceptances set approved_by=actor,approved_person=person,approved_at=clock_timestamp() where id=a.id;
      update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;
      approval_action:=true;
    end if;
    target:=f.id;
  elsif action='propose_funding_reversal' then
    perform bx1_portal.funding_require_revision(o.revision,body->'expected_obligation_revision');
    if not(bx1_portal.funding_actions(c,'JOURNAL',j.id)?action) then raise exception 'funding_reversal_denied' using errcode='42501'; end if;
    insert into bx1_portal.funding_reversals(obligation_id,journal_id,reason,proposed_by,proposed_person,proposed_context) values(o.id,j.id,body->>'reason',actor,person,c) returning id into target;
    update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;
  elsif action='approve_funding_reversal' then
    perform bx1_portal.funding_require_revision(o.revision,body->'expected_obligation_revision');
    perform bx1_portal.funding_lock_proposer(v.proposed_by,v.proposed_person,v.proposed_context);
    if not(bx1_portal.funding_actions(c,'REVERSAL',v.id)?action) or not bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,org) then raise exception 'funding_reversal_denied' using errcode='42501'; end if;
    select * into j from bx1_portal.funding_journals where id=v.journal_id;
    insert into bx1_portal.funding_journals(obligation_id,reference_id,kind,amount_base_units,token_address,token_decimals,original_journal_id,evidence_set_hash,posted_by,posted_person)
      values(o.id,j.reference_id,'REVERSAL',j.amount_base_units,j.token_address,j.token_decimals,j.id,bx1_portal.funding_evidence_hash(o.id),actor,person) returning id into new_id;
    insert into bx1_portal.funding_journal_lines values(new_id,1,'TEST_SETTLEMENT_TOKEN_ASSET','CREDIT',j.amount_base_units),(new_id,2,'TEST_CUSTOMER_FUNDING_LIABILITY','DEBIT',j.amount_base_units);
    update bx1_portal.funding_reversals set status='APPROVED',approved_by=actor,approved_person=person,approved_at=clock_timestamp() where id=v.id;
    update bx1_portal.funding_obligations set revision=revision+1 where id=o.id; target:=v.id;
  end if;
  insert into bx1_portal.events(subject_id,organisation_id,investor_id,kind,actor_id,summary)
    values(target,org,o.investor_id,action,actor,'TESTNET funding control: '||action||'. Test-token evidence only; no bank cash, issued holding or refund.');
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true or (required_role is not null and bx1_portal.scoped_finance(c,org,required_role) is not true) then raise exception 'funding_authority_expired' using errcode='42501'; end if;
  if action in ('open_funding_obligation','propose_funding_acceptance','reconcile_funding') and (not bx1_portal.funding_route_current(o.route_id) or not bx1_portal.funding_account_current(o.id)) then raise exception 'funding_policy_expired' using errcode='42501'; end if;
  if action='approve_funding_route' and (bx1_portal.funding_route_current(r.id) is not true or bx1_portal.funding_proposer_current(r.proposed_by,r.proposed_person,r.proposed_context,org) is not true) then raise exception 'funding_route_approval_expired' using errcode='42501'; end if;
  if action in ('propose_funding_acceptance','reconcile_funding') and obs.observed_at<=clock_timestamp()-interval '5 minutes' then raise exception 'funding_evidence_expired' using errcode='42501'; end if;
  if approval_action and bx1_portal.funding_proposer_current(a.proposed_by,a.proposed_person,a.proposed_context,org) is not true then raise exception 'funding_proposer_expired' using errcode='42501'; end if;
  if action='approve_funding_reversal' and bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,org) is not true then raise exception 'funding_proposer_expired' using errcode='42501'; end if;
  insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload) values(actor,key,c,action,body);
  result:=bx1_portal.read_scoped(c);
  if bx1_portal.funding_session() is not true then raise exception 'funding_session_expired' using errcode='42501'; end if;
  return result;
end $$;
-- Match canonical ordering across investor, finance and service verifier writes.
create function bx1_portal.funding_lock(c jsonb,org uuid,pid uuid,sid uuid default null,oid uuid default null) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_context_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bx1_portal:'||auth.uid()::text,0));
  perform id from auth.users where id=auth.uid() for share;
  perform id from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' for share;
  perform id from public.bx1_profiles where id=auth.uid() for share;
  if c->>'mode'='ROLE' then
    perform id from public.bx1_organisations where id=(c->>'organisationId')::uuid for share;
    perform id from public.bx1_memberships where user_id=auth.uid() and organisation_id=(c->>'organisationId')::uuid and role=c->>'role' for share;
  end if;
  perform auth_user_id from bx1_private.person_principals where auth_user_id=auth.uid() for share;
  perform id from bx1_private.persons where id=(select person_id from bx1_private.person_principals where auth_user_id=auth.uid()) for share;
  perform id from bx1_portal.organisations where id=org for share;
  perform a.id from bx1_portal.applications a join bx1_portal.organisations x on x.application_id=a.id where x.id=org for share of a;
  perform id from bx1_portal.organisation_authority_bindings where product_organisation_id=org order by id for share;
  perform id from bx1_portal.products where id=pid for update;
  if sid is not null then perform id from bx1_portal.subscriptions where id=sid for update; end if;
  if oid is not null then
    perform id from bx1_portal.funding_obligations where id=oid for update;
    perform id from bx1_portal.funding_references where obligation_id=oid order by id for update;
    perform i.id from bx1_portal.investment_accounts i join bx1_portal.funding_obligations o on o.investment_account_id=i.id where o.id=oid for share of i;
    perform a.id from bx1_portal.applications a join bx1_portal.investment_accounts i on i.application_id=a.id join bx1_portal.funding_obligations o on o.investment_account_id=i.id where o.id=oid for share of a;
    perform u.id from auth.users u join bx1_portal.funding_obligations o on o.investor_id=u.id where o.id=oid for share of u;
    perform p.id from public.bx1_profiles p join bx1_portal.funding_obligations o on o.investor_id=p.id where o.id=oid for share of p;
    perform pp.auth_user_id from bx1_private.person_principals pp join bx1_portal.funding_obligations o on o.investor_id=pp.auth_user_id where o.id=oid for share of pp;
  end if;
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_context_expired' using errcode='42501'; end if;
end $$;
create function bx1_portal.funding_actions(c jsonb,kind text,target uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb:='[]'; r bx1_portal.funding_routes; o bx1_portal.funding_obligations; f bx1_portal.funding_references;
  j bx1_portal.funding_journals; v bx1_portal.funding_reversals; a bx1_portal.funding_acceptances; obs bx1_portal.funding_observations;
  treasury boolean; controller boolean;
begin
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then return result; end if;
  if kind='ROUTE' then
    select * into r from bx1_portal.funding_routes where id=target;
    treasury:=bx1_portal.scoped_finance(c,r.organisation_id,'TreasuryOperator'); controller:=bx1_portal.scoped_finance(c,r.organisation_id,'FinancialController');
    if treasury or controller then result:=result||'"verify_funding_route"'::jsonb; end if;
    if treasury and r.status<>'REVOKED' then result:=result||'"revoke_funding_route"'::jsonb; end if;
    if controller and r.status='PROPOSED' and r.valid_until>clock_timestamp() and r.proposed_person<>bx1_portal.funding_person()
      and bx1_portal.funding_proposer_current(r.proposed_by,r.proposed_person,r.proposed_context,r.organisation_id)
      and exists(select 1 from bx1_portal.products p where p.id=r.product_id and p.status='PUBLISHED' and p.revision=r.product_revision and p.terms_hash=r.terms_hash)
      and bx1_portal.current_product_organisation(r.organisation_id)
      and exists(select 1 from bx1_portal.funding_observations x where x.route_id=r.id and x.reference_id is null and x.status='VERIFIED' and x.observed_at>clock_timestamp()-interval '5 minutes') then result:=result||'"approve_funding_route"'::jsonb; end if;
  elsif kind='OBLIGATION' then
    select * into o from bx1_portal.funding_obligations where id=target;
    -- Reporting an existing transfer is not an instruction to pay. Retain late,
    -- cancelled, revoked-route and excess-payment evidence for exception review.
    if o.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor') and bx1_portal.funding_order_visible(c,o.subscription_id)
      then result:=result||'"submit_funding_reference"'::jsonb; end if;
  elsif kind='REFERENCE' then
    select * into f from bx1_portal.funding_references where id=target; select * into o from bx1_portal.funding_obligations where id=f.obligation_id;
    treasury:=bx1_portal.scoped_finance(c,o.organisation_id,'TreasuryOperator'); controller:=bx1_portal.scoped_finance(c,o.organisation_id,'FinancialController');
    if treasury or controller or (o.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')) then result:=result||'"verify_funding_reference"'::jsonb; end if;
    obs:=bx1_portal.funding_last_observation(f.id);
    if treasury and f.status='VERIFIED' and obs.status='VERIFIED' and obs.observed_at>clock_timestamp()-interval '5 minutes'
      and bx1_portal.funding_route_current(o.route_id) and bx1_portal.funding_account_current(o.id) and bx1_portal.funding_state(o.id) not in ('REVERSED','UNAPPLIED','CANCELLED') then result:=result||'"propose_funding_acceptance"'::jsonb; end if;
    if treasury and f.status in ('SUBMITTED','VERIFIED','UNAPPLIED') then result:=result||'"propose_funding_exception"'::jsonb; end if;
    select * into a from bx1_portal.funding_acceptances where reference_id=f.id and approved_by is null and reference_revision=f.revision order by proposed_at desc,id desc limit 1;
    if controller and a.proposed_person<>bx1_portal.funding_person() and a.evidence_set_hash=bx1_portal.funding_evidence_hash(o.id)
      and bx1_portal.funding_proposer_current(a.proposed_by,a.proposed_person,a.proposed_context,o.organisation_id) and bx1_portal.independent_of(o.investor_id) then
      if f.status='ACCEPTANCE_PROPOSED' and obs.status='VERIFIED' and obs.observed_at>clock_timestamp()-interval '5 minutes' and bx1_portal.funding_route_current(o.route_id) and bx1_portal.funding_account_current(o.id) then result:=result||'"reconcile_funding"'::jsonb;
      elsif f.status='EXCEPTION_PROPOSED' then result:=result||'"resolve_funding_exception"'::jsonb; end if;
    end if;
  elsif kind='JOURNAL' then
    select * into j from bx1_portal.funding_journals where id=target; select * into o from bx1_portal.funding_obligations where id=j.obligation_id;
    if bx1_portal.scoped_finance(c,o.organisation_id,'TreasuryOperator') and j.kind='FUNDING' and not exists(select 1 from bx1_portal.funding_reversals where journal_id=j.id) then result:=result||'"propose_funding_reversal"'::jsonb; end if;
  elsif kind='REVERSAL' then
    select * into v from bx1_portal.funding_reversals where id=target; select * into o from bx1_portal.funding_obligations where id=v.obligation_id;
    if bx1_portal.scoped_finance(c,o.organisation_id,'FinancialController') and v.status='PROPOSED' and v.proposed_person<>bx1_portal.funding_person()
      and bx1_portal.funding_proposer_current(v.proposed_by,v.proposed_person,v.proposed_context,o.organisation_id) then result:=result||'"approve_funding_reversal"'::jsonb; end if;
  end if;
  return result;
end $$;

create function bx1_portal.read_scoped(c jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; vfund jsonb;
begin
  result:=bx1_portal.read_scoped_p2(c);
  if bx1_portal.funding_session() is not true then return result; end if;
  -- Finance sees only selected product terms/orders, never private KYC cases.
  result:=jsonb_set(result,'{organisations}',(result->'organisations')||coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status,
    'native_organisation_id',c->>'organisationId','roles',jsonb_build_array(c->>'role'),'authority_source','NATIVE_BINDING',
    'capabilities',case when c->>'role'='TreasuryOperator' then '["read_orders","propose_funding_route","revoke_funding_route","open_funding_obligation","propose_funding_acceptance","propose_funding_exception","propose_funding_reversal"]'::jsonb
      else '["read_orders","approve_funding_route","reconcile_funding","resolve_funding_exception","approve_funding_reversal"]'::jsonb end) order by o.id)
    from bx1_portal.organisations o where bx1_portal.scoped_finance(c,o.id)),'[]'::jsonb));
  result:=jsonb_set(result,'{products}',coalesce((select jsonb_agg((to_jsonb(p)-array['cap_units','minimum_units','unit_price_minor'])||jsonb_build_object('reserved_units',p.reserved_units::text,
    'allowed_actions',case when bx1_portal.scoped_finance(c,p.organisation_id,'TreasuryOperator') and p.status='PUBLISHED' then '["propose_funding_route"]'::jsonb else '[]'::jsonb end) order by p.created_at,p.id)
    from bx1_portal.products p where bx1_portal.scoped_product_visible(c,p.id) or bx1_portal.scoped_finance(c,p.organisation_id)),'[]'));
  result:=jsonb_set(result,'{subscriptions}',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'product_id',s.product_id,'investor_id',s.investor_id,'investment_account_id',s.investment_account_id,
    'product_name',s.accepted_terms->>'name','organisation_id',s.organisation_id,'product_revision',s.product_revision,'terms_hash',s.terms_hash,'currency',s.accepted_terms->>'currency,
    'units',s.units::text,'amount_minor',s.amount_minor::text,'status',s.status,'created_at',s.created_at,'can_cancel',s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor') and bx1_portal.funding_can_cancel(s.id),
    'funding_obligation_id',(select id from bx1_portal.funding_obligations where subscription_id=s.id),
    'allowed_actions',case when s.investment_account_id is not null and s.status='AWAITING_FUNDING' and not exists(select 1 from bx1_portal.funding_obligations where subscription_id=s.id)
      and (bx1_portal.scoped_finance(c,s.organisation_id,'TreasuryOperator') or (s.investor_id=auth.uid() and (c->>'mode'='APPLICANT' or c->>'role'='Investor')))
      and exists(select 1 from bx1_portal.funding_routes r where r.product_id=s.product_id and r.product_revision=s.product_revision and r.terms_hash=s.terms_hash and bx1_portal.funding_route_current(r.id)) then '["open_funding_obligation"]'::jsonb else '[]'::jsonb end)
    order by s.created_at,s.id) from bx1_portal.subscriptions s where bx1_portal.funding_order_visible(c,s.id)),'[]'));
  select jsonb_build_object(
    'routes',coalesce((select jsonb_agg((to_jsonb(r)-array['proposed_person','approved_person','proposed_context'])||jsonb_build_object('verification_status',coalesce((select status from bx1_portal.funding_observations x where x.route_id=r.id and x.reference_id is null order by x.observed_at desc,x.id desc limit 1),'UNVERIFIED'),'allowed_actions',bx1_portal.funding_actions(c,'ROUTE',r.id)) order by r.created_at,r.id)
      from bx1_portal.funding_routes r where bx1_portal.scoped_operator(c,r.organisation_id) or bx1_portal.scoped_finance(c,r.organisation_id)
        or exists(select 1 from bx1_portal.subscriptions s where s.product_id=r.product_id and bx1_portal.funding_order_visible(c,s.id))),'[]'),
    'obligations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'subscription_id',o.subscription_id,'investment_account_id',o.investment_account_id,'investor_id',o.investor_id,'product_id',o.product_id,'organisation_id',o.organisation_id,'route_id',o.route_id,'revision',o.revision,
      'state',bx1_portal.funding_state(o.id),'amount_minor',o.amount_minor::text,'currency',o.currency,'token_amount_base_units',o.token_amount_base_units::text,'token_decimals',o.token_decimals,
      'observed_amount_base_units',bx1_portal.funding_totals(o.id)->>'observed','posted_amount_base_units',bx1_portal.funding_totals(o.id)->>'posted',
      'reservation_status',(select status from bx1_portal.subscriptions where id=o.subscription_id),'evidence_set_hash',bx1_portal.funding_evidence_hash(o.id),'created_at',o.created_at,'allowed_actions',bx1_portal.funding_actions(c,'OBLIGATION',o.id)) order by o.created_at,o.id)
      from bx1_portal.funding_obligations o where bx1_portal.funding_order_visible(c,o.subscription_id)),'[]'),
    'references',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'obligation_id',r.obligation_id,'revision',r.revision,'status',r.status,'payer_address',r.payer_address,'transaction_hash',r.transaction_hash,'log_index',r.log_index,
      'amount_base_units',x.amount_base_units::text,'verification_status',coalesce(x.status,'UNVERIFIED'),'last_observed_at',x.observed_at,'block_hash',x.block_hash,'block_number',x.block_number::text,'observation_reason',x.facts->>'reason_code',
      'acceptance_proposed_by',a.proposed_by,'exception_decision',a.decision,'exception_reason',a.reason,'allowed_actions',bx1_portal.funding_actions(c,'REFERENCE',r.id)) order by r.created_at,r.id)
      from bx1_portal.funding_references r join bx1_portal.funding_obligations o on o.id=r.obligation_id
      left join lateral bx1_portal.funding_last_observation(r.id) x on true
      left join lateral (select * from bx1_portal.funding_acceptances where reference_id=r.id order by proposed_at desc,id desc limit 1) a on true
      where bx1_portal.funding_order_visible(c,o.subscription_id)),'[]'),
    'journals',coalesce((select jsonb_agg((to_jsonb(j)-array['posted_person','acceptance_id'])||jsonb_build_object('amount_base_units',j.amount_base_units::text,'allowed_actions',bx1_portal.funding_actions(c,'JOURNAL',j.id),
      'lines',(select jsonb_agg(jsonb_build_object('account',l.account,'side',l.side,'amount_base_units',l.amount_base_units::text) order by l.line_number) from bx1_portal.funding_journal_lines l where l.journal_id=j.id)) order by j.created_at,j.id)
      from bx1_portal.funding_journals j join bx1_portal.funding_obligations o on o.id=j.obligation_id where bx1_portal.funding_order_visible(c,o.subscription_id)),'[]'),
    'reversals',coalesce((select jsonb_agg((to_jsonb(v)-array['proposed_person','approved_person','proposed_context'])||jsonb_build_object('allowed_actions',bx1_portal.funding_actions(c,'REVERSAL',v.id)) order by v.created_at,v.id)
      from bx1_portal.funding_reversals v join bx1_portal.funding_obligations o on o.id=v.obligation_id where bx1_portal.funding_order_visible(c,o.subscription_id)),'[]')
  ) into vfund;
  result:=result||jsonb_build_object('funding',vfund);
  if bx1_portal.valid_operating_context(c) is not true or bx1_portal.funding_session() is not true then raise exception 'funding_context_expired' using errcode='42501'; end if;
  return result;
end $$;

-- Mint expectations only from an authenticated caller and canonical locked rows.
-- No browser-provided actor, claims, amount or verification facts are accepted.
create function bx1_portal.funding_verification_context(k text,target uuid,c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r bx1_portal.funding_routes; f bx1_portal.funding_references; o bx1_portal.funding_obligations;
  e bx1_portal.funding_verification_expectations; payload jsonb; claims jsonb; v integer;
begin
  if k not in ('ROUTE','REFERENCE') or bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_verification_denied' using errcode='42501'; end if;
  if k='ROUTE' then select * into r from bx1_portal.funding_routes where id=target;
  else
    select * into f from bx1_portal.funding_references where id=target;
    select * into o from bx1_portal.funding_obligations where id=f.obligation_id;
    select * into r from bx1_portal.funding_routes where id=o.route_id;
  end if;
  if r.id is null or not(bx1_portal.funding_actions(c,k,target)?case when k='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_verification_scope_denied' using errcode='42501'; end if;
  perform bx1_portal.funding_lock(c,r.organisation_id,r.product_id,o.subscription_id,o.id);
  select * into r from bx1_portal.funding_routes where id=r.id for update;
  if k='REFERENCE' then select * into f from bx1_portal.funding_references where id=target; end if;
  v:=case when k='ROUTE' then r.revision else f.revision end;
  payload:=jsonb_build_object('route',jsonb_build_object('id',r.id,'revision',case when k='REFERENCE' then f.claim_route_revision else r.revision end,
    'environment','TESTNET','chain_id',80002,'token_address',r.token_address,'token_runtime_hash',r.token_runtime_hash,'token_decimals',r.token_decimals,'receiving_address',r.receiving_address));
  if k='REFERENCE' then payload:=payload||jsonb_build_object('reference',jsonb_build_object('id',f.id,'obligation_id',o.id,'investment_account_id',o.investment_account_id,
    'actor_id',f.actor_id,'payer_address',f.payer_address,'transaction_hash',f.transaction_hash,'log_index',f.log_index,'claim_signature',f.claim_signature,'created_at',f.created_at,'obligation_created_at',o.created_at)); end if;
  claims:=jsonb_build_object('sub',auth.uid(),'session_id',auth.jwt()->>'session_id','iss',auth.jwt()->>'iss','aal',auth.jwt()->>'aal','exp',auth.jwt()->'exp','role','authenticated');
  insert into bx1_portal.funding_verification_expectations(kind,target_id,actor_id,session_id,operating_context,trusted_claims,version,expected,expectation_hash,expires_at)
    values(k,target,auth.uid(),(auth.jwt()->>'session_id')::uuid,c,claims,v,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),clock_timestamp()+interval '4 minutes') returning * into e;
  if bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true
    or not(bx1_portal.funding_actions(c,k,target)?case when k='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_verification_authority_expired' using errcode='42501'; end if;
  return payload||jsonb_build_object('id',e.id,'kind',k,'actor_id',e.actor_id,'session_id',e.session_id,'expires_at',e.expires_at,'version',e.version,'target_id',target,'expectation_hash',e.expectation_hash,'operating_context',c);
end $$;

create function bx1_portal.record_funding_observation(eid uuid,facts jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare e bx1_portal.funding_verification_expectations; r bx1_portal.funding_routes; f bx1_portal.funding_references; o bx1_portal.funding_obligations;
  prior bx1_portal.funding_observations; inserted bx1_portal.funding_observations; claimed uuid; c jsonb; old_claims text:=current_setting('request.jwt.claims',true);
  expected_route jsonb; source jsonb; source_urls text[]; in_policy boolean; result jsonb; amount numeric; observed_block numeric;
begin
  select * into e from bx1_portal.funding_verification_expectations where id=eid;
  if e.id is null or e.expires_at<=clock_timestamp() or jsonb_typeof(facts) is distinct from 'object' or octet_length(facts::text)>16384 then raise exception 'funding_expectation_expired' using errcode='42501'; end if;
  -- Only minimal claims captured by the authenticated mint are restored. Never
  -- copy a service/browser actor from observation payload into authorization.
  perform set_config('request.jwt.claims',e.trusted_claims::text,true); c:=e.operating_context;
  if bx1_portal.funding_session() is not true or auth.uid() is distinct from e.actor_id or bx1_portal.valid_operating_context(c) is not true then raise exception 'funding_verifier_actor_expired' using errcode='42501'; end if;
  if e.kind='ROUTE' then select * into r from bx1_portal.funding_routes where id=e.target_id;
  else
    select * into f from bx1_portal.funding_references where id=e.target_id;
    select * into o from bx1_portal.funding_obligations where id=f.obligation_id;
    select * into r from bx1_portal.funding_routes where id=o.route_id;
  end if;
  if r.id is null then raise exception 'funding_expectation_target_missing' using errcode='42501'; end if;
  perform bx1_portal.funding_lock(c,r.organisation_id,r.product_id,o.subscription_id,o.id);
  select * into r from bx1_portal.funding_routes where id=r.id for update;
  if e.kind='REFERENCE' then select * into f from bx1_portal.funding_references where id=f.id; end if;
  -- Idempotent replay is allowed only for identical immutable observations,
  -- after fresh caller and context checks, without re-consuming the receipt.
  select * into inserted from bx1_portal.funding_observations where expectation_id=e.id;
  if inserted.id is not null then
    if inserted.facts is distinct from facts then raise exception 'funding_observation_replay_conflict' using errcode='23505'; end if;
    result:=jsonb_build_object('observation_id',inserted.id,'status',inserted.status);
    perform set_config('request.jwt.claims',coalesce(old_claims,''),true); return result;
  end if;
  if e.expires_at<=clock_timestamp() or e.version is distinct from case when e.kind='ROUTE' then r.revision else f.revision end
    or not(bx1_portal.funding_actions(c,e.kind,e.target_id)?case when e.kind='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_expectation_stale' using errcode='42501'; end if;
  expected_route:=e.expected->'route';
  if expected_route is distinct from jsonb_build_object('id',r.id,'revision',case when e.kind='REFERENCE' then f.claim_route_revision else r.revision end,
    'environment','TESTNET','chain_id',80002,'token_address',r.token_address,'token_runtime_hash',r.token_runtime_hash,'token_decimals',r.token_decimals,'receiving_address',r.receiving_address)
    or e.expectation_hash is distinct from encode(sha256(convert_to(e.expected::text,'UTF8')),'hex') then raise exception 'funding_expectation_identity_changed' using errcode='23514'; end if;
  if e.kind='REFERENCE' and e.expected->'reference' is distinct from jsonb_build_object('id',f.id,'obligation_id',o.id,'investment_account_id',o.investment_account_id,
    'actor_id',f.actor_id,'payer_address',f.payer_address,'transaction_hash',f.transaction_hash,'log_index',f.log_index,'claim_signature',f.claim_signature,'created_at',f.created_at,'obligation_created_at',o.created_at) then raise exception 'funding_expectation_identity_changed' using errcode='23514'; end if;
  if facts->'version' is distinct from '1'::jsonb or facts->>'kind' is distinct from e.kind or facts->'chain_id' is distinct from '80002'::jsonb
    or coalesce(facts->>'status','') not in ('VERIFIED','INVALID') or facts->>'token_address' is distinct from r.token_address
    or facts->>'token_runtime_hash' is distinct from r.token_runtime_hash or facts->'token_decimals' is distinct from to_jsonb(r.token_decimals)
    or facts->>'receiving_address' is distinct from r.receiving_address or coalesce(facts->>'block_number','') !~ '^[0-9]{1,78}$'
    or coalesce(facts->>'block_hash','') !~ '^0x[0-9a-f]{64}$' or facts->>'block_timestamp' is null
    or jsonb_typeof(facts->'providers') is distinct from 'array' or jsonb_array_length(facts->'providers')<>2 then raise exception 'funding_invalid_observation' using errcode='22023'; end if;
  observed_block:=(facts->>'block_number')::numeric;
  if not isfinite((facts->>'block_timestamp')::timestamptz) or (facts->>'block_timestamp')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'funding_invalid_block_time' using errcode='22023'; end if;
  select array_agg(x->>'url' order by x->>'url') into source_urls from jsonb_array_elements(facts->'providers') x;
  if source_urls is distinct from array['https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.drpc.org']::text[] then raise exception 'funding_invalid_sources' using errcode='22023'; end if;
  for source in select value from jsonb_array_elements(facts->'providers') loop
    if coalesce(source->>'finalized_block_number','') !~ '^[0-9]{1,78}$' or coalesce(source->>'finalized_block_hash','') !~ '^0x[0-9a-f]{64}$'
      or (source->>'finalized_block_number')::numeric<observed_block then raise exception 'funding_not_finalized' using errcode='22023'; end if;
  end loop;
  if e.kind='ROUTE' then
    if facts->>'status' is distinct from 'VERIFIED' then raise exception 'funding_invalid_route_observation' using errcode='22023'; end if;
  else
    if facts->>'transaction_hash' is distinct from f.transaction_hash or facts->'log_index' is distinct from to_jsonb(f.log_index)
      or facts->>'payer_address' is distinct from f.payer_address or coalesce(facts->>'transaction_index','') !~ '^[0-9]{1,10}$'
      or coalesce(facts->>'claim_hash','') !~ '^0x[0-9a-f]{64}$' then raise exception 'funding_receipt_mismatch' using errcode='22023'; end if;
    prior:=bx1_portal.funding_last_observation(f.id);
    if facts->>'status'='INVALID' then
      if facts->>'reason_code' is distinct from 'RECEIPT_REVERTED' or facts?'amount_base_units' or exists(select 1 from bx1_portal.funding_receipt_claims where reference_id=f.id) then raise exception 'funding_not_conclusively_unpaid' using errcode='23514'; end if;
    else
      if coalesce(facts->>'amount_base_units','') !~ '^[1-9][0-9]{0,77}$' then raise exception 'funding_invalid_amount' using errcode='22023'; end if;
      amount:=(facts->>'amount_base_units')::numeric;
      if amount>=power(2::numeric,256) then raise exception 'funding_amount_overflow' using errcode='22023'; end if;
      if prior.status='VERIFIED' and (prior.amount_base_units is distinct from amount or prior.block_hash is distinct from facts->>'block_hash') then raise exception 'funding_verified_fact_conflict' using errcode='23514'; end if;
    end if;
  end if;
  insert into bx1_portal.funding_observations(expectation_id,route_id,reference_id,status,facts,amount_base_units,block_number,block_hash)
    values(e.id,r.id,f.id,facts->>'status',facts,amount,observed_block,facts->>'block_hash') returning * into inserted;
  if e.kind='REFERENCE' then
    if facts->>'status'='VERIFIED' then
      insert into bx1_portal.funding_receipt_claims(chain_id,transaction_hash,log_index,reference_id,first_observation_id)
        values(80002,f.transaction_hash,f.log_index,f.id,inserted.id) on conflict(chain_id,transaction_hash,log_index) do nothing;
      select reference_id into claimed from bx1_portal.funding_receipt_claims where chain_id=80002 and transaction_hash=f.transaction_hash and log_index=f.log_index;
      if claimed is distinct from f.id then raise exception 'funding_receipt_already_claimed' using errcode='23505'; end if;
      in_policy:=bx1_portal.funding_route_current(r.id) and bx1_portal.funding_account_current(o.id)
        and (facts->>'block_timestamp')::timestamptz>o.created_at and facts->>'policy_status' is distinct from 'UNAPPLIED'
        and not exists(select 1 from bx1_portal.subscriptions where id=o.subscription_id and status='CANCELLED');
      update bx1_portal.funding_references set revision=revision+1,status=case when status='POSTED' then 'POSTED' when status='UNAPPLIED' or in_policy is not true then 'UNAPPLIED' else 'VERIFIED' end where id=f.id;
    else
      update bx1_portal.funding_references set revision=revision+1,status=case when status in ('UNAPPLIED','REJECTED_UNPAID') then status else 'SUBMITTED' end where id=f.id;
    end if;
    update bx1_portal.funding_obligations set revision=revision+1 where id=o.id;
  end if;
  insert into bx1_portal.events(subject_id,organisation_id,investor_id,kind,actor_id,summary)
    values(coalesce(f.id,r.id),r.organisation_id,o.investor_id,'funding_observation',e.actor_id,'Server-verified finalized TESTNET evidence recorded; no production money or issued holding.');
  if e.expires_at<=clock_timestamp() or bx1_portal.funding_session() is not true or bx1_portal.valid_operating_context(c) is not true
    or not(bx1_portal.funding_actions(c,e.kind,e.target_id)?case when e.kind='ROUTE' then 'verify_funding_route' else 'verify_funding_reference' end) then raise exception 'funding_observation_authority_expired' using errcode='42501'; end if;
  result:=jsonb_build_object('observation_id',inserted.id,'status',inserted.status);
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true); return result;
exception when others then
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true); raise;
end $$;

-- Rebind the public invokers to the additive scoped entry points. Internal P2
-- routines remain owner-only; callers cannot choose the old cancellation path.
create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;
create function public.bx1_portal_funding_verification_context(kind text,id uuid,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.funding_verification_context(kind,id,operating_context); $$;
create function public.bx1_portal_record_funding_observation(expectation_id uuid,observation jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.record_funding_observation(expectation_id,observation); $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='bx1_portal' and (p.proname like 'funding_%' or p.proname in ('scoped_finance','record_funding_observation','read_scoped','execute_scoped')))
      or (n.nspname='public' and p.proname in ('bx1_portal_funding_verification_context','bx1_portal_record_funding_observation')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),bx1_portal.funding_verification_context(text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb),public.bx1_portal_funding_verification_context(text,uuid,jsonb) to authenticated;
grant usage on schema bx1_portal to service_role;
grant execute on function bx1_portal.record_funding_observation(uuid,jsonb),public.bx1_portal_record_funding_observation(uuid,jsonb) to service_role;
