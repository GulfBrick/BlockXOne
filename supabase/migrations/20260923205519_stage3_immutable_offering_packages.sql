-- Stage 3 foundation: enduring product != immutable submitted offering.
-- This migration is additive to the existing scoped portal command path. It
-- does not appoint an issuer, approve any historical product, or assert that
-- a chain deployment is technically ready. MAIN retains its entry-only ACL.
do $baseline$ begin
  if pg_catalog.to_regprocedure('bx1_portal.execute_scoped(jsonb,text,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.read_scoped(jsonb)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entity_people_independent(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('bx1_portal.entry_lock_actor()') is null then
    raise exception 'offering_package_stage2_baseline_required' using errcode='55000';
  end if;
end $baseline$;

create function bx1_portal.offering_document_hashes(terms jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'memorandum',case when pg_catalog.jsonb_typeof(terms#>'{documents,memorandum}')='string'
      then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(terms#>>'{documents,memorandum}','UTF8')),'hex') end,
    'risks',case when pg_catalog.jsonb_typeof(terms#>'{documents,risks}')='string'
      then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(terms#>>'{documents,risks}','UTF8')),'hex') end,
    'subscription_terms',case when pg_catalog.jsonb_typeof(terms#>'{documents,subscription_terms}')='string'
      then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(terms#>>'{documents,subscription_terms}','UTF8')),'hex') end);
$$;

create table bx1_portal.offering_revisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  product_id uuid not null references bx1_portal.products(id) on delete restrict,
  package_number integer not null check(package_number>0),
  origin text not null check(origin in ('SUBMITTED','LEGACY_PRODUCT_SNAPSHOT','LEGACY_ORDER_SNAPSHOT')),
  product_revision_at_submission integer not null check(product_revision_at_submission>0),
  terms jsonb not null check(pg_catalog.jsonb_typeof(terms)='object'),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  document_hashes jsonb not null,
  submitted_by uuid references auth.users(id) on delete restrict,
  submitted_at timestamptz not null,
  legacy_subscription_id uuid unique references bx1_portal.subscriptions(id) on delete restrict,
  unique(product_id,package_number), unique(id,product_id),
  check((origin='SUBMITTED' and submitted_by is not null and legacy_subscription_id is null)
    or (origin='LEGACY_PRODUCT_SNAPSHOT' and submitted_by is null and legacy_subscription_id is null)
    or (origin='LEGACY_ORDER_SNAPSHOT' and submitted_by is null and legacy_subscription_id is not null)),
  check(document_hashes=bx1_portal.offering_document_hashes(terms)),
  check(origin<>'SUBMITTED' or
    terms_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(terms::text,'UTF8')),'hex'))
);
create index bx1_offering_revisions_product on bx1_portal.offering_revisions(product_id,package_number desc);
create trigger bx1_offering_revision_immutable before update or delete on bx1_portal.offering_revisions
  for each row execute function bx1_portal.immutable_record();

create table bx1_portal.offering_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  offering_revision_id uuid not null references bx1_portal.offering_revisions(id) on delete restrict,
  decision_kind text not null check(decision_kind in ('ISSUER','COMPLIANCE')),
  decision text not null check(decision in ('APPROVED','CHANGES_REQUIRED')),
  decision_basis text not null default 'MANUAL_TEST_REVIEW' check(decision_basis='MANUAL_TEST_REVIEW'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operating_context jsonb not null check(pg_catalog.jsonb_typeof(operating_context)='object'),
  terms_hash text not null check(terms_hash ~ '^[0-9a-f]{64}$'),
  document_hashes jsonb not null,
  product_revision_at_decision integer not null check(product_revision_at_decision>0),
  notes text not null check(char_length(notes) between 20 and 3000),
  checks jsonb not null check(pg_catalog.jsonb_typeof(checks)='object'),
  decided_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(offering_revision_id,decision_kind)
);
create trigger bx1_offering_decision_immutable before update or delete on bx1_portal.offering_decisions
  for each row execute function bx1_portal.immutable_record();

alter table bx1_portal.products add column current_offering_revision_id uuid;
alter table bx1_portal.products add constraint bx1_product_current_offering_same_product
  foreign key(current_offering_revision_id,id) references bx1_portal.offering_revisions(id,product_id) on delete restrict;
alter table bx1_portal.subscriptions add column offering_revision_id uuid;
alter table bx1_portal.subscriptions add constraint bx1_subscription_offering_same_product
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict;
alter table bx1_portal.product_eligibility_cases add column offering_revision_id uuid;
alter table bx1_portal.product_eligibility_cases add constraint bx1_eligibility_offering_same_product
  foreign key(offering_revision_id,product_id) references bx1_portal.offering_revisions(id,product_id) on delete restrict;

-- Historical product and accepted-order snapshots get stable identities but
-- NEVER current package pointers or new approvals. Old IDs/hash/revisions are
-- retained. Eligibility with no reconstructible accepted terms stays unbound.
insert into bx1_portal.offering_revisions(product_id,package_number,origin,
  product_revision_at_submission,terms,terms_hash,document_hashes,submitted_at)
select p.id,1,'LEGACY_PRODUCT_SNAPSHOT',p.revision,p.terms,p.terms_hash,
  bx1_portal.offering_document_hashes(p.terms),p.created_at
from bx1_portal.products p;
insert into bx1_portal.offering_revisions(product_id,package_number,origin,
  product_revision_at_submission,terms,terms_hash,document_hashes,submitted_at,legacy_subscription_id)
select s.product_id,1+pg_catalog.row_number() over(partition by s.product_id order by s.created_at,s.id),
  'LEGACY_ORDER_SNAPSHOT',s.product_revision,s.accepted_terms,s.terms_hash,
  bx1_portal.offering_document_hashes(s.accepted_terms),s.created_at,s.id
from bx1_portal.subscriptions s;
update bx1_portal.subscriptions s set offering_revision_id=r.id
from bx1_portal.offering_revisions r where r.legacy_subscription_id=s.id;

alter table bx1_portal.offering_revisions enable row level security;
alter table bx1_portal.offering_decisions enable row level security;
revoke all on bx1_portal.offering_revisions,bx1_portal.offering_decisions from public,anon,authenticated,service_role;

-- The canonical independent observer/manifest review has not been integrated.
-- A product cannot become operational based on UI flags, names, a transaction
-- hash, or old PUBLISHED state. Stage 4 will replace this owner-only predicate
-- with verified, operation-bound technical evidence.
create function bx1_portal.offering_technical_ready(target_revision uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select false;
$$;
create function bx1_portal.offering_approved(target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash and r.terms=p.terms
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.entry_configuration cfg on cfg.singleton and cfg.environment='TESTNET'
      and cfg.manual_test_review
    join bx1_portal.offering_decisions issuer on issuer.offering_revision_id=r.id
      and issuer.decision_kind='ISSUER' and issuer.decision='APPROVED'
      and issuer.terms_hash=r.terms_hash and issuer.document_hashes=r.document_hashes
    join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id
      and compliance.decision_kind='COMPLIANCE' and compliance.decision='APPROVED'
      and compliance.terms_hash=r.terms_hash and compliance.document_hashes=r.document_hashes
    join public.bx1_memberships issuer_membership on issuer_membership.user_id=issuer.actor_id
      and issuer_membership.role='IssuerFundManager'
      and issuer_membership.organisation_id=(issuer.operating_context->>'organisationId')::uuid
    join bx1_portal.organisation_authority_bindings issuer_binding on
      issuer_binding.product_organisation_id=p.organisation_id
      and issuer_binding.native_organisation_id=issuer_membership.organisation_id
      and issuer_binding.role='IssuerFundManager' and issuer_binding.status='ACTIVE'
    join public.bx1_memberships compliance_membership on compliance_membership.user_id=compliance.actor_id
      and compliance_membership.role='ComplianceOfficer'
      and compliance_membership.organisation_id=(compliance.operating_context->>'organisationId')::uuid
    join bx1_portal.organisation_authority_bindings compliance_binding on
      compliance_binding.product_organisation_id=p.organisation_id
      and compliance_binding.native_organisation_id=compliance_membership.organisation_id
      and compliance_binding.role='ComplianceOfficer' and compliance_binding.status='ACTIVE'
    where p.id=target_product and issuer.actor_id<>compliance.actor_id
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.native_membership_effective(issuer_membership.id)
      and bx1_portal.native_membership_effective(compliance_membership.id)
      and issuer_binding.valid_from<=pg_catalog.clock_timestamp()
      and issuer_binding.valid_until>pg_catalog.clock_timestamp()
      and compliance_binding.valid_from<=pg_catalog.clock_timestamp()
      and compliance_binding.valid_until>pg_catalog.clock_timestamp()
      and bx1_portal.entity_people_independent(issuer.actor_id,compliance.actor_id)
      and bx1_portal.entity_people_independent(issuer.actor_id,r.submitted_by)
      and bx1_portal.entity_people_independent(compliance.actor_id,r.submitted_by));
$$;
create function bx1_portal.offering_operational(target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p where p.id=target_product
    and bx1_portal.offering_approved(p.id)
    and bx1_portal.offering_technical_ready(p.current_offering_revision_id));
$$;

create function bx1_portal.offering_issuer_session_assured(c jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  select bx1_portal.valid_operating_context(c) and c->>'mode'='ROLE'
    and c->>'role'='IssuerFundManager' and auth.jwt()->>'aal'='aal2'
    and bx1_private.has_session_mfa() and bx1_private.has_token_mfa()
    and exists(select 1 from auth.sessions s join auth.mfa_factors f
      on f.id=s.factor_id and f.user_id=s.user_id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
        and s.aal::text='aal2' and f.status::text='verified' and f.factor_type::text='totp');
$$;

create function bx1_portal.offering_issuer_authorised(c jsonb,target_product uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.products p
    join bx1_portal.organisations o on o.id=p.organisation_id
    join bx1_portal.offering_revisions r on r.id=p.current_offering_revision_id and r.product_id=p.id
    join public.bx1_memberships m on m.user_id=auth.uid()
      and m.organisation_id=(c->>'organisationId')::uuid and m.role='IssuerFundManager'
    join bx1_portal.organisation_authority_bindings b on b.product_organisation_id=p.organisation_id
      and b.native_organisation_id=m.organisation_id and b.role='IssuerFundManager'
      and b.status='ACTIVE' and b.valid_from<=pg_catalog.clock_timestamp()
      and b.valid_until>pg_catalog.clock_timestamp()
    where p.id=target_product and bx1_portal.offering_issuer_session_assured(c)
      and bx1_portal.native_membership_effective(m.id)
      and bx1_portal.entity_people_independent(auth.uid(),p.created_by)
      and bx1_portal.entity_people_independent(auth.uid(),o.owner_id)
      and bx1_portal.entity_people_independent(auth.uid(),r.submitted_by)
      and bx1_portal.current_product_organisation(o.id)
      and r.origin='SUBMITTED' and r.terms_hash=p.terms_hash
      and not exists(select 1 from bx1_portal.offering_decisions d
        where d.offering_revision_id=r.id and d.decision_kind='ISSUER'));
$$;

-- Appointment visibility is distinct from a still-pending issuer decision:
-- the product must not disappear from the issuer's workspace after review.
-- This confers read scope only, never create/save/publish/order authority.
create function bx1_portal.offering_issuer_scope(c jsonb,target_org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  if bx1_portal.offering_issuer_session_assured(c) is not true
    or bx1_portal.current_product_organisation(target_org) is not true then return false; end if;
  return exists(select 1 from public.bx1_memberships m
    join bx1_portal.organisation_authority_bindings b
      on b.native_organisation_id=m.organisation_id and b.product_organisation_id=target_org
        and b.role='IssuerFundManager' and b.status='ACTIVE'
    where m.user_id=auth.uid() and m.organisation_id=(c->>'organisationId')::uuid
      and m.role='IssuerFundManager' and bx1_portal.native_membership_effective(m.id)
      and b.valid_from<=pg_catalog.clock_timestamp() and b.valid_until>pg_catalog.clock_timestamp());
end $$;

-- Direct internal paths cannot create new commitments merely because a
-- historical product retained PUBLISHED. Recovery of old orders is separate.
create function bx1_portal.guard_offering_publication() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status<>'PUBLISHED' then return new; end if;
  if tg_op='INSERT' then
    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;
  if new.terms is distinct from old.terms
    or new.terms_hash is distinct from old.terms_hash
    or new.current_offering_revision_id is distinct from old.current_offering_revision_id then
    raise exception 'offering_published_package_immutable' using errcode='23514'; end if;
  if old.status is distinct from 'PUBLISHED' and bx1_portal.offering_operational(new.id) is not true then
    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;
  return new;
end $$;
create trigger bx1_offering_publication_gate before insert or update of status,terms,terms_hash,current_offering_revision_id on bx1_portal.products
  for each row execute function bx1_portal.guard_offering_publication();
create function bx1_portal.guard_offering_subscription() returns trigger
language plpgsql set search_path='' as $$
declare p bx1_portal.products;
begin
  select * into p from bx1_portal.products where id=new.product_id;
  if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true
    or new.terms_hash is distinct from p.terms_hash then
    raise exception 'offering_not_open' using errcode='23514'; end if;
  if new.offering_revision_id is not null and new.offering_revision_id<>p.current_offering_revision_id then
    raise exception 'offering_revision_mismatch' using errcode='23514'; end if;
  new.offering_revision_id:=p.current_offering_revision_id;
  return new;
end $$;
create trigger bx1_offering_subscription_gate before insert on bx1_portal.subscriptions
  for each row execute function bx1_portal.guard_offering_subscription();
create function bx1_portal.guard_offering_accepted_order() returns trigger
language plpgsql set search_path='' as $$
begin
  -- The inherited guarded subscribe writer inserts the order and then binds
  -- its previously validated account in the same transaction. Permit only
  -- that first null-to-holder binding; never re-point an accepted account.
  if new.investment_account_id is distinct from old.investment_account_id
    and not (old.investment_account_id is null and new.investment_account_id is not null
      and auth.uid()=old.investor_id and exists(select 1 from bx1_portal.investment_accounts i
        where i.id=new.investment_account_id and i.holder_user_id=old.investor_id)) then
    raise exception 'offering_accepted_account_immutable' using errcode='23514'; end if;
  if row(new.id,new.product_id,new.investor_id,new.organisation_id,
    new.product_revision,new.terms_hash,new.accepted_terms,new.accepted_documents,
    new.accepted_risks,new.units,new.amount_minor,new.created_at,new.offering_revision_id)
    is distinct from row(old.id,old.product_id,old.investor_id,old.organisation_id,
    old.product_revision,old.terms_hash,old.accepted_terms,old.accepted_documents,
    old.accepted_risks,old.units,old.amount_minor,old.created_at,old.offering_revision_id) then
    raise exception 'offering_accepted_order_immutable' using errcode='23514'; end if;
  return new;
end $$;
create trigger bx1_offering_accepted_order_guard before update on bx1_portal.subscriptions
  for each row execute function bx1_portal.guard_offering_accepted_order();

-- The funding feature is deployed in TEST but deliberately absent from MAIN's
-- entry-only database. Guard its commitment-creating routes when present;
-- provider observations, exceptions, cancellation and reversals for already
-- existing obligations remain available for safe recovery.
create function bx1_portal.guard_offering_funding_commitment() returns trigger
language plpgsql set search_path='' as $$
begin
  if bx1_portal.offering_operational(new.product_id) is not true then
    raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;
  return new;
end $$;
do $funding_guards$ begin
  if pg_catalog.to_regclass('bx1_portal.funding_routes') is not null then
    execute 'create trigger bx1_offering_route_creation_gate before insert on bx1_portal.funding_routes
      for each row execute function bx1_portal.guard_offering_funding_commitment()';
    execute 'create trigger bx1_offering_route_approval_gate before update of status on bx1_portal.funding_routes
      for each row when (new.status=''APPROVED'' and old.status is distinct from ''APPROVED'')
      execute function bx1_portal.guard_offering_funding_commitment()';
  end if;
  if pg_catalog.to_regclass('bx1_portal.funding_obligations') is not null then
    execute 'create trigger bx1_offering_obligation_creation_gate before insert on bx1_portal.funding_obligations
      for each row execute function bx1_portal.guard_offering_funding_commitment()';
  end if;
end $funding_guards$;

-- Product eligibility is always an exact package decision, never a generic
-- eligibility for whatever terms happen to be current later. Historical
-- approvals remain readable but have no newly inferred package authority.
create function bx1_portal.guard_offering_eligibility() returns trigger
language plpgsql set search_path='' as $$
declare p bx1_portal.products;
begin
  if tg_op='INSERT' then
    select * into p from bx1_portal.products where id=new.product_id;
    if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true
      or new.product_revision is distinct from p.revision or new.terms_hash is distinct from p.terms_hash then
      raise exception 'offering_not_open' using errcode='23514'; end if;
    new.offering_revision_id:=p.current_offering_revision_id;
  elsif new.status='SUBMITTED' and
      (old.status is distinct from 'SUBMITTED' or old.product_revision is distinct from new.product_revision
        or old.terms_hash is distinct from new.terms_hash) then
    select * into p from bx1_portal.products where id=new.product_id;
    if p.id is null or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true
      or new.product_revision is distinct from p.revision or new.terms_hash is distinct from p.terms_hash then
      raise exception 'offering_not_open' using errcode='23514'; end if;
    new.offering_revision_id:=p.current_offering_revision_id;
  elsif new.status='APPROVED' and old.status is distinct from 'APPROVED' then
    select * into p from bx1_portal.products where id=new.product_id;
    if new.offering_revision_id is null or new.offering_revision_id is distinct from p.current_offering_revision_id
      or bx1_portal.offering_operational(p.id) is not true then
      raise exception 'offering_eligibility_revision_expired' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger bx1_offering_eligibility_gate before insert or update on bx1_portal.product_eligibility_cases
  for each row execute function bx1_portal.guard_offering_eligibility();
create or replace function bx1_portal.product_eligibility_current(target_case uuid) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from bx1_portal.product_eligibility_cases e
    join bx1_portal.investment_accounts i on i.id=e.investment_account_id and i.holder_user_id=e.holder_user_id
    join bx1_portal.applications a on a.id=i.application_id and a.user_id=e.holder_user_id
    join bx1_portal.products p on p.id=e.product_id and p.organisation_id=e.organisation_id
    join bx1_portal.organisations o on o.id=p.organisation_id
    where e.id=target_case and e.status='APPROVED' and e.approved_until>pg_catalog.clock_timestamp()
      and e.offering_revision_id is not null and e.offering_revision_id=p.current_offering_revision_id
      and bx1_portal.offering_operational(p.id)
      and e.product_revision=p.revision and e.terms_hash=p.terms_hash and p.status='PUBLISHED'
      and i.status='ACTIVE' and i.kind='INDIVIDUAL'
      and a.persona='INVESTOR' and a.status='APPROVED' and a.approved_until>pg_catalog.clock_timestamp()
      and e.application_revision=a.revision and o.reviewer_scope=a.reviewer_scope
      and a.details->>'investor_type'='INDIVIDUAL'
      and p.terms->'eligible_countries' ? (a.details->>'country')
      and p.terms->'eligible_investor_types' ? (a.details->>'investor_type')
      and bx1_portal.current_product_organisation(o.id)
      and bx1_portal.entry_manual_review_enabled());
$$;

-- Inherited readers use this predicate, so an old PUBLISHED row remains in
-- its issuer/reviewer history but is no longer marketed as an open offer.
create or replace function bx1_portal.scoped_product_visible(c jsonb,target_product uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; o bx1_portal.organisations;
begin
  if bx1_portal.valid_operating_context(c) is not true then return false; end if;
  select * into p from bx1_portal.products where id=target_product;
  if not found then return false; end if;
  select * into o from bx1_portal.organisations where id=p.organisation_id;
  return bx1_portal.scoped_operator(c,o.id) or bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id)
    or bx1_portal.offering_issuer_scope(c,o.id)
    or ((c->>'mode'='APPLICANT' or c->>'role'='Investor') and p.status='PUBLISHED'
      and bx1_portal.offering_operational(p.id)
      and bx1_portal.current_product_organisation(o.id) and bx1_portal.is_eligible(p.terms));
end $$;

create function bx1_portal.offering_package_projection(c jsonb,target_product uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p bx1_portal.products; r bx1_portal.offering_revisions;
  issuer bx1_portal.offering_decisions; compliance bx1_portal.offering_decisions;
  can_issuer boolean; can_compliance boolean; is_ready boolean;
begin
  select * into p from bx1_portal.products where id=target_product;
  if p.id is null or p.current_offering_revision_id is null then return null; end if;
  select * into r from bx1_portal.offering_revisions where id=p.current_offering_revision_id and product_id=p.id;
  if r.id is null or r.origin<>'SUBMITTED' then return null; end if;
  select * into issuer from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='ISSUER';
  select * into compliance from bx1_portal.offering_decisions
    where offering_revision_id=r.id and decision_kind='COMPLIANCE';
  can_issuer:=p.status in ('IN_REVIEW','APPROVED') and bx1_portal.offering_issuer_authorised(c,p.id)
    and (compliance.id is null or bx1_portal.entity_people_independent(auth.uid(),compliance.actor_id));
  can_compliance:=p.status='IN_REVIEW' and compliance.id is null
    and bx1_portal.scoped_reviewer(c,(select reviewer_scope from bx1_portal.organisations where id=p.organisation_id),p.organisation_id)
    and bx1_portal.entity_people_independent(auth.uid(),r.submitted_by)
    and (issuer.id is null or bx1_portal.entity_people_independent(auth.uid(),issuer.actor_id));
  is_ready:=bx1_portal.offering_operational(p.id);
  return pg_catalog.jsonb_build_object(
    'id',r.id,'package_number',r.package_number,'origin',r.origin,
    'product_revision_at_submission',r.product_revision_at_submission,
    'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,'submitted_at',r.submitted_at,
    'issuer_status',coalesce(issuer.decision,'PENDING'),
    'compliance_status',coalesce(compliance.decision,'PENDING'),
    'issuer_review_notes',case when bx1_portal.scoped_operator(c,p.organisation_id)
      or bx1_portal.scoped_reviewer(c,(select reviewer_scope from bx1_portal.organisations where id=p.organisation_id),p.organisation_id)
      then issuer.notes end,
    'issuer_review_checks',case when bx1_portal.scoped_operator(c,p.organisation_id)
      or bx1_portal.scoped_reviewer(c,(select reviewer_scope from bx1_portal.organisations where id=p.organisation_id),p.organisation_id)
      then issuer.checks else null end,
    'technical_readiness_status','NOT_VERIFIED',
    'status',case when issuer.decision='CHANGES_REQUIRED' or compliance.decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'
      when issuer.decision='APPROVED' and compliance.decision='APPROVED'
        and bx1_portal.offering_approved(p.id) then 'APPROVED_AWAITING_READINESS'
      when issuer.decision='APPROVED' and compliance.decision='APPROVED' then 'AUTHORITY_EXPIRED'
      else 'IN_REVIEW' end,
    'can_review_issuer',can_issuer,'can_review_compliance',can_compliance,
    'publishable',p.status='APPROVED' and is_ready,
    'subscribable',p.status='PUBLISHED' and is_ready);
end $$;

create function bx1_portal.offering_history_projection(target_product uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',r.id,'package_number',r.package_number,'origin',r.origin,
    'product_revision_at_submission',r.product_revision_at_submission,
    'terms_hash',r.terms_hash,'document_hashes',r.document_hashes,'submitted_at',r.submitted_at,
    'issuer_status',case when r.origin<>'SUBMITTED' then 'UNVERIFIED_LEGACY' else coalesce(issuer.decision,'PENDING') end,
    'compliance_status',case when r.origin<>'SUBMITTED' then 'UNVERIFIED_LEGACY' else coalesce(compliance.decision,'PENDING') end,
    'technical_readiness_status','NOT_VERIFIED') order by r.package_number,r.id),'[]'::jsonb)
  from bx1_portal.offering_revisions r
  left join bx1_portal.offering_decisions issuer on issuer.offering_revision_id=r.id and issuer.decision_kind='ISSUER'
  left join bx1_portal.offering_decisions compliance on compliance.offering_revision_id=r.id and compliance.decision_kind='COMPLIANCE'
  where r.product_id=target_product;
$$;

-- Rebind the public invokers after renaming the old OIDs. Only the new wrapper
-- remains executable by authenticated TEST callers. Internal pre-offering
-- functions keep working as owner-invoked delegates, not alternate APIs.
alter function bx1_portal.read_scoped(jsonb) rename to read_scoped_pre_offering;
alter function bx1_portal.execute_scoped(jsonb,text,uuid,jsonb) rename to execute_scoped_pre_offering;

create function bx1_portal.read_scoped(c jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; products jsonb; cases jsonb; orders jsonb; routes jsonb; issuer_orgs jsonb;
  product_item jsonb; package jsonb; actions jsonb;
begin
  result:=bx1_portal.read_scoped_pre_offering(c);
  if c->>'mode'='ROLE' and c->>'role'='IssuerFundManager' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',o.id,'name',o.name,'status',o.status,
      'native_organisation_id',c->>'organisationId',
      'roles','["IssuerFundManager"]'::jsonb,'authority_source','NATIVE_BINDING',
      'capabilities','["review_offering_issuer"]'::jsonb) order by o.id),'[]'::jsonb)
      into issuer_orgs from bx1_portal.organisations o
      where bx1_portal.offering_issuer_scope(c,o.id)
        and not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(result->'organisations','[]'::jsonb)) present(value)
          where present.value->>'id'=o.id::text);
    result:=pg_catalog.jsonb_set(result,'{organisations}',coalesce(result->'organisations','[]'::jsonb)||issuer_orgs);
  end if;
  products:='[]'::jsonb;
  for product_item in select shown.value from pg_catalog.jsonb_array_elements(coalesce(result->'products','[]'::jsonb)) shown(value) loop
    package:=bx1_portal.offering_package_projection(c,(product_item->>'id')::uuid);
    actions:=case when pg_catalog.jsonb_typeof(product_item->'allowed_actions')='array'
      then product_item->'allowed_actions' else '[]'::jsonb end;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(shown.value) order by shown.ordinality),'[]'::jsonb)
      into actions from pg_catalog.jsonb_array_elements_text(actions) with ordinality shown(value,ordinality)
      where (shown.value<>'publish_product' or coalesce((package->>'publishable')::boolean,false))
        and (shown.value<>'subscribe' or coalesce((package->>'subscribable')::boolean,false))
        and (shown.value<>'propose_funding_route' or coalesce((package->>'subscribable')::boolean,false))
        and (shown.value<>'review_product' or coalesce((package->>'can_review_compliance')::boolean,false));
    if coalesce((package->>'can_review_compliance')::boolean,false) and not(actions ? 'review_product') then
      actions:=actions||'["review_product"]'::jsonb; end if;
    if coalesce((package->>'can_review_issuer')::boolean,false) and not(actions ? 'review_offering_issuer') then
      actions:=actions||'["review_offering_issuer"]'::jsonb; end if;
    products:=products||pg_catalog.jsonb_build_array(product_item||pg_catalog.jsonb_build_object(
      'offering_package',package,
      'offering_history',bx1_portal.offering_history_projection((product_item->>'id')::uuid),
      'allowed_actions',actions));
  end loop;
  result:=pg_catalog.jsonb_set(result,'{products}',products);
  if result ? 'subscriptions' then
    select coalesce(pg_catalog.jsonb_agg(shown.item || pg_catalog.jsonb_build_object(
      'offering_revision_id',(select s.offering_revision_id from bx1_portal.subscriptions s where s.id=(shown.item->>'id')::uuid),
      'allowed_actions',case when bx1_portal.offering_operational((shown.item->>'product_id')::uuid)
        then coalesce(shown.item->'allowed_actions','[]'::jsonb)
        else coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a.value) order by a.ordinality)
          from pg_catalog.jsonb_array_elements_text(coalesce(shown.item->'allowed_actions','[]'::jsonb))
            with ordinality a(value,ordinality) where a.value<>'open_funding_obligation'),'[]'::jsonb) end)
      order by shown.ordinality),'[]'::jsonb) into orders
    from pg_catalog.jsonb_array_elements(result->'subscriptions') with ordinality as shown(item,ordinality);
    result:=pg_catalog.jsonb_set(result,'{subscriptions}',orders);
  end if;
  if result ? 'product_eligibility' then
    select coalesce(pg_catalog.jsonb_agg(shown.item || pg_catalog.jsonb_build_object(
      'offering_revision_id',(select e.offering_revision_id from bx1_portal.product_eligibility_cases e where e.id=(shown.item->>'id')::uuid))
      order by shown.ordinality),'[]'::jsonb) into cases
    from pg_catalog.jsonb_array_elements(result->'product_eligibility') with ordinality as shown(item,ordinality);
    result:=pg_catalog.jsonb_set(result,'{product_eligibility}',cases);
  end if;
  if pg_catalog.jsonb_typeof(result#>'{funding,routes}')='array' then
    select coalesce(pg_catalog.jsonb_agg(case when bx1_portal.offering_operational((shown.item->>'product_id')::uuid) then shown.item
      else pg_catalog.jsonb_set(shown.item,'{allowed_actions}',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a.value)
        order by a.ordinality) from pg_catalog.jsonb_array_elements_text(coalesce(shown.item->'allowed_actions','[]'::jsonb))
        with ordinality a(value,ordinality) where a.value<>'approve_funding_route'),'[]'::jsonb)) end
      order by shown.ordinality),'[]'::jsonb)
      into routes from pg_catalog.jsonb_array_elements(result#>'{funding,routes}')
        with ordinality as shown(item,ordinality);
    result:=pg_catalog.jsonb_set(result,'{funding,routes}',routes);
  end if;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'offering_context_changed' using errcode='42501'; end if;
  return result;
end $$;

create function bx1_portal.execute_scoped(c jsonb,action text,key uuid,body jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p bx1_portal.products; o bx1_portal.organisations;
  r bx1_portal.offering_revisions; d bx1_portal.offering_decisions;
  prior bx1_portal.scoped_requests; original_revision integer; decision text; counter integer;
begin
  if action not in ('save_product','submit_product','review_product','review_offering_issuer',
    'publish_product','subscribe') then
    return bx1_portal.execute_scoped_pre_offering(c,action,key,body); end if;
  if bx1_portal.valid_operating_context(c) is not true or
    key is null or key='00000000-0000-0000-0000-000000000000' or
    pg_catalog.jsonb_typeof(body) is distinct from 'object' or pg_catalog.octet_length(body::text)>65536 then
    raise exception 'offering_context_or_command_denied' using errcode='42501'; end if;
  perform bx1_portal.entry_lock_actor();
  select * into prior from bx1_portal.scoped_requests where actor_id=actor and request_key=key;
  if prior.actor_id is not null then
    if prior.operating_context is distinct from c or prior.command is distinct from action
      or prior.payload is distinct from body then
      raise exception 'offering_idempotency_conflict' using errcode='23505'; end if;
    return bx1_portal.read_scoped(c);
  end if;
  if exists(select 1 from bx1_portal.requests where actor_id=actor and request_key=key)
    or exists(select 1 from bx1_portal.entry_requests where actor_id=actor and request_key=key) then
    raise exception 'offering_prior_key_conflict' using errcode='23505'; end if;

  if action='subscribe' then
    perform bx1_portal.require_keys(body,array['product_id','expected_revision','terms_hash','units',
      'accepted_documents','accepted_risks','investment_account_id','offering_revision_id']);
  elsif action='review_product' then
    perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id',
      'terms_hash','decision','notes','checks']);
  elsif action='review_offering_issuer' then
    perform bx1_portal.require_keys(body,array['product_id','expected_revision','offering_revision_id',
      'terms_hash','decision','notes','checks']);
  end if;
  select * into p from bx1_portal.products where id=(body->>'product_id')::uuid for update;
  if p.id is null then raise exception 'offering_product_denied' using errcode='42501'; end if;
  select * into o from bx1_portal.organisations where id=p.organisation_id for share;
  perform id from bx1_portal.organisation_authority_bindings
    where product_organisation_id=o.id order by id for share;
  original_revision:=p.revision;
  if action in ('review_product','review_offering_issuer','subscribe','publish_product') then
    select * into r from bx1_portal.offering_revisions
      where id=p.current_offering_revision_id and product_id=p.id;
    if r.id is null or r.origin<>'SUBMITTED' or r.terms_hash is distinct from p.terms_hash
      or r.terms is distinct from p.terms then
      raise exception 'offering_current_package_required' using errcode='23514'; end if;
  end if;

  if action='review_product' or action='review_offering_issuer' then
    if pg_catalog.jsonb_typeof(body->'expected_revision') is distinct from 'number'
      or body->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'
      or (body->>'expected_revision')::integer<>p.revision
      or body->>'offering_revision_id' is distinct from r.id::text
      or body->>'terms_hash' is distinct from r.terms_hash then
      raise exception 'offering_stale_package' using errcode='23514'; end if;
    perform bx1_portal.require_text(body,'notes',20,3000);
    decision:=body->>'decision';
    if decision not in ('APPROVED','CHANGES_REQUIRED') then
      raise exception 'offering_decision_invalid' using errcode='22023'; end if;
  end if;

  if action='save_product' then
    perform bx1_portal.execute_scoped_pre_offering(c,action,key,body);
    update bx1_portal.products set current_offering_revision_id=null where id=p.id;
  elsif action='submit_product' then
    select * into r from bx1_portal.offering_revisions
      where product_id=p.id and origin='SUBMITTED' order by package_number desc limit 1;
    if r.id is not null and r.terms_hash=p.terms_hash then
      raise exception 'offering_unchanged_resubmission' using errcode='23514'; end if;
    perform bx1_portal.execute_scoped_pre_offering(c,action,key,body);
    select * into p from bx1_portal.products where id=p.id;
    select coalesce(max(package_number),0)+1 into counter
      from bx1_portal.offering_revisions where product_id=p.id;
    insert into bx1_portal.offering_revisions(product_id,package_number,origin,
      product_revision_at_submission,terms,terms_hash,document_hashes,submitted_by,submitted_at)
      values(p.id,counter,'SUBMITTED',p.revision,p.terms,p.terms_hash,
        bx1_portal.offering_document_hashes(p.terms),actor,pg_catalog.clock_timestamp()) returning * into r;
    update bx1_portal.products set current_offering_revision_id=r.id where id=p.id;
  elsif action='review_product' then
    if bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true
      or bx1_portal.entity_people_independent(actor,r.submitted_by) is not true then
      raise exception 'offering_compliance_scope_denied' using errcode='42501'; end if;
    select * into d from bx1_portal.offering_decisions
      where offering_revision_id=r.id and decision_kind='ISSUER';
    perform bx1_portal.lock_entity_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);
    if bx1_portal.scoped_reviewer(c,o.reviewer_scope,o.id) is not true
      or bx1_portal.entity_people_independent(actor,r.submitted_by) is not true then
      raise exception 'offering_compliance_authority_changed' using errcode='42501'; end if;
    if d.id is not null and bx1_portal.entity_people_independent(actor,d.actor_id) is not true then
      raise exception 'offering_independent_review_required' using errcode='42501'; end if;
    if exists(select 1 from bx1_portal.offering_decisions
      where offering_revision_id=r.id and decision_kind='COMPLIANCE') then
      raise exception 'offering_decision_already_recorded' using errcode='23514'; end if;
    perform bx1_portal.execute_scoped_pre_offering(c,action,key,
      body-'offering_revision_id'-'terms_hash');
    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,
      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)
      values(r.id,'COMPLIANCE',decision,actor,c,r.terms_hash,r.document_hashes,
        original_revision,body->>'notes',body->'checks');
    -- The inherited reviewer writer labels Compliance-only approval APPROVED.
    -- Correct the enduring product state in the same transaction: the entire
    -- offering is approved only after the separately appointed issuer agrees.
    if decision='APPROVED' and coalesce(d.decision,'PENDING')<>'APPROVED' then
      update bx1_portal.products set status='IN_REVIEW' where id=p.id;
    end if;
  elsif action='review_offering_issuer' then
    perform bx1_portal.require_checks(body->'checks',array['issuer_authority','terms','rights'],decision='APPROVED');
    if p.status not in ('IN_REVIEW','APPROVED') or bx1_portal.offering_issuer_authorised(c,p.id) is not true then
      raise exception 'offering_issuer_appointment_required' using errcode='42501'; end if;
    -- Pin the native appointment source through commit. A concurrent role or
    -- organisation suspension cannot race the independently recorded choice.
    perform m.id from public.bx1_memberships m
      where m.user_id=actor and m.organisation_id=(c->>'organisationId')::uuid
        and m.role='IssuerFundManager' order by m.id for share;
    perform n.id from public.bx1_organisations n
      where n.id=(c->>'organisationId')::uuid for share;
    select * into d from bx1_portal.offering_decisions
      where offering_revision_id=r.id and decision_kind='COMPLIANCE';
    perform bx1_portal.lock_entity_people(array[actor,r.submitted_by,o.owner_id,d.actor_id]);
    if d.id is not null and bx1_portal.entity_people_independent(actor,d.actor_id) is not true then
      raise exception 'offering_independent_issuer_required' using errcode='42501'; end if;
    if bx1_portal.valid_operating_context(c) is not true or
      bx1_portal.offering_issuer_authorised(c,p.id) is not true then
      raise exception 'offering_issuer_authority_changed' using errcode='42501'; end if;
    insert into bx1_portal.offering_decisions(offering_revision_id,decision_kind,decision,
      actor_id,operating_context,terms_hash,document_hashes,product_revision_at_decision,notes,checks)
      values(r.id,'ISSUER',decision,actor,c,r.terms_hash,r.document_hashes,
        original_revision,body->>'notes',body->'checks');
    update bx1_portal.products set revision=revision+1,
      status=case when decision='CHANGES_REQUIRED' then 'CHANGES_REQUIRED'
        when d.decision='APPROVED' then 'APPROVED' else 'IN_REVIEW' end
      where id=p.id;
    insert into bx1_portal.events(subject_id,organisation_id,kind,actor_id,summary)
      values(r.id,p.organisation_id,action,actor,
        'Appointed issuer decided exact immutable test offering package: '||decision||'. No publication or chain deployment.');
    insert into bx1_portal.scoped_requests(actor_id,request_key,operating_context,command,payload)
      values(actor,key,c,action,body);
  elsif action='publish_product' then
    if bx1_portal.scoped_operator(c,p.organisation_id) is not true then
      raise exception 'offering_operator_denied' using errcode='42501'; end if;
    if bx1_portal.offering_approved(p.id) is not true then
      raise exception 'offering_issuer_and_compliance_approval_required' using errcode='23514'; end if;
    if bx1_portal.offering_technical_ready(r.id) is not true then
      raise exception 'offering_technical_readiness_required' using errcode='23514'; end if;
    perform bx1_portal.execute_scoped_pre_offering(c,action,key,body);
  elsif action='subscribe' then
    if body->>'offering_revision_id' is distinct from r.id::text
      or body->>'terms_hash' is distinct from r.terms_hash
      or bx1_portal.scoped_product_visible(c,p.id) is not true
      or p.status<>'PUBLISHED' or bx1_portal.offering_operational(p.id) is not true then
      raise exception 'offering_not_open' using errcode='42501'; end if;
    perform bx1_portal.execute_scoped_pre_offering(c,action,key,body-'offering_revision_id');
  end if;
  if bx1_portal.valid_operating_context(c) is not true then
    raise exception 'offering_context_changed' using errcode='42501'; end if;
  return bx1_portal.read_scoped(c);
end $$;

create or replace function public.bx1_portal_read_scoped(operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.read_scoped(operating_context); $$;
create or replace function public.bx1_portal_command_scoped(command text,request_key uuid,payload jsonb,operating_context jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select bx1_portal.execute_scoped(operating_context,command,request_key,payload); $$;

revoke all on function bx1_portal.offering_document_hashes(jsonb),
  bx1_portal.offering_technical_ready(uuid),bx1_portal.offering_approved(uuid),
  bx1_portal.offering_operational(uuid),bx1_portal.offering_issuer_session_assured(jsonb),
  bx1_portal.offering_issuer_authorised(jsonb,uuid),bx1_portal.offering_issuer_scope(jsonb,uuid),
  bx1_portal.offering_package_projection(jsonb,uuid),bx1_portal.offering_history_projection(uuid),
  bx1_portal.guard_offering_publication(),bx1_portal.guard_offering_subscription(),
  bx1_portal.guard_offering_accepted_order(),
  bx1_portal.guard_offering_funding_commitment(),bx1_portal.guard_offering_eligibility(),
  bx1_portal.scoped_product_visible(jsonb,uuid),bx1_portal.product_eligibility_current(uuid),
  bx1_portal.read_scoped_pre_offering(jsonb),bx1_portal.execute_scoped_pre_offering(jsonb,text,uuid,jsonb),
  bx1_portal.read_scoped(jsonb),bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
  public.bx1_portal_read_scoped(jsonb),public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
do $test_grants$ begin
  if exists(select 1 from bx1_portal.entry_configuration
    where singleton and environment='TESTNET') then
    grant execute on function bx1_portal.read_scoped(jsonb),
      bx1_portal.execute_scoped(jsonb,text,uuid,jsonb),
      public.bx1_portal_read_scoped(jsonb),
      public.bx1_portal_command_scoped(text,uuid,jsonb,jsonb) to authenticated;
  end if;
end $test_grants$;
